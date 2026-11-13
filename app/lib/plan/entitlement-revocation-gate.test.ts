// app/lib/plan/entitlement-revocation-gate.test.ts
//
// Exercises getCurrentSubscription's REAL internal wiring (not a DI-bypassed
// simulation) against a mocked ~/db.server, to prove the actual
// prisma.accessRevocation.findFirst check inside it — not just that
// resolveEffectiveContext correctly reacts to a null subscription, which is
// already proven generically by billing-entitlement-phase2.test.ts's PH2-13
// block ("a tracked but non-entitled Subscription row forces the
// NONE-equivalent allowance"). getCurrentSubscription itself is not exported,
// so this calls it through the one exported function that reaches it by
// default: resolveEffectiveContext, with getAddonTotals/hasAnySubscriptionRecord
// DI-overridden (so this file need not also mock those call sites' own
// prisma queries) but getSubscription deliberately left UNSET, so the real
// default — getCurrentSubscription, hitting the mocked prisma directly —
// actually runs.
//
// Run: npx vitest run app/lib/plan/entitlement-revocation-gate.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

const { subscriptionFindFirstMock, accessRevocationFindFirstMock, virtualTryOnJobCountMock } = vi.hoisted(() => ({
  subscriptionFindFirstMock: vi.fn(),
  accessRevocationFindFirstMock: vi.fn(),
  virtualTryOnJobCountMock: vi.fn(),
}));

vi.mock("~/db.server", () => ({
  default: {
    subscription: { findFirst: subscriptionFindFirstMock },
    accessRevocation: { findFirst: accessRevocationFindFirstMock },
    virtualTryOnJob: { count: virtualTryOnJobCountMock },
  },
}));

import { resolveEffectiveContext, checkEntitlement, type EffectiveContextDeps } from "./entitlement.server";

const NO_ADDONS: EffectiveContextDeps["getAddonTotals"] = async () => ({ styleMeBoost: 0, vtoBoost: 0, closetExpansion: 0 });

function activeSubRow() {
  return {
    id: "sub-1",
    planType: "MONTHLY",
    currentPeriodStart: new Date("2026-11-01T00:00:00Z"),
    currentPeriodEnd: new Date("2026-12-01T00:00:00Z"),
    status: "ACTIVE",
    pastDueSince: null,
  };
}

describe("RG — getCurrentSubscription's real AccessRevocation wiring (not DI-bypassed)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("RG.1 — an ACTIVE subscription with no AccessRevocation row grants normal allowances", async () => {
    subscriptionFindFirstMock.mockResolvedValue(activeSubRow());
    accessRevocationFindFirstMock.mockResolvedValue(null);

    const ctx = await resolveEffectiveContext("cust-1", "MEMBER", { getAddonTotals: NO_ADDONS, hasAnySubscriptionRecord: async () => true });

    expect(ctx.subscription).not.toBeNull();
    expect(ctx.allowances.styleMePerMonth).toBeGreaterThan(0);
    expect(accessRevocationFindFirstMock).toHaveBeenCalledWith({
      where: { subscriptionId: "sub-1", resolvedAt: null },
      select: { id: true },
    });
  });

  it("RG.2 — an ACTIVE subscription WITH an unresolved AccessRevocation row denies access exactly like NONE, despite status still reading ACTIVE in the stored column", async () => {
    subscriptionFindFirstMock.mockResolvedValue(activeSubRow());
    accessRevocationFindFirstMock.mockResolvedValue({ id: "rev-1" });

    const ctx = await resolveEffectiveContext("cust-1", "MEMBER", { getAddonTotals: NO_ADDONS, hasAnySubscriptionRecord: async () => true });

    expect(ctx.subscription).toBeNull();
    expect(ctx.allowances.styleMePerMonth).toBe(0);
    expect(ctx.allowances.buySkipPerMonth).toBe(0);
    expect(ctx.allowances.vtoPerMonth).toBe(0);
    expect(ctx.allowances.closetItems).toBe(0);
    expect(ctx.allowances.personalisedTrendPerMonth).toBe(0);
  });

  it("RG.3 — the revocation check is scoped to THIS subscription's id, not the customer generally", async () => {
    subscriptionFindFirstMock.mockResolvedValue(activeSubRow());
    accessRevocationFindFirstMock.mockResolvedValue(null);

    await resolveEffectiveContext("cust-1", "MEMBER", { getAddonTotals: NO_ADDONS, hasAnySubscriptionRecord: async () => true });

    const callArg = accessRevocationFindFirstMock.mock.calls[0][0];
    expect(callArg.where.subscriptionId).toBe("sub-1");
  });

  it("RG.4 — a PAST_DUE subscription within grace AND with no revocation still grants access (revocation is an independent, additional gate, not a replacement for the grace-period check)", async () => {
    subscriptionFindFirstMock.mockResolvedValue({ ...activeSubRow(), status: "PAST_DUE", pastDueSince: new Date() });
    accessRevocationFindFirstMock.mockResolvedValue(null);

    const ctx = await resolveEffectiveContext("cust-1", "MEMBER", { getAddonTotals: NO_ADDONS, hasAnySubscriptionRecord: async () => true });

    expect(ctx.subscription).not.toBeNull();
    expect(ctx.allowances.styleMePerMonth).toBeGreaterThan(0);
  });

  it("RG.5 — no Subscription row at all never even queries AccessRevocation — nothing to revoke", async () => {
    subscriptionFindFirstMock.mockResolvedValue(null);

    await resolveEffectiveContext("cust-1", "MEMBER", { getAddonTotals: NO_ADDONS, hasAnySubscriptionRecord: async () => false });

    expect(accessRevocationFindFirstMock).not.toHaveBeenCalled();
  });

  it("RG.6 — VTO (the one feature with no dedicated reserve*Slot) is denied via checkEntitlement, real end-to-end: revoked subscription -> 0 allowance -> checkEntitlement('vto') returns quota_exceeded even though the customer has used zero VTO jobs", async () => {
    subscriptionFindFirstMock.mockResolvedValue(activeSubRow());
    accessRevocationFindFirstMock.mockResolvedValue({ id: "rev-1" });
    virtualTryOnJobCountMock.mockResolvedValue(0); // zero usage — proves the denial comes from the allowance, not a usage count

    const result = await checkEntitlement("cust-1", "MEMBER", "vto", undefined, {
      getAddonTotals: NO_ADDONS,
      hasAnySubscriptionRecord: async () => true,
    });

    expect(result.allowed).toBe(false);
    expect((result as any).reason).toBe("quota_exceeded");
  });
});
