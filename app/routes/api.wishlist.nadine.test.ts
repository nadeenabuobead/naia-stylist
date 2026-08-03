// Regression tests for NADINE product catalog data used in Buy or Skip pairing.
//
// Guards three things:
//   1. Every NADINE product exposes itemType and silhouette from the canonical catalog.
//   2. Complementary-category filtering produces physically plausible pairings per uploaded category.
//   3. OUTERWEAR products are not silhouette-described as bottoms, and vice versa.

import { describe, it, expect } from "vitest";
import { getAllCatalogProducts } from "~/lib/ai/naia-catalog";

const ITEM_TYPE_TO_CATEGORY: Record<string, string> = {
  TOP: "Top",
  BOTTOM: "Bottom",
  OUTERWEAR: "Outerwear",
  DRESS: "Dress",
  SET: "Dress",
};

const COMPLEMENTARY_CATEGORIES: Record<string, string[]> = {
  Top:       ["Bottom", "Outerwear"],
  Bottom:    ["Top", "Outerwear"],
  Dress:     ["Outerwear"],
  Outerwear: ["Top", "Bottom", "Dress"],
  Shoes:     ["Top", "Bottom", "Dress", "Outerwear"],
  Bag:       ["Top", "Bottom", "Dress", "Outerwear"],
  Accessory: ["Top", "Bottom", "Dress", "Outerwear"],
  Jewelry:   ["Top", "Bottom", "Dress", "Outerwear"],
};

const NAIA_PRODUCTS = getAllCatalogProducts().map(p => ({
  title: p.parsed.identity.verifiedTitle,
  category: ITEM_TYPE_TO_CATEGORY[p.parsed.identity.itemType] ?? "Top",
  itemType: p.parsed.identity.itemType,
  silhouette: p.parsed.identity.silhouette ?? null,
  handle: p.handle,
}));

// ── 1. Catalog completeness ────────────────────────────────────────────────────

describe("NADINE catalog — field completeness", () => {
  it("every product has a non-empty verifiedTitle", () => {
    for (const p of NAIA_PRODUCTS) {
      expect(p.title, `${p.handle} missing verifiedTitle`).toBeTruthy();
    }
  });

  it("every product has a recognised itemType", () => {
    const valid = new Set(Object.keys(ITEM_TYPE_TO_CATEGORY));
    for (const p of NAIA_PRODUCTS) {
      expect(valid.has(p.itemType), `${p.title} has unrecognised itemType: ${p.itemType}`).toBe(true);
    }
  });

  it("every product has a non-null silhouette string", () => {
    for (const p of NAIA_PRODUCTS) {
      expect(p.silhouette, `${p.title} is missing silhouette`).toBeTruthy();
      expect(typeof p.silhouette).toBe("string");
    }
  });

  it("catalog contains at least one product per itemType group", () => {
    const categories = new Set(NAIA_PRODUCTS.map(p => p.category));
    expect(categories.has("Top")).toBe(true);
    expect(categories.has("Bottom")).toBe(true);
    expect(categories.has("Outerwear")).toBe(true);
  });
});

// ── 2. Complementary-category filtering ───────────────────────────────────────

describe("NADINE complementary-category filtering", () => {
  function eligibleFor(uploadedCategory: string) {
    const allowed = COMPLEMENTARY_CATEGORIES[uploadedCategory] ?? [];
    return NAIA_PRODUCTS.filter(p => allowed.includes(p.category));
  }

  it("uploading a Bottom excludes Bottom NADINE products", () => {
    const eligible = eligibleFor("Bottom");
    const hasBottom = eligible.some(p => p.category === "Bottom");
    expect(hasBottom).toBe(false);
  });

  it("uploading a Top excludes Top NADINE products", () => {
    const eligible = eligibleFor("Top");
    const hasTop = eligible.some(p => p.category === "Top");
    expect(hasTop).toBe(false);
  });

  it("uploading a Dress only allows Outerwear NADINE products", () => {
    const eligible = eligibleFor("Dress");
    for (const p of eligible) {
      expect(p.category, `${p.title} should not be eligible when uploading a Dress`).toBe("Outerwear");
    }
  });

  it("uploading an Outerwear returns at least one Top and one Bottom", () => {
    const eligible = eligibleFor("Outerwear");
    expect(eligible.some(p => p.category === "Top")).toBe(true);
    expect(eligible.some(p => p.category === "Bottom")).toBe(true);
  });

  it("eligible list is non-empty for every standard uploaded category", () => {
    for (const cat of ["Top", "Bottom", "Dress", "Outerwear"]) {
      expect(eligibleFor(cat).length, `no eligible NADINE products for uploaded ${cat}`).toBeGreaterThan(0);
    }
  });
});

// ── 3. Physical-role plausibility in silhouette strings ──────────────────────

describe("NADINE silhouette strings — physical role plausibility", () => {
  // Outerwear silhouettes must not be described with lower-body vocabulary
  it("Outerwear silhouettes do not mention trousers or skirt as the primary garment", () => {
    const outerwear = NAIA_PRODUCTS.filter(p => p.category === "Outerwear");
    for (const p of outerwear) {
      // The silhouette should not start with "straight-leg trousers" or "slim column midi skirt" —
      // those are Bottom descriptors. Outerwear silhouettes open with coat/jacket/wrap language.
      const lower = (p.silhouette ?? "").toLowerCase();
      const startsAsBottom = /^(straight[\s-]leg|wide[\s-]leg|slim column|midi skirt|trousers|skirt)/.test(lower);
      expect(startsAsBottom, `Outerwear "${p.title}" silhouette reads as a Bottom: "${p.silhouette}"`).toBe(false);
    }
  });

  // Bottom silhouettes must not be described with outerwear vocabulary
  it("Bottom silhouettes do not open with coat or jacket language", () => {
    const bottoms = NAIA_PRODUCTS.filter(p => p.category === "Bottom");
    for (const p of bottoms) {
      const lower = (p.silhouette ?? "").toLowerCase();
      const startsAsOuterwear = /^(long tailored|kimono|trench coat|zip-front jacket|fitted jacket)/.test(lower);
      expect(startsAsOuterwear, `Bottom "${p.title}" silhouette reads as Outerwear: "${p.silhouette}"`).toBe(false);
    }
  });
});
