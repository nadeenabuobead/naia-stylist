// app/routes/api.stripe-webhook.tsx
// Phase 3 — Stripe webhook endpoint.
//
// POST /api/stripe-webhook
//
// Security contract:
//   - NOT customer-session-authenticated — the caller is Stripe itself, not
//     a logged-in customer. Authenticity is established entirely by the
//     Stripe-Signature header, verified against the raw request body.
//   - Reads request.text() (raw bytes as a string), never request.json() —
//     signature verification requires the exact bytes Stripe signed; a
//     parse-then-reserialize round-trip is not guaranteed byte-identical.
//   - Returns 400 on a bad/missing signature (malformed or forged request —
//     Stripe will not retry a 4xx). Returns 200 on anything this handler
//     successfully processed OR deliberately ignored (e.g. an event type we
//     don't act on, or a stale out-of-order redelivery) — Stripe should not
//     retry those either. Returns 500 only on a genuine processing failure,
//     so Stripe's own retry schedule gets a chance to redeliver.

import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { verifyStripeSignature } from "~/lib/billing/webhook-verify.server";
import { processStripeWebhookEvent, type StripeEventLike } from "~/lib/billing/webhook-handler.server";

export async function loader() {
  return data({ error: "method_not_allowed" }, { status: 405 });
}

export async function action({ request }: ActionFunctionArgs) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    // Fail loudly in our own logs, not silently — a missing secret means
    // every webhook would otherwise be unverifiable.
    return data({ ok: false, code: "not_configured" }, { status: 500 });
  }

  const rawBody = await request.text();
  const signatureHeader = request.headers.get("stripe-signature");
  const verification = verifyStripeSignature(rawBody, signatureHeader, webhookSecret);
  if (!verification.ok) {
    return data({ ok: false, code: verification.reason }, { status: 400 });
  }

  let event: StripeEventLike;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return data({ ok: false, code: "malformed_json" }, { status: 400 });
  }

  try {
    const result = await processStripeWebhookEvent(event);
    if (!result.ok) {
      return data({ ok: false, code: result.reason }, { status: 500 });
    }
    return data({ ok: true });
  } catch {
    return data({ ok: false, code: "processing_error" }, { status: 500 });
  }
}
