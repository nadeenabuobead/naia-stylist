// app/lib/ai/closet-insights.ts
// V2-A4 — deterministic, on-demand Closet Insights engine.
// Pure function: no DB, no LLM, no side effects. Takes a snapshot of closet
// items and a Passport profile, returns structured claims backed by Closet evidence.

import { readLifestyle, PROFILE_LIFESTYLE_OCCASION_MAP } from "./signal-contract.js";

// ── Public types ──────────────────────────────────────────────────────────────

export interface ClosetItemSnapshot {
  id: string;
  category: string;
  primaryColor: string | null;
  occasions: string[] | null;
  seasons: string[] | null;
}

// All fields are consumed directly from Prisma's OnboardingProfile.
// Fields that V2-A4 does not act on (stylePersonalities, desiredImpression,
// desiredFeelings, becoming) are carried as forward-compatibility stubs.
export interface ClosetInsightProfile {
  lifestyle: string | null;
  styleStruggles: string[];
  styleSupport: string[];
  favoriteColors: string[];
  avoidColors: string[];
  // Forward-compatible only — produce no V2-A4 Closet claims
  stylePersonalities: string[];
  desiredImpression: string[];
  desiredFeelings: string[];
  becoming: string[];
}

export type InsightType =
  | "category-concentration"
  | "palette-distribution"
  | "favourite-colour-comparison"
  | "avoided-colour-mismatch"
  | "occasion-coverage"
  | "season-coverage";

export interface ClosetEvidence {
  field: string;
  value: string;
}

export interface PassportEffect {
  field: "styleStruggles" | "styleSupport" | "lifestyle" | "favoriteColors" | "avoidColors";
  matchedId: string;
  effect: "prioritised" | "framing";
}

export interface ClosetInsight {
  id: string;
  type: InsightType;
  claim: string;
  evidence: ClosetEvidence[];
  passportEffects: PassportEffect[];
}

export interface ClosetDataQuality {
  totalItems: number;
  colouredItems: number;
  colourCoverageRatio: number;
  occasionTaggedItems: number;
  occasionCoverageRatio: number;
  seasonTaggedItems: number;
  seasonCoverageRatio: number;
  compositionEligible: boolean;
  paletteEligible: boolean;
  occasionEligible: boolean;
  seasonEligible: boolean;
}

export interface ClosetInsightsResult {
  dataQuality: ClosetDataQuality;
  insights: ClosetInsight[];
}

// ── Internal constants ────────────────────────────────────────────────────────

// Maps Passport favoriteColors/avoidColors quiz option IDs → Closet primaryColor
// display strings. Only deterministic exact-match mappings are included.
// Combined IDs (white-cream, beige-brown, red-burgundy), aesthetic IDs (prints,
// colorful), and IDs without a Closet counterpart are intentionally omitted.
const PASSPORT_COLOUR_TO_CLOSET: Readonly<Record<string, string>> = {
  "black":  "Black",
  "grey":   "Grey",
  "navy":   "Navy",
  "green":  "Green",
  "pink":   "Pink",
  "yellow": "Yellow",
  "orange": "Orange",
};

// Feature-local bridge: PROFILE_LIFESTYLE_OCCASION_MAP catalog tokens →
// Closet item occasion display strings (the OCCASIONS constant in closet._index.tsx).
// Not a modification of any existing constant; scoped to this module only.
const LIFESTYLE_TOKEN_TO_CLOSET_OCCASION: Readonly<Record<string, readonly string[]>> = {
  "dinner":      ["Dinner", "Party", "Formal"],
  "date-night":  ["Date"],
  "girls-night": ["Dinner", "Party"],
  "work":        ["Work"],
  "everyday":    ["Casual", "Weekend"],
  "travel":      ["Travel"],
};

const CANONICAL_SEASONS = ["Spring", "Summer", "Fall", "Winter"] as const;

// ── Engine ────────────────────────────────────────────────────────────────────

export function computeClosetInsights(
  items: ClosetItemSnapshot[],
  profile: ClosetInsightProfile | null,
): ClosetInsightsResult {
  const totalItems = items.length;

  const colouredItems = items.filter((i) => i.primaryColor !== null).length;
  const colourCoverageRatio = totalItems > 0 ? colouredItems / totalItems : 0;

  const occasionTaggedItems = items.filter((i) => (i.occasions?.length ?? 0) > 0).length;
  const occasionCoverageRatio = totalItems > 0 ? occasionTaggedItems / totalItems : 0;

  const seasonTaggedItems = items.filter((i) => (i.seasons?.length ?? 0) > 0).length;
  const seasonCoverageRatio = totalItems > 0 ? seasonTaggedItems / totalItems : 0;

  const compositionEligible = totalItems >= 5;
  const paletteEligible = compositionEligible && colourCoverageRatio >= 0.6;
  const occasionEligible = compositionEligible && occasionCoverageRatio >= 0.6;
  const seasonEligible = compositionEligible && seasonCoverageRatio >= 0.6;

  const dataQuality: ClosetDataQuality = {
    totalItems,
    colouredItems,
    colourCoverageRatio,
    occasionTaggedItems,
    occasionCoverageRatio,
    seasonTaggedItems,
    seasonCoverageRatio,
    compositionEligible,
    paletteEligible,
    occasionEligible,
    seasonEligible,
  };

  if (!compositionEligible) {
    return { dataQuality, insights: [] };
  }

  const insights: ClosetInsight[] = [];

  // ── 1. Occasion coverage ───────────────────────────────────────────────────
  if (occasionEligible && profile?.lifestyle) {
    const lifestyleIds = readLifestyle(profile.lifestyle);
    const relevantOccasions = new Set<string>();
    const mappedLifestyleIds: string[] = [];

    for (const id of lifestyleIds) {
      const tokens = PROFILE_LIFESTYLE_OCCASION_MAP[id];
      if (!tokens) continue;
      mappedLifestyleIds.push(id);
      for (const token of tokens) {
        const closetOccs = LIFESTYLE_TOKEN_TO_CLOSET_OCCASION[token];
        if (closetOccs) {
          for (const occ of closetOccs) relevantOccasions.add(occ);
        }
      }
    }

    if (relevantOccasions.size > 0) {
      const relevantCount = items.filter((i) =>
        (i.occasions ?? []).some((occ) => relevantOccasions.has(occ)),
      ).length;

      const occasionList = [...relevantOccasions].sort().join(", ");
      const hasEventStruggle = (profile.styleStruggles ?? []).includes("event");
      const hasEventOutfitsSupport = (profile.styleSupport ?? []).includes("event-outfits");

      const passportEffects: PassportEffect[] = [
        { field: "lifestyle", matchedId: mappedLifestyleIds.join(","), effect: "framing" },
      ];
      if (hasEventStruggle) {
        passportEffects.push({ field: "styleStruggles", matchedId: "event", effect: "prioritised" });
      }
      if (hasEventOutfitsSupport) {
        passportEffects.push({ field: "styleSupport", matchedId: "event-outfits", effect: "framing" });
      }

      let claim: string;
      if (hasEventOutfitsSupport) {
        if (relevantCount === 0) {
          claim = `For event-outfit planning, none of your ${occasionTaggedItems} pieces with recorded occasion information are tagged for ${occasionList}.`;
        } else {
          claim = `For event-outfit planning, your recorded Closet currently includes ${relevantCount} ${relevantCount === 1 ? "piece" : "pieces"} tagged for ${occasionList}.`;
        }
      } else {
        const context = buildLifestyleContext(mappedLifestyleIds);
        if (relevantCount === 0) {
          claim = `${context}, but none of your ${occasionTaggedItems} pieces with recorded occasion information are tagged for ${occasionList}. This may be an area your Closet supports less strongly right now.`;
        } else if (relevantCount <= 2) {
          claim = `${context} — ${relevantCount} of your ${occasionTaggedItems} pieces with recorded occasion information ${relevantCount === 1 ? "is" : "are"} tagged for ${occasionList}. That's limited coverage for now.`;
        } else {
          claim = `${context} — ${relevantCount} of your ${occasionTaggedItems} pieces with recorded occasion information are tagged for ${occasionList}.`;
        }
      }

      insights.push({
        id: "occasion-coverage",
        type: "occasion-coverage",
        claim,
        evidence: [
          {
            field: "occasions",
            value: `${relevantCount} of ${occasionTaggedItems} occasion-tagged items match lifestyle occasions`,
          },
        ],
        passportEffects,
      });
    }
  }

  // ── 2. Category concentration ──────────────────────────────────────────────
  {
    const categoryCounts = new Map<string, number>();
    for (const item of items) {
      categoryCounts.set(item.category, (categoryCounts.get(item.category) ?? 0) + 1);
    }

    const maxCount = Math.max(...Array.from(categoryCounts.values()));
    const leaders = Array.from(categoryCounts.entries()).filter(([, count]) => count === maxCount);

    if (leaders.length === 1 && maxCount >= 3 && maxCount / totalItems >= 0.5) {
      const [leadCategory, leadCount] = leaders[0];
      const categoryLabel = leadCategory.toLowerCase();

      const passportEffects: PassportEffect[] = [];
      let claim: string;

      if ((profile?.styleSupport ?? []).includes("style-what-i-own")) {
        claim = `Here's what your Closet gives you to work with — ${leadCount} of your ${totalItems} pieces are ${categoryLabel}.`;
        passportEffects.push({ field: "styleSupport", matchedId: "style-what-i-own", effect: "framing" });
      } else {
        claim = `Your Closet currently leans toward ${categoryLabel} — ${leadCount} of your ${totalItems} pieces are ${categoryLabel}.`;
      }

      insights.push({
        id: "category-concentration",
        type: "category-concentration",
        claim,
        evidence: [
          { field: "category", value: `${leadCount} of ${totalItems} items are ${leadCategory}` },
        ],
        passportEffects,
      });
    }
  }

  // ── 3. Palette insights ────────────────────────────────────────────────────
  if (paletteEligible) {
    const colourCounts = new Map<string, number>();
    for (const item of items) {
      if (item.primaryColor !== null) {
        colourCounts.set(item.primaryColor, (colourCounts.get(item.primaryColor) ?? 0) + 1);
      }
    }

    // Find qualifying dominant colours: ≥2 items AND ≥40% of coloured items.
    // If multiple colours tie at the top count, no single dominant is declared.
    const qualifying = Array.from(colourCounts.entries())
      .filter(([, count]) => count >= 2 && count / colouredItems >= 0.4)
      .sort((a, b) => b[1] - a[1]);

    const topCount = qualifying[0]?.[1] ?? 0;
    const topTied = qualifying.filter(([, count]) => count === topCount);

    let paletteClaim: string;
    if (topTied.length === 1) {
      const [dominantColour, dominantCount] = topTied[0];
      paletteClaim = `${dominantColour} is your most represented colour — ${dominantCount} of your ${colouredItems} recorded pieces are ${dominantColour.toLowerCase()}.`;
    } else {
      paletteClaim = `Your palette is spread across multiple colours — no single colour dominates among your ${colouredItems} recorded pieces.`;
    }

    insights.push({
      id: "palette-distribution",
      type: "palette-distribution",
      claim: paletteClaim,
      evidence: [
        {
          field: "primaryColor",
          value: `${colouredItems} items with recorded colour across ${colourCounts.size} ${colourCounts.size === 1 ? "colour" : "colours"}`,
        },
      ],
      passportEffects: [],
    });

    // Favourite colour comparisons (one insight per mappable fav colour)
    for (const favId of (profile?.favoriteColors ?? [])) {
      const closetColour = PASSPORT_COLOUR_TO_CLOSET[favId];
      if (!closetColour) continue;

      const count = colourCounts.get(closetColour) ?? 0;
      const favClaim =
        count > 0
          ? `${closetColour} is one of your favourite colours and it's well represented — ${count} of your ${colouredItems} recorded pieces are ${closetColour.toLowerCase()}.`
          : `${closetColour} is one of your favourite colours, but it isn't currently represented among your ${colouredItems} recorded pieces.`;

      insights.push({
        id: `favourite-colour-${favId}`,
        type: "favourite-colour-comparison",
        claim: favClaim,
        evidence: [
          { field: "primaryColor", value: `${count} of ${colouredItems} recorded items are ${closetColour}` },
        ],
        passportEffects: [
          { field: "favoriteColors", matchedId: favId, effect: "framing" },
        ],
      });
    }

    // Avoided colour mismatches — only fires when the avoided colour is present
    for (const avoidId of (profile?.avoidColors ?? [])) {
      const closetColour = PASSPORT_COLOUR_TO_CLOSET[avoidId];
      if (!closetColour) continue;

      const count = colourCounts.get(closetColour) ?? 0;
      if (count === 0) continue;

      insights.push({
        id: `avoided-colour-${avoidId}`,
        type: "avoided-colour-mismatch",
        claim: `You prefer to avoid ${closetColour.toLowerCase()} — ${count} of your recorded Closet pieces are ${closetColour.toLowerCase()}.`,
        evidence: [
          { field: "primaryColor", value: `${count} of ${colouredItems} recorded items are ${closetColour}` },
        ],
        passportEffects: [
          { field: "avoidColors", matchedId: avoidId, effect: "framing" },
        ],
      });
    }
  }

  // ── 4. Season coverage ─────────────────────────────────────────────────────
  if (seasonEligible) {
    const uncoveredSeasons: string[] = [];
    for (const season of CANONICAL_SEASONS) {
      const covered = items.some(
        (i) =>
          (i.seasons ?? []).includes(season) ||
          (i.seasons ?? []).includes("All Season"),
      );
      if (!covered) uncoveredSeasons.push(season);
    }

    if (uncoveredSeasons.length > 0) {
      const uncoveredList = uncoveredSeasons.join(", ");
      insights.push({
        id: "season-coverage",
        type: "season-coverage",
        claim: `Among the ${seasonTaggedItems} pieces with recorded season information, none are tagged for ${uncoveredList}.`,
        evidence: [
          {
            field: "seasons",
            value: `${seasonTaggedItems} season-tagged items; ${uncoveredList} not represented`,
          },
        ],
        passportEffects: [],
      });
    }
  }

  return { dataQuality, insights };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildLifestyleContext(lifestyleIds: string[]): string {
  const hasEvents = lifestyleIds.includes("events");
  const hasOffice = lifestyleIds.some((id) => id === "office" || id === "hybrid");
  const hasTravel = lifestyleIds.includes("travel");

  if (hasEvents && lifestyleIds.length === 1) {
    return "Events and dinners are one of your main dress codes";
  }
  if (hasEvents) {
    return "Events and specific occasions are part of your lifestyle";
  }
  if (hasOffice) {
    return "Work and office dressing are part of your lifestyle";
  }
  if (hasTravel) {
    return "Travel is a regular part of your lifestyle";
  }
  return "Your lifestyle calls for specific occasion dressing";
}
