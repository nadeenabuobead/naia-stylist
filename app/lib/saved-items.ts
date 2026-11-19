// app/lib/saved-items.ts
//
// SAVED ITEMS — the shared logic behind saving a trend/signal/reference/
// product/takeaway for later.
//
// Reconciled onto trunk from the frozen fix/trend-product-completion branch.
// That branch's identity scheme (trend-content-identity.ts, trend-facets.ts)
// is a separate, still-frozen redesign and is deliberately NOT used here —
// see Founder Decision. Content is keyed instead by a trivial, inline,
// stateless derivation: no mint/recover/backfill step, and no persisted
// identity table.
//
//   PRODUCT   keyed by the NADINE catalog handle — global, not report-scoped.
//   TAKEAWAY  keyed by a fixed section key (see TAKEAWAY_SECTION_KEYS below).
//   TREND / SIGNAL / REFERENCE
//             keyed by reportSlug + a slugified snapshot of the entry's own
//             display text (name/signal/brand+collection). Trunk's
//             EditorialTrendReport.keyTrends/rising/fading/
//             referencesBehindThisEdit are plain Json arrays with no
//             embedded id — this is the simplest honest key available
//             without reviving the frozen identity module.
//
// FACET and LOOK are dropped for this v1: FACET per Founder Decision (facet
// vocabulary stays frozen); LOOK was never a real SavedItem path — SavedLook
// (StyleMe outfits) is its own, untouched store.
//
// This module is pure: no DB, no I/O.

import {
  TAKEAWAY_SECTION_KEYS,
  isTakeawaySectionKey,
  type TakeawaySectionKey,
} from "./trend-takeaway-sections";

export { TAKEAWAY_SECTION_KEYS, isTakeawaySectionKey, type TakeawaySectionKey };

// ── Content types ────────────────────────────────────────────────────────────

export const TREND_CONTENT_TYPES = [
  "TREND",
  "SIGNAL",
  "REFERENCE",
  "PRODUCT",
  "TAKEAWAY",
] as const;

export type TrendContentType = (typeof TREND_CONTENT_TYPES)[number];

export function isTrendContentType(value: unknown): value is TrendContentType {
  return typeof value === "string" && (TREND_CONTENT_TYPES as readonly string[]).includes(value);
}

/** PRODUCT is the one global type — saved once, independent of which report it was found in. */
const GLOBAL_CONTENT_TYPES: ReadonlySet<TrendContentType> = new Set(["PRODUCT"]);

export function isReportScopedContentType(contentType: TrendContentType): boolean {
  return !GLOBAL_CONTENT_TYPES.has(contentType);
}

// ── Takeaway sections ─────────────────────────────────────────────────────────
//
// TAKEAWAY_SECTION_KEYS / TakeawaySectionKey / isTakeawaySectionKey now live
// in ./trend-takeaway-sections.ts (a type-checked single source, verified
// against ShopperEdit's actual field names) and are re-exported above for
// every existing importer of this module.

// ── Slugify ───────────────────────────────────────────────────────────────────

/**
 * Trivial, deterministic, inline key derivation — no persistence, no
 * recovery step. Two entries with the literal same display text in the same
 * report collide onto the same key; that is an accepted v1 limitation (see
 * module comment), not a bug to be solved by a mint/recover system.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ── Item key ──────────────────────────────────────────────────────────────────

export interface ItemKeyInput {
  contentType: TrendContentType;
  contentKey: string;
  reportSlug?: string | null;
}

/**
 * The deterministic, customer-scoped identity string stored as SavedItem.itemKey.
 * Computed fresh on every request — never read back as a source of truth for
 * anything other than the uniqueness constraint it backs.
 */
export function buildItemKey(input: ItemKeyInput): string {
  const contentKey = input.contentKey?.trim();
  if (!contentKey) throw new Error(`A ${input.contentType} save needs a content key`);

  if (!isReportScopedContentType(input.contentType)) {
    return `${input.contentType}:${contentKey}`;
  }

  const reportSlug = input.reportSlug?.trim();
  if (!reportSlug) throw new Error(`${input.contentType} is report-scoped and needs a reportSlug`);
  return `${input.contentType}:${reportSlug}:${contentKey}`;
}

// ── Provenance ────────────────────────────────────────────────────────────────

export const SAVED_SOURCE_KINDS = ["TREND_REPORT"] as const;

export type SavedSourceKind = (typeof SAVED_SOURCE_KINDS)[number];

export function isSavedSourceKind(value: unknown): value is SavedSourceKind {
  return typeof value === "string" && (SAVED_SOURCE_KINDS as readonly string[]).includes(value);
}

// ── Saving ────────────────────────────────────────────────────────────────────

export interface SaveItemRequest {
  contentType: TrendContentType;
  contentKey: string;
  reportSlug?: string | null;

  /** Display snapshot — for rendering the card, never for identity. */
  label: string;
  sublabel?: string | null;
  imageUrl?: string | null;

  /** Where the customer discovered this. */
  sourceKind: SavedSourceKind;
  sourceReportTitle?: string | null;
  sourceSeason?: string | null;
  sourceContentKey?: string | null;
  sourceContentLabel?: string | null;
  sourcePath?: string | null;
}

export interface SaveItemRow {
  itemKey: string;
  contentType: string;
  contentKey: string;
  reportSlug: string | null;
  label: string;
  sublabel: string | null;
  imageUrl: string | null;
  sourceKind: string;
  sourceReportTitle: string | null;
  sourceSeason: string | null;
  sourceContentKey: string | null;
  sourceContentLabel: string | null;
  sourcePath: string | null;
}

const MAX_LABEL = 160;
const MAX_SUBLABEL = 320;

function snapshot(value: string | null | undefined, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (trimmed === "") return null;
  return trimmed.length > max ? `${trimmed.slice(0, max - 1).trimEnd()}…` : trimmed;
}

/**
 * Validate a save request and build the row. Throws rather than writing a row
 * that cannot be rendered or cannot be found again.
 *
 * Only in-app paths are kept for sourcePath: an absolute or protocol-relative
 * URL would let a stored value redirect a customer off-site.
 */
export function buildSaveItemRow(request: SaveItemRequest): SaveItemRow {
  if (!isTrendContentType(request.contentType)) {
    throw new Error(`Unknown content type: ${String(request.contentType)}`);
  }
  if (!isSavedSourceKind(request.sourceKind)) {
    throw new Error(`Unknown source kind: ${String(request.sourceKind)}`);
  }

  const label = snapshot(request.label, MAX_LABEL);
  if (!label) throw new Error("A saved item needs a label to render");

  const itemKey = buildItemKey({
    contentType: request.contentType,
    contentKey: request.contentKey,
    reportSlug: request.reportSlug ?? null,
  });

  const reportSlug = isReportScopedContentType(request.contentType)
    ? (request.reportSlug?.trim() ?? null)
    : null;

  const path = snapshot(request.sourcePath, 512);
  const safePath = path && path.startsWith("/") && !path.startsWith("//") ? path : null;

  return {
    itemKey,
    contentType: request.contentType,
    contentKey: request.contentKey,
    reportSlug,
    label,
    sublabel: snapshot(request.sublabel, MAX_SUBLABEL),
    imageUrl: snapshot(request.imageUrl, 2048),
    sourceKind: request.sourceKind,
    sourceReportTitle: snapshot(request.sourceReportTitle, MAX_LABEL),
    sourceSeason: snapshot(request.sourceSeason, 64),
    sourceContentKey: snapshot(request.sourceContentKey, 128),
    sourceContentLabel: snapshot(request.sourceContentLabel, MAX_LABEL),
    sourcePath: safePath,
  };
}

// ── Cards ─────────────────────────────────────────────────────────────────────

export type SavedLane = "trends" | "brands" | "pieces" | "notes";

export const SAVED_LANE_LABELS: Readonly<Record<SavedLane, string>> = {
  trends: "Trends",
  brands: "Brands",
  pieces: "Pieces",
  notes:  "Your notes",
};

const CONTENT_TYPE_LANES: Readonly<Record<TrendContentType, SavedLane>> = {
  TREND:     "trends",
  SIGNAL:    "trends",
  REFERENCE: "brands",
  PRODUCT:   "pieces",
  TAKEAWAY:  "notes",
};

const CONTENT_TYPE_LABELS: Readonly<Record<TrendContentType, string>> = {
  TREND:     "Trend",
  SIGNAL:    "Signal",
  REFERENCE: "Brand",
  PRODUCT:   "Piece",
  TAKEAWAY:  "Your takeaway",
};

export interface SavedCard {
  id: string;
  itemKey: string;
  lane: SavedLane;
  typeLabel: string;
  label: string;
  sublabel: string | null;
  images: string[];
  href: string | null;
  provenance: string | null;
  provenanceDetail: string | null;
  createdAt: string;
}

export interface SavedItemRecord {
  id: string;
  itemKey: string;
  contentType: string;
  contentKey: string;
  label: string;
  sublabel: string | null;
  imageUrl: string | null;
  sourceKind: string;
  sourceReportTitle: string | null;
  sourceSeason: string | null;
  sourceContentLabel: string | null;
  sourcePath: string | null;
  createdAt: string;
}

export function savedItemToCard(row: SavedItemRecord): SavedCard {
  const contentType = isTrendContentType(row.contentType) ? row.contentType : "TREND";

  const fromParts = [row.sourceReportTitle, row.sourceSeason].filter(Boolean) as string[];
  const provenance = fromParts.length > 0 ? `From: ${fromParts.join(" · ")}` : "From: Trend Report";

  return {
    id: row.id,
    itemKey: row.itemKey,
    lane: CONTENT_TYPE_LANES[contentType],
    typeLabel: CONTENT_TYPE_LABELS[contentType],
    label: row.label,
    sublabel: row.sublabel,
    images: row.imageUrl ? [row.imageUrl] : [],
    href: row.sourcePath,
    provenance,
    provenanceDetail: row.sourceContentLabel ? `Trend: ${row.sourceContentLabel}` : null,
    createdAt: row.createdAt,
  };
}
