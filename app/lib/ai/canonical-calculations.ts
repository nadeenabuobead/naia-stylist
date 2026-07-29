// app/lib/ai/canonical-calculations.ts
// Canonical computation functions for every dashboard metric.
// All dashboard sections must call these functions; no inline reimplementations.

import type { MeasurementState, CustomerEvidenceLabel, EvidenceObject } from "./canonical-vocabulary";
import { customerEvidenceLabel, languagePermission } from "./canonical-vocabulary";

// ── Shared event-shape ─────────────────────────────────────────────────────────
interface MetricEvent {
  customerId: string;
  outcome?: string | null;
  rewear?: boolean | null;
  actualAfterFeeling?: string | null;
  desiredFeeling?: string | null;
  productName?: string | null;
  daysAgo?: number;
}

// ── Metric result shape ────────────────────────────────────────────────────────
export interface MetricResult {
  value:       number | null;
  numerator:   number;
  denominator: number;
  state:       MeasurementState;
  evidence:    EvidenceObject;
}

function getState(numerator: number, denominator: number, minEligible = 3): MeasurementState {
  if (denominator === 0)                      return "no_eligible_observations";
  if (numerator === 0)                         return "observed_zero";
  if (denominator < minEligible)               return "insufficient_evidence";
  return "measured";
}

function pct(n: number, d: number): number {
  return Math.round((n / d) * 100);
}

function buildEvidence(
  events: MetricEvent[],
  period: string,
  eligibleCount?: number,
  unansweredCount = 0,
): EvidenceObject {
  const unique = new Set(events.map(e => e.customerId)).size;
  const total  = events.length;
  const maxFromOne = unique > 0
    ? Math.max(...[...new Set(events.map(e => e.customerId))].map(
        cid => events.filter(e => e.customerId === cid).length
      ))
    : 0;
  const concentration = total > 0 ? Math.round((maxFromOne / total) * 100) / 100 : 0;
  const eligible      = eligibleCount ?? total;
  const state: MeasurementState =
    total === 0       ? "no_eligible_observations"
    : eligible < 3    ? "insufficient_evidence"
    : "measured";
  return {
    uniqueCustomerCount:      unique,
    eventCount:               total,
    eligibleObservationCount: eligible,
    unansweredCount,
    customerConcentration:    concentration,
    period,
    evidenceState:            state,
    confidenceLevel:          customerEvidenceLabel(unique) as CustomerEvidenceLabel,
  };
}

// ── Love Response Rate (canonical: metricId = ai_learning_precision) ───────────
// Numerator: RF events where outcome === "love"
// Denominator: decided RF events (love + skip only — undecided excluded)
export function calcLoveResponseRate(feedbackEvents: MetricEvent[], period: string): MetricResult {
  const decided   = feedbackEvents.filter(e => e.outcome === "love" || e.outcome === "skip");
  const loves     = decided.filter(e => e.outcome === "love");
  const denom     = decided.length;
  const numer     = loves.length;
  const state     = getState(numer, denom, 5);
  const value     = denom > 0 ? pct(numer, denom) : null;
  return { value, numerator: numer, denominator: denom, state, evidence: buildEvidence(decided, period, denom) };
}

// ── Skip Rate / Decided Feedback (canonical: metricId = skip_rate) ─────────────
// Numerator: RF events where outcome === "skip"
// Denominator: decided RF events (love + skip only)
export function calcSkipRate(feedbackEvents: MetricEvent[], period: string): MetricResult {
  const decided   = feedbackEvents.filter(e => e.outcome === "love" || e.outcome === "skip");
  const skips     = decided.filter(e => e.outcome === "skip");
  const denom     = decided.length;
  const numer     = skips.length;
  const state     = getState(numer, denom, 5);
  const value     = denom > 0 ? pct(numer, denom) : null;
  return { value, numerator: numer, denominator: denom, state, evidence: buildEvidence(decided, period, denom) };
}

// ── Undecided Event Rate (canonical: metricId = undecided_event_rate) ──────────
// Numerator: RF events where outcome === "undecided"
// Denominator: all RF events (love + skip + undecided)
export function calcUndecidedEventRate(feedbackEvents: MetricEvent[], period: string): MetricResult {
  const all        = feedbackEvents;
  const undecided  = all.filter(e => e.outcome === "undecided");
  const denom      = all.length;
  const numer      = undecided.length;
  const state      = getState(numer, denom, 5);
  const value      = denom > 0 ? pct(numer, denom) : null;
  return { value, numerator: numer, denominator: denom, state, evidence: buildEvidence(all, period, denom) };
}

// ── Stated Rewear Intent (canonical: metricId = stated_rewear_intent) ──────────
// Numerator: WR events where rewear === true
// Denominator: WR events with an explicit rewear answer (rewear === true or false — not null)
export function calcStatedRewearIntent(wrEvents: MetricEvent[], period: string): MetricResult {
  const answered = wrEvents.filter(e => e.rewear === true || e.rewear === false);
  const rewear   = answered.filter(e => e.rewear === true);
  const denom    = answered.length;
  const numer    = rewear.length;
  const state    = getState(numer, denom, 3);
  const value    = denom > 0 ? pct(numer, denom) : null;
  const unanswered = wrEvents.length - answered.length;
  return {
    value, numerator: numer, denominator: denom, state,
    evidence: buildEvidence(answered, period, denom, unanswered),
  };
}

// ── Desired-Feeling Achievement Rate (canonical: metricId = desired_feeling_achievement) ─
// Numerator: WR events where actualAfterFeeling is non-null (feeling confirmed)
// Denominator: WR events with an explicit desired-outcome response
// NEVER falls back to loveRate × any multiplier — proxy removed permanently.
export function calcDesiredFeelingAchievement(
  wrEvents: MetricEvent[],
  period: string,
): MetricResult & { unansweredCount: number; noEligibleWrEvents: boolean } {
  if (wrEvents.length === 0) {
    const emptyEvidence: EvidenceObject = {
      uniqueCustomerCount: 0, eventCount: 0, eligibleObservationCount: 0,
      unansweredCount: 0, customerConcentration: 0, period,
      evidenceState: "no_eligible_observations", confidenceLevel: "Not measured",
    };
    return { value: null, numerator: 0, denominator: 0, state: "no_eligible_observations", evidence: emptyEvidence, unansweredCount: 0, noEligibleWrEvents: true };
  }
  // Eligible: WR events where the desired-outcome field was answered
  const eligible   = wrEvents.filter(e => e.actualAfterFeeling != null);
  const achieved   = eligible.filter(e => e.actualAfterFeeling === e.desiredFeeling);
  const unanswered = wrEvents.length - eligible.length;
  const denom      = eligible.length;
  const numer      = achieved.length;
  const state      = denom === 0 ? "no_eligible_observations" : getState(numer, denom, 3);
  const value      = denom > 0 ? pct(numer, denom) : null;
  return {
    value, numerator: numer, denominator: denom, state,
    evidence: buildEvidence(eligible, period, denom, unanswered),
    unansweredCount: unanswered,
    noEligibleWrEvents: false,
  };
}

// ── Buy-Intent Rate (canonical: metricId = buy_intent_rate) ───────────────────
// 4-category distribution: Buy, Skip, Undecided, Incomplete/No Response
// Rate uses only decided (buy + skip) as denominator — excludes undecided and incomplete.
export interface BuySkipDistribution {
  buyIntentCount:    number;
  skipCount:         number;
  undecidedCount:    number;
  incompleteCount:   number;
  total:             number;
  decidedCount:      number;
  buyIntentRate:     number | null;
  uniqueCustomers:   number;
  evidence:          EvidenceObject;
  state:             MeasurementState;
}

export function calcBuySkipDistribution(bsEvents: MetricEvent[], period: string): BuySkipDistribution {
  const buyIntent  = bsEvents.filter(e => e.outcome === "bought");
  const skip       = bsEvents.filter(e => e.outcome === "skip");
  // "saved" = save-for-later; counts as undecided/maybe (not a firm buy or skip)
  const undecided  = bsEvents.filter(e => e.outcome === "undecided" || e.outcome === "saved");
  const incomplete = bsEvents.filter(e => !e.outcome || e.outcome === null);
  const decided    = buyIntent.length + skip.length;
  const total      = bsEvents.length;
  const buyIntentRate = decided > 0 ? pct(buyIntent.length, decided) : null;
  const unique     = new Set(bsEvents.map(e => e.customerId)).size;
  const state      = getState(buyIntent.length, decided, 3);
  return {
    buyIntentCount:  buyIntent.length,
    skipCount:       skip.length,
    undecidedCount:  undecided.length,
    incompleteCount: incomplete.length,
    total,
    decidedCount:    decided,
    buyIntentRate,
    uniqueCustomers: unique,
    evidence:        buildEvidence(bsEvents.filter(e => e.outcome === "bought" || e.outcome === "skip"), period, decided),
    state,
  };
}

// ── Weighted sell-through (canonical: metricId = sell_through) ────────────────
// Weighted: total net units sold ÷ total starting units (correct for founder-level decisions)
// Unweighted: mean of individual product rates (biased by product mix — label explicitly)
export interface SellThroughResult {
  weightedSellThrough:    number; // total net sold / total starting units
  unweightedAvgSellThrough: number; // mean of individual product rates
}

export function calcSellThrough(
  products: Array<{ netSold: number; totalUnits: number; sellThrough: number }>,
): SellThroughResult {
  const totalNetSold      = products.reduce((s, r) => s + r.netSold, 0);
  const totalStarting     = products.reduce((s, r) => s + r.totalUnits, 0);
  const weightedSellThrough = totalStarting > 0 ? pct(totalNetSold, totalStarting) : 0;
  const unweightedAvgSellThrough = products.length > 0
    ? Math.round(products.reduce((s, r) => s + r.sellThrough, 0) / products.length)
    : 0;
  return { weightedSellThrough, unweightedAvgSellThrough };
}

// ── Language permission check (re-exported for convenience) ───────────────────
export { languagePermission };
export type { EvidenceObject, MeasurementState, CustomerEvidenceLabel };
