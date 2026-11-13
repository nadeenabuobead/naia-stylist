// app/lib/ai/vto-result-cascade.behavioral.test.ts
//
// Behavioral coverage for the privacy fix closing the "body photo deleted,
// but previously-COMPLETED VTO results stay fully accessible" gap, AND the
// follow-up durability fix: the cleanup obligation is now recorded
// ATOMICALLY, in the same transaction as the bodyPublicId write that
// actually deletes the photo (via a custom UpsertModelFn passed into the
// unmodified deleteNaiaModelPhoto/withdrawSaveModelConsent), not reactively
// after a failed sweep — so a database outage can't lose the obligation the
// same way it lost the sweep. Exercises the REAL deleteNaiaModelPhoto,
// withdrawSaveModelConsent, and deleteCustomerVtoResults implementations
// (only Cloudinary I/O and the DB are mocked) composed through the REAL
// deleteNaiaModelBodyPhotoAndVtoResults / withdrawSaveModelConsentAndVtoResults
// wrappers — this is what actually proves the cascade and the obligation are
// wired correctly, not just that the wrapper function calls some mock in
// isolation.
//
// Run: npx vitest run app/lib/ai/vto-result-cascade.behavioral.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/db.server", () => {
  const db = {
    naiaModel: { findUnique: vi.fn(), upsert: vi.fn() },
    virtualTryOnJob: { findMany: vi.fn() },
    pendingCloudinaryDeletion: {
      upsert: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockResolvedValue(null),
    },
  };
  return {
    default: {
      ...db,
      // Real implementation runs the callback against a REAL Prisma
      // TransactionClient; here it just runs it against the SAME mocked
      // table objects, so tx.naiaModel.upsert / tx.pendingCloudinaryDeletion.upsert
      // are the exact spies asserted on below.
      $transaction: vi.fn((fn: any) => fn(db)),
    },
  };
});

vi.mock("~/lib/cloudinary-admin.server", async () => {
  const actual = await vi.importActual<typeof import("~/lib/cloudinary-admin.server")>(
    "~/lib/cloudinary-admin.server",
  );
  return { ...actual, deleteCloudinaryAsset: vi.fn() };
});

import prisma from "~/db.server";
import { deleteCloudinaryAsset } from "~/lib/cloudinary-admin.server";
import {
  deleteNaiaModelBodyPhotoAndVtoResults,
  withdrawSaveModelConsentAndVtoResults,
  deleteCustomerVtoResults,
  customerHasOutstandingVtoSweepObligation,
} from "~/lib/ai/fashn-tryon-service.server";

const CUSTOMER_ID = "cust_001";
const OBLIGATION_PUBLIC_ID = `vto-sweep-obligation:${CUSTOMER_ID}`;

function mockNaiaModel(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    customerId: CUSTOMER_ID,
    facePublicId: null,
    bodyPublicId: "naia-wardrobe/cust_001/body-photo",
    deliveryType: "private",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  (deleteCloudinaryAsset as any).mockResolvedValue({ ok: true });
  (prisma as any).naiaModel.upsert.mockResolvedValue({});
  (prisma as any).virtualTryOnJob.findMany.mockResolvedValue([]);
  (prisma as any).pendingCloudinaryDeletion.upsert.mockResolvedValue({});
  (prisma as any).pendingCloudinaryDeletion.updateMany.mockResolvedValue({});
  (prisma as any).pendingCloudinaryDeletion.findUnique.mockResolvedValue(null);
});

describe("deleteNaiaModelBodyPhotoAndVtoResults — the service-level cascade", () => {
  it("cascades to deleteCustomerVtoResults after a successful body-photo deletion, and the cleanup obligation commits atomically with the bodyPublicId write", async () => {
    (prisma as any).naiaModel.findUnique.mockResolvedValue(mockNaiaModel());
    (prisma as any).virtualTryOnJob.findMany.mockResolvedValue([{ id: "job-1" }, { id: "job-2" }]);

    const result = await deleteNaiaModelBodyPhotoAndVtoResults(CUSTOMER_ID);

    expect(deleteCloudinaryAsset).toHaveBeenCalledWith(
      "naia-wardrobe/cust_001/body-photo",
      "private",
    );
    // Three calls total: one for the source body photo, one each for the
    // two COMPLETED jobs' result assets — proves the cascade actually ran.
    expect((deleteCloudinaryAsset as any).mock.calls.length).toBe(3);
    // The obligation was recorded in the SAME transaction as the bodyPublicId
    // clear — both tx.naiaModel.upsert and tx.pendingCloudinaryDeletion.upsert
    // ran inside the one $transaction call.
    expect((prisma as any).$transaction).toHaveBeenCalledTimes(1);
    expect((prisma as any).naiaModel.upsert).toHaveBeenCalledTimes(1);
    expect((prisma as any).pendingCloudinaryDeletion.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { publicId: OBLIGATION_PUBLIC_ID } }),
    );
    // A clean sweep (zero failures) resolves the obligation right away —
    // a second, separate updateMany call, not the per-asset upsert path.
    expect((prisma as any).pendingCloudinaryDeletion.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ publicId: OBLIGATION_PUBLIC_ID }) }),
    );
    expect(result.ok).toBe(true);
    expect(result.cloudinaryOk).toBe(true);
    expect(result.vtoResultsCleanupAttempted).toBe(true);
    expect(result.vtoResultsSweepFailed).toBe(false);
    expect(result.vtoResultsDeletedCount).toBe(2);
    expect(result.vtoResultsPendingCleanup).toEqual([]);
  });

  it("DB failure BEFORE deletion even starts (the initial model read fails): propagates, nothing is attempted, nothing was deleted — the honest 'nothing happened' outcome", async () => {
    (prisma as any).naiaModel.findUnique.mockRejectedValue(new Error("connection reset"));

    await expect(deleteNaiaModelBodyPhotoAndVtoResults(CUSTOMER_ID)).rejects.toThrow("connection reset");

    expect(deleteCloudinaryAsset).not.toHaveBeenCalled();
    expect((prisma as any).$transaction).not.toHaveBeenCalled();
    expect((prisma as any).virtualTryOnJob.findMany).not.toHaveBeenCalled();
  });

  it("does NOT cascade and records NO obligation when the source photo's own Cloudinary deletion fails (cloudinaryOk: false) — nothing was actually deleted yet", async () => {
    (prisma as any).naiaModel.findUnique.mockResolvedValue(mockNaiaModel());
    (deleteCloudinaryAsset as any).mockResolvedValueOnce({ ok: false, errorCode: "PROVIDER_ERROR" });

    const result = await deleteNaiaModelBodyPhotoAndVtoResults(CUSTOMER_ID);

    expect(result.cloudinaryOk).toBe(false);
    expect(result.vtoResultsCleanupAttempted).toBe(false);
    expect((prisma as any).$transaction).not.toHaveBeenCalled();
    expect((prisma as any).virtualTryOnJob.findMany).not.toHaveBeenCalled();
  });

  it("does NOT attempt the sweep on a staleReference outcome (the atomic obligation transaction itself failed) — retrying the sweep now would hit the same unavailable database", async () => {
    (prisma as any).naiaModel.findUnique.mockResolvedValue(mockNaiaModel());
    // The atomic transaction (bodyPublicId clear + obligation insert)
    // throws — simulates the database being unavailable at exactly this
    // moment. deleteNaiaModelPhoto's own existing catch turns this into
    // staleReference; neither the bodyPublicId clear nor the obligation
    // exist afterward.
    (prisma as any).$transaction.mockRejectedValueOnce(new Error("DB unavailable"));

    const result = await deleteNaiaModelBodyPhotoAndVtoResults(CUSTOMER_ID);

    expect(result.ok).toBe(false);
    expect(result.cloudinaryOk).toBe(true);
    expect(result.staleReference).toBe(true);
    expect(result.vtoResultsCleanupAttempted).toBe(false);
    expect((prisma as any).virtualTryOnJob.findMany).not.toHaveBeenCalled();
  });

  it("reports vtoResultsPendingCleanup and leaves the obligation UNRESOLVED (never silently reports fully complete) when a result asset's Cloudinary deletion fails", async () => {
    (prisma as any).naiaModel.findUnique.mockResolvedValue(mockNaiaModel());
    (prisma as any).virtualTryOnJob.findMany.mockResolvedValue([{ id: "job-1" }]);
    (deleteCloudinaryAsset as any)
      .mockResolvedValueOnce({ ok: true }) // the source body photo itself
      .mockResolvedValueOnce({ ok: false, errorCode: "PROVIDER_ERROR" }); // the one VTO result

    const result = await deleteNaiaModelBodyPhotoAndVtoResults(CUSTOMER_ID);

    expect(result.ok).toBe(true); // the photo deletion itself genuinely succeeded
    expect(result.vtoResultsPendingCleanup).toEqual(["naia-tryon/cust_001/job-1"]);
    expect((prisma as any).pendingCloudinaryDeletion.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { publicId: "naia-tryon/cust_001/job-1" },
        create: expect.objectContaining({
          customerId: CUSTOMER_ID,
          publicId: "naia-tryon/cust_001/job-1",
          context: "vto-result-deletion-failed",
        }),
      }),
    );
    // Not every failure resolves the obligation — only a clean sweep does.
    expect((prisma as any).pendingCloudinaryDeletion.updateMany).not.toHaveBeenCalled();
  });

  it("CORE DURABILITY FIX: the obligation survives even when deleteCustomerVtoResults can't even enumerate jobs — the obligation was already committed atomically with the photo deletion, before the sweep was ever attempted", async () => {
    (prisma as any).naiaModel.findUnique.mockResolvedValue(mockNaiaModel());
    // The photo deletion's own atomic transaction succeeds (obligation
    // recorded) — but the very next call, findMany for the sweep, fails.
    // This is exactly the scenario a reactive "catch and insert a retry
    // record" design would lose: that insert would hit the same failure.
    // Here there is nothing left to insert — the obligation already exists.
    (prisma as any).virtualTryOnJob.findMany.mockRejectedValue(new Error("connection reset"));

    const result = await deleteNaiaModelBodyPhotoAndVtoResults(CUSTOMER_ID);

    expect(result.ok).toBe(true); // the photo deletion itself genuinely succeeded and committed
    expect(result.vtoResultsCleanupAttempted).toBe(true);
    expect(result.vtoResultsSweepFailed).toBe(true); // never silently reported as fully complete
    // The obligation upsert happened as part of the SAME transaction as the
    // bodyPublicId clear, strictly BEFORE findMany was even called.
    expect((prisma as any).pendingCloudinaryDeletion.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { publicId: OBLIGATION_PUBLIC_ID } }),
    );
    // Never resolved — the sweep never got far enough to prove anything.
    expect((prisma as any).pendingCloudinaryDeletion.updateMany).not.toHaveBeenCalled();
  });

  it("reopens a previously-resolved obligation on a fresh deletion (update clause resets resolvedAt)", async () => {
    (prisma as any).naiaModel.findUnique.mockResolvedValue(mockNaiaModel());

    await deleteNaiaModelBodyPhotoAndVtoResults(CUSTOMER_ID);

    expect((prisma as any).pendingCloudinaryDeletion.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { publicId: OBLIGATION_PUBLIC_ID },
        update: { resolvedAt: null },
      }),
    );
  });
});

describe("customerHasOutstandingVtoSweepObligation — the fail-closed signal", () => {
  it("returns true when the sentinel row exists and is unresolved", async () => {
    (prisma as any).pendingCloudinaryDeletion.findUnique.mockResolvedValue({ resolvedAt: null });
    expect(await customerHasOutstandingVtoSweepObligation(CUSTOMER_ID)).toBe(true);
    expect((prisma as any).pendingCloudinaryDeletion.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { publicId: OBLIGATION_PUBLIC_ID } }),
    );
  });

  it("returns false when the sentinel row exists but is resolved", async () => {
    (prisma as any).pendingCloudinaryDeletion.findUnique.mockResolvedValue({ resolvedAt: new Date() });
    expect(await customerHasOutstandingVtoSweepObligation(CUSTOMER_ID)).toBe(false);
  });

  it("returns false when no sentinel row exists at all (never deleted, or replaced a photo — no obligation was ever created)", async () => {
    (prisma as any).pendingCloudinaryDeletion.findUnique.mockResolvedValue(null);
    expect(await customerHasOutstandingVtoSweepObligation(CUSTOMER_ID)).toBe(false);
  });
});

describe("withdrawSaveModelConsentAndVtoResults — unconditional cascade", () => {
  it("cascades even when there is no body photo at all (nothing to delete, but the sweep still runs)", async () => {
    (prisma as any).naiaModel.findUnique.mockResolvedValue(null);

    await withdrawSaveModelConsentAndVtoResults(CUSTOMER_ID);

    expect((prisma as any).virtualTryOnJob.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { customerId: CUSTOMER_ID, status: "COMPLETED" } }),
    );
  });

  it("cascades even when the face/body Cloudinary deletes themselves fail — bodyPublicId is always cleared regardless", async () => {
    (prisma as any).naiaModel.findUnique.mockResolvedValue(mockNaiaModel());
    (deleteCloudinaryAsset as any).mockResolvedValue({ ok: false, errorCode: "PROVIDER_ERROR" });
    (prisma as any).virtualTryOnJob.findMany.mockResolvedValue([{ id: "job-1" }]);

    const result = await withdrawSaveModelConsentAndVtoResults(CUSTOMER_ID);

    expect(result.ok).toBe(false); // the model-photo deletion itself partially failed
    expect((prisma as any).virtualTryOnJob.findMany).toHaveBeenCalled(); // but the sweep still ran
    expect(result.vtoResultsPendingCleanup.length).toBeGreaterThan(0);
  });
});

describe("deleteCustomerVtoResults — job-state coverage and dedup-safe failure recording", () => {
  it("queries only COMPLETED jobs — never PROCESSING/FAILED/CANCELED/TIMED_OUT, which never have a live result asset", async () => {
    await deleteCustomerVtoResults(CUSTOMER_ID);
    expect((prisma as any).virtualTryOnJob.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { customerId: CUSTOMER_ID, status: "COMPLETED" } }),
    );
  });

  it("calling it twice for the same failed asset upserts the SAME PendingCloudinaryDeletion row — no duplicate records (publicId is @unique)", async () => {
    (prisma as any).virtualTryOnJob.findMany.mockResolvedValue([{ id: "job-1" }]);
    (deleteCloudinaryAsset as any).mockResolvedValue({ ok: false, errorCode: "PROVIDER_ERROR" });

    await deleteCustomerVtoResults(CUSTOMER_ID);
    await deleteCustomerVtoResults(CUSTOMER_ID);

    expect((prisma as any).pendingCloudinaryDeletion.upsert).toHaveBeenCalledTimes(2);
    const [firstCall, secondCall] = (prisma as any).pendingCloudinaryDeletion.upsert.mock.calls;
    expect(firstCall[0].where.publicId).toBe(secondCall[0].where.publicId);
  });

  it("a genuinely unrelated database error (findMany itself throwing) propagates — is not caught or swallowed", async () => {
    (prisma as any).virtualTryOnJob.findMany.mockRejectedValue(new Error("connection reset"));
    await expect(deleteCustomerVtoResults(CUSTOMER_ID)).rejects.toThrow("connection reset");
  });
});
