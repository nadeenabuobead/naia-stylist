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
// TREND/SIGNAL/REFERENCE, the caller's contentKey must equal slugify() of
// some entry's own display text in the report RIGHT NOW, or the save is
// rejected as content_not_found. That re-check is what stands in for the
// frozen identity module's id lookup.

import { getProductByHandle } from "./ai/naia-catalog";
import {
  isTakeawaySectionKey,
  slugify,
  type SaveItemRequest,
  type TakeawaySectionKey,
  type TrendContentType,
} from "./saved-items";
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
 * Finds the entry whose own display text slugifies to `contentKey`, scoped to
 * the arrays that belong to `contentType`. SIGNAL searches both rising and
 * fading — on trunk today both are rendered identically and neither carries
 * an id, so there is no honest way to distinguish them by type alone, same
 * as the frozen branch's own SIGNAL handling.
 */
function findEntry(
  report: TrendReportData,
  contentType: "TREND" | "SIGNAL" | "REFERENCE",
  contentKey: string,
): FoundEntry | null {
  if (contentType === "TREND") {
    const entry = (report.keyTrends ?? []).find((t) => t.name && slugify(t.name) === contentKey);
    return entry ? { contentType, entry } : null;
  }
  if (contentType === "SIGNAL") {
    const pools = [...(report.rising ?? []), ...(report.fading ?? [])];
    const entry = pools.find((s) => s.signal && slugify(s.signal) === contentKey);
    return entry ? { contentType, entry } : null;
  }
  const entry = (report.referencesBehindThisEdit ?? []).find(
    (r) => referenceLabel(r) && slugify(referenceLabel(r)) === contentKey,
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
