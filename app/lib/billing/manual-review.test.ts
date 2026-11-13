// app/lib/billing/manual-review.test.ts
// Correctness review (2026-11-13) — the durable manual-review obligation.
// No real Prisma, no real network — every dependency is injected,
// mirroring webhook-handler.test.ts's DI convention.
//
// Run: node --import tsx/esm --test app/lib/billing/manual-review.test.ts

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { recordManualReviewObligation, type ManualReviewDeps } from "./manual-review.server";

describe("recordManualReviewObligation", () => {
  it("MR.1 — creates a new flag when none is open for this category/transaction", async () => {
    let createInput: any = null;
    const deps: ManualReviewDeps = {
      findOpenManualReviewFlag: async () => null,
      createManualReviewFlag: async (input) => { createInput = input; },
    };
    await recordManualReviewObligation(
      { category: "funded_period_unknown", subscriptionId: "sub-1", transactionId: "txn-1", detail: { reason: "null period" } },
      deps,
    );
    assert.deepEqual(createInput, {
      category: "funded_period_unknown",
      subscriptionId: "sub-1",
      transactionId: "txn-1",
      detail: { reason: "null period" },
    });
  });

  it("MR.2 — idempotent: an already-open flag for the same category/transaction is never duplicated", async () => {
    let createCalls = 0;
    const deps: ManualReviewDeps = {
      findOpenManualReviewFlag: async () => ({ id: "flag-existing" }),
      createManualReviewFlag: async () => { createCalls++; },
    };
    await recordManualReviewObligation({ category: "funded_period_unknown", transactionId: "txn-1" }, deps);
    assert.equal(createCalls, 0, "repeated webhook deliveries/out-of-order retries must not spam duplicate review rows");
  });

  it("MR.3 — scoped independently by disputeId as well as transactionId", async () => {
    let lookupArgs: any = null;
    const deps: ManualReviewDeps = {
      findOpenManualReviewFlag: async (category, refs) => { lookupArgs = { category, refs }; return null; },
      createManualReviewFlag: async () => {},
    };
    await recordManualReviewObligation({ category: "funded_period_unknown", disputeId: "dispute-1" }, deps);
    assert.deepEqual(lookupArgs, { category: "funded_period_unknown", refs: { transactionId: undefined, disputeId: "dispute-1" } });
  });

  it("MR.4 — two DIFFERENT transactions in the same category each get their own flag — the idempotency check is scoped per transaction, not per category alone", async () => {
    const opened = new Set<string>();
    const deps: ManualReviewDeps = {
      findOpenManualReviewFlag: async (_category, refs) => (opened.has(refs.transactionId!) ? { id: "x" } : null),
      createManualReviewFlag: async (input) => { opened.add(input.transactionId!); },
    };
    await recordManualReviewObligation({ category: "funded_period_unknown", transactionId: "txn-A" }, deps);
    await recordManualReviewObligation({ category: "funded_period_unknown", transactionId: "txn-B" }, deps);
    assert.deepEqual([...opened].sort(), ["txn-A", "txn-B"]);
  });
});
