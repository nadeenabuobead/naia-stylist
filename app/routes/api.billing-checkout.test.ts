// app/routes/api.billing-checkout.test.ts
// Route-behavior tests for POST /api/billing-checkout — in particular the
// Phase 3 security-review fix: duplicate-subscription prevention. Mocks
// ~/db.server, ~/lib/naia-session.server, and ~/lib/billing/stripe-client.server,
// same convention as naia-identity-security.test.ts's §B route-behavior
// mocking (vi.mock + direct action() invocation, no real DB/network).
//
// Run: npx vitest run app/routes/api.billing-checkout.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  findFirstMock,
  getCurrentNaiaCustomerMock,
  createCheckoutSessionMock,
  reserveCheckoutAttemptMock,
  releaseCheckoutReservationMock,
  attachCheckoutSessionIdMock,
} = vi.hoisted(() => ({
  findFirstMock: vi.fn(),
  getCurrentNaiaCustomerMock: vi.fn(),
  createCheckoutSessionMock: vi.fn(),
  reserveCheckoutAttemptMock: vi.fn(),
  releaseCheckoutReservationMock: vi.fn(),
  attachCheckoutSessionIdMock: vi.fn(),
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

// Concurrent-checkout protection (fix/stripe-clerk-phase1-security) — its
// own unit coverage lives in checkout-reservation.test.ts; mocked here so
// this file's existing Subscription-based (Layer 1) tests aren't coupled to
// Layer 2's internals, and so Layer 2 itself can be tested in isolation below.
vi.mock("~/lib/billing/checkout-reservation.server", () => ({
  reserveCheckoutAttempt: reserveCheckoutAttemptMock,
  releaseCheckoutReservation: releaseCheckoutReservationMock,
  attachCheckoutSessionId: attachCheckoutSessionIdMock,
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
    createCheckoutSessionMock.mockResolvedValue({ id: "cs_test_1", url: "https://checkout.stripe.com/cs_test_1" });
    reserveCheckoutAttemptMock.mockResolvedValue({ allowed: true, expiresAt: new Date("2026-11-12T13:00:00.000Z") });
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

// Layer 2 — reserveCheckoutAttempt (checkout-reservation.server.ts). Closes
// the race Layer 1 (the Subscription-row check above) cannot: two requests
// BEFORE any Subscription row exists. See the module header's own comment
// and checkout-reservation.test.ts for Layer 2's own unit-level coverage.
describe("POST /api/billing-checkout — concurrent-checkout protection (Layer 2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentNaiaCustomerMock.mockResolvedValue(CUSTOMER);
    findFirstMock.mockResolvedValue(null);
    createCheckoutSessionMock.mockResolvedValue({ id: "cs_test_1", url: "https://checkout.stripe.com/cs_test_1" });
  });

  it("BC.11 — reserveCheckoutAttempt is called with the resolved customer and plan type, BEFORE createCheckoutSession", async () => {
    reserveCheckoutAttemptMock.mockResolvedValue({ allowed: true, expiresAt: new Date("2026-11-12T13:00:00.000Z") });
    await action({ request: makeRequest({ planType: "MONTHLY" }) } as any);
    expect(reserveCheckoutAttemptMock).toHaveBeenCalledWith(CUSTOMER.id, "MONTHLY");
    const reserveOrder = reserveCheckoutAttemptMock.mock.invocationCallOrder[0];
    const createOrder = createCheckoutSessionMock.mock.invocationCallOrder[0];
    expect(reserveOrder).toBeLessThan(createOrder);
  });

  it("BC.12 — a pending reservation refuses with 409 checkout_already_pending, and NO Checkout Session is created", async () => {
    reserveCheckoutAttemptMock.mockResolvedValue({ allowed: false, reason: "checkout_already_pending" });
    const res: any = await action({ request: makeRequest({ planType: "MONTHLY" }) } as any);
    expect(res.init?.status ?? res.status).toBe(409);
    expect(createCheckoutSessionMock).not.toHaveBeenCalled();
  });

  it("BC.13 — this is a DISTINCT 409 from subscription_already_exists — a customer with no Subscription row yet can still be blocked by a pending reservation", async () => {
    // findFirstMock already resolves null in this describe's beforeEach —
    // Layer 1 alone would let this through; Layer 2 is what blocks it here.
    reserveCheckoutAttemptMock.mockResolvedValue({ allowed: false, reason: "checkout_already_pending" });
    const res: any = await action({ request: makeRequest({ planType: "MONTHLY" }) } as any);
    expect(res.init?.status ?? res.status).toBe(409);
  });

  it("BC.14 — the reservation's expiresAt is passed through to createCheckoutSession as a Unix-seconds timestamp, so Stripe's own session expiry matches", async () => {
    const expiresAt = new Date("2026-11-12T13:30:00.000Z");
    reserveCheckoutAttemptMock.mockResolvedValue({ allowed: true, expiresAt });
    await action({ request: makeRequest({ planType: "MONTHLY" }) } as any);
    const callArg = createCheckoutSessionMock.mock.calls[0][0];
    expect(callArg.expiresAtUnixSeconds).toBe(Math.floor(expiresAt.getTime() / 1000));
  });

  it("BC.15 — if createCheckoutSession succeeds, the reservation is tagged with the Stripe session id for observability", async () => {
    reserveCheckoutAttemptMock.mockResolvedValue({ allowed: true, expiresAt: new Date("2026-11-12T13:00:00.000Z") });
    createCheckoutSessionMock.mockResolvedValue({ id: "cs_real_session_1", url: "https://checkout.stripe.com/cs_real_session_1" });
    await action({ request: makeRequest({ planType: "MONTHLY" }) } as any);
    expect(attachCheckoutSessionIdMock).toHaveBeenCalledWith(CUSTOMER.id, "cs_real_session_1");
  });

  it("BC.16 — if the Stripe API call itself fails, the reservation is released so the customer doesn't wait out the full TTL to retry", async () => {
    reserveCheckoutAttemptMock.mockResolvedValue({ allowed: true, expiresAt: new Date("2026-11-12T13:00:00.000Z") });
    createCheckoutSessionMock.mockRejectedValue(new Error("network error"));
    await action({ request: makeRequest({ planType: "MONTHLY" }) } as any);
    expect(releaseCheckoutReservationMock).toHaveBeenCalledWith(CUSTOMER.id);
  });

  it("BC.17 — a successful checkout does NOT release the reservation itself — that only happens from the webhook, once the attempt's real outcome is known", async () => {
    reserveCheckoutAttemptMock.mockResolvedValue({ allowed: true, expiresAt: new Date("2026-11-12T13:00:00.000Z") });
    await action({ request: makeRequest({ planType: "MONTHLY" }) } as any);
    expect(releaseCheckoutReservationMock).not.toHaveBeenCalled();
  });
});
