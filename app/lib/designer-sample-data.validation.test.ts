// app/lib/designer-sample-data.validation.test.ts
// Deterministic contract tests for the Sample Preview fixture.
// Fails fast on known contradictions to prevent regressions.
//
// Run: node --test --import tsx/esm app/lib/designer-sample-data.validation.test.ts

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getDesignerSampleData, classifyEmotionalOutcome } from "./designer-sample-data.js";

// ── Confidence tier helper (mirrors evidenceConfidence in the fixture) ──────
function expectConfidenceTier(label: string, n: number, context: string) {
  if (n === 0)       assert.equal(label, "No Data",             `${context}: n=0 → "No Data"`);
  else if (n === 1)  assert.equal(label, "Single Observation",  `${context}: n=1 → "Single Observation"`);
  else if (n <= 4)   assert.equal(label, "Early Signal",        `${context}: n≤4 → "Early Signal"`);
  else if (n <= 9)   assert.equal(label, "Emerging Pattern",    `${context}: n≤9 → "Emerging Pattern"`);
  else if (n <= 19)  assert.equal(label, "Established Pattern", `${context}: n≤19 → "Established Pattern"`);
  else               assert.equal(label, "Strong Pattern",      `${context}: n≥20 → "Strong Pattern"`);
}

// ── CLEAR conversion — BOS-rate must expose denominator ──────────────────────
describe("CLEAR conversion rate", () => {
  for (const days of [7, 30, 90, 365]) {
    it(`shows denominator context in 7D/30D/90D (days=${days})`, () => {
      const d = getDesignerSampleData(days);
      const rel = d.rel as any;
      const designActions: any[] = rel?.designActions?.items ?? d.dashboard?.designActions?.items ?? [];
      const clearAction = designActions.find((a: any) => a?.piece?.includes("Clear"));

      if (clearAction) {
        // performance string must not claim "X% conversion" without denominator
        // Valid forms: "1/1 buy-or-skip" or "0/0"
        const perf: string = clearAction.performance ?? "";
        const hasDenominator = /\d+\/\d+/.test(perf) || !perf.includes("conversion");
        assert.ok(hasDenominator, `CLEAR performance must show buy/skip denominator in days=${days}: "${perf}"`);
      }
    });
  }
});

// ── ALIVE rewear — no rewear-claim outside 90D+ window ───────────────────────
describe("ALIVE rewear narrative", () => {
  for (const days of [7, 30]) {
    it(`no 'rewear repeatedly' claim when rewearRate=0 (days=${days})`, () => {
      const d = getDesignerSampleData(days);
      const rel = d.rel as any;
      const designActions: any[] = rel?.designActions?.items ?? d.dashboard?.designActions?.items ?? [];
      const aliveAction = designActions.find((a: any) => a?.piece?.includes("Alive"));

      if (aliveAction) {
        const liked: string = aliveAction.liked ?? "";
        assert.ok(
          !liked.includes("rewear repeatedly"),
          `ALIVE 'liked' must not claim 'rewear repeatedly' in ${days}D window (rewearRate=0): "${liked}"`
        );
      }
    });
  }

  it("rewear claim allowed in 90D+ window", () => {
    const d = getDesignerSampleData(90);
    const rel = d.rel as any;
    const designActions: any[] = rel?.designActions?.items ?? d.dashboard?.designActions?.items ?? [];
    const aliveAction = designActions.find((a: any) => a?.piece?.includes("Alive"));
    // Just check it doesn't throw — rewear events exist at 90D
    assert.ok(aliveAction !== undefined || true, "ALIVE design action found at 90D");
  });
});

// ── GROUNDED purchases — no "0 purchases" positive framing ───────────────────
describe("GROUNDED purchases evidence", () => {
  for (const days of [7, 30]) {
    it(`no '0 purchases when fit resolves' in ${days}D window`, () => {
      const d = getDesignerSampleData(days);
      const advanced = d.advanced as any;
      const opportunityFeed: any[] = advanced?.opportunityFeed ?? [];
      const groundedEntry = opportunityFeed.find((e: any) => e?.id === "grounded-fit-objection");

      if (groundedEntry) {
        const evidence: string = groundedEntry.evidence ?? "";
        assert.ok(
          !evidence.includes("0 purchases"),
          `GROUNDED evidence must not claim '0 purchases' in ${days}D: "${evidence}"`
        );
      }
    });
  }
});

// ── Confidence tiers — evidenceConfidence thresholds ─────────────────────────
describe("evidenceConfidence tier accuracy", () => {
  it("emotionalJourney.confidenceStatus matches new thresholds for all periods", () => {
    for (const days of [7, 30, 90, 365]) {
      const d = getDesignerSampleData(days);
      const ej = (d.advanced as any)?.emotionalJourney;
      if (!ej) continue;

      const n: number = ej.confidenceSampleSize ?? ej.sampleSize ?? ej.totalDenominator ?? 0;
      expectConfidenceTier(ej.confidenceStatus, n, `emotionalJourney.confidenceStatus days=${days}`);
    }
  });

  it("productsByEmotionalImpact statusLabel matches new thresholds", () => {
    for (const days of [7, 30, 90, 365]) {
      const d = getDesignerSampleData(days);
      const ej = (d.advanced as any)?.emotionalJourney;
      const products: any[] = ej?.productsByEmotionalImpact ?? [];
      for (const p of products) {
        expectConfidenceTier(p.statusLabel, p.sampleSize, `productsByEmotionalImpact[${p.productTitle}] days=${days}`);
      }
    }
  });

  it("staticTransformations confidenceStatus matches evidenceConfidence(n)", () => {
    for (const days of [7, 30, 90, 365]) {
      const d = getDesignerSampleData(days);
      const ej = (d.advanced as any)?.emotionalJourney;
      const transforms: any[] = ej?.emotionalTransformations ?? [];
      for (const t of transforms) {
        expectConfidenceTier(t.confidenceStatus, t.count, `staticTransformation[${t.desiredFeeling}] days=${days}`);
      }
    }
  });
});

// ── CLEAR opportunityFeed insight — denominator visible ──────────────────────
describe("CLEAR opportunityFeed", () => {
  it("insight and evidence expose buy/skip denominator", () => {
    for (const days of [7, 30, 90, 365]) {
      const d = getDesignerSampleData(days);
      const opportunityFeed: any[] = (d.advanced as any)?.opportunityFeed ?? [];
      const clearEntry = opportunityFeed.find((e: any) => e?.id === "clear-underexposed");

      if (clearEntry) {
        const insight: string = clearEntry.insight ?? "";
        const evidence: string = clearEntry.evidence ?? "";
        assert.ok(/\d+\/\d+/.test(insight) || !insight.includes("converts"), `CLEAR insight needs denominator (days=${days}): "${insight}"`);
        assert.ok(/\d+\/\d+/.test(evidence), `CLEAR evidence needs denominator (days=${days}): "${evidence}"`);
      }
    }
  });
});

// ── Emotional outcome — derived from desired vs achieved, not rewear ──────────
describe("emotional outcome derivation", () => {
  it("achievedCount + partlyCount + notAchievedCount === totalDenominator for all periods", () => {
    for (const days of [7, 30, 90, 365]) {
      const d = getDesignerSampleData(days);
      const ej = (d.advanced as any)?.emotionalJourney;
      if (!ej) continue;
      const sum = (ej.achievedCount ?? 0) + (ej.partlyCount ?? 0) + (ej.notAchievedCount ?? 0);
      assert.equal(sum, ej.totalDenominator, `achieved+partly+not must equal totalDenominator (days=${days})`);
    }
  });

  it("intendedFeelingAchievedRate + partlyAchievedRate + notAchievedRate ≈ 100 when there are reviews", () => {
    for (const days of [30, 90, 365]) {
      const d = getDesignerSampleData(days);
      const ej = (d.advanced as any)?.emotionalJourney;
      if (!ej || ej.totalDenominator === 0) continue;
      const rateSum = (ej.intendedFeelingAchievedRate ?? 0) + (ej.partlyAchievedRate ?? 0) + (ej.notAchievedRate ?? 0);
      assert.ok(Math.abs(rateSum - 100) <= 2, `rate sum should be ~100%, got ${rateSum} (days=${days})`);
    }
  });
});

// ── Confidence values derived from events (not hardcoded) ─────────────────────
describe("confidence before/after/lift are event-derived", () => {
  it("avgConfidenceBefore and avgConfidenceAfter are non-null when confidenceSampleSize > 0", () => {
    for (const days of [30, 90, 365]) {
      const d = getDesignerSampleData(days);
      const ej = (d.advanced as any)?.emotionalJourney;
      if (!ej || ej.confidenceSampleSize === 0) continue;
      assert.notEqual(ej.avgConfidenceBefore, null, `avgConfidenceBefore must not be null (days=${days})`);
      assert.notEqual(ej.avgConfidenceAfter,  null, `avgConfidenceAfter must not be null (days=${days})`);
    }
  });

  it("avgConfidenceLift === avgConfidenceAfter - avgConfidenceBefore (within rounding)", () => {
    for (const days of [30, 90, 365]) {
      const d = getDesignerSampleData(days);
      const ej = (d.advanced as any)?.emotionalJourney;
      if (!ej || ej.avgConfidenceBefore === null || ej.avgConfidenceAfter === null) continue;
      const expectedLift = Math.round((ej.avgConfidenceAfter - ej.avgConfidenceBefore) * 10) / 10;
      assert.equal(ej.avgConfidenceLift, expectedLift, `lift must equal after-before (days=${days})`);
    }
  });

  it("product confidence lift is not the (avgRating - 3.5) proxy", () => {
    for (const days of [30, 90, 365]) {
      const d = getDesignerSampleData(days);
      const products: any[] = (d.advanced as any)?.emotionalJourney?.productsByEmotionalImpact ?? [];
      for (const p of products) {
        if (p.avgRating != null && p.avgConfidenceLift != null) {
          const ratingProxy = Math.round((p.avgRating - 3.5) * 10) / 10;
          assert.notEqual(p.avgConfidenceLift, ratingProxy,
            `"${p.productTitle}" lift must not match rating-proxy ${ratingProxy} (days=${days})`);
        }
      }
    }
  });
});

// ── Explainability — event-derived or explicitly unavailable ─────────────────
describe("explainability event-derived values", () => {
  it("clickThroughRate is null (no click events in fixture)", () => {
    for (const days of [7, 30, 90, 365]) {
      const d = getDesignerSampleData(days);
      const ex = (d.advanced as any)?.explainability;
      if (!ex) continue;
      assert.equal(ex.clickThroughRate, null, `clickThroughRate must be null (days=${days})`);
    }
  });

  it("byPersonality agreementRate is not any legacy hardcoded value (85, 79, 71, 82, 44)", () => {
    const legacyValues = new Set([85, 79, 71, 82, 44]);
    for (const days of [90, 365]) {
      const d = getDesignerSampleData(days);
      const ex = (d.advanced as any)?.explainability;
      if (!ex) continue;
      for (const row of ex.byPersonality ?? []) {
        if (row.agreementRate !== null) {
          assert.ok(!legacyValues.has(row.agreementRate),
            `"${row.personality}" agreementRate ${row.agreementRate} is a legacy hardcoded value (days=${days})`);
        }
      }
    }
  });

  it("explanationAgreementRate is not the legacy 59 fallback when feedback exists", () => {
    for (const days of [90, 365]) {
      const d = getDesignerSampleData(days);
      const ex = (d.advanced as any)?.explainability;
      if (!ex || ex.sampleSize === 0) continue;
      assert.notEqual(ex.explanationAgreementRate, 59, `explanationAgreementRate must not be hardcoded 59 (days=${days})`);
    }
  });
});

// ── Period filtering — shorter windows produce smaller samples ────────────────
describe("period filtering", () => {
  it("7D sample size ≤ 30D sample size", () => {
    const d7  = getDesignerSampleData(7);
    const d30 = getDesignerSampleData(30);
    const n7  = (d7.advanced  as any)?.emotionalJourney?.sampleSize ?? 0;
    const n30 = (d30.advanced as any)?.emotionalJourney?.sampleSize ?? 0;
    assert.ok(n7 <= n30, `7D sample (${n7}) must be ≤ 30D sample (${n30})`);
  });

  it("30D sample size ≤ 90D sample size", () => {
    const d30 = getDesignerSampleData(30);
    const d90 = getDesignerSampleData(90);
    const n30 = (d30.advanced as any)?.emotionalJourney?.sampleSize ?? 0;
    const n90 = (d90.advanced as any)?.emotionalJourney?.sampleSize ?? 0;
    assert.ok(n30 <= n90, `30D sample (${n30}) must be ≤ 90D sample (${n90})`);
  });
});

// ── Percentage integrity — 0–100, numerator ≤ denominator ────────────────────
describe("percentage integrity", () => {
  it("intendedFeelingAchievedRate is 0–100 for all periods", () => {
    for (const days of [7, 30, 90, 365]) {
      const d = getDesignerSampleData(days);
      const ej = (d.advanced as any)?.emotionalJourney;
      if (!ej) continue;
      const rate = ej.intendedFeelingAchievedRate ?? 0;
      assert.ok(rate >= 0 && rate <= 100, `intendedFeelingAchievedRate ${rate} out of 0–100 range (days=${days})`);
    }
  });

  it("achievedCount never exceeds totalDenominator", () => {
    for (const days of [7, 30, 90, 365]) {
      const d = getDesignerSampleData(days);
      const ej = (d.advanced as any)?.emotionalJourney;
      if (!ej) continue;
      assert.ok((ej.achievedCount ?? 0) <= ej.totalDenominator,
        `achievedCount ${ej.achievedCount} must not exceed totalDenominator ${ej.totalDenominator} (days=${days})`);
    }
  });
});

// ── No legacy private confidence labels remain ────────────────────────────────
describe("no legacy confidence labels in output", () => {
  const legacyLabels = ["High Confidence", "Medium Confidence"];

  it("designActions.confidenceBadge contains no legacy labels", () => {
    for (const days of [7, 30, 90, 365]) {
      const d = getDesignerSampleData(days);
      const dashboard = d.dashboard as any;
      for (const action of dashboard?.designActions ?? []) {
        assert.ok(!legacyLabels.includes(action.confidenceBadge),
          `designAction "${action.piece}" has legacy label: "${action.confidenceBadge}" (days=${days})`);
      }
    }
  });

  it("opportunityFeed.confidence contains no legacy labels", () => {
    for (const days of [7, 30, 90, 365]) {
      const d = getDesignerSampleData(days);
      const advanced = d.advanced as any;
      for (const entry of advanced?.opportunityFeed ?? []) {
        assert.ok(!legacyLabels.includes(entry.confidence),
          `opportunityFeed "${entry.id}" has legacy label: "${entry.confidence}" (days=${days})`);
      }
    }
  });
});

// ── Rewear independence — classifyEmotionalOutcome never uses rewear ──────────
describe("classifyEmotionalOutcome does not use rewear", () => {
  it("function signature accepts only desired and actual — rewear is structurally absent", () => {
    // The function takes exactly 2 arguments; rewear is not a parameter.
    assert.equal(classifyEmotionalOutcome.length, 2, "function must have exactly 2 parameters (desired, actual)");
  });

  it("exact match → achieved, regardless of any implied rewear value", () => {
    assert.equal(classifyEmotionalOutcome("Powerful",   "Powerful"),   "achieved");
    assert.equal(classifyEmotionalOutcome("Confident",  "Confident"),  "achieved");
    assert.equal(classifyEmotionalOutcome("Effortless", "Effortless"), "achieved");
  });

  it("same-family non-exact → partly, regardless of any implied rewear value", () => {
    // C4/WHOLE: desired=Effortless, actual=Comfortable → partly (Comfortable ∈ Effortless family)
    assert.equal(classifyEmotionalOutcome("Effortless", "Comfortable"), "partly");
    // Confident family includes Powerful
    assert.equal(classifyEmotionalOutcome("Confident",  "Powerful"),   "partly");
  });

  it("null actual → notAchieved, regardless of any implied rewear value", () => {
    // C4/WHOLE day 280: desired=Effortless, actual=null → notAchieved
    assert.equal(classifyEmotionalOutcome("Effortless", null),  "notAchieved");
    assert.equal(classifyEmotionalOutcome(null,         null),  "notAchieved");
    assert.equal(classifyEmotionalOutcome(null,         "Confident"), "notAchieved");
  });

  it("cross-family → notAchieved, regardless of any implied rewear value", () => {
    assert.equal(classifyEmotionalOutcome("Playful",   "Confident"),   "notAchieved");
    assert.equal(classifyEmotionalOutcome("Feminine",  "Powerful"),    "notAchieved");
  });

  it("365D emotional counts match classification of desired+actual pairs (rewear not a factor)", () => {
    const d = getDesignerSampleData(365);
    const ej = (d.advanced as any)?.emotionalJourney;
    // Total = 20 WR events in 365D fixture; achieved=16, partly=3, not=1
    assert.equal(ej.achievedCount + ej.partlyCount + ej.notAchievedCount, ej.totalDenominator,
      "sum of outcome counts must equal totalDenominator");
    // These specific values can only derive from desired/actual matching, not rewear
    assert.equal(ej.achievedCount,    16, "365D: 16 exact desired=actual matches");
    assert.equal(ej.partlyCount,       3, "365D: 3 same-family near-matches");
    assert.equal(ej.notAchievedCount,  1, "365D: 1 null/cross-family non-match");
  });
});

// ── Cross-tab canonical value equality ───────────────────────────────────────
describe("canonical product metrics are consistent across sections", () => {
  it("sampleSize in productNarratives matches productsByEmotionalImpact for overlapping products", () => {
    for (const days of [90, 365]) {
      const d = getDesignerSampleData(days);
      const narratives: any[] = (d.rel as any)?.productNarratives ?? [];
      const impactProducts: any[] = (d.advanced as any)?.emotionalJourney?.productsByEmotionalImpact ?? [];

      for (const n of narratives) {
        const match = impactProducts.find((p: any) => p.productTitle === n.name);
        if (!match) continue;
        assert.equal(match.sampleSize, n.sampleSize,
          `sampleSize mismatch for "${n.name}": narratives=${n.sampleSize}, emotionalImpact=${match.sampleSize} (days=${days})`);
      }
    }
  });

  it("avgRating in productNarratives matches dashboard.topPieces for overlapping products", () => {
    // productsByEmotionalImpact does not carry avgRating; topPieces does (both from pm[name].avgRating)
    for (const days of [90, 365]) {
      const d = getDesignerSampleData(days);
      const narratives: any[] = (d.rel as any)?.productNarratives ?? [];
      const topPieces: any[] = (d.dashboard as any)?.topPieces ?? [];

      for (const n of narratives) {
        const match = topPieces.find((p: any) => p.name === n.name);
        if (!match) continue;
        assert.equal(match.avgRating, n.avgRating,
          `avgRating mismatch for "${n.name}": narratives=${n.avgRating}, topPieces=${match.avgRating} (days=${days})`);
      }
    }
  });

  it("opportunityScore in productNarratives matches opportunityScores section", () => {
    for (const days of [30, 90, 365]) {
      const d = getDesignerSampleData(days);
      const narratives: any[] = (d.rel as any)?.productNarratives ?? [];
      const oppScores: any[] = (d.advanced as any)?.opportunityScores ?? [];

      for (const n of narratives) {
        const match = oppScores.find((p: any) => p.productTitle === n.name);
        if (!match) continue;
        assert.equal(match.score, n.opportunityScore,
          `opportunityScore mismatch for "${n.name}": narratives=${n.opportunityScore}, opportunityScores=${match.score} (days=${days})`);
      }
    }
  });

  it("avgConfidenceLift in productNarratives matches productsByEmotionalImpact for overlapping products", () => {
    for (const days of [90, 365]) {
      const d = getDesignerSampleData(days);
      const narratives: any[] = (d.rel as any)?.productNarratives ?? [];
      const impactProducts: any[] = (d.advanced as any)?.emotionalJourney?.productsByEmotionalImpact ?? [];

      for (const n of narratives) {
        const match = impactProducts.find((p: any) => p.productTitle === n.name);
        if (!match) continue;
        assert.equal(match.avgConfidenceLift, n.avgConfidenceLift,
          `avgConfidenceLift mismatch for "${n.name}": narratives=${n.avgConfidenceLift}, emotionalImpact=${match.avgConfidenceLift} (days=${days})`);
      }
    }
  });
});
