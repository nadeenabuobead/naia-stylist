import { useState } from "react";
import jsPDF from "jspdf";

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

  const downloadReport = () => {
    const doc = new jsPDF();
    
    // Cover page - Vogue style
    doc.setFontSize(48);
    doc.setFont(undefined, 'normal');
    doc.text('nAia', 105, 80, { align: 'center' });
    
    doc.setFontSize(11);
    doc.setTextColor(138, 127, 117);
    doc.text('FASHION INTELLIGENCE', 105, 100, { align: 'center' });
    
    doc.setFontSize(16);
    doc.setTextColor(26, 24, 22);
    doc.text(query.toUpperCase(), 105, 140, { align: 'center', maxWidth: 160 });
    
    doc.setFontSize(9);
    doc.text(currentType?.label.toUpperCase(), 105, 155, { align: 'center' });
    
    doc.setTextColor(138, 127, 117);
    doc.text(`${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`, 105, 260, { align: 'center' });
    
    doc.addPage();
    let y = 40;
    const lines = report.split('\n');
    doc.setTextColor(26, 24, 22);
    
    lines.forEach(line => {
      if (y > 270) {
        doc.addPage();
        y = 40;
      }
      
      if (line.startsWith('## ')) {
        y += 12;
        doc.setFontSize(10);
        doc.setFont(undefined, 'bold');
        const text = line.replace('## ', '');
        doc.text(text, 105, y, { align: 'center' });
        doc.setLineWidth(0.3);
        doc.line(70, y + 2, 140, y + 2);
        y += 10;
        doc.setFont(undefined, 'normal');
      } else if (line.match(/^\*\*.+\*\*$/)) {
        doc.setFontSize(9);
        doc.setFont(undefined, 'bold');
        y += 6;
        doc.text(line.replace(/\*\*/g, ''), 25, y);
        y += 5;
        doc.setFont(undefined, 'normal');
      } else if (line.trim()) {
        doc.setFontSize(9);
        const splitText = doc.splitTextToSize(line, 160);
        doc.text(splitText, 25, y);
        y += splitText.length * 5;
      } else {
        y += 4;
      }
    });
    
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      if (i > 1) {
        doc.setFontSize(7);
        doc.setTextColor(138, 127, 117);
        doc.text('nAia', 105, 285, { align: 'center' });
        doc.text(`${i - 1}`, 105, 290, { align: 'center' });
      }
    }
    
    doc.save(`${query.replace(/\s+/g, '-').toLowerCase()}-trend-report.pdf`);
  };

  // Parse sections
  const parsedSections = report ? (() => {
    const sections = [];
    const lines = report.split('\n');
    let currentSection = null;
    let currentContent = [];
    
    lines.forEach(line => {
      if (line.startsWith('## ')) {
        if (currentSection) {
          sections.push({ title: currentSection, content: currentContent.join('\n') });
        }
        currentSection = line.replace('## ', '');
        currentContent = [];
      } else if (currentSection) {
        currentContent.push(line);
      }
    });
    
    if (currentSection) {
      sections.push({ title: currentSection, content: currentContent.join('\n') });
    }
    
    return sections;
  })() : [];

  return (
    <div style={s.container}>
      {/* Header */}
      <div style={s.header}>
        <div style={s.logo}>nAia</div>
        <div style={s.tagline}>Fashion Intelligence</div>
        <p style={s.subtitle}>Authoritative trend reports from runway, retail, and market signals</p>
      </div>

      {/* Input Section */}
      <div style={s.inputCard}>
        <div style={s.label}>Report Type</div>
        <div style={s.typeGrid}>
          {reportTypes.map(type => (
            <button
              key={type.id}
              onClick={() => setReportType(type.id)}
              style={{
                ...s.typeButton,
                background: reportType === type.id ? "#1a1816" : "#fff",
                color: reportType === type.id ? "#f5f2ee" : "#1a1816",
                border: reportType === type.id ? "1px solid #1a1816" : "1px solid #d4cfc9"
              }}
            >
              {type.label}
            </button>
          ))}
        </div>

        <div style={{ marginTop: "32px" }}>
          <input
            type="text"
            placeholder={currentType?.placeholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && generateReport()}
            style={s.input}
          />
          <button 
            onClick={generateReport} 
            disabled={loading || !query.trim()} 
            style={{
              ...s.button,
              opacity: (loading || !query.trim()) ? 0.5 : 1,
              cursor: (loading || !query.trim()) ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "Generating..." : "Generate Report"}
          </button>
        </div>
      </div>

      {loading && (
        <div style={s.loadingBox}>
          <p style={s.loadingText}>Analyzing fashion sources and generating {currentType?.label.toLowerCase()}...</p>
        </div>
      )}

      {report && (
        <div style={s.reportContainer}>
          {/* Editorial Header */}
          <div style={s.reportHeader}>
            <div style={s.reportLogo}>nAia</div>
            <div style={s.reportSubtitle}>Fashion Intelligence</div>
            <div style={s.reportTitle}>{query}</div>
            <div style={s.reportMeta}>
              {currentType?.label} • {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
            </div>
          </div>

          {/* Action Buttons */}
          <div style={s.actionBar}>
            <button onClick={() => navigator.clipboard.writeText(report)} style={s.actionButton}>
              Copy Report
            </button>
            <button onClick={downloadReport} style={s.downloadButton}>
              Download PDF
            </button>
          </div>

          {/* Report Content */}
          <div style={s.reportContent}>
            {parsedSections.map((section, idx) => (
              <div key={idx} style={s.section}>
                <button
                  onClick={() => toggleSection(idx)}
                  style={s.sectionButton}
                >
                  {section.title}
                  <span style={s.sectionIcon}>
                    {expandedSections[idx] ? '−' : '+'}
                  </span>
                </button>
                
                {expandedSections[idx] && (
                  <div style={s.sectionContent}>
                    {section.content.split('\n').map((line, i) => {
                      if (line.match(/^\*\*.+\*\*$/)) {
                        return <h5 key={i} style={s.subheader}>{line.replace(/\*\*/g, '')}</h5>;
                      } else if (line.includes('**')) {
                        const parts = line.split(/(\*\*.*?\*\*)/g);
                        return (
                          <p key={i} style={s.paragraph}>
                            {parts.map((part, idx) => 
                              part.startsWith('**') && part.endsWith('**') 
                                ? <strong key={idx}>{part.replace(/\*\*/g, '')}</strong>
                                : part
                            )}
                          </p>
                        );
                      } else if (line.match(/^[\*\-]\s/)) {
                        return <li key={i} style={s.listItem}>{line.replace(/^[\*\-]\s/, '')}</li>;
                      } else if (line.trim()) {
                        return <p key={i} style={s.paragraph}>{line}</p>;
                      }
                      return <div key={i} style={{ height: '8px' }} />;
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Footer */}
          <div style={s.footer}>
            nAia Fashion Intelligence • Trend Analysis & Forecasting
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
  header: {
    textAlign: "center",
    marginBottom: "48px",
  },
  logo: {
    fontSize: "48px",
    fontWeight: 300,
    letterSpacing: "0.15em",
    color: "#1a1816",
    marginBottom: "8px",
  },
  tagline: {
    fontSize: "10px",
    letterSpacing: "0.3em",
    textTransform: "uppercase",
    color: "#8a7f75",
    marginBottom: "16px",
  },
  subtitle: {
    fontSize: "15px",
    fontStyle: "italic",
    color: "#8a7f75",
    margin: "0",
  },
  inputCard: {
    background: "#fff",
    border: "1px solid #d4cfc9",
    borderRadius: "4px",
    padding: "32px",
    marginBottom: "32px",
  },
  label: {
    fontSize: "10px",
    letterSpacing: "0.25em",
    textTransform: "uppercase",
    color: "#8a7f75",
    marginBottom: "16px",
    fontWeight: 600,
  },
  typeGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
    gap: "12px",
  },
  typeButton: {
    padding: "12px 16px",
    fontSize: "12px",
    letterSpacing: "0.05em",
    fontFamily: '"Cormorant Garamond", Georgia, serif',
    borderRadius: "2px",
    cursor: "pointer",
    transition: "all 0.2s",
  },
  input: {
    width: "100%",
    padding: "16px",
    fontSize: "15px",
    fontFamily: '"Cormorant Garamond", Georgia, serif',
    border: "1px solid #d4cfc9",
    borderRadius: "2px",
    outline: "none",
    marginBottom: "16px",
  },
  button: {
    width: "100%",
    padding: "16px 32px",
    fontSize: "12px",
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    fontFamily: '"Cormorant Garamond", Georgia, serif',
    background: "#1a1816",
    color: "#f5f2ee",
    border: "none",
    borderRadius: "2px",
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
  reportContainer: {
    background: "linear-gradient(to bottom, #fafafa 0%, #ffffff 100%)",
    borderRadius: "0",
    overflow: "hidden",
    boxShadow: "0 4px 20px rgba(0,0,0,0.08)",
  },
  reportHeader: {
    background: "#1a1816",
    padding: "48px 32px 32px",
    textAlign: "center",
    borderBottom: "1px solid #d4cfc9",
  },
  reportLogo: {
    fontSize: "42px",
    fontWeight: 300,
    letterSpacing: "0.15em",
    color: "#f5f2ee",
    marginBottom: "12px",
  },
  reportSubtitle: {
    fontSize: "10px",
    letterSpacing: "0.3em",
    textTransform: "uppercase",
    color: "#8a7f75",
    marginBottom: "24px",
  },
  reportTitle: {
    fontSize: "20px",
    fontWeight: 400,
    letterSpacing: "0.05em",
    color: "#f5f2ee",
    fontStyle: "italic",
    marginBottom: "16px",
    lineHeight: 1.4,
  },
  reportMeta: {
    fontSize: "10px",
    color: "#8a7f75",
    letterSpacing: "0.15em",
  },
  actionBar: {
    padding: "20px 32px",
    background: "#fafafa",
    borderBottom: "1px solid #e8e4df",
    display: "flex",
    justifyContent: "flex-end",
    gap: "12px",
  },
  actionButton: {
    fontSize: "10px",
    padding: "10px 20px",
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    background: "transparent",
    color: "#1a1816",
    border: "1px solid #1a1816",
    cursor: "pointer",
    fontFamily: '"Cormorant Garamond", Georgia, serif',
  },
  downloadButton: {
    fontSize: "10px",
    padding: "10px 20px",
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    background: "#1a1816",
    color: "#f5f2ee",
    border: "1px solid #1a1816",
    cursor: "pointer",
    fontFamily: '"Cormorant Garamond", Georgia, serif',
  },
  reportContent: {
    padding: "40px 32px",
  },
  section: {
    borderBottom: "1px solid #e8e4df",
  },
  sectionButton: {
    width: "100%",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "24px 0",
    background: "none",
    border: "none",
    cursor: "pointer",
    fontSize: "12px",
    letterSpacing: "0.2em",
    textTransform: "uppercase",
    fontWeight: 500,
    color: "#1a1816",
    fontFamily: '"Cormorant Garamond", Georgia, serif',
  },
  sectionIcon: {
    fontSize: "24px",
    fontWeight: 300,
    color: "#8a7f75",
  },
  sectionContent: {
    padding: "0 0 32px",
    lineHeight: 1.9,
    fontSize: "15px",
    color: "#1a1816",
  },
  subheader: {
    fontSize: "14px",
    fontWeight: 600,
    color: "#1a1816",
    margin: "20px 0 10px",
    letterSpacing: "0.02em",
  },
  paragraph: {
    margin: "0 0 12px",
  },
  listItem: {
    margin: "0 0 10px 24px",
    lineHeight: 1.8,
  },
  footer: {
    padding: "24px 32px",
    background: "#fafafa",
    borderTop: "1px solid #e8e4df",
    textAlign: "center",
    fontSize: "9px",
    letterSpacing: "0.15em",
    textTransform: "uppercase",
    color: "#8a7f75",
  },
};

