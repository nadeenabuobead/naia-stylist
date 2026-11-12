// app/lib/billing/erasure-billing.server.ts
//
// Stripe billing handling for account erasure (fix/stripe-clerk-phase1-security).
//
// A customer with an active (or past-due/incomplete, still-chargeable)
// subscription who requests erasure must not keep being charged by Stripe
// after their Customer row is anonymized. anonymizeBilledCustomer
// (customer-privacy.server.ts) nulls every personal identifier but
// deliberately RETAINS the Subscription/BillingTransaction rows — UAE tax
// law and standard financial-record-keeping practice require it, per
// Subscription's own schema comment. Without this file, Stripe would keep
// billing a subscription whose owner no longer has a name, email, or any
// way to reach the Billing Portal to cancel it themselves.
//
// Deliberately IMMEDIATE cancellation (cancelSubscriptionImmediately,
// Stripe's DELETE verb), not cancel_at_period_end — distinct from the
// ordinary customer-initiated cancellation flow (api.billing-portal.tsx),
// which honors "retain access until the period ends" because there's still
// a customer to retain access FOR. Once anonymization runs, there is no
// customer left to retain access for; paying through to a period end nobody
// will ever use serves no one.
//
// Writes Subscription.status = CANCELED directly here, rather than waiting
// for Stripe's own customer.subscription.deleted webhook to arrive and
// reconcile it — deliberate, given no STRIPE_WEBHOOK_SECRET is configured
// anywhere in this environment today (see the Stripe & Clerk audit,
// 2026-11-12): a webhook-only reconciliation path would leave this row
// showing ACTIVE indefinitely in the current environment. If the webhook
// DOES later arrive, its own authoritative re-fetch reconfirms the same
// CANCELED state — a safe no-op, not a conflict with webhook-handler.
// server.ts's "single writer" convention.
//
// A failure here must BLOCK anonymization, not be silently ignored —
// eraseCustomerData (customer-privacy.server.ts) routes a non-ok result
// from this function into the same recordPendingCustomerErasureFailure
// durable-retry mechanism used for every other unexpected erasure failure,
// rather than either anonymizing with billing still live, or throwing
// uncaught.

import prisma from "~/db.server";
import { cancelSubscriptionImmediately, StripeApiError } from "./stripe-client.server";

export interface SubscriptionToCancel {
  id: string;
  providerSubscriptionId: string;
}

export interface CancelActiveBillingDeps {
  _findChargeableSubscriptions?: (customerId: string) => Promise<SubscriptionToCancel[]>;
  _cancelSubscriptionImmediately?: (providerSubscriptionId: string) => Promise<unknown>;
  _markSubscriptionCanceled?: (id: string, canceledAt: Date) => Promise<void>;
  _now?: () => Date;
}

export interface CancelActiveBillingResult {
  ok: boolean;
  canceledCount: number;
  failures: Array<{ subscriptionId: string; providerSubscriptionId: string; error: string }>;
}

// Chargeable = would otherwise keep being billed. CANCELED/EXPIRED rows are
// already terminal and need nothing done to them; a customer who was never
// billed (hasBillingHistory false in customer-privacy.server.ts) never
// reaches this function at all.
const CHARGEABLE_STATUSES = ["ACTIVE", "PAST_DUE", "INCOMPLETE"] as const;

async function defaultFindChargeableSubscriptions(customerId: string): Promise<SubscriptionToCancel[]> {
  const rows = await prisma.subscription.findMany({
    where: {
      customerId,
      status: { in: [...CHARGEABLE_STATUSES] },
      providerSubscriptionId: { not: null },
    },
    select: { id: true, providerSubscriptionId: true },
  });
  return rows.map((r: { id: string; providerSubscriptionId: string | null }) => ({
    id: r.id,
    providerSubscriptionId: r.providerSubscriptionId!,
  }));
}

async function defaultMarkSubscriptionCanceled(id: string, canceledAt: Date): Promise<void> {
  await prisma.subscription.update({
    where: { id },
    data: { status: "CANCELED", canceledAt, endedAt: canceledAt, providerSyncedAt: canceledAt, pastDueSince: null },
  });
}

// Cancels every chargeable Stripe subscription for this customer,
// immediately. Returns ok:false (with per-subscription failure detail) if
// ANY cancellation fails — the caller must not proceed to anonymize while a
// subscription might still be live and chargeable.
export async function cancelActiveBillingForErasure(
  customerId: string,
  deps: CancelActiveBillingDeps = {},
): Promise<CancelActiveBillingResult> {
  const _findChargeableSubscriptions = deps._findChargeableSubscriptions ?? defaultFindChargeableSubscriptions;
  const _cancel = deps._cancelSubscriptionImmediately ?? ((providerSubscriptionId: string) => cancelSubscriptionImmediately(providerSubscriptionId));
  const _markSubscriptionCanceled = deps._markSubscriptionCanceled ?? defaultMarkSubscriptionCanceled;
  const _now = deps._now ?? (() => new Date());

  const subscriptions = await _findChargeableSubscriptions(customerId);
  const failures: CancelActiveBillingResult["failures"] = [];
  let canceledCount = 0;

  for (const sub of subscriptions) {
    try {
      await _cancel(sub.providerSubscriptionId);
      await _markSubscriptionCanceled(sub.id, _now());
      canceledCount++;
    } catch (err) {
      // A 404 (resource_missing) means Stripe already has no such
      // subscription — not a failure to retry, just confirmation it's
      // already gone. Still mark our row CANCELED so it isn't left stale
      // forever, blocking every future erasure attempt on this customer.
      if (err instanceof StripeApiError && err.status === 404) {
        await _markSubscriptionCanceled(sub.id, _now());
        canceledCount++;
        continue;
      }
      failures.push({
        subscriptionId: sub.id,
        providerSubscriptionId: sub.providerSubscriptionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { ok: failures.length === 0, canceledCount, failures };
}
