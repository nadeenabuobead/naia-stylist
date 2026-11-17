// app/lib/cloudinary-deletion-record.server.ts
//
// 2026-11-17 (launch-readiness audit, H7) — the ONE non-transactional
// recorder for "a Cloudinary deletion was attempted outside any protected
// transaction, and it failed."
//
// WHY THIS MODULE EXISTS AT ALL
//
// Before this, five call sites each inlined the identical
// `prisma.pendingCloudinaryDeletion.upsert({ where: { publicId }, ... })`
// block by hand — fashn-tryon-service.server.ts:878, customer-privacy.server.ts:344,
// api.tryon-status.$jobId.tsx:200, full-look-tryon-real.server.ts's
// recordIntermediateCleanupFailure (added by 3cdbff5), and the sweep's own
// recordClaimFailure. H7's remaining sites needed the same block ~50 more
// times. There was no shared non-transactional recorder to reuse, which is
// itself part of why so many per-feature deletion paths silently dropped
// their failures: recording one took a dozen lines of Prisma, so nobody did.
//
// WHY IT IS NOT IN cloudinary-deletion-claim.server.ts
//
// That module is the natural home (it already owns the non-transactional
// resolveClaim/recordClaimFailure), but it imports deleteCustomerVtoResults
// from ai/fashn-tryon-service.server, which imports ai/my-naia-model.server.
// my-naia-model.server is one of H7's own fix sites, so importing the claim
// module from there would close a genuine require cycle
// (claim -> fashn-tryon-service -> my-naia-model -> claim). This module
// therefore depends on nothing but the Prisma client and the Cloudinary
// delete call itself, so every H7 site can import it freely. The five
// pre-existing inline copies above are deliberately left untouched — they
// are covered by their own passing tests, and rewriting them is a
// behaviour-neutral refactor that belongs in its own commit, not in a
// privacy fix.
//
// RELATIONSHIP TO THE RETRY SWEEP
//
// A row written here is picked up by sweepPendingCloudinaryDeletions
// (cloudinary-deletion-claim.server.ts, added by H6) and by the per-row
// retry button on /admin/maintenance. No site that calls this needs retry
// logic of its own.
//
// SIDE EFFECT CALLERS MUST BE AWARE OF
//
// While a row here is unresolved, assertPublicIdAvailable treats that
// publicId as claimed and REFUSES to let a new DB row reference it. That is
// correct for every caller of this module — each one is discarding or
// replacing the asset, never keeping it — but it is the reason this must
// never be called for an asset the customer still legitimately references.
// deleteNaiaModelPhoto is the worked example of a path that must NOT call
// this: it leaves the DB reference in place on failure and surfaces the
// error to the customer, so the asset is still live and still referenced.

import prisma from "../db.server";
import { deleteCloudinaryAsset, type DeleteAssetFn } from "./cloudinary-admin.server";

export interface RecordFailedDeletionInput {
  customerId: string;
  publicId: string;
  /** The asset's real Cloudinary delivery type. Pass the "unknown" sentinel
   *  only when it genuinely could not be established — the retry path
   *  re-resolves that via the Admin API rather than guessing. */
  deliveryType: string;
  /** Operator-triage label. See PendingCloudinaryDeletion.context in
   *  schema.prisma for the known values. Never "vto-sweep-obligation":
   *  retryPendingCloudinaryDeletion dispatches on that string specially and
   *  would re-run a per-customer VTO sweep instead of deleting this asset. */
  context: string;
  lastError: string;
  resourceType?: string;
}

/**
 * Durably records a failed Cloudinary deletion so the existing retry sweep
 * can drain it, instead of letting the failure evaporate when the calling
 * function returns.
 *
 * Upsert, not create: publicId is @unique, so recording the same asset twice
 * (a retry that fails again, the same helper reached by two paths, or an
 * account erasure re-recording what a per-feature helper already recorded)
 * bumps attemptCount rather than throwing on a duplicate key. The create
 * branch seeds attemptCount at 1 because reaching here means one real
 * attempt has already been made and has already failed.
 *
 * Never throws. Every caller is on a cleanup path where the customer-visible
 * operation has already been decided; a bookkeeping failure must not turn a
 * completed deletion, or a validation rejection, into a 500. If even this
 * write fails there is nothing further the call site could do about it.
 */
export async function recordFailedCloudinaryDeletion(
  input: RecordFailedDeletionInput,
): Promise<void> {
  const lastError = input.lastError.slice(0, 2000);
  try {
    await prisma.pendingCloudinaryDeletion.upsert({
      where: { publicId: input.publicId },
      create: {
        customerId: input.customerId,
        publicId: input.publicId,
        resourceType: input.resourceType ?? "image",
        deliveryType: input.deliveryType,
        context: input.context,
        attemptCount: 1,
        lastAttemptAt: new Date(),
        lastError,
      },
      update: {
        attemptCount: { increment: 1 },
        lastAttemptAt: new Date(),
        lastError,
      },
    });
  } catch (err) {
    // No publicId or customerId in the log line — matches the log-safety
    // contract the rest of the Cloudinary modules already hold to.
    console.error("[cloudinary] failed to record pending Cloudinary deletion", err);
  }
}

export type DeleteAndRecordInput = Omit<RecordFailedDeletionInput, "lastError"> & {
  /** Overrides the default errorCode-derived message. */
  lastError?: string;
};

/**
 * Attempt a Cloudinary deletion and, if it fails, durably record it.
 *
 * This is the shape nearly every H7 site needs, and the reason the fix is a
 * one-line change at ~50 call sites rather than a dozen lines each. Returns
 * the underlying delete result unchanged so a caller that already branches on
 * it (or returns a typed partial success) keeps doing exactly that.
 *
 * Handles both failure modes, which is the distinction the original H7
 * finding turned on: deleteCloudinaryAsset does NOT throw when the provider
 * rejects the call — it returns { ok: false, errorCode } — so a site that
 * only wrapped the call in try/catch still dropped the common case.
 */
export async function deleteCloudinaryAssetOrRecord(
  input: DeleteAndRecordInput,
  _deleteAsset: DeleteAssetFn = deleteCloudinaryAsset,
  _record: typeof recordFailedCloudinaryDeletion = recordFailedCloudinaryDeletion,
): Promise<{ ok: boolean; errorCode?: string }> {
  let result: { ok: boolean; errorCode?: string };
  try {
    result = await _deleteAsset(input.publicId, input.deliveryType);
  } catch (err) {
    await _record({
      ...input,
      lastError:
        input.lastError ??
        (err instanceof Error ? err.message : "Cloudinary deletion threw"),
    });
    return { ok: false, errorCode: "THREW" };
  }

  if (!result?.ok) {
    await _record({
      ...input,
      lastError: input.lastError ?? result?.errorCode ?? "Cloudinary deletion failed",
    });
    return result ?? { ok: false, errorCode: "UNKNOWN" };
  }

  return result;
}
