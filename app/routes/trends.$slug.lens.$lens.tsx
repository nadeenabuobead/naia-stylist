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
  return [
    { title: `${data.report.title} — ${LENS_LABELS[data.lens]} Lens | nAia` },
    { name: "description", content: `${LENS_LABELS[data.lens]} perspective on ${data.report.title}.` },
  ];
}

const FONTS =
  "https://fonts.googleapis.com/css2?family=Oswald:wght@200;300;400&family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300;1,400&family=Space+Mono&display=swap";

const TINTS = ["#efeae0", "#e6dccb", "#d9c9b5", "#efe6d7", "#e2d3bf", "#ede2cf"];

const LENS_ORDER: LensKey[] = ["designer", "buyer", "marketer", "creative-director", "stylist"];

const LENS_ROLE_LABEL: Record<LensKey, string> = {
  designer: "Atelier Intelligence",
  buyer: "Commercial Analysis",
  marketer: "Campaign Strategy",
  "creative-director": "Creative Brief",
  stylist: "Getting-Dressed Guide",
};

const css = `
  *{margin:0;padding:0;box-sizing:border-box}

  /* ── Public report shell — exact match with trends.$slug.tsx ── */
  .psl-page {
    min-height: 100vh;
    background-color: #f0ebe2;
    background-image:
      radial-gradient(circle at top right, rgba(122,30,40,0.05) 0, transparent 30%),
      url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.055 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>");
    color: #1a1109;
    font-family: 'Cormorant Garamond', Garamond, serif;
    -webkit-font-smoothing: antialiased;
  }

  /* Header */
  .psl-header { border-bottom: 1px solid rgba(26,17,9,0.08); }
  .psl-header-inner {
    max-width: 100rem; margin: 0 auto; display: flex; align-items: center;
    justify-content: space-between; padding: 18px 40px; gap: 32px;
  }
  @media (max-width: 639px) { .psl-header-inner { padding: 16px 24px; } }
  .psl-sitenav-links { display: none; align-items: center; gap: 20px; flex: 1; }
  @media (min-width: 768px) { .psl-sitenav-links { display: flex; } }
  .psl-sitenav-link {
    font-family: 'Space Mono', monospace; font-size: 0.58rem; letter-spacing: 0.12em;
    text-transform: uppercase; color: rgba(26,17,9,0.55); text-decoration: none;
    transition: color 0.2s; white-space: nowrap;
  }
  .psl-sitenav-link:hover, .psl-sitenav-link.active { color: #7a1e28; }
  .psl-header-logo {
    font-family: 'Oswald', sans-serif; font-size: 0.875rem; font-weight: 200;
    letter-spacing: 0.4em; text-transform: uppercase; color: #1a1109;
    text-decoration: none; white-space: nowrap;
  }
  .psl-header-right {
    display: flex; justify-content: flex-end; align-items: center; gap: 16px; flex: 1;
  }
  .psl-personal-link {
    font-family: 'Space Mono', monospace; font-size: 0.58rem; letter-spacing: 0.16em;
    text-transform: uppercase; color: #7a1e28; text-decoration: none;
    transition: opacity 0.2s; white-space: nowrap;
  }
  .psl-personal-link:hover { opacity: 0.75; }

  /* Hero */
  .psl-hero { position: relative; overflow: hidden; }
  .psl-hero-num {
    position: absolute; right: -24px; top: -64px;
    font-family: 'Oswald', sans-serif; font-size: clamp(16rem, 22vw, 22rem);
    font-weight: 200; letter-spacing: 0.02em; text-transform: uppercase; line-height: 1;
    color: rgba(26,17,9,0.05); pointer-events: none; user-select: none;
  }
  .psl-hero-inner {
    position: relative; max-width: 80rem; margin: 0 auto; padding: 64px 40px 80px;
  }
  @media (min-width: 640px) { .psl-hero-inner { padding: 96px 40px 112px; } }
  .psl-back {
    display: inline-flex; align-items: center; gap: 8px;
    font-family: 'Space Mono', monospace; font-size: 0.6rem; letter-spacing: 0.3em;
    text-transform: uppercase; color: rgba(26,17,9,0.6); text-decoration: none;
    margin-bottom: 40px; transition: color 0.2s;
  }
  .psl-back:hover { color: #7a1e28; }
  .psl-kicker {
    font-family: 'Space Mono', monospace; font-size: 0.6rem; letter-spacing: 0.34em;
    text-transform: uppercase; color: rgba(26,17,9,0.55); margin-bottom: 24px;
  }
  .psl-hero-title {
    font-family: 'Oswald', sans-serif; font-size: clamp(3rem, 7vw, 7rem);
    font-weight: 200; line-height: 0.9; letter-spacing: 0.02em; text-transform: uppercase;
    margin: 0 0 32px; color: #1a1109;
  }
  .psl-hero-title em {
    font-family: 'Cormorant Garamond', serif; font-style: italic; font-weight: 300;
    text-transform: none; color: #7a1e28;
  }
  .psl-hero-lede {
    font-family: 'Cormorant Garamond', serif; font-size: 1.2rem; line-height: 1.75;
    color: rgba(26,17,9,0.75); max-width: 48rem; margin-bottom: 32px;
  }
  .psl-hero-meta {
    display: flex; flex-wrap: wrap; gap: 24px;
    font-family: 'Space Mono', monospace; font-size: 0.6rem;
    letter-spacing: 0.28em; text-transform: uppercase; color: rgba(26,17,9,0.45);
  }

  /* Body */
  .psl-body { max-width: 48rem; margin: 0 auto; padding: 80px 40px; }
  @media (min-width: 640px) { .psl-body { padding: 112px 40px; } }

  .psl-section-label {
    font-family: 'Space Mono', monospace; font-size: 0.6rem; letter-spacing: 0.34em;
    text-transform: uppercase; color: #7a1e28; margin-bottom: 20px;
  }
  .psl-body-text {
    font-family: 'Cormorant Garamond', serif; font-size: 1.1rem; line-height: 1.85;
    color: rgba(26,17,9,0.85);
  }
  .psl-divider { height: 1px; background: rgba(26,17,9,0.1); margin: 48px 0; }

  /* Lens heading inside body */
  .psl-lens-heading {
    font-family: 'Oswald', sans-serif; font-size: clamp(1.8rem, 4vw, 3rem);
    font-weight: 200; letter-spacing: 0.02em; text-transform: uppercase;
    color: #1a1109; line-height: 1.1; margin-bottom: 48px;
  }

  /* Module wrappers */
  .psl-mod-section { margin-bottom: 0; }

  /* Shared module helpers */
  .psl-struct-intro {
    font-family: 'Cormorant Garamond', serif; font-size: 1rem; line-height: 1.7;
    color: rgba(26,17,9,0.60); font-style: italic; margin-bottom: 16px;
  }
  .psl-stacked-sub {
    font-family: 'Cormorant Garamond', serif; font-size: 0.92rem; line-height: 1.55;
    color: rgba(26,17,9,0.55); font-style: italic; margin-top: 4px;
  }

  /* Highlight callout — matches psl-naia-take in public report */
  .psl-naia-take {
    padding: 28px 32px; border-left: 3px solid #7a1e28;
    background: rgba(122,30,40,0.04); margin-bottom: 48px;
  }

  /* Lens nav */
  .psl-lens { max-width: 48rem; margin: 0 auto; padding: 0 40px 40px; }
  .psl-lens-label {
    font-family: 'Space Mono', monospace; font-size: 0.58rem; letter-spacing: 0.3em;
    text-transform: uppercase; color: rgba(26,17,9,0.45); margin-bottom: 14px;
  }
  .psl-lens-desc {
    font-family: 'Cormorant Garamond', serif; font-style: italic; font-size: 1rem;
    color: rgba(26,17,9,0.60); line-height: 1.65; margin-bottom: 20px;
  }
  .psl-lens-row { display: flex; flex-wrap: wrap; gap: 8px; }
  .psl-lens-btn {
    display: inline-block; padding: 10px 20px;
    font-family: 'Space Mono', monospace; font-size: 0.58rem; letter-spacing: 0.22em;
    text-transform: uppercase; text-decoration: none;
    border: 1px solid rgba(26,17,9,0.18); color: #1a1109;
    transition: border-color 0.15s, color 0.15s;
  }
  .psl-lens-btn:hover { border-color: #7a1e28; color: #7a1e28; }
  .psl-lens-btn.active { background: #1a1109; color: #f0ebe2; border-color: #1a1109; }
  .psl-my-edit-sep {
    margin-top: 28px; padding-top: 20px; border-top: 1px solid rgba(26,17,9,0.08);
    display: flex; flex-direction: column; align-items: flex-start; gap: 12px;
  }
  .psl-my-edit-sep-label {
    font-family: 'Space Mono', monospace; font-size: 0.52rem; letter-spacing: 0.3em;
    text-transform: uppercase; color: rgba(26,17,9,0.40);
  }
  .psl-my-edit-btn {
    display: inline-block; padding: 12px 24px;
    font-family: 'Space Mono', monospace; font-size: 0.58rem; letter-spacing: 0.22em;
    text-transform: uppercase; text-decoration: none;
    border: 1px solid rgba(122,30,40,0.35); color: rgba(26,17,9,0.75);
    transition: background 0.15s, color 0.15s, border-color 0.15s;
  }
  .psl-my-edit-btn:hover { background: #7a1e28; color: #f5f0e8; border-color: #7a1e28; }

  /* CTA — same dark treatment as public report */
  .psl-cta { background: #2a1e17; color: #f0ebe2; }
  .psl-cta-inner {
    max-width: 80rem; margin: 0 auto; padding: 80px 40px; display: grid; gap: 40px;
  }
  @media (min-width: 640px) { .psl-cta-inner { padding: 96px 40px; } }
  @media (min-width: 1024px) { .psl-cta-inner { grid-template-columns: 1.1fr 1fr; align-items: flex-end; } }
  .psl-cta-title {
    font-family: 'Oswald', sans-serif; font-size: clamp(2.4rem, 5vw, 4.5rem);
    font-weight: 200; letter-spacing: 0.02em; text-transform: uppercase;
    line-height: 0.95; margin: 0 0 32px;
  }
  .psl-cta-title em {
    font-family: 'Cormorant Garamond', serif; font-style: italic; font-weight: 300;
    text-transform: none; color: #e8c9a8;
  }
  .psl-cta-body {
    font-family: 'Cormorant Garamond', serif; font-size: 1.05rem; line-height: 1.75;
    color: rgba(240,235,226,0.75); max-width: 36rem; margin-bottom: 32px;
  }
  .psl-cta-btn {
    display: inline-flex; align-items: center; gap: 10px;
    border: 1px solid rgba(240,235,226,0.8); border-radius: 9999px;
    padding: 12px 24px; font-family: 'Space Mono', monospace; font-size: 0.65rem;
    letter-spacing: 0.3em; text-transform: uppercase; color: #f0ebe2;
    text-decoration: none; transition: background 0.2s, color 0.2s;
  }
  .psl-cta-btn:hover { background: #f0ebe2; color: #1a1109; }

  /* ── DESIGNER dl-* — atelier composition ── */
  .by-lede { font-family: 'Cormorant Garamond', serif; font-size: 1.35rem; line-height: 1.75; color: #1a1109; font-style: italic; }
  .dl-spec-rows { margin-top: 12px; border: 1px solid rgba(26,17,9,0.10); }
  .dl-spec-row { display: grid; grid-template-columns: 160px 1fr; border-bottom: 1px solid rgba(26,17,9,0.06); }
  .dl-spec-row:last-child { border-bottom: none; }
  .dl-spec-key { padding: 14px 18px; font-family: 'Space Mono', monospace; font-size: 0.55rem; letter-spacing: 0.22em; text-transform: uppercase; color: rgba(26,17,9,0.55); background: rgba(26,17,9,0.02); }
  .dl-spec-val { padding: 14px 18px; font-family: 'Cormorant Garamond', serif; font-size: 1.05rem; line-height: 1.6; color: #1a1109; }
  .dl-warn-panel { background: #1a1109; color: #f0ebe2; padding: 28px 32px; }
  .dl-warn-label { font-family: 'Space Mono', monospace; font-size: 0.6rem; letter-spacing: 0.34em; text-transform: uppercase; color: rgba(240,235,226,0.40); margin-bottom: 14px; }
  .dl-warn-chips { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
  .dl-warn-chip { padding: 7px 14px; border: 1px solid rgba(255,255,255,0.20); font-family: 'Space Mono', monospace; font-size: 0.55rem; letter-spacing: 0.22em; text-transform: uppercase; color: rgba(255,255,255,0.75); }
  .dl-warn-close { font-family: 'Cormorant Garamond', serif; font-size: 1rem; line-height: 1.7; color: rgba(255,255,255,0.50); font-style: italic; }
  .dl-dev-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 12px; }
  .dl-dev-card { padding: 20px 24px; border: 1px solid rgba(26,17,9,0.12); }
  .dl-dev-label { font-family: 'Space Mono', monospace; font-size: 0.55rem; letter-spacing: 0.22em; text-transform: uppercase; color: #7a1e28; margin-bottom: 10px; }
  .dl-dev-body { font-family: 'Cormorant Garamond', serif; font-size: 1.05rem; line-height: 1.6; color: #1a1109; }
  .dl-fit-list { margin-top: 12px; }
  .dl-fit-row { display: flex; align-items: baseline; gap: 16px; padding: 10px 0; border-bottom: 1px solid rgba(26,17,9,0.05); }
  .dl-fit-row:last-child { border-bottom: none; }
  .dl-fit-num { font-family: 'Space Mono', monospace; font-size: 0.55rem; letter-spacing: 0.22em; color: #7a1e28; flex-shrink: 0; width: 24px; font-weight: 700; }
  .dl-fit-text { font-family: 'Cormorant Garamond', serif; font-size: 1.05rem; line-height: 1.65; color: #1a1109; }

  /* ── BUYER by-* — commercial composition ── */
  .by-tier-grid { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
  .by-tier { padding: 20px 24px; background: rgba(240,235,226,0.5); }
  .by-tier--deep { border-left: 5px solid #1a1109; }
  .by-tier--test { border-left: 3px solid #7a1e28; }
  .by-tier--hold { border-left: 1px solid rgba(26,17,9,0.20); }
  .by-tier-label { font-family: 'Space Mono', monospace; font-size: 0.55rem; letter-spacing: 0.22em; text-transform: uppercase; color: #7a1e28; margin-bottom: 8px; }
  .by-tier-items { font-family: 'Cormorant Garamond', serif; font-size: 1.05rem; line-height: 1.5; color: #1a1109; margin-bottom: 6px; }
  .by-tier-note { font-family: 'Cormorant Garamond', serif; font-size: 0.92rem; line-height: 1.55; color: rgba(26,17,9,0.55); font-style: italic; }
  .by-table { margin-top: 12px; border: 1px solid rgba(26,17,9,0.08); }
  .by-table-row { display: grid; grid-template-columns: 1fr 1fr; border-bottom: 1px solid rgba(26,17,9,0.06); }
  .by-table-row:last-child { border-bottom: none; }
  .by-table-key { padding: 14px 18px; font-family: 'Space Mono', monospace; font-size: 0.55rem; letter-spacing: 0.22em; text-transform: uppercase; color: rgba(26,17,9,0.55); background: rgba(26,17,9,0.02); display: flex; align-items: center; }
  .by-table-val { padding: 14px 18px; font-family: 'Cormorant Garamond', serif; font-size: 1rem; line-height: 1.55; color: #1a1109; }
  .by-risk-panel { background: rgba(122,30,40,0.05); border: 1px solid rgba(122,30,40,0.18); padding: 24px 28px; }
  .by-risk-label { font-family: 'Space Mono', monospace; font-size: 0.6rem; letter-spacing: 0.34em; text-transform: uppercase; color: #7a1e28; margin-bottom: 14px; }
  .by-risk-chips { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
  .by-risk-chip { padding: 7px 14px; border: 1px solid rgba(122,30,40,0.30); font-family: 'Space Mono', monospace; font-size: 0.55rem; letter-spacing: 0.22em; text-transform: uppercase; color: #7a1e28; }
  .by-risk-close { font-family: 'Cormorant Garamond', serif; font-size: 1rem; line-height: 1.65; color: rgba(26,17,9,0.55); font-style: italic; }
  .by-depth-rows { margin-top: 12px; }
  .by-depth-row { display: grid; grid-template-columns: 160px 1fr; gap: 16px; padding: 16px 0 16px 20px; border-bottom: 1px solid rgba(26,17,9,0.06); border-left: 4px solid transparent; }
  .by-depth-row:last-child { border-bottom: none; }
  .by-depth-row--deep { border-left-color: #1a1109; }
  .by-depth-row--test { border-left-color: #7a1e28; border-left-width: 2px; padding-left: 22px; }
  .by-depth-row--hold { border-left-color: rgba(26,17,9,0.15); border-left-width: 1px; padding-left: 23px; }
  .by-depth-label { font-family: 'Space Mono', monospace; font-size: 0.55rem; letter-spacing: 0.22em; text-transform: uppercase; color: #7a1e28; padding-top: 3px; }
  .by-depth-body { font-family: 'Cormorant Garamond', serif; font-size: 1.05rem; line-height: 1.6; color: #1a1109; }
  .by-decision { padding: 28px 32px; background: #1a1109; color: #f0ebe2; margin-top: 48px; margin-bottom: 48px; }
  .by-decision .psl-section-label { color: rgba(240,235,226,0.40); }
  .by-decision .psl-body-text { color: #f0ebe2; font-size: 1.15rem; line-height: 1.85; }

  /* ── MARKETER mk-* — campaign composition ── */
  .mk-tension { font-family: 'Cormorant Garamond', serif; font-size: 1.3rem; line-height: 1.85; color: #1a1109; }
  .mk-message-panel { background: #1a1109; color: #f0ebe2; padding: 40px; margin: 48px -40px; width: calc(100% + 80px); }
  .mk-message-label { font-family: 'Space Mono', monospace; font-size: 0.6rem; letter-spacing: 0.34em; text-transform: uppercase; color: rgba(240,235,226,0.35); margin-bottom: 20px; }
  .mk-message-body { font-family: 'Cormorant Garamond', serif; font-size: clamp(1.2rem, 2.5vw, 1.8rem); font-weight: 300; font-style: italic; color: #f0ebe2; line-height: 1.6; }
  .mk-angles-list { margin-top: 12px; display: flex; flex-direction: column; }
  .mk-angle-item { display: grid; grid-template-columns: 28px 1fr; gap: 0 16px; padding: 18px 0; border-bottom: 1px solid rgba(26,17,9,0.06); align-items: start; }
  .mk-angle-item:last-child { border-bottom: none; }
  .mk-angle-num { font-family: 'Space Mono', monospace; font-size: 0.55rem; letter-spacing: 0.22em; color: #7a1e28; padding-top: 4px; }
  .mk-angle-head { font-family: 'Space Mono', monospace; font-size: 0.55rem; letter-spacing: 0.22em; text-transform: uppercase; color: rgba(26,17,9,0.55); margin-bottom: 6px; }
  .mk-angle-body { font-family: 'Cormorant Garamond', serif; font-size: 1.05rem; line-height: 1.65; color: #1a1109; }
  .mk-copy-table { margin-top: 12px; border: 1px solid rgba(26,17,9,0.08); }
  .mk-copy-row { display: grid; grid-template-columns: 110px 1fr; border-bottom: 1px solid rgba(26,17,9,0.06); }
  .mk-copy-row:last-child { border-bottom: none; }
  .mk-copy-key { padding: 14px 18px; font-family: 'Space Mono', monospace; font-size: 0.55rem; letter-spacing: 0.22em; text-transform: uppercase; color: #7a1e28; background: rgba(26,17,9,0.02); display: flex; align-items: center; }
  .mk-copy-val { padding: 14px 18px; font-family: 'Cormorant Garamond', serif; font-size: 1rem; line-height: 1.55; color: #1a1109; }
  .mk-copy-sub { font-family: 'Cormorant Garamond', serif; font-size: 0.92rem; font-style: italic; color: rgba(26,17,9,0.55); margin-top: 6px; }
  .mk-visual-rows { margin-top: 12px; }
  .mk-visual-row { display: grid; grid-template-columns: 160px 1fr; gap: 16px; padding: 14px 0; border-bottom: 1px solid rgba(26,17,9,0.06); }
  .mk-visual-row:last-child { border-bottom: none; }
  .mk-visual-key { font-family: 'Space Mono', monospace; font-size: 0.55rem; letter-spacing: 0.22em; text-transform: uppercase; color: #7a1e28; padding-top: 3px; }
  .mk-hook-chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
  .mk-hook-chip { padding: 9px 18px; background: #1a1109; font-family: 'Space Mono', monospace; font-size: 0.55rem; letter-spacing: 0.22em; text-transform: uppercase; color: #f0ebe2; }
  .mk-hook-close { font-family: 'Cormorant Garamond', serif; font-size: 1rem; line-height: 1.7; color: rgba(26,17,9,0.55); font-style: italic; margin-top: 16px; }

  /* ── CREATIVE DIRECTOR cd-* — visual brief composition ── */
  .cd-brief { font-family: 'Cormorant Garamond', serif; font-size: 1.3rem; line-height: 2; color: #1a1109; }
  .cd-open-rows { margin-top: 12px; display: flex; flex-direction: column; }
  .cd-open-row { display: grid; grid-template-columns: 130px 1fr; gap: 0 24px; padding: 20px 0; border-bottom: 1px solid rgba(26,17,9,0.05); align-items: start; }
  .cd-open-row:last-child { border-bottom: none; }
  .cd-open-label { font-family: 'Space Mono', monospace; font-size: 0.55rem; letter-spacing: 0.22em; text-transform: uppercase; color: rgba(26,17,9,0.35); padding-top: 4px; line-height: 1.6; }
  .cd-open-body { font-family: 'Cormorant Garamond', serif; font-size: 1.05rem; line-height: 1.85; color: #1a1109; }
  .cd-open-sub { font-family: 'Cormorant Garamond', serif; font-size: 0.92rem; line-height: 1.6; color: rgba(26,17,9,0.55); font-style: italic; margin-top: 6px; }
  .cd-restrict-list { margin-top: 12px; display: flex; flex-direction: column; gap: 12px; }
  .cd-restrict-item { font-family: 'Cormorant Garamond', serif; font-size: 1.05rem; line-height: 1.7; color: #1a1109; padding-left: 28px; position: relative; }
  .cd-restrict-item::before { content: "—"; position: absolute; left: 0; color: rgba(26,17,9,0.55); }
  .cd-risk-items { margin-top: 12px; display: flex; flex-direction: column; gap: 12px; }
  .cd-risk-item { font-family: 'Cormorant Garamond', serif; font-size: 1.05rem; line-height: 1.7; color: rgba(26,17,9,0.55); font-style: italic; padding-left: 28px; position: relative; }
  .cd-risk-item::before { content: "✕"; position: absolute; left: 0; color: #7a1e28; font-family: 'Space Mono', monospace; font-size: 0.65rem; top: 3px; font-style: normal; }
  .cd-close-note { font-family: 'Cormorant Garamond', serif; font-size: 0.95rem; line-height: 1.7; color: rgba(26,17,9,0.55); font-style: italic; margin-top: 16px; }
  .cd-direction { margin-top: 56px; margin-bottom: 48px; }
  .cd-direction-label { font-family: 'Space Mono', monospace; font-size: 0.6rem; letter-spacing: 0.34em; text-transform: uppercase; color: #7a1e28; margin-bottom: 24px; }
  .cd-direction-body { font-family: 'Cormorant Garamond', serif; font-size: clamp(1.5rem, 3.5vw, 2.8rem); font-weight: 300; font-style: italic; color: #1a1109; line-height: 1.45; }

  /* ── STYLIST st-* — getting-dressed composition ── */
  .st-read { font-family: 'Cormorant Garamond', serif; font-size: 1.25rem; line-height: 1.85; color: #1a1109; }
  .st-anchor-chips { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 12px; }
  .st-anchor-chip { padding: 12px 22px; background: #1a1109; font-family: 'Space Mono', monospace; font-size: 0.55rem; letter-spacing: 0.22em; text-transform: uppercase; color: #f0ebe2; }
  .st-anchor-close { font-family: 'Cormorant Garamond', serif; font-size: 1rem; line-height: 1.7; color: rgba(26,17,9,0.55); font-style: italic; margin-top: 16px; }
  .st-proportion-rows { margin-top: 12px; }
  .st-proportion-row { display: grid; grid-template-columns: 1fr 1fr; border-bottom: 1px solid rgba(26,17,9,0.06); }
  .st-proportion-row:first-child { border-top: 1px solid rgba(26,17,9,0.06); }
  .st-proportion-key { padding: 14px 18px; font-family: 'Space Mono', monospace; font-size: 0.55rem; letter-spacing: 0.22em; text-transform: uppercase; color: rgba(26,17,9,0.55); background: rgba(26,17,9,0.02); display: flex; align-items: center; }
  .st-proportion-val { padding: 14px 18px; font-family: 'Cormorant Garamond', serif; font-size: 1.05rem; line-height: 1.6; color: #1a1109; }
  .st-proportion-sub { font-family: 'Cormorant Garamond', serif; font-size: 0.92rem; font-style: italic; color: rgba(26,17,9,0.55); margin-top: 4px; }
  .st-occasion-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 12px; }
  .st-occasion-card { padding: 20px; background: rgba(240,235,226,0.6); border: 1px solid rgba(26,17,9,0.08); }
  .st-occasion-label { font-family: 'Space Mono', monospace; font-size: 0.55rem; letter-spacing: 0.22em; text-transform: uppercase; color: #7a1e28; margin-bottom: 10px; }
  .st-occasion-body { font-family: 'Cormorant Garamond', serif; font-size: 1.05rem; line-height: 1.6; color: #1a1109; }
  .st-pair-chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
  .st-pair-chip { padding: 8px 16px; border: 1px solid rgba(26,17,9,0.15); font-family: 'Space Mono', monospace; font-size: 0.55rem; letter-spacing: 0.22em; text-transform: uppercase; color: #1a1109; background: rgba(240,235,226,0.5); }
  .st-pair-close { font-family: 'Cormorant Garamond', serif; font-size: 1rem; line-height: 1.7; color: rgba(26,17,9,0.55); font-style: italic; margin-top: 14px; }
  .st-risk-chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
  .st-risk-chip { padding: 8px 16px; border: 1px solid rgba(122,30,40,0.25); font-family: 'Space Mono', monospace; font-size: 0.55rem; letter-spacing: 0.22em; text-transform: uppercase; color: #7a1e28; }
  .st-risk-close { font-family: 'Cormorant Garamond', serif; font-size: 1rem; line-height: 1.7; color: rgba(26,17,9,0.55); font-style: italic; margin-top: 14px; }
  .st-formula-rows { margin-top: 12px; display: flex; flex-direction: column; }
  .st-formula-row { display: grid; grid-template-columns: 120px 1fr; gap: 0 16px; padding: 14px 0; border-bottom: 1px solid rgba(26,17,9,0.06); align-items: start; }
  .st-formula-row:last-child { border-bottom: none; }
  .st-formula-label { font-family: 'Space Mono', monospace; font-size: 0.55rem; letter-spacing: 0.22em; text-transform: uppercase; color: #7a1e28; padding-top: 3px; font-weight: 700; }
  .st-formula-val { font-family: 'Cormorant Garamond', serif; font-size: 1.05rem; line-height: 1.6; color: #1a1109; }
  .st-formula-sub { font-family: 'Cormorant Garamond', serif; font-size: 0.92rem; font-style: italic; color: rgba(26,17,9,0.55); margin-top: 4px; }
  .st-mirror-rows { margin-top: 12px; display: flex; flex-direction: column; }
  .st-mirror-row { padding: 16px 0; border-bottom: 1px solid rgba(26,17,9,0.06); }
  .st-mirror-row:last-child { border-bottom: none; }
  .st-mirror-label { font-family: 'Space Mono', monospace; font-size: 0.55rem; letter-spacing: 0.22em; text-transform: uppercase; color: rgba(26,17,9,0.55); margin-bottom: 6px; }
  .st-mirror-body { font-family: 'Cormorant Garamond', serif; font-size: 1.1rem; line-height: 1.7; color: #1a1109; font-style: italic; }
  .st-mirror-sub { font-family: 'Cormorant Garamond', serif; font-size: 0.92rem; color: rgba(26,17,9,0.55); margin-top: 4px; }

  /* ── Responsive ── */
  @media (max-width: 600px) {
    .psl-body { padding: 60px 24px; }
    .psl-lens { padding: 0 24px 40px; }
    .mk-message-panel { margin: 48px -24px; width: calc(100% + 48px); padding: 32px 24px; }
    .dl-spec-row { grid-template-columns: 1fr; }
    .dl-spec-key { background: none; padding-bottom: 4px; }
    .dl-dev-grid, .st-occasion-grid { grid-template-columns: 1fr; }
    .by-depth-row { grid-template-columns: 1fr; padding-left: 16px; }
    .by-table-row { grid-template-columns: 1fr; }
    .by-table-key { background: none; padding-bottom: 4px; }
    .cd-open-row { grid-template-columns: 1fr; gap: 6px; }
    .cd-open-label { padding-top: 0; }
    .mk-copy-row { grid-template-columns: 1fr; }
    .mk-copy-key { background: none; padding-bottom: 4px; }
    .mk-visual-row { grid-template-columns: 1fr; gap: 4px; }
    .st-proportion-row { grid-template-columns: 1fr; }
    .st-proportion-key { background: none; padding-bottom: 4px; }
    .st-formula-row { grid-template-columns: 1fr; gap: 4px; }
    .mk-angle-item { grid-template-columns: 22px 1fr; }
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
            <div key={i} className="psl-mod-section">
              <div className="psl-section-label">{mod.label}</div>
              <p className="psl-body-text">{mod.body}</p>
              {!isLast && <div className="psl-divider" />}
            </div>
          );
        }
        switch (mod.type) {
          case "structured-code": return (
            <div key={i} className="psl-mod-section">
              <div className="psl-section-label">{mod.label}</div>
              {mod.intro && <p className="psl-struct-intro">{mod.intro}</p>}
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
              {!isLast && <div className="psl-divider" />}
            </div>
          );
          case "avoid-chips": return (
            <div key={i} className="psl-mod-section">
              <div className="dl-warn-panel">
                <div className="dl-warn-label">{mod.label}</div>
                <div className="dl-warn-chips">
                  {mod.chips.map((chip, j) => <span key={j} className="dl-warn-chip">{chip}</span>)}
                </div>
                <p className="dl-warn-close">{mod.closing}</p>
              </div>
              {!isLast && <div className="psl-divider" />}
            </div>
          );
          case "product-brief": return (
            <div key={i} className="psl-mod-section">
              <div className="psl-section-label">{mod.label}</div>
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
              <p className="psl-struct-intro" style={{ marginTop: "16px", marginBottom: 0 }}>{mod.proofLine}</p>
              {!isLast && <div className="psl-divider" />}
            </div>
          );
          case "decision-grid": return (
            <div key={i} className="psl-mod-section">
              <div className="psl-section-label">{mod.label}</div>
              <div className="dl-spec-rows">
                {mod.decisions.map((d, j) => (
                  <div key={j} className="dl-spec-row">
                    <div className="dl-spec-key">{d.label}</div>
                    <div className="dl-spec-val">{d.body}</div>
                  </div>
                ))}
              </div>
              {!isLast && <div className="psl-divider" />}
            </div>
          );
          case "prototype-cards": return (
            <div key={i} className="psl-mod-section">
              <div className="psl-section-label">{mod.label}</div>
              {mod.intro && <p className="psl-struct-intro">{mod.intro}</p>}
              <div className="dl-dev-grid">
                {mod.cards.map((card, j) => (
                  <div key={j} className="dl-dev-card">
                    <div className="dl-dev-label">{card.label}</div>
                    <p className="dl-dev-body">{card.body}</p>
                  </div>
                ))}
              </div>
              {!isLast && <div className="psl-divider" />}
            </div>
          );
          case "checklist": return (
            <div key={i} className="psl-mod-section">
              <div className="psl-section-label">{mod.label}</div>
              <div className="dl-fit-list">
                {mod.items.map((item, j) => (
                  <div key={j} className="dl-fit-row">
                    <span className="dl-fit-num">{String(j + 1).padStart(2, "0")}</span>
                    <span className="dl-fit-text">{item}</span>
                  </div>
                ))}
              </div>
              {!isLast && <div className="psl-divider" />}
            </div>
          );
          case "highlight": return (
            <div key={i} className="psl-naia-take">
              <div className="psl-section-label">{mod.label}</div>
              <p className="psl-body-text">{mod.body}</p>
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
            <div key={i} className="psl-mod-section">
              <div className="psl-section-label">{mod.label}</div>
              <p className="by-lede">{mod.body}</p>
              {!isLast && <div className="psl-divider" />}
            </div>
          );
        }
        switch (mod.type) {
          case "assortment-cards": return (
            <div key={i} className="psl-mod-section">
              <div className="psl-section-label">{mod.label}</div>
              <div className="by-tier-grid">
                {mod.cards.map((card, j) => (
                  <div key={j} className={tierClass(j)}>
                    <div className="by-tier-label">{card.label}</div>
                    <p className="by-tier-items">{card.items}</p>
                    <p className="by-tier-note">{card.note}</p>
                  </div>
                ))}
              </div>
              {!isLast && <div className="psl-divider" />}
            </div>
          );
          case "decision-grid": return (
            <div key={i} className="psl-mod-section">
              <div className="psl-section-label">{mod.label}</div>
              <div className="by-table">
                {mod.decisions.map((d, j) => (
                  <div key={j} className="by-table-row">
                    <div className="by-table-key">{d.label}</div>
                    <div className="by-table-val">{d.body}</div>
                  </div>
                ))}
              </div>
              {!isLast && <div className="psl-divider" />}
            </div>
          );
          case "avoid-chips": return (
            <div key={i} className="psl-mod-section">
              <div className="by-risk-panel">
                <div className="by-risk-label">{mod.label}</div>
                <div className="by-risk-chips">
                  {mod.chips.map((chip, j) => <span key={j} className="by-risk-chip">{chip}</span>)}
                </div>
                <p className="by-risk-close">{mod.closing}</p>
              </div>
              {!isLast && <div className="psl-divider" />}
            </div>
          );
          case "stacked-rows": return (
            <div key={i} className="psl-mod-section">
              <div className="psl-section-label">{mod.label}</div>
              <div className="by-depth-rows">
                {mod.rows.map((row, j) => (
                  <div key={j} className={depthClass(row.label)}>
                    <span className="by-depth-label">{row.label}</span>
                    <div>
                      <p className="by-depth-body">{row.body}</p>
                      {row.sub && <p className="psl-stacked-sub">{row.sub}</p>}
                    </div>
                  </div>
                ))}
              </div>
              {!isLast && <div className="psl-divider" />}
            </div>
          );
          case "highlight": return (
            <div key={i} className="by-decision">
              <div className="psl-section-label">{mod.label}</div>
              <p className="psl-body-text">{mod.body}</p>
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
            <div key={i} className="psl-mod-section">
              <div className="psl-section-label">{mod.label}</div>
              <p className="mk-tension">{mod.body}</p>
              {!isLast && <div className="psl-divider" />}
            </div>
          );
        }
        switch (mod.type) {
          case "highlight": {
            highlightCount.seen += 1;
            if (highlightCount.seen === 1) {
              return (
                <div key={i} className="mk-message-panel">
                  <div className="mk-message-label">{mod.label}</div>
                  <p className="mk-message-body">{mod.body}</p>
                </div>
              );
            }
            return (
              <div key={i} className="psl-naia-take">
                <div className="psl-section-label">{mod.label}</div>
                <p className="psl-body-text">{mod.body}</p>
              </div>
            );
          }
          case "prototype-cards": return (
            <div key={i} className="psl-mod-section">
              <div className="psl-section-label">{mod.label}</div>
              {mod.intro && <p className="psl-struct-intro">{mod.intro}</p>}
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
              {!isLast && <div className="psl-divider" />}
            </div>
          );
          case "stacked-rows": {
            const isCopy = mod.label.toUpperCase().includes("COPY");
            return (
              <div key={i} className="psl-mod-section">
                <div className="psl-section-label">{mod.label}</div>
                {isCopy ? (
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
                ) : (
                  <div className="mk-visual-rows">
                    {mod.rows.map((row, j) => (
                      <div key={j} className="mk-visual-row">
                        <span className="mk-visual-key">{row.label}</span>
                        <div>
                          <p className="psl-body-text" style={{ fontSize: "1.05rem" }}>{row.body}</p>
                          {row.sub && <p className="psl-stacked-sub">{row.sub}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {!isLast && <div className="psl-divider" />}
              </div>
            );
          }
          case "avoid-chips": return (
            <div key={i} className="psl-mod-section">
              <div className="psl-section-label">{mod.label}</div>
              <div className="mk-hook-chips">
                {mod.chips.map((chip, j) => <span key={j} className="mk-hook-chip">{chip}</span>)}
              </div>
              {mod.closing && <p className="mk-hook-close">{mod.closing}</p>}
              {!isLast && <div className="psl-divider" />}
            </div>
          );
          default: return null;
        }
      })}
    </>
  );
}

// ── CREATIVE DIRECTOR: Visual Brief ──────────────────────────────────────

function CDLens({ modules }: { modules: LensModule[] }) {
  return (
    <>
      {modules.map((mod: LensModule, i: number) => {
        const isLast = i === modules.length - 1;
        if (!("type" in mod)) {
          return (
            <div key={i} className="psl-mod-section">
              <div className="psl-section-label">{mod.label}</div>
              <p className="cd-brief">{mod.body}</p>
              {!isLast && <div className="psl-divider" />}
            </div>
          );
        }
        switch (mod.type) {
          case "stacked-rows": return (
            <div key={i} className="psl-mod-section">
              <div className="psl-section-label">{mod.label}</div>
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
              {!isLast && <div className="psl-divider" />}
            </div>
          );
          case "avoid-chips": {
            const isRisk = mod.label.toUpperCase().includes("RISK");
            return (
              <div key={i} className="psl-mod-section">
                <div className="psl-section-label">{mod.label}</div>
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
                {!isLast && <div className="psl-divider" />}
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

// ── STYLIST: Getting-Dressed Formula ─────────────────────────────────────

function StylistLens({ modules }: { modules: LensModule[] }) {
  return (
    <>
      {modules.map((mod: LensModule, i: number) => {
        const isLast = i === modules.length - 1;
        if (!("type" in mod)) {
          return (
            <div key={i} className="psl-mod-section">
              <div className="psl-section-label">{mod.label}</div>
              <p className="st-read">{mod.body}</p>
              {!isLast && <div className="psl-divider" />}
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
              <div key={i} className="psl-mod-section">
                <div className="psl-section-label">{mod.label}</div>
                <div className={rowClass}>
                  {mod.chips.map((chip, j) => <span key={j} className={chipClass}>{chip}</span>)}
                </div>
                {mod.closing && <p className={closeClass}>{mod.closing}</p>}
                {!isLast && <div className="psl-divider" />}
              </div>
            );
          }
          case "stacked-rows": {
            const lbl = mod.label.toUpperCase();
            if (lbl.includes("PROPORTION")) {
              return (
                <div key={i} className="psl-mod-section">
                  <div className="psl-section-label">{mod.label}</div>
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
                  {!isLast && <div className="psl-divider" />}
                </div>
              );
            }
            if (lbl.includes("MIRROR")) {
              return (
                <div key={i} className="psl-mod-section">
                  <div className="psl-section-label">{mod.label}</div>
                  <div className="st-mirror-rows">
                    {mod.rows.map((row, j) => (
                      <div key={j} className="st-mirror-row">
                        <div className="st-mirror-label">{row.label}</div>
                        <p className="st-mirror-body">{row.body}</p>
                        {row.sub && <p className="st-mirror-sub">{row.sub}</p>}
                      </div>
                    ))}
                  </div>
                  {!isLast && <div className="psl-divider" />}
                </div>
              );
            }
            return (
              <div key={i} className="psl-mod-section">
                <div className="psl-section-label">{mod.label}</div>
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
                {!isLast && <div className="psl-divider" />}
              </div>
            );
          }
          case "prototype-cards": return (
            <div key={i} className="psl-mod-section">
              <div className="psl-section-label">{mod.label}</div>
              {mod.intro && <p className="psl-struct-intro">{mod.intro}</p>}
              <div className="st-occasion-grid">
                {mod.cards.map((card, j) => (
                  <div key={j} className="st-occasion-card">
                    <div className="st-occasion-label">{card.label}</div>
                    <p className="st-occasion-body">{card.body}</p>
                  </div>
                ))}
              </div>
              {!isLast && <div className="psl-divider" />}
            </div>
          );
          case "highlight": return (
            <div key={i} className="psl-naia-take">
              <div className="psl-section-label">{mod.label}</div>
              <p className="psl-body-text">{mod.body}</p>
            </div>
          );
          default: return null;
        }
      })}
    </>
  );
}

// ── Shell ──────────────────────────────────────────────────────────────────

export function ErrorBoundary() {
  return (
    <div className="psl-page">
      <link rel="stylesheet" href={FONTS} />
      <style>{css}</style>
      <header className="psl-header">
        <div className="psl-header-inner">
          <nav className="psl-sitenav-links" aria-label="Site navigation">
            {STOREFRONT_NAV.map((l) => (
              <a key={l.path} href={`${STOREFRONT_ORIGIN}${l.path}`} className="psl-sitenav-link">{l.label}</a>
            ))}
            <Link to="/trends" className="psl-sitenav-link active">TREND REPORTS</Link>
          </nav>
          <a href={`${STOREFRONT_ORIGIN}/`} className="psl-header-logo">NADINE</a>
          <div className="psl-header-right">
            <Link to="/trends/my-edits" className="psl-personal-link">My Trend Edits ↗</Link>
          </div>
        </div>
      </header>
      <div className="psl-body">
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

  const reportIndex = trendReports.filter((r) => r.published).findIndex((r) => r.slug === report.slug);
  const tint = TINTS[Math.max(0, reportIndex) % TINTS.length];
  const num = String(Math.max(0, reportIndex)).padStart(2, "0");

  return (
    <div className="psl-page" data-lens={lens}>
      <link rel="stylesheet" href={FONTS} />
      <style>{css}</style>

      {/* NADINE header — identical to public trend report */}
      <header className="psl-header">
        <div className="psl-header-inner">
          <nav className="psl-sitenav-links" aria-label="Site navigation">
            {STOREFRONT_NAV.map((l) => (
              <a key={l.path} href={`${STOREFRONT_ORIGIN}${l.path}`} className="psl-sitenav-link">{l.label}</a>
            ))}
            <Link to="/trends" className="psl-sitenav-link active">TREND REPORTS</Link>
          </nav>
          <a href={`${STOREFRONT_ORIGIN}/`} className="psl-header-logo">NADINE</a>
          <div className="psl-header-right">
            <Link to={`/trends/my-edits/${report.slug}`} className="psl-personal-link">My Trend Edits ↗</Link>
          </div>
        </div>
      </header>

      {/* Hero — same tint, same report title, same composition as public report */}
      <section className="psl-hero" style={{ background: tint }}>
        <span className="psl-hero-num" aria-hidden="true">{num}</span>
        <div className="psl-hero-inner">
          <Link to={`/trends/${report.slug}`} className="psl-back">← Full Report</Link>
          <div className="psl-kicker">
            {report.mood ? `${report.mood} · ` : ""}{report.season}
          </div>
          <h1 className="psl-hero-title">
            {report.title.split(" ").slice(0, -1).join(" ")}{" "}
            <em>{report.title.split(" ").slice(-1)[0]}</em>
          </h1>
          <p className="psl-hero-lede">{report.editorialIntro || report.summary}</p>
          <div className="psl-hero-meta">
            <span>{report.season}</span>
            {report.publishedAt && (
              <span>
                {new Date(report.publishedAt).toLocaleDateString("en-GB", { month: "long", year: "numeric" })}
              </span>
            )}
          </div>
        </div>
      </section>

      {/* Body — same container, lens heading then role-specific content */}
      <section className="psl-body">
        <div className="psl-section-label" style={{ marginBottom: "6px" }}>
          {LENS_ROLE_LABEL[lens]}
        </div>
        <div className="psl-lens-heading">{lensLabel}</div>
        <div className="psl-divider" />

        {lens === "designer"          && <DesignerLens modules={modules} />}
        {lens === "buyer"             && <BuyerLens    modules={modules} />}
        {lens === "marketer"          && <MarketerLens modules={modules} />}
        {lens === "creative-director" && <CDLens       modules={modules} />}
        {lens === "stylist"           && <StylistLens  modules={modules} />}
      </section>

      {/* Lens nav — same position as public report, selected lens active */}
      <div className="psl-lens">
        <div className="psl-lens-label">Read this through a lens</div>
        <p className="psl-lens-desc">
          One report, five professional perspectives. Each lens reads the same direction through a different set of decisions.
        </p>
        <div className="psl-lens-row">
          {LENS_ORDER.map((key) => (
            <Link
              key={key}
              to={`/trends/${report.slug}/lens/${key}`}
              className={`psl-lens-btn${lens === key ? " active" : ""}`}
            >
              {LENS_LABELS[key]}
            </Link>
          ))}
        </div>
        <div className="psl-my-edit-sep">
          <div className="psl-my-edit-sep-label">Make it personal</div>
          <Link to={`/trends/my-edits/${report.slug}`} className="psl-my-edit-btn">
            My Trend Edit →
          </Link>
        </div>
      </div>

      {/* CTA — same psl-cta visual, lens-specific copy */}
      <section className="psl-cta">
        <div className="psl-cta-inner">
          <div>
            <h2 className="psl-cta-title">
              this is the professional read.<br />
              <em>your wardrobe read is different.</em>
            </h2>
            <p className="psl-cta-body">
              My Trend Edit reads this direction against your Style DNA, Closet, previous outfit ratings, and actual wardrobe gaps — then shows the part of this trend that belongs to you.
            </p>
            <Link to={`/trends/my-edits/${report.slug}`} className="psl-cta-btn">
              open my trend edit →
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
