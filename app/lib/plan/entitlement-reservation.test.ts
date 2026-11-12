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
import { reserveStyleMeSlot, reserveBuySkipSlot, reserveClosetSlot, reservePersonalisedTrendSlot, type RunReservationFn, type EffectiveContextDeps } from "./entitlement.server";

const CUSTOMER_ID = "cust-reservation-test";

// Phase 2 added a real (un-mocked by default) subscription lookup inside
// every reserve* function. Every test below predates Phase 2 and was
// written to test the base-allowance case — no subscription — so this
// mock preserves that exact original intent explicitly, rather than
// letting the real lookup hit a database that doesn't exist in this
// environment. Phase-2-specific tests (RSV.20+) pass their own synthetic
// subscription instead.
//
// hasAnySubscriptionRecord is stubbed false alongside it — this is the
// reconciliation-concern-2 existence check added after Phase 2, and "no
// subscription at all" (what this constant represents) must report no
// tracked row either, or the fallback branch would wrongly treat every
// test customer here as having a non-entitled Subscription row and force
// the NONE-equivalent allowance regardless of the membershipStatus each
// test passes in.
const NO_SUBSCRIPTION: EffectiveContextDeps = {
  getSubscription: async () => null,
  hasAnySubscriptionRecord: async () => false,
};

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

    const result = await reserveStyleMeSlot(CUSTOMER_ID, "MEMBER", sessionData, mockTx, NO_SUBSCRIPTION);

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

    const result = await reserveStyleMeSlot(CUSTOMER_ID, "MEMBER", sessionData, mockTx, NO_SUBSCRIPTION);
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

    const result = await reserveStyleMeSlot(CUSTOMER_ID, "NONE", sessionData, mockTx, NO_SUBSCRIPTION);
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

    const result = await reserveStyleMeSlot(CUSTOMER_ID, "MEMBER", sessionData, mockTx, NO_SUBSCRIPTION);
    assert.equal(result.allowed, true);
    assert.equal(txCalls, 2, "must retry exactly once on P2034");
  });

  it("RSV.5 — propagates the error once MAX_TX_RETRIES is exhausted", async () => {
    const mockTx: RunReservationFn = async (_fn) => { throw p2034(); };
    await assert.rejects(
      () => reserveStyleMeSlot(CUSTOMER_ID, "MEMBER", sessionData, mockTx, NO_SUBSCRIPTION),
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
      () => reserveStyleMeSlot(CUSTOMER_ID, "MEMBER", sessionData, mockTx, NO_SUBSCRIPTION),
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

    await reserveStyleMeSlot(CUSTOMER_ID, "MEMBER", sessionData, mockTx, NO_SUBSCRIPTION);

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

    const result = await reserveBuySkipSlot(CUSTOMER_ID, "MEMBER", analysisData, mockTx, NO_SUBSCRIPTION);
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

    const result = await reserveBuySkipSlot(CUSTOMER_ID, "MEMBER", analysisData, mockTx, NO_SUBSCRIPTION);
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

    const result = await reserveBuySkipSlot(CUSTOMER_ID, "NONE", analysisData, mockTx, NO_SUBSCRIPTION);
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
      () => reserveBuySkipSlot(CUSTOMER_ID, "MEMBER", analysisData, mockTx, NO_SUBSCRIPTION),
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

    const result = await reserveBuySkipSlot(CUSTOMER_ID, "MEMBER", analysisData, mockTx, NO_SUBSCRIPTION);
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

    await reserveBuySkipSlot(CUSTOMER_ID, "MEMBER", analysisData, mockTx, NO_SUBSCRIPTION);

    assert.equal(capturedWhere.customerId, CUSTOMER_ID);
    assert.deepEqual(capturedWhere.verdict, { in: ["BUY", "SKIP", "MAYBE"] });
    assert.ok(!capturedWhere.verdict.in.includes("INCOMPLETE"), "a failed/unrecognized-verdict analysis must not count toward quota");
  });

  it("RSV.26 — an active (unresolved) PendingCloudinaryDeletion claim on this exact publicId blocks the create and is checked AFTER the count, inside the same transaction", async () => {
    const claimedAnalysisData = { ...analysisData, imagePublicId: "naia-wardrobe/cust/claimed-asset" };
    let countCheckedFirst = false;
    const mockTx: RunReservationFn = async (fn) =>
      fn({
        buyOrSkipAnalysis: {
          count: async () => { countCheckedFirst = true; return 0; },
          create: async () => { throw new Error("create must not be called when the asset is claimed for deletion"); },
        },
        pendingCloudinaryDeletion: {
          findUnique: async ({ where }: any) => {
            assert.equal(countCheckedFirst, true, "the claim check must run after the count check, not before");
            assert.equal(where.publicId, "naia-wardrobe/cust/claimed-asset");
            return { resolvedAt: null };
          },
        },
      } as any);

    const result = await reserveBuySkipSlot(CUSTOMER_ID, "MEMBER", claimedAnalysisData, mockTx, NO_SUBSCRIPTION);
    assert.equal(result.allowed, false);
    if (result.allowed) throw new Error("unreachable");
    assert.equal(result.reason, "asset_pending_deletion");
  });

  it("RSV.27 — a RESOLVED PendingCloudinaryDeletion row for this publicId does not block the create", async () => {
    const resolvedAnalysisData = { ...analysisData, imagePublicId: "naia-wardrobe/cust/already-resolved" };
    const mockTx: RunReservationFn = async (fn) =>
      fn({
        buyOrSkipAnalysis: {
          count: async () => 0,
          create: async ({ data }: any) => ({ id: "analysis-ok", ...data }),
        },
        pendingCloudinaryDeletion: {
          findUnique: async () => ({ resolvedAt: new Date() }),
        },
      } as any);

    const result = await reserveBuySkipSlot(CUSTOMER_ID, "MEMBER", resolvedAnalysisData, mockTx, NO_SUBSCRIPTION);
    assert.equal(result.allowed, true);
  });

  it("RSV.28 — no imagePublicId on the analysis data means the claim check never touches pendingCloudinaryDeletion at all", async () => {
    const mockTx: RunReservationFn = async (fn) =>
      fn({
        buyOrSkipAnalysis: {
          count: async () => 0,
          create: async ({ data }: any) => ({ id: "x", ...data }),
        },
        // Deliberately no pendingCloudinaryDeletion key — accessing it would throw.
      } as any);

    const result = await reserveBuySkipSlot(CUSTOMER_ID, "MEMBER", analysisData, mockTx, NO_SUBSCRIPTION);
    assert.equal(result.allowed, true);
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

    const result = await reserveClosetSlot(CUSTOMER_ID, "MEMBER", itemData, mockTx, NO_SUBSCRIPTION);
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

    const result = await reserveClosetSlot(CUSTOMER_ID, "MEMBER", itemData, mockTx, NO_SUBSCRIPTION);
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

    const result = await reserveClosetSlot(CUSTOMER_ID, "NONE", itemData, mockTx, NO_SUBSCRIPTION);
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

    const first = await reserveClosetSlot(CUSTOMER_ID, "MEMBER", itemData, mockTx, NO_SUBSCRIPTION);
    assert.equal(first.allowed, true, "first reservation fills the last slot (249 -> 250)");

    const second = await reserveClosetSlot(CUSTOMER_ID, "MEMBER", itemData, mockTx, NO_SUBSCRIPTION);
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

    const result = await reserveClosetSlot(CUSTOMER_ID, "MEMBER", itemData, mockTx, NO_SUBSCRIPTION);
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

    await reserveClosetSlot(CUSTOMER_ID, "MEMBER", itemData, mockTx, NO_SUBSCRIPTION);

    assert.deepEqual(capturedWhere, { customerId: CUSTOMER_ID }, "no createdAt window — unlike the monthly features, every existing row counts");
  });

  it("RSV.29 — an active claim on this exact imagePublicId blocks the create, checked after the count, inside the same transaction", async () => {
    const claimedItemData = { ...itemData, imagePublicId: "naia-wardrobe/cust/claimed-asset" };
    let countCheckedFirst = false;
    const mockTx: RunReservationFn = async (fn) =>
      fn({
        closetItem: {
          count: async () => { countCheckedFirst = true; return 0; },
          create: async () => { throw new Error("create must not be called when the asset is claimed for deletion"); },
        },
        pendingCloudinaryDeletion: {
          findUnique: async ({ where }: any) => {
            assert.equal(countCheckedFirst, true);
            assert.equal(where.publicId, "naia-wardrobe/cust/claimed-asset");
            return { resolvedAt: null };
          },
        },
      } as any);

    const result = await reserveClosetSlot(CUSTOMER_ID, "MEMBER", claimedItemData, mockTx, NO_SUBSCRIPTION);
    assert.equal(result.allowed, false);
    if (result.allowed) throw new Error("unreachable");
    assert.equal(result.reason, "asset_pending_deletion");
  });

  it("RSV.30 — no imagePublicId on the item data means the claim check never touches pendingCloudinaryDeletion at all", async () => {
    const mockTx: RunReservationFn = async (fn) =>
      fn({
        closetItem: {
          count: async () => 0,
          create: async ({ data }: any) => ({ id: "x", ...data }),
        },
      } as any);

    const result = await reserveClosetSlot(CUSTOMER_ID, "MEMBER", itemData, mockTx, NO_SUBSCRIPTION);
    assert.equal(result.allowed, true);
  });
});

// ── reservePersonalisedTrendSlot ─────────────────────────────────────────────
// Closes a real race (2026-11-04 review): the monthly allowance is ONE,
// ACCOUNT-WIDE ACROSS EVERY REPORT, but PersonalisedTrendEditUsage's own
// @@unique([customerId, reportSlug, periodKey]) constraint only ever
// protected a duplicate submission for the SAME report — two concurrent
// generations for two DIFFERENT reports never conflict on it. RSV.21 below
// is the test that actually proves this fix's reason for existing.

describe("reservePersonalisedTrendSlot", () => {
  const SNAPSHOT = {
    schemaVersion: "trend-edit-snapshot-v1" as const,
    reportSlug: "spring-2026-soft-structure",
    reportTitle: "Spring 2026 Soft Structure",
    generatedAt: "2026-11-04T00:00:00.000Z",
    edit: { subTitle: "x", yourVersion: "y" } as any,
    nadineRecommendation: null,
  };

  it("RSV.20 — allowed when under quota: the account-wide count-check and the upsert both happen inside the same transaction call", async () => {
    let countCalledBeforeUpsert = false;
    const mockTx: RunReservationFn = async (fn) =>
      fn({
        personalisedTrendEditUsage: {
          count: async () => { countCalledBeforeUpsert = true; return 0; },
          upsert: async ({ create }: any) => {
            assert.equal(countCalledBeforeUpsert, true, "upsert must happen after the count check, inside the same transaction");
            return { id: "usage-1", ...create };
          },
        },
      } as any);

    const result = await reservePersonalisedTrendSlot(CUSTOMER_ID, "MEMBER", "spring-2026-soft-structure", SNAPSHOT, mockTx, NO_SUBSCRIPTION);
    assert.equal(result.allowed, true);
    if (!result.allowed) throw new Error("unreachable");
    assert.equal(result.record.id, "usage-1");
  });

  it("RSV.21 — THE FIX: at the account-wide 1/month limit, blocked regardless of which report is being requested — the race the per-report unique constraint never caught", async () => {
    const mockTx: RunReservationFn = async (fn) =>
      fn({
        personalisedTrendEditUsage: {
          // Already has 1 usage row THIS PERIOD FOR A DIFFERENT REPORT —
          // the count has no reportSlug filter, matching checkEntitlement's
          // own count exactly, so this must block regardless.
          count: async ({ where }: any) => {
            assert.ok(!("reportSlug" in where), "the quota count must be account-wide — no reportSlug filter");
            return 1;
          },
          upsert: async () => { throw new Error("upsert must not be called when the account-wide quota is exhausted"); },
        },
      } as any);

    const result = await reservePersonalisedTrendSlot(CUSTOMER_ID, "MEMBER", "a-totally-different-report", SNAPSHOT, mockTx, NO_SUBSCRIPTION);
    assert.equal(result.allowed, false);
    if (result.allowed) throw new Error("unreachable");
    assert.equal(result.reason, "quota_exceeded");
  });

  it("RSV.22 — a guest (membershipStatus NONE) is blocked on the very first attempt — zero allowance, short-circuited before any transaction even opens", async () => {
    let txOpened = false;
    const mockTx: RunReservationFn = async (fn) => {
      txOpened = true;
      return fn({ personalisedTrendEditUsage: { count: async () => 0, upsert: async () => ({}) } } as any);
    };

    const result = await reservePersonalisedTrendSlot(CUSTOMER_ID, "NONE", "spring-2026-soft-structure", SNAPSHOT, mockTx, NO_SUBSCRIPTION);
    assert.equal(result.allowed, false);
    if (result.allowed) throw new Error("unreachable");
    assert.equal(result.reason, "quota_exceeded");
    assert.equal(txOpened, false, "NONE's zero allowance is checked before ever opening a transaction");
  });

  it("RSV.23 — a concurrent duplicate for THIS EXACT report+period resolves through the upsert's own update branch, not a thrown P2002 or a second row", async () => {
    let upsertCalls = 0;
    const mockTx: RunReservationFn = async (fn) =>
      fn({
        personalisedTrendEditUsage: {
          count: async () => 0,
          upsert: async ({ create, update }: any) => {
            upsertCalls++;
            // Models the DB resolving the composite-unique conflict server-side —
            // the application code's job is just to issue the upsert correctly.
            assert.ok(create);
            assert.deepEqual(update, {});
            return { id: "usage-existing" };
          },
        },
      } as any);

    const result = await reservePersonalisedTrendSlot(CUSTOMER_ID, "MEMBER", "spring-2026-soft-structure", SNAPSHOT, mockTx, NO_SUBSCRIPTION);
    assert.equal(result.allowed, true);
    assert.equal(upsertCalls, 1);
  });

  it("RSV.24 — retries once on a P2034 serialization conflict, then succeeds", async () => {
    let txCalls = 0;
    const mockTx: RunReservationFn = async (fn) => {
      txCalls++;
      if (txCalls === 1) throw p2034();
      return fn({
        personalisedTrendEditUsage: {
          count: async () => 0,
          upsert: async ({ create }: any) => ({ id: "usage-after-retry", ...create }),
        },
      } as any);
    };

    const result = await reservePersonalisedTrendSlot(CUSTOMER_ID, "MEMBER", "spring-2026-soft-structure", SNAPSHOT, mockTx, NO_SUBSCRIPTION);
    assert.equal(result.allowed, true);
    assert.equal(txCalls, 2, "must retry exactly once on P2034");
  });

  it("RSV.25 — a non-serialization error is never retried, it propagates immediately", async () => {
    let txCalls = 0;
    const mockTx: RunReservationFn = async (_fn) => {
      txCalls++;
      throw Object.assign(new Error("connection terminated"), { code: "P1017" });
    };
    await assert.rejects(
      () => reservePersonalisedTrendSlot(CUSTOMER_ID, "MEMBER", "spring-2026-soft-structure", SNAPSHOT, mockTx, NO_SUBSCRIPTION),
      (e: any) => e.code === "P1017",
    );
    assert.equal(txCalls, 1, "a non-conflict error must not trigger the retry loop");
  });
});
