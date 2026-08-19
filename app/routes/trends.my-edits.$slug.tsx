import type { LinksFunction, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData, useState } from "react-router";
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
    href: "https://fonts.googleapis.com/css2?family=Oswald:wght@200;300;400&family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300;1,400&family=Space+Mono&display=swap",
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

const TINTS = ["#efeae0", "#e6dccb", "#d9c9b5", "#efe6d7", "#e2d3bf", "#ede2cf"];

const css = `
  .tmd-page { padding: 48px 0 96px; }

  /* ── Back link ───────────────────────────────────────────────── */
  .tmd-back {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-family: 'Space Mono', monospace;
    font-size: 0.6rem;
    letter-spacing: 0.3em;
    text-transform: uppercase;
    color: rgba(26,17,9,0.55);
    text-decoration: none;
    margin-bottom: 40px;
    transition: color 0.2s;
  }
  .tmd-back:hover { color: #7a1e28; }

  /* ── Action buttons ─────────────────────────────────────────── */
  .tmd-action-row {
    display: flex; align-items: center; gap: 8px;
    margin-bottom: 32px;
  }
  .tmd-action-btn {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 8px 16px; border: 1px solid rgba(26,17,9,0.18);
    font-family: 'Space Mono', monospace; font-size: 0.58rem; letter-spacing: 0.24em;
    text-transform: uppercase; color: #1a1109; background: transparent;
    cursor: pointer; text-decoration: none; transition: border-color 0.2s, color 0.2s;
  }
  .tmd-action-btn:hover { border-color: #7a1e28; color: #7a1e28; }
  .tmd-action-btn.active { color: #7a1e28; border-color: #7a1e28; }
  @media (max-width: 767px) { .tmd-action-row { display: none; } }

  /* ── Hero tinted block ───────────────────────────────────────── */
  .tmd-hero {
    position: relative;
    overflow: hidden;
    padding: 36px;
    margin-bottom: 48px;
  }
  .tmd-hero-num {
    position: absolute;
    right: -16px;
    top: -40px;
    font-family: 'Oswald', sans-serif;
    font-size: clamp(10rem, 14vw, 14rem);
    font-weight: 200;
    line-height: 1;
    color: rgba(26,17,9,0.05);
    pointer-events: none;
    user-select: none;
    z-index: 0;
    letter-spacing: 0.02em;
    text-transform: uppercase;
  }
  .tmd-hero-inner { position: relative; z-index: 1; }
  .tmd-hero-kicker {
    font-family: 'Space Mono', monospace;
    font-size: 0.58rem;
    letter-spacing: 0.3em;
    text-transform: uppercase;
    color: rgba(26,17,9,0.50);
    margin-bottom: 16px;
  }
  .tmd-hero-title {
    font-family: 'Oswald', sans-serif;
    font-size: clamp(2.4rem, 5vw, 4rem);
    font-weight: 200;
    line-height: 0.9;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    color: #1a1109;
    margin: 0 0 20px;
  }
  .tmd-hero-title em {
    font-family: 'Cormorant Garamond', serif;
    font-style: italic;
    font-weight: 300;
    text-transform: none;
    color: #7a1e28;
  }
  .tmd-hero-subtitle {
    font-family: 'Cormorant Garamond', serif;
    font-size: 1rem;
    font-style: italic;
    color: rgba(26,17,9,0.68);
    line-height: 1.7;
    max-width: 40rem;
    margin-bottom: 24px;
  }
  .tmd-hero-public-link {
    font-family: 'Space Mono', monospace;
    font-size: 0.55rem;
    letter-spacing: 0.24em;
    text-transform: uppercase;
    color: #7a1e28;
    text-decoration: none;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    opacity: 0.8;
    transition: opacity 0.2s;
  }
  .tmd-hero-public-link:hover { opacity: 1; }

  /* ── Divider ─────────────────────────────────────────────────── */
  .tmd-divider { height: 1px; background: rgba(26,17,9,0.10); margin: 36px 0; }

  /* ── Section labels ──────────────────────────────────────────── */
  .tmd-section-label {
    font-family: 'Space Mono', monospace;
    font-size: 0.58rem;
    letter-spacing: 0.34em;
    text-transform: uppercase;
    color: #7a1e28;
    margin-bottom: 18px;
  }
  .tmd-section { margin-bottom: 40px; }

  /* ── Body text ───────────────────────────────────────────────── */
  .tmd-body {
    font-family: 'Cormorant Garamond', serif;
    font-size: 1.1rem;
    line-height: 1.85;
    color: rgba(26,17,9,0.85);
  }

  /* ── Reading box (why this matters) ─────────────────────────── */
  .tmd-reading-box {
    padding: 28px 32px;
    border-left: 3px solid #7a1e28;
    background: rgba(122,30,40,0.04);
    margin-bottom: 40px;
  }

  /* ── Evidence panel ──────────────────────────────────────────── */
  .tmd-evidence {
    border: 1px solid rgba(122,30,40,0.12);
    background: rgba(255,255,255,0.40);
  }
  .tmd-evidence-row { padding: 20px 24px; }
  .tmd-evidence-row + .tmd-evidence-row {
    border-top: 1px solid rgba(26,17,9,0.07);
  }
  .tmd-evidence-label {
    font-family: 'Space Mono', monospace;
    font-size: 0.52rem;
    letter-spacing: 0.26em;
    text-transform: uppercase;
    color: rgba(26,17,9,0.40);
    margin-bottom: 10px;
  }

  /* Closet items */
  .tmd-closet-grid {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
    margin-top: 10px;
  }
  .tmd-closet-item { flex: 0 0 calc(50% - 8px); max-width: 180px; }
  .tmd-closet-img {
    width: 100%;
    aspect-ratio: 3/4;
    object-fit: cover;
    background: rgba(26,17,9,0.04);
  }
  .tmd-closet-name {
    font-family: 'Space Mono', monospace;
    font-size: 0.5rem;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: #7a1e28;
    margin-top: 8px;
    margin-bottom: 4px;
  }
  .tmd-closet-note {
    font-family: 'Cormorant Garamond', serif;
    font-size: 0.88rem;
    font-style: italic;
    color: rgba(26,17,9,0.58);
    line-height: 1.5;
  }

  .tmd-low-data {
    font-family: 'Cormorant Garamond', serif;
    font-size: 0.88rem;
    font-style: italic;
    color: rgba(26,17,9,0.50);
    margin-top: 14px;
    line-height: 1.6;
  }

  /* ── Bullet lists (invest/skip) ──────────────────────────────── */
  .tmd-dash-list { list-style: none; margin: 0; padding: 0; }
  .tmd-dash-list li {
    font-family: 'Cormorant Garamond', serif;
    font-size: 1.05rem;
    font-style: italic;
    line-height: 1.7;
    color: rgba(26,17,9,0.82);
    padding: 10px 0;
    border-bottom: 1px solid rgba(26,17,9,0.07);
  }
  .tmd-dash-list li::before { content: '— '; color: #7a1e28; }

  /* ── State boxes ─────────────────────────────────────────────── */
  .tmd-state {
    padding: 48px 40px;
    border: 1px solid rgba(26,17,9,0.08);
    background: rgba(255,255,255,0.45);
    text-align: center;
  }
  .tmd-state-text {
    font-family: 'Cormorant Garamond', serif;
    font-size: 1.15rem;
    font-style: italic;
    color: #1a1109;
    line-height: 1.7;
    margin-bottom: 28px;
    max-width: 34rem;
    margin-left: auto;
    margin-right: auto;
  }
  .tmd-state-btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    border: 1px solid rgba(26,17,9,0.80);
    border-radius: 9999px;
    padding: 11px 22px;
    font-family: 'Space Mono', monospace;
    font-size: 0.6rem;
    letter-spacing: 0.26em;
    text-transform: uppercase;
    color: #1a1109;
    text-decoration: none;
    transition: background 0.2s, color 0.2s;
  }
  .tmd-state-btn:hover { background: #1a1109; color: #f5f0e8; }

  /* ── Footer CTA ──────────────────────────────────────────────── */
  .tmd-footer {
    margin-top: 60px;
    padding: 36px 36px;
    background: #2a1e17;
    color: #f0ebe2;
  }
  .tmd-footer-eyebrow {
    font-family: 'Space Mono', monospace;
    font-size: 0.55rem;
    letter-spacing: 0.3em;
    text-transform: uppercase;
    color: rgba(240,235,226,0.50);
    margin-bottom: 16px;
  }
  .tmd-footer-body {
    font-family: 'Cormorant Garamond', serif;
    font-size: 1rem;
    font-style: italic;
    color: rgba(240,235,226,0.75);
    line-height: 1.7;
    max-width: 36rem;
    margin-bottom: 24px;
  }
  .tmd-footer-btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    border: 1px solid rgba(240,235,226,0.6);
    border-radius: 9999px;
    padding: 11px 22px;
    font-family: 'Space Mono', monospace;
    font-size: 0.6rem;
    letter-spacing: 0.26em;
    text-transform: uppercase;
    color: #f0ebe2;
    text-decoration: none;
    transition: background 0.2s, color 0.2s;
  }
  .tmd-footer-btn:hover { background: #f0ebe2; color: #1a1109; }
`;

export function ErrorBoundary() {
  return (
    <MyNaiaLayout compact>
      <style>{css}</style>
      <div className="tmd-page">
        <Link to="/trends/my-edits" className="tmd-back">← My Trend Edits</Link>
        <p style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "1.1rem", fontStyle: "italic", color: "rgba(26,17,9,0.60)" }}>
          This edit could not be found.
        </p>
      </div>
    </MyNaiaLayout>
  );
}

export default function MyTrendEditDetail() {
  const { report, edit, hasProfile, generationFailed } = useLoaderData() as LoaderData;

  const reportIndex = trendReports.filter((r) => r.published).findIndex((r) => r.slug === report.slug);
  const tint = TINTS[Math.max(0, reportIndex) % TINTS.length];
  const num = String(Math.max(0, reportIndex)).padStart(2, "0");

  const hasEvidence =
    edit &&
    (edit.evidenceStyleDna ||
      edit.evidencePassportSays ||
      edit.evidenceClosetItems.length > 0 ||
      edit.evidenceReviews);

  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle");

  const copyLink = async () => {
    if (typeof window === "undefined") return;
    const url = window.location.href;
    const fallbackCopy = () => {
      try {
        const textarea = document.createElement("textarea");
        textarea.value = url;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(textarea);
        return ok;
      } catch { return false; }
    };
    let ok = false;
    if (navigator.clipboard && window.isSecureContext) {
      try { await navigator.clipboard.writeText(url); ok = true; } catch { ok = fallbackCopy(); }
    } else { ok = fallbackCopy(); }
    setCopyStatus(ok ? "copied" : "error");
    window.setTimeout(() => setCopyStatus("idle"), 2500);
  };

  const downloadMyEdit = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { jsPDF } = (window as any).jspdf;
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pageW = doc.internal.pageSize.getWidth();
    const margin = 20;
    const maxW = pageW - margin * 2;
    let y = 20;
    const addText = (text: string, size: number, style: string, color: number[], spaceAfter?: number) => {
      doc.setFontSize(size);
      doc.setFont("helvetica", style || "normal");
      doc.setTextColor(...(color as [number, number, number]));
      const lines = doc.splitTextToSize(String(text || ""), maxW);
      lines.forEach((line: string) => {
        if (y > 270) { doc.addPage(); y = 20; }
        doc.text(line, margin, y);
        y += size * 0.45;
      });
      y += spaceAfter || 4;
    };
    doc.setFontSize(24); doc.setFont("helvetica", "bolditalic"); doc.setTextColor(34, 21, 22);
    doc.text("nAia", margin, y); y += 8;
    doc.setFontSize(8); doc.setFont("helvetica", "normal"); doc.setTextColor(139, 32, 53);
    doc.text("MY TREND EDIT · " + report.season.toUpperCase(), margin, y); y += 10;
    doc.setDrawColor(34, 21, 22); doc.line(margin, y, pageW - margin, y); y += 10;
    addText(report.title, 20, "bold", [34, 21, 22], 6);
    if (edit?.subTitle) addText(edit.subTitle, 12, "italic", [122, 111, 106], 10);
    if (edit?.yourVersion) { addText("YOUR VERSION", 8, "bold", [139, 32, 53], 3); addText(edit.yourVersion, 11, "normal", [34, 21, 22], 10); }
    if (edit?.evidenceStyleDna) { addText("YOUR STYLE DNA SAYS", 8, "bold", [139, 32, 53], 3); addText(edit.evidenceStyleDna, 10, "normal", [34, 21, 22], 8); }
    if (edit?.evidencePassportSays) { addText("YOUR PASSPORT SAYS", 8, "bold", [139, 32, 53], 3); addText(edit.evidencePassportSays, 10, "normal", [34, 21, 22], 8); }
    if (edit?.evidenceReviews) { addText("YOUR RATINGS SAY", 8, "bold", [139, 32, 53], 3); addText(edit.evidenceReviews, 10, "normal", [34, 21, 22], 8); }
    if (edit?.yourBestRouteIn) { addText("YOUR BEST ROUTE IN", 8, "bold", [139, 32, 53], 3); addText(edit.yourBestRouteIn, 10, "normal", [34, 21, 22], 8); }
    if (edit?.aLookToTry) { addText("A LOOK TO TRY", 8, "bold", [139, 32, 53], 3); addText(edit.aLookToTry, 10, "normal", [34, 21, 22], 8); }
    if (edit?.worthInvestingStatement) { addText("WORTH INVESTING IN", 8, "bold", [139, 32, 53], 3); addText(edit.worthInvestingStatement, 10, "normal", [34, 21, 22], 8); }
    if (edit?.partToTake) { addText("THE PART TO TAKE", 8, "bold", [139, 32, 53], 3); addText(edit.partToTake, 10, "normal", [34, 21, 22], 8); }
    if (edit?.theBalanceToProtect) { addText("THE BALANCE TO PROTECT", 8, "bold", [139, 32, 53], 3); addText(edit.theBalanceToProtect, 10, "normal", [34, 21, 22], 8); }
    if (edit?.partToLeave) { addText("THE PART TO LEAVE", 8, "bold", [139, 32, 53], 3); addText(edit.partToLeave, 10, "normal", [34, 21, 22], 8); }
    doc.setFontSize(7); doc.setFont("helvetica", "normal"); doc.setTextColor(122, 111, 106);
    doc.text("nAia Trend Reports · Your personalised edit", margin, 285);
    doc.save("my-edit-" + report.title.replace(/[^a-z0-9]/gi, "-").toLowerCase() + ".pdf");
  };

  return (
    <MyNaiaLayout compact>
      <style>{css}</style>
      <div className="tmd-page">
        <Link to="/trends/my-edits" className="tmd-back">← My Trend Edits</Link>

        {edit && (
          <div className="tmd-action-row">
            <button className={`tmd-action-btn${copyStatus === "copied" ? " active" : ""}`} onClick={copyLink}>
              {copyStatus === "copied" ? "Copied ✓" : copyStatus === "error" ? "Failed" : "Copy link"}
            </button>
            <button className="tmd-action-btn" onClick={downloadMyEdit}>Download My Edit</button>
          </div>
        )}

        {/* Hero tinted block */}
        <div className="tmd-hero" style={{ background: tint }}>
          <span className="tmd-hero-num" aria-hidden="true">{num}</span>
          <div className="tmd-hero-inner">
            <div className="tmd-hero-kicker">{report.season} · personal edit</div>
            <h1 className="tmd-hero-title">
              {report.title.split(" ").slice(0, -1).join(" ")}<br />
              <em>{report.title.split(" ").slice(-1)[0]}</em>
            </h1>
            {edit && <p className="tmd-hero-subtitle">{edit.subTitle}</p>}
            <Link to={`/trends/${report.slug}`} className="tmd-hero-public-link">
              Read the public report →
            </Link>
          </div>
        </div>

        {/* State: generation error */}
        {generationFailed ? (
          <div className="tmd-state">
            <p className="tmd-state-text">
              Your nAia Edit is taking a moment. Please try again shortly.
            </p>
            <Link to={`/trends/${report.slug}`} className="tmd-state-btn">
              Back to the report →
            </Link>
          </div>
        ) : !hasProfile ? (
          /* State: passport incomplete */
          <div className="tmd-state">
            <p className="tmd-state-text">
              Your nAia Edit reads this report through your Passport — and yours isn&rsquo;t complete yet. Finish it to see what this direction means for you specifically.
            </p>
            <Link to="/passport" className="tmd-state-btn">Complete Your Passport →</Link>
          </div>
        ) : edit ? (
          /* Full edit */
          <>
            {/* 01 / WHY THIS MATTERS TO YOU */}
            <div className="tmd-reading-box">
              <div className="tmd-section-label">01 / Why this matters to you</div>
              <p className="tmd-body">{edit.yourVersion}</p>
            </div>

            {/* 02 / YOUR nAia EVIDENCE */}
            {hasEvidence && (
              <>
                <div className="tmd-section">
                  <div className="tmd-section-label">02 / Your nAia Evidence</div>
                  <div className="tmd-evidence">
                    {edit.evidenceStyleDna && (
                      <div className="tmd-evidence-row">
                        <div className="tmd-evidence-label">Your style DNA says</div>
                        <p className="tmd-body" style={{ fontSize: "1rem" }}>{edit.evidenceStyleDna}</p>
                      </div>
                    )}
                    {edit.evidencePassportSays && (
                      <div className="tmd-evidence-row">
                        <div className="tmd-evidence-label">Your Passport says</div>
                        <p className="tmd-body" style={{ fontSize: "1rem" }}>{edit.evidencePassportSays}</p>
                      </div>
                    )}
                    {edit.evidenceClosetItems.length > 0 && (
                      <div className="tmd-evidence-row">
                        <div className="tmd-evidence-label">Your Closet shows</div>
                        <div className="tmd-closet-grid">
                          {edit.evidenceClosetItems.map((item: EvidenceClosetItem, i: number) => (
                            <div key={i} className="tmd-closet-item">
                              {item.imageUrl && (
                                <img src={item.imageUrl} alt={item.name} className="tmd-closet-img" />
                              )}
                              <div className="tmd-closet-name">{item.name}</div>
                              <p className="tmd-closet-note">{item.roleNote}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {edit.evidenceReviews && (
                      <div className="tmd-evidence-row">
                        <div className="tmd-evidence-label">Your reviews suggest</div>
                        <p className="tmd-body" style={{ fontSize: "1rem" }}>{edit.evidenceReviews}</p>
                      </div>
                    )}
                  </div>
                  {edit.lowDataNotice && (
                    <p className="tmd-low-data">{edit.lowDataNotice}</p>
                  )}
                </div>
                <div className="tmd-divider" />
              </>
            )}

            {/* 03 / YOUR ROUTE IN */}
            <div className="tmd-section">
              <div className="tmd-section-label">03 / Your route in</div>
              <p className="tmd-body">{edit.yourBestRouteIn}</p>
            </div>

            {/* 04 / A LOOK TO TRY */}
            <div className="tmd-section">
              <div className="tmd-section-label">04 / A look to try</div>
              <p className="tmd-body">{edit.aLookToTry}</p>
            </div>

            <div className="tmd-divider" />

            {/* 05 / WORTH INVESTING IN */}
            <div className="tmd-section">
              <div className="tmd-section-label">05 / Worth investing in</div>
              {edit.worthInvestingStatement ? (
                <p className="tmd-body">{edit.worthInvestingStatement}</p>
              ) : (
                <ul className="tmd-dash-list">
                  {edit.partToTake.map((bullet: string, i: number) => (
                    <li key={i}>{bullet}</li>
                  ))}
                </ul>
              )}
            </div>

            {/* 06 / HOLD OFF ON */}
            <div className="tmd-section">
              <div className="tmd-section-label">06 / Hold off on</div>
              <p className="tmd-body" style={{ marginBottom: "16px" }}>{edit.theBalanceToProtect}</p>
              <ul className="tmd-dash-list">
                {edit.partToLeave.map((bullet: string, i: number) => (
                  <li key={i}>{bullet}</li>
                ))}
              </ul>
            </div>

            {/* Footer CTA */}
            <div className="tmd-footer">
              <div className="tmd-footer-eyebrow">build a sharper edit</div>
              <p className="tmd-footer-body">
                Add your most-worn pieces and rate your outfits so nAia can read your real style world more precisely.
              </p>
              <Link to="/closet" className="tmd-footer-btn">Open My Closet →</Link>
            </div>
          </>
        ) : null}
      </div>
    </MyNaiaLayout>
  );
}
