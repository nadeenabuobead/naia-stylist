import type {
  TrendSignal,
  TrendReportReferenceCard,
  TrendReportSource,
} from "./trend-reports";
import { isContentId } from "./trend-content-identity";
import { validateFacets, isEmptyFacets } from "./trend-facets";

type Raw = Record<string, unknown>;

// Identity and facets are carried through verbatim. These normalisers exist to
// reconcile legacy DB field names, and they rebuild each object from scratch —
// so anything not copied here is silently dropped. A dropped id orphans every
// SavedItem pointing at it, which is why these two lines matter.
function carryIdentity<T>(item: Raw, normalised: T): T {
  const out = normalised as T & { id?: string; facets?: unknown };
  if (isContentId(item.id)) out.id = item.id as string;
  const { facets } = validateFacets(item.facets);
  if (!isEmptyFacets(facets)) out.facets = facets;
  return out;
}

// Proven DB field names for spring-2026-soft-structure:
//   rising/fading:  { trend, why }
//   references:     { label, quote, why }
//   sources:        { label, url, date, note? }
//
// Canonical fields take priority when both exist (e.g. a row already using
// the canonical schema is not silently downgraded).

export function normaliseSignal(item: Raw): TrendSignal {
  return carryIdentity(item, {
    signal: String((item.signal ?? item.trend) ?? ""),
    why:    String(item.why ?? ""),
    source: String(item.source ?? ""),
  });
}

export function normaliseReference(item: Raw): TrendReportReferenceCard {
  return carryIdentity(item, {
    brand:      String((item.brand    ?? item.label)  ?? ""),
    signal:     String((item.signal   ?? item.quote)  ?? ""),
    naiaRead:   String((item.naiaRead ?? item.why)    ?? ""),
    collection: item.collection != null
      ? String(item.collection)
      : undefined,
  });
}

export function normaliseSource(item: Raw): TrendReportSource {
  const label     = String(item.label ?? "");
  const publisher = String((item.publisher ?? label) ?? "");
  const rawTitle  = item.title != null ? String(item.title) : "";
  return {
    publisher,
    // When no distinct article title exists, title === publisher.
    // The renderer and PDF both de-dup on publisher === title.
    title:       rawTitle || publisher,
    url:         String(item.url ?? ""),
    publishedAt: (item.publishedAt ?? item.date) != null
      ? String(item.publishedAt ?? item.date)
      : undefined,
    descriptor:  (item.descriptor ?? item.note) != null
      ? String(item.descriptor ?? item.note)
      : undefined,
  };
}

// Filter predicates — drop rows that have no displayable content.
export const signalHasContent = (s: TrendSignal) => s.signal !== "";
export const referenceHasContent = (r: TrendReportReferenceCard) =>
  r.brand !== "" || r.signal !== "";
export const sourceHasContent = (s: TrendReportSource) => s.url !== "";
