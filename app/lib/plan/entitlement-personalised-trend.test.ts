// app/lib/plan/entitlement-personalised-trend.test.ts
//
// Behavioral tests for the "personalisedTrend" case added to
// checkEntitlement() and getEntitlementSummary(), now backed by
// PersonalisedTrendEditUsage (real customer entitlement/usage truth) rather
// than the permanently-null placeholder. Mocks prisma + getUsageWindow —
// same no-live-DB convention as every other usage check in this codebase —
// to prove the exact query shape and resulting allow/deny decision, not
// just that a string appears in source.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { countMock } = vi.hoisted(() => ({ countMock: vi.fn() }));

vi.mock("~/db.server", () => ({
  default: {
    personalisedTrendEditUsage: { count: countMock },
    stylingSession: { count: vi.fn().mockResolvedValue(0) },
    buyOrSkipAnalysis: { count: vi.fn().mockResolvedValue(0) },
    virtualTryOnJob: { count: vi.fn().mockResolvedValue(0) },
    closetItem: { count: vi.fn().mockResolvedValue(0) },
    // Phase 2 (billing-cycle-aware windows) added a real subscription
    // lookup inside getCurrentSubscription, called from every
    // checkEntitlement/getEntitlementSummary path this file exercises —
    // null here means "no subscription row," so this file's own direct
    // membershipStatus argument (not a real Subscription) continues to
    // decide the outcome, matching its original intent before that lookup
    // existed. Same fix already applied in the sibling
    // entitlement-mock-vto-exclusion.test.ts for the identical reason.
    subscription: { findFirst: vi.fn().mockResolvedValue(null), count: vi.fn().mockResolvedValue(0) },
  },
}));

// Relative to the real current time, not a hardcoded past literal —
// resolveEffectiveContext's countingEnd (entitlement.server.ts) extends
// the counting upper bound to "now" whenever window.end has already
// elapsed (the PH2-15 stale-window fix), which would otherwise silently
// break every query-shape assertion below the moment real time passed
// whatever date was hardcoded here. These tests are about window-scoping
// itself, not countingEnd's own stale-window behavior (see
// billing-entitlement-phase2.test.ts's PH2-15 block for that), so keeping
// window.end safely in the future sidesteps it entirely.
const WINDOW = {
  start: new Date(Date.now() - 1000 * 60 * 60 * 24 * 14),
  end: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14),
  label: "October 2026",
  periodKey: "2026-10",
};

vi.mock("./usage-window.server", () => ({
  getUsageWindow: vi.fn(() => WINDOW),
  formatResetDate: vi.fn(() => "1 November"),
}));

import { checkEntitlement, getEntitlementSummary } from "./entitlement.server";

describe("§TREND-EDIT-ENTITLEMENT — checkEntitlement('personalisedTrend')", () => {
  beforeEach(() => vi.clearAllMocks());

  it("binary membership short-circuit: NONE is denied without ever querying usage", async () => {
    const result = await checkEntitlement("cust-1", "NONE", "personalisedTrend");
    expect(result).toEqual({ allowed: false, reason: "quota_exceeded" });
    expect(countMock).not.toHaveBeenCalled();
  });

  it("16. MEMBER with zero current-period usage is permitted", async () => {
    countMock.mockResolvedValue(0);
    const result = await checkEntitlement("cust-1", "MEMBER", "personalisedTrend");
    expect(result).toEqual({ allowed: true });
  });

  it("17. MEMBER at the limit (count >= 1) is denied with the canonical quota-exceeded shape", async () => {
    countMock.mockResolvedValue(1);
    const result = await checkEntitlement("cust-1", "MEMBER", "personalisedTrend");
    expect(result).toEqual({ allowed: false, reason: "quota_exceeded" });
  });

  it("12. the usage count query is scoped to exactly the current usage-window boundaries", async () => {
    countMock.mockResolvedValue(0);
    await checkEntitlement("cust-1", "MEMBER", "personalisedTrend");
    expect(countMock).toHaveBeenCalledWith({
      where: { customerId: "cust-1", createdAt: { gte: WINDOW.start, lt: WINDOW.end } },
    });
  });

  it("18. a previous period's usage does not block the current period — the query filters by the current window only, never an unbounded customer total", async () => {
    // The real race-safety guarantee here is structural: the where clause
    // always includes the current window's createdAt bound, so a count from
    // any other period is excluded by construction, not by a runtime branch
    // that could be bypassed.
    countMock.mockResolvedValue(0);
    await checkEntitlement("cust-1", "MEMBER", "personalisedTrend");
    const where = countMock.mock.calls[0][0].where;
    expect(where.createdAt.gte).toEqual(WINDOW.start);
    expect(where.createdAt.lt).toEqual(WINDOW.end);
  });

  it("19. JourneyEvent is never read for entitlement — only PersonalisedTrendEditUsage.count is queried", async () => {
    countMock.mockResolvedValue(0);
    await checkEntitlement("cust-1", "MEMBER", "personalisedTrend");
    // The only mocked model touched by this case is personalisedTrendEditUsage;
    // asserting the call shape above already proves this, and no journeyEvent
    // mock exists in this file at all for the case to have called.
    expect(countMock).toHaveBeenCalledTimes(1);
  });
});

describe("§TREND-EDIT-ENTITLEMENT — getEntitlementSummary().personalisedTrend", () => {
  beforeEach(() => vi.clearAllMocks());

  it("13. truthfully reports 0 of 1 for a MEMBER with no usage this period", async () => {
    countMock.mockResolvedValue(0);
    const summary = await getEntitlementSummary("cust-1", "MEMBER");
    expect(summary.personalisedTrend).toEqual({ monthlyLimit: 1, monthlyUsed: 0 });
  });

  it("14. truthfully reports 1 of 1 for a MEMBER who has consumed this period's single edit", async () => {
    countMock.mockResolvedValue(1);
    const summary = await getEntitlementSummary("cust-1", "MEMBER");
    expect(summary.personalisedTrend).toEqual({ monthlyLimit: 1, monthlyUsed: 1 });
  });

  it("15. a historical anomaly (2 usage rows while enforcement was disabled) is reported truthfully, not clamped or hidden", async () => {
    countMock.mockResolvedValue(2);
    const summary = await getEntitlementSummary("cust-1", "MEMBER");
    expect(summary.personalisedTrend).toEqual({ monthlyLimit: 1, monthlyUsed: 2 });
  });

  it("NONE always reports monthlyLimit 0, regardless of any historical usage rows", async () => {
    countMock.mockResolvedValue(3);
    const summary = await getEntitlementSummary("cust-1", "NONE");
    expect(summary.personalisedTrend.monthlyLimit).toBe(0);
  });
});
