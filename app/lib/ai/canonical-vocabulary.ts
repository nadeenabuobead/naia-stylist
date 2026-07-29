// app/lib/ai/canonical-vocabulary.ts
// Single source of truth for terminology, evidence maturity, and action taxonomy.
// Every metric label, badge, and narrative must use these definitions.
// Never define a confidence tier or action type anywhere else in the dashboard.

// ── Evidence maturity ladder ───────────────────────────────────────────────────
// n = observations supporting the specific claim (not total dashboard sessions).

export type EvidenceLabel =
  | "Not measured"
  | "Single observation"
  | "Directional signal"
  | "Emerging pattern"
  | "Established pattern"
  | "Strong pattern";

export function evidenceLabel(n: number): EvidenceLabel {
  if (n === 0) return "Not measured";
  if (n === 1) return "Single observation";
  if (n <= 4)  return "Directional signal";
  if (n <= 9)  return "Emerging pattern";
  if (n <= 19) return "Established pattern";
  return "Strong pattern";
}

export function evidenceLabelToStatusKey(label: EvidenceLabel): string {
  switch (label) {
    case "Not measured":        return "not-implemented";
    case "Single observation":  return "insufficient-data";
    case "Directional signal":  return "insufficient-data";
    case "Emerging pattern":    return "experimental";
    case "Established pattern": return "live";
    case "Strong pattern":      return "live";
  }
}

export function evidenceLabelToColor(label: EvidenceLabel): string {
  switch (label) {
    case "Not measured":        return "#9CA3AF";
    case "Single observation":  return "#6b4800";
    case "Directional signal":  return "#6b4800";
    case "Emerging pattern":    return "#5c5350";
    case "Established pattern": return "#2a5e42";
    case "Strong pattern":      return "#2a5e42";
  }
}

// Legacy alias — preserved for tests that import evidenceConfidence.
// New code must use evidenceLabel(). This function is intentionally identical
// in thresholds; only the label strings differ.
export function legacyEvidenceConfidence(n: number): string {
  if (n === 0) return "No Data";
  if (n === 1) return "Single Observation";
  if (n <= 4)  return "Early Signal";
  if (n <= 9)  return "Emerging Pattern";
  if (n <= 19) return "Established Pattern";
  return "Strong Pattern";
}

// ── Action taxonomy ────────────────────────────────────────────────────────────
// Canonical set for the Founder–Designer Action Plan. Nothing else is valid.

export type ActionType = "Scale" | "Fix" | "Test" | "Build";

export const ACTION_DEFINITIONS: Record<ActionType, string> = {
  Scale: "Increase what is already working",
  Fix:   "Resolve a product or customer problem",
  Test:  "Validate a hypothesis with a time-bound experiment",
  Build: "Create a missing capability or integration",
};

export const ACTION_COLORS: Record<ActionType, string> = {
  Scale: "#2a5e42",
  Fix:   "#8b2035",
  Test:  "#6b4800",
  Build: "#5c5350",
};

// ── Decision status ────────────────────────────────────────────────────────────
export type DecisionStatus = "New" | "Reviewing" | "Testing" | "Adopted" | "Dismissed";

// ── Customer identity — canonical definitions ──────────────────────────────────
// "profile" and "completed Passport" must never be used interchangeably
// unless they are technically the same database entity.
export const CUSTOMER_IDENTITY = {
  registeredUser:     "A customer with a nAia account (email confirmed).",
  passportStarted:    "A registered customer who began but did not complete the nAia Passport.",
  passportCompleted:  "A registered customer who completed all required Passport questions.",
  activeCustomer:     "A customer with at least one completed styling session in the period.",
  purchasingCustomer: "A customer with at least one attributed completed Shopify order.",
} as const;

// ── Purchase and intent vocabulary ─────────────────────────────────────────────
export const PURCHASE_VOCAB = {
  buyIntent:            "A 'Buy' outcome from the Buy or Skip feature — stated intent, not a purchase.",
  save:                 "A 'Save' outcome from Buy or Skip — saved for later, not a purchase.",
  purchase:             "An attributed completed Shopify order.",
  purchaseConversion:   "Completed purchases ÷ eligible population (defined per metric).",
  naiaAssistedPurchase: "A purchase linked to prior nAia interaction within the attribution window.",
  naiaAssistedRevenue:  "Revenue from nAia-assisted purchases.",
} as const;

// ── Wear vocabulary ────────────────────────────────────────────────────────────
// "rewear" is ambiguous; use the canonical terms below.
export const WEAR_VOCAB = {
  wouldWearAgain:    "Stated intent in a post-wear review: 'Yes, I would wear this again.'",
  reportedRepeatWear:"Customer reports wearing the item again in a post-wear review.",
  repeatPurchase:    "Additional completed Shopify order for the same product.",
} as const;

// ── Missing data display values ────────────────────────────────────────────────
// Use these constants; never render missing data as 0%.
export const MISSING = {
  dash:                "—",
  notMeasured:         "Not measured",
  noValidResponses:    "No valid responses",
  insufficientEvidence:"Insufficient evidence",
  awaitingIntegration: "Awaiting live integration",
  singleObservation:   "Single observation",
} as const;

// ── Attribution rule — nAia-assisted revenue ───────────────────────────────────
export const ATTRIBUTION_RULE = {
  window:     "7 days",
  touchTypes: [
    "Style Me session",
    "Buy or Skip interaction",
    "Save",
    "VTO session",
  ],
  method: "Any qualifying touch within 7 days before checkout",
  type:   "observational" as const,
  label:  "7-day any-qualifying-touch · observational",
} as const;

// ── Impact levels ──────────────────────────────────────────────────────────────
export type ImpactLevel = "High" | "Medium" | "Low";

// ── Confidence terms — distinct from one another ───────────────────────────────
// These must never be conflated. Each is a different concept.
export const CONFIDENCE_GLOSSARY = {
  evidenceMaturity:       "How much data supports this specific claim (the evidence ladder above).",
  modelConfidence:        "The recommendation model's internal certainty score for a specific match.",
  recommendationMatchScore:"A score indicating how well a product matches a customer's style profile.",
  statisticalConfidence:  "Statistical certainty for a hypothesis (requires a defined experiment).",
  customerConfidenceLift: "Change in a customer's self-reported confidence score (before/after, 1–10 scale).",
  founderPriority:        "The founder's working priority assessment for a given action.",
} as const;

// ── Canonical evidence types ───────────────────────────────────────────────────
// Every metric must declare its primary evidence type.
export type EvidenceType =
  | "declared_preference"   // Explicit answer from customer (Passport, onboarding)
  | "observed_interaction"  // System-recorded behaviour (click, session, skip, love)
  | "intent"                // Stated intention without confirmed outcome (buy intent, save)
  | "transaction"           // Confirmed completed Shopify order or payment
  | "experience"            // Self-reported post-experience (post-wear review field)
  | "verified_wear"         // Confirmed physical wear event with outcome
  | "product_metadata"      // Product catalogue attributes (category, price, fabric)
  | "model_output"          // AI/model-generated score or label
  | "experiment_result";    // Outcome from a defined experiment with a decision rule

export const EVIDENCE_TYPE_LABELS: Record<EvidenceType, string> = {
  declared_preference:  "Declared preference",
  observed_interaction: "Observed interaction",
  intent:               "Intent (unconfirmed)",
  transaction:          "Confirmed transaction",
  experience:           "Self-reported experience",
  verified_wear:        "Verified wear event",
  product_metadata:     "Product metadata",
  model_output:         "Model output",
  experiment_result:    "Experiment result",
};

// ── Canonical measurement states ───────────────────────────────────────────────
// Replace all free-form status strings with these six states.
// Never render a metric with a state outside this set.
export type MeasurementState =
  | "awaiting_integration"      // Data source not yet connected — cannot compute
  | "no_eligible_observations"  // Connected, zero events in period for eligible population
  | "observed_zero"             // Metric computed and result is genuinely zero
  | "insufficient_evidence"     // Some data exists but below minimum threshold
  | "measured"                  // Metric computed with sufficient evidence
  | "not_applicable";           // Metric definition does not apply to this context

export const MEASUREMENT_STATE_LABELS: Record<MeasurementState, string> = {
  awaiting_integration:     "Awaiting Integration",
  no_eligible_observations: "No Observations",
  observed_zero:            "Observed Zero",
  insufficient_evidence:    "Insufficient Evidence",
  measured:                 "Measured",
  not_applicable:           "Not Applicable",
};

export function measurementStateToStatusKey(state: MeasurementState): string {
  switch (state) {
    case "awaiting_integration":     return "not-implemented";
    case "no_eligible_observations": return "insufficient-data";
    case "observed_zero":            return "live";
    case "insufficient_evidence":    return "insufficient-data";
    case "measured":                 return "live";
    case "not_applicable":           return "not-implemented";
  }
}

// ── Customer-based evidence ladder ────────────────────────────────────────────
// n = unique customers (not raw events).
// Use this for all metrics where the claim is about customer behaviour.
// Use evidenceLabel() for raw event counts only when unique customers are unavailable.
export type CustomerEvidenceLabel =
  | "Not measured"
  | "Single observation"
  | "Early signal"
  | "Directional"
  | "Established"
  | "Strong";

export function customerEvidenceLabel(uniqueCustomers: number): CustomerEvidenceLabel {
  if (uniqueCustomers === 0) return "Not measured";
  if (uniqueCustomers === 1) return "Single observation";
  if (uniqueCustomers <= 9)  return "Early signal";
  if (uniqueCustomers <= 29) return "Directional";
  if (uniqueCustomers <= 59) return "Established";
  return "Strong";
}

export function isSmallSample(uniqueCustomers: number): boolean {
  return uniqueCustomers < 20;
}

// ── Low-evidence language policy ──────────────────────────────────────────────
// For metrics with fewer than 20 unique customers:
//   - Lead with counts ("4 of 9 customers"), show % secondary
//   - Never use prohibited language
// For metrics with 20+ unique customers, replicated across periods: stronger language allowed.
export const LOW_EVIDENCE_LANGUAGE = {
  allowed: [
    "Explore", "Investigate", "Run a low-cost test",
    "Collect more evidence", "Directional signal", "Early indication",
    "Possible friction", "Candidate hypothesis", "Consider", "Worth monitoring",
  ],
  prohibited: [
    "Scale", "Hero product", "Anchor campaign", "Hypothesis confirmed",
    "Customers commit", "Strong pattern", "Proven", "Best-performing",
    "Expand production", "Discontinue", "Winner", "Strongest",
    "Convert",  // for intent-only signals without confirmed purchase
  ],
} as const;

// ── Deprecated composite scores ────────────────────────────────────────────────
// These scores must not be used for decision ranking.
// Underlying component metrics remain available; only the composite is deprecated.
export const DEPRECATED_COMPOSITE_SCORES = new Set([
  "opportunityScore",
  "collectionHealthScore",
  "directionalProductOpportunityScore",
]);

export const DEPRECATED_SCORE_REASON: Record<string, string> = {
  opportunityScore:
    "Volume-based data weighting inflated scores for frequently-seen products regardless of outcome quality. Not used for decisions.",
  collectionHealthScore:
    "Session volume weight in mood coverage inflated scores from repeat single-customer interactions. Not used for decisions.",
  directionalProductOpportunityScore:
    "Two implementations with different weight normalisation; composite is unreliable. Not used for decisions.",
};

// ── Experiment status vocabulary ───────────────────────────────────────────────
// The only valid experiment outcome strings. "Hypothesis confirmed" is not valid.
// Use "validated" only when all four conditions are met (see below).
export type ExperimentStatus =
  | "planned"
  | "active"
  | "minimum_not_reached"
  | "inconclusive"
  | "directional"
  | "validated"     // minimum sample met + primary metric evaluated + guardrail acceptable + decision rule satisfied
  | "rejected"
  | "stopped";

// ── Canonical metric renames ───────────────────────────────────────────────────
// Old label → canonical label. Used in display and in audit trail.
export const CANONICAL_METRIC_NAMES: Record<string, string> = {
  "Rewear Rate":                        "Stated Rewear Intent",
  "Buy Rate":                           "Buy-Intent Rate",
  "Recommendation Precision":           "Love Response Rate",
  "Recommendation Trust":               "Desired-Outcome Success by Personality",
  "Explanation Agreement Rate":         "Love Response Rate (by personality)",
  "Gross Margin AED":                   "Gross Profit (AED)",
  "LTV":                                "Observed Customer Revenue to Date",
  "nAia Uplift":                        "Observed Difference vs Non-nAia Cohort",
  "False Positive Rate":                "Skip Rate (Decided Feedback Events)",
  "False Negative Rate":                "Undecided Event Rate",
  "Recommendation Success":             "Desired-Feeling Achievement Rate",
};
