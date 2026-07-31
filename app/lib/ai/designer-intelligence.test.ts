// app/lib/ai/designer-intelligence.test.ts
// Phase 4B2 — Designer Intelligence aggregation contract tests.
// All tests use pure functions with fixture data — no live DB, no network.
//
// Run: node --test --import tsx/esm app/lib/ai/designer-intelligence.test.ts

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  aggregateFeedbackEngagement,
  aggregateFeedbackDistribution,
  aggregateObjectionInsights,
  aggregateMostLovedProducts,
  aggregatePostWearCompletion,
  aggregateVTOMetrics,
  aggregateClosetTryOnReadiness,
  generateDesignerInsights,
  isMigrationError,
  emptyFeedbackEngagement,
  emptyFeedbackDistribution,
  emptyObjectionInsights,
  emptyPostWearCompletion,
  MINIMUM_RECORDS_FOR_TREND,
  type Phase4B2KPIs,
  type DesignerInsight,
} from "./designer-intelligence.server.ts";

// ── Fixture helpers ───────────────────────────────────────────────────────────

function makeKPIs(overrides: Partial<Phase4B2KPIs> = {}): Phase4B2KPIs {
  return {
    feedbackEngagement: emptyFeedbackEngagement(0, false),
    feedbackDistribution: emptyFeedbackDistribution(false),
    objectionInsights: emptyObjectionInsights(false),
    mostLovedProducts: [],
    mostLovedMigrationPending: false,
    postWearCompletion: emptyPostWearCompletion(false),
    vtoMetrics: { totalJobs: 0, completedJobs: 0, vtoFeedbackCount: 0, fidelityConcernCount: 0, fidelityConcernRate: 0, migrationPending: false },
    selfieAdoption: { customersWithSelfie: 0, totalCustomers: 0, adoptionRate: 0, migrationPending: false },
    closetTryOnReadiness: { totalItems: 0, readyItems: 0, pendingAssessmentItems: 0, ineligibleItems: 0, readinessRate: 0 },
    designerInsights: [],
    ...overrides,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. Aggregation — feedback engagement
// ═════════════════════════════════════════════════════════════════════════════

describe("aggregateFeedbackEngagement", () => {

  it("di-1: 3 out of 10 sessions have feedback → 30% response rate", () => {
    const sessions = new Set(["s1", "s2", "s3"]);
    const kpi = aggregateFeedbackEngagement(10, sessions);
    assert.equal(kpi.totalSessions, 10);
    assert.equal(kpi.sessionsWithFeedback, 3);
    assert.equal(kpi.feedbackResponseRate, 30);
    assert.equal(kpi.migrationPending, false);
  });

  it("di-2: zero sessions → 0% response rate (no divide-by-zero)", () => {
    const kpi = aggregateFeedbackEngagement(0, new Set());
    assert.equal(kpi.feedbackResponseRate, 0);
  });

  it("di-3: all sessions have feedback → 100% response rate", () => {
    const kpi = aggregateFeedbackEngagement(5, new Set(["a", "b", "c", "d", "e"]));
    assert.equal(kpi.feedbackResponseRate, 100);
  });

});

// ═════════════════════════════════════════════════════════════════════════════
// 2. Aggregation — feedback distribution (love/okay/not-for-me)
// ═════════════════════════════════════════════════════════════════════════════

describe("aggregateFeedbackDistribution", () => {

  it("di-4: counts love/okay/not-for-me correctly and derives rates", () => {
    const records = [
      { rating: "love" },
      { rating: "love" },
      { rating: "okay" },
      { rating: "not-for-me" },
    ];
    const kpi = aggregateFeedbackDistribution(records);
    assert.equal(kpi.love, 2);
    assert.equal(kpi.okay, 1);
    assert.equal(kpi.notForMe, 1);
    assert.equal(kpi.total, 4);
    assert.equal(kpi.loveRate, 50);
    assert.equal(kpi.okayRate, 25);
    assert.equal(kpi.notForMeRate, 25);
  });

  it("di-5: empty input → all zeros (no divide-by-zero)", () => {
    const kpi = aggregateFeedbackDistribution([]);
    assert.equal(kpi.total, 0);
    assert.equal(kpi.loveRate, 0);
  });

  it("di-6: unknown rating values are ignored (not counted)", () => {
    const records = [{ rating: "love" }, { rating: "unknown-future-value" as any }];
    const kpi = aggregateFeedbackDistribution(records);
    assert.equal(kpi.love, 1);
    assert.equal(kpi.total, 1, "unrecognised rating must not inflate total");
  });

});

// ═════════════════════════════════════════════════════════════════════════════
// 3. Aggregation — objection insights (reason code grouping)
// ═════════════════════════════════════════════════════════════════════════════

describe("aggregateObjectionInsights — reason grouping", () => {

  it("di-7: colour-not-for-me counted across okay and not-for-me records", () => {
    const records = [
      { rating: "not-for-me", reasonCodes: ["colour-not-for-me"] },
      { rating: "okay",       reasonCodes: ["colour-not-for-me", "too-formal"] },
      { rating: "love",       reasonCodes: [] }, // love records must NOT be counted
    ];
    const kpi = aggregateObjectionInsights(records);
    assert.equal(kpi.colourObjections, 2);
    assert.equal(kpi.tooFormalObjections, 1);
    assert.equal(kpi.total, 2, "love records must not be in the total");
  });

  it("di-8: fit-shape, too-revealing, too-covered, formality all counted separately", () => {
    const records = [
      { rating: "not-for-me", reasonCodes: ["fit-shape-not-for-me", "too-revealing"] },
      { rating: "not-for-me", reasonCodes: ["too-covered", "too-casual"] },
    ];
    const kpi = aggregateObjectionInsights(records);
    assert.equal(kpi.fitObjections, 1);
    assert.equal(kpi.tooRevealingObjections, 1);
    assert.equal(kpi.tooCoveredObjections, 1);
    assert.equal(kpi.tooCasualObjections, 1);
  });

  it("di-9: unknown reason codes are ignored without throwing", () => {
    const records = [
      { rating: "not-for-me", reasonCodes: ["colour-not-for-me", "INVALID_CODE_FUTURE"] },
    ];
    const kpi = aggregateObjectionInsights(records);
    assert.equal(kpi.colourObjections, 1);
    assert.equal(kpi.total, 1);
  });

  it("di-10: empty reason codes array is valid (no objections from that record)", () => {
    const records = [{ rating: "not-for-me", reasonCodes: [] }];
    const kpi = aggregateObjectionInsights(records);
    assert.equal(kpi.total, 1);
    assert.equal(kpi.colourObjections, 0);
  });

});

// ═════════════════════════════════════════════════════════════════════════════
// 4. Aggregation — most-loved products (minimum-data threshold)
// ═════════════════════════════════════════════════════════════════════════════

describe("aggregateMostLovedProducts — minimum-data threshold", () => {

  it("di-11: product with 3+ loves is surfaced", () => {
    const records = [
      { shopifyProductId: "prod-1", rating: "love" },
      { shopifyProductId: "prod-1", rating: "love" },
      { shopifyProductId: "prod-1", rating: "love" },
      { shopifyProductId: "prod-1", rating: "okay" },
    ];
    const result = aggregateMostLovedProducts(records, 3);
    assert.equal(result.length, 1);
    assert.equal(result[0].shopifyProductId, "prod-1");
    assert.equal(result[0].loveCount, 3);
    assert.equal(result[0].okayCount, 1);
    assert.equal(result[0].notForMeCount, 0);
  });

  it("di-12: product with fewer than minLoveCount loves is NOT surfaced", () => {
    const records = [
      { shopifyProductId: "prod-2", rating: "love" },
      { shopifyProductId: "prod-2", rating: "love" },
    ];
    const result = aggregateMostLovedProducts(records, 3);
    assert.equal(result.length, 0, "product with 2 loves must not appear when min=3");
  });

  it("di-13: records with null shopifyProductId are skipped (privacy — no closet items)", () => {
    const records = [
      { shopifyProductId: null, rating: "love" },
      { shopifyProductId: null, rating: "love" },
      { shopifyProductId: null, rating: "love" },
    ];
    const result = aggregateMostLovedProducts(records, 1);
    assert.equal(result.length, 0, "null shopifyProductId records must not appear");
  });

  it("di-14: result is sorted by loveCount descending", () => {
    const records = [
      { shopifyProductId: "low",  rating: "love" },
      { shopifyProductId: "low",  rating: "love" },
      { shopifyProductId: "low",  rating: "love" },
      { shopifyProductId: "high", rating: "love" },
      { shopifyProductId: "high", rating: "love" },
      { shopifyProductId: "high", rating: "love" },
      { shopifyProductId: "high", rating: "love" },
      { shopifyProductId: "high", rating: "love" },
    ];
    const result = aggregateMostLovedProducts(records, 3);
    assert.equal(result[0].shopifyProductId, "high");
    assert.equal(result[1].shopifyProductId, "low");
  });

});

// ═════════════════════════════════════════════════════════════════════════════
// 5. Aggregation — post-wear completion
// ═════════════════════════════════════════════════════════════════════════════

describe("aggregatePostWearCompletion — post-wear calculations", () => {

  it("di-15: correctly counts didWearIt yes and positive feelings", () => {
    const records = [
      { didWearIt: "yes", feelingAnswer: "great" },
      { didWearIt: "yes", feelingAnswer: "good" },
      { didWearIt: "not-yet", feelingAnswer: "great" },
      { didWearIt: "no", feelingAnswer: null },
    ];
    const kpi = aggregatePostWearCompletion(records);
    assert.equal(kpi.totalWithPostWear, 4);
    assert.equal(kpi.didWearItYes, 2);
    assert.equal(kpi.feltPositive, 3, "great + good both count as positive");
    assert.equal(kpi.wearRate, 50);
    assert.equal(kpi.positiveExperienceRate, 75);
  });

  it("di-16: empty input → all zeros (no divide-by-zero)", () => {
    const kpi = aggregatePostWearCompletion([]);
    assert.equal(kpi.totalWithPostWear, 0);
    assert.equal(kpi.wearRate, 0);
    assert.equal(kpi.positiveExperienceRate, 0);
  });

  it("di-17: null feelingAnswer is treated as not positive", () => {
    const records = [{ didWearIt: "yes", feelingAnswer: null }];
    const kpi = aggregatePostWearCompletion(records);
    assert.equal(kpi.feltPositive, 0);
    assert.equal(kpi.positiveExperienceRate, 0);
  });

});

// ═════════════════════════════════════════════════════════════════════════════
// 6. Aggregation — VTO metrics and fidelity grouping
// ═════════════════════════════════════════════════════════════════════════════

describe("aggregateVTOMetrics — VTO fidelity grouping", () => {

  it("di-18: counts completed jobs and fidelity concerns correctly", () => {
    const jobs = [
      { status: "COMPLETED" },
      { status: "COMPLETED" },
      { status: "FAILED" },
    ];
    const feedback = [
      { vtoAspects: ["garment-looks-inaccurate"] },
      { vtoAspects: ["layering-looks-inaccurate", "colour-looks-inaccurate"] },
      { vtoAspects: ["useful-despite-differences"] }, // NOT a fidelity concern
      { vtoAspects: ["preview-useful"] },              // NOT a fidelity concern
    ];
    const kpi = aggregateVTOMetrics(jobs, feedback);
    assert.equal(kpi.totalJobs, 3);
    assert.equal(kpi.completedJobs, 2);
    assert.equal(kpi.vtoFeedbackCount, 4);
    assert.equal(kpi.fidelityConcernCount, 2, "only records with at least one inaccuracy aspect count");
    assert.equal(kpi.fidelityConcernRate, 50);
  });

  it("di-19: accessory-placement-inaccurate counts as fidelity concern", () => {
    const kpi = aggregateVTOMetrics([], [{ vtoAspects: ["accessory-placement-inaccurate"] }]);
    assert.equal(kpi.fidelityConcernCount, 1);
  });

  it("di-20: useful-despite-differences does NOT count as fidelity concern", () => {
    const kpi = aggregateVTOMetrics([], [{ vtoAspects: ["useful-despite-differences"] }]);
    assert.equal(kpi.fidelityConcernCount, 0);
  });

  it("di-21: fidelity concern is per-record, not per-aspect (one record with 3 aspects = 1 concern)", () => {
    const kpi = aggregateVTOMetrics([], [{
      vtoAspects: ["garment-looks-inaccurate", "colour-looks-inaccurate", "layering-looks-inaccurate"],
    }]);
    assert.equal(kpi.fidelityConcernCount, 1);
  });

  it("di-22: zero feedback → 0% concern rate (no divide-by-zero)", () => {
    const kpi = aggregateVTOMetrics([{ status: "COMPLETED" }], []);
    assert.equal(kpi.fidelityConcernRate, 0);
  });

});

// ═════════════════════════════════════════════════════════════════════════════
// 7. Aggregation — closet try-on readiness
// ═════════════════════════════════════════════════════════════════════════════

describe("aggregateClosetTryOnReadiness", () => {

  it("di-23: correctly classifies ready, pending, and ineligible items", () => {
    const items = [
      { tryOnEligibility: "ready-for-try-on" },
      { tryOnEligibility: "ready-for-try-on" },
      { tryOnEligibility: "pending-assessment" },
      { tryOnEligibility: "needs-clearer-photo" },
      { tryOnEligibility: "not-supported" },
      { tryOnEligibility: null },
    ];
    const kpi = aggregateClosetTryOnReadiness(items);
    assert.equal(kpi.totalItems, 6);
    assert.equal(kpi.readyItems, 2);
    assert.equal(kpi.pendingAssessmentItems, 1);
    assert.equal(kpi.ineligibleItems, 2);
    assert.equal(kpi.readinessRate, 33);
  });

  it("di-24: empty closet → 0% readiness rate (no divide-by-zero)", () => {
    const kpi = aggregateClosetTryOnReadiness([]);
    assert.equal(kpi.readinessRate, 0);
  });

});

// ═════════════════════════════════════════════════════════════════════════════
// 8. Privacy — no customer-level data in aggregated output
// ═════════════════════════════════════════════════════════════════════════════

describe("privacy — no customer-level data leakage", () => {

  it("di-25: mostLovedProducts contains no customer identifiers", () => {
    const records = Array.from({ length: 5 }, () => ({
      shopifyProductId: "prod-x",
      rating: "love" as const,
    }));
    const result = aggregateMostLovedProducts(records, 3);
    assert.equal(result.length, 1);
    const keys = Object.keys(result[0]);
    assert.ok(!keys.includes("customerId"), "customerId must not be in output");
    assert.ok(!keys.includes("email"), "email must not be in output");
    assert.ok(!keys.includes("note"), "raw note must not be in output");
  });

  it("di-26: objection insights expose only counts, not individual records", () => {
    const records = [{ rating: "not-for-me", reasonCodes: ["colour-not-for-me"] }];
    const kpi = aggregateObjectionInsights(records);
    const keys = Object.keys(kpi);
    assert.ok(!keys.includes("records"), "raw records must not be exposed");
    assert.ok(!keys.includes("notes"), "customer notes must not be exposed");
    assert.ok(!keys.includes("customerId"), "customerId must not be exposed");
  });

  it("di-27: feedbackDistribution exposes only totals and rates, not individual records", () => {
    const records = [{ rating: "love" }, { rating: "not-for-me" }];
    const kpi = aggregateFeedbackDistribution(records);
    const keys = Object.keys(kpi);
    assert.ok(!keys.some(k => k.toLowerCase().includes("note")), "notes must not be in distribution KPI");
    assert.ok(!keys.some(k => k.toLowerCase().includes("customer")), "customer data must not be in distribution KPI");
  });

});

// ═════════════════════════════════════════════════════════════════════════════
// 9. Migration-pending states
// ═════════════════════════════════════════════════════════════════════════════

describe("migration-pending empty states", () => {

  it("di-28: emptyFeedbackEngagement returns migrationPending=true with zero values", () => {
    const kpi = emptyFeedbackEngagement(10, true);
    assert.equal(kpi.migrationPending, true);
    assert.equal(kpi.sessionsWithFeedback, 0);
    assert.equal(kpi.feedbackResponseRate, 0);
    assert.equal(kpi.totalSessions, 10, "totalSessions is preserved even when migration pending");
  });

  it("di-29: emptyObjectionInsights returns migrationPending=true with all zeros", () => {
    const kpi = emptyObjectionInsights(true);
    assert.equal(kpi.migrationPending, true);
    assert.equal(kpi.colourObjections, 0);
    assert.equal(kpi.total, 0);
  });

  it("di-30: isMigrationError detects P2021", () => {
    const err = Object.assign(new Error("table missing"), { code: "P2021" });
    assert.equal(isMigrationError(err), true);
  });

  it("di-31: isMigrationError detects P2022", () => {
    const err = Object.assign(new Error("column missing"), { code: "P2022" });
    assert.equal(isMigrationError(err), true);
  });

  it("di-32: isMigrationError detects Unknown field message", () => {
    const err = new Error("Unknown field `didWearIt` for type `PostOutfitReview`");
    assert.equal(isMigrationError(err), true);
  });

  it("di-33: isMigrationError returns false for unrelated errors", () => {
    const err = new Error("Connection refused");
    assert.equal(isMigrationError(err), false);
  });

  it("di-34: isMigrationError returns false for non-Error values", () => {
    assert.equal(isMigrationError("string error"), false);
    assert.equal(isMigrationError(null), false);
    assert.equal(isMigrationError(undefined), false);
  });

});

// ═════════════════════════════════════════════════════════════════════════════
// 10. Designer insights — generation and thresholds
// ═════════════════════════════════════════════════════════════════════════════

describe("generateDesignerInsights — minimum-data thresholds", () => {

  it("di-35: no insights when all KPIs are at zero (empty database)", () => {
    const insights = generateDesignerInsights(makeKPIs());
    assert.equal(insights.length, 0);
  });

  it("di-36: colour insight generated when colourObjections >= 3 and total >= 3", () => {
    const kpis = makeKPIs({
      objectionInsights: {
        ...emptyObjectionInsights(false),
        colourObjections: 3,
        total: 5,
      },
    });
    const insights = generateDesignerInsights(kpis);
    const colourInsight = insights.find(i => i.category === "colour");
    assert.ok(colourInsight, "colour insight must be present");
    assert.equal(colourInsight!.threshold, "moderate");
  });

  it("di-37: colour insight NOT generated when count < 3 (below threshold)", () => {
    const kpis = makeKPIs({
      objectionInsights: {
        ...emptyObjectionInsights(false),
        colourObjections: 2,
        total: 4,
      },
    });
    const insights = generateDesignerInsights(kpis);
    assert.ok(!insights.find(i => i.category === "colour"), "colour insight must not appear with only 2 records");
  });

  it("di-38: colour insight NOT generated when migrationPending=true", () => {
    const kpis = makeKPIs({
      objectionInsights: {
        ...emptyObjectionInsights(false),
        colourObjections: 10,
        total: 10,
        migrationPending: true,
      },
    });
    const insights = generateDesignerInsights(kpis);
    assert.ok(!insights.find(i => i.category === "colour"), "migration-pending must suppress insights");
  });

  it("di-39: coverage insight combines too-revealing and too-covered counts", () => {
    const kpis = makeKPIs({
      objectionInsights: {
        ...emptyObjectionInsights(false),
        tooRevealingObjections: 2,
        tooCoveredObjections: 2,
        total: 6,
      },
    });
    const insights = generateDesignerInsights(kpis);
    const coverageInsight = insights.find(i => i.category === "coverage");
    assert.ok(coverageInsight, "combined count of 4 must trigger coverage insight");
    assert.ok(coverageInsight!.signal.includes("4"), "signal must mention combined count");
  });

  it("di-40: VTO fidelity insight at >= 30% concern rate with >= 3 feedback records", () => {
    const kpis = makeKPIs({
      vtoMetrics: {
        totalJobs: 5,
        completedJobs: 5,
        vtoFeedbackCount: 4,
        fidelityConcernCount: 2,
        fidelityConcernRate: 50,
        migrationPending: false,
      },
    });
    const insights = generateDesignerInsights(kpis);
    const vtoInsight = insights.find(i => i.category === "vto-fidelity");
    assert.ok(vtoInsight, "VTO fidelity insight must be generated at 50% concern rate");
    assert.ok(vtoInsight!.suggestion.includes("imagery"), "suggestion must reference imagery review");
  });

  it("di-41: VTO fidelity insight NOT generated below 30% concern rate", () => {
    const kpis = makeKPIs({
      vtoMetrics: {
        totalJobs: 10,
        completedJobs: 10,
        vtoFeedbackCount: 10,
        fidelityConcernCount: 2,
        fidelityConcernRate: 20,
        migrationPending: false,
      },
    });
    const insights = generateDesignerInsights(kpis);
    assert.ok(!insights.find(i => i.category === "vto-fidelity"), "20% concern rate is below threshold");
  });

  it("di-42: post-wear insight generated when wearRate < 60% with sufficient data", () => {
    const kpis = makeKPIs({
      postWearCompletion: {
        totalWithPostWear: MINIMUM_RECORDS_FOR_TREND,
        didWearItYes: 2,
        feltPositive: 3,
        wearRate: 40,
        positiveExperienceRate: 60,
        migrationPending: false,
      },
    });
    const insights = generateDesignerInsights(kpis);
    const postWearInsight = insights.find(i => i.category === "post-wear");
    assert.ok(postWearInsight, "post-wear insight must appear when wearRate is 40%");
  });

  it("di-43: post-wear insight NOT generated when totalWithPostWear < MINIMUM_RECORDS_FOR_TREND", () => {
    const kpis = makeKPIs({
      postWearCompletion: {
        totalWithPostWear: MINIMUM_RECORDS_FOR_TREND - 1,
        didWearItYes: 0,
        feltPositive: 0,
        wearRate: 0,
        positiveExperienceRate: 0,
        migrationPending: false,
      },
    });
    const insights = generateDesignerInsights(kpis);
    assert.ok(!insights.find(i => i.category === "post-wear"), "insufficient data must suppress post-wear insight");
  });

  it("di-44: selfie insight generated when adoptionRate < 10% with >= 10 customers", () => {
    const kpis = makeKPIs({
      selfieAdoption: { customersWithSelfie: 0, totalCustomers: 10, adoptionRate: 0, migrationPending: false },
    });
    const insights = generateDesignerInsights(kpis);
    const selfieInsight = insights.find(i => i.category === "selfie");
    assert.ok(selfieInsight, "selfie adoption insight must appear");
  });

  it("di-45: selfie insight NOT generated when totalCustomers < 10 (insufficient denominator)", () => {
    const kpis = makeKPIs({
      selfieAdoption: { customersWithSelfie: 0, totalCustomers: 9, adoptionRate: 0, migrationPending: false },
    });
    const insights = generateDesignerInsights(kpis);
    assert.ok(!insights.find(i => i.category === "selfie"), "9 customers is below the threshold");
  });

  it("di-46: closet-readiness insight generated when readinessRate < 30% with >= 5 items", () => {
    const kpis = makeKPIs({
      closetTryOnReadiness: {
        totalItems: 10,
        readyItems: 2,
        pendingAssessmentItems: 5,
        ineligibleItems: 3,
        readinessRate: 20,
      },
    });
    const insights = generateDesignerInsights(kpis);
    const readinessInsight = insights.find(i => i.category === "closet-readiness");
    assert.ok(readinessInsight, "closet readiness insight must appear at 20%");
  });

  it("di-47: closet-readiness insight NOT generated when < 5 items (too small a sample)", () => {
    const kpis = makeKPIs({
      closetTryOnReadiness: {
        totalItems: 4,
        readyItems: 0,
        pendingAssessmentItems: 0,
        ineligibleItems: 4,
        readinessRate: 0,
      },
    });
    const insights = generateDesignerInsights(kpis);
    assert.ok(!insights.find(i => i.category === "closet-readiness"), "4 items is below threshold");
  });

  it("di-48: strong threshold when objection count >= MINIMUM_RECORDS_FOR_TREND", () => {
    const kpis = makeKPIs({
      objectionInsights: {
        ...emptyObjectionInsights(false),
        colourObjections: MINIMUM_RECORDS_FOR_TREND,
        total: MINIMUM_RECORDS_FOR_TREND + 2,
      },
    });
    const insights = generateDesignerInsights(kpis);
    const colourInsight = insights.find(i => i.category === "colour")!;
    assert.equal(colourInsight.threshold, "strong");
  });

  it("di-49: moderate threshold when objection count is 3 or 4", () => {
    const kpis = makeKPIs({
      objectionInsights: {
        ...emptyObjectionInsights(false),
        colourObjections: 4,
        total: 8,
      },
    });
    const insights = generateDesignerInsights(kpis);
    const colourInsight = insights.find(i => i.category === "colour")!;
    assert.equal(colourInsight.threshold, "moderate");
  });

});

// ═════════════════════════════════════════════════════════════════════════════
// 11. Malformed input and edge cases
// ═════════════════════════════════════════════════════════════════════════════

describe("malformed input handling", () => {

  it("di-50: records with empty reasonCodes array do not throw", () => {
    assert.doesNotThrow(() => {
      aggregateObjectionInsights([{ rating: "not-for-me", reasonCodes: [] }]);
    });
  });

  it("di-51: VTO records with empty vtoAspects do not throw or count as concerns", () => {
    const kpi = aggregateVTOMetrics([], [{ vtoAspects: [] }]);
    assert.equal(kpi.fidelityConcernCount, 0);
  });

  it("di-52: DB failure (non-migration error) is recognised as NOT a migration error", () => {
    const err = new Error("ETIMEDOUT: connection timed out");
    assert.equal(isMigrationError(err), false);
  });

  it("di-53: generateDesignerInsights never throws on all-migration-pending KPIs", () => {
    const kpis = makeKPIs({
      feedbackEngagement: emptyFeedbackEngagement(0, true),
      feedbackDistribution: emptyFeedbackDistribution(true),
      objectionInsights: emptyObjectionInsights(true),
      postWearCompletion: emptyPostWearCompletion(true),
      vtoMetrics: { ...aggregateVTOMetrics([], []), migrationPending: true },
      selfieAdoption: { customersWithSelfie: 0, totalCustomers: 0, adoptionRate: 0, migrationPending: true },
    });
    assert.doesNotThrow(() => generateDesignerInsights(kpis));
  });

});
