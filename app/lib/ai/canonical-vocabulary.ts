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
