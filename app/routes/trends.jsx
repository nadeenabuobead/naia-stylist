import { useState } from "react";
import { Link } from "react-router";

export default function TrendReports() {
  const [query, setQuery] = useState("");
  const [reportType, setReportType] = useState("seasonal");
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState(null);
  const [expandedSections, setExpandedSections] = useState({});

  const toggleSection = (section) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  async function generateReport() {
    if (!query.trim()) return;
    
    setLoading(true);
    setReport(null);
    setExpandedSections({});

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
    { id: "runway", label: "Fashion Week", placeholder: "e.g., Paris Fashion Week Fall 2026" },
    { id: "category", label: "Category Deep Dive", placeholder: "e.g., Designer bags, Denim" },
    { id: "color", label: "Color Trends", placeholder: "e.g., Spring 2026 colors" },
    { id: "brand", label: "Brand Profile", placeholder: "e.g., LOEWE Spring 2026" },
    { id: "accessories", label: "Accessory Watch", placeholder: "e.g., Spring 2026 bags" },
    { id: "emerging", label: "Emerging Brands", placeholder: "e.g., New designers to watch" },
  ];

  const currentType = reportTypes.find(t => t.id === reportType);

  return (
    <div style={{ minHeight: "100vh", background: "#f4f4f1" }}>
      <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,400&family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />
      
      <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "60px 40px" }}>
        
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "60px" }}>
          <div>
            <h1 style={{ fontFamily: "'Playfair Display',serif", fontSize: "clamp(48px,6vw,72px)", fontWeight: 900, lineHeight: 1, marginBottom: "12px" }}>
              Personalized Trends
            </h1>
            <p style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "20px", fontStyle: "italic", color: "#7a6f6a" }}>
              Trend reports filtered through your style DNA.
            </p>
          </div>
          <Link to="/" style={{ fontFamily: "'Space Mono',monospace", fontSize: "9px", letterSpacing: "2px", textTransform: "uppercase", color: "#8b2035", textDecoration: "none" }}>
            ← DASHBOARD
          </Link>
        </div>

        {/* Report Type Selection */}
        <div style={{ background: "rgba(255,255,255,0.5)", padding: "32px", marginBottom: "32px", border: "1px solid rgba(59,5,16,0.06)" }}>
          <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "7px", letterSpacing: "2px", textTransform: "uppercase", color: "#7a6f6a", marginBottom: "16px" }}>REPORT TYPE</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "12px" }}>
            {reportTypes.map(type => (
              <button
                key={type.id}
                onClick={() => setReportType(type.id)}
                style={{
                  padding: "16px",
                  background: reportType === type.id ? "rgba(139,32,53,0.08)" : "rgba(255,255,255,0.7)",
                  border: reportType === type.id ? "1px solid rgba(139,32,53,0.2)" : "1px solid rgba(59,5,16,0.08)",
                  cursor: "pointer",
                  fontFamily: "'Cormorant Garamond',serif",
                  fontSize: "16px",
                  fontStyle: "italic",
                  color: reportType === type.id ? "#8b2035" : "#221516",
                  transition: "all 0.2s"
                }}
              >
                {type.label}
              </button>
            ))}
          </div>
        </div>

        {/* Query Input */}
        <div style={{ background: "rgba(255,255,255,0.8)", padding: "40px", marginBottom: "40px", border: "1px solid rgba(59,5,16,0.06)" }}>
          <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "7px", letterSpacing: "2px", textTransform: "uppercase", color: "#7a6f6a", marginBottom: "16px" }}>
            {currentType?.label.toUpperCase()}
          </div>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyPress={(e) => e.key === "Enter" && generateReport()}
            placeholder={currentType?.placeholder}
            style={{
              width: "100%",
              padding: "20px",
              border: "1px solid rgba(59,5,16,0.1)",
              fontSize: "20px",
              fontFamily: "'Cormorant Garamond',serif",
              fontStyle: "italic",
              boxSizing: "border-box",
              background: "rgba(255,255,255,0.7)",
              marginBottom: "24px"
            }}
          />
          <button
            onClick={generateReport}
            disabled={!query.trim() || loading}
            style={{
              width: "100%",
              padding: "20px",
              background: query.trim() && !loading ? "#8b2035" : "#d4cfc9",
              color: "#f4f4f1",
              border: "none",
              fontSize: "14px",
              letterSpacing: "2px",
              textTransform: "uppercase",
              cursor: query.trim() && !loading ? "pointer" : "default",
              fontFamily: "'Space Mono',monospace"
            }}
          >
            {loading ? "Generating Report..." : "Generate Trend Report"}
          </button>
        </div>

        {/* Loading State */}
        {loading && (
          <div style={{ background: "rgba(255,255,255,0.5)", padding: "80px 40px", textAlign: "center", border: "1px solid rgba(59,5,16,0.06)" }}>
            <div style={{ fontFamily: "'Playfair Display',serif", fontSize: "48px", marginBottom: "20px", opacity: 0.2 }}>◇</div>
            <p style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "20px", fontStyle: "italic", color: "#7a6f6a" }}>
              Analyzing trends and filtering through your style DNA...
            </p>
          </div>
        )}

        {/* Report Display */}
        {report && !loading && (
          <div style={{ background: "#ffffff", border: "1px solid rgba(59,5,16,0.06)" }}>
            
            {/* Report Header */}
            <div style={{ background: "#221516", padding: "60px 40px", textAlign: "center" }}>
              <div style={{ fontFamily: "'Playfair Display',serif", fontSize: "clamp(32px,5vw,48px)", fontWeight: 900, color: "#f4f4f1", marginBottom: "16px" }}>
                nAia Trend Report
              </div>
              <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "8px", letterSpacing: "3px", textTransform: "uppercase", color: "#8b2035", marginBottom: "24px" }}>
                PERSONALIZED FOR YOU
              </div>
              <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "24px", fontStyle: "italic", color: "#f4f4f1", marginBottom: "16px", lineHeight: 1.4 }}>
                {report.title}
              </div>
              <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "9px", color: "#7a6f6a", letterSpacing: "2px" }}>
                {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
              </div>
            </div>

            {/* Report Content */}
            <div style={{ padding: "60px 40px" }}>
              {Object.entries(report.sections || {}).map(([key, content]) => (
                <div key={key} style={{ borderBottom: "1px solid rgba(59,5,16,0.06)", paddingBottom: "40px", marginBottom: "40px" }}>
                  <button
                    onClick={() => toggleSection(key)}
                    style={{
                      width: "100%",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "0",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      marginBottom: "24px"
                    }}
                  >
                    <h3 style={{ fontFamily: "'Playfair Display',serif", fontSize: "28px", fontWeight: 700, margin: 0, color: "#221516" }}>
                      {key.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase())}
                    </h3>
                    <span style={{ fontFamily: "'Playfair Display',serif", fontSize: "32px", color: "#8b2035" }}>
                      {expandedSections[key] ? "−" : "+"}
                    </span>
                  </button>
                  
                  {expandedSections[key] && (
                    <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "18px", lineHeight: 1.8, color: "#221516" }}>
                      {typeof content === "string" ? (
                        content.split("\n").map((para, i) => (
                          <p key={i} style={{ marginBottom: "16px" }}>{para}</p>
                        ))
                      ) : (
                        <div dangerouslySetInnerHTML={{ __html: content }} />
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Footer */}
            <div style={{ padding: "32px 40px", background: "rgba(244,244,241,0.5)", borderTop: "1px solid rgba(59,5,16,0.06)", textAlign: "center" }}>
              <p style={{ fontFamily: "'Space Mono',monospace", fontSize: "8px", letterSpacing: "2px", textTransform: "uppercase", color: "#7a6f6a", margin: 0 }}>
                Generated by nAia • Filtered through your style DNA
              </p>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
