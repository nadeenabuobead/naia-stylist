// app/lib/trend-closet-match.test.ts
//
// The matcher's job is to be right, and to say nothing when it cannot be.
// These tests defend hardest against overclaiming: a category is not evidence,
// a garment's name is not evidence, report prose is not evidence, and missing
// intelligence is not agreement.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  matchTrendToCloset,
  matchTrendsToCloset,
  buildReason,
  SCOPE_FACETS,
  DIRECTIONAL_FACETS,
} from "./trend-closet-match.ts";
import type { WardrobeGarment } from "./ai/wardrobe-intelligence.ts";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function garment(over: Partial<WardrobeGarment> = {}): WardrobeGarment {
  return {
    id: "g1", name: "A piece", category: "TOPS", subcategory: null,
    imageUrl: null, slot: "top",
    primaryColor: null, colors: [], pattern: null, material: null,
    silhouette: null, fitProfile: null, formality: null, stylePersonality: null,
    occasions: [], seasons: [], analysisStatus: "ready",
    visualWeight: null, colourProfile: null, garmentRelationships: [],
    intentions: null, intentionsSource: null, intelligenceSource: "derived",
    outfitAppearances: 0, savedLookAppearances: 0, observedWear: null,
    ...over,
  } as WardrobeGarment;
}

const match = (facets: unknown, garments: WardrobeGarment[], contentId = "tc_aaaaaaaaaaaa") =>
  matchTrendToCloset({ contentId, facets: facets as never, garments });

// ── §TM-1 roles ───────────────────────────────────────────────────────────────

describe("§TM-1 scope vs direction", () => {
  it("category is the only scope facet", () => {
    assert.deepEqual([...SCOPE_FACETS], ["category"]);
  });

  it("construction is not directional — it is not matchable at all", () => {
    assert.equal(DIRECTIONAL_FACETS.includes("construction" as never), false);
  });

  it("every other facet carries direction", () => {
    assert.deepEqual([...DIRECTIONAL_FACETS].sort(), [
      "colourFamily", "formalityBand", "material", "pattern",
      "silhouette", "subcategory", "visualWeight",
    ]);
  });
});

// ── §TM-2 positive matches, one per facet kind ───────────────────────────────

describe("§TM-2 directional matches", () => {
  it("material — Suede Textures", () => {
    const r = match({ material: ["suede"] }, [garment({ id: "g1", material: "suede" })]);
    assert.equal(r.available, true);
    assert.equal(r.matchCount, 1);
    assert.equal(r.matches[0].evidence[0].kind, "material");
  });

  it("colourFamily — Burgundy, through the canonical Passport bridge", () => {
    // Facet is a Passport family id; the garment records the colour it is.
    const r = match({ colourFamily: ["red-burgundy"] }, [garment({ primaryColor: "Burgundy" })]);
    assert.equal(r.matchCount, 1);
    assert.equal(r.matches[0].evidence[0].garmentValue, "burgundy");
  });

  it("colourFamily keeps navy and blue apart — two Passport choices, not one", () => {
    const navy = match({ colourFamily: ["navy"] }, [garment({ primaryColor: "Navy" })]);
    const blueAsNavy = match({ colourFamily: ["navy"] }, [garment({ primaryColor: "Cobalt" })]);
    assert.equal(navy.matchCount, 1);
    assert.equal(blueAsNavy.matchCount, 0);
  });

  it("silhouette — matches either resolved shape field", () => {
    assert.equal(match({ silhouette: ["relaxed"] }, [garment({ fitProfile: "relaxed" })]).matchCount, 1);
    assert.equal(match({ silhouette: ["column"] }, [garment({ silhouette: "column" })]).matchCount, 1);
  });

  it("pattern", () => {
    assert.equal(match({ pattern: ["stripes"] }, [garment({ pattern: "stripes" })]).matchCount, 1);
  });

  it("formalityBand", () => {
    assert.equal(match({ formalityBand: ["smart-casual"] }, [garment({ formality: "smart-casual" })]).matchCount, 1);
  });

  it("visualWeight", () => {
    assert.equal(match({ visualWeight: ["substantial"] }, [garment({ visualWeight: "substantial" })]).matchCount, 1);
  });

  it("subcategory — a named shape", () => {
    assert.equal(match({ subcategory: ["east-west"] }, [garment({ subcategory: "east-west" })]).matchCount, 1);
  });

  it("values within one facet kind are OR", () => {
    const r = match({ colourFamily: ["red-burgundy", "navy"] }, [
      garment({ id: "a", primaryColor: "Navy" }),
      garment({ id: "b", primaryColor: "Burgundy" }),
    ]);
    assert.equal(r.matchCount, 2);
  });
});

// ── §TM-3 conservatism — the heart of it ─────────────────────────────────────

describe("§TM-3 conservatism", () => {
  it("CATEGORY ALONE never qualifies — owning a bag is not a direction", () => {
    const r = match({ category: ["BAGS"] }, [
      garment({ id: "tote", category: "BAGS", name: "Black Tote" }),
    ]);
    assert.equal(r.available, false, "a scope-only trend is not matchable");
    assert.equal(r.matchCount, 0);
  });

  it("The New Bag Shapes: the east-west bag qualifies, the plain tote does not", () => {
    // construction:["soft"] is authored but unavailable, so the claim rests on shape.
    const r = match(
      { category: ["BAGS"], subcategory: ["east-west"], construction: ["soft"] },
      [
        garment({ id: "eastwest", category: "BAGS", subcategory: "east-west", name: "Tan Bag" }),
        garment({ id: "tote", category: "BAGS", subcategory: "tote", name: "Black Tote" }),
      ],
    );
    assert.equal(r.matchCount, 1);
    assert.equal(r.matches[0].garmentId, "eastwest");
  });

  it("category CONTRADICTION rejects — a burgundy dress is not a bag trend", () => {
    const r = match(
      { category: ["BAGS"], colourFamily: ["red-burgundy"] },
      [garment({ id: "dress", category: "DRESSES", primaryColor: "Burgundy" })],
    );
    assert.equal(r.matchCount, 0);
  });

  it("the same colour trend WITHOUT a category constraint does match the dress", () => {
    const r = match({ colourFamily: ["red-burgundy"] },
      [garment({ id: "dress", category: "DRESSES", primaryColor: "Burgundy" })]);
    assert.equal(r.matchCount, 1);
  });

  it("CONSTRUCTION IS IGNORED — never inferred from anything else", () => {
    const r = match({ construction: ["soft"] }, [
      garment({ material: "silk", fitProfile: "relaxed", visualWeight: "light" }),
    ]);
    assert.equal(r.available, false);
    assert.equal(r.matchCount, 0);
  });

  it("MISSING intelligence never matches — null is not agreement", () => {
    const r = match({ material: ["suede"] }, [garment({ material: null, analysisStatus: "pending" })]);
    assert.equal(r.matchCount, 0);
  });

  it("a garment NAMED for the trend gives no match", () => {
    // The old matcher scored name tokens. This one reads fields only.
    const r = match({ material: ["suede"] }, [
      garment({ name: "Suede-look Skirt", material: "polyester" }),
    ]);
    assert.equal(r.matchCount, 0);
  });

  it("report prose containing the garment's name gives no match", () => {
    // Nothing here can even see prose — there is no text input to the matcher.
    const r = match({}, [garment({ name: "Softened tailoring blazer" })]);
    assert.equal(r.available, false);
    assert.equal(r.matchCount, 0);
  });

  it("an unauthored trend claims nothing", () => {
    assert.equal(match(null, [garment({ material: "suede" })]).available, false);
    assert.equal(match({}, [garment({ material: "suede" })]).available, false);
  });

  it("available:true with zero matches is possible and honest", () => {
    const r = match({ material: ["suede"] }, [garment({ material: "wool" })]);
    assert.equal(r.available, true);
    assert.equal(r.matchCount, 0);
  });
});

// ── §TM-4 ranking ─────────────────────────────────────────────────────────────

describe("§TM-4 ranking", () => {
  it("two facets outrank one", () => {
    const r = match({ material: ["suede"], colourFamily: ["red-burgundy"] }, [
      garment({ id: "one", material: "suede" }),
      garment({ id: "both", material: "suede", primaryColor: "Burgundy" }),
    ]);
    assert.equal(r.matches[0].garmentId, "both");
  });

  it("under AND, qualifying garments satisfy the SAME kinds and therefore tie", () => {
    // This is a property of the rule, not a shortcoming: every match cleared
    // exactly the same bar, so ranking them against each other would invent a
    // distinction the evidence does not support. Order is deterministic.
    const r = match({ material: ["suede"], formalityBand: ["evening"] }, [
      garment({ id: "b", material: "suede", formality: "evening" }),
      garment({ id: "a", material: "suede", formality: "evening" }),
    ]);
    assert.equal(r.matchCount, 2);
    assert.equal(r.matches[0].score, r.matches[1].score);
    assert.deepEqual(r.matches.map((m) => m.garmentId), ["a", "b"]);
  });

  it("a garment satisfying only one of two authored kinds does not rank — it does not qualify", () => {
    const r = match({ material: ["suede"], formalityBand: ["evening"] }, [
      garment({ id: "formal-only", formality: "evening" }),
      garment({ id: "material-only", material: "suede" }),
    ]);
    assert.equal(r.matchCount, 0);
  });

  it("ties break deterministically, and NOT on name or image", () => {
    const a = match({ material: ["suede"] }, [
      garment({ id: "zzz", material: "suede", name: "Named", imageUrl: "x.jpg" }),
      garment({ id: "aaa", material: "suede", name: null, imageUrl: null }),
    ]);
    assert.deepEqual(a.matches.map((m) => m.garmentId), ["aaa", "zzz"]);

    const b = match({ material: ["suede"] }, [
      garment({ id: "aaa", material: "suede", name: null, imageUrl: null }),
      garment({ id: "zzz", material: "suede", name: "Named", imageUrl: "x.jpg" }),
    ]);
    assert.deepEqual(a.matches.map((m) => m.garmentId), b.matches.map((m) => m.garmentId));
  });

  it("no percentage is ever produced", () => {
    const r = match({ material: ["suede"] }, [garment({ material: "suede" })]);
    assert.equal(/%/.test(JSON.stringify(r.matches[0].reason)), false);
  });
});

// ── §TM-5 counting ────────────────────────────────────────────────────────────

describe("§TM-5 counting the full closet", () => {
  it("counts past the 21st piece — no 20-item cap", () => {
    const garments = Array.from({ length: 30 }, (_, i) =>
      garment({ id: `g${String(i).padStart(2, "0")}`, material: "suede" }));
    const r = match({ material: ["suede"] }, garments);
    assert.equal(r.matchCount, 30);
    assert.ok(r.matches.some((m) => m.garmentId === "g25"), "the 26th piece must be counted");
  });

  it("counts each garment once even when several facets hit", () => {
    const r = match(
      { material: ["suede"], colourFamily: ["red-burgundy"], formalityBand: ["evening"] },
      [garment({ id: "one", material: "suede", primaryColor: "Burgundy", formality: "evening" })],
    );
    assert.equal(r.matchCount, 1);
    assert.equal(r.matches.length, 1);
    assert.equal(r.matches[0].evidence.length, 3);
  });

  it("no duplicate garment ids", () => {
    const r = match({ material: ["suede"] }, [
      garment({ id: "dup", material: "suede" }),
      garment({ id: "dup", material: "suede" }),
    ]);
    assert.equal(new Set(r.matches.map((m) => m.garmentId)).size, r.matches.length);
  });
});

// ── §TM-6 reasons ─────────────────────────────────────────────────────────────

describe("§TM-6 reason copy", () => {
  it("names only the OR-value that actually matched", () => {
    // Authored colours are navy OR burgundy; this garment is burgundy.
    const r = match({ material: ["suede"], colourFamily: ["navy", "red-burgundy"] },
      [garment({ material: "suede", primaryColor: "Burgundy" })]);
    const reason = r.matches[0].reason;
    assert.ok(reason.includes("suede"));
    assert.ok(reason.includes("burgundy"));
    assert.equal(reason.includes("navy"), false, "must not name a value that did not match");
  });

  it("reads as a sentence", () => {
    const r = match({ material: ["suede"] }, [garment({ material: "suede" })]);
    assert.match(r.matches[0].reason, /^[A-Z].*\.$/);
  });

  it("joins at most two pieces of evidence", () => {
    const r = match(
      { material: ["suede"], colourFamily: ["red-burgundy"], formalityBand: ["evening"], visualWeight: ["light"] },
      [garment({ material: "suede", primaryColor: "Burgundy", formality: "evening", visualWeight: "light" })],
    );
    assert.equal((r.matches[0].reason.match(/ and /g) ?? []).length, 1);
  });

  it("uses no internal token spelling", () => {
    const r = match({ formalityBand: ["smart-casual"] }, [garment({ formality: "smart-casual" })]);
    assert.equal(r.matches[0].reason.includes("smart-casual"), false);
    assert.ok(r.matches[0].reason.includes("smart casual"));
  });

  it("builds from the most specific evidence first", () => {
    const reason = buildReason([
      { kind: "formalityBand", facetValue: "evening", garmentValue: "evening" },
      { kind: "subcategory", facetValue: "blazer", garmentValue: "blazer" },
    ]);
    assert.ok(reason.indexOf("blazer") < reason.indexOf("evening"));
  });
});

// ── §TM-7 one unit at a time ─────────────────────────────────────────────────

describe("§TM-7 explicit trend association", () => {
  it("carries the content id it was matched against", () => {
    assert.equal(match({ material: ["suede"] }, [garment()], "tc_bbbbbbbbbbbb").contentId, "tc_bbbbbbbbbbbb");
  });

  it("matches several units independently, never as one flattened report", () => {
    const garments = [
      garment({ id: "suede", material: "suede" }),
      garment({ id: "burgundy", primaryColor: "Burgundy" }),
    ];
    const results = matchTrendsToCloset([
      { contentId: "tc_suede", facets: { material: ["suede"] } },
      { contentId: "tc_burgundy", facets: { colourFamily: ["red-burgundy"] } },
    ], garments);

    assert.equal(results.length, 2);
    assert.deepEqual(results[0].matches.map((m) => m.garmentId), ["suede"]);
    assert.deepEqual(results[1].matches.map((m) => m.garmentId), ["burgundy"]);
  });

  it("an empty closet yields an honest zero rather than an error", () => {
    const r = match({ material: ["suede"] }, []);
    assert.equal(r.available, true);
    assert.equal(r.matchCount, 0);
  });
});

// ── §TM-8 AND across facet kinds — the false positives ───────────────────────
//
// A trend that names three things is asking for all three. These are the cases
// the earlier "any one directional facet" rule got wrong.

describe("§TM-8 AND across kinds", () => {
  // Longline blazers, as authored: OUTERWEAR + blazer.
  const LONGLINE_BLAZERS = { category: ["OUTERWEAR"], subcategory: ["blazer"] };

  it("a straight TRENCH does not match Longline blazers", () => {
    const r = match(LONGLINE_BLAZERS, [
      garment({ id: "trench", category: "OUTERWEAR", subcategory: "trench", silhouette: "straight" }),
    ]);
    assert.equal(r.matchCount, 0, "OUTERWEAR alone is not a blazer");
  });

  it("a blazer does match it", () => {
    const r = match(LONGLINE_BLAZERS, [
      garment({ id: "blazer", category: "OUTERWEAR", subcategory: "blazer" }),
    ]);
    assert.equal(r.matchCount, 1);
  });

  it("a blazer in the WRONG CATEGORY does not match", () => {
    const r = match(LONGLINE_BLAZERS, [
      garment({ id: "odd", category: "TOPS", subcategory: "blazer" }),
    ]);
    assert.equal(r.matchCount, 0);
  });

  it("a blazer with the wrong silhouette fails a trend that DOES name silhouette", () => {
    const strict = { category: ["OUTERWEAR"], subcategory: ["blazer"], silhouette: ["straight"] };
    assert.equal(match(strict, [garment({ category: "OUTERWEAR", subcategory: "blazer", silhouette: "fitted" })]).matchCount, 0);
    assert.equal(match(strict, [garment({ category: "OUTERWEAR", subcategory: "blazer", silhouette: "straight" })]).matchCount, 1);
  });

  // Softened tailoring, as authored.
  const SOFTENED_TAILORING = {
    category: ["OUTERWEAR", "BOTTOMS", "DRESSES"],
    silhouette: ["tailored", "straight"],
    formalityBand: ["smart-casual", "business-casual"],
  };

  it("casual straight JEANS do not match Softened tailoring", () => {
    const r = match(SOFTENED_TAILORING, [
      garment({ id: "jeans", category: "BOTTOMS", subcategory: "jeans",
                silhouette: "straight", formality: "casual" }),
    ]);
    assert.equal(r.matchCount, 0, "a matching silhouette is not enough on its own");
  });

  it("the same straight trouser in a smart register DOES match", () => {
    const r = match(SOFTENED_TAILORING, [
      garment({ id: "trouser", category: "BOTTOMS", subcategory: "trouser",
                silhouette: "straight", formality: "smart-casual" }),
    ]);
    assert.equal(r.matchCount, 1);
    assert.equal(r.matches[0].evidence.length, 2, "silhouette and formality both recorded");
  });

  it("a garment missing one authored kind entirely does not match", () => {
    const r = match(SOFTENED_TAILORING, [
      garment({ category: "DRESSES", silhouette: "straight", formality: null }),
    ]);
    assert.equal(r.matchCount, 0, "null is not agreement");
  });

  it("within a kind it is still OR — either formality band qualifies", () => {
    const a = match(SOFTENED_TAILORING, [garment({ category: "DRESSES", silhouette: "tailored", formality: "smart-casual" })]);
    const b = match(SOFTENED_TAILORING, [garment({ category: "DRESSES", silhouette: "tailored", formality: "business-casual" })]);
    assert.equal(a.matchCount, 1);
    assert.equal(b.matchCount, 1);
  });

  it("a one-facet trend stays simple — colour alone qualifies", () => {
    assert.equal(match({ colourFamily: ["white-cream"] }, [garment({ primaryColor: "Ivory" })]).matchCount, 1);
  });

  it("a one-facet trend stays simple — silhouette alone qualifies", () => {
    assert.equal(match({ silhouette: ["asymmetric"] }, [garment({ silhouette: "asymmetric" })]).matchCount, 1);
  });

  it("UNAVAILABLE construction must not make a trend impossible to satisfy", () => {
    // The New Bag Shapes: construction is stripped BEFORE the AND, so the claim
    // rests on category + shape and the east-west bag still qualifies.
    const r = match(
      { category: ["BAGS"], subcategory: ["east-west"], construction: ["soft"] },
      [
        garment({ id: "eastwest", category: "BAGS", subcategory: "east-west" }),
        garment({ id: "tote", category: "BAGS", subcategory: "tote" }),
      ],
    );
    assert.equal(r.available, true);
    assert.equal(r.matchCount, 1);
    assert.equal(r.matches[0].garmentId, "eastwest");
  });

  it("category-only still produces no claim at all", () => {
    const r = match({ category: ["OUTERWEAR"] }, [garment({ category: "OUTERWEAR" })]);
    assert.equal(r.available, false);
    assert.equal(r.matchCount, 0);
  });

  it("every qualifying garment carries evidence for every authored kind", () => {
    const r = match(SOFTENED_TAILORING, [
      garment({ category: "DRESSES", silhouette: "tailored", formality: "smart-casual" }),
    ]);
    const kinds = r.matches[0].evidence.map((e) => e.kind).sort();
    assert.deepEqual(kinds, ["formalityBand", "silhouette"]);
  });
});
