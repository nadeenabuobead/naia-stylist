// app/routes/api.billing-portal.tsx
// Phase 3 — Customer billing management: cancellation, payment method
// update, and invoice history, all delegated to Stripe's own hosted
// Billing Portal rather than a hand-built UI for each of those flows.
//
// POST /api/billing-portal
//
// Security contract:
//   - Customer identity from the authenticated session only.
//   - The customer's own Subscription row is looked up server-side to find
//     providerCustomerId — a client can never supply or influence which
//     Stripe customer the portal session is scoped to.
//   - No subscription mutation happens in this route. Cancellation itself
//     happens inside Stripe's hosted portal; the resulting state change
//     reaches us only via the webhook handler (customer.subscription.
//     updated/.deleted), exactly like every other subscription-state
//     change in this system.

import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { getCurrentNaiaCustomer } from "~/lib/naia-session.server";
import prisma from "~/db.server";
import { createBillingPortalSession, StripeNotConfiguredError, StripeLiveModeBlockedError } from "~/lib/billing/stripe-client.server";

function authRequired() {
  return data({ ok: false, code: "auth_required" }, { status: 401 });
}

export async function loader() {
  return data({ error: "method_not_allowed" }, { status: 405 });
}

export async function action({ request }: ActionFunctionArgs) {
  const customer = await getCurrentNaiaCustomer(request);
  if (!customer) return authRequired();

  const subscription = await prisma.subscription.findFirst({
    where: { customerId: customer.id },
    orderBy: { createdAt: "desc" },
    select: { providerCustomerId: true },
  });

  if (!subscription?.providerCustomerId) {
    return data({ ok: false, code: "no_billing_account" }, { status: 404 });
  }

  const origin = new URL(request.url).origin;

  try {
    const session = await createBillingPortalSession({
      providerCustomerId: subscription.providerCustomerId,
      returnUrl: `${origin}/my-naia/plan-usage`,
    });
    return data({ ok: true, url: session.url });
  } catch (err) {
    if (err instanceof StripeNotConfiguredError || err instanceof StripeLiveModeBlockedError) {
      return data({ ok: false, code: "billing_not_configured" }, { status: 503 });
    }
    return data({ ok: false, code: "provider_error" }, { status: 502 });
  }
}
