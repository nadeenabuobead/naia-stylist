// app/lib/ai/feedback-signal.test.ts
// Phase 4B1 — Unit tests for feedback learning rules, signal computation,
// validation, persistence stubs, and the Designer Intelligence boundary contract.
// No live DB, no network, no provider calls — all injectable stubs.
// Run: node --test --import tsx/esm app/lib/ai/feedback-signal.test.ts

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  signalStrengthFromCount,
  isValidRating,
  isValidTarget,
  sanitiseReasonCodes,
  sanitiseVtoAspects,
  countReasonCodes,
  buildFeedbackSignals,
  computeFeedbackSummary,
} from "./feedback-signal.server.ts";
import type {
  RecommendationFeedbackRecord,
  PostWearAnswers,
} from "./feedback-contract.ts";
import {
  FEEDBACK_THRESHOLD_MODERATE,
  FEEDBACK_THRESHOLD_STRONG,
} from "./feedback-contract.ts";
import {
  createRecommendationFeedback,
  updateRecommendationFeedback,
  deleteRecommendationFeedback,
  loadSessionFeedback,
  upsertPostWearReview,
  loadPostWearReview,
  deletePostWearReview,
  type CreateFeedbackFn,
  type UpdateFeedbackFn,
  type DeleteFeedbackFn,
  type LoadSessionFeedbackFn,
  type UpsertPostWearReviewFn,
  type LoadPostWearReviewFn,
  type DeletePostWearReviewFn,
} from "./feedback-persistence.server.ts";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CUST = "cust-fb-test";
const SESSION = "session-fb-test";
const SUGGESTION = "suggestion-fb-test";
const FIXED_NOW = "2026-07-17T12:00:00.000Z";

function makeFeedback(overrides: Partial<RecommendationFeedbackRecord> = {}): RecommendationFeedbackRecord {
  return {
    id: "fb-1",
    customerId: CUST,
    sessionId: SESSION,
    suggestionId: SUGGESTION,
    target: "complete-suggestion",
    shopifyProductId: null,
    closetItemId: null,
    rating: "love",
    reasonCodes: [],
    vtoAspects: [],
    note: null,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  };
}

function makePostWear(overrides: Partial<PostWearAnswers> = {}): PostWearAnswers {
  return {
    didWearIt: "yes",
    howDidYouFeel: "great",
    wasComfortable: "yes",
    fitRight: "yes",
    coverageRight: "yes",
    colourRight: "yes",
    wouldWearAgain: "definitely",
    note: null,
    ...overrides,
  };
}

// ── Persistence stubs ─────────────────────────────────────────────────────────

function makeCreateFn(stored: Map<string, RecommendationFeedbackRecord>): CreateFeedbackFn {
  return async (customerId, data) => {
    const record: RecommendationFeedbackRecord = {
      id: `fb-${stored.size + 1}`,
      customerId,
      ...data,
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    };
    stored.set(record.id, record);
    return record;
  };
}

function makeUpdateFn(stored: Map<string, RecommendationFeedbackRecord>): UpdateFeedbackFn {
  return async (id, customerId, data) => {
    const existing = stored.get(id);
    if (!existing || existing.customerId !== customerId) return null;
    const updated = { ...existing, ...data, updatedAt: FIXED_NOW };
    stored.set(id, updated);
    return updated;
  };
}

function makeDeleteFn(stored: Map<string, RecommendationFeedbackRecord>): DeleteFeedbackFn {
  return async (id, customerId) => {
    const existing = stored.get(id);
    if (!existing || existing.customerId !== customerId) return { ok: false, errorCode: "NOT_FOUND" };
    stored.delete(id);
    return { ok: true };
  };
}

function makeLoadSessionFn(stored: Map<string, RecommendationFeedbackRecord>): LoadSessionFeedbackFn {
  return async (sessionId, customerId) =>
    [...stored.values()].filter(r => r.sessionId === sessionId && r.customerId === customerId);
}

const postWearDb = new Map<string, PostWearAnswers>();

const makeUpsertPostWear: UpsertPostWearReviewFn = async (sessionId, _customerId, data) => {
  postWearDb.set(sessionId, data);
  return { ok: true };
};

const makeLoadPostWear: LoadPostWearReviewFn = async (sessionId) =>
  postWearDb.get(sessionId) ?? null;

const makeDeletePostWear: DeletePostWearReviewFn = async (sessionId) => {
  if (!postWearDb.has(sessionId)) return { ok: false, errorCode: "NOT_FOUND" };
  postWearDb.delete(sessionId);
  return { ok: true };
};

function failingDb(): CreateFeedbackFn {
  return async () => { throw new Error("DB connection failed"); };
}

// ═════════════════════════════════════════════════════════════════════════════
// signalStrengthFromCount
// ═════════════════════════════════════════════════════════════════════════════

describe("signalStrengthFromCount", () => {

  it("ssc-1: 0 → none", () => assert.equal(signalStrengthFromCount(0), "none"));
  it("ssc-2: 1 → weak",  () => assert.equal(signalStrengthFromCount(1), "weak"));
  it("ssc-3: THRESHOLD_MODERATE-1 → weak",
    () => assert.equal(signalStrengthFromCount(FEEDBACK_THRESHOLD_MODERATE - 1), "weak"));
  it("ssc-4: THRESHOLD_MODERATE → moderate",
    () => assert.equal(signalStrengthFromCount(FEEDBACK_THRESHOLD_MODERATE), "moderate"));
  it("ssc-5: THRESHOLD_STRONG → strong",
    () => assert.equal(signalStrengthFromCount(FEEDBACK_THRESHOLD_STRONG), "strong"));

});

// ═════════════════════════════════════════════════════════════════════════════
// Validation helpers
// ═════════════════════════════════════════════════════════════════════════════

describe("isValidRating", () => {

  it("val-1: love / okay / not-for-me are valid",   () => {
    assert.ok(isValidRating("love"));
    assert.ok(isValidRating("okay"));
    assert.ok(isValidRating("not-for-me"));
  });
  it("val-2: unknown string is invalid",            () => assert.ok(!isValidRating("meh")));
  it("val-3: non-string is invalid",                () => assert.ok(!isValidRating(42)));

});

describe("isValidTarget", () => {

  it("val-4: all four valid targets accepted",      () => {
    assert.ok(isValidTarget("complete-suggestion"));
    assert.ok(isValidTarget("closet-item"));
    assert.ok(isValidTarget("nadine-product"));
    assert.ok(isValidTarget("vto-preview"));
  });
  it("val-5: unknown target rejected",              () => assert.ok(!isValidTarget("widget")));

});

describe("sanitiseReasonCodes", () => {

  it("val-6: known codes pass through",             () => {
    const out = sanitiseReasonCodes(["too-formal", "colour-not-for-me"]);
    assert.deepEqual(out, ["too-formal", "colour-not-for-me"]);
  });
  it("val-7: unknown codes are silently dropped",   () => {
    const out = sanitiseReasonCodes(["too-formal", "bad-code-xyz", "too-expensive"]);
    assert.ok(!out.includes("bad-code-xyz" as never), "unknown code must be dropped");
    assert.ok(out.includes("too-formal"));
  });
  it("val-8: non-array input returns empty array",  () => {
    assert.deepEqual(sanitiseReasonCodes(null), []);
    assert.deepEqual(sanitiseReasonCodes("too-formal"), []);
  });
  it("val-9: malformed (non-string) entries dropped", () => {
    const out = sanitiseReasonCodes([42, null, "too-formal"]);
    assert.deepEqual(out, ["too-formal"]);
  });

});

describe("sanitiseVtoAspects", () => {

  it("val-10: known vto aspects pass through",      () => {
    const out = sanitiseVtoAspects(["preview-useful", "would-try-in-person"]);
    assert.deepEqual(out, ["preview-useful", "would-try-in-person"]);
  });
  it("val-11: unknown aspects dropped",             () => {
    const out = sanitiseVtoAspects(["preview-useful", "fit-perfect"]);
    assert.ok(!out.includes("fit-perfect" as never));
  });

});

// ═════════════════════════════════════════════════════════════════════════════
// countReasonCodes + buildFeedbackSignals
// ═════════════════════════════════════════════════════════════════════════════

describe("countReasonCodes", () => {

  it("rc-1: counts reasons from not-for-me feedback", () => {
    const feedback = [
      makeFeedback({ rating: "not-for-me", reasonCodes: ["too-formal", "colour-not-for-me"] }),
      makeFeedback({ id: "fb-2", rating: "not-for-me", reasonCodes: ["too-formal"] }),
    ];
    const counts = countReasonCodes(feedback);
    assert.equal(counts.get("too-formal"), 2);
    assert.equal(counts.get("colour-not-for-me"), 1);
  });

  it("rc-2: love feedback reasons are NOT counted", () => {
    const feedback = [
      makeFeedback({ rating: "love", reasonCodes: ["too-formal"] }),
    ];
    const counts = countReasonCodes(feedback);
    assert.equal(counts.get("too-formal"), undefined, "love reasons must not count");
  });

  it("rc-3: okay feedback reasons are counted", () => {
    const feedback = [
      makeFeedback({ rating: "okay", reasonCodes: ["not-practical"] }),
    ];
    const counts = countReasonCodes(feedback);
    assert.equal(counts.get("not-practical"), 1);
  });

});

describe("buildFeedbackSignals", () => {

  it("sig-1: returns signals sorted by count descending", () => {
    const counts = new Map([["too-formal", 4], ["colour-not-for-me", 2]] as [never, number][]);
    const signals = buildFeedbackSignals(counts as Map<never, number>);
    assert.equal(signals[0].reason, "too-formal");
    assert.equal(signals[1].reason, "colour-not-for-me");
  });

  it("sig-2: strength is derived correctly from count", () => {
    const counts = new Map([["too-formal", FEEDBACK_THRESHOLD_STRONG]] as [never, number][]);
    const signals = buildFeedbackSignals(counts as Map<never, number>);
    assert.equal(signals[0].strength, "strong");
  });

});

// ═════════════════════════════════════════════════════════════════════════════
// computeFeedbackSummary — immediate feedback
// ═════════════════════════════════════════════════════════════════════════════

describe("computeFeedbackSummary — immediate feedback", () => {

  it("imm-1: love feedback increments loveCount", () => {
    const summary = computeFeedbackSummary(CUST,
      [makeFeedback({ rating: "love" })], [], () => FIXED_NOW);
    assert.equal(summary.loveCount, 1);
    assert.equal(summary.okayCount, 0);
    assert.equal(summary.notForMeCount, 0);
  });

  it("imm-2: neutral (okay) feedback increments okayCount", () => {
    const summary = computeFeedbackSummary(CUST,
      [makeFeedback({ rating: "okay" })], [], () => FIXED_NOW);
    assert.equal(summary.okayCount, 1);
    assert.equal(summary.loveCount, 0);
  });

  it("imm-3: negative feedback with reasons creates active signals", () => {
    const feedback = [
      makeFeedback({ rating: "not-for-me", reasonCodes: ["too-formal", "colour-not-for-me"] }),
    ];
    const summary = computeFeedbackSummary(CUST, feedback, [], () => FIXED_NOW);
    assert.equal(summary.notForMeCount, 1);
    assert.ok(summary.activeSignals.some(s => s.reason === "too-formal"));
    assert.ok(summary.activeSignals.some(s => s.reason === "colour-not-for-me"));
  });

  it("imm-4: optional note is stored per record (persistence layer test)", async () => {
    const stored = new Map<string, RecommendationFeedbackRecord>();
    const created = await createRecommendationFeedback(
      CUST,
      { sessionId: SESSION, suggestionId: null, target: "nadine-product",
        shopifyProductId: "prod-123", closetItemId: null,
        rating: "love", reasonCodes: [], vtoAspects: [],
        note: "Beautiful colour — would look great in summer." },
      makeCreateFn(stored),
    );
    assert.equal(created.note, "Beautiful colour — would look great in summer.");
  });

  it("imm-5: repeated same reason reaches moderate threshold", () => {
    const feedback = Array.from({ length: FEEDBACK_THRESHOLD_MODERATE }, (_, i) =>
      makeFeedback({ id: `fb-${i}`, rating: "not-for-me", reasonCodes: ["too-revealing"] })
    );
    const summary = computeFeedbackSummary(CUST, feedback, [], () => FIXED_NOW);
    const signal = summary.activeSignals.find(s => s.reason === "too-revealing");
    assert.ok(signal, "signal must exist");
    assert.equal(signal!.strength, "moderate");
  });

  it("imm-6: repeated same reason reaches strong threshold", () => {
    const feedback = Array.from({ length: FEEDBACK_THRESHOLD_STRONG }, (_, i) =>
      makeFeedback({ id: `fb-${i}`, rating: "not-for-me", reasonCodes: ["too-formal"] })
    );
    const summary = computeFeedbackSummary(CUST, feedback, [], () => FIXED_NOW);
    const signal = summary.activeSignals.find(s => s.reason === "too-formal");
    assert.ok(signal, "signal must exist");
    assert.equal(signal!.strength, "strong");
  });

  it("imm-7: one-off negative feedback does not become a hard filter", () => {
    const feedback = [makeFeedback({ rating: "not-for-me", reasonCodes: ["too-casual"] })];
    const summary = computeFeedbackSummary(CUST, feedback, [], () => FIXED_NOW);
    // Signal exists but is only weak — must never be a hard filter
    const signal = summary.activeSignals.find(s => s.reason === "too-casual");
    assert.ok(signal);
    assert.equal(signal!.strength, "weak", "one-off must not exceed weak strength");
    // Verify the summary carries no hard-filter field
    assert.ok(!("hardFilters" in summary), "summary must not contain a hardFilters field");
  });

  it("imm-8: inconsistent feedback (love + not-for-me for same session) — signals reflect actual counts", () => {
    const feedback = [
      makeFeedback({ id: "fb-a", rating: "love", reasonCodes: [] }),
      makeFeedback({ id: "fb-b", rating: "not-for-me", reasonCodes: ["colour-not-for-me"] }),
    ];
    const summary = computeFeedbackSummary(CUST, feedback, [], () => FIXED_NOW);
    assert.equal(summary.loveCount, 1);
    assert.equal(summary.notForMeCount, 1);
    // love does not create signals; not-for-me with reason creates one weak signal
    const colourSignal = summary.activeSignals.find(s => s.reason === "colour-not-for-me");
    assert.ok(colourSignal);
    assert.equal(colourSignal!.strength, "weak");
  });

});

// ═════════════════════════════════════════════════════════════════════════════
// computeFeedbackSummary — VTO
// ═════════════════════════════════════════════════════════════════════════════

describe("computeFeedbackSummary — VTO", () => {

  it("vto-1: preview-useful counted in vtoPreviewUsefulCount", () => {
    const feedback = [
      makeFeedback({ target: "vto-preview", rating: "love", vtoAspects: ["preview-useful"] }),
    ];
    const summary = computeFeedbackSummary(CUST, feedback, [], () => FIXED_NOW);
    assert.equal(summary.vtoPreviewUsefulCount, 1);
    assert.equal(summary.vtoFidelityConcernCount, 0);
  });

  it("vto-2: garment-looks-inaccurate counted as fidelity concern, not fit signal", () => {
    const feedback = [
      makeFeedback({
        target: "vto-preview", rating: "okay",
        vtoAspects: ["garment-looks-inaccurate"],
        reasonCodes: [],
      }),
    ];
    const summary = computeFeedbackSummary(CUST, feedback, [], () => FIXED_NOW);
    assert.equal(summary.vtoFidelityConcernCount, 1);
    // Must not appear as a fit-shape reason signal
    const fitSignal = summary.activeSignals.find(s => s.reason === "fit-shape-not-for-me");
    assert.equal(fitSignal, undefined, "VTO fidelity concern must not be counted as a fit signal");
  });

  it("vto-3: would-try-in-person counted in vtoGarmentAccurateCount path", () => {
    const feedback = [
      makeFeedback({ target: "vto-preview", rating: "love", vtoAspects: ["garment-looks-accurate", "would-try-in-person"] }),
    ];
    const summary = computeFeedbackSummary(CUST, feedback, [], () => FIXED_NOW);
    assert.equal(summary.vtoGarmentAccurateCount, 1);
  });

});

// ═════════════════════════════════════════════════════════════════════════════
// computeFeedbackSummary — post-wear
// ═════════════════════════════════════════════════════════════════════════════

describe("computeFeedbackSummary — post-wear", () => {

  it("pw-1: wore-it reviews counted in wearThroughCount", () => {
    const reviews = [makePostWear({ didWearIt: "yes" }), makePostWear({ didWearIt: "no" })];
    const summary = computeFeedbackSummary(CUST, [], reviews, () => FIXED_NOW);
    assert.equal(summary.wearThroughCount, 1);
  });

  it("pw-2: positivePostWearRate null when fewer than 3 worn", () => {
    const reviews = [makePostWear({ didWearIt: "yes", howDidYouFeel: "great" })];
    const summary = computeFeedbackSummary(CUST, [], reviews, () => FIXED_NOW);
    assert.equal(summary.positivePostWearRate, null, "rate must be null with < 3 samples");
  });

  it("pw-3: positivePostWearRate computed at 3+ worn reviews", () => {
    const reviews = [
      makePostWear({ didWearIt: "yes", howDidYouFeel: "great" }),
      makePostWear({ didWearIt: "yes", howDidYouFeel: "good" }),
      makePostWear({ didWearIt: "yes", howDidYouFeel: "not-great" }),
    ];
    const summary = computeFeedbackSummary(CUST, [], reviews, () => FIXED_NOW);
    assert.ok(summary.positivePostWearRate !== null);
    // 2 positive out of 3 = 0.67
    assert.ok(summary.positivePostWearRate! > 0.6 && summary.positivePostWearRate! < 0.7);
  });

  it("pw-4: comfort issue signal from wasComfortable=no", () => {
    const reviews = [makePostWear({ wasComfortable: "no" })];
    const summary = computeFeedbackSummary(CUST, [], reviews, () => FIXED_NOW);
    assert.equal(summary.comfortIssueSignal, "weak");
  });

  it("pw-5: colour issue post-wear from colourRight=no", () => {
    const reviews = [makePostWear({ colourRight: "no" })];
    const summary = computeFeedbackSummary(CUST, [], reviews, () => FIXED_NOW);
    assert.equal(summary.colourIssuePostWearSignal, "weak");
  });

});

// ═════════════════════════════════════════════════════════════════════════════
// Designer Intelligence boundary — learning rules
// ═════════════════════════════════════════════════════════════════════════════

describe("computeFeedbackSummary — learning rules", () => {

  it("lr-1: already-own-similar is a wardrobe gap signal, not a style rejection", () => {
    const feedback = [
      makeFeedback({ rating: "not-for-me", reasonCodes: ["already-own-similar"] }),
    ];
    const summary = computeFeedbackSummary(CUST, feedback, [], () => FIXED_NOW);
    assert.equal(summary.alreadyOwnSimilarCount, 1);
    // Must also appear in activeSignals (it is a soft signal)
    const signal = summary.activeSignals.find(s => s.reason === "already-own-similar");
    assert.ok(signal, "gap signal must appear in activeSignals");
    assert.equal(signal!.strength, "weak");
  });

  it("lr-2: loved NADINE products recorded in lovedNadineProductIds", () => {
    const feedback = [
      makeFeedback({ target: "nadine-product", rating: "love", shopifyProductId: "prod-999" }),
    ];
    const summary = computeFeedbackSummary(CUST, feedback, [], () => FIXED_NOW);
    assert.ok(summary.lovedNadineProductIds.includes("prod-999"));
  });

  it("lr-3: summary contains no hardFilters field — SOFT_RANK contract", () => {
    const feedback = Array.from({ length: 10 }, (_, i) =>
      makeFeedback({ id: `fb-${i}`, rating: "not-for-me", reasonCodes: ["too-formal"] })
    );
    const summary = computeFeedbackSummary(CUST, feedback, [], () => FIXED_NOW);
    assert.ok(!("hardFilters" in summary), "SOFT_RANK contract: no hard filter field permitted");
    assert.ok(!("blockedAttributes" in summary), "SOFT_RANK contract: no blocked attributes permitted");
  });

  it("lr-4: active signals are sorted by count descending", () => {
    const feedback = [
      makeFeedback({ id: "a", rating: "not-for-me", reasonCodes: ["too-formal"] }),
      makeFeedback({ id: "b", rating: "not-for-me", reasonCodes: ["too-formal", "colour-not-for-me"] }),
      makeFeedback({ id: "c", rating: "not-for-me", reasonCodes: ["too-formal"] }),
    ];
    const summary = computeFeedbackSummary(CUST, feedback, [], () => FIXED_NOW);
    assert.equal(summary.activeSignals[0].reason, "too-formal", "highest count must be first");
  });

});

// ═════════════════════════════════════════════════════════════════════════════
// Persistence — create, update (edit), delete
// ═════════════════════════════════════════════════════════════════════════════

describe("createRecommendationFeedback", () => {

  it("per-1: creates feedback and returns record with id", async () => {
    const stored = new Map<string, RecommendationFeedbackRecord>();
    const result = await createRecommendationFeedback(CUST, {
      sessionId: SESSION, suggestionId: SUGGESTION, target: "complete-suggestion",
      shopifyProductId: null, closetItemId: null,
      rating: "love", reasonCodes: [], vtoAspects: [], note: null,
    }, makeCreateFn(stored));
    assert.ok(result.id, "id must be set");
    assert.equal(result.customerId, CUST);
    assert.equal(result.rating, "love");
  });

  it("per-2: DB failure throws — caller is responsible for error handling", async () => {
    await assert.rejects(
      () => createRecommendationFeedback(CUST,
        { sessionId: SESSION, suggestionId: null, target: "closet-item",
          shopifyProductId: null, closetItemId: "item-1",
          rating: "okay", reasonCodes: ["not-practical"], vtoAspects: [], note: null },
        failingDb()),
      /DB connection failed/,
    );
  });

});

describe("updateRecommendationFeedback (edit)", () => {

  it("per-3: updates rating and reasons on existing record", async () => {
    const stored = new Map<string, RecommendationFeedbackRecord>();
    const created = await createRecommendationFeedback(CUST,
      { sessionId: SESSION, suggestionId: null, target: "nadine-product",
        shopifyProductId: "prod-1", closetItemId: null,
        rating: "love", reasonCodes: [], vtoAspects: [], note: null },
      makeCreateFn(stored));

    const result = await updateRecommendationFeedback(
      created.id, CUST,
      { rating: "not-for-me", reasonCodes: ["too-expensive"] },
      makeUpdateFn(stored),
    );
    assert.equal(result.ok, true);
    assert.equal(result.record?.rating, "not-for-me");
    assert.ok(result.record?.reasonCodes.includes("too-expensive"));
  });

  it("per-4: update with wrong customerId returns not-found (ownership enforced)", async () => {
    const stored = new Map<string, RecommendationFeedbackRecord>();
    const created = await createRecommendationFeedback(CUST,
      { sessionId: SESSION, suggestionId: null, target: "closet-item",
        shopifyProductId: null, closetItemId: "item-2",
        rating: "okay", reasonCodes: [], vtoAspects: [], note: null },
      makeCreateFn(stored));

    const result = await updateRecommendationFeedback(
      created.id, "other-customer",
      { rating: "love" },
      makeUpdateFn(stored),
    );
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "NOT_FOUND");
  });

});

describe("deleteRecommendationFeedback", () => {

  it("per-5: deletes own record successfully", async () => {
    const stored = new Map<string, RecommendationFeedbackRecord>();
    const created = await createRecommendationFeedback(CUST,
      { sessionId: SESSION, suggestionId: null, target: "nadine-product",
        shopifyProductId: "prod-2", closetItemId: null,
        rating: "love", reasonCodes: [], vtoAspects: [], note: null },
      makeCreateFn(stored));

    const result = await deleteRecommendationFeedback(created.id, CUST, makeDeleteFn(stored));
    assert.equal(result.ok, true);
    assert.equal(stored.size, 0, "record must be removed from store");
  });

  it("per-6: delete with wrong customerId returns not-found", async () => {
    const stored = new Map<string, RecommendationFeedbackRecord>();
    const created = await createRecommendationFeedback(CUST,
      { sessionId: SESSION, suggestionId: null, target: "closet-item",
        shopifyProductId: null, closetItemId: "item-3",
        rating: "okay", reasonCodes: [], vtoAspects: [], note: null },
      makeCreateFn(stored));

    const result = await deleteRecommendationFeedback(created.id, "other-customer", makeDeleteFn(stored));
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "NOT_FOUND");
  });

  it("per-7: deleting non-existent record returns not-found", async () => {
    const stored = new Map<string, RecommendationFeedbackRecord>();
    const result = await deleteRecommendationFeedback("no-such-id", CUST, makeDeleteFn(stored));
    assert.equal(result.ok, false);
  });

});

describe("loadSessionFeedback", () => {

  it("per-8: returns only feedback for the given session and customer", async () => {
    const stored = new Map<string, RecommendationFeedbackRecord>();
    const create = makeCreateFn(stored);
    const load   = makeLoadSessionFn(stored);

    await createRecommendationFeedback(CUST,
      { sessionId: "sess-a", suggestionId: null, target: "nadine-product",
        shopifyProductId: "p1", closetItemId: null, rating: "love",
        reasonCodes: [], vtoAspects: [], note: null }, create);
    await createRecommendationFeedback(CUST,
      { sessionId: "sess-b", suggestionId: null, target: "nadine-product",
        shopifyProductId: "p2", closetItemId: null, rating: "okay",
        reasonCodes: [], vtoAspects: [], note: null }, create);

    const results = await loadSessionFeedback("sess-a", CUST, load);
    assert.equal(results.length, 1, "only feedback from sess-a returned");
    assert.equal(results[0].shopifyProductId, "p1");
  });

});

// ═════════════════════════════════════════════════════════════════════════════
// Post-wear review persistence
// ═════════════════════════════════════════════════════════════════════════════

describe("post-wear review persistence", () => {

  it("pw-per-1: upsert and load post-wear review", async () => {
    const db = new Map<string, PostWearAnswers>();
    const upsert: UpsertPostWearReviewFn = async (sid, _, d) => { db.set(sid, d); return { ok: true }; };
    const load: LoadPostWearReviewFn = async (sid) => db.get(sid) ?? null;

    const answers = makePostWear({ didWearIt: "yes", wouldWearAgain: "definitely" });
    await upsertPostWearReview("sess-pw", CUST, answers, upsert);

    const loaded = await loadPostWearReview("sess-pw", CUST, load);
    assert.ok(loaded !== null);
    assert.equal(loaded!.didWearIt, "yes");
    assert.equal(loaded!.wouldWearAgain, "definitely");
  });

  it("pw-per-2: upsert overwrites previous answer (edit)", async () => {
    const db = new Map<string, PostWearAnswers>();
    const upsert: UpsertPostWearReviewFn = async (sid, _, d) => { db.set(sid, d); return { ok: true }; };
    const load: LoadPostWearReviewFn = async (sid) => db.get(sid) ?? null;

    await upsertPostWearReview("sess-edit", CUST, makePostWear({ wouldWearAgain: "maybe" }), upsert);
    await upsertPostWearReview("sess-edit", CUST, makePostWear({ wouldWearAgain: "definitely" }), upsert);

    const loaded = await loadPostWearReview("sess-edit", CUST, load);
    assert.equal(loaded!.wouldWearAgain, "definitely", "edit must overwrite previous answer");
  });

  it("pw-per-3: delete post-wear review", async () => {
    const db = new Map<string, PostWearAnswers>();
    const upsert: UpsertPostWearReviewFn = async (sid, _, d) => { db.set(sid, d); return { ok: true }; };
    const del: DeletePostWearReviewFn = async (sid) => {
      if (!db.has(sid)) return { ok: false, errorCode: "NOT_FOUND" };
      db.delete(sid);
      return { ok: true };
    };

    await upsertPostWearReview("sess-del", CUST, makePostWear(), upsert);
    const result = await deletePostWearReview("sess-del", CUST, del);
    assert.equal(result.ok, true);
    assert.equal(db.size, 0);
  });

  it("pw-per-4: delete non-existent review returns not-found", async () => {
    const db = new Map<string, PostWearAnswers>();
    const del: DeletePostWearReviewFn = async (sid) => {
      if (!db.has(sid)) return { ok: false, errorCode: "NOT_FOUND" };
      db.delete(sid);
      return { ok: true };
    };
    const result = await deletePostWearReview("sess-missing", CUST, del);
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "NOT_FOUND");
  });

});

// ═════════════════════════════════════════════════════════════════════════════
// Authentication and access control
// ═════════════════════════════════════════════════════════════════════════════

describe("authentication and access control", () => {

  it("auth-1: cross-customer update is rejected at persistence layer (ownership check)", async () => {
    const stored = new Map<string, RecommendationFeedbackRecord>();
    const created = await createRecommendationFeedback("customer-A",
      { sessionId: "s1", suggestionId: null, target: "closet-item",
        shopifyProductId: null, closetItemId: "c1",
        rating: "love", reasonCodes: [], vtoAspects: [], note: null },
      makeCreateFn(stored));

    // customer-B attempts to update customer-A's record
    const result = await updateRecommendationFeedback(
      created.id, "customer-B", { rating: "not-for-me" }, makeUpdateFn(stored));
    assert.equal(result.ok, false, "cross-customer update must fail");
  });

  it("auth-2: cross-customer delete is rejected at persistence layer", async () => {
    const stored = new Map<string, RecommendationFeedbackRecord>();
    const created = await createRecommendationFeedback("customer-A",
      { sessionId: "s1", suggestionId: null, target: "nadine-product",
        shopifyProductId: "p1", closetItemId: null,
        rating: "love", reasonCodes: [], vtoAspects: [], note: null },
      makeCreateFn(stored));

    const result = await deleteRecommendationFeedback(created.id, "customer-B", makeDeleteFn(stored));
    assert.equal(result.ok, false, "cross-customer delete must fail");
    assert.equal(stored.size, 1, "record must remain after rejected delete");
  });

});

// ═════════════════════════════════════════════════════════════════════════════
// Failure-safe behavior
// ═════════════════════════════════════════════════════════════════════════════

describe("failure-safe behavior", () => {

  it("fail-1: DB failure during create propagates as thrown error — route must catch", async () => {
    await assert.rejects(
      () => createRecommendationFeedback(CUST,
        { sessionId: "s", suggestionId: null, target: "closet-item",
          shopifyProductId: null, closetItemId: "c", rating: "okay",
          reasonCodes: [], vtoAspects: [], note: null },
        failingDb()),
    );
  });

  it("fail-2: empty feedback list returns safe zero-count summary", () => {
    const summary = computeFeedbackSummary(CUST, [], [], () => FIXED_NOW);
    assert.equal(summary.totalFeedbackCount, 0);
    assert.equal(summary.loveCount, 0);
    assert.equal(summary.activeSignals.length, 0);
    assert.equal(summary.positivePostWearRate, null);
  });

});
