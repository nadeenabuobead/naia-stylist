import prisma from "../db.server";
import type { TrendReportData } from "./trend-reports";
import { buildPrivateDownloadUrl, getCloudinaryConfig } from "./cloudinary-admin.server";
import { scoreItemAttributes, dimensionIdsForSlug } from "./trend-evidence-attribute-scoring.server";
import { resolveItemImage } from "./styleme/look-image-resolution.server";
// Used by buildColorMaterialSuffix (Colour Direction's neutral/accent copy
// boundary) — the same canonical resolver scoreItemAttributes uses, so a
// garment's role is decided identically everywhere in this file.
import { resolveFreeTextColourFamilies } from "./ai/colour-family";

// ---------------------------------------------------------------------------
// Evidence bundle — assembled server-side, scoped to exactly one customer,
// fetched with `select` (never `include`) so only fields this feature
// actually reads ever leave the database. savedLooks removed in Phase C.
// ---------------------------------------------------------------------------

export type ShopperProfileEvidence = {
  stylePersonalities: string[];
  favoriteColors: string[];
  avoidColors: string[];
  lifestyle: string[] | null;
  desiredFeeling: string | null;
  desiredFeelings: string[];
  desiredImpression: string[];
  fitPreferences: string[];
  becoming: string[];
  styleSupport: string[];
};

export type ShopperClosetItemEvidence = {
  // Optional — absent in pre-existing test fixtures across this file's other
  // suites. Only used to re-resolve a fresh image at read time
  // (hydrateShopperEditImages); every scoring/selection rule below already
  // ignores it entirely.
  id?: string;
  name: string | null;
  imageUrl: string | null;
  category: string;
  subcategory: string | null;
  primaryColor: string | null;
  styleTags: string[];
  occasions: string[];
  material: string | null;
  // Garment Intelligence — already on ClosetItem (migration 20260828000000),
  // null/absent for items not yet analyzed (and for older test fixtures that
  // predate this field set). Trend-specific scoring treats missing/null as
  // "no signal from this field", never as a negative — optional so every
  // pre-existing fixture across this file's other tests stays valid.
  silhouette?: string | null;
  fitProfile?: string | null;
  formality?: string | null;
  pattern?: string | null;
  colors?: string[];
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
  reviewSignal: ShopperReviewSignal;
};

const EMPTY_BUNDLE: ShopperEvidenceBundle = {
  hasProfile: false,
  profile: null,
  closetItems: [],
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
          styleDirections: true,
          favoriteColors: true,
          lifestyle: true,
          desiredFeeling: true,
          desiredFeelings: true,
          desiredImpression: true,
          fitPreferences: true,
          becoming: true,
          avoidColors: true,
          completed: true,
        },
      },
      closetItems: {
        // Was take: 20 — silently capped Trend Edit evidence to the 20 most
        // recently added items, regardless of Closet size. Confirmed via
        // live staging diagnostic: a real 47-item Closet had 27 pieces
        // (including the only two non-neutral items found anywhere in the
        // fetched window) structurally invisible to every report. 250
        // matches the plan's own Closet size cap — every owned piece a
        // customer can actually have is now considered. All selected
        // fields remain scalar-only (no relations, no blobs) — this is not
        // a heavier query, just a correct one.
        take: 250,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          name: true,
          imageUrl: true,
          imagePublicId: true,
          imageFormat: true,
          category: true,
          subcategory: true,
          primaryColor: true,
          styleTags: true,
          occasions: true,
          material: true,
          silhouette: true,
          fitProfile: true,
          formality: true,
          pattern: true,
          colors: true,
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

  const cloudinaryCfg = getCloudinaryConfig();

  return {
    hasProfile,
    profile: hasProfile && profile ? {
      // Rev 7 customers answer styleDirections; the register resolver accepts both
      // vocabularies, so the answer the customer actually gave is what is passed.
      stylePersonalities: profile.styleDirections?.length
        ? profile.styleDirections
        : (profile.stylePersonalities ?? []),
      favoriteColors: profile.favoriteColors ?? [],
      avoidColors: profile.avoidColors ?? [],
      lifestyle: profile.lifestyle?.length ? profile.lifestyle : null,
      desiredFeeling: profile.desiredFeeling ?? null,
      desiredFeelings: profile.desiredFeelings ?? [],
      desiredImpression: profile.desiredImpression ?? [],
      fitPreferences: profile.fitPreferences ?? [],
      becoming: profile.becoming ?? [],
    } : null,
    closetItems: customer.closetItems.map((item) => ({
      id: item.id,
      name: item.name,
      imageUrl: item.imageUrl
        ?? (item.imagePublicId && item.imageFormat && cloudinaryCfg
            ? buildPrivateDownloadUrl(cloudinaryCfg, item.imagePublicId, item.imageFormat, "private")
            : null),
      category: item.category,
      subcategory: item.subcategory ?? null,
      primaryColor: item.primaryColor ?? null,
      styleTags: item.styleTags ?? [],
      occasions: item.occasions ?? [],
      material: item.material ?? null,
      silhouette: item.silhouette ?? null,
      fitProfile: item.fitProfile ?? null,
      formality: item.formality ?? null,
      pattern: item.pattern ?? null,
      colors: item.colors ?? [],
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

// `becoming` stores ids like "more-confident"; lookup maps use the normalised key.
function normalizeBecomingId(id: string): string {
  return id.startsWith("more-") ? id.slice(5) : id;
}

const NAME_STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "in", "on", "at", "for",
  "with", "by", "of", "my", "your", "our",
]);

// Tokenise a garment name into searchable terms, excluding stop words and
// single/double-character fragments.
function extractNameTerms(name: string | null): string[] {
  if (!name) return [];
  return name
    .toLowerCase()
    .split(/[\s\-_/]+/)
    .filter((w) => w.length > 2 && !NAME_STOP_WORDS.has(w));
}

// Generic category words that appear in report text but prove nothing about
// whether a specific garment is relevant to a trend direction. These are
// excluded from the qualification signal. They may still be used for
// category routing but cannot be the sole reason an item qualifies.
const GENERIC_NAME_TERMS = new Set([
  "top", "shirt", "tee", "blouse",
  "bottom", "trouser", "trousers", "pants", "jeans", "skirt", "dress",
  "jacket", "blazer", "coat",
  "bag", "shoe", "shoes", "boot", "boots", "heel", "heels", "flat", "flats",
  "accessory",
]);

// ---------------------------------------------------------------------------
// Style register — determined by plurality of selected personality IDs
// across clusters. Tie → neutral. Never exposes raw personality labels.
// ---------------------------------------------------------------------------

type StyleRegister = "clean-polished" | "fluid-ease" | "expressive" | "neutral";

// Covers every style vocabulary the app has shipped. Before this fix only the V2
// IDs were listed, so every Rev 6 and Rev 7 customer resolved to "neutral" and the
// style register silently stopped working for them.
const REGISTER_CLUSTER_IDS: Record<Exclude<StyleRegister, "neutral">, string[]> = {
  "clean-polished": [
    // V2
    "old-money", "corporate-chic", "minimal", "effortlessly-chic",
    // V3 archetypes (Rev 6)
    "classic-polished", "minimal-relaxed",
    // Rev 7 directions
    "polished-refined", "clean-minimal",
  ],
  "fluid-ease": [
    // V2
    "romantic", "casual-cool", "feminine",
    // V3 archetypes (Rev 6)
    "feminine-romantic",
    // Rev 7 directions
    "soft-romantic", "relaxed-easy",
  ],
  "expressive": [
    // V2
    "artsy", "edgy", "trendy",
    // V3 archetypes (Rev 6)
    "bold-edgy", "creative-expressive",
    // Rev 7 directions
    "bold-statement", "creative-individual", "street-contemporary",
  ],
};

// sporty-functional is intentionally absent from every cluster: it is a
// functional register, not one of the three aesthetic ones. It contributes no
// vote rather than being forced into the nearest cluster.
function resolveStyleRegister(stylePersonalities: string[]): StyleRegister {
  const counts: Record<string, number> = {
    "clean-polished": 0,
    "fluid-ease": 0,
    "expressive": 0,
  };
  for (const id of stylePersonalities) {
    for (const [register, ids] of Object.entries(REGISTER_CLUSTER_IDS)) {
      if (ids.includes(id)) counts[register]++;
    }
  }
  const max = Math.max(...Object.values(counts));
  if (max === 0) return "neutral";
  const winners = Object.entries(counts).filter(([, v]) => v === max);
  if (winners.length > 1) return "neutral"; // tie
  return winners[0][0] as StyleRegister;
}

// ---------------------------------------------------------------------------
// Work/lifestyle context resolver — three-way label, computed once per request
// ---------------------------------------------------------------------------

type WorkContextLabel = "work-meetings" | "events" | "work-meetings-events" | "none";

// Covers every lifestyle vocabulary the app has shipped. Before this fix only the
// V2 IDs were checked, so this returned "none" for every Rev 6 and Rev 7 customer.
const WORK_LIFESTYLE_IDS = new Set([
  // V2
  "office", "hybrid",
  // V3 (Rev 6) + Rev 7
  "work-office", "creative-flexible-work",
]);
// "events" in V2 mapped to dinner / date-night / girls-night occasions, which is
// exactly what dinners-going-out covers; events-special-occasions is the direct
// V3 analogue of the V2 "events" ID.
const EVENT_LIFESTYLE_IDS = new Set([
  // V2
  "events",
  // V3 (Rev 6) + Rev 7
  "events-special-occasions", "dinners-going-out",
]);

function resolveWorkContext(lifestyleIds: string[]): WorkContextLabel {
  const hasOffice = lifestyleIds.some((l) => WORK_LIFESTYLE_IDS.has(l));
  const hasEvents = lifestyleIds.some((l) => EVENT_LIFESTYLE_IDS.has(l));
  if (hasOffice && hasEvents) return "work-meetings-events";
  if (hasOffice) return "work-meetings";
  if (hasEvents) return "events";
  return "none";
}

// ---------------------------------------------------------------------------
// Style translation maps (retained for future aspiration-signal use)
// ---------------------------------------------------------------------------

// Keys: favorite-colors option ids.
const COLOR_SEARCH_MAP: Record<string, { label: string; terms: string[] }> = {
  "black":        { label: "Black",           terms: ["black"] },
  "white-cream":  { label: "White / Cream",   terms: ["white", "cream"] },
  "beige-brown":  { label: "Beige / Brown",   terms: ["beige", "brown"] },
  "grey":         { label: "Grey",            terms: ["grey", "gray"] },
  "navy":         { label: "Navy",            terms: ["navy"] },
  "red-burgundy": { label: "Red / Burgundy",  terms: ["red", "burgundy"] },
  "green":        { label: "Green",           terms: ["green"] },
  "pink":         { label: "Pink",            terms: ["pink"] },
  "prints":       { label: "Prints",          terms: ["print", "prints"] },
  "colorful":     { label: "Colorful Pieces", terms: ["colour", "color", "colourful", "colorful"] },
};

// Keys: the union of desired-impression, desired-feelings, and becoming ids.
const ASPIRATION_STYLE_MAP: Record<string, { label: string; terms: string[] }> = {
  "refined":        { label: "refined",          terms: ["tailoring", "tailored", "clean", "restrained", "structured", "architectural"] },
  "creative":       { label: "creative",          terms: ["sculptural", "asymmetric", "drape", "gesture", "architectural"] },
  "powerful":       { label: "powerful",          terms: ["structured", "defined", "trouser", "blazer", "presence"] },
  "soft-confident": { label: "soft but confident",terms: ["fluid", "soft", "clean", "structured", "polished", "confident"] },
  "effortless":     { label: "effortless",        terms: ["ease", "fluid", "familiar", "quiet", "clean"] },
  "interesting":    { label: "interesting",       terms: ["sculptural", "asymmetric", "gesture", "architectural", "drape"] },
  "put-together":   { label: "put together",      terms: ["tailoring", "tailored", "structured", "clean", "polished", "blazer"] },
  "confident":      { label: "confident",         terms: ["structured", "defined", "trouser", "blazer", "presence"] },
  "comfortable":    { label: "comfortable",       terms: ["ease", "fluid", "familiar", "relaxed"] },
  "elegant":        { label: "elegant",           terms: ["fluid", "draped", "column", "restrained", "polished"] },
  "attractive":     { label: "attractive",        terms: ["polished", "feminine", "confident", "clean"] },
  "feminine":       { label: "feminine",          terms: ["fluid", "draped", "midi", "column", "feminine", "soft"] },
};
// Retained for future aspiration-signal use.
void ASPIRATION_STYLE_MAP;

const ASPIRATION_ENABLE_PHRASES: Record<string, string> = {
  "refined":        "Composure is created without trying too hard — restraint is the whole method",
  "creative":       "There is room for one unexpected element to carry the interest",
  "powerful":       "Presence comes from proportion and weight, not volume or decoration",
  "soft-confident": "Clear structure and softness are not in conflict here",
  "effortless":     "A considered look is achievable without reading as dressed-up",
  "interesting":    "Architectural interest comes through silhouette rather than colour or print",
  "put-together":   "This is the most reliable route to a finished, considered look without statement pieces",
  "confident":      "Presence is built into the proportions — nothing needs to compete for attention",
  "comfortable":    "Ease is already built into the silhouette, so comfort does not need to be negotiated",
  "elegant":        "Restraint is where this direction earns its keep",
  "attractive":     "A polished silhouette carries more than most individual pieces can",
  "feminine":       "Softness and structure are not in conflict in this direction",
};
// Retained for future aspiration-signal use.
void ASPIRATION_ENABLE_PHRASES;

// Keys: the ClosetCategory enum. NOT used in candidateTerms for named-card
// scoring — only for buildClosetMatchText corpus construction.
const CLOSET_CATEGORY_MAP: Record<string, { label: string; terms: string[] }> = {
  TOPS:        { label: "tops",         terms: ["top", "knit", "shirt", "jersey"] },
  BOTTOMS:     { label: "bottoms",      terms: ["trouser", "skirt", "denim"] },
  DRESSES:     { label: "dresses",      terms: ["dress", "midi", "column", "slip"] },
  OUTERWEAR:   { label: "outerwear",    terms: ["blazer", "jacket", "layer", "longline", "vest"] },
  SHOES:       { label: "shoes",        terms: ["shoe"] },
  BAGS:        { label: "bags",         terms: ["bag"] },
  ACCESSORIES: { label: "accessories",  terms: ["scarf", "accessories", "accessory"] },
  JEWELRY:     { label: "jewelry",      terms: [] },
  ACTIVEWEAR:  { label: "activewear",   terms: [] },
  SWIMWEAR:    { label: "swimwear",     terms: [] },
  LOUNGEWEAR:  { label: "loungewear",   terms: [] },
  OTHER:       { label: "other pieces", terms: [] },
};
// Retained for buildClosetMatchText and potential formula-text use.
void CLOSET_CATEGORY_MAP;

// Subcategory terms that indicate an OUTERWEAR-class garment stored under TOPS in the DB.
// Used to override the effective category for narrative and coverage logic without relying
// on item names (which are user-supplied strings, not classification fields).
const OUTERWEAR_SUBCATEGORY_TERMS = new Set([
  "blazer", "jacket", "coat", "vest", "waistcoat", "trench", "longline",
]);

// Returns the category that should drive narrative and coverage logic for this item.
// Corrects for DB misclassification: a TOPS item whose subcategory is an outerwear term
// (e.g. "blazer") is an outerwear-class garment and should be treated as the tailored
// anchor in Modern Tailoring rather than the softer counterpart.
function getEffectiveCategory(item: ShopperClosetItemEvidence, slug: string): string {
  if (
    slug === "modern-tailoring-spring-2026" &&
    item.category === "TOPS" &&
    item.subcategory &&
    OUTERWEAR_SUBCATEGORY_TERMS.has(item.subcategory.toLowerCase())
  ) {
    return "OUTERWEAR";
  }
  return item.category;
}

// Keys: lifestyle option ids. Values: ordered priority of howToWear[].feeling labels.
const LIFESTYLE_HOWTO_MAP: Record<string, string[]> = {
  "office":      ["For work",        "For everyday"],
  "hybrid":      ["For work",        "For everyday"],
  "busy-mom":    ["For everyday",    "For casual days"],
  "casual-days": ["For casual days", "For everyday"],
  "events":      ["For dinner",      "For work"],
  "on-the-go":   ["For everyday",    "For travel"],
  "travel":      ["For travel",      "For everyday"],
  "creative":    ["For everyday",    "For casual days"],
};

// Vocab terms signalling tension between a fit preference and report directions.
// Retained for future adapt-instruction use.
const FIT_TENSION_VOCAB: Partial<Record<string, string[]>> = {
  "fitted":       ["fluid", "drape", "ease"],
  "relaxed-fits": ["structured", "tailored", "architectural"],
  "flowy":        ["structured", "tailored", "architectural"],
  "structured":   ["fluid", "drape", "ease"],
  "oversized":    ["restrained", "clean", "defined"],
};
void FIT_TENSION_VOCAB;

// ---------------------------------------------------------------------------
// Report text corpus for closet matching.
// Excludes naiaInterpretation and investmentNotes — those fields contain
// editorial caution copy, not the silhouette/colour/category vocabulary
// that a garment's own metadata would plausibly share.
// ---------------------------------------------------------------------------

function buildClosetMatchText(report: TrendReportData): string {
  return [
    ...report.keyTrends.map((t) => `${t.name} ${t.description}`),
    ...(report.howToWear ?? []).map((h) => h.direction),
    report.wardrobeNote ?? "",
  ].join(" ");
}

// ---------------------------------------------------------------------------
// Colour evidence — gates colour-specific claims in colour-direction
// ---------------------------------------------------------------------------

type ColourEvidence = { found: boolean; label: string | null };

// avoidColors always wins over favoriteColors. If an id appears in both lists,
// or if a closet item's primaryColor maps to an avoided color id, the signal is blocked.
function buildColourEvidence(
  profile: ShopperProfileEvidence | null,
  closetItems: ShopperClosetItemEvidence[],
  closetMatchText: string,
): ColourEvidence {
  // Path 1: favorite colors vs closetMatchText — skip any id also in avoidColors
  if (profile) {
    const avoidSet = new Set(profile.avoidColors);
    for (const colorId of profile.favoriteColors) {
      if (avoidSet.has(colorId)) continue; // conflict — avoidColors wins
      const entry = COLOR_SEARCH_MAP[colorId];
      if (!entry) continue;
      if (matchedTerms(closetMatchText, entry.terms).length > 0) {
        return { found: true, label: entry.label };
      }
    }
  }
  // Path 2: closet item primaryColor vs closetMatchText — skip if it maps to any avoided id
  for (const item of closetItems) {
    if (!item.primaryColor) continue;
    const isAvoided = (profile?.avoidColors ?? []).some((avoidId) => {
      const avoidEntry = COLOR_SEARCH_MAP[avoidId];
      if (avoidEntry) return avoidEntry.terms.some((t) => t === item.primaryColor!.toLowerCase());
      return avoidId.toLowerCase() === item.primaryColor!.toLowerCase();
    });
    if (isAvoided) continue;
    if (matchedTerms(closetMatchText, [item.primaryColor]).length > 0) {
      return { found: true, label: item.primaryColor };
    }
  }
  return { found: false, label: null };
}

// ---------------------------------------------------------------------------
// Named closet card gates
// ---------------------------------------------------------------------------

// Categories whose garments can plausibly carry this report's key vocabulary.
const SLUG_COMPATIBLE_CATEGORIES: Record<string, Set<string>> = {
  "spring-2026-soft-structure":   new Set(["TOPS", "BOTTOMS", "OUTERWEAR", "DRESSES"]),
  "modern-tailoring-spring-2026": new Set(["TOPS", "BOTTOMS", "OUTERWEAR", "DRESSES"]),
  // BOTTOMS/DRESSES/OUTERWEAR included so real colour evidence in those
  // categories can compete — excluding them meant a bag or a pair of shoes
  // could win as "best colour evidence" purely because nothing with
  // stronger colour evidence was ever allowed to be considered.
  "spring-2026-colour-direction": new Set(["TOPS", "BOTTOMS", "DRESSES", "OUTERWEAR", "BAGS", "SHOES", "ACCESSORIES"]),
};

// Subcategory values (lowercased) that disqualify an otherwise-compatible item.
const TAILORING_SUBCATEGORY_EXCLUDE = new Set([
  "shorts", "mini", "crop", "cami", "bikini", "activewear", "swimwear", "loungewear",
]);

const SUBCATEGORY_EXCLUDE: Record<string, Set<string>> = {
  "spring-2026-soft-structure":   TAILORING_SUBCATEGORY_EXCLUDE,
  "modern-tailoring-spring-2026": TAILORING_SUBCATEGORY_EXCLUDE,
  "spring-2026-colour-direction": new Set(),
};

// ---------------------------------------------------------------------------
// Per-slug editorial rules
// ---------------------------------------------------------------------------

type LeaveOutCandidate = { text: string; vocab: string[] };

type PersonalEditRules = {
  // 1. YOUR VERSION — person-specific, evidence-led, 1–2 sentences
  yourVersionPassport: Record<StyleRegister, string>;
  // 2. YOUR STYLE DNA SAYS — absorbs WHY IT FITS; base is 1 sentence + 1 supplement
  styleDnaSays: Record<StyleRegister, string>;
  // 3. YOUR BEST ROUTE IN — Passport-only path (with-item path built in code)
  yourBestRouteIn: Record<StyleRegister, string>;
  // 4. THE BALANCE TO PROTECT — one practical guardrail, Passport-led
  theBalanceToProtect: Record<StyleRegister, string>;
  // 5. THE PART TO TAKE — exactly 2 bullets
  partToTake: string[];
  partToTakeNeutralColour?: string[];
  // Colour-matched first bullet: when colourEvidence.label matches a term, swap bullet 1
  partToTakeColourHints?: Array<{ terms: string[]; bullet: string }>;
  // 6. THE PART TO LEAVE — candidates; top 2 shown, reviews may reorder
  leaveOutCandidates: LeaveOutCandidate[];
  // 7. A LOOK TO TRY — Passport-only fallback
  lookToTryPassportOnly: string;
};

const PERSONAL_EDIT_RULES: Record<string, PersonalEditRules> = {
  "spring-2026-soft-structure": {
    yourVersionPassport: {
      "clean-polished":
        "Soft Structure gives your style a clearer way to create presence without making the outfit feel formal or overworked.",
      "fluid-ease":
        "Soft Structure gives you a way to add shape to a look without losing the ease that already works for you.",
      "expressive":
        "Soft Structure gives you a composed anchor that allows a more expressive look to hold together without flattening it.",
      "neutral":
        "Soft Structure gives you a way to shift the register of a quiet outfit without adding stiffness or decoration.",
    },
    styleDnaSays: {
      "clean-polished":
        "That is what Soft Structure is built on — one considered shape, with calm surrounding it.",
      "fluid-ease":
        "That is why this direction works with what you already wear rather than asking you to replace it.",
      "expressive":
        "That is the instinct Soft Structure rewards — one composed gesture with space around it to read.",
      "neutral":
        "That is what a single clearly chosen piece delivers — a shift in register, with no further adjustment needed.",
    },
    yourBestRouteIn: {
      "clean-polished":
        "Based on your Style DNA, start with one clearly proportioned piece — a wide-leg trouser, longline blazer, or draped midi dress. Keep everything around it quieter.",
      "fluid-ease":
        "Based on your Style DNA, the easiest entry is one shaped piece with genuine proportion — a wide leg, draped midi dress, or relaxed blazer — worn against something familiar.",
      "expressive":
        "Based on your Style DNA, try one clearly proportioned anchor — a wide trouser, longline blazer, or draped midi dress — and keep everything else composed around it.",
      "neutral":
        "Based on your Passport, start with one piece that has clear, considered proportion — a wide-leg trouser or longline layer is the cleanest entry.",
    },
    theBalanceToProtect: {
      "clean-polished":
        "One anchor piece at a time. A second proportioned element in the same look shifts it from composed to complicated — the surrounding pieces should be quieter than the anchor.",
      "fluid-ease":
        "The ease stays in the surrounding pieces, not the anchor. One shaped piece with everything else relaxed is the right balance — two proportioned shapes pull the look apart.",
      "expressive":
        "The gesture only reads when it has quiet space around it. Anything that competes with the anchor reduces its effect — keep the rest of the look as calm as possible.",
      "neutral":
        "One anchor per look. A second proportion statement in the same outfit competes with the first — keep the balance simple.",
    },
    partToTake: [
      "One anchor piece — a wide trouser, a longline blazer, or a draped midi dress — that changes the proportion of the outfit without adding stiffness.",
      "Fabric that holds shape softly: structured crepe, dry-hand twill, or fluid viscose. Choose a fabric with enough body to hold the line without stiffness.",
    ],
    leaveOutCandidates: [
      {
        text: "Head-to-toe structured suiting — stiffness reads as effort here, not polish.",
        vocab: ["suit", "stiff", "rigid", "suiting"],
      },
      {
        text: "Two oversized or highly proportioned shapes in the same look — one generous piece works, two compete.",
        vocab: ["oversized", "volume", "balloon", "competing"],
      },
      {
        text: "Surface embellishment — the impression comes from proportion and fabric, not decoration.",
        vocab: ["embellish", "decorative", "print", "beading", "detail"],
      },
    ],
    lookToTryPassportOnly:
      "Wear a longline blazer open over a fine knit and wide-leg trousers. Keep the shoe simple and accessories minimal so the shape carries.",
  },

  "modern-tailoring-spring-2026": {
    yourVersionPassport: {
      "clean-polished":
        "Modern Tailoring gives you a separates approach — one well-cut piece that works across your wardrobe rather than completing a single look.",
      "fluid-ease":
        "Modern Tailoring gives you one structural note alongside something relaxed — the contrast between them is the whole look, not a compromise.",
      "expressive":
        "Modern Tailoring gives you a composed counterpoint — one structured piece that keeps a more expressive look from tipping into too much.",
      "neutral":
        "Modern Tailoring gives you a consistent route to a considered look without adding formal weight.",
    },
    styleDnaSays: {
      "clean-polished":
        "That is where a well-cut separates piece earns its keep — one item doing more work than a full set.",
      "fluid-ease":
        "That is why the contrast between the tailored piece and its relaxed counterpart reads as a complete look.",
      "expressive":
        "That is why one composed piece can hold a more expressive look together without flattening it.",
      "neutral":
        "That is why one tailored piece, worn against something softer, is the more reliable approach.",
    },
    yourBestRouteIn: {
      "clean-polished":
        "Based on your Style DNA, try a well-cut blazer, waistcoat, or wide-leg trouser as a standalone separates piece.",
      "fluid-ease":
        "Based on your Style DNA, try one tailored piece — a blazer, wide-leg trouser, or longline jacket — alongside something visibly relaxed.",
      "expressive":
        "Based on your Style DNA, try one tailored piece as the composed anchor next to something more fluid or relaxed.",
      "neutral":
        "Based on your Passport, try a blazer or wide-leg trouser worn against something simpler and softer — the contrast between the two is the look.",
    },
    theBalanceToProtect: {
      "clean-polished":
        "The tailored piece works as a separates tool, not as part of a matched set. A matched suit takes the direction more formal and removes the contrast this approach depends on.",
      "fluid-ease":
        "The tailored piece stays softer than structured suiting. Rigid fabric with no movement reduces the contrast the direction depends on — the anchor should hold its line without pressing.",
      "expressive":
        "The structured piece should anchor the look, not finish it on its own. Extra detailing on the tailored piece competes with the contrast that makes the direction work.",
      "neutral":
        "The tailored piece works against something relaxed. A matched tailored set removes the contrast that makes the direction work — keep the separates approach.",
    },
    partToTake: [
      "One tailored anchor — a blazer, waistcoat, or wide-leg trouser — that functions across at least three separate combinations, not just one.",
      "The proportion contrast: longline against narrow, cropped against wide, structured against relaxed. That decision is the styling.",
    ],
    leaveOutCandidates: [
      {
        text: "A suit worn as a matched set — it takes the direction more formal and removes the proportion contrast this approach depends on.",
        vocab: ["suit", "matched", "set", "uniform"],
      },
      {
        text: "Stiff fabric with no movement — the tailored piece should hold its line without being rigid.",
        vocab: ["stiff", "rigid", "heavy", "construction"],
      },
      {
        text: "Trousers that only work with heels — the proportion should work across real shoes and occasions.",
        vocab: ["heels", "formal", "occasion", "restrict"],
      },
    ],
    lookToTryPassportOnly:
      "Wear a tailored wide-leg trouser with a fine knit above. One structured piece alongside one relaxed counterpart — keep the shoe simple and accessories minimal.",
  },

  "spring-2026-colour-direction": {
    yourVersionPassport: {
      "clean-polished":
        "Colour Direction gives you a method, not a new palette — one clear accent that earns its place against the neutral base you already dress from.",
      "fluid-ease":
        "Colour Direction gives you one easy edit — a single accent that shifts the mood of a familiar, unfussy outfit.",
      "expressive":
        "Colour Direction rewards restraint — one genuinely considered accent that reads as intentional rather than decorated.",
      "neutral":
        "Colour Direction gives you a simple method — one clear accent introduced against a quiet base you already own.",
    },
    styleDnaSays: {
      "clean-polished":
        "That composed base is already in place — the method builds on ground you already start from.",
      "fluid-ease":
        "That is why the accent reads — the unfussy base is already the default.",
      "expressive":
        "That deliberateness is what makes a single accent land as a decision rather than an accident.",
      "neutral":
        "That is why one considered accent, consistently introduced, becomes a wardrobe method.",
    },
    yourBestRouteIn: {
      "clean-polished":
        "Based on your Style DNA, start with one clear accent — a bag, shoe, top, skirt, or trouser — against a neutral base you already own.",
      "fluid-ease":
        "Based on your Style DNA, try one accent piece — a bag, shoe, or coloured garment — against the calm, unfussy base you already wear.",
      "expressive":
        "Based on your Style DNA, try one genuinely intentional accent note against a quiet base — one piece, one clear colour.",
      "neutral":
        "Based on your Passport, introduce one accent piece — a bag, shoe, or coloured garment — against a neutral base.",
    },
    theBalanceToProtect: {
      "clean-polished":
        "One accent note against a quiet base. A second competing accent cancels the first — the method depends entirely on restraint.",
      "fluid-ease":
        "The base stays unfussy so the accent can read. If the base itself has too many colour statements, the single note disappears.",
      "expressive":
        "One accent registers as deliberate; two compete. The quiet base is the condition, not a concession — keep it clean.",
      "neutral":
        "One note per look. Adding more accent pieces doesn't strengthen the direction — it turns a method into a styling problem.",
    },
    partToTake: [
      "A quiet base that earns its place by working with everything: soft white, cream, stone, washed denim, or black.",
      "One clear accent against that base — a bag, shoe, top, skirt, trouser, or other single colour note.",
    ],
    partToTakeNeutralColour: [
      "A quiet base — a neutral colour already easy to repeat — is the starting condition for this method.",
      "One clear accent against that base — a bag, shoe, top, skirt, trouser, or other single colour note.",
    ],
    partToTakeColourHints: [
      {
        terms: ["beige", "brown", "espresso", "tan", "camel", "chocolate"],
        bullet: "An espresso anchor — warmer than black, more grounded than beige, and more likely to be the neutral gap your wardrobe has.",
      },
      {
        terms: ["navy"],
        bullet: "A deep navy anchor as the quiet base — the same authority as black with slightly more warmth at the foundation.",
      },
      {
        terms: ["white", "cream", "ivory", "off-white", "stone", "ecru", "oatmeal", "sand"],
        bullet: "A soft white or cream base — already your instinct, and the starting condition this direction is built on. The accent is what changes next.",
      },
      {
        terms: ["black", "charcoal"],
        bullet: "A deep anchor neutral — espresso, brown, washed black, or navy — as the base. The accent note is where the method adds something new.",
      },
    ],
    leaveOutCandidates: [
      {
        text: "Several accent pieces in the same seasonal colour — one note changes the wardrobe; three create a styling problem.",
        vocab: ["accent", "seasonal", "shade", "colour", "color"],
      },
      {
        text: "Over-coordinated colour matching — the accent's job is to interrupt the base, not to blend into it.",
        vocab: ["coordinate", "match", "blend", "tone", "tonal"],
      },
      {
        text: "Replacing an entire wardrobe for one trending shade — the method is one accent that earns its place across what you already own.",
        vocab: ["trending", "season", "replace", "wardrobe"],
      },
    ],
    lookToTryPassportOnly:
      "Wear cream trousers and a simple knit, or washed denim with a fine top — add one clear accent through a bag or shoe. One considered note; everything else calm.",
  },
};

// ---------------------------------------------------------------------------
// Style DNA block — evidence-led YOUR STYLE DNA SAYS copy.
// Combines the register-based base with one Passport-grounded supplement drawn
// from the customer's actual fit preferences or aspirations. The internal
// reasons array is NEVER exposed in ShopperEdit — it exists for auditability only.
// ---------------------------------------------------------------------------

// Passport-signal → first sentence of YOUR STYLE DNA SAYS.
// Written as a person-observation ("You lean toward…", "You respond to…").
// Searched in priority order: fitPreferences → desiredFeelings → desiredImpression → becoming.
// First match wins; combined with styleDnaSays[register] as the second sentence.
const STYLE_DNA_SUPPLEMENT: Partial<Record<string, Partial<Record<string, string>>>> = {
  "spring-2026-soft-structure": {
    "relaxed-fits": "You lean toward ease in construction — proportion and fabric that move without pressing.",
    "structured":   "You respond to clean definition — one clear shape, nothing competing with it.",
    "midi-length":  "Your Passport notes a preference for lengths that create line rather than interrupt it.",
    "refined":      "You are drawn to composed, held-back looks — one anchor, everything else restrained.",
    "powerful":     "Your Passport signals building presence through proportion and cut — this direction works exactly that way.",
    "confident":    "Your Passport signals building presence through proportion and cut — this direction works exactly that way.",
    "effortless":   "Your Passport signals a preference for looks that feel complete without effort — one piece doing most of the work.",
    "interesting":  "You are drawn to one considered gesture per look rather than layered effects.",
    "creative":     "You are drawn to one considered gesture per look rather than layered effects.",
    "elegant":      "You favour restraint — a calm base that gives one anchor piece room to register.",
  },
  "modern-tailoring-spring-2026": {
    "relaxed-fits": "You respond to ease — which is what makes one tailored piece work so well against a relaxed counterpart.",
    "structured":   "You respond to precision and clean definition — exactly what one well-cut separates piece delivers.",
    "refined":      "You are drawn to composed looks that achieve more with less obvious effort.",
    "powerful":     "Your Passport signals building presence through structure and line — not through volume.",
    "confident":    "Your Passport signals building presence through structure and line — not through volume.",
    "effortless":   "Your Passport signals a preference for looks that feel considered without appearing dressed-up.",
    "interesting":  "You are drawn to proportion contrast as the main styling decision.",
    "creative":     "You are drawn to proportion contrast as the main styling decision.",
  },
  "spring-2026-colour-direction": {
    "relaxed-fits": "Your Passport signals unfussy pieces that work together without a formula — the quiet base this method requires.",
    "structured":   "Your Passport signals composed, clean foundations — exactly the starting condition this method requires.",
    "interesting":  "You are drawn to one considered note per look rather than layered effects.",
    "creative":     "You are drawn to one considered note per look rather than layered effects.",
    "elegant":      "You favour restraint — a calm base that gives a single colour note room to read.",
    "put-together": "Your Passport signals looking finished without appearing overdressed — a quiet base with one accent achieves exactly that.",
    "effortless":   "Your Passport signals a preference for low-commitment changes — that is exactly what this method offers.",
  },
};

// Lifestyle, becoming, and aspiration signals → YOUR PASSPORT SAYS copy.
// Priority: lifestyle context → becoming direction → desiredImpression → desiredFeelings.
// Sentences are goal/context-angled ("where you're headed, what your day requires") — distinct
// from STYLE_DNA_SUPPLEMENT which is behavioral ("you lean toward, you respond to").
const PASSPORT_POINTS_TO_SUPPLEMENT: Partial<Record<string, Partial<Record<string, string>>>> = {
  "spring-2026-soft-structure": {
    "office":           "Your lifestyle includes professional settings — which is where one anchor piece without decoration earns its keep most clearly.",
    "hybrid":           "Your lifestyle moves between settings — one anchor piece set up correctly holds across all of them without further adjustment.",
    "events":           "You dress for occasions that need composure without visible effort — one proportioned shape delivers that more reliably than a more assembled look.",
    "busy-mom":         "Your day covers a lot of ground without pause — one considered shape works because it requires nothing further once it is in place.",
    "on-the-go":        "Your days move quickly — which is why one considered shape works better here than pieces that need to resolve against each other.",
    "casual-days":      "Your day is casual by default — which is where Soft Structure earns its place most naturally. One considered shape worn without effort reads as deliberate rather than dressed-up.",
    "travel":           "You travel — where one considered shape outperforms a more assembled look. One proportioned piece covers the range of what you need without planning around it.",
    "more-confident":    "You are building toward more confident dressing — Soft Structure gives you that without asking you to work harder than you already do.",
    "more-elegant":      "You are working toward a more elegant register — one clearly proportioned shape moves you in that direction without formality.",
    "more-creative":     "You are drawn toward more creative expression — Soft Structure gives you one specific, considered gesture to work with.",
    "more-interesting":  "You want to look more interesting — which one clear, considered shape achieves more reliably than several competing ones.",
    "more-put-together": "You want to feel consistently put-together — one considered silhouette is the most reliable route to that.",
    // desiredImpression / desiredFeelings — aspirational angle, different from STYLE DNA behavioral framing
    "refined":        "Your style is moving toward a more refined register — this direction builds presence through restraint and proportion rather than visible effort.",
    "elegant":        "You are working toward a more elegant way of dressing — one clearly proportioned shape moves you there without formality.",
    "powerful":       "You want to feel powerful in what you wear — presence here comes from proportion and silhouette, not formal construction.",
    "confident":      "You want to feel confident — this direction builds that through cut and proportion rather than formal weight.",
    "effortless":     "You want to look effortless — a single considered shape, set up correctly, reads as deliberate without appearing assembled.",
    "put-together":   "You want to feel consistently put-together — one clearly proportioned piece is the most reliable route to that without statement pieces.",
    "interesting":    "You want to look more interesting — one clearly considered silhouette achieves that more reliably than layered effects.",
    "comfortable":    "You want to feel comfortable without losing presence — ease here is built into the proportion, not negotiated around stiffness.",
    "attractive":     "You want to look polished — a clean silhouette reads with more authority than most individual details can.",
    "soft-confident": "You want to feel soft but confident — this direction holds both without asking you to choose between them.",
    "feminine":       "You want to feel feminine — softened proportions and fluid fabric keep this direction feeling soft rather than constructed.",
    "creative":       "You are working toward a more original way of dressing — one specific, considered shape is the clearest expression of that.",
  },
  "modern-tailoring-spring-2026": {
    "office":             "Your lifestyle includes professional settings — where the separates approach earns its place: one tailored piece that holds for work without locking you into a matched suit.",
    "hybrid":             "Your lifestyle moves between settings — one tailored separates piece is the most reliable investment for that range without needing to change the whole look.",
    "events":             "You dress for occasions — Modern Tailoring gives you a look that holds for events without the rigidity of formal suiting.",
    "busy-mom":           "Your day moves between contexts — one tailored piece that works across them is a more reliable investment than something built for a single occasion.",
    "on-the-go":          "Your lifestyle keeps moving — which is where one well-cut tailored piece earns more than a complete matched look.",
    "casual-days":        "Your day is casual by default — one tailored piece against something relaxed works best when the surrounding context is already informal. That is the contrast this direction depends on.",
    "travel":             "You travel — where one well-cut tailored piece functions across arrival, meetings, and dinner without a change of look. That range is what makes the separates approach worth the investment.",
    "more-confident":    "You are building toward more confident dressing — one well-cut tailored piece carries more authority than a more assembled look.",
    "more-elegant":      "You are working toward a more elegant register — Modern Tailoring's separates approach gives you that without formal weight.",
    "more-interesting":  "You want to look more interesting — the proportion contrast between a tailored piece and its counterpart is where that decision lives.",
    "more-put-together": "You want to feel more put-together consistently — one well-cut tailored piece is the most reliable route to that without statement pieces.",
    // desiredImpression / desiredFeelings — aspirational angle, different from STYLE DNA behavioral framing
    "refined":       "Your style is working toward a more refined register — one well-cut tailored piece achieves that more reliably than a matched set.",
    "elegant":       "You are working toward a more elegant register — Modern Tailoring's separates approach gives you that without formal weight.",
    "powerful":      "You want to feel powerful — the authority here comes from one well-cut piece, not from the formality of suiting.",
    "confident":     "You want to feel confident — one well-cut tailored piece carries more authority than a more assembled look.",
    "effortless":    "You want to look effortless — one tailored piece worn against something relaxed reads as considered without appearing dressed-up.",
    "put-together":  "You want to feel consistently put-together — one well-cut tailored piece is the most reliable route to that.",
    "interesting":   "You want to look more interesting — the proportion contrast between a tailored piece and its relaxed counterpart is where that decision lives.",
    "comfortable":   "You want to feel comfortable — a tailored piece in fabric that holds its line without stiffness gives you composure without restriction.",
    "creative":      "You are working toward a more original way of dressing — the proportion contrast between a structured piece and something relaxed is the most direct expression of that.",
    "attractive":    "You want to look polished and considered — one well-cut separates piece achieves that more reliably than a full matched look.",
  },
  "spring-2026-colour-direction": {
    "office":           "Your lifestyle includes professional settings — one deliberate accent against a quiet base holds across them without requiring a separate work wardrobe.",
    "hybrid":           "Your lifestyle moves between settings — one considered accent against a neutral base works across all of them.",
    "events":           "You dress for occasions — one deliberate accent against a quiet base gives a familiar outfit an occasion-appropriate register without a new look.",
    "casual-days":      "Your day is casual by default — which is where one clear accent note against an unfussy base works best.",
    "on-the-go":        "Your lifestyle keeps moving — which is why one considered accent note is the most you need. It shifts a familiar outfit without adding anything to think about.",
    "more-confident":   "You are building toward more confident dressing — one clear, deliberate accent note makes a direct statement without requiring everything else to change.",
    "more-creative":    "You are drawn toward more creative expression — one genuinely deliberate colour note achieves that more directly than a more coloured approach.",
    "more-interesting": "You want to look more interesting — which is precisely what one considered accent against a quiet base achieves.",
    // desiredImpression / desiredFeelings — aspirational angle, different from STYLE DNA behavioral framing
    "refined":        "Your style is working toward a more refined register — restraint in colour, specifically one clear accent, is the expression of that.",
    "elegant":        "You are working toward a more elegant register — one deliberate colour note against a quiet base is specifically how that reads.",
    "creative":       "You are working toward a more original way of dressing — one genuinely deliberate colour note achieves that more directly than a fuller palette.",
    "interesting":    "You want to look more interesting — one considered accent against a quiet base achieves that more reliably than multiple colour notes.",
    "confident":      "You want to feel confident — one clear, deliberate accent note makes a direct statement without requiring everything else to change.",
    "effortless":     "You want to look effortless — one accent, whether a bag, shoe, or coloured garment, keeps the look intentional without demanding a re-edit.",
    "put-together":   "You want to feel consistently put-together — a quiet base with one deliberate accent reads as composed rather than cautious.",
    "comfortable":    "You want to feel comfortable — one considered note against a familiar base is the simplest version of this direction.",
    "soft-confident": "You want to feel soft but confident — one clear accent against a quiet base achieves exactly that register.",
    "attractive":     "You want to look polished — one clear accent against a quiet base reads as more deliberate than several competing notes.",
  },
};

// Passport-signal → second sentence appended to YOUR VERSION OF THIS TREND.
// Draws from the same signal priority order as STYLE_DNA_SUPPLEMENT.
// Only the strongest matching signal fires; never fires more than once per render.
const VERSION_PASSPORT_SUPPLEMENT: Partial<Record<string, Partial<Record<string, string>>>> = {
  "spring-2026-soft-structure": {
    "relaxed-fits": "It gives you presence without asking you to lose ease.",
    "structured":   "The structure stays in the shape, not in stiffness — which is where clean definition earns its place.",
    "midi-length":  "Midi lengths are one of the most natural expressions of this direction.",
    "effortless":   "It reads as deliberate without asking you to assemble something complicated.",
    "refined":      "The result is composed without being stiff — which is where polish actually registers.",
    "put-together": "It is the most reliable route to a polished look without needing statement pieces.",
    "powerful":     "Presence here comes from proportion and cut, not from formal weight.",
    "confident":    "Presence here comes from proportion and cut, not from formal weight.",
    "interesting":  "One gesture, positioned correctly, reads more than multiple layers of interest.",
    "creative":     "One clearly shaped piece earns more attention than decoration spread across the whole look.",
    "feminine":     "Softened proportions and fluid fabrics keep the direction feeling soft rather than constructed.",
    "elegant":      "Restraint in the surrounding pieces is what gives the silhouette its full effect.",
  },
  "modern-tailoring-spring-2026": {
    "relaxed-fits": "The contrast between the tailored piece and the relaxed counterpart is the whole method — not a compromise.",
    "structured":   "One precisely shaped separates piece earns more than a full matched suit.",
    "effortless":   "One tailored piece against something relaxed reads as considered without appearing dressed-up.",
    "refined":      "One well-cut piece lifts the whole look's register without needing anything else to work harder.",
    "put-together": "It is the most reliable route to a finished, considered look without statement pieces.",
    "powerful":     "The tailored anchor makes a clear statement through cut and proportion rather than formality.",
    "confident":    "The tailored anchor makes a clear statement through cut and proportion rather than formality.",
    "interesting":  "The proportion contrast between the two pieces is where the styling decision lives.",
    "creative":     "The proportion contrast between the two pieces is where the styling decision lives.",
  },
  "spring-2026-colour-direction": {
    "relaxed-fits": "An unfussy base is already the starting condition — the accent works with what you already wear.",
    "structured":   "A composed base gives one accent exactly the room it needs to register.",
    "effortless":   "Colour through one considered piece — a bag, shoe, or coloured garment — keeps the look intentional without demanding a full re-edit.",
    "put-together": "A quiet base with one deliberate note reads as composed rather than cautious.",
    "interesting":  "One considered colour note registers more than multiple competing accents.",
    "creative":     "One considered colour note registers as intentional rather than decorated.",
    "elegant":      "Restraint in the base is what gives the single note its effect.",
  },
};

// Per-slug sentence for YOUR REVIEWS SUGGEST — fires when ≥3 reviews AND didntWorkTags
// is non-empty. Never exposes review counts, tag names, or backend language.
const REVIEW_EVIDENCE_SENTENCES: Partial<Record<string, string>> = {
  "spring-2026-soft-structure":   "Your outfit history with nAia points in the same direction — the patterns that haven't worked tend toward the areas this edit sets aside.",
  "modern-tailoring-spring-2026": "Your outfit history suggests the same approach — the patterns that haven't landed point toward keeping this edit focused rather than adding formal structure.",
  "spring-2026-colour-direction": "Your outfit history suggests the same method — the patterns that haven't landed tend toward over-coordination rather than a single deliberate note.",
};

// One supplementary sentence appended to REVIEW_EVIDENCE_SENTENCES when a specific
// negative-tag pattern is identified. Vocabulary-matched against the didntWorkTags corpus.
// Never exposes raw tag values — only pre-written editorial conclusions.
const REVIEW_EVIDENCE_TAG_SUPPLEMENTS: Partial<Record<string, Array<{ vocab: string[]; supplement: string }>>> = {
  "spring-2026-soft-structure": [
    {
      vocab: ["stiff", "rigid", "heavy", "structured"],
      supplement: "The stiffness signals in your history point toward one anchor piece in a fabric with movement, not construction.",
    },
    {
      vocab: ["oversized", "volume", "baggy", "big"],
      supplement: "Your history with oversized pieces suggests one clearly proportioned shape rather than layered volume.",
    },
    {
      vocab: ["formal", "dressed-up", "overdressed"],
      supplement: "The over-dressed signals in your history point toward proportion over decoration as the route to a more considered look.",
    },
  ],
  "modern-tailoring-spring-2026": [
    {
      vocab: ["stiff", "rigid", "formal", "suit", "dressed-up"],
      supplement: "The formal signals in your history suggest the separates approach rather than a full tailored look.",
    },
    {
      vocab: ["oversized", "relaxed", "casual"],
      supplement: "Your history points toward keeping the relaxed counterpart genuinely relaxed — the tailored piece carries the register on its own.",
    },
    {
      vocab: ["uncomfortable", "restrictive", "tight"],
      supplement: "The comfort signals in your reviews suggest prioritising fabric with movement — the tailored piece should hold its line without pressing.",
    },
  ],
  "spring-2026-colour-direction": [
    {
      vocab: ["clash", "colour", "color", "matching", "coordinate"],
      supplement: "The colour signals in your history confirm one deliberate note works better than attempting to coordinate — the method agrees.",
    },
    {
      vocab: ["busy", "overdone", "overdressed", "too much"],
      supplement: "The over-styled signals in your history confirm restraint is the right instinct — one accent, everything else calm.",
    },
    {
      vocab: ["boring", "flat", "plain", "dull"],
      supplement: "The signals toward more interest in your history point toward one considered colour note rather than more pieces.",
    },
  ],
};

type StyleDnaBlock = {
  text: string;
  reasons: string[]; // internal only — never exposed in ShopperEdit
};

function buildStyleDnaBlock(
  register: StyleRegister,
  rules: PersonalEditRules,
  profile: ShopperProfileEvidence,
  slug: string,
): StyleDnaBlock | null {
  const usableSignalCount = [
    profile.stylePersonalities.length > 0,
    profile.fitPreferences.length > 0,
    (profile.desiredFeelings.length > 0 || profile.desiredImpression.length > 0),
    profile.becoming.length > 0,
  ].filter(Boolean).length;

  if (usableSignalCount < 2) return null;

  const base = rules.styleDnaSays[register];
  const reasons: string[] = ["style register: " + register];
  const supplement = STYLE_DNA_SUPPLEMENT[slug];
  let extra = "";

  if (supplement) {
    // Fit preferences take priority as the most concrete signal
    for (const pref of profile.fitPreferences) {
      const sig = supplement[pref];
      if (sig) { extra = sig; reasons.push("fit preference: " + pref); break; }
    }
    // Then aspiration signals (desiredFeelings → desiredImpression → becoming)
    if (!extra) {
      const ids = [
        ...profile.desiredFeelings,
        ...profile.desiredImpression,
        ...profile.becoming.map(normalizeBecomingId),
      ];
      for (const id of ids) {
        const sig = supplement[id];
        if (sig) { extra = sig; reasons.push("aspiration: " + id); break; }
      }
    }
  }

  // Supplement leads (Passport observation), base follows ("That is why…").
  // If no Passport-specific supplement matches, suppress the block entirely
  // rather than rendering the generic register-only base sentence alone.
  if (!extra) return null;
  return {
    text: `${extra} ${base}`,
    reasons,
  };
}

// YOUR PASSPORT SAYS — lifestyle, becoming, and aspiration signals.
// Priority: lifestyle context → becoming direction → desiredImpression → desiredFeelings.
// Sentences use a goal/context angle distinct from STYLE DNA behavioral framing.
function buildPassportPointsBlock(
  profile: ShopperProfileEvidence,
  lifestyleIds: string[],
  slug: string,
): string | null {
  const table = PASSPORT_POINTS_TO_SUPPLEMENT[slug];
  if (!table) return null;
  for (const id of lifestyleIds) {
    const sentence = table[id];
    if (sentence) return sentence;
  }
  for (const id of profile.becoming) {
    const sentence = table[id];
    if (sentence) return sentence;
  }
  for (const id of profile.desiredImpression) {
    const sentence = table[id];
    if (sentence) return sentence;
  }
  for (const id of profile.desiredFeelings) {
    const sentence = table[id];
    if (sentence) return sentence;
  }
  return null;
}

// Picks the single strongest Passport signal for YOUR VERSION OF THIS TREND.
// Priority: fitPreferences → desiredFeelings → desiredImpression → becoming.
function pickVersionSupplement(
  profile: ShopperProfileEvidence,
  slug: string,
): string | null {
  const table = VERSION_PASSPORT_SUPPLEMENT[slug];
  if (!table) return null;
  for (const id of profile.fitPreferences) {
    if (table[id]) return table[id];
  }
  const ids = [
    ...profile.desiredFeelings,
    ...profile.desiredImpression,
    ...profile.becoming.map(normalizeBecomingId),
  ];
  for (const id of ids) {
    if (table[id]) return table[id];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Closet item role note — evidence block.
// Grounded in item.category, primaryColor, material, and slug only.
// ---------------------------------------------------------------------------

// Appends exactly ONE supporting qualifier to the role note.
// Priority: Colour Direction → colour only. Soft Structure / Modern Tailoring → material first, colour as fallback.
// Never stacks multiple qualifiers.
function buildColorMaterialSuffix(item: ShopperClosetItemEvidence, slug: string): string {
  const c = item.primaryColor?.toLowerCase() ?? null;
  const m = item.material?.toLowerCase() ?? null;

  // Dark-anchor is purely a phrasing refinement WITHIN the neutral set (a
  // nicer sentence for black/navy/charcoal-type depth) — never the
  // neutral/accent boundary itself. That boundary comes from the same
  // canonical resolver every other role decision uses. Previously this used
  // its own short hard-coded neutral-word list ("white, cream, beige,
  // stone, ivory..."), which did not include every word the resolver itself
  // treats as neutral (e.g. "camel", "grey"/"gray", "khaki", "tan",
  // "taupe") — those items fell through to the "potential accent note"
  // branch despite being genuinely neutral, the same category of
  // contradiction as the white-sneaker bug, just via a text-list mismatch
  // instead of a category switch.
  const isDarkAnchor = c ? ["black", "navy", "charcoal", "espresso", "brown", "chocolate", "dark", "midnight"].some((t) => c.includes(t)) : false;
  const isFluid = m ? ["silk", "viscose", "satin", "chiffon", "jersey", "crepe", "linen", "lyocell", "modal", "georgette"].some((t) => m.includes(t)) : false;
  const isStructured = m ? ["wool", "twill", "denim", "leather", "suede", "cashmere", "gabardine", "ponte"].some((t) => m.includes(t)) : false;

  // Colour Direction: colour is always the most relevant signal.
  if (slug === "spring-2026-colour-direction" && c) {
    const resolution = resolveFreeTextColourFamilies(c);
    if (resolution.isNeutral) {
      if (isDarkAnchor) return ` Its ${c} depth works as the anchor in this direction — one of the warm neutrals the method is built on.`;
      return ` Its ${c} tone reads as the base — the quiet foundation this direction requires.`;
    }
    if (!resolution.unknown && resolution.hueFamilies.length > 0) {
      return ` Its ${c} colour is a potential accent note — one considered colour against a quieter base.`;
    }
    return "";
  }

  const isNeutral = c ? ["white", "cream", "beige", "stone", "ivory", "off-white", "sand", "ecru", "oatmeal"].some((t) => c.includes(t)) : false;

  // Soft Structure / Modern Tailoring: material is the most structurally relevant signal.
  if (slug === "spring-2026-soft-structure" && m) {
    if (isFluid) return ` Its ${m} carries the line without stiffness — that is what this direction is built on.`;
    if (isStructured) return ` Its ${m} holds its shape well — pair with something softer so the look does not become heavy.`;
  }
  if (slug === "modern-tailoring-spring-2026" && m) {
    if (isFluid) return ` Its ${m} provides movement — which is what keeps this as a separates play rather than formal suiting.`;
    if (isStructured) return ` Its ${m} holds its structure cleanly — pair against something relaxed to create the contrast this direction needs.`;
  }

  // Colour fallback for Soft Structure / Modern Tailoring when no material qualifier fired.
  if (c && (slug === "spring-2026-soft-structure" || slug === "modern-tailoring-spring-2026")) {
    if (isNeutral) return ` Its ${c} tone sits cleanly — the proportion carries without the colour competing.`;
    if (isDarkAnchor) return ` Its ${c} depth gives the silhouette presence without adding decoration.`;
  }

  return "";
}

function buildEvidenceItemRoleNote(item: ShopperClosetItemEvidence, slug: string): string {
  const suffix = buildColorMaterialSuffix(item, slug);

  if (slug === "spring-2026-soft-structure") {
    // Role-aware, not category-aware. Confirmed live QA contradiction: a
    // draped, flowy BOTTOMS item (genuinely soft-flowing evidence) got
    // "The structural base" purely because BOTTOMS was in this map — the
    // same category-only mistake Colour Direction's branch below was
    // already fixed for. Category only picks WHICH anchor or soft-flowing
    // sentence to use once the role itself is decided — it never flips a
    // soft-flowing item into anchor/structural wording or vice versa.
    const role = scoreItemAttributes(item, slug).bestDimensionId;

    if (role === "soft-flowing") {
      const softNotes: Partial<Record<string, string>> = {
        BOTTOMS:   "The soft, moving counterpart here. A cleaner, more structured piece above gives the drape something to play against.",
        TOPS:      "The relaxed, flowing counterpart in this direction. A cleaner, more structured piece alongside it is what gives the proportion its contrast.",
        OUTERWEAR: "A looser, more fluid layer in this direction — the ease it brings is the point.",
        DRESSES:   "The soft, fluid expression of this direction on its own — no structured layer needed unless the occasion asks for more presence.",
      };
      return (softNotes[item.category] ?? "A soft, flowing counterpart in this direction.") + suffix;
    }

    // structured-anchor, or no resolvable role at all — anchor/structure
    // language only.
    const anchorNotes: Partial<Record<string, string>> = {
      OUTERWEAR: "The anchor silhouette in this direction. Keep everything underneath simple so the proportion carries.",
      BOTTOMS:   "The structural base. A clean, contained top lets the cut do the work.",
      TOPS:      "A useful starting point for this direction. Pair it with a cleaner, more structured bottom so the top remains the main point of interest.",
      DRESSES:   "One piece covers the whole direction. Add one structured layer only when the occasion needs more presence.",
    };
    return (anchorNotes[item.category] ?? "A starting point for this direction.") + suffix;
  }
  if (slug === "modern-tailoring-spring-2026") {
    // Role-aware, not category-aware — same fix as Soft Structure above.
    // A relaxed TOPS/BOTTOMS item functioning as the relaxed counterpart
    // must never read like another tailored anchor.
    const role = scoreItemAttributes(item, slug).bestDimensionId;
    const effCat = getEffectiveCategory(item, slug);

    if (role === "relaxed-counterpart") {
      const relaxedNotes: Partial<Record<string, string>> = {
        TOPS:      "The softer counterpart in this direction. The contrast it creates with a structured piece — a blazer, waistcoat, or clean trouser — is what Modern Tailoring is built on.",
        BOTTOMS:   "The relaxed, easy counterpart here. A structured piece above it (a blazer or clean shirt) is what creates the proportion contrast.",
        OUTERWEAR: "A looser, more relaxed layer in this direction — it's the ease half of the contrast.",
      };
      return (relaxedNotes[effCat] ?? "The softer, more relaxed counterpart in this direction.") + suffix;
    }

    // tailored-anchor, or no resolvable role at all — anchor language only.
    const anchorNotes: Partial<Record<string, string>> = {
      OUTERWEAR: "The tailored anchor. Pair it with something relaxed — a soft knit or fluid trouser — for the separates contrast.",
      BOTTOMS:   "The separates foundation. The styling question is which relaxed counterpart it works against.",
      TOPS:      "A structured, tailored piece in this direction — pair it with a relaxed trouser or skirt below for the contrast the method is built on.",
    };
    return (anchorNotes[effCat] ?? "A starting point for this direction.") + suffix;
  }
  if (slug === "spring-2026-colour-direction") {
    // Role-aware, not category-aware. Confirmed root cause of a live QA
    // contradiction: white sneakers (genuinely neutral — base-neutral role)
    // got "The accent note at ground level" purely because SHOES was in
    // this map, while the same item correctly read as "the base" elsewhere
    // in the same report. Category only selects WHICH accent or base
    // sentence to use once the role itself is already decided — it can
    // never flip a base item into accent wording or vice versa.
    const role = scoreItemAttributes(item, slug).bestDimensionId;

    if (role === "accent-colour") {
      const accentNotes: Partial<Record<string, string>> = {
        BAGS:        "An entry point into this direction at the accessory level. One accent note against a calm base.",
        SHOES:       "The accent note at ground level. Keep the rest of the outfit quiet so one colour reads.",
        ACCESSORIES: "A low-commitment entry into this direction. One considered piece against a quiet base.",
      };
      return (accentNotes[item.category] ?? "The accent note in this direction — one deliberate colour against a quiet base.") + suffix;
    }

    // base-neutral, or no resolvable role at all — base/support language
    // only. Never accent wording for a neutral shoe, bag, or accessory.
    const baseNotes: Partial<Record<string, string>> = {
      TOPS:      "The neutral base this direction builds from. Keep the outfit at this tone and introduce one deliberate accent — a bag, shoe, or coloured garment.",
      BOTTOMS:   "The neutral base this direction builds from. A clean foundation — the accent comes from elsewhere.",
      DRESSES:   "The neutral base this direction builds from. One piece covers the foundation; add the accent through one other piece.",
      OUTERWEAR: "The neutral base this direction builds from. Keep it quiet and let one accent piece do the colour work.",
    };
    return (baseNotes[item.category] ?? "A quiet, neutral piece in this direction — it supports the base rather than carrying the accent.") + suffix;
  }
  return "A starting point for this direction.";
}

// ---------------------------------------------------------------------------
// Wearable-pair compatibility guard.
// Prevents two garments from the same clothing category (TOP+TOP, BOTTOM+BOTTOM, etc.)
// from being combined into an outfit. Accessory categories are always wearable with anything.
// ---------------------------------------------------------------------------

const CLOTHING_CATS_FOR_PAIRING = new Set(["TOPS", "BOTTOMS", "DRESSES", "OUTERWEAR"]);

// Returns the grammatically correct form of "to be" for clothing items whose
// names are inherently plural (trousers, jeans, etc.).
function clothingVerb(name: string): "is" | "are" {
  return /\b(trousers|pants|jeans|shorts|leggings|slacks)\b/i.test(name) ? "are" : "is";
}

function categoriesAreWearablePair(catA: string, catB: string): boolean {
  if (!CLOTHING_CATS_FOR_PAIRING.has(catA) || !CLOTHING_CATS_FOR_PAIRING.has(catB)) return true;
  if (catA === catB) return false;
  // DRESSES only pair with OUTERWEAR in these trend directions.
  if (catA === "DRESSES" && catB !== "OUTERWEAR") return false;
  if (catB === "DRESSES" && catA !== "OUTERWEAR") return false;
  return true;
}

// ---------------------------------------------------------------------------
// Garment-compatibility guard (beyond category).
//
// categoriesAreWearablePair only catches a clothing-category clash — any
// ACCESSORIES/BAGS/SHOES item passes through unconditionally regardless of
// what it actually is. That let Colour Direction combine a necktie with a
// half-zip knit sweater (QA: "Cream Half-Zip Knit Sweater + Burgundy Wool
// Tie" — a tie has no collar to knot around) purely because TOPS+ACCESSORIES
// is a legal category pair. It also let Soft Structure/Modern Tailoring
// combine a structured blazer with a bulky-neckline knit (half-zip,
// turtleneck, cable) without accounting for the layering bulk at the collar.
//
// This guard is ANDed with categoriesAreWearablePair at every pairing call
// site. It fails conservatively — a positive match of a known-incompatible
// combination returns false; anything it can't recognize (missing
// subcategory, an item type it has no rule for) passes through unaffected,
// same as the category guard above.
// ---------------------------------------------------------------------------

const NECKWEAR_PATTERN = /\bties?\b|necktie|bow[\s-]?tie|cravat|ascot/i;
const COLLARED_TOP_PATTERN = /\b(shirts?|blouses?|oxford|button[\s-]?(down|up)|popover|polo)\b/i;
const BULKY_KNIT_NECKLINE_PATTERN = /half[\s-]?zip|turtle[\s-]?neck|roll[\s-]?neck|funnel[\s-]?neck|mock[\s-]?neck|cowl[\s-]?neck|chunky|cable[\s-]?knit/i;
const TAILORED_OUTER_PATTERN = /blazer|suit jacket|tailored (jacket|coat)/i;

function isNeckwear(item: ShopperClosetItemEvidence): boolean {
  return NECKWEAR_PATTERN.test(item.subcategory ?? "");
}

function hasCollar(item: ShopperClosetItemEvidence): boolean {
  return COLLARED_TOP_PATTERN.test(item.subcategory ?? "") || COLLARED_TOP_PATTERN.test(item.name ?? "");
}

function isBulkyKnitNeckline(item: ShopperClosetItemEvidence): boolean {
  return BULKY_KNIT_NECKLINE_PATTERN.test(item.subcategory ?? "") || BULKY_KNIT_NECKLINE_PATTERN.test(item.material ?? "");
}

function isStructuredTailoredOuter(item: ShopperClosetItemEvidence): boolean {
  if (item.category !== "OUTERWEAR") return false;
  if (TAILORED_OUTER_PATTERN.test(item.subcategory ?? "") || TAILORED_OUTER_PATTERN.test(item.name ?? "")) return true;
  return item.fitProfile === "tailored" || item.fitProfile === "structured";
}

function garmentsAreCompatiblePair(a: ShopperClosetItemEvidence, b: ShopperClosetItemEvidence): boolean {
  // Neckwear only makes sense against a collared top — a knit, a dress, or
  // an outerwear piece gives it nothing to sit against.
  const neckwear = isNeckwear(a) ? a : isNeckwear(b) ? b : null;
  if (neckwear) {
    const partner = neckwear === a ? b : a;
    if (!hasCollar(partner)) return false;
  }

  // A bulky knit neckline (half-zip, turtleneck, cable, etc.) adds exactly
  // the kind of bulk a tailored blazer's collar/lapel needs to sit flat
  // against — don't recommend the two layered together.
  const tailored = isStructuredTailoredOuter(a) ? a : isStructuredTailoredOuter(b) ? b : null;
  if (tailored) {
    const partner = tailored === a ? b : a;
    if (partner.category === "TOPS" && isBulkyKnitNeckline(partner)) return false;
  }

  return true;
}

// Combined gate used at every pairing call site: category compatibility AND
// garment-level compatibility. Takes the full items (not just effective
// category strings) so the garment-level checks above have what they need.
function itemsAreWearablePair(a: ShopperClosetItemEvidence, b: ShopperClosetItemEvidence, catA: string, catB: string): boolean {
  return categoriesAreWearablePair(catA, catB) && garmentsAreCompatiblePair(a, b);
}

// ---------------------------------------------------------------------------
// Section-specific evidence selection.
//
// Root-cause fix: the old pipeline computed one ranked top-2 array and
// threaded it through every section unchanged. This gives each section its
// own selection job against the same scored pool, so sections genuinely
// differ — and differ for a reason (which trend dimension a piece proves),
// not arbitrary rotation.
// ---------------------------------------------------------------------------

interface DimensionScoredItem {
  item: ShopperClosetItemEvidence;
  score: number;
  dimensionId: string | null;
}

// Your Closet Shows — one item per trend dimension (diversified by what the
// trend itself actually asks for — base vs. accent, tailored vs. relaxed —
// never arbitrary diversity), then fills remaining slots with the next-best
// overall items. A slug with no dimension profile (or a customer whose
// Closet only demonstrates one dimension) still returns the best available
// items — this never forces a weak item in just to hit a count.
function selectClosetShowsItems(
  pool: DimensionScoredItem[],
  slug: string,
  max: number,
): DimensionScoredItem[] {
  const picked: DimensionScoredItem[] = [];
  const used = new Set<ShopperClosetItemEvidence>();

  for (const dimensionId of dimensionIdsForSlug(slug)) {
    if (picked.length >= max) break;
    const best = pool.find((m) => m.dimensionId === dimensionId && !used.has(m.item));
    if (best) {
      picked.push(best);
      used.add(best.item);
    }
  }
  for (const m of pool) {
    if (picked.length >= max) break;
    if (used.has(m.item)) continue;
    picked.push(m);
    used.add(m.item);
  }
  return picked;
}

// Best wearable partner for `anchor` from `pool`, skipping anchor itself and
// anything in `exclude`. Used to give Route In and A Look To Try each their
// own support-piece pick instead of always reusing the #2 overall item.
function pickWearablePartner(
  anchor: DimensionScoredItem,
  pool: DimensionScoredItem[],
  exclude: Set<ShopperClosetItemEvidence>,
  slug: string,
): DimensionScoredItem | null {
  for (const m of pool) {
    if (m.item === anchor.item || exclude.has(m.item)) continue;
    if (itemsAreWearablePair(anchor.item, m.item, getEffectiveCategory(anchor.item, slug), getEffectiveCategory(m.item, slug))) {
      return m;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Role-aware pair selection (Fix #2) + semantic novelty (Fix #4), generalized
// across every trend slug with a two-dimension profile (Colour Direction's
// base-neutral/accent-colour; Modern Tailoring's tailored-anchor/
// relaxed-counterpart; Soft Structure's structured-anchor/soft-flowing).
// Item-ID diversity is not styling diversity: two pairs of blue jeans, or
// two tailored-anchor pieces standing in for "the anchor" and "the
// counterpart", are different Closet rows but the same idea. These helpers
// compare candidates by role + a slug-appropriate "signature" and prefer a
// candidate with a genuinely different signature over a higher-scoring
// near-duplicate, falling back to the near-duplicate only when no
// semantically distinct alternative is actually wearable.
// ---------------------------------------------------------------------------

type RoleSignature = { hueFamily: string | null; category: string; subcategory: string | null };

function itemHueFamily(item: ShopperClosetItemEvidence): string | null {
  const text = item.primaryColor ?? item.colors?.[0] ?? null;
  if (!text) return null;
  return resolveFreeTextColourFamilies(text).hueFamilies[0] ?? null;
}

function roleSignature(item: ShopperClosetItemEvidence, slug: string): RoleSignature {
  return {
    hueFamily: slug === "spring-2026-colour-direction" ? itemHueFamily(item) : null,
    category: getEffectiveCategory(item, slug),
    subcategory: item.subcategory ?? null,
  };
}

// The fields checked, in priority order, when looking for a genuinely
// different idea within the same role. Colour Direction's most meaningful
// axis is hue family (two blue jeans vs. a blue-and-a-burgundy piece);
// Modern Tailoring / Soft Structure have no colour axis, so category then
// subcategory is the meaningful axis (a trouser vs. a skirt, even if both
// are "tailored-anchor").
function distinguishingFields(slug: string): Array<keyof RoleSignature> {
  return slug === "spring-2026-colour-direction" ? ["hueFamily", "category"] : ["category", "subcategory"];
}

function bestOfRole(pool: DimensionScoredItem[], dimensionId: string): DimensionScoredItem | null {
  let best: DimensionScoredItem | null = null;
  for (const m of pool) {
    if (m.dimensionId !== dimensionId) continue;
    if (!best || m.score > best.score) best = m;
  }
  return best;
}

function bestOfCandidates(candidates: DimensionScoredItem[]): DimensionScoredItem | null {
  let best: DimensionScoredItem | null = null;
  for (const m of candidates) {
    if (!best || m.score > best.score) best = m;
  }
  return best;
}

// Picks the best-scoring item from `candidates`, preferring one whose
// signature genuinely differs from every signature in `avoidSignatures` —
// tries each distinguishing field in priority order (most meaningful
// first), only falling back to a same-signature candidate when nothing
// distinct exists at all. A `null` value on the `avoid` side is never
// treated as a constraint (e.g. an achromatic neutral with no hue family,
// or an item with no subcategory) — there's nothing meaningful to avoid.
function pickBestDistinct(
  candidates: DimensionScoredItem[],
  avoidSignatures: RoleSignature[],
  slug: string,
): DimensionScoredItem | null {
  if (candidates.length === 0) return null;
  if (avoidSignatures.length === 0) return bestOfCandidates(candidates);

  for (const field of distinguishingFields(slug)) {
    const distinct = candidates.filter((m) => {
      const sig = roleSignature(m.item, slug);
      return avoidSignatures.every((avoid) => avoid[field] === null || sig[field] !== avoid[field]);
    });
    const best = bestOfCandidates(distinct);
    if (best) return best;
  }

  // No semantically distinct alternative exists; repetition of the same
  // role+signature idea is the Closet's genuine only option.
  return bestOfCandidates(candidates);
}

// Best wearable partner carrying a specific role, preferring one whose
// signature genuinely differs from every signature in `avoidSignatures` —
// only falling back to a same-signature candidate when no distinct one is
// wearable at all. With zero `avoidSignatures` this is a plain "best
// wearable item of this role" pick (Route In's own support, which has
// nothing yet to differ from).
function pickDiverseRoleMatch(
  anchor: DimensionScoredItem,
  pool: DimensionScoredItem[],
  dimensionId: string,
  exclude: Set<ShopperClosetItemEvidence>,
  avoidSignatures: RoleSignature[],
  slug: string,
): DimensionScoredItem | null {
  const candidates = pool.filter((m) =>
    m.item !== anchor.item &&
    !exclude.has(m.item) &&
    m.dimensionId === dimensionId &&
    itemsAreWearablePair(anchor.item, m.item, getEffectiveCategory(anchor.item, slug), getEffectiveCategory(m.item, slug)),
  );
  return pickBestDistinct(candidates, avoidSignatures, slug);
}

// This trend's own anchor+support pick, generalized from each slug's own
// two-dimension profile (dimensionIdsForSlug): anchor is the strongest
// primary-role piece when one exists (falling back to the single
// strongest item overall for a secondary-role-only or evidence-thin
// Closet); support is the strongest wearable genuine secondary-role
// piece — the simplest, most obvious entry, so no novelty preference here,
// only in Look To Try's search relative to this pick.
function selectRoleAwarePair(
  pool: DimensionScoredItem[],
  exclude: Set<ShopperClosetItemEvidence>,
  slug: string,
): { anchor: DimensionScoredItem; support: DimensionScoredItem | null } | null {
  const [primaryRole, secondaryRole] = dimensionIdsForSlug(slug);
  const bestPrimary = primaryRole ? bestOfRole(pool.filter((m) => !exclude.has(m.item)), primaryRole) : null;
  const anchor = bestPrimary ?? pool.find((m) => !exclude.has(m.item)) ?? null;
  if (!anchor) return null;

  const support =
    (secondaryRole ? pickDiverseRoleMatch(anchor, pool, secondaryRole, exclude, [], slug) : null) ??
    pickWearablePartner(anchor, pool, exclude, slug);
  return { anchor, support };
}

// Your Closet Shows for this trend: up to 2 of the strongest primary-role
// pieces interleaved with up to 2 of the strongest secondary-role pieces —
// never padded with a 4th irrelevant same-role item just to hit a count
// when fewer genuinely useful pieces exist (e.g. only one real
// secondary-role item in the whole Closet), and never filling two slots of
// the same role with the same signature idea (two pairs of blue jeans, or
// two tailored-anchor trousers) when a genuinely different one is also
// strong evidence.
function selectRoleAwareClosetShows(
  pool: DimensionScoredItem[],
  slug: string,
  max: number,
): DimensionScoredItem[] {
  const [primaryRole, secondaryRole] = dimensionIdsForSlug(slug);
  const primary = primaryRole ? pool.filter((m) => m.dimensionId === primaryRole).sort((a, b) => b.score - a.score) : [];
  const secondary = secondaryRole ? pool.filter((m) => m.dimensionId === secondaryRole).sort((a, b) => b.score - a.score) : [];
  const picked: DimensionScoredItem[] = [];
  const used = new Set<ShopperClosetItemEvidence>();
  const maxPerRole = Math.ceil(max / 2);

  // Picks the best remaining item in `roleSorted`, preferring one whose
  // signature differs from everything already picked for this role — same
  // tiered fallback as pickDiverseRoleMatch, just over a role's own sorted
  // list instead of a wearable-partner search.
  function pickNextForRole(roleSorted: DimensionScoredItem[], alreadyPicked: DimensionScoredItem[]): DimensionScoredItem | null {
    const remaining = roleSorted.filter((m) => !used.has(m.item));
    const avoidSignatures = alreadyPicked.map((m) => roleSignature(m.item, slug));
    return pickBestDistinct(remaining, avoidSignatures, slug);
  }

  const pickedPrimary: DimensionScoredItem[] = [];
  const pickedSecondary: DimensionScoredItem[] = [];
  for (let i = 0; i < maxPerRole; i++) {
    if (picked.length < max) {
      const next = pickNextForRole(primary, pickedPrimary);
      if (next) {
        picked.push(next);
        used.add(next.item);
        pickedPrimary.push(next);
      }
    }
    if (picked.length < max) {
      const next = pickNextForRole(secondary, pickedSecondary);
      if (next) {
        picked.push(next);
        used.add(next.item);
        pickedSecondary.push(next);
      }
    }
  }

  // Fill any remaining slots with items that qualified on real text-overlap
  // evidence but carry neither named role (dimensionId === null) — real
  // evidence this trend's own two roles don't capture, not padding. This
  // never pulls in a 3rd/4th same-role item once a role's own diverse picks
  // are exhausted — that would reopen the "pad with a near-duplicate"
  // problem Fix #2/#4 closed. A slug still correctly returns fewer than
  // `max` items when no further qualifying evidence of any kind exists.
  if (picked.length < max) {
    const roleless = pool.filter((m) => m.dimensionId === null && !used.has(m.item)).sort((a, b) => b.score - a.score);
    for (const m of roleless) {
      if (picked.length >= max) break;
      picked.push(m);
      used.add(m.item);
    }
  }

  return picked;
}

// ---------------------------------------------------------------------------
// A LOOK TO TRY — an executable outfit formula.
// Always includes: named Closet piece(s) where compatible + complementary category
// or generic recommendation + footwear + occasion context.
// Two named items are combined ONLY when their categories form a sensible wearable pair.
// Incompatible same-category pairs fall back to the strongest single item + generic complement.
// ---------------------------------------------------------------------------

function buildALookToTry(
  namedMatches: DimensionScoredItem[],
  slug: string,
  workCtx: WorkContextLabel,
  passportOnlyLook: string,
  profile: ShopperProfileEvidence | null,
  register: StyleRegister,
): string {
  if (namedMatches.length === 0) {
    return profile
      ? buildPassportLookToTry(profile, workCtx, register, slug, passportOnlyLook)
      : passportOnlyLook;
  }

  const top = namedMatches[0].item;
  const second = namedMatches[1]?.item ?? null;
  const name = top.name!;
  const topRole = namedMatches[0].dimensionId;
  const secondRole = namedMatches[1]?.dimensionId ?? null;

  const ctxClose = (forPair: boolean): string => {
    if (workCtx === "none") return "";
    if (workCtx === "events") return forPair ? " Occasion-ready as it stands." : "";
    if (workCtx === "work-meetings") return " This holds for work or meetings.";
    return " This holds for work, meetings, or events.";
  };

  const topEffCat = getEffectiveCategory(top, slug);
  const secondEffCat = second ? getEffectiveCategory(second, slug) : null;

  // Two named items — only combine if categories are wearable together.
  const pairOk = second && itemsAreWearablePair(top, second, topEffCat, secondEffCat!);

  if (pairOk && second) {
    const secName = second.name!;
    if (slug === "spring-2026-soft-structure") {
      const isLayerPair =
        (top.category === "OUTERWEAR" && second.category === "BOTTOMS") ||
        (top.category === "BOTTOMS" && second.category === "OUTERWEAR");
      const outerName = top.category === "OUTERWEAR" ? name : secName;
      const innerName = top.category === "OUTERWEAR" ? secName : name;
      if (isLayerPair) {
        return `Your ${outerName} open over a simple fine knit, worn with your ${innerName} and a clean flat or loafer. Keep the shoe simple so the proportion carries.${ctxClose(true)}`;
      }
      if (top.category === "DRESSES" && second.category === "OUTERWEAR") {
        return `Your ${name} with your ${secName} worn open above. A clean flat, loafer, or minimal sneaker; no other additions needed.${ctxClose(true)}`;
      }
      return `Your ${name} with your ${secName}. A simple leather shoe or loafer and no further additions — one proportion statement per look.${ctxClose(true)}`;
    }
    if (slug === "modern-tailoring-spring-2026") {
      const hasBottom = top.category === "BOTTOMS" || second.category === "BOTTOMS";
      const hasDress = top.category === "DRESSES" || second.category === "DRESSES";
      if (!hasBottom && !hasDress) {
        return `Your ${name} with your ${secName}, worn with wide-leg denim or a fluid trouser below. A clean flat or loafer; keep everything else — bag, jewellery — minimal so the proportion contrast reads.${ctxClose(true)}`;
      }
      return `Your ${name} with your ${secName}. A clean flat, loafer, or simple leather shoe; keep everything else — bag, jewellery — minimal so the proportion contrast reads.${ctxClose(true)}`;
    }
    if (slug === "spring-2026-colour-direction") {
      // Role-aware (see buildBestRouteIn's colour-direction branch for the
      // same fix, same reason): never label whichever item scored highest
      // "the anchor neutral" without checking it's actually base-neutral —
      // that previously inverted the truth whenever the top item was
      // genuinely the accent.
      const accentItem = topRole === "accent-colour" ? top : (secondRole === "accent-colour" ? second : null);
      const baseItem = topRole === "base-neutral" ? top : (secondRole === "base-neutral" ? second : null);
      if (accentItem && baseItem) {
        return `Your ${baseItem.name!} as the quiet base, with your ${accentItem.name!} as the single clear accent. Keep everything else neutral — one note is the whole method.${ctxClose(true)}`;
      }
      if (accentItem) {
        return `Your ${accentItem.name!} as the single accent — build the rest of the look in cream, stone, or soft white. One note; nothing competing.${ctxClose(true)}`;
      }
      return `Your ${name} as the quiet base. The accent is the missing piece — add one piece in a deliberate colour, whether a bag, shoe, or garment, to complete the look.${ctxClose(true)}`;
    }
  }

  // Incompatible pair or single match — use strongest item + generic complement.
  if (slug === "spring-2026-soft-structure") {
    if (top.category === "OUTERWEAR") {
      return `Your ${name} worn open over a fine knit or simple top, with a fluid wide-leg trouser and a clean flat or loafer. The shape does the work — keep everything underneath quiet.${ctxClose(false)}`;
    }
    if (top.category === "BOTTOMS") {
      return `Your ${name} with a fine knit or simple tucked top above, and a clean flat or loafer. Keep the top contained so the cut at the bottom carries.${ctxClose(false)}`;
    }
    if (top.category === "DRESSES") {
      return `Your ${name} worn alone with a simple leather shoe or loafer. One piece covers the whole direction — no other additions needed.${ctxClose(false)}`;
    }
    return `Your ${name} with a clean wide-leg trouser and a simple flat or loafer. Keep everything above the trouser quieter so the proportion reads.${ctxClose(false)}`;
  }

  if (slug === "modern-tailoring-spring-2026") {
    if (topEffCat === "OUTERWEAR") {
      return `Your ${name} over a relaxed knit or jersey, with wide-leg denim or a fluid skirt and a clean flat or loafer. One structured piece; everything else stays relaxed.${ctxClose(false)}`;
    }
    if (topEffCat === "BOTTOMS") {
      return `Your ${name} with a fine knit or soft jersey above and a clean flat or loafer. The contrast between the two pieces is the complete look.${ctxClose(false)}`;
    }
    return `Your ${name} with a structured jacket or wide-leg trouser as the tailored anchor. A clean flat or loafer; everything else minimal.${ctxClose(false)}`;
  }

  if (slug === "spring-2026-colour-direction") {
    if (topRole === "accent-colour") {
      if (top.category === "BAGS") {
        return `Your ${name} as the accent note — pair with a quiet base of cream trousers and a simple white or ivory top, and a simple flat or loafer. One colour note; everything else neutral.`;
      }
      if (top.category === "SHOES") {
        return `Your ${name} at ground level against a quiet outfit — cream or stone trousers, a fine white knit, and no further colour. One note from the ground up.`;
      }
      return `Your ${name} as the single accent — keep the rest of the outfit in cream, stone, or soft white. One considered note against a quiet ground.`;
    }
    return `Your ${name} as the base — add one clear accent in a single deliberate colour, whether a bag, shoe, top, skirt, or trouser. Keep the rest neutral.`;
  }

  return `Your ${name} with quieter, simpler pieces. A simple flat or loafer; keep accessories minimal.`;
}

// Soft Structure previously had an OUTCOME C override here: its old
// category-only "one-piece" route treated a single qualifying DRESS as
// full coverage on its own, so Look To Try showed that dress worn alone.
// Under the corrected role-based coverage model (see TREND_COVERAGE_CONFIG
// below), a single item carries exactly one role — it can never, by
// itself, prove both ROLE:structured-anchor and ROLE:soft-flowing, so
// "one dress covers everything" is no longer a claim this report can
// honestly make. Outcome C now only fires when the Closet genuinely
// covers both roles, and the default aLookToTry (built from the real
// anchor+support pair) already names those two real pieces directly — no
// override is needed for any slug.

// ---------------------------------------------------------------------------
// YOUR BEST ROUTE IN — named Closet item path or Passport-only path.
// With a qualifying item: name it and give a specific pairing direction.
// Passport-only: the register-specific route from PERSONAL_EDIT_RULES.
// ---------------------------------------------------------------------------

// One-sentence qualification: WHY this item fits the direction.
// Draws from the item's own metadata that was likely in its score hits.
// Purpose: distinguishes Route In (strategy + rationale) from Look To Try (outfit).
function buildItemQualification(item: ShopperClosetItemEvidence, slug: string): string {
  const sub = item.subcategory?.toLowerCase();
  const mat = item.material?.toLowerCase();
  const col = item.primaryColor?.toLowerCase();

  if (slug === "spring-2026-soft-structure") {
    if (sub && !["top", "shirt", "blouse", "tee"].includes(sub)) return `Its ${sub} cut is already the anchor this direction is built on.`;
    if (mat && ["crepe", "viscose", "twill", "linen", "jersey"].some((t) => mat.includes(t))) return `Its ${mat} has enough body to hold the line softly — that is the qualification.`;
    if (col) return `Its ${col} tone sits cleanly, so the proportion carries without the colour competing.`;
  }
  if (slug === "modern-tailoring-spring-2026") {
    if (sub && !["shirt", "tee", "blouse"].includes(sub)) return `Its ${sub} cut is the tailored separates piece this direction is built around.`;
    if (mat && ["twill", "wool", "gabardine", "linen", "denim"].some((t) => mat.includes(t))) return `Its ${mat} holds its structure cleanly — that is what makes it the tailored anchor.`;
    if (col) return `Its ${col} sits as a composed base — the contrast with the relaxed counterpart is where the look lives.`;
  }
  if (slug === "spring-2026-colour-direction") {
    if (col) {
      const isNeutral = ["white","cream","beige","stone","ivory","sand","ecru"].some((t) => col.includes(t));
      const isDark = ["black","navy","charcoal","espresso","brown"].some((t) => col.includes(t));
      if (isNeutral) return `Its ${col} already reads as the quiet base this method requires.`;
      if (isDark) return `Its ${col} works as the anchor neutral — warmer and more grounded than a standard base.`;
      return `Its ${col} is a clear accent candidate — one considered note against a quieter base.`;
    }
  }
  return "";
}

function buildBestRouteIn(
  namedMatches: DimensionScoredItem[],
  slug: string,
  register: StyleRegister,
  rules: PersonalEditRules,
  profile: ShopperProfileEvidence | null,
  workCtx: WorkContextLabel,
): string {
  if (namedMatches.length === 0) {
    return profile
      ? buildPassportRouteIn(profile, register, slug, rules)
      : rules.yourBestRouteIn[register];
  }

  const top = namedMatches[0].item;
  const name = top.name!;
  const second = namedMatches[1]?.item ?? null;

  // Route In = adoption strategy only. Item is named first.
  // No outfit formula here — that belongs in Look To Try.

  if (slug === "spring-2026-soft-structure") {
    if (second) {
      const pairOk = itemsAreWearablePair(top, second, top.category, second.category);
      if (pairOk) {
        const outerwearName = top.category === "OUTERWEAR" ? name : second.name!;
        const otherName = top.category === "OUTERWEAR" ? second.name! : name;
        if (
          (top.category === "OUTERWEAR" && second.category === "BOTTOMS") ||
          (top.category === "BOTTOMS" && second.category === "OUTERWEAR")
        ) {
          return `Your ${outerwearName} is the proportioned anchor for this direction — it establishes the layered silhouette the trend is built around. Your ${otherName} grounds it. The principle is proportion first: keep everything else contained.`;
        }
        return `Your ${name} is the anchor this direction starts from. Your ${second.name!} supports the structure — one piece holds the silhouette while the other softens around it. The method is proportion, not styling detail.`;
      }
      // incompatible pair — use strongest item only
    }
    if (top.category === "OUTERWEAR") {
      return `Your ${name} is the entry point — worn open, it establishes the proportioned, layered silhouette this direction is built around. The shape does the work; the principle is to keep everything underneath simple and contained.`;
    }
    if (top.category === "BOTTOMS") {
      return `Your ${name} ${clothingVerb(name)} the proportioned anchor — that cut is already the kind of grounded, fluid bottom this direction needs. Start there: one clearly proportioned piece, and everything above it quieter.`;
    }
    if (top.category === "DRESSES") {
      return `Your ${name} covers the full direction on its own — one proportioned silhouette without further intervention. The principle is restraint: start and finish here, and keep accessories minimal.`;
    }
    return `Your ${name} is the starting point. The principle here is proportion: pair it with a quieter, simpler piece so the anchor reads clearly before anything else is added.`;
  }

  if (slug === "modern-tailoring-spring-2026") {
    const topEffCat = getEffectiveCategory(top, slug);
    if (second) {
      const pairOk = itemsAreWearablePair(top, second, topEffCat, getEffectiveCategory(second, slug));
      if (pairOk) {
        return `Your ${name} ${clothingVerb(name)} the tailored anchor. Your ${second.name!} ${clothingVerb(second.name!)} the relaxed counterpart. The principle is contrast between the two — the structured piece and the easy piece — not matching formality across the outfit.`;
      }
    }
    if (topEffCat === "OUTERWEAR") {
      return `Your ${name} is the tailored separates anchor this direction is built around. The principle is contrast: one structured piece worn against something relaxed — a knit, a jersey, something without formality. The tailored piece carries the register; the counterpart stays easy.`;
    }
    if (topEffCat === "BOTTOMS") {
      return `Your ${name} ${clothingVerb(name)} the tailored anchor — that cut creates the proportion contrast this direction needs. The counterpart should be relaxed: a fine knit or soft jersey above. The contrast between structured bottom and easy top is the complete styling principle.`;
    }
    return `Your ${name} already gives you the softer, more expressive side of this direction. What is missing is one clean tailored anchor — a blazer, waistcoat, or wide-leg trouser — to create the contrast Modern Tailoring depends on.`;
  }

  if (slug === "spring-2026-colour-direction") {
    // Role-aware (base-neutral vs. accent-colour — scoreItemAttributes'
    // actual dimensionId, never re-derived from category or raw colour
    // text here). Previously this branch called whichever item scored
    // highest overall "your stronger colour move" with no check of which
    // role it actually filled — a pure-neutral item (black, white, beige)
    // could win on base-neutral evidence alone and still get accent framing.
    const topRole = namedMatches[0].dimensionId;
    const secondRole = second ? namedMatches[1]?.dimensionId ?? null : null;

    if (second) {
      const accentItem = topRole === "accent-colour" ? top : (secondRole === "accent-colour" ? second : null);
      const baseItem = topRole === "base-neutral" ? top : (secondRole === "base-neutral" ? second : null);

      if (accentItem && baseItem) {
        return `Your ${accentItem.name!} is the accent — one deliberate colour note against a quiet ground. Your ${baseItem.name!} is the quiet base it sits against. The principle is one considered note, not two competing ones.`;
      }
      if (accentItem) {
        return `Your ${accentItem.name!} is the accent — one deliberate colour note against a quiet ground. The principle is one considered note; keep everything else neutral.`;
      }
      // Neither item carries accent-colour evidence — both are base. Never
      // claim a neutral is "a colour move" just because it scored highest.
      return `Your ${name} is already the quiet base this method needs. The accent is the missing half — one deliberate colour note, whether a bag, shoe, or garment, would complete it.`;
    }

    if (topRole === "accent-colour") {
      if (top.category === "BAGS") {
        return `Your ${name} is the accent piece. The principle is one deliberate colour note against a quiet base — cream, stone, or washed denim in everything else. One note; nothing competing.`;
      }
      if (top.category === "SHOES") {
        return `Your ${name} is the colour note at ground level. The principle is a quiet outfit above — cream, stone, or a fine white knit — so the one note from the ground up reads clearly.`;
      }
      return `Your ${name} is the accent. The principle is one considered note against a quiet ground — cream, stone, or soft white in everything else. Everything else neutral; this is the move.`;
    }
    return `Your ${name} is the quiet base the method is built on. The principle is to add one deliberate colour note — a bag, shoe, top, skirt, or trouser — and keep everything else neutral. The base makes the note land.`;
  }

  return rules.yourBestRouteIn[register];
}

// ---------------------------------------------------------------------------
// Short trend titles
// ---------------------------------------------------------------------------

const TREND_SHORT_TITLES: Record<string, string> = {
  "spring-2026-soft-structure":   "Soft Structure",
  "modern-tailoring-spring-2026": "Modern Tailoring",
  "spring-2026-colour-direction": "Colour Direction",
};

// ---------------------------------------------------------------------------
// Worth Investing In — functional outfit-route coverage.
// A "viable route" is a combination of scored Closet item categories that
// lets the customer actually wear the trend direction. Owning items in a
// compatible category is NOT sufficient — the items must form a complete
// outfit path as defined below.
// ---------------------------------------------------------------------------

type ViableRoute = {
  id: string;
  // Each inner array is an OR group; one item from each group is required.
  // e.g., [["OUTERWEAR"], ["BOTTOMS"]] = one qualifying OUTERWEAR AND one qualifying BOTTOM.
  // e.g., [["BAGS","SHOES","ACCESSORIES"]] = one qualifying item from any of those categories.
  requires: string[][];
};

type OptionalRole = {
  categories: string[];         // what to look for
  appliesToRoutes: string[];    // route ids this gap is relevant to
  investNote: string;           // Outcome B copy (after "you can already wear this…")
};

type TrendCoverageConfig = {
  viableRoutes: ViableRoute[];
  optionalRole: OptionalRole | null;
};

const TREND_COVERAGE_CONFIG: Record<string, TrendCoverageConfig> = {
  // ROLE-based, not category-based (see the ROLE:<dimensionId> tokens
  // assessWorthInvesting adds to scoredCategories for every slug with a
  // dimension profile). Live QA confirmed the category-only version was
  // insufficient: two tailored-anchor pieces (a blazer and a trouser, both
  // scoring on tailored-anchor alone, zero relaxed-counterpart evidence)
  // satisfied BOTH old category routes ("outerwear-anchor" and
  // "trouser-anchor") and produced a false "no purchase needed" — owning
  // items in compatible categories is not the same as owning genuine
  // evidence for both of this method's actual roles.
  "spring-2026-soft-structure": {
    viableRoutes: [
      { id: "structured-and-soft", requires: [["ROLE:structured-anchor"], ["ROLE:soft-flowing"]] },
    ],
    optionalRole: null,
  },
  "modern-tailoring-spring-2026": {
    viableRoutes: [
      { id: "tailored-and-relaxed", requires: [["ROLE:tailored-anchor"], ["ROLE:relaxed-counterpart"]] },
    ],
    optionalRole: null,
  },
  "spring-2026-colour-direction": {
    // ROLE-based, not category-based (see the ROLE:<dimensionId> tokens
    // assessWorthInvesting adds to scoredCategories for this slug). A method
    // is only "covered" when genuine accent-colour evidence exists — not
    // merely any item in an accent-eligible category. A closet of neutral
    // accessories (a black beanie, a neutral tote) must not satisfy
    // "accent-piece" just because the categories happen to match; it has to
    // actually carry accent-colour evidence.
    viableRoutes: [
      // accent piece only: quiet base is assumed from any neutral wardrobe
      { id: "accent-piece",   requires: [["ROLE:accent-colour"]] },
      // genuine base-neutral evidence + genuine accent-colour evidence = complete method
      { id: "base-and-accent", requires: [["ROLE:base-neutral"], ["ROLE:accent-colour"]] },
      // genuine base-neutral evidence alone is also viable (accent via assumed neutrals)
      { id: "base-only",      requires: [["ROLE:base-neutral"]] },
    ],
    optionalRole: {
      // if only base-only route exists, real accent-colour evidence completes the method
      categories: ["ROLE:accent-colour"],
      appliesToRoutes: ["base-only"],
      investNote: "One piece in a clear accent colour — a bag, shoe, or coloured garment — would complete the method: you have the quiet base; this is what activates it.",
    },
  },
};

// Check if a set of scored items satisfies a single viable route.
function routeIsSatisfied(
  route: ViableRoute,
  scoredCategories: Set<string>,
): boolean {
  return route.requires.every((orGroup) =>
    orGroup.some((cat) => scoredCategories.has(cat)),
  );
}

type WorthInvestingResult = {
  worthInvestingStatement: string | null;
  partToTake: string[];
};

function assessWorthInvesting(
  scored: DimensionScoredItem[],
  namedMatches: Array<{ item: ShopperClosetItemEvidence }>,
  slug: string,
  rules: PersonalEditRules,
  colourEvidence: ColourEvidence,
  useNeutralColour: boolean,
): WorthInvestingResult {
  const config = TREND_COVERAGE_CONFIG[slug];

  // Static bullets — base content for Outcomes A and B.
  const staticSource: string[] =
    (useNeutralColour && rules?.partToTakeNeutralColour)
      ? rules.partToTakeNeutralColour
      : (rules?.partToTake ?? []);

  // Colour-matched first bullet swap (Colour Direction only).
  const colourHints = rules?.partToTakeColourHints ?? [];
  let colourMatchedBullet: string | null = null;
  if (!useNeutralColour && colourEvidence.found && colourEvidence.label && colourHints.length > 0) {
    const labelLower = colourEvidence.label.toLowerCase();
    for (const hint of colourHints) {
      if (hint.terms.some((t) => labelLower.includes(t))) {
        colourMatchedBullet = hint.bullet;
        break;
      }
    }
  }
  const staticBullets = colourMatchedBullet
    ? [colourMatchedBullet, ...staticSource.slice(1)].slice(0, 2)
    : staticSource.slice(0, 2);

  // No config or no scored items → Outcome A (full gap).
  if (!config || scored.length === 0) {
    return { worthInvestingStatement: null, partToTake: staticBullets };
  }

  // Coverage must be ROLE-aware, not just category-aware, for every slug
  // with a two-dimension profile — owning a category-compatible item used
  // to be enough to call a role "covered" even with zero genuine evidence
  // for that role (a neutral accessory satisfying Colour Direction's
  // accent category; two tailored-anchor pieces satisfying both of Modern
  // Tailoring's old category routes with zero relaxed-counterpart
  // evidence). Each item's own dimensionId (from scoreItemAttributes —
  // never re-derived here) is added as an additional ROLE:<dimensionId>
  // token alongside its real category, and the viable routes below are
  // defined in terms of those role tokens for these slugs, not raw
  // categories. A slug with no profile falls back to real categories only.
  const scoredCategories = new Set<string>();
  for (const s of scored) {
    scoredCategories.add(getEffectiveCategory(s.item, slug));
    if (dimensionIdsForSlug(slug).length > 0 && s.dimensionId) {
      scoredCategories.add(`ROLE:${s.dimensionId}`);
    }
  }

  const satisfiedRoutes = config.viableRoutes.filter((r) =>
    routeIsSatisfied(r, scoredCategories),
  );

  // Outcome A — no viable route can be formed.
  if (satisfiedRoutes.length === 0) {
    return { worthInvestingStatement: null, partToTake: staticBullets };
  }

  // Outcome B — viable route exists, and an optional role is missing AND applies
  // to at least one of the satisfied routes AND adds real incremental value.
  const opt = config.optionalRole;
  if (opt) {
    const optApplies = satisfiedRoutes.some((r) => opt.appliesToRoutes.includes(r.id));
    // At least one optional category must be absent — covers the multi-category case
    // where "OUTERWEAR or BOTTOMS" is the gap rather than requiring all to be missing.
    const optMissing = opt.categories.some((cat) => !scoredCategories.has(cat));

    if (optApplies && optMissing) {
      const namedPieces = namedMatches.slice(0, 2).map((m) => `your ${m.item.name!}`).join(" and ");
      const prefix = namedPieces
        ? `You can already wear this direction with ${namedPieces}.`
        : "You can already wear this direction with what you own.";
      const outcomeBBullet = `${prefix} If you wanted to extend it: ${opt.investNote}`;
      return {
        worthInvestingStatement: null,
        partToTake: [outcomeBBullet, ...staticBullets.slice(1)].slice(0, 2),
      };
    }
  }

  // Outcome C — adequately covered; no purchase needed.
  const namedPiecesC = namedMatches
    .slice(0, 2)
    .map((m, i) => (i === 0 ? `Your ${m.item.name!}` : `your ${m.item.name!}`))
    .join(" and ");
  const coveredBy = namedPiecesC
    ? `${namedPiecesC} already give${namedMatches.length === 1 ? "s" : ""} you enough to work with for this direction.`
    : "What you already own gives you enough to work with for this direction.";
  return {
    worthInvestingStatement: `You do not need to buy anything for this trend. ${coveredBy}`,
    partToTake: staticBullets,
  };
}

// ---------------------------------------------------------------------------
// Passport-only Route In and Look To Try — personalised when no Closet matches.
// Lookup tables produce lifestyle- and fit-adjusted copy rather than static strings.
// ---------------------------------------------------------------------------

// Per-slug, per-lifestyleId: which garment category to lead with when recommending
// the entry point (no closet evidence). Values slot into the register-based base phrase.
const PASSPORT_ROUTE_LIFESTYLE_LEAD: Partial<Record<string, Partial<Record<string, string>>>> = {
  "spring-2026-soft-structure": {
    "office":      "a wide-leg trouser or longline blazer as your entry — either holds for professional settings without formal weight.",
    "hybrid":      "a wide-leg trouser or longline blazer — both travel across professional and casual settings without further adjustment.",
    "events":      "a fluid midi dress or wide-leg trouser as your entry — either creates the proportioned silhouette this direction is built on.",
    "casual-days": "a wide-leg trouser or draped midi dress — whichever feels most natural to reach for first.",
    "busy-mom":    "one piece with clear proportion — a wide trouser or longline layer — that sets the look without further adjustment.",
    "travel":      "a wide-leg trouser or fluid midi dress — whichever packs the direction most efficiently.",
    "on-the-go":   "one clearly proportioned piece — a wide trouser or longline layer — that works as the complete direction.",
  },
  "modern-tailoring-spring-2026": {
    "office":      "a well-cut blazer or wide-leg trouser as your separates anchor — one tailored piece that holds for professional settings without the rigidity of a matched suit.",
    "hybrid":      "a well-cut blazer or wide-leg trouser — one tailored separates piece that moves between professional and casual contexts.",
    "events":      "a longline blazer or sharply cut trouser as the tailored anchor — one structured piece that holds for occasions without formal suiting.",
    "casual-days": "one tailored piece — a relaxed-fit blazer or wide-leg trouser — worn against something noticeably relaxed.",
    "busy-mom":    "one tailored separates piece — a blazer or wide-leg trouser — that works across your day without needing to be styled differently.",
    "travel":      "a well-cut trouser or longline blazer — one tailored piece that functions across arrival, meetings, and dinner.",
    "on-the-go":   "one well-cut tailored piece — blazer or wide-leg trouser — that carries across the range of what your day requires.",
  },
  "spring-2026-colour-direction": {
    "office":      "one deliberate accent piece — a bag, shoe, or coloured garment — against the neutral base you already wear to professional settings.",
    "hybrid":      "one considered accent piece — a bag, shoe, or coloured garment — that carries across professional and casual contexts without adjustment.",
    "events":      "one clear accent note — a bag, shoe, or garment in a single considered colour — against a quiet base outfit for the occasion.",
    "casual-days": "one accent piece — a bag, shoe, or coloured garment — against the unfussy base you already default to.",
    "busy-mom":    "one considered accent note — a bag, shoe, or coloured garment — that shifts a familiar outfit without adding anything to think about.",
    "travel":      "one accent piece you can move across looks — a bag, shoe, or coloured garment — against the neutral base you already travel in.",
    "on-the-go":   "one accent piece — a bag, shoe, or coloured garment — that activates a familiar outfit without requiring a different approach.",
  },
};

// Per-slug, per-fitPreference: framing supplement for the Passport-only route.
const PASSPORT_ROUTE_FIT_FRAME: Partial<Record<string, Partial<Record<string, string>>>> = {
  "spring-2026-soft-structure": {
    "relaxed-fits":  " You lean toward ease — the wide-leg trouser is the most natural entry because the ease is already in the shape.",
    "structured":    " You respond to clean definition — one clearly proportioned piece, kept simple around it, is where this direction earns its keep.",
    "midi-length":   " Midi lengths are one of the most direct expressions of this direction — the line is already there.",
  },
  "modern-tailoring-spring-2026": {
    "relaxed-fits":  " You respond to ease — which is exactly why one tailored piece against something genuinely relaxed works so well for you.",
    "structured":    " You respond to precision — one well-cut separates piece delivers that more directly than a full tailored set.",
  },
  "spring-2026-colour-direction": {
    "relaxed-fits":  " An unfussy base is already your default — the accent is the only thing that needs to change.",
    "structured":    " A composed, clean base is already in place — the accent has the room it needs to read.",
    "interesting":   " One considered note registers as intentional rather than decorated.",
  },
};

function buildPassportRouteIn(
  profile: ShopperProfileEvidence,
  register: StyleRegister,
  slug: string,
  rules: PersonalEditRules,
): string {
  const lifestyleTable = PASSPORT_ROUTE_LIFESTYLE_LEAD[slug];
  const fitTable = PASSPORT_ROUTE_FIT_FRAME[slug];

  // Find the first matching lifestyle lead.
  let lead = "";
  const lifestyleIds = profile.lifestyle ?? [];
  if (lifestyleTable) {
    for (const id of lifestyleIds) {
      if (lifestyleTable[id]) { lead = lifestyleTable[id]!; break; }
    }
  }

  // Find the first matching fit frame supplement.
  let fitFrame = "";
  if (fitTable) {
    for (const pref of profile.fitPreferences) {
      if (fitTable[pref]) { fitFrame = fitTable[pref]!; break; }
    }
  }

  if (lead) {
    return `Based on your Style Passport, start with ${lead}${fitFrame}`;
  }

  // Fall back to the register-based static string when no lifestyle match.
  return rules.yourBestRouteIn[register];
}

// Per-slug, per-workCtx, per-register: the personalised no-closet look suggestion.
const PASSPORT_LOOK_VARIANTS: Partial<Record<
  string,
  Partial<Record<WorkContextLabel, Partial<Record<StyleRegister, string>>>>
>> = {
  "spring-2026-soft-structure": {
    "work-meetings": {
      "clean-polished": "A wide-leg trouser with a fine knit tucked in, flat or loafer. The trouser carries the proportion — keep everything above it simpler. This holds as-is for work or meetings.",
      "fluid-ease":     "A wide-leg trouser with a soft tucked knit above, flat or loafer. The ease is in the width — keep the top contained so the shape reads. This holds for work or meetings without further adjustment.",
      "expressive":     "A wide-leg trouser with one considered piece above — a fine knit or a clean top with a single detail. Keep everything else plain. This holds for work or meetings.",
      "neutral":        "A wide-leg trouser with a simple fine knit above, flat or loafer. One proportioned piece; everything else calm. This holds for work or meetings.",
    },
    "events": {
      "clean-polished": "A fluid midi dress in a fabric that holds its line — crepe, viscose, or dry-hand jersey. One piece covers the direction. Keep shoe simple and accessories minimal.",
      "fluid-ease":     "A draped midi dress worn alone with a clean flat or loafer. The ease is already in the drape — nothing needs to be added.",
      "expressive":     "A midi dress in a fabric with movement — worn with a single considered accessory. One gesture; everything else quiet.",
      "neutral":        "A fluid midi dress worn alone with a clean shoe. One piece, full direction.",
    },
    "work-meetings-events": {
      "clean-polished": "A longline blazer open over a fine knit with wide-leg trousers, clean flat or loafer. Keep the shoe simple and accessories minimal so the shape carries. This moves from work to evening without adjustment.",
      "fluid-ease":     "Wide-leg trousers with a soft knit and a longline open blazer. The ease is in the bottom; the blazer adds structure above. This range works from meetings to dinner.",
      "expressive":     "A longline blazer open over a fine knit, wide-leg trousers, clean flat or loafer. One composed gesture; everything else quiet. Holds from work to events.",
      "neutral":        "A longline blazer open over a fine knit, wide trousers, simple shoe. One proportioned look that moves across most contexts.",
    },
    "none": {
      "clean-polished": "A longline blazer open over a fine knit with wide-leg trousers. Keep the shoe simple and accessories minimal so the shape carries.",
      "fluid-ease":     "A wide-leg trouser with a soft fine knit above, clean flat or loafer. One proportioned piece; everything around it quieter.",
      "expressive":     "A wide-leg trouser or draped midi dress, paired with a single contained top. One gesture; everything else plain.",
      "neutral":        "A longline blazer open over a fine knit and wide-leg trousers. Keep the shoe simple and accessories minimal so the shape carries.",
    },
  },
  "modern-tailoring-spring-2026": {
    "work-meetings": {
      "clean-polished": "A well-cut blazer over a fine knit, wide-leg trouser, flat or loafer. One tailored piece against one relaxed counterpart — the contrast between them holds for work without the rigidity of a suit.",
      "fluid-ease":     "A wide-leg trouser with a soft jersey or fine knit above, flat or loafer. The relaxed top is the contrast the tailored bottom needs. Holds for work as-is.",
      "expressive":     "A longline blazer over a loose, fluid jersey or oversized knit, wide trouser. One structured piece; the relaxed counterpart is deliberate, not casual. Holds for work.",
      "neutral":        "A tailored wide-leg trouser with a fine knit above, flat or loafer. One structured piece against one relaxed — the contrast is the look. Holds for work.",
    },
    "events": {
      "clean-polished": "A tailored wide-leg trouser with a fine knit or simple silk top, clean heel or simple leather shoe. The tailored bottom carries the occasion register without suiting.",
      "fluid-ease":     "A longline blazer over a fluid trouser or skirt, simple top underneath. The blazer is the tailored note; everything else stays soft.",
      "expressive":     "A waistcoat over a fluid wide-leg trouser or skirt, with a simple top underneath. The waistcoat reads as the considered element; the rest stays relaxed.",
      "neutral":        "A tailored wide-leg trouser with a simple knit above, clean leather shoe. One tailored piece; one relaxed counterpart. The contrast does the work.",
    },
    "work-meetings-events": {
      "clean-polished": "A well-cut blazer over a fine knit, wide-leg trouser, a simple flat, loafer, or low heel. The contrast between the tailored piece and the relaxed knit holds from work to dinner.",
      "fluid-ease":     "A wide-leg tailored trouser with a soft knit or jersey above, flat or loafer. The ease in the top is the contrast the structured bottom needs. Works across professional and evening contexts.",
      "expressive":     "A tailored trouser with a considered top — something relaxed but intentional — flat or loafer. One structured piece; the counterpart is where the expression lives.",
      "neutral":        "A tailored wide-leg trouser with a fine knit above, clean flat or loafer. One piece carries the register; the counterpart keeps it wearable across more contexts.",
    },
    "none": {
      "clean-polished": "A tailored wide-leg trouser with a fine knit above. One structured piece alongside one relaxed counterpart — keep the shoe simple and accessories minimal.",
      "fluid-ease":     "A longline blazer over a relaxed knit or jersey with wide-leg denim or a fluid skirt. One structured piece; everything else stays relaxed.",
      "expressive":     "A tailored trouser with a considered relaxed top — a loose knit or fluid jersey. The proportion contrast between them is the look.",
      "neutral":        "A tailored wide-leg trouser with a fine knit above. One structured piece alongside one relaxed counterpart — keep the shoe simple and accessories minimal.",
    },
  },
  "spring-2026-colour-direction": {
    "work-meetings": {
      "clean-polished": "Cream trousers and a simple tucked knit, with one clear accent — a bag, shoe, or coloured garment. One deliberate note; everything else calm. Holds for professional settings.",
      "fluid-ease":     "Washed denim or a soft neutral trouser with a fine top, plus one accent piece — a bag, shoe, or coloured garment. Unfussy base; one clear note. Holds for work.",
      "expressive":     "A quiet neutral base — cream, stone, or soft white — with one single considered accent note, whether a bag, shoe, or garment. One deliberate choice; everything else calm.",
      "neutral":        "A quiet neutral base with one accent — a bag, shoe, or coloured garment. One note; everything else calm. Holds for professional settings.",
    },
    "events": {
      "clean-polished": "A simple outfit in cream, stone, or soft white — one clean silhouette — with one considered colour note, whether a bag, shoe, or garment. The accent registers more clearly against the restrained base.",
      "fluid-ease":     "A fluid, unfussy outfit in a quiet neutral with one accent, whether a bag, shoe, or coloured garment. The ease is already in the base — the colour does the one thing it needs to.",
      "expressive":     "A quiet base — cream, stone, or washed denim — with one genuinely deliberate accent piece. One note; nothing competing with it.",
      "neutral":        "A quiet base outfit with one clear colour note — a bag, shoe, or coloured garment. One considered choice for the occasion.",
    },
    "work-meetings-events": {
      "clean-polished": "A quiet, clean base — cream, stone, or soft white — worn with one deliberate colour accent, whether a bag, shoe, or garment. The same note carries across professional and evening contexts.",
      "fluid-ease":     "An unfussy neutral base with one accent piece — a bag, shoe, or coloured garment — that moves across professional and evening without adjustment.",
      "expressive":     "One quiet base, one considered accent. The restraint is intentional — one note registers more clearly than several.",
      "neutral":        "A quiet neutral base with one accent piece — a bag, shoe, or coloured garment — introduced consistently. One note; everything else calm.",
    },
    "none": {
      "clean-polished": "Cream trousers and a simple knit, or washed denim with a fine top — add one clear accent, whether a bag, shoe, or garment. One considered note; everything else calm.",
      "fluid-ease":     "An unfussy neutral base — washed denim, cream, or stone — with one accent piece. The ease is already in the base; the colour is the single deliberate move.",
      "expressive":     "A quiet base outfit with one genuinely considered accent note. One piece; one colour; everything else restrained.",
      "neutral":        "Cream trousers and a simple knit, or washed denim with a fine top — add one clear accent, whether a bag, shoe, or garment. One considered note; everything else calm.",
    },
  },
};

function buildPassportLookToTry(
  profile: ShopperProfileEvidence,
  workCtx: WorkContextLabel,
  register: StyleRegister,
  slug: string,
  passportOnlyFallback: string,
): string {
  const slugVariants = PASSPORT_LOOK_VARIANTS[slug];
  if (!slugVariants) return passportOnlyFallback;

  const ctxVariants = slugVariants[workCtx];
  if (!ctxVariants) return passportOnlyFallback;

  const text = ctxVariants[register];
  if (!text) return passportOnlyFallback;

  // Append a fit-preference note when strongly matched.
  const fitTable = PASSPORT_ROUTE_FIT_FRAME[slug];
  if (fitTable) {
    for (const pref of profile.fitPreferences) {
      const frame = fitTable[pref];
      if (frame) return `${text}${frame}`;
    }
  }

  return text;
}

// ---------------------------------------------------------------------------
// CustomerStyleEvidence — internal evidence contract.
// Every source carries an explicit status. Unavailable sources are declared
// as such — they never touch copy or influence output in any form.
// ---------------------------------------------------------------------------

type EvidenceSourceStatus = "available" | "insufficient" | "unavailable";

type EvidenceBlock<T> = {
  status: EvidenceSourceStatus;
  items: T[];
  internalConfidence: "high" | "medium" | "low";
  minimumThreshold: string;
};

type CustomerStyleEvidence = {
  passport:  EvidenceBlock<ShopperProfileEvidence>;
  closet:    EvidenceBlock<ShopperClosetItemEvidence>;
  reviews:   EvidenceBlock<ShopperReviewSignal>;
  wishlist:  EvidenceBlock<never>;
  purchases: EvidenceBlock<never>;
  buySkip:   EvidenceBlock<never>;
  styleMe:   EvidenceBlock<never>;
};

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export type EvidenceClosetItem = {
  name: string;
  imageUrl: string | null;
  // The ClosetItem this item's image was resolved from — null for the rare
  // item with no name (filtered upstream) or for snapshots persisted before
  // this field existed. Lets hydrateShopperEditImages re-resolve a fresh,
  // non-expired image for an item that's still in the Closet at read time,
  // without ever rewriting the stored snapshot itself.
  closetItemId: string | null;
  category: string;
  roleNote: string;
};

export type ShopperEdit = {
  subTitle: string;
  // 1. YOUR VERSION OF THIS TREND — person-specific, evidence-led
  yourVersion: string;
  // 2. YOUR nAia EVIDENCE — only render sub-blocks with genuine data
  evidenceStyleDna: string | null;           // YOUR STYLE DNA SAYS (fit/aspiration + register)
  evidencePassportSays: string | null;       // YOUR PASSPORT SAYS (lifestyle/becoming/aspirations)
  evidenceClosetItems: EvidenceClosetItem[]; // YOUR CLOSET SHOWS (empty = omit block)
  evidenceReviews: string | null;            // YOUR REVIEWS SUGGEST (≥3 reviews + didntWorkTags)
  lowDataNotice: string | null;              // shown when only Style DNA/Passport is available
  // 3. YOUR BEST ROUTE IN — named Closet item path or Passport-only route
  yourBestRouteIn: string;
  // The exact item(s) yourBestRouteIn's prose actually names — renders its
  // own "Already Yours" strip. A subset of evidenceClosetItems, never the
  // same shared array (that was the Already-Yours rendering bug).
  routeInItems: EvidenceClosetItem[];
  // 4. A LOOK TO TRY
  aLookToTry: string;
  // The exact item(s) aLookToTry's prose actually names — its own
  // "Already Yours" strip, independent of routeInItems.
  lookToTryItems: EvidenceClosetItem[];
  // 5. THE BALANCE TO PROTECT — one guardrail
  theBalanceToProtect: string;
  // 6. THE PART TO TAKE — exactly 2 bullets; null when Outcome C (no purchase needed)
  partToTake: string[];
  worthInvestingStatement: string | null; // Outcome C only: replaces bullets with prose
  // Closet categories present in qualifying scored items — used by recommendation layer
  coveredClosetCategories: string[];
  // 7. THE PART TO LEAVE — exactly 2 bullets
  partToLeave: string[];
};

// ---------------------------------------------------------------------------
// buildShopperEdit — deterministic, no AI calls. Every output sentence is
// grounded in either (a) text already in `report`, or (b) values the
// customer provided via Passport/Closet. Nothing is invented.
// ---------------------------------------------------------------------------

export function buildShopperEdit(
  report: TrendReportData,
  evidence: ShopperEvidenceBundle,
): ShopperEdit {
  const slug = report.slug;
  const rules = PERSONAL_EDIT_RULES[slug];
  const shortTitle = TREND_SHORT_TITLES[slug] ?? report.title;

  // Internal evidence contract — unavailable sources declared explicitly
  const passportStatus: EvidenceSourceStatus =
    evidence.profile ? "available" : "insufficient";
  const closetStatus: EvidenceSourceStatus =
    evidence.closetItems.length > 0 ? "available" : "insufficient";
  const reviewStatus: EvidenceSourceStatus =
    evidence.reviewSignal.reviewCount >= 3 ? "available" : "insufficient";

  const styleEvidence: CustomerStyleEvidence = {
    passport: {
      status: passportStatus,
      items: evidence.profile ? [evidence.profile] : [],
      internalConfidence: passportStatus === "available" ? "high" : "low",
      minimumThreshold: "completed Passport with ≥2 usable Style DNA signals",
    },
    closet: {
      status: closetStatus,
      items: evidence.closetItems,
      internalConfidence: evidence.closetItems.length >= 3 ? "high" : "medium",
      minimumThreshold: "at least one named item with non-generic trend-relevant metadata",
    },
    reviews: {
      status: reviewStatus,
      items: reviewStatus === "available" ? [evidence.reviewSignal] : [],
      internalConfidence: reviewStatus === "available" ? "medium" : "low",
      minimumThreshold: "≥3 completed reviews with non-empty didntWorkTags",
    },
    wishlist:  { status: "unavailable", items: [], internalConfidence: "low", minimumThreshold: "wishlist integration pending" },
    purchases: { status: "unavailable", items: [], internalConfidence: "low", minimumThreshold: "purchase history integration pending" },
    buySkip:   { status: "unavailable", items: [], internalConfidence: "low", minimumThreshold: "Buy or Skip integration pending" },
    styleMe:   { status: "unavailable", items: [], internalConfidence: "low", minimumThreshold: "Style Me integration pending" },
  };

  // Extract typed data — unavailable sources never touch copy
  const profile = styleEvidence.passport.items[0] ?? null;
  const closetItemsList = styleEvidence.closet.items;
  const activeReviewSignal = styleEvidence.reviews.items[0] ?? null;

  // Style register — by personality cluster plurality; tie → neutral
  const register: StyleRegister = profile
    ? resolveStyleRegister(profile.stylePersonalities)
    : "neutral";

  // Colour evidence — gates colour-specific copy in colour-direction sections
  const closetMatchText = buildClosetMatchText(report);
  const colourEvidence = buildColourEvidence(profile, closetItemsList, closetMatchText);
  const useNeutralColour = slug === "spring-2026-colour-direction" && !colourEvidence.found;

  // Named closet item scoring — trend-attribute-aware (V1 architecture fix).
  // Root cause this replaces: every item's score used to come ONLY from
  // matching its own terms against one flat blob of this report's editorial
  // copy, with no access to structured Garment Intelligence (silhouette,
  // fitProfile, formality) at all — so two trend reports with similar
  // editorial language scored Closet items near-identically. The qualifying
  // gate now accepts EITHER the original text-overlap signal OR real
  // trend-attribute evidence (scoreItemAttributes), so a well-analyzed item
  // can qualify on structured evidence alone, and an un-analyzed item (no
  // Garment Intelligence yet) still gets a fair chance via the original
  // text-overlap path — neither signal regresses the other.
  const compatibleCategories = SLUG_COMPATIBLE_CATEGORIES[slug] ?? new Set<string>();
  const excludedSubcategories = SUBCATEGORY_EXCLUDE[slug] ?? new Set<string>();

  const scored: DimensionScoredItem[] = [];

  for (const item of closetItemsList) {
    if (!compatibleCategories.has(item.category)) continue;
    if (item.subcategory && excludedSubcategories.has(item.subcategory.toLowerCase())) continue;

    // Meaningful name terms: non-generic tokens only. Generic words (top, shirt,
    // trouser, dress, etc.) appear in every report and prove nothing about whether
    // a specific garment is relevant to this trend direction.
    const meaningfulNameTerms = extractNameTerms(item.name).filter(
      (t) => !GENERIC_NAME_TERMS.has(t.toLowerCase()),
    );

    const qualifyingTerms = [
      item.subcategory,
      item.material,
      item.primaryColor,
      ...item.styleTags,
      ...item.occasions,
      ...meaningfulNameTerms,
    ].filter((t): t is string => Boolean(t));

    const hits = matchedTerms(closetMatchText, qualifyingTerms);
    const attribute = scoreItemAttributes(item, slug);

    // Qualification gate: real evidence from either signal.
    if (hits.length === 0 && attribute.bestScore === 0) continue;

    let score = hits.length + attribute.bestScore;
    if (item.name) score += 3;
    if (item.imageUrl) score += 1;
    scored.push({ item, score, dimensionId: attribute.bestDimensionId });
  }

  scored.sort((a, b) => b.score - a.score);
  const namedScored = scored.filter((m) => m.item.name);

  // Each section now runs its own selection against the same scored pool,
  // instead of every section reading the same fixed top-2 slice. Every slug
  // with a two-dimension profile (dimensionIdsForSlug) gets role-aware pair
  // selection (Fix #2) — the generic "best overall + whatever's wearable
  // with it" logic has no concept of primary vs. secondary role, so a
  // second same-role item (a second neutral accessory, a second
  // tailored-anchor piece) could stand in for the genuine secondary-role
  // evidence that exists elsewhere in the Closet. A slug with no profile
  // (or neither role ever populated) falls back to the original generic
  // selection untouched.
  const [primaryRole, secondaryRole] = dimensionIdsForSlug(slug);
  const hasRoleProfile = Boolean(primaryRole && secondaryRole);

  const closetShowsScored = hasRoleProfile
    ? selectRoleAwareClosetShows(namedScored, slug, 4)
    : selectClosetShowsItems(namedScored, slug, 4);

  const routeInSelection = hasRoleProfile
    ? selectRoleAwarePair(namedScored, new Set(), slug)
    : null;

  const routeInAnchor = hasRoleProfile
    ? (routeInSelection?.anchor ?? null)
    : (namedScored[0] ?? null);
  const routeInSupport = hasRoleProfile
    ? (routeInSelection?.support ?? null)
    : (routeInAnchor ? pickWearablePartner(routeInAnchor, namedScored, new Set(), slug) : null);
  const routeInPair: DimensionScoredItem[] = routeInAnchor
    ? (routeInSupport ? [routeInAnchor, routeInSupport] : [routeInAnchor])
    : [];

  // A Look To Try prefers a DIFFERENT supporting piece from Route In where
  // the Closet supports it; reuse only happens when no other wearable
  // partner exists — intentional, not automatic. "Different" means a
  // genuinely different styling idea — a different hue family/category for
  // Colour Direction, a different category/subcategory for Modern
  // Tailoring / Soft Structure — not merely a different SKU of the same
  // idea (two pairs of blue jeans, two tailored-anchor trousers).
  // pickDiverseRoleMatch's own tiered fallback only repeats Route In's
  // exact signature when nothing semantically distinct is wearable at all.
  const usedByRouteIn = new Set<ShopperClosetItemEvidence>(routeInSupport ? [routeInSupport.item] : []);
  const routeInSupportSignature = routeInSupport ? [roleSignature(routeInSupport.item, slug)] : [];
  const lookSupport = routeInAnchor
    ? (hasRoleProfile && secondaryRole
        ? (pickDiverseRoleMatch(routeInAnchor, namedScored, secondaryRole, usedByRouteIn, routeInSupportSignature, slug)
            ?? pickWearablePartner(routeInAnchor, namedScored, usedByRouteIn, slug)
            ?? routeInSupport)
        : (pickWearablePartner(routeInAnchor, namedScored, usedByRouteIn, slug) ?? routeInSupport))
    : null;
  const lookPair: DimensionScoredItem[] = routeInAnchor
    ? (lookSupport ? [routeInAnchor, lookSupport] : [routeInAnchor])
    : [];

  // Legacy alias — Worth Investing In's prose names "what you can already
  // wear this with", which is Route In's own anchor+support pair (a
  // genuinely wearable combination), not an arbitrary evidence slice.
  const namedMatches = routeInPair;

  // Work/lifestyle context — three-way label, computed once, used across sections
  const lifestyleIds = profile
    ? (profile.lifestyle ?? [])
    : [];
  const workCtx: WorkContextLabel = resolveWorkContext(lifestyleIds);

  // -------------------------------------------------------------------------
  // 1. YOUR VERSION OF THIS TREND
  // Base = register-driven trend decision. Supplement = one Passport signal
  // (fitPreferences first, then aspirations). Never fires without a profile.
  // -------------------------------------------------------------------------
  const versionBase = rules
    ? rules.yourVersionPassport[register]
    : (report.naiaVerdict ?? report.summary);
  const versionSupplement = profile ? pickVersionSupplement(profile, slug) : null;
  // Guard: suppress supplement when it repeats a key phrase already in versionBase.
  // Compares the last 3 words of each sentence to catch near-verbatim repetition.
  const supplementIsRedundant = versionSupplement
    ? versionBase.toLowerCase().split(/[.!?]\s+/).some((sentence) => {
        const baseWords = sentence.trim().split(/\s+/).slice(-4).join(" ").toLowerCase();
        const supWords = versionSupplement.toLowerCase().split(/\s+/).slice(-4).join(" ");
        return baseWords && supWords && baseWords === supWords;
      })
    : false;
  const yourVersion = (versionSupplement && !supplementIsRedundant)
    ? `${versionBase} ${versionSupplement}`
    : versionBase;

  // -------------------------------------------------------------------------
  // 2. YOUR nAia EVIDENCE
  // YOUR STYLE DNA SAYS — requires Passport AND ≥2 usable Style DNA signals.
  // -------------------------------------------------------------------------
  const styleDnaBlock = (rules && profile)
    ? buildStyleDnaBlock(register, rules, profile, slug)
    : null;
  const evidenceStyleDna: string | null = styleDnaBlock?.text ?? null;

  const evidencePassportSays: string | null = (rules && profile)
    ? buildPassportPointsBlock(profile, lifestyleIds, slug)
    : null;

  const toEvidenceClosetItem = ({ item }: DimensionScoredItem): EvidenceClosetItem => ({
    name: item.name!,
    imageUrl: item.imageUrl,
    closetItemId: item.id ?? null,
    category: item.category,
    roleNote: buildEvidenceItemRoleNote(item, slug),
  });

  const evidenceClosetItems: EvidenceClosetItem[] = closetShowsScored.map(toEvidenceClosetItem);
  // Each section's own "Already Yours" strip — the exact items its prose
  // names, never the shared Closet Shows array. Fixes the Already-Yours
  // rendering bug confirmed across all three reports: the prose already
  // varied by section, but the UI had no section-specific array to read.
  const routeInItems: EvidenceClosetItem[] = routeInPair.map(toEvidenceClosetItem);
  const lookToTryItems: EvidenceClosetItem[] = lookPair.map(toEvidenceClosetItem);

  // -------------------------------------------------------------------------
  // 3. YOUR BEST ROUTE IN
  // -------------------------------------------------------------------------
  const yourBestRouteIn = rules
    ? buildBestRouteIn(routeInPair, slug, register, rules, profile, workCtx)
    : (report.wardrobeNote ?? report.summary);

  // -------------------------------------------------------------------------
  // 4. A LOOK TO TRY
  // -------------------------------------------------------------------------
  const passportOnlyLook = rules?.lookToTryPassportOnly
    ?? (report.wardrobeNote ?? report.summary);

  const aLookToTry = buildALookToTry(
    lookPair,
    slug,
    workCtx,
    passportOnlyLook,
    profile,
    register,
  );

  // -------------------------------------------------------------------------
  // 5. THE BALANCE TO PROTECT
  // -------------------------------------------------------------------------
  const theBalanceToProtect = rules
    ? rules.theBalanceToProtect[register]
    : (report.wardrobeNote ?? report.summary);

  // -------------------------------------------------------------------------
  // 6. THE PART TO TAKE — functional coverage determines outcome A/B/C
  // -------------------------------------------------------------------------
  const { worthInvestingStatement, partToTake } = rules
    ? assessWorthInvesting(scored, namedMatches, slug, rules, colourEvidence, useNeutralColour)
    : {
        worthInvestingStatement: null,
        partToTake: report.keyTrends.map((t) => `${t.name}: ${t.description}`).slice(0, 2),
      };

  // -------------------------------------------------------------------------
  // 7. THE PART TO LEAVE — exactly 2 bullets
  // Signal priority:
  //   1. didntWorkTags — incompatibility; candidate vocab match → rises
  //   2. Closet saturation — purchase redundancy; ≥3 items in same sub-niche → rises
  //   3. workedTags — compatibility veto; if candidate vocab matches a worked style,
  //      candidate moves down UNLESS saturation also applies for that style
  //   4. fitPreferences conflict — if candidate warns against a preference the
  //      customer holds, candidate moves down
  // Lifestyle never by itself makes a candidate negative.
  // -------------------------------------------------------------------------
  let partToLeaveOrdered: string[];
  if (rules?.leaveOutCandidates?.length) {
    const candidates = [...rules.leaveOutCandidates];

    // Build signal corpora once.
    const didntCorpus = activeReviewSignal?.didntWorkTags.join(" ") ?? "";
    const workedCorpus = activeReviewSignal?.workedTags.join(" ") ?? "";

    // Closet saturation: count scored items per subcategory and per styleTag.
    const subCatCounts: Record<string, number> = {};
    const styleTagCounts: Record<string, number> = {};
    for (const { item } of scored) {
      if (item.subcategory) subCatCounts[item.subcategory.toLowerCase()] = (subCatCounts[item.subcategory.toLowerCase()] ?? 0) + 1;
      for (const tag of item.styleTags) {
        const t = tag.toLowerCase();
        styleTagCounts[t] = (styleTagCounts[t] ?? 0) + 1;
      }
    }
    const isSaturated = (vocab: string[]): boolean =>
      vocab.some((v) => (subCatCounts[v.toLowerCase()] ?? 0) >= 3 || (styleTagCounts[v.toLowerCase()] ?? 0) >= 3);

    // fitPreferences the customer holds (lowercased for matching).
    const fitPrefs = new Set((profile?.fitPreferences ?? []).map((f) => f.toLowerCase()));

    const withScores = candidates.map((c) => {
      let score = 0;

      // +: didntWorkTags incompatibility evidence
      if (didntCorpus) score += matchedTerms(didntCorpus, c.vocab).length * 3;

      // +: closet saturation — purchase redundancy
      if (isSaturated(c.vocab)) score += 2;

      // −: workedTags compatibility veto (unless saturation overrides)
      if (workedCorpus && matchedTerms(workedCorpus, c.vocab).length > 0 && !isSaturated(c.vocab)) {
        score -= 4;
      }

      // −: candidate warns against a fit preference the customer actually holds
      if (c.vocab.some((v) => fitPrefs.has(v.toLowerCase()))) score -= 2;

      return { c, score };
    });

    withScores.sort((a, b) => b.score - a.score);
    partToLeaveOrdered = withScores.map((s) => s.c.text);
  } else {
    partToLeaveOrdered = (report.fading ?? []).map((f) => f.signal);
  }
  const partToLeave = partToLeaveOrdered.slice(0, 2);

  const evidenceReviews: string | null = (() => {
    if (styleEvidence.reviews.status !== "available") return null;
    if (!activeReviewSignal || activeReviewSignal.didntWorkTags.length === 0) return null;
    const base = REVIEW_EVIDENCE_SENTENCES[slug];
    if (!base) return null;
    const tagSupplements = REVIEW_EVIDENCE_TAG_SUPPLEMENTS[slug] ?? [];
    const tagCorpus = activeReviewSignal.didntWorkTags.join(" ").toLowerCase();
    let supplement = "";
    for (const s of tagSupplements) {
      if (s.vocab.some((v) => tagCorpus.includes(v))) {
        supplement = " " + s.supplement;
        break;
      }
    }
    return base + supplement;
  })();

  const subTitle = `${shortTitle.toUpperCase()}, READ THROUGH YOUR STYLE`;

  const lowDataNotice: string | null = (() => {
    const hasCloset = evidenceClosetItems.length > 0;
    const hasReviews = evidenceReviews !== null;

    // Both closet items and reviews present — no notice needed
    if (hasCloset && hasReviews) return null;

    // Has closet items but no reviews — nudge toward logging post-wear feedback
    if (hasCloset && !hasReviews) {
      return "Tell nAia how it went after you wear a look, and future edits can become more specific about what to hold off on.";
    }

    // No closet items — give a specific next action based on what Passport evidence is available
    if (evidenceStyleDna !== null && evidencePassportSays !== null) {
      return "This edit is based on your Style DNA and Passport. Add 3 pieces from your current wardrobe and nAia will show you which already belong in this direction.";
    }
    if (evidenceStyleDna !== null) {
      return "This edit is built from your Style DNA. Complete your Lifestyle and Goals in Passport and nAia can add context about where and how this direction works for you.";
    }
    if (evidencePassportSays !== null) {
      return "This edit is based on your Passport. Add your Style Personalities to get a sharper reading of how this direction applies to the way you actually dress.";
    }
    return "Complete your Style Passport to unlock your personal read of this direction — your Style DNA and Lifestyle are how nAia builds this edit for you.";
  })();

  // aLookToTry is already built from the real role-aware anchor+support
  // pair (see selectRoleAwarePair above), so it already demonstrates
  // Outcome C's "you can already wear this" with the customer's actual
  // items — no separate override is needed here.
  const finalLookToTry = aLookToTry;

  const coveredClosetCategories = [...new Set(scored.map((s) => getEffectiveCategory(s.item, slug)))];

  return {
    subTitle,
    yourVersion,
    evidenceStyleDna,
    evidencePassportSays,
    evidenceClosetItems,
    evidenceReviews,
    lowDataNotice,
    yourBestRouteIn,
    routeInItems,
    aLookToTry: finalLookToTry,
    lookToTryItems,
    theBalanceToProtect,
    partToTake,
    worthInvestingStatement,
    coveredClosetCategories,
    partToLeave,
  };
}

// ---------------------------------------------------------------------------
// hydrateShopperEditImages — re-resolves a ShopperEdit's Closet images fresh,
// at READ TIME, using the same canonical resolver StyleMe/Overview use
// (resolveItemImage). buildShopperEdit/getShopperEvidence bake a private
// Closet image into a signed URL that expires 10 minutes after it's built
// (buildPrivateDownloadUrl) — fine for the response that just generated it,
// but dead by the time it's read back later: a repeat view this period (the
// snapshotted branch below) or Admin's historical detail view both read a
// persisted snapshot that may be hours or weeks old.
//
// This NEVER rewrites the stored snapshot — only the in-memory ShopperEdit
// object handed to the renderer for this one response. Report text, item
// names, role notes, and scoring are untouched; only which image URL is
// drawn for an item still present in the customer's Closet changes. An item
// deleted from the Closet since generation (or an old snapshot predating
// closetItemId) renders with no image — TrendEditReportBody already omits
// the <img> entirely when imageUrl is null, so this is the same intentional
// "name + note, no broken icon" fallback used everywhere else in Trend Edit.
// ---------------------------------------------------------------------------

export async function hydrateShopperEditImages(
  edit: ShopperEdit,
  customerId: string,
): Promise<ShopperEdit> {
  const ids = new Set<string>();
  for (const item of [...edit.evidenceClosetItems, ...edit.routeInItems, ...edit.lookToTryItems]) {
    if (item.closetItemId) ids.add(item.closetItemId);
  }
  if (ids.size === 0) return edit;

  const rows = await prisma.closetItem.findMany({
    where: { id: { in: [...ids] }, customerId },
    select: { id: true, imageUrl: true, imagePublicId: true, imageFormat: true },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const cloudinaryConfig = getCloudinaryConfig();

  const rehydrate = (item: EvidenceClosetItem): EvidenceClosetItem => {
    if (!item.closetItemId) return item;
    const closetItem = byId.get(item.closetItemId);
    // Deleted since generation — stale baked URL would be broken anyway;
    // null gives the intentional no-image fallback instead.
    if (!closetItem) return { ...item, imageUrl: null };
    return {
      ...item,
      imageUrl: resolveItemImage(
        { closetItemId: item.closetItemId, productImageUrl: null, closetItem },
        { customerId, cloudinaryConfig },
      ),
    };
  };

  return {
    ...edit,
    evidenceClosetItems: edit.evidenceClosetItems.map(rehydrate),
    routeInItems: edit.routeInItems.map(rehydrate),
    lookToTryItems: edit.lookToTryItems.map(rehydrate),
  };
}
