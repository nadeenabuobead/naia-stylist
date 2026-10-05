// app/lib/buyskip/buyskip-foundation.test.ts
// Regression tests for the Buy/Skip product-foundation layer (Phases 3-8).
// Pure unit tests — no DB, no network.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeDeclaredFacts, mergeVisionFacts } from "./product-facts.server";
import { computeDuplicateEvidence } from "./duplicate-evidence.server";
import { checkHardConstraints, checkColourPreference } from "./constraint-evidence.server";
import { getWardrobeNeedEvidence } from "./wardrobe-need.server";
import { assembleDecisionEvidence, applyHardConstraintVeto } from "./decision-evidence.server";

function facts(overrides = {}) {
  const declared = normalizeDeclaredFacts({ category: "Top", color: ["Black"], brand: "Acme", size: "M" });
  return mergeVisionFacts(declared, {
    itemType: "Blazer",
    detectedColor: "BLACK",
    productSnapshot: {
      observedSilhouette: "fitted",
      observedFitProfile: "tailored",
      observedFormality: "business-casual",
      observedSleeveLength: "full",
      observedNecklineCoverage: "crew",
      observedShoulderCoverage: true,
      observedMidriffExposed: false,
      observedMaterial: "wool",
      observedPattern: "solid",
      observationConfidence: "high",
      ...overrides,
    },
  });
}

describe("product-facts: known / inferred / unknown provenance", () => {
  it("declared fields are known with customer-declared provenance", () => {
    const declared = normalizeDeclaredFacts({ category: "Top", color: ["Black"], brand: null, size: null });
    assert.equal(declared.category.status, "known");
    assert.equal(declared.category.provenance, "customer-declared");
    assert.equal(declared.brand.status, "unknown");
    assert.equal(declared.brand.provenance, "not-provided");
  });

  it("vision-derived fields are inferred with vision-model provenance, never known", () => {
    const f = facts();
    assert.equal(f.silhouette.status, "inferred");
    assert.equal(f.silhouette.provenance, "vision-model");
    assert.notEqual(f.silhouette.status, "known");
  });

  it("null model output becomes unknown, not a fabricated value", () => {
    const f = facts({ observedMaterial: null, observationConfidence: "low" });
    assert.equal(f.material.status, "unknown");
    assert.equal(f.material.value, null);
  });

  it("price/title/description are always unknown — never collected by this flow", () => {
    const f = facts();
    assert.equal(f.price.status, "unknown");
    assert.equal(f.title.status, "unknown");
    assert.equal(f.description.status, "unknown");
  });
});

describe("duplicate-evidence: regression class — same-slot items must stay available", () => {
  it("zero same-slot candidates is a determinate no-supported-overlap, not unknown", () => {
    const e = computeDuplicateEvidence(facts(), []);
    assert.equal(e.overlap, "no-supported-overlap");
    assert.equal(e.sameSlotCandidateCount, 0);
  });

  it("category match alone is never called a duplicate (regression #2)", () => {
    // Same category ("Top"→TOPS), but every other field diverges — no field overlap at all.
    const closet = [{ name: "Red Silk Camisole", category: "TOPS", primaryColor: "red", silhouette: "flowy", fitProfile: "relaxed", formality: "casual", sleeveLength: "sleeveless", necklineCoverage: "low" }];
    const e = computeDuplicateEvidence(facts(), closet);
    assert.equal(e.overlap, "no-supported-overlap");
    assert.equal(e.matches.length, 0);
  });

  it("3+ matching fields is strong-overlap with the matched item named", () => {
    const closet = [{ name: "Black Tailored Blazer", category: "TOPS", primaryColor: "black", silhouette: "fitted", fitProfile: "tailored", formality: "business-casual", sleeveLength: "full", necklineCoverage: "crew" }];
    const e = computeDuplicateEvidence(facts(), closet);
    assert.equal(e.overlap, "strong-overlap");
    assert.equal(e.matches[0].closetItemName, "Black Tailored Blazer");
    assert.ok(e.matches[0].matchCount >= 3);
  });

  it("1-2 matching fields is some-overlap, not strong", () => {
    const closet = [{ name: "Navy Casual Top", category: "TOPS", primaryColor: "black", silhouette: "relaxed", fitProfile: "relaxed", formality: "casual", sleeveLength: "short", necklineCoverage: "v-neck" }];
    const e = computeDuplicateEvidence(facts(), closet);
    assert.equal(e.overlap, "some-overlap");
  });

  it("missing data on either side never scores as a match (regression #3)", () => {
    const closet = [{ name: "Unlabeled Item", category: "TOPS", primaryColor: null, silhouette: null, fitProfile: null, formality: null, sleeveLength: null, necklineCoverage: null }];
    const e = computeDuplicateEvidence(facts(), closet);
    assert.equal(e.matches.length, 0);
    assert.equal(e.overlap, "no-supported-overlap");
  });

  it("deterministic ordering independent of input array order (regression #8)", () => {
    const strong = { name: "Strong Match", category: "TOPS", primaryColor: "black", silhouette: "fitted", fitProfile: "tailored", formality: "business-casual", sleeveLength: "full", necklineCoverage: "crew" };
    const weak = { name: "Weak Match", category: "TOPS", primaryColor: "black", silhouette: "relaxed", fitProfile: "relaxed", formality: "casual", sleeveLength: "short", necklineCoverage: "v-neck" };
    const forward = computeDuplicateEvidence(facts(), [weak, strong]);
    const reversed = computeDuplicateEvidence(facts(), [strong, weak]);
    assert.equal(forward.matches[0].closetItemName, "Strong Match");
    assert.equal(reversed.matches[0].closetItemName, "Strong Match");
    assert.deepEqual(forward.matches.map(m => m.closetItemName), reversed.matches.map(m => m.closetItemName));
  });

  it("no hash/id/ordering input affects the result — same facts, same closet, same output regardless of call order", () => {
    const closet = [{ name: "Black Tailored Blazer", category: "TOPS", primaryColor: "black", silhouette: "fitted", fitProfile: "tailored", formality: "business-casual", sleeveLength: "full", necklineCoverage: "crew" }];
    const a = computeDuplicateEvidence(facts(), closet);
    const b = computeDuplicateEvidence(facts(), closet);
    assert.deepEqual(a, b);
  });
});

describe("constraint-evidence: hard requirements (regression class)", () => {
  it("no declared requirements → no checks, no violation", () => {
    const e = checkHardConstraints({ dressingPreferences: [], dressingRequirementsNote: null }, facts());
    assert.equal(e.hasHardViolation, false);
    assert.equal(e.checks.length, 0);
  });

  it("sleeveless garment violates arms-covered requirement", () => {
    const f = facts({ observedSleeveLength: "sleeveless", observedShoulderCoverage: false });
    const e = checkHardConstraints({ dressingPreferences: ["arms-covered"], dressingRequirementsNote: null }, f);
    assert.equal(e.hasHardViolation, true);
    assert.equal(e.checks.find(c => c.requirementId === "arms-covered")?.state, "violated");
  });

  it("full-sleeve garment satisfies arms-covered requirement", () => {
    const e = checkHardConstraints({ dressingPreferences: ["arms-covered"], dressingRequirementsNote: null }, facts());
    assert.equal(e.hasHardViolation, false);
    assert.equal(e.checks[0].state, "satisfied");
  });

  it("low observation confidence yields unknown, never a false violation (regression #4/#3)", () => {
    const f = facts({ observationConfidence: "low" });
    const e = checkHardConstraints({ dressingPreferences: ["arms-covered"], dressingRequirementsNote: null }, f);
    assert.equal(e.checks[0].state, "unknown");
    assert.equal(e.hasHardViolation, false);
  });

  it("B2b1: avoided colour match is NO LONGER a hard-constraint violation — avoidColors is advisory, checked separately via checkColourPreference", () => {
    const e = checkHardConstraints({ dressingPreferences: [], dressingRequirementsNote: null }, facts());
    assert.equal(e.hasHardViolation, false);
    assert.equal(e.checks.length, 0, "colour never enters the hard-constraint checks array at all");

    const colour = checkColourPreference(["black"], facts());
    assert.equal(colour.status, "conflict", "the match is still detected — just not as hard-constraint authority");
  });

  it("free-text dressing note is deferred, never guessed (Phase 6 DEFERRED_TO_RESOLVED_PASSPORT)", () => {
    const e = checkHardConstraints({ dressingPreferences: [], dressingRequirementsNote: "I keep my ankles covered too" }, facts());
    assert.equal(e.deferredToResolvedPassport, true);
    assert.equal(e.hasHardViolation, false); // not guessed into a violation
  });

  it("unmapped requirement ids (e.g. legs-covered) produce no fabricated check (regression #6)", () => {
    const e = checkHardConstraints({ dressingPreferences: ["legs-covered", "avoid-shorts"], dressingRequirementsNote: null }, facts());
    assert.equal(e.checks.length, 0);
    assert.equal(e.hasHardViolation, false);
  });
});

describe("wardrobe-need: explicit unavailable state (Phase 7, regression #5)", () => {
  it("never fabricates a gap/need claim — always reports unavailable until WI integration", () => {
    const e = getWardrobeNeedEvidence();
    assert.equal(e.status, "unavailable");
  });
});

describe("decision-evidence: assembly + hard-constraint veto (Phase 8, regression #7)", () => {
  it("no violation → no veto, model verdict stands", () => {
    const constraintEvidence = checkHardConstraints({ dressingPreferences: [], dressingRequirementsNote: null }, facts());
    const veto = applyHardConstraintVeto(constraintEvidence);
    assert.equal(veto.vetoed, false);
  });

  it("confirmed violation vetoes regardless of model's own explanation text (model cannot override deterministic evidence)", () => {
    const f = facts({ observedSleeveLength: "sleeveless", observedShoulderCoverage: false });
    const constraintEvidence = checkHardConstraints({ dressingPreferences: ["arms-covered"], dressingRequirementsNote: null }, f);
    const veto = applyHardConstraintVeto(constraintEvidence);
    assert.equal(veto.vetoed, true);
    assert.equal(veto.verdict, "SKIP");
    assert.ok(veto.vetoReason.includes("Keep arms covered"));
  });

  it("assembleDecisionEvidence marks passportAlignment deferred when free-text note present", () => {
    const constraintEvidence = checkHardConstraints({ dressingPreferences: [], dressingRequirementsNote: "custom rule" }, facts());
    const de = assembleDecisionEvidence({
      productFacts: facts(),
      duplicateEvidence: computeDuplicateEvidence(facts(), []),
      constraintEvidence,
      colourPreferenceEvidence: checkColourPreference([], facts()),
      wardrobeNeed: getWardrobeNeedEvidence(),
      computedAt: "2026-10-01T00:00:00.000Z",
    });
    assert.equal(de.passportAlignment, "deferred_to_resolved_passport");
    assert.equal(de.tasteEvidence, "unavailable");
  });

  it("assembleDecisionEvidence marks passportAlignment available when nothing is deferred", () => {
    const constraintEvidence = checkHardConstraints({ dressingPreferences: [], dressingRequirementsNote: null }, facts());
    const de = assembleDecisionEvidence({
      productFacts: facts(),
      duplicateEvidence: computeDuplicateEvidence(facts(), []),
      constraintEvidence,
      colourPreferenceEvidence: checkColourPreference([], facts()),
      wardrobeNeed: getWardrobeNeedEvidence(),
      computedAt: "2026-10-01T00:00:00.000Z",
    });
    assert.equal(de.passportAlignment, "available");
  });
});
