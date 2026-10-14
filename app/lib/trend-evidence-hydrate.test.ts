// app/lib/trend-evidence-hydrate.test.ts
//
// hydrateShopperEditImages — Trend Edit's read-time image re-resolution.
//
// getShopperEvidence/buildShopperEdit bake a private Closet image into a
// signed URL that expires 10 minutes after generation (buildPrivateDownloadUrl).
// That baked URL then gets frozen into the persisted TrendEditSnapshot, so any
// later read (a repeat customer view this period, or Admin's historical
// detail view) was rendering a dead link. hydrateShopperEditImages re-resolves
// a fresh URL from the stored closetItemId at read time, without ever
// rewriting the snapshot itself.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/db.server", () => ({
  default: {
    closetItem: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("~/lib/cloudinary-admin.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/cloudinary-admin.server")>();
  return {
    ...actual, // keep the real buildPrivateDownloadUrl/validatePublicIdOwnership
    getCloudinaryConfig: vi.fn(() => ({ cloudName: "demo", apiKey: "key", apiSecret: "secret" })),
  };
});

import prisma from "~/db.server";
import { hydrateShopperEditImages, type ShopperEdit, type EvidenceClosetItem } from "./trend-evidence.server";

function item(overrides: Partial<EvidenceClosetItem> = {}): EvidenceClosetItem {
  return {
    name: "Tailored Blazer",
    imageUrl: "https://api.cloudinary.com/v1_1/demo/image/download?stale=1",
    closetItemId: "item-1",
    category: "TOPS",
    roleNote: "your structured anchor",
    ...overrides,
  };
}

function edit(overrides: Partial<ShopperEdit> = {}): ShopperEdit {
  return {
    subTitle: "Sub",
    yourVersion: "Your version",
    evidenceStyleDna: null,
    evidencePassportSays: null,
    evidenceClosetItems: [],
    evidenceReviews: null,
    lowDataNotice: null,
    yourBestRouteIn: "Route",
    routeInItems: [],
    aLookToTry: "Look",
    lookToTryItems: [],
    theBalanceToProtect: "Balance",
    partToTake: ["Take A"],
    worthInvestingStatement: null,
    coveredClosetCategories: [],
    partToLeave: ["Leave A"],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("hydrateShopperEditImages()", () => {
  it("re-resolves a fresh private-download URL for a Closet item that still exists — 'Your Closet Shows'", async () => {
    (prisma.closetItem.findMany as any).mockResolvedValue([
      { id: "item-1", imageUrl: null, imagePublicId: "naia-wardrobe/cust-A/item-1", imageFormat: "jpg" },
    ]);

    const result = await hydrateShopperEditImages(
      edit({ evidenceClosetItems: [item()] }),
      "cust-A",
    );

    expect(prisma.closetItem.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["item-1"] }, customerId: "cust-A" },
      select: { id: true, imageUrl: true, imagePublicId: true, imageFormat: true },
    });
    const resolved = result.evidenceClosetItems[0].imageUrl!;
    expect(resolved).toContain("https://api.cloudinary.com/v1_1/demo/image/download?");
    expect(resolved).toContain("naia-wardrobe%2Fcust-A%2Fitem-1");
    // A freshly-built URL, not the stale one that was persisted.
    expect(resolved).not.toContain("stale=1");
  });

  it("re-resolves 'Already Yours' images independently in both routeInItems and lookToTryItems", async () => {
    (prisma.closetItem.findMany as any).mockResolvedValue([
      { id: "item-1", imageUrl: null, imagePublicId: "naia-wardrobe/cust-A/item-1", imageFormat: "jpg" },
      { id: "item-2", imageUrl: null, imagePublicId: "naia-wardrobe/cust-A/item-2", imageFormat: "png" },
    ]);

    const result = await hydrateShopperEditImages(
      edit({
        routeInItems: [item({ closetItemId: "item-1", name: "Blazer" })],
        lookToTryItems: [item({ closetItemId: "item-2", name: "Trouser" })],
      }),
      "cust-A",
    );

    expect(result.routeInItems[0].imageUrl).toContain("naia-wardrobe%2Fcust-A%2Fitem-1");
    expect(result.lookToTryItems[0].imageUrl).toContain("naia-wardrobe%2Fcust-A%2Fitem-2");
  });

  it("gives an intentional null fallback (no broken image) when the Closet item was deleted since generation", async () => {
    (prisma.closetItem.findMany as any).mockResolvedValue([]); // item no longer exists

    const result = await hydrateShopperEditImages(
      edit({ evidenceClosetItems: [item()] }),
      "cust-A",
    );

    expect(result.evidenceClosetItems[0].imageUrl).toBeNull();
    // Name and role note — the rest of the evidence — are untouched.
    expect(result.evidenceClosetItems[0].name).toBe("Tailored Blazer");
    expect(result.evidenceClosetItems[0].roleNote).toBe("your structured anchor");
  });

  it("never resolves another customer's photo — ownership is enforced by the scoped query and by resolveItemImage", async () => {
    // Even if a row somehow came back with a publicId under a different
    // customer's prefix, validatePublicIdOwnership inside resolveItemImage
    // refuses it and falls back to null rather than leaking it.
    (prisma.closetItem.findMany as any).mockResolvedValue([
      { id: "item-1", imageUrl: null, imagePublicId: "naia-wardrobe/someone-else/item-1", imageFormat: "jpg" },
    ]);

    const result = await hydrateShopperEditImages(
      edit({ evidenceClosetItems: [item()] }),
      "cust-A",
    );

    expect(result.evidenceClosetItems[0].imageUrl).toBeNull();
  });

  it("leaves a legacy snapshot item with no closetItemId completely untouched — never rewrites historical snapshot truth", async () => {
    const legacyItem = item({ closetItemId: null, imageUrl: "https://legacy.example.com/old.jpg" });

    const result = await hydrateShopperEditImages(edit({ evidenceClosetItems: [legacyItem] }), "cust-A");

    expect(result.evidenceClosetItems[0]).toEqual(legacyItem);
    expect(prisma.closetItem.findMany).not.toHaveBeenCalled();
  });

  it("is a no-op (skips the DB entirely) when no item carries a closetItemId", async () => {
    const original = edit({ evidenceClosetItems: [], routeInItems: [], lookToTryItems: [] });
    const result = await hydrateShopperEditImages(original, "cust-A");
    expect(result).toEqual(original);
    expect(prisma.closetItem.findMany).not.toHaveBeenCalled();
  });
});
