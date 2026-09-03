// app/lib/ai/closet-preview-analysis.server.ts
// Pre-submission garment analysis for the Closet upload flow.
//
// Runs between Cloudinary upload and the customer seeing the confirmation UI.
// Returns only the user-visible subset of garment intelligence so the
// customer can confirm rather than fill in. Distinct from analyzeClosetGarment
// (which runs post-save to populate the full Tier 2/3 intelligence fields).
//
// Security: callers must validate publicId ownership and asset existence
// before calling previewAnalyzeGarment. This module only builds signed URLs
// and calls Claude — it performs no auth or ownership checks.

import { analyzeImage } from "./claude.server.js";
import {
  GARMENT_PATTERN_VALUES,
  GARMENT_OCCASION_VALUES,
  GARMENT_SEASON_VALUES,
} from "./garment-intelligence.types";

const PREVIEW_MODEL = "claude-sonnet-4-5-20251001";
const PREVIEW_TIMEOUT_MS = 20_000;

const CLOSET_CATEGORIES = new Set([
  "TOPS", "BOTTOMS", "DRESSES", "OUTERWEAR", "SHOES", "BAGS",
  "ACCESSORIES", "JEWELRY", "ACTIVEWEAR", "SWIMWEAR", "LOUNGEWEAR", "OTHER",
]);

export interface GarmentPreview {
  name: string | null;
  category: string | null;
  subcategory: string | null;
  primaryColor: string | null;
  pattern: string | null;
  occasions: string[];
  seasons: string[];
  structureHint: string | null;
  summaryLine: string;
}

function buildPreviewPrompt(): string {
  const patternValues = [...GARMENT_PATTERN_VALUES].join(" | ");
  const occasionValues = [...GARMENT_OCCASION_VALUES].map(v => `"${v}"`).join(" | ");
  const seasonValues = [...GARMENT_SEASON_VALUES].map(v => `"${v}"`).join(" | ");

  return `Analyze this garment photo and return a JSON object describing what you see.

Return ONLY valid JSON — no markdown, no explanation.

{
  "name": "concise human-friendly name including color, e.g. Black Tailored Blazer, Ivory Silk Blouse, Wide-Leg Linen Trousers" (string | null),
  "category": "TOPS | BOTTOMS | DRESSES | OUTERWEAR | SHOES | BAGS | ACCESSORIES | JEWELRY | ACTIVEWEAR | SWIMWEAR | LOUNGEWEAR | OTHER" (string | null),
  "subcategory": "finer type, e.g. blazer, t-shirt, midi dress, trench coat, ankle boot, crossbody bag" (string | null),
  "primaryColor": "dominant color in plain language, e.g. Black, Ivory, Olive Green, Burgundy, Camel" (string | null),
  "pattern": "${patternValues}" (string | null),
  "occasions": [${occasionValues}] — include 1-3 that clearly apply (array),
  "seasons": [${seasonValues}] — include those that clearly apply (array),
  "structureHint": "one word describing construction: tailored | structured | relaxed | flowy | casual | fitted | oversized" (string | null)
}

Rules:
- name: short, specific. Lead with color when visible. Prefer common fashion terms (blazer, trousers, midi dress) over generic ones (jacket, pants, dress).
- category: best single match. OUTERWEAR = jackets, coats, blazers. TOPS = shirts, blouses, sweaters, tees. DRESSES includes jumpsuits. SHOES for all footwear. Use OTHER only if truly unclassifiable.
- subcategory: one word or short phrase (no brand names, no size info).
- primaryColor: natural English color name. Avoid hex codes or technical terms.
- Return null for any field you cannot determine reliably from the image. Do not guess.`;
}

function normalizeCategory(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const upper = raw.trim().toUpperCase();
  return CLOSET_CATEGORIES.has(upper) ? upper : null;
}

function normalizePattern(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const lower = raw.trim().toLowerCase() as Parameters<typeof GARMENT_PATTERN_VALUES.has>[0];
  return GARMENT_PATTERN_VALUES.has(lower) ? lower : null;
}

function normalizeStringArray(raw: unknown, vocab: ReadonlySet<string>): string[] {
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[]).filter(
    (v): v is string => typeof v === "string" && vocab.has(v),
  );
}

function normalizeNullableString(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  return raw.trim();
}

const VALID_STRUCTURE_HINTS = new Set([
  "tailored", "structured", "relaxed", "flowy", "casual", "fitted", "oversized",
]);

function normalizeStructureHint(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const lower = raw.trim().toLowerCase();
  return VALID_STRUCTURE_HINTS.has(lower) ? lower : null;
}

// downloadUrl must be an authenticated server-side download URL (buildPrivateDownloadUrl),
// NOT a CDN URL (res.cloudinary.com/…/private/…). Private Cloudinary assets are not
// accessible via CDN delivery — Claude's API servers cannot fetch them that way.
// The endpoint builds downloadUrl at step 5 and passes it through L2, L3, and here.
export async function previewAnalyzeGarment(
  downloadUrl: string,
): Promise<GarmentPreview | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PREVIEW_TIMEOUT_MS);

  try {
    const text = await analyzeImage({
      imageUrl: downloadUrl,
      prompt: buildPreviewPrompt(),
      model: PREVIEW_MODEL,
      signal: controller.signal,
    });

    const cleaned = text.trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();

    const raw = JSON.parse(cleaned) as Record<string, unknown>;

    const name = normalizeNullableString(raw.name);
    const category = normalizeCategory(raw.category);
    const subcategory = normalizeNullableString(raw.subcategory);
    const primaryColor = normalizeNullableString(raw.primaryColor);
    const pattern = normalizePattern(raw.pattern);
    const occasions = normalizeStringArray(raw.occasions, GARMENT_OCCASION_VALUES);
    const seasons = normalizeStringArray(raw.seasons, GARMENT_SEASON_VALUES);
    const structureHint = normalizeStructureHint(raw.structureHint);

    // Build the summary line: Color · Subcategory · Structure
    const summaryParts = [primaryColor, subcategory, structureHint].filter(Boolean);
    const summaryLine = summaryParts.join(" · ");

    return { name, category, subcategory, primaryColor, pattern, occasions, seasons, structureHint, summaryLine };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
