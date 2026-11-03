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
  },
}));

import prisma from "~/db.server";
import { getEntitlementSummary, checkEntitlement } from "./entitlement.server";

const mockVtoCount = () => (prisma as any).virtualTryOnJob.count as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockVtoCount().mockResolvedValue(0);
  (prisma as any).stylingSession.count.mockResolvedValue(0);
  (prisma as any).buyOrSkipAnalysis.count.mockResolvedValue(0);
  (prisma as any).closetItem.count.mockResolvedValue(0);
  (prisma as any).personalisedTrendEditUsage.count.mockResolvedValue(0);
});

describe("getEntitlementSummary — mock VTO jobs excluded from real usage", () => {
  it("both the completed and in-flight VTO queries exclude the fulllook-poc: mock-test namespace", async () => {
    await getEntitlementSummary("cust-1", "MEMBER");
    const vtoCalls = mockVtoCount().mock.calls.map((c: unknown[]) => c[0]);
    expect(vtoCalls).toHaveLength(2);
    for (const call of vtoCalls) {
      expect((call as any).where.NOT).toEqual({ productHandle: { startsWith: "fulllook-poc:" } });
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
      expect((call as any).where.NOT).toEqual({ productHandle: { startsWith: "fulllook-poc:" } });
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
