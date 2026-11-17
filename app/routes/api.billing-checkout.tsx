// app/routes/api.billing-checkout.tsx
// Phase 3 — Customer-facing Stripe Checkout session creation.
//
// POST /api/billing-checkout
//
// Security contract:
//   - Customer identity is resolved from the authenticated session only
//     (getCurrentNaiaCustomer), never from the request body — same
//     convention as api.trigger-tryon.tsx.
//   - planType is the only client input accepted; pricing (amount,
//     currency) is read from the server-side MEMBERSHIP_PRICING catalog,
//     never from the client, so a tampered request body cannot change what
//     gets charged.
//   - Does not create or mutate any Subscription row itself — that only
//     ever happens from a confirmed webhook event (see webhook-handler.
//     server.ts). Creating a Checkout Session grants nothing by itself.
//   - Duplicate-subscription prevention, two layers:
//     1. Refuses to create a second Checkout Session while the customer
//        already has a Subscription row that isn't CANCELED/EXPIRED — the
//        resolved-outcome case (an earlier attempt's webhook already landed).
//     2. reserveCheckoutAttempt (checkout-reservation.server.ts) closes the
//        gap the above cannot: two requests racing BEFORE any Subscription
//        row exists (two tabs, a double-click outside the 5-minute Stripe
//        idempotency-key bucket, two different plan types) could otherwise
//        each mint a separate, independently-billed Stripe subscription.
//        A database-level unique constraint on customerId, not a read-then-
//        write check, is what makes this one actually race-safe.

import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { getCurrentNaiaCustomer } from "~/lib/naia-session.server";
import prisma from "~/db.server";
import { MEMBERSHIP_PRICING } from "~/lib/plan/plan-limits.server";
import { createCheckoutSession, StripeNotConfiguredError, StripeLiveModeBlockedError } from "~/lib/billing/stripe-client.server";
import { reserveCheckoutAttempt, releaseCheckoutReservation, attachCheckoutSessionId } from "~/lib/billing/checkout-reservation.server";
import { checkRateLimit, rateLimitResponse } from "~/lib/api-rate-limit.server";
import { CURRENT_TERMS_VERSION, recordTermsAcceptance } from "~/lib/terms-acceptance.server";

// 2026-11-17 (H2) — velocity limit on checkout.
//
// The two duplicate-subscription layers documented in the module header
// above are correctness controls, not abuse controls: both are about never
// minting two billed subscriptions for one customer. Neither bounds how
// many times a customer can drive the route, and one path is explicitly
// unbounded by design — when the Stripe call throws, the catch block calls
// releaseCheckoutReservation so the customer isn't locked out for the full
// reservation TTL. That is the right behaviour for a genuine provider
// blip, but it means a client looping on a persistent Stripe error can
// re-enter createCheckoutSession immediately and indefinitely, each
// iteration a real outbound call against a paid provider.
//
// Shadow mode first, matching this codebase's established rollout
// discipline for every rate limit introduced so far (api.cloudinary-
// signature.jsx, api.export-zip.ts, api.analyze-item) — a brand-new limit
// never starts out blocking real customers, and this one sits in the
// payment path where a false positive is especially costly.
//
// 10/hour: a real customer reaches checkout once, or a handful of times
// across plan changes and abandoned attempts. 10 leaves generous headroom
// over any legitimate pattern while still bounding a retry loop. Looser
// than export-zip's 5/hour (a full data export is far more expensive per
// call) and tighter than the Cloudinary signature's 20/minute (a
// per-upload operation).
const CHECKOUT_RATE_LIMIT = {
  routeKey: "billing-checkout",
  limit: 10,
  windowSeconds: 3600,
  mode: "shadow" as const,
};

function authRequired() {
  return data({ ok: false, code: "auth_required" }, { status: 401 });
}

function badRequest(code: string) {
  return data({ ok: false, code }, { status: 400 });
}

export async function loader() {
  return data({ error: "method_not_allowed" }, { status: 405 });
}

export async function action({ request }: ActionFunctionArgs) {
  const customer = await getCurrentNaiaCustomer(request);
  if (!customer) return authRequired();

  // Keyed on the authenticated customer id, so it is checked after auth and
  // before any DB read, any reservation, and above all before the outbound
  // Stripe call — a limit applied after the expensive step would protect
  // nothing. Fails open on a limiter DB error by construction (see
  // api-rate-limit.server.ts), which is the correct trade here: the two
  // duplicate-subscription layers below are independent and still hold, so
  // a limiter outage must not take down the payment path.
  const rl = await checkRateLimit(customer.id, CHECKOUT_RATE_LIMIT);
  if (!rl.allowed) return rateLimitResponse(rl);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("invalid_json");
  }

  const planType = (body as any)?.planType;
  if (planType !== "MONTHLY" && planType !== "ANNUAL") {
    return badRequest("invalid_plan_type");
  }

  // Legal handoff W1 (2026-11-17) — required Terms acceptance, enforced
  // here because a client-side `required` attribute on the checkbox is
  // trivially bypassed by anyone calling this endpoint directly. Checked
  // as a strict `=== true`, never a truthy coercion, so a malformed or
  // missing value fails closed rather than silently passing. This check
  // runs before any Stripe call or reservation, same "cheapest check
  // first" ordering as the planType validation above.
  const termsAccepted = (body as any)?.termsAccepted === true;
  if (!termsAccepted) {
    return badRequest("terms_not_accepted");
  }

  // Early-service-consent (Legal handoff W1's "separate, initially
  // unchecked" checkbox) is read and validated for shape only — its value
  // has NO effect anywhere in this action. What checking it would mean
  // (immediate vs. delayed activation, and the exact statutory
  // consequence) is still pending Legal/founder sign-off; until that
  // exists, this endpoint must not behave any differently based on it.
  // Accepting and discarding it here (rather than ignoring the field
  // entirely) means the full submission path is already wired and
  // tested end-to-end — the day a real behavior is approved, only the
  // decision logic needs to be added, not new plumbing.
  const earlyServiceConsent = (body as any)?.earlyServiceConsent === true;
  void earlyServiceConsent; // deliberately inert — see comment above

  // Recording acceptance is itself gated on a real Terms version existing
  // — see terms-acceptance.server.ts's own header. CURRENT_TERMS_VERSION
  // is null today, so this never runs; the moment Legal publishes a real
  // version and this constant is updated, acceptance starts being
  // recorded with no further wiring needed here. Recorded regardless of
  // whether this specific checkout attempt goes on to succeed below —
  // accepting Terms is a fact about the customer, not about this one
  // attempt's outcome.
  if (CURRENT_TERMS_VERSION !== null) {
    await recordTermsAcceptance(customer.id, CURRENT_TERMS_VERSION);
  }

  const existing = await prisma.subscription.findFirst({
    where: { customerId: customer.id },
    orderBy: { createdAt: "desc" },
    select: { status: true, providerCustomerId: true },
  });
  if (existing && existing.status !== "CANCELED" && existing.status !== "EXPIRED") {
    return data({ ok: false, code: "subscription_already_exists" }, { status: 409 });
  }

  // Layer 2 — see the module header above. Must happen BEFORE the Stripe API
  // call, not after: the whole point is to close the race on the slow,
  // network-bound step, and a reservation made only after Stripe already
  // responded would protect nothing.
  const reservation = await reserveCheckoutAttempt(customer.id, planType);
  if (!reservation.allowed) {
    return data({ ok: false, code: "checkout_already_pending" }, { status: 409 });
  }

  const pricing = planType === "MONTHLY" ? MEMBERSHIP_PRICING.monthly : MEMBERSHIP_PRICING.annual;
  const origin = new URL(request.url).origin;

  try {
    const session = await createCheckoutSession({
      customerId: customer.id,
      planType,
      amountMinorUnits: pricing.amount * 100, // AED major units -> fils
      currency: pricing.currency.toLowerCase(),
      successUrl: `${origin}/my-naia/plan-usage?checkout=success`,
      cancelUrl: `${origin}/my-naia/plan-usage?checkout=cancelled`,
      existingProviderCustomerId: existing?.providerCustomerId ?? null,
      expiresAtUnixSeconds: Math.floor(reservation.expiresAt.getTime() / 1000),
    });
    await attachCheckoutSessionId(customer.id, session.id);
    return data({ ok: true, url: session.url });
  } catch (err) {
    // The Stripe call itself failed — nothing was reserved with Stripe, so
    // don't make the customer wait out the full TTL to try again.
    await releaseCheckoutReservation(customer.id);
    if (err instanceof StripeNotConfiguredError || err instanceof StripeLiveModeBlockedError) {
      return data({ ok: false, code: "billing_not_configured" }, { status: 503 });
    }
    return data({ ok: false, code: "provider_error" }, { status: 502 });
  }
}
