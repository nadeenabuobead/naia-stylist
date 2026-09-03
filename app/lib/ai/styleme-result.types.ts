// app/lib/ai/styleme-result.types.ts
// Typed schema for the StyleMe customer result — Phase 3D.
// runRecommendation() is the authority for product selection and ranking.
// Claude is used for wording only (outfitName, whyThisWorks, confidenceBoost, perfumeNote).

import type { StyleMeRecommendationResult } from "./styleme-recommendation.types.js";
import type { GetReadySong } from "./get-ready-song-catalog.js";

export type { GetReadySong };

export type StyleMeOutcome =
  | "nadine-recommendation"
  | "closet-led"
  | "no-eligible-product";

// ── Primary product (nAia piece selected by the engine) ─────────────────────

export interface StyleMePrimaryProduct {
  handle: string;
  title: string;
  slot: string;               // lowercase OutfitSlot: "top" | "bottom" | "dress" | etc.
  shopifyProductId: string | null;   // null — not in generated catalog
  productImageUrl: string | null;
  liveUrl: string | null;            // product page URL from catalog
  productUrl: string | null;         // derived from verified media shopifyHandle
  stylingNotes: string;              // catalog styleMeExplanation or fallback
}

// ── Outfit completion layer ──────────────────────────────────────────────────
// Generic wardrobe guidance for essential clothing slots still missing after
// the anchor + primary NADINE recommendation are placed. These are never
// NADINE products, never Closet-owned items — styling directions only.

export interface StyleMeCompletionPiece {
  slot: string;        // "top" | "bottom"
  description: string; // contextual wardrobe styling guidance
}

// ── Finishing layer ─────────────────────────────────────────────────────────

export interface StyleMeFinishingLayer {
  shoes: string;
  bag: string;
  accessories: string;
  hair: string;
  colourDirection: string;
}

// ── Wording (Claude output or deterministic fallback) ───────────────────────

export interface StyleMeWording {
  outfitName: string;
  whyThisWorks: string;
  confidenceBoost: string;
  perfumeNote: string | null;
}

// ── Rev 3 result directions (Group 5) ────────────────────────────────────────

export type ResultDirectionLabel = "most-you" | "fresh" | "push-me";

export interface DirectionOutfitPiece {
  slot: string;
  id: string;
  label: string | null;
  imageUrl: string | null;
}

export interface ResultDirection {
  label: ResultDirectionLabel;
  displayLabel: string;  // "MOST YOU" | "FRESH" | "PUSH ME"
  product: StyleMePrimaryProduct | null;
  directionalNote: string;
  outfitPieces?: DirectionOutfitPiece[];
}

// ── Full customer result (server-side only) ─────────────────────────────────

export interface StyleMeCustomerResult {
  outcome: StyleMeOutcome;
  outfitName: string;
  whyThisWorks: string;
  confidenceBoost: string;
  perfumeNote: string | null;
  primaryProduct: StyleMePrimaryProduct | null;
  alternatives: StyleMePrimaryProduct[];
  closetAnchorLabel: string | null;
  closetAnchorImageUrl: string | null;
  pairingNote: string | null;
  finishingLayer: StyleMeFinishingLayer;
  completionLayer: StyleMeCompletionPiece[];
  songReason: string;
  song: GetReadySong;
  rawRecommendation: StyleMeRecommendationResult;
  // Rev 3 — Psychology-First result directions (Group 5). Empty array for legacy sessions.
  resultDirections: ResultDirection[];
}

// ── Versioned metadata envelope (stored in OutfitSuggestion.moodDescription) ─

export interface StyleMeMetadata {
  schemaVersion: 1;
  outcome: StyleMeOutcome;
  primaryHandle: string | null;
  alternatives: Array<{
    handle: string;
    title: string;
    slot: string;
    stylingNotes: string;
    productImageUrl?: string | null;
    liveUrl?: string | null;
  }>;
  anchor: { type: "nadine"; handle: string } | { type: "closet"; id: string } | null;
  anchorSummary: string | null;
  anchorImageUrl?: string | null;
  anchorSlot?: string | null;
  pairingNote: string | null;
  colourDirection: string;
  songReason: string;
  evidenceCodes: string[];
  completionLayer?: StyleMeCompletionPiece[];
  // Rev 3 — Psychology-First result directions (Group 5).
  // Stored in metadata so direction identity survives session reload.
  // Absent on legacy sessions — consumers must guard with optional chaining.
  resultDirections?: Array<{
    label: string;
    displayLabel: string;
    directionalNote: string;
    handle: string | null;
    title: string | null;
    productUrl: string | null;
    productImageUrl: string | null;
    outfitPieces?: Array<{ slot: string; id: string; label: string | null; imageUrl: string | null }>;
  }>;
}

/**
 * Parses the moodDescription JSON envelope from an OutfitSuggestion row.
 * Returns null if the value is absent, malformed, or from a different schema version.
 */
export function parseSuggestionMetadata(
  moodDescription: string | null | undefined,
): StyleMeMetadata | null {
  if (!moodDescription) return null;
  try {
    const parsed = JSON.parse(moodDescription) as Record<string, unknown>;
    if (parsed.schemaVersion !== 1) return null;
    return parsed as unknown as StyleMeMetadata;
  } catch {
    return null;
  }
}

// ── DB-compatible payload ───────────────────────────────────────────────────

export type OutfitDbItemType =
  | "TOP"
  | "BOTTOM"
  | "DRESS"
  | "OUTERWEAR"
  | "SHOES"
  | "BAG"
  | "ACCESSORY"
  | "JEWELRY";

export interface StyleMeDbItem {
  itemType: OutfitDbItemType;
  productTitle: string | null;
  productImageUrl: string | null;
  shopifyProductId: string | null;
  closetItemId: string | null;
  stylingNotes: string | null;
  productUrl: string | null;
}

export interface StyleMeDbPayload {
  outfitName: string;
  whyThisWorks: string;
  confidenceBoost: string;
  perfumeRec: string | null;
  hairstyleRec: string | null;
  makeupVibeRec: string | null;
  songRec: string;       // formatted as: "Title" by Artist
  songArtist: string;
  items: StyleMeDbItem[];
  moodDescriptionJson: string;   // versioned JSON envelope for StyleMeMetadata
}
