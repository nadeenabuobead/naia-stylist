// app/lib/ai/journey-context.server.ts
// Phase 4B3 — Assembles CustomerJourneyContext from live DB.
//
// Always-live sources (no migration guard needed):
//   NaiaModel, ClosetItem, StylingSession, Customer
//
// Migration-guarded sources (Phase 4A8 / 4B1 — tables may not exist yet):
//   SelfieAnalysis (Phase 4A8)
//   RecommendationFeedback (Phase 4B1)
//   PostOutfitReview new columns: didWearIt, feelingAnswer (Phase 4B1)
//
// All DB functions are injectable so tests can verify each scenario
// without a live database.

import prisma from "../../db.server.js";
import { isMigrationError } from "./designer-intelligence.server.js";
import { computeModelReadinessFromRecord } from "./my-naia-model.server.js";
import { VIRTUAL_TRY_ON_ENABLED } from "./naia-product-media.js";
import type { StyleMeProfileSignals } from "./styleme-recommendation.types.js";
import type {
  CustomerJourneyContext,
  SelfieSignalSummary,
  FeedbackSignalContext,
  MigrationStatus,
} from "./journey-contract.js";
import {
  aggregateClosetSummary,
  buildSelfieSignalSummary,
  buildFeedbackSignalContext,
  computeFeatureAvailability,
  emptyClosetSummary,
  emptyFeedbackContext,
  emptyMigrationStatus,
} from "./journey-contract.js";

// ── Injectable DB function types ──────────────────────────────────────────────

export type FindSelfieAnalysisFn = (customerId: string) => Promise<{
  analysisStatus: string;
  colourFamilies: string[];
  suggestedNecklines: string[];
  contrastLevel: string;
  overallNote: string;
} | null>;

export type FindClosetItemsFn = (customerId: string) => Promise<Array<{
  category: string;
  tryOnEligibility: string | null;
}>>;

export type FindFeedbackRecordsFn = (customerId: string) => Promise<Array<{
  rating: string;
  reasonCodes: string[];
}>>;

export type FindPostWearRateFn = (customerId: string) => Promise<{
  positiveRate: number | null;
}>;

export type FindNaiaModelFn = (customerId: string) => Promise<{
  facePublicId: string | null;
  bodyPublicId: string | null;
  saveModelConsentAt: Date | null;
} | null>;

// ── Real Prisma implementations ───────────────────────────────────────────────

async function _findSelfieAnalysis(customerId: string) {
  return (prisma as any).selfieAnalysis.findUnique({
    where: { customerId },
    select: {
      analysisStatus: true,
      colourFamilies: true,
      suggestedNecklines: true,
      contrastLevel: true,
      overallNote: true,
    },
  });
}

async function _findClosetItems(customerId: string) {
  return prisma.closetItem.findMany({
    where: { customerId },
    select: { category: true, tryOnEligibility: true },
  });
}

async function _findFeedbackRecords(customerId: string) {
  return (prisma as any).recommendationFeedback.findMany({
    where: { customerId },
    select: { rating: true, reasonCodes: true },
  });
}

async function _findPostWearRate(customerId: string): Promise<{ positiveRate: number | null }> {
  const rows = await prisma.postOutfitReview.findMany({
    where: { customerId },
    select: { didWearIt: true, wouldWearAgain: true } as any,
  });

  if (!rows || rows.length < 3) return { positiveRate: null };

  const withDidWearIt = rows.filter((r: any) => r.didWearIt != null);
  if (withDidWearIt.length < 3) return { positiveRate: null };

  const positiveCount = withDidWearIt.filter((r: any) => r.didWearIt === "yes").length;
  return { positiveRate: positiveCount / withDidWearIt.length };
}

async function _findNaiaModel(customerId: string) {
  return prisma.naiaModel.findUnique({
    where: { customerId },
    select: {
      facePublicId: true,
      bodyPublicId: true,
      saveModelConsentAt: true,
    },
  });
}

// ── Assembly ──────────────────────────────────────────────────────────────────

export async function buildCustomerJourneyContext(
  customerId: string,
  deps?: {
    findSelfie?: FindSelfieAnalysisFn;
    findClosetItems?: FindClosetItemsFn;
    findFeedback?: FindFeedbackRecordsFn;
    findPostWearRate?: FindPostWearRateFn;
    findNaiaModel?: FindNaiaModelFn;
    virtualTryOnEnabled?: boolean;
  },
): Promise<CustomerJourneyContext> {
  const findSelfie = deps?.findSelfie ?? _findSelfieAnalysis;
  const findClosetItems = deps?.findClosetItems ?? _findClosetItems;
  const findFeedback = deps?.findFeedback ?? _findFeedbackRecords;
  const findPostWearRate = deps?.findPostWearRate ?? _findPostWearRate;
  const findNaiaModel = deps?.findNaiaModel ?? _findNaiaModel;
  const vtoEnabled = deps?.virtualTryOnEnabled ?? VIRTUAL_TRY_ON_ENABLED;

  const migrationStatus: MigrationStatus = { ...emptyMigrationStatus() };

  // ── Always-live: closet items + naia model (parallel) ────────────────────
  const [rawClosetItems, rawModel] = await Promise.all([
    findClosetItems(customerId).catch(() => [] as Array<{ category: string; tryOnEligibility: string | null }>),
    findNaiaModel(customerId).catch(() => null),
  ]);

  const closetSummary = aggregateClosetSummary(rawClosetItems);
  const naiaModelReady = computeModelReadinessFromRecord(
    rawModel
      ? { ...rawModel, id: "", faceVersion: null, faceFormat: null, bodyVersion: null, bodyFormat: null, deliveryType: "private", photoAnalysisConsentAt: null, consentPolicyVersion: null, createdAt: new Date(), updatedAt: new Date() }
      : null,
  ).isReadyForTryOn;

  // ── Migration-guarded: selfie analysis ──────────────────────────────────
  let selfieSignals: SelfieSignalSummary | null = null;
  try {
    const raw = await findSelfie(customerId);
    if (raw && raw.analysisStatus === "completed") {
      selfieSignals = buildSelfieSignalSummary({
        colourFamilies: Array.isArray(raw.colourFamilies) ? raw.colourFamilies : [],
        suggestedNecklines: Array.isArray(raw.suggestedNecklines) ? raw.suggestedNecklines : [],
        contrastLevel: (raw.contrastLevel as "low" | "medium" | "high") ?? "medium",
        overallNote: raw.overallNote ?? "",
      });
    }
  } catch (e) {
    if (isMigrationError(e)) {
      migrationStatus.selfieAnalysisPending = true;
    }
    // Non-migration errors: selfieSignals stays null — graceful degradation
  }

  // ── Migration-guarded: recommendation feedback ───────────────────────────
  let feedbackContext: FeedbackSignalContext = emptyFeedbackContext();
  try {
    const records = await findFeedback(customerId);
    feedbackContext = buildFeedbackSignalContext({
      records,
      positivePostWearRate: null, // resolved separately below
      migrationPending: false,
      postWearMigrationPending: false,
    });
  } catch (e) {
    if (isMigrationError(e)) {
      migrationStatus.recommendationFeedbackPending = true;
      feedbackContext = emptyFeedbackContext({ migrationPending: true });
    }
  }

  // ── Migration-guarded: post-wear rate (Phase 4B1 columns) ───────────────
  try {
    const { positiveRate } = await findPostWearRate(customerId);
    feedbackContext = { ...feedbackContext, positivePostWearRate: positiveRate };
  } catch (e) {
    if (isMigrationError(e)) {
      migrationStatus.postWearColumnsPending = true;
      feedbackContext = { ...feedbackContext, postWearMigrationPending: true };
    }
  }

  const features = computeFeatureAvailability({
    closetSummary,
    selfieSignals,
    naiaModelReady,
    virtualTryOnEnabled: vtoEnabled,
    feedbackContext,
  });

  return {
    selfieSignals,
    closetSummary,
    feedbackContext,
    features,
    migrationStatus,
  };
}

// ── buildEphemeralContextSignals ──────────────────────────────────────────────
// Builds an ephemeral StyleMeProfileSignals object for one recommendation call.
// Creates a new object — never mutates the source explicitSignals argument and
// never writes to the database or OnboardingProfile.
//
// Precedence rules enforced here:
//   EXPLICIT_PREFERENCE (100) wins unconditionally — explicit fields are never overwritten.
//   SOFT_RANK_SELFIE (30) only fills absent gaps.
//   SOFT_RANK_FEEDBACK — feedback reason codes don't map to specific colors or styles,
//     so no field in StyleMeProfileSignals can be safely populated from them.
//   firmNoColors is never touched by soft signals.
//
// If journeyCtx is null (e.g. build failed), returns explicitSignals unchanged.

export function buildEphemeralContextSignals(
  explicitSignals: StyleMeProfileSignals | undefined,
  journeyCtx: CustomerJourneyContext | null,
): StyleMeProfileSignals | undefined {
  if (!journeyCtx?.selfieSignals) return explicitSignals;

  const merged: StyleMeProfileSignals = { ...(explicitSignals ?? {}) };

  // Selfie color families → favoriteColors ONLY when no explicit favorites are set.
  // Explicit favorites always take full precedence (SIGNAL_PRECEDENCE.EXPLICIT_PREFERENCE).
  if (
    !merged.favoriteColors?.length &&
    journeyCtx.selfieSignals.colourFamilies.length > 0
  ) {
    merged.favoriteColors = journeyCtx.selfieSignals.colourFamilies;
  }

  return Object.keys(merged).length > 0 ? merged : undefined;
}
