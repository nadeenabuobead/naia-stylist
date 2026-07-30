// app/lib/ai/canonical-intelligence.ts
// Five canonical intelligence objects shared across all dashboard tabs.
// Every tab must reference these objects; no tab may independently author
// a separate card for the same issue. See Section 8 of the refactor spec.
//
// These objects are used in Sample Preview mode only (synthetic data).
// Live mode objects are derived from real event data by the loader.

import type { ActionType, DecisionStatus } from "./canonical-vocabulary";

export interface CanonicalIntelligenceObject {
  id: string;
  title: string;
  entityType: "product" | "customer-segment" | "feature" | "collection" | "platform";
  entityId: string;
  actionType: ActionType;
  decisionStatus: DecisionStatus;

  observedFacts: string[];
  interpretation: string;
  hypothesis: string;

  designImplication: string;
  commercialPositioningImplication: string;

  estimatedImpact: {
    label: string;
    range: string;
    howEstimated: string;
  };

  validationNeeded: string;
  recommendedTest: string;
  successMetric: string;
  nextReviewDate: string;

  evidenceCount: number;
  evidenceMaturity: string;
  supportingMetricKeys: string[];
  supportingEventIds: string[];
  dependencies: string[];

  createdAt: string;
  updatedAt: string;
}

// ── Five canonical intelligence objects ────────────────────────────────────────
// One object per actionable issue. Every tab that surfaces this issue
// must import and render its data from here — never duplicate.

export const CANONICAL_INTELLIGENCE: CanonicalIntelligenceObject[] = [
  {
    id: "CI-001",
    title: "Scale 'Becoming Seen' into the Bold/Confident segment",
    entityType: "product",
    entityId: "SEEN",
    actionType: "Scale",
    decisionStatus: "Reviewing",

    observedFacts: [
      "8 of 11 recommendation responses for 'Becoming Seen' are Love (n=11, Established pattern)",
      "Average post-outfit rating 4.4/5 across confirmed responses",
      "No returns recorded for this product in the synthetic dataset",
      "3 Buy or Skip sessions resulted in Buy intent (100% of decided outcomes)",
      "2 post-wear reviews confirm feeling was achieved",
    ],
    interpretation:
      "The strongest resonance signal in the collection. Bold/Confident segment customers are responding with consistently high love rates and no friction. The product is performing above the collection average on every measured dimension with sufficient evidence to treat this as an established pattern, not early signal.",
    hypothesis:
      "Increasing the recommendation weight and visible inventory positioning for 'Becoming Seen' in Bold/Confident sessions will increase Buy intent conversion without sacrificing recommendation satisfaction scores.",

    designImplication:
      "Prioritise 'Becoming Seen' as the collection's anchor piece for Bold/Confident. Explore a second colourway or silhouette variation within the same feeling family to reduce sell-through risk from a single SKU.",
    commercialPositioningImplication:
      "Highest-confidence candidate for increased inventory depth before next season. Consider early reorder trigger if sell-through exceeds 60% before week 8.",

    estimatedImpact: {
      label: "High",
      range: "+8%–15% attributed revenue uplift (nAia-assisted channel)",
      howEstimated:
        "Based on current love rate (73%), assumed 10% increase in recommendation frequency, current average order value, and 7-day attribution window. Range reflects uncertainty in conversion rate change.",
    },

    validationNeeded:
      "Confirm whether the love rate holds when 'Becoming Seen' is recommended to customers outside the Bold/Confident segment.",
    recommendedTest:
      "Run a 4-week A/B test: increase 'Becoming Seen' recommendation weight by 20% for Bold/Confident sessions in the treatment arm. Measure love rate, Buy intent, and post-wear confirmation.",
    successMetric:
      "Love rate remains ≥70%, Buy intent rate increases by ≥5 percentage points, post-wear confirmation rate ≥60% — all measured at n≥20 in treatment arm.",
    nextReviewDate: "2026-08-28",

    evidenceCount: 11,
    evidenceMaturity: "Established pattern",
    supportingMetricKeys: [
      "recommendation.loveRate.SEEN",
      "product.postOutfitRating.SEEN",
      "buyOrSkip.buyRate.SEEN",
      "postWear.feelingAchieved.SEEN",
    ],
    supportingEventIds: [
      "rf-c1-seen-d1", "rf-c3-seen-d12", "rf-c5-seen-d5", "rf-c13-seen-d5",
      "rf-c15-seen-d14", "rf-c2-seen-d35", "rf-c4-seen-d38", "rf-c9-seen-d47",
    ],
    dependencies: [],
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-28T00:00:00Z",
  },

  {
    id: "CI-002",
    title: "Fix 'Grounded' fit friction before next season reorder",
    entityType: "product",
    entityId: "GROUNDED",
    actionType: "Fix",
    decisionStatus: "New",

    observedFacts: [
      "2 of 5 recommendation responses for 'Grounded' are Skip (n=5, Emerging pattern)",
      "Top stated objection: 'Trouser length concern' (n=1) and 'Waist detail too bold' (n=1)",
      "1 return recorded attributable to fit/comfort",
      "Post-wear rating 3.8/5 — below collection average of 4.2",
      "1 undecided Buy or Skip response vs 0 Buy intent",
    ],
    interpretation:
      "Early friction pattern around fit and proportion for 'Grounded'. The skip rate is meaningful given the small sample: 2 skips in 5 responses is directionally significant though not yet established. The fit objections cluster around trouser length and waist detail — both resolvable through grading or silhouette adjustment rather than a full redesign.",
    hypothesis:
      "Trouser length adjustment (−1.5cm inseam standard, with +2cm option) and softening the waist seam detail will reduce fit-related objections and improve post-wear rating.",

    designImplication:
      "Review the trouser pattern block for 'Grounded' before committing the reorder. Commission fit sessions with 2 customers who have flagged trouser length as an objection. Waist detail: test a softer version in fabric before pattern change.",
    commercialPositioningImplication:
      "Hold reorder quantity to −30% vs initial run until fit objection rate drops below 20% at n≥10. If resolution confirmed by end of testing, restore full quantity.",

    estimatedImpact: {
      label: "Medium",
      range: "+15%–30% reduction in fit-related objections (if design change confirmed)",
      howEstimated:
        "Based on current 40% skip rate in available sample, assumed 50% of skips attributable to correctable fit issues, and historical pattern of fit fixes in comparable collections. High uncertainty: n=5 sample.",
    },

    validationNeeded:
      "Confirm whether fit objections are consistent across body types in the customer base, or concentrated in specific measurements.",
    recommendedTest:
      "Fit session with 3–4 customers who have a completed Passport. Measure whether objections reduce with revised sample. Target: ≤1 fit objection in 4 fit sessions.",
    successMetric:
      "Skip rate due to fit drops to ≤1 in next 10 recommendation responses. Post-wear rating ≥4.2 at n≥5.",
    nextReviewDate: "2026-08-14",

    evidenceCount: 5,
    evidenceMaturity: "Emerging pattern",
    supportingMetricKeys: [
      "recommendation.skipRate.GROUNDED",
      "product.postOutfitRating.GROUNDED",
      "objection.topReason.GROUNDED",
      "returns.reason.GROUNDED",
    ],
    supportingEventIds: [
      "rf-c6-grounded-d16", "rf-c11-grounded-d22",
      "or-c6-grounded", "rt-c11-grounded",
    ],
    dependencies: ["CI-004"],
    createdAt: "2026-07-10T00:00:00Z",
    updatedAt: "2026-07-28T00:00:00Z",
  },

  {
    id: "CI-003",
    title: "Test personality gating for 'Alive' — Edgy-only recommendation",
    entityType: "product",
    entityId: "ALIVE",
    actionType: "Test",
    decisionStatus: "Testing",

    observedFacts: [
      "6 of 8 total 'Alive' feedback events are Love — from Edgy-segment customers (n=8, Established pattern)",
      "1 skip from a customer outside Edgy segment",
      "1 undecided from a customer outside Edgy segment",
      "Experiment ran days 33–72, n=8, minimum sample reached",
      "Love rate from Edgy customers in test period: 86%",
    ],
    interpretation:
      "The gating experiment has reached minimum sample. Edgy-segment customers show consistently strong love rates; non-Edgy customers show lower engagement. The signal supports narrowing the recommendation to Edgy-only, but the sample is borderline and a second validation run is advisable before permanently excluding other segments.",
    hypothesis:
      "Restricting 'Alive' recommendations to Edgy-segment customers will maintain or improve the love rate while reducing wasted recommendations to non-resonant segments.",

    designImplication:
      "If hypothesis is confirmed: position 'Alive' as the signature Edgy piece. Explore whether the second colourway widens the Edgy audience or appeals to an adjacent segment (Bold/Confident overlap).",
    commercialPositioningImplication:
      "Narrowing the recommendation audience reduces addressable volume but increases conversion quality. Monitor whether Edgy-segment size is sufficient to justify the SKU at current margin.",

    estimatedImpact: {
      label: "Medium",
      range: "+10%–20% improvement in recommendation satisfaction for 'Alive' (Edgy sessions)",
      howEstimated:
        "Based on observed love rate differential between Edgy (86%) and non-Edgy (0% love, 50% undecided, 50% skip) customer groups. Range reflects uncertainty in segment size effect on overall recommendation volume.",
    },

    validationNeeded:
      "Second validation run at n≥15 to confirm 86% Edgy love rate holds beyond the initial experiment period.",
    recommendedTest:
      "Continue gating for 4 additional weeks. Target n≥15 Edgy responses. Measure love rate, skip rate, and post-wear confirmation separately for Edgy vs non-Edgy.",
    successMetric:
      "Edgy love rate ≥75% at n≥15. Non-Edgy skip rate ≥50% (confirming gating rationale). No significant change in overall recommendation satisfaction.",
    nextReviewDate: "2026-08-12",

    evidenceCount: 8,
    evidenceMaturity: "Emerging pattern",
    supportingMetricKeys: [
      "recommendation.loveRate.ALIVE",
      "experiment.alive-personality-gating.result",
      "customer.segment.edgy.loveRate",
    ],
    supportingEventIds: [
      "rf-c6-alive-d6", "rf-c7-alive-d13", "rf-c8-alive-d21",
      "rf-c7-alive-d33", "rf-c14-alive-d43", "rf-c8-alive-d52",
      "rf-c5-alive-d77", "rf-c15-alive-d82",
    ],
    dependencies: [],
    createdAt: "2026-06-15T00:00:00Z",
    updatedAt: "2026-07-28T00:00:00Z",
  },

  {
    id: "CI-004",
    title: "Build post-wear review collection for products with Emerging pattern only",
    entityType: "feature",
    entityId: "post-wear-review",
    actionType: "Build",
    decisionStatus: "New",

    observedFacts: [
      "3 of 8 products have zero post-wear review events",
      "5 products have 1–2 post-wear reviews (Single observation or Directional signal)",
      "No product has reached Emerging pattern (n≥5) for post-wear confirmation",
      "Customer Outcomes section shows 'Not measured' for would-wear-again on 3 products",
    ],
    interpretation:
      "Post-wear data is the most under-represented evidence type in the current collection. Without it, the dashboard cannot confirm whether desired feelings are actually achieved after wear — not just after the styling session. This limits the quality of both the Collection Health score and the Observed Resonance scoring for every product.",
    hypothesis:
      "A lightweight post-wear prompt (sent 3–5 days after a confirmed delivery or pickup event) will increase post-wear review completion to ≥30% of styling sessions with a Buy or Skip 'Buy' outcome.",

    designImplication:
      "Post-wear confirmation data unlocks the ability to distinguish between 'feeling excited in the fitting moment' and 'feeling confident in the real world'. This is the most important gap in the current evidence base for design decisions.",
    commercialPositioningImplication:
      "Post-wear data directly supports the 'would wear again' and repeat-purchase metrics needed to validate LTV assumptions. Without it, LTV projections remain ungrounded.",

    estimatedImpact: {
      label: "High",
      range: "Unlocks Established pattern evidence for 3–5 products within 60 days if prompt completion ≥30%",
      howEstimated:
        "Based on current 3 Buy intent events, assumed 80% actual purchase conversion, and 30% target post-wear completion rate. Timeline assumes weekly prompt dispatch.",
    },

    validationNeeded:
      "What is the minimum prompt experience (notification, email, in-app) that achieves ≥30% completion without degrading the styling relationship?",
    recommendedTest:
      "Launch a 6-week post-wear prompt pilot: prompt sent 4 days after delivery confirmation, single question ('Did you feel [desiredFeeling] when you wore [productName]?'). Measure completion rate and compare feeling confirmation to post-outfit rating.",
    successMetric:
      "≥30% post-wear review completion rate among customers with a Buy intent or confirmed purchase. ≥5 post-wear reviews per product for the 3 top-volume products within 60 days.",
    nextReviewDate: "2026-09-01",

    evidenceCount: 7,
    evidenceMaturity: "Emerging pattern",
    supportingMetricKeys: [
      "postWear.completionRate",
      "postWear.feelingAchieved.overall",
      "customer.wouldWearAgain.overall",
    ],
    supportingEventIds: [
      "wr-c1-seen-d45", "wr-c8-alive-d130",
      "wr-c3-whole-d63", "wr-c5-her-d71",
      "wr-c2-seen-d90", "wr-c4-seen-d105", "wr-c9-her-d120",
    ],
    dependencies: ["CI-002", "CI-003"],
    createdAt: "2026-07-15T00:00:00Z",
    updatedAt: "2026-07-28T00:00:00Z",
  },

  {
    id: "CI-005",
    title: "Scale Passport completion by closing the drop-off after question 3",
    entityType: "feature",
    entityId: "passport",
    actionType: "Scale",
    decisionStatus: "Reviewing",

    observedFacts: [
      "15 registered customers in synthetic dataset",
      "12 completed Passports (80% completion rate from registered)",
      "3 customers started but did not complete",
      "Completion drop-off pattern: customers who reach question 3 (lifestyle) complete at 95%; below question 3 the completion rate is estimated at 40%",
      "Products recommended to customers with completed Passports show 12% higher love rate than those without",
    ],
    interpretation:
      "Passport completion is the primary driver of recommendation quality. The 80% completion rate is strong but 3 incomplete Passports represent lost signal. The drop-off before question 3 suggests the lifestyle section may be creating friction — either through question complexity, ambiguity, or length perception.",
    hypothesis:
      "Simplifying or reordering the lifestyle section (questions 2–4) will increase Passport completion from 80% to ≥90% within 60 days, and the additional completed Passports will produce measurable recommendation quality improvements.",

    designImplication:
      "No direct design implication for the physical collection, but Passport completion is the upstream dependency for all personality-segment evidence. Improving it improves the quality of every design signal in the dashboard.",
    commercialPositioningImplication:
      "Each additional completed Passport increases the dataset quality for all products. At the current 12% love-rate differential, each completed Passport adds measurable attribution signal.",

    estimatedImpact: {
      label: "Medium",
      range: "+1–3 additional completed Passports in next 30 days; +12% love rate improvement in newly-matched recommendations",
      howEstimated:
        "Based on 3 incomplete Passports, 60% estimated re-engagement rate with a simplified flow, and observed 12% love-rate differential between matched and unmatched recommendations.",
    },

    validationNeeded:
      "Is the drop-off after question 3 due to question content, perceived length, or session abandonment for unrelated reasons?",
    recommendedTest:
      "A/B test: reorder questions so lifestyle (currently Q3) comes after feeling (currently Q4). Measure completion rate at n≥30 new Passport starts. Target: ≥90% completion in treatment arm.",
    successMetric:
      "Passport completion rate ≥90% at n≥30. Recommendation love rate for newly-matched customers ≥75% at n≥5.",
    nextReviewDate: "2026-08-28",

    evidenceCount: 12,
    evidenceMaturity: "Established pattern",
    supportingMetricKeys: [
      "passport.completionRate",
      "passport.dropOffPoint",
      "recommendation.loveRate.passportComplete",
      "recommendation.loveRate.passportIncomplete",
    ],
    supportingEventIds: [],
    dependencies: [],
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-28T00:00:00Z",
  },
];

// ── Helper: look up a canonical object by ID ───────────────────────────────────
export function getCanonicalObject(id: string): CanonicalIntelligenceObject | undefined {
  return CANONICAL_INTELLIGENCE.find((obj) => obj.id === id);
}

// ── Helper: get objects for a specific entity ─────────────────────────────────
export function getObjectsForEntity(entityId: string): CanonicalIntelligenceObject[] {
  return CANONICAL_INTELLIGENCE.filter((obj) => obj.entityId === entityId);
}

// ── Helper: get objects by action type ────────────────────────────────────────
export function getObjectsByActionType(actionType: ActionType): CanonicalIntelligenceObject[] {
  return CANONICAL_INTELLIGENCE.filter((obj) => obj.actionType === actionType);
}
