// app/routes/admin.naia.customers.$customerId.trend-edit.$usageId.tsx
//
// nAia Admin — Personalised Trend Edit detail.
// Read-only. Renders the exact stored snapshot of one generation's
// customer-facing content using the SAME report-body component the
// customer's own My Trend Edits page renders (TrendEditReportBody) — so
// Admin can never drift from what the customer actually saw. Admin-only
// chrome (back link, generated-date/period line) replaces the customer
// page's chrome (hero tint, copy-link/download actions, footer CTA); no
// customer-only action is rendered here. For usage rows written before
// snapshot persistence existed, shows an explicit "not stored" message
// rather than reconstructing or fabricating content.
//
// Auth: requireAdminSession.

import { Link, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import {
  getAdminCustomerTrendEditDetail,
  type AdminTrendEditDetail,
} from "~/lib/admin/customer-360.server";
import { requireAdminSession } from "~/lib/internal-auth.server";
import TrendEditReportBody, { TREND_EDIT_REPORT_BODY_CSS } from "~/components/trends/TrendEditReportBody";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireAdminSession(request);
  const { customerId, usageId } = params;
  if (!customerId || !usageId) throw new Response("Not found", { status: 404 });
  // Scoped to customerId — a usage row belonging to a different customer
  // returns null here, never the record, so a guessed/stale URL can't leak it.
  const detail = await getAdminCustomerTrendEditDetail(customerId, usageId);
  if (!detail) throw new Response("Not found", { status: 404 });
  return Response.json({ customerId, detail });
}

function displayDateTime(d: Date | string): string {
  return new Date(d).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export default function AdminTrendEditDetailPage() {
  const { customerId, detail } = useLoaderData() as {
    customerId: string;
    detail: AdminTrendEditDetail & { createdAt: string };
  };
  const s = detail.snapshot;

  return (
    <div className="na-page">
      <style>{TREND_EDIT_REPORT_BODY_CSS}</style>
      <div style={{ marginBottom: "0.75rem" }}>
        <Link to={`/admin/naia/customers/${customerId}`} style={{ fontSize: "0.78rem", color: "#6b7280", textDecoration: "none" }}>
          ← Customer
        </Link>
      </div>

      <h1 className="na-page-heading" style={{ marginBottom: "0.25rem" }}>
        {detail.reportTitle}
      </h1>
      <p style={{ fontSize: "0.8rem", color: "#6b7280", marginBottom: "1.5rem" }}>
        {detail.reportSeason && `${detail.reportSeason} · `}
        Generated {displayDateTime(s?.generatedAt ?? detail.createdAt)}
        {detail.periodLabel && ` · Period: ${detail.periodLabel}`}
      </p>

      {!detail.hasSnapshot || !s ? (
        <div className="na-card">
          <div className="na-card__body">
            <p style={{ fontSize: "0.85rem", color: "#6b7280", lineHeight: 1.6, margin: 0 }}>
              Historical personalised content wasn't stored for this generation.
            </p>
            <p style={{ fontSize: "0.78rem", color: "#9ca3af", lineHeight: 1.6, margin: "0.6rem 0 0" }}>
              Full personalised Trend Edit history is available for generations created after snapshot storage was introduced.
            </p>
          </div>
        </div>
      ) : (
        <div className="na-card">
          <div className="na-card__body" style={{ color: "#1a1109", background: "#f5f0e8", padding: "1.5rem" }}>
            <TrendEditReportBody edit={s.edit} nadineRecommendation={s.nadineRecommendation} />
          </div>
        </div>
      )}
    </div>
  );
}
