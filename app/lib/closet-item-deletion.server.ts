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

import prisma from "../db.server.js";
import { deleteCloudinaryAsset, type DeleteAssetFn } from "./cloudinary-admin.server.js";

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
    await _deleteAsset(item.imagePublicId, "private");
    // Intentionally not blocking on failure: the DB record is removed regardless so
    // the customer's closet is clean. Any orphaned Cloudinary asset can be audited.
  }

  await prisma.closetItem.delete({ where: { id: item.id } });
  return { deleted: true };
}
