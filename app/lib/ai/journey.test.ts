// app/lib/ai/journey.test.ts
// Phase 4B3 — Integration contract tests.
//
// Covers: signal precedence, optional-data fallback, explicit preference override,
// selfie signals remaining soft, feedback remaining soft, closet/NADINE mixed context,
// try-on eligibility gating, missing My nAia Model, migration-pending behavior,
// privacy-safe Designer Intelligence events, no customer data leakage,
// and deterministic journey state.
//
// Run: node --test --import tsx/esm app/lib/ai/journey.test.ts

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SIGNAL_PRECEDENCE,
  SELFIE_MAX_BEHAVIOUR,
  FEEDBACK_MAX_BEHAVIOUR,
  aggregateClosetSummary,
  buildSelfieSignalSummary,
  buildFeedbackSignalContext,
  computeFeatureAvailability,
  computeVtoGate,
  emptyClosetSummary,
  emptyFeedbackContext,
  emptyMigrationStatus,
  type CustomerJourneyContext,
  type SelfieSignalSummary,
  type FeedbackSignalContext,
  type ClosetSummary,
} from "./journey-contract.js";
import {
  hashCustomerId,
  emitSessionStarted,
  emitRecommendationServed,
  emitFeedbackGiven,
  emitVtoInitiated,
  emitVtoFeedbackGiven,
  emitPostWearSubmitted,
} from "./journey-events.server.js";
import { buildCustomerJourneyContext } from "./journey-context.server.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CUST_A = "journey-cust-a";
const SESSION = "journey-sess-1";
const FIXED_NOW = () => "2026-07-18T10:00:00.000Z";

function makeSelfie(overrides: Partial<SelfieSignalSummary> = {}): SelfieSignalSummary {
  return {
    available: true,
    behaviour: "SOFT_RANK",
    colourFamilies: ["warm neutrals", "earth tones"],
    suggestedNecklines: ["V-neck", "scoop"],
    contrastLevel: "medium",
    overallNote: "Warm undertones complement earthy tones",
    ...overrides,
  };
}

function makeFeedbackContext(overrides: Partial<FeedbackSignalContext> = {}): FeedbackSignalContext {
  return {
    available: true,
    migrationPending: false,
    totalFeedback: 5,
    activePatterns: [{ reason: "too-formal", count: 3, behaviour: "SOFT_RANK" }],
    positivePostWearRate: 0.8,
    postWearMigrationPending: false,
    ...overrides,
  };
}

function makeClosetItems(count = 3) {
  return Array.from({ length: count }, (_, i) => ({
    category: i % 2 === 0 ? "TOPS" : "SHOES",
    tryOnEligibility: i === 0 ? "ready-for-try-on" : "pending-assessment",
  }));
}

// ═════════════════════════════════════════════════════════════════════════════
// 1 — Signal precedence
// ═════════════════════════════════════════════════════════════════════════════

describe("signal precedence", () => {

  it("j-1: EXPLICIT_PREFERENCE ranks highest — above all other signal levels", () => {
    assert.ok(
      SIGNAL_PRECEDENCE.EXPLICIT_PREFERENCE > SIGNAL_PRECEDENCE.SESSION_ANSWER,
      "explicit preference must outrank session answers",
    );
    assert.ok(
      SIGNAL_PRECEDENCE.EXPLICIT_PREFERENCE > SIGNAL_PRECEDENCE.SOFT_RANK_FEEDBACK,
      "explicit preference must outrank feedback signals",
    );
    assert.ok(
      SIGNAL_PRECEDENCE.EXPLICIT_PREFERENCE > SIGNAL_PRECEDENCE.SOFT_RANK_SELFIE,
      "explicit preference must outrank selfie signals",
    );
  });

  it("j-2: SESSION_ANSWER ranks above soft signals but below explicit preference", () => {
    assert.ok(SIGNAL_PRECEDENCE.SESSION_ANSWER > SIGNAL_PRECEDENCE.SOFT_RANK_FEEDBACK);
    assert.ok(SIGNAL_PRECEDENCE.SESSION_ANSWER > SIGNAL_PRECEDENCE.SOFT_RANK_SELFIE);
    assert.ok(SIGNAL_PRECEDENCE.SESSION_ANSWER < SIGNAL_PRECEDENCE.EXPLICIT_PREFERENCE);
  });

  it("j-3: NO_SIGNAL has the lowest precedence — any real signal outranks it", () => {
    assert.ok(SIGNAL_PRECEDENCE.SOFT_RANK_SELFIE > SIGNAL_PRECEDENCE.NO_SIGNAL);
    assert.ok(SIGNAL_PRECEDENCE.SOFT_RANK_FEEDBACK > SIGNAL_PRECEDENCE.NO_SIGNAL);
    assert.equal(SIGNAL_PRECEDENCE.NO_SIGNAL, 0);
  });

});

// ═════════════════════════════════════════════════════════════════════════════
// 2 — Optional-data fallback
// ═════════════════════════════════════════════════════════════════════════════

describe("optional-data fallback", () => {

  it("j-4: canStyleMe is always true regardless of missing optional data", () => {
    const features = computeFeatureAvailability({
      closetSummary: emptyClosetSummary(),
      selfieSignals: null,
      naiaModelReady: false,
      virtualTryOnEnabled: false,
      feedbackContext: emptyFeedbackContext(),
    });
    assert.equal(features.canStyleMe, true, "StyleMe must work with no optional data");
  });

  it("j-5: empty closet yields hasClosetItems=false and hasEligibleClosetItems=false without error", () => {
    const closetSummary = aggregateClosetSummary([]);
    assert.equal(closetSummary.totalItems, 0);
    const features = computeFeatureAvailability({
      closetSummary,
      selfieSignals: null,
      naiaModelReady: false,
      virtualTryOnEnabled: false,
      feedbackContext: emptyFeedbackContext(),
    });
    assert.equal(features.hasClosetItems, false);
    assert.equal(features.hasEligibleClosetItems, false);
  });

  it("j-6: null selfieSignals yields hasSelfieSignals=false — StyleMe still proceeds", () => {
    const features = computeFeatureAvailability({
      closetSummary: emptyClosetSummary(),
      selfieSignals: null,
      naiaModelReady: true,
      virtualTryOnEnabled: true,
      feedbackContext: emptyFeedbackContext(),
    });
    assert.equal(features.hasSelfieSignals, false);
    assert.equal(features.canStyleMe, true);
    assert.equal(features.naiaModelIsReady, true);
  });

});

// ═════════════════════════════════════════════════════════════════════════════
// 3 — Explicit preference override
// ═════════════════════════════════════════════════════════════════════════════

describe("explicit preference override", () => {

  it("j-7: EXPLICIT_PREFERENCE signal level is highest — selfie signals cannot reach it", () => {
    // A selfie signal can only ever be SOFT_RANK_SELFIE (30).
    // An explicit preference is EXPLICIT_PREFERENCE (100).
    // The selfie can never exceed the preference level.
    assert.ok(
      SIGNAL_PRECEDENCE.EXPLICIT_PREFERENCE > SIGNAL_PRECEDENCE.SOFT_RANK_SELFIE,
    );
  });

  it("j-8: selfie signal summary always carries SOFT_RANK behaviour — cannot be changed at boundary", () => {
    const summary = buildSelfieSignalSummary({
      colourFamilies: ["warm neutrals"],
      suggestedNecklines: ["V-neck"],
      contrastLevel: "high",
      overallNote: "Clear contrast works well",
    });
    // The boundary enforces SOFT_RANK — callers cannot construct a harder signal
    assert.equal(summary.behaviour, SELFIE_MAX_BEHAVIOUR);
    assert.equal(summary.behaviour, "SOFT_RANK");
  });

  it("j-9: feedback patterns always carry SOFT_RANK behaviour — cannot be elevated at boundary", () => {
    const context = buildFeedbackSignalContext({
      records: [
        { rating: "not-for-me", reasonCodes: ["too-formal", "too-formal", "too-formal"] },
      ],
      positivePostWearRate: null,
      migrationPending: false,
      postWearMigrationPending: false,
    });
    for (const pattern of context.activePatterns) {
      assert.equal(pattern.behaviour, FEEDBACK_MAX_BEHAVIOUR);
      assert.equal(pattern.behaviour, "SOFT_RANK");
    }
  });

});

// ═════════════════════════════════════════════════════════════════════════════
// 4 — Selfie signals remaining soft
// ═════════════════════════════════════════════════════════════════════════════

describe("selfie signals remaining soft", () => {

  it("j-10: SELFIE_MAX_BEHAVIOUR constant is 'SOFT_RANK' — never elevated", () => {
    assert.equal(SELFIE_MAX_BEHAVIOUR, "SOFT_RANK");
  });

  it("j-11: buildSelfieSignalSummary always sets behaviour to SOFT_RANK regardless of input", () => {
    const s = buildSelfieSignalSummary({
      colourFamilies: [],
      suggestedNecklines: [],
      contrastLevel: "low",
      overallNote: "",
    });
    assert.equal(s.available, true);
    assert.equal(s.behaviour, "SOFT_RANK");
  });

  it("j-12: selfie signals do not affect canStyleMe — StyleMe proceeds with or without them", () => {
    const withSelfie = computeFeatureAvailability({
      closetSummary: emptyClosetSummary(),
      selfieSignals: makeSelfie(),
      naiaModelReady: false,
      virtualTryOnEnabled: false,
      feedbackContext: emptyFeedbackContext(),
    });
    const withoutSelfie = computeFeatureAvailability({
      closetSummary: emptyClosetSummary(),
      selfieSignals: null,
      naiaModelReady: false,
      virtualTryOnEnabled: false,
      feedbackContext: emptyFeedbackContext(),
    });
    assert.equal(withSelfie.canStyleMe, true);
    assert.equal(withoutSelfie.canStyleMe, true);
  });

});

// ═════════════════════════════════════════════════════════════════════════════
// 5 — Feedback remaining soft
// ═════════════════════════════════════════════════════════════════════════════

describe("feedback remaining soft", () => {

  it("j-13: FEEDBACK_MAX_BEHAVIOUR constant is 'SOFT_RANK' — never elevated", () => {
    assert.equal(FEEDBACK_MAX_BEHAVIOUR, "SOFT_RANK");
  });

  it("j-14: all active feedback patterns carry SOFT_RANK regardless of count", () => {
    const context = buildFeedbackSignalContext({
      records: [
        { rating: "not-for-me", reasonCodes: ["too-formal"] },
        { rating: "not-for-me", reasonCodes: ["too-formal"] },
        { rating: "not-for-me", reasonCodes: ["too-formal"] },
        { rating: "not-for-me", reasonCodes: ["too-formal"] },
        { rating: "not-for-me", reasonCodes: ["too-formal"] },
      ],
      positivePostWearRate: null,
      migrationPending: false,
      postWearMigrationPending: false,
    });
    assert.ok(context.activePatterns.length > 0, "strong pattern should be present");
    for (const p of context.activePatterns) {
      assert.equal(p.behaviour, "SOFT_RANK", "even a count-5 pattern must remain SOFT_RANK");
    }
  });

  it("j-15: feedback patterns only emerge at count ≥ 2 — single response never becomes a pattern", () => {
    const context = buildFeedbackSignalContext({
      records: [{ rating: "not-for-me", reasonCodes: ["too-formal"] }],
      positivePostWearRate: null,
      migrationPending: false,
      postWearMigrationPending: false,
    });
    assert.equal(
      context.activePatterns.length, 0,
      "one response must not create a pattern",
    );
    assert.equal(context.totalFeedback, 1);
  });

});

// ═════════════════════════════════════════════════════════════════════════════
// 6 — Closet and NADINE mixed recommendations
// ═════════════════════════════════════════════════════════════════════════════

describe("closet and NADINE mixed recommendation context", () => {

  it("j-16: journey context supports closet items alongside NADINE product handles", () => {
    const closetSummary = aggregateClosetSummary([
      { category: "TOPS", tryOnEligibility: "ready-for-try-on" },
      { category: "SHOES", tryOnEligibility: "ready-for-try-on" },
    ]);
    const features = computeFeatureAvailability({
      closetSummary,
      selfieSignals: null,
      naiaModelReady: true,
      virtualTryOnEnabled: true,
      feedbackContext: emptyFeedbackContext(),
    });
    // Both closet and NADINE paths are available
    assert.equal(features.canStyleMe, true);
    assert.equal(features.hasClosetItems, true);
    assert.equal(features.hasEligibleClosetItems, true);
    // NADINE VTO gating unaffected by closet presence
    const gate = computeVtoGate({
      globalEnabled: true,
      naiaModelReady: true,
      productEligible: true,
    });
    assert.equal(gate.allowed, true);
  });

  it("j-17: closet summary correctly separates clothing, shoes and bags", () => {
    const summary = aggregateClosetSummary([
      { category: "TOPS", tryOnEligibility: "ready-for-try-on" },
      { category: "BOTTOMS", tryOnEligibility: "ready-for-try-on" },
      { category: "SHOES", tryOnEligibility: "needs-clearer-photo" },
      { category: "BAGS", tryOnEligibility: "not-supported" },
      { category: "DRESSES", tryOnEligibility: "pending-assessment" },
      { category: "ACCESSORIES", tryOnEligibility: null },
    ]);
    assert.equal(summary.byCategory.clothing, 3, "TOPS + BOTTOMS + DRESSES = 3");
    assert.equal(summary.byCategory.shoes, 1);
    assert.equal(summary.byCategory.bags, 1);
    assert.equal(summary.eligibleForTryOn, 2, "only TOPS + BOTTOMS are ready");
    assert.equal(summary.pendingAssessment, 1, "DRESSES pending");
  });

  it("j-18: ineligible closet VTO gate does not affect NADINE product gate", () => {
    const closetGate = computeVtoGate({
      globalEnabled: true,
      naiaModelReady: true,
      productEligible: true,
      closetItemEligibility: "needs-clearer-photo",
    });
    const nadineGate = computeVtoGate({
      globalEnabled: true,
      naiaModelReady: true,
      productEligible: true,
      // No closetItemEligibility — pure NADINE flow
    });
    assert.equal(closetGate.allowed, false, "closet item not ready blocks closet CTA");
    assert.equal(closetGate.blockedReason, "closet-item-not-ready");
    assert.equal(nadineGate.allowed, true, "NADINE CTA unaffected by closet ineligibility");
  });

});

// ═════════════════════════════════════════════════════════════════════════════
// 7 — Try-on eligibility gating
// ═════════════════════════════════════════════════════════════════════════════

describe("try-on eligibility gating", () => {

  it("j-19: feature-disabled blocks all try-on CTAs globally regardless of other state", () => {
    const gate = computeVtoGate({
      globalEnabled: false,
      naiaModelReady: true,
      productEligible: true,
    });
    assert.equal(gate.allowed, false);
    assert.equal(gate.blockedReason, "feature-disabled");
  });

  it("j-20: ineligible product suppresses its own CTA — model readiness is reported correctly", () => {
    const gate = computeVtoGate({
      globalEnabled: true,
      naiaModelReady: true,
      productEligible: false,
    });
    assert.equal(gate.allowed, false);
    assert.equal(gate.blockedReason, "product-not-eligible");
    assert.equal(gate.naiaModelReady, true, "model readiness is still reported");
  });

  it("j-21: pending-assessment closet item is treated as not-ready for VTO gate", () => {
    const gate = computeVtoGate({
      globalEnabled: true,
      naiaModelReady: true,
      productEligible: true,
      closetItemEligibility: "pending-assessment",
    });
    // "pending-assessment" is not "ready-for-try-on" → closetItemReady = false
    assert.equal(gate.allowed, false);
    assert.equal(gate.closetItemReady, false);
    assert.equal(gate.blockedReason, "closet-item-not-ready");
  });

});

// ═════════════════════════════════════════════════════════════════════════════
// 8 — Missing My nAia Model
// ═════════════════════════════════════════════════════════════════════════════

describe("missing My nAia Model", () => {

  it("j-22: no model → naiaModelIsReady=false and virtualTryOnAvailable=false", () => {
    const features = computeFeatureAvailability({
      closetSummary: emptyClosetSummary(),
      selfieSignals: makeSelfie(),
      naiaModelReady: false,
      virtualTryOnEnabled: true,
      feedbackContext: emptyFeedbackContext(),
    });
    assert.equal(features.naiaModelIsReady, false);
    assert.equal(features.virtualTryOnAvailable, false);
  });

  it("j-23: VTO gate with no model returns blocked reason 'no-model'", () => {
    const gate = computeVtoGate({
      globalEnabled: true,
      naiaModelReady: false,
      productEligible: true,
    });
    assert.equal(gate.allowed, false);
    assert.equal(gate.blockedReason, "no-model");
  });

  it("j-24: missing model does not affect canStyleMe or closet features", () => {
    const features = computeFeatureAvailability({
      closetSummary: aggregateClosetSummary(makeClosetItems()),
      selfieSignals: null,
      naiaModelReady: false,
      virtualTryOnEnabled: true,
      feedbackContext: emptyFeedbackContext(),
    });
    assert.equal(features.canStyleMe, true);
    assert.equal(features.hasClosetItems, true);
    assert.equal(features.naiaModelIsReady, false);
    assert.equal(features.virtualTryOnAvailable, false);
  });

});

// ═════════════════════════════════════════════════════════════════════════════
// 9 — Migration-pending behavior
// ═════════════════════════════════════════════════════════════════════════════

describe("migration-pending behavior", () => {

  it("j-25: feedback migration pending → feedbackHistoryAvailable=false", () => {
    const feedbackContext = emptyFeedbackContext({ migrationPending: true });
    const features = computeFeatureAvailability({
      closetSummary: emptyClosetSummary(),
      selfieSignals: null,
      naiaModelReady: true,
      virtualTryOnEnabled: true,
      feedbackContext,
    });
    assert.equal(feedbackContext.migrationPending, true);
    assert.equal(feedbackContext.available, false);
    assert.equal(features.feedbackHistoryAvailable, false);
  });

  it("j-26: buildFeedbackSignalContext with migrationPending returns empty safe state", () => {
    const context = buildFeedbackSignalContext({
      records: [],
      positivePostWearRate: null,
      migrationPending: true,
      postWearMigrationPending: true,
    });
    assert.equal(context.migrationPending, true);
    assert.equal(context.available, false);
    assert.equal(context.totalFeedback, 0);
    assert.deepEqual(context.activePatterns, []);
    assert.equal(context.positivePostWearRate, null);
  });

  it("j-27: journey context assembly degrades gracefully when selfie table missing", async () => {
    const context = await buildCustomerJourneyContext("test-cust-migration", {
      findSelfie: async () => {
        const err = new Error("The table `SelfieAnalysis` does not exist in the current database.");
        (err as any).code = "P2021";
        throw err;
      },
      findClosetItems: async () => [],
      findFeedback: async () => [],
      findPostWearRate: async () => ({ positiveRate: null }),
      findNaiaModel: async () => null,
      virtualTryOnEnabled: false,
    });
    assert.equal(context.selfieSignals, null, "selfie null when migration pending");
    assert.equal(context.migrationStatus.selfieAnalysisPending, true);
    assert.equal(context.features.canStyleMe, true, "StyleMe still available");
  });

});

// ═════════════════════════════════════════════════════════════════════════════
// 10 — Privacy-safe Designer Intelligence events
// ═════════════════════════════════════════════════════════════════════════════

describe("privacy-safe Designer Intelligence events", () => {

  it("j-28: emitted events contain customerIdHash not raw customerId", () => {
    const event = emitSessionStarted({
      customerId: CUST_A,
      sessionId: SESSION,
      occasion: "everyday",
      source: "naia-piece",
      hasSelfieGuidance: false,
      closetItemCount: 0,
      hasEligibleClosetItem: false,
      naiaModelIsReady: false,
      nowFn: FIXED_NOW,
    });
    assert.ok("customerIdHash" in event, "hash field must be present");
    assert.ok(!JSON.stringify(event).includes(CUST_A), "raw customerId must not appear");
    assert.notEqual(event.customerIdHash, CUST_A);
    assert.equal(event.customerIdHash.length, 12, "hash is 12 hex chars");
  });

  it("j-29: feedback_given event excludes reason codes and note text", () => {
    const event = emitFeedbackGiven({
      customerId: CUST_A,
      sessionId: SESSION,
      target: "nadine-product",
      rating: "not-for-me",
      hasNote: true,
      nowFn: FIXED_NOW,
    });
    const payloadKeys = Object.keys(event.payload);
    assert.ok(!payloadKeys.includes("reasonCodes"), "reason codes must not appear in event");
    assert.ok(!payloadKeys.includes("note"), "note text must not appear in event");
    assert.ok(payloadKeys.includes("hasNote"), "hasNote boolean is safe");
    assert.equal(event.payload.rating, "not-for-me");
  });

  it("j-30: post_wear_submitted event excludes howDidYouFeel and free-text note", () => {
    const event = emitPostWearSubmitted({
      customerId: CUST_A,
      sessionId: SESSION,
      didWearIt: "yes",
      wouldWearAgain: "definitely",
      nowFn: FIXED_NOW,
    });
    const payloadStr = JSON.stringify(event.payload);
    assert.ok(!payloadStr.includes("howDidYouFeel"), "howDidYouFeel excluded from event");
    assert.ok(!payloadStr.includes("note"), "free-text note excluded from event");
    assert.ok(event.payload.didWearIt === "yes");
    assert.ok(event.payload.wouldWearAgain === "definitely");
  });

});

// ═════════════════════════════════════════════════════════════════════════════
// 11 — No customer data leakage
// ═════════════════════════════════════════════════════════════════════════════

describe("no customer data leakage", () => {

  it("j-31: CustomerJourneyContext contains no customerId field", async () => {
    const context = await buildCustomerJourneyContext(CUST_A, {
      findSelfie: async () => null,
      findClosetItems: async () => [],
      findFeedback: async () => [],
      findPostWearRate: async () => ({ positiveRate: null }),
      findNaiaModel: async () => null,
      virtualTryOnEnabled: false,
    });
    // customerId must not be present anywhere in the context
    const serialized = JSON.stringify(context);
    assert.ok(!serialized.includes(CUST_A), "customerId must not appear in context object");
    assert.ok(!("customerId" in context), "no top-level customerId field");
  });

  it("j-32: closet summary contains no closet item IDs, image URLs, or names", () => {
    const summary = aggregateClosetSummary([
      { category: "TOPS", tryOnEligibility: "ready-for-try-on" },
    ]);
    const serialized = JSON.stringify(summary);
    // Only aggregated numbers and category counts — no item IDs or URLs
    assert.ok(!serialized.includes("closetItemId"));
    assert.ok(!serialized.includes("imageUrl"));
    assert.ok(!serialized.includes("publicId"));
    assert.equal(summary.totalItems, 1);
  });

  it("j-33: recommendation_served event contains no customer profile data", () => {
    const event = emitRecommendationServed({
      customerId: CUST_A,
      sessionId: SESSION,
      outcome: "nadine-recommendation",
      primaryHandle: "asymmetrical-pants",
      alternativeCount: 2,
      nowFn: FIXED_NOW,
    });
    const payloadStr = JSON.stringify(event.payload);
    // Product handle (catalog data) is fine; customer profile data is not
    assert.ok(!payloadStr.includes("stylePersonalities"));
    assert.ok(!payloadStr.includes("favoriteColors"));
    assert.ok(!payloadStr.includes("desiredImpression"));
    assert.equal(event.payload.primaryHandle, "asymmetrical-pants");
    assert.equal(event.payload.alternativeCount, 2);
  });

});

// ═════════════════════════════════════════════════════════════════════════════
// 12 — Deterministic journey state
// ═════════════════════════════════════════════════════════════════════════════

describe("deterministic journey state", () => {

  it("j-34: same inputs to computeFeatureAvailability always produce identical output", () => {
    const params = {
      closetSummary: aggregateClosetSummary(makeClosetItems(2)),
      selfieSignals: makeSelfie(),
      naiaModelReady: true,
      virtualTryOnEnabled: false,
      feedbackContext: makeFeedbackContext(),
    };
    const a = computeFeatureAvailability(params);
    const b = computeFeatureAvailability(params);
    assert.deepEqual(a, b, "feature availability must be deterministic");
  });

  it("j-35: hashCustomerId is stable — same input always produces the same hash", () => {
    const h1 = hashCustomerId(CUST_A);
    const h2 = hashCustomerId(CUST_A);
    assert.equal(h1, h2, "hash must be stable");
    assert.equal(h1.length, 12);
    // Different customers produce different hashes
    assert.notEqual(hashCustomerId(CUST_A), hashCustomerId("journey-cust-b"));
  });

  it("j-36: computeVtoGate is fully deterministic — no side effects", () => {
    const params = { globalEnabled: true, naiaModelReady: true, productEligible: true };
    const g1 = computeVtoGate(params);
    const g2 = computeVtoGate(params);
    assert.deepEqual(g1, g2);
    assert.equal(g1.allowed, true);
    assert.equal(g1.blockedReason, null);
  });

});
