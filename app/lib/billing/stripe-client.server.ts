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

// Pinned deliberately — without an explicit Stripe-Version header, Stripe
// uses the connected account's DASHBOARD-CONFIGURED default version, which
// is unpinned, environment-dependent, and can change without this code
// changing.
//
// "2026-10-28.endive" (the account's current version) is post-Basil:
// current_period_start/current_period_end no longer exist on the top-level
// Subscription object — they moved onto each subscription item
// (items.data[].current_period_start/_end). Every read of those fields in
// webhook-handler.server.ts goes through derivePeriodTimestampFromAuthoritative,
// which reads from items.data[0] for exactly this reason. Do not bump this
// version without re-checking Stripe's changelog for every field this
// integration actually touches (Checkout Session, Invoice,
// Subscription/SubscriptionItem) across every major release in between.
//
// NOTE: this header only pins OUR outgoing REST calls (Checkout Session,
// Billing Portal, subscription retrieval). It does NOT control what API
// version shape Stripe uses for INCOMING webhook payloads — that is a
// separate, Dashboard-side webhook-endpoint setting that must be pinned to
// the SAME version independently.
const STRIPE_API_VERSION = "2026-10-28.endive";

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
  method: "GET" | "POST" | "DELETE",
  path: string,
  params: Record<string, unknown> = {},
  { _fetch = fetch, _getSecretKey = () => process.env.STRIPE_SECRET_KEY }: StripeRequestDeps = {},
  idempotencyKey?: string,
): Promise<any> {
  const secretKey = _getSecretKey();
  if (!secretKey) throw new StripeNotConfiguredError();
  assertTestModeKey(secretKey);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${secretKey}`,
    "Content-Type": "application/x-www-form-urlencoded",
    "Stripe-Version": STRIPE_API_VERSION,
  };
  // Lets a retried or genuinely concurrent request collapse to the SAME
  // Stripe object instead of creating a second one — see createCheckoutSession.
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

  const init: RequestInit = { method, headers };

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
  // Set when this customer already has a providerCustomerId on file (e.g.
  // from a prior, now-canceled subscription) so Stripe reuses the SAME
  // Customer object instead of minting a new one on every Checkout
  // Session — keeps billing/payment history consolidated under one Stripe
  // Customer rather than fragmenting it across resubscriptions.
  existingProviderCustomerId?: string | null;
  // Unix timestamp (seconds) this Checkout Session itself expires at. Stripe
  // enforces a 30-minute minimum from creation. Set from
  // checkout-reservation.server.ts's own TTL so an abandoned session's
  // Stripe-side expiry and our own reservation row's expiry line up — Stripe's
  // checkout.session.expired webhook (webhook-handler.server.ts) then fires
  // right as our own fallback cleanup would otherwise kick in, not meaningfully
  // before or after. Optional only so existing callers/tests without a
  // reservation still work — Stripe defaults to 24 hours when omitted.
  expiresAtUnixSeconds?: number;
}

export interface StripeCheckoutSession {
  id: string;
  url: string | null;
  customer: string | null;
  subscription: string | null;
  payment_status: string;
}

// 5-minute bucket: two requests for the SAME customer+plan within the same
// bucket collapse to the SAME Stripe Checkout Session (Stripe's own
// idempotency layer returns the cached object for a repeated key instead of
// creating a second one) — this is what actually closes the race a DB-side
// "does a Subscription row already exist" check cannot: that check only
// ever sees something once the customer has FINISHED a checkout and the
// webhook has landed, which can be minutes away, while genuinely
// concurrent requests (two tabs, a double-click, a retried/interrupted
// request after a network drop) race on THIS call, long before any
// Subscription row exists to check against. Bucketed rather than a single
// permanent per-customer-per-plan key so a genuinely later, separate
// subscribe attempt (after this bucket has passed) still gets a fresh
// session rather than being handed back an old, likely-expired one.
const CHECKOUT_IDEMPOTENCY_BUCKET_MS = 5 * 60 * 1000;

export function computeCheckoutIdempotencyKey(customerId: string, planType: string, now: Date = new Date()): string {
  const bucket = Math.floor(now.getTime() / CHECKOUT_IDEMPOTENCY_BUCKET_MS);
  return `checkout:${customerId}:${planType}:${bucket}`;
}

export interface CreateCheckoutSessionDeps extends StripeRequestDeps {
  _now?: () => Date;
}

export async function createCheckoutSession(
  input: CreateCheckoutSessionInput,
  deps: CreateCheckoutSessionDeps = {},
): Promise<StripeCheckoutSession> {
  const { _now = () => new Date(), ...requestDeps } = deps;
  const interval = input.planType === "MONTHLY" ? "month" : "year";
  const idempotencyKey = computeCheckoutIdempotencyKey(input.customerId, input.planType, _now());
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
      // Reuse the existing Stripe Customer when we have one on file, rather
      // than letting Stripe mint a new one on every Checkout Session —
      // keeps a resubscribing customer's billing history under one Stripe
      // Customer object instead of fragmenting it.
      customer: input.existingProviderCustomerId ?? undefined,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      ...(input.expiresAtUnixSeconds ? { expires_at: input.expiresAtUnixSeconds } : {}),
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: input.currency,
            unit_amount: input.amountMinorUnits,
            recurring: { interval },
            product_data: { name: `nAia Stylist Membership — ${input.planType}` },
            // Founder Decision 18: AED 39/month and AED 299/year are fixed,
            // tax-inclusive gross prices — the customer's amount_total never
            // moves regardless of what tax (if any) applies; a positive tax
            // amount is backed OUT of this unit_amount, never added on top.
            // Explicit here rather than relying on the account's Dashboard
            // default (Tax Settings > "Include tax in prices"), since that
            // default can change outside this code and this decision must
            // not silently follow it.
            tax_behavior: "inclusive",
          },
        },
      ],
      // tax_behavior alone calculates nothing — verified against Stripe's
      // own docs (docs.stripe.com/tax/products-prices-tax-codes-tax-
      // behavior): it is purely a presentation setting for whatever tax
      // Stripe Tax actually computes, and Stripe Tax only runs at all when
      // automatic_tax.enabled is set on the Checkout Session itself. Without
      // this, the two prior lines would do nothing — Founder Decision 18
      // requires correct tax CALCULATION within the fixed gross price, not
      // just a label describing how a (never-computed) tax would be shown.
      //
      // Stripe only calculates tax in jurisdictions where an active tax
      // registration exists in the Dashboard (docs.stripe.com/tax/
      // calculating) — with none configured, the SAME request below
      // correctly computes zero tax everywhere, which is the safe, correct
      // behavior while UK VAT/Ireland OSS registration remains separate and
      // pending, exactly as instructed. No Dashboard/live Stripe setting is
      // touched by this change; enabling this now is forward-compatible —
      // tax starts calculating correctly the moment registrations exist,
      // with zero further code changes. For subscription-mode Checkout
      // specifically, this setting carries forward onto the created
      // Subscription object itself, so every future renewal invoice is
      // taxed the same way automatically — not just this first charge.
      automatic_tax: { enabled: true },
      subscription_data: {
        metadata: { customerId: input.customerId, planType: input.planType },
      },
      metadata: { customerId: input.customerId, planType: input.planType },
    },
    requestDeps,
    idempotencyKey,
  );
}

// ── Subscription retrieval — authoritative state, not the webhook snapshot ──
//
// Webhook payloads are a snapshot taken at send time; processing can be
// delayed (retry backlogs, queueing), and Stripe explicitly does not
// guarantee webhook delivery order. Rather than write Subscription.status/
// currentPeriodStart/End/cancelAtPeriodEnd straight from an event's
// embedded object, webhook-handler.server.ts re-fetches the subscription
// object directly from Stripe and writes FROM that — the event only
// triggers the sync, it is not itself trusted as the source of truth.

export interface StripeSubscriptionSnapshot {
  id: string;
  status: string;
  customer: string;
  cancel_at_period_end: boolean;
  // Present on the real Stripe response (stripeRequest returns the raw,
  // unfiltered JSON — this interface is a type narrowing, not a runtime
  // filter). current_period_start/current_period_end live on the
  // subscription item (not the subscription itself) as of API version
  // 2025-03-31.basil and later — see STRIPE_API_VERSION's comment above.
  // Declared as `unknown` here, not `number`, because this is the one place
  // in the type system a malformed/unexpected Stripe response would
  // otherwise be silently trusted; derivePeriodTimestampFromAuthoritative
  // in webhook-handler.server.ts is what actually validates the runtime
  // type before ever constructing a Date from it. price.recurring.interval
  // is used to derive planType authoritatively on sync rather than trusting
  // the embedded event body's metadata. Only the fields this app actually
  // needs are declared.
  items?: {
    data: Array<{
      price?: { recurring?: { interval?: string } };
      current_period_start?: unknown;
      current_period_end?: unknown;
    }>;
  };
}

export async function retrieveSubscription(
  providerSubscriptionId: string,
  deps: StripeRequestDeps = {},
): Promise<StripeSubscriptionSnapshot> {
  return stripeRequest("GET", `/subscriptions/${encodeURIComponent(providerSubscriptionId)}`, {}, deps);
}

// Immediate cancellation (Stripe's DELETE verb) — deliberately distinct from
// the ordinary customer-initiated cancellation flow, which sets
// cancel_at_period_end via the Billing Portal and retains access until the
// period ends. Used only by erasure-billing.server.ts's account-erasure
// path, where there is no longer a customer to retain access FOR. See that
// file's own header for the full reasoning.
export async function cancelSubscriptionImmediately(
  providerSubscriptionId: string,
  deps: StripeRequestDeps = {},
): Promise<StripeSubscriptionSnapshot> {
  return stripeRequest("DELETE", `/subscriptions/${encodeURIComponent(providerSubscriptionId)}`, {}, deps);
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
