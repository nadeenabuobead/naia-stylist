// app/lib/ai/wardrobe-intelligence.ts
//
// WARDROBE INTELLIGENCE — deterministic, wardrobe-level aggregation engine.
//
// Garment Intelligence (per-item) already exists and is NOT re-implemented here:
//   - classification + observables       → ClosetItem (closet-garment-analysis)
//   - visualWeight / colourProfile /
//     12-intention potential             → lib/admin/garment-intelligence-v1.server.ts
//   - hand-curated StyleMe taxonomy      → GarmentStyleMeProfile
//
// This module consumes ALREADY-RESOLVED per-garment intelligence (the caller decides
// curated > admin-override > derived precedence) and answers wardrobe-level questions.
//
// ── THE SIGNAL MODEL ─────────────────────────────────────────────────────────
// Every conclusion declares the evidence behind it, and every piece of evidence
// declares which KIND of signal it is. These are never blurred together:
//
//   garment-fact            what the garment is            (colour, silhouette, formality…)
//   passport-signal         what the customer says about herself
//   self-reported-wardrobe  what she has said about a specific garment
//                           (favourite / wear-often / rarely-wear / regret / struggle / unsure)
//   naia-interaction        what has happened inside nAia  (generated outfits, saved looks)
//   observed-wear           real-world wear behaviour      — NOT AVAILABLE TODAY
//
// A self-reported relationship is NOT wear data. This engine may say "you've told
// nAia you rarely reach for these"; it may never say "you wore this 14 times" or
// "your most-worn piece". The separation is enforced in the types and the tests.
//
// ── GATING ───────────────────────────────────────────────────────────────────
// Phase 3C V2 DERIVED intention potential is still in shadow/validation. Any claim
// that depends on it sits behind flags.derivedIntentionIntelligence (default OFF).
// Curated intention potentials from an approved GarmentStyleMeProfile, and admin
// corrections, are trusted now — they are human-reviewed, not shadow output.
// With the gate closed the page must still read complete: every section has at
// least one route to an insight that needs no intention data at all.
//
// Rules this engine obeys:
//   1. Pure. No DB, no LLM, no I/O, no clock.
//   2. Never fabricates. Every number traces to a field on a real garment.
//   3. Every block declares its own availability. When the data is too thin, the
//      block returns state "learning" with an honest reason — never a placeholder.

// ── Signal model ──────────────────────────────────────────────────────────────

export type SignalType =
  | "garment-fact"
  | "passport-signal"
  | "self-reported-wardrobe"
  | "naia-interaction"
  | "observed-wear";

export const SIGNAL_LABELS: Readonly<Record<SignalType, string>> = {
  "garment-fact":           "What the garment is",
  "passport-signal":        "What you've told nAia about you",
  "self-reported-wardrobe": "What you've told nAia about this piece",
  "naia-interaction":       "What's happened inside nAia",
  "observed-wear":          "What you actually wear",
};

/** How much weight the evidence behind a claim can carry. */
export type EvidenceStrength = "strong" | "moderate" | "emerging";

export interface Evidence {
  signal: SignalType;
  /** The underlying field or record this came from. */
  field: string;
  /** Human-readable statement of what the data actually shows. */
  detail: string;
  garmentIds: string[];
}

export interface WardrobeIntelligenceFlags {
  /**
   * Phase 3C V2 DERIVED intention potential (garment-intelligence-v1.server.ts).
   * Shadow/validation only — keep false until that engine's QA closes.
   * Curated and admin-corrected intentions are unaffected by this flag.
   */
  derivedIntentionIntelligence: boolean;
}

export const DEFAULT_FLAGS: WardrobeIntelligenceFlags = {
  derivedIntentionIntelligence: false,
};

// ── Input types ───────────────────────────────────────────────────────────────

export type ResolvedVisualWeight = "light" | "medium" | "substantial";
export type ResolvedIntentionStrength = "strong" | "supporting" | "none";

export interface ResolvedColourProfile {
  hueFamily: string | null;
  wardrobeNeutral: boolean;
  lightDark: "light" | "dark" | null;
  energyTier: string | null;
}

export type IntelligenceSource = "curated" | "derived" | "none";

/**
 * Real-world wear behaviour. Reserved: nothing writes this today.
 * ClosetItem.timesWorn / lastWorn exist in the schema but are never populated,
 * so the loader passes null and the engine treats observed-wear as unavailable.
 */
export interface ObservedWear {
  timesWorn: number;
  lastWornAt: string | null;
}

export interface WardrobeGarment {
  id: string;
  name: string | null;
  category: string;
  subcategory: string | null;
  imageUrl: string | null;
  /** Canonical outfit slot — resolved by the caller via closetItemToSlot(). */
  slot: string;

  // ── garment-fact signals ──
  primaryColor: string | null;
  colors: string[];
  pattern: string | null;
  material: string | null;
  silhouette: string | null;
  fitProfile: string | null;
  formality: string | null;
  stylePersonality: string | null;
  occasions: string[];
  seasons: string[];
  analysisStatus: string;
  visualWeight: ResolvedVisualWeight | null;
  colourProfile: ResolvedColourProfile | null;

  // ── self-reported-wardrobe signals ──
  /** favourite | wear-often | like | occasion-only | rarely-wear | regret | love-style-struggle | unsure */
  garmentRelationships: string[];

  // ── gated intelligence ──
  intentions: Record<string, ResolvedIntentionStrength> | null;
  /** "curated" = approved profile or admin correction (trusted now).
   *  "derived"  = Phase 3C V2 shadow output (gated). */
  intentionsSource: "curated" | "derived" | null;
  intelligenceSource: IntelligenceSource;

  // ── naia-interaction signals ──
  outfitAppearances: number;
  savedLookAppearances: number;

  // ── observed-wear signals — reserved, always null today ──
  observedWear: ObservedWear | null;
}

export interface WardrobePassport {
  lifestyle: string[];
  favoriteColors: string[];
  avoidColors: string[];
  stylePersonalities: string[];
  silhouette: string[];
  structure: string | null;
  fitPreferences: string[];
  styleStruggles: string[];
  styleSupport: string[];
  becoming: string[];
}

// ── Output types ──────────────────────────────────────────────────────────────

export type BlockState = "available" | "learning";

export interface WardrobeMetric {
  id: string;
  label: string;
  value: number | null;
  caption: string;
  state: BlockState;
  signal: SignalType;
  learningNote?: string;
}

export interface PaletteColour {
  colour: string;
  count: number;
  share: number;
  neutral: boolean;
}

export interface WardrobeShape {
  label: string;
  count: number;
  field: "silhouette" | "fitProfile";
}

export interface WardrobeTrait {
  id: string;
  label: string;
  evidence: string;
}

export interface WardrobeDna {
  state: BlockState;
  learningNote?: string;
  palette: PaletteColour[];
  paletteReading: string;
  shapes: WardrobeShape[];
  shapesReading: string;
  traits: WardrobeTrait[];
}

export type HeroLabel =
  | "most-versatile"
  | "closet-connector"
  | "passport-match"
  | "your-favourite"
  | "untapped-hero";

export const HERO_LABEL_TEXT: Readonly<Record<HeroLabel, string>> = {
  "most-versatile":   "Most versatile",
  "closet-connector": "Closet connector",
  "passport-match":   "Passport match",
  "your-favourite":   "Your favourite",
  "untapped-hero":    "Untapped hero",
};

export interface WardrobeHero {
  garmentId: string;
  /** "finishing" = shoe/bag/accessory/jewellery. Used by the display cap. */
  tier: HeroTier;
  /** Count of exceptional signals behind this piece — decides which survives the cap. */
  evidenceScore: number;
  name: string;
  category: string;
  imageUrl: string | null;
  label: HeroLabel;
  labelText: string;
  headline: string;
  reasons: string[];
  evidence: Evidence[];
  strength: EvidenceStrength;
}

export interface WardrobeHeroes {
  state: BlockState;
  learningNote?: string;
  heroes: WardrobeHero[];
}

export interface WardrobePairing {
  id: string;
  garmentIds: string[];
  reason: string;
  untried: boolean;
  evidence: Evidence[];
}

/**
 * How the "nAia hasn't built this yet" signal should be SHOWN.
 *
 * The detection never changes — every pairing still carries `untried`. What
 * changes is the presentation, because a badge on every row says nothing:
 *   "per-item" — some displayed relationships are novel and some are not, so the
 *                tag marks the novel ones. This is what the tag is for.
 *   "section"  — every displayed relationship is novel (common for a customer
 *                with little nAia history). Said once, quietly, at section level.
 *   "none"     — nothing displayed is novel. No novelty messaging at all.
 */
export type UntriedPresentation = "per-item" | "section" | "none";

export interface WardrobePairings {
  state: BlockState;
  learningNote?: string;
  /**
   * Everything the section displays: the strongest relationships first, then any
   * combination nAia has never built, flagged with `untried`. One list — a
   * separate "try together" section printed the same outfits twice.
   */
  pairings: WardrobePairing[];
  totalFound: number;
  untriedPresentation: UntriedPresentation;
  /** Section-level wording. Non-null only when presentation is "section". */
  untriedNote: string | null;
}

export type ObservationKind =
  | "contradiction-potential-struggle"
  | "contradiction-alignment-unused"
  | "contradiction-favourite-isolated"
  | "repetition"
  | "untapped-potential"
  | "struggle-pattern"
  | "colour-pattern"
  | "passport-alignment"
  | "wardrobe-imbalance"
  | "self-reported-reach"
  | "connection-density"
  | "intention-concentration";

/**
 * "discovery" = two signals disagreeing about the same garment — the things a
 * customer cannot see by looking at her own wardrobe. "pattern" = a true but
 * descriptive reading. The page gives them different weight.
 */
export type ObservationTier = "discovery" | "pattern";

export interface WardrobeObservation {
  id: string;
  kind: ObservationKind;
  tier: ObservationTier;
  headline: string;
  observation: string;
  explanation: string | null;
  garmentIds: string[];
  evidence: Evidence[];
  strength: EvidenceStrength;
  action: { label: string; kind: "see-pieces" } | null;
  /** true when this observation only exists because a gated layer is switched on. */
  gated: boolean;
}

export interface RediscoverPiece {
  garmentId: string;
  name: string;
  imageUrl: string | null;
  body: string;
  /** Pieces in the Closet this one demonstrably works with. */
  worksWithIds: string[];
  evidence: Evidence[];
  strength: EvidenceStrength;
}

export interface WardrobeGap {
  id: string;
  title: string;
  body: string;
  garmentIds: string[];
  evidence: Evidence[];
  strength: EvidenceStrength;
}

export interface WardrobeOpportunities {
  state: BlockState;
  learningNote?: string;
  rediscover: RediscoverPiece[];
  worthConsidering: WardrobeGap[];
  /** Set when no gap is evidenced — an answer in its own right, not an empty state. */
  noGapNote: string | null;
}

export interface PassportComparison {
  id: string;
  stated: string;
  observed: string;
  reading: string;
  evidence: Evidence[];
  strength: EvidenceStrength;
}

export interface WardrobePassportView {
  state: BlockState;
  learningNote?: string;
  comparisons: PassportComparison[];
}

export interface SignalAvailability {
  // ── internal provenance (kept for QA, debugging and future tooling) ──
  signal: SignalType;
  label: string;
  state: "active" | "partial" | "unavailable";
  /** Precise, technical account of what nAia holds. Not customer-facing. */
  detail: string;
  // ── customer-facing expression ──
  /** Short name the customer recognises: "Closet", "Your feedback", ... */
  title: string;
  /** One quiet line describing what that is, in her language. */
  body: string;
  /** "Reading" | "Partly known" | "Still learning" */
  statusText: string;
}

export interface WearIntelligence {
  state: BlockState;
  learningNote: string;
  observedToday: WardrobeMetric[];
  pending: string[];
}

export interface WardrobeCoverage {
  totalItems: number;
  analysedItems: number;
  intelligenceItems: number;
  colourCoverage: number;
  shapeCoverage: number;
  formalityCoverage: number;
  relationshipCoverage: number;
  occasionCoverage: number;
  /** Share of the wardrobe with intention data the current gate allows us to use. */
  usableIntentionCoverage: number;
}

export interface WardrobeIntelligence {
  ready: boolean;
  readyNote: string | null;
  /** One sentence on what this wardrobe IS. The opening line of the page. */
  snapshotReading: string | null;
  flags: WardrobeIntelligenceFlags;
  coverage: WardrobeCoverage;
  signalAvailability: SignalAvailability[];
  snapshot: WardrobeMetric[];
  dna: WardrobeDna;
  heroes: WardrobeHeroes;
  pairings: WardrobePairings;
  observations: WardrobeObservation[];
  opportunities: WardrobeOpportunities;
  passportView: WardrobePassportView;
  wear: WearIntelligence;
}

// ── Thresholds ────────────────────────────────────────────────────────────────

export const MIN_WARDROBE_SIZE = 5;
const COVERAGE_THRESHOLD = 0.6;
const PALETTE_MIN_SHARE = 0.1;
const MAX_PALETTE_COLOURS = 5;
const MAX_SHAPES = 5;
const MAX_HEROES = 4;
const MAX_PAIRINGS = 4;
const MAX_OBSERVATIONS = 5;
const MAX_REDISCOVER = 3;

// ── Vocabulary ────────────────────────────────────────────────────────────────

const INTENTION_LABELS: Readonly<Record<string, string>> = {
  "feel-like-myself":  "feel like yourself",
  "confidence":        "feel confident",
  "ground-me":         "feel grounded",
  "give-structure":    "have structure",
  "make-it-easy":      "keep things easy",
  "feel-put-together": "feel put together",
  "feel-attractive":   "feel attractive",
  "give-energy":       "have energy",
  "feel-softer":       "feel softer",
  "feel-sharper":      "feel sharper",
  "feel-less-exposed": "feel less exposed",
  "express-myself":    "express yourself",
};

const CATEGORY_SINGULAR: Readonly<Record<string, string>> = {
  TOPS: "top", BOTTOMS: "bottom", DRESSES: "dress", OUTERWEAR: "outer layer",
  SHOES: "pair of shoes", BAGS: "bag", ACCESSORIES: "accessory", JEWELRY: "piece of jewellery",
  ACTIVEWEAR: "activewear piece", SWIMWEAR: "swim piece", LOUNGEWEAR: "loungewear piece",
  OTHER: "piece",
};

const CATEGORY_PLURAL: Readonly<Record<string, string>> = {
  TOPS: "tops", BOTTOMS: "bottoms", DRESSES: "dresses", OUTERWEAR: "outer layers",
  SHOES: "shoes", BAGS: "bags", ACCESSORIES: "accessories", JEWELRY: "jewellery",
  ACTIVEWEAR: "activewear pieces", SWIMWEAR: "swim pieces",
  LOUNGEWEAR: "loungewear pieces", OTHER: "pieces",
};

const SILHOUETTE_LABELS: Readonly<Record<string, string>> = {
  straight: "Straight", "a-line": "A-line", fitted: "Fitted", oversized: "Oversized",
  relaxed: "Relaxed", flared: "Flared", tapered: "Tapered", wrap: "Wrap",
  balloon: "Balloon", asymmetric: "Asymmetric", column: "Column", boxy: "Boxy",
  cropped: "Cropped", empire: "Empire", shift: "Shift", bodycon: "Body-skimming",
};

const FIT_LABELS: Readonly<Record<string, string>> = {
  tailored: "Tailored", structured: "Structured", relaxed: "Relaxed", fitted: "Fitted",
  loose: "Loose", oversized: "Oversized", flowy: "Fluid", "body-skimming": "Body-skimming",
  slim: "Slim", regular: "Regular",
};

const FORMALITY_BUCKET: Readonly<Record<string, "everyday" | "work" | "occasion">> = {
  "casual": "everyday", "smart-casual": "everyday",
  "business-casual": "work", "business-formal": "work",
  "occasion": "occasion", "evening": "occasion",
};

const FORMALITY_BUCKET_LABEL: Readonly<Record<string, string>> = {
  everyday: "everyday and casual",
  work: "polished and work-ready",
  occasion: "occasion and evening",
};

const FORMALITY_BUCKET_SHORT: Readonly<Record<string, string>> = {
  everyday: "relaxed", work: "polished", occasion: "occasion",
};

// Passport lifestyle IDs → the register(s) that life actually asks for.
// Both the V2 and V3 quiz vocabularies are covered (see PROFILE_LIFESTYLE_OCCASION_MAP).
const LIFESTYLE_REGISTERS: Readonly<Record<string, ReadonlyArray<"everyday" | "work" | "occasion">>> = {
  "office":                   ["work"],
  "work-office":              ["work"],
  "hybrid":                   ["work", "everyday"],
  "busy-mom":                 ["everyday"],
  "creative":                 ["everyday"],
  "casual-days":              ["everyday"],
  "everyday-casual":          ["everyday"],
  "on-the-go":                ["everyday"],
  "travel":                   ["everyday"],
  "family-parenting":         ["everyday"],
  "active-busy-days":         ["everyday"],
  "events":                   ["occasion"],
  "dinners-going-out":        ["occasion"],
  "events-special-occasions": ["occasion"],
  // Rev 7 additions. Without these the register comparison reads a customer's
  // stated life as "not the part of your life you described", which is wrong.
  "study-university":         ["everyday"],
  "fitness-gym":              ["everyday"],
  "creative-flexible-work":   ["work", "everyday"],
  "mostly-at-home":           ["everyday"],
  "always-on-the-go":         ["everyday"],
  // "Other" carries a free-text note. Mapped explicitly so the exhaustiveness
  // test passes, but it names no register — guessing one would be inventing.
  "other-lifestyle":          [],
};

const LIFESTYLE_LABELS: Readonly<Record<string, string>> = {
  "office":                   "work",
  "work-office":              "work",
  "hybrid":                   "hybrid working",
  "busy-mom":                 "family life",
  "creative":                 "creative work",
  "casual-days":              "casual days",
  "everyday-casual":          "everyday dressing",
  "on-the-go":                "being on the go",
  "travel":                   "travel",
  "family-parenting":         "family life",
  "active-busy-days":         "active, busy days",
  "events":                   "events",
  "dinners-going-out":        "dinners and going out",
  "events-special-occasions": "special occasions",
  "study-university":         "study",
  "fitness-gym":              "training",
  "creative-flexible-work":   "creative, flexible work",
  "mostly-at-home":           "being mostly at home",
  "always-on-the-go":         "being on the go",
  // "other-lifestyle" is deliberately unlabelled — its meaning lives in a
  // free-text note nAia cannot read into a register.
};

function lifestyleRegisters(lifestyle: string[]): Set<string> {
  const out = new Set<string>();
  for (const id of lifestyle) {
    for (const register of LIFESTYLE_REGISTERS[id] ?? []) out.add(register);
  }
  return out;
}

function describeLifestyle(lifestyle: string[]): string {
  const labels = lifestyle.map((id) => LIFESTYLE_LABELS[id]).filter(Boolean);
  return labels.length > 0 ? joinList(labels) : "";
}

// ── Colour vocabulary bridge ──────────────────────────────────────────────────
//
// The Style Passport and the Closet speak different colour vocabularies. The
// Passport asks for FAMILIES ("Red / Burgundy"); the Closet records the colour
// the garment actually is ("Burgundy", "Charcoal Gray", "Ivory"). Without a
// bridge, every compound Passport token silently fails to match and a stated
// preference disappears from the comparison.
//
// Source of truth for the left-hand side: COLOUR_FAMILIES in
// app/lib/onboarding/quiz-data.ts. The test suite asserts this map covers every
// id in that list, so adding a Passport colour without a mapping fails the build.

/** Passport colour token → the Closet colour families it covers. */
const PASSPORT_COLOUR_FAMILIES: Readonly<Record<string, readonly string[]>> = {
  "black":        ["black"],
  "white-cream":  ["white", "cream"],
  "beige-brown":  ["beige", "brown"],
  "grey":         ["grey"],
  "navy":         ["navy"],
  "blue":         ["blue"],
  "red-burgundy": ["red", "burgundy"],
  "green":        ["green"],
  "pink":         ["pink"],
  "purple":       ["purple"],
  "yellow":       ["yellow"],
  "orange":       ["orange"],
  "metallics":    ["metallic"],
};

/** How each Passport token reads in a sentence. */
const PASSPORT_COLOUR_LABEL: Readonly<Record<string, string>> = {
  "black":        "black",
  "white-cream":  "white and cream",
  "beige-brown":  "beige and brown",
  "grey":         "grey",
  "navy":         "navy",
  "blue":         "blue",
  "purple":       "purple",
  "metallics":    "metallics",
  "red-burgundy": "red and burgundy",
  "green":        "green",
  "pink":         "pink",
  "yellow":       "yellow",
  "orange":       "orange",
};

/**
 * Closet primaryColor → colour family.
 * Families that no Passport token claims (blue, purple) are still resolved, so a
 * garment is never mis-filed into a family the customer did ask for.
 */
const CLOSET_COLOUR_FAMILY: Readonly<Record<string, string>> = {
  // black
  "black": "black", "off-black": "black", "jet black": "black",
  // white / cream
  "white": "white", "off-white": "white", "optic white": "white",
  "cream": "cream", "ivory": "cream", "eggshell": "cream", "bone": "cream",
  // beige / brown
  "beige": "beige", "sand": "beige", "stone": "beige", "nude": "beige",
  "taupe": "beige", "oatmeal": "beige", "khaki": "beige",
  "brown": "brown", "dark brown": "brown", "chocolate": "brown", "espresso": "brown",
  "camel": "brown", "tan": "brown", "chestnut": "brown", "cognac": "brown", "mocha": "brown",
  // grey
  "grey": "grey", "gray": "grey", "light grey": "grey", "light gray": "grey",
  "dark grey": "grey", "dark gray": "grey", "charcoal": "grey",
  "charcoal grey": "grey", "charcoal gray": "grey", "slate": "grey",
  // navy — kept distinct from blue; the Passport asks for navy, not blue
  "navy": "navy", "dark navy": "navy", "midnight": "navy", "midnight blue": "navy",
  // blue (no Passport family)
  "blue": "blue", "light blue": "blue", "medium blue": "blue", "dark blue": "blue",
  "sky blue": "blue", "powder blue": "blue", "periwinkle blue": "blue", "periwinkle": "blue",
  "denim": "blue", "chambray": "blue", "cobalt": "blue", "teal": "blue", "turquoise": "blue",
  "cornflower blue": "blue", "indigo": "blue",
  // red / burgundy
  "red": "red", "crimson": "red", "cherry": "red", "scarlet": "red", "dark red": "red",
  "burgundy": "burgundy", "wine": "burgundy", "maroon": "burgundy", "oxblood": "burgundy",
  "bordeaux": "burgundy",
  // green
  "green": "green", "dark green": "green", "olive": "green", "sage": "green",
  "emerald": "green", "forest": "green", "hunter": "green", "mint": "green", "jade": "green",
  // pink
  "pink": "pink", "light pink": "pink", "blush": "pink", "rose": "pink",
  "fuchsia": "pink", "magenta": "pink", "coral": "pink", "salmon": "pink",
  // purple (no Passport family)
  "purple": "purple", "dark purple": "purple", "violet": "purple", "lilac": "purple",
  "lavender": "purple", "plum": "purple", "mauve": "purple", "mulberry": "purple",
  // yellow
  "yellow": "yellow", "mustard": "yellow", "lemon": "yellow", "butter": "yellow",
  // metallic
  "gold": "metallic", "silver": "metallic", "bronze": "metallic", "pewter": "metallic",
  "gunmetal": "metallic", "rose gold": "metallic", "champagne": "metallic",
  // orange
  "orange": "orange", "dark orange": "orange", "rust": "orange", "terracotta": "orange",
  "copper": "orange", "amber": "orange", "peach": "orange", "apricot": "orange",
};

/** The colour family a garment belongs to, or null when nAia can't tell. */
function closetColourFamily(colour: string | null): string | null {
  const key = norm(colour);
  return key ? (CLOSET_COLOUR_FAMILY[key] ?? null) : null;
}

/** Families covered by a set of Passport colour tokens, de-duplicated. */
function passportColourFamilies(tokens: string[]): Set<string> {
  const families = new Set<string>();
  for (const token of tokens) {
    for (const family of PASSPORT_COLOUR_FAMILIES[norm(token) ?? ""] ?? []) families.add(family);
  }
  return families;
}

export const PASSPORT_COLOUR_TOKENS = Object.keys(PASSPORT_COLOUR_FAMILIES);
export { LIFESTYLE_REGISTERS as PASSPORT_LIFESTYLE_REGISTERS };
export { PASSPORT_COLOUR_FAMILIES, CLOSET_COLOUR_FAMILY, closetColourFamily };

// Customer-facing wording for the relationship IDs. Raw ids must never reach copy.
const RELATIONSHIP_PHRASES: Readonly<Record<string, string>> = {
  "favourite":           "one of your favourites",
  "wear-often":          "one you wear often",
  "like":                "one you like",
  "occasion-only":       "one you keep for specific occasions",
  "rarely-wear":         "one you rarely reach for",
  "regret":              "a purchase you regret",
  "love-style-struggle": "one you love but struggle to style",
  "unsure":              "one you're unsure about",
};

function describeRelationships(relationships: string[]): string {
  const phrases = relationships.map((r) => RELATIONSHIP_PHRASES[r]).filter(Boolean);
  return phrases.length > 0 ? joinList(phrases) : "no relationship recorded";
}

// ── Self-reported relationship groupings (NEVER wear data) ────────────────────

const STATED_REGULAR = new Set(["favourite", "wear-often"]);
const STATED_LOW_USE = new Set(["rarely-wear", "regret"]);
const STATED_STRUGGLE = new Set(["love-style-struggle"]);
const STATED_UNSURE = new Set(["unsure"]);
const STATED_FRICTION = new Set(["love-style-struggle", "unsure"]);

const TOP_SLOTS = new Set(["top"]);
const BOTTOM_SLOTS = new Set(["bottom"]);
const ONE_PIECE_SLOTS = new Set(["dress", "set"]);

// Slots that build an outfit. Shoes, bags, jewellery and accessories go with
// almost anything by construction, so counting them as "partners" inflates every
// versatility score and pushes a black tote to the top of the heroes list. The
// structural reading is therefore scoped to garments; finishing pieces still live
// in the Closet and still carry their own garment intelligence.
const CORE_SLOTS: ReadonlySet<string> = new Set(["top", "bottom", "dress", "set", "outerwear"]);

// Which slots genuinely sit together in one look. A top does not pair with a dress.
const SLOT_PAIRS: Readonly<Record<string, ReadonlySet<string>>> = {
  top:       new Set(["bottom", "outerwear"]),
  bottom:    new Set(["top", "outerwear"]),
  dress:     new Set(["outerwear"]),
  set:       new Set(["outerwear"]),
  outerwear: new Set(["top", "bottom", "dress", "set"]),
};

function slotsPair(a: string, b: string): boolean {
  return SLOT_PAIRS[a]?.has(b) ?? false;
}

// Activewear, swimwear and loungewear form their own functional wardrobe.
// They are not banned from anything — they are held to a relevance test, because
// on a pure connectivity score they otherwise sweep every ranking.
const FUNCTIONAL_CATEGORIES: ReadonlySet<string> = new Set([
  "ACTIVEWEAR", "SWIMWEAR", "LOUNGEWEAR",
]);

// Finishing slots. A black tote is compatible with almost everything by
// construction, so connectivity says nothing about it — but a favourite pair of
// boots is a real wardrobe hero. The rule is therefore about WHICH KIND of
// evidence a finishing piece needs, not about the category as such.
const FINISHING_SLOTS: ReadonlySet<string> = new Set(["shoe", "bag", "accessory", "jewelry"]);

// Passport lifestyle IDs where an athletic or on-the-move wardrobe is genuinely
// part of the life described.
const ACTIVE_LIFESTYLE_IDS: ReadonlySet<string> = new Set([
  "active-busy-days", "on-the-go", "always-on-the-go", "busy-mom",
  "family-parenting", "fitness-gym",
]);

/** Share of the Closet above which activewear is self-evidently part of her life. */
const ACTIVE_WARDROBE_SHARE = 0.25;

type HeroTier = "core" | "functional" | "finishing";

/** Is an athletic wardrobe genuinely part of this customer's life? */
function isActiveRelevant(items: WardrobeGarment[], passport: WardrobePassport | null): boolean {
  const share = ratio(items.filter((g) => FUNCTIONAL_CATEGORIES.has(g.category)).length, items.length);
  return (
    share >= ACTIVE_WARDROBE_SHARE ||
    (passport?.lifestyle ?? []).some((id) => ACTIVE_LIFESTYLE_IDS.has(id))
  );
}

function heroTier(g: WardrobeGarment): HeroTier {
  if (FINISHING_SLOTS.has(g.slot)) return "finishing";
  if (FUNCTIONAL_CATEGORIES.has(g.category)) return "functional";
  return "core";
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function norm(s: string | null | undefined): string | null {
  if (s === null || s === undefined) return null;
  const t = s.trim().toLowerCase();
  return t === "" || t === "n/a" ? null : t;
}

function titleCase(s: string): string {
  return s.replace(/(^|[\s-])([a-z])/g, (_m, p, c) => p + c.toUpperCase());
}

function displayName(g: WardrobeGarment): string {
  if (g.name && g.name.trim() !== "") return g.name.trim();
  const colour = g.primaryColor ? `${g.primaryColor} ` : "";
  const noun = g.subcategory?.trim() || CATEGORY_SINGULAR[g.category] || "piece";
  return titleCase(`${colour}${noun}`);
}

function joinList(parts: string[]): string {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

function countBy<T>(items: T[], key: (t: T) => string | null): Map<string, number> {
  const out = new Map<string, number>();
  for (const item of items) {
    const k = key(item);
    if (k === null) continue;
    out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}

function topEntries(counts: Map<string, number>, limit: number): Array<[string, number]> {
  return Array.from(counts.entries())
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .slice(0, limit);
}

function ratio(part: number, whole: number): number {
  return whole > 0 ? part / whole : 0;
}

function statedAs(g: WardrobeGarment, set: ReadonlySet<string>): boolean {
  return (g.garmentRelationships ?? []).some((r) => set.has(r));
}

/** "a" or "an", by sound rather than by spelling rule alone. */
function indefinite(word: string): string {
  return /^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`;
}

function capitalise(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}

export function combinationKey(ids: string[]): string {
  return [...ids].sort().join("|");
}

function ev(
  signal: SignalType,
  field: string,
  detail: string,
  garmentIds: string[] = [],
): Evidence {
  return { signal, field, detail, garmentIds };
}

/**
 * Strength rises with how many pieces back the claim and how many distinct signal
 * types agree. A claim resting on one signal type and a handful of pieces is
 * "emerging"; one backed by several signal types across a real slice of the
 * wardrobe is "strong".
 */
function gradeStrength(evidence: Evidence[], supportingItems: number): EvidenceStrength {
  const signals = new Set(evidence.map((e) => e.signal)).size;
  if (signals >= 2 && supportingItems >= 4) return "strong";
  if (signals >= 2 || supportingItems >= 4) return "moderate";
  return "emerging";
}

// ── Gated intelligence access ─────────────────────────────────────────────────

/**
 * The ONLY way this engine reads intention potential.
 * Curated/admin-corrected intentions pass through; DERIVED Phase 3C V2 output is
 * withheld until its flag is switched on.
 */
function usableIntentions(
  g: WardrobeGarment,
  flags: WardrobeIntelligenceFlags,
): Record<string, ResolvedIntentionStrength> | null {
  if (!g.intentions || g.intentionsSource === null) return null;
  if (g.intentionsSource === "curated") return g.intentions;
  return flags.derivedIntentionIntelligence ? g.intentions : null;
}

function strongIntentions(g: WardrobeGarment, flags: WardrobeIntelligenceFlags): string[] {
  const intentions = usableIntentions(g, flags);
  if (!intentions) return [];
  return Object.entries(intentions)
    .filter(([, strength]) => strength === "strong")
    .map(([intention]) => intention)
    .sort();
}

// ── Coverage and signal availability ──────────────────────────────────────────

function computeCoverage(
  items: WardrobeGarment[],
  flags: WardrobeIntelligenceFlags,
): WardrobeCoverage {
  const total = items.length;
  const count = (predicate: (g: WardrobeGarment) => boolean) => items.filter(predicate).length;

  return {
    totalItems: total,
    analysedItems: count((i) => i.analysisStatus === "ready"),
    intelligenceItems: count((i) => i.intelligenceSource !== "none"),
    colourCoverage: ratio(count((i) => norm(i.primaryColor) !== null), total),
    shapeCoverage: ratio(count((i) => norm(i.silhouette) !== null || norm(i.fitProfile) !== null), total),
    formalityCoverage: ratio(count((i) => norm(i.formality) !== null), total),
    relationshipCoverage: ratio(count((i) => (i.garmentRelationships ?? []).length > 0), total),
    occasionCoverage: ratio(count((i) => (i.occasions ?? []).length > 0), total),
    usableIntentionCoverage: ratio(count((i) => usableIntentions(i, flags) !== null), total),
  };
}

function buildSignalAvailability(
  items: WardrobeGarment[],
  coverage: WardrobeCoverage,
  passport: WardrobePassport | null,
): SignalAvailability[] {
  const interactions = items.filter((i) => i.outfitAppearances > 0 || i.savedLookAppearances > 0).length;
  const relationshipCount = items.filter((i) => (i.garmentRelationships ?? []).length > 0).length;

  const garmentState: SignalAvailability["state"] =
    coverage.colourCoverage >= COVERAGE_THRESHOLD && coverage.shapeCoverage >= COVERAGE_THRESHOLD
      ? "active"
      : coverage.analysedItems > 0
        ? "partial"
        : "unavailable";

  const passportFilled = passport
    ? [passport.lifestyle, passport.favoriteColors, passport.silhouette, passport.fitPreferences]
        .filter((f) => f.length > 0).length + (passport.structure ? 1 : 0)
    : 0;

  const statusText: Record<SignalAvailability["state"], string> = {
    active: "Reading",
    partial: "Partly known",
    unavailable: "Still learning",
  };

  const rows: Array<Omit<SignalAvailability, "statusText">> = [
    {
      signal: "garment-fact",
      label: SIGNAL_LABELS["garment-fact"],
      state: garmentState,
      detail: `${coverage.analysedItems} of ${coverage.totalItems} pieces read in detail.`,
      title: "Closet",
      body: "Your garments and their characteristics.",
    },
    {
      signal: "passport-signal",
      label: SIGNAL_LABELS["passport-signal"],
      state: passportFilled >= 3 ? "active" : passportFilled > 0 ? "partial" : "unavailable",
      detail: passport
        ? `${passportFilled} of 5 Passport areas nAia uses here are filled in.`
        : "No Style Passport on file.",
      title: "Style Passport",
      body: "Your preferences and priorities.",
    },
    {
      signal: "self-reported-wardrobe",
      label: SIGNAL_LABELS["self-reported-wardrobe"],
      state: coverage.relationshipCoverage >= 0.5 ? "active" : relationshipCount > 0 ? "partial" : "unavailable",
      detail: `${relationshipCount} of ${coverage.totalItems} pieces carry a customer relationship tag.`,
      title: "Your feedback",
      body: "Pieces you’ve marked as favourites, difficult to style, or rarely reached for.",
    },
    {
      signal: "naia-interaction",
      label: SIGNAL_LABELS["naia-interaction"],
      state: interactions >= 3 ? "active" : interactions > 0 ? "partial" : "unavailable",
      detail: `${interactions} pieces appear in a generated outfit or saved look.`,
      title: "nAia activity",
      body: "Looks you’ve generated or saved.",
    },
    {
      signal: "observed-wear",
      label: SIGNAL_LABELS["observed-wear"],
      state: "unavailable",
      detail: "No wear-recording path exists; ClosetItem.timesWorn / lastWorn are never written.",
      title: "Wear behaviour",
      body: "What you actually reach for, day to day.",
    },
  ];

  return rows.map((row) => ({ ...row, statusText: statusText[row.state] }));
}

// ── Compatibility graph ───────────────────────────────────────────────────────
//
// A deterministic wardrobe-level relationship test built purely on garment facts.
// This is NOT outfit generation: it answers "do these two pieces sit together",
// nothing about occasion or mood. StyleMe remains the only system that builds an
// outfit for a moment.

function formalityDistance(a: string | null, b: string | null): number | null {
  const order = ["casual", "smart-casual", "business-casual", "business-formal", "occasion", "evening"];
  const ia = a ? order.indexOf(a) : -1;
  const ib = b ? order.indexOf(b) : -1;
  if (ia === -1 || ib === -1) return null;
  return Math.abs(ia - ib);
}

function colourCompatible(a: WardrobeGarment, b: WardrobeGarment): boolean | null {
  const ca = a.colourProfile;
  const cb = b.colourProfile;
  if (!ca || !cb) return null;
  if (ca.wardrobeNeutral || cb.wardrobeNeutral) return true;
  if (ca.hueFamily !== null && ca.hueFamily === cb.hueFamily) return true;
  return false;
}

function weightBalanced(a: WardrobeGarment, b: WardrobeGarment): boolean {
  return !(a.visualWeight === "substantial" && b.visualWeight === "substantial");
}

/** A reason two pieces work, with how specific to THESE two it is. */
interface PairReason {
  text: string;
  /** Higher = more specific to this pair. Generic register agreement is lowest. */
  weight: number;
}

interface PairScore {
  compatible: boolean;
  reasons: PairReason[];
}

const STRUCTURED_FITS = new Set(["tailored", "structured"]);
const SOFT_FITS = new Set(["relaxed", "loose", "oversized", "flowy"]);
const FULL_SILHOUETTES = new Set(["oversized", "balloon", "flared", "a-line"]);
const CLOSE_SILHOUETTES = new Set(["fitted", "column", "straight", "tapered"]);

/**
 * Why THESE two, not why two garments could generally work.
 *
 * Every reason is read off a field the garment actually carries. The list is
 * ranked by specificity so the section can lead with the most particular true
 * thing it can say about each pair, rather than repeating the same sentence.
 */
function scorePair(a: WardrobeGarment, b: WardrobeGarment): PairScore {
  if (!weightBalanced(a, b)) return { compatible: false, reasons: [] };

  const fd = formalityDistance(norm(a.formality), norm(b.formality));
  if (fd !== null && fd > 1) return { compatible: false, reasons: [] };

  const cc = colourCompatible(a, b);
  if (cc === false) return { compatible: false, reasons: [] };

  const reasons: PairReason[] = [];

  // Occasion overlap — she tagged both for the same moment.
  const sharedOccasions = (a.occasions ?? []).filter((o) => (b.occasions ?? []).includes(o));
  if (sharedOccasions.length > 0) {
    reasons.push({
      // "these", not "both": a pairing may carry a third piece.
      text: `You've tagged these for ${sharedOccasions[0].toLowerCase()}.`,
      weight: 8,
    });
  }

  // Structure contrast — the most useful thing to say about a pair.
  const fitA = norm(a.fitProfile);
  const fitB = norm(b.fitProfile);
  if (fitA && fitB) {
    const structured = STRUCTURED_FITS.has(fitA) ? a : STRUCTURED_FITS.has(fitB) ? b : null;
    const soft = SOFT_FITS.has(fitA) ? a : SOFT_FITS.has(fitB) ? b : null;
    if (structured && soft && structured.id !== soft.id) {
      reasons.push({
        text: "One is tailored and the other relaxed — the structure is what makes it read deliberate.",
        weight: 7,
      });
    }
  }

  // Colour, said precisely.
  const ca = a.colourProfile;
  const cb = b.colourProfile;
  if (ca && cb) {
    if (!ca.wardrobeNeutral && !cb.wardrobeNeutral && ca.hueFamily && ca.hueFamily === cb.hueFamily) {
      reasons.push({ text: `Both sit in the same ${ca.hueFamily} family.`, weight: 6 });
    } else if (ca.wardrobeNeutral !== cb.wardrobeNeutral) {
      const neutral = ca.wardrobeNeutral ? a : b;
      const colourful = ca.wardrobeNeutral ? b : a;
      const neutralName = norm(neutral.primaryColor);
      const colourName = norm(colourful.primaryColor);
      if (neutralName && colourName) {
        reasons.push({ text: `The ${neutralName} anchors the ${colourName}.`, weight: 6 });
      } else {
        reasons.push({ text: "One of them is a wardrobe neutral, so the pairing stays easy.", weight: 4 });
      }
    } else if (ca.wardrobeNeutral && cb.wardrobeNeutral) {
      reasons.push({ text: "Both are wardrobe neutrals, so nothing competes.", weight: 3 });
    }
  }

  // Silhouette contrast.
  const silA = norm(a.silhouette);
  const silB = norm(b.silhouette);
  if (silA && silB) {
    const full = FULL_SILHOUETTES.has(silA) ? silA : FULL_SILHOUETTES.has(silB) ? silB : null;
    const close = CLOSE_SILHOUETTES.has(silA) ? silA : CLOSE_SILHOUETTES.has(silB) ? silB : null;
    if (full && close) {
      reasons.push({ text: `A ${close} shape against ${indefinite(full)} one keeps the proportions clear.`, weight: 5 });
    }
  }

  // Visual weight.
  if (a.visualWeight && b.visualWeight && a.visualWeight !== b.visualWeight) {
    reasons.push({ text: "One carries more visual weight than the other, which stops the pairing flattening.", weight: 4 });
  }

  // Register — true, but the least particular thing that can be said.
  if (fd !== null) {
    reasons.push(
      fd === 0
        ? { text: "They sit at the same level of dress.", weight: 2 }
        : { text: "Their levels of dress sit next to each other.", weight: 1 },
    );
  }

  reasons.sort((x, y) => y.weight - x.weight);
  // A pairing needs at least one positive, evidenced reason — never "compatible by default".
  return { compatible: reasons.length > 0, reasons };
}

/**
 * Garments that structurally sit with this one in a look. Core slots only —
 * see CORE_SLOTS for why finishing pieces are excluded from the count.
 */
function partnersOf(garment: WardrobeGarment, items: WardrobeGarment[]): WardrobeGarment[] {
  return items.filter(
    (other) =>
      other.id !== garment.id &&
      slotsPair(garment.slot, other.slot) &&
      scorePair(garment, other).compatible,
  );
}

// ── Snapshot ──────────────────────────────────────────────────────────────────

/**
 * The opening.
 *
 * A reading first — what nAia understands about this wardrobe — then at most
 * three facts that support it. Deliberately NOT a metrics grid: combination
 * counts, compatibility ratios and "pieces nAia has read" are engine internals
 * and say nothing a customer wants said first.
 */
function buildSnapshotReading(dna: WardrobeDna): string | null {
  if (dna.traits.length === 0) return null;
  // Trait labels are adjectives in their own right ("Neutral-led", "Polished"),
  // so "leans neutral-led" reads twice. Strip the suffix and let the verb do it.
  const words = dna.traits
    .slice(0, 3)
    .map((t) => t.label.toLowerCase().replace(/^mostly /, "").replace(/-led$/, ""));
  return `Your wardrobe leans ${joinList(words)}.`;
}

function buildSnapshot(
  items: WardrobeGarment[],
  coverage: WardrobeCoverage,
  rediscoverCount: number,
): WardrobeMetric[] {
  const metrics: WardrobeMetric[] = [];

  metrics.push({
    id: "pieces",
    label: items.length === 1 ? "piece" : "pieces",
    value: items.length,
    caption: "in your Closet",
    state: "available",
    signal: "garment-fact",
  });

  // What the customer has told nAia is hard. STATED_STRUGGLE only — "unsure"
  // is a different feeling, and folding it in would make the number disagree
  // with the observation that names the same pieces.
  const difficult = items.filter((g) => statedAs(g, STATED_STRUGGLE)).length;
  if (difficult > 0) {
    metrics.push({
      id: "difficult",
      label: "marked difficult to style",
      value: difficult,
      caption: "by you",
      state: "available",
      signal: "self-reported-wardrobe",
    });
  }

  if (rediscoverCount > 0) {
    metrics.push({
      id: "rediscover",
      label: "worth rediscovering",
      value: rediscoverCount,
      caption: "pieces nAia would look at again",
      state: "available",
      signal: "naia-interaction",
    });
  }

  // Fall back to the self-reported regulars only when nothing sharper exists,
  // so the opening never drops to a single lonely number.
  if (metrics.length < 3 && coverage.relationshipCoverage >= 0.3) {
    const regulars = items.filter((g) => statedAs(g, STATED_REGULAR)).length;
    if (regulars > 0) {
      metrics.push({
        id: "regulars",
        label: "wardrobe regulars",
        value: regulars,
        caption: "pieces you've marked as favourites or ones you wear often",
        state: "available",
        signal: "self-reported-wardrobe",
      });
    }
  }

  return metrics.slice(0, 3);
}

// ── Wardrobe DNA ──────────────────────────────────────────────────────────────

function buildDna(items: WardrobeGarment[], coverage: WardrobeCoverage): WardrobeDna {
  const colourItems = items.filter((i) => norm(i.primaryColor) !== null);
  const paletteAvailable = coverage.colourCoverage >= COVERAGE_THRESHOLD && colourItems.length >= 3;

  const palette: PaletteColour[] = [];
  let paletteReading = "";

  if (paletteAvailable) {
    // Stored colours vary in case ("Black" vs "black"), so the key is normalised
    // before counting — otherwise one colour appears twice in the same palette.
    const counts = countBy(colourItems, (i) => norm(i.primaryColor));
    const neutralByColour = new Map<string, boolean>();
    for (const item of colourItems) {
      const key = norm(item.primaryColor)!;
      if (!neutralByColour.has(key) && item.colourProfile) {
        neutralByColour.set(key, item.colourProfile.wardrobeNeutral);
      }
    }
    for (const [colour, count] of topEntries(counts, MAX_PALETTE_COLOURS)) {
      const share = ratio(count, colourItems.length);
      if (share < PALETTE_MIN_SHARE && palette.length >= 3) continue;
      palette.push({ colour: titleCase(colour), count, share, neutral: neutralByColour.get(colour) ?? false });
    }
    paletteReading = buildPaletteReading(palette, colourItems);
  }

  const shapes: WardrobeShape[] = [];
  let shapesReading = "";

  if (coverage.shapeCoverage >= COVERAGE_THRESHOLD) {
    // A shape is only a wardrobe characteristic if it genuinely recurs. Appearing
    // twice in a 46-piece Closet is not a characteristic, it is a coincidence —
    // so the bar scales with the number of garments that can carry a shape.
    const coreCount = items.filter((i) => CORE_SLOTS.has(i.slot)).length;
    const minRecurrence = Math.max(3, Math.ceil(coreCount * 0.15));

    const silCounts = countBy(items, (i) => norm(i.silhouette));
    for (const [token, count] of topEntries(silCounts, MAX_SHAPES)) {
      if (count < minRecurrence) continue;
      shapes.push({ label: SILHOUETTE_LABELS[token] ?? titleCase(token), count, field: "silhouette" });
    }
    if (shapes.length < MAX_SHAPES) {
      const fitCounts = countBy(items, (i) => norm(i.fitProfile));
      for (const [token, count] of topEntries(fitCounts, MAX_SHAPES)) {
        if (count < minRecurrence) continue;
        const label = FIT_LABELS[token] ?? titleCase(token);
        if (shapes.some((sh) => sh.label === label)) continue;
        shapes.push({ label, count, field: "fitProfile" });
        if (shapes.length >= MAX_SHAPES) break;
      }
    }
    // Counts stay in the data as evidence; the customer reads the shape, not the tally.
    if (shapes.length > 1) {
      shapesReading = `${capitalise(shapes[0].label.toLowerCase())} shapes recur most, with ${joinList(shapes.slice(1, 3).map((sh) => sh.label.toLowerCase()))} close behind.`;
    } else if (shapes.length === 1) {
      shapesReading = `${capitalise(shapes[0].label.toLowerCase())} shapes recur across your wardrobe more than any other.`;
    }
  }

  const traits = buildTraits(items, coverage, palette);
  const anyAvailable = palette.length > 0 || shapes.length > 0 || traits.length > 0;

  return {
    state: anyAvailable ? "available" : "learning",
    learningNote: anyAvailable
      ? undefined
      : "nAia reads colour, shape and structure from each piece as you add it. A few more pieces and your wardrobe DNA appears here.",
    palette,
    paletteReading,
    shapes,
    shapesReading,
    traits,
  };
}

function buildPaletteReading(palette: PaletteColour[], colourItems: WardrobeGarment[]): string {
  if (palette.length === 0) return "";

  const withProfile = colourItems.filter((i) => i.colourProfile !== null);
  const neutralShare = withProfile.length > 0
    ? ratio(withProfile.filter((i) => i.colourProfile!.wardrobeNeutral).length, withProfile.length)
    : null;

  const leadNames = palette.slice(0, 3).map((p) => p.colour.toLowerCase());
  const chromatic = palette.filter((p) => !p.neutral).map((p) => p.colour.toLowerCase());
  const base = `${joinList(leadNames.map((n, idx) => (idx === 0 ? titleCase(n) : n)))} lead your palette`;

  if (neutralShare === null) return `${base}.`;
  if (neutralShare >= 0.7) {
    return chromatic.length > 0
      ? `${base}. Your wardrobe leans neutral, with ${joinList(chromatic)} adding depth.`
      : `${base}. Your wardrobe leans strongly neutral.`;
  }
  if (neutralShare >= 0.4) {
    return chromatic.length > 0
      ? `${base}. Neutrals form the base, and ${joinList(chromatic)} bring the colour.`
      : `${base}. Neutrals form the base of your wardrobe.`;
  }
  return `${base}. Colour, rather than neutrals, carries most of your wardrobe.`;
}

function buildTraits(
  items: WardrobeGarment[],
  coverage: WardrobeCoverage,
  palette: PaletteColour[],
): WardrobeTrait[] {
  const traits: WardrobeTrait[] = [];

  const withColourProfile = items.filter((i) => i.colourProfile !== null);
  if (withColourProfile.length >= 5 && ratio(withColourProfile.length, items.length) >= COVERAGE_THRESHOLD) {
    const neutrals = withColourProfile.filter((i) => i.colourProfile!.wardrobeNeutral).length;
    const share = ratio(neutrals, withColourProfile.length);
    if (share >= 0.65) {
      traits.push({
        id: "neutral-led",
        label: "Neutral-led",
        evidence: `${neutrals} of the ${withColourProfile.length} pieces nAia has read sit in your neutral range.`,
      });
    } else if (share <= 0.3) {
      traits.push({
        id: "colour-led",
        label: "Colour-led",
        evidence: `${withColourProfile.length - neutrals} of the ${withColourProfile.length} pieces nAia has read carry a clear colour.`,
      });
    }
  }

  const withFit = items.filter((i) => norm(i.fitProfile) !== null);
  if (withFit.length >= 5 && ratio(withFit.length, items.length) >= COVERAGE_THRESHOLD) {
    const structured = withFit.filter((i) => {
      const f = norm(i.fitProfile);
      return f === "tailored" || f === "structured";
    }).length;
    const soft = withFit.filter((i) => {
      const f = norm(i.fitProfile);
      return f === "relaxed" || f === "loose" || f === "oversized" || f === "flowy";
    }).length;
    if (ratio(structured, withFit.length) >= 0.5) {
      traits.push({
        id: "structured",
        label: "Mostly structured",
        evidence: `${structured} of the ${withFit.length} pieces with fit data read tailored or structured.`,
      });
    } else if (ratio(soft, withFit.length) >= 0.5) {
      traits.push({
        id: "relaxed",
        label: "Mostly relaxed",
        evidence: `${soft} of the ${withFit.length} pieces with fit data read relaxed or fluid.`,
      });
    }
  }

  if (coverage.formalityCoverage >= COVERAGE_THRESHOLD) {
    const buckets = formalityBuckets(items);
    const total = Array.from(buckets.values()).reduce((a, b) => a + b, 0);
    const lead = topEntries(buckets, 1)[0];
    if (lead && total > 0 && ratio(lead[1], total) >= 0.5) {
      const labelMap: Record<string, string> = { everyday: "Everyday-led", work: "Polished", occasion: "Occasion-led" };
      traits.push({
        id: `register-${lead[0]}`,
        label: labelMap[lead[0]] ?? titleCase(lead[0]),
        evidence: `${lead[1]} of the ${total} pieces nAia has assessed read ${FORMALITY_BUCKET_LABEL[lead[0]]}.`,
      });
    }
  }

  const withWeight = items.filter((i) => i.visualWeight !== null);
  if (withWeight.length >= 5 && ratio(withWeight.length, items.length) >= COVERAGE_THRESHOLD) {
    const counts = countBy(withWeight, (i) => i.visualWeight);
    const lead = topEntries(counts, 1)[0];
    // "medium" is the default reading for most garments — stating it tells the
    // customer nothing. Only a genuinely light or substantial wardrobe is a trait.
    if (lead && lead[0] !== "medium" && ratio(lead[1], withWeight.length) >= 0.5) {
      const labelMap: Record<string, string> = {
        light: "Light visual weight",
        substantial: "Substantial visual weight",
      };
      traits.push({
        id: `weight-${lead[0]}`,
        label: labelMap[lead[0]] ?? titleCase(lead[0]),
        evidence: `${lead[1]} of the ${withWeight.length} pieces nAia has read carry ${lead[0]} visual weight.`,
      });
    }
  }

  if (palette.length > 0 && palette[0].share >= 0.4) {
    traits.push({
      id: "palette-anchor",
      label: `${palette[0].colour}-anchored`,
      evidence: `${palette[0].count} of your colour-tagged pieces are ${palette[0].colour.toLowerCase()}.`,
    });
  }

  return traits;
}

function formalityBuckets(items: WardrobeGarment[]): Map<string, number> {
  return countBy(items, (i) => {
    const f = norm(i.formality);
    return f ? (FORMALITY_BUCKET[f] ?? null) : null;
  });
}

// ── Pairings ──────────────────────────────────────────────────────────────────

function buildPairings(
  items: WardrobeGarment[],
  seenCombinations: ReadonlySet<string>,
): WardrobePairings {
  const tops = items.filter((i) => TOP_SLOTS.has(i.slot));
  const bottoms = items.filter((i) => BOTTOM_SLOTS.has(i.slot));
  const onePieces = items.filter((i) => ONE_PIECE_SLOTS.has(i.slot));
  const outer = items.filter((i) => i.slot === "outerwear");

  const hasCore = (tops.length > 0 && bottoms.length > 0) || onePieces.length > 0;
  if (!hasCore) {
    return {
      state: "learning",
      learningNote: "Add pieces from more than one part of your wardrobe and nAia can start showing how they connect.",
      pairings: [],
      totalFound: 0,
      untriedPresentation: "none",
      untriedNote: null,
    };
  }

  const candidates: Array<{ ids: string[]; reasons: PairReason[]; score: number }> = [];

  for (const top of tops) {
    for (const bottom of bottoms) {
      const pair = scorePair(top, bottom);
      if (!pair.compatible) continue;
      let ids = [top.id, bottom.id];
      const reasons = [...pair.reasons];

      const layer = outer.find((o) => {
        if (o.id === top.id || o.id === bottom.id) return false;
        return scorePair(o, top).compatible && scorePair(o, bottom).compatible;
      });
      if (layer) {
        ids = [layer.id, top.id, bottom.id];
        reasons.push({ text: "The layer works over both halves, so it holds as one outfit.", weight: 6 });
      }
      reasons.sort((x, y) => y.weight - x.weight);
      candidates.push({ ids, reasons, score: reasons.reduce((sum, r) => sum + r.weight, 0) });
    }
  }

  for (const piece of onePieces) {
    const layer = outer.find((o) => scorePair(o, piece).compatible);
    if (layer) {
      const pair = scorePair(layer, piece);
      const reasons = [
        { text: "A layer over a one-piece gives you a second version of the same garment.", weight: 7 },
        ...pair.reasons,
      ];
      reasons.sort((x, y) => y.weight - x.weight);
      candidates.push({ ids: [layer.id, piece.id], reasons, score: reasons.reduce((sum, r) => sum + r.weight, 0) });
    }
  }

  if (candidates.length === 0) {
    return {
      state: "learning",
      learningNote: "nAia hasn't found a confident combination yet — colour, fit and level-of-dress detail on more pieces is what unlocks this.",
      pairings: [],
      totalFound: 0,
      untriedPresentation: "none",
      untriedNote: null,
    };
  }

  const ranked = candidates
    .map((c) => ({ ...c, untried: !seenCombinations.has(combinationKey(c.ids)) }))
    .sort((a, b) => b.score - a.score || combinationKey(a.ids).localeCompare(combinationKey(b.ids)));

  // Lead each relationship with the most specific TRUE thing not already said in
  // this section. Nothing is invented — a reason is only skipped, never made up.
  const usedReasons = new Set<string>();
  const used = new Set<string>();

  const toPairing = (candidate: (typeof ranked)[number]): WardrobePairing => {
    const lead = candidate.reasons.find((r) => !usedReasons.has(r.text)) ?? candidate.reasons[0];
    usedReasons.add(lead.text);
    const second = candidate.reasons.find((r) => r.text !== lead.text && !usedReasons.has(r.text));
    if (second) usedReasons.add(second.text);
    return {
      id: combinationKey(candidate.ids),
      garmentIds: candidate.ids,
      reason: second ? `${lead.text} ${second.text}` : lead.text,
      untried: candidate.untried,
      evidence: [
        ev("garment-fact", "formality/colourProfile/visualWeight/silhouette/occasions",
           candidate.reasons.map((r) => r.text).join(" "), candidate.ids),
        ...(candidate.untried
          ? [ev("naia-interaction", "OutfitItem", "This combination has not appeared in a look nAia generated.", candidate.ids)]
          : []),
      ],
    };
  };

  const take = (pool: typeof ranked, limit: number) => {
    const out: WardrobePairing[] = [];
    for (const candidate of pool) {
      if (out.length >= limit) break;
      if (candidate.ids.some((id) => used.has(id))) continue;
      candidate.ids.forEach((id) => used.add(id));
      out.push(toPairing(candidate));
    }
    return out;
  };

  // The strongest relationships first, then combinations nAia has never built —
  // one section, not two. An untried pairing is simply labelled as such.
  const strongest = take(ranked, MAX_PAIRINGS - 2);
  const untried = take(ranked.filter((c) => c.untried), 2);
  const pairings = [...strongest, ...untried];

  // "Not yet styled together by nAia" is never "never worn together" — the note
  // below says nAia, deliberately, because that is the only thing nAia knows.
  const novel = pairings.filter((p) => p.untried).length;
  const presentation: UntriedPresentation =
    novel === 0 ? "none" : novel === pairings.length ? "section" : "per-item";

  return {
    state: "available",
    pairings,
    totalFound: candidates.length,
    untriedPresentation: presentation,
    untriedNote:
      presentation === "section"
        ? "These are strong connections nAia hasn't put together in one of your looks yet."
        : null,
  };
}

// ── Heroes ────────────────────────────────────────────────────────────────────
//
// A hero is not simply "most connected". Each label answers a different question,
// and a label is only awarded when its own evidence threshold is met. Derived V2
// intention scoring is never used here — the gate would make heroes appear and
// disappear as validation state changes.

interface HeroCandidate {
  garment: WardrobeGarment;
  tier: HeroTier;
  /** Pieces this garment sits with — core-slot partners, or the garments a
   *  finishing piece finishes. */
  partners: WardrobeGarment[];
  partnerSlots: Set<string>;
  alignment: PassportAlignment;
  /** Count of unusually strong signals. Finishing pieces need these to qualify. */
  exceptional: number;
}

/** Pieces a garment demonstrably sits with, in the sense appropriate to its tier. */
function contextPartners(garment: WardrobeGarment, items: WardrobeGarment[]): WardrobeGarment[] {
  if (FINISHING_SLOTS.has(garment.slot)) {
    // A finishing piece finishes garments. Counted separately so it never inflates
    // a garment's own partner count.
    return items.filter(
      (other) => other.id !== garment.id && CORE_SLOTS.has(other.slot) && scorePair(garment, other).compatible,
    );
  }
  return partnersOf(garment, items);
}

/** The registers a garment's partners span, with at least two partners in each. */
function registerSpan(partners: WardrobeGarment[]): Array<[string, number]> {
  const buckets = new Map<string, number>();
  for (const partner of partners) {
    const bucket = FORMALITY_BUCKET[norm(partner.formality) ?? ""];
    if (bucket) buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
  }
  return Array.from(buckets.entries())
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1]);
}

function buildHeroes(
  items: WardrobeGarment[],
  passport: WardrobePassport | null,
): WardrobeHeroes {
  const activeRelevant = isActiveRelevant(items, passport);

  const hasInteractionHistory = items.some((g) => g.outfitAppearances > 0 || g.savedLookAppearances > 0);

  const candidates: HeroCandidate[] = items
    .filter((g) => g.slot !== "unknown")
    .map((garment) => {
      const partners = contextPartners(garment, items);
      const alignment = passportAlignmentFor(garment, passport);
      const tier = heroTier(garment);
      // Breadth is only evidence when it is earned. A finishing piece is
      // compatible with everything by construction, so its partner count says
      // nothing about it and is excluded from the exceptional-signal count.
      const exceptional =
        (statedAs(garment, STATED_REGULAR) ? 1 : 0) +
        (registerSpan(partners).length >= 2 ? 1 : 0) +
        (alignment.score >= PASSPORT_HERO_SCORE ? 1 : 0) +
        (garment.outfitAppearances + garment.savedLookAppearances >= 2 ? 1 : 0) +
        (tier !== "finishing" && partners.length >= 8 ? 1 : 0);
      return {
        garment,
        tier,
        partners,
        partnerSlots: new Set(partners.map((p) => p.slot)),
        alignment,
        exceptional,
      };
    });

  const used = new Set<string>();
  const usedSlots = new Set<string>();
  const heroes: WardrobeHero[] = [];
  let finishingHeroes = 0;
  let functionalHeroes = 0;

  /**
   * Whether a candidate may compete for a label.
   *
   * Connectivity labels (most versatile, closet connector) are closed to
   * finishing pieces: "it goes with everything" is a property of the category,
   * not of the piece. Evidence labels are open to every category, because
   * winning one requires a signal the customer or her use of nAia produced.
   */
  const eligible = (c: HeroCandidate, kind: "connectivity" | "evidence"): boolean => {
    if (c.tier === "core") return true;
    if (c.tier === "functional") {
      if (kind === "connectivity") return activeRelevant;
      if (activeRelevant) return true;
      if (c.exceptional < 2) return false;
      // Incidental activewear may earn a place, but not the whole section.
      return functionalHeroes === 0 || c.exceptional >= 4;
    }
    // finishing
    if (kind === "connectivity") return false;
    if (c.exceptional < 2) return false;
    // At most one finishing hero, unless the evidence is exceptional even by
    // finishing standards — otherwise the section fills with shoes and bags.
    return finishingHeroes === 0 || c.exceptional >= 4;
  };

  /** Core garments outrank finishing pieces unless the evidence is overwhelming. */
  const tierRank = (c: HeroCandidate): number => {
    if (c.tier === "core") return 2;
    // Activewear in a wardrobe that genuinely revolves around it is not a
    // second-class garment — relevance decides, then evidence.
    if (c.tier === "functional" && activeRelevant) return 2;
    if (c.exceptional >= 3) return 2;
    return c.tier === "functional" ? 1 : 0;
  };

  const pick = (
    label: HeroLabel,
    kind: "connectivity" | "evidence",
    qualifies: (c: HeroCandidate) => boolean,
    rank: (c: HeroCandidate) => number,
    build: (c: HeroCandidate) => { headline: string; reasons: string[]; evidence: Evidence[]; supporting: number },
  ) => {
    if (heroes.length >= MAX_HEROES) return;
    const pool = candidates
      .filter((c) => !used.has(c.garment.id) && eligible(c, kind) && qualifies(c))
      .sort(
        (a, b) =>
          tierRank(b) - tierRank(a) ||
          rank(b) - rank(a) ||
          a.garment.id.localeCompare(b.garment.id),
      );
    // Heroes should describe different parts of the wardrobe.
    const best = pool.find((c) => !usedSlots.has(c.garment.slot)) ?? pool[0];
    if (!best) return;
    const built = build(best);
    used.add(best.garment.id);
    usedSlots.add(best.garment.slot);
    if (best.tier === "finishing") finishingHeroes += 1;
    if (best.tier === "functional" && !activeRelevant) functionalHeroes += 1;
    heroes.push({
      garmentId: best.garment.id,
      tier: best.tier,
      evidenceScore: best.exceptional,
      name: displayName(best.garment),
      category: CATEGORY_PLURAL[best.garment.category] ?? best.garment.category.toLowerCase(),
      imageUrl: best.garment.imageUrl,
      label,
      labelText: HERO_LABEL_TEXT[label],
      headline: built.headline,
      reasons: built.reasons,
      evidence: built.evidence,
      strength: gradeStrength(built.evidence, built.supporting),
    });
  };

  // 1. MOST VERSATILE — the widest evidenced compatibility among your garments.
  pick(
    "most-versatile",
    "connectivity",
    (c) => c.partners.length >= 4,
    (c) => c.partners.length,
    (c) => ({
      headline: "One of your most versatile pieces.",
      reasons: [
        `Sits comfortably with ${c.partners.length} other pieces in your Closet.`,
        ...(c.garment.colourProfile?.wardrobeNeutral
          ? ["Its colour behaves as a wardrobe neutral, so it rarely limits what it goes with."]
          : []),
      ],
      evidence: [
        ev("garment-fact", "compatibility graph", `Compatible with ${c.partners.length} pieces across ${c.partnerSlots.size} parts of the wardrobe.`, c.partners.map((p) => p.id)),
      ],
      supporting: c.partners.length,
    }),
  );

  // 2. CLOSET CONNECTOR — bridges registers that otherwise don't meet.
  pick(
    "closet-connector",
    "connectivity",
    (c) => registerSpan(c.partners).length >= 2,
    (c) => registerSpan(c.partners).length * 100 + c.partners.length,
    (c) => {
      const spans = registerSpan(c.partners);
      const names = spans.map(([bucket]) => FORMALITY_BUCKET_SHORT[bucket]);
      return {
        headline: "It connects parts of your wardrobe that don't otherwise meet.",
        reasons: [
          `It works with both the ${names[0]} and the ${names[1]} side of your wardrobe.`,
          "Pieces that cross registers are what let a wardrobe stretch without growing.",
        ],
        evidence: [
          ev("garment-fact", "formality/compatibility graph", `Partners span ${joinList(names)} registers (${spans.map(([bucket, count]) => `${count} ${FORMALITY_BUCKET_SHORT[bucket]}`).join(", ")}).`, c.partners.map((p) => p.id)),
        ],
        supporting: c.partners.length,
      };
    },
  );

  // 3. PASSPORT MATCH — stable Passport attributes only, never intention scoring.
  //    A hero has to be more than a coincidence. Alignment on colour and shape
  //    alone scores 2 and is not enough on its own — it needs either a third,
  //    more distinctive dimension, or a second kind of signal entirely: the
  //    customer's own marking, or a real history inside nAia.
  const passportSupported = (c: HeroCandidate): boolean =>
    statedAs(c.garment, STATED_REGULAR) ||
    c.garment.outfitAppearances + c.garment.savedLookAppearances >= 2;
  pick(
    "passport-match",
    "evidence",
    (c) =>
      c.partners.length >= 2 &&
      (c.alignment.score >= PASSPORT_HERO_SCORE ||
        (c.alignment.score >= PASSPORT_HERO_SCORE_WITH_SUPPORT && passportSupported(c))),
    (c) => c.alignment.score * 10 + Math.min(c.partners.length, 6),
    (c) => {
      const reasons = [
        `Matches your Passport on ${joinList(c.alignment.dimensions)}.`,
        `And it still works with ${c.partners.length} other pieces you own.`,
      ];
      const evidence: Evidence[] = [
        ev("passport-signal", "OnboardingProfile", `Aligns on ${joinList(c.alignment.dimensions)} (weighted score ${c.alignment.score}).`, [c.garment.id]),
        ev("garment-fact", "compatibility graph", `Compatible with ${c.partners.length} pieces.`, c.partners.map((p) => p.id)),
      ];
      if (c.alignment.score < PASSPORT_HERO_SCORE) {
        // It cleared the bar on a second kind of signal — say which.
        if (statedAs(c.garment, STATED_REGULAR)) {
          evidence.push(ev("self-reported-wardrobe", "garmentRelationships", `Marked as ${describeRelationships(c.garment.garmentRelationships)}.`, [c.garment.id]));
        } else {
          evidence.push(ev("naia-interaction", "OutfitItem/SavedLookItem", `Appears in ${c.garment.outfitAppearances + c.garment.savedLookAppearances} generated or saved looks.`, [c.garment.id]));
        }
      }
      return {
        headline: "This is the piece closest to what you told nAia you want.",
        reasons,
        evidence,
        supporting: c.alignment.score + c.partners.length,
      };
    },
  );

  // 4. YOUR FAVOURITE — self-reported, and it earns its place structurally too.
  //    Open to shoes and bags: if the piece she reaches for most is her boots,
  //    that is the honest answer.
  pick(
    "your-favourite",
    "evidence",
    (c) => statedAs(c.garment, STATED_REGULAR) && c.partners.length >= 3,
    (c) => c.partners.length,
    (c) => ({
      headline: statedAs(c.garment, new Set(["favourite"]))
        ? "One of your favourites — and one of your most connected pieces."
        : "You've marked this as something you wear often, and your Closet agrees.",
      reasons: [
        statedAs(c.garment, new Set(["favourite"]))
          ? "You've marked this as one of your favourites."
          : "You've marked this as something you wear often.",
        `It also sits with ${c.partners.length} other pieces in your Closet.`,
      ],
      evidence: [
        ev("self-reported-wardrobe", "garmentRelationships", `Marked as ${describeRelationships(c.garment.garmentRelationships)}.`, [c.garment.id]),
        ev("garment-fact", "compatibility graph", `Compatible with ${c.partners.length} pieces.`, c.partners.map((p) => p.id)),
      ],
      supporting: c.partners.length,
    }),
  );

  // 5. UNTAPPED HERO — high utility, but nothing in your wardrobe life uses it.
  pick(
    "untapped-hero",
    "evidence",
    (c) =>
      c.partners.length >= 3 &&
      (statedAs(c.garment, STATED_LOW_USE) ||
        statedAs(c.garment, STATED_FRICTION) ||
        (hasInteractionHistory && c.garment.outfitAppearances === 0 && c.garment.savedLookAppearances === 0)),
    (c) => c.partners.length,
    (c) => {
      const selfReported = statedAs(c.garment, STATED_LOW_USE) || statedAs(c.garment, STATED_FRICTION);
      const evidence: Evidence[] = [
        ev("garment-fact", "compatibility graph", `Compatible with ${c.partners.length} pieces.`, c.partners.map((p) => p.id)),
      ];
      if (selfReported) {
        evidence.push(
          ev("self-reported-wardrobe", "garmentRelationships", `Marked as ${describeRelationships(c.garment.garmentRelationships)}.`, [c.garment.id]),
        );
      } else {
        evidence.push(
          ev("naia-interaction", "OutfitItem/SavedLookItem", "Has never appeared in a generated or saved look.", [c.garment.id]),
        );
      }
      return {
        headline: "More useful than its place in your wardrobe suggests.",
        reasons: [
          selfReported
            ? statedAs(c.garment, STATED_STRUGGLE)
              ? "You've marked this as one you love but struggle to style."
              : "You've marked this as one you rarely reach for."
            : "It hasn't appeared in a generated or saved look yet.",
          `Even so, it sits with ${c.partners.length} other pieces you already own.`,
        ],
        evidence,
        supporting: c.partners.length,
      };
    },
  );

  // ── Display cap ────────────────────────────────────────────────────────────
  // The eligibility engine may legitimately conclude that several finishing
  // pieces qualify. The SECTION should still read as a wardrobe, not a shelf of
  // accessories, so at most one survives — whichever the evidence ranks highest.
  // Nothing is promoted to backfill the freed slot: three heroes is a fine answer.
  const finishing = heroes.filter((h) => h.tier === "finishing");
  if (finishing.length > 1) {
    const keep = [...finishing].sort(
      (a, b) => b.evidenceScore - a.evidenceScore || a.garmentId.localeCompare(b.garmentId),
    )[0];
    for (const hero of finishing) {
      if (hero.garmentId === keep.garmentId) continue;
      heroes.splice(heroes.indexOf(hero), 1);
    }
  }

  if (heroes.length === 0) {
    return {
      state: "learning",
      learningNote:
        "Heroes appear once nAia can see how your pieces connect — colour, fit and level of dress on a few more pieces is all it needs.",
      heroes: [],
    };
  }

  return { state: "available", heroes };
}

/** Stable Passport attributes a garment matches. Never uses intention scoring. */
/**
 * How strongly a garment aligns with the Style Passport, as a weighted reading
 * rather than a count of matches.
 *
 * Dimensions are not equal. Style personality and silhouette preference are
 * distinctive — a garment matching one of those says something. Colour and shape
 * are common enough that a black, fitted anything will hit both by coincidence,
 * which is why colour + fit alone is worth 2 and cannot on its own make a
 * Wardrobe Hero. Structure and fit describe the same underlying fact, so they
 * share a single point rather than double-counting.
 *
 * Register/lifestyle relevance is deliberately NOT scored: on real wardrobes
 * almost every piece sits in the customer's dominant register, so it separates
 * nothing.
 */
interface PassportAlignment {
  /** Display names of the dimensions that matched, strongest first. */
  dimensions: string[];
  score: number;
}

const PASSPORT_ALIGNMENT_NONE: PassportAlignment = { dimensions: [], score: 0 };

function passportAlignmentFor(g: WardrobeGarment, passport: WardrobePassport | null): PassportAlignment {
  if (!passport) return PASSPORT_ALIGNMENT_NONE;

  const strong: string[] = [];
  const supporting: string[] = [];
  let score = 0;

  // Style personality — same V3 archetype vocabulary on both sides, no mapping.
  const personality = norm(g.stylePersonality);
  if (personality && passport.stylePersonalities.some((p) => norm(p) === personality)) {
    strong.push("style personality");
    score += 2;
  }

  // Silhouette preference.
  const silhouette = norm(g.silhouette);
  if (silhouette && passport.silhouette.some((sp) => norm(sp)?.includes(silhouette))) {
    strong.push("silhouette");
    score += 2;
  }

  // Shape: structure and fit are one fact, worth one point between them.
  const structure = norm(passport.structure);
  const fit = norm(g.fitProfile);
  let shapeMatched = false;
  if (structure && fit) {
    const wantsDefined = /structur|tailor|defin|sharp/.test(structure);
    const wantsSoft = /soft|relax|fluid|ease|drap/.test(structure);
    const isDefined = fit === "tailored" || fit === "structured";
    const isSoft = fit === "relaxed" || fit === "loose" || fit === "oversized" || fit === "flowy";
    if ((wantsDefined && isDefined) || (wantsSoft && isSoft)) {
      supporting.push("structure");
      shapeMatched = true;
    }
  }
  if (fit && passport.fitPreferences.some((pref) => norm(pref)?.includes(fit))) {
    supporting.push("fit");
    shapeMatched = true;
  }
  if (shapeMatched) score += 1;

  // Colour — family match, so "Burgundy" answers a stated "Red / Burgundy".
  const family = closetColourFamily(g.primaryColor);
  if (family && passportColourFamilies(passport.favoriteColors).has(family)) {
    supporting.push("colour");
    score += 1;
  }

  return { dimensions: [...strong, ...supporting], score };
}

/** Score at or above which Passport alignment is strong enough to stand alone. */
const PASSPORT_HERO_SCORE = 3;
/** Score that qualifies only when a second kind of signal supports it. */
const PASSPORT_HERO_SCORE_WITH_SUPPORT = 2;

// ── What nAia is noticing ─────────────────────────────────────────────────────
//
// Each observation must be traceable to real evidence and, where it helps, point
// at the garments behind it. Observations that merely restate a section above are
// suppressed rather than padded in.

interface ObservationDraft extends WardrobeObservation {
  priority: number;
}

/** Pieces that connect well but have no place in how the wardrobe is actually used. */
function untappedPieces(
  items: WardrobeGarment[],
  activeRelevant: boolean,
): {
  pieces: WardrobeGarment[];
  basis: "naia-interaction" | "self-reported-wardrobe" | null;
} {
  const hasInteractionHistory = items.some((g) => g.outfitAppearances > 0 || g.savedLookAppearances > 0);

  // Same relevance test heroes use: activewear belongs in an editorial claim
  // when it is genuinely part of how this customer dresses, not otherwise.
  const wellConnected = (g: WardrobeGarment) =>
    CORE_SLOTS.has(g.slot) &&
    (activeRelevant || !FUNCTIONAL_CATEGORIES.has(g.category)) &&
    partnersOf(g, items).length >= 3;

  if (hasInteractionHistory) {
    const pieces = items.filter(
      (g) => g.outfitAppearances === 0 && g.savedLookAppearances === 0 && wellConnected(g),
    );
    // An observation about most of a wardrobe is not an observation.
    if (pieces.length >= 2 && pieces.length <= items.length / 2) {
      return { pieces, basis: "naia-interaction" };
    }
  }

  const selfReported = items.filter(
    (g) => (statedAs(g, STATED_LOW_USE) || statedAs(g, STATED_FRICTION)) && wellConnected(g),
  );
  if (selfReported.length >= 2 && selfReported.length <= items.length / 2) {
    return { pieces: selfReported, basis: "self-reported-wardrobe" };
  }

  return { pieces: [], basis: null };
}

function buildObservations(
  items: WardrobeGarment[],
  coverage: WardrobeCoverage,
  passport: WardrobePassport | null,
  flags: WardrobeIntelligenceFlags,
  dnaStatesPalette: boolean,
  passportDimensionsShown: ReadonlySet<string>,
  pairings: WardrobePairings,
): WardrobeObservation[] {
  const drafts: ObservationDraft[] = [];

  const add = (
    draft: Omit<WardrobeObservation, "strength" | "tier"> & { supporting: number; priority: number },
  ) => {
    const { supporting, priority, ...rest } = draft;
    drafts.push({
      ...rest,
      tier: rest.kind.startsWith("contradiction-") ? "discovery" : "pattern",
      strength: gradeStrength(rest.evidence, supporting),
      priority,
    });
  };

  // ── CONTRADICTIONS ────────────────────────────────────────────────────────
  //
  // Where two signals disagree about the same garment. These are the most
  // interesting things nAia can say, because they are the things a customer
  // cannot see by looking at her own wardrobe — so they rank above any
  // descriptive observation such as "you own a lot of black".

  const coreGarments = items.filter((g) => CORE_SLOTS.has(g.slot));
  const partnerCounts = new Map<string, number>(
    coreGarments.map((g) => [g.id, partnersOf(g, items).length]),
  );
  const sortedCounts = Array.from(partnerCounts.values()).sort((a, b) => a - b);
  const medianPartners =
    sortedCounts.length > 0 ? sortedCounts[Math.floor(sortedCounts.length / 2)] : 0;
  const hasInteractions = items.some((g) => g.outfitAppearances > 0 || g.savedLookAppearances > 0);

  // 1. HIGH POTENTIAL + STRUGGLE.
  const contradictionStruggle = coreGarments
    .filter((g) => statedAs(g, STATED_FRICTION))
    .filter((g) => (partnerCounts.get(g.id) ?? 0) >= Math.max(4, medianPartners))
    .sort((a, b) => (partnerCounts.get(b.id) ?? 0) - (partnerCounts.get(a.id) ?? 0) || a.id.localeCompare(b.id))[0];
  if (contradictionStruggle) {
    const partners = partnersOf(contradictionStruggle, items);
    add({
      id: "contradiction-potential-struggle",
      kind: "contradiction-potential-struggle",
      headline: "Hard to style, but unusually well connected",
      observation: `You’ve marked ${displayName(contradictionStruggle)} as difficult to style, yet it connects with more of your Closet than most of what you own.`,
      explanation: "A piece like this is rarely the problem. It’s usually waiting for the right partner, and your Closet already holds several.",
      garmentIds: [contradictionStruggle.id, ...partners.slice(0, 5).map((p) => p.id)],
      evidence: [
        ev("self-reported-wardrobe", "garmentRelationships", `Marked as ${describeRelationships(contradictionStruggle.garmentRelationships)}.`, [contradictionStruggle.id]),
        ev("garment-fact", "compatibility graph", `${partners.length} compatible ${partners.length === 1 ? "partner" : "partners"} against a wardrobe median of ${medianPartners}.`, partners.map((p) => p.id)),
      ],
      action: { label: "See what it works with", kind: "see-pieces" },
      gated: false,
      supporting: partners.length,
      priority: 120,
    });
  }

  // 2. HIGH ALIGNMENT + LOW USE.
  if (hasInteractions) {
    const alignedUnused = coreGarments
      .filter((g) => g.id !== contradictionStruggle?.id)
      .filter((g) => g.outfitAppearances === 0 && g.savedLookAppearances === 0)
      .map((g) => ({ garment: g, alignment: passportAlignmentFor(g, passport), partners: partnerCounts.get(g.id) ?? 0 }))
      .filter((entry) => entry.alignment.score >= PASSPORT_HERO_SCORE && entry.partners >= 3)
      .sort((a, b) => b.alignment.score - a.alignment.score || b.partners - a.partners || a.garment.id.localeCompare(b.garment.id))[0];
    if (alignedUnused) {
      add({
        id: "contradiction-alignment-unused",
        kind: "contradiction-alignment-unused",
        // Never "worn": nAia has no wear data. The gap is in its own styling history.
        headline: "Strongly yours, but not yet in a look",
        observation: `${displayName(alignedUnused.garment)} matches what you told nAia you want and works with ${alignedUnused.partners} pieces you own — but it hasn’t appeared in one of your nAia looks yet.`,
        explanation: null,
        garmentIds: [alignedUnused.garment.id],
        evidence: [
          ev("passport-signal", "OnboardingProfile", `Matches your Passport on ${joinList(alignedUnused.alignment.dimensions)} (weighted score ${alignedUnused.alignment.score}).`, [alignedUnused.garment.id]),
          ev("garment-fact", "compatibility graph", `${alignedUnused.partners} compatible partners.`, [alignedUnused.garment.id]),
          ev("naia-interaction", "OutfitItem/SavedLookItem", "No appearance in a generated or saved look.", [alignedUnused.garment.id]),
        ],
        action: { label: "See pieces", kind: "see-pieces" },
        gated: false,
        supporting: alignedUnused.partners,
        priority: 115,
      });
    }
  }

  // 3. FAVOURITE + ISOLATED.
  const favourites = coreGarments
    .filter((g) => g.id !== contradictionStruggle?.id)
    .filter((g) => statedAs(g, STATED_REGULAR));
  if (favourites.length >= 3 && medianPartners >= 3) {
    const isolated = favourites
      .filter((g) => (partnerCounts.get(g.id) ?? 0) <= Math.max(1, Math.floor(medianPartners / 3)))
      .sort((a, b) => (partnerCounts.get(a.id) ?? 0) - (partnerCounts.get(b.id) ?? 0) || a.id.localeCompare(b.id))[0];
    if (isolated) {
      const count = partnerCounts.get(isolated.id) ?? 0;
      add({
        id: "contradiction-favourite-isolated",
        kind: "contradiction-favourite-isolated",
        headline: "A favourite with fewer ways to wear it",
        observation: `You’ve marked ${displayName(isolated)} as one you reach for, but it has fewer natural partners in your Closet than most of your favourites.`,
        explanation: "That usually means you’re wearing it the same way each time — not that it’s the wrong piece.",
        garmentIds: [isolated.id],
        evidence: [
          ev("self-reported-wardrobe", "garmentRelationships", `Marked as ${describeRelationships(isolated.garmentRelationships)}.`, [isolated.id]),
          ev("garment-fact", "compatibility graph", `${count} compatible ${count === 1 ? "partner" : "partners"} against a wardrobe median of ${medianPartners}.`, [isolated.id]),
        ],
        action: { label: "See pieces", kind: "see-pieces" },
        gated: false,
        supporting: favourites.length,
        priority: 110,
      });
    }
  }

  // ── STRUGGLE PATTERN — the most actionable thing a customer can tell nAia ──
  const struggling = items.filter((g) => statedAs(g, STATED_STRUGGLE));
  const shared = struggling.length >= 2 ? sharedAttribute(struggling) : null;
  // When the contradiction above already named a specific struggling piece and
  // this group has no shared attribute to add, the generic version says less
  // about the same pieces — so it is dropped rather than stacked.
  if (struggling.length >= 2 && (shared !== null || !contradictionStruggle)) {
    const evidence: Evidence[] = [
      ev(
        "self-reported-wardrobe",
        "garmentRelationships",
        `${struggling.length} pieces marked "I love it but struggle to style it".`,
        struggling.map((g) => g.id),
      ),
    ];
    let explanation =
      "The difficulty is usually about how a piece connects to the rest of your wardrobe, not whether it belongs there.";
    if (shared) {
      evidence.push(ev("garment-fact", shared.field, shared.detail, shared.garmentIds));
      explanation = `${capitalise(shared.phrase)} — which points at a pattern rather than a set of one-off problems.`;
    }
    add({
      id: "struggle-pattern",
      kind: "struggle-pattern",
      headline: "A pattern in what's hard to style",
      observation: `You've marked ${struggling.length} pieces as ones you love but find difficult to style.`,
      explanation,
      garmentIds: struggling.map((g) => g.id),
      evidence,
      action: { label: "See pieces", kind: "see-pieces" },
      gated: false,
      supporting: struggling.length,
      priority: 100,
    });
  }

  // ── UNTAPPED POTENTIAL ────────────────────────────────────────────────────
  const untapped = untappedPieces(items, isActiveRelevant(items, passport));
  if (untapped.pieces.length >= 2 && untapped.basis) {
    const ids = untapped.pieces.map((g) => g.id);
    const naiaBased = untapped.basis === "naia-interaction";
    add({
      id: "untapped-potential",
      kind: "untapped-potential",
      headline: "These pieces have more in them than they're getting",
      observation: naiaBased
        ? `${untapped.pieces.length} pieces connect well with your wardrobe but haven't appeared in a saved or generated look yet.`
        : `${untapped.pieces.length} pieces you've marked as hard to reach for connect well with the rest of your wardrobe.`,
      explanation: "Usually this is a styling context problem rather than a reason to let the piece go.",
      garmentIds: ids,
      evidence: [
        ev(
          untapped.basis,
          naiaBased ? "OutfitItem/SavedLookItem" : "garmentRelationships",
          naiaBased
            ? "No appearance in any generated outfit or saved look."
            : "Marked rarely-wear, regret, struggle or unsure.",
          ids,
        ),
        ev("garment-fact", "compatibility graph", "Each of these sits with at least 3 other pieces you own.", ids),
      ],
      action: { label: "See pieces", kind: "see-pieces" },
      gated: false,
      supporting: untapped.pieces.length,
      priority: 90,
    });
  }

  // ── REPETITION ────────────────────────────────────────────────────────────
  // Keyed on SLOT as well as category: joggers, shorts and a hoodie are all black
  // relaxed activewear, but they do not do the same job, and saying so is wrong.
  const clusters = new Map<string, WardrobeGarment[]>();
  for (const g of items) {
    const colour = norm(g.primaryColor);
    const fit = norm(g.fitProfile) ?? norm(g.silhouette);
    if (!colour || !fit) continue;
    const key = `${g.category}|${g.slot}|${colour}|${fit}`;
    if (!clusters.has(key)) clusters.set(key, []);
    clusters.get(key)!.push(g);
  }
  const biggestCluster = Array.from(clusters.entries())
    .filter(([, group]) => group.length >= 3)
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))[0];
  if (biggestCluster) {
    const [key, group] = biggestCluster;
    const [category, slot, colour, fit] = key.split("|");
    // Prefer the shared subcategory ("3 black relaxed joggers") over the broad
    // category label, falling back to the slot for mixed or functional categories.
    const subcategories = new Set(group.map((g) => norm(g.subcategory)).filter(Boolean));
    const noun =
      subcategories.size === 1
        ? pluralise(Array.from(subcategories)[0]!)
        : FUNCTIONAL_CATEGORIES.has(category)
          ? `${CATEGORY_PLURAL[category] ?? category.toLowerCase()} ${slotPlural(slot)}`
          : CATEGORY_PLURAL[category] ?? category.toLowerCase();
    const label = `${colour} ${FIT_LABELS[fit]?.toLowerCase() ?? fit} ${noun}`;
    add({
      id: "repetition",
      kind: "repetition",
      headline: "You have several pieces doing a very similar job",
      observation: `You own ${group.length} ${label} with very similar styling roles.`,
      explanation: "Pieces this close together compete for the same moment, which can make a wardrobe feel smaller than it is.",
      garmentIds: group.map((g) => g.id),
      evidence: [
        ev("garment-fact", "category/slot/primaryColor/fitProfile", `${group.length} pieces share category ${category}, slot ${slot}, colour ${colour} and fit ${fit}.`, group.map((g) => g.id)),
      ],
      action: { label: "See pieces", kind: "see-pieces" },
      gated: false,
      supporting: group.length,
      priority: 80,
    });
  }

  // ── WARDROBE IMBALANCE ────────────────────────────────────────────────────
  if (coverage.formalityCoverage >= COVERAGE_THRESHOLD) {
    const buckets = formalityBuckets(items);
    // An imbalance needs two sides. A wardrobe sitting entirely in one register is
    // not an imbalance — the Wardrobe DNA trait already says that, and repeating it
    // here as "6 against 0" reads as a verdict rather than an observation.
    const present = Array.from(buckets.entries())
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1]);
    const [leadKey, leadCount] = present[0] ?? ["everyday", 0];
    const [thinKey, thinCount] = present[present.length - 1] ?? ["everyday", 0];
    if (present.length >= 2 && leadCount >= 4 && leadCount >= thinCount * 3) {
      const leadIds = items
        .filter((g) => FORMALITY_BUCKET[norm(g.formality) ?? ""] === leadKey)
        .map((g) => g.id);
      add({
        id: "wardrobe-imbalance",
        kind: "wardrobe-imbalance",
        headline: "Your wardrobe is stronger in one register",
        observation: `Your wardrobe leans heavily ${FORMALITY_BUCKET_SHORT[leadKey]}.`,
        explanation: `${leadCount} of the ${leadCount + thinCount} pieces in that comparison sit on the ${FORMALITY_BUCKET_SHORT[leadKey]} side. Neither is wrong — it tells you which side of your life your wardrobe is currently built for.`,
        garmentIds: leadIds,
        evidence: [
          ev("garment-fact", "formality", `${leadCount} pieces read ${FORMALITY_BUCKET_LABEL[leadKey]}, ${thinCount} read ${FORMALITY_BUCKET_LABEL[thinKey]}.`, leadIds),
        ],
        action: null,
        gated: false,
        supporting: leadCount,
        priority: 70,
      });
    }
  }

  // ── COLOUR PATTERN — only when it says something the DNA section doesn't ──
  const colourObservation = buildColourObservation(items, dnaStatesPalette);
  if (colourObservation) {
    add({ ...colourObservation, priority: 60 });
  }

  // ── SELF-REPORTED REACH — what you own versus what you say you reach for ──
  if (coverage.relationshipCoverage >= COVERAGE_THRESHOLD) {
    const tagged = items.filter(
      (g) => (g.garmentRelationships ?? []).length > 0 && g.colourProfile !== null,
    );
    const regulars = tagged.filter((g) => statedAs(g, STATED_REGULAR));
    const lowUse = tagged.filter((g) => statedAs(g, STATED_LOW_USE) || statedAs(g, STATED_FRICTION));
    if (regulars.length >= 3 && lowUse.length >= 3) {
      const regularChromatic = ratio(regulars.filter((g) => !g.colourProfile!.wardrobeNeutral).length, regulars.length);
      const lowUseChromatic = ratio(lowUse.filter((g) => !g.colourProfile!.wardrobeNeutral).length, lowUse.length);
      if (lowUseChromatic - regularChromatic >= 0.3) {
        const colourfulIds = lowUse.filter((g) => !g.colourProfile!.wardrobeNeutral).map((g) => g.id);
        add({
          id: "self-reported-reach",
          kind: "self-reported-reach",
          headline: "You own more colour than you reach for",
          observation:
            "The pieces you've marked as ones you reach for are mostly neutral, while most of your colour sits in pieces you've marked as rarely worn.",
          explanation: "Colour is usually easier to wear when it has a neutral anchor beside it — which your wardrobe already has.",
          garmentIds: colourfulIds,
          evidence: [
            ev("self-reported-wardrobe", "garmentRelationships", `${regulars.length} pieces marked as regulars, ${lowUse.length} marked as rarely worn or difficult.`, [...regulars, ...lowUse].map((g) => g.id)),
            ev("garment-fact", "colourProfile", `${Math.round(lowUseChromatic * 100)}% of the low-use pieces carry colour, against ${Math.round(regularChromatic * 100)}% of the regulars.`, colourfulIds),
          ],
          action: { label: "See pieces", kind: "see-pieces" },
          gated: false,
          supporting: lowUse.length + regulars.length,
          priority: 65,
        });
      }
    }
  }

  // ── PASSPORT ALIGNMENT — only on a dimension the comparison section omits ──
  if (
    passport &&
    !passportDimensionsShown.has("structure") &&
    coverage.shapeCoverage >= COVERAGE_THRESHOLD
  ) {
    const structure = norm(passport.structure);
    const withFit = items.filter((g) => norm(g.fitProfile) !== null);
    if (structure && withFit.length >= 5 && /structur|tailor|defin|sharp/.test(structure)) {
      const structured = withFit.filter((g) => {
        const f = norm(g.fitProfile);
        return f === "tailored" || f === "structured";
      });
      if (ratio(structured.length, withFit.length) >= 0.5) {
        add({
          id: "passport-alignment",
          kind: "passport-alignment",
          headline: "Your Passport and your Closet agree",
          observation: `Your preference for structured pieces is strongly reflected in what you own — ${structured.length} of the ${withFit.length} pieces nAia has read are tailored or structured.`,
          explanation: null,
          garmentIds: structured.map((g) => g.id),
          evidence: [
            ev("passport-signal", "OnboardingProfile.structure", `Stated preference: ${passport.structure}.`, []),
            ev("garment-fact", "fitProfile", `${structured.length} of ${withFit.length} pieces read tailored or structured.`, structured.map((g) => g.id)),
          ],
          action: null,
          gated: false,
          supporting: structured.length,
          priority: 50,
        });
      }
    }
  }

  // ── INTENTION CONCENTRATION — GATED (Phase 3C V2 shadow intelligence) ─────
  const intentionItems = items.filter((g) => usableIntentions(g, flags) !== null);
  if (intentionItems.length >= 5) {
    const strongCounts = new Map<string, WardrobeGarment[]>();
    for (const g of intentionItems) {
      for (const intention of strongIntentions(g, flags)) {
        if (!strongCounts.has(intention)) strongCounts.set(intention, []);
        strongCounts.get(intention)!.push(g);
      }
    }
    const lead = Array.from(strongCounts.entries()).sort((a, b) => b[1].length - a[1].length)[0];
    if (lead && lead[1].length >= 4) {
      const [intention, group] = lead;
      // "gated" means this claim rests on shadow V2 output, not simply that it
      // involves intentions — curated and admin-reviewed values are not gated.
      const usedDerived = group.some((g) => g.intentionsSource === "derived");
      add({
        id: "intention-concentration",
        kind: "intention-concentration",
        headline: "Your strongest pieces pull the same way",
        observation: `Your wardrobe is built, above all, to help you ${INTENTION_LABELS[intention] ?? intention}.`,
        explanation: `${group.length} of your pieces read strongest for that. It’s a clear strength — and it means other moods have fewer pieces behind them.`,
        garmentIds: group.map((g) => g.id),
        evidence: [
          ev("garment-fact", "intentionPotentials", `${group.length} pieces rated "strong" for ${intention} (${usedDerived ? "includes derived V2 output" : "human-reviewed"}).`, group.map((g) => g.id)),
        ],
        action: { label: "See pieces", kind: "see-pieces" },
        gated: usedDerived,
        supporting: group.length,
        priority: 55,
      });
    }
  }

  // ── CONNECTION DENSITY ────────────────────────────────────────────────────
  //
  // The baseline reading. It needs nothing but garment facts, so the section
  // still says something real for a customer with no self-reports, no nAia
  // history and the V2 intention gate closed.
  if (pairings.state === "available") {
    const tops = items.filter((i) => TOP_SLOTS.has(i.slot));
    const bottoms = items.filter((i) => BOTTOM_SLOTS.has(i.slot));
    const onePieces = items.filter((i) => ONE_PIECE_SLOTS.has(i.slot));
    const outer = items.filter((i) => i.slot === "outerwear");
    // Mirrors the candidate space buildPairings() walks: every top x bottom pair,
    // plus each one-piece when there is a layer to put over it.
    const possible = tops.length * bottoms.length + (outer.length > 0 ? onePieces.length : 0);

    if (possible >= 4) {
      const density = ratio(pairings.totalFound, possible);
      const coreIds = [...tops, ...bottoms, ...onePieces, ...outer].map((g) => g.id);
      // The ratio is an internal measure. What the customer reads is the meaning
      // of it — the count follows as supporting evidence, never as the headline.
      if (density >= 0.75) {
        add({
          id: "connection-density",
          kind: "connection-density",
          headline: "You have a strong base wardrobe",
          observation: "Most of your core pieces already have several ways to work together.",
          explanation: `That’s what a consistent palette and a steady level of dress buy you — nAia can build ${pairings.totalFound} combinations from what you own without you adding anything.`,
          garmentIds: coreIds,
          evidence: [
            ev("garment-fact", "compatibility graph", `${pairings.totalFound} of ${possible} possible core combinations pass on colour, level of dress and visual weight (${Math.round(density * 100)}%).`, coreIds),
          ],
          action: null,
          gated: false,
          supporting: coreIds.length,
          priority: 45,
        });
      } else if (density <= 0.35) {
        add({
          id: "connection-density",
          kind: "connection-density",
          headline: "Your pieces connect less often than their number suggests",
          observation: "Most of your core pieces have only one or two natural partners in your Closet.",
          explanation: "Usually this is a split in colour or level of dress rather than a shortage of clothes — a wardrobe living in two halves that don’t meet.",
          garmentIds: coreIds,
          evidence: [
            ev("garment-fact", "compatibility graph", `${pairings.totalFound} of ${possible} possible core combinations pass (${Math.round(density * 100)}%).`, coreIds),
          ],
          action: null,
          gated: false,
          supporting: coreIds.length,
          priority: 45,
        });
      }
    }
  }

  const strengthRank: Record<EvidenceStrength, number> = { strong: 2, moderate: 1, emerging: 0 };
  return drafts
    .sort((a, b) => (b.priority - a.priority) || (strengthRank[b.strength] - strengthRank[a.strength]))
    .slice(0, MAX_OBSERVATIONS)
    .map((draft) => {
      const observation: WardrobeObservation = { ...draft };
      delete (observation as Partial<ObservationDraft>).priority;
      return observation;
    });
}

/** The single attribute a set of garments most clearly has in common, if any. */
function sharedAttribute(
  group: WardrobeGarment[],
): { field: string; detail: string; phrase: string; garmentIds: string[] } | null {
  const checks: Array<{
    field: string;
    value: (g: WardrobeGarment) => string | null;
    phrase: (value: string, count: number) => string;
  }> = [
    {
      field: "category",
      value: (g) => g.category,
      phrase: (value, count) => `${count} of them are ${CATEGORY_PLURAL[value] ?? value.toLowerCase()}`,
    },
    {
      field: "fitProfile",
      value: (g) => norm(g.fitProfile),
      phrase: (value, count) => `${count} of them share a ${FIT_LABELS[value]?.toLowerCase() ?? value} fit`,
    },
    {
      field: "silhouette",
      value: (g) => norm(g.silhouette),
      phrase: (value, count) => `${count} of them share a ${SILHOUETTE_LABELS[value]?.toLowerCase() ?? value} silhouette`,
    },
    {
      field: "primaryColor",
      value: (g) => norm(g.primaryColor),
      phrase: (value, count) => `${count} of them are ${value}`,
    },
  ];

  for (const check of checks) {
    // Shape fields are only meaningful on garments. A Chelsea boot recorded with
    // silhouette "straight" is vocabulary noise, and letting it into a shared-
    // attribute claim produces a pattern that isn't there.
    const pool = check.field === "category" || check.field === "primaryColor"
      ? group
      : group.filter((g) => CORE_SLOTS.has(g.slot));
    if (pool.length < 2) continue;
    const counts = countBy(pool, check.value);
    const lead = topEntries(counts, 1)[0];
    if (!lead) continue;
    const [value, count] = lead;
    if (count >= 2 && ratio(count, pool.length) >= 0.6 && ratio(count, group.length) >= 0.5) {
      const ids = pool.filter((g) => check.value(g) === value).map((g) => g.id);
      return {
        field: check.field,
        detail: `${count} of the ${pool.length} garments among them share ${check.field} = ${value}.`,
        phrase: check.phrase(value, count),
        garmentIds: ids,
      };
    }
  }
  return null;
}

/**
 * Colour is only worth an observation when it says something the Wardrobe DNA
 * palette does not already say. The strong form is concentration: all of the
 * colour living in one part of the wardrobe.
 */
function buildColourObservation(
  items: WardrobeGarment[],
  dnaStatesPalette: boolean,
): (Omit<WardrobeObservation, "strength" | "tier"> & { supporting: number }) | null {
  const withProfile = items.filter((g) => g.colourProfile !== null);
  if (withProfile.length < 5) return null;

  const chromatic = withProfile.filter((g) => !g.colourProfile!.wardrobeNeutral);
  const slots = new Set(withProfile.map((g) => g.slot));

  if (chromatic.length >= 3 && slots.size >= 2) {
    const bySlot = countBy(chromatic, (g) => g.slot);
    const lead = topEntries(bySlot, 1)[0];
    if (lead && ratio(lead[1], chromatic.length) >= 0.8) {
      const otherSlots = Array.from(slots).filter((s) => s !== lead[0]);
      const ids = chromatic.filter((g) => g.slot === lead[0]).map((g) => g.id);
      return {
        id: "colour-pattern",
        kind: "colour-pattern",
        headline: "All of your colour lives in one place",
        observation: `${lead[1]} of the ${chromatic.length} pieces carrying real colour are ${slotPlural(lead[0])} — everything else you own is neutral.`,
        explanation: `It means your ${joinList(otherSlots.map(slotPlural))} are doing the anchoring, and any colour you add elsewhere will have plenty to sit against.`,
        garmentIds: ids,
        evidence: [
          ev("garment-fact", "colourProfile/slot", `${lead[1]} of ${chromatic.length} chromatic pieces sit in the ${lead[0]} slot.`, ids),
        ],
        action: { label: "See pieces", kind: "see-pieces" },
        gated: false,
        supporting: chromatic.length,
      };
    }
  }

  // Fallback: the plain neutral reading, and only when the DNA section is silent.
  if (!dnaStatesPalette) {
    const neutrals = withProfile.filter((g) => g.colourProfile!.wardrobeNeutral);
    if (ratio(neutrals.length, withProfile.length) >= 0.7) {
      return {
        id: "colour-pattern",
        kind: "colour-pattern",
        headline: "Most of your Closet sits within a neutral palette",
        observation: `${neutrals.length} of the ${withProfile.length} pieces nAia has read behave as wardrobe neutrals.`,
        explanation: "That's why so many of your pieces go together — and why one colourful piece goes a long way.",
        garmentIds: neutrals.map((g) => g.id),
        evidence: [
          ev("garment-fact", "colourProfile", `${neutrals.length} of ${withProfile.length} pieces are wardrobe neutrals.`, neutrals.map((g) => g.id)),
        ],
        action: { label: "See pieces", kind: "see-pieces" },
        gated: false,
        supporting: neutrals.length,
      };
    }
  }

  return null;
}

function pluralise(noun: string): string {
  const lower = noun.toLowerCase();
  if (/(s|x|z|ch|sh)$/.test(lower)) return `${lower}es`;
  if (/[^aeiou]y$/.test(lower)) return `${lower.slice(0, -1)}ies`;
  return lower.endsWith("s") ? lower : `${lower}s`;
}

function slotPlural(slot: string): string {
  const map: Record<string, string> = {
    top: "tops", bottom: "bottoms", dress: "dresses", set: "sets",
    outerwear: "outer layers", shoe: "shoes", bag: "bags",
    accessory: "accessories", jewelry: "jewellery", unknown: "other pieces",
  };
  return map[slot] ?? `${slot}s`;
}

// ── Opportunities ─────────────────────────────────────────────────────────────

function buildOpportunities(
  items: WardrobeGarment[],
  passport: WardrobePassport | null,
): WardrobeOpportunities {
  const rediscover = buildRediscover(items, passport);

  const worthConsidering = findGaps(items, passport);
  const anything = rediscover.length > 0 || worthConsidering.length > 0;

  return {
    state: anything ? "available" : "learning",
    learningNote: anything
      ? undefined
      : "Opportunities appear once nAia can see enough of your wardrobe to tell a real gap from a piece you simply haven't styled yet.",
    rediscover,
    worthConsidering,
    // A wardrobe with no evidenced gap is a finding, not an empty state.
    noGapNote:
      worthConsidering.length === 0 && items.length >= MIN_WARDROBE_SIZE
        ? "Nothing obvious is missing right now. Based on what nAia can currently see, the wardrobe roles you need are already represented."
        : null,
  };
}

/**
 * REDISCOVER ranks pieces the customer already owns and is probably underusing.
 * Evidence considered: self-reported relationship, absence from generated outfits
 * and saved looks, compatibility with the rest of the Closet, and Passport fit.
 * A piece only qualifies if it carries at least one underuse signal AND is
 * demonstrably usable with what she already owns.
 */
function buildRediscover(items: WardrobeGarment[], passport: WardrobePassport | null): RediscoverPiece[] {
  const hasInteractionHistory = items.some((g) => g.outfitAppearances > 0 || g.savedLookAppearances > 0);
  const activeRelevant = isActiveRelevant(items, passport);

  // When several pieces qualify on the same signal, only the first states it in
  // full. Repeating the preamble three times makes one finding look like three.
  const signalUses = new Map<string, number>();
  const REDISCOVER_COPY: Readonly<Record<string, ReadonlyArray<(count: string) => string>>> = {
    rarely: [
      (c) => `You've said you rarely reach for this piece. nAia can see ${c} in your Closet it sits with comfortably.`,
      (c) => `Another you've said you rarely reach for — ${c} you own work with it.`,
      (c) => `Also rarely reached for, and also better connected than it looks: ${c} sit with it.`,
    ],
    struggle: [
      (c) => `You've marked this as one you love but struggle to style. The connections are already there — ${c} you own work with it.`,
      (c) => `Also marked difficult to style, though ${c} in your Closet meet it comfortably.`,
      (c) => `A third you've marked as hard to style. ${capitalise(c)} work with it.`,
    ],
    unstyled: [
      (c) => `This hasn't appeared in one of your nAia looks yet, though it works with ${c} you already own.`,
      (c) => `Another that hasn't reached one of your nAia looks — ${c} you own work with it.`,
      (c) => `Also absent from your nAia looks so far, despite ${c} that work with it.`,
    ],
  };
  const rediscoverBody = (lead: string, count: string, passportClause: string): string => {
    const seen = signalUses.get(lead) ?? 0;
    signalUses.set(lead, seen + 1);
    const variants = REDISCOVER_COPY[lead] ?? REDISCOVER_COPY.unstyled;
    return `${variants[Math.min(seen, variants.length - 1)](count)}${passportClause}`;
  };

  const scored = items
    .map((garment) => {
      const partners = partnersOf(garment, items);
      const evidence: Evidence[] = [];
      let score = 0;
      let underused = false;
      let lead: "rarely" | "struggle" | "unstyled" | null = null;

      if (statedAs(garment, STATED_LOW_USE)) {
        score += 3;
        underused = true;
        lead = "rarely";
        evidence.push(ev("self-reported-wardrobe", "garmentRelationships", "You've marked this as one you rarely reach for.", [garment.id]));
      }
      if (statedAs(garment, STATED_STRUGGLE) || statedAs(garment, STATED_UNSURE)) {
        score += 3;
        underused = true;
        lead = lead ?? "struggle";
        evidence.push(ev("self-reported-wardrobe", "garmentRelationships", "You've marked this as one you find hard to style or aren't sure about.", [garment.id]));
      }
      if (hasInteractionHistory && garment.outfitAppearances === 0 && garment.savedLookAppearances === 0) {
        score += 2;
        underused = true;
        lead = lead ?? "unstyled";
        evidence.push(ev("naia-interaction", "OutfitItem/SavedLookItem", "Has never appeared in a generated outfit or a saved look.", [garment.id]));
      }

      // Core garments only, for the same reason heroes are: a scarf "works with"
      // everything, which makes the claim true and useless.
      if (!CORE_SLOTS.has(garment.slot) || !underused || partners.length < 3) return null;

      score += Math.min(partners.length, 8);
      evidence.push(
        ev("garment-fact", "compatibility graph", `Works with ${partners.length} pieces you already own.`, partners.map((p) => p.id)),
      );

      // Ranked down only when activewear is incidental to this customer's life.
      if (!activeRelevant && FUNCTIONAL_CATEGORIES.has(garment.category)) score -= 6;

      const alignment = passportAlignmentFor(garment, passport);
      const matches = alignment.dimensions;
      if (alignment.score > 0) {
        score += alignment.score * 2;
        evidence.push(ev("passport-signal", "OnboardingProfile", `Matches your Passport on ${joinList(matches)} (weighted score ${alignment.score}).`, [garment.id]));
      }

      // The sentence follows the signal that actually surfaced the piece, so three
      // rediscoveries do not read as three copies of one template. The provenance
      // wording is load-bearing: a self-report says "you've said", nAia history
      // says "hasn't appeared in one of your nAia looks" — never "not worn".
      const count = `${partners.length} ${partners.length === 1 ? "piece" : "pieces"}`;
      const passportClause = matches.length > 0
        ? ` It also matches your Passport on ${joinList(matches)}.`
        : "";
      // `lead` is always set by the time a piece qualifies; the fallback keeps
      // the types honest rather than asserting.
      return {
        garmentId: garment.id,
        name: displayName(garment),
        imageUrl: garment.imageUrl,
        lead: lead ?? "unstyled",
        count,
        passportClause,
        body: "",
        worksWithIds: partners.slice(0, 6).map((p) => p.id),
        evidence,
        strength: gradeStrength(evidence, partners.length),
        score,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b.score - a.score || a.garmentId.localeCompare(b.garmentId))
    .slice(0, MAX_REDISCOVER);

  // Copy is written here, in display order, so the "also" and "a third" wording
  // matches what the customer actually reads.
  return scored.map((entry) => {
    const piece: RediscoverPiece = {
      garmentId: entry.garmentId,
      name: entry.name,
      imageUrl: entry.imageUrl,
      body: rediscoverBody(entry.lead, entry.count, entry.passportClause),
      worksWithIds: entry.worksWithIds,
      evidence: entry.evidence,
      strength: entry.strength,
    };
    return piece;
  });
}

/**
 * A gap is a repeated, evidenced need the existing wardrobe cannot solve.
 *
 * The internal question is always asked first: can this be solved with something
 * she already owns? Only when the answer is genuinely no does a gap appear.
 * "You don't own a beige blazer" is never a gap.
 */
function findGaps(items: WardrobeGarment[], passport: WardrobePassport | null): WardrobeGap[] {
  const gaps: WardrobeGap[] = [];

  const tops = items.filter((i) => TOP_SLOTS.has(i.slot));
  const bottoms = items.filter((i) => BOTTOM_SLOTS.has(i.slot));
  const outer = items.filter((i) => i.slot === "outerwear");
  const core = [...tops, ...bottoms, ...items.filter((i) => ONE_PIECE_SLOTS.has(i.slot))];

  // 1. Stranded halves — pieces with no compatible counterpart anywhere in the Closet.
  const complements: Array<[WardrobeGarment[], WardrobeGarment[], string, string]> = [
    [tops, bottoms, "tops", "bottom"],
    [bottoms, tops, "bottoms", "top"],
  ];
  for (const [group, partnersPool, groupLabel, partnerLabel] of complements) {
    if (group.length < 4 || partnersPool.length === 0) continue;
    const stranded = group.filter((g) => !partnersPool.some((p) => scorePair(g, p).compatible));
    if (stranded.length < 3 || ratio(stranded.length, group.length) < 0.4) continue;

    // Solvability check — does anything she owns already answer this?
    if (solvableFromOwned(stranded, items)) continue;

    const registers = countBy(stranded, (g) => {
      const f = norm(g.formality);
      return f ? (FORMALITY_BUCKET[f] ?? null) : null;
    });
    const leadRegister = topEntries(registers, 1)[0];
    const registerPhrase = leadRegister ? ` at a ${FORMALITY_BUCKET_LABEL[leadRegister[0]]} level` : "";
    const mostlyChromatic =
      ratio(stranded.filter((g) => g.colourProfile && !g.colourProfile.wardrobeNeutral).length, stranded.length) >= 0.6;
    const colourPhrase = mostlyChromatic ? "neutral " : "";

    gaps.push({
      id: `gap-${partnerLabel}`,
      title: `A ${colourPhrase}${partnerLabel}${registerPhrase} would unlock pieces you already own`,
      body: `${stranded.length} of your ${groupLabel} have no counterpart in your Closet that sits at a compatible level of dress and colour. nAia checked whether anything you already own solves this, and nothing does.`,
      garmentIds: stranded.map((g) => g.id),
      evidence: [
        ev("garment-fact", "compatibility graph", `${stranded.length} of ${group.length} ${groupLabel} have zero compatible counterparts.`, stranded.map((g) => g.id)),
        ...(leadRegister
          ? [ev("garment-fact", "formality", `Stranded pieces cluster at ${FORMALITY_BUCKET_LABEL[leadRegister[0]]}.`, stranded.map((g) => g.id))]
          : []),
      ],
      strength: gradeStrength(
        [ev("garment-fact", "compatibility graph", "", [])],
        stranded.length,
      ),
    });
  }

  // 2. No outer layer at all, in a wardrobe big enough for that to constrain things.
  if (outer.length === 0 && core.length >= 8) {
    const withProfile = core.filter((g) => g.colourProfile !== null);
    const neutralShare = ratio(withProfile.filter((g) => g.colourProfile!.wardrobeNeutral).length, withProfile.length || 1);
    gaps.push({
      id: "gap-outer-layer",
      title: "A light outer layer would extend most of what you own",
      body: `Your Closet has ${core.length} core pieces and nothing to layer over them, so every look you own is a single-season look. ${
        neutralShare >= 0.5
          ? "A neutral layer would sit over almost all of them."
          : "A layer in one of your recurring colours would sit over most of them."
      }`,
      garmentIds: core.slice(0, 6).map((g) => g.id),
      evidence: [
        ev("garment-fact", "slot", `${core.length} core pieces, 0 outerwear.`, core.map((g) => g.id)),
      ],
      strength: "strong",
    });
  }

  // 3. A stated lifestyle with almost nothing in the Closet serving it.
  if (passport && passport.lifestyle.length > 0 && items.length >= 8) {
    const workLifestyle = lifestyleRegisters(passport.lifestyle).has("work");
    const workTagged = items.filter((g) => (g.occasions ?? []).includes("Work")).length;
    const workReady = items.filter((g) => FORMALITY_BUCKET[norm(g.formality) ?? ""] === "work").length;
    // Both signals must be thin — an untagged but work-ready wardrobe is not a gap.
    if (workLifestyle && workTagged <= 1 && workReady <= 1) {
      gaps.push({
        id: "gap-work",
        title: "Work dressing is part of your week, and your Closet barely covers it",
        body: `You've told nAia that work is part of your lifestyle. Of the ${items.length} pieces in your Closet, ${workTagged === 0 ? "none" : "one"} is tagged for work and ${workReady === 0 ? "none reads" : "one reads"} as work-ready.`,
        garmentIds: [],
        evidence: [
          ev("passport-signal", "OnboardingProfile.lifestyle", "Work or hybrid working is part of the stated lifestyle.", []),
          ev("garment-fact", "occasions/formality", `${workTagged} pieces tagged Work, ${workReady} pieces reading business-casual or formal.`, []),
        ],
        strength: "moderate",
      });
    }
  }

  return gaps.slice(0, 2);
}

/**
 * Could an existing piece solve this stranded group? True when any single garment
 * she already owns pairs with at least half of them.
 */
function solvableFromOwned(stranded: WardrobeGarment[], items: WardrobeGarment[]): boolean {
  const strandedIds = new Set(stranded.map((g) => g.id));
  const threshold = Math.ceil(stranded.length / 2);
  return items.some((candidate) => {
    if (strandedIds.has(candidate.id)) return false;
    const covered = stranded.filter((g) => g.slot !== candidate.slot && scorePair(g, candidate).compatible).length;
    return covered >= threshold;
  });
}

// ── Passport vs real wardrobe ─────────────────────────────────────────────────

function buildPassportView(
  items: WardrobeGarment[],
  coverage: WardrobeCoverage,
  passport: WardrobePassport | null,
): WardrobePassportView {
  if (!passport) {
    return {
      state: "learning",
      learningNote: "Complete your Style Passport and nAia can show you how it compares with what you actually own.",
      comparisons: [],
    };
  }

  const comparisons: PassportComparison[] = [];

  // Colour — compared by family. A garment counts once, whichever stated token
  // covers it, so overlapping selections never double-count a piece.
  if (coverage.colourCoverage >= COVERAGE_THRESHOLD && passport.favoriteColors.length > 0) {
    const stated = passport.favoriteColors.filter((id) => PASSPORT_COLOUR_FAMILIES[norm(id) ?? ""]);
    const colourTotal = items.filter((i) => norm(i.primaryColor) !== null).length;
    if (stated.length > 0 && colourTotal > 0) {
      const matchedIds = new Set<string>();
      const representedTokens = new Set<string>();
      for (const item of items) {
        const family = closetColourFamily(item.primaryColor);
        if (!family) continue;
        for (const token of stated) {
          if ((PASSPORT_COLOUR_FAMILIES[norm(token) ?? ""] ?? []).includes(family)) {
            matchedIds.add(item.id);
            representedTokens.add(token);
          }
        }
      }
      const owned = matchedIds.size;
      const missing = stated.filter((token) => !representedTokens.has(token));
      const label = (token: string) => PASSPORT_COLOUR_LABEL[norm(token) ?? ""] ?? token;

      comparisons.push({
        id: "colour",
        stated: `You told nAia you're drawn to ${joinList(stated.map(label))}.`,
        observed:
          owned === 0
            ? `None of the ${colourTotal} colour-tagged pieces in your Closet are in that range.`
            : `${owned} of the ${colourTotal} colour-tagged pieces in your Closet are in that range.`,
        reading:
          missing.length === 0
            ? "Your Closet reflects what you said."
            : missing.length === stated.length
              ? "That's a preference your wardrobe hasn't caught up with yet."
              : `${capitalise(joinList(missing.map(label)))} ${missing.length === 1 ? "is" : "are"} the part your wardrobe hasn't caught up with yet.`,
        evidence: [
          ev("passport-signal", "OnboardingProfile.favoriteColors", `Stated tokens: ${stated.join(", ")}.`, []),
          ev("garment-fact", "primaryColor", `${owned} of ${colourTotal} colour-tagged pieces fall in the stated families.`, [...matchedIds]),
        ],
        strength: gradeStrength(
          [ev("passport-signal", "", "", []), ev("garment-fact", "", "", [])],
          colourTotal,
        ),
      });
    }
  }

  // Structure.
  const structureToken = norm(passport.structure);
  const structurePrefersDefined = structureToken !== null && /structur|tailor|defin|sharp/.test(structureToken);
  const structurePrefersSoft = structureToken !== null && /soft|relax|fluid|ease|drap/.test(structureToken);
  const withFit = items.filter((i) => norm(i.fitProfile) !== null);
  if (withFit.length >= 5 && (structurePrefersDefined || structurePrefersSoft)) {
    const structured = withFit.filter((i) => {
      const f = norm(i.fitProfile);
      return f === "tailored" || f === "structured";
    });
    const structuredShare = ratio(structured.length, withFit.length);
    const aligned = structurePrefersDefined ? structuredShare >= 0.4 : structuredShare <= 0.4;
    comparisons.push({
      id: "structure",
      stated: structurePrefersDefined
        ? "You told nAia you like a defined, structured shape."
        : "You told nAia you like softer, easier shapes.",
      observed: `${structured.length} of the ${withFit.length} pieces nAia has read are tailored or structured.`,
      reading: aligned
        ? "Your Closet strongly reflects that."
        : "Your wardrobe currently sits somewhere else — worth knowing when nAia styles you.",
      evidence: [
        ev("passport-signal", "OnboardingProfile.structure", `Stated: ${passport.structure}.`, []),
        ev("garment-fact", "fitProfile", `${structured.length} of ${withFit.length} pieces read tailored or structured.`, structured.map((g) => g.id)),
      ],
      strength: gradeStrength(
        [ev("passport-signal", "", "", []), ev("garment-fact", "", "", [])],
        withFit.length,
      ),
    });
  }

  // Register vs lifestyle.
  if (coverage.formalityCoverage >= COVERAGE_THRESHOLD && passport.lifestyle.length > 0) {
    const buckets = formalityBuckets(items);
    const lead = topEntries(buckets, 1)[0];
    const total = Array.from(buckets.values()).reduce((a, b) => a + b, 0);
    if (lead && total > 0) {
      const registers = lifestyleRegisters(passport.lifestyle);
      const lifestyleText = describeLifestyle(passport.lifestyle);
      // If nothing she said maps to a register, nAia has no basis for saying her
      // Closet sits somewhere else. Report the observation and stop there.
      const registersKnown = registers.size > 0;
      const ids = items.filter((g) => FORMALITY_BUCKET[norm(g.formality) ?? ""] === lead[0]).map((g) => g.id);
      // Which parts of the stated life the Closet is thin on — the useful half.
      const uncovered = Array.from(registers).filter(
        (register) => ratio(buckets.get(register) ?? 0, total) < 0.2,
      );
      comparisons.push({
        id: "register",
        stated: lifestyleText
          ? `You described a life of ${lifestyleText}.`
          : "This is the life you described to nAia.",
        observed: `${lead[1]} of the ${total} pieces nAia has assessed read ${FORMALITY_BUCKET_LABEL[lead[0]]}.`,
        reading: !registersKnown
          ? `Your Closet is strongest in ${FORMALITY_BUCKET_SHORT[lead[0]]} dressing.`
          : registers.has(lead[0])
            ? uncovered.length > 0
              ? `Your Closet is built for the ${FORMALITY_BUCKET_SHORT[lead[0]]} side of that. The ${joinList(uncovered.map((r) => FORMALITY_BUCKET_SHORT[r]))} side has much less behind it.`
              : "Your Closet covers that."
            : `Your Closet is strongest in ${FORMALITY_BUCKET_SHORT[lead[0]]} dressing, which isn't the part of your life you described.`,
        evidence: [
          ev("passport-signal", "OnboardingProfile.lifestyle", `Stated lifestyle: ${passport.lifestyle.join(", ")}.`, []),
          ev("garment-fact", "formality", `${lead[1]} of ${total} assessed pieces read ${FORMALITY_BUCKET_LABEL[lead[0]]}.`, ids),
        ],
        strength: gradeStrength(
          [ev("passport-signal", "", "", []), ev("garment-fact", "", "", [])],
          total,
        ),
      });
    }
  }

  if (comparisons.length === 0) {
    return {
      state: "learning",
      learningNote:
        "nAia needs a little more detail across your pieces before it can compare your Passport with your Closet fairly.",
      comparisons: [],
    };
  }

  return { state: "available", comparisons };
}

// ── Wear intelligence — prepared, never faked ─────────────────────────────────

const WEAR_PENDING = [
  "Most and least worn pieces",
  "Cost per wear",
  "Forgotten pieces",
  "Recently added versus actually used",
  "Repeat outfits",
  "Wear frequency by category",
  "Seasonal usage",
];

function buildWearIntelligence(items: WardrobeGarment[]): WearIntelligence {
  const usedInOutfits = items.filter((i) => i.outfitAppearances > 0).length;
  const saved = items.filter((i) => i.savedLookAppearances > 0).length;
  const neverUsed = items.length - usedInOutfits;

  return {
    state: "learning",
    learningNote:
      "nAia doesn't track what you actually wear yet. Everything above is based on what your pieces are, what you've told nAia about them, and what's happened inside nAia — never on guessed wear. As real wear data arrives, these insights get sharper.",
    observedToday: [
      {
        id: "styled",
        label: "Styled by nAia",
        value: usedInOutfits,
        caption: "pieces nAia has built an outfit around",
        state: "available",
        signal: "naia-interaction",
      },
      {
        id: "saved",
        label: "In saved looks",
        value: saved,
        caption: "pieces that appear in a look you saved",
        state: "available",
        signal: "naia-interaction",
      },
      {
        id: "unstyled",
        label: "Not yet styled",
        value: neverUsed,
        caption: "pieces nAia hasn't built an outfit around",
        state: "available",
        signal: "naia-interaction",
      },
    ],
    pending: WEAR_PENDING,
  };
}

// ── Entry point ───────────────────────────────────────────────────────────────

export interface WardrobeIntelligenceInput {
  items: WardrobeGarment[];
  passport: WardrobePassport | null;
  /**
   * Combination keys (see combinationKey()) nAia has already generated for this
   * customer. Used only to mark a pairing as untried; never invented.
   */
  seenCombinations: ReadonlySet<string>;
  flags?: WardrobeIntelligenceFlags;
}

export function computeWardrobeIntelligence(input: WardrobeIntelligenceInput): WardrobeIntelligence {
  const { items, passport, seenCombinations } = input;
  const flags = input.flags ?? DEFAULT_FLAGS;
  const coverage = computeCoverage(items, flags);
  const signalAvailability = buildSignalAvailability(items, coverage, passport);

  if (items.length < MIN_WARDROBE_SIZE) {
    const remaining = MIN_WARDROBE_SIZE - items.length;
    return {
      ready: false,
      snapshotReading: null,
      readyNote:
        items.length === 0
          ? "Add your first pieces and nAia will start reading your wardrobe as a whole."
          : `nAia needs ${remaining} more ${remaining === 1 ? "piece" : "pieces"} before it can read your wardrobe as a whole rather than one garment at a time.`,
      flags,
      coverage,
      signalAvailability,
      snapshot: [
        { id: "pieces", label: items.length === 1 ? "piece" : "pieces", value: items.length, caption: "in your Closet", state: "available", signal: "garment-fact" },
      ],
      dna: {
        state: "learning",
        learningNote: "Your wardrobe DNA appears once nAia has read a few more pieces.",
        palette: [], paletteReading: "", shapes: [], shapesReading: "", traits: [],
      },
      heroes: { state: "learning", learningNote: "Heroes appear once nAia can see how your pieces connect.", heroes: [] },
      pairings: { state: "learning", learningNote: "Add a few more pieces and nAia can start showing how they connect.", pairings: [], totalFound: 0, untriedPresentation: "none", untriedNote: null },
      observations: [],
      opportunities: {
        state: "learning",
        learningNote: "Opportunities appear once nAia can see enough of your wardrobe to tell a real gap from an unstyled piece.",
        rediscover: [], worthConsidering: [], noGapNote: null,
      },
      passportView: {
        state: "learning",
        learningNote: "nAia compares your Passport with your Closet once there's enough of a Closet to compare.",
        comparisons: [],
      },
      wear: buildWearIntelligence(items),
    };
  }

  const pairings = buildPairings(items, seenCombinations);
  const dna = buildDna(items, coverage);
  const passportView = buildPassportView(items, coverage, passport);
  const passportDimensionsShown = new Set(passportView.comparisons.map((c) => c.id));
  const opportunities = buildOpportunities(items, passport);

  return {
    ready: true,
    readyNote: null,
    snapshotReading: buildSnapshotReading(dna),
    flags,
    coverage,
    signalAvailability,
    snapshot: buildSnapshot(items, coverage, opportunities.rediscover.length),
    dna,
    heroes: buildHeroes(items, passport),
    pairings,
    observations: buildObservations(
      items,
      coverage,
      passport,
      flags,
      dna.paletteReading !== "",
      passportDimensionsShown,
      pairings,
    ),
    opportunities,
    passportView,
    wear: buildWearIntelligence(items),
  };
}

/**
 * One sentence describing what this wardrobe is made of, drawn from the same
 * trait logic the Wardrobe DNA section uses. The Closet page's preview block
 * calls this so the two surfaces never sound like two different systems.
 * Returns null when nAia has not read enough to say anything.
 */
export function wardrobeCharacterLine(items: WardrobeGarment[]): string | null {
  if (items.length < MIN_WARDROBE_SIZE) return null;
  const coverage = computeCoverage(items, DEFAULT_FLAGS);
  const dna = buildDna(items, coverage);
  if (dna.traits.length === 0) return null;
  const labels = dna.traits.slice(0, 2).map((t) => t.label.toLowerCase());
  return `Your Closet is ${joinList(labels)}.`;
}

export const WARDROBE_INTELLIGENCE_VERSION = "2.1.0";
export { INTENTION_LABELS, CATEGORY_PLURAL };
