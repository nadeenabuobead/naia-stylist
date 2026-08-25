// app/lib/ai/feedback-signal.server.ts
// Phase 4B1 — Feedback learning rules and signal aggregation.
//
// Learning contract (SOFT_RANK only — must never be violated):
//   - No single feedback response ever becomes a HARD_FILTER
//   - Explicit customer preferences (OnboardingProfile) always take precedence
//   - Inconsistent answers (love + not-for-me for same attribute) → net zero
//   - One response = weak; repeated consistent responses accumulate strength
//   - VTO "garment-looks-inaccurate" is a fidelity concern, NOT a fit/style objection
//   - "already-own-similar" is a wardrobe gap signal, not a style rejection
//   - No emotional or psychological diagnoses are made from feedback

import type {
  RecommendationFeedbackRecord,
  PostWearAnswers,
  FeedbackSignal,
  FeedbackSignalSummary,
  FeedbackReason,
  SignalStrength,
} from "./feedback-contract.js";
import {
  FEEDBACK_REASONS,
  VTO_FEEDBACK_ASPECTS,
  FEEDBACK_THRESHOLD_MODERATE,
  FEEDBACK_THRESHOLD_STRONG,
} from "./feedback-contract.js";

// ── Validation ────────────────────────────────────────────────────────────────

const VALID_RATINGS  = new Set(["love", "okay", "not-for-me"]);
const VALID_TARGETS  = new Set(["complete-suggestion", "closet-item", "nadine-product", "vto-preview"]);
const VALID_REASONS  = new Set<string>(FEEDBACK_REASONS);
const VALID_VTO      = new Set<string>(VTO_FEEDBACK_ASPECTS);

export function isValidRating(v: unknown): v is "love" | "okay" | "not-for-me" {
  return typeof v === "string" && VALID_RATINGS.has(v);
}

export function isValidTarget(v: unknown): v is RecommendationFeedbackRecord["target"] {
  return typeof v === "string" && VALID_TARGETS.has(v);
}

export function sanitiseReasonCodes(raw: unknown): FeedbackReason[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((r): r is FeedbackReason => typeof r === "string" && VALID_REASONS.has(r));
}

export function sanitiseVtoAspects(raw: unknown): RecommendationFeedbackRecord["vtoAspects"] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is RecommendationFeedbackRecord["vtoAspects"][number] =>
    typeof v === "string" && VALID_VTO.has(v)
  );
}

// ── Signal strength ───────────────────────────────────────────────────────────

export function signalStrengthFromCount(count: number): SignalStrength {
  if (count <= 0) return "none";
  if (count < FEEDBACK_THRESHOLD_MODERATE) return "weak";
  if (count < FEEDBACK_THRESHOLD_STRONG)   return "moderate";
  return "strong";
}

// ── Reason-code frequency table ───────────────────────────────────────────────
//
// Only counts reason codes from non-love feedback.
// Love feedback contributes to loveCount but not to reason signals.

export function countReasonCodes(
  feedback: RecommendationFeedbackRecord[],
): Map<FeedbackReason, number> {
  const counts = new Map<FeedbackReason, number>();
  for (const record of feedback) {
    if (record.rating === "love") continue;
    for (const reason of record.reasonCodes) {
      if (VALID_REASONS.has(reason)) {
        counts.set(reason, (counts.get(reason) ?? 0) + 1);
      }
    }
  }
  return counts;
}

// ── Active signals (sorted by count) ─────────────────────────────────────────

export function buildFeedbackSignals(
  reasonCounts: Map<FeedbackReason, number>,
): FeedbackSignal[] {
  const signals: FeedbackSignal[] = [];
  for (const [reason, count] of reasonCounts) {
    if (count > 0) {
      signals.push({ reason, count, strength: signalStrengthFromCount(count) });
    }
  }
  return signals.sort((a, b) => b.count - a.count);
}

// ── Post-wear helpers ─────────────────────────────────────────────────────────

function countPostWearNegative(
  reviews: PostWearAnswers[],
  field: keyof PostWearAnswers,
  negativeValue: string,
): number {
  return reviews.filter(r => r[field] === negativeValue).length;
}

// ── computeFeedbackSummary ────────────────────────────────────────────────────
//
// Pure function — accepts pre-loaded records, returns the FeedbackSignalSummary.
// No DB calls. Used by:
//   - Future Designer Intelligence dashboard (Phase 4B2)
//   - Future StyleMe signal injection layer

export function computeFeedbackSummary(
  customerId: string,
  feedback: RecommendationFeedbackRecord[],
  postWearReviews: PostWearAnswers[],
  nowFn: () => string = () => new Date().toISOString(),
): FeedbackSignalSummary {
  // Exclude outfit-level feedback from product/item signal aggregate.
  // complete-suggestion records are persisted for future outfit-learning design
  // but must not silently inflate loveCount/notForMeCount/reasonCounts here.
  const productFeedback = feedback.filter(f => f.target !== "complete-suggestion");

  const loveCount     = productFeedback.filter(f => f.rating === "love").length;
  const okayCount     = productFeedback.filter(f => f.rating === "okay").length;
  const notForMeCount = productFeedback.filter(f => f.rating === "not-for-me").length;

  const reasonCounts  = countReasonCodes(productFeedback);
  const activeSignals = buildFeedbackSignals(reasonCounts);

  const tooRevealingSignal = signalStrengthFromCount(reasonCounts.get("too-revealing")  ?? 0);
  const tooCoveredSignal   = signalStrengthFromCount(reasonCounts.get("too-covered")    ?? 0);
  const tooFormalSignal    = signalStrengthFromCount(reasonCounts.get("too-formal")     ?? 0);
  const tooCasualSignal    = signalStrengthFromCount(reasonCounts.get("too-casual")     ?? 0);

  // Post-wear signals
  const wornReviews      = postWearReviews.filter(r => r.didWearIt === "yes");
  const wearThroughCount = wornReviews.length;

  let positivePostWearRate: number | null = null;
  if (wearThroughCount >= 3) {
    const positive = wornReviews.filter(r =>
      r.howDidYouFeel === "great" || r.howDidYouFeel === "good"
    ).length;
    positivePostWearRate = Math.round((positive / wearThroughCount) * 100) / 100;
  }

  const comfortIssueCount  = countPostWearNegative(postWearReviews, "wasComfortable", "no");
  const coverageIssueCount = countPostWearNegative(postWearReviews, "coverageRight",  "no");
  const colourIssueCount   = countPostWearNegative(postWearReviews, "colourRight",    "no");

  // VTO — fidelity signals only (not physical fit accuracy)
  const VTO_INACCURACY_ASPECTS = new Set<string>([
    "garment-looks-inaccurate",
    "layering-looks-inaccurate",
    "colour-looks-inaccurate",
    "accessory-placement-inaccurate",
  ]);
  const vtoFeedback           = feedback.filter(f => f.target === "vto-preview");
  const vtoPreviewUsefulCount = vtoFeedback.filter(f => f.vtoAspects.includes("preview-useful")).length;
  const vtoAccurateCount      = vtoFeedback.filter(f => f.vtoAspects.includes("garment-looks-accurate")).length;
  const vtoFidelityConcerns   = vtoFeedback.filter(f =>
    f.vtoAspects.some(a => VTO_INACCURACY_ASPECTS.has(a)),
  ).length;

  const alreadyOwnSimilarCount = reasonCounts.get("already-own-similar") ?? 0;

  const lovedNadineProductIds = feedback
    .filter(f => f.rating === "love" && f.target === "nadine-product" && f.shopifyProductId !== null)
    .map(f => f.shopifyProductId as string);

  return {
    customerId,
    computedAt: nowFn(),
    totalFeedbackCount: feedback.length,
    loveCount,
    okayCount,
    notForMeCount,
    activeSignals,
    frequentlyRejectedStyles:  [],
    frequentlyRejectedColours: [],
    tooRevealingSignal,
    tooCoveredSignal,
    tooFormalSignal,
    tooCasualSignal,
    wearThroughCount,
    positivePostWearRate,
    comfortIssueSignal:          signalStrengthFromCount(comfortIssueCount),
    coverageIssuePostWearSignal: signalStrengthFromCount(coverageIssueCount),
    colourIssuePostWearSignal:   signalStrengthFromCount(colourIssueCount),
    vtoPreviewUsefulCount,
    vtoGarmentAccurateCount:     vtoAccurateCount,
    vtoFidelityConcernCount:     vtoFidelityConcerns,
    alreadyOwnSimilarCount,
    lovedNadineProductIds,
  };
}
