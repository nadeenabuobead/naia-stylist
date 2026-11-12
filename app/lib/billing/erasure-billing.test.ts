// app/lib/billing/erasure-billing.test.ts
// Behavioral tests for Stripe billing cancellation during account erasure
// (fix/stripe-clerk-phase1-security, 2026-11-12). No real Prisma, no real
// Stripe: every dependency is injected via CancelActiveBillingDeps, mirroring
// the WebhookHandlerDeps / CheckoutReservationDeps convention already
// established elsewhere in app/lib/billing.
//
// Run: node --import tsx/esm --test app/lib/billing/erasure-billing.test.ts

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { cancelActiveBillingForErasure } from "./erasure-billing.server";
import { StripeApiError } from "./stripe-client.server";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, "erasure-billing.server.ts"), "utf8");

const CUSTOMER_ID = "cust-erasure-billing-test";
const NOW = new Date("2026-11-12T12:00:00.000Z");

const ONE_ACTIVE_SUBSCRIPTION = [{ id: "sub-row-1", providerSubscriptionId: "sub_stripe_1" }];

describe("cancelActiveBillingForErasure", () => {
  it("EB.1 — no chargeable subscriptions at all: no-op success, Stripe is never called", async () => {
    let cancelCalls = 0;
    const result = await cancelActiveBillingForErasure(CUSTOMER_ID, {
      _findChargeableSubscriptions: async () => [],
      _cancelSubscriptionImmediately: async () => { cancelCalls++; return {}; },
      _now: () => NOW,
    });
    assert.equal(result.ok, true);
    assert.equal(result.canceledCount, 0);
    assert.deepEqual(result.failures, []);
    assert.equal(cancelCalls, 0);
  });

  it("EB.2 — a single ACTIVE subscription: cancelled via Stripe, then marked CANCELED locally", async () => {
    let canceledProviderId: string | null = null;
    let markedId: string | null = null;
    let markedAt: Date | null = null;
    const result = await cancelActiveBillingForErasure(CUSTOMER_ID, {
      _findChargeableSubscriptions: async () => ONE_ACTIVE_SUBSCRIPTION,
      _cancelSubscriptionImmediately: async (id) => { canceledProviderId = id; return {}; },
      _markSubscriptionCanceled: async (id, at) => { markedId = id; markedAt = at; },
      _now: () => NOW,
    });
    assert.equal(canceledProviderId, "sub_stripe_1", "cancels by the PROVIDER subscription id, not our own row id");
    assert.equal(markedId, "sub-row-1", "marks CANCELED by our own row id");
    assert.equal(markedAt, NOW);
    assert.equal(result.ok, true);
    assert.equal(result.canceledCount, 1);
  });

  it("EB.3 — Stripe's cancel call must happen BEFORE the local row is marked CANCELED — never mark success we haven't confirmed", async () => {
    const order: string[] = [];
    await cancelActiveBillingForErasure(CUSTOMER_ID, {
      _findChargeableSubscriptions: async () => ONE_ACTIVE_SUBSCRIPTION,
      _cancelSubscriptionImmediately: async () => { order.push("stripe-cancel"); return {}; },
      _markSubscriptionCanceled: async () => { order.push("mark-canceled"); },
      _now: () => NOW,
    });
    assert.deepEqual(order, ["stripe-cancel", "mark-canceled"]);
  });

  it("EB.4 — a Stripe cancellation failure (e.g. a transient 500) is reported as a failure, and the local row is NOT marked CANCELED", async () => {
    let marked = false;
    const result = await cancelActiveBillingForErasure(CUSTOMER_ID, {
      _findChargeableSubscriptions: async () => ONE_ACTIVE_SUBSCRIPTION,
      _cancelSubscriptionImmediately: async () => { throw new StripeApiError(500, { error: { message: "Internal error" } }); },
      _markSubscriptionCanceled: async () => { marked = true; },
      _now: () => NOW,
    });
    assert.equal(result.ok, false);
    assert.equal(result.canceledCount, 0);
    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0].subscriptionId, "sub-row-1");
    assert.equal(result.failures[0].providerSubscriptionId, "sub_stripe_1");
    assert.match(result.failures[0].error, /500/);
    assert.equal(marked, false, "must never mark a cancellation CANCELED locally when Stripe itself didn't confirm it");
  });

  it("EB.5 — a 404 (resource_missing) from Stripe means the subscription is already gone there — treated as success, not a failure, and still marked CANCELED locally so the row doesn't block every future erasure attempt", async () => {
    let marked = false;
    const result = await cancelActiveBillingForErasure(CUSTOMER_ID, {
      _findChargeableSubscriptions: async () => ONE_ACTIVE_SUBSCRIPTION,
      _cancelSubscriptionImmediately: async () => { throw new StripeApiError(404, { error: { code: "resource_missing" } }); },
      _markSubscriptionCanceled: async () => { marked = true; },
      _now: () => NOW,
    });
    assert.equal(result.ok, true, "a 404 must not block erasure — Stripe already has nothing to cancel");
    assert.equal(result.canceledCount, 1);
    assert.equal(marked, true);
  });

  it("EB.6 — a non-Stripe error (e.g. a thrown plain Error from a network layer) is still captured as a failure, not left uncaught", async () => {
    const result = await cancelActiveBillingForErasure(CUSTOMER_ID, {
      _findChargeableSubscriptions: async () => ONE_ACTIVE_SUBSCRIPTION,
      _cancelSubscriptionImmediately: async () => { throw new Error("fetch failed: ENOTFOUND"); },
      _now: () => NOW,
    });
    assert.equal(result.ok, false);
    assert.match(result.failures[0].error, /ENOTFOUND/);
  });

  it("EB.7 — MULTIPLE chargeable subscriptions: one succeeds, one fails — the successful one is still cancelled and marked, the failure is reported for just that one", async () => {
    const twoSubscriptions = [
      { id: "sub-row-A", providerSubscriptionId: "sub_stripe_A" },
      { id: "sub-row-B", providerSubscriptionId: "sub_stripe_B" },
    ];
    const markedIds: string[] = [];
    const result = await cancelActiveBillingForErasure(CUSTOMER_ID, {
      _findChargeableSubscriptions: async () => twoSubscriptions,
      _cancelSubscriptionImmediately: async (providerSubscriptionId) => {
        if (providerSubscriptionId === "sub_stripe_B") throw new StripeApiError(500, {});
        return {};
      },
      _markSubscriptionCanceled: async (id) => { markedIds.push(id); },
      _now: () => NOW,
    });
    assert.equal(result.ok, false, "ANY failure means the overall result is not-ok — erasure must not proceed");
    assert.equal(result.canceledCount, 1);
    assert.deepEqual(markedIds, ["sub-row-A"], "only the genuinely successful cancellation is marked");
    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0].subscriptionId, "sub-row-B");
  });

  it("EB.8 — the default finder's own query treats ACTIVE, PAST_DUE, and INCOMPLETE as chargeable — not ACTIVE alone", () => {
    // Source-text check (same convention as other files' "ownership and lane
    // boundaries" tests) rather than a live-DB assertion: the DI tests above
    // (EB.1-7) already prove the function's DECISION logic against an
    // injected finder; this proves the real default finder's own query
    // includes every status this schema can actually still be billed from —
    // a PAST_DUE customer mid-grace-period, or one whose async payment
    // method hasn't confirmed yet (INCOMPLETE), is still chargeable and must
    // not be skipped just because they aren't yet (or no longer) ACTIVE.
    const fnIdx = SRC.indexOf("async function defaultFindChargeableSubscriptions");
    const fnBody = SRC.slice(fnIdx, SRC.indexOf("\n}", fnIdx));
    assert.match(fnBody, /CHARGEABLE_STATUSES/);
    const statusesIdx = SRC.indexOf("const CHARGEABLE_STATUSES");
    const statusesLine = SRC.slice(statusesIdx, SRC.indexOf(";", statusesIdx));
    for (const status of ["ACTIVE", "PAST_DUE", "INCOMPLETE"]) {
      assert.ok(statusesLine.includes(status), `CHARGEABLE_STATUSES must include ${status}`);
    }
    assert.ok(!statusesLine.includes("CANCELED") && !statusesLine.includes("EXPIRED"),
      "CANCELED/EXPIRED are already terminal and must not be re-cancelled");
  });
});
