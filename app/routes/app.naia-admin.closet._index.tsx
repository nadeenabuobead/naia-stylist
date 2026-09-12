// nAia Admin — Closet Intelligence item list.
//
// Independent auth: requireNaiaAdminAccess called here, not inherited from parent.
// Nested route loaders can execute independently/in parallel (React Router v7).
//
// Columns: Thumbnail | Item name | Category | Subcategory | Analysis | Confidence
//          | Review | Formality | Occasions | Flags | Customer | Analyzed
//
// Filters: search (name OR email) | category | analysisStatus | reviewStatus
//          | formality | occasion | lowConfidence | missingMetadata

import { useLoaderData, Form, Link, useSearchParams } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { requireNaiaAdminAccess } from "~/lib/naia-admin-auth.server";
import {
  listClosetItems,
  PAGE_SIZE,
  type ClosetItemListFilters,
  type ClosetItemListResult,
  type ClosetAnalysisStatus,
  type ClosetAdminReviewFilter,
} from "~/lib/admin/closet-intelligence.server";
import type { ClosetCategory } from "@prisma/client";

const CATEGORIES: ClosetCategory[] = [
  "TOPS", "BOTTOMS", "DRESSES", "OUTERWEAR", "SHOES",
  "BAGS", "ACCESSORIES", "JEWELRY", "ACTIVEWEAR", "SWIMWEAR",
  "LOUNGEWEAR", "OTHER",
];

const ANALYSIS_STATUSES: ClosetAnalysisStatus[] = [
  "not_analyzed", "pending", "ready", "failed",
];

const REVIEW_STATUS_OPTS: Array<{ value: ClosetAdminReviewFilter; label: string }> = [
  { value: "unreviewed", label: "AI ONLY (unreviewed)" },
  { value: "reviewed",   label: "REVIEWED" },
  { value: "overridden", label: "OVERRIDDEN" },
];

const FORMALITY_OPTS = [
  "casual", "smart-casual", "business-casual", "business", "formal", "occasion",
];

const REVIEW_BADGE_CLASS: Record<string, string> = {
  "AI ONLY":   "na-badge--ai-only",
  REVIEWED:    "na-badge--reviewed",
  OVERRIDDEN:  "na-badge--overridden",
};

const ANALYSIS_BADGE_CLASS: Record<string, string> = {
  ready:        "na-badge--ready",
  failed:       "na-badge--failed",
  pending:      "na-badge--pending",
  not_analyzed: "na-badge--not-analyzed",
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requireNaiaAdminAccess(request);
  const url = new URL(request.url);

  const filters: ClosetItemListFilters = {
    search: url.searchParams.get("search") || undefined,
    category: (url.searchParams.get("category") as ClosetCategory) || undefined,
    analysisStatus: (url.searchParams.get("analysisStatus") as ClosetAnalysisStatus) || undefined,
    reviewStatus: (url.searchParams.get("reviewStatus") as ClosetAdminReviewFilter) || undefined,
    formality: url.searchParams.get("formality") || undefined,
    occasion: url.searchParams.get("occasion") || undefined,
    lowConfidence: url.searchParams.get("lowConfidence") === "1" ? true : undefined,
    missingMetadata: url.searchParams.get("missingMetadata") === "1" ? true : undefined,
  };

  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));

  const result = await listClosetItems(filters, page);
  return Response.json({ result, filters, page });
}

export default function ClosetIntelligenceList() {
  const { result, filters, page } = useLoaderData() as {
    result: ClosetItemListResult;
    filters: ClosetItemListFilters;
    page: number;
  };
  const [searchParams] = useSearchParams();

  const { items, total, pageCount } = result;

  function buildPageUrl(p: number) {
    const sp = new URLSearchParams(searchParams);
    sp.set("page", String(p));
    return `/app/naia-admin/closet?${sp.toString()}`;
  }

  const activeFilterCount = [
    filters.search, filters.category, filters.analysisStatus, filters.reviewStatus,
    filters.formality, filters.occasion, filters.lowConfidence, filters.missingMetadata,
  ].filter(Boolean).length;

  return (
    <>
      <h1 className="na-page-heading">
        Closet Intelligence
        {total > 0 && (
          <span style={{ fontSize: "14px", fontWeight: 400, color: "#6b7280", marginLeft: "0.75rem" }}>
            {total.toLocaleString()} items
          </span>
        )}
      </h1>

      <div className="na-card">
        {/* ── Filters ── */}
        <Form method="get" className="na-filters">
          {/* Row 1: main text/select filters */}
          <div className="na-filter-group">
            <label htmlFor="ci-search">Search</label>
            <input
              id="ci-search"
              name="search"
              type="search"
              defaultValue={filters.search ?? ""}
              placeholder="Name or customer email…"
            />
          </div>

          <div className="na-filter-group">
            <label htmlFor="ci-category">Category</label>
            <select id="ci-category" name="category" defaultValue={filters.category ?? ""}>
              <option value="">All categories</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <div className="na-filter-group">
            <label htmlFor="ci-formality">Formality</label>
            <select id="ci-formality" name="formality" defaultValue={filters.formality ?? ""}>
              <option value="">Any formality</option>
              {FORMALITY_OPTS.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </div>

          <div className="na-filter-group">
            <label htmlFor="ci-occasion">Occasion (contains)</label>
            <input
              id="ci-occasion"
              name="occasion"
              type="text"
              defaultValue={filters.occasion ?? ""}
              placeholder="e.g. work"
              style={{ minWidth: "120px" }}
            />
          </div>

          <div className="na-filter-group">
            <label htmlFor="ci-analysis">Analysis</label>
            <select id="ci-analysis" name="analysisStatus" defaultValue={filters.analysisStatus ?? ""}>
              <option value="">All statuses</option>
              {ANALYSIS_STATUSES.map((s) => (
                <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
              ))}
            </select>
          </div>

          <div className="na-filter-group">
            <label htmlFor="ci-review">Review</label>
            <select id="ci-review" name="reviewStatus" defaultValue={filters.reviewStatus ?? ""}>
              <option value="">All review states</option>
              {REVIEW_STATUS_OPTS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* Row 2: boolean flags */}
          <label className="na-filter-checkbox">
            <input
              type="checkbox"
              name="lowConfidence"
              value="1"
              defaultChecked={!!filters.lowConfidence}
            />
            Low confidence only
          </label>

          <label className="na-filter-checkbox">
            <input
              type="checkbox"
              name="missingMetadata"
              value="1"
              defaultChecked={!!filters.missingMetadata}
            />
            Missing metadata
          </label>

          {/* Reset page when filters change */}
          <input type="hidden" name="page" value="1" />

          <div className="na-filter-actions">
            <button type="submit" className="na-filter-btn">
              Filter{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
            </button>
            {activeFilterCount > 0 && (
              <a href="/app/naia-admin/closet" className="na-filter-btn na-filter-btn--secondary">
                Clear
              </a>
            )}
          </div>
        </Form>

        {/* ── Table ── */}
        <div className="na-table-wrap">
          {items.length === 0 ? (
            <div className="na-empty">No items match the current filters.</div>
          ) : (
            <table className="na-table">
              <thead>
                <tr>
                  <th style={{ width: "44px" }} aria-label="Thumbnail" />
                  <th>Item</th>
                  <th>Category</th>
                  <th>Subcategory</th>
                  <th>Analysis</th>
                  <th>Confidence</th>
                  <th>Review</th>
                  <th>Formality</th>
                  <th>Occasions</th>
                  <th>Flags</th>
                  <th>Customer</th>
                  <th>Analyzed</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    {/* Thumbnail */}
                    <td style={{ padding: "0.5rem 0.875rem" }}>
                      {item.thumbnailUrl ? (
                        <img
                          src={item.thumbnailUrl}
                          alt=""
                          className="na-thumb"
                          loading="lazy"
                        />
                      ) : (
                        <div className="na-thumb--placeholder" title="No thumbnail">
                          ☐
                        </div>
                      )}
                    </td>

                    {/* Name */}
                    <td>
                      <Link to={`/app/naia-admin/closet/${item.id}`}>
                        {item.name ?? <span className="na-null">Unnamed</span>}
                      </Link>
                    </td>

                    {/* Category */}
                    <td>{item.category}</td>

                    {/* Subcategory */}
                    <td>
                      {item.subcategory
                        ? <span>{item.subcategory}</span>
                        : <span className="na-null">—</span>}
                    </td>

                    {/* Analysis status */}
                    <td>
                      <span className={`na-badge ${ANALYSIS_BADGE_CLASS[item.analysisStatus] ?? "na-badge--not-analyzed"}`}>
                        {item.analysisStatus.replace(/_/g, " ")}
                      </span>
                    </td>

                    {/* Confidence */}
                    <td>
                      {item.overallConfidence
                        ? <ConfidenceDot level={item.overallConfidence} />
                        : <span className="na-null">—</span>}
                    </td>

                    {/* Review status — display label */}
                    <td>
                      <span className={`na-badge ${REVIEW_BADGE_CLASS[item.displayReviewStatus] ?? "na-badge--ai-only"}`}>
                        {item.displayReviewStatus}
                      </span>
                    </td>

                    {/* Formality */}
                    <td>
                      {item.formality
                        ? item.formality
                        : <span className="na-null">—</span>}
                    </td>

                    {/* Occasions summary */}
                    <td>
                      {item.occasions.length > 0
                        ? (
                          <span title={item.occasions.join(", ")}>
                            {item.occasions.slice(0, 2).join(", ")}
                            {item.occasions.length > 2 && (
                              <span className="na-null"> +{item.occasions.length - 2}</span>
                            )}
                          </span>
                        )
                        : <span className="na-null">—</span>}
                    </td>

                    {/* Flags */}
                    <td>
                      <span style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                        {item.lowConfidence && (
                          <span className="na-badge na-badge--low" title="Overall confidence is low">
                            LOW CONF
                          </span>
                        )}
                        {item.missingMetadata && (
                          <span className="na-badge na-badge--warn" title="Analyzed but missing subcategory, silhouette, or formality">
                            MISSING META
                          </span>
                        )}
                        {!item.lowConfidence && !item.missingMetadata && (
                          <span className="na-null">—</span>
                        )}
                      </span>
                    </td>

                    {/* Customer */}
                    <td>
                      {item.customerEmail
                        ? <span title={item.customerId}>{item.customerEmail}</span>
                        : <span className="na-null" title={item.customerId}>unknown</span>}
                    </td>

                    {/* Analyzed at */}
                    <td>
                      {item.analyzedAt
                        ? new Date(item.analyzedAt).toLocaleDateString("en-GB", {
                            day: "2-digit", month: "short", year: "numeric",
                          })
                        : <span className="na-null">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* ── Pagination ── */}
        <div className="na-pagination">
          <span>
            {total === 0
              ? "No items"
              : `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total.toLocaleString()}`}
          </span>
          <div className="na-pagination__controls">
            <a
              href={buildPageUrl(page - 1)}
              className="na-pagination__btn"
              aria-disabled={page <= 1 ? "true" : undefined}
            >
              ← Previous
            </a>
            <span style={{ padding: "0 0.5rem", lineHeight: "1.8", fontSize: "12px" }}>
              {page} / {pageCount}
            </span>
            <a
              href={buildPageUrl(page + 1)}
              className="na-pagination__btn"
              aria-disabled={page >= pageCount ? "true" : undefined}
            >
              Next →
            </a>
          </div>
        </div>
      </div>
    </>
  );
}

function ConfidenceDot({ level }: { level: string }) {
  return (
    <span className="na-conf">
      <span className={`na-conf__dot na-conf__dot--${level}`} />
      {level}
    </span>
  );
}
