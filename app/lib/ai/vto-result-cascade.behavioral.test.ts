// app/lib/ai/vto-result-cascade.behavioral.test.ts
//
// Behavioral coverage for the privacy fix closing the "body photo deleted,
// but previously-COMPLETED VTO results stay fully accessible" gap: every
// route that deletes the My nAia Model body photo must also sweep any
// already-generated try-on results derived from it. Exercises the REAL
// deleteNaiaModelPhoto, withdrawSaveModelConsent, and deleteCustomerVtoResults
// implementations (only Cloudinary I/O and the DB are mocked) composed
// through the REAL deleteNaiaModelBodyPhotoAndVtoResults /
// withdrawSaveModelConsentAndVtoResults wrappers — this is what actually
// proves the cascade is wired correctly, not just that the wrapper function
// calls some mock in isolation.
//
// Run: npx vitest run app/lib/ai/vto-result-cascade.behavioral.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/db.server", () => ({
  default: {
    naiaModel: { findUnique: vi.fn(), upsert: vi.fn() },
    virtualTryOnJob: { findMany: vi.fn() },
    pendingCloudinaryDeletion: { upsert: vi.fn().mockResolvedValue({}) },
  },
}));

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
} from "~/lib/ai/fashn-tryon-service.server";

const CUSTOMER_ID = "cust_001";

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
});

describe("deleteNaiaModelBodyPhotoAndVtoResults — the service-level cascade", () => {
  it("cascades to deleteCustomerVtoResults after a successful body-photo deletion", async () => {
    (prisma as any).naiaModel.findUnique.mockResolvedValue(mockNaiaModel());
    (prisma as any).virtualTryOnJob.findMany.mockResolvedValue([{ id: "job-1" }, { id: "job-2" }]);

    const result = await deleteNaiaModelBodyPhotoAndVtoResults(CUSTOMER_ID);

    expect(deleteCloudinaryAsset).toHaveBeenCalledWith(
      "naia-wardrobe/cust_001/body-photo",
      "private",
    );
    // Two calls total: one for the source body photo, one each for the two
    // COMPLETED jobs' result assets — proves the cascade actually ran.
    expect((deleteCloudinaryAsset as any).mock.calls.length).toBe(3);
    expect(result.ok).toBe(true);
    expect(result.cloudinaryOk).toBe(true);
    expect(result.vtoResultsCleanupAttempted).toBe(true);
    expect(result.vtoResultsDeletedCount).toBe(2);
    expect(result.vtoResultsPendingCleanup).toEqual([]);
  });

  it("does NOT cascade when the source photo's own Cloudinary deletion fails (cloudinaryOk: false) — nothing to sweep for yet", async () => {
    (prisma as any).naiaModel.findUnique.mockResolvedValue(mockNaiaModel());
    (deleteCloudinaryAsset as any).mockResolvedValueOnce({ ok: false, errorCode: "PROVIDER_ERROR" });

    const result = await deleteNaiaModelBodyPhotoAndVtoResults(CUSTOMER_ID);

    expect(result.cloudinaryOk).toBe(false);
    expect(result.vtoResultsCleanupAttempted).toBe(false);
    expect((prisma as any).virtualTryOnJob.findMany).not.toHaveBeenCalled();
  });

  it("DOES cascade on a staleReference outcome (Cloudinary deletion succeeded, only the DB write failed) — the source is genuinely gone either way", async () => {
    (prisma as any).naiaModel.findUnique.mockResolvedValue(mockNaiaModel());
    (prisma as any).naiaModel.upsert.mockRejectedValueOnce(new Error("DB write failed"));

    const result = await deleteNaiaModelBodyPhotoAndVtoResults(CUSTOMER_ID);

    expect(result.ok).toBe(false);
    expect(result.cloudinaryOk).toBe(true);
    expect(result.staleReference).toBe(true);
    expect(result.vtoResultsCleanupAttempted).toBe(true);
    expect((prisma as any).virtualTryOnJob.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { customerId: CUSTOMER_ID, status: "COMPLETED" } }),
    );
  });

  it("reports vtoResultsPendingCleanup (never silently reports fully complete) when a result asset's Cloudinary deletion fails", async () => {
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
