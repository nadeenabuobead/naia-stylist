// app/lib/trend-facets.test.ts
//
// Facets are what let a trend match a wardrobe. Two failure modes matter:
// a facet that matches nothing (a missed connection), and a facet that matches
// the wrong thing (a confident claim with nothing behind it). These tests
// defend hardest against the second.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  FACET_KINDS,
  FACET_KIND_LABELS,
  isFacetKind,
  isFacetValue,
  facetVocabulary,
  validateFacets,
  isEmptyFacets,
  countFacetValues,
  makeFacetContentId,
  parseFacetContentId,
  deriveFacetsFromProse,
  type TrendFacets,
} from "./trend-facets.ts";
import { CONSTRUCTION_VALUES } from "./admin/styleme-garment-profile.vocab.ts";
import { CLOSET_CATEGORY_VALUES } from "./ai/closet-categories.ts";

// ── §TF-1 the approved vocabulary ─────────────────────────────────────────────

describe("§TF-1 facet kinds", () => {
  it("is the approved eight, plus construction split out of visualWeight", () => {
    // The approved list said "visual weight / structure" as one bullet. Those are
    // two distinct resolved fields — light|medium|substantial versus
    // soft|structured|tailored — so merging them would have pointed a facet at a
    // field that can never hold its values. Split, flagged for sign-off.
    assert.deepEqual([...FACET_KINDS], [
      "category", "subcategory", "material", "colourFamily",
      "silhouette", "pattern", "formalityBand", "visualWeight", "construction",
    ]);
  });

  it("deliberately excludes occasion, lifestyle and season from matching", () => {
    for (const excluded of ["occasion", "lifestyle", "season"]) {
      assert.equal(isFacetKind(excluded), false, `${excluded} must not be matchable`);
    }
  });

  it("gives every kind a customer-facing label", () => {
    for (const kind of FACET_KINDS) assert.ok(FACET_KIND_LABELS[kind]?.length > 0);
  });
});

// ── §TF-2 vocabularies come from Garment Intelligence ────────────────────────

describe("§TF-2 vocabulary alignment", () => {
  it("materials are garment materials", () => {
    assert.ok(isFacetValue("material", "suede"));
    assert.ok(isFacetValue("material", "leather"));
    assert.equal(isFacetValue("material", "moonstone"), false);
  });

  it("colour families are Passport colour families", () => {
    assert.ok(isFacetValue("colourFamily", "red-burgundy"));
    assert.ok(isFacetValue("colourFamily", "beige-brown"));
    // "burgundy" alone is a colour word, not a family id — must be rejected.
    assert.equal(isFacetValue("colourFamily", "burgundy"), false);
  });

  it("silhouette accepts both garment shape and fit profile", () => {
    assert.ok(isFacetValue("silhouette", "column"), "garment silhouette");
    assert.ok(isFacetValue("silhouette", "relaxed"), "fit profile");
    assert.equal(isFacetValue("silhouette", "swooshy"), false);
    assert.equal(isFacetValue("silhouette", "n/a"), false, "a not-applicable placeholder is not a shape");
  });

  it("formality bands are garment formality tokens", () => {
    assert.ok(isFacetValue("formalityBand", "smart-casual"));
    assert.equal(isFacetValue("formalityBand", "very-fancy"), false);
  });

  it("visualWeight is ONLY resolved visual weight", () => {
    for (const token of ["light", "medium", "substantial"]) {
      assert.ok(isFacetValue("visualWeight", token), token);
    }
    // "soft" is a construction value. Accepting it here would point the facet at
    // a field that cannot hold it — the bug this split fixes.
    assert.equal(isFacetValue("visualWeight", "soft"), false);
    assert.equal(isFacetValue("visualWeight", "structured"), false);
    assert.equal(isFacetValue("visualWeight", "heavy"), false, "curated 'heavy' resolves to 'substantial'");
    assert.equal(isFacetValue("visualWeight", "chunky"), false);
  });

  it("construction is the curated construction vocabulary, minus the N/A placeholder", () => {
    for (const token of ["soft", "neutral", "structured", "tailored", "sculptural"]) {
      assert.ok(isFacetValue("construction", token), token);
    }
    assert.equal(isFacetValue("construction", "N/A"), false, "an authoring placeholder is not a trend direction");
    assert.equal(isFacetValue("construction", "light"), false);
  });

  it("construction values come from the shared vocabulary, not a copy", () => {
    // Imported directly from styleme-garment-profile.vocab.ts — if that list
    // changes, this set changes with it.
    for (const token of CONSTRUCTION_VALUES) {
      if (token === "N/A") continue;
      assert.ok(isFacetValue("construction", token), `${token} must be accepted`);
    }
  });

  it("categories are the shared ClosetCategory list — every value accepted", () => {
    for (const category of CLOSET_CATEGORY_VALUES) {
      assert.ok(isFacetValue("category", category), category);
    }
    assert.ok(isFacetValue("category", "bags"), "case-insensitive on input");
    assert.equal(isFacetValue("category", "HANDBAGS"), false);
    assert.equal(CLOSET_CATEGORY_VALUES.length, 12);
  });

  it("subcategory is open but form-checked — fashion invents shapes", () => {
    assert.equal(facetVocabulary("subcategory"), null);
    assert.ok(isFacetValue("subcategory", "east-west"));
    assert.ok(isFacetValue("subcategory", "mary-jane"));
    assert.equal(isFacetValue("subcategory", "East West!!"), false);
  });
});

// ── §TF-3 validation ──────────────────────────────────────────────────────────

describe("§TF-3 validation", () => {
  it("canonicalises case", () => {
    const { facets } = validateFacets({ category: ["bags"], material: ["SUEDE"] });
    assert.deepEqual(facets, { category: ["BAGS"], material: ["suede"] });
  });

  it("drops invalid values and reports them rather than failing silently", () => {
    const { facets, rejected } = validateFacets({ material: ["suede", "unobtanium"] });
    assert.deepEqual(facets.material, ["suede"]);
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].value, "unobtanium");
  });

  it("reports an unknown kind instead of accepting it", () => {
    const { facets, rejected } = validateFacets({ occasion: ["work"] });
    assert.ok(isEmptyFacets(facets));
    assert.equal(rejected[0].kind, "occasion");
  });

  it("de-duplicates", () => {
    const { facets } = validateFacets({ material: ["suede", "suede", "SUEDE"] });
    assert.deepEqual(facets.material, ["suede"]);
  });

  it("accepts a bare string as a single value", () => {
    const { facets } = validateFacets({ material: "suede" });
    assert.deepEqual(facets.material, ["suede"]);
  });

  it("handles null, undefined and non-objects without throwing", () => {
    assert.ok(isEmptyFacets(validateFacets(null).facets));
    assert.ok(isEmptyFacets(validateFacets(undefined).facets));
    assert.equal(validateFacets(["a"]).rejected[0].kind, "(root)");
  });

  it("omits a kind entirely when nothing survived", () => {
    const { facets } = validateFacets({ material: ["nonsense"] });
    assert.equal("material" in facets, false);
  });

  it("counts values across kinds", () => {
    assert.equal(countFacetValues({ material: ["suede"], category: ["BAGS", "SHOES"] }), 3);
    assert.equal(countFacetValues(null), 0);
  });
});

// ── §TF-4 the three worked examples ──────────────────────────────────────────

describe("§TF-4 real trends", () => {
  it("New Bag Shapes — category, shape and CONSTRUCTION (not visual weight)", () => {
    const { facets, rejected } = validateFacets({
      category: ["BAGS"],
      subcategory: ["east-west"],
      construction: ["soft"],
    });
    assert.equal(rejected.length, 0);
    assert.deepEqual(facets, { category: ["BAGS"], subcategory: ["east-west"], construction: ["soft"] });
  });

  it("New Bag Shapes written the old way is now REJECTED", () => {
    const { facets, rejected } = validateFacets({ visualWeight: ["soft"] });
    assert.ok(isEmptyFacets(facets));
    assert.equal(rejected[0].kind, "visualWeight");
  });

  it("Suede Textures — material alone, deliberately category-free", () => {
    const { facets, rejected } = validateFacets({ material: ["suede"] });
    assert.equal(rejected.length, 0);
    assert.deepEqual(facets, { material: ["suede"] });
    // No category: the trend is about a surface, and it can land on a bag,
    // a jacket or a boot. Pinning a category here would narrow it wrongly.
    assert.equal("category" in facets, false);
  });

  it("Burgundy — a colour direction", () => {
    const { facets, rejected } = validateFacets({ colourFamily: ["red-burgundy"] });
    assert.equal(rejected.length, 0);
    assert.deepEqual(facets, { colourFamily: ["red-burgundy"] });
  });

  it("Relaxed Tailoring — silhouette plus formality", () => {
    const { facets, rejected } = validateFacets({
      silhouette: ["relaxed"],
      formalityBand: ["smart-casual", "business-casual"],
      construction: ["tailored"],
    });
    assert.equal(rejected.length, 0);
    assert.equal(countFacetValues(facets), 4);
  });

  it("four trends in one report describe four different wardrobes", () => {
    const bags: TrendFacets = validateFacets({ category: ["BAGS"], subcategory: ["east-west"] }).facets;
    const suede: TrendFacets = validateFacets({ material: ["suede"] }).facets;
    const burgundy: TrendFacets = validateFacets({ colourFamily: ["red-burgundy"] }).facets;
    const tailoring: TrendFacets = validateFacets({ silhouette: ["relaxed"] }).facets;
    // This is the whole point of per-trend facets: no two overlap.
    const keys = [bags, suede, burgundy, tailoring].map((f) => Object.keys(f).sort().join(","));
    assert.equal(new Set(keys).size, 4);
  });
});

// ── §TF-5 saved-facet identity ───────────────────────────────────────────────

describe("§TF-5 facet content ids", () => {
  it("round-trips", () => {
    const id = makeFacetContentId("material", "suede");
    assert.equal(id, "material:suede");
    assert.deepEqual(parseFacetContentId(id), { kind: "material", value: "suede" });
  });

  it("is global — the same material saved from two reports is one object", () => {
    assert.equal(makeFacetContentId("colourFamily", "red-burgundy"), makeFacetContentId("colourFamily", "red-burgundy"));
  });

  it("refuses to mint an id for a value outside the vocabulary", () => {
    assert.throws(() => makeFacetContentId("material", "unobtanium"));
  });

  it("returns null for junk rather than inventing a facet", () => {
    for (const junk of ["", "nokind", "material:unobtanium", "occasion:work"]) {
      assert.equal(parseFacetContentId(junk), null, junk);
    }
  });
});

// ── §TF-6 prose fallback — timid on purpose ──────────────────────────────────

describe("§TF-6 prose fallback", () => {
  it("finds a material named in the copy", () => {
    const facets = deriveFacetsFromProse("Suede returns as a surface, not a statement.");
    assert.deepEqual(facets.material, ["suede"]);
  });

  it("maps a colour word to its family", () => {
    assert.deepEqual(deriveFacetsFromProse("A deep burgundy that behaves like a neutral.").colourFamily, ["red-burgundy"]);
  });

  it("finds a fit word", () => {
    assert.ok(deriveFacetsFromProse("Relaxed shoulders and a softer line.").silhouette?.includes("relaxed"));
  });

  it("NEVER guesses a category — the failure mode that would cost trust", () => {
    const facets = deriveFacetsFromProse("The new bag shapes are softer and wider this season.");
    assert.equal(facets.category, undefined);
    assert.equal(facets.subcategory, undefined);
  });

  it("returns nothing for copy with no vocabulary in it", () => {
    assert.ok(isEmptyFacets(deriveFacetsFromProse("A season about restraint and proportion.")));
  });

  it("produces only valid facets — output feeds straight into matching", () => {
    const text = "Suede, leather and wool in burgundy and navy, relaxed and tailored, smart-casual.";
    const { rejected } = validateFacets(deriveFacetsFromProse(text));
    assert.equal(rejected.length, 0);
  });

  it("is case-insensitive and punctuation-tolerant", () => {
    assert.deepEqual(deriveFacetsFromProse("SUEDE — again.").material, ["suede"]);
  });
});
