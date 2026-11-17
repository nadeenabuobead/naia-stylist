// app/lib/delayed-start.ts
//
// Delayed-start date computation — Founder Decision 2 (2026-11-17):
// "If early start is not requested, do not activate paid service
// silently. Prepare the delayed-start route with clearly stated service
// and billing dates; flag any product decision needed before enabling
// it."
//
// Pure date math only — no persistence, no Stripe call, no Subscription
// write. Whoever wires this into checkout decides WHEN this function
// actually runs and what happens with its result.
//
// OPEN PRODUCT DECISIONS, not resolved here — flagged, not guessed at:
//   1. STATUTORY_PERIOD_DAYS below defaults to 14 (the most common EU
//      figure) but this has NOT been confirmed against this product's
//      actual applicable jurisdiction(s) — do not treat 14 as settled.
//   2. What makes service actually START on the delayed date once it
//      arrives: an automated job that activates the Subscription then,
//      or a customer action (revisiting checkout) that triggers it? No
//      automated-activation mechanism exists anywhere in this codebase
//      today (confirmed: no scheduled-job infrastructure for billing
//      found in this repo) — this is an architecture decision for
//      whoever owns checkout/billing, not something this module assumes.
//   3. What happens if the customer never comes back to confirm the
//      delayed start — does the order simply lapse, or does something
//      follow up? Not decided.

export const STATUTORY_PERIOD_DAYS = 14;

export interface DelayedStartDates {
  orderDate: Date;
  serviceStartDate: Date;
  firstBillingDate: Date;
}

export function computeDelayedStart(orderDate: Date, statutoryPeriodDays: number = STATUTORY_PERIOD_DAYS): DelayedStartDates {
  const serviceStartDate = new Date(orderDate);
  serviceStartDate.setUTCDate(serviceStartDate.getUTCDate() + statutoryPeriodDays);
  // Service starts and billing happens on the same date in this model —
  // there is no "free" delay window, only a deferred paid start. If that
  // assumption is wrong, this is exactly the kind of thing to correct
  // here, in one place, rather than wherever this gets consumed.
  const firstBillingDate = new Date(serviceStartDate);
  return { orderDate, serviceStartDate, firstBillingDate };
}

export function formatDelayedStartDate(date: Date): string {
  return date.toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}
