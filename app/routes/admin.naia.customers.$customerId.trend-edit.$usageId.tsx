// app/routes/admin.naia.customers.$customerId.trend-edit.$usageId.tsx
//
// nAia Admin — Personalised Trend Edit detail.
// Read-only. Shows the exact stored snapshot of one generation's
// customer-facing content. For usage rows written before snapshot
// persistence existed, shows an explicit "not stored" message rather than
// reconstructing or fabricating content.
//
// Auth: requireAdminSession.

import { Link, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import {
  getAdminCustomerTrendEditDetail,
} from "~/lib/admin/customer-360.server";
import type { TrendEditSnapshot } from "~/lib/plan/personalised-trend-edit-usage.server";
import { requireAdminSession } from "~/lib/internal-auth.server";

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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: "1.25rem" }}>
      <p style={{ fontSize: "0.7rem", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.4rem" }}>{title}</p>
      <div style={{ fontSize: "0.85rem", color: "#d1d5db", lineHeight: 1.5 }}>{children}</div>
    </div>
  );
}

function ClosetItemsStrip({ items }: { items: TrendEditSnapshot["edit"]["evidenceClosetItems"] }) {
  if (!items || items.length === 0) return null;
  return (
    <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.5rem" }}>
      {items.map((it, i) => (
        <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "80px" }}>
          {it.imageUrl ? (
            <img src={it.imageUrl} alt="" style={{ width: "80px", height: "100px", objectFit: "cover", borderRadius: "4px", border: "1px solid #1f2937" }} />
          ) : (
            <div className="na-thumb--placeholder" style={{ width: "80px", height: "100px" }} />
          )}
          <span style={{ fontSize: "0.65rem", color: "#9ca3af", textAlign: "center", marginTop: "0.2rem" }}>{it.name}</span>
        </div>
      ))}
    </div>
  );
}

export default function AdminTrendEditDetailPage() {
  const { customerId, detail } = useLoaderData() as {
    customerId: string;
    detail: { hasSnapshot: boolean; snapshot: TrendEditSnapshot | null; createdAt: string };
  };
  const s = detail.snapshot;

  return (
    <div className="na-page">
      <div style={{ marginBottom: "0.75rem" }}>
        <Link to={`/admin/naia/customers/${customerId}`} style={{ fontSize: "0.78rem", color: "#6b7280", textDecoration: "none" }}>
          ← Customer
        </Link>
      </div>

      <h1 className="na-page-heading" style={{ marginBottom: "0.25rem" }}>
        {s?.reportTitle ?? "Personalised Trend Edit"}
      </h1>
      <p style={{ fontSize: "0.8rem", color: "#6b7280", marginBottom: "1.5rem" }}>
        Generated {displayDateTime(s?.generatedAt ?? detail.createdAt)}
      </p>

      {!detail.hasSnapshot || !s ? (
        <div className="na-card">
          <div className="na-card__body">
            <p className="na-provenance-unavailable">
              Historical personalised content was not stored for this generation.
            </p>
          </div>
        </div>
      ) : (
        <div className="na-card">
          <div className="na-card__body">
            <Section title="Your Version Of This Trend">{s.edit.yourVersion}</Section>
            {s.edit.subTitle && <Section title="Subtitle">{s.edit.subTitle}</Section>}

            {(s.edit.evidenceStyleDna || s.edit.evidencePassportSays || s.edit.evidenceClosetItems.length > 0 || s.edit.evidenceReviews) && (
              <Section title="Your nAia Evidence">
                {s.edit.evidenceStyleDna && <p>Style DNA: {s.edit.evidenceStyleDna}</p>}
                {s.edit.evidencePassportSays && <p>Passport: {s.edit.evidencePassportSays}</p>}
                {s.edit.evidenceReviews && <p>Reviews: {s.edit.evidenceReviews}</p>}
                <ClosetItemsStrip items={s.edit.evidenceClosetItems} />
              </Section>
            )}
            {s.edit.lowDataNotice && <Section title="Low Data Notice">{s.edit.lowDataNotice}</Section>}

            <Section title="Your Best Route In (Try)">
              {s.edit.yourBestRouteIn}
              <ClosetItemsStrip items={s.edit.routeInItems} />
            </Section>

            <Section title="A Look To Try">
              {s.edit.aLookToTry}
              <ClosetItemsStrip items={s.edit.lookToTryItems} />
            </Section>

            <Section title="The Balance To Protect">{s.edit.theBalanceToProtect}</Section>

            <Section title="Buy — The Part To Take">
              {s.edit.worthInvestingStatement ? (
                <p>{s.edit.worthInvestingStatement}</p>
              ) : (
                <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
                  {s.edit.partToTake.map((b, i) => <li key={i}>{b}</li>)}
                </ul>
              )}
            </Section>

            <Section title="Skip — The Part To Leave">
              <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
                {s.edit.partToLeave.map((b, i) => <li key={i}>{b}</li>)}
              </ul>
            </Section>

            {s.nadineRecommendation && (
              <Section title="NADINE Recommendation">
                <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
                  {s.nadineRecommendation.imageUrl && (
                    <img src={s.nadineRecommendation.imageUrl} alt="" style={{ width: "60px", height: "75px", objectFit: "cover", borderRadius: "4px" }} />
                  )}
                  <div>
                    <strong>{s.nadineRecommendation.title}</strong>
                    <p style={{ fontSize: "0.78rem", color: "#9ca3af", margin: "0.2rem 0 0" }}>
                      Fills gap: {s.nadineRecommendation.gapCategory}
                    </p>
                    <p style={{ fontSize: "0.78rem", color: "#9ca3af", margin: "0.2rem 0 0" }}>
                      {s.nadineRecommendation.personalExplanation}
                    </p>
                  </div>
                </div>
              </Section>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
