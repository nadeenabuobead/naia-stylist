// app/routes/api.recommendation-feedback.tsx
// Phase 4B1 — API route for immediate recommendation feedback (create / update / delete).
//
// All requests require authenticated customer identity.
// Intents (POST body field "_intent"):
//   "create" — new feedback for a suggestion or product
//   "update" — edit existing feedback by id (ownership verified)
//   "delete" — remove feedback by id (ownership verified)
//
// Security: reason codes and vtoAspects are sanitised server-side; unknown codes dropped.
// Response: JSON — never exposes raw DB records or internal IDs beyond the feedback id.

import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { getCurrentNaiaCustomer } from "~/lib/naia-session.server";
import {
  isValidRating,
  isValidTarget,
  sanitiseReasonCodes,
  sanitiseVtoAspects,
} from "~/lib/ai/feedback-signal.server";
import {
  createRecommendationFeedback,
  updateRecommendationFeedback,
  deleteRecommendationFeedback,
  loadSessionFeedback,
} from "~/lib/ai/feedback-persistence.server";
import { emitFeedbackGiven, emitVtoFeedbackGiven, recordJourneyEvent } from "~/lib/ai/journey-events.server";

// ── Loader (GET) ──────────────────────────────────────────────────────────────
// Returns all feedback for a session. Requires ?sessionId query param.

export async function loader({ request }: ActionFunctionArgs) {
  const customer = await getCurrentNaiaCustomer(request);
  if (!customer) return data({ error: "unauthenticated" }, { status: 401 });

  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId");
  if (!sessionId) return data({ error: "sessionId required" }, { status: 400 });

  try {
    const feedback = await loadSessionFeedback(sessionId, customer.id);
    return data({ feedback });
  } catch {
    return data({ error: "failed-to-load" }, { status: 500 });
  }
}

// ── Action (POST) ─────────────────────────────────────────────────────────────

export async function action({ request }: ActionFunctionArgs) {
  const customer = await getCurrentNaiaCustomer(request);
  if (!customer) return data({ error: "unauthenticated" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return data({ error: "invalid-body" }, { status: 400 });
  }

  const intent = (body as Record<string, unknown>)._intent;

  // ── delete ────────────────────────────────────────────────────────────────

  if (intent === "delete") {
    const { id } = body as { id?: unknown };
    if (typeof id !== "string") return data({ error: "id required" }, { status: 400 });

    try {
      const result = await deleteRecommendationFeedback(id, customer.id);
      if (!result.ok) return data({ error: result.errorCode ?? "not-found" }, { status: 404 });
      return data({ ok: true });
    } catch {
      return data({ error: "failed-to-delete" }, { status: 500 });
    }
  }

  // ── update ────────────────────────────────────────────────────────────────

  if (intent === "update") {
    const { id, rating, reasonCodes, vtoAspects, note } = body as Record<string, unknown>;
    if (typeof id !== "string") return data({ error: "id required" }, { status: 400 });

    const updateData: Parameters<typeof updateRecommendationFeedback>[2] = {};
    if (rating !== undefined) {
      if (!isValidRating(rating)) return data({ error: "invalid-rating" }, { status: 400 });
      updateData.rating = rating;
    }
    if (reasonCodes !== undefined) updateData.reasonCodes = sanitiseReasonCodes(reasonCodes);
    if (vtoAspects !== undefined)  updateData.vtoAspects  = sanitiseVtoAspects(vtoAspects);
    if (note !== undefined)        updateData.note = typeof note === "string" ? note.slice(0, 500) : null;

    try {
      const result = await updateRecommendationFeedback(id, customer.id, updateData);
      if (!result.ok) return data({ error: result.errorCode ?? "not-found" }, { status: 404 });
      return data({ ok: true, feedback: result.record });
    } catch {
      return data({ error: "failed-to-update" }, { status: 500 });
    }
  }

  // ── create (default) ──────────────────────────────────────────────────────

  const {
    sessionId, suggestionId, target, shopifyProductId, closetItemId,
    rating, reasonCodes, vtoAspects, note,
  } = body as Record<string, unknown>;

  if (!isValidTarget(target)) return data({ error: "invalid-target" }, { status: 400 });
  if (!isValidRating(rating)) return data({ error: "invalid-rating" }, { status: 400 });

  const sanitisedReasons = sanitiseReasonCodes(reasonCodes);
  const sanitisedVto     = sanitiseVtoAspects(vtoAspects);
  const safeNote = typeof note === "string" ? note.slice(0, 500) : null;

  try {
    const feedback = await createRecommendationFeedback(customer.id, {
      sessionId:       typeof sessionId    === "string" ? sessionId    : null,
      suggestionId:    typeof suggestionId === "string" ? suggestionId : null,
      closetItemId:    typeof closetItemId === "string" ? closetItemId : null,
      shopifyProductId: typeof shopifyProductId === "string" ? shopifyProductId : null,
      target,
      rating,
      reasonCodes: sanitisedReasons,
      vtoAspects:  sanitisedVto,
      note:        safeNote,
    });

    // Fire-and-forget — never let event emission block the response
    try {
      const ev = emitFeedbackGiven({
        customerId: customer.id,
        sessionId: typeof sessionId === "string" ? sessionId : "unknown",
        target: target as "complete-suggestion" | "closet-item" | "nadine-product" | "vto-preview",
        rating: rating as "love" | "okay" | "not-for-me",
        hasNote: typeof safeNote === "string" && safeNote.length > 0,
      });
      recordJourneyEvent(ev);
    } catch { /* never let event emission block the response */ }

    // Fire-and-forget VTO-specific fidelity event — only for vto-preview target
    if (target === "vto-preview") {
      try {
        const FIDELITY_ASPECTS = new Set(["garment-looks-inaccurate", "layering-looks-inaccurate", "colour-looks-inaccurate", "accessory-placement-inaccurate"]);
        const vtoEv = emitVtoFeedbackGiven({
          customerId: customer.id,
          sessionId: typeof sessionId === "string" ? sessionId : "unknown",
          hadFidelityConcern: sanitisedVto.some((a) => FIDELITY_ASPECTS.has(a)),
          usefulDespiteDifferences: sanitisedVto.includes("useful-despite-differences"),
          wouldTryInPerson: (rating as string) !== "not-for-me",
        });
        recordJourneyEvent(vtoEv);
      } catch { /* never let event emission block the response */ }
    }

    return data({ ok: true, feedback }, { status: 201 });
  } catch {
    return data({ error: "failed-to-create" }, { status: 500 });
  }
}
