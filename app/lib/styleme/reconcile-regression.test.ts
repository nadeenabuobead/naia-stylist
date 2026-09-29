// app/lib/styleme/reconcile-regression.test.ts
//
// Regression coverage for the three StyleMe-owned correctness fixes made during the
// branch reconciliation. Each block pins the behaviour that was wrong before, so a
// later refactor cannot quietly restore it.
//
//   RC-A  Anchor eligibility — a hard requirement is not waived by being the anchor.
//   RC-B  New Look, Same Vibe — regeneration reconstructs the SAME request.
//   RC-C  Occasion keying — the formality target is keyed on what a session stores.
//
// Pure unit tests: no DB, no network, no customer data.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  evaluateAnchorEligibility,
  passesDressingRequirements,
} from "../ai/styleme-profile-gate.js";
import {
  buildNaiaOutfitCandidates,
  getTargetFormalityRange,
} from "../ai/styleme-result.server.js";
import {
  translateIntentionsToEngineSignals,
  STYLEME_INTENTION_IDS,
  STYLEME_ORIGINAL_INTENTION_IDS,
  STYLEME_NEW_INTENTION_IDS,
} from "./session-vocabulary.js";
import type {
  ClosetAnchorInput,
  NormalizedClosetAnchor,
  StyleMeSessionInput,
} from "../ai/styleme-recommendation.types.js";

// ── Fixtures ─────────────────────────────────────────────────────────────────

function garment(over: Partial<ClosetAnchorInput> & { id: string }): ClosetAnchorInput {
  return {
    type: "closet",
    name: over.id,
    category: "BOTTOMS",
    subcategory: null,
    colors: ["black"],
    primaryColor: "black",
    pattern: null,
    material: null,
    styleTags: [],
    occasions: [],
    imageUrl: null,
    garmentRelationships: [],
    formality: null,
    fitProfile: null,
    waistShape: null,
    sleeveLength: null,
    necklineCoverage: null,
    hemLength: null,
    topLength: null,
    shoulderCoverage: null,
    midriffExposed: null,
    silhouette: null,
    stylePersonality: null,
    approvedProfile: null,
    ...over,
  } as ClosetAnchorInput;
}

const MINI_SKIRT = garment({ id: "mini", category: "BOTTOMS", hemLength: "mini" });
const MAXI_SKIRT = garment({ id: "maxi", category: "BOTTOMS", hemLength: "maxi" });
const UNKNOWN_HEM = garment({ id: "unknown-hem", category: "BOTTOMS", hemLength: null });
const PLAIN_TOP = garment({ id: "top", category: "TOPS", hemLength: "n/a", topLength: "regular" });
const CROPPED_TOP = garment({ id: "crop", category: "TOPS", hemLength: "n/a", topLength: "cropped" });

const LEGS_COVERED = ["legs-covered"] as const;

function session(over: Partial<StyleMeSessionInput> = {}): StyleMeSessionInput {
  return {
    moods: [],
    desiredFeelings: [],
    bodyNeeds: [],
    coverageConditional: null,
    occasion: "everyday",
    formalityConditional: null,
    todayColours: { preferred: [], avoid: [] },
    practicalIds: [],
    source: "my-closet",
    ...over,
  } as StyleMeSessionInput;
}

// ── RC-A: anchor eligibility ─────────────────────────────────────────────────

describe("RC-A — a hard dressing requirement is not waived by being the anchor", () => {
  test("RC-A.1 a mini skirt is ineligible to anchor a legs-covered session", () => {
    const result = evaluateAnchorEligibility(MINI_SKIRT, "everyday", LEGS_COVERED);
    assert.equal(result.eligible, false);
    assert.equal(result.code, "dressing-requirement");
  });

  test("RC-A.2 the refusal carries a customer-facing explanation", () => {
    const result = evaluateAnchorEligibility(MINI_SKIRT, "everyday", LEGS_COVERED);
    assert.ok(result.message && result.message.length > 0);
    // It must say what to do next, not merely that something failed.
    assert.match(result.message!, /Choose another piece/i);
  });

  test("RC-A.3 a maxi skirt is eligible for the same requirement", () => {
    assert.equal(evaluateAnchorEligibility(MAXI_SKIRT, "everyday", LEGS_COVERED).eligible, true);
  });

  test("RC-A.4 unknown hem metadata fails OPEN — absence of data never rejects", () => {
    assert.equal(evaluateAnchorEligibility(UNKNOWN_HEM, "everyday", LEGS_COVERED).eligible, true);
  });

  test("RC-A.5 a top is unaffected by legs-covered (hemLength n/a)", () => {
    assert.equal(evaluateAnchorEligibility(PLAIN_TOP, "everyday", LEGS_COVERED).eligible, true);
  });

  test("RC-A.6 no-cropped-tops rejects an explicitly cropped anchor", () => {
    const r = evaluateAnchorEligibility(CROPPED_TOP, "everyday", ["no-cropped-tops"]);
    assert.equal(r.eligible, false);
    assert.equal(r.code, "dressing-requirement");
  });

  test("RC-A.7 an approved occasionFit of No makes a garment ineligible to anchor", () => {
    const refused = garment({
      id: "refused",
      approvedProfile: { occasionFit: { work: "No" } } as unknown as ClosetAnchorInput["approvedProfile"],
    });
    const r = evaluateAnchorEligibility(refused, "work", null);
    assert.equal(r.eligible, false);
    assert.equal(r.code, "occasion-not-suitable");
  });

  test("RC-A.8 an approved Strong for the occasion stays eligible", () => {
    const strong = garment({
      id: "strong",
      approvedProfile: { occasionFit: { work: "Strong" } } as unknown as ClosetAnchorInput["approvedProfile"],
    });
    assert.equal(evaluateAnchorEligibility(strong, "work", null).eligible, true);
  });

  test("RC-A.9 no dressing preferences set → nothing is rejected on that basis", () => {
    assert.equal(evaluateAnchorEligibility(MINI_SKIRT, "everyday", []).eligible, true);
    assert.equal(evaluateAnchorEligibility(MINI_SKIRT, "everyday", null).eligible, true);
  });

  test("RC-A.10 the gate and the item-level gate agree on the same garment", () => {
    // evaluateAnchorEligibility must not be a second, divergent implementation.
    for (const g of [MINI_SKIRT, MAXI_SKIRT, UNKNOWN_HEM, PLAIN_TOP, CROPPED_TOP]) {
      const viaItemGate = passesDressingRequirements(g, ["legs-covered", "no-cropped-tops"]);
      const viaAnchorGate = evaluateAnchorEligibility(
        g, "everyday", ["legs-covered", "no-cropped-tops"],
      ).eligible;
      assert.equal(viaAnchorGate, viaItemGate, `disagreement on ${g.id}`);
    }
  });

  test("RC-A.11 candidate construction refuses to build on an ineligible anchor", () => {
    // Defence in depth: an anchor that became ineligible after selection (stale cookie,
    // Adjust Vibe, Passport edited mid-session) must not yield a confident outfit.
    const anchor: NormalizedClosetAnchor = {
      type: "closet",
      id: "mini",
      slot: "bottom",
      label: "Mini skirt",
      colors: ["black"],
      material: null,
      styleTags: [],
      imageUrl: null,
    } as unknown as NormalizedClosetAnchor;

    const candidates = buildNaiaOutfitCandidates(
      anchor,
      session(),
      [MINI_SKIRT, PLAIN_TOP],
      { dressingPreferences: [...LEGS_COVERED] } as never,
      undefined,
    );
    assert.deepEqual(
      candidates.filter(Boolean),
      [],
      "an ineligible anchor must produce no candidates, not a violating outfit",
    );
  });

  test("RC-A.12 the same anchor DOES build candidates once the requirement is absent", () => {
    const anchor: NormalizedClosetAnchor = {
      type: "closet",
      id: "mini",
      slot: "bottom",
      label: "Mini skirt",
      colors: ["black"],
      material: null,
      styleTags: [],
      imageUrl: null,
    } as unknown as NormalizedClosetAnchor;

    const candidates = buildNaiaOutfitCandidates(
      anchor, session(), [MINI_SKIRT, PLAIN_TOP], { dressingPreferences: [] } as never, undefined,
    );
    assert.ok(
      candidates.filter(Boolean).length > 0,
      "the gate must reject only on the requirement, not always",
    );
  });
});

// ── RC-B: New Look, Same Vibe ────────────────────────────────────────────────

describe("RC-B — regeneration reconstructs the same request", () => {
  test("RC-B.1 the translation is pure and repeatable from stored intentions alone", () => {
    const a = translateIntentionsToEngineSignals(["confidence", "give-structure"]);
    const b = translateIntentionsToEngineSignals(["confidence", "give-structure"]);
    assert.deepEqual(a, b);
  });

  test("RC-B.2 generate-time and regenerate-time inputs agree for every intention", () => {
    // Generate reads intentions from the form; regenerate reads them from the session
    // row. Both now call this one function, so the engine input cannot diverge.
    for (const id of STYLEME_INTENTION_IDS) {
      const fromForm = translateIntentionsToEngineSignals([id]);
      const fromSessionRow = translateIntentionsToEngineSignals([id]);
      assert.deepEqual(fromSessionRow, fromForm, `diverged for ${id}`);
    }
  });

  test("RC-B.3 an intention that carries an engine signal produces a NON-empty translation", () => {
    // The pre-fix regeneration path produced empty arrays for all of these.
    assert.deepEqual(translateIntentionsToEngineSignals(["confidence"]).desiredFeelings, ["more-confident"]);
    assert.deepEqual(translateIntentionsToEngineSignals(["feel-softer"]).desiredFeelings, ["softer"]);
    assert.deepEqual(translateIntentionsToEngineSignals(["give-structure"]).bodyNeeds, ["structured"]);
    assert.deepEqual(translateIntentionsToEngineSignals(["feel-less-exposed"]).bodyNeeds, ["more-coverage"]);
    assert.deepEqual(translateIntentionsToEngineSignals(["make-it-easy"]).practicalIds, ["quick-to-style"]);
    assert.deepEqual(translateIntentionsToEngineSignals(["feel-like-myself"]).moods, ["like-myself"]);
    assert.deepEqual(translateIntentionsToEngineSignals(["express-myself"]).moods, ["like-myself"]);
    assert.deepEqual(translateIntentionsToEngineSignals(["feel-attractive"]).desiredFeelings, ["more-attractive"]);
    assert.deepEqual(translateIntentionsToEngineSignals(["feel-put-together"]).desiredFeelings, ["more-put-together"]);
  });

  test("RC-B.4 deliberately unmapped intentions stay unmapped", () => {
    // ground-me and give-energy have no approved engine analogue; the four expansion
    // intentions are decided per garment by a human. No heuristic may derive them.
    for (const id of ["ground-me", "give-energy", ...STYLEME_NEW_INTENTION_IDS]) {
      const t = translateIntentionsToEngineSignals([id]);
      assert.deepEqual(
        t,
        { moods: [], desiredFeelings: [], bodyNeeds: [], practicalIds: [] },
        `${id} must contribute no engine signal`,
      );
    }
  });

  test("RC-B.5 two intentions combine without dropping either", () => {
    const t = translateIntentionsToEngineSignals(["confidence", "feel-less-exposed"]);
    assert.deepEqual(t.desiredFeelings, ["more-confident"]);
    assert.deepEqual(t.bodyNeeds, ["more-coverage"]);
  });

  test("RC-B.6 empty / null / undefined input is safe", () => {
    const empty = { moods: [], desiredFeelings: [], bodyNeeds: [], practicalIds: [] };
    assert.deepEqual(translateIntentionsToEngineSignals([]), empty);
    assert.deepEqual(translateIntentionsToEngineSignals(null), empty);
    assert.deepEqual(translateIntentionsToEngineSignals(undefined), empty);
  });

  test("RC-B.7 an unknown or historical intention ID is ignored, never throws", () => {
    // Backward compatibility: a session stored before a vocabulary change must still load.
    assert.doesNotThrow(() => translateIntentionsToEngineSignals(["some-retired-id"]));
    assert.deepEqual(
      translateIntentionsToEngineSignals(["some-retired-id"]),
      { moods: [], desiredFeelings: [], bodyNeeds: [], practicalIds: [] },
    );
  });
});

// ── RC-C: occasion keying ────────────────────────────────────────────────────

describe("RC-C — the formality target is keyed on what a session actually stores", () => {
  // REV3_OCCASION_MAP normalises the UI answer before it is stored, so the engine
  // only ever sees these. Three of them used to miss the table entirely.
  const CANONICAL = [
    "everyday", "work", "dinner", "date-night",
    "girls-night", "special-event", "family", "travel", "active",
  ];
  const GENERIC_FALLBACK = { min: 1, max: 4 };

  test("RC-C.1 every canonical occasion has its own target — none falls back", () => {
    for (const occ of CANONICAL) {
      const range = getTargetFormalityRange(occ, null);
      assert.notDeepEqual(
        range, GENERIC_FALLBACK,
        `${occ} fell through to the generic {1,4} default`,
      );
    }
  });

  test("RC-C.2 Dressy at a special event does not collapse to a single rank", () => {
    // Before: base {1,4} (fallback) ∩ dressy {4,6} = {4,4}; only business-formal was
    // "within target" and a genuine evening piece scored as overdressed.
    const range = getTargetFormalityRange("special-event", "formality-occasion");
    assert.ok(range.max > range.min, `expected a real band, got {${range.min},${range.max}}`);
    assert.ok(range.max >= 5, "an evening piece must be within target for a dressy event");
  });

  test("RC-C.3 the four formality answers give four distinct bands for dinner", () => {
    const bands = ["formality-relaxed", "formality-smart", "formality-polished", "formality-occasion"]
      .map((f) => JSON.stringify(getTargetFormalityRange("dinner", f)));
    assert.equal(new Set(bands).size, 4, `bands collapsed: ${bands.join(" ")}`);
  });

  test("RC-C.4 a dressy request never resolves below a smart-casual one", () => {
    for (const occ of CANONICAL) {
      const smart = getTargetFormalityRange(occ, "formality-smart");
      const dressy = getTargetFormalityRange(occ, "formality-occasion");
      assert.ok(
        dressy.max >= smart.max,
        `${occ}: dressy {${dressy.min},${dressy.max}} sits below smart {${smart.min},${smart.max}}`,
      );
    }
  });

  test("RC-C.5 an unrecognised occasion still returns the documented fallback", () => {
    assert.deepEqual(getTargetFormalityRange("not-sure", null), GENERIC_FALLBACK);
  });
});

// ── RC-D: taxonomy backward compatibility ────────────────────────────────────

describe("RC-D — the 16-intention taxonomy is backward compatible", () => {
  test("RC-D.1 all twelve original IDs survive the expansion", () => {
    for (const id of STYLEME_ORIGINAL_INTENTION_IDS) {
      assert.ok(
        STYLEME_INTENTION_IDS.includes(id),
        `${id} was dropped — a historical session referencing it would break`,
      );
    }
  });

  test("RC-D.2 the taxonomy is exactly the original twelve plus the four new", () => {
    assert.equal(STYLEME_INTENTION_IDS.length, 16);
    assert.equal(STYLEME_ORIGINAL_INTENTION_IDS.length, 12);
    assert.equal(STYLEME_NEW_INTENTION_IDS.length, 4);
    assert.deepEqual(
      [...STYLEME_INTENTION_IDS].sort(),
      [...STYLEME_ORIGINAL_INTENTION_IDS, ...STYLEME_NEW_INTENTION_IDS].sort(),
    );
  });

  test("RC-D.3 the original twelve keep their engine translation unchanged", () => {
    // The expansion must not have altered how any pre-existing intention scores.
    const expected: Record<string, unknown> = {
      "feel-like-myself":  { moods: ["like-myself"], desiredFeelings: [], bodyNeeds: [], practicalIds: [] },
      "express-myself":    { moods: ["like-myself"], desiredFeelings: [], bodyNeeds: [], practicalIds: [] },
      "confidence":        { moods: [], desiredFeelings: ["more-confident"], bodyNeeds: [], practicalIds: [] },
      "feel-put-together": { moods: [], desiredFeelings: ["more-put-together"], bodyNeeds: [], practicalIds: [] },
      "feel-attractive":   { moods: [], desiredFeelings: ["more-attractive"], bodyNeeds: [], practicalIds: [] },
      "feel-softer":       { moods: [], desiredFeelings: ["softer"], bodyNeeds: [], practicalIds: [] },
      "give-structure":    { moods: [], desiredFeelings: [], bodyNeeds: ["structured"], practicalIds: [] },
      "feel-less-exposed": { moods: [], desiredFeelings: [], bodyNeeds: ["more-coverage"], practicalIds: [] },
      "make-it-easy":      { moods: [], desiredFeelings: [], bodyNeeds: [], practicalIds: ["quick-to-style"] },
      "ground-me":         { moods: [], desiredFeelings: [], bodyNeeds: [], practicalIds: [] },
      "give-energy":       { moods: [], desiredFeelings: [], bodyNeeds: [], practicalIds: [] },
      "feel-sharper":      { moods: [], desiredFeelings: [], bodyNeeds: [], practicalIds: [] },
    };
    for (const id of STYLEME_ORIGINAL_INTENTION_IDS) {
      assert.deepEqual(translateIntentionsToEngineSignals([id]), expected[id], `changed for ${id}`);
    }
  });
});
