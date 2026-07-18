// app/lib/ai/journey-events.server.ts
// Phase 4B3 — Privacy-safe event emitters for Designer Intelligence.
//
// All events hash the customerId before inclusion — the raw customerId never
// appears in any event payload. No customer names, emails, selfie photos,
// closet images, model photos, raw feedback notes, signed URLs, or private
// asset IDs are ever included.
//
// Events are operational records — Designer Intelligence aggregates them.
// One event per action: session_started, recommendation_served, feedback_given,
// vto_initiated, vto_feedback_given, post_wear_submitted.

import { createHash } from "node:crypto";
import type { JourneyEvent, JourneyEventType } from "./journey-contract.js";
import prisma from "../../db.server.js";

export type { JourneyEvent };

// ── Event recording hook ──────────────────────────────────────────────────────
// Fire-and-forget DB write. If the JourneyEvent table is absent (migration not
// yet applied) or any DB error occurs, degrades gracefully to dev-logging.
// Returns void immediately — the DB write is async and never blocks the caller.

export function recordJourneyEvent(event: JourneyEvent): void {
  // Outer try/catch covers synchronous errors (e.g. Prisma not initialised in test env).
  // Inner .catch covers async errors (DB unavailable, migration pending).
  try {
    void (prisma as any).journeyEvent.create({
      data: {
        type: event.type,
        occurredAt: new Date(event.occurredAt),
        customerIdHash: event.customerIdHash,
        sessionId: event.sessionId,
        payload: event.payload as any,
      },
    }).catch(() => {
      // JourneyEvent table unavailable (migration pending) or DB error — degrade to dev-log
      if (process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.log("[journey-event]", event.type, event.customerIdHash, event.sessionId);
      }
    });
  } catch {
    // Synchronous init error (e.g. Prisma client not yet available) — degrade to dev-log
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.log("[journey-event]", event.type, event.customerIdHash, event.sessionId);
    }
  }
}

// ── Customer ID hashing ───────────────────────────────────────────────────────
// SHA-256, first 12 hex chars — stable for aggregation, not reversible.
// Used on every event emission — the raw customerId must never leave this module.

export function hashCustomerId(customerId: string): string {
  return createHash("sha256").update(customerId).digest("hex").slice(0, 12);
}

// ── Event builder ─────────────────────────────────────────────────────────────

function makeEvent(
  type: JourneyEventType,
  customerId: string,
  sessionId: string,
  payload: Record<string, unknown>,
  nowFn: () => string = () => new Date().toISOString(),
): JourneyEvent {
  return {
    type,
    occurredAt: nowFn(),
    customerIdHash: hashCustomerId(customerId),
    sessionId,
    payload,
  };
}

// ── session_started ───────────────────────────────────────────────────────────
// Emitted when StyleMe begins for a customer.
// Captures feature context (booleans and counts only — no PII).

export function emitSessionStarted(params: {
  customerId: string;
  sessionId: string;
  occasion: string;
  source: "naia-piece" | "my-closet" | "both";
  hasSelfieGuidance: boolean;
  closetItemCount: number;        // aggregate count only
  hasEligibleClosetItem: boolean;
  naiaModelIsReady: boolean;
  nowFn?: () => string;
}): JourneyEvent {
  return makeEvent(
    "session_started",
    params.customerId,
    params.sessionId,
    {
      occasion: params.occasion,
      source: params.source,
      hasSelfieGuidance: params.hasSelfieGuidance,
      closetItemCount: params.closetItemCount,
      hasEligibleClosetItem: params.hasEligibleClosetItem,
      naiaModelIsReady: params.naiaModelIsReady,
    },
    params.nowFn,
  );
}

// ── recommendation_served ─────────────────────────────────────────────────────
// Emitted when a StyleMe result is delivered.
// Includes catalog handles (not customer data) and outcome type.

export function emitRecommendationServed(params: {
  customerId: string;
  sessionId: string;
  outcome: "nadine-recommendation" | "closet-led" | "no-eligible-product";
  primaryHandle: string | null;   // catalog handle — not customer data
  alternativeCount: number;
  nowFn?: () => string;
}): JourneyEvent {
  return makeEvent(
    "recommendation_served",
    params.customerId,
    params.sessionId,
    {
      outcome: params.outcome,
      primaryHandle: params.primaryHandle,
      alternativeCount: params.alternativeCount,
    },
    params.nowFn,
  );
}

// ── feedback_given ────────────────────────────────────────────────────────────
// Emitted when a customer submits immediate recommendation feedback.
// Includes rating and whether a note was given — NO reason codes, NO note text.

export function emitFeedbackGiven(params: {
  customerId: string;
  sessionId: string;
  target: "complete-suggestion" | "closet-item" | "nadine-product" | "vto-preview";
  rating: "love" | "okay" | "not-for-me";
  hasNote: boolean;  // true/false only — no note text
  nowFn?: () => string;
}): JourneyEvent {
  return makeEvent(
    "feedback_given",
    params.customerId,
    params.sessionId,
    {
      target: params.target,
      rating: params.rating,
      hasNote: params.hasNote,
      // reason codes intentionally excluded — too close to qualitative customer voice
    },
    params.nowFn,
  );
}

// ── vto_initiated ─────────────────────────────────────────────────────────────
// Emitted when a customer starts a virtual try-on.
// Includes catalog handle and entry point — no customer photos, no signed URLs.

export function emitVtoInitiated(params: {
  customerId: string;
  sessionId: string;
  entryPoint:
    | "styleme-single-piece"
    | "styleme-complete-look"
    | "product-page"
    | "closet-combination"
    | "complete-look-preview";
  productHandle: string;  // catalog handle — not customer data
  nowFn?: () => string;
}): JourneyEvent {
  return makeEvent(
    "vto_initiated",
    params.customerId,
    params.sessionId,
    {
      entryPoint: params.entryPoint,
      productHandle: params.productHandle,
    },
    params.nowFn,
  );
}

// ── vto_feedback_given ────────────────────────────────────────────────────────
// Emitted when a customer gives feedback on a virtual try-on preview.
// Only structural signals — no raw text, no photos, no job IDs.

export function emitVtoFeedbackGiven(params: {
  customerId: string;
  sessionId: string;
  hadFidelityConcern: boolean;       // garment/colour/layering/accessory inaccuracy
  usefulDespiteDifferences: boolean;
  wouldTryInPerson: boolean;
  nowFn?: () => string;
}): JourneyEvent {
  return makeEvent(
    "vto_feedback_given",
    params.customerId,
    params.sessionId,
    {
      hadFidelityConcern: params.hadFidelityConcern,
      usefulDespiteDifferences: params.usefulDespiteDifferences,
      wouldTryInPerson: params.wouldTryInPerson,
    },
    params.nowFn,
  );
}

// ── post_wear_submitted ───────────────────────────────────────────────────────
// Emitted when a customer submits a post-wear review.
// Includes structured answers only — NO free-text note.

export function emitPostWearSubmitted(params: {
  customerId: string;
  sessionId: string;
  didWearIt: "yes" | "not-yet" | "no" | null;
  wouldWearAgain: "definitely" | "maybe" | "probably-not" | null;
  // howDidYouFeel and free-text note are intentionally excluded
  nowFn?: () => string;
}): JourneyEvent {
  return makeEvent(
    "post_wear_submitted",
    params.customerId,
    params.sessionId,
    {
      didWearIt: params.didWearIt,
      wouldWearAgain: params.wouldWearAgain,
    },
    params.nowFn,
  );
}

// ── product_intelligence_viewed ───────────────────────────────────────────────
// Emitted when an authenticated customer views NADINE product intelligence.
// Catalog handle and aggregate counts only — no assessment text, no customer
// profile data, no closet item IDs or signed URLs.

export function emitProductIntelligenceViewed(params: {
  customerId: string;
  productHandle: string;      // catalog handle — not customer data
  resolved: boolean;          // intelligence was available for this product
  closetItemCount: number;    // aggregate count only — no item IDs
  hasModel: boolean;
  nowFn?: () => string;
}): JourneyEvent {
  return makeEvent(
    "product_intelligence_viewed",
    params.customerId,
    "product-page",            // sentinel — product page views have no StylingSession
    {
      productHandle: params.productHandle,
      resolved: params.resolved,
      closetItemCount: params.closetItemCount,
      hasModel: params.hasModel,
    },
    params.nowFn,
  );
}
