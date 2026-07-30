import { useState } from "react";
import { Link, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { trendReports, type TrendReportData } from "../lib/trend-reports";

const SOURCE_DATE_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// Editorial display only — the underlying "YYYY-MM-DD" source value is unchanged.
// Formatted by string parts (not Date/Intl) so there is no local-timezone shift risk.
function formatSourceDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return `${day} ${SOURCE_DATE_MONTHS[month - 1]} ${year}`;
}

export async function loader({ params }: LoaderFunctionArgs) {
  const report = trendReports.find((r) => r.slug === params.slug && r.published);

  if (!report) {
    throw new Response("Not Found", { status: 404 });
  }

  return { report };
}

export function meta({ data }: { data?: { report: TrendReportData } }) {
  if (!data?.report) {
    return [{ title: "Report Not Found | nAia Trend Reports" }];
  }
  return [
    { title: `${data.report.title} | nAia Trend Reports` },
    { name: "description", content: data.report.summary },
  ];
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
  .tr-edit-entry{display:inline-block;padding:14px 32px;border:1px solid var(--accent);color:var(--accent);font-family:var(--ff-mono);font-size:10px;letter-spacing:2px;text-transform:uppercase;text-decoration:none;transition:background .2s,color .2s}
  .tr-edit-entry:hover{background:var(--accent);color:#f4f4f1}
  .tr-divider{height:1px;background:rgba(59,5,16,.08);margin:40px 0}
  .tr-tag{display:inline-block;padding:6px 14px;font-family:var(--ff-mono);font-size:8px;letter-spacing:2px;text-transform:uppercase;margin:4px 4px 4px 0}
  .tr-tag.rising{background:rgba(139,32,53,0.08);color:var(--accent)}
  .tr-tag.fading{border:1px solid rgba(59,5,16,.1);color:var(--muted)}
  .tr-how-card{padding:20px 24px;border:1px solid rgba(59,5,16,.08);margin-bottom:10px;display:grid;grid-template-columns:140px 1fr;gap:20px;align-items:start}
  .tr-how-feeling{font-family:var(--ff-mono);font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--accent)}
  .tr-how-text{font-family:var(--ff-body);font-size:16px;font-style:italic;color:var(--deep);line-height:1.6}
  .tr-brand-card{padding:16px 20px;background:rgba(255,255,255,0.5);border:1px solid rgba(59,5,16,.06);margin-bottom:8px}
  .tr-brand-name{font-family:var(--ff-display);font-size:18px;font-weight:700;color:var(--deep);margin-bottom:4px}
  .tr-brand-why{font-family:var(--ff-body);font-size:15px;font-style:italic;color:var(--muted)}
  .tr-naia-box{background:rgba(139,32,53,0.04);border-left:3px solid var(--accent);padding:32px;margin:40px 0}
  .tr-source{padding:14px 0;border-bottom:1px solid rgba(59,5,16,.06)}
  .tr-source-publisher{font-family:var(--ff-mono);font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--accent);margin-bottom:4px}
  .tr-source-title{font-family:var(--ff-body);font-size:16px;color:var(--deep)}
  .tr-source-title a{color:var(--deep);text-decoration:underline}
  .tr-source-date{font-family:var(--ff-mono);font-size:10px;color:var(--muted);margin-top:4px}
  .tr-source-descriptor{font-family:var(--ff-body);font-size:13px;font-style:italic;color:var(--muted);margin-bottom:4px;margin-top:2px}
  .tr-ref-signal{font-family:var(--ff-body);font-size:16px;font-style:italic;color:var(--deep);line-height:1.6;margin-bottom:10px}
  .tr-ref-naia-label{font-family:var(--ff-mono);font-size:8px;letter-spacing:2px;text-transform:uppercase;color:var(--accent);margin-bottom:4px}
  .tr-ref-naia{font-family:var(--ff-body);font-size:15px;font-style:italic;color:var(--muted);line-height:1.6}
  .tr-sss-entry{padding:16px 0;border-bottom:1px solid rgba(59,5,16,.06)}
  .tr-sss-label{font-family:var(--ff-mono);font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--accent);margin-bottom:8px}
  .tr-verdict-block{padding:24px 0;margin:8px 0 40px}
  .tr-cta-block{text-align:center;padding:48px 40px;background:rgba(34,21,22,.03);border-top:1px solid rgba(59,5,16,.08);margin-top:48px}
  .tr-cta-link{display:inline-block;padding:16px 40px;background:#221516;color:#f4f4f1;font-family:var(--ff-mono);font-size:10px;letter-spacing:3px;text-transform:uppercase;text-decoration:none;margin-bottom:16px}
  .tr-cta-sub{font-family:var(--ff-body);font-size:16px;font-style:italic;color:var(--muted);line-height:1.6}
  .tr-actions{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
  .tr-lens-nav{margin:48px 0}
  .tr-lens-nav-label{font-family:var(--ff-mono);font-size:9px;letter-spacing:3px;text-transform:uppercase;color:var(--muted);margin-bottom:16px}
  .tr-lens-nav-row{display:flex;flex-wrap:wrap;gap:8px}
  .tr-lens-btn{display:inline-block;padding:10px 20px;font-family:var(--ff-mono);font-size:9px;letter-spacing:2px;text-transform:uppercase;text-decoration:none;border:1px solid rgba(59,5,16,.2);color:var(--deep);transition:background .15s,color .15s,border-color .15s}
  .tr-lens-btn:hover{border-color:var(--accent);color:var(--accent)}
  .tr-lens-btn.for-you{border-color:var(--accent);color:var(--accent)}
  .tr-lens-btn.for-you:hover{background:var(--accent);color:var(--cream)}
  .tr-action-btn{display:inline-flex;align-items:center;gap:10px;padding:14px 32px;border:none;font-family:var(--ff-mono);font-size:9px;letter-spacing:2px;text-transform:uppercase;cursor:pointer}
  .tr-action-btn.primary{background:#221516;color:#f4f4f1}
  .tr-action-btn.secondary{background:transparent;color:var(--deep);border:1px solid rgba(59,5,16,.2)}
  @media print{.tr-topbar,.tr-actions,.tr-cta-block{display:none!important}.tr-wrap{padding:0!important;max-width:100%!important}}
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

export default function TrendReportDetail() {
  const { report } = useLoaderData() as { report: TrendReportData };
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
        const succeeded = document.execCommand("copy");
        document.body.removeChild(textarea);
        return succeeded;
      } catch {
        return false;
      }
    };

    let succeeded = false;
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(url);
        succeeded = true;
      } catch {
        succeeded = fallbackCopy();
      }
    } else {
      succeeded = fallbackCopy();
    }

    setCopyStatus(succeeded ? "copied" : "error");
    window.setTimeout(() => setCopyStatus("idle"), 2500);
  };

  const downloadPdf = () => {
    // jsPDF is loaded as a global UMD script (see app/root.jsx); no local types ship for it.
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
      doc.setTextColor(...(color || [34, 21, 22]));
      const lines = doc.splitTextToSize(String(text || ""), maxW);
      lines.forEach((line: string) => {
        if (y > 270) { doc.addPage(); y = 20; }
        doc.text(line, margin, y);
        y += size * 0.45;
      });
      y += spaceAfter || 4;
    };

    // Logo
    doc.setFontSize(24);
    doc.setFont("helvetica", "bolditalic");
    doc.setTextColor(34, 21, 22);
    doc.text("nAia", margin, y); y += 8;

    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(139, 32, 53);
    doc.text("TREND INTELLIGENCE · " + report.season.toUpperCase(), margin, y); y += 6;

    if (report.mood) {
      doc.setFontSize(9);
      doc.setFont("helvetica", "italic");
      doc.setTextColor(122, 111, 106);
      doc.text(report.mood, margin, y); y += 8;
    } else {
      y += 4;
    }

    doc.setDrawColor(34, 21, 22);
    doc.line(margin, y, pageW - margin, y); y += 10;

    // Title
    addText(report.title, 20, "bold", [34, 21, 22], 6);
    addText(report.editorialIntro, 11, "italic", [122, 111, 106], 10);

    // Key trends
    addText("KEY DIRECTIONS", 8, "bold", [139, 32, 53], 4);
    (report.keyTrends || []).forEach((t, i) => {
      addText(`${i + 1}. ${t.name}`, 12, "bold", [34, 21, 22], 2);
      addText(t.description, 10, "normal", [34, 21, 22], 6);
    });

    // Rising / Fading
    if (report.rising?.length) { addText("WHAT'S RISING", 8, "bold", [139, 32, 53], 3); addText(report.rising.join("  ·  "), 10, "normal", [34, 21, 22], 8); }
    if (report.fading?.length) { addText("WHAT'S FADING", 8, "bold", [139, 32, 53], 3); addText(report.fading.join("  ·  "), 10, "normal", [122, 111, 106], 8); }

    // References Behind This Edit
    if (report.referencesBehindThisEdit?.length) {
      addText("REFERENCES BEHIND THIS EDIT", 8, "bold", [139, 32, 53], 4);
      report.referencesBehindThisEdit.forEach((ref) => {
        addText(ref.collection ? `${ref.brand} — ${ref.collection}` : ref.brand, 11, "bold", [34, 21, 22], 2);
        addText(ref.signal, 10, "italic", [34, 21, 22], 2);
        addText("nAia: " + ref.naiaRead, 9, "normal", [122, 111, 106], 6);
      });
      y += 4;
    } else if (report.brandsToWatch?.length) {
      addText("REFERENCES BEHIND THIS EDIT", 8, "bold", [139, 32, 53], 4);
      report.brandsToWatch.forEach((b) => { addText(`${b.name} — ${b.why}`, 10, "normal", [34, 21, 22], 4); });
      y += 4;
    }

    // Investment Notes — Spend / Save / Already Own It?
    if (report.spendSaveSkip) {
      addText("INVESTMENT NOTES", 8, "bold", [139, 32, 53], 4);
      addText("Spend", 9, "bold", [139, 32, 53], 2);
      addText(report.spendSaveSkip.spend, 10, "normal", [34, 21, 22], 4);
      addText("Hold Off On", 9, "bold", [139, 32, 53], 2);
      addText(report.spendSaveSkip.save, 10, "normal", [34, 21, 22], 4);
      addText("Already Own It?", 9, "bold", [139, 32, 53], 2);
      addText(report.spendSaveSkip.alreadyOwn, 10, "normal", [34, 21, 22], 8);
    } else if (report.investmentNotes) {
      addText("INVESTMENT NOTES", 8, "bold", [139, 32, 53], 3); addText(report.investmentNotes, 10, "normal", [34, 21, 22], 8);
    }

    // nAia interpretation — compact editorial quote block, sized to its actual content
    // (previously a fixed-height box drawn before the text, leaving empty space below short copy).
    if (report.naiaInterpretation) {
      const boxPad = 8; // mm, ≈ the webpage callout's 32px padding
      const boxTextWidth = maxW - boxPad * 2;
      const labelLineHeight = 8 * 0.45;
      const bodyLineHeight = 11 * 0.45;

      doc.setFontSize(8);
      doc.setFont("helvetica", "bold");
      const labelLines = doc.splitTextToSize("NAIA INTERPRETATION", boxTextWidth);

      doc.setFontSize(11);
      doc.setFont("helvetica", "italic");
      const bodyLines = doc.splitTextToSize(String(report.naiaInterpretation || ""), boxTextWidth);

      const labelBlockHeight = labelLines.length * labelLineHeight + 3;
      const bodyBlockHeight = bodyLines.length * bodyLineHeight;
      const boxHeight = labelBlockHeight + bodyBlockHeight + boxPad * 2;

      if (y + boxHeight > 280) { doc.addPage(); y = 20; }

      doc.setFillColor(250, 245, 242);
      doc.rect(margin - 2, y - 2, maxW + 4, boxHeight, "F");
      doc.setDrawColor(139, 32, 53);
      doc.setLineWidth(0.8);
      doc.line(margin, y - 2, margin, y - 2 + boxHeight);
      doc.setLineWidth(0.2);

      let textY = y + boxPad;
      doc.setFontSize(8);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(139, 32, 53);
      labelLines.forEach((line: string) => {
        doc.text(line, margin + boxPad, textY);
        textY += labelLineHeight;
      });
      textY += 3;

      doc.setFontSize(11);
      doc.setFont("helvetica", "italic");
      doc.setTextColor(34, 21, 22);
      bodyLines.forEach((line: string) => {
        doc.text(line, margin + boxPad, textY);
        textY += bodyLineHeight;
      });

      y += boxHeight + 8;
    }

    // nAia Verdict
    if (report.naiaVerdict) {
      addText("NAIA VERDICT", 8, "bold", [139, 32, 53], 3);
      addText(report.naiaVerdict, 10, "normal", [34, 21, 22], 8);
    }

    // How to wear
    if (report.howToWear?.length) {
      addText("HOW TO WEAR THIS TREND", 8, "bold", [139, 32, 53], 4);
      report.howToWear.forEach((h) => { addText(`${h.feeling}: ${h.direction}`, 10, "normal", [34, 21, 22], 4); });
      y += 4;
    }

    // Wardrobe note
    if (report.wardrobeNote) { addText("WHAT THIS MEANS FOR YOUR WARDROBE", 8, "bold", [139, 32, 53], 3); addText(report.wardrobeNote, 10, "normal", [34, 21, 22], 8); }

    // Sources — printed as "Publisher — Title (date)"; no raw URLs as body text.
    // Full clickable source links remain on the web page; the PDF points back to it.
    if (report.sources?.length) {
      addText("SOURCES", 8, "bold", [139, 32, 53], 4);
      report.sources.forEach((s) => {
        const dateSuffix = s.publishedAt ? ` (${formatSourceDate(s.publishedAt)})` : "";
        addText(`${s.publisher} — ${s.title}${dateSuffix}`, 10, "normal", [34, 21, 22], 6);
      });
      const reportUrl = typeof window !== "undefined" ? window.location.href : "";
      addText(`Full source links: ${reportUrl}`, 9, "italic", [122, 111, 106], 8);
    }

    // Footer
    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(122, 111, 106);
    doc.text("nAia Trend Reports · The nAia edit", margin, 285);

    const filename = report.title.replace(/[^a-z0-9]/gi, "-").toLowerCase() + ".pdf";
    doc.save(filename);
  };

  return (
    <div style={{ minHeight: "100vh", background: "#f4f4f1" }}>
      <style>{css}</style>
      <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,900&family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />

      <div className="tr-topbar">
        <div className="tr-topbar-logo">nAia</div>
        <Link to="/trends" className="tr-topbar-link">← All Reports</Link>
      </div>

      <div className="tr-wrap">
        {/* Report header */}
        <div style={{ background: "#221516", color: "#f4f4f1", padding: "60px 48px", marginBottom: "48px" }}>
          <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "8px", letterSpacing: "3px", textTransform: "uppercase", color: "#8b2035", marginBottom: "12px" }}>
            nAia Trend Intelligence · {report.season} · {new Date(report.publishedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
          </div>
          {report.mood && (
            <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "17px", fontStyle: "italic", color: "rgba(225,219,215,0.72)", marginBottom: "20px", letterSpacing: "0.3px" }}>
              {report.mood}
            </div>
          )}
          <h1 style={{ fontFamily: "'Playfair Display',serif", fontSize: "clamp(28px,4vw,44px)", fontWeight: 900, fontStyle: "italic", lineHeight: 1.1, marginBottom: "24px" }}>
            {report.title}
          </h1>
          <p style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "20px", fontStyle: "italic", color: "#e1dbd7", lineHeight: 1.7 }}>
            {report.editorialIntro}
          </p>
        </div>

        {/* Key trends */}
        {report.keyTrends?.length > 0 && (
          <div style={{ marginBottom: "48px" }}>
            <div className="tr-section-label">Key Directions</div>
            {report.keyTrends.map((t, i) => (
              <div key={i} style={{ marginBottom: "28px", paddingBottom: "28px", borderBottom: "1px solid rgba(59,5,16,.06)" }}>
                <div style={{ fontFamily: "'Playfair Display',serif", fontSize: "22px", fontWeight: 700, fontStyle: "italic", color: "#221516", marginBottom: "10px" }}>
                  {i + 1}. {t.name}
                </div>
                <p className="tr-body">{t.description}</p>
              </div>
            ))}
          </div>
        )}

        {/* Rising / Fading */}
        {((report.rising?.length ?? 0) > 0 || (report.fading?.length ?? 0) > 0) && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "32px", marginBottom: "48px" }}>
            {report.rising?.length ? (
              <div>
                <div className="tr-section-label">What&apos;s Rising</div>
                <div>{report.rising.map((r, i) => <span key={i} className="tr-tag rising">{r}</span>)}</div>
              </div>
            ) : null}
            {report.fading?.length ? (
              <div>
                <div className="tr-section-label">What&apos;s Fading</div>
                <div>{report.fading.map((f, i) => <span key={i} className="tr-tag fading">{f}</span>)}</div>
              </div>
            ) : null}
          </div>
        )}

        <div className="tr-divider" />

        {/* References Behind This Edit */}
        {(report.referencesBehindThisEdit?.length || report.brandsToWatch?.length) ? (
          <div style={{ marginBottom: "48px" }}>
            <div className="tr-section-label">References Behind This Edit</div>
            {report.referencesBehindThisEdit
              ? report.referencesBehindThisEdit.map((ref, i) => (
                  <div key={i} className="tr-brand-card">
                    <div className="tr-brand-name">{ref.collection ? `${ref.brand} — ${ref.collection}` : ref.brand}</div>
                    <p className="tr-ref-signal">{ref.signal}</p>
                    <div className="tr-ref-naia-label">nAia</div>
                    <p className="tr-ref-naia">{ref.naiaRead}</p>
                  </div>
                ))
              : report.brandsToWatch?.map((b, i) => (
                  <div key={i} className="tr-brand-card">
                    <div className="tr-brand-name">{b.name}</div>
                    <div className="tr-brand-why">{b.why}</div>
                  </div>
                ))}
          </div>
        ) : null}

        {/* Investment Notes — Spend / Save / Already Own It? */}
        {(report.spendSaveSkip || report.investmentNotes) && (
          <div style={{ marginBottom: "48px" }}>
            <div className="tr-section-label">Investment Notes</div>
            {report.spendSaveSkip ? (
              <>
                <div className="tr-sss-entry">
                  <div className="tr-sss-label">Spend</div>
                  <p className="tr-body">{report.spendSaveSkip.spend}</p>
                </div>
                <div className="tr-sss-entry">
                  <div className="tr-sss-label">Hold Off On</div>
                  <p className="tr-body">{report.spendSaveSkip.save}</p>
                </div>
                <div className="tr-sss-entry" style={{ borderBottom: "none" }}>
                  <div className="tr-sss-label">Already Own It?</div>
                  <p className="tr-body">{report.spendSaveSkip.alreadyOwn}</p>
                </div>
              </>
            ) : (
              <p className="tr-body">{report.investmentNotes}</p>
            )}
          </div>
        )}

        <div className="tr-divider" />

        {/* nAia interpretation */}
        {report.naiaInterpretation && (
          <div className="tr-naia-box">
            <div className="tr-section-label">nAia Interpretation</div>
            <p style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "20px", fontStyle: "italic", color: "#221516", lineHeight: 1.8 }}>
              {report.naiaInterpretation}
            </p>
          </div>
        )}

        {/* nAia Verdict */}
        {report.naiaVerdict && (
          <div className="tr-verdict-block">
            <div className="tr-section-label">nAia Verdict</div>
            <p className="tr-body">{report.naiaVerdict}</p>
          </div>
        )}

        {/* How to wear */}
        {report.howToWear?.length ? (
          <div style={{ marginBottom: "48px" }}>
            <div className="tr-section-label">How to Wear This Trend</div>
            {report.howToWear.map((h, i) => (
              <div key={i} className="tr-how-card">
                <div className="tr-how-feeling">{h.feeling}</div>
                <div className="tr-how-text">{h.direction}</div>
              </div>
            ))}
          </div>
        ) : null}

        <div className="tr-divider" />

        {/* Wardrobe note */}
        {report.wardrobeNote && (
          <div style={{ marginBottom: "48px" }}>
            <div className="tr-section-label">What This Means for Your Wardrobe</div>
            <p className="tr-body">{report.wardrobeNote}</p>
          </div>
        )}

        <div className="tr-divider" />

        {/* Sources */}
        <div style={{ marginBottom: "60px" }}>
          <div className="tr-section-label">Sources</div>
          {report.sources.map((s, i) => (
            <div key={i} className="tr-source">
              <div className="tr-source-publisher">{s.publisher}</div>
              {s.descriptor && <div className="tr-source-descriptor">{s.descriptor}</div>}
              <div className="tr-source-title">
                <a href={s.url} target="_blank" rel="noreferrer">{s.title}</a>
              </div>
              {s.publishedAt && <div className="tr-source-date">{formatSourceDate(s.publishedAt)}</div>}
            </div>
          ))}
        </div>

        {/* Lens navigation — final invitation after the full public report */}
        <div className="tr-lens-nav">
          <div className="tr-lens-nav-label">Read this through a lens</div>
          <p style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "16px", fontStyle: "italic", color: "var(--muted)", lineHeight: 1.6, marginBottom: "16px" }}>
            One report, different decisions. Read this direction through the lens that matters to you.
          </p>
          <div className="tr-lens-nav-row">
            <Link to={`/trends/${report.slug}/edit`} className="tr-lens-btn">My Edit</Link>
            <Link to={`/trends/${report.slug}/lens/designer`} className="tr-lens-btn">Designer</Link>
            <Link to={`/trends/${report.slug}/lens/buyer`} className="tr-lens-btn">Buyer</Link>
            <Link to={`/trends/${report.slug}/lens/marketer`} className="tr-lens-btn">Marketer</Link>
            <Link to={`/trends/${report.slug}/lens/creative-director`} className="tr-lens-btn">Creative Director</Link>
            <Link to={`/trends/${report.slug}/lens/stylist`} className="tr-lens-btn">Stylist</Link>
          </div>
        </div>

        {/* Footer */}
        <div style={{ textAlign: "center", paddingTop: "40px", borderTop: "1px solid rgba(59,5,16,.08)" }}>
          <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "8px", letterSpacing: "2px", textTransform: "uppercase", color: "#7a6f6a" }}>
            nAia Trend Reports · The nAia edit
          </div>
        </div>
      </div>
    </div>
  );
}
