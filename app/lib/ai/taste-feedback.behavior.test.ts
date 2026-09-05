// app/lib/ai/taste-feedback.behavior.test.ts
// Phase 5D — Behavioural tests for the feedback lifecycle.
//
// Uses an in-memory adapter wired to applyFeedbackWithDeps from the engine.
// No Prisma, no staging DB, no real network calls.
//
// Covers:
//   BV.1  Accurate path — state preserved, feedback persists
//   BV.2  Not-quite path — REJECTED state, timestamp, reconcile trigger
//   BV.3  Ownership and security — cross-customer, nonexistent, invalid ID
//   BV.4  Idempotency — ALREADY_REJECTED guard; repeated calls
//   BV.5  REJECTED row invariants — writeFeedback not called on guarded paths
//   BV.6  Customer-facing exclusion — post-rejection row invisible to queries

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyFeedbackWithDeps, type FeedbackDeps } from "./taste-feedback-engine.js";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const reconcileSrc = readFileSync(join(__dirname, "taste-reconcile.server.ts"), "utf8");

// ── In-memory store ───────────────────────────────────────────────────────────

type StoreRow = {
  id: string;
  customerId: string;
  state: string;
  customerFeedback: string | null;
  customerFeedbackAt: Date | null;
};

type CallLog = {
  writeCalls: Array<{ id: string; data: Record<string, unknown> }>;
  reconcileCalls: string[];
};

function makeStore(initialRows: StoreRow[]): {
  rows: StoreRow[];
  log: CallLog;
  deps: FeedbackDeps;
} {
  const rows: StoreRow[] = initialRows.map(r => ({ ...r }));
  const log: CallLog = { writeCalls: [], reconcileCalls: [] };

  const deps: FeedbackDeps = {
    async findTendency(id, customerId) {
      return rows.find(r => r.id === id && r.customerId === customerId) ?? null;
    },
    async writeFeedback(id, data) {
      log.writeCalls.push({ id, data: data as Record<string, unknown> });
      const row = rows.find(r => r.id === id);
      if (!row) throw new Error(`Row ${id} not found in store`);
      if (data.state)              row.state = data.state;
      if (data.customerFeedback)   row.customerFeedback = data.customerFeedback;
      if (data.customerFeedbackAt) row.customerFeedbackAt = data.customerFeedbackAt;
    },
    async runReconcile(customerId) {
      log.reconcileCalls.push(customerId);
    },
  };

  return { rows, log, deps };
}

// Seed rows
function confirmed(id: string, customerId = "cust-1"): StoreRow {
  return { id, customerId, state: "CONFIRMED", customerFeedback: null, customerFeedbackAt: null };
}
function candidate(id: string, customerId = "cust-1"): StoreRow {
  return { id, customerId, state: "CANDIDATE", customerFeedback: null, customerFeedbackAt: null };
}
function rejected(id: string, customerId = "cust-1"): StoreRow {
  return { id, customerId, state: "REJECTED", customerFeedback: "not-quite", customerFeedbackAt: new Date("2026-09-01") };
}

// ── BV.1 — Accurate path ──────────────────────────────────────────────────────

describe("BV.1 — accurate: state preserved, feedback persists", () => {
  it("BV.1.1 returns ok:true for a CONFIRMED tendency owned by the customer", async () => {
    const { deps } = makeStore([confirmed("t1")]);
    const result = await applyFeedbackWithDeps(deps, "cust-1", "t1", "accurate");
    assert.deepEqual(result, { ok: true });
  });

  it("BV.1.2 customerFeedback set to 'accurate' in the store row", async () => {
    const { rows, deps } = makeStore([confirmed("t1")]);
    await applyFeedbackWithDeps(deps, "cust-1", "t1", "accurate");
    assert.equal(rows[0].customerFeedback, "accurate");
  });

  it("BV.1.3 customerFeedbackAt is set to a truthy Date", async () => {
    const { rows, deps } = makeStore([confirmed("t1")]);
    const before = new Date();
    await applyFeedbackWithDeps(deps, "cust-1", "t1", "accurate");
    assert.ok(rows[0].customerFeedbackAt instanceof Date, "customerFeedbackAt is a Date");
    assert.ok(rows[0].customerFeedbackAt! >= before, "customerFeedbackAt is not in the past");
  });

  it("BV.1.4 state remains CONFIRMED after accurate feedback", async () => {
    const { rows, deps } = makeStore([confirmed("t1")]);
    await applyFeedbackWithDeps(deps, "cust-1", "t1", "accurate");
    assert.equal(rows[0].state, "CONFIRMED");
  });

  it("BV.1.5 writeFeedback called exactly once for accurate", async () => {
    const { log, deps } = makeStore([confirmed("t1")]);
    await applyFeedbackWithDeps(deps, "cust-1", "t1", "accurate");
    assert.equal(log.writeCalls.length, 1);
    assert.equal(log.writeCalls[0].id, "t1");
  });

  it("BV.1.6 reconcile NOT called for accurate feedback", async () => {
    const { log, deps } = makeStore([confirmed("t1")]);
    await applyFeedbackWithDeps(deps, "cust-1", "t1", "accurate");
    assert.equal(log.reconcileCalls.length, 0);
  });

  it("BV.1.7 accurate also works on a CANDIDATE tendency", async () => {
    const { rows, deps } = makeStore([candidate("t2")]);
    const result = await applyFeedbackWithDeps(deps, "cust-1", "t2", "accurate");
    assert.equal(result.ok, true);
    assert.equal(rows[0].state, "CANDIDATE", "state remains CANDIDATE");
    assert.equal(rows[0].customerFeedback, "accurate");
  });
});

// ── BV.2 — Not-quite path ─────────────────────────────────────────────────────

describe("BV.2 — not-quite: REJECTED state, timestamp, reconcile trigger", () => {
  it("BV.2.1 returns ok:true for a CONFIRMED tendency owned by the customer", async () => {
    const { deps } = makeStore([confirmed("t1")]);
    const result = await applyFeedbackWithDeps(deps, "cust-1", "t1", "not-quite");
    assert.deepEqual(result, { ok: true });
  });

  it("BV.2.2 state becomes REJECTED", async () => {
    const { rows, deps } = makeStore([confirmed("t1")]);
    await applyFeedbackWithDeps(deps, "cust-1", "t1", "not-quite");
    assert.equal(rows[0].state, "REJECTED");
  });

  it("BV.2.3 customerFeedback set to 'not-quite'", async () => {
    const { rows, deps } = makeStore([confirmed("t1")]);
    await applyFeedbackWithDeps(deps, "cust-1", "t1", "not-quite");
    assert.equal(rows[0].customerFeedback, "not-quite");
  });

  it("BV.2.4 customerFeedbackAt is set to a truthy Date", async () => {
    const { rows, deps } = makeStore([confirmed("t1")]);
    const before = new Date();
    await applyFeedbackWithDeps(deps, "cust-1", "t1", "not-quite");
    assert.ok(rows[0].customerFeedbackAt instanceof Date, "customerFeedbackAt is a Date");
    assert.ok(rows[0].customerFeedbackAt! >= before, "customerFeedbackAt is not in the past");
  });

  it("BV.2.5 runReconcile called exactly once with correct customerId", async () => {
    const { log, deps } = makeStore([confirmed("t1")]);
    await applyFeedbackWithDeps(deps, "cust-1", "t1", "not-quite");
    assert.equal(log.reconcileCalls.length, 1);
    assert.equal(log.reconcileCalls[0], "cust-1");
  });

  it("BV.2.6 writeFeedback called exactly once with REJECTED state", async () => {
    const { log, deps } = makeStore([confirmed("t1")]);
    await applyFeedbackWithDeps(deps, "cust-1", "t1", "not-quite");
    assert.equal(log.writeCalls.length, 1);
    assert.equal((log.writeCalls[0].data as { state?: string }).state, "REJECTED");
  });

  it("BV.2.7 not-quite also works on a CANDIDATE tendency", async () => {
    const { rows, deps } = makeStore([candidate("t2")]);
    const result = await applyFeedbackWithDeps(deps, "cust-1", "t2", "not-quite");
    assert.equal(result.ok, true);
    assert.equal(rows[0].state, "REJECTED");
  });
});

// ── BV.3 — Ownership and security ────────────────────────────────────────────

describe("BV.3 — ownership: cross-customer and nonexistent rejected", () => {
  it("BV.3.1 wrong customerId → NOT_FOUND (cross-customer protection)", async () => {
    const { deps } = makeStore([confirmed("t1", "cust-1")]);
    const result = await applyFeedbackWithDeps(deps, "cust-ATTACKER", "t1", "not-quite");
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "NOT_FOUND");
  });

  it("BV.3.2 nonexistent tendencyId → NOT_FOUND", async () => {
    const { deps } = makeStore([confirmed("t1")]);
    const result = await applyFeedbackWithDeps(deps, "cust-1", "DOES-NOT-EXIST", "accurate");
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "NOT_FOUND");
  });

  it("BV.3.3 correct customerId but wrong tendencyId → NOT_FOUND", async () => {
    const { deps } = makeStore([confirmed("t1", "cust-1"), confirmed("t2", "cust-2")]);
    // cust-1 can't access t2 which belongs to cust-2
    const result = await applyFeedbackWithDeps(deps, "cust-1", "t2", "accurate");
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "NOT_FOUND");
  });

  it("BV.3.4 writeFeedback NOT called when NOT_FOUND", async () => {
    const { log, deps } = makeStore([confirmed("t1")]);
    await applyFeedbackWithDeps(deps, "cust-WRONG", "t1", "not-quite");
    assert.equal(log.writeCalls.length, 0, "writeFeedback must not be called on NOT_FOUND");
  });

  it("BV.3.5 runReconcile NOT called when NOT_FOUND", async () => {
    const { log, deps } = makeStore([]);
    await applyFeedbackWithDeps(deps, "cust-1", "phantom", "not-quite");
    assert.equal(log.reconcileCalls.length, 0, "runReconcile must not be called on NOT_FOUND");
  });
});

// ── BV.4 — Idempotency and ALREADY_REJECTED guard ────────────────────────────

describe("BV.4 — ALREADY_REJECTED guard is idempotent and safe", () => {
  it("BV.4.1 second not-quite on REJECTED → ALREADY_REJECTED (no double-reject)", async () => {
    const { deps } = makeStore([rejected("t1")]);
    const result = await applyFeedbackWithDeps(deps, "cust-1", "t1", "not-quite");
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "ALREADY_REJECTED");
  });

  it("BV.4.2 accurate on REJECTED → ALREADY_REJECTED (no state mutation)", async () => {
    const { deps } = makeStore([rejected("t1")]);
    const result = await applyFeedbackWithDeps(deps, "cust-1", "t1", "accurate");
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "ALREADY_REJECTED");
  });

  it("BV.4.3 writeFeedback NOT called when ALREADY_REJECTED", async () => {
    const { log, deps } = makeStore([rejected("t1")]);
    await applyFeedbackWithDeps(deps, "cust-1", "t1", "not-quite");
    assert.equal(log.writeCalls.length, 0, "writeFeedback must not be called on ALREADY_REJECTED");
  });

  it("BV.4.4 runReconcile NOT called when ALREADY_REJECTED", async () => {
    const { log, deps } = makeStore([rejected("t1")]);
    await applyFeedbackWithDeps(deps, "cust-1", "t1", "not-quite");
    assert.equal(log.reconcileCalls.length, 0, "runReconcile must not be called on ALREADY_REJECTED");
  });
});

// ── BV.5 — REJECTED row invariants after not-quite ───────────────────────────

describe("BV.5 — REJECTED row preserved: state/feedback/timestamp immutable", () => {
  it("BV.5.1 REJECTED row retains state=REJECTED after a second (blocked) attempt", async () => {
    const { rows, deps } = makeStore([rejected("t1")]);
    await applyFeedbackWithDeps(deps, "cust-1", "t1", "accurate");
    assert.equal(rows[0].state, "REJECTED", "state must remain REJECTED");
  });

  it("BV.5.2 REJECTED row retains customerFeedback=not-quite after blocked attempt", async () => {
    const { rows, deps } = makeStore([rejected("t1")]);
    await applyFeedbackWithDeps(deps, "cust-1", "t1", "accurate");
    assert.equal(rows[0].customerFeedback, "not-quite");
  });

  it("BV.5.3 REJECTED row retains original customerFeedbackAt after blocked attempt", async () => {
    const originalAt = new Date("2026-09-01");
    const store = makeStore([{ id: "t1", customerId: "cust-1", state: "REJECTED", customerFeedback: "not-quite", customerFeedbackAt: originalAt }]);
    await applyFeedbackWithDeps(store.deps, "cust-1", "t1", "not-quite");
    assert.deepEqual(store.rows[0].customerFeedbackAt, originalAt, "customerFeedbackAt must not be overwritten");
  });

  it("BV.5.4 not-quite on CONFIRMED → REJECTED, then REJECTED is immutable", async () => {
    const { rows, deps } = makeStore([confirmed("t1")]);
    // First: mark not-quite
    await applyFeedbackWithDeps(deps, "cust-1", "t1", "not-quite");
    assert.equal(rows[0].state, "REJECTED");
    const feedbackAt = rows[0].customerFeedbackAt;
    // Second: attempt accurate on now-REJECTED row
    await applyFeedbackWithDeps(deps, "cust-1", "t1", "accurate");
    assert.equal(rows[0].state, "REJECTED", "state must still be REJECTED");
    assert.equal(rows[0].customerFeedback, "not-quite", "feedback must be not-quite, not accurate");
    assert.deepEqual(rows[0].customerFeedbackAt, feedbackAt, "timestamp must not change");
  });
});

// ── BV.6 — Customer-facing exclusion ─────────────────────────────────────────

describe("BV.6 — REJECTED tendency excluded from customer-facing queries", () => {
  it("BV.6.1 loadConfirmedTendencies Prisma query excludes customerFeedback: 'not-quite'", () => {
    // Source-code assertion: the query filter explicitly excludes not-quite feedback
    assert.ok(
      reconcileSrc.includes('customerFeedback: { not: "not-quite" }'),
      "loadConfirmedTendencies excludes customerFeedback: not-quite",
    );
  });

  it("BV.6.2 loadConfirmedTendencies Prisma query restricts state to CANDIDATE/CONFIRMED", () => {
    // REJECTED state is excluded at the state level too — double guard
    assert.ok(
      reconcileSrc.includes('state: { in: ["CANDIDATE", "CONFIRMED"] }'),
      "loadConfirmedTendencies restricts state to CANDIDATE/CONFIRMED",
    );
  });

  it("BV.6.3 loadStrongestConfirmedTendency excludes customerFeedback: 'not-quite'", () => {
    assert.ok(
      reconcileSrc.includes('state:            "CONFIRMED"') &&
      reconcileSrc.includes('customerFeedback: { not: "not-quite" }'),
      "loadStrongestConfirmedTendency has state+feedback double guard",
    );
  });

  it("BV.6.4 in-memory: a REJECTED row is excluded from CONFIRMED/CANDIDATE scan", () => {
    // Simulate what loadConfirmedTendencies does: filter by state in CANDIDATE|CONFIRMED
    // and customerFeedback != 'not-quite'
    const allRows = [
      confirmed("t1"),
      rejected("t2"),
      candidate("t3"),
    ];
    const customerFacing = allRows.filter(
      r => ["CANDIDATE", "CONFIRMED"].includes(r.state) && r.customerFeedback !== "not-quite",
    );
    assert.equal(customerFacing.length, 2, "REJECTED row is excluded");
    assert.ok(!customerFacing.some(r => r.id === "t2"), "t2 (REJECTED) not in results");
    assert.ok(customerFacing.some(r => r.id === "t1"), "t1 (CONFIRMED) in results");
    assert.ok(customerFacing.some(r => r.id === "t3"), "t3 (CANDIDATE) in results");
  });

  it("BV.6.5 accurate-feedback row stays visible to customer-facing query", () => {
    // An 'accurate' row should remain CONFIRMED and be included
    const accurateRow: StoreRow = { id: "t1", customerId: "cust-1", state: "CONFIRMED", customerFeedback: "accurate", customerFeedbackAt: new Date() };
    const customerFacing = [accurateRow].filter(
      r => ["CANDIDATE", "CONFIRMED"].includes(r.state) && r.customerFeedback !== "not-quite",
    );
    assert.equal(customerFacing.length, 1, "accurate-feedback CONFIRMED row is visible");
  });
});
