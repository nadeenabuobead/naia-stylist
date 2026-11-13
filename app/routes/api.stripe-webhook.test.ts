// app/routes/api.stripe-webhook.test.ts
// Route-behavior tests for POST /api/stripe-webhook — specifically the
// envelope the route itself owns (config presence, signature-failure
// passthrough, malformed JSON, and the livemode defense-in-depth guard
// added alongside the stripe-client.server assertTestModeKey check on the
// OUTBOUND side). Signature-verification math itself is covered by
// webhook-verify.server.test.ts; event-processing business logic is
// covered by webhook-handler.server.test.ts — this file is deliberately
// narrow to just this route's own dispatch logic. action() returns
// react-router's data() helper result directly (not a real Response) when
// called outside the router, so status/body are read via res.init?.status
// and res.data — same convention as api.billing-checkout.test.ts.
//
// Run: npx vitest run app/routes/api.stripe-webhook.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

const { verifyStripeSignatureMock, processStripeWebhookEventMock, captureFailureMock, captureErrorMock } = vi.hoisted(() => ({
  verifyStripeSignatureMock: vi.fn(),
  processStripeWebhookEventMock: vi.fn(),
  captureFailureMock: vi.fn(),
  captureErrorMock: vi.fn(),
}));

vi.mock("~/lib/billing/webhook-verify.server", () => ({
  verifyStripeSignature: verifyStripeSignatureMock,
}));

vi.mock("~/lib/billing/webhook-handler.server", () => ({
  processStripeWebhookEvent: processStripeWebhookEventMock,
}));

vi.mock("~/lib/error-tracking.server", () => ({
  captureFailure: captureFailureMock,
  captureError: captureErrorMock,
}));

import { action } from "./api.stripe-webhook";

function makeRequest(rawBody: string, signature = "t=1,v1=fake"): Request {
  return new Request("http://localhost/api/stripe-webhook", {
    method: "POST",
    body: rawBody,
    headers: { "stripe-signature": signature },
  });
}

function status(res: any): number {
  return res.init?.status ?? res.status ?? 200;
}

describe("POST /api/stripe-webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    verifyStripeSignatureMock.mockReturnValue({ ok: true });
    processStripeWebhookEventMock.mockResolvedValue({ ok: true, deduped: false, action: "noop" });
  });

  it("SW.1 — missing STRIPE_WEBHOOK_SECRET fails loudly (500, not_configured), never silently skips verification", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const res: any = await action({ request: makeRequest("{}") } as any);
    expect(status(res)).toBe(500);
    expect(res.data.code).toBe("not_configured");
    expect(processStripeWebhookEventMock).not.toHaveBeenCalled();
  });

  it("SW.2 — a bad signature is rejected (400) before any JSON parsing or processing is attempted", async () => {
    verifyStripeSignatureMock.mockReturnValue({ ok: false, reason: "signature_mismatch" });
    const res: any = await action({ request: makeRequest("not even json") } as any);
    expect(status(res)).toBe(400);
    expect(res.data.code).toBe("signature_mismatch");
    expect(processStripeWebhookEventMock).not.toHaveBeenCalled();
  });

  it("SW.3 — malformed JSON after a VALID signature is rejected (400), not passed through to processing", async () => {
    const res: any = await action({ request: makeRequest("{not valid json") } as any);
    expect(status(res)).toBe(400);
    expect(res.data.code).toBe("malformed_json");
    expect(processStripeWebhookEventMock).not.toHaveBeenCalled();
  });

  it("SW.4 — a livemode:true event is rejected (400) before processing — defense-in-depth independent of which whsec_ happens to be configured", async () => {
    const liveEvent = JSON.stringify({ id: "evt_live_1", type: "checkout.session.completed", created: 1, livemode: true, data: { object: {} } });
    const res: any = await action({ request: makeRequest(liveEvent) } as any);
    expect(status(res)).toBe(400);
    expect(res.data.code).toBe("live_mode_event_rejected");
    expect(processStripeWebhookEventMock).not.toHaveBeenCalled();
  });

  it("SW.5 — a livemode:false (genuine test-mode) event proceeds to processing normally", async () => {
    const testEvent = JSON.stringify({ id: "evt_test_1", type: "checkout.session.completed", created: 1, livemode: false, data: { object: {} } });
    const res: any = await action({ request: makeRequest(testEvent) } as any);
    expect(status(res)).toBe(200);
    expect(processStripeWebhookEventMock).toHaveBeenCalledTimes(1);
  });

  it("SW.6 — an event with no livemode field at all (older/synthetic fixtures, e.g. `stripe trigger`) is not rejected — only an explicit true is refused", async () => {
    const noFieldEvent = JSON.stringify({ id: "evt_no_field", type: "checkout.session.completed", created: 1, data: { object: {} } });
    const res: any = await action({ request: makeRequest(noFieldEvent) } as any);
    expect(status(res)).toBe(200);
    expect(processStripeWebhookEventMock).toHaveBeenCalledTimes(1);
  });

  it("SW.7 — a processing failure (ok:false) returns 500 with the reason code, so Stripe's own retry schedule gets a chance", async () => {
    processStripeWebhookEventMock.mockResolvedValue({ ok: false, reason: "authoritative_subscription_fetch_failed" });
    const testEvent = JSON.stringify({ id: "evt_test_2", type: "customer.subscription.updated", created: 1, livemode: false, data: { object: {} } });
    const res: any = await action({ request: makeRequest(testEvent) } as any);
    expect(status(res)).toBe(500);
    expect(res.data.code).toBe("authoritative_subscription_fetch_failed");
  });

  // ── Error capture (Operations Phase 1 seam) ─────────────────────────────────
  // Logging must never change the HTTP contract SW.1-SW.7 already establish
  // — same status codes, same retry semantics — and must never pass the
  // event's own payload (customer/payment detail) to the capture seam, only
  // Stripe's own opaque structural metadata plus a classified reason.

  it("SW.8 — a classified processing failure is captured via captureFailure with only eventId/eventType/reason, never the event payload", async () => {
    processStripeWebhookEventMock.mockResolvedValue({ ok: false, reason: "authoritative_subscription_fetch_failed" });
    const testEvent = JSON.stringify({
      id: "evt_test_3",
      type: "customer.subscription.updated",
      created: 1,
      livemode: false,
      data: { object: { customer: "cus_secret123", id: "sub_secret456" } },
    });
    const res: any = await action({ request: makeRequest(testEvent) } as any);

    // HTTP contract unchanged — still 500, still the same reason code, so
    // Stripe's own retry schedule behaves exactly as before this change.
    expect(status(res)).toBe(500);
    expect(res.data.code).toBe("authoritative_subscription_fetch_failed");

    expect(captureFailureMock).toHaveBeenCalledTimes(1);
    expect(captureErrorMock).not.toHaveBeenCalled();
    const [context, message, meta] = captureFailureMock.mock.calls[0];
    expect(context).toContain("stripe-webhook");
    expect(message).toBe("authoritative_subscription_fetch_failed");
    expect(meta).toEqual({ eventId: "evt_test_3", eventType: "customer.subscription.updated" });
    // The customer/subscription ids inside event.data must never reach the
    // capture call, logged or not.
    expect(JSON.stringify(meta)).not.toContain("cus_secret123");
    expect(JSON.stringify(meta)).not.toContain("sub_secret456");
  });

  it("SW.9 — an unhandled exception during processing still returns 500 processing_error (unchanged Stripe retry semantics) and is captured via captureError with only eventId/eventType, never the raw error's own data or the event payload", async () => {
    processStripeWebhookEventMock.mockRejectedValue(new Error("db unavailable: password=do-not-log-this"));
    const testEvent = JSON.stringify({
      id: "evt_test_4",
      type: "invoice.payment_failed",
      created: 1,
      livemode: false,
      data: { object: { customer_email: "customer@example.com" } },
    });
    const res: any = await action({ request: makeRequest(testEvent) } as any);

    expect(status(res)).toBe(500);
    expect(res.data.code).toBe("processing_error");

    expect(captureErrorMock).toHaveBeenCalledTimes(1);
    expect(captureFailureMock).not.toHaveBeenCalled();
    const [context, _err, meta] = captureErrorMock.mock.calls[0];
    expect(context).toContain("stripe-webhook");
    expect(meta).toEqual({ eventId: "evt_test_4", eventType: "invoice.payment_failed" });
    expect(JSON.stringify(meta)).not.toContain("customer@example.com");
  });

  it("SW.10 — a successful processing result never calls either capture function", async () => {
    const testEvent = JSON.stringify({ id: "evt_test_5", type: "checkout.session.completed", created: 1, livemode: false, data: { object: {} } });
    const res: any = await action({ request: makeRequest(testEvent) } as any);
    expect(status(res)).toBe(200);
    expect(captureFailureMock).not.toHaveBeenCalled();
    expect(captureErrorMock).not.toHaveBeenCalled();
  });
});
