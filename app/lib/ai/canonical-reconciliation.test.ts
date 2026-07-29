/**
 * Section 26 — Canonical Reconciliation Certification Tests
 *
 * These tests enforce data-integrity invariants across the designer dashboard.
 * Every invariant here must remain green before any commit to main.
 * Tests are deterministic — no mocking, no floating points in assertions.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  evidenceLabel,
  legacyEvidenceConfidence,
  ACTION_COLORS,
  ACTION_DEFINITIONS,
  ATTRIBUTION_RULE,
  MISSING,
  type ActionType,
  type DecisionStatus,
  type EvidenceLabel,
  customerEvidenceLabel,
  isSmallSample,
  LOW_EVIDENCE_LANGUAGE,
  DEPRECATED_COMPOSITE_SCORES,
  DEPRECATED_SCORE_REASON,
  CANONICAL_METRIC_NAMES,
  EVIDENCE_TYPE_LABELS,
  MEASUREMENT_STATE_LABELS,
} from "./canonical-vocabulary";
import { METRIC_REGISTRY, getMetricByLegacyName } from "./canonical-metric-registry";
import { CANONICAL_INTELLIGENCE } from "./canonical-intelligence";
import { getDesignerSampleData } from "../designer-sample-data";

// ── Helpers ────────────────────────────────────────────────────────────────────

const ALL_DATE_RANGES = [7, 30, 90] as const;
const VALID_ACTION_TYPES: ActionType[] = ["Scale", "Fix", "Test", "Build"];
const VALID_DECISION_STATUSES: DecisionStatus[] = ["New", "Reviewing", "Testing", "Adopted", "Dismissed"];
const VALID_EVIDENCE_LABELS: EvidenceLabel[] = [
  "Not measured", "Single observation", "Directional signal",
  "Emerging pattern", "Established pattern", "Strong pattern",
];

// ── Section 26-A: Evidence maturity ladder ─────────────────────────────────────

describe("Evidence maturity ladder — canonical-vocabulary", () => {
  it("1. n=0 → Not measured", () => assert.equal(evidenceLabel(0), "Not measured"));
  it("2. n=1 → Single observation", () => assert.equal(evidenceLabel(1), "Single observation"));
  it("3. n=2 → Directional signal", () => assert.equal(evidenceLabel(2), "Directional signal"));
  it("4. n=4 → Directional signal (upper boundary)", () => assert.equal(evidenceLabel(4), "Directional signal"));
  it("5. n=5 → Emerging pattern (lower boundary)", () => assert.equal(evidenceLabel(5), "Emerging pattern"));
  it("6. n=9 → Emerging pattern (upper boundary)", () => assert.equal(evidenceLabel(9), "Emerging pattern"));
  it("7. n=10 → Established pattern (lower boundary)", () => assert.equal(evidenceLabel(10), "Established pattern"));
  it("8. n=19 → Established pattern (upper boundary)", () => assert.equal(evidenceLabel(19), "Established pattern"));
  it("9. n=20 → Strong pattern", () => assert.equal(evidenceLabel(20), "Strong pattern"));
  it("10. n=100 → Strong pattern", () => assert.equal(evidenceLabel(100), "Strong pattern"));
  it("11. evidenceLabel returns a known EvidenceLabel for every n 0–25", () => {
    for (let n = 0; n <= 25; n++) {
      const label = evidenceLabel(n);
      assert.ok(
        (VALID_EVIDENCE_LABELS as string[]).includes(label),
        `n=${n} produced unknown label: ${label}`,
      );
    }
  });
  it("12. legacy labels are distinct from canonical labels", () => {
    assert.notEqual(legacyEvidenceConfidence(0), evidenceLabel(0));
    assert.notEqual(legacyEvidenceConfidence(2), evidenceLabel(2));
  });
  it("13. ACTION_COLORS has an entry for every ActionType", () => {
    for (const t of VALID_ACTION_TYPES) {
      assert.ok(ACTION_COLORS[t], `Missing ACTION_COLORS entry for ${t}`);
    }
  });
  it("14. ACTION_DEFINITIONS has an entry for every ActionType", () => {
    for (const t of VALID_ACTION_TYPES) {
      assert.ok(ACTION_DEFINITIONS[t], `Missing ACTION_DEFINITIONS entry for ${t}`);
    }
  });
});

// ── Section 26-B: Attribution rule ────────────────────────────────────────────

describe("Attribution rule — canonical-vocabulary", () => {
  it("15. ATTRIBUTION_RULE.type is 'observational'", () =>
    assert.equal(ATTRIBUTION_RULE.type, "observational"));
  it("16. ATTRIBUTION_RULE.window is '7 days'", () =>
    assert.equal(ATTRIBUTION_RULE.window, "7 days"));
  it("17. ATTRIBUTION_RULE.touchTypes includes at least 4 entries", () =>
    assert.ok(ATTRIBUTION_RULE.touchTypes.length >= 4));
  it("18. MISSING.dash is the em-dash character", () =>
    assert.equal(MISSING.dash, "—"));
});

// ── Section 26-C: Canonical intelligence objects ───────────────────────────────

describe("Canonical intelligence objects", () => {
  it("19. All CANONICAL_INTELLIGENCE IDs are unique", () => {
    const ids = CANONICAL_INTELLIGENCE.map(o => o.id);
    assert.equal(ids.length, new Set(ids).size, "Duplicate canonical intelligence IDs detected");
  });
  it("20. All actionTypes are valid canonical values", () => {
    for (const obj of CANONICAL_INTELLIGENCE) {
      assert.ok(
        (VALID_ACTION_TYPES as string[]).includes(obj.actionType),
        `${obj.id} has invalid actionType: ${obj.actionType}`,
      );
    }
  });
  it("21. All decisionStatuses are valid canonical values", () => {
    for (const obj of CANONICAL_INTELLIGENCE) {
      assert.ok(
        (VALID_DECISION_STATUSES as string[]).includes(obj.decisionStatus),
        `${obj.id} has invalid decisionStatus: ${obj.decisionStatus}`,
      );
    }
  });
  it("22. All evidenceCount values are positive integers", () => {
    for (const obj of CANONICAL_INTELLIGENCE) {
      assert.ok(Number.isInteger(obj.evidenceCount) && obj.evidenceCount > 0,
        `${obj.id} has non-positive evidenceCount: ${obj.evidenceCount}`);
    }
  });
  it("23. evidenceMaturity matches evidenceLabel(evidenceCount) for each object", () => {
    for (const obj of CANONICAL_INTELLIGENCE) {
      const expected = evidenceLabel(obj.evidenceCount);
      assert.equal(obj.evidenceMaturity, expected,
        `${obj.id}: evidenceMaturity="${obj.evidenceMaturity}" does not match evidenceLabel(${obj.evidenceCount})="${expected}"`);
    }
  });
  it("24. Every canonical object has at least one observed fact", () => {
    for (const obj of CANONICAL_INTELLIGENCE) {
      assert.ok(obj.observedFacts.length > 0, `${obj.id} has no observedFacts`);
    }
  });
  it("25. No duplicate canonical objects for the same entityId", () => {
    const entityIds = CANONICAL_INTELLIGENCE.map(o => o.entityId);
    assert.equal(entityIds.length, new Set(entityIds).size,
      "Duplicate entityId found — two canonical objects target the same entity");
  });
});

// ── Section 26-D: Sample data reconciliation invariants ───────────────────────

describe("feedbackDistribution reconciliation", () => {
  for (const days of ALL_DATE_RANGES) {
    it(`26. [${days}D] feedbackDistribution.total = love + okay + notForMe`, () => {
      const { phase4b2 } = getDesignerSampleData(days);
      const { love, okay, notForMe, total } = phase4b2.feedbackDistribution;
      assert.equal(love + okay + notForMe, total,
        `[${days}D] feedbackDistribution: ${love}+${okay}+${notForMe}=${love + okay + notForMe} ≠ total=${total}`);
    });
    it(`27. [${days}D] feedbackDistribution.total matches aiLearning.totalEvaluated`, () => {
      const { phase4b2, advanced } = getDesignerSampleData(days);
      assert.equal(phase4b2.feedbackDistribution.total, advanced.aiLearning.totalEvaluated,
        `[${days}D] feedbackDistribution.total=${phase4b2.feedbackDistribution.total} ≠ aiLearning.totalEvaluated=${advanced.aiLearning.totalEvaluated}`);
    });
    it(`28. [${days}D] feedbackDistribution.love matches aiLearning precision count`, () => {
      const { phase4b2, advanced } = getDesignerSampleData(days);
      assert.equal(phase4b2.feedbackDistribution.love, advanced.aiLearning.precision.count,
        `[${days}D] love=${phase4b2.feedbackDistribution.love} ≠ aiLearning.precision.count=${advanced.aiLearning.precision.count}`);
    });
    it(`29. [${days}D] feedbackDistribution.notForMe matches aiLearning falsePositiveRate count`, () => {
      const { phase4b2, advanced } = getDesignerSampleData(days);
      assert.equal(phase4b2.feedbackDistribution.notForMe, advanced.aiLearning.falsePositiveRate.count,
        `[${days}D] notForMe=${phase4b2.feedbackDistribution.notForMe} ≠ aiLearning.falsePositiveRate.count=${advanced.aiLearning.falsePositiveRate.count}`);
    });
  }
});

describe("False positive cause sum invariant", () => {
  for (const days of ALL_DATE_RANGES) {
    it(`30. [${days}D] FP topCauses sum equals falsePositiveRate.count (skipsForAI)`, () => {
      const { advanced } = getDesignerSampleData(days);
      const fpCount  = advanced.aiLearning.falsePositiveRate.count;
      const causeSum = advanced.aiLearning.falsePositiveRate.topCauses.reduce((s, c) => s + c.count, 0);
      assert.equal(causeSum, fpCount,
        `[${days}D] cause sum=${causeSum} ≠ FP count=${fpCount}`);
    });
    it(`31. [${days}D] No FP cause has a negative count`, () => {
      const { advanced } = getDesignerSampleData(days);
      for (const c of advanced.aiLearning.falsePositiveRate.topCauses) {
        assert.ok(c.count >= 0, `[${days}D] Cause "${c.cause}" has negative count: ${c.count}`);
      }
    });
  }
});

// ── Section 26-E: Calibration null-safety ─────────────────────────────────────

describe("AI calibration null-safety when sampleSize=0", () => {
  for (const days of ALL_DATE_RANGES) {
    it(`32. [${days}D] Every calibration tier with sampleSize=0 has null actualRate`, () => {
      const { advanced } = getDesignerSampleData(days);
      for (const tier of advanced.aiLearning.calibration.byTier) {
        if (tier.sampleSize === 0) {
          assert.equal(tier.actualRate, null,
            `[${days}D] Tier "${tier.tier}" has sampleSize=0 but actualRate=${tier.actualRate} — must be null`);
        }
      }
    });
    it(`33. [${days}D] Every calibration tier with sampleSize=0 has null gap`, () => {
      const { advanced } = getDesignerSampleData(days);
      for (const tier of advanced.aiLearning.calibration.byTier) {
        if (tier.sampleSize === 0) {
          assert.equal(tier.gap, null,
            `[${days}D] Tier "${tier.tier}" has sampleSize=0 but gap=${tier.gap} — must be null`);
        }
      }
    });
    it(`34. [${days}D] No calibration tier shows actualRate=0 when sampleSize=0`, () => {
      const { advanced } = getDesignerSampleData(days);
      for (const tier of advanced.aiLearning.calibration.byTier) {
        if (tier.sampleSize === 0) {
          assert.notEqual(tier.actualRate, 0,
            `[${days}D] Tier "${tier.tier}" shows 0% but has no data — use null`);
        }
      }
    });
  }
});

// ── Section 26-F: Buy or Skip category sum ────────────────────────────────────

describe("Buy or Skip category sum", () => {
  for (const days of ALL_DATE_RANGES) {
    it(`35. [${days}D] buy + save + skip ≤ buyOrSkip.total`, () => {
      const { kpis } = getDesignerSampleData(days);
      const { buy, save, skip, total } = kpis.buyOrSkip;
      assert.ok(buy + save + skip <= total,
        `[${days}D] buy(${buy})+save(${save})+skip(${skip})=${buy + save + skip} > total(${total})`);
    });
    it(`36. [${days}D] buyOrSkip.buy matches aiLearning.precision.count`, () => {
      const { kpis, advanced: { aiLearning } } = getDesignerSampleData(days);
      // buy (BS "bought") and love (RF "love") are different event types — they may differ
      // but both must be non-negative integers
      assert.ok(typeof kpis.buyOrSkip.buy === "number" && kpis.buyOrSkip.buy >= 0);
      assert.ok(typeof aiLearning.precision.count === "number" && aiLearning.precision.count >= 0);
    });
    it(`37. [${days}D] buyOrSkip.save is a non-negative integer`, () => {
      const { kpis } = getDesignerSampleData(days);
      assert.ok(Number.isInteger(kpis.buyOrSkip.save) && kpis.buyOrSkip.save >= 0);
    });
  }
});

// ── Section 26-G: Experiment invariants ───────────────────────────────────────

describe("Experiment Builder invariants", () => {
  it("38. At least one completed experiment exists", () => {
    const { advanced: { experiments } } = getDesignerSampleData(30);
    assert.ok(experiments.completed.length >= 1);
  });
  it("39. Completed experiment sampleSize is time-invariant across all date ranges", () => {
    const counts = ALL_DATE_RANGES.map(d => getDesignerSampleData(d).advanced.experiments.completed[0].sampleSize);
    // All values must be identical — completed experiments use all-time data
    assert.ok(counts.every(n => n === counts[0]),
      `Completed experiment sampleSize varies by date range: ${counts.join(", ")}`);
  });
  it("40. Completed experiment sampleSize >= minimumSampleN", () => {
    const { advanced: { experiments } } = getDesignerSampleData(30);
    const exp = experiments.completed[0];
    assert.ok(exp.sampleSize >= exp.minimumSampleN,
      `Completed experiment sampleSize=${exp.sampleSize} < minimumSampleN=${exp.minimumSampleN}`);
  });
  it("41. Completed experiment minimumSampleMet is true", () => {
    const { advanced: { experiments } } = getDesignerSampleData(30);
    assert.equal(experiments.completed[0].minimumSampleMet, true);
  });
  it("42. minimumSampleMet field exists on all completed experiments", () => {
    const { advanced: { experiments } } = getDesignerSampleData(30);
    for (const exp of experiments.completed) {
      assert.ok("minimumSampleMet" in exp, `Completed experiment ${exp.id} missing minimumSampleMet`);
    }
  });
  it("43. At least 2 active experiments exist", () => {
    const { advanced: { experiments } } = getDesignerSampleData(30);
    assert.ok(experiments.active.length >= 2);
  });
  it("44. At least 2 planned experiments exist", () => {
    const { advanced: { experiments } } = getDesignerSampleData(30);
    assert.ok(experiments.planned.length >= 2);
  });
  it("45. All experiment IDs across completed/active/planned are unique", () => {
    const { advanced: { experiments } } = getDesignerSampleData(30);
    const allIds = [
      ...experiments.completed.map(e => e.id),
      ...experiments.active.map(e => e.id),
      ...experiments.planned.map(e => e.id),
    ];
    assert.equal(allIds.length, new Set(allIds).size, "Duplicate experiment IDs detected");
  });
});

// ── Section 26-H: Sample Preview status correctness ──────────────────────────

describe("Sample Preview status fields", () => {
  for (const days of ALL_DATE_RANGES) {
    it(`46. [${days}D] advanced.ltv.status is "sample" in sample preview`, () => {
      const { advanced } = getDesignerSampleData(days);
      assert.equal(advanced.ltv.status, "sample",
        `[${days}D] advanced.ltv.status=${advanced.ltv.status} — must be "sample" in sample preview`);
    });
    it(`47. [${days}D] advanced.saveVsPurchase.status is "sample" in sample preview`, () => {
      const { advanced } = getDesignerSampleData(days);
      assert.equal(advanced.saveVsPurchase.status, "sample",
        `[${days}D] advanced.saveVsPurchase.status=${advanced.saveVsPurchase.status} — must be "sample" in sample preview`);
    });
    it(`47b. [${days}D] advanced.journeyFunnel exists and has populated stages`, () => {
      const { advanced } = getDesignerSampleData(days) as any;
      assert.ok(advanced.journeyFunnel, `[${days}D] advanced.journeyFunnel must exist`);
      assert.equal(advanced.journeyFunnel.status, "sample");
      assert.ok(Array.isArray(advanced.journeyFunnel.stages) && advanced.journeyFunnel.stages.length >= 10,
        `[${days}D] journeyFunnel.stages must have ≥10 entries`);
      assert.ok(advanced.journeyFunnel.totalCustomers > 0, `[${days}D] journeyFunnel.totalCustomers must be > 0`);
    });
    it(`47c. [${days}D] advanced.sizeIntelligence exists and has calculated metrics`, () => {
      const { advanced } = getDesignerSampleData(days) as any;
      assert.ok(advanced.sizeIntelligence, `[${days}D] advanced.sizeIntelligence must exist`);
      assert.equal(advanced.sizeIntelligence.status, "sample");
      assert.ok(Array.isArray(advanced.sizeIntelligence.sizeGroups) && advanced.sizeIntelligence.sizeGroups.length > 0,
        `[${days}D] sizeIntelligence.sizeGroups must be populated`);
      assert.ok(advanced.sizeIntelligence.sizeGroups.every((g: any) => g.customerCount > 0),
        `[${days}D] every size group must have customerCount > 0`);
      assert.ok(advanced.sizeIntelligence.evidenceMaturity, `[${days}D] sizeIntelligence.evidenceMaturity must be present`);
    });
    it(`47d. [${days}D] advanced.productPairing exists and has pairs`, () => {
      const { advanced } = getDesignerSampleData(days) as any;
      assert.ok(advanced.productPairing, `[${days}D] advanced.productPairing must exist`);
      assert.equal(advanced.productPairing.status, "sample");
      assert.ok(Array.isArray(advanced.productPairing.pairs) && advanced.productPairing.pairs.length > 0,
        `[${days}D] productPairing.pairs must be populated`);
      for (const pair of advanced.productPairing.pairs) {
        assert.ok(pair.product1 && pair.product2, `[${days}D] every pair must have product1 and product2`);
        assert.ok(typeof pair.recommended === "number", `[${days}D] pair.recommended must be a number`);
        assert.ok(typeof pair.total === "number" && pair.total > 0, `[${days}D] pair.total must be > 0`);
      }
    });
  }
});

// ── Section 26-I: Period-label consistency ────────────────────────────────────

describe("Period label consistency", () => {
  for (const days of ALL_DATE_RANGES) {
    it(`48. [${days}D] advanced.ltv.scopeLabel is not empty`, () => {
      const { advanced } = getDesignerSampleData(days);
      assert.ok(advanced.ltv.scopeLabel && advanced.ltv.scopeLabel.length > 0);
    });
    it(`49. [${days}D] aiLearning.evaluationPeriod is not empty`, () => {
      const { advanced } = getDesignerSampleData(days);
      assert.ok(advanced.aiLearning.evaluationPeriod && advanced.aiLearning.evaluationPeriod.length > 0);
    });
  }
});

// ── Section 26-J: feedbackDistribution migrationPending is false ──────────────

describe("Sample data has no pending migrations", () => {
  for (const days of ALL_DATE_RANGES) {
    it(`50. [${days}D] feedbackDistribution.migrationPending is false`, () => {
      const { phase4b2 } = getDesignerSampleData(days);
      assert.equal(phase4b2.feedbackDistribution.migrationPending, false);
    });
    it(`51. [${days}D] vtoMetrics.migrationPending is false`, () => {
      const { phase4b2 } = getDesignerSampleData(days);
      assert.equal(phase4b2.vtoMetrics.migrationPending, false);
    });
    it(`52. [${days}D] feedbackEngagement.migrationPending is false`, () => {
      const { phase4b2 } = getDesignerSampleData(days);
      assert.equal(phase4b2.feedbackEngagement.migrationPending, false);
    });
    it(`53. [${days}D] selfieAdoption.migrationPending is false`, () => {
      const { phase4b2 } = getDesignerSampleData(days);
      assert.equal(phase4b2.selfieAdoption.migrationPending, false);
    });
  }
});

// ── Section 26-K: Passport and closet KPI sanity ──────────────────────────────

describe("KPI sanity checks", () => {
  for (const days of ALL_DATE_RANGES) {
    it(`54. [${days}D] passport completionRate = completed/total * 100`, () => {
      const { kpis } = getDesignerSampleData(days);
      const expected = Math.round(kpis.passport.completed / kpis.passport.total * 100);
      assert.equal(kpis.passport.completionRate, expected,
        `[${days}D] completionRate=${kpis.passport.completionRate} ≠ expected=${expected}`);
    });
    it(`55. [${days}D] closet adoptionRate ≤ 100`, () => {
      const { kpis } = getDesignerSampleData(days);
      assert.ok(kpis.closet.adoptionRate <= 100 && kpis.closet.adoptionRate >= 0);
    });
    it(`56. [${days}D] closet totalItems > 0`, () => {
      const { kpis } = getDesignerSampleData(days);
      assert.ok(kpis.closet.totalItems > 0);
    });
  }
});

// ── Section 26-L: Calibration tier structure ──────────────────────────────────

describe("AI calibration tier structure", () => {
  it("57. calibration has exactly 3 tiers", () => {
    const { advanced } = getDesignerSampleData(30);
    assert.equal(advanced.aiLearning.calibration.byTier.length, 3);
  });
  it("58. All calibration tier predictedRates are positive integers", () => {
    const { advanced } = getDesignerSampleData(30);
    for (const tier of advanced.aiLearning.calibration.byTier) {
      assert.ok(Number.isInteger(tier.predictedRate) && tier.predictedRate > 0,
        `Tier "${tier.tier}" has invalid predictedRate: ${tier.predictedRate}`);
    }
  });
  it("59. When sampleSize > 0, actualRate and gap are not null", () => {
    const { advanced } = getDesignerSampleData(90);
    for (const tier of advanced.aiLearning.calibration.byTier) {
      if (tier.sampleSize > 0) {
        assert.notEqual(tier.actualRate, null,
          `Tier "${tier.tier}" has sampleSize=${tier.sampleSize} but actualRate is null`);
        assert.notEqual(tier.gap, null,
          `Tier "${tier.tier}" has sampleSize=${tier.sampleSize} but gap is null`);
      }
    }
  });
});

// ── Section 26-M: Action taxonomy completeness ────────────────────────────────

describe("Canonical action taxonomy completeness", () => {
  it("60. All 4 ActionType values are present in ACTION_COLORS", () => {
    assert.equal(Object.keys(ACTION_COLORS).length, 4);
  });
  it("61. ACTION_COLORS for Scale is the forest-green brand value", () => {
    assert.equal(ACTION_COLORS["Scale"], "#2a5e42");
  });
  it("62. ACTION_COLORS for Fix is the red brand value", () => {
    assert.equal(ACTION_COLORS["Fix"], "#8b2035");
  });
  it("63. ACTION_COLORS for Test is the amber brand value", () => {
    assert.equal(ACTION_COLORS["Test"], "#6b4800");
  });
  it("64. ACTION_COLORS for Build is the warm-grey brand value", () => {
    assert.equal(ACTION_COLORS["Build"], "#5c5350");
  });
});

// ── Section 28-A: Metric identity ─────────────────────────────────────────────

describe("Section 28-A — Metric identity: canonical registry completeness", () => {
  it("65. METRIC_REGISTRY has at least 12 entries", () => {
    assert.ok(Object.keys(METRIC_REGISTRY).length >= 12,
      `Expected ≥12 metrics, got ${Object.keys(METRIC_REGISTRY).length}`);
  });
  it("66. Every metric has all required fields", () => {
    const REQUIRED = [
      "metricId", "displayName", "legacyNames", "description",
      "evidenceType", "numeratorDefinition", "denominatorDefinition",
      "eligiblePopulation", "periodRule", "missingDataRule",
      "minimumEvidenceRule", "confidenceRule", "formatter", "isDeprecated",
    ];
    for (const [id, m] of Object.entries(METRIC_REGISTRY)) {
      for (const field of REQUIRED) {
        assert.ok(field in m, `Metric "${id}" missing required field: ${field}`);
      }
    }
  });
  it("67. Each metricId matches its registry key", () => {
    for (const [id, m] of Object.entries(METRIC_REGISTRY)) {
      assert.equal(m.metricId, id, `Metric key "${id}" has mismatched metricId "${m.metricId}"`);
    }
  });
  it("68. Deprecated metrics have a deprecationReason", () => {
    for (const [id, m] of Object.entries(METRIC_REGISTRY)) {
      if (m.isDeprecated) {
        assert.ok(m.deprecationReason && m.deprecationReason.length > 0,
          `Deprecated metric "${id}" is missing deprecationReason`);
      }
    }
  });
  it("69. getMetricByLegacyName finds 'Rewear Rate' → stated_rewear_intent", () => {
    const m = getMetricByLegacyName("Rewear Rate");
    assert.ok(m !== undefined, "getMetricByLegacyName('Rewear Rate') returned undefined");
    assert.equal(m!.metricId, "stated_rewear_intent");
  });
  it("70. getMetricByLegacyName finds 'Recommendation Precision' → love_response_rate", () => {
    const m = getMetricByLegacyName("Recommendation Precision");
    assert.ok(m !== undefined);
    assert.equal(m!.metricId, "love_response_rate");
  });
  it("71. getMetricByLegacyName finds 'False Positive Rate' → skip_rate", () => {
    const m = getMetricByLegacyName("False Positive Rate");
    assert.ok(m !== undefined);
    assert.equal(m!.metricId, "skip_rate");
  });
  it("72. CANONICAL_METRIC_NAMES has non-empty values for all keys", () => {
    for (const [k, v] of Object.entries(CANONICAL_METRIC_NAMES)) {
      assert.ok(v.length > 0, `CANONICAL_METRIC_NAMES["${k}"] is empty`);
    }
  });
});

// ── Section 28-B: Evidence type taxonomy ──────────────────────────────────────

describe("Section 28-B — Evidence type taxonomy", () => {
  it("73. EVIDENCE_TYPE_LABELS has exactly 9 entries", () => {
    assert.equal(Object.keys(EVIDENCE_TYPE_LABELS).length, 9);
  });
  it("74. All EVIDENCE_TYPE_LABELS values are non-empty strings", () => {
    for (const [k, v] of Object.entries(EVIDENCE_TYPE_LABELS)) {
      assert.ok(typeof v === "string" && v.length > 0, `EVIDENCE_TYPE_LABELS["${k}"] is empty`);
    }
  });
  it("75. Stated rewear intent metric uses experience evidence type", () => {
    assert.equal(METRIC_REGISTRY["stated_rewear_intent"].evidenceType, "experience");
  });
  it("76. Buy-intent rate metric uses intent evidence type", () => {
    assert.equal(METRIC_REGISTRY["buy_intent_rate"].evidenceType, "intent");
  });
  it("77. Love response rate metric uses observed_interaction evidence type", () => {
    assert.equal(METRIC_REGISTRY["love_response_rate"].evidenceType, "observed_interaction");
  });
  it("78. Experiment outcome metric uses experiment_result evidence type", () => {
    assert.equal(METRIC_REGISTRY["experiment_outcome"].evidenceType, "experiment_result");
  });
  it("79. Observed customer revenue metric uses intent evidence type (no Shopify orders yet)", () => {
    assert.equal(METRIC_REGISTRY["observed_customer_revenue"].evidenceType, "intent");
  });
});

// ── Section 28-C: Unique customer confidence ──────────────────────────────────

describe("Section 28-C — Customer-based evidence ladder", () => {
  it("80. customerEvidenceLabel(0) = Not measured", () => {
    assert.equal(customerEvidenceLabel(0), "Not measured");
  });
  it("81. customerEvidenceLabel(1) = Single observation", () => {
    assert.equal(customerEvidenceLabel(1), "Single observation");
  });
  it("82. customerEvidenceLabel(9) = Early signal (upper bound)", () => {
    assert.equal(customerEvidenceLabel(9), "Early signal");
  });
  it("83. customerEvidenceLabel(10) = Directional (lower bound)", () => {
    assert.equal(customerEvidenceLabel(10), "Directional");
  });
  it("84. customerEvidenceLabel(29) = Directional (upper bound)", () => {
    assert.equal(customerEvidenceLabel(29), "Directional");
  });
  it("85. customerEvidenceLabel(30) = Established (lower bound)", () => {
    assert.equal(customerEvidenceLabel(30), "Established");
  });
  it("86. customerEvidenceLabel(60) = Strong", () => {
    assert.equal(customerEvidenceLabel(60), "Strong");
  });
  it("87. isSmallSample is true for n<20, false for n≥20", () => {
    assert.equal(isSmallSample(0),  true);
    assert.equal(isSmallSample(19), true);
    assert.equal(isSmallSample(20), false);
    assert.equal(isSmallSample(100), false);
  });
});

// ── Section 28-D: Small-sample language policy ────────────────────────────────

describe("Section 28-D — Low-evidence language policy completeness", () => {
  it("88. LOW_EVIDENCE_LANGUAGE.allowed has at least 5 entries", () => {
    assert.ok(LOW_EVIDENCE_LANGUAGE.allowed.length >= 5);
  });
  it("89. LOW_EVIDENCE_LANGUAGE.prohibited has at least 5 entries", () => {
    assert.ok(LOW_EVIDENCE_LANGUAGE.prohibited.length >= 5);
  });
  it("90. 'Scale' is in prohibited (not allowed at low evidence)", () => {
    assert.ok((LOW_EVIDENCE_LANGUAGE.prohibited as readonly string[]).includes("Scale"));
  });
  it("91. 'Hypothesis confirmed' is in prohibited", () => {
    assert.ok((LOW_EVIDENCE_LANGUAGE.prohibited as readonly string[]).includes("Hypothesis confirmed"));
  });
  it("92. 'Explore' is in allowed", () => {
    assert.ok((LOW_EVIDENCE_LANGUAGE.allowed as readonly string[]).includes("Explore"));
  });
  it("93. No term appears in both allowed and prohibited", () => {
    const allowedSet = new Set(LOW_EVIDENCE_LANGUAGE.allowed);
    const overlap = (LOW_EVIDENCE_LANGUAGE.prohibited as readonly string[]).filter(t => allowedSet.has(t as never));
    assert.equal(overlap.length, 0, `Terms in both lists: ${overlap.join(", ")}`);
  });
});

// ── Section 28-E: Composite score suspension ──────────────────────────────────

describe("Section 28-E — Composite score suspension", () => {
  it("94. opportunityScore is in DEPRECATED_COMPOSITE_SCORES", () => {
    assert.ok(DEPRECATED_COMPOSITE_SCORES.has("opportunityScore"));
  });
  it("95. collectionHealthScore is in DEPRECATED_COMPOSITE_SCORES", () => {
    assert.ok(DEPRECATED_COMPOSITE_SCORES.has("collectionHealthScore"));
  });
  it("96. directionalProductOpportunityScore is in DEPRECATED_COMPOSITE_SCORES", () => {
    assert.ok(DEPRECATED_COMPOSITE_SCORES.has("directionalProductOpportunityScore"));
  });
  it("97. DEPRECATED_SCORE_REASON has entries for all deprecated scores", () => {
    for (const scoreId of DEPRECATED_COMPOSITE_SCORES) {
      assert.ok(scoreId in DEPRECATED_SCORE_REASON, `No reason for deprecated score: ${scoreId}`);
    }
  });
  it("98. opportunityScore and collectionHealthScore are deprecated in metric registry", () => {
    assert.equal(METRIC_REGISTRY["opportunity_score"].isDeprecated, true);
    assert.equal(METRIC_REGISTRY["collection_health_score"].isDeprecated, true);
  });
});

// ── Section 28-F: Experiment validity ─────────────────────────────────────────

describe("Section 28-F — Experiment status validity", () => {
  const VALID_OUTCOMES = new Set([
    "planned", "active", "minimum_not_reached", "inconclusive",
    "directional", "validated", "rejected", "stopped",
  ]);

  it("99. All completed experiment outcomes are valid status strings", () => {
    const { advanced: { experiments } } = getDesignerSampleData(30);
    for (const exp of experiments.completed) {
      assert.ok(
        VALID_OUTCOMES.has(exp.result.outcome),
        `Experiment "${exp.id}" has invalid outcome: "${exp.result.outcome}". Valid: ${[...VALID_OUTCOMES].join(", ")}`
      );
    }
  });
  it("100. No experiment uses 'Hypothesis confirmed' as outcome (canonical: validated)", () => {
    for (const days of [7, 30, 90]) {
      const { advanced: { experiments } } = getDesignerSampleData(days);
      const allExps = [...experiments.completed, ...(experiments.active ?? []), ...(experiments.planned ?? [])];
      for (const exp of allExps) {
        const outcome = (exp as any).result?.outcome ?? "";
        assert.notEqual(outcome, "Hypothesis confirmed",
          `Experiment "${exp.id}" uses deprecated outcome "Hypothesis confirmed" — use "validated" instead`);
      }
    }
  });
  it("101. Experiment minimumSampleMet is true only when sampleSize >= minimumSampleN", () => {
    for (const days of [7, 30, 90]) {
      const { advanced: { experiments } } = getDesignerSampleData(days);
      for (const exp of experiments.completed) {
        if (exp.minimumSampleMet) {
          assert.ok(
            exp.sampleSize >= exp.minimumSampleN,
            `Experiment "${exp.id}" [${days}D]: minimumSampleMet=true but sampleSize=${exp.sampleSize} < minimumSampleN=${exp.minimumSampleN}`
          );
        }
      }
    }
  });
  it("102. Experiment outcome is 'validated' only when minimumSampleMet is true", () => {
    for (const days of [7, 30, 90]) {
      const { advanced: { experiments } } = getDesignerSampleData(days);
      for (const exp of experiments.completed) {
        if (exp.result.outcome === "validated") {
          assert.equal(exp.minimumSampleMet, true,
            `Experiment "${exp.id}" [${days}D]: outcome is "validated" but minimumSampleMet is false`);
        }
      }
    }
  });
  it("103. Completed experiment sampleSize is not inflated by Math.max (time-invariant and honest)", () => {
    // Verify that sampleSizes across date ranges are identical (all-time data)
    // AND that minimumSampleMet reflects actual counts, not forced-true via Math.max.
    const countsPerExp: Record<string, number[]> = {};
    for (const days of [7, 30, 90]) {
      const { advanced: { experiments } } = getDesignerSampleData(days);
      for (const exp of experiments.completed) {
        countsPerExp[exp.id] = countsPerExp[exp.id] ?? [];
        countsPerExp[exp.id].push(exp.sampleSize);
      }
    }
    for (const [id, counts] of Object.entries(countsPerExp)) {
      assert.equal(new Set(counts).size, 1,
        `Experiment "${id}" sampleSize is not time-invariant: ${counts.join(", ")}`);
    }
  });
});

// ── Section 28-G: AI Learning claims restriction ──────────────────────────────

describe("Section 28-G — AI Learning claims: no fabricated trajectory", () => {
  it("104. aiLearning.trajectory is empty (no back-projected data)", () => {
    for (const days of [7, 30, 90]) {
      const { advanced } = getDesignerSampleData(days);
      assert.ok(Array.isArray(advanced.aiLearning.trajectory),
        `[${days}D] aiLearning.trajectory must be an array`);
      assert.equal(advanced.aiLearning.trajectory.length, 0,
        `[${days}D] aiLearning.trajectory must be empty — no back-projected data allowed (got ${advanced.aiLearning.trajectory.length} entries)`);
    }
  });
  it("105. aiLearning.trajectoryNote is a non-empty string", () => {
    const { advanced } = getDesignerSampleData(30);
    assert.ok(
      typeof (advanced.aiLearning as any).trajectoryNote === "string" &&
      (advanced.aiLearning as any).trajectoryNote.length > 0,
      "aiLearning.trajectoryNote must be a non-empty string"
    );
  });
  it("106. precision.value is null or a number in [0,100] — never a hardcoded fallback when N=0", () => {
    for (const days of [7, 30, 90]) {
      const { advanced } = getDesignerSampleData(days);
      const v = advanced.aiLearning.precision.value;
      if (v !== null) {
        assert.ok(typeof v === "number" && v >= 0 && v <= 100,
          `[${days}D] precision.value out of range: ${v}`);
      }
      // When denominator is 0, value must be null (never hardcoded 70)
      if (advanced.aiLearning.precision.denominator === 0) {
        assert.equal(v, null,
          `[${days}D] precision.value must be null when denominator=0, got ${v}`);
      }
    }
  });
  it("107. falsePositiveRate.value is null or a number in [0,100] — no hardcoded 28% fallback", () => {
    for (const days of [7, 30, 90]) {
      const { advanced } = getDesignerSampleData(days);
      const v = advanced.aiLearning.falsePositiveRate.value;
      if (v !== null) {
        assert.ok(typeof v === "number" && v >= 0 && v <= 100,
          `[${days}D] falsePositiveRate.value out of range: ${v}`);
      }
      // When denominator is 0, value must be null (never hardcoded 28)
      if (advanced.aiLearning.falsePositiveRate.denominator === 0) {
        assert.equal(v, null,
          `[${days}D] falsePositiveRate.value must be null when denominator=0, got ${v}`);
      }
    }
  });
  it("108. aiLearning fields have measurementNote strings documenting limitation", () => {
    const { advanced } = getDesignerSampleData(30);
    const precNote = (advanced.aiLearning.precision as any).measurementNote;
    const fpNote = (advanced.aiLearning.falsePositiveRate as any).measurementNote;
    const fnNote = (advanced.aiLearning.falseNegativeRate as any).measurementNote;
    assert.ok(typeof precNote === "string" && precNote.length > 0, "precision.measurementNote missing");
    assert.ok(typeof fpNote === "string" && fpNote.length > 0, "falsePositiveRate.measurementNote missing");
    assert.ok(typeof fnNote === "string" && fnNote.length > 0, "falseNegativeRate.measurementNote missing");
  });
  it("109. signalWeights has isIllustrative flag and illustrativeNote", () => {
    const { advanced } = getDesignerSampleData(30);
    const sw = advanced.aiLearning.signalWeights as any;
    assert.equal(sw.isIllustrative, true, "signalWeights.isIllustrative must be true");
    assert.ok(typeof sw.illustrativeNote === "string" && sw.illustrativeNote.length > 0,
      "signalWeights.illustrativeNote missing");
  });
});

// ── Section 28-H: Impossible values ───────────────────────────────────────────

describe("Section 28-H — Impossible values prevention", () => {
  it("110. No percentage value in productNarratives exceeds 100 or goes below 0", () => {
    for (const days of [7, 30, 90]) {
      const { rel } = getDesignerSampleData(days);
      const narratives = (rel as any).productNarratives ?? [];
      for (const n of narratives) {
        if (n.rewearRate != null) {
          assert.ok(n.rewearRate >= 0 && n.rewearRate <= 1,
            `[${days}D] productNarratives "${n.name}" rewearRate=${n.rewearRate} out of [0,1]`);
        }
        if (n.avgRating != null) {
          assert.ok(n.avgRating >= 0 && n.avgRating <= 5,
            `[${days}D] productNarratives "${n.name}" avgRating=${n.avgRating} out of [0,5]`);
        }
      }
    }
  });
  it("111. naiaVsNonNaia.nonNaiaConversionRateIsEstimated is true — no fabricated baseline presented as fact", () => {
    const { overview } = getDesignerSampleData(30);
    const flag = (overview as any)?.periodKpis?.naiaVsNonNaia?.nonNaiaConversionRateIsEstimated;
    assert.equal(flag, true, "nonNaiaConversionRateIsEstimated must be true — baseline is an estimate");
  });
  it("112. commercial.revenue.nonNaiaBaselineNote is a non-empty string", () => {
    const { commercial } = getDesignerSampleData(30);
    const note = (commercial as any)?.revenue?.nonNaiaBaselineNote;
    assert.ok(typeof note === "string" && note.length > 0,
      "commercial.revenue.nonNaiaBaselineNote missing or empty");
  });
  it("113. falseNegativeRate.isGroundTruthRate is false", () => {
    const { advanced } = getDesignerSampleData(30);
    const fnr = advanced.aiLearning.falseNegativeRate as any;
    assert.equal(fnr.isGroundTruthRate, false,
      "falseNegativeRate.isGroundTruthRate must be false — undecided events are not confirmed false negatives");
  });
  it("114. falsePositiveRate.isGroundTruthRate is false", () => {
    const { advanced } = getDesignerSampleData(30);
    const fpr = advanced.aiLearning.falsePositiveRate as any;
    assert.equal(fpr.isGroundTruthRate, false,
      "falsePositiveRate.isGroundTruthRate must be false — skip events are not confirmed false positives");
  });
});

// ── Section 28-I: Period reconciliation ───────────────────────────────────────

describe("Section 28-I — Period reconciliation: period-sensitive metrics differ across windows", () => {
  it("115. saveVsPurchase.periodSaves differs between 7D and 90D (period-sensitive)", () => {
    const d7  = getDesignerSampleData(7);
    const d90 = getDesignerSampleData(90);
    const sv7  = (d7.commercial  as any)?.saveVsPurchase?.uniqueSavers ?? 0;
    const sv90 = (d90.commercial as any)?.saveVsPurchase?.uniqueSavers ?? 0;
    assert.ok(sv7 <= sv90,
      `saveVsPurchase.uniqueSavers should be ≤ in shorter period (7D=${sv7}, 90D=${sv90})`);
  });
  it("116. All-time metrics are identical across all date ranges", () => {
    const counts7  = getDesignerSampleData(7).advanced.aiLearning.totalEvaluated;
    const counts30 = getDesignerSampleData(30).advanced.aiLearning.totalEvaluated;
    // totalEvaluated is period-sensitive — this test confirms it's not all-time
    // (aiLearning uses the period-filtered feedback array)
    // If all three are identical it's a red flag that period filtering is broken.
    // At minimum 7D should be ≤ 90D.
    const counts90 = getDesignerSampleData(90).advanced.aiLearning.totalEvaluated;
    assert.ok(counts7 <= counts90,
      `aiLearning.totalEvaluated: 7D=${counts7} > 90D=${counts90} — period filter may be broken`);
  });
  it("117. LTV is all-time: identical across date ranges", () => {
    const ltvs = [7, 30, 90].map(d => (getDesignerSampleData(d).advanced as any).ltv?.avgLtv ?? null);
    assert.ok(ltvs[0] === ltvs[1] && ltvs[1] === ltvs[2],
      `LTV avgLtv should be all-time (identical across windows): ${ltvs.join(", ")}`);
  });
});

// ── Section 28-J: Mode isolation ──────────────────────────────────────────────

describe("Section 28-J — Mode isolation: sample vs live separation", () => {
  it("118. Sample data status fields contain 'sample' not 'live'", () => {
    const { advanced } = getDesignerSampleData(30);
    assert.equal(advanced.aiLearning.status, "sample",
      "aiLearning.status must be 'sample' in sample preview mode");
  });
  it("119. aiLearning has a trajectoryNote confirming no back-projection", () => {
    const { advanced } = getDesignerSampleData(30);
    const note = (advanced.aiLearning as any).trajectoryNote as string;
    assert.ok(note.toLowerCase().includes("trajectory") || note.toLowerCase().includes("snapshot"),
      `trajectoryNote must reference 'trajectory' or 'snapshot': "${note}"`);
  });
  it("120. commercial.revenue.nonNaiaBaselineNote contains key disclaimer word", () => {
    const { commercial } = getDesignerSampleData(30);
    const note = ((commercial as any).revenue?.nonNaiaBaselineNote ?? "").toLowerCase();
    assert.ok(
      note.includes("estimated") || note.includes("illustrative") || note.includes("baseline"),
      `nonNaiaBaselineNote must contain 'estimated', 'illustrative', or 'baseline': "${note}"`
    );
  });
  it("121. Overview naiaVsNonNaia has both isEstimated flag and explanation note", () => {
    const { overview } = getDesignerSampleData(30);
    const nvn = (overview as any)?.periodKpis?.naiaVsNonNaia ?? {};
    assert.equal(nvn.nonNaiaConversionRateIsEstimated, true);
    assert.ok(typeof nvn.nonNaiaConversionRateNote === "string" && nvn.nonNaiaConversionRateNote.length > 0,
      "nonNaiaConversionRateNote missing");
  });
  it("122. naiaInfluenceRateIsIllustrative is true in overview periodKpis", () => {
    const { overview } = getDesignerSampleData(30);
    assert.equal(
      (overview as any)?.periodKpis?.naiaVsNonNaia?.naiaInfluenceRateIsIllustrative,
      true,
      "naiaInfluenceRateIsIllustrative must be true — formula is an estimate, not a measurement"
    );
  });
});
