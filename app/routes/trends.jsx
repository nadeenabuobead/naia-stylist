import { useState } from "react";

export default function TrendReports() {
  const [query, setQuery] = useState("");
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
        body: JSON.stringify({ query }),
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

  return (
    <div style={s.container}>
      <h1 style={s.title}>AI Trend Intelligence Generator</h1>
      <p style={s.subtitle}>Generate trend reports from fashion sources</p>

      <div style={s.inputSection}>
        <input
          type="text"
          placeholder="e.g., 'Spring 2026 color trends' or 'Quiet luxury styling'"
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
          <p style={s.loadingText}>Searching fashion sources and analyzing trends...</p>
        </div>
      )}

      {report && (
        <div style={s.reportBox}>
          <div style={s.reportHeader}>
            <h2 style={s.reportTitle}>Trend Report</h2>
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
    alignItems: "center",
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