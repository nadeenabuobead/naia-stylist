// app/lib/ai/taste-contract.ts
// Taste & Evidence Layer V1 — canonical vocabulary, types, thresholds, and text templates.
// Pure module: no DB, no LLM, no side effects.

// ── Canonical dimensions ───────────────────────────────────────────────────────

export const TASTE_DIMENSIONS = [
  "self-expression",
  "comfort",
  "formality",
  "fit",
  "garment-category",
] as const;
export type TasteDimension = (typeof TASTE_DIMENSIONS)[number];

// formality sub-values (always NEGATIVE in V1)
export const FORMALITY_VALUES = ["too-formal", "too-casual"] as const;
export type FormalityValue = (typeof FORMALITY_VALUES)[number];

// ── Sources ────────────────────────────────────────────────────────────────────

export const TASTE_SOURCES = [
  "STYLEME_OUTCOME",
  "POST_OUTFIT_REVIEW",
  "CLOSET_RELATIONSHIP",
  "BUYSKIP_OUTCOME",
] as const;
export type TasteSource = (typeof TASTE_SOURCES)[number];

// ── Observation states ─────────────────────────────────────────────────────────

export const TASTE_STATES = [
  "CANDIDATE",    // enough signal to track; not yet surfaced
  "CONFIRMED",    // strong enough to surface as a claim
  "SUPPRESSED",   // system confidence too contradictory — not surfaced
  "REJECTED",     // customer said "not quite" — permanently preserved
] as const;
export type TasteState = (typeof TASTE_STATES)[number];

export type TastePolarity = "positive" | "negative";
export type ObservationFamily = "WORKS_WELL" | "FRICTION";

export const TENDENCY_SCHEMA_VERSION = "tendency-v1";

// ── Thresholds ─────────────────────────────────────────────────────────────────

export const CANDIDATE_EFFECTIVE_SUPPORT    = 2.0;
export const CANDIDATE_WNET                 = 1.5;
export const CANDIDATE_DISTINCT_RECORDS     = 2;

export const CONFIRMED_EFFECTIVE_SUPPORT    = 4.0;
export const CONFIRMED_WNET                 = 3.0;
export const CONFIRMED_DISTINCT_RECORDS     = 3;

export const SUPPRESS_RATIO                 = 0.75;  // wContradict >= wSupport * 0.75 → SUPPRESSED
export const CONTEST_RATIO                  = 0.40;  // wContradict >= wSupport * 0.40 → max CANDIDATE

export const CROSS_SOURCE_BONUS             = 1.25;  // multiplier when distinctSources >= 2

// Re-emergence (post-rejection elevated threshold)
export const REEMERGENCE_SUPPORT_MULTIPLIER = 1.5;   // 4.0 * 1.5 = 6.0
export const REEMERGENCE_DISTINCT_RECORDS   = 5;
export const REEMERGENCE_WNET_MINIMUM       = 4.0;

// ── Source base strengths ──────────────────────────────────────────────────────

export const SOURCE_BASE_STRENGTH: Record<TasteSource, number> = {
  STYLEME_OUTCOME:    0.8,
  POST_OUTFIT_REVIEW: 0.7,
  CLOSET_RELATIONSHIP: 0.5,
  BUYSKIP_OUTCOME:    0.6,
};

// ── Key helpers ────────────────────────────────────────────────────────────────

export function makeObservationKey(dimension: string, value: string): string {
  return `${TENDENCY_SCHEMA_VERSION}|${dimension}:${value}`;
}

export function canonicalValue(dimension: TasteDimension, specificValue?: string): string {
  // garment-category and formality use specific sub-values; others use the dimension name
  if (dimension === "garment-category" || dimension === "formality") {
    return specificValue ?? dimension;
  }
  return dimension;
}

// ── Evidence insert shape ──────────────────────────────────────────────────────

export interface TasteEvidenceInsert {
  customerId:     string;
  source:         TasteSource;
  sourceRecordId: string;
  dimension:      string;
  value:          string;
  polarity:       TastePolarity;
  strength:       number;   // clamped [0.1, 1.0]
  context?:       { mood?: string | null; occasion?: string | null };
  provenance:     { extractionRule: string; sourceFields: string[]; rawValues: string[] };
  occurredAt:     Date;
}

export function clampStrength(s: number): number {
  return Math.max(0.1, Math.min(1.0, s));
}

// ── Claim + rationale text templates ──────────────────────────────────────────

interface TextResult { claimText: string; rationaleText: string }

function sourceLabel(distinctSources: number, sourcesUsed: string[]): string {
  const hasStyleMe  = sourcesUsed.includes("STYLEME_OUTCOME");
  const hasReview   = sourcesUsed.includes("POST_OUTFIT_REVIEW");
  const hasCloset   = sourcesUsed.includes("CLOSET_RELATIONSHIP");
  const hasBuySkip  = sourcesUsed.includes("BUYSKIP_OUTCOME");
  if (distinctSources < 2) {
    if (hasStyleMe)  return "in your post-session reviews";
    if (hasReview)   return "in your post-wear feedback";
    if (hasCloset)   return "in how you've described your wardrobe";
    if (hasBuySkip)  return "in your buy or skip decisions";
    return "across your activity";
  }
  if (hasCloset && hasBuySkip && !hasStyleMe && !hasReview) {
    return "across your wardrobe and buying decisions";
  }
  if ((hasStyleMe || hasReview) && (hasCloset || hasBuySkip)) {
    return "across your session reviews and wardrobe";
  }
  return "across your recent activity";
}

export function generateTendencyText(
  dimension: string,
  value: string,
  family: ObservationFamily,
  distinctRecords: number,
  distinctSources: number,
  sourcesUsed: string[],
): TextResult {
  const src = sourceLabel(distinctSources, sourcesUsed);
  const n = distinctRecords;

  if (dimension === "self-expression") {
    if (family === "WORKS_WELL") {
      return {
        claimText: "Looks that feel genuinely like you keep appearing in your strongest reviews — this seems to be the quality that matters most when an outfit lands.",
        rationaleText: `Based on ${n} ${n === 1 ? "look" : "looks"} where feeling like yourself came up positively${distinctSources >= 2 ? ` — ${src}` : ""}.`,
      };
    }
    return {
      claimText: "Feeling like yourself in a look has come up repeatedly as something that wasn't quite there — nAia is noticing this as a pattern.",
      rationaleText: `Based on ${n} ${n === 1 ? "review" : "reviews"} where this was flagged${distinctSources >= 2 ? ` — ${src}` : ""}.`,
    };
  }

  if (dimension === "comfort") {
    if (family === "WORKS_WELL") {
      return {
        claimText: "Physical comfort keeps coming up in what makes a look work for you — it's showing up consistently in how you rate your sessions.",
        rationaleText: `Based on ${n} ${n === 1 ? "look" : "looks"} where comfort registered positively${distinctSources >= 2 ? ` — ${src}` : ""}.`,
      };
    }
    return {
      claimText: "Physical comfort has come up repeatedly in what hasn't worked — across different sessions and reviews.",
      rationaleText: `Based on ${n} ${n === 1 ? "look" : "looks"} where comfort was noted as not working${distinctSources >= 2 ? ` — ${src}` : ""}.`,
    };
  }

  if (dimension === "fit") {
    return {
      claimText: "Fit has been a recurring note across looks that didn't quite land — it's appeared in what you've flagged or changed.",
      rationaleText: `Based on ${n} ${n === 1 ? "look" : "looks"} where fit came up as a friction point${distinctSources >= 2 ? ` — ${src}` : ""}.`,
    };
  }

  if (dimension === "formality") {
    if (value === "too-formal") {
      return {
        claimText: "A few looks have felt more formal than you wanted — this has come up across different sessions.",
        rationaleText: `Based on ${n} ${n === 1 ? "look" : "looks"} where formality came up as a friction point${distinctSources >= 2 ? ` — ${src}` : ""}.`,
      };
    }
    return {
      claimText: "Some looks have felt too casual for what you needed — this has appeared more than once.",
      rationaleText: `Based on ${n} ${n === 1 ? "look" : "looks"} where the casualness didn't fit the occasion${distinctSources >= 2 ? ` — ${src}` : ""}.`,
    };
  }

  if (dimension === "garment-category") {
    const cat = value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
    const catPlural = cat.endsWith("s") ? cat : `${cat}s`;
    if (family === "WORKS_WELL") {
      return {
        claimText: `${catPlural} come up consistently in the pieces you love and wear most — there seems to be a real affinity here.`,
        rationaleText: `Based on ${n} ${n === 1 ? "piece" : "pieces"} you've marked as favourites or frequently worn${distinctSources >= 2 ? ` — ${src}` : ""}.`,
      };
    }
    return {
      claimText: `There's a pattern emerging around ${cat.toLowerCase()} in your wardrobe — a few have gone unworn or ended up returned.`,
      rationaleText: `Based on ${n} ${n === 1 ? "piece" : "pieces"} you've marked as rarely worn or regretted${distinctSources >= 2 ? ` — ${src}` : ""}.`,
    };
  }

  // Fallback
  return {
    claimText: `nAia has noticed a recurring pattern around ${dimension}.`,
    rationaleText: `Based on ${n} ${n === 1 ? "observation" : "observations"}.`,
  };
}
