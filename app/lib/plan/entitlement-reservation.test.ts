// app/lib/plan/entitlement-reservation.test.ts
//
// Behavioral tests for reserveStyleMeSlot/reserveBuySkipSlot/reserveClosetSlot
// — the atomic closers for checkEntitlement's documented non-atomic race.
// Same DI/mock-transaction convention as my-naia-model.test.ts's CC.1-7
// (VTO's createOrFindTryOnJob), which these three functions deliberately
// mirror.
//
// No real Prisma, no real DB, no real transaction — the injected
// _runTransaction stands in for prisma.$transaction, exactly like VTO's
// RunTransactionFn stands in for its own job-creation transaction.
//
// What these tests can and cannot prove: they prove the count-check and the
// create happen inside the SAME transaction callback (the actual atomicity
// property — two real concurrent requests racing a real Postgres instance
// would serialize or conflict at exactly that boundary), and that retry/
// propagation on a P2034 conflict works. They cannot (and nothing in this
// environment can) empirically prove two real overlapping network requests
// against a live database behave this way — that would require a live
// Postgres instance under real concurrent load, which is how VTO's own
// equivalent tests are scoped too.
//
// Run: node --import tsx/esm --test app/lib/plan/entitlement-reservation.test.ts

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Prisma } from "@prisma/client";
import { reserveStyleMeSlot, reserveBuySkipSlot, reserveClosetSlot, type RunReservationFn } from "./entitlement.server";

const CUSTOMER_ID = "cust-reservation-test";

function p2034() {
  return Object.assign(new Error("Serialization failure"), { code: "P2034" });
}

// ── reserveStyleMeSlot ───────────────────────────────────────────────────────

describe("reserveStyleMeSlot", () => {
  const sessionData = { customerId: CUSTOMER_ID, currentMood: "tired", occasion: "work" };

  it("RSV.1 — allowed when under quota: count-check and create both happen inside the same transaction call", async () => {
    let txCalls = 0;
    let countCalledBeforeCreate = false;
    const mockTx: RunReservationFn = async (fn) => {
      txCalls++;
      return fn({
        stylingSession: {
          count: async () => { countCalledBeforeCreate = true; return 3; },
          create: async ({ data }: any) => {
            assert.equal(countCalledBeforeCreate, true, "create must happen after the count check, inside the same transaction");
            return { id: "session-1", ...data };
          },
        },
      } as any);
    };

    const result = await reserveStyleMeSlot(CUSTOMER_ID, "MEMBER", sessionData, mockTx);

    assert.equal(txCalls, 1, "exactly one transaction attempt for a clean success");
    assert.equal(result.allowed, true);
    if (!result.allowed) throw new Error("unreachable");
    assert.equal(result.record.id, "session-1");
  });

  it("RSV.2 — MEMBER at the 8/month limit is blocked, create is never called", async () => {
    const mockTx: RunReservationFn = async (fn) =>
      fn({
        stylingSession: {
          count: async () => 8, // effectiveStyleMeLimit for MEMBER is 8
          create: async () => { throw new Error("create must not be called when quota is exhausted"); },
        },
      } as any);

    const result = await reserveStyleMeSlot(CUSTOMER_ID, "MEMBER", sessionData, mockTx);
    assert.equal(result.allowed, false);
    if (result.allowed) throw new Error("unreachable");
    assert.equal(result.reason, "quota_exceeded");
  });

  it("RSV.3 — a guest (membershipStatus NONE) is blocked on the very first attempt, not just after using some — this is the guest-bypass fix", async () => {
    // NONE's styleMePerMonth allowance is 0 — a guest must never get a single
    // free generation through this path, which is exactly what style-me/
    // result.tsx's old `isEnforced && naiaCustomer` gate allowed before this fix.
    const mockTx: RunReservationFn = async (fn) =>
      fn({
        stylingSession: {
          count: async () => 0, // brand new guest, zero prior usage
          create: async () => { throw new Error("create must not be called for membershipStatus NONE"); },
        },
      } as any);

    const result = await reserveStyleMeSlot(CUSTOMER_ID, "NONE", sessionData, mockTx);
    assert.equal(result.allowed, false);
    if (result.allowed) throw new Error("unreachable");
    assert.equal(result.reason, "quota_exceeded");
  });

  it("RSV.4 — retries once on a P2034 serialization conflict, then succeeds", async () => {
    let txCalls = 0;
    const mockTx: RunReservationFn = async (fn) => {
      txCalls++;
      if (txCalls === 1) throw p2034();
      return fn({
        stylingSession: {
          count: async () => 0,
          create: async ({ data }: any) => ({ id: "session-after-retry", ...data }),
        },
      } as any);
    };

    const result = await reserveStyleMeSlot(CUSTOMER_ID, "MEMBER", sessionData, mockTx);
    assert.equal(result.allowed, true);
    assert.equal(txCalls, 2, "must retry exactly once on P2034");
  });

  it("RSV.5 — propagates the error once MAX_TX_RETRIES is exhausted", async () => {
    const mockTx: RunReservationFn = async (_fn) => { throw p2034(); };
    await assert.rejects(
      () => reserveStyleMeSlot(CUSTOMER_ID, "MEMBER", sessionData, mockTx),
      (e: any) => e.code === "P2034",
    );
  });

  it("RSV.6 — a non-serialization error is never retried, it propagates immediately", async () => {
    let txCalls = 0;
    const mockTx: RunReservationFn = async (_fn) => {
      txCalls++;
      throw Object.assign(new Error("connection terminated"), { code: "P1017" });
    };
    await assert.rejects(
      () => reserveStyleMeSlot(CUSTOMER_ID, "MEMBER", sessionData, mockTx),
      (e: any) => e.code === "P1017",
    );
    assert.equal(txCalls, 1, "a non-conflict error must not trigger the retry loop");
  });

  it("RSV.7 — the count query reuses the real qualifying-session filter (excludes continuations and no-eligible-product outcomes), not a re-implementation", async () => {
    let capturedWhere: any = null;
    const mockTx: RunReservationFn = async (fn) =>
      fn({
        stylingSession: {
          count: async ({ where }: any) => { capturedWhere = where; return 0; },
          create: async ({ data }: any) => ({ id: "x", ...data }),
        },
      } as any);

    await reserveStyleMeSlot(CUSTOMER_ID, "MEMBER", sessionData, mockTx);

    assert.equal(capturedWhere.customerId, CUSTOMER_ID);
    assert.equal(capturedWhere.parentSessionId, null, "root sessions only — continuations never consume quota");
    assert.deepEqual(capturedWhere.suggestions.some.AND[0], { moodDescription: { not: null } });
    assert.deepEqual(
      capturedWhere.suggestions.some.AND[1],
      { moodDescription: { not: { contains: '"outcome":"no-eligible-product"' } } },
      "a failed generation (no eligible product) must not consume a quota slot",
    );
  });
});

// ── reserveBuySkipSlot ───────────────────────────────────────────────────────

describe("reserveBuySkipSlot", () => {
  const analysisData: Prisma.BuyOrSkipAnalysisUncheckedCreateInput = {
    customerId: CUSTOMER_ID, verdict: "BUY", reasoning: "test reasoning", idempotencyKey: "key-1",
  };

  it("RSV.8 — allowed when under quota: count-check and create both happen inside the same transaction call", async () => {
    let countCalledBeforeCreate = false;
    const mockTx: RunReservationFn = async (fn) =>
      fn({
        buyOrSkipAnalysis: {
          count: async () => { countCalledBeforeCreate = true; return 2; },
          create: async ({ data }: any) => {
            assert.equal(countCalledBeforeCreate, true);
            return { id: "analysis-1", ...data };
          },
        },
      } as any);

    const result = await reserveBuySkipSlot(CUSTOMER_ID, "MEMBER", analysisData, mockTx);
    assert.equal(result.allowed, true);
    if (!result.allowed) throw new Error("unreachable");
    assert.equal(result.record.id, "analysis-1");
  });

  it("RSV.9 — MEMBER at the 5/month limit is blocked, create is never called", async () => {
    const mockTx: RunReservationFn = async (fn) =>
      fn({
        buyOrSkipAnalysis: {
          count: async () => 5, // buySkipPerMonth for MEMBER is 5
          create: async () => { throw new Error("create must not be called when quota is exhausted"); },
        },
      } as any);

    const result = await reserveBuySkipSlot(CUSTOMER_ID, "MEMBER", analysisData, mockTx);
    assert.equal(result.allowed, false);
    if (result.allowed) throw new Error("unreachable");
    assert.equal(result.reason, "quota_exceeded");
  });

  it("RSV.10 — membershipStatus NONE is blocked unconditionally (buySkipPerMonth is 0)", async () => {
    const mockTx: RunReservationFn = async (fn) =>
      fn({
        buyOrSkipAnalysis: {
          count: async () => 0,
          create: async () => { throw new Error("create must not be called for membershipStatus NONE"); },
        },
      } as any);

    const result = await reserveBuySkipSlot(CUSTOMER_ID, "NONE", analysisData, mockTx);
    assert.equal(result.allowed, false);
  });

  it("RSV.11 — a P2002 (duplicate idempotencyKey from a genuinely concurrent duplicate submission) propagates, it is not swallowed here", async () => {
    // Deliberately NOT caught inside reserveBuySkipSlot — api.wishlist.jsx's
    // own existing try/catch around this call already treats P2002 as an
    // idempotent repeat. Catching it here too would just be a second,
    // redundant place for that logic to drift out of sync with the first.
    const mockTx: RunReservationFn = async (_fn) => {
      throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    };
    await assert.rejects(
      () => reserveBuySkipSlot(CUSTOMER_ID, "MEMBER", analysisData, mockTx),
      (e: any) => e.code === "P2002",
    );
  });

  it("RSV.12 — retries once on a P2034 serialization conflict, then succeeds", async () => {
    let txCalls = 0;
    const mockTx: RunReservationFn = async (fn) => {
      txCalls++;
      if (txCalls === 1) throw p2034();
      return fn({
        buyOrSkipAnalysis: {
          count: async () => 0,
          create: async ({ data }: any) => ({ id: "analysis-after-retry", ...data }),
        },
      } as any);
    };

    const result = await reserveBuySkipSlot(CUSTOMER_ID, "MEMBER", analysisData, mockTx);
    assert.equal(result.allowed, true);
    assert.equal(txCalls, 2);
  });

  it("RSV.13 — the count query excludes INCOMPLETE verdicts (a failed analysis must not consume a quota slot)", async () => {
    let capturedWhere: any = null;
    const mockTx: RunReservationFn = async (fn) =>
      fn({
        buyOrSkipAnalysis: {
          count: async ({ where }: any) => { capturedWhere = where; return 0; },
          create: async ({ data }: any) => ({ id: "x", ...data }),
        },
      } as any);

    await reserveBuySkipSlot(CUSTOMER_ID, "MEMBER", analysisData, mockTx);

    assert.equal(capturedWhere.customerId, CUSTOMER_ID);
    assert.deepEqual(capturedWhere.verdict, { in: ["BUY", "SKIP", "MAYBE"] });
    assert.ok(!capturedWhere.verdict.in.includes("INCOMPLETE"), "a failed/unrecognized-verdict analysis must not count toward quota");
  });
});

// ── reserveClosetSlot ────────────────────────────────────────────────────────

describe("reserveClosetSlot", () => {
  const itemData: Prisma.ClosetItemCreateInput = {
    customer: { connect: { id: CUSTOMER_ID } },
    name: "test item",
    category: "TOPS",
  };

  it("RSV.14 — below the limit (249/250): allowed, count-check and create both happen inside the same transaction call", async () => {
    let countCalledBeforeCreate = false;
    const mockTx: RunReservationFn = async (fn) =>
      fn({
        closetItem: {
          count: async () => { countCalledBeforeCreate = true; return 249; },
          create: async ({ data }: any) => {
            assert.equal(countCalledBeforeCreate, true, "create must happen after the count check, inside the same transaction");
            return { id: "item-1", ...data };
          },
        },
      } as any);

    const result = await reserveClosetSlot(CUSTOMER_ID, "MEMBER", itemData, mockTx);
    assert.equal(result.allowed, true);
    if (!result.allowed) throw new Error("unreachable");
    assert.equal(result.record.id, "item-1");
  });

  it("RSV.15 — at the limit (250/250): blocked with at_capacity, create is never called", async () => {
    const mockTx: RunReservationFn = async (fn) =>
      fn({
        closetItem: {
          count: async () => 250, // MEMBER's closetItems allowance
          create: async () => { throw new Error("create must not be called at capacity"); },
        },
      } as any);

    const result = await reserveClosetSlot(CUSTOMER_ID, "MEMBER", itemData, mockTx);
    assert.equal(result.allowed, false);
    if (result.allowed) throw new Error("unreachable");
    assert.equal(result.reason, "at_capacity");
  });

  it("RSV.16 — membershipStatus NONE is blocked unconditionally (closetItems allowance is 0)", async () => {
    const mockTx: RunReservationFn = async (fn) =>
      fn({
        closetItem: {
          count: async () => 0,
          create: async () => { throw new Error("create must not be called for membershipStatus NONE"); },
        },
      } as any);

    const result = await reserveClosetSlot(CUSTOMER_ID, "NONE", itemData, mockTx);
    assert.equal(result.allowed, false);
  });

  it("RSV.17 — concurrent uploads: two reservations racing the last slot — the one whose transaction observes the updated count is correctly blocked", async () => {
    // Simulates the outcome a real Serializable transaction guarantees: the
    // second transaction to actually run its count query sees the first
    // one's committed row. This cannot execute two real overlapping network
    // requests against a live Postgres instance (see file header) — it
    // proves reserveClosetSlot correctly blocks once the count reflects the
    // other request's commit, which is exactly what Postgres serializes
    // concurrent transactions into.
    let committedCount = 249;
    const mockTx: RunReservationFn = async (fn) =>
      fn({
        closetItem: {
          count: async () => committedCount,
          create: async ({ data }: any) => {
            committedCount++; // the "other" request's commit becomes visible
            return { id: "item-first", ...data };
          },
        },
      } as any);

    const first = await reserveClosetSlot(CUSTOMER_ID, "MEMBER", itemData, mockTx);
    assert.equal(first.allowed, true, "first reservation fills the last slot (249 -> 250)");

    const second = await reserveClosetSlot(CUSTOMER_ID, "MEMBER", itemData, mockTx);
    assert.equal(second.allowed, false, "second reservation now observes 250/250 and is blocked");
    if (second.allowed) throw new Error("unreachable");
    assert.equal(second.reason, "at_capacity");
  });

  it("RSV.18 — retries once on a P2034 serialization conflict (two closets genuinely racing on the same row), then succeeds", async () => {
    let txCalls = 0;
    const mockTx: RunReservationFn = async (fn) => {
      txCalls++;
      if (txCalls === 1) throw p2034();
      return fn({
        closetItem: {
          count: async () => 100,
          create: async ({ data }: any) => ({ id: "item-after-retry", ...data }),
        },
      } as any);
    };

    const result = await reserveClosetSlot(CUSTOMER_ID, "MEMBER", itemData, mockTx);
    assert.equal(result.allowed, true);
    assert.equal(txCalls, 2);
  });

  it("RSV.19 — the count query is a plain customerId match with no date window — Closet is a hard-delete model, every row is active", async () => {
    let capturedWhere: any = null;
    const mockTx: RunReservationFn = async (fn) =>
      fn({
        closetItem: {
          count: async ({ where }: any) => { capturedWhere = where; return 0; },
          create: async ({ data }: any) => ({ id: "x", ...data }),
        },
      } as any);

    await reserveClosetSlot(CUSTOMER_ID, "MEMBER", itemData, mockTx);

    assert.deepEqual(capturedWhere, { customerId: CUSTOMER_ID }, "no createdAt window — unlike the monthly features, every existing row counts");
  });
});
