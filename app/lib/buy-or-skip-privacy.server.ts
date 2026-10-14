// app/lib/buy-or-skip-privacy.server.ts
// Privacy deletion helpers for Buy or Skip uploaded garment images.
//
// BuyOrSkipAnalysis stores customer-uploaded garment images in private Cloudinary
// storage (imagePublicId). This helper removes those images while preserving
// the analysis result, verdict, history, and BuySkipOutcome.
//
// Privacy contract:
//   - customerId is always the authenticated customer's ID — never from client input.
//   - Cloudinary deletion is attempted before DB fields are cleared.
//   - DB image references are cleared regardless of Cloudinary outcome.
//   - Analysis verdict, reasoning, fullAnalysis, and outcome are untouched.
//   - "not found" from Cloudinary is treated as ok (idempotent).

import prisma from "../db.server.js";
import {
  deleteCloudinaryAsset,
  getCloudinaryConfig,
  validatePublicIdOwnership,
  buildPrivateDownloadUrl,
  type DeleteAssetFn,
} from "./cloudinary-admin.server.js";

// ── Individual-item deletion ("Remove photo" on one Buy or Skip item) ─────────

export type DeleteBosImageResult =
  | { deleted: true }
  | { deleted: false; errorCode: "NOT_FOUND" };

export async function deleteOneBosImage(
  analysisId: string,
  customerId: string,
  _deleteAsset: DeleteAssetFn = deleteCloudinaryAsset,
): Promise<DeleteBosImageResult> {
  // Ownership check + the only fields needed, in one query.
  const analysis = await prisma.buyOrSkipAnalysis.findFirst({
    where: { id: analysisId, customerId },
    select: { id: true, imagePublicId: true },
  });
  if (!analysis) return { deleted: false, errorCode: "NOT_FOUND" };

  if (analysis.imagePublicId) {
    await _deleteAsset(analysis.imagePublicId, "private");
    // Non-blocking: the DB fields are cleared regardless so the item never
    // renders a reference to a deleted/unreachable asset.
  }

  // Verdict, reasoning, fullAnalysis, outcome, and every other field are
  // preserved — only the image reference is cleared.
  await prisma.buyOrSkipAnalysis.update({
    where: { id: analysis.id },
    data: { imagePublicId: null, imageFormat: null, imageUrl: null },
  });

  return { deleted: true };
}

export interface DeleteBosImagesResult {
  deletedCount: number;  // images successfully removed from Cloudinary
  clearedCount:  number;  // DB records whose image references were cleared
  failedAssets:  string[]; // publicIds where Cloudinary deletion failed
}

export async function deleteCustomerBosImages(
  customerId: string,
  _deleteAsset: DeleteAssetFn = deleteCloudinaryAsset,
): Promise<DeleteBosImagesResult> {
  // Load all analyses that have a Cloudinary-stored image (imagePublicId is the
  // canonical reference for new records; imageUrl is legacy and may also be present).
  const analyses = await prisma.buyOrSkipAnalysis.findMany({
    where: { customerId, imagePublicId: { not: null } },
    select: { id: true, imagePublicId: true },
  });

  let deletedCount = 0;
  let clearedCount  = 0;
  const failedAssets: string[] = [];

  for (const analysis of analyses) {
    if (!analysis.imagePublicId) continue; // TypeScript narrowing (filter above ensures non-null)

    const result = await _deleteAsset(analysis.imagePublicId, "private");

    if (result.ok) {
      deletedCount++;
    } else {
      failedAssets.push(analysis.imagePublicId);
      // Continue — clear DB reference regardless of Cloudinary outcome so the UI
      // does not render a broken reference.
    }

    // Clear image references regardless of Cloudinary result.
    // Verdict, reasoning, fullAnalysis, outcome, and all other fields are preserved.
    await prisma.buyOrSkipAnalysis.update({
      where: { id: analysis.id },
      data: {
        imagePublicId: null,
        imageFormat:   null,
        imageUrl:      null, // clear legacy URL field if present
      },
    });
    clearedCount++;
  }

  // Also clear imageUrl on records that have a legacy public URL but no imagePublicId.
  // These do not have a Cloudinary private asset to delete but still hold a URL reference.
  const legacyUrlRecords = await prisma.buyOrSkipAnalysis.findMany({
    where: { customerId, imagePublicId: null, imageUrl: { not: null } },
    select: { id: true },
  });

  if (legacyUrlRecords.length > 0) {
    await prisma.buyOrSkipAnalysis.updateMany({
      where: { customerId, imagePublicId: null, imageUrl: { not: null } },
      data: { imageUrl: null },
    });
    clearedCount += legacyUrlRecords.length;
  }

  return { deletedCount, clearedCount, failedAssets };
}

// ── Reads for the Settings & Privacy UI ────────────────────────────────────────

export interface BosPhotoListItem {
  id: string;
  productName: string | null;
  thumbnailUrl: string | null; // fresh, resolved — never the stale persisted field directly
}

export async function listCustomerBosImages(customerId: string): Promise<BosPhotoListItem[]> {
  const analyses = await prisma.buyOrSkipAnalysis.findMany({
    where: {
      customerId,
      OR: [{ imagePublicId: { not: null } }, { imageUrl: { not: null } }],
    },
    select: { id: true, productName: true, imageUrl: true, imagePublicId: true, imageFormat: true },
    orderBy: { createdAt: "desc" },
  });

  const cloudinaryConfig = getCloudinaryConfig();
  return analyses.map((analysis) => {
    // Same resolution order as the Buy or Skip result page (buyskip.$id.tsx):
    // S0 private asset first (ownership re-verified), legacy public URL otherwise.
    let thumbnailUrl: string | null = null;
    if (analysis.imagePublicId && analysis.imageFormat && cloudinaryConfig) {
      const ownership = validatePublicIdOwnership(analysis.imagePublicId, customerId);
      if (ownership.ok) {
        thumbnailUrl = buildPrivateDownloadUrl(cloudinaryConfig, analysis.imagePublicId, analysis.imageFormat, "private");
      }
    } else if (analysis.imageUrl) {
      thumbnailUrl = analysis.imageUrl;
    }
    return { id: analysis.id, productName: analysis.productName, thumbnailUrl };
  });
}

// ── State check for loader ────────────────────────────────────────────────────

export async function customerHasBosImages(customerId: string): Promise<boolean> {
  const count = await prisma.buyOrSkipAnalysis.count({
    where: {
      customerId,
      OR: [
        { imagePublicId: { not: null } },
        { imageUrl: { not: null } },
      ],
    },
  });
  return count > 0;
}
