import { Link, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { trendReports, type TrendReportData } from "../lib/trend-reports";
import { requireCurrentNaiaCustomer } from "../lib/naia-session.server";
import { getShopperEvidence, buildShopperEdit, type ShopperEdit } from "../lib/trend-evidence.server";

type LoaderData = {
  report: TrendReportData;
  edit: ShopperEdit | null;
  hasProfile: boolean;
  hasCloset: boolean;
  reviewCount: number;
  generationFailed: boolean;
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  // Auth first, before any report lookup — so an unauthenticated visitor's
  // experience never differs based on whether a given slug exists.
  const customer = await requireCurrentNaiaCustomer(request);

  const report = trendReports.find((r) => r.slug === params.slug && r.published);
  if (!report) {
    throw new Response("Not Found", { status: 404 });
  }

  try {
    const evidence = await getShopperEvidence(customer.id);
    const edit = evidence.hasProfile ? buildShopperEdit(report, evidence) : null;

    return {
      report,
      edit,
      hasProfile: evidence.hasProfile,
      hasCloset: evidence.closetItems.length > 0,
      reviewCount: evidence.reviewSignal.reviewCount,
      generationFailed: false,
    } satisfies LoaderData;
  } catch (error) {
    console.error("Shopper trend edit generation failed:", error);
    return {
      report,
      edit: null,
      hasProfile: false,
      hasCloset: false,
      reviewCount: 0,
      generationFailed: true,
    } satisfies LoaderData;
  }
}

export function meta({ data }: { data?: LoaderData }) {
  if (!data?.report) {
    return [{ title: "Report Not Found | nAia Trend Reports" }];
  }
  return [{ title: `My nAia Trend Edit — ${data.report.title}` }];
}

function formatList(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

const css = `
  :root{--cream:#f4f4f1;--warm:#e1dbd7;--deep:#221516;--accent:#8b2035;--muted:#7a6f6a;--ff-display:'Playfair Display',Georgia,serif;--ff-body:'Cormorant Garamond',Garamond,serif;--ff-mono:'Space Mono','Courier New',monospace}
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:var(--cream);color:var(--deep);font-family:var(--ff-body);-webkit-font-smoothing:antialiased}
  .tr-topbar{display:flex;justify-content:space-between;align-items:center;padding:20px 40px;border-bottom:1px solid rgba(59,5,16,.06)}
  .tr-topbar-logo{font-family:var(--ff-display);font-size:22px;font-style:italic;letter-spacing:3px;color:var(--deep)}
  .tr-topbar-link{font-family:var(--ff-mono);font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--accent);text-decoration:none}
  .tr-wrap{max-width:900px;margin:0 auto;padding:60px 40px}
  .tr-section-label{font-family:var(--ff-mono);font-size:9px;letter-spacing:3px;text-transform:uppercase;color:var(--accent);margin-bottom:16px}
  .tr-body{font-family:var(--ff-body);font-size:18px;line-height:1.8;color:var(--deep)}
  .tr-divider{height:1px;background:rgba(59,5,16,.08);margin:40px 0}
  .tr-recap{padding:24px;border:1px solid rgba(59,5,16,.08);background:rgba(255,255,255,0.5);margin-bottom:48px}
  .tr-recap-season{font-family:var(--ff-mono);font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--accent);margin-bottom:8px}
  .tr-recap-title{font-family:var(--ff-display);font-size:22px;font-weight:700;font-style:italic;margin-bottom:8px}
  .tr-recap-summary{font-family:var(--ff-body);font-size:15px;font-style:italic;color:var(--muted);margin-bottom:12px}
  .tr-recap-link{font-family:var(--ff-mono);font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--accent);text-decoration:none}
  .tr-edit-banner{background:rgba(139,32,53,0.04);border-left:3px solid var(--accent);padding:24px 32px;margin-bottom:40px}
  .tr-edit-banner-label{font-family:var(--ff-mono);font-size:9px;letter-spacing:3px;text-transform:uppercase;color:var(--accent);margin-bottom:8px}
  .tr-edit-banner-text{font-family:var(--ff-body);font-size:15px;font-style:italic;color:var(--deep);line-height:1.6}
  .tr-edit-section{margin-bottom:40px}
  .tr-edit-list{list-style:none;margin:0;padding:0}
  .tr-edit-list li{font-family:var(--ff-body);font-size:17px;line-height:1.7;color:var(--deep);padding:14px 0;border-bottom:1px solid rgba(59,5,16,.06)}
  .tr-edit-note{font-family:var(--ff-mono);font-size:10px;letter-spacing:1px;color:var(--muted);margin-top:8px}
  .tr-empty-state{padding:48px;text-align:center;border:1px solid rgba(59,5,16,.08);background:rgba(255,255,255,0.5)}
  .tr-empty-state-text{font-family:'Cormorant Garamond',serif;font-size:20px;font-style:italic;color:var(--deep);margin-bottom:20px;line-height:1.6}
  .tr-empty-state-cta{display:inline-block;padding:14px 32px;background:#221516;color:#f4f4f1;font-family:var(--ff-mono);font-size:9px;letter-spacing:2px;text-transform:uppercase;text-decoration:none}
`;

export function ErrorBoundary() {
  return (
    <div style={{ minHeight: "100vh", background: "#f4f4f1" }}>
      <style>{css}</style>
      <div className="tr-topbar">
        <div className="tr-topbar-logo">nAia</div>
        <Link to="/trends" className="tr-topbar-link">← All Reports</Link>
      </div>
      <div className="tr-wrap">
        <p style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "20px", fontStyle: "italic", color: "#7a6f6a" }}>
          This report could not be found.
        </p>
      </div>
    </div>
  );
}

export default function TrendEdit() {
  const { report, edit, hasProfile, hasCloset, reviewCount, generationFailed } = useLoaderData() as LoaderData;

  return (
    <div style={{ minHeight: "100vh", background: "#f4f4f1" }}>
      <style>{css}</style>
      <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,900&family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />

      <div className="tr-topbar">
        <div className="tr-topbar-logo">nAia</div>
        <Link to="/trends" className="tr-topbar-link">← All Reports</Link>
      </div>

      <div className="tr-wrap">
        {/* From the Report — short recap, not a duplicate of the full report */}
        <div className="tr-recap">
          <div className="tr-recap-season">{report.season}</div>
          <div className="tr-recap-title">{report.title}</div>
          <p className="tr-recap-summary">{report.summary}</p>
          <Link to={`/trends/${report.slug}`} className="tr-recap-link">Read the full report →</Link>
        </div>

        <h1 style={{ fontFamily: "'Playfair Display',serif", fontSize: "clamp(28px,4vw,40px)", fontWeight: 900, fontStyle: "italic", marginBottom: "12px" }}>
          My nAia Trend Edit
        </h1>

        {generationFailed ? (
          <div className="tr-empty-state">
            <p className="tr-empty-state-text">
              We couldn&apos;t build your personal edit right now. The full report above is still yours to read — try revisiting this page in a moment.
            </p>
          </div>
        ) : !hasProfile ? (
          <div className="tr-empty-state">
            <p className="tr-empty-state-text">
              Your nAia Edit reads this report through your Passport — and yours isn&apos;t complete yet. Finish it to see what this direction means for you specifically.
            </p>
            <Link to="/passport" className="tr-empty-state-cta">Complete Your Passport</Link>
          </div>
        ) : edit ? (
          <>
            <div className="tr-edit-banner">
              <div className="tr-edit-banner-label">nAia&apos;s Interpretation, Based on Your Own Style Data</div>
              <p className="tr-edit-banner-text">
                {edit.contributedEvidence.length > 0
                  ? `Built from ${formatList(edit.contributedEvidence)} — not a second generic trend report.`
                  : "This is the report read alongside your Passport — nothing specific matched yet, so treat this as a starting point rather than a tailored read."}
              </p>
            </div>

            <div className="tr-edit-section">
              <div className="tr-section-label">What Suits You</div>
              <ul className="tr-edit-list">
                {edit.whatSuitsYou.map((line, i) => <li key={i}>{line}</li>)}
              </ul>
            </div>

            <div className="tr-edit-section">
              <div className="tr-section-label">What to Approach Carefully</div>
              <ul className="tr-edit-list">
                {edit.approachCarefully.map((line, i) => <li key={i}>{line}</li>)}
              </ul>
              {edit.approachCarefullySource === "report-only" && (
                <p className="tr-edit-note">
                  {reviewCount === 0
                    ? "Based on the report's own direction — you haven't rated any looks yet, so this isn't personal advice yet."
                    : "Based on the report's own direction — none of your rated looks overlapped with this particular trend."}
                </p>
              )}
            </div>

            <div className="tr-edit-section">
              <div className="tr-section-label">Your Colour & Silhouette Read</div>
              <ul className="tr-edit-list">
                {edit.colourSilhouetteRead.map((line, i) => <li key={i}>{line}</li>)}
              </ul>
            </div>

            <div className="tr-edit-section">
              <div className="tr-section-label">From Your Closet</div>
              {edit.fromCloset.length > 0 || edit.fromSavedLooks.length > 0 ? (
                <ul className="tr-edit-list">
                  {edit.fromCloset.map((line, i) => <li key={`c${i}`}>{line}</li>)}
                  {edit.fromSavedLooks.map((line, i) => <li key={`s${i}`}>{line}</li>)}
                </ul>
              ) : hasCloset ? (
                <p className="tr-body">None of your saved Closet pieces or looks line up with this direction yet — see &quot;One Next Step&quot; below.</p>
              ) : (
                <p className="tr-body">You haven&apos;t saved any Closet items yet, so this section can&apos;t point to anything specific yet. Add a few pieces to unlock it.</p>
              )}
            </div>

            <div className="tr-divider" />

            <div className="tr-edit-section">
              <div className="tr-section-label">One Next Step</div>
              <p className="tr-body">{edit.nextStep}</p>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
