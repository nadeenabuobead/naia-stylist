// app/routes/api.staging-noticing-qa-reset.test.ts
//
// TEMP STAGING QA RESET — delete alongside the route once manual QA of the
// Not Quite / Accurate feedback paths is closed.
//
// Verifies: staging gate, session scoping (no customer id/email from the
// request), both not-quite and accurate rows are found and reset, exact
// fields cleared for both, state moved off REJECTED only for rows that
// were actually REJECTED (never forced to CONFIRMED) while an "accurate"
// row's state is left completely untouched, and that
// reconcileObservations is the thing actually computing the final state.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("~/lib/naia-session.server", () => ({
  requireCurrentNaiaCustomer: vi.fn(),
}));

vi.mock("~/db.server", () => ({
  default: {
    styleTendency: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

vi.mock("~/lib/ai/taste-reconcile.server", () => ({
  reconcileObservations: vi.fn(),
}));

import { requireCurrentNaiaCustomer } from "~/lib/naia-session.server";
import prisma from "~/db.server";
import { reconcileObservations } from "~/lib/ai/taste-reconcile.server";
import { loader, action } from "./api.staging-noticing-qa-reset";

const ORIGINAL_VARIANT = process.env.NAIA_PROJECT_VARIANT;

function req(method: string, body?: unknown) {
  return new Request("http://localhost/api/staging-noticing-qa-reset", {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

describe("api.staging-noticing-qa-reset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NAIA_PROJECT_VARIANT = "staging";
    vi.mocked(requireCurrentNaiaCustomer).mockResolvedValue({ id: "qa-cust-1" } as any);
  });

  afterEach(() => {
    process.env.NAIA_PROJECT_VARIANT = ORIGINAL_VARIANT;
  });

  it("404s outside staging, before auth, before any DB call", async () => {
    process.env.NAIA_PROJECT_VARIANT = "production";
    const res = await loader({ request: req("GET") } as any);
    expect((res as Response).status).toBe(404);
    expect(requireCurrentNaiaCustomer).not.toHaveBeenCalled();
    expect(prisma.styleTendency.findMany).not.toHaveBeenCalled();
  });

  it("GET is read-only — finds both not-quite and accurate rows, reports them, writes nothing", async () => {
    vi.mocked(prisma.styleTendency.findMany).mockResolvedValueOnce([
      { id: "t1", dimension: "comfort", value: "comfort", generation: 1, state: "REJECTED", customerFeedback: "not-quite" },
      { id: "t2", dimension: "self-expression", value: "self-expression", generation: 1, state: "CONFIRMED", customerFeedback: "accurate" },
    ] as any);

    const res = await loader({ request: req("GET") } as any);
    const body = (res as any).data ?? res;

    expect(prisma.styleTendency.findMany).toHaveBeenCalledWith({
      where: { customerId: "qa-cust-1", customerFeedback: { in: ["not-quite", "accurate"] } },
      select: { id: true, dimension: true, value: true, generation: true, state: true, customerFeedback: true },
    });
    expect(prisma.styleTendency.updateMany).not.toHaveBeenCalled();
    expect(reconcileObservations).not.toHaveBeenCalled();
    expect(body.tendenciesFound).toEqual([
      { dimension: "comfort", value: "comfort", generation: 1, state: "REJECTED", customerFeedback: "not-quite" },
      { dimension: "self-expression", value: "self-expression", generation: 1, state: "CONFIRMED", customerFeedback: "accurate" },
    ]);
  });

  it("scopes every query to the session's own customerId — never accepts one from the request", async () => {
    vi.mocked(prisma.styleTendency.findMany).mockResolvedValue([]);
    await loader({ request: req("GET") } as any);
    const where = vi.mocked(prisma.styleTendency.findMany).mock.calls[0][0].where;
    expect(where.customerId).toBe("qa-cust-1");
  });

  it("POST with no not-quite/accurate tendencies no-ops safely — no write, no reconcile", async () => {
    vi.mocked(prisma.styleTendency.findMany).mockResolvedValueOnce([]);
    const res = await action({ request: req("POST", {}) } as any);
    const body = (res as any).data ?? res;
    expect(prisma.styleTendency.updateMany).not.toHaveBeenCalled();
    expect(reconcileObservations).not.toHaveBeenCalled();
    expect(body.tendenciesReset).toEqual([]);
    expect(body.reconciliationRun).toBe(false);
  });

  it("POST on a REJECTED/not-quite row clears the four feedback fields and moves state off REJECTED to a placeholder, never to CONFIRMED", async () => {
    vi.mocked(prisma.styleTendency.findMany).mockResolvedValueOnce([
      { id: "t1", dimension: "comfort", value: "comfort", generation: 1, state: "REJECTED", customerFeedback: "not-quite" },
    ] as any);
    vi.mocked(prisma.styleTendency.findMany).mockResolvedValueOnce([
      { dimension: "comfort", value: "comfort", state: "CONFIRMED", effectiveSupport: 7, wNet: 6, distinctRecords: 9 },
    ] as any);

    await action({ request: req("POST", {}) } as any);

    const updateCall = vi.mocked(prisma.styleTendency.updateMany).mock.calls[0][0];
    expect(updateCall.where).toEqual({ id: { in: ["t1"] } });
    expect(updateCall.data.customerFeedback).toBeNull();
    expect(updateCall.data.notQuiteReason).toBeNull();
    expect(updateCall.data.notQuiteNote).toBeNull();
    expect(updateCall.data.customerFeedbackAt).toBeNull();
    expect(updateCall.data.state).not.toBe("CONFIRMED");
    expect(updateCall.data.state).not.toBe("REJECTED");
  });

  // REGRESSION — the staging QA report that prompted this extension: a
  // row with customerFeedback="accurate" (never REJECTED — an Accurate
  // submission never changes `state` at all) was not being reset by the
  // original not-quite-only version, so a card kept showing "Glad this
  // resonates." after reset even though the tester never clicked Accurate
  // in the new round.
  it("POST on an 'accurate' (non-REJECTED) row clears the same four feedback fields but leaves state completely untouched", async () => {
    vi.mocked(prisma.styleTendency.findMany).mockResolvedValueOnce([
      { id: "t2", dimension: "self-expression", value: "self-expression", generation: 1, state: "CONFIRMED", customerFeedback: "accurate" },
    ] as any);
    vi.mocked(prisma.styleTendency.findMany).mockResolvedValueOnce([
      { dimension: "self-expression", value: "self-expression", state: "CONFIRMED", effectiveSupport: 5.44, wNet: 5.44, distinctRecords: 7 },
    ] as any);

    await action({ request: req("POST", {}) } as any);

    const updateCall = vi.mocked(prisma.styleTendency.updateMany).mock.calls[0][0];
    expect(updateCall.where).toEqual({ id: { in: ["t2"] } });
    expect(updateCall.data.customerFeedback).toBeNull();
    expect(updateCall.data.notQuiteReason).toBeNull();
    expect(updateCall.data.notQuiteNote).toBeNull();
    expect(updateCall.data.customerFeedbackAt).toBeNull();
    // The defining difference from the REJECTED path: no `state` key at
    // all is sent for an accurate-only reset.
    expect(updateCall.data).not.toHaveProperty("state");
  });

  it("POST with BOTH a REJECTED/not-quite row and an accurate row issues two separate updateMany calls with the right state handling for each", async () => {
    vi.mocked(prisma.styleTendency.findMany).mockResolvedValueOnce([
      { id: "t1", dimension: "comfort", value: "comfort", generation: 1, state: "REJECTED", customerFeedback: "not-quite" },
      { id: "t2", dimension: "self-expression", value: "self-expression", generation: 1, state: "CONFIRMED", customerFeedback: "accurate" },
    ] as any);
    vi.mocked(prisma.styleTendency.findMany).mockResolvedValueOnce([
      { dimension: "comfort", value: "comfort", state: "CONFIRMED", effectiveSupport: 7, wNet: 6, distinctRecords: 9 },
      { dimension: "self-expression", value: "self-expression", state: "CONFIRMED", effectiveSupport: 5.44, wNet: 5.44, distinctRecords: 7 },
    ] as any);

    await action({ request: req("POST", {}) } as any);

    expect(prisma.styleTendency.updateMany).toHaveBeenCalledTimes(2);
    const calls = vi.mocked(prisma.styleTendency.updateMany).mock.calls;
    const rejectedCall = calls.find(c => (c[0].where.id.in as string[]).includes("t1"));
    const accurateCall = calls.find(c => (c[0].where.id.in as string[]).includes("t2"));
    expect(rejectedCall?.[0].data).toHaveProperty("state");
    expect(accurateCall?.[0].data).not.toHaveProperty("state");
  });

  it("POST runs reconcileObservations for exactly this customer, after the field reset", async () => {
    vi.mocked(prisma.styleTendency.findMany).mockResolvedValueOnce([
      { id: "t1", dimension: "comfort", value: "comfort", generation: 1, state: "REJECTED", customerFeedback: "not-quite" },
    ] as any);
    vi.mocked(prisma.styleTendency.findMany).mockResolvedValueOnce([]);

    await action({ request: req("POST", {}) } as any);

    expect(reconcileObservations).toHaveBeenCalledWith("qa-cust-1");
    expect(reconcileObservations).toHaveBeenCalledTimes(1);
    const updateOrder = vi.mocked(prisma.styleTendency.updateMany).mock.invocationCallOrder[0];
    const reconcileOrder = vi.mocked(reconcileObservations).mock.invocationCallOrder[0];
    expect(updateOrder).toBeLessThan(reconcileOrder);
  });

  it("POST returns the resulting states as computed by reconcile, not a hard-coded value, including which feedback each row previously had", async () => {
    vi.mocked(prisma.styleTendency.findMany).mockResolvedValueOnce([
      { id: "t2", dimension: "self-expression", value: "self-expression", generation: 1, state: "CONFIRMED", customerFeedback: "accurate" },
    ] as any);
    vi.mocked(prisma.styleTendency.findMany).mockResolvedValueOnce([
      { dimension: "self-expression", value: "self-expression", state: "CONFIRMED", effectiveSupport: 5.44, wNet: 5.44, distinctRecords: 7 },
    ] as any);

    const res = await action({ request: req("POST", {}) } as any);
    const body = (res as any).data ?? res;
    expect(body.resultingStates).toEqual([
      { dimension: "self-expression", value: "self-expression", state: "CONFIRMED", effectiveSupport: 5.44, wNet: 5.44, distinctRecords: 7 },
    ]);
    expect(body.tendenciesReset).toEqual([
      { dimension: "self-expression", value: "self-expression", previousFeedback: "accurate" },
    ]);
  });

  it("only POST performs the action — other methods are rejected", async () => {
    const res = await action({ request: req("GET") } as any);
    expect((res as any).init?.status ?? (res as Response).status).toBe(405);
    expect(prisma.styleTendency.updateMany).not.toHaveBeenCalled();
  });
});
