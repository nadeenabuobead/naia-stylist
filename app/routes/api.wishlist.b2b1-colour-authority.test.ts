// app/routes/api.wishlist.b2b1-colour-authority.test.ts
//
// B2b1 — isolates ONE change: avoidColors moves from hard-veto authority to
// advisory evidence. Colour-matching semantics (substring, no confidence
// gate, vision-only) are deliberately UNCHANGED from B0/B1/B2a — see the
// B2b2 debt list in the B2b1 report. Every true hard constraint
// (sleeve/arms, neckline, midriff, and their composite modesty checks)
// keeps its exact B0 veto authority; these fixtures prove that explicitly,
// not just that colour lost its authority.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  checkHardConstraints,
  checkColourPreference,
} from "~/lib/buyskip/constraint-evidence.server";
import { applyHardConstraintVeto } from "~/lib/buyskip/decision-evidence.server";
import { normalizeDeclaredFacts, mergeVisionFacts } from "~/lib/buyskip/product-facts.server";
import { applyVerdictOverride } from "~/routes/api.wishlist.jsx";

function facts(productSnapshot: Record<string, unknown> = {}) {
  const declared = normalizeDeclaredFacts({ category: "Top", color: [], brand: null, size: null });
  return mergeVisionFacts(declared, { detectedColor: typeof productSnapshot.detectedColor === "string" ? productSnapshot.detectedColor : undefined, productSnapshot });
}

// A garment with full arm/neckline/midriff coverage — no true hard violation
// possible — plus a colour the fixture will (or won't) declare as avoided.
function cleanConstructionFacts(detectedColor: string) {
  return facts({
    detectedColor,
    observedSleeveLength: "full",
    observedShoulderCoverage: true,
    observedMidriffExposed: false,
    observedNecklineCoverage: "crew",
    observationConfidence: "high — clearly visible",
  });
}

// A garment with a genuine hard violation (sleeveless, arms-covered required).
function hardViolationFacts(detectedColor: string, confidence = "high — clearly visible") {
  return facts({
    detectedColor,
    observedSleeveLength: "sleeveless",
    observedShoulderCoverage: false,
    observedMidriffExposed: false,
    observedNecklineCoverage: "crew",
    observationConfidence: confidence,
  });
}

describe("B2b1 §8 — hasHardViolation: colour alone can never make it true", () => {
  it("A: colour conflict only -> hasHardViolation = false", () => {
    const f = cleanConstructionFacts("red");
    const constraintEvidence = checkHardConstraints({ dressingPreferences: ["arms-covered"] }, f);
    assert.equal(constraintEvidence.hasHardViolation, false);
    const colour = checkColourPreference(["red"], f);
    assert.equal(colour.status, "conflict", "the match is real, just not hard-constraint authority");
  });

  it("B: real dressing violation only -> hasHardViolation = true", () => {
    const f = hardViolationFacts("blue");
    const constraintEvidence = checkHardConstraints({ dressingPreferences: ["arms-covered"] }, f);
    assert.equal(constraintEvidence.hasHardViolation, true);
  });

  it("C: colour conflict + real dressing violation -> true, attributable to the dressing violation", () => {
    const f = hardViolationFacts("red");
    const constraintEvidence = checkHardConstraints({ dressingPreferences: ["arms-covered"] }, f);
    assert.equal(constraintEvidence.hasHardViolation, true);
    assert.equal(constraintEvidence.checks.length, 1, "only the dressing check is present — colour never enters this array");
    assert.equal(constraintEvidence.checks[0].requirementId, "arms-covered");
    const colour = checkColourPreference(["red"], f);
    assert.equal(colour.status, "conflict");
  });

  it("D: no violations -> hasHardViolation = false", () => {
    const f = cleanConstructionFacts("blue");
    const constraintEvidence = checkHardConstraints({ dressingPreferences: ["arms-covered"] }, f);
    assert.equal(constraintEvidence.hasHardViolation, false);
  });
});

describe("B2b1 §9 — verdict causal matrix (the core proof)", () => {
  it("AI BUY + colour conflict only -> BEFORE B2b1 would have become SKIP; AFTER, remains BUY", () => {
    const f = cleanConstructionFacts("red");
    const constraintEvidence = checkHardConstraints({ dressingPreferences: ["arms-covered"] }, f);
    const veto = applyHardConstraintVeto(constraintEvidence);
    assert.equal(veto.vetoed, false, "colour evidence never reaches applyHardConstraintVeto at all");

    const aiAnalysis = { verdict: "BUY", confidence: 90, finalThought: "A versatile piece for your wardrobe.", buyIf: "You wear red often." };
    const result = applyVerdictOverride(aiAnalysis, veto, aiAnalysis.verdict);
    assert.equal(result.verdict, "BUY");
    assert.equal(result.verdictOverridden, false);
  });

  it("AI SKIP + colour conflict -> remains SKIP (never overridden positively)", () => {
    const f = cleanConstructionFacts("red");
    const constraintEvidence = checkHardConstraints({ dressingPreferences: ["arms-covered"] }, f);
    const veto = applyHardConstraintVeto(constraintEvidence);
    const aiAnalysis = { verdict: "SKIP", confidence: 40, finalThought: "Not quite right for you.", buyIf: null };
    const result = applyVerdictOverride(aiAnalysis, veto, aiAnalysis.verdict);
    assert.equal(result.verdict, "SKIP");
    assert.equal(result.verdictOverridden, false);
  });

  it("AI BUY + actual hard dressing violation -> still becomes SKIP", () => {
    const f = hardViolationFacts("blue");
    const constraintEvidence = checkHardConstraints({ dressingPreferences: ["arms-covered"] }, f);
    const veto = applyHardConstraintVeto(constraintEvidence);
    assert.equal(veto.vetoed, true);
    const aiAnalysis = { verdict: "BUY", confidence: 88, finalThought: "A great layering piece.", buyIf: "Worn under a jacket." };
    const result = applyVerdictOverride(aiAnalysis, veto, aiAnalysis.verdict);
    assert.equal(result.verdict, "SKIP");
    assert.equal(result.verdictOverridden, true);
    assert.equal(result.modelVerdict, "BUY");
  });

  it("AI BUY + colour conflict + actual hard violation -> still becomes SKIP, because of the hard violation", () => {
    const f = hardViolationFacts("red");
    const constraintEvidence = checkHardConstraints({ dressingPreferences: ["arms-covered"] }, f);
    const veto = applyHardConstraintVeto(constraintEvidence);
    assert.equal(veto.vetoed, true);
    assert.ok(veto.vetoReason.includes("arms covered") || veto.vetoReason.toLowerCase().includes("arms"), "the veto reason names the real dressing requirement, not colour");
    assert.ok(!veto.vetoReason.toLowerCase().includes("colour") && !veto.vetoReason.toLowerCase().includes("color"));

    const aiAnalysis = { verdict: "BUY", confidence: 85, finalThought: "A bold red statement piece.", buyIf: "You want more colour in your wardrobe." };
    const result = applyVerdictOverride(aiAnalysis, veto, aiAnalysis.verdict);
    assert.equal(result.verdict, "SKIP");
    assert.equal(result.verdictOverridden, true);
  });

  it("AI BUY + no conflicts at all -> unchanged", () => {
    const f = cleanConstructionFacts("blue");
    const constraintEvidence = checkHardConstraints({ dressingPreferences: ["arms-covered"] }, f);
    const veto = applyHardConstraintVeto(constraintEvidence);
    const aiAnalysis = { verdict: "BUY", confidence: 92, finalThought: "Great fit for you.", buyIf: "Any weekday." };
    const result = applyVerdictOverride(aiAnalysis, veto, aiAnalysis.verdict);
    assert.equal(result.verdict, "BUY");
    assert.equal(result.verdictOverridden, false);
    assert.equal(result.confidence, 92, "confidence untouched when nothing vetoes");
  });
});

describe("B2b1 §6 — confidence no longer mediates the removed colour veto", () => {
  it("low-confidence colour match -> never a veto, regardless of what the advisory reports (B2b2 update: low confidence now correctly reports 'unknown', not 'conflict' — see api.wishlist.b2b2-colour-evidence.test.ts for the confidence-gate fix itself; this test's job is only to re-prove authority stays frozen either way)", () => {
    const lowConfFacts = facts({
      detectedColor: "red",
      observedSleeveLength: "full", observedShoulderCoverage: true, observedMidriffExposed: false,
      observedNecklineCoverage: "crew", observationConfidence: "low — image quality limits assessment",
    });
    const constraintEvidence = checkHardConstraints({ dressingPreferences: ["arms-covered"] }, lowConfFacts);
    assert.equal(constraintEvidence.hasHardViolation, false);
    const colour = checkColourPreference(["red"], lowConfFacts);
    assert.equal(colour.status, "unknown", "B2b2: low-confidence vision with no declared colour can no longer determine a status at all");
    const veto = applyHardConstraintVeto(constraintEvidence);
    assert.equal(veto.vetoed, false);
  });

  it("high-confidence colour match -> advisory, no veto — same authority outcome as low confidence", () => {
    const f = cleanConstructionFacts("red");
    const constraintEvidence = checkHardConstraints({ dressingPreferences: ["arms-covered"] }, f);
    assert.equal(constraintEvidence.hasHardViolation, false);
    const colour = checkColourPreference(["red"], f);
    assert.equal(colour.status, "conflict");
    const veto = applyHardConstraintVeto(constraintEvidence);
    assert.equal(veto.vetoed, false);
  });
});

describe("B2b1 §10 — confidence/modelConfidence invariance", () => {
  it("colour advisory only: confidence is NOT nulled — no deterministic veto happened", () => {
    const f = cleanConstructionFacts("red");
    const constraintEvidence = checkHardConstraints({ dressingPreferences: ["arms-covered"] }, f);
    const veto = applyHardConstraintVeto(constraintEvidence);
    const aiAnalysis = { verdict: "BUY", confidence: 77 };
    const result = applyVerdictOverride(aiAnalysis, veto, aiAnalysis.verdict);
    assert.equal(result.confidence, 77, "no veto fired, so B0's confidence-null behavior must not trigger");
    assert.equal(result.modelConfidence, null, "modelConfidence only exists when an override actually happened");
  });

  it("true hard dressing veto: B0's existing confidence=null + modelConfidence preservation is UNCHANGED", () => {
    const f = hardViolationFacts("blue");
    const constraintEvidence = checkHardConstraints({ dressingPreferences: ["arms-covered"] }, f);
    const veto = applyHardConstraintVeto(constraintEvidence);
    const aiAnalysis = { verdict: "BUY", confidence: 91 };
    const result = applyVerdictOverride(aiAnalysis, veto, aiAnalysis.verdict);
    assert.equal(result.confidence, null, "B0's existing correction: a vetoed verdict's confidence no longer describes it");
    assert.equal(result.modelConfidence, 91, "the original AI confidence is preserved for the record, exactly as before B2b1");
  });
});

describe("B2b1 §11 — customer-facing explanation consistency", () => {
  it("colour advisory only: finalThought/buyIf are NOT touched — no veto explanation is generated", () => {
    const f = cleanConstructionFacts("red");
    const constraintEvidence = checkHardConstraints({ dressingPreferences: ["arms-covered"] }, f);
    const veto = applyHardConstraintVeto(constraintEvidence);
    const aiAnalysis = { verdict: "BUY", confidence: 90, finalThought: "A bold, versatile piece for your wardrobe.", buyIf: "You wear red often." };
    const result = applyVerdictOverride(aiAnalysis, veto, aiAnalysis.verdict);
    assert.equal(result.finalThought, "A bold, versatile piece for your wardrobe.", "unchanged — not overwritten with veto language");
    assert.equal(result.buyIf, "You wear red often.", "unchanged — colour cannot null a BUY field on its own");
  });

  it("true hard violation: finalThought IS correctly replaced with the veto reason, exactly as B0 always did", () => {
    const f = hardViolationFacts("blue");
    const constraintEvidence = checkHardConstraints({ dressingPreferences: ["arms-covered"] }, f);
    const veto = applyHardConstraintVeto(constraintEvidence);
    const aiAnalysis = { verdict: "BUY", confidence: 85, finalThought: "Perfect for layering.", buyIf: "Under a blazer." };
    const result = applyVerdictOverride(aiAnalysis, veto, aiAnalysis.verdict);
    assert.equal(result.finalThought, veto.vetoReason);
    assert.equal(result.buyIf, null);
  });
});

describe("B2b1 — checkColourPreference output shape (admin/debug visibility)", () => {
  it("no avoidColours on file -> unknown, not clear/conflict", () => {
    const r = checkColourPreference([], cleanConstructionFacts("red"));
    assert.equal(r.status, "unknown");
  });
  it("avoidColours present, no detected colour -> unknown", () => {
    const r = checkColourPreference(["red"], facts({}));
    assert.equal(r.status, "unknown");
    assert.equal(r.detectedColour, null);
  });
  it("match -> status 'conflict', never the word 'violated'", () => {
    const r = checkColourPreference(["red"], cleanConstructionFacts("red"));
    assert.equal(r.status, "conflict");
    assert.ok(!("state" in r), "ColourPreferenceEvidence must not look like a ConstraintCheck");
  });
  it("no match -> status 'clear'", () => {
    const r = checkColourPreference(["red"], cleanConstructionFacts("blue"));
    assert.equal(r.status, "clear");
  });
  it("avoidColours and detectedColour are preserved verbatim for admin display", () => {
    const r = checkColourPreference(["red", "orange"], cleanConstructionFacts("red"));
    assert.deepEqual(r.avoidColours, ["red", "orange"]);
    assert.equal(r.detectedColour, "red");
  });
});
