// app/lib/plan/billing-window.server.ts
// Single source for billing-period start/end calculation.
// V1: uses UTC calendar month — no billing period exists yet.
// V2: when real billing exists, add billingPeriodStart to Customer and swap the internals.
// All callers receive { start, end, label } — they never contain date arithmetic themselves.

export interface BillingWindow {
  start: Date;   // inclusive
  end: Date;     // exclusive (first moment of next period)
  label: string; // e.g. "September 2026" — for display
}

export function getBillingWindow(): BillingWindow {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const label = start.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  return { start, end, label };
}

/** Format the end of the billing window as a short reset date, e.g. "1 October". */
export function formatResetDate(window: BillingWindow): string {
  return window.end.toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });
}
