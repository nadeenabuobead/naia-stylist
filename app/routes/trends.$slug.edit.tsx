import { Link, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { trendReports, type TrendReportData } from "../lib/trend-reports";
import { requireCurrentNaiaCustomer } from "../lib/naia-session.server";
import { getShopperEvidence, buildShopperEdit, type ShopperEdit, type EvidenceClosetItem } from "../lib/trend-evidence.server";

type LoaderData = {
  report: TrendReportData;
  edit: ShopperEdit | null;
  hasProfile: boolean;
  generationFailed: boolean;
};

export async function loader({ request, params }: LoaderFunctionArgs) {
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
      generationFailed: false,
    } satisfies LoaderData;
  } catch (error) {
    console.error("Shopper trend edit generation failed:", error);
    return {
      report,
      edit: null,
      hasProfile: false,
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
  .tr-subtitle{font-family:var(--ff-mono);font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--muted);margin-top:6px;margin-bottom:40px}
  .tr-edit-section{margin-bottom:40px}
  .tr-reading-box{padding:28px 32px;border-left:3px solid var(--accent);background:rgba(139,32,53,0.04);margin-bottom:48px}
  .tr-bullet-list{list-style:none;margin:0;padding:0}
  .tr-bullet-list li{font-family:var(--ff-body);font-size:17px;line-height:1.7;color:var(--deep);padding:10px 0 10px 20px;position:relative;border-bottom:1px solid rgba(59,5,16,.06)}
  .tr-bullet-list li::before{content:"—";position:absolute;left:0;color:var(--accent)}
  .tr-evidence-block{margin-bottom:32px}
  .tr-evidence-label{font-family:var(--ff-mono);font-size:8px;letter-spacing:2px;text-transform:uppercase;color:var(--muted);margin-bottom:12px}
  .tr-closet-cards{display:flex;gap:20px;flex-wrap:wrap;margin-top:12px}
  .tr-closet-card{flex:0 0 calc(50% - 10px);max-width:240px}
  .tr-closet-card-img{width:100%;aspect-ratio:3/4;object-fit:cover;background:rgba(59,5,16,.04)}
  .tr-closet-card-name{font-family:var(--ff-mono);font-size:9px;letter-spacing:1px;text-transform:uppercase;color:var(--accent);margin-top:10px;margin-bottom:4px}
  .tr-closet-card-note{font-family:var(--ff-body);font-size:15px;font-style:italic;color:var(--muted);line-height:1.5}
  .tr-evidence-panel{padding:28px 32px;border:1px solid rgba(139,32,53,0.12);background:rgba(255,255,255,0.4);margin-top:16px}
  .tr-evidence-panel-row+.tr-evidence-panel-row{border-top:1px solid rgba(59,5,16,.06);padding-top:20px;margin-top:20px}
  .tr-cta-edit{margin-top:60px;padding:32px 0;border-top:1px solid rgba(59,5,16,.1);text-align:center}
  .tr-cta-edit-btn{display:inline-block;padding:16px 40px;background:var(--deep);color:var(--cream);font-family:var(--ff-mono);font-size:9px;letter-spacing:3px;text-transform:uppercase;text-decoration:none;cursor:pointer}
  .tr-cta-edit-sub{font-family:var(--ff-body);font-size:14px;font-style:italic;color:var(--muted);margin-top:12px}
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
  const { report, edit, hasProfile, generationFailed } = useLoaderData() as LoaderData;

  return (
    <div style={{ minHeight: "100vh", background: "#f4f4f1" }}>
      <style>{css}</style>
      <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,900&family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />

      <div className="tr-topbar">
        <div className="tr-topbar-logo">nAia</div>
        <Link to="/trends" className="tr-topbar-link">← All Reports</Link>
      </div>

      <div className="tr-wrap">
        <div className="tr-recap">
          <div className="tr-recap-season">{report.season}</div>
          <div className="tr-recap-title">{report.title}</div>
          <p className="tr-recap-summary">{report.summary}</p>
          <Link to={`/trends/${report.slug}`} className="tr-recap-link">Read the full report →</Link>
        </div>

        <h1 style={{ fontFamily: "'Playfair Display',serif", fontSize: "clamp(28px,4vw,40px)", fontWeight: 900, fontStyle: "italic", marginBottom: "6px" }}>
          My nAia Trend Edit
        </h1>

        {edit && (
          <p className="tr-subtitle">{edit.subTitle}</p>
        )}

        {generationFailed ? (
          <div className="tr-empty-state">
            <p className="tr-empty-state-text">
              Your nAia Edit is taking a moment. Please try again shortly.
            </p>
            <Link to={`/trends/${report.slug}`} className="tr-empty-state-cta">
              Back to the report →
            </Link>
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
            {/* 1. WHY THIS MATTERS TO YOU */}
            <div className="tr-reading-box">
              <div className="tr-section-label">WHY THIS MATTERS TO YOU</div>
              <p className="tr-body">{edit.yourVersion}</p>
            </div>

            <div className="tr-divider" />

            {/* 2. YOUR nAia EVIDENCE — only when at least one source is available */}
            {(edit.evidenceStyleDna || edit.evidencePassportSays || edit.evidenceClosetItems.length > 0 || edit.evidenceReviews) && (
              <>
                <div className="tr-edit-section">
                  <div className="tr-section-label">YOUR nAia EVIDENCE</div>
                  <div className="tr-evidence-panel">
                    {edit.evidenceStyleDna && (
                      <div className="tr-evidence-panel-row">
                        <div className="tr-evidence-label">YOUR STYLE DNA SAYS</div>
                        <p className="tr-body" style={{ fontSize: "16px" }}>{edit.evidenceStyleDna}</p>
                      </div>
                    )}
                    {edit.evidencePassportSays && (
                      <div className="tr-evidence-panel-row">
                        <div className="tr-evidence-label">YOUR PASSPORT SAYS</div>
                        <p className="tr-body" style={{ fontSize: "16px" }}>{edit.evidencePassportSays}</p>
                      </div>
                    )}
                    {edit.evidenceClosetItems.length > 0 && (
                      <div className="tr-evidence-panel-row">
                        <div className="tr-evidence-label">YOUR CLOSET SHOWS</div>
                        <div className="tr-closet-cards">
                          {edit.evidenceClosetItems.map((item: EvidenceClosetItem, i: number) => (
                            <div key={i} className="tr-closet-card">
                              {item.imageUrl && (
                                <img src={item.imageUrl} alt={item.name} className="tr-closet-card-img" />
                              )}
                              <div className="tr-closet-card-name">{item.name}</div>
                              <p className="tr-closet-card-note">{item.roleNote}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {edit.evidenceReviews && (
                      <div className="tr-evidence-panel-row">
                        <div className="tr-evidence-label">YOUR REVIEWS SUGGEST</div>
                        <p className="tr-body" style={{ fontSize: "16px" }}>{edit.evidenceReviews}</p>
                      </div>
                    )}
                  </div>
                  {edit.lowDataNotice && (
                    <p style={{ fontFamily: "var(--ff-body)", fontSize: "14px", fontStyle: "italic", color: "var(--muted)", marginTop: "16px" }}>
                      {edit.lowDataNotice}
                    </p>
                  )}
                </div>
                <div className="tr-divider" />
              </>
            )}

            {/* 3. YOUR ROUTE IN */}
            <div className="tr-edit-section">
              <div className="tr-section-label">YOUR ROUTE IN</div>
              <p className="tr-body">{edit.yourBestRouteIn}</p>
            </div>

            {/* 4. A LOOK TO TRY */}
            <div className="tr-edit-section">
              <div className="tr-section-label">A LOOK TO TRY</div>
              <p className="tr-body">{edit.aLookToTry}</p>
            </div>

            <div className="tr-divider" />

            {/* 5. WORTH INVESTING IN */}
            <div className="tr-edit-section">
              <div className="tr-section-label">WORTH INVESTING IN</div>
              <ul className="tr-bullet-list">
                {edit.partToTake.map((bullet: string, i: number) => (
                  <li key={i}>{bullet}</li>
                ))}
              </ul>
            </div>

            {/* 6. HOLD OFF ON */}
            <div className="tr-edit-section">
              <div className="tr-section-label">HOLD OFF ON</div>
              <p className="tr-body" style={{ marginBottom: "16px" }}>{edit.theBalanceToProtect}</p>
              <ul className="tr-bullet-list">
                {edit.partToLeave.map((bullet: string, i: number) => (
                  <li key={i}>{bullet}</li>
                ))}
              </ul>
            </div>

            {/* CTA */}
            <div className="tr-cta-edit">
              <Link to="/closet" className="tr-cta-edit-btn">
                OPEN MY CLOSET →
              </Link>
              <p className="tr-cta-edit-sub">Add your most-worn pieces to your Closet and rate your outfits so nAia can build a sharper edit around your real style world.</p>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
