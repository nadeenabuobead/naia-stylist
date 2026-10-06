// app/lib/styleme/nadine-fallback-note.ts
//
// She chose "NADINE + MY CLOSET", no live NADINE product qualified, and the page said
// nothing — so a deliberate styling decision looked identical to having chosen
// "MY CLOSET". The engine was right; the result page was silent.
//
// This is a read-only reading of persisted metadata. It cannot influence selection, and
// deliberately takes no dependency on the selector or on any data access.
//
// Not an error state. Closet-only was the correct call: no catalogue candidate cleared
// the threshold for her occasion and preferences, and a closet anchor was already
// carrying the look.

import type { StyleMeMetadata } from "../ai/styleme-result.types.js";

/** The approved sentences. Pinned by ZNH-C.1 so the explanation cannot drift. */
export const NO_NADINE_HERO_NOTE =
  "No NADINE piece was the right fit for this look today. " +
  "I kept this one to pieces you already own rather than forcing something " +
  "that didn't fit your occasion or preferences.";

/**
 * True only for the genuine NADINE + My Closet fallback.
 *
 *   mode === "nadine"             she asked for NADINE merchandise. The source screen sets
 *                                 this only for (NADINE entry + source "both"); every other
 *                                 door sets "naia". OPTIONAL in StyleMeMetadata, so a legacy
 *                                 suggestion carries none — and absence must never qualify,
 *                                 or history would sprout a note it never earned.
 *
 *   anchor.type !== "nadine"      excludes the PDP explicit-anchor flow. mode alone cannot:
 *                                 api.styleme-handoff.tsx sets mode "nadine" as well, because
 *                                 tapping a product IS a request for that product. There the
 *                                 NADINE piece is the anchor, so nothing fell back.
 *
 *   outcome === "closet-led"      the engine's own verdict when no candidate cleared the
 *   && primaryHandle === null     threshold while a closet anchor existed. Both are checked:
 *                                 they are two independent records of the same fact, and a
 *                                 disagreement between them is not something to paper over.
 *
 * "no-eligible-product" is deliberately excluded — there nothing anchored the look at all,
 * which is not "I kept this to pieces you already own".
 */
export function shouldExplainNoNadineHero(
  meta: Pick<StyleMeMetadata, "mode" | "outcome" | "anchor" | "primaryHandle"> | null | undefined,
): boolean {
  if (!meta) return false;
  if (meta.mode !== "nadine") return false;
  if (meta.anchor?.type === "nadine") return false;
  return meta.outcome === "closet-led" && meta.primaryHandle === null;
}
