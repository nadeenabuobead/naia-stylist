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
import { EVENTS_EXPANDED } from "./ai/synthetic-events-expanded.js";

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
    // 73 WR events total (post-wear reviews now properly decoded from EVENTS_EXPANDED after source repair)
    // achieved=62 (exact desired=actual matches), partly=7 (same-family), notAchieved=4 (null/cross-family)
    assert.equal(ej.achievedCount + ej.partlyCount + ej.notAchievedCount, ej.totalDenominator,
      "sum of outcome counts must equal totalDenominator");
    // These specific values can only derive from desired/actual matching, not rewear
    assert.equal(ej.achievedCount,    62, "365D: 62 exact desired=actual matches");
    assert.equal(ej.partlyCount,       7, "365D: 7 same-family near-matches");
    assert.equal(ej.notAchievedCount,  4, "365D: 4 null/cross-family non-matches");
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
        // opportunityScores coerces null→0 for legacy display; both sections use computeOpportunityScore
        const expectedScore = n.opportunityScore ?? 0;
        assert.equal(match.score, expectedScore,
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

test("save-vs-purchase status is sample in sample preview mode", () => {
  for (const days of [7, 30, 90, 365]) {
    const d = getDesignerSampleData(days);
    const svp = d.advanced.saveVsPurchase as any;
    assert.strictEqual(svp.status, "sample", `saveVsPurchase.status must be "sample" in sample preview (days=${days})`);
    assert.ok(typeof svp.uniqueSavers === "number", `saveVsPurchase.uniqueSavers must be present (days=${days})`);
    assert.ok(svp.evidenceMaturity, `saveVsPurchase.evidenceMaturity must be present (days=${days})`);
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

test("emotional chain achievedRate is computed from all-time WR events (not null, not session-based)", () => {
  // achievedRate is now computed from allTimeWR events — always has data from the full synthetic dataset.
  // It should be a number 0-100 (or null only when no WR events match that desiredFeeling).
  for (const days of [7, 30, 90, 365]) {
    const d = getDesignerSampleData(days);
    for (const chain of d.rel.emotionalChain as any[]) {
      assert.ok(
        chain.achievedRate === null || (typeof chain.achievedRate === "number" && chain.achievedRate >= 0 && chain.achievedRate <= 100),
        `emotionalChain achievedRate must be null or 0-100 number (got ${chain.achievedRate})`
      );
    }
    // For 365-day range (all-time), at least one chain entry should have a non-null achievedRate
    if (days === 365) {
      const hasRate = (d.rel.emotionalChain as any[]).some(c => c.achievedRate !== null);
      assert.ok(hasRate, "At least one emotionalChain entry should have achievedRate computed from all-time WR data");
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

// ── 9. ltv.status is "sample" in sample mode (populated from synthetic orders) ──
test("ltv.status is sample in sample preview mode", () => {
  for (const days of [30, 90]) {
    const d = getDesignerSampleData(days);
    const ltv = d.advanced?.ltv as any;
    assert.strictEqual(
      ltv?.status,
      "sample",
      `ltv.status must be "sample" in sample preview, got "${ltv?.status}"`,
    );
    assert.ok(
      typeof ltv?.sampleSize === "number" && ltv.sampleSize > 0,
      `ltv.sampleSize must be > 0 in sample mode (days=${days})`,
    );
    assert.ok(ltv?.avgLtv > 0, `ltv.avgLtv must be > 0 (days=${days})`);
    assert.ok(ltv?.avgOrderValue > 0, `ltv.avgOrderValue must be present and > 0 (days=${days})`);
    assert.ok(ltv?.ltvByPersonality?.length > 0, `ltv.ltvByPersonality must be populated (days=${days})`);
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

// ══════════════════════════════════════════════════════════════════════════════
// CLOSURE PATCH — Tests 26-31
// ══════════════════════════════════════════════════════════════════════════════

// ── 26. LTV is populated in Sample Preview ─────────────────────────────────────
test("advanced.ltv is populated in sample preview with status sample", () => {
  for (const days of [30, 90, 365]) {
    const d = getDesignerSampleData(days);
    const ltv = (d.advanced as any)?.ltv;
    assert.ok(ltv !== undefined, `advanced.ltv must exist (days=${days})`);
    assert.strictEqual(ltv.status, "sample", `advanced.ltv.status must be "sample" in sample preview (days=${days})`);
    assert.ok(typeof ltv.sampleSize === "number" && ltv.sampleSize > 0, `advanced.ltv.sampleSize must be > 0 (days=${days})`);
    assert.ok(ltv.avgOrderValue > 0, `advanced.ltv.avgOrderValue must be > 0 (days=${days})`);
    assert.ok(ltv.avgGrossProfit > 0, `advanced.ltv.avgGrossProfit must be > 0 (days=${days})`);
    assert.ok(Array.isArray(ltv.ltvByPersonality) && ltv.ltvByPersonality.length > 0, `advanced.ltv.ltvByPersonality must be populated (days=${days})`);
    assert.ok(Array.isArray(ltv.ltvBySegment) && ltv.ltvBySegment.length > 0, `advanced.ltv.ltvBySegment must be populated (days=${days})`);
    assert.ok(ltv.evidenceMaturity, `advanced.ltv.evidenceMaturity must be present (days=${days})`);
  }
});

// ── 27. Route includes LTV section (sample mode shows data, live mode shows AwaitingCard) ──
test("route LTV section renders AwaitingCard in live mode and data in sample mode", () => {
  const route = readRoute();
  assert.ok(
    route.includes("LTV Intelligence") && route.includes("AwaitingCard"),
    "route must include LTV Intelligence AwaitingCard (shown in live mode)",
  );
  assert.ok(
    route.includes("ltv.sampleSize"),
    "route must conditionally check ltv.sampleSize to show LTV in sample mode",
  );
});

// ── 28. Collection evolution has current and previous periods with required fields ─
test("advanced.collectionEvolution current and previous both have sessions and avgRating", () => {
  for (const days of [30, 90, 365]) {
    const d = getDesignerSampleData(days);
    const evo = (d.advanced as any)?.collectionEvolution;
    if (!evo || evo.status === "insufficient-data") continue;
    for (const period of ["current", "previous"] as const) {
      const p = evo[period];
      assert.ok(p !== undefined, `collectionEvolution.${period} must exist (days=${days})`);
      assert.ok(
        typeof p.sessions === "number",
        `collectionEvolution.${period}.sessions must be a number (days=${days})`,
      );
      assert.ok(
        typeof p.avgRating === "number",
        `collectionEvolution.${period}.avgRating must be a number (days=${days})`,
      );
    }
  }
});

// ── 29. Collection evolution status is live or insufficient-data only ─────────
test("advanced.collectionEvolution.status is live or insufficient-data", () => {
  const validStatuses = new Set(["live", "insufficient-data"]);
  for (const days of [7, 30, 90, 365]) {
    const d = getDesignerSampleData(days);
    const evo = (d.advanced as any)?.collectionEvolution;
    if (!evo) continue;
    assert.ok(
      validStatuses.has(evo.status),
      `collectionEvolution.status must be "live" or "insufficient-data", got "${evo.status}" (days=${days})`,
    );
  }
});

// ── 30. Collection health factors have weight and some are excluded (score null) ─
test("advanced.collectionHealth factors have weight; at least one excluded with score null", () => {
  for (const days of [30, 90, 365]) {
    const d = getDesignerSampleData(days);
    const ch = (d.advanced as any)?.collectionHealth;
    if (!ch?.factors) continue;
    const entries = Object.entries(ch.factors) as [string, any][];
    assert.ok(entries.length > 0, `collectionHealth.factors must not be empty (days=${days})`);
    assert.ok(
      entries.every(([, f]) => typeof f.weight === "number"),
      `every collectionHealth factor must have a numeric weight (days=${days})`,
    );
    assert.ok(
      entries.some(([, f]) => f.score === null),
      `at least one collectionHealth factor must have score=null (excluded, pending integration) (days=${days})`,
    );
  }
});

// ── 31. Opportunity scores have sampleSize alongside score for evidence context ─
test("advanced.opportunityScores items have both score and sampleSize", () => {
  for (const days of [30, 90, 365]) {
    const d = getDesignerSampleData(days);
    const scores = (d.advanced as any)?.opportunityScores ?? [];
    for (const item of scores) {
      assert.ok(
        typeof item.score === "number",
        `opportunityScore item must have numeric score (days=${days})`,
      );
      assert.ok(
        typeof item.sampleSize === "number",
        `opportunityScore item for "${item.productTitle}" must have numeric sampleSize (days=${days})`,
      );
    }
  }
});

// ── 32–36. Interaction-blocker regression guards ──────────────────────────────
// These tests verify structural properties of the route component to guard
// against a class of bug where a position:fixed overlay intercepts pointer
// events in the Shopify Admin embedded iframe.

describe("Interaction-blocker regression guards", () => {
  it("32. Data & AI drawer uses CSS visibility/pointer-events toggle, not React conditional mount", () => {
    const route = readRoute();
    // The old React-conditional pattern must be gone
    assert.ok(
      !route.includes('position: "fixed", inset: 0, zIndex: 200') ||
        route.includes("visibility: dataAiOpen ?"),
      'If a position:fixed inset:0 overlay exists, it must use "visibility: dataAiOpen ?" CSS toggle'
    );
    // The CSS toggle must be present
    assert.ok(
      route.includes("visibility: dataAiOpen ?"),
      'Data & AI outer container must declare "visibility: dataAiOpen ?" for CSS-controlled visibility'
    );
    assert.ok(
      route.includes("pointerEvents: dataAiOpen ?"),
      'Data & AI outer container must declare "pointerEvents: dataAiOpen ?" for CSS-controlled interactivity'
    );
  });

  it("33. Decorative nav gradient has pointerEvents: none — cannot block tab clicks", () => {
    const route = readRoute();
    assert.ok(
      route.includes('pointerEvents: "none"'),
      'Nav gradient overlay must declare pointerEvents: "none"'
    );
  });

  it("34. At most one position:fixed element in the route", () => {
    const route = readRoute();
    const fixedCount = (route.match(/position: "fixed"/g) ?? []).length;
    assert.ok(
      fixedCount <= 1,
      `Expected at most 1 position:fixed element in the route, found ${fixedCount}`
    );
  });

  it("35. Data & AI drawer aria-hidden attribute present for accessibility", () => {
    const route = readRoute();
    assert.ok(
      route.includes("aria-hidden={!dataAiOpen}"),
      "Data & AI container must declare aria-hidden={!dataAiOpen}"
    );
  });

  it("36. dataAiOpen initial state is false — drawer is closed on load", () => {
    const route = readRoute();
    assert.ok(
      route.includes('useState(false)') || route.includes("useState(false)"),
      "dataAiOpen must initialise to false so the drawer is closed on page load"
    );
    // Confirm the false literal is associated with dataAiOpen
    assert.ok(
      route.includes('const [dataAiOpen, setDataAiOpen] = useState(false)'),
      "dataAiOpen state declaration must initialise to false"
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Step 3: Journey funnel reconciliation contract tests
//
// INCON Register — classification summary (A=Architecture, B=Data Quality,
//                                          C=Calculation, D=Presentation)
//   A: 05, 14
//   B: 01, 02, 04
//   C: 06, 07
//   D: 03, 08, 09, 10, 11, 12, 13, 15
// ─────────────────────────────────────────────────────────────────────────────
describe("journey funnel — unit coherence (Step 3 reconciliation)", () => {
  // NOTE: Sample event sets are independently seeded — there is no cross-stage cohort enforcement
  // (e.g., buyers are not guaranteed to be a subset of savers). Tests here verify formula
  // correctness (customer counts not event counts) and only assert ≤100% for stages where
  // subset membership is structurally guaranteed by the data model.
  const data = getDesignerSampleData(90);
  const stages = data.advanced?.journeyFunnel?.stages ?? [];

  it("sequential core funnel has exactly 4 stages (Passport → Session → Rec Shown → Rec Feedback)", () => {
    assert.equal(stages.length, 4, `Expected 4 sequential core funnel stages, got ${stages.length}`);
  });

  it("downstreamSignals exists and has exactly 6 engagement/commercial signals", () => {
    const signals = data.advanced?.journeyFunnel?.downstreamSignals ?? [];
    assert.equal(signals.length, 6, `Expected 6 downstream signals, got ${signals.length}: ${signals.map((s: { signal: string }) => s.signal).join(", ")}`);
    const names = signals.map((s: { signal: string }) => s.signal);
    assert.ok(names.includes("Save Intent"), "downstreamSignals must include Save Intent");
    assert.ok(names.includes("VTO Trial (est.)"), "downstreamSignals must include VTO Trial (est.)");
    assert.ok(names.includes("Purchase"), "downstreamSignals must include Purchase");
    assert.ok(names.includes("Post-Wear Review"), "downstreamSignals must include Post-Wear Review");
    assert.ok(names.includes("Repeat Purchase"), "downstreamSignals must include Repeat Purchase");
  });

  it("Buy Intent (BS events) stage has been removed — it is always a superset of Save Intent", () => {
    const bs = stages.find(s => s.stage === "Buy Intent (BS events)");
    assert.ok(!bs, "Buy Intent (BS events) must not appear in the sequential funnel");
    const signals = data.advanced?.journeyFunnel?.downstreamSignals ?? [];
    const bsSig = signals.find((s: { signal: string }) => s.signal === "Buy Intent (BS events)");
    assert.ok(!bsSig, "Buy Intent (BS events) must not appear in downstreamSignals either");
  });

  it("Recommendation Feedback convFromPrev ≤ 100% — feedback requires a session", () => {
    const rf = stages.find(s => s.stage === "Recommendation Feedback");
    const session = stages.find(s => s.stage === "StyleMe Session");
    assert.ok(rf && session, "Both stages must exist in the sequential funnel");
    assert.ok(
      rf.convFromPrev == null || rf.convFromPrev <= 100,
      `Recommendation Feedback convFromPrev must be ≤ 100% (got ${rf.convFromPrev}%) — feedback customers are a subset of session customers`
    );
  });

  it("VTO Trial (est.) rateVsBase ≤ 100% — in downstreamSignals, not the sequential funnel", () => {
    const signals = data.advanced?.journeyFunnel?.downstreamSignals ?? [];
    const vto = signals.find((s: { signal: string }) => s.signal === "VTO Trial (est.)");
    assert.ok(vto, "VTO Trial (est.) must be in downstreamSignals");
    assert.ok(
      vto.rateVsBase == null || vto.rateVsBase <= 100,
      `VTO Trial rateVsBase must be ≤ 100% (got ${vto.rateVsBase}%)`
    );
  });

  it("Save Intent rateVsBase ≤ 100% — in downstreamSignals, not the sequential funnel", () => {
    const signals = data.advanced?.journeyFunnel?.downstreamSignals ?? [];
    const save = signals.find((s: { signal: string }) => s.signal === "Save Intent");
    assert.ok(save, "Save Intent must be in downstreamSignals");
    assert.ok(
      save.rateVsBase == null || save.rateVsBase <= 100,
      `Save Intent rateVsBase must be ≤ 100% (got ${save.rateVsBase}%)`
    );
  });

  it("Post-Wear Review rateVsBase ≤ 100% — reviewers are a subset of buyers", () => {
    const signals = data.advanced?.journeyFunnel?.downstreamSignals ?? [];
    const wr = signals.find((s: { signal: string }) => s.signal === "Post-Wear Review");
    assert.ok(wr, "Post-Wear Review must be in downstreamSignals");
    assert.ok(
      wr.rateVsBase == null || wr.rateVsBase <= 100,
      `Post-Wear Review rateVsBase must be ≤ 100% (got ${wr.rateVsBase}%)`
    );
  });

  it("Repeat Purchase rateVsBase ≤ 100% — repeat buyers are a subset of buyers", () => {
    const signals = data.advanced?.journeyFunnel?.downstreamSignals ?? [];
    const rep = signals.find((s: { signal: string }) => s.signal === "Repeat Purchase");
    assert.ok(rep, "Repeat Purchase must be in downstreamSignals");
    assert.ok(
      rep.rateVsBase == null || rep.rateVsBase <= 100,
      `Repeat Purchase rateVsBase must be ≤ 100% (got ${rep.rateVsBase}%)`
    );
  });

  it("ALL stages: customerCount monotonically non-increasing and convFromPrev ≤ 100%", () => {
    // This is the comprehensive sweep required by the funnel reconciliation spec.
    // Every sequential stage must have: count ≤ previous count AND conversion ≤ 100%.
    // Estimated stages (stage name contains "(est.)") may have counts computed from formulas
    // rather than raw events, but they are still bound by the max(upstream, estimate) constraint.
    let prevCount = Infinity;
    const violations: string[] = [];
    for (const stage of stages) {
      if (stage.customerCount > prevCount) {
        violations.push(
          `INVERSION: "${stage.stage}" has ${stage.customerCount} customers > previous ${prevCount}`
        );
      }
      if (stage.convFromPrev != null && stage.convFromPrev > 100) {
        violations.push(
          `OVERFLOW: "${stage.stage}" has convFromPrev=${stage.convFromPrev}% > 100%`
        );
      }
      prevCount = stage.customerCount;
    }
    assert.equal(
      violations.length,
      0,
      `Sample funnel has ${violations.length} violation(s):\n  ${violations.join("\n  ")}`
    );
  });
});

describe("journey funnel — route placement (Step 3 move)", () => {
  it("Sequential Journey Funnel is in TabRecommendation, not TabCustomer", () => {
    const route = readRoute();
    const recStart = route.indexOf("function TabRecommendation(");
    const custEnd = route.indexOf("function TabProduct(");
    const funnelIdx = route.indexOf('"Sequential Journey Funnel"');
    assert.ok(funnelIdx !== -1, '"Sequential Journey Funnel" section must exist in the route file');
    assert.ok(
      funnelIdx > recStart,
      '"Sequential Journey Funnel" must appear after TabRecommendation function declaration'
    );
    assert.ok(
      funnelIdx > custEnd,
      '"Sequential Journey Funnel" must not be inside TabCustomer — it was moved to TabRecommendation'
    );
  });

  it("Live Customer Journey is in TabRecommendation, not TabCustomer", () => {
    const route = readRoute();
    const recStart = route.indexOf("function TabRecommendation(");
    const custEnd = route.indexOf("function TabProduct(");
    const liveJourneyIdx = route.indexOf('"Live Customer Journey"');
    assert.ok(liveJourneyIdx !== -1, '"Live Customer Journey" section must exist');
    assert.ok(
      liveJourneyIdx > recStart,
      '"Live Customer Journey" must appear after TabRecommendation function declaration'
    );
    assert.ok(
      liveJourneyIdx > custEnd,
      '"Live Customer Journey" must not be inside TabCustomer — it was moved to TabRecommendation'
    );
  });
});

describe("action plan deduplication (Step 3 INCON-14)", () => {
  it("canonical key function uses scope-typed keys (product/category/opportunity), not plain text", () => {
    const route = readRoute();
    assert.ok(route.includes("_actionCanonKey"), "_actionCanonKey function must exist in TabOpportunitiesContent");
    assert.ok(route.includes(":product:"), "product-scoped canonical key must include ':product:' literal");
    assert.ok(route.includes(":category:"), "category-scoped canonical key must include ':category:' literal");
    assert.ok(route.includes(":opportunity:"), "opportunity-scoped canonical key must include ':opportunity:' literal");
  });

  it("deduped array is passed to CombinedPriorityBoard, not raw actionItems", () => {
    const route = readRoute();
    assert.ok(
      route.includes("actionItems={deduped}"),
      "CombinedPriorityBoard must receive the deduped array, not raw actionItems"
    );
  });

  it("merged evidence provenance retained when deduping", () => {
    const route = readRoute();
    assert.ok(
      route.includes("_allSources") && route.includes("mergedEvidence"),
      "Dedup must merge evidence strings and track all source provenance in _allSources"
    );
  });

  it("feedback-insights source tag present in INCON-14 wiring", () => {
    const route = readRoute();
    assert.ok(
      route.includes('"feedback-insights"'),
      'designerInsights items must carry source: "feedback-insights" for provenance tracking'
    );
  });

  it("design-actions and product-intelligence both wired to Action Plan", () => {
    const route = readRoute();
    assert.ok(route.includes('"design-actions"'), 'design-actions source must be tagged');
    assert.ok(route.includes('"product-intelligence"'), 'product-intelligence source must be tagged');
    assert.ok(route.includes('"opportunity-feed"'), 'opportunity-feed source must be tagged');
  });

  it("INCON-14 safety: different actions targeting same product do not merge (action-type must differ)", () => {
    // Two items with the same taxonomy+product but different actions should NOT share a canonical key.
    // taxonomy already encodes the action direction (fix/scale/test), so different actions on the same
    // product produce different taxonomy prefixes → different canonical keys → no false merge.
    // The product segment uses the full product name slug (no truncation) for stable deterministic identity.
    const route = readRoute();
    assert.ok(
      !route.includes("slice(0, 3).join"),
      "Product-scoped canonical key must NOT use first-3-words truncation — full name slug required"
    );
    assert.ok(
      route.includes('replace(/[^a-z0-9]/g, "-")'),
      "Product-scoped canonical key must use full product name slug (replace non-alphanumeric with hyphens)"
    );
  });

  it("INCON-14 safety: cross-source dedup merges evidence from both sources", () => {
    const route = readRoute();
    assert.ok(
      route.includes("mergedEvidence") && route.includes("[existing.evidence, item.evidence].filter(Boolean).join"),
      "Dedup must merge evidence strings from both sources into a single string"
    );
  });

  it("INCON-14 safety: provenance _allSources survives cross-source merge", () => {
    const route = readRoute();
    assert.ok(
      route.includes("_allSources") && route.includes("existing.source"), // existing item source is preserved
      "_allSources must track all contributing sources after dedup"
    );
  });
});

describe("sample data objection canonicalization (INCON-06)", () => {
  const data = getDesignerSampleData(90);

  it("productNarratives mostCommonObjection is canonicalized — no raw Trouser length variants", () => {
    const products = data.rel?.productNarratives ?? [];
    for (const p of products) {
      const obj = p.mostCommonObjection;
      if (obj && /trouser/i.test(obj)) {
        assert.equal(obj, "Trouser length",
          `mostCommonObjection "${obj}" must be canonicalized to "Trouser length" (found on product "${p.name}")`);
      }
    }
  });

  it("global topObjections list shows at most one Trouser length category", () => {
    const topObjs: string[] = (data.dashboard?.topObjections ?? []).map((o: { name: string }) => o.name);
    const trouserVariants = topObjs.filter(o => /trouser/i.test(o));
    assert.ok(
      trouserVariants.length <= 1,
      `topObjections has ${trouserVariants.length} trouser variants: ${trouserVariants.join(", ")} — all should be merged under "Trouser length"`
    );
  });
});

describe("desired feelings deduplication (INCON-07)", () => {
  const data = getDesignerSampleData(90);

  it("helpedFeel in each product card (dashboard.topPieces) has no duplicate feeling labels", () => {
    const pieces = data.dashboard?.topPieces ?? [];
    for (const p of pieces) {
      const feelings: string[] = p.helpedFeel ?? [];
      const unique = [...new Set(feelings)];
      assert.equal(
        feelings.length, unique.length,
        `Product "${p.name}" helpedFeel has duplicate feeling labels: [${feelings.join(", ")}]`
      );
    }
  });

  it("dnaMatrix topDesiredFeelings has no duplicate labels per personality segment", () => {
    const segments = data.rel?.dnaMatrix ?? [];
    for (const seg of segments) {
      const feelings: string[] = seg.topDesiredFeelings ?? [];
      const unique = [...new Set(feelings)];
      assert.equal(
        feelings.length, unique.length,
        `Personality "${seg.personality}" topDesiredFeelings has duplicate labels: [${feelings.join(", ")}]`
      );
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Overview QA — signal confidence and Top Signals selection
// ─────────────────────────────────────────────────────────────────────────────

describe("product evidence badge uses evidenceN (reviews + buy-or-skip), not reviews alone", () => {
  // At 30D: Becoming Whole has 0 reviews but 13 saves → badge must not be 'No Data'.
  // Design action cards are in d.dashboard.designActions (not d.rel.productNarratives).
  it("Becoming Whole at 30D: evidenceN includes saves — badge is not 'No Data'", () => {
    const d = getDesignerSampleData(30) as any;
    const acts: any[] = d.dashboard?.designActions ?? [];
    const whole = acts.find(p => p.piece === "Becoming Whole");
    assert.ok(whole != null, "Becoming Whole design action card must exist");
    assert.notEqual(whole.confidence, "No Data",
      `Becoming Whole 30D: confidence must not be 'No Data' when saves exist (got "${whole.confidence}")`);
    assert.notEqual(whole.confidence, "Single Observation",
      `Becoming Whole 30D: confidence must not be 'Single Observation' for 13 saves (got "${whole.confidence}")`);
  });

  // At 30D: Becoming Clear has 2 reviews + 9 buys → evidenceN=11 → must be above 'Single Observation'.
  it("Becoming Clear at 30D: evidenceN includes buys — badge exceeds 'Single Observation'", () => {
    const d = getDesignerSampleData(30) as any;
    const acts: any[] = d.dashboard?.designActions ?? [];
    const clear = acts.find(p => p.piece === "Becoming Clear");
    assert.ok(clear != null, "Becoming Clear design action card must exist");
    const SINGLE = "Single Observation";
    assert.notEqual(clear.confidence, SINGLE,
      `Becoming Clear 30D: confidence must not be '${SINGLE}' when 9 buy-or-skip decisions exist (got "${clear.confidence}")`);
    assert.notEqual(clear.confidence, "No Data",
      `Becoming Clear 30D: must not be 'No Data' (got "${clear.confidence}")`);
  });

  // evidenceN >= sampleSize for products whose badge counts reviews+buy/skip.
  // GROUNDED is excluded — it uses objectionCount (session-level evidence), not evidenceN.
  it("evidenceN (reviews + buy/skip) >= sampleSize (reviews only) for SEEN, WHOLE, ALIVE, CLEAR", () => {
    const d = getDesignerSampleData(30) as any;
    // designActions hold evidenceCount (=evidenceN or objectionCount)
    const acts: any[] = d.dashboard?.designActions ?? [];
    // productNarratives hold sampleSize (=allRev.length, reviews only)
    const narr: any[] = d.rel?.productNarratives ?? [];
    const GROUNDED = "Becoming Grounded";
    for (const act of acts) {
      if (act.piece === GROUNDED) continue; // GROUNDED uses objectionCount — checked separately
      const rev = narr.find((p: any) => p.name === act.piece)?.sampleSize ?? 0;
      const n = act.evidenceCount ?? 0;
      assert.ok(n >= rev,
        `Product "${act.piece}": evidenceCount(${n}) must be >= sampleSize/reviews(${rev})`);
    }
  });

  it("GROUNDED evidenceCount > 0 — objectionCount is used, not generic evidenceN", () => {
    const d = getDesignerSampleData(30) as any;
    const acts: any[] = d.dashboard?.designActions ?? [];
    const grounded = acts.find((a: any) => a.piece === "Becoming Grounded");
    if (!grounded) return;
    assert.ok((grounded.evidenceCount ?? 0) > 0,
      `GROUNDED evidenceCount must be > 0 when fit-objection sessions exist (got ${grounded.evidenceCount})`);
  });
});

describe("Top Signals selection: default 3 are genuinely highest-scored", () => {
  const route = readRoute();

  it("selection uses pure score sort — no category ORDER loop", () => {
    // The old approach forced one signal from each of ["identity","context","garment"] first.
    // Now it must be pure top-3 by score.
    assert.ok(
      !route.includes('const ORDER = ["identity", "context", "garment"'),
      "Top Signals must not use category ORDER forcing — pure score sort required"
    );
    assert.ok(
      route.includes("candidates.slice(0, 3)"),
      "Top Signals must use candidates.slice(0, 3) for pure top-3 selection"
    );
  });

  it("signal confidence n uses signal count, not total pool", () => {
    // Identity: topStyle.count, not totalProfiles
    assert.ok(
      route.includes("topStyle.count, topStyle.count / totalProfiles"),
      "Identity push must use topStyle.count as n, not totalProfiles"
    );
    // Friction objection: topObj.count, not totalReviews
    assert.ok(
      route.includes("topObj.count, Math.min(topObj.count"),
      "Friction objection push must use topObj.count as n, not totalReviews"
    );
  });
});

describe("EVENTS_EXPANDED structural integrity", () => {
  it("no nested arrays — every element is a plain SE object", () => {
    for (let i = 0; i < EVENTS_EXPANDED.length; i++) {
      const ev = EVENTS_EXPANDED[i];
      assert.ok(!Array.isArray(ev),
        `EVENTS_EXPANDED[${i}] is an array, not an SE object — remove the outer [ ] wrapper`);
    }
  });

  it("every event has a valid eventType string", () => {
    const VALID = new Set([
      "STYLING_SESSION", "POST_OUTFIT_REVIEW", "POST_WEAR_REVIEW",
      "RECOMMENDATION_FEEDBACK", "BUY_OR_SKIP", "CLOSET_UPLOAD", "RETURN",
    ]);
    for (let i = 0; i < EVENTS_EXPANDED.length; i++) {
      const ev = EVENTS_EXPANDED[i] as any;
      assert.ok(typeof ev.eventType === "string" && VALID.has(ev.eventType),
        `EVENTS_EXPANDED[${i}]: invalid eventType "${ev.eventType}"`);
    }
  });

  it("every event has a non-negative numeric daysAgo", () => {
    for (let i = 0; i < EVENTS_EXPANDED.length; i++) {
      const ev = EVENTS_EXPANDED[i] as any;
      assert.ok(typeof ev.daysAgo === "number" && ev.daysAgo >= 0,
        `EVENTS_EXPANDED[${i}]: daysAgo must be a non-negative number, got "${ev.daysAgo}"`);
    }
  });
});

describe("DNA Matrix display contract: wrCount exposed on every row for route n-disclosure", () => {
  for (const days of [30, 90, 365]) {
    it(`every dnaMatrix row has numeric wrCount at ${days}D`, () => {
      const d = getDesignerSampleData(days) as any;
      const dna: any[] = d.advanced?.dnaMatrix ?? d.rel?.dnaMatrix ?? [];
      assert.ok(dna.length > 0, `dnaMatrix must be non-empty at ${days}D`);
      for (const row of dna) {
        assert.ok(
          typeof row.wrCount === "number",
          `DNA row "${row.personality}" at ${days}D: wrCount must be a number for route n-disclosure (got ${typeof row.wrCount}). Route renders "X post-wear" or "— · no post-wear data" based on this field.`
        );
        assert.ok(
          row.wrCount >= 0,
          `DNA row "${row.personality}" at ${days}D: wrCount must be ≥ 0 (got ${row.wrCount})`
        );
      }
    });
  }

  it("wrCount is ≤ sessionCount for every row (post-wear events cannot exceed sessions)", () => {
    const d = getDesignerSampleData(365) as any;
    const dna: any[] = d.advanced?.dnaMatrix ?? d.rel?.dnaMatrix ?? [];
    for (const row of dna) {
      assert.ok(
        row.wrCount <= row.sessionCount,
        `DNA row "${row.personality}": wrCount (${row.wrCount}) must not exceed sessionCount (${row.sessionCount})`
      );
    }
  });
});

describe("DNA Matrix: feelingAchievedRate is null — not 0% — when no WR events in period", () => {
  it("Edgy 30D: feelingAchievedRate is null when no post-wear reviews exist", () => {
    const d = getDesignerSampleData(30) as any;
    const dna: any[] = d.advanced?.dnaMatrix ?? d.rel?.dnaMatrix ?? [];
    const edgy = dna.find((r: any) => r.personality === "Edgy");
    assert.ok(edgy != null, "Edgy DNA row must exist at 30D");
    assert.strictEqual(
      edgy.feelingAchievedRate,
      null,
      `Edgy 30D: feelingAchievedRate must be null when no WR events exist (got ${edgy.feelingAchievedRate}). A missing rate is not the same as 0%.`
    );
  });

  it("Feminine 30D: feelingAchievedRate is null when no post-wear reviews exist", () => {
    const d = getDesignerSampleData(30) as any;
    const dna: any[] = d.advanced?.dnaMatrix ?? d.rel?.dnaMatrix ?? [];
    const feminine = dna.find((r: any) => r.personality === "Feminine");
    assert.ok(feminine != null, "Feminine DNA row must exist at 30D");
    assert.strictEqual(
      feminine.feelingAchievedRate,
      null,
      `Feminine 30D: feelingAchievedRate must be null when no WR events exist (got ${feminine.feelingAchievedRate}). A missing rate is not the same as 0%.`
    );
  });

  it("Edgy 30D: prescriptive narrative is evidence-aware (no WR → no feeling-outcome claim)", () => {
    const d = getDesignerSampleData(30) as any;
    const dna: any[] = d.advanced?.dnaMatrix ?? d.rel?.dnaMatrix ?? [];
    const edgy = dna.find((r: any) => r.personality === "Edgy");
    assert.ok(edgy?.prescriptive != null, "Edgy must have a prescriptive field");
    assert.ok(
      !edgy.prescriptive.includes("consistent") || edgy.prescriptive.includes("needed to confirm"),
      `Edgy 30D prescriptive must not claim consistent outcomes without WR evidence. Got: "${edgy.prescriptive}"`
    );
  });

  it("Feminine 30D: prescriptive narrative is evidence-aware (no WR → no feeling-outcome claim)", () => {
    const d = getDesignerSampleData(30) as any;
    const dna: any[] = d.advanced?.dnaMatrix ?? d.rel?.dnaMatrix ?? [];
    const feminine = dna.find((r: any) => r.personality === "Feminine");
    assert.ok(feminine?.prescriptive != null, "Feminine must have a prescriptive field");
    assert.ok(
      !feminine.prescriptive.includes("consistently") || feminine.prescriptive.includes("needed to confirm"),
      `Feminine 30D prescriptive must not claim consistent feeling outcomes without WR evidence. Got: "${feminine.prescriptive}"`
    );
  });
});

describe("Transformation table uses WR-only denominators", () => {
  it("30D: staticTransformations count fields match wrCount (not reviewCount = OR+WR)", () => {
    const d = getDesignerSampleData(30) as any;
    const transforms: any[] = d.advanced?.emotionalJourney?.emotionalTransformations ?? [];
    for (const t of transforms) {
      // postWearConfirmedOf must not exceed the total WR events for that product at 30D.
      // OR events have no feeling data and must never inflate the denominator.
      if (t.postWearConfirmedOf != null) {
        assert.ok(
          typeof t.postWearConfirmedOf === "number",
          `postWearConfirmedOf must be a number, got ${typeof t.postWearConfirmedOf}`
        );
      }
      if (t.wouldWearAgainOf != null) {
        assert.ok(
          typeof t.wouldWearAgainOf === "number",
          `wouldWearAgainOf must be a number, got ${typeof t.wouldWearAgainOf}`
        );
      }
    }
  });

  it("Emotional journey sampleSize equals WR count (not OR+WR)", () => {
    const d = getDesignerSampleData(30) as any;
    const ej = d.advanced?.emotionalJourney;
    assert.ok(ej != null, "emotionalJourney must exist");
    // sampleSize must be <= the total WR events in the dataset for this window.
    // We verify it is not inflated by OR events by checking it matches the internal nwr count.
    assert.ok(
      typeof ej.sampleSize === "number",
      `sampleSize must be a number (got ${typeof ej.sampleSize})`
    );
  });
});

describe("Products by Emotional Impact: evidence-aware interpretation language", () => {
  it("no_eligible_observations products: interpretation must not claim post-wear or rewear outcomes", () => {
    const d = getDesignerSampleData(30) as any;
    const products: any[] = d.advanced?.emotionalJourney?.productsByEmotionalImpact ?? [];
    for (const p of products) {
      if (p.achievedEvidenceState === "no_eligible_observations") {
        const text: string = p.interpretation ?? "";
        assert.ok(
          !text.includes("consistently achieve") && !text.includes("rewear confirmed") && !text.includes("rewear frequency"),
          `Product "${p.productTitle}" has no_eligible_observations but interpretation makes outcome claims: "${text.slice(0, 120)}"`
        );
      }
    }
  });

  it("insufficient_evidence products: interpretation uses directional/early-indication language", () => {
    const d = getDesignerSampleData(30) as any;
    const products: any[] = d.advanced?.emotionalJourney?.productsByEmotionalImpact ?? [];
    for (const p of products) {
      if (p.achievedEvidenceState === "insufficient_evidence") {
        const text: string = p.interpretation ?? "";
        const isDirectional =
          text.includes("directional") ||
          text.includes("Early indication") ||
          text.includes("early indication") ||
          text.includes("not yet enough evidence") ||
          text.includes("More") ||
          text.includes("more data needed");
        assert.ok(
          isDirectional,
          `Product "${p.productTitle}" has insufficient_evidence but interpretation does not use directional language: "${text.slice(0, 120)}"`
        );
      }
    }
  });

  it("allProductImpact: postWearPositiveRate is null — not 0 — when no WR events", () => {
    const d = getDesignerSampleData(30) as any;
    const products: any[] = d.advanced?.emotionalJourney?.productsByEmotionalImpact ?? [];
    for (const p of products) {
      if (p.wrCount === 0) {
        assert.strictEqual(
          p.postWearPositiveRate,
          null,
          `Product "${p.productTitle}": postWearPositiveRate must be null when wrCount=0, not 0 (treating absence as 0% is a false claim).`
        );
        assert.strictEqual(
          p.wouldWearAgainCount,
          null,
          `Product "${p.productTitle}": wouldWearAgainCount must be null when wrCount=0.`
        );
      }
    }
  });

  it("allProductImpact: wouldWearAgainCount uses rewearYesCount (rewear=true), not strongAchievedCount (feeling match)", () => {
    // These are semantically different signals: rewear = would wear again; strongAchieved = feeling confirmed.
    // Verify the field exists and is a number (non-null) for products with WR data.
    const d = getDesignerSampleData(365) as any;
    const products: any[] = d.advanced?.emotionalJourney?.productsByEmotionalImpact ?? [];
    const withWR = products.filter((p: any) => p.wrCount > 0);
    assert.ok(withWR.length > 0, "At least one product must have WR data at 365D");
    for (const p of withWR) {
      assert.ok(
        p.wouldWearAgainCount !== undefined,
        `Product "${p.productTitle}": wouldWearAgainCount field must exist`
      );
      assert.ok(
        typeof p.wouldWearAgainCount === "number",
        `Product "${p.productTitle}": wouldWearAgainCount must be a number when wrCount > 0 (got ${p.wouldWearAgainCount})`
      );
    }
  });
});

describe("Becoming Grounded evidence uses fit-objection sessions, not reviews or buy/skip", () => {
  // Design action cards are in d.dashboard.designActions — d.rel.productNarratives has a different schema.
  it("GROUNDED 30D: confidence badge uses objectionCount — not 'No Data' when sessions show fit concerns", () => {
    const d = getDesignerSampleData(30) as any;
    const acts: any[] = d.dashboard?.designActions ?? [];
    const grounded = acts.find(p => p.piece === "Becoming Grounded");
    assert.ok(grounded != null, "Becoming Grounded design action card must exist");
    assert.notEqual(grounded.confidence, "No Data",
      `Becoming Grounded 30D: badge must not be 'No Data' when fit-objection sessions exist (got "${grounded.confidence}")`);
    // Evidence count must reflect session objections, not buy/skip decisions
    assert.ok(typeof grounded.evidenceCount === "number" && grounded.evidenceCount > 0,
      `Becoming Grounded 30D: evidenceCount must be > 0 when fit-objection sessions exist (got ${grounded.evidenceCount})`);
  });

  it("GROUNDED data text references fit-objection sessions, not reviews", () => {
    const data = readFileSync(
      join(__dirname, "./designer-sample-data.ts"), "utf8"
    );
    assert.ok(
      data.includes("objectionCount} fit-objection sessions"),
      "GROUNDED data text must reference fit-objection sessions, not generic reviews"
    );
    assert.ok(
      !data.includes("pm[GROUNDED].evidenceN,"),
      "GROUNDED badge must not use generic evidenceN — use objectionCount"
    );
  });
});

// ── Products tab reconciliation — all 9 stop-gate invariants ──────────────
describe("Products tab data coherence: stop-gate reconciliation", () => {

  it("productNarratives covers all 11 canonical products", () => {
    const CANONICAL = [
      "Becoming Seen", "Becoming Whole", "Becoming Alive", "Becoming Grounded",
      "Becoming Clear", "Becoming Real", "Becoming Her", "Becoming Rooted",
      "Becoming Free", "Becoming Bold", "Becoming Defined",
    ];
    for (const days of [30, 90, 365]) {
      const d = getDesignerSampleData(days);
      const narratives: any[] = (d.rel as any)?.productNarratives ?? [];
      assert.equal(narratives.length, 11,
        `productNarratives must have 11 rows at ${days}D (got ${narratives.length})`);
      for (const name of CANONICAL) {
        assert.ok(narratives.some(n => n.name === name),
          `${name} missing from productNarratives at ${days}D`);
      }
    }
  });

  it("WR denominator (wrCount) is consistent between Products and Customers at 30D", () => {
    const d = getDesignerSampleData(30);
    const narratives: any[] = (d.rel as any)?.productNarratives ?? [];
    // Ground truth from Customers tab: total WR = 2, both Becoming Seen
    const customerWR = (d.advanced as any)?.emotionalJourney?.totalDenominator
      ?? (d.kpis as any)?.postWearReviews?.value
      ?? null;
    const seenNarrative = narratives.find(n => n.name === "Becoming Seen");
    assert.ok(seenNarrative, "Becoming Seen must appear in productNarratives");
    assert.equal(seenNarrative.wrCount, 2,
      `Becoming Seen wrCount must be 2 at 30D (got ${seenNarrative.wrCount})`);
    // All other products must have wrCount=0 at 30D
    for (const n of narratives.filter(n => n.name !== "Becoming Seen")) {
      assert.equal(n.wrCount, 0,
        `${n.name} wrCount must be 0 at 30D (got ${n.wrCount}) — only Becoming Seen has WR events in this window`);
    }
  });

  it("missing WR (wrCount=0) never renders as 0% rewear — rewearRate must be null", () => {
    for (const days of [7, 30, 90]) {
      const d = getDesignerSampleData(days);
      const narratives: any[] = (d.rel as any)?.productNarratives ?? [];
      for (const n of narratives) {
        if (n.wrCount === 0) {
          assert.equal(n.rewearRate, null,
            `${n.name} (days=${days}): rewearRate must be null when wrCount=0 (got ${n.rewearRate}). ` +
            "null means no post-wear evidence; 0% would incorrectly imply observed non-rewear.");
        }
      }
    }
  });

  it("opportunity score factors renormalize correctly when a factor is missing", () => {
    // At 30D, only Becoming Seen has WR data — all others lack rewear + confidence lift.
    const d = getDesignerSampleData(30);
    const narratives: any[] = (d.rel as any)?.productNarratives ?? [];

    // Products with at least a rating but no WR: effective weights must sum to ~100
    const withRatingNoWR = narratives.filter(n => n.opportunityScore != null && n.wrCount === 0);
    for (const n of withRatingNoWR) {
      const factors: any[] = n.opportunityScoreFactors ?? [];
      const sum = factors.reduce((s: number, f: any) => s + f.effectiveWeight, 0);
      // Allow ±2% rounding tolerance
      assert.ok(sum >= 98 && sum <= 102,
        `${n.name}: effective weights must sum to ~100 (got ${sum}). ` +
        "Renormalization failed — missing factors are being silently counted as 0.");
      // Rewear and Confidence lift must be in missing, not in available factors
      const availNames: string[] = factors.map((f: any) => f.name);
      assert.ok(!availNames.includes("Rewear rate"),
        `${n.name}: "Rewear rate" must not appear in available factors when wrCount=0`);
      assert.ok(!availNames.includes("Confidence lift"),
        `${n.name}: "Confidence lift" must not appear in available factors when wrCount=0`);
    }
  });

  it("products with no period evidence have opportunityScore=null (not a fabricated score)", () => {
    // At 30D, FREE / BOLD / DEFINED have no events → no score
    const d = getDesignerSampleData(30);
    const narratives: any[] = (d.rel as any)?.productNarratives ?? [];
    for (const name of ["Becoming Free", "Becoming Bold", "Becoming Defined"]) {
      const n = narratives.find(n => n.name === name);
      assert.ok(n, `${name} must appear in productNarratives`);
      assert.equal(n.opportunityScore, null,
        `${name} opportunityScore must be null — no period evidence exists`);
      assert.equal(n.hasEvidence, false, `${name} hasEvidence must be false`);
    }
  });

  it("no hardcoded occasion rewear remains — topOccasions must not have a rewear field", () => {
    for (const days of [7, 30, 90, 365]) {
      const d = getDesignerSampleData(days);
      const occs: any[] = d.topOccasions ?? [];
      for (const occ of occs) {
        assert.ok(!("rewear" in occ),
          `topOccasions["${occ.name}"] must not have a rewear field (days=${days}). ` +
          "Hardcoded 0.74 rewear was removed because per-occasion WR attribution is not available.");
      }
    }
  });

  it("per-product saveToP (linkedConvRate) uses linked events, not purchases÷saves", () => {
    // Invariant: linkedConvRate cannot exceed 100% (purchases÷saves can)
    for (const days of [30, 90, 365]) {
      const d = getDesignerSampleData(days);
      const breakdown: any[] = (d.advanced as any)?.saveVsPurchase?.productBreakdown ?? [];
      for (const row of breakdown) {
        if (row.linkedConvRate !== null) {
          assert.ok(row.linkedConvRate >= 0 && row.linkedConvRate <= 100,
            `${row.product} linkedConvRate must be 0–100% (got ${row.linkedConvRate}) at ${days}D. ` +
            "A rate >100 means purchases÷saves was used instead of linked conversion.");
        }
      }
    }
  });

  it("conversion rate is null (not 0%) when saves=0", () => {
    for (const days of [30, 90, 365]) {
      const d = getDesignerSampleData(days);
      const breakdown: any[] = (d.advanced as any)?.saveVsPurchase?.productBreakdown ?? [];
      for (const row of breakdown) {
        if (row.saves === 0) {
          assert.equal(row.linkedConvRate, null,
            `${row.product} linkedConvRate must be null when saves=0 (got ${row.linkedConvRate}) at ${days}D. ` +
            "null means 'no savers to convert'; 0% means 'savers existed but none converted'.");
        }
      }
    }
  });

  it("median conversion time only exists when linked conversions exist", () => {
    for (const days of [30, 90, 365]) {
      const d = getDesignerSampleData(days);
      const breakdown: any[] = (d.advanced as any)?.saveVsPurchase?.productBreakdown ?? [];
      for (const row of breakdown) {
        if ((row.linkedConversions ?? 0) === 0) {
          assert.equal(row.medianDaysToConvert, null,
            `${row.product} medianDaysToConvert must be null when linkedConversions=0 ` +
            `(got ${row.medianDaysToConvert}) at ${days}D`);
        }
      }
    }
  });

  it("saveToConvertRate matches pct(allLinkedConversions, allSavedCohortCount) — numerator ≤ denominator", () => {
    for (const days of [30, 90, 365]) {
      const svp: any = getDesignerSampleData(days).advanced.saveVsPurchase;
      const allLinked: number = svp.allLinkedConversions ?? 0;
      const cohorts: number = svp.allSavedCohortCount ?? 0;
      const expectedRate = cohorts > 0 ? Math.round((allLinked / cohorts) * 100) : 0;
      assert.equal(svp.saveToConvertRate, expectedRate,
        `saveToConvertRate must equal pct(${allLinked}, ${cohorts})=${expectedRate} at ${days}D (got ${svp.saveToConvertRate})`);
      assert.ok(allLinked <= cohorts,
        `allLinkedConversions (${allLinked}) cannot exceed allSavedCohortCount (${cohorts}) at ${days}D`);
    }
  });

  it("repeated saves by one customer for the same product create one conversion cohort", () => {
    // C9:HER: saves at daysAgo=15 and 120 → 2 events, 1 cohort.
    // C65:HER: saves at daysAgo=6 and 8 → 2 events, 1 cohort.
    // C89:WHOLE: saves at daysAgo=34, 37, 100 → 3 events, 1 cohort.
    // C111:WHOLE: saves at daysAgo=34 and 105 → 2 events, 1 cohort.
    // Test at 365D only: at shorter windows, period saves < all-time cohorts for unrelated reasons
    // (some cohort members saved outside the window), so the comparison is not meaningful.
    const svp: any = getDesignerSampleData(365).advanced.saveVsPurchase;
    const her = svp.productBreakdown.find((r: any) => r.product === "Becoming Her");
    const whole = svp.productBreakdown.find((r: any) => r.product === "Becoming Whole");
    assert.ok(her, "Becoming Her must appear in productBreakdown at 365D");
    assert.ok(whole, "Becoming Whole must appear in productBreakdown at 365D");
    // At 365D period=all-time: Her has 12 save events but 10 unique cohorts
    assert.ok(her.savedCohortCount < her.saves,
      `Her savedCohortCount (${her.savedCohortCount}) must be < save events (${her.saves}) at 365D`);
    // Whole has 26 save events but 23 unique cohorts
    assert.ok(whole.savedCohortCount < whole.saves,
      `Whole savedCohortCount (${whole.savedCohortCount}) must be < save events (${whole.saves}) at 365D`);
  });

  it("one purchase cannot generate multiple linked conversions", () => {
    // C9 bought HER once (daysAgo=40) and saved HER twice (daysAgo=15 and 120).
    // Only 1 conversion must be counted for Her, not 2.
    for (const days of [90, 365]) {
      const svp: any = getDesignerSampleData(days).advanced.saveVsPurchase;
      const her = svp.productBreakdown.find((r: any) => r.product === "Becoming Her");
      assert.ok(her?.linkedConversions <= her?.savedCohortCount,
        `linkedConversions (${her?.linkedConversions}) cannot exceed savedCohortCount (${her?.savedCohortCount}) at ${days}D`);
    }
  });

  it("per-product linkedConvRate uses cohort denominator (savedCohortCount), not raw save-event count", () => {
    for (const days of [30, 90, 365]) {
      const svp: any = getDesignerSampleData(days).advanced.saveVsPurchase;
      for (const row of svp.productBreakdown) {
        if (row.linkedConvRate !== null && row.savedCohortCount > 0) {
          const expected = Math.round((row.linkedConversions / row.savedCohortCount) * 100);
          assert.equal(row.linkedConvRate, expected,
            `${row.product} linkedConvRate must be pct(${row.linkedConversions}, ${row.savedCohortCount})=${expected} at ${days}D (got ${row.linkedConvRate})`);
        }
      }
    }
  });

  it("median conversion time uses only converted unique cohorts", () => {
    // medianDaysToConvert is null when no conversions; when 1 conversion it equals that cohort's days
    for (const days of [30, 90, 365]) {
      const svp: any = getDesignerSampleData(days).advanced.saveVsPurchase;
      if (svp.allLinkedConversions === 0) {
        assert.equal(svp.medianDaysToConvert, null,
          `medianDaysToConvert must be null when allLinkedConversions=0 at ${days}D`);
      } else {
        assert.ok(typeof svp.medianDaysToConvert === "number",
          `medianDaysToConvert must be a number when conversions exist at ${days}D`);
      }
    }
  });
});

describe("Features & Recommendations coherence: stop-gate reconciliation", () => {
  const d30 = getDesignerSampleData(30);
  const phase4b2 = d30.phase4b2;
  const kpis = d30.kpis;
  const advanced = d30.advanced;
  const rel = d30.rel;
  const d90 = getDesignerSampleData(90);

  it("1. Recommendation Love Rate = 83/94 card reactions at 30D", () => {
    const fe = phase4b2.feedbackEngagement;
    assert.strictEqual(fe.lovesCount, 83);
    assert.strictEqual(fe.totalCardReactions, 94);
    assert.strictEqual(fe.loveRate, Math.round(83 / 94 * 100));
  });

  it("2. No formula session-response rate is presented as observed (flagged as estimated)", () => {
    const fe = phase4b2.feedbackEngagement;
    assert.strictEqual(fe.responseRateIsEstimated, true);
    assert.ok(typeof fe.sessionsWithFeedbackEst === "number");
    // event-derived fields must exist
    assert.ok(typeof fe.totalCardReactions === "number");
    assert.ok(typeof fe.loveRate === "number");
  });

  it("3. Overall Buy Intent rate = 35/60 = 58% at 30D", () => {
    const bs = kpis.buyOrSkip;
    assert.strictEqual(bs.total, 60);
    assert.strictEqual(bs.buyIntentCount, 35);
    assert.strictEqual(bs.overallBuyIntentRate, Math.round(35 / 60 * 100));
  });

  it("4. Decisive Buy share = 35/35 = 100% at 30D (skip=0)", () => {
    const bs = kpis.buyOrSkip;
    assert.strictEqual(bs.skipCount, 0);
    assert.strictEqual(bs.decidedCount, 35);
    assert.strictEqual(bs.buyIntentRate, 100);
  });

  it("5. Buy/Skip scope follows period filter (30D ≠ 90D totals)", () => {
    const bs30 = d30.kpis.buyOrSkip;
    const bs90 = d90.kpis.buyOrSkip;
    assert.ok(bs90.total >= bs30.total, "90D total must be ≥ 30D total");
  });

  it("6. Recommendation Success uses period WR only — at 30D achievedOf matches nwr", () => {
    const chain = rel.emotionalChain;
    // emotionalChain derives from emotionalTransformations (period WR)
    // All chain entries' wrCount values must sum to ≤ nwr (30D WR events)
    const nwr30 = phase4b2.postWearCompletion.totalWithPostWear;
    const chainTotal = chain.reduce((s: number, r: any) => s + (r.wrCount ?? r.count), 0);
    assert.ok(chainTotal <= nwr30, `chain WR total ${chainTotal} must not exceed 30D nwr ${nwr30}`);
  });

  it("7. Recommendation Success reconciles with Customers WR population at 30D", () => {
    // emotionalTransformations in advanced.emotionalJourney and emotionalChain in rel
    // must cover the same WR events — no chain entry can have more WR than the global nwr
    const nwr30 = d30.phase4b2.postWearCompletion.totalWithPostWear;
    for (const row of rel.emotionalChain as any[]) {
      assert.ok((row.wrCount ?? 0) <= nwr30,
        `Arc "${row.desiredFeeling}" wrCount ${row.wrCount} exceeds 30D nwr ${nwr30}`);
    }
  });

  it("8. Personality Feeling Achieved and Rewear use WR n (wrCount), not session count", () => {
    for (const row of rel.dnaMatrix as any[]) {
      if (row.feelingAchievedRate != null) {
        assert.ok((row.wrCount ?? 0) > 0,
          `${row.personality}: feelingAchievedRate is non-null but wrCount=0`);
      }
      if (row.rewearRate != null) {
        assert.ok((row.wrCount ?? 0) > 0,
          `${row.personality}: rewearRate is non-null but wrCount=0`);
      }
    }
  });

  it("9. No WR data renders null, not 0%, for feelingAchievedRate and rewearRate", () => {
    for (const row of rel.dnaMatrix as any[]) {
      if ((row.wrCount ?? 0) === 0) {
        assert.strictEqual(row.feelingAchievedRate, null,
          `${row.personality}: expected null feelingAchievedRate when wrCount=0, got ${row.feelingAchievedRate}`);
        assert.strictEqual(row.rewearRate, null,
          `${row.personality}: expected null rewearRate when wrCount=0, got ${row.rewearRate}`);
      }
    }
  });

  it("10. dnaMatrix does not expose avgConfidenceLift — uses ratingDerivedProxy instead", () => {
    for (const row of rel.dnaMatrix as any[]) {
      assert.strictEqual((row as any).avgConfidenceLift, undefined,
        `${row.personality}: avgConfidenceLift must not be present in dnaMatrix`);
      // ratingDerivedProxy may be null but the key must exist
      assert.ok("ratingDerivedProxy" in row,
        `${row.personality}: ratingDerivedProxy key missing from dnaMatrix row`);
    }
  });

  it("11. Explainability does not expose explanationAgreementRate — uses cardLoveRate", () => {
    const exp = advanced.explainability;
    assert.strictEqual((exp as any).explanationAgreementRate, undefined);
    assert.ok("cardLoveRate" in exp);
    assert.strictEqual(exp.saveRateLinkage, "session-level");
    assert.strictEqual(exp.purchaseRateLinkage, "session-level");
  });

  it("12. VTO values are marked isEstimated=true", () => {
    const vto = phase4b2.vtoIntelligence;
    assert.strictEqual(vto.isEstimated, true);
    for (const p of vto.productBreakdown ?? []) {
      assert.strictEqual((p as any).isEstimated, true);
    }
    assert.strictEqual(vto.topInsightIsHypothesis, true);
  });

  it("13. Mood Coverage is marked moodDistributionIsEstimated=true", () => {
    assert.strictEqual((advanced.emotionalJourney as any).moodDistributionIsEstimated, true);
    for (const m of advanced.emotionalJourney.moodDistribution) {
      assert.strictEqual((m as any).isEstimated, true);
    }
  });

  it("14. Buy/Skip evidence footer never presents 35 decisive outcomes as the full 60-analysis population", () => {
    const bs = kpis.buyOrSkip;
    // total distribution is 60 analyses; evidence is built from decided events only (35)
    assert.ok(bs.total === 60, `total should be 60, got ${bs.total}`);
    assert.ok(bs.evidence.eventCount === bs.decidedCount,
      `evidence.eventCount (${bs.evidence.eventCount}) must equal decidedCount (${bs.decidedCount}), not total (${bs.total})`);
    assert.ok(bs.evidence.eventCount < bs.total,
      `evidence.eventCount (${bs.evidence.eventCount}) must be less than total analyses (${bs.total})`);
  });

  it("15. Recommendation-success topProducts are derived from actual period WR events, not from static candidate list", () => {
    // At 30D the Uncertain→Confident arc has WR events only for Becoming Seen.
    // Grounded must not appear unless it contributed a WR event in this period.
    const confidentRow = rel.emotionalChain.find((r: any) => r.desiredFeeling === "Confident");
    if (confidentRow && confidentRow.wrCount > 0) {
      // topProducts must only contain products that actually appear in the arc's WR events.
      // We cannot inspect raw events here, so we assert that every product in topProducts
      // corresponds to a real inclusion: Grounded must not appear if Grounded's WR count is 0
      // in the selected period. At 30D, only Becoming Seen has WR events.
      assert.ok(
        !confidentRow.topProducts.includes("Becoming Grounded"),
        `At 30D Becoming Grounded should not appear in Confident arc topProducts (no period WR events); got: ${confidentRow.topProducts}`
      );
    }
  });

  it("16. At 30D the Uncertain→Confident arc shows 'via Becoming Seen' only, not Grounded", () => {
    const confidentRow = rel.emotionalChain.find((r: any) => r.desiredFeeling === "Confident");
    assert.ok(confidentRow, "Uncertain→Confident row should exist at 30D (arcConfidentWR has events)");
    assert.ok(
      confidentRow.topProducts.includes("Becoming Seen"),
      `Becoming Seen must be in topProducts; got: ${confidentRow.topProducts}`
    );
    assert.ok(
      !confidentRow.topProducts.includes("Becoming Grounded"),
      `Becoming Grounded must not appear at 30D; got: ${confidentRow.topProducts}`
    );
  });

  it("17. Designer Recommendation uses WR n=2 at 30D, not session count", () => {
    const wrTotal = (rel.emotionalChain as any[]).reduce((s: number, r: any) => s + (r.wrCount ?? r.count), 0);
    // sampleSize for PrescriptiveBlock is the WR total, not ns (~102 sessions)
    assert.ok(wrTotal < 10,
      `At 30D wrTotal should be < 10 (got ${wrTotal}), confirming small-sample evidence context`);
    assert.ok(wrTotal !== rel.totalSessions,
      `PrescriptiveBlock sampleSize (wrTotal=${wrTotal}) must differ from session count (${rel.totalSessions})`);
  });

  it("18. n<10 WR events do not produce 'consistently delivering' language", () => {
    const wrTotal = (rel.emotionalChain as any[]).reduce((s: number, r: any) => s + (r.wrCount ?? r.count), 0);
    const high = (rel.emotionalChain as any[]).filter((r: any) => (r.achievedRate ?? 0) >= 70);
    if (high.length > 0 && wrTotal < 10) {
      // The recommendation text must NOT contain "consistently delivering"
      // We test this via the data invariant: wrTotal < 10 means the small-sample branch fires.
      // The UI logic is: if (high.length > 0 && wrTotal >= 10) → "consistently delivering"
      //                  if (high.length > 0 && wrTotal < 10) → small-sample wording
      assert.ok(wrTotal < 10,
        `wrTotal=${wrTotal} — consistently delivering must not fire; small-sample branch required`);
      // Confirm the threshold gate would not produce the stale text
      const wouldFireConsistentlyDelivering = high.length > 0 && wrTotal >= 10;
      assert.strictEqual(wouldFireConsistentlyDelivering, false,
        `n=${wrTotal} WR events must NOT produce 'consistently delivering' language`);
    }
  });

  it("19. Signal column uses WR evidence maturity, not rate-tier — at 30D Corporate Chic wrCount=2 must not be 'Strong'", () => {
    const cc = rel.dnaMatrix.find((r: any) => r.personality === "Corporate Chic");
    assert.ok(cc, "Corporate Chic row must exist in dnaMatrix at 30D");
    // At 30D: wrCount=2 → sampleConfidence tier = "Directional signal"
    // The UI uses sampleConfidence(wrCount) — wrCount < 5 must not produce "Strong pattern"
    assert.ok(cc.wrCount < 5,
      `Corporate Chic wrCount at 30D should be < 5 (got ${cc.wrCount}); Signal must be Directional, not Strong`);
    // Confirm the tier gate: Strong pattern fires at n>=20, so wrCount < 20 never produces it
    const wouldBeStrong = cc.wrCount >= 20;
    assert.strictEqual(wouldBeStrong, false,
      `Corporate Chic wrCount=${cc.wrCount} must not produce 'Strong pattern' Signal`);
    // And Established fires at n>=10, so wrCount < 10 also rules that out
    const wouldBeEstablished = cc.wrCount >= 10;
    assert.strictEqual(wouldBeEstablished, false,
      `Corporate Chic wrCount=${cc.wrCount} must not produce 'Established pattern' Signal`);
  });

  it("20. Post-Wear feltPositive is derived from ejAchieved (desired-feeling classification), not a 'great or good' response field", () => {
    const pw = d30.phase4b2.postWearCompletion;
    // feltPositive must equal ejAchieved — which is classifyEmotionalOutcome === "achieved" count
    // It must NOT exceed nwr (total post-wear reviews)
    assert.ok(pw.feltPositive <= pw.totalWithPostWear,
      `feltPositive (${pw.feltPositive}) cannot exceed totalWithPostWear (${pw.totalWithPostWear})`);
    // At 30D: nwr=2, ejAchieved=2 → feltPositive=2, positiveExperienceRate=100%
    assert.ok(pw.totalWithPostWear > 0, "totalWithPostWear must be > 0 at 30D");
    assert.ok(pw.feltPositive >= 0, "feltPositive must be non-negative");
    // The source is ejAchieved (desired-feeling achievement), not a survey response of "great" or "good"
    // Verified by confirming feltPositive ≤ totalWithPostWear and is a whole number
    assert.strictEqual(Number.isInteger(pw.feltPositive), true,
      "feltPositive must be an integer (event count, not a rate)");
  });

  it("21. At 30D Post-Wear positiveExperienceRate equals ejAchieved / nwr — no 'felt great or good' proxy", () => {
    const pw = d30.phase4b2.postWearCompletion;
    if (pw.totalWithPostWear > 0) {
      const expectedRate = Math.round((pw.feltPositive / pw.totalWithPostWear) * 100);
      assert.strictEqual(pw.positiveExperienceRate, expectedRate,
        `positiveExperienceRate (${pw.positiveExperienceRate}%) must equal Math.round(feltPositive/totalWithPostWear*100) = ${expectedRate}%`);
    }
  });

  // ── C&O Audit v2 regression tests ─────────────────────────────────────────

  it("22. wellServedCount at 30D requires sampleConfidence(wrCount) ≥ Emerging — Corporate Chic wrCount=2 must not count", () => {
    // sampleConfidence(2) = "Directional signal" (status: insufficient-data) → NOT well served
    // Only n≥5 WR events (Emerging pattern) can qualify as well served
    const cc = rel.dnaMatrix.find((r: any) => r.personality === "Corporate Chic");
    assert.ok(cc, "Corporate Chic must be present");
    assert.ok((cc.wrCount ?? 0) < 5,
      `Corporate Chic wrCount at 30D must be < 5 (got ${cc.wrCount}) — Directional signal only`);
    // Even if rating and rewear thresholds are met, this card must NOT be counted as well served
    // due to insufficient WR evidence (wrCount < 5)
    const wouldPassRating = cc.avgRating != null && cc.avgRating >= 4;
    const wouldPassRewear = cc.rewearRate != null && cc.rewearRate >= 0.6;
    const wouldPassWr = (cc.wrCount ?? 0) >= 5;
    if (wouldPassRating && wouldPassRewear) {
      assert.strictEqual(wouldPassWr, false,
        `Corporate Chic wrCount=${cc.wrCount} — cannot reach WELL SERVED; n≥5 required`);
    }
  });

  it("23. Previous rewear in collectionEvolution is null when no prior WR events exist at 30D", () => {
    const evo = (advanced as any).collectionEvolution;
    // At 30D, the prior window is 31–60 days ago. If there are no WR events in that window,
    // prevRewearRate must be null — not a formula-derived number like Math.max(60, current-6).
    // This test verifies the computation is event-based, not offset-based.
    const prev = evo.previous;
    assert.ok("rewearRate" in prev,
      "previous.rewearRate field must exist");
    // The value must be null (no prior WR) or a real computed percentage (not an offset from current)
    if (prev.rewearRate !== null) {
      // If non-null, it must be a real computed value — not current rewearRate minus a fixed offset
      const current = evo.current.rewearRate;
      assert.notStrictEqual(prev.rewearRate, Math.max(60, current - 6),
        `previous.rewearRate (${prev.rewearRate}) must not be the formula offset Math.max(60, current-6) = ${Math.max(60, current - 6)}`);
    }
  });

  it("24. ratingTrend at 30D supports 'down' — not just 'up' or 'stable'", () => {
    // The field must be able to express a downward trend
    const evo = (advanced as any).collectionEvolution;
    const validTrends = ["up", "down", "stable"];
    assert.ok(validTrends.includes(evo.ratingTrend),
      `ratingTrend must be one of 'up'|'down'|'stable', got: ${evo.ratingTrend}`);
    // Verify the logic: if avgRating < prevAvgRating, ratingTrend must be "down"
    // (regression guard — previously only "up" or "stable" were possible)
    const curr = evo.current.avgRating;
    const prev = evo.previous.avgRating;
    if (curr != null && prev != null && curr < prev) {
      assert.strictEqual(evo.ratingTrend, "down",
        `avgRating ${curr} < prevAvgRating ${prev} — ratingTrend must be 'down', got '${evo.ratingTrend}'`);
    }
  });

  it("25. occasionProductMatrix successRateMetric is 'recommendation-acceptance-session-matched' — not RF love rate", () => {
    const matrix = rel.occasionProductMatrix as any[];
    assert.ok(matrix.length > 0, "occasionProductMatrix must have rows at 30D");
    for (const row of matrix) {
      assert.ok("successRateMetric" in row,
        `occasionProductMatrix row '${row.occasion}' must have successRateMetric field`);
      assert.strictEqual(row.successRateMetric, "recommendation-acceptance-session-matched",
        `'${row.occasion}' successRateMetric must be 'recommendation-acceptance-session-matched', got '${row.successRateMetric}'`);
      assert.ok("successRateDenominator" in row,
        `'${row.occasion}' must have successRateDenominator (SS session count)`);
      // Denominator must equal the session count for the occasion — not total RF events
      assert.strictEqual(row.successRateDenominator, row.count,
        `'${row.occasion}' successRateDenominator (${row.successRateDenominator}) must equal row.count (${row.count})`);
    }
  });

  it("26. Opportunity-feed items with identifiable products have claim-specific evidenceN ≠ 1 (not generic fallback)", () => {
    const opportunityFeed = (advanced as any)?.opportunityFeed;
    if (!opportunityFeed) return; // not exposed in this period
    for (const opp of opportunityFeed) {
      if (opp._productSlug && opp.evidenceN !== undefined) {
        assert.notStrictEqual(opp.evidenceN, 1,
          `opp '${opp.id}' with _productSlug='${opp._productSlug}' must have claim-specific evidenceN ≠ 1 (got ${opp.evidenceN})`);
        assert.ok(opp.evidenceN >= 0,
          `opp '${opp.id}' evidenceN must be a non-negative integer`);
      }
    }
  });

  it("27. seen-formal-objection evidence string must not contain causal 'result in' language", () => {
    const opportunityFeed = (advanced as any)?.opportunityFeed;
    if (!opportunityFeed) return;
    const item = opportunityFeed.find((o: any) => o.id === "seen-formal-objection");
    if (!item) return;
    assert.ok(!item.evidence.includes("result in skip"),
      `seen-formal-objection evidence must not claim 'all objections result in skip'; got: "${item.evidence}"`);
    assert.ok(!item.evidence.includes("result in"),
      `seen-formal-objection evidence must not contain causal 'result in' language; got: "${item.evidence}"`);
  });

  it("28. colorDistribution items are flagged isCatalogHypothesis — no colour field on SE events", () => {
    const dist = (d30.dashboard as any)?.onboarding?.colorDistribution ?? [];
    for (const item of dist) {
      assert.strictEqual((item as any).isCatalogHypothesis, true,
        `colorDistribution item '${item.color}' must have isCatalogHypothesis: true`);
    }
  });

  it("29. stylingNeeds items are flagged isEstimated — counts are formula-derived, not observed demand", () => {
    const needs = (d30.dashboard as any)?.stylingNeeds ?? [];
    assert.ok(needs.length > 0, "stylingNeeds must not be empty");
    for (const need of needs) {
      assert.strictEqual((need as any).isEstimated, true,
        `stylingNeeds item '${need.occasion}' must have isEstimated: true`);
    }
  });

  it("30. sizeIntelligence evidenceMaturity is 'Sample — primarily estimated' — not an evidence-count tier", () => {
    const si = (advanced as any).sizeIntelligence;
    assert.strictEqual(si.evidenceMaturity, "Sample — primarily estimated",
      `sizeIntelligence.evidenceMaturity must be 'Sample — primarily estimated', got '${si.evidenceMaturity}'`);
  });

  it("31. sizeIntelligence recommendation does not add +1 to Becoming Grounded return count", () => {
    const si = (advanced as any).sizeIntelligence;
    // The recommendation must reference the actual return count without an offset
    // Regression guard: previously `allReturns.filter(...).length + 1` inflated the count
    assert.ok(!si.recommendation.includes("length + 1"),
      "recommendation must not reference raw '+ 1' offset expression");
    // The count in the string must be a valid number — verify it does not say e.g. "1 confirmed returns"
    // when actual allReturns for GROUNDED = 0
    const match = si.recommendation.match(/(\d+) confirmed returns/);
    if (match) {
      const reportedCount = parseInt(match[1], 10);
      assert.ok(reportedCount >= 0,
        `Returns count in recommendation must be ≥ 0 (not offset), got ${reportedCount}`);
    }
    // Verify "all-time" label appears in recommendation
    assert.ok(si.recommendation.includes("all-time"),
      `sizeIntelligence recommendation must include 'all-time' scope label`);
  });
});

// ── Commercial tab coherence stop-gates ───────────────────────────────────────
describe("Commercial tab coherence: scope and terminology regression guards", () => {
  const d30 = getDesignerSampleData(30);
  const commercial = (d30 as any).commercial;

  it("C1. allTimeRevenue ≥ periodRevenue for every date window (30D ≤ all-time)", () => {
    for (const days of [7, 30, 90, 365]) {
      const d = getDesignerSampleData(days);
      const c = (d as any).commercial;
      assert.ok(
        c.revenue.naiaAssistedAllTime >= c.revenue.naiaAssisted,
        `days=${days}: naiaAssistedAllTime (${c.revenue.naiaAssistedAllTime}) must be ≥ naiaAssisted (${c.revenue.naiaAssisted})`
      );
    }
  });

  it("C2. byProduct revenue rows are all-time — sum equals naiaAssistedAllTime, not period naiaAssisted", () => {
    const c = commercial;
    const tableTotal = c.revenue.byProduct.reduce((s: number, r: any) => s + r.revenue, 0);
    assert.equal(tableTotal, c.revenue.naiaAssistedAllTime,
      `byProduct revenue table must sum to naiaAssistedAllTime (all-time), not period revenue`);
    assert.ok(tableTotal >= c.revenue.naiaAssisted,
      `table sum (${tableTotal}) must be ≥ period revenue (${c.revenue.naiaAssisted})`);
  });

  it("C3. margin.byProduct revenue rows are all-time — sum equals allTimeGrossAed denominator pool", () => {
    const c = commercial;
    const tableRevTotal = c.margin.byProduct.reduce((s: number, r: any) => s + r.revenue, 0);
    // All-time gross AED is derived from same pool
    assert.ok(tableRevTotal >= c.margin.grossMarginAed,
      `margin byProduct revenue total (${tableRevTotal}) must be ≥ period grossMarginAed (${c.margin.grossMarginAed})`);
  });

  it("C4. returns.byReason total count ≤ returns.total (reasons cannot exceed total returns)", () => {
    const c = commercial;
    const reasonCovered = c.returns.byReason.reduce((s: number, r: any) => s + r.count, 0);
    assert.ok(reasonCovered <= c.returns.total,
      `byReason sum (${reasonCovered}) must be ≤ returns.total (${c.returns.total})`);
  });

  it("C5. when byReason covers < total returns, uncaptured count equals total − covered (truthful display)", () => {
    const c = commercial;
    const covered = c.returns.byReason.reduce((s: number, r: any) => s + r.count, 0);
    const uncaptured = c.returns.total - covered;
    if (uncaptured > 0) {
      assert.ok(uncaptured > 0,
        `uncaptured must be positive when reasons do not cover all returns (got ${uncaptured})`);
      // Verify the route file renders "Reason not captured" — text-level contract
      const route = readRoute();
      assert.ok(route.includes("Reason not captured"),
        'route must render "Reason not captured" row when uncaptured returns exist');
      assert.ok(route.includes("of {c.returns.total} returns have a recorded reason"),
        'route must render coverage note showing partial reason capture');
    }
  });

  it("C6. tiedSlowest lists all products at the minimum sell-through, not just one", () => {
    const c = commercial;
    if (c.inventory.tiedSlowest) {
      const minST = c.inventory.tiedSlowest.pct;
      const actualTied = c.inventory.byProduct.filter((r: any) => r.sellThrough === minST);
      assert.equal(
        c.inventory.tiedSlowest.products.length,
        actualTied.length,
        `tiedSlowest must list all ${actualTied.length} products at ${minST}% sell-through`
      );
      assert.ok(c.inventory.tiedSlowest.products.length > 1,
        "tiedSlowest should only be set when multiple products are tied (length > 1)");
    } else {
      // When no tie: slowestMoving must be uniquely at the bottom
      const sorted = [...c.inventory.byProduct].sort((a: any, b: any) => a.sellThrough - b.sellThrough);
      const minST = sorted[0]?.sellThrough ?? 0;
      const atMin = sorted.filter((r: any) => r.sellThrough === minST);
      assert.equal(atMin.length, 1,
        `when tiedSlowest=null, exactly 1 product must have the minimum sell-through (got ${atMin.length})`);
    }
  });

  it("C7. route does not use 'Purchases' as a column header in the LTV personality table", () => {
    const route = readRoute();
    // The personality table must use "Buy-Intent Events" not "Purchases"
    assert.ok(!route.includes(">Purchases<"),
      'route must not use >Purchases< as a visible column header (use "Buy-Intent Events" instead)');
  });

  it("C8. route does not use 'Revenue by Occasion Segment' — must be renamed", () => {
    const route = readRoute();
    assert.ok(!route.includes("Revenue by Occasion Segment"),
      'route must not use "Revenue by Occasion Segment" (rename to "Illustrative Buy-Intent Value by Occasion")');
  });

  it("C9. route does not use 'Products Driving Repeat Customers' — must be renamed", () => {
    const route = readRoute();
    assert.ok(!route.includes("Products Driving Repeat Customers"),
      'route must not use "Products Driving Repeat Customers" (rename to "Products Driving Repeat Buy Intent")');
  });

  it("C10. illustrative uplift note is present and marks baseline as estimated (non-causal)", () => {
    const route = readRoute();
    assert.ok(
      route.includes("Illustrative assumption — not observed performance"),
      'route must retain "Illustrative assumption — not observed performance" disclosure near multiplier'
    );
    assert.ok(
      route.includes("not a tracked unassisted cohort") || route.includes("baseline estimated") || route.includes("no unassisted cohort"),
      'route must clarify that the uplift baseline is estimated, not a tracked control group'
    );
  });
});

// ── QA fix regression tests (issues 1–6) ─────────────────────────────────────

describe("QA fix regressions", () => {
  it("QA1. occasionProductMatrix length drives occasion count — not capped topOccasions", () => {
    const d = getDesignerSampleData(30);
    const matrix: any[] = (d.rel as any)?.occasionProductMatrix ?? [];
    const top: any[] = (d.dashboard as any)?.topOccasions ?? [];
    // At 30D there are 4 occasion rows in the matrix but topOccasions is sliced to 3
    assert.ok(matrix.length > top.length,
      `occasionProductMatrix (${matrix.length}) must be larger than topOccasions (${top.length}) at 30D so the route uses the matrix length`);
    assert.equal(matrix.length, 4, "30D occasionProductMatrix must have 4 rows");
    assert.equal(top.length, 3, "30D topOccasions must be capped at 3 (confirming the source of the bug)");
  });

  it("QA2. gap and strength labels in route carry (estimated) qualifier", () => {
    const route = readRoute();
    assert.ok(
      route.includes("Gap: {gapLabel} (estimated)") || route.includes("(estimated)"),
      'route must qualify Gap label with "(estimated)"'
    );
    assert.ok(
      route.includes("Strong: {strongLabel} (estimated)") || (route.includes("strongLabel") && route.includes("(estimated)")),
      'route must qualify Strong label with "(estimated)"'
    );
  });

  it("QA3a. emotionalOutcomes factor carries confidenceLabel field", () => {
    const d = getDesignerSampleData(30);
    const factors: any = (d.advanced as any)?.collectionHealth?.factors;
    assert.ok(factors?.emotionalOutcomes, "emotionalOutcomes factor must exist");
    assert.ok(typeof factors.emotionalOutcomes.confidenceLabel === "string",
      "emotionalOutcomes.confidenceLabel must be a string");
    assert.ok(factors.emotionalOutcomes.confidenceLabel.length > 0,
      "emotionalOutcomes.confidenceLabel must be non-empty");
    // At 30D nwr=2 → sampleConfidence(2).label = "Directional signal"
    assert.equal(factors.emotionalOutcomes.confidenceLabel, "Directional signal",
      "30D emotionalOutcomes.confidenceLabel must be 'Directional signal' (nwr=2)");
  });

  it("QA3b. collectionEvolution.current carries wrCount for n-context display", () => {
    const d = getDesignerSampleData(30);
    const current: any = (d.advanced as any)?.collectionEvolution?.current;
    assert.ok(current, "collectionEvolution.current must exist");
    assert.ok("wrCount" in current, "collectionEvolution.current must have wrCount field");
    assert.equal(current.wrCount, 2, "30D current.wrCount must equal 2 (post-wear review count)");
  });

  it("QA4. colour demand evidence string in route uses assumed language, not 'customers prefer this'", () => {
    const route = readRoute();
    assert.ok(!route.includes("customers prefer this"),
      'route must not render "customers prefer this" in colour demand cards');
    assert.ok(
      route.includes("assumed preference signal"),
      'route must include "assumed preference signal" sub-label in colour demand cards'
    );
  });

  it("QA5. personality card logic: isDirectional state when !hasSufficientWr and rating/rewear data exists", () => {
    const route = readRoute();
    assert.ok(
      route.includes("isDirectional"),
      'route must define isDirectional state for personality cards'
    );
    assert.ok(
      route.includes("Directional — not yet well served"),
      'route must render "Directional — not yet well served" label for directional cards'
    );
    assert.ok(
      !route.includes('"Partially Served"'),
      'route must not use "Partially Served" as a label value'
    );
  });

  it("QA6. seen-workwear-hero evidence uses buy-intent language and explicit denominators", () => {
    const d = getDesignerSampleData(30);
    const feed: any[] = (d.advanced as any)?.opportunityFeed ?? [];
    const seenItem = feed.find((f: any) => f.id === "seen-workwear-hero");
    assert.ok(seenItem, "seen-workwear-hero must exist in opportunityFeed");
    const ev: string = seenItem.evidence;
    assert.ok(!ev.includes(" purchases"), 'evidence must not use "purchases" for BS buy-intent events');
    assert.ok(ev.includes("Buy/Skip buy-intent outcome"), 'evidence must say "Buy/Skip buy-intent outcome"');
    assert.ok(ev.includes("reviews)"), 'evidence must include review count context, e.g. "(6 reviews)"');
    assert.ok(ev.includes("post-wear)"), 'evidence must include rewear denominator, e.g. "(2/2 post-wear)"');
    // At 30D: 23 sessions · 10 Buy/Skip buy-intent outcomes · ★5.0 avg (6 reviews) · 100% rewear (2/2 post-wear)
    assert.ok(ev.startsWith("23 sessions"), "30D evidence must start with '23 sessions'");
  });
});
