// app/routes/app.naia-admin.closet.$itemId.format-fallback.test.ts
//
// QA #36 sweep #2 — this loader used to default a missing/null
// ClosetItem.imageFormat to "jpg" instead of falling back to
// thumbnailUrl (the pattern already used for every other failure
// branch here: !cfg, catch). Requesting the wrong format from
// Cloudinary's authenticated /image/download endpoint forces a real,
// cached format conversion.
//
// Run: npx vitest run app/routes/app.naia-admin.closet.\$itemId.format-fallback.test.ts

import { describe, it, expect, vi } from "vitest";

vi.mock("~/lib/naia-admin-auth.server", () => ({
  requireNaiaAdminAccess: vi.fn().mockResolvedValue({ ok: true }),
}));

const { getClosetItemDetail } = vi.hoisted(() => ({ getClosetItemDetail: vi.fn() }));
vi.mock("~/lib/admin/closet-intelligence.server", () => ({ getClosetItemDetail }));

vi.mock("~/lib/cloudinary-admin.server", () => ({
  buildPrivateDownloadUrl: vi.fn(() => "https://signed.example/real-url"),
  getCloudinaryConfig: vi.fn(() => ({ cloudName: "test-cloud", apiKey: "k", apiSecret: "s" })),
}));

import { loader } from "./app.naia-admin.closet.$itemId";
import { buildPrivateDownloadUrl } from "~/lib/cloudinary-admin.server";

function baseItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "item-1",
    imagePublicId: "naia-wardrobe/cust-1/item-1",
    imageFormat: "png",
    thumbnailUrl: "https://res.cloudinary.com/test/legacy-thumb.jpg",
    ...overrides,
  };
}

describe("app.naia-admin.closet.$itemId loader — garmentImageUrl format fallback", () => {
  it("a null imageFormat never guesses \"jpg\" — falls back to thumbnailUrl instead, buildPrivateDownloadUrl never called", async () => {
    getClosetItemDetail.mockResolvedValueOnce(baseItem({ imageFormat: null }));

    const res = await loader({ request: new Request("https://x/app/naia-admin/closet/item-1"), params: { itemId: "item-1" } } as any);
    const json = await (res as Response).json();

    expect(json.garmentImageUrl).toBe("https://res.cloudinary.com/test/legacy-thumb.jpg");
    expect(buildPrivateDownloadUrl).not.toHaveBeenCalled();
  });

  it("a present imageFormat is used verbatim via buildPrivateDownloadUrl — unaffected by the fix", async () => {
    getClosetItemDetail.mockResolvedValueOnce(baseItem({ imageFormat: "png" }));

    const res = await loader({ request: new Request("https://x/app/naia-admin/closet/item-1"), params: { itemId: "item-1" } } as any);
    const json = await (res as Response).json();

    expect(json.garmentImageUrl).toBe("https://signed.example/real-url");
    expect(buildPrivateDownloadUrl).toHaveBeenCalledWith(
      expect.anything(),
      "naia-wardrobe/cust-1/item-1",
      "png",
      "private",
    );
  });
});
