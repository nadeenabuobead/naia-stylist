// app/routes/api.billing-checkout.rate-limit.test.ts
//
// 2026-11-17 — H2 regression test (Nov 12 privacy/breach audit).
//
// H2 stated "zero rate limiting anywhere in checkout (existed only on an
// unmerged branch at the time)". The shared module now exists and is merged
// (app/lib/api-rate-limit.server.ts), and several routes consume it, but
// POST /api/billing-checkout was not one of them.
//
// Why this matters beyond "a limit is missing": the route's two existing
// duplicate-subscription layers are correctness controls, not abuse
// controls — they guarantee one customer never gets two billed
// subscriptions, and bound nothing about call volume. One path is
// deliberately unbounded: on a Stripe throw the catch block calls
// releaseCheckoutReservation so a provider blip doesn't lock the customer
// out for the reservation TTL, which also means a client looping on a
// persistent Stripe error re-enters createCheckoutSession immediately and
// indefinitely — a real outbound paid-provider call each time.
//
// These tests mock the limiter itself (its own unit coverage lives in
// api-rate-limit.test.ts) and assert the route's wiring: that the check is
// keyed on the authenticated customer, happens before the reservation and
// before Stripe, that shadow mode never blocks, and that an enforced block
// reaches neither the reservation nor the provider.
//
// Run: npx vitest run app/routes/api.billing-checkout.rate-limit.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

const {
  findFirstMock,
  getCurrentNaiaCustomerMock,
  createCheckoutSessionMock,
  reserveCheckoutAttemptMock,
  releaseCheckoutReservationMock,
  attachCheckoutSessionIdMock,
  checkRateLimitMock,
} = vi.hoisted(() => ({
  findFirstMock: vi.fn(),
  getCurrentNaiaCustomerMock: vi.fn(),
  createCheckoutSessionMock: vi.fn(),
  reserveCheckoutAttemptMock: vi.fn(),
  releaseCheckoutReservationMock: vi.fn(),
  attachCheckoutSessionIdMock: vi.fn(),
  checkRateLimitMock: vi.fn(),
}));

vi.mock("~/db.server", () => ({
  default: { subscription: { findFirst: findFirstMock } },
}));

vi.mock("~/lib/naia-session.server", () => ({
  getCurrentNaiaCustomer: getCurrentNaiaCustomerMock,
}));

// 2026-11-17 (Legal handoff W1 follow-up) — this file tests rate limiting,
// not the Terms-acceptance gate (see api.billing-checkout.test.ts for that
// coverage). With the real CURRENT_TERMS_VERSION (null today), the route's
// fail-closed 503 would fire before any request here ever reached the
// rate-limit logic under test — mocked non-null here for the same reason
// api.billing-checkout.test.ts's own base mock is non-null.
vi.mock("~/lib/terms-acceptance.server", () => ({
  CURRENT_TERMS_VERSION: "2026-TEST-1",
  recordTermsAcceptance: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/lib/billing/stripe-client.server", () => ({
  createCheckoutSession: createCheckoutSessionMock,
  StripeNotConfiguredError: class StripeNotConfiguredError extends Error {},
  StripeLiveModeBlockedError: class StripeLiveModeBlockedError extends Error {},
}));

vi.mock("~/lib/billing/checkout-reservation.server", () => ({
  reserveCheckoutAttempt: reserveCheckoutAttemptMock,
  releaseCheckoutReservation: releaseCheckoutReservationMock,
  attachCheckoutSessionId: attachCheckoutSessionIdMock,
}));

// rateLimitResponse is NOT mocked — the real one builds the 429 and its
// Retry-After header, and that shape is part of what this test pins.
vi.mock("~/lib/api-rate-limit.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/api-rate-limit.server")>();
  return { ...actual, checkRateLimit: checkRateLimitMock };
});

import { action } from "./api.billing-checkout";

const CUSTOMER = { id: "cust-1", membershipStatus: "MEMBER" };

// termsAccepted: true is the default for every call site below — this file
// predates the Legal handoff W1 Terms-acceptance gate and tests rate
// limiting, not that gate, so every call site must pass it by default
// rather than tripping a 400 terms_not_accepted before reaching the
// behavior actually under test. Same convention as api.billing-checkout.
// test.ts's own makeRequest.
function makeRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/billing-checkout", {
    method: "POST",
    body: JSON.stringify({ termsAccepted: true, ...body }),
    headers: { "Content-Type": "application/json" },
  });
}

// The route returns two different shapes, and both matter here: the normal
// paths use React Router's data() helper (a DataWithResponseInit carrying
// .data and .init), while rateLimitResponse returns a real Response. These
// readers accept either, so a test asserting "not 429" is honest about the
// non-429 case instead of silently reading undefined. The status form is the
// same `res.init?.status ?? res.status` convention as
// api.billing-checkout.test.ts.
function statusOf(res: any): number {
  return res?.init?.status ?? res?.status ?? 200;
}

async function payloadOf(res: any): Promise<unknown> {
  return typeof res?.json === "function" ? await res.json() : res?.data;
}

function allowed(over = false) {
  return {
    allowed: true,
    overLimit: over,
    mode: "shadow" as const,
    count: over ? 11 : 1,
    limit: 10,
    retryAfterSeconds: 60,
  };
}

function blocked() {
  return {
    allowed: false,
    overLimit: true,
    mode: "enforce" as const,
    count: 11,
    limit: 10,
    retryAfterSeconds: 42,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentNaiaCustomerMock.mockResolvedValue(CUSTOMER);
  findFirstMock.mockResolvedValue(null);
  reserveCheckoutAttemptMock.mockResolvedValue({
    allowed: true,
    expiresAt: new Date("2026-11-17T13:00:00.000Z"),
  });
  createCheckoutSessionMock.mockResolvedValue({
    id: "cs_test_1",
    url: "https://checkout.stripe.com/cs_test_1",
  });
  checkRateLimitMock.mockResolvedValue(allowed());
});

describe("H2 — checkout is rate limited", () => {
  it("checks BOTH the shadow velocity limit and the enforced burst limit, each keyed on the authenticated customer id", async () => {
    await action({ request: makeRequest({ planType: "MONTHLY" }), params: {}, context: {} } as never);

    expect(checkRateLimitMock).toHaveBeenCalledTimes(2);
    const [firstCustomerId, firstConfig] = checkRateLimitMock.mock.calls[0];
    const [secondCustomerId, secondConfig] = checkRateLimitMock.mock.calls[1];
    expect(firstCustomerId).toBe(CUSTOMER.id);
    expect(secondCustomerId).toBe(CUSTOMER.id);
    expect(firstConfig).toMatchObject({ routeKey: "billing-checkout" });
    expect(secondConfig).toMatchObject({ routeKey: "billing-checkout-burst" });
  });

  it("an enforced block returns 429 and never reaches Stripe or the reservation", async () => {
    checkRateLimitMock.mockResolvedValue(blocked());

    const res = await action({
      request: makeRequest({ planType: "MONTHLY" }),
      params: {},
      context: {},
    } as never);

    expect(statusOf(res)).toBe(429);
    // Narrowed deliberately: the 429 is the one branch that returns a real
    // Response (from rateLimitResponse), so Retry-After is only meaningful
    // — and only typed — here.
    expect((res as Response).headers.get("Retry-After")).toBe("42");

    // The whole point of the limit is to bound the paid outbound call.
    expect(createCheckoutSessionMock).not.toHaveBeenCalled();
    // And it must not burn a reservation the customer would then have to
    // wait out, on a request that was rejected before doing any work.
    expect(reserveCheckoutAttemptMock).not.toHaveBeenCalled();
    expect(releaseCheckoutReservationMock).not.toHaveBeenCalled();
  });

  it("shadow mode never blocks, even when over the limit", async () => {
    checkRateLimitMock.mockResolvedValue(allowed(true));

    const res = await action({
      request: makeRequest({ planType: "MONTHLY" }),
      params: {},
      context: {},
    } as never);

    expect(statusOf(res)).not.toBe(429);
    expect(await payloadOf(res)).toMatchObject({ ok: true, url: "https://checkout.stripe.com/cs_test_1" });
    expect(createCheckoutSessionMock).toHaveBeenCalledTimes(1);
  });

  it("both rate-limit checks are checked BEFORE the reservation and BEFORE the Stripe call", async () => {
    const order: string[] = [];
    checkRateLimitMock.mockImplementation(async () => {
      order.push("rate-limit");
      return allowed();
    });
    reserveCheckoutAttemptMock.mockImplementation(async () => {
      order.push("reserve");
      return { allowed: true, expiresAt: new Date("2026-11-17T13:00:00.000Z") };
    });
    createCheckoutSessionMock.mockImplementation(async () => {
      order.push("stripe");
      return { id: "cs_test_1", url: "https://checkout.stripe.com/cs_test_1" };
    });

    await action({ request: makeRequest({ planType: "MONTHLY" }), params: {}, context: {} } as never);

    expect(order).toEqual(["rate-limit", "rate-limit", "reserve", "stripe"]);
  });

  it("an unauthenticated request is rejected without touching the limiter", async () => {
    // Nothing to key a per-customer counter on, and an unauthenticated
    // caller must not be able to grow another customer's bucket.
    getCurrentNaiaCustomerMock.mockResolvedValue(null);

    const res = await action({
      request: makeRequest({ planType: "MONTHLY" }),
      params: {},
      context: {},
    } as never);

    expect(statusOf(res)).toBe(401);
    expect(checkRateLimitMock).not.toHaveBeenCalled();
  });

  it("a limiter DB outage fails open — the payment path stays up", async () => {
    // api-rate-limit.server.ts returns allowed: true with failedOpen on a DB
    // error; the route must honour that rather than 429-ing a paying
    // customer because a counter table was unavailable. The two
    // duplicate-subscription layers are independent and still hold.
    checkRateLimitMock.mockResolvedValue({ ...allowed(), failedOpen: true });

    const res = await action({
      request: makeRequest({ planType: "MONTHLY" }),
      params: {},
      context: {},
    } as never);

    expect(statusOf(res)).not.toBe(429);
    expect(createCheckoutSessionMock).toHaveBeenCalledTimes(1);
  });

  it("the retry loop the limit exists to bound is still release-then-retry (regression guard)", async () => {
    // Documents the exact mechanism from the module comment: a Stripe throw
    // releases the reservation, so nothing except the rate limit bounds how
    // fast the caller can come back. If this ever stops being true the
    // comment justifying the limit should be revisited, not silently left
    // stale.
    createCheckoutSessionMock.mockRejectedValue(new Error("stripe down"));

    const res = await action({
      request: makeRequest({ planType: "MONTHLY" }),
      params: {},
      context: {},
    } as never);

    expect(statusOf(res)).toBe(502);
    expect(releaseCheckoutReservationMock).toHaveBeenCalledWith(CUSTOMER.id);
  });
});

describe("H2 — the broad velocity limit stays shadow-mode pending real telemetry; the burst limit is enforced from the start", () => {
  const src = fs.readFileSync(
    path.resolve("app/routes/api.billing-checkout.tsx"),
    "utf8",
  );

  it("the broad 10/hour velocity limit starts in shadow mode, per this codebase's rollout discipline", () => {
    // Asserted on source because the config object is module-private; the
    // behavioural consequence (shadow never blocks) is covered above.
    // Deliberately NOT flipped to enforce without real shadow-mode
    // telemetry proving 10/hour is never legitimately reached — see the
    // config's own comment.
    const idx = src.indexOf("const CHECKOUT_RATE_LIMIT");
    expect(idx).toBeGreaterThan(-1);
    const block = src.slice(idx, idx + 260);
    expect(block).toContain('routeKey: "billing-checkout"');
    expect(block).toContain('mode: "shadow" as const');
  });

  it("the narrow 3/60s burst limit is enforced unconditionally — it only ever catches a machine-speed retry loop, never a real customer", () => {
    const idx = src.indexOf("const CHECKOUT_BURST_LIMIT");
    expect(idx).toBeGreaterThan(-1);
    const block = src.slice(idx, idx + 260);
    expect(block).toContain('routeKey: "billing-checkout-burst"');
    expect(block).toContain("limit: 3");
    expect(block).toContain("windowSeconds: 60");
    expect(block).toContain('mode: "enforce" as const');
  });

  it("imports the shared limiter rather than hand-rolling one", () => {
    expect(src).toMatch(
      /import\s*\{[^}]*checkRateLimit[^}]*\}\s*from\s*["']~\/lib\/api-rate-limit\.server["']/,
    );
  });
});

describe("H2 — the enforced burst limit actually blocks, independent of the shadow velocity limit's own result", () => {
  it("a burst block returns 429 and never reaches Stripe or the reservation, even though the velocity check passed", async () => {
    checkRateLimitMock
      .mockResolvedValueOnce(allowed())  // broad velocity limit: under its own threshold
      .mockResolvedValueOnce(blocked()); // burst limit: tripped

    const res = await action({
      request: makeRequest({ planType: "MONTHLY" }),
      params: {},
      context: {},
    } as never);

    expect(statusOf(res)).toBe(429);
    expect((res as Response).headers.get("Retry-After")).toBe("42");
    expect(createCheckoutSessionMock).not.toHaveBeenCalled();
    expect(reserveCheckoutAttemptMock).not.toHaveBeenCalled();
  });

  it("the burst limit is checked SECOND — after the velocity limit, still before the reservation and Stripe", async () => {
    const order: string[] = [];
    checkRateLimitMock
      .mockImplementationOnce(async () => { order.push("velocity"); return allowed(); })
      .mockImplementationOnce(async () => { order.push("burst"); return allowed(); });
    reserveCheckoutAttemptMock.mockImplementation(async () => {
      order.push("reserve");
      return { allowed: true, expiresAt: new Date("2026-11-17T13:00:00.000Z") };
    });
    createCheckoutSessionMock.mockImplementation(async () => {
      order.push("stripe");
      return { id: "cs_test_1", url: "https://checkout.stripe.com/cs_test_1" };
    });

    await action({ request: makeRequest({ planType: "MONTHLY" }), params: {}, context: {} } as never);

    expect(order).toEqual(["velocity", "burst", "reserve", "stripe"]);
  });

  it("both limiters allowing the request proceeds normally", async () => {
    checkRateLimitMock.mockResolvedValue(allowed());

    const res = await action({ request: makeRequest({ planType: "MONTHLY" }), params: {}, context: {} } as never);

    expect(statusOf(res)).not.toBe(429);
    expect(await payloadOf(res)).toMatchObject({ ok: true, url: "https://checkout.stripe.com/cs_test_1" });
  });
});
