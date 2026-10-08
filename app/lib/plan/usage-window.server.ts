// app/lib/plan/usage-window.server.ts
// Single source for usage-period start/end calculation.
// V1: uses UTC calendar month — no billing period exists yet.
// When real billing exists, add membershipStartDate to Customer and swap the internals.
// All callers receive { start, end, label } — they never contain date arithmetic themselves.

export interface UsageWindow {
  start: Date;      // inclusive
  end: Date;        // exclusive (first moment of next period)
  label: string;    // e.g. "September 2026" — for display
  periodKey: string; // e.g. "2026-09" — stable idempotency-key component
}

export function getUsageWindow(): UsageWindow {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const label = start.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  // Derived from the same `start` used for the count-window boundaries below —
  // periodKey and the monthly count window cannot drift apart, because both
  // come from this one computation. Never recompute a period key elsewhere
  // from a separately-constructed Date.
  const periodKey = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}`;
  return { start, end, label, periodKey };
}

/** Format the end of the usage window as a short reset date, e.g. "1 October". */
export function formatResetDate(window: UsageWindow): string {
  return window.end.toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });
}
