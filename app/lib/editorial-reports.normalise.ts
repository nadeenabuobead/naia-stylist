import type {
  TrendSignal,
  TrendReportReferenceCard,
  TrendReportSource,
} from "./trend-reports";

type Raw = Record<string, unknown>;

// Proven DB field names for spring-2026-soft-structure:
//   rising/fading:  { trend, why }
//   references:     { label, quote, why }
//   sources:        { label, url, date, note? }
//
// Canonical fields take priority when both exist (e.g. a row already using
// the canonical schema is not silently downgraded).

export function normaliseSignal(item: Raw): TrendSignal {
  return {
    signal: String((item.signal ?? item.trend) ?? ""),
    why:    String(item.why ?? ""),
    source: String(item.source ?? ""),
  };
}

export function normaliseReference(item: Raw): TrendReportReferenceCard {
  return {
    brand:      String((item.brand    ?? item.label)  ?? ""),
    signal:     String((item.signal   ?? item.quote)  ?? ""),
    naiaRead:   String((item.naiaRead ?? item.why)    ?? ""),
    collection: item.collection != null
      ? String(item.collection)
      : undefined,
  };
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
