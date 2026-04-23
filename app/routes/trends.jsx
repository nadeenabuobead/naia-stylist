import { useState } from "react";

export default function TrendReports() {
  const [query, setQuery] = useState("");
  const [reportType, setReportType] = useState("seasonal");
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState(null);

  async function generateReport() {
    if (!query.trim()) return;
    
    setLoading(true);
    setReport(null);

    try {
      const response = await fetch("/api/generate-trend-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, reportType }),
      });

      const data = await response.json();
      setReport(data.report);
    } catch (err) {
      console.error(err);
      alert("Failed to generate report");
    } finally {
      setLoading(false);
    }
  }

  const reportTypes = [
    { id: "seasonal", label: "Seasonal Trends", placeholder: "e.g., Spring 2026 trends" },
    { id: "runway", label: "Fashion Week Review", placeholder: "e.g., Paris Fashion Week Fall 2026" },
    { id: "category", label: "Category Deep Dive", placeholder: "e.g., Designer bags, Denim, Outerwear" },
    { id: "color", label: "Color Trends", placeholder: "e.g., Spring 2026 color palette" },
    { id: "brand", label: "Brand Profile", placeholder: "e.g., LOEWE Spring 2026 collection" },
  ];

  const currentType = reportTypes.find(t => t.id === reportType);

  return (
    <div style={s.container}>
      <h1 style={s.title}>AI Fashion Intelligence</h1>
      <p style={s.subtitle}>Generate authoritative trend reports from fashion sources</p>

      {/* Report Type Selector */}
      <div style={{ marginBottom: "24px" }}>
        <div style={{ fontSize: "11px", letterSpacing: "0.2em", textTransform: "uppercase", color: "#8a7f75", marginBottom: "12px" }}>
          Report Type
        </div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          {reportTypes.map(type => (
            <button
              key={type.id}
              onClick={() => setReportType(type.id)}
              style={{
                padding: "10px 16px",
                fontSize: "12px",
                letterSpacing: "0.05em",
                fontFamily: '"Cormorant Garamond", Georgia, serif',
                background: reportType === type.id ? "#1a1816" : "#eee9e2",
                color: reportType === type.id ? "#f5f2ee" : "#1a1816",
                border: "none",
                borderRadius: "2px",
                cursor: "pointer",
              }}
            >
              {type.label}
            </button>
          ))}
        </div>
      </div>

      {/* Input Section */}
      <div style={s.inputSection}>
        <input
          type="text"
          placeholder={currentType?.placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && generateReport()}
          style={s.input}
        />
        <button onClick={generateReport} disabled={loading || !query.trim()} style={s.button}>
          {loading ? "Generating..." : "Generate Report"}
        </button>
      </div>

      {loading && (
        <div style={s.loadingBox}>
          <p style={s.loadingText}>Analyzing fashion sources and generating {currentType?.label.toLowerCase()}...</p>
        </div>
      )}

      {report && (
        <div style={s.reportBox}>
          <div style={s.reportHeader}>
            <div>
              <h2 style={s.reportTitle}>{currentType?.label}</h2>
              <p style={{ fontSize: "13px", color: "#8a7f75", margin: "4px 0 0", fontStyle: "italic" }}>{query}</p>
            </div>
            <button onClick={() => navigator.clipboard.writeText(report)} style={s.copyButton}>
              Copy Report
            </button>
          </div>
          <div style={s.reportContent}>
            {report.split('\n\n').map((paragraph, i) => (
              <p key={i} style={s.paragraph}>{paragraph}</p>
            ))}
          </div>
          
          
        </div>
      )}
    </div>
  );
}

const s = {
  container: {
    maxWidth: "900px",
    margin: "0 auto",
    padding: "48px 24px",
    fontFamily: '"Cormorant Garamond", Georgia, serif',
  },
  title: {
    fontSize: "36px",
    fontWeight: 400,
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    color: "#1a1816",
    margin: "0 0 8px",
  },
  subtitle: {
    fontSize: "15px",
    fontStyle: "italic",
    color: "#8a7f75",
    margin: "0 0 48px",
  },
  inputSection: {
    display: "flex",
    gap: "12px",
    marginBottom: "32px",
  },
  input: {
    flex: 1,
    padding: "16px",
    fontSize: "15px",
    fontFamily: '"Cormorant Garamond", Georgia, serif',
    border: "1px solid #d4cfc9",
    borderRadius: "4px",
    outline: "none",
  },
  button: {
    padding: "16px 32px",
    fontSize: "13px",
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    fontFamily: '"Cormorant Garamond", Georgia, serif',
    background: "#1a1816",
    color: "#f5f2ee",
    border: "none",
    borderRadius: "4px",
    cursor: "pointer",
    fontWeight: 500,
    whiteSpace: "nowrap",
  },
  loadingBox: {
    padding: "32px",
    background: "#f5f2ee",
    borderRadius: "4px",
    textAlign: "center",
  },
  loadingText: {
    fontSize: "14px",
    color: "#8a7f75",
    fontStyle: "italic",
    margin: 0,
  },
  reportBox: {
    background: "#fff",
    border: "1px solid #d4cfc9",
    borderRadius: "4px",
    padding: "32px",
  },
  reportHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: "24px",
    paddingBottom: "16px",
    borderBottom: "1px solid #d4cfc9",
  },
  reportTitle: {
    fontSize: "24px",
    fontWeight: 500,
    color: "#1a1816",
    margin: 0,
  },
  copyButton: {
    padding: "8px 16px",
    fontSize: "11px",
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    fontFamily: '"Cormorant Garamond", Georgia, serif',
    background: "transparent",
    color: "#1a1816",
    border: "1px solid #1a1816",
    borderRadius: "4px",
    cursor: "pointer",
  },
  reportContent: {
    lineHeight: 1.8,
  },
  paragraph: {
    fontSize: "15px",
    color: "#1a1816",
    margin: "0 0 16px",
  },
};