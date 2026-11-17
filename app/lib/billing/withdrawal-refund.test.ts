// app/lib/billing/withdrawal-refund.test.ts
//
// Behavioral tests for the manual full-refund withdrawal path (2026-11-17).
// No real Prisma, no real network, no real Stripe call: every dependency
// is injected via WithdrawalRefundDeps, and createRefund/
// cancelSubscriptionImmediately are exercised only through their own
// _fetch injection (same convention as stripe-client.test.ts) — never a
// real network call anywhere in this file.
//
// Run: node --import tsx/esm --test app/lib/billing/withdrawal-refund.test.ts

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluateWithdrawalRefundEligibility,
  processWithdrawalFullRefund,
  onRefundSucceededForWithdrawal,
  onRefundFailedForWithdrawal,
  type WithdrawalRefundDeps,
  type WithdrawalRefundCaseRecord,
  type SubscriptionForEligibility,
  type QualifyingTransaction,
} from "./withdrawal-refund.server";

const NOW = new Date("2026-11-17T12:00:00.000Z");
const PERIOD_END = new Date("2026-12-01T00:00:00.000Z");
const PERIOD_START = new Date("2026-11-01T00:00:00.000Z");

function fakeCase(overrides: Partial<WithdrawalRefundCaseRecord> = {}): WithdrawalRefundCaseRecord {
  return {
    id: "case-1",
    withdrawalRequestId: "wr-1",
    subscriptionId: "sub-1",
    originalTransactionId: null,
    outcome: "ELIGIBLE_PENDING",
    providerRefundId: null,
    subscriptionCanceledAt: null,
    confirmationRecordedAt: null,
    ...overrides,
  };
}

function subNoConsent(overrides: Partial<SubscriptionForEligibility> = {}): SubscriptionForEligibility {
  return {
    id: "sub-1",
    customerId: "cust-1",
    providerSubscriptionId: "sub_stripe_1",
    earlyServiceConsentedAt: null,
    currentPeriodEnd: PERIOD_END,
    ...overrides,
  };
}

function qualifyingTxn(overrides: Partial<QualifyingTransaction> = {}): QualifyingTransaction {
  return {
    id: "txn-1",
    providerTransactionId: "pi_1",
    amount: 3900,
    fundedPeriodStart: PERIOD_START,
    fundedPeriodEnd: PERIOD_END,
    ...overrides,
  };
}

// A base deps object every test starts from and overrides selectively —
// every function defaults to "not found"/"no-op" so a test only has to
// name what it actually cares about.
function baseDeps(overrides: WithdrawalRefundDeps = {}): WithdrawalRefundDeps {
  const casesByRequestId = new Map<string, WithdrawalRefundCaseRecord>();
  return {
    findWithdrawalRequestById: async (id) => ({ id, customerId: "cust-1", subscriptionId: "sub-1" }),
    findLatestSubscriptionForCustomer: async () => subNoConsent(),
    findSubscriptionById: async () => subNoConsent(),
    findQualifyingTransaction: async () => qualifyingTxn(),
    findExistingRefundForTransaction: async () => null,
    findOpenDisputeForSubscription: async () => null,
    upsertCase: async (input) => {
      const row = fakeCase({
        withdrawalRequestId: input.withdrawalRequestId,
        subscriptionId: input.subscriptionId,
        originalTransactionId: input.originalTransactionId,
        outcome: input.outcome,
      });
      casesByRequestId.set(input.withdrawalRequestId, row);
      return row;
    },
    updateCase: async () => {},
    // Injected so these tests never need a real Prisma connection for the
    // one write admin-audit-log.server.ts always performs — that module
    // has its own, separate test coverage for the write itself.
    recordAdminAction: async () => ({ id: "audit-log-1" }),
    _now: () => NOW,
    ...overrides,
  };
}

describe("evaluateWithdrawalRefundEligibility", () => {
  it("WR.1 — a withdrawal request with no evidence of early-service consent, a real qualifying payment, no existing refund, no open dispute — ELIGIBLE_PENDING", async () => {
    const result = await evaluateWithdrawalRefundEligibility("wr-1", baseDeps());
    assert.equal(result.outcome, "ELIGIBLE_PENDING");
    assert.equal(result.subscriptionId, "sub-1");
    assert.equal(result.originalTransactionId, "txn-1");
  });

  it("WR.2 — MONTHLY and ANNUAL subscriptions are evaluated identically — plan type never enters the eligibility decision", async () => {
    for (const planType of ["MONTHLY", "ANNUAL"] as const) {
      const result = await evaluateWithdrawalRefundEligibility(
        "wr-1",
        baseDeps({ findSubscriptionById: async () => subNoConsent({ id: `sub-${planType}` }) }),
      );
      assert.equal(result.outcome, "ELIGIBLE_PENDING", `${planType} must be eligible under the same rule`);
    }
  });

  it("WR.3 — missing WithdrawalRequest row — BLOCKED_NO_QUALIFYING_PAYMENT, fails closed rather than throwing", async () => {
    const result = await evaluateWithdrawalRefundEligibility(
      "wr-missing",
      baseDeps({ findWithdrawalRequestById: async () => null }),
    );
    assert.equal(result.outcome, "BLOCKED_NO_QUALIFYING_PAYMENT");
  });

  it("WR.4 — no subscription on file at all — BLOCKED_NO_QUALIFYING_PAYMENT", async () => {
    const result = await evaluateWithdrawalRefundEligibility(
      "wr-1",
      baseDeps({ findSubscriptionById: async () => null, findLatestSubscriptionForCustomer: async () => null }),
    );
    assert.equal(result.outcome, "BLOCKED_NO_QUALIFYING_PAYMENT");
  });

  it("WR.5 — early-service-consent evidence present — BLOCKED_EARLY_SERVICE_CONSENT, full-refund-without-deduction never applies", async () => {
    const result = await evaluateWithdrawalRefundEligibility(
      "wr-1",
      baseDeps({ findSubscriptionById: async () => subNoConsent({ earlyServiceConsentedAt: new Date("2026-11-01T00:00:00.000Z") }) }),
    );
    assert.equal(result.outcome, "BLOCKED_EARLY_SERVICE_CONSENT");
    // Deliberately never reaches the qualifying-transaction lookup at all —
    // the cheapest check (a DB read already on the subscription row) short-
    // circuits before any further billing lookup.
  });

  it("WR.6 — missing early-service-consent evidence IS the eligible case — absence of evidence, not a special 'unknown' state, means full refund applies", async () => {
    const result = await evaluateWithdrawalRefundEligibility(
      "wr-1",
      baseDeps({ findSubscriptionById: async () => subNoConsent({ earlyServiceConsentedAt: null }) }),
    );
    assert.equal(result.outcome, "ELIGIBLE_PENDING");
  });

  it("WR.7 — no succeeded payment funding the current period — BLOCKED_NO_QUALIFYING_PAYMENT", async () => {
    const result = await evaluateWithdrawalRefundEligibility(
      "wr-1",
      baseDeps({ findQualifyingTransaction: async () => null }),
    );
    assert.equal(result.outcome, "BLOCKED_NO_QUALIFYING_PAYMENT");
  });

  it("WR.8 — a qualifying transaction with no providerTransactionId (cannot refund via Stripe without a PaymentIntent) is treated the same as none found", async () => {
    const result = await evaluateWithdrawalRefundEligibility(
      "wr-1",
      baseDeps({ findQualifyingTransaction: async () => qualifyingTxn({ providerTransactionId: null }) }),
    );
    assert.equal(result.outcome, "BLOCKED_NO_QUALIFYING_PAYMENT");
  });

  it("WR.9 — the qualifying transaction already has a succeeded refund against it — BLOCKED_ALREADY_REFUNDED, never a duplicate", async () => {
    const result = await evaluateWithdrawalRefundEligibility(
      "wr-1",
      baseDeps({ findExistingRefundForTransaction: async () => ({ id: "refund-txn-1" }) }),
    );
    assert.equal(result.outcome, "BLOCKED_ALREADY_REFUNDED");
  });

  it("WR.10 — an open (PENDING) dispute exists on this subscription — BLOCKED_OPEN_DISPUTE, matches the manual SOP's own check", async () => {
    const result = await evaluateWithdrawalRefundEligibility(
      "wr-1",
      baseDeps({ findOpenDisputeForSubscription: async () => ({ id: "dispute-1" }) }),
    );
    assert.equal(result.outcome, "BLOCKED_OPEN_DISPUTE");
  });

  it("WR.11 — re-evaluating the SAME withdrawal request twice is idempotent — upsert, never a second row", async () => {
    let upsertCalls = 0;
    const deps = baseDeps({
      upsertCase: async (input) => { upsertCalls++; return fakeCase({ outcome: input.outcome }); },
    });
    await evaluateWithdrawalRefundEligibility("wr-1", deps);
    await evaluateWithdrawalRefundEligibility("wr-1", deps);
    assert.equal(upsertCalls, 2, "two evaluations, but upsert (not create) both times — never a duplicate case row");
  });
});

describe("processWithdrawalFullRefund", () => {
  function fakeFetch(responseBody: unknown, status = 200) {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fn = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return { ok: status >= 200 && status < 300, status, json: async () => responseBody } as Response;
    }) as typeof fetch;
    return { fn, calls };
  }

  it("WR.12 — an eligible case issues a real-shaped Stripe refund request, keyed on the case id for idempotency, and records REFUND_REQUESTED + the provider refund id", async () => {
    // processWithdrawalFullRefund does not (and should not) expose a
    // _fetch param of its own — createRefund is called with no deps
    // argument, same as every real call site. global.fetch is swapped for
    // the duration of this one call instead, same convention WR.19/WR.22
    // already use below for cancelSubscriptionImmediately's own default
    // `_fetch = fetch` parameter (evaluated at call time, so this is
    // caught correctly) — never a real network call.
    const originalEnv = process.env.STRIPE_SECRET_KEY;
    process.env.STRIPE_SECRET_KEY = "sk_test_fake";
    const originalFetch = global.fetch;
    const { fn, calls } = fakeFetch({ id: "re_fake_1", status: "pending", amount: 3900, currency: "aed", payment_intent: "pi_1" });
    global.fetch = fn as any;
    try {
      let updated: any = null;
      const deps = baseDeps({ updateCase: async (id, input) => { updated = { id, ...input }; } });
      const result = await processWithdrawalFullRefund("wr-1", "owner@naiabynadine.com", deps);
      assert.equal(result.ok, true);
      assert.equal(updated.outcome, "REFUND_REQUESTED");
      assert.equal(updated.providerRefundId, "re_fake_1");
      assert.equal(updated.performedByEmail, "owner@naiabynadine.com");
      assert.equal(calls.length, 1, "exactly one Stripe call — the refund request");
      const headers = calls[0].init.headers as Record<string, string>;
      assert.equal(headers["Idempotency-Key"], "withdrawal-refund:case-1", "keyed on the case id, so a retry collapses to the SAME Stripe refund");
    } finally {
      process.env.STRIPE_SECRET_KEY = originalEnv;
      global.fetch = originalFetch;
    }
  });

  it("WR.13 — eligibility is RE-EVALUATED immediately before acting, never trusting a stale/cached ELIGIBLE_PENDING — a subscription that became ineligible since the last check is blocked here too", async () => {
    const deps = baseDeps({
      findSubscriptionById: async () => subNoConsent({ earlyServiceConsentedAt: new Date("2026-11-10T00:00:00.000Z") }),
    });
    const result = await processWithdrawalFullRefund("wr-1", "owner@naiabynadine.com", deps);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "BLOCKED_EARLY_SERVICE_CONSENT");
  });

  it("WR.14 — a duplicate/retried processing attempt on an ALREADY-REFUNDED case is blocked, never issuing a second Stripe refund", async () => {
    const deps = baseDeps({ findExistingRefundForTransaction: async () => ({ id: "refund-txn-1" }) });
    const result = await processWithdrawalFullRefund("wr-1", "owner@naiabynadine.com", deps);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "BLOCKED_ALREADY_REFUNDED");
  });

  it("WR.15 — a provider (Stripe) failure is recorded as PROVIDER_FAILED, not silently dropped, and the case stays safe to retry", async () => {
    const deps = baseDeps({
      findWithdrawalRequestById: async (id) => ({ id, customerId: "cust-1", subscriptionId: "sub-1" }),
    });
    // STRIPE_SECRET_KEY left unset — createRefund throws StripeNotConfiguredError,
    // a genuine provider-side failure mode, not a bug in this module.
    const originalEnv = process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_SECRET_KEY;
    try {
      let updated: any = null;
      const withUpdate = { ...deps, updateCase: async (id: string, input: any) => { updated = { id, ...input }; } };
      const result = await processWithdrawalFullRefund("wr-1", "owner@naiabynadine.com", withUpdate);
      assert.equal(result.ok, false);
      assert.equal(result.reason, "stripe_not_configured");
      assert.equal(updated.outcome, "PROVIDER_FAILED");
    } finally {
      if (originalEnv !== undefined) process.env.STRIPE_SECRET_KEY = originalEnv;
    }
  });

  it("WR.16 — an audit log entry is recorded for every processing ATTEMPT, authorization + reason + timestamp, before the Stripe call — Founder Decision 16's override-record requirement", async () => {
    const originalEnv = process.env.STRIPE_SECRET_KEY;
    process.env.STRIPE_SECRET_KEY = "sk_test_fake";
    const originalFetch = global.fetch;
    const { fn } = fakeFetch({ id: "re_fake_2", status: "pending", amount: 3900, currency: "aed", payment_intent: "pi_1" });
    global.fetch = fn as any;
    try {
      let auditCalls = 0;
      let updated: any = null;
      const deps = baseDeps({
        updateCase: async (id, input) => { updated = { id, ...input }; auditCalls++; },
        recordAdminAction: async (performedBy, action, detail) => { auditCalls++; return { id: "audit-log-wr16" }; },
      });
      await processWithdrawalFullRefund("wr-1", "owner@naiabynadine.com", deps);
      assert.ok(auditCalls > 0);
      assert.equal(updated.auditLogId, "audit-log-wr16", "the real auditLogId returned by recordAdminAction must be attached to the case");
    } finally {
      process.env.STRIPE_SECRET_KEY = originalEnv;
      global.fetch = originalFetch;
    }
  });

  it("WR.17 — never touches Decision 3c's HELD Clerk/Shopify erasure path — no identity-deletion function is IMPORTED by this module at all", () => {
    // Static guard on the actual import statements only, not the whole
    // file text — the module's own explanatory comments legitimately
    // mention "erasure" in prose describing what this feature deliberately
    // does NOT do, which a whole-file regex would wrongly flag.
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(__dirname, "withdrawal-refund.server.ts"), "utf8");
    const importLines = src.split("\n").filter((line) => /^\s*import\b/.test(line));
    for (const line of importLines) {
      assert.doesNotMatch(line, /erasure|deleteClerkUser|redact/i, `import line must never pull in an erasure/deletion path: ${line}`);
    }
    assert.ok(importLines.length > 0, "sanity check — the file must actually have imports for this guard to mean anything");
  });
});

describe("onRefundSucceededForWithdrawal", () => {
  it("WR.18 — a refund id that matches NO WithdrawalRefundCase is a safe no-op — most refunds are ordinary goodwill refunds, not withdrawal-triggered", async () => {
    let updateCalls = 0;
    const deps: WithdrawalRefundDeps = {
      findCaseByProviderRefundId: async () => null,
      updateCase: async () => { updateCalls++; },
    };
    await onRefundSucceededForWithdrawal("re_ordinary_goodwill_refund", deps);
    assert.equal(updateCalls, 0);
  });

  it("WR.19 — a matching case is marked REFUND_SUCCEEDED, the subscription is canceled to stop future billing, and a confirmation record is generated — in that order, only after Stripe's own confirmation", async () => {
    const calls: string[] = [];
    const deps: WithdrawalRefundDeps = {
      findCaseByProviderRefundId: async () => fakeCase({ outcome: "REFUND_REQUESTED", providerRefundId: "re_1", subscriptionId: "sub-1" }),
      findSubscriptionById: async () => subNoConsent(),
      updateCase: async (_id, input) => {
        if (input.outcome === "REFUND_SUCCEEDED") calls.push("outcome");
        if ("subscriptionCanceledAt" in input) calls.push("canceled");
        if ("confirmationRecordedAt" in input) calls.push("confirmation");
      },
      _now: () => NOW,
    };
    // cancelSubscriptionImmediately needs a configured test key to not throw
    // StripeNotConfiguredError — set one just for this call's duration.
    const originalEnv = process.env.STRIPE_SECRET_KEY;
    process.env.STRIPE_SECRET_KEY = "sk_test_fake";
    const originalFetch = global.fetch;
    global.fetch = (async () => ({ ok: true, status: 200, json: async () => ({ id: "sub_stripe_1", status: "canceled" }) })) as any;
    try {
      await onRefundSucceededForWithdrawal("re_1", deps);
    } finally {
      process.env.STRIPE_SECRET_KEY = originalEnv;
      global.fetch = originalFetch;
    }
    assert.deepEqual(calls, ["outcome", "canceled", "confirmation"]);
  });

  it("WR.20 — a redelivered webhook for an ALREADY REFUND_SUCCEEDED case is idempotent — never cancels the subscription or generates a second confirmation record", async () => {
    let updateCalls = 0;
    const deps: WithdrawalRefundDeps = {
      findCaseByProviderRefundId: async () => fakeCase({ outcome: "REFUND_SUCCEEDED", providerRefundId: "re_1" }),
      updateCase: async () => { updateCalls++; },
    };
    await onRefundSucceededForWithdrawal("re_1", deps);
    assert.equal(updateCalls, 0);
  });

  it("WR.21 — a case with no linked subscription still gets REFUND_SUCCEEDED + a confirmation record — cancellation is skipped, never crashes", async () => {
    const calls: string[] = [];
    const deps: WithdrawalRefundDeps = {
      findCaseByProviderRefundId: async () => fakeCase({ outcome: "REFUND_REQUESTED", providerRefundId: "re_1", subscriptionId: null }),
      updateCase: async (_id, input) => {
        if (input.outcome === "REFUND_SUCCEEDED") calls.push("outcome");
        if ("confirmationRecordedAt" in input) calls.push("confirmation");
      },
      _now: () => NOW,
    };
    await onRefundSucceededForWithdrawal("re_1", deps);
    assert.deepEqual(calls, ["outcome", "confirmation"]);
  });

  it("WR.22 — a failed Stripe cancellation call never looks like the refund itself failed — outcome stays REFUND_SUCCEEDED, subscriptionCanceledAt stays unset for later review", async () => {
    const calls: Array<{ outcome?: string; hasCanceledAt?: boolean }> = [];
    const deps: WithdrawalRefundDeps = {
      findCaseByProviderRefundId: async () => fakeCase({ outcome: "REFUND_REQUESTED", providerRefundId: "re_1", subscriptionId: "sub-1" }),
      findSubscriptionById: async () => subNoConsent(),
      updateCase: async (_id, input) => {
        calls.push({ outcome: input.outcome, hasCanceledAt: "subscriptionCanceledAt" in input });
      },
      _now: () => NOW,
    };
    const originalEnv = process.env.STRIPE_SECRET_KEY;
    process.env.STRIPE_SECRET_KEY = "sk_test_fake";
    const originalFetch = global.fetch;
    global.fetch = (async () => ({ ok: false, status: 404, json: async () => ({ error: "no such subscription" }) })) as any;
    try {
      await onRefundSucceededForWithdrawal("re_1", deps);
    } finally {
      process.env.STRIPE_SECRET_KEY = originalEnv;
      global.fetch = originalFetch;
    }
    assert.equal(calls[0]?.outcome, "REFUND_SUCCEEDED");
    assert.equal(calls.some((c) => c.hasCanceledAt), false, "a failed cancellation call must never write subscriptionCanceledAt");
  });
});

describe("onRefundFailedForWithdrawal", () => {
  it("WR.23 — a matching case is marked PROVIDER_FAILED", async () => {
    let updated: any = null;
    const deps: WithdrawalRefundDeps = {
      findCaseByProviderRefundId: async () => fakeCase({ outcome: "REFUND_REQUESTED", providerRefundId: "re_1" }),
      updateCase: async (id, input) => { updated = { id, ...input }; },
    };
    await onRefundFailedForWithdrawal("re_1", deps);
    assert.equal(updated.outcome, "PROVIDER_FAILED");
  });

  it("WR.24 — a no-match refund id is a safe no-op", async () => {
    let updateCalls = 0;
    const deps: WithdrawalRefundDeps = {
      findCaseByProviderRefundId: async () => null,
      updateCase: async () => { updateCalls++; },
    };
    await onRefundFailedForWithdrawal("re_unrelated", deps);
    assert.equal(updateCalls, 0);
  });

  it("WR.25 — a stale/duplicate failure event arriving AFTER a real success must never downgrade the case back to failed", async () => {
    let updateCalls = 0;
    const deps: WithdrawalRefundDeps = {
      findCaseByProviderRefundId: async () => fakeCase({ outcome: "REFUND_SUCCEEDED", providerRefundId: "re_1" }),
      updateCase: async () => { updateCalls++; },
    };
    await onRefundFailedForWithdrawal("re_1", deps);
    assert.equal(updateCalls, 0, "a case already REFUND_SUCCEEDED must never be overwritten by a later/stale failure");
  });
});
