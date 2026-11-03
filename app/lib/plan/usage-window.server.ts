// app/lib/plan/usage-window.server.ts
// Single source for usage-period start/end calculation.
//
// Default (no subscription argument, or called with zero arguments exactly
// as every existing caller does today): UTC calendar month — the original
// V1 behaviour. Every customer gets this until Phase 3's real billing
// wiring gives them an actual Subscription row with real period dates, so
// passing nothing here is still fully correct, not a degraded fallback.
//
// With a subscription passed (Phase 2 — billing-cycle-aware):
//   - MONTHLY plans: the subscription's own currentPeriodStart/End ARE the
//     usage window — they already reset on each monthly renewal webhook.
//   - ANNUAL plans: the customer paid once for 12 months but still gets a
//     MONTHLY allowance, not the full year at once. The usage window is
//     the specific one-month sub-window "now" falls into, anchored to the
//     subscription's own start date (its own day-of-month, every month),
//     not the calendar month and not the full annual period.
//
// Month-length edge cases (e.g. subscribed on the 31st, a shorter target
// month doesn't have one): each sub-window boundary clamps to the last
// real day of its own target month — the same anchoring behaviour most
// billing platforms use for monthly dates. See addMonthsClamped below.
//
// Timezone: deliberately UTC throughout, matching the pre-existing V1
// behaviour exactly — not Gulf Standard Time. Only ever localise for
// display, never for the boundary calculation itself, so a single
// definition of "the start of the period" never depends on which
// timezone a particular request happens to resolve against.

export interface UsageWindow {
  start: Date;      // inclusive
  end: Date;        // exclusive (first moment of next period)
  label: string;    // e.g. "September 2026" — for display
  periodKey: string; // e.g. "2026-09" — stable idempotency-key component
}

// Deliberately a plain duck-typed shape, not an import of Prisma's
// BillingPlanType/Subscription types — this file has zero dependencies by
// design (easy to unit-test in isolation, no DB/schema coupling) and the
// caller (entitlement.server.ts) already has whatever real Subscription
// row it needs; it just narrows to this shape before calling in.
export interface SubscriptionWindowInput {
  planType: "MONTHLY" | "ANNUAL";
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
}

function monthLabel(d: Date): string {
  return d.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

// Derived from the SAME `start` every caller below already computes for its
// own window boundaries — periodKey and the window it keys can never drift
// apart, because both come from one Date. Never recompute a period key
// elsewhere from a separately-constructed Date. Format (YYYY-MM) is a hard
// contract: PersonalisedTrendEditUsage's own unique constraint
// (customerId, reportSlug, periodKey) and its formatPeriodKeyLabel parser
// both assume exactly this shape.
function periodKeyFor(start: Date): string {
  return `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}`;
}

function getCalendarMonthWindow(now: Date): UsageWindow {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start, end, label: monthLabel(start), periodKey: periodKeyFor(start) };
}

// Adds `months` calendar months to `date`, clamping the resulting
// day-of-month to the last real day of the target month when the original
// day doesn't exist there — e.g. Jan 31 + 1 month -> Feb 28 (Feb 29 in a
// leap year), not an overflow into March. Time-of-day is preserved exactly,
// so a subscription anchored at a specific UTC instant stays anchored to
// that same instant-of-day every month.
export function addMonthsClamped(date: Date, months: number): Date {
  const day = date.getUTCDate();
  const targetFirstOfMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  // Day 0 of the FOLLOWING month is the last real day of the target month —
  // this expression alone is what makes leap years fall out for free.
  const daysInTargetMonth = new Date(Date.UTC(targetFirstOfMonth.getUTCFullYear(), targetFirstOfMonth.getUTCMonth() + 1, 0)).getUTCDate();
  const clampedDay = Math.min(day, daysInTargetMonth);
  return new Date(Date.UTC(
    targetFirstOfMonth.getUTCFullYear(),
    targetFirstOfMonth.getUTCMonth(),
    clampedDay,
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
    date.getUTCMilliseconds(),
  ));
}

// The one-month sub-window inside an annual billing period that `now` falls
// into, anchored to periodStart's own day-of-month. Capped at periodEnd: an
// expired or not-yet-renewed annual subscription resolves to its final
// sub-window rather than extrapolating indefinitely into the future —
// callers decide separately (via subscription status, not this function)
// whether that final window should actually grant any allowance.
export function getAnnualSubWindow(periodStart: Date, periodEnd: Date, now: Date): UsageWindow {
  const effectiveNow = now < periodEnd ? now : new Date(periodEnd.getTime() - 1);
  let monthsElapsed = 0;
  let windowEnd = addMonthsClamped(periodStart, 1);
  // Bounded at 11 steps (12 sub-windows total) — an annual period has at
  // most 12 monthly sub-windows; this bound exists so a malformed period
  // (e.g. periodEnd far beyond a real year) can never loop unbounded.
  while (windowEnd <= effectiveNow && monthsElapsed < 11) {
    monthsElapsed++;
    windowEnd = addMonthsClamped(periodStart, monthsElapsed + 1);
  }
  const windowStart = addMonthsClamped(periodStart, monthsElapsed);
  const clampedEnd = windowEnd < periodEnd ? windowEnd : periodEnd;
  return { start: windowStart, end: clampedEnd, label: monthLabel(windowStart), periodKey: periodKeyFor(windowStart) };
}

/**
 * Resolves the current usage window. Pass nothing for the original
 * calendar-month behaviour (every customer without a real Subscription row
 * yet — which, before Phase 3, is every customer). Pass a subscription to
 * get billing-cycle-anchored resets instead. `now` is injectable for
 * deterministic testing of month-end/leap-year/boundary cases; defaults to
 * the real current time for actual runtime use.
 */
export function getUsageWindow(subscription?: SubscriptionWindowInput | null, now: Date = new Date()): UsageWindow {
  if (!subscription) return getCalendarMonthWindow(now);
  if (subscription.planType === "MONTHLY") {
    return {
      start: subscription.currentPeriodStart,
      end: subscription.currentPeriodEnd,
      label: monthLabel(subscription.currentPeriodStart),
      periodKey: periodKeyFor(subscription.currentPeriodStart),
    };
  }
  return getAnnualSubWindow(subscription.currentPeriodStart, subscription.currentPeriodEnd, now);
}

/** Format the end of the usage window as a short reset date, e.g. "1 October". */
export function formatResetDate(window: UsageWindow): string {
  return window.end.toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });
}
