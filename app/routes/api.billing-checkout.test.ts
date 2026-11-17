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

// CURRENT_TERMS_VERSION: a non-null stand-in version is the BASE mock for
// this file, deliberately NOT today's real null value — every BC.* test
// below (duplicate-subscription handling) and TC.1/2/3/4/5/7 (terms-
// checkbox validation) test behavior that sits AFTER the fail-closed
// "is Terms even configured" gate api.billing-checkout.tsx now applies
// first (correctness review, 2026-11-17). With CURRENT_TERMS_VERSION
// mocked null, none of them could ever reach that code. The null-today
// reality is its own dedicated scope below ("fail-closed when no Terms
// version is configured"), isolated via vi.doMock + a dynamic re-import,
// exactly the same technique the "once a real version exists" block
// already used — so flipping the version in either direction never
// affects the other tests in this file.
vi.mock("~/lib/terms-acceptance.server", () => ({
  CURRENT_TERMS_VERSION: "2026-TEST-1",
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
    recordTermsAcceptanceMock.mockResolvedValue(undefined);
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
    recordTermsAcceptanceMock.mockResolvedValue(undefined);
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
    recordTermsAcceptanceMock.mockResolvedValue(undefined);
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

  it("TC.6 — recordTermsAcceptance is called with the authenticated customer and the exact configured version, for an accepted submission", async () => {
    await action({ request: makeRequest({ planType: "MONTHLY", termsAccepted: true }) } as any);
    expect(recordTermsAcceptanceMock).toHaveBeenCalledWith(CUSTOMER.id, "2026-TEST-1");
  });

  it("TC.6b — recordTermsAcceptance is NOT called for any rejected submission (unchecked or invalid) — only a cleared gate records anything", async () => {
    await action({ request: makeRequest({ planType: "MONTHLY", termsAccepted: false }) } as any);
    await action({ request: makeRequest({ planType: "MONTHLY", termsAccepted: "true" }) } as any);
    expect(recordTermsAcceptanceMock).not.toHaveBeenCalled();
  });

  it("TC.7 — earlyServiceConsent never changes THIS checkout's own outcome, whether true, false, or absent — it only now gets forwarded as a snapshot for a later withdrawal-eligibility check (2026-11-17)", async () => {
    const withTrue: any = await action({ request: makeRequest({ planType: "MONTHLY", termsAccepted: true, earlyServiceConsent: true }) } as any);
    expect(withTrue.init?.status ?? withTrue.status ?? 200).toBe(200);
    expect(createCheckoutSessionMock).toHaveBeenCalledOnce();
    const createCheckoutArgsWithConsent = createCheckoutSessionMock.mock.calls[0][0];
    expect(createCheckoutArgsWithConsent.earlyServiceConsent).toBe(true);

    vi.clearAllMocks();
    getCurrentNaiaCustomerMock.mockResolvedValue(CUSTOMER);
    findFirstMock.mockResolvedValue(null);
    createCheckoutSessionMock.mockResolvedValue({ id: "cs_test_1", url: "https://checkout.stripe.com/cs_test_1" });
    reserveCheckoutAttemptMock.mockResolvedValue({ allowed: true, expiresAt: new Date("2026-11-12T13:00:00.000Z") });

    const withoutField: any = await action({ request: makeRequest({ planType: "MONTHLY", termsAccepted: true }) } as any);
    expect(withoutField.init?.status ?? withoutField.status ?? 200).toBe(200);
    const createCheckoutArgsWithoutConsent = createCheckoutSessionMock.mock.calls[0][0];
    expect(createCheckoutArgsWithoutConsent.earlyServiceConsent).toBe(false);

    // The two calls differ in EXACTLY the one field that is supposed to
    // differ — everything else (plan, amount, urls, reservation expiry) is
    // identical, proving the consent value changes nothing about what gets
    // charged or how.
    expect({ ...createCheckoutArgsWithConsent, earlyServiceConsent: undefined }).toEqual({
      ...createCheckoutArgsWithoutConsent,
      earlyServiceConsent: undefined,
    });
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

// ── Fail-closed: no approved Terms version configured (today's real state)
// Correctness review, 2026-11-17 — the original version of this gate only
// skipped RECORDING acceptance when CURRENT_TERMS_VERSION was null and
// otherwise let checkout proceed anyway, which meant a customer could be
// charged real money while never having validly agreed to anything. This
// scope proves the fix: the whole flow refuses to run, independent of
// what the client sends, whenever no real Terms version exists.
describe("POST /api/billing-checkout — fail-closed when no Terms version is configured", () => {
  async function withNullVersion() {
    vi.resetModules();
    const nullVersionRecordMock = vi.fn();
    vi.doMock("~/lib/terms-acceptance.server", () => ({
      CURRENT_TERMS_VERSION: null,
      recordTermsAcceptance: nullVersionRecordMock,
    }));
    const { action: nullVersionAction } = await import("./api.billing-checkout");
    return { nullVersionAction, nullVersionRecordMock };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentNaiaCustomerMock.mockResolvedValue(CUSTOMER);
    findFirstMock.mockResolvedValue(null);
    createCheckoutSessionMock.mockResolvedValue({ id: "cs_test_1", url: "https://checkout.stripe.com/cs_test_1" });
    reserveCheckoutAttemptMock.mockResolvedValue({ allowed: true, expiresAt: new Date("2026-11-12T13:00:00.000Z") });
  });

  it("TC.9 — returns 503 terms_not_configured, even for an otherwise-valid, fully-accepted submission", async () => {
    const { nullVersionAction } = await withNullVersion();
    const res: any = await nullVersionAction({ request: makeRequest({ planType: "MONTHLY", termsAccepted: true }) } as any);
    expect(res.init?.status ?? res.status).toBe(503);
    expect((res.data ?? res).code).toBe("terms_not_configured");
    vi.doUnmock("~/lib/terms-acceptance.server");
    vi.resetModules();
  });

  it("TC.10 — a bypass attempt (termsAccepted: true sent directly, skipping the UI) does NOT help — still 503, nothing downstream runs", async () => {
    const { nullVersionAction, nullVersionRecordMock } = await withNullVersion();
    await nullVersionAction({ request: makeRequest({ planType: "MONTHLY", termsAccepted: true }) } as any);
    expect(nullVersionRecordMock).not.toHaveBeenCalled();
    expect(reserveCheckoutAttemptMock).not.toHaveBeenCalled();
    expect(createCheckoutSessionMock).not.toHaveBeenCalled();
    vi.doUnmock("~/lib/terms-acceptance.server");
    vi.resetModules();
  });

  it("TC.11 — fails closed even before the request body is read — a malformed/unparseable body still gets 503, not invalid_json", async () => {
    const { nullVersionAction } = await withNullVersion();
    const garbledRequest = new Request("http://localhost/api/billing-checkout", {
      method: "POST",
      body: "{not valid json",
      headers: { "Content-Type": "application/json" },
    });
    const res: any = await nullVersionAction({ request: garbledRequest } as any);
    expect(res.init?.status ?? res.status).toBe(503);
    expect((res.data ?? res).code).toBe("terms_not_configured");
    vi.doUnmock("~/lib/terms-acceptance.server");
    vi.resetModules();
  });
});

// ── Recording failure blocks checkout (Terms IS configured, the write itself fails)
describe("POST /api/billing-checkout — a failed Terms-acceptance recording blocks checkout", () => {
  it("TC.12 — recordTermsAcceptance rejecting returns 500 terms_acceptance_record_failed, and reservation/Stripe never run", async () => {
    vi.resetModules();
    const failingRecordMock = vi.fn().mockRejectedValue(new Error("write failed"));
    vi.doMock("~/lib/terms-acceptance.server", () => ({
      CURRENT_TERMS_VERSION: "2026-TEST-1",
      recordTermsAcceptance: failingRecordMock,
    }));
    const { action: failingAction } = await import("./api.billing-checkout");

    getCurrentNaiaCustomerMock.mockResolvedValue(CUSTOMER);
    findFirstMock.mockResolvedValue(null);
    createCheckoutSessionMock.mockResolvedValue({ id: "cs_test_1", url: "https://checkout.stripe.com/cs_test_1" });
    reserveCheckoutAttemptMock.mockResolvedValue({ allowed: true, expiresAt: new Date("2026-11-12T13:00:00.000Z") });

    const res: any = await failingAction({ request: makeRequest({ planType: "MONTHLY", termsAccepted: true }) } as any);
    expect(res.init?.status ?? res.status).toBe(500);
    expect((res.data ?? res).code).toBe("terms_acceptance_record_failed");
    expect(reserveCheckoutAttemptMock).not.toHaveBeenCalled();
    expect(createCheckoutSessionMock).not.toHaveBeenCalled();

    vi.doUnmock("~/lib/terms-acceptance.server");
    vi.resetModules();
  });

  it("TC.13 — a RETRY after a recording failure succeeds normally once the write itself succeeds — the failure isn't sticky", async () => {
    vi.resetModules();
    const flakyRecordMock = vi.fn()
      .mockRejectedValueOnce(new Error("transient write failure"))
      .mockResolvedValueOnce(undefined);
    vi.doMock("~/lib/terms-acceptance.server", () => ({
      CURRENT_TERMS_VERSION: "2026-TEST-1",
      recordTermsAcceptance: flakyRecordMock,
    }));
    const { action: flakyAction } = await import("./api.billing-checkout");

    getCurrentNaiaCustomerMock.mockResolvedValue(CUSTOMER);
    findFirstMock.mockResolvedValue(null);
    createCheckoutSessionMock.mockResolvedValue({ id: "cs_test_1", url: "https://checkout.stripe.com/cs_test_1" });
    reserveCheckoutAttemptMock.mockResolvedValue({ allowed: true, expiresAt: new Date("2026-11-12T13:00:00.000Z") });

    const first: any = await flakyAction({ request: makeRequest({ planType: "MONTHLY", termsAccepted: true }) } as any);
    expect(first.init?.status ?? first.status).toBe(500);
    expect(createCheckoutSessionMock).not.toHaveBeenCalled();

    const second: any = await flakyAction({ request: makeRequest({ planType: "MONTHLY", termsAccepted: true }) } as any);
    expect(second.init?.status ?? second.status ?? 200).toBe(200);
    expect(createCheckoutSessionMock).toHaveBeenCalledOnce();

    vi.doUnmock("~/lib/terms-acceptance.server");
    vi.resetModules();
  });
});
