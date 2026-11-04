// app/lib/billing/webhook-handler.server.ts
// Phase 3 — Stripe webhook event processing: idempotency, out-of-order
// protection, and the actual Subscription/BillingTransaction writes.
//
// Chosen event flow (documented here because it is a real design decision,
// not an obvious mechanical mapping):
//   - checkout.session.completed: creates the Subscription row. Activates
//     (ACTIVE) ONLY when payment_status is already "paid" at this point —
//     true for every synchronous payment method (cards). For asynchronous
//     methods (bank debits etc.), payment_status is "unpaid" here and the
//     row is created INCOMPLETE; activation then happens later from
//     checkout.session.async_payment_succeeded (or the row is marked
//     EXPIRED from .async_payment_failed). Records SUBSCRIPTION_INITIAL
//     only once payment is actually confirmed — never at session creation.
//   - checkout.session.async_payment_succeeded / .async_payment_failed:
//     the deferred confirmation for asynchronous payment methods — see
//     above. Required precisely because checkout.session.completed firing
//     does NOT itself mean payment succeeded for these methods.
//   - customer.subscription.updated / .deleted: the ongoing source of
//     truth for status, currentPeriodStart/End, and cancelAtPeriodEnd.
//     Rather than trust the embedded webhook object (which is a snapshot
//     taken at send time, and Stripe does not guarantee webhook delivery
//     order), this re-fetches the AUTHORITATIVE subscription object from
//     Stripe and writes ONLY from that — the event only triggers the sync,
//     per the schema's own providerSyncedAt design note. Financial-safety
//     review requirement: if the re-fetch itself fails, this REFUSES to
//     apply anything (returns ok:false, does NOT record the event as
//     processed) rather than falling back to the embedded, unconfirmed
//     webhook body — an entitlement-affecting write must never be made on
//     data we couldn't verify. Matched primarily by providerSubscriptionId;
//     if no row exists yet anywhere (out-of-order relative to
//     checkout.session.completed), CREATES one from the authoritative data
//     instead of dropping the event — a prior version of this handler
//     silently dropped this case, permanently losing the event's data
//     since Stripe does not redeliver an event we 200'd.
//   - invoice.paid with billing_reason "subscription_cycle": a renewal
//     charge — records SUBSCRIPTION_RENEWAL (SUCCEEDED). Any other
//     billing_reason is ignored here; the initial charge is recorded by
//     checkout.session.completed / .async_payment_succeeded, not here.
//   - invoice.payment_failed: records a FAILED BillingTransaction ledger
//     entry (SUBSCRIPTION_INITIAL or _RENEWAL depending on billing_reason)
//     for billing-history/support visibility. Deliberately does NOT itself
//     change Subscription.status — customer.subscription.updated is the
//     single place status transitions happen, avoiding two code paths
//     fighting over the same field.
//
// Subscription activation is strictly payment-confirmed: nothing here ever
// sets status ACTIVE except in direct response to a payment_status "paid"
// (sync or async) or a provider-reported "active" status — never from
// Checkout Session creation alone, matching the schema's own INCOMPLETE
// comment.
//
// Idempotency against PARTIAL retries (not just exact redelivery): the
// processed-event ledger is still written last (see below for why), so a
// crash between business logic succeeding and the ledger write committing
// would, on Stripe's retry, cause business logic to run again. Rather than
// wrap everything in one giant transaction (a larger structural change than
// this review calls for), each create operation is made idempotent against
// its OWN already-unique columns: Subscription.providerSubscriptionId and
// BillingTransaction.providerTransactionId are both @unique in the schema,
// so a retried create hits a P2002 instead of creating a duplicate row —
// and that P2002 is caught here and treated as "already done," letting the
// retry proceed to successfully record the ledger entry on this attempt,
// rather than permanently failing on every future retry too. This is a
// deliberately different stance from reserveBuySkipSlot's P2002 handling
// (RSV.11), which lets a client-supplied idempotencyKey collision propagate
// to the caller — that represents a genuinely conflicting concurrent user
// action the caller must see, not a safe provider-retry to absorb silently.
//
// Open product decisions (flagged, not silently resolved — see the
// mapStripeSubscriptionStatus comments below): how Stripe's "trialing"
// status should map, since this product has no trial-period concept today.
// "unpaid" maps to PAST_DUE and is now safe to do so because PAST_DUE
// itself is time-bounded (see pastDueSince / GRACE_PERIOD_MS below) —
// access is never indefinite regardless of the provider's own retry
// schedule.

import type { SubscriptionStatus, BillingPlanType, MembershipStatus } from "@prisma/client";
import prisma from "~/db.server";
import { retrieveSubscription as stripeRetrieveSubscription, type StripeSubscriptionSnapshot } from "./stripe-client.server";

export function isUniqueConstraintViolation(err: unknown, field?: string): boolean {
  if (!err || typeof err !== "object" || (err as any).code !== "P2002") return false;
  if (!field) return true;
  const target = (err as any).meta?.target;
  return Array.isArray(target) ? target.includes(field) : target === field;
}

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
  pastDueSince: Date | null;
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
      planType: BillingPlanType;
      providerCustomerId: string | null;
      providerSubscriptionId: string | null;
      currentPeriodStart: Date | null;
      currentPeriodEnd: Date | null;
      cancelAtPeriodEnd: boolean;
      canceledAt: Date | null;
      endedAt: Date | null;
      pastDueSince: Date | null;
      providerSyncedAt: Date;
    }>,
  ) => Promise<void>;
  createBillingTransaction?: (input: {
    customerId: string;
    subscriptionId: string;
    type: "SUBSCRIPTION_INITIAL" | "SUBSCRIPTION_RENEWAL";
    status: "SUCCEEDED" | "FAILED";
    amount: number;
    currency: string;
    providerTransactionId: string | null;
    occurredAt: Date;
  }) => Promise<void>;
  retrieveAuthoritativeSubscription?: (providerSubscriptionId: string) => Promise<StripeSubscriptionSnapshot | null>;
  updateCustomerMembershipStatus?: (customerId: string, status: MembershipStatus) => Promise<void>;
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
  try {
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
  } catch (err) {
    // A genuinely concurrent duplicate delivery lost the race to record
    // this exact event — the business logic above already ran idempotently
    // (every create it performed is itself guarded the same way), so this
    // is a safe no-op, not a failure.
    if (!isUniqueConstraintViolation(err, "provider_providerEventId")) throw err;
  }
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
  try {
    return await prisma.subscription.create({
      data: {
        customerId: input.customerId,
        planType: input.planType,
        status: input.status,
        provider: "stripe",
        providerCustomerId: input.providerCustomerId,
        providerSubscriptionId: input.providerSubscriptionId,
      },
    });
  } catch (err) {
    // A retried checkout.session.completed (e.g. the ledger write failed
    // after this create succeeded on a prior attempt) must not create a
    // second row for the SAME Stripe subscription — providerSubscriptionId
    // is @unique precisely so this is detectable rather than silently
    // duplicated. Fetch and reuse the row that already exists instead of
    // throwing, so the retry can still succeed overall.
    if (input.providerSubscriptionId && isUniqueConstraintViolation(err, "providerSubscriptionId")) {
      const existing = await prisma.subscription.findFirst({
        where: { providerSubscriptionId: input.providerSubscriptionId },
      });
      if (existing) return existing;
    }
    throw err;
  }
}

async function defaultUpdateSubscriptionById(id: string, input: Record<string, unknown>) {
  await prisma.subscription.update({ where: { id }, data: input as any });
}

// The Subscription row is the billing source of truth (see this file's own
// top-of-file design note), but Customer.membershipStatus is what the
// customer-facing UI actually reads directly (my-naia.plan-usage.tsx's
// isMember check, getEntitlementSummary's returned membershipStatus — see
// entitlement.server.ts) — neither re-derives it from Subscription. Without
// this sync, a real, successfully-paid ACTIVE subscription leaves the
// customer's own record reading "NONE" forever, with no code path to ever
// correct it.
async function defaultUpdateCustomerMembershipStatus(customerId: string, status: MembershipStatus) {
  try {
    await prisma.customer.update({ where: { id: customerId }, data: { membershipStatus: status } });
  } catch (err) {
    // P2025 = record not found. Subscription.customerId is FK-constrained
    // to a real Customer row, so this cannot happen for a genuine webhook
    // in production — only a defensive guard, not a path real traffic
    // should ever take. A missing customer must not fail the whole event
    // (the Subscription/BillingTransaction writes already succeeded).
    if ((err as any)?.code === "P2025") return;
    throw err;
  }
}

async function defaultCreateBillingTransaction(input: {
  customerId: string;
  subscriptionId: string;
  type: "SUBSCRIPTION_INITIAL" | "SUBSCRIPTION_RENEWAL";
  status: "SUCCEEDED" | "FAILED";
  amount: number;
  currency: string;
  providerTransactionId: string | null;
  occurredAt: Date;
}) {
  try {
    await prisma.billingTransaction.create({
      data: {
        customerId: input.customerId,
        subscriptionId: input.subscriptionId,
        type: input.type,
        status: input.status,
        amount: input.amount,
        currency: input.currency,
        provider: "stripe",
        providerTransactionId: input.providerTransactionId,
        occurredAt: input.occurredAt,
      },
    });
  } catch (err) {
    // Same retry-safety rationale as defaultCreateSubscription above —
    // providerTransactionId is @unique, so a retried record-the-charge
    // call for the SAME Stripe payment_intent is a safe no-op, not an
    // error: the charge was already recorded by an earlier attempt.
    if (input.providerTransactionId && isUniqueConstraintViolation(err, "providerTransactionId")) return;
    throw err;
  }
}

async function defaultRetrieveAuthoritativeSubscription(providerSubscriptionId: string): Promise<StripeSubscriptionSnapshot | null> {
  try {
    return await stripeRetrieveSubscription(providerSubscriptionId);
  } catch {
    // A null return tells the caller the authoritative fetch failed — the
    // caller (customer.subscription.updated/.deleted in
    // processStripeWebhookEvent) must refuse to apply any entitlement
    // change in that case, never fall back to the embedded webhook body.
    return null;
  }
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
// trialing has no clean mapping because this product has no trial-period
// concept — flagged as an open product decision. The conservative choice:
// trialing -> INCOMPLETE (never grant unpaid access). unpaid -> PAST_DUE is
// safe specifically because PAST_DUE is itself time-bounded by
// pastDueSince / GRACE_PERIOD_MS in entitlement.server.ts, independent of
// the provider's own dunning schedule.
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

// ── Authoritative plan type (interval) derivation ───────────────────────────
//
// planType was previously set only once, at row creation, from the embedded
// event body's metadata — and never touched again by customer.subscription.
// updated. A monthly<->annual switch made through the Stripe Billing Portal
// therefore left the stored planType permanently stale, and since missing/
// unrecognized metadata defaults to MONTHLY, a mislabeled annual subscriber
// would have their currentPeriodStart/End (a full year) read as the row's
// usage window with only the monthly allowance inside it — see
// usage-window.server.ts's window derivation. Deriving this from the
// AUTHORITATIVE re-fetched subscription's own price interval, not the event
// body, follows the same financial-safety principle already applied to
// status/period/cancellation above. Returns null (not a default) when the
// authoritative object doesn't carry a usable interval, so callers can
// choose to fall back to existing stored state rather than silently guessing
// MONTHLY.
export function derivePlanTypeFromAuthoritative(
  authoritative: Pick<StripeSubscriptionSnapshot, "items">,
): BillingPlanType | null {
  const interval = authoritative.items?.data?.[0]?.price?.recurring?.interval;
  if (interval === "year") return "ANNUAL";
  if (interval === "month") return "MONTHLY";
  return null;
}

export interface StripeEventLike {
  id: string;
  type: string;
  created: number; // Unix seconds — Stripe's own event timestamp
  livemode?: boolean; // checked by api.stripe-webhook.tsx before this ever runs
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
  const _retrieveAuthoritativeSubscription = deps.retrieveAuthoritativeSubscription ?? defaultRetrieveAuthoritativeSubscription;
  const _updateCustomerMembershipStatus = deps.updateCustomerMembershipStatus ?? defaultUpdateCustomerMembershipStatus;

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

  // Shared by checkout.session.completed and .async_payment_succeeded —
  // both represent "payment for this Checkout Session is now confirmed,"
  // just at different times depending on the payment method.
  async function activateFromCheckoutSession(): Promise<void> {
    const customerId: string | undefined = obj.client_reference_id ?? obj.metadata?.customerId;
    if (!customerId) return;
    resolvedCustomerId = customerId;
    const planType: BillingPlanType = obj.metadata?.planType === "ANNUAL" ? "ANNUAL" : "MONTHLY";

    let sub = obj.subscription
      ? await _findSubscriptionByProviderSubscriptionId(obj.subscription)
      : await _findSubscriptionByCustomerId(customerId);

    const wasAlreadyActive = sub?.status === "ACTIVE";

    if (!sub) {
      sub = await _createSubscription({
        customerId,
        planType,
        status: "ACTIVE",
        providerCustomerId: obj.customer ?? null,
        providerSubscriptionId: obj.subscription ?? null,
      });
    } else if (sub.status === "INCOMPLETE" || sub.status === "ACTIVE") {
      if (!wasAlreadyActive) {
        await _updateSubscriptionById(sub.id, { status: "ACTIVE", pastDueSince: null });
      }
      // else: already active — no status write needed, but STILL fall
      // through to the billing-transaction step below. A prior attempt at
      // this same activation may have crashed AFTER setting ACTIVE but
      // BEFORE recording the charge; returning early here (as an earlier
      // version of this function did) would permanently lose that charge
      // on every future retry, since this branch would always take the
      // same "nothing to do" exit. providerTransactionId's uniqueness is
      // what makes the create below safe to attempt unconditionally — a
      // genuine duplicate confirmation still no-ops, but a lost-on-retry
      // charge gets a real chance to be recorded.
    } else {
      // PAST_DUE/CANCELED/EXPIRED — a late payment confirmation arriving
      // after this subscription's fate was already decided by other, more
      // authoritative/later events (e.g. a subsequent cancellation). Must
      // not resurrect it to ACTIVE on a stale confirmation.
      action = "superseded_by_later_state";
      return;
    }

    // The subscription is now ACTIVE (new or reconfirmed) — promote the
    // customer's own record. Idempotent: a no-op write if already MEMBER.
    await _updateCustomerMembershipStatus(customerId, "MEMBER");

    if (typeof obj.amount_total === "number") {
      await _createBillingTransaction({
        customerId,
        subscriptionId: sub.id,
        type: "SUBSCRIPTION_INITIAL",
        status: "SUCCEEDED",
        // obj.id (the Checkout Session id) is the correct fallback, not
        // event.id — a Checkout Session completes payment exactly once by
        // construction, so this is a genuine financial-uniqueness key, not
        // merely a redelivery-of-the-same-event guard. See the comment on
        // the invoice.payment_failed branch below for why THAT one needs
        // an attempt-aware key instead of the bare object id.
        providerTransactionId: obj.payment_intent ?? obj.id,
        occurredAt: eventCreatedAt,
        amount: obj.amount_total,
        currency: (obj.currency ?? "aed").toUpperCase(),
      });
    }
    action = wasAlreadyActive ? "already_active_charge_reconciled" : "subscription_activated";
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const customerId: string | undefined = obj.client_reference_id ?? obj.metadata?.customerId;
      if (customerId) {
        resolvedCustomerId = customerId;
        const paid = obj.payment_status === "paid";
        if (paid) {
          // Synchronous payment method (card, etc.) — payment is already
          // confirmed. Funnel through the SAME find-or-create-then-activate
          // path async_payment_succeeded uses below, so a row that was
          // already created by an out-of-order customer.subscription.*
          // sync (see that case) is reused and activated here rather than
          // a second, divergent row being created.
          await activateFromCheckoutSession();
        } else {
          // Asynchronous payment method — nothing confirmed yet.
          // Activation is deferred to async_payment_succeeded/failed;
          // never assumed from session creation alone. Still check for an
          // existing row first (the same out-of-order-sync case applies)
          // rather than blindly creating a second one.
          const planType: BillingPlanType = obj.metadata?.planType === "ANNUAL" ? "ANNUAL" : "MONTHLY";
          const existingSub = obj.subscription
            ? await _findSubscriptionByProviderSubscriptionId(obj.subscription)
            : await _findSubscriptionByCustomerId(customerId);
          if (!existingSub) {
            await _createSubscription({
              customerId,
              planType,
              status: "INCOMPLETE",
              providerCustomerId: obj.customer ?? null,
              providerSubscriptionId: obj.subscription ?? null,
            });
          }
          action = "subscription_created_pending_async_payment";
        }
      }
      break;
    }

    case "checkout.session.async_payment_succeeded": {
      await activateFromCheckoutSession();
      break;
    }

    case "checkout.session.async_payment_failed": {
      const customerId: string | undefined = obj.client_reference_id ?? obj.metadata?.customerId;
      if (customerId) {
        resolvedCustomerId = customerId;
        const sub = obj.subscription
          ? await _findSubscriptionByProviderSubscriptionId(obj.subscription)
          : await _findSubscriptionByCustomerId(customerId);
        if (sub && sub.status !== "ACTIVE") {
          // The deferred payment definitively failed — this Checkout
          // attempt is dead. EXPIRED, not left lingering as INCOMPLETE
          // forever, so it reads clearly in billing history/support.
          await _updateSubscriptionById(sub.id, { status: "EXPIRED", endedAt: eventCreatedAt });
          action = "async_payment_failed";
        }
      }
      break;
    }

    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const providerSubscriptionId: string = obj.id;

      // Financial-safety review requirement: an entitlement-affecting
      // write (status/period/cancellation) must NEVER be made from the
      // embedded webhook body alone — that body is a signed, genuine
      // Stripe event, but it is still just a snapshot taken at send time,
      // and Stripe explicitly does not guarantee webhook delivery order.
      // If the authoritative re-fetch itself fails (network issue, Stripe
      // outage), refuse rather than guess from stale/unconfirmed data.
      // Returning here WITHOUT calling _recordProcessedEvent is
      // deliberate: this event is NOT marked processed, so Stripe's own
      // retry schedule gets another chance once the fetch can succeed,
      // rather than this event being silently, permanently treated as
      // "handled" despite never actually being safely applied.
      const authoritative = await _retrieveAuthoritativeSubscription(providerSubscriptionId);
      if (!authoritative) {
        return { ok: false, reason: "authoritative_subscription_fetch_failed" };
      }

      let existing = await _findSubscriptionByProviderSubscriptionId(providerSubscriptionId);
      if (!existing) {
        const metaCustomerId = obj.metadata?.customerId as string | undefined;
        if (metaCustomerId) existing = await _findSubscriptionByCustomerId(metaCustomerId);
      }

      if (!existing) {
        // Genuinely out-of-order relative to checkout.session.completed —
        // rather than silently drop this event (Stripe will not redeliver
        // an event we 200'd), create the row directly from the
        // AUTHORITATIVE data. checkout.session.completed, when it
        // eventually arrives/is processed, will find this row (by
        // providerSubscriptionId or customerId) via the same lookups
        // above and update it in place rather than creating a duplicate.
        const metaCustomerId = obj.metadata?.customerId as string | undefined;
        if (!metaCustomerId) break; // nothing to key a new row on
        // Authoritative interval first; embedded metadata only as a
        // fallback when Stripe's own object doesn't carry a usable one.
        const planType: BillingPlanType =
          derivePlanTypeFromAuthoritative(authoritative) ??
          (obj.metadata?.planType === "ANNUAL" ? "ANNUAL" : "MONTHLY");
        resolvedCustomerId = metaCustomerId;
        const created = await _createSubscription({
          customerId: metaCustomerId,
          planType,
          status: mapStripeSubscriptionStatus(authoritative.status, null),
          providerCustomerId: typeof authoritative.customer === "string" ? authoritative.customer : null,
          providerSubscriptionId,
        });
        await _updateSubscriptionById(created.id, {
          currentPeriodStart: authoritative.current_period_start ? new Date(authoritative.current_period_start * 1000) : null,
          currentPeriodEnd: authoritative.current_period_end ? new Date(authoritative.current_period_end * 1000) : null,
          cancelAtPeriodEnd: Boolean(authoritative.cancel_at_period_end),
          pastDueSince: mapStripeSubscriptionStatus(authoritative.status, null) === "PAST_DUE" ? eventCreatedAt : null,
          providerSyncedAt: eventCreatedAt,
        });
        if (created.status === "ACTIVE" || created.status === "PAST_DUE") {
          await _updateCustomerMembershipStatus(metaCustomerId, "MEMBER");
        }
        action = "subscription_created_from_sync";
        break;
      }

      resolvedCustomerId = existing.customerId;

      // ── Out-of-order guard ───────────────────────────────────────────────
      // Never let a stale/delayed redelivery overwrite newer state with
      // older data — only apply if THIS EVENT is actually newer than the
      // last synced state. (The authoritative re-fetch above protects
      // against an incomplete/malformed embedded payload; this guard
      // protects against applying a genuinely outdated webhook at all.)
      if (existing.providerSyncedAt && eventCreatedAt <= existing.providerSyncedAt) {
        action = "stale_event_ignored";
        break;
      }

      const mappedStatus = mapStripeSubscriptionStatus(authoritative.status, { cancelAtPeriodEnd: existing.cancelAtPeriodEnd });
      const isTerminal = mappedStatus === "CANCELED" || mappedStatus === "EXPIRED";
      const enteringPastDue = mappedStatus === "PAST_DUE" && existing.status !== "PAST_DUE";
      const leavingPastDue = mappedStatus !== "PAST_DUE" && existing.status === "PAST_DUE";
      // Authoritative interval takes precedence on every sync, not just at
      // creation — see derivePlanTypeFromAuthoritative's own comment for
      // why this matters (a portal-initiated monthly<->annual switch must
      // not leave the stored planType stale). Falls back to the existing
      // stored value, never a hardcoded default, when Stripe's object
      // doesn't carry a usable interval.
      const planType = derivePlanTypeFromAuthoritative(authoritative) ?? existing.planType;

      await _updateSubscriptionById(existing.id, {
        status: mappedStatus,
        planType,
        providerSubscriptionId,
        providerCustomerId: typeof authoritative.customer === "string" ? authoritative.customer : existing.providerCustomerId,
        currentPeriodStart: authoritative.current_period_start ? new Date(authoritative.current_period_start * 1000) : existing.currentPeriodStart,
        currentPeriodEnd: authoritative.current_period_end ? new Date(authoritative.current_period_end * 1000) : existing.currentPeriodEnd,
        cancelAtPeriodEnd: Boolean(authoritative.cancel_at_period_end),
        ...(enteringPastDue ? { pastDueSince: eventCreatedAt } : {}),
        ...(leavingPastDue ? { pastDueSince: null } : {}),
        // CANCELED (customer-initiated, already flagged cancelAtPeriodEnd)
        // vs EXPIRED (payment failures exhausting retries) is exactly the
        // distinction mapStripeSubscriptionStatus's own comment draws —
        // canceledAt should reflect only the former. It was declared in
        // the dep type and schema but never actually written anywhere;
        // endedAt alone doesn't distinguish why a subscription ended.
        ...(mappedStatus === "CANCELED" ? { canceledAt: eventCreatedAt } : {}),
        ...(isTerminal ? { endedAt: eventCreatedAt } : {}),
        providerSyncedAt: eventCreatedAt,
      });
      // Keep Customer.membershipStatus in lockstep with the subscription's
      // real entitlement-affecting transitions in both directions — not
      // just activation (handled in activateFromCheckoutSession above).
      // PAST_DUE deliberately does NOT trigger a change here: its grace
      // period already keeps the customer entitled (see entitlement.
      // server.ts's PAST_DUE handling), and membershipStatus should stay
      // whatever it already was through that window.
      if (isTerminal) {
        await _updateCustomerMembershipStatus(existing.customerId, "NONE");
      } else if (mappedStatus === "ACTIVE" && existing.status !== "ACTIVE") {
        await _updateCustomerMembershipStatus(existing.customerId, "MEMBER");
      }
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
        status: "SUCCEEDED",
        amount: obj.amount_paid,
        currency: (obj.currency ?? "aed").toUpperCase(),
        // obj.id (the Invoice id), not event.id — an invoice transitions to
        // paid exactly once by construction, so this is a genuine
        // financial-uniqueness key: it also catches two DIFFERENT event ids
        // that both describe the same underlying invoice (Stripe does not
        // guarantee one event id per logical occurrence), not just an exact
        // redelivery of the same event.
        providerTransactionId: obj.payment_intent ?? obj.id,
        occurredAt: eventCreatedAt,
      });
      action = "renewal_recorded";
      break;
    }

    case "invoice.payment_failed": {
      const providerSubscriptionId: string | undefined = obj.subscription;
      if (!providerSubscriptionId) break;
      const existing = await _findSubscriptionByProviderSubscriptionId(providerSubscriptionId);
      if (!existing) break;
      resolvedCustomerId = existing.customerId;
      // Status transitions (e.g. to PAST_DUE) are handled exclusively by
      // customer.subscription.updated, which Stripe fires alongside this —
      // this event only records the failed-charge ledger entry.
      await _createBillingTransaction({
        customerId: existing.customerId,
        subscriptionId: existing.id,
        type: obj.billing_reason === "subscription_cycle" ? "SUBSCRIPTION_RENEWAL" : "SUBSCRIPTION_INITIAL",
        status: "FAILED",
        amount: typeof obj.amount_due === "number" ? obj.amount_due : 0,
        currency: (obj.currency ?? "aed").toUpperCase(),
        // Deliberately NOT the bare obj.id (Invoice id) here, unlike the
        // invoice.paid branch above — an invoice transitions to PAID
        // exactly once, but Stripe's own dunning schedule can fire
        // invoice.payment_failed several times for the SAME invoice id,
        // one per retry attempt, each a genuinely distinct real-world
        // failed charge worth its own ledger row. Keying on the bare
        // invoice id would collapse every retry's failure into the first
        // one, silently losing attempts 2+ to the P2002 absorption below.
        // attempt_count (present on every Stripe Invoice) makes each
        // attempt's key distinct while still being fully stable across a
        // genuine redelivery of the exact same attempt.
        providerTransactionId: obj.payment_intent ?? `${obj.id}:attempt-${obj.attempt_count ?? 0}`,
        occurredAt: eventCreatedAt,
      });
      action = "payment_failure_recorded";
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
