// app/lib/trend-taste-evidence.ts
//
// Turning deliberate Trend Report actions into Taste Evidence.
//
//   SAVE         positive — something caught her interest
//   STYLE THIS   positive — interest in WEARING it. Never proof she wore it.
//   NOT FOR ME   negative — an explicit preference against this direction
//
// Viewing, opening, expanding "see my pieces", replaying history and looking at
// My Saved produce NOTHING. Browsing is not taste.
//
// ── ONLY DIMENSIONS THAT ARE HONEST ──────────────────────────────────────────
// The V1 taste vocabulary is closed: self-expression, comfort, formality, fit,
// garment-category. Of the eight matchable facet kinds, exactly ONE maps:
//
//   category  → garment-category      honest: BAGS is BAGS
//
// formality does NOT map, despite looking like it should. Its only values are
// "too-formal" and "too-casual" — it records a garment being WRONG for an
// occasion, not a preference for a register. Mapping a trend's
// formalityBand:["smart-casual"] onto it would file a liking as a complaint.
//
// colourFamily, material, silhouette, pattern and visualWeight have no honest
// V1 dimension at all. Nothing is forced. The raw feedback is still persisted
// in TrendContentFeedback, so a future Taste V2 can use what V1 cannot express.

import {
  SOURCE_BASE_STRENGTH,
  clampStrength,
  type TasteEvidenceInsert,
  type TastePolarity,
} from "./ai/taste-contract";
import { matchableFacets, type TrendFacets } from "./trend-facets";

export const TREND_ACTIONS = ["SAVE", "STYLED", "NOT_FOR_ME"] as const;
export type TrendAction = (typeof TREND_ACTIONS)[number];

export function isTrendAction(value: unknown): value is TrendAction {
  return typeof value === "string" && (TREND_ACTIONS as readonly string[]).includes(value);
}

const POLARITY: Readonly<Record<TrendAction, TastePolarity>> = {
  SAVE:        "positive",
  STYLED:      "positive",
  NOT_FOR_ME:  "negative",
};

/** What each action actually means, for provenance. Never "wore". */
const RULE: Readonly<Record<TrendAction, string>> = {
  SAVE:       "trend-save-v1",
  STYLED:     "trend-style-intent-v1",
  NOT_FOR_ME: "trend-dismissal-v1",
};

export interface TrendEvidenceInput {
  customerId: string;
  /** The durable row this evidence belongs to — a SavedItem or a feedback row. */
  sourceRecordId: string;
  action: TrendAction;
  /** The authored facets of the content acted on. */
  facets: TrendFacets | null | undefined;
  occurredAt: Date;
}

/**
 * Evidence rows for one deliberate action.
 *
 * Returns an empty array when the content has no honestly mappable facet —
 * which is the common case, and correct. A colour direction produces no taste
 * evidence in V1 rather than being bent into a dimension that does not mean it.
 */
export function extractTrendEvidence(input: TrendEvidenceInput): TasteEvidenceInsert[] {
  if (!isTrendAction(input.action)) return [];

  // construction is stripped here too — it is not matchable and not evidence.
  const facets = matchableFacets(input.facets);
  const categories = facets.category ?? [];
  if (categories.length === 0) return [];

  const polarity = POLARITY[input.action];
  const strength = clampStrength(SOURCE_BASE_STRENGTH.TREND_ENGAGEMENT);

  return categories.map((category) => ({
    customerId: input.customerId,
    source: "TREND_ENGAGEMENT" as const,
    sourceRecordId: input.sourceRecordId,
    dimension: "garment-category",
    value: category.toUpperCase(),
    polarity,
    strength,
    provenance: {
      extractionRule: RULE[input.action],
      sourceFields: ["facets.category"],
      rawValues: [category],
    },
    occurredAt: input.occurredAt,
  }));
}

/**
 * True when acting on this content can produce evidence at all.
 * Used to avoid writing empty evidence sets for content V1 cannot represent.
 */
export function producesEvidence(facets: TrendFacets | null | undefined): boolean {
  return (matchableFacets(facets).category?.length ?? 0) > 0;
}
