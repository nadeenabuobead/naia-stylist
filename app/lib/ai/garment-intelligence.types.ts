// Garment Intelligence contract — schema version 1.0
// Shared typed vocabulary for Closet, Buy/Skip, and catalogue garments.
// Group 3B target: Closet. Buy/Skip and catalogue ingestion are future consumers.
//
// Design principles:
//   - Tier 2 (observables): raw facts extractable from image; Group 2 vocab reused
//   - Tier 3 (matchingSignals): inferred styling signals; all vocabulary-normalized
//   - User-supplied inputs (category, userColors) are NEVER overwritten by AI
//   - analysisStatus tracks the analysis lifecycle; evidence level is derived
//   - "n/a" = field not applicable to this garment type (categorical)
//   - null  = field applicable but image evidence is insufficient (suppressed)

import type {
  SleeveLength,
  NecklineCoverage,
  HemLength,
  TopLength,
  FitProfile,
} from "./signal-contract";

export type { SleeveLength, NecklineCoverage, HemLength, TopLength, FitProfile };

export const GARMENT_INTELLIGENCE_SCHEMA_VERSION = "1.0";

// ── Runtime value sets (mirror signal-contract union types) ───────────────────
// Kept in sync with their corresponding type aliases in signal-contract.ts.

export const SLEEVE_LENGTH_VALUES: ReadonlySet<SleeveLength> = new Set([
  "full", "three-quarter", "short", "sleeveless", "n/a",
] as SleeveLength[]);

export const NECKLINE_COVERAGE_VALUES: ReadonlySet<NecklineCoverage> = new Set([
  "high", "crew", "mock", "cowl-high", "v-neck", "low", "off-shoulder", "wrap-variable", "n/a",
] as NecklineCoverage[]);

export const HEM_LENGTH_VALUES: ReadonlySet<HemLength> = new Set([
  "full", "maxi", "midi", "knee", "mini", "n/a",
] as HemLength[]);

export const TOP_LENGTH_VALUES: ReadonlySet<TopLength> = new Set([
  "cropped", "hip-length", "longline", "tunic", "n/a",
] as TopLength[]);

export const FIT_PROFILE_VALUES: ReadonlySet<FitProfile> = new Set([
  "fitted", "body-skimming", "tailored", "structured",
  "relaxed", "loose", "oversized", "flowy", "n/a",
] as FitProfile[]);

// ── Garment-specific vocabulary ───────────────────────────────────────────────

// Garment silhouette — observable garment shape as seen in the image.
// DISTINCT from SMCM tokens (which describe garment–body suitability for a person).
export type GarmentSilhouette =
  | "a-line" | "straight" | "column" | "fitted"
  | "flared" | "wrap" | "shift" | "oversized"
  | "balloon" | "asymmetric";

export const GARMENT_SILHOUETTE_VALUES: ReadonlySet<GarmentSilhouette> = new Set([
  "a-line", "straight", "column", "fitted", "flared",
  "wrap", "shift", "oversized", "balloon", "asymmetric",
] as GarmentSilhouette[]);

export type GarmentWaistShape =
  | "high-rise" | "mid-rise" | "low-rise" | "empire"
  | "drop-waist" | "belted" | "elasticated" | "drawstring";

export const GARMENT_WAIST_SHAPE_VALUES: ReadonlySet<GarmentWaistShape> = new Set([
  "high-rise", "mid-rise", "low-rise", "empire",
  "drop-waist", "belted", "elasticated", "drawstring",
] as GarmentWaistShape[]);

export type GarmentPattern =
  | "solid" | "stripes" | "floral" | "geometric" | "animal-print"
  | "check" | "plaid" | "abstract" | "polka-dot" | "houndstooth"
  | "paisley" | "graphic";

export const GARMENT_PATTERN_VALUES: ReadonlySet<GarmentPattern> = new Set([
  "solid", "stripes", "floral", "geometric", "animal-print",
  "check", "plaid", "abstract", "polka-dot", "houndstooth", "paisley", "graphic",
] as GarmentPattern[]);

export type GarmentMaterial =
  | "cotton" | "linen" | "silk" | "satin" | "wool" | "cashmere"
  | "denim" | "leather" | "suede" | "velvet" | "polyester" | "nylon"
  | "knit" | "jersey" | "chiffon" | "georgette" | "lace" | "tweed" | "corduroy";

export const GARMENT_MATERIAL_VALUES: ReadonlySet<GarmentMaterial> = new Set([
  "cotton", "linen", "silk", "satin", "wool", "cashmere", "denim",
  "leather", "suede", "velvet", "polyester", "nylon", "knit", "jersey",
  "chiffon", "georgette", "lace", "tweed", "corduroy",
] as GarmentMaterial[]);

export type GarmentFormality =
  | "casual" | "smart-casual" | "business-casual"
  | "business-formal" | "occasion" | "evening";

export const GARMENT_FORMALITY_VALUES: ReadonlySet<GarmentFormality> = new Set([
  "casual", "smart-casual", "business-casual", "business-formal", "occasion", "evening",
] as GarmentFormality[]);

// Occasion tokens — kept compatible with the session occasion vocabulary.
export const GARMENT_OCCASION_VALUES: ReadonlySet<string> = new Set([
  "work", "casual", "weekend", "evening", "date-night",
  "special-occasion", "travel", "gym", "beach", "loungewear",
]);

export const GARMENT_SEASON_VALUES: ReadonlySet<string> = new Set([
  "spring", "summer", "fall", "winter", "all-season",
]);

// V3 style personality archetypes.
// Values must match PROFILE_SP_V2_TO_V3_MAP values in signal-contract.ts.
export const GARMENT_STYLE_PERSONALITY_VALUES: ReadonlySet<string> = new Set([
  "classic-polished",
  "feminine-romantic",
  "minimal-relaxed",
  "bold-edgy",
  "creative-expressive",
]);

// Style tag tokens — Rev 4 vocabulary.
// Keep in sync with styleTag tokens in naia-catalog.generated.ts.
export const GARMENT_STYLE_TAG_VOCAB: ReadonlySet<string> = new Set([
  "feminine", "flowy", "romantic", "effortless", "effortlessly-chic",
  "structured", "tailored", "classic", "polished", "elevated", "refined",
  "edgy", "bold", "statement", "minimal", "clean", "understated",
  "casual", "relaxed", "oversized", "artsy", "creative", "eclectic",
  "trendy", "contemporary", "timeless", "chic", "sophisticated",
  "playful", "luxe",
]);

// ── Analysis lifecycle ────────────────────────────────────────────────────────

export type GarmentAnalysisStatus =
  | "not_analyzed"  // default — no extraction attempted
  | "pending"       // extraction in progress
  | "ready"         // extraction complete (ai_partial or ai_full)
  | "failed";       // extraction attempted but could not complete; user_only evidence preserved

// ── Evidence level (derived, never stored directly) ───────────────────────────

export type GarmentEvidenceLevel = "user_only" | "ai_partial" | "ai_full";

// ── Field confidence ──────────────────────────────────────────────────────────

export type FieldConfidenceLevel = "high" | "medium" | "low";

export type GarmentFieldConfidence = Partial<Record<
  | "subcategory" | "silhouette" | "fitProfile" | "hemLength" | "topLength"
  | "sleeveLength" | "necklineCoverage" | "shoulderCoverage" | "midriffExposed"
  | "waistShape" | "material" | "pattern" | "primaryColor" | "secondaryColors",
  FieldConfidenceLevel
>>;

// ── Observable garment attributes (Tier 2) ───────────────────────────────────
// Raw facts extracted from the garment image.
// Field names mirror DressingMetadata from signal-contract.ts where applicable
// so Group 2 constraint derivation can reuse the same vocabulary.

export interface GarmentObservables {
  // Categorisation
  subcategory: string | null;

  // Geometry / shape
  silhouette: GarmentSilhouette | null;
  fitProfile: FitProfile | null;        // Group 2 vocab; "n/a" for non-applicable
  hemLength: HemLength | null;          // Group 2 vocab; "n/a" for tops/outerwear
  topLength: TopLength | null;          // Group 2 vocab; "n/a" for bottoms/dresses
  waistShape: GarmentWaistShape | null;

  // Coverage / construction — Group 2 dressing constraint fields
  sleeveLength: SleeveLength | null;           // Group 2 vocab; "n/a" when not applicable
  necklineCoverage: NecklineCoverage | null;   // Group 2 vocab; null if neckline not visible
  shoulderCoverage: boolean | null;
  midriffExposed: boolean | null;

  // Texture / colour
  material: GarmentMaterial | null;
  pattern: GarmentPattern | null;
  primaryColor: string | null;     // main colour, lowercase vocabulary name
  secondaryColors: string[];       // up to 2 secondary colours, empty array if none
}

// ── Matching signals (Tier 3) ─────────────────────────────────────────────────
// Inferred styling signals. All values vocabulary-normalized before storage.
// Conservative: return null / empty rather than forcing a weak match.

export interface GarmentMatchingSignals {
  occasions: string[];              // GARMENT_OCCASION_VALUES tokens
  seasons: string[];                // GARMENT_SEASON_VALUES tokens
  formality: GarmentFormality | null;
  styleTags: string[];              // GARMENT_STYLE_TAG_VOCAB tokens, max 3
  stylePersonality: string | null;  // single V3 archetype or null
}

// ── User-verified inputs (never overwritten by AI extraction) ─────────────────

export interface GarmentUserInputs {
  category: string;           // ClosetCategory enum value — always user-provided
  userColors?: string[];      // user-selected colours (BOS pill selection; not yet in Closet)
}

// ── Full GarmentIntelligence record ──────────────────────────────────────────

export interface GarmentIntelligence {
  source: "closet" | "bos" | "catalog" | "partner";
  sourceId: string;
  schemaVersion: string;

  // User-verified inputs — never overwritten by AI
  userInputs: GarmentUserInputs;

  // Analysis lifecycle
  analysisStatus: GarmentAnalysisStatus;
  analyzedAt?: Date;
  analysisSchemaVersion?: string;

  // Raw observable attributes (Tier 2)
  observables?: GarmentObservables;
  fieldConfidence?: GarmentFieldConfidence;

  // Derived matching signals (Tier 3)
  matchingSignals?: GarmentMatchingSignals;
}

// ── Evidence level derivation ─────────────────────────────────────────────────
// Colour alone does not elevate evidence. "n/a" is a valid known value but
// does not count as positive geometry evidence.

export function deriveEvidenceLevel(gi: GarmentIntelligence): GarmentEvidenceLevel {
  if (gi.analysisStatus !== "ready" || !gi.observables) return "user_only";
  const obs = gi.observables;
  const hasGeometry =
    obs.silhouette !== null ||
    (obs.hemLength !== null && obs.hemLength !== "n/a") ||
    (obs.sleeveLength !== null && obs.sleeveLength !== "n/a") ||
    (obs.fitProfile !== null && obs.fitProfile !== "n/a");
  const signals = gi.matchingSignals;
  const hasStyling =
    (signals?.occasions?.length ?? 0) > 0 ||
    (signals?.styleTags?.length ?? 0) > 0 ||
    signals?.stylePersonality != null;
  if (hasGeometry && hasStyling) return "ai_full";
  if (hasGeometry || obs.primaryColor !== null || obs.material !== null) return "ai_partial";
  return "user_only";
}

// ── Extraction result (returned by closet-garment-analysis.server.ts) ─────────

export interface GarmentExtractionResult {
  observables: GarmentObservables;
  matchingSignals: GarmentMatchingSignals;
  fieldConfidence: GarmentFieldConfidence;
}
