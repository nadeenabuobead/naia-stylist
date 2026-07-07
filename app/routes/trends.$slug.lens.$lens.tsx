import { Link, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { trendReports, type TrendReportData } from "../lib/trend-reports";
import {
  PROFESSIONAL_LENS_CONTENT,
  LENS_LABELS,
  VALID_LENSES,
  type LensKey,
  type LensModule,
} from "../lib/professional-lens-content";

type LoaderData = {
  report: TrendReportData;
  lens: LensKey;
  modules: LensModule[];
};

export async function loader({ params }: LoaderFunctionArgs) {
  const report = trendReports.find((r) => r.slug === params.slug && r.published);
  if (!report) throw new Response("Not Found", { status: 404 });

  const lens = params.lens ?? "";
  if (!VALID_LENSES.has(lens)) throw new Response("Not Found", { status: 404 });

  const reportLenses = PROFESSIONAL_LENS_CONTENT[report.slug];
  if (!reportLenses) throw new Response("Not Found", { status: 404 });

  const lensKey = lens as LensKey;
  return { report, lens: lensKey, modules: reportLenses[lensKey].modules } satisfies LoaderData;
}

export function meta({ data }: { data?: LoaderData }) {
  if (!data) return [{ title: "Not Found | nAia" }];
  const lensLabel = LENS_LABELS[data.lens];
  return [
    { title: `${data.report.title} — ${lensLabel} Lens | nAia` },
    { name: "description", content: `${lensLabel} perspective on ${data.report.title}.` },
  ];
}

const LENS_ORDER: LensKey[] = [
  "designer",
  "buyer",
  "marketer",
  "creative-director",
  "stylist",
];

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
  .tr-recap-link{font-family:var(--ff-mono);font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--accent);text-decoration:none}
  .tr-lens-nav{margin-bottom:48px}
  .tr-lens-nav-label{font-family:var(--ff-mono);font-size:9px;letter-spacing:3px;text-transform:uppercase;color:var(--muted);margin-bottom:16px}
  .tr-lens-nav-row{display:flex;flex-wrap:wrap;gap:8px}
  .tr-lens-btn{display:inline-block;padding:10px 20px;font-family:var(--ff-mono);font-size:9px;letter-spacing:2px;text-transform:uppercase;text-decoration:none;border:1px solid rgba(59,5,16,.2);color:var(--deep);transition:background .15s,color .15s,border-color .15s}
  .tr-lens-btn:hover{border-color:var(--accent);color:var(--accent)}
  .tr-lens-btn.active{background:var(--deep);color:var(--cream);border-color:var(--deep)}
  .tr-lens-btn.for-you{border-color:var(--accent);color:var(--accent)}
  .tr-lens-btn.for-you:hover{background:var(--accent);color:var(--cream)}
  .tr-module{margin-bottom:40px}
  .tr-decision{padding:28px 32px;border-left:3px solid var(--accent);background:rgba(139,32,53,0.04);margin-top:48px}
  .tr-footer{text-align:center;padding:40px 0;border-top:1px solid rgba(59,5,16,.08);margin-top:60px}
  .tr-footer-note{font-family:var(--ff-mono);font-size:8px;letter-spacing:2px;text-transform:uppercase;color:var(--muted)}
  @media(max-width:600px){.tr-wrap{padding:40px 24px}.tr-topbar{padding:16px 24px}.tr-recap{padding:20px}}
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
          This lens could not be found.
        </p>
      </div>
    </div>
  );
}

export default function TrendLens() {
  const { report, lens, modules } = useLoaderData() as LoaderData;
  const lensLabel = LENS_LABELS[lens];

  // Separate THE DECISION from preceding analytical modules
  const decisionModule = modules[modules.length - 1];
  const analyticalModules = modules.slice(0, -1);

  return (
    <div style={{ minHeight: "100vh", background: "#f4f4f1" }}>
      <style>{css}</style>
      <link
        href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,900&family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300&family=Space+Mono:wght@400;700&display=swap"
        rel="stylesheet"
      />

      <div className="tr-topbar">
        <div className="tr-topbar-logo">nAia</div>
        <Link to="/trends" className="tr-topbar-link">← All Reports</Link>
      </div>

      <div className="tr-wrap">
        {/* Report reference — brief anchor back to the public report */}
        <div className="tr-recap">
          <div className="tr-recap-season">{report.season}</div>
          <div className="tr-recap-title">{report.title}</div>
          <Link to={`/trends/${report.slug}`} className="tr-recap-link">
            Read the full report →
          </Link>
        </div>

        {/* Lens heading */}
        <div style={{ marginBottom: "32px" }}>
          <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "9px", letterSpacing: "3px", textTransform: "uppercase", color: "#7a6f6a", marginBottom: "8px" }}>
            Professional Lens
          </div>
          <h1 style={{ fontFamily: "'Playfair Display',serif", fontSize: "clamp(26px,3.5vw,38px)", fontWeight: 900, fontStyle: "italic", color: "#221516" }}>
            {lensLabel}
          </h1>
        </div>

        {/* Lens navigation */}
        <div className="tr-lens-nav">
          <div className="tr-lens-nav-label">Read this through a lens</div>
          <div className="tr-lens-nav-row">
            <Link
              to={`/trends/${report.slug}/edit`}
              className="tr-lens-btn for-you"
            >
              For You
            </Link>
            {LENS_ORDER.map((key) => (
              <Link
                key={key}
                to={`/trends/${report.slug}/lens/${key}`}
                className={`tr-lens-btn${lens === key ? " active" : ""}`}
              >
                {LENS_LABELS[key]}
              </Link>
            ))}
          </div>
        </div>

        <div className="tr-divider" />

        {/* Analytical modules */}
        {analyticalModules.map((mod: LensModule, i: number) => (
          <div key={i} className="tr-module">
            <div className="tr-section-label">{mod.label}</div>
            <p className="tr-body">{mod.body}</p>
            {i < analyticalModules.length - 1 && (
              <div style={{ height: "1px", background: "rgba(59,5,16,.06)", margin: "32px 0 0" }} />
            )}
          </div>
        ))}

        {/* THE DECISION — always rendered last, with distinct treatment */}
        <div className="tr-decision">
          <div className="tr-section-label">{decisionModule.label}</div>
          <p className="tr-body">{decisionModule.body}</p>
        </div>

        {/* Footer */}
        <div className="tr-footer">
          <div className="tr-footer-note">nAia Trend Intelligence · {report.season}</div>
        </div>
      </div>
    </div>
  );
}
