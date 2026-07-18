// app/lib/ai/feedback-contract.ts
// Phase 4B1 — Feedback and Learning types.
// Side-effect-free: no imports, no DB queries, no provider calls.

// ── Immediate recommendation feedback ─────────────────────────────────────────

export type FeedbackRating = "love" | "okay" | "not-for-me";

// Reason codes — any unknown code is silently dropped at the server layer
export const FEEDBACK_REASONS = [
  "not-my-style",
  "colour-not-for-me",
  "fit-shape-not-for-me",
  "too-revealing",
  "too-covered",
  "too-formal",
  "too-casual",
  "not-practical",
  "already-own-similar",
  "too-expensive",
  "other",
] as const;
export type FeedbackReason = (typeof FEEDBACK_REASONS)[number];

// What the feedback was given on
export type FeedbackTarget =
  | "complete-suggestion"  // entire outfit suggestion
  | "closet-item"          // specific closet piece StyleMe selected
  | "nadine-product"       // NADINE product recommendation
  | "vto-preview";         // virtual try-on preview

// VTO-specific aspects
// Covers preview usefulness and garment fidelity ONLY.
// VTO previews cannot assess physical fit accuracy — that is not a VTO feedback concern.
export const VTO_FEEDBACK_ASPECTS = [
  "preview-useful",
  "preview-not-useful",
  "garment-looks-accurate",
  "garment-looks-inaccurate",
  "layering-looks-inaccurate",
  "colour-looks-inaccurate",
  "accessory-placement-inaccurate",
  "useful-despite-differences",
  "would-try-in-person",
  "would-not-try-in-person",
] as const;
export type VtoFeedbackAspect = (typeof VTO_FEEDBACK_ASPECTS)[number];

// ── Post-wear review answers ──────────────────────────────────────────────────

export type WoreItAnswer  = "yes" | "not-yet" | "no";
export type FeelingAnswer = "great" | "good" | "okay" | "not-great";
export type ComfortAnswer = "yes" | "mostly" | "no";
export type WearAgainAnswer = "definitely" | "maybe" | "probably-not";

export interface PostWearAnswers {
  didWearIt:     WoreItAnswer   | null;
  howDidYouFeel: FeelingAnswer  | null;
  wasComfortable: ComfortAnswer | null;
  fitRight:      ComfortAnswer  | null;
  coverageRight: ComfortAnswer  | null;
  colourRight:   ComfortAnswer  | null;
  wouldWearAgain: WearAgainAnswer | null;
  note: string | null;
}

// ── DB-mirror record types ─────────────────────────────────────────────────────

export interface RecommendationFeedbackRecord {
  id: string;
  customerId: string;
  sessionId: string | null;
  suggestionId: string | null;
  target: FeedbackTarget;
  shopifyProductId: string | null;
  closetItemId: string | null;
  rating: FeedbackRating;
  reasonCodes: FeedbackReason[];
  vtoAspects: VtoFeedbackAspect[];
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Learning rules constants ──────────────────────────────────────────────────
//
// Signal contract (carry forward across all code):
//   - All signals are SOFT_RANK — they strengthen or weaken future ranking only
//   - No single feedback response ever becomes a HARD_FILTER
//   - Explicit customer preferences (OnboardingProfile) always override feedback signals
//   - Inconsistent feedback (love + not-for-me for same attribute) nets to zero
//   - Repeated consistent feedback (same reason code) accumulates signal strength
//   - VTO "garment-looks-inaccurate" = fidelity concern only, not fit/style objection
//   - "already-own-similar" = wardrobe gap signal, not style rejection
//   - No emotional or psychological diagnoses are ever made from feedback data

export const FEEDBACK_THRESHOLD_MODERATE = 3; // ≥ 3 same reason → moderate signal
export const FEEDBACK_THRESHOLD_STRONG   = 5; // ≥ 5 same reason → strong signal

export type SignalStrength = "none" | "weak" | "moderate" | "strong";

export interface FeedbackSignal {
  reason: FeedbackReason;
  count: number;
  strength: SignalStrength;
}

// ── Designer Intelligence boundary contract ───────────────────────────────────
//
// Aggregated signal summary for future Designer Intelligence (Phase 4B2).
// Not persisted — computed on demand from existing feedback records.
// Phase 4B2 will wire this to the dashboard; Phase 4B1 defines the shape.

export interface FeedbackSignalSummary {
  customerId: string;
  computedAt: string;
  totalFeedbackCount: number;

  // Rating distribution
  loveCount: number;
  okayCount: number;
  notForMeCount: number;

  // SOFT_RANK signals — active reasons, sorted by count descending
  activeSignals: FeedbackSignal[];

  // Attribute patterns — Phase 4B2 will enrich these from item metadata
  frequentlyRejectedStyles:  string[];
  frequentlyRejectedColours: string[];

  // Coverage and formality patterns
  tooRevealingSignal: SignalStrength;
  tooCoveredSignal:   SignalStrength;
  tooFormalSignal:    SignalStrength;
  tooCasualSignal:    SignalStrength;

  // Post-wear signals
  wearThroughCount:    number;          // times customer wore the outfit
  positivePostWearRate: number | null;  // null when < 3 samples (insufficient data)
  comfortIssueSignal:           SignalStrength;
  coverageIssuePostWearSignal:  SignalStrength;
  colourIssuePostWearSignal:    SignalStrength;

  // VTO fidelity signals (not fit accuracy — VTO previews cannot assess real fit)
  vtoPreviewUsefulCount:   number;
  vtoGarmentAccurateCount: number;
  vtoFidelityConcernCount: number;

  // Wardrobe gap indicator
  alreadyOwnSimilarCount: number;  // repeated "already own similar" signals a gap in unique pieces

  // Products loved but not purchased (for Phase 4B2 buyer/marketer view)
  lovedNadineProductIds: string[];
}
