// app/lib/saved-items.ts
//
// MY SAVED — the shared logic behind the cross-nAia saved space.
//
// Two stores feed one destination and neither duplicates the other:
//
//   SavedLook  outfits, written by StyleMe. Untouched by this work.
//   SavedItem  everything else — trends, signals, brands, products, colour and
//              material directions, personalised takeaways.
//
// This module is pure: no DB, no I/O. It builds the row payload for a save,
// normalises both stores into one card shape, and writes the provenance line.
//
// ── IDENTITY ─────────────────────────────────────────────────────────────────
// A SavedItem is identified by refKey (see trend-content-identity.ts), unique
// per customer. Consequences, which are the point of the design:
//
//   a TREND is report-scoped        → the same trend in two reports is two objects
//   a PRODUCT is global            → saved from two reports, still ONE card
//   a FACET is global              → material:suede saved twice, still ONE card
//   saving twice is idempotent     → no duplicate cards, ever
//
// Provenance belongs to the save that CREATED the row and is never overwritten
// by a later encounter with the same canonical object. Unsaving and saving again
// from somewhere else naturally records the new provenance, because that is a
// new row.

import {
  buildRefKey,
  isTrendContentType,
  type TrendContentType,
} from "./trend-content-identity";
import { parseFacetContentId, FACET_KIND_LABELS } from "./trend-facets";

// ── Provenance ────────────────────────────────────────────────────────────────

export const SAVED_SOURCE_KINDS = [
  "TREND_REPORT",
  "STYLEME",
  "CLOSET",
  "BUY_OR_SKIP",
] as const;

export type SavedSourceKind = (typeof SAVED_SOURCE_KINDS)[number];

export function isSavedSourceKind(value: unknown): value is SavedSourceKind {
  return typeof value === "string" && (SAVED_SOURCE_KINDS as readonly string[]).includes(value);
}

const SOURCE_KIND_LABELS: Readonly<Record<SavedSourceKind, string>> = {
  TREND_REPORT: "Trend Report",
  STYLEME:      "StyleMe",
  CLOSET:       "My Closet",
  BUY_OR_SKIP:  "Buy or Skip",
};

// ── Saving ────────────────────────────────────────────────────────────────────

export interface SaveItemRequest {
  contentType: TrendContentType;
  contentId: string;
  reportId?: string | null;

  /** Display snapshot — for rendering the card, never for identity. */
  label: string;
  sublabel?: string | null;
  imageUrl?: string | null;

  /** Where the customer discovered this. */
  sourceKind: SavedSourceKind;
  sourceReportTitle?: string | null;
  sourceSeason?: string | null;
  sourceContentId?: string | null;
  sourceContentLabel?: string | null;
  sourcePath?: string | null;
}

export interface SaveItemRow {
  refKey: string;
  contentType: string;
  contentId: string;
  reportId: string | null;
  label: string;
  sublabel: string | null;
  imageUrl: string | null;
  sourceKind: string;
  sourceReportTitle: string | null;
  sourceSeason: string | null;
  sourceContentId: string | null;
  sourceContentLabel: string | null;
  sourcePath: string | null;
}

/** Snapshot text is trimmed and bounded — a card needs a line, not an essay. */
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
 * that cannot be rendered or cannot be found again — a SavedItem with no label
 * is a blank card, and one with a bad refKey is unreachable.
 *
 * Only in-app paths are kept: an absolute or protocol-relative URL in
 * sourcePath would let a stored value redirect a customer off-site.
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

  // Throws for a report-scoped type with no reportId.
  const refKey = buildRefKey({
    contentType: request.contentType,
    contentId: request.contentId,
    reportId: request.reportId ?? null,
  });

  const path = snapshot(request.sourcePath, 512);
  const safePath = path && path.startsWith("/") && !path.startsWith("//") ? path : null;

  return {
    refKey,
    contentType: request.contentType,
    contentId: request.contentId,
    reportId: request.reportId ?? null,
    label,
    sublabel: snapshot(request.sublabel, MAX_SUBLABEL),
    imageUrl: snapshot(request.imageUrl, 2048),
    sourceKind: request.sourceKind,
    sourceReportTitle: snapshot(request.sourceReportTitle, MAX_LABEL),
    sourceSeason: snapshot(request.sourceSeason, 64),
    sourceContentId: snapshot(request.sourceContentId, 128),
    sourceContentLabel: snapshot(request.sourceContentLabel, MAX_LABEL),
    sourcePath: safePath,
  };
}

// ── Cards ─────────────────────────────────────────────────────────────────────

/** One filter lane in My Saved. Derived from what the customer actually has. */
export type SavedLane = "looks" | "trends" | "brands" | "pieces" | "directions" | "notes";

export const SAVED_LANE_LABELS: Readonly<Record<SavedLane, string>> = {
  looks:      "Looks",
  trends:     "Trends",
  brands:     "Brands",
  pieces:     "Pieces",
  directions: "Colours & materials",
  notes:      "Your notes",
};

const CONTENT_TYPE_LANES: Readonly<Record<TrendContentType, SavedLane>> = {
  TREND:     "trends",
  SIGNAL:    "trends",
  REFERENCE: "brands",
  PRODUCT:   "pieces",
  FACET:     "directions",
  TAKEAWAY:  "notes",
  LOOK:      "looks",
};

export interface SavedCard {
  /** Row id — SavedLook.id or SavedItem.id. */
  id: string;
  /** Which store this came from, so the right unsave action is used. */
  store: "look" | "item";
  /** Canonical identity. Null for looks, which are identified by row id. */
  refKey: string | null;
  lane: SavedLane;
  /** Short human type, e.g. "Trend", "Colour", "Look". */
  typeLabel: string;
  label: string;
  sublabel: string | null;
  /** Up to three images; looks show their pieces, items show one. */
  images: string[];
  /** In-app link back, when one is known. */
  href: string | null;
  /** "From: Autumn Edit · September 2026" */
  provenance: string | null;
  /** "Trend: Suede Textures" */
  provenanceDetail: string | null;
  createdAt: string;
}

/** A saved facet reads as its kind: "Colour", "Material", "Silhouette". */
function itemTypeLabel(contentType: TrendContentType, contentId: string): string {
  if (contentType === "FACET") {
    const parsed = parseFacetContentId(contentId);
    if (parsed) return FACET_KIND_LABELS[parsed.kind];
    return "Direction";
  }
  switch (contentType) {
    case "TREND":     return "Trend";
    case "SIGNAL":    return "Signal";
    case "REFERENCE": return "Brand";
    case "PRODUCT":   return "Piece";
    case "TAKEAWAY":  return "Your takeaway";
    case "LOOK":      return "Look";
  }
}

export interface SavedItemRecord {
  id: string;
  refKey: string;
  contentType: string;
  contentId: string;
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
  const sourceKind = isSavedSourceKind(row.sourceKind) ? row.sourceKind : null;

  // "From: Autumn Edit · September 2026", degrading gracefully when the
  // snapshot is partial rather than printing a stray separator.
  const fromParts = [row.sourceReportTitle, row.sourceSeason].filter(Boolean) as string[];
  const provenance = fromParts.length > 0
    ? `From: ${fromParts.join(" · ")}`
    : sourceKind
      ? `From: ${SOURCE_KIND_LABELS[sourceKind]}`
      : null;

  return {
    id: row.id,
    store: "item",
    refKey: row.refKey,
    lane: CONTENT_TYPE_LANES[contentType],
    typeLabel: itemTypeLabel(contentType, row.contentId),
    label: row.label,
    sublabel: row.sublabel,
    images: row.imageUrl ? [row.imageUrl] : [],
    href: row.sourcePath,
    provenance,
    provenanceDetail: row.sourceContentLabel ? `Trend: ${row.sourceContentLabel}` : null,
    createdAt: row.createdAt,
  };
}

export interface SavedLookRecord {
  id: string;
  name: string | null;
  occasion: string | null;
  images: string[];
  originalSessionId: string | null;
  timesWorn: number;
  createdAt: string;
}

export function savedLookToCard(look: SavedLookRecord): SavedCard {
  const worn = look.timesWorn > 0
    ? `Worn ${look.timesWorn} time${look.timesWorn === 1 ? "" : "s"}`
    : null;

  return {
    id: look.id,
    store: "look",
    refKey: null,
    lane: "looks",
    typeLabel: "Look",
    label: look.name || "Saved look",
    sublabel: [look.occasion, worn].filter(Boolean).join(" · ") || null,
    images: look.images.slice(0, 3),
    href: look.originalSessionId ? `/style-me/result?sessionId=${look.originalSessionId}` : null,
    provenance: "From: StyleMe",
    provenanceDetail: null,
    createdAt: look.createdAt,
  };
}

/** Newest first, across both stores. */
export function mergeSavedCards(cards: SavedCard[]): SavedCard[] {
  return [...cards].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

/** Lanes that actually have something in them, in display order. */
export function activeLanes(cards: SavedCard[]): SavedLane[] {
  const order: SavedLane[] = ["looks", "trends", "brands", "pieces", "directions", "notes"];
  const present = new Set(cards.map((c) => c.lane));
  return order.filter((lane) => present.has(lane));
}

export function countByLane(cards: SavedCard[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const card of cards) counts[card.lane] = (counts[card.lane] ?? 0) + 1;
  return counts;
}
