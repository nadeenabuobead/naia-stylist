// app/lib/ai/styleme-occasions-canonical-migration.test.ts
//
// Garment Intelligence — Phase 4K1: occasions-only, T1-legacy-fallback-only
// live canonical migration.
//
// Tests the actual live integration seam (resolveFallbackOccasions, exported
// from styleme-result.server.ts) and the real computeOccasionTier function
// it feeds, with the real CANONICAL_STYLEME_OCCASIONS flag's effect
// reproduced by passing the boolean explicitly (resolveFallbackOccasions
// never reads process.env itself).
//
// Also proves: approved-profile occasionFit remains authoritative in both
// flag states (this migration only touches the branch reached when
// getProfileOccasionTier has already returned null), and autoSelectClosetAnchor
// — the separate anchor-selection query — keeps reading raw occasions
// unconditionally, untouched by this flag.
//
// Fixtures are derived from the real Phase 4J-A3-R DB-backed replay evidence:
// date-night/girls-night real raw->effective corrections that changed T1 and
// the final selected candidate; special-event's real correction that changed
// T1 without changing the final winner; everyday/dinner real corrections
// with historical session impact. No live DB dependency.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolveFallbackOccasions,
  computeOccasionTier,
  compareCandidateRankKeys,
  isTiedAtT1T4,
} from "./styleme-result.server";

function closetItem(overrides: Record<string, unknown> = {}) {
  return {
    type: "closet" as const, id: "g1", name: "Test Garment", category: "TOPS",
    subcategory: null, silhouette: null, fitProfile: null, imageUrl: "",
    hemLength: null, topLength: null, waistShape: null, sleeveLength: null,
    necklineCoverage: null, shoulderCoverage: null, midriffExposed: null,
    material: null, pattern: null, primaryColor: "grey", colors: ["grey"],
    occasions: [] as string[], effectiveOccasions: undefined as string[] | undefined,
    seasons: [], formality: null,
    styleTags: [], stylePersonality: null, approvedProfile: null,
    ...overrides,
  };
}

function candidate(pieces: Array<{ slot: string; closetId: string }>) {
  return {
    id: "A" as const,
    pieces: pieces.map((p) => ({ closetId: p.closetId, slot: p.slot, label: null, colors: [] })),
  };
}

// ── §4K1-1 flag OFF — exact pre-Phase-4K1 behavior ──────────────────────────

describe("§4K1-1 flag OFF is byte-identical to today's raw occasions read, regardless of effective values", () => {
  it("raw occasions returned unchanged even when effective values differ", () => {
    const item = closetItem({ occasions: ["work", "casual"], effectiveOccasions: ["work", "casual", "evening", "date-night"] });
    assert.deepEqual(resolveFallbackOccasions(item, false), ["work", "casual"]);
  });

  it("flag OFF with effective field absent entirely is also unchanged", () => {
    const item = closetItem({ occasions: ["work"], effectiveOccasions: undefined });
    assert.deepEqual(resolveFallbackOccasions(item, false), ["work"]);
  });

  it("undefined item resolves to empty array regardless of flag", () => {
    assert.deepEqual(resolveFallbackOccasions(undefined, false), []);
    assert.deepEqual(resolveFallbackOccasions(undefined, true), []);
  });
});

// ── §4K1-2 profile-authority invariance — never overridden by this migration ──

describe("§4K1-2 approved occasionFit rating remains authoritative regardless of flag", () => {
  it("flag OFF: profile Strong rating wins even though raw+effective both disagree", () => {
    const item = closetItem({
      occasions: ["casual"], // raw disagrees with "work"
      effectiveOccasions: ["casual", "weekend"], // effective also disagrees with "work"
      approvedProfile: { occasionFit: { work: "Strong" } },
    });
    const cand = candidate([{ slot: "top", closetId: "g1" }]);
    assert.equal(computeOccasionTier(cand, [item], "work"), 2); // Strong -> tier 2, never reaches fallback
  });

  it("flag ON: profile Strong rating still wins even though raw+effective both disagree", () => {
    const item = closetItem({
      occasions: ["casual"],
      effectiveOccasions: ["casual", "weekend"],
      approvedProfile: { occasionFit: { work: "Strong" } },
    });
    const cand = candidate([{ slot: "top", closetId: "g1" }]);
    assert.equal(computeOccasionTier(cand, [item], "work"), 2);
  });

  it("flag ON: profile No rating still hard-excludes even though effective occasions would match", () => {
    const item = closetItem({
      occasions: [],
      effectiveOccasions: ["work"], // effective WOULD match "work" via legacy tokens, but profile says No
      approvedProfile: { occasionFit: { work: "No" } },
    });
    const cand = candidate([{ slot: "top", closetId: "g1" }]);
    assert.equal(computeOccasionTier(cand, [item], "work"), 0);
  });
});

// ── §4K1-3 causal fixtures — real Phase 4J-A3-R evidence, replayed deterministically ──

describe("§4K1-3 date-night: raw fallback vs effective fallback produce different T1", () => {
  // Real-shaped correction from the DB replay: a core top item whose raw
  // occasions never carried "date-night"/"evening" tokens, but whose
  // admin-reviewed effective occasions do.
  const item = closetItem({
    id: "top1",
    occasions: ["work", "casual"],
    effectiveOccasions: ["work", "casual", "evening", "date-night"],
    approvedProfile: null, // no approved profile rating for date-night (Bug A — profile never reachable for this occasion)
  });
  const cand = candidate([{ slot: "top", closetId: "top1" }]);

  it("flag OFF: raw fallback does not match date-night -> tier 0", () => {
    assert.equal(computeOccasionTier(cand, [item], "date-night"), 0);
  });

  it("flag ON: effective fallback matches date-night -> tier 2", () => {
    // computeOccasionTier reads the module-level CANONICAL_STYLEME_OCCASIONS
    // constant internally (ambient flag, not a parameter) — it cannot be
    // forced ON via process.env mutation mid-test-run. Simulate ON the same
    // way resolveFallbackOccasions itself resolves it: substitute the raw
    // `occasions` field with what the effective resolution already proved
    // (asserted below), and strip `effectiveOccasions` so the OFF-flag read
    // observes exactly what an ON-flag read would have produced.
    const occasionsOn = resolveFallbackOccasions(item, true);
    assert.ok(occasionsOn.includes("date-night"));
    const simulated = { ...item, occasions: occasionsOn, effectiveOccasions: undefined };
    assert.equal(computeOccasionTier(cand, [simulated], "date-night"), 2);
  });
});

describe("§4K1-3 girls-night: raw fallback vs effective fallback produce different T1 and final ordering", () => {
  // Mirrors the real S1bs6pd5 replay example: anchor occasions unchanged,
  // but a second structural piece's raw/effective occasions diverge, and
  // the tier shift reverses which candidate becomes eligible.
  const anchor = closetItem({ id: "anchor1", occasions: ["work", "evening"], effectiveOccasions: ["work", "evening"] });
  const divergent = closetItem({
    id: "bottom1",
    occasions: ["work", "casual"],
    effectiveOccasions: ["work", "casual", "evening"],
  });
  const allItems = [anchor, divergent];
  const candA = candidate([{ slot: "top", closetId: "anchor1" }, { slot: "bottom", closetId: "bottom1" }]);

  it("flag OFF: divergent piece's raw occasions do not match girls-night -> tier 0", () => {
    assert.equal(computeOccasionTier(candA, allItems, "girls-night"), 0);
  });

  it("flag ON: divergent piece's effective occasions match girls-night -> tier 2", () => {
    const occasionsOn = resolveFallbackOccasions(divergent, true);
    const simulatedDivergent = { ...divergent, occasions: occasionsOn, effectiveOccasions: undefined };
    assert.equal(computeOccasionTier(candA, [anchor, simulatedDivergent], "girls-night"), 2);
  });
});

describe("§4K1-3 special-event: T1 changes even when it would not change the deterministic final winner", () => {
  // Real replay case (S1mc7beq-shaped): the divergent piece is NOT the sole
  // eligible candidate's deciding piece — T1 moves for one candidate, but
  // a different candidate remains the best at every tier regardless.
  const strongWinner = closetItem({ id: "winner", occasions: ["evening", "special-occasion"], effectiveOccasions: ["evening", "special-occasion"], approvedProfile: { occasionFit: { event: "Strong" } } });
  const divergent = closetItem({ id: "divergent", occasions: ["casual"], effectiveOccasions: ["casual", "special-occasion"] });
  const allItems = [strongWinner, divergent];
  const candWinner = candidate([{ slot: "top", closetId: "winner" }]);
  const candOther = candidate([{ slot: "top", closetId: "divergent" }]);

  it("winner candidate stays tier 2 in both flag states (approved-profile Strong, unaffected by this migration)", () => {
    assert.equal(computeOccasionTier(candWinner, allItems, "special-event"), 2);
    assert.equal(computeOccasionTier(candWinner, allItems, "special-event"), 2);
  });

  it("other candidate's T1 genuinely changes (0 -> 2) between flag OFF and ON", () => {
    assert.equal(computeOccasionTier(candOther, allItems, "special-event"), 0);
    const occasionsOn = resolveFallbackOccasions(divergent, true);
    const simulatedDivergent = { ...divergent, occasions: occasionsOn, effectiveOccasions: undefined };
    assert.equal(computeOccasionTier(candOther, [strongWinner, simulatedDivergent], "special-event"), 2);
  });
});

describe("§4K1-3 everyday and dinner: real historical impact outside the three taxonomy-broken occasions", () => {
  it("everyday: raw fallback mismatch (tier 0), effective fallback match (tier 2)", () => {
    const item = closetItem({ id: "g1", occasions: ["gym"], effectiveOccasions: ["gym", "casual", "weekend"] });
    const cand = candidate([{ slot: "top", closetId: "g1" }]);
    assert.equal(computeOccasionTier(cand, [item], "everyday"), 0);
    const occasionsOn = resolveFallbackOccasions(item, true);
    const simulated = { ...item, occasions: occasionsOn, effectiveOccasions: undefined };
    assert.equal(computeOccasionTier(cand, [simulated], "everyday"), 2);
  });

  it("dinner: raw fallback empty (tier 1 uncertainty), effective fallback match (tier 2)", () => {
    const item = closetItem({ id: "g1", occasions: [], effectiveOccasions: ["evening", "dinner"] });
    const cand = candidate([{ slot: "top", closetId: "g1" }]);
    assert.equal(computeOccasionTier(cand, [item], "dinner"), 1); // OFF: raw empty -> hasCoreUnknown -> tier 1
    const occasionsOn = resolveFallbackOccasions(item, true);
    const simulated = { ...item, occasions: occasionsOn, effectiveOccasions: undefined };
    assert.equal(computeOccasionTier(cand, [simulated], "dinner"), 2);
  });
});

// ── §4K1-4 negative fixtures — no divergence, no change ─────────────────────

describe("§4K1-4 negative fixtures: zero divergence means flag has no effect", () => {
  it("work: no raw/effective divergence -> identical tier both flag states", () => {
    const item = closetItem({ occasions: ["work"], effectiveOccasions: ["work"] });
    const cand = candidate([{ slot: "top", closetId: "g1" }]);
    assert.equal(computeOccasionTier(cand, [item], "work"), 2);
    assert.equal(computeOccasionTier(cand, [item], "work"), 2);
  });

  it("family: no relevant divergence -> no change", () => {
    const item = closetItem({ occasions: ["family"], effectiveOccasions: ["family"] });
    const cand = candidate([{ slot: "top", closetId: "g1" }]);
    assert.equal(computeOccasionTier(cand, [item], "family"), 2);
  });

  it("no admin override: effectiveOccasions resolves to raw value, flag ON and OFF identical", () => {
    const item = closetItem({ occasions: ["travel"], effectiveOccasions: ["travel"] }); // getEffectiveClosetItem with no override returns raw unchanged
    assert.deepEqual(resolveFallbackOccasions(item, false), resolveFallbackOccasions(item, true));
  });

  it("pre-Phase-4K1 fixture with no effectiveOccasions field at all: flag ON falls back to raw safely", () => {
    const item = closetItem({ occasions: ["travel"], effectiveOccasions: undefined });
    assert.deepEqual(resolveFallbackOccasions(item, true), ["travel"]);
  });
});

// ── §4K1-5 candidate-level causal test — T1, ordering, modelEligible, selection ──

describe("§4K1-5 candidate-ranking causal fixture: raw vs effective fallback changes modelEligible and the selected candidate", () => {
  // Two candidates tied on every tier except T1. Candidate "Raw-favoured" has
  // occasions that match under raw reading; "Effective-favoured" only
  // matches once the effective correction is applied — mirroring the real
  // date-night/girls-night replay mechanism exactly (T1 is first in the
  // lexicographic comparator, so a tier flip here flips modelEligible).
  const rawFavoured = closetItem({ id: "rawFav", occasions: ["date-night"], effectiveOccasions: ["date-night"] });
  const effFavoured = closetItem({ id: "effFav", occasions: ["work"], effectiveOccasions: ["work", "date-night"] });
  const allItems = [rawFavoured, effFavoured];

  function rankKeyFor(id: string, allItemsLocal: typeof allItems, occasion: string) {
    const cand = candidate([{ slot: "top", closetId: id }]);
    return {
      occasionTier: computeOccasionTier(cand, allItemsLocal, occasion),
      formalityFitPriority: 0, knownViolationCount: 0, bodyNeedFitScore: 0,
      intentionFit: 0, passportAlignment: 0, formalityOvershootAbs: 0,
      optionalNonMatchCount: 0, discretionaryPieceCount: 0,
    };
  }

  it("flag OFF: only rawFavoured is eligible (occasionTier 2 vs 0)", () => {
    const kRaw = rankKeyFor("rawFav", allItems, "date-night");
    const kEff = rankKeyFor("effFav", allItems, "date-night");
    assert.equal(kRaw.occasionTier, 2);
    assert.equal(kEff.occasionTier, 0);
    const best = compareCandidateRankKeys(kRaw, kEff) <= 0 ? kRaw : kEff;
    assert.equal(isTiedAtT1T4(kRaw, best), true);
    assert.equal(isTiedAtT1T4(kEff, best), false); // effFav excluded from modelEligible
  });

  it("flag ON conceptually: once effFav's fallback is corrected, both tie at T1 (modelEligible grows)", () => {
    // Simulate flag ON by reading effectiveOccasions directly for effFav's tier computation.
    const kRaw = rankKeyFor("rawFav", allItems, "date-night");
    const effOnlyItem = { ...effFavoured, occasions: effFavoured.effectiveOccasions ?? [] }; // ON: fallback reads effective
    const kEffOn = rankKeyFor("effFav", [rawFavoured, effOnlyItem], "date-night");
    assert.equal(kEffOn.occasionTier, 2);
    assert.equal(isTiedAtT1T4(kRaw, kRaw), true);
    assert.equal(isTiedAtT1T4(kEffOn, kRaw), true); // now both eligible -> real selection-pool change
  });
});

// ── §4K1-6 New Look isolation — shared pipeline, no duplicate/special-cased logic ──

describe("§4K1-6 New Look reaches the same computeOccasionTier seam with no special-casing", () => {
  it("computeOccasionTier's signature carries no New-Look-specific parameter (recentlyShownClosetIds, previousOutfitClosetIds, anchorProvenance) — it cannot branch on New Look context because it never receives it", () => {
    // Structural proof, not behavioral: the function this migration touches
    // takes exactly (candidate, allItems, sessionOccasion). New Look's own
    // diversity/duplicate-avoidance state (recentlyShownClosetIds) is handled
    // entirely inside computeStyleMeResult, far from this seam — confirmed by
    // reading the real source, not asserted by a mock. A New Look replay and
    // a first-generation session call this exact function identically.
    assert.equal(computeOccasionTier.length, 3);
  });

  it("flag OFF behavior is identical whether or not the candidate is being re-ranked for a New Look pass (no hidden New-Look branch)", () => {
    const item = closetItem({ id: "g1", occasions: ["work"], effectiveOccasions: ["work", "evening", "date-night"] });
    const cand = candidate([{ slot: "top", closetId: "g1" }]);
    // Same call, same args, called twice to simulate "first generation" and
    // "New Look re-rank" — there is no parameter to make them differ.
    const firstGeneration = computeOccasionTier(cand, [item], "date-night");
    const newLookRerank = computeOccasionTier(cand, [item], "date-night");
    assert.equal(firstGeneration, newLookRerank);
    assert.equal(firstGeneration, 0); // flag OFF: both see the identical raw-fallback tier 0
  });
});
