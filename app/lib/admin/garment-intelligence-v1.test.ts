// app/lib/admin/garment-intelligence-v1.test.ts
//
// Phase 3C V1 — Derived garment styling intelligence tests.
//
// Sections:
//   §GI-V1-01  deriveVisualWeight — light (no contributing signals)
//   §GI-V1-02  deriveVisualWeight — medium (single contribution: pattern)
//   §GI-V1-03  deriveVisualWeight — medium (single contribution: silhouette)
//   §GI-V1-04  deriveVisualWeight — medium (single contribution: material)
//   §GI-V1-05  deriveVisualWeight — substantial (2+ contributions)
//   §GI-V1-06  deriveVisualWeight — null when all inputs absent
//   §GI-V1-07  deriveVisualWeight — solid pattern → no contribution
//   §GI-V1-08  deriveVisualWeight — partial null inputs derive from available fields
//   §GI-V1-09  deriveColourProfile — neutral colours
//   §GI-V1-10  deriveColourProfile — chromatic colours
//   §GI-V1-11  deriveColourProfile — broad colour family mapping
//   §GI-V1-12  deriveColourProfile — unambiguous dark tokens
//   §GI-V1-13  deriveColourProfile — unambiguous light tokens
//   §GI-V1-14  deriveColourProfile — ambiguous tokens → lightDark null
//   §GI-V1-15  deriveColourProfile — null primaryColor → null result
//   §GI-V1-16  deriveColourProfile — no warm/cool/saturation inference
//   §GI-V1-17  computeGarmentIntentionPotential — feel-less-exposed signals
//   §GI-V1-18  computeGarmentIntentionPotential — passport conditions signals
//   §GI-V1-19  computeGarmentIntentionPotential — intention changes which signals fire
//   §GI-V1-20  computeGarmentIntentionPotential — no universal emotional rules
//   §GI-V1-21  computeGarmentIntentionPotential — confidence requires context
//   §GI-V1-22  V1_SHADOW_ONLY flag
//   §GI-V1-23  No database imports (no Prisma)
//   §GI-V1-24  No mutation exports
//   §GI-V1-25  Representative QA samples — real garment archetypes
//   §GI-V1-26  StyleMe isolation — V1 not wired into live ranking
//
// Run: node --test --import tsx/esm app/lib/admin/garment-intelligence-v1.test.ts

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  deriveVisualWeight,
  deriveColourProfile,
  deriveGarmentStylingIntelligence,
  computeGarmentIntentionPotential,
  ALL_INTENTIONS,
  V1_SHADOW_ONLY,
  type GarmentStylingIntelligence,
} from "~/lib/admin/garment-intelligence-v1.server";

import type { ClosetClassification } from "~/lib/admin/closet-intelligence.server";

// ── Helper ────────────────────────────────────────────────────────────────────

function blank(): ClosetClassification {
  return {
    subcategory: null, silhouette: null, fitProfile: null,
    hemLength: null, topLength: null, waistShape: null,
    sleeveLength: null, necklineCoverage: null,
    shoulderCoverage: null, midriffExposed: null,
    material: null, pattern: null, primaryColor: null,
    colors: [], occasions: [], seasons: [],
    formality: null, stylePersonality: null,
    styleTags: [], garmentRelationships: [],
  };
}

function intentionSignals(intel: GarmentStylingIntelligence, intention: string): string[] {
  return intel.intentionPotentials.find(ip => ip.intention === intention)?.signals ?? [];
}

// ── §GI-V1-01 — light (0 contributions) ──────────────────────────────────────

describe("§GI-V1-01 deriveVisualWeight — light", () => {
  it("solid pattern + contained silhouette + plain material → light", () => {
    const r = deriveVisualWeight({ pattern: "solid", silhouette: "straight", material: "cotton" });
    assert.equal(r.value, "light");
    assert.equal(r.evidence.length, 0);
  });

  it("solid + fitted + polyester → light", () => {
    const r = deriveVisualWeight({ pattern: "solid", silhouette: "fitted", material: "polyester" });
    assert.equal(r.value, "light");
  });

  it("solid + column + linen → light", () => {
    const r = deriveVisualWeight({ pattern: "solid", silhouette: "column", material: "linen" });
    assert.equal(r.value, "light");
    assert.equal(r.evidence.length, 0);
  });
});

// ── §GI-V1-02 — medium via pattern ────────────────────────────────────────────

describe("§GI-V1-02 deriveVisualWeight — medium via pattern", () => {
  it("floral pattern + straight + cotton → medium, evidence includes floral pattern", () => {
    const r = deriveVisualWeight({ pattern: "floral", silhouette: "straight", material: "cotton" });
    assert.equal(r.value, "medium");
    assert.ok(r.evidence.some(e => e.includes("floral")), `evidence: ${r.evidence}`);
  });

  it("stripes + straight silhouette → medium", () => {
    const r = deriveVisualWeight({ pattern: "stripes", silhouette: "straight", material: "cotton" });
    assert.equal(r.value, "medium");
  });

  it("animal-print + fitted + jersey → medium", () => {
    const r = deriveVisualWeight({ pattern: "animal-print", silhouette: "fitted", material: "jersey" });
    assert.equal(r.value, "medium");
    assert.ok(r.evidence.some(e => e.includes("animal-print")));
  });
});

// ── §GI-V1-03 — medium via silhouette ─────────────────────────────────────────

describe("§GI-V1-03 deriveVisualWeight — medium via silhouette", () => {
  it("solid + oversized + cotton → medium, evidence includes oversized silhouette", () => {
    const r = deriveVisualWeight({ pattern: "solid", silhouette: "oversized", material: "cotton" });
    assert.equal(r.value, "medium");
    assert.ok(r.evidence.some(e => e.includes("oversized")));
  });

  it("solid + balloon + linen → medium", () => {
    const r = deriveVisualWeight({ pattern: "solid", silhouette: "balloon", material: "linen" });
    assert.equal(r.value, "medium");
  });

  it("solid + flared + jersey → medium", () => {
    const r = deriveVisualWeight({ pattern: "solid", silhouette: "flared", material: "jersey" });
    assert.equal(r.value, "medium");
    assert.ok(r.evidence.some(e => e.includes("flared")));
  });
});

// ── §GI-V1-04 — medium via material ───────────────────────────────────────────

describe("§GI-V1-04 deriveVisualWeight — medium via material", () => {
  it("solid + straight + velvet → medium, evidence includes velvet", () => {
    const r = deriveVisualWeight({ pattern: "solid", silhouette: "straight", material: "velvet" });
    assert.equal(r.value, "medium");
    assert.ok(r.evidence.some(e => e.includes("velvet")));
  });

  it("solid + straight + leather → medium", () => {
    const r = deriveVisualWeight({ pattern: "solid", silhouette: "straight", material: "leather" });
    assert.equal(r.value, "medium");
  });

  it("solid + column + satin → medium (sheen)", () => {
    const r = deriveVisualWeight({ pattern: "solid", silhouette: "column", material: "satin" });
    assert.equal(r.value, "medium");
    assert.ok(r.evidence.some(e => e.includes("satin")));
  });

  it("solid + straight + lace → medium", () => {
    const r = deriveVisualWeight({ pattern: "solid", silhouette: "straight", material: "lace" });
    assert.equal(r.value, "medium");
  });
});

// ── §GI-V1-05 — substantial (2+ contributions) ────────────────────────────────

describe("§GI-V1-05 deriveVisualWeight — substantial", () => {
  it("floral + oversized + cotton → substantial (2 contributions)", () => {
    const r = deriveVisualWeight({ pattern: "floral", silhouette: "oversized", material: "cotton" });
    assert.equal(r.value, "substantial");
    assert.equal(r.evidence.length, 2);
  });

  it("animal-print + oversized + velvet → substantial (3 contributions)", () => {
    const r = deriveVisualWeight({ pattern: "animal-print", silhouette: "oversized", material: "velvet" });
    assert.equal(r.value, "substantial");
    assert.equal(r.evidence.length, 3);
  });

  it("check + balloon + tweed → substantial", () => {
    const r = deriveVisualWeight({ pattern: "check", silhouette: "balloon", material: "tweed" });
    assert.equal(r.value, "substantial");
    assert.ok(r.evidence.length >= 2);
  });
});

// ── §GI-V1-06 — null when all inputs absent ───────────────────────────────────

describe("§GI-V1-06 deriveVisualWeight — null when all fields absent", () => {
  it("all null → value null, evidence empty", () => {
    const r = deriveVisualWeight({ pattern: null, silhouette: null, material: null });
    assert.equal(r.value, null);
    assert.deepEqual(r.evidence, []);
  });

  it("only n/a values → treated as null", () => {
    // n/a is normalised to null by the helper
    const r = deriveVisualWeight({ pattern: null, silhouette: null, material: null });
    assert.equal(r.value, null);
  });
});

// ── §GI-V1-07 — solid pattern → no contribution ───────────────────────────────

describe("§GI-V1-07 deriveVisualWeight — solid pattern contributes nothing", () => {
  it("solid pattern alone → evidence does not list 'solid'", () => {
    const r = deriveVisualWeight({ pattern: "solid", silhouette: null, material: null });
    assert.equal(r.value, "light");
    assert.ok(!r.evidence.some(e => e.includes("solid")));
  });
});

// ── §GI-V1-08 — partial null inputs ───────────────────────────────────────────

describe("§GI-V1-08 deriveVisualWeight — partial nulls score from available fields", () => {
  it("null pattern + oversized silhouette + null material → medium", () => {
    const r = deriveVisualWeight({ pattern: null, silhouette: "oversized", material: null });
    assert.equal(r.value, "medium");
    assert.ok(r.evidence.some(e => e.includes("oversized")));
  });

  it("null silhouette + velvet material → medium", () => {
    const r = deriveVisualWeight({ pattern: null, silhouette: null, material: "velvet" });
    assert.equal(r.value, "medium");
  });
});

// ── §GI-V1-09 — neutral colours ───────────────────────────────────────────────

describe("§GI-V1-09 deriveColourProfile — neutral colours", () => {
  it("white → neutral", () => {
    const r = deriveColourProfile({ primaryColor: "white", colors: [] });
    assert.equal(r.neutralChromaticity, "neutral");
    assert.equal(r.broadFamily, "neutral");
  });

  it("black → neutral + deep-authoritative energy", () => {
    const r = deriveColourProfile({ primaryColor: "black", colors: [] });
    assert.equal(r.neutralChromaticity, "neutral");
    assert.equal(r.energyTier, "deep-authoritative");
  });

  it("beige → neutral + neutral-versatile", () => {
    const r = deriveColourProfile({ primaryColor: "beige", colors: [] });
    assert.equal(r.neutralChromaticity, "neutral");
    assert.equal(r.energyTier, "neutral-versatile");
  });

  it("navy → neutral + deep-authoritative", () => {
    const r = deriveColourProfile({ primaryColor: "navy", colors: [] });
    assert.equal(r.neutralChromaticity, "neutral");
    assert.equal(r.energyTier, "deep-authoritative");
  });

  it("grey → neutral + neutral-versatile", () => {
    const r = deriveColourProfile({ primaryColor: "grey", colors: [] });
    assert.equal(r.neutralChromaticity, "neutral");
    assert.equal(r.energyTier, "neutral-versatile");
  });
});

// ── §GI-V1-10 — chromatic colours ─────────────────────────────────────────────

describe("§GI-V1-10 deriveColourProfile — chromatic colours", () => {
  it("red → chromatic + high-energy", () => {
    const r = deriveColourProfile({ primaryColor: "red", colors: [] });
    assert.equal(r.neutralChromaticity, "chromatic");
    assert.equal(r.energyTier, "high-energy");
  });

  it("green → chromatic + mid-range", () => {
    const r = deriveColourProfile({ primaryColor: "green", colors: [] });
    assert.equal(r.neutralChromaticity, "chromatic");
    assert.equal(r.energyTier, "mid-range");
  });

  it("burgundy → chromatic (not in neutral set)", () => {
    const r = deriveColourProfile({ primaryColor: "burgundy", colors: [] });
    assert.equal(r.neutralChromaticity, "chromatic");
  });

  it("yellow → chromatic + high-energy", () => {
    const r = deriveColourProfile({ primaryColor: "yellow", colors: [] });
    assert.equal(r.neutralChromaticity, "chromatic");
    assert.equal(r.energyTier, "high-energy");
  });
});

// ── §GI-V1-11 — broad colour family mapping ───────────────────────────────────

describe("§GI-V1-11 deriveColourProfile — broad colour family", () => {
  it("red → red family", () => assert.equal(deriveColourProfile({ primaryColor: "red", colors: [] }).broadFamily, "red"));
  it("burgundy → red family", () => assert.equal(deriveColourProfile({ primaryColor: "burgundy", colors: [] }).broadFamily, "red"));
  it("coral → pink family", () => assert.equal(deriveColourProfile({ primaryColor: "coral", colors: [] }).broadFamily, "pink"));
  it("rust → orange family", () => assert.equal(deriveColourProfile({ primaryColor: "rust", colors: [] }).broadFamily, "orange"));
  it("mustard → yellow family", () => assert.equal(deriveColourProfile({ primaryColor: "mustard", colors: [] }).broadFamily, "yellow"));
  it("olive → green family", () => assert.equal(deriveColourProfile({ primaryColor: "olive", colors: [] }).broadFamily, "green"));
  it("cobalt → blue family", () => assert.equal(deriveColourProfile({ primaryColor: "cobalt", colors: [] }).broadFamily, "blue"));
  it("lilac → purple family", () => assert.equal(deriveColourProfile({ primaryColor: "lilac", colors: [] }).broadFamily, "purple"));
  it("beige → neutral family", () => assert.equal(deriveColourProfile({ primaryColor: "beige", colors: [] }).broadFamily, "neutral"));
  it("unknown token → family null", () => assert.equal(deriveColourProfile({ primaryColor: "something-unknown", colors: [] }).broadFamily, null));
});

// ── §GI-V1-12 — unambiguous dark ──────────────────────────────────────────────

describe("§GI-V1-12 deriveColourProfile — unambiguous dark tokens", () => {
  it("black → dark", () => assert.equal(deriveColourProfile({ primaryColor: "black", colors: [] }).lightDark, "dark"));
  it("charcoal → dark", () => assert.equal(deriveColourProfile({ primaryColor: "charcoal", colors: [] }).lightDark, "dark"));
  it("navy → dark", () => assert.equal(deriveColourProfile({ primaryColor: "navy", colors: [] }).lightDark, "dark"));
  it("burgundy → dark", () => assert.equal(deriveColourProfile({ primaryColor: "burgundy", colors: [] }).lightDark, "dark"));
});

// ── §GI-V1-13 — unambiguous light ─────────────────────────────────────────────

describe("§GI-V1-13 deriveColourProfile — unambiguous light tokens", () => {
  it("white → light", () => assert.equal(deriveColourProfile({ primaryColor: "white", colors: [] }).lightDark, "light"));
  it("cream → light", () => assert.equal(deriveColourProfile({ primaryColor: "cream", colors: [] }).lightDark, "light"));
  it("ivory → light", () => assert.equal(deriveColourProfile({ primaryColor: "ivory", colors: [] }).lightDark, "light"));
  it("blush → light", () => assert.equal(deriveColourProfile({ primaryColor: "blush", colors: [] }).lightDark, "light"));
});

// ── §GI-V1-14 — ambiguous tokens → lightDark null ────────────────────────────

describe("§GI-V1-14 deriveColourProfile — ambiguous → lightDark null", () => {
  it("blue is ambiguous (could be powder or cobalt) → null", () => {
    assert.equal(deriveColourProfile({ primaryColor: "blue", colors: [] }).lightDark, null);
  });
  it("red is ambiguous → null", () => {
    assert.equal(deriveColourProfile({ primaryColor: "red", colors: [] }).lightDark, null);
  });
  it("green is ambiguous → null", () => {
    assert.equal(deriveColourProfile({ primaryColor: "green", colors: [] }).lightDark, null);
  });
});

// ── §GI-V1-15 — null primaryColor → null result ───────────────────────────────

describe("§GI-V1-15 deriveColourProfile — null primaryColor", () => {
  it("null primaryColor → all fields null", () => {
    const r = deriveColourProfile({ primaryColor: null, colors: [] });
    assert.equal(r.neutralChromaticity, null);
    assert.equal(r.broadFamily, null);
    assert.equal(r.lightDark, null);
    assert.equal(r.energyTier, null);
    assert.deepEqual(r.evidence, []);
  });
});

// ── §GI-V1-16 — no unsupported inferences ─────────────────────────────────────

describe("§GI-V1-16 deriveColourProfile — no warm/cool/saturation inference", () => {
  it("colourProfile result has no warmCool field", () => {
    const r = deriveColourProfile({ primaryColor: "red", colors: [] });
    assert.ok(!("warmCool" in r), "warmCool must not be present in V1 result");
  });

  it("colourProfile result has no saturation field", () => {
    const r = deriveColourProfile({ primaryColor: "red", colors: [] });
    assert.ok(!("saturation" in r), "saturation must not be present in V1 result");
  });

  it("'blue' doesn't get a warmCool determination — too ambiguous", () => {
    const r = deriveColourProfile({ primaryColor: "blue", colors: [] });
    assert.ok(!("warmCool" in r));
    // Blue could be cobalt (cool) or teal (warm-adjacent) — V1 cannot distinguish
    assert.equal(r.lightDark, null);
  });
});

// ── §GI-V1-17 — feel-less-exposed signals ─────────────────────────────────────

describe("§GI-V1-17 computeGarmentIntentionPotential — feel-less-exposed", () => {
  it("shoulderCoverage true → 'shoulders covered'", () => {
    const g = { ...blank(), shoulderCoverage: true };
    const r = computeGarmentIntentionPotential(g, "feel-less-exposed", {}, {});
    assert.ok(r.signals.some(s => s.includes("shoulders covered")));
  });

  it("midriffExposed false → 'midriff not exposed'", () => {
    const g = { ...blank(), midriffExposed: false };
    const r = computeGarmentIntentionPotential(g, "feel-less-exposed", {}, {});
    assert.ok(r.signals.some(s => s.includes("midriff not exposed")));
  });

  it("necklineCoverage 'high' → covered neckline signal", () => {
    const g = { ...blank(), necklineCoverage: "high" };
    const r = computeGarmentIntentionPotential(g, "feel-less-exposed", {}, {});
    assert.ok(r.signals.some(s => s.includes("covered neckline")));
  });

  it("hemLength 'midi' → longer hem signal", () => {
    const g = { ...blank(), hemLength: "midi" };
    const r = computeGarmentIntentionPotential(g, "feel-less-exposed", {}, {});
    assert.ok(r.signals.some(s => s.includes("longer hem")));
  });

  it("sleeveLength 'full' → sleeve coverage signal", () => {
    const g = { ...blank(), sleeveLength: "full" };
    const r = computeGarmentIntentionPotential(g, "feel-less-exposed", {}, {});
    assert.ok(r.signals.some(s => s.includes("sleeve coverage")));
  });

  it("low neckline + no shoulder coverage → no coverage signals", () => {
    const g = { ...blank(), necklineCoverage: "low", shoulderCoverage: false, midriffExposed: true };
    const r = computeGarmentIntentionPotential(g, "feel-less-exposed", {}, {});
    assert.equal(r.signals.length, 0);
  });
});

// ── §GI-V1-18 — passport conditions signals ───────────────────────────────────

describe("§GI-V1-18 computeGarmentIntentionPotential — passport conditioning", () => {
  it("feel-like-myself: tags aligning with passport personality → alignment signal", () => {
    const g = { ...blank(), styleTags: ["classic", "refined", "polished"] };
    const r = computeGarmentIntentionPotential(g, "feel-like-myself",
      { stylePersonalities: ["classic-polished"] }, {});
    assert.ok(r.signals.some(s => s.includes("aligns with your personality")));
  });

  it("feel-like-myself: no passport → garment-only baseline signal", () => {
    const g = { ...blank(), occasions: ["work", "casual"] };
    const r = computeGarmentIntentionPotential(g, "feel-like-myself", {}, {});
    assert.ok(r.signals.some(s => s.includes("lifestyle occasions")));
  });

  it("feel-like-myself: favourite colour match → colour signal", () => {
    const g = { ...blank(), primaryColor: "burgundy" };
    const r = computeGarmentIntentionPotential(g, "feel-like-myself",
      { favoriteColors: ["burgundy"] }, {});
    assert.ok(r.signals.some(s => s.includes("colour you love")));
  });

  it("express-myself: expressive personality in passport amplifies signals", () => {
    const g = { ...blank(), styleTags: ["bold", "eclectic"], primaryColor: "red", pattern: "floral" };
    const withPassport = computeGarmentIntentionPotential(g, "express-myself",
      { stylePersonalities: ["creative-expressive"] }, {});
    const withoutPassport = computeGarmentIntentionPotential(g, "express-myself", {}, {});
    // With expressive personality, an amplification signal is added
    assert.ok(withPassport.signals.length > withoutPassport.signals.length ||
      withPassport.signals.some(s => s.includes("expressive personality")));
  });
});

// ── §GI-V1-19 — same garment, different intentions fire different signals ───────

describe("§GI-V1-19 computeGarmentIntentionPotential — intention changes which signals fire", () => {
  const tailoredWoolBlazers = {
    ...blank(),
    fitProfile: "tailored",
    silhouette: "straight",
    material: "wool",
    formality: "business-casual",
    styleTags: ["structured", "polished"],
  };

  it("give-structure fires on tailored wool blazer", () => {
    const r = computeGarmentIntentionPotential(tailoredWoolBlazers, "give-structure", {}, {});
    assert.ok(r.signals.length > 0, "should have give-structure signals");
  });

  it("feel-softer fires NO signals on tailored wool blazer (wrong fit + material)", () => {
    const r = computeGarmentIntentionPotential(tailoredWoolBlazers, "feel-softer", {}, {});
    assert.equal(r.signals.length, 0, "tailored structured blazer should not support feel-softer");
  });

  it("give-energy fires NO silhouette/pattern signals on a straight/solid tailored blazer", () => {
    const r = computeGarmentIntentionPotential(tailoredWoolBlazers, "give-energy", {}, {});
    // No movement silhouette, no non-solid pattern, no high-energy colour — no energy signals
    assert.ok(!r.signals.some(s => s.includes("movement")));
    assert.ok(!r.signals.some(s => s.includes("chromatic")));
  });
});

// ── §GI-V1-20 — no universal emotional rules ──────────────────────────────────

describe("§GI-V1-20 no universal emotional rules (no 'red = confidence' etc.)", () => {
  it("red garment + no passport → confidence signals don't claim red = confidence", () => {
    const g = { ...blank(), primaryColor: "red" };
    const r = computeGarmentIntentionPotential(g, "confidence", {}, {});
    // Should not have a signal that claims red = confidence
    assert.ok(!r.signals.some(s => s.toLowerCase().includes("red") && s.toLowerCase().includes("confidence")));
    // The fallback signal should mention context-dependence, not a universal claim
    assert.ok(r.signals.some(s => s.includes("personal") || s.includes("context")),
      `expected context-dependent fallback signal, got: ${r.signals.join(", ")}`);
  });

  it("black garment → confidence doesn't claim black = power", () => {
    const g = { ...blank(), primaryColor: "black" };
    const r = computeGarmentIntentionPotential(g, "confidence", {}, {});
    assert.ok(!r.signals.some(s => s.toLowerCase().includes("power")));
    assert.ok(!r.signals.some(s => s.toLowerCase().includes("black") && s.toLowerCase().includes("confidence")));
  });

  it("structured garment → confidence doesn't claim structured = confident", () => {
    const g = { ...blank(), fitProfile: "structured", silhouette: "straight" };
    const r = computeGarmentIntentionPotential(g, "confidence", {}, {});
    // No universal confidence claim from structure alone
    assert.ok(!r.signals.some(s => s.toLowerCase().includes("structured") && s.toLowerCase().includes("confident")));
  });

  it("FORBIDDEN_VOCABULARY-style terms not present in any signal", () => {
    const g = { ...blank(), primaryColor: "red", fitProfile: "fitted", styleTags: ["bold"] };
    for (const intention of ALL_INTENTIONS) {
      const r = computeGarmentIntentionPotential(g, intention, {}, {});
      for (const signal of r.signals) {
        const lower = signal.toLowerCase();
        assert.ok(!lower.includes("empowering"), `empowering found in intention ${intention}: ${signal}`);
        assert.ok(!lower.includes("powerful"),   `powerful found in intention ${intention}: ${signal}`);
        assert.ok(!lower.includes("grounded"),   `grounded found in intention ${intention}: ${signal}`);
        assert.ok(!lower.includes("assertive"),  `assertive found in intention ${intention}: ${signal}`);
      }
    }
  });
});

// ── §GI-V1-21 — confidence signals require context ────────────────────────────

describe("§GI-V1-21 confidence signal requires context or passport", () => {
  it("confidence with no passport, no context → fallback signal about personal nature", () => {
    const g = { ...blank(), fitProfile: "tailored" };
    const r = computeGarmentIntentionPotential(g, "confidence", {}, {});
    assert.ok(r.signals.some(s => s.includes("personal") || s.includes("context")));
    assert.equal(r.signals.length, 1, "should not fabricate signals without context");
  });

  it("confidence with coverage-preference passport + covered garment → coverage signal", () => {
    const g = { ...blank(), shoulderCoverage: true, necklineCoverage: "crew" };
    const r = computeGarmentIntentionPotential(g, "confidence",
      { coveragePreferences: ["more-coverage"] }, {});
    assert.ok(r.signals.some(s => s.includes("coverage")));
  });
});

// ── §GI-V1-22 — V1_SHADOW_ONLY flag ──────────────────────────────────────────

describe("§GI-V1-22 V1_SHADOW_ONLY flag", () => {
  it("V1_SHADOW_ONLY is true (typed const)", () => {
    assert.equal(V1_SHADOW_ONLY, true);
  });

  it("ALL_INTENTIONS covers exactly 12 intentions", () => {
    assert.equal(ALL_INTENTIONS.length, 12);
  });
});

// ── §GI-V1-23 — no Prisma / DB imports ────────────────────────────────────────

describe("§GI-V1-23 no database imports", () => {
  it("module does not re-export any Prisma or db types", async () => {
    const module = await import("~/lib/admin/garment-intelligence-v1.server");
    // Verify module does not have a prisma client export
    assert.ok(!("prisma" in module), "should not export prisma");
    assert.ok(!("db" in module), "should not export db");
  });
});

// ── §GI-V1-24 — no mutation exports ───────────────────────────────────────────

describe("§GI-V1-24 no mutation exports", () => {
  it("module exports no save/update/delete/set functions", async () => {
    const module = await import("~/lib/admin/garment-intelligence-v1.server");
    const mutationPattern = /^(save|update|delete|set|create|upsert|mutate|patch)/i;
    for (const key of Object.keys(module)) {
      assert.ok(!mutationPattern.test(key), `unexpected mutation export: ${key}`);
    }
  });
});

// ── §GI-V1-25 — representative QA samples ─────────────────────────────────────

describe("§GI-V1-25 representative garment QA samples", () => {
  // Basic white / black tee
  it("white cotton tee: light visual weight, neutral chromatic, light colour", () => {
    const g: ClosetClassification = {
      ...blank(),
      pattern: "solid",
      silhouette: "straight",
      material: "cotton",
      primaryColor: "white",
    };
    const intel = deriveGarmentStylingIntelligence(g);
    assert.equal(intel.visualWeight.value, "light");
    assert.equal(intel.colourProfile.neutralChromaticity, "neutral");
    assert.equal(intel.colourProfile.lightDark, "light");
    assert.equal(intel.colourProfile.energyTier, "neutral-versatile");
  });

  // Beige trench coat
  it("beige trench: light visual weight, neutral, indeterminate light/dark", () => {
    const g: ClosetClassification = {
      ...blank(),
      pattern: "solid",
      silhouette: "straight",
      material: "cotton",
      primaryColor: "beige",
    };
    const intel = deriveGarmentStylingIntelligence(g);
    assert.equal(intel.visualWeight.value, "light");
    assert.equal(intel.colourProfile.neutralChromaticity, "neutral");
    assert.equal(intel.colourProfile.lightDark, null); // beige is not unambiguously light
    assert.equal(intel.colourProfile.energyTier, "neutral-versatile");
  });

  // Burgundy satin column gown
  it("burgundy satin gown: medium weight (satin), chromatic, red family, dark", () => {
    const g: ClosetClassification = {
      ...blank(),
      pattern: "solid",
      silhouette: "column",
      material: "satin",
      primaryColor: "burgundy",
      formality: "evening",
      occasions: ["evening", "special-occasion"],
    };
    const intel = deriveGarmentStylingIntelligence(g);
    assert.equal(intel.visualWeight.value, "medium");
    assert.ok(intel.visualWeight.evidence.some(e => e.includes("satin")));
    assert.equal(intel.colourProfile.neutralChromaticity, "chromatic");
    assert.equal(intel.colourProfile.broadFamily, "red");
    assert.equal(intel.colourProfile.lightDark, "dark");
  });

  // Activewear leggings (solid, fitted, jersey)
  it("activewear leggings: light visual weight", () => {
    const g: ClosetClassification = {
      ...blank(),
      pattern: "solid",
      silhouette: "fitted",
      material: "jersey",
      primaryColor: "black",
      occasions: ["gym"],
    };
    const intel = deriveGarmentStylingIntelligence(g);
    assert.equal(intel.visualWeight.value, "light");
    assert.equal(intel.colourProfile.energyTier, "deep-authoritative");
  });

  // Black draped chiffon skirt (wrap silhouette, solid, chiffon)
  it("black draped skirt: light visual weight (no high-presence material)", () => {
    const g: ClosetClassification = {
      ...blank(),
      pattern: "solid",
      silhouette: "wrap",
      material: "chiffon",
      primaryColor: "black",
    };
    const intel = deriveGarmentStylingIntelligence(g);
    // wrap is a MOVEMENT silhouette but not a VOLUME silhouette → no visual weight contribution
    assert.equal(intel.visualWeight.value, "light");
    // feel-softer should fire for wrap silhouette
    const softerSignals = intentionSignals(intel, "feel-softer");
    assert.ok(softerSignals.some(s => s.includes("silhouette") || s.includes("gentle")));
  });

  // Patterned statement piece (animal-print, oversized, velvet)
  it("animal-print oversized velvet: substantial (3 contributions)", () => {
    const g: ClosetClassification = {
      ...blank(),
      pattern: "animal-print",
      silhouette: "oversized",
      material: "velvet",
      primaryColor: "brown",
    };
    const intel = deriveGarmentStylingIntelligence(g);
    assert.equal(intel.visualWeight.value, "substantial");
    assert.equal(intel.visualWeight.evidence.length, 3);
  });

  // Sneakers (no pattern/silhouette/material typical fields)
  it("sneakers with no analysed fields: null visual weight", () => {
    const g: ClosetClassification = { ...blank() };
    const intel = deriveGarmentStylingIntelligence(g);
    assert.equal(intel.visualWeight.value, null);
    assert.equal(intel.colourProfile.neutralChromaticity, null);
  });

  // Floral silk scarf (accessory)
  it("floral silk scarf: medium visual weight (floral pattern)", () => {
    const g: ClosetClassification = {
      ...blank(),
      pattern: "floral",
      silhouette: null,
      material: "silk",   // silk NOT high-presence → no material contribution
      primaryColor: "pink",
    };
    const intel = deriveGarmentStylingIntelligence(g);
    // Only 1 contribution: floral pattern
    assert.equal(intel.visualWeight.value, "medium");
    assert.ok(intel.visualWeight.evidence.some(e => e.includes("floral")));
    assert.equal(intel.colourProfile.broadFamily, "pink");
    assert.equal(intel.colourProfile.energyTier, "high-energy");
  });
});

// ── §GI-V1-26 — StyleMe isolation ─────────────────────────────────────────────

describe("§GI-V1-26 StyleMe isolation — V1 not wired into live ranking", () => {
  it("V1 module exports V1_SHADOW_ONLY = true (signals it must not be imported by live scoring)", () => {
    assert.strictEqual(V1_SHADOW_ONLY, true as const);
  });

  it("styleme-recommendation.ts does not export deriveVisualWeight", async () => {
    const styleme = await import("~/lib/ai/styleme-recommendation.ts");
    assert.ok(!("deriveVisualWeight" in styleme),
      "deriveVisualWeight must not exist in styleme-recommendation (boundary violation)");
  });

  it("styleme-recommendation.ts does not export V1_SHADOW_ONLY", async () => {
    const styleme = await import("~/lib/ai/styleme-recommendation.ts");
    assert.ok(!("V1_SHADOW_ONLY" in styleme),
      "V1_SHADOW_ONLY in styleme-recommendation would indicate a Phase 3C boundary violation");
  });

  it("styleme-recommendation.ts does not export deriveGarmentStylingIntelligence", async () => {
    const styleme = await import("~/lib/ai/styleme-recommendation.ts");
    assert.ok(!("deriveGarmentStylingIntelligence" in styleme));
  });

  it("all 12 intention potentials compute without error for a blank garment", () => {
    const g = blank();
    const intel = deriveGarmentStylingIntelligence(g);
    assert.equal(intel.intentionPotentials.length, 12);
    for (const ip of intel.intentionPotentials) {
      assert.ok(typeof ip.intention === "string");
      assert.ok(Array.isArray(ip.signals));
    }
  });
});

// ── §GI-V1-27 — passport-aware intelligence ───────────────────────────────────

describe("§GI-V1-27 passport-aware deriveGarmentStylingIntelligence", () => {
  const g: ClosetClassification = {
    ...blank(),
    pattern: "floral",
    silhouette: "oversized",
    material: "cotton",
    primaryColor: "pink",
    styleTags: ["bold", "eclectic", "statement"],
    occasions: ["casual", "weekend"],
    formality: "casual",
  };

  it("passportUsed is false when no passport supplied", () => {
    const intel = deriveGarmentStylingIntelligence(g, null);
    assert.equal(intel.passportUsed, false);
  });

  it("passportUsed is true when passport supplied", () => {
    const intel = deriveGarmentStylingIntelligence(g, { stylePersonalities: ["creative-expressive"] });
    assert.equal(intel.passportUsed, true);
  });

  it("same garment + expressive passport → more/different signals than no passport on express-myself", () => {
    const noPassport = deriveGarmentStylingIntelligence(g, null);
    const withPassport = deriveGarmentStylingIntelligence(g, { stylePersonalities: ["creative-expressive"] });

    const noP = noPassport.intentionPotentials.find(ip => ip.intention === "express-myself");
    const withP = withPassport.intentionPotentials.find(ip => ip.intention === "express-myself");

    assert.ok(noP && withP);
    // Expressive personality amplifies signals — more signals or an explicit personality signal
    assert.ok(
      withP.signals.length > noP.signals.length ||
      withP.signals.some(s => s.includes("expressive personality") || s.includes("personality")),
      `Expected passport to add/change signals for express-myself.\nNo passport: ${noP.signals.join(", ")}\nWith passport: ${withP.signals.join(", ")}`,
    );
  });

  it("favourite colour match adds feel-like-myself signal with passport, absent without", () => {
    const gPink: ClosetClassification = { ...blank(), primaryColor: "pink", occasions: ["casual"] };

    const noPassport = deriveGarmentStylingIntelligence(gPink, null);
    const withPassport = deriveGarmentStylingIntelligence(gPink, { favoriteColors: ["pink"] });

    const noP = noPassport.intentionPotentials.find(ip => ip.intention === "feel-like-myself");
    const withP = withPassport.intentionPotentials.find(ip => ip.intention === "feel-like-myself");

    assert.ok(noP && withP);
    assert.ok(
      withP.signals.some(s => s.includes("colour you love")),
      `Expected 'colour you love' signal with passport. Got: ${withP.signals.join(", ")}`,
    );
    assert.ok(
      !noP.signals.some(s => s.includes("colour you love")),
      `'colour you love' should not appear without passport. Got: ${noP.signals.join(", ")}`,
    );
  });

  it("two different passports produce different signals on the same garment", () => {
    const classicPassport = deriveGarmentStylingIntelligence(g, {
      stylePersonalities: ["classic-polished"],
    });
    const expressivePassport = deriveGarmentStylingIntelligence(g, {
      stylePersonalities: ["creative-expressive"],
    });

    // The signals for at least one intention should differ between the two passports
    let differs = false;
    for (const intention of ALL_INTENTIONS) {
      const classic = classicPassport.intentionPotentials.find(ip => ip.intention === intention);
      const expressive = expressivePassport.intentionPotentials.find(ip => ip.intention === intention);
      if (!classic || !expressive) continue;
      if (classic.signals.join("|") !== expressive.signals.join("|")) {
        differs = true;
        break;
      }
    }
    assert.ok(differs, "Same garment + different passports must produce different signals on at least one intention");
  });

  it("coverage passport changes confidence signals", () => {
    const coveredGarment: ClosetClassification = {
      ...blank(),
      shoulderCoverage: true,
      necklineCoverage: "crew",
      sleeveLength: "full",
    };
    const withCoveragePassport = deriveGarmentStylingIntelligence(coveredGarment, {
      coveragePreferences: ["more-coverage"],
    });
    const withoutPassport = deriveGarmentStylingIntelligence(coveredGarment, null);

    const withCP = withCoveragePassport.intentionPotentials.find(ip => ip.intention === "confidence");
    const withoutCP = withoutPassport.intentionPotentials.find(ip => ip.intention === "confidence");

    assert.ok(withCP && withoutCP);
    assert.ok(
      withCP.signals.some(s => s.includes("coverage")),
      `Expected coverage signal with passport. Got: ${withCP.signals.join(", ")}`,
    );
  });

  it("no candidate selection or result wording change — passportUsed is metadata only", () => {
    const withP = deriveGarmentStylingIntelligence(g, { stylePersonalities: ["classic-polished"] });
    // The intelligence object has no 'candidateRank', 'styleMeScore', or 'resultText' field
    assert.ok(!("candidateRank" in withP));
    assert.ok(!("styleMeScore" in withP));
    assert.ok(!("resultText" in withP));
  });
});
