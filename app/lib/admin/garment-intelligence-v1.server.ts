// app/lib/admin/garment-intelligence-v1.server.ts
//
// Phase 3C V1 — Derived garment styling intelligence.
//
// SHADOW / ADMIN-VISIBILITY ONLY.
// Surfaces in the admin Closet detail view for validation before any StyleMe wiring.
// MUST NOT affect StyleMe candidate selection, ranking, or result wording.
// No database access. No schema migration required. Pure functions only.
//
// V1 scope (Phase 3C architecture, approved 2026-09-15):
//   - deriveVisualWeight         — pattern + silhouette + material → light / medium / substantial
//   - deriveColourProfile        — neutral/chromatic, broad family, unambiguous light/dark
//   - computeGarmentIntentionPotential — shadow intention signals, NOT wired to StyleMe
//   - deriveGarmentStylingIntelligence — admin wrapper combining all V1 derivations
//
// V2 (pending): garmentStructure AI classification, garmentIntelligence JSON column.
// V2.5 (pending): wire computeGarmentIntentionPotential into live scoring.
//
// Isolation guarantee: V1_SHADOW_ONLY is exported as a typed true constant.
// Any import of this module from styleme-recommendation.ts would be a boundary violation.

import type { ClosetClassification } from "~/lib/admin/closet-intelligence.server";

// ── Phase 3C V1 metadata ──────────────────────────────────────────────────────

export const GARMENT_INTELLIGENCE_V1_VERSION = "1.0.0";

// Typed true constant — checked in tests to verify no live-scoring wiring.
export const V1_SHADOW_ONLY = true as const;

// ── Vocabulary constants ──────────────────────────────────────────────────────

// Neutral colour set (Phase 3C §7 + garment-semantics.server.ts neutral set).
const NEUTRAL_COLORS: ReadonlySet<string> = new Set([
  "black", "white", "grey", "gray", "beige", "cream", "ivory", "off-white",
  "navy", "stone", "charcoal", "taupe", "tan", "camel", "brown", "nude", "silver",
]);

// Colour family lookup. Navy intentionally absent (it is in NEUTRAL_COLORS).
const COLOUR_FAMILY_MAP: Readonly<Record<string, BroadColourFamily>> = {
  // Reds
  red: "red", crimson: "red", cherry: "red", rose: "red",
  raspberry: "red", burgundy: "red", wine: "red", maroon: "red",
  // Pinks
  pink: "pink", blush: "pink", coral: "pink", salmon: "pink",
  fuchsia: "pink", magenta: "pink",
  // Oranges
  orange: "orange", rust: "orange", terracotta: "orange",
  amber: "orange", peach: "orange", apricot: "orange", copper: "orange",
  // Yellows
  yellow: "yellow", mustard: "yellow", gold: "yellow", lemon: "yellow",
  // Greens
  green: "green", olive: "green", sage: "green", khaki: "green",
  emerald: "green", mint: "green", forest: "green", hunter: "green", jade: "green",
  // Blues
  blue: "blue", cobalt: "blue", teal: "blue", turquoise: "blue",
  denim: "blue", indigo: "blue", periwinkle: "blue",
  // Purples
  purple: "purple", violet: "purple", lilac: "purple", lavender: "purple",
  plum: "purple", mauve: "purple", mulberry: "purple",
};

// Unambiguously dark tokens — reliable from the coarse stored token alone.
const UNAMBIGUOUS_DARK: ReadonlySet<string> = new Set([
  "black", "charcoal", "navy", "burgundy", "wine", "maroon",
  "forest", "hunter", "indigo", "plum", "mulberry", "brown",
]);

// Unambiguously light tokens — reliable from the coarse stored token alone.
const UNAMBIGUOUS_LIGHT: ReadonlySet<string> = new Set([
  "white", "ivory", "cream", "off-white", "nude",
  "blush", "mint", "lemon", "peach", "lavender", "lilac",
]);

// Silhouettes that add clear volume (V1 visual-weight contribution).
const VOLUME_SILHOUETTES: ReadonlySet<string> = new Set([
  "oversized", "balloon", "flared",
]);

// Materials with strong visible texture, sheen, or distinctiveness.
// Silk is intentionally ABSENT — a silk tank reads as light (see Phase 3C §7 examples).
const HIGH_PRESENCE_MATERIALS: ReadonlySet<string> = new Set([
  "velvet",    // rich surface texture + sheen
  "leather",   // distinctive surface + weight
  "lace",      // distinctive open texture
  "tweed",     // strong woven texture
  "tulle",     // distinctive volume / layering
  "satin",     // visible sheen / reflectivity
  "suede",     // textural distinctiveness
  "corduroy",  // strong ribbed texture
  "mesh",      // distinctive open construction
]);

// Silhouettes that carry movement / energy signal.
const MOVEMENT_SILHOUETTES: ReadonlySet<string> = new Set([
  "flared", "a-line", "balloon", "asymmetric", "wrap",
]);

// Fit profiles associated with soft, non-restrictive construction.
const SOFT_FIT_PROFILES: ReadonlySet<string> = new Set([
  "relaxed", "loose", "oversized", "flowy",
]);

// Fit profiles associated with definition and structure.
const STRUCTURED_FIT_PROFILES: ReadonlySet<string> = new Set([
  "tailored", "structured", "fitted",
]);

// Materials that hold shape and support structure.
const STRUCTURE_MATERIALS: ReadonlySet<string> = new Set([
  "wool", "tweed", "leather", "denim",
]);

// Materials with soft-touch or drape signal.
const SOFT_MATERIALS: ReadonlySet<string> = new Set([
  "silk", "satin", "chiffon", "georgette", "jersey", "knit",
]);

// Materials associated with everyday comfort and ease.
const COMFORTABLE_MATERIALS: ReadonlySet<string> = new Set([
  "jersey", "cotton", "knit", "linen",
]);

// Colour families that carry high visual intensity / energy.
const HIGH_ENERGY_FAMILIES: ReadonlySet<BroadColourFamily> = new Set([
  "red", "pink", "orange", "yellow",
]);

// Style tags associated with expressive / energetic character.
const EXPRESSIVE_TAGS: ReadonlySet<string> = new Set([
  "bold", "statement", "edgy", "playful", "artsy", "creative", "eclectic", "romantic",
]);

// Style tags associated with structure and polish.
const STRUCTURED_TAGS: ReadonlySet<string> = new Set([
  "structured", "tailored", "polished", "refined", "elevated", "sophisticated",
]);

// Style tags associated with grounded / anchored character.
const GROUNDED_TAGS: ReadonlySet<string> = new Set([
  "classic", "timeless", "refined", "minimal", "clean", "understated",
]);

// Formality ordinal — higher value = more formal.
const FORMALITY_ORDINAL: Readonly<Record<string, number>> = {
  "casual": 1,
  "smart-casual": 2,
  "business-casual": 3,
  "business-formal": 4,
  "occasion": 5,
  "evening": 5,
};

// Personality → aligned style-tag tokens (for feel-like-myself and confidence).
const PERSONALITY_TAG_MAP: Readonly<Record<string, readonly string[]>> = {
  "classic-polished":    ["classic", "polished", "refined", "tailored", "timeless", "elevated"],
  "feminine-romantic":   ["feminine", "romantic", "flowy", "effortless", "effortlessly-chic"],
  "minimal-relaxed":     ["minimal", "clean", "understated", "relaxed", "effortless"],
  "bold-edgy":           ["bold", "edgy", "statement", "creative", "eclectic"],
  "creative-expressive": ["artsy", "creative", "eclectic", "playful", "bold"],
};

// Personalities that amplify expressive signals.
const EXPRESSIVE_PERSONALITIES: ReadonlySet<string> = new Set([
  "bold-edgy", "creative-expressive", "feminine-romantic",
]);

// All 12 TODAY intention IDs (canonical — app/routes/style-me/intention.tsx).
export const ALL_INTENTIONS = [
  "feel-like-myself", "confidence", "ground-me", "give-structure",
  "make-it-easy", "feel-put-together", "feel-attractive", "give-energy",
  "feel-softer", "feel-sharper", "feel-less-exposed", "express-myself",
] as const;

export type TodayIntention = typeof ALL_INTENTIONS[number];

// ── Types ─────────────────────────────────────────────────────────────────────

export type VisualWeight = "light" | "medium" | "substantial";
export type NeutralChromaticity = "neutral" | "chromatic";
export type BroadColourFamily =
  | "red" | "pink" | "orange" | "yellow"
  | "green" | "blue" | "purple" | "neutral";
export type LightDarkValue = "light" | "dark";
export type ColourEnergyTier =
  | "high-energy"          // red / pink / orange / yellow families
  | "deep-authoritative"   // navy / black / charcoal + dark chromatics
  | "mid-range"            // blue / green / purple (not deep)
  | "neutral-versatile";   // neutral set (not deep-authoritative)

export interface VisualWeightResult {
  value: VisualWeight | null;
  evidence: string[];
}

export interface ColourProfileResult {
  neutralChromaticity: NeutralChromaticity | null;
  broadFamily: BroadColourFamily | null;
  lightDark: LightDarkValue | null;
  energyTier: ColourEnergyTier | null;
  evidence: string[];
}

export interface IntentionPotential {
  intention: string;
  signals: string[];
}

// Slim passport input — only fields used in V1 shadow reasoning.
export interface StylingPassportInput {
  stylePersonalities?: string[];
  favoriteColors?: string[];
  coveragePreferences?: string[];
  dressingPreferences?: string[];
}

// Slim today-context input.
export interface TodayContextInput {
  occasion?: string;
  intentions?: string[];
}

export interface GarmentStylingIntelligence {
  visualWeight: VisualWeightResult;
  colourProfile: ColourProfileResult;
  // Shadow-only: computed for all 12 intentions, conditioned by passport when provided.
  intentionPotentials: IntentionPotential[];
  // true when a real customer passport was supplied; false when computed at garment-only baseline.
  passportUsed: boolean;
}

// ── Input normalisation ───────────────────────────────────────────────────────

function norm(s: string | null | undefined): string | null {
  if (s === null || s === undefined) return null;
  const t = s.trim().toLowerCase();
  return t === "" || t === "n/a" ? null : t;
}

function normArr(arr: string[] | null | undefined): string[] {
  return (arr ?? []).map(s => s.trim().toLowerCase()).filter(s => s !== "" && s !== "n/a");
}

// ── 1. deriveVisualWeight ──────────────────────────────────────────────────────

/**
 * Derive visual weight from pattern, silhouette, and material.
 *
 * Visual weight = how much visual space a garment commands in an outfit.
 * This is NOT physical garment weight.
 *
 * V1 formula (Phase 3C §7):
 *   pattern contribution  + silhouette contribution + material contribution
 *   0 = light, 1 = medium, 2+ = substantial
 *
 * Returns null when ALL three inputs are absent — no inference from missing data.
 * Returns evidence[] as the list of positive contributors only.
 */
export function deriveVisualWeight(
  item: Pick<ClosetClassification, "pattern" | "silhouette" | "material">,
): VisualWeightResult {
  const pattern   = norm(item.pattern);
  const silhouette = norm(item.silhouette);
  const material  = norm(item.material);

  if (pattern === null && silhouette === null && material === null) {
    return { value: null, evidence: [] };
  }

  const evidence: string[] = [];
  let score = 0;

  if (pattern !== null && pattern !== "solid") {
    score += 1;
    evidence.push(`${pattern} pattern`);
  }

  if (silhouette !== null && VOLUME_SILHOUETTES.has(silhouette)) {
    score += 1;
    evidence.push(`${silhouette} silhouette`);
  }

  if (material !== null && HIGH_PRESENCE_MATERIALS.has(material)) {
    score += 1;
    evidence.push(`${material} material`);
  }

  const value: VisualWeight =
    score === 0 ? "light" :
    score === 1 ? "medium" :
    "substantial";

  return { value, evidence };
}

// ── 2. deriveColourProfile ────────────────────────────────────────────────────

/**
 * Derive safe V1 colour intelligence from coarse stored colour tokens.
 *
 * What is safely derivable from coarse tokens (V1):
 *   - Neutral vs chromatic   (defined neutral set)
 *   - Broad colour family    (token-to-family lookup)
 *   - Unambiguous light/dark (only where the stored token is reliable)
 *   - Energy tier            (for intention-potential reasoning)
 *
 * What is NOT derived in V1 (requires colour qualifier storage):
 *   - Warm vs cool temperature    ("blue" could be cobalt or teal)
 *   - Muted vs vivid saturation   ("red" covers dusty rose and scarlet)
 *   - Colour harmony across pieces (outfit-contextual, not garment-intrinsic)
 */
export function deriveColourProfile(
  item: Pick<ClosetClassification, "primaryColor" | "colors">,
): ColourProfileResult {
  const primaryColor = norm(item.primaryColor);

  if (primaryColor === null) {
    return {
      neutralChromaticity: null,
      broadFamily: null,
      lightDark: null,
      energyTier: null,
      evidence: [],
    };
  }

  const evidence: string[] = [primaryColor];
  const isNeutral = NEUTRAL_COLORS.has(primaryColor);

  const neutralChromaticity: NeutralChromaticity = isNeutral ? "neutral" : "chromatic";
  const broadFamily: BroadColourFamily | null = isNeutral
    ? "neutral"
    : (COLOUR_FAMILY_MAP[primaryColor] ?? null);

  // Light/dark: only where the stored token makes it unambiguous.
  let lightDark: LightDarkValue | null = null;
  if (UNAMBIGUOUS_DARK.has(primaryColor))       lightDark = "dark";
  else if (UNAMBIGUOUS_LIGHT.has(primaryColor)) lightDark = "light";

  // Energy tier.
  let energyTier: ColourEnergyTier | null = null;
  if (isNeutral) {
    energyTier = (primaryColor === "black" || primaryColor === "navy" || primaryColor === "charcoal")
      ? "deep-authoritative"
      : "neutral-versatile";
  } else if (broadFamily !== null) {
    if (HIGH_ENERGY_FAMILIES.has(broadFamily)) {
      energyTier = "high-energy";
    } else if (UNAMBIGUOUS_DARK.has(primaryColor)) {
      energyTier = "deep-authoritative";
    } else {
      energyTier = "mid-range";
    }
  }

  return { neutralChromaticity, broadFamily, lightDark, energyTier, evidence };
}

// ── 3. computeGarmentIntentionPotential ──────────────────────────────────────

/**
 * Shadow-only: derive which garment facts might be relevant to a given TODAY
 * intention for a specific customer context.
 *
 * IMPORTANT — V1 isolation boundary:
 *   This function MUST NOT be imported from or called by:
 *     - styleme-recommendation.ts
 *     - styleme-result.server.ts
 *     - Any T1–T5/T6 ranking or candidate selection
 *   Any such import is a Phase 3C boundary violation.
 *
 * Signals describe potential — they are not claims that the garment automatically
 * produces any particular feeling. No garment field maps deterministically to a
 * psychological outcome (no "red = confidence", "black = power", "structured = authority").
 * Context (passport + today) conditions which garment facts are relevant.
 */
export function computeGarmentIntentionPotential(
  garment: ClosetClassification,
  intention: string,
  passport: StylingPassportInput,
  todayContext: TodayContextInput,
): IntentionPotential {
  const signals: string[] = [];

  const fitProfile      = norm(garment.fitProfile);
  const silhouette      = norm(garment.silhouette);
  const material        = norm(garment.material);
  const pattern         = norm(garment.pattern);
  const primaryColor    = norm(garment.primaryColor);
  const hemLength       = norm(garment.hemLength);
  const sleeveLength    = norm(garment.sleeveLength);
  const necklineCoverage = norm(garment.necklineCoverage);
  const formality       = norm(garment.formality);
  const tags            = normArr(garment.styleTags);
  const occasions       = normArr(garment.occasions);

  const colourProfile   = deriveColourProfile(garment);
  const visualWeight    = deriveVisualWeight(garment);
  const formalityOrdinal = formality ? (FORMALITY_ORDINAL[formality] ?? 0) : 0;

  switch (intention) {

    case "give-energy": {
      if (silhouette && MOVEMENT_SILHOUETTES.has(silhouette)) {
        signals.push("movement in the silhouette");
      }
      if (pattern && pattern !== "solid") {
        signals.push("visual detail from pattern");
      }
      if (colourProfile.energyTier === "high-energy" && primaryColor) {
        signals.push(`chromatic colour — ${primaryColor}`);
      }
      const expressive = tags.filter(t => EXPRESSIVE_TAGS.has(t));
      if (expressive.length > 0) {
        signals.push(`expressive styling character (${expressive.join(", ")})`);
      }
      if (visualWeight.value === "substantial") {
        signals.push("distinctive visual presence");
      }
      break;
    }

    case "give-structure": {
      if (fitProfile && STRUCTURED_FIT_PROFILES.has(fitProfile)) {
        signals.push(`${fitProfile} fit provides definition`);
      }
      if (silhouette && (silhouette === "straight" || silhouette === "column")) {
        signals.push("clean geometric lines");
      }
      if (material && STRUCTURE_MATERIALS.has(material)) {
        signals.push(`${material} — construction-supporting material`);
      }
      if (formalityOrdinal >= 3) {
        signals.push(`elevated formality register — ${formality}`);
      }
      const structured = tags.filter(t => STRUCTURED_TAGS.has(t));
      if (structured.length > 0) {
        signals.push(`structured aesthetic character (${structured.join(", ")})`);
      }
      break;
    }

    case "feel-softer": {
      if (fitProfile && SOFT_FIT_PROFILES.has(fitProfile)) {
        signals.push("relaxed, non-restrictive fit");
      }
      if (material && SOFT_MATERIALS.has(material)) {
        signals.push(`softness from ${material}`);
      }
      if (silhouette && (silhouette === "wrap" || silhouette === "a-line" || silhouette === "flared")) {
        signals.push("gentle, non-angular silhouette");
      }
      if (formality === "casual") {
        signals.push("casual register supports ease");
      }
      break;
    }

    case "feel-sharper": {
      if (fitProfile && (fitProfile === "tailored" || fitProfile === "fitted" || fitProfile === "body-skimming")) {
        signals.push("precise fit adds definition");
      }
      if (silhouette && (silhouette === "straight" || silhouette === "column" || silhouette === "fitted")) {
        signals.push("clean, defined lines");
      }
      if (material && (material === "wool" || material === "leather" || material === "tweed" || material === "denim")) {
        signals.push(`${material} — holds sharp lines`);
      }
      const sharp = tags.filter(t => ["structured", "minimal", "clean", "sophisticated", "contemporary", "tailored"].includes(t));
      if (sharp.length > 0) {
        signals.push(`sharp aesthetic character (${sharp.join(", ")})`);
      }
      if (formalityOrdinal >= 3) {
        signals.push("formal enough to read as deliberate");
      }
      break;
    }

    case "feel-less-exposed": {
      if (garment.shoulderCoverage === true)    signals.push("shoulders covered");
      if (garment.midriffExposed === false)     signals.push("midriff not exposed");
      if (necklineCoverage && ["high", "crew", "mock", "cowl-high", "shirt-collar"].includes(necklineCoverage)) {
        signals.push(`covered neckline — ${necklineCoverage}`);
      }
      if (hemLength && ["midi", "maxi", "full"].includes(hemLength)) {
        signals.push(`longer hem — ${hemLength}`);
      }
      if (sleeveLength && ["full", "three-quarter"].includes(sleeveLength)) {
        signals.push(`sleeve coverage — ${sleeveLength}`);
      }
      break;
    }

    case "feel-put-together": {
      if (formalityOrdinal >= 2) {
        signals.push(`elevated formality — ${formality}`);
      }
      if (pattern === "solid" || pattern === null) {
        signals.push("clean, unfussy look");
      }
      const polished = tags.filter(t => ["refined", "elevated", "polished", "classic", "timeless", "chic"].includes(t));
      if (polished.length > 0) {
        signals.push(`polished styling character (${polished.join(", ")})`);
      }
      if (occasions.some(o => ["work", "evening", "special-occasion"].includes(o))) {
        signals.push("appropriate for polished contexts");
      }
      break;
    }

    case "feel-attractive": {
      if (fitProfile && (fitProfile === "fitted" || fitProfile === "body-skimming")) {
        signals.push("figure-defining fit");
      }
      const elegant = tags.filter(t => ["feminine", "romantic", "elevated", "chic", "luxe"].includes(t));
      if (elegant.length > 0) {
        signals.push(`elegant character (${elegant.join(", ")})`);
      }
      if (occasions.some(o => ["evening", "date-night", "special-occasion"].includes(o))) {
        signals.push("occasion-appropriate character");
      }
      if (colourProfile.energyTier === "high-energy" && primaryColor) {
        signals.push(`visual impact from ${primaryColor}`);
      }
      break;
    }

    case "feel-like-myself": {
      // Requires passport for meaningful personal signal.
      const passPersonalities = (passport.stylePersonalities ?? []).map(s => s.toLowerCase());
      if (passPersonalities.length > 0 && tags.length > 0) {
        const relevant = passPersonalities.flatMap(p => PERSONALITY_TAG_MAP[p] ?? []);
        const aligned = tags.filter(t => relevant.includes(t));
        if (aligned.length > 0) {
          signals.push(`style aligns with your personality (${aligned.join(", ")})`);
        }
      }
      const favColors = (passport.favoriteColors ?? []).map(s => s.toLowerCase());
      if (primaryColor && favColors.includes(primaryColor)) {
        signals.push("includes a colour you love");
      }
      // Garment-only baseline when no passport is provided.
      if (signals.length === 0) {
        if (occasions.length > 0) signals.push("suits specific lifestyle occasions");
        if (tags.length > 0)     signals.push("has a defined aesthetic character");
      }
      break;
    }

    case "confidence": {
      // Confidence comes from alignment with self and context — not from any
      // garment property universally. Signals are passport-conditioned.
      const passCovPrefs = (passport.coveragePreferences ?? []).map(s => s.toLowerCase());
      if (passCovPrefs.some(p => p.includes("coverage"))) {
        const hasCoverage = garment.shoulderCoverage === true ||
          (necklineCoverage && ["high", "crew", "mock"].includes(necklineCoverage));
        if (hasCoverage) signals.push("coverage meets your preferences");
      }
      const passPersonalities = (passport.stylePersonalities ?? []).map(s => s.toLowerCase());
      if (passPersonalities.length > 0 && tags.length > 0) {
        const relevant = passPersonalities.flatMap(p => PERSONALITY_TAG_MAP[p] ?? []);
        const aligned = tags.filter(t => relevant.includes(t));
        if (aligned.length > 0) signals.push("authentic to your style personality");
      }
      if (formalityOrdinal >= 2 && todayContext.occasion && todayContext.occasion !== "loungewear") {
        signals.push("formality appropriate for context");
      }
      if (signals.length === 0) {
        signals.push("confidence is personal — depends on context and how you feel in this garment");
      }
      break;
    }

    case "ground-me": {
      if (formalityOrdinal >= 2) {
        signals.push(`grounding formality — ${formality}`);
      }
      if (fitProfile && (fitProfile === "tailored" || fitProfile === "fitted" || fitProfile === "structured")) {
        signals.push("defining structure");
      }
      if (silhouette && (silhouette === "straight" || silhouette === "column")) {
        signals.push("anchored silhouette");
      }
      const grounded = tags.filter(t => GROUNDED_TAGS.has(t));
      if (grounded.length > 0) {
        signals.push(`grounded aesthetic character (${grounded.join(", ")})`);
      }
      break;
    }

    case "make-it-easy": {
      if (formality === "casual") {
        signals.push("casual, low-effort register");
      }
      if (fitProfile && SOFT_FIT_PROFILES.has(fitProfile)) {
        signals.push("comfortable, non-restrictive fit");
      }
      if (occasions.some(o => ["casual", "weekend", "loungewear"].includes(o))) {
        signals.push("suited to easy-going contexts");
      }
      if (material && COMFORTABLE_MATERIALS.has(material)) {
        signals.push(`comfortable material — ${material}`);
      }
      break;
    }

    case "express-myself": {
      const expressive = tags.filter(t => EXPRESSIVE_TAGS.has(t));
      if (expressive.length > 0) {
        signals.push(`expressive character (${expressive.join(", ")})`);
      }
      if (pattern && pattern !== "solid") {
        signals.push(`distinctive ${pattern} pattern`);
      }
      if (colourProfile.neutralChromaticity === "chromatic" && primaryColor) {
        signals.push(`non-neutral colour — ${primaryColor}`);
      }
      if (visualWeight.value === "substantial") {
        signals.push("distinctive visual presence");
      }
      // Amplified when passport has expressive personalities.
      const passP = (passport.stylePersonalities ?? []).map(s => s.toLowerCase());
      if (signals.length > 0 && passP.some(p => EXPRESSIVE_PERSONALITIES.has(p))) {
        signals.push("aligns with your expressive personality");
      }
      break;
    }
  }

  return { intention, signals };
}

// ── 4. deriveGarmentStylingIntelligence (admin wrapper) ──────────────────────

/**
 * Combine all V1 derived intelligence for a single garment.
 * Intended for admin Closet detail view only. Shadow — no StyleMe wiring.
 *
 * Computes:
 *   - deriveVisualWeight
 *   - deriveColourProfile
 *   - computeGarmentIntentionPotential for all 12 intentions, conditioned by passport when supplied
 *
 * passport: customer's styling passport from OnboardingProfile; null = garment-baseline only.
 */
export function deriveGarmentStylingIntelligence(
  classification: ClosetClassification,
  passport: StylingPassportInput | null = null,
): GarmentStylingIntelligence {
  const visualWeight   = deriveVisualWeight(classification);
  const colourProfile  = deriveColourProfile(classification);

  const passportInput: StylingPassportInput = passport ?? {};
  const intentionPotentials = ALL_INTENTIONS.map(intention =>
    computeGarmentIntentionPotential(classification, intention, passportInput, {}),
  );

  return { visualWeight, colourProfile, intentionPotentials, passportUsed: passport !== null };
}
