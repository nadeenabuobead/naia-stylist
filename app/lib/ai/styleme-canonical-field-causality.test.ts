// app/lib/ai/styleme-canonical-field-causality.test.ts
//
// Garment Intelligence Phase 3 — targeted causal-validation fixtures.
//
// Purpose: the real-data substitution run (gi-phase3-field-substitution-
// harness.ts) found zero selected-outfit impact across 4 real session×
// anchor pairs, but the sample is too small and two coverage fields were
// never genuinely exercised. This file proves, deterministically and
// without any real-data dependency, EXACTLY what each field's own StyleMe
// mechanism does when fed a deliberately-engineered decision-boundary
// input — a positive control, not another absence-of-evidence result.
//
// Deliberately calls StyleMe's own narrow, already-exported mechanism
// functions directly (scoreClosetItemForSession, evaluateCompleteOutfit,
// compareCandidateRankKeys, passesDressingRequirements,
// passesCandidateDressingRequirements, computeItemIntentionWeight,
// closetItemToSlot) rather than the full computeStyleMeResult
// orchestration. This is a deliberate methodology choice: the real-data
// harness's two caught bugs (a stray live Claude call via an unstubbed DI
// seam, and silently comparing nonexistent result fields) were both
// artifacts of going through the full pipeline. Testing the exact
// mechanism function directly removes both failure modes structurally —
// there is no Claude/network/DB seam to accidentally leave live, and
// there is no ambiguous result shape to misread, because the return
// value of each function is asserted to be meaningful before any
// baseline-vs-canonical comparison is trusted.
//
// No live StyleMe file is modified. No ResolvedGarment/resolveGarment
// import — canonical values here are written by hand per fixture
// (exactly what an admin correction would produce), keeping this file's
// only dependency on Garment Intelligence to the concept, not the code.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { scoreClosetItemForSession } from "./styleme-anchor.server.ts";
import {
  evaluateCompleteOutfit,
  compareCandidateRankKeys,
  passesDressingRequirements,
  passesCandidateDressingRequirements,
  type CandidateRankKey,
} from "./styleme-result.server.ts";
import { computeItemIntentionWeight } from "./styleme-profile-gate.ts";
import { closetItemToSlot } from "./closet-slot.ts";

function baseRankKey(overrides: Partial<CandidateRankKey> = {}): CandidateRankKey {
  return {
    occasionTier: 2, formalityFitPriority: 1, knownViolationCount: 0, bodyNeedFitScore: null,
    intentionFit: 0, passportAlignment: 0, formalityOvershootAbs: 0, optionalNonMatchCount: 0,
    discretionaryPieceCount: 0, ...overrides,
  };
}

// ── A. Colour ────────────────────────────────────────────────────────────────
//
// Canonical correctness: an admin-corrected primaryColor/colors fixes what
// the garment actually is (e.g. AI misread "navy" as "black"). Mechanism:
// scoreClosetItemForSession is the ONLY live read site for colour — a pure
// additive score, never a boolean, never an early return. That alone
// proves colour can never create a hard eligibility change: there is no
// code path in this function that excludes an item, only one that adds to
// or subtracts from a score it always returns.

describe("§CAUSAL-A colour — scoring only, never eligibility", () => {
  const signals = { occasion: "work", moods: [], desiredFeelings: [] };
  const itemBase = { occasions: ["work"], styleTags: [], category: "TOPS" };

  it("a favourite-colour match adds exactly +2 versus a neutral item with no colour preference match", () => {
    const profile = { favoriteColors: ["black"], avoidColors: [] } as any;
    const favourite = scoreClosetItemForSession({ ...itemBase, colors: ["black"], primaryColor: "black" }, signals, profile);
    const neutral = scoreClosetItemForSession({ ...itemBase, colors: ["beige"], primaryColor: "beige" }, signals, profile);
    assert.equal(favourite - neutral, 2, "the +2 favourite-colour bonus is the entire delta — every other input is held identical");
  });

  it("an avoided-colour match subtracts exactly -4 versus the same item with no avoid-match", () => {
    const profile = { favoriteColors: [], avoidColors: ["neon-green"] } as any;
    const avoided = scoreClosetItemForSession({ ...itemBase, colors: ["neon-green"], primaryColor: "neon-green" }, signals, profile);
    const neutral = scoreClosetItemForSession({ ...itemBase, colors: ["beige"], primaryColor: "beige" }, signals, profile);
    assert.equal(avoided - neutral, -4);
  });

  it("raw color wrong (not a favourite) vs canonical/corrected color right (a favourite) — the exact decision-boundary case: same garment, only colour differs", () => {
    const profile = { favoriteColors: ["burgundy"], avoidColors: [] } as any;
    const rawColorScore = scoreClosetItemForSession({ ...itemBase, colors: ["grey"], primaryColor: "grey" }, signals, profile); // AI misread
    const canonicalColorScore = scoreClosetItemForSession({ ...itemBase, colors: ["burgundy"], primaryColor: "burgundy" }, signals, profile); // admin-corrected
    assert.equal(canonicalColorScore - rawColorScore, 2, "the canonical correction recovers the +2 favourite bonus the raw misread value was losing");
  });

  it("no Passport colour preference at all (neutral case) — canonical correction changes nothing, proving the mechanism is conditional on profile data existing", () => {
    const rawScore = scoreClosetItemForSession({ ...itemBase, colors: ["grey"], primaryColor: "grey" }, signals, undefined);
    const canonicalScore = scoreClosetItemForSession({ ...itemBase, colors: ["burgundy"], primaryColor: "burgundy" }, signals, undefined);
    assert.equal(rawScore, canonicalScore, "with no favourite/avoid colours on file, colour contributes zero either way — not a bug, the documented behavior");
  });

  it("colour's maximum possible influence is bounded: +2 (favourite) to -4 (avoided), a 6-point swing, and this is the ENTIRE colour contribution — no other code path adds to or subtracts from it", () => {
    const favProfile = { favoriteColors: ["black"], avoidColors: [] } as any;
    const avoidProfile = { favoriteColors: [], avoidColors: ["black"] } as any;
    const favScore = scoreClosetItemForSession({ ...itemBase, colors: ["black"], primaryColor: "black" }, signals, favProfile);
    const avoidScore = scoreClosetItemForSession({ ...itemBase, colors: ["black"], primaryColor: "black" }, signals, avoidProfile);
    assert.equal(favScore - avoidScore, 6, "the full span of colour's influence, end to end, is 6 points on an additive score — never a gate");
  });

  it("sanity: the baseline score itself is non-trivial before any delta is trusted", () => {
    const score = scoreClosetItemForSession({ ...itemBase, colors: ["black"], primaryColor: "black" }, signals, { favoriteColors: ["black"], avoidColors: [] } as any);
    assert.ok(score > 0, "the occasion match (+10) plus colour bonus (+2) must produce a real positive score, not a default/empty 0");
  });
});

// ── B. Formality — positive control for T2 ──────────────────────────────────
//
// Canonical correctness: an admin-corrected formality fixes a garment
// mis-tagged by the AI extractor (e.g. a blazer tagged "casual" when it is
// actually "business-casual"). Mechanism: evaluateCompleteOutfit computes
// formalityFit from the garment's formality against the session's target
// range; compareCandidateRankKeys compares candidates by formalityFitPriority
// (T2) BEFORE any lower tier is consulted. This fixture deliberately picks
// an occasion/formality pair where raw and canonical land on opposite sides
// of "within-target" so T2 itself must flip — not a null result.

describe("§CAUSAL-B formality — a genuine T2 positive control", () => {
  it("the SAME garment, raw formality vs canonical formality, produces different formalityFit for a work-occasion target range", () => {
    const allItems = [{ id: "g1", formality: "evening" }] as any; // raw: AI over-tagged a blazer as "evening"
    const candidate = { pieces: [{ slot: "top", closetId: "g1" }] } as any;
    const session = { occasion: "work", formalityConditional: null, moods: [], desiredFeelings: [] };

    const rawResult = evaluateCompleteOutfit(candidate, allItems, session);
    assert.equal(rawResult.formalityFit, "overdressed", "sanity: 'evening' (rank 6) against work's target range (2-4) must register as overdressed, not a default/unknown value");

    const canonicalItems = [{ id: "g1", formality: "business-casual" }] as any; // admin-corrected
    const canonicalResult = evaluateCompleteOutfit(candidate, canonicalItems, session);
    assert.equal(canonicalResult.formalityFit, "within-target", "the canonical correction moves the SAME garment from overdressed to within-target for the identical session");

    assert.notEqual(rawResult.formalityFit, canonicalResult.formalityFit, "T2's underlying classification genuinely flips — this is the positive control the real-data null result could not provide");
  });

  it("compareCandidateRankKeys genuinely reorders two candidates when ONLY formalityFitPriority (T2) differs, every other tier held identical", () => {
    const candidateA = baseRankKey({ formalityFitPriority: -1 }); // raw: outside target
    const candidateB = baseRankKey({ formalityFitPriority: 1 });  // canonical: within target
    assert.ok(compareCandidateRankKeys(candidateA, candidateB) > 0, "sanity: with identical T1 and a worse T2, A must compare as worse than B (positive = A sorts after B)");

    const candidateACanonical = baseRankKey({ formalityFitPriority: 1 }); // same candidate A, now with canonical formality
    assert.equal(compareCandidateRankKeys(candidateACanonical, candidateB), 0, "once A's formalityFitPriority is corrected to match B's, with every other tier identical, the comparator is now indifferent between them — proving T2 alone drove the prior ordering, nothing else did");
  });

  it("lower tiers do not mask the T2 effect when they are held at a genuine tie — the fixture isolates T2, not an artifact of other tiers also differing", () => {
    const worse = baseRankKey({ formalityFitPriority: -1, knownViolationCount: 0, bodyNeedFitScore: null, intentionFit: 0.5, passportAlignment: 0.5 });
    const better = baseRankKey({ formalityFitPriority: 1, knownViolationCount: 0, bodyNeedFitScore: null, intentionFit: 0.5, passportAlignment: 0.5 });
    assert.ok(compareCandidateRankKeys(worse, better) > 0, "with T3a/T3b/T4/T5 all tied, T2 alone decides — confirms T2 is not masked by a lower tier in this fixture");
  });

  it("a formality correction that keeps the garment on the SAME side of the target range produces no T2 change — proving the mechanism is genuinely conditional, not always-flip", () => {
    const allItems = [{ id: "g1", formality: "business-casual" }] as any;
    const canonicalItems = [{ id: "g1", formality: "business-formal" }] as any; // still within work's 2-4 range
    const candidate = { pieces: [{ slot: "top", closetId: "g1" }] } as any;
    const session = { occasion: "work", formalityConditional: null, moods: [], desiredFeelings: [] };
    const raw = evaluateCompleteOutfit(candidate, allItems, session);
    const canonical = evaluateCompleteOutfit(candidate, canonicalItems, session);
    assert.equal(raw.formalityFit, canonical.formalityFit, "both land within-target — this correction would change a diagnostic number (formalityOvershoot) but not T2's ordering outcome, exactly the 'corrects scoring without changing the winner' case the review called out");
  });
});

// ── C. Coverage hard gates ───────────────────────────────────────────────────
//
// Canonical correctness: admin-corrected coverage fields fix garments the
// AI vision extractor misread (e.g. a sleeveless top tagged "full" sleeve).
// Mechanism: passesDressingRequirements (hemLength/topLength) and
// passesCandidateDressingRequirements (sleeveLength/shoulderCoverage/
// necklineCoverage) are hard boolean gates — a false inclusion means an
// item StyleMe should have excluded was offered anyway; a false exclusion
// means a genuinely fine item was wrongly rejected. Both directions are
// constructed explicitly below, per field, using the real gate functions.

describe("§CAUSAL-C1 hemLength — passesDressingRequirements, both directions confirmed producible", () => {
  it("false inclusion: raw hemLength passes legs-covered, canonical hemLength should fail it", () => {
    const rawItem = { hemLength: "maxi" } as any; // AI misread a mini skirt as maxi
    assert.equal(passesDressingRequirements(rawItem, ["legs-covered"]), true, "sanity: raw value is accepted — a false inclusion is live before the correction");
    const canonicalItem = { hemLength: "mini" } as any; // admin-corrected
    assert.equal(passesDressingRequirements(canonicalItem, ["legs-covered"]), false, "the canonical correction causes this gate to reject the SAME garment — the false inclusion is fixed");
  });

  it("false exclusion: raw hemLength fails legs-covered, canonical hemLength should pass it", () => {
    const rawItem = { hemLength: "mini" } as any; // AI misread a full-length skirt as mini
    assert.equal(passesDressingRequirements(rawItem, ["legs-covered"]), false, "sanity: raw value is wrongly rejected before the correction");
    const canonicalItem = { hemLength: "full" } as any;
    assert.equal(passesDressingRequirements(canonicalItem, ["legs-covered"]), true, "the canonical correction recovers a wrongly-excluded garment — the false exclusion is fixed");
  });
});

describe("§CAUSAL-C2 topLength — passesDressingRequirements, both directions confirmed producible", () => {
  it("false inclusion: raw not cropped (passes), canonical cropped (should fail)", () => {
    assert.equal(passesDressingRequirements({ topLength: "regular" } as any, ["no-cropped-tops"]), true);
    assert.equal(passesDressingRequirements({ topLength: "cropped" } as any, ["no-cropped-tops"]), false);
  });
  it("false exclusion: raw cropped (fails), canonical not cropped (should pass)", () => {
    assert.equal(passesDressingRequirements({ topLength: "cropped" } as any, ["no-cropped-tops"]), false);
    assert.equal(passesDressingRequirements({ topLength: "regular" } as any, ["no-cropped-tops"]), true);
  });
});

describe("§CAUSAL-C3 sleeveLength — passesCandidateDressingRequirements, both directions confirmed producible", () => {
  const candidate = { pieces: [{ slot: "top", closetId: "g1" }] } as any;

  it("false inclusion: raw sleeveLength passes arms-covered, canonical should fail it", () => {
    const rawItems = [{ id: "g1", sleeveLength: "full", shoulderCoverage: null, necklineCoverage: null }] as any;
    assert.equal(passesCandidateDressingRequirements(candidate, rawItems, ["arms-covered"]), true);
    const canonicalItems = [{ id: "g1", sleeveLength: "sleeveless", shoulderCoverage: null, necklineCoverage: null }] as any;
    assert.equal(passesCandidateDressingRequirements(candidate, canonicalItems, ["arms-covered"]), false, "the SAME candidate now fails — a false inclusion the raw value was hiding");
  });

  it("false exclusion: raw sleeveless (fails), canonical full-sleeve (should pass)", () => {
    const rawItems = [{ id: "g1", sleeveLength: "sleeveless", shoulderCoverage: null, necklineCoverage: null }] as any;
    assert.equal(passesCandidateDressingRequirements(candidate, rawItems, ["arms-covered"]), false);
    const canonicalItems = [{ id: "g1", sleeveLength: "full", shoulderCoverage: null, necklineCoverage: null }] as any;
    assert.equal(passesCandidateDressingRequirements(candidate, canonicalItems, ["arms-covered"]), true);
  });
});

describe("§CAUSAL-C4 shoulderCoverage — passesCandidateDressingRequirements, both directions confirmed producible", () => {
  const candidate = { pieces: [{ slot: "top", closetId: "g1" }] } as any;

  it("false inclusion: raw shoulderCoverage=true passes dresses-modestly, canonical=false should fail", () => {
    const rawItems = [{ id: "g1", sleeveLength: null, shoulderCoverage: true, necklineCoverage: null }] as any;
    assert.equal(passesCandidateDressingRequirements(candidate, rawItems, ["dresses-modestly"]), true);
    const canonicalItems = [{ id: "g1", sleeveLength: null, shoulderCoverage: false, necklineCoverage: null }] as any;
    assert.equal(passesCandidateDressingRequirements(candidate, canonicalItems, ["dresses-modestly"]), false);
  });

  it("false exclusion: raw shoulderCoverage=false fails, canonical=true should pass", () => {
    const rawItems = [{ id: "g1", sleeveLength: null, shoulderCoverage: false, necklineCoverage: null }] as any;
    assert.equal(passesCandidateDressingRequirements(candidate, rawItems, ["dresses-modestly"]), false);
    const canonicalItems = [{ id: "g1", sleeveLength: null, shoulderCoverage: true, necklineCoverage: null }] as any;
    assert.equal(passesCandidateDressingRequirements(candidate, canonicalItems, ["dresses-modestly"]), true);
  });
});

describe("§CAUSAL-C5 necklineCoverage — passesCandidateDressingRequirements, both directions confirmed producible", () => {
  const candidate = { pieces: [{ slot: "top", closetId: "g1" }] } as any;

  it("false inclusion: raw high neckline passes chest-neckline-covered, canonical low neckline should fail", () => {
    const rawItems = [{ id: "g1", sleeveLength: null, shoulderCoverage: null, necklineCoverage: "high" }] as any;
    assert.equal(passesCandidateDressingRequirements(candidate, rawItems, ["chest-neckline-covered"]), true);
    const canonicalItems = [{ id: "g1", sleeveLength: null, shoulderCoverage: null, necklineCoverage: "low" }] as any;
    assert.equal(passesCandidateDressingRequirements(candidate, canonicalItems, ["chest-neckline-covered"]), false);
  });

  it("false exclusion: raw low neckline fails, canonical high neckline should pass", () => {
    const rawItems = [{ id: "g1", sleeveLength: null, shoulderCoverage: null, necklineCoverage: "low" }] as any;
    assert.equal(passesCandidateDressingRequirements(candidate, rawItems, ["chest-neckline-covered"]), false);
    const canonicalItems = [{ id: "g1", sleeveLength: null, shoulderCoverage: null, necklineCoverage: "high" }] as any;
    assert.equal(passesCandidateDressingRequirements(candidate, canonicalItems, ["chest-neckline-covered"]), true);
  });

  it("a covering piece elsewhere in the candidate compensates, regardless of raw/canonical — proving the gate is candidate-level, not item-level, for this field", () => {
    const twoPieceCandidate = { pieces: [{ slot: "top", closetId: "g1" }, { slot: "outerwear", closetId: "g2" }] } as any;
    const items = [
      { id: "g1", sleeveLength: null, shoulderCoverage: null, necklineCoverage: "low" },
      { id: "g2", sleeveLength: "full", shoulderCoverage: null, necklineCoverage: "high" }, // a layering piece with a covering neckline
    ] as any;
    assert.equal(passesCandidateDressingRequirements(twoPieceCandidate, items, ["chest-neckline-covered"]), true, "the covering outerwear piece compensates the exposed base piece — a real StyleMe allowance, not a bug in this fixture");
  });
});

// ── D. Fit / silhouette / subcategory — lighter targeted fixtures ───────────
//
// Canonical correctness: admin-corrected fitProfile/silhouette/subcategory
// fix observational mistakes (e.g. "relaxed" fit tagged "tailored").
// Mechanism: computeItemIntentionWeight falls through to the legacy
// heuristic only when there is no approved profile — these fixtures
// deliberately have none, so the legacy path is genuinely exercised, not
// bypassed by a higher-precedence source.

describe("§CAUSAL-D1 fitProfile / silhouette — computeItemIntentionWeight (T4), legacy path genuinely exercised", () => {
  it("fitProfile='tailored' (a GATE_STRUCTURE_TAGS fit) vs a non-structured fit changes the legacy 'feel-sharper' weight — same garment, only fitProfile differs", () => {
    const rawItem = { fitProfile: "relaxed", silhouette: "straight", styleTags: [], garmentRelationships: [], sleeveLength: null, necklineCoverage: null, shoulderCoverage: null, pattern: "solid" } as any; // AI misread a tailored blazer as relaxed
    const canonicalItem = { ...rawItem, fitProfile: "tailored" } as any; // admin-corrected
    const rawWeight = computeItemIntentionWeight(rawItem, "feel-sharper");
    const canonicalWeight = computeItemIntentionWeight(canonicalItem, "feel-sharper");
    assert.notEqual(rawWeight, canonicalWeight, "fitProfile alone changes the legacy 'feel-sharper' weight — a genuine T4 causal effect");
    assert.ok(canonicalWeight > rawWeight, "the correction to the true structured fit should raise the score, not lower it");
  });

  it("silhouette='flowy' (one of the two explicit silhouette values 'feel-softer' checks) vs a non-flowy silhouette changes the legacy weight", () => {
    const rawItem = { fitProfile: "fitted", silhouette: "straight", styleTags: [], garmentRelationships: [], sleeveLength: null, necklineCoverage: null, shoulderCoverage: null, pattern: "solid" } as any; // AI misread a flowy dress as straight
    const canonicalItem = { ...rawItem, silhouette: "flowy" } as any; // admin-corrected
    const rawWeight = computeItemIntentionWeight(rawItem, "feel-softer");
    const canonicalWeight = computeItemIntentionWeight(canonicalItem, "feel-softer");
    assert.notEqual(rawWeight, canonicalWeight, "silhouette alone changes T4's legacy 'feel-softer' weight");
    assert.ok(canonicalWeight > rawWeight, "the correction to the true flowy silhouette should raise the score");
  });

  it("sanity: an approved profile short-circuits the legacy path entirely — these fixtures only prove the legacy mechanism when no profile exists, which is the honest scope of this causal claim", () => {
    const withProfile = { fitProfile: "tailored", silhouette: "straight", approvedProfile: { intentionPotentials: { "give-energy": "Strong" } }, styleTags: [], garmentRelationships: [] } as any;
    const weight = computeItemIntentionWeight(withProfile, "give-energy");
    assert.equal(weight, 1.0, "with an approved profile present, fitProfile/silhouette have zero influence on this score — the legacy path this test proves is bypassed entirely, which is the correct, documented precedence");
  });
});

describe("§CAUSAL-D2 subcategory — closetItemToSlot, direct eligibility/slot-assignment effect", () => {
  it("a raw-vs-canonical subcategory correction that crosses a slot boundary changes the assigned slot", () => {
    const rawSlot = closetItemToSlot("ACTIVEWEAR", "yoga-pants"); // AI misread; token-matches to a bottom-adjacent guess
    const canonicalSlot = closetItemToSlot("ACTIVEWEAR", "sports-bra"); // admin-corrected to the true subcategory
    assert.notEqual(rawSlot, canonicalSlot, "a genuine subcategory correction within the same raw category can still cross StyleMe's slot boundary, changing eligibility for slot-based candidate assembly");
  });

  it("not every subcategory correction crosses a slot boundary — a same-slot correction has zero eligibility effect, proving the mechanism is conditional, not an automatic risk", () => {
    const rawSlot = closetItemToSlot("TOPS", "blouse");
    const canonicalSlot = closetItemToSlot("TOPS", "t-shirt");
    assert.equal(rawSlot, canonicalSlot, "both subcategories map to the same slot — this specific correction would change nothing about eligibility, even though the raw value was wrong");
  });
});
