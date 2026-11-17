// app/lib/buy-or-skip-privacy.test.ts
//
// Buy or Skip individual-item image deletion ("Remove photo" on one item in
// Settings & Privacy) — mirrors closet-photo-privacy.test.ts's coverage for
// the equivalent Closet feature. Proves image-only removal genuinely leaves
// the analysis record (verdict, reasoning, fullAnalysis, outcome) intact and
// respects ownership boundaries, same as the pre-existing bulk deletion.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/db.server", () => ({
  default: {
    buyOrSkipAnalysis: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
    // H7 (2026-11-17) — a failed Cloudinary deletion is now recorded here
    // instead of being discarded.
    pendingCloudinaryDeletion: { upsert: vi.fn().mockResolvedValue({}) },
  },
}));

vi.mock("~/lib/cloudinary-admin.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/cloudinary-admin.server")>();
  return {
    ...actual, // keep the real validatePublicIdOwnership/buildPrivateDownloadUrl
    deleteCloudinaryAsset: vi.fn(),
    getCloudinaryConfig: vi.fn(() => ({ cloudName: "demo", apiKey: "key", apiSecret: "secret" })),
  };
});

import prisma from "~/db.server";
import { deleteCloudinaryAsset } from "~/lib/cloudinary-admin.server";
import {
  deleteOneBosImage,
  deleteOneBosDecision,
  deleteCustomerBosImages,
  listCustomerBosImages,
} from "./buy-or-skip-privacy.server";

const pendingUpsert = () => (prisma as any).pendingCloudinaryDeletion.upsert;

beforeEach(() => {
  vi.clearAllMocks();
  (deleteCloudinaryAsset as any).mockResolvedValue({ ok: true });
  pendingUpsert().mockResolvedValue({});
});

describe("deleteOneBosImage() — single-item image removal", () => {
  it("returns NOT_FOUND for a different customer's analysis — never resolves or touches another customer's photo", async () => {
    (prisma.buyOrSkipAnalysis.findFirst as any).mockResolvedValue(null); // the ownership-scoped query itself finds nothing
    const result = await deleteOneBosImage("analysis-1", "cust-A");
    expect(result).toEqual({ deleted: false, errorCode: "NOT_FOUND" });
    expect(prisma.buyOrSkipAnalysis.update).not.toHaveBeenCalled();
  });

  it("scopes the lookup to id AND customerId together — ownership is enforced at the query, not after", async () => {
    (prisma.buyOrSkipAnalysis.findFirst as any).mockResolvedValue({ id: "analysis-1", imagePublicId: "naia-wardrobe/cust-A/analysis-1" });
    await deleteOneBosImage("analysis-1", "cust-A");
    expect(prisma.buyOrSkipAnalysis.findFirst).toHaveBeenCalledWith({
      where: { id: "analysis-1", customerId: "cust-A" },
      select: { id: true, imagePublicId: true },
    });
  });

  it("deletes the Cloudinary asset when an imagePublicId exists", async () => {
    (prisma.buyOrSkipAnalysis.findFirst as any).mockResolvedValue({ id: "analysis-1", imagePublicId: "naia-wardrobe/cust-A/analysis-1" });
    await deleteOneBosImage("analysis-1", "cust-A");
    expect(deleteCloudinaryAsset).toHaveBeenCalledWith("naia-wardrobe/cust-A/analysis-1", "private");
  });

  it("clears exactly the three image fields — never verdict, reasoning, fullAnalysis, or outcome", async () => {
    (prisma.buyOrSkipAnalysis.findFirst as any).mockResolvedValue({ id: "analysis-1", imagePublicId: "naia-wardrobe/cust-A/analysis-1" });
    await deleteOneBosImage("analysis-1", "cust-A");
    expect(prisma.buyOrSkipAnalysis.update).toHaveBeenCalledWith({
      where: { id: "analysis-1" },
      data: { imagePublicId: null, imageFormat: null, imageUrl: null },
    });
  });

  it("still clears DB fields even when the analysis has no imagePublicId (legacy imageUrl-only record)", async () => {
    (prisma.buyOrSkipAnalysis.findFirst as any).mockResolvedValue({ id: "analysis-1", imagePublicId: null });
    const result = await deleteOneBosImage("analysis-1", "cust-A");
    expect(deleteCloudinaryAsset).not.toHaveBeenCalled();
    expect(prisma.buyOrSkipAnalysis.update).toHaveBeenCalledWith({
      where: { id: "analysis-1" },
      data: { imagePublicId: null, imageFormat: null, imageUrl: null },
    });
    expect(result).toEqual({ deleted: true });
  });

  it("clears DB fields even when the Cloudinary delete fails — the UI must never keep pointing at a dead asset", async () => {
    (prisma.buyOrSkipAnalysis.findFirst as any).mockResolvedValue({ id: "analysis-1", imagePublicId: "naia-wardrobe/cust-A/analysis-1" });
    (deleteCloudinaryAsset as any).mockResolvedValue({ ok: false });
    const result = await deleteOneBosImage("analysis-1", "cust-A");
    expect(prisma.buyOrSkipAnalysis.update).toHaveBeenCalled();
    expect(result).toEqual({ deleted: true });
  });
});

describe("deleteOneBosDecision() — My Decisions '×' full decision removal", () => {
  it("returns NOT_FOUND for a different customer's analysis — cross-customer deletion is rejected", async () => {
    (prisma.buyOrSkipAnalysis.findFirst as any).mockResolvedValue(null);
    const result = await deleteOneBosDecision("analysis-1", "cust-A");
    expect(result).toEqual({ deleted: false, errorCode: "NOT_FOUND" });
    expect(prisma.buyOrSkipAnalysis.delete).not.toHaveBeenCalled();
  });

  it("scopes the lookup to id AND customerId together — ownership enforced at the query, not after", async () => {
    (prisma.buyOrSkipAnalysis.findFirst as any).mockResolvedValue({ id: "analysis-1", imagePublicId: null });
    await deleteOneBosDecision("analysis-1", "cust-A");
    expect(prisma.buyOrSkipAnalysis.findFirst).toHaveBeenCalledWith({
      where: { id: "analysis-1", customerId: "cust-A" },
      select: { id: true, imagePublicId: true },
    });
  });

  it("deletes the entire record, not just the image fields", async () => {
    (prisma.buyOrSkipAnalysis.findFirst as any).mockResolvedValue({ id: "analysis-1", imagePublicId: null });
    await deleteOneBosDecision("analysis-1", "cust-A");
    expect(prisma.buyOrSkipAnalysis.delete).toHaveBeenCalledWith({ where: { id: "analysis-1" } });
    expect(prisma.buyOrSkipAnalysis.update).not.toHaveBeenCalled();
  });

  it("deletes the Cloudinary asset when an imagePublicId exists", async () => {
    (prisma.buyOrSkipAnalysis.findFirst as any).mockResolvedValue({ id: "analysis-1", imagePublicId: "naia-wardrobe/cust-A/analysis-1" });
    await deleteOneBosDecision("analysis-1", "cust-A");
    expect(deleteCloudinaryAsset).toHaveBeenCalledWith("naia-wardrobe/cust-A/analysis-1", "private");
  });

  it("deletes the record even when the analysis has no imagePublicId", async () => {
    (prisma.buyOrSkipAnalysis.findFirst as any).mockResolvedValue({ id: "analysis-1", imagePublicId: null });
    const result = await deleteOneBosDecision("analysis-1", "cust-A");
    expect(deleteCloudinaryAsset).not.toHaveBeenCalled();
    expect(result).toEqual({ deleted: true });
  });

  it("deletes the record even when the Cloudinary delete fails", async () => {
    (prisma.buyOrSkipAnalysis.findFirst as any).mockResolvedValue({ id: "analysis-1", imagePublicId: "naia-wardrobe/cust-A/analysis-1" });
    (deleteCloudinaryAsset as any).mockResolvedValue({ ok: false });
    const result = await deleteOneBosDecision("analysis-1", "cust-A");
    expect(prisma.buyOrSkipAnalysis.delete).toHaveBeenCalled();
    expect(result).toEqual({ deleted: true });
  });
});

describe("listCustomerBosImages() — Settings gallery read", () => {
  it("resolves a private-asset item's thumbnail through the same canonical pattern as the Buy or Skip result page", async () => {
    (prisma.buyOrSkipAnalysis.findMany as any).mockResolvedValue([
      { id: "analysis-1", productName: "Denim Jacket", imageUrl: null, imagePublicId: "naia-wardrobe/cust-A/analysis-1", imageFormat: "jpg" },
    ]);
    const result = await listCustomerBosImages("cust-A");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("analysis-1");
    expect(result[0].productName).toBe("Denim Jacket");
    expect(result[0].thumbnailUrl).toMatch(/^https:\/\/api\.cloudinary\.com\/v1_1\/demo\//);
  });

  it("falls back to the legacy public imageUrl when there is no private asset", async () => {
    (prisma.buyOrSkipAnalysis.findMany as any).mockResolvedValue([
      { id: "analysis-2", productName: null, imageUrl: "https://legacy.example.com/old.jpg", imagePublicId: null, imageFormat: null },
    ]);
    const result = await listCustomerBosImages("cust-A");
    expect(result[0].thumbnailUrl).toBe("https://legacy.example.com/old.jpg");
  });

  it("never resolves another customer's image even if a row's publicId collided — ownership is re-verified before building the URL", async () => {
    (prisma.buyOrSkipAnalysis.findMany as any).mockResolvedValue([
      { id: "analysis-1", productName: "Denim Jacket", imageUrl: null, imagePublicId: "naia-wardrobe/cust-OTHER/analysis-1", imageFormat: "jpg" },
    ]);
    const result = await listCustomerBosImages("cust-A");
    expect(result[0].thumbnailUrl).toBeNull();
  });
});

// ── H7 (2026-11-17): failed Buy-or-Skip image deletions are recorded ────────
//
// Nov 12 privacy audit finding H7. All three deletion helpers in this module
// clear or delete the DB image reference regardless of the Cloudinary
// outcome, so a dropped failure left the asset unreferenced with nothing
// recording that it still needed deleting — and the only net, the bounded
// orphan sweep, has no scheduled trigger (runBoundedSweep is reachable only
// from a human clicking /admin/maintenance).
//
// The subtlety pinned here: deleteCloudinaryAsset does NOT throw on a
// provider rejection, it returns { ok:false, errorCode }. A try/catch around
// the call would still have dropped the common case.
describe("H7 — failed Buy-or-Skip deletions are recorded for the retry sweep", () => {
  const PUBLIC_ID = "naia-wardrobe/cust-A/analysis-1";

  it("deleteOneBosImage records an unresolved row when the provider REJECTS (ok:false, no throw)", async () => {
    (prisma.buyOrSkipAnalysis.findFirst as any).mockResolvedValue({ id: "analysis-1", imagePublicId: PUBLIC_ID });
    (deleteCloudinaryAsset as any).mockResolvedValue({ ok: false, errorCode: "PROVIDER_ERROR" });

    await deleteOneBosImage("analysis-1", "cust-A");

    expect(pendingUpsert()).toHaveBeenCalledTimes(1);
    const arg = pendingUpsert().mock.calls[0][0];
    expect(arg.where).toEqual({ publicId: PUBLIC_ID });
    expect(arg.create.customerId).toBe("cust-A");
    expect(arg.create.deliveryType).toBe("private");
    expect(arg.create.lastError).toBe("PROVIDER_ERROR");
    expect(arg.create.resolvedAt).toBeUndefined();
  });

  it("deleteOneBosImage still clears the image fields and preserves the verdict after a failure", async () => {
    (prisma.buyOrSkipAnalysis.findFirst as any).mockResolvedValue({ id: "analysis-1", imagePublicId: PUBLIC_ID });
    (deleteCloudinaryAsset as any).mockResolvedValue({ ok: false, errorCode: "PROVIDER_ERROR" });

    const result = await deleteOneBosImage("analysis-1", "cust-A");

    expect(result).toEqual({ deleted: true });
    expect(prisma.buyOrSkipAnalysis.update).toHaveBeenCalledWith({
      where: { id: "analysis-1" },
      data: { imagePublicId: null, imageFormat: null, imageUrl: null },
    });
  });

  it("deleteOneBosImage records a THROWN deletion error too, without propagating it", async () => {
    (prisma.buyOrSkipAnalysis.findFirst as any).mockResolvedValue({ id: "analysis-1", imagePublicId: PUBLIC_ID });
    (deleteCloudinaryAsset as any).mockRejectedValue(new Error("socket hang up"));

    await expect(deleteOneBosImage("analysis-1", "cust-A")).resolves.toEqual({ deleted: true });
    expect(pendingUpsert().mock.calls[0][0].create.lastError).toBe("socket hang up");
  });

  it("deleteOneBosDecision records the failure and still deletes the decision row", async () => {
    (prisma.buyOrSkipAnalysis.findFirst as any).mockResolvedValue({ id: "analysis-1", imagePublicId: PUBLIC_ID });
    (deleteCloudinaryAsset as any).mockResolvedValue({ ok: false, errorCode: "PROVIDER_ERROR" });

    const result = await deleteOneBosDecision("analysis-1", "cust-A");

    expect(result).toEqual({ deleted: true });
    expect(prisma.buyOrSkipAnalysis.delete).toHaveBeenCalledWith({ where: { id: "analysis-1" } });
    expect(pendingUpsert()).toHaveBeenCalledTimes(1);
    expect(pendingUpsert().mock.calls[0][0].where).toEqual({ publicId: PUBLIC_ID });
  });

  it("records nothing on success, for either single-item helper", async () => {
    (prisma.buyOrSkipAnalysis.findFirst as any).mockResolvedValue({ id: "analysis-1", imagePublicId: PUBLIC_ID });

    await deleteOneBosImage("analysis-1", "cust-A");
    await deleteOneBosDecision("analysis-1", "cust-A");

    expect(pendingUpsert()).not.toHaveBeenCalled();
  });

  it("deleteCustomerBosImages records one row per failed asset and none for the ones that succeeded", async () => {
    (prisma.buyOrSkipAnalysis.findMany as any)
      .mockResolvedValueOnce([
        { id: "a1", imagePublicId: "naia-wardrobe/cust-A/a1" },
        { id: "a2", imagePublicId: "naia-wardrobe/cust-A/a2" },
      ])
      .mockResolvedValueOnce([]); // the legacy imageUrl-only query
    (deleteCloudinaryAsset as any)
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, errorCode: "RATE_LIMITED" });

    const result = await deleteCustomerBosImages("cust-A");

    expect(result.deletedCount).toBe(1);
    expect(result.failedAssets).toEqual(["naia-wardrobe/cust-A/a2"]);
    // Both rows still had their image references cleared.
    expect(result.clearedCount).toBe(2);
    expect(pendingUpsert()).toHaveBeenCalledTimes(1);
    expect(pendingUpsert().mock.calls[0][0].where).toEqual({ publicId: "naia-wardrobe/cust-A/a2" });
    expect(pendingUpsert().mock.calls[0][0].create.lastError).toBe("RATE_LIMITED");
  });

  it("deleteCustomerBosImages records the failure even though its own caller discards failedAssets", async () => {
    // settings.tsx:191 calls this as a bare `await deleteCustomerBosImages(id)`
    // and ignores the return value — which is exactly why recording happens
    // inside the loop rather than being left to the caller.
    (prisma.buyOrSkipAnalysis.findMany as any)
      .mockResolvedValueOnce([{ id: "a1", imagePublicId: "naia-wardrobe/cust-A/a1" }])
      .mockResolvedValueOnce([]);
    (deleteCloudinaryAsset as any).mockResolvedValue({ ok: false, errorCode: "PROVIDER_ERROR" });

    // Discard the result exactly as the real caller does.
    await deleteCustomerBosImages("cust-A");

    expect(pendingUpsert()).toHaveBeenCalledTimes(1);
  });

  it("does not throw when the recorder's own DB write fails", async () => {
    (prisma.buyOrSkipAnalysis.findFirst as any).mockResolvedValue({ id: "analysis-1", imagePublicId: PUBLIC_ID });
    (deleteCloudinaryAsset as any).mockResolvedValue({ ok: false, errorCode: "PROVIDER_ERROR" });
    pendingUpsert().mockRejectedValue(new Error("db down"));

    await expect(deleteOneBosImage("analysis-1", "cust-A")).resolves.toEqual({ deleted: true });
  });

  it("records a row the retry sweep can act on — publicId-keyed, concrete type, not the reserved VTO context", async () => {
    (prisma.buyOrSkipAnalysis.findFirst as any).mockResolvedValue({ id: "analysis-1", imagePublicId: PUBLIC_ID });
    (deleteCloudinaryAsset as any).mockResolvedValue({ ok: false, errorCode: "PROVIDER_ERROR" });

    await deleteOneBosImage("analysis-1", "cust-A");

    const arg = pendingUpsert().mock.calls[0][0];
    expect(arg.where).toEqual({ publicId: PUBLIC_ID });
    expect(arg.update.attemptCount).toEqual({ increment: 1 });
    expect(arg.create.deliveryType).toBe("private");
    expect(arg.create.context).not.toBe("vto-sweep-obligation");
  });

  it("never records for an analysis with no imagePublicId", async () => {
    (prisma.buyOrSkipAnalysis.findFirst as any).mockResolvedValue({ id: "analysis-1", imagePublicId: null });

    await deleteOneBosImage("analysis-1", "cust-A");

    expect(deleteCloudinaryAsset).not.toHaveBeenCalled();
    expect(pendingUpsert()).not.toHaveBeenCalled();
  });
});
