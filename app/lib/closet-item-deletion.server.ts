// app/lib/closet-item-deletion.server.ts
// Shared Cloudinary-safe closet item deletion helper.
//
// Both api.closet.jsx (legacy JWT path) and closet._index.tsx (NaiaSession path)
// call this function so deletion behaviour is identical regardless of which UI path
// triggers it.
//
// Privacy contract:
//   - Ownership is verified server-side — no client-supplied customer ID is trusted.
//   - Cloudinary deletion is attempted BEFORE the DB record is removed.
//   - "not found" from Cloudinary is treated as ok (idempotent).
//   - If Cloudinary fails, the DB record is still removed so the customer's UI is
//     clean; the asset becomes an orphan that can be cleaned up separately. This
//     trades a potential orphaned asset for a blocked delete action, which is the
//     correct tradeoff for a customer-initiated UI delete (not a self-service
//     privacy deletion where retrying is expected).
//   - 2026-11-17 (H7): "can be cleaned up separately" is now a concrete,
//     durable obligation rather than an aspiration — see the call site below.

import prisma from "../db.server.js";
import { deleteCloudinaryAsset, type DeleteAssetFn } from "./cloudinary-admin.server.js";
import { deleteCloudinaryAssetOrRecord } from "./cloudinary-deletion-record.server.js";
import { writeSourceEvidence } from "./ai/taste-reconcile.server.js";

export type DeleteClosetItemResult =
  | { deleted: true }
  | { deleted: false; errorCode: "NOT_FOUND" };

export async function deleteClosetItemWithImage(
  itemId: string,
  customerId: string,
  _deleteAsset: DeleteAssetFn = deleteCloudinaryAsset,
): Promise<DeleteClosetItemResult> {
  // Verify ownership and load imagePublicId in a single query.
  const item = await prisma.closetItem.findFirst({
    where: { id: itemId, customerId },
    select: { id: true, imagePublicId: true },
  });

  if (!item) return { deleted: false, errorCode: "NOT_FOUND" };

  // Attempt Cloudinary deletion first. "not found" is already treated as ok by
  // deleteCloudinaryAsset, so re-deleting a previously-deleted asset is safe.
  if (item.imagePublicId) {
    // Intentionally still not blocking on failure: the DB record is removed
    // regardless so the customer's closet is clean.
    //
    // 2026-11-17 (H7) — but the failure is no longer discarded. The old code
    // dropped the return value entirely, and because deleteCloudinaryAsset
    // does NOT throw on a provider rejection (it returns
    // { ok:false, errorCode }), a failed delete left no trace anywhere: the
    // ClosetItem row is deleted on the next line, so the asset becomes
    // unreferenced, and nothing recorded that it still needs deleting.
    //
    // The only thing that would ever have reclaimed it is the bounded orphan
    // sweep (cloudinary-orphan-sweep.server.ts), which enumerates the whole
    // naia-wardrobe/{customerId}/ folder — and that sweep has no scheduled
    // trigger: runBoundedSweep is reachable only from a human clicking
    // /admin/maintenance. So "can be audited" meant, in practice, that a
    // customer-initiated deletion of their own garment photo could silently
    // fail to remove the image from storage with no record of it at all.
    //
    // Recording it hands the asset to the pending-deletion retry sweep (H6)
    // and puts it on /admin/maintenance with its error code, so the
    // obligation survives this request without needing a folder enumeration
    // to rediscover it.
    await deleteCloudinaryAssetOrRecord(
      {
        customerId,
        publicId: item.imagePublicId,
        deliveryType: "private",
        context: "closet-item-deletion-failed",
      },
      _deleteAsset,
    );
  }

  await prisma.closetItem.delete({ where: { id: item.id } });

  // Deleting the item means its CLOSET_RELATIONSHIP evidence no longer has a
  // source — clear it via the canonical writer so reconciliation can demote
  // any tendency that depended on it. Never let this block the delete itself.
  try {
    await writeSourceEvidence(customerId, "CLOSET_RELATIONSHIP", item.id, []);
  } catch (err) {
    console.error("taste-evidence: failed to clean up evidence after closet item delete", err);
  }

  return { deleted: true };
}
