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
import { captureFailure, captureError } from "~/lib/error-tracking.server";

// Logs only Stripe's own structural event metadata (id, type — opaque,
// non-financial) plus a classified reason/error name — never event.data
// (the actual Subscription/Invoice/CheckoutSession payload, which carries
// payment and customer detail), never the raw request body, never the
// webhook secret. Same contract as fashn-try-on.server.ts's
// logFashnFailure — the established pattern for this error-capture seam.
function logStripeWebhookFailure(context: string, reason: string, event: StripeEventLike): void {
  captureFailure(`stripe-webhook:${context}`, reason, {
    eventId: event.id,
    eventType: event.type,
  });
}

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

  // Defense-in-depth: this app's STRIPE_SECRET_KEY is structurally
  // restricted to test mode (assertTestModeKey, stripe-client.server.ts),
  // but nothing on the INBOUND side enforced the same thing — Stripe issues
  // a distinct whsec_ secret per mode, so a live event failing signature
  // verification here is the current, incidental protection, not a
  // structural one. event.livemode is Stripe's own authoritative signal for
  // which mode produced this event; refusing it explicitly means mode
  // isolation on this endpoint no longer depends only on which whsec_
  // happens to be configured.
  if (event.livemode === true) {
    return data({ ok: false, code: "live_mode_event_rejected" }, { status: 400 });
  }

  try {
    const result = await processStripeWebhookEvent(event);
    if (!result.ok) {
      logStripeWebhookFailure("classified-failure", result.reason, event);
      return data({ ok: false, code: result.reason }, { status: 500 });
    }
    return data({ ok: true });
  } catch (err) {
    // Unexpected exception, not one of processStripeWebhookEvent's own
    // classified ProcessResult failures — captureError extracts only
    // .name/.message (truncated), never the full error object, so nothing
    // from `event.data` ever reaches it even if it somehow ended up inside
    // the error (e.g. a stack trace interpolating a value) — only Stripe's
    // own structural id/type are passed as meta, same as the branch above.
    captureError("stripe-webhook:unhandled-exception", err, {
      eventId: event.id,
      eventType: event.type,
    });
    return data({ ok: false, code: "processing_error" }, { status: 500 });
  }
}
