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
      delete: vi.fn(),
    },
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
import { deleteOneBosImage, deleteOneBosDecision, listCustomerBosImages } from "./buy-or-skip-privacy.server";

beforeEach(() => {
  vi.clearAllMocks();
  (deleteCloudinaryAsset as any).mockResolvedValue({ ok: true });
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
