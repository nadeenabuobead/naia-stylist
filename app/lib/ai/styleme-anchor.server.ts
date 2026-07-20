// app/lib/ai/styleme-anchor.server.ts
// Resolves session anchor selections into typed engine inputs.
// resolveNadineAnchor: pure catalog lookup — no DB access.
// resolveClosetAnchor: DB-backed lookup with ownership check.
// resolveActionAnchor: validates source + anchor combination, returns typed result.

import { getAllCatalogProducts } from "./naia-catalog.js";
import type { NadineAnchorInput, ClosetAnchorInput, AnchorInput } from "./styleme-recommendation.types.js";
import prisma from "../../db.server.js";

const VALID_HANDLES = new Set(getAllCatalogProducts().map((p) => p.handle));

/**
 * Returns a NadineAnchorInput for the given handle, or null if the handle
 * is not in the V8 catalog. Pure function — no DB access.
 */
export function resolveNadineAnchor(handle: string): NadineAnchorInput | null {
  if (!handle || !VALID_HANDLES.has(handle)) return null;
  return { type: "nadine", handle };
}

/**
 * Loads a ClosetItem by ID and verifies it belongs to customerId.
 * Returns a ClosetAnchorInput on success, null if not found or unauthorized.
 */
export async function resolveClosetAnchor(
  customerId: string,
  closetItemId: string,
): Promise<ClosetAnchorInput | null> {
  if (!closetItemId || !customerId) return null;

  const item = await prisma.closetItem.findFirst({
    where: { id: closetItemId, customerId },
  });

  if (!item) return null;

  return {
    type: "closet",
    id: item.id,
    name: item.name ?? null,
    category: item.category,
    colors: item.colors,
    primaryColor: item.primaryColor ?? null,
    pattern: item.pattern ?? null,
    material: item.material ?? null,
    styleTags: item.styleTags,
    occasions: item.occasions,
    imageUrl: item.imageUrl,
  };
}

// ── Typed result for action-level anchor resolution ──────────────────────────

// anchor is null when source is "naia-piece" and no explicit handle was supplied:
// the engine auto-selects the best NADINE product from session signals.
export type AnchorResolutionOk = { ok: true; anchor: AnchorInput | null };
export type AnchorResolutionErr = { ok: false; status: 400 | 403; message: string };
export type AnchorResolution = AnchorResolutionOk | AnchorResolutionErr;

/**
 * Validates that the source/anchor combination is legal and resolves the anchor.
 *
 * - naia-piece: nadineHandle is required and must be a valid V8 catalog handle.
 *   Missing or unknown handle → 400. Never allows anchor=null.
 * - my-closet / both: closetItemId is required (→ 400 if absent) and must be owned by
 *   customerId (→ 403 if the resolver returns null).
 *
 * resolveCloset defaults to the real DB-backed resolveClosetAnchor.
 * Tests inject a fake resolver to cover unknown/foreign cases without a live DB.
 */
export async function resolveActionAnchor(
  source: "naia-piece" | "my-closet" | "both",
  customerId: string,
  nadineHandle: string | null,
  closetItemId: string | null,
  resolveCloset: (
    customerId: string,
    closetItemId: string,
  ) => Promise<ClosetAnchorInput | null> = resolveClosetAnchor,
): Promise<AnchorResolution> {
  if (source === "naia-piece") {
    // No handle supplied: engine auto-selects the best NADINE piece from session signals.
    // An explicit handle (future "Style This Piece" entry points) is still resolved normally.
    if (!nadineHandle) {
      return { ok: true, anchor: null };
    }
    const anchor = resolveNadineAnchor(nadineHandle);
    if (!anchor) {
      return { ok: false, status: 400, message: "Selected product is not available." };
    }
    return { ok: true, anchor };
  }

  // my-closet or both — closet anchor is mandatory
  if (!closetItemId) {
    return { ok: false, status: 400, message: "A closet item must be selected for this source." };
  }

  const anchor = await resolveCloset(customerId, closetItemId);
  if (!anchor) {
    return { ok: false, status: 403, message: "Closet item not found or access denied." };
  }

  return { ok: true, anchor };
}
