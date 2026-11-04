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

const { verifyStripeSignatureMock, processStripeWebhookEventMock } = vi.hoisted(() => ({
  verifyStripeSignatureMock: vi.fn(),
  processStripeWebhookEventMock: vi.fn(),
}));

vi.mock("~/lib/billing/webhook-verify.server", () => ({
  verifyStripeSignature: verifyStripeSignatureMock,
}));

vi.mock("~/lib/billing/webhook-handler.server", () => ({
  processStripeWebhookEvent: processStripeWebhookEventMock,
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
});
