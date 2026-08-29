// Garment intelligence extraction for Digital Closet items.
// Called after a Closet upload succeeds. Runs non-blocking (fire-and-forget from
// the upload action). Updates the ClosetItem record with extracted intelligence.
//
// Uses claude-sonnet-4-5 for vision accuracy (not Haiku).
// Reuses Group 2 vocabulary (sleeveLength, necklineCoverage, hemLength, topLength,
// fitProfile) so downstream constraint derivation requires no vocabulary bridging.
//
// Analysis lifecycle managed via ClosetItem.analysisStatus:
//   not_analyzed → pending → ready | failed
// A failed extraction preserves all user-supplied fields untouched.

import prisma from "../../db.server.js";
import { analyzeImage } from "./claude.server.js";
import { buildSignedDeliveryUrl } from "../cloudinary-admin.server";
import {
  GARMENT_INTELLIGENCE_SCHEMA_VERSION,
  GARMENT_SILHOUETTE_VALUES,
  GARMENT_WAIST_SHAPE_VALUES,
  GARMENT_PATTERN_VALUES,
  GARMENT_MATERIAL_VALUES,
  GARMENT_FORMALITY_VALUES,
  GARMENT_OCCASION_VALUES,
  GARMENT_SEASON_VALUES,
  GARMENT_STYLE_PERSONALITY_VALUES,
  GARMENT_STYLE_TAG_VOCAB,
  SLEEVE_LENGTH_VALUES,
  NECKLINE_COVERAGE_VALUES,
  HEM_LENGTH_VALUES,
  TOP_LENGTH_VALUES,
  FIT_PROFILE_VALUES,
  deriveEvidenceLevel,
} from "./garment-intelligence.types";
import type {
  GarmentObservables,
  GarmentMatchingSignals,
  GarmentExtractionResult,
  GarmentFieldConfidence,
  GarmentIntelligence,
} from "./garment-intelligence.types";

const GARMENT_ANALYSIS_MODEL = "claude-sonnet-4-5-20251001";
const GARMENT_ANALYSIS_TIMEOUT_MS = 15_000;

// ── Extraction prompt ─────────────────────────────────────────────────────────

function buildExtractionPrompt(category: string): string {
  return `Analyze this clothing garment image and extract structured attributes.

Category (user-confirmed): ${category}

Return a single JSON object with this exact structure. Use null for any field you cannot determine reliably from the image. Do not guess.

SUPPRESSION RULES — return null (not a guess) when:
- silhouette/fitProfile/hemLength/topLength: image is severely cropped, flat lay without body reference, or silhouette is genuinely ambiguous
- necklineCoverage: neckline is not visible in the frame
- sleeveLength: sleeves are not visible
- material: lighting or resolution makes texture indeterminate
- shoulderCoverage/midriffExposed: only return boolean if clearly visible; otherwise null
- stylePersonality: null if no single archetype clearly dominates
- Use "n/a" (not null) when a field is categorically inapplicable to this garment type (e.g. hemLength for a top, topLength for a dress)

{
  "observables": {
    "subcategory": string | null,
    "silhouette": ${[...GARMENT_SILHOUETTE_VALUES].join(" | ")} | null,
    "fitProfile": "fitted" | "body-skimming" | "tailored" | "structured" | "relaxed" | "loose" | "oversized" | "flowy" | "n/a" | null,
    "hemLength": "full" | "maxi" | "midi" | "knee" | "mini" | "n/a" | null,
    "topLength": "cropped" | "hip-length" | "longline" | "tunic" | "n/a" | null,
    "waistShape": ${[...GARMENT_WAIST_SHAPE_VALUES].join(" | ")} | null,
    "sleeveLength": "full" | "three-quarter" | "short" | "sleeveless" | "n/a" | null,
    "necklineCoverage": "high" | "crew" | "mock" | "cowl-high" | "v-neck" | "low" | "off-shoulder" | "wrap-variable" | "n/a" | null,
    "shoulderCoverage": boolean | null,
    "midriffExposed": boolean | null,
    "material": ${[...GARMENT_MATERIAL_VALUES].join(" | ")} | null,
    "pattern": ${[...GARMENT_PATTERN_VALUES].join(" | ")} | null,
    "primaryColor": string | null,
    "secondaryColors": string[]
  },
  "matchingSignals": {
    "occasions": [${[...GARMENT_OCCASION_VALUES].map(v => `"${v}"`).join(" | ")}],
    "seasons": [${[...GARMENT_SEASON_VALUES].map(v => `"${v}"`).join(" | ")}],
    "formality": ${[...GARMENT_FORMALITY_VALUES].map(v => `"${v}"`).join(" | ")} | null,
    "styleTags": [],
    "stylePersonality": ${[...GARMENT_STYLE_PERSONALITY_VALUES].map(v => `"${v}"`).join(" | ")} | null
  },
  "fieldConfidence": {}
}

STYLING SIGNAL NOTES:
- styleTags: max 3; choose only from: ${[...GARMENT_STYLE_TAG_VOCAB].join(", ")}. Return empty array rather than forcing weak matches.
- stylePersonality: one of the 5 V3 archetypes above. Return null rather than guessing between two equally plausible archetypes.
- occasions: only include occasions clearly supported by the garment's design and formality. Omit if too versatile to assign specifically.
- necklineCoverage values: "high" = polo/funnel/mock-high; "crew" = crew/round neck; "mock" = mock turtleneck; "cowl-high" = draped cowl at collarbone+; "v-neck" = V neckline any depth; "low" = deep V/plunge; "off-shoulder" = off or cold shoulder; "wrap-variable" = wrap front without guaranteed coverage; "n/a" = bottom/outerwear where neckline is not a coverage factor.
- fieldConfidence: for each field you extracted, rate confidence as "high" (clear, unambiguous), "medium" (probable), or "low" (inferred).

Return only valid JSON. No markdown. No explanation.`;
}

// ── Vocabulary normalization ───────────────────────────────────────────────────
// All normalization functions are exported for unit testing.

function nullIfInvalid<T>(value: unknown, validSet: ReadonlySet<T>): T | null {
  if (value === null || value === undefined) return null;
  return validSet.has(value as T) ? (value as T) : null;
}

function nullIfInvalidStr(value: unknown, validSet: ReadonlySet<string>): string | null {
  return nullIfInvalid(value, validSet);
}

function filterToVocab(values: unknown, validSet: ReadonlySet<string>): string[] {
  if (!Array.isArray(values)) return [];
  return values.filter((v): v is string => typeof v === "string" && validSet.has(v));
}

function normalizeColor(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  return value.trim().toLowerCase();
}

export function normalizeObservables(raw: unknown): GarmentObservables {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  const primaryColor = normalizeColor(r.primaryColor);
  const secondaryRaw = Array.isArray(r.secondaryColors) ? r.secondaryColors : [];
  const secondaryColors = secondaryRaw
    .map(normalizeColor)
    .filter((c): c is string => c !== null)
    .slice(0, 2);

  return {
    subcategory: typeof r.subcategory === "string" && r.subcategory.trim()
      ? r.subcategory.trim().toLowerCase()
      : null,
    silhouette: nullIfInvalid(r.silhouette, GARMENT_SILHOUETTE_VALUES),
    fitProfile: nullIfInvalid(r.fitProfile, FIT_PROFILE_VALUES),
    hemLength: nullIfInvalid(r.hemLength, HEM_LENGTH_VALUES),
    topLength: nullIfInvalid(r.topLength, TOP_LENGTH_VALUES),
    waistShape: nullIfInvalid(r.waistShape, GARMENT_WAIST_SHAPE_VALUES),
    sleeveLength: nullIfInvalid(r.sleeveLength, SLEEVE_LENGTH_VALUES),
    necklineCoverage: nullIfInvalid(r.necklineCoverage, NECKLINE_COVERAGE_VALUES),
    shoulderCoverage: typeof r.shoulderCoverage === "boolean" ? r.shoulderCoverage : null,
    midriffExposed: typeof r.midriffExposed === "boolean" ? r.midriffExposed : null,
    material: nullIfInvalidStr(r.material, GARMENT_MATERIAL_VALUES),
    pattern: nullIfInvalidStr(r.pattern, GARMENT_PATTERN_VALUES),
    primaryColor,
    secondaryColors,
  };
}

export function normalizeMatchingSignals(raw: unknown): GarmentMatchingSignals {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    occasions: filterToVocab(r.occasions, GARMENT_OCCASION_VALUES),
    seasons: filterToVocab(r.seasons, GARMENT_SEASON_VALUES),
    formality: nullIfInvalidStr(r.formality, GARMENT_FORMALITY_VALUES),
    styleTags: filterToVocab(r.styleTags, GARMENT_STYLE_TAG_VOCAB).slice(0, 3),
    stylePersonality: nullIfInvalidStr(r.stylePersonality, GARMENT_STYLE_PERSONALITY_VALUES),
  };
}

function normalizeFieldConfidence(raw: unknown): GarmentFieldConfidence {
  if (!raw || typeof raw !== "object") return {};
  const result: GarmentFieldConfidence = {};
  const valid = new Set(["high", "medium", "low"]);
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof val === "string" && valid.has(val)) {
      (result as Record<string, string>)[key] = val;
    }
  }
  return result;
}

// ── Claude extraction ─────────────────────────────────────────────────────────

type ImageAnalyzerFn = (params: {
  imageUrl: string;
  prompt: string;
  model: string;
  signal?: AbortSignal;
}) => Promise<string>;

export async function extractGarmentIntelligence(
  imageUrl: string,
  category: string,
  imageAnalyzer: ImageAnalyzerFn = analyzeImage,
): Promise<GarmentExtractionResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GARMENT_ANALYSIS_TIMEOUT_MS);

  let raw: unknown;
  try {
    const text = await imageAnalyzer({
      imageUrl,
      prompt: buildExtractionPrompt(category),
      model: GARMENT_ANALYSIS_MODEL,
      signal: controller.signal,
    });

    // Strip markdown fences if present
    const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    raw = JSON.parse(cleaned);
  } finally {
    clearTimeout(timer);
  }

  const parsed = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    observables: normalizeObservables(parsed.observables),
    matchingSignals: normalizeMatchingSignals(parsed.matchingSignals),
    fieldConfidence: normalizeFieldConfidence(parsed.fieldConfidence),
  };
}

// ── Persistence helpers ───────────────────────────────────────────────────────

type PrismaUpdateFn = (closetItemId: string, data: Record<string, unknown>) => Promise<void>;

interface UserSupplied {
  primaryColor: string | null;
  pattern: string | null;
  occasions: string[];
  seasons: string[];
}

async function persistExtraction(
  closetItemId: string,
  result: GarmentExtractionResult,
  prismaUpdate: PrismaUpdateFn,
  user: UserSupplied,
): Promise<void> {
  const { observables: obs, matchingSignals: sig, fieldConfidence } = result;

  // User-verified fields are never overwritten by AI inference.
  // Rule: USER-VERIFIED > TRUSTED CANONICAL > AI OBSERVATION > UNKNOWN
  const shouldWriteColors  = !user.primaryColor && obs.primaryColor !== null;
  const shouldWritePattern = !user.pattern;
  const shouldWriteOccasions = user.occasions.length === 0;
  const shouldWriteSeasons   = user.seasons.length === 0;

  const aiColors: string[] = [];
  if (obs.primaryColor) aiColors.push(obs.primaryColor);
  aiColors.push(...obs.secondaryColors);

  await prismaUpdate(closetItemId, {
    analysisStatus: "ready",
    analyzedAt: new Date(),
    analysisSchemaVersion: GARMENT_INTELLIGENCE_SCHEMA_VERSION,

    // Tier 2 — observable attributes
    subcategory:       obs.subcategory,       // no user input for this field
    silhouette:        obs.silhouette,
    fitProfile:        obs.fitProfile,
    hemLength:         obs.hemLength,
    topLength:         obs.topLength,
    waistShape:        obs.waistShape,
    sleeveLength:      obs.sleeveLength,
    necklineCoverage:  obs.necklineCoverage,
    shoulderCoverage:  obs.shoulderCoverage,
    midriffExposed:    obs.midriffExposed,
    material:          obs.material,          // no user input for this field
    ...(shouldWritePattern ? { pattern: obs.pattern } : {}),
    ...(shouldWriteColors && aiColors.length > 0 ? { colors: aiColors, primaryColor: obs.primaryColor } : {}),

    // Tier 3 — matching signals
    ...(shouldWriteOccasions ? { occasions: sig.occasions } : {}),
    ...(shouldWriteSeasons   ? { seasons: sig.seasons }    : {}),
    styleTags:         sig.styleTags,         // no user input for this field
    formality:         sig.formality,
    stylePersonality:  sig.stylePersonality,

    fieldConfidence:   fieldConfidence,
  });
}

async function persistFailure(
  closetItemId: string,
  prismaUpdate: PrismaUpdateFn,
): Promise<void> {
  await prismaUpdate(closetItemId, {
    analysisStatus: "failed",
    analyzedAt: new Date(),
    analysisSchemaVersion: GARMENT_INTELLIGENCE_SCHEMA_VERSION,
    // All user-supplied and previously stored fields are deliberately left unchanged.
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface AnalyzeClosetGarmentParams {
  closetItemId: string;
  imagePublicId: string;
  category: string;
  /** User-provided primaryColor from the upload form. When set, AI color extraction
   *  is skipped so the user's explicit choice is never silently overwritten. */
  userPrimaryColor?: string | null;
  /** User-provided pattern from the upload form. When set, AI pattern is not written. */
  userPattern?: string | null;
  /** User-provided occasions from the upload form. When non-empty, AI occasions are not written. */
  userOccasions?: string[];
  /** User-provided seasons from the upload form. When non-empty, AI seasons are not written. */
  userSeasons?: string[];
}

// Exported for testing only — accepts injected dependencies.
export async function runClosetGarmentAnalysis(
  params: AnalyzeClosetGarmentParams,
  deps: {
    imageAnalyzer: ImageAnalyzerFn;
    prismaUpdate: PrismaUpdateFn;
    getSignedUrl: (publicId: string) => string;
  },
): Promise<void> {
  const { closetItemId, imagePublicId, category } = params;
  const { imageAnalyzer, prismaUpdate, getSignedUrl } = deps;

  const user: UserSupplied = {
    primaryColor: params.userPrimaryColor ?? null,
    pattern:      params.userPattern ?? null,
    occasions:    params.userOccasions ?? [],
    seasons:      params.userSeasons ?? [],
  };

  let imageUrl: string;
  try {
    imageUrl = getSignedUrl(imagePublicId);
  } catch {
    await persistFailure(closetItemId, prismaUpdate).catch(() => {});
    return;
  }

  try {
    const result = await extractGarmentIntelligence(imageUrl, category, imageAnalyzer);
    await persistExtraction(closetItemId, result, prismaUpdate, user);
  } catch {
    await persistFailure(closetItemId, prismaUpdate).catch(() => {});
  }
}

// Main export — called from the upload action (awaited inline, not fire-and-forget).
// The internal AbortController timeout bounds execution to GARMENT_ANALYSIS_TIMEOUT_MS.
export async function analyzeClosetGarment(
  params: AnalyzeClosetGarmentParams,
): Promise<void> {
  const cloudinaryConfig = {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME ?? "",
    apiKey: process.env.CLOUDINARY_API_KEY ?? "",
    apiSecret: process.env.CLOUDINARY_API_SECRET ?? "",
  };

  const defaultPrismaUpdate: PrismaUpdateFn = (id, data) =>
    prisma.closetItem.update({ where: { id }, data }).then(() => {});

  return runClosetGarmentAnalysis(params, {
    imageAnalyzer: analyzeImage,
    prismaUpdate: defaultPrismaUpdate,
    getSignedUrl: (publicId) => buildSignedDeliveryUrl(cloudinaryConfig, publicId, null),
  });
}

// ── Re-export deriveEvidenceLevel for consumers ───────────────────────────────

export { deriveEvidenceLevel };
export type { GarmentIntelligence };
