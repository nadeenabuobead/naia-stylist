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
  .tr-body{font-family:var(--ff-body);font-size:18px;line-height:1.8;color:var(--deep);white-space:pre-line}
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
  .tr-struct-intro{font-family:var(--ff-body);font-size:16px;line-height:1.7;color:var(--muted);font-style:italic;margin-bottom:16px}
  .tr-struct-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-top:12px}
  .tr-struct-card{padding:20px 24px;border:1px solid rgba(59,5,16,.1);background:rgba(255,255,255,.5);min-width:0;word-wrap:break-word}
  .tr-struct-label{font-family:var(--ff-mono);font-size:8px;letter-spacing:2.5px;text-transform:uppercase;color:var(--accent);margin-bottom:10px}
  .tr-struct-body{font-family:var(--ff-body);font-size:16px;line-height:1.7;color:var(--deep)}
  .tr-dec-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px}
  .tr-dec-card{padding:16px 20px;border:1px solid rgba(59,5,16,.1);background:rgba(255,255,255,.5)}
  .tr-dec-label{font-family:var(--ff-mono);font-size:8px;letter-spacing:2px;text-transform:uppercase;color:var(--accent);margin-bottom:8px}
  .tr-dec-body{font-family:var(--ff-body);font-size:15px;line-height:1.6;color:var(--deep)}
  .tr-avoid-row{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;margin-bottom:20px}
  .tr-avoid-chip{padding:7px 14px;border:1px solid rgba(139,32,53,.3);font-family:var(--ff-mono);font-size:8px;letter-spacing:2px;text-transform:uppercase;color:var(--accent)}
  .tr-avoid-close{font-family:var(--ff-body);font-size:16px;line-height:1.7;color:var(--muted);font-style:italic}
  .tr-proto-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px}
  .tr-proto-card{padding:20px 24px;border-left:2px solid var(--accent);background:rgba(255,255,255,.5)}
  .tr-proto-label{font-family:var(--ff-mono);font-size:8px;letter-spacing:2px;text-transform:uppercase;color:var(--accent);margin-bottom:10px}
  .tr-proto-body{font-family:var(--ff-body);font-size:15px;line-height:1.6;color:var(--deep)}
  .tr-check-list{margin-top:12px}
  .tr-check-row{display:flex;align-items:baseline;gap:14px;padding:12px 0;border-bottom:1px solid rgba(59,5,16,.06)}
  .tr-check-row:last-child{border-bottom:none}
  .tr-check-num{font-family:var(--ff-mono);font-size:9px;color:var(--accent);flex-shrink:0;width:20px}
  .tr-check-text{font-family:var(--ff-body);font-size:16px;line-height:1.65;color:var(--deep)}
  .tr-mod-divider{height:1px;background:rgba(59,5,16,.06);margin:32px 0 0}
  .tr-product-brief{margin-top:12px}
  .tr-product-row{padding:14px 0;border-bottom:1px solid rgba(59,5,16,.06)}
  .tr-product-row:last-of-type{border-bottom:none}
  .tr-product-row-label{font-family:var(--ff-mono);font-size:8px;letter-spacing:2px;text-transform:uppercase;color:var(--muted);margin-bottom:8px}
  .tr-product-cats-line{font-family:var(--ff-mono);font-size:9px;letter-spacing:1.5px;text-transform:uppercase;color:var(--deep);line-height:2;margin-top:8px}
  .tr-fabric-row{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-top:8px}
  .tr-fabric-sub{font-family:var(--ff-mono);font-size:8px;letter-spacing:1.5px;text-transform:uppercase;color:var(--muted);white-space:nowrap;flex-shrink:0}
  .tr-fabric-vals{font-family:var(--ff-body);font-size:15px;line-height:1.6;color:var(--deep)}
  .tr-product-proof{font-family:var(--ff-body);font-size:16px;line-height:1.7;color:var(--muted);font-style:italic;margin-top:18px}
  @media(max-width:600px){.tr-wrap{padding:40px 24px}.tr-topbar{padding:16px 24px}.tr-recap{padding:20px}.tr-struct-grid{grid-template-columns:1fr}.tr-dec-grid{grid-template-columns:1fr}.tr-proto-grid{grid-template-columns:1fr}}
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

  const hasTypedModules = modules.some((m) => "type" in m);

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
              My Edit
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

        {hasTypedModules ? (
          // Type-dispatched rendering — Designer lens
          <>
            {modules.map((mod: LensModule, i: number) => {
              const isLast = i === modules.length - 1;
              if ("type" in mod) {
                switch (mod.type) {
                  case "structured-code": return (
                    <div key={i} className="tr-module">
                      <div className="tr-section-label">{mod.label}</div>
                      {mod.intro && <p className="tr-struct-intro">{mod.intro}</p>}
                      <div className="tr-struct-grid">
                        <div className="tr-struct-card">
                          <div className="tr-struct-label">Principle</div>
                          <p className="tr-struct-body">{mod.principle}</p>
                        </div>
                        <div className="tr-struct-card">
                          <div className="tr-struct-label">Design Move</div>
                          <p className="tr-struct-body">{mod.designMove}</p>
                        </div>
                        <div className="tr-struct-card">
                          <div className="tr-struct-label">Avoid</div>
                          <p className="tr-struct-body">{mod.avoid}</p>
                        </div>
                      </div>
                      {!isLast && <div className="tr-mod-divider" />}
                    </div>
                  );
                  case "decision-grid": return (
                    <div key={i} className="tr-module">
                      <div className="tr-section-label">{mod.label}</div>
                      <div className="tr-dec-grid">
                        {mod.decisions.map((d, j) => (
                          <div key={j} className="tr-dec-card">
                            <div className="tr-dec-label">{d.label}</div>
                            <p className="tr-dec-body">{d.body}</p>
                          </div>
                        ))}
                      </div>
                      {!isLast && <div className="tr-mod-divider" />}
                    </div>
                  );
                  case "avoid-chips": return (
                    <div key={i} className="tr-module">
                      <div className="tr-section-label">{mod.label}</div>
                      <div className="tr-avoid-row">
                        {mod.chips.map((chip, j) => (
                          <span key={j} className="tr-avoid-chip">{chip}</span>
                        ))}
                      </div>
                      <p className="tr-avoid-close">{mod.closing}</p>
                      {!isLast && <div className="tr-mod-divider" />}
                    </div>
                  );
                  case "prototype-cards": return (
                    <div key={i} className="tr-module">
                      <div className="tr-section-label">{mod.label}</div>
                      {mod.intro && <p className="tr-struct-intro">{mod.intro}</p>}
                      <div className="tr-proto-grid">
                        {mod.cards.map((card, j) => (
                          <div key={j} className="tr-proto-card">
                            <div className="tr-proto-label">{card.label}</div>
                            <p className="tr-proto-body">{card.body}</p>
                          </div>
                        ))}
                      </div>
                      {!isLast && <div className="tr-mod-divider" />}
                    </div>
                  );
                  case "checklist": return (
                    <div key={i} className="tr-module">
                      <div className="tr-section-label">{mod.label}</div>
                      <div className="tr-check-list">
                        {mod.items.map((item, j) => (
                          <div key={j} className="tr-check-row">
                            <span className="tr-check-num">{String(j + 1).padStart(2, "0")}</span>
                            <span className="tr-check-text">{item}</span>
                          </div>
                        ))}
                      </div>
                      {!isLast && <div className="tr-mod-divider" />}
                    </div>
                  );
                  case "product-brief": return (
                    <div key={i} className="tr-module">
                      <div className="tr-section-label">{mod.label}</div>
                      <div className="tr-product-brief">
                        <div className="tr-product-row">
                          <div className="tr-product-row-label">Product Categories</div>
                          <p className="tr-product-cats-line">{mod.categories.join(" · ")}</p>
                        </div>
                        <div className="tr-product-row">
                          <div className="tr-product-row-label">Fabric Logic</div>
                          <div className="tr-fabric-row">
                            <span className="tr-fabric-sub">Holds Shape:</span>
                            <span className="tr-fabric-vals">{mod.fabricHolds.join(" · ")}</span>
                          </div>
                          <div className="tr-fabric-row">
                            <span className="tr-fabric-sub">Moves Cleanly:</span>
                            <span className="tr-fabric-vals">{mod.fabricMoves.join(" · ")}</span>
                          </div>
                        </div>
                      </div>
                      <p className="tr-product-proof">{mod.proofLine}</p>
                      {!isLast && <div className="tr-mod-divider" />}
                    </div>
                  );
                  case "highlight": return (
                    <div key={i} className="tr-decision">
                      <div className="tr-section-label">{mod.label}</div>
                      <p className="tr-body">{mod.body}</p>
                    </div>
                  );
                }
              }
              // BodyModule within typed lens (e.g. THE PRODUCT TRANSLATION)
              return (
                <div key={i} className="tr-module">
                  <div className="tr-section-label">{mod.label}</div>
                  {"body" in mod && <p className="tr-body">{mod.body}</p>}
                  {!isLast && <div className="tr-mod-divider" />}
                </div>
              );
            })}
          </>
        ) : (
          // Legacy position-based rendering — all other lenses
          <>
            {modules.slice(0, -1).map((mod: LensModule, i: number) => (
              <div key={i} className="tr-module">
                <div className="tr-section-label">{mod.label}</div>
                {"body" in mod && <p className="tr-body">{mod.body}</p>}
                {i < modules.length - 2 && (
                  <div style={{ height: "1px", background: "rgba(59,5,16,.06)", margin: "32px 0 0" }} />
                )}
              </div>
            ))}
            <div className="tr-decision">
              <div className="tr-section-label">{modules[modules.length - 1].label}</div>
              {"body" in modules[modules.length - 1] && (
                <p className="tr-body">{modules[modules.length - 1].body}</p>
              )}
            </div>
          </>
        )}

        {/* Footer */}
        <div className="tr-footer">
          <div className="tr-footer-note">nAia Trend Intelligence · {report.season}</div>
        </div>
      </div>
    </div>
  );
}
