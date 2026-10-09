// app/lib/buyskip/colour-only-skip-guard.test.ts
// B2d deterministic guard — causal proof for applyColourOnlySkipGuard().
//
// Live QA proved prompt wording alone is not reliable enough (two separate
// repro failures, the model citing the avoided colour as the deciding SKIP
// factor both times despite explicit instructions not to). This is the
// deterministic backstop: a colour conflict alone — no hard violation, no
// B4 redundancy signal — must never produce SKIP or SKIP FOR NOW.
//
// Run: node --test --import tsx/esm app/lib/buyskip/colour-only-skip-guard.test.ts

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyColourOnlySkipGuard } from "./decision-evidence.server.ts";
import type { ConstraintEvidence, ColourPreferenceEvidence, ColourPreferenceStatus } from "./constraint-evidence.server.ts";
import type { DuplicateEvidence, DuplicateOverlapLevel } from "./duplicate-evidence.server.ts";
import type { WardrobeUtilityEvidence, RedundancyStatus } from "./wardrobe-utility-evidence.server.ts";

// ── Fixture builders ─────────────────────────────────────────────────────────

function emptyColourFamilyResolution() {
  return { hueFamilies: [], isNeutral: false, passportFamilies: [], unknown: true };
}

function constraintEvidence(hasHardViolation = false): ConstraintEvidence {
  return { hasHardViolation, checks: [], deferredToResolvedPassport: false };
}

function colourPreferenceEvidence(status: ColourPreferenceStatus): ColourPreferenceEvidence {
  return {
    status,
    determinedBy: "customer-declared",
    avoidColours: ["orange"],
    avoidFamilies: emptyColourFamilyResolution(),
    declaredColours: ["Orange"],
    declaredFamilies: emptyColourFamilyResolution(),
    detectedColour: "orange",
    detectedFamilies: emptyColourFamilyResolution(),
    observationConfidence: "high",
    visionUsable: true,
    disagreement: false,
    reason: "declared colour matches an avoided colour",
  };
}

function duplicateEvidence(overlap: DuplicateOverlapLevel = "no-supported-overlap"): DuplicateEvidence {
  return { overlap, matches: [], sameSlotCandidateCount: 0 };
}

function wardrobeUtility(redundancyStatus: RedundancyStatus = "no-match"): WardrobeUtilityEvidence {
  return {
    redundancy: { status: redundancyStatus, reason: null, findingId: null, title: null, body: null, garmentIds: [] },
    gap: { status: "unavailable", reason: null, findingId: null, title: null, body: null, garmentIds: [], kind: null, backgroundFinding: null },
    utility: { status: "unavailable", complementCount: 0, complementItemIds: [] },
  };
}

// ── 1. avoided colour only + otherwise positive evidence → BUY ─────────────

describe("applyColourOnlySkipGuard() — avoided colour only + otherwise positive evidence", () => {
  it("overrides a model SKIP FOR NOW to BUY — the orange-trousers live-QA case (no hard violation, no redundancy)", () => {
    const result = applyColourOnlySkipGuard({
      verdict: "SKIP FOR NOW",
      constraintEvidence: constraintEvidence(false),
      colourPreferenceEvidence: colourPreferenceEvidence("conflict"),
      duplicateEvidence: duplicateEvidence("no-supported-overlap"),
      wardrobeUtility: wardrobeUtility("no-match"),
    });
    assert.deepEqual(result.overridden, true);
    assert.equal(result.verdict, "BUY");
    assert.ok(typeof result.overrideReason === "string" && result.overrideReason.length > 0);
  });

  it("overrides a model SKIP (not just SKIP FOR NOW) under the same colour-only conditions", () => {
    const result = applyColourOnlySkipGuard({
      verdict: "SKIP",
      constraintEvidence: constraintEvidence(false),
      colourPreferenceEvidence: colourPreferenceEvidence("conflict"),
      duplicateEvidence: duplicateEvidence(),
      wardrobeUtility: wardrobeUtility(),
    });
    assert.equal(result.overridden, true);
    assert.equal(result.verdict, "BUY");
  });

  it("never fires when there is no colour conflict at all (status clear)", () => {
    const result = applyColourOnlySkipGuard({
      verdict: "SKIP FOR NOW",
      constraintEvidence: constraintEvidence(false),
      colourPreferenceEvidence: colourPreferenceEvidence("clear"),
      duplicateEvidence: duplicateEvidence(),
      wardrobeUtility: wardrobeUtility(),
    });
    assert.equal(result.overridden, false);
  });

  it("never fires when colour evidence is unknown (unresolvable)", () => {
    const result = applyColourOnlySkipGuard({
      verdict: "SKIP FOR NOW",
      constraintEvidence: constraintEvidence(false),
      colourPreferenceEvidence: colourPreferenceEvidence("unknown"),
      duplicateEvidence: duplicateEvidence(),
      wardrobeUtility: wardrobeUtility(),
    });
    assert.equal(result.overridden, false);
  });

  it("never fires on a BUY verdict — nothing to override", () => {
    const result = applyColourOnlySkipGuard({
      verdict: "BUY",
      constraintEvidence: constraintEvidence(false),
      colourPreferenceEvidence: colourPreferenceEvidence("conflict"),
      duplicateEvidence: duplicateEvidence(),
      wardrobeUtility: wardrobeUtility(),
    });
    assert.equal(result.overridden, false);
  });
});

// ── 2. avoided colour + hard dressing violation → SKIP allowed ─────────────

describe("applyColourOnlySkipGuard() — avoided colour + hard dressing violation", () => {
  it("never fires when a hard constraint is violated — applyHardConstraintVeto owns that case", () => {
    const result = applyColourOnlySkipGuard({
      verdict: "SKIP",
      constraintEvidence: constraintEvidence(true),
      colourPreferenceEvidence: colourPreferenceEvidence("conflict"),
      duplicateEvidence: duplicateEvidence(),
      wardrobeUtility: wardrobeUtility(),
    });
    assert.equal(result.overridden, false);
  });
});

// ── 3. avoided colour + genuine independent substantive negative → SKIP allowed ──

describe("applyColourOnlySkipGuard() — avoided colour + a genuine independent substantive negative", () => {
  it("never fires when B4 strong closet overlap (redundancy) is present", () => {
    const result = applyColourOnlySkipGuard({
      verdict: "SKIP FOR NOW",
      constraintEvidence: constraintEvidence(false),
      colourPreferenceEvidence: colourPreferenceEvidence("conflict"),
      duplicateEvidence: duplicateEvidence("strong-overlap"),
      wardrobeUtility: wardrobeUtility("no-match"),
    });
    assert.equal(result.overridden, false);
  });

  it("never fires when Wardrobe Intelligence's own redundancy finding says 'already-enough'", () => {
    const result = applyColourOnlySkipGuard({
      verdict: "SKIP FOR NOW",
      constraintEvidence: constraintEvidence(false),
      colourPreferenceEvidence: colourPreferenceEvidence("conflict"),
      duplicateEvidence: duplicateEvidence("no-supported-overlap"),
      wardrobeUtility: wardrobeUtility("already-enough"),
    });
    assert.equal(result.overridden, false);
  });

  it("some-overlap (not strong) does not by itself block the override — only strong-overlap counts as substantive", () => {
    const result = applyColourOnlySkipGuard({
      verdict: "SKIP FOR NOW",
      constraintEvidence: constraintEvidence(false),
      colourPreferenceEvidence: colourPreferenceEvidence("conflict"),
      duplicateEvidence: duplicateEvidence("some-overlap"),
      wardrobeUtility: wardrobeUtility("no-match"),
    });
    assert.equal(result.overridden, true);
  });
});
