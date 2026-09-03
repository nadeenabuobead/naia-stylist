// app/lib/ai/closet-insights.ts
// V1 relationship/formality — deterministic, on-demand Closet Insights engine.
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

// Individual insight priority — used to pick the best from each family.
// Max 4 insights are returned per call.
const INSIGHT_PRIORITY: Readonly<Record<string, number>> = {
  "wear-behaviour":              10,
  "friction-signal":              9,
  "low-use-signal":               8,
  "occasion-coverage":            7,
  "formality-distribution":       6,
  "category-concentration":       4,
  "palette-distribution":         3,
  "favourite-colour-comparison":  2,
  "avoided-colour-mismatch":      2,
  "season-coverage":              1,
};

// Diversity families — controls curation round-robin.
// Within each family the highest-priority candidate is taken first.
// Family order controls which family gets a slot before others.
const INSIGHT_FAMILY: Readonly<Record<string, string>> = {
  "wear-behaviour":              "relationship",
  "friction-signal":             "relationship",
  "low-use-signal":              "relationship",
  "occasion-coverage":           "lifestyle",
  "formality-distribution":      "lifestyle",
  "category-concentration":      "composition",
  "palette-distribution":        "colour",
  "favourite-colour-comparison": "colour",
  "avoided-colour-mismatch":     "colour",
  "season-coverage":             "season",
};

// Round-robin order: relationship first, season last.
const FAMILY_ORDER = ["relationship", "lifestyle", "composition", "colour", "season"] as const;

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

  // ── 1. Wear behaviour — consolidated relationship story ────────────────────
  //
  // When relationship coverage ≥60% we emit ONE insight that synthesises the full
  // distribution: positive core, styling friction, and low-use in a single claim.
  // This prevents friction-signal and low-use-signal from repeating data already
  // represented here. Standalone friction/low-use only fire when coverage <60%.
  if (relationshipEligible) {
    const taggedItems = items.filter(
      (i) => (i.garmentRelationships ?? []).some((r) => VALID_GARMENT_RELATIONSHIPS.has(r)),
    );
    const positiveItems = taggedItems.filter((i) =>
      (i.garmentRelationships ?? []).some((r) => POSITIVE_RELATIONSHIPS.has(r)),
    ).length;
    // Friction and negative split by individual tag so claims don't conflate distinct meanings.
    const struggleItems = taggedItems.filter((i) =>
      (i.garmentRelationships ?? []).includes("love-style-struggle"),
    ).length;
    const unsureItems = taggedItems.filter((i) =>
      (i.garmentRelationships ?? []).includes("unsure"),
    ).length;
    const rarelyWearItems = taggedItems.filter((i) =>
      (i.garmentRelationships ?? []).includes("rarely-wear"),
    ).length;
    const regretItems = taggedItems.filter((i) =>
      (i.garmentRelationships ?? []).includes("regret"),
    ).length;
    // Items carrying BOTH rarely-wear AND regret — counted once as a unit, described together.
    const bothNegItems = taggedItems.filter((i) => {
      const rels = i.garmentRelationships ?? [];
      return rels.includes("rarely-wear") && rels.includes("regret");
    }).length;
    const rarelyWearOnlyItems = rarelyWearItems - bothNegItems;
    const regretOnlyItems = regretItems - bothNegItems;
    const frictionItems = struggleItems + unsureItems;
    const negativeItems = rarelyWearItems + regretItems - bothNegItems; // unique items

    const taggedCount = taggedItems.length;
    const positiveRatio = positiveItems / taggedCount;
    const frictionRatio = frictionItems / taggedCount;
    const negativeRatio = negativeItems / taggedCount;

    let claim: string;

    if (positiveRatio >= 0.5) {
      // Positive majority — describe any additional signals in the same sentence.
      if (frictionItems === 0 && negativeItems === 0) {
        const pieceWord = positiveItems === 1 ? "piece" : "pieces";
        claim = `${positiveItems} of the ${taggedCount} ${pieceWord} you've tagged are favourites or ones you wear often — a clear core is forming in your Closet.`;
      } else {
        const notes: string[] = [];
        if (struggleItems > 0) {
          notes.push(`${struggleItems} ${struggleItems === 1 ? "is" : "are"} harder to style`);
        }
        if (unsureItems > 0) {
          notes.push(`${unsureItems} you're still unsure about`);
        }
        if (bothNegItems > 0) {
          notes.push(bothNegItems === 1 ? "1 is rarely worn and a purchase you regret" : `${bothNegItems} are rarely worn and purchases you regret`);
        }
        if (rarelyWearOnlyItems > 0) {
          notes.push(`${rarelyWearOnlyItems} ${rarelyWearOnlyItems === 1 ? "rarely gets" : "rarely get"} worn`);
        }
        if (regretOnlyItems > 0) {
          notes.push(regretOnlyItems === 1 ? "1 is a purchase you regret" : `${regretOnlyItems} are purchases you regret`);
        }
        claim = `${positiveItems} of the ${taggedCount} pieces you've tagged are favourites or regular wears — ${joinInsightNotes(notes)}.`;
      }
    } else if (negativeRatio >= 0.4) {
      const parts: string[] = [];
      if (bothNegItems > 0) {
        parts.push(bothNegItems === 1 ? "1 is rarely worn and a purchase you regret" : `${bothNegItems} are rarely worn and purchases you regret`);
      }
      if (rarelyWearOnlyItems > 0) {
        parts.push(`${rarelyWearOnlyItems} ${rarelyWearOnlyItems === 1 ? "rarely gets" : "rarely get"} worn`);
      }
      if (regretOnlyItems > 0) {
        parts.push(regretOnlyItems === 1 ? "1 is a purchase you regret" : `${regretOnlyItems} are purchases you regret`);
      }
      const negDesc = joinInsightNotes(parts);
      claim = `${negativeItems} of the ${taggedCount} ${negativeItems === 1 ? "piece" : "pieces"} you've tagged ${negativeItems === 1 ? "isn't earning its place" : "aren't earning their place"} — ${negDesc}.`;
    } else if (frictionRatio > positiveRatio && frictionRatio >= 0.33) {
      if (struggleItems > 0 && unsureItems > 0) {
        claim = `${struggleItems} of the ${taggedCount} pieces you've tagged are harder to style, and ${unsureItems} you're still unsure about — more uncertain pieces than clear favourites right now.`;
      } else if (struggleItems > 0) {
        claim = `${struggleItems} of the ${taggedCount} pieces you've tagged are ones you love but haven't figured out how to style yet — more than your clear favourites right now.`;
      } else {
        claim = `${unsureItems} of the ${taggedCount} pieces you've tagged are ones you're still unsure about — more uncertainty than clarity in your Closet right now.`;
      }
    } else {
      const parts: string[] = [];
      if (positiveItems > 0) {
        parts.push(`${positiveItems} ${positiveItems === 1 ? "piece" : "pieces"} you wear regularly`);
      }
      if (struggleItems > 0) {
        parts.push(`${struggleItems} ${struggleItems === 1 ? "is" : "are"} harder to style`);
      }
      if (unsureItems > 0) {
        parts.push(`${unsureItems} you're still unsure about`);
      }
      if (bothNegItems > 0) {
        parts.push(bothNegItems === 1 ? "1 that's rarely worn and a purchase you regret" : `${bothNegItems} that are rarely worn and purchases you regret`);
      }
      if (rarelyWearOnlyItems > 0) {
        parts.push(`${rarelyWearOnlyItems} that rarely ${rarelyWearOnlyItems === 1 ? "gets" : "get"} worn`);
      }
      if (regretOnlyItems > 0) {
        parts.push(regretOnlyItems === 1 ? "1 that's a purchase you regret" : `${regretOnlyItems} that are purchases you regret`);
      }
      claim = parts.length > 0
        ? `The pieces you've tagged are spread — ${joinInsightNotes(parts)}.`
        : `You've tagged ${taggedCount} of the ${totalItems} pieces you've added with how you feel about them.`;
    }

    insights.push({
      id: "wear-behaviour",
      type: "wear-behaviour",
      claim,
      evidence: [
        {
          field: "garmentRelationships",
          value: `${taggedCount} of ${totalItems} items tagged; ${positiveItems} positive, ${struggleItems} struggle, ${unsureItems} unsure, ${rarelyWearItems} rarely-wear, ${regretItems} regret`,
        },
      ],
      passportEffects: [],
    });
  }

  // ── 2. Friction signal — standalone only when relationship coverage <60% ────
  // When relationshipEligible, friction is already represented in wear-behaviour above.
  if (!relationshipEligible) {
    const struggleCount = items.filter(
      (i) => (i.garmentRelationships ?? []).includes("love-style-struggle"),
    ).length;
    if (struggleCount >= 2) {
      const pieceWord = struggleCount === 1 ? "piece" : "pieces";
      insights.push({
        id: "friction-signal",
        type: "friction-signal",
        claim: `${struggleCount} of the ${pieceWord} you've added are ones you love but struggle to style. The issue is often how they connect to the rest of your Closet, not whether they belong there.`,
        evidence: [
          { field: "garmentRelationships", value: `${struggleCount} items tagged love-style-struggle` },
        ],
        passportEffects: [],
      });
    }
  }

  // ── 3. Low-use signal — standalone only when relationship coverage <60% ─────
  // When relationshipEligible, low-use is already represented in wear-behaviour above.
  if (!relationshipEligible) {
    const lowUseCount = items.filter(
      (i) => (i.garmentRelationships ?? []).some((r) => r === "rarely-wear" || r === "regret"),
    ).length;
    if (lowUseCount >= 2 && totalItems >= 8) {
      insights.push({
        id: "low-use-signal",
        type: "low-use-signal",
        claim: `${lowUseCount} of the pieces you've added aren't getting much wear. nAia can help you work out whether they need better styling context or simply aren't earning their place.`,
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

      const naturalOccasions = describeOccasionSet(relevantOccasions);
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

      const pieceBase = `the ${occasionTaggedItems} pieces with occasion information you've added`;

      let claim: string;
      if (hasEventOutfitsSupport) {
        if (relevantCount === 0) {
          claim = `For event-outfit planning, none of ${pieceBase} are tagged for ${naturalOccasions}.`;
        } else {
          claim = `For event-outfit planning, your Closet currently includes ${relevantCount} ${relevantCount === 1 ? "piece" : "pieces"} tagged for ${naturalOccasions}.`;
        }
      } else {
        const context = buildLifestyleContext(mappedLifestyleIds);
        if (relevantCount === 0) {
          claim = `${context} — none of ${pieceBase} are tagged for ${naturalOccasions}.`;
        } else if (relevantCount <= 2) {
          claim = `${context} — ${relevantCount} of ${pieceBase} ${relevantCount === 1 ? "is" : "are"} tagged for ${naturalOccasions}. That's limited coverage for now.`;
        } else {
          claim = `${context} — ${relevantCount} of ${pieceBase} cover ${naturalOccasions}.`;
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
  //
  // User-facing bucket labels:
  //   casual + smart-casual  → "everyday and casual"
  //   business-casual + business-formal → "work-ready"
  //   occasion + evening → "occasion and evening"
  //
  // When Passport lifestyle is available, the claim adds framing about what
  // nAia currently has visibility into — without implying a wardrobe gap.
  if (formalityEligible) {
    const formalityCounts = new Map<string, number>();
    for (const item of items) {
      if (item.formality !== null) {
        formalityCounts.set(item.formality, (formalityCounts.get(item.formality) ?? 0) + 1);
      }
    }

    const casualCount = (formalityCounts.get("casual") ?? 0) + (formalityCounts.get("smart-casual") ?? 0);
    const workReady = (formalityCounts.get("business-casual") ?? 0) + (formalityCounts.get("business-formal") ?? 0);
    const occasionCount = (formalityCounts.get("occasion") ?? 0) + (formalityCounts.get("evening") ?? 0);

    const lifestyleIds = profile?.lifestyle ?? [];
    const hasWorkLifestyle = lifestyleIds.some((id) => id === "office" || id === "hybrid");
    const hasEverydayLifestyle = lifestyleIds.some(
      (id) => id === "everyday" || id === "everyday-casual" || id === "family-parenting" || id === "active-busy-days",
    );

    const assessedPhrase = `the ${formalityTaggedItems} pieces nAia has assessed so far`;

    let claim: string;
    if (casualCount >= workReady && casualCount >= occasionCount && casualCount / formalityTaggedItems >= 0.6) {
      claim = `Most of ${assessedPhrase} are everyday and casual — ${casualCount} of ${formalityTaggedItems}.`;
      if (hasWorkLifestyle) {
        claim += ` nAia currently has less visibility into your work wardrobe, which is also part of the lifestyle you've described.`;
      }
    } else if (workReady >= casualCount && workReady >= occasionCount && workReady / formalityTaggedItems >= 0.6) {
      claim = `Most of ${assessedPhrase} lean work-ready — ${workReady} of ${formalityTaggedItems} are business-casual or formal.`;
      if (hasEverydayLifestyle) {
        claim += ` nAia currently sees more of your work wardrobe than your everyday side.`;
      }
    } else if (occasionCount >= casualCount && occasionCount >= workReady && occasionCount / formalityTaggedItems >= 0.4) {
      claim = `A notable share of ${assessedPhrase} are occasion or evening — ${occasionCount} of ${formalityTaggedItems}.`;
    } else {
      // Mixed — use human-readable bucket names, no internal variable leakage.
      const topLabel = casualCount >= workReady && casualCount >= occasionCount
        ? `everyday and casual (${casualCount})`
        : workReady >= occasionCount
          ? `work-ready (${workReady})`
          : `occasion and evening (${occasionCount})`;
      claim = `The formality mix across ${assessedPhrase} is varied — ${topLabel} leads.`;
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
  //
  // Threshold raised to >60% to require a genuinely notable skew.
  // A 50/50 split or a simple majority is not distinctive enough for one of
  // only four Closet Insight slots.
  {
    const categoryCounts = new Map<string, number>();
    for (const item of items) {
      categoryCounts.set(item.category, (categoryCounts.get(item.category) ?? 0) + 1);
    }

    const maxCount = Math.max(...Array.from(categoryCounts.values()));
    const leaders = Array.from(categoryCounts.entries()).filter(([, count]) => count === maxCount);

    if (leaders.length === 1 && maxCount >= 3 && maxCount / totalItems >= 0.6) {
      const [leadCategory, leadCount] = leaders[0];
      const categoryLabel = leadCategory.toLowerCase();

      const passportEffects: PassportEffect[] = [];
      let claim: string;

      if ((profile?.styleSupport ?? []).includes("style-what-i-own")) {
        claim = `Here's what your Closet gives you to work with — ${leadCount} of the ${totalItems} pieces you've added are ${categoryLabel}.`;
        passportEffects.push({ field: "styleSupport", matchedId: "style-what-i-own", effect: "framing" });
      } else {
        claim = `Among the pieces you've added, ${categoryLabel} dominates — ${leadCount} of ${totalItems} are ${categoryLabel}.`;
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
        paletteClaim = `${dominantColour} is your most represented colour and one of your favourites — ${dominantCount} of the ${colouredItems} pieces in your Closet are ${dominantColour.toLowerCase()}.`;
        palettePassportEffects.push({ field: "favoriteColors", matchedId: paletteLeaderFavId, effect: "framing" });
      } else {
        paletteClaim = `${dominantColour} is your most represented colour — ${dominantCount} of the ${colouredItems} pieces in your Closet are ${dominantColour.toLowerCase()}.`;
      }
    } else {
      paletteClaim = `Your palette is spread across multiple colours — no single colour dominates among the ${colouredItems} pieces in your Closet.`;
    }

    insights.push({
      id: "palette-distribution",
      type: "palette-distribution",
      claim: paletteClaim,
      evidence: [
        {
          field: "primaryColor",
          value: `${colouredItems} items with colour across ${colourCounts.size} ${colourCounts.size === 1 ? "colour" : "colours"}`,
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
          { field: "primaryColor", value: `${count} of ${colouredItems} items in your Closet are ${closetColour}` },
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
        claim: `You prefer to avoid ${closetColour.toLowerCase()} — ${count} of the pieces you've added to your Closet are ${closetColour.toLowerCase()}.`,
        evidence: [
          { field: "primaryColor", value: `${count} of ${colouredItems} items in your Closet are ${closetColour}` },
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
        claim: `Among the ${seasonTaggedItems} pieces with season information you've added, none are tagged for ${uncoveredList}.`,
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

  // ── Curation: diversity-first, then priority within each family ───────────
  //
  // Rather than a pure priority sort (which lets one family dominate all 4 slots),
  // we round-robin across families in a fixed order. Within each family we always
  // take the highest-priority remaining candidate. This ensures that a second
  // relationship insight cannot displace a strong colour or lifestyle insight merely
  // because its static priority number is higher.
  //
  // Round 1: take the best from each family in order (relationship → lifestyle →
  //   composition → colour → season) until MAX_INSIGHTS is reached.
  // Round 2+: if slots remain, repeat with remaining candidates.
  //
  // Consequence: when wear-behaviour fires (the one consolidated relationship
  // insight), the lifestyle slot goes to occasion or formality, the composition
  // slot to category, and the colour slot to the best palette insight — giving a
  // diverse, non-repetitive result set.
  return { dataQuality, insights: curateDiverse(insights) };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function curateDiverse(candidates: ClosetInsight[]): ClosetInsight[] {
  // Sort candidates by individual priority descending so each family pool is ordered.
  const sorted = [...candidates].sort(
    (a, b) => (INSIGHT_PRIORITY[b.type] ?? 0) - (INSIGHT_PRIORITY[a.type] ?? 0),
  );

  const byFamily = new Map<string, ClosetInsight[]>();
  for (const insight of sorted) {
    const family = INSIGHT_FAMILY[insight.type] ?? "other";
    if (!byFamily.has(family)) byFamily.set(family, []);
    byFamily.get(family)!.push(insight);
  }

  const result: ClosetInsight[] = [];
  const used = new Set<string>();

  let progress = true;
  while (result.length < MAX_INSIGHTS && progress) {
    progress = false;
    for (const family of FAMILY_ORDER) {
      if (result.length >= MAX_INSIGHTS) break;
      const pool = byFamily.get(family) ?? [];
      const next = pool.find((i) => !used.has(i.id));
      if (next) {
        result.push(next);
        used.add(next.id);
        progress = true;
      }
    }
  }

  return result;
}

function joinInsightNotes(notes: string[]): string {
  if (notes.length === 0) return "";
  if (notes.length === 1) return notes[0];
  if (notes.length === 2) return `${notes[0]} and ${notes[1]}`;
  return `${notes.slice(0, -1).join(", ")}, and ${notes[notes.length - 1]}`;
}

function buildFavouriteColourClaim(colour: string, count: number, total: number): string {
  const lower = colour.toLowerCase();
  const verb = count === 1 ? "is" : "are";
  const pieceWord = count === 1 ? "piece" : "pieces";
  if (count === 0) {
    return `${colour} is one of your favourite colours, but it isn't currently represented among the ${total} pieces in your Closet.`;
  }
  if (count >= 2 && count / total >= 0.3) {
    return `${colour} is one of your favourite colours and it's well represented — ${count} of the ${total} ${pieceWord} in your Closet ${verb} ${lower}.`;
  }
  return `${colour} is one of your favourite colours — ${count} of the ${total} ${pieceWord} in your Closet ${verb} ${lower}.`;
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
  return "Based on your lifestyle";
}

// Translates a set of internal Closet occasion strings into natural language.
function describeOccasionSet(occasions: Set<string>): string {
  const sorted = [...occasions].sort();
  const key = sorted.join(",");
  const natural: Readonly<Record<string, string>> = {
    "Casual,Weekend":           "everyday and weekend occasions",
    "Date,Dinner,Formal,Party": "evenings and special occasions",
    "Date,Dinner,Party":        "evenings and dinners",
    "Dinner,Formal,Party":      "evenings and formal occasions",
    "Dinner,Party":             "evenings and dinners",
    "Date":                     "date-night occasions",
    "Dinner":                   "evening occasions",
    "Formal":                   "formal occasions",
    "Party":                    "party occasions",
    "Travel":                   "travel",
    "Work":                     "work occasions",
  };
  if (natural[key]) return natural[key];
  // Generic fallback: lowercase, readable join.
  const items = sorted.map((o) => o.toLowerCase());
  if (items.length === 1) return `${items[0]} occasions`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]} occasions`;
}
