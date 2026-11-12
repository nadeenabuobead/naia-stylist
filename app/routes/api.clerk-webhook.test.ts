// app/routes/api.clerk-webhook.test.ts
// Route-behavior tests for POST /api/clerk-webhook
// (fix/stripe-clerk-phase1-security, 2026-11-12) — signature-failure
// passthrough, malformed JSON, idempotency, and the user.deleted →
// eraseCustomerData dispatch, including cross-customer isolation. Svix
// signature-verification math itself is covered separately by
// clerk-webhook-verify.test.ts — this file is deliberately narrow to the
// route's own dispatch logic, same convention as api.stripe-webhook.test.ts.
//
// Run: npx vitest run app/routes/api.clerk-webhook.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  verifyClerkWebhookSignatureMock,
  eraseCustomerDataMock,
  findUniqueCustomerMock,
  findUniqueEventMock,
  createEventMock,
} = vi.hoisted(() => ({
  verifyClerkWebhookSignatureMock: vi.fn(),
  eraseCustomerDataMock: vi.fn(),
  findUniqueCustomerMock: vi.fn(),
  findUniqueEventMock: vi.fn(),
  createEventMock: vi.fn(),
}));

vi.mock("~/lib/clerk-webhook-verify.server", () => ({
  verifyClerkWebhookSignature: verifyClerkWebhookSignatureMock,
}));

vi.mock("~/lib/customer-privacy.server", () => ({
  eraseCustomerData: eraseCustomerDataMock,
}));

vi.mock("~/db.server", () => ({
  default: {
    customer: { findUnique: findUniqueCustomerMock },
    processedWebhookEvent: { findUnique: findUniqueEventMock, create: createEventMock },
  },
}));

import { action } from "./api.clerk-webhook";

function makeRequest(rawBody: string, svixId = "msg_test_1"): Request {
  return new Request("http://localhost/api/clerk-webhook", {
    method: "POST",
    body: rawBody,
    headers: {
      "svix-id": svixId,
      "svix-timestamp": "1700000000",
      "svix-signature": "v1,fakesignature",
    },
  });
}

function status(res: any): number {
  return res.init?.status ?? res.status ?? 200;
}

function userDeletedEvent(clerkUserId: string) {
  return JSON.stringify({ type: "user.deleted", data: { id: clerkUserId, object: "user", deleted: true } });
}

describe("POST /api/clerk-webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CLERK_WEBHOOK_SECRET = "whsec_test";
    verifyClerkWebhookSignatureMock.mockReturnValue({ ok: true });
    findUniqueEventMock.mockResolvedValue(null);
    createEventMock.mockResolvedValue({});
    eraseCustomerDataMock.mockResolvedValue({ ok: true, alreadyErased: false, anonymized: false, cloudinaryFailures: [], journeyEventsPurged: 0 });
  });

  it("CW.1 — missing CLERK_WEBHOOK_SECRET fails loudly (500, not_configured), never silently skips verification", async () => {
    delete process.env.CLERK_WEBHOOK_SECRET;
    const res: any = await action({ request: makeRequest("{}") } as any);
    expect(status(res)).toBe(500);
    expect(res.data.code).toBe("not_configured");
    expect(verifyClerkWebhookSignatureMock).not.toHaveBeenCalled();
  });

  it("CW.2 — a bad signature is rejected (400) before any JSON parsing or processing", async () => {
    verifyClerkWebhookSignatureMock.mockReturnValue({ ok: false, reason: "signature_mismatch" });
    const res: any = await action({ request: makeRequest("not even json") } as any);
    expect(status(res)).toBe(400);
    expect(res.data.code).toBe("signature_mismatch");
    expect(eraseCustomerDataMock).not.toHaveBeenCalled();
  });

  it("CW.3 — malformed JSON after a VALID signature is rejected (400), not passed through to processing", async () => {
    const res: any = await action({ request: makeRequest("{not valid json") } as any);
    expect(status(res)).toBe(400);
    expect(res.data.code).toBe("malformed_json");
    expect(eraseCustomerDataMock).not.toHaveBeenCalled();
  });

  it("CW.4 — a redelivered event (already in the ProcessedWebhookEvent ledger) is deduped — never reprocessed", async () => {
    findUniqueEventMock.mockResolvedValue({ id: "already-processed" });
    const res: any = await action({ request: makeRequest(userDeletedEvent("user_abc")) } as any);
    expect(res.data).toEqual({ ok: true, deduped: true });
    expect(eraseCustomerDataMock).not.toHaveBeenCalled();
    expect(createEventMock).not.toHaveBeenCalled();
  });

  it("CW.5 — user.deleted for a Clerk id with a matching Customer row erases that customer via eraseCustomerData", async () => {
    findUniqueCustomerMock.mockResolvedValue({ id: "cust-internal-1" });
    await action({ request: makeRequest(userDeletedEvent("user_abc")) } as any);
    expect(findUniqueCustomerMock).toHaveBeenCalledWith({ where: { clerkUserId: "user_abc" }, select: { id: true } });
    expect(eraseCustomerDataMock).toHaveBeenCalledWith("cust-internal-1", {}, "clerk-webhook-user-deleted");
  });

  it("CW.6 — user.deleted for a Clerk id with NO matching Customer row is a safe no-op — not an error, still recorded", async () => {
    findUniqueCustomerMock.mockResolvedValue(null);
    const res: any = await action({ request: makeRequest(userDeletedEvent("user_never_linked")) } as any);
    expect(eraseCustomerDataMock).not.toHaveBeenCalled();
    expect(status(res)).toBe(200);
    expect(createEventMock).toHaveBeenCalledTimes(1);
  });

  it("CW.7 — CUSTOMER ISOLATION: deleting one Clerk user's account only ever looks up and erases THAT customer, never another", async () => {
    findUniqueCustomerMock.mockResolvedValue({ id: "cust-A" });
    await action({ request: makeRequest(userDeletedEvent("user_A"), "msg_A") } as any);
    expect(findUniqueCustomerMock).toHaveBeenCalledWith({ where: { clerkUserId: "user_A" }, select: { id: true } });
    expect(eraseCustomerDataMock).toHaveBeenCalledWith("cust-A", {}, "clerk-webhook-user-deleted");
    expect(eraseCustomerDataMock).not.toHaveBeenCalledWith("cust-B", expect.anything(), expect.anything());

    vi.clearAllMocks();
    verifyClerkWebhookSignatureMock.mockReturnValue({ ok: true });
    findUniqueEventMock.mockResolvedValue(null);
    createEventMock.mockResolvedValue({});
    findUniqueCustomerMock.mockResolvedValue({ id: "cust-B" });

    await action({ request: makeRequest(userDeletedEvent("user_B"), "msg_B") } as any);
    expect(findUniqueCustomerMock).toHaveBeenCalledWith({ where: { clerkUserId: "user_B" }, select: { id: true } });
    expect(eraseCustomerDataMock).toHaveBeenCalledWith("cust-B", {}, "clerk-webhook-user-deleted");
    expect(eraseCustomerDataMock).not.toHaveBeenCalledWith("cust-A", expect.anything(), expect.anything());
  });

  it("CW.8 — an unhandled event type (e.g. user.updated) is ignored — never calls eraseCustomerData — but is still recorded for idempotency", async () => {
    const event = JSON.stringify({ type: "user.updated", data: { id: "user_abc" } });
    const res: any = await action({ request: makeRequest(event) } as any);
    expect(eraseCustomerDataMock).not.toHaveBeenCalled();
    expect(status(res)).toBe(200);
    expect(createEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ provider: "clerk", eventType: "user.updated" }) }),
    );
  });

  it("CW.9 — the customerId recorded on the processed-event ledger is OUR internal Customer.id, not Clerk's own user id", async () => {
    findUniqueCustomerMock.mockResolvedValue({ id: "cust-internal-1" });
    await action({ request: makeRequest(userDeletedEvent("user_abc")) } as any);
    const createArg = createEventMock.mock.calls[0][0];
    expect(createArg.data.customerId).toBe("cust-internal-1");
    expect(createArg.data.customerId).not.toBe("user_abc");
  });

  it("CW.10 — a genuine processing failure (e.g. eraseCustomerData throws) returns 500, not a silently-swallowed success", async () => {
    findUniqueCustomerMock.mockResolvedValue({ id: "cust-internal-1" });
    eraseCustomerDataMock.mockRejectedValue(new Error("db unreachable"));
    const res: any = await action({ request: makeRequest(userDeletedEvent("user_abc")) } as any);
    expect(status(res)).toBe(500);
    expect(res.data.code).toBe("processing_error");
  });

  it("CW.11 — a successfully processed event is recorded in the ledger exactly once, with the correct providerEventId (the svix-id header)", async () => {
    findUniqueCustomerMock.mockResolvedValue({ id: "cust-internal-1" });
    await action({ request: makeRequest(userDeletedEvent("user_abc"), "msg_unique_42") } as any);
    expect(createEventMock).toHaveBeenCalledTimes(1);
    expect(createEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ provider: "clerk", providerEventId: "msg_unique_42" }) }),
    );
  });
});
