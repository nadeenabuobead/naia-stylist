// app/lib/trend-evidence-attribute-scoring.server.ts
//
// Trend-specific Closet evidence scoring (Personalised Trend Edit V1
// architecture fix). Root cause this closes: the previous scoring treated
// every trend report identically — matching a Closet item's own vocabulary
// against one flat blob of the report's editorial copy — so two structurally
// different trends (Modern Tailoring vs. Soft Structure) with similar
// editorial language produced the same top-2 items, and Colour Direction
// scored a beanie and sneakers as "neutral" without ever checking whether a
// bottom or dress would have been stronger colour evidence.
//
// This module answers one question per (item, slug) pair: which named
// DIMENSION of this trend does this item provide evidence for, and how
// strong is that evidence? Dimensions are the trend's own stated axes —
// "tailored anchor" vs. "relaxed counterpart" for Modern Tailoring, "base
// neutral" vs. "accent colour" for Colour Direction — not an arbitrary
// diversity rule. Selecting the top item per dimension is what makes
// section evidence trend-specific instead of "generally compatible."
//
// Reads structured Garment Intelligence fields (silhouette, fitProfile,
// formality) already on ClosetItem — never invents an attribute the data
// doesn't contain. Falls back gracefully (score 0 for every dimension, not
// an error) for Closet items with no GI analysis yet (analysisStatus !==
// "ready" leaves silhouette/fitProfile/formality all null) — callers blend
// this with the existing text-overlap signal so un-analyzed items still get
// a fair chance.

import { resolveFreeTextColourFamilies } from "./ai/colour-family";
import type { ShopperClosetItemEvidence } from "./trend-evidence.server";

export interface DimensionScore {
  dimensionId: string;
  score: number;
}

export interface AttributeScoreResult {
  /** One entry per dimension this slug defines, in profile order. */
  dimensionScores: DimensionScore[];
  /** The single strongest dimension score — used as the item's overall attribute-evidence strength. */
  bestScore: number;
  /** Which dimension produced bestScore; null when every dimension scored 0. */
  bestDimensionId: string | null;
}

type ScoreFn = (item: ShopperClosetItemEvidence) => number;

interface DimensionRule {
  id: string;
  score: ScoreFn;
}

const TAILORED_FIT_PROFILES = new Set(["tailored", "structured"]);
const RELAXED_FIT_PROFILES = new Set(["relaxed", "loose", "flowy"]);
const STRUCTURED_SILHOUETTES = new Set(["column", "straight", "fitted"]);
const SOFT_SILHOUETTES = new Set(["a-line", "flared", "wrap"]);
const SOFT_MATERIALS = new Set(["jersey", "knit", "chiffon", "georgette", "cashmere"]);

const modernTailoringDimensions: DimensionRule[] = [
  {
    id: "tailored-anchor",
    score: (item) => {
      let s = 0;
      if (item.fitProfile === "tailored") s += 6;
      else if (item.fitProfile === "structured") s += 5;
      if (item.formality === "business-formal") s += 2;
      else if (item.formality === "business-casual") s += 1;
      if (item.category === "OUTERWEAR" || item.category === "BOTTOMS") s += 2;
      if (item.silhouette && STRUCTURED_SILHOUETTES.has(item.silhouette)) s += 1;
      return s;
    },
  },
  {
    id: "relaxed-counterpart",
    score: (item) => {
      let s = 0;
      if (item.fitProfile && RELAXED_FIT_PROFILES.has(item.fitProfile)) s += 5;
      if (item.category === "TOPS") s += 2;
      if (item.material && SOFT_MATERIALS.has(item.material)) s += 2;
      return s;
    },
  },
];

const softStructureDimensions: DimensionRule[] = [
  {
    id: "structured-anchor",
    score: (item) => {
      let s = 0;
      if (item.fitProfile && TAILORED_FIT_PROFILES.has(item.fitProfile)) s += 5;
      if (item.silhouette && STRUCTURED_SILHOUETTES.has(item.silhouette)) s += 2;
      return s;
    },
  },
  {
    id: "soft-flowing",
    score: (item) => {
      let s = 0;
      if (item.fitProfile && RELAXED_FIT_PROFILES.has(item.fitProfile)) s += 6;
      if (item.silhouette && SOFT_SILHOUETTES.has(item.silhouette)) s += 3;
      if (item.material && SOFT_MATERIALS.has(item.material)) s += 1;
      return s;
    },
  },
];

function itemColourText(item: ShopperClosetItemEvidence): string | null {
  return item.primaryColor ?? item.colors?.[0] ?? null;
}

const colourDirectionDimensions: DimensionRule[] = [
  {
    id: "base-neutral",
    score: (item) => {
      const text = itemColourText(item);
      if (!text) return 0;
      const resolution = resolveFreeTextColourFamilies(text);
      return resolution.isNeutral ? 6 : 0;
    },
  },
  {
    id: "accent-colour",
    score: (item) => {
      const text = itemColourText(item);
      if (!text) return 0;
      const resolution = resolveFreeTextColourFamilies(text);
      return !resolution.isNeutral && resolution.hueFamilies.length > 0 ? 6 : 0;
    },
  },
];

const TREND_DIMENSION_PROFILES: Record<string, DimensionRule[]> = {
  "modern-tailoring-spring-2026": modernTailoringDimensions,
  "spring-2026-soft-structure":   softStructureDimensions,
  "spring-2026-colour-direction": colourDirectionDimensions,
};

/** The dimension ids a given slug defines, in profile order. Empty for a slug with no profile. */
export function dimensionIdsForSlug(slug: string): string[] {
  return (TREND_DIMENSION_PROFILES[slug] ?? []).map((d) => d.id);
}

export function scoreItemAttributes(item: ShopperClosetItemEvidence, slug: string): AttributeScoreResult {
  const dimensions = TREND_DIMENSION_PROFILES[slug] ?? [];
  const dimensionScores = dimensions.map((d) => ({ dimensionId: d.id, score: d.score(item) }));

  let bestScore = 0;
  let bestDimensionId: string | null = null;
  for (const d of dimensionScores) {
    if (d.score > bestScore) {
      bestScore = d.score;
      bestDimensionId = d.dimensionId;
    }
  }

  return { dimensionScores, bestScore, bestDimensionId };
}
