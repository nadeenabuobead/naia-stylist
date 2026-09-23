// app/lib/trend-facets.ts
//
// PER-TREND FACETS — the machine-readable description of what an individual
// trend actually is, so it can be matched against Garment Intelligence.
//
// ── WHY PER TREND, NOT PER REPORT ────────────────────────────────────────────
// One Autumn Edit carries New Bag Shapes, Suede Textures, Burgundy and Relaxed
// Tailoring. Those match four different parts of a wardrobe. A report-level
// facet set would blur them into one and produce a vague "you already own 6
// pieces" claim that means nothing. Facets therefore belong to the content
// entry, alongside its stable id.
//
// ── WHY THIS VOCABULARY ──────────────────────────────────────────────────────
// Every token below is one Garment Intelligence already resolves per garment, so
// both sides of the comparison speak the same language and no second
// classification engine is needed:
//
//   category      → ClosetItem.category
//   subcategory   → ClosetItem.subcategory
//   material      → ClosetItem.material            (GARMENT_MATERIAL_VALUES)
//   colourFamily  → primaryColor / colors[] resolved to a Passport colour family
//   silhouette    → ClosetItem.silhouette + fitProfile
//   pattern       → ClosetItem.pattern             (GARMENT_PATTERN_VALUES)
//   formalityBand → ClosetItem.formality           (GARMENT_FORMALITY_VALUES)
//   visualWeight  → resolved visual weight         (light | medium | substantial)
//   construction  → curated construction           (CONSTRUCTION_VALUES)
//
// visualWeight and construction are DIFFERENT AXES and an earlier draft wrongly
// merged them. "soft" is a construction value; it is not a visual weight. A bag
// trend about soft, unstructured shapes is construction:["soft"], and forcing it
// into visualWeight would have matched against a field that can never hold it.
//
// Occasion, lifestyle and season are deliberately ABSENT. They already inform
// personal relevance through the Passport inside buildShopperEdit, and matching
// a garment on context rather than on what the garment IS would produce
// confident-sounding matches with nothing behind them.
//
// This module is pure: no DB, no LLM, no I/O. Matching itself lands in step 5.

import {
  GARMENT_MATERIAL_VALUES,
  GARMENT_PATTERN_VALUES,
  GARMENT_FORMALITY_VALUES,
  GARMENT_SILHOUETTE_VALUES,
  FIT_PROFILE_VALUES,
} from "./ai/garment-intelligence.types";
import { COLOUR_FAMILIES } from "./onboarding/quiz-data";
import { CLOSET_CATEGORY_SET } from "./ai/closet-categories";
import { CONSTRUCTION_VALUES } from "./admin/styleme-garment-profile.vocab";
// Type-only — erased at build. Guards the visual-weight list against the
// authoritative derived-intelligence type so the two cannot drift.
import type { VisualWeight as ResolvedVisualWeight } from "./admin/garment-intelligence-v1.server";

// ── Facet kinds ───────────────────────────────────────────────────────────────

export const FACET_KINDS = [
  "category",
  "subcategory",
  "material",
  "colourFamily",
  "silhouette",
  "pattern",
  "formalityBand",
  "visualWeight",
  "construction",
] as const;

export type FacetKind = (typeof FACET_KINDS)[number];

export function isFacetKind(value: unknown): value is FacetKind {
  return typeof value === "string" && (FACET_KINDS as readonly string[]).includes(value);
}

/** Customer-facing label per kind — used when a saved facet is rendered in My Saved. */
export const FACET_KIND_LABELS: Readonly<Record<FacetKind, string>> = {
  category:      "Category",
  subcategory:   "Shape",
  material:      "Material",
  colourFamily:  "Colour",
  silhouette:    "Silhouette",
  pattern:       "Pattern",
  formalityBand: "Formality",
  visualWeight:  "Visual weight",
  construction:  "Structure",
};

// ── Vocabularies ──────────────────────────────────────────────────────────────

/** ClosetCategory values, compile-time guarded against the Prisma enum. */
export const FACET_CATEGORY_VALUES: ReadonlySet<string> = CLOSET_CATEGORY_SET;

/** Passport colour-family ids — the vocabulary favourite/avoid matching already uses. */
export const FACET_COLOUR_FAMILY_VALUES: ReadonlySet<string> = new Set(
  COLOUR_FAMILIES.map((c) => c.id),
);

/**
 * Silhouette accepts observable garment shape AND fit profile. A trend like
 * Relaxed Tailoring is expressed as a fit ("relaxed"); one like Balloon Shapes
 * is expressed as a silhouette. Both resolve per garment, so both are allowed.
 */
export const FACET_SILHOUETTE_VALUES: ReadonlySet<string> = new Set(
  // "n/a" is FitProfile's not-applicable placeholder, not a shape. Same reason
  // construction drops "N/A": an authoring placeholder is never a trend direction.
  [...GARMENT_SILHOUETTE_VALUES, ...FIT_PROFILE_VALUES].filter((v) => v !== "n/a"),
);

/**
 * Resolved visual weight, as Wardrobe Intelligence resolves it per garment.
 * Curated profiles store "heavy"; the loader maps it to "substantial", so the
 * RESOLVED vocabulary is the one a facet must target.
 *
 * The satisfies clause below is the drift guard: this list must be exactly the
 * authoritative ResolvedVisualWeight union, or the build fails.
 */
const VISUAL_WEIGHT_TOKENS = ["light", "medium", "substantial"] as const satisfies readonly ResolvedVisualWeight[];

type _WeightExhaustive = Exclude<ResolvedVisualWeight, (typeof VISUAL_WEIGHT_TOKENS)[number]> extends never
  ? true
  : never;
const _weightGuard: _WeightExhaustive = true;
void _weightGuard;

export const FACET_VISUAL_WEIGHT_VALUES: ReadonlySet<string> = new Set(VISUAL_WEIGHT_TOKENS);

/**
 * Curated construction, imported directly from the StyleMe garment-profile
 * vocabulary — one shared list, no copy. "N/A" is dropped: it is an authoring
 * placeholder meaning "not applicable to this garment", never a trend direction.
 */
export const FACET_CONSTRUCTION_VALUES: ReadonlySet<string> = new Set(
  CONSTRUCTION_VALUES.filter((v) => v !== "N/A"),
);

/**
 * Subcategory is intentionally open. ClosetItem.subcategory is free text, so a
 * fixed list would reject legitimate shapes ("east-west", "barrel", "mary-jane")
 * the moment fashion invents one. Validated for FORM instead of membership.
 */
const SUBCATEGORY_PATTERN = /^[a-z0-9]+(?:[- ][a-z0-9]+)*$/;

const CLOSED_VOCABULARIES: Readonly<Partial<Record<FacetKind, ReadonlySet<string>>>> = {
  category:      FACET_CATEGORY_VALUES,
  material:      GARMENT_MATERIAL_VALUES as ReadonlySet<string>,
  colourFamily:  FACET_COLOUR_FAMILY_VALUES,
  silhouette:    FACET_SILHOUETTE_VALUES,
  pattern:       GARMENT_PATTERN_VALUES as ReadonlySet<string>,
  formalityBand: GARMENT_FORMALITY_VALUES as ReadonlySet<string>,
  visualWeight:  FACET_VISUAL_WEIGHT_VALUES,
  construction:  FACET_CONSTRUCTION_VALUES,
};

export function facetVocabulary(kind: FacetKind): ReadonlySet<string> | null {
  return CLOSED_VOCABULARIES[kind] ?? null;
}

// ── The facet object ──────────────────────────────────────────────────────────

/** Every kind optional — a trend declares only what it is actually about. */
export type TrendFacets = Partial<Record<FacetKind, string[]>>;

export function isFacetValue(kind: FacetKind, value: unknown): value is string {
  if (typeof value !== "string") return false;
  const token = value.trim();
  if (token === "") return false;
  const vocab = facetVocabulary(kind);
  if (vocab) return vocab.has(kind === "category" ? token.toUpperCase() : token.toLowerCase());
  return SUBCATEGORY_PATTERN.test(token.toLowerCase());
}

function canonicaliseValue(kind: FacetKind, value: string): string {
  const token = value.trim();
  return kind === "category" ? token.toUpperCase() : token.toLowerCase();
}

export interface FacetValidationResult {
  facets: TrendFacets;
  /** Values dropped because they are not in the kind's vocabulary. */
  rejected: Array<{ kind: string; value: unknown; reason: string }>;
}

/**
 * Accepts whatever an admin pasted and returns only what is valid, reporting the
 * rest rather than silently swallowing it. Invalid input never reaches matching:
 * a typo'd facet must show up as an authoring error, not as a garment that
 * quietly stops matching.
 */
export function validateFacets(raw: unknown): FacetValidationResult {
  const facets: TrendFacets = {};
  const rejected: FacetValidationResult["rejected"] = [];

  if (raw == null) return { facets, rejected };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { facets, rejected: [{ kind: "(root)", value: raw, reason: "facets must be an object" }] };
  }

  for (const [kind, values] of Object.entries(raw as Record<string, unknown>)) {
    if (!isFacetKind(kind)) {
      rejected.push({ kind, value: values, reason: "unknown facet kind" });
      continue;
    }
    const list = Array.isArray(values) ? values : [values];
    const accepted: string[] = [];
    for (const value of list) {
      if (!isFacetValue(kind, value)) {
        rejected.push({ kind, value, reason: "not in vocabulary" });
        continue;
      }
      const token = canonicaliseValue(kind, value as string);
      if (!accepted.includes(token)) accepted.push(token);
    }
    if (accepted.length > 0) facets[kind] = accepted;
  }

  return { facets, rejected };
}

export function isEmptyFacets(facets: TrendFacets | null | undefined): boolean {
  if (!facets) return true;
  return FACET_KINDS.every((kind) => (facets[kind]?.length ?? 0) === 0);
}

export function countFacetValues(facets: TrendFacets | null | undefined): number {
  if (!facets) return 0;
  return FACET_KINDS.reduce((sum, kind) => sum + (facets[kind]?.length ?? 0), 0);
}

// ── Saved-facet identity ──────────────────────────────────────────────────────

/**
 * Content id for a facet saved on its own ("save this colour direction").
 * Global by design — the same material saved from two reports is one object.
 */
export function makeFacetContentId(kind: FacetKind, value: string): string {
  if (!isFacetValue(kind, value)) {
    throw new Error(`"${value}" is not a valid ${kind} facet value`);
  }
  return `${kind}:${canonicaliseValue(kind, value)}`;
}

export function parseFacetContentId(contentId: string): { kind: FacetKind; value: string } | null {
  const separator = contentId.indexOf(":");
  if (separator <= 0) return null;
  const kind = contentId.slice(0, separator);
  const value = contentId.slice(separator + 1);
  if (!isFacetKind(kind) || !isFacetValue(kind, value)) return null;
  return { kind, value: canonicaliseValue(kind, value) };
}

// ── Prose fallback ────────────────────────────────────────────────────────────

/**
 * Conservative facets for a trend that has not been authored yet, read from its
 * own prose only. This is the safety net that lets existing reports keep working
 * unchanged until an editor fills the facets in.
 *
 * Deliberately timid. It matches whole words against closed vocabularies and
 * nothing else — no stemming, no synonyms, no inference. A missed facet costs a
 * match that was never promised; a wrong facet costs trust, so silence is the
 * better failure.
 *
 * `category` and `subcategory` are never inferred: there is no reliable way to
 * read them out of editorial copy, and guessing "BAGS" from the word "bag" in a
 * sentence about everything except bags is exactly the wrong kind of confident.
 */
export function deriveFacetsFromProse(text: string): TrendFacets {
  const haystack = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  const facets: TrendFacets = {};

  const scan = (kind: FacetKind, vocabulary: ReadonlySet<string>) => {
    const found: string[] = [];
    for (const token of vocabulary) {
      const needle = ` ${token.toLowerCase().replace(/-/g, " ")} `;
      if (haystack.includes(needle)) found.push(token.toLowerCase());
    }
    if (found.length > 0) facets[kind] = found;
  };

  scan("material", GARMENT_MATERIAL_VALUES as ReadonlySet<string>);
  scan("pattern", GARMENT_PATTERN_VALUES as ReadonlySet<string>);
  scan("silhouette", FACET_SILHOUETTE_VALUES);
  scan("formalityBand", GARMENT_FORMALITY_VALUES as ReadonlySet<string>);
  scan("construction", FACET_CONSTRUCTION_VALUES);

  // Colour families are matched through their member colour words, since
  // "burgundy" appears in copy but the family id is "red-burgundy".
  const colourWords: Readonly<Record<string, string>> = {
    black: "black", white: "white-cream", cream: "white-cream", ivory: "white-cream",
    beige: "beige-brown", brown: "beige-brown", camel: "beige-brown", tan: "beige-brown",
    taupe: "beige-brown", stone: "beige-brown",
    grey: "grey", gray: "grey", charcoal: "grey",
    navy: "navy",
    red: "red-burgundy", burgundy: "red-burgundy", wine: "red-burgundy", maroon: "red-burgundy",
    green: "green", pink: "pink", yellow: "yellow", orange: "orange",
  };
  const colours: string[] = [];
  for (const [word, family] of Object.entries(colourWords)) {
    if (haystack.includes(` ${word} `) && !colours.includes(family)) colours.push(family);
  }
  if (colours.length > 0) facets.colourFamily = colours;

  return facets;
}
