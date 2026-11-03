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

import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { getCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { MEMBERSHIP_PRICING } from "~/lib/plan/plan-limits.server";
import { createCheckoutSession, StripeNotConfiguredError, StripeLiveModeBlockedError } from "~/lib/billing/stripe-client.server";

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
    });
    return data({ ok: true, url: session.url });
  } catch (err) {
    if (err instanceof StripeNotConfiguredError || err instanceof StripeLiveModeBlockedError) {
      return data({ ok: false, code: "billing_not_configured" }, { status: 503 });
    }
    return data({ ok: false, code: "provider_error" }, { status: 502 });
  }
}
