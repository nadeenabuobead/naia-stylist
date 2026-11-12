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
//   - Two distinct completion paths, chosen by whether the customer has
//     billing history:
//       * No Subscription/BillingTransaction rows: the Customer row is
//         deleted outright. Every OTHER Prisma model with a customerId
//         relation has onDelete: Cascade (confirmed against schema.prisma),
//         so deleting Customer removes them automatically.
//       * Subscription/BillingTransaction rows exist: those are deliberately
//         onDelete: Restrict (see their own schema comments — UAE tax law
//         requires retaining financial records independent of an erasure
//         request), so Customer.delete() would throw. Instead, every
//         NON-financial child row is deleted explicitly and the Customer row
//         itself is anonymized in place (every personal identifier nulled)
//         rather than removed — "anonymize what erasure requires while
//         retaining what the law requires", exactly as Subscription's own
//         comment anticipates. The anonymized row's only remaining purpose
//         is to be the thing Subscription/BillingTransaction still point to.
//       * Before that anonymization runs, any live/chargeable subscription
//         is cancelled immediately via Stripe (see billing/erasure-billing.
//         server.ts) — anonymizing first would leave a subscription Stripe
//         keeps billing with no customer left able to reach the Billing
//         Portal to stop it. A cancellation failure here is treated as the
//         same kind of genuinely-unexpected failure as a stuck Cloudinary
//         asset (below) — durably recorded, anonymization does NOT proceed.
//   - A genuinely unexpected failure (anything other than the two expected,
//     already-handled cases above: a stuck Cloudinary asset, or billing
//     history) is durably recorded via recordPendingCustomerErasureFailure
//     rather than thrown — see customer-erasure-failures.server.ts and
//     /admin/maintenance. This is what lets a shop/redact batch continue
//     past one customer's unexpected failure without losing the failure.
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
import { recordPendingCustomerErasureFailure } from "./customer-erasure-failures.server";
import { sweepCustomerForErasure } from "./cloudinary-orphan-sweep.server";
import { cancelActiveBillingForErasure } from "./billing/erasure-billing.server";

// ── Dependency-injection surface (mocked providers in tests) ──────────────────

// Every non-financial model with a direct customerId FK to Customer — see
// the anonymize path below. Subscription and BillingTransaction are
// deliberately excluded: those are the records being retained.
type ErasureTransactionClient = Pick<
  typeof prisma,
  | "onboardingProfile" | "closetItem" | "stylingSession" | "buyOrSkipAnalysis"
  | "wardrobeInsight" | "savedLook" | "postOutfitReview" | "confidenceScore"
  | "trendReportView" | "stylingEvent" | "naiaSession" | "naiaModel"
  | "virtualTryOnJob" | "recommendationFeedback" | "selfieAnalysis"
  | "naiaObservationFeedback" | "styleMeOutcome" | "tasteEvidence"
  | "styleTendency" | "wardrobeSnapshot" | "personalisedTrendEditUsage"
  | "identityLinkRequest" | "customer"
>;

export type RunErasureTransactionFn = <T>(fn: (tx: ErasureTransactionClient) => Promise<T>) => Promise<T>;

const _runErasureTransactionDefault: RunErasureTransactionFn = (fn) =>
  prisma.$transaction((tx: ErasureTransactionClient) => fn(tx));

export interface EraseDependencies {
  deleteAllClosetPhotos?: typeof deleteAllClosetPhotos;
  deleteCustomerBosImages?: typeof deleteCustomerBosImages;
  deleteCustomerVtoResults?: typeof deleteCustomerVtoResults;
  withdrawSaveModelConsent?: typeof withdrawSaveModelConsent;
  deleteSelfieBoth?: typeof deleteSelfieBoth;
  sweepCustomerForErasure?: typeof sweepCustomerForErasure;
  _runErasureTransaction?: RunErasureTransactionFn;
  // fix/stripe-clerk-phase1-security (2026-11-12): cancels any live,
  // chargeable Stripe subscription BEFORE anonymizeBilledCustomer runs — see
  // billing/erasure-billing.server.ts's own header for why this must happen
  // here, not be left to a webhook.
  cancelActiveBillingForErasure?: typeof cancelActiveBillingForErasure;
}

export interface EraseResult {
  ok: boolean;
  alreadyErased: boolean;
  /**
   * true when the customer had billing history: every non-financial record
   * was deleted and the Customer row itself was anonymized in place (not
   * removed) so Subscription/BillingTransaction can still reference it.
   */
  anonymized: boolean;
  /**
   * publicIds that failed to delete — from the existing feature helpers
   * AND the abandoned-upload sweep. Every one of these is durably recorded
   * in PendingCloudinaryDeletion (retryable via /admin/maintenance), not
   * just returned here — a caller ignoring this array (as settings.tsx's
   * delete-account action currently does) no longer means the failure is
   * lost, only that it isn't surfaced synchronously.
   */
  cloudinaryFailures: string[];
  journeyEventsPurged: number;
  /**
   * Set only when a genuinely unexpected failure occurred and was durably
   * recorded instead of thrown — see customer-erasure-failures.server.ts.
   * When set, `ok` is false and the erasure did NOT complete.
   */
  pendingFailureId?: string;
}

async function hasBillingHistory(customerId: string): Promise<boolean> {
  const [subscriptionCount, billingTransactionCount] = await Promise.all([
    prisma.subscription.count({ where: { customerId } }),
    prisma.billingTransaction.count({ where: { customerId } }),
  ]);
  return subscriptionCount > 0 || billingTransactionCount > 0;
}

// Deletes every non-financial record for this customer, then anonymizes
// (does not remove) the Customer row itself. Runs as one transaction: a
// partial anonymization would be worse than the un-anonymized original,
// since it could leave personal data split unpredictably across tables.
async function anonymizeBilledCustomer(customerId: string, runTx: RunErasureTransactionFn): Promise<void> {
  await runTx(async (tx) => {
    await tx.onboardingProfile.deleteMany({ where: { customerId } });
    await tx.closetItem.deleteMany({ where: { customerId } });
    await tx.stylingSession.deleteMany({ where: { customerId } });
    await tx.buyOrSkipAnalysis.deleteMany({ where: { customerId } });
    await tx.wardrobeInsight.deleteMany({ where: { customerId } });
    await tx.savedLook.deleteMany({ where: { customerId } });
    await tx.postOutfitReview.deleteMany({ where: { customerId } });
    await tx.confidenceScore.deleteMany({ where: { customerId } });
    await tx.trendReportView.deleteMany({ where: { customerId } });
    await tx.stylingEvent.deleteMany({ where: { customerId } });
    await tx.naiaSession.deleteMany({ where: { customerId } });
    await tx.naiaModel.deleteMany({ where: { customerId } });
    await tx.virtualTryOnJob.deleteMany({ where: { customerId } });
    await tx.recommendationFeedback.deleteMany({ where: { customerId } });
    await tx.selfieAnalysis.deleteMany({ where: { customerId } });
    await tx.naiaObservationFeedback.deleteMany({ where: { customerId } });
    await tx.styleMeOutcome.deleteMany({ where: { customerId } });
    await tx.tasteEvidence.deleteMany({ where: { customerId } });
    await tx.styleTendency.deleteMany({ where: { customerId } });
    await tx.wardrobeSnapshot.deleteMany({ where: { customerId } });
    await tx.personalisedTrendEditUsage.deleteMany({ where: { customerId } });
    await tx.identityLinkRequest.deleteMany({ where: { customerId } });

    // Every personal identifier nulled; id (and therefore the
    // Subscription/BillingTransaction FK it anchors) is untouched.
    await tx.customer.update({
      where: { id: customerId },
      data: {
        shopifyCustomerId: null,
        clerkUserId: null,
        email: null,
        firstName: null,
        lastName: null,
        identityLinkFailedAttempts: 0,
        identityLinkLockedUntil: null,
        designResearchConsent: false,
        designResearchConsentAt: null,
        designResearchConsentVersion: null,
        ageConfirmedAt: null,
        ageConfirmationVersion: null,
      },
    });
  });
}

// ── Erase ───────────────────────────────────────────────────────────────────

export async function eraseCustomerData(
  customerId: string,
  deps: EraseDependencies = {},
  context: string = "unspecified",
): Promise<EraseResult> {
  const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } });

  // Idempotent: a repeat delivery of customers/redact or shop/redact for a
  // customer already erased is success, not an error — this IS the
  // duplicate-request handling, not a separate code path.
  if (!customer) {
    return { ok: true, alreadyErased: true, anonymized: false, cloudinaryFailures: [], journeyEventsPurged: 0 };
  }

  const _deleteAllClosetPhotos = deps.deleteAllClosetPhotos ?? deleteAllClosetPhotos;
  const _deleteCustomerBosImages = deps.deleteCustomerBosImages ?? deleteCustomerBosImages;
  const _deleteCustomerVtoResults = deps.deleteCustomerVtoResults ?? deleteCustomerVtoResults;
  const _withdrawSaveModelConsent = deps.withdrawSaveModelConsent ?? withdrawSaveModelConsent;
  const _deleteSelfieBoth = deps.deleteSelfieBoth ?? deleteSelfieBoth;
  const _sweepCustomerForErasure = deps.sweepCustomerForErasure ?? sweepCustomerForErasure;
  const _runErasureTransaction = deps._runErasureTransaction ?? _runErasureTransactionDefault;
  const _cancelActiveBillingForErasure = deps.cancelActiveBillingForErasure ?? cancelActiveBillingForErasure;

  // 1. Cloudinary assets first — the Customer-row cascade below has no
  //    mechanism to reach external storage.
  const closet = await _deleteAllClosetPhotos(customerId);
  const bos = await _deleteCustomerBosImages(customerId);
  const vto = await _deleteCustomerVtoResults(customerId);
  const model = await _withdrawSaveModelConsent(customerId);
  const selfie = await _deleteSelfieBoth(customerId);
  // Abandoned uploads — never committed to any of the above, so none of
  // them would otherwise ever discover or delete these. No age threshold:
  // the customer is leaving, so everything in their folder goes now, not
  // after the ordinary 24h grace period. This call durably records its own
  // failures (see cloudinary-deletion-claim.server.ts's PendingCloudinaryDeletion
  // upsert) — unlike the four calls above, whose failedAssets are recorded
  // below, since those existing helpers predate this table and were
  // deliberately left unchanged.
  const abandoned = await _sweepCustomerForErasure(customerId);

  const existingHelperFailures: Array<{ publicId: string; deliveryType: string; resourceType: string }> = [
    ...closet.failedAssets.map((publicId) => ({ publicId, deliveryType: "private", resourceType: "image" })),
    ...bos.failedAssets.map((publicId) => ({ publicId, deliveryType: "private", resourceType: "image" })),
    ...vto.failedAssets.map((publicId) => ({ publicId, deliveryType: "private", resourceType: "image" })),
    // withdrawSaveModelConsent now carries its own verified (or explicitly
    // "unknown") deliveryType per failure — see FailedModelAsset and
    // resolveModelAssetDeliveryType in my-naia-model.server.ts. No guess
    // here; this reads whatever that function already established.
    ...model.failedAssets.map((f) => ({ publicId: f.publicId, deliveryType: f.deliveryType, resourceType: "image" })),
  ];
  if (!selfie.ok && selfie.errorCode === "DELETION_FAILED") {
    // deleteSelfieBoth doesn't expose the photo's own publicId on failure —
    // re-read it directly; selfie uploads are always deliveryType "private"
    // (selfie-upload.server.ts hardcodes it, confirmed).
    const selfieRow = await prisma.selfieAnalysis.findUnique({ where: { customerId }, select: { photoPublicId: true } });
    if (selfieRow?.photoPublicId) {
      existingHelperFailures.push({ publicId: selfieRow.photoPublicId, deliveryType: "private", resourceType: "image" });
    }
  }

  const cloudinaryFailures = [
    ...existingHelperFailures.map((f) => f.publicId),
    ...abandoned.failedAssets,
  ];

  // 2. JourneyEvent — no FK, purged by the same hash derivation
  //    journey-events.server.ts uses for every write, imported directly so
  //    this can never silently drift from that derivation.
  const hash = hashCustomerId(customerId);
  const { count: journeyEventsPurged } = await prisma.journeyEvent.deleteMany({
    where: { customerIdHash: hash },
  });

  // 3. The Customer row — the one step genuinely at risk of a surprise
  //    failure (a Restrict FK throwing, an unexpected DB error), so it's
  //    the only part wrapped: anything that goes wrong here is durably
  //    recorded instead of thrown, so one customer's failure can never
  //    silently abort whatever batch called this.
  try {
    // Durably record the pre-existing helpers' Cloudinary failures (the
    // abandoned-upload sweep already recorded its own). Deliberately
    // inside this try: if THIS write itself fails, that must escalate to
    // the same recordPendingCustomerErasureFailure path below, not be
    // silently dropped — a failure to persist a deletion task must never
    // read as a successful erasure.
    for (const f of existingHelperFailures) {
      const lastError = f.deliveryType === "unknown"
        ? "delivery type could not be established during account erasure — a retry must re-resolve it before attempting deletion"
        : "deletion failed during account erasure";
      await prisma.pendingCloudinaryDeletion.upsert({
        where: { publicId: f.publicId },
        create: {
          customerId,
          publicId: f.publicId,
          resourceType: f.resourceType,
          deliveryType: f.deliveryType,
          context: "account-erasure",
          attemptCount: 1,
          lastAttemptAt: new Date(),
          lastError,
        },
        update: {
          attemptCount: { increment: 1 },
          lastAttemptAt: new Date(),
          lastError: `${lastError} (repeat)`,
        },
      });
    }

    const billed = await hasBillingHistory(customerId);
    if (billed) {
      // Cancel any live, chargeable subscription BEFORE anonymizing —
      // anonymization is about to remove every way this customer could
      // reach the Billing Portal to cancel it themselves. A failure here
      // throws (caught below, durably recorded) rather than proceeding to
      // anonymize while Stripe might still be billing this customer.
      const billingCancellation = await _cancelActiveBillingForErasure(customerId);
      if (!billingCancellation.ok) {
        throw new Error(
          `cancelActiveBillingForErasure failed for ${billingCancellation.failures.length} subscription(s): ` +
            billingCancellation.failures.map((f) => `${f.subscriptionId} (${f.error})`).join("; "),
        );
      }
      // Subscription/BillingTransaction rows block a real delete (onDelete:
      // Restrict) and must be legally retained — anonymize in place instead.
      await anonymizeBilledCustomer(customerId, _runErasureTransaction);
      return { ok: cloudinaryFailures.length === 0, alreadyErased: false, anonymized: true, cloudinaryFailures, journeyEventsPurged };
    }

    // No billing history — cascades every other relation (ClosetItem,
    // OnboardingProfile, StylingSession, NaiaSession, NaiaModel,
    // VirtualTryOnJob, SelfieAnalysis, SavedLook, TasteEvidence, etc.),
    // confirmed via schema.prisma's onDelete: Cascade on each relation.
    await prisma.customer.delete({ where: { id: customerId } });
    return { ok: cloudinaryFailures.length === 0, alreadyErased: false, anonymized: false, cloudinaryFailures, journeyEventsPurged };
  } catch (err) {
    const pendingFailureId = await recordPendingCustomerErasureFailure(customerId, context, err);
    return { ok: false, alreadyErased: false, anonymized: false, cloudinaryFailures, journeyEventsPurged, pendingFailureId };
  }
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
