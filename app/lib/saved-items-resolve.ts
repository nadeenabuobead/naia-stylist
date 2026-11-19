// app/lib/saved-items-resolve.ts
//
// Turns a save REQUEST — which names only a content key — into the full
// SaveItemRequest, resolving every piece of display text and provenance
// server-side from the report itself.
//
// Pure: the caller loads the report and hands it in, so every rule below is
// unit-testable without a database.
//
// Why: the client sends (contentType, contentKey, reportSlug) and nothing
// else. It never sends a label, a sublabel or a provenance string — a
// tampered payload cannot write arbitrary copy into a Saved card, and the
// snapshot is guaranteed to match what the report actually says.
//
// contentKey itself is also re-derived and checked here, not trusted: for
// TREND/SIGNAL/REFERENCE, the caller's contentKey must match some entry in
// the report RIGHT NOW — either that entry's own persisted id, or
// slugify() of its CURRENT display text, for ANY entry regardless of
// whether it also has an id — or the save is rejected as content_not_found.
// See findEntry()/matchesContentKey() below.
//
// Matching is deliberately tolerant (id OR text-slug), not id-exclusive:
// the UI (trends.$slug.tsx) prefers sending an entry's id when one exists,
// but nothing here requires every caller to have been updated to do that —
// a text-slug request against an id-bearing entry whose text has not
// changed must still succeed. The real edit-immunity guarantee comes from
// the UI actually sending the id (see trends.$slug.tsx's contentKeyFor()),
// not from this function refusing the legacy path.

import { getProductByHandle } from "./ai/naia-catalog";
import {
  slugify,
  type SaveItemRequest,
  type TrendContentType,
} from "./saved-items";
import {
  isTakeawaySectionKey,
  type TakeawaySectionKey,
} from "./trend-takeaway-sections";
import type {
  TrendReportData,
  TrendReportKeyTrend,
  TrendSignal,
  TrendReportReferenceCard,
} from "./trend-reports";

/** What the client is allowed to send. A content key only — never display text. */
export interface SaveTargetRef {
  contentType: TrendContentType;
  contentKey: string;
  /** Report slug — resolved to the report row server-side. */
  reportSlug?: string | null;
  /** For a nested object: the trend it was discovered under. */
  sourceContentKey?: string | null;
}

export type ResolveFailure =
  | { ok: false; reason: "report_not_found" }
  | { ok: false; reason: "content_not_found" }
  | { ok: false; reason: "unsupported" };

export type ResolveResult = { ok: true; request: SaveItemRequest } | ResolveFailure;

/**
 * Customer-facing names for the two personalised-edit sections that
 * currently carry a Save control (see trends.my-edits.$slug.tsx). The other
 * nine entries in TAKEAWAY_SECTION_KEYS are reserved but unsupported today.
 */
const TAKEAWAY_LABELS: Partial<Record<TakeawaySectionKey, string>> = {
  yourBestRouteIn: "Your route in",
  aLookToTry:      "A look to try",
};

type FoundEntry =
  | { contentType: "TREND"; entry: TrendReportKeyTrend }
  | { contentType: "SIGNAL"; entry: TrendSignal }
  | { contentType: "REFERENCE"; entry: TrendReportReferenceCard };

function referenceLabel(entry: TrendReportReferenceCard): string {
  return entry.collection ? `${entry.brand} — ${entry.collection}` : entry.brand;
}

/**
 * Finds the entry matching `contentKey`, scoped to the arrays that belong to
 * `contentType`.
 *
 * Match, per entry — EITHER, checked for every entry regardless of whether
 * it has an id:
 *   - entry.id === contentKey. This is what makes an id-bearing entry
 *     immune to a later text edit: ids are minted once (see
 *     ensureContentIds in editorial-reports.server.ts) and never
 *     regenerated, so editing name/signal/brand/collection/description/
 *     why/naiaRead does not change which entry a save resolves to, PROVIDED
 *     the caller actually sent the id (see trends.$slug.tsx).
 *   - slugify(displayText) === contentKey — the pre-existing,
 *     display-text-derived key. Kept live for EVERY entry, not just
 *     id-less ones, so a caller that still sends the text slug (today's
 *     client, before contentKeyFor() lands everywhere; any future caller
 *     that hasn't been updated) keeps working exactly as it did before ids
 *     existed. This is what a text-edit silently orphans — the id path is
 *     the only one immune to that.
 *
 * SIGNAL searches both rising and fading — on trunk today both are rendered
 * identically, so there is no honest way to distinguish them by type alone,
 * same as the frozen branch's own SIGNAL handling.
 */
function matchesContentKey(id: string | undefined, displayText: string, contentKey: string): boolean {
  if (id && id === contentKey) return true;
  return Boolean(displayText) && slugify(displayText) === contentKey;
}

function findEntry(
  report: TrendReportData,
  contentType: "TREND" | "SIGNAL" | "REFERENCE",
  contentKey: string,
): FoundEntry | null {
  if (contentType === "TREND") {
    const entry = (report.keyTrends ?? []).find((t) => matchesContentKey(t.id, t.name, contentKey));
    return entry ? { contentType, entry } : null;
  }
  if (contentType === "SIGNAL") {
    const pools = [...(report.rising ?? []), ...(report.fading ?? [])];
    const entry = pools.find((s) => matchesContentKey(s.id, s.signal, contentKey));
    return entry ? { contentType, entry } : null;
  }
  const entry = (report.referencesBehindThisEdit ?? []).find(
    (r) => matchesContentKey(r.id, referenceLabel(r), contentKey),
  );
  return entry ? { contentType, entry } : null;
}

function reportProvenance(report: TrendReportData) {
  return {
    sourceKind: "TREND_REPORT" as const,
    sourceReportTitle: report.title,
    sourceSeason: report.season,
  };
}

/**
 * Resolve a save target. Returns a failure rather than throwing so the caller
 * can answer a fetcher POST with a status instead of a stack trace.
 *
 * `takeawayText` is supplied by the caller for TAKEAWAY saves — the
 * personalised edit is generated per customer, so only the route that built
 * it can snapshot its wording.
 */
export function resolveSaveTargetFromReport(
  ref: SaveTargetRef,
  report: TrendReportData | null,
  options: { takeawayText?: string | null } = {},
): ResolveResult {
  const { contentType, contentKey } = ref;

  // ── Global: a NADINE piece ──────────────────────────────────────────────
  if (contentType === "PRODUCT") {
    const product = getProductByHandle(contentKey);
    if (!product) return { ok: false, reason: "content_not_found" };

    const nested = report && ref.sourceContentKey
      ? findEntry(report, "TREND", ref.sourceContentKey) ??
        findEntry(report, "SIGNAL", ref.sourceContentKey) ??
        findEntry(report, "REFERENCE", ref.sourceContentKey)
      : null;
    const nestedLabel = nested
      ? nested.contentType === "REFERENCE"
        ? referenceLabel(nested.entry)
        : nested.contentType === "TREND"
          ? nested.entry.name
          : nested.entry.signal
      : null;

    return {
      ok: true,
      request: {
        contentType: "PRODUCT",
        contentKey,
        reportSlug: null, // global — the same piece saved from two reports is one object
        label: product.parsed.identity.verifiedTitle,
        sublabel: product.parsed.prose.stylingRole ?? null,
        imageUrl: product.parsed.identity.featuredImageUrl,
        sourceKind: "TREND_REPORT",
        sourceReportTitle: report?.title ?? null,
        sourceSeason: report?.season ?? null,
        sourceContentKey: ref.sourceContentKey ?? null,
        sourceContentLabel: nestedLabel,
        sourcePath: ref.reportSlug ? `/trends/my-edits/${ref.reportSlug}` : null,
      },
    };
  }

  // Everything below needs the report.
  if (!report) return { ok: false, reason: "report_not_found" };

  // ── A section of the customer's own personalised edit ───────────────────
  if (contentType === "TAKEAWAY") {
    if (!isTakeawaySectionKey(contentKey)) return { ok: false, reason: "content_not_found" };
    const label = TAKEAWAY_LABELS[contentKey];
    if (!label) return { ok: false, reason: "unsupported" };

    return {
      ok: true,
      request: {
        contentType: "TAKEAWAY",
        contentKey,
        reportSlug: report.slug,
        label,
        sublabel: options.takeawayText ?? null,
        ...reportProvenance(report),
        sourcePath: `/trends/my-edits/${report.slug}`,
      },
    };
  }

  // ── Report content: a trend, a signal, a reference ──────────────────────
  if (contentType === "TREND" || contentType === "SIGNAL" || contentType === "REFERENCE") {
    const found = findEntry(report, contentType, contentKey);
    if (!found) return { ok: false, reason: "content_not_found" };

    const label =
      found.contentType === "REFERENCE"
        ? referenceLabel(found.entry)
        : found.contentType === "TREND"
          ? found.entry.name
          : found.entry.signal;
    const sublabel =
      found.contentType === "REFERENCE"
        ? found.entry.signal
        : found.contentType === "TREND"
          ? found.entry.description
          : found.entry.why;

    return {
      ok: true,
      request: {
        contentType,
        contentKey,
        reportSlug: report.slug,
        label,
        sublabel: sublabel || null,
        ...reportProvenance(report),
        sourcePath: `/trends/${report.slug}`,
      },
    };
  }

  return { ok: false, reason: "unsupported" };
}
