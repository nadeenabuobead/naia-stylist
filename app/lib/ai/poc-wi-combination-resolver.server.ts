// app/lib/ai/poc-wi-combination-resolver.server.ts
//
// PROOF OF CONCEPT — connects a real Wardrobe Intelligence outfit combination
// to the isolated sequential VTO POC (poc-sequential-full-look-vto.server.ts).
// NOT wired to any route. NOT imported by any customer-facing code.
//
// SCOPE OF THIS FILE, DELIBERATELY NARROW: it resolves and ownership-verifies
// the METADATA of the three real Closet items in a WI combination — id, name,
// category, subcategory — and maps that into the POC's garment-ordering
// shape. It never touches an image field.
//
// resolveOwnedWiGarments below selects exactly { id, customerId, name,
// category, subcategory } from ClosetItem. It never selects imageUrl,
// imagePublicId, or imageFormat, and never calls resolveClosetAnchor or
// buildPrivateDownloadUrl (both of which build a signed Cloudinary photo URL
// as part of what they return — see styleme-anchor.server.ts:131-138). That
// is intentional: generating or holding that signed URL is exactly the
// "private garment-image URL" step this POC stage must not take yet.
//
// WHAT STILL NEEDS TO HAPPEN BEFORE A REAL TEST (NOT implemented here, and
// gated behind a separate, explicit approval):
//   1. Resolve each of the three real Closet items' signed image URL —
//      reuse resolveClosetAnchor (styleme-anchor.server.ts) or
//      buildPrivateDownloadUrl (cloudinary-admin.server.ts) directly.
//   2. Resolve the test account's nAia Model body photo to a base64 data
//      URL — reuse downloadModelPhotoAsDataUrl (fashn-tryon-service.server.ts).
//   3. Construct the real VirtualTryOnConsent object for this one test.
//   4. Feed the three now-complete SequentialTryOnGarmentInput entries (with
//      real productImageUrl values) and the real model data URL into
//      runSequentialFullLookTryOn with a REAL fetch — only once the paid
//      run itself is separately approved.
//
// Ownership verification reuses the existing fail-closed convention from
// api.wi-style-this.tsx (findConflictingSlot / "fail the whole set, not a
// silent pick"): if any requested id doesn't exist, isn't owned by this
// customer, or appears more than once, the whole resolution fails closed.

import prisma from "../../db.server.js";
import { closetItemToSlot } from "./closet-slot.js";
import type { OutfitSlot } from "./styleme-recommendation.types.js";

export interface WiResolvedGarmentMetadata {
  closetItemId: string;
  name: string | null;
  category: string;
  subcategory: string | null;
  slot: OutfitSlot;
}

/**
 * Loads the given Closet item ids, scoped to customerId, selecting ONLY
 * non-image metadata. Returns null (fail closed) if any id doesn't exist,
 * isn't owned by this customer, or is duplicated in the input — mirroring
 * the ownership-resolution convention in api.wi-style-this.tsx. Returns the
 * resolved rows in the SAME order as closetItemIds, not DB order, so a
 * caller that passes [trousers, shirt, blazer] gets that order back.
 *
 * DB-dependent — integration-only, like resolveClosetAnchor itself. Not
 * covered by poc-wi-combination-resolver.test.ts; see that file's own notes.
 */
export async function resolveOwnedWiGarments(
  customerId: string,
  closetItemIds: readonly string[],
): Promise<WiResolvedGarmentMetadata[] | null> {
  if (!customerId || closetItemIds.length === 0) return null;
  if (new Set(closetItemIds).size !== closetItemIds.length) return null; // no duplicate ids

  const rows: Array<{ id: string; name: string | null; category: string; subcategory: string | null }> =
    await prisma.closetItem.findMany({
      where: { id: { in: [...closetItemIds] }, customerId },
      select: { id: true, name: true, category: true, subcategory: true },
    });

  if (rows.length !== closetItemIds.length) return null; // some id missing or not owned

  const byId = new Map(rows.map((r) => [r.id, r]));
  const ordered: WiResolvedGarmentMetadata[] = [];
  for (const id of closetItemIds) {
    const row = byId.get(id);
    if (!row) return null; // defensive — byId should always have every id here
    ordered.push({
      closetItemId: row.id,
      name: row.name ?? null,
      category: row.category,
      subcategory: row.subcategory ?? null,
      slot: closetItemToSlot(row.category, row.subcategory),
    });
  }
  return ordered;
}

/**
 * Pure mapping helper — no DB access. Turns ownership-verified garment
 * metadata into the shape poc-sequential-full-look-vto.server.ts expects,
 * MINUS productImageUrl (deliberately absent: image resolution is a later,
 * separately-approved step, not part of this connector).
 */
export function toPendingSequentialTryOnInputs(
  garments: readonly WiResolvedGarmentMetadata[],
): Array<{ label: string; category: string; subcategory: string | null; closetItemId: string; slot: OutfitSlot }> {
  return garments.map((g) => ({
    label: g.name ?? g.closetItemId,
    category: g.category,
    subcategory: g.subcategory,
    closetItemId: g.closetItemId,
    slot: g.slot,
  }));
}
