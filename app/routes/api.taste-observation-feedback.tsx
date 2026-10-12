// app/routes/api.taste-observation-feedback.tsx
// POST — Customer feedback on a Style Tendency observation ("accurate" | "not-quite").
//
// Security contract:
//   - Client submits: tendencyId + feedback (+ optional notQuiteReason/notQuiteNote)
//   - Server verifies ownership: StyleTendency.customerId === authenticated customer
//   - Server never trusts client-supplied state, claimText, or dimension
//   - "not-quite" permanently marks the generation as REJECTED (preserved for history)
//   - "accurate" records positive acknowledgement without state change
//
// notQuiteReason/notQuiteNote (V1 Noticing UX — inline "What feels off?"
// form) are optional, only accepted alongside feedback="not-quite",
// validated server-side against the fixed reason vocabulary and a length
// cap. Customer feedback context only — never structured Taste evidence,
// never read by reconcileObservations, never used to rewrite any other
// stored answer.

import { data, type ActionFunctionArgs } from "react-router";
import { getCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { applyTasteObservationFeedback } from "~/lib/ai/taste-reconcile.server";
import { NOT_QUITE_REASONS } from "~/lib/ai/taste-feedback-engine";

const VALID_FEEDBACK = new Set(["accurate", "not-quite"]);
const VALID_NOT_QUITE_REASONS = new Set<string>(NOT_QUITE_REASONS);

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return data({ error: "method-not-allowed" }, { status: 405 });
  }

  const customer = await getCurrentNaiaCustomer(request);
  if (!customer) {
    return data({ error: "unauthenticated" }, { status: 401 });
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return data({ error: "invalid-json" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return data({ error: "invalid-body" }, { status: 400 });
  }

  const { tendencyId, feedback, notQuiteReason, notQuiteNote } = body as Record<string, unknown>;

  if (typeof tendencyId !== "string" || !tendencyId) {
    return data({ error: "tendencyId-required" }, { status: 400 });
  }
  if (typeof feedback !== "string" || !VALID_FEEDBACK.has(feedback)) {
    return data({ error: "feedback must be 'accurate' or 'not-quite'" }, { status: 400 });
  }

  // Only meaningful (and only ever sent by the client) for "not-quite" —
  // silently ignored for "accurate", never a validation error, since an
  // "accurate" submission has no reason to carry either field.
  const reason = feedback === "not-quite" && typeof notQuiteReason === "string" && VALID_NOT_QUITE_REASONS.has(notQuiteReason)
    ? notQuiteReason
    : null;
  const note = feedback === "not-quite" && typeof notQuiteNote === "string" ? notQuiteNote : null;

  const result = await applyTasteObservationFeedback(
    customer.id,
    tendencyId,
    feedback as "accurate" | "not-quite",
    { reason, note },
  );

  if (!result.ok) {
    if (result.errorCode === "NOT_FOUND")      return data({ error: "not-found" }, { status: 404 });
    if (result.errorCode === "ALREADY_REJECTED") return data({ error: "already-rejected" }, { status: 409 });
    return data({ error: "failed" }, { status: 500 });
  }

  // Echo back the server-validated feedback value that was actually
  // persisted. The calling page reads this (not the submitted request
  // payload) as its durable proof of what succeeded — see
  // resolveSavedFeedback and its own comment for why: fetcher.json is
  // cleared once the fetcher returns to idle, but fetcher.data (this
  // response) is not.
  return data({ ok: true, feedback: feedback as "accurate" | "not-quite" });
}
