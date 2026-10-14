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

beforeEach(() => {
  vi.clearAllMocks();
  (deleteCloudinaryAsset as any).mockResolvedValue({ ok: true });
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
