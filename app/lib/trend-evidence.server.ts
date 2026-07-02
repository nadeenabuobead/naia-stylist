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

// `becoming` stores ids like "more-confident"; ASPIRATION_STYLE_MAP is keyed
// by "confident". Strip the "more-" prefix before lookup.
function normalizeBecomingId(id: string): string {
  return id.startsWith("more-") ? id.slice(5) : id;
}
// Retained for future aspiration-signal lookups.
void normalizeBecomingId;

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

function buildColourEvidence(
  profile: ShopperProfileEvidence | null,
  closetItems: ShopperClosetItemEvidence[],
  closetMatchText: string,
): ColourEvidence {
  // Path 1: favorite colors vs closetMatchText
  if (profile) {
    for (const colorId of profile.favoriteColors) {
      const entry = COLOR_SEARCH_MAP[colorId];
      if (!entry) continue;
      if (matchedTerms(closetMatchText, entry.terms).length > 0) {
        return { found: true, label: entry.label };
      }
    }
  }
  // Path 2: closet item primaryColor vs closetMatchText
  for (const item of closetItems) {
    if (!item.primaryColor) continue;
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
  verdictOpener: string;
  verdictOpenerNeutral?: string;
  verdictFitClose: Record<StyleRegister, string>;
  verdictLifestyleOptional: string | null;
  verdictLifestyleOptionalEvents?: string;
  takeWithYou: string[];
  takeWithYouNeutral?: string[];
  takeWithYouWorkContext?: string;
  leaveOutCandidates: LeaveOutCandidate[];
  pairNote: string;
  entryPoint: string;
  oneThingToWatch: Record<StyleRegister, string>;
};

const PERSONAL_EDIT_RULES: Record<string, PersonalEditRules> = {
  "spring-2026-soft-structure": {
    verdictOpener:
      "Soft Structure builds presence through cut and proportion rather than stiffness or decoration. The direction works best when one clearly shaped anchor — a longline blazer, wide-leg trouser, or draped midi — carries the silhouette while the pieces around it stay calm.",
    verdictFitClose: {
      "clean-polished":
        "Soft Structure is strongest here when it stays clean and fluid rather than reading as full tailoring. Keep one clear line through the blazer or trouser, then let the rest of the outfit soften around it.",
      "fluid-ease":
        "Keep the fluid element as contrast rather than replacing the cleaner line that holds the look together. One structured anchor against something that moves is the whole formula.",
      "expressive":
        "One sculptural gesture per look is the limit — it reads because everything around it stays composed. Two gestures cancel each other.",
      "neutral":
        "One anchor piece with real proportion, worn against something familiar, is the whole method.",
    },
    verdictLifestyleOptional:
      "For work, meetings, or events, this gives presence without looking overdone.",
    takeWithYou: [
      "The longline blazer, clean wide-leg trouser, or draped midi — the anchor that changes proportion without adding stiffness.",
      "Fabric that earns its place: structured crepe or dry-hand twill to hold, fluid viscose or washed linen to move.",
      "One considered gesture per outfit — a softened shoulder, wrapped front, or curved hem. Not two.",
    ],
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
    pairNote: "One piece anchors the silhouette; the other softens around it — keep everything else simple.",
    takeWithYouWorkContext: "For work, meetings, or events — the anchor piece holds the occasion without overdoing it.",
    entryPoint: "A softly structured blazer, fluid trouser, and fine knit or clean top.",
    oneThingToWatch: {
      "clean-polished":
        "Stiffness reads as effort here. Choose fabric with enough body to hold the shoulder without pressing — the structure comes from proportion, not from rigidity.",
      "fluid-ease":
        "One structured element and one fluid element is the formula. Fluid throughout loses the silhouette line that makes the direction legible.",
      "expressive":
        "Two gestures cancel each other. One defined element with everything else composed is the limit — the restraint is what makes the gesture read.",
      "neutral":
        "The structure here comes from proportion and fabric weight, not from construction stiffness. One element carries the silhouette; the rest can be quiet.",
    },
  },

  "modern-tailoring-spring-2026": {
    verdictOpener:
      "Modern tailoring works when one well-cut piece changes the register of everything around it. It is most useful when treated as a separates question — which one tailored anchor, worn with a softer counterpart, gives the look clarity without reading as formal.",
    verdictFitClose: {
      "clean-polished":
        "The pieces are already there — the update is treating each tailored piece as a separates tool rather than part of a matched set. One blazer or trouser should unlock at least three different combinations.",
      "fluid-ease":
        "Here, structure means a clear silhouette, not stiff construction — every other piece can stay as relaxed as needed. The contrast between the tailored anchor and the softer counterpart is the whole look.",
      "expressive":
        "Use one tailored piece as the composed counterpart to something more expressive. The contrast is the look — not the tailored piece alone.",
      "neutral":
        "One tailored anchor, worn with something softer, is the whole method. The proportion contrast between the two pieces does the styling.",
    },
    verdictLifestyleOptional:
      "For work or events, one tailored piece lifts the whole look's register without reading as formal.",
    takeWithYou: [
      "One tailored anchor — a blazer, waistcoat, or wide-leg trouser — that functions across at least three separate outfits.",
      "The proportion contrast: longline against narrow, cropped against wide, waistcoat against relaxed denim. That decision is the styling.",
      "A soft counterpart — a fine knit, draped skirt, slip dress, or fluid shirt — that makes the tailored piece wearable rather than severe.",
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
        text: "Trousers that only work with heels — the proportion should work across real shoes and real occasions.",
        vocab: ["heels", "formal", "occasion", "restrict"],
      },
    ],
    pairNote: "The proportion contrast between them is the styling decision — keep everything else minimal.",
    takeWithYouWorkContext: "For work or events — a single tailored anchor is all that needs to work harder than the rest.",
    entryPoint: "Tailored trousers with a soft shirt, knit, or clean jersey top.",
    oneThingToWatch: {
      "clean-polished":
        "The update is versatility, not formality. A tailored piece that only functions as part of its original set — or only reads at work — is not the investment. It needs to work with denim, a skirt, and a slip.",
      "fluid-ease":
        "One tailored piece is the anchor; the rest can stay relaxed. Two tailored pieces in one look tip toward uniform territory.",
      "expressive":
        "Keep the expressive element in one place — the tailored piece or the counterpart, not both. The contrast between them is what creates the look.",
      "neutral":
        "The tailored piece should function independently across at least three different combinations. If it only works with one counterpart, it is a costume, not a wardrobe tool.",
    },
  },

  "spring-2026-colour-direction": {
    verdictOpener:
      "Colour Direction is a method, not a palette. It works best when a quiet base — soft white, cream, stone, espresso, washed denim, or black — gives one clear accent room to read. The discipline is choosing one accent that earns its place across several existing outfits rather than one that only works in a single context.",
    verdictOpenerNeutral:
      "Colour Direction is a method, not a palette. It works best when a quiet base — a quiet base colour already easy to repeat — gives one clear accent room to read. The discipline is choosing one accent that earns its place across several existing outfits rather than one that only works in a single context.",
    verdictFitClose: {
      "clean-polished":
        "A neutral wardrobe base is the starting condition for this method — the accent does all its work against that base. The quieter the base, the more clearly the accent reads.",
      "fluid-ease":
        "Soft, unfussy pieces make the best base — the accent does all its work against the calm ground. The next step is one clear accent that changes the mood without competing.",
      "expressive":
        "One accent works here; two competing ones cancel each other. The quiet base is what gives the single accent room to read as intentional rather than accidental.",
      "neutral":
        "One quiet base, one clear accent — the accent's job is to interrupt the base, not to match it. Over-coordination erases the effect.",
    },
    verdictLifestyleOptional:
      "For work or meetings, the accent through a bag or shoe keeps the look composed rather than expressive.",
    verdictLifestyleOptionalEvents:
      "For an event, one accent through a bag or shoe keeps the look composed rather than overdone.",
    takeWithYou: [
      "A quiet base that earns its place by working with everything: soft white, cream, stone, espresso, washed denim, or black.",
      "One clear accent, introduced through the lowest-commitment piece first — a bag, flat, or shoe — before committing to a full accent garment.",
      "One strong colour note lands more powerfully than two competing ones.",
    ],
    takeWithYouNeutral: [
      "A quiet base — a quiet base colour already easy to repeat — is the starting condition for this method.",
      "One clear accent, introduced through the lowest-commitment piece first — a bag, flat, or shoe — before committing to a full accent garment.",
      "One strong colour note lands more powerfully than two competing ones.",
    ],
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
    pairNote: "The accent comes through the smaller piece — a bag, flat, or scarf keeps it intentional.",
    takeWithYouWorkContext: "One accent through a bag, flat, or shoe — the most controlled entry before committing to a full garment.",
    entryPoint: "A calm base with colour through a bag, shoe, scarf, or fine knit.",
    oneThingToWatch: {
      "clean-polished":
        "The accent's effect depends on the base staying quiet. Over-coordination between base and accent removes the contrast that makes colour intentional.",
      "fluid-ease":
        "One accent, positioned deliberately — through a bag, flat, or scarf before committing to a full garment. The quiet base does its work by staying in the background.",
      "expressive":
        "Two competing colour notes cancel each other. The method is one accent against a quiet base — the restraint is what gives the accent its effect.",
      "neutral":
        "The accent does not need to coordinate with anything except the base. Avoid matching the accent to other colours in the outfit — that erases the point.",
    },
  },
};

// ---------------------------------------------------------------------------
// Closet item outfit note
// ---------------------------------------------------------------------------

function buildClosetItemNote(
  item: ShopperClosetItemEvidence,
  pairName: string | null,
): string {
  if (pairName) {
    const paired: Partial<Record<string, string>> = {
      OUTERWEAR: `Layer it over ${pairName} for the proportion story this direction is built on.`,
      BOTTOMS:   `Wear it with ${pairName} for the separates formula this report points to.`,
      TOPS:      `Pair with ${pairName} for the season's separates approach.`,
    };
    return paired[item.category] ?? `Pairs with ${pairName} for the look this direction points to.`;
  }

  const solo: Partial<Record<string, string>> = {
    OUTERWEAR:   "Wear it open over something simple. The proportion does the work.",
    BOTTOMS:     "The silhouette anchor. Keep the top quiet and let the cut speak.",
    DRESSES:     "One piece covers the whole direction. Add one structured layer if the occasion needs it.",
    TOPS:        "Works best against a more structured or tailored bottom.",
    BAGS:        "Reinforces the direction at the accessory level — no new pieces needed.",
    SHOES:       "Grounds the look at the ankle. A clean silhouette here does the most.",
    ACCESSORIES: "One way into this direction without committing to new pieces.",
  };

  return solo[item.category] ?? "A natural starting point for this direction.";
}

// ---------------------------------------------------------------------------
// One unlock piece — missing anchor category recommendation
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

function buildNamedEntryPoint(
  top: ShopperClosetItemEvidence,
  second: ShopperClosetItemEvidence | null,
  slug: string,
): string {
  if (slug === "spring-2026-colour-direction") {
    if (second) {
      return `Start with your ${top.name!}. Introduce colour through the ${second.name!} — one clear accent against a quiet base.`;
    }
    return `Start with your ${top.name!}. Introduce colour through one accessory — a bag, flat, or scarf — and keep the rest of the outfit quiet.`;
  }

  if (top.category === "OUTERWEAR") {
    if (second && second.category === "BOTTOMS") {
      return `Start with your ${top.name!}. Wear it open over the ${second.name!} with a simple knit or clean top underneath.`;
    }
    if (second && second.category === "TOPS") {
      return `Start with your ${top.name!}. Layer it over the ${second.name!} — the proportions do the work.`;
    }
    return `Start with your ${top.name!}. Wear it open over something simple — the proportion does the work.`;
  }

  if (top.category === "BOTTOMS") {
    if (second && second.category === "OUTERWEAR") {
      return `Start with your ${top.name!}. Wear it with the ${second.name!} layered open — one clear line through the outfit.`;
    }
    if (second) {
      return `Start with your ${top.name!}. Wear it with the ${second.name!} and keep everything else quiet.`;
    }
    return `Start with your ${top.name!}. Keep the top quiet — a fine knit or clean jersey is enough to let the cut read.`;
  }

  if (top.category === "DRESSES") {
    return `Start with your ${top.name!}. One piece covers the direction — add one structured layer only if the occasion needs it.`;
  }

  if (top.category === "TOPS") {
    if (second) {
      return `Start with your ${top.name!}. Pair it with the ${second.name!} for the separates approach this report points to.`;
    }
    return `Start with your ${top.name!}. Pair it with a tailored trouser or structured bottom and keep everything else quiet.`;
  }

  if (second) {
    return `Start with your ${top.name!}. Pair it with the ${second.name!} and keep the rest of the outfit simple.`;
  }
  return `Start with your ${top.name!}. Introduce it against a quiet base and keep the rest of the outfit calm.`;
}

function buildTwoItemFormula(
  nameA: string,
  nameB: string,
  catA: string,
  catB: string,
  slug: string,
): string {
  if (slug === "spring-2026-colour-direction") {
    return `${nameA} + ${nameB} + a quiet base = one clear accent.`;
  }

  const hasOuterwear = catA === "OUTERWEAR" || catB === "OUTERWEAR";
  const hasBottoms   = catA === "BOTTOMS"   || catB === "BOTTOMS";
  const hasTops      = catA === "TOPS"      || catB === "TOPS";

  let tertiary: string;
  let outcome: string;

  if (slug === "spring-2026-soft-structure") {
    if (hasOuterwear && hasBottoms && !hasTops) {
      tertiary = "a simple top";
      outcome  = "quiet presence";
    } else if (hasOuterwear && hasTops && !hasBottoms) {
      tertiary = "the right trouser";
      outcome  = "the full silhouette";
    } else {
      tertiary = "one quiet counterpart";
      outcome  = "the anchor the direction needs";
    }
  } else {
    // modern-tailoring-spring-2026
    if (hasOuterwear && hasBottoms && !hasTops) {
      tertiary = "a simple top";
      outcome  = "the separates formula";
    } else if (hasOuterwear && hasTops && !hasBottoms) {
      tertiary = "a tailored trouser";
      outcome  = "the proportion contrast";
    } else if (hasBottoms && hasTops && !hasOuterwear) {
      tertiary = "one tailored layer";
      outcome  = "the full separates look";
    } else {
      tertiary = "one soft counterpart";
      outcome  = "the proportion contrast";
    }
  }

  return `${nameA} + ${nameB} + ${tertiary} = ${outcome}.`;
}

// ---------------------------------------------------------------------------
// Short trend titles for sub-title field
// ---------------------------------------------------------------------------

const TREND_SHORT_TITLES: Record<string, string> = {
  "spring-2026-soft-structure":   "Soft Structure",
  "modern-tailoring-spring-2026": "Modern Tailoring",
  "spring-2026-colour-direction": "Colour Direction",
};

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
  subTitle: string;
  verdict: string;
  takeWithYou: string[];
  leaveOut: string[];
  bestEntryPoint: string;
  oneLookToTry: string;
  oneThingToWatch: string;
  fromCloset: ClosetMatchItem[];
  fromClosetInsufficient: boolean;
  oneUnlockPiece: string | null;
  theOneFormula: string;
};

// ---------------------------------------------------------------------------
// buildShopperEdit — deterministic, no AI calls. Every output sentence is
// grounded in either (a) text already present in `report`, or (b) values
// the customer themselves provided via Passport/Closet. Nothing is invented.
// ---------------------------------------------------------------------------

export function buildShopperEdit(
  report: TrendReportData,
  evidence: ShopperEvidenceBundle,
): ShopperEdit {
  const profile = evidence.profile;
  const slug = report.slug;
  const closetMatchText = buildClosetMatchText(report);
  const rules = PERSONAL_EDIT_RULES[slug];

  // Style register — by evidence count; tie → neutral
  const register: StyleRegister = profile
    ? resolveStyleRegister(profile.stylePersonalities)
    : "neutral";

  // Colour evidence (gates colour-specific copy in colour-direction sections)
  const colourEvidence = buildColourEvidence(profile, evidence.closetItems, closetMatchText);
  const useNeutralColour = slug === "spring-2026-colour-direction" && !colourEvidence.found;

  // -------------------------------------------------------------------------
  // Named closet cards — correction 2: candidateTerms excludes
  // CLOSET_CATEGORY_MAP terms so a generic item cannot qualify merely because
  // it belongs to a compatible category.
  // -------------------------------------------------------------------------
  const compatibleCategories = SLUG_COMPATIBLE_CATEGORIES[slug] ?? new Set<string>();
  const excludedSubcategories = SUBCATEGORY_EXCLUDE[slug] ?? new Set<string>();

  type ScoredItem = { item: ShopperClosetItemEvidence; score: number };
  const scored: ScoredItem[] = [];

  for (const item of evidence.closetItems) {
    // Gate 1: category must be in the compatible set for this slug
    if (!compatibleCategories.has(item.category)) continue;
    // Gate 2: subcategory must not be excluded
    if (item.subcategory && excludedSubcategories.has(item.subcategory.toLowerCase())) continue;

    // candidateTerms: concrete item metadata only — no category-map terms
    const candidateTerms = [
      item.subcategory,
      item.material,
      item.primaryColor,
      ...item.styleTags,
      ...item.occasions,
      ...extractNameTerms(item.name),
    ].filter((t): t is string => Boolean(t));

    const hits = matchedTerms(closetMatchText, candidateTerms);
    if (hits.length === 0) continue;

    let score = hits.length;
    if (item.name) score += 3;
    if (item.imageUrl) score += 1;
    scored.push({ item, score });
  }

  scored.sort((a, b) => b.score - a.score);
  const namedMatches = scored.filter((m) => m.item.name).slice(0, 2);
  const hasCloset = evidence.closetItems.length > 0;

  // -------------------------------------------------------------------------
  // Work-context lifestyle gate — computed once, used in both verdict and
  // takeWithYou sections so the condition fires consistently.
  // -------------------------------------------------------------------------
  const workContextLifestyles = new Set(["office", "hybrid", "events", "on-the-go", "travel"]);
  const lifestyleIdsForOptional = profile
    ? (profile.lifestyle ?? "").split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  const firedWorkContextIds = lifestyleIdsForOptional.filter((l) => workContextLifestyles.has(l));
  const workContextFired = firedWorkContextIds.length > 0;
  const workContextIsEvents = workContextFired && firedWorkContextIds.every((l) => l === "events");

  // -------------------------------------------------------------------------
  // Section 1 — YOUR EDITORIAL VERDICT
  // -------------------------------------------------------------------------
  let verdict: string;
  if (rules) {
    const opener = (useNeutralColour && rules.verdictOpenerNeutral)
      ? rules.verdictOpenerNeutral
      : rules.verdictOpener;
    const parts: string[] = [opener, rules.verdictFitClose[register]];

    if (rules.verdictLifestyleOptional && workContextFired) {
      const optionalText = (workContextIsEvents && rules.verdictLifestyleOptionalEvents)
        ? rules.verdictLifestyleOptionalEvents
        : rules.verdictLifestyleOptional;
      parts.push(optionalText);
    }

    verdict = parts.join(" ");
  } else {
    verdict = report.naiaVerdict ?? report.naiaInterpretation ?? report.summary;
  }

  // -------------------------------------------------------------------------
  // Section 2 — TAKE WITH YOU
  // -------------------------------------------------------------------------
  const takeWithYouBase: string[] =
    (useNeutralColour && rules?.takeWithYouNeutral)
      ? [...rules.takeWithYouNeutral]
      : [...(rules?.takeWithYou ?? report.keyTrends.map((t) => `${t.name}: ${t.description}`))];
  if (workContextFired && rules?.takeWithYouWorkContext) {
    takeWithYouBase.push(rules.takeWithYouWorkContext);
  }
  const takeWithYou = takeWithYouBase;

  // -------------------------------------------------------------------------
  // Section 3 — LEAVE OUT (correction 1: all 3 bullets always shown;
  // review evidence reorders by vocab match, never exposes review language)
  // -------------------------------------------------------------------------
  let leaveOut: string[];
  if (rules?.leaveOutCandidates?.length) {
    const candidates = [...rules.leaveOutCandidates];
    if (
      evidence.reviewSignal.reviewCount >= 3 &&
      evidence.reviewSignal.didntWorkTags.length > 0
    ) {
      const tagCorpus = evidence.reviewSignal.didntWorkTags.join(" ");
      const withScores = candidates.map((c) => ({
        c,
        score: matchedTerms(tagCorpus, c.vocab).length,
      }));
      withScores.sort((a, b) => b.score - a.score);
      leaveOut = withScores.map((s) => s.c.text);
    } else {
      leaveOut = candidates.map((c) => c.text);
    }
  } else {
    leaveOut = (report.fading ?? []).slice(0, 3);
  }

  // -------------------------------------------------------------------------
  // Section 4 — YOUR BEST ENTRY POINT
  // ≥1 named match: lead with that item directly.
  // 0 named matches: lifestyle-matched report direction, colour-evidence
  // personalisation, or report-level entry point.
  // -------------------------------------------------------------------------
  let bestEntryPoint: string;
  if (namedMatches.length >= 1) {
    bestEntryPoint = buildNamedEntryPoint(
      namedMatches[0].item,
      namedMatches[1]?.item ?? null,
      slug,
    );
  } else if (useNeutralColour) {
    bestEntryPoint = rules?.entryPoint ?? (report.howToWear ?? [])[0]?.direction ?? report.summary;
  } else {
    const lifestyleIds = profile
      ? (profile.lifestyle ?? "").split(",").map((s) => s.trim()).filter(Boolean)
      : [];
    let found: string | null = null;
    for (const lid of lifestyleIds) {
      const priority = LIFESTYLE_HOWTO_MAP[lid];
      if (!priority) continue;
      const match = (report.howToWear ?? []).find((h) => priority.includes(h.feeling));
      if (match) { found = match.direction; break; }
    }

    if (
      !found &&
      slug === "spring-2026-colour-direction" &&
      colourEvidence.found &&
      colourEvidence.label
    ) {
      found = `${colourEvidence.label} pieces can already serve as the quiet base — introduce colour through one accent: a bag, flat, scarf, or fine knit.`;
    }

    bestEntryPoint = found ?? rules?.entryPoint ?? (report.howToWear ?? [])[0]?.direction ?? report.summary;
  }

  // -------------------------------------------------------------------------
  // Section 5 — ONE LOOK TO TRY (correction 5)
  // ≥2 named matches: exact items + one styling instruction.
  // <2 named matches: "A suggested formula: [entry point]" — no closet implied.
  // -------------------------------------------------------------------------
  let oneLookToTry: string;
  if (namedMatches.length >= 2) {
    const a = namedMatches[0].item.name!;
    const b = namedMatches[1].item.name!;
    const note = rules?.pairNote ?? "Keep the rest of the look quiet.";
    oneLookToTry = `${a} + ${b}. ${note}`;
  } else {
    const formula =
      rules?.entryPoint ??
      (report.howToWear ?? [])[0]?.direction ??
      report.wardrobeNote ??
      report.summary;
    oneLookToTry = `A suggested formula: ${formula}`;
  }

  // -------------------------------------------------------------------------
  // Section 6 — ONE THING TO WATCH
  // -------------------------------------------------------------------------
  const oneThingToWatch =
    rules?.oneThingToWatch[register] ??
    rules?.oneThingToWatch["neutral"] ??
    (report.naiaVerdict ?? report.summary);

  // -------------------------------------------------------------------------
  // Section 7 — FROM YOUR CLOSET
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
  }

  // fromClosetInsufficient: closet exists but no item passed the named-card threshold
  const fromClosetInsufficient = hasCloset && fromCloset.length === 0;

  // oneUnlockPiece — rendered inside FROM YOUR CLOSET in the UI
  const oneUnlockPiece = buildOneUnlockPiece(evidence.closetItems, profile, slug);

  // -------------------------------------------------------------------------
  // Section 8 — THE ONE FORMULA TO REMEMBER
  // -------------------------------------------------------------------------
  const theOneFormula = namedMatches.length >= 2
    ? buildTwoItemFormula(
        namedMatches[0].item.name!,
        namedMatches[1].item.name!,
        namedMatches[0].item.category,
        namedMatches[1].item.category,
        slug,
      )
    : (report.wardrobeNote ?? rules?.entryPoint ?? report.summary);

  // -------------------------------------------------------------------------
  // Sub-title
  // -------------------------------------------------------------------------
  const shortTitle = TREND_SHORT_TITLES[slug] ?? report.title;
  const subTitle = `${shortTitle.toUpperCase()}, READ THROUGH YOUR STYLE`;

  return {
    subTitle,
    verdict,
    takeWithYou,
    leaveOut,
    bestEntryPoint,
    oneLookToTry,
    oneThingToWatch,
    fromCloset,
    fromClosetInsufficient,
    oneUnlockPiece,
    theOneFormula,
  };
}
