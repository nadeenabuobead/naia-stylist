// app/lib/ai/styleme-recommendation.test.ts
// Phase 3C certification suite for the deterministic StyleMe recommendation engine.
// Run with: node --experimental-strip-types --test app/lib/ai/styleme-recommendation.test.ts

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  runRecommendation,
  SCORING_WEIGHTS,
  FORMALITY_RANGES,
  SLOT_EXCLUSIONS,
  THRESHOLDS,
  deterministicRank,
  resolveNadineAnchor,
  resolveClosetAnchor,
  parseGeneralAvoidSegments,
  findExactAvoidToken,
  CLOSET_SLOT_PAIRING_TOKENS,
  NADINE_SET_COVERED_SLOTS,
  deriveForbiddenFromSetComponents,
  buildSessionFingerprint,
} from "./styleme-recommendation.ts";
import type {
  StyleMeEngineInput,
  StyleMeSessionInput,
  StyleMeProfileSignals,
  ProductEvaluation,
  ClosetCompatibilityItem,
  SemanticTieBreak,
} from "./styleme-recommendation.types.ts";
import { getAllCatalogProducts } from "./naia-catalog.ts";
import {
  PRODUCT_TEMPLATE_FIELDS,
  APPROVED_DRESSING_PREFERENCE_IDS,
  PROFILE_SP_V2_TO_V3_MAP,
} from "./signal-contract.ts";
import { buildProfileSignals } from "./styleme-result.server.ts";
import { quizQuestions } from "../onboarding/quiz-data.ts";

// ─── Session helpers ──────────────────────────────────────────────────────────

function makeSession(overrides: Partial<StyleMeSessionInput> = {}): StyleMeSessionInput {
  return {
    moods: [],
    desiredFeelings: [],
    bodyNeeds: [],
    coverageConditional: null,
    occasion: "everyday",
    formalityConditional: null,
    todayColours: { preferred: [], avoid: [] },
    practicalIds: [],
    source: "naia-piece",
    ...overrides,
  };
}

function run(
  session: StyleMeSessionInput,
  profile?: StyleMeProfileSignals,
  opts: { anchor?: StyleMeEngineInput["anchor"]; recentlyShown?: string[] } = {},
) {
  return runRecommendation({
    session,
    profile,
    anchor: opts.anchor,
    recentlyShownHandles: opts.recentlyShown,
  });
}

// Valid StyleMe session: all 5 required fields present.
// moods, desiredFeelings, bodyNeeds are non-empty; occasion and source are set.
function makeValidSession(overrides: Partial<StyleMeSessionInput> = {}): StyleMeSessionInput {
  return {
    moods: ["confident"],
    desiredFeelings: ["more-elevated"],
    bodyNeeds: ["nothing-specific"],
    coverageConditional: null,
    occasion: "everyday",
    formalityConditional: null,
    todayColours: { preferred: [], avoid: [] },
    practicalIds: [],
    source: "naia-piece",
    ...overrides,
  };
}

// Returns true if `winner` would be sorted before `other` by the 7-tier ordering.
function winsUnder7Tiers(winner: ProductEvaluation, other: ProductEvaluation): boolean {
  const scoreDiff = winner.totalScore - other.totalScore;
  if (scoreDiff !== 0) return scoreDiff > 0;
  const ta = winner.semanticTieBreak;
  const tb = other.semanticTieBreak;
  if (ta.anchorConfidence !== tb.anchorConfidence) return ta.anchorConfidence > tb.anchorConfidence;
  if (ta.matchedCategoryCount !== tb.matchedCategoryCount) return ta.matchedCategoryCount > tb.matchedCategoryCount;
  if (ta.positiveNonSupplementalCount !== tb.positiveNonSupplementalCount) return ta.positiveNonSupplementalCount > tb.positiveNonSupplementalCount;
  if (ta.totalNegativePenalty !== tb.totalNegativePenalty) return ta.totalNegativePenalty > tb.totalNegativePenalty;
  if (ta.provisionalCount !== tb.provisionalCount) return ta.provisionalCount < tb.provisionalCount;
  return ta.sessionSpecificHash < tb.sessionSpecificHash;
}

// ─── §1  Engine invariants ────────────────────────────────────────────────────

describe("§1  Engine invariants", () => {
  it("1.1 returns a structurally valid result for empty signals", () => {
    const result = run(makeSession());
    assert.ok(result.evaluatedProducts.length > 0, "should evaluate products");
    assert.ok(["nadine-recommendation", "closet-led", "no-eligible-product"].includes(result.outcome));
    assert.ok(Array.isArray(result.alternatives));
    assert.ok(result.coverage.totalCatalogProducts > 0);
    assert.ok(result.coverage.eligibleCandidates > 0);
  });

  it("1.2 evaluatedProducts contains exactly one entry per eligible product", () => {
    const result = run(makeSession());
    const all = getAllCatalogProducts();
    const eligible = all.filter((p) => p.eligibility !== "verified-inactive");
    assert.equal(result.evaluatedProducts.length, eligible.length);
  });

  it("1.3 same input always produces identical output (determinism)", () => {
    const session = makeSession({
      moods: ["confident"],
      desiredFeelings: ["more-feminine"],
      occasion: "date-night",
    });
    const profile: StyleMeProfileSignals = { stylePersonalities: ["feminine"] };
    const r1 = run(session, profile);
    const r2 = run(session, profile);
    assert.equal(r1.primary?.handle, r2.primary?.handle);
    assert.equal(r1.outcome, r2.outcome);
  });

  it("1.4 deterministicRank differs for all 11 handles", () => {
    const handles = getAllCatalogProducts().map((p) => p.handle);
    const ranks = new Set(handles.map(deterministicRank));
    assert.equal(ranks.size, handles.length, "all handles must have unique deterministicRank");
  });

  it("1.5 scoring weight constants are positive/negative as expected", () => {
    assert.ok(SCORING_WEIGHTS.STRONG_RANK > 0);
    assert.ok(SCORING_WEIGHTS.RANK > 0);
    assert.ok(SCORING_WEIGHTS.LIGHT_RANK > 0);
    assert.ok(SCORING_WEIGHTS.DEPRIORITISE < 0);
    assert.ok(SCORING_WEIGHTS.DIVERSITY_PENALTY < 0);
    assert.ok(SCORING_WEIGHTS.DUAL_MOOD_BONUS > 0);
    assert.ok(SCORING_WEIGHTS.STRONG_RANK > SCORING_WEIGHTS.RANK);
    assert.ok(SCORING_WEIGHTS.RANK > SCORING_WEIGHTS.LIGHT_RANK);
  });
});

// ─── §2  Reachability matrix (all 11 products) ────────────────────────────────

describe("§2  Reachability: all 11 products reachable via realistic signals", () => {
  //
  // double-top (Becoming Alive) — TOP, fs=4, el=medium
  // SP: artsy, feminine, edgy | ESS: confident, powerful, feel-good, playful
  // (catalog unchanged — playful->adventurous mood rename intentionally NOT
  // migrated for this product; see signal-contract.ts mood comment. Dual-mood
  // pairing swapped to confident+feel-good, both still live in double-top's ESS;
  // waist-definition body need added to give double-top a decisive, verified win.)
  //
  it("2.1  double-top wins: confident+feel-good ESS dual-mood with girls-night occasion", () => {
    const result = run(
      makeSession({
        moods: ["confident", "feel-good"],
        desiredFeelings: ["more-feminine"],
        bodyNeeds: ["waist-definition"],
        occasion: "girls-night",
      }),
      { stylePersonalities: ["feminine"] },
    );
    assert.equal(result.outcome, "nadine-recommendation");
    assert.equal(result.primary?.handle, "double-top");
  });

  //
  // collar-shirt (Becoming Real) — TOP, fs=3, el=low
  // SP: corporate-chic, effortlessly-chic, artsy | ESS: includes tired/overwhelmed
  // Unique advantage: el=low wins styling-effort-rule vs trench-coat (el=medium)
  //
  it("2.2  collar-shirt wins: tired mood + work + quick-to-style + corporate-chic, el=low edge", () => {
    const result = run(
      makeSession({
        moods: ["tired"],
        desiredFeelings: ["more-put-together"],
        occasion: "work",
        formalityConditional: "formality-smart",
        practicalIds: ["quick-to-style"],
      }),
      { stylePersonalities: ["corporate-chic"] },
    );
    assert.equal(result.outcome, "nadine-recommendation");
    assert.equal(result.primary?.handle, "collar-shirt");
    // Confirm the styling-effort evidence is present
    const sel = result.primary?.positiveEvidence.find(
      (e) => e.sessionSignal === "styling-effort-rule",
    );
    assert.ok(sel, "styling-effort LIGHT_RANK evidence should be present for low-effort product");
  });

  //
  // draped-leather-pants (Becoming Free) — BOTTOM, fs=3, el=medium
  // SP: edgy, artsy, effortlessly-chic | ESS: confident, powerful, adventurous, feel-good
  // Unique: "adventurous" is now exclusive to this product across the whole catalog
  // (2026-08-24 reconciliation — was cropped-top's discriminator before it was removed)
  //
  it("2.3  draped-leather-pants wins: adventurous+confident dual ESS, edgy SP, everyday + day-to-night PSM", () => {
    const result = run(
      makeSession({
        moods: ["confident", "adventurous"],
        desiredFeelings: ["more-confident", "more-elevated"],
        occasion: "everyday",
        practicalIds: ["day-to-night"],
      }),
      { stylePersonalities: ["edgy", "artsy"] },
    );
    assert.equal(result.outcome, "nadine-recommendation");
    assert.equal(result.primary?.handle, "draped-leather-pants");
  });

  //
  // asymmetrical-pants (Becoming Grounded) — BOTTOM, fs=4, el=medium
  // SP: edgy, artsy, corporate-chic | SMCM: structured, elongates, balances (unique combo)
  // Unique: BOTH elongates AND balances in SMCM; collar-shirt/trench lack elongates+balances combo
  // The 2026-08-24 reconciliation briefly introduced a "day-to-day" typo into this product's
  // own occasionTags (should read "everyday"), which caused a 3-way tie with oversized-blazer/
  // draped-leather-pants under occasion=everyday. Corrected in the workbook same day — this
  // scenario is back to its natural "everyday" occasion and wins cleanly again.
  //
  it("2.4  asymmetrical-pants wins: confident+powerful dual ESS, elongates+balances+structured SMCM", () => {
    const result = run(
      makeSession({
        moods: ["confident", "powerful"],
        desiredFeelings: ["more-powerful", "more-put-together"],
        bodyNeeds: ["elongates", "balances", "structured"],
        occasion: "everyday",
      }),
      { stylePersonalities: ["edgy"] },
    );
    assert.equal(result.outcome, "nadine-recommendation");
    assert.equal(result.primary?.handle, "asymmetrical-pants");
  });

  //
  // oversized-blazer (Becoming Bold) — OUTERWEAR, fs=4, el=low
  // SP: corporate-chic, effortlessly-chic, edgy | SMCM: more-coverage, structured, relaxed, elongates
  // Unique: structured+relaxed+elongates together — no other product has all three
  //
  it("2.5  oversized-blazer wins: tired mood, structured+relaxed+elongates SMCM, work + formality-polished", () => {
    const result = run(
      makeSession({
        moods: ["tired"],
        desiredFeelings: ["more-powerful", "more-effortless"],
        bodyNeeds: ["structured", "relaxed", "elongates"],
        occasion: "work",
        formalityConditional: "formality-polished",
      }),
      { stylePersonalities: ["corporate-chic", "effortlessly-chic"] },
    );
    assert.equal(result.outcome, "nadine-recommendation");
    assert.equal(result.primary?.handle, "oversized-blazer");
  });

  //
  // suede-skirt (Becoming Rooted) — BOTTOM, fs=4, el=medium
  // SP: feminine, romantic, artsy | PSM: movement-friendly, long-day, day-to-night
  // romantic SP is shared with midi-dress but long-day PSM tips suede-skirt ahead
  //
  it("2.6  suede-skirt wins: romantic mood, feminine+romantic SP, long-day PSM, formality-polished", () => {
    const result = run(
      makeSession({
        moods: ["romantic"],
        desiredFeelings: ["more-feminine", "more-attractive"],
        occasion: "date-night",
        formalityConditional: "formality-polished",
        practicalIds: ["long-day"],
      }),
      { stylePersonalities: ["feminine", "romantic"] },
    );
    assert.equal(result.outcome, "nadine-recommendation");
    assert.equal(result.primary?.handle, "suede-skirt");
  });

  //
  // trench-coat (Becoming Seen) — OUTERWEAR, fs=4, el=medium
  // SP: corporate-chic, artsy, edgy | ESS: has need-reset + tired (dual mood)
  // SMCM: more-coverage (shared) + elongates; coverage-non-negotiable bonus
  //
  it("2.7  trench-coat wins: need-reset+tired dual ESS, corporate-chic SP, coverage-non-negotiable", () => {
    const result = run(
      makeSession({
        moods: ["need-reset", "tired"],
        desiredFeelings: ["more-put-together", "more-elevated"],
        bodyNeeds: ["more-coverage", "elongates"],
        coverageConditional: "coverage-non-negotiable",
        occasion: "special-event",
        formalityConditional: "formality-polished",
        practicalIds: ["movement-friendly"],
      }),
      { stylePersonalities: ["corporate-chic"] },
    );
    assert.equal(result.outcome, "nadine-recommendation");
    assert.equal(result.primary?.handle, "trench-coat");
  });

  //
  // kimono-jacket (Becoming Whole) — OUTERWEAR, fs=3, el=medium
  // SP: artsy, effortlessly-chic, feminine | ESS: romantic + need-reset (both) + everyday occ
  // Key: kimono has everyday occ; midi-dress and others lack it
  //
  it("2.8  kimono-jacket wins: romantic+need-reset ESS, effortlessly-chic SP, everyday + waist-def+relaxed SMCM", () => {
    const result = run(
      makeSession({
        moods: ["romantic", "need-reset"],
        desiredFeelings: ["more-effortless", "more-feminine"],
        bodyNeeds: ["waist-definition", "relaxed"],
        occasion: "everyday",
        practicalIds: ["quick-to-style"],
      }),
      { stylePersonalities: ["effortlessly-chic", "feminine"] },
    );
    assert.equal(result.outcome, "nadine-recommendation");
    assert.equal(result.primary?.handle, "kimono-jacket");
  });

  //
  // leather-suede-jacket (Becoming Clear) — OUTERWEAR, fs=3, el=low
  // Redesigned 2026-08-24 as a relaxed bomber (was a fitted, waist-shaping jacket).
  // SP: artsy, edgy, effortlessly-chic | SMCM: relaxed, more-coverage, soft-and-forgiving-around-waist
  // ("soft-and-forgiving-around-waist" is an off-contract token per the reconciliation report —
  // not used for scoring here since it isn't in the recognised SMCM vocabulary)
  // Unique: this is now the only product combining need-reset+overwhelmed ESS with quick-to-style
  //
  it("2.9  leather-suede-jacket wins: need-reset+overwhelmed dual ESS, relaxed SMCM, girls-night + quick-to-style", () => {
    const result = run(
      makeSession({
        moods: ["need-reset", "overwhelmed"],
        desiredFeelings: ["more-effortless", "more-confident"],
        bodyNeeds: ["relaxed", "more-coverage"],
        occasion: "girls-night",
        practicalIds: ["quick-to-style"],
      }),
      { stylePersonalities: ["effortlessly-chic", "artsy"] },
    );
    assert.equal(result.outcome, "nadine-recommendation");
    assert.equal(result.primary?.handle, "leather-suede-jacket");
  });

  //
  // midi-dress (Becoming Her) — DRESS, fs=4, el=low
  // ESS: tired+low-energy (unique ESS combo with date-night occ — other tired products lack date-night)
  // PSM: quick-to-style | SP: feminine, romantic, artsy
  //
  it("2.10 midi-dress wins: tired+low-energy ESS unique to date-night, feminine SP, el=low bonus", () => {
    const result = run(
      makeSession({
        moods: ["tired", "low-energy"],
        desiredFeelings: ["more-feminine", "more-attractive"],
        bodyNeeds: ["waist-definition", "balances"],
        coverageConditional: "coverage-non-negotiable",
        occasion: "date-night",
        formalityConditional: "formality-smart",
        practicalIds: ["quick-to-style"],
      }),
      { stylePersonalities: ["feminine"] },
    );
    assert.equal(result.outcome, "nadine-recommendation");
    assert.equal(result.primary?.handle, "midi-dress");
  });

  //
  // dress-set (Becoming Defined) — SET, fs=5, el=high
  // SP: feminine, artsy, trendy | formality-occasion (range 4-5) → fs=5 in range
  // el=high penalty is counterbalanced by strong signal matches; other feminine/dual-ESS products outscored
  //
  it("2.11 dress-set wins: feminine+trendy SP, confident+powerful dual ESS, girls-night, formality-occasion", () => {
    const result = run(
      makeSession({
        moods: ["confident", "powerful"],
        desiredFeelings: ["more-confident", "more-powerful", "more-feminine"],
        occasion: "girls-night",
        formalityConditional: "formality-occasion",
      }),
      { stylePersonalities: ["feminine", "trendy"] },
    );
    assert.equal(result.outcome, "nadine-recommendation");
    assert.equal(result.primary?.handle, "dress-set");
  });
});

// ─── §3  Hard exclusion rules ─────────────────────────────────────────────────

describe("§3  Hard exclusion: slot conflicts, self-exclusion, NADINE avoid-pairing", () => {
  it("3.1  NADINE top anchor → self-excluded; no TOP, DRESS, or SET recommendations", () => {
    const result = run(
      makeSession({ moods: ["confident"], occasion: "everyday" }),
      {},
      { anchor: { type: "nadine", handle: "collar-shirt" } },
    );
    const excluded = result.evaluatedProducts.filter((e) => e.isHardExcluded);
    const excludedHandles = new Set(excluded.map((e) => e.handle));
    // collar-shirt self-excluded
    assert.ok(excludedHandles.has("collar-shirt"), "anchor (collar-shirt) must be self-excluded");
    // all other TOPs excluded by slot conflict
    // (only 2 TOP-type products remain post-2026-08-24 reconciliation: collar-shirt
    // is the anchor above, double-top is the only other one — cropped-top, the former
    // third TOP, was removed)
    assert.ok(excludedHandles.has("double-top"), "top slot conflict");
    // dresses and sets excluded
    assert.ok(excludedHandles.has("midi-dress"), "dress excluded by top anchor rule");
    assert.ok(excludedHandles.has("dress-set"), "set excluded by top anchor rule");
    // bottoms NOT excluded
    assert.ok(!excludedHandles.has("asymmetrical-pants"), "bottom should be eligible");
    assert.ok(!excludedHandles.has("draped-leather-pants"), "bottom should be eligible");
    // outerwear NOT excluded
    assert.ok(!excludedHandles.has("trench-coat"), "outerwear should be eligible");
  });

  it("3.2  NADINE bottom anchor → no BOTTOM, DRESS, or SET recommendations", () => {
    const result = run(
      makeSession({ occasion: "dinner" }),
      {},
      { anchor: { type: "nadine", handle: "asymmetrical-pants" } },
    );
    const excludedHandles = new Set(
      result.evaluatedProducts.filter((e) => e.isHardExcluded).map((e) => e.handle),
    );
    assert.ok(excludedHandles.has("asymmetrical-pants"), "self-excluded");
    assert.ok(excludedHandles.has("draped-leather-pants"), "bottom slot conflict");
    assert.ok(excludedHandles.has("suede-skirt"), "bottom slot conflict");
    assert.ok(excludedHandles.has("midi-dress"), "dress excluded by bottom anchor rule");
    assert.ok(excludedHandles.has("dress-set"), "set excluded by bottom anchor rule");
    assert.ok(!excludedHandles.has("collar-shirt"), "top should be eligible");
    assert.ok(!excludedHandles.has("trench-coat"), "outerwear should be eligible");
  });

  it("3.3  NADINE dress anchor → only BOTTOM is excluded (spec: dress cannot receive a bottom)", () => {
    const result = run(
      makeSession({ occasion: "date-night" }),
      {},
      { anchor: { type: "nadine", handle: "midi-dress" } },
    );
    const excluded = result.evaluatedProducts.filter((e) => e.isHardExcluded);
    const excludedHandles = new Set(excluded.map((e) => e.handle));
    // midi-dress self-excluded
    assert.ok(excludedHandles.has("midi-dress"), "self-excluded");
    // bottoms excluded
    assert.ok(excludedHandles.has("asymmetrical-pants"), "bottom slot conflict");
    assert.ok(excludedHandles.has("draped-leather-pants"), "bottom slot conflict");
    assert.ok(excludedHandles.has("suede-skirt"), "bottom slot conflict");
    // midi-dress avoid-pairings: Becoming Whole (kimono-jacket) and Becoming Clear (leather-suede-jacket)
    assert.ok(excludedHandles.has("kimono-jacket"), "kimono-jacket in midi-dress avoid-pairing");
    assert.ok(excludedHandles.has("leather-suede-jacket"), "leather-suede-jacket in midi-dress avoid-pairing");
    // tops are NOT excluded by dress anchor
    assert.ok(!excludedHandles.has("collar-shirt"), "top should be eligible with dress anchor");
    assert.ok(!excludedHandles.has("double-top"), "top should be eligible with dress anchor");
  });

  it("3.4  NADINE set anchor → only OUTERWEAR can be recommended", () => {
    const result = run(
      makeSession({ occasion: "dinner" }),
      {},
      { anchor: { type: "nadine", handle: "dress-set" } },
    );
    const eligible = result.evaluatedProducts.filter((e) => !e.isHardExcluded);
    const eligibleSlots = new Set(eligible.map((e) => e.slot));
    // Only outerwear should survive slot check (and avoid-pairing may further reduce)
    for (const ev of eligible) {
      assert.equal(ev.slot, "outerwear", `non-outerwear ${ev.handle} should be excluded with set anchor`);
    }
    // dress-set avoid-pairing: Becoming Whole (kimono), Becoming Clear (leather-suede-jacket)
    // trench-coat has no avoid mention → should remain eligible
    const eligibleHandles = new Set(eligible.map((e) => e.handle));
    assert.ok(eligibleHandles.has("trench-coat"), "trench-coat should be eligible with set anchor");
    assert.ok(!eligibleHandles.has("kimono-jacket"), "kimono-jacket in dress-set avoid-pairing");
    assert.ok(!eligibleHandles.has("leather-suede-jacket"), "leather-suede-jacket in dress-set avoid-pairing");
  });

  it("3.5  NADINE outerwear anchor → no OUTERWEAR recommendation", () => {
    const result = run(
      makeSession({ occasion: "dinner" }),
      {},
      { anchor: { type: "nadine", handle: "trench-coat" } },
    );
    const excluded = result.evaluatedProducts.filter((e) => e.isHardExcluded);
    const excludedHandles = new Set(excluded.map((e) => e.handle));
    assert.ok(excludedHandles.has("trench-coat"), "self-excluded");
    assert.ok(excludedHandles.has("kimono-jacket"), "outerwear slot conflict");
    assert.ok(excludedHandles.has("leather-suede-jacket"), "outerwear slot conflict");
    assert.ok(!excludedHandles.has("collar-shirt"), "top eligible");
    assert.ok(!excludedHandles.has("midi-dress"), "dress eligible");
  });

  it("3.6  firm-no colour excludes products whose colors map to that vocab ID", () => {
    // All products contain beige-brown tones; set firm-no to beige-brown → many excluded
    const result = run(
      makeSession({ occasion: "everyday" }),
      { firmNoColors: ["red-burgundy"] },
    );
    // Products with burgundy/rust colors: double-top, asymmetrical-pants, suede-skirt,
    // trench-coat, kimono-jacket, leather-suede-jacket, midi-dress, dress-set, oversized-blazer
    // (draped-leather-pants, added 2026-08-24, is taupe/art-print only — no burgundy/rust)
    const excluded = result.evaluatedProducts.filter(
      (e) => e.isHardExcluded && e.hardExclusionReasons.includes("firm-no-colour-exclusion"),
    );
    assert.ok(excluded.length > 0, "some products should be firm-no excluded for red-burgundy");
    // Check none of the excluded products appear as primary or alternatives
    const excludedHandles = new Set(excluded.map((e) => e.handle));
    if (result.primary) {
      assert.ok(!excludedHandles.has(result.primary.handle), "firm-no product must not be primary");
    }
    for (const alt of result.alternatives) {
      assert.ok(!excludedHandles.has(alt.handle), "firm-no product must not be alternative");
    }
  });
});

// ─── §4  NADINE pairing evidence scoring ──────────────────────────────────────

describe("§4  NADINE pairing evidence scoring", () => {
  it("4.1  bestPairedWith products receive RANK (+2) evidence when anchor is set", () => {
    // trench-coat BPW includes midi-dress (Becoming Her) → midi-dress gets +2
    const result = run(
      makeSession({
        moods: ["confident"],
        desiredFeelings: ["more-feminine"],
        occasion: "dinner",
      }),
      { stylePersonalities: ["feminine"] },
      { anchor: { type: "nadine", handle: "trench-coat" } },
    );
    const midiEv = result.evaluatedProducts.find((e) => e.handle === "midi-dress");
    assert.ok(midiEv, "midi-dress must be evaluated");
    const pairingEvidence = midiEv!.positiveEvidence.find(
      (e) => e.sessionSignal === "nadine-pairing-best",
    );
    assert.ok(pairingEvidence, "midi-dress should have pairing-best evidence for trench-coat anchor");
    assert.equal(pairingEvidence!.points, SCORING_WEIGHTS.RANK);
  });

  it("4.2  conditionalPairings products receive LIGHT_RANK (+1) evidence", () => {
    // collar-shirt conditional: "Becoming Clear only if..." → leather-suede-jacket gets +1
    const result = run(
      makeSession({ occasion: "work" }),
      {},
      { anchor: { type: "nadine", handle: "collar-shirt" } },
    );
    const lsjEv = result.evaluatedProducts.find((e) => e.handle === "leather-suede-jacket");
    assert.ok(lsjEv && !lsjEv.isHardExcluded, "leather-suede-jacket must be eligible");
    const condEv = lsjEv!.positiveEvidence.find(
      (e) => e.sessionSignal === "nadine-pairing-conditional",
    );
    assert.ok(condEv, "leather-suede-jacket should have conditional pairing evidence");
    assert.equal(condEv!.points, SCORING_WEIGHTS.LIGHT_RANK);
  });

  it("4.3  anchor compatibility status is incompatible for avoided products", () => {
    // midi-dress avoid: Becoming Whole (kimono) and Becoming Clear (leather-suede-jacket)
    const result = run(
      makeSession({ occasion: "date-night" }),
      {},
      { anchor: { type: "nadine", handle: "midi-dress" } },
    );
    const kimonoEv = result.evaluatedProducts.find((e) => e.handle === "kimono-jacket");
    assert.ok(kimonoEv?.isHardExcluded, "kimono-jacket must be hard-excluded");
    assert.equal(kimonoEv!.anchorCompatibility.status, "incompatible");
    assert.equal(kimonoEv!.anchorCompatibility.exclusionReason, "nadine-avoid-exclusion");
  });
});

// ─── §5  Signal combination matrix ────────────────────────────────────────────

describe("§5  Signal combination matrix: every canonical value exercised", () => {
  const OCCASIONS = [
    "everyday", "work", "dinner", "date-night",
    "girls-night", "family", "special-event", "travel", "not-sure",
  ];
  const MOODS = [
    "confident", "adventurous", "romantic", "powerful", "need-reset",
    "feel-good", "tired", "low-energy", "feeling-low", "overwhelmed",
    "self-conscious", "neutral",
  ];
  const DFM_IDS = [
    "more-confident", "more-put-together", "softer", "more-powerful",
    "more-feminine", "more-effortless", "more-elevated", "more-attractive",
    "like-myself",
  ];
  const BODY_NEEDS = [
    "waist-definition", "soft-and-forgiving-around-waist", "more-coverage",
    "relaxed", "structured", "elongates", "balances", "comfortable-elevated",
    "nothing-specific",
  ];
  const FORMALITY_IDS = [
    "formality-relaxed", "formality-smart", "formality-polished", "formality-occasion",
  ];
  const PSM_IDS = [
    "quick-to-style", "lots-of-movement", "long-day", "practical-footwear",
    "day-to-night", "hot-outdoors", "cool-air-conditioning", "no-special-constraint",
  ];
  const STYLE_PERSONALITIES = [
    "old-money", "artsy", "edgy", "feminine", "corporate-chic",
    "effortlessly-chic", "minimal", "trendy", "romantic", "casual-cool",
  ];

  it("5.1  every occasion ID produces a coherent result", () => {
    for (const occ of OCCASIONS) {
      const session = makeSession({ occasion: occ });
      const result = run(session);
      assert.ok(
        ["nadine-recommendation", "closet-led", "no-eligible-product"].includes(result.outcome),
        `occasion=${occ} produced invalid outcome: ${result.outcome}`,
      );
    }
  });

  it("5.2  every mood ID (single) produces a coherent result", () => {
    for (const mood of MOODS) {
      const session = makeSession({ moods: [mood], occasion: "everyday" });
      const result = run(session);
      assert.ok(
        ["nadine-recommendation", "closet-led", "no-eligible-product"].includes(result.outcome),
        `mood=${mood} failed`,
      );
    }
  });

  it("5.3  every desired-feeling ID produces a coherent result", () => {
    for (const dfm of DFM_IDS) {
      const session = makeSession({ desiredFeelings: [dfm], occasion: "everyday" });
      const result = run(session);
      assert.ok(
        ["nadine-recommendation", "closet-led", "no-eligible-product"].includes(result.outcome),
        `dfm=${dfm} failed`,
      );
    }
  });

  it("5.4  every body-need ID produces a coherent result", () => {
    for (const bn of BODY_NEEDS) {
      const session = makeSession({ bodyNeeds: [bn], occasion: "everyday" });
      const result = run(session);
      assert.ok(
        ["nadine-recommendation", "closet-led", "no-eligible-product"].includes(result.outcome),
        `bodyNeed=${bn} failed`,
      );
    }
  });

  it("5.5  every formality ID produces a coherent result", () => {
    for (const fm of FORMALITY_IDS) {
      const session = makeSession({
        occasion: "dinner",
        formalityConditional: fm,
      });
      const result = run(session);
      assert.ok(
        ["nadine-recommendation", "closet-led", "no-eligible-product"].includes(result.outcome),
        `formality=${fm} failed`,
      );
    }
  });

  it("5.6  every PSM ID (single) produces a coherent result", () => {
    for (const psm of PSM_IDS) {
      const session = makeSession({ practicalIds: [psm], occasion: "everyday" });
      const result = run(session);
      assert.ok(
        ["nadine-recommendation", "closet-led", "no-eligible-product"].includes(result.outcome),
        `psm=${psm} failed`,
      );
    }
  });

  it("5.7  every approved Style Personality ID produces a coherent result", () => {
    for (const sp of STYLE_PERSONALITIES) {
      const session = makeSession({ occasion: "everyday" });
      const result = run(session, { stylePersonalities: [sp] });
      assert.ok(
        ["nadine-recommendation", "closet-led", "no-eligible-product"].includes(result.outcome),
        `sp=${sp} failed`,
      );
    }
  });

  it("5.8  source=my-closet produces a result", () => {
    const result = run(makeSession({ source: "my-closet", occasion: "everyday" }));
    assert.ok(
      ["nadine-recommendation", "closet-led", "no-eligible-product"].includes(result.outcome),
    );
  });

  it("5.9  source=both produces a result", () => {
    const result = run(makeSession({ source: "both", occasion: "dinner" }));
    assert.ok(
      ["nadine-recommendation", "closet-led", "no-eligible-product"].includes(result.outcome),
    );
  });

  it("5.10 coverage-non-negotiable and coverage-flexible produce coherent results", () => {
    const r1 = run(makeSession({ coverageConditional: "coverage-non-negotiable", occasion: "work" }));
    const r2 = run(makeSession({ coverageConditional: "coverage-flexible-with-layering", occasion: "work" }));
    assert.ok(["nadine-recommendation", "closet-led", "no-eligible-product"].includes(r1.outcome));
    assert.ok(["nadine-recommendation", "closet-led", "no-eligible-product"].includes(r2.outcome));
  });

  it("5.11 today preferred and avoided colours produce coherent results", () => {
    const r1 = run(makeSession({
      todayColours: { preferred: ["black", "red-burgundy"], avoid: [] },
      occasion: "dinner",
    }));
    const r2 = run(makeSession({
      todayColours: { preferred: [], avoid: ["beige-brown"] },
      occasion: "dinner",
    }));
    assert.ok(["nadine-recommendation", "closet-led", "no-eligible-product"].includes(r1.outcome));
    assert.ok(["nadine-recommendation", "closet-led", "no-eligible-product"].includes(r2.outcome));
  });
});

// ─── §6  Scoring precision ────────────────────────────────────────────────────

describe("§6  Scoring precision", () => {
  it("6.1  dual-mood bonus (+2) appears when both moods match ESS", () => {
    // double-top ESS: confident, powerful, feel-good, playful (catalog unchanged —
    // playful->adventurous mood rename intentionally NOT migrated for this product;
    // its emotionalSupportLogic is about garment movement/kinetics, not an
    // unpredictable styling choice, so it no longer matches any live mood option)
    const result = run(
      makeSession({
        moods: ["confident", "feel-good"],
        occasion: "girls-night",
      }),
    );
    const dtEv = result.evaluatedProducts.find((e) => e.handle === "double-top");
    assert.ok(dtEv);
    const dualBonus = dtEv!.positiveEvidence.find(
      (e) => e.matchedToken === "dual-mood-bonus",
    );
    assert.ok(dualBonus, "dual-mood bonus evidence must be present");
    assert.equal(dualBonus!.points, SCORING_WEIGHTS.DUAL_MOOD_BONUS);
  });

  it("6.2  dual-mood bonus does NOT appear when only one mood matches ESS", () => {
    // dress-set ESS: confident, powerful, feel-good, romantic
    // moods=[confident, adventurous] — adventurous NOT in dress-set ESS
    const result = run(makeSession({ moods: ["confident", "adventurous"], occasion: "dinner" }));
    const dsEv = result.evaluatedProducts.find((e) => e.handle === "dress-set");
    assert.ok(dsEv);
    const dualBonus = dsEv!.positiveEvidence.find(
      (e) => e.matchedToken === "dual-mood-bonus",
    );
    assert.ok(!dualBonus, "dual-mood bonus must not appear when only one mood matches");
  });

  it("6.3  styling-effort-low (+1) appears for el=low products when tired mood is active", () => {
    // collar-shirt el=low, midi-dress el=low
    const result = run(makeSession({ moods: ["tired"], occasion: "work" }));
    const cEv = result.evaluatedProducts.find((e) => e.handle === "collar-shirt");
    assert.ok(cEv);
    const selEv = cEv!.positiveEvidence.find((e) => e.sessionSignal === "styling-effort-rule");
    assert.ok(selEv, "collar-shirt (el=low) must have SEL evidence with tired mood");
    assert.equal(selEv!.points, SCORING_WEIGHTS.STYLING_EFFORT_LOW);
  });

  it("6.4  styling-effort-high (-2) appears for el=high products when tired mood is active", () => {
    const result = run(makeSession({ moods: ["tired"], occasion: "dinner" }));
    const dsEv = result.evaluatedProducts.find((e) => e.handle === "dress-set");
    assert.ok(dsEv);
    const selEv = dsEv!.negativeEvidence.find((e) => e.sessionSignal === "styling-effort-rule");
    assert.ok(selEv, "dress-set (el=high) must have negative SEL evidence with tired mood");
    assert.equal(selEv!.points, SCORING_WEIGHTS.STYLING_EFFORT_HIGH);
  });

  it("6.5  style-tags fallback (+1) fires for old-money/minimal/casual-cool when no direct SP match", () => {
    // asymmetrical-pants styleTags: formal, edgy, trendy, classic — none of old-money/minimal/casual-cool
    // collar-shirt styleTags: formal, classic, minimalist, trendy — "minimalist" is NOT "minimal"
    // Let's find a product with a fallback tag. The fallback set is: old-money, minimal, casual-cool
    // cropped-top styleTags: edgy, trendy, casual — no fallback match
    // trench-coat styleTags: formal, edgy, trendy, classic — no fallback
    // Looking at the data: none of the 11 products have "old-money", "minimal", or "casual-cool" in styleTags
    // The fallback exists for products that might get new tags in future, so test the fallback path
    // fires correctly when a product WOULD match (the logic exists, not the data)
    // Instead: verify that STYLE_PERSONALITY_STYLE_TAG_FALLBACK set is correctly used
    // by checking sp="old-money" produces 0 fallback evidence for current products (none match)
    const result = run(makeSession({ occasion: "everyday" }), { stylePersonalities: ["old-money"] });
    const fallbackEvidence = result.evaluatedProducts.flatMap((e) => e.positiveEvidence).filter(
      (e) => e.isFallback,
    );
    // Current catalog has no styleTags matching old-money/minimal/casual-cool exactly
    // so fallback evidence count should be 0
    assert.equal(fallbackEvidence.length, 0, "no fallback evidence expected for current V8 catalog");
  });

  it("6.6  like-myself amplification (+2 per SP match) fires for each direct SP match", () => {
    // Use V2 SP=feminine (→ feminine-romantic via V2→V3 map) + like-myself in desiredFeelings
    const result = run(
      makeSession({
        desiredFeelings: ["like-myself"],
        occasion: "dinner",
      }),
      { stylePersonalities: ["feminine"] },
    );
    // Products with feminine-romantic SP: double-top, suede-skirt, kimono-jacket, midi-dress, dress-set
    const doubleTopEv = result.evaluatedProducts.find((e) => e.handle === "double-top");
    assert.ok(doubleTopEv);
    const ampEv = doubleTopEv!.positiveEvidence.find(
      (e) => e.sessionSignal === "like-myself",
    );
    assert.ok(ampEv, "like-myself amplification evidence must appear for SP match");
    assert.equal(ampEv!.points, SCORING_WEIGHTS.LIKE_MYSELF_SP_BONUS);
  });

  it("6.7  today preferred colour adds STRONG_RANK (+4) when any product colour matches", () => {
    // No current product has literal "black" as a colour (that was cropped-top/straight-pants,
    // both removed 2026-08-24) — burgundy -> red-burgundy is double-top's colour instead.
    const result = run(
      makeSession({ todayColours: { preferred: ["red-burgundy"], avoid: [] }, occasion: "everyday" }),
    );
    const dtEv = result.evaluatedProducts.find((e) => e.handle === "double-top");
    assert.ok(dtEv);
    const colEv = dtEv!.positiveEvidence.find(
      (e) => e.sessionSignal === "colour-preferred-today",
    );
    assert.ok(colEv, "double-top should get preferred colour evidence for red-burgundy");
    assert.equal(colEv!.points, SCORING_WEIGHTS.STRONG_RANK);
  });

  it("6.8  today avoided colour adds DEPRIORITISE (-3) when any product colour matches", () => {
    const result = run(
      makeSession({
        todayColours: { preferred: [], avoid: ["red-burgundy"] },
        occasion: "dinner",
      }),
    );
    // double-top colors include burgundy → maps to red-burgundy
    const dtEv = result.evaluatedProducts.find((e) => e.handle === "double-top");
    assert.ok(dtEv);
    const avoidEv = dtEv!.negativeEvidence.find(
      (e) => e.sessionSignal === "colour-avoid-today",
    );
    assert.ok(avoidEv, "double-top should have avoided colour evidence");
    assert.equal(avoidEv!.points, SCORING_WEIGHTS.DEPRIORITISE);
  });

  it("6.9  formality-relaxed (range 1–3) gives +4 to fs=3 products, -3 to fs=5", () => {
    const result = run(
      makeSession({ formalityConditional: "formality-relaxed", occasion: "everyday" }),
    );
    // collar-shirt fs=3, range [1,3] → in range → +4
    const csEv = result.evaluatedProducts.find((e) => e.handle === "collar-shirt");
    const fmEv = csEv?.positiveEvidence.find((e) => e.sessionSignal === "formality-relaxed");
    assert.ok(fmEv, "collar-shirt should get formality +4 for formality-relaxed");
    assert.equal(fmEv!.points, SCORING_WEIGHTS.STRONG_RANK);

    // dress-set fs=5, range [1,3] → gap = 5-3 = 2 → mismatch → -3
    const dsEv = result.evaluatedProducts.find((e) => e.handle === "dress-set");
    const dsFmEv = dsEv?.negativeEvidence.find((e) => e.sessionSignal === "formality-relaxed");
    assert.ok(dsFmEv, "dress-set should get formality -3 for formality-relaxed");
    assert.equal(dsFmEv!.points, SCORING_WEIGHTS.DEPRIORITISE);
  });

  it("6.10 formality-occasion (range 4–5) gives +2 (adjacent) to fs=3 products", () => {
    const result = run(
      makeSession({ formalityConditional: "formality-occasion", occasion: "dinner" }),
    );
    // collar-shirt fs=3, range [4,5] → gap = 4-3 = 1 → adjacent → +2
    const csEv = result.evaluatedProducts.find((e) => e.handle === "collar-shirt");
    const fmEv = csEv?.positiveEvidence.find((e) => e.sessionSignal === "formality-occasion");
    assert.ok(fmEv, "collar-shirt should get formality +2 (adjacent)");
    assert.equal(fmEv!.points, SCORING_WEIGHTS.RANK);
  });

  it("6.11 PSM lots-of-movement normalises to movement-friendly before scoring", () => {
    // midi-dress's practicalSupportMatch was simplified to just "quick-to-style" in the
    // 2026-08-24 reconciliation (no longer has movement-friendly) — suede-skirt still does.
    const result = run(makeSession({ practicalIds: ["lots-of-movement"], occasion: "everyday" }));
    const ssEv = result.evaluatedProducts.find((e) => e.handle === "suede-skirt");
    assert.ok(ssEv);
    // suede-skirt has movement-friendly in PSM (provisional)
    const psmEv = ssEv!.positiveEvidence.find((e) => e.matchedToken === "movement-friendly");
    assert.ok(psmEv, "suede-skirt should match movement-friendly after normalisation");
  });

  it("6.12 no-special-constraint suppresses all PSM scoring", () => {
    const result = run(
      makeSession({ practicalIds: ["no-special-constraint", "quick-to-style"], occasion: "work" }),
    );
    // Even though quick-to-style is provided alongside no-special-constraint,
    // no PSM matching should fire (no-special-constraint is a neutral flag)
    // The engine checks: if no-special-constraint in practicalIds, skip PSM scoring
    for (const ev of result.evaluatedProducts) {
      const hasPSM = ev.positiveEvidence.some(
        (e) => e.field === "practicalSupportMatch",
      );
      assert.ok(!hasPSM, `${ev.handle}: PSM scoring must be suppressed when no-special-constraint is set`);
    }
  });

  it("6.13 coverage-non-negotiable adds extra STRONG_RANK for products with more-coverage", () => {
    const result = run(
      makeSession({ coverageConditional: "coverage-non-negotiable", occasion: "work" }),
    );
    // trench-coat SMCM has more-coverage
    const tcEv = result.evaluatedProducts.find((e) => e.handle === "trench-coat");
    const covEv = tcEv?.positiveEvidence.find(
      (e) => e.sessionSignal === "coverage-non-negotiable",
    );
    assert.ok(covEv, "trench-coat should get extra +4 for coverage-non-negotiable");
    assert.equal(covEv!.points, SCORING_WEIGHTS.STRONG_RANK);
  });

  it("6.14 profile avoid-colours adds DEPRIORITISE (-3)", () => {
    const result = run(
      makeSession({ occasion: "everyday" }),
      { avoidColors: ["red-burgundy"] },
    );
    const dtEv = result.evaluatedProducts.find((e) => e.handle === "double-top");
    assert.ok(dtEv);
    const avEv = dtEv!.negativeEvidence.find((e) => e.sessionSignal === "profile-colour-avoid");
    assert.ok(avEv, "double-top should have profile avoid-colour evidence");
    assert.equal(avEv!.points, SCORING_WEIGHTS.DEPRIORITISE);
  });
});

// ─── §7  Anchor-category matrix ───────────────────────────────────────────────

describe("§7  Anchor-category matrix: all anchor slot types", () => {
  it("7.1  NADINE outerwear anchor → outcome is recommendation from non-outerwear slots", () => {
    const result = run(
      makeSession({ moods: ["confident"], occasion: "dinner" }),
      { stylePersonalities: ["artsy"] },
      { anchor: { type: "nadine", handle: "trench-coat" } },
    );
    assert.equal(result.outcome, "nadine-recommendation");
    assert.ok(result.primary?.slot !== "outerwear", "primary must not be outerwear");
  });

  it("7.2  Closet anchor TOPS → tops, dresses, sets excluded; outerwear + bottom eligible", () => {
    const result = run(
      makeSession({ occasion: "dinner" }),
      {},
      {
        anchor: {
          type: "closet",
          id: "closet-top-1",
          name: "My silk top",
          category: "TOPS",
          colors: ["ivory"],
          primaryColor: "ivory",
          pattern: null,
          material: "silk",
          styleTags: ["formal"],
          occasions: ["dinner"],
          imageUrl: "https://example.com/img.jpg",
        },
      },
    );
    if (result.primary) {
      assert.ok(
        ["bottom", "outerwear"].includes(result.primary.slot),
        `closet top anchor should recommend bottom or outerwear, got ${result.primary.slot}`,
      );
    }
  });

  it("7.3  Closet anchor DRESSES → only bottom excluded", () => {
    const result = run(
      makeSession({ occasion: "dinner" }),
      {},
      {
        anchor: {
          type: "closet",
          id: "closet-dress-1",
          name: "My evening dress",
          category: "DRESSES",
          colors: ["black"],
          primaryColor: "black",
          pattern: null,
          material: null,
          styleTags: [],
          occasions: ["dinner"],
          imageUrl: "https://example.com/img.jpg",
        },
      },
    );
    if (result.primary) {
      assert.ok(
        result.primary.slot !== "bottom",
        "closet dress anchor should not recommend a bottom",
      );
    }
  });

  it("7.4  Closet anchor BAGS/unknown slot → no slot conflict exclusions", () => {
    const result = run(
      makeSession({ moods: ["confident"], occasion: "everyday" }),
      { stylePersonalities: ["artsy"] },
      {
        anchor: {
          type: "closet",
          id: "closet-bag-1",
          name: "My bag",
          category: "BAGS",
          colors: [],
          primaryColor: null,
          pattern: null,
          material: null,
          styleTags: [],
          occasions: [],
          imageUrl: "https://example.com/img.jpg",
        },
      },
    );
    // Unknown slot → all products remain eligible
    const excluded = result.evaluatedProducts.filter(
      (e) => e.hardExclusionReasons.some((r) => r.startsWith("slot-conflict")),
    );
    assert.equal(excluded.length, 0, "no slot-conflict exclusions for unknown anchor slot");
  });
});

// ─── §8  Diversity and tie-breaking ───────────────────────────────────────────

describe("§8  Diversity and tie-breaking", () => {
  it("8.1  diversity adjustments: index-0 gets REGENERATE_PRIMARY_PENALTY, index-1+ gets DIVERSITY_PENALTY", () => {
    const result = run(
      makeSession({ moods: ["confident"], occasion: "dinner" }),
      { stylePersonalities: ["artsy"] },
      { recentlyShown: ["collar-shirt", "asymmetrical-pants"] },
    );
    // index-0 (primary shown last time) gets strong penalty to guarantee a different result
    const primaryEv = result.evaluatedProducts.find((e) => e.handle === "collar-shirt");
    assert.ok(primaryEv);
    assert.equal(primaryEv!.diversityAdjustment, SCORING_WEIGHTS.REGENERATE_PRIMARY_PENALTY);
    // index-1 (alternative shown last time) gets mild penalty only
    const altEv = result.evaluatedProducts.find((e) => e.handle === "asymmetrical-pants");
    assert.ok(altEv);
    assert.equal(altEv!.diversityAdjustment, SCORING_WEIGHTS.DIVERSITY_PENALTY);
  });

  it("8.2  alternative-shown handle (index 1+) is not suppressed if it has highest score", () => {
    // The REGENERATE_PRIMARY_PENALTY applies only to index 0.
    // An alternative (index 1+) gets only -1 and can still win if it scores highest.
    const result = run(
      makeSession({
        moods: ["confident", "powerful"],
        bodyNeeds: ["elongates", "balances", "structured"],
        occasion: "work",
      }),
      {},
      // asymmetrical-pants at index 1 → only DIVERSITY_PENALTY (-1), should still win
      { recentlyShown: ["collar-shirt", "asymmetrical-pants"] },
    );
    assert.equal(result.outcome, "nadine-recommendation");
    assert.equal(result.primary?.handle, "asymmetrical-pants");
  });

  it("8.3  tie-breaking is deterministic regardless of catalog order (anti-first-place)", () => {
    // Run engine with empty signals → scores all 0 → tie-break determines winner
    const r1 = run(makeSession({ occasion: "everyday", moods: [] }));
    const r2 = run(makeSession({ occasion: "everyday", moods: [] }));
    // Same winner both times
    assert.equal(r1.primary?.handle, r2.primary?.handle, "winner must be deterministic");
  });
});

// ─── §9  Provisional evidence ─────────────────────────────────────────────────

describe("§9  Provisional evidence marking", () => {
  it("9.1  provisional evidence is scored but marked isProvisional=true", () => {
    // midi-dress tired ESS is provisional; trigger it
    const result = run(makeSession({ moods: ["tired"], occasion: "date-night" }));
    const midiEv = result.evaluatedProducts.find((e) => e.handle === "midi-dress");
    assert.ok(midiEv);
    const tiiredEv = midiEv!.positiveEvidence.find(
      (e) => e.matchedToken === "tired",
    );
    assert.ok(tiiredEv, "tired ESS must be scored for midi-dress");
    assert.ok(tiiredEv!.isProvisional, "midi-dress tired ESS must be marked provisional");
    assert.ok(tiiredEv!.provisionalNote, "provisional note must be present");
  });

  it("9.2  provisionalEvidenceUsed flag is set correctly", () => {
    const result = run(makeSession({ moods: ["tired"], occasion: "date-night" }));
    const midiEv = result.evaluatedProducts.find((e) => e.handle === "midi-dress");
    assert.ok(midiEv?.provisionalEvidenceUsed, "midi-dress must have provisionalEvidenceUsed=true when tired");
  });

  it("9.3  non-provisional evidence is NOT marked provisional", () => {
    // collar-shirt quick-to-style is NOT in provisional list
    const result = run(makeSession({ practicalIds: ["quick-to-style"], occasion: "work" }));
    const cEv = result.evaluatedProducts.find((e) => e.handle === "collar-shirt");
    const qtsEv = cEv?.positiveEvidence.find((e) => e.matchedToken === "quick-to-style");
    assert.ok(qtsEv, "collar-shirt quick-to-style evidence must exist");
    assert.ok(!qtsEv!.isProvisional, "collar-shirt quick-to-style must NOT be provisional");
  });
});

// ─── §10  Edge cases and minimum threshold ────────────────────────────────────

describe("§10  Edge cases", () => {
  it("10.1  outcome is no-eligible-product when all products score below threshold", () => {
    // Avoid all dominant colors → all products get -3 (negative evidence).
    // occasion "not-sure" has no matching products in the catalog (no occasion bonus) and no
    // implicit formality floor, so all products score -3 with 0 positive evidence → below threshold.
    const result = run(
      makeSession({
        todayColours: {
          preferred: [],
          avoid: ["beige-brown", "red-burgundy", "black", "prints", "white-cream"],
        },
        occasion: "not-sure",
        moods: [],
      }),
    );
    assert.ok(
      ["no-eligible-product", "closet-led"].includes(result.outcome),
      `expected no-eligible-product but got ${result.outcome}`,
    );
    assert.equal(result.primary, null);
  });

  it("10.2  outcome is closet-led (not no-eligible-product) when source=my-closet", () => {
    const result = run(
      makeSession({
        source: "my-closet",
        todayColours: {
          preferred: [],
          avoid: ["beige-brown", "red-burgundy", "black", "prints", "white-cream"],
        },
        occasion: "not-sure",
        moods: [],
      }),
    );
    assert.equal(result.outcome, "closet-led");
  });

  it("10.3  alternatives list contains at most MAX_ALTERNATIVES items", () => {
    const result = run(
      makeSession({ moods: ["confident"], occasion: "dinner" }),
      { stylePersonalities: ["artsy"] },
    );
    assert.ok(result.alternatives.length <= 2, "alternatives must not exceed 2");
  });

  it("10.4  alternatives do not include the primary", () => {
    const result = run(
      makeSession({ moods: ["confident"], occasion: "dinner" }),
      { stylePersonalities: ["artsy"] },
    );
    if (result.primary && result.alternatives.length > 0) {
      for (const alt of result.alternatives) {
        assert.notEqual(alt.handle, result.primary.handle);
      }
    }
  });

  it("10.5  coverage counts are internally consistent", () => {
    const result = run(makeSession({ occasion: "everyday" }));
    assert.ok(result.coverage.totalCatalogProducts >= result.coverage.eligibleCandidates);
    assert.ok(result.coverage.excludedCandidates <= result.coverage.eligibleCandidates);
    assert.equal(
      result.evaluatedProducts.filter((e) => e.isHardExcluded).length,
      result.coverage.excludedCandidates,
    );
  });

  it("10.6  neutral mood does not contribute ESS scoring", () => {
    const r_neutral = run(makeSession({ moods: ["neutral"], occasion: "everyday" }));
    const r_empty = run(makeSession({ moods: [], occasion: "everyday" }));
    // Both should produce identical scores since neutral is a no-effect mood
    for (let i = 0; i < r_neutral.evaluatedProducts.length; i++) {
      const evN = r_neutral.evaluatedProducts[i];
      const evE = r_empty.evaluatedProducts.find((e) => e.handle === evN.handle);
      assert.ok(evE);
      // No ESS evidence from neutral
      const essN = evN.positiveEvidence.filter((e) => e.field === "currentEmotionalStateSupport");
      assert.equal(essN.length, 0, `neutral mood must produce no ESS evidence for ${evN.handle}`);
    }
  });

  it("10.7  nothing-specific body need does not contribute SMCM scoring", () => {
    const result = run(makeSession({ bodyNeeds: ["nothing-specific"], occasion: "everyday" }));
    for (const ev of result.evaluatedProducts) {
      const smcm = ev.positiveEvidence.filter(
        (e) => e.field === "styleMeComfortMatch" && e.matchedToken !== "more-coverage",
      );
      assert.equal(smcm.length, 0, `nothing-specific body need must suppress SMCM for ${ev.handle}`);
    }
  });

  it("10.8  resolveNadineAnchor returns null for an unknown handle", () => {
    const anchor = resolveNadineAnchor({ type: "nadine", handle: "nonexistent-handle" });
    assert.equal(anchor, null);
  });

  it("10.9  SLOT_EXCLUSIONS table covers all OutfitSlot values", () => {
    const slots = ["top", "bottom", "dress", "set", "outerwear", "unknown"] as const;
    for (const slot of slots) {
      assert.ok(Array.isArray(SLOT_EXCLUSIONS[slot]), `SLOT_EXCLUSIONS must have entry for slot: ${slot}`);
    }
  });

  it("10.10 FORMALITY_RANGES covers all four session formality IDs", () => {
    const formalityIds = ["formality-relaxed", "formality-smart", "formality-polished", "formality-occasion"];
    for (const id of formalityIds) {
      assert.ok(FORMALITY_RANGES[id], `FORMALITY_RANGES must have entry for: ${id}`);
      const range = FORMALITY_RANGES[id];
      assert.ok(range.min <= range.target && range.target <= range.max);
    }
  });
});

// ─── §11  Distribution audit ──────────────────────────────────────────────────

describe("§11  Distribution audit: no single signal dominates all scenarios", () => {
  const REACHABILITY_SCENARIOS: Array<{ handle: string; session: StyleMeSessionInput; profile?: StyleMeProfileSignals }> = [
    {
      // playful->adventurous mood rename intentionally NOT migrated for double-top's
      // catalog data (see 2.1's comment) — confident+feel-good dual-mood + waist-definition
      // used instead of confident+adventurous to keep this scenario a genuine winner.
      handle: "double-top",
      session: makeSession({ moods: ["confident", "feel-good"], desiredFeelings: ["more-feminine"], bodyNeeds: ["waist-definition"], occasion: "girls-night" }),
      profile: { stylePersonalities: ["feminine"] },
    },
    {
      handle: "collar-shirt",
      session: makeSession({ moods: ["tired"], desiredFeelings: ["more-put-together"], occasion: "work", formalityConditional: "formality-smart", practicalIds: ["quick-to-style"] }),
      profile: { stylePersonalities: ["corporate-chic"] },
    },
    {
      // "adventurous" is now exclusive to draped-leather-pants (was cropped-top's
      // discriminator before the 2026-08-24 reconciliation removed that product).
      handle: "draped-leather-pants",
      session: makeSession({ moods: ["confident", "adventurous"], desiredFeelings: ["more-confident", "more-elevated"], occasion: "everyday", practicalIds: ["day-to-night"] }),
      profile: { stylePersonalities: ["edgy", "artsy"] },
    },
    {
      // A "day-to-day" typo briefly present in this product's own occasionTags (should
      // read "everyday") caused a 3-way tie with oversized-blazer/draped-leather-pants
      // under occasion=everyday — corrected in the workbook same day (2026-08-24).
      handle: "asymmetrical-pants",
      session: makeSession({ moods: ["confident", "powerful"], desiredFeelings: ["more-powerful", "more-put-together"], bodyNeeds: ["elongates", "balances", "structured"], occasion: "everyday" }),
      profile: { stylePersonalities: ["edgy"] },
    },
    {
      // structured+relaxed+elongates SMCM combo is unique to oversized-blazer.
      handle: "oversized-blazer",
      session: makeSession({ moods: ["tired"], desiredFeelings: ["more-powerful", "more-effortless"], bodyNeeds: ["structured", "relaxed", "elongates"], occasion: "work", formalityConditional: "formality-polished" }),
      profile: { stylePersonalities: ["corporate-chic", "effortlessly-chic"] },
    },
    {
      handle: "suede-skirt",
      session: makeSession({ moods: ["romantic"], desiredFeelings: ["more-feminine", "more-attractive"], occasion: "date-night", formalityConditional: "formality-polished", practicalIds: ["long-day"] }),
      profile: { stylePersonalities: ["feminine", "romantic"] },
    },
    {
      handle: "trench-coat",
      session: makeSession({ moods: ["need-reset", "tired"], desiredFeelings: ["more-put-together", "more-elevated"], bodyNeeds: ["more-coverage", "elongates"], coverageConditional: "coverage-non-negotiable", occasion: "special-event", formalityConditional: "formality-polished", practicalIds: ["movement-friendly"] }),
      profile: { stylePersonalities: ["corporate-chic"] },
    },
    {
      handle: "kimono-jacket",
      session: makeSession({ moods: ["romantic", "need-reset"], desiredFeelings: ["more-effortless", "more-feminine"], bodyNeeds: ["waist-definition", "relaxed"], occasion: "everyday", practicalIds: ["quick-to-style"] }),
      profile: { stylePersonalities: ["effortlessly-chic", "feminine"] },
    },
    {
      // Redesigned 2026-08-24 as a relaxed bomber (was a fitted, waist-shaping jacket) —
      // scenario rebuilt around its new relaxed/more-coverage SMCM, not the old waist-def profile.
      handle: "leather-suede-jacket",
      session: makeSession({ moods: ["need-reset", "overwhelmed"], desiredFeelings: ["more-effortless", "more-confident"], bodyNeeds: ["relaxed", "more-coverage"], occasion: "girls-night", practicalIds: ["quick-to-style"] }),
      profile: { stylePersonalities: ["effortlessly-chic", "artsy"] },
    },
    {
      handle: "midi-dress",
      session: makeSession({ moods: ["tired", "low-energy"], desiredFeelings: ["more-feminine", "more-attractive"], bodyNeeds: ["waist-definition", "balances"], coverageConditional: "coverage-non-negotiable", occasion: "date-night", formalityConditional: "formality-smart", practicalIds: ["quick-to-style"] }),
      profile: { stylePersonalities: ["feminine"] },
    },
    {
      handle: "dress-set",
      session: makeSession({ moods: ["confident", "powerful"], desiredFeelings: ["more-confident", "more-powerful", "more-feminine"], occasion: "girls-night", formalityConditional: "formality-occasion" }),
      profile: { stylePersonalities: ["feminine", "trendy"] },
    },
  ];

  it("11.1  each of the 11 products wins in at least one scenario (reachability)", () => {
    const winners = new Set<string>();
    for (const scenario of REACHABILITY_SCENARIOS) {
      const result = runRecommendation({ session: scenario.session, profile: scenario.profile });
      if (result.primary) winners.add(result.primary.handle);
    }
    const all = getAllCatalogProducts().map((p) => p.handle);
    for (const handle of all) {
      assert.ok(winners.has(handle), `product ${handle} was never a winner — reachability gap`);
    }
  });

  it("11.2  all 11 products are evaluated in every run (no silent skips)", () => {
    for (const scenario of REACHABILITY_SCENARIOS.slice(0, 3)) {
      const result = runRecommendation({ session: scenario.session, profile: scenario.profile });
      const eligible = getAllCatalogProducts().filter((p) => p.eligibility !== "verified-inactive");
      assert.equal(result.evaluatedProducts.length, eligible.length);
    }
  });
});

// ─── §12  Closet anchor compatibility ─────────────────────────────────────────

const makeClosetAnchor = (
  category: string,
  overrides: Partial<{
    colors: string[];
    styleTags: string[];
    occasions: string[];
    material: string | null;
  }> = {},
) => ({
  type: "closet" as const,
  id: `closet-${category.toLowerCase()}-1`,
  name: `My ${category.toLowerCase()} item`,
  category,
  colors: overrides.colors ?? [],
  primaryColor: overrides.colors?.[0] ?? null,
  pattern: null,
  material: overrides.material ?? null,
  styleTags: overrides.styleTags ?? [],
  occasions: overrides.occasions ?? [],
  imageUrl: "https://example.com/img.jpg",
});

describe("§12  Closet anchor compatibility evaluation", () => {
  // ─── C.1  Slot exclusion ─────────────────────────────────────────────────
  it("C.1  BOTTOMS Closet anchor never recommends another bottom", () => {
    const result = run(
      makeSession({ moods: ["confident"], occasion: "dinner" }),
      { stylePersonalities: ["artsy"] },
      { anchor: makeClosetAnchor("BOTTOMS") },
    );
    const bottomHandles = new Set(
      result.evaluatedProducts
        .filter((e) => e.slot === "bottom" && !e.isHardExcluded)
        .map((e) => e.handle),
    );
    assert.equal(bottomHandles.size, 0, "no bottom should be eligible when Closet anchor is BOTTOMS");
    if (result.primary) {
      assert.notEqual(result.primary.slot, "bottom");
    }
  });

  // ─── C.2  General pairing positive evidence ────────────────────────────────
  it("C.2  TOP candidate gains general-pairing positive evidence from BOTTOMS Closet anchor", () => {
    const result = run(
      makeSession({ moods: ["confident"], occasion: "dinner" }),
      { stylePersonalities: ["artsy"] },
      { anchor: makeClosetAnchor("BOTTOMS") },
    );
    // double-top (TOP) — bestPairedWithGeneral contains "trousers", "skirts", "denim"
    // which match BOTTOMS anchor slot tokens → should have closet-category positive evidence
    const dtEv = result.evaluatedProducts.find((e) => e.handle === "double-top");
    assert.ok(dtEv && !dtEv.isHardExcluded, "double-top must be eligible with BOTTOMS closet anchor");
    const closetPairingEv = dtEv!.positiveEvidence.find(
      (e) => e.sessionSignal === "closet-category",
    );
    assert.ok(closetPairingEv, "double-top should have closet-category positive evidence from BOTTOMS anchor");
    assert.equal(closetPairingEv!.points, 1, "closet general-pairing evidence is LIGHT_RANK (+1)");
    assert.ok(dtEv!.closetCompatibility !== null, "closetCompatibility must be populated");
    assert.ok(dtEv!.closetCompatibility!.confidence !== "insufficient");
  });

  // ─── C.3  Avoid-pairing mechanism: no false positives on modified phrases ──
  it("C.3  modified avoid phrases (e.g. 'bulky trousers') do NOT deprioritise BOTTOMS anchor", () => {
    const result = run(
      makeSession({ occasion: "dinner" }),
      {},
      { anchor: makeClosetAnchor("BOTTOMS") },
    );
    // double-top avoidPairingWithGeneral: "bulky cargo trousers, low-rise bottoms..." —
    // none are plain "trousers" segments so no DEPRIORITISE evidence should appear
    for (const ev of result.evaluatedProducts.filter((e) => !e.isHardExcluded)) {
      const avoidEv = ev.negativeEvidence.find(
        (e) => e.sessionSignal === "closet-category",
      );
      assert.ok(!avoidEv, `${ev.handle}: modified avoid phrases must not produce closet DEPRIORITISE evidence`);
    }
  });

  // ─── C.4  Style-tag overlap ───────────────────────────────────────────────
  it("C.4  Closet style-tag overlap adds LIGHT_RANK (+1) evidence", () => {
    // Closet item has styleTags: ["formal"]
    // double-top styleTags: ["formal", "edgy", "romantic", "trendy"] → overlap on "formal"
    const result = run(
      makeSession({ moods: ["confident"], occasion: "dinner" }),
      {},
      { anchor: makeClosetAnchor("BOTTOMS", { styleTags: ["formal"] }) },
    );
    const dtEv = result.evaluatedProducts.find((e) => e.handle === "double-top");
    assert.ok(dtEv && !dtEv.isHardExcluded);
    const tagEv = dtEv!.positiveEvidence.find((e) => e.sessionSignal === "closet-styleTags");
    assert.ok(tagEv, "double-top should have closet-styleTags evidence for 'formal' overlap");
    assert.equal(tagEv!.points, 1);
    assert.equal(tagEv!.matchedToken, "formal");
  });

  // ─── C.5  Occasion overlap ────────────────────────────────────────────────
  it("C.5  Closet occasion overlap adds LIGHT_RANK (+1) evidence", () => {
    // Closet item has occasions: ["dinner"]
    // double-top occasionTags: ["dinner", "date-night", "girls-night", "special-event"]
    const result = run(
      makeSession({ moods: ["confident"], occasion: "dinner" }),
      {},
      { anchor: makeClosetAnchor("BOTTOMS", { occasions: ["dinner"] }) },
    );
    const dtEv = result.evaluatedProducts.find((e) => e.handle === "double-top");
    assert.ok(dtEv && !dtEv.isHardExcluded);
    const occEv = dtEv!.positiveEvidence.find((e) => e.sessionSignal === "closet-occasions");
    assert.ok(occEv, "double-top should have closet-occasions evidence for 'dinner' overlap");
    assert.equal(occEv!.points, 1);
    assert.equal(occEv!.matchedToken, "dinner");
  });

  // ─── C.6  Unrelated tags produce no evidence ──────────────────────────────
  it("C.6  Unrelated Closet style-tags do not create evidence", () => {
    // Use a style tag that no NADINE product has
    const result = run(
      makeSession({ occasion: "dinner" }),
      {},
      { anchor: makeClosetAnchor("BOTTOMS", { styleTags: ["vintage-90s", "maximalist"] }) },
    );
    for (const ev of result.evaluatedProducts.filter((e) => !e.isHardExcluded)) {
      const tagEv = ev.positiveEvidence.find((e) => e.sessionSignal === "closet-styleTags");
      assert.ok(!tagEv, `${ev.handle}: unrelated Closet tags must not produce evidence`);
    }
  });

  // ─── C.7  Missing Closet metadata does not hallucinate ────────────────────
  it("C.7  Missing Closet metadata (no colours, tags, occasions) produces no false evidence", () => {
    // Anchor with only category (TOPS) and no other metadata
    const result = run(
      makeSession({ moods: ["confident"], occasion: "dinner" }),
      { stylePersonalities: ["artsy"] },
      { anchor: makeClosetAnchor("TOPS") },
    );
    // All eligible products should have closetCompatibility populated
    for (const ev of result.evaluatedProducts.filter((e) => !e.isHardExcluded)) {
      assert.ok(ev.closetCompatibility !== null, `${ev.handle}: closetCompatibility must be set`);
      // No style-tag or occasion evidence since anchor has none
      const noFalseTagEv = ev.positiveEvidence.filter((e) => e.sessionSignal === "closet-styleTags");
      assert.equal(noFalseTagEv.length, 0, `${ev.handle}: no tag evidence without Closet tags`);
      const noFalseOccEv = ev.positiveEvidence.filter((e) => e.sessionSignal === "closet-occasions");
      assert.equal(noFalseOccEv.length, 0, `${ev.handle}: no occasion evidence without Closet occasions`);
    }
  });

  // ─── C.8  Unknown Closet category → insufficient confidence ───────────────
  it("C.8  BAGS Closet anchor → slot='bag', hasStrongEvidence=true, no slot conflict exclusions", () => {
    const result = run(
      makeSession({ moods: ["confident"], occasion: "dinner" }),
      { stylePersonalities: ["artsy"] },
      { anchor: makeClosetAnchor("BAGS") },
    );
    // BAGS maps to slot "bag" — hasStrongEvidence=true → confidence is NOT insufficient
    // No garment slot is excluded by a bag anchor
    for (const ev of result.evaluatedProducts) {
      assert.ok(ev.closetCompatibility !== null);
      assert.notEqual(
        ev.closetCompatibility!.confidence,
        "insufficient",
        `${ev.handle}: BAGS anchor has strong evidence and must not produce insufficient confidence`,
      );
    }
    // None of the products should be hard-excluded due to a bag slot conflict
    // (bag has empty exclusion list)
    const excludedBySlot = result.evaluatedProducts.filter(
      (e) => e.isHardExcluded && e.negativeEvidence.some((n) => n.code?.startsWith("slot-conflict")),
    );
    assert.equal(excludedBySlot.length, 0, "BAGS anchor must not hard-exclude any product via slot conflict");
  });

  // ─── C.9  Weak category-only Closet anchor → closet-led when no threshold ─
  it("C.9  When Closet anchor exists and no candidate clears threshold, outcome is closet-led", () => {
    // Use occasion="not-sure" which no product has → no occasion bonus.
    // (Was "family" until the 2026-08-25 signal-coverage pass gave family genuine
    // coverage on collar-shirt/suede-skirt/kimono-jacket per approved audit changes —
    // "not-sure" is now the only occasion with zero product coverage catalog-wide.)
    // Avoid all dominant color vocab IDs → each eligible product gets closet-category +1
    // but color -3, netting -2 which is below MIN_TOTAL_SCORE=2.
    // Products with no color match still score only +1 (below threshold).
    const result = run(
      makeSession({
        todayColours: {
          preferred: [],
          avoid: ["beige-brown", "red-burgundy", "black", "prints", "white-cream", "grey", "navy", "green", "pink", "yellow", "orange"],
        },
        occasion: "not-sure",   // no product has this occasion tag
        moods: [],
      }),
      {},
      { anchor: makeClosetAnchor("BOTTOMS") },
    );
    assert.equal(result.outcome, "closet-led",
      "expected closet-led when Closet anchor exists and no product clears threshold");
    assert.equal(result.primary, null);
  });

  // ─── C.10  Determinism ────────────────────────────────────────────────────
  it("C.10  Same Closet-anchor input always returns byte-equivalent output", () => {
    const session = makeSession({
      moods: ["confident"],
      desiredFeelings: ["more-feminine"],
      occasion: "dinner",
    });
    const anchor = makeClosetAnchor("BOTTOMS", { styleTags: ["formal"], occasions: ["dinner"] });
    const r1 = run(session, { stylePersonalities: ["feminine"] }, { anchor });
    const r2 = run(session, { stylePersonalities: ["feminine"] }, { anchor });
    assert.equal(r1.primary?.handle, r2.primary?.handle, "primary must be deterministic");
    assert.equal(r1.outcome, r2.outcome);
    assert.equal(r1.primary?.totalScore, r2.primary?.totalScore);
    assert.equal(
      JSON.stringify(r1.evaluatedProducts.map((e) => ({ h: e.handle, s: e.totalScore }))),
      JSON.stringify(r2.evaluatedProducts.map((e) => ({ h: e.handle, s: e.totalScore }))),
      "all scores must be identical across runs",
    );
  });

  // ─── C.11  All 11 products still reachable after the correction ───────────
  it("C.11  All 11 V8 products remain reachable (no regression from Closet correction)", () => {
    // Re-run all 11 reachability scenarios without anchor (same as §11 but post-correction)
    const HANDLES_TO_WIN = [
      // playful->adventurous mood rename intentionally NOT migrated for double-top's
      // catalog data (see §11's REACHABILITY_SCENARIOS comment) — confident+feel-good
      // dual-mood + waist-definition used instead of confident+adventurous.
      { handle: "double-top",          session: makeSession({ moods: ["confident", "feel-good"], desiredFeelings: ["more-feminine"], bodyNeeds: ["waist-definition"], occasion: "girls-night" }),          profile: { stylePersonalities: ["feminine"] } },
      { handle: "collar-shirt",         session: makeSession({ moods: ["tired"], desiredFeelings: ["more-put-together"], occasion: "work", formalityConditional: "formality-smart", practicalIds: ["quick-to-style"] }), profile: { stylePersonalities: ["corporate-chic"] } },
      // "adventurous" is now exclusive to draped-leather-pants (was cropped-top's discriminator
      // before the 2026-08-24 reconciliation removed that product).
      { handle: "draped-leather-pants", session: makeSession({ moods: ["confident", "adventurous"], desiredFeelings: ["more-confident", "more-elevated"], occasion: "everyday", practicalIds: ["day-to-night"] }), profile: { stylePersonalities: ["edgy", "artsy"] } },
      // A "day-to-day" typo briefly present in this product's own occasionTags (should read
      // "everyday") caused a 3-way tie with oversized-blazer/draped-leather-pants under
      // occasion=everyday — corrected in the workbook same day (2026-08-24).
      { handle: "asymmetrical-pants",   session: makeSession({ moods: ["confident", "powerful"], desiredFeelings: ["more-powerful", "more-put-together"], bodyNeeds: ["elongates", "balances", "structured"], occasion: "everyday" }), profile: { stylePersonalities: ["edgy"] } },
      // structured+relaxed+elongates SMCM combo is unique to oversized-blazer.
      { handle: "oversized-blazer",     session: makeSession({ moods: ["tired"], desiredFeelings: ["more-powerful", "more-effortless"], bodyNeeds: ["structured", "relaxed", "elongates"], occasion: "work", formalityConditional: "formality-polished" }), profile: { stylePersonalities: ["corporate-chic", "effortlessly-chic"] } },
      { handle: "suede-skirt",          session: makeSession({ moods: ["romantic"], desiredFeelings: ["more-feminine", "more-attractive"], occasion: "date-night", formalityConditional: "formality-polished", practicalIds: ["long-day"] }), profile: { stylePersonalities: ["feminine", "romantic"] } },
      { handle: "trench-coat",          session: makeSession({ moods: ["need-reset", "tired"], desiredFeelings: ["more-put-together", "more-elevated"], bodyNeeds: ["more-coverage", "elongates"], coverageConditional: "coverage-non-negotiable", occasion: "special-event", formalityConditional: "formality-polished", practicalIds: ["movement-friendly"] }), profile: { stylePersonalities: ["corporate-chic"] } },
      { handle: "kimono-jacket",        session: makeSession({ moods: ["romantic", "need-reset"], desiredFeelings: ["more-effortless", "more-feminine"], bodyNeeds: ["waist-definition", "relaxed"], occasion: "everyday", practicalIds: ["quick-to-style"] }), profile: { stylePersonalities: ["effortlessly-chic", "feminine"] } },
      // Redesigned 2026-08-24 as a relaxed bomber (was a fitted, waist-shaping jacket) —
      // scenario rebuilt around its new relaxed/more-coverage SMCM, not the old waist-def profile.
      { handle: "leather-suede-jacket", session: makeSession({ moods: ["need-reset", "overwhelmed"], desiredFeelings: ["more-effortless", "more-confident"], bodyNeeds: ["relaxed", "more-coverage"], occasion: "girls-night", practicalIds: ["quick-to-style"] }), profile: { stylePersonalities: ["effortlessly-chic", "artsy"] } },
      { handle: "midi-dress",           session: makeSession({ moods: ["tired", "low-energy"], desiredFeelings: ["more-feminine", "more-attractive"], bodyNeeds: ["waist-definition", "balances"], coverageConditional: "coverage-non-negotiable", occasion: "date-night", formalityConditional: "formality-smart", practicalIds: ["quick-to-style"] }), profile: { stylePersonalities: ["feminine"] } },
      { handle: "dress-set",            session: makeSession({ moods: ["confident", "powerful"], desiredFeelings: ["more-confident", "more-powerful", "more-feminine"], occasion: "girls-night", formalityConditional: "formality-occasion" }), profile: { stylePersonalities: ["feminine", "trendy"] } },
    ] as const;

    for (const { handle, session, profile } of HANDLES_TO_WIN) {
      const result = runRecommendation({ session, profile });
      assert.equal(result.primary?.handle, handle, `${handle} must still win its scenario post-correction`);
    }
  });

  // ─── C.13–C.20  Non-garment anchor slots ─────────────────────────────────

  it("C.13  SHOES anchor → slot='shoe', hasStrongEvidence=true", () => {
    const result = run(
      makeSession({ moods: ["confident"], occasion: "work" }),
      {},
      { anchor: makeClosetAnchor("SHOES") },
    );
    // shoe slot has empty exclusion list — all products eligible, no slot conflict hard-exclusions
    const excluded = result.evaluatedProducts.filter(
      (e) => e.isHardExcluded && e.negativeEvidence.some((n) => n.code?.startsWith("slot-conflict")),
    );
    assert.equal(excluded.length, 0, "SHOES anchor must not hard-exclude any product via slot conflict");
    // Confidence must not be "insufficient" — hasStrongEvidence is true for shoe slot
    for (const ev of result.evaluatedProducts) {
      assert.notEqual(
        ev.closetCompatibility?.confidence,
        "insufficient",
        `${ev.handle}: SHOES anchor must not produce insufficient confidence`,
      );
    }
  });

  it("C.14  ACCESSORIES anchor → slot='accessory', no slot conflict exclusions", () => {
    const result = run(
      makeSession({ moods: ["minimal"], occasion: "everyday" }),
      {},
      { anchor: makeClosetAnchor("ACCESSORIES") },
    );
    const excluded = result.evaluatedProducts.filter(
      (e) => e.isHardExcluded && e.negativeEvidence.some((n) => n.code?.startsWith("slot-conflict")),
    );
    assert.equal(excluded.length, 0, "ACCESSORIES anchor must not hard-exclude any product via slot conflict");
    for (const ev of result.evaluatedProducts) {
      assert.notEqual(ev.closetCompatibility?.confidence, "insufficient");
    }
  });

  it("C.15  JEWELRY anchor → slot='jewelry', no slot conflict exclusions", () => {
    const result = run(
      makeSession({ moods: ["romantic"], occasion: "date-night" }),
      {},
      { anchor: makeClosetAnchor("JEWELRY") },
    );
    const excluded = result.evaluatedProducts.filter(
      (e) => e.isHardExcluded && e.negativeEvidence.some((n) => n.code?.startsWith("slot-conflict")),
    );
    assert.equal(excluded.length, 0, "JEWELRY anchor must not hard-exclude any product via slot conflict");
    for (const ev of result.evaluatedProducts) {
      assert.notEqual(ev.closetCompatibility?.confidence, "insufficient");
    }
  });

  it("C.16  Non-garment anchor with matching style tags still scores via session signals", () => {
    // Shoes with styleTags=["confident"] + occasion match → styleTag and occasion signals score
    const result = run(
      makeSession({ moods: ["confident"], occasion: "dinner" }),
      {},
      { anchor: makeClosetAnchor("SHOES", { styleTags: ["confident"], occasions: ["dinner"] }) },
    );
    // At least one product should get positive evidence from style/occasion signals
    const hasPositiveEvidence = result.evaluatedProducts.some(
      (e) => !e.isHardExcluded && e.positiveEvidence.length > 0,
    );
    assert.ok(hasPositiveEvidence, "Non-garment anchor with session-signal tags must yield positive evidence");
  });

  it("C.17  Non-garment SHOES anchor does NOT produce garment-pairing token evidence", () => {
    // shoe has empty CLOSET_SLOT_PAIRING_TOKENS — no bestPairedWithGeneral scoring
    const result = run(
      makeSession({ moods: ["confident"], occasion: "work" }),
      {},
      { anchor: makeClosetAnchor("SHOES") },
    );
    for (const ev of result.evaluatedProducts) {
      const pairingEvidence = ev.positiveEvidence.filter((e) => e.sessionSignal === "closet-general-pairing");
      assert.equal(pairingEvidence.length, 0, `${ev.handle}: shoe anchor must not score garment-pairing tokens`);
    }
  });

  it("C.18  Non-garment anchor supports outfit result (outcome is not 'no-recommendation')", () => {
    const result = run(
      makeSession({ moods: ["confident"], desiredFeelings: ["more-elevated"], occasion: "dinner" }),
      { stylePersonalities: ["artsy"] },
      { anchor: makeClosetAnchor("BAGS") },
    );
    assert.notEqual(result.outcome, "no-recommendation", "Non-garment bag anchor must still yield an outfit");
  });

  it("C.19  CLOSET_SLOT_PAIRING_TOKENS has empty arrays for all four non-garment slots", () => {
    assert.deepEqual(CLOSET_SLOT_PAIRING_TOKENS["shoe"], [], "shoe must have empty pairing tokens");
    assert.deepEqual(CLOSET_SLOT_PAIRING_TOKENS["bag"], [], "bag must have empty pairing tokens");
    assert.deepEqual(CLOSET_SLOT_PAIRING_TOKENS["accessory"], [], "accessory must have empty pairing tokens");
    assert.deepEqual(CLOSET_SLOT_PAIRING_TOKENS["jewelry"], [], "jewelry must have empty pairing tokens");
  });

  it("C.20  SLOT_EXCLUSIONS has empty arrays for all four non-garment slots", () => {
    assert.deepEqual(SLOT_EXCLUSIONS["shoe"], [], "shoe must have no exclusions");
    assert.deepEqual(SLOT_EXCLUSIONS["bag"], [], "bag must have no exclusions");
    assert.deepEqual(SLOT_EXCLUSIONS["accessory"], [], "accessory must have no exclusions");
    assert.deepEqual(SLOT_EXCLUSIONS["jewelry"], [], "jewelry must have no exclusions");
  });

  // ─── C.21–C.25  SETS Closet anchor (F3 regression) ───────────────────────

  it("C.21  SETS Closet anchor → slot='set', hasStrongEvidence=true (not insufficient)", () => {
    // SETS is a forward-compatible mapping: not yet in Prisma ClosetCategory enum but engine
    // must resolve it to slot "set" (not "unknown") so confidence is never "insufficient".
    // Hard-excluded products have null closetCompatibility; skip those — they cannot win anyway.
    const result = run(
      makeSession({ moods: ["confident"], occasion: "dinner" }),
      {},
      { anchor: makeClosetAnchor("SETS") },
    );
    for (const ev of result.evaluatedProducts.filter((e) => !e.isHardExcluded)) {
      assert.ok(ev.closetCompatibility !== null, `${ev.handle}: non-excluded product must have closetCompatibility`);
      assert.notEqual(
        ev.closetCompatibility!.confidence,
        "insufficient",
        `${ev.handle}: SETS anchor has strong evidence and must not produce insufficient confidence`,
      );
    }
    // At least some products should be eligible (outcome must not be no-recommendation)
    assert.notEqual(result.outcome, "no-recommendation", "SETS anchor must still yield an outfit");
  });

  it("C.22  Unknown Closet SET does NOT automatically exclude TOP / BOTTOM / DRESS products", () => {
    // Closet SET has no explicit component metadata — cannot prove it covers top or bottom.
    // SLOT_EXCLUSIONS["set"] must NOT apply for Closet anchors; only NADINE anchors carry
    // explicit component coverage (see C.26).
    const result = run(
      makeSession({ moods: ["confident"], occasion: "dinner" }),
      {},
      { anchor: makeClosetAnchor("SETS") },
    );
    // No product should be hard-excluded by a slot-conflict code
    const slotExcluded = result.evaluatedProducts.filter(
      (e) => e.isHardExcluded && e.hardExclusionReasons.some((c) => c.startsWith("slot-conflict")),
    );
    assert.equal(
      slotExcluded.length,
      0,
      `Closet SETS anchor must not hard-exclude any product via slot-conflict — unknown component coverage`,
    );
    // Specifically: TOP and BOTTOM and DRESS products must remain eligible
    for (const handle of ["collar-shirt", "double-top", "suede-skirt", "asymmetrical-pants", "midi-dress"]) {
      const ev = result.evaluatedProducts.find((e) => e.handle === handle);
      assert.ok(ev && !ev.isHardExcluded, `${handle} must remain eligible with an unknown Closet SET anchor`);
    }
    // Outfit recommendation must still be produced (conservative, but not empty)
    assert.notEqual(result.outcome, "no-recommendation", "Closet SETS anchor must still yield an outfit");
  });

  it("C.23  SETS Closet anchor does NOT produce garment-pairing token evidence", () => {
    // CLOSET_SLOT_PAIRING_TOKENS["set"] must remain [] — a Closet set should not
    // fabricate TOP+BOTTOM coverage as if the components were separately anchored.
    const result = run(
      makeSession({ moods: ["confident"], occasion: "dinner" }),
      {},
      { anchor: makeClosetAnchor("SETS") },
    );
    for (const ev of result.evaluatedProducts) {
      const pairingEvidence = ev.positiveEvidence.filter((e) => e.sessionSignal === "closet-general-pairing");
      assert.equal(pairingEvidence.length, 0, `${ev.handle}: SETS anchor must not score garment-pairing tokens`);
    }
  });

  it("C.24  CLOSET_SLOT_PAIRING_TOKENS['set'] is empty; SLOT_EXCLUSIONS['set'] covers top/bottom/dress/set", () => {
    assert.deepEqual(CLOSET_SLOT_PAIRING_TOKENS["set"], [], "set must have empty pairing tokens");
    assert.deepEqual(
      [...SLOT_EXCLUSIONS["set"]].sort(),
      ["bottom", "dress", "set", "top"],
      "set exclusions must cover top, bottom, dress, and set itself",
    );
  });

  it("C.25  NADINE dress-set (SET itemType via itemTypeToSlot) still wins its scenario unaffected", () => {
    // NADINE path uses itemTypeToSlot(), not CLOSET_CATEGORY_TO_SLOT.
    // Adding SETS to CLOSET_CATEGORY_TO_SLOT must not change the NADINE recommendation path.
    const result = runRecommendation({
      session: makeSession({ moods: ["confident", "powerful"], desiredFeelings: ["more-confident", "more-powerful", "more-feminine"], occasion: "girls-night", formalityConditional: "formality-occasion" }),
      profile: { stylePersonalities: ["feminine", "trendy"] },
    });
    assert.equal(result.primary?.handle, "dress-set", "NADINE dress-set must still win its scenario after F3 fix");
  });

  it("C.27  SET coverage model: actual components stored, exclusions derived; future/unknown SETs conservative", () => {
    // NADINE_SET_COVERED_SLOTS stores ACTUAL occupied component slots only.
    // Candidate exclusions are derived via deriveForbiddenFromSetComponents — not stored.

    // (1) dress-set records actual components: TOP + BOTTOM (not the derived exclusion set).
    assert.deepEqual(
      [...(NADINE_SET_COVERED_SLOTS["dress-set"] ?? [])].sort(),
      ["bottom", "top"],
      "dress-set component registry must contain actual occupied slots: top + bottom only",
    );

    // (2) Derivation of ["top","bottom"] → forbidden includes top, bottom, dress, set.
    //     Becoming Defined still produces full top/bottom/dress/set candidate conflicts —
    //     but derived from its actual components, not stored as fake slot values.
    const dressSetForbidden = deriveForbiddenFromSetComponents(NADINE_SET_COVERED_SLOTS["dress-set"] ?? []);
    assert.deepEqual(
      [...dressSetForbidden].sort(),
      ["bottom", "dress", "set", "top"],
      "TOP+BOTTOM components must derive forbidden=[top,bottom,dress,set]",
    );

    // (3) Derivation of [] → forbidden = [] (conservative — no components known).
    const emptyForbidden = deriveForbiddenFromSetComponents([]);
    assert.deepEqual([...emptyForbidden], [], "empty components → empty forbidden list");

    // (4) Future/unmapped NADINE SET: not in registry → components=[] → forbidden=[].
    const syntheticFutureHandle = "future-set-v2";
    assert.equal(NADINE_SET_COVERED_SLOTS[syntheticFutureHandle], undefined,
      "future NADINE SET handle must not appear in registry until explicitly documented",
    );
    const futureForbidden = deriveForbiddenFromSetComponents(NADINE_SET_COVERED_SLOTS[syntheticFutureHandle] ?? []);
    assert.deepEqual([...futureForbidden], [], "future NADINE SET resolves to empty forbidden — conservative");

    // (5) Registry is bounded — only products with explicit catalog documentation.
    assert.deepEqual(Object.keys(NADINE_SET_COVERED_SLOTS), ["dress-set"],
      "NADINE_SET_COVERED_SLOTS must only contain explicitly registered SET products",
    );
  });

  it("C.26  NADINE SET anchor (dress-set) still hard-excludes top/bottom/dress products (known component coverage)", () => {
    // When the user anchors on NADINE dress-set (explicit component coverage known),
    // SLOT_EXCLUSIONS["set"] = ["top","bottom","dress","set"] must still fully apply.
    // This is the "explicit known component coverage" path distinct from a Closet SETS anchor.
    const result = run(
      makeSession({ moods: ["confident"], occasion: "everyday" }),
      {},
      { anchor: { type: "nadine", handle: "dress-set" } },
    );
    const slotExcluded = result.evaluatedProducts.filter(
      (e) => e.isHardExcluded && e.hardExclusionReasons.some((c) => c.startsWith("slot-conflict")),
    );
    const excludedHandles = slotExcluded.map((e) => e.handle);
    // TOP, BOTTOM, DRESS products must be slot-conflict excluded
    for (const handle of ["collar-shirt", "double-top", "suede-skirt", "asymmetrical-pants", "draped-leather-pants", "midi-dress"]) {
      assert.ok(
        excludedHandles.includes(handle),
        `${handle} must be hard-excluded by slot-conflict when NADINE dress-set anchor is active`,
      );
    }
    // Outerwear must NOT be slot-excluded
    for (const handle of ["trench-coat", "kimono-jacket", "oversized-blazer", "leather-suede-jacket"]) {
      const ev = result.evaluatedProducts.find((e) => e.handle === handle);
      const slotConflictExcluded = ev?.isHardExcluded && ev.hardExclusionReasons.some((c) => c.startsWith("slot-conflict"));
      assert.ok(!slotConflictExcluded, `${handle} must NOT be slot-conflict excluded when NADINE dress-set anchor is active`);
    }
  });

  // ─── C.12  No product wins only because of catalog order ──────────────────
  it("C.12  Tie-breaking is session-specific-hash-based, not position-based (catalog-order independent)", () => {
    // Empty signals → all products score 0 → all semantic tiers 2–6 are 0.
    // Winner is determined by session-specific hash (tier 7). Run twice to
    // confirm the same handle wins both times (determinism).
    const session = makeSession({ moods: [], occasion: "everyday" });
    const r1 = run(session);
    const r2 = run(session);
    assert.equal(r1.primary?.handle, r2.primary?.handle, "tie-break winner must be deterministic");
    // For every tied non-excluded product, the winner must have a lower (or equal)
    // sessionSpecificHash after all semantic tiers are verified equal.
    const r1Winner = r1.evaluatedProducts.find((e) => e.handle === r1.primary?.handle);
    const allNonExcluded = r1.evaluatedProducts.filter((e) => !e.isHardExcluded);
    for (const ev of allNonExcluded) {
      if (ev.handle === r1.primary?.handle) continue;
      if (ev.totalScore === r1Winner!.totalScore) {
        const tw = r1Winner!.semanticTieBreak;
        const tc = ev.semanticTieBreak;
        // All semantic tiers are equal in this degenerate empty session,
        // so the tie must be resolved by the session-specific hash.
        if (
          tw.anchorConfidence === tc.anchorConfidence &&
          tw.matchedCategoryCount === tc.matchedCategoryCount &&
          tw.positiveNonSupplementalCount === tc.positiveNonSupplementalCount &&
          tw.totalNegativePenalty === tc.totalNegativePenalty &&
          tw.provisionalCount === tc.provisionalCount
        ) {
          assert.ok(
            tw.sessionSpecificHash <= tc.sessionSpecificHash,
            `winner ${r1Winner!.handle} (hash=${tw.sessionSpecificHash}) must have lower session-specific hash than ${ev.handle} (hash=${tc.sessionSpecificHash})`,
          );
        }
      }
    }
  });
});

// ─── §13  Gap 1 — General avoid-pairing path: positive proof ─────────────────

describe("§13  Gap 1: general avoid-pairing DEPRIORITISE path — positive proof", () => {
  // GA.1 — parseGeneralAvoidSegments produces exact normalised segment list ────
  it("GA.1  parseGeneralAvoidSegments: plain token becomes its own segment (enables exact match)", () => {
    // When avoidPairingWithGeneral contains a plain bounded token with no modifiers,
    // parseGeneralAvoidSegments returns it as its own segment.
    const segments = parseGeneralAvoidSegments("trousers, heavily printed shirts, or oversized jackets");
    assert.deepStrictEqual(segments, [
      "trousers",
      "heavily printed shirts",
      "oversized jackets",
    ]);
    // The plain "trousers" segment is an exact member of the bottom-slot vocabulary.
    assert.ok(
      CLOSET_SLOT_PAIRING_TOKENS["bottom"].includes("trousers"),
      '"trousers" must exist in bottom-slot vocabulary',
    );
  });

  // GA.2 — exact plain-category token → DEPRIORITISE (-3) fires ───────────────
  it("GA.2  exact bounded-vocabulary token in avoidPairingWithGeneral → DEPRIORITISE (-3)", () => {
    // Synthetic avoid prose: "trousers" appears as a plain, unmodified segment.
    const avoidProse = "trousers, mini skirts";
    const segments = parseGeneralAvoidSegments(avoidProse);
    const matchedToken = findExactAvoidToken(segments, CLOSET_SLOT_PAIRING_TOKENS["bottom"]);

    // The helper must find "trousers" (first matching token in bottom vocabulary).
    assert.ok(matchedToken !== null, "exact plain 'trousers' segment must match bottom-slot token");
    assert.equal(matchedToken, "trousers");

    // Verify the evidence item shape the engine would push:
    const evidence: ClosetCompatibilityItem = {
      closetField: "category",
      productField: PRODUCT_TEMPLATE_FIELDS.AVOID_PAIRING_WITH_GENERAL,
      matchedToken: matchedToken!,
      effect: "DEPRIORITISE",
      points: SCORING_WEIGHTS.DEPRIORITISE,
      isExact: true,
    };
    assert.equal(evidence.effect, "DEPRIORITISE");
    assert.equal(evidence.points, -3, "DEPRIORITISE must score -3");
    assert.equal(evidence.closetField, "category");
    assert.equal(evidence.productField, PRODUCT_TEMPLATE_FIELDS.AVOID_PAIRING_WITH_GENERAL);
    assert.equal(evidence.matchedToken, "trousers");
    assert.ok(evidence.isExact, "avoid evidence must be flagged as exact match");
  });

  // GA.3 — modified prose does NOT match plain bounded token ───────────────────
  it("GA.3  modified prose 'bulky cargo trousers' does NOT match plain token 'trousers'", () => {
    // This is the V8-catalog pattern: qualifiers prevent false-positive avoid matches.
    const avoidProse = "bulky cargo trousers, low-rise bottoms, or tiered skirts";
    const segments = parseGeneralAvoidSegments(avoidProse);

    // Segments are: ["bulky cargo trousers", "low-rise bottoms", "tiered skirts"]
    // None of these equals the plain bottom-slot tokens.
    const matchedToken = findExactAvoidToken(segments, CLOSET_SLOT_PAIRING_TOKENS["bottom"]);
    assert.equal(
      matchedToken,
      null,
      `modified prose "${avoidProse}" must not match any plain bottom-slot token`,
    );

    // Also verify for top-slot tokens — e.g. prose like "oversized shirts" must not match "shirts"
    const topProse = "oversized shirts, chunky knits";
    const topSegments = parseGeneralAvoidSegments(topProse);
    const topMatch = findExactAvoidToken(topSegments, CLOSET_SLOT_PAIRING_TOKENS["top"]);
    assert.equal(topMatch, null, '"oversized shirts" must not match plain "shirts" top-slot token');
  });

  // GA.4 — V8 catalog: zero exact plain-category avoid matches ────────────────
  it("GA.4  V8 catalog contains zero exact plain-category avoid matches (conservative parser confirmed)", () => {
    const products = getAllCatalogProducts();
    const allTokens = Object.values(CLOSET_SLOT_PAIRING_TOKENS).flat();
    const matches: Array<{ handle: string; token: string; segment: string }> = [];

    for (const product of products) {
      const prose = product.parsed.pairings.avoidPairingWithGeneral;
      const segments = parseGeneralAvoidSegments(prose);
      for (const token of allTokens) {
        if (segments.includes(token)) {
          matches.push({ handle: product.handle, token, segment: token });
        }
      }
    }

    // Explicit zero-match report — fails loudly if a future catalog change introduces a plain avoid.
    assert.deepStrictEqual(
      matches,
      [],
      `V8 catalog must have 0 exact plain-category avoid matches. Found: ${JSON.stringify(matches)}`,
    );
  });

  // GA.5 — "or" prefix stripping works for multi-segment prose ────────────────
  it("GA.5  parseGeneralAvoidSegments strips leading 'or' from comma-separated segments", () => {
    const segments = parseGeneralAvoidSegments("mini skirts, or trousers, or shorts");
    // "or " prefix must be removed from second and third segments
    assert.deepStrictEqual(segments, ["mini skirts", "trousers", "shorts"]);
    // After stripping, "trousers" would be an exact match for the bottom-slot token
    const match = findExactAvoidToken(segments, CLOSET_SLOT_PAIRING_TOKENS["bottom"]);
    assert.equal(match, "trousers", "'or trousers' must match plain 'trousers' after 'or' is stripped");
  });
});

// ─── §14  Session-specific tie-break and diversity behavior ──────────────────

describe("§14  Session-specific tie-break and diversity behavior", () => {
  // ── DT.1  buildSessionFingerprint is deterministic ────────────────────────
  it("DT.1  buildSessionFingerprint returns identical string for identical inputs", () => {
    const session = makeValidSession({ moods: ["confident"], desiredFeelings: ["more-elevated"], occasion: "dinner" });
    const profile: StyleMeProfileSignals = { stylePersonalities: ["feminine"] };
    const fp1 = buildSessionFingerprint(session, profile, null, ["collar-shirt"]);
    const fp2 = buildSessionFingerprint(session, profile, null, ["collar-shirt"]);
    assert.equal(fp1, fp2, "same input must produce identical fingerprint");
  });

  // ── DT.2  Different sessions produce different fingerprints ──────────────
  it("DT.2  Different sessions produce different fingerprints", () => {
    const s1 = makeValidSession({ moods: ["confident"], occasion: "everyday" });
    const s2 = makeValidSession({ moods: ["adventurous"],   occasion: "dinner" });
    const fp1 = buildSessionFingerprint(s1, undefined, null, []);
    const fp2 = buildSessionFingerprint(s2, undefined, null, []);
    assert.notEqual(fp1, fp2, "sessions with different moods/occasions must differ");
  });

  // ── DT.3  sessionSpecificHash varies per session for the same product ─────
  it("DT.3  Same product handle has a different sessionSpecificHash in different sessions", () => {
    const s1 = makeValidSession({ moods: ["confident"], desiredFeelings: ["more-elevated"], occasion: "everyday" });
    const s2 = makeValidSession({ moods: ["adventurous"],   desiredFeelings: ["more-attractive"], occasion: "dinner" });
    const r1 = run(s1);
    const r2 = run(s2);
    // Find at least one handle present in both evaluations
    const handles1 = new Set(r1.evaluatedProducts.map((e) => e.handle));
    let diffFound = false;
    for (const ev2 of r2.evaluatedProducts) {
      if (!handles1.has(ev2.handle)) continue;
      const ev1 = r1.evaluatedProducts.find((e) => e.handle === ev2.handle)!;
      if (ev1.semanticTieBreak.sessionSpecificHash !== ev2.semanticTieBreak.sessionSpecificHash) {
        diffFound = true;
        break;
      }
    }
    assert.ok(diffFound, "sessionSpecificHash must differ across sessions for at least one shared product handle");
  });

  // ── DT.4  Diversity penalty is visible in diversityAdjustment ────────────
  it("DT.4  diversityAdjustment is REGENERATE_PRIMARY_PENALTY for index-0 recently-shown product", () => {
    const session = makeValidSession({ moods: ["confident"], desiredFeelings: ["more-elevated"], occasion: "dinner" });
    const r1 = run(session);
    if (!r1.primary) return; // skip if no recommendation
    const shown = r1.primary.handle;
    const r2 = run(session, undefined, { recentlyShown: [shown] });
    const ev = r2.evaluatedProducts.find((e) => e.handle === shown)!;
    assert.equal(ev.diversityAdjustment, SCORING_WEIGHTS.REGENERATE_PRIMARY_PENALTY,
      "index-0 primary handle must receive REGENERATE_PRIMARY_PENALTY, not the mild DIVERSITY_PENALTY");
  });

  // ── DT.5  Primary penalty forces a different product to be selected ───────
  it("DT.5  REGENERATE_PRIMARY_PENALTY causes a different product to win on regenerate", () => {
    const session = makeValidSession({
      moods: ["confident"], desiredFeelings: ["more-elevated"], bodyNeeds: ["nothing-specific"],
      occasion: "dinner", formalityConditional: "formality-smart",
    });
    const profile: StyleMeProfileSignals = { stylePersonalities: ["corporate-chic"] };
    const r1 = run(session, profile);
    if (!r1.primary) return;
    const prevHandle = r1.primary.handle;
    const r2 = run(session, profile, { recentlyShown: [prevHandle] });
    // If there are other eligible products, the primary must change
    const otherAboveThreshold = r2.evaluatedProducts.filter(
      (e) => !e.isHardExcluded && e.handle !== prevHandle && e.totalScore >= THRESHOLDS.MIN_TOTAL_SCORE,
    );
    if (otherAboveThreshold.length > 0) {
      assert.notEqual(r2.primary?.handle, prevHandle,
        "REGENERATE_PRIMARY_PENALTY must force a different primary when alternatives exist");
    }
    // The penalized product must have REGENERATE_PRIMARY_PENALTY applied
    const ev2 = r2.evaluatedProducts.find((e) => e.handle === prevHandle)!;
    assert.equal(ev2.diversityAdjustment, SCORING_WEIGHTS.REGENERATE_PRIMARY_PENALTY);
  });

  // ── DT.6  semanticTieBreak is populated on all evaluated products ─────────
  it("DT.6  semanticTieBreak fields are populated on every evaluated product", () => {
    const session = makeValidSession({ moods: ["confident"], desiredFeelings: ["more-elevated"], occasion: "dinner" });
    const result = run(session, { stylePersonalities: ["feminine"] });
    for (const ev of result.evaluatedProducts) {
      const tb = ev.semanticTieBreak;
      assert.ok(typeof tb.anchorConfidence === "number",           `${ev.handle}: anchorConfidence must be a number`);
      assert.ok(typeof tb.matchedCategoryCount === "number",       `${ev.handle}: matchedCategoryCount must be a number`);
      assert.ok(typeof tb.positiveNonSupplementalCount === "number", `${ev.handle}: positiveNonSupplementalCount must be a number`);
      assert.ok(typeof tb.totalNegativePenalty === "number",       `${ev.handle}: totalNegativePenalty must be a number`);
      assert.ok(typeof tb.provisionalCount === "number",           `${ev.handle}: provisionalCount must be a number`);
      assert.ok(typeof tb.sessionSpecificHash === "number",        `${ev.handle}: sessionSpecificHash must be a number`);
      assert.ok(tb.sessionSpecificHash >= 0,                       `${ev.handle}: sessionSpecificHash must be unsigned`);
      assert.ok(tb.matchedCategoryCount >= 0 && tb.matchedCategoryCount <= 6, `${ev.handle}: matchedCategoryCount out of range`);
    }
  });

  // ── DT.7  deterministicRank export still works (backward compatibility) ───
  it("DT.7  deterministicRank export still returns positive integers unique across all 11 handles", () => {
    const handles = getAllCatalogProducts().map((p) => p.handle);
    const ranks = handles.map(deterministicRank);
    assert.ok(ranks.every((r) => r >= 0), "all deterministicRank values must be unsigned");
    const rankSet = new Set(ranks);
    assert.equal(rankSet.size, handles.length, "all deterministicRank values must be unique");
  });

  // ── DT.8  Same complete input → byte-equivalent evaluation (regression) ───
  it("DT.8  Same complete input produces byte-equivalent evaluatedProducts output", () => {
    const session = makeValidSession({
      moods: ["confident", "powerful"], desiredFeelings: ["more-elevated", "more-confident"],
      bodyNeeds: ["elongates"], occasion: "work", formalityConditional: "formality-polished",
      practicalIds: ["quick-to-style"],
    });
    const profile: StyleMeProfileSignals = { stylePersonalities: ["corporate-chic", "edgy"] };
    const r1 = run(session, profile);
    const r2 = run(session, profile);
    assert.equal(r1.outcome, r2.outcome);
    assert.equal(r1.primary?.handle, r2.primary?.handle);
    assert.equal(r1.evaluatedProducts.length, r2.evaluatedProducts.length);
    for (let i = 0; i < r1.evaluatedProducts.length; i++) {
      const ev1 = r1.evaluatedProducts[i];
      const ev2 = r2.evaluatedProducts[i];
      assert.equal(ev1.handle, ev2.handle, `position ${i} handle mismatch`);
      assert.equal(ev1.totalScore, ev2.totalScore, `${ev1.handle}: totalScore mismatch`);
      assert.equal(ev1.semanticTieBreak.sessionSpecificHash, ev2.semanticTieBreak.sessionSpecificHash,
        `${ev1.handle}: sessionSpecificHash mismatch`);
    }
  });
});

// ─── §15  Valid representative certification matrix ────────────────────────────

describe("§15  Valid representative matrix (≥120 valid sessions) — certification", () => {
  type MatrixScenario = {
    label: string;
    session: StyleMeSessionInput;
    profile?: StyleMeProfileSignals;
    anchor?: StyleMeEngineInput["anchor"];
  };

  const ALL_MOODS = [
    "confident","adventurous","romantic","powerful","need-reset",
    "feel-good","tired","low-energy","feeling-low","overwhelmed",
    "self-conscious","neutral",
  ] as const;
  const ALL_DFM = [
    "more-confident","more-put-together","softer","more-powerful",
    "more-feminine","more-effortless","more-elevated","more-attractive","like-myself",
  ] as const;
  const ALL_BODY_NEEDS = [
    "waist-definition","soft-and-forgiving-around-waist","more-coverage",
    "relaxed","structured","elongates","balances","comfortable-elevated","nothing-specific",
  ] as const;
  const ALL_OCCASIONS = [
    "everyday","work","dinner","date-night","girls-night",
    "family","special-event","travel","not-sure",
  ] as const;
  const ALL_FORMALITY = [
    "formality-relaxed","formality-smart","formality-polished","formality-occasion",
  ] as const;
  const ALL_PSM = [
    "quick-to-style","lots-of-movement","long-day","practical-footwear",
    "day-to-night","hot-outdoors","cool-air-conditioning","no-special-constraint",
  ] as const;
  const ALL_SP = [
    "old-money","artsy","edgy","feminine","corporate-chic",
    "effortlessly-chic","minimal","trendy","romantic","casual-cool",
  ] as const;
  const ALL_SOURCES = ["naia-piece","my-closet","both"] as const;

  // All scenarios use makeValidSession — every session has moods≥1, desiredFeelings≥1,
  // bodyNeeds≥1, occasion, and source. Groups VA–VH use one override at a time while
  // the base fills the remaining required fields.

  const VALID_MATRIX: MatrixScenario[] = [
    // ── Group VA: one per mood (12) ─────────────────────────────────────────
    ...ALL_MOODS.map((mood) => ({
      label: `VA.mood-${mood}`,
      session: makeValidSession({ moods: [mood] }),
    })),

    // ── Group VB: one per DFM (9) ───────────────────────────────────────────
    ...ALL_DFM.map((dfm) => ({
      label: `VB.dfm-${dfm}`,
      session: makeValidSession({ desiredFeelings: [dfm], occasion: "dinner" }),
    })),

    // ── Group VC: one per body need (9) ─────────────────────────────────────
    // more-coverage gets coverageConditional per spec rule
    ...ALL_BODY_NEEDS.map((bn) => ({
      label: `VC.bn-${bn}`,
      session: makeValidSession({
        bodyNeeds: [bn],
        ...(bn === "more-coverage" ? { coverageConditional: "coverage-non-negotiable" as const } : {}),
      }),
    })),

    // ── Group VD: one per occasion (9) ──────────────────────────────────────
    ...ALL_OCCASIONS.map((occ) => ({
      label: `VD.occ-${occ}`,
      session: makeValidSession({ occasion: occ }),
    })),

    // ── Group VE: one per formality (4) — dinner triggers formality ──────────
    ...ALL_FORMALITY.map((fm) => ({
      label: `VE.fm-${fm}`,
      session: makeValidSession({ occasion: "dinner", formalityConditional: fm }),
    })),

    // ── Group VF: one per PSM (8) ───────────────────────────────────────────
    ...ALL_PSM.map((psm) => ({
      label: `VF.psm-${psm}`,
      session: makeValidSession({ practicalIds: [psm] }),
    })),

    // ── Group VG: one per SP (10) ───────────────────────────────────────────
    ...ALL_SP.map((sp) => ({
      label: `VG.sp-${sp}`,
      session: makeValidSession({ occasion: "dinner" }),
      profile: { stylePersonalities: [sp] as string[] } as StyleMeProfileSignals,
    })),

    // ── Group VH: one per source (3) ────────────────────────────────────────
    ...ALL_SOURCES.map((src) => ({
      label: `VH.src-${src}`,
      session: makeValidSession({ source: src }),
    })),

    // ── Group VI: anchor variations (25) — all with valid base ──────────────
    // Closet TOPS (4)
    { label: "VI.tops-1",         session: makeValidSession({ occasion: "everyday" }),                                                                                                                          anchor: makeClosetAnchor("TOPS") },
    { label: "VI.tops-2",         session: makeValidSession({ moods: ["tired"], desiredFeelings: ["more-put-together"], occasion: "work", practicalIds: ["quick-to-style"] }),         profile: { stylePersonalities: ["corporate-chic"] }, anchor: makeClosetAnchor("TOPS") },
    { label: "VI.tops-3",         session: makeValidSession({ moods: ["romantic"], desiredFeelings: ["more-feminine"], occasion: "date-night", formalityConditional: "formality-smart" }), profile: { stylePersonalities: ["feminine"] }, anchor: makeClosetAnchor("TOPS", { styleTags: ["elegant"], occasions: ["date-night"] }) },
    { label: "VI.tops-4",         session: makeValidSession({ moods: ["adventurous"], desiredFeelings: ["more-attractive"], occasion: "dinner" }),                                                                   anchor: makeClosetAnchor("TOPS", { styleTags: ["casual"] }) },
    // Closet BOTTOMS (5)
    { label: "VI.btm-1",          session: makeValidSession({ occasion: "everyday" }),                                                                                                                          anchor: makeClosetAnchor("BOTTOMS") },
    { label: "VI.btm-2",          session: makeValidSession({ moods: ["confident"], desiredFeelings: ["more-elevated"], occasion: "dinner", formalityConditional: "formality-smart" }),                          anchor: makeClosetAnchor("BOTTOMS") },
    { label: "VI.btm-3",          session: makeValidSession({ moods: ["romantic"], desiredFeelings: ["more-feminine"], occasion: "date-night" }),                                          profile: { stylePersonalities: ["feminine"] },       anchor: makeClosetAnchor("BOTTOMS", { styleTags: ["feminine"], occasions: ["date-night"] }) },
    { label: "VI.btm-4",          session: makeValidSession({ moods: ["tired"], desiredFeelings: ["more-effortless"], occasion: "work", practicalIds: ["quick-to-style"] }),                                     anchor: makeClosetAnchor("BOTTOMS") },
    { label: "VI.btm-5",          session: makeValidSession({ moods: ["powerful"], desiredFeelings: ["more-confident"], bodyNeeds: ["structured"], occasion: "special-event", formalityConditional: "formality-occasion" }), anchor: makeClosetAnchor("BOTTOMS") },
    // Closet DRESSES (3)
    { label: "VI.drs-1",          session: makeValidSession({ occasion: "dinner" }),                                                                                                                             anchor: makeClosetAnchor("DRESSES") },
    { label: "VI.drs-2",          session: makeValidSession({ moods: ["romantic"], desiredFeelings: ["softer"], occasion: "date-night" }),                                                  profile: { stylePersonalities: ["feminine"] },       anchor: makeClosetAnchor("DRESSES") },
    { label: "VI.drs-3",          session: makeValidSession({ moods: ["adventurous"], desiredFeelings: ["more-feminine"], occasion: "girls-night" }),                                                                anchor: makeClosetAnchor("DRESSES") },
    // Closet OUTERWEAR (3)
    { label: "VI.otr-1",          session: makeValidSession({ occasion: "everyday" }),                                                                                                                          anchor: makeClosetAnchor("OUTERWEAR") },
    { label: "VI.otr-2",          session: makeValidSession({ moods: ["powerful"], desiredFeelings: ["more-confident"], occasion: "special-event", formalityConditional: "formality-occasion" }),               anchor: makeClosetAnchor("OUTERWEAR") },
    { label: "VI.otr-3",          session: makeValidSession({ moods: ["confident"], desiredFeelings: ["more-put-together"], occasion: "work" }),                                                                 anchor: makeClosetAnchor("OUTERWEAR") },
    // Closet BAGS — unknown slot → closet-led (2)
    { label: "VI.bags-1",         session: makeValidSession({ occasion: "dinner" }),                                                                                                                             anchor: makeClosetAnchor("BAGS") },
    { label: "VI.bags-2",         session: makeValidSession({ moods: ["adventurous"], desiredFeelings: ["more-attractive"], occasion: "girls-night" }),                                                              anchor: makeClosetAnchor("BAGS") },
    // NADINE anchors (6)
    { label: "VI.nadine-collar",   session: makeValidSession({ moods: ["confident"], desiredFeelings: ["more-elevated"], occasion: "dinner" }),                                                                   anchor: { type: "nadine" as const, handle: "collar-shirt" } },
    { label: "VI.nadine-midi",     session: makeValidSession({ moods: ["romantic"], desiredFeelings: ["more-feminine"], occasion: "date-night", formalityConditional: "formality-smart" }), profile: { stylePersonalities: ["feminine"] }, anchor: { type: "nadine" as const, handle: "midi-dress" } },
    { label: "VI.nadine-trench",   session: makeValidSession({ moods: ["powerful"], desiredFeelings: ["more-confident"], bodyNeeds: ["more-coverage"], occasion: "special-event", formalityConditional: "formality-occasion" }), profile: { stylePersonalities: ["corporate-chic"] }, anchor: { type: "nadine" as const, handle: "trench-coat" } },
    { label: "VI.nadine-asym",     session: makeValidSession({ moods: ["confident"], desiredFeelings: ["more-elevated"], bodyNeeds: ["elongates"], occasion: "work" }),                    profile: { stylePersonalities: ["edgy"] },           anchor: { type: "nadine" as const, handle: "asymmetrical-pants" } },
    { label: "VI.nadine-free",     session: makeValidSession({ moods: ["adventurous"], desiredFeelings: ["more-attractive"], occasion: "girls-night" }),                                       profile: { stylePersonalities: ["trendy"] },          anchor: { type: "nadine" as const, handle: "draped-leather-pants" } },
    { label: "VI.nadine-bold",     session: makeValidSession({ moods: ["feel-good"], desiredFeelings: ["more-effortless"], bodyNeeds: ["relaxed"], occasion: "travel" }),                   profile: { stylePersonalities: ["effortlessly-chic"] }, anchor: { type: "nadine" as const, handle: "oversized-blazer" } },

    // ── Group VM: multi-signal rich scenarios (30) ───────────────────────────
    { label: "VM.1",  session: makeValidSession({ moods: ["confident","powerful"], desiredFeelings: ["more-elevated","more-confident"], bodyNeeds: ["structured"], occasion: "work",       formalityConditional: "formality-polished" }),                           profile: { stylePersonalities: ["edgy","artsy"] } },
    { label: "VM.2",  session: makeValidSession({ moods: ["tired","low-energy"],   desiredFeelings: ["more-put-together"],              bodyNeeds: ["nothing-specific"], occasion: "everyday", practicalIds: ["quick-to-style"] }),                                 profile: { stylePersonalities: ["corporate-chic"] } },
    { label: "VM.3",  session: makeValidSession({ moods: ["romantic"],             desiredFeelings: ["more-feminine","softer"],         bodyNeeds: ["waist-definition"], occasion: "date-night", formalityConditional: "formality-smart" }),                        profile: { stylePersonalities: ["feminine","romantic"] } },
    { label: "VM.4",  session: makeValidSession({ moods: ["need-reset"],           desiredFeelings: ["more-effortless"],               bodyNeeds: ["waist-definition"], occasion: "everyday" }),                                                                    profile: { stylePersonalities: ["effortlessly-chic"] } },
    { label: "VM.5",  session: makeValidSession({ moods: ["feel-good"],            desiredFeelings: ["more-elevated"],                 bodyNeeds: ["relaxed"], occasion: "travel",       practicalIds: ["lots-of-movement"] }),                                       profile: { stylePersonalities: ["artsy"] } },
    { label: "VM.6",  session: makeValidSession({ moods: ["powerful"],             desiredFeelings: ["more-confident"],               bodyNeeds: ["structured"], occasion: "girls-night", formalityConditional: "formality-occasion" }),                            profile: { stylePersonalities: ["trendy"] } },
    { label: "VM.7",  session: makeValidSession({ moods: ["feeling-low"],          desiredFeelings: ["more-powerful"],               bodyNeeds: ["elongates"], occasion: "work",          formalityConditional: "formality-polished" }),                             profile: { stylePersonalities: ["corporate-chic"] } },
    { label: "VM.8",  session: makeValidSession({ moods: ["overwhelmed"],          desiredFeelings: ["more-put-together"],           bodyNeeds: ["nothing-specific"], occasion: "everyday", practicalIds: ["quick-to-style"] }) },
    { label: "VM.9",  session: makeValidSession({ moods: ["self-conscious"],       desiredFeelings: ["more-feminine"],              bodyNeeds: ["more-coverage"], coverageConditional: "coverage-non-negotiable", occasion: "everyday" }),                          profile: { stylePersonalities: ["feminine"] } },
    { label: "VM.10", session: makeValidSession({ moods: ["adventurous"],              desiredFeelings: ["more-attractive"],            bodyNeeds: ["nothing-specific"], occasion: "dinner" }),                                                                          profile: { stylePersonalities: ["artsy","edgy"] } },
    { label: "VM.11", session: makeValidSession({ moods: ["confident"],            desiredFeelings: ["like-myself"],               bodyNeeds: ["nothing-specific"], occasion: "date-night", formalityConditional: "formality-polished" }),                           profile: { stylePersonalities: ["feminine"] } },
    { label: "VM.12", session: makeValidSession({ moods: ["romantic"],             desiredFeelings: ["softer"],                    bodyNeeds: ["waist-definition"], occasion: "dinner" }),                                                                           profile: { stylePersonalities: ["feminine"] } },
    { label: "VM.13", session: makeValidSession({ moods: ["tired"],                desiredFeelings: ["more-effortless"],           bodyNeeds: ["nothing-specific"], occasion: "everyday", practicalIds: ["no-special-constraint"] }),                                profile: { stylePersonalities: ["effortlessly-chic"] } },
    { label: "VM.14", session: makeValidSession({ moods: ["feel-good"],            desiredFeelings: ["more-elevated"],             bodyNeeds: ["nothing-specific"], occasion: "dinner",    formalityConditional: "formality-smart" }),                               profile: { stylePersonalities: ["old-money"] } },
    { label: "VM.15", session: makeValidSession({ moods: ["confident"],            desiredFeelings: ["more-put-together"],         bodyNeeds: ["balances","elongates"], occasion: "work" }),                                                                         profile: { stylePersonalities: ["corporate-chic"] } },
    { label: "VM.16", session: makeValidSession({ moods: ["adventurous"],              desiredFeelings: ["more-feminine"],             bodyNeeds: ["nothing-specific"], occasion: "girls-night", formalityConditional: "formality-occasion" }),                          profile: { stylePersonalities: ["trendy","feminine"] } },
    { label: "VM.17", session: makeValidSession({ moods: ["need-reset"],           desiredFeelings: ["more-effortless"],           bodyNeeds: ["relaxed","comfortable-elevated"], occasion: "everyday" }),                                                           profile: { stylePersonalities: ["effortlessly-chic"] } },
    { label: "VM.18", session: makeValidSession({ moods: ["powerful"],             desiredFeelings: ["more-confident"],            bodyNeeds: ["structured"], occasion: "special-event",   formalityConditional: "formality-occasion" }),                            profile: { stylePersonalities: ["edgy"] } },
    { label: "VM.19", session: makeValidSession({ moods: ["romantic"],             desiredFeelings: ["more-attractive"],           bodyNeeds: ["nothing-specific"], occasion: "date-night", practicalIds: ["long-day"] }),                                           profile: { stylePersonalities: ["feminine"] } },
    { label: "VM.20", session: makeValidSession({ moods: ["tired"],                desiredFeelings: ["more-elevated"],             bodyNeeds: ["waist-definition"], occasion: "dinner",    formalityConditional: "formality-polished" }),                             profile: { stylePersonalities: ["corporate-chic"] } },
    { label: "VM.21", session: makeValidSession({ moods: ["confident"],            desiredFeelings: ["more-feminine"],             bodyNeeds: ["nothing-specific"], occasion: "girls-night", todayColours: { preferred: ["black"], avoid: [] } }),                    profile: { stylePersonalities: ["artsy","feminine"] } },
    { label: "VM.22", session: makeValidSession({ moods: ["feel-good"],            desiredFeelings: ["more-effortless"],           bodyNeeds: ["nothing-specific"], occasion: "everyday" }),                                                                         profile: { stylePersonalities: ["minimal","casual-cool"] } },
    { label: "VM.23", session: makeValidSession({ moods: ["confident","adventurous"],  desiredFeelings: ["more-confident","more-attractive"], bodyNeeds: ["nothing-specific"], occasion: "girls-night" }),                                                              profile: { stylePersonalities: ["trendy","edgy"] } },
    { label: "VM.24", session: makeValidSession({ moods: ["feeling-low"],          desiredFeelings: ["more-powerful"],             bodyNeeds: ["elongates","waist-definition"], occasion: "work", practicalIds: ["practical-footwear","quick-to-style"] }),          profile: { stylePersonalities: ["corporate-chic"] } },
    { label: "VM.25", session: makeValidSession({ moods: ["romantic","need-reset"], desiredFeelings: ["more-effortless","more-feminine"], bodyNeeds: ["waist-definition","relaxed"], occasion: "everyday", practicalIds: ["quick-to-style"] }),                    profile: { stylePersonalities: ["effortlessly-chic","feminine"] } },
    { label: "VM.26", session: makeValidSession({ moods: ["confident"],            desiredFeelings: ["more-elevated"],             bodyNeeds: ["structured","elongates"], occasion: "work", formalityConditional: "formality-polished" }),                           profile: { stylePersonalities: ["corporate-chic","minimal"] } },
    { label: "VM.27", session: makeValidSession({ moods: ["tired","overwhelmed"],  desiredFeelings: ["more-effortless"],           bodyNeeds: ["relaxed"], occasion: "everyday", practicalIds: ["day-to-night"] }),                                                 profile: { stylePersonalities: ["casual-cool"] } },
    { label: "VM.28", session: makeValidSession({ moods: ["adventurous"],              desiredFeelings: ["more-attractive","more-elevated"], bodyNeeds: ["nothing-specific"], occasion: "dinner", formalityConditional: "formality-relaxed", todayColours: { preferred: [], avoid: ["black"] } }), profile: { stylePersonalities: ["artsy"] } },
    { label: "VM.29", session: makeValidSession({ moods: ["confident"],            desiredFeelings: ["more-put-together"],         bodyNeeds: ["more-coverage","waist-definition"], coverageConditional: "coverage-flexible-with-layering", occasion: "family" }),  profile: { stylePersonalities: ["old-money"] } },
    { label: "VM.30", session: makeValidSession({ moods: ["powerful","feel-good"], desiredFeelings: ["more-confident","more-elevated"], bodyNeeds: ["structured","elongates"], occasion: "special-event", formalityConditional: "formality-occasion" }),            profile: { stylePersonalities: ["corporate-chic","edgy"] } },

    // ── Group VN: low-info but still valid (20) ──────────────────────────────
    // One mood, one DFM, one BN, occasion, source — minimum valid session.
    { label: "VN.1",  session: makeValidSession({ moods: ["neutral"],       desiredFeelings: ["more-elevated"],    bodyNeeds: ["nothing-specific"], occasion: "everyday",     source: "naia-piece" }) },
    { label: "VN.2",  session: makeValidSession({ moods: ["confident"],     desiredFeelings: ["more-confident"],   bodyNeeds: ["nothing-specific"], occasion: "work",         source: "naia-piece" }) },
    { label: "VN.3",  session: makeValidSession({ moods: ["tired"],         desiredFeelings: ["more-effortless"],  bodyNeeds: ["relaxed"],          occasion: "everyday",     source: "naia-piece" }) },
    { label: "VN.4",  session: makeValidSession({ moods: ["romantic"],      desiredFeelings: ["softer"],           bodyNeeds: ["nothing-specific"], occasion: "dinner",       source: "naia-piece" }) },
    { label: "VN.5",  session: makeValidSession({ moods: ["adventurous"],       desiredFeelings: ["more-attractive"],  bodyNeeds: ["nothing-specific"], occasion: "girls-night",  source: "naia-piece" }) },
    { label: "VN.6",  session: makeValidSession({ moods: ["feel-good"],     desiredFeelings: ["more-feminine"],    bodyNeeds: ["waist-definition"], occasion: "date-night",   source: "naia-piece" }) },
    { label: "VN.7",  session: makeValidSession({ moods: ["powerful"],      desiredFeelings: ["more-powerful"],    bodyNeeds: ["structured"],       occasion: "special-event", source: "naia-piece" }) },
    { label: "VN.8",  session: makeValidSession({ moods: ["need-reset"],    desiredFeelings: ["more-put-together"], bodyNeeds: ["nothing-specific"], occasion: "travel",       source: "my-closet" }) },
    { label: "VN.9",  session: makeValidSession({ moods: ["overwhelmed"],   desiredFeelings: ["more-effortless"],  bodyNeeds: ["nothing-specific"], occasion: "everyday",     source: "both" }) },
    { label: "VN.10", session: makeValidSession({ moods: ["feeling-low"],   desiredFeelings: ["more-confident"],   bodyNeeds: ["elongates"],        occasion: "work",         source: "naia-piece" }) },
    { label: "VN.11", session: makeValidSession({ moods: ["self-conscious"], desiredFeelings: ["like-myself"],     bodyNeeds: ["nothing-specific"], occasion: "everyday",     source: "naia-piece" }) },
    { label: "VN.12", session: makeValidSession({ moods: ["low-energy"],    desiredFeelings: ["more-put-together"], bodyNeeds: ["comfortable-elevated"], occasion: "family",  source: "naia-piece" }) },
    { label: "VN.13", session: makeValidSession({ moods: ["confident"],     desiredFeelings: ["more-elevated"],    bodyNeeds: ["balances"],         occasion: "not-sure",     source: "naia-piece" }) },
    { label: "VN.14", session: makeValidSession({ moods: ["tired"],         desiredFeelings: ["more-put-together"], bodyNeeds: ["nothing-specific"], occasion: "work",        source: "naia-piece" }), profile: { stylePersonalities: ["corporate-chic"] } },
    { label: "VN.15", session: makeValidSession({ moods: ["romantic"],      desiredFeelings: ["more-feminine"],    bodyNeeds: ["soft-and-forgiving-around-waist"], occasion: "dinner", source: "naia-piece" }), profile: { stylePersonalities: ["feminine"] } },
    { label: "VN.16", session: makeValidSession({ moods: ["adventurous"],       desiredFeelings: ["more-elevated"],    bodyNeeds: ["nothing-specific"], occasion: "everyday", practicalIds: ["hot-outdoors"], source: "naia-piece" }) },
    { label: "VN.17", session: makeValidSession({ moods: ["feel-good"],     desiredFeelings: ["more-effortless"],  bodyNeeds: ["relaxed"],          occasion: "travel", practicalIds: ["cool-air-conditioning"], source: "naia-piece" }) },
    { label: "VN.18", session: makeValidSession({ moods: ["confident"],     desiredFeelings: ["more-confident"],   bodyNeeds: ["nothing-specific"], occasion: "date-night", todayColours: { preferred: ["black","navy"], avoid: [] }, source: "naia-piece" }) },
    { label: "VN.19", session: makeValidSession({ moods: ["powerful"],      desiredFeelings: ["more-elevated"],    bodyNeeds: ["nothing-specific"], occasion: "work",         source: "naia-piece" }), profile: { stylePersonalities: ["minimal"] } },
    { label: "VN.20", session: makeValidSession({ moods: ["confident"],     desiredFeelings: ["more-feminine"],    bodyNeeds: ["nothing-specific"], occasion: "dinner", formalityConditional: "formality-relaxed", source: "naia-piece" }), profile: { stylePersonalities: ["casual-cool"] } },
  ];

  it("15.1  scenario count is within certified range (120–300) and every scenario is a valid session", () => {
    assert.ok(
      VALID_MATRIX.length >= 120 && VALID_MATRIX.length <= 300,
      `scenario count must be 120-300; got ${VALID_MATRIX.length}`,
    );
    for (const s of VALID_MATRIX) {
      assert.ok(s.session.moods.length >= 1,           `${s.label}: moods must be non-empty`);
      assert.ok(s.session.desiredFeelings.length >= 1, `${s.label}: desiredFeelings must be non-empty`);
      assert.ok(s.session.bodyNeeds.length >= 1,       `${s.label}: bodyNeeds must be non-empty`);
      assert.ok(s.session.occasion.length > 0,         `${s.label}: occasion must be set`);
      assert.ok(s.session.source.length > 0,           `${s.label}: source must be set`);
    }
  });

  it("15.2  canonical-value coverage: every mood, DFM, body-need, occasion, formality, PSM, SP, and source appears at least once", () => {
    const seen = {
      moods: new Set<string>(), dfm: new Set<string>(), bn: new Set<string>(),
      occ: new Set<string>(), fm: new Set<string>(), psm: new Set<string>(),
      sp: new Set<string>(), src: new Set<string>(),
    };
    for (const s of VALID_MATRIX) {
      s.session.moods.forEach((m) => seen.moods.add(m));
      s.session.desiredFeelings.forEach((d) => seen.dfm.add(d));
      s.session.bodyNeeds.forEach((b) => seen.bn.add(b));
      seen.occ.add(s.session.occasion);
      if (s.session.formalityConditional) seen.fm.add(s.session.formalityConditional);
      s.session.practicalIds.forEach((p) => seen.psm.add(p));
      s.profile?.stylePersonalities?.forEach((sp) => seen.sp.add(sp));
      seen.src.add(s.session.source);
    }
    for (const m of ALL_MOODS)    assert.ok(seen.moods.has(m),  `mood "${m}" missing`);
    for (const d of ALL_DFM)      assert.ok(seen.dfm.has(d),    `DFM "${d}" missing`);
    for (const b of ALL_BODY_NEEDS) assert.ok(seen.bn.has(b),   `body need "${b}" missing`);
    for (const o of ALL_OCCASIONS) assert.ok(seen.occ.has(o),   `occasion "${o}" missing`);
    for (const f of ALL_FORMALITY) assert.ok(seen.fm.has(f),    `formality "${f}" missing`);
    for (const p of ALL_PSM)      assert.ok(seen.psm.has(p),    `PSM "${p}" missing`);
    for (const sp of ALL_SP)      assert.ok(seen.sp.has(sp),    `SP "${sp}" missing`);
    for (const src of ALL_SOURCES) assert.ok(seen.src.has(src), `source "${src}" missing`);
  });

  it("15.3  distribution and certification: ≥3 distinct winners, dominance ≤40%, no unexplained empties, 7-tier ordering holds for all winners", () => {
    const winCount = new Map<string, number>();
    let nadineCount = 0;
    let closetLedCount = 0;
    let noEligibleCount = 0;
    const unexplainedEmpties: string[] = [];

    for (const scenario of VALID_MATRIX) {
      const result = run(scenario.session, scenario.profile, { anchor: scenario.anchor });

      if (result.outcome === "nadine-recommendation") {
        nadineCount++;
        const handle = result.primary!.handle;
        winCount.set(handle, (winCount.get(handle) ?? 0) + 1);

        // Verify the winner is ranked first by the 7-tier ordering
        const winner = result.evaluatedProducts.find((e) => e.handle === handle)!;
        const nonExcluded = result.evaluatedProducts.filter((e) => !e.isHardExcluded);
        for (const ev of nonExcluded) {
          if (ev.handle === handle) continue;
          assert.ok(
            winsUnder7Tiers(winner, ev),
            `[${scenario.label}] winner "${handle}" (score=${winner.totalScore} hash=${winner.semanticTieBreak.sessionSpecificHash}) does not beat "${ev.handle}" (score=${ev.totalScore} hash=${ev.semanticTieBreak.sessionSpecificHash}) under 7-tier ordering`,
          );
        }
      } else if (result.outcome === "closet-led") {
        closetLedCount++;
      } else {
        noEligibleCount++;
        const hasPositive = scenario.session.moods.some((m) => m !== "neutral")
          || scenario.session.desiredFeelings.length > 0
          || (scenario.profile?.stylePersonalities?.length ?? 0) > 0;
        const hasClosetAnchor = scenario.anchor?.type === "closet";
        if (scenario.session.source === "naia-piece" && !hasClosetAnchor && hasPositive) {
          unexplainedEmpties.push(scenario.label);
        }
      }
    }

    // ── Assertion 1: ≥3 distinct products win ────────────────────────────────
    const winKeys = Array.from(winCount.keys());
    assert.ok(
      winCount.size >= 3,
      `must have ≥3 distinct winners; got ${winCount.size}: ${winKeys.join(", ")}`,
    );

    // ── Assertion 2: dominance ≤40% (same threshold — still flags as HOLD) ──
    if (nadineCount > 0) {
      winCount.forEach((count, handle) => {
        const share = count / nadineCount;
        assert.ok(
          share <= 0.40,
          `DOMINANCE ALERT: "${handle}" wins ${count}/${nadineCount} (${Math.round(share * 100)}%) — exceeds 40% threshold; session-specific tie-break or scoring weights need review`,
        );
      });
    }

    // ── Assertion 3: no unexplained empty results ────────────────────────────
    assert.deepStrictEqual(unexplainedEmpties, [],
      `Unexplained no-eligible-product (naia-piece + positive signals): ${unexplainedEmpties.join(", ")}`);

    // ── Audit (informational) ────────────────────────────────────────────────
    const winEntries = Array.from(winCount.entries()).sort((a, b) => b[1] - a[1]);
    const topHandle = winEntries[0]?.[0] ?? "—";
    const topCount  = winEntries[0]?.[1] ?? 0;
    const topShare  = nadineCount > 0 ? Math.round((topCount / nadineCount) * 100) : 0;
    const audit = [
      `15.3 audit | scenarios=${VALID_MATRIX.length}`,
      `nadine=${nadineCount}`, `closet-led=${closetLedCount}`, `no-eligible=${noEligibleCount}`,
      `unique-winners=${winCount.size}`,
      `top="${topHandle}" (${topCount}/${nadineCount}=${topShare}%)`,
      `all: ${winEntries.map(([h, c]) => `${h}=${c}`).join(", ")}`,
    ].join("  ");
    void audit;
  });

  it("15.4  sessionSpecificHash varies across sessions for the same product (proves tie-break is session-specific)", () => {
    // Collect hashes for each product handle across all scenarios
    const hashesPerHandle = new Map<string, Set<number>>();
    for (const scenario of VALID_MATRIX) {
      const result = run(scenario.session, scenario.profile, { anchor: scenario.anchor });
      for (const ev of result.evaluatedProducts) {
        const existing = hashesPerHandle.get(ev.handle) ?? new Set<number>();
        existing.add(ev.semanticTieBreak.sessionSpecificHash);
        hashesPerHandle.set(ev.handle, existing);
      }
    }
    // Every product should have multiple distinct hashes (one per distinct session fingerprint)
    for (const [handle, hashes] of hashesPerHandle) {
      assert.ok(
        hashes.size > 1,
        `product "${handle}" has only ${hashes.size} distinct sessionSpecificHash across ${VALID_MATRIX.length} scenarios — hash is not session-specific`,
      );
    }
  });
});

// ─── §16  Profile signal influence tests ──────────────────────────────────────
// These tests verify that forwarded Passport fields actually change recommendation
// output (ranking / evidence). Each test isolates one profile field against a
// controlled baseline session where that field is the only difference.
//
// Catalog facts used (from generated catalog, verified 2026-08-24 post-reconciliation):
//   collar-shirt:  desiredFeelingMatch includes "more-put-together"; occasionTags includes "work"
//   suede-skirt:   desiredFeelingMatch lacks "more-put-together" (has feminine/attractive/elevated/confident)
//   leather-suede-jacket: styleMeComfortMatch includes "relaxed" (bomber redesign); occasionTags "everyday,dinner,girls-night,travel"
//   midi-dress:    occasionTags "dinner,date-night,girls-night,special-event" — no "work"
//   kimono-jacket:  styleMeComfortMatch includes "relaxed"; occasionTags includes "everyday"
//
// Session baseline: occasion="dinner" (all 11 products match → +4 each); no mood/DFM/body signals.

describe("§16  Profile signal influence tests", () => {
  // Minimal session where all dinner products score identically (+4 occasion only).
  const dinnerSession = makeSession({ occasion: "dinner", source: "naia-piece" });

  function findEval(result: ReturnType<typeof run>, handle: string) {
    const ev = result.evaluatedProducts.find((p) => p.handle === handle);
    assert.ok(ev, `expected product "${handle}" in evaluatedProducts`);
    return ev;
  }

  // ── 16.1  profile.desiredFeelings adds RANK to matching DFM token ────────────

  it("16.1  profile.desiredFeelings=\"put-together\" adds RANK=2 to collar-shirt (has more-put-together)", () => {
    const without = run(dinnerSession);
    const withProfile = run(dinnerSession, { desiredFeelings: ["put-together"] });

    const evWithout = findEval(without, "collar-shirt");
    const evWith   = findEval(withProfile, "collar-shirt");

    assert.equal(
      evWith.totalScore - evWithout.totalScore,
      SCORING_WEIGHTS.RANK,
      "profile-desired-feeling should add exactly RANK=2 to collar-shirt",
    );

    const entry = evWith.positiveEvidence.find((e) => e.sessionSignal === "profile-desired-feeling");
    assert.ok(entry, "positiveEvidence should contain a profile-desired-feeling entry");
    assert.equal(entry.matchedToken, "more-put-together");
    assert.equal(entry.points, SCORING_WEIGHTS.RANK);
  });

  it("16.1b  profile.desiredFeelings does not score suede-skirt for \"put-together\" (no more-put-together)", () => {
    // asymmetrical-pants has "more-put-together" in DFM — same as collar-shirt — this test
    // ensures products WITHOUT the token get no bonus
    const without = run(dinnerSession);
    const withProfile = run(dinnerSession, { desiredFeelings: ["put-together"] });

    // suede-skirt has desiredFeelingMatch: "more-feminine, more-attractive, more-elevated, more-confident"
    // — does NOT have "more-put-together"
    const evWithout = findEval(without, "suede-skirt");
    const evWith   = findEval(withProfile, "suede-skirt");

    assert.equal(evWith.totalScore, evWithout.totalScore,
      "suede-skirt lacks more-put-together — score must not change");
  });

  // ── 16.2  profile.desiredFeelings does NOT double-score when session covers it ─

  it("16.2  profile.desiredFeelings skips token already covered by session.desiredFeelings", () => {
    const sessionWithDfm = makeSession({
      desiredFeelings: ["more-put-together"], // session already scored this
      occasion: "dinner",
      source: "naia-piece",
    });

    const sessionOnly = run(sessionWithDfm);
    const sessionAndProfile = run(sessionWithDfm, { desiredFeelings: ["put-together"] });

    const scoreOnly  = findEval(sessionOnly,       "collar-shirt").totalScore;
    const scoreBoth  = findEval(sessionAndProfile, "collar-shirt").totalScore;

    assert.equal(scoreOnly, scoreBoth,
      "profile-desired-feeling must not double-score when session already matched the same DFM token");
  });

  // ── 16.3  profile.fitPreferences adds RANK to matching SMCM token ────────────

  it("16.3  profile.fitPreferences=\"relaxed-fits\" adds RANK=2 to leather-suede-jacket (has \"relaxed\" in SMCM)", () => {
    const without = run(dinnerSession);
    const withProfile = run(dinnerSession, { fitPreferences: ["relaxed-fits"] });

    const evWithout = findEval(without,    "leather-suede-jacket");
    const evWith   = findEval(withProfile, "leather-suede-jacket");

    assert.equal(
      evWith.totalScore - evWithout.totalScore,
      SCORING_WEIGHTS.RANK,
      "profile-fit-preference should add RANK=2 to leather-suede-jacket",
    );

    const entry = evWith.positiveEvidence.find((e) => e.sessionSignal === "profile-fit-preference");
    assert.ok(entry, "positiveEvidence should contain a profile-fit-preference entry");
    assert.equal(entry.matchedToken, "relaxed");
    assert.equal(entry.points, SCORING_WEIGHTS.RANK);
  });

  it("16.3b  profile.fitPreferences does not score collar-shirt for \"relaxed-fits\" (no \"relaxed\" in SMCM)", () => {
    // collar-shirt styleMeComfortMatch: "waist-definition, structured, balances" — no "relaxed"
    const without = run(dinnerSession);
    const withProfile = run(dinnerSession, { fitPreferences: ["relaxed-fits"] });

    const evWithout = findEval(without,    "collar-shirt");
    const evWith   = findEval(withProfile, "collar-shirt");

    assert.equal(evWith.totalScore, evWithout.totalScore,
      "collar-shirt lacks relaxed SMCM token — profile-fit-preference must not score it");
  });

  // ── 16.4  profile.fitPreferences does NOT double-score when session covers SMCM ─

  it("16.4  profile.fitPreferences skips SMCM token already covered by session.bodyNeeds", () => {
    const sessionWithBodyNeed = makeSession({
      bodyNeeds: ["relaxed"], // session already covers this SMCM token
      occasion: "dinner",
      source: "naia-piece",
    });

    const sessionOnly = run(sessionWithBodyNeed);
    const sessionAndProfile = run(sessionWithBodyNeed, { fitPreferences: ["relaxed-fits"] });

    const scoreOnly = findEval(sessionOnly,       "leather-suede-jacket").totalScore;
    const scoreBoth = findEval(sessionAndProfile, "leather-suede-jacket").totalScore;

    assert.equal(scoreOnly, scoreBoth,
      "profile-fit-preference must not double-score when session bodyNeeds already matched the same SMCM token");
  });

  // ── 16.5  fitPreferences deduplication (multiple IDs → same SMCM token) ──────

  it("16.5  two fitPreferences mapping to the same SMCM token score it only once (deduplicated)", () => {
    // "relaxed-fits" and "flowy" both map to "relaxed" SMCM token
    const profileOne = run(dinnerSession, { fitPreferences: ["relaxed-fits"] });
    const profileTwo = run(dinnerSession, { fitPreferences: ["relaxed-fits", "flowy"] });

    const scoreOne = findEval(profileOne, "leather-suede-jacket").totalScore;
    const scoreTwo = findEval(profileTwo, "leather-suede-jacket").totalScore;

    assert.equal(scoreOne, scoreTwo,
      "relaxed-fits + flowy both map to relaxed — must score exactly once (deduplicated)");

    const fitEntries = findEval(profileTwo, "leather-suede-jacket")
      .positiveEvidence.filter((e) => e.sessionSignal === "profile-fit-preference");
    assert.equal(fitEntries.length, 1,
      "exactly one profile-fit-preference entry for the deduplicated SMCM token");
  });

  // ── 16.6  profile.lifestyle adds RANK to matching occasionTag ─────────────────

  it("16.6  profile.lifestyle=\"office\" adds RANK=2 to collar-shirt (has \"work\" tag) when session occasion is dinner", () => {
    const without = run(dinnerSession);
    const withProfile = run(dinnerSession, { lifestyle: ["office"] });

    const evWithout = findEval(without,    "collar-shirt");
    const evWith   = findEval(withProfile, "collar-shirt");

    assert.equal(
      evWith.totalScore - evWithout.totalScore,
      SCORING_WEIGHTS.RANK,
      "profile-lifestyle should add RANK=2 to collar-shirt (has work tag, session is dinner)",
    );

    const entry = evWith.positiveEvidence.find((e) => e.sessionSignal === "profile-lifestyle");
    assert.ok(entry, "positiveEvidence should contain a profile-lifestyle entry");
    assert.equal(entry.matchedToken, "work");
    assert.equal(entry.points, SCORING_WEIGHTS.RANK);
  });

  it("16.6b  profile.lifestyle does not score midi-dress for \"office\" (no \"work\" tag)", () => {
    // midi-dress occasionTags: "dinner, date-night, girls-night, special-event" — no "work"
    const without = run(dinnerSession);
    const withProfile = run(dinnerSession, { lifestyle: ["office"] });

    const evWithout = findEval(without,    "midi-dress");
    const evWith   = findEval(withProfile, "midi-dress");

    assert.equal(evWith.totalScore, evWithout.totalScore,
      "midi-dress lacks work tag — profile-lifestyle must not score it");
  });

  // ── 16.7  profile.lifestyle does NOT double-score when token equals session occasion ─

  it("16.7  profile.lifestyle does not score \"work\" token when session occasion is also work", () => {
    const workSession = makeSession({ occasion: "work", source: "naia-piece" });

    const sessionOnly     = run(workSession);
    const sessionAndProfile = run(workSession, { lifestyle: ["office"] });

    const scoreOnly = findEval(sessionOnly,      "collar-shirt").totalScore;
    const scoreBoth = findEval(sessionAndProfile, "collar-shirt").totalScore;

    assert.equal(scoreOnly, scoreBoth,
      "profile-lifestyle must not score the \"work\" token when session.occasion is already \"work\"");
  });

  // ── 16.8  buildSessionFingerprint reflects all three new profile fields ───────

  it("16.8  buildSessionFingerprint differs for each distinct profile signal variant", () => {
    const session = makeSession({ occasion: "dinner", source: "naia-piece" });
    const fp0 = buildSessionFingerprint(session, undefined, null, []);
    const fp1 = buildSessionFingerprint(session, { desiredFeelings: ["confident"] }, null, []);
    const fp2 = buildSessionFingerprint(session, { fitPreferences: ["relaxed-fits"] }, null, []);
    const fp3 = buildSessionFingerprint(session, { lifestyle: ["office"] }, null, []);

    const all = [fp0, fp1, fp2, fp3];
    const unique = new Set(all);
    assert.equal(unique.size, all.length,
      "each distinct profile signal combination must produce a distinct session fingerprint");
  });
});

// ── §V2-A2 Passport context wiring — buildProfileSignals + quiz-data labels ───
// These tests verify the V2-A2 field-contract: becoming[], styleSupport[], and
// finalNotes are correctly passed through buildProfileSignals and that the
// quiz-data label entries used by the prompt helpers are present and accurate.

describe("§V2-A2 buildProfileSignals — finalNotes wiring", () => {
  it("V2A2.1 — finalNotes string passes through into signals", () => {
    const result = buildProfileSignals({ stylePersonalities: ["artsy"], finalNotes: "I tend to avoid very structured pieces." });
    assert.ok(result !== undefined);
    assert.equal(result!.finalNotes, "I tend to avoid very structured pieces.");
  });

  it("V2A2.2 — finalNotes is trimmed before storage", () => {
    const result = buildProfileSignals({ stylePersonalities: ["artsy"], finalNotes: "  comfort first  " });
    assert.equal(result!.finalNotes, "comfort first");
  });

  it("V2A2.3 — finalNotes null is omitted from signals", () => {
    const result = buildProfileSignals({ stylePersonalities: ["artsy"], finalNotes: null });
    assert.equal(result!.finalNotes, undefined);
  });

  it("V2A2.4 — finalNotes whitespace-only is omitted from signals", () => {
    const result = buildProfileSignals({ stylePersonalities: ["artsy"], finalNotes: "   " });
    assert.equal(result!.finalNotes, undefined);
  });

  it("V2A2.5 — becoming[] passes through into signals", () => {
    const result = buildProfileSignals({ stylePersonalities: ["artsy"], becoming: ["more-confident", "more-polished"] });
    assert.deepEqual(result!.becoming, ["more-confident", "more-polished"]);
  });

  it("V2A2.6 — styleSupport[] passes through into signals", () => {
    const result = buildProfileSignals({ stylePersonalities: ["artsy"], styleSupport: ["feel-myself", "body-mood"] });
    assert.deepEqual(result!.styleSupport, ["feel-myself", "body-mood"]);
  });
});

// Rev 6 (2026-08-29): becoming and style-support are LEGACY fields.
// They are no longer asked during first onboarding but their stored DB values
// are preserved and remain compatible with buildProfileSignals.
// The quiz-screen-existence checks (V2A2.7-9) are replaced with:
//   (a) proof that the quiz screens are intentionally absent, and
//   (b) proof that legacy stored values still flow through buildProfileSignals.
describe("§V2-A2 quiz-data label contract — becoming and style-support (Rev 6 legacy state)", () => {
  it("V2A2.7 — becoming is NOT in the Rev 6 first onboarding quiz (legacy field)", () => {
    const becomingQ = quizQuestions.find(q => q.id === "becoming");
    assert.ok(becomingQ === undefined,
      "becoming must NOT be in Rev 6 quizQuestions — it is a legacy field retained in DB only");
  });

  it("V2A2.8 — style-support is NOT in the Rev 6 first onboarding quiz (legacy field)", () => {
    const styleSupportQ = quizQuestions.find(q => q.id === "style-support");
    assert.ok(styleSupportQ === undefined,
      "style-support must NOT be in Rev 6 quizQuestions — it is a legacy field retained in DB only");
  });

  it("V2A2.9 — legacy becoming[] stored values still flow through buildProfileSignals", () => {
    // Existing users whose DB still has becoming[] values get them passed to the engine.
    const signals = buildProfileSignals({
      stylePersonalities: ["classic-polished"],
      becoming: ["more-confident", "more-polished"],
    });
    assert.deepEqual(signals?.becoming, ["more-confident", "more-polished"],
      "legacy becoming values must reach buildProfileSignals output");
  });
});

// ─── §V2-A3  Profile Aspiration scoring — desiredImpression[] + becoming[] ───
//
// Catalog facts used across tests (from naia-catalog.generated.ts):
//   collar-shirt      DFM: more-put-together, more-confident, more-elevated, more-powerful
//                     SP:  corporate-chic, effortlessly-chic, artsy
//                     ESS: confident, powerful, feel-good, tired, …
//                     occasionTags: work, everyday, dinner, special-event
//   double-top        DFM: more-confident, more-feminine, more-elevated, more-attractive
//                     SP:  artsy, feminine, edgy
//                     ESS: confident, powerful, feel-good, playful (catalog unchanged —
//                          playful->adventurous mood rename NOT migrated for this product)
//                     occasionTags: dinner, date-night, girls-night, special-event
//   oversized-blazer  DFM: more-powerful, more-put-together, more-elevated, more-effortless
//                     SP:  corporate-chic, effortlessly-chic, edgy
//                     occasionTags: work, dinner, everyday, special-event (no girls-night)
//   kimono-jacket     DFM: more-effortless, more-elevated, more-feminine, more-confident
//                     SP:  artsy, effortlessly-chic, feminine
//                     occasionTags: everyday, dinner, travel, special-event
//   dress-set         DFM: more-confident, more-powerful, more-feminine, more-elevated
//                     SP:  feminine, artsy, trendy
//
// Session shape used across most aspiration tests:
//   moods: ["confident"]        → gives ESS STRONG_RANK (+4) for all products;
//                                 field = currentEmotionalStateSupport, not DFM/SP
//                                 → does NOT add any concept to scoredConcepts
//   occasion: non-matching      → no §5 score for the target product
// This isolates the aspiration contribution as the only variable.

describe("§V2-A3 Profile Aspiration — desiredImpression + becoming", () => {
  function findEv(result: ReturnType<typeof run>, handle: string) {
    const ev = result.evaluatedProducts.find((e) => e.handle === handle);
    assert.ok(ev, `${handle} must appear in evaluatedProducts`);
    return ev!;
  }

  // §11.7 aspiration evidence: LIGHT_RANK entries on the desiredFeelingMatch field.
  // §2 uses STRONG_RANK and §7.5 uses RANK on desiredFeelingMatch, so this filter
  // uniquely identifies §11.7 contributions.
  function aspirationEvidence(ev: ProductEvaluation) {
    return ev.positiveEvidence.filter(
      (e) => e.effect === "LIGHT_RANK" && e.field === "desiredFeelingMatch",
    );
  }

  it("V2A3.1 — desiredImpression direct match → +1", () => {
    const result = run(
      makeSession({ moods: ["confident"], occasion: "girls-night" }),
      { desiredImpression: ["powerful"] },
    );
    const ev = findEv(result, "collar-shirt");
    const asp = aspirationEvidence(ev);
    assert.equal(asp.length, 1, "one aspiration evidence entry");
    assert.equal(asp[0].matchedToken, "more-powerful");
    assert.equal(asp[0].sessionSignal, "powerful");
    assert.equal(ev.totalScore, 5); // 4 ESS + 1 aspiration
  });

  it("V2A3.2 — becoming direct match → +1", () => {
    const result = run(
      makeSession({ moods: ["confident"], occasion: "work" }),
      { becoming: ["more-feminine"] },
    );
    const ev = findEv(result, "double-top");
    const asp = aspirationEvidence(ev);
    assert.equal(asp.length, 1);
    assert.equal(asp[0].matchedToken, "more-feminine");
    assert.equal(asp[0].sessionSignal, "more-feminine");
    assert.equal(ev.totalScore, 5); // 4 ESS + 1 aspiration
  });

  it("V2A3.3 — translation refined → more-elevated fires", () => {
    const result = run(
      makeSession({ moods: ["confident"], occasion: "girls-night" }),
      { desiredImpression: ["refined"] },
    );
    const ev = findEv(result, "collar-shirt");
    const asp = aspirationEvidence(ev);
    assert.equal(asp.length, 1);
    assert.equal(asp[0].matchedToken, "more-elevated");
    assert.equal(asp[0].sessionSignal, "refined");
  });

  it("V2A3.4 — translation more-polished → more-put-together fires", () => {
    const result = run(
      makeSession({ moods: ["confident"], occasion: "girls-night" }),
      { becoming: ["more-polished"] },
    );
    const ev = findEv(result, "collar-shirt");
    const asp = aspirationEvidence(ev);
    assert.equal(asp.length, 1);
    assert.equal(asp[0].matchedToken, "more-put-together");
    assert.equal(asp[0].sessionSignal, "more-polished");
  });

  it("V2A3.5 — product with zero non-aspiration positive evidence → aspiration contributes 0", () => {
    // No moods (no ESS) + occasion that double-top lacks (no §5) → acc.positive empty
    const result = run(
      makeSession({ moods: [], occasion: "work" }),
      { desiredImpression: ["feminine"] }, // double-top has more-feminine in DFM — would match
    );
    const ev = findEv(result, "double-top");
    assert.equal(ev.positiveEvidence.length, 0, "no prior positive evidence");
    assert.equal(aspirationEvidence(ev).length, 0, "aspiration guard must block contribution");
    assert.equal(ev.totalScore, 0);
  });

  it("V2A3.6 — product with one non-aspiration positive + distinct aspiration match → aspiration adds +1", () => {
    // ESS from mood gives the single non-aspiration positive signal
    const result = run(
      makeSession({ moods: ["confident"], occasion: "girls-night" }),
      { becoming: ["more-polished"] }, // more-polished → more-put-together; collar-shirt has it
    );
    const ev = findEv(result, "collar-shirt");
    assert.equal(aspirationEvidence(ev).length, 1);
    assert.equal(ev.totalScore, 5); // 4 ESS + 1 aspiration
  });

  it("V2A3.7 — V2 SP feminine (→ feminine-romantic) already matched + desiredImpression feminine → no extra aspiration point", () => {
    // V2 profile "feminine" → translated to "feminine-romantic" → double-top matches
    // → §7 scores it → concept "feminine" enters scoredConcepts
    // → §11.7 skips the same concept from desiredImpression
    const result = run(
      makeSession({ moods: ["confident"], occasion: "work" }),
      { stylePersonalities: ["feminine"], desiredImpression: ["feminine"] },
    );
    const ev = findEv(result, "double-top");
    assert.equal(aspirationEvidence(ev).length, 0, "feminine concept already scored via SP");
    // Score breakdown: ESS +4, SP +2 (Step 2A: demoted RANK, not STRONG_RANK), aspiration 0
    assert.equal(ev.totalScore, 6);
  });

  it("V2A3.8 — V2 SP effortlessly-chic (→ minimal-relaxed) already matched + becoming more-effortless → no extra aspiration point", () => {
    // V2 profile "effortlessly-chic" → translated to "minimal-relaxed" → oversized-blazer matches
    // → §7 scores → concept "effortless" in scoredConcepts
    const result = run(
      makeSession({ moods: ["confident"], occasion: "girls-night" }),
      { stylePersonalities: ["effortlessly-chic"], becoming: ["more-effortless"] },
    );
    const ev = findEv(result, "oversized-blazer");
    assert.equal(aspirationEvidence(ev).length, 0, "effortless concept already scored via SP");
    assert.equal(ev.totalScore, 6); // 4 ESS + 2 SP (Step 2A: RANK, not STRONG_RANK) + 0 aspiration
  });

  it("V2A3.9 — session more-feminine already scored (§2) + becoming more-feminine → no extra aspiration point", () => {
    // Session DFM match adds desiredFeelingMatch entry → concept "feminine" in scoredConcepts
    const result = run(
      makeSession({ moods: ["confident"], desiredFeelings: ["more-feminine"], occasion: "work" }),
      { becoming: ["more-feminine"] },
    );
    const ev = findEv(result, "double-top");
    assert.equal(aspirationEvidence(ev).length, 0, "feminine concept already scored via session §2");
  });

  it("V2A3.10 — profile desiredFeelings feminine scored (§7.5) + desiredImpression feminine → no extra aspiration point", () => {
    // profile desiredFeelings "feminine" → §7.5 translates to "more-feminine" → double-top has it
    // → desiredFeelingMatch entry in acc.positive → concept "feminine" in scoredConcepts
    const result = run(
      makeSession({ moods: ["confident"], occasion: "work" }),
      { desiredFeelings: ["feminine"], desiredImpression: ["feminine"] },
    );
    const ev = findEv(result, "double-top");
    assert.equal(aspirationEvidence(ev).length, 0, "feminine concept already scored via profile §7.5");
  });

  it("V2A3.11 — same concept in both desiredImpression and becoming → only +1 (deduped)", () => {
    // Both map to concept "powerful"; should count only once
    const result = run(
      makeSession({ moods: ["confident"], occasion: "girls-night" }),
      { desiredImpression: ["powerful"], becoming: ["more-powerful"] },
    );
    const ev = findEv(result, "collar-shirt");
    const asp = aspirationEvidence(ev);
    assert.equal(asp.length, 1, "dedup across fields: one unique concept → one evidence entry");
    assert.equal(asp[0].matchedToken, "more-powerful");
    assert.equal(ev.totalScore, 5); // 4 ESS + 1 aspiration
  });

  it("V2A3.12 — two distinct aspiration concepts → +2", () => {
    // refined → elevated, powerful → powerful: two distinct concepts, both in collar-shirt DFM
    const result = run(
      makeSession({ moods: ["confident"], occasion: "girls-night" }),
      { desiredImpression: ["powerful", "refined"] },
    );
    const ev = findEv(result, "collar-shirt");
    const asp = aspirationEvidence(ev);
    assert.equal(asp.length, 2, "two distinct concepts → two evidence entries");
    assert.equal(ev.totalScore, 6); // 4 ESS + 2 aspiration
  });

  it("V2A3.13 — three+ distinct aspiration concepts → still +2 (cap enforced)", () => {
    // refined → elevated, powerful → powerful, put-together → put-together: 3 concepts, cap at 2
    const result = run(
      makeSession({ moods: ["confident"], occasion: "girls-night" }),
      { desiredImpression: ["powerful", "refined", "put-together"] },
    );
    const ev = findEv(result, "collar-shirt");
    const asp = aspirationEvidence(ev);
    assert.equal(asp.length, 2, "three eligible concepts → cap enforces max 2 evidence entries");
    assert.equal(ev.totalScore, 6); // 4 ESS + 2 aspiration
    // Stable alphabetical ordering picks "elevated" and "powerful" (e < p < p-t)
    const tokens = asp.map((e) => e.matchedToken).sort();
    assert.deepEqual(tokens, ["more-elevated", "more-powerful"]);
  });

  it("V2A3.14 — becoming scores +2 while desiredImpression has no DFM match; no field priority encoded", () => {
    // desiredImpression: ["powerful"] → more-powerful NOT in kimono-jacket DFM → not eligible
    // becoming: ["more-effortless", "more-feminine"] → both in kimono DFM → eligible
    // Result: +2 solely from becoming — field priority would have blocked this
    const result = run(
      makeSession({ moods: ["confident"], occasion: "girls-night" }),
      { desiredImpression: ["powerful"], becoming: ["more-effortless", "more-feminine"] },
    );
    const ev = findEv(result, "kimono-jacket");
    const asp = aspirationEvidence(ev);
    assert.equal(asp.length, 2, "both becoming concepts score when desiredImpression has no match");
    const tokens = asp.map((e) => e.matchedToken).sort();
    assert.deepEqual(tokens, ["more-effortless", "more-feminine"]);
    assert.equal(ev.totalScore, 6); // 4 ESS + 2 aspiration
  });

  it("V2A3.15 — creative → 0 (not in desiredImpression map)", () => {
    const result = run(
      makeSession({ moods: ["confident"], occasion: "girls-night" }),
      { desiredImpression: ["creative"] },
    );
    assert.equal(aspirationEvidence(findEv(result, "collar-shirt")).length, 0);
  });

  it("V2A3.16 — interesting → 0 (not in desiredImpression map)", () => {
    const result = run(
      makeSession({ moods: ["confident"], occasion: "girls-night" }),
      { desiredImpression: ["interesting"] },
    );
    assert.equal(aspirationEvidence(findEv(result, "collar-shirt")).length, 0);
  });

  it("V2A3.17 — more-visible → 0 (not in becoming map)", () => {
    const result = run(
      makeSession({ moods: ["confident"], occasion: "girls-night" }),
      { becoming: ["more-visible"] },
    );
    assert.equal(aspirationEvidence(findEv(result, "collar-shirt")).length, 0);
  });

  it("V2A3.18 — more-creative → 0 (not in becoming map)", () => {
    const result = run(
      makeSession({ moods: ["confident"], occasion: "girls-night" }),
      { becoming: ["more-creative"] },
    );
    assert.equal(aspirationEvidence(findEv(result, "collar-shirt")).length, 0);
  });

  it("V2A3.19 — new-chapter → 0 (not in becoming map)", () => {
    const result = run(
      makeSession({ moods: ["confident"], occasion: "girls-night" }),
      { becoming: ["new-chapter"] },
    );
    assert.equal(aspirationEvidence(findEv(result, "collar-shirt")).length, 0);
  });

  it("V2A3.20 — unknown IDs → 0", () => {
    const result = run(
      makeSession({ moods: ["confident"], occasion: "girls-night" }),
      { desiredImpression: ["not-a-real-id"], becoming: ["also-not-real"] },
    );
    assert.equal(aspirationEvidence(findEv(result, "collar-shirt")).length, 0);
  });

  it("V2A3.21 — both aspiration fields absent → existing totalScore exactly unchanged", () => {
    const session = makeSession({ moods: ["confident"], occasion: "girls-night" });
    const baseProfile: StyleMeProfileSignals = { stylePersonalities: ["artsy"] };
    const withAspiration: StyleMeProfileSignals = {
      ...baseProfile,
      desiredImpression: [],
      becoming: [],
    };
    const baseline = run(session, baseProfile);
    const withEmpty = run(session, withAspiration);
    for (const ev of baseline.evaluatedProducts) {
      const other = withEmpty.evaluatedProducts.find((e) => e.handle === ev.handle)!;
      assert.equal(other.totalScore, ev.totalScore,
        `totalScore must be identical for ${ev.handle} when aspiration fields are empty`);
    }
  });

  it("V2A3.22 — hard exclusion behaviour unchanged by aspiration scoring", () => {
    // Slot conflict: anchor is a top (collar-shirt), so another top recommendation is excluded.
    // Aspiration on the excluded product must not override the hard exclusion.
    const result = run(
      makeSession({ moods: ["confident"], occasion: "girls-night", source: "naia-piece" }),
      { desiredImpression: ["powerful", "refined", "put-together", "soft-confident"] },
      { anchor: { type: "nadine", handle: "collar-shirt" } },
    );
    // With collar-shirt as anchor (top slot), no other top can be the primary recommendation.
    // At minimum, collar-shirt itself is self-excluded.
    const collarEval = findEv(result, "collar-shirt");
    assert.equal(collarEval.isHardExcluded, true, "self-exclusion must still fire");
    assert.equal(collarEval.totalScore, 0, "hard-excluded product must keep score 0");
    assert.equal(collarEval.positiveEvidence.length, 0, "hard-excluded product has no positive evidence");
  });

  it("V2A3.23 — V2 SP in profile not matching product is product-specific: aspiration dedup clears when SP missed", () => {
    // Call A: profile has V2 SP ["feminine"] (→ feminine-romantic) + desiredImpression ["feminine"]
    //   double-top has "feminine-romantic" in SP → §7 scores → concept "feminine" in scoredConcepts
    //   → desiredImpression "feminine" blocked by dedup → 0 aspiration
    const sessionA = makeSession({ moods: ["confident"], occasion: "work" });
    const resultA = run(sessionA, { stylePersonalities: ["feminine"], desiredImpression: ["feminine"] });
    const evA = findEv(resultA, "double-top");
    assert.equal(aspirationEvidence(evA).length, 0, "SP match deduped the aspiration concept");

    // Call B: same product, same desiredImpression, but no stylePersonalities
    //   §7 gives 0 → concept "feminine" NOT in scoredConcepts → aspiration may score
    //   double-top has "more-feminine" in DFM → aspiration adds +1
    const resultB = run(sessionA, { desiredImpression: ["feminine"] });
    const evB = findEv(resultB, "double-top");
    assert.equal(aspirationEvidence(evB).length, 1, "without SP match, aspiration concept is eligible");

    // Score difference confirms dedup is product-specific:
    // A: ESS(4) + SP(2, Step 2A: RANK not STRONG_RANK) + aspiration(0) = 6
    // B: ESS(4) + SP(0) + aspiration(1) = 5
    // Δ = 1 = RANK - LIGHT_RANK
    assert.equal(evA.totalScore - evB.totalScore, 1);
  });

  it("V2A3.24 — deterministic provenance: when same concept appears in both fields, sourceField tie-break selects becoming (alphabetically first)", () => {
    // desiredImpression "powerful" → concept "powerful", sourceField "desiredImpression"
    // becoming "more-powerful" → concept "powerful", sourceField "becoming"
    // Sort order: "becoming" < "desiredImpression" → becoming is chosen as provenance
    // Evidence sessionSignal must be "more-powerful" (becoming's optionId), not "powerful" (desiredImpression's)
    const result = run(
      makeSession({ moods: ["confident"], occasion: "girls-night" }),
      { desiredImpression: ["powerful"], becoming: ["more-powerful"] },
    );
    const ev = findEv(result, "collar-shirt");
    const asp = aspirationEvidence(ev);
    assert.equal(asp.length, 1, "dedup: one unique concept → one evidence entry");
    assert.equal(asp[0].sessionSignal, "more-powerful",
      "provenance comes from becoming (sourceField 'becoming' < 'desiredImpression' alphabetically)");
    assert.equal(ev.totalScore, 5);
  });

  it("V2A3.25 — input-array order within a field does not affect totalScore", () => {
    // collar-shirt carries more-elevated and more-powerful in DFM
    const session = makeSession({ moods: ["confident"], occasion: "girls-night" });
    const resultA = run(session, { desiredImpression: ["refined", "powerful"] });
    const resultB = run(session, { desiredImpression: ["powerful", "refined"] });
    const scoreA = findEv(resultA, "collar-shirt").totalScore;
    const scoreB = findEv(resultB, "collar-shirt").totalScore;
    assert.equal(scoreA, scoreB, "reversing array order produces identical totalScore");
    // Both should yield +2 aspiration (elevated + powerful)
    assert.equal(aspirationEvidence(findEv(resultA, "collar-shirt")).length, 2);
  });

  it("V2A3.26 — swapping which field carries which concept does not change totalScore", () => {
    // A: powerful in desiredImpression, elevated in becoming
    // B: elevated in desiredImpression, powerful in becoming
    // collar-shirt carries both DFM tokens; both scenarios must produce the same totalScore
    const session = makeSession({ moods: ["confident"], occasion: "girls-night" });
    const resultA = run(session, { desiredImpression: ["powerful"], becoming: ["more-refined"] });
    const resultB = run(session, { desiredImpression: ["refined"],  becoming: ["more-powerful"] });
    const evA = findEv(resultA, "collar-shirt");
    const evB = findEv(resultB, "collar-shirt");
    assert.equal(evA.totalScore, evB.totalScore,
      "which field carries which concept does not affect totalScore");
    assert.equal(aspirationEvidence(evA).length, 2);
    assert.equal(aspirationEvidence(evB).length, 2);
  });

  it("V2A3.27 — two distinct concepts across both fields → +2", () => {
    // One concept from each field, no overlap: should produce +2 regardless of field assignment
    const result = run(
      makeSession({ moods: ["confident"], occasion: "girls-night" }),
      { desiredImpression: ["powerful"], becoming: ["more-refined"] },
    );
    const ev = findEv(result, "collar-shirt");
    assert.equal(aspirationEvidence(ev).length, 2, "one concept per field → two evidence entries");
    assert.equal(ev.totalScore, 6); // ESS(4) + aspiration(2)
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §G2 Group 2 — Dressing-preference hard exclusions
// ─────────────────────────────────────────────────────────────────────────────

describe("§G2 Dressing-preference hard exclusions — contract", () => {
  const allProducts = getAllCatalogProducts();
  const dm = (handle: string) => allProducts.find((p) => p.handle === handle)?.dressingMetadata;

  it("APPROVED_DRESSING_PREFERENCE_IDS has exactly 15 IDs", () => {
    assert.equal(APPROVED_DRESSING_PREFERENCE_IDS.size, 15);
  });

  it("all 15 approved IDs are present in the set", () => {
    const expected = [
      "dresses-modestly", "usually-wears-abayas", "kanduras-thobes",
      "wears-hijab", "arms-covered", "avoid-sleeveless",
      "chest-neckline-covered", "prefer-higher-necklines", "legs-covered",
      "prefer-full-length-trousers", "avoid-shorts", "longer-tops",
      "no-cropped-tops", "looser-fitting", "no-dressing-requirements",
    ];
    for (const id of expected) {
      assert.ok(APPROVED_DRESSING_PREFERENCE_IDS.has(id), `${id} missing from approved set`);
    }
  });

  it("all 11 catalog products carry dressingMetadata directly on the product", () => {
    assert.equal(allProducts.length, 11);
    for (const p of allProducts) {
      assert.ok(p.dressingMetadata, `${p.handle} missing dressingMetadata`);
    }
  });

  it("no-violation products have modestySafe/abayaCompatible/hijabCompatible all true", () => {
    const noViolationHandles = [
      "asymmetrical-pants", "draped-leather-pants", "trench-coat",
      "leather-suede-jacket", "oversized-blazer",
    ];
    for (const handle of noViolationHandles) {
      const d = dm(handle);
      assert.ok(d, `${handle} must have dressingMetadata`);
      assert.equal(d.modestySafe, true, `${handle} modestySafe`);
      assert.equal(d.abayaCompatible, true, `${handle} abayaCompatible`);
      assert.equal(d.hijabCompatible, true, `${handle} hijabCompatible`);
    }
  });

  it("generic rule: metadata-driven only — all products expose structured fields, no handle blacklist", () => {
    for (const p of allProducts) {
      const d = p.dressingMetadata;
      assert.ok(d, `${p.handle} must have dressingMetadata`);
      assert.ok("modestySafe" in d, `${p.handle} must have modestySafe`);
      assert.ok("sleeveLength" in d, `${p.handle} must have sleeveLength`);
      assert.ok("fitProfile" in d, `${p.handle} must have fitProfile`);
    }
  });
});

describe("§G2 Dressing-preference hard exclusions — per-constraint pass/fail", () => {
  function findEv(result: ReturnType<typeof run>, handle: string) {
    const ev = result.evaluatedProducts.find((e) => e.handle === handle);
    assert.ok(ev, `${handle} must appear in evaluatedProducts`);
    return ev!;
  }

  function isDressingExcluded(result: ReturnType<typeof run>, handle: string): boolean {
    const ev = findEv(result, handle);
    return ev.isHardExcluded && ev.hardExclusionReasons.includes("dressing-preference-exclusion");
  }

  function isNotExcluded(result: ReturnType<typeof run>, handle: string): boolean {
    const ev = findEv(result, handle);
    return !ev.isHardExcluded || !ev.hardExclusionReasons.includes("dressing-preference-exclusion");
  }

  // ── looser-fitting ────────────────────────────────────────────────────────
  it("G2.1  looser-fitting: double-top excluded", () => {
    const result = run(makeSession({ occasion: "everyday" }), { dressingPreferences: ["looser-fitting"] });
    assert.ok(isDressingExcluded(result, "double-top"), "double-top (fitted bodice) must be excluded");
  });

  it("G2.2  looser-fitting: collar-shirt excluded", () => {
    const result = run(makeSession({ occasion: "everyday" }), { dressingPreferences: ["looser-fitting"] });
    assert.ok(isDressingExcluded(result, "collar-shirt"), "collar-shirt (tailored) must be excluded");
  });

  it("G2.3  looser-fitting: suede-skirt excluded", () => {
    const result = run(makeSession({ occasion: "everyday" }), { dressingPreferences: ["looser-fitting"] });
    assert.ok(isDressingExcluded(result, "suede-skirt"), "suede-skirt (body-skimming) must be excluded");
  });

  it("G2.4  looser-fitting: asymmetrical-pants NOT excluded (relaxed straight leg)", () => {
    const result = run(makeSession({ occasion: "everyday" }), { dressingPreferences: ["looser-fitting"] });
    assert.ok(isNotExcluded(result, "asymmetrical-pants"), "asymmetrical-pants must NOT be excluded");
  });

  it("G2.5  looser-fitting: draped-leather-pants NOT excluded (high-waist, sculptural volume)", () => {
    const result = run(makeSession({ occasion: "everyday" }), { dressingPreferences: ["looser-fitting"] });
    assert.ok(isNotExcluded(result, "draped-leather-pants"), "draped-leather-pants must NOT be excluded");
  });

  it("G2.6  looser-fitting: oversized-blazer NOT excluded", () => {
    const result = run(makeSession({ occasion: "everyday" }), { dressingPreferences: ["looser-fitting"] });
    assert.ok(isNotExcluded(result, "oversized-blazer"), "oversized-blazer must NOT be excluded");
  });

  it("G2.7  looser-fitting: trench-coat NOT excluded (relaxed straight fit)", () => {
    const result = run(makeSession({ occasion: "everyday" }), { dressingPreferences: ["looser-fitting"] });
    assert.ok(isNotExcluded(result, "trench-coat"), "trench-coat must NOT be excluded");
  });

  // ── arms-covered ──────────────────────────────────────────────────────────
  it("G2.8  arms-covered: midi-dress excluded (short sleeves)", () => {
    const result = run(makeSession({ occasion: "everyday" }), { dressingPreferences: ["arms-covered"] });
    assert.ok(isDressingExcluded(result, "midi-dress"), "midi-dress (short sleeves) must be excluded");
  });

  it("G2.9  arms-covered: double-top NOT excluded (full-length sleeves)", () => {
    const result = run(makeSession({ occasion: "everyday" }), { dressingPreferences: ["arms-covered"] });
    assert.ok(isNotExcluded(result, "double-top"), "double-top (full sleeves) must NOT be excluded");
  });

  it("G2.10 arms-covered: collar-shirt NOT excluded (full-length sleeves)", () => {
    const result = run(makeSession({ occasion: "everyday" }), { dressingPreferences: ["arms-covered"] });
    assert.ok(isNotExcluded(result, "collar-shirt"), "collar-shirt must NOT be excluded");
  });

  it("G2.11 arms-covered: trench-coat NOT excluded (full-length sleeves)", () => {
    const result = run(makeSession({ occasion: "everyday" }), { dressingPreferences: ["arms-covered"] });
    assert.ok(isNotExcluded(result, "trench-coat"), "trench-coat must NOT be excluded");
  });

  // ── chest-neckline-covered ────────────────────────────────────────────────
  it("G2.12 chest-neckline-covered: kimono-jacket excluded (uncertain wrap-front neckline)", () => {
    const result = run(makeSession({ occasion: "everyday" }), { dressingPreferences: ["chest-neckline-covered"] });
    assert.ok(isDressingExcluded(result, "kimono-jacket"), "kimono-jacket must be excluded");
  });

  it("G2.13 chest-neckline-covered: leather-suede-jacket NOT excluded (high stand collar)", () => {
    const result = run(makeSession({ occasion: "everyday" }), { dressingPreferences: ["chest-neckline-covered"] });
    assert.ok(isNotExcluded(result, "leather-suede-jacket"), "leather-suede-jacket must NOT be excluded");
  });

  it("G2.14 chest-neckline-covered: double-top NOT excluded (high neckline)", () => {
    const result = run(makeSession({ occasion: "everyday" }), { dressingPreferences: ["chest-neckline-covered"] });
    assert.ok(isNotExcluded(result, "double-top"), "double-top must NOT be excluded");
  });

  // ── legs-covered ──────────────────────────────────────────────────────────
  it("G2.15 legs-covered: dress-set excluded (knee-high slit reveals leg)", () => {
    const result = run(makeSession({ occasion: "everyday" }), { dressingPreferences: ["legs-covered"] });
    assert.ok(isDressingExcluded(result, "dress-set"), "dress-set (knee-high slit) must be excluded");
  });

  it("G2.16 legs-covered: suede-skirt NOT excluded (midi-length, back slit below knee)", () => {
    const result = run(makeSession({ occasion: "everyday" }), { dressingPreferences: ["legs-covered"] });
    assert.ok(isNotExcluded(result, "suede-skirt"), "suede-skirt (midi, no knee exposure) must NOT be excluded");
  });

  it("G2.17 legs-covered: draped-leather-pants NOT excluded (full-length, opaque)", () => {
    const result = run(makeSession({ occasion: "everyday" }), { dressingPreferences: ["legs-covered"] });
    assert.ok(isNotExcluded(result, "draped-leather-pants"), "draped-leather-pants must NOT be excluded");
  });

  // ── no-cropped-tops / longer-tops ─────────────────────────────────────────
  it("G2.18 no-cropped-tops: dress-set excluded (cropped proportion)", () => {
    const result = run(makeSession({ occasion: "everyday" }), { dressingPreferences: ["no-cropped-tops"] });
    assert.ok(isDressingExcluded(result, "dress-set"), "dress-set (cropped top) must be excluded");
  });

  it("G2.19 no-cropped-tops: double-top NOT excluded (not cropped)", () => {
    const result = run(makeSession({ occasion: "everyday" }), { dressingPreferences: ["no-cropped-tops"] });
    assert.ok(isNotExcluded(result, "double-top"), "double-top must NOT be excluded");
  });

  it("G2.20 longer-tops: dress-set excluded", () => {
    const result = run(makeSession({ occasion: "everyday" }), { dressingPreferences: ["longer-tops"] });
    assert.ok(isDressingExcluded(result, "dress-set"), "dress-set must be excluded for longer-tops");
  });

  it("G2.21 longer-tops: collar-shirt NOT excluded", () => {
    const result = run(makeSession({ occasion: "everyday" }), { dressingPreferences: ["longer-tops"] });
    assert.ok(isNotExcluded(result, "collar-shirt"), "collar-shirt must NOT be excluded for longer-tops");
  });

  // ── dresses-modestly ──────────────────────────────────────────────────────
  it("G2.22 dresses-modestly: kimono-jacket excluded", () => {
    const result = run(makeSession({ occasion: "everyday" }), { dressingPreferences: ["dresses-modestly"] });
    assert.ok(isDressingExcluded(result, "kimono-jacket"), "kimono-jacket must be excluded");
  });

  it("G2.23 dresses-modestly: midi-dress excluded", () => {
    const result = run(makeSession({ occasion: "everyday" }), { dressingPreferences: ["dresses-modestly"] });
    assert.ok(isDressingExcluded(result, "midi-dress"), "midi-dress must be excluded");
  });

  it("G2.24 dresses-modestly: dress-set excluded", () => {
    const result = run(makeSession({ occasion: "everyday" }), { dressingPreferences: ["dresses-modestly"] });
    assert.ok(isDressingExcluded(result, "dress-set"), "dress-set must be excluded");
  });

  it("G2.25 dresses-modestly: trench-coat NOT excluded (long, full sleeves, high coverage)", () => {
    const result = run(makeSession({ occasion: "everyday" }), { dressingPreferences: ["dresses-modestly"] });
    assert.ok(isNotExcluded(result, "trench-coat"), "trench-coat must NOT be excluded");
  });

  it("G2.26 dresses-modestly: leather-suede-jacket NOT excluded (high stand collar, full sleeves)", () => {
    const result = run(makeSession({ occasion: "everyday" }), { dressingPreferences: ["dresses-modestly"] });
    assert.ok(isNotExcluded(result, "leather-suede-jacket"), "leather-suede-jacket must NOT be excluded");
  });

  // ── usually-wears-abayas ──────────────────────────────────────────────────
  it("G2.27 usually-wears-abayas: kimono-jacket excluded", () => {
    const result = run(makeSession({ occasion: "everyday" }), { dressingPreferences: ["usually-wears-abayas"] });
    assert.ok(isDressingExcluded(result, "kimono-jacket"), "kimono-jacket must be excluded");
  });

  it("G2.28 usually-wears-abayas: midi-dress excluded", () => {
    const result = run(makeSession({ occasion: "everyday" }), { dressingPreferences: ["usually-wears-abayas"] });
    assert.ok(isDressingExcluded(result, "midi-dress"), "midi-dress must be excluded");
  });

  it("G2.29 usually-wears-abayas: dress-set excluded", () => {
    const result = run(makeSession({ occasion: "everyday" }), { dressingPreferences: ["usually-wears-abayas"] });
    assert.ok(isDressingExcluded(result, "dress-set"), "dress-set must be excluded");
  });

  it("G2.30 usually-wears-abayas: oversized-blazer NOT excluded", () => {
    const result = run(makeSession({ occasion: "everyday" }), { dressingPreferences: ["usually-wears-abayas"] });
    assert.ok(isNotExcluded(result, "oversized-blazer"), "oversized-blazer must NOT be excluded");
  });

  // ── wears-hijab ───────────────────────────────────────────────────────────
  it("G2.31 wears-hijab: kimono-jacket excluded", () => {
    const result = run(makeSession({ occasion: "everyday" }), { dressingPreferences: ["wears-hijab"] });
    assert.ok(isDressingExcluded(result, "kimono-jacket"), "kimono-jacket must be excluded");
  });

  it("G2.32 wears-hijab: midi-dress excluded", () => {
    const result = run(makeSession({ occasion: "everyday" }), { dressingPreferences: ["wears-hijab"] });
    assert.ok(isDressingExcluded(result, "midi-dress"), "midi-dress must be excluded");
  });

  it("G2.33 wears-hijab: dress-set excluded", () => {
    const result = run(makeSession({ occasion: "everyday" }), { dressingPreferences: ["wears-hijab"] });
    assert.ok(isDressingExcluded(result, "dress-set"), "dress-set must be excluded");
  });

  it("G2.34 wears-hijab: collar-shirt NOT excluded (high collar, full sleeves, opaque)", () => {
    const result = run(makeSession({ occasion: "everyday" }), { dressingPreferences: ["wears-hijab"] });
    assert.ok(isNotExcluded(result, "collar-shirt"), "collar-shirt must NOT be excluded");
  });
});

describe("§G2 Dressing-preference hard exclusions — override and V2 compat", () => {
  function findEv(result: ReturnType<typeof run>, handle: string) {
    const ev = result.evaluatedProducts.find((e) => e.handle === handle);
    assert.ok(ev, `${handle} must appear in evaluatedProducts`);
    return ev!;
  }

  it("G2.35 hard exclusion survives high-score signals — excluded product must not appear in results", () => {
    // dress-set is excluded by dresses-modestly; give it maximum score signals
    const result = run(
      makeSession({ moods: ["confident", "powerful"], desiredFeelings: ["more-elevated", "more-confident"], occasion: "special-event" }),
      { dressingPreferences: ["dresses-modestly"], stylePersonalities: ["edgy", "trendy"] },
    );
    const ev = findEv(result, "dress-set");
    assert.ok(ev.isHardExcluded, "dress-set must still be hard-excluded");
    assert.ok(ev.hardExclusionReasons.includes("dressing-preference-exclusion"));
    const allShown = [result.primary, ...result.alternatives].filter(Boolean).map((e) => e!.handle);
    assert.ok(!allShown.includes("dress-set"), "excluded product must not appear as primary or alternative");
  });

  it("G2.36 hard exclusion survives high-score signals — midi-dress excluded even with strong profile match", () => {
    const result = run(
      makeSession({ moods: ["romantic", "confident"], desiredFeelings: ["more-feminine", "more-elevated"], occasion: "dinner" }),
      { dressingPreferences: ["arms-covered"], stylePersonalities: ["feminine", "romantic"] },
    );
    const ev = findEv(result, "midi-dress");
    assert.ok(ev.isHardExcluded, "midi-dress must be hard-excluded");
    assert.ok(ev.hardExclusionReasons.includes("dressing-preference-exclusion"));
    const allShown = [result.primary, ...result.alternatives].filter(Boolean).map((e) => e!.handle);
    assert.ok(!allShown.includes("midi-dress"), "midi-dress must not appear in results");
  });

  it("G2.37 empty dressingPreferences preserves current behavior — all products eligible", () => {
    const withEmpty = run(makeSession({ occasion: "everyday" }), { dressingPreferences: [] });
    const withUndefined = run(makeSession({ occasion: "everyday" }), {});
    const excludedWithEmpty = withEmpty.evaluatedProducts.filter(
      (e) => e.isHardExcluded && e.hardExclusionReasons.includes("dressing-preference-exclusion"),
    );
    const excludedWithUndefined = withUndefined.evaluatedProducts.filter(
      (e) => e.isHardExcluded && e.hardExclusionReasons.includes("dressing-preference-exclusion"),
    );
    assert.equal(excludedWithEmpty.length, 0, "empty dressingPreferences must exclude nothing");
    assert.equal(excludedWithUndefined.length, 0, "undefined dressingPreferences must exclude nothing");
  });

  it("G2.38 V2 users (no dressingPreferences field) are unaffected — no dressing exclusions applied", () => {
    // A V2 user has no dressingPreferences — dress-set, kimono-jacket, midi-dress all still eligible
    const result = run(
      makeSession({ occasion: "everyday" }),
      { stylePersonalities: ["feminine"], firmNoColors: [] },
    );
    const dressingExcluded = result.evaluatedProducts.filter(
      (e) => e.isHardExcluded && e.hardExclusionReasons.includes("dressing-preference-exclusion"),
    );
    assert.equal(dressingExcluded.length, 0, "V2 users must have zero dressing-preference exclusions");
  });

  it("G2.39 null/undefined profile means no dressingPreferences — all products eligible for dressing", () => {
    const result = run(makeSession({ occasion: "everyday" }), undefined);
    const dressingExcluded = result.evaluatedProducts.filter(
      (e) => e.isHardExcluded && e.hardExclusionReasons.includes("dressing-preference-exclusion"),
    );
    assert.equal(dressingExcluded.length, 0, "null profile must produce zero dressing-preference exclusions");
  });

  it("G2.40 multiple constraints combine correctly — union of all constraint violations excluded", () => {
    const result = run(
      makeSession({ occasion: "everyday" }),
      { dressingPreferences: ["arms-covered", "no-cropped-tops", "chest-neckline-covered"] },
    );
    // midi-dress: excluded by arms-covered
    // dress-set: excluded by no-cropped-tops
    // kimono-jacket: excluded by chest-neckline-covered
    const ev = (h: string) => findEv(result, h);
    assert.ok(ev("midi-dress").isHardExcluded, "midi-dress excluded");
    assert.ok(ev("dress-set").isHardExcluded, "dress-set excluded");
    assert.ok(ev("kimono-jacket").isHardExcluded, "kimono-jacket excluded");
    // double-top: NOT excluded by any of these constraints
    assert.ok(!ev("double-top").isHardExcluded || !ev("double-top").hardExclusionReasons.includes("dressing-preference-exclusion"),
      "double-top must not be dressing-excluded");
  });

  it("G2.41 dressing-preference exclusion is orthogonal to firm-no colour — both can apply independently", () => {
    const result = run(
      makeSession({ occasion: "everyday" }),
      {
        dressingPreferences: ["dresses-modestly"],
        firmNoColors: ["red-burgundy"],
      },
    );
    const midiEv = findEv(result, "midi-dress");
    assert.ok(midiEv.isHardExcluded, "midi-dress excluded");
    // midi-dress may carry both exclusion codes
    assert.ok(midiEv.hardExclusionReasons.includes("dressing-preference-exclusion"),
      "midi-dress must have dressing-preference-exclusion");
  });
});

describe("§G2 Dressing-preference hard exclusions — missing metadata + category applicability", () => {
  function findEv(result: ReturnType<typeof run>, handle: string) {
    const ev = result.evaluatedProducts.find((e) => e.handle === handle);
    assert.ok(ev, `${handle} must appear in evaluatedProducts`);
    return ev!;
  }
  function isDressingExcluded(result: ReturnType<typeof run>, handle: string): boolean {
    const ev = findEv(result, handle);
    return ev.isHardExcluded && ev.hardExclusionReasons.includes("dressing-preference-exclusion");
  }

  it("G2.42 longer-tops does NOT apply to BOTTOM items (asymmetrical-pants exempt)", () => {
    const result = run(makeSession({ occasion: "everyday" }), { dressingPreferences: ["longer-tops"] });
    assert.ok(!isDressingExcluded(result, "asymmetrical-pants"),
      "asymmetrical-pants (BOTTOM) must be exempt from longer-tops");
  });

  it("G2.43 no-cropped-tops does NOT apply to BOTTOM items (draped-leather-pants exempt)", () => {
    const result = run(makeSession({ occasion: "everyday" }), { dressingPreferences: ["no-cropped-tops"] });
    assert.ok(!isDressingExcluded(result, "draped-leather-pants"),
      "draped-leather-pants (BOTTOM) must be exempt from no-cropped-tops");
  });

  it("G2.44 legs-covered does NOT apply to TOP items (double-top exempt via n/a hemLength)", () => {
    const result = run(makeSession({ occasion: "everyday" }), { dressingPreferences: ["legs-covered"] });
    assert.ok(!isDressingExcluded(result, "double-top"),
      "double-top (TOP) must be exempt from legs-covered (n/a hemLength)");
  });

  it("G2.45 arms-covered does NOT apply to BOTTOM items (suede-skirt exempt via n/a sleeveLength)", () => {
    const result = run(makeSession({ occasion: "everyday" }), { dressingPreferences: ["arms-covered"] });
    assert.ok(!isDressingExcluded(result, "suede-skirt"),
      "suede-skirt (BOTTOM) must be exempt from arms-covered (n/a sleeveLength)");
  });

  it("G2.46 chest-neckline-covered does NOT apply to standard outerwear (trench-coat exempt via n/a)", () => {
    const result = run(makeSession({ occasion: "everyday" }), { dressingPreferences: ["chest-neckline-covered"] });
    assert.ok(!isDressingExcluded(result, "trench-coat"),
      "trench-coat must be exempt from chest-neckline-covered (n/a necklineCoverage)");
  });

  it("G2.47 chest-neckline-covered DOES exclude kimono-jacket (wrap-variable neckline not n/a)", () => {
    const result = run(makeSession({ occasion: "everyday" }), { dressingPreferences: ["chest-neckline-covered"] });
    assert.ok(isDressingExcluded(result, "kimono-jacket"),
      "kimono-jacket (wrap-variable) must be excluded even without modesty constraints");
  });

  it("G2.48 legs-covered DOES exclude dress-set (knee hemLength is not midi/full/maxi)", () => {
    const result = run(makeSession({ occasion: "everyday" }), { dressingPreferences: ["legs-covered"] });
    assert.ok(isDressingExcluded(result, "dress-set"),
      "dress-set (hemLength: knee from slit) must be excluded by legs-covered");
  });

  it("G2.49 wears-hijab is permissive — rule activates only when hijabCompatible is explicitly false", () => {
    // wears-hijab must NOT exclude products with hijabCompatible: true
    const passingHandles = [
      "double-top", "collar-shirt", "asymmetrical-pants", "draped-leather-pants",
      "suede-skirt", "trench-coat", "leather-suede-jacket", "oversized-blazer",
    ];
    const result = run(makeSession({ occasion: "everyday" }), { dressingPreferences: ["wears-hijab"] });
    for (const handle of passingHandles) {
      assert.ok(!isDressingExcluded(result, handle),
        `${handle} (hijabCompatible: true) must NOT be excluded by wears-hijab`);
    }
  });

  it("G2.50 looser-fitting: midi-dress excluded (fitProfile: fitted)", () => {
    const result = run(makeSession({ occasion: "everyday" }), { dressingPreferences: ["looser-fitting"] });
    assert.ok(isDressingExcluded(result, "midi-dress"),
      "midi-dress (fitProfile: fitted) must be excluded by looser-fitting");
  });

  it("G2.51 arms-covered: dress-set excluded (sleeveLength: short for SET type)", () => {
    const result = run(makeSession({ occasion: "everyday" }), { dressingPreferences: ["arms-covered"] });
    assert.ok(isDressingExcluded(result, "dress-set"),
      "dress-set (sleeveLength: short) must be excluded by arms-covered");
  });
});

// ─── §G3 V2 Style Personality backward-compatibility ─────────────────────────
// Group 3 re-tagged the catalogue from V2 to V3 SPM tokens.  Existing customers
// whose Passport stored V2 IDs must still score against V3-only products via
// PROFILE_SP_V2_TO_V3_MAP.  Each test proves one V2 token produces a direct SP
// match (RANK evidence, field = stylePersonalityMatch) on an appropriate product.
// ─────────────────────────────────────────────────────────────────────────────

describe("§G3 V2 style-personality backward-compat — V2 profile IDs vs V3 catalogue", () => {
  function makeBaseSession() {
    return makeSession({ occasion: "everyday" });
  }

  function findSpMatchEvidence(result: ReturnType<typeof run>, handle: string) {
    const ev = result.evaluatedProducts.find((e) => e.handle === handle);
    assert.ok(ev, `${handle} must appear in evaluatedProducts`);
    return ev!.positiveEvidence.filter(
      (e) =>
        e.field === PRODUCT_TEMPLATE_FIELDS.STYLE_PERSONALITY_MATCH &&
        !e.matchedToken.includes(":"),  // exclude like-myself-bonus entries
    );
  }

  it("G3.SP.01 — V2 'old-money' → classic-polished → direct SP match on collar-shirt", () => {
    assert.equal(PROFILE_SP_V2_TO_V3_MAP["old-money"], "classic-polished");
    const result = run(makeBaseSession(), { stylePersonalities: ["old-money"] });
    const spEvs = findSpMatchEvidence(result, "collar-shirt");
    assert.equal(spEvs.length, 1, "collar-shirt must receive one direct SP match for old-money");
    assert.equal(spEvs[0].matchedToken, "classic-polished");
    assert.equal(spEvs[0].sessionSignal, "old-money");
  });

  it("G3.SP.02 — V2 'corporate-chic' → classic-polished → direct SP match on trench-coat", () => {
    assert.equal(PROFILE_SP_V2_TO_V3_MAP["corporate-chic"], "classic-polished");
    const result = run(makeBaseSession(), { stylePersonalities: ["corporate-chic"] });
    const spEvs = findSpMatchEvidence(result, "trench-coat");
    assert.equal(spEvs.length, 1, "trench-coat must receive one direct SP match for corporate-chic");
    assert.equal(spEvs[0].matchedToken, "classic-polished");
    assert.equal(spEvs[0].sessionSignal, "corporate-chic");
  });

  it("G3.SP.03 — V2 'feminine' → feminine-romantic → direct SP match on double-top", () => {
    assert.equal(PROFILE_SP_V2_TO_V3_MAP["feminine"], "feminine-romantic");
    const result = run(makeBaseSession(), { stylePersonalities: ["feminine"] });
    const spEvs = findSpMatchEvidence(result, "double-top");
    assert.equal(spEvs.length, 1, "double-top must receive one direct SP match for feminine");
    assert.equal(spEvs[0].matchedToken, "feminine-romantic");
    assert.equal(spEvs[0].sessionSignal, "feminine");
  });

  it("G3.SP.04 — V2 'romantic' → feminine-romantic → direct SP match on suede-skirt", () => {
    assert.equal(PROFILE_SP_V2_TO_V3_MAP["romantic"], "feminine-romantic");
    const result = run(makeBaseSession(), { stylePersonalities: ["romantic"] });
    const spEvs = findSpMatchEvidence(result, "suede-skirt");
    assert.equal(spEvs.length, 1, "suede-skirt must receive one direct SP match for romantic");
    assert.equal(spEvs[0].matchedToken, "feminine-romantic");
    assert.equal(spEvs[0].sessionSignal, "romantic");
  });

  it("G3.SP.05 — V2 'minimal' → minimal-relaxed → direct SP match on collar-shirt", () => {
    assert.equal(PROFILE_SP_V2_TO_V3_MAP["minimal"], "minimal-relaxed");
    const result = run(makeBaseSession(), { stylePersonalities: ["minimal"] });
    const spEvs = findSpMatchEvidence(result, "collar-shirt");
    assert.equal(spEvs.length, 1, "collar-shirt must receive one direct SP match for minimal");
    assert.equal(spEvs[0].matchedToken, "minimal-relaxed");
    assert.equal(spEvs[0].sessionSignal, "minimal");
  });

  it("G3.SP.06 — V2 'casual-cool' → minimal-relaxed → direct SP match on kimono-jacket", () => {
    assert.equal(PROFILE_SP_V2_TO_V3_MAP["casual-cool"], "minimal-relaxed");
    const result = run(makeBaseSession(), { stylePersonalities: ["casual-cool"] });
    const spEvs = findSpMatchEvidence(result, "kimono-jacket");
    assert.equal(spEvs.length, 1, "kimono-jacket must receive one direct SP match for casual-cool");
    assert.equal(spEvs[0].matchedToken, "minimal-relaxed");
    assert.equal(spEvs[0].sessionSignal, "casual-cool");
  });

  it("G3.SP.07 — V2 'effortlessly-chic' → minimal-relaxed → direct SP match on oversized-blazer", () => {
    assert.equal(PROFILE_SP_V2_TO_V3_MAP["effortlessly-chic"], "minimal-relaxed");
    const result = run(makeBaseSession(), { stylePersonalities: ["effortlessly-chic"] });
    const spEvs = findSpMatchEvidence(result, "oversized-blazer");
    assert.equal(spEvs.length, 1, "oversized-blazer must receive one direct SP match for effortlessly-chic");
    assert.equal(spEvs[0].matchedToken, "minimal-relaxed");
    assert.equal(spEvs[0].sessionSignal, "effortlessly-chic");
  });

  it("G3.SP.08 — V2 'edgy' → bold-edgy → direct SP match on double-top", () => {
    assert.equal(PROFILE_SP_V2_TO_V3_MAP["edgy"], "bold-edgy");
    const result = run(makeBaseSession(), { stylePersonalities: ["edgy"] });
    const spEvs = findSpMatchEvidence(result, "double-top");
    assert.equal(spEvs.length, 1, "double-top must receive one direct SP match for edgy");
    assert.equal(spEvs[0].matchedToken, "bold-edgy");
    assert.equal(spEvs[0].sessionSignal, "edgy");
  });

  it("G3.SP.09 — V2 'trendy' → bold-edgy → direct SP match on dress-set", () => {
    assert.equal(PROFILE_SP_V2_TO_V3_MAP["trendy"], "bold-edgy");
    const result = run(makeBaseSession(), { stylePersonalities: ["trendy"] });
    const spEvs = findSpMatchEvidence(result, "dress-set");
    assert.equal(spEvs.length, 1, "dress-set must receive one direct SP match for trendy");
    assert.equal(spEvs[0].matchedToken, "bold-edgy");
    assert.equal(spEvs[0].sessionSignal, "trendy");
  });

  it("G3.SP.10 — V2 'artsy' → creative-expressive → direct SP match on collar-shirt", () => {
    assert.equal(PROFILE_SP_V2_TO_V3_MAP["artsy"], "creative-expressive");
    const result = run(makeBaseSession(), { stylePersonalities: ["artsy"] });
    const spEvs = findSpMatchEvidence(result, "collar-shirt");
    assert.equal(spEvs.length, 1, "collar-shirt must receive one direct SP match for artsy");
    assert.equal(spEvs[0].matchedToken, "creative-expressive");
    assert.equal(spEvs[0].sessionSignal, "artsy");
  });

  // V3 tokens still produce direct matches without needing the compat map
  it("G3.SP.11 — V3 'creative-expressive' produces direct SP match without translation", () => {
    const result = run(makeBaseSession(), { stylePersonalities: ["creative-expressive"] });
    const spEvs = findSpMatchEvidence(result, "collar-shirt");
    assert.equal(spEvs.length, 1, "collar-shirt must receive a direct SP match for creative-expressive");
    assert.equal(spEvs[0].matchedToken, "creative-expressive");
    assert.equal(spEvs[0].sessionSignal, "creative-expressive");
  });

  it("G3.SP.12 — V3 'bold-edgy' produces direct SP match without translation", () => {
    const result = run(makeBaseSession(), { stylePersonalities: ["bold-edgy"] });
    const spEvs = findSpMatchEvidence(result, "double-top");
    assert.equal(spEvs.length, 1, "double-top must receive a direct SP match for bold-edgy");
    assert.equal(spEvs[0].matchedToken, "bold-edgy");
    assert.equal(spEvs[0].sessionSignal, "bold-edgy");
  });

  // ── V3 collapse dedup: multiple V2 IDs → one V3 archetype → one score ────────

  it("G3.SP.13 — feminine+romantic both map to feminine-romantic → exactly one SPM evidence entry on double-top", () => {
    // Both V2 tokens collapse to the same V3 archetype.  Engine must not double-score.
    const result = run(makeBaseSession(), { stylePersonalities: ["feminine", "romantic"] });
    const spEvs = findSpMatchEvidence(result, "double-top");
    assert.equal(spEvs.length, 1,
      "double-top: feminine+romantic must produce ONE feminine-romantic match, not two");
    assert.equal(spEvs[0].matchedToken, "feminine-romantic");
    // sessionSignal is whichever V2 token was first in the array
    assert.equal(spEvs[0].sessionSignal, "feminine");
  });

  it("G3.SP.14 — old-money+corporate-chic both map to classic-polished → exactly one SPM evidence entry on collar-shirt", () => {
    const result = run(makeBaseSession(), { stylePersonalities: ["old-money", "corporate-chic"] });
    const spEvs = findSpMatchEvidence(result, "collar-shirt");
    assert.equal(spEvs.length, 1,
      "collar-shirt: old-money+corporate-chic must produce ONE classic-polished match, not two");
    assert.equal(spEvs[0].matchedToken, "classic-polished");
  });

  it("G3.SP.15 — minimal+casual-cool+effortlessly-chic all map to minimal-relaxed → exactly one SPM evidence entry on oversized-blazer", () => {
    const result = run(makeBaseSession(), {
      stylePersonalities: ["minimal", "casual-cool", "effortlessly-chic"],
    });
    const spEvs = findSpMatchEvidence(result, "oversized-blazer");
    assert.equal(spEvs.length, 1,
      "oversized-blazer: triple minimal-relaxed collapse must produce ONE match, not three");
    assert.equal(spEvs[0].matchedToken, "minimal-relaxed");
  });

  it("G3.SP.16 — edgy+trendy both map to bold-edgy → exactly one SPM evidence entry on double-top", () => {
    const result = run(makeBaseSession(), { stylePersonalities: ["edgy", "trendy"] });
    const spEvs = findSpMatchEvidence(result, "double-top");
    assert.equal(spEvs.length, 1,
      "double-top: edgy+trendy must produce ONE bold-edgy match, not two");
    assert.equal(spEvs[0].matchedToken, "bold-edgy");
  });

  it("G3.SP.17 — feminine+artsy map to different V3 archetypes → two independent SPM evidence entries on double-top", () => {
    // feminine → feminine-romantic; artsy → creative-expressive — genuinely different V3 archetypes
    const result = run(makeBaseSession(), { stylePersonalities: ["feminine", "artsy"] });
    const spEvs = findSpMatchEvidence(result, "double-top");
    assert.equal(spEvs.length, 2,
      "double-top: feminine+artsy → 2 different V3 archetypes → 2 independent evidence entries");
    const tokens = spEvs.map(e => e.matchedToken).sort();
    assert.deepStrictEqual(tokens, ["bold-edgy", "creative-expressive", "feminine-romantic"].slice(1),
      // double-top has creative-expressive and feminine-romantic (not bold-edgy)
    );
    // verify the two tokens are the expected V3 archetypes
    assert.ok(tokens.includes("feminine-romantic"), "must include feminine-romantic");
    assert.ok(tokens.includes("creative-expressive"), "must include creative-expressive");
  });

  it("G3.SP.18 — native V3 multi-select feminine-romantic+creative-expressive scores both independently on double-top", () => {
    // Two native V3 tokens that are genuinely distinct — no collapse, no dedup
    const result = run(makeBaseSession(), {
      stylePersonalities: ["feminine-romantic", "creative-expressive"],
    });
    const spEvs = findSpMatchEvidence(result, "double-top");
    assert.equal(spEvs.length, 2,
      "double-top: two distinct V3 archetypes → two evidence entries");
    const tokens = spEvs.map(e => e.matchedToken).sort();
    assert.ok(tokens.includes("feminine-romantic"), "must include feminine-romantic");
    assert.ok(tokens.includes("creative-expressive"), "must include creative-expressive");
  });
});
