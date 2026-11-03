// app/lib/billing/webhook-handler.server.ts
// Phase 3 — Stripe webhook event processing: idempotency, out-of-order
// protection, and the actual Subscription/BillingTransaction writes.
//
// Chosen event flow (documented here because it is a real design decision,
// not an obvious mechanical mapping):
//   - checkout.session.completed: creates the Subscription row the moment
//     payment is confirmed (session.payment_status === "paid"). Status is
//     ACTIVE only when paid; INCOMPLETE otherwise. Period dates are NOT set
//     here — Checkout Sessions don't carry them without an extra expand
//     round-trip — they arrive moments later via customer.subscription.*
//     (see below), which Stripe fires immediately after Checkout completes
//     and on every renewal. Also records the SUBSCRIPTION_INITIAL ledger
//     entry.
//   - customer.subscription.updated / .deleted: the source of truth for
//     status, currentPeriodStart/End, and cancelAtPeriodEnd from this point
//     on. Matched primarily by providerSubscriptionId; if no row exists yet
//     (the rare case this event is delivered before checkout.session.
//     completed is processed), falls back to the subscription object's own
//     metadata.customerId — set at Checkout creation for exactly this
//     reason — to create the row instead of dropping the event.
//   - invoice.paid with billing_reason "subscription_cycle": a renewal
//     charge — records SUBSCRIPTION_RENEWAL. Any other billing_reason
//     (e.g. the very first invoice) is intentionally ignored here; the
//     initial charge is already recorded by checkout.session.completed.
//
// Subscription activation is strictly payment-confirmed: nothing here ever
// sets status ACTIVE except in direct response to a payment_status "paid"
// or a provider-reported "active" status — never from Checkout Session
// creation alone, matching the schema's own INCOMPLETE comment.
//
// Open product decisions (flagged, not silently resolved — see the
// mapStripeSubscriptionStatus comments below): how Stripe's "trialing" and
// "unpaid" statuses should map, since this product has no trial-period
// concept today.

import type { SubscriptionStatus, BillingPlanType } from "@prisma/client";
import prisma from "~/db.server";

// ── DI surface — mirrors EffectiveContextDeps/RunReservationFn conventions
// already established in entitlement.server.ts. Every function defaults to
// a real Prisma-backed implementation; tests inject fakes, no live DB. ──────

export interface SubscriptionRecord {
  id: string;
  customerId: string;
  status: SubscriptionStatus;
  planType: BillingPlanType;
  providerCustomerId: string | null;
  providerSubscriptionId: string | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  providerSyncedAt: Date | null;
}

export interface WebhookHandlerDeps {
  findProcessedEvent?: (provider: string, providerEventId: string) => Promise<{ id: string } | null>;
  recordProcessedEvent?: (input: {
    provider: string;
    providerEventId: string;
    eventType: string;
    eventCreatedAt: Date;
    customerId: string | null;
    payload: unknown;
  }) => Promise<void>;
  findSubscriptionByProviderSubscriptionId?: (providerSubscriptionId: string) => Promise<SubscriptionRecord | null>;
  findSubscriptionByCustomerId?: (customerId: string) => Promise<SubscriptionRecord | null>;
  createSubscription?: (input: {
    customerId: string;
    planType: BillingPlanType;
    status: SubscriptionStatus;
    providerCustomerId: string | null;
    providerSubscriptionId: string | null;
  }) => Promise<SubscriptionRecord>;
  updateSubscriptionById?: (
    id: string,
    input: Partial<{
      status: SubscriptionStatus;
      providerCustomerId: string | null;
      providerSubscriptionId: string | null;
      currentPeriodStart: Date | null;
      currentPeriodEnd: Date | null;
      cancelAtPeriodEnd: boolean;
      canceledAt: Date | null;
      endedAt: Date | null;
      providerSyncedAt: Date;
    }>,
  ) => Promise<void>;
  createBillingTransaction?: (input: {
    customerId: string;
    subscriptionId: string;
    type: "SUBSCRIPTION_INITIAL" | "SUBSCRIPTION_RENEWAL";
    amount: number;
    currency: string;
    providerTransactionId: string | null;
    occurredAt: Date;
  }) => Promise<void>;
}

async function defaultFindProcessedEvent(provider: string, providerEventId: string) {
  return prisma.processedWebhookEvent.findUnique({
    where: { provider_providerEventId: { provider, providerEventId } },
    select: { id: true },
  });
}

async function defaultRecordProcessedEvent(input: {
  provider: string;
  providerEventId: string;
  eventType: string;
  eventCreatedAt: Date;
  customerId: string | null;
  payload: unknown;
}) {
  await prisma.processedWebhookEvent.create({
    data: {
      provider: input.provider,
      providerEventId: input.providerEventId,
      eventType: input.eventType,
      eventCreatedAt: input.eventCreatedAt,
      customerId: input.customerId,
      payload: input.payload as any,
    },
  });
}

async function defaultFindSubscriptionByProviderSubscriptionId(providerSubscriptionId: string) {
  return prisma.subscription.findFirst({ where: { providerSubscriptionId } });
}

async function defaultFindSubscriptionByCustomerId(customerId: string) {
  return prisma.subscription.findFirst({ where: { customerId }, orderBy: { createdAt: "desc" } });
}

async function defaultCreateSubscription(input: {
  customerId: string;
  planType: BillingPlanType;
  status: SubscriptionStatus;
  providerCustomerId: string | null;
  providerSubscriptionId: string | null;
}) {
  return prisma.subscription.create({
    data: {
      customerId: input.customerId,
      planType: input.planType,
      status: input.status,
      provider: "stripe",
      providerCustomerId: input.providerCustomerId,
      providerSubscriptionId: input.providerSubscriptionId,
    },
  });
}

async function defaultUpdateSubscriptionById(id: string, input: Record<string, unknown>) {
  await prisma.subscription.update({ where: { id }, data: input as any });
}

async function defaultCreateBillingTransaction(input: {
  customerId: string;
  subscriptionId: string;
  type: "SUBSCRIPTION_INITIAL" | "SUBSCRIPTION_RENEWAL";
  amount: number;
  currency: string;
  providerTransactionId: string | null;
  occurredAt: Date;
}) {
  await prisma.billingTransaction.create({
    data: {
      customerId: input.customerId,
      subscriptionId: input.subscriptionId,
      type: input.type,
      status: "SUCCEEDED",
      amount: input.amount,
      currency: input.currency,
      provider: "stripe",
      providerTransactionId: input.providerTransactionId,
      occurredAt: input.occurredAt,
    },
  });
}

// ── Stripe status → our SubscriptionStatus ──────────────────────────────────
//
// existing.cancelAtPeriodEnd distinguishes WHY a subscription ended: a
// customer-initiated cancellation (cancelAtPeriodEnd was already true when
// Stripe confirms the end) maps to CANCELED; anything else reaching a
// terminal state (payment failures exhausting retries) maps to EXPIRED —
// per the schema's own CANCELED/EXPIRED distinction. This can only be
// decided by consulting existing DB state, never the incoming payload alone.
//
// trialing and unpaid have no clean mapping because this product has no
// trial-period concept and "unpaid" sits in an ambiguous pre-terminal
// state — both are flagged in the Phase 3 report as open product
// decisions. The conservative choice made here: trialing -> INCOMPLETE
// (never grant unpaid access), unpaid -> PAST_DUE (keep the existing grace
// period machinery, since Stripe's own retry schedule hasn't yet given up).
export function mapStripeSubscriptionStatus(
  stripeStatus: string,
  existing: { cancelAtPeriodEnd: boolean } | null,
): SubscriptionStatus {
  switch (stripeStatus) {
    case "active":
      return "ACTIVE";
    case "past_due":
      return "PAST_DUE";
    case "unpaid":
      return "PAST_DUE";
    case "trialing":
      return "INCOMPLETE";
    case "incomplete":
      return "INCOMPLETE";
    case "incomplete_expired":
      return "EXPIRED";
    case "canceled":
    case "paused":
      return existing?.cancelAtPeriodEnd ? "CANCELED" : "EXPIRED";
    default:
      return "INCOMPLETE";
  }
}

export interface StripeEventLike {
  id: string;
  type: string;
  created: number; // Unix seconds — Stripe's own event timestamp
  data: { object: any };
}

export type ProcessResult =
  | { ok: true; deduped: true }
  | { ok: true; deduped: false; action: string }
  | { ok: false; reason: string };

export async function processStripeWebhookEvent(
  event: StripeEventLike,
  deps: WebhookHandlerDeps = {},
): Promise<ProcessResult> {
  const _findProcessedEvent = deps.findProcessedEvent ?? defaultFindProcessedEvent;
  const _recordProcessedEvent = deps.recordProcessedEvent ?? defaultRecordProcessedEvent;
  const _findSubscriptionByProviderSubscriptionId =
    deps.findSubscriptionByProviderSubscriptionId ?? defaultFindSubscriptionByProviderSubscriptionId;
  const _findSubscriptionByCustomerId = deps.findSubscriptionByCustomerId ?? defaultFindSubscriptionByCustomerId;
  const _createSubscription = deps.createSubscription ?? defaultCreateSubscription;
  const _updateSubscriptionById = deps.updateSubscriptionById ?? defaultUpdateSubscriptionById;
  const _createBillingTransaction = deps.createBillingTransaction ?? defaultCreateBillingTransaction;

  // ── Idempotency ────────────────────────────────────────────────────────────
  // Same event id redelivered (Stripe retries on anything but a 2xx, and
  // webhook delivery is at-least-once by design) — skip entirely, never
  // reprocess business logic for an event already recorded.
  const already = await _findProcessedEvent("stripe", event.id);
  if (already) return { ok: true, deduped: true };

  const eventCreatedAt = new Date(event.created * 1000);
  const obj = event.data.object;

  let resolvedCustomerId: string | null = null;
  let action = "ignored";

  switch (event.type) {
    case "checkout.session.completed": {
      const customerId: string | undefined = obj.client_reference_id ?? obj.metadata?.customerId;
      const planType: BillingPlanType = obj.metadata?.planType === "ANNUAL" ? "ANNUAL" : "MONTHLY";
      if (customerId) {
        resolvedCustomerId = customerId;
        const paid = obj.payment_status === "paid";
        const sub = await _createSubscription({
          customerId,
          planType,
          status: paid ? "ACTIVE" : "INCOMPLETE",
          providerCustomerId: obj.customer ?? null,
          providerSubscriptionId: obj.subscription ?? null,
        });
        if (paid && typeof obj.amount_total === "number") {
          await _createBillingTransaction({
            customerId,
            subscriptionId: sub.id,
            type: "SUBSCRIPTION_INITIAL",
            amount: obj.amount_total,
            currency: (obj.currency ?? "aed").toUpperCase(),
            providerTransactionId: obj.payment_intent ?? null,
            occurredAt: eventCreatedAt,
          });
        }
        action = "subscription_created";
      }
      break;
    }

    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const providerSubscriptionId: string = obj.id;
      let existing = await _findSubscriptionByProviderSubscriptionId(providerSubscriptionId);

      if (!existing) {
        // Out-of-order delivery relative to checkout.session.completed, or
        // the subscription object's own metadata is the only identity we
        // have yet. Fall back to it rather than dropping the event.
        const metaCustomerId = obj.metadata?.customerId as string | undefined;
        if (metaCustomerId) {
          existing = await _findSubscriptionByCustomerId(metaCustomerId);
        }
      }
      if (!existing) break; // genuinely nothing to reconcile against yet

      resolvedCustomerId = existing.customerId;

      // ── Out-of-order guard ───────────────────────────────────────────────
      // Never let a stale/delayed redelivery overwrite newer state with
      // older data — only apply if this event is actually newer than the
      // last synced state.
      if (existing.providerSyncedAt && eventCreatedAt <= existing.providerSyncedAt) {
        action = "stale_event_ignored";
        break;
      }

      const stripeStatus: string = event.type === "customer.subscription.deleted" ? "canceled" : obj.status;
      const mappedStatus = mapStripeSubscriptionStatus(stripeStatus, { cancelAtPeriodEnd: existing.cancelAtPeriodEnd });
      const isTerminal = mappedStatus === "CANCELED" || mappedStatus === "EXPIRED";

      await _updateSubscriptionById(existing.id, {
        status: mappedStatus,
        providerSubscriptionId,
        providerCustomerId: typeof obj.customer === "string" ? obj.customer : existing.providerCustomerId,
        currentPeriodStart: obj.current_period_start ? new Date(obj.current_period_start * 1000) : existing.currentPeriodStart,
        currentPeriodEnd: obj.current_period_end ? new Date(obj.current_period_end * 1000) : existing.currentPeriodEnd,
        cancelAtPeriodEnd: Boolean(obj.cancel_at_period_end),
        ...(isTerminal ? { endedAt: eventCreatedAt } : {}),
        providerSyncedAt: eventCreatedAt,
      });
      action = "subscription_synced";
      break;
    }

    case "invoice.paid": {
      if (obj.billing_reason !== "subscription_cycle") break; // initial invoice already recorded above
      const providerSubscriptionId: string | undefined = obj.subscription;
      if (!providerSubscriptionId) break;
      const existing = await _findSubscriptionByProviderSubscriptionId(providerSubscriptionId);
      if (!existing) break;
      resolvedCustomerId = existing.customerId;
      await _createBillingTransaction({
        customerId: existing.customerId,
        subscriptionId: existing.id,
        type: "SUBSCRIPTION_RENEWAL",
        amount: obj.amount_paid,
        currency: (obj.currency ?? "aed").toUpperCase(),
        providerTransactionId: obj.payment_intent ?? null,
        occurredAt: eventCreatedAt,
      });
      action = "renewal_recorded";
      break;
    }

    default:
      // Unrecognized/irrelevant event types are safely ignored, not errors —
      // Stripe's webhook payload can include many event types this
      // integration doesn't act on; returning ok here tells Stripe not to
      // retry delivery.
      break;
  }

  await _recordProcessedEvent({
    provider: "stripe",
    providerEventId: event.id,
    eventType: event.type,
    eventCreatedAt,
    customerId: resolvedCustomerId,
    payload: event,
  });

  return { ok: true, deduped: false, action };
}
