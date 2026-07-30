// app/lib/ai/feedback-persistence.server.ts
// Phase 4B1 — Injectable DB operations for RecommendationFeedback and PostWearReview.
//
// Security contract:
//   - All write operations verify customerId ownership before mutating
//   - No raw provider response is ever stored
//   - reason codes and vtoAspects are validated before storage (unknown codes dropped)
//   - Migration: prisma/migrations/20260717200000_add_recommendation_feedback/migration.sql
//     NOT yet applied — do not call real Prisma fns until migration runs.

import prisma from "../../db.server.js";
import type { RecommendationFeedbackRecord, PostWearAnswers } from "./feedback-contract.js";

// ── Injectable function types ─────────────────────────────────────────────────

export type FindFeedbackByIdFn = (
  id: string,
  customerId: string,
) => Promise<RecommendationFeedbackRecord | null>;

export type CreateFeedbackFn = (
  customerId: string,
  data: Omit<RecommendationFeedbackRecord, "id" | "customerId" | "createdAt" | "updatedAt">,
) => Promise<RecommendationFeedbackRecord>;

export type UpdateFeedbackFn = (
  id: string,
  customerId: string,
  data: Partial<Pick<RecommendationFeedbackRecord, "rating" | "reasonCodes" | "vtoAspects" | "note">>,
) => Promise<RecommendationFeedbackRecord | null>;

export type DeleteFeedbackFn = (
  id: string,
  customerId: string,
) => Promise<{ ok: boolean; errorCode?: string }>;

export type LoadSessionFeedbackFn = (
  sessionId: string,
  customerId: string,
) => Promise<RecommendationFeedbackRecord[]>;

export type UpsertPostWearReviewFn = (
  sessionId: string,
  customerId: string,
  data: PostWearAnswers,
) => Promise<{ ok: boolean; errorCode?: string }>;

export type LoadPostWearReviewFn = (
  sessionId: string,
  customerId: string,
) => Promise<PostWearAnswers | null>;

export type DeletePostWearReviewFn = (
  sessionId: string,
  customerId: string,
) => Promise<{ ok: boolean; errorCode?: string }>;

export type LoadAllFeedbackFn = (
  customerId: string,
) => Promise<RecommendationFeedbackRecord[]>;

export type LoadAllPostWearFn = (
  customerId: string,
) => Promise<PostWearAnswers[]>;

// ── Real Prisma implementations ───────────────────────────────────────────────
// Requires the RecommendationFeedback migration to be applied.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

async function _findFeedbackById(id: string, customerId: string): Promise<RecommendationFeedbackRecord | null> {
  const r = await db.recommendationFeedback.findFirst({ where: { id, customerId } });
  return r ? _toRecord(r) : null;
}

async function _createFeedback(
  customerId: string,
  data: Omit<RecommendationFeedbackRecord, "id" | "customerId" | "createdAt" | "updatedAt">,
): Promise<RecommendationFeedbackRecord> {
  const r = await db.recommendationFeedback.create({
    data: { customerId, ...data },
  });
  return _toRecord(r);
}

async function _updateFeedback(
  id: string,
  customerId: string,
  data: Partial<Pick<RecommendationFeedbackRecord, "rating" | "reasonCodes" | "vtoAspects" | "note">>,
): Promise<RecommendationFeedbackRecord | null> {
  const existing = await db.recommendationFeedback.findFirst({ where: { id, customerId } });
  if (!existing) return null;
  const r = await db.recommendationFeedback.update({ where: { id }, data });
  return _toRecord(r);
}

async function _deleteFeedback(id: string, customerId: string): Promise<{ ok: boolean; errorCode?: string }> {
  const existing = await db.recommendationFeedback.findFirst({ where: { id, customerId } });
  if (!existing) return { ok: false, errorCode: "NOT_FOUND" };
  await db.recommendationFeedback.delete({ where: { id } });
  return { ok: true };
}

async function _loadSessionFeedback(
  sessionId: string,
  customerId: string,
): Promise<RecommendationFeedbackRecord[]> {
  const rows = await db.recommendationFeedback.findMany({
    where: { sessionId, customerId },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(_toRecord);
}

async function _upsertPostWearReview(
  sessionId: string,
  customerId: string,
  data: PostWearAnswers,
): Promise<{ ok: boolean; errorCode?: string }> {
  await db.postOutfitReview.upsert({
    where: { sessionId },
    create: {
      customerId,
      sessionId,
      didWearIt:      data.didWearIt,
      feelingAnswer:  data.howDidYouFeel,
      physicallyComfortable: data.wasComfortable,
      fitFeedback:    data.fitRight,
      coverageFeedback: data.coverageRight,
      colourFeedback: data.colourRight,
      wouldWearAgain: data.wouldWearAgain,
      additionalNotes: data.note,
    },
    update: {
      didWearIt:      data.didWearIt,
      feelingAnswer:  data.howDidYouFeel,
      physicallyComfortable: data.wasComfortable,
      fitFeedback:    data.fitRight,
      coverageFeedback: data.coverageRight,
      colourFeedback: data.colourRight,
      wouldWearAgain: data.wouldWearAgain,
      additionalNotes: data.note,
    },
  });
  return { ok: true };
}

async function _loadPostWearReview(sessionId: string, customerId: string): Promise<PostWearAnswers | null> {
  const r = await db.postOutfitReview.findFirst({ where: { sessionId, customerId } });
  if (!r) return null;
  return _toPostWearAnswers(r);
}

async function _deletePostWearReview(sessionId: string, customerId: string): Promise<{ ok: boolean; errorCode?: string }> {
  const existing = await db.postOutfitReview.findFirst({ where: { sessionId, customerId } });
  if (!existing) return { ok: false, errorCode: "NOT_FOUND" };
  // Reset only Phase 4B1 fields — preserve legacy PostOutfitReview fields
  await db.postOutfitReview.update({
    where: { id: existing.id },
    data: {
      didWearIt: null,
      feelingAnswer: null,
      physicallyComfortable: null,
      fitFeedback: null,
      coverageFeedback: null,
      colourFeedback: null,
      wouldWearAgain: null,
      additionalNotes: null,
    },
  });
  return { ok: true };
}

async function _loadAllFeedback(customerId: string): Promise<RecommendationFeedbackRecord[]> {
  const rows = await db.recommendationFeedback.findMany({
    where: { customerId },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(_toRecord);
}

async function _loadAllPostWear(customerId: string): Promise<PostWearAnswers[]> {
  const rows = await db.postOutfitReview.findMany({
    where: { customerId, didWearIt: { not: null } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(_toPostWearAnswers);
}

// ── Row mappers ───────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function _toRecord(r: any): RecommendationFeedbackRecord {
  return {
    id:              r.id,
    customerId:      r.customerId,
    sessionId:       r.sessionId   ?? null,
    suggestionId:    r.suggestionId ?? null,
    target:          r.target,
    shopifyProductId: r.shopifyProductId ?? null,
    closetItemId:    r.closetItemId  ?? null,
    rating:          r.rating,
    reasonCodes:     Array.isArray(r.reasonCodes)  ? r.reasonCodes  : [],
    vtoAspects:      Array.isArray(r.vtoAspects)   ? r.vtoAspects   : [],
    note:            r.note ?? null,
    createdAt:       r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
    updatedAt:       r.updatedAt instanceof Date ? r.updatedAt.toISOString() : r.updatedAt,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function _toPostWearAnswers(r: any): PostWearAnswers {
  return {
    didWearIt:      r.didWearIt      ?? null,
    howDidYouFeel:  r.feelingAnswer  ?? null,
    wasComfortable: r.physicallyComfortable ?? null,
    fitRight:       r.fitFeedback    ?? null,
    coverageRight:  r.coverageFeedback ?? null,
    colourRight:    r.colourFeedback ?? null,
    wouldWearAgain: r.wouldWearAgain ?? null,
    note:           r.additionalNotes ?? null,
  };
}

// ── Public operations ─────────────────────────────────────────────────────────

export async function createRecommendationFeedback(
  customerId: string,
  data: Omit<RecommendationFeedbackRecord, "id" | "customerId" | "createdAt" | "updatedAt">,
  _createFn: CreateFeedbackFn = _createFeedback,
): Promise<RecommendationFeedbackRecord> {
  return _createFn(customerId, data);
}

export async function updateRecommendationFeedback(
  id: string,
  customerId: string,
  data: Partial<Pick<RecommendationFeedbackRecord, "rating" | "reasonCodes" | "vtoAspects" | "note">>,
  _updateFn: UpdateFeedbackFn = _updateFeedback,
): Promise<{ ok: boolean; record?: RecommendationFeedbackRecord; errorCode?: string }> {
  const record = await _updateFn(id, customerId, data);
  if (!record) return { ok: false, errorCode: "NOT_FOUND" };
  return { ok: true, record };
}

export async function deleteRecommendationFeedback(
  id: string,
  customerId: string,
  _deleteFn: DeleteFeedbackFn = _deleteFeedback,
): Promise<{ ok: boolean; errorCode?: string }> {
  return _deleteFn(id, customerId);
}

export async function loadSessionFeedback(
  sessionId: string,
  customerId: string,
  _loadFn: LoadSessionFeedbackFn = _loadSessionFeedback,
): Promise<RecommendationFeedbackRecord[]> {
  return _loadFn(sessionId, customerId);
}

export async function upsertPostWearReview(
  sessionId: string,
  customerId: string,
  answers: PostWearAnswers,
  _upsertFn: UpsertPostWearReviewFn = _upsertPostWearReview,
): Promise<{ ok: boolean; errorCode?: string }> {
  return _upsertFn(sessionId, customerId, answers);
}

export async function loadPostWearReview(
  sessionId: string,
  customerId: string,
  _loadFn: LoadPostWearReviewFn = _loadPostWearReview,
): Promise<PostWearAnswers | null> {
  return _loadFn(sessionId, customerId);
}

export async function deletePostWearReview(
  sessionId: string,
  customerId: string,
  _deleteFn: DeletePostWearReviewFn = _deletePostWearReview,
): Promise<{ ok: boolean; errorCode?: string }> {
  return _deleteFn(sessionId, customerId);
}

export async function loadAllFeedbackForCustomer(
  customerId: string,
  _loadFn: LoadAllFeedbackFn = _loadAllFeedback,
): Promise<RecommendationFeedbackRecord[]> {
  return _loadFn(customerId);
}

export async function loadAllPostWearForCustomer(
  customerId: string,
  _loadFn: LoadAllPostWearFn = _loadAllPostWear,
): Promise<PostWearAnswers[]> {
  return _loadFn(customerId);
}
