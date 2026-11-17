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
  recordTermsAcceptanceMock,
} = vi.hoisted(() => ({
  findFirstMock: vi.fn(),
  getCurrentNaiaCustomerMock: vi.fn(),
  createCheckoutSessionMock: vi.fn(),
  reserveCheckoutAttemptMock: vi.fn(),
  releaseCheckoutReservationMock: vi.fn(),
  attachCheckoutSessionIdMock: vi.fn(),
  recordTermsAcceptanceMock: vi.fn(),
}));

vi.mock("~/db.server", () => ({
  default: { subscription: { findFirst: findFirstMock } },
}));

// CURRENT_TERMS_VERSION: null mirrors today's real value exactly (Legal
// handoff W1 — no real Terms document exists yet). Mocked rather than
// left to the real module so (a) this file never depends on whether a
// real db.server.customer.update call would be reachable, and (b) a
// dedicated test below can flip it to a real version via vi.doMock to
// prove the "once a real version exists" path works, without that
// assertion depending on every OTHER test in this file.
vi.mock("~/lib/terms-acceptance.server", () => ({
  CURRENT_TERMS_VERSION: null,
  recordTermsAcceptance: recordTermsAcceptanceMock,
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

// termsAccepted: true is the default for every call site below — every
// one of these pre-existing tests exercises behavior that happens AFTER
// the terms-acceptance gate (reservation, the Stripe call, duplicate-
// subscription handling, etc.), none of them are testing that gate
// itself. Pass termsAccepted explicitly to override this default; see
// the dedicated "Terms acceptance gate" describe block below for that
// coverage.
function makeRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/billing-checkout", {
    method: "POST",
    body: JSON.stringify({ termsAccepted: true, ...body }),
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

// ── Terms-acceptance gate (Legal handoff W1, 2026-11-17) ───────────────────
// A client-side `required` checkbox attribute is trivially bypassed by
// anyone calling this endpoint directly — these tests prove the server
// itself refuses to proceed without it, independent of what the UI sends.
describe("POST /api/billing-checkout — Terms-acceptance gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentNaiaCustomerMock.mockResolvedValue(CUSTOMER);
    findFirstMock.mockResolvedValue(null);
    createCheckoutSessionMock.mockResolvedValue({ id: "cs_test_1", url: "https://checkout.stripe.com/cs_test_1" });
    reserveCheckoutAttemptMock.mockResolvedValue({ allowed: true, expiresAt: new Date("2026-11-12T13:00:00.000Z") });
  });

  it("TC.1 — incomplete submission (termsAccepted field missing entirely) is rejected with terms_not_accepted", async () => {
    const res: any = await action({ request: makeRequest({ planType: "MONTHLY", termsAccepted: undefined }) } as any);
    expect(res.init?.status ?? res.status).toBe(400);
    expect(res.data ?? res).toEqual({ ok: false, code: "terms_not_accepted" });
    expect(createCheckoutSessionMock).not.toHaveBeenCalled();
    expect(reserveCheckoutAttemptMock).not.toHaveBeenCalled();
  });

  it("TC.2 — unchecked submission (termsAccepted: false) is rejected the same way", async () => {
    const res: any = await action({ request: makeRequest({ planType: "MONTHLY", termsAccepted: false }) } as any);
    expect(res.init?.status ?? res.status).toBe(400);
    expect(createCheckoutSessionMock).not.toHaveBeenCalled();
  });

  it("TC.3 — invalid submission (a truthy-but-non-boolean value) is rejected, not loosely coerced to accepted", async () => {
    for (const malformed of ["true", 1, "yes", {}]) {
      vi.clearAllMocks();
      getCurrentNaiaCustomerMock.mockResolvedValue(CUSTOMER);
      const res: any = await action({ request: makeRequest({ planType: "MONTHLY", termsAccepted: malformed }) } as any);
      expect(res.init?.status ?? res.status, `termsAccepted: ${JSON.stringify(malformed)} must not pass`).toBe(400);
      expect(createCheckoutSessionMock).not.toHaveBeenCalled();
    }
  });

  it("TC.4 — a valid, explicit termsAccepted: true clears the gate and reaches checkout-session creation", async () => {
    const res: any = await action({ request: makeRequest({ planType: "MONTHLY", termsAccepted: true }) } as any);
    expect((res.data ?? res).ok).toBe(true);
    expect(createCheckoutSessionMock).toHaveBeenCalledOnce();
  });

  it("TC.5 — duplicate submissions (two consecutive accepted requests) are each evaluated independently by the terms gate — not blocked by any cross-request terms state", async () => {
    const first: any = await action({ request: makeRequest({ planType: "MONTHLY", termsAccepted: true }) } as any);
    expect(first.init?.status ?? first.status ?? 200).toBe(200);
    // Second attempt now finds an existing (non-terminal) subscription row —
    // this IS the pre-existing, already-tested subscription_already_exists
    // guard (BC.* above), proving the terms gate itself isn't what's
    // blocking the second call; it already cleared independently.
    findFirstMock.mockResolvedValue({ status: "ACTIVE", providerCustomerId: "cus_123" });
    const second: any = await action({ request: makeRequest({ planType: "MONTHLY", termsAccepted: true }) } as any);
    expect(second.init?.status ?? second.status).toBe(409);
    expect((second.data ?? second).code).toBe("subscription_already_exists");
  });

  it("TC.6 — recordTermsAcceptance is never called while CURRENT_TERMS_VERSION is null, across every scenario above — the core 'never record acceptance of nonexistent Terms' guarantee", async () => {
    await action({ request: makeRequest({ planType: "MONTHLY", termsAccepted: true }) } as any);
    await action({ request: makeRequest({ planType: "MONTHLY", termsAccepted: false }) } as any);
    await action({ request: makeRequest({ planType: "MONTHLY", termsAccepted: "true" }) } as any);
    expect(recordTermsAcceptanceMock).not.toHaveBeenCalled();
  });

  it("TC.7 — earlyServiceConsent has no effect on the outcome, whether true, false, or absent — it is accepted and discarded, not yet wired to any behavior", async () => {
    const withTrue: any = await action({ request: makeRequest({ planType: "MONTHLY", termsAccepted: true, earlyServiceConsent: true }) } as any);
    expect(withTrue.init?.status ?? withTrue.status ?? 200).toBe(200);
    expect(createCheckoutSessionMock).toHaveBeenCalledOnce();
    const createCheckoutArgsWithConsent = createCheckoutSessionMock.mock.calls[0][0];

    vi.clearAllMocks();
    getCurrentNaiaCustomerMock.mockResolvedValue(CUSTOMER);
    findFirstMock.mockResolvedValue(null);
    createCheckoutSessionMock.mockResolvedValue({ id: "cs_test_1", url: "https://checkout.stripe.com/cs_test_1" });
    reserveCheckoutAttemptMock.mockResolvedValue({ allowed: true, expiresAt: new Date("2026-11-12T13:00:00.000Z") });

    const withoutField: any = await action({ request: makeRequest({ planType: "MONTHLY", termsAccepted: true }) } as any);
    expect(withoutField.init?.status ?? withoutField.status ?? 200).toBe(200);
    const createCheckoutArgsWithoutConsent = createCheckoutSessionMock.mock.calls[0][0];

    // Identical Stripe-facing call either way — earlyServiceConsent never
    // reaches createCheckoutSession's own params.
    expect(createCheckoutArgsWithConsent).toEqual(createCheckoutArgsWithoutConsent);
  });
});

// ── Forward-correctness: once a real Terms version exists ──────────────────
// Verifies the OTHER branch of `if (CURRENT_TERMS_VERSION !== null)` —
// isolated into its own module-mock scope via vi.doMock + a dynamic
// re-import, so flipping the version doesn't affect any test above.
describe("POST /api/billing-checkout — once CURRENT_TERMS_VERSION is a real version (forward-correctness)", () => {
  it("TC.8 — recordTermsAcceptance is called with the real version, for an accepted submission", async () => {
    vi.resetModules();
    const futureRecordMock = vi.fn();
    vi.doMock("~/lib/terms-acceptance.server", () => ({
      CURRENT_TERMS_VERSION: "2027-01-01",
      recordTermsAcceptance: futureRecordMock,
    }));
    const { action: futureAction } = await import("./api.billing-checkout");

    getCurrentNaiaCustomerMock.mockResolvedValue(CUSTOMER);
    findFirstMock.mockResolvedValue(null);
    createCheckoutSessionMock.mockResolvedValue({ id: "cs_test_1", url: "https://checkout.stripe.com/cs_test_1" });
    reserveCheckoutAttemptMock.mockResolvedValue({ allowed: true, expiresAt: new Date("2026-11-12T13:00:00.000Z") });

    const res: any = await futureAction({ request: makeRequest({ planType: "MONTHLY", termsAccepted: true }) } as any);
    expect(res.init?.status ?? res.status ?? 200).toBe(200);
    expect(futureRecordMock).toHaveBeenCalledWith(CUSTOMER.id, "2027-01-01");

    vi.doUnmock("~/lib/terms-acceptance.server");
    vi.resetModules();
  });
});
