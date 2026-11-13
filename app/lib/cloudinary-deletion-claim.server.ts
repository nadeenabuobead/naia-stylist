// app/lib/cloudinary-deletion-claim.server.ts
//
// The reservation half of the abandoned-upload sweep's concurrency
// protection — see PendingCloudinaryDeletion's schema comment for the full
// design rationale. Two operations, both meant to run INSIDE an existing
// Serializable transaction (never on their own, never at a lower isolation
// level — that is what makes "check, then act" atomic rather than a plain
// recheck-then-write race):
//
//   - assertPublicIdAvailable: called by the COMMIT side (reserveClosetSlot,
//     reserveBuySkipSlot, and the two direct-create/-update paths that
//     bypass them) immediately before persisting a new DB reference to a
//     publicId. Throws if the sweep has already claimed that publicId.
//   - claimPublicIdForDeletion: called by the SWEEP side after it has
//     rechecked, inside the same transaction, that no live DB row
//     references the candidate publicId. Upserts the claim row.
//
// Under Serializable isolation, Postgres detects the exact "dangerous
// structure" this pair creates: one side's SELECT finding no matching row,
// followed by the other side's INSERT of a row that WOULD have matched. If
// both transactions touch the same publicId, whichever commits second is
// aborted with a serialization failure — the existing retry loops in
// entitlement.server.ts (isSerializationError/MAX_TX_RETRIES) already catch
// and retry exactly this class of error for reserveClosetSlot/
// reserveBuySkipSlot; the two direct paths added here use the same pattern.
// This is not a heuristic "the window is small" argument — it is the same
// mechanism this codebase already relies on for the ClosetItem/
// BuyOrSkipAnalysis capacity race, applied to one more resource.

import type { Prisma } from "@prisma/client";
import prisma from "../db.server";
import { deleteCloudinaryAsset, verifyCloudinaryAsset } from "./cloudinary-admin.server";
import { deleteCustomerVtoResults } from "./ai/fashn-tryon-service.server";

// Narrowed to only the one model these functions touch — matches this
// codebase's own convention (entitlement.server.ts's RunReservationFn) of
// accepting the narrowest Pick a transaction callback actually needs,
// rather than the full TransactionClient, so every caller's own (differently
// narrowed) tx type is assignable here without a cast.
type TxClient = Pick<Prisma.TransactionClient, "pendingCloudinaryDeletion">;

export class AssetPendingDeletionError extends Error {
  constructor(publicId: string) {
    super(`Cloudinary asset ${publicId} is claimed for deletion and cannot be referenced by a new record.`);
    this.name = "AssetPendingDeletionError";
  }
}

// Throws if an unresolved claim exists for this publicId. Call this LAST,
// immediately before the create/update it protects, inside the same
// Serializable transaction that performs that create/update — calling it
// earlier, or outside the transaction, reopens the exact race it exists to
// close.
export async function assertPublicIdAvailable(tx: TxClient, publicId: string | null | undefined): Promise<void> {
  if (!publicId) return;
  const claim = await tx.pendingCloudinaryDeletion.findUnique({
    where: { publicId },
    select: { resolvedAt: true },
  });
  if (claim && claim.resolvedAt === null) {
    throw new AssetPendingDeletionError(publicId);
  }
}

export interface ClaimInput {
  customerId: string;
  publicId: string;
  resourceType: string;
  deliveryType: string;
  context: "abandoned-upload-sweep" | "account-erasure";
}

// Upserts the claim row inside the sweep's own Serializable transaction,
// immediately after it has rechecked (in that same transaction) that no
// live DB row references this publicId. The actual Cloudinary destroy call
// must happen AFTER this transaction commits, never inside it — holding an
// external HTTP call open under Serializable isolation would hold real DB
// locks for the duration of a network round trip, which this design
// deliberately avoids by keeping the claim step DB-only and fast.
export async function claimPublicIdForDeletion(tx: TxClient, input: ClaimInput): Promise<void> {
  await tx.pendingCloudinaryDeletion.upsert({
    where: { publicId: input.publicId },
    create: {
      customerId: input.customerId,
      publicId: input.publicId,
      resourceType: input.resourceType,
      deliveryType: input.deliveryType,
      context: input.context,
      attemptCount: 0,
    },
    // A retry of an asset that failed to delete before: refresh context but
    // never clear attemptCount/lastError — resolveClaim/recordClaimFailure
    // own those.
    update: {
      context: input.context,
    },
  });
}

// Called OUTSIDE any transaction, after the actual Cloudinary destroy call
// returns — not part of the atomicity-critical section above.
export async function resolveClaim(publicId: string): Promise<void> {
  await prisma.pendingCloudinaryDeletion.updateMany({
    where: { publicId },
    data: { resolvedAt: new Date() },
  });
}

export async function recordClaimFailure(publicId: string, errorMessage: string): Promise<void> {
  await prisma.pendingCloudinaryDeletion.updateMany({
    where: { publicId },
    data: {
      attemptCount: { increment: 1 },
      lastAttemptAt: new Date(),
      lastError: errorMessage.slice(0, 2000),
    },
  });
}

// ── /admin/maintenance support — same shape as listPendingClerkCleanups /
// retryPendingClerkCleanup (clerk-cleanup.server.ts), so the page's existing
// pattern extends directly rather than inventing a new one. ─────────────────

export async function listPendingCloudinaryDeletions(): Promise<Array<{
  id: string;
  customerId: string;
  publicId: string;
  resourceType: string;
  deliveryType: string;
  context: string;
  attemptCount: number;
  lastAttemptAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
}>> {
  return prisma.pendingCloudinaryDeletion.findMany({
    where: { resolvedAt: null },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
}

export type RetryCloudinaryDeletionResult =
  | { status: "resolved" }
  | { status: "failed-again"; error: string }
  | { status: "not-found" }
  | { status: "already-resolved" };

// Candidates tried, in order, when a row's deliveryType is the "unknown"
// sentinel (see FailedModelAsset in my-naia-model.server.ts) — the first one
// Cloudinary's own Admin API confirms the asset exists under is used. Never
// guessed: deleteCloudinaryAsset is never called with "unknown" itself.
const DELIVERY_TYPE_CANDIDATES = ["private", "authenticated"] as const;

async function resolveUnknownDeliveryType(publicId: string): Promise<string | null> {
  for (const candidate of DELIVERY_TYPE_CANDIDATES) {
    const verify = await verifyCloudinaryAsset(publicId, candidate);
    if (verify.ok) return verify.asset.type || candidate;
  }
  return null;
}

// A customer-level VTO-result sweep obligation (publicId
// "vto-sweep-obligation:{customerId}", recorded atomically with the body-
// photo-deletion DB write that created it — see
// fashn-tryon-service.server.ts's deleteNaiaModelBodyPhotoAndVtoResults).
// Not a real Cloudinary asset: retrying it means re-running the per-customer
// sweep (deleteCustomerVtoResults), not deleteCloudinaryAsset against
// row.publicId. Individual asset failures that sweep finds are durably
// recorded as their OWN separate PendingCloudinaryDeletion rows by
// deleteCustomerVtoResults itself — resolving this sentinel only means "a
// sweep attempt enumerated everything and found zero failures," never
// "every historical per-asset failure for this customer is gone."
async function retryVtoSweepObligation(row: { id: string; customerId: string }): Promise<RetryCloudinaryDeletionResult> {
  try {
    const result = await deleteCustomerVtoResults(row.customerId);
    if (result.failedAssets.length === 0) {
      await prisma.pendingCloudinaryDeletion.update({ where: { id: row.id }, data: { resolvedAt: new Date() } });
      return { status: "resolved" };
    }
    await prisma.pendingCloudinaryDeletion.update({
      where: { id: row.id },
      data: {
        attemptCount: { increment: 1 },
        lastAttemptAt: new Date(),
        lastError: `${result.failedAssets.length} VTO result asset(s) still pending — tracked individually`,
      },
    });
    return { status: "failed-again", error: "VTO_RESULTS_PARTIAL" };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    // Best-effort attempt-count bump — if THIS update also fails, the
    // sentinel row (created atomically with the original deletion) still
    // exists and is still unresolved, so nothing durable is lost, only
    // this one attempt's audit detail.
    await prisma.pendingCloudinaryDeletion
      .update({
        where: { id: row.id },
        data: { attemptCount: { increment: 1 }, lastAttemptAt: new Date(), lastError: message.slice(0, 2000) },
      })
      .catch(() => {});
    return { status: "failed-again", error: "VTO_SWEEP_ENUMERATION_FAILED" };
  }
}

export async function retryPendingCloudinaryDeletion(id: string): Promise<RetryCloudinaryDeletionResult> {
  const row = await prisma.pendingCloudinaryDeletion.findUnique({ where: { id } });
  if (!row) return { status: "not-found" };
  if (row.resolvedAt) return { status: "already-resolved" };

  if (row.context === "vto-sweep-obligation") {
    return retryVtoSweepObligation(row);
  }

  let deliveryType = row.deliveryType;
  if (deliveryType === "unknown") {
    const resolved = await resolveUnknownDeliveryType(row.publicId);
    if (!resolved) {
      // Still can't establish it — record the attempt, never guess a type
      // to delete against, and never report success.
      await prisma.pendingCloudinaryDeletion.update({
        where: { id },
        data: { attemptCount: { increment: 1 }, lastAttemptAt: new Date(), lastError: "DELIVERY_TYPE_UNKNOWN" },
      });
      return { status: "failed-again", error: "DELIVERY_TYPE_UNKNOWN" };
    }
    deliveryType = resolved;
    // Persist the now-resolved type so a future retry doesn't need to
    // re-resolve it, regardless of whether this delete attempt succeeds.
    await prisma.pendingCloudinaryDeletion.update({ where: { id }, data: { deliveryType } });
  }

  const result = await deleteCloudinaryAsset(row.publicId, deliveryType);
  if (result.ok) {
    await prisma.pendingCloudinaryDeletion.update({ where: { id }, data: { resolvedAt: new Date() } });
    return { status: "resolved" };
  }
  const error = result.errorCode ?? "UNKNOWN";
  await prisma.pendingCloudinaryDeletion.update({
    where: { id },
    data: { attemptCount: { increment: 1 }, lastAttemptAt: new Date(), lastError: error },
  });
  return { status: "failed-again", error };
}

// Retention/minimization — resolved rows are only ever useful as a recent
// audit trail; purge old ones rather than keeping them forever. Admin-
// triggered, same "no cron exists yet" convention as data-retention.server.ts.
export async function purgeResolvedCloudinaryDeletions(olderThanDays: number = 90): Promise<{ count: number }> {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  const result = await prisma.pendingCloudinaryDeletion.deleteMany({
    where: { resolvedAt: { not: null, lt: cutoff } },
  });
  return { count: result.count };
}
