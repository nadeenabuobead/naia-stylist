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
//   - 2026-11-17 (H7): a Cloudinary deletion that FAILS is durably recorded
//     for the pending-deletion retry sweep instead of being discarded. Every
//     function here clears or deletes the DB image reference regardless of
//     the Cloudinary outcome, which is exactly what made a dropped failure
//     unrecoverable without enumerating the customer's whole folder: the
//     asset is left unreferenced, so nothing points at it any more and
//     nothing records that it still needs deleting.

import prisma from "../db.server.js";
import {
  deleteCloudinaryAsset,
  getCloudinaryConfig,
  validatePublicIdOwnership,
  buildPrivateDownloadUrl,
  type DeleteAssetFn,
} from "./cloudinary-admin.server.js";
import { deleteCloudinaryAssetOrRecord } from "./cloudinary-deletion-record.server.js";

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
    // Non-blocking: the DB fields are cleared regardless so the item never
    // renders a reference to a deleted/unreachable asset. A failure is now
    // recorded (H7) — this is the customer's own "remove photo" control, so a
    // dropped failure meant reporting the photo as gone while it was still
    // in storage.
    await deleteCloudinaryAssetOrRecord(
      {
        customerId,
        publicId: analysis.imagePublicId,
        deliveryType: "private",
        context: "bos-photo-deletion-failed",
      },
      _deleteAsset,
    );
  }

  // Verdict, reasoning, fullAnalysis, outcome, and every other field are
  // preserved — only the image reference is cleared.
  await prisma.buyOrSkipAnalysis.update({
    where: { id: analysis.id },
    data: { imagePublicId: null, imageFormat: null, imageUrl: null },
  });

  return { deleted: true };
}

// ── Full decision deletion ("×" on a card in My Decisions) ────────────────────
//
// Distinct from deleteOneBosImage/deleteCustomerBosImages above, which only
// clear the uploaded image and keep the analysis, verdict, and outcome. This
// removes the entire BuyOrSkipAnalysis record — the decision/history entry
// itself — which cascades to its BuySkipOutcome via the schema relation.
// Used only by the My Decisions page's per-card remove control; Settings &
// Privacy's "Remove all images" never calls this.

export type DeleteBosDecisionResult =
  | { deleted: true }
  | { deleted: false; errorCode: "NOT_FOUND" };

export async function deleteOneBosDecision(
  analysisId: string,
  customerId: string,
  _deleteAsset: DeleteAssetFn = deleteCloudinaryAsset,
): Promise<DeleteBosDecisionResult> {
  // Ownership check + the only field needed, in one query.
  const analysis = await prisma.buyOrSkipAnalysis.findFirst({
    where: { id: analysisId, customerId },
    select: { id: true, imagePublicId: true },
  });
  if (!analysis) return { deleted: false, errorCode: "NOT_FOUND" };

  if (analysis.imagePublicId) {
    // Non-blocking: the record is deleted regardless of Cloudinary outcome.
    // A failure is recorded (H7) — the BuyOrSkipAnalysis row is deleted on
    // the next line, so after a dropped failure nothing referenced the asset
    // and nothing knew it still needed deleting.
    await deleteCloudinaryAssetOrRecord(
      {
        customerId,
        publicId: analysis.imagePublicId,
        deliveryType: "private",
        context: "bos-decision-deletion-failed",
      },
      _deleteAsset,
    );
  }

  await prisma.buyOrSkipAnalysis.delete({ where: { id: analysis.id } });

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

    // Records each failure at the point of failure, not just in the returned
    // failedAssets array (H7). Same reasoning as deleteCustomerVtoResults in
    // fashn-tryon-service.server.ts: callers discard failedAssets. Confirmed
    // for this function too — settings.tsx:191 calls it as a bare
    // `await deleteCustomerBosImages(customer.id)` and ignores the result.
    const result = await deleteCloudinaryAssetOrRecord(
      {
        customerId,
        publicId: analysis.imagePublicId,
        deliveryType: "private",
        context: "bos-photo-bulk-deletion-failed",
      },
      _deleteAsset,
    );

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
  return analyses.map((analysis: {
    id: string;
    productName: string | null;
    imageUrl: string | null;
    imagePublicId: string | null;
    imageFormat: string | null;
  }) => {
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
