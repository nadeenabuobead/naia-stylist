/**
 * StyleMe-feedback evidence for Wardrobe Intelligence — V1.
 *
 * Scope, locked by explicit product decision before this file existed:
 *
 *   - Evidence source is valid `StyleMeOutcome` submissions only. Passive
 *     StyleMe generation (sessions/suggestions with no outcome) is NOT
 *     evidence here — it continues to feed only the separate "untried"
 *     signal in wardrobe-intelligence.ts, unchanged by this file.
 *   - Historical formulas are reconstructed ONLY when every clothing-slot
 *     garment on the suggestion is still verifiably a current Closet item.
 *     A deletion-ambiguous or store-product slot excludes the whole
 *     formula — never a partial reconstruction.
 *   - "Distinct feedback event" = a calendar date, not a session/root
 *     lineage (session continuation chaining was checked against the real
 *     diagnostic customer and does not reliably separate genuine repeated
 *     wear from same-sitting duplicate regeneration — see conversation
 *     record). Multiple outcomes on the same formula on the same date
 *     collapse to one event; if they disagree, that date is mixed and
 *     contributes neither positive nor negative evidence.
 *   - "Calendar date" is the UTC calendar date of `submittedAt`. No
 *     per-customer or per-store timezone exists anywhere in this schema
 *     (checked) — UTC is the explicit, documented fallback, matching the
 *     same choice already made in usage-window.server.ts.
 *   - No recency decay in V1. `submittedAt` is used only to compute the
 *     calendar date above, never to weight evidence by age.
 *   - STRONGLY_SUPPORTED/SUPPORTED describe POSITIVE support only.
 *     Negative evidence (`changed-something`) is tracked as its own,
 *     separately-named signal — it is never described as "supported".
 *   - This module only derives evidence. It has no opinion on where that
 *     evidence may be used — that contract lives at each call site
 *     (buildPairings' tie-break-only rule, buildRediscover's priority
 *     adjustment).
 */

import { verifyFormulaGarmentIds, type RawOutfitItemFact } from "~/lib/ai/outfit-formula-integrity";
// Re-exported so every existing import of these two names from this module
// (callers and tests) keeps working unchanged — see
// outfit-formula-integrity.ts for the actual implementation, moved there
// as a pure extraction with zero behavior change.
export { verifyFormulaGarmentIds, type RawOutfitItemFact };

/** Distinct qualifying dates needed before a formula counts as strongly
 * supported. This is the single canonical home for this threshold —
 * wardrobe-needs.ts imports it from here (rather than the reverse) so the
 * evidence layer never has to depend on the needs-synthesis layer, which
 * would otherwise create a circular import back through wardrobe-
 * intelligence.ts. */
export const MIN_OUTCOMES_FOR_CLAIM = 3;

export type RawOutcomeStatus = "wore-it" | "changed-something" | "didnt-wear-it";

/** changeTypes values that name a slot, mapped to the OutfitItemType that
 * slot corresponds to. Only these can ever produce garment-level
 * attribution — every other changeTypes value (fit/formality/colour/etc.)
 * is real feedback but about the formula, not a specific garment, and must
 * stay at the formula level. */
const SLOT_CHANGE_TYPE_TO_ITEM_TYPE: Readonly<Record<string, string>> = {
  top: "TOP",
  bottom: "BOTTOM",
  shoes: "SHOES",
  layer: "OUTERWEAR",
};

export interface RawOutcomeFact {
  outcomeId: string;
  suggestionId: string;
  outcomeStatus: RawOutcomeStatus;
  changeTypes: readonly string[];
  submittedAt: Date;
  items: readonly RawOutfitItemFact[];
}

export type FormulaSupportState = "none" | "supported" | "strongly-supported";

export interface FormulaEvidence {
  formulaKey: string;
  garmentIds: string[];
  positiveDates: string[];
  negativeDates: string[];
  mixedDates: string[];
  state: FormulaSupportState;
  hasNegativeEvidence: boolean;
}

export interface GarmentPositiveEvidence {
  closetItemId: string;
  positiveDates: string[];
}

function sortedJoin(ids: string[]): string {
  return [...ids].sort().join("|");
}

function utcDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** wore-it is positive, changed-something is negative, didnt-wear-it
 * carries no polarity at all in V1 (we don't collect why, so it is neither
 * claimed positive nor negative — simply excluded from this ladder). */
function polarityOf(status: RawOutcomeStatus): "positive" | "negative" | null {
  if (status === "wore-it") return "positive";
  if (status === "changed-something") return "negative";
  return null;
}

export function deriveFormulaEvidence(outcomes: readonly RawOutcomeFact[]): Map<string, FormulaEvidence> {
  // formulaKey -> date -> polarities seen that day
  const byFormula = new Map<string, { garmentIds: string[]; byDate: Map<string, Set<"positive" | "negative">> }>();

  for (const outcome of outcomes) {
    const garmentIds = verifyFormulaGarmentIds(outcome.items);
    if (!garmentIds) continue; // unverifiable formula — excluded, not reconstructed

    const polarity = polarityOf(outcome.outcomeStatus);
    if (!polarity) continue; // didnt-wear-it — no polarity claimed in V1

    const formulaKey = sortedJoin(garmentIds);
    const date = utcDateString(outcome.submittedAt);

    let entry = byFormula.get(formulaKey);
    if (!entry) {
      entry = { garmentIds, byDate: new Map() };
      byFormula.set(formulaKey, entry);
    }
    const seenToday = entry.byDate.get(date) ?? new Set<"positive" | "negative">();
    seenToday.add(polarity);
    entry.byDate.set(date, seenToday);
  }

  const result = new Map<string, FormulaEvidence>();
  for (const [formulaKey, { garmentIds, byDate }] of byFormula) {
    const positiveDates: string[] = [];
    const negativeDates: string[] = [];
    const mixedDates: string[] = [];
    for (const [date, polarities] of byDate) {
      if (polarities.size > 1) {
        mixedDates.push(date); // same-day conflict — contributes to neither
      } else if (polarities.has("positive")) {
        positiveDates.push(date);
      } else {
        negativeDates.push(date);
      }
    }
    positiveDates.sort();
    negativeDates.sort();
    mixedDates.sort();

    const state: FormulaSupportState =
      positiveDates.length >= MIN_OUTCOMES_FOR_CLAIM ? "strongly-supported"
      : positiveDates.length >= 1 ? "supported"
      : "none";

    result.set(formulaKey, {
      formulaKey,
      garmentIds,
      positiveDates,
      negativeDates,
      mixedDates,
      state,
      hasNegativeEvidence: negativeDates.length > 0,
    });
  }
  return result;
}

/** Every garment in a formula with at least one verified positive date
 * gets credit on that date — used only to adjust rediscovery PRIORITY
 * (never to rewrite the structural "difficult to style" relationship tag
 * itself, and never at the level of a single ambiguous slot — that is a
 * different, narrower mechanism, see deriveSlotChangeAttribution below). */
export function derivePositiveGarmentEvidence(
  formulaEvidence: ReadonlyMap<string, FormulaEvidence>,
): Map<string, GarmentPositiveEvidence> {
  const out = new Map<string, GarmentPositiveEvidence>();
  for (const evidence of formulaEvidence.values()) {
    if (evidence.positiveDates.length === 0) continue;
    for (const garmentId of evidence.garmentIds) {
      const existing = out.get(garmentId) ?? { closetItemId: garmentId, positiveDates: [] };
      const merged = new Set([...existing.positiveDates, ...evidence.positiveDates]);
      out.set(garmentId, { closetItemId: garmentId, positiveDates: [...merged].sort() });
    }
  }
  return out;
}

/**
 * For a single `changed-something` outcome, returns the closetItemIds that
 * can be SAFELY attributed to that specific change — only when a slot tag
 * in `changeTypes` matches exactly one item of that slot type on the
 * suggestion. Zero or multiple matching items for a slot tag means the
 * attribution is ambiguous and is withheld entirely for that tag; nothing
 * is guessed. Non-slot changeTypes (fit/formality/colour/etc.) never
 * attribute to a garment at all — they are formula-level feedback only.
 *
 * Diagnostic-only in V1: this is not wired into any live ranking or copy
 * yet (see conversation record) — it exists so the trace can show it, and
 * so the "never guess" invariant is independently testable.
 */
export function deriveSlotChangeAttribution(outcome: RawOutcomeFact): string[] {
  if (outcome.outcomeStatus !== "changed-something") return [];
  const attributed: string[] = [];
  for (const changeType of outcome.changeTypes) {
    const itemType = SLOT_CHANGE_TYPE_TO_ITEM_TYPE[changeType];
    if (!itemType) continue; // not a slot tag — formula-level only
    const matching = outcome.items.filter((i) => i.itemType === itemType);
    if (matching.length !== 1) continue; // ambiguous (zero or multiple) — withheld
    const id = matching[0].closetItemId;
    if (id) attributed.push(id);
  }
  return attributed;
}

export function evidenceTierRank(state: FormulaSupportState): number {
  return state === "strongly-supported" ? 2 : state === "supported" ? 1 : 0;
}
