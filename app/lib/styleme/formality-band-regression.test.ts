// app/lib/styleme/formality-band-regression.test.ts
//
// RC-C — getTargetFormalityRange produced impossible and colliding bands, and
// formality miss severity was ranked below intention.
//
// WHAT THE QA LOGS SHOWED
//
//   Night out + Dressy    band 4-6   gown + stiletto + blazer + tote + hoops
//   Special event + Dressy band 4-6  gown + stiletto + blazer + tote + hoops
//
//   Two different occasions, one band, one identical outfit. girls-night was
//   {2,6} — the entire scale — so intersecting with Dressy {4,6} gave the same
//   answer as special-event {3,6}.
//
//   dinner + Relaxed      band 2-2
//     cand A  overdressed  rank 3.729   <- SELECTED
//     cand B  overdressed  rank 2.918
//     cand E  underdressed rank 1.837
//
//   Every candidate outside the band, so T2 tied at -1 for the whole pool and the
//   decision fell through to T4. A overshot by 1.729 and B by 0.918; the worse
//   miss won because intention was consulted before severity.
//
//   And four reachable combinations intersected to min > max — date-night + Dressy
//   to 4-3, family + Dressy to 4-2 — bands no formality rank can satisfy, which
//   switched T2 off entirely for those sessions.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { getTargetFormalityRange, compareCandidateRankKeys } from "../ai/styleme-result.server.js";
import { autoSelectClosetAnchor } from "../ai/styleme-anchor.server.js";

const FORMALITIES = ["formality-relaxed", "formality-smart", "formality-polished", "formality-occasion"];
// Exactly the occasions for which the formality question is asked.
const ASKED = ["work", "dinner", "date-night", "girls-night", "family", "special-event", "not-sure"];
const NOT_ASKED = ["everyday", "travel", "active"];

// ── FB-A: no band can be impossible ──────────────────────────────────────────

describe("FB-A — every reachable band is non-empty", () => {
  test("FB-A.1 no occasion + formality pair yields min > max", () => {
    for (const o of [...ASKED, ...NOT_ASKED]) {
      for (const f of [...FORMALITIES, null]) {
        const b = getTargetFormalityRange(o, f);
        assert.ok(b.min <= b.max, `${o} + ${f} gave ${b.min}-${b.max}`);
      }
    }
  });

  test("FB-A.2 the four bands that were impossible are now valid", () => {
    assert.deepEqual(getTargetFormalityRange("date-night", "formality-occasion"), { min: 4, max: 4 });
    assert.deepEqual(getTargetFormalityRange("family", "formality-polished"), { min: 3, max: 3 });
    assert.deepEqual(getTargetFormalityRange("family", "formality-occasion"), { min: 3, max: 4 });
    assert.deepEqual(getTargetFormalityRange("special-event", "formality-relaxed"), { min: 2, max: 3 });
  });

  test("FB-A.3 an unknown occasion still falls back to the generic band", () => {
    assert.deepEqual(getTargetFormalityRange("not-a-real-occasion", null), { min: 1, max: 4 });
  });

  test("FB-A.4 an unknown formality answer falls back to the occasion envelope", () => {
    assert.deepEqual(getTargetFormalityRange("dinner", "formality-nonsense"), { min: 2, max: 5 });
  });
});

// ── FB-B: the occasion calibrates the request, it does not neutralise it ─────

describe("FB-B — asking to dress up puts the occasion ceiling outside the band", () => {
  test("FB-B.1 family + Dressy excludes smart-casual", () => {
    const b = getTargetFormalityRange("family", "formality-occasion");
    assert.ok(b.min > 2, "smart-casual must not be within-target when she asked for Dressy");
  });

  test("FB-B.2 family + Polished excludes smart-casual", () => {
    assert.ok(getTargetFormalityRange("family", "formality-polished").min > 2);
  });

  test("FB-B.3 dressing DOWN keeps the occasion floor inside the band (deliberate asymmetry)", () => {
    // A special event has a real external floor in a way a family gathering has no
    // real ceiling, so business-casual stays within-target for a relaxed special event.
    const b = getTargetFormalityRange("special-event", "formality-relaxed");
    assert.equal(b.max, 3);
  });

  test("FB-B.4 each occasion's ceiling rises monotonically with the requested register", () => {
    for (const o of ASKED) {
      let prev = 0;
      for (const f of FORMALITIES) {
        const b = getTargetFormalityRange(o, f);
        assert.ok(b.max >= prev, `${o}: ${f} ceiling ${b.max} below the previous register's ${prev}`);
        prev = b.max;
      }
    }
  });
});

// ── FB-C: Night out is not a gala ────────────────────────────────────────────

describe("FB-C — girls-night and special-event are differentiated under Dressy", () => {
  test("FB-C.1 Night out + Dressy is less formal than Special event + Dressy", () => {
    const night = getTargetFormalityRange("girls-night", "formality-occasion");
    const event = getTargetFormalityRange("special-event", "formality-occasion");
    assert.ok(night.max < event.max, `${night.max} should be below ${event.max}`);
  });

  test("FB-C.2 Night out tops out at `occasion`; `evening` is reserved for a special event", () => {
    assert.deepEqual(getTargetFormalityRange("girls-night", "formality-occasion"), { min: 4, max: 5 });
    assert.deepEqual(getTargetFormalityRange("special-event", "formality-occasion"), { min: 4, max: 6 });
  });

  test("FB-C.3 an evening gown is no longer in range to anchor a Night out", async () => {
    // Both pieces score identically on signals, so only the formality tier separates them.
    const rows = [
      { id: "gown", name: "Burgundy Cowl Neck Evening Gown", category: "DRESSES", formality: "evening" },
      { id: "blazer", name: "Black Tailored Blazer", category: "OUTERWEAR", formality: "business-formal" },
    ].map((r) => ({
      subcategory: null, colors: [], primaryColor: null, pattern: null, material: null,
      styleTags: [], occasions: ["party"], imageUrl: null, garmentRelationships: [],
      waistShape: null, hemLength: null, topLength: null, sleeveLength: null,
      necklineCoverage: null, shoulderCoverage: null, midriffExposed: null,
      styleMeProfile: null, ...r,
    })) as never[];
    const picked = await autoSelectClosetAnchor("cust", {
      occasion: "girls-night", formalityConditional: "formality-occasion",
      moods: [], desiredFeelings: [], intentions: [], bodyNeeds: [],
    }, async () => rows);
    assert.equal(picked!.id, "blazer");
  });

  test("FB-C.4 the same gown IS in range for a special event", async () => {
    const rows = [
      { id: "gown", name: "Burgundy Cowl Neck Evening Gown", category: "DRESSES", formality: "evening" },
      { id: "blazer", name: "Black Tailored Blazer", category: "OUTERWEAR", formality: "business-formal" },
    ].map((r) => ({
      subcategory: null, colors: [], primaryColor: null, pattern: null, material: null,
      styleTags: [], occasions: ["formal"], imageUrl: null, garmentRelationships: [],
      waistShape: null, hemLength: null, topLength: null, sleeveLength: null,
      necklineCoverage: null, shoulderCoverage: null, midriffExposed: null,
      styleMeProfile: null, ...r,
    })) as never[];
    const picked = await autoSelectClosetAnchor("cust", {
      occasion: "special-event", formalityConditional: "formality-occasion",
      moods: [], desiredFeelings: [], intentions: [], bodyNeeds: [],
    }, async () => rows);
    assert.equal(picked!.id, "gown", "a gown must remain eligible for the occasion it is for");
  });
});

// ── FB-D: overlapping bands are untouched ────────────────────────────────────

describe("FB-D — bands that already overlapped are unchanged", () => {
  const UNCHANGED: Array<[string, string | null, number, number]> = [
    ["everyday", null, 1, 2], ["travel", null, 1, 2], ["active", null, 1, 1],
    ["work", null, 2, 4], ["dinner", null, 2, 5],
    ["work", "formality-smart", 2, 3], ["work", "formality-polished", 3, 4],
    ["dinner", "formality-relaxed", 2, 2], ["dinner", "formality-occasion", 4, 5],
    ["date-night", "formality-smart", 2, 3], ["date-night", "formality-polished", 3, 3],
    ["family", "formality-relaxed", 1, 2], ["family", "formality-smart", 2, 2],
    ["special-event", "formality-polished", 3, 4],
    ["not-sure", "formality-relaxed", 1, 2], ["not-sure", "formality-polished", 3, 4],
  ];
  for (const [o, f, min, max] of UNCHANGED) {
    test(`FB-D ${o} + ${f ?? "(not asked)"} stays ${min}-${max}`, () => {
      assert.deepEqual(getTargetFormalityRange(o, f), { min, max });
    });
  }
});

// ── FB-E: T2 carries severity ────────────────────────────────────────────────

const key = (o: Partial<Record<string, unknown>> = {}) => ({
  occasionTier: 2 as const, formalityFitPriority: 1, knownViolationCount: 0,
  bodyNeedFitScore: 0.5, intentionFit: 0, passportAlignment: 0,
  formalityOvershootAbs: 0, optionalNonMatchCount: 0, discretionaryPieceCount: 0,
  ...o,
}) as never;

describe("FB-E — formality miss severity is decided inside T2", () => {
  test("FB-E.1 the closer candidate wins even when the farther one fits the intention better", () => {
    // The real Test 17 shape: A overshoots by 1.729 with the better intention fit,
    // B overshoots by 0.918. B must win.
    const a = key({ formalityFitPriority: -1, formalityOvershootAbs: 1.729, intentionFit: 0.9 });
    const b = key({ formalityFitPriority: -1, formalityOvershootAbs: 0.918, intentionFit: 0.1 });
    assert.ok(compareCandidateRankKeys(a, b) > 0, "the smaller miss must rank first");
    assert.ok(compareCandidateRankKeys(b, a) < 0);
  });

  test("FB-E.2 severity is consulted before body-need fit too", () => {
    const a = key({ formalityFitPriority: -1, formalityOvershootAbs: 2.0, bodyNeedFitScore: 1.0 });
    const b = key({ formalityFitPriority: -1, formalityOvershootAbs: 0.5, bodyNeedFitScore: 0.0 });
    assert.ok(compareCandidateRankKeys(a, b) > 0);
  });

  test("FB-E.3 within-target still beats outside-target no matter how small the miss", () => {
    const inside = key({ formalityFitPriority: 1, formalityOvershootAbs: 0, intentionFit: 0 });
    const outside = key({ formalityFitPriority: -1, formalityOvershootAbs: 0.01, intentionFit: 1 });
    assert.ok(compareCandidateRankKeys(inside, outside) < 0);
  });

  test("FB-E.4 severity does not fire when the fit classes differ", () => {
    // unknown(0) vs outside(-1): the class decides, the distance is not consulted.
    const unknown = key({ formalityFitPriority: 0, formalityOvershootAbs: 5 });
    const outside = key({ formalityFitPriority: -1, formalityOvershootAbs: 0.1 });
    assert.ok(compareCandidateRankKeys(unknown, outside) < 0);
  });

  test("FB-E.5 two within-target candidates are still separated by T3/T4, not by severity", () => {
    const a = key({ formalityFitPriority: 1, intentionFit: 0.2 });
    const b = key({ formalityFitPriority: 1, intentionFit: 0.8 });
    assert.ok(compareCandidateRankKeys(a, b) > 0, "T4 must still decide between two in-band candidates");
  });

  test("FB-E.6 occasion validity still outranks formality severity", () => {
    const valid = key({ occasionTier: 2, formalityFitPriority: -1, formalityOvershootAbs: 3 });
    const invalid = key({ occasionTier: 0, formalityFitPriority: -1, formalityOvershootAbs: 0 });
    assert.ok(compareCandidateRankKeys(valid, invalid) < 0);
  });

  test("FB-E.7 severity is evaluated once, not twice", () => {
    // Identical in every respect except severity and a T6 tiebreak that would have
    // been reachable when severity sat at T6a. Severity must settle it first.
    const a = key({ formalityFitPriority: -1, formalityOvershootAbs: 1.5, discretionaryPieceCount: 0 });
    const b = key({ formalityFitPriority: -1, formalityOvershootAbs: 0.5, discretionaryPieceCount: 3 });
    assert.ok(compareCandidateRankKeys(a, b) > 0);
  });
});
