// app/lib/billing/stripe-client.test.ts
// Behavioral tests for the Stripe REST client wrapper — the test-mode-only
// safety guard, request shape (checkout session / billing portal params),
// and the bracket-notation form encoder Stripe's API requires. No real
// network call anywhere: _fetch is always injected.
//
// Run: node --import tsx/esm --test app/lib/billing/stripe-client.test.ts

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createCheckoutSession,
  createBillingPortalSession,
  retrieveSubscription,
  toStripeFormBody,
  computeCheckoutIdempotencyKey,
  StripeNotConfiguredError,
  StripeLiveModeBlockedError,
  StripeApiError,
} from "./stripe-client.server";

function fakeFetch(responseBody: unknown, status = 200) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => responseBody,
    } as Response;
  }) as typeof fetch;
  return { fn, calls };
}

describe("toStripeFormBody", () => {
  it("SC.1 — flattens nested objects and arrays into Stripe's bracket notation", () => {
    const body = toStripeFormBody({
      mode: "subscription",
      line_items: [{ quantity: 1, price_data: { currency: "aed", unit_amount: 3900 } }],
    });
    assert.equal(body.get("mode"), "subscription");
    assert.equal(body.get("line_items[0][quantity]"), "1");
    assert.equal(body.get("line_items[0][price_data][currency]"), "aed");
    assert.equal(body.get("line_items[0][price_data][unit_amount]"), "3900");
  });

  it("SC.2 — omits null/undefined values entirely rather than sending the literal string 'null'", () => {
    const body = toStripeFormBody({ customer: undefined, metadata: null, mode: "subscription" });
    assert.equal(body.has("customer"), false);
    assert.equal(body.has("metadata"), false);
    assert.equal(body.get("mode"), "subscription");
  });
});

describe("createCheckoutSession — test-mode guard", () => {
  const input = {
    customerId: "cust-1",
    planType: "MONTHLY" as const,
    amountMinorUnits: 3900,
    currency: "aed",
    successUrl: "https://example.test/success",
    cancelUrl: "https://example.test/cancel",
  };

  it("SC.3 — refuses to call Stripe when STRIPE_SECRET_KEY is unset", async () => {
    const { fn } = fakeFetch({});
    await assert.rejects(
      () => createCheckoutSession(input, { _fetch: fn, _getSecretKey: () => undefined }),
      StripeNotConfiguredError,
    );
  });

  it("SC.4 — refuses to call Stripe when the key is a LIVE key (sk_live_...), never just a test-mode default", async () => {
    const { fn, calls } = fakeFetch({});
    await assert.rejects(
      () => createCheckoutSession(input, { _fetch: fn, _getSecretKey: () => "sk_live_realkey123" }),
      StripeLiveModeBlockedError,
    );
    assert.equal(calls.length, 0, "no network call must be attempted once a live key is detected");
  });

  it("SC.5 — proceeds when the key is a genuine test key (sk_test_...)", async () => {
    const { fn, calls } = fakeFetch({ id: "cs_test_1", url: "https://checkout.stripe.com/cs_test_1" });
    const session = await createCheckoutSession(input, { _fetch: fn, _getSecretKey: () => "sk_test_abc" });
    assert.equal(session.id, "cs_test_1");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.stripe.com/v1/checkout/sessions");
  });
});

describe("createCheckoutSession — request shape", () => {
  it("SC.6 — binds client_reference_id and subscription_data.metadata.customerId so ownership survives onto every later webhook", async () => {
    const { fn, calls } = fakeFetch({ id: "cs_test_1", url: "https://checkout.stripe.com/x" });
    await createCheckoutSession(
      {
        customerId: "cust-42",
        planType: "ANNUAL",
        amountMinorUnits: 29900,
        currency: "aed",
        successUrl: "https://example.test/ok",
        cancelUrl: "https://example.test/no",
      },
      { _fetch: fn, _getSecretKey: () => "sk_test_abc" },
    );
    const sentBody = (calls[0].init.body as URLSearchParams).toString();
    const parsed = new URLSearchParams(sentBody);
    assert.equal(parsed.get("client_reference_id"), "cust-42");
    assert.equal(parsed.get("subscription_data[metadata][customerId]"), "cust-42");
    assert.equal(parsed.get("subscription_data[metadata][planType]"), "ANNUAL");
    assert.equal(parsed.get("mode"), "subscription");
    assert.equal(parsed.get("line_items[0][price_data][recurring][interval]"), "year");
    assert.equal(parsed.get("line_items[0][price_data][unit_amount]"), "29900");
    assert.equal(parsed.get("line_items[0][price_data][currency]"), "aed");
  });

  it("SC.7 — MONTHLY resolves to a month recurring interval, not year", async () => {
    const { fn, calls } = fakeFetch({ id: "cs_test_1", url: "https://checkout.stripe.com/x" });
    await createCheckoutSession(
      { customerId: "c", planType: "MONTHLY", amountMinorUnits: 3900, currency: "aed", successUrl: "https://x", cancelUrl: "https://y" },
      { _fetch: fn, _getSecretKey: () => "sk_test_abc" },
    );
    const parsed = new URLSearchParams((calls[0].init.body as URLSearchParams).toString());
    assert.equal(parsed.get("line_items[0][price_data][recurring][interval]"), "month");
  });

  it("SC.27 — expiresAtUnixSeconds is sent through as Stripe's expires_at param (concurrent-checkout protection, fix/stripe-clerk-phase1-security)", async () => {
    const { fn, calls } = fakeFetch({ id: "cs_test_1", url: "https://checkout.stripe.com/x" });
    await createCheckoutSession(
      {
        customerId: "c", planType: "MONTHLY", amountMinorUnits: 3900, currency: "aed",
        successUrl: "https://x", cancelUrl: "https://y", expiresAtUnixSeconds: 1_700_001_800,
      },
      { _fetch: fn, _getSecretKey: () => "sk_test_abc" },
    );
    const parsed = new URLSearchParams((calls[0].init.body as URLSearchParams).toString());
    assert.equal(parsed.get("expires_at"), "1700001800");
  });

  it("SC.28 — expires_at is omitted entirely when expiresAtUnixSeconds isn't provided — existing callers keep Stripe's own default (24h)", async () => {
    const { fn, calls } = fakeFetch({ id: "cs_test_1", url: "https://checkout.stripe.com/x" });
    await createCheckoutSession(
      { customerId: "c", planType: "MONTHLY", amountMinorUnits: 3900, currency: "aed", successUrl: "https://x", cancelUrl: "https://y" },
      { _fetch: fn, _getSecretKey: () => "sk_test_abc" },
    );
    const parsed = new URLSearchParams((calls[0].init.body as URLSearchParams).toString());
    assert.equal(parsed.has("expires_at"), false);
  });

  it("SC.8 — a non-2xx Stripe response surfaces as StripeApiError with the status and body preserved", async () => {
    const { fn } = fakeFetch({ error: { message: "No such price" } }, 400);
    const input2 = { customerId: "c", planType: "MONTHLY" as const, amountMinorUnits: 3900, currency: "aed", successUrl: "https://x", cancelUrl: "https://y" };
    await assert.rejects(
      () => createCheckoutSession(input2, { _fetch: fn, _getSecretKey: () => "sk_test_abc" }),
      (err: unknown) => err instanceof StripeApiError && err.status === 400,
    );
  });
});

describe("Stripe API version pin", () => {
  it("SC.11 — every outgoing request carries a pinned Stripe-Version header, not whatever the account's dashboard default happens to be", async () => {
    const { fn, calls } = fakeFetch({ id: "cs_test_1", url: "https://checkout.stripe.com/x" });
    await createCheckoutSession(
      { customerId: "c", planType: "MONTHLY", amountMinorUnits: 3900, currency: "aed", successUrl: "https://x", cancelUrl: "https://y" },
      { _fetch: fn, _getSecretKey: () => "sk_test_abc" },
    );
    const headers = calls[0].init.headers as Record<string, string>;
    assert.ok(headers["Stripe-Version"], "Stripe-Version header must be set explicitly");
    // Date-shaped, optionally followed by a major-release codename
    // (e.g. "2026-10-28.endive") — Stripe's post-Acacia version identifiers
    // carry a dot-suffixed name, not just the bare date.
    assert.match(headers["Stripe-Version"], /^\d{4}-\d{2}-\d{2}(\.[a-z]+)?$/, "must be a pinned date-shaped API version, not a dynamic/unset value");
  });

  it("SC.12 — the SAME pinned version is sent on a GET request (subscription retrieval), not just POST", async () => {
    const { fn, calls } = fakeFetch({
      id: "sub_1",
      status: "active",
      customer: "cus_1",
      items: { data: [{ current_period_start: 1700000000, current_period_end: 1702600000 }] },
      cancel_at_period_end: false,
    });
    await retrieveSubscription("sub_1", { _fetch: fn, _getSecretKey: () => "sk_test_abc" });
    const headers = calls[0].init.headers as Record<string, string>;
    assert.ok(headers["Stripe-Version"]);
  });
});

describe("retrieveSubscription — authoritative state fetch", () => {
  it("SC.13 — fetches GET /v1/subscriptions/:id and returns the parsed snapshot", async () => {
    const { fn, calls } = fakeFetch({
      id: "sub_1",
      status: "past_due",
      customer: "cus_1",
      items: { data: [{ current_period_start: 1700000000, current_period_end: 1702600000 }] },
      cancel_at_period_end: true,
    });
    const snapshot = await retrieveSubscription("sub_1", { _fetch: fn, _getSecretKey: () => "sk_test_abc" });
    assert.equal(snapshot.status, "past_due");
    assert.equal(snapshot.cancel_at_period_end, true);
    assert.match(calls[0].url, /\/v1\/subscriptions\/sub_1$/);
    assert.equal(calls[0].init.method, "GET");
  });

  it("SC.23 — the raw response's Endive-shape billing-period fields (items.data[0]) pass through untouched — this client is a thin wrapper, not a field-mapping layer", async () => {
    const { fn } = fakeFetch({
      id: "sub_1",
      status: "active",
      customer: "cus_1",
      items: { data: [{ current_period_start: 1700000000, current_period_end: 1702600000, price: { recurring: { interval: "month" } } }] },
      cancel_at_period_end: false,
    });
    const snapshot = await retrieveSubscription("sub_1", { _fetch: fn, _getSecretKey: () => "sk_test_abc" });
    assert.equal(snapshot.items?.data?.[0]?.current_period_start, 1700000000);
    assert.equal(snapshot.items?.data?.[0]?.current_period_end, 1702600000);
    assert.equal((snapshot as any).current_period_start, undefined, "the Basil-era top-level field must not be assumed present");
  });

  it("SC.14 — also refuses a live key — the test-mode guard applies uniformly to every call, not just Checkout/Portal", async () => {
    const { fn } = fakeFetch({});
    await assert.rejects(
      () => retrieveSubscription("sub_1", { _fetch: fn, _getSecretKey: () => "sk_live_x" }),
      StripeLiveModeBlockedError,
    );
  });
});

describe("computeCheckoutIdempotencyKey — collapsing concurrent/interrupted Checkout creation (financial-safety review)", () => {
  it("SC.17 — two calls for the SAME customer+plan within the same time bucket produce the IDENTICAL key", () => {
    const now = new Date("2026-11-10T12:00:00.000Z");
    const aMomentLater = new Date("2026-11-10T12:00:30.000Z"); // 30s later, same 5-minute bucket
    const key1 = computeCheckoutIdempotencyKey("cust-1", "MONTHLY", now);
    const key2 = computeCheckoutIdempotencyKey("cust-1", "MONTHLY", aMomentLater);
    assert.equal(key1, key2, "two genuinely concurrent (or quickly retried) requests must collapse to the same Stripe idempotency key");
  });

  it("SC.18 — a different customer, even in the exact same instant, never shares a key with another customer", () => {
    const now = new Date("2026-11-10T12:00:00.000Z");
    const key1 = computeCheckoutIdempotencyKey("cust-1", "MONTHLY", now);
    const key2 = computeCheckoutIdempotencyKey("cust-2", "MONTHLY", now);
    assert.notEqual(key1, key2);
  });

  it("SC.19 — the SAME customer choosing a different plan in the same instant gets a DIFFERENT key — these are genuinely different checkout intents", () => {
    const now = new Date("2026-11-10T12:00:00.000Z");
    const monthly = computeCheckoutIdempotencyKey("cust-1", "MONTHLY", now);
    const annual = computeCheckoutIdempotencyKey("cust-1", "ANNUAL", now);
    assert.notEqual(monthly, annual);
  });

  it("SC.20 — a request well outside the bucket window (a genuinely later, separate attempt) gets a FRESH key, not a stale reused one", () => {
    const now = new Date("2026-11-10T12:00:00.000Z");
    const anHourLater = new Date("2026-11-10T13:00:00.000Z");
    const key1 = computeCheckoutIdempotencyKey("cust-1", "MONTHLY", now);
    const key2 = computeCheckoutIdempotencyKey("cust-1", "MONTHLY", anHourLater);
    assert.notEqual(key1, key2, "a later, separate subscribe attempt must not be handed back an old (likely-expired) session via a stale idempotency key");
  });

  it("SC.21 — createCheckoutSession actually sends the computed key as the Idempotency-Key header", async () => {
    const { fn, calls } = fakeFetch({ id: "cs_test_1", url: "https://checkout.stripe.com/x" });
    const now = new Date("2026-11-10T12:00:00.000Z");
    await createCheckoutSession(
      { customerId: "cust-1", planType: "MONTHLY", amountMinorUnits: 3900, currency: "aed", successUrl: "https://x", cancelUrl: "https://y" },
      { _fetch: fn, _getSecretKey: () => "sk_test_abc", _now: () => now },
    );
    const headers = calls[0].init.headers as Record<string, string>;
    assert.equal(headers["Idempotency-Key"], computeCheckoutIdempotencyKey("cust-1", "MONTHLY", now));
  });

  it("SC.22 — two createCheckoutSession calls racing within the same bucket send the SAME Idempotency-Key header — this is what makes Stripe itself collapse the race, not a DB-side check that can't see it in time", async () => {
    const { fn, calls } = fakeFetch({ id: "cs_test_1", url: "https://checkout.stripe.com/x" });
    const now = new Date("2026-11-10T12:00:00.000Z");
    const input = { customerId: "cust-1", planType: "MONTHLY" as const, amountMinorUnits: 3900, currency: "aed", successUrl: "https://x", cancelUrl: "https://y" };
    await Promise.all([
      createCheckoutSession(input, { _fetch: fn, _getSecretKey: () => "sk_test_abc", _now: () => now }),
      createCheckoutSession(input, { _fetch: fn, _getSecretKey: () => "sk_test_abc", _now: () => now }),
    ]);
    const key1 = (calls[0].init.headers as Record<string, string>)["Idempotency-Key"];
    const key2 = (calls[1].init.headers as Record<string, string>)["Idempotency-Key"];
    assert.equal(key1, key2);
  });
});

describe("createCheckoutSession — existing Stripe Customer reuse", () => {
  it("SC.15 — passes an existing providerCustomerId through to Stripe's `customer` param, so a resubscribing customer isn't fragmented across Stripe Customer objects", async () => {
    const { fn, calls } = fakeFetch({ id: "cs_test_1", url: "https://checkout.stripe.com/x" });
    await createCheckoutSession(
      {
        customerId: "c",
        planType: "MONTHLY",
        amountMinorUnits: 3900,
        currency: "aed",
        successUrl: "https://x",
        cancelUrl: "https://y",
        existingProviderCustomerId: "cus_existing_1",
      },
      { _fetch: fn, _getSecretKey: () => "sk_test_abc" },
    );
    const parsed = new URLSearchParams((calls[0].init.body as URLSearchParams).toString());
    assert.equal(parsed.get("customer"), "cus_existing_1");
  });

  it("SC.16 — omits the `customer` param entirely for a genuinely first-time subscriber (no existingProviderCustomerId)", async () => {
    const { fn, calls } = fakeFetch({ id: "cs_test_1", url: "https://checkout.stripe.com/x" });
    await createCheckoutSession(
      { customerId: "c", planType: "MONTHLY", amountMinorUnits: 3900, currency: "aed", successUrl: "https://x", cancelUrl: "https://y" },
      { _fetch: fn, _getSecretKey: () => "sk_test_abc" },
    );
    const parsed = new URLSearchParams((calls[0].init.body as URLSearchParams).toString());
    assert.equal(parsed.has("customer"), false);
  });
});

describe("createBillingPortalSession", () => {
  it("SC.9 — sends the provider customer id and return_url, never accepting a client-supplied customer id", async () => {
    const { fn, calls } = fakeFetch({ id: "bps_1", url: "https://billing.stripe.com/p/x" });
    const session = await createBillingPortalSession(
      { providerCustomerId: "cus_abc", returnUrl: "https://example.test/plan-usage" },
      { _fetch: fn, _getSecretKey: () => "sk_test_abc" },
    );
    assert.equal(session.url, "https://billing.stripe.com/p/x");
    const parsed = new URLSearchParams((calls[0].init.body as URLSearchParams).toString());
    assert.equal(parsed.get("customer"), "cus_abc");
    assert.equal(parsed.get("return_url"), "https://example.test/plan-usage");
  });

  it("SC.10 — also refuses a live key for the billing portal, same guard as checkout", async () => {
    const { fn } = fakeFetch({});
    await assert.rejects(
      () =>
        createBillingPortalSession(
          { providerCustomerId: "cus_abc", returnUrl: "https://x" },
          { _fetch: fn, _getSecretKey: () => "sk_live_x" },
        ),
      StripeLiveModeBlockedError,
    );
  });
});
