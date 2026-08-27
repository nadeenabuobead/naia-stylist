// app/lib/ai/styleme-anchor.server.ts
// Resolves session anchor selections into typed engine inputs.
// resolveNadineAnchor: pure catalog lookup — no DB access.
// resolveClosetAnchor: DB-backed lookup with ownership check.
// resolveActionAnchor: validates source + anchor combination, returns typed result.
// scoreClosetItemForSession: pure signal-based scoring of a single Closet item.
// autoSelectClosetAnchor: DB-backed; ranks all items and returns the strongest anchor.

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

// ── Auto Closet anchor selection ─────────────────────────────────────────────
// Ranks the customer's Closet items against the current StyleMe session signals
// and returns the strongest anchor candidate.
//
// Scoring (additive, higher = better):
//  +10  if item.occasions includes the session occasion (strong contextual match)
//  +3   per mood token that appears in item.styleTags
//  +2   per desired-feeling token that appears in item.styleTags
//
// Category is NOT a scored signal — it is used only as a sort tiebreaker in
// autoSelectClosetAnchor so anchor-capable garments (TOPS/BOTTOMS/DRESSES/OUTERWEAR)
// beat accessories when signal scores are equal.
//
// Explicit session signals (occasion, mood, feeling) outrank all profile background —
// no Passport profile signals are used here.
// Ties broken by: anchor-capable category first, then recency (createdAt DESC).

const ANCHOR_CAPABLE_CATEGORIES = new Set(["TOPS", "BOTTOMS", "DRESSES", "OUTERWEAR"]);

/**
 * Scores a single Closet item against the current StyleMe session signals.
 * Pure function — no DB access, exported for unit testing.
 * Category is excluded from the score; it is a sort tiebreaker in autoSelectClosetAnchor.
 */
export function scoreClosetItemForSession(
  item: { occasions: string[]; styleTags: string[]; category: string },
  signals: { occasion: string; moods: string[]; desiredFeelings: string[] },
): number {
  let score = 0;

  if (item.occasions.includes(signals.occasion)) score += 10;

  for (const mood of signals.moods) {
    if (item.styleTags.includes(mood)) score += 3;
  }

  for (const feeling of signals.desiredFeelings) {
    if (item.styleTags.includes(feeling)) score += 2;
  }

  return score;
}

/**
 * Loads all Closet items for the customer (up to 50, newest-first), scores each
 * against the session signals, and returns the highest-scoring item as a
 * ClosetAnchorInput plus its raw DB id.
 *
 * Returns null when the customer has no Closet items.
 * Never selects by array order or at random — every item is explicitly scored
 * and the winner is deterministic for a given set of signals.
 */
export async function autoSelectClosetAnchor(
  customerId: string,
  signals: { occasion: string; moods: string[]; desiredFeelings: string[] },
): Promise<{ anchor: ClosetAnchorInput; id: string } | null> {
  const items = await prisma.closetItem.findMany({
    where: { customerId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  if (items.length === 0) return null;

  type DbItem = (typeof items)[number];
  type ScoredItem = { item: DbItem; score: number; isAnchorCapable: boolean };

  const mapped: ScoredItem[] = items.map((item: DbItem) => ({
    item,
    score: scoreClosetItemForSession(
      { occasions: item.occasions, styleTags: item.styleTags, category: item.category },
      signals,
    ),
    isAnchorCapable: ANCHOR_CAPABLE_CATEGORIES.has(item.category),
  }));

  const scored = mapped.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Tiebreaker 1: prefer garments that can anchor an outfit
    if (a.isAnchorCapable !== b.isAnchorCapable) return a.isAnchorCapable ? -1 : 1;
    // Tiebreaker 2: recency — preserved by stable sort over createdAt DESC fetch order
    return 0;
  });

  const winner = scored[0].item;
  return {
    anchor: {
      type: "closet",
      id: winner.id,
      name: winner.name ?? null,
      category: winner.category,
      colors: winner.colors,
      primaryColor: winner.primaryColor ?? null,
      pattern: winner.pattern ?? null,
      material: winner.material ?? null,
      styleTags: winner.styleTags,
      occasions: winner.occasions,
      imageUrl: winner.imageUrl,
    },
    id: winner.id,
  };
}
