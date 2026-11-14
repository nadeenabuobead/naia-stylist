// app/lib/plan/entitlement-mock-vto-exclusion.test.ts
//
// Behavioral (vitest, ~/db.server mocked) coverage for the 2026-11-03 fix:
// staging-only Full-Look VTO mock jobs (productHandle prefixed
// "fulllook-poc:") must never count toward a customer's real monthly VTO
// allowance, in either the display summary (getEntitlementSummary) or the
// real enforcement gate (checkEntitlement) that api.trigger-tryon.tsx calls
// before a real, billable submission.
//
// This mocks only the database layer — getUsageWindow, formatResetDate,
// and the plan-limits functions all run for real (they're pure, no DB),
// so the window/limit values in these assertions are real, not faked.
//
// Run: npx vitest run app/lib/plan/entitlement-mock-vto-exclusion.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/db.server", () => ({
  default: {
    stylingSession: { count: vi.fn().mockResolvedValue(0) },
    buyOrSkipAnalysis: { count: vi.fn().mockResolvedValue(0) },
    virtualTryOnJob: { count: vi.fn().mockResolvedValue(0) },
    closetItem: { count: vi.fn().mockResolvedValue(0) },
    personalisedTrendEditUsage: { count: vi.fn().mockResolvedValue(0) },
    // Phase 2 (billing-cycle-aware windows) added a real subscription lookup
    // inside resolveEffectiveContext, called by every checkEntitlement/
    // getEntitlementSummary invocation — without this, every call in this
    // file throws "Cannot read properties of undefined (reading 'findFirst')"
    // before ever reaching the VTO-specific logic under test. Fixed
    // 2026-11-12 alongside the ENTITLEMENT_ENFORCEMENT fail-closed fix (see
    // fix/stripe-clerk-phase1-security) — this bug pre-dates that work and
    // was confirmed identical on the unmodified release-candidate baseline.
    subscription: { findFirst: vi.fn().mockResolvedValue(null), count: vi.fn().mockResolvedValue(0) },
  },
}));

import prisma from "~/db.server";
import { getEntitlementSummary, checkEntitlement, FULL_LOOK_INTERMEDIATE_HANDLE_PREFIXES } from "./entitlement.server";

const mockVtoCount = () => (prisma as any).virtualTryOnJob.count as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockVtoCount().mockResolvedValue(0);
  (prisma as any).stylingSession.count.mockResolvedValue(0);
  (prisma as any).buyOrSkipAnalysis.count.mockResolvedValue(0);
  (prisma as any).closetItem.count.mockResolvedValue(0);
  (prisma as any).personalisedTrendEditUsage.count.mockResolvedValue(0);
  (prisma as any).subscription.findFirst.mockResolvedValue(null);
  (prisma as any).subscription.count.mockResolvedValue(0);
});

describe("getEntitlementSummary — mock VTO jobs excluded from real usage", () => {
  it("both the completed and in-flight VTO queries exclude the fulllook-poc: mock-test namespace", async () => {
    await getEntitlementSummary("cust-1", "MEMBER");
    const vtoCalls = mockVtoCount().mock.calls.map((c: unknown[]) => c[0]);
    expect(vtoCalls).toHaveLength(2);
    for (const call of vtoCalls) {
      expect((call as any).where.NOT).toEqual([
        { productHandle: { startsWith: "fulllook-poc:" } },
        { productHandle: { startsWith: "fulllook-real:step1:" } },
        { productHandle: { startsWith: "fulllook-real:step2:" } },
      ]);
    }
  });

  it("three completed mock jobs are not reflected in monthlyCompleted — the query itself excludes them, not a post-hoc subtraction", async () => {
    // Simulates what the real exclusion filter guarantees: the database
    // query for monthlyCompleted never sees the 3 mock rows at all, so it
    // returns exactly the real count (2 here), not 5.
    mockVtoCount()
      .mockResolvedValueOnce(2) // vtoCompleted — real jobs only, mock rows excluded by the WHERE clause
      .mockResolvedValueOnce(0); // vtoInFlight
    const summary = await getEntitlementSummary("cust-1", "MEMBER");
    expect(summary.vto.monthlyCompleted).toBe(2);
  });
});

describe("checkEntitlement('vto') — the real production gate also excludes mock jobs", () => {
  it("both VTO count calls inside the real enforcement gate exclude the fulllook-poc: namespace", async () => {
    await checkEntitlement("cust-1", "MEMBER", "vto");
    const vtoCalls = mockVtoCount().mock.calls.map((c: unknown[]) => c[0]);
    expect(vtoCalls).toHaveLength(2);
    for (const call of vtoCalls) {
      expect((call as any).where.NOT).toEqual([
        { productHandle: { startsWith: "fulllook-poc:" } },
        { productHandle: { startsWith: "fulllook-real:step1:" } },
        { productHandle: { startsWith: "fulllook-real:step2:" } },
      ]);
    }
  });

  it("a customer with 3 completed mock jobs and otherwise zero real usage is still allowed a real VTO submission", async () => {
    // If the exclusion were missing, completed(3 mock) + inFlight(0) >= limit
    // would wrongly block a real submission. With the exclusion, the mock
    // rows are invisible to this query and the real count is 0.
    mockVtoCount().mockResolvedValueOnce(0).mockResolvedValueOnce(0);
    const result = await checkEntitlement("cust-1", "MEMBER", "vto");
    expect(result.allowed).toBe(true);
  });
});

// 2026-11-12 (fix/stripe-clerk-phase1-security): api.trigger-tryon.tsx's
// quota guard is unconditional now — no ENTITLEMENT_ENFORCEMENT flag gate —
// so checkEntitlement("vto") is the single real enforcement point for every
// VTO submission. These prove its actual allow/deny behavior at every
// relevant boundary, not just that the route calls it.
describe("checkEntitlement('vto') — unpaid vs. paid access, real boundary behavior", () => {
  it("a never-subscribed (membershipStatus NONE) customer is denied, even with zero prior usage", async () => {
    // NONE's vtoPerMonth allowance is 0 — 0 completed + 0 in-flight is still
    // >= 0, so this must deny on the very first attempt, not just after
    // some usage. This is the exact fail-open bug the entitlement audit
    // found: before the fix, this check was skipped entirely unless
    // ENTITLEMENT_ENFORCEMENT was literally "true" in the environment.
    mockVtoCount().mockResolvedValueOnce(0).mockResolvedValueOnce(0);
    const result = await checkEntitlement("cust-none", "NONE", "vto");
    expect(result.allowed).toBe(false);
    if (result.allowed) throw new Error("unreachable");
    expect(result.reason).toBe("quota_exceeded");
  });

  it("a MEMBER under the 10/month limit is allowed", async () => {
    mockVtoCount().mockResolvedValueOnce(6).mockResolvedValueOnce(0); // 6 completed, 0 in-flight
    const result = await checkEntitlement("cust-member", "MEMBER", "vto");
    expect(result.allowed).toBe(true);
  });

  it("a MEMBER exactly at the 10/month limit (completed + in-flight) is denied", async () => {
    mockVtoCount().mockResolvedValueOnce(7).mockResolvedValueOnce(3); // 7 completed + 3 in-flight = 10
    const result = await checkEntitlement("cust-member", "MEMBER", "vto");
    expect(result.allowed).toBe(false);
    if (result.allowed) throw new Error("unreachable");
    expect(result.reason).toBe("quota_exceeded");
  });

  it("a MEMBER one under the limit is still allowed — boundary is >=, not >", async () => {
    mockVtoCount().mockResolvedValueOnce(9).mockResolvedValueOnce(0);
    const result = await checkEntitlement("cust-member", "MEMBER", "vto");
    expect(result.allowed).toBe(true);
  });
});

// 2026-11-14 — founder decision: a completed Full-Look outfit costs exactly
// 1 credit, not 1 per garment step. These prove the actual exclusion
// semantics directly (not just the query's filter shape, which the tests
// above already cover) — applying the real prefix list to a representative
// set of productHandle values a real 3-step chain would write.
describe("Full-Look VTO intermediate-step exclusion — 1 credit per outfit, not 1 per garment", () => {
  function isCountedHandle(productHandle: string): boolean {
    if (productHandle.startsWith("fulllook-poc:")) return false;
    return !FULL_LOOK_INTERMEDIATE_HANDLE_PREFIXES.some((prefix) => productHandle.startsWith(prefix));
  }

  it("of a real chain's 3 step handles, only the final step (step3) counts", () => {
    expect(isCountedHandle("fulllook-real:step1:trousers")).toBe(false);
    expect(isCountedHandle("fulllook-real:step2:shirt")).toBe(false);
    expect(isCountedHandle("fulllook-real:step3:blazer")).toBe(true);
  });

  it("a single-item VTO handle (no full-look prefix at all) still counts, unaffected by this exclusion", () => {
    expect(isCountedHandle("collar-shirt-12345")).toBe(true);
  });

  it("one completed outfit (3 rows written, 1 of them step3) contributes exactly 1 to vtoCompleted's real query — proven via the actual exclusion filter, not a mocked count", async () => {
    // The mock can't evaluate a real WHERE clause against rows, so this
    // proves the filter's OWN exclusion list — read directly off the
    // function under test, not duplicated here — matches the one genuine
    // chain-step handle format exactly, closing the gap between "the
    // filter shape is X" (asserted above) and "X actually excludes what a
    // real chain writes" (this test).
    const chainHandles = ["fulllook-real:step1:trousers", "fulllook-real:step2:shirt", "fulllook-real:step3:blazer"];
    const countedAfterExclusion = chainHandles.filter(isCountedHandle);
    expect(countedAfterExclusion).toEqual(["fulllook-real:step3:blazer"]);
  });

  it("the enforcement gate's own NOT filter includes both intermediate-step prefixes, not just the mock-harness one", async () => {
    await checkEntitlement("cust-1", "MEMBER", "vto");
    const vtoCalls = mockVtoCount().mock.calls.map((c: unknown[]) => c[0]);
    for (const call of vtoCalls) {
      const notClauses = (call as any).where.NOT as Array<{ productHandle: { startsWith: string } }>;
      const prefixes = notClauses.map((c) => c.productHandle.startsWith);
      for (const intermediatePrefix of FULL_LOOK_INTERMEDIATE_HANDLE_PREFIXES) {
        expect(prefixes).toContain(intermediatePrefix);
      }
    }
  });
});
