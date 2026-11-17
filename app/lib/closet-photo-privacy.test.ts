// app/lib/closet-photo-privacy.test.ts
//
// Image-only Closet deletion — the "My Closet Photos" privacy control.
// Distinct from deleteClosetItemWithImage (closet-item-deletion.server.ts),
// which removes the whole garment. These tests prove image-only removal
// genuinely leaves the garment record, other photos, and ownership
// boundaries intact — the exact guarantees requested for this feature.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/db.server", () => ({
  default: {
    closetItem: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
    // H7 (2026-11-17) — a failed Cloudinary deletion is now recorded here
    // instead of being discarded.
    pendingCloudinaryDeletion: { upsert: vi.fn().mockResolvedValue({}) },
  },
}));

vi.mock("~/lib/cloudinary-admin.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/cloudinary-admin.server")>();
  return {
    ...actual, // keep the real validatePublicIdOwnership/buildPrivateDownloadUrl — resolveItemImage needs them
    deleteCloudinaryAsset: vi.fn(),
    getCloudinaryConfig: vi.fn(() => ({ cloudName: "demo", apiKey: "key", apiSecret: "secret" })),
  };
});

import prisma from "~/db.server";
import { deleteCloudinaryAsset } from "~/lib/cloudinary-admin.server";
import {
  deleteClosetItemPhoto,
  deleteAllClosetPhotos,
  listCustomerClosetPhotos,
  customerHasClosetPhotos,
} from "./closet-photo-privacy.server";

const pendingUpsert = () => (prisma as any).pendingCloudinaryDeletion.upsert;

beforeEach(() => {
  vi.clearAllMocks();
  (deleteCloudinaryAsset as any).mockResolvedValue({ ok: true });
  pendingUpsert().mockResolvedValue({});
});

describe("deleteClosetItemPhoto() — single-item image removal", () => {
  it("returns NOT_FOUND for a different customer's item — never resolves or touches another customer's photo", async () => {
    (prisma.closetItem.findFirst as any).mockResolvedValue(null); // the ownership-scoped query itself finds nothing
    const result = await deleteClosetItemPhoto("item-1", "cust-A");
    expect(result).toEqual({ deleted: false, errorCode: "NOT_FOUND" });
    expect(prisma.closetItem.update).not.toHaveBeenCalled();
  });

  it("scopes the lookup to id AND customerId together — ownership is enforced at the query, not after", async () => {
    (prisma.closetItem.findFirst as any).mockResolvedValue({ id: "item-1", imagePublicId: "naia-wardrobe/cust-A/item-1" });
    await deleteClosetItemPhoto("item-1", "cust-A");
    expect(prisma.closetItem.findFirst).toHaveBeenCalledWith({
      where: { id: "item-1", customerId: "cust-A" },
      select: { id: true, imagePublicId: true },
    });
  });

  it("deletes the Cloudinary asset when an imagePublicId exists", async () => {
    (prisma.closetItem.findFirst as any).mockResolvedValue({ id: "item-1", imagePublicId: "naia-wardrobe/cust-A/item-1" });
    await deleteClosetItemPhoto("item-1", "cust-A");
    expect(deleteCloudinaryAsset).toHaveBeenCalledWith("naia-wardrobe/cust-A/item-1", "private");
  });

  it("clears exactly the four image fields — never the garment's other fields", async () => {
    (prisma.closetItem.findFirst as any).mockResolvedValue({ id: "item-1", imagePublicId: "naia-wardrobe/cust-A/item-1" });
    await deleteClosetItemPhoto("item-1", "cust-A");
    expect(prisma.closetItem.update).toHaveBeenCalledWith({
      where: { id: "item-1" },
      data: { imagePublicId: null, imageFormat: null, imageUrl: null, thumbnailUrl: null },
    });
  });

  it("still clears DB fields even when the item has no imagePublicId (legacy imageUrl-only record)", async () => {
    (prisma.closetItem.findFirst as any).mockResolvedValue({ id: "item-1", imagePublicId: null });
    const result = await deleteClosetItemPhoto("item-1", "cust-A");
    expect(deleteCloudinaryAsset).not.toHaveBeenCalled();
    expect(prisma.closetItem.update).toHaveBeenCalledWith({
      where: { id: "item-1" },
      data: { imagePublicId: null, imageFormat: null, imageUrl: null, thumbnailUrl: null },
    });
    expect(result).toEqual({ deleted: true });
  });

  it("clears DB fields even when the Cloudinary delete fails — the UI must never keep pointing at a dead asset", async () => {
    (prisma.closetItem.findFirst as any).mockResolvedValue({ id: "item-1", imagePublicId: "naia-wardrobe/cust-A/item-1" });
    (deleteCloudinaryAsset as any).mockResolvedValue({ ok: false });
    const result = await deleteClosetItemPhoto("item-1", "cust-A");
    expect(prisma.closetItem.update).toHaveBeenCalled();
    expect(result).toEqual({ deleted: true });
  });
});

describe("deleteAllClosetPhotos() — bulk image removal", () => {
  it("only queries items that actually have an image", async () => {
    (prisma.closetItem.findMany as any).mockResolvedValue([]);
    await deleteAllClosetPhotos("cust-A");
    expect(prisma.closetItem.findMany).toHaveBeenCalledWith({
      where: { customerId: "cust-A", OR: [{ imagePublicId: { not: null } }, { imageUrl: { not: null } }] },
      select: { id: true, imagePublicId: true },
    });
  });

  it("deletes every Cloudinary asset found and clears all matched rows in one updateMany — other customers' items are never touched by construction (query is customerId-scoped)", async () => {
    (prisma.closetItem.findMany as any).mockResolvedValue([
      { id: "item-1", imagePublicId: "naia-wardrobe/cust-A/item-1" },
      { id: "item-2", imagePublicId: "naia-wardrobe/cust-A/item-2" },
      { id: "item-3", imagePublicId: null }, // legacy imageUrl-only, no Cloudinary asset to delete
    ]);
    const result = await deleteAllClosetPhotos("cust-A");
    expect(deleteCloudinaryAsset).toHaveBeenCalledTimes(2);
    expect(prisma.closetItem.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["item-1", "item-2", "item-3"] } },
      data: { imagePublicId: null, imageFormat: null, imageUrl: null, thumbnailUrl: null },
    });
    expect(result).toEqual({ deletedCount: 2, clearedCount: 3, failedAssets: [] });
  });

  it("tracks failed Cloudinary deletions without blocking the DB clear", async () => {
    (prisma.closetItem.findMany as any).mockResolvedValue([{ id: "item-1", imagePublicId: "naia-wardrobe/cust-A/item-1" }]);
    (deleteCloudinaryAsset as any).mockResolvedValue({ ok: false });
    const result = await deleteAllClosetPhotos("cust-A");
    expect(result.failedAssets).toEqual(["naia-wardrobe/cust-A/item-1"]);
    expect(prisma.closetItem.updateMany).toHaveBeenCalled();
  });

  it("does nothing when the customer has no photographed items — no empty updateMany call", async () => {
    (prisma.closetItem.findMany as any).mockResolvedValue([]);
    const result = await deleteAllClosetPhotos("cust-A");
    expect(prisma.closetItem.updateMany).not.toHaveBeenCalled();
    expect(result).toEqual({ deletedCount: 0, clearedCount: 0, failedAssets: [] });
  });
});

describe("listCustomerClosetPhotos() — Settings gallery read", () => {
  it("resolves each item's thumbnail through the same canonical resolver used elsewhere, scoped to this customer", async () => {
    (prisma.closetItem.findMany as any).mockResolvedValue([
      { id: "item-1", name: "Blazer", imageUrl: null, imagePublicId: "naia-wardrobe/cust-A/item-1", imageFormat: "jpg" },
    ]);
    const result = await listCustomerClosetPhotos("cust-A");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("item-1");
    expect(result[0].name).toBe("Blazer");
    expect(result[0].thumbnailUrl).toMatch(/^https:\/\/api\.cloudinary\.com\/v1_1\/demo\//);
  });

  it("never resolves another customer's closet item even if ids collided — ownership-aware resolver, not a blind URL build", async () => {
    (prisma.closetItem.findMany as any).mockResolvedValue([
      { id: "item-1", name: "Blazer", imageUrl: null, imagePublicId: "naia-wardrobe/cust-OTHER/item-1", imageFormat: "jpg" },
    ]);
    const result = await listCustomerClosetPhotos("cust-A");
    // resolveItemImage's ownership check rejects a publicId not prefixed for cust-A,
    // and there's no legacy imageUrl to fall back to — so this resolves to null.
    expect(result[0].thumbnailUrl).toBeNull();
  });
});

describe("customerHasClosetPhotos()", () => {
  it("is true when at least one item has an image reference", async () => {
    (prisma.closetItem.count as any).mockResolvedValue(3);
    expect(await customerHasClosetPhotos("cust-A")).toBe(true);
  });

  it("is false when no items have an image reference", async () => {
    (prisma.closetItem.count as any).mockResolvedValue(0);
    expect(await customerHasClosetPhotos("cust-A")).toBe(false);
  });
});

// ── H7 (2026-11-17): a failed Cloudinary deletion is durably recorded ────────
//
// Nov 12 privacy audit finding H7. These two functions ARE the customer's
// "delete my closet photo" privacy control, so the stakes of a dropped
// failure are specific: the DB image fields are cleared either way, so the
// UI reports the photo as gone while the asset may still be in storage, with
// nothing anywhere recording that it still needs deleting.
//
// The key subtlety these tests pin: deleteCloudinaryAsset does NOT throw when
// the provider rejects the call — it returns { ok:false, errorCode }. A
// try/catch around the call would still have dropped this, the common case.
describe("H7 — failed closet-photo deletions are recorded for the retry sweep", () => {
  const PUBLIC_ID = "naia-wardrobe/cust-A/item-1";

  it("deleteClosetItemPhoto records an unresolved row when the provider REJECTS (ok:false, no throw)", async () => {
    (prisma.closetItem.findFirst as any).mockResolvedValue({ id: "item-1", imagePublicId: PUBLIC_ID });
    (deleteCloudinaryAsset as any).mockResolvedValue({ ok: false, errorCode: "PROVIDER_ERROR" });

    await deleteClosetItemPhoto("item-1", "cust-A");

    expect(pendingUpsert()).toHaveBeenCalledTimes(1);
    const arg = pendingUpsert().mock.calls[0][0];
    expect(arg.where).toEqual({ publicId: PUBLIC_ID });
    expect(arg.create.customerId).toBe("cust-A");
    expect(arg.create.publicId).toBe(PUBLIC_ID);
    expect(arg.create.deliveryType).toBe("private");
    expect(arg.create.lastError).toBe("PROVIDER_ERROR");
    expect(arg.create.resolvedAt).toBeUndefined();
  });

  it("deleteClosetItemPhoto still clears the DB image fields after recording — the customer's UI is never left broken", async () => {
    (prisma.closetItem.findFirst as any).mockResolvedValue({ id: "item-1", imagePublicId: PUBLIC_ID });
    (deleteCloudinaryAsset as any).mockResolvedValue({ ok: false, errorCode: "PROVIDER_ERROR" });

    const result = await deleteClosetItemPhoto("item-1", "cust-A");

    expect(result).toEqual({ deleted: true });
    expect(prisma.closetItem.update).toHaveBeenCalledWith({
      where: { id: "item-1" },
      data: { imagePublicId: null, imageFormat: null, imageUrl: null, thumbnailUrl: null },
    });
  });

  it("deleteClosetItemPhoto records a THROWN deletion error too, and does not propagate it", async () => {
    (prisma.closetItem.findFirst as any).mockResolvedValue({ id: "item-1", imagePublicId: PUBLIC_ID });
    (deleteCloudinaryAsset as any).mockRejectedValue(new Error("socket hang up"));

    await expect(deleteClosetItemPhoto("item-1", "cust-A")).resolves.toEqual({ deleted: true });
    expect(pendingUpsert()).toHaveBeenCalledTimes(1);
    expect(pendingUpsert().mock.calls[0][0].create.lastError).toBe("socket hang up");
  });

  it("records nothing when the deletion succeeds", async () => {
    (prisma.closetItem.findFirst as any).mockResolvedValue({ id: "item-1", imagePublicId: PUBLIC_ID });
    await deleteClosetItemPhoto("item-1", "cust-A");
    expect(pendingUpsert()).not.toHaveBeenCalled();
  });

  it("deleteAllClosetPhotos records one row per failed asset and none for the ones that succeeded", async () => {
    (prisma.closetItem.findMany as any).mockResolvedValue([
      { id: "i1", imagePublicId: "naia-wardrobe/cust-A/i1" },
      { id: "i2", imagePublicId: "naia-wardrobe/cust-A/i2" },
      { id: "i3", imagePublicId: "naia-wardrobe/cust-A/i3" },
    ]);
    (deleteCloudinaryAsset as any)
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, errorCode: "PROVIDER_ERROR" })
      .mockResolvedValueOnce({ ok: false, errorCode: "RATE_LIMITED" });

    const result = await deleteAllClosetPhotos("cust-A");

    expect(result.deletedCount).toBe(1);
    expect(result.failedAssets).toEqual(["naia-wardrobe/cust-A/i2", "naia-wardrobe/cust-A/i3"]);
    expect(pendingUpsert()).toHaveBeenCalledTimes(2);
    const recorded = pendingUpsert().mock.calls.map((c: any[]) => c[0].where.publicId);
    expect(recorded).toEqual(["naia-wardrobe/cust-A/i2", "naia-wardrobe/cust-A/i3"]);
  });

  it("deleteAllClosetPhotos records each failure independently — one asset's failure never stops the rest", async () => {
    (prisma.closetItem.findMany as any).mockResolvedValue([
      { id: "i1", imagePublicId: "naia-wardrobe/cust-A/i1" },
      { id: "i2", imagePublicId: "naia-wardrobe/cust-A/i2" },
    ]);
    (deleteCloudinaryAsset as any).mockResolvedValue({ ok: false, errorCode: "PROVIDER_ERROR" });

    const result = await deleteAllClosetPhotos("cust-A");

    // Every row still gets its DB reference cleared, and both failures recorded.
    expect(result.clearedCount).toBe(2);
    expect(pendingUpsert()).toHaveBeenCalledTimes(2);
    expect(prisma.closetItem.updateMany).toHaveBeenCalled();
  });

  it("deleteAllClosetPhotos recording survives the recorder's own DB write failing", async () => {
    // The recorder swallows its own errors by design: a bookkeeping failure
    // must not turn the customer's privacy deletion into a 500.
    (prisma.closetItem.findMany as any).mockResolvedValue([
      { id: "i1", imagePublicId: "naia-wardrobe/cust-A/i1" },
    ]);
    (deleteCloudinaryAsset as any).mockResolvedValue({ ok: false, errorCode: "PROVIDER_ERROR" });
    pendingUpsert().mockRejectedValue(new Error("db down"));

    await expect(deleteAllClosetPhotos("cust-A")).resolves.toMatchObject({ clearedCount: 1 });
  });

  it("the recorded row is retry-sweep compatible — keyed on publicId, with a real delivery type, not the reserved VTO context", async () => {
    (prisma.closetItem.findFirst as any).mockResolvedValue({ id: "item-1", imagePublicId: PUBLIC_ID });
    (deleteCloudinaryAsset as any).mockResolvedValue({ ok: false, errorCode: "PROVIDER_ERROR" });

    await deleteClosetItemPhoto("item-1", "cust-A");

    const arg = pendingUpsert().mock.calls[0][0];
    // publicId is @unique, so repeat failures bump attemptCount rather than
    // stacking duplicate rows.
    expect(arg.where).toEqual({ publicId: PUBLIC_ID });
    expect(arg.update.attemptCount).toEqual({ increment: 1 });
    // A concrete type, so retryPendingCloudinaryDeletion never has to probe
    // the Admin API to re-resolve "unknown".
    expect(arg.create.deliveryType).toBe("private");
    // "vto-sweep-obligation" routes to a different retry handler entirely.
    expect(arg.create.context).not.toBe("vto-sweep-obligation");
  });
});
