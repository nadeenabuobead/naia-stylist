// app/routes/api.clerk-webhook.tsx
//
// Clerk account-sync webhook (fix/stripe-clerk-phase1-security, 2026-11-12).
//
// POST /api/clerk-webhook
//
// Minimum safe account-synchronization solution for the gap the Stripe &
// Clerk audit confirmed: no Clerk webhook existed anywhere in this codebase,
// so an out-of-band account change — a customer deleting their Clerk
// account directly (not through nAia's own Settings page), or an admin
// action in the Clerk Dashboard — never reached the Customer table. A
// deleted-at-Clerk identity would keep a stale clerkUserId/email
// indefinitely, with nothing ever noticing the drift.
//
// Security contract:
//   - NOT customer-session-authenticated — the caller is Clerk itself.
//     Authenticity is established entirely by Svix signature verification
//     (clerk-webhook-verify.server.ts) against the raw request body.
//   - Reads request.text(), never request.json() — same reason as the
//     Stripe webhook route: signature verification needs the exact bytes
//     Clerk/Svix signed, which a parse-then-reserialize round-trip does not
//     reliably reproduce.
//   - Handles user.deleted only, for now — the single event this gap
//     analysis requires closing (an out-of-band DELETION is the scenario
//     with real consequences; see the header above). Reuses
//     eraseCustomerData — the SAME function Settings' self-service deletion
//     and the Shopify GDPR webhooks all call — rather than duplicating
//     anonymization/billing-cancellation logic a second time. Other event
//     types (user.updated, email changes, etc.) are deliberately NOT
//     handled yet: a real but smaller, lower-urgency gap, left for a
//     separate follow-up rather than silently expanding this phase's scope.
//   - Idempotent via the same ProcessedWebhookEvent ledger the Stripe
//     webhook uses (provider: "clerk") — that model was designed from the
//     start with no FK to Customer and a provider column specifically so it
//     could serve more than one provider's webhooks.
//   - Returns 400 on a bad/missing signature. Returns 200 on anything
//     processed or deliberately ignored (an unhandled event type) — Svix
//     should not retry those. Returns 500 only on a genuine processing
//     failure, so Svix's own retry schedule gets a chance.
//   - Requires CLERK_WEBHOOK_SECRET — not configured in any environment as
//     of this phase (Phase 2 infra task); this route fails closed (500
//     not_configured) rather than silently accepting unverifiable requests.

import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import prisma from "~/db.server";
import { verifyClerkWebhookSignature } from "~/lib/clerk-webhook-verify.server";
import { eraseCustomerData } from "~/lib/customer-privacy.server";

export async function loader() {
  return data({ error: "method_not_allowed" }, { status: 405 });
}

interface ClerkWebhookEvent {
  type: string;
  data?: { id?: string; [key: string]: unknown };
}

export async function action({ request }: ActionFunctionArgs) {
  const webhookSecret = process.env.CLERK_WEBHOOK_SECRET;
  if (!webhookSecret) {
    // Fail loudly in our own logs, not silently — a missing secret means
    // every webhook delivery would otherwise be unverifiable.
    return data({ ok: false, code: "not_configured" }, { status: 500 });
  }

  const rawBody = await request.text();
  const verification = verifyClerkWebhookSignature(
    rawBody,
    {
      svixId: request.headers.get("svix-id"),
      svixTimestamp: request.headers.get("svix-timestamp"),
      svixSignature: request.headers.get("svix-signature"),
    },
    webhookSecret,
  );
  if (!verification.ok) {
    return data({ ok: false, code: verification.reason }, { status: 400 });
  }

  let event: ClerkWebhookEvent;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return data({ ok: false, code: "malformed_json" }, { status: 400 });
  }

  // svix-id doubles as Svix's own stable event identifier — already
  // confirmed present by verification above (missing_svix_headers would
  // have returned 400), re-read here only because TypeScript can't see
  // across that earlier check.
  const providerEventId = request.headers.get("svix-id");
  if (!providerEventId) {
    return data({ ok: false, code: "missing_event_id" }, { status: 400 });
  }

  const already = await prisma.processedWebhookEvent.findUnique({
    where: { provider_providerEventId: { provider: "clerk", providerEventId } },
    select: { id: true },
  });
  if (already) {
    return data({ ok: true, deduped: true });
  }

  const clerkUserId = typeof event.data?.id === "string" ? event.data.id : null;
  let resolvedCustomerId: string | null = null;

  try {
    if (event.type === "user.deleted" && clerkUserId) {
      const customer = await prisma.customer.findUnique({ where: { clerkUserId }, select: { id: true } });
      if (customer) {
        resolvedCustomerId = customer.id;
        await eraseCustomerData(customer.id, {}, "clerk-webhook-user-deleted");
      }
      // No matching Customer row — already erased (e.g. this is itself a
      // redelivery, or the erasure ran via Settings first) or a Clerk user
      // that never completed identity-linking. Nothing to do, not an error.
    }
    // Any other event type is deliberately ignored — see the module header.

    await prisma.processedWebhookEvent.create({
      data: {
        provider: "clerk",
        providerEventId,
        eventType: event.type,
        // Clerk's webhook payload does not guarantee a top-level event-
        // creation timestamp the way Stripe's event.created does — webhook
        // receipt time is the honest value available here.
        eventCreatedAt: new Date(),
        customerId: resolvedCustomerId,
        payload: event,
      },
    });

    return data({ ok: true });
  } catch {
    return data({ ok: false, code: "processing_error" }, { status: 500 });
  }
}
