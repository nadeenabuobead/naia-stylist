// app/lib/closet-photo-privacy.server.ts
// Image-only deletion for Closet items — customer-facing privacy control.
//
// Distinct from deleteClosetItemWithImage (closet-item-deletion.server.ts),
// which removes the whole garment record. These helpers clear only the
// image fields (imageUrl, imagePublicId, imageFormat, thumbnailUrl) and
// leave the ClosetItem row — name, category, attributes, and every
// relationship (OutfitItem, SavedLookItem, admin review, historical
// StyleMe/Buy-Skip/Trend Edit references by closetItemId) — untouched.
//
// Privacy contract (mirrors buy-or-skip-privacy.server.ts):
//   - customerId is always the authenticated customer's ID — never from client input.
//   - Ownership is verified server-side on every operation.
//   - Cloudinary deletion is attempted before DB image fields are cleared.
//   - DB image references are cleared regardless of Cloudinary outcome, so the
//     UI never ends up pointing at a deleted asset.
//   - "not found" from Cloudinary is treated as ok (idempotent).

import prisma from "../db.server.js";
import { deleteCloudinaryAsset, getCloudinaryConfig, type DeleteAssetFn } from "./cloudinary-admin.server.js";
import { resolveItemImage } from "./styleme/look-image-resolution.server.js";

export type DeleteClosetPhotoResult =
  | { deleted: true }
  | { deleted: false; errorCode: "NOT_FOUND" };

export async function deleteClosetItemPhoto(
  itemId: string,
  customerId: string,
  _deleteAsset: DeleteAssetFn = deleteCloudinaryAsset,
): Promise<DeleteClosetPhotoResult> {
  // Ownership check + the only fields needed, in one query.
  const item = await prisma.closetItem.findFirst({
    where: { id: itemId, customerId },
    select: { id: true, imagePublicId: true },
  });
  if (!item) return { deleted: false, errorCode: "NOT_FOUND" };

  if (item.imagePublicId) {
    await _deleteAsset(item.imagePublicId, "private");
    // Non-blocking: the DB fields are cleared regardless so the garment never
    // renders a reference to a deleted/unreachable asset.
  }

  await prisma.closetItem.update({
    where: { id: item.id },
    data: { imagePublicId: null, imageFormat: null, imageUrl: null, thumbnailUrl: null },
  });

  return { deleted: true };
}

export interface DeleteAllClosetPhotosResult {
  deletedCount: number;  // images successfully removed from Cloudinary
  clearedCount: number;  // ClosetItem rows whose image fields were cleared
  failedAssets: string[]; // publicIds where Cloudinary deletion failed
}

export async function deleteAllClosetPhotos(
  customerId: string,
  _deleteAsset: DeleteAssetFn = deleteCloudinaryAsset,
): Promise<DeleteAllClosetPhotosResult> {
  const items = await prisma.closetItem.findMany({
    where: {
      customerId,
      OR: [{ imagePublicId: { not: null } }, { imageUrl: { not: null } }],
    },
    select: { id: true, imagePublicId: true },
  });

  let deletedCount = 0;
  const failedAssets: string[] = [];

  for (const item of items) {
    if (!item.imagePublicId) continue;
    const result = await _deleteAsset(item.imagePublicId, "private");
    if (result.ok) deletedCount++;
    else failedAssets.push(item.imagePublicId);
  }

  if (items.length > 0) {
    await prisma.closetItem.updateMany({
      where: { id: { in: items.map((i: { id: string; imagePublicId: string | null }) => i.id) } },
      data: { imagePublicId: null, imageFormat: null, imageUrl: null, thumbnailUrl: null },
    });
  }

  return { deletedCount, clearedCount: items.length, failedAssets };
}

// ── Reads for the Settings & Privacy UI ────────────────────────────────────────

export interface ClosetPhotoListItem {
  id: string;
  name: string | null;
  thumbnailUrl: string | null; // fresh, resolved — never the stale persisted field directly
}

export async function listCustomerClosetPhotos(customerId: string): Promise<ClosetPhotoListItem[]> {
  const items = await prisma.closetItem.findMany({
    where: {
      customerId,
      OR: [{ imagePublicId: { not: null } }, { imageUrl: { not: null } }],
    },
    select: { id: true, name: true, imageUrl: true, imagePublicId: true, imageFormat: true },
    orderBy: { createdAt: "desc" },
  });

  const cloudinaryConfig = getCloudinaryConfig();
  return items.map((item: {
    id: string;
    name: string | null;
    imageUrl: string | null;
    imagePublicId: string | null;
    imageFormat: string | null;
  }) => ({
    id: item.id,
    name: item.name,
    thumbnailUrl: resolveItemImage(
      { closetItemId: item.id, productImageUrl: null, closetItem: item },
      { customerId, cloudinaryConfig },
    ),
  }));
}

export async function customerHasClosetPhotos(customerId: string): Promise<boolean> {
  const count = await prisma.closetItem.count({
    where: {
      customerId,
      OR: [{ imagePublicId: { not: null } }, { imageUrl: { not: null } }],
    },
  });
  return count > 0;
}
