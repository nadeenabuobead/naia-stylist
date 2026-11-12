// app/lib/billing/checkout-reservation.server.ts
//
// Concurrent-checkout protection (fix/stripe-clerk-phase1-security, 2026-11-12).
//
// Closes a genuine race the pre-existing "does a non-terminal Subscription
// row already exist" check (api.billing-checkout.tsx) cannot: that check
// only ever sees something once an EARLIER checkout attempt's webhook has
// landed, which can be minutes away. Two requests racing BEFORE any
// Subscription row exists — two tabs, a double-click outside the 5-minute
// Stripe idempotency-key bucket, two different plan types — each sailed
// straight through that check and could mint a separate, independently-
// billed Stripe subscription.
//
// CheckoutReservation.customerId's @@unique constraint is the actual
// atomicity guarantee: only one reservation row can exist per customer at
// the database level. The "is the existing one expired" check below is a
// liveness improvement only (unblocking an abandoned attempt on the NEXT
// try) — it is never what decides a genuine race between two concurrent
// requests; the unique-constraint violation on the losing insert is.
//
// See schema.prisma's own CheckoutReservation model comment for the full
// three-path cleanup lifecycle (webhook success/failure, checkout.session.
// expired, and this file's own expiresAt fallback).

import type { BillingPlanType } from "@prisma/client";
import prisma from "~/db.server";

// Stripe's own enforced MINIMUM for a Checkout Session's expires_at (30
// minutes from creation) — used here too so our reservation and Stripe's
// own session expiry are co-terminous: Stripe's checkout.session.expired
// webhook (the primary cleanup path) fires right as this file's own
// expiresAt fallback would otherwise kick in, not meaningfully before or after.
export const CHECKOUT_RESERVATION_TTL_MS = 30 * 60 * 1000;

export interface CheckoutReservationDeps {
  _findReservation?: (customerId: string) => Promise<{ id: string; expiresAt: Date } | null>;
  _deleteReservation?: (customerId: string) => Promise<void>;
  _createReservation?: (input: {
    customerId: string;
    planType: BillingPlanType;
    expiresAt: Date;
  }) => Promise<{ id: string }>;
  _now?: () => Date;
}

export type CheckoutReservationResult =
  | { allowed: true; expiresAt: Date }
  | { allowed: false; reason: "checkout_already_pending" };

async function defaultFindReservation(customerId: string) {
  return prisma.checkoutReservation.findUnique({
    where: { customerId },
    select: { id: true, expiresAt: true },
  });
}

async function defaultDeleteReservation(customerId: string): Promise<void> {
  // deleteMany, not delete — a no-op (0 rows) is the correct, non-throwing
  // outcome when a concurrent request already removed the row (e.g. two
  // requests both observing the same expired reservation).
  await prisma.checkoutReservation.deleteMany({ where: { customerId } });
}

async function defaultCreateReservation(input: { customerId: string; planType: BillingPlanType; expiresAt: Date }) {
  return prisma.checkoutReservation.create({ data: input });
}

function isUniqueConstraintViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2002";
}

// Reserves this customer's one allowed in-flight checkout attempt. Call
// BEFORE createCheckoutSession — the Stripe API call itself is the slow,
// network-bound step this reservation is meant to guard. Returns
// allowed:false if a non-expired reservation already exists for this
// customer; the caller should surface this as a 409 distinct from
// "subscription_already_exists" (that one is a resolved outcome, this one
// is still pending).
export async function reserveCheckoutAttempt(
  customerId: string,
  planType: BillingPlanType,
  deps: CheckoutReservationDeps = {},
): Promise<CheckoutReservationResult> {
  const _findReservation = deps._findReservation ?? defaultFindReservation;
  const _deleteReservation = deps._deleteReservation ?? defaultDeleteReservation;
  const _createReservation = deps._createReservation ?? defaultCreateReservation;
  const _now = deps._now ?? (() => new Date());

  const now = _now();
  const expiresAt = new Date(now.getTime() + CHECKOUT_RESERVATION_TTL_MS);

  async function attemptInsert(): Promise<CheckoutReservationResult> {
    try {
      await _createReservation({ customerId, planType, expiresAt });
      return { allowed: true, expiresAt };
    } catch (e) {
      // The only way this insert can fail on the unique constraint is a
      // genuinely concurrent request winning the race between this
      // function's own read above and this write — correctly reject the
      // loser rather than letting it proceed to a second Stripe session.
      if (isUniqueConstraintViolation(e)) {
        return { allowed: false, reason: "checkout_already_pending" };
      }
      throw e;
    }
  }

  const existing = await _findReservation(customerId);
  if (!existing) {
    return attemptInsert();
  }
  if (existing.expiresAt.getTime() <= now.getTime()) {
    // Abandoned — Stripe's own checkout.session.expired webhook should
    // already have deleted this row (see webhook-handler.server.ts); this
    // is the defense-in-depth fallback for a missed or delayed webhook.
    await _deleteReservation(customerId);
    return attemptInsert();
  }
  return { allowed: false, reason: "checkout_already_pending" };
}

// Best-effort observability only — lets a reservation row be matched back to
// the Stripe Checkout Session it's guarding (e.g. for support/debugging a
// stuck "checkout_already_pending" report). Never read by
// reserveCheckoutAttempt/releaseCheckoutReservation, both of which key
// purely on customerId; a failure here must never fail the checkout itself.
export async function attachCheckoutSessionId(
  customerId: string,
  providerCheckoutSessionId: string,
): Promise<void> {
  try {
    await prisma.checkoutReservation.update({
      where: { customerId },
      data: { providerCheckoutSessionId },
    });
  } catch {
    // The reservation may already be gone (a fast webhook beat us here, or
    // it expired) — this field is purely informational, so swallow and move on.
  }
}

// Called once a checkout attempt reaches any terminal outcome — payment
// confirmed, payment definitively failed, or the Stripe session expired
// unused. From that point on, the Subscription row (or its deliberate
// absence) is the source of truth for whether this customer can start a
// new checkout; this reservation's job is done.
export async function releaseCheckoutReservation(
  customerId: string,
  deps: Pick<CheckoutReservationDeps, "_deleteReservation"> = {},
): Promise<void> {
  const _deleteReservation = deps._deleteReservation ?? defaultDeleteReservation;
  await _deleteReservation(customerId);
}
