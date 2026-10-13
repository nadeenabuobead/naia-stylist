// app/lib/admin/buyskip-admin.server.ts
//
// nAia Admin — Buy/Skip upload history for a customer.
//
// Read-only. Reuses the image reference already persisted on BuyOrSkipAnalysis
// (imagePublicId + imageFormat, with legacy imageUrl as fallback) — no new
// Cloudinary upload or duplication happens here.
//
// A Buy/Skip upload is NOT a Closet item: this module never touches
// ClosetItem, never writes TasteEvidence, and never informs Wardrobe
// Intelligence. It only reads BuyOrSkipAnalysis + its BuySkipOutcome for
// admin display.

import prisma from "~/db.server";
import {
  getCloudinaryConfig,
  buildPrivateDownloadUrl,
  validatePublicIdOwnership,
} from "../cloudinary-admin.server";

const THUMBNAIL_TRANSFORMATION = "w_160,h_160,c_fill,q_60";

export interface AdminBuySkipUploadSummary {
  id: string;
  createdAt: Date;
  /** Display-grade verdict string — prefers the richer fullAnalysis value (e.g. "SKIP FOR NOW") over the collapsed DB enum. */
  displayVerdict: string;
  itemType: string | null;
  category: string | null;
  reasoning: string | null;
  confidence: number | null;
  thumbnailUrl: string | null;
  outcome: { decision: string; postPurchaseOutcome: string | null } | null;
  hasDecisionEvidence: boolean;
  verdictOverridden: boolean;
}

export interface AdminBuySkipUploadDetail extends AdminBuySkipUploadSummary {
  imageUrl: string | null;
  fullAnalysis: Record<string, unknown> | null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Resolves a viewable image URL from whatever is currently persisted on the
 * record, without duplicating or re-uploading anything:
 *   1. S0+ records: sign a time-limited private-delivery URL from imagePublicId/imageFormat.
 *   2. Pre-S0 legacy records: use the stored public imageUrl directly (same
 *      fallback the customer-facing buyskip.$id.tsx result page uses).
 *   3. Neither present (never uploaded, or the customer deleted their photos
 *      via the privacy-deletion flow) → null, so the UI can show a fallback.
 */
function resolveImageUrl(
  row: { imagePublicId: string | null; imageFormat: string | null; imageUrl: string | null },
  customerId: string,
  transformation?: string,
): string | null {
  if (row.imagePublicId && row.imageFormat) {
    const cfg = getCloudinaryConfig();
    if (!cfg) return null;
    const ownership = validatePublicIdOwnership(row.imagePublicId, customerId);
    if (!ownership.ok) return null; // malformed/mismatched reference — fail closed to a fallback, not a broken image
    return buildPrivateDownloadUrl(cfg, row.imagePublicId, row.imageFormat, "private", undefined, undefined, transformation);
  }
  if (row.imageUrl) return row.imageUrl;
  return null;
}

function displayVerdictFor(dbVerdict: string, fullAnalysis: unknown): string {
  if (isRecord(fullAnalysis) && typeof fullAnalysis.verdict === "string" && fullAnalysis.verdict.trim() !== "") {
    return fullAnalysis.verdict;
  }
  return dbVerdict;
}

function toSummary(row: {
  id: string;
  createdAt: Date;
  verdict: string;
  reasoning: string | null;
  category: string | null;
  confidence: number | null;
  imagePublicId: string | null;
  imageFormat: string | null;
  imageUrl: string | null;
  fullAnalysis: unknown;
  outcome: { decision: string; postPurchaseOutcome: string | null } | null;
}, customerId: string): AdminBuySkipUploadSummary {
  const fa = isRecord(row.fullAnalysis) ? row.fullAnalysis : null;
  return {
    id: row.id,
    createdAt: row.createdAt,
    displayVerdict: displayVerdictFor(row.verdict, fa),
    itemType: typeof fa?.itemType === "string" ? fa.itemType : null,
    category: row.category,
    reasoning: row.reasoning,
    confidence: row.confidence,
    thumbnailUrl: resolveImageUrl(row, customerId, THUMBNAIL_TRANSFORMATION),
    outcome: row.outcome,
    hasDecisionEvidence: fa?.decisionEvidence != null,
    verdictOverridden: fa?.verdictOverridden === true,
  };
}

// V1 bounding — matches the same pattern used for Closet/StyleMe/VTO in
// customer-360.server.ts: a Buy/Skip upload history grows with activity
// volume, so the admin customer-detail page caps it to the most recent
// BUYSKIP_RECENT_LIMIT submissions rather than loading full lifetime
// history on every page open. No cursor/pagination — a static take + a
// sibling totalCount so the tab can say "showing 25 of X".
const BUYSKIP_RECENT_LIMIT = 25;

/**
 * Newest-first Buy/Skip submission history for one customer, for the admin
 * customer-detail page. Bounded to the most recent BUYSKIP_RECENT_LIMIT
 * rows; totalCount reports the true lifetime count alongside.
 */
export async function getAdminCustomerBuySkipUploads(
  customerId: string,
): Promise<{ items: AdminBuySkipUploadSummary[]; totalCount: number }> {
  const [rows, totalCount] = await Promise.all([
    prisma.buyOrSkipAnalysis.findMany({
      where: { customerId },
      orderBy: { createdAt: "desc" },
      take: BUYSKIP_RECENT_LIMIT,
      select: {
        id: true,
        createdAt: true,
        verdict: true,
        reasoning: true,
        category: true,
        confidence: true,
        imagePublicId: true,
        imageFormat: true,
        imageUrl: true,
        fullAnalysis: true,
        outcome: { select: { decision: true, postPurchaseOutcome: true } },
      },
    }),
    prisma.buyOrSkipAnalysis.count({ where: { customerId } }),
  ]);
  return { items: rows.map((r: (typeof rows)[number]) => toSummary(r, customerId)), totalCount };
}

/**
 * Full detail for one Buy/Skip analysis, scoped to the given customer —
 * returns null (not the record) when the analysis belongs to a different
 * customer, so an admin following a stale/guessed URL cannot see another
 * customer's upload.
 */
export async function getAdminCustomerBuySkipUploadDetail(
  customerId: string,
  analysisId: string,
): Promise<AdminBuySkipUploadDetail | null> {
  const row = await prisma.buyOrSkipAnalysis.findUnique({
    where: { id: analysisId },
    select: {
      id: true,
      customerId: true,
      createdAt: true,
      verdict: true,
      reasoning: true,
      category: true,
      confidence: true,
      imagePublicId: true,
      imageFormat: true,
      imageUrl: true,
      fullAnalysis: true,
      outcome: { select: { decision: true, postPurchaseOutcome: true } },
    },
  });
  if (!row || row.customerId !== customerId) return null;

  const fa = isRecord(row.fullAnalysis) ? row.fullAnalysis : null;
  return {
    ...toSummary(row, customerId),
    imageUrl: resolveImageUrl(row, customerId),
    fullAnalysis: fa,
  };
}
