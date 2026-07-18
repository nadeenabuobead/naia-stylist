// app/lib/ai/closet-eligibility.ts
//
// Phase 4A6 — Closet image eligibility for virtual try-on.
//
// Stage A (this file): synchronous, deterministic metadata precheck.
//   Inputs: user-selected category + Cloudinary metadata (width, height, format, bytes).
//   Outputs: "pending-assessment" | "needs-clearer-photo" | "not-supported"
//   An item MUST NOT reach "ready-for-try-on" from metadata alone.
//
// Stage B (closet-eligibility.server.ts): async visual-content assessment via Claude vision.
//   Inputs: Cloudinary image URL + category from Stage A result.
//   Outputs: "ready-for-try-on" | "needs-clearer-photo" | "not-supported"

// ── Category ──────────────────────────────────────────────────────────────────

export type ClosetItemCategory =
  | "tops"
  | "bottoms"
  | "dresses"
  | "outerwear"
  | "shoes"
  | "bags"
  | "unsupported"; // jewelry, hats, underwear, swimwear, activewear, other, unknown

// Prisma ClosetCategory enum values → ClosetItemCategory
export const PRISMA_CATEGORY_MAP: Record<string, ClosetItemCategory> = {
  TOPS:       "tops",
  BOTTOMS:    "bottoms",
  DRESSES:    "dresses",
  OUTERWEAR:  "outerwear",
  SHOES:      "shoes",
  BAGS:       "bags",
  ACCESSORIES:"unsupported",
  JEWELRY:    "unsupported",
  ACTIVEWEAR: "unsupported",
  SWIMWEAR:   "unsupported",
  LOUNGEWEAR: "unsupported",
  OTHER:      "unsupported",
};

// Supported categories for virtual try-on (clothing + shoes + bags)
const SUPPORTED_CATEGORIES = new Set<ClosetItemCategory>([
  "tops", "bottoms", "dresses", "outerwear", "shoes", "bags",
]);

// ── Eligibility ───────────────────────────────────────────────────────────────

export type ClosetTryOnEligibility =
  | "ready-for-try-on"    // passed Stage A + Stage B visual assessment
  | "needs-clearer-photo" // photo quality issue detected
  | "not-supported"       // unsupported category or format
  | "pending-assessment"; // Stage A passed; awaiting Stage B visual assessment

// Internal photo issue codes (Stage A) — never surfaced verbatim to customers
export type ClosetPhotoIssue =
  | "low-resolution"       // width or height below minimum threshold
  | "tiny-file"            // file size suspiciously small
  | "unusual-aspect-ratio" // aspect ratio too extreme for a fashion photo
  | "unsupported-format";  // image format not accepted by try-on pipeline

// Visual issue codes (Stage B) — set in closet-eligibility.server.ts
export type ClosetVisualIssue =
  | "blurry"
  | "obstructed"
  | "cropped-item"
  | "multiple-items"
  | "category-mismatch"
  | "not-fashion-item"
  | "visual-assessment-failed";

// ── Assessment input ──────────────────────────────────────────────────────────

export interface AssessClosetEligibilityInput {
  // User-selected Prisma ClosetCategory enum value (e.g. "TOPS", "SHOES")
  prismaCategory: string;
  // Pixel dimensions from Cloudinary response
  width?: number;
  height?: number;
  // Format string from Cloudinary (e.g. "jpg", "png", "webp")
  format?: string;
  // Raw file size in bytes from Cloudinary
  bytes?: number;
}

// ── Assessment results ────────────────────────────────────────────────────────

// Stage A result
export interface ClosetEligibilityResult {
  eligible: ClosetTryOnEligibility;
  category: ClosetItemCategory;
  photoIssues: ClosetPhotoIssue[]; // populated on "needs-clearer-photo"; empty otherwise
  internalNote: string;
  customerHint: string | null; // shown to customer; null when no retake guidance is needed
  assessedAt: string; // ISO 8601
}

// Stage B result (returned by assessClosetEligibilityStageB in .server.ts)
export interface ClosetStageBResult {
  eligible: "ready-for-try-on" | "needs-clearer-photo" | "not-supported";
  visualIssues: ClosetVisualIssue[];
  internalNote: string;
  customerHint: string | null; // specific retake guidance from visual assessment
  assessedAt: string; // ISO 8601
}

// ── Customer-facing UI strings ────────────────────────────────────────────────

export const CLOSET_ELIGIBILITY_DISPLAY: Record<ClosetTryOnEligibility, {
  label: string;
  fallbackHint: string | null; // used when no specific customerHint is stored
}> = {
  "ready-for-try-on": {
    label: "Ready for virtual try-on",
    fallbackHint: null,
  },
  "needs-clearer-photo": {
    label: "A clearer photo is needed",
    fallbackHint: "Photograph the item alone on a plain background, well-lit and fully visible.",
  },
  "not-supported": {
    label: "Virtual try-on unavailable",
    fallbackHint: null,
  },
  "pending-assessment": {
    label: "Checking your photo",
    fallbackHint: null,
  },
};

// ── Stage A customer hints ────────────────────────────────────────────────────
// Issue-specific messages shown to the customer after Stage A fails.
// These are calm, actionable, and do not expose internal codes.

export const STAGE_A_CUSTOMER_HINTS: Record<ClosetPhotoIssue, string> = {
  "low-resolution":
    "The photo resolution is too low. Retake it at a higher quality setting.",
  "tiny-file":
    "The photo file is too small to assess. Retake it at full resolution.",
  "unusual-aspect-ratio":
    "The photo appears cropped or stretched. Retake it showing the complete item on a plain background.",
  "unsupported-format":
    "This file format is not supported. Upload a JPG, PNG, or HEIC photo instead.",
};

// ── Assessment thresholds (Stage A) ──────────────────────────────────────────

const MIN_DIMENSION_PX  = 300;    // below → low-resolution
const MIN_BYTES         = 10_000;  // below → tiny-file (10 KB)
const MAX_ASPECT_RATIO  = 4.0;    // width/height above → unusual-aspect-ratio
const MIN_ASPECT_RATIO  = 0.2;    // width/height below → unusual-aspect-ratio

const SUPPORTED_FORMATS = new Set([
  "jpg", "jpeg", "png", "webp", "heic", "heif",
]);

// ── Stage A: synchronous metadata precheck ────────────────────────────────────
// Returns "pending-assessment" when metadata passes all checks.
// An item must NOT reach "ready-for-try-on" from this function alone.

export function assessClosetEligibility(
  input: AssessClosetEligibilityInput,
): ClosetEligibilityResult {
  const now = new Date().toISOString();
  const category = PRISMA_CATEGORY_MAP[input.prismaCategory] ?? "unsupported";

  // ── 1. Category check ─────────────────────────────────────────────────────
  if (!SUPPORTED_CATEGORIES.has(category)) {
    return {
      eligible: "not-supported",
      category,
      photoIssues: [],
      internalNote: `Category ${input.prismaCategory} (${category}) is not supported for try-on.`,
      customerHint: null,
      assessedAt: now,
    };
  }

  // ── 2. Format check ───────────────────────────────────────────────────────
  // Reject only when format is explicitly provided and unsupported.
  if (input.format !== undefined) {
    const fmt = input.format.toLowerCase().replace(/^\./, "");
    if (!SUPPORTED_FORMATS.has(fmt)) {
      return {
        eligible: "not-supported",
        category,
        photoIssues: ["unsupported-format"],
        internalNote: `Format "${input.format}" is not accepted by the try-on pipeline.`,
        customerHint: STAGE_A_CUSTOMER_HINTS["unsupported-format"],
        assessedAt: now,
      };
    }
  }

  // ── 3. Image metadata quality checks ─────────────────────────────────────
  const issues: ClosetPhotoIssue[] = [];

  if (input.width !== undefined && input.height !== undefined) {
    if (input.width < MIN_DIMENSION_PX || input.height < MIN_DIMENSION_PX) {
      issues.push("low-resolution");
    }
    const ar = input.width / input.height;
    if (ar > MAX_ASPECT_RATIO || ar < MIN_ASPECT_RATIO) {
      issues.push("unusual-aspect-ratio");
    }
  }

  if (input.bytes !== undefined && input.bytes < MIN_BYTES) {
    if (!issues.includes("low-resolution")) {
      issues.push("tiny-file");
    }
  }

  if (issues.length > 0) {
    return {
      eligible: "needs-clearer-photo",
      category,
      photoIssues: issues,
      internalNote: `Stage A metadata issues: ${issues.join(", ")}. ` +
        `width=${input.width ?? "?"}px height=${input.height ?? "?"}px ` +
        `bytes=${input.bytes ?? "?"} format=${input.format ?? "?"}`,
      // First issue drives the customer hint (most common / most actionable)
      customerHint: STAGE_A_CUSTOMER_HINTS[issues[0]],
      assessedAt: now,
    };
  }

  // ── 4. Stage A passed — visual assessment required before ready-for-try-on
  return {
    eligible: "pending-assessment",
    category,
    photoIssues: [],
    internalNote: `Stage A passed. Pending visual assessment. ` +
      `category=${category} ${input.width ?? "?"}×${input.height ?? "?"}px ` +
      `format=${input.format ?? "?"} bytes=${input.bytes ?? "?"}`,
    customerHint: null,
    assessedAt: now,
  };
}
