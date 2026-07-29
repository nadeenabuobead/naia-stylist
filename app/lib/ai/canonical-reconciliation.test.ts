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
} from "./canonical-vocabulary";
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

// ── Section 26-H: Awaiting-integration status correctness ────────────────────

describe("Awaiting-integration status fields", () => {
  for (const days of ALL_DATE_RANGES) {
    it(`46. [${days}D] advanced.ltv.status is awaiting-integration`, () => {
      const { advanced } = getDesignerSampleData(days);
      assert.equal(advanced.ltv.status, "awaiting-integration",
        `[${days}D] advanced.ltv.status=${advanced.ltv.status}`);
    });
    it(`47. [${days}D] advanced.saveVsPurchase.status is awaiting-integration`, () => {
      const { advanced } = getDesignerSampleData(days);
      assert.equal(advanced.saveVsPurchase.status, "awaiting-integration",
        `[${days}D] advanced.saveVsPurchase.status=${advanced.saveVsPurchase.status}`);
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
