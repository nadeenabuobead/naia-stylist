// app/lib/billing/ops-refund-dispute-procedure.test.ts
//
// Operational acceptance tests for docs/ops/refund-operations-sop.md.
// These do NOT duplicate webhook-handler.test.ts / admin-revocation-
// override.test.ts (which already cover the underlying unit behavior in
// much finer-grained detail) — they instead encode the SUPPORT-OPS
// PROCEDURE itself as a small number of end-to-end scenarios, so the SOP's
// own claims ("issuing the refund in Stripe is enough, no manual
// Customer.membershipStatus edit needed", "a duplicate/redelivered refund
// event can't double-process", "a dispute never auto-revokes access",
// "an administrative override is always reason-coded and audited") are
// each backed by one direct, named assertion a non-engineer reviewer of
// the SOP can match back to a numbered step.
//
// No real Stripe, Prisma, or network call anywhere in this file — every
// dependency is injected, mirroring the exact WebhookHandlerDeps /
// AdminRevocationOverrideDeps convention already established in the two
// files above. Nothing here activates live-mode billing, sends a real
// customer notification, or touches any database.
//
// Run: node --import tsx/esm --test app/lib/billing/ops-refund-dispute-procedure.test.ts

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  processStripeWebhookEvent,
  type WebhookHandlerDeps,
  type SubscriptionRecord,
  type StripeEventLike,
} from "./webhook-handler.server";
import {
  applyAdminRestoreOverride,
  applyAdminRevokeOverride,
  type AdminRevocationOverrideDeps,
  type RunOverrideTransactionFn,
} from "./admin-revocation-override.server";

const CUSTOMER_ID = "cust-ops-sop-test";
const BASE_TS = 1_700_000_000;

function makeEvent(overrides: Partial<StripeEventLike> & { data: { object: any } }): StripeEventLike {
  return { id: "evt_ops_1", type: "refund.updated", created: BASE_TS, ...overrides } as StripeEventLike;
}

function originalTransaction(overrides: Partial<{ fundedPeriodStart: Date | null; fundedPeriodEnd: Date | null }> = {}) {
  return {
    id: "txn-ops-original-1",
    customerId: CUSTOMER_ID,
    subscriptionId: "sub-ops-1",
    amount: 3900,
    fundedPeriodStart: new Date((BASE_TS - 2_592_000) * 1000),
    fundedPeriodEnd: new Date(BASE_TS * 1000),
    ...overrides,
  };
}

function baseSubscription(overrides: Partial<SubscriptionRecord> = {}): SubscriptionRecord {
  return {
    id: "sub-ops-1",
    customerId: CUSTOMER_ID,
    status: "ACTIVE",
    planType: "MONTHLY",
    providerCustomerId: "cus_ops_1",
    providerSubscriptionId: "sub_stripe_ops_1",
    currentPeriodStart: new Date((BASE_TS - 2_592_000) * 1000),
    currentPeriodEnd: new Date(BASE_TS * 1000),
    cancelAtPeriodEnd: false,
    providerSyncedAt: new Date((BASE_TS - 300) * 1000),
    pastDueSince: null,
    ...overrides,
  };
}

describe("Ops SOP step: a Stripe-Dashboard-issued full refund needs no manual membershipStatus edit", () => {
  it("OPS.1 — once the refund webhook arrives, access is revoked automatically — the support agent's only job is to issue the refund in Stripe and log the case", async () => {
    let revocation: any = null;
    let membershipCall: any = null;
    const deps: WebhookHandlerDeps = {
      findNullFundedPeriodTransactions: async () => [],
      findProcessedEvent: async () => null,
      findBillingTransactionByProviderTransactionId: async () => originalTransaction(),
      recordSucceededRefundAndDecideFull: async () => ({ isFullRefund: true, cumulativeRefunded: 3900 }),
      findSubscriptionById: async () => baseSubscription(),
      hasActiveRevocation: async () => true,
      createAccessRevocation: async (input) => { revocation = input; },
      updateCustomerMembershipStatus: async (customerId, status) => { membershipCall = { customerId, status }; },
      recordProcessedEvent: async () => {},
    };
    const event = makeEvent({
      data: { object: { id: "re_ops_1", payment_intent: "pi_ops_1", status: "succeeded", amount: 3900, currency: "aed" } },
    });
    const result = await processStripeWebhookEvent(event, deps);
    assert.deepEqual(revocation, { subscriptionId: "sub-ops-1", reason: "REFUND", sourceTransactionId: "txn-ops-original-1" });
    assert.deepEqual(membershipCall, { customerId: CUSTOMER_ID, status: "NONE" });
    assert.deepEqual(result, { ok: true, deduped: false, action: "refund_full_current_period_access_revoked" });
  });
});

describe("Ops SOP step: duplicate-refund-event prevention (Stripe redelivery, or two support agents acting on the same ticket)", () => {
  it("OPS.2 — the exact same refund event, redelivered, is deduped before any access or ledger write happens a second time", async () => {
    let revocationCalls = 0;
    let membershipCalls = 0;
    const deps: WebhookHandlerDeps = {
      findNullFundedPeriodTransactions: async () => [],
      findProcessedEvent: async () => ({ id: "already-processed-ops" }),
      createAccessRevocation: async () => { revocationCalls++; },
      updateCustomerMembershipStatus: async () => { membershipCalls++; },
    };
    const event = makeEvent({
      id: "evt_ops_redelivered",
      data: { object: { id: "re_ops_1", payment_intent: "pi_ops_1", status: "succeeded", amount: 3900, currency: "aed" } },
    });
    const result = await processStripeWebhookEvent(event, deps);
    assert.deepEqual(result, { ok: true, deduped: true });
    assert.equal(revocationCalls, 0, "a redelivered event must never revoke access a second time");
    assert.equal(membershipCalls, 0, "a redelivered event must never touch membershipStatus a second time");
  });
});

describe("Ops SOP step: an opened dispute never auto-revokes access — it always becomes a human case", () => {
  it("OPS.3 — charge.dispute.created (needs_response) leaves access untouched and is recorded, not silently dropped", async () => {
    let disputeInput: any = null;
    let revocationCalls = 0;
    const deps: WebhookHandlerDeps = {
      findNullFundedPeriodTransactions: async () => [],
      findProcessedEvent: async () => null,
      findBillingTransactionByProviderTransactionId: async () => originalTransaction(),
      findDisputeByProviderDisputeId: async () => null,
      upsertDispute: async (input) => { disputeInput = input; return { id: "dispute-ops-1" }; },
      createAccessRevocation: async () => { revocationCalls++; },
      recordProcessedEvent: async () => {},
    };
    const event = makeEvent({
      type: "charge.dispute.created",
      data: { object: { id: "dp_ops_1", status: "needs_response", amount: 3900, currency: "aed", payment_intent: "pi_ops_1" } },
    });
    const result = await processStripeWebhookEvent(event, deps);
    assert.equal(disputeInput.status, "PENDING", "must land as a reviewable case, not be ignored");
    assert.equal(revocationCalls, 0, "opening a dispute must never by itself revoke access — Decision 16, row 3");
    assert.deepEqual(result, { ok: true, deduped: false, action: "dispute_pending_recorded" });
  });
});

describe("Ops SOP step: a lost chargeback is the default-revoke outcome", () => {
  it("OPS.4 — charge.dispute.closed(status=lost) against the current period revokes access with reason DISPUTE_LOST", async () => {
    let revocation: any = null;
    const deps: WebhookHandlerDeps = {
      findNullFundedPeriodTransactions: async () => [],
      findProcessedEvent: async () => null,
      findBillingTransactionByProviderTransactionId: async () => originalTransaction(),
      findDisputeByProviderDisputeId: async () => null,
      upsertDispute: async () => ({ id: "dispute-ops-2" }),
      findSubscriptionById: async () => baseSubscription(),
      hasActiveRevocation: async () => true,
      createAccessRevocation: async (input) => { revocation = input; },
      updateCustomerMembershipStatus: async () => {},
      recordProcessedEvent: async () => {},
    };
    const event = makeEvent({
      type: "charge.dispute.closed",
      data: { object: { id: "dp_ops_2", status: "lost", amount: 3900, currency: "aed", payment_intent: "pi_ops_2" } },
    });
    const result = await processStripeWebhookEvent(event, deps);
    assert.equal(revocation.reason, "DISPUTE_LOST");
    assert.deepEqual(result, { ok: true, deduped: false, action: "dispute_lost_current_period_access_revoked" });
  });
});

describe("Ops SOP step: a won dispute restores exactly what was revoked, never a fresh grant", () => {
  it("OPS.5 — charge.dispute.closed(status=won) resolves this dispute's own revocation and restores membership", async () => {
    let resolveCall: any = null;
    let membershipCall: any = null;
    const deps: WebhookHandlerDeps = {
      findNullFundedPeriodTransactions: async () => [],
      findProcessedEvent: async () => null,
      findDisputeByProviderDisputeId: async () => ({
        id: "dispute-ops-3",
        customerId: CUSTOMER_ID,
        subscriptionId: "sub-ops-1",
        status: "PENDING",
        lastEventAt: new Date((BASE_TS - 100) * 1000),
        lastEventFinalityRank: 0,
      }),
      upsertDispute: async () => ({ id: "dispute-ops-3" }),
      hasActiveRevocation: async () => false,
      resolveAccessRevocationsByDispute: async (disputeId, resolvedReason) => { resolveCall = { disputeId, resolvedReason }; },
      findSubscriptionById: async () => baseSubscription(),
      updateCustomerMembershipStatus: async (customerId, status) => { membershipCall = { customerId, status }; },
      recordProcessedEvent: async () => {},
    };
    const event = makeEvent({
      id: "evt_ops_won",
      type: "charge.dispute.closed",
      data: { object: { id: "dp_ops_3", status: "won", amount: 3900 } },
    });
    const result = await processStripeWebhookEvent(event, deps);
    assert.deepEqual(resolveCall, { disputeId: "dispute-ops-3", resolvedReason: "dispute_won" });
    assert.equal(membershipCall?.status, "MEMBER", "won means restore, not leave revoked");
    assert.deepEqual(result, { ok: true, deduped: false, action: "dispute_won_restored" });
  });
});

describe("Ops SOP step: an administrative override (goodwill exception) is always reason-coded and audited — Decision 16, row 5", () => {
  it("OPS.6a — a goodwill restore with no reason text is refused before anything is written", async () => {
    let txCalls = 0;
    const runOverrideTransaction: RunOverrideTransactionFn = async (fn) => { txCalls++; return fn({} as any); };
    const deps: AdminRevocationOverrideDeps = {
      runOverrideTransaction,
      findSubscriptionById: async () => ({ id: "sub-ops-1", status: "ACTIVE" as const }),
      updateCustomerMembershipStatus: async () => { throw new Error("must not run without a reason"); },
    };
    const result = await applyAdminRestoreOverride(
      { subscriptionId: "sub-ops-1", customerId: CUSTOMER_ID, performedBy: "owner@naiabynadine.com", reason: "" },
      deps,
    );
    assert.deepEqual(result, { ok: false, reason: "override_reason_required" });
    assert.equal(txCalls, 0, "an unexplained override must never reach the transaction at all");
  });

  it("OPS.6b — a reasoned goodwill restore writes one audit record carrying performedBy, reason, and the customer/subscription references", async () => {
    let auditCreateArgs: any = null;
    const tx = {
      adminAuditLog: { create: async (args: any) => { auditCreateArgs = args; return { id: "audit-ops-1" }; } },
      accessRevocation: { updateMany: async () => ({ count: 1 }), create: async () => {} },
    } as any;
    const runOverrideTransaction: RunOverrideTransactionFn = async (fn) => fn(tx);
    const deps: AdminRevocationOverrideDeps = {
      runOverrideTransaction,
      findSubscriptionById: async () => ({ id: "sub-ops-1", status: "ACTIVE" as const }),
      updateCustomerMembershipStatus: async () => {},
    };
    const result = await applyAdminRestoreOverride(
      {
        subscriptionId: "sub-ops-1",
        customerId: CUSTOMER_ID,
        performedBy: "owner@naiabynadine.com",
        reason: "Goodwill exception approved per case log OPS-0001",
      },
      deps,
    );
    assert.equal(result.ok, true);
    assert.equal(auditCreateArgs.data.performedBy, "owner@naiabynadine.com");
    assert.match(auditCreateArgs.data.detail?.reason ?? JSON.stringify(auditCreateArgs.data.detail), /OPS-0001/);
  });
});
