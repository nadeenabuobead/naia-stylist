import prisma from "../db.server";
import type { TrendReportData } from "./trend-reports";

// ---------------------------------------------------------------------------
// Evidence bundle — assembled server-side, scoped to exactly one customer,
// fetched with `select` (never `include`) so only fields this feature
// actually reads ever leave the database. No general Customer fields and no
// full related records are loaded.
//
// StylingEvent is intentionally not included: it tracks product-level
// engagement (clicks/try-on/wishlist), which doesn't map to any of the five
// required Trend Edit sections and would widen scope without adding a
// signal this feature actually uses.
// ---------------------------------------------------------------------------

export type ShopperProfileEvidence = {
  stylePersonalities: string[];
  favoriteColors: string[];
  lifestyle: string | null;
  desiredFeeling: string | null;
  desiredFeelings: string[];
  desiredImpression: string[];
  fitPreferences: string[];
  becoming: string[];
};

export type ShopperClosetItemEvidence = {
  name: string | null;
  imageUrl: string | null;
  category: string;
  subcategory: string | null;
  primaryColor: string | null;
  styleTags: string[];
  occasions: string[];
  material: string | null;
};

export type ShopperSavedLookEvidence = {
  name: string | null;
  occasion: string | null;
};

export type ShopperReviewSignal = {
  reviewCount: number;
  workedTags: string[];
  didntWorkTags: string[];
};

export type ShopperEvidenceBundle = {
  hasProfile: boolean;
  profile: ShopperProfileEvidence | null;
  closetItems: ShopperClosetItemEvidence[];
  savedLooks: ShopperSavedLookEvidence[];
  reviewSignal: ShopperReviewSignal;
};

const EMPTY_BUNDLE: ShopperEvidenceBundle = {
  hasProfile: false,
  profile: null,
  closetItems: [],
  savedLooks: [],
  reviewSignal: { reviewCount: 0, workedTags: [], didntWorkTags: [] },
};

// customerId must come from the authenticated session only (requireCurrentNaiaCustomer) —
// never from a route param, query string, or request body.
export async function getShopperEvidence(customerId: string): Promise<ShopperEvidenceBundle> {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: {
      onboardingProfile: {
        select: {
          stylePersonalities: true,
          favoriteColors: true,
          lifestyle: true,
          desiredFeeling: true,
          desiredFeelings: true,
          desiredImpression: true,
          fitPreferences: true,
          becoming: true,
          completed: true,
        },
      },
      closetItems: {
        take: 20,
        orderBy: { createdAt: "desc" },
        select: {
          name: true,
          imageUrl: true,
          category: true,
          subcategory: true,
          primaryColor: true,
          styleTags: true,
          occasions: true,
          material: true,
        },
      },
      savedLooks: {
        take: 20,
        orderBy: { createdAt: "desc" },
        select: {
          name: true,
          occasion: true,
        },
      },
      postOutfitReviews: {
        take: 20,
        orderBy: { createdAt: "desc" },
        select: {
          workedTags: true,
          didntWorkTags: true,
        },
      },
    },
  });

  if (!customer) return EMPTY_BUNDLE;

  const profile = customer.onboardingProfile;
  const hasProfile = Boolean(profile?.completed);

  const workedTags: string[] = [];
  const didntWorkTags: string[] = [];
  for (const review of customer.postOutfitReviews) {
    if (review.workedTags) {
      try {
        const parsed = JSON.parse(review.workedTags);
        if (Array.isArray(parsed)) workedTags.push(...parsed);
      } catch {
        // malformed legacy data — skip rather than fail the page
      }
    }
    if (review.didntWorkTags) {
      try {
        const parsed = JSON.parse(review.didntWorkTags);
        if (Array.isArray(parsed)) didntWorkTags.push(...parsed);
      } catch {
        // malformed legacy data — skip rather than fail the page
      }
    }
  }

  return {
    hasProfile,
    profile: hasProfile && profile ? {
      stylePersonalities: profile.stylePersonalities ?? [],
      favoriteColors: profile.favoriteColors ?? [],
      lifestyle: profile.lifestyle ?? null,
      desiredFeeling: profile.desiredFeeling ?? null,
      desiredFeelings: profile.desiredFeelings ?? [],
      desiredImpression: profile.desiredImpression ?? [],
      fitPreferences: profile.fitPreferences ?? [],
      becoming: profile.becoming ?? [],
    } : null,
    closetItems: customer.closetItems.map((item) => ({
      name: item.name,
      imageUrl: item.imageUrl ?? null,
      category: item.category,
      subcategory: item.subcategory ?? null,
      primaryColor: item.primaryColor ?? null,
      styleTags: item.styleTags ?? [],
      occasions: item.occasions ?? [],
      material: item.material ?? null,
    })),
    savedLooks: customer.savedLooks.map((look) => ({
      name: look.name,
      occasion: look.occasion,
    })),
    reviewSignal: {
      reviewCount: customer.postOutfitReviews.length,
      workedTags: [...new Set(workedTags)],
      didntWorkTags: [...new Set(didntWorkTags)],
    },
  };
}

// ---------------------------------------------------------------------------
// Deterministic, code-based selection. No AI call here — this is the full
// V1 implementation, not a fallback path. Every line below only ever
// references text already present in `report` (the looked-up static
// report) or `evidence` (this customer's own data). Nothing is invented.
// ---------------------------------------------------------------------------

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Whole-word / whole-phrase matching only, case-insensitive. "red" must not
// match inside "tailored" or "structured"; "soft structure" must match the
// exact phrase "soft structure". Terms come from stored Passport/Closet
// data, so they're regex-escaped before use.
function matchedTerms(haystack: string, terms: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of terms) {
    const term = (raw ?? "").trim();
    if (!term) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    const pattern = new RegExp(`\\b${escapeRegExp(term)}\\b`, "i");
    if (pattern.test(haystack)) {
      seen.add(key);
      out.push(term);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Style translation maps. Each map is keyed by the exact option `id` values
// defined in app/lib/onboarding/quiz-data.ts (the only values that are ever
// actually stored on OnboardingProfile / ClosetItem) and lists the report
// styling-direction words that are a genuine, code-owned, human-reviewed
// connection to that option. A map never invents a connection that isn't
// already implied by nAia's own style vocabulary, and it is only ever used
// to decide whether to surface a sentence already grounded in: (a) a value
// the shopper actually chose, and (b) a word or phrase that actually
// appears in the report's own text. No body, size, fit-success, or
// purchase-outcome claims are made anywhere in these maps.
// ---------------------------------------------------------------------------

// Keys: style-personalities option ids.
const PERSONALITY_STYLE_MAP: Record<string, { label: string; terms: string[] }> = {
  "old-money": { label: "Old Money", terms: ["tailoring", "tailored", "structured", "clean", "longline"] },
  "artsy": { label: "Artsy", terms: ["sculptural", "asymmetric", "drape", "gesture"] },
  "edgy": { label: "Edgy", terms: ["asymmetric", "sculptural", "defined", "structured"] },
  "feminine": { label: "Feminine", terms: ["fluid", "draped", "soft", "midi", "column", "feminine"] },
  "corporate-chic": { label: "Corporate Chic", terms: ["tailoring", "tailored", "blazer", "trouser", "structured", "polished"] },
  "effortlessly-chic": { label: "Effortlessly Chic", terms: ["ease", "fluid", "clean", "quiet", "familiar"] },
  "minimal": { label: "Minimal", terms: ["clean", "restrained", "quiet", "architectural"] },
  "trendy": { label: "Trendy", terms: ["sculptural", "asymmetric", "structured", "fluid"] },
  "romantic": { label: "Romantic", terms: ["fluid", "draped", "soft", "midi", "ease"] },
  "casual-cool": { label: "Casual Cool", terms: ["ease", "fluid", "familiar", "trouser", "denim"] },
};

// Keys: the union of desired-impression, desired-feelings, and becoming
// option ids (all describe an aspirational identity word).
const ASPIRATION_STYLE_MAP: Record<string, { label: string; terms: string[] }> = {
  "refined": { label: "refined", terms: ["tailoring", "tailored", "clean", "restrained", "structured", "architectural"] },
  "creative": { label: "creative", terms: ["sculptural", "asymmetric", "drape", "gesture", "architectural"] },
  "powerful": { label: "powerful", terms: ["structured", "defined", "trouser", "blazer", "presence"] },
  "soft-confident": { label: "soft but confident", terms: ["fluid", "soft", "clean", "structured", "polished", "confident"] },
  "effortless": { label: "effortless", terms: ["ease", "fluid", "familiar", "quiet", "clean"] },
  "interesting": { label: "interesting", terms: ["sculptural", "asymmetric", "gesture", "architectural", "drape"] },
  "put-together": { label: "put together", terms: ["tailoring", "tailored", "structured", "clean", "polished", "blazer"] },
  "confident": { label: "confident", terms: ["structured", "defined", "trouser", "blazer", "presence"] },
  "comfortable": { label: "comfortable", terms: ["ease", "fluid", "familiar", "relaxed"] },
  "elegant": { label: "elegant", terms: ["fluid", "draped", "column", "restrained", "polished"] },
  "attractive": { label: "attractive", terms: ["polished", "feminine", "confident", "clean"] },
  "feminine": { label: "feminine", terms: ["fluid", "draped", "midi", "column", "feminine", "soft"] },
};

// Keys: fit-preferences option ids.
const FIT_SILHOUETTE_MAP: Record<string, { label: string; terms: string[] }> = {
  "defined-waist": { label: "Defined Waist", terms: ["waist", "tailoring", "tailored", "structured"] },
  "relaxed-fits": { label: "Relaxed Fits", terms: ["ease", "fluid", "relaxed", "familiar"] },
  "structured": { label: "Structured Pieces", terms: ["structured", "blazer", "tailoring", "tailored", "architectural"] },
  "oversized": { label: "Oversized Layers", terms: ["ease", "longline", "familiar", "fluid"] },
  "flowy": { label: "Flowy Pieces", terms: ["fluid", "draped", "ease", "soft"] },
  "coverage": { label: "More Coverage", terms: ["long", "layer", "trouser", "column", "vertical"] },
  "fitted": { label: "Fitted Looks", terms: ["defined", "clean", "column", "structured"] },
  "simple": { label: "Simple Outfits", terms: ["clean", "quiet", "restrained", "familiar"] },
};

// Keys: favorite-colors option ids. Values are the real words inside each
// option's display name (e.g. "White / Cream" → "white", "cream"), since
// those are the words that can plausibly appear in editorial report text —
// the kebab-case id itself never will.
const COLOR_SEARCH_MAP: Record<string, { label: string; terms: string[] }> = {
  "black": { label: "Black", terms: ["black"] },
  "white-cream": { label: "White / Cream", terms: ["white", "cream"] },
  "beige-brown": { label: "Beige / Brown", terms: ["beige", "brown"] },
  "grey": { label: "Grey", terms: ["grey", "gray"] },
  "navy": { label: "Navy", terms: ["navy"] },
  "red-burgundy": { label: "Red / Burgundy", terms: ["red", "burgundy"] },
  "green": { label: "Green", terms: ["green"] },
  "pink": { label: "Pink", terms: ["pink"] },
  "prints": { label: "Prints", terms: ["print", "prints"] },
  "colorful": { label: "Colorful Pieces", terms: ["colour", "color", "colourful", "colorful"] },
};

// Keys: the ClosetCategory enum (prisma/schema.prisma). Used only as a
// fallback when no individual closet item's own name/tags matched — this
// surfaces a category-level formula reference, never a claim about a
// specific garment's styling details. Categories with no plausible report
// vocabulary (jewelry, activewear, swimwear, loungewear, other) are left
// empty on purpose: they simply never produce a formula match, rather than
// forcing one.
const CLOSET_CATEGORY_MAP: Record<string, { label: string; terms: string[] }> = {
  TOPS: { label: "tops", terms: ["top", "knit", "shirt", "jersey"] },
  BOTTOMS: { label: "bottoms", terms: ["trouser", "skirt", "denim"] },
  DRESSES: { label: "dresses", terms: ["dress", "midi", "column", "slip"] },
  OUTERWEAR: { label: "outerwear", terms: ["blazer", "jacket", "layer", "longline", "vest"] },
  SHOES: { label: "shoes", terms: ["shoe"] },
  BAGS: { label: "bags", terms: ["bag"] },
  ACCESSORIES: { label: "accessories", terms: ["scarf", "accessories", "accessory"] },
  JEWELRY: { label: "jewelry", terms: [] },
  ACTIVEWEAR: { label: "activewear", terms: [] },
  SWIMWEAR: { label: "swimwear", terms: [] },
  LOUNGEWEAR: { label: "loungewear", terms: [] },
  OTHER: { label: "other pieces", terms: [] },
};

// Keys: lifestyle option ids. Values are an ordered preference of
// report.howToWear[].feeling labels — the first one present in a given
// report is used, since not every report covers every context.
const LIFESTYLE_HOWTO_MAP: Record<string, string[]> = {
  "office": ["For work", "For everyday"],
  "hybrid": ["For work", "For everyday"],
  "busy-mom": ["For everyday", "For casual days"],
  "casual-days": ["For casual days", "For everyday"],
  "events": ["For dinner"],
  "on-the-go": ["For everyday", "For travel"],
  "travel": ["For travel", "For everyday"],
  "creative": ["For everyday", "For casual days"],
};

// Free-text keyword map, used only for SavedLook.occasion (a free-text
// field — see the "From Your Closet (saved looks)" comment below for why
// this is the one signal that still needs fuzzy keyword matching rather
// than an id lookup). Keys are literal report.howToWear[].feeling strings.
const CONTEXT_SIGNAL_MAP: Record<string, string[]> = {
  "For work": ["work", "office", "professional", "career"],
  "For dinner": ["dinner", "evening", "date night", "going out"],
  "For everyday": ["everyday", "daily", "errands", "weekend"],
  "For travel": ["travel", "commute", "trips"],
  "For casual days": ["casual", "relaxed", "low-key"],
  "For modest dressing": ["modest", "covered", "conservative"],
};
// CONTEXT_SIGNAL_MAP retained for potential future saved-looks use.
void CONTEXT_SIGNAL_MAP;

// Positive-direction-only report text: keyTrends, rising, naiaInterpretation,
// howToWear directions, wardrobeNote, investmentNotes. Deliberately excludes
// `fading` — that text describes what the report says to move away from, so
// matching a shopper's style words against it would produce a backwards
// "this suits you" claim built from a "this is going out" sentence.
function buildPositiveReportText(report: TrendReportData): string {
  return [
    ...report.keyTrends.map((t) => `${t.name} ${t.description}`),
    ...(report.rising ?? []),
    report.naiaInterpretation ?? "",
    ...(report.howToWear ?? []).map((h) => h.direction),
    report.wardrobeNote ?? "",
    report.investmentNotes ?? "",
  ].join(" ");
}

// Key directions only — excludes investmentNotes and wardrobeNote so that
// conflict and gap detection never fires on the report's own caution copy.
function buildKeyDirectionsText(report: TrendReportData): string {
  return [
    ...report.keyTrends.map((t) => `${t.name} ${t.description}`),
    ...(report.howToWear ?? []).map((h) => h.direction),
    report.naiaInterpretation ?? "",
  ].join(" ");
}

// Closet-match corpus — used exclusively to decide whether a saved Closet
// item is relevant to this report. Excludes investmentNotes and
// naiaInterpretation: those fields contain editorial caution copy and
// interpretive framing, not the silhouette/colour/category vocabulary that
// a garment's subcategory, material, or styleTags would plausibly share.
function buildClosetMatchText(report: TrendReportData): string {
  return [
    ...report.keyTrends.map((t) => `${t.name} ${t.description}`),
    ...(report.howToWear ?? []).map((h) => h.direction),
    report.wardrobeNote ?? "",
  ].join(" ");
}

type TranslationHit = { label: string; term: string };

// Walks `ids` against `map`, returning one hit per id that has any match in
// `haystack`. Greedily prefers a term not already in `usedPhrases` so two
// different sections don't lean on the exact same matched word, then
// records whatever term it used so later calls (across sections) see it.
function translateAllHits(
  ids: string[],
  map: Record<string, { label: string; terms: string[] }>,
  haystack: string,
  usedPhrases: Set<string>,
): TranslationHit[] {
  const out: TranslationHit[] = [];
  for (const id of ids) {
    const entry = map[id];
    if (!entry || entry.terms.length === 0) continue;
    const hits = matchedTerms(haystack, entry.terms);
    if (hits.length === 0) continue;
    const fresh = hits.find((h) => !usedPhrases.has(h.toLowerCase())) ?? hits[0];
    out.push({ label: entry.label, term: fresh });
    usedPhrases.add(fresh.toLowerCase());
  }
  return out;
}

// ---------------------------------------------------------------------------
// Editorial templates for personalReading paragraph construction.
// Keyed by personality/aspiration option ids. These are editorial judgement
// calls reviewed per nAia's style vocabulary — they are never auto-generated.
// ---------------------------------------------------------------------------

const PERSONALITY_READING_OPENERS: Record<string, string> = {
  "old-money": "A wardrobe built on quiet authority finds its most useful ground here",
  "corporate-chic": "A wardrobe that values composure and polish is exactly what this report speaks to",
  "minimal": "A restrained approach to dressing is well-served by this direction",
  "effortlessly-chic": "A wardrobe that prioritises ease over effort lands well here",
  "artsy": "A wardrobe that treats structure as a starting point rather than a rule finds room to move here",
  "edgy": "A wardrobe that keeps one element deliberately disruptive finds this direction workable",
  "feminine": "A wardrobe that balances soft moments with clear silhouettes is well-positioned here",
  "trendy": "A wardrobe that responds to what is directional now finds this report's timing right",
  "romantic": "A wardrobe that values softness within a clear shape finds this direction natural",
  "casual-cool": "A wardrobe that prioritises ease and familiarity can work this direction without overcomplicating it",
};

const ASPIRATION_ENABLE_PHRASES: Record<string, string> = {
  "refined": "Composure is created without trying too hard — restraint is the whole method",
  "creative": "There is room for one unexpected element to carry the interest",
  "powerful": "Presence comes from proportion and weight, not volume or decoration",
  "soft-confident": "Clear structure and softness are not in conflict here",
  "effortless": "A considered look is achievable without reading as dressed-up",
  "interesting": "Architectural interest comes through silhouette rather than colour or print",
  "put-together": "This is the most reliable route to a finished, considered look without statement pieces",
  "confident": "Presence is built into the proportions — nothing needs to compete for attention",
  "comfortable": "Ease is already built into the silhouette, so comfort does not need to be negotiated",
  "elegant": "Restraint is where this direction earns its keep",
  "attractive": "A polished silhouette carries more than most individual pieces can",
  "feminine": "Softness and structure are not in conflict in this direction",
};

// ---------------------------------------------------------------------------
// Helper: adapt instruction — evaluate ALL fit preferences, pick highest tension
// ---------------------------------------------------------------------------

// Vocab terms whose presence in key directions signals a genuine tension with
// each fit preference id. Only preferences that have a real conceptual tension
// with common editorial directions are listed; others (coverage, simple,
// defined-waist) fall through to the editorial howToWear fallback.
const FIT_TENSION_VOCAB: Partial<Record<string, string[]>> = {
  "fitted":       ["fluid", "drape", "ease"],
  "relaxed-fits": ["structured", "tailored", "architectural"],
  "flowy":        ["structured", "tailored", "architectural"],
  "structured":   ["fluid", "drape", "ease"],
  "oversized":    ["restrained", "clean", "defined"],
};

function buildAdaptInstruction(
  fitPreferences: string[],
  report: TrendReportData,
  keyDirectionsText: string,
): string {
  // Find the preference with the strongest vocabulary tension against key directions.
  let bestFitId: string | null = null;
  let bestTension = 0;
  for (const fitId of fitPreferences) {
    const conflictVocab = FIT_TENSION_VOCAB[fitId] ?? [];
    const hits = matchedTerms(keyDirectionsText, conflictVocab);
    if (hits.length > bestTension) {
      bestTension = hits.length;
      bestFitId = fitId;
    }
  }

  if (bestFitId && bestTension > 0) {
    const hasFluid = /\bfluid\b|\bdraped?\b|\bease\b/i.test(keyDirectionsText);
    const hasStructure = /\bstructured?\b|\btailored?\b|\barchitectural\b/i.test(keyDirectionsText);
    const hasProportion = /\bproportion\b|\blongline\b|\bwide.leg\b/i.test(keyDirectionsText);

    const map: Partial<Record<string, string>> = {
      "fitted": hasFluid
        ? "Introduce one fluid element — a draped top, a wide skirt, a relaxed outer layer — against something more fitted underneath. The contrast is the look."
        : "One tailored piece carries the direction. Keep the rest clean and close — the sharpness is the point.",
      "relaxed-fits": hasStructure
        ? "Use the structure as one considered layer. A blazer or structured piece over something relaxed underneath keeps your ease intact."
        : "The ease in this direction is already built in — choose pieces with enough weight to hold their shape.",
      "flowy": hasStructure
        ? "One structured anchor — a blazer, a waistcoat, a belt — is enough. The fluid elements take care of themselves."
        : "Choose pieces with enough drape to move rather than those that merely sit.",
      "structured": hasFluid
        ? "Use one fluid counterpart to the structured piece. Rigid structure throughout reads as uniform — one fluid element makes it considered."
        : "The structure is already in the vocabulary of this direction. Choose the most precisely cut version of what you already own.",
      "oversized": hasProportion
        ? "The proportion direction here is deliberate — one oversized piece and keep everything else close. Two oversized pieces compete."
        : "Oversized works best when the other elements are specific. One considered layer; one clear counterpart.",
    };

    const instruction = map[bestFitId];
    if (instruction) return instruction;
  }

  // No meaningful tension found — use trend-specific editorial direction instead.
  const howTo = (report.howToWear ?? [])[0];
  if (howTo) return howTo.direction;
  const primaryTrend = report.keyTrends[0];
  return primaryTrend
    ? `Apply ${primaryTrend.name} through one piece — keep the rest of the look familiar.`
    : "Wear one piece from this direction against your most familiar wardrobe anchor.";
}

// ---------------------------------------------------------------------------
// Helper: outfit note for a matched closet item
// ---------------------------------------------------------------------------

function buildClosetItemNote(
  item: ShopperClosetItemEvidence,
  pairName: string | null,
): string {
  if (pairName) {
    const paired: Partial<Record<string, string>> = {
      OUTERWEAR: `Layer it over ${pairName} for the proportion story this direction is built on.`,
      BOTTOMS: `Wear it with ${pairName} for the separates formula this report points to.`,
      TOPS: `Pair with ${pairName} for the season's separates approach.`,
    };
    return paired[item.category] ?? `Pairs with ${pairName} for the look this direction points to.`;
  }

  const solo: Partial<Record<string, string>> = {
    OUTERWEAR: "Wear it open over something simple. The proportion does the work.",
    BOTTOMS: "The silhouette anchor. Keep the top quiet and let the cut speak.",
    DRESSES: "One piece covers the whole direction. Add one structured layer if the occasion needs it.",
    TOPS: "Works best against a more structured or tailored bottom.",
    BAGS: "Reinforces the direction at the accessory level — no new pieces needed.",
    SHOES: "Grounds the look at the ankle. A clean silhouette here does the most.",
    ACCESSORIES: "One way into this direction without committing to new pieces.",
  };

  return solo[item.category] ?? "A natural starting point for this direction.";
}

// ---------------------------------------------------------------------------
// Helper: identify a missing anchor piece — explicit slug-keyed rules only.
// No prose string matching: each rule names an exact anchor category, the
// Closet roles that must already be present for the addition to be usable,
// and pre-authored suggestion copy. Colour Direction is absent because no
// garment-category recommendation is defensible without a clear neutral-base
// gap in the shopper's actual data.
// ---------------------------------------------------------------------------

type ReportAnchorRule = {
  anchorCategory: string;
  requiresCategories: string[];  // all must be present in closet
  suggestion: string;
};

const REPORT_ANCHOR_RULES: Partial<Record<string, ReportAnchorRule[]>> = {
  "spring-2026-soft-structure": [
    {
      anchorCategory: "OUTERWEAR",
      requiresCategories: ["TOPS", "BOTTOMS"],
      suggestion:
        "A longline blazer or structured vest — the one piece that completes the softened separates formula and layers directly over what you already own.",
    },
  ],
  "modern-tailoring-spring-2026": [
    {
      anchorCategory: "OUTERWEAR",
      requiresCategories: ["BOTTOMS"],
      suggestion:
        "A structured jacket or longline blazer — the tailored anchor that makes the one-structured-piece separates formula in this report work.",
    },
    {
      anchorCategory: "BOTTOMS",
      requiresCategories: ["OUTERWEAR"],
      suggestion:
        "A tailored wide-leg trouser — the counterpart that makes your existing outerwear directional for this report's separates approach.",
    },
  ],
};

function buildOneUnlockPiece(
  closetItems: ShopperClosetItemEvidence[],
  profile: ShopperProfileEvidence | null,
  reportSlug: string,
): string | null {
  const rules = REPORT_ANCHOR_RULES[reportSlug];
  if (!rules) return null;

  const existingCategories = new Set(closetItems.map((i) => i.category));

  const lifestyleIds = profile
    ? (profile.lifestyle ?? "").split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  const workContextLifestyles = new Set(["office", "hybrid", "events", "on-the-go", "travel"]);
  const structuredPersonalities = new Set([
    "old-money", "corporate-chic", "minimal", "effortlessly-chic", "artsy",
  ]);

  for (const rule of rules) {
    if (existingCategories.has(rule.anchorCategory)) continue;
    const hasAllRequired = rule.requiresCategories.every((c) => existingCategories.has(c));
    if (!hasAllRequired) continue;

    // OUTERWEAR recommendation requires lifestyle or personality compatibility —
    // a blazer recommendation is not useful for all-casual wardrobes.
    if (rule.anchorCategory === "OUTERWEAR" && profile) {
      const hasCompatible =
        lifestyleIds.some((l) => workContextLifestyles.has(l)) ||
        profile.stylePersonalities.some((p) => structuredPersonalities.has(p));
      if (!hasCompatible) continue;
    }

    return rule.suggestion;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export type ClosetMatchItem = {
  name: string;
  imageUrl: string | null;
  category: string;
  outfitNote: string;
};

export type ShopperEdit = {
  personalReading: string;
  strongestMatch: string;
  adaptDontCopy: string;
  lessUseful: string | null;
  fromCloset: ClosetMatchItem[];
  fromClosetFormula: string | null;
  oneLookToTry: string;
  oneUnlockPiece: string | null;
  contributedEvidence: string[];
};

// ---------------------------------------------------------------------------
// buildShopperEdit — deterministic, no AI calls. Every output sentence is
// grounded in either (a) text already present in `report`, or (b) values the
// customer themselves provided via Passport/Closet. Nothing is invented.
// ---------------------------------------------------------------------------

export function buildShopperEdit(
  report: TrendReportData,
  evidence: ShopperEvidenceBundle,
): ShopperEdit {
  const profile = evidence.profile;
  const positiveText = buildPositiveReportText(report);
  const keyDirectionsText = buildKeyDirectionsText(report);
  const closetMatchText = buildClosetMatchText(report);

  let profileContributed = false;
  let closetContributed = false;
  let reviewsContributed = false;

  // -------------------------------------------------------------------------
  // Step 1: Score closet items against report vocabulary
  // -------------------------------------------------------------------------
  type ScoredItem = { item: ShopperClosetItemEvidence; term: string; score: number };
  const scored: ScoredItem[] = [];

  for (const item of evidence.closetItems) {
    const itemTerms = [
      item.subcategory,
      item.primaryColor,
      item.material,
      ...item.styleTags,
      ...item.occasions,
      ...(CLOSET_CATEGORY_MAP[item.category]?.terms ?? []),
    ].filter((t): t is string => Boolean(t));

    const hits = matchedTerms(closetMatchText, itemTerms);
    if (hits.length === 0) continue;

    let score = hits.length;
    if (item.name) score += 3;
    if (item.imageUrl) score += 1;
    scored.push({ item, term: hits[0], score });
  }

  scored.sort((a, b) => b.score - a.score);
  const namedMatches = scored.filter((m) => m.item.name).slice(0, 2);
  const matchedCategories = new Set(scored.map((m) => m.item.category));

  // -------------------------------------------------------------------------
  // Step 2: Personality and aspiration signal hits
  // -------------------------------------------------------------------------
  const allPersonalityHits = profile
    ? translateAllHits(
        profile.stylePersonalities,
        PERSONALITY_STYLE_MAP,
        positiveText,
        new Set(),
      )
    : [];
  const topPersonalityHit = allPersonalityHits[0] ?? null;

  const aspirationIds = profile
    ? [
        ...profile.desiredImpression,
        ...profile.desiredFeelings,
        ...profile.becoming,
      ]
    : [];
  const topAspirationHit = profile
    ? (translateAllHits(aspirationIds, ASPIRATION_STYLE_MAP, positiveText, new Set())[0] ?? null)
    : null;

  // -------------------------------------------------------------------------
  // Step 3: personalReading — one editorial paragraph
  // -------------------------------------------------------------------------
  let personalReading: string;
  if (!profile) {
    personalReading =
      report.naiaInterpretation ??
      "Complete your Passport to unlock a personal reading of this direction.";
  } else {
    const parts: string[] = [];

    if (topPersonalityHit) {
      const openerKey = profile.stylePersonalities.find(
        (id) => PERSONALITY_STYLE_MAP[id]?.terms.includes(topPersonalityHit.term),
      );
      const opener =
        PERSONALITY_READING_OPENERS[openerKey ?? ""] ??
        `This direction is relevant to a ${topPersonalityHit.label.toLowerCase()} wardrobe`;
      parts.push(`${opener}.`);
      profileContributed = true;
    } else {
      parts.push("This direction is worth reading closely on its own terms.");
    }

    // Aspiration layer — add if it introduces a distinct concept
    const aspirationMatchId = aspirationIds.find((id) => {
      const entry = ASPIRATION_STYLE_MAP[id];
      if (!entry) return false;
      return matchedTerms(positiveText, entry.terms).length > 0;
    });
    if (
      aspirationMatchId &&
      topAspirationHit &&
      topAspirationHit.term !== topPersonalityHit?.term
    ) {
      const enablePhrase = ASPIRATION_ENABLE_PHRASES[aspirationMatchId];
      if (enablePhrase) {
        parts.push(`${enablePhrase}.`);
        profileContributed = true;
      }
    }

    // Close with closet signal
    if (namedMatches.length > 0) {
      parts.push("Your Closet already has a starting point — see the section below.");
      closetContributed = true;
    } else if (matchedCategories.size > 0) {
      parts.push("There is a starting point in your Closet — the section below makes it specific.");
      closetContributed = true;
    } else if (report.investmentNotes) {
      const firstSentence = report.investmentNotes.split(".")[0].trim();
      const lowered = firstSentence.slice(0, 1).toLowerCase() + firstSentence.slice(1);
      parts.push(`The first move: ${lowered}.`);
    }

    personalReading = parts.join(" ");
  }

  // -------------------------------------------------------------------------
  // Step 4: strongestMatch
  // -------------------------------------------------------------------------
  let strongestMatch: string;
  if (!profile) {
    const t = report.keyTrends[0];
    strongestMatch = t
      ? `${t.name} is the central direction in this report. ${t.description}`
      : "Read the full report to identify the strongest direction for your wardrobe.";
  } else {
    const profileTerms = [
      ...profile.stylePersonalities.flatMap(
        (id) => PERSONALITY_STYLE_MAP[id]?.terms ?? [],
      ),
      ...profile.desiredImpression.flatMap(
        (id) => ASPIRATION_STYLE_MAP[id]?.terms ?? [],
      ),
      ...profile.desiredFeelings.flatMap(
        (id) => ASPIRATION_STYLE_MAP[id]?.terms ?? [],
      ),
      ...profile.becoming.flatMap(
        (id) => ASPIRATION_STYLE_MAP[id]?.terms ?? [],
      ),
    ];

    let bestTrend = report.keyTrends[0];
    let bestScore = -1;
    for (const trend of report.keyTrends) {
      const score = matchedTerms(
        `${trend.name} ${trend.description}`,
        profileTerms,
      ).length;
      if (score > bestScore) {
        bestScore = score;
        bestTrend = trend;
      }
    }

    const lifestyleIds = (profile.lifestyle ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    let concreteStyling: string | null = null;
    for (const lid of lifestyleIds) {
      const priority = LIFESTYLE_HOWTO_MAP[lid];
      if (!priority) continue;
      const match = (report.howToWear ?? []).find((h) => priority.includes(h.feeling));
      if (match) {
        concreteStyling = match.direction;
        break;
      }
    }
    if (!concreteStyling) {
      concreteStyling =
        (report.howToWear ?? [])[0]?.direction ??
        (report.investmentNotes?.split(".")[0]?.trim() ?? null);
    }

    strongestMatch = bestTrend
      ? `${bestTrend.name} is your strongest entry point here. ${concreteStyling ?? bestTrend.description}`
      : "Complete your Passport for a more specific read on this report.";
    profileContributed = true;
  }

  // -------------------------------------------------------------------------
  // Step 5: adaptDontCopy
  // -------------------------------------------------------------------------
  let adaptDontCopy: string;
  if (profile && profile.fitPreferences.length > 0) {
    adaptDontCopy = buildAdaptInstruction(
      profile.fitPreferences,
      report,
      keyDirectionsText,
    );
    profileContributed = true;
  } else {
    const howTo = (report.howToWear ?? [])[0];
    adaptDontCopy =
      howTo?.direction ??
      "Wear one piece from this direction against your most familiar wardrobe anchor.";
  }

  // -------------------------------------------------------------------------
  // Step 6: lessUseful — conditional on review evidence or fit conflict
  // -------------------------------------------------------------------------
  let lessUseful: string | null = null;

  if (
    evidence.reviewSignal.reviewCount >= 3 &&
    evidence.reviewSignal.didntWorkTags.length > 0
  ) {
    for (const trend of report.keyTrends) {
      const hits = matchedTerms(
        `${trend.name} ${trend.description}`,
        evidence.reviewSignal.didntWorkTags,
      );
      if (hits.length > 0) {
        const altTrend = report.keyTrends.find((t) => t !== trend);
        const alternative = altTrend
          ? `${altTrend.name} is a more workable entry point.`
          : (report.howToWear ?? [])[0]?.direction ??
            "Look for a version of this direction with more ease.";
        lessUseful = `${trend.name} with ${hits[0]} is less useful based on what you know does not work. ${alternative}`;
        reviewsContributed = true;
        break;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Step 7: fromCloset
  // -------------------------------------------------------------------------
  const fromCloset: ClosetMatchItem[] = [];

  for (let i = 0; i < namedMatches.length; i++) {
    const { item } = namedMatches[i];
    const pairName =
      i === 0 && namedMatches.length >= 2 ? namedMatches[1].item.name! : null;

    fromCloset.push({
      name: item.name!,
      imageUrl: item.imageUrl,
      category: item.category,
      outfitNote: buildClosetItemNote(item, pairName),
    });
    closetContributed = true;
  }

  let fromClosetFormula: string | null = null;
  if (fromCloset.length === 0) {
    const seen = new Set<string>();
    for (const item of evidence.closetItems) {
      if (seen.has(item.category)) continue;
      seen.add(item.category);
      const entry = CLOSET_CATEGORY_MAP[item.category];
      if (!entry || entry.terms.length === 0) continue;
      const hits = matchedTerms(closetMatchText, entry.terms);
      if (hits.length > 0) {
        fromClosetFormula = `Your ${entry.label} is the formula starting point — the ${hits[0]} direction in this report is where that category does its work. Name a specific piece in your Closet to get a sharper read.`;
        closetContributed = true;
        break;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Step 8: oneLookToTry
  // -------------------------------------------------------------------------
  const lifestyleIds = profile
    ? (profile.lifestyle ?? "").split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  let oneLookToTry: string;
  if (fromCloset.length >= 2) {
    const a = fromCloset[0].name;
    const b = fromCloset[1].name;
    const finish =
      (report.howToWear ?? [])[0]?.direction ?? "Keep the rest of the look quiet.";
    oneLookToTry = `${a} + ${b}. ${finish}`;
  } else if (fromCloset.length === 1) {
    const a = fromCloset[0].name;
    let contextDirection: string | null = null;
    for (const lid of lifestyleIds) {
      const priority = LIFESTYLE_HOWTO_MAP[lid];
      if (!priority) continue;
      const match = (report.howToWear ?? []).find((h) => priority.includes(h.feeling));
      if (match) {
        contextDirection = match.direction;
        break;
      }
    }
    oneLookToTry = `${a} as the anchor. ${
      contextDirection ??
      (report.howToWear ?? [])[0]?.direction ??
      "Build the rest of the look around it."
    }`;
  } else {
    let contextDirection: string | null = null;
    for (const lid of lifestyleIds) {
      const priority = LIFESTYLE_HOWTO_MAP[lid];
      if (!priority) continue;
      const match = (report.howToWear ?? []).find((h) => priority.includes(h.feeling));
      if (match) {
        contextDirection = `${match.feeling}: ${match.direction}`;
        break;
      }
    }
    oneLookToTry =
      contextDirection ??
      (report.howToWear ?? [])[0]?.direction ??
      report.investmentNotes ??
      "Add items to your Closet to get a specific look instruction here.";
  }

  // -------------------------------------------------------------------------
  // Step 9: oneUnlockPiece — conditional on missing anchor category
  // -------------------------------------------------------------------------
  const oneUnlockPiece = buildOneUnlockPiece(evidence.closetItems, profile, report.slug);

  // -------------------------------------------------------------------------
  // Step 10: contributedEvidence
  // -------------------------------------------------------------------------
  const contributedEvidence: string[] = [];
  if (profileContributed) contributedEvidence.push("your Passport");
  if (closetContributed) contributedEvidence.push("your Closet");
  if (reviewsContributed) {
    const n = evidence.reviewSignal.reviewCount;
    contributedEvidence.push(`${n} rated look${n === 1 ? "" : "s"}`);
  }

  return {
    personalReading,
    strongestMatch,
    adaptDontCopy,
    lessUseful,
    fromCloset,
    fromClosetFormula,
    oneLookToTry,
    oneUnlockPiece,
    contributedEvidence,
  };
}
