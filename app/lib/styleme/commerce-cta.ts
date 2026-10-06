// app/lib/styleme/commerce-cta.ts
//
// The commerce CTA at the bottom of a result: which brand it names, and where it sends her.
//
// nAia is the stylist. NADINE is the brand she is buying. The footer named nAia for every
// result that was not closet-led — including results whose hero IS a NADINE garment — so at
// the one moment she is asked to buy, it credited the wrong party.
//
// Three independent signals say "this result is NADINE commerce", and none is sufficient
// alone:
//
//   outcome === "nadine-recommendation"  authoritative when present, but a NADINE product
//                                        can ride along under other outcomes
//   mode === "nadine"                    the session's product context — OPTIONAL in
//                                        StyleMeMetadata, absent on every suggestion
//                                        persisted before the field existed, so a
//                                        mode-only rule would relabel all history as nAia
//   a purchasable item in the look        ground truth, and the only signal legacy rows
//                                        still carry
//
// Any one of them means NADINE; only the absence of all three leaves the nAia label. This
// deliberately does NOT rename the label globally — a genuinely nAia-context result (an
// all-owned look, or no eligible product) keeps it.
//
// Kept pure and free of server imports so the whole combination space can be pinned
// directly; the render site is pinned separately in commerce-cta.test.ts (CC-E).

export const CTA_LABEL_NADINE = "Shop NADINE";
export const CTA_LABEL_NAIA = "Shop nAia";
export const NADINE_STOREFRONT_URL = "https://naiabynadine.com";

/** Slots that dress the look but are not its hero. */
const ACCESSORY_TYPES: ReadonlySet<string> = new Set(["SHOES", "ACCESSORY", "BAG"]);

export interface CommerceCtaItem {
  itemType?: string | null;
  closetItemId?: string | null;
  productUrl?: string | null;
}

export interface CommerceCtaInput {
  outcome?: string | null;
  mode?: string | null;
  items?: readonly CommerceCtaItem[] | null;
}

/**
 * A piece in the look that can actually be bought: not something she already owns, and with
 * somewhere to go. An unfilled slot carries no closetItemId and no productUrl — it is
 * guidance, not merchandise, and must not make this a commerce result.
 */
export function findNadineProductItem(
  items: readonly CommerceCtaItem[] | null | undefined,
): CommerceCtaItem | null {
  const purchasable = (items ?? []).filter((i) => !i.closetItemId && !!i.productUrl);
  // The hero of a look is the garment, so prefer one over a shoe or bag — but fall back to
  // an accessory when that is the only NADINE piece present.
  return (
    purchasable.find((i) => !ACCESSORY_TYPES.has(String(i.itemType))) ??
    purchasable[0] ??
    null
  );
}

export function isNadineCommerceContext(input: CommerceCtaInput): boolean {
  return (
    input.outcome === "nadine-recommendation" ||
    input.mode === "nadine" ||
    findNadineProductItem(input.items) !== null
  );
}

export function resolveCommerceCtaLabel(input: CommerceCtaInput): string {
  return isNadineCommerceContext(input) ? CTA_LABEL_NADINE : CTA_LABEL_NAIA;
}

/**
 * The product she is being sent to, or NADINE's storefront when the result names no
 * specific piece. Resolved from the purchasable item rather than from "the first
 * non-accessory item in the look": in a mixed look a closet top ahead of the NADINE bottom
 * used to send her to the homepage instead of the piece she was just shown.
 */
export function resolveCommerceCtaHref(input: CommerceCtaInput): string {
  return findNadineProductItem(input.items)?.productUrl || NADINE_STOREFRONT_URL;
}
