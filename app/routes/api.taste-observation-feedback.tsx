// app/routes/api.taste-observation-feedback.tsx
// POST — Customer feedback on a Style Tendency observation ("accurate" | "not-quite").
//
// Security contract:
//   - Client submits: tendencyId + feedback
//   - Server verifies ownership: StyleTendency.customerId === authenticated customer
//   - Server never trusts client-supplied state, claimText, or dimension
//   - "not-quite" permanently marks the generation as REJECTED (preserved for history)
//   - "accurate" records positive acknowledgement without state change

import { data, type ActionFunctionArgs } from "react-router";
import { getCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { applyTasteObservationFeedback } from "~/lib/ai/taste-reconcile.server";

const VALID_FEEDBACK = new Set(["accurate", "not-quite"]);

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

  const { tendencyId, feedback } = body as Record<string, unknown>;

  if (typeof tendencyId !== "string" || !tendencyId) {
    return data({ error: "tendencyId-required" }, { status: 400 });
  }
  if (typeof feedback !== "string" || !VALID_FEEDBACK.has(feedback)) {
    return data({ error: "feedback must be 'accurate' or 'not-quite'" }, { status: 400 });
  }

  const result = await applyTasteObservationFeedback(
    customer.id,
    tendencyId,
    feedback as "accurate" | "not-quite",
  );

  if (!result.ok) {
    if (result.errorCode === "NOT_FOUND")      return data({ error: "not-found" }, { status: 404 });
    if (result.errorCode === "ALREADY_REJECTED") return data({ error: "already-rejected" }, { status: 409 });
    return data({ error: "failed" }, { status: 500 });
  }

  return data({ ok: true });
}
