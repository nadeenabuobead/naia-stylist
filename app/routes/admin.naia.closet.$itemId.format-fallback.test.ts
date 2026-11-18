// app/routes/admin.naia.closet.$itemId.format-fallback.test.ts
//
// QA #36 sweep #2 — this loader used to default a missing/null
// ClosetItem.imageFormat to "jpg" instead of falling back to
// thumbnailUrl (the pattern already used for every other failure
// branch here: !cfg, catch). Requesting the wrong format from
// Cloudinary's authenticated /image/download endpoint forces a real,
// cached format conversion. Only the loader's garmentImageUrl branch is
// under test here — every other dependency is stubbed to a minimal
// valid value.
//
// Run: npx vitest run app/routes/admin.naia.closet.\$itemId.format-fallback.test.ts

import { describe, it, expect, vi } from "vitest";

vi.mock("~/lib/internal-auth.server", () => ({
  requireAdminSession: vi.fn().mockResolvedValue({ identity: { email: "admin@test" } }),
}));

const {
  getClosetItemDetail,
  getNextUnreviewedItemId,
  getAdjacentItemIds,
  getCustomerStylingPassport,
} = vi.hoisted(() => ({
  getClosetItemDetail: vi.fn(),
  getNextUnreviewedItemId: vi.fn().mockResolvedValue(null),
  getAdjacentItemIds: vi.fn().mockResolvedValue({ prevId: null, nextId: null }),
  getCustomerStylingPassport: vi.fn().mockResolvedValue(null),
}));
vi.mock("~/lib/admin/closet-intelligence.server", () => ({
  getClosetItemDetail,
  getNextUnreviewedItemId,
  getAdjacentItemIds,
  getCustomerStylingPassport,
}));

vi.mock("~/lib/admin/garment-semantics.server", () => ({
  interpretGarment: vi.fn(() => ({})),
}));

vi.mock("~/lib/admin/closet-review.server", () => ({
  getEffectiveClosetItem: vi.fn((classification: unknown) => classification),
  validateOverrides: vi.fn(),
  saveAdminReview: vi.fn(),
  markItemReviewed: vi.fn(),
  revertOverrideField: vi.fn(),
  getItemClassification: vi.fn(),
  setVocabGapFlag: vi.fn(),
  clearVocabGapFlag: vi.fn(),
  saveIntelligenceOverrides: vi.fn(),
  revertIntelligenceField: vi.fn(),
}));

vi.mock("~/lib/cloudinary-admin.server", () => ({
  buildPrivateDownloadUrl: vi.fn(() => "https://signed.example/real-url"),
  getCloudinaryConfig: vi.fn(() => ({ cloudName: "test-cloud", apiKey: "k", apiSecret: "s" })),
}));

vi.mock("~/lib/admin/styleme-garment-profile.server", () => ({
  getStyleMeProfile: vi.fn().mockResolvedValue(null),
  saveStyleMeProfile: vi.fn(),
  StyleMeProfileValidationError: class extends Error {},
}));

vi.mock("~/lib/admin/garment-intelligence-v1.server", () => ({
  deriveGarmentStylingIntelligence: vi.fn(() => ({})),
}));

import { loader } from "./admin.naia.closet.$itemId";
import { buildPrivateDownloadUrl } from "~/lib/cloudinary-admin.server";

function baseItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "item-1",
    customerId: "cust-1",
    category: "top",
    classification: {},
    adminReview: null,
    imagePublicId: "naia-wardrobe/cust-1/item-1",
    imageFormat: "png",
    thumbnailUrl: "https://res.cloudinary.com/test/legacy-thumb.jpg",
    ...overrides,
  };
}

describe("admin.naia.closet.$itemId loader — garmentImageUrl format fallback", () => {
  it("a null imageFormat never guesses \"jpg\" — falls back to thumbnailUrl instead, buildPrivateDownloadUrl never called", async () => {
    getClosetItemDetail.mockResolvedValueOnce(baseItem({ imageFormat: null }));

    const res: any = await loader({
      request: new Request("https://x/admin/naia/closet/item-1"),
      params: { itemId: "item-1" },
    } as any);
    const json = res.json ? await res.json() : res;

    expect(json.garmentImageUrl).toBe("https://res.cloudinary.com/test/legacy-thumb.jpg");
    expect(buildPrivateDownloadUrl).not.toHaveBeenCalled();
  });

  it("a present imageFormat is used verbatim via buildPrivateDownloadUrl — unaffected by the fix", async () => {
    getClosetItemDetail.mockResolvedValueOnce(baseItem({ imageFormat: "png" }));

    const res: any = await loader({
      request: new Request("https://x/admin/naia/closet/item-1"),
      params: { itemId: "item-1" },
    } as any);
    const json = res.json ? await res.json() : res;

    expect(json.garmentImageUrl).toBe("https://signed.example/real-url");
    expect(buildPrivateDownloadUrl).toHaveBeenCalledWith(
      expect.anything(),
      "naia-wardrobe/cust-1/item-1",
      "png",
      "private",
    );
  });
});
