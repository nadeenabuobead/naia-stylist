// app/lib/ai/closet-insights.ts
// V2-A4 + V1 relationship/formality — deterministic, on-demand Closet Insights engine.
// Pure function: no DB, no LLM, no side effects. Takes a snapshot of closet
// items and a Passport profile, returns structured claims backed by Closet evidence.

import { PROFILE_LIFESTYLE_OCCASION_MAP } from "./signal-contract.js";

// ── Public types ──────────────────────────────────────────────────────────────

export interface ClosetItemSnapshot {
  id: string;
  category: string;
  primaryColor: string | null;
  occasions: string[] | null;
  seasons: string[] | null;
  // V1 relationship + AI fields
  garmentRelationships: string[];
  silhouette: string | null;
  fitProfile: string | null;
  formality: string | null;
  stylePersonality: string | null;
  pattern: string | null;
}

// All fields are consumed directly from Prisma's OnboardingProfile.
export interface ClosetInsightProfile {
  lifestyle: string[];
  styleStruggles: string[];
  styleSupport: string[];
  favoriteColors: string[];
  avoidColors: string[];
  // Forward-compatible — not yet actioned in Closet claims
  stylePersonalities: string[];
  desiredImpression: string[];
  desiredFeelings: string[];
  becoming: string[];
  // Passport body/silhouette preferences — forward-compatible stubs for V1
  passportSilhouette: string[];
  passportStructure: string | null;
  passportFitPreferences: string[];
}

export type InsightType =
  | "wear-behaviour"
  | "friction-signal"
  | "low-use-signal"
  | "formality-distribution"
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
  relationshipTaggedItems: number;
  relationshipCoverageRatio: number;
  formalityTaggedItems: number;
  formalityCoverageRatio: number;
  compositionEligible: boolean;
  paletteEligible: boolean;
  occasionEligible: boolean;
  seasonEligible: boolean;
  relationshipEligible: boolean;
  formalityEligible: boolean;
}

export interface ClosetInsightsResult {
  dataQuality: ClosetDataQuality;
  insights: ClosetInsight[];
}

// ── Internal constants ────────────────────────────────────────────────────────

// Maps Passport favoriteColors/avoidColors quiz option IDs → Closet primaryColor
// display strings. Only deterministic exact-match mappings are included.
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
// Closet item occasion display strings.
const LIFESTYLE_TOKEN_TO_CLOSET_OCCASION: Readonly<Record<string, readonly string[]>> = {
  "dinner":      ["Dinner", "Party", "Formal"],
  "date-night":  ["Date"],
  "girls-night": ["Dinner", "Party"],
  "work":        ["Work"],
  "everyday":    ["Casual", "Weekend"],
  "travel":      ["Travel"],
};

const CANONICAL_SEASONS = ["Spring", "Summer", "Fall", "Winter"] as const;

const VALID_CLOSET_OCCASIONS = new Set([
  "Casual", "Date", "Dinner", "Formal", "Party", "Travel", "Weekend", "Work",
]);
const VALID_CLOSET_SEASONS = new Set([
  "Spring", "Summer", "Fall", "Winter", "All Season",
]);

// Recognized garment relationship values (mirrors GARMENT_RELATIONSHIP_IDS in first-naia-read.ts)
const VALID_GARMENT_RELATIONSHIPS = new Set([
  "favourite", "wear-often", "love-style-struggle", "like",
  "unsure", "rarely-wear", "regret", "occasion-only",
]);
const POSITIVE_RELATIONSHIPS = new Set(["favourite", "wear-often"]);
const FRICTION_RELATIONSHIPS = new Set(["love-style-struggle", "unsure"]);
const NEGATIVE_RELATIONSHIPS = new Set(["rarely-wear", "regret"]);

// Priority ordering for curation — higher number = shown first.
// Max 4 insights are returned per call.
const INSIGHT_PRIORITY: Readonly<Record<string, number>> = {
  "wear-behaviour":           10,
  "friction-signal":           9,
  "low-use-signal":            8,
  "occasion-coverage":         7,
  "formality-distribution":    6,
  "category-concentration":    4,
  "palette-distribution":      3,
  "favourite-colour-comparison": 2,
  "avoided-colour-mismatch":   2,
  "season-coverage":           1,
};
const MAX_INSIGHTS = 4;

// ── Engine ────────────────────────────────────────────────────────────────────

export function computeClosetInsights(
  items: ClosetItemSnapshot[],
  profile: ClosetInsightProfile | null,
): ClosetInsightsResult {
  const totalItems = items.length;

  const colouredItems = items.filter((i) => i.primaryColor !== null).length;
  const colourCoverageRatio = totalItems > 0 ? colouredItems / totalItems : 0;

  const occasionTaggedItems = items.filter(
    (i) => (i.occasions ?? []).some((o) => VALID_CLOSET_OCCASIONS.has(o)),
  ).length;
  const occasionCoverageRatio = totalItems > 0 ? occasionTaggedItems / totalItems : 0;

  const seasonTaggedItems = items.filter(
    (i) => (i.seasons ?? []).some((s) => VALID_CLOSET_SEASONS.has(s)),
  ).length;
  const seasonCoverageRatio = totalItems > 0 ? seasonTaggedItems / totalItems : 0;

  const relationshipTaggedItems = items.filter(
    (i) => (i.garmentRelationships ?? []).some((r) => VALID_GARMENT_RELATIONSHIPS.has(r)),
  ).length;
  const relationshipCoverageRatio = totalItems > 0 ? relationshipTaggedItems / totalItems : 0;

  const formalityTaggedItems = items.filter((i) => i.formality !== null).length;
  const formalityCoverageRatio = totalItems > 0 ? formalityTaggedItems / totalItems : 0;

  const compositionEligible = totalItems >= 5;
  const paletteEligible = compositionEligible && colourCoverageRatio >= 0.6;
  const occasionEligible = compositionEligible && occasionCoverageRatio >= 0.6;
  const seasonEligible = compositionEligible && seasonCoverageRatio >= 0.6;
  const relationshipEligible = compositionEligible && relationshipCoverageRatio >= 0.6;
  const formalityEligible = compositionEligible && formalityCoverageRatio >= 0.6;

  const dataQuality: ClosetDataQuality = {
    totalItems,
    colouredItems,
    colourCoverageRatio,
    occasionTaggedItems,
    occasionCoverageRatio,
    seasonTaggedItems,
    seasonCoverageRatio,
    relationshipTaggedItems,
    relationshipCoverageRatio,
    formalityTaggedItems,
    formalityCoverageRatio,
    compositionEligible,
    paletteEligible,
    occasionEligible,
    seasonEligible,
    relationshipEligible,
    formalityEligible,
  };

  if (!compositionEligible) {
    return { dataQuality, insights: [] };
  }

  const insights: ClosetInsight[] = [];

  // ── 1. Wear behaviour (relationship coverage ≥60%) ────────────────────────
  if (relationshipEligible) {
    const taggedItems = items.filter(
      (i) => (i.garmentRelationships ?? []).some((r) => VALID_GARMENT_RELATIONSHIPS.has(r)),
    );
    const positiveItems = taggedItems.filter((i) =>
      (i.garmentRelationships ?? []).some((r) => POSITIVE_RELATIONSHIPS.has(r)),
    ).length;
    const frictionItems = taggedItems.filter((i) =>
      (i.garmentRelationships ?? []).some((r) => FRICTION_RELATIONSHIPS.has(r)),
    ).length;
    const negativeItems = taggedItems.filter((i) =>
      (i.garmentRelationships ?? []).some((r) => NEGATIVE_RELATIONSHIPS.has(r)),
    ).length;

    const taggedCount = taggedItems.length;
    const positiveRatio = positiveItems / taggedCount;
    const frictionRatio = frictionItems / taggedCount;
    const negativeRatio = negativeItems / taggedCount;

    let claim: string;
    if (positiveRatio >= 0.5 && frictionRatio <= 0.2) {
      const pieceWord = positiveItems === 1 ? "piece" : "pieces";
      claim = `${positiveItems} of your ${taggedCount} tagged ${pieceWord} are favourites or ones you wear often — a clear core is forming in your Closet.`;
    } else if (positiveRatio >= 0.5) {
      claim = `${positiveItems} of your ${taggedCount} tagged pieces are favourites or ones you wear often, alongside ${frictionItems} you're still working out how to style.`;
    } else if (negativeRatio >= 0.4) {
      claim = `${negativeItems} of your ${taggedCount} tagged pieces aren't getting much wear — that's a signal worth noticing.`;
    } else if (frictionRatio > positiveRatio && frictionRatio >= 0.33) {
      claim = `${frictionItems} of your ${taggedCount} tagged pieces are ones you love but haven't figured out how to style yet — more than your clear favourites right now.`;
    } else {
      const parts: string[] = [];
      if (positiveItems > 0) {
        parts.push(`${positiveItems} ${positiveItems === 1 ? "piece" : "pieces"} you wear regularly`);
      }
      if (frictionItems > 0) parts.push(`${frictionItems} you find harder to style`);
      if (negativeItems > 0) parts.push(`${negativeItems} that rarely get worn`);
      claim = parts.length > 0
        ? `Your tagged pieces are spread — ${parts.join(", ")}.`
        : `You've tagged ${taggedCount} of your ${totalItems} pieces with how you feel about them.`;
    }

    insights.push({
      id: "wear-behaviour",
      type: "wear-behaviour",
      claim,
      evidence: [
        {
          field: "garmentRelationships",
          value: `${taggedCount} of ${totalItems} items tagged; ${positiveItems} positive, ${frictionItems} friction, ${negativeItems} low-use`,
        },
      ],
      passportEffects: [],
    });
  }

  // ── 2. Friction signal (≥2 love-style-struggle, no coverage gate) ──────────
  {
    const struggleCount = items.filter(
      (i) => (i.garmentRelationships ?? []).includes("love-style-struggle"),
    ).length;
    if (struggleCount >= 2) {
      const pieceWord = struggleCount === 1 ? "piece" : "pieces";
      insights.push({
        id: "friction-signal",
        type: "friction-signal",
        claim: `You have ${struggleCount} ${pieceWord} you love but struggle to style. The issue is often how they connect to the rest of your Closet, not whether they belong there.`,
        evidence: [
          { field: "garmentRelationships", value: `${struggleCount} items tagged love-style-struggle` },
        ],
        passportEffects: [],
      });
    }
  }

  // ── 3. Low-use signal (≥2 rarely-wear/regret items AND ≥8 total) ───────────
  {
    const lowUseCount = items.filter(
      (i) => (i.garmentRelationships ?? []).some((r) => r === "rarely-wear" || r === "regret"),
    ).length;
    if (lowUseCount >= 2 && totalItems >= 8) {
      insights.push({
        id: "low-use-signal",
        type: "low-use-signal",
        claim: `${lowUseCount} of your pieces aren't getting much wear. nAia can help you work out whether they need better styling context or simply aren't earning their place.`,
        evidence: [
          { field: "garmentRelationships", value: `${lowUseCount} items tagged rarely-wear or regret` },
        ],
        passportEffects: [],
      });
    }
  }

  // ── 4. Occasion coverage ───────────────────────────────────────────────────
  if (occasionEligible && profile?.lifestyle?.length) {
    const lifestyleIds = profile.lifestyle;
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

      const allSortedOccasions = [...relevantOccasions].sort();
      const occasionList = allSortedOccasions.length > 3
        ? `${allSortedOccasions.slice(0, 3).join(", ")}, and more`
        : allSortedOccasions.join(", ");
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

  // ── 5. Formality distribution (AI coverage ≥60%) ──────────────────────────
  if (formalityEligible) {
    const formalityCounts = new Map<string, number>();
    for (const item of items) {
      if (item.formality !== null) {
        formalityCounts.set(item.formality, (formalityCounts.get(item.formality) ?? 0) + 1);
      }
    }

    const casual = (formalityCounts.get("casual") ?? 0) + (formalityCounts.get("smart-casual") ?? 0);
    const structured = (formalityCounts.get("business-casual") ?? 0) + (formalityCounts.get("business-formal") ?? 0);
    const occasion = (formalityCounts.get("occasion") ?? 0) + (formalityCounts.get("evening") ?? 0);

    let claim: string;
    if (casual >= structured && casual >= occasion && casual / formalityTaggedItems >= 0.6) {
      claim = `Most of your analysed pieces are casual or smart-casual — ${casual} of ${formalityTaggedItems} nAia has assessed.`;
    } else if (structured >= casual && structured >= occasion && structured / formalityTaggedItems >= 0.6) {
      claim = `Your Closet leans toward structured, work-ready pieces — ${structured} of ${formalityTaggedItems} assessed pieces are business-casual or formal.`;
    } else if (occasion >= casual && occasion >= structured && occasion / formalityTaggedItems >= 0.4) {
      claim = `A notable share of your assessed pieces are occasion or evening — ${occasion} of ${formalityTaggedItems}.`;
    } else {
      const topGroup = casual >= structured && casual >= occasion
        ? `casual (${casual})`
        : structured >= occasion
          ? `structured (${structured})`
          : `occasion (${occasion})`;
      claim = `Your Closet's formality is mixed across ${formalityTaggedItems} assessed pieces — ${topGroup} leads.`;
    }

    insights.push({
      id: "formality-distribution",
      type: "formality-distribution",
      claim,
      evidence: [
        { field: "formality", value: `${formalityTaggedItems} of ${totalItems} items have formality data` },
      ],
      passportEffects: [],
    });
  }

  // ── 6. Category concentration ──────────────────────────────────────────────
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

  // ── 7. Palette insights ────────────────────────────────────────────────────
  if (paletteEligible) {
    const colourCounts = new Map<string, number>();
    for (const item of items) {
      if (item.primaryColor !== null) {
        colourCounts.set(item.primaryColor, (colourCounts.get(item.primaryColor) ?? 0) + 1);
      }
    }

    const qualifying = Array.from(colourCounts.entries())
      .filter(([, count]) => count >= 2 && count / colouredItems >= 0.4)
      .sort((a, b) => b[1] - a[1]);

    const topCount = qualifying[0]?.[1] ?? 0;
    const topTied = qualifying.filter(([, count]) => count === topCount);

    let paletteLeaderColour: string | null = null;
    let paletteLeaderFavId: string | null = null;
    if (topTied.length === 1) {
      const candidate = topTied[0][0];
      for (const favId of (profile?.favoriteColors ?? [])) {
        if (PASSPORT_COLOUR_TO_CLOSET[favId] === candidate) {
          paletteLeaderColour = candidate;
          paletteLeaderFavId = favId;
          break;
        }
      }
      if (paletteLeaderColour === null) paletteLeaderColour = candidate;
    }

    let paletteClaim: string;
    const palettePassportEffects: PassportEffect[] = [];
    if (topTied.length === 1) {
      const [dominantColour, dominantCount] = topTied[0];
      if (paletteLeaderFavId !== null) {
        paletteClaim = `${dominantColour} is your most represented colour and one of your favourites — ${dominantCount} of your ${colouredItems} recorded pieces are ${dominantColour.toLowerCase()}.`;
        palettePassportEffects.push({ field: "favoriteColors", matchedId: paletteLeaderFavId, effect: "framing" });
      } else {
        paletteClaim = `${dominantColour} is your most represented colour — ${dominantCount} of your ${colouredItems} recorded pieces are ${dominantColour.toLowerCase()}.`;
      }
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
      passportEffects: palettePassportEffects,
    });

    for (const favId of (profile?.favoriteColors ?? [])) {
      const closetColour = PASSPORT_COLOUR_TO_CLOSET[favId];
      if (!closetColour) continue;
      if (closetColour === paletteLeaderColour && paletteLeaderFavId !== null) continue;

      const count = colourCounts.get(closetColour) ?? 0;
      const favClaim = buildFavouriteColourClaim(closetColour, count, colouredItems);

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

  // ── 8. Season coverage ─────────────────────────────────────────────────────
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

  // ── Curation: sort by priority, return top MAX_INSIGHTS ───────────────────
  insights.sort((a, b) => (INSIGHT_PRIORITY[b.type] ?? 0) - (INSIGHT_PRIORITY[a.type] ?? 0));
  return { dataQuality, insights: insights.slice(0, MAX_INSIGHTS) };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildFavouriteColourClaim(colour: string, count: number, total: number): string {
  const lower = colour.toLowerCase();
  const verb = count === 1 ? "is" : "are";
  const pieceWord = count === 1 ? "piece" : "pieces";
  if (count === 0) {
    return `${colour} is one of your favourite colours, but it isn't currently represented among your ${total} recorded pieces.`;
  }
  if (count >= 2 && count / total >= 0.3) {
    return `${colour} is one of your favourite colours and it's well represented — ${count} of your ${total} recorded ${pieceWord} ${verb} ${lower}.`;
  }
  return `${colour} is one of your favourite colours — ${count} of your ${total} recorded ${pieceWord} ${verb} ${lower}.`;
}

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
  return "Based on your lifestyle preferences";
}
