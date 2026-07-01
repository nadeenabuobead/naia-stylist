import { Link, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { trendReports, type TrendReportData } from "../lib/trend-reports";
import { requireCurrentNaiaCustomer } from "../lib/naia-session.server";
import { getShopperEvidence, buildShopperEdit, type ShopperEdit, type ClosetMatchItem } from "../lib/trend-evidence.server";

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
  .tr-report-notes{padding:16px 0 0}
  .tr-report-notes-label{font-family:var(--ff-mono);font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--muted);margin-bottom:10px}
  .tr-report-notes-list{list-style:none;margin:0;padding:0}
  .tr-report-notes-list li{font-family:var(--ff-body);font-size:15px;font-style:italic;line-height:1.6;color:var(--muted);padding:8px 0}
  .tr-empty-state{padding:48px;text-align:center;border:1px solid rgba(59,5,16,.08);background:rgba(255,255,255,0.5)}
  .tr-empty-state-text{font-family:'Cormorant Garamond',serif;font-size:20px;font-style:italic;color:var(--deep);margin-bottom:20px;line-height:1.6}
  .tr-empty-state-cta{display:inline-block;padding:14px 32px;background:#221516;color:#f4f4f1;font-family:var(--ff-mono);font-size:9px;letter-spacing:2px;text-transform:uppercase;text-decoration:none}
  .tr-reading-box{padding:28px 32px;border-left:3px solid var(--accent);background:rgba(139,32,53,0.04);margin-bottom:48px}
  .tr-reading-sublabel{font-family:var(--ff-body);font-size:14px;font-style:italic;color:var(--muted);margin-bottom:16px;margin-top:4px}
  .tr-closet-cards{display:flex;gap:20px;flex-wrap:wrap;margin-top:16px}
  .tr-closet-card{flex:0 0 calc(50% - 10px);max-width:240px}
  .tr-closet-card-img{width:100%;aspect-ratio:3/4;object-fit:cover;background:rgba(59,5,16,.04)}
  .tr-closet-card-name{font-family:var(--ff-mono);font-size:9px;letter-spacing:1px;text-transform:uppercase;color:var(--accent);margin-top:10px;margin-bottom:4px}
  .tr-closet-card-note{font-family:var(--ff-body);font-size:15px;font-style:italic;color:var(--muted);line-height:1.5}
  .tr-closet-formula{font-family:var(--ff-body);font-size:16px;font-style:italic;color:var(--muted);line-height:1.7;padding:16px 0}
  .tr-cta-edit{margin-top:60px;padding:32px 0;border-top:1px solid rgba(59,5,16,.1);text-align:center}
  .tr-cta-edit-btn{display:inline-block;padding:16px 40px;background:var(--deep);color:var(--cream);font-family:var(--ff-mono);font-size:9px;letter-spacing:3px;text-transform:uppercase;text-decoration:none;cursor:pointer}
  .tr-cta-edit-sub{font-family:var(--ff-body);font-size:14px;font-style:italic;color:var(--muted);margin-top:12px}
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
  const { report, edit, hasProfile, hasCloset, generationFailed } = useLoaderData() as LoaderData;

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
            {/* 1. YOUR PERSONAL READING */}
            <div className="tr-reading-box">
              <div className="tr-section-label">YOUR PERSONAL READING</div>
              <div className="tr-reading-sublabel">What this direction means for the way you like to dress.</div>
              <p className="tr-body">{edit.personalReading}</p>
            </div>

            {/* 2. YOUR STRONGEST MATCH */}
            <div className="tr-edit-section">
              <div className="tr-section-label">YOUR STRONGEST MATCH</div>
              <p className="tr-body">{edit.strongestMatch}</p>
            </div>

            <div className="tr-divider" />

            {/* 3. ADAPT, DON'T COPY */}
            <div className="tr-edit-section">
              <div className="tr-section-label">ADAPT, DON&apos;T COPY</div>
              <p className="tr-body">{edit.adaptDontCopy}</p>
            </div>

            {/* 4. LESS USEFUL FOR YOU — conditional */}
            {edit.lessUseful && (
              <div className="tr-edit-section">
                <div className="tr-section-label">LESS USEFUL FOR YOU</div>
                <p className="tr-body">{edit.lessUseful}</p>
              </div>
            )}

            <div className="tr-divider" />

            {/* 5. FROM YOUR CLOSET */}
            <div className="tr-edit-section">
              <div className="tr-section-label">FROM YOUR CLOSET</div>
              {edit.fromCloset.length > 0 ? (
                <div className="tr-closet-cards">
                  {edit.fromCloset.map((item: ClosetMatchItem, i: number) => (
                    <div key={i} className="tr-closet-card">
                      {item.imageUrl && (
                        <img
                          src={item.imageUrl}
                          alt={item.name}
                          className="tr-closet-card-img"
                        />
                      )}
                      <div className="tr-closet-card-name">{item.name}</div>
                      <p className="tr-closet-card-note">{item.outfitNote}</p>
                    </div>
                  ))}
                </div>
              ) : edit.fromClosetFormula ? (
                <p className="tr-closet-formula">{edit.fromClosetFormula}</p>
              ) : hasCloset ? (
                <p className="tr-body">
                  No clear match in your Closet for this direction yet. The look to try below works without one.
                </p>
              ) : (
                <p className="tr-body">
                  Add pieces to your Closet to see what you already own that works with this direction.
                </p>
              )}
            </div>

            <div className="tr-divider" />

            {/* 6. ONE LOOK TO TRY THIS WEEK */}
            <div className="tr-edit-section">
              <div className="tr-section-label">ONE LOOK TO TRY THIS WEEK</div>
              <p className="tr-body">{edit.oneLookToTry}</p>
            </div>

            {/* 7. ONE PIECE THAT WOULD UNLOCK MORE — conditional */}
            {edit.oneUnlockPiece && (
              <div className="tr-edit-section">
                <div className="tr-section-label">ONE PIECE THAT WOULD UNLOCK MORE</div>
                <p className="tr-body">{edit.oneUnlockPiece}</p>
              </div>
            )}

            {/* 8. CTA */}
            <div className="tr-cta-edit">
              <Link to="/closet" className="tr-cta-edit-btn">
                OPEN MY CLOSET →
              </Link>
              <p className="tr-cta-edit-sub">See the pieces you already own that could work with this direction.</p>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
