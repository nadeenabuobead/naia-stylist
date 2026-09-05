// app/routes/api.post-wear-review.tsx
// Phase 4B1 — API route for post-wear review (submit / load / delete).
//
// All requests require authenticated customer identity.
// POST body: { _intent, sessionId, ...PostWearAnswers }
//   _intent="submit" — upsert post-wear answers for the session
//   _intent="delete" — clear Phase 4B1 post-wear fields for the session
//
// GET ?sessionId= — load existing post-wear review for a session.
//
// Answer validation: unknown values for typed fields are stored as null (safe fallback).

import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { getCurrentNaiaCustomer } from "~/lib/naia-session.server";
import {
  upsertPostWearReview,
  loadPostWearReview,
  deletePostWearReview,
} from "~/lib/ai/feedback-persistence.server";
import type { PostWearAnswers, WoreItAnswer, FeelingAnswer, ComfortAnswer, WearAgainAnswer } from "~/lib/ai/feedback-contract";
import { emitPostWearSubmitted, recordJourneyEvent } from "~/lib/ai/journey-events.server";
import { extractPostWearEvidence } from "~/lib/ai/taste-extraction.server";
import { writeSourceEvidence } from "~/lib/ai/taste-reconcile.server";
import prisma from "~/db.server";

// ── Allowed answer values ─────────────────────────────────────────────────────

const WORE_IT_VALUES   = new Set<string>(["yes", "not-yet", "no"]);
const FEELING_VALUES   = new Set<string>(["great", "good", "okay", "not-great"]);
const COMFORT_VALUES   = new Set<string>(["yes", "mostly", "no"]);
const WEAR_AGAIN_VALUES = new Set<string>(["definitely", "maybe", "probably-not"]);

function parseAnswers(body: Record<string, unknown>): PostWearAnswers {
  const pick = <T,>(val: unknown, allowed: Set<string>): T | null =>
    typeof val === "string" && allowed.has(val) ? (val as T) : null;

  return {
    didWearIt:      pick<WoreItAnswer>(body.didWearIt, WORE_IT_VALUES),
    howDidYouFeel:  pick<FeelingAnswer>(body.howDidYouFeel, FEELING_VALUES),
    wasComfortable: pick<ComfortAnswer>(body.wasComfortable, COMFORT_VALUES),
    fitRight:       pick<ComfortAnswer>(body.fitRight, COMFORT_VALUES),
    coverageRight:  pick<ComfortAnswer>(body.coverageRight, COMFORT_VALUES),
    colourRight:    pick<ComfortAnswer>(body.colourRight, COMFORT_VALUES),
    wouldWearAgain: pick<WearAgainAnswer>(body.wouldWearAgain, WEAR_AGAIN_VALUES),
    note: typeof body.note === "string" ? body.note.slice(0, 500) : null,
  };
}

// ── Loader (GET) ──────────────────────────────────────────────────────────────

export async function loader({ request }: LoaderFunctionArgs) {
  const customer = await getCurrentNaiaCustomer(request);
  if (!customer) return data({ error: "unauthenticated" }, { status: 401 });

  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId");
  if (!sessionId) return data({ error: "sessionId required" }, { status: 400 });

  try {
    const review = await loadPostWearReview(sessionId, customer.id);
    return data({ review });
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

  const { _intent, sessionId } = body as Record<string, unknown>;
  if (typeof sessionId !== "string") return data({ error: "sessionId required" }, { status: 400 });

  if (_intent === "delete") {
    try {
      const result = await deletePostWearReview(sessionId, customer.id);
      if (!result.ok) return data({ error: result.errorCode ?? "not-found" }, { status: 404 });
      return data({ ok: true });
    } catch {
      return data({ error: "failed-to-delete" }, { status: 500 });
    }
  }

  // submit (default)
  const answers = parseAnswers(body as Record<string, unknown>);

  try {
    const result = await upsertPostWearReview(sessionId, customer.id, answers);
    if (!result.ok) return data({ error: result.errorCode ?? "failed" }, { status: 500 });

    // Taste evidence — load the saved review and extract evidence
    try {
      const savedReview = await prisma.postOutfitReview.findFirst({
        where: { sessionId, customerId: customer.id },
        include: { session: { select: { currentMood: true, occasion: true } } },
      });
      if (savedReview) {
        const evidenceRows = extractPostWearEvidence(savedReview, {
          currentMood: savedReview.session?.currentMood ?? null,
          occasion:    savedReview.session?.occasion    ?? null,
        });
        await writeSourceEvidence(customer.id, "POST_OUTFIT_REVIEW", savedReview.id, evidenceRows);
      }
    } catch (err) {
      console.error("taste-evidence: failed to write PostWear evidence", err);
    }

    // Fire-and-forget — never let event emission block the response
    try {
      const ev = emitPostWearSubmitted({
        customerId: customer.id,
        sessionId,
        didWearIt: answers.didWearIt as "yes" | "not-yet" | "no" | null,
        wouldWearAgain: answers.wouldWearAgain as "definitely" | "maybe" | "probably-not" | null,
      });
      recordJourneyEvent(ev);
    } catch { /* never let event emission block the response */ }

    return data({ ok: true });
  } catch {
    return data({ error: "failed-to-submit" }, { status: 500 });
  }
}
