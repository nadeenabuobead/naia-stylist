// app/routes/api.wishlist.b2b2-colour-evidence.test.ts
//
// B2b2 — recognition/evidence-quality fixes only. Authority stays frozen at
// B2b1 (advisory-only, never a veto) — every test in the "authority
// remains frozen" describe block exists specifically to catch a regression
// where B2b2 accidentally reopened that decision.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkHardConstraints, checkColourPreference } from "~/lib/buyskip/constraint-evidence.server";
import { applyHardConstraintVeto } from "~/lib/buyskip/decision-evidence.server";
import { normalizeDeclaredFacts, mergeVisionFacts } from "~/lib/buyskip/product-facts.server";
import { applyVerdictOverride } from "~/routes/api.wishlist.jsx";

function facts(opts: { declaredColor?: string[]; detectedColor?: string | null; confidence?: string | null } = {}) {
  const declared = normalizeDeclaredFacts({ category: "Top", color: opts.declaredColor ?? [], brand: null, size: null });
  return mergeVisionFacts(declared, {
    detectedColor: opts.detectedColor ?? undefined,
    productSnapshot: { observationConfidence: opts.confidence ?? undefined },
  });
}

describe("B2b2 §11 — declared-vs-vision causal matrix", () => {
  it("A: declared=red, vision=blue/high, avoids=red -> conflict, determinedBy=customer-declared, disagreement recorded", () => {
    const f = facts({ declaredColor: ["red"], detectedColor: "blue", confidence: "high — clearly visible" });
    const r = checkColourPreference(["red"], f);
    assert.equal(r.status, "conflict");
    assert.equal(r.determinedBy, "customer-declared");
    assert.equal(r.disagreement, true);
  });

  it("B: declared=blue, vision=red/high, avoids=red -> clear, determinedBy=customer-declared, disagreement recorded", () => {
    const f = facts({ declaredColor: ["blue"], detectedColor: "red", confidence: "high — clearly visible" });
    const r = checkColourPreference(["red"], f);
    assert.equal(r.status, "clear");
    assert.equal(r.determinedBy, "customer-declared");
    assert.equal(r.disagreement, true);
  });

  it("C: no declared, vision=red/high, avoids=red -> conflict, determinedBy=vision", () => {
    const f = facts({ detectedColor: "red", confidence: "high — clearly visible" });
    const r = checkColourPreference(["red"], f);
    assert.equal(r.status, "conflict");
    assert.equal(r.determinedBy, "vision");
    assert.equal(r.disagreement, false);
  });

  it("D: no declared, vision=blue/high, avoids=red -> clear, determinedBy=vision", () => {
    const f = facts({ detectedColor: "blue", confidence: "high — clearly visible" });
    const r = checkColourPreference(["red"], f);
    assert.equal(r.status, "clear");
    assert.equal(r.determinedBy, "vision");
  });

  it("E: no declared, vision=red/medium, avoids=red -> conflict (medium is confidence-eligible per the approved policy)", () => {
    const f = facts({ detectedColor: "red", confidence: "medium — partially visible" });
    const r = checkColourPreference(["red"], f);
    assert.equal(r.status, "conflict");
    assert.equal(r.determinedBy, "vision");
    assert.equal(r.visionUsable, true);
  });

  it("F: no declared, vision=red/low, avoids=red -> unknown (low confidence never determines a status)", () => {
    const f = facts({ detectedColor: "red", confidence: "low — image quality limits assessment" });
    const r = checkColourPreference(["red"], f);
    assert.equal(r.status, "unknown");
    assert.equal(r.determinedBy, "none");
    assert.equal(r.visionUsable, false);
  });

  it("G: no declared, vision=red/no-confidence, avoids=red -> unknown (missing confidence is never implicitly high)", () => {
    const f = facts({ detectedColor: "red", confidence: null });
    const r = checkColourPreference(["red"], f);
    assert.equal(r.status, "unknown");
    assert.equal(r.observationConfidence, null);
    assert.equal(r.visionUsable, false);
  });

  it("H: declared=red, vision=red/low, avoids=red -> conflict from declared evidence (declared never inherits vision-confidence semantics)", () => {
    const f = facts({ declaredColor: ["red"], detectedColor: "red", confidence: "low — image quality limits assessment" });
    const r = checkColourPreference(["red"], f);
    assert.equal(r.status, "conflict");
    assert.equal(r.determinedBy, "customer-declared");
    assert.equal(r.disagreement, false, "vision isn't confidence-usable, so there's nothing reliable to disagree with, even though they happen to agree");
  });

  it("I: declared=blue, vision=red/low, avoids=red -> clear from declared evidence", () => {
    const f = facts({ declaredColor: ["blue"], detectedColor: "red", confidence: "low — image quality limits assessment" });
    const r = checkColourPreference(["red"], f);
    assert.equal(r.status, "clear");
    assert.equal(r.determinedBy, "customer-declared");
    assert.equal(r.disagreement, false, "low-confidence vision can never be flagged as a reliable disagreement");
  });
});

describe("B2b2 §12 — unresolvable declared evidence falls back to reliable vision", () => {
  it("declared=non-colour text, vision=red/high, avoids=red -> conflict, determinedBy=vision", () => {
    const f = facts({ declaredColor: ["sparkly embellished"], detectedColor: "red", confidence: "high — clearly visible" });
    const r = checkColourPreference(["red"], f);
    assert.equal(r.status, "conflict");
    assert.equal(r.determinedBy, "vision");
  });

  it("declared=non-colour text, vision=low -> unknown", () => {
    const f = facts({ declaredColor: ["sparkly embellished"], detectedColor: "red", confidence: "low — image quality limits assessment" });
    const r = checkColourPreference(["red"], f);
    assert.equal(r.status, "unknown");
    assert.equal(r.determinedBy, "none");
  });
});

describe("B2b2 §6 — multicolour declared evidence: union, not flattened to one colour", () => {
  it('declared=["Pink","Red","Beige"], avoids=["red"] -> conflict (pink and red both resolve to red-burgundy/red family region... but specifically red matches directly)', () => {
    const f = facts({ declaredColor: ["Pink", "Red", "Beige"] });
    const r = checkColourPreference(["red"], f);
    assert.equal(r.status, "conflict");
    assert.deepEqual(r.declaredColours, ["Pink", "Red", "Beige"], "original values preserved verbatim for debugging");
  });

  it('declared=["Pink","Beige"] (no red), avoids=["red"] -> clear — pink and red are different families, not conflated', () => {
    const f = facts({ declaredColor: ["Pink", "Beige"] });
    const r = checkColourPreference(["red"], f);
    assert.equal(r.status, "clear");
  });
});

describe("B2b2 §7 — multicolour vision evidence via the B2a free-text resolver", () => {
  it('vision="BEIGE / BURGUNDY / MULTI-PRINT" (the real historical example), avoids=["red"] -> conflict (burgundy resolves into the red family)', () => {
    const f = facts({ detectedColor: "BEIGE / BURGUNDY / MULTI-PRINT", confidence: "high — clearly visible" });
    const r = checkColourPreference(["red"], f);
    assert.equal(r.status, "conflict");
    assert.equal(r.determinedBy, "vision");
    assert.ok(r.detectedFamilies && r.detectedFamilies.hueFamilies.includes("red"), "burgundy recognised");
    assert.ok(r.detectedFamilies && r.detectedFamilies.passportFamilies.includes("beige-brown"), "beige recognised");
    assert.ok(!r.detectedFamilies!.unknown, "MULTI-PRINT is silently ignored, not treated as a failure for the whole string");
  });

  it('vision="BEIGE / BURGUNDY / MULTI-PRINT", avoids=["green"] -> clear — neither recognised colour matches green', () => {
    const f = facts({ detectedColor: "BEIGE / BURGUNDY / MULTI-PRINT", confidence: "high — clearly visible" });
    const r = checkColourPreference(["green"], f);
    assert.equal(r.status, "clear");
  });

  it('vision="navy and cream", avoids=["navy"] -> conflict', () => {
    const f = facts({ detectedColor: "navy and cream", confidence: "high — clearly visible" });
    const r = checkColourPreference(["navy"], f);
    assert.equal(r.status, "conflict");
  });

  it('vision="black / white", avoids=["grey"] -> clear (black/white are achromatic, no hue family, no grey passport family either)', () => {
    const f = facts({ detectedColor: "black / white", confidence: "high — clearly visible" });
    const r = checkColourPreference(["grey"], f);
    assert.equal(r.status, "clear");
  });

  it('vision="blue-grey", avoids=["grey"] -> conflict (grey recognised as one of the two families)', () => {
    const f = facts({ detectedColor: "blue-grey", confidence: "high — clearly visible" });
    const r = checkColourPreference(["grey"], f);
    assert.equal(r.status, "conflict");
  });

  it('vision="brown with burgundy", avoids=["red"] -> conflict (burgundy -> red family)', () => {
    const f = facts({ detectedColor: "brown with burgundy", confidence: "high — clearly visible" });
    const r = checkColourPreference(["red"], f);
    assert.equal(r.status, "conflict");
  });
});

describe("B2b2 §8 — compound/family recovery vs. B2b1's substring behavior", () => {
  const cases: Array<[string, string, "conflict" | "clear"]> = [
    ["navy", "blue", "conflict"],       // B2b1 substring would have missed this
    ["burgundy", "red", "conflict"],    // B2b1 substring would have missed this
    ["camel", "brown", "conflict"],     // family alias
    ["camel", "tan", "conflict"],       // family alias
    ["charcoal", "grey", "conflict"],   // Passport-family alias
    ["chocolate brown", "brown", "conflict"], // the case substring happened to catch; family resolver recovers it too via tokenization
    ["red", "blue", "clear"],           // negative — must stay negative
    ["khaki", "olive", "clear"],        // negative — khaki has no hue family at all
  ];
  for (const [vision, avoid, expected] of cases) {
    it(`vision="${vision}", avoids=["${avoid}"] -> ${expected}`, () => {
      const f = facts({ detectedColor: vision, confidence: "high — clearly visible" });
      const r = checkColourPreference([avoid], f);
      assert.equal(r.status, expected);
    });
  }
});

describe("B2b2 — exact-string match fallback for colours with no recognised family", () => {
  it('declared="Black", avoids=["black"] -> conflict even though "black" has no hue/passport family entry in colour-family.ts (isNeutral=true only) — exact-string identity still counts as a match', () => {
    const f = facts({ declaredColor: ["Black"] });
    const r = checkColourPreference(["black"], f);
    assert.equal(r.status, "conflict");
    assert.equal(r.determinedBy, "customer-declared");
  });

  it('vision="black"/high, avoids=["black"] -> conflict via the same exact-string fallback', () => {
    const f = facts({ detectedColor: "black", confidence: "high — clearly visible" });
    const r = checkColourPreference(["black"], f);
    assert.equal(r.status, "conflict");
    assert.equal(r.determinedBy, "vision");
  });

  it('declared="White", avoids=["black"] -> clear — exact-string fallback only matches identical words, never two different family-less colours', () => {
    const f = facts({ declaredColor: ["White"] });
    const r = checkColourPreference(["black"], f);
    assert.equal(r.status, "clear");
  });
});

describe("B2b2 §10 — empty avoidColours preserves B2b1's existing contract", () => {
  it("no avoidColours on file -> unknown, determinedBy=none, regardless of declared/vision evidence", () => {
    const f = facts({ declaredColor: ["red"], detectedColor: "red", confidence: "high — clearly visible" });
    const r = checkColourPreference([], f);
    assert.equal(r.status, "unknown");
    assert.equal(r.determinedBy, "none");
  });
});

describe("B2b2 §13 — advisory authority remains frozen (B2b1 is not reopened)", () => {
  function cleanConstructionFacts(opts: Parameters<typeof facts>[0]) {
    return facts({ ...opts });
  }

  it("BUY + B2b2 colour conflict only (vision-determined) -> remains BUY", () => {
    const f = facts({ detectedColor: "red", confidence: "high — clearly visible" });
    const constraintEvidence = checkHardConstraints({ dressingPreferences: [] }, f);
    const veto = applyHardConstraintVeto(constraintEvidence);
    assert.equal(veto.vetoed, false);
    const result = applyVerdictOverride({ verdict: "BUY", confidence: 90 }, veto, "BUY");
    assert.equal(result.verdict, "BUY");
  });

  it("BUY + reliable family-alias conflict (navy vs blue) -> remains BUY", () => {
    const f = facts({ detectedColor: "navy", confidence: "high — clearly visible" });
    const constraintEvidence = checkHardConstraints({ dressingPreferences: [] }, f);
    const veto = applyHardConstraintVeto(constraintEvidence);
    const result = applyVerdictOverride({ verdict: "BUY", confidence: 90 }, veto, "BUY");
    assert.equal(result.verdict, "BUY");
    const colour = checkColourPreference(["blue"], f);
    assert.equal(colour.status, "conflict", "sanity: the family alias really is detected as a conflict");
  });

  it("BUY + declared-colour conflict -> remains BUY", () => {
    const f = facts({ declaredColor: ["red"] });
    const constraintEvidence = checkHardConstraints({ dressingPreferences: [] }, f);
    const veto = applyHardConstraintVeto(constraintEvidence);
    const result = applyVerdictOverride({ verdict: "BUY", confidence: 90 }, veto, "BUY");
    assert.equal(result.verdict, "BUY");
  });

  it("BUY + multicolour conflict -> remains BUY", () => {
    const f = facts({ declaredColor: ["Pink", "Red", "Beige"] });
    const constraintEvidence = checkHardConstraints({ dressingPreferences: [] }, f);
    const veto = applyHardConstraintVeto(constraintEvidence);
    const result = applyVerdictOverride({ verdict: "BUY", confidence: 90 }, veto, "BUY");
    assert.equal(result.verdict, "BUY");
  });

  it("BUY + true dressing hard violation (unrelated to colour) -> still flips to SKIP", () => {
    const f = facts({ detectedColor: "blue", confidence: "high — clearly visible" }); // no colour conflict at all
    const withViolation = normalizeDeclaredFacts({ category: "Top", color: [], brand: null, size: null });
    const violationFacts = mergeVisionFacts(withViolation, {
      detectedColor: "blue",
      productSnapshot: { observedSleeveLength: "sleeveless", observedShoulderCoverage: false, observationConfidence: "high — clearly visible" },
    });
    const constraintEvidence = checkHardConstraints({ dressingPreferences: ["arms-covered"] }, violationFacts);
    const veto = applyHardConstraintVeto(constraintEvidence);
    assert.equal(veto.vetoed, true);
    const result = applyVerdictOverride({ verdict: "BUY", confidence: 90 }, veto, "BUY");
    assert.equal(result.verdict, "SKIP");
  });

  it("BUY + colour advisory + hard dressing violation -> still flips, attributable to the dressing violation only", () => {
    const declared = normalizeDeclaredFacts({ category: "Top", color: [], brand: null, size: null });
    const f = mergeVisionFacts(declared, {
      detectedColor: "red",
      productSnapshot: { observedSleeveLength: "sleeveless", observedShoulderCoverage: false, observationConfidence: "high — clearly visible" },
    });
    const constraintEvidence = checkHardConstraints({ dressingPreferences: ["arms-covered"] }, f);
    assert.equal(constraintEvidence.checks.length, 1, "colour never enters constraintEvidence.checks");
    const veto = applyHardConstraintVeto(constraintEvidence);
    assert.equal(veto.vetoed, true);
    assert.ok(!veto.vetoReason.toLowerCase().includes("colour") && !veto.vetoReason.toLowerCase().includes("color"));
    const result = applyVerdictOverride({ verdict: "BUY", confidence: 90 }, veto, "BUY");
    assert.equal(result.verdict, "SKIP");
    const colour = checkColourPreference(["red"], f);
    assert.equal(colour.status, "conflict", "sanity: the advisory still exists, it just isn't why the verdict flipped");
  });

  it("hasHardViolation is structurally unable to see colour preference evidence — checkHardConstraints never receives avoidColours at all", () => {
    const f = facts({ detectedColor: "red", confidence: "high — clearly visible" });
    const constraintEvidence = checkHardConstraints({ dressingPreferences: [] }, f);
    assert.equal(constraintEvidence.checks.length, 0);
    assert.equal(constraintEvidence.hasHardViolation, false);
  });
});

describe("B2b2 — vocabulary evolution: 13 canonical Passport IDs (not 9), and the compound-label self-mapping shim", () => {
  // quiz-data.ts's COLOUR_FAMILIES — mechanically confirmed 13 option IDs,
  // not the 9 the earlier recon recorded. "metallics" is the one genuine
  // coverage gap (a finish/material, not a hue); the other 12 all resolve.
  const ALL_13_PASSPORT_IDS = [
    "black", "white-cream", "beige-brown", "grey", "navy", "blue", "green",
    "red-burgundy", "pink", "purple", "yellow", "orange", "metallics",
  ];

  it("every one of the 13 canonical IDs resolves without throwing, as its own avoid value matched against itself", () => {
    for (const id of ALL_13_PASSPORT_IDS) {
      const f = facts({ detectedColor: id, confidence: "high — clearly visible" });
      const r = checkColourPreference([id], f);
      assert.ok(["conflict", "clear", "unknown"].includes(r.status), `${id} produced an invalid status: ${r.status}`);
    }
  });

  it('12 of the 13 IDs (all except "metallics") resolve to themselves as a conflict when the candidate is exactly that ID', () => {
    for (const id of ALL_13_PASSPORT_IDS.filter((x) => x !== "metallics")) {
      const f = facts({ detectedColor: id, confidence: "high — clearly visible" });
      const r = checkColourPreference([id], f);
      assert.equal(r.status, "conflict", `"${id}" vs itself should be a conflict (exact-match or family-resolution)`);
    }
  });

  it('REGRESSION FIX — the 3 compound Passport labels B2b1\'s old substring matching caught by luck, now caught by the self-mapping shim instead of being silently lost', () => {
    const cases: Array<[string, string]> = [
      ["burgundy", "red-burgundy"], // "red-burgundy".includes("burgundy") was true under B0/B1 substring logic
      ["cream", "white-cream"],     // "white-cream".includes("cream") was true
      ["off-black", "black"],       // "off-black".includes("black") was true
    ];
    for (const [detected, avoid] of cases) {
      const f = facts({ detectedColor: detected, confidence: "high — clearly visible" });
      const r = checkColourPreference([avoid], f);
      assert.equal(r.status, "conflict", `detected="${detected}" avoid="${avoid}" must still resolve as a conflict after B2b2`);
    }
  });

  it('a case that was NEVER caught by substring either (wine vs red-burgundy) now works via the shim + hue-family resolution — a genuine improvement, not just parity', () => {
    const f = facts({ detectedColor: "wine", confidence: "high — clearly visible" });
    const r = checkColourPreference(["red-burgundy"], f);
    assert.equal(r.status, "conflict");
  });

  it('Passport avoidColors=["metallics"] + candidate "Gold" -> clear, never a fabricated conflict', () => {
    const f = facts({ declaredColor: ["Gold"] });
    const r = checkColourPreference(["metallics"], f);
    assert.notEqual(r.status, "conflict", "must never fabricate a metallics match for gold");
    assert.equal(r.status, "clear");
  });

  it('Passport avoidColors=["metallics"] + candidate "Silver" -> clear, never a fabricated conflict', () => {
    const f = facts({ declaredColor: ["Silver"] });
    const r = checkColourPreference(["metallics"], f);
    assert.notEqual(r.status, "conflict", "must never fabricate a metallics match for silver");
    assert.equal(r.status, "clear");
  });

  it('"metallics" is never silently mapped to gold, silver, grey, or yellow — its own resolution stays genuinely unknown', () => {
    const f = facts({ detectedColor: "metallics", confidence: "high — clearly visible" });
    const r = checkColourPreference(["grey"], f); // if metallics were fabricated into "grey" (silver's family), this would wrongly conflict
    assert.notEqual(r.status, "conflict");
  });

  it('"Gold" and "Silver" resolve via their OWN real families (yellow / grey), not conflated with each other or with "metallics"', () => {
    const gold = checkColourPreference(["yellow"], facts({ declaredColor: ["Gold"] }));
    assert.equal(gold.status, "conflict", "Gold -> yellow hue family, matches avoid=yellow");
    assert.deepEqual(gold.declaredFamilies.hueFamilies, ["yellow"]);

    const silver = checkColourPreference(["grey"], facts({ declaredColor: ["Silver"] }));
    assert.equal(silver.status, "conflict", "Silver -> grey hue family, matches avoid=grey");
    assert.deepEqual(silver.declaredFamilies.hueFamilies, ["grey"]);

    const goldVsGrey = checkColourPreference(["grey"], facts({ declaredColor: ["Gold"] }));
    assert.equal(goldVsGrey.status, "clear", "Gold must not be conflated with Silver's grey family");
  });
});

describe("B2b2 §14 — confidence/modelConfidence invariance (unchanged from B2b1)", () => {
  it("colour advisory only, any determining source -> confidence is NOT nulled, no modelVerdict/modelConfidence override state", () => {
    const f = facts({ declaredColor: ["red"] });
    const constraintEvidence = checkHardConstraints({ dressingPreferences: [] }, f);
    const veto = applyHardConstraintVeto(constraintEvidence);
    const result = applyVerdictOverride({ verdict: "BUY", confidence: 73 }, veto, "BUY");
    assert.equal(result.confidence, 73);
    assert.equal(result.modelConfidence, null);
    assert.equal(result.verdictOverridden, false);
  });

  it("true hard dressing violation -> confidence still nulled, modelConfidence still preserved, exactly as B0/B2b1", () => {
    const declared = normalizeDeclaredFacts({ category: "Top", color: [], brand: null, size: null });
    const f = mergeVisionFacts(declared, {
      productSnapshot: { observedSleeveLength: "sleeveless", observedShoulderCoverage: false, observationConfidence: "high — clearly visible" },
    });
    const constraintEvidence = checkHardConstraints({ dressingPreferences: ["arms-covered"] }, f);
    const veto = applyHardConstraintVeto(constraintEvidence);
    const result = applyVerdictOverride({ verdict: "BUY", confidence: 88 }, veto, "BUY");
    assert.equal(result.confidence, null);
    assert.equal(result.modelConfidence, 88);
  });
});
