import { useState, useEffect } from "react";
import * as React from "react";
import { Link } from "react-router";

const css = `
  :root{--cream:#f4f4f1;--warm:#e1dbd7;--deep:#221516;--accent:#8b2035;--muted:#7a6f6a;--ff-display:'Playfair Display',Georgia,serif;--ff-body:'Cormorant Garamond',Garamond,serif;--ff-mono:'Space Mono','Courier New',monospace}
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:var(--cream);color:var(--deep);font-family:var(--ff-body);-webkit-font-smoothing:antialiased}
  .tr-topbar{display:flex;justify-content:space-between;align-items:center;padding:20px 40px;border-bottom:1px solid rgba(59,5,16,.06)}
  .tr-topbar-logo{font-family:var(--ff-display);font-size:22px;font-style:italic;letter-spacing:3px;color:var(--deep)}
  .tr-topbar-link{font-family:var(--ff-mono);font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--accent);text-decoration:none}
  .tr-wrap{max-width:900px;margin:0 auto;padding:60px 40px}
  .tr-headline{font-family:var(--ff-display);font-size:clamp(36px,5vw,56px);font-weight:900;line-height:1;margin-bottom:8px}
  .tr-sub{font-family:var(--ff-body);font-size:18px;font-style:italic;color:var(--muted);margin-bottom:48px}
  .tr-label{font-family:var(--ff-mono);font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--muted);margin-bottom:12px;display:block}
  .tr-pill{padding:10px 20px;border:1px solid rgba(59,5,16,.12);font-family:var(--ff-mono);font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--deep);cursor:pointer;background:transparent;transition:all .2s}
  .tr-pill:hover{border-color:var(--deep)}
  .tr-pill.on{background:var(--accent);color:var(--cream);border-color:var(--accent)}
  .tr-input{width:100%;padding:18px;border:1px solid rgba(59,5,16,.1);font-size:20px;font-family:var(--ff-body);font-style:italic;background:rgba(255,255,255,0.7);color:var(--deep);outline:none;box-sizing:border-box;margin-bottom:16px}
  .tr-input:focus{border-color:var(--deep)}
  .tr-btn{width:100%;padding:18px;background:var(--accent);color:var(--cream);border:none;font-family:var(--ff-mono);font-size:10px;letter-spacing:4px;text-transform:uppercase;cursor:pointer}
  .tr-btn:disabled{background:#d4cfc9;cursor:not-allowed}
  .tr-section-label{font-family:var(--ff-mono);font-size:9px;letter-spacing:3px;text-transform:uppercase;color:var(--accent);margin-bottom:16px}
  .tr-section-title{font-family:var(--ff-display);font-size:28px;font-weight:900;font-style:italic;color:var(--deep);margin-bottom:16px}
  .tr-body{font-family:var(--ff-body);font-size:18px;line-height:1.8;color:var(--deep)}
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
  @media print{.tr-topbar,.tr-headline,.tr-sub,.tr-label:first-of-type,.tr-pill,.tr-input,.tr-btn{display:none!important}.tr-wrap{padding:0!important;max-width:100%!important}}
  .tr-naia-box{background:rgba(139,32,53,0.04);border-left:3px solid var(--accent);padding:32px;margin:40px 0}
`;


function TrendLoader() {
  const [msgIndex, setMsgIndex] = React.useState(0);
  const messages = [
    "Scanning the runways...",
    "Filtering through editorial signals...",
    "Identifying what's rising...",
    "Reading between the trend lines...",
    "Connecting trends to feeling...",
    "Writing your report...",
  ];

  React.useEffect(() => {
    const interval = setInterval(() => {
      setMsgIndex(prev => (prev + 1) % messages.length);
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div style={{ textAlign: "center", padding: "80px 0" }}>
      <div style={{ display: "flex", justifyContent: "center", gap: "8px", marginBottom: "32px" }}>
        {[0,1,2].map(i => (
          <div key={i} style={{
            width: "8px", height: "8px", borderRadius: "50%", background: "#8b2035",
            animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
            opacity: 0.7
          }} />
        ))}
      </div>
      <p style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "20px", fontStyle: "italic", color: "#7a6f6a", transition: "all 0.5s" }}>
        {messages[msgIndex]}
      </p>
      <style>{`@keyframes pulse { 0%,100%{transform:scale(1);opacity:0.7} 50%{transform:scale(1.4);opacity:1} }`}</style>
    </div>
  );
}

export default function TrendReports() {
  const [query, setQuery] = useState("");
  const [reportType, setReportType] = useState("category");
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);

  const reportTypes = [
    { id: "category", label: "Category Deep Dive" },
    { id: "seasonal", label: "Seasonal Trends" },
    { id: "runway", label: "Fashion Week" },
    { id: "color", label: "Color Trends" },
    { id: "brand", label: "Brand Profile" },
    { id: "accessories", label: "Accessory Watch" },
    { id: "emerging", label: "Emerging Brands" },
  ];

  const placeholders = {
    category: "e.g., Designer bags 2026, Denim 2026",
    seasonal: "e.g., Spring 2026 trends",
    runway: "e.g., Paris Fashion Week Fall 2026",
    color: "e.g., Spring 2026 color stories",
    brand: "e.g., LOEWE Spring 2026",
    accessories: "e.g., Jewelry trends 2026",
    emerging: "e.g., New designers to watch 2026",
  };

  async function generateReport() {
    if (!query.trim()) return;
    setLoading(true);
    setReport(null);
    setError(null);
    try {
      const response = await fetch("/api/generate-trend-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, reportType }),
      });
      const data = await response.json();
      if (data.error) throw new Error(data.error);
      setReport(data.report);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f4f4f1" }}>
      <style>{css}</style>
      <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,900&family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />

      <div className="tr-topbar">
        <div className="tr-topbar-logo">nAia</div>
        <Link to="/apps/naia-stylist/" className="tr-topbar-link">← Dashboard</Link>
      </div>

      <div className="tr-wrap">
        <h1 className="tr-headline">Trend Reports</h1>
        <p className="tr-sub">Fashion intelligence filtered through your style DNA.</p>

        {/* Report type */}
        <div style={{ marginBottom: "32px" }}>
          <span className="tr-label">Report type</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            {reportTypes.map(t => (
              <button key={t.id} onClick={() => setReportType(t.id)} className={`tr-pill${reportType === t.id ? " on" : ""}`}>{t.label}</button>
            ))}
          </div>
        </div>

        {/* Input */}
        <div style={{ marginBottom: "48px" }}>
          <span className="tr-label">What would you like a report on?</span>
          <input
            className="tr-input"
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === "Enter" && generateReport()}
            placeholder={placeholders[reportType]}
          />
          <button className="tr-btn" onClick={generateReport} disabled={!query.trim() || loading}>
            {loading ? "Generating Report..." : "Generate Report →"}
          </button>
        </div>

        {/* Loading */}
        {loading && <TrendLoader />}

        {/* Error */}
        {error && (
          <div style={{ padding: "24px", border: "1px solid rgba(139,32,53,0.2)", background: "rgba(139,32,53,0.04)", fontFamily: "'Cormorant Garamond',serif", fontSize: "16px", fontStyle: "italic", color: "#8b2035" }}>
            {error}
          </div>
        )}

        {/* Report */}
        {report && !loading && (
          <div>
            {/* Report header */}
            <div style={{ background: "#221516", color: "#f4f4f1", padding: "60px 48px", marginBottom: "48px" }}>
              <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "8px", letterSpacing: "3px", textTransform: "uppercase", color: "#8b2035", marginBottom: "20px" }}>
                nAia Trend Intelligence · {new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}
              </div>
              <h2 style={{ fontFamily: "'Playfair Display',serif", fontSize: "clamp(28px,4vw,44px)", fontWeight: 900, fontStyle: "italic", lineHeight: 1.1, marginBottom: "24px" }}>
                {report.title}
              </h2>
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
            {(report.rising?.length > 0 || report.fading?.length > 0) && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "32px", marginBottom: "48px" }}>
                {report.rising?.length > 0 && (
                  <div>
                    <div className="tr-section-label">What's Rising</div>
                    <div>{report.rising.map((r, i) => <span key={i} className="tr-tag rising">{r}</span>)}</div>
                  </div>
                )}
                {report.fading?.length > 0 && (
                  <div>
                    <div className="tr-section-label">What's Fading</div>
                    <div>{report.fading.map((f, i) => <span key={i} className="tr-tag fading">{f}</span>)}</div>
                  </div>
                )}
              </div>
            )}

            <div className="tr-divider" />

            {/* Brands to watch */}
            {report.brandsToWatch?.length > 0 && (
              <div style={{ marginBottom: "48px" }}>
                <div className="tr-section-label">Brands & Designers to Watch</div>
                {report.brandsToWatch.map((b, i) => (
                  <div key={i} className="tr-brand-card">
                    <div className="tr-brand-name">{b.name}</div>
                    <div className="tr-brand-why">{b.why}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Investment notes */}
            {report.investmentNotes && (
              <div style={{ marginBottom: "48px" }}>
                <div className="tr-section-label">Investment Notes</div>
                <p className="tr-body">{report.investmentNotes}</p>
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

            {/* How to wear */}
            {report.howToWear?.length > 0 && (
              <div style={{ marginBottom: "48px" }}>
                <div className="tr-section-label">How to Wear This Trend</div>
                {report.howToWear.map((h, i) => (
                  <div key={i} className="tr-how-card">
                    <div className="tr-how-feeling">If you want to feel {h.feeling}</div>
                    <div className="tr-how-text">{h.direction}</div>
                  </div>
                ))}
              </div>
            )}

            <div className="tr-divider" />

            {/* Wardrobe note */}
            {report.wardrobeNote && (
              <div style={{ marginBottom: "60px" }}>
                <div className="tr-section-label">What This Means for Your Wardrobe</div>
                <p className="tr-body">{report.wardrobeNote}</p>
              </div>
            )}

            {/* Footer */}
            <div style={{ textAlign: "center", paddingTop: "40px", borderTop: "1px solid rgba(59,5,16,.08)" }}>
              <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "8px", letterSpacing: "2px", textTransform: "uppercase", color: "#7a6f6a", marginBottom: "24px" }}>
                Generated by nAia · Fashion intelligence for how you want to feel
              </div>
              <button
                onClick={() => {
                  const { jsPDF } = window.jspdf;
                  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
                  const pageW = doc.internal.pageSize.getWidth();
                  const margin = 20;
                  const maxW = pageW - margin * 2;
                  let y = 20;

                  const addText = (text, size, style, color, spaceAfter) => {
                    doc.setFontSize(size);
                    doc.setFont("helvetica", style || "normal");
                    doc.setTextColor(...(color || [34, 21, 22]));
                    const lines = doc.splitTextToSize(String(text || ""), maxW);
                    lines.forEach(line => {
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
                  doc.text("TREND INTELLIGENCE · " + new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" }).toUpperCase(), margin, y); y += 10;

                  doc.setDrawColor(34, 21, 22);
                  doc.line(margin, y, pageW - margin, y); y += 10;

                  // Title
                  addText(report.title, 20, "bold", [34, 21, 22], 6);
                  addText(report.editorialIntro, 11, "italic", [122, 111, 106], 10);

                  // Key trends
                  addText("KEY DIRECTIONS", 8, "bold", [139, 32, 53], 4);
                  (report.keyTrends || []).forEach((t, i) => {
                    addText(`${i+1}. ${t.name}`, 12, "bold", [34, 21, 22], 2);
                    addText(t.description, 10, "normal", [34, 21, 22], 6);
                  });

                  // Rising / Fading
                  if (report.rising?.length) { addText("WHAT'S RISING", 8, "bold", [139, 32, 53], 3); addText(report.rising.join("  ·  "), 10, "normal", [34, 21, 22], 8); }
                  if (report.fading?.length) { addText("WHAT'S FADING", 8, "bold", [139, 32, 53], 3); addText(report.fading.join("  ·  "), 10, "normal", [122, 111, 106], 8); }

                  // Brands
                  if (report.brandsToWatch?.length) {
                    addText("BRANDS TO WATCH", 8, "bold", [139, 32, 53], 4);
                    report.brandsToWatch.forEach(b => { addText(`${b.name} — ${b.why}`, 10, "normal", [34, 21, 22], 4); });
                    y += 4;
                  }

                  // Investment
                  if (report.investmentNotes) { addText("INVESTMENT NOTES", 8, "bold", [139, 32, 53], 3); addText(report.investmentNotes, 10, "normal", [34, 21, 22], 8); }

                  // nAia interpretation
                  if (report.naiaInterpretation) {
                    doc.setFillColor(250, 245, 242);
                    doc.rect(margin - 2, y - 2, maxW + 4, 40, "F");
                    doc.setDrawColor(139, 32, 53);
                    doc.setLineWidth(0.8);
                    doc.line(margin, y - 2, margin, y + 38);
                    doc.setLineWidth(0.2);
                    addText("NAIA INTERPRETATION", 8, "bold", [139, 32, 53], 3);
                    addText(report.naiaInterpretation, 11, "italic", [34, 21, 22], 8);
                  }

                  // How to wear
                  if (report.howToWear?.length) {
                    addText("HOW TO WEAR THIS TREND", 8, "bold", [139, 32, 53], 4);
                    report.howToWear.forEach(h => { addText(`If you want to feel ${h.feeling}: ${h.direction}`, 10, "normal", [34, 21, 22], 4); });
                    y += 4;
                  }

                  // Wardrobe note
                  if (report.wardrobeNote) { addText("WHAT THIS MEANS FOR YOUR WARDROBE", 8, "bold", [139, 32, 53], 3); addText(report.wardrobeNote, 10, "normal", [34, 21, 22], 8); }

                  // Footer
                  doc.setFontSize(7);
                  doc.setFont("helvetica", "normal");
                  doc.setTextColor(122, 111, 106);
                  doc.text("Generated by nAia · Fashion intelligence for how you want to feel", margin, 285);

                  const filename = (report.title || "nAia Trend Report").replace(/[^a-z0-9]/gi, "-").toLowerCase() + ".pdf";
                  doc.save(filename);
                }}
                style={{ display: "inline-flex", alignItems: "center", gap: "10px", padding: "14px 32px", border: "none", background: "#221516", fontFamily: "'Space Mono',monospace", fontSize: "9px", letterSpacing: "2px", textTransform: "uppercase", color: "#f4f4f1", cursor: "pointer" }}
              >
                ↓ Download PDF
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
