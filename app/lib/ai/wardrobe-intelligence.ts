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

export interface WardrobePairings {
  state: BlockState;
  learningNote?: string;
  /** The strongest relationships nAia can see — what the section displays. */
  pairings: WardrobePairing[];
  totalFound: number;
  /**
   * Untried combinations NOT shown above. Try Together draws only from here, so
   * the two sections never print the same three outfits twice.
   */
  untriedOverflow: WardrobePairing[];
}

export type ObservationKind =
  | "repetition"
  | "untapped-potential"
  | "struggle-pattern"
  | "colour-pattern"
  | "passport-alignment"
  | "wardrobe-imbalance"
  | "self-reported-reach"
  | "connection-density"
  | "intention-concentration";

export interface WardrobeObservation {
  id: string;
  kind: ObservationKind;
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

export interface TryTogetherItem {
  id: string;
  garmentIds: string[];
  body: string;
  evidence: Evidence[];
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
  tryTogether: TryTogetherItem[];
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
  signal: SignalType;
  label: string;
  state: "active" | "partial" | "unavailable";
  detail: string;
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

// Passport colour option IDs → Closet primaryColor display strings.
const PASSPORT_COLOUR_TO_CLOSET: Readonly<Record<string, string>> = {
  "black": "Black", "grey": "Grey", "navy": "Navy", "green": "Green",
  "pink": "Pink", "yellow": "Yellow", "orange": "Orange",
};

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
  "active-busy-days", "on-the-go", "busy-mom", "family-parenting",
]);

/** Share of the Closet above which activewear is self-evidently part of her life. */
const ACTIVE_WARDROBE_SHARE = 0.25;

type HeroTier = "core" | "functional" | "finishing";

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

  return [
    {
      signal: "garment-fact",
      label: SIGNAL_LABELS["garment-fact"],
      state: garmentState,
      detail: `${coverage.analysedItems} of ${coverage.totalItems} pieces read in detail.`,
    },
    {
      signal: "passport-signal",
      label: SIGNAL_LABELS["passport-signal"],
      state: passportFilled >= 3 ? "active" : passportFilled > 0 ? "partial" : "unavailable",
      detail: passport
        ? `${passportFilled} of 5 Passport areas nAia uses here are filled in.`
        : "Your Style Passport isn't complete yet.",
    },
    {
      signal: "self-reported-wardrobe",
      label: SIGNAL_LABELS["self-reported-wardrobe"],
      state: coverage.relationshipCoverage >= 0.5 ? "active" : relationshipCount > 0 ? "partial" : "unavailable",
      detail: `${relationshipCount} of ${coverage.totalItems} pieces carry your own read on them.`,
    },
    {
      signal: "naia-interaction",
      label: SIGNAL_LABELS["naia-interaction"],
      state: interactions >= 3 ? "active" : interactions > 0 ? "partial" : "unavailable",
      detail:
        interactions > 0
          ? `${interactions} pieces have appeared in a generated or saved look.`
          : "No pieces have been through StyleMe or a saved look yet.",
    },
    {
      signal: "observed-wear",
      label: SIGNAL_LABELS["observed-wear"],
      state: "unavailable",
      detail: "nAia doesn't track real-world wear yet, so nothing here is based on it.",
    },
  ];
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

interface PairScore {
  compatible: boolean;
  reasons: string[];
}

function scorePair(a: WardrobeGarment, b: WardrobeGarment): PairScore {
  const reasons: string[] = [];

  if (!weightBalanced(a, b)) return { compatible: false, reasons: [] };

  const fd = formalityDistance(norm(a.formality), norm(b.formality));
  if (fd !== null) {
    if (fd > 1) return { compatible: false, reasons: [] };
    reasons.push(fd === 0 ? "they sit at the same level of dress" : "their levels of dress sit next to each other");
  }

  const cc = colourCompatible(a, b);
  if (cc === false) return { compatible: false, reasons: [] };
  if (cc === true) {
    const neutral = a.colourProfile?.wardrobeNeutral || b.colourProfile?.wardrobeNeutral;
    reasons.push(neutral ? "one of them is a wardrobe neutral, so the pairing stays easy" : "they share a colour family");
  }

  if (a.visualWeight && b.visualWeight && a.visualWeight !== b.visualWeight) {
    reasons.push("one carries more visual weight than the other, which keeps the pairing from flattening");
  }

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

function buildSnapshot(
  items: WardrobeGarment[],
  coverage: WardrobeCoverage,
  pairings: WardrobePairings,
): WardrobeMetric[] {
  const metrics: WardrobeMetric[] = [];

  metrics.push({
    id: "pieces",
    label: "Pieces",
    value: items.length,
    caption: "in your Closet",
    state: "available",
    signal: "garment-fact",
  });

  metrics.push({
    id: "read",
    label: "Read by nAia",
    value: coverage.analysedItems,
    caption: "pieces nAia has looked at in detail",
    state: "available",
    signal: "garment-fact",
  });

  // SELF-REPORTED, not wear. The caption says so, and the tests enforce it.
  const statedRegulars = items.filter((g) => statedAs(g, STATED_REGULAR)).length;
  const statedLowUse = items.filter((g) => statedAs(g, STATED_LOW_USE)).length;
  const relationshipsKnown = coverage.relationshipCoverage >= 0.3;

  metrics.push({
    id: "regulars",
    label: "Wardrobe regulars",
    value: relationshipsKnown ? statedRegulars : null,
    caption: "pieces you've marked as favourites or ones you wear often",
    state: relationshipsKnown ? "available" : "learning",
    signal: "self-reported-wardrobe",
    ...(relationshipsKnown
      ? {}
      : { learningNote: "Tell nAia how you feel about more of your pieces and this fills in." }),
  });

  metrics.push({
    id: "underused",
    label: "Underused",
    value: relationshipsKnown ? statedLowUse : null,
    caption: "pieces you've marked as ones you rarely reach for",
    state: relationshipsKnown ? "available" : "learning",
    signal: "self-reported-wardrobe",
    ...(relationshipsKnown
      ? {}
      : { learningNote: "nAia needs your read on more pieces before it can see this." }),
  });

  metrics.push({
    id: "combinations",
    label: "Combinations",
    value: pairings.state === "available" ? pairings.totalFound : null,
    caption: "pairings nAia can already build from what you own",
    state: pairings.state,
    signal: "garment-fact",
    ...(pairings.state === "available"
      ? {}
      : { learningNote: pairings.learningNote ?? "nAia needs more detail on your pieces first." }),
  });

  return metrics;
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
    const silCounts = countBy(items, (i) => norm(i.silhouette));
    for (const [token, count] of topEntries(silCounts, MAX_SHAPES)) {
      if (count < 2) continue;
      shapes.push({ label: SILHOUETTE_LABELS[token] ?? titleCase(token), count, field: "silhouette" });
    }
    if (shapes.length < MAX_SHAPES) {
      const fitCounts = countBy(items, (i) => norm(i.fitProfile));
      for (const [token, count] of topEntries(fitCounts, MAX_SHAPES)) {
        if (count < 2) continue;
        const label = FIT_LABELS[token] ?? titleCase(token);
        if (shapes.some((s) => s.label === label)) continue;
        shapes.push({ label, count, field: "fitProfile" });
        if (shapes.length >= MAX_SHAPES) break;
      }
    }
    if (shapes.length > 0) {
      const lead = shapes[0];
      shapesReading = capitalise(
        `${lead.label.toLowerCase()} shapes recur most across your wardrobe — ${lead.count} of your pieces read that way.`,
      );
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
      untriedOverflow: [],
    };
  }

  const candidates: Array<{ ids: string[]; reasons: string[]; score: number }> = [];

  for (const top of tops) {
    for (const bottom of bottoms) {
      const pair = scorePair(top, bottom);
      if (!pair.compatible) continue;
      let ids = [top.id, bottom.id];
      const reasons = [...pair.reasons];
      let score = pair.reasons.length;

      const layer = outer.find((o) => {
        if (o.id === top.id || o.id === bottom.id) return false;
        return scorePair(o, top).compatible && scorePair(o, bottom).compatible;
      });
      if (layer) {
        ids = [layer.id, top.id, bottom.id];
        reasons.push("the layer works over both halves");
        score += 1;
      }
      candidates.push({ ids, reasons, score });
    }
  }

  for (const piece of onePieces) {
    const layer = outer.find((o) => scorePair(o, piece).compatible);
    if (layer) {
      const pair = scorePair(layer, piece);
      candidates.push({
        ids: [layer.id, piece.id],
        reasons: [...pair.reasons, "a layer over a one-piece gives you a second version of the same garment"],
        score: pair.reasons.length + 1,
      });
    }
  }

  if (candidates.length === 0) {
    return {
      state: "learning",
      learningNote: "nAia hasn't found a confident combination yet — colour, fit and level-of-dress detail on more pieces is what unlocks this.",
      pairings: [],
      totalFound: 0,
      untriedOverflow: [],
    };
  }

  // Ranked on evidence strength, NOT on untried-first. This section is "the
  // strongest relationships in your wardrobe"; Try Together is the separate
  // "things you haven't tried" idea and draws from what is left over.
  const ranked = candidates
    .map((c) => ({ ...c, untried: !seenCombinations.has(combinationKey(c.ids)) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.untried !== b.untried) return a.untried ? -1 : 1;
      return combinationKey(a.ids).localeCompare(combinationKey(b.ids));
    });

  const toPairing = (candidate: (typeof ranked)[number]): WardrobePairing => ({
    id: combinationKey(candidate.ids),
    garmentIds: candidate.ids,
    reason: capitalise(joinList(candidate.reasons.slice(0, 2))) + ".",
    untried: candidate.untried,
    evidence: [
      ev("garment-fact", "formality/colourProfile/visualWeight", joinList(candidate.reasons), candidate.ids),
      ...(candidate.untried
        ? [ev("naia-interaction", "OutfitItem", "This combination has not appeared in a look nAia generated.", candidate.ids)]
        : []),
    ],
  });

  const used = new Set<string>();
  const pairings: WardrobePairing[] = [];
  for (const candidate of ranked) {
    if (pairings.length >= MAX_PAIRINGS) break;
    if (candidate.ids.some((id) => used.has(id))) continue;
    candidate.ids.forEach((id) => used.add(id));
    pairings.push(toPairing(candidate));
  }

  // Overflow: untried combinations that share no garment with anything displayed
  // above, so Try Together shows different clothes as well as a different idea.
  const overflowUsed = new Set(used);
  const untriedOverflow: WardrobePairing[] = [];
  for (const candidate of ranked) {
    if (untriedOverflow.length >= MAX_PAIRINGS) break;
    if (!candidate.untried) continue;
    if (candidate.ids.some((id) => overflowUsed.has(id))) continue;
    candidate.ids.forEach((id) => overflowUsed.add(id));
    untriedOverflow.push(toPairing(candidate));
  }

  return { state: "available", pairings, totalFound: candidates.length, untriedOverflow };
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
  passportMatches: string[];
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
  // Is an athletic wardrobe genuinely part of this customer's life? Either she
  // said so, or a quarter of what she owns says so.
  const activeShare = ratio(
    items.filter((g) => FUNCTIONAL_CATEGORIES.has(g.category)).length,
    items.length,
  );
  const activeRelevant =
    activeShare >= ACTIVE_WARDROBE_SHARE ||
    (passport?.lifestyle ?? []).some((id) => ACTIVE_LIFESTYLE_IDS.has(id));

  const hasInteractionHistory = items.some((g) => g.outfitAppearances > 0 || g.savedLookAppearances > 0);

  const candidates: HeroCandidate[] = items
    .filter((g) => g.slot !== "unknown")
    .map((garment) => {
      const partners = contextPartners(garment, items);
      const passportMatches = passportMatchesFor(garment, passport);
      const exceptional =
        (statedAs(garment, STATED_REGULAR) ? 1 : 0) +
        (registerSpan(partners).length >= 2 ? 1 : 0) +
        (passportMatches.length >= 2 ? 1 : 0) +
        (garment.outfitAppearances + garment.savedLookAppearances >= 2 ? 1 : 0) +
        (partners.length >= 8 ? 1 : 0);
      return {
        garment,
        tier: heroTier(garment),
        partners,
        partnerSlots: new Set(partners.map((p) => p.slot)),
        passportMatches,
        exceptional,
      };
    });

  const used = new Set<string>();
  const usedSlots = new Set<string>();
  const heroes: WardrobeHero[] = [];
  let finishingHeroes = 0;

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
      return kind === "evidence" ? activeRelevant || c.exceptional >= 2 : activeRelevant;
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
    if (c.exceptional >= 3) return 2;
    return c.tier === "functional" && activeRelevant ? 1 : 0;
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
    heroes.push({
      garmentId: best.garment.id,
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
  pick(
    "passport-match",
    "evidence",
    (c) => c.passportMatches.length >= 2 && c.partners.length >= 2,
    (c) => c.passportMatches.length * 10 + c.partners.length,
    (c) => ({
      headline: "This is the piece closest to what you told nAia you want.",
      reasons: [
        `Matches your Passport on ${joinList(c.passportMatches)}.`,
        `And it still works with ${c.partners.length} other pieces you own.`,
      ],
      evidence: [
        ev("passport-signal", "OnboardingProfile", `Aligns on ${joinList(c.passportMatches)}.`, [c.garment.id]),
        ev("garment-fact", "compatibility graph", `Compatible with ${c.partners.length} pieces.`, c.partners.map((p) => p.id)),
      ],
      supporting: c.passportMatches.length + c.partners.length,
    }),
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
function passportMatchesFor(g: WardrobeGarment, passport: WardrobePassport | null): string[] {
  if (!passport) return [];
  const matches: string[] = [];

  const colour = norm(g.primaryColor);
  if (colour) {
    for (const favId of passport.favoriteColors) {
      const mapped = PASSPORT_COLOUR_TO_CLOSET[favId];
      if (mapped && mapped.toLowerCase() === colour) {
        matches.push("colour");
        break;
      }
    }
  }

  const structure = norm(passport.structure);
  const fit = norm(g.fitProfile);
  if (structure && fit) {
    const wantsDefined = /structur|tailor|defin|sharp/.test(structure);
    const wantsSoft = /soft|relax|fluid|ease|drap/.test(structure);
    const isDefined = fit === "tailored" || fit === "structured";
    const isSoft = fit === "relaxed" || fit === "loose" || fit === "oversized" || fit === "flowy";
    if ((wantsDefined && isDefined) || (wantsSoft && isSoft)) matches.push("structure");
  }

  const silhouette = norm(g.silhouette);
  if (silhouette && passport.silhouette.some((s) => norm(s)?.includes(silhouette))) {
    matches.push("silhouette");
  }

  if (fit && passport.fitPreferences.some((p) => norm(p)?.includes(fit))) {
    matches.push("fit");
  }

  return Array.from(new Set(matches));
}

// ── What nAia is noticing ─────────────────────────────────────────────────────
//
// Each observation must be traceable to real evidence and, where it helps, point
// at the garments behind it. Observations that merely restate a section above are
// suppressed rather than padded in.

interface ObservationDraft extends WardrobeObservation {
  priority: number;
}

/** Pieces that connect well but have no place in how the wardrobe is actually used. */
function untappedPieces(items: WardrobeGarment[]): {
  pieces: WardrobeGarment[];
  basis: "naia-interaction" | "self-reported-wardrobe" | null;
} {
  const hasInteractionHistory = items.some((g) => g.outfitAppearances > 0 || g.savedLookAppearances > 0);

  const wellConnected = (g: WardrobeGarment) =>
    CORE_SLOTS.has(g.slot) && partnersOf(g, items).length >= 3;

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
    draft: Omit<WardrobeObservation, "strength"> & { supporting: number; priority: number },
  ) => {
    const { supporting, priority, ...rest } = draft;
    drafts.push({ ...rest, strength: gradeStrength(rest.evidence, supporting), priority });
  };

  // ── STRUGGLE PATTERN — the most actionable thing a customer can tell nAia ──
  const struggling = items.filter((g) => statedAs(g, STATED_STRUGGLE));
  if (struggling.length >= 2) {
    const shared = sharedAttribute(struggling);
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
  const untapped = untappedPieces(items);
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
        observation: `Your Closet has considerably more ${FORMALITY_BUCKET_SHORT[leadKey]} options than ${FORMALITY_BUCKET_SHORT[thinKey]} ones — ${leadCount} against ${thinCount}.`,
        explanation: "Neither is wrong. It tells you which side of your life your wardrobe is currently built for.",
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
        observation: `${group.length} of your strongest pieces are built to help you ${INTENTION_LABELS[intention] ?? intention}.`,
        explanation: "That's a clear strength. It also means other moods have fewer pieces behind them.",
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
      if (density >= 0.75) {
        add({
          id: "connection-density",
          kind: "connection-density",
          headline: "Almost everything you own goes with everything else",
          observation: `Of the ${possible} core combinations your pieces could form, ${pairings.totalFound} actually work — ${Math.round(density * 100)}%.`,
          explanation: "That's what a consistent palette and a steady level of dress buy you: a small wardrobe that behaves like a much larger one.",
          garmentIds: coreIds,
          evidence: [
            ev("garment-fact", "compatibility graph", `${pairings.totalFound} of ${possible} possible core combinations pass on colour, level of dress and visual weight.`, coreIds),
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
          observation: `Of the ${possible} core combinations your pieces could form, only ${pairings.totalFound} work together — ${Math.round(density * 100)}%.`,
          explanation: "Usually this is a level-of-dress or colour split rather than a shortage of clothes.",
          garmentIds: coreIds,
          evidence: [
            ev("garment-fact", "compatibility graph", `${pairings.totalFound} of ${possible} possible core combinations pass.`, coreIds),
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
): (Omit<WardrobeObservation, "strength"> & { supporting: number }) | null {
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
  pairings: WardrobePairings,
  passport: WardrobePassport | null,
): WardrobeOpportunities {
  const rediscover = buildRediscover(items, passport);

  const tryTogether: TryTogetherItem[] = pairings.untriedOverflow.slice(0, 3).map((p) => ({
    id: `try-${p.id}`,
    garmentIds: p.garmentIds,
    body: p.reason,
    evidence: p.evidence,
  }));

  const worthConsidering = findGaps(items, passport);

  const anything = rediscover.length > 0 || tryTogether.length > 0 || worthConsidering.length > 0;

  return {
    state: anything ? "available" : "learning",
    learningNote: anything
      ? undefined
      : "Opportunities appear once nAia can see enough of your wardrobe to tell a real gap from a piece you simply haven't styled yet.",
    rediscover,
    tryTogether,
    worthConsidering,
    // A wardrobe with no evidenced gap is a finding, not an empty state.
    noGapNote:
      worthConsidering.length === 0 && items.length >= MIN_WARDROBE_SIZE
        ? "Nothing obvious is missing right now. nAia only raises this when the same need keeps coming up and nothing you own solves it well."
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

      if (FUNCTIONAL_CATEGORIES.has(garment.category)) score -= 6;

      const matches = passportMatchesFor(garment, passport);
      if (matches.length > 0) {
        score += matches.length * 2;
        evidence.push(ev("passport-signal", "OnboardingProfile", `Matches your Passport on ${joinList(matches)}.`, [garment.id]));
      }

      const opener =
        lead === "rarely"
          ? "You've said you rarely reach for this piece, but"
          : lead === "struggle"
            ? "You've marked this one as hard to style, but"
            : "This piece hasn't been part of a look yet, but";

      return {
        garmentId: garment.id,
        name: displayName(garment),
        imageUrl: garment.imageUrl,
        body: `${opener} it works with ${partners.length} ${
          partners.length === 1 ? "piece" : "pieces"
        } you already own${
          matches.length > 0 ? `, and it matches your Passport on ${joinList(matches)}` : ""
        }.`,
        worksWithIds: partners.slice(0, 6).map((p) => p.id),
        evidence,
        strength: gradeStrength(evidence, partners.length),
        score,
      };
    })
    .filter((x): x is RediscoverPiece & { score: number } => x !== null)
    .sort((a, b) => b.score - a.score || a.garmentId.localeCompare(b.garmentId))
    .slice(0, MAX_REDISCOVER);

  return scored.map((entry) => {
    const piece: RediscoverPiece = { ...entry };
    delete (piece as Partial<RediscoverPiece & { score: number }>).score;
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

  // Colour.
  if (coverage.colourCoverage >= COVERAGE_THRESHOLD && passport.favoriteColors.length > 0) {
    const colourCounts = countBy(items, (i) => norm(i.primaryColor));
    const colourTotal = items.filter((i) => norm(i.primaryColor) !== null).length;
    const mapped = passport.favoriteColors
      .map((id) => PASSPORT_COLOUR_TO_CLOSET[id])
      .filter((c): c is string => Boolean(c));
    if (mapped.length > 0) {
      const represented = mapped.filter((c) => (colourCounts.get(c.toLowerCase()) ?? 0) > 0);
      const owned = mapped.reduce((sum, c) => sum + (colourCounts.get(c.toLowerCase()) ?? 0), 0);
      const ids = items.filter((i) => mapped.some((c) => c.toLowerCase() === norm(i.primaryColor))).map((i) => i.id);
      comparisons.push({
        id: "colour",
        stated: `You told nAia you're drawn to ${joinList(mapped.map((c) => c.toLowerCase()))}.`,
        observed:
          owned === 0
            ? `None of the ${colourTotal} colour-tagged pieces in your Closet are in that range.`
            : `${owned} of the ${colourTotal} colour-tagged pieces in your Closet are in that range.`,
        reading:
          represented.length === mapped.length
            ? "Your Closet reflects what you said."
            : represented.length === 0
              ? "That's a preference your wardrobe hasn't caught up with yet."
              : `${capitalise(joinList(mapped.filter((c) => !represented.includes(c)).map((c) => c.toLowerCase())))} is the part your wardrobe hasn't caught up with yet.`,
        evidence: [
          ev("passport-signal", "OnboardingProfile.favoriteColors", `Stated: ${mapped.join(", ")}.`, []),
          ev("garment-fact", "primaryColor", `${owned} of ${colourTotal} colour-tagged pieces match.`, ids),
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
        reading:
          registers.has(lead[0])
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
      readyNote:
        items.length === 0
          ? "Add your first pieces and nAia will start reading your wardrobe as a whole."
          : `nAia needs ${remaining} more ${remaining === 1 ? "piece" : "pieces"} before it can read your wardrobe as a whole rather than one garment at a time.`,
      flags,
      coverage,
      signalAvailability,
      snapshot: [
        { id: "pieces", label: "Pieces", value: items.length, caption: "in your Closet", state: "available", signal: "garment-fact" },
      ],
      dna: {
        state: "learning",
        learningNote: "Your wardrobe DNA appears once nAia has read a few more pieces.",
        palette: [], paletteReading: "", shapes: [], shapesReading: "", traits: [],
      },
      heroes: { state: "learning", learningNote: "Heroes appear once nAia can see how your pieces connect.", heroes: [] },
      pairings: { state: "learning", learningNote: "Add a few more pieces and nAia can start showing how they connect.", pairings: [], totalFound: 0, untriedOverflow: [] },
      observations: [],
      opportunities: {
        state: "learning",
        learningNote: "Opportunities appear once nAia can see enough of your wardrobe to tell a real gap from an unstyled piece.",
        rediscover: [], tryTogether: [], worthConsidering: [], noGapNote: null,
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

  return {
    ready: true,
    readyNote: null,
    flags,
    coverage,
    signalAvailability,
    snapshot: buildSnapshot(items, coverage, pairings),
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
    opportunities: buildOpportunities(items, pairings, passport),
    passportView,
    wear: buildWearIntelligence(items),
  };
}

export const WARDROBE_INTELLIGENCE_VERSION = "2.0.0";
export { INTENTION_LABELS, CATEGORY_PLURAL };
