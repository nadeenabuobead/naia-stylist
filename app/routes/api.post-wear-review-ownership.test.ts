// app/routes/api.post-wear-review-ownership.test.ts
//
// Regression coverage for how api.post-wear-review.tsx's action surfaces the
// FORBIDDEN outcome from upsertPostWearReview (hotfixed 2026-11-12): a
// cross-customer ownership mismatch must map to 404 (not 500, and not
// silently succeed), matching this route's own delete branch and the rest
// of the codebase's not-found-not-403 convention. The underlying ownership
// logic itself is covered directly in feedback-persistence-ownership.test.ts;
// this file covers the route's own responsibility — translating that
// outcome into the right HTTP response — plus the pre-existing
// unauthenticated and legitimate-owner paths for completeness.
//
// Run: npx vitest run app/routes/api.post-wear-review-ownership.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

const { getCurrentNaiaCustomer, upsertPostWearReview } = vi.hoisted(() => ({
  getCurrentNaiaCustomer: vi.fn(),
  upsertPostWearReview: vi.fn(),
}));

vi.mock("~/lib/naia-session.server", () => ({ getCurrentNaiaCustomer }));
vi.mock("~/lib/ai/feedback-persistence.server", () => ({
  upsertPostWearReview,
  loadPostWearReview: vi.fn(),
  deletePostWearReview: vi.fn(),
}));
vi.mock("~/lib/ai/journey-events.server", () => ({
  emitPostWearSubmitted: vi.fn(() => ({ ok: true })),
  recordJourneyEvent: vi.fn(),
}));

import { action } from "./api.post-wear-review";

function makeRequest(body: object) {
  return {
    request: new Request("https://example.com/api/post-wear-review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  } as any;
}

const SUBMIT_BODY = { _intent: "submit", sessionId: "shared-session-id", didWearIt: "yes" };

beforeEach(() => vi.clearAllMocks());

describe("api.post-wear-review action — ownership outcome mapping", () => {
  it("unauthenticated requests are rejected before any ownership check runs", async () => {
    getCurrentNaiaCustomer.mockResolvedValueOnce(null);

    const res = (await action(makeRequest(SUBMIT_BODY))) as any;

    expect(res.init.status).toBe(401);
    expect(upsertPostWearReview).not.toHaveBeenCalled();
  });

  it("a cross-customer ownership mismatch (FORBIDDEN) maps to 404, not 500", async () => {
    getCurrentNaiaCustomer.mockResolvedValueOnce({ id: "customer-A" });
    upsertPostWearReview.mockResolvedValueOnce({ ok: false, errorCode: "FORBIDDEN" });

    const res = (await action(makeRequest(SUBMIT_BODY))) as any;

    expect(res.init.status).toBe(404);
  });

  it("the legitimate owner's submission still succeeds", async () => {
    getCurrentNaiaCustomer.mockResolvedValueOnce({ id: "customer-A" });
    upsertPostWearReview.mockResolvedValueOnce({ ok: true });

    const res = (await action(makeRequest(SUBMIT_BODY))) as any;

    // No explicit status set (init is null) means the real response
    // pipeline would send the implicit 200 — same shape as every other
    // non-error data() call in this route.
    expect(res.init).toBeNull();
    expect(res.data).toEqual({ ok: true });
    expect(upsertPostWearReview).toHaveBeenCalledWith(
      "shared-session-id",
      "customer-A",
      expect.any(Object),
    );
  });

  it("a non-FORBIDDEN failure still maps to 500, not 404", async () => {
    getCurrentNaiaCustomer.mockResolvedValueOnce({ id: "customer-A" });
    upsertPostWearReview.mockResolvedValueOnce({ ok: false, errorCode: "unexpected" });

    const res = (await action(makeRequest(SUBMIT_BODY))) as any;

    expect(res.init.status).toBe(500);
  });
});
