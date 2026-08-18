import { Link, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { STOREFRONT_ORIGIN, STOREFRONT_NAV } from "../lib/storefront-config";
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

const LENS_ORDER: LensKey[] = ["designer", "buyer", "marketer", "creative-director", "stylist"];

const LENS_ROLE_LABEL: Record<LensKey, string> = {
  designer: "Atelier Intelligence",
  buyer: "Commercial Analysis",
  marketer: "Campaign Strategy",
  "creative-director": "Creative Brief",
  stylist: "Getting-Dressed Guide",
};

const css = `
  :root{--cream:#f0ebe2;--warm:#e8e0d5;--deep:#1a1109;--accent:#7a1e28;--muted:rgba(26,17,9,0.55);--ff-display:'Oswald',sans-serif;--ff-body:'Cormorant Garamond',Garamond,serif;--ff-mono:'Space Mono','Courier New',monospace}
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:var(--cream);color:var(--deep);font-family:var(--ff-body);-webkit-font-smoothing:antialiased}

  /* ── Shared chrome ── */
  .tr-header{border-bottom:1px solid rgba(26,17,9,.06)}
  .tr-header-inner{max-width:100rem;margin:0 auto;display:flex;align-items:center;justify-content:space-between;padding:18px 40px;gap:32px}
  @media(max-width:639px){.tr-header-inner{padding:16px 24px}}
  .tr-sitenav-links{display:none;align-items:center;gap:20px;flex:1}
  @media(min-width:768px){.tr-sitenav-links{display:flex}}
  .tr-sitenav-link{font-family:var(--ff-mono);font-size:9px;letter-spacing:1.5px;text-transform:uppercase;color:rgba(26,17,9,.55);text-decoration:none;transition:color .2s;white-space:nowrap}
  .tr-sitenav-link:hover,.tr-sitenav-link.active{color:var(--accent)}
  .tr-header-logo{font-family:var(--ff-display);font-size:14px;font-weight:400;letter-spacing:6px;text-transform:uppercase;color:var(--deep);text-decoration:none;white-space:nowrap}
  .tr-header-right{display:flex;justify-content:flex-end;align-items:center;flex:1}
  .tr-personal-link{font-family:var(--ff-mono);font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--accent);text-decoration:none;transition:opacity .2s;white-space:nowrap}
  .tr-personal-link:hover{opacity:.75}
  .tr-wrap{max-width:900px;margin:0 auto;padding:60px 40px}
  .tr-section-label{font-family:var(--ff-mono);font-size:0.6rem;letter-spacing:0.34em;text-transform:uppercase;color:var(--accent);margin-bottom:20px}
  .tr-body{font-family:var(--ff-body);font-size:1.1rem;line-height:1.85;color:rgba(26,17,9,0.85);white-space:pre-line}
  .tr-divider{height:1px;background:rgba(26,17,9,.08);margin:40px 0}
  .tr-recap{padding:24px 28px;border:1px solid rgba(26,17,9,0.08);background:rgba(26,17,9,0.03);margin-bottom:48px}
  .tr-recap-season{font-family:var(--ff-mono);font-size:0.55rem;letter-spacing:0.28em;text-transform:uppercase;color:var(--accent);margin-bottom:8px}
  .tr-recap-title{font-family:var(--ff-body);font-size:1.2rem;font-weight:400;font-style:italic;color:var(--deep);margin-bottom:8px}
  .tr-recap-link{font-family:var(--ff-mono);font-size:0.55rem;letter-spacing:0.28em;text-transform:uppercase;color:var(--accent);text-decoration:none}
  .tr-lens-nav{margin-bottom:48px}
  .tr-lens-nav-label{font-family:var(--ff-mono);font-size:0.55rem;letter-spacing:0.3em;text-transform:uppercase;color:var(--muted);margin-bottom:16px}
  .tr-lens-nav-row{display:flex;flex-wrap:nowrap;gap:6px;overflow-x:auto;-webkit-overflow-scrolling:touch;padding-bottom:2px;padding-right:16px}
  @media(max-width:600px){.tr-lens-nav-row{flex-wrap:wrap}}
  .tr-lens-btn{display:inline-block;padding:10px 14px;font-family:var(--ff-mono);font-size:0.58rem;letter-spacing:0.22em;text-transform:uppercase;text-decoration:none;border:1px solid rgba(26,17,9,0.18);color:var(--deep);transition:background .15s,color .15s,border-color .15s;white-space:nowrap;flex-shrink:0}
  .tr-lens-btn:hover{border-color:var(--accent);color:var(--accent)}
  .tr-lens-btn.active{background:var(--deep);color:var(--cream);border-color:var(--deep)}
  .tr-module{margin-bottom:40px}
  .tr-decision{padding:28px 32px;border-left:3px solid var(--accent);background:rgba(122,30,40,.04);margin-top:48px;margin-bottom:48px}
  .tr-mod-divider{height:1px;background:rgba(26,17,9,.06);margin:32px 0 0}
  .tr-stacked-row-sub{font-family:var(--ff-body);font-size:13px;line-height:1.55;color:var(--muted);font-style:italic;margin-top:4px}
  .tr-product-proof{font-family:var(--ff-body);font-size:16px;line-height:1.7;color:var(--muted);font-style:italic;margin-top:18px}
  .tr-struct-intro{font-family:var(--ff-body);font-size:16px;line-height:1.7;color:var(--muted);font-style:italic;margin-bottom:16px}
  .tr-my-edit-sep{margin-top:28px;padding-top:20px;border-top:1px solid rgba(26,17,9,0.08);display:flex;flex-direction:column;align-items:flex-start;gap:10px}
  .tr-my-edit-sep-label{font-family:var(--ff-mono);font-size:0.52rem;letter-spacing:0.3em;text-transform:uppercase;color:rgba(26,17,9,0.40)}
  .tr-my-edit-btn{display:inline-block;padding:12px 24px;font-family:var(--ff-mono);font-size:0.58rem;letter-spacing:0.22em;text-transform:uppercase;text-decoration:none;border:1px solid rgba(122,30,40,0.35);color:rgba(26,17,9,0.75);transition:background .15s,color .15s,border-color .15s;white-space:nowrap}
  .tr-my-edit-btn:hover{background:var(--accent);color:var(--cream);border-color:var(--accent)}
  .tr-personal-cta{max-width:900px;margin:60px auto 0;padding:48px 40px;border-top:1px solid rgba(26,17,9,0.08)}
  .tr-personal-cta-label{font-family:var(--ff-mono);font-size:0.6rem;letter-spacing:0.34em;text-transform:uppercase;color:var(--accent);margin-bottom:20px}
  .tr-personal-cta-title{font-family:var(--ff-display);font-size:clamp(1.4rem,2.5vw,2rem);font-weight:200;text-transform:uppercase;letter-spacing:0.02em;color:var(--deep);margin-bottom:12px}
  .tr-personal-cta-title em{font-family:var(--ff-body);font-style:italic;font-weight:300;text-transform:none;letter-spacing:0}
  .tr-personal-cta-body{font-family:var(--ff-body);font-size:1.05rem;line-height:1.8;color:rgba(26,17,9,0.65);margin-bottom:24px;max-width:40rem}
  .tr-personal-cta-btn{display:inline-block;padding:12px 28px;border:1px solid var(--deep);font-family:var(--ff-mono);font-size:0.58rem;letter-spacing:0.22em;text-transform:uppercase;color:var(--deep);text-decoration:none;transition:background .15s,color .15s}
  .tr-personal-cta-btn:hover{background:var(--deep);color:var(--cream)}
  .tr-footer{text-align:center;padding:40px 0;border-top:1px solid rgba(26,17,9,0.08);margin-top:60px}
  .tr-footer-note{font-family:var(--ff-mono);font-size:0.52rem;letter-spacing:0.3em;text-transform:uppercase;color:var(--muted)}

  /* ── DESIGNER dl-* — atelier board ── */
  .dl-spec-rows{margin-top:12px;border:1px solid rgba(26,17,9,.1)}
  .dl-spec-row{display:grid;grid-template-columns:160px 1fr;border-bottom:1px solid rgba(26,17,9,.06)}
  .dl-spec-row:last-child{border-bottom:none}
  .dl-spec-key{padding:14px 18px;font-family:var(--ff-mono);font-size:8px;letter-spacing:2px;text-transform:uppercase;color:var(--muted);background:rgba(26,17,9,.02)}
  .dl-spec-val{padding:14px 18px;font-family:var(--ff-body);font-size:15px;line-height:1.6;color:var(--deep)}
  .dl-warn-panel{background:var(--deep);color:var(--cream);padding:28px 32px}
  .dl-warn-label{font-family:var(--ff-mono);font-size:9px;letter-spacing:3px;text-transform:uppercase;color:rgba(244,244,241,.4);margin-bottom:14px}
  .dl-warn-chips{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px}
  .dl-warn-chip{padding:7px 14px;border:1px solid rgba(255,255,255,.2);font-family:var(--ff-mono);font-size:8px;letter-spacing:2px;text-transform:uppercase;color:rgba(255,255,255,.75)}
  .dl-warn-close{font-family:var(--ff-body);font-size:16px;line-height:1.7;color:rgba(255,255,255,.5);font-style:italic}
  .dl-dev-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px}
  .dl-dev-card{padding:20px 24px;border:1px solid rgba(26,17,9,.12);background:transparent}
  .dl-dev-label{font-family:var(--ff-mono);font-size:8px;letter-spacing:2px;text-transform:uppercase;color:var(--accent);margin-bottom:10px}
  .dl-dev-body{font-family:var(--ff-body);font-size:15px;line-height:1.6;color:var(--deep)}
  .dl-fit-list{margin-top:12px}
  .dl-fit-row{display:flex;align-items:baseline;gap:16px;padding:10px 0;border-bottom:1px solid rgba(26,17,9,.05)}
  .dl-fit-row:last-child{border-bottom:none}
  .dl-fit-num{font-family:var(--ff-mono);font-size:8px;letter-spacing:2px;color:var(--accent);flex-shrink:0;width:24px;font-weight:700}
  .dl-fit-text{font-family:var(--ff-body);font-size:16px;line-height:1.65;color:var(--deep)}

  /* ── BUYER by-* — commercial intelligence ── */
  .by-lede{font-family:var(--ff-body);font-size:22px;line-height:1.75;color:var(--deep);font-style:italic}
  .by-tier-grid{display:flex;flex-direction:column;gap:8px;margin-top:12px}
  .by-tier{padding:20px 24px;background:rgba(255,255,255,.5)}
  .by-tier--deep{border-left:5px solid var(--deep)}
  .by-tier--test{border-left:3px solid var(--accent)}
  .by-tier--hold{border-left:1px solid rgba(26,17,9,.2)}
  .by-tier-label{font-family:var(--ff-mono);font-size:8px;letter-spacing:2.5px;text-transform:uppercase;color:var(--accent);margin-bottom:8px}
  .by-tier-items{font-family:var(--ff-body);font-size:15px;line-height:1.5;color:var(--deep);margin-bottom:6px}
  .by-tier-note{font-family:var(--ff-body);font-size:13px;line-height:1.55;color:var(--muted);font-style:italic}
  .by-table{margin-top:12px;border:1px solid rgba(26,17,9,.08)}
  .by-table-row{display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid rgba(26,17,9,.06)}
  .by-table-row:last-child{border-bottom:none}
  .by-table-key{padding:14px 18px;font-family:var(--ff-mono);font-size:8px;letter-spacing:2px;text-transform:uppercase;color:var(--muted);background:rgba(26,17,9,.02);display:flex;align-items:center}
  .by-table-val{padding:14px 18px;font-family:var(--ff-body);font-size:14px;line-height:1.55;color:var(--deep)}
  .by-risk-panel{background:rgba(122,30,40,.05);border:1px solid rgba(122,30,40,.18);padding:24px 28px}
  .by-risk-label{font-family:var(--ff-mono);font-size:9px;letter-spacing:3px;text-transform:uppercase;color:var(--accent);margin-bottom:14px}
  .by-risk-chips{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px}
  .by-risk-chip{padding:7px 14px;border:1px solid rgba(122,30,40,.3);font-family:var(--ff-mono);font-size:8px;letter-spacing:2px;text-transform:uppercase;color:var(--accent)}
  .by-risk-close{font-family:var(--ff-body);font-size:15px;line-height:1.65;color:var(--muted);font-style:italic}
  .by-depth-rows{margin-top:12px}
  .by-depth-row{display:grid;grid-template-columns:160px 1fr;gap:16px;padding:16px 0 16px 20px;border-bottom:1px solid rgba(26,17,9,.06);border-left:4px solid transparent}
  .by-depth-row:last-child{border-bottom:none}
  .by-depth-row--deep{border-left-color:var(--deep)}
  .by-depth-row--test{border-left-color:var(--accent);border-left-width:2px;padding-left:22px}
  .by-depth-row--hold{border-left-color:rgba(26,17,9,.15);border-left-width:1px;padding-left:23px}
  .by-depth-label{font-family:var(--ff-mono);font-size:8px;letter-spacing:2px;text-transform:uppercase;color:var(--accent);padding-top:3px}
  .by-depth-body{font-family:var(--ff-body);font-size:15px;line-height:1.6;color:var(--deep)}
  .by-decision{padding:28px 32px;background:var(--deep);color:var(--cream);margin-top:48px;margin-bottom:48px}
  .by-decision .tr-section-label{color:rgba(244,244,241,.4)}
  .by-decision .tr-body{color:var(--cream);font-size:19px;line-height:1.85}

  /* ── MARKETER mk-* — campaign strategy ── */
  .mk-tension{font-family:var(--ff-body);font-size:21px;line-height:1.85;color:var(--deep)}
  .mk-message-panel{background:var(--deep);color:var(--cream);padding:40px;margin:48px -40px;width:calc(100% + 80px)}
  .mk-message-label{font-family:var(--ff-mono);font-size:9px;letter-spacing:3px;text-transform:uppercase;color:rgba(244,244,241,.35);margin-bottom:20px}
  .mk-message-body{font-family:var(--ff-body);font-size:clamp(1.2rem,2.5vw,1.8rem);font-weight:300;font-style:italic;color:var(--cream);line-height:1.6}
  .mk-angles-list{margin-top:12px;display:flex;flex-direction:column}
  .mk-angle-item{display:grid;grid-template-columns:28px 1fr;gap:0 16px;padding:18px 0;border-bottom:1px solid rgba(26,17,9,.06);align-items:start}
  .mk-angle-item:last-child{border-bottom:none}
  .mk-angle-num{font-family:var(--ff-mono);font-size:8px;letter-spacing:2px;color:var(--accent);padding-top:4px}
  .mk-angle-head{font-family:var(--ff-mono);font-size:8px;letter-spacing:2px;text-transform:uppercase;color:var(--muted);margin-bottom:6px}
  .mk-angle-body{font-family:var(--ff-body);font-size:17px;line-height:1.65;color:var(--deep)}
  .mk-copy-table{margin-top:12px;border:1px solid rgba(26,17,9,.08)}
  .mk-copy-row{display:grid;grid-template-columns:110px 1fr;border-bottom:1px solid rgba(26,17,9,.06)}
  .mk-copy-row:last-child{border-bottom:none}
  .mk-copy-key{padding:14px 18px;font-family:var(--ff-mono);font-size:8px;letter-spacing:2px;text-transform:uppercase;color:var(--accent);background:rgba(26,17,9,.02);display:flex;align-items:center}
  .mk-copy-val{padding:14px 18px;font-family:var(--ff-body);font-size:15px;line-height:1.55;color:var(--deep)}
  .mk-copy-sub{font-family:var(--ff-body);font-size:13px;font-style:italic;color:var(--muted);margin-top:6px}
  .mk-hook-chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
  .mk-hook-chip{padding:9px 18px;background:var(--deep);font-family:var(--ff-mono);font-size:8px;letter-spacing:2px;text-transform:uppercase;color:var(--cream)}
  .mk-hook-close{font-family:var(--ff-body);font-size:16px;line-height:1.7;color:var(--muted);font-style:italic;margin-top:16px}

  /* ── CREATIVE DIRECTOR cd-* — cinematic brief ── */
  .cd-brief{font-family:var(--ff-body);font-size:21px;line-height:2;color:var(--deep)}
  .cd-open-rows{margin-top:12px;display:flex;flex-direction:column}
  .cd-open-row{display:grid;grid-template-columns:130px 1fr;gap:0 24px;padding:20px 0;border-bottom:1px solid rgba(26,17,9,.05);align-items:start}
  .cd-open-row:last-child{border-bottom:none}
  .cd-open-label{font-family:var(--ff-mono);font-size:8px;letter-spacing:2px;text-transform:uppercase;color:rgba(26,17,9,.35);padding-top:4px;line-height:1.6}
  .cd-open-body{font-family:var(--ff-body);font-size:17px;line-height:1.85;color:var(--deep)}
  .cd-open-sub{font-family:var(--ff-body);font-size:14px;line-height:1.6;color:var(--muted);font-style:italic;margin-top:6px}
  .cd-restrict-list{margin-top:12px;display:flex;flex-direction:column;gap:12px}
  .cd-restrict-item{font-family:var(--ff-body);font-size:17px;line-height:1.7;color:var(--deep);padding-left:28px;position:relative}
  .cd-restrict-item::before{content:"—";position:absolute;left:0;color:var(--muted)}
  .cd-risk-items{margin-top:12px;display:flex;flex-direction:column;gap:12px}
  .cd-risk-item{font-family:var(--ff-body);font-size:17px;line-height:1.7;color:var(--muted);font-style:italic;padding-left:28px;position:relative}
  .cd-risk-item::before{content:"✕";position:absolute;left:0;color:var(--accent);font-family:var(--ff-mono);font-size:11px;top:3px;font-style:normal}
  .cd-close-note{font-family:var(--ff-body);font-size:15px;line-height:1.7;color:var(--muted);font-style:italic;margin-top:16px}
  .cd-direction{padding:0;margin-top:56px;margin-bottom:48px}
  .cd-direction-label{font-family:var(--ff-mono);font-size:9px;letter-spacing:3px;text-transform:uppercase;color:var(--accent);margin-bottom:24px}
  .cd-direction-body{font-family:var(--ff-body);font-size:clamp(1.5rem,3.5vw,2.8rem);font-weight:300;font-style:italic;color:var(--deep);line-height:1.45}

  /* ── STYLIST st-* — getting-dressed tool ── */
  .st-read{font-family:var(--ff-body);font-size:20px;line-height:1.85;color:var(--deep)}
  .st-anchor-chips{display:flex;flex-wrap:wrap;gap:10px;margin-top:12px}
  .st-anchor-chip{padding:12px 22px;background:var(--deep);font-family:var(--ff-mono);font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--cream)}
  .st-anchor-close{font-family:var(--ff-body);font-size:16px;line-height:1.7;color:var(--muted);font-style:italic;margin-top:16px}
  .st-proportion-rows{margin-top:12px}
  .st-proportion-row{display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid rgba(26,17,9,.06)}
  .st-proportion-row:first-child{border-top:1px solid rgba(26,17,9,.06)}
  .st-proportion-key{padding:14px 18px;font-family:var(--ff-mono);font-size:8px;letter-spacing:2px;text-transform:uppercase;color:var(--muted);background:rgba(26,17,9,.02);display:flex;align-items:center}
  .st-proportion-val{padding:14px 18px;font-family:var(--ff-body);font-size:15px;line-height:1.6;color:var(--deep)}
  .st-proportion-sub{font-family:var(--ff-body);font-size:13px;font-style:italic;color:var(--muted);margin-top:4px}
  .st-occasion-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px}
  .st-occasion-card{padding:20px;background:rgba(255,255,255,.6);border:1px solid rgba(26,17,9,.08)}
  .st-occasion-label{font-family:var(--ff-mono);font-size:8px;letter-spacing:2px;text-transform:uppercase;color:var(--accent);margin-bottom:10px}
  .st-occasion-body{font-family:var(--ff-body);font-size:15px;line-height:1.6;color:var(--deep)}
  .st-pair-chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
  .st-pair-chip{padding:8px 16px;border:1px solid rgba(26,17,9,.15);font-family:var(--ff-mono);font-size:8px;letter-spacing:2px;text-transform:uppercase;color:var(--deep);background:rgba(255,255,255,.5)}
  .st-pair-close{font-family:var(--ff-body);font-size:16px;line-height:1.7;color:var(--muted);font-style:italic;margin-top:14px}
  .st-risk-chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
  .st-risk-chip{padding:8px 16px;border:1px solid rgba(122,30,40,.25);font-family:var(--ff-mono);font-size:8px;letter-spacing:2px;text-transform:uppercase;color:var(--accent)}
  .st-risk-close{font-family:var(--ff-body);font-size:16px;line-height:1.7;color:var(--muted);font-style:italic;margin-top:14px}
  .st-formula-rows{margin-top:12px;display:flex;flex-direction:column}
  .st-formula-row{display:grid;grid-template-columns:120px 1fr;gap:0 16px;padding:14px 0;border-bottom:1px solid rgba(26,17,9,.06);align-items:start}
  .st-formula-row:last-child{border-bottom:none}
  .st-formula-label{font-family:var(--ff-mono);font-size:8px;letter-spacing:2px;text-transform:uppercase;color:var(--accent);padding-top:3px;font-weight:700}
  .st-formula-val{font-family:var(--ff-body);font-size:15px;line-height:1.6;color:var(--deep)}
  .st-formula-sub{font-family:var(--ff-body);font-size:13px;font-style:italic;color:var(--muted);margin-top:4px}
  .st-mirror-rows{margin-top:12px;display:flex;flex-direction:column}
  .st-mirror-row{padding:16px 0;border-bottom:1px solid rgba(26,17,9,.06)}
  .st-mirror-row:last-child{border-bottom:none}
  .st-mirror-label{font-family:var(--ff-mono);font-size:8px;letter-spacing:2px;text-transform:uppercase;color:var(--muted);margin-bottom:6px}
  .st-mirror-body{font-family:var(--ff-body);font-size:18px;line-height:1.7;color:var(--deep);font-style:italic}
  .st-mirror-sub{font-family:var(--ff-body);font-size:14px;color:var(--muted);margin-top:4px}

  /* ── Responsive ── */
  @media(max-width:600px){
    .tr-wrap{padding:40px 24px}
    .tr-personal-cta{padding:40px 24px}
    .mk-message-panel{margin:48px -24px;width:calc(100% + 48px);padding:32px 24px}
    .dl-spec-row{grid-template-columns:1fr}
    .dl-spec-key{background:none;padding-bottom:4px}
    .dl-dev-grid,.st-occasion-grid{grid-template-columns:1fr}
    .by-depth-row{grid-template-columns:1fr;padding-left:16px}
    .by-table-row{grid-template-columns:1fr}
    .by-table-key{background:none;padding-bottom:4px}
    .cd-open-row{grid-template-columns:1fr;gap:6px}
    .cd-open-label{padding-top:0}
    .mk-copy-row{grid-template-columns:1fr}
    .mk-copy-key{background:none;padding-bottom:4px}
    .st-proportion-row{grid-template-columns:1fr}
    .st-proportion-key{background:none;padding-bottom:4px}
    .st-formula-row{grid-template-columns:1fr;gap:4px}
    .mk-angle-item{grid-template-columns:22px 1fr}
  }
`;

// ── DESIGNER: Atelier Board ────────────────────────────────────────────────

function DesignerLens({ modules }: { modules: LensModule[] }) {
  return (
    <>
      {modules.map((mod: LensModule, i: number) => {
        const isLast = i === modules.length - 1;
        if (!("type" in mod)) {
          return (
            <div key={i} className="tr-module">
              <div className="tr-section-label">{mod.label}</div>
              <p className="tr-body">{mod.body}</p>
              {!isLast && <div className="tr-mod-divider" />}
            </div>
          );
        }
        switch (mod.type) {
          case "structured-code": return (
            <div key={i} className="tr-module">
              <div className="tr-section-label">{mod.label}</div>
              {mod.intro && <p className="tr-struct-intro">{mod.intro}</p>}
              <div className="dl-spec-rows">
                <div className="dl-spec-row">
                  <div className="dl-spec-key">Principle</div>
                  <div className="dl-spec-val">{mod.principle}</div>
                </div>
                <div className="dl-spec-row">
                  <div className="dl-spec-key">Design Move</div>
                  <div className="dl-spec-val">{mod.designMove}</div>
                </div>
                <div className="dl-spec-row">
                  <div className="dl-spec-key">Avoid</div>
                  <div className="dl-spec-val">{mod.avoid}</div>
                </div>
              </div>
              {!isLast && <div className="tr-mod-divider" />}
            </div>
          );
          case "avoid-chips": return (
            <div key={i} className="tr-module">
              <div className="dl-warn-panel">
                <div className="dl-warn-label">{mod.label}</div>
                <div className="dl-warn-chips">
                  {mod.chips.map((chip, j) => <span key={j} className="dl-warn-chip">{chip}</span>)}
                </div>
                <p className="dl-warn-close">{mod.closing}</p>
              </div>
              {!isLast && <div className="tr-mod-divider" />}
            </div>
          );
          case "product-brief": return (
            <div key={i} className="tr-module">
              <div className="tr-section-label">{mod.label}</div>
              <div className="dl-spec-rows">
                <div className="dl-spec-row">
                  <div className="dl-spec-key">Categories</div>
                  <div className="dl-spec-val">{mod.categories.join(" · ")}</div>
                </div>
                <div className="dl-spec-row">
                  <div className="dl-spec-key">Holds Shape</div>
                  <div className="dl-spec-val">{mod.fabricHolds.join(" · ")}</div>
                </div>
                <div className="dl-spec-row">
                  <div className="dl-spec-key">Moves Cleanly</div>
                  <div className="dl-spec-val">{mod.fabricMoves.join(" · ")}</div>
                </div>
              </div>
              <p className="tr-product-proof">{mod.proofLine}</p>
              {!isLast && <div className="tr-mod-divider" />}
            </div>
          );
          case "decision-grid": return (
            <div key={i} className="tr-module">
              <div className="tr-section-label">{mod.label}</div>
              <div className="dl-spec-rows">
                {mod.decisions.map((d, j) => (
                  <div key={j} className="dl-spec-row">
                    <div className="dl-spec-key">{d.label}</div>
                    <div className="dl-spec-val">{d.body}</div>
                  </div>
                ))}
              </div>
              {!isLast && <div className="tr-mod-divider" />}
            </div>
          );
          case "prototype-cards": return (
            <div key={i} className="tr-module">
              <div className="tr-section-label">{mod.label}</div>
              {mod.intro && <p className="tr-struct-intro">{mod.intro}</p>}
              <div className="dl-dev-grid">
                {mod.cards.map((card, j) => (
                  <div key={j} className="dl-dev-card">
                    <div className="dl-dev-label">{card.label}</div>
                    <p className="dl-dev-body">{card.body}</p>
                  </div>
                ))}
              </div>
              {!isLast && <div className="tr-mod-divider" />}
            </div>
          );
          case "checklist": return (
            <div key={i} className="tr-module">
              <div className="tr-section-label">{mod.label}</div>
              <div className="dl-fit-list">
                {mod.items.map((item, j) => (
                  <div key={j} className="dl-fit-row">
                    <span className="dl-fit-num">{String(j + 1).padStart(2, "0")}</span>
                    <span className="dl-fit-text">{item}</span>
                  </div>
                ))}
              </div>
              {!isLast && <div className="tr-mod-divider" />}
            </div>
          );
          case "highlight": return (
            <div key={i} className="tr-decision">
              <div className="tr-section-label">{mod.label}</div>
              <p className="tr-body">{mod.body}</p>
            </div>
          );
          default: return null;
        }
      })}
    </>
  );
}

// ── BUYER: Commercial Intelligence ───────────────────────────────────────

function BuyerLens({ modules }: { modules: LensModule[] }) {
  const depthClass = (label: string) => {
    const u = label.toUpperCase();
    if (u.includes("DEEPER") || u.includes("BUY")) return "by-depth-row by-depth-row--deep";
    if (u.includes("TEST")) return "by-depth-row by-depth-row--test";
    return "by-depth-row by-depth-row--hold";
  };
  const tierClass = (j: number) =>
    j === 0 ? "by-tier by-tier--deep" : j === 1 ? "by-tier by-tier--test" : "by-tier by-tier--hold";

  return (
    <>
      {modules.map((mod: LensModule, i: number) => {
        const isLast = i === modules.length - 1;
        if (!("type" in mod)) {
          return (
            <div key={i} className="tr-module">
              <div className="tr-section-label">{mod.label}</div>
              <p className="by-lede">{mod.body}</p>
              {!isLast && <div className="tr-mod-divider" />}
            </div>
          );
        }
        switch (mod.type) {
          case "assortment-cards": return (
            <div key={i} className="tr-module">
              <div className="tr-section-label">{mod.label}</div>
              <div className="by-tier-grid">
                {mod.cards.map((card, j) => (
                  <div key={j} className={tierClass(j)}>
                    <div className="by-tier-label">{card.label}</div>
                    <p className="by-tier-items">{card.items}</p>
                    <p className="by-tier-note">{card.note}</p>
                  </div>
                ))}
              </div>
              {!isLast && <div className="tr-mod-divider" />}
            </div>
          );
          case "decision-grid": return (
            <div key={i} className="tr-module">
              <div className="tr-section-label">{mod.label}</div>
              <div className="by-table">
                {mod.decisions.map((d, j) => (
                  <div key={j} className="by-table-row">
                    <div className="by-table-key">{d.label}</div>
                    <div className="by-table-val">{d.body}</div>
                  </div>
                ))}
              </div>
              {!isLast && <div className="tr-mod-divider" />}
            </div>
          );
          case "avoid-chips": return (
            <div key={i} className="tr-module">
              <div className="by-risk-panel">
                <div className="by-risk-label">{mod.label}</div>
                <div className="by-risk-chips">
                  {mod.chips.map((chip, j) => <span key={j} className="by-risk-chip">{chip}</span>)}
                </div>
                <p className="by-risk-close">{mod.closing}</p>
              </div>
              {!isLast && <div className="tr-mod-divider" />}
            </div>
          );
          case "stacked-rows": return (
            <div key={i} className="tr-module">
              <div className="tr-section-label">{mod.label}</div>
              <div className="by-depth-rows">
                {mod.rows.map((row, j) => (
                  <div key={j} className={depthClass(row.label)}>
                    <span className="by-depth-label">{row.label}</span>
                    <div>
                      <p className="by-depth-body">{row.body}</p>
                      {row.sub && <p className="tr-stacked-row-sub">{row.sub}</p>}
                    </div>
                  </div>
                ))}
              </div>
              {!isLast && <div className="tr-mod-divider" />}
            </div>
          );
          case "highlight": return (
            <div key={i} className="by-decision">
              <div className="tr-section-label">{mod.label}</div>
              <p className="tr-body">{mod.body}</p>
            </div>
          );
          default: return null;
        }
      })}
    </>
  );
}

// ── MARKETER: Campaign Strategy ───────────────────────────────────────────

function MarketerLens({ modules }: { modules: LensModule[] }) {
  const highlightCount = { seen: 0 };

  return (
    <>
      {modules.map((mod: LensModule, i: number) => {
        const isLast = i === modules.length - 1;
        if (!("type" in mod)) {
          return (
            <div key={i} className="tr-module">
              <div className="tr-section-label">{mod.label}</div>
              <p className="mk-tension">{mod.body}</p>
              {!isLast && <div className="tr-mod-divider" />}
            </div>
          );
        }
        switch (mod.type) {
          case "highlight": {
            highlightCount.seen += 1;
            // First highlight = THE MESSAGE — full-width dark panel
            if (highlightCount.seen === 1) {
              return (
                <div key={i} className="mk-message-panel">
                  <div className="mk-message-label">{mod.label}</div>
                  <p className="mk-message-body">{mod.body}</p>
                </div>
              );
            }
            return (
              <div key={i} className="tr-decision">
                <div className="tr-section-label">{mod.label}</div>
                <p className="tr-body">{mod.body}</p>
              </div>
            );
          }
          case "prototype-cards": return (
            <div key={i} className="tr-module">
              <div className="tr-section-label">{mod.label}</div>
              {mod.intro && <p className="tr-struct-intro">{mod.intro}</p>}
              <div className="mk-angles-list">
                {mod.cards.map((card, j) => (
                  <div key={j} className="mk-angle-item">
                    <span className="mk-angle-num">{String(j + 1).padStart(2, "0")}</span>
                    <div>
                      <div className="mk-angle-head">{card.label}</div>
                      <p className="mk-angle-body">{card.body}</p>
                    </div>
                  </div>
                ))}
              </div>
              {!isLast && <div className="tr-mod-divider" />}
            </div>
          );
          case "stacked-rows": {
            const isCopyRules = mod.label.toUpperCase().includes("COPY");
            if (isCopyRules) {
              return (
                <div key={i} className="tr-module">
                  <div className="tr-section-label">{mod.label}</div>
                  <div className="mk-copy-table">
                    {mod.rows.map((row, j) => (
                      <div key={j} className="mk-copy-row">
                        <div className="mk-copy-key">{row.label}</div>
                        <div className="mk-copy-val">
                          {row.body}
                          {row.sub && <p className="mk-copy-sub">{row.sub}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                  {!isLast && <div className="tr-mod-divider" />}
                </div>
              );
            }
            return (
              <div key={i} className="tr-module">
                <div className="tr-section-label">{mod.label}</div>
                <div style={{ marginTop: "12px" }}>
                  {mod.rows.map((row, j) => (
                    <div key={j} style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: "16px", padding: "14px 0", borderBottom: j < mod.rows.length - 1 ? "1px solid rgba(26,17,9,0.06)" : "none" }}>
                      <span style={{ fontFamily: "var(--ff-mono)", fontSize: "0.58rem", letterSpacing: "0.22em", textTransform: "uppercase" as const, color: "var(--accent)", paddingTop: "3px" }}>{row.label}</span>
                      <div>
                        <p style={{ fontFamily: "var(--ff-body)", fontSize: "1.05rem", lineHeight: "1.75", color: "rgba(26,17,9,0.85)" }}>{row.body}</p>
                        {row.sub && <p className="tr-stacked-row-sub">{row.sub}</p>}
                      </div>
                    </div>
                  ))}
                </div>
                {!isLast && <div className="tr-mod-divider" />}
              </div>
            );
          }
          case "avoid-chips": return (
            <div key={i} className="tr-module">
              <div className="tr-section-label">{mod.label}</div>
              <div className="mk-hook-chips">
                {mod.chips.map((chip, j) => <span key={j} className="mk-hook-chip">{chip}</span>)}
              </div>
              {mod.closing && <p className="mk-hook-close">{mod.closing}</p>}
              {!isLast && <div className="tr-mod-divider" />}
            </div>
          );
          default: return null;
        }
      })}
    </>
  );
}

// ── CREATIVE DIRECTOR: Cinematic Brief ───────────────────────────────────

function CDLens({ modules }: { modules: LensModule[] }) {
  return (
    <>
      {modules.map((mod: LensModule, i: number) => {
        const isLast = i === modules.length - 1;
        if (!("type" in mod)) {
          return (
            <div key={i} className="tr-module">
              <div className="tr-section-label">{mod.label}</div>
              <p className="cd-brief">{mod.body}</p>
              {!isLast && <div className="tr-mod-divider" />}
            </div>
          );
        }
        switch (mod.type) {
          case "stacked-rows": return (
            <div key={i} className="tr-module">
              <div className="tr-section-label">{mod.label}</div>
              <div className="cd-open-rows">
                {mod.rows.map((row, j) => (
                  <div key={j} className="cd-open-row">
                    <span className="cd-open-label">{row.label}</span>
                    <div>
                      <p className="cd-open-body">{row.body}</p>
                      {row.sub && <p className="cd-open-sub">{row.sub}</p>}
                    </div>
                  </div>
                ))}
              </div>
              {!isLast && <div className="tr-mod-divider" />}
            </div>
          );
          case "avoid-chips": {
            const isRisk = mod.label.toUpperCase().includes("RISK");
            return (
              <div key={i} className="tr-module">
                <div className="tr-section-label">{mod.label}</div>
                {isRisk ? (
                  <div className="cd-risk-items">
                    {mod.chips.map((chip, j) => <p key={j} className="cd-risk-item">{chip}</p>)}
                  </div>
                ) : (
                  <div className="cd-restrict-list">
                    {mod.chips.map((chip, j) => <p key={j} className="cd-restrict-item">{chip}</p>)}
                  </div>
                )}
                {mod.closing && <p className="cd-close-note">{mod.closing}</p>}
                {!isLast && <div className="tr-mod-divider" />}
              </div>
            );
          }
          case "highlight": return (
            <div key={i} className="cd-direction">
              <div className="cd-direction-label">{mod.label}</div>
              <p className="cd-direction-body">{mod.body}</p>
            </div>
          );
          default: return null;
        }
      })}
    </>
  );
}

// ── STYLIST: Getting-Dressed Tool ─────────────────────────────────────────

function StylistLens({ modules }: { modules: LensModule[] }) {
  return (
    <>
      {modules.map((mod: LensModule, i: number) => {
        const isLast = i === modules.length - 1;
        if (!("type" in mod)) {
          return (
            <div key={i} className="tr-module">
              <div className="tr-section-label">{mod.label}</div>
              <p className="st-read">{mod.body}</p>
              {!isLast && <div className="tr-mod-divider" />}
            </div>
          );
        }
        switch (mod.type) {
          case "avoid-chips": {
            const lbl = mod.label.toUpperCase();
            const chipClass = lbl.includes("ANCHOR") ? "st-anchor-chip" : lbl.includes("RISK") ? "st-risk-chip" : "st-pair-chip";
            const rowClass = lbl.includes("ANCHOR") ? "st-anchor-chips" : lbl.includes("RISK") ? "st-risk-chips" : "st-pair-chips";
            const closeClass = lbl.includes("ANCHOR") ? "st-anchor-close" : lbl.includes("RISK") ? "st-risk-close" : "st-pair-close";
            return (
              <div key={i} className="tr-module">
                <div className="tr-section-label">{mod.label}</div>
                <div className={rowClass}>
                  {mod.chips.map((chip, j) => <span key={j} className={chipClass}>{chip}</span>)}
                </div>
                {mod.closing && <p className={closeClass}>{mod.closing}</p>}
                {!isLast && <div className="tr-mod-divider" />}
              </div>
            );
          }
          case "stacked-rows": {
            const lbl = mod.label.toUpperCase();
            if (lbl.includes("PROPORTION")) {
              return (
                <div key={i} className="tr-module">
                  <div className="tr-section-label">{mod.label}</div>
                  <div className="st-proportion-rows">
                    {mod.rows.map((row, j) => (
                      <div key={j} className="st-proportion-row">
                        <div className="st-proportion-key">{row.label}</div>
                        <div className="st-proportion-val">
                          {row.body}
                          {row.sub && <p className="st-proportion-sub">{row.sub}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                  {!isLast && <div className="tr-mod-divider" />}
                </div>
              );
            }
            if (lbl.includes("MIRROR")) {
              return (
                <div key={i} className="tr-module">
                  <div className="tr-section-label">{mod.label}</div>
                  <div className="st-mirror-rows">
                    {mod.rows.map((row, j) => (
                      <div key={j} className="st-mirror-row">
                        <div className="st-mirror-label">{row.label}</div>
                        <p className="st-mirror-body">{row.body}</p>
                        {row.sub && <p className="st-mirror-sub">{row.sub}</p>}
                      </div>
                    ))}
                  </div>
                  {!isLast && <div className="tr-mod-divider" />}
                </div>
              );
            }
            return (
              <div key={i} className="tr-module">
                <div className="tr-section-label">{mod.label}</div>
                <div className="st-formula-rows">
                  {mod.rows.map((row, j) => (
                    <div key={j} className="st-formula-row">
                      <span className="st-formula-label">{row.label}</span>
                      <div>
                        <p className="st-formula-val">{row.body}</p>
                        {row.sub && <p className="st-formula-sub">{row.sub}</p>}
                      </div>
                    </div>
                  ))}
                </div>
                {!isLast && <div className="tr-mod-divider" />}
              </div>
            );
          }
          case "prototype-cards": return (
            <div key={i} className="tr-module">
              <div className="tr-section-label">{mod.label}</div>
              {mod.intro && <p className="tr-struct-intro">{mod.intro}</p>}
              <div className="st-occasion-grid">
                {mod.cards.map((card, j) => (
                  <div key={j} className="st-occasion-card">
                    <div className="st-occasion-label">{card.label}</div>
                    <p className="st-occasion-body">{card.body}</p>
                  </div>
                ))}
              </div>
              {!isLast && <div className="tr-mod-divider" />}
            </div>
          );
          case "highlight": return (
            <div key={i} className="tr-decision">
              <div className="tr-section-label">{mod.label}</div>
              <p className="tr-body">{mod.body}</p>
            </div>
          );
          default: return null;
        }
      })}
    </>
  );
}

// ── Shared chrome ─────────────────────────────────────────────────────────

function LensHeader({ report }: { report: TrendReportData }) {
  return (
    <header className="tr-header">
      <div className="tr-header-inner">
        <nav className="tr-sitenav-links" aria-label="Site navigation">
          {STOREFRONT_NAV.map((l) => (
            <a key={l.path} href={`${STOREFRONT_ORIGIN}${l.path}`} className="tr-sitenav-link">{l.label}</a>
          ))}
          <Link to="/trends" className="tr-sitenav-link active">TREND REPORTS</Link>
        </nav>
        <a href={`${STOREFRONT_ORIGIN}/`} className="tr-header-logo">NADINE</a>
        <div className="tr-header-right">
          <Link to={`/trends/my-edits/${report.slug}`} className="tr-personal-link">My Trend Edits ↗</Link>
        </div>
      </div>
    </header>
  );
}

export function ErrorBoundary() {
  return (
    <div style={{ minHeight: "100vh", background: "#f0ebe2" }}>
      <style>{css}</style>
      <header className="tr-header">
        <div className="tr-header-inner">
          <nav className="tr-sitenav-links" aria-label="Site navigation">
            {STOREFRONT_NAV.map((l) => (
              <a key={l.path} href={`${STOREFRONT_ORIGIN}${l.path}`} className="tr-sitenav-link">{l.label}</a>
            ))}
            <Link to="/trends" className="tr-sitenav-link active">TREND REPORTS</Link>
          </nav>
          <a href={`${STOREFRONT_ORIGIN}/`} className="tr-header-logo">NADINE</a>
          <div className="tr-header-right" />
        </div>
      </header>
      <div className="tr-wrap">
        <p style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "1.1rem", fontStyle: "italic", color: "rgba(26,17,9,0.55)" }}>
          This lens could not be found.
        </p>
      </div>
    </div>
  );
}

export default function TrendLens() {
  const { report, lens, modules } = useLoaderData() as LoaderData;
  const lensLabel = LENS_LABELS[lens];

  return (
    <div style={{ minHeight: "100vh", background: "#f0ebe2" }} data-lens={lens}>
      <style>{css}</style>
      <link
        href="https://fonts.googleapis.com/css2?family=Oswald:wght@200;300;400&family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300&family=Space+Mono:wght@400;700&display=swap"
        rel="stylesheet"
      />

      <LensHeader report={report} />

      <div className="tr-wrap">
        <div className="tr-recap">
          <div className="tr-recap-season">{report.season}</div>
          <div className="tr-recap-title">{report.title}</div>
          <Link to={`/trends/${report.slug}`} className="tr-recap-link">
            Read the full report →
          </Link>
        </div>

        <div style={{ marginBottom: "32px" }}>
          <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "0.58rem", letterSpacing: "0.28em", textTransform: "uppercase" as const, color: "#7a1e28", marginBottom: "10px" }}>
            {LENS_ROLE_LABEL[lens]}
          </div>
          <h1 style={{ fontFamily: "'Oswald',sans-serif", fontSize: "clamp(1.6rem,3.5vw,2.8rem)", fontWeight: 300, textTransform: "uppercase" as const, letterSpacing: "0.02em", color: "#1a1109", lineHeight: 1.05 }}>
            {lensLabel}
          </h1>
        </div>

        <div className="tr-lens-nav">
          <div className="tr-lens-nav-label">Read through a professional lens</div>
          <div className="tr-lens-nav-row">
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
          <div className="tr-my-edit-sep">
            <div className="tr-my-edit-sep-label">Make it personal</div>
            <Link to={`/trends/my-edits/${report.slug}`} className="tr-my-edit-btn">
              My Trend Edit →
            </Link>
          </div>
        </div>

        <div className="tr-divider" />

        {lens === "designer" && <DesignerLens modules={modules} />}
        {lens === "buyer" && <BuyerLens modules={modules} />}
        {lens === "marketer" && <MarketerLens modules={modules} />}
        {lens === "creative-director" && <CDLens modules={modules} />}
        {lens === "stylist" && <StylistLens modules={modules} />}

        <div className="tr-personal-cta">
          <div className="tr-personal-cta-label">Make it personal</div>
          <div className="tr-personal-cta-title">
            This is the professional read.
            <br />
            <em>Your wardrobe read is different.</em>
          </div>
          <p className="tr-personal-cta-body">
            My Trend Edit reads this direction against your Style DNA, Closet, previous outfit ratings, and actual wardrobe gaps — then shows the part of this trend that belongs to you.
          </p>
          <Link to={`/trends/my-edits/${report.slug}`} className="tr-personal-cta-btn">
            Open My Trend Edit →
          </Link>
        </div>

        <div className="tr-footer">
          <div className="tr-footer-note">nAia Trend Intelligence · {report.season}</div>
        </div>
      </div>
    </div>
  );
}
