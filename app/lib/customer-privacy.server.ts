// app/lib/customer-privacy.server.ts
//
// Single source of truth for "what counts as this customer's data" — used by
// the self-service Settings export/delete actions AND the Shopify
// customers/data_request, customers/redact, and shop/redact webhooks, so
// there is exactly one erase/export implementation to get right, not four.
//
// Design:
//   - Cloudinary assets are deleted BEFORE the database row that references
//     them, by delegating to each feature's own existing deletion helper
//     (deleteAllClosetPhotos, deleteCustomerBosImages, etc.) — reusing the
//     same ownership-scoped, already-tested logic rather than re-implementing
//     Cloudinary deletion here.
//   - JourneyEvent has no foreign key to Customer by design (privacy — see
//     its schema comment), so it is purged separately via the same
//     customerIdHash derivation journey-events.server.ts already uses.
//   - The Customer row is deleted last. Every other Prisma model with a
//     customerId relation has onDelete: Cascade (confirmed against
//     schema.prisma), so deleting Customer removes them automatically.
//   - eraseCustomerData is idempotent by construction: a customer that no
//     longer exists is treated as "already erased", not an error. This is
//     the duplicate-webhook-delivery handling — Shopify may redeliver
//     customers/redact / shop/redact, and redelivery must be safe to repeat
//     rather than tracked via a separate dedup table.
//   - What this CANNOT do: delete anything FASHN, Anthropic, or Bodygram may
//     retain server-side. That is a provider-side policy question (their
//     dashboard/DPA), not something any code here can act on — documented,
//     never silently assumed away.

import prisma from "../db.server";
import { hashCustomerId } from "./ai/journey-events.server";
import { deleteAllClosetPhotos } from "./closet-photo-privacy.server";
import { deleteCustomerBosImages } from "./buy-or-skip-privacy.server";
import { deleteCustomerVtoResults } from "./ai/fashn-tryon-service.server";
import { withdrawSaveModelConsent } from "./ai/my-naia-model.server";
import { deleteBoth as deleteSelfieBoth } from "./ai/selfie-persistence.server";

// ── Dependency-injection surface (mocked providers in tests) ──────────────────

export interface EraseDependencies {
  deleteAllClosetPhotos?: typeof deleteAllClosetPhotos;
  deleteCustomerBosImages?: typeof deleteCustomerBosImages;
  deleteCustomerVtoResults?: typeof deleteCustomerVtoResults;
  withdrawSaveModelConsent?: typeof withdrawSaveModelConsent;
  deleteSelfieBoth?: typeof deleteSelfieBoth;
}

export interface EraseResult {
  ok: boolean;
  alreadyErased: boolean;
  cloudinaryFailures: string[];
  journeyEventsPurged: number;
}

// ── Erase ───────────────────────────────────────────────────────────────────

export async function eraseCustomerData(
  customerId: string,
  deps: EraseDependencies = {},
): Promise<EraseResult> {
  const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } });

  // Idempotent: a repeat delivery of customers/redact or shop/redact for a
  // customer already erased is success, not an error — this IS the
  // duplicate-request handling, not a separate code path.
  if (!customer) {
    return { ok: true, alreadyErased: true, cloudinaryFailures: [], journeyEventsPurged: 0 };
  }

  const _deleteAllClosetPhotos = deps.deleteAllClosetPhotos ?? deleteAllClosetPhotos;
  const _deleteCustomerBosImages = deps.deleteCustomerBosImages ?? deleteCustomerBosImages;
  const _deleteCustomerVtoResults = deps.deleteCustomerVtoResults ?? deleteCustomerVtoResults;
  const _withdrawSaveModelConsent = deps.withdrawSaveModelConsent ?? withdrawSaveModelConsent;
  const _deleteSelfieBoth = deps.deleteSelfieBoth ?? deleteSelfieBoth;

  // 1. Cloudinary assets first — the Customer-row cascade below has no
  //    mechanism to reach external storage.
  const closet = await _deleteAllClosetPhotos(customerId);
  const bos = await _deleteCustomerBosImages(customerId);
  const vto = await _deleteCustomerVtoResults(customerId);
  const model = await _withdrawSaveModelConsent(customerId);
  const selfie = await _deleteSelfieBoth(customerId);

  const cloudinaryFailures = [
    ...closet.failedAssets,
    ...bos.failedAssets,
    ...vto.failedAssets,
    ...model.failedAssets,
    // deleteSelfieBoth returns { ok, errorCode? } rather than a failedAssets
    // list — NOT_FOUND just means there was never a photo, DELETION_FAILED
    // is the one failure mode worth surfacing here.
    ...(selfie.ok ? [] : selfie.errorCode === "DELETION_FAILED" ? ["selfie-photo"] : []),
  ];

  // 2. JourneyEvent — no FK, purged by the same hash derivation
  //    journey-events.server.ts uses for every write, imported directly so
  //    this can never silently drift from that derivation.
  const hash = hashCustomerId(customerId);
  const { count: journeyEventsPurged } = await prisma.journeyEvent.deleteMany({
    where: { customerIdHash: hash },
  });

  // 3. The Customer row itself — cascades every other relation
  //    (ClosetItem, OnboardingProfile, StylingSession, NaiaSession, NaiaModel,
  //    VirtualTryOnJob, SelfieAnalysis, SavedLook, TasteEvidence, etc.),
  //    confirmed via schema.prisma's onDelete: Cascade on each relation.
  await prisma.customer.delete({ where: { id: customerId } });

  return {
    ok: cloudinaryFailures.length === 0,
    alreadyErased: false,
    cloudinaryFailures,
    journeyEventsPurged,
  };
}

// ── Export ──────────────────────────────────────────────────────────────────

export interface CustomerExport {
  exportedAt: string;
  customer: Record<string, unknown>;
  // Each key is the data category a customer would recognise, not a raw
  // Prisma relation name — this is what gets handed back to them.
  stylePassport: unknown;
  closet: unknown[];
  wardrobeSnapshots: unknown[];
  styleMeSessions: unknown[];
  buyOrSkipAnalyses: unknown[];
  wardrobeInsights: unknown[];
  savedLooks: unknown[];
  postOutfitReviews: unknown[];
  confidenceScores: unknown[];
  trendReportViews: unknown[];
  stylingEvents: unknown[];
  naiaModel: unknown;
  virtualTryOnJobs: unknown[];
  recommendationFeedback: unknown[];
  selfieAnalysis: unknown;
  naiaObservationFeedback: unknown[];
  styleMeOutcomes: unknown[];
  tasteEvidence: unknown[];
  styleTendencies: unknown[];
  personalisedTrendEditUsage: unknown[];
  note: string;
}

export async function compileCustomerExport(customerId: string): Promise<CustomerExport | null> {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    include: {
      onboardingProfile: true,
      closetItems: true,
      wardrobeSnapshots: true,
      stylingSessions: true,
      buyOrSkipAnalyses: true,
      wardrobeInsights: true,
      savedLooks: true,
      postOutfitReviews: true,
      confidenceScores: true,
      trendReportViews: true,
      stylingEvents: true,
      naiaModel: true,
      tryOnJobs: true,
      recommendationFeedback: true,
      selfieAnalysis: true,
      naiaObservationFeedback: true,
      styleMemoryOutcomes: true,
      tasteEvidence: true,
      styleTendencies: true,
      personalisedTrendEditUsage: true,
    },
  });

  if (!customer) return null;

  const {
    onboardingProfile, closetItems, wardrobeSnapshots, stylingSessions, buyOrSkipAnalyses,
    wardrobeInsights, savedLooks, postOutfitReviews, confidenceScores, trendReportViews,
    stylingEvents, naiaModel, tryOnJobs, recommendationFeedback, selfieAnalysis,
    naiaObservationFeedback, styleMemoryOutcomes, tasteEvidence, styleTendencies,
    personalisedTrendEditUsage, ...customerFields
  } = customer as any;

  return {
    exportedAt: new Date().toISOString(),
    customer: customerFields,
    stylePassport: onboardingProfile,
    closet: closetItems,
    wardrobeSnapshots,
    styleMeSessions: stylingSessions,
    buyOrSkipAnalyses,
    wardrobeInsights,
    savedLooks,
    postOutfitReviews,
    confidenceScores,
    trendReportViews,
    stylingEvents,
    naiaModel,
    virtualTryOnJobs: tryOnJobs,
    recommendationFeedback,
    selfieAnalysis,
    naiaObservationFeedback,
    styleMeOutcomes: styleMemoryOutcomes,
    tasteEvidence,
    styleTendencies,
    personalisedTrendEditUsage,
    note:
      "This export covers every record this application stores about you. " +
      "Photos are referenced by their storage identifier, not included as image " +
      "files, in this export. It does not include any copy that FASHN AI, " +
      "Anthropic, or Bodygram may independently retain on their own systems — " +
      "those are governed by each provider's own data retention policy, not by " +
      "this application.",
  };
}
