// app/lib/admin/garment-intelligence-v1.server.ts
//
// Phase 3C V2 — Derived garment styling intelligence.
//
// SHADOW / ADMIN-VISIBILITY ONLY.
// Surfaces in the admin Closet detail view for validation before any StyleMe wiring.
// MUST NOT affect StyleMe candidate selection, ranking, or result wording.
// No database access. No schema migration required. Pure functions only.
//
// V2 scope (Phase 3C V2 architecture, approved 2026-09-16):
//   - deriveVisualWeight         — category-aware, 4-dimension scoring (pattern+silhouette+material+construction)
//   - deriveColourProfile        — two-axis model: hueFamily + wardrobeNeutral
//   - computeGarmentIntentionPotential — all 12 intentions with strength qualification; no fb() fallback
//   - deriveGarmentStylingIntelligence — admin wrapper combining all V2 derivations
//
// V3 (pending): garmentStructure AI classification, garmentIntelligence JSON column.
// V3.5 (pending): wire computeGarmentIntentionPotential into live scoring (Layer B).
//
// Isolation guarantee: V1_SHADOW_ONLY is exported as a typed true constant.
// Any import of this module from styleme-recommendation.ts would be a boundary violation.

import type { ClosetClassification } from "~/lib/admin/closet-intelligence.server";

// ── Phase 3C V2 metadata ──────────────────────────────────────────────────────

export const GARMENT_INTELLIGENCE_V1_VERSION = "2.0.0";

// Typed true constant — checked in tests to verify no live-scoring wiring.
export const V1_SHADOW_ONLY = true as const;

// ── Vocabulary constants ──────────────────────────────────────────────────────

// Neutral colour set — garments whose primary colour functions as a wardrobe neutral.
// V2: khaki added (V1 incorrectly mapped it to "green" family).
const NEUTRAL_COLORS: ReadonlySet<string> = new Set([
  "black", "white", "grey", "gray", "beige", "cream", "ivory", "off-white",
  "navy", "stone", "charcoal", "taupe", "tan", "camel", "brown", "nude", "silver", "khaki",
]);

// Hue-family lookup. Maps colour tokens to their chromatic hue bias.
// Wardrobe-neutral tokens that carry a clear hue lean are included here (navy=blue, charcoal=grey, etc.).
// V2 changes: navy→blue added; charcoal/silver/gray/grey/taupe→grey added; brown/tan→brown added;
//             khaki→green REMOVED (khaki is now correctly in NEUTRAL_COLORS).
const COLOUR_FAMILY_MAP: Readonly<Record<string, HueFamily>> = {
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
  green: "green", olive: "green", sage: "green",
  emerald: "green", mint: "green", forest: "green", hunter: "green", jade: "green",
  // Blues — including navy (wardrobe-neutral but clear blue hue)
  blue: "blue", cobalt: "blue", teal: "blue", turquoise: "blue",
  denim: "blue", indigo: "blue", periwinkle: "blue", navy: "blue",
  // Purples
  purple: "purple", violet: "purple", lilac: "purple", lavender: "purple",
  plum: "purple", mauve: "purple", mulberry: "purple",
  // Greys — including charcoal/silver/taupe (wardrobe-neutrals with grey hue lean)
  grey: "grey", gray: "grey", charcoal: "grey", silver: "grey", taupe: "grey",
  // Browns — including tan, camel
  brown: "brown", tan: "brown", camel: "brown",
};

// Unambiguously dark tokens — reliable from coarse stored token alone.
const UNAMBIGUOUS_DARK: ReadonlySet<string> = new Set([
  "black", "charcoal", "navy", "burgundy", "wine", "maroon",
  "forest", "hunter", "indigo", "plum", "mulberry", "brown",
]);

// Unambiguously light tokens — reliable from coarse stored token alone.
const UNAMBIGUOUS_LIGHT: ReadonlySet<string> = new Set([
  "white", "ivory", "cream", "off-white", "nude",
  "blush", "mint", "lemon", "peach", "lavender", "lilac",
]);

// Colour families that carry high visual intensity / energy.
const HIGH_ENERGY_FAMILIES: ReadonlySet<HueFamily> = new Set([
  "red", "pink", "orange", "yellow",
]);

// Silhouettes that add clear volume (visual-weight contribution).
const VOLUME_SILHOUETTES: ReadonlySet<string> = new Set([
  "oversized", "balloon", "flared",
]);

// Materials with strong visible texture, sheen, or distinctiveness.
// Silk intentionally ABSENT — a silk tank reads light.
// Wool intentionally ABSENT — weight without visual presence.
const HIGH_PRESENCE_MATERIALS: ReadonlySet<string> = new Set([
  "velvet", "leather", "lace", "tweed", "tulle", "satin", "suede", "corduroy", "mesh",
]);

// Silhouettes that carry movement / energy signal.
const MOVEMENT_SILHOUETTES: ReadonlySet<string> = new Set([
  "flared", "a-line", "balloon", "asymmetric", "wrap",
]);

// Fit profiles associated with soft, non-restrictive construction (ease dimension).
const SOFT_FIT_PROFILES: ReadonlySet<string> = new Set([
  "relaxed", "loose", "oversized", "flowy",
]);

// Fit profiles that produce definition and structure.
const STRUCTURED_FIT_PROFILES: ReadonlySet<string> = new Set([
  "tailored", "structured", "fitted",
]);

// Materials that hold shape and support structure.
const STRUCTURE_MATERIALS: ReadonlySet<string> = new Set([
  "wool", "tweed", "leather", "denim",
]);

// Materials with soft-touch or drape signal (softness dimension).
const SOFT_MATERIALS: ReadonlySet<string> = new Set([
  "silk", "satin", "chiffon", "georgette", "jersey", "knit",
]);

// Materials associated with everyday comfort and ease.
const COMFORTABLE_MATERIALS: ReadonlySet<string> = new Set([
  "jersey", "cotton", "knit", "linen",
]);

// V2: Distinctive patterns — support express-myself.
// Ordinary stripes, check, plaid, plain are excluded.
const DISTINCTIVE_PATTERNS: ReadonlySet<string> = new Set([
  "floral", "geometric", "animal-print", "abstract", "graphic",
  "polka-dot", "houndstooth", "paisley",
]);

// V2: Energy-character style tags (user-specified).
// Does NOT include "romantic" or "eclectic" (those stay in EXPRESSIVE_TAGS for express-myself only).
const ENERGY_TAGS: ReadonlySet<string> = new Set([
  "bold", "statement", "edgy", "playful", "artsy", "creative",
]);

// Style tags associated with expressive / playful character (used for express-myself).
const EXPRESSIVE_TAGS: ReadonlySet<string> = new Set([
  "bold", "statement", "edgy", "playful", "artsy", "creative", "eclectic", "romantic",
]);

// Style tags associated with structure and polish.
const STRUCTURED_TAGS: ReadonlySet<string> = new Set([
  "structured", "tailored", "polished", "refined", "elevated", "sophisticated",
]);

// Personalities that amplify expressive signals.
// V2: exact current Passport IDs only.
const EXPRESSIVE_PERSONALITIES: ReadonlySet<string> = new Set([
  "bold-edgy", "creative-expressive",
]);

// Personality → aligned style-tag tokens (for feel-like-myself, confidence, ground-me).
const PERSONALITY_TAG_MAP: Readonly<Record<string, readonly string[]>> = {
  "classic-polished":    ["classic", "polished", "refined", "tailored", "timeless", "elevated"],
  "feminine-romantic":   ["feminine", "romantic", "flowy", "effortless", "effortlessly-chic"],
  "minimal-relaxed":     ["minimal", "clean", "understated", "relaxed", "effortless"],
  "bold-edgy":           ["bold", "edgy", "statement", "creative", "eclectic"],
  "creative-expressive": ["artsy", "creative", "eclectic", "playful", "bold"],
};

// Formality ordinal — higher value = more formal.
const FORMALITY_ORDINAL: Readonly<Record<string, number>> = {
  "casual": 1,
  "smart-casual": 2,
  "business-casual": 3,
  "business-formal": 4,
  "occasion": 5,
  "evening": 5,
};

// Category groups for visual-weight logic.
const ACCESSORY_CATEGORIES: ReadonlySet<string> = new Set([
  "shoes", "bags", "accessories", "jewelry",
]);

// All 12 TODAY intention IDs (canonical — app/routes/style-me/intention.tsx).
export const ALL_INTENTIONS = [
  "feel-like-myself", "confidence", "ground-me", "give-structure",
  "make-it-easy", "feel-put-together", "feel-attractive", "give-energy",
  "feel-softer", "feel-sharper", "feel-less-exposed", "express-myself",
] as const;

export type TodayIntention = typeof ALL_INTENTIONS[number];

// ── Types ─────────────────────────────────────────────────────────────────────

// V2: strength qualification for each intention.
export type IntentionStrength = "strong" | "supporting" | "none";

export type VisualWeight = "light" | "medium" | "substantial";

// V2: hueFamily replaces BroadColourFamily (removed "neutral" — covered by wardrobeNeutral).
export type HueFamily =
  | "red" | "pink" | "orange" | "yellow"
  | "green" | "blue" | "purple"
  | "grey" | "brown";

export type LightDarkValue = "light" | "dark";
export type ColourEnergyTier =
  | "high-energy"          // red / pink / orange / yellow families
  | "deep-authoritative"   // navy / black / charcoal + dark chromatics
  | "mid-range"            // blue / green / purple / grey / brown (not deep)
  | "neutral-versatile";   // soft neutral set (not deep-authoritative)

// V2: removed "fallback" as a valid source.
export type SignalSource = "passport" | "garment";
export type SignalPolarity = "support" | "conflict";

export interface VisualWeightResult {
  value: VisualWeight | null;
  evidence: string[];
}

// V2: two-axis colour model (hueFamily + wardrobeNeutral).
// neutralChromaticity and broadFamily kept as backward-compat derived fields.
export interface ColourProfileResult {
  hueFamily: HueFamily | null;        // identifiable chromatic hue bias; null for true neutrals
  wardrobeNeutral: boolean;           // true when the colour functions as a wardrobe neutral
  lightDark: LightDarkValue | null;
  energyTier: ColourEnergyTier | null;
  evidence: string[];
  // Backward-compat: derived from hueFamily + wardrobeNeutral.
  neutralChromaticity: "neutral" | "chromatic" | null;
  broadFamily: string | null;
}

export interface SignalDetail {
  text: string;
  source: SignalSource;
  polarity: SignalPolarity;
}

export interface IntentionPotential {
  intention: string;
  /** Strength qualification — "none" when no garment/passport evidence supports this intention. */
  strength: IntentionStrength;
  /** Plain text list — backward compat with existing tests (support signals only). */
  signals: string[];
  /** All signals with provenance and polarity. Use this in the admin UI. */
  signalDetails: SignalDetail[];
}

// V2: expanded passport input with avoidColors and successfulOutfitGives.
export interface StylingPassportInput {
  stylePersonalities?: string[];
  favoriteColors?: string[];
  avoidColors?: string[];
  coveragePreferences?: string[];
  dressingPreferences?: string[];
  successfulOutfitGives?: string[];
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
 * Derive visual weight from pattern, silhouette, material, and construction (fitProfile).
 *
 * Visual weight = how much visual space a garment commands in an outfit.
 * This is NOT physical garment weight.
 *
 * V2 formula:
 *   pattern contribution + silhouette contribution + material contribution + construction contribution
 *   0 = light, 1 = medium, 2+ = substantial
 *
 * V2 changes:
 *   - Added construction dimension: tailored/structured fitProfile → +1 (fixes tailored blazer V1 bug)
 *   - Removed accessory category default: unknown/missing metadata is NOT evidence of visual weight;
 *     null is returned for ALL categories when all four inputs are absent.
 *
 * Returns null when all four inputs are absent (regardless of category).
 * Returns evidence[] as the list of positive contributors only.
 */
export function deriveVisualWeight(
  item: Pick<ClosetClassification, "pattern" | "silhouette" | "material"> &
    Partial<Pick<ClosetClassification, "fitProfile" | "category">>,
): VisualWeightResult {
  const pattern    = norm(item.pattern);
  const silhouette = norm(item.silhouette);
  const material   = norm(item.material);
  const fitProfile = norm(item.fitProfile);
  const category   = norm(item.category);

  const isAccessory = category !== null && ACCESSORY_CATEGORIES.has(category);
  const allAbsent   = pattern === null && silhouette === null && material === null && fitProfile === null;

  if (allAbsent) {
    return { value: null, evidence: [] };
  }

  const evidence: string[] = [];
  let score = 0;

  // Pattern: non-solid, non-null pattern contributes.
  if (pattern !== null && pattern !== "solid") {
    score += 1;
    evidence.push(`${pattern} pattern`);
  }

  // Silhouette: volume-adding silhouettes contribute.
  if (silhouette !== null && VOLUME_SILHOUETTES.has(silhouette)) {
    score += 1;
    evidence.push(`${silhouette} silhouette`);
  }

  // Material: high-presence materials contribute.
  if (material !== null && HIGH_PRESENCE_MATERIALS.has(material)) {
    score += 1;
    evidence.push(`${material} material`);
  }

  // Construction (V2): tailored/structured fitProfile contributes (fixes tailored blazer = light bug).
  if (fitProfile === "tailored" || fitProfile === "structured") {
    score += 1;
    evidence.push(`${fitProfile} construction`);
  }

  const value: VisualWeight =
    score === 0 ? "light" :
    score === 1 ? "medium" :
    "substantial";

  return { value, evidence };
}

// ── 2. deriveColourProfile ────────────────────────────────────────────────────

/**
 * Derive safe V2 colour intelligence from coarse stored colour tokens.
 *
 * V2 two-axis model:
 *   hueFamily      — identifiable chromatic hue (null for true neutrals like beige, cream, stone)
 *   wardrobeNeutral — true when the colour functions as a wardrobe neutral
 *
 * These axes are independent: navy has hueFamily="blue" AND wardrobeNeutral=true.
 * This replaces the V1 bug where navy rendered as "neutral · neutral" (duplicated).
 *
 * What is safely derivable from coarse tokens:
 *   - wardrobeNeutral (defined neutral set)
 *   - hueFamily (token-to-family lookup)
 *   - Unambiguous light/dark (only where stored token is reliable)
 *   - Energy tier (for intention reasoning)
 *
 * Not derived (requires colour qualifier storage):
 *   - Warm vs cool temperature ("blue" could be cobalt or teal)
 *   - Muted vs vivid saturation ("red" covers dusty rose and scarlet)
 */
export function deriveColourProfile(
  item: Pick<ClosetClassification, "primaryColor" | "colors">,
): ColourProfileResult {
  const primaryColor = norm(item.primaryColor);

  if (primaryColor === null) {
    return { hueFamily: null, wardrobeNeutral: false, lightDark: null, energyTier: null, evidence: [], neutralChromaticity: null, broadFamily: null };
  }

  const evidence: string[] = [primaryColor];
  const wardrobeNeutral = NEUTRAL_COLORS.has(primaryColor);
  const hueFamily: HueFamily | null = COLOUR_FAMILY_MAP[primaryColor] ?? null;

  // Light/dark: only where the stored token makes it unambiguous.
  let lightDark: LightDarkValue | null = null;
  if (UNAMBIGUOUS_DARK.has(primaryColor))       lightDark = "dark";
  else if (UNAMBIGUOUS_LIGHT.has(primaryColor)) lightDark = "light";

  // Energy tier.
  let energyTier: ColourEnergyTier | null = null;
  if (wardrobeNeutral) {
    energyTier =
      primaryColor === "black" || primaryColor === "navy" || primaryColor === "charcoal"
        ? "deep-authoritative"
        : "neutral-versatile";
  } else if (hueFamily !== null) {
    if (HIGH_ENERGY_FAMILIES.has(hueFamily)) {
      energyTier = "high-energy";
    } else if (UNAMBIGUOUS_DARK.has(primaryColor)) {
      energyTier = "deep-authoritative";
    } else {
      energyTier = "mid-range";
    }
  }

  const neutralChromaticity: "neutral" | "chromatic" | null =
    wardrobeNeutral ? "neutral" :
    hueFamily !== null ? "chromatic" : null;
  const broadFamily: string | null = hueFamily ?? (wardrobeNeutral ? "neutral" : null);

  return { hueFamily, wardrobeNeutral, lightDark, energyTier, evidence, neutralChromaticity, broadFamily };
}

// ── 3. computeGarmentIntentionPotential ──────────────────────────────────────

/**
 * Shadow-only: derive which garment facts might be relevant to a given TODAY
 * intention for a specific customer context.
 *
 * V2 changes:
 *   - All 12 intentions include a strength field ("strong" | "supporting" | "none")
 *   - NONE is the universal default; strength is determined by intention-specific rules
 *   - SignalDetail has polarity ("support" | "conflict"); "fallback" source removed
 *   - avoidColors conflict signal added to relevant intentions (feel-like-myself, confidence)
 *   - No fb() fallback signals; if no evidence → NONE + empty signals
 *   - Visual weight is an amplifier for give-energy (not an independent energy channel)
 *
 * IMPORTANT — V1 isolation boundary:
 *   This function MUST NOT be imported from or called by:
 *     - styleme-recommendation.ts
 *     - styleme-result.server.ts
 *     - Any T1–T5/T6 ranking or candidate selection
 *   Any such import is a Phase 3C boundary violation.
 *
 * Signals describe potential — they are not claims that the garment automatically
 * produces any particular feeling. Context (passport + today) conditions which
 * garment facts are relevant.
 */
export function computeGarmentIntentionPotential(
  garment: ClosetClassification,
  intention: string,
  passport: StylingPassportInput,
  todayContext: TodayContextInput,
): IntentionPotential {
  const signalDetails: SignalDetail[] = [];
  const g = (text: string) => signalDetails.push({ text, source: "garment", polarity: "support" });
  const p = (text: string) => signalDetails.push({ text, source: "passport", polarity: "support" });
  const conflict = (text: string) => signalDetails.push({ text, source: "passport", polarity: "conflict" });

  const fitProfile       = norm(garment.fitProfile);
  const silhouette       = norm(garment.silhouette);
  const material         = norm(garment.material);
  const pattern          = norm(garment.pattern);
  const primaryColor     = norm(garment.primaryColor);
  const hemLength        = norm(garment.hemLength);
  const sleeveLength     = norm(garment.sleeveLength);
  const necklineCoverage = norm(garment.necklineCoverage);
  const formality        = norm(garment.formality);
  const tags             = normArr(garment.styleTags);
  const occasions        = normArr(garment.occasions);

  const colourProfile  = deriveColourProfile(garment);
  const visualWeight   = deriveVisualWeight(garment);
  const formalityOrdinal = formality ? (FORMALITY_ORDINAL[formality] ?? 0) : 0;

  const passPersonalities = normArr(passport.stylePersonalities);
  const favColors         = normArr(passport.favoriteColors);
  const avoidColors       = normArr(passport.avoidColors);

  // Shared: avoidColors conflict check (used by feel-like-myself and confidence).
  const primaryColorAvoided = primaryColor !== null && avoidColors.includes(primaryColor);

  let strength: IntentionStrength = "none";

  switch (intention) {

    // ── feel-like-myself ────────────────────────────────────────────────────
    case "feel-like-myself": {
      // Requires Passport for meaningful personal signal. NONE when no match.
      let hasPositive = false;

      if (passPersonalities.length > 0 && tags.length > 0) {
        const relevantTags = passPersonalities.flatMap(pp => PERSONALITY_TAG_MAP[pp] ?? []);
        const aligned = tags.filter(t => relevantTags.includes(t));
        if (aligned.length > 0) {
          p(`style aligns with your personality (${aligned.join(", ")})`);
          hasPositive = true;
        }
      }

      if (primaryColor && favColors.includes(primaryColor)) {
        p("includes a colour you love");
        hasPositive = true;
      }

      if (primaryColorAvoided) {
        conflict("primary colour matches your avoid list");
      }

      strength = hasPositive ? "supporting" : "none";
      break;
    }

    // ── confidence ──────────────────────────────────────────────────────────
    case "confidence": {
      // V2: Passport alignment required. No generic garment scoring.
      // STRONG:     never at item level (V2.0).
      // SUPPORTING: style identity alignment OR stated dressing/coverage need satisfied.
      // NONE:       no Passport/personal match.
      let hasPositive = false;

      if (passPersonalities.length > 0 && tags.length > 0) {
        const relevantTags = passPersonalities.flatMap(pp => PERSONALITY_TAG_MAP[pp] ?? []);
        const aligned = tags.filter(t => relevantTags.includes(t));
        if (aligned.length > 0) {
          p("authentic to your style personality");
          hasPositive = true;
        }
      }

      const coveragePrefs = normArr(passport.coveragePreferences);
      if (coveragePrefs.includes("sleeves-preferred")) {
        const hasSleevesSatisfied = sleeveLength !== null && ["full", "three-quarter"].includes(sleeveLength);
        if (hasSleevesSatisfied) { p("sleeve coverage matches your preference"); hasPositive = true; }
      }
      if (coveragePrefs.includes("longer-hemlines")) {
        const hasLongHemSatisfied = hemLength !== null && ["midi", "maxi", "full"].includes(hemLength);
        if (hasLongHemSatisfied) { p("longer hemline matches your preference"); hasPositive = true; }
      }
      // dressingPreferences may also state a genuine coverage need
      const dressingPrefsConf = normArr(passport.dressingPreferences);
      const hasConfCoverageNeed = dressingPrefsConf.some(dp =>
        ["arms-covered", "avoid-sleeveless", "chest-neckline-covered", "prefer-higher-necklines",
         "legs-covered", "prefer-full-length-trousers", "avoid-shorts",
         "dresses-modestly", "wears-hijab", "usually-wears-abayas", "kanduras-thobes"].includes(dp));
      if (hasConfCoverageNeed) {
        const hasAnyCovZone = (sleeveLength !== null && ["full", "three-quarter"].includes(sleeveLength)) ||
          garment.shoulderCoverage === true ||
          (necklineCoverage !== null && ["high", "crew", "mock", "cowl-high", "shirt-collar"].includes(necklineCoverage)) ||
          (hemLength !== null && ["midi", "maxi", "full"].includes(hemLength));
        if (hasAnyCovZone) { p("coverage meets your stated preferences"); hasPositive = true; }
      }

      if (primaryColorAvoided) {
        conflict("primary colour matches your avoid list");
      }

      strength = hasPositive ? "supporting" : "none";
      break;
    }

    // ── ground-me ──────────────────────────────────────────────────────────
    case "ground-me": {
      // NONE by default; SUPPORTING only when:
      //   1. Garment styleTags align with ANY of the customer's actual stylePersonalities
      //      (via PERSONALITY_TAG_MAP — genuine alignment, not hardcoded ID set)
      //   2. AND garment has a POSITIVE ease/softness attribute (SOFT_FIT_PROFILES or SOFT_MATERIALS)
      const hasPersonalityAlignment = passPersonalities.length > 0 && tags.length > 0 &&
        passPersonalities.some(pp => {
          const relevant = PERSONALITY_TAG_MAP[pp] ?? [];
          return tags.some(t => relevant.includes(t));
        });

      // Ease/fit is required — soft material alone is not a grounding contribution.
      const hasEase = fitProfile !== null && SOFT_FIT_PROFILES.has(fitProfile);
      const hasSoftMaterial = material !== null && SOFT_MATERIALS.has(material);

      if (hasPersonalityAlignment && hasEase) {
        p("ease and softness resonates with your style direction");
        g(`ease in the fit — ${fitProfile}`);
        if (hasSoftMaterial) g(`soft material — ${material}`);
        strength = "supporting";
      }
      break;
    }

    // ── give-structure ──────────────────────────────────────────────────────
    case "give-structure": {
      // fitProfile is REQUIRED; silhouette or material alone do not establish SUPPORTING.
      const hasPreciseFit = fitProfile !== null && STRUCTURED_FIT_PROFILES.has(fitProfile);
      if (!hasPreciseFit) break; // NONE

      g(`${fitProfile} fit provides definition`);

      const hasStructureMaterial = material !== null && STRUCTURE_MATERIALS.has(material);
      if (hasStructureMaterial) g(`${material} — construction-supporting material`);

      const hasStructuredSilhouette = silhouette !== null && (silhouette === "straight" || silhouette === "column");
      if (hasStructuredSilhouette) g("clean geometric lines");

      const structuredTags = tags.filter(t => STRUCTURED_TAGS.has(t));
      if (structuredTags.length > 0) g(`structured aesthetic character (${structuredTags.join(", ")})`);

      // STRONG: fit + at least one genuinely corroborating structural dimension (material or silhouette).
      strength = (hasStructureMaterial || hasStructuredSilhouette) ? "strong" : "supporting";
      break;
    }

    // ── make-it-easy ────────────────────────────────────────────────────────
    case "make-it-easy": {
      // APPROVED V2 RULE:
      //   STRONG:     comfortable material + soft/relaxed fit + casual/easy occasion or formality (3 dimensions)
      //   SUPPORTING: two legitimate ease dimensions
      //   NONE:       default; material alone MUST NOT qualify (single dimension = NONE)
      // Signals are only added when strength ≥ SUPPORTING (maintains strength=none → signals empty invariant).
      const hasComfortableMaterial = material !== null && COMFORTABLE_MATERIALS.has(material);
      const hasSoftFitEasy = fitProfile !== null && SOFT_FIT_PROFILES.has(fitProfile);
      const hasCasualContext = formality === "casual" ||
        occasions.some(o => ["casual", "weekend", "loungewear"].includes(o));

      const easyCount = (hasComfortableMaterial ? 1 : 0) + (hasSoftFitEasy ? 1 : 0) + (hasCasualContext ? 1 : 0);

      if (easyCount < 2) break; // NONE — single dimension does not qualify

      if (hasComfortableMaterial) g(`comfortable material — ${material}`);
      if (hasSoftFitEasy) g("comfortable, non-restrictive fit");
      if (formality === "casual") g("casual, low-effort register");
      else if (hasCasualContext) g("suited to easy-going contexts");

      strength = easyCount >= 3 ? "strong" : "supporting";
      break;
    }

    // ── feel-put-together ────────────────────────────────────────────────────
    case "feel-put-together": {
      // V2: pattern=null produces NO evidence. Count first — signals added only when ≥2 dimensions.
      // SUPPORTING = 2 dimensions; STRONG = 3 dimensions; NONE = 0 or 1 dimension.
      let evidenceCount = 0;
      if (formalityOrdinal >= 2) evidenceCount++;
      const polishedTags = tags.filter(t =>
        ["refined", "elevated", "polished", "classic", "timeless", "chic"].includes(t));
      if (polishedTags.length > 0) evidenceCount++;
      if (occasions.some(o => ["work", "evening", "special-occasion"].includes(o))) evidenceCount++;

      if (evidenceCount < 2) break; // NONE — single dimension insufficient

      if (formalityOrdinal >= 2) g(`elevated formality — ${formality}`);
      if (polishedTags.length > 0) g(`polished styling character (${polishedTags.join(", ")})`);
      if (occasions.some(o => ["work", "evening", "special-occasion"].includes(o))) {
        g("appropriate for polished contexts");
      }

      strength = evidenceCount >= 3 ? "strong" : "supporting";
      break;
    }

    // ── feel-attractive ──────────────────────────────────────────────────────
    case "feel-attractive": {
      // V2: Requires personal evidence — not item-level generalisation.
      // STRONG:     never at item level (V2.0).
      // SUPPORTING: successfulOutfitGives contains "feel-attractive"
      //             AND genuine Passport style-personality alignment with the garment.
      // NONE:       default.
      const successfulGives = normArr(passport.successfulOutfitGives);
      if (!successfulGives.includes("feel-attractive")) break;

      if (passPersonalities.length === 0 || tags.length === 0) break;
      const relevantTags = passPersonalities.flatMap(pp => PERSONALITY_TAG_MAP[pp] ?? []);
      const aligned = tags.filter(t => relevantTags.includes(t));
      if (aligned.length === 0) break;

      p("you feel attractive in outfits like this");
      p(`aligns with your style personality (${aligned.join(", ")})`);
      strength = "supporting";
      break;
    }

    // ── give-energy ──────────────────────────────────────────────────────────
    case "give-energy": {
      // Three energy channels; visual weight is an amplifier only (cannot independently establish energy).
      let activeChannels = 0;

      // Channel 1: ENERGY_TAGS (bold, statement, edgy, playful, artsy, creative)
      // Does NOT include romantic or eclectic.
      const energyTagsHit = tags.filter(t => ENERGY_TAGS.has(t));
      if (energyTagsHit.length > 0) {
        g(`expressive energy character (${energyTagsHit.join(", ")})`);
        activeChannels++;
      }

      // Channel 2: movement silhouette
      if (silhouette !== null && MOVEMENT_SILHOUETTES.has(silhouette)) {
        g("movement in the silhouette");
        activeChannels++;
      }

      // Channel 3: high-energy colour family
      if (colourProfile.energyTier === "high-energy" && primaryColor !== null) {
        g(`chromatic colour — ${primaryColor}`);
        activeChannels++;
      }

      // Visual weight amplifier: upgrades SUPPORTING → STRONG when already active.
      const isSubstantial = visualWeight.value === "substantial";

      if (activeChannels === 0) {
        strength = "none";
      } else if (activeChannels >= 2 || (activeChannels === 1 && isSubstantial)) {
        strength = "strong";
      } else {
        strength = "supporting";
      }
      break;
    }

    // ── feel-softer ──────────────────────────────────────────────────────────
    case "feel-softer": {
      // APPROVED V2 RULE:
      //   STRONG:      soft material + soft/flowy fit + movement/drape silhouette (all three)
      //   SUPPORTING:  (soft material + soft fit) OR (soft fit + movement/gentle silhouette)
      //   NONE:        material alone, movement silhouette alone, fit alone is SUPPORTING
      // Soft fitProfile is the primary gate — silhouette or material alone cannot establish SUPPORTING.
      const hasSoftFit = fitProfile !== null && SOFT_FIT_PROFILES.has(fitProfile);
      const hasSoftMaterial = material !== null && SOFT_MATERIALS.has(material);
      const hasSoftSilhouette =
        silhouette !== null && (silhouette === "wrap" || silhouette === "a-line" || silhouette === "flared");

      if (!hasSoftFit) break; // material alone → NONE; silhouette alone → NONE
      // fit alone also NONE — requires at least one corroborating dimension
      if (!hasSoftMaterial && !hasSoftSilhouette) break;

      if (hasSoftFit) g("relaxed, non-restrictive fit");
      if (hasSoftSilhouette) g("gentle, non-angular silhouette");
      if (hasSoftMaterial) g(`softness from ${material}`);

      // STRONG: all three dimensions (fit + material + silhouette).
      // SUPPORTING: fit + one other dimension.
      if (hasSoftMaterial && hasSoftSilhouette) {
        strength = "strong";
      } else {
        strength = "supporting";
      }
      break;
    }

    // ── feel-sharper ────────────────────────────────────────────────────────
    case "feel-sharper": {
      // "fitted alone = NONE" (V2 rule).
      // Only tailored or structured fitProfile can establish SUPPORTING.
      const hasPreciseFit = fitProfile === "tailored" || fitProfile === "structured";
      if (!hasPreciseFit) break; // NONE — includes fitted alone

      g("precise fit adds definition");

      const hasSharpMaterial = material !== null &&
        (material === "wool" || material === "leather" || material === "tweed" || material === "denim");
      if (hasSharpMaterial) g(`${material} — holds sharp lines`);

      if (silhouette !== null && (silhouette === "straight" || silhouette === "column")) {
        g("clean, defined lines");
      }

      // Aesthetic tags (minimal, clean, sophisticated, contemporary) are removed:
      // they are not construction evidence. Only construction-based signals qualify.

      strength = hasSharpMaterial ? "strong" : "supporting";
      break;
    }

    // ── feel-less-exposed ────────────────────────────────────────────────────
    case "feel-less-exposed": {
      // Layer A: ALWAYS record objective coverage facts (before any Passport check — for admin review).
      const hasSleeveCoverage   = sleeveLength !== null && ["full", "three-quarter"].includes(sleeveLength);
      const hasCoveredNeckline  = necklineCoverage !== null &&
        ["high", "crew", "mock", "cowl-high", "shirt-collar"].includes(necklineCoverage);
      const hasLongHem          = hemLength !== null && ["midi", "maxi", "full"].includes(hemLength);
      const hasMidriffCovered   = garment.midriffExposed === false;
      const hasLooserFit        = fitProfile !== null && SOFT_FIT_PROFILES.has(fitProfile);
      const hasShoulderCoverage = garment.shoulderCoverage === true;

      if (hasShoulderCoverage)    g("shoulders covered");
      if (hasMidriffCovered)      g("midriff not exposed");
      if (hasCoveredNeckline)     g(`covered neckline — ${necklineCoverage}`);
      if (hasLongHem)             g(`longer hem — ${hemLength}`);
      if (hasSleeveCoverage)      g(`sleeve coverage — ${sleeveLength}`);
      if (hasLooserFit)           g(`relaxed fit — ${fitProfile}`);

      // Layer B: strength requires exact stated Passport coverage need (controlled vocabulary only).
      const dressingPrefs = normArr(passport.dressingPreferences);

      if (dressingPrefs.includes("no-dressing-requirements")) break;

      const wantsSleevesCovered  = dressingPrefs.some(dp => dp === "arms-covered" || dp === "avoid-sleeveless");
      const wantsNecklineCovered = dressingPrefs.some(dp => dp === "chest-neckline-covered" || dp === "prefer-higher-necklines");
      const wantsLegsCovered     = dressingPrefs.some(dp =>
        dp === "legs-covered" || dp === "prefer-full-length-trousers" || dp === "avoid-shorts");
      const wantsMidriffCovered  = dressingPrefs.some(dp => dp === "longer-tops" || dp === "no-cropped-tops");
      const wantsLooserFitPref   = dressingPrefs.some(dp => dp === "looser-fitting");
      const wantsModest          = dressingPrefs.some(dp =>
        ["dresses-modestly", "wears-hijab", "usually-wears-abayas", "kanduras-thobes"].includes(dp));

      const hasAnyCoverageNeed = wantsSleevesCovered || wantsNecklineCovered || wantsLegsCovered ||
        wantsMidriffCovered || wantsLooserFitPref || wantsModest;
      if (!hasAnyCoverageNeed) break;

      // Category applicability: non-clothing items cannot satisfy coverage requirements.
      const categoryNorm = norm(garment.category);
      if (categoryNorm !== null && ACCESSORY_CATEGORIES.has(categoryNorm)) break;

      const isTopsLike    = categoryNorm === null ||
        ["tops", "dresses", "outerwear", "activewear", "swimwear", "loungewear"].includes(categoryNorm);
      const isBottomsLike = categoryNorm === null ||
        ["bottoms", "dresses", "activewear", "swimwear", "loungewear"].includes(categoryNorm);
      const isTorsoLike   = categoryNorm === null ||
        ["tops", "dresses", "activewear", "swimwear", "loungewear"].includes(categoryNorm);

      let applicable = 0;
      let satisfied  = 0;

      if (wantsSleevesCovered && isTopsLike) {
        applicable++;
        if (hasSleeveCoverage || hasShoulderCoverage) satisfied++;
      }
      if (wantsNecklineCovered && isTopsLike) {
        applicable++;
        if (hasCoveredNeckline) satisfied++;
      }
      if (wantsLegsCovered && isBottomsLike) {
        applicable++;
        if (hasLongHem) satisfied++;
      }
      if (wantsMidriffCovered && isTorsoLike) {
        applicable++;
        if (hasMidriffCovered) satisfied++;
      }
      if (wantsLooserFitPref) {
        applicable++;
        if (hasLooserFit) satisfied++;
      }
      if (wantsModest) {
        applicable++;
        const modestyZones = [
          isTopsLike    && (hasSleeveCoverage || hasShoulderCoverage),
          isTopsLike    && hasCoveredNeckline,
          isTorsoLike   && hasMidriffCovered,
          isBottomsLike && hasLongHem,
        ].filter(Boolean).length;
        if (modestyZones >= 2) satisfied++;
      }

      if (applicable === 0 || satisfied === 0) break;

      strength = satisfied >= applicable ? "strong" : "supporting";
      break;
    }

    // ── express-myself ───────────────────────────────────────────────────────
    case "express-myself": {
      // APPROVED V2 RULE:
      //   STRONG:     one genuine expressive garment signal
      //               + another expressive channel (distinctive pattern OR high-impact colour)
      //   SUPPORTING: one genuine expressive garment signal (expressive tag)
      //               OR distinctive pattern + expressive Passport alignment
      //   NONE:       ordinary chromatic colour alone, ordinary stripe/check/plaid alone,
      //               Passport personality alone, distinctive pattern alone (no Passport)
      //
      // "Genuine garment signal" = expressive style tag (bold, statement, edgy, playful, artsy, creative, eclectic, romantic).
      // Distinctive pattern alone is NOT a genuine garment signal — it needs Passport to reach SUPPORTING.
      const hasDistinctivePattern = pattern !== null && DISTINCTIVE_PATTERNS.has(pattern);
      const expressiveTagsHit = tags.filter(t => EXPRESSIVE_TAGS.has(t));
      const hasExpressiveTags = expressiveTagsHit.length > 0;
      const isHighImpactColour = colourProfile.energyTier === "high-energy" && primaryColor !== null;
      const hasExpressivePersonality = passPersonalities.some(pp => EXPRESSIVE_PERSONALITIES.has(pp));

      if (hasDistinctivePattern) g(`distinctive ${pattern} pattern`);
      if (hasExpressiveTags) g(`expressive character (${expressiveTagsHit.join(", ")})`);
      if (isHighImpactColour && (hasExpressiveTags || hasDistinctivePattern)) {
        g(`high-impact colour — ${primaryColor}`);
      }
      if (hasExpressivePersonality && (hasExpressiveTags || hasDistinctivePattern)) {
        p("aligns with your expressive personality");
      }

      if (hasExpressiveTags) {
        // Genuine garment signal: expressive tags alone = SUPPORTING.
        // STRONG when a second expressive channel is present.
        const hasSecondChannel = hasDistinctivePattern || isHighImpactColour;
        strength = hasSecondChannel ? "strong" : "supporting";
      } else if (hasDistinctivePattern) {
        // Distinctive pattern alone: requires Passport alignment for SUPPORTING.
        strength = hasExpressivePersonality ? "supporting" : "none";
      } else {
        // High-impact colour alone, ordinary pattern alone, Passport alone → NONE.
        strength = "none";
      }
      break;
    }
  }

  // signals[] = support signals only (backward compat).
  const signals = signalDetails.filter(sd => sd.polarity === "support").map(sd => sd.text);

  return { intention, strength, signals, signalDetails };
}

// ── 4. deriveGarmentStylingIntelligence (admin wrapper) ──────────────────────

/**
 * Combine all V2 derived intelligence for a single garment.
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
  const visualWeight  = deriveVisualWeight(classification);
  const colourProfile = deriveColourProfile(classification);

  const passportInput: StylingPassportInput = passport ?? {};
  const intentionPotentials = ALL_INTENTIONS.map(intention =>
    computeGarmentIntentionPotential(classification, intention, passportInput, {}),
  );

  return { visualWeight, colourProfile, intentionPotentials, passportUsed: passport !== null };
}
