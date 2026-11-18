// app/lib/styleme/look-image-resolution.test.ts
//
// The canonical, shared garment-image resolver (Overview's Latest StyleMe
// cards, the StyleMe history/looks gallery, and — as of the anchor-image
// fix — the StyleMe result/detail page's anchor-piece hydration all route
// through this). Root-cause context: a historical StyleMe anchor's image
// was baked into moodDescription metadata at generation time as a
// Cloudinary private signed URL (buildPrivateDownloadUrl, 10-minute
// expiry) — any session viewed after that window showed a native broken
// <img>. The fix re-resolves the anchor image at read time through this
// exact resolver instead of trusting the stale persisted URL.
//
// Run: node --test --import tsx/esm app/lib/styleme/look-image-resolution.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { resolveItemImage, resolveCollageImages, MAX_COLLAGE_IMAGES } from "./look-image-resolution.server.ts";

const RESULT_ROUTE_PATH = resolve(import.meta.dirname, "../../routes/style-me/result.tsx");
const resultSrc = readFileSync(RESULT_ROUTE_PATH, "utf-8");

const CUSTOMER_ID = "cust-1";
const OTHER_CUSTOMER_ID = "cust-2";
const CONFIG = { cloudName: "demo", apiKey: "key", apiSecret: "secret" };

describe("resolveItemImage() — canonical garment-image resolution", () => {
  it("prefers a fresh private signed URL when imagePublicId+imageFormat+cloudinaryConfig are all present and owned by this customer", () => {
    const url = resolveItemImage(
      {
        closetItemId: "ci-1",
        productImageUrl: "https://stale.example.com/old.jpg",
        closetItem: { imageUrl: "https://legacy.example.com/legacy.jpg", imagePublicId: `naia-wardrobe/${CUSTOMER_ID}/ci-1`, imageFormat: "jpg" },
      },
      { customerId: CUSTOMER_ID, cloudinaryConfig: CONFIG },
    );
    assert.ok(url, "expected a resolved URL");
    assert.match(url!, /^https:\/\/api\.cloudinary\.com\/v1_1\/demo\//);
    assert.match(url!, /expires_at=/); // confirms this is the time-limited signed download URL, not a stable one
    assert.doesNotMatch(url!, /stale\.example\.com|legacy\.example\.com/);
  });

  it("never resolves a private URL for a closet item that does not belong to this customer — ownership check wins over having the fields", () => {
    const url = resolveItemImage(
      {
        closetItemId: "ci-1",
        productImageUrl: null,
        closetItem: { imageUrl: null, imagePublicId: `naia-wardrobe/${OTHER_CUSTOMER_ID}/ci-1`, imageFormat: "jpg" },
      },
      { customerId: CUSTOMER_ID, cloudinaryConfig: CONFIG },
    );
    // Falls through to the next priority (productImageUrl, then imageUrl) — both null here.
    assert.equal(url, null);
  });

  it("falls back to productImageUrl when there is no closetItemId/imagePublicId pairing at all", () => {
    const url = resolveItemImage(
      { closetItemId: null, productImageUrl: "https://cdn.example.com/catalog.jpg", closetItem: null },
      { customerId: CUSTOMER_ID, cloudinaryConfig: CONFIG },
    );
    assert.equal(url, "https://cdn.example.com/catalog.jpg");
  });

  it("falls back to the closet item's legacy imageUrl when no signed-URL fields are present", () => {
    const url = resolveItemImage(
      { closetItemId: "ci-1", productImageUrl: null, closetItem: { imageUrl: "https://legacy.example.com/legacy.jpg", imagePublicId: null, imageFormat: null } },
      { customerId: CUSTOMER_ID, cloudinaryConfig: CONFIG },
    );
    assert.equal(url, "https://legacy.example.com/legacy.jpg");
  });

  // 2026-11-18 — QA #36 exposure review: the legacy imageUrl fallback above
  // had no ownership check at all (unlike the signed-URL branch, a few
  // lines up, which calls validatePublicIdOwnership before ever using
  // ci.imagePublicId). This closes that gap at the one point where it's
  // actually detectable: a legacy URL that itself names a DIFFERENT
  // customer's naia-wardrobe/ folder. An ambiguous/no-prefix legacy URL
  // (the test immediately above this one) is unaffected — see
  // validateImageUrlOwnership's own test file for why that's deliberate,
  // not an oversight.
  it("QA #36 — a legacy imageUrl naming a DIFFERENT customer's naia-wardrobe folder is rejected, not leaked", () => {
    const url = resolveItemImage(
      {
        closetItemId: "ci-1",
        productImageUrl: null,
        closetItem: {
          imageUrl: `https://res.cloudinary.com/demo/image/upload/naia-wardrobe/${OTHER_CUSTOMER_ID}/ci-1.jpg`,
          imagePublicId: null,
          imageFormat: null,
        },
      },
      { customerId: CUSTOMER_ID, cloudinaryConfig: CONFIG },
    );
    assert.equal(url, null, "must never return another customer's legacy photo URL");
  });

  it("still returns a legacy imageUrl that correctly names THIS customer's own naia-wardrobe folder", () => {
    const url = resolveItemImage(
      {
        closetItemId: "ci-1",
        productImageUrl: null,
        closetItem: {
          imageUrl: `https://res.cloudinary.com/demo/image/upload/naia-wardrobe/${CUSTOMER_ID}/ci-1.jpg`,
          imagePublicId: null,
          imageFormat: null,
        },
      },
      { customerId: CUSTOMER_ID, cloudinaryConfig: CONFIG },
    );
    assert.equal(url, `https://res.cloudinary.com/demo/image/upload/naia-wardrobe/${CUSTOMER_ID}/ci-1.jpg`);
  });

  it("returns null — never a stale/broken placeholder string — when nothing can be resolved", () => {
    const url = resolveItemImage(
      { closetItemId: "ci-1", productImageUrl: null, closetItem: { imageUrl: null, imagePublicId: null, imageFormat: null } },
      { customerId: CUSTOMER_ID, cloudinaryConfig: CONFIG },
    );
    assert.equal(url, null);
  });

  it("returns null (not a crash) when the closet item itself no longer exists", () => {
    const url = resolveItemImage(
      { closetItemId: "ci-deleted", productImageUrl: null, closetItem: null },
      { customerId: CUSTOMER_ID, cloudinaryConfig: CONFIG },
    );
    assert.equal(url, null);
  });

  it("never attempts the signed-URL path when cloudinaryConfig is unavailable, even with valid publicId/format", () => {
    const url = resolveItemImage(
      {
        closetItemId: "ci-1",
        productImageUrl: null,
        closetItem: { imageUrl: "https://legacy.example.com/legacy.jpg", imagePublicId: `naia-wardrobe/${CUSTOMER_ID}/ci-1`, imageFormat: "jpg" },
      },
      { customerId: CUSTOMER_ID, cloudinaryConfig: null },
    );
    // Falls through to legacy imageUrl rather than throwing.
    assert.equal(url, "https://legacy.example.com/legacy.jpg");
  });
});

describe("StyleMe result/detail route — anchor-image hydration wiring", () => {
  it("re-resolves the anchor image through the canonical resolveItemImage, rather than trusting the generation-time persisted anchorImageUrl as-is", () => {
    assert.match(resultSrc, /import \{ resolveItemImage \} from "~\/lib\/styleme\/look-image-resolution\.server"/);
    assert.match(resultSrc, /resolveItemImage\(\s*\{\s*closetItemId: anchorMeta\.anchor\.id/);
  });

  it("re-fetches the anchor's closet item scoped to this session's own customerId — never resolves another customer's item", () => {
    const fnStart = resultSrc.indexOf("hydratedMoodDescription");
    const fnEnd = resultSrc.indexOf("const hydratedSuggestion", fnStart);
    const block = resultSrc.slice(fnStart, fnEnd);
    assert.match(block, /closetItem\.findUnique\(\{\s*where:\s*\{\s*id:\s*anchorMeta\.anchor\.id,\s*customerId:\s*session\.customerId/);
  });

  it("only overwrites moodDescription when the freshly-resolved anchor image actually differs — a no-op leaves the original JSON untouched", () => {
    assert.match(resultSrc, /if \(freshAnchorImageUrl !== anchorMeta\.anchorImageUrl\)/);
  });
});

describe("resolveCollageImages() — bounded, never-invented collage", () => {
  it("resolves up to the max and reports the overflow count, drawing only from the exact items given", () => {
    const items = Array.from({ length: MAX_COLLAGE_IMAGES + 2 }, (_, i) => ({
      closetItemId: `ci-${i}`,
      productImageUrl: `https://cdn.example.com/item-${i}.jpg`,
      closetItem: null,
    }));
    const { resolvedImages, extraCount } = resolveCollageImages(items, { customerId: CUSTOMER_ID, cloudinaryConfig: CONFIG });
    assert.equal(resolvedImages.length, MAX_COLLAGE_IMAGES);
    assert.equal(extraCount, 2);
  });

  it("extraCount accounts for unresolvable items too — it is not fooled by a short resolved list", () => {
    const items = [
      { closetItemId: "ci-1", productImageUrl: "https://cdn.example.com/a.jpg", closetItem: null },
      { closetItemId: "ci-2", productImageUrl: null, closetItem: null }, // unresolvable
    ];
    const { resolvedImages, extraCount } = resolveCollageImages(items, { customerId: CUSTOMER_ID, cloudinaryConfig: CONFIG });
    assert.equal(resolvedImages.length, 1);
    assert.equal(extraCount, 1);
  });
});

describe("resolveCollageImages() — JEWELRY-only whitespace normalization (2026-11-03, Sara visual QA)", () => {
  function jewelryItem(id: string) {
    return {
      closetItemId: id,
      productImageUrl: null,
      closetItem: { imageUrl: null, imagePublicId: `naia-wardrobe/${CUSTOMER_ID}/${id}`, imageFormat: "jpg", category: "JEWELRY" },
    };
  }
  function nonJewelryItem(id: string, category: string) {
    return {
      closetItemId: id,
      productImageUrl: null,
      closetItem: { imageUrl: null, imagePublicId: `naia-wardrobe/${CUSTOMER_ID}/${id}`, imageFormat: "jpg", category },
    };
  }

  it("a JEWELRY item's resolved URL carries the whitespace-normalization transformation", () => {
    const { resolvedImages } = resolveCollageImages([jewelryItem("ci-earrings")], { customerId: CUSTOMER_ID, cloudinaryConfig: CONFIG });
    const url = decodeURIComponent(resolvedImages[0]);
    assert.match(url, /transformation=e_trim:15\/c_pad,ar_1:1,w_500,b_auto:predominant/);
  });

  for (const category of ["TOPS", "BOTTOMS", "DRESSES", "OUTERWEAR", "SHOES", "BAGS", "ACCESSORIES", "ACTIVEWEAR", "SWIMWEAR", "LOUNGEWEAR", "OTHER"]) {
    it(`a ${category} item is never transformed — only JEWELRY is, by design`, () => {
      const { resolvedImages } = resolveCollageImages([nonJewelryItem(`ci-${category}`, category)], { customerId: CUSTOMER_ID, cloudinaryConfig: CONFIG });
      const url = decodeURIComponent(resolvedImages[0]);
      assert.doesNotMatch(url, /transformation=/);
    });
  }

  it("an item with no category (legacy row, never backfilled) is left untransformed — fails closed, not open", () => {
    const item = {
      closetItemId: "ci-legacy",
      productImageUrl: null,
      closetItem: { imageUrl: null, imagePublicId: `naia-wardrobe/${CUSTOMER_ID}/ci-legacy`, imageFormat: "jpg", category: null },
    };
    const { resolvedImages } = resolveCollageImages([item], { customerId: CUSTOMER_ID, cloudinaryConfig: CONFIG });
    const url = decodeURIComponent(resolvedImages[0]);
    assert.doesNotMatch(url, /transformation=/);
  });

  it("a mixed collage transforms only the JEWELRY tile — trousers, top, and shoes pass through untouched", () => {
    const items = [
      nonJewelryItem("ci-top", "TOPS"),
      nonJewelryItem("ci-trousers", "BOTTOMS"),
      jewelryItem("ci-earrings"),
      nonJewelryItem("ci-shoes", "SHOES"),
    ];
    const { resolvedImages, extraCount } = resolveCollageImages(items, { customerId: CUSTOMER_ID, cloudinaryConfig: CONFIG });
    assert.equal(resolvedImages.length, 4);
    assert.equal(extraCount, 0);
    const decoded = resolvedImages.map(decodeURIComponent);
    assert.doesNotMatch(decoded[0], /transformation=/);
    assert.doesNotMatch(decoded[1], /transformation=/);
    assert.match(decoded[2], /transformation=e_trim/);
    assert.doesNotMatch(decoded[3], /transformation=/);
  });

  it("uses c_pad, never c_fill/c_crop/c_lfill/c_thumb — cropping a jewelry piece is explicitly disallowed", () => {
    const { resolvedImages } = resolveCollageImages([jewelryItem("ci-ring")], { customerId: CUSTOMER_ID, cloudinaryConfig: CONFIG });
    const url = decodeURIComponent(resolvedImages[0]);
    assert.match(url, /c_pad/);
    assert.doesNotMatch(url, /c_fill|c_crop|c_lfill|c_thumb/);
  });

  it("the transformed URL is still fully signed and ownership-scoped — normalization adds no new access path", () => {
    const { resolvedImages } = resolveCollageImages([jewelryItem("ci-bracelet")], { customerId: CUSTOMER_ID, cloudinaryConfig: CONFIG });
    const url = decodeURIComponent(resolvedImages[0]);
    assert.match(url, /expires_at=\d+/);
    assert.match(url, /signature=[0-9a-f]+/);
    assert.match(url, /type=private/);
  });

  it("ownership is still enforced before normalization is even considered — another customer's JEWELRY item resolves to null, never a transformed URL", () => {
    const item = {
      closetItemId: "ci-1",
      productImageUrl: null,
      closetItem: { imageUrl: null, imagePublicId: `naia-wardrobe/${OTHER_CUSTOMER_ID}/ci-1`, imageFormat: "jpg", category: "JEWELRY" },
    };
    const { resolvedImages } = resolveCollageImages([item], { customerId: CUSTOMER_ID, cloudinaryConfig: CONFIG });
    assert.equal(resolvedImages.length, 0);
  });

  it("resolveItemImage's other callers (no transformation argument) are completely unaffected by this change", () => {
    const url = resolveItemImage(
      jewelryItem("ci-1"),
      { customerId: CUSTOMER_ID, cloudinaryConfig: CONFIG },
      // no transformation argument — matches every caller except resolveCollageImages
    );
    assert.ok(url);
    assert.doesNotMatch(decodeURIComponent(url!), /transformation=/);
  });
});
