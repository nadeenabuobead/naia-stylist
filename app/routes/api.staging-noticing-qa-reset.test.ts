// app/routes/api.staging-noticing-qa-reset.test.ts
//
// TEMP STAGING QA RESET — delete alongside the route once manual QA of the
// Not Quite / Accurate feedback paths is closed.
//
// Verifies: staging gate, session scoping (no customer id/email from the
// request), exact fields cleared, state moved off REJECTED only as a
// reconcile-eligibility placeholder (never forced to CONFIRMED), and that
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

  it("GET is read-only — reports rejected tendencies without writing", async () => {
    vi.mocked(prisma.styleTendency.findMany).mockResolvedValueOnce([
      { id: "t1", dimension: "comfort", value: "comfort", generation: 1 },
    ] as any);

    const res = await loader({ request: req("GET") } as any);
    const body = (res as any).data ?? res;

    expect(prisma.styleTendency.findMany).toHaveBeenCalledWith({
      where: { customerId: "qa-cust-1", state: "REJECTED", customerFeedback: "not-quite" },
      select: { id: true, dimension: true, value: true, generation: true },
    });
    expect(prisma.styleTendency.updateMany).not.toHaveBeenCalled();
    expect(reconcileObservations).not.toHaveBeenCalled();
    expect(body.rejectedTendenciesFound).toEqual([{ dimension: "comfort", value: "comfort", generation: 1 }]);
  });

  it("scopes every query to the session's own customerId — never accepts one from the request", async () => {
    vi.mocked(prisma.styleTendency.findMany).mockResolvedValue([]);
    await loader({ request: req("GET") } as any);
    const where = vi.mocked(prisma.styleTendency.findMany).mock.calls[0][0].where;
    expect(where.customerId).toBe("qa-cust-1");
  });

  it("POST with no rejected tendencies no-ops safely — no write, no reconcile", async () => {
    vi.mocked(prisma.styleTendency.findMany).mockResolvedValueOnce([]);
    const res = await action({ request: req("POST", {}) } as any);
    const body = (res as any).data ?? res;
    expect(prisma.styleTendency.updateMany).not.toHaveBeenCalled();
    expect(reconcileObservations).not.toHaveBeenCalled();
    expect(body.tendenciesReset).toEqual([]);
    expect(body.reconciliationRun).toBe(false);
  });

  it("POST clears exactly the four feedback fields and moves state off REJECTED to a placeholder, never to CONFIRMED", async () => {
    vi.mocked(prisma.styleTendency.findMany).mockResolvedValueOnce([
      { id: "t1", dimension: "comfort", value: "comfort", generation: 1 },
      { id: "t2", dimension: "self-expression", value: "self-expression", generation: 1 },
    ] as any);
    vi.mocked(prisma.styleTendency.findMany).mockResolvedValueOnce([
      { dimension: "comfort", value: "comfort", state: "CONFIRMED", effectiveSupport: 7, wNet: 6, distinctRecords: 9 },
      { dimension: "self-expression", value: "self-expression", state: "SUPPRESSED", effectiveSupport: 0.5, wNet: 0.3, distinctRecords: 1 },
    ] as any);

    await action({ request: req("POST", {}) } as any);

    const updateCall = vi.mocked(prisma.styleTendency.updateMany).mock.calls[0][0];
    expect(updateCall.where).toEqual({ id: { in: ["t1", "t2"] } });
    expect(updateCall.data.customerFeedback).toBeNull();
    expect(updateCall.data.notQuiteReason).toBeNull();
    expect(updateCall.data.notQuiteNote).toBeNull();
    expect(updateCall.data.customerFeedbackAt).toBeNull();
    expect(updateCall.data.state).not.toBe("CONFIRMED");
    expect(updateCall.data.state).not.toBe("REJECTED");
  });

  it("POST runs reconcileObservations for exactly this customer, after the field reset", async () => {
    vi.mocked(prisma.styleTendency.findMany).mockResolvedValueOnce([
      { id: "t1", dimension: "comfort", value: "comfort", generation: 1 },
    ] as any);
    vi.mocked(prisma.styleTendency.findMany).mockResolvedValueOnce([]);

    await action({ request: req("POST", {}) } as any);

    expect(reconcileObservations).toHaveBeenCalledWith("qa-cust-1");
    expect(reconcileObservations).toHaveBeenCalledTimes(1);
    const updateOrder = vi.mocked(prisma.styleTendency.updateMany).mock.invocationCallOrder[0];
    const reconcileOrder = vi.mocked(reconcileObservations).mock.invocationCallOrder[0];
    expect(updateOrder).toBeLessThan(reconcileOrder);
  });

  it("POST returns the resulting states as computed by reconcile, not a hard-coded value", async () => {
    vi.mocked(prisma.styleTendency.findMany).mockResolvedValueOnce([
      { id: "t1", dimension: "comfort", value: "comfort", generation: 1 },
    ] as any);
    vi.mocked(prisma.styleTendency.findMany).mockResolvedValueOnce([
      { dimension: "comfort", value: "comfort", state: "CONFIRMED", effectiveSupport: 7.04, wNet: 7.04, distinctRecords: 9 },
    ] as any);

    const res = await action({ request: req("POST", {}) } as any);
    const body = (res as any).data ?? res;
    expect(body.resultingStates).toEqual([
      { dimension: "comfort", value: "comfort", state: "CONFIRMED", effectiveSupport: 7.04, wNet: 7.04, distinctRecords: 9 },
    ]);
  });

  it("only POST performs the action — other methods are rejected", async () => {
    const res = await action({ request: req("GET") } as any);
    expect((res as any).init?.status ?? (res as Response).status).toBe(405);
    expect(prisma.styleTendency.updateMany).not.toHaveBeenCalled();
  });
});
