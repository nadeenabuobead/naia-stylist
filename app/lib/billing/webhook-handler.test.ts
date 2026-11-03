// app/lib/billing/webhook-handler.test.ts
// Behavioral tests for Stripe webhook event processing — idempotency,
// out-of-order protection, and the Subscription/BillingTransaction writes
// each event type triggers. No real Prisma, no real DB: every dependency
// is injected via WebhookHandlerDeps, mirroring the EffectiveContextDeps /
// RunReservationFn convention already established in entitlement.server.ts.
//
// Run: node --import tsx/esm --test app/lib/billing/webhook-handler.test.ts

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  processStripeWebhookEvent,
  mapStripeSubscriptionStatus,
  type WebhookHandlerDeps,
  type SubscriptionRecord,
  type StripeEventLike,
} from "./webhook-handler.server";

const CUSTOMER_ID = "cust-webhook-test";

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

// ── checkout.session.completed — activation gated on payment confirmation ───

describe("processStripeWebhookEvent — checkout.session.completed", () => {
  it("WH.3 — payment_status 'paid' creates an ACTIVE Subscription and a SUBSCRIPTION_INITIAL transaction", async () => {
    let created: any = null;
    let transaction: any = null;
    const deps: WebhookHandlerDeps = {
      findProcessedEvent: async () => null,
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
    assert.equal(transaction.amount, 29900);
    assert.equal(transaction.subscriptionId, "sub-new");
    assert.deepEqual(result, { ok: true, deduped: false, action: "subscription_created" });
  });

  it("WH.4 — payment_status NOT 'paid' creates an INCOMPLETE Subscription and records NO transaction — activation is never granted without confirmed payment", async () => {
    let created: any = null;
    let transactionCalls = 0;
    const deps: WebhookHandlerDeps = {
      findProcessedEvent: async () => null,
      createSubscription: async (input) => { created = input; return { ...baseSubscription(), ...input, id: "sub-new" }; },
      createBillingTransaction: async () => { transactionCalls++; },
      recordProcessedEvent: async () => {},
    };
    const event = makeEvent({
      data: { object: { client_reference_id: CUSTOMER_ID, payment_status: "unpaid", customer: "cus_1" } },
    });
    await processStripeWebhookEvent(event, deps);
    assert.equal(created.status, "INCOMPLETE");
    assert.equal(transactionCalls, 0);
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

// ── customer.subscription.updated/.deleted — out-of-order protection ────────

describe("processStripeWebhookEvent — subscription sync + out-of-order guard", () => {
  it("WH.6 — a newer event updates status, period dates, and cancelAtPeriodEnd", async () => {
    let updateId: string | null = null;
    let updateInput: any = null;
    const existing = baseSubscription();
    const deps: WebhookHandlerDeps = {
      findProcessedEvent: async () => null,
      findSubscriptionByProviderSubscriptionId: async () => existing,
      updateSubscriptionById: async (id, input) => { updateId = id; updateInput = input; },
      recordProcessedEvent: async () => {},
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

  it("WH.7 — a STALE (older) event is ignored — never overwrites newer state with older data", async () => {
    let updateCalls = 0;
    const existing = baseSubscription({ providerSyncedAt: new Date("2026-11-15T00:00:00Z") });
    const deps: WebhookHandlerDeps = {
      findProcessedEvent: async () => null,
      findSubscriptionByProviderSubscriptionId: async () => existing,
      updateSubscriptionById: async () => { updateCalls++; },
      recordProcessedEvent: async () => {},
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

  it("WH.8 — falls back to subscription metadata.customerId when no row matches providerSubscriptionId yet (event delivered before checkout.session.completed)", async () => {
    const existing = baseSubscription({ providerSubscriptionId: null, providerSyncedAt: null });
    let lookupCustomerId: string | null = null;
    const deps: WebhookHandlerDeps = {
      findProcessedEvent: async () => null,
      findSubscriptionByProviderSubscriptionId: async () => null,
      findSubscriptionByCustomerId: async (customerId) => { lookupCustomerId = customerId; return existing; },
      updateSubscriptionById: async () => {},
      recordProcessedEvent: async () => {},
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

  it("WH.9 — customer.subscription.deleted after a customer-initiated cancellation (cancelAtPeriodEnd already true) maps to CANCELED, not EXPIRED", async () => {
    let updateInput: any = null;
    const existing = baseSubscription({ cancelAtPeriodEnd: true });
    const deps: WebhookHandlerDeps = {
      findProcessedEvent: async () => null,
      findSubscriptionByProviderSubscriptionId: async () => existing,
      updateSubscriptionById: async (_id, input) => { updateInput = input; },
      recordProcessedEvent: async () => {},
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
    };
    const event = makeEvent({
      type: "customer.subscription.deleted",
      created: 1_700_300_000,
      data: { object: { id: "sub_stripe_1" } },
    });
    await processStripeWebhookEvent(event, deps);
    assert.equal(updateInput.status, "EXPIRED");
  });

  it("WH.11 — no matching Subscription row anywhere (neither providerSubscriptionId nor metadata) is a safe no-op, not a crash", async () => {
    const deps: WebhookHandlerDeps = {
      findProcessedEvent: async () => null,
      findSubscriptionByProviderSubscriptionId: async () => null,
      findSubscriptionByCustomerId: async () => null,
      recordProcessedEvent: async () => {},
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
  it("WH.12 — billing_reason 'subscription_cycle' records a SUBSCRIPTION_RENEWAL transaction", async () => {
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
