// app/lib/billing/webhook-handler.test.ts
// Behavioral tests for Stripe webhook event processing — idempotency,
// out-of-order protection, authoritative-state re-fetch, and the
// Subscription/BillingTransaction writes each event type triggers. No real
// Prisma, no real network: every dependency is injected via
// WebhookHandlerDeps, mirroring the EffectiveContextDeps / RunReservationFn
// convention already established in entitlement.server.ts.
//
// retrieveAuthoritativeSubscription is explicitly stubbed to `async () =>
// null` in every test that isn't specifically exercising the authoritative-
// fetch path — this guarantees zero dependence on whatever STRIPE_SECRET_KEY
// happens to be set in the environment running these tests (the real
// default would itself safely no-op without one, but tests should not rely
// on that incidentally).
//
// Run: node --import tsx/esm --test app/lib/billing/webhook-handler.test.ts

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  processStripeWebhookEvent,
  mapStripeSubscriptionStatus,
  isUniqueConstraintViolation,
  type WebhookHandlerDeps,
  type SubscriptionRecord,
  type StripeEventLike,
} from "./webhook-handler.server";

const CUSTOMER_ID = "cust-webhook-test";
const NO_AUTHORITATIVE = async () => null; // forces fallback to the webhook body

// All event.created values in this file sit on the 1_700_000_000-unix-seconds
// scale — providerSyncedAt must sit on the SAME scale for the out-of-order
// guard's comparisons to mean what each test intends. 300s before the base
// "current" instant used by the "newer event" tests below.
const BASE_TS = 1_700_000_000;

function baseSubscription(overrides: Partial<SubscriptionRecord> = {}): SubscriptionRecord {
  return {
    id: "sub-row-1",
    customerId: CUSTOMER_ID,
    status: "ACTIVE",
    planType: "MONTHLY",
    providerCustomerId: "cus_stripe_1",
    providerSubscriptionId: "sub_stripe_1",
    currentPeriodStart: new Date((BASE_TS - 2_592_000) * 1000),
    currentPeriodEnd: new Date(BASE_TS * 1000),
    cancelAtPeriodEnd: false,
    providerSyncedAt: new Date((BASE_TS - 300) * 1000),
    pastDueSince: null,
    ...overrides,
  };
}

function makeEvent(overrides: Partial<StripeEventLike> & { data: { object: any } }): StripeEventLike {
  return {
    id: "evt_1",
    type: "checkout.session.completed",
    created: 1_700_000_000,
    ...overrides,
  } as StripeEventLike;
}

// ── Idempotency ──────────────────────────────────────────────────────────────

describe("processStripeWebhookEvent — idempotency", () => {
  it("WH.1 — a redelivered event (already recorded) is deduped, never reprocessed", async () => {
    let createCalls = 0;
    const deps: WebhookHandlerDeps = {
      findProcessedEvent: async () => ({ id: "already-processed" }),
      createSubscription: async () => { createCalls++; throw new Error("must not be called"); },
    };
    const event = makeEvent({ data: { object: { client_reference_id: CUSTOMER_ID, payment_status: "paid" } } });
    const result = await processStripeWebhookEvent(event, deps);
    assert.deepEqual(result, { ok: true, deduped: true });
    assert.equal(createCalls, 0);
  });

  it("WH.2 — a genuinely new event is recorded in the processed-event ledger exactly once", async () => {
    let recordCalls = 0;
    let recordedEventId: string | null = null;
    const deps: WebhookHandlerDeps = {
      findProcessedEvent: async () => null,
      findSubscriptionByProviderSubscriptionId: async () => null,
      findSubscriptionByCustomerId: async () => null,
      createSubscription: async (input) => ({ ...baseSubscription(), ...input, id: "new-sub" }),
      createBillingTransaction: async () => {},
      recordProcessedEvent: async (input) => { recordCalls++; recordedEventId = input.providerEventId; },
    };
    const event = makeEvent({
      id: "evt_new",
      data: { object: { client_reference_id: CUSTOMER_ID, payment_status: "paid", amount_total: 3900, currency: "aed" } },
    });
    await processStripeWebhookEvent(event, deps);
    assert.equal(recordCalls, 1);
    assert.equal(recordedEventId, "evt_new");
  });
});

// ── checkout.session.completed — synchronous activation ─────────────────────

describe("processStripeWebhookEvent — checkout.session.completed (synchronous payment)", () => {
  it("WH.3 — payment_status 'paid' creates an ACTIVE Subscription and a SUBSCRIPTION_INITIAL transaction", async () => {
    let created: any = null;
    let transaction: any = null;
    const deps: WebhookHandlerDeps = {
      findProcessedEvent: async () => null,
      findSubscriptionByProviderSubscriptionId: async () => null,
      createSubscription: async (input) => { created = input; return { ...baseSubscription(), ...input, id: "sub-new" }; },
      createBillingTransaction: async (input) => { transaction = input; },
      recordProcessedEvent: async () => {},
    };
    const event = makeEvent({
      data: {
        object: {
          client_reference_id: CUSTOMER_ID,
          metadata: { planType: "ANNUAL" },
          payment_status: "paid",
          customer: "cus_1",
          subscription: "sub_1",
          amount_total: 29900,
          currency: "aed",
          payment_intent: "pi_1",
        },
      },
    });
    const result = await processStripeWebhookEvent(event, deps);
    assert.equal(created.status, "ACTIVE");
    assert.equal(created.planType, "ANNUAL");
    assert.equal(created.providerSubscriptionId, "sub_1");
    assert.equal(transaction.type, "SUBSCRIPTION_INITIAL");
    assert.equal(transaction.status, "SUCCEEDED");
    assert.equal(transaction.amount, 29900);
    assert.equal(transaction.subscriptionId, "sub-new");
    assert.deepEqual(result, { ok: true, deduped: false, action: "subscription_activated" });
  });

  it("WH.4 — payment_status NOT 'paid' creates an INCOMPLETE Subscription and records NO transaction — activation is never granted without confirmed payment", async () => {
    let created: any = null;
    let transactionCalls = 0;
    const deps: WebhookHandlerDeps = {
      findProcessedEvent: async () => null,
      findSubscriptionByProviderSubscriptionId: async () => null,
      createSubscription: async (input) => { created = input; return { ...baseSubscription(), ...input, id: "sub-new" }; },
      createBillingTransaction: async () => { transactionCalls++; },
      recordProcessedEvent: async () => {},
    };
    const event = makeEvent({
      data: { object: { client_reference_id: CUSTOMER_ID, payment_status: "unpaid", customer: "cus_1", subscription: "sub_1" } },
    });
    const result = await processStripeWebhookEvent(event, deps);
    assert.equal(created.status, "INCOMPLETE");
    assert.equal(transactionCalls, 0);
    assert.equal(result.ok, true);
    if (result.ok && !result.deduped) assert.equal(result.action, "subscription_created_pending_async_payment");
  });

  it("WH.4b — payment_status NOT 'paid' but a row already exists for this providerSubscriptionId (out-of-order sync already created it) does not create a second row", async () => {
    let createCalls = 0;
    const existing = baseSubscription({ status: "INCOMPLETE" });
    const deps: WebhookHandlerDeps = {
      findProcessedEvent: async () => null,
      findSubscriptionByProviderSubscriptionId: async () => existing,
      createSubscription: async () => { createCalls++; throw new Error("must not create a duplicate row"); },
      recordProcessedEvent: async () => {},
    };
    const event = makeEvent({
      data: { object: { client_reference_id: CUSTOMER_ID, payment_status: "unpaid", subscription: "sub_stripe_1" } },
    });
    await processStripeWebhookEvent(event, deps);
    assert.equal(createCalls, 0);
  });

  it("WH.5 — a session with no resolvable customerId (client_reference_id and metadata both absent) touches nothing", async () => {
    let createCalls = 0;
    const deps: WebhookHandlerDeps = {
      findProcessedEvent: async () => null,
      createSubscription: async () => { createCalls++; return baseSubscription(); },
      recordProcessedEvent: async () => {},
    };
    const event = makeEvent({ data: { object: { payment_status: "paid" } } });
    const result = await processStripeWebhookEvent(event, deps);
    assert.equal(createCalls, 0);
    assert.equal(result.ok, true);
  });
});

// ── checkout.session.async_payment_succeeded / .async_payment_failed ───────
// Asynchronous payment methods (e.g. bank debits): checkout.session.completed
// fires with payment_status "unpaid" and creates an INCOMPLETE row; these two
// events are the DEFERRED confirmation/rejection of that same payment.

describe("processStripeWebhookEvent — asynchronous payment confirmation", () => {
  it("WH.16 — async_payment_succeeded activates a pending INCOMPLETE subscription and records the initial transaction", async () => {
    let updateId: string | null = null;
    let updateInput: any = null;
    let transaction: any = null;
    const pending = baseSubscription({ status: "INCOMPLETE" });
    const deps: WebhookHandlerDeps = {
      findProcessedEvent: async () => null,
      findSubscriptionByProviderSubscriptionId: async () => pending,
      updateSubscriptionById: async (id, input) => { updateId = id; updateInput = input; },
      createBillingTransaction: async (input) => { transaction = input; },
      recordProcessedEvent: async () => {},
    };
    const event = makeEvent({
      type: "checkout.session.async_payment_succeeded",
      data: {
        object: {
          client_reference_id: CUSTOMER_ID,
          subscription: "sub_stripe_1",
          amount_total: 3900,
          currency: "aed",
          payment_intent: "pi_async_1",
        },
      },
    });
    const result = await processStripeWebhookEvent(event, deps);
    assert.equal(updateId, "sub-row-1");
    assert.equal(updateInput.status, "ACTIVE");
    assert.equal(updateInput.pastDueSince, null);
    assert.equal(transaction.type, "SUBSCRIPTION_INITIAL");
    assert.equal(transaction.status, "SUCCEEDED");
    assert.deepEqual(result, { ok: true, deduped: false, action: "subscription_activated" });
  });

  it("WH.17 — async_payment_succeeded on an ALREADY-active subscription is a safe no-op, not a duplicate charge", async () => {
    let transactionCalls = 0;
    let updateCalls = 0;
    const active = baseSubscription({ status: "ACTIVE" });
    const deps: WebhookHandlerDeps = {
      findProcessedEvent: async () => null,
      findSubscriptionByProviderSubscriptionId: async () => active,
      updateSubscriptionById: async () => { updateCalls++; },
      createBillingTransaction: async () => { transactionCalls++; },
      recordProcessedEvent: async () => {},
    };
    const event = makeEvent({
      type: "checkout.session.async_payment_succeeded",
      data: { object: { client_reference_id: CUSTOMER_ID, subscription: "sub_stripe_1", amount_total: 3900 } },
    });
    const result = await processStripeWebhookEvent(event, deps);
    assert.equal(transactionCalls, 0);
    assert.equal(updateCalls, 0);
    assert.deepEqual(result, { ok: true, deduped: false, action: "already_active" });
  });

  it("WH.18 — async_payment_succeeded arriving AFTER the subscription was already canceled/expired must not resurrect it", async () => {
    let updateCalls = 0;
    let transactionCalls = 0;
    const canceled = baseSubscription({ status: "CANCELED" });
    const deps: WebhookHandlerDeps = {
      findProcessedEvent: async () => null,
      findSubscriptionByProviderSubscriptionId: async () => canceled,
      updateSubscriptionById: async () => { updateCalls++; },
      createBillingTransaction: async () => { transactionCalls++; },
      recordProcessedEvent: async () => {},
    };
    const event = makeEvent({
      type: "checkout.session.async_payment_succeeded",
      data: { object: { client_reference_id: CUSTOMER_ID, subscription: "sub_stripe_1", amount_total: 3900 } },
    });
    const result = await processStripeWebhookEvent(event, deps);
    assert.equal(updateCalls, 0, "must never set status back to ACTIVE on a subscription already decided otherwise");
    assert.equal(transactionCalls, 0);
    assert.deepEqual(result, { ok: true, deduped: false, action: "superseded_by_later_state" });
  });

  it("WH.19 — async_payment_failed marks a pending INCOMPLETE subscription EXPIRED, not left lingering", async () => {
    let updateInput: any = null;
    const pending = baseSubscription({ status: "INCOMPLETE" });
    const deps: WebhookHandlerDeps = {
      findProcessedEvent: async () => null,
      findSubscriptionByProviderSubscriptionId: async () => pending,
      updateSubscriptionById: async (_id, input) => { updateInput = input; },
      recordProcessedEvent: async () => {},
    };
    const event = makeEvent({
      type: "checkout.session.async_payment_failed",
      data: { object: { client_reference_id: CUSTOMER_ID, subscription: "sub_stripe_1" } },
    });
    const result = await processStripeWebhookEvent(event, deps);
    assert.equal(updateInput.status, "EXPIRED");
    assert.ok(updateInput.endedAt);
    assert.equal(result.ok, true);
  });

  it("WH.20 — async_payment_failed on an already-ACTIVE subscription (stale/out-of-order failure) must not downgrade it", async () => {
    let updateCalls = 0;
    const active = baseSubscription({ status: "ACTIVE" });
    const deps: WebhookHandlerDeps = {
      findProcessedEvent: async () => null,
      findSubscriptionByProviderSubscriptionId: async () => active,
      updateSubscriptionById: async () => { updateCalls++; },
      recordProcessedEvent: async () => {},
    };
    const event = makeEvent({
      type: "checkout.session.async_payment_failed",
      data: { object: { client_reference_id: CUSTOMER_ID, subscription: "sub_stripe_1" } },
    });
    await processStripeWebhookEvent(event, deps);
    assert.equal(updateCalls, 0, "an active, paid subscription must never be downgraded by a stale failure event");
  });
});

// ── customer.subscription.updated/.deleted — out-of-order protection +
// authoritative-state re-fetch ──────────────────────────────────────────────

describe("processStripeWebhookEvent — subscription sync + out-of-order guard", () => {
  it("WH.6 — a newer event updates status, period dates, and cancelAtPeriodEnd (falling back to the webhook body when the authoritative fetch is unavailable)", async () => {
    let updateId: string | null = null;
    let updateInput: any = null;
    const existing = baseSubscription();
    const deps: WebhookHandlerDeps = {
      findProcessedEvent: async () => null,
      findSubscriptionByProviderSubscriptionId: async () => existing,
      updateSubscriptionById: async (id, input) => { updateId = id; updateInput = input; },
      recordProcessedEvent: async () => {},
      retrieveAuthoritativeSubscription: NO_AUTHORITATIVE,
    };
    const event = makeEvent({
      type: "customer.subscription.updated",
      created: 1_700_100_000, // newer than existing.providerSyncedAt
      data: {
        object: {
          id: "sub_stripe_1",
          status: "active",
          current_period_start: 1_700_100_000,
          current_period_end: 1_702_700_000,
          cancel_at_period_end: true,
          customer: "cus_stripe_1",
        },
      },
    });
    const result = await processStripeWebhookEvent(event, deps);
    assert.equal(updateId, "sub-row-1");
    assert.equal(updateInput.status, "ACTIVE");
    assert.equal(updateInput.cancelAtPeriodEnd, true);
    assert.deepEqual(result, { ok: true, deduped: false, action: "subscription_synced" });
  });

  it("WH.6b — when the authoritative Stripe fetch succeeds, its data is used INSTEAD OF the (differing) embedded webhook object", async () => {
    let updateInput: any = null;
    const existing = baseSubscription();
    const deps: WebhookHandlerDeps = {
      findProcessedEvent: async () => null,
      findSubscriptionByProviderSubscriptionId: async () => existing,
      updateSubscriptionById: async (_id, input) => { updateInput = input; },
      recordProcessedEvent: async () => {},
      // The webhook body claims active + no cancellation...
      retrieveAuthoritativeSubscription: async () => ({
        // ...but the authoritative, freshly-fetched object says otherwise —
        // this must win.
        id: "sub_stripe_1",
        status: "past_due",
        customer: "cus_stripe_1",
        current_period_start: 1_700_050_000,
        current_period_end: 1_702_650_000,
        cancel_at_period_end: true,
      }),
    };
    const event = makeEvent({
      type: "customer.subscription.updated",
      created: 1_700_100_000,
      data: { object: { id: "sub_stripe_1", status: "active", cancel_at_period_end: false, customer: "cus_stripe_1" } },
    });
    await processStripeWebhookEvent(event, deps);
    assert.equal(updateInput.status, "PAST_DUE", "the authoritative fetch's status must win over the embedded webhook body");
    assert.equal(updateInput.cancelAtPeriodEnd, true);
    assert.ok(updateInput.pastDueSince, "entering PAST_DUE (per the authoritative state) must stamp pastDueSince");
  });

  it("WH.7 — a STALE (older) event is ignored — never overwrites newer state with older data", async () => {
    let updateCalls = 0;
    const existing = baseSubscription({ providerSyncedAt: new Date("2026-11-15T00:00:00Z") });
    const deps: WebhookHandlerDeps = {
      findProcessedEvent: async () => null,
      findSubscriptionByProviderSubscriptionId: async () => existing,
      updateSubscriptionById: async () => { updateCalls++; },
      recordProcessedEvent: async () => {},
      retrieveAuthoritativeSubscription: NO_AUTHORITATIVE,
    };
    // event.created is well before providerSyncedAt — a delayed/out-of-order redelivery
    const event = makeEvent({
      type: "customer.subscription.updated",
      created: Math.floor(new Date("2026-11-01T00:00:00Z").getTime() / 1000),
      data: { object: { id: "sub_stripe_1", status: "past_due" } },
    });
    const result = await processStripeWebhookEvent(event, deps);
    assert.equal(updateCalls, 0, "a stale event must never call updateSubscriptionById");
    assert.deepEqual(result, { ok: true, deduped: false, action: "stale_event_ignored" });
  });

  it("WH.8 — falls back to subscription metadata.customerId when no row matches providerSubscriptionId yet, and reconciles against the existing row found that way", async () => {
    const existing = baseSubscription({ providerSubscriptionId: null, providerSyncedAt: null });
    let lookupCustomerId: string | null = null;
    const deps: WebhookHandlerDeps = {
      findProcessedEvent: async () => null,
      findSubscriptionByProviderSubscriptionId: async () => null,
      findSubscriptionByCustomerId: async (customerId) => { lookupCustomerId = customerId; return existing; },
      updateSubscriptionById: async () => {},
      recordProcessedEvent: async () => {},
      retrieveAuthoritativeSubscription: NO_AUTHORITATIVE,
    };
    const event = makeEvent({
      type: "customer.subscription.updated",
      created: 1_700_200_000,
      data: { object: { id: "sub_stripe_1", status: "active", metadata: { customerId: CUSTOMER_ID } } },
    });
    const result = await processStripeWebhookEvent(event, deps);
    assert.equal(lookupCustomerId, CUSTOMER_ID);
    assert.equal(result.ok, true);
  });

  it("WH.8b — NO existing row anywhere (neither providerSubscriptionId nor metadata lookup) now CREATES a row from the event's own data, instead of silently dropping it", async () => {
    let created: any = null;
    let updateInput: any = null;
    const deps: WebhookHandlerDeps = {
      findProcessedEvent: async () => null,
      findSubscriptionByProviderSubscriptionId: async () => null,
      findSubscriptionByCustomerId: async () => null,
      createSubscription: async (input) => { created = input; return { ...baseSubscription(), ...input, id: "sub-from-sync" }; },
      updateSubscriptionById: async (_id, input) => { updateInput = input; },
      recordProcessedEvent: async () => {},
      retrieveAuthoritativeSubscription: NO_AUTHORITATIVE,
    };
    const event = makeEvent({
      type: "customer.subscription.updated",
      created: 1_700_200_000,
      data: {
        object: {
          id: "sub_stripe_new",
          status: "active",
          customer: "cus_new",
          current_period_start: 1_700_000_000,
          current_period_end: 1_702_600_000,
          metadata: { customerId: CUSTOMER_ID, planType: "ANNUAL" },
        },
      },
    });
    const result = await processStripeWebhookEvent(event, deps);
    assert.equal(created.customerId, CUSTOMER_ID);
    assert.equal(created.planType, "ANNUAL");
    assert.equal(created.status, "ACTIVE");
    assert.equal(created.providerSubscriptionId, "sub_stripe_new");
    assert.ok(updateInput.currentPeriodStart);
    assert.deepEqual(result, { ok: true, deduped: false, action: "subscription_created_from_sync" });
  });

  it("WH.8c — NO existing row AND no metadata.customerId to key a new row on is still a safe no-op", async () => {
    let createCalls = 0;
    const deps: WebhookHandlerDeps = {
      findProcessedEvent: async () => null,
      findSubscriptionByProviderSubscriptionId: async () => null,
      findSubscriptionByCustomerId: async () => null,
      createSubscription: async () => { createCalls++; return baseSubscription(); },
      recordProcessedEvent: async () => {},
      retrieveAuthoritativeSubscription: NO_AUTHORITATIVE,
    };
    const event = makeEvent({
      type: "customer.subscription.updated",
      data: { object: { id: "sub_unknown", status: "active" } },
    });
    const result = await processStripeWebhookEvent(event, deps);
    assert.equal(createCalls, 0);
    assert.deepEqual(result, { ok: true, deduped: false, action: "ignored" });
  });

  it("WH.9 — customer.subscription.deleted after a customer-initiated cancellation (cancelAtPeriodEnd already true) maps to CANCELED, not EXPIRED", async () => {
    let updateInput: any = null;
    const existing = baseSubscription({ cancelAtPeriodEnd: true });
    const deps: WebhookHandlerDeps = {
      findProcessedEvent: async () => null,
      findSubscriptionByProviderSubscriptionId: async () => existing,
      updateSubscriptionById: async (_id, input) => { updateInput = input; },
      recordProcessedEvent: async () => {},
      retrieveAuthoritativeSubscription: NO_AUTHORITATIVE,
    };
    const event = makeEvent({
      type: "customer.subscription.deleted",
      created: 1_700_300_000,
      data: { object: { id: "sub_stripe_1" } },
    });
    await processStripeWebhookEvent(event, deps);
    assert.equal(updateInput.status, "CANCELED");
    assert.ok(updateInput.endedAt, "a terminal transition must set endedAt");
  });

  it("WH.10 — customer.subscription.deleted after a payment-failure lapse (cancelAtPeriodEnd never set) maps to EXPIRED, not CANCELED", async () => {
    let updateInput: any = null;
    const existing = baseSubscription({ cancelAtPeriodEnd: false, status: "PAST_DUE" });
    const deps: WebhookHandlerDeps = {
      findProcessedEvent: async () => null,
      findSubscriptionByProviderSubscriptionId: async () => existing,
      updateSubscriptionById: async (_id, input) => { updateInput = input; },
      recordProcessedEvent: async () => {},
      retrieveAuthoritativeSubscription: NO_AUTHORITATIVE,
    };
    const event = makeEvent({
      type: "customer.subscription.deleted",
      created: 1_700_300_000,
      data: { object: { id: "sub_stripe_1" } },
    });
    await processStripeWebhookEvent(event, deps);
    assert.equal(updateInput.status, "EXPIRED");
  });

  it("WH.21 — entering PAST_DUE stamps pastDueSince; leaving it clears pastDueSince", async () => {
    let enteringInput: any = null;
    const activeExisting = baseSubscription({ status: "ACTIVE", pastDueSince: null });
    await processStripeWebhookEvent(
      makeEvent({
        type: "customer.subscription.updated",
        created: 1_700_300_000,
        data: { object: { id: "sub_stripe_1", status: "past_due" } },
      }),
      {
        findProcessedEvent: async () => null,
        findSubscriptionByProviderSubscriptionId: async () => activeExisting,
        updateSubscriptionById: async (_id, input) => { enteringInput = input; },
        recordProcessedEvent: async () => {},
        retrieveAuthoritativeSubscription: NO_AUTHORITATIVE,
      },
    );
    assert.ok(enteringInput.pastDueSince, "entering PAST_DUE must stamp pastDueSince");

    let leavingInput: any = null;
    const pastDueExisting = baseSubscription({ status: "PAST_DUE", pastDueSince: new Date((BASE_TS - 1000) * 1000) });
    await processStripeWebhookEvent(
      makeEvent({
        type: "customer.subscription.updated",
        created: 1_700_300_000,
        data: { object: { id: "sub_stripe_1", status: "active" } },
      }),
      {
        findProcessedEvent: async () => null,
        findSubscriptionByProviderSubscriptionId: async () => pastDueExisting,
        updateSubscriptionById: async (_id, input) => { leavingInput = input; },
        recordProcessedEvent: async () => {},
        retrieveAuthoritativeSubscription: NO_AUTHORITATIVE,
      },
    );
    assert.equal(leavingInput.pastDueSince, null, "leaving PAST_DUE must clear pastDueSince");
  });

  it("WH.11 — no matching Subscription row anywhere and no metadata to create from is a safe no-op, not a crash", async () => {
    const deps: WebhookHandlerDeps = {
      findProcessedEvent: async () => null,
      findSubscriptionByProviderSubscriptionId: async () => null,
      findSubscriptionByCustomerId: async () => null,
      recordProcessedEvent: async () => {},
      retrieveAuthoritativeSubscription: NO_AUTHORITATIVE,
    };
    const event = makeEvent({
      type: "customer.subscription.updated",
      data: { object: { id: "sub_unknown", status: "active" } },
    });
    const result = await processStripeWebhookEvent(event, deps);
    assert.deepEqual(result, { ok: true, deduped: false, action: "ignored" });
  });
});

// ── invoice.paid — renewal ledger entries only, never the initial charge ────

describe("processStripeWebhookEvent — invoice.paid renewals", () => {
  it("WH.12 — billing_reason 'subscription_cycle' records a SUCCEEDED SUBSCRIPTION_RENEWAL transaction", async () => {
    let transaction: any = null;
    const existing = baseSubscription();
    const deps: WebhookHandlerDeps = {
      findProcessedEvent: async () => null,
      findSubscriptionByProviderSubscriptionId: async () => existing,
      createBillingTransaction: async (input) => { transaction = input; },
      recordProcessedEvent: async () => {},
    };
    const event = makeEvent({
      type: "invoice.paid",
      data: { object: { subscription: "sub_stripe_1", billing_reason: "subscription_cycle", amount_paid: 3900, currency: "aed" } },
    });
    await processStripeWebhookEvent(event, deps);
    assert.equal(transaction.type, "SUBSCRIPTION_RENEWAL");
    assert.equal(transaction.status, "SUCCEEDED");
    assert.equal(transaction.amount, 3900);
    assert.equal(transaction.subscriptionId, "sub-row-1");
  });

  it("WH.13 — a non-renewal billing_reason (e.g. the very first invoice) records nothing — checkout.session.completed already recorded the initial charge", async () => {
    let transactionCalls = 0;
    const deps: WebhookHandlerDeps = {
      findProcessedEvent: async () => null,
      createBillingTransaction: async () => { transactionCalls++; },
      recordProcessedEvent: async () => {},
    };
    const event = makeEvent({
      type: "invoice.paid",
      data: { object: { subscription: "sub_stripe_1", billing_reason: "subscription_create", amount_paid: 3900 } },
    });
    await processStripeWebhookEvent(event, deps);
    assert.equal(transactionCalls, 0);
  });
});

// ── invoice.payment_failed — failed-charge ledger entries, status untouched ─

describe("processStripeWebhookEvent — invoice.payment_failed", () => {
  it("WH.22 — records a FAILED SUBSCRIPTION_RENEWAL transaction for a renewal failure, and never touches Subscription.status itself", async () => {
    let transaction: any = null;
    let updateCalls = 0;
    const existing = baseSubscription();
    const deps: WebhookHandlerDeps = {
      findProcessedEvent: async () => null,
      findSubscriptionByProviderSubscriptionId: async () => existing,
      createBillingTransaction: async (input) => { transaction = input; },
      updateSubscriptionById: async () => { updateCalls++; },
      recordProcessedEvent: async () => {},
    };
    const event = makeEvent({
      type: "invoice.payment_failed",
      data: { object: { subscription: "sub_stripe_1", billing_reason: "subscription_cycle", amount_due: 3900, currency: "aed" } },
    });
    const result = await processStripeWebhookEvent(event, deps);
    assert.equal(transaction.type, "SUBSCRIPTION_RENEWAL");
    assert.equal(transaction.status, "FAILED");
    assert.equal(transaction.amount, 3900);
    assert.equal(updateCalls, 0, "status transitions belong exclusively to customer.subscription.updated");
    assert.deepEqual(result, { ok: true, deduped: false, action: "payment_failure_recorded" });
  });

  it("WH.23 — a first-invoice failure (billing_reason subscription_create) records SUBSCRIPTION_INITIAL, not _RENEWAL", async () => {
    let transaction: any = null;
    const existing = baseSubscription({ status: "INCOMPLETE" });
    const deps: WebhookHandlerDeps = {
      findProcessedEvent: async () => null,
      findSubscriptionByProviderSubscriptionId: async () => existing,
      createBillingTransaction: async (input) => { transaction = input; },
      recordProcessedEvent: async () => {},
    };
    const event = makeEvent({
      type: "invoice.payment_failed",
      data: { object: { subscription: "sub_stripe_1", billing_reason: "subscription_create", amount_due: 3900 } },
    });
    await processStripeWebhookEvent(event, deps);
    assert.equal(transaction.type, "SUBSCRIPTION_INITIAL");
    assert.equal(transaction.status, "FAILED");
  });

  it("WH.24 — no matching Subscription row is a safe no-op", async () => {
    let transactionCalls = 0;
    const deps: WebhookHandlerDeps = {
      findProcessedEvent: async () => null,
      findSubscriptionByProviderSubscriptionId: async () => null,
      createBillingTransaction: async () => { transactionCalls++; },
      recordProcessedEvent: async () => {},
    };
    const event = makeEvent({
      type: "invoice.payment_failed",
      data: { object: { subscription: "sub_unknown", billing_reason: "subscription_cycle", amount_due: 3900 } },
    });
    const result = await processStripeWebhookEvent(event, deps);
    assert.equal(transactionCalls, 0);
    assert.deepEqual(result, { ok: true, deduped: false, action: "ignored" });
  });
});

// ── Unrecognized events — ignored, not errors ───────────────────────────────

describe("processStripeWebhookEvent — unhandled event types", () => {
  it("WH.14 — an event type this integration doesn't act on is recorded (idempotency) but never throws", async () => {
    let recordCalls = 0;
    const deps: WebhookHandlerDeps = {
      findProcessedEvent: async () => null,
      recordProcessedEvent: async () => { recordCalls++; },
    };
    const event = makeEvent({ type: "payment_intent.created", data: { object: {} } });
    const result = await processStripeWebhookEvent(event, deps);
    assert.equal(recordCalls, 1);
    assert.deepEqual(result, { ok: true, deduped: false, action: "ignored" });
  });
});

// ── Status mapping — pure function, direct coverage of every branch ────────

describe("mapStripeSubscriptionStatus", () => {
  it("WH.15 — maps every Stripe status to the correct SubscriptionStatus", () => {
    assert.equal(mapStripeSubscriptionStatus("active", null), "ACTIVE");
    assert.equal(mapStripeSubscriptionStatus("past_due", null), "PAST_DUE");
    assert.equal(mapStripeSubscriptionStatus("unpaid", null), "PAST_DUE");
    assert.equal(mapStripeSubscriptionStatus("trialing", null), "INCOMPLETE");
    assert.equal(mapStripeSubscriptionStatus("incomplete", null), "INCOMPLETE");
    assert.equal(mapStripeSubscriptionStatus("incomplete_expired", null), "EXPIRED");
    assert.equal(mapStripeSubscriptionStatus("canceled", { cancelAtPeriodEnd: true }), "CANCELED");
    assert.equal(mapStripeSubscriptionStatus("canceled", { cancelAtPeriodEnd: false }), "EXPIRED");
    assert.equal(mapStripeSubscriptionStatus("canceled", null), "EXPIRED");
    assert.equal(mapStripeSubscriptionStatus("some_future_stripe_status", null), "INCOMPLETE");
  });
});

// ── Idempotent-create hardening — the P2002 detection helper ────────────────

describe("isUniqueConstraintViolation", () => {
  it("WH.25 — recognizes a Prisma P2002 error, optionally scoped to a specific field", () => {
    const err = Object.assign(new Error("Unique constraint failed"), { code: "P2002", meta: { target: ["providerSubscriptionId"] } });
    assert.equal(isUniqueConstraintViolation(err), true);
    assert.equal(isUniqueConstraintViolation(err, "providerSubscriptionId"), true);
    assert.equal(isUniqueConstraintViolation(err, "providerTransactionId"), false, "must not match a DIFFERENT unique field");
  });

  it("WH.26 — rejects a non-P2002 error, and a field-scoped check never false-positives on an unrelated error shape", () => {
    assert.equal(isUniqueConstraintViolation(new Error("boom")), false);
    assert.equal(isUniqueConstraintViolation({ code: "P2034" }), false);
    assert.equal(isUniqueConstraintViolation(null), false);
    assert.equal(isUniqueConstraintViolation(undefined), false);
  });
});
