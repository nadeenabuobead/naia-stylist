// app/lib/trend-evidence-shopper-image-priority.test.ts
//
// 2026-11-18 — QA #36 follow-up. getShopperEvidence's per-closet-item image
// resolution used to try the legacy, permanent, unsigned-fetchable
// `imageUrl` field BEFORE the signed, time-limited `imagePublicId`/
// `imageFormat` pair — inverted from every other image-resolution site in
// this codebase (look-image-resolution.server.ts's resolveItemImage,
// customer-360.server.ts, closet._index.tsx, buyskip-admin.server.ts, all of
// which try signed first). A closet item with BOTH fields populated was
// therefore served its permanent public URL even though a stronger signed
// one was available. This file proves the fixed priority order and that the
// legacy fallback is still ownership-checked when it IS used.
//
// Run: npx vitest run app/lib/trend-evidence-shopper-image-priority.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/db.server", () => ({
  default: {
    customer: { findUnique: vi.fn() },
  },
}));

vi.mock("~/lib/cloudinary-admin.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/cloudinary-admin.server")>();
  return {
    ...actual, // keep the real buildPrivateDownloadUrl/validateImageUrlOwnership
    getCloudinaryConfig: vi.fn(() => ({ cloudName: "demo", apiKey: "key", apiSecret: "secret" })),
  };
});

import prisma from "~/db.server";
import { getShopperEvidence } from "./trend-evidence.server";

function customerWith(closetItem: Record<string, unknown>) {
  return {
    onboardingProfile: null,
    closetItems: [{
      id: "item-1",
      name: "Blazer",
      imageUrl: null,
      imagePublicId: null,
      imageFormat: null,
      category: "TOPS",
      subcategory: null,
      primaryColor: null,
      styleTags: [],
      occasions: [],
      material: null,
      silhouette: null,
      fitProfile: null,
      formality: null,
      pattern: null,
      colors: [],
      ...closetItem,
    }],
    postOutfitReviews: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getShopperEvidence — closet item image priority order", () => {
  it("prefers the signed private-delivery URL over the legacy imageUrl when both fields are populated", async () => {
    (prisma.customer.findUnique as any).mockResolvedValue(
      customerWith({
        imageUrl: "https://legacy.example.com/old.jpg",
        imagePublicId: "naia-wardrobe/cust-A/item-1",
        imageFormat: "jpg",
      }),
    );

    const result = await getShopperEvidence("cust-A");
    const resolved = result.closetItems[0].imageUrl!;

    expect(resolved).toContain("https://api.cloudinary.com/v1_1/demo/image/download?");
    expect(resolved).not.toBe("https://legacy.example.com/old.jpg");
  });

  it("falls back to the ownership-checked legacy imageUrl when no signed fields are present", async () => {
    (prisma.customer.findUnique as any).mockResolvedValue(
      customerWith({ imageUrl: "https://legacy.example.com/old.jpg" }),
    );

    const result = await getShopperEvidence("cust-A");
    expect(result.closetItems[0].imageUrl).toBe("https://legacy.example.com/old.jpg");
  });

  it("rejects a legacy imageUrl naming a DIFFERENT customer's naia-wardrobe folder, even with no signed fields", async () => {
    (prisma.customer.findUnique as any).mockResolvedValue(
      customerWith({
        imageUrl: "https://res.cloudinary.com/demo/image/upload/naia-wardrobe/cust-B/item-1.jpg",
      }),
    );

    const result = await getShopperEvidence("cust-A");
    expect(result.closetItems[0].imageUrl).toBeNull();
  });

  it("returns null when neither a signed nor a legacy image reference exists", async () => {
    (prisma.customer.findUnique as any).mockResolvedValue(customerWith({}));
    const result = await getShopperEvidence("cust-A");
    expect(result.closetItems[0].imageUrl).toBeNull();
  });
});
