// nAia Admin — Closet Intelligence review utilities.
//
// Provides:
//   validateOverrides(raw)      — strict server-side validation of admin override JSON
//   computeReviewStatus(ov)     — derive "reviewed" | "overridden" from override key count
//   getEffectiveClosetItem(...) — runtime value resolver (admin > current item value)
//
// Key design decisions:
//   - Override key PRESENCE (not value truthiness) determines whether override is active.
//   - [] is a valid intentional override (clears AI value for an array field).
//   - null is a valid intentional override for nullable scalar fields.
//   - Vocabulary validation reuses the exact canonical sets from garment-intelligence.types.ts.
//   - No ClosetItem fields are mutated — the original record is never destructively overwritten.

import {
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
} from "../ai/garment-intelligence.types";

// ── Status constants ──────────────────────────────────────────────────────────

export const CLOSET_REVIEW_STATUSES = ["unreviewed", "reviewed", "overridden"] as const;
export type ClosetAdminReviewStatus = (typeof CLOSET_REVIEW_STATUSES)[number];

/** Derives the review status from the overrides object.
 *  "unreviewed" is only the initial default on the model; after the first
 *  admin save the status is always "reviewed" or "overridden".
 *  Removing all override keys returns the item to "reviewed". */
export function computeReviewStatus(overrides: ClosetItemOverrides | null | undefined): "reviewed" | "overridden" {
  if (!overrides) return "reviewed";
  return Object.keys(overrides).length > 0 ? "overridden" : "reviewed";
}

// ── Override type ─────────────────────────────────────────────────────────────

// All fields are optional — only explicitly overridden fields appear in this object.
// Key presence = override active; key absence = fall through to current item value.
export type ClosetItemOverrides = Partial<{
  subcategory:      string | null;
  silhouette:       string | null;
  fitProfile:       string | null;
  hemLength:        string | null;
  topLength:        string | null;
  waistShape:       string | null;
  sleeveLength:     string | null;
  necklineCoverage: string | null;
  shoulderCoverage: boolean | null;
  midriffExposed:   boolean | null;
  material:         string | null;
  pattern:          string | null;
  primaryColor:     string | null;
  colors:           string[];
  occasions:        string[];
  seasons:          string[];
  formality:        string | null;
  styleTags:        string[];
  stylePersonality: string | null;
}>;

// ── Allowlisted keys ──────────────────────────────────────────────────────────

const ALLOWED_OVERRIDE_KEYS = new Set<string>([
  "subcategory", "silhouette", "fitProfile", "hemLength", "topLength",
  "waistShape", "sleeveLength", "necklineCoverage", "shoulderCoverage",
  "midriffExposed", "material", "pattern", "primaryColor", "colors",
  "occasions", "seasons", "formality", "styleTags", "stylePersonality",
]);

// Prototype-pollution guard — these keys must never be treated as field names.
const BLOCKED_KEYS = new Set<string>(["__proto__", "constructor", "prototype"]);

// ── Per-field validators ──────────────────────────────────────────────────────

function validateVocabString(
  key: string,
  value: unknown,
  vocab: ReadonlySet<string>,
): string | null {
  if (value === null) return null;
  if (typeof value !== "string") throw new Error(`Override "${key}" must be a string or null`);
  if (!vocab.has(value)) {
    throw new Error(`Override "${key}": "${value}" is not a valid vocabulary token`);
  }
  return value;
}

function validateStringOrNull(key: string, value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") throw new Error(`Override "${key}" must be a string or null`);
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) throw new Error(`Override "${key}" must not be an empty string (use null to clear)`);
  return trimmed;
}

function validateBooleanOrNull(key: string, value: unknown): boolean | null {
  if (value === null) return null;
  if (typeof value !== "boolean") throw new Error(`Override "${key}" must be a boolean or null`);
  return value;
}

function validateStringArray(
  key: string,
  value: unknown,
  vocab: ReadonlySet<string>,
  maxLength?: number,
): string[] {
  if (!Array.isArray(value)) throw new Error(`Override "${key}" must be an array`);
  for (const item of value) {
    if (typeof item !== "string") throw new Error(`Override "${key}": all items must be strings`);
    if (!vocab.has(item)) {
      throw new Error(`Override "${key}": "${item}" is not a valid vocabulary token`);
    }
  }
  if (maxLength !== undefined && value.length > maxLength) {
    throw new Error(`Override "${key}" must have at most ${maxLength} items`);
  }
  return value as string[];
}

function validateColorArray(key: string, value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error(`Override "${key}" must be an array`);
  return value.map((item, i) => {
    if (typeof item !== "string" || !item.trim()) {
      throw new Error(`Override "${key}[${i}]" must be a non-empty string`);
    }
    return item.trim().toLowerCase();
  });
}

// ── Public validator ──────────────────────────────────────────────────────────

/** Validates raw JSON input from an admin override request.
 *  Returns a typed ClosetItemOverrides object if valid.
 *  Throws a descriptive Error if any key or value is invalid.
 *  Never silently strips input — validation failure is explicit. */
export function validateOverrides(raw: unknown): ClosetItemOverrides {
  if (raw === null || raw === undefined) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Overrides must be a plain object");
  }

  const input = raw as Record<string, unknown>;
  const result: ClosetItemOverrides = {};

  for (const key of Object.keys(input)) {
    // Prototype pollution guard
    if (BLOCKED_KEYS.has(key) || !Object.prototype.hasOwnProperty.call(input, key)) {
      throw new Error(`Override key "${key}" is not permitted`);
    }

    // Unknown key guard
    if (!ALLOWED_OVERRIDE_KEYS.has(key)) {
      throw new Error(`Unknown override key: "${key}"`);
    }

    const value = input[key];

    switch (key) {
      case "subcategory":
        result.subcategory = validateStringOrNull(key, value);
        break;
      case "silhouette":
        result.silhouette = validateVocabString(key, value, GARMENT_SILHOUETTE_VALUES);
        break;
      case "fitProfile":
        result.fitProfile = validateVocabString(key, value, FIT_PROFILE_VALUES);
        break;
      case "hemLength":
        result.hemLength = validateVocabString(key, value, HEM_LENGTH_VALUES);
        break;
      case "topLength":
        result.topLength = validateVocabString(key, value, TOP_LENGTH_VALUES);
        break;
      case "waistShape":
        result.waistShape = validateVocabString(key, value, GARMENT_WAIST_SHAPE_VALUES);
        break;
      case "sleeveLength":
        result.sleeveLength = validateVocabString(key, value, SLEEVE_LENGTH_VALUES);
        break;
      case "necklineCoverage":
        result.necklineCoverage = validateVocabString(key, value, NECKLINE_COVERAGE_VALUES);
        break;
      case "shoulderCoverage":
        result.shoulderCoverage = validateBooleanOrNull(key, value);
        break;
      case "midriffExposed":
        result.midriffExposed = validateBooleanOrNull(key, value);
        break;
      case "material":
        result.material = validateVocabString(key, value, GARMENT_MATERIAL_VALUES);
        break;
      case "pattern":
        result.pattern = validateVocabString(key, value, GARMENT_PATTERN_VALUES);
        break;
      case "primaryColor":
        result.primaryColor = validateStringOrNull(key, value);
        break;
      case "colors":
        result.colors = validateColorArray(key, value);
        break;
      case "occasions":
        result.occasions = validateStringArray(key, value, GARMENT_OCCASION_VALUES);
        break;
      case "seasons":
        result.seasons = validateStringArray(key, value, GARMENT_SEASON_VALUES);
        break;
      case "formality":
        result.formality = validateVocabString(key, value, GARMENT_FORMALITY_VALUES);
        break;
      case "styleTags":
        result.styleTags = validateStringArray(key, value, GARMENT_STYLE_TAG_VOCAB, 3);
        break;
      case "stylePersonality":
        result.stylePersonality = validateVocabString(key, value, GARMENT_STYLE_PERSONALITY_VALUES);
        break;
    }
  }

  return result;
}

// ── Effective value resolver ──────────────────────────────────────────────────

// Minimal subset of ClosetItem fields used by the resolver.
// Matches the Prisma-generated shape for the fields getEffectiveClosetItem touches.
export interface ClosetItemFields {
  subcategory:      string | null;
  silhouette:       string | null;
  fitProfile:       string | null;
  hemLength:        string | null;
  topLength:        string | null;
  waistShape:       string | null;
  sleeveLength:     string | null;
  necklineCoverage: string | null;
  shoulderCoverage: boolean | null;
  midriffExposed:   boolean | null;
  material:         string | null;
  pattern:          string | null;
  primaryColor:     string | null;
  colors:           string[];
  occasions:        string[];
  seasons:          string[];
  formality:        string | null;
  styleTags:        string[];
  stylePersonality: string | null;
}

export interface AdminReviewFields {
  reviewStatus: string;
  overrides: unknown;
}

/** Returns a new object with admin overrides merged over the current item values.
 *  KEY PRESENCE in overrides determines whether override is active — not truthiness or .length.
 *  The original item object is never mutated.
 *  When review is null/undefined, returns a shallow copy of item unchanged. */
export function getEffectiveClosetItem<T extends ClosetItemFields>(
  item: T,
  review: AdminReviewFields | null | undefined,
): T {
  if (!review?.overrides) return { ...item };

  const ov = review.overrides as Record<string, unknown>;
  const result = { ...item };

  function applyField<K extends keyof ClosetItemFields>(field: K): void {
    if (Object.prototype.hasOwnProperty.call(ov, field)) {
      (result as Record<string, unknown>)[field as string] = ov[field as string];
    }
  }

  applyField("subcategory");
  applyField("silhouette");
  applyField("fitProfile");
  applyField("hemLength");
  applyField("topLength");
  applyField("waistShape");
  applyField("sleeveLength");
  applyField("necklineCoverage");
  applyField("shoulderCoverage");
  applyField("midriffExposed");
  applyField("material");
  applyField("pattern");
  applyField("primaryColor");
  applyField("colors");
  applyField("occasions");
  applyField("seasons");
  applyField("formality");
  applyField("styleTags");
  applyField("stylePersonality");

  return result;
}
