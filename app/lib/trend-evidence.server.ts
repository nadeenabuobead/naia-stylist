import prisma from "../db.server";
import type { TrendReportData } from "./trend-reports";

// ---------------------------------------------------------------------------
// Evidence bundle — assembled server-side, scoped to exactly one customer,
// fetched with `select` (never `include`) so only fields this feature
// actually reads ever leave the database. savedLooks removed in Phase C.
// ---------------------------------------------------------------------------

export type ShopperProfileEvidence = {
  stylePersonalities: string[];
  favoriteColors: string[];
  avoidColors: string[];
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
      avoidColors: profile.avoidColors ?? [],
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

const REGISTER_CLUSTER_IDS: Record<Exclude<StyleRegister, "neutral">, string[]> = {
  "clean-polished": ["old-money", "corporate-chic", "minimal", "effortlessly-chic"],
  "fluid-ease":     ["romantic", "casual-cool", "feminine"],
  "expressive":     ["artsy", "edgy", "trendy"],
};

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

function resolveWorkContext(lifestyleIds: string[]): WorkContextLabel {
  const hasOffice = lifestyleIds.some((l) => l === "office" || l === "hybrid");
  const hasEvents = lifestyleIds.includes("events");
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
  "spring-2026-colour-direction": new Set(["TOPS", "BAGS", "SHOES", "ACCESSORIES"]),
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
  // 6. THE PART TO LEAVE — candidates; top 2 shown, reviews may reorder
  leaveOutCandidates: LeaveOutCandidate[];
  // 7. A LOOK TO TRY — Passport-only fallback
  lookToTryPassportOnly: string;
};

const PERSONAL_EDIT_RULES: Record<string, PersonalEditRules> = {
  "spring-2026-soft-structure": {
    yourVersionPassport: {
      "clean-polished":
        "Soft Structure works best for you through one precisely proportioned anchor — a wide trouser, a longline layer, a curved hem — while everything else stays quiet.",
      "fluid-ease":
        "Soft Structure works best for you close to movement rather than construction — one shaped piece that changes what the outfit says without changing how it sits.",
      "expressive":
        "Soft Structure gives you the anchor — one clearly shaped piece that earns all the attention while everything else composes itself around it.",
      "neutral":
        "Soft Structure works when one clearly proportioned piece changes the register of a quiet outfit without adding stiffness or decoration.",
    },
    styleDnaSays: {
      "clean-polished":
        "That is exactly where a proportioned anchor earns its keep — one clean piece, simply worn.",
      "fluid-ease":
        "That is why the version built on proportion rather than pressing is the right one.",
      "expressive":
        "That is the instinct Soft Structure rewards — one gesture, held back by everything around it.",
      "neutral":
        "That is what a single anchor piece, correctly proportioned, delivers without effort.",
    },
    yourBestRouteIn: {
      "clean-polished":
        "Start with one precisely shaped bottom — a clean wide-leg or midi — and keep the top contained. The contrast between the anchor proportion and the quieter top is the complete look.",
      "fluid-ease":
        "Start with one piece that has real proportion — a wide leg, a draped midi, a relaxed blazer — worn against something simple and familiar. The contrast creates the shape.",
      "expressive":
        "Start with one clearly proportioned anchor and build everything else around it in quieter, simpler pieces. The gesture reads when nothing else competes.",
      "neutral":
        "Start with one piece that has a clear, clean proportion — a wide trouser or a longline layer. Keep the surrounding pieces simpler and calmer.",
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
      "One anchor piece — a wide trouser, a longline blazer, or a draped midi — that changes the proportion of the outfit without adding stiffness.",
      "Fabric that holds shape softly: structured crepe, dry-hand twill, or fluid viscose. The material does the work so the cut doesn't have to press.",
    ],
    leaveOutCandidates: [
      {
        text: "Head-to-toe structured suiting — stiffness reads as effort here, not polish.",
        vocab: ["suit", "stiff", "rigid", "suiting"],
      },
      {
        text: "Two oversized or proportioned shapes in the same look — one generous piece works, two compete.",
        vocab: ["oversized", "volume", "balloon", "competing"],
      },
      {
        text: "Surface embellishment — the impression comes from proportion and fabric, not decoration.",
        vocab: ["embellish", "decorative", "print", "beading", "detail"],
      },
    ],
    lookToTryPassportOnly:
      "Build this through one wide-leg trouser or longline blazer and a fine knit or clean top. One clear proportion; everything else simple.",
  },

  "modern-tailoring-spring-2026": {
    yourVersionPassport: {
      "clean-polished":
        "Modern Tailoring works best for you as a separates question — one well-cut piece that unlocks combinations rather than completing a formal look.",
      "fluid-ease":
        "Modern Tailoring works for you when one well-cut piece provides the structure and everything else stays relaxed — the contrast between them is the whole look.",
      "expressive":
        "Modern Tailoring gives you a structured counterpoint — one composed piece that grounds a more expressive look without overriding it.",
      "neutral":
        "Modern Tailoring works when one well-cut piece changes the register of a simple outfit without adding complication.",
    },
    styleDnaSays: {
      "clean-polished":
        "That is where the separates approach earns its place — each piece working across different combinations, not just as part of a set.",
      "fluid-ease":
        "That is why the contrast between the tailored piece and the relaxed counterpart is the whole method.",
      "expressive":
        "That is why one structured piece can ground a more expressive look without flattening it.",
      "neutral":
        "That is why one tailored anchor, worn against something softer, works more reliably than most other approaches.",
    },
    yourBestRouteIn: {
      "clean-polished":
        "Start with one well-cut separates piece — a blazer, waistcoat, or wide-leg trouser — worn against something simple. The tailored piece earns its place by working across at least three different combinations, not just one.",
      "fluid-ease":
        "Start with one tailored piece that can sit beside something relaxed. A wide-leg trouser with a fine knit, or a longline blazer over fluid denim — the contrast between them is the whole look.",
      "expressive":
        "Start with one tailored piece as the composed anchor, positioned against something more fluid or relaxed. The contrast between the two halves creates the effect.",
      "neutral":
        "Start with one well-cut piece worn against something simpler and softer. The proportion contrast between the two pieces does the styling.",
    },
    theBalanceToProtect: {
      "clean-polished":
        "The tailored piece works as a separates tool, not as part of a matched set. A suit in this context reads as a costume rather than a wardrobe investment.",
      "fluid-ease":
        "The tailored piece stays softer than structured suiting. Rigid fabric with no movement reduces the contrast the direction depends on — the anchor should hold its line without pressing.",
      "expressive":
        "The structured piece composes the look; it doesn't complete it. Additional detail on the tailored piece itself competes with the contrast that makes the direction work.",
      "neutral":
        "The tailored piece works against something relaxed. A matched tailored set removes the contrast that makes the direction work — keep the separates approach.",
    },
    partToTake: [
      "One tailored anchor — a blazer, waistcoat, or wide-leg trouser — that functions across at least three separate combinations, not just one.",
      "The proportion contrast: longline against narrow, cropped against wide, structured against relaxed. That decision is the styling.",
    ],
    leaveOutCandidates: [
      {
        text: "A suit worn as a matched set — it reads as a costume rather than a wardrobe investment.",
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
      "Build this through one tailored trouser or longline blazer worn with a soft knit or clean jersey. One structured piece; everything else relaxed.",
  },

  "spring-2026-colour-direction": {
    yourVersionPassport: {
      "clean-polished":
        "Colour Direction works as a method, not a new palette — your composed base gives one clear accent exactly the room it needs to register.",
      "fluid-ease":
        "Colour Direction works through one clear accent positioned against a calm, unfussy base — one note that changes the mood of a familiar outfit.",
      "expressive":
        "Colour Direction works when the single accent is genuinely deliberate — one note that earns its place against a quiet base.",
      "neutral":
        "Colour Direction works through one accent note introduced against a quiet base — it doesn't need to coordinate with everything, only to interrupt it.",
    },
    styleDnaSays: {
      "clean-polished":
        "That is the whole starting condition — the accent earns its place against calm ground you already have.",
      "fluid-ease":
        "That is why the accent reads — the unfussy base is already there.",
      "expressive":
        "That is why one genuinely deliberate accent registers as intentional rather than decorated.",
      "neutral":
        "That is why this method works best as a single, repeatable accent across what you already own.",
    },
    yourBestRouteIn: {
      "clean-polished":
        "Start through the lowest-commitment piece — a bag, flat, or scarf — against a neutral base you already own. One clear note is the complete introduction.",
      "fluid-ease":
        "Start with one clear accent through a bag or flat worn against a calm, unfussy base. The accent reads most clearly when the base is already simple.",
      "expressive":
        "Start with one genuinely intentional accent note against a quiet base. The restraint in the base is what gives the single colour its effect.",
      "neutral":
        "Start with one accent piece against a neutral base. One note is the whole method — it doesn't need to coordinate with everything, only to interrupt the base.",
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
      "One clear accent, introduced through the lowest-commitment piece first — a bag, flat, or scarf — before committing to a full accent garment.",
    ],
    partToTakeNeutralColour: [
      "A quiet base — a neutral colour already easy to repeat — is the starting condition for this method.",
      "One clear accent, introduced through the lowest-commitment piece first — a bag, flat, or scarf — before committing to a full accent garment.",
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
      "Build this through a quiet base — cream, stone, or washed denim — with one clear accent through a bag, flat, or scarf. One considered note; everything else calm.",
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
    "midi-length":  "You consistently reach for lengths that create line rather than interrupt it.",
    "refined":      "You are drawn to composed, held-back looks — one anchor, everything else restrained.",
    "powerful":     "You build presence through proportion and cut, not through volume or decoration.",
    "confident":    "You build presence through proportion and cut, not through volume or decoration.",
    "effortless":   "You reach for looks that feel complete without effort — one piece doing most of the work.",
    "interesting":  "You are drawn to one considered gesture per look rather than layered effects.",
    "creative":     "You are drawn to one considered gesture per look rather than layered effects.",
    "elegant":      "You favour restraint — a calm base that gives one anchor piece room to register.",
  },
  "modern-tailoring-spring-2026": {
    "relaxed-fits": "You respond to ease — which is what makes one tailored piece work so well against a relaxed counterpart.",
    "structured":   "You respond to precision and clean definition — exactly what one well-cut separates piece delivers.",
    "refined":      "You are drawn to composed looks that achieve more with less obvious effort.",
    "powerful":     "You build presence through structure and line, not through volume.",
    "confident":    "You build presence through structure and line, not through volume.",
    "effortless":   "You reach for looks that read as considered without appearing dressed-up.",
    "interesting":  "You are drawn to proportion contrast as the main styling decision.",
    "creative":     "You are drawn to proportion contrast as the main styling decision.",
  },
  "spring-2026-colour-direction": {
    "relaxed-fits": "You reach for unfussy pieces that work together without a formula — which is the whole base for this method.",
    "structured":   "You reach for composed, clean foundations — exactly the condition this method requires.",
    "interesting":  "You are drawn to one considered note per look rather than layered effects.",
    "creative":     "You are drawn to one considered note per look rather than layered effects.",
    "elegant":      "You favour restraint — a calm base that gives a single colour note room to read.",
    "put-together": "You reach for looks that feel finished without appearing overdressed.",
    "effortless":   "You reach for one low-commitment change that makes a familiar look feel different.",
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
    "put-together": "One clean anchor achieves more than most layered approaches.",
    "powerful":     "Presence here comes from proportion and cut, not from formal weight.",
    "confident":    "Presence here comes from proportion and cut, not from formal weight.",
    "interesting":  "One gesture, positioned correctly, reads more than multiple layers of interest.",
    "creative":     "One clearly shaped anchor earns more attention than decoration across the whole look.",
    "feminine":     "Softened proportions and fluid fabrics keep the direction feeling soft rather than constructed.",
    "elegant":      "Restraint in the surrounding pieces is what gives the anchor shape its effect.",
  },
  "modern-tailoring-spring-2026": {
    "relaxed-fits": "The contrast between the tailored piece and the relaxed counterpart is the whole method — not a compromise.",
    "structured":   "One precisely shaped separates piece earns more than a full matched suit.",
    "effortless":   "One tailored piece against something relaxed reads as considered without appearing dressed-up.",
    "refined":      "One well-cut piece lifts the whole look's register without needing anything else to work harder.",
    "put-together": "A single tailored anchor is the most reliable route to a finished look without statement pieces.",
    "powerful":     "The tailored anchor carries quiet authority without formal weight.",
    "confident":    "The tailored anchor carries quiet authority without formal weight.",
    "interesting":  "The proportion contrast between the two pieces is where the styling decision lives.",
    "creative":     "The proportion contrast between the two pieces is where the styling decision lives.",
  },
  "spring-2026-colour-direction": {
    "relaxed-fits": "An unfussy base is already the starting condition — the accent works with what you already wear.",
    "structured":   "A composed base gives one accent exactly the room it needs to register.",
    "effortless":   "Colour through one low-commitment piece — a bag, flat, or scarf — keeps the look intentional without demanding a full re-edit.",
    "put-together": "A quiet base with one deliberate note reads as composed rather than cautious.",
    "interesting":  "One considered colour note registers more than multiple competing accents.",
    "creative":     "One considered colour note registers as intentional rather than decorated.",
    "elegant":      "Restraint in the base is what gives the single note its effect.",
  },
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
// Grounded in item.category and slug only. Never infers from image or AI fields.
// ---------------------------------------------------------------------------

function buildEvidenceItemRoleNote(item: ShopperClosetItemEvidence, slug: string): string {
  if (slug === "spring-2026-soft-structure") {
    const notes: Partial<Record<string, string>> = {
      OUTERWEAR: "The anchor silhouette in this direction. Keep everything underneath simple so the proportion carries.",
      BOTTOMS:   "The structural base. A clean, contained top lets the cut do the work.",
      TOPS:      "A useful starting point for this direction. Pair it with a cleaner, more structured bottom so the top remains the main point of interest.",
      DRESSES:   "One piece covers the whole direction. Add one structured layer only when the occasion needs more presence.",
    };
    return notes[item.category] ?? "A starting point for this direction.";
  }
  if (slug === "modern-tailoring-spring-2026") {
    const notes: Partial<Record<string, string>> = {
      OUTERWEAR: "The tailored anchor. Pair it with something relaxed — a soft knit or fluid trouser — for the separates contrast.",
      BOTTOMS:   "The separates foundation. The styling question is which relaxed counterpart it works against.",
      TOPS:      "The structured element. Pair it against something relaxed — the contrast is the whole method.",
    };
    return notes[item.category] ?? "A starting point for this direction.";
  }
  if (slug === "spring-2026-colour-direction") {
    const notes: Partial<Record<string, string>> = {
      TOPS:        "The potential base or accent in this direction. Position it deliberately and keep the rest of the outfit quiet.",
      BAGS:        "An entry point into this direction at the accessory level. One accent note against a calm base.",
      SHOES:       "The accent note at ground level. Keep the rest of the outfit quiet so one colour reads.",
      ACCESSORIES: "A low-commitment entry into this direction. One considered piece against a quiet base.",
    };
    return notes[item.category] ?? "A starting point for this direction.";
  }
  return "A starting point for this direction.";
}

// ---------------------------------------------------------------------------
// A LOOK TO TRY — combines best available evidence.
// Named items are exact (uses "your"); all other pieces use natural recommendation language.
// ---------------------------------------------------------------------------

function buildALookToTry(
  namedMatches: { item: ShopperClosetItemEvidence }[],
  slug: string,
  workCtx: WorkContextLabel,
  passportOnlyLook: string,
): string {
  if (namedMatches.length === 0) return passportOnlyLook;

  const top = namedMatches[0].item;
  const second = namedMatches[1]?.item ?? null;
  const name = top.name!;

  // Context-appropriate suffix for a pair look
  const pairNote = (): string => {
    if (workCtx === "none") return "";
    if (workCtx === "events") return " For an event, this combination is already there.";
    if (workCtx === "work-meetings") return " This holds for work or meetings as it stands.";
    return " This holds for work, meetings, or events as it stands.";
  };

  // Context-appropriate suffix for a single-item look
  const singleNote = (): string => {
    if (workCtx === "none") return "";
    const phrase =
      workCtx === "events" ? "For the occasion"
      : workCtx === "work-meetings" ? "For work or meetings"
      : "For work, meetings, or events";
    return ` ${phrase}, add an open blazer if needed — keep ${name} as the main point.`;
  };

  if (namedMatches.length >= 2 && second) {
    if (slug === "spring-2026-colour-direction") {
      return `Your ${name} + your ${second.name!}. Position one as the base and one as the accent — keep everything else quiet.`;
    }
    if (slug === "spring-2026-soft-structure") {
      const isLayerPair =
        (top.category === "OUTERWEAR" && second.category === "BOTTOMS") ||
        (top.category === "BOTTOMS" && second.category === "OUTERWEAR");
      if (isLayerPair) {
        const outerwearName = top.category === "OUTERWEAR" ? top.name! : second.name!;
        return `Your ${name} + your ${second.name!}. Wear your ${outerwearName} open over a simple knit or clean top; keep the shoe and accessories restrained.${pairNote()}`;
      }
      return `Your ${name} + your ${second.name!}. One piece anchors the silhouette; the other softens around it.${pairNote()}`;
    }
    return `Your ${name} + your ${second.name!}. The proportion contrast between them is the look — keep everything else minimal.${pairNote()}`;
  }

  if (slug === "spring-2026-colour-direction") {
    if (top.category === "BAGS") {
      return `Your ${name} as the accent — pair it with a quiet base: cream trousers and a simple top, or washed denim and a fine knit. One colour note; everything else calm.`;
    }
    if (top.category === "SHOES") {
      return `Your ${name} at ground level — pair it with a quiet base: cream, stone, or washed denim. One note from the ground up; nothing competing.`;
    }
    if (top.category === "ACCESSORIES") {
      return `Your ${name} as the one accent — keep the base quiet: cream, stone, or soft white. One considered note; everything else calm.`;
    }
    return `Your ${name} as the base — add one clear accent through a bag or flat. Keep the rest neutral so the single accent reads.`;
  }

  if (slug === "spring-2026-soft-structure") {
    if (top.category === "OUTERWEAR") {
      return `Your ${name} worn open — pair with a fine knit underneath and a fluid wide-leg trouser. Keep everything quiet; the shape does the work.${singleNote()}`;
    }
    if (top.category === "BOTTOMS") {
      return `Your ${name} — pair with a fine knit or simple top and a clean flat. Keep the top contained so the cut carries the proportion.${singleNote()}`;
    }
    if (top.category === "DRESSES") {
      return `Your ${name} worn alone with a clean pointed flat or simple shoe. One piece covers the direction.${singleNote()}`;
    }
    return `Your ${name} — pair with a wide-leg tailored trouser or clean structured bottom and a clean pointed shoe.${singleNote()}`;
  }

  if (slug === "modern-tailoring-spring-2026") {
    if (top.category === "OUTERWEAR") {
      return `Your ${name} — pair with a relaxed knit or jersey and wide-leg denim or a fluid skirt. One structured piece; everything else stays relaxed.${singleNote()}`;
    }
    if (top.category === "BOTTOMS") {
      return `Your ${name} — pair with a fine knit or soft jersey and a clean flat. The proportion contrast between the two pieces is the look.${singleNote()}`;
    }
    return `Your ${name} — pair with a tailored trouser and a clean flat. Keep everything else minimal.${singleNote()}`;
  }

  return `Your ${name} — pair with quieter, simpler pieces. Keep accessories minimal.`;
}

// ---------------------------------------------------------------------------
// YOUR BEST ROUTE IN — named Closet item path or Passport-only path.
// With a qualifying item: name it and give a specific pairing direction.
// Passport-only: the register-specific route from PERSONAL_EDIT_RULES.
// ---------------------------------------------------------------------------

function buildBestRouteIn(
  namedMatches: { item: ShopperClosetItemEvidence }[],
  slug: string,
  register: StyleRegister,
  rules: PersonalEditRules,
): string {
  if (namedMatches.length === 0) return rules.yourBestRouteIn[register];

  const top = namedMatches[0].item;
  const name = top.name!;
  const second = namedMatches[1]?.item ?? null;

  if (slug === "spring-2026-soft-structure") {
    if (second) {
      const outerwearName = top.category === "OUTERWEAR" ? name : second.name!;
      const otherName = top.category === "OUTERWEAR" ? second.name! : name;
      if (
        (top.category === "OUTERWEAR" && second.category === "BOTTOMS") ||
        (top.category === "BOTTOMS" && second.category === "OUTERWEAR")
      ) {
        return `Your ${outerwearName} open over a simple knit, worn with your ${otherName}. Keep everything else contained — the proportion pair is already there.`;
      }
      return `Your ${name} + your ${second.name!}. One anchors the silhouette; the other softens around it. Start there before adding anything else.`;
    }
    if (top.category === "OUTERWEAR") {
      return `Your ${name} worn open over a fine knit, with a fluid wide-leg trouser. The shape does the work — keep everything under it quiet.`;
    }
    if (top.category === "BOTTOMS") {
      return `Your ${name} with a fine knit or simple top above. Keep the top contained so the proportion at the bottom carries.`;
    }
    if (top.category === "DRESSES") {
      return `Your ${name} worn on its own with a clean flat. One piece is already the full direction.`;
    }
    return `Your ${name} as the starting point, paired with a quieter, simpler bottom. Let the anchor read first.`;
  }

  if (slug === "modern-tailoring-spring-2026") {
    if (second) {
      return `Your ${name} + your ${second.name!}. The proportion contrast between the two pieces is the look — no further styling needed.`;
    }
    if (top.category === "OUTERWEAR") {
      return `Your ${name} over a relaxed knit or jersey, with wide-leg denim or a fluid skirt. One structured piece — everything else stays relaxed.`;
    }
    if (top.category === "BOTTOMS") {
      return `Your ${name} with a fine knit or soft jersey above. The proportion contrast between them is the look.`;
    }
    return `Your ${name} paired with something simpler and softer. Keep the counterpart relaxed — the tailored piece carries the register.`;
  }

  if (slug === "spring-2026-colour-direction") {
    if (second) {
      return `Your ${name} + your ${second.name!}. Position one as the base and one as the accent — keep everything else quiet.`;
    }
    if (top.category === "BAGS") {
      return `Your ${name} as the accent note against a quiet base — cream, stone, or washed denim. One colour note; everything else calm.`;
    }
    if (top.category === "SHOES") {
      return `Your ${name} at ground level against a quiet base outfit. One note from the ground up; nothing competing.`;
    }
    if (top.category === "ACCESSORIES") {
      return `Your ${name} as the single accent against a quiet base — soft white, cream, or stone. One considered note; everything else calm.`;
    }
    return `Your ${name} as the base, with one clear accent through a bag or flat. Keep the rest neutral so the single accent reads.`;
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
  category: string;
  roleNote: string;
};

export type ShopperEdit = {
  subTitle: string;
  // 1. YOUR VERSION OF THIS TREND — person-specific, evidence-led
  yourVersion: string;
  // 2. YOUR nAia EVIDENCE — only render blocks with genuine data
  evidenceStyleDna: string | null;           // YOUR STYLE DNA SAYS
  evidenceClosetItems: EvidenceClosetItem[]; // YOU ALREADY OWN (empty = omit block)
  // 3. YOUR BEST ROUTE IN — named Closet item path or Passport-only route
  yourBestRouteIn: string;
  // 4. A LOOK TO TRY
  aLookToTry: string;
  // 5. THE BALANCE TO PROTECT — one guardrail
  theBalanceToProtect: string;
  // 6. THE PART TO TAKE — exactly 2 bullets
  partToTake: string[];
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

  // Named closet item scoring
  const compatibleCategories = SLUG_COMPATIBLE_CATEGORIES[slug] ?? new Set<string>();
  const excludedSubcategories = SUBCATEGORY_EXCLUDE[slug] ?? new Set<string>();

  type ScoredItem = { item: ShopperClosetItemEvidence; score: number };
  const scored: ScoredItem[] = [];

  for (const item of closetItemsList) {
    if (!compatibleCategories.has(item.category)) continue;
    if (item.subcategory && excludedSubcategories.has(item.subcategory.toLowerCase())) continue;

    // Meaningful name terms: non-generic tokens only. Generic words (top, shirt,
    // trouser, dress, etc.) appear in every report and prove nothing about whether
    // a specific garment is relevant to this trend direction.
    const meaningfulNameTerms = extractNameTerms(item.name).filter(
      (t) => !GENERIC_NAME_TERMS.has(t.toLowerCase()),
    );

    // Qualification gate: at least one meaningful, non-generic signal must hit.
    const qualifyingTerms = [
      item.subcategory,
      item.material,
      item.primaryColor,
      ...item.styleTags,
      ...item.occasions,
      ...meaningfulNameTerms,
    ].filter((t): t is string => Boolean(t));

    const hits = matchedTerms(closetMatchText, qualifyingTerms);
    if (hits.length === 0) continue;

    let score = hits.length;
    if (item.name) score += 3;
    if (item.imageUrl) score += 1;
    scored.push({ item, score });
  }

  scored.sort((a, b) => b.score - a.score);
  const namedMatches = scored.filter((m) => m.item.name).slice(0, 2);

  // Work/lifestyle context — three-way label, computed once, used across sections
  const lifestyleIds = profile
    ? (profile.lifestyle ?? "").split(",").map((s) => s.trim()).filter(Boolean)
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
  const yourVersion = versionSupplement ? `${versionBase} ${versionSupplement}` : versionBase;

  // -------------------------------------------------------------------------
  // 2. YOUR nAia EVIDENCE
  // YOUR STYLE DNA SAYS — requires Passport AND ≥2 usable Style DNA signals.
  // -------------------------------------------------------------------------
  const styleDnaBlock = (rules && profile)
    ? buildStyleDnaBlock(register, rules, profile, slug)
    : null;
  const evidenceStyleDna: string | null = styleDnaBlock?.text ?? null;

  const evidenceClosetItems: EvidenceClosetItem[] = namedMatches.map(({ item }) => ({
    name: item.name!,
    imageUrl: item.imageUrl,
    category: item.category,
    roleNote: buildEvidenceItemRoleNote(item, slug),
  }));

  // -------------------------------------------------------------------------
  // 3. YOUR BEST ROUTE IN
  // -------------------------------------------------------------------------
  const yourBestRouteIn = rules
    ? buildBestRouteIn(namedMatches, slug, register, rules)
    : (report.wardrobeNote ?? report.summary);

  // -------------------------------------------------------------------------
  // 4. A LOOK TO TRY
  // -------------------------------------------------------------------------
  const passportOnlyLook = rules?.lookToTryPassportOnly
    ?? (report.wardrobeNote ?? report.summary);

  const aLookToTry = buildALookToTry(
    namedMatches,
    slug,
    workCtx,
    passportOnlyLook,
  );

  // -------------------------------------------------------------------------
  // 5. THE BALANCE TO PROTECT
  // -------------------------------------------------------------------------
  const theBalanceToProtect = rules
    ? rules.theBalanceToProtect[register]
    : (report.wardrobeNote ?? report.summary);

  // -------------------------------------------------------------------------
  // 6. THE PART TO TAKE — exactly 2 bullets
  // -------------------------------------------------------------------------
  const partToTakeSource: string[] =
    (useNeutralColour && rules?.partToTakeNeutralColour)
      ? rules.partToTakeNeutralColour
      : (rules?.partToTake ?? report.keyTrends.map((t) => `${t.name}: ${t.description}`));
  const partToTake = partToTakeSource.slice(0, 2);

  // -------------------------------------------------------------------------
  // 7. THE PART TO LEAVE — exactly 2 bullets
  // Review signal reorders candidates; never exposes review language or counts.
  // -------------------------------------------------------------------------
  let partToLeaveOrdered: string[];
  if (rules?.leaveOutCandidates?.length) {
    const candidates = [...rules.leaveOutCandidates];
    if (
      styleEvidence.reviews.status === "available" &&
      activeReviewSignal !== null &&
      activeReviewSignal.didntWorkTags.length > 0
    ) {
      const tagCorpus = activeReviewSignal.didntWorkTags.join(" ");
      const withScores = candidates.map((c) => ({
        c,
        score: matchedTerms(tagCorpus, c.vocab).length,
      }));
      withScores.sort((a, b) => b.score - a.score);
      partToLeaveOrdered = withScores.map((s) => s.c.text);
    } else {
      partToLeaveOrdered = candidates.map((c) => c.text);
    }
  } else {
    partToLeaveOrdered = (report.fading ?? []);
  }
  const partToLeave = partToLeaveOrdered.slice(0, 2);

  const subTitle = `${shortTitle.toUpperCase()}, READ THROUGH YOUR STYLE`;

  return {
    subTitle,
    yourVersion,
    evidenceStyleDna,
    evidenceClosetItems,
    yourBestRouteIn,
    aLookToTry,
    theBalanceToProtect,
    partToTake,
    partToLeave,
  };
}
