// nAia Admin — Closet Intelligence server utilities.
//
// Read-only data access for the Closet Intelligence dashboard.
// No mutations here — editing/overrides live in closet-review.server.ts (Phase 3+).
//
// Public exports:
//   listClosetItems(filters, page)    — paginated item list with status summary
//   getClosetItemDetail(itemId)       — full item + snapshots + adminReview
//   REVIEW_STATUS_LABELS              — canonical display labels for review status
//   computeDisplayReviewStatus(...)   — maps stored status to display label

import prisma from "~/db.server";
import type { ClosetCategory, Prisma } from "@prisma/client";

// ── Review status display ─────────────────────────────────────────────────────

export const REVIEW_STATUS_LABELS = {
  unreviewed: "AI ONLY",
  reviewed:   "REVIEWED",
  overridden: "CORRECTED BY YOU",
} as const;

export type DisplayReviewStatus = (typeof REVIEW_STATUS_LABELS)[keyof typeof REVIEW_STATUS_LABELS];

export function computeDisplayReviewStatus(
  reviewStatus: string | null | undefined,
): DisplayReviewStatus {
  if (reviewStatus === "reviewed")   return "REVIEWED";
  if (reviewStatus === "overridden") return "CORRECTED BY YOU";
  return "AI ONLY";
}

// ── Filter types ──────────────────────────────────────────────────────────────

export type ClosetAnalysisStatus = "not_analyzed" | "pending" | "ready" | "failed";
export type ClosetAdminReviewFilter = "unreviewed" | "reviewed" | "overridden";

export interface ClosetItemListFilters {
  /** Case-insensitive substring match on closetItem.name OR customer.email */
  search?: string;
  category?: ClosetCategory;
  analysisStatus?: ClosetAnalysisStatus;
  reviewStatus?: ClosetAdminReviewFilter;
  formality?: string;
  /** Filter by occasion — item.occasions array contains this value */
  occasion?: string;
  /** Only items where fieldConfidence.overall = "low" */
  lowConfidence?: boolean;
  /** Only analyzed items missing subcategory, silhouette, or formality */
  missingMetadata?: boolean;
}

export const PAGE_SIZE = 25;

// ── Overall confidence computation ────────────────────────────────────────────

// Fields that carry confidence data per category.
// Only the fields that are meaningful for that category are considered.
// Apparel fit/coverage fields are excluded for SHOES/BAGS/ACCESSORIES/JEWELRY.
const CATEGORY_CONFIDENCE_FIELDS: Record<string, readonly string[]> = {
  TOPS:        ["subcategory", "silhouette", "fitProfile", "topLength", "sleeveLength", "necklineCoverage", "material", "pattern", "primaryColor"],
  BOTTOMS:     ["subcategory", "silhouette", "fitProfile", "hemLength", "waistShape", "material", "pattern", "primaryColor"],
  DRESSES:     ["subcategory", "silhouette", "fitProfile", "hemLength", "sleeveLength", "necklineCoverage", "material", "pattern", "primaryColor"],
  OUTERWEAR:   ["subcategory", "silhouette", "fitProfile", "sleeveLength", "material", "pattern", "primaryColor"],
  ACTIVEWEAR:  ["subcategory", "silhouette", "fitProfile", "sleeveLength", "material", "pattern", "primaryColor"],
  SHOES:       ["subcategory", "material", "primaryColor", "pattern"],
  BAGS:        ["subcategory", "material", "primaryColor", "pattern"],
  ACCESSORIES: ["subcategory", "material", "primaryColor"],
  JEWELRY:     ["subcategory", "primaryColor"],
};

// Minimum number of relevant fields that must have confidence data to produce a summary.
const MIN_CONFIDENCE_FIELDS = 2;

// All keys that can appear in fieldConfidence — used for the lowConfidence DB pre-filter.
const ALL_CONFIDENCE_FIELD_KEYS = [
  "subcategory", "silhouette", "fitProfile", "hemLength", "topLength",
  "sleeveLength", "necklineCoverage", "waistShape", "material", "pattern", "primaryColor",
] as const;

/**
 * Compute a single overall confidence rating from stored per-field confidence data.
 *
 * Rule (simple and auditable):
 *   null   — fewer than MIN_CONFIDENCE_FIELDS relevant fields have data
 *   "LOW"  — any relevant field rated "low"
 *   "MEDIUM" — no "low" fields, but at least one relevant field rated "medium"
 *   "HIGH" — all available relevant fields rated "high" (and ≥ MIN_CONFIDENCE_FIELDS present)
 *
 * Category-aware: only fields relevant to the garment category are considered.
 * This prevents shoes from being penalised for absent silhouette/neckline confidence.
 */
export function computeOverallStoredConfidence(
  fieldConfidence: unknown,
  category: string,
): "HIGH" | "MEDIUM" | "LOW" | null {
  if (!fieldConfidence || typeof fieldConfidence !== "object") return null;

  const fc = fieldConfidence as Record<string, unknown>;
  const relevantKeys = CATEGORY_CONFIDENCE_FIELDS[category] ?? CATEGORY_CONFIDENCE_FIELDS["TOPS"];

  // Collect confidence values only for relevant fields that actually have data
  const values: string[] = [];
  for (const key of relevantKeys) {
    const val = fc[key];
    if (val === "high" || val === "medium" || val === "low") {
      values.push(val);
    }
  }

  if (values.length < MIN_CONFIDENCE_FIELDS) return null;
  if (values.includes("low"))    return "LOW";
  if (values.includes("medium")) return "MEDIUM";
  return "HIGH";
}

// ── Important metadata fields used for "missing metadata" check ───────────────

// Categories where silhouette is not a meaningful classification field.
// For these categories a null silhouette is expected, not a data gap.
const NON_SILHOUETTE_CATEGORIES = new Set(["SHOES", "BAGS", "ACCESSORIES", "JEWELRY"]);

// ── List ──────────────────────────────────────────────────────────────────────

export interface ClosetItemRow {
  id: string;
  name: string | null;
  category: string;
  subcategory: string | null;
  analysisStatus: string;
  /** Stored review status: "unreviewed" | "reviewed" | "overridden" */
  reviewStatus: string;
  /** Human-readable display label: "AI ONLY" | "REVIEWED" | "CORRECTED BY YOU" */
  displayReviewStatus: DisplayReviewStatus;
  formality: string | null;
  occasions: string[];
  analyzedAt: Date | null;
  thumbnailUrl: string | null;
  imagePublicId: string | null;
  /** "HIGH" | "MEDIUM" | "LOW" | null — computed from field-level stored confidence */
  overallConfidence: "HIGH" | "MEDIUM" | "LOW" | null;
  lowConfidence: boolean;
  missingMetadata: boolean;
  customerId: string;
  customerEmail: string | null;
  createdAt: Date;
}

export interface ClosetItemListResult {
  items: ClosetItemRow[];
  total: number;
  page: number;
  pageCount: number;
}

export async function listClosetItems(
  filters: ClosetItemListFilters,
  page: number,
): Promise<ClosetItemListResult> {
  const skip = (page - 1) * PAGE_SIZE;

  const where: Prisma.ClosetItemWhereInput = {};
  const andClauses: Prisma.ClosetItemWhereInput[] = [];

  // Search: name OR customer email
  if (filters.search) {
    andClauses.push({
      OR: [
        { name: { contains: filters.search, mode: "insensitive" } },
        { customer: { email: { contains: filters.search, mode: "insensitive" } } },
      ],
    });
  }

  if (filters.category) {
    andClauses.push({ category: filters.category });
  }

  if (filters.analysisStatus) {
    andClauses.push({ analysisStatus: filters.analysisStatus });
  }

  if (filters.formality) {
    andClauses.push({ formality: filters.formality });
  }

  if (filters.occasion) {
    andClauses.push({ occasions: { has: filters.occasion } });
  }

  // reviewStatus: "unreviewed" = no adminReview row OR row with "unreviewed"
  if (filters.reviewStatus) {
    if (filters.reviewStatus === "unreviewed") {
      andClauses.push({
        OR: [
          { adminReview: null },
          { adminReview: { reviewStatus: "unreviewed" } },
        ],
      });
    } else {
      andClauses.push({ adminReview: { reviewStatus: filters.reviewStatus } });
    }
  }

  // lowConfidence: any relevant field in fieldConfidence = "low".
  // This is a broad DB pre-filter across all known confidence keys; the per-row
  // computeOverallStoredConfidence call is the authoritative category-aware check.
  if (filters.lowConfidence) {
    andClauses.push({
      analysisStatus: "ready",
      OR: ALL_CONFIDENCE_FIELD_KEYS.map((key) => ({
        fieldConfidence: { path: [key], equals: "low" },
      })),
    });
  }

  // missingMetadata: analysis complete but missing critical classification fields.
  // Silhouette is only required for clothing categories — not SHOES/BAGS/ACCESSORIES/JEWELRY.
  if (filters.missingMetadata) {
    andClauses.push({
      analysisStatus: "ready",
      OR: [
        { subcategory: null },
        { formality: null },
        {
          silhouette: null,
          category: { notIn: [...NON_SILHOUETTE_CATEGORIES] as string[] },
        },
      ],
    });
  }

  if (andClauses.length > 0) {
    where.AND = andClauses;
  }

  const [items, total] = await Promise.all([
    prisma.closetItem.findMany({
      where,
      skip,
      take: PAGE_SIZE,
      orderBy: [{ createdAt: "desc" }],
      select: {
        id: true,
        name: true,
        category: true,
        subcategory: true,
        analysisStatus: true,
        analyzedAt: true,
        thumbnailUrl: true,
        imagePublicId: true,
        fieldConfidence: true,
        formality: true,
        occasions: true,
        silhouette: true,
        customerId: true,
        createdAt: true,
        adminReview: {
          select: { reviewStatus: true },
        },
        customer: {
          select: { email: true },
        },
      },
    }),
    prisma.closetItem.count({ where }),
  ]);

  type ItemRow = (typeof items)[number];
  const rows: ClosetItemRow[] = items.map((item: ItemRow) => {
    const reviewStatus = item.adminReview?.reviewStatus ?? "unreviewed";
    const overallConf = computeOverallStoredConfidence(item.fieldConfidence, item.category);
    const isAnalyzed = item.analysisStatus === "ready";
    const silhouetteRequired = !NON_SILHOUETTE_CATEGORIES.has(item.category);
    const missMeta = isAnalyzed && (
      item.subcategory == null ||
      (silhouetteRequired && item.silhouette == null) ||
      item.formality == null
    );

    return {
      id: item.id,
      name: item.name,
      category: item.category,
      subcategory: item.subcategory,
      analysisStatus: item.analysisStatus,
      reviewStatus,
      displayReviewStatus: computeDisplayReviewStatus(reviewStatus),
      formality: item.formality,
      occasions: item.occasions,
      analyzedAt: item.analyzedAt,
      thumbnailUrl: item.thumbnailUrl,
      imagePublicId: item.imagePublicId,
      overallConfidence: overallConf,
      lowConfidence: overallConf === "LOW",
      missingMetadata: missMeta,
      customerId: item.customerId,
      customerEmail: item.customer?.email ?? null,
      createdAt: item.createdAt,
    };
  });

  return {
    items: rows,
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
}

// ── Detail ────────────────────────────────────────────────────────────────────

export interface ClosetItemDetail {
  id: string;
  name: string | null;
  category: string;
  analysisStatus: string;
  analyzedAt: Date | null;
  analysisSchemaVersion: string | null;
  thumbnailUrl: string | null;
  imagePublicId: string | null;
  imageFormat: string | null;
  customerId: string;
  customerEmail: string | null;
  createdAt: Date;

  // Classification fields (current live values on ClosetItem)
  classification: ClosetClassification;

  // AI confidence (fieldConfidence JSON on ClosetItem)
  fieldConfidence: Record<string, unknown> | null;

  // Whether any snapshot exists (determines provenance labeling)
  hasSnapshot: boolean;

  // Latest analysis snapshot (what Claude returned before customer-precedence merge)
  latestSnapshot: ClosetSnapshot | null;

  // Full snapshot history (newest first)
  snapshotHistory: ClosetSnapshotSummary[];

  // Review status with display label
  reviewStatus: string;
  displayReviewStatus: DisplayReviewStatus;

  // Admin review record (null if never reviewed)
  adminReview: ClosetAdminReviewRecord | null;
}

export interface ClosetClassification {
  subcategory: string | null;
  silhouette: string | null;
  fitProfile: string | null;
  hemLength: string | null;
  topLength: string | null;
  waistShape: string | null;
  sleeveLength: string | null;
  necklineCoverage: string | null;
  shoulderCoverage: boolean | null;
  midriffExposed: boolean | null;
  material: string | null;
  pattern: string | null;
  primaryColor: string | null;
  colors: string[];
  occasions: string[];
  seasons: string[];
  formality: string | null;
  stylePersonality: string | null;
  styleTags: string[];
  garmentRelationships: string[];
}

export interface ClosetSnapshot {
  id: string;
  analysisModel: string;
  analysisSchemaVersion: string;
  analyzedAt: Date;
  normalizedAnalysis: Record<string, unknown>;
  createdAt: Date;
}

export interface ClosetSnapshotSummary {
  id: string;
  analysisModel: string;
  analysisSchemaVersion: string;
  analyzedAt: Date;
}

export interface ClosetAdminReviewRecord {
  reviewStatus: string;
  adminNotes: string | null;
  overrides: Record<string, unknown> | null;
  reviewedAt: Date | null;
  reviewedBy: string | null;
  updatedAt: Date;
}

export async function getClosetItemDetail(itemId: string): Promise<ClosetItemDetail | null> {
  const item = await prisma.closetItem.findUnique({
    where: { id: itemId },
    include: {
      customer: { select: { email: true } },
      analysisSnapshots: {
        orderBy: { analyzedAt: "desc" },
      },
      adminReview: true,
    },
  });

  if (!item) return null;

  const [latestSnap, ...restSnaps] = item.analysisSnapshots;
  const reviewStatus = item.adminReview?.reviewStatus ?? "unreviewed";

  return {
    id: item.id,
    name: item.name,
    category: item.category,
    analysisStatus: item.analysisStatus,
    analyzedAt: item.analyzedAt,
    analysisSchemaVersion: item.analysisSchemaVersion,
    thumbnailUrl: item.thumbnailUrl,
    imagePublicId: item.imagePublicId,
    imageFormat: item.imageFormat,
    customerId: item.customerId,
    customerEmail: item.customer?.email ?? null,
    createdAt: item.createdAt,

    classification: {
      subcategory: item.subcategory,
      silhouette: item.silhouette,
      fitProfile: item.fitProfile,
      hemLength: item.hemLength,
      topLength: item.topLength,
      waistShape: item.waistShape,
      sleeveLength: item.sleeveLength,
      necklineCoverage: item.necklineCoverage,
      shoulderCoverage: item.shoulderCoverage,
      midriffExposed: item.midriffExposed,
      material: item.material,
      pattern: item.pattern,
      primaryColor: item.primaryColor,
      colors: item.colors,
      occasions: item.occasions,
      seasons: item.seasons,
      formality: item.formality,
      stylePersonality: item.stylePersonality,
      styleTags: item.styleTags,
      garmentRelationships: item.garmentRelationships,
    },

    fieldConfidence: item.fieldConfidence as Record<string, unknown> | null,

    hasSnapshot: item.analysisSnapshots.length > 0,

    latestSnapshot: latestSnap
      ? {
          id: latestSnap.id,
          analysisModel: latestSnap.analysisModel,
          analysisSchemaVersion: latestSnap.analysisSchemaVersion,
          analyzedAt: latestSnap.analyzedAt,
          normalizedAnalysis: latestSnap.normalizedAnalysis as Record<string, unknown>,
          createdAt: latestSnap.createdAt,
        }
      : null,

    snapshotHistory: [latestSnap, ...restSnaps].filter(Boolean).map((s) => ({
      id: s!.id,
      analysisModel: s!.analysisModel,
      analysisSchemaVersion: s!.analysisSchemaVersion,
      analyzedAt: s!.analyzedAt,
    })),

    reviewStatus,
    displayReviewStatus: computeDisplayReviewStatus(reviewStatus),

    adminReview: item.adminReview
      ? {
          reviewStatus: item.adminReview.reviewStatus,
          adminNotes: item.adminReview.adminNotes,
          overrides: item.adminReview.overrides as Record<string, unknown> | null,
          reviewedAt: item.adminReview.reviewedAt,
          reviewedBy: item.adminReview.reviewedBy,
          updatedAt: item.adminReview.updatedAt,
        }
      : null,
  };
}

// ── Queue navigation (Phase 3B) ───────────────────────────────────────────────

/** Returns the ID of the next unreviewed closet item, ordered by createdAt DESC.
 *  "Next" means older than the current item in the sorted list.
 *  Returns null if there are no more unreviewed items after this one. */
export async function getNextUnreviewedItemId(
  currentItemId: string,
): Promise<string | null> {
  const current = await prisma.closetItem.findUnique({
    where: { id: currentItemId },
    select: { createdAt: true },
  });
  if (!current) return null;

  const next = await prisma.closetItem.findFirst({
    where: {
      createdAt: { lt: current.createdAt },
      OR: [
        { adminReview: null },
        { adminReview: { reviewStatus: "unreviewed" } },
      ],
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  return next?.id ?? null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function extractOverallConfidence(fieldConfidence: unknown): string | null {
  if (!fieldConfidence || typeof fieldConfidence !== "object") return null;
  const fc = fieldConfidence as Record<string, unknown>;
  const overall = fc.overall;
  if (overall === "high" || overall === "medium" || overall === "low") return overall;
  return null;
}
