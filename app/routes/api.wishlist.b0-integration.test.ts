// app/routes/api.wishlist.b0-integration.test.ts
//
// B0 — reconciliation of the frozen Buy/Skip deterministic evidence
// foundation (fix/buyskip-product-foundation @ 225a07a) onto the current
// Lane-A base (fix/wardrobe-intelligence-revision @ 809bca6).
//
// These exercise the real exported pure helpers (no DB, no Cloudinary, no
// Claude call): the full candidate-facts -> constraint-evidence -> veto ->
// confidence-correction chain, plus proof that the newer Lane-A
// wardrobe-state exports are untouched by this reconciliation.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyVerdictOverride,
  WARDROBE_CONTEXT_ELIGIBLE_CATEGORIES,
  toWardrobePassport,
  resolveWardrobeContext,
  buildWardrobeContextBlock,
} from "./api.wishlist.jsx";
import { normalizeDeclaredFacts, mergeVisionFacts } from "~/lib/buyskip/product-facts.server";
import { checkHardConstraints } from "~/lib/buyskip/constraint-evidence.server";
import { applyHardConstraintVeto } from "~/lib/buyskip/decision-evidence.server";

// A sleeveless top, as the vision model itself would report it.
function sleevelessFacts() {
  const declared = normalizeDeclaredFacts({ category: "Top", color: ["BLACK"], brand: null, size: "M" });
  return mergeVisionFacts(declared, {
    itemType: "Tank Top",
    detectedColor: "BLACK",
    productSnapshot: {
      observedSilhouette: "fitted",
      observedFitProfile: "fitted",
      observedFormality: "casual",
      observedSleeveLength: "sleeveless",
      observedNecklineCoverage: "crew",
      observedShoulderCoverage: false,
      observedMidriffExposed: false,
      observedMaterial: "cotton",
      observedPattern: "solid",
      observationConfidence: "high — clearly visible",
    },
  });
}

// A long-sleeve blazer — nothing in its observed construction conflicts
// with any hard dressing requirement.
function fullCoverageFacts() {
  const declared = normalizeDeclaredFacts({ category: "Outerwear", color: ["NAVY"], brand: null, size: "M" });
  return mergeVisionFacts(declared, {
    itemType: "Blazer",
    detectedColor: "NAVY",
    productSnapshot: {
      observedSilhouette: "straight",
      observedFitProfile: "tailored",
      observedFormality: "business-casual",
      observedSleeveLength: "full",
      observedNecklineCoverage: "crew",
      observedShoulderCoverage: true,
      observedMidriffExposed: false,
      observedMaterial: "wool",
      observedPattern: "solid",
      observationConfidence: "high — clearly visible",
    },
  });
}

// The vision model couldn't tell — low confidence, no coverage fields stated.
function unknownCoverageFacts() {
  const declared = normalizeDeclaredFacts({ category: "Dress", color: ["RED"], brand: null, size: "M" });
  return mergeVisionFacts(declared, {
    itemType: "Dress",
    detectedColor: "RED",
    productSnapshot: {
      observedSilhouette: "a-line",
      observedFitProfile: "relaxed",
      observedFormality: "occasion",
      observedSleeveLength: null,
      observedNecklineCoverage: null,
      observedShoulderCoverage: null,
      observedMidriffExposed: null,
      observedMaterial: "silk",
      observedPattern: "solid",
      observationConfidence: "low — image quality limits assessment",
    },
  });
}

describe("B0 — candidate facts -> constraint evidence -> veto (full chain)", () => {
  it("confirmed hard-requirement conflict + AI BUY -> veto fires, final verdict becomes SKIP", () => {
    const facts = sleevelessFacts();
    const constraintEvidence = checkHardConstraints({ dressingPreferences: ["arms-covered"] }, facts);
    assert.equal(constraintEvidence.hasHardViolation, true, "sleeveless top must violate arms-covered");

    const veto = applyHardConstraintVeto(constraintEvidence);
    assert.equal(veto.vetoed, true);

    const aiAnalysis = { verdict: "BUY", confidence: 88, finalThought: "A great layering piece for your wardrobe.", buyIf: "You wear tanks under blazers often." };
    const result = applyVerdictOverride(aiAnalysis, veto, aiAnalysis.verdict);

    assert.equal(result.verdict, "SKIP", "veto must downgrade BUY to SKIP");
    assert.equal(result.verdictOverridden, true);
    assert.equal(result.modelVerdict, "BUY", "the AI's original verdict must be preserved for the record");
  });

  it("no confirmed conflict (full coverage) -> no veto, BUY remains BUY", () => {
    const facts = fullCoverageFacts();
    const constraintEvidence = checkHardConstraints({ dressingPreferences: ["arms-covered", "chest-neckline-covered"] }, facts);
    assert.equal(constraintEvidence.hasHardViolation, false);

    const veto = applyHardConstraintVeto(constraintEvidence);
    assert.equal(veto.vetoed, false);

    const aiAnalysis = { verdict: "BUY", confidence: 91, finalThought: "A versatile layering piece.", buyIf: "You want more work-appropriate outerwear." };
    const result = applyVerdictOverride(aiAnalysis, veto, aiAnalysis.verdict);

    assert.equal(result.verdict, "BUY", "verdict must be untouched when there is no violation");
    assert.equal(result.verdictOverridden, false);
    assert.equal(result.confidence, 91, "confidence must be untouched when there is no override");
    assert.equal(result.modelConfidence, null, "modelConfidence only exists when an override actually happened");
  });

  it("unknown candidate fact (low vision confidence) -> never vetoes, even with a matching hard requirement", () => {
    const facts = unknownCoverageFacts();
    const constraintEvidence = checkHardConstraints({ dressingPreferences: ["arms-covered", "chest-neckline-covered"] }, facts);
    assert.equal(constraintEvidence.hasHardViolation, false, "unknown must never count as violated");
    assert.ok(constraintEvidence.checks.every(c => c.state === "unknown"));

    const veto = applyHardConstraintVeto(constraintEvidence);
    assert.equal(veto.vetoed, false);
  });

  it("soft preference (not a hard-requirement token) -> produces no check at all, never vetoes", () => {
    const facts = sleevelessFacts(); // objectively sleeveless
    // "longer-tops" is a real dressing-preferences option ID but has no
    // mapping in HARD_REQUIREMENT_MAP — it must never be silently upgraded
    // into a hard constraint.
    const constraintEvidence = checkHardConstraints({ dressingPreferences: ["longer-tops"] }, facts);
    assert.equal(constraintEvidence.checks.length, 0, "an unmapped soft preference must produce zero checks");
    assert.equal(constraintEvidence.hasHardViolation, false);
  });

  it("veto never fires on a SKIP or MAYBE model verdict — only a BUY can be downgraded", () => {
    const facts = sleevelessFacts();
    const constraintEvidence = checkHardConstraints({ dressingPreferences: ["arms-covered"] }, facts);
    const veto = applyHardConstraintVeto(constraintEvidence);
    assert.equal(veto.vetoed, true, "the constraint check itself has nothing to do with the model's verdict");

    const aiAnalysis = { verdict: "SKIP", confidence: 40, finalThought: "This doesn't suit your lifestyle.", buyIf: null };
    const result = applyVerdictOverride(aiAnalysis, veto, aiAnalysis.verdict);

    assert.equal(result.verdict, "SKIP", "already SKIP — nothing to override");
    assert.equal(result.verdictOverridden, false, "a SKIP was never overridden FROM a BUY, so this must read false");
    assert.equal(result.confidence, 40, "the model's own SKIP confidence is untouched — it still describes the persisted verdict");
  });
});

describe("B0 — confidence correction after override", () => {
  it("a vetoed BUY's confidence does not survive onto the persisted SKIP", () => {
    const facts = sleevelessFacts();
    const constraintEvidence = checkHardConstraints({ dressingPreferences: ["arms-covered"] }, facts);
    const veto = applyHardConstraintVeto(constraintEvidence);

    const aiAnalysis = { verdict: "BUY", confidence: 95 };
    const result = applyVerdictOverride(aiAnalysis, veto, aiAnalysis.verdict);

    assert.equal(result.confidence, null, "confidence must be null — it described the discarded BUY, not the persisted SKIP");
    assert.equal(result.modelConfidence, 95, "the AI's original confidence must be preserved under modelConfidence, mirroring modelVerdict");
  });

  it("a non-numeric AI confidence degrades to null on both fields, never throws", () => {
    const facts = sleevelessFacts();
    const constraintEvidence = checkHardConstraints({ dressingPreferences: ["arms-covered"] }, facts);
    const veto = applyHardConstraintVeto(constraintEvidence);

    const aiAnalysis = { verdict: "BUY", confidence: "high" }; // malformed model output
    const result = applyVerdictOverride(aiAnalysis, veto, aiAnalysis.verdict);

    assert.equal(result.modelConfidence, null);
  });
});

describe("B0 — explanation consistency after override", () => {
  it("finalThought and buyIf never contradict a vetoed SKIP", () => {
    const facts = sleevelessFacts();
    const constraintEvidence = checkHardConstraints({ dressingPreferences: ["arms-covered"] }, facts);
    const veto = applyHardConstraintVeto(constraintEvidence);

    const aiAnalysis = {
      verdict: "BUY",
      confidence: 88,
      finalThought: "Perfect for your minimalist weekend style — buy it.",
      buyIf: "You want a versatile layering basic.",
      skipIf: "You need full arm coverage for work.",
    };
    const result = applyVerdictOverride(aiAnalysis, veto, aiAnalysis.verdict);

    assert.equal(result.verdict, "SKIP");
    assert.ok(!/buy it/i.test(result.finalThought), "the customer-facing summary must not still say 'buy it' once the verdict is SKIP");
    assert.equal(result.finalThought, veto.vetoReason, "finalThought must be the deterministic veto reason, not AI prose written for a different verdict");
    assert.equal(result.buyIf, null, "a BUY-justifying condition must not be shown once the verdict is SKIP");
  });
});

describe("B0 — Lane-A wardrobe-state integration is untouched", () => {
  it("the shared-resolver wardrobe-context exports still exist and still behave as before", () => {
    assert.ok(WARDROBE_CONTEXT_ELIGIBLE_CATEGORIES.has("Top"));
    assert.equal(toWardrobePassport(null), null);
    assert.equal(resolveWardrobeContext("Top", [], []), null);
    assert.equal(buildWardrobeContextBlock(null), "");
  });
});
