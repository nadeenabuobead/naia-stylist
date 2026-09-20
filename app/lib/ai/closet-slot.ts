// app/lib/ai/closet-slot.ts
// Canonical slot resolver for Closet items.
// Standard categories have a direct 1:1 map. ACTIVEWEAR and LOUNGEWEAR use
// subcategory word-tokenisation to distinguish bottom / top / outerwear.
// Fails open to "top" for ACTIVEWEAR/LOUNGEWEAR when subcategory is absent
// or unrecognised, which is the most common case (sports tops, bras, tanks).

import type { OutfitSlot } from "./styleme-recommendation.types.js";

const DIRECT_SLOT_MAP: Record<string, OutfitSlot> = {
  TOPS: "top",
  BOTTOMS: "bottom",
  DRESSES: "dress",
  SETS: "set",
  OUTERWEAR: "outerwear",
  SHOES: "shoe",
  BAGS: "bag",
  ACCESSORIES: "accessory",
  JEWELRY: "jewelry",
};

const BOTTOM_TOKENS = new Set([
  "jogger", "joggers", "sweatpant", "sweatpants",
  "track pant", "track pants", "trackpant", "trackpants",
  "yoga pant", "yoga pants",
  "legging", "leggings",
  "bike short", "bike shorts",
  "athletic short", "athletic shorts",
  "short", "shorts",
  "bottom", "bottoms",
  "capri", "capris",
  "skirt", "skirts",
]);

const OUTERWEAR_TOKENS = new Set([
  "jacket", "jackets",
  "track jacket", "zip-up", "zip up",
  "windbreaker", "windbreakers",
  "hoodie", "hoodies",
  "sweatshirt", "sweatshirts",
  "pullover", "pullovers",
  "fleece", "vest", "vests",
  "outerwear",
]);

const SET_TOKENS = new Set([
  "set", "sets",
  "matching set", "matching sets",
  "co-ord", "co-ords",
  "coord", "coords",
  "co ord", "co ords",
]);

function normalise(s: string): string {
  return s.toLowerCase().replace(/[_\-]+/g, " ").trim();
}

function matchesAny(norm: string, tokens: Set<string>): boolean {
  for (const token of tokens) {
    if (norm === token || norm.includes(token)) return true;
  }
  return false;
}

/**
 * Returns the OutfitSlot for a Closet item.
 * For standard categories the result is the direct map entry.
 * For ACTIVEWEAR / LOUNGEWEAR, subcategory word-tokenisation determines
 * whether the item occupies the bottom, outerwear, or top (default) slot.
 */
export function closetItemToSlot(
  category: string,
  subcategory?: string | null,
): OutfitSlot {
  const direct = DIRECT_SLOT_MAP[category];
  if (direct !== undefined) return direct;

  if (category === "ACTIVEWEAR" || category === "LOUNGEWEAR") {
    if (subcategory) {
      const norm = normalise(subcategory);
      if (matchesAny(norm, SET_TOKENS)) return "set";
      if (matchesAny(norm, BOTTOM_TOKENS)) return "bottom";
      if (matchesAny(norm, OUTERWEAR_TOKENS)) return "outerwear";
    }
    return "top";
  }

  return "unknown";
}
