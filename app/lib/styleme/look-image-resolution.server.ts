// app/lib/styleme/look-image-resolution.server.ts
//
// Resolves a StyleMe/Overview look's real per-item imagery server-side, shared
// by every surface that renders a StyleMe result as a compact collage
// (Overview's Latest StyleMe cards, the StyleMe history/looks gallery).
// Extracted so both surfaces resolve images identically rather than each
// growing its own slightly-different version of the same logic.

import {
  validatePublicIdOwnership,
  buildPrivateDownloadUrl,
  type CloudinaryConfig,
} from "~/lib/cloudinary-admin.server";

export type ResolvableOutfitItem = {
  closetItemId?: string | null;
  productImageUrl?: string | null;
  closetItem?: {
    imageUrl?: string | null;
    imagePublicId?: string | null;
    imageFormat?: string | null;
    category?: string | null;
  } | null;
};

export const MAX_COLLAGE_IMAGES = 4;

// 2026-11-03 — Sara visual QA: the gold hoop earrings on "Black Column, Quiet
// Gold" sit at ~15% fill in their own collage tile. Confirmed source-embedded
// (the padding is in the photo itself, not CSS) — no fit mode fixes that.
//
// Scoped to JEWELRY only, not every accessory and never garments. Why:
//   - It's the one category Sara's real screenshots actually confirmed as a
//     problem. BAGS/SHOES/ACCESSORIES were not — widening scope without
//     evidence is exactly the "indiscriminate" application this must avoid.
//   - Jewelry (metal, gemstone) is normally the HIGHEST-contrast case against
//     a photographed backdrop, not the lowest — the opposite of the
//     pale-garment erosion risk a blanket rule would carry.
//   - e_trim:15 (tolerance 15, same conservative value as the original,
//     never-deployed proposal) still relies on corner-color-uniformity
//     heuristics for an opaque photo. It cannot misjudge a TRANSPARENT
//     source (PNG/WEBP with alpha) — Cloudinary trims those by the alpha
//     channel, not color, which is exact rather than heuristic. For an
//     opaque photo of a pale metal or pearl piece on a near-white backdrop,
//     this heuristic is the one residual risk this change does not fully
//     eliminate — flagged here, not hidden, pending a real-photo spot check.
//   - c_pad (never c_fill/c_crop) guarantees whatever e_trim finds is never
//     cropped further — the same no-crop contract LookCollage's own
//     object-fit: contain already relies on.
// Delivery-time only: a Cloudinary URL parameter. imagePublicId and the
// stored original are never modified, never overwritten.
const JEWELRY_WHITESPACE_TRANSFORM = "e_trim:15/c_pad,ar_1:1,w_500,b_auto:predominant";

function needsWhitespaceNormalization(item: ResolvableOutfitItem): boolean {
  return item.closetItem?.category === "JEWELRY";
}

export function resolveItemImage(
  item: ResolvableOutfitItem,
  ctx: { customerId: string; cloudinaryConfig: CloudinaryConfig | null },
  transformation?: string,
): string | null {
  const ci = item.closetItem;
  if (item.closetItemId && ci?.imagePublicId && ci?.imageFormat && ctx.cloudinaryConfig) {
    const ownership = validatePublicIdOwnership(ci.imagePublicId, ctx.customerId);
    if (ownership.ok) {
      return buildPrivateDownloadUrl(ctx.cloudinaryConfig, ci.imagePublicId, ci.imageFormat, "private", undefined, undefined, transformation);
    }
  }
  if (item.productImageUrl) return item.productImageUrl;
  if (ci?.imageUrl) return ci.imageUrl;
  return null;
}

/**
 * Resolves up to `max` real item images for one result's collage, plus how
 * many more pieces exist beyond what's shown. Only ever draws from the exact
 * items passed in — never invents an image or substitutes an unrelated piece.
 */
export function resolveCollageImages(
  items: ResolvableOutfitItem[],
  ctx: { customerId: string; cloudinaryConfig: CloudinaryConfig | null },
  max: number = MAX_COLLAGE_IMAGES,
): { resolvedImages: string[]; extraCount: number } {
  const resolvedImages = items
    .map((item) => resolveItemImage(item, ctx, needsWhitespaceNormalization(item) ? JEWELRY_WHITESPACE_TRANSFORM : undefined))
    .filter((url): url is string => !!url)
    .slice(0, max);
  const extraCount = Math.max(0, items.length - resolvedImages.length);
  return { resolvedImages, extraCount };
}
