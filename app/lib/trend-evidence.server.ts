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

function workContextPhrase(ctx: WorkContextLabel): string {
  if (ctx === "work-meetings") return "For work or meetings";
  if (ctx === "events") return "For an event";
  if (ctx === "work-meetings-events") return "For work, meetings, or events";
  return "";
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
  // 1. YOUR VERSION OF THIS TREND — Passport-led, by register
  yourVersionPassport: Record<StyleRegister, string>;
  // 2. WHY IT FITS YOUR STYLE — practical Passport translation, by register
  whyItFits: Record<StyleRegister, string>;
  whyItFitsWorkNote?: string;
  whyItFitsEventsNote?: string;
  // 3. THE PART TO TAKE
  partToTake: string[];
  partToTakeNeutralColour?: string[];
  partToTakeWorkNote?: string;
  partToTakeEventsNote?: string;
  // 4. THE PART TO LEAVE
  leaveOutCandidates: LeaveOutCandidate[];
  // 5. YOUR STYLE DNA SAYS — by register
  styleDnaSays: Record<StyleRegister, string>;
  // 6. A LOOK TO TRY — Passport-only fallback when no Closet named match
  lookToTryPassportOnly: string;
};

const PERSONAL_EDIT_RULES: Record<string, PersonalEditRules> = {
  "spring-2026-soft-structure": {
    yourVersionPassport: {
      "clean-polished":
        "Soft Structure is most useful for you through clean, controlled lines — one proportioned anchor worn against quieter pieces. Not heavy tailoring, and not surface detail.",
      "fluid-ease":
        "Soft Structure works best for you close to ease rather than construction — one shaped piece with real proportion, worn against something simple and familiar.",
      "expressive":
        "Soft Structure works best for you when each look has one clear gesture. One shaped anchor; everything else composed around it so the gesture reads without competition.",
      "neutral":
        "Soft Structure is most useful when one clearly proportioned piece changes the register of a quiet outfit without adding stiffness or decoration.",
    },
    whyItFits: {
      "clean-polished":
        "The direction gives you definition without demanding stiffness, excess detail, or formal suiting. The strongest version keeps the base clean, then lets one anchor piece — a wide trouser, a longline layer, a curved shape — carry the interest.",
      "fluid-ease":
        "The direction gives you shape without demanding tightness or construction. One piece with real proportion — a wide leg, a draped midi, a relaxed blazer — is enough to change what an outfit says without changing the ease of how it sits.",
      "expressive":
        "The direction channels one sculptural or proportioned gesture per look. One clearly shaped anchor, with everything else pared back, is the whole formula — the restraint is what makes the gesture read.",
      "neutral":
        "The direction works when one piece with real shape anchors a calm outfit. The proportion of that one piece does the work; nothing else needs to contribute.",
    },
    whyItFitsWorkNote:
      "the anchor piece gives the look definition without overdoing it.",
    whyItFitsEventsNote:
      "one clearly shaped anchor piece is enough — the proportion does what decoration would otherwise attempt.",
    partToTake: [
      "The longline blazer, clean wide-leg trouser, or draped midi — the one anchor that changes proportion without adding stiffness.",
      "Fabric that holds its shape softly: structured crepe, dry-hand twill, or fluid viscose. The material supports the silhouette without pressing it.",
      "One considered gesture per look — a softened shoulder, a wrapped front, or a curved hem. Not two.",
    ],
    partToTakeWorkNote:
      "the anchor piece holds the occasion without overdoing it.",
    partToTakeEventsNote:
      "the anchor piece reads as deliberate rather than overdressed.",
    leaveOutCandidates: [
      {
        text: "Head-to-toe structured suiting — stiffness reads as effort here, not polish.",
        vocab: ["suit", "stiff", "rigid", "suiting"],
      },
      {
        text: "Oversized silhouettes competing in the same outfit — one generous piece works, two compete.",
        vocab: ["oversized", "volume", "balloon", "competing"],
      },
      {
        text: "Embellishment or decorative detail — the impression comes from proportion and fabric, not surface interest.",
        vocab: ["embellish", "decorative", "print", "beading", "detail"],
      },
    ],
    styleDnaSays: {
      "clean-polished":
        "Your style direction points toward clean, composed looks — which makes the proportioned anchor in this direction a natural fit. The structure comes from line and fabric weight, not from construction stiffness.",
      "fluid-ease":
        "Your style direction pulls toward ease and softness — which means the version of this direction that works for you is built around proportion rather than pressing. Wide shapes, flowing fabrics, real line without rigidity.",
      "expressive":
        "Your style direction has room for considered gestures — and this direction uses that instinct precisely. One shaped or proportioned anchor per look, with everything else held back, is what gives the gesture room to read.",
      "neutral":
        "Your style direction favours functional, quiet outfits — which means the anchor piece here should earn its place by working across several combinations without demanding attention. The proportion does the work.",
    },
    lookToTryPassportOnly:
      "A suggested wide-leg trouser or softly structured blazer, worn with a fine knit or clean top. One clear shape; everything else simple.",
  },

  "modern-tailoring-spring-2026": {
    yourVersionPassport: {
      "clean-polished":
        "Modern Tailoring is most useful for you as a separates question, not a matched-set purchase. The update is in how each tailored piece unlocks combinations rather than completing a formal look.",
      "fluid-ease":
        "Modern Tailoring works for you when one well-cut piece provides the structure and everything else can stay relaxed. The contrast between the tailored piece and the softer counterpart is the whole look.",
      "expressive":
        "Modern Tailoring gives you a structured counterpoint — one composed piece that grounds a more expressive look without overriding it. The interest comes from the contrast between the two.",
      "neutral":
        "Modern Tailoring works when one well-cut piece changes the register of a simple outfit. One tailored anchor, worn with something softer, is the full method.",
    },
    whyItFits: {
      "clean-polished":
        "One well-cut trouser or blazer worn as a separates piece — not as part of a matching set — is the update. The investment is in versatility: one piece that works with denim, a skirt, and a simple knit rather than only with its original counterpart.",
      "fluid-ease":
        "Tailoring works here when it stays soft enough to wear beside relaxed pieces. A wide-leg trouser with a fine knit, or a longline blazer over fluid denim — structure and ease in the same look, not in separate wardrobes.",
      "expressive":
        "One tailored piece as the composed anchor in a look that has something more expressive elsewhere. The contrast between the structured piece and the interesting one gives both more effect.",
      "neutral":
        "One tailored piece, worn against something simpler and softer, gives the whole outfit more intentionality without demanding a complicated wardrobe. The proportion contrast between the two pieces does the styling.",
    },
    whyItFitsWorkNote:
      "one tailored piece lifts the look's register without reading as formal.",
    whyItFitsEventsNote:
      "one tailored anchor is what makes the look deliberate rather than dressed-up.",
    partToTake: [
      "One tailored anchor — a blazer, waistcoat, or wide-leg trouser — that functions across at least three separate outfits, not just one.",
      "The proportion contrast: longline against narrow, cropped against wide, waistcoat against relaxed denim. That decision is the styling.",
      "A soft counterpart — a fine knit, a fluid shirt, a draped skirt — that makes the tailored piece wearable rather than severe.",
    ],
    partToTakeWorkNote:
      "a single tailored anchor is all that needs to work harder than the rest.",
    partToTakeEventsNote:
      "one clear tailored piece makes the look deliberate without overdressing it.",
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
        text: "Trousers that only work with heels — the proportion should work across real shoes and real occasions.",
        vocab: ["heels", "formal", "occasion", "restrict"],
      },
    ],
    styleDnaSays: {
      "clean-polished":
        "Your style direction already leans toward clean, structured pieces — which means the update here is in how those pieces work, not in adding new ones. Each tailored piece works as a separates tool rather than as part of a formal set.",
      "fluid-ease":
        "Your style direction pulls toward ease — which means the tailored piece in this direction needs to work beside soft, relaxed counterparts, not instead of them. Structure and ease in the same look.",
      "expressive":
        "Your style direction has a considered, expressive quality that pairs well with one structured anchor. The tailored piece grounds a more interesting look without overriding what makes it distinctive.",
      "neutral":
        "Your style direction favours intentional, functional dressing — one tailored anchor, worn against something softer, achieves that more reliably than most other approaches.",
    },
    lookToTryPassportOnly:
      "A suggested tailored trouser or longline blazer, worn with a soft knit or clean jersey. One structured piece; everything else relaxed.",
  },

  "spring-2026-colour-direction": {
    yourVersionPassport: {
      "clean-polished":
        "Colour Direction is a method for you, not a new palette. Your base pieces — the neutral ones you already reach for — give one clear accent exactly the room it needs to read without competing.",
      "fluid-ease":
        "Colour Direction works best for you through one clear accent positioned against a calm base. The accent should feel like a deliberate choice — one note that changes the mood of an otherwise quiet outfit.",
      "expressive":
        "Colour Direction works for you when the single accent is genuinely intentional — one note that earns its place against a quiet base. One accent registers; two or more cancel each other.",
      "neutral":
        "Colour Direction works when one accent note is introduced against a quiet base. The accent does not need to coordinate with everything — it just needs to interrupt the base without competing with it.",
    },
    whyItFits: {
      "clean-polished":
        "A neutral base is already your default — which is the starting condition for this method. The accent's job is to interrupt the calm, not to complete a colour story. One clear note through a bag, flat, or scarf is the simplest and most reliable entry.",
      "fluid-ease":
        "Soft, unfussy base pieces give colour exactly the room it needs. The method is one clear accent — introduced first through a bag or shoe before committing to a full garment — against the calm ground of what you already wear.",
      "expressive":
        "One accent works; multiple competing notes cancel each other. The restraint here is what gives the single accent its effect — the quiet base is the condition, not a concession.",
      "neutral":
        "One quiet base, one clear accent. The accent's job is to interrupt the base, not to match it. The simplest entry is through a bag, flat, or scarf before committing to a full garment in the accent colour.",
    },
    whyItFitsWorkNote:
      "the accent through a bag or shoe keeps the look composed rather than expressive.",
    whyItFitsEventsNote:
      "one accent through a bag or shoe keeps the look considered rather than overdone.",
    partToTake: [
      "A quiet base that earns its place by working with everything: soft white, cream, stone, espresso, washed denim, or black.",
      "One clear accent, introduced through the lowest-commitment piece first — a bag, flat, or scarf — before committing to a full accent garment.",
      "One strong colour note lands more powerfully than two competing ones.",
    ],
    partToTakeNeutralColour: [
      "A quiet base — a neutral colour already easy to repeat — is the starting condition for this method.",
      "One clear accent, introduced through the lowest-commitment piece first — a bag, flat, or scarf — before committing to a full accent garment.",
      "One strong colour note lands more powerfully than two competing ones.",
    ],
    partToTakeWorkNote:
      "one accent through a bag, flat, or shoe — the most controlled entry before committing to a full garment.",
    partToTakeEventsNote:
      "one accent through a bag or shoe makes the look considered without overdressing.",
    leaveOutCandidates: [
      {
        text: "Several accent pieces in the same seasonal colour — one accent changes the wardrobe; three create a styling problem.",
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
    styleDnaSays: {
      "clean-polished":
        "Your style direction already has a quiet, composed base — which is the starting condition for this method. The accent earns its place against that calm ground; it does not need to complete a look.",
      "fluid-ease":
        "Your style direction pulls toward soft, unfussy pieces — which means the base is already present. The accent is the single change that moves a familiar outfit into a more considered register.",
      "expressive":
        "Your style direction has a considered, creative quality — which means Colour Direction works best when the accent is genuinely intentional. One clear note against a quiet base; the restraint is what makes it register.",
      "neutral":
        "Your style direction favours building reliable combinations — which makes Colour Direction most useful as a single, repeatable accent that works across several existing outfits rather than creating a new colour story.",
    },
    lookToTryPassportOnly:
      "A suggested quiet base — cream, stone, or washed denim — with one clear accent through a bag, flat, or scarf. One considered note; everything else calm.",
  },
};

// ---------------------------------------------------------------------------
// Passport observation maps — fit preferences and aspirations translated to
// report-specific copy. Incorporated into WHY IT FITS (max 2 per report).
// Keys are the stored Passport answer IDs, not raw user language.
// ---------------------------------------------------------------------------

const FIT_SIGNAL_COPY: Partial<Record<string, Partial<Record<string, string>>>> = {
  "spring-2026-soft-structure": {
    "relaxed-fits": "Ease is already in the construction — fluid fabrics and wide proportions carry the silhouette, so nothing needs to feel stiff or pressed.",
    "flowy":        "Ease is already in the construction — fluid fabrics and wide proportions carry the silhouette, so nothing needs to feel stiff or pressed.",
    "structured":   "Your preference for clean lines is a good fit — the useful version here is one clearly structured anchor piece rather than stiffness across the whole look.",
    "midi-length":  "Midi-length proportions are one of the most natural expressions of this direction — the length reinforces the silhouette without additional effort.",
    "loose-tops":   "Fluid or relaxed tops already work within this direction — the anchor comes from the bottom piece or a layer, not from a fitted silhouette.",
    "high-waisted": "Wide-leg and midi shapes in this direction sit naturally against a high waist — the vertical line holds without extra styling.",
  },
  "modern-tailoring-spring-2026": {
    "relaxed-fits": "The direction is compatible with relaxed dressing — the tailored piece carries the look's register; everything else can stay as easy as it needs to.",
    "flowy":        "Fluid counterparts are what make the tailored anchor wearable here — a draped skirt or soft knit against the tailored piece is the whole method, not a compromise.",
    "structured":   "Your preference for clean, defined pieces is a natural fit — the useful version is one precisely shaped tailored anchor rather than full formal suiting.",
    "fitted":       "A narrower counterpart works well against a longline or wide tailored piece — the proportion contrast between them is the editorial decision.",
  },
  "spring-2026-colour-direction": {
    "relaxed-fits": "A calm, fluid base is already the starting condition for this method — the accent works with what you already wear.",
    "structured":   "Clean, composed base pieces give colour exactly the room it needs — the accent reads more clearly against a considered foundation.",
  },
};

const ASPIRATION_SIGNAL_COPY: Partial<Record<string, Partial<Record<string, string>>>> = {
  "spring-2026-soft-structure": {
    "refined":        "The useful version is polished without looking overworked — one clean anchor, with everything else composed around it.",
    "put-together":   "The useful version is polished without looking overworked — one clean anchor, with everything else composed around it.",
    "powerful":       "Use the structure as a source of presence, not formality — proportion and fabric weight do that work better than rigid construction.",
    "confident":      "Use the structure as a source of presence, not formality — proportion and fabric weight do that work better than rigid construction.",
    "effortless":     "The direction reads as deliberate without requiring effort to assemble — one anchor piece does the work.",
    "interesting":    "One sculptural or proportioned gesture registers more than a full editorial statement — the restraint is what makes it read.",
    "creative":       "One sculptural or proportioned gesture registers more than a full editorial statement — the restraint is what makes it read.",
    "elegant":        "The direction reads most clearly when the base stays calm — the anchor earns more when nothing around it competes.",
    "feminine":       "Softened shoulders, fluid mids, and draped fronts keep the direction feeling soft rather than severe.",
  },
  "modern-tailoring-spring-2026": {
    "refined":        "The useful version is composed without effort — one well-cut piece lifts the whole look's register without reading as formal.",
    "put-together":   "The useful version is composed without effort — one well-cut piece lifts the whole look's register without reading as formal.",
    "powerful":       "Use the tailored anchor as a source of quiet authority rather than formal weight — separates rather than a suit.",
    "confident":      "Use the tailored anchor as a source of quiet authority rather than formal weight — separates rather than a suit.",
    "effortless":     "One tailored piece against a relaxed counterpart reads as considered without looking effortful.",
    "interesting":    "The proportion contrast between the tailored piece and its counterpart is where the styling decision lives — no additional effort needed.",
    "creative":       "The proportion contrast between the tailored piece and its counterpart is where the styling decision lives — no additional effort needed.",
  },
  "spring-2026-colour-direction": {
    "interesting":    "One clear accent note against a calm base registers as considered rather than decorated.",
    "creative":       "One clear accent note against a calm base registers as considered rather than decorated.",
    "put-together":   "A quiet base with one deliberate accent reads as composed rather than cautious — the discipline is what makes the intention legible.",
    "effortless":     "Colour through one low-commitment piece — a bag, flat, or scarf — keeps the look intentional without demanding a full re-edit.",
    "elegant":        "The accent reads most elegantly when it interrupts a calm ground — restraint in the base is what gives the colour note its effect.",
  },
};

// Fit preferences whose signal overlaps with the fluid-ease register base paragraph
// (which already covers ease/proportion) — suppress to avoid semantic duplication.
const FIT_SUPPRESS_FOR_FLUID_EASE: Partial<Record<string, Set<string>>> = {
  "spring-2026-soft-structure": new Set(["relaxed-fits", "flowy", "loose-tops"]),
};

// Returns 0–2 Passport-derived observations for WHY IT FITS.
// Draws from fitPreferences first, then aspirational signals.
// Never quotes raw answer text. Never repeats an observation.
function computePassportObservations(
  profile: ShopperProfileEvidence,
  slug: string,
  register: StyleRegister,
): string[] {
  const observations: string[] = [];

  // Fit preference observation (first matching preference wins; at most one).
  // Suppressed when the register's base paragraph already covers the same territory.
  const fitSignals = FIT_SIGNAL_COPY[slug];
  const suppressedPrefs = register === "fluid-ease"
    ? (FIT_SUPPRESS_FOR_FLUID_EASE[slug] ?? new Set<string>())
    : new Set<string>();
  if (fitSignals) {
    for (const pref of profile.fitPreferences) {
      if (suppressedPrefs.has(pref)) continue;
      const obs = fitSignals[pref];
      if (obs) { observations.push(obs); break; }
    }
  }

  // Aspiration observation (desiredFeelings + desiredImpression + becoming)
  if (observations.length < 2) {
    const aspirationSignals = ASPIRATION_SIGNAL_COPY[slug];
    if (aspirationSignals) {
      const ids = [
        ...profile.desiredFeelings,
        ...profile.desiredImpression,
        ...profile.becoming.map(normalizeBecomingId),
      ];
      for (const id of ids) {
        const obs = aspirationSignals[id];
        if (obs && !observations.includes(obs)) { observations.push(obs); break; }
      }
    }
  }

  return observations;
}

// ---------------------------------------------------------------------------
// Style DNA block — evidence-led YOUR STYLE DNA SAYS copy.
// Combines the register-based base with one Passport-grounded supplement drawn
// from the customer's actual fit preferences or aspirations. The internal
// reasons array is NEVER exposed in ShopperEdit — it exists for auditability only.
// ---------------------------------------------------------------------------

const STYLE_DNA_SUPPLEMENT: Partial<Record<string, Partial<Record<string, string>>>> = {
  "spring-2026-soft-structure": {
    "relaxed-fits": "The ease you prefer is not in conflict — the direction is built on proportion rather than pressing.",
    "structured":   "The preference for clean definition translates directly — one precise anchor shape, simply worn.",
    "midi-length":  "The lengths you reach for are already present in this direction — no new silhouette required.",
    "refined":      "One clearly anchored look, composed and held back, is the most deliberate version of this direction.",
    "powerful":     "Presence here comes from proportion and cut — not from effort or excess.",
    "confident":    "Presence here comes from proportion and cut — not from effort or excess.",
    "effortless":   "One piece carries the whole — everything else can stay as simple as needed.",
    "interesting":  "A considered gesture reads more when the rest of the outfit stays composed.",
    "creative":     "A considered gesture reads more when the rest of the outfit stays composed.",
    "elegant":      "Restraint in the base is what gives the anchor piece room to register.",
  },
  "modern-tailoring-spring-2026": {
    "relaxed-fits": "The ease you prefer is what makes the tailored piece work here — the contrast between them is the method.",
    "structured":   "Precision in the tailored piece is exactly what this direction rewards.",
    "refined":      "One well-cut piece, quietly worn, lifts the look without calling attention to itself.",
    "powerful":     "The tailored anchor carries presence without needing formal weight behind it.",
    "confident":    "The tailored anchor carries presence without needing formal weight behind it.",
    "effortless":   "One considered tailored piece against something relaxed achieves exactly the register you're building toward.",
    "interesting":  "The proportion contrast between the tailored piece and its counterpart is where the styling decision lives.",
    "creative":     "The proportion contrast between the tailored piece and its counterpart is where the styling decision lives.",
  },
  "spring-2026-colour-direction": {
    "relaxed-fits": "An unfussy base is the whole starting condition — the accent earns its place against that calm ground.",
    "structured":   "A composed base is exactly what gives a single accent room to read as intentional.",
    "interesting":  "One considered accent note registers as intentional rather than decorated.",
    "creative":     "One considered accent note registers as intentional rather than decorated.",
    "elegant":      "Restraint in the base is what gives the single note its effect.",
    "put-together": "A quiet base with one deliberate note reads as considered rather than cautious.",
    "effortless":   "Colour through one low-commitment piece keeps the look intentional without demanding a full re-edit.",
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

  return {
    text: extra ? `${base} ${extra}` : base,
    reasons,
  };
}

// ---------------------------------------------------------------------------
// Wardrobe gap rules — powers WHAT WOULD MOVE THIS FORWARD
// ---------------------------------------------------------------------------

type ReportAnchorRule = {
  anchorCategory: string;
  requiresCategories: string[];
  suggestion: string;
};

const REPORT_ANCHOR_RULES: Partial<Record<string, ReportAnchorRule[]>> = {
  "spring-2026-soft-structure": [
    {
      anchorCategory: "OUTERWEAR",
      requiresCategories: ["TOPS", "BOTTOMS"],
      suggestion:
        "A longline blazer or structured vest would connect what you already own to the full elongated silhouette this direction is built on.",
    },
  ],
  "modern-tailoring-spring-2026": [
    {
      anchorCategory: "OUTERWEAR",
      requiresCategories: ["BOTTOMS"],
      suggestion:
        "A structured jacket or longline blazer would give your existing bottoms the tailored anchor this direction relies on.",
    },
    {
      anchorCategory: "BOTTOMS",
      requiresCategories: ["OUTERWEAR"],
      suggestion:
        "A tailored wide-leg trouser would make your existing outerwear work as the separates anchor this report points to.",
    },
  ],
};

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
// Named items are exact; all other components are explicitly suggested.
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
      return `Your ${name} as the accent + a suggested quiet base outfit — cream trousers and a simple top, or washed denim and a fine knit. One colour note; everything else calm.`;
    }
    if (top.category === "SHOES") {
      return `Your ${name} at ground level + a suggested quiet base outfit — cream, stone, or washed denim. One note from the ground up; nothing competing.`;
    }
    if (top.category === "ACCESSORIES") {
      return `Your ${name} as the one accent + a suggested quiet base — cream, stone, or soft white. One considered note; everything else calm.`;
    }
    return `Your ${name} as the base + a suggested clear accent bag or flat. Keep the rest neutral so the single accent reads.`;
  }

  if (slug === "spring-2026-soft-structure") {
    if (top.category === "OUTERWEAR") {
      return `Your ${name} worn open + a suggested fine knit underneath + a fluid wide-leg trouser. Keep everything quiet — the shape does the work.${singleNote()}`;
    }
    if (top.category === "BOTTOMS") {
      return `Your ${name} + a suggested fine knit or simple top + a clean flat. Keep the top contained so the cut carries the proportion.${singleNote()}`;
    }
    if (top.category === "DRESSES") {
      return `Your ${name} worn alone + a clean pointed flat or simple shoe. One piece covers the direction.${singleNote()}`;
    }
    return `Your ${name} + a suggested wide-leg tailored trouser or clean structured bottom + a clean pointed shoe.${singleNote()}`;
  }

  if (slug === "modern-tailoring-spring-2026") {
    if (top.category === "OUTERWEAR") {
      return `Your ${name} + a suggested relaxed knit or jersey + suggested wide-leg denim or a fluid skirt. One structured piece; everything else stays relaxed.${singleNote()}`;
    }
    if (top.category === "BOTTOMS") {
      return `Your ${name} + a suggested fine knit or soft jersey + a clean flat. The proportion contrast between the two pieces is the look.${singleNote()}`;
    }
    return `Your ${name} + a suggested tailored trouser + a clean flat. Keep everything else minimal.${singleNote()}`;
  }

  return `Your ${name} + suggested quiet pieces. Keep accessories minimal.`;
}

// ---------------------------------------------------------------------------
// WHAT WOULD MOVE THIS FORWARD — wardrobe gap detection.
// Only fires when Closet evidence exists and a real gap is detected.
// ---------------------------------------------------------------------------

function buildWhatWouldMoveForward(
  closetItems: ShopperClosetItemEvidence[],
  namedMatches: { item: ShopperClosetItemEvidence }[],
  profile: ShopperProfileEvidence | null,
  reportSlug: string,
): string | null {
  if (namedMatches.length === 0) return null;

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
  // 1. YOUR VERSION OF THIS TREND — Passport-led
  yourVersion: string;
  // 2. WHY IT FITS YOUR STYLE — practical Passport translation
  whyItFits: string;
  // 3. THE PART TO TAKE
  partToTake: string[];
  // 4. THE PART TO LEAVE
  partToLeave: string[];
  // 5. YOUR nAia EVIDENCE — only render blocks with genuine data
  evidenceStyleDna: string | null;           // YOUR STYLE DNA SAYS
  evidenceClosetItems: EvidenceClosetItem[]; // YOU ALREADY OWN (empty = omit block)
  // 6. A LOOK TO TRY
  aLookToTry: string;
  // 7. WHAT WOULD MOVE THIS FORWARD — null = omit section
  whatWouldMoveForward: string | null;
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
  // 1. YOUR VERSION OF THIS TREND — Passport-led
  // -------------------------------------------------------------------------
  const yourVersion = rules
    ? rules.yourVersionPassport[register]
    : (report.naiaVerdict ?? report.summary);

  // -------------------------------------------------------------------------
  // 2. WHY IT FITS YOUR STYLE
  // -------------------------------------------------------------------------
  let whyItFits = rules
    ? rules.whyItFits[register]
    : (report.naiaInterpretation ?? report.summary);
  if (rules && workCtx !== "none") {
    const phrase = workContextPhrase(workCtx);
    const note = (workCtx === "events" && rules.whyItFitsEventsNote)
      ? rules.whyItFitsEventsNote
      : rules.whyItFitsWorkNote;
    if (note) whyItFits = `${whyItFits} ${phrase}, ${note}`;
  }
  // Passport observations — 0–2 additional sentences from fitPreferences and
  // aspirational signals. Only fires when signals genuinely map to this report.
  if (profile) {
    const passportObs = computePassportObservations(profile, slug, register);
    if (passportObs.length > 0) {
      whyItFits = `${whyItFits} ${passportObs.join(" ")}`;
    }
  }

  // -------------------------------------------------------------------------
  // 3. THE PART TO TAKE
  // -------------------------------------------------------------------------
  const partToTakeBase: string[] =
    (useNeutralColour && rules?.partToTakeNeutralColour)
      ? [...rules.partToTakeNeutralColour]
      : [...(rules?.partToTake ?? report.keyTrends.map((t) => `${t.name}: ${t.description}`))];
  if (rules && workCtx !== "none") {
    const prefix = workContextPhrase(workCtx);
    const note = (workCtx === "events" && rules.partToTakeEventsNote)
      ? rules.partToTakeEventsNote
      : rules.partToTakeWorkNote;
    if (note) partToTakeBase.push(`${prefix} — ${note}`);
  }
  const partToTake = partToTakeBase;

  // -------------------------------------------------------------------------
  // 4. THE PART TO LEAVE
  // Review signal reorders candidates; never exposes review language or counts.
  // -------------------------------------------------------------------------
  let partToLeave: string[];
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
      partToLeave = withScores.map((s) => s.c.text);
    } else {
      partToLeave = candidates.map((c) => c.text);
    }
  } else {
    partToLeave = (report.fading ?? []).slice(0, 3);
  }

  // -------------------------------------------------------------------------
  // 5. YOUR nAia EVIDENCE
  // -------------------------------------------------------------------------
  // YOUR STYLE DNA SAYS — requires completed Passport AND ≥2 usable Style DNA
  // signals. Prevents the block rendering when the Passport is nominally
  // complete but contains only a single cluster of evidence.
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
  // 6. A LOOK TO TRY
  // -------------------------------------------------------------------------
  const passportOnlyLook = rules?.lookToTryPassportOnly
    ?? `A suggested ${shortTitle.toLowerCase()} starting point: ${rules?.partToTake[0] ?? report.wardrobeNote ?? report.summary}`;

  const aLookToTry = buildALookToTry(
    namedMatches,
    slug,
    workCtx,
    passportOnlyLook,
  );

  // -------------------------------------------------------------------------
  // 7. WHAT WOULD MOVE THIS FORWARD
  // Only fires when Closet evidence exists and a real gap is detected.
  // -------------------------------------------------------------------------
  const whatWouldMoveForward = buildWhatWouldMoveForward(
    closetItemsList,
    namedMatches,
    profile,
    slug,
  );

  const subTitle = `${shortTitle.toUpperCase()}, READ THROUGH YOUR STYLE`;

  return {
    subTitle,
    yourVersion,
    whyItFits,
    partToTake,
    partToLeave,
    evidenceStyleDna,
    evidenceClosetItems,
    aLookToTry,
    whatWouldMoveForward,
  };
}
