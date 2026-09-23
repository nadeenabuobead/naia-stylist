// app/lib/trend-closet-match.ts
//
// TREND ↔ CLOSET MATCHING — structured, conservative, pure.
//
// Replaces the old text-coincidence matcher for the customer-facing claim.
// That one flattened editorial prose into a string and regex-matched closet
// fields into it, then scored on whether a garment happened to have a name and
// an image. This one compares one trend's AUTHORED FACETS against resolved
// garment facts from Wardrobe Intelligence.
//
// It never classifies a garment, calls AI, reads a garment's name looking for
// trend words, or touches report prose. loadWardrobeIntelligence() is the only
// source of garment truth.
//
// ── QUALIFICATION ────────────────────────────────────────────────────────────
//
//   within one facet kind   OR    silhouette: [tailored, straight] → either
//   across facet kinds      AND   every authored kind must match
//
// AND across kinds is what stops a straight trench qualifying for "Longline
// blazers" on OUTERWEAR + straight alone, or casual straight jeans qualifying
// for "Softened tailoring" because one facet happened to line up. A trend that
// names three things is asking for all three.
//
// Two rules sit alongside it:
//
//   SCOPE       category must match when declared, but can never qualify on its
//               own — owning a bag is not evidence of a bag DIRECTION. A trend
//               needs at least one directional facet to be matchable at all.
//
//   IGNORED     construction is authored but unavailable, and is removed BEFORE
//               the AND is evaluated — an unavailable facet must not make an
//               otherwise matchable trend impossible to satisfy.
//
// No claim is better than a weak claim.

import {
  FACET_KINDS,
  matchableFacets,
  type FacetKind,
  type TrendFacets,
} from "./trend-facets";
import {
  PASSPORT_COLOUR_FAMILIES,
  closetColourFamily,
  type WardrobeGarment,
} from "./ai/wardrobe-intelligence";

// ── Facet roles ───────────────────────────────────────────────────────────────

/** Constrains eligibility. Never evidence on its own. */
export const SCOPE_FACETS: ReadonlySet<FacetKind> = new Set(["category"]);

/** Carries the actual claim that a garment belongs to a direction. */
export const DIRECTIONAL_FACETS: readonly FacetKind[] = FACET_KINDS.filter(
  (k) => !SCOPE_FACETS.has(k) && k !== "construction",
);

/**
 * How specific a matched facet is.
 *
 * Primarily this orders the EVIDENCE inside a reason, so the sentence leads with
 * the strongest thing that matched. It also feeds the ranking score — though
 * under AND-across-kinds every qualifying garment has cleared the same bar, so
 * they legitimately tie and fall through to a deterministic id order. Ranking
 * them further would invent a distinction the evidence does not support.
 *
 * Never a number shown to anyone.
 */
const SPECIFICITY: Readonly<Record<string, number>> = {
  subcategory:   5,
  material:      4,
  colourFamily:  3,
  pattern:       3,
  silhouette:    2,
  visualWeight:  1,
  formalityBand: 1,
};

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MatchEvidence {
  kind: FacetKind;
  /** The authored facet value that matched. */
  facetValue: string;
  /** The garment's own value that satisfied it. */
  garmentValue: string;
}

export interface MatchedGarment {
  garmentId: string;
  name: string | null;
  category: string;
  imageUrl: string | null;
  /** Concise, built only from evidence that actually matched. */
  reason: string;
  evidence: MatchEvidence[];
  /** Ranking only. Never rendered, never a percentage. */
  score: number;
}

export interface TrendClosetMatch {
  /** The stable content id this was matched against — never a whole report. */
  contentId: string;
  /** Every qualifying piece in the full closet. */
  matchCount: number;
  /** Ranked, strongest connection first. */
  matches: MatchedGarment[];
  /**
   * False when the trend has no matchable directional facets — an unauthored
   * trend, or one that is only scope or only construction. The UI shows nothing
   * rather than a count of zero, because "0 pieces connect" is a claim too.
   */
  available: boolean;
}

// ── Garment-side resolution ───────────────────────────────────────────────────
//
// Each returns the garment's value for a facet kind, or null when the garment
// has nothing to say. Null NEVER matches: missing intelligence must not be
// read as agreement.

function garmentValuesFor(kind: FacetKind, garment: WardrobeGarment): string[] {
  switch (kind) {
    case "category":
      return garment.category ? [garment.category.toUpperCase()] : [];
    case "subcategory":
      return garment.subcategory ? [garment.subcategory.toLowerCase()] : [];
    case "material":
      return garment.material ? [garment.material.toLowerCase()] : [];
    case "pattern":
      return garment.pattern ? [garment.pattern.toLowerCase()] : [];
    case "formalityBand":
      return garment.formality ? [garment.formality.toLowerCase()] : [];
    case "visualWeight":
      return garment.visualWeight ? [garment.visualWeight.toLowerCase()] : [];
    case "silhouette": {
      // Two resolved fields describe shape; either may carry the direction.
      const out: string[] = [];
      if (garment.silhouette) out.push(garment.silhouette.toLowerCase());
      if (garment.fitProfile) out.push(garment.fitProfile.toLowerCase());
      return out;
    }
    case "colourFamily": {
      // The canonical bridge, exported by Wardrobe Intelligence. No second map.
      const family = closetColourFamily(garment.primaryColor);
      return family ? [family] : [];
    }
    default:
      return [];
  }
}

/** Does this garment satisfy one authored facet value? */
function satisfies(kind: FacetKind, facetValue: string, garment: WardrobeGarment): string | null {
  const values = garmentValuesFor(kind, garment);
  if (values.length === 0) return null;

  if (kind === "colourFamily") {
    // "red-burgundy" covers the closet families ["red", "burgundy"].
    const covered = PASSPORT_COLOUR_FAMILIES[facetValue.toLowerCase()] ?? [];
    const hit = values.find((v) => covered.includes(v));
    return hit ?? null;
  }

  const needle = kind === "category" ? facetValue.toUpperCase() : facetValue.toLowerCase();
  return values.find((v) => v === needle) ?? null;
}

// ── Reason copy ───────────────────────────────────────────────────────────────
//
// Only ever names evidence that matched. No percentages, no internal tokens.

function phraseFor(e: MatchEvidence): string {
  const v = e.garmentValue;
  switch (e.kind) {
    case "material":      return `its ${v}`;
    case "colourFamily":  return `its ${v}`;
    case "subcategory":   return `its ${v} shape`;
    case "silhouette":    return `its ${v} line`;
    case "pattern":       return v === "solid" ? "its plain surface" : `its ${v}`;
    case "formalityBand": return `its ${v.replace(/-/g, " ")} register`;
    case "visualWeight":  return `its ${v} presence`;
    default:              return `its ${v}`;
  }
}

/**
 * One sentence, from at most the two strongest pieces of evidence. Longer than
 * that stops reading as a reason and starts reading as a readout.
 */
export function buildReason(evidence: MatchEvidence[]): string {
  const ranked = [...evidence].sort(
    (a, b) => (SPECIFICITY[b.kind] ?? 0) - (SPECIFICITY[a.kind] ?? 0),
  );
  const parts = ranked.slice(0, 2).map(phraseFor);
  const joined = parts.length === 2 ? `${parts[0]} and ${parts[1]}` : parts[0];
  const sentence = `Already connects through ${joined}.`;
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

// ── The matcher ───────────────────────────────────────────────────────────────

export interface MatchTrendInput {
  /** Stable content id. Matching is always against ONE content unit. */
  contentId: string;
  /** Validated authored facets for that unit. */
  facets: TrendFacets | null | undefined;
  /** Full resolved closet from loadWardrobeIntelligence(). */
  garments: readonly WardrobeGarment[];
}

export function matchTrendToCloset(input: MatchTrendInput): TrendClosetMatch {
  const empty: TrendClosetMatch = {
    contentId: input.contentId,
    matchCount: 0,
    matches: [],
    available: false,
  };

  // construction is stripped here — authored, but Wardrobe Intelligence exposes
  // no resolved construction field, and it must never be inferred from
  // silhouette, visual weight, material or fit.
  const facets = matchableFacets(input.facets);

  const directional = DIRECTIONAL_FACETS.filter((k) => (facets[k]?.length ?? 0) > 0);
  if (directional.length === 0) return empty;   // scope-only, or nothing authored

  const scopeCategories = facets.category ?? [];
  const seen = new Set<string>();
  const matches: MatchedGarment[] = [];

  for (const garment of input.garments) {
    if (seen.has(garment.id)) continue;         // never count one piece twice

    // Scope constraint: a declared category can only disqualify.
    if (scopeCategories.length > 0) {
      const inScope = scopeCategories.some((c) => satisfies("category", c, garment) !== null);
      if (!inScope) continue;
    }

    // AND across kinds: every authored directional kind must be satisfied.
    const evidence: MatchEvidence[] = [];
    let satisfiedAll = true;
    for (const kind of directional) {
      let hit: MatchEvidence | null = null;
      for (const facetValue of facets[kind] ?? []) {
        const garmentValue = satisfies(kind, facetValue, garment);
        if (garmentValue !== null) {
          // Within one facet kind values are OR — one hit is enough.
          hit = { kind, facetValue, garmentValue };
          break;
        }
      }
      if (!hit) { satisfiedAll = false; break; }
      evidence.push(hit);
    }

    if (!satisfiedAll || evidence.length === 0) continue;

    const specificity = evidence.reduce((n, e) => n + (SPECIFICITY[e.kind] ?? 0), 0);
    const categoryBonus = scopeCategories.length > 0 ? 1 : 0;

    seen.add(garment.id);
    matches.push({
      garmentId: garment.id,
      name: garment.name,
      category: garment.category,
      imageUrl: garment.imageUrl,
      reason: buildReason(evidence),
      evidence,
      // Every qualifying garment satisfies the same kinds, so specificity and
      // the category bonus do the ordering. The count term is retained for
      // trends whose garments can differ in how many OR-values they hit.
      score: evidence.length * 100 + specificity + categoryBonus,
    });
  }

  matches.sort((a, b) =>
    b.score - a.score ||
    // Deterministic tie-break — never name or image presence, which is what the
    // old matcher scored on and is not evidence of anything.
    (a.garmentId < b.garmentId ? -1 : a.garmentId > b.garmentId ? 1 : 0),
  );

  return {
    contentId: input.contentId,
    matchCount: matches.length,
    matches,
    available: true,
  };
}

/** Match several content units independently. Never flattens a whole report. */
export function matchTrendsToCloset(
  units: ReadonlyArray<{ contentId: string; facets: TrendFacets | null | undefined }>,
  garments: readonly WardrobeGarment[],
): TrendClosetMatch[] {
  return units.map((u) => matchTrendToCloset({ ...u, garments }));
}
