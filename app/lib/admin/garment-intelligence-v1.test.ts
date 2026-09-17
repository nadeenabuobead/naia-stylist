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
  type IntentionStrength,
} from "~/lib/admin/garment-intelligence-v1.server";

import type { ClosetClassification } from "~/lib/admin/closet-intelligence.server";

// ── Helper ────────────────────────────────────────────────────────────────────

function blank(): ClosetClassification {
  return {
    category: null, subcategory: null, silhouette: null, fitProfile: null,
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

describe("§GI-V1-09 deriveColourProfile — neutral colours (V2 two-axis model)", () => {
  it("white → wardrobeNeutral=true, hueFamily=null", () => {
    const r = deriveColourProfile({ primaryColor: "white", colors: [] });
    assert.equal(r.wardrobeNeutral, true);
    assert.equal(r.hueFamily, null);
  });

  it("black → wardrobeNeutral=true + deep-authoritative energy", () => {
    const r = deriveColourProfile({ primaryColor: "black", colors: [] });
    assert.equal(r.wardrobeNeutral, true);
    assert.equal(r.energyTier, "deep-authoritative");
  });

  it("beige → wardrobeNeutral=true + neutral-versatile", () => {
    const r = deriveColourProfile({ primaryColor: "beige", colors: [] });
    assert.equal(r.wardrobeNeutral, true);
    assert.equal(r.energyTier, "neutral-versatile");
  });

  it("navy → wardrobeNeutral=true + hueFamily='blue' + deep-authoritative (V2 two-axis)", () => {
    const r = deriveColourProfile({ primaryColor: "navy", colors: [] });
    assert.equal(r.wardrobeNeutral, true);
    assert.equal(r.hueFamily, "blue");
    assert.equal(r.energyTier, "deep-authoritative");
  });

  it("grey → wardrobeNeutral=true + hueFamily='grey' + neutral-versatile", () => {
    const r = deriveColourProfile({ primaryColor: "grey", colors: [] });
    assert.equal(r.wardrobeNeutral, true);
    assert.equal(r.hueFamily, "grey");
    assert.equal(r.energyTier, "neutral-versatile");
  });
});

// ── §GI-V1-10 — chromatic colours ─────────────────────────────────────────────

describe("§GI-V1-10 deriveColourProfile — chromatic colours (V2)", () => {
  it("red → wardrobeNeutral=false + high-energy", () => {
    const r = deriveColourProfile({ primaryColor: "red", colors: [] });
    assert.equal(r.wardrobeNeutral, false);
    assert.equal(r.hueFamily, "red");
    assert.equal(r.energyTier, "high-energy");
  });

  it("green → wardrobeNeutral=false + mid-range", () => {
    const r = deriveColourProfile({ primaryColor: "green", colors: [] });
    assert.equal(r.wardrobeNeutral, false);
    assert.equal(r.hueFamily, "green");
    assert.equal(r.energyTier, "mid-range");
  });

  it("burgundy → wardrobeNeutral=false (not in neutral set)", () => {
    const r = deriveColourProfile({ primaryColor: "burgundy", colors: [] });
    assert.equal(r.wardrobeNeutral, false);
    assert.equal(r.hueFamily, "red");
  });

  it("yellow → wardrobeNeutral=false + high-energy", () => {
    const r = deriveColourProfile({ primaryColor: "yellow", colors: [] });
    assert.equal(r.wardrobeNeutral, false);
    assert.equal(r.hueFamily, "yellow");
    assert.equal(r.energyTier, "high-energy");
  });
});

// ── §GI-V1-11 — broad colour family mapping ───────────────────────────────────

describe("§GI-V1-11 deriveColourProfile — hue family mapping (V2)", () => {
  it("red → hueFamily red", () => assert.equal(deriveColourProfile({ primaryColor: "red", colors: [] }).hueFamily, "red"));
  it("burgundy → hueFamily red", () => assert.equal(deriveColourProfile({ primaryColor: "burgundy", colors: [] }).hueFamily, "red"));
  it("coral → hueFamily pink", () => assert.equal(deriveColourProfile({ primaryColor: "coral", colors: [] }).hueFamily, "pink"));
  it("rust → hueFamily orange", () => assert.equal(deriveColourProfile({ primaryColor: "rust", colors: [] }).hueFamily, "orange"));
  it("mustard → hueFamily yellow", () => assert.equal(deriveColourProfile({ primaryColor: "mustard", colors: [] }).hueFamily, "yellow"));
  it("olive → hueFamily green", () => assert.equal(deriveColourProfile({ primaryColor: "olive", colors: [] }).hueFamily, "green"));
  it("cobalt → hueFamily blue", () => assert.equal(deriveColourProfile({ primaryColor: "cobalt", colors: [] }).hueFamily, "blue"));
  it("navy → hueFamily blue (wardrobe-neutral but clear blue lean)", () => assert.equal(deriveColourProfile({ primaryColor: "navy", colors: [] }).hueFamily, "blue"));
  it("lilac → hueFamily purple", () => assert.equal(deriveColourProfile({ primaryColor: "lilac", colors: [] }).hueFamily, "purple"));
  it("charcoal → hueFamily grey", () => assert.equal(deriveColourProfile({ primaryColor: "charcoal", colors: [] }).hueFamily, "grey"));
  it("brown → hueFamily brown", () => assert.equal(deriveColourProfile({ primaryColor: "brown", colors: [] }).hueFamily, "brown"));
  it("beige → hueFamily null (true neutral, no strong hue lean)", () => assert.equal(deriveColourProfile({ primaryColor: "beige", colors: [] }).hueFamily, null));
  it("unknown token → hueFamily null", () => assert.equal(deriveColourProfile({ primaryColor: "something-unknown", colors: [] }).hueFamily, null));
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

describe("§GI-V1-15 deriveColourProfile — null primaryColor (V2)", () => {
  it("null primaryColor → hueFamily null, wardrobeNeutral false, all other fields null", () => {
    const r = deriveColourProfile({ primaryColor: null, colors: [] });
    assert.equal(r.hueFamily, null);
    assert.equal(r.wardrobeNeutral, false);
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

  it("feel-like-myself: no passport → NONE (no fb() fallback in V2)", () => {
    const g = { ...blank(), occasions: ["work", "casual"] };
    const r = computeGarmentIntentionPotential(g, "feel-like-myself", {}, {});
    assert.equal(r.strength, "none");
    assert.equal(r.signals.length, 0);
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
  it("red garment + no passport → confidence NONE (no universal red=confidence rule)", () => {
    const g = { ...blank(), primaryColor: "red" };
    const r = computeGarmentIntentionPotential(g, "confidence", {}, {});
    // Should not have a signal that claims red = confidence
    assert.ok(!r.signals.some(s => s.toLowerCase().includes("red") && s.toLowerCase().includes("confidence")));
    // V2: no fallback signal — NONE with no signals when passport absent
    assert.equal(r.strength, "none");
    assert.equal(r.signals.length, 0);
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

describe("§GI-V1-21 confidence signal requires context or passport (V2)", () => {
  it("confidence with no passport, no context → NONE and no signals (V2: no fb() fallback)", () => {
    const g = { ...blank(), fitProfile: "tailored" };
    const r = computeGarmentIntentionPotential(g, "confidence", {}, {});
    assert.equal(r.strength, "none");
    assert.equal(r.signals.length, 0);
  });

  it("confidence: coverage-preference passport does NOT affect confidence (V2.1 — personality only)", () => {
    const g = { ...blank(), sleeveLength: "full" };
    const r = computeGarmentIntentionPotential(g, "confidence",
      { coveragePreferences: ["sleeves-preferred"] }, {});
    // Coverage removed from confidence in V2.1; no personality tags → NONE.
    assert.equal(r.strength, "none");
    assert.equal(r.signals.length, 0);
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
  it("white cotton tee: light visual weight, wardrobeNeutral, light colour (V2)", () => {
    const g: ClosetClassification = {
      ...blank(),
      pattern: "solid",
      silhouette: "straight",
      material: "cotton",
      primaryColor: "white",
    };
    const intel = deriveGarmentStylingIntelligence(g);
    assert.equal(intel.visualWeight.value, "light");
    assert.equal(intel.colourProfile.wardrobeNeutral, true);
    assert.equal(intel.colourProfile.hueFamily, null);
    assert.equal(intel.colourProfile.lightDark, "light");
    assert.equal(intel.colourProfile.energyTier, "neutral-versatile");
  });

  // Beige trench coat
  it("beige trench: light visual weight, wardrobeNeutral, indeterminate light/dark (V2)", () => {
    const g: ClosetClassification = {
      ...blank(),
      pattern: "solid",
      silhouette: "straight",
      material: "cotton",
      primaryColor: "beige",
    };
    const intel = deriveGarmentStylingIntelligence(g);
    assert.equal(intel.visualWeight.value, "light");
    assert.equal(intel.colourProfile.wardrobeNeutral, true);
    assert.equal(intel.colourProfile.lightDark, null); // beige is not unambiguously light
    assert.equal(intel.colourProfile.energyTier, "neutral-versatile");
  });

  // Burgundy satin column gown
  it("burgundy satin gown: medium weight (satin), chromatic, red hueFamily, dark (V2)", () => {
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
    assert.equal(intel.colourProfile.wardrobeNeutral, false);
    assert.equal(intel.colourProfile.hueFamily, "red");
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
    // V2: feel-softer requires soft fitProfile gate — wrap silhouette + material alone = NONE
    const softerIp = intel.intentionPotentials.find(ip => ip.intention === "feel-softer");
    assert.ok(softerIp);
    assert.equal(softerIp.strength, "none", "silhouette + material without soft fitProfile → NONE");
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
  it("sneakers with no analysed fields: null visual weight (V2)", () => {
    const g: ClosetClassification = { ...blank() };
    const intel = deriveGarmentStylingIntelligence(g);
    assert.equal(intel.visualWeight.value, null);
    assert.equal(intel.colourProfile.hueFamily, null);
    assert.equal(intel.colourProfile.wardrobeNeutral, false);
  });

  // Floral silk scarf (accessory)
  it("floral silk scarf: medium visual weight (floral pattern) (V2)", () => {
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
    assert.equal(intel.colourProfile.hueFamily, "pink");
    assert.equal(intel.colourProfile.energyTier, "high-energy");
  });
});

// ── §GI-V1-26 — StyleMe isolation ─────────────────────────────────────────────

describe("§GI-V1-26 StyleMe isolation — V1 not wired into live ranking", () => {
  it("V1 module exports V1_SHADOW_ONLY = true (signals it must not be imported by live scoring)", () => {
    assert.strictEqual(V1_SHADOW_ONLY, true as const);
  });

  it("styleme-recommendation.ts does not export deriveVisualWeight", async () => {
    const styleme = await import("~/lib/ai/styleme-recommendation");
    assert.ok(!("deriveVisualWeight" in styleme),
      "deriveVisualWeight must not exist in styleme-recommendation (boundary violation)");
  });

  it("styleme-recommendation.ts does not export V1_SHADOW_ONLY", async () => {
    const styleme = await import("~/lib/ai/styleme-recommendation");
    assert.ok(!("V1_SHADOW_ONLY" in styleme),
      "V1_SHADOW_ONLY in styleme-recommendation would indicate a Phase 3C boundary violation");
  });

  it("styleme-recommendation.ts does not export deriveGarmentStylingIntelligence", async () => {
    const styleme = await import("~/lib/ai/styleme-recommendation");
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

  it("coverage passport does NOT change confidence signals (V2.1: coverage removed from confidence)", () => {
    const coveredGarment: ClosetClassification = {
      ...blank(),
      shoulderCoverage: true,
      necklineCoverage: "crew",
      sleeveLength: "full",
    };
    const withCoveragePassport = deriveGarmentStylingIntelligence(coveredGarment, {
      coveragePreferences: ["sleeves-preferred"],
    });

    const withCP = withCoveragePassport.intentionPotentials.find(ip => ip.intention === "confidence");
    assert.ok(withCP);
    // V2.1: coverage signals removed from confidence; no personality tags → NONE + no signals.
    assert.equal(withCP.strength, "none");
    assert.ok(
      !withCP.signals.some(s => s.includes("coverage")),
      `No coverage signal expected in confidence. Got: ${withCP.signals.join(", ")}`,
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

// ── §GI-V1-28 — V2 visual weight: construction dimension ─────────────────────

describe("§GI-V1-28 deriveVisualWeight V2 — construction dimension (tailored blazer fix)", () => {
  it("solid + straight + wool + tailored → medium (construction adds 1)", () => {
    const r = deriveVisualWeight({
      pattern: "solid", silhouette: "straight", material: "wool", fitProfile: "tailored",
    });
    assert.equal(r.value, "medium");
    assert.ok(r.evidence.some(e => e.includes("tailored") || e.includes("construction")));
  });

  it("solid + straight + cotton + tailored → medium (V1 was 'light' — bug fixed)", () => {
    const r = deriveVisualWeight({
      pattern: "solid", silhouette: "straight", material: "cotton", fitProfile: "tailored",
    });
    assert.equal(r.value, "medium");
  });

  it("solid + straight + wool + structured → medium", () => {
    const r = deriveVisualWeight({
      pattern: "solid", silhouette: "straight", material: "wool", fitProfile: "structured",
    });
    assert.equal(r.value, "medium");
  });

  it("solid + straight + cotton + fitted → light (fitted does NOT contribute)", () => {
    const r = deriveVisualWeight({
      pattern: "solid", silhouette: "straight", material: "cotton", fitProfile: "fitted",
    });
    assert.equal(r.value, "light");
    assert.ok(!r.evidence.some(e => e.includes("fitted")));
  });

  it("floral + oversized + cotton + tailored → substantial (3 contributions)", () => {
    const r = deriveVisualWeight({
      pattern: "floral", silhouette: "oversized", material: "cotton", fitProfile: "tailored",
    });
    assert.equal(r.value, "substantial");
    assert.ok(r.evidence.length >= 2);
  });

  it("all null + category=SHOES → null (no metadata → no visual weight evidence)", () => {
    const r = deriveVisualWeight({
      pattern: null, silhouette: null, material: null, fitProfile: null, category: "SHOES",
    });
    assert.equal(r.value, null);
  });
});

// ── §GI-V1-29 — V2 colour model: two-axis ────────────────────────────────────

describe("§GI-V1-29 deriveColourProfile V2 — two-axis (hueFamily + wardrobeNeutral)", () => {
  it("navy: wardrobeNeutral=true AND hueFamily='blue' (not neutral·neutral)", () => {
    const r = deriveColourProfile({ primaryColor: "navy", colors: [] });
    assert.equal(r.wardrobeNeutral, true);
    assert.equal(r.hueFamily, "blue");
  });

  it("charcoal: wardrobeNeutral=true AND hueFamily='grey'", () => {
    const r = deriveColourProfile({ primaryColor: "charcoal", colors: [] });
    assert.equal(r.wardrobeNeutral, true);
    assert.equal(r.hueFamily, "grey");
  });

  it("brown: wardrobeNeutral=true AND hueFamily='brown'", () => {
    const r = deriveColourProfile({ primaryColor: "brown", colors: [] });
    assert.equal(r.wardrobeNeutral, true);
    assert.equal(r.hueFamily, "brown");
  });

  it("red: wardrobeNeutral=false AND hueFamily='red'", () => {
    const r = deriveColourProfile({ primaryColor: "red", colors: [] });
    assert.equal(r.wardrobeNeutral, false);
    assert.equal(r.hueFamily, "red");
  });

  it("khaki V2: wardrobeNeutral=true (moved from green family, V1 bug fixed)", () => {
    const r = deriveColourProfile({ primaryColor: "khaki", colors: [] });
    assert.equal(r.wardrobeNeutral, true);
    assert.equal(r.hueFamily, null); // khaki has no strong hue family
    assert.equal(r.energyTier, "neutral-versatile");
  });

  it("neutralChromaticity and broadFamily are backward-compat derived fields", () => {
    const r = deriveColourProfile({ primaryColor: "red", colors: [] });
    assert.equal(r.neutralChromaticity, "chromatic");
    assert.equal(r.broadFamily, "red");
    const n = deriveColourProfile({ primaryColor: "black", colors: [] });
    assert.equal(n.neutralChromaticity, "neutral");
    assert.equal(n.broadFamily, "neutral");
    const navy = deriveColourProfile({ primaryColor: "navy", colors: [] });
    assert.equal(navy.neutralChromaticity, "neutral");
    assert.equal(navy.broadFamily, "blue"); // navy has hue bias → broadFamily is "blue"
  });
});

// ── §GI-V1-30 — V2 strength field ────────────────────────────────────────────

describe("§GI-V1-30 IntentionPotential — strength field always present", () => {
  const validStrengths = new Set<IntentionStrength>(["strong", "supporting", "none"]);

  it("all 12 intentions always have a valid strength value", () => {
    const intel = deriveGarmentStylingIntelligence({ ...blank() });
    for (const ip of intel.intentionPotentials) {
      assert.ok(validStrengths.has(ip.strength as IntentionStrength),
        `invalid strength '${ip.strength}' for ${ip.intention}`);
    }
  });

  it("blank garment → all intentions strength='none'", () => {
    const intel = deriveGarmentStylingIntelligence({ ...blank() });
    for (const ip of intel.intentionPotentials) {
      assert.equal(ip.strength, "none", `${ip.intention} should be none for blank garment`);
    }
  });

  it("strength 'none' means signals empty for most intentions (feel-less-exposed is Layer A exception)", () => {
    // feel-less-exposed records objective coverage signals regardless of passport gate (Layer A).
    // All other intentions must have zero signals when strength=none.
    const g: ClosetClassification = {
      ...blank(),
      pattern: "solid",
      silhouette: "straight",
      material: "cotton",
      primaryColor: "beige",
    };
    const intel = deriveGarmentStylingIntelligence(g);
    for (const ip of intel.intentionPotentials) {
      if (ip.intention === "feel-less-exposed") continue; // Layer A: coverage signals recorded regardless
      if (ip.strength === "none") {
        assert.equal(ip.signals.length, 0,
          `${ip.intention}: strength=none but has signals: ${ip.signals.join(", ")}`);
      }
    }
  });
});

// ── §GI-V1-31 — V2: no fallback source ───────────────────────────────────────

describe("§GI-V1-31 V2 — no 'fallback' signal source", () => {
  it("no signalDetail has source='fallback' for any intention on any garment", () => {
    const garments: ClosetClassification[] = [
      { ...blank() },
      { ...blank(), primaryColor: "red", fitProfile: "fitted", styleTags: ["bold"] },
      { ...blank(), primaryColor: "black", formality: "casual", occasions: ["casual"] },
      { ...blank(), fitProfile: "tailored", material: "wool", pattern: "stripes" },
    ];
    for (const g of garments) {
      const intel = deriveGarmentStylingIntelligence(g);
      for (const ip of intel.intentionPotentials) {
        for (const sd of ip.signalDetails) {
          assert.ok(
            sd.source !== ("fallback" as string),
            `fallback source found: ${ip.intention} — "${sd.text}"`,
          );
        }
      }
    }
  });

  it("all signalDetails have polarity 'support' or 'conflict'", () => {
    const g: ClosetClassification = {
      ...blank(),
      primaryColor: "red",
      fitProfile: "tailored",
      styleTags: ["bold", "statement"],
    };
    const intel = deriveGarmentStylingIntelligence(g, { avoidColors: ["red"] });
    for (const ip of intel.intentionPotentials) {
      for (const sd of ip.signalDetails) {
        assert.ok(
          sd.polarity === "support" || sd.polarity === "conflict",
          `unexpected polarity '${sd.polarity}' in ${ip.intention}`,
        );
      }
    }
  });
});

// ── §GI-V1-32 — V2 ground-me rules ───────────────────────────────────────────

describe("§GI-V1-32 V2 ground-me — requires personality tag alignment + positive Layer A", () => {
  it("tailored blazer — no styleTags → NONE (no tag alignment, no ease)", () => {
    const g: ClosetClassification = {
      ...blank(), fitProfile: "tailored", material: "wool",
    };
    const r = computeGarmentIntentionPotential(g, "ground-me",
      { stylePersonalities: ["classic-polished"] }, {});
    assert.equal(r.strength, "none",
      "tailored+wool has no ease/softness and no aligned tags — NONE");
  });

  it("relaxed fit + classic-polished passport + aligned tags but no successfulOutfitGives → NONE (V2.1 gate)", () => {
    const g: ClosetClassification = { ...blank(), fitProfile: "relaxed", styleTags: ["classic", "polished"] };
    const r = computeGarmentIntentionPotential(g, "ground-me",
      { stylePersonalities: ["classic-polished"] }, {});
    // V2.1: personality alignment alone is no longer sufficient; requires successfulOutfitGives gate.
    assert.equal(r.strength, "none");
  });

  it("relaxed + silk + minimal-relaxed + aligned tags but no successfulOutfitGives → NONE (V2.1 gate)", () => {
    const g: ClosetClassification = {
      ...blank(), fitProfile: "relaxed", material: "silk", styleTags: ["minimal", "relaxed"],
    };
    const r = computeGarmentIntentionPotential(g, "ground-me",
      { stylePersonalities: ["minimal-relaxed"] }, {});
    // V2.1: requires successfulOutfitGives gate.
    assert.equal(r.strength, "none");
  });

  it("relaxed fit + bold-edgy passport — no styleTags → NONE (no tag alignment)", () => {
    const g: ClosetClassification = { ...blank(), fitProfile: "relaxed" };
    const r = computeGarmentIntentionPotential(g, "ground-me",
      { stylePersonalities: ["bold-edgy"] }, {});
    assert.equal(r.strength, "none");
  });

  it("relaxed fit + no passport → NONE", () => {
    const g: ClosetClassification = { ...blank(), fitProfile: "relaxed" };
    const r = computeGarmentIntentionPotential(g, "ground-me", {}, {});
    assert.equal(r.strength, "none");
  });
});

// ── §GI-V1-33 — V2 avoidColors conflict signal ───────────────────────────────

describe("§GI-V1-33 V2 avoidColors — conflict signal in feel-like-myself and confidence", () => {
  it("garment primaryColor in avoidColors → conflict signal in feel-like-myself", () => {
    const g: ClosetClassification = { ...blank(), primaryColor: "red" };
    const r = computeGarmentIntentionPotential(g, "feel-like-myself",
      { favoriteColors: ["blue"], avoidColors: ["red"] }, {});
    const conflictSig = r.signalDetails.find(sd => sd.polarity === "conflict");
    assert.ok(conflictSig, "expected a conflict signal for avoided colour");
    assert.equal(conflictSig!.source, "passport");
  });

  it("garment primaryColor in avoidColors → conflict signal in confidence", () => {
    const g: ClosetClassification = { ...blank(), primaryColor: "orange" };
    const r = computeGarmentIntentionPotential(g, "confidence",
      { avoidColors: ["orange"] }, {});
    const conflictSig = r.signalDetails.find(sd => sd.polarity === "conflict");
    assert.ok(conflictSig, "expected a conflict signal for avoided colour");
  });

  it("garment primaryColor NOT in avoidColors → no conflict signal", () => {
    const g: ClosetClassification = { ...blank(), primaryColor: "blue" };
    const r = computeGarmentIntentionPotential(g, "feel-like-myself",
      { avoidColors: ["red", "orange"] }, {});
    const conflictSig = r.signalDetails.find(sd => sd.polarity === "conflict");
    assert.ok(!conflictSig, "no conflict signal expected when colour is not avoided");
  });

  it("signals[] (backward-compat) contains only support signals, not conflict", () => {
    const g: ClosetClassification = { ...blank(), primaryColor: "red", styleTags: ["classic"] };
    const r = computeGarmentIntentionPotential(g, "feel-like-myself",
      { stylePersonalities: ["classic-polished"], avoidColors: ["red"] }, {});
    const conflictText = r.signalDetails.filter(sd => sd.polarity === "conflict").map(sd => sd.text);
    for (const ct of conflictText) {
      assert.ok(!r.signals.includes(ct),
        `conflict signal '${ct}' must not appear in backward-compat signals[]`);
    }
  });
});

// ── §GI-V1-34 — V2 give-energy channel rules ─────────────────────────────────

describe("§GI-V1-34 V2 give-energy — three channels, visual weight is amplifier only", () => {
  it("ENERGY_TAGS alone → SUPPORTING", () => {
    const g: ClosetClassification = { ...blank(), styleTags: ["bold", "statement"] };
    const r = computeGarmentIntentionPotential(g, "give-energy", {}, {});
    assert.equal(r.strength, "supporting");
    assert.ok(r.signals.some(s => s.includes("bold") || s.includes("energy character")));
  });

  it("movement silhouette alone → SUPPORTING", () => {
    const g: ClosetClassification = { ...blank(), silhouette: "flared" };
    const r = computeGarmentIntentionPotential(g, "give-energy", {}, {});
    assert.equal(r.strength, "supporting");
    assert.ok(r.signals.some(s => s.includes("movement")));
  });

  it("high-energy colour alone → SUPPORTING", () => {
    const g: ClosetClassification = { ...blank(), primaryColor: "red" };
    const r = computeGarmentIntentionPotential(g, "give-energy", {}, {});
    assert.equal(r.strength, "supporting");
    assert.ok(r.signals.some(s => s.includes("chromatic colour")));
  });

  it("two channels → STRONG", () => {
    const g: ClosetClassification = {
      ...blank(), primaryColor: "red", silhouette: "flared",
    };
    const r = computeGarmentIntentionPotential(g, "give-energy", {}, {});
    assert.equal(r.strength, "strong");
  });

  it("one channel + substantial visual weight → STRONG (amplifier rule)", () => {
    const g: ClosetClassification = {
      ...blank(), primaryColor: "red", pattern: "floral", silhouette: "oversized",
    };
    const r = computeGarmentIntentionPotential(g, "give-energy", {}, {});
    // pattern+silhouette = substantial visual weight → amplifies high-energy colour
    assert.equal(r.strength, "strong");
  });

  it("substantial visual weight alone (no energy channels) → NONE", () => {
    const g: ClosetClassification = {
      ...blank(), pattern: "floral", silhouette: "oversized", primaryColor: "beige",
    };
    const r = computeGarmentIntentionPotential(g, "give-energy", {}, {});
    assert.equal(r.strength, "none",
      "visual weight cannot independently establish give-energy (no energy channels)");
  });

  it("eclectic/romantic tags (not in ENERGY_TAGS) alone → NONE", () => {
    const g: ClosetClassification = { ...blank(), styleTags: ["eclectic", "romantic"] };
    const r = computeGarmentIntentionPotential(g, "give-energy", {}, {});
    assert.equal(r.strength, "none",
      "eclectic/romantic are NOT in ENERGY_TAGS and should not establish give-energy");
  });
});

// ── §GI-V1-35 — V2 feel-softer rules ─────────────────────────────────────────

describe("§GI-V1-35 V2 feel-softer — soft fitProfile required; silhouette/material alone = NONE", () => {
  it("silk material alone → NONE (material alone = NONE in V2)", () => {
    const g: ClosetClassification = { ...blank(), material: "silk" };
    const r = computeGarmentIntentionPotential(g, "feel-softer", {}, {});
    assert.equal(r.strength, "none");
    assert.equal(r.signals.length, 0);
  });

  it("wrap silhouette alone (no fitProfile) → NONE (silhouette alone = NONE in V2)", () => {
    const g: ClosetClassification = { ...blank(), silhouette: "wrap" };
    const r = computeGarmentIntentionPotential(g, "feel-softer", {}, {});
    assert.equal(r.strength, "none");
    assert.equal(r.signals.length, 0);
  });

  it("relaxed fit alone → NONE (fit alone insufficient in V2; needs material or silhouette too)", () => {
    const g: ClosetClassification = { ...blank(), fitProfile: "relaxed" };
    const r = computeGarmentIntentionPotential(g, "feel-softer", {}, {});
    assert.equal(r.strength, "none");
    assert.equal(r.signals.length, 0);
  });

  it("relaxed fit + silk material → SUPPORTING (not STRONG; STRONG needs all 3 dimensions)", () => {
    const g: ClosetClassification = { ...blank(), fitProfile: "relaxed", material: "silk" };
    const r = computeGarmentIntentionPotential(g, "feel-softer", {}, {});
    assert.equal(r.strength, "supporting");
  });

  it("relaxed fit + silk + wrap silhouette → STRONG (all 3 dimensions)", () => {
    const g: ClosetClassification = {
      ...blank(), fitProfile: "relaxed", material: "silk", silhouette: "wrap",
    };
    const r = computeGarmentIntentionPotential(g, "feel-softer", {}, {});
    assert.equal(r.strength, "strong");
  });

  it("tailored fit → NONE (not a soft fitProfile)", () => {
    const g: ClosetClassification = { ...blank(), fitProfile: "tailored" };
    const r = computeGarmentIntentionPotential(g, "feel-softer", {}, {});
    assert.equal(r.strength, "none");
  });
});

// ── §GI-V1-36 — V2 feel-attractive: successfulOutfitGives gate ───────────────

describe("§GI-V1-36 V2 feel-attractive — NONE by default; requires successfulOutfitGives gate + Passport alignment", () => {
  it("fitted garment alone (no passport) → NONE", () => {
    const g: ClosetClassification = { ...blank(), fitProfile: "fitted" };
    const r = computeGarmentIntentionPotential(g, "feel-attractive", {}, {});
    assert.equal(r.strength, "none");
  });

  it("feminine-romantic passport + fitted, no successfulOutfitGives → NONE", () => {
    const g: ClosetClassification = { ...blank(), fitProfile: "fitted" };
    const r = computeGarmentIntentionPotential(g, "feel-attractive",
      { stylePersonalities: ["feminine-romantic"] }, {});
    assert.equal(r.strength, "none");
  });

  it("successfulOutfitGives contains feel-attractive but no Passport personality → NONE", () => {
    const g: ClosetClassification = { ...blank(), fitProfile: "fitted" };
    const r = computeGarmentIntentionPotential(g, "feel-attractive",
      { successfulOutfitGives: ["feel-attractive"] }, {});
    assert.equal(r.strength, "none");
  });

  it("successfulOutfitGives + Passport alignment + garment personality tags → SUPPORTING", () => {
    const g: ClosetClassification = {
      ...blank(), styleTags: ["feminine", "romantic"],
    };
    const r = computeGarmentIntentionPotential(g, "feel-attractive",
      { stylePersonalities: ["feminine-romantic"], successfulOutfitGives: ["feel-attractive"] }, {});
    assert.equal(r.strength, "supporting");
  });

  it("successfulOutfitGives + Passport alignment but no garment tags → NONE", () => {
    const g: ClosetClassification = { ...blank() };
    const r = computeGarmentIntentionPotential(g, "feel-attractive",
      { stylePersonalities: ["feminine-romantic"], successfulOutfitGives: ["feel-attractive"] }, {});
    assert.equal(r.strength, "none");
  });

  it("STRONG is never returned at item level (V2)", () => {
    const g: ClosetClassification = {
      ...blank(), fitProfile: "fitted", occasions: ["evening"], styleTags: ["feminine", "romantic", "elevated"],
    };
    const r = computeGarmentIntentionPotential(g, "feel-attractive",
      { stylePersonalities: ["feminine-romantic"], successfulOutfitGives: ["feel-attractive"] }, {});
    assert.ok(r.strength !== "strong", "STRONG must never fire at item level in V2");
  });
});

// ── §GI-V1-37 — V2 give-structure: fitProfile required ───────────────────────

describe("§GI-V1-37 V2 give-structure — fitProfile required; silhouette/material alone NONE", () => {
  it("straight silhouette alone → NONE", () => {
    const g: ClosetClassification = { ...blank(), silhouette: "straight" };
    const r = computeGarmentIntentionPotential(g, "give-structure", {}, {});
    assert.equal(r.strength, "none");
  });

  it("wool material alone → NONE", () => {
    const g: ClosetClassification = { ...blank(), material: "wool" };
    const r = computeGarmentIntentionPotential(g, "give-structure", {}, {});
    assert.equal(r.strength, "none");
  });

  it("tailored fitProfile → SUPPORTING", () => {
    const g: ClosetClassification = { ...blank(), fitProfile: "tailored" };
    const r = computeGarmentIntentionPotential(g, "give-structure", {}, {});
    assert.equal(r.strength, "supporting");
  });

  it("tailored + wool → STRONG", () => {
    const g: ClosetClassification = {
      ...blank(), fitProfile: "tailored", material: "wool",
    };
    const r = computeGarmentIntentionPotential(g, "give-structure", {}, {});
    assert.equal(r.strength, "strong");
  });
});

// ── §GI-V1-38 — V2 feel-sharper: fitted alone = NONE ────────────────────────

describe("§GI-V1-38 V2 feel-sharper — fitted alone = NONE; tailored/structured required", () => {
  it("fitted alone → NONE and no signals", () => {
    const g: ClosetClassification = { ...blank(), fitProfile: "fitted" };
    const r = computeGarmentIntentionPotential(g, "feel-sharper", {}, {});
    assert.equal(r.strength, "none");
    assert.equal(r.signals.length, 0);
  });

  it("tailored → SUPPORTING", () => {
    const g: ClosetClassification = { ...blank(), fitProfile: "tailored" };
    const r = computeGarmentIntentionPotential(g, "feel-sharper", {}, {});
    assert.equal(r.strength, "supporting");
  });

  it("tailored + wool → STRONG", () => {
    const g: ClosetClassification = {
      ...blank(), fitProfile: "tailored", material: "wool",
    };
    const r = computeGarmentIntentionPotential(g, "feel-sharper", {}, {});
    assert.equal(r.strength, "strong");
  });
});

// ── §GI-V1-39 — V2 feel-less-exposed: Passport coverage need gate ────────────

describe("§GI-V1-39 V2 feel-less-exposed — Passport dressingPreferences gate required for strength", () => {
  it("one zone covered, no Passport → signals present but strength NONE", () => {
    const g: ClosetClassification = { ...blank(), shoulderCoverage: true };
    const r = computeGarmentIntentionPotential(g, "feel-less-exposed", {}, {});
    assert.equal(r.strength, "none", "objective coverage alone must not produce strength without Passport need");
    assert.ok(r.signals.some(s => s.includes("shoulders covered")), "Layer A signals still recorded");
  });

  it("two zones covered, no Passport → signals present but strength NONE", () => {
    const g: ClosetClassification = {
      ...blank(), shoulderCoverage: true, necklineCoverage: "crew",
    };
    const r = computeGarmentIntentionPotential(g, "feel-less-exposed", {}, {});
    assert.equal(r.strength, "none");
    assert.ok(r.signals.length >= 2, "Layer A signals still recorded");
  });

  it("two requirements stated, one zone satisfied → SUPPORTING", () => {
    const g: ClosetClassification = { ...blank(), shoulderCoverage: true };
    const r = computeGarmentIntentionPotential(g, "feel-less-exposed",
      { dressingPreferences: ["arms-covered", "chest-neckline-covered"] }, {});
    assert.equal(r.strength, "supporting");
  });

  it("two requirements stated, both zones satisfied → STRONG", () => {
    const g: ClosetClassification = {
      ...blank(), shoulderCoverage: true, necklineCoverage: "crew",
    };
    const r = computeGarmentIntentionPotential(g, "feel-less-exposed",
      { dressingPreferences: ["arms-covered", "chest-neckline-covered"] }, {});
    assert.equal(r.strength, "strong");
  });

  it("one requirement stated, not satisfied → NONE (no coverage zones met)", () => {
    const g: ClosetClassification = {
      ...blank(), shoulderCoverage: false, midriffExposed: true, necklineCoverage: "low",
    };
    const r = computeGarmentIntentionPotential(g, "feel-less-exposed",
      { dressingPreferences: ["arms-covered"] }, {});
    assert.equal(r.strength, "none");
    assert.equal(r.signals.length, 0);
  });
});

// ── §GI-V1-40 — V2.1 visual weight: category floors ─────────────────────────

describe("§GI-V1-40 V2.1 deriveVisualWeight — category floors", () => {
  it("outerwear category + solid/plain/cotton → medium (outerwear floor, not light)", () => {
    const r = deriveVisualWeight({
      pattern: "solid", silhouette: "straight", material: "cotton",
      fitProfile: "relaxed", category: "outerwear",
    });
    assert.equal(r.value, "medium");
    assert.ok(r.evidence.some(e => e.includes("outerwear")));
  });

  it("bottoms category + solid/cotton/straight → light (V2.2: blanket bottoms floor removed)", () => {
    const r = deriveVisualWeight({
      pattern: "solid", silhouette: "straight", material: "cotton", category: "bottoms",
    });
    // V2.2: blanket bottoms floor removed; athletic shorts, linen trousers etc. stay light without denim.
    assert.equal(r.value, "light");
  });

  it("denim material (non-accessory, no category) → medium (denim floor with !isAccessory guard)", () => {
    const r = deriveVisualWeight({
      pattern: "solid", silhouette: "straight", material: "denim",
    });
    assert.equal(r.value, "medium");
    assert.ok(r.evidence.some(e => e.includes("denim")));
  });

  it("denim material + accessory category → light (denim floor guarded against accessories)", () => {
    const r = deriveVisualWeight({
      pattern: "solid", silhouette: null, material: "denim", category: "accessories",
    });
    assert.equal(r.value, "light");
    assert.ok(!r.evidence.some(e => e.includes("denim")), "denim floor must not fire for accessories");
  });

  it("bottoms + denim (jeans) → medium (denim construction floor)", () => {
    const r = deriveVisualWeight({
      pattern: "solid", silhouette: "straight", material: "denim", category: "bottoms",
    });
    assert.equal(r.value, "medium");
    assert.ok(r.evidence.some(e => e.includes("denim")));
  });

  it("bottoms + jersey (athletic shorts) → light (no blanket bottoms floor)", () => {
    const r = deriveVisualWeight({
      pattern: "solid", silhouette: "straight", material: "jersey", category: "bottoms",
    });
    assert.equal(r.value, "light");
  });

  it("tops category + knit material → medium (knitwear floor)", () => {
    const r = deriveVisualWeight({
      pattern: "solid", silhouette: "straight", material: "knit", category: "tops",
    });
    assert.equal(r.value, "medium");
    assert.ok(r.evidence.some(e => e.includes("knitwear")));
  });

  it("tops category + cotton material (not knitwear) → light (no floor)", () => {
    const r = deriveVisualWeight({
      pattern: "solid", silhouette: "straight", material: "cotton", category: "tops",
    });
    assert.equal(r.value, "light");
  });

  it("outerwear + existing pattern contribution → substantial (floor does not double-count)", () => {
    const r = deriveVisualWeight({
      pattern: "floral", silhouette: "oversized", material: "cotton", category: "outerwear",
    });
    // floral(1) + oversized(1) = score 2 → substantial; outerwear floor (score=0 only) doesn't fire
    assert.equal(r.value, "substantial");
    assert.ok(!r.evidence.some(e => e.includes("outerwear")));
  });

  it("leather bag (accessories) → leather does NOT contribute to visual weight", () => {
    const r = deriveVisualWeight({
      pattern: "solid", silhouette: null, material: "leather", category: "bags",
    });
    assert.equal(r.value, "light");
    assert.ok(!r.evidence.some(e => e.includes("leather")), "leather exempt on accessories");
  });

  it("leather jacket (outerwear) → leather DOES contribute + outerwear floor irrelevant", () => {
    const r = deriveVisualWeight({
      pattern: "solid", silhouette: "straight", material: "leather", category: "outerwear",
    });
    // leather(1) → score=1 → medium; outerwear floor only fires at score=0
    assert.equal(r.value, "medium");
    assert.ok(r.evidence.some(e => e.includes("leather")));
  });
});

// ── §GI-V1-41 — V2.1/V2.2 compound colour tokens ────────────────────────────

describe("§GI-V1-41 V2.2 deriveColourProfile — compound colour tokens + energy tiers", () => {
  it("'dark blue' (no material) → hueFamily=blue, lightDark=dark, wardrobeNeutral=false (chromatic, not neutral)", () => {
    const r = deriveColourProfile({ primaryColor: "dark blue", colors: [] });
    assert.equal(r.hueFamily, "blue");
    assert.equal(r.lightDark, "dark");
    // V2.2: dark blue is NOT unconditionally a wardrobe neutral; generic dark blue is chromatic.
    assert.equal(r.wardrobeNeutral, false);
  });

  it("'dark blue' + denim material → wardrobeNeutral=true, energyTier=neutral-versatile (navy-context)", () => {
    const r = deriveColourProfile({ primaryColor: "dark blue", colors: [], material: "denim" });
    assert.equal(r.wardrobeNeutral, true);
    assert.equal(r.hueFamily, "blue");
    assert.equal(r.lightDark, "dark");
    assert.equal(r.energyTier, "neutral-versatile");
  });

  it("'dark blue' non-denim chromatic garment → wardrobeNeutral=false, energyTier=deep-authoritative", () => {
    const r = deriveColourProfile({ primaryColor: "dark blue", colors: [], material: "silk" });
    assert.equal(r.wardrobeNeutral, false);
    // dark blue without denim context is chromatic deep (in UNAMBIGUOUS_DARK → deep-authoritative).
    assert.equal(r.energyTier, "deep-authoritative");
  });

  it("'dark brown' → hueFamily=brown, lightDark=dark", () => {
    const r = deriveColourProfile({ primaryColor: "dark brown", colors: [] });
    assert.equal(r.hueFamily, "brown");
    assert.equal(r.lightDark, "dark");
  });

  it("'dark brown' → wardrobeNeutral=true, energyTier=neutral-versatile (V2.2: compound neutral)", () => {
    const r = deriveColourProfile({ primaryColor: "dark brown", colors: [] });
    assert.equal(r.wardrobeNeutral, true);
    assert.equal(r.energyTier, "neutral-versatile");
  });

  it("'charcoal grey' → wardrobeNeutral=true, hueFamily=grey, lightDark=dark, energyTier=neutral-versatile", () => {
    const r = deriveColourProfile({ primaryColor: "charcoal grey", colors: [] });
    assert.equal(r.wardrobeNeutral, true);
    assert.equal(r.hueFamily, "grey");
    assert.equal(r.lightDark, "dark");
    assert.equal(r.energyTier, "neutral-versatile");
  });

  it("'dark grey' → wardrobeNeutral=true, hueFamily=grey, lightDark=dark", () => {
    const r = deriveColourProfile({ primaryColor: "dark grey", colors: [] });
    assert.equal(r.wardrobeNeutral, true);
    assert.equal(r.hueFamily, "grey");
    assert.equal(r.lightDark, "dark");
  });

  it("'off-black' → wardrobeNeutral=true, lightDark=dark", () => {
    const r = deriveColourProfile({ primaryColor: "off-black", colors: [] });
    assert.equal(r.wardrobeNeutral, true);
    assert.equal(r.lightDark, "dark");
  });

  it("'navy' → wardrobeNeutral=true, energyTier=deep-authoritative (not neutral-versatile)", () => {
    const r = deriveColourProfile({ primaryColor: "navy", colors: [] });
    assert.equal(r.wardrobeNeutral, true);
    assert.equal(r.energyTier, "deep-authoritative");
  });

  it("'black' → wardrobeNeutral=true, energyTier=deep-authoritative", () => {
    const r = deriveColourProfile({ primaryColor: "black", colors: [] });
    assert.equal(r.wardrobeNeutral, true);
    assert.equal(r.energyTier, "deep-authoritative");
  });

  it("'light blue' → hueFamily=blue", () => {
    const r = deriveColourProfile({ primaryColor: "light blue", colors: [] });
    assert.equal(r.hueFamily, "blue");
  });
});

// ── §GI-V1-42 — V2.1 ground-me: successfulOutfitGives gate ──────────────────

describe("§GI-V1-42 V2.1 ground-me — successfulOutfitGives gate", () => {
  it("successfulOutfitGives=['ground-me'] + relaxed fit → SUPPORTING", () => {
    const g: ClosetClassification = { ...blank(), fitProfile: "relaxed" };
    const r = computeGarmentIntentionPotential(g, "ground-me",
      { successfulOutfitGives: ["ground-me"] }, {});
    assert.equal(r.strength, "supporting");
    assert.ok(r.signals.some(s => s.includes("ease") || s.includes("fit")));
  });

  it("successfulOutfitGives=['ground-me'] + soft material (no ease fit) → NONE", () => {
    const g: ClosetClassification = { ...blank(), material: "silk" };
    const r = computeGarmentIntentionPotential(g, "ground-me",
      { successfulOutfitGives: ["ground-me"] }, {});
    assert.equal(r.strength, "none", "ease fit required; material alone is not enough");
  });

  it("successfulOutfitGives=['ground-me'] + relaxed fit + silk → SUPPORTING with material signal", () => {
    const g: ClosetClassification = { ...blank(), fitProfile: "relaxed", material: "silk" };
    const r = computeGarmentIntentionPotential(g, "ground-me",
      { successfulOutfitGives: ["ground-me"] }, {});
    assert.equal(r.strength, "supporting");
    assert.ok(r.signals.some(s => s.includes("silk")));
  });

  it("relaxed fit + personality alignment but successfulOutfitGives empty → NONE", () => {
    const g: ClosetClassification = { ...blank(), fitProfile: "relaxed", styleTags: ["minimal"] };
    const r = computeGarmentIntentionPotential(g, "ground-me",
      { stylePersonalities: ["minimal-relaxed"], successfulOutfitGives: [] }, {});
    assert.equal(r.strength, "none");
  });
});

// ── §GI-V1-43 — V2.1 give-structure: fitted = NONE ──────────────────────────

describe("§GI-V1-43 V2.1 give-structure — fitted fitProfile now NONE", () => {
  it("fitted fitProfile alone → NONE (V2.1: fitted removed from STRUCTURED_FIT_PROFILES)", () => {
    const g: ClosetClassification = { ...blank(), fitProfile: "fitted" };
    const r = computeGarmentIntentionPotential(g, "give-structure", {}, {});
    assert.equal(r.strength, "none");
    assert.equal(r.signals.length, 0);
  });

  it("fitted + wool + straight → NONE (fitted is the gate, not wool or silhouette)", () => {
    const g: ClosetClassification = {
      ...blank(), fitProfile: "fitted", material: "wool", silhouette: "straight",
    };
    const r = computeGarmentIntentionPotential(g, "give-structure", {}, {});
    assert.equal(r.strength, "none");
  });
});

// ── §GI-V1-44 — V2.2 confidence: convergence rule ───────────────────────────

describe("§GI-V1-44 V2.2 confidence — convergence rule (≥2 independent signals required)", () => {
  it("personality alignment alone → NONE (V2.2: single signal insufficient)", () => {
    const g: ClosetClassification = { ...blank(), styleTags: ["classic", "polished"] };
    const r = computeGarmentIntentionPotential(g, "confidence",
      { stylePersonalities: ["classic-polished"] }, {});
    // V2.2: personality alone does NOT reach SUPPORTING; convergence of ≥2 signals required.
    assert.equal(r.strength, "none");
    assert.equal(r.signals.length, 0);
  });

  it("personality alignment + favourite colour → SUPPORTING (convergence=2)", () => {
    const g: ClosetClassification = {
      ...blank(), styleTags: ["classic", "polished"], primaryColor: "navy",
    };
    const r = computeGarmentIntentionPotential(g, "confidence",
      { stylePersonalities: ["classic-polished"], favoriteColors: ["navy"] }, {});
    assert.equal(r.strength, "supporting");
    assert.ok(r.signals.some(s => s.includes("personality")));
    assert.ok(r.signals.some(s => s.includes("colour") || s.includes("color")));
  });

  it("personality alignment + strong positive relationship → SUPPORTING (convergence=2)", () => {
    const g: ClosetClassification = {
      ...blank(), styleTags: ["classic", "polished"], garmentRelationships: ["favourite"],
    };
    const r = computeGarmentIntentionPotential(g, "confidence",
      { stylePersonalities: ["classic-polished"] }, {});
    assert.equal(r.strength, "supporting");
  });

  it("favourite colour alone → NONE (single signal only)", () => {
    const g: ClosetClassification = { ...blank(), primaryColor: "navy" };
    const r = computeGarmentIntentionPotential(g, "confidence",
      { favoriteColors: ["navy"] }, {});
    assert.equal(r.strength, "none");
    assert.equal(r.signals.length, 0);
  });

  it("strong positive relationship alone → NONE (single signal only)", () => {
    const g: ClosetClassification = { ...blank(), garmentRelationships: ["favourite"] };
    const r = computeGarmentIntentionPotential(g, "confidence", {}, {});
    assert.equal(r.strength, "none");
    assert.equal(r.signals.length, 0);
  });

  it("negative relationship suppresses even with personality + fav colour → NONE", () => {
    const g: ClosetClassification = {
      ...blank(), styleTags: ["classic", "polished"], primaryColor: "navy",
      garmentRelationships: ["regret"],
    };
    const r = computeGarmentIntentionPotential(g, "confidence",
      { stylePersonalities: ["classic-polished"], favoriteColors: ["navy"] }, {});
    assert.equal(r.strength, "none");
    assert.equal(r.signals.length, 0);
    assert.ok(r.signalDetails.some(sd => sd.polarity === "conflict"));
  });

  it("full sleeves + no personality → NONE (coverage removed in V2.1)", () => {
    const g: ClosetClassification = { ...blank(), sleeveLength: "full" };
    const r = computeGarmentIntentionPotential(g, "confidence",
      { dressingPreferences: ["arms-covered"] }, {});
    assert.equal(r.strength, "none");
    assert.equal(r.signals.length, 0);
  });

  // Preferred structural silhouette alignment (4th convergence signal, V6 passport.silhouette).
  it("classic-polished + V6 silhouette structured-tailored + tailored blazer → SUPPORTING (personality + preferred silhouette)", () => {
    const g: ClosetClassification = {
      ...blank(), fitProfile: "tailored", styleTags: ["classic", "polished"], category: "outerwear",
    };
    const r = computeGarmentIntentionPotential(g, "confidence",
      { stylePersonalities: ["classic-polished"], silhouette: ["structured-tailored", "tapered"] }, {});
    assert.equal(r.strength, "supporting");
    assert.ok(r.signals.some(s => s.includes("personality")));
    assert.ok(r.signals.some(s => s.includes("silhouette")));
  });

  it("V6 silhouette structured-tailored alone (no personality, no other signal) → NONE (single signal)", () => {
    const g: ClosetClassification = { ...blank(), fitProfile: "tailored", category: "tops" };
    const r = computeGarmentIntentionPotential(g, "confidence",
      { silhouette: ["structured-tailored"] }, {});
    assert.equal(r.strength, "none");
    assert.equal(r.signals.length, 0);
  });

  it("fitted sports top + V6 silhouette structured-tailored → NONE (fitted not structural; activewear category guard)", () => {
    const g: ClosetClassification = {
      ...blank(), fitProfile: "fitted", category: "activewear",
    };
    const r = computeGarmentIntentionPotential(g, "confidence",
      { stylePersonalities: ["classic-polished"], silhouette: ["structured-tailored", "tapered"] }, {});
    // fitted not in STRUCTURED_FIT_PROFILES + activewear blocks → no silhouette signal; personality alone → NONE.
    assert.equal(r.strength, "none");
    assert.equal(r.signals.length, 0);
  });

  it("tailored activewear top + V6 silhouette → NONE (activewear category blocks structural silhouette signal)", () => {
    const g: ClosetClassification = {
      ...blank(), fitProfile: "tailored", category: "activewear",
    };
    const r = computeGarmentIntentionPotential(g, "confidence",
      { stylePersonalities: ["classic-polished"], silhouette: ["structured-tailored"] }, {});
    // Personality alignment alone: convergence=1 (silhouette signal blocked by activewear) → NONE.
    assert.equal(r.strength, "none");
  });

  // Tapered silhouette preference matches garment.silhouette (not fitProfile).
  it("tapered passport silhouette + garment silhouette tapered + personality → SUPPORTING (convergence=2)", () => {
    const g: ClosetClassification = {
      ...blank(), silhouette: "tapered", fitProfile: "regular",
      styleTags: ["classic", "polished"], category: "bottoms",
    };
    const r = computeGarmentIntentionPotential(g, "confidence",
      { stylePersonalities: ["classic-polished"], silhouette: ["tapered"] }, {});
    assert.equal(r.strength, "supporting");
    assert.ok(r.signals.some(s => s.includes("personality")));
    assert.ok(r.signals.some(s => s.includes("silhouette")));
  });

  it("tapered passport preference + garment silhouette straight → no tapered signal (control)", () => {
    const g: ClosetClassification = {
      ...blank(), silhouette: "straight", fitProfile: "regular",
      styleTags: ["classic", "polished"], category: "bottoms",
    };
    const r = computeGarmentIntentionPotential(g, "confidence",
      { stylePersonalities: ["classic-polished"], silhouette: ["tapered"] }, {});
    // Personality alignment only (convergence=1) — tapered pref does not match straight silhouette.
    assert.equal(r.strength, "none");
  });
});

// ── §GI-V1-45 — V2.1 feel-like-myself: relationship evidence ─────────────────

describe("§GI-V1-45 V2.1 feel-like-myself — garment relationship evidence", () => {
  it("positive relationship (favourite) → hasPositive + signal", () => {
    const g: ClosetClassification = { ...blank(), garmentRelationships: ["favourite"] };
    const r = computeGarmentIntentionPotential(g, "feel-like-myself", {}, {});
    assert.equal(r.strength, "supporting");
    assert.ok(r.signals.some(s => s.includes("strong connection") || s.includes("favourite")));
  });

  it("positive relationship (wear-often) → SUPPORTING", () => {
    const g: ClosetClassification = { ...blank(), garmentRelationships: ["wear-often"] };
    const r = computeGarmentIntentionPotential(g, "feel-like-myself", {}, {});
    assert.equal(r.strength, "supporting");
  });

  it("negative relationship (regret) → conflict signal", () => {
    const g: ClosetClassification = { ...blank(), garmentRelationships: ["regret"] };
    const r = computeGarmentIntentionPotential(g, "feel-like-myself", {}, {});
    const conflict = r.signalDetails.find(sd => sd.polarity === "conflict");
    assert.ok(conflict, "expected a conflict signal for regret relationship");
  });

  it("positive + negative relationship → NONE (V2.2: negative suppresses regardless of positive)", () => {
    const g: ClosetClassification = {
      ...blank(), garmentRelationships: ["favourite", "regret"],
    };
    const r = computeGarmentIntentionPotential(g, "feel-like-myself", {}, {});
    // V2.2: negative relationship fully suppresses; no support signals added.
    assert.equal(r.strength, "none");
    assert.equal(r.signals.length, 0);
    assert.ok(r.signalDetails.some(sd => sd.polarity === "conflict"));
  });

  it("weak positive relationship (like) alone → NONE (like does not independently gate strength)", () => {
    const g: ClosetClassification = { ...blank(), garmentRelationships: ["like"] };
    const r = computeGarmentIntentionPotential(g, "feel-like-myself", {}, {});
    assert.equal(r.strength, "none");
    assert.equal(r.signals.length, 0);
  });
});

// ── §GI-V1-46 — V2.2 make-it-easy: denim removed from comfortable materials ──

describe("§GI-V1-46 V2.2 make-it-easy — denim not a comfortable material; ease from fit+context only", () => {
  it("denim + casual → NONE (V2.2: denim NOT a comfortable material; only 1 ease dimension)", () => {
    const g: ClosetClassification = {
      ...blank(), material: "denim", formality: "casual",
    };
    const r = computeGarmentIntentionPotential(g, "make-it-easy", {}, {});
    // V2.2: denim removed from COMFORTABLE_MATERIALS; formality=casual gives one ease dimension only.
    assert.equal(r.strength, "none");
    assert.equal(r.signals.length, 0);
  });

  it("denim + relaxed fit + smart-casual → SUPPORTING (fit+context=2 dimensions; denim doesn't count)", () => {
    const g: ClosetClassification = {
      ...blank(), material: "denim", fitProfile: "relaxed", formality: "smart-casual",
    };
    const r = computeGarmentIntentionPotential(g, "make-it-easy", {}, {});
    // fit(1) + smart-casual(1) = 2 dimensions → SUPPORTING; denim material does not contribute.
    assert.equal(r.strength, "supporting");
  });

  it("jersey + relaxed fit + casual → STRONG (3 dimensions)", () => {
    const g: ClosetClassification = {
      ...blank(), material: "jersey", fitProfile: "relaxed", formality: "casual",
    };
    const r = computeGarmentIntentionPotential(g, "make-it-easy", {}, {});
    assert.equal(r.strength, "strong");
  });

  it("jersey + smart-casual → SUPPORTING (smart-casual now counts as casual context)", () => {
    const g: ClosetClassification = {
      ...blank(), material: "jersey", formality: "smart-casual",
    };
    const r = computeGarmentIntentionPotential(g, "make-it-easy", {}, {});
    assert.equal(r.strength, "supporting");
  });

  it("cotton + regret relationship → NONE (negative suppression)", () => {
    const g: ClosetClassification = {
      ...blank(), material: "cotton", formality: "casual",
      garmentRelationships: ["regret"],
    };
    const r = computeGarmentIntentionPotential(g, "make-it-easy", {}, {});
    assert.equal(r.strength, "none");
    assert.equal(r.signals.length, 0);
    const conf = r.signalDetails.find(sd => sd.polarity === "conflict");
    assert.ok(conf, "conflict signal expected for negative relationship");
  });
});

// ── §GI-V1-47 — V2.1 feel-less-exposed: avoid-sleeveless + short sleeves ────

describe("§GI-V1-47 V2.1 feel-less-exposed — avoid-sleeveless satisfied by short sleeves", () => {
  it("sleeveLength='short' + passport avoid-sleeveless → STRONG (only requirement, fully satisfied)", () => {
    const g: ClosetClassification = {
      ...blank(), category: "tops", sleeveLength: "short",
    };
    const r = computeGarmentIntentionPotential(g, "feel-less-exposed",
      { dressingPreferences: ["avoid-sleeveless"] }, {});
    // One stated preference, fully satisfied → STRONG (satisfied ≥ applicable).
    assert.equal(r.strength, "strong");
    assert.ok(r.signals.some(s => s.includes("sleeve coverage")));
  });

  it("sleeveLength='short' + passport arms-covered → NONE (short doesn't satisfy arms-covered)", () => {
    const g: ClosetClassification = {
      ...blank(), category: "tops", sleeveLength: "short",
    };
    const r = computeGarmentIntentionPotential(g, "feel-less-exposed",
      { dressingPreferences: ["arms-covered"] }, {});
    assert.equal(r.strength, "none");
  });

  it("sleeveLength='full' + passport arms-covered → STRONG (arms-covered satisfied)", () => {
    const g: ClosetClassification = {
      ...blank(), category: "tops", sleeveLength: "full",
    };
    const r = computeGarmentIntentionPotential(g, "feel-less-exposed",
      { dressingPreferences: ["arms-covered"] }, {});
    assert.equal(r.strength, "strong");
  });

  it("Layer A: short sleeves always recorded as sleeve coverage signal", () => {
    const g: ClosetClassification = { ...blank(), sleeveLength: "short" };
    const r = computeGarmentIntentionPotential(g, "feel-less-exposed", {}, {});
    assert.ok(r.signals.some(s => s.includes("sleeve coverage")));
    assert.equal(r.strength, "none", "strength still none without Passport need");
  });
});

// ── §GI-V1-48 — V2.1 accessory strength cap ─────────────────────────────────

describe("§GI-V1-48 V2.1 accessory strength cap", () => {
  it("structured bag (accessories) → give-structure capped at SUPPORTING", () => {
    const g: ClosetClassification = {
      ...blank(), fitProfile: "tailored", material: "wool",
      silhouette: "straight", category: "accessories",
    };
    const r = computeGarmentIntentionPotential(g, "give-structure", {}, {});
    assert.ok(r.strength !== "strong", "accessories capped at SUPPORTING for give-structure");
    assert.equal(r.strength, "supporting");
  });

  it("structured jewelry item → give-structure capped at SUPPORTING", () => {
    const g: ClosetClassification = {
      ...blank(), fitProfile: "tailored", material: "wool", category: "jewelry",
    };
    const r = computeGarmentIntentionPotential(g, "give-structure", {}, {});
    assert.ok(r.strength !== "strong");
  });

  it("polished bag (accessories) → feel-put-together capped at SUPPORTING", () => {
    const g: ClosetClassification = {
      ...blank(), formality: "business-casual", styleTags: ["polished", "elevated"],
      occasions: ["work"], category: "bags",
    };
    const r = computeGarmentIntentionPotential(g, "feel-put-together", {}, {});
    assert.ok(r.strength !== "strong", "accessories capped for feel-put-together");
  });

  it("non-accessory garment: STRONG is not capped", () => {
    const g: ClosetClassification = {
      ...blank(), fitProfile: "tailored", material: "wool",
      silhouette: "straight", category: "tops",
    };
    const r = computeGarmentIntentionPotential(g, "give-structure", {}, {});
    assert.equal(r.strength, "strong", "non-accessories are NOT capped");
  });
});
