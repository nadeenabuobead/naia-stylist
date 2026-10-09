// app/lib/trend-evidence-attribute-scoring.test.ts
// Run: node --test --import tsx/esm app/lib/trend-evidence-attribute-scoring.test.ts

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  scoreItemAttributes,
  dimensionIdsForSlug,
} from "./trend-evidence-attribute-scoring.server.ts";
import type { ShopperClosetItemEvidence } from "./trend-evidence.server.ts";

function item(overrides: Partial<ShopperClosetItemEvidence> = {}): ShopperClosetItemEvidence {
  return {
    name: "Test Item",
    imageUrl: null,
    category: "TOPS",
    subcategory: null,
    primaryColor: null,
    styleTags: [],
    occasions: [],
    material: null,
    ...overrides,
  };
}

describe("dimensionIdsForSlug()", () => {
  it("Modern Tailoring has tailored-anchor and relaxed-counterpart dimensions", () => {
    assert.deepEqual(
      dimensionIdsForSlug("modern-tailoring-spring-2026"),
      ["tailored-anchor", "relaxed-counterpart"],
    );
  });

  it("Soft Structure has structured-anchor and soft-flowing dimensions", () => {
    assert.deepEqual(
      dimensionIdsForSlug("spring-2026-soft-structure"),
      ["structured-anchor", "soft-flowing"],
    );
  });

  it("Colour Direction has base-neutral and accent-colour dimensions", () => {
    assert.deepEqual(
      dimensionIdsForSlug("spring-2026-colour-direction"),
      ["base-neutral", "accent-colour"],
    );
  });

  it("an unknown slug has no dimensions", () => {
    assert.deepEqual(dimensionIdsForSlug("not-a-real-slug"), []);
  });
});

describe("scoreItemAttributes() — Modern Tailoring", () => {
  it("a tailored blazer scores highest on tailored-anchor, not relaxed-counterpart", () => {
    const blazer = item({ category: "OUTERWEAR", fitProfile: "tailored", formality: "business-formal" });
    const result = scoreItemAttributes(blazer, "modern-tailoring-spring-2026");
    assert.equal(result.bestDimensionId, "tailored-anchor");
    assert.ok(result.bestScore > 0);
  });

  it("a relaxed jersey top scores highest on relaxed-counterpart, not tailored-anchor", () => {
    const knit = item({ category: "TOPS", fitProfile: "relaxed", material: "jersey" });
    const result = scoreItemAttributes(knit, "modern-tailoring-spring-2026");
    assert.equal(result.bestDimensionId, "relaxed-counterpart");
  });

  it("a structured trouser scores on tailored-anchor via BOTTOMS + structured fitProfile", () => {
    const trouser = item({ category: "BOTTOMS", fitProfile: "structured" });
    const result = scoreItemAttributes(trouser, "modern-tailoring-spring-2026");
    assert.equal(result.bestDimensionId, "tailored-anchor");
  });

  it("an item with no fitProfile/formality/silhouette signal scores 0 on every dimension", () => {
    const plain = item({ category: "ACCESSORIES" });
    const result = scoreItemAttributes(plain, "modern-tailoring-spring-2026");
    assert.equal(result.bestScore, 0);
    assert.equal(result.bestDimensionId, null);
  });
});

describe("scoreItemAttributes() — Soft Structure", () => {
  it("a flowy, wrap-silhouette dress scores highest on soft-flowing", () => {
    const dress = item({ category: "DRESSES", fitProfile: "flowy", silhouette: "wrap" });
    const result = scoreItemAttributes(dress, "spring-2026-soft-structure");
    assert.equal(result.bestDimensionId, "soft-flowing");
  });

  it("a structured column-silhouette blazer scores highest on structured-anchor", () => {
    const blazer = item({ category: "OUTERWEAR", fitProfile: "structured", silhouette: "column" });
    const result = scoreItemAttributes(blazer, "spring-2026-soft-structure");
    assert.equal(result.bestDimensionId, "structured-anchor");
  });

  it("BOTH a structured piece and a soft piece can be the best evidence for their own dimension in the same Closet — this is how 'structured + soft combinations' becomes reachable", () => {
    const structured = item({ name: "Structured Blazer", category: "OUTERWEAR", fitProfile: "structured" });
    const soft = item({ name: "Flowy Midi Skirt", category: "BOTTOMS", fitProfile: "flowy", silhouette: "a-line" });
    const structuredResult = scoreItemAttributes(structured, "spring-2026-soft-structure");
    const softResult = scoreItemAttributes(soft, "spring-2026-soft-structure");
    assert.equal(structuredResult.bestDimensionId, "structured-anchor");
    assert.equal(softResult.bestDimensionId, "soft-flowing");
  });
});

describe("scoreItemAttributes() — Colour Direction", () => {
  it("a neutral-colour item (cream) scores on base-neutral", () => {
    const top = item({ category: "TOPS", primaryColor: "cream" });
    const result = scoreItemAttributes(top, "spring-2026-colour-direction");
    assert.equal(result.bestDimensionId, "base-neutral");
  });

  it("a real hue-family accent colour (red) scores on accent-colour, not base-neutral", () => {
    const bag = item({ category: "BAGS", primaryColor: "red" });
    const result = scoreItemAttributes(bag, "spring-2026-colour-direction");
    assert.equal(result.bestDimensionId, "accent-colour");
  });

  it("falls back to the colors[] array when primaryColor is absent", () => {
    const shoe = item({ category: "SHOES", primaryColor: null, colors: ["orange"] });
    const result = scoreItemAttributes(shoe, "spring-2026-colour-direction");
    assert.equal(result.bestDimensionId, "accent-colour");
  });

  it("an item with no resolvable colour at all scores 0 on both colour dimensions — this is the beanie/sneaker regression guard: generic neutrality alone (category match without real colour evidence) must not win", () => {
    const beanie = item({ category: "ACCESSORIES", primaryColor: null, colors: [] });
    const result = scoreItemAttributes(beanie, "spring-2026-colour-direction");
    assert.equal(result.bestScore, 0);
  });

  it("a black beanie legitimately scores on base-neutral (black IS a real neutral) — the regression was ranking it ABOVE stronger evidence, not that it can never qualify at all", () => {
    const beanie = item({ category: "ACCESSORIES", primaryColor: "black" });
    const result = scoreItemAttributes(beanie, "spring-2026-colour-direction");
    assert.equal(result.bestDimensionId, "base-neutral");
    const strongerBase = item({ category: "BOTTOMS", primaryColor: "stone" });
    const strongerResult = scoreItemAttributes(strongerBase, "spring-2026-colour-direction");
    // Both qualify as real neutral evidence — the fix is that BOTTOMS is now even
    // eligible to compete at all (see SLUG_COMPATIBLE_CATEGORIES), not that an
    // accessory's genuine neutral evidence is disqualified.
    assert.equal(strongerResult.bestDimensionId, "base-neutral");
  });
});
