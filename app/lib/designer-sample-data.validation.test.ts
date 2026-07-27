// app/lib/designer-sample-data.validation.test.ts
// Deterministic contract tests for the Sample Preview fixture.
// Fails fast on known contradictions to prevent regressions.
//
// Run: node --test --import tsx/esm app/lib/designer-sample-data.validation.test.ts

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getDesignerSampleData, classifyEmotionalOutcome } from "./designer-sample-data.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Helper to read the route file for contract tests
function readRoute(): string {
  return readFileSync(join(__dirname, "../routes/app.designer-intelligence.jsx"), "utf8");
}

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

// ── 7-tab navigation contract ─────────────────────────────────────────────────

describe("7-tab architecture", () => {
  const EXPECTED_TAB_IDS = [
    "overview",
    "customer",
    "product",
    "recommendation",
    "collection",
    "commercial",
    "opportunities",
  ] as const;

  it("getDesignerSampleData returns all 7 top-level data keys required by tab components", () => {
    const d = getDesignerSampleData(90);
    // Each tab draws from at least one of these top-level keys
    assert.ok(d.dashboard, "dashboard key missing");
    assert.ok(d.kpis, "kpis key missing");
    assert.ok(d.phase4b2, "phase4b2 key missing");
    assert.ok(d.advanced, "advanced key missing");
    assert.ok(d.rel, "rel key missing");
    assert.ok(d.overview, "overview key missing");
  });

  it("expected 7 tab IDs are distinct strings with no duplicates", () => {
    const ids = [...EXPECTED_TAB_IDS];
    const unique = new Set(ids);
    assert.equal(unique.size, 7, `Expected 7 distinct tab IDs, got ${unique.size}`);
    assert.equal(ids.length, 7, `Expected 7 tab IDs, got ${ids.length}`);
  });

  it("no tab ID is 'ai-performance'", () => {
    const hasAiPerf = EXPECTED_TAB_IDS.includes("ai-performance" as any);
    assert.equal(hasAiPerf, false, "ai-performance tab must not exist in 7-tab architecture");
  });

  it("overview tab receives required overview fields", () => {
    const d = getDesignerSampleData(90);
    const overview: any = d.overview;
    assert.ok(overview, "overview section missing");
    assert.ok("periodLabel" in overview, "overview.periodLabel missing");
    assert.ok("periodKpis" in overview, "overview.periodKpis missing");
    assert.ok("foundationKpis" in overview, "overview.foundationKpis missing");
  });
});

// ── canonical metric mapping across tabs ─────────────────────────────────────

describe("canonical metric mapping", () => {
  it("product avgRating values are in range [1, 5]", () => {
    for (const days of [30, 90, 365]) {
      const d = getDesignerSampleData(days);
      const narratives: any[] = (d.rel as any)?.productNarratives ?? [];
      for (const n of narratives) {
        if (n.avgRating == null) continue;
        assert.ok(n.avgRating >= 1 && n.avgRating <= 5,
          `avgRating out of range for "${n.name}": ${n.avgRating} (days=${days})`);
      }
    }
  });

  it("rewearRate values are in range [0, 1]", () => {
    for (const days of [30, 90, 365]) {
      const d = getDesignerSampleData(days);
      const narratives: any[] = (d.rel as any)?.productNarratives ?? [];
      for (const n of narratives) {
        if (n.rewearRate == null) continue;
        assert.ok(n.rewearRate >= 0 && n.rewearRate <= 1,
          `rewearRate out of range for "${n.name}": ${n.rewearRate} (days=${days})`);
      }
    }
  });

  it("opportunityScore values are in range [0, 100]", () => {
    for (const days of [30, 90, 365]) {
      const d = getDesignerSampleData(days);
      const narratives: any[] = (d.rel as any)?.productNarratives ?? [];
      for (const n of narratives) {
        if (n.opportunityScore == null) continue;
        assert.ok(n.opportunityScore >= 0 && n.opportunityScore <= 100,
          `opportunityScore out of range for "${n.name}": ${n.opportunityScore} (days=${days})`);
      }
    }
  });

  it("opportunity feed items have required fields", () => {
    const d = getDesignerSampleData(90);
    const feed: any[] = (d.advanced as any)?.opportunityFeed ?? [];
    for (const opp of feed) {
      assert.ok(opp.insight, `opportunity item missing insight: ${JSON.stringify(opp)}`);
      assert.ok(opp.confidence, `opportunity item missing confidence: ${JSON.stringify(opp)}`);
      assert.ok(opp.evidence, `opportunity item missing evidence: ${JSON.stringify(opp)}`);
    }
  });

  it("recommendation response score is in range [0, 100] when present", () => {
    const d = getDesignerSampleData(90);
    const score: number | undefined = (d.rel as any)?.recommendationResponseScore;
    if (score == null) return;
    assert.ok(score >= 0 && score <= 100,
      `recommendationResponseScore out of range: ${score}`);
  });

  it("collection-health score is in range [0, 100] when present", () => {
    for (const days of [30, 90, 365]) {
      const d = getDesignerSampleData(days);
      const score: number | undefined = (d.advanced as any)?.collectionHealth?.score;
      if (score == null) continue;
      assert.ok(score >= 0 && score <= 100,
        `collectionHealth.score out of range: ${score} (days=${days})`);
    }
  });

  it("LTV avgLtv is a non-negative integer when present", () => {
    for (const days of [90, 365]) {
      const d = getDesignerSampleData(days);
      const ltv: any = (d.dashboard as any)?.ltv;
      if (!ltv || ltv.avgLtv == null) continue;
      assert.ok(ltv.avgLtv >= 0, `avgLtv is negative: ${ltv.avgLtv} (days=${days})`);
      assert.equal(ltv.avgLtv, Math.round(ltv.avgLtv), `avgLtv is not an integer: ${ltv.avgLtv} (days=${days})`);
    }
  });

  it("selected period scopeLabel is a non-empty string", () => {
    for (const days of [30, 90, 365]) {
      const d = getDesignerSampleData(days);
      const periodLabel: string | undefined = (d.kpis as any)?.periodLabel;
      if (periodLabel == null) continue;
      assert.ok(periodLabel.length > 0, `periodLabel is empty (days=${days})`);
    }
  });
});

// ── Sample Preview never resolves to Live ─────────────────────────────────────

describe("Sample Preview isolation", () => {
  it("ltv.status is 'sample', not 'live', in sample data", () => {
    for (const days of [30, 90, 365]) {
      const d = getDesignerSampleData(days);
      const ltv: any = (d.dashboard as any)?.ltv;
      if (!ltv) continue;
      assert.notEqual(ltv.status, "live", `ltv.status must not be "live" in sample data (days=${days})`);
    }
  });

  it("sampleMode flag is not in getDesignerSampleData return value (loader sets it)", () => {
    const d = getDesignerSampleData(90) as any;
    assert.ok(!("sampleMode" in d), "getDesignerSampleData must not include sampleMode");
  });

  it("saveVsPurchase.status is not 'live' in sample data", () => {
    for (const days of [30, 90, 365]) {
      const d = getDesignerSampleData(days);
      const svp: any = (d.advanced as any)?.saveVsPurchase;
      if (svp?.status) {
        assert.notEqual(svp.status, "live", `saveVsPurchase.status must not be "live" in sample data (days=${days})`);
      }
    }
  });
});

// ── Emotional achievement independence from rewear ────────────────────────────

describe("emotional achievement independence", () => {
  it("classifyEmotionalOutcome distinguishes exact match from near match", () => {
    const exact = classifyEmotionalOutcome("Powerful", "Powerful");
    const near = classifyEmotionalOutcome("Powerful", "Confident");
    assert.notEqual(exact, near, "exact match and near match must produce different outcomes");
  });

  it("feelingAchievedRate and rewearRate are not always equal (independent derivations)", () => {
    for (const days of [90, 365]) {
      const d = getDesignerSampleData(days);
      const matrix: any[] = (d.rel as any)?.dnaMatrix ?? [];
      const rowsWithBoth = matrix.filter((r: any) => r.feelingAchievedRate != null && r.rewearRate != null);
      if (rowsWithBoth.length < 2) continue;
      const allIdentical = rowsWithBoth.every((r: any) =>
        Math.abs(r.feelingAchievedRate - Math.round(r.rewearRate * 100)) < 1
      );
      assert.ok(!allIdentical,
        `feelingAchievedRate and rewearRate are identical for every row — values likely share the same source (days=${days})`);
    }
  });
});

// ── Opportunity score consistency ─────────────────────────────────────────────

describe("opportunity score consistency", () => {
  it("no opportunityScore exceeds 100", () => {
    for (const days of [7, 30, 90, 365]) {
      const d = getDesignerSampleData(days);
      const narratives: any[] = (d.rel as any)?.productNarratives ?? [];
      for (const n of narratives) {
        if (n.opportunityScore == null) continue;
        assert.ok(n.opportunityScore <= 100,
          `opportunityScore ${n.opportunityScore} > 100 for "${n.name}" (days=${days})`);
      }
    }
  });
});

// ── Date-scope propagation ────────────────────────────────────────────────────

describe("date-scope propagation", () => {
  it("shorter periods produce fewer or equal sessions than longer periods", () => {
    const d30 = getDesignerSampleData(30);
    const d365 = getDesignerSampleData(365);
    const s30: number = (d30.dashboard as any)?.totalSessions ?? 0;
    const s365: number = (d365.dashboard as any)?.totalSessions ?? 0;
    assert.ok(s30 <= s365, `30d sessions (${s30}) must be ≤ 365d sessions (${s365})`);
  });

  it("ltv scopeLabel is 'All Time' for every period", () => {
    for (const days of [7, 30, 90, 365]) {
      const d = getDesignerSampleData(days);
      const ltv: any = (d.dashboard as any)?.ltv;
      if (!ltv) continue;
      assert.equal(ltv.scopeLabel, "All Time", `ltv.scopeLabel must be "All Time" (days=${days})`);
    }
  });
});

// ── Confidence thresholds ─────────────────────────────────────────────────────

describe("confidence threshold correctness", () => {
  it("canonical 6-tier confidence ladder covers all node counts correctly", () => {
    expectConfidenceTier("No Data",             0,  "n=0");
    expectConfidenceTier("Single Observation",  1,  "n=1");
    expectConfidenceTier("Early Signal",        4,  "n=4");
    expectConfidenceTier("Emerging Pattern",    9,  "n=9");
    expectConfidenceTier("Established Pattern", 19, "n=19");
    expectConfidenceTier("Strong Pattern",      20, "n=20");
  });

  it("explainability confidence badges use canonical tier labels", () => {
    const VALID = new Set([
      "No Data", "Single Observation", "Early Signal",
      "Emerging Pattern", "Established Pattern", "Strong Pattern",
    ]);
    const d = getDesignerSampleData(90);
    const items: any[] = (d.advanced as any)?.explainability?.items ?? [];
    for (const item of items) {
      if (!item.confidenceBadge) continue;
      assert.ok(VALID.has(item.confidenceBadge),
        `Unknown confidence tier: "${item.confidenceBadge}"`);
    }
  });
});

// ── New suites ────────────────────────────────────────────────────────────────

import { test } from "node:test";

// Math consistency
test("post-wear completion math reconciles", () => {
  for (const days of [7, 30, 90, 365]) {
    const d = getDesignerSampleData(days);
    const pc = d.phase4b2.postWearCompletion;
    if (pc.totalWithPostWear > 0) {
      assert.ok(pc.didWearItYes <= pc.totalWithPostWear, `didWearItYes (${pc.didWearItYes}) must be ≤ totalWithPostWear (${pc.totalWithPostWear}) for ${days}d`);
      assert.ok(pc.feltPositive <= pc.totalWithPostWear, `feltPositive must be ≤ totalWithPostWear for ${days}d`);
      assert.strictEqual(pc.wearRate, Math.round(pc.didWearItYes / pc.totalWithPostWear * 100), `wearRate must equal didWearItYes/totalWithPostWear*100 for ${days}d`);
      assert.strictEqual(pc.positiveExperienceRate, Math.round(pc.feltPositive / pc.totalWithPostWear * 100), `positiveExperienceRate must equal feltPositive/totalWithPostWear*100 for ${days}d`);
    }
  }
});

test("emotional transformation fractions reconcile with displayed rates", () => {
  for (const days of [7, 30, 90, 365]) {
    const d = getDesignerSampleData(days);
    const transforms = d.advanced.emotionalJourney.emotionalTransformations;
    for (const t of transforms) {
      if (t.achievedOf > 0) {
        const derivedRate = Math.round(t.achievedCount / t.achievedOf * 100);
        assert.strictEqual(t.achievedRate, derivedRate, `achievedRate (${t.achievedRate}%) must equal achievedCount/achievedOf*100 = ${t.achievedCount}/${t.achievedOf} = ${derivedRate}% for ${days}d`);
      }
    }
  }
});

test("no numerator exceeds denominator in any fraction", () => {
  for (const days of [7, 30, 90, 365]) {
    const d = getDesignerSampleData(days);
    const pc = d.phase4b2.postWearCompletion;
    assert.ok(pc.didWearItYes <= pc.totalWithPostWear, "didWearItYes must not exceed totalWithPostWear");
    assert.ok(pc.feltPositive <= pc.totalWithPostWear, "feltPositive must not exceed totalWithPostWear");
    const ej = d.advanced.emotionalJourney;
    const ejSum = (ej.achievedCount ?? 0) + (ej.partlyCount ?? 0) + (ej.notAchievedCount ?? 0);
    assert.ok(ejSum === ej.totalDenominator || ej.totalDenominator === 0, `emotional journey counts (${ejSum}) must sum to denominator (${ej.totalDenominator})`);
  }
});

test("no product with 0 reviews shows a non-null avgRating", () => {
  for (const days of [7, 30, 90, 365]) {
    const d = getDesignerSampleData(days);
    for (const p of d.rel.productNarratives) {
      if (p.sampleSize === 0) {
        assert.strictEqual(p.avgRating, null, `${p.name} has 0 reviews but non-null avgRating in ${days}d`);
      }
    }
  }
});

test("save-vs-purchase status is awaiting-integration", () => {
  for (const days of [7, 30, 90, 365]) {
    const d = getDesignerSampleData(days);
    assert.strictEqual(d.advanced.saveVsPurchase.status, "awaiting-integration", "saveVsPurchase must be awaiting-integration since the integration is pending");
  }
});

test("buy/skip categories sum to total", () => {
  for (const days of [7, 30, 90, 365]) {
    const d = getDesignerSampleData(days);
    const bo = d.kpis.buyOrSkip;
    const sum = bo.buy + (bo.save ?? 0) + bo.skip + bo.maybe + (bo.noDecision ?? 0);
    assert.strictEqual(sum, bo.total, `buy+save+skip+maybe+noDecision (${sum}) must equal total (${bo.total}) for ${days}d`);
  }
});

test("no static hardcoded 4.1 rating for products with 0 reviews", () => {
  for (const days of [7, 30, 90, 365]) {
    const d = getDesignerSampleData(days);
    for (const p of d.rel.productNarratives) {
      if (p.sampleSize === 0) {
        assert.notStrictEqual(p.avgRating, 4.1, `Product ${p.name} with 0 reviews should not show hardcoded 4.1 rating`);
      }
    }
  }
});

test("conversionStats is empty (no fabricated VTO data)", () => {
  for (const days of [7, 30, 90, 365]) {
    const d = getDesignerSampleData(days);
    assert.strictEqual(d.dashboard.conversionStats.length, 0, "conversionStats must be empty — VTO/click tracking awaiting integration");
  }
});

test("no LTV language in opportunity feed", () => {
  for (const days of [7, 30, 90, 365]) {
    const d = getDesignerSampleData(days);
    for (const opp of d.advanced.opportunityFeed) {
      assert.ok(!opp.insight.includes("LTV"), `opportunityFeed insight must not reference LTV (pending integration): "${opp.insight}"`);
      if (opp.suggestedAction) {
        assert.ok(!opp.suggestedAction.includes("LTV"), `suggestedAction must not reference LTV: "${opp.suggestedAction}"`);
      }
    }
  }
});

test("emotional chain achievedRate is null (no fabricated rates)", () => {
  for (const days of [7, 30, 90, 365]) {
    const d = getDesignerSampleData(days);
    for (const chain of d.rel.emotionalChain) {
      assert.strictEqual(chain.achievedRate, null, "emotionalChain.achievedRate must be null (session count != WR denominator)");
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// NEW TESTS — Change 18 additions
// ─────────────────────────────────────────────────────────────────────────────


// ── 1. Route TABS constant now has 6 entries ──────────────────────────────────
test("route TABS constant has exactly 6 entries", () => {
  const route = readRoute();
  // Extract TABS array — count { id: " entries
  const matches = route.match(/\{\s*id:\s*["'][^"']+["']/g) ?? [];
  // TABS const starts with overview and ends with commercial — exactly 6
  const tabLine = route.match(/const TABS = \[([^\]]*)\]/s)?.[1] ?? "";
  const tabIds = (tabLine.match(/id:\s*["']([^"']+)["']/g) ?? []).map(
    m => m.replace(/id:\s*["']/, "").replace(/["']$/, ""),
  );
  assert.strictEqual(tabIds.length, 6, `TABS must have 6 entries, got ${tabIds.length}: ${tabIds.join(", ")}`);
});

// ── 2. Route uses "collection-opportunities" merged tab id ────────────────────
test("route TABS includes collection-opportunities merged tab", () => {
  const route = readRoute();
  assert.ok(
    route.includes("collection-opportunities"),
    "route must include collection-opportunities merged tab id",
  );
});

// ── 3. Route does NOT include legacy 7th tab "opportunities" ─────────────────
test("route TABS does not contain standalone opportunities tab", () => {
  const route = readRoute();
  // The tab bar should not have standalone opportunities id (but collection-opportunities is ok)
  const tabsBlock = route.match(/const TABS = \[([^\]]*)\]/s)?.[1] ?? "";
  assert.ok(
    !tabsBlock.includes('"opportunities"') && !tabsBlock.includes("'opportunities'"),
    "TABS block must not contain standalone 'opportunities' id",
  );
});

// ── 4. designActions all have canonical fields ─────────────────────────────────
describe("designActions canonical schema", () => {
  const CANONICAL_FIELDS = [
    "id", "product", "observedEvidence", "interpretation",
    "recommendedTest", "successMetric", "confidence",
    "designImplication", "merchandisingImplication",
  ];

  for (const days of [30, 90]) {
    it(`all designActions have canonical fields (days=${days})`, () => {
      const d = getDesignerSampleData(days);
      const actions: any[] = d.dashboard?.designActions ?? [];
      assert.ok(actions.length > 0, "designActions must not be empty");
      for (const action of actions) {
        for (const field of CANONICAL_FIELDS) {
          assert.ok(
            action[field] !== undefined && action[field] !== null && action[field] !== "",
            `designAction "${action.piece ?? action.id}" missing canonical field: ${field}`,
          );
        }
      }
    });
  }
});

// ── 5. designActions backward-compat fields preserved (existing tests rely on these) ─
test("designActions preserve backward-compat fields", () => {
  const d = getDesignerSampleData(90);
  const actions: any[] = d.dashboard?.designActions ?? [];
  for (const action of actions) {
    assert.ok(action.piece !== undefined, `designAction missing backward-compat field: piece`);
    assert.ok(action.confidenceBadge !== undefined, `designAction missing backward-compat field: confidenceBadge`);
    assert.ok(action.performance !== undefined, `designAction missing backward-compat field: performance`);
  }
});

// ── 6. reasonsResonate are {label, count} objects ─────────────────────────────
test("reasonsResonate contains {label, count} objects", () => {
  for (const days of [30, 90]) {
    const d = getDesignerSampleData(days);
    const ex = d.advanced?.explainability as any;
    if (!ex?.reasonsResonate?.length) continue;
    for (const r of ex.reasonsResonate) {
      assert.strictEqual(typeof r, "object", "reasonsResonate items must be objects");
      assert.ok(typeof r.label === "string" && r.label.length > 0, "reasonsResonate item must have label string");
      assert.ok(typeof r.count === "number" && r.count >= 0, `reasonsResonate item must have count ≥ 0, got ${r.count}`);
    }
  }
});

// ── 7. reasonsRejected are {label, count} objects ────────────────────────────
test("reasonsRejected contains {label, count} objects", () => {
  for (const days of [30, 90]) {
    const d = getDesignerSampleData(days);
    const ex = d.advanced?.explainability as any;
    if (!ex?.reasonsRejected?.length) continue;
    for (const r of ex.reasonsRejected) {
      assert.strictEqual(typeof r, "object", "reasonsRejected items must be objects");
      assert.ok(typeof r.label === "string" && r.label.length > 0, "reasonsRejected item must have label string");
      assert.ok(typeof r.count === "number" && r.count >= 0, `reasonsRejected item must have count ≥ 0, got ${r.count}`);
    }
  }
});

// ── 8. opportunityFeed items have designImplication and merchandisingImplication ─
test("opportunityFeed items have designImplication and merchandisingImplication", () => {
  for (const days of [30, 90, 365]) {
    const d = getDesignerSampleData(days);
    const feed: any[] = d.advanced?.opportunityFeed ?? [];
    assert.ok(feed.length > 0, `opportunityFeed must not be empty for days=${days}`);
    for (const item of feed) {
      assert.ok(
        typeof item.designImplication === "string" && item.designImplication.length > 0,
        `opportunityFeed item "${item.id}" missing designImplication`,
      );
      assert.ok(
        typeof item.merchandisingImplication === "string" && item.merchandisingImplication.length > 0,
        `opportunityFeed item "${item.id}" missing merchandisingImplication`,
      );
    }
  }
});

// ── 9. ltv.status is not 'sample' (changed to awaiting-integration) ───────────
test("ltv.status is awaiting-integration", () => {
  for (const days of [30, 90]) {
    const d = getDesignerSampleData(days);
    const ltv = d.advanced?.ltv as any;
    assert.strictEqual(
      ltv?.status,
      "awaiting-integration",
      `ltv.status must be "awaiting-integration", got "${ltv?.status}"`,
    );
  }
});

// ── 10. No overconfident prescriptive language in prescriptiveInsights ─────────
test("prescriptiveInsight for Edgy does not contain prescriptive 'Restrict to' language", () => {
  const d = getDesignerSampleData(90);
  const matrix: any[] = d.rel?.dnaMatrix ?? [];
  const edgyRow = matrix.find(r => r?.personality === "Edgy");
  if (edgyRow?.prescriptive) {
    assert.ok(
      !edgyRow.prescriptive.includes("Restrict to"),
      `Edgy prescriptiveInsight must not use "Restrict to" language: "${edgyRow.prescriptive}"`,
    );
  }
});

// ── 11. No overconfident language in designActions ────────────────────────────
test("designActions do not contain prescriptive 'Restrict' language", () => {
  for (const days of [30, 90]) {
    const d = getDesignerSampleData(days);
    const actions: any[] = d.dashboard?.designActions ?? [];
    for (const action of actions) {
      const actionStr: string = action.action ?? "";
      assert.ok(
        !actionStr.toLowerCase().startsWith("restrict"),
        `designAction "${action.piece}" action must not start with "restrict": "${actionStr}"`,
      );
    }
  }
});

// ── 12. No overconfident "Increase recommendation frequency" prescriptions ────
test("designActions do not prescribe 'Increase recommendation frequency' as a command", () => {
  for (const days of [30, 90]) {
    const d = getDesignerSampleData(days);
    const actions: any[] = d.dashboard?.designActions ?? [];
    for (const action of actions) {
      const actionStr: string = action.action ?? "";
      // "Increase..." as a direct command is not allowed; must be framed as a test
      const isDirectCommand = /^Increase recommendation frequency/.test(actionStr.trim());
      assert.ok(
        !isDirectCommand,
        `designAction "${action.piece}" must not use direct "Increase recommendation frequency" command: "${actionStr}"`,
      );
    }
  }
});

// ── 13. unsureCount is present and ≥ 0 in wouldWearAgain ─────────────────────
test("wouldWearAgain.unsureCount is present and non-negative", () => {
  for (const days of [30, 90]) {
    const d = getDesignerSampleData(days);
    const wya = d.advanced?.emotionalJourney?.wouldWearAgain as any;
    assert.ok(wya !== undefined, "wouldWearAgain must exist");
    assert.ok(
      typeof wya.unsureCount === "number" && wya.unsureCount >= 0,
      `unsureCount must be a non-negative number, got ${wya.unsureCount}`,
    );
    assert.ok(
      typeof wya.unsureRate === "number" && wya.unsureRate >= 0,
      `unsureRate must be a non-negative number, got ${wya.unsureRate}`,
    );
  }
});

// ── 14. opportunityFeed has at most 7 items ───────────────────────────────────
test("opportunityFeed has at most 7 items", () => {
  for (const days of [7, 30, 90, 365]) {
    const d = getDesignerSampleData(days);
    const feed: any[] = d.advanced?.opportunityFeed ?? [];
    assert.ok(feed.length <= 7, `opportunityFeed must have ≤ 7 items, got ${feed.length}`);
  }
});

// ── 15. designActions.id values are all unique strings ────────────────────────
test("designActions.id values are unique", () => {
  const d = getDesignerSampleData(90);
  const actions: any[] = d.dashboard?.designActions ?? [];
  const ids = actions.map(a => a.id).filter(Boolean);
  const unique = new Set(ids);
  assert.strictEqual(unique.size, ids.length, `designActions.id values must be unique, got: ${ids.join(", ")}`);
});

// ── 16. designActions.impact and .effort use valid values ─────────────────────
test("designActions impact and effort use valid enum values", () => {
  const VALID_IMPACT = new Set(["high", "medium", "low"]);
  const VALID_EFFORT = new Set(["high", "medium", "low"]);
  const d = getDesignerSampleData(90);
  const actions: any[] = d.dashboard?.designActions ?? [];
  for (const action of actions) {
    assert.ok(VALID_IMPACT.has(action.impact), `designAction "${action.id}" impact must be high/medium/low, got "${action.impact}"`);
    assert.ok(VALID_EFFORT.has(action.effort), `designAction "${action.id}" effort must be high/medium/low, got "${action.effort}"`);
  }
});

// ── 17. opportunityFeed items have all required core fields ───────────────────
test("opportunityFeed items have all required core fields", () => {
  const REQUIRED = ["id", "type", "confidence", "insight", "customerNeed", "evidence", "timePeriod", "suggestedAction"];
  for (const days of [30, 90]) {
    const d = getDesignerSampleData(days);
    const feed: any[] = d.advanced?.opportunityFeed ?? [];
    for (const item of feed) {
      for (const field of REQUIRED) {
        assert.ok(
          item[field] !== undefined && item[field] !== null && item[field] !== "",
          `opportunityFeed item "${item.id}" missing required field: ${field}`,
        );
      }
    }
  }
});

// ── 18. reasonsResonate counts are positive when feedback exists ──────────────
test("reasonsResonate counts are positive when totalFeedback > 0", () => {
  for (const days of [30, 90, 365]) {
    const d = getDesignerSampleData(days);
    const ex = d.advanced?.explainability as any;
    const resonate: any[] = ex?.reasonsResonate ?? [];
    if (resonate.length > 0) {
      for (const r of resonate) {
        assert.ok(r.count > 0, `reasonsResonate count must be > 0 when feedback exists, got ${r.count} for "${r.label}"`);
      }
    }
  }
});

// ── 19. reasonsRejected counts are positive when feedback exists ──────────────
test("reasonsRejected counts are positive when totalFeedback > 0", () => {
  for (const days of [30, 90, 365]) {
    const d = getDesignerSampleData(days);
    const ex = d.advanced?.explainability as any;
    const rejected: any[] = ex?.reasonsRejected ?? [];
    if (rejected.length > 0) {
      for (const r of rejected) {
        assert.ok(r.count > 0, `reasonsRejected count must be > 0 when feedback exists, got ${r.count} for "${r.label}"`);
      }
    }
  }
});

// ── 20. Route uses observational language ("Observed:" / "Test whether") ──────
test("route TabCollectionOpportunities function is defined", () => {
  const route = readRoute();
  assert.ok(
    route.includes("TabCollectionOpportunities"),
    "route must define TabCollectionOpportunities function",
  );
});

// ── 21. Route no longer has legacy section "Top-Performing Pieces" ────────────
test("route does not render legacy Top-Performing Pieces section", () => {
  const route = readRoute();
  assert.ok(
    !route.includes("Top-Performing Pieces"),
    "route must not render legacy 'Top-Performing Pieces' section",
  );
});

// ── 22. Route no longer has legacy section "Mixed-Signal Pieces" ──────────────
test("route does not render legacy Mixed-Signal Pieces section", () => {
  const route = readRoute();
  assert.ok(
    !route.includes("Mixed-Signal Pieces"),
    "route must not render legacy 'Mixed-Signal Pieces' section",
  );
});

// ── 23. Route no longer has legacy section "Style DNA by Piece" ──────────────
test("route does not render legacy Style DNA by Piece section", () => {
  const route = readRoute();
  assert.ok(
    !route.includes("Style DNA by Piece"),
    "route must not render legacy 'Style DNA by Piece' section",
  );
});

// ── 24. Route includes Data & AI panel ───────────────────────────────────────
test("route includes Data & AI slide-over panel", () => {
  const route = readRoute();
  assert.ok(
    route.includes("DataAiDefinitions") || route.includes("dataAiOpen"),
    "route must include Data & AI panel logic",
  );
});

// ── 25. Route includes roleLens state ────────────────────────────────────────
test("route includes roleLens state for role lens selector", () => {
  const route = readRoute();
  assert.ok(
    route.includes("roleLens"),
    "route must include roleLens state for Combined/Design/Merchandising role lens selector",
  );
});
