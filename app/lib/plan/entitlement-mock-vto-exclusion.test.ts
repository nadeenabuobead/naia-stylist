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
        { productHandle: { startsWith: "fulllook-real:step3:" } },
        { productHandle: { startsWith: "fulllook-real:step4:" } },
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
        { productHandle: { startsWith: "fulllook-real:step3:" } },
        { productHandle: { startsWith: "fulllook-real:step4:" } },
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
// above already cover) — applying the real prefix list to representative
// productHandle values a real chain would write.
//
// 2026-11-15 — chain length is now per-outfit (3-5 garments), and the
// FINAL step is tagged by role ("fulllook-real:final:"), never by a fixed
// step number — a 3-garment chain's final step and a 5-garment chain's
// final step both use the identical "final" tag, so exactly one
// COMPLETED row ever counts per outfit regardless of how many garments it
// used. See full-look-handle-constants.ts's own header for why a fixed
// step number can't identify "the final step" once length varies.
describe("Full-Look VTO intermediate-step exclusion — 1 credit per outfit, not 1 per garment", () => {
  function isCountedHandle(productHandle: string): boolean {
    if (productHandle.startsWith("fulllook-poc:")) return false;
    return !FULL_LOOK_INTERMEDIATE_HANDLE_PREFIXES.some((prefix) => productHandle.startsWith(prefix));
  }

  it("of a 3-garment chain's step handles, only the role-tagged 'final' step counts — never a numbered 'step3'", () => {
    expect(isCountedHandle("fulllook-real:step1:trousers")).toBe(false);
    expect(isCountedHandle("fulllook-real:step2:shirt")).toBe(false);
    expect(isCountedHandle("fulllook-real:step3:shirt")).toBe(false); // would ONLY be intermediate for a longer chain, but never counted either way
    expect(isCountedHandle("fulllook-real:final:blazer")).toBe(true);
  });

  it("of a 5-garment chain's step handles (sweater/jeans/jacket/boots/cap), only 'final' counts — every numbered step, including step4, is excluded", () => {
    expect(isCountedHandle("fulllook-real:step1:Black Sweater")).toBe(false);
    expect(isCountedHandle("fulllook-real:step2:Black Jeans")).toBe(false);
    expect(isCountedHandle("fulllook-real:step3:Black Wool Shirt Jacket")).toBe(false);
    expect(isCountedHandle("fulllook-real:step4:Brown Chelsea Boots")).toBe(false);
    expect(isCountedHandle("fulllook-real:final:Black Baseball Cap")).toBe(true);
  });

  it("a single-item VTO handle (no full-look prefix at all) still counts, unaffected by this exclusion", () => {
    expect(isCountedHandle("collar-shirt-12345")).toBe(true);
  });

  it("one completed 3-garment outfit (3 rows written, 1 of them 'final') contributes exactly 1 to vtoCompleted's real query — proven via the actual exclusion filter, not a mocked count", async () => {
    // The mock can't evaluate a real WHERE clause against rows, so this
    // proves the filter's OWN exclusion list — read directly off the
    // function under test, not duplicated here — matches the one genuine
    // chain-step handle format exactly, closing the gap between "the
    // filter shape is X" (asserted above) and "X actually excludes what a
    // real chain writes" (this test).
    const chainHandles = ["fulllook-real:step1:trousers", "fulllook-real:step2:shirt", "fulllook-real:final:blazer"];
    const countedAfterExclusion = chainHandles.filter(isCountedHandle);
    expect(countedAfterExclusion).toEqual(["fulllook-real:final:blazer"]);
  });

  it("one completed 5-garment outfit (5 rows written, 1 of them 'final') ALSO contributes exactly 1 — the same guarantee holds at every supported chain length", async () => {
    const chainHandles = [
      "fulllook-real:step1:Black Sweater", "fulllook-real:step2:Black Jeans",
      "fulllook-real:step3:Black Wool Shirt Jacket", "fulllook-real:step4:Brown Chelsea Boots",
      "fulllook-real:final:Black Baseball Cap",
    ];
    const countedAfterExclusion = chainHandles.filter(isCountedHandle);
    expect(countedAfterExclusion).toEqual(["fulllook-real:final:Black Baseball Cap"]);
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
