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
  closetItem?: { imageUrl?: string | null; imagePublicId?: string | null; imageFormat?: string | null } | null;
};

export const MAX_COLLAGE_IMAGES = 4;

export function resolveItemImage(
  item: ResolvableOutfitItem,
  ctx: { customerId: string; cloudinaryConfig: CloudinaryConfig | null },
): string | null {
  const ci = item.closetItem;
  if (item.closetItemId && ci?.imagePublicId && ci?.imageFormat && ctx.cloudinaryConfig) {
    const ownership = validatePublicIdOwnership(ci.imagePublicId, ctx.customerId);
    if (ownership.ok) {
      return buildPrivateDownloadUrl(ctx.cloudinaryConfig, ci.imagePublicId, ci.imageFormat, "private");
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
    .map((item) => resolveItemImage(item, ctx))
    .filter((url): url is string => !!url)
    .slice(0, max);
  const extraCount = Math.max(0, items.length - resolvedImages.length);
  return { resolvedImages, extraCount };
}
