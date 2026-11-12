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

import prisma from "~/db.server";
import { deleteCloudinaryAsset, verifyCloudinaryAsset } from "~/lib/cloudinary-admin.server";
import { retryPendingCloudinaryDeletion } from "./cloudinary-deletion-claim.server";

const mockFindUnique = () => (prisma as any).pendingCloudinaryDeletion.findUnique as ReturnType<typeof vi.fn>;
const mockUpdate = () => (prisma as any).pendingCloudinaryDeletion.update as ReturnType<typeof vi.fn>;
const mockDelete = () => deleteCloudinaryAsset as ReturnType<typeof vi.fn>;
const mockVerify = () => verifyCloudinaryAsset as ReturnType<typeof vi.fn>;

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
