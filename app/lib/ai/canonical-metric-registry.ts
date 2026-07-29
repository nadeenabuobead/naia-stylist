// app/lib/ai/canonical-metric-registry.ts
// Single authoritative registry for every metric shown in the Founder–Designer Dashboard.
// Fields are the ground truth for audit, rename, and evidence-discipline enforcement.
// Do not define metric semantics anywhere else.

import type { EvidenceType, MeasurementState } from "./canonical-vocabulary";

export interface MetricDefinition {
  metricId:              string;
  displayName:           string;           // canonical label for UI
  legacyNames:           string[];         // old labels that must be migrated
  description:           string;           // one sentence, plain English
  evidenceType:          EvidenceType;
  numeratorDefinition:   string;
  denominatorDefinition: string;
  eligiblePopulation:    string;           // who qualifies to be in the denominator
  periodRule:            "period" | "all_time" | "period_with_all_time_fallback";
  missingDataRule:       string;           // what to show when no data
  minimumEvidenceRule:   string;           // threshold before showing a value
  confidenceRule:        string;           // how to compute or express confidence
  attributionRule:       string | null;    // revenue/purchase attribution window, if applicable
  formatter:             string;           // "pct" | "aed" | "count" | "days" | "score" | "ratio"
  isDeprecated:          boolean;
  deprecationReason:     string | null;
}

export const METRIC_REGISTRY: Record<string, MetricDefinition> = {

  stated_rewear_intent: {
    metricId:              "stated_rewear_intent",
    displayName:           "Stated Rewear Intent",
    legacyNames:           ["Rewear Rate", "avgRewear", "rewearRate"],
    description:           "Percentage of post-wear reviewers who answered 'Definitely' to 'Would you wear this again?'",
    evidenceType:          "experience",
    numeratorDefinition:   "Reviews where wouldWearAgain === 'Definitely'",
    denominatorDefinition: "Reviews where wouldWearAgain field was answered (not null/skipped)",
    eligiblePopulation:    "Customers who submitted a post-wear review and answered the wouldWearAgain question",
    periodRule:            "period",
    missingDataRule:       "Show 'No valid responses' when no reviews answered the field",
    minimumEvidenceRule:   "Require at least 3 answered reviews before showing a percentage",
    confidenceRule:        "Use customerEvidenceLabel(uniqueAnsweringReviewers)",
    attributionRule:       null,
    formatter:             "pct",
    isDeprecated:          false,
    deprecationReason:     null,
  },

  buy_intent_rate: {
    metricId:              "buy_intent_rate",
    displayName:           "Buy-Intent Rate",
    legacyNames:           ["buyRate", "Buy Rate", "purchaseConversion (from Buy or Skip)"],
    description:           "Percentage of decided Buy or Skip events where the customer chose 'Buy' — stated intent only, not a confirmed purchase.",
    evidenceType:          "intent",
    numeratorDefinition:   "BuyOrSkipInteraction events where outcome === 'buy'",
    denominatorDefinition: "All decided BuyOrSkipInteraction events (buy + skip; excludes undecided/incomplete)",
    eligiblePopulation:    "Customers who reached a decision in a Buy or Skip session",
    periodRule:            "period",
    missingDataRule:       "Show '— / — events' when no decided events exist",
    minimumEvidenceRule:   "Require at least 5 decided events before showing a percentage",
    confidenceRule:        "Show count and denominator alongside percentage (e.g. '3 of 7 buy-intent events')",
    attributionRule:       null,
    formatter:             "pct",
    isDeprecated:          false,
    deprecationReason:     null,
  },

  love_response_rate: {
    metricId:              "love_response_rate",
    displayName:           "Love Response Rate",
    legacyNames:           ["Recommendation Precision", "Explanation Agreement Rate", "agreementRate"],
    description:           "Percentage of recommendation feedback events where the customer responded 'Love' — from the decided subset only.",
    evidenceType:          "observed_interaction",
    numeratorDefinition:   "RecommendationFeedback events where outcome === 'love'",
    denominatorDefinition: "Decided RF events (love + skip; excludes undecided and incomplete)",
    eligiblePopulation:    "Customers who provided a decided love/skip response to a recommendation",
    periodRule:            "period",
    missingDataRule:       "Show 'Insufficient evidence' when fewer than 5 decided events",
    minimumEvidenceRule:   "At least 5 decided feedback events and at least 2 unique customers",
    confidenceRule:        "Use customerEvidenceLabel(uniqueCustomersWhoDecided)",
    attributionRule:       null,
    formatter:             "pct",
    isDeprecated:          false,
    deprecationReason:     null,
  },

  skip_rate: {
    metricId:              "skip_rate",
    displayName:           "Skip Rate (Decided Feedback Events)",
    legacyNames:           ["False Positive Rate", "fpRatePct", "falsePositiveRate"],
    description:           "Percentage of decided recommendation feedback events where the customer responded 'Skip'. Not equivalent to false positive rate — ground-truth purchase outcome is required for that.",
    evidenceType:          "observed_interaction",
    numeratorDefinition:   "RecommendationFeedback events where outcome === 'skip'",
    denominatorDefinition: "Decided RF events (love + skip; excludes undecided)",
    eligiblePopulation:    "Customers who provided a decided love/skip response to a recommendation",
    periodRule:            "period",
    missingDataRule:       "Show 'Insufficient evidence' when fewer than 5 decided events",
    minimumEvidenceRule:   "At least 5 decided feedback events",
    confidenceRule:        "Show count alongside percentage",
    attributionRule:       null,
    formatter:             "pct",
    isDeprecated:          false,
    deprecationReason:     null,
  },

  undecided_event_rate: {
    metricId:              "undecided_event_rate",
    displayName:           "Undecided Event Rate",
    legacyNames:           ["False Negative Rate", "fnRatePct", "falseNegativeRate"],
    description:           "Percentage of all recommendation feedback events where the customer did not provide a love/skip decision. Not equivalent to false negative rate — ground-truth purchase outcome is required for that measurement.",
    evidenceType:          "observed_interaction",
    numeratorDefinition:   "RecommendationFeedback events where outcome === 'undecided'",
    denominatorDefinition: "All RecommendationFeedback events in the period",
    eligiblePopulation:    "Customers who received a recommendation and had the feedback prompt shown",
    periodRule:            "period",
    missingDataRule:       "Show 'No events' when totalEvaluated === 0",
    minimumEvidenceRule:   "At least 1 event",
    confidenceRule:        "Show raw count only; do not apply ground-truth false-negative language",
    attributionRule:       null,
    formatter:             "pct",
    isDeprecated:          false,
    deprecationReason:     null,
  },

  desired_outcome_success: {
    metricId:              "desired_outcome_success",
    displayName:           "Desired-Outcome Success by Personality",
    legacyNames:           ["Recommendation Trust", "Recommendation Trust by Personality", "feelingAchievedRate"],
    description:           "Percentage of post-wear reviews where the customer reported their desired feeling was achieved, grouped by personality type.",
    evidenceType:          "experience",
    numeratorDefinition:   "PostOutfitReview records where desiredFeelingAchieved === 'Yes'",
    denominatorDefinition: "PostOutfitReview records where desiredFeelingAchieved field was answered (not null)",
    eligiblePopulation:    "Customers who submitted a post-wear review and answered the desiredFeelingAchieved question",
    periodRule:            "period",
    missingDataRule:       "Show '— / — reviews' when no answered reviews exist",
    minimumEvidenceRule:   "At least 3 answered reviews per personality group before showing a percentage",
    confidenceRule:        "Use customerEvidenceLabel(uniqueAnsweringReviewers)",
    attributionRule:       null,
    formatter:             "pct",
    isDeprecated:          false,
    deprecationReason:     null,
  },

  desired_feeling_achievement: {
    metricId:              "desired_feeling_achievement",
    displayName:           "Desired-Feeling Achievement Rate",
    legacyNames:           ["Recommendation Success", "achievedRate", "emotionalAchievementRate"],
    description:           "Percentage of sessions with a recorded desired feeling where the customer reported achieving that feeling in their post-wear review.",
    evidenceType:          "experience",
    numeratorDefinition:   "PostOutfitReview records where desiredFeelingAchieved === 'Yes'",
    denominatorDefinition: "PostOutfitReview records with a non-null desiredFeelingAchieved field",
    eligiblePopulation:    "Customers who both set a desired feeling in session and completed a post-wear review answering the field",
    periodRule:            "all_time",
    missingDataRule:       "Show 'Insufficient evidence' when fewer than 3 answered reviews",
    minimumEvidenceRule:   "At least 3 answered reviews",
    confidenceRule:        "Use customerEvidenceLabel(uniqueReviewers)",
    attributionRule:       null,
    formatter:             "pct",
    isDeprecated:          false,
    deprecationReason:     null,
  },

  opportunity_score: {
    metricId:              "opportunity_score",
    displayName:           "Product Opportunity Score",
    legacyNames:           ["opportunityScore", "score (relationship server)"],
    description:           "Composite 0–100 score summarising product performance on rating, stated rewear intent, and confidence lift.",
    evidenceType:          "model_output",
    numeratorDefinition:   "ratingScore(40%) + rewearScore(35%) + confidenceScore(25%) — volume weighting removed",
    denominatorDefinition: "100 (normalised)",
    eligiblePopulation:    "Products with at least 1 reviewed session",
    periodRule:            "period",
    missingDataRule:       "Omit from ranking when sampleSize = 0",
    minimumEvidenceRule:   "Do not use for ranking decisions — deprecated",
    confidenceRule:        "Not used for decision ranking",
    attributionRule:       null,
    formatter:             "score",
    isDeprecated:          true,
    deprecationReason:     "Volume-based data weighting (dataScore) inflated scores for frequently-seen products regardless of outcome quality. Not used for decisions.",
  },

  collection_health_score: {
    metricId:              "collection_health_score",
    displayName:           "Collection Health Score",
    legacyNames:           ["collectionHealthScore", "score (advanced server)"],
    description:           "Composite 0–100 score summarising collection-level coverage across mood, recommendation, review, DNA, occasion, and evolution dimensions.",
    evidenceType:          "model_output",
    numeratorDefinition:   "Weighted average of 6 component scores",
    denominatorDefinition: "100 (normalised)",
    eligiblePopulation:    "Not applicable — collection-level aggregate",
    periodRule:            "period",
    missingDataRule:       "Show score as 'Not available'",
    minimumEvidenceRule:   "Do not use for decision ranking — deprecated",
    confidenceRule:        "Not used for decision ranking",
    attributionRule:       null,
    formatter:             "score",
    isDeprecated:          true,
    deprecationReason:     "Session volume weight in mood coverage inflated scores from repeat single-customer interactions. Not used for decisions.",
  },

  observed_customer_revenue: {
    metricId:              "observed_customer_revenue",
    displayName:           "Observed Customer Revenue to Date",
    legacyNames:           ["LTV", "avgLtv", "Avg LTV / Customer"],
    description:           "Total attributed revenue from a customer's buy-intent events to date, divided by customers with at least one purchase. This is historical accumulated revenue, not a forward-looking lifetime value model.",
    evidenceType:          "intent",
    numeratorDefinition:   "Sum of revenue from attributed buy-intent events per qualifying customer",
    denominatorDefinition: "Customers with at least one buy-intent event",
    eligiblePopulation:    "Customers who registered at least one 'Buy' outcome in a Buy or Skip session",
    periodRule:            "all_time",
    missingDataRule:       "Show 'No purchase-intent data' when no buy events exist",
    minimumEvidenceRule:   "At least 1 customer with a buy event",
    confidenceRule:        "Label as 'intent-based estimate — not confirmed Shopify orders' in Live Data mode",
    attributionRule:       "Buy-intent events only; Shopify order confirmation awaiting integration",
    formatter:             "aed",
    isDeprecated:          false,
    deprecationReason:     null,
  },

  naia_assisted_revenue: {
    metricId:              "naia_assisted_revenue",
    displayName:           "Observed Revenue from Sessions with nAia Touch",
    legacyNames:           ["nAia-Assisted Revenue", "naiaRevenue", "naiaAssistedRevenue"],
    description:           "Buy-intent revenue from sessions that included a nAia interaction within 7 days before the buy event. Observational — not causal attribution.",
    evidenceType:          "intent",
    numeratorDefinition:   "Sum of prices for products with a 'bought' outcome in Buy or Skip sessions",
    denominatorDefinition: "Not applicable — total, not a rate",
    eligiblePopulation:    "Buy-intent events from sessions with at least one nAia touch in the 7-day window",
    periodRule:            "period",
    missingDataRule:       "Show AED 0 with a note when no buy events",
    minimumEvidenceRule:   "At least 1 buy event",
    confidenceRule:        "Always show 'observational' label — cannot confirm causal attribution",
    attributionRule:       "Any qualifying touch (Style Me, Buy or Skip, Save, VTO) within 7 days before checkout",
    formatter:             "aed",
    isDeprecated:          false,
    deprecationReason:     null,
  },

  naia_vs_non_naia: {
    metricId:              "naia_vs_non_naia",
    displayName:           "Observed Difference vs Non-nAia Cohort",
    legacyNames:           ["nAia Uplift", "naiaVsNonNaiaMultiplier", "Assisted vs Unassisted"],
    description:           "Comparison of buy-intent rate between nAia sessions and an estimated baseline. Non-nAia baseline is an estimate — no tracked unassisted cohort exists yet.",
    evidenceType:          "intent",
    numeratorDefinition:   "naiaConversionRate (buy-intent events / sessions)",
    denominatorDefinition: "nonNaiaConversionRate (estimated — not measured from a real unassisted cohort)",
    eligiblePopulation:    "Sessions with at least one nAia touch (nAia cohort); unassisted cohort not yet tracked",
    periodRule:            "period",
    missingDataRule:       "Show 'Baseline unavailable — estimated' when no unassisted cohort data",
    minimumEvidenceRule:   "Cannot be measured without a tracked unassisted cohort",
    confidenceRule:        "Always label baseline as 'estimated' — ratio is illustrative until real cohort data is available",
    attributionRule:       "Same 7-day any-qualifying-touch rule as naia_assisted_revenue",
    formatter:             "ratio",
    isDeprecated:          false,
    deprecationReason:     null,
  },

  save_to_purchase: {
    metricId:              "save_to_purchase",
    displayName:           "Save-to-Buy-Intent Rate",
    legacyNames:           ["Save vs Purchase", "overallSaveToP", "saveToConvertRate"],
    description:           "Percentage of saved products that subsequently received a 'Buy' outcome in Buy or Skip. Uses saves as the denominator; buy must occur after save.",
    evidenceType:          "intent",
    numeratorDefinition:   "Buy-intent events for a product that was previously saved (buy after save for same product, same customer)",
    denominatorDefinition: "Total save events (period) or all-time saves with a subsequent decision",
    eligiblePopulation:    "Products that were saved and then presented again in Buy or Skip",
    periodRule:            "period_with_all_time_fallback",
    missingDataRule:       "Show 'No saves with subsequent decisions' when count = 0",
    minimumEvidenceRule:   "At least 3 save-to-decision pairs before showing a percentage",
    confidenceRule:        "Show numerator/denominator counts alongside the percentage",
    attributionRule:       null,
    formatter:             "pct",
    isDeprecated:          false,
    deprecationReason:     null,
  },

  experiment_outcome: {
    metricId:              "experiment_outcome",
    displayName:           "Experiment Outcome",
    legacyNames:           ["Hypothesis confirmed", "result.outcome"],
    description:           "The evaluated status of a defined experiment. 'validated' requires minimum sample met, primary metric evaluated, guardrail acceptable, and decision rule satisfied.",
    evidenceType:          "experiment_result",
    numeratorDefinition:   "Depends on experiment primary metric",
    denominatorDefinition: "Depends on experiment primary metric",
    eligiblePopulation:    "Customers in the experiment target segment during the experiment period",
    periodRule:            "all_time",
    missingDataRule:       "Show 'minimum_not_reached' when sampleSize < minimumSampleN",
    minimumEvidenceRule:   "All four conditions must be met for 'validated': minimum sample, primary metric, guardrail, decision rule",
    confidenceRule:        "Status must be one of: planned, active, minimum_not_reached, inconclusive, directional, validated, rejected, stopped",
    attributionRule:       null,
    formatter:             "count",
    isDeprecated:          false,
    deprecationReason:     null,
  },

  ai_learning_precision: {
    metricId:              "ai_learning_precision",
    displayName:           "Love Response Rate",
    legacyNames:           ["Recommendation Precision", "AI precision", "precisionPct"],
    description:           "Percentage of decided recommendation feedback events in the period where the customer responded 'Love'. Does not measure AI model precision — ground-truth purchase outcomes are required for that.",
    evidenceType:          "observed_interaction",
    numeratorDefinition:   "RF events where outcome === 'love' in period",
    denominatorDefinition: "Decided RF events (love + skip) in period",
    eligiblePopulation:    "Customers who provided a decided love/skip response in the period",
    periodRule:            "period",
    missingDataRule:       "Show 'Insufficient evidence — n=0 decided events' when denominator = 0",
    minimumEvidenceRule:   "At least 5 decided events before showing a percentage; show null otherwise",
    confidenceRule:        "Show decided event count; note that this is love rate, not model precision",
    attributionRule:       null,
    formatter:             "pct",
    isDeprecated:          false,
    deprecationReason:     null,
  },

};

export function getMetric(metricId: string): MetricDefinition | undefined {
  return METRIC_REGISTRY[metricId];
}

export function getMetricByLegacyName(legacyName: string): MetricDefinition | undefined {
  return Object.values(METRIC_REGISTRY).find(m => m.legacyNames.includes(legacyName));
}
