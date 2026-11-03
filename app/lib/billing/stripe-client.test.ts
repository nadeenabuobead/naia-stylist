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
  toStripeFormBody,
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

  it("SC.8 — a non-2xx Stripe response surfaces as StripeApiError with the status and body preserved", async () => {
    const { fn } = fakeFetch({ error: { message: "No such price" } }, 400);
    const input2 = { customerId: "c", planType: "MONTHLY" as const, amountMinorUnits: 3900, currency: "aed", successUrl: "https://x", cancelUrl: "https://y" };
    await assert.rejects(
      () => createCheckoutSession(input2, { _fetch: fn, _getSecretKey: () => "sk_test_abc" }),
      (err: unknown) => err instanceof StripeApiError && err.status === 400,
    );
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
