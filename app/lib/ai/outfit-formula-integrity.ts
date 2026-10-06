/**
 * Shared "is this historical formula still verifiable against the current
 * Closet?" primitive.
 *
 * Extracted from wardrobe-feedback-evidence.ts (StyleMe-feedback V1) so it
 * can be reused by other callers in the Shared Integration work (e.g. a
 * future STYLEME_DEMAND extraction) without importing that module's
 * evidence-tier/dedup logic along with it. Pure extraction — no behavior
 * change from the original.
 */

/** The clothing-relevant slots a "formula" is built from. Shoes/bag/
 * accessory/jewelry are real OutfitItem types but are not part of formula
 * identity for this check. */
const FORMULA_SLOT_TYPES: ReadonlySet<string> = new Set(["TOP", "BOTTOM", "DRESS", "OUTERWEAR"]);

export interface RawOutfitItemFact {
  closetItemId: string | null;
  itemType: string;
  shopifyProductId: string | null;
}

/**
 * A formula is verifiable only when every clothing-slot item on the
 * suggestion is still a real, current Closet item — never a partial
 * reconstruction of a historical look. Returns null (excluded) when any
 * formula-relevant slot is deletion-ambiguous (closetItemId and
 * shopifyProductId both null — a Closet garment that has since been
 * deleted) or was never a Closet item at all (a store-product
 * recommendation occupying a formula slot).
 */
export function verifyFormulaGarmentIds(items: readonly RawOutfitItemFact[]): string[] | null {
  const formulaSlotItems = items.filter((i) => FORMULA_SLOT_TYPES.has(i.itemType));
  if (formulaSlotItems.length < 2) return null;
  const ids: string[] = [];
  for (const item of formulaSlotItems) {
    if (item.closetItemId) {
      ids.push(item.closetItemId);
      continue;
    }
    // Any null here — deletion-ambiguous or a store-product slot — makes
    // the whole formula unverifiable. Fail conservatively; do not guess.
    return null;
  }
  return [...ids].sort();
}
