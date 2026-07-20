// app/lib/ai/journey-contract.ts
// Phase 4B3 — Unified nAia feature integration contract.
//
// Defines the shared customer journey context: available signals, precedence rules,
// feature availability, and VTO gating. Connects Style Profile, Selfie Analysis,
// Closet, My nAia Model, FASHN VTO, NADINE products, Feedback, and Designer Intelligence.
//
// Side-effect-free: no server imports, no DB queries, no AI calls, no provider calls.
// All functions are pure and deterministic given the same inputs.

import type { ClosetTryOnEligibility } from "./closet-eligibility.js";

// ── Signal precedence ─────────────────────────────────────────────────────────
//
// Explicit customer preferences (OnboardingProfile / Style Passport) always win.
// Selfie signals and feedback signals are always SOFT_RANK — never elevated.
// Missing optional data degrades gracefully; it never breaks StyleMe or other features.

export const SIGNAL_PRECEDENCE = {
  EXPLICIT_PREFERENCE: 100, // OnboardingProfile, Style Passport step answers
  SESSION_ANSWER: 80,       // Current StyleMe session answers (occasion, mood, comfort…)
  SOFT_RANK_FEEDBACK: 40,   // Repeated consistent feedback (≥ 3 same reason = moderate)
  SOFT_RANK_SELFIE: 30,     // Selfie styling guidance — never elevated above SOFT_RANK
  NO_SIGNAL: 0,             // Optional data absent — graceful skip
} as const;

export type SignalPrecedenceLevel = keyof typeof SIGNAL_PRECEDENCE;

// ── Hard constraints on signal behaviour ──────────────────────────────────────

// Selfie signals are ALWAYS soft guidance — never hard filters.
// Explicit customer preferences override selfie signals unconditionally.
export const SELFIE_MAX_BEHAVIOUR = "SOFT_RANK" as const;

// Feedback signals are ALWAYS soft modifiers — one response never becomes a permanent rule.
// Repeated consistent signals accumulate strength; inconsistent signals net to zero.
export const FEEDBACK_MAX_BEHAVIOUR = "SOFT_RANK" as const;

// ── Selfie signal summary ─────────────────────────────────────────────────────

export interface SelfieSignalSummary {
  available: true;
  behaviour: typeof SELFIE_MAX_BEHAVIOUR; // always "SOFT_RANK" — enforced at this boundary
  colourFamilies: string[];
  suggestedNecklines: string[];
  contrastLevel: "low" | "medium" | "high";
  overallNote: string;
}

// ── Closet summary ────────────────────────────────────────────────────────────

export interface ClosetSummary {
  totalItems: number;
  eligibleForTryOn: number;  // tryOnEligibility === "ready-for-try-on"
  pendingAssessment: number; // tryOnEligibility === "pending-assessment"
  notEligible: number;       // "needs-clearer-photo" or "not-supported" or null
  byCategory: {
    clothing: number; // TOPS + BOTTOMS + DRESSES + OUTERWEAR
    shoes: number;
    bags: number;
  };
}

// ── Feedback signal context ───────────────────────────────────────────────────
// Structural patterns only — no raw text, no per-customer data, no free-text notes.

export interface FeedbackSignalContext {
  available: boolean;     // false when migration pending or no feedback yet
  migrationPending: boolean;
  totalFeedback: number;
  // Soft-rank patterns: reason code + count — never includes notes or product-specific data
  activePatterns: Array<{
    reason: string;
    count: number;
    behaviour: typeof FEEDBACK_MAX_BEHAVIOUR; // always "SOFT_RANK"
  }>;
  positivePostWearRate: number | null; // null when < 3 samples (insufficient data)
  postWearMigrationPending: boolean;
}

// ── Feature availability ─────────────────────────────────────────────────────
// Computed from assembled signals. No DB access needed once signals are assembled.

export interface FeatureAvailability {
  canStyleMe: true;                    // always true — StyleMe works without any optional data
  hasClosetItems: boolean;
  hasEligibleClosetItems: boolean;     // at least one "ready-for-try-on" closet item
  hasClosetAssessmentPending: boolean; // at least one "pending-assessment" item
  hasSelfieSignals: boolean;
  naiaModelIsReady: boolean;
  virtualTryOnAvailable: boolean;      // globalEnabled && naiaModelIsReady
  feedbackHistoryAvailable: boolean;   // !migrationPending && totalFeedback > 0
  postWearHistoryAvailable: boolean;   // !postWearMigrationPending && rate !== null
}

// ── VTO gate context ──────────────────────────────────────────────────────────
// Per-entry-point gating. Ineligible items suppress their own CTA; other features unaffected.

export type VtoBlockedReason =
  | "feature-disabled"        // VIRTUAL_TRY_ON_ENABLED === false (global)
  | "no-model"                // customer has no full-body photo or consent
  | "product-not-eligible"    // handle not in eligible product set
  | "closet-item-not-ready";  // closet item not yet "ready-for-try-on"

export interface VtoGateContext {
  globalEnabled: boolean;
  naiaModelReady: boolean;
  productEligible: boolean;
  closetItemReady: boolean | null; // null for non-closet flows
  allowed: boolean;
  blockedReason: VtoBlockedReason | null;
}

// ── Migration status ──────────────────────────────────────────────────────────

export interface MigrationStatus {
  recommendationFeedbackPending: boolean; // Phase 4B1 table
  selfieAnalysisPending: boolean;         // Phase 4A8 table
  postWearColumnsPending: boolean;        // Phase 4B1 new columns on PostOutfitReview
}

// ── Customer journey context ─────────────────────────────────────────────────
// Full assembled context for a single customer at journey time.
// customerId is intentionally absent — callers hold it separately; never embed in context.

export interface CustomerJourneyContext {
  selfieSignals: SelfieSignalSummary | null; // null when no completed selfie analysis
  closetSummary: ClosetSummary;
  feedbackContext: FeedbackSignalContext;
  features: FeatureAvailability;
  migrationStatus: MigrationStatus;
}

// ── Empty/safe defaults ───────────────────────────────────────────────────────

export function emptyClosetSummary(): ClosetSummary {
  return {
    totalItems: 0,
    eligibleForTryOn: 0,
    pendingAssessment: 0,
    notEligible: 0,
    byCategory: { clothing: 0, shoes: 0, bags: 0 },
  };
}

export function emptyFeedbackContext(opts: {
  migrationPending?: boolean;
  postWearMigrationPending?: boolean;
} = {}): FeedbackSignalContext {
  return {
    available: !opts.migrationPending,
    migrationPending: opts.migrationPending ?? false,
    totalFeedback: 0,
    activePatterns: [],
    positivePostWearRate: null,
    postWearMigrationPending: opts.postWearMigrationPending ?? false,
  };
}

export function emptyMigrationStatus(): MigrationStatus {
  return {
    recommendationFeedbackPending: false,
    selfieAnalysisPending: false,
    postWearColumnsPending: false,
  };
}

// ── Pure: aggregateClosetSummary ─────────────────────────────────────────────
// Builds a ClosetSummary from raw closet item records. No DB access.

const CLOTHING_CATEGORIES = new Set(["TOPS", "BOTTOMS", "DRESSES", "OUTERWEAR"]);

export function aggregateClosetSummary(
  items: Array<{ category: string; tryOnEligibility?: string | null }>,
): ClosetSummary {
  let eligibleForTryOn = 0;
  let pendingAssessment = 0;
  let notEligible = 0;
  let clothing = 0;
  let shoes = 0;
  let bags = 0;

  for (const item of items) {
    const cat = item.category.toUpperCase();
    if (CLOTHING_CATEGORIES.has(cat)) clothing++;
    else if (cat === "SHOES") shoes++;
    else if (cat === "BAGS") bags++;

    const elig = item.tryOnEligibility ?? "not-supported";
    if (elig === "ready-for-try-on") eligibleForTryOn++;
    else if (elig === "pending-assessment") pendingAssessment++;
    else notEligible++;
  }

  return {
    totalItems: items.length,
    eligibleForTryOn,
    pendingAssessment,
    notEligible,
    byCategory: { clothing, shoes, bags },
  };
}

// ── Pure: computeFeatureAvailability ─────────────────────────────────────────

export function computeFeatureAvailability(params: {
  closetSummary: ClosetSummary;
  selfieSignals: SelfieSignalSummary | null;
  naiaModelReady: boolean;
  virtualTryOnEnabled: boolean;
  feedbackContext: FeedbackSignalContext;
}): FeatureAvailability {
  return {
    canStyleMe: true,
    hasClosetItems: params.closetSummary.totalItems > 0,
    hasEligibleClosetItems: params.closetSummary.eligibleForTryOn > 0,
    hasClosetAssessmentPending: params.closetSummary.pendingAssessment > 0,
    hasSelfieSignals: params.selfieSignals !== null,
    naiaModelIsReady: params.naiaModelReady,
    virtualTryOnAvailable: params.virtualTryOnEnabled && params.naiaModelReady,
    feedbackHistoryAvailable:
      !params.feedbackContext.migrationPending && params.feedbackContext.totalFeedback > 0,
    postWearHistoryAvailable:
      !params.feedbackContext.postWearMigrationPending &&
      params.feedbackContext.positivePostWearRate !== null,
  };
}

// ── Pure: computeVtoGate ─────────────────────────────────────────────────────
// Evaluated per entry point. An ineligible item suppresses its own CTA only.
// Feature-disabled blocks all CTAs globally.

export function computeVtoGate(params: {
  globalEnabled: boolean;
  naiaModelReady: boolean;
  productEligible: boolean;
  closetItemEligibility?: ClosetTryOnEligibility | null;
}): VtoGateContext {
  const closetItemReady =
    params.closetItemEligibility == null
      ? null
      : params.closetItemEligibility === "ready-for-try-on";

  if (!params.globalEnabled) {
    return {
      globalEnabled: false,
      naiaModelReady: params.naiaModelReady,
      productEligible: params.productEligible,
      closetItemReady,
      allowed: false,
      blockedReason: "feature-disabled",
    };
  }
  if (!params.naiaModelReady) {
    return {
      globalEnabled: true,
      naiaModelReady: false,
      productEligible: params.productEligible,
      closetItemReady,
      allowed: false,
      blockedReason: "no-model",
    };
  }
  if (!params.productEligible) {
    return {
      globalEnabled: true,
      naiaModelReady: true,
      productEligible: false,
      closetItemReady,
      allowed: false,
      blockedReason: "product-not-eligible",
    };
  }
  if (closetItemReady === false) {
    return {
      globalEnabled: true,
      naiaModelReady: true,
      productEligible: true,
      closetItemReady: false,
      allowed: false,
      blockedReason: "closet-item-not-ready",
    };
  }
  return {
    globalEnabled: true,
    naiaModelReady: true,
    productEligible: true,
    closetItemReady,
    allowed: true,
    blockedReason: null,
  };
}

// ── Pure: buildSelfieSignalSummary ───────────────────────────────────────────
// Wraps raw selfie analysis data in the contract's typed envelope.
// Enforces SOFT_RANK behaviour constant at the boundary.

export function buildSelfieSignalSummary(raw: {
  colourFamilies: string[];
  suggestedNecklines: string[];
  contrastLevel: "low" | "medium" | "high";
  overallNote: string;
}): SelfieSignalSummary {
  return {
    available: true,
    behaviour: SELFIE_MAX_BEHAVIOUR, // "SOFT_RANK" — cannot be overridden at this layer
    colourFamilies: raw.colourFamilies,
    suggestedNecklines: raw.suggestedNecklines,
    contrastLevel: raw.contrastLevel,
    overallNote: raw.overallNote,
  };
}

// ── Pure: buildFeedbackSignalContext ─────────────────────────────────────────
// Assembles FeedbackSignalContext from raw feedback records.
// All patterns carry SOFT_RANK — enforced at this boundary.

export function buildFeedbackSignalContext(params: {
  records: Array<{ rating: string; reasonCodes: string[] }>;
  positivePostWearRate: number | null;
  migrationPending: boolean;
  postWearMigrationPending: boolean;
}): FeedbackSignalContext {
  if (params.migrationPending) {
    return emptyFeedbackContext({
      migrationPending: true,
      postWearMigrationPending: params.postWearMigrationPending,
    });
  }

  // Count reason codes across all records
  const reasonCounts = new Map<string, number>();
  for (const rec of params.records) {
    for (const code of rec.reasonCodes) {
      reasonCounts.set(code, (reasonCounts.get(code) ?? 0) + 1);
    }
  }

  // Sort by count descending; only include reasons with ≥ 2 occurrences
  const activePatterns = [...reasonCounts.entries()]
    .filter(([, count]) => count >= 2)
    .sort(([, a], [, b]) => b - a)
    .map(([reason, count]) => ({
      reason,
      count,
      behaviour: FEEDBACK_MAX_BEHAVIOUR,
    }));

  return {
    available: true,
    migrationPending: false,
    totalFeedback: params.records.length,
    activePatterns,
    positivePostWearRate: params.positivePostWearRate,
    postWearMigrationPending: params.postWearMigrationPending,
  };
}

// ── Designer Intelligence event boundary ─────────────────────────────────────
// Journey-level events that Designer Intelligence may consume.
// Privacy rules enforced at assembly time — no PII, no raw text, no photos/URLs.

export type JourneyEventType =
  | "session_started"
  | "recommendation_served"
  | "feedback_given"
  | "vto_initiated"
  | "vto_feedback_given"
  | "post_wear_submitted"
  | "product_intelligence_viewed";

export interface JourneyEvent {
  type: JourneyEventType;
  occurredAt: string;        // ISO 8601
  customerIdHash: string;    // SHA-256 prefix — never the raw customerId
  sessionId: string;
  payload: Record<string, unknown>; // no PII, no URLs, no photos, no free text
}
