// app/lib/editorial-report-edition.ts
//
// Pure, universal logic for a report's effective editorial edition — safe
// to import from both server loaders AND route components (unlike
// editorial-reports.server.ts, which touches prisma and is stripped from
// the client bundle). Separated out specifically because React Router's
// build rejects a .server module imported by a route's default export
// (the component), not just its loader/action — see trends.jsx, which
// calls formatEditionMonthLabel directly while rendering.

export type EditionPeriodInput = {
  editionMonth?: string | null;
  publishedAt: string;
};

const PERIOD_KEY_RE = /^\d{4}-\d{2}$/;
const PUBLISHED_AT_DATE_RE = /^(\d{4}-\d{2})-\d{2}$/;

// The customer-facing editorial month a report belongs to — editionMonth
// when a genuine one has been set, falling back to publishedAt's own month
// for a report (static fixture or DB row) written before this field
// existed. Never fabricates a date: a report with neither a valid
// editionMonth nor a parseable publishedAt returns null, same as before
// this field existed. Shared by every surface that shows a report's month
// (My Trend Edits grouping, the public landing page, the report page, its
// lens variant) so none of them can drift from the others.
export function getEffectiveEditionPeriod(report: EditionPeriodInput): string | null {
  if (report.editionMonth && PERIOD_KEY_RE.test(report.editionMonth)) {
    return report.editionMonth;
  }
  const match = PUBLISHED_AT_DATE_RE.exec(report.publishedAt);
  return match ? match[1] : null;
}

// "2026-04" -> "April 2026". Falls back to the raw string (or "Undated")
// rather than throwing — a malformed or missing period must never break
// the page that's trying to show it.
export function formatEditionMonthLabel(periodKey: string | null): string {
  if (!periodKey || !PERIOD_KEY_RE.test(periodKey)) return periodKey || "Undated";
  const [yearStr, monthStr] = periodKey.split("-");
  const asDate = new Date(Date.UTC(Number(yearStr), Number(monthStr) - 1, 1));
  return asDate.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}
