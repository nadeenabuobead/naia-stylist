import { Link } from "react-router";
import { trendReports } from "../lib/trend-reports";

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
  .tr-section-label{font-family:var(--ff-mono);font-size:9px;letter-spacing:3px;text-transform:uppercase;color:var(--accent);margin-bottom:16px}
  .tr-card-grid{display:grid;gap:24px}
  .tr-card{display:block;padding:32px;border:1px solid rgba(59,5,16,.08);background:rgba(255,255,255,0.5);text-decoration:none;color:var(--deep);transition:border-color .2s}
  .tr-card:hover{border-color:var(--accent)}
  .tr-card-season{font-family:var(--ff-mono);font-size:9px;letter-spacing:3px;text-transform:uppercase;color:var(--accent);margin-bottom:14px}
  .tr-card-title{font-family:var(--ff-display);font-size:28px;font-weight:900;font-style:italic;color:var(--deep);margin-bottom:12px;line-height:1.15}
  .tr-card-summary{font-family:var(--ff-body);font-size:16px;font-style:italic;color:var(--muted);line-height:1.6;margin-bottom:16px}
  .tr-card-meta{display:flex;justify-content:space-between;align-items:center}
  .tr-card-date{font-family:var(--ff-mono);font-size:9px;letter-spacing:1px;text-transform:uppercase;color:var(--muted)}
  .tr-card-cta{font-family:var(--ff-mono);font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--accent)}
  .tr-empty{padding:48px 0;font-family:var(--ff-body);font-size:18px;font-style:italic;color:var(--muted)}
`;

export default function TrendReports() {
  const publishedReports = trendReports
    .filter((r) => r.published)
    .sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));

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
        <p className="tr-sub">Curated fashion intelligence from the nAia editorial team.</p>

        <div className="tr-section-label">Latest Reports</div>

        {publishedReports.length > 0 ? (
          <div className="tr-card-grid">
            {publishedReports.map((report) => (
              <Link key={report.slug} to={`/trends/${report.slug}`} className="tr-card">
                <div className="tr-card-season">{report.season}</div>
                <div className="tr-card-title">{report.title}</div>
                <p className="tr-card-summary">{report.summary}</p>
                <div className="tr-card-meta">
                  <span className="tr-card-date">
                    {new Date(report.publishedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                  </span>
                  <span className="tr-card-cta">Read the report →</span>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <p className="tr-empty">Trend reports are being updated.</p>
        )}
      </div>
    </div>
  );
}
