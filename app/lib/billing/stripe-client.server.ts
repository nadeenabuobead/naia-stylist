// app/lib/billing/stripe-client.server.ts
// Phase 3 — thin Stripe REST wrapper, built on raw fetch rather than the
// `stripe` npm package. This mirrors the existing provider-integration
// convention in this codebase (see fashn-try-on.server.ts's FASHN client:
// no vendor SDK, a lazily-read API key, _fetch injected for testability)
// rather than introducing a new dependency and a second integration style.
//
// SAFETY: assertTestModeKey is a hard, structural guard — every function
// here refuses to run if STRIPE_SECRET_KEY does not look like a Stripe TEST
// secret key (sk_test_...). This is deliberate and must not be relaxed
// without an explicit, separate decision: "Stripe test mode only, no real
// payments" is a standing constraint on this entire billing effort, and a
// live key landing in this env var by accident (e.g. a copy-paste mistake)
// must fail loudly here rather than silently process a real charge.

const STRIPE_API_BASE = "https://api.stripe.com/v1";

export type FetchFn = typeof fetch;
export type GetSecretKeyFn = () => string | undefined;

export class StripeNotConfiguredError extends Error {
  constructor() {
    super("STRIPE_SECRET_KEY is not set.");
    this.name = "StripeNotConfiguredError";
  }
}

export class StripeLiveModeBlockedError extends Error {
  constructor() {
    super(
      "STRIPE_SECRET_KEY is not a Stripe TEST key (expected sk_test_...). " +
        "Refusing to call the Stripe API — this project is Stripe test-mode only.",
    );
    this.name = "StripeLiveModeBlockedError";
  }
}

export class StripeApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, body: unknown) {
    super(`Stripe API error (status ${status})`);
    this.name = "StripeApiError";
    this.status = status;
    this.body = body;
  }
}

function assertTestModeKey(key: string): void {
  if (!key.startsWith("sk_test_")) {
    throw new StripeLiveModeBlockedError();
  }
}

// Flattens a nested params object into Stripe's expected
// application/x-www-form-urlencoded bracket notation, e.g.
// { line_items: [{ price_data: { currency: "aed" } }] } becomes
// line_items[0][price_data][currency]=aed. Stripe's REST API requires this
// encoding for nested/array params — there is no JSON body mode.
export function toStripeFormBody(params: Record<string, unknown>): URLSearchParams {
  const body = new URLSearchParams();

  function walk(prefix: string, value: unknown): void {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((item, i) => walk(`${prefix}[${i}]`, item));
    } else if (typeof value === "object") {
      for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
        walk(prefix ? `${prefix}[${key}]` : key, val);
      }
    } else {
      body.append(prefix, String(value));
    }
  }

  for (const [key, val] of Object.entries(params)) {
    walk(key, val);
  }
  return body;
}

export interface StripeRequestDeps {
  _fetch?: FetchFn;
  _getSecretKey?: GetSecretKeyFn;
}

async function stripeRequest(
  method: "GET" | "POST",
  path: string,
  params: Record<string, unknown> = {},
  { _fetch = fetch, _getSecretKey = () => process.env.STRIPE_SECRET_KEY }: StripeRequestDeps = {},
): Promise<any> {
  const secretKey = _getSecretKey();
  if (!secretKey) throw new StripeNotConfiguredError();
  assertTestModeKey(secretKey);

  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
  };

  let url = `${STRIPE_API_BASE}${path}`;
  if (method === "GET") {
    const qs = toStripeFormBody(params).toString();
    if (qs) url += `?${qs}`;
  } else {
    init.body = toStripeFormBody(params);
  }

  const res = await _fetch(url, init);
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new StripeApiError(res.status, json);
  return json;
}

// ── Checkout Sessions ────────────────────────────────────────────────────────

export interface CreateCheckoutSessionInput {
  customerId: string; // our Customer.id — never trust a client-supplied value here
  planType: "MONTHLY" | "ANNUAL";
  amountMinorUnits: number; // fils — MEMBERSHIP_PRICING already expresses this unit
  currency: string; // lowercase ISO code, e.g. "aed"
  successUrl: string;
  cancelUrl: string;
}

export interface StripeCheckoutSession {
  id: string;
  url: string | null;
  customer: string | null;
  subscription: string | null;
  payment_status: string;
}

export async function createCheckoutSession(
  input: CreateCheckoutSessionInput,
  deps: StripeRequestDeps = {},
): Promise<StripeCheckoutSession> {
  const interval = input.planType === "MONTHLY" ? "month" : "year";
  return stripeRequest(
    "POST",
    "/checkout/sessions",
    {
      mode: "subscription",
      // client_reference_id is Stripe's own dedicated field for exactly this
      // purpose (binding a session back to our own customer record) — belt
      // and suspenders with subscription_data.metadata below, which is what
      // carries this identity forward onto every later subscription webhook.
      client_reference_id: input.customerId,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: input.currency,
            unit_amount: input.amountMinorUnits,
            recurring: { interval },
            product_data: { name: `nAia Stylist Membership — ${input.planType}` },
          },
        },
      ],
      subscription_data: {
        metadata: { customerId: input.customerId, planType: input.planType },
      },
      metadata: { customerId: input.customerId, planType: input.planType },
    },
    deps,
  );
}

// ── Billing Portal (customer billing management: cancel, update payment method) ──

export interface CreateBillingPortalSessionInput {
  providerCustomerId: string; // Subscription.providerCustomerId — must already exist
  returnUrl: string;
}

export interface StripeBillingPortalSession {
  id: string;
  url: string;
}

export async function createBillingPortalSession(
  input: CreateBillingPortalSessionInput,
  deps: StripeRequestDeps = {},
): Promise<StripeBillingPortalSession> {
  return stripeRequest(
    "POST",
    "/billing_portal/sessions",
    { customer: input.providerCustomerId, return_url: input.returnUrl },
    deps,
  );
}
