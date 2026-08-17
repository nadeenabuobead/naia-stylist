import type { LinksFunction, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { requireCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { trendReports, type TrendReportData } from "~/lib/trend-reports";
import {
  getShopperEvidence,
  buildShopperEdit,
  type ShopperEdit,
  type EvidenceClosetItem,
} from "~/lib/trend-evidence.server";
import MyNaiaLayout from "~/components/my-naia/MyNaiaLayout";
import naiaStyles from "~/styles/naia-design-system.css?url";

type LoaderData = {
  report: TrendReportData;
  edit: ShopperEdit | null;
  hasProfile: boolean;
  generationFailed: boolean;
};

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: naiaStyles },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,200;0,400;1,200;1,400&family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300;1,400&family=Space+Mono&display=swap",
  },
];

export function meta({ data }: { data?: LoaderData }) {
  if (!data?.report) return [{ title: "Report Not Found | My nAia" }];
  return [{ title: `My Edit — ${data.report.title} | My nAia` }];
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const customer = await requireCurrentNaiaCustomer(request);

  const report = trendReports.find((r) => r.slug === params.slug && r.published);
  if (!report) throw new Response("Not Found", { status: 404 });

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

const css = `
  .te-detail-page { padding: 40px 0 96px; }

  .te-back {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: 'Space Mono', monospace;
    font-size: 0.58rem;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    color: #7a1e28;
    text-decoration: none;
    margin-bottom: 40px;
  }
  .te-back:hover { opacity: 0.75; }

  .te-recap {
    padding: 24px 28px;
    border: 1px solid rgba(26,17,9,0.08);
    background: rgba(255,255,255,0.45);
    margin-bottom: 48px;
  }
  .te-recap-season {
    font-family: 'Space Mono', monospace;
    font-size: 0.55rem;
    letter-spacing: 0.26em;
    text-transform: uppercase;
    color: #7a1e28;
    margin-bottom: 8px;
  }
  .te-recap-title {
    font-family: 'Playfair Display', serif;
    font-size: 1.3rem;
    font-weight: 400;
    font-style: italic;
    color: #1a1109;
    margin-bottom: 8px;
    line-height: 1.2;
  }
  .te-recap-summary {
    font-family: 'Cormorant Garamond', serif;
    font-size: 0.95rem;
    font-style: italic;
    color: rgba(26,17,9,0.60);
    line-height: 1.6;
    margin-bottom: 14px;
  }
  .te-recap-link {
    font-family: 'Space Mono', monospace;
    font-size: 0.55rem;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: #7a1e28;
    text-decoration: none;
  }
  .te-recap-link:hover { opacity: 0.75; }

  .te-headline {
    font-family: 'Playfair Display', serif;
    font-size: clamp(2rem, 5vw, 3rem);
    font-weight: 200;
    line-height: 0.95;
    color: #1a1109;
    margin-bottom: 10px;
  }
  .te-headline-accent { font-style: italic; color: #7a1e28; }

  .te-subtitle {
    font-family: 'Space Mono', monospace;
    font-size: 0.6rem;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: rgba(26,17,9,0.50);
    margin-bottom: 44px;
  }

  .te-divider { height: 1px; background: rgba(26,17,9,0.10); margin: 36px 0; }

  .te-section-label {
    font-family: 'Space Mono', monospace;
    font-size: 0.55rem;
    letter-spacing: 0.30em;
    text-transform: uppercase;
    color: #7a1e28;
    margin-bottom: 16px;
  }

  .te-body {
    font-family: 'Cormorant Garamond', serif;
    font-size: 1.1rem;
    line-height: 1.8;
    color: #1a1109;
  }

  .te-reading-box {
    padding: 28px 32px;
    border-left: 3px solid #7a1e28;
    background: rgba(122,30,40,0.04);
    margin-bottom: 44px;
  }

  .te-section { margin-bottom: 36px; }

  .te-evidence-panel {
    padding: 28px 32px;
    border: 1px solid rgba(122,30,40,0.12);
    background: rgba(255,255,255,0.40);
  }
  .te-evidence-row + .te-evidence-row {
    border-top: 1px solid rgba(26,17,9,0.06);
    padding-top: 20px;
    margin-top: 20px;
  }
  .te-evidence-label {
    font-family: 'Space Mono', monospace;
    font-size: 0.5rem;
    letter-spacing: 0.24em;
    text-transform: uppercase;
    color: rgba(26,17,9,0.45);
    margin-bottom: 12px;
  }

  .te-closet-grid {
    display: flex;
    gap: 18px;
    flex-wrap: wrap;
    margin-top: 10px;
  }
  .te-closet-item { flex: 0 0 calc(50% - 9px); max-width: 200px; }
  .te-closet-img {
    width: 100%;
    aspect-ratio: 3/4;
    object-fit: cover;
    background: rgba(26,17,9,0.04);
  }
  .te-closet-name {
    font-family: 'Space Mono', monospace;
    font-size: 0.5rem;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: #7a1e28;
    margin-top: 8px;
    margin-bottom: 4px;
  }
  .te-closet-note {
    font-family: 'Cormorant Garamond', serif;
    font-size: 0.9rem;
    font-style: italic;
    color: rgba(26,17,9,0.60);
    line-height: 1.5;
  }

  .te-low-data-notice {
    font-family: 'Cormorant Garamond', serif;
    font-size: 0.88rem;
    font-style: italic;
    color: rgba(26,17,9,0.50);
    margin-top: 14px;
    line-height: 1.6;
  }

  .te-bullet-list { list-style: none; margin: 0; padding: 0; }
  .te-bullet-list li {
    font-family: 'Cormorant Garamond', serif;
    font-size: 1.05rem;
    line-height: 1.7;
    color: #1a1109;
    padding: 10px 0 10px 22px;
    position: relative;
    border-bottom: 1px solid rgba(26,17,9,0.06);
  }
  .te-bullet-list li::before {
    content: '—';
    position: absolute;
    left: 0;
    color: #7a1e28;
  }

  .te-state-box {
    padding: 48px 40px;
    border: 1px solid rgba(26,17,9,0.08);
    background: rgba(255,255,255,0.45);
    text-align: center;
    margin-top: 8px;
  }
  .te-state-text {
    font-family: 'Cormorant Garamond', serif;
    font-size: 1.2rem;
    font-style: italic;
    color: #1a1109;
    line-height: 1.65;
    margin-bottom: 24px;
    max-width: 32rem;
    margin-left: auto;
    margin-right: auto;
  }
  .te-state-cta {
    display: inline-block;
    padding: 13px 30px;
    background: #1a1109;
    color: #f5f0e8;
    font-family: 'Space Mono', monospace;
    font-size: 0.6rem;
    letter-spacing: 0.26em;
    text-transform: uppercase;
    text-decoration: none;
  }
  .te-state-cta:hover { opacity: 0.85; }

  .te-footer-cta {
    margin-top: 60px;
    padding-top: 32px;
    border-top: 1px solid rgba(26,17,9,0.10);
    text-align: center;
  }
  .te-footer-cta-btn {
    display: inline-block;
    padding: 15px 36px;
    background: #1a1109;
    color: #f5f0e8;
    font-family: 'Space Mono', monospace;
    font-size: 0.58rem;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    text-decoration: none;
  }
  .te-footer-cta-btn:hover { opacity: 0.85; }
  .te-footer-cta-note {
    font-family: 'Cormorant Garamond', serif;
    font-size: 0.9rem;
    font-style: italic;
    color: rgba(26,17,9,0.55);
    margin-top: 14px;
    line-height: 1.6;
    max-width: 36rem;
    margin-left: auto;
    margin-right: auto;
  }
`;

export function ErrorBoundary() {
  return (
    <MyNaiaLayout compact>
      <div style={{ padding: "48px 0" }}>
        <Link
          to="/trends/my-edits"
          style={{
            fontFamily: "'Space Mono', monospace",
            fontSize: "0.58rem",
            letterSpacing: "0.28em",
            textTransform: "uppercase",
            color: "#7a1e28",
            textDecoration: "none",
            display: "inline-block",
            marginBottom: "32px",
          }}
        >
          ← My Trend Edits
        </Link>
        <p
          style={{
            fontFamily: "'Cormorant Garamond', serif",
            fontSize: "1.1rem",
            fontStyle: "italic",
            color: "rgba(26,17,9,0.60)",
          }}
        >
          This edit could not be found.
        </p>
      </div>
    </MyNaiaLayout>
  );
}

export default function MyTrendEditDetail() {
  const { report, edit, hasProfile, generationFailed } = useLoaderData() as LoaderData;

  return (
    <MyNaiaLayout compact>
      <style>{css}</style>
      <div className="te-detail-page">
        <Link to="/trends/my-edits" className="te-back">← My Trend Edits</Link>

        {/* Report recap — links to the public editorial version */}
        <div className="te-recap">
          <div className="te-recap-season">{report.season}</div>
          <div className="te-recap-title">{report.title}</div>
          <p className="te-recap-summary">{report.summary}</p>
          <Link to={`/trends/${report.slug}`} className="te-recap-link">
            Read the full public report →
          </Link>
        </div>

        {/* Personal heading */}
        <h1 className="te-headline">
          My nAia<br />
          <em className="te-headline-accent">Trend Edit</em>
        </h1>
        {edit && <p className="te-subtitle">{edit.subTitle}</p>}

        {/* State: generation error */}
        {generationFailed ? (
          <div className="te-state-box">
            <p className="te-state-text">
              Your nAia Edit is taking a moment. Please try again shortly.
            </p>
            <Link to={`/trends/${report.slug}`} className="te-state-cta">
              Back to the report →
            </Link>
          </div>
        ) : !hasProfile ? (
          /* State: passport incomplete */
          <div className="te-state-box">
            <p className="te-state-text">
              Your nAia Edit reads this report through your Passport — and yours isn&apos;t complete yet. Finish it to see what this direction means for you specifically.
            </p>
            <Link to="/passport" className="te-state-cta">Complete Your Passport</Link>
          </div>
        ) : edit ? (
          /* State: full edit */
          <>
            {/* 1. WHY THIS MATTERS TO YOU */}
            <div className="te-reading-box">
              <div className="te-section-label">Why this matters to you</div>
              <p className="te-body">{edit.yourVersion}</p>
            </div>

            <div className="te-divider" />

            {/* 2. YOUR nAia EVIDENCE */}
            {(edit.evidenceStyleDna ||
              edit.evidencePassportSays ||
              edit.evidenceClosetItems.length > 0 ||
              edit.evidenceReviews) && (
              <>
                <div className="te-section">
                  <div className="te-section-label">Your nAia evidence</div>
                  <div className="te-evidence-panel">
                    {edit.evidenceStyleDna && (
                      <div className="te-evidence-row">
                        <div className="te-evidence-label">Your style DNA says</div>
                        <p className="te-body" style={{ fontSize: "1rem" }}>{edit.evidenceStyleDna}</p>
                      </div>
                    )}
                    {edit.evidencePassportSays && (
                      <div className="te-evidence-row">
                        <div className="te-evidence-label">Your Passport says</div>
                        <p className="te-body" style={{ fontSize: "1rem" }}>{edit.evidencePassportSays}</p>
                      </div>
                    )}
                    {edit.evidenceClosetItems.length > 0 && (
                      <div className="te-evidence-row">
                        <div className="te-evidence-label">Your Closet shows</div>
                        <div className="te-closet-grid">
                          {edit.evidenceClosetItems.map((item: EvidenceClosetItem, i: number) => (
                            <div key={i} className="te-closet-item">
                              {item.imageUrl && (
                                <img
                                  src={item.imageUrl}
                                  alt={item.name}
                                  className="te-closet-img"
                                />
                              )}
                              <div className="te-closet-name">{item.name}</div>
                              <p className="te-closet-note">{item.roleNote}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {edit.evidenceReviews && (
                      <div className="te-evidence-row">
                        <div className="te-evidence-label">Your reviews suggest</div>
                        <p className="te-body" style={{ fontSize: "1rem" }}>{edit.evidenceReviews}</p>
                      </div>
                    )}
                  </div>
                  {edit.lowDataNotice && (
                    <p className="te-low-data-notice">{edit.lowDataNotice}</p>
                  )}
                </div>
                <div className="te-divider" />
              </>
            )}

            {/* 3. YOUR ROUTE IN */}
            <div className="te-section">
              <div className="te-section-label">Your route in</div>
              <p className="te-body">{edit.yourBestRouteIn}</p>
            </div>

            {/* 4. A LOOK TO TRY */}
            <div className="te-section">
              <div className="te-section-label">A look to try</div>
              <p className="te-body">{edit.aLookToTry}</p>
            </div>

            <div className="te-divider" />

            {/* 5. WORTH INVESTING IN */}
            <div className="te-section">
              <div className="te-section-label">Worth investing in</div>
              <ul className="te-bullet-list">
                {edit.partToTake.map((bullet: string, i: number) => (
                  <li key={i}>{bullet}</li>
                ))}
              </ul>
            </div>

            {/* 6. HOLD OFF ON */}
            <div className="te-section">
              <div className="te-section-label">Hold off on</div>
              <p className="te-body" style={{ marginBottom: "16px" }}>{edit.theBalanceToProtect}</p>
              <ul className="te-bullet-list">
                {edit.partToLeave.map((bullet: string, i: number) => (
                  <li key={i}>{bullet}</li>
                ))}
              </ul>
            </div>

            {/* Footer CTA */}
            <div className="te-footer-cta">
              <Link to="/closet" className="te-footer-cta-btn">Open My Closet →</Link>
              <p className="te-footer-cta-note">
                Add your most-worn pieces and rate your outfits so nAia can build a sharper edit around your real style world.
              </p>
            </div>
          </>
        ) : null}
      </div>
    </MyNaiaLayout>
  );
}
