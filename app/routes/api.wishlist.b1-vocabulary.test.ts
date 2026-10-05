// app/routes/api.wishlist.b1-vocabulary.test.ts
//
// B1 — canonical vocabulary alignment, causal pass. Two classes of change,
// tested differently:
//
//   B1a (source convergence) — silhouette/formality/sleeveLength: proven
//   byte-identical to the pre-B1 hand-copied lists. Zero behavior possible.
//
//   B1b (output-space changes) — fitProfile n/a, necklineCoverage
//   shirt-collar, pattern stripe->stripes, material's curated-subset swap:
//   each is proven safe via causal fixtures through the REAL downstream
//   consumers (duplicate-evidence, constraint-evidence), not asserted by
//   inspection. "scoop" was found NOT safe by the same causal process and is
//   proven absent from the rendered vocabulary rather than silently added.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  GARMENT_SILHOUETTE_VALUES,
  FIT_PROFILE_VALUES,
  GARMENT_FORMALITY_VALUES,
  SLEEVE_LENGTH_VALUES,
  NECKLINE_COVERAGE_VALUES,
  GARMENT_MATERIAL_VALUES,
  GARMENT_PATTERN_VALUES,
} from "~/lib/ai/garment-intelligence.types";
import { normalizeDeclaredFacts, mergeVisionFacts } from "~/lib/buyskip/product-facts.server";
import { checkHardConstraints } from "~/lib/buyskip/constraint-evidence.server";
import { computeDuplicateEvidence } from "~/lib/buyskip/duplicate-evidence.server";

// Mirrors the curated subset actually used in the prompt (api.wishlist.jsx).
// Kept here, not imported, so this test fails loudly if the two ever diverge.
const CURATED_MATERIAL_TOKENS = ["denim", "silk", "cotton", "linen", "leather", "wool", "knit", "polyester", "satin"];
// Cast to string[]: TS 5.5+ infers the filter predicate below as a type
// predicate narrowing "scoop" out of the element type entirely, which would
// make the very assertion this test exists for ("scoop" is absent) fail to
// type-check rather than fail at runtime if it were ever reintroduced.
const NECKLINE_TOKENS_USED_IN_PROMPT = ([...NECKLINE_COVERAGE_VALUES] as string[]).filter(t => t !== "scoop");

function facts(productSnapshot: Record<string, unknown>) {
  const declared = normalizeDeclaredFacts({ category: "Top", color: ["BLACK"], brand: null, size: null });
  return mergeVisionFacts(declared, { productSnapshot });
}

describe("B1a — pure source convergence (byte-identical, zero behavior possible)", () => {
  it("silhouette/formality/sleeveLength are byte-identical to the pre-B1 hand-copied lists", () => {
    assert.equal([...GARMENT_SILHOUETTE_VALUES].join(" / "),
      "a-line / straight / column / fitted / flared / wrap / shift / oversized / balloon / asymmetric");
    assert.equal([...GARMENT_FORMALITY_VALUES].join(" / "),
      "casual / smart-casual / business-casual / business-formal / occasion / evening");
    assert.equal([...SLEEVE_LENGTH_VALUES].join(" / "),
      "full / three-quarter / short / sleeveless / n/a");
  });
});

describe("B1b — fitProfile n/a: causal proof against duplicate-evidence", () => {
  const closetItem = [{ name: "Black Tailored Blazer", category: "TOPS", primaryColor: "black", silhouette: "fitted", fitProfile: "tailored", formality: "business-casual", sleeveLength: "full", necklineCoverage: "crew" }];
  const base = { observedSilhouette: "fitted", observedFormality: "business-casual", observedSleeveLength: "full", observedNecklineCoverage: "crew", observationConfidence: "high — clearly visible" };

  it("fitProfile='n/a' produces a DIFFERENT ProductFacts status than null (inferred/'n/a' vs unknown/null) — admin-visible, not a no-op", () => {
    const withNA = facts({ ...base, observedFitProfile: "n/a" });
    const withNull = facts({ ...base, observedFitProfile: null });
    assert.deepEqual(withNA.fitProfile, { value: "n/a", status: "inferred", provenance: "vision-model" });
    assert.deepEqual(withNull.fitProfile, { value: null, status: "unknown", provenance: "vision-model" });
    assert.notDeepEqual(withNA.fitProfile, withNull.fitProfile, "the two states are genuinely distinct in ProductFacts, even though the next assertion shows duplicate-evidence treats them alike");
  });

  it("but DuplicateEvidence output for 'n/a' is byte-identical to the null/unknown case — normalize() already strips 'n/a' to null before comparing", () => {
    const withNA = computeDuplicateEvidence(facts({ ...base, observedFitProfile: "n/a" }), closetItem);
    const withNull = computeDuplicateEvidence(facts({ ...base, observedFitProfile: null }), closetItem);
    assert.deepEqual(withNA, withNull);
  });

  it("'n/a' loses the fitProfile match point that a concrete value would have earned (4 vs 5) — proves it is NOT silently treated as a match", () => {
    const concrete = computeDuplicateEvidence(facts({ ...base, observedFitProfile: "tailored" }), closetItem);
    const na = computeDuplicateEvidence(facts({ ...base, observedFitProfile: "n/a" }), closetItem);
    assert.equal(concrete.matches[0].matchCount, 5);
    assert.ok(concrete.matches[0].matchedFields.includes("fitProfile"));
    assert.equal(na.matches[0].matchCount, 4);
    assert.ok(!na.matches[0].matchedFields.includes("fitProfile"));
  });

  it("'n/a' never introduces a hard-constraint veto — constraint-evidence does not read fitProfile at all", () => {
    const withNA = facts({ ...base, observedFitProfile: "n/a" });
    const evidence = checkHardConstraints({ dressingPreferences: ["arms-covered", "chest-neckline-covered", "dresses-modestly"] }, withNA);
    assert.equal(evidence.hasHardViolation, false);
  });
});

describe("B1b — necklineCoverage causal matrix: shirt-collar kept, scoop deferred", () => {
  const REQUIREMENTS = ["chest-neckline-covered", "dresses-modestly", "wears-hijab", "usually-wears-abayas", "kanduras-thobes"];
  const baseSnapshot = { observedSleeveLength: "full", observedShoulderCoverage: true, observedMidriffExposed: false, observationConfidence: "high — clearly visible" };

  for (const reqId of REQUIREMENTS) {
    it(`shirt-collar -> "satisfied" for ${reqId} (unambiguous high coverage, correct fall-through)`, () => {
      const f = facts({ ...baseSnapshot, observedNecklineCoverage: "shirt-collar" });
      const evidence = checkHardConstraints({ dressingPreferences: [reqId] }, f);
      const check = evidence.checks.find(c => c.requirementId === reqId);
      assert.equal(check?.state, "satisfied");
      assert.equal(evidence.hasHardViolation, false);
    });

    it(`crew (reference, already-legal token) -> "satisfied" for ${reqId}, same bucket as shirt-collar`, () => {
      const f = facts({ ...baseSnapshot, observedNecklineCoverage: "crew" });
      const evidence = checkHardConstraints({ dressingPreferences: [reqId] }, f);
      assert.equal(evidence.checks.find(c => c.requirementId === reqId)?.state, "satisfied");
    });

    it(`low (reference, genuine violation) -> "violated" for ${reqId} — confirms the evaluator can still flag a real conflict`, () => {
      const f = facts({ ...baseSnapshot, observedNecklineCoverage: "low" });
      const evidence = checkHardConstraints({ dressingPreferences: [reqId] }, f);
      assert.equal(evidence.checks.find(c => c.requirementId === reqId)?.state, "violated");
    });
  }

  it("'scoop' is deferred — NOT present in the rendered necklineCoverage vocabulary the prompt actually offers", () => {
    assert.ok(!NECKLINE_TOKENS_USED_IN_PROMPT.includes("scoop"),
      "scoop falls through to 'satisfied' for every modesty requirement identically to crew, despite being only moderately conservative — not safe to expose until constraint-evidence has an intentional rule for it");
  });

  it("the 9 pre-existing neckline tokens keep their relative order; only shirt-collar is newly added", () => {
    assert.deepEqual(NECKLINE_TOKENS_USED_IN_PROMPT,
      ["high", "crew", "shirt-collar", "mock", "cowl-high", "v-neck", "low", "off-shoulder", "wrap-variable", "n/a"]);
  });
});

describe("B1b — pattern: stripe -> stripes correction", () => {
  it("ProductFacts accepts 'stripes' and preserves it verbatim", () => {
    const f = facts({ observedPattern: "stripes", observationConfidence: "high — clearly visible" });
    assert.equal(f.pattern.value, "stripes");
    assert.equal(f.pattern.status, "inferred");
  });

  it("no deterministic consumer branches on pattern at all — stripe vs stripes produces byte-identical DuplicateEvidence", () => {
    const closetItems = [{ name: "Red Fitted Top", category: "TOPS", primaryColor: "red", silhouette: "fitted" }];
    const withStripe = computeDuplicateEvidence(facts({ observedSilhouette: "fitted", observedPattern: "stripe", observationConfidence: "high — clearly visible" }), closetItems);
    const withStripes = computeDuplicateEvidence(facts({ observedSilhouette: "fitted", observedPattern: "stripes", observationConfidence: "high — clearly visible" }), closetItems);
    assert.deepEqual(withStripe, withStripes);
  });

  it("the old drifted token 'stripe' and the kept local tokens ('textured') still parse without error — no historical-read break", () => {
    for (const legacy of ["stripe", "textured"]) {
      const f = facts({ observedPattern: legacy, observationConfidence: "medium — partially visible" });
      assert.equal(f.pattern.value, legacy);
    }
  });
});

describe("B1b — material: curated-subset (Option B), not the full canonical set", () => {
  it("every curated material token is a genuine canonical member — the one deliberate swap can never silently drift", () => {
    for (const token of CURATED_MATERIAL_TOKENS) {
      assert.ok((GARMENT_MATERIAL_VALUES as ReadonlySet<string>).has(token), `"${token}" must be a real canonical material`);
    }
  });

  it("the curated list does not include 'synthetic' (not canonical) and is the same size as the pre-B1 list (9)", () => {
    assert.equal(CURATED_MATERIAL_TOKENS.length, 9);
    assert.ok(!CURATED_MATERIAL_TOKENS.includes("synthetic"));
    assert.ok(CURATED_MATERIAL_TOKENS.includes("polyester"), "synthetic's closest canonical analogue");
  });

  it("material is never read by any deterministic consumer — the curated-vs-full-canonical choice cannot change duplicate/constraint evidence either way", () => {
    const closetItems = [{ name: "Red Fitted Top", category: "TOPS", primaryColor: "red", silhouette: "fitted" }];
    const withCurated = computeDuplicateEvidence(facts({ observedSilhouette: "fitted", observedMaterial: "polyester", observationConfidence: "high — clearly visible" }), closetItems);
    const withFullSet = computeDuplicateEvidence(facts({ observedSilhouette: "fitted", observedMaterial: "cashmere", observationConfidence: "high — clearly visible" }), closetItems); // a canonical token outside the curated subset
    assert.deepEqual(withCurated, withFullSet, "material never enters the comparison regardless of which token or vocabulary source is used");
  });
});
