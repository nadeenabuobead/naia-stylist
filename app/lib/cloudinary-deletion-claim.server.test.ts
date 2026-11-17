// app/lib/cloudinary-deletion-claim.server.test.ts
//
// Focused coverage for retryPendingCloudinaryDeletion's delivery-type
// handling — the correction closing the gap where a failed deletion could
// be retried against a guessed "private" type instead of the asset's real
// one. See FailedModelAsset (my-naia-model.server.ts) and
// resolveModelAssetDeliveryType for where the "unknown" sentinel this file
// tests originates.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/db.server", () => ({
  default: {
    pendingCloudinaryDeletion: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn().mockResolvedValue({}) },
  },
}));

vi.mock("~/lib/cloudinary-admin.server", () => ({
  deleteCloudinaryAsset: vi.fn(),
  verifyCloudinaryAsset: vi.fn(),
}));

vi.mock("./ai/fashn-tryon-service.server", () => ({
  deleteCustomerVtoResults: vi.fn(),
}));

vi.mock("./error-tracking.server", () => ({
  captureFailure: vi.fn(),
}));

import prisma from "~/db.server";
import { deleteCloudinaryAsset, verifyCloudinaryAsset } from "~/lib/cloudinary-admin.server";
import { deleteCustomerVtoResults } from "./ai/fashn-tryon-service.server";
import { captureFailure } from "./error-tracking.server";
import {
  retryPendingCloudinaryDeletion,
  sweepPendingCloudinaryDeletions,
  CLOUDINARY_DELETION_SWEEP_BATCH_SIZE,
} from "./cloudinary-deletion-claim.server";

const mockFindUnique = () => (prisma as any).pendingCloudinaryDeletion.findUnique as ReturnType<typeof vi.fn>;
const mockFindMany = () => (prisma as any).pendingCloudinaryDeletion.findMany as ReturnType<typeof vi.fn>;
const mockUpdate = () => (prisma as any).pendingCloudinaryDeletion.update as ReturnType<typeof vi.fn>;
const mockDelete = () => deleteCloudinaryAsset as ReturnType<typeof vi.fn>;
const mockVerify = () => verifyCloudinaryAsset as ReturnType<typeof vi.fn>;
const mockSweep = () => deleteCustomerVtoResults as ReturnType<typeof vi.fn>;

beforeEach(() => vi.clearAllMocks());

describe("retryPendingCloudinaryDeletion — known delivery type (the common case)", () => {
  it("retries directly with the row's own deliveryType — no verification call needed", async () => {
    mockFindUnique().mockResolvedValue({ id: "pcd-1", publicId: "naia-wardrobe/c/x", deliveryType: "authenticated", resolvedAt: null });
    mockDelete().mockResolvedValue({ ok: true });

    const result = await retryPendingCloudinaryDeletion("pcd-1");

    expect(mockVerify()).not.toHaveBeenCalled();
    expect(mockDelete()).toHaveBeenCalledWith("naia-wardrobe/c/x", "authenticated", undefined, undefined, undefined);
    expect(result).toEqual({ status: "resolved" });
  });

  it("H7 completion — passes the row's own resourceType through, not the deleteCloudinaryAsset default ('image')", async () => {
    // Regression target: a recorded row for a non-image asset (e.g. the
    // export-zip sweep's 'raw' ZIP archives) must retry against its real
    // resource_type, or Cloudinary's Admin API will never find it to delete
    // and the row would retry forever without ever resolving.
    mockFindUnique().mockResolvedValue({ id: "pcd-raw-1", publicId: "naia-data-export/job-1", deliveryType: "private", resourceType: "raw", resolvedAt: null });
    mockDelete().mockResolvedValue({ ok: true });

    await retryPendingCloudinaryDeletion("pcd-raw-1");

    expect(mockDelete()).toHaveBeenCalledWith("naia-data-export/job-1", "private", undefined, undefined, "raw");
  });

  it("not-found and already-resolved rows never reach deleteCloudinaryAsset", async () => {
    mockFindUnique().mockResolvedValueOnce(null);
    expect(await retryPendingCloudinaryDeletion("missing")).toEqual({ status: "not-found" });

    mockFindUnique().mockResolvedValueOnce({ id: "pcd-2", publicId: "x", deliveryType: "private", resolvedAt: new Date() });
    expect(await retryPendingCloudinaryDeletion("pcd-2")).toEqual({ status: "already-resolved" });
    expect(mockDelete()).not.toHaveBeenCalled();
  });
});

describe("retryPendingCloudinaryDeletion — customer-level VTO-sweep obligations (context: vto-sweep-obligation)", () => {
  const OBLIGATION_ROW = {
    id: "pcd-vto-1",
    customerId: "cust_001",
    publicId: "vto-sweep-obligation:cust_001",
    resourceType: "vto-sweep",
    deliveryType: "n/a",
    context: "vto-sweep-obligation",
    resolvedAt: null,
  };

  it("re-runs deleteCustomerVtoResults (not deleteCloudinaryAsset against the sentinel publicId) and resolves on a clean sweep", async () => {
    mockFindUnique().mockResolvedValue(OBLIGATION_ROW);
    mockSweep().mockResolvedValue({ deletedCount: 2, skippedCount: 0, failedAssets: [] });

    const result = await retryPendingCloudinaryDeletion("pcd-vto-1");

    expect(mockSweep()).toHaveBeenCalledWith("cust_001");
    expect(mockDelete()).not.toHaveBeenCalled(); // never against the fake sentinel publicId
    expect(mockUpdate()).toHaveBeenCalledWith({ where: { id: "pcd-vto-1" }, data: { resolvedAt: expect.any(Date) } });
    expect(result).toEqual({ status: "resolved" });
  });

  it("leaves the obligation UNRESOLVED when some individual assets are still pending — those stay tracked as their OWN separate rows", async () => {
    mockFindUnique().mockResolvedValue(OBLIGATION_ROW);
    mockSweep().mockResolvedValue({
      deletedCount: 1,
      skippedCount: 1,
      failedAssets: ["naia-tryon/cust_001/job-2"],
    });

    const result = await retryPendingCloudinaryDeletion("pcd-vto-1");

    expect(mockUpdate()).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "pcd-vto-1" },
        data: expect.objectContaining({ attemptCount: { increment: 1 } }),
      }),
    );
    expect(result).toEqual({ status: "failed-again", error: "VTO_RESULTS_PARTIAL" });
  });

  it("if deleteCustomerVtoResults itself throws (can't even enumerate), reports failed-again instead of crashing the admin retry action", async () => {
    mockFindUnique().mockResolvedValue(OBLIGATION_ROW);
    mockSweep().mockRejectedValue(new Error("connection reset"));

    const result = await retryPendingCloudinaryDeletion("pcd-vto-1");

    expect(result).toEqual({ status: "failed-again", error: "VTO_SWEEP_ENUMERATION_FAILED" });
  });

  it("is idempotent — retrying an already-resolved obligation is a no-op, same as any other row", async () => {
    mockFindUnique().mockResolvedValue({ ...OBLIGATION_ROW, resolvedAt: new Date() });

    const result = await retryPendingCloudinaryDeletion("pcd-vto-1");

    expect(mockSweep()).not.toHaveBeenCalled();
    expect(result).toEqual({ status: "already-resolved" });
  });

  it("never takes the deliveryType-resolution or deleteCloudinaryAsset path for a vto-sweep-obligation row", async () => {
    mockFindUnique().mockResolvedValue(OBLIGATION_ROW); // deliveryType: "n/a", never "unknown"
    mockSweep().mockResolvedValue({ deletedCount: 0, skippedCount: 0, failedAssets: [] });

    await retryPendingCloudinaryDeletion("pcd-vto-1");

    expect(mockVerify()).not.toHaveBeenCalled();
    expect(mockDelete()).not.toHaveBeenCalled();
  });
});

describe("retryPendingCloudinaryDeletion — deliveryType: 'unknown' (the correction)", () => {
  it("resolves the real type via verification BEFORE deleting — never calls deleteCloudinaryAsset with 'unknown'", async () => {
    mockFindUnique().mockResolvedValue({ id: "pcd-3", publicId: "naia-wardrobe/c/y", deliveryType: "unknown", resolvedAt: null });
    mockVerify().mockImplementation(async (_pid, dt) => (dt === "private" ? { ok: true, asset: { type: "private" } } : { ok: false, errorCode: "NOT_FOUND" }));
    mockDelete().mockResolvedValue({ ok: true });

    const result = await retryPendingCloudinaryDeletion("pcd-3");

    expect(mockDelete()).toHaveBeenCalledWith("naia-wardrobe/c/y", "private", undefined, undefined, undefined);
    expect(mockDelete()).not.toHaveBeenCalledWith("naia-wardrobe/c/y", "unknown");
    expect(result).toEqual({ status: "resolved" });
  });

  it("persists the newly-resolved type on the row so a future retry does not need to re-resolve it", async () => {
    mockFindUnique().mockResolvedValue({ id: "pcd-4", publicId: "naia-wardrobe/c/z", deliveryType: "unknown", resolvedAt: null });
    mockVerify().mockImplementation(async (_pid, dt) => (dt === "authenticated" ? { ok: true, asset: { type: "authenticated" } } : { ok: false, errorCode: "NOT_FOUND" }));
    mockDelete().mockResolvedValue({ ok: true });

    await retryPendingCloudinaryDeletion("pcd-4");

    expect(mockUpdate()).toHaveBeenCalledWith({ where: { id: "pcd-4" }, data: { deliveryType: "authenticated" } });
  });

  it("tries 'private' before 'authenticated' and stops at the first match — no unnecessary second verify call", async () => {
    mockFindUnique().mockResolvedValue({ id: "pcd-5", publicId: "naia-wardrobe/c/w", deliveryType: "unknown", resolvedAt: null });
    mockVerify().mockResolvedValue({ ok: true, asset: { type: "private" } });
    mockDelete().mockResolvedValue({ ok: true });

    await retryPendingCloudinaryDeletion("pcd-5");

    expect(mockVerify()).toHaveBeenCalledTimes(1);
    expect(mockVerify()).toHaveBeenCalledWith("naia-wardrobe/c/w", "private");
  });

  it("neither candidate resolves: never calls deleteCloudinaryAsset, reports failed-again, not a false success", async () => {
    mockFindUnique().mockResolvedValue({ id: "pcd-6", publicId: "naia-wardrobe/c/gone", deliveryType: "unknown", resolvedAt: null });
    mockVerify().mockResolvedValue({ ok: false, errorCode: "NOT_FOUND" });

    const result = await retryPendingCloudinaryDeletion("pcd-6");

    expect(mockDelete()).not.toHaveBeenCalled();
    expect(result).toEqual({ status: "failed-again", error: "DELIVERY_TYPE_UNKNOWN" });
    expect(mockUpdate()).toHaveBeenCalledWith({
      where: { id: "pcd-6" },
      data: { attemptCount: { increment: 1 }, lastAttemptAt: expect.any(Date), lastError: "DELIVERY_TYPE_UNKNOWN" },
    });
  });

  it("type resolves but the actual delete still fails: reports failed-again with the real deliveryType already persisted", async () => {
    mockFindUnique().mockResolvedValue({ id: "pcd-7", publicId: "naia-wardrobe/c/v", deliveryType: "unknown", resolvedAt: null });
    mockVerify().mockImplementation(async (_pid, dt) => (dt === "private" ? { ok: true, asset: { type: "private" } } : { ok: false, errorCode: "NOT_FOUND" }));
    mockDelete().mockResolvedValue({ ok: false, errorCode: "PROVIDER_ERROR" });

    const result = await retryPendingCloudinaryDeletion("pcd-7");

    expect(result).toEqual({ status: "failed-again", error: "PROVIDER_ERROR" });
    expect(mockUpdate()).toHaveBeenCalledWith({ where: { id: "pcd-7" }, data: { deliveryType: "private" } });
  });
});

describe("sweepPendingCloudinaryDeletions (2026-11-17, launch-readiness audit, H6)", () => {
  // Before this existed, the ONLY path that ever retried a pending row was
  // a human manually clicking it on /admin/maintenance — there was no
  // automated option at all. See api.cloudinary-deletion-sweep.ts for the
  // actual external trigger this function is meant to be called from.

  it("a clean sweep with nothing pending checks zero rows, never calls deleteCloudinaryAsset", async () => {
    mockFindMany().mockResolvedValue([]);

    const result = await sweepPendingCloudinaryDeletions();

    expect(mockFindMany()).toHaveBeenCalledWith({
      where: { resolvedAt: null },
      orderBy: { createdAt: "asc" },
      take: CLOUDINARY_DELETION_SWEEP_BATCH_SIZE + 1,
    });
    expect(mockDelete()).not.toHaveBeenCalled();
    expect(result).toEqual({ checked: 0, resolved: 0, failed: 0, more: false });
  });

  it("resolves every row it can, counts a per-row failure without aborting the rest of the batch, and reports it via captureFailure", async () => {
    const rows = [
      { id: "row-1", publicId: "naia-wardrobe/c1/v1", deliveryType: "private", resolvedAt: null, attemptCount: 0 },
      { id: "row-2", publicId: "naia-wardrobe/c2/v2", deliveryType: "private", resolvedAt: null, attemptCount: 0 },
      { id: "row-3", publicId: "naia-wardrobe/c3/v3", deliveryType: "private", resolvedAt: null, attemptCount: 0 },
    ];
    mockFindMany().mockResolvedValue(rows);
    mockFindUnique().mockImplementation(async ({ where: { id } }: any) => rows.find((r) => r.id === id) ?? null);
    mockDelete()
      .mockResolvedValueOnce({ ok: true })                              // row-1 succeeds
      .mockResolvedValueOnce({ ok: false, errorCode: "PROVIDER_ERROR" }) // row-2 fails
      .mockResolvedValueOnce({ ok: true });                             // row-3 succeeds

    const result = await sweepPendingCloudinaryDeletions();

    expect(mockDelete()).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ checked: 3, resolved: 2, failed: 1, more: false });

    // Reaches this app's central error-capture seam exactly once, for the
    // one row that failed, never carrying publicId or customerId.
    expect(captureFailure).toHaveBeenCalledTimes(1);
    expect(captureFailure).toHaveBeenCalledWith(
      "cloudinary-deletion-sweep",
      expect.any(String),
      expect.objectContaining({ pendingCloudinaryDeletionId: "row-2", errorCode: "PROVIDER_ERROR" }),
    );
    const meta = (captureFailure as any).mock.calls[0][2];
    expect(meta).not.toHaveProperty("publicId");
    expect(meta).not.toHaveProperty("customerId");
  });

  it("is bounded per call and reports more:true when a backlog exceeds one batch", async () => {
    const oversized = Array.from({ length: CLOUDINARY_DELETION_SWEEP_BATCH_SIZE + 1 }, (_, i) => ({
      id: `row-${i}`,
      publicId: `naia-wardrobe/c${i}/v${i}`,
      deliveryType: "private",
      resolvedAt: null,
      attemptCount: 0,
    }));
    mockFindMany().mockResolvedValue(oversized);
    mockFindUnique().mockImplementation(async ({ where: { id } }: any) =>
      oversized.find((r) => r.id === id) ?? null,
    );
    mockDelete().mockResolvedValue({ ok: true });

    const result = await sweepPendingCloudinaryDeletions();

    // Only the batch-sized slice is actually processed, even though the
    // mock returned one more than that.
    expect(mockDelete()).toHaveBeenCalledTimes(CLOUDINARY_DELETION_SWEEP_BATCH_SIZE);
    expect(result).toEqual({
      checked: CLOUDINARY_DELETION_SWEEP_BATCH_SIZE,
      resolved: CLOUDINARY_DELETION_SWEEP_BATCH_SIZE,
      failed: 0,
      more: true,
    });
  });

  it("reuses retryPendingCloudinaryDeletion's own idempotent per-row logic verbatim — including the vto-sweep-obligation and unknown-deliveryType paths — no parallel retry logic exists in the sweep itself", async () => {
    mockFindMany().mockResolvedValue([
      { id: "row-vto", publicId: "vto-sweep-obligation:cust-1", deliveryType: "private", context: "vto-sweep-obligation", resolvedAt: null, attemptCount: 0, customerId: "cust-1" },
    ]);
    mockFindUnique().mockResolvedValue({
      id: "row-vto", customerId: "cust-1", context: "vto-sweep-obligation", resolvedAt: null, attemptCount: 0,
    });
    (deleteCustomerVtoResults as any).mockResolvedValue({ failedAssets: [] });

    const result = await sweepPendingCloudinaryDeletions();

    expect(deleteCustomerVtoResults).toHaveBeenCalledWith("cust-1");
    expect(mockDelete()).not.toHaveBeenCalled(); // the sentinel row never calls deleteCloudinaryAsset directly
    expect(result).toEqual({ checked: 1, resolved: 1, failed: 0, more: false });
  });
});
