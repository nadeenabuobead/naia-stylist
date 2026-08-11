// app/lib/image-suitability.server.ts
// Layer 3 — Feature-specific image suitability screening.
//
// Runs AFTER Layer 2 (global safety moderation) passes.
// Garment (BOS / Digital Closet): checks if a fashion item is usable for analysis.
// VTO body photo: checks if the photo is suitable for virtual try-on.
//
// Fail-closed contract:
//   - Timeout, parse error → RETRY_IMAGE with subCode "assessment_failed"
//   - Never fail-open to PASS when the response is unreadable

import { analyzeImage } from "./ai/claude.server.js";

// ── Public types ──────────────────────────────────────────────────────────────

export type GarmentSubCode =
  | "no_garment_visible"
  | "image_too_blurry"
  | "garment_excessively_cropped"
  | "multiple_items_ambiguous"
  | "color_indeterminate"
  | "category_mismatch"
  | "item_not_identifiable"
  | "assessment_failed";

export type VtoSubCode =
  | "no_person"
  | "multiple_people"
  | "body_area_not_visible"
  | "image_too_blurry"
  | "unusable_pose"
  | "assessment_failed";

export type GarmentSuitabilityResult =
  | { status: "PASS" }
  | { status: "RETRY_IMAGE"; subCode: GarmentSubCode }
  | { status: "NEEDS_CLARIFICATION"; subCode: GarmentSubCode };

export type VtoSuitabilityResult =
  | { status: "PASS" }
  | { status: "RETRY_IMAGE"; subCode: VtoSubCode };

// Injectable analyzer type.
export type AnalyzeForSuitabilityFn = (args: { imageUrl: string; prompt: string }) => Promise<string>;

// ── Constants ─────────────────────────────────────────────────────────────────

const SUITABILITY_TIMEOUT_MS = 12_000;

const VALID_GARMENT_STATUSES = new Set(["PASS", "RETRY_IMAGE", "NEEDS_CLARIFICATION"]);

const VALID_GARMENT_SUB_CODES = new Set<string>([
  "no_garment_visible",
  "image_too_blurry",
  "garment_excessively_cropped",
  "multiple_items_ambiguous",
  "color_indeterminate",
  "category_mismatch",
  "item_not_identifiable",
]);

const VALID_VTO_SUB_CODES = new Set<string>([
  "no_person",
  "multiple_people",
  "body_area_not_visible",
  "image_too_blurry",
  "unusable_pose",
]);

// ── Prompts ───────────────────────────────────────────────────────────────────

function buildGarmentPrompt(declaredCategory?: string): string {
  const categoryLine = declaredCategory
    ? `\nThe user indicated this item is a: ${declaredCategory}.`
    : "";
  return `\
You are a fashion image quality assessor for a personal styling app.${categoryLine}

A garment may be presented in any of these valid contexts: isolated on a plain or styled background, worn by a person, displayed on a mannequin, or photographed as a flat-lay. All presentation styles are acceptable — evaluate the garment itself, not how it is presented.

Evaluate this image on these criteria:
1. Is this a wearable fashion item (clothing, shoes, a bag, an accessory, or jewellery) — not a raw material or swatch? Fabric swatches, textile samples, loose fabric, fabric on a bolt, yarn, thread, and other non-wearable material samples are NOT wearable fashion items and must not pass this check.
2. Is the item reasonably sharp and in focus — not excessively blurry?
3. Is substantially the FULL GARMENT visible — enough to understand its silhouette, cut, overall shape, and major design details? Being able to identify the category or colour from a fragment is NOT sufficient. The following are examples that must fail this criterion even if the item type or colour is recognisable: only a neckline or collar; only a shoulder area; only a sleeve fragment; only a waistband strip; only a hem; only a small portion of a garment visible in a selfie or close-up. A garment worn by a person or displayed on a mannequin passes this criterion when substantially the full garment — from approximately the top to the bottom of the item — is visible in the frame.
4. If multiple distinct fashion items appear — is one item clearly the intended primary item, or is the intent ambiguous?
5. If a category was declared, does the visible item broadly match it?
6. Can a reasonable colour description be determined from the image?

Respond ONLY with this JSON object — no other text, no markdown, no code fences:
{
  "status": "PASS" or "RETRY_IMAGE" or "NEEDS_CLARIFICATION",
  "subCode": null or one of: "no_garment_visible", "image_too_blurry", "garment_excessively_cropped", "multiple_items_ambiguous", "color_indeterminate", "category_mismatch", "item_not_identifiable"
}

PASS: the image shows a wearable fashion item, substantially complete (full silhouette and cut visible), sharp enough for analysis, and the category broadly matches (or was not declared). Set subCode to null.
RETRY_IMAGE: image is not usable — user should upload a different photo. Set subCode to the most applicable code.
NEEDS_CLARIFICATION: image has a usable garment but something is unclear that the user can resolve (colour unreadable, declared category seems wrong, item type unclear). Set subCode to the most applicable code.

subCode guidance:
- no_garment_visible: use ONLY when there is genuinely no wearable fashion item anywhere in the image (e.g. a landscape, a face with no clothing visible, or a completely unrelated object). Do NOT use this code merely because the garment is worn by a person or displayed on a mannequin — those are valid garment photos.
- item_not_identifiable: use when the image contains something that is NOT a wearable fashion item — including fabric swatches, textile samples, loose or raw fabric, fabric on a bolt, yarn, thread, or other non-wearable material. Being identifiable as a textile or fabric material does NOT make something a wearable fashion item. Also use for images where something is present but its type as a fashion item cannot be determined. Do NOT use for legitimate fashion items such as hats, scarves, jewellery, or bags merely because they are not eligible for virtual try-on — those are valid items even if VTO-unsupported.
- image_too_blurry: the item exists but is too out of focus to assess.
- garment_excessively_cropped: the garment exists and is identifiable, but substantially the full garment is not visible — only a fragment is shown. Examples: only the collar/neckline, only a shoulder area, only a sleeve, only a waistband, only a hem edge, or a small portion of a garment visible in a selfie. Use this code whenever the silhouette, cut, and overall shape cannot be assessed due to cropping or framing, even if the category and colour can be guessed from the fragment.
- multiple_items_ambiguous: multiple distinct items with no clear primary subject.
- color_indeterminate: item is visible but colour cannot be determined (lighting, filter, or monochrome).
- category_mismatch: item is visible but clearly does not match the declared category.

If status is PASS, subCode must be null.`;
}

const VTO_BODY_PROMPT = `\
You are assessing whether a photo is suitable for a virtual clothing try-on.

Evaluate the image on these criteria:
1. Is exactly one person the primary subject of the image?
2. Does the image show the full body (approximately head to ankle level)?
3. Is the image reasonably sharp and in focus?
4. Is the framing and pose usable? (Front-facing or lightly angled; arms not fully blocking the torso area where clothes would sit.)

Respond ONLY with this JSON object — no other text, no markdown, no code fences:
{
  "status": "PASS" or "RETRY_IMAGE",
  "subCode": null or one of: "no_person", "multiple_people", "body_area_not_visible", "image_too_blurry", "unusable_pose"
}

PASS: single person, full body visible from approximately head to ankle, usable pose, clear image. Set subCode to null.
RETRY_IMAGE: image is not suitable for virtual try-on. Set subCode to the most applicable code.

If status is PASS, subCode must be null.`;

// ── Garment suitability ───────────────────────────────────────────────────────

export async function screenGarmentSuitability(
  imageUrl: string,
  context: { declaredCategory?: string } = {},
  _analyze: AnalyzeForSuitabilityFn = analyzeImage,
): Promise<GarmentSuitabilityResult> {
  const prompt = buildGarmentPrompt(context.declaredCategory);

  const timeout = new Promise<null>((resolve) =>
    setTimeout(() => resolve(null), SUITABILITY_TIMEOUT_MS),
  );

  let raw: string | null;
  try {
    const result = await Promise.race([
      _analyze({ imageUrl, prompt }),
      timeout,
    ]);
    raw = result;
  } catch {
    return { status: "RETRY_IMAGE", subCode: "assessment_failed" };
  }

  if (raw === null) return { status: "RETRY_IMAGE", subCode: "assessment_failed" };

  try {
    const cleaned = raw
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
    const parsed: unknown = JSON.parse(cleaned);

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { status: "RETRY_IMAGE", subCode: "assessment_failed" };
    }

    const obj = parsed as Record<string, unknown>;

    if (typeof obj.status !== "string" || !VALID_GARMENT_STATUSES.has(obj.status)) {
      return { status: "RETRY_IMAGE", subCode: "assessment_failed" };
    }

    if (obj.status === "PASS") return { status: "PASS" };

    const subCode: GarmentSubCode =
      typeof obj.subCode === "string" && VALID_GARMENT_SUB_CODES.has(obj.subCode)
        ? (obj.subCode as GarmentSubCode)
        : "assessment_failed";

    return {
      status: obj.status as "RETRY_IMAGE" | "NEEDS_CLARIFICATION",
      subCode,
    };
  } catch {
    return { status: "RETRY_IMAGE", subCode: "assessment_failed" };
  }
}

// ── VTO body photo suitability ────────────────────────────────────────────────

export async function screenVtoBodyPhoto(
  imageUrl: string,
  _analyze: AnalyzeForSuitabilityFn = analyzeImage,
): Promise<VtoSuitabilityResult> {
  const timeout = new Promise<null>((resolve) =>
    setTimeout(() => resolve(null), SUITABILITY_TIMEOUT_MS),
  );

  let raw: string | null;
  try {
    const result = await Promise.race([
      _analyze({ imageUrl, prompt: VTO_BODY_PROMPT }),
      timeout,
    ]);
    raw = result;
  } catch {
    return { status: "RETRY_IMAGE", subCode: "assessment_failed" };
  }

  if (raw === null) return { status: "RETRY_IMAGE", subCode: "assessment_failed" };

  try {
    const cleaned = raw
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
    const parsed: unknown = JSON.parse(cleaned);

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { status: "RETRY_IMAGE", subCode: "assessment_failed" };
    }

    const obj = parsed as Record<string, unknown>;

    if (obj.status === "PASS") return { status: "PASS" };

    const subCode: VtoSubCode =
      typeof obj.subCode === "string" && VALID_VTO_SUB_CODES.has(obj.subCode)
        ? (obj.subCode as VtoSubCode)
        : "assessment_failed";

    return { status: "RETRY_IMAGE", subCode };
  } catch {
    return { status: "RETRY_IMAGE", subCode: "assessment_failed" };
  }
}
