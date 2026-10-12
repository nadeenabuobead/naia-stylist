// app/routes/api.taste-observation-feedback.test.ts
//
// V1 Passport Noticing UX — inline "What feels off?" form. Validates that
// the route correctly passes through (or rejects) notQuiteReason/
// notQuiteNote, on top of the pre-existing accurate/not-quite contract.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/naia-session.server", () => ({
  getCurrentNaiaCustomer: vi.fn(),
}));

vi.mock("~/lib/ai/taste-reconcile.server", () => ({
  applyTasteObservationFeedback: vi.fn(),
}));

import { getCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { applyTasteObservationFeedback } from "~/lib/ai/taste-reconcile.server";
import { action } from "./api.taste-observation-feedback";

function postRequest(body: unknown) {
  return new Request("http://localhost/api/taste-observation-feedback", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("api.taste-observation-feedback action — notQuiteReason/notQuiteNote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrentNaiaCustomer).mockResolvedValue({ id: "cust-1" } as any);
    vi.mocked(applyTasteObservationFeedback).mockResolvedValue({ ok: true });
  });

  it("a valid reason + note are passed through for not-quite", async () => {
    await action({
      request: postRequest({ tendencyId: "t1", feedback: "not-quite", notQuiteReason: "doesnt-feel-like-me", notQuiteNote: "a comment" }),
    } as any);
    expect(applyTasteObservationFeedback).toHaveBeenCalledWith(
      "cust-1", "t1", "not-quite", { reason: "doesnt-feel-like-me", note: "a comment" },
    );
  });

  it("Skip Details — not-quite with no reason/note passes nulls through, unchanged from the pre-feature contract", async () => {
    await action({ request: postRequest({ tendencyId: "t1", feedback: "not-quite" }) } as any);
    expect(applyTasteObservationFeedback).toHaveBeenCalledWith("cust-1", "t1", "not-quite", { reason: null, note: null });
  });

  it("an unrecognized reason string is dropped (treated as no reason), never trusted as-is", async () => {
    await action({
      request: postRequest({ tendencyId: "t1", feedback: "not-quite", notQuiteReason: "totally-made-up" }),
    } as any);
    expect(applyTasteObservationFeedback).toHaveBeenCalledWith("cust-1", "t1", "not-quite", { reason: null, note: null });
  });

  it("reason/note on an 'accurate' submission are silently ignored, not an error", async () => {
    await action({
      request: postRequest({ tendencyId: "t1", feedback: "accurate", notQuiteReason: "doesnt-feel-like-me", notQuiteNote: "irrelevant" }),
    } as any);
    expect(applyTasteObservationFeedback).toHaveBeenCalledWith("cust-1", "t1", "accurate", { reason: null, note: null });
  });

  it("still 400s when feedback is missing/invalid — existing contract unchanged", async () => {
    const res = await action({ request: postRequest({ tendencyId: "t1", feedback: "sort-of" }) } as any);
    expect((res as any).init?.status).toBe(400);
    expect(applyTasteObservationFeedback).not.toHaveBeenCalled();
  });

  it("still 401s when unauthenticated — existing contract unchanged", async () => {
    vi.mocked(getCurrentNaiaCustomer).mockResolvedValueOnce(null as any);
    const res = await action({ request: postRequest({ tendencyId: "t1", feedback: "not-quite" }) } as any);
    expect((res as any).init?.status).toBe(401);
  });

  // QA BUG fix — the success response now echoes back which feedback value
  // was actually persisted, so the client can treat fetcher.data (durable
  // across the fetcher's idle transition) as proof, instead of fetcher.json
  // (cleared once idle) or the submitted request payload.
  it("a successful 'accurate' submission's response includes feedback: 'accurate'", async () => {
    const res = await action({ request: postRequest({ tendencyId: "t1", feedback: "accurate" }) } as any);
    const body = (res as any).data ?? res;
    expect(body).toEqual({ ok: true, feedback: "accurate" });
  });

  it("a successful 'not-quite' submission's response includes feedback: 'not-quite', regardless of detail fields", async () => {
    const res = await action({
      request: postRequest({ tendencyId: "t1", feedback: "not-quite", notQuiteReason: "only-sometimes", notQuiteNote: "x" }),
    } as any);
    const body = (res as any).data ?? res;
    expect(body).toEqual({ ok: true, feedback: "not-quite" });
  });

  it("a failed submission's response never includes a feedback value", async () => {
    vi.mocked(applyTasteObservationFeedback).mockResolvedValueOnce({ ok: false, errorCode: "ALREADY_REJECTED" });
    const res = await action({ request: postRequest({ tendencyId: "t1", feedback: "not-quite" }) } as any);
    const body = (res as any).data ?? res;
    expect(body.feedback).toBeUndefined();
    expect(body.ok).toBeUndefined();
  });
});
