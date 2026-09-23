// app/lib/saved-items-resolve.ts
//
// Turns a save REQUEST — which names only stable identifiers — into the full
// SaveItemRequest, resolving every piece of display text and provenance
// server-side from the report itself.
//
// Pure: the caller loads the report and hands it in, so every rule below is
// unit-testable without a database.
//
// Why: the client sends (contentType, contentId, reportId) and nothing else. It
// never sends a label, a sublabel or a provenance string. That means a tampered
// payload cannot write arbitrary copy into a Saved card, and — more importantly
// for the product — the snapshot is guaranteed to match what the report actually
// says, rather than whatever the DOM happened to hold at click time.
//
// It is also why provenance is structured rather than parsed back out of display
// copy later: the report row already knows its own title and season.

import { getProductByHandle } from "./ai/naia-catalog";
import {
  IDENTITY_BEARING_FIELDS,
  isContentId,
  isTakeawaySectionKey,
  type TakeawaySectionKey,
  type TrendContentType,
} from "./trend-content-identity";
import type { SaveItemRequest } from "./saved-items";
import type { TrendReportData } from "./trend-reports";

/** What the client is allowed to send. Identifiers only — never display text. */
export interface SaveTargetRef {
  contentType: TrendContentType;
  contentId: string;
  /** Report slug — resolved to the report row server-side. */
  reportSlug?: string | null;
  /** For a nested object: the trend it was discovered under. */
  sourceContentId?: string | null;
}

export type ResolveFailure =
  | { ok: false; reason: "report_not_found" }
  | { ok: false; reason: "content_not_found" }
  | { ok: false; reason: "unsupported" };

export type ResolveResult = { ok: true; request: SaveItemRequest } | ResolveFailure;

/** Customer-facing names for the personalised-edit sections that can be saved. */
const TAKEAWAY_LABELS: Partial<Record<TakeawaySectionKey, string>> = {
  yourVersion:         "Why this matters to you",
  yourBestRouteIn:     "Your route in",
  aLookToTry:          "A look to try",
  theBalanceToProtect: "The balance to protect",
  worthInvesting:      "Worth investing in",
};

/** Finds an identified entry across the report's identity-bearing arrays. */
function findEntry(
  report: TrendReportData,
  contentId: string,
): { field: string; entry: Record<string, unknown> } | null {
  for (const field of Object.keys(IDENTITY_BEARING_FIELDS)) {
    const entries = (report as unknown as Record<string, unknown>)[field];
    if (!Array.isArray(entries)) continue;
    for (const raw of entries) {
      const entry = raw as Record<string, unknown>;
      if (entry.id === contentId) return { field, entry };
    }
  }
  return null;
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
 * `takeawayText` is supplied by the caller for TAKEAWAY saves — the personalised
 * edit is generated per customer, so only the route that built it can snapshot
 * its wording. Everything else is read from the report.
 */
export function resolveSaveTargetFromReport(
  ref: SaveTargetRef,
  report: TrendReportData | null,
  options: { takeawayText?: string | null } = {},
): ResolveResult {
  const { contentType, contentId } = ref;

  // ── Global: a NADINE piece ──────────────────────────────────────────────
  if (contentType === "PRODUCT") {
    const product = getProductByHandle(contentId);
    if (!product) return { ok: false, reason: "content_not_found" };

    const nested = report && ref.sourceContentId
      ? findEntry(report, ref.sourceContentId)
      : null;

    return {
      ok: true,
      request: {
        contentType: "PRODUCT",
        contentId,
        reportId: null, // global — the same piece saved from two reports is one object
        label: product.parsed.identity.verifiedTitle,
        sublabel: product.parsed.prose.stylingRole ?? null,
        imageUrl: product.parsed.identity.featuredImageUrl,
        sourceKind: "TREND_REPORT",
        sourceReportTitle: report?.title ?? null,
        sourceSeason: report?.season ?? null,
        sourceContentId: ref.sourceContentId ?? null,
        sourceContentLabel: nested ? String(nested.entry.name ?? nested.entry.signal ?? "") || null : null,
        sourcePath: ref.reportSlug ? `/trends/my-edits/${ref.reportSlug}` : null,
      },
    };
  }

  // Everything below needs the report.
  if (!report) return { ok: false, reason: "report_not_found" };

  const reportId = reportRowId(report);
  if (!reportId) return { ok: false, reason: "report_not_found" };

  // ── A section of the customer's own personalised edit ───────────────────
  if (contentType === "TAKEAWAY") {
    if (!isTakeawaySectionKey(contentId)) return { ok: false, reason: "content_not_found" };
    const label = TAKEAWAY_LABELS[contentId];
    if (!label) return { ok: false, reason: "unsupported" };

    return {
      ok: true,
      request: {
        contentType: "TAKEAWAY",
        contentId,
        reportId,
        label,
        sublabel: options.takeawayText ?? null,
        ...reportProvenance(report),
        sourcePath: `/trends/my-edits/${report.slug}`,
      },
    };
  }

  // ── Report content: a trend, a signal, a reference ──────────────────────
  if (contentType === "TREND" || contentType === "SIGNAL" || contentType === "REFERENCE") {
    if (!isContentId(contentId)) return { ok: false, reason: "content_not_found" };
    const found = findEntry(report, contentId);
    if (!found) return { ok: false, reason: "content_not_found" };

    const expected = IDENTITY_BEARING_FIELDS[found.field as keyof typeof IDENTITY_BEARING_FIELDS];
    if (expected !== contentType) return { ok: false, reason: "content_not_found" };

    const entry = found.entry;
    const label =
      contentType === "REFERENCE"
        ? [entry.brand, entry.collection].filter(Boolean).join(" — ")
        : String(entry.name ?? entry.signal ?? "");
    const sublabel =
      contentType === "REFERENCE"
        ? String(entry.signal ?? "")
        : String(entry.description ?? entry.why ?? "");

    return {
      ok: true,
      request: {
        contentType,
        contentId,
        reportId,
        label,
        sublabel: sublabel || null,
        ...reportProvenance(report),
        sourcePath: `/trends/${report.slug}`,
      },
    };
  }

  // FACET and LOOK are supported by the Saved architecture but have no save
  // affordance in the current report UI — see Step 3 scope.
  return { ok: false, reason: "unsupported" };
}

/**
 * The report's immutable row id.
 *
 * Deliberately refuses to fall back to the slug. A save made against a slug
 * would build a refKey that stops matching the moment the report gains a real
 * row id, silently orphaning the card. The slug-only path is the pre-seed static
 * fallback, which no seeded environment reaches — better to decline the save
 * than to create one that will break.
 */
function reportRowId(report: TrendReportData): string | null {
  return report.id ?? null;
}
