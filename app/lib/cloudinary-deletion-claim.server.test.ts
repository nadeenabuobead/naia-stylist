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
    pendingCloudinaryDeletion: { findUnique: vi.fn(), update: vi.fn().mockResolvedValue({}) },
  },
}));

vi.mock("~/lib/cloudinary-admin.server", () => ({
  deleteCloudinaryAsset: vi.fn(),
  verifyCloudinaryAsset: vi.fn(),
}));

vi.mock("./ai/fashn-tryon-service.server", () => ({
  deleteCustomerVtoResults: vi.fn(),
}));

import prisma from "~/db.server";
import { deleteCloudinaryAsset, verifyCloudinaryAsset } from "~/lib/cloudinary-admin.server";
import { deleteCustomerVtoResults } from "./ai/fashn-tryon-service.server";
import { retryPendingCloudinaryDeletion } from "./cloudinary-deletion-claim.server";

const mockFindUnique = () => (prisma as any).pendingCloudinaryDeletion.findUnique as ReturnType<typeof vi.fn>;
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
    expect(mockDelete()).toHaveBeenCalledWith("naia-wardrobe/c/x", "authenticated");
    expect(result).toEqual({ status: "resolved" });
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

    expect(mockDelete()).toHaveBeenCalledWith("naia-wardrobe/c/y", "private");
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
