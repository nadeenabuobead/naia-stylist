// app/routes/api.billing-checkout.test.ts
// Route-behavior tests for POST /api/billing-checkout — in particular the
// Phase 3 security-review fix: duplicate-subscription prevention. Mocks
// ~/db.server, ~/lib/naia-session.server, and ~/lib/billing/stripe-client.server,
// same convention as naia-identity-security.test.ts's §B route-behavior
// mocking (vi.mock + direct action() invocation, no real DB/network).
//
// Run: npx vitest run app/routes/api.billing-checkout.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

const { findFirstMock, getCurrentNaiaCustomerMock, createCheckoutSessionMock } = vi.hoisted(() => ({
  findFirstMock: vi.fn(),
  getCurrentNaiaCustomerMock: vi.fn(),
  createCheckoutSessionMock: vi.fn(),
}));

vi.mock("~/db.server", () => ({
  default: { subscription: { findFirst: findFirstMock } },
}));

vi.mock("~/lib/naia-session.server", () => ({
  getCurrentNaiaCustomer: getCurrentNaiaCustomerMock,
}));

vi.mock("~/lib/billing/stripe-client.server", () => ({
  createCheckoutSession: createCheckoutSessionMock,
  StripeNotConfiguredError: class StripeNotConfiguredError extends Error {},
  StripeLiveModeBlockedError: class StripeLiveModeBlockedError extends Error {},
}));

import { action } from "./api.billing-checkout";

const CUSTOMER = { id: "cust-1", membershipStatus: "MEMBER" };

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/billing-checkout", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("POST /api/billing-checkout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createCheckoutSessionMock.mockResolvedValue({ url: "https://checkout.stripe.com/cs_test_1" });
  });

  it("BC.1 — unauthenticated request is rejected before any DB lookup", async () => {
    getCurrentNaiaCustomerMock.mockResolvedValue(null);
    const res: any = await action({ request: makeRequest({ planType: "MONTHLY" }) } as any);
    expect(res.init?.status ?? res.status).toBe(401);
    expect(findFirstMock).not.toHaveBeenCalled();
  });

  it("BC.2 — a customer with NO existing Subscription row proceeds to create a Checkout Session", async () => {
    getCurrentNaiaCustomerMock.mockResolvedValue(CUSTOMER);
    findFirstMock.mockResolvedValue(null);
    const res: any = await action({ request: makeRequest({ planType: "MONTHLY" }) } as any);
    expect(createCheckoutSessionMock).toHaveBeenCalledOnce();
    const status = res.init?.status ?? res.status ?? 200;
    expect(status).toBe(200);
  });

  it("BC.3 — a customer with an ACTIVE Subscription is refused with 409, and NO Checkout Session is created", async () => {
    getCurrentNaiaCustomerMock.mockResolvedValue(CUSTOMER);
    findFirstMock.mockResolvedValue({ status: "ACTIVE", providerCustomerId: "cus_1" });
    const res: any = await action({ request: makeRequest({ planType: "MONTHLY" }) } as any);
    expect(res.init?.status ?? res.status).toBe(409);
    expect(createCheckoutSessionMock).not.toHaveBeenCalled();
  });

  it("BC.4 — a customer with an INCOMPLETE Subscription (checkout already in flight) is also refused — not just ACTIVE", async () => {
    getCurrentNaiaCustomerMock.mockResolvedValue(CUSTOMER);
    findFirstMock.mockResolvedValue({ status: "INCOMPLETE", providerCustomerId: null });
    const res: any = await action({ request: makeRequest({ planType: "MONTHLY" }) } as any);
    expect(res.init?.status ?? res.status).toBe(409);
    expect(createCheckoutSessionMock).not.toHaveBeenCalled();
  });

  it("BC.5 — a customer with a PAST_DUE Subscription is refused — directing them to the billing portal, not a second subscription", async () => {
    getCurrentNaiaCustomerMock.mockResolvedValue(CUSTOMER);
    findFirstMock.mockResolvedValue({ status: "PAST_DUE", providerCustomerId: "cus_1" });
    const res: any = await action({ request: makeRequest({ planType: "MONTHLY" }) } as any);
    expect(res.init?.status ?? res.status).toBe(409);
  });

  it("BC.6 — a customer whose ONLY prior subscription is CANCELED is allowed to create a new Checkout Session (resubscribing)", async () => {
    getCurrentNaiaCustomerMock.mockResolvedValue(CUSTOMER);
    findFirstMock.mockResolvedValue({ status: "CANCELED", providerCustomerId: "cus_old" });
    const res: any = await action({ request: makeRequest({ planType: "MONTHLY" }) } as any);
    expect(createCheckoutSessionMock).toHaveBeenCalledOnce();
    const status = res.init?.status ?? res.status ?? 200;
    expect(status).toBe(200);
  });

  it("BC.7 — a customer whose ONLY prior subscription is EXPIRED is also allowed to resubscribe", async () => {
    getCurrentNaiaCustomerMock.mockResolvedValue(CUSTOMER);
    findFirstMock.mockResolvedValue({ status: "EXPIRED", providerCustomerId: "cus_old" });
    const res: any = await action({ request: makeRequest({ planType: "MONTHLY" }) } as any);
    expect(createCheckoutSessionMock).toHaveBeenCalledOnce();
  });

  it("BC.8 — resubscribing after a CANCELED subscription reuses the prior providerCustomerId, rather than fragmenting billing history", async () => {
    getCurrentNaiaCustomerMock.mockResolvedValue(CUSTOMER);
    findFirstMock.mockResolvedValue({ status: "CANCELED", providerCustomerId: "cus_old_123" });
    await action({ request: makeRequest({ planType: "MONTHLY" }) } as any);
    const callArg = createCheckoutSessionMock.mock.calls[0][0];
    expect(callArg.existingProviderCustomerId).toBe("cus_old_123");
  });

  it("BC.9 — a genuinely first-time subscriber (no existing row) passes no existingProviderCustomerId", async () => {
    getCurrentNaiaCustomerMock.mockResolvedValue(CUSTOMER);
    findFirstMock.mockResolvedValue(null);
    await action({ request: makeRequest({ planType: "MONTHLY" }) } as any);
    const callArg = createCheckoutSessionMock.mock.calls[0][0];
    expect(callArg.existingProviderCustomerId).toBeNull();
  });

  it("BC.10 — an invalid planType is rejected with 400 before the duplicate-subscription check even runs", async () => {
    getCurrentNaiaCustomerMock.mockResolvedValue(CUSTOMER);
    const res: any = await action({ request: makeRequest({ planType: "WEEKLY" }) } as any);
    expect(res.init?.status ?? res.status).toBe(400);
    expect(findFirstMock).not.toHaveBeenCalled();
  });
});
