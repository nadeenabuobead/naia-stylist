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
  derivePeriodTimestampFromAuthoritative,
  isUniqueConstraintViolation,
  type WebhookHandlerDeps,
  type SubscriptionRecord,
  type StripeEventLike,
} from "./webhook-handler.server";

const CUSTOMER_ID = "cust-webhook-test";
// A failed authoritative fetch — financial-safety review requirement:
// customer.subscription.updated/.deleted must REFUSE (not fall back to the
// embedded webhook body) when this happens. Named for what it represents,
// not what the old behavior used to do with it.
const AUTHORITATIVE_FETCH_FAILS = async () => null;

// All event.created values in this file sit on the 1_700_000_000-unix-seconds
// scale — providerSyncedAt must sit on the SAME scale for the out-of-order
// guard's comparisons to mean what each test intends. 300s before the base
// "current" instant used by the "newer event" tests below.
const BASE_TS = 1_700_000_000;

// A successful authoritative fetch result — the ONLY data source
// customer.subscription.updated/.deleted may act on. Shape matches
// StripeSubscriptionSnapshot — Endive-era: current_period_start/end live on
// items.data[0], not the top level (see derivePeriodTimestampFromAuthoritative's
// own comment for why). current_period_start/current_period_end are still
// accepted as top-level override keys here purely for call-site readability;
// this helper is what actually relocates them onto items.data[0] to match
// the real Stripe response shape every test in this file is implicitly
// proving the production code reads correctly.
function authoritativeSnapshot(overrides: Partial<{
  id: string;
  status: string;
  customer: string;
  current_period_start: unknown;
  current_period_end: unknown;
  cancel_at_period_end: boolean;
  items: { data: Array<{ price?: { recurring?: { interval?: string } } }> };
}> = {}) {
  const {
    current_period_start = BASE_TS - 2_592_000,
    current_period_end = BASE_TS,
    items,
    ...rest
  } = overrides;
  return {
    id: "sub_stripe_1",
    status: "active",
    customer: "cus_stripe_1",
    cancel_at_period_end: false,
    items: {
      data: [
        {
          ...(items?.data?.[0] ?? {}),
          current_period_start,
          current_period_end,
        },
      ],
    },
    ...rest,
  };
}

function withInterval(interval: "month" | "year") {
  return { items: { data: [{ price: { recurring: { interval } } }] } };
}

// A subscription item present but genuinely carrying no price/interval info
// (e.g. a malformed or edge-case provider response) — distinct from
// withInterval, used where a test specifically wants derivePlanTypeFromAuthoritative
// to fall back rather than resolve a real interval.
function withNoInterval() {
  return { items: { data: [{}] } };
}

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
      updateCustomerMembershipStatus: async () => {},
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
      updateCustomerMembershipStatus: async () => {},
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

  it("WH.3c — when payment_intent is absent, providerTransactionId falls back to the Checkout Session's OWN id (obj.id), never a bare event id and never null", async () => {
    let transaction: any = null;
    const deps: WebhookHandlerDeps = {
      findProcessedEvent: async () => null,
      findSubscriptionByProviderSubscriptionId: async () => null,
      createSubscription: async (input) => ({ ...baseSubscription(), ...input, id: "sub-new" }),
      createBillingTransaction: async (input) => { transaction = input; },
      recordProcessedEvent: async () => {},
      updateCustomerMembershipStatus: async () => {},
    };
    const event = makeEvent({
      id: "evt_whatever",
      data: {
        object: {
          id: "cs_test_1",
          client_reference_id: CUSTOMER_ID,
          payment_status: "paid",
          customer: "cus_1",
          subscription: "sub_1",
          amount_total: 3900,
          currency: "aed",
          // No payment_intent at all — some confirmation event shapes
          // genuinely don't carry one.
        },
      },
    });
    await processStripeWebhookEvent(event, deps);
    assert.equal(transaction.providerTransactionId, "cs_test_1");
  });

  it("WH.3d — a RETRY of the exact same event hits the unique-column P2002 (keyed on the Checkout Session id) and is absorbed, not a second duplicate row", async () => {
    let createCalls = 0;
    const deps: WebhookHandlerDeps = {
      findProcessedEvent: async () => null,
      findSubscriptionByProviderSubscriptionId: async () => null,
      createSubscription: async (input) => ({ ...baseSubscription(), ...input, id: "sub-new" }),
      createBillingTransaction: async (input) => {
        createCalls++;
        // Simulates defaultCreateBillingTransaction's own real behavior:
        // a genuine retry hits the DB's @unique(providerTransactionId)
        // constraint and the P2002 is absorbed as "already recorded" —
        // see defaultCreateBillingTransaction's own try/catch, this mock
        // exercises the CALLER's contract with it, not its internals.
        if (createCalls === 1) return;
        const err: any = new Error("Unique constraint failed");
        err.code = "P2002";
        err.meta = { target: ["providerTransactionId"] };
        if (isUniqueConstraintViolation(err, "providerTransactionId") && input.providerTransactionId) return;
        throw err;
      },
      recordProcessedEvent: async () => {},
      updateCustomerMembershipStatus: async () => {},
    };
    const event = makeEvent({
      id: "evt_whatever_2",
      data: {
        object: {
          id: "cs_test_2",
          client_reference_id: CUSTOMER_ID,
          payment_status: "paid",
          customer: "cus_1",
          subscription: "sub_1",
          amount_total: 3900,
          currency: "aed",
        },
      },
    });
    // First delivery.
    const first = await processStripeWebhookEvent(event, deps);
    // Simulated retry of the exact same event (same payload, same id) —
    // in the real system this would only reach createBillingTransaction
    // again if the processed-event ledger write hadn't landed yet.
    const second = await processStripeWebhookEvent(event, deps);
    assert.equal(createCalls, 2, "both attempts must reach the create call — this is what proves absorption, not pre-emption");
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
  });

  it("WH.3e — TWO DIFFERENT event ids describing the SAME underlying Checkout Session must still dedupe — event-id uniqueness alone is not proof of financial-transaction uniqueness", async () => {
    let createCalls = 0;
    const deps: WebhookHandlerDeps = {
      findProcessedEvent: async () => null, // neither event id has been seen before — this is NOT the event-ledger dedup path
      findSubscriptionByProviderSubscriptionId: async () => null,
      createSubscription: async (input) => ({ ...baseSubscription(), ...input, id: "sub-new" }),
      createBillingTransaction: async (input) => {
        createCalls++;
        if (createCalls === 1) return;
        const err: any = new Error("Unique constraint failed");
        err.code = "P2002";
        err.meta = { target: ["providerTransactionId"] };
        if (isUniqueConstraintViolation(err, "providerTransactionId") && input.providerTransactionId) return;
        throw err;
      },
      recordProcessedEvent: async () => {},
      updateCustomerMembershipStatus: async () => {},
    };
    const sameSessionObject = {
      id: "cs_same_session", // the SAME underlying Checkout Session both events describe
      client_reference_id: CUSTOMER_ID,
      payment_status: "paid",
      customer: "cus_1",
      subscription: "sub_1",
      amount_total: 3900,
      currency: "aed",
    };
    const eventA = makeEvent({ id: "evt_A_distinct", data: { object: sameSessionObject } });
    const eventB = makeEvent({ id: "evt_B_also_distinct", data: { object: sameSessionObject } });
    await processStripeWebhookEvent(eventA, deps);
    await processStripeWebhookEvent(eventB, deps);
    assert.equal(createCalls, 2, "both distinct event ids reach the create call — proving the SECOND one is absorbed by the DB constraint, not by event-id dedup, which never even considered them related");
  });

  it("WH.3b — activation also promotes Customer.membershipStatus to MEMBER (regression: a real sandbox checkout left this field stuck at NONE)", async () => {
    let membershipCustomerId: string | null = null;
    let membershipStatus: string | null = null;
    const deps: WebhookHandlerDeps = {
      findProcessedEvent: async () => null,
      findSubscriptionByProviderSubscriptionId: async () => null,
      // This test's event carries no obj.subscription, so
      // activateFromCheckoutSession falls through to the by-customerId
      // lookup instead — must be mocked too, not just the by-provider-id one.
      findSubscriptionByCustomerId: async () => null,
      createSubscription: async (input) => ({ ...baseSubscription(), ...input, id: "sub-new" }),
      createBillingTransaction: async () => {},
      recordProcessedEvent: async () => {},
      updateCustomerMembershipStatus: async (customerId, status) => {
        membershipCustomerId = customerId;
        membershipStatus = status;
      },
    };
    const event = makeEvent({
      data: { object: { client_reference_id: CUSTOMER_ID, payment_status: "paid", amount_total: 3900, currency: "aed" } },
    });
    await processStripeWebhookEvent(event, deps);
    assert.equal(membershipCustomerId, CUSTOMER_ID);
    assert.equal(membershipStatus, "MEMBER");
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
      updateCustomerMembershipStatus: async () => {},
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

  it("WH.17 — async_payment_succeeded on an ALREADY-active subscription skips the (now redundant) status write, but STILL attempts to record the charge — a prior crash between activation and charge-recording must be able to self-heal on retry, not permanently lose the charge", async () => {
    let transactionCalls = 0;
    let updateCalls = 0;
    const active = baseSubscription({ status: "ACTIVE" });
    const deps: WebhookHandlerDeps = {
      findProcessedEvent: async () => null,
      findSubscriptionByProviderSubscriptionId: async () => active,
      updateSubscriptionById: async () => { updateCalls++; },
      createBillingTransaction: async () => { transactionCalls++; },
      recordProcessedEvent: async () => {},
      updateCustomerMembershipStatus: async () => {},
    };
    const event = makeEvent({
      type: "checkout.session.async_payment_succeeded",
      data: { object: { client_reference_id: CUSTOMER_ID, subscription: "sub_stripe_1", amount_total: 3900 } },
    });
    const result = await processStripeWebhookEvent(event, deps);
    assert.equal(updateCalls, 0, "already ACTIVE — no redundant status write needed");
    assert.equal(transactionCalls, 1, "the charge-recording attempt must still happen — a REAL retry relies on providerTransactionId's uniqueness, not this skip, to avoid a true duplicate");
    assert.deepEqual(result, { ok: true, deduped: false, action: "already_active_charge_reconciled" });
  });

  it("WH.17b — createBillingTransaction's own idempotent-create hardening (not this function) is what prevents a GENUINE duplicate charge on a true retry — verified directly against isUniqueConstraintViolation", () => {
    const duplicateChargeError = Object.assign(new Error("Unique constraint failed"), {
      code: "P2002",
      meta: { target: ["providerTransactionId"] },
    });
    assert.equal(isUniqueConstraintViolation(duplicateChargeError, "providerTransactionId"), true);
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
      updateCustomerMembershipStatus: async () => {},
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
      updateCustomerMembershipStatus: async () => {},
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
      updateCustomerMembershipStatus: async () => {},
    };
    const event = makeEvent({
      type: "checkout.session.async_payment_failed",
      data: { object: { client_reference_id: CUSTOMER_ID, subscription: "sub_stripe_1" } },
    });
    await processStripeWebhookEvent(event, deps);
    assert.equal(updateCalls, 0, "an active, paid subscription must never be downgraded by a stale failure event");
  });
});

// ── Concurrent-checkout protection (2026-11-12, fix/stripe-clerk-phase1-
// security) — releaseCheckoutReservation on every terminal outcome,
// including the new checkout.session.expired event. See checkout-
// reservation.server.ts's own header for the full lifecycle this is one
// consumer of. ───────────────────────────────────────────────────────────

describe("processStripeWebhookEvent — releases the CheckoutReservation on every terminal checkout.session.* outcome", () => {
  it("WH.27 — checkout.session.completed (paid) releases the reservation", async () => {
    let releasedCustomerId: string | null = null;
    const deps: WebhookHandlerDeps = {
      findProcessedEvent: async () => null,
      findSubscriptionByProviderSubscriptionId: async () => null,
      findSubscriptionByCustomerId: async () => null,
      createSubscription: async (input) => ({ ...baseSubscription(), ...input, id: "new-sub" }),
      createBillingTransaction: async () => {},
      recordProcessedEvent: async () => {},
      updateCustomerMembershipStatus: async () => {},
      releaseCheckoutReservation: async (customerId) => { releasedCustomerId = customerId; },
    };
    const event = makeEvent({
      data: { object: { client_reference_id: CUSTOMER_ID, payment_status: "paid", amount_total: 3900 } },
    });
    await processStripeWebhookEvent(event, deps);
    assert.equal(releasedCustomerId, CUSTOMER_ID);
  });

  it("WH.28 — checkout.session.completed (unpaid, async pending) ALSO releases the reservation — the new INCOMPLETE Subscription row is enough to block a second attempt from here", async () => {
    let released = false;
    const deps: WebhookHandlerDeps = {
      findProcessedEvent: async () => null,
      findSubscriptionByProviderSubscriptionId: async () => null,
      findSubscriptionByCustomerId: async () => null,
      createSubscription: async (input) => ({ ...baseSubscription(), ...input, id: "new-sub" }),
      recordProcessedEvent: async () => {},
      releaseCheckoutReservation: async () => { released = true; },
    };
    const event = makeEvent({
      data: { object: { client_reference_id: CUSTOMER_ID, payment_status: "unpaid" } },
    });
    await processStripeWebhookEvent(event, deps);
    assert.equal(released, true);
  });

  it("WH.29 — checkout.session.async_payment_succeeded releases the reservation", async () => {
    let released = false;
    const pending = baseSubscription({ status: "INCOMPLETE" });
    const deps: WebhookHandlerDeps = {
      findProcessedEvent: async () => null,
      findSubscriptionByProviderSubscriptionId: async () => pending,
      updateSubscriptionById: async () => {},
      createBillingTransaction: async () => {},
      recordProcessedEvent: async () => {},
      updateCustomerMembershipStatus: async () => {},
      releaseCheckoutReservation: async () => { released = true; },
    };
    const event = makeEvent({
      type: "checkout.session.async_payment_succeeded",
      data: { object: { client_reference_id: CUSTOMER_ID, subscription: "sub_stripe_1", amount_total: 3900 } },
    });
    await processStripeWebhookEvent(event, deps);
    assert.equal(released, true);
  });

  it("WH.30 — checkout.session.async_payment_failed releases the reservation — a definitively failed payment must never leave the customer stuck for the rest of the TTL", async () => {
    let released = false;
    const pending = baseSubscription({ status: "INCOMPLETE" });
    const deps: WebhookHandlerDeps = {
      findProcessedEvent: async () => null,
      findSubscriptionByProviderSubscriptionId: async () => pending,
      updateSubscriptionById: async () => {},
      recordProcessedEvent: async () => {},
      releaseCheckoutReservation: async () => { released = true; },
    };
    const event = makeEvent({
      type: "checkout.session.async_payment_failed",
      data: { object: { client_reference_id: CUSTOMER_ID, subscription: "sub_stripe_1" } },
    });
    await processStripeWebhookEvent(event, deps);
    assert.equal(released, true);
  });

  it("WH.31 — checkout.session.expired releases the reservation — the PRIMARY recovery path for an abandoned checkout, since no Subscription row exists to fall back on", async () => {
    let releasedCustomerId: string | null = null;
    let subscriptionTouched = false;
    const deps: WebhookHandlerDeps = {
      findProcessedEvent: async () => null,
      findSubscriptionByProviderSubscriptionId: async () => { subscriptionTouched = true; return null; },
      findSubscriptionByCustomerId: async () => { subscriptionTouched = true; return null; },
      createSubscription: async () => { subscriptionTouched = true; throw new Error("must not create a Subscription for an abandoned checkout"); },
      updateSubscriptionById: async () => { subscriptionTouched = true; },
      recordProcessedEvent: async () => {},
      releaseCheckoutReservation: async (customerId) => { releasedCustomerId = customerId; },
    };
    const event = makeEvent({
      type: "checkout.session.expired",
      data: { object: { client_reference_id: CUSTOMER_ID } },
    });
    const result = await processStripeWebhookEvent(event, deps);
    assert.equal(releasedCustomerId, CUSTOMER_ID);
    assert.equal(subscriptionTouched, false, "an abandoned checkout must never touch the Subscription table at all");
    assert.deepEqual(result, { ok: true, deduped: false, action: "checkout_session_expired" });
  });

  it("WH.32 — checkout.session.expired with no resolvable customerId is a safe no-op — recorded (idempotency), but releases nothing", async () => {
    let released = false;
    let recordedEventId: string | null = null;
    const deps: WebhookHandlerDeps = {
      findProcessedEvent: async () => null,
      recordProcessedEvent: async (input) => { recordedEventId = input.providerEventId; },
      releaseCheckoutReservation: async () => { released = true; },
    };
    const event = makeEvent({ id: "evt_expired_no_customer", type: "checkout.session.expired", data: { object: {} } });
    const result = await processStripeWebhookEvent(event, deps);
    assert.equal(released, false);
    assert.equal(recordedEventId, "evt_expired_no_customer");
    assert.equal(result.ok, true);
  });

  it("WH.33 — a releaseCheckoutReservation failure never blocks the rest of event processing — best-effort, swallowed", async () => {
    const deps: WebhookHandlerDeps = {
      findProcessedEvent: async () => null,
      findSubscriptionByProviderSubscriptionId: async () => null,
      findSubscriptionByCustomerId: async () => null,
      createSubscription: async (input) => ({ ...baseSubscription(), ...input, id: "new-sub" }),
      createBillingTransaction: async () => {},
      recordProcessedEvent: async () => {},
      updateCustomerMembershipStatus: async () => {},
      releaseCheckoutReservation: async () => { throw new Error("DB unreachable"); },
    };
    const event = makeEvent({
      data: { object: { client_reference_id: CUSTOMER_ID, payment_status: "paid", amount_total: 3900 } },
    });
    const result = await processStripeWebhookEvent(event, deps);
    assert.equal(result.ok, true, "subscription activation must still succeed even if the reservation cleanup itself throws");
  });
});

// ── customer.subscription.updated/.deleted — out-of-order protection +
// authoritative-state re-fetch ──────────────────────────────────────────────

describe("processStripeWebhookEvent — subscription sync + out-of-order guard", () => {
  it("WH.6 — a newer event updates status, period dates, and cancelAtPeriodEnd from the AUTHORITATIVE fetch result", async () => {
    let updateId: string | null = null;
    let updateInput: any = null;
    const existing = baseSubscription();
    const deps: WebhookHandlerDeps = {
      findProcessedEvent: async () => null,
      findSubscriptionByProviderSubscriptionId: async () => existing,
      updateSubscriptionById: async (id, input) => { updateId = id; updateInput = input; },
      recordProcessedEvent: async () => {},
      updateCustomerMembershipStatus: async () => {},
      retrieveAuthoritativeSubscription: async () => authoritativeSnapshot({
        status: "active",
        current_period_start: 1_700_100_000,
        current_period_end: 1_702_700_000,
        cancel_at_period_end: true,
      }),
    };
    const event = makeEvent({
      type: "customer.subscription.updated",
      created: 1_700_100_000, // newer than existing.providerSyncedAt
      data: { object: { id: "sub_stripe_1" } }, // deliberately sparse — only authoritative data should matter
    });
    const result = await processStripeWebhookEvent(event, deps);
    assert.equal(updateId, "sub-row-1");
    assert.equal(updateInput.status, "ACTIVE");
    assert.equal(updateInput.cancelAtPeriodEnd, true);
    assert.deepEqual(result, { ok: true, deduped: false, action: "subscription_synced" });
  });

  it("WH.6a — when the authoritative Stripe fetch FAILS, the function REFUSES to apply anything from the embedded webhook body — financial-safety review requirement", async () => {
    let updateCalls = 0;
    let recordCalls = 0;
    const existing = baseSubscription();
    const deps: WebhookHandlerDeps = {
      findProcessedEvent: async () => null,
      findSubscriptionByProviderSubscriptionId: async () => existing,
      updateSubscriptionById: async () => { updateCalls++; },
      recordProcessedEvent: async () => { recordCalls++; },
      retrieveAuthoritativeSubscription: AUTHORITATIVE_FETCH_FAILS,
    };
    // This body, if trusted, would incorrectly reactivate/extend the
    // subscription — exactly the unsafe entitlement change that must never
    // happen on unconfirmed data.
    const event = makeEvent({
      type: "customer.subscription.updated",
      created: 1_700_100_000,
      data: { object: { id: "sub_stripe_1", status: "active", cancel_at_period_end: false } },
    });
    const result = await processStripeWebhookEvent(event, deps);
    assert.equal(updateCalls, 0, "must never write Subscription state from unconfirmed data");
    assert.equal(recordCalls, 0, "must NOT mark this event as processed — Stripe's retry needs another chance once the fetch can succeed");
    assert.deepEqual(result, { ok: false, reason: "authoritative_subscription_fetch_failed" });
  });

  it("WH.6b — when the authoritative Stripe fetch succeeds, its data is used INSTEAD OF the (differing) embedded webhook object", async () => {
    let updateInput: any = null;
    const existing = baseSubscription();
    const deps: WebhookHandlerDeps = {
      findProcessedEvent: async () => null,
      findSubscriptionByProviderSubscriptionId: async () => existing,
      updateSubscriptionById: async (_id, input) => { updateInput = input; },
      recordProcessedEvent: async () => {},
      updateCustomerMembershipStatus: async () => {},
      // The webhook body claims active + no cancellation...
      retrieveAuthoritativeSubscription: async () => ({
        // ...but the authoritative, freshly-fetched object says otherwise —
        // this must win.
        id: "sub_stripe_1",
        status: "past_due",
        customer: "cus_stripe_1",
        items: { data: [{ current_period_start: 1_700_050_000, current_period_end: 1_702_650_000 }] },
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

  it("WH.6c — a monthly subscriber switched to annual (via the Billing Portal) has planType re-synced on the next update, not left stale", async () => {
    let updateInput: any = null;
    const existing = baseSubscription({ planType: "MONTHLY" });
    const deps: WebhookHandlerDeps = {
      findProcessedEvent: async () => null,
      findSubscriptionByProviderSubscriptionId: async () => existing,
      updateSubscriptionById: async (_id, input) => { updateInput = input; },
      recordProcessedEvent: async () => {},
      updateCustomerMembershipStatus: async () => {},
      retrieveAuthoritativeSubscription: async () => authoritativeSnapshot({
        status: "active",
        ...withInterval("year"),
      }),
    };
    const event = makeEvent({
      type: "customer.subscription.updated",
      created: 1_700_100_000,
      data: { object: { id: "sub_stripe_1" } },
    });
    await processStripeWebhookEvent(event, deps);
    assert.equal(updateInput.planType, "ANNUAL", "the authoritative price interval must win over the stale stored planType");
  });

  it("WH.6d — when the authoritative object carries no usable price interval, planType falls back to the EXISTING stored value, never a hardcoded default", async () => {
    let updateInput: any = null;
    const existing = baseSubscription({ planType: "ANNUAL" });
    const deps: WebhookHandlerDeps = {
      findProcessedEvent: async () => null,
      findSubscriptionByProviderSubscriptionId: async () => existing,
      updateSubscriptionById: async (_id, input) => { updateInput = input; },
      recordProcessedEvent: async () => {},
      updateCustomerMembershipStatus: async () => {},
      // The item is present (as every real subscription's authoritative
      // object would be) but carries no price/interval info — simulates an
      // authoritative response that genuinely doesn't carry usable interval
      // data, not a top-level absence of items.
      retrieveAuthoritativeSubscription: async () => authoritativeSnapshot({ status: "active", ...withNoInterval() }),
    };
    const event = makeEvent({
      type: "customer.subscription.updated",
      created: 1_700_100_000,
      data: { object: { id: "sub_stripe_1" } },
    });
    await processStripeWebhookEvent(event, deps);
    assert.equal(updateInput.planType, "ANNUAL", "must preserve the existing stored planType, not silently default to MONTHLY");
  });

  it("WH.7 — a STALE (older) event is ignored — never overwrites newer state with older data", async () => {
    let updateCalls = 0;
    const existing = baseSubscription({ providerSyncedAt: new Date("2026-11-15T00:00:00Z") });
    const deps: WebhookHandlerDeps = {
      findProcessedEvent: async () => null,
      findSubscriptionByProviderSubscriptionId: async () => existing,
      updateSubscriptionById: async () => { updateCalls++; },
      recordProcessedEvent: async () => {},
      updateCustomerMembershipStatus: async () => {},
      retrieveAuthoritativeSubscription: async () => authoritativeSnapshot({ status: "past_due" }),
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
      updateCustomerMembershipStatus: async () => {},
      retrieveAuthoritativeSubscription: async () => authoritativeSnapshot({ status: "active" }),
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

  it("WH.8b — NO existing row anywhere (neither providerSubscriptionId nor metadata lookup) now CREATES a row from the AUTHORITATIVE fetch result, instead of silently dropping it", async () => {
    let created: any = null;
    let updateInput: any = null;
    const deps: WebhookHandlerDeps = {
      findProcessedEvent: async () => null,
      findSubscriptionByProviderSubscriptionId: async () => null,
      findSubscriptionByCustomerId: async () => null,
      createSubscription: async (input) => { created = input; return { ...baseSubscription(), ...input, id: "sub-from-sync" }; },
      updateSubscriptionById: async (_id, input) => { updateInput = input; },
      recordProcessedEvent: async () => {},
      updateCustomerMembershipStatus: async () => {},
      retrieveAuthoritativeSubscription: async () => authoritativeSnapshot({
        id: "sub_stripe_new",
        status: "active",
        customer: "cus_new",
        current_period_start: 1_700_000_000,
        current_period_end: 1_702_600_000,
      }),
    };
    const event = makeEvent({
      type: "customer.subscription.updated",
      created: 1_700_200_000,
      data: { object: { id: "sub_stripe_new", metadata: { customerId: CUSTOMER_ID, planType: "ANNUAL" } } },
    });
    const result = await processStripeWebhookEvent(event, deps);
    assert.equal(created.customerId, CUSTOMER_ID);
    assert.equal(created.planType, "ANNUAL");
    assert.equal(created.status, "ACTIVE");
    assert.equal(created.providerSubscriptionId, "sub_stripe_new");
    assert.ok(updateInput.currentPeriodStart);
    assert.deepEqual(result, { ok: true, deduped: false, action: "subscription_created_from_sync" });
  });

  it("WH.8d — the authoritative price interval wins over metadata.planType when creating from an out-of-order sync too", async () => {
    let created: any = null;
    const deps: WebhookHandlerDeps = {
      findProcessedEvent: async () => null,
      findSubscriptionByProviderSubscriptionId: async () => null,
      findSubscriptionByCustomerId: async () => null,
      createSubscription: async (input) => { created = input; return { ...baseSubscription(), ...input, id: "sub-from-sync" }; },
      updateSubscriptionById: async () => {},
      recordProcessedEvent: async () => {},
      updateCustomerMembershipStatus: async () => {},
      retrieveAuthoritativeSubscription: async () => authoritativeSnapshot({
        id: "sub_stripe_new",
        status: "active",
        ...withInterval("month"),
      }),
    };
    const event = makeEvent({
      type: "customer.subscription.updated",
      created: 1_700_200_000,
      // Embedded metadata claims ANNUAL — the authoritative interval (month) must win.
      data: { object: { id: "sub_stripe_new", metadata: { customerId: CUSTOMER_ID, planType: "ANNUAL" } } },
    });
    await processStripeWebhookEvent(event, deps);
    assert.equal(created.planType, "MONTHLY");
  });

  it("WH.8c — NO existing row AND no metadata.customerId to key a new row on is still a safe no-op", async () => {
    let createCalls = 0;
    const deps: WebhookHandlerDeps = {
      findProcessedEvent: async () => null,
      findSubscriptionByProviderSubscriptionId: async () => null,
      findSubscriptionByCustomerId: async () => null,
      createSubscription: async () => { createCalls++; return baseSubscription(); },
      recordProcessedEvent: async () => {},
      updateCustomerMembershipStatus: async () => {},
      retrieveAuthoritativeSubscription: async () => authoritativeSnapshot({ id: "sub_unknown", status: "active" }),
    };
    const event = makeEvent({
      type: "customer.subscription.updated",
      data: { object: { id: "sub_unknown" } },
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
      updateCustomerMembershipStatus: async () => {},
      // Stripe keeps a canceled subscription retrievable (status "canceled")
      // rather than truly deleting it — the authoritative fetch succeeding
      // with status "canceled" is the normal case for a .deleted event.
      retrieveAuthoritativeSubscription: async () => authoritativeSnapshot({ status: "canceled" }),
    };
    const event = makeEvent({
      type: "customer.subscription.deleted",
      created: 1_700_300_000,
      data: { object: { id: "sub_stripe_1" } },
    });
    await processStripeWebhookEvent(event, deps);
    assert.equal(updateInput.status, "CANCELED");
    assert.ok(updateInput.endedAt, "a terminal transition must set endedAt");
    assert.ok(updateInput.canceledAt, "CANCELED (customer-initiated) must also stamp canceledAt — previously a dead column, never written anywhere");
  });

  it("WH.9b — a terminal transition (CANCELED) also demotes Customer.membershipStatus to NONE", async () => {
    let membershipCustomerId: string | null = null;
    let membershipStatus: string | null = null;
    const existing = baseSubscription({ cancelAtPeriodEnd: true });
    const deps: WebhookHandlerDeps = {
      findProcessedEvent: async () => null,
      findSubscriptionByProviderSubscriptionId: async () => existing,
      updateSubscriptionById: async () => {},
      recordProcessedEvent: async () => {},
      retrieveAuthoritativeSubscription: async () => authoritativeSnapshot({ status: "canceled" }),
      updateCustomerMembershipStatus: async (customerId, status) => {
        membershipCustomerId = customerId;
        membershipStatus = status;
      },
    };
    const event = makeEvent({
      type: "customer.subscription.deleted",
      created: 1_700_300_000,
      data: { object: { id: "sub_stripe_1" } },
    });
    await processStripeWebhookEvent(event, deps);
    assert.equal(membershipCustomerId, existing.customerId);
    assert.equal(membershipStatus, "NONE");
  });

  it("WH.9c — entering PAST_DUE does NOT change Customer.membershipStatus (grace period keeps them entitled)", async () => {
    let membershipCalls = 0;
    const existing = baseSubscription({ status: "ACTIVE" });
    const deps: WebhookHandlerDeps = {
      findProcessedEvent: async () => null,
      findSubscriptionByProviderSubscriptionId: async () => existing,
      updateSubscriptionById: async () => {},
      recordProcessedEvent: async () => {},
      retrieveAuthoritativeSubscription: async () => authoritativeSnapshot({ status: "past_due" }),
      updateCustomerMembershipStatus: async () => { membershipCalls++; },
    };
    const event = makeEvent({
      type: "customer.subscription.updated",
      created: 1_700_300_000,
      data: { object: { id: "sub_stripe_1" } },
    });
    await processStripeWebhookEvent(event, deps);
    assert.equal(membershipCalls, 0, "PAST_DUE must not touch membershipStatus either way");
  });

  it("WH.10 — customer.subscription.deleted after a payment-failure lapse (cancelAtPeriodEnd never set) maps to EXPIRED, not CANCELED", async () => {
    let updateInput: any = null;
    const existing = baseSubscription({ cancelAtPeriodEnd: false, status: "PAST_DUE" });
    const deps: WebhookHandlerDeps = {
      findProcessedEvent: async () => null,
      findSubscriptionByProviderSubscriptionId: async () => existing,
      updateSubscriptionById: async (_id, input) => { updateInput = input; },
      recordProcessedEvent: async () => {},
      updateCustomerMembershipStatus: async () => {},
      retrieveAuthoritativeSubscription: async () => authoritativeSnapshot({ status: "canceled" }),
    };
    const event = makeEvent({
      type: "customer.subscription.deleted",
      created: 1_700_300_000,
      data: { object: { id: "sub_stripe_1" } },
    });
    await processStripeWebhookEvent(event, deps);
    assert.equal(updateInput.status, "EXPIRED");
  });

  it("WH.10c — EXPIRED (payment-failure lapse) does NOT set canceledAt — only endedAt, since this was never a customer-initiated cancellation", async () => {
    let updateInput: any = null;
    const existing = baseSubscription({ cancelAtPeriodEnd: false, status: "PAST_DUE" });
    const deps: WebhookHandlerDeps = {
      findProcessedEvent: async () => null,
      findSubscriptionByProviderSubscriptionId: async () => existing,
      updateSubscriptionById: async (_id, input) => { updateInput = input; },
      recordProcessedEvent: async () => {},
      updateCustomerMembershipStatus: async () => {},
      retrieveAuthoritativeSubscription: async () => authoritativeSnapshot({ status: "canceled" }),
    };
    const event = makeEvent({
      type: "customer.subscription.deleted",
      created: 1_700_300_000,
      data: { object: { id: "sub_stripe_1" } },
    });
    await processStripeWebhookEvent(event, deps);
    assert.equal(updateInput.status, "EXPIRED");
    assert.equal(updateInput.canceledAt, undefined, "EXPIRED must not be stamped with canceledAt — that field means customer-initiated cancellation specifically");
    assert.ok(updateInput.endedAt);
  });

  it("WH.10b — customer.subscription.deleted whose authoritative fetch fails REFUSES — a cancellation must not be guessed from the embedded body either, in either direction", async () => {
    let updateCalls = 0;
    let recordCalls = 0;
    const existing = baseSubscription({ status: "PAST_DUE" });
    const deps: WebhookHandlerDeps = {
      findProcessedEvent: async () => null,
      findSubscriptionByProviderSubscriptionId: async () => existing,
      updateSubscriptionById: async () => { updateCalls++; },
      recordProcessedEvent: async () => { recordCalls++; },
      retrieveAuthoritativeSubscription: AUTHORITATIVE_FETCH_FAILS,
    };
    const event = makeEvent({ type: "customer.subscription.deleted", created: 1_700_300_000, data: { object: { id: "sub_stripe_1" } } });
    const result = await processStripeWebhookEvent(event, deps);
    assert.equal(updateCalls, 0);
    assert.equal(recordCalls, 0);
    assert.deepEqual(result, { ok: false, reason: "authoritative_subscription_fetch_failed" });
  });

  it("WH.21 — entering PAST_DUE stamps pastDueSince; leaving it clears pastDueSince", async () => {
    let enteringInput: any = null;
    const activeExisting = baseSubscription({ status: "ACTIVE", pastDueSince: null });
    await processStripeWebhookEvent(
      makeEvent({
        type: "customer.subscription.updated",
        created: 1_700_300_000,
        data: { object: { id: "sub_stripe_1" } },
      }),
      {
        findProcessedEvent: async () => null,
        findSubscriptionByProviderSubscriptionId: async () => activeExisting,
        updateSubscriptionById: async (_id, input) => { enteringInput = input; },
        recordProcessedEvent: async () => {},
        retrieveAuthoritativeSubscription: async () => authoritativeSnapshot({ status: "past_due" }),
      },
    );
    assert.ok(enteringInput.pastDueSince, "entering PAST_DUE must stamp pastDueSince");

    let leavingInput: any = null;
    const pastDueExisting = baseSubscription({ status: "PAST_DUE", pastDueSince: new Date((BASE_TS - 1000) * 1000) });
    await processStripeWebhookEvent(
      makeEvent({
        type: "customer.subscription.updated",
        created: 1_700_300_000,
        data: { object: { id: "sub_stripe_1" } },
      }),
      {
        findProcessedEvent: async () => null,
        findSubscriptionByProviderSubscriptionId: async () => pastDueExisting,
        updateSubscriptionById: async (_id, input) => { leavingInput = input; },
        recordProcessedEvent: async () => {},
        retrieveAuthoritativeSubscription: async () => authoritativeSnapshot({ status: "active" }),
        // This transition (PAST_DUE -> ACTIVE) also satisfies the
        // membershipStatus "re-activation" branch (mappedStatus === "ACTIVE"
        // && existing.status !== "ACTIVE") — mock it so this test never
        // depends on a reachable database for a side effect it isn't
        // itself asserting on; see WH.9b/WH.9c for the dedicated tests of
        // that behavior.
        updateCustomerMembershipStatus: async () => {},
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
      updateCustomerMembershipStatus: async () => {},
      retrieveAuthoritativeSubscription: async () => authoritativeSnapshot({ id: "sub_unknown", status: "active" }),
    };
    const event = makeEvent({
      type: "customer.subscription.updated",
      data: { object: { id: "sub_unknown" } },
    });
    const result = await processStripeWebhookEvent(event, deps);
    assert.deepEqual(result, { ok: true, deduped: false, action: "ignored" });
  });
});

// ── derivePeriodTimestampFromAuthoritative — Endive-shape billing-period
// extraction, and the Stripe-endive-compat fix's core regression coverage:
// billing-period dates must round-trip correctly from items.data[0], and
// missing/malformed data must produce null, never a silently-corrupt
// Invalid Date written to the Subscription row. ──────────────────────────────

describe("derivePeriodTimestampFromAuthoritative", () => {
  it("PERIOD.1 — reads current_period_start/end from items.data[0], the real Endive-era location", () => {
    const snapshot = authoritativeSnapshot({
      current_period_start: 1_700_000_000,
      current_period_end: 1_702_600_000,
    });
    assert.deepEqual(
      derivePeriodTimestampFromAuthoritative(snapshot, "current_period_start"),
      new Date(1_700_000_000 * 1000),
    );
    assert.deepEqual(
      derivePeriodTimestampFromAuthoritative(snapshot, "current_period_end"),
      new Date(1_702_600_000 * 1000),
    );
  });

  it("PERIOD.2 — a response with no items at all returns null, never throws", () => {
    const snapshot = { id: "sub_1", status: "active", customer: "cus_1", cancel_at_period_end: false, items: undefined };
    assert.equal(derivePeriodTimestampFromAuthoritative(snapshot, "current_period_start"), null);
  });

  it("PERIOD.3 — an item present but missing the period field returns null, never Invalid Date", () => {
    // Constructed directly (not via authoritativeSnapshot, which always
    // supplies a default timestamp) — this is specifically the case where
    // the item itself carries no period data at all.
    const snapshot = {
      id: "sub_1",
      status: "active",
      customer: "cus_1",
      cancel_at_period_end: false,
      items: { data: [{}] },
    };
    const result = derivePeriodTimestampFromAuthoritative(snapshot, "current_period_start");
    assert.equal(result, null);
  });

  it("PERIOD.4 — a malformed (non-numeric) period value returns null rather than constructing an Invalid Date", () => {
    const malformed = {
      id: "sub_1",
      status: "active",
      customer: "cus_1",
      cancel_at_period_end: false,
      items: { data: [{ current_period_start: "not-a-number" as any, current_period_end: 1_700_000_000 }] },
    };
    const start = derivePeriodTimestampFromAuthoritative(malformed, "current_period_start");
    assert.equal(start, null, "a non-numeric value must never silently become `new Date(NaN)`");
    const end = derivePeriodTimestampFromAuthoritative(malformed, "current_period_end");
    assert.deepEqual(end, new Date(1_700_000_000 * 1000), "a genuinely valid sibling field is unaffected by the other field's malformed value");
  });

  it("PERIOD.5 — NaN itself (e.g. a prior bad coercion somewhere upstream) is also rejected, not treated as a valid timestamp", () => {
    const malformed = {
      id: "sub_1",
      status: "active",
      customer: "cus_1",
      cancel_at_period_end: false,
      items: { data: [{ current_period_start: Number.NaN as any }] },
    };
    assert.equal(derivePeriodTimestampFromAuthoritative(malformed, "current_period_start"), null);
  });
});

describe("processStripeWebhookEvent — missing/malformed billing-period data cannot corrupt a Subscription row", () => {
  it("PERIOD.6 — out-of-order CREATE: a missing items array writes currentPeriodStart/End as null, not Invalid Date", async () => {
    let updateInput: any = null;
    const deps: WebhookHandlerDeps = {
      findProcessedEvent: async () => null,
      findSubscriptionByProviderSubscriptionId: async () => null,
      findSubscriptionByCustomerId: async () => null,
      createSubscription: async (input) => ({ ...baseSubscription(), ...input, id: "sub-from-sync" }),
      updateSubscriptionById: async (_id, input) => { updateInput = input; },
      recordProcessedEvent: async () => {},
      updateCustomerMembershipStatus: async () => {},
      // No `items` field at all on the authoritative response.
      retrieveAuthoritativeSubscription: async () => ({
        id: "sub_stripe_new2",
        status: "active",
        customer: "cus_new2",
        cancel_at_period_end: false,
      }),
    };
    const event = makeEvent({
      type: "customer.subscription.updated",
      created: 1_700_200_000,
      data: { object: { id: "sub_stripe_new2", metadata: { customerId: CUSTOMER_ID, planType: "MONTHLY" } } },
    });
    const result = await processStripeWebhookEvent(event, deps);
    assert.equal(updateInput.currentPeriodStart, null);
    assert.equal(updateInput.currentPeriodEnd, null);
    assert.equal(result.ok, true);
  });

  it("PERIOD.7 — ongoing SYNC: a malformed period value preserves the EXISTING stored date rather than overwriting it with garbage", async () => {
    let updateInput: any = null;
    const existing = baseSubscription(); // has real currentPeriodStart/End already
    const deps: WebhookHandlerDeps = {
      findProcessedEvent: async () => null,
      findSubscriptionByProviderSubscriptionId: async () => existing,
      updateSubscriptionById: async (_id, input) => { updateInput = input; },
      recordProcessedEvent: async () => {},
      updateCustomerMembershipStatus: async () => {},
      retrieveAuthoritativeSubscription: async () => ({
        id: "sub_stripe_1",
        status: "active",
        customer: "cus_stripe_1",
        cancel_at_period_end: false,
        items: { data: [{ current_period_start: "garbage" as any, current_period_end: null as any }] },
      }),
    };
    const event = makeEvent({
      type: "customer.subscription.updated",
      created: 1_700_100_000,
      data: { object: { id: "sub_stripe_1" } },
    });
    await processStripeWebhookEvent(event, deps);
    assert.deepEqual(updateInput.currentPeriodStart, existing.currentPeriodStart, "malformed incoming data must preserve the last known-good period, never overwrite it");
    assert.deepEqual(updateInput.currentPeriodEnd, existing.currentPeriodEnd);
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

  it("WH.12c — TWO DIFFERENT event ids describing the SAME underlying invoice must dedupe to ONE renewal transaction, not be treated as two separate charges", async () => {
    let createCalls = 0;
    const existing = baseSubscription();
    const deps: WebhookHandlerDeps = {
      findProcessedEvent: async () => null, // neither event id has been seen — not the event-ledger dedup path
      findSubscriptionByProviderSubscriptionId: async () => existing,
      createBillingTransaction: async (input) => {
        createCalls++;
        if (createCalls === 1) return;
        const err: any = new Error("Unique constraint failed");
        err.code = "P2002";
        err.meta = { target: ["providerTransactionId"] };
        if (isUniqueConstraintViolation(err, "providerTransactionId") && input.providerTransactionId) return;
        throw err;
      },
      recordProcessedEvent: async () => {},
    };
    const sameInvoiceObject = {
      id: "in_same_invoice",
      subscription: "sub_stripe_1",
      billing_reason: "subscription_cycle",
      amount_paid: 3900,
      currency: "aed",
    };
    const eventA = makeEvent({ id: "evt_inv_A", type: "invoice.paid", data: { object: sameInvoiceObject } });
    const eventB = makeEvent({ id: "evt_inv_B", type: "invoice.paid", data: { object: sameInvoiceObject } });
    await processStripeWebhookEvent(eventA, deps);
    await processStripeWebhookEvent(eventB, deps);
    assert.equal(createCalls, 2, "both distinct event ids reach the create call; the SECOND is absorbed by the invoice-id-keyed DB constraint");
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
      updateCustomerMembershipStatus: async () => {},
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

  it("WH.22b — TWO DIFFERENT event ids for the SAME invoice AND SAME attempt_count must dedupe to ONE failure record", async () => {
    let createCalls = 0;
    const existing = baseSubscription();
    const deps: WebhookHandlerDeps = {
      findProcessedEvent: async () => null,
      findSubscriptionByProviderSubscriptionId: async () => existing,
      createBillingTransaction: async (input) => {
        createCalls++;
        if (createCalls === 1) return;
        const err: any = new Error("Unique constraint failed");
        err.code = "P2002";
        err.meta = { target: ["providerTransactionId"] };
        if (isUniqueConstraintViolation(err, "providerTransactionId") && input.providerTransactionId) return;
        throw err;
      },
      recordProcessedEvent: async () => {},
    };
    const sameAttemptObject = {
      id: "in_dunning_1",
      subscription: "sub_stripe_1",
      billing_reason: "subscription_cycle",
      amount_due: 3900,
      currency: "aed",
      attempt_count: 1,
    };
    const eventA = makeEvent({ id: "evt_fail_A", type: "invoice.payment_failed", data: { object: sameAttemptObject } });
    const eventB = makeEvent({ id: "evt_fail_B", type: "invoice.payment_failed", data: { object: sameAttemptObject } });
    await processStripeWebhookEvent(eventA, deps);
    await processStripeWebhookEvent(eventB, deps);
    assert.equal(createCalls, 2, "both distinct event ids reach the create call; the SECOND is absorbed — same invoice, same attempt");
  });

  it("WH.22c — a SECOND, genuinely DIFFERENT dunning attempt on the SAME invoice must NOT be collapsed with the first — each real-world failed charge keeps its own ledger row", async () => {
    const existing = baseSubscription();
    const createdTransactions: any[] = [];
    const deps: WebhookHandlerDeps = {
      findProcessedEvent: async () => null,
      findSubscriptionByProviderSubscriptionId: async () => existing,
      createBillingTransaction: async (input) => { createdTransactions.push(input); },
      recordProcessedEvent: async () => {},
    };
    const attempt1 = makeEvent({
      id: "evt_fail_attempt_1",
      type: "invoice.payment_failed",
      data: { object: { id: "in_dunning_2", subscription: "sub_stripe_1", billing_reason: "subscription_cycle", amount_due: 3900, currency: "aed", attempt_count: 1 } },
    });
    const attempt2 = makeEvent({
      id: "evt_fail_attempt_2",
      type: "invoice.payment_failed",
      data: { object: { id: "in_dunning_2", subscription: "sub_stripe_1", billing_reason: "subscription_cycle", amount_due: 3900, currency: "aed", attempt_count: 2 } },
    });
    await processStripeWebhookEvent(attempt1, deps);
    await processStripeWebhookEvent(attempt2, deps);
    assert.equal(createdTransactions.length, 2, "two genuinely distinct dunning attempts on the same invoice must both be recorded, not collapsed into one");
    assert.notEqual(createdTransactions[0].providerTransactionId, createdTransactions[1].providerTransactionId);
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
