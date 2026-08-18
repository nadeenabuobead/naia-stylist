import { useState } from "react";
import { Link, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { trendReports, type TrendReportData } from "../lib/trend-reports";

const FONTS =
  "https://fonts.googleapis.com/css2?family=Oswald:wght@200;300;400&family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300;1,400&family=Space+Mono&display=swap";

const TINTS = ["#efeae0", "#e6dccb", "#d9c9b5", "#efe6d7", "#e2d3bf", "#ede2cf"];

const SITE_NAV = [
  { label: "HOME", to: "/" },
  { label: "THE HOUSE", to: "/about" },
  { label: "THE COLLECTION", to: "/naia-collection" },
  { label: "THE ART STORY", to: "/art-story" },
  { label: "nAia STYLIST", to: "/stylist" },
  { label: "TREND REPORTS", to: "/trends" },
];

const SOURCE_DATE_MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

function formatSourceDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return `${day} ${SOURCE_DATE_MONTHS[month - 1]} ${year}`;
}

export async function loader({ params }: LoaderFunctionArgs) {
  const report = trendReports.find((r) => r.slug === params.slug && r.published);
  if (!report) throw new Response("Not Found", { status: 404 });
  return { report };
}

export function meta({ data }: { data?: { report: TrendReportData } }) {
  if (!data?.report) return [{ title: "Report Not Found | nAia Trend Reports" }];
  return [
    { title: `${data.report.title} | nAia Trend Reports` },
    { name: "description", content: data.report.summary },
  ];
}

const css = `
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

  /* ── NADINE public navigation ───────────────────────────────────── */
  .psl-header { border-bottom: 1px solid rgba(26,17,9,0.08); }
  .psl-header-inner {
    max-width: 100rem;
    margin: 0 auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 18px 40px;
    gap: 32px;
  }
  @media (max-width: 639px) { .psl-header-inner { padding: 16px 24px; } }
  .psl-sitenav-links {
    display: none;
    align-items: center;
    gap: 20px;
    flex: 1;
  }
  @media (min-width: 768px) { .psl-sitenav-links { display: flex; } }
  .psl-sitenav-link {
    font-family: 'Space Mono', monospace;
    font-size: 0.58rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: rgba(26,17,9,0.55);
    text-decoration: none;
    transition: color 0.2s;
    white-space: nowrap;
  }
  .psl-sitenav-link:hover { color: #7a1e28; }
  .psl-sitenav-link.active { color: #7a1e28; }
  .psl-header-logo {
    font-family: 'Oswald', sans-serif;
    font-size: 0.875rem;
    font-weight: 200;
    letter-spacing: 0.4em;
    text-transform: uppercase;
    color: #1a1109;
    text-decoration: none;
    white-space: nowrap;
  }
  .psl-header-right {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 16px;
    flex: 1;
  }
  .psl-personal-link {
    font-family: 'Space Mono', monospace;
    font-size: 0.58rem;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: #7a1e28;
    text-decoration: none;
    transition: opacity 0.2s;
    white-space: nowrap;
  }
  .psl-personal-link:hover { opacity: 0.75; }
  .psl-action-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 16px;
    border: 1px solid rgba(26,17,9,0.18);
    font-family: 'Space Mono', monospace;
    font-size: 0.58rem;
    letter-spacing: 0.24em;
    text-transform: uppercase;
    color: #1a1109;
    background: transparent;
    cursor: pointer;
    text-decoration: none;
    transition: border-color 0.2s, color 0.2s;
  }
  .psl-action-btn:hover { border-color: #7a1e28; color: #7a1e28; }
  .psl-action-btn.active { color: #7a1e28; border-color: #7a1e28; }

  /* ── Hero ───────────────────────────────────────────────────── */
  .psl-hero {
    position: relative;
    overflow: hidden;
  }
  .psl-hero-num {
    position: absolute;
    right: -24px;
    top: -64px;
    font-family: 'Oswald', sans-serif;
    font-size: clamp(16rem, 22vw, 22rem);
    font-weight: 200;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    line-height: 1;
    color: rgba(26,17,9,0.05);
    pointer-events: none;
    user-select: none;
  }
  .psl-hero-inner {
    position: relative;
    max-width: 80rem;
    margin: 0 auto;
    padding: 64px 40px 80px;
  }
  @media (min-width: 640px) { .psl-hero-inner { padding: 96px 40px 112px; } }
  .psl-back {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-family: 'Space Mono', monospace;
    font-size: 0.6rem;
    letter-spacing: 0.3em;
    text-transform: uppercase;
    color: rgba(26,17,9,0.6);
    text-decoration: none;
    margin-bottom: 40px;
    transition: color 0.2s;
  }
  .psl-back:hover { color: #7a1e28; }
  .psl-kicker {
    font-family: 'Space Mono', monospace;
    font-size: 0.6rem;
    letter-spacing: 0.34em;
    text-transform: uppercase;
    color: rgba(26,17,9,0.55);
    margin-bottom: 24px;
  }
  .psl-hero-title {
    font-family: 'Oswald', sans-serif;
    font-size: clamp(3rem, 7vw, 7rem);
    font-weight: 200;
    line-height: 0.9;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    margin: 0 0 32px;
    color: #1a1109;
  }
  .psl-hero-title em {
    font-family: 'Cormorant Garamond', serif;
    font-style: italic;
    font-weight: 300;
    text-transform: none;
    color: #7a1e28;
  }
  .psl-hero-lede {
    font-family: 'Cormorant Garamond', serif;
    font-size: 1.2rem;
    line-height: 1.75;
    color: rgba(26,17,9,0.75);
    max-width: 48rem;
    margin-bottom: 32px;
  }
  .psl-hero-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 24px;
    font-family: 'Space Mono', monospace;
    font-size: 0.6rem;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    color: rgba(26,17,9,0.45);
  }

  /* ── Body ───────────────────────────────────────────────────── */
  .psl-body {
    max-width: 48rem;
    margin: 0 auto;
    padding: 80px 40px;
  }
  @media (min-width: 640px) { .psl-body { padding: 112px 40px; } }

  .psl-section { margin-bottom: 56px; }
  .psl-section-label {
    font-family: 'Space Mono', monospace;
    font-size: 0.6rem;
    letter-spacing: 0.34em;
    text-transform: uppercase;
    color: #7a1e28;
    margin-bottom: 20px;
  }
  .psl-body-text {
    font-family: 'Cormorant Garamond', serif;
    font-size: 1.1rem;
    line-height: 1.85;
    color: rgba(26,17,9,0.85);
  }
  .psl-divider {
    height: 1px;
    background: rgba(26,17,9,0.1);
    margin: 48px 0;
  }

  /* Key directions — numbered */
  .psl-directions { margin-bottom: 56px; }
  .psl-direction { margin-bottom: 48px; }
  .psl-direction-label {
    font-family: 'Space Mono', monospace;
    font-size: 0.6rem;
    letter-spacing: 0.34em;
    text-transform: uppercase;
    color: #7a1e28;
    margin-bottom: 20px;
  }
  .psl-direction-name {
    font-family: 'Oswald', sans-serif;
    font-size: 1.3rem;
    font-weight: 300;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: #1a1109;
    margin-bottom: 14px;
  }

  /* Rising / Fading — dash lists */
  .psl-two-col {
    display: grid;
    gap: 40px;
    margin-bottom: 56px;
  }
  @media (min-width: 640px) { .psl-two-col { grid-template-columns: 1fr 1fr; } }
  .psl-dash-list { list-style: none; margin: 0; padding: 0; }
  .psl-dash-list li {
    font-family: 'Cormorant Garamond', serif;
    font-style: italic;
    font-size: 1.05rem;
    line-height: 1.7;
    color: rgba(26,17,9,0.80);
    padding: 6px 0;
  }
  .psl-dash-list li::before { content: '— '; }
  .psl-dash-list.muted li { color: rgba(26,17,9,0.52); }
  .psl-signal-li { padding: 10px 0 14px; border-bottom: 1px solid rgba(26,17,9,0.06); }
  .psl-signal-li:last-child { border-bottom: none; }
  .psl-signal-why {
    display: block;
    font-style: normal;
    font-family: 'Cormorant Garamond', serif;
    font-size: 0.9rem;
    line-height: 1.6;
    color: rgba(26,17,9,0.64);
    padding-left: 1.4em;
    margin-top: 5px;
  }
  .psl-signal-source {
    display: block;
    font-style: normal;
    font-family: sans-serif;
    font-size: 0.68rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: rgba(26,17,9,0.36);
    padding-left: 1.4em;
    margin-top: 4px;
  }
  .psl-dash-list.muted .psl-signal-why { color: rgba(26,17,9,0.42); }
  .psl-dash-list.muted .psl-signal-source { color: rgba(26,17,9,0.26); }

  /* References */
  .psl-ref-card {
    padding: 20px 0;
    border-bottom: 1px solid rgba(26,17,9,0.08);
  }
  .psl-ref-brand {
    font-family: 'Oswald', sans-serif;
    font-size: 1rem;
    font-weight: 300;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #1a1109;
    margin-bottom: 10px;
  }
  .psl-ref-signal {
    font-family: 'Cormorant Garamond', serif;
    font-size: 1rem;
    line-height: 1.7;
    color: rgba(26,17,9,0.80);
    margin-bottom: 10px;
  }
  .psl-ref-naia-label {
    font-family: 'Space Mono', monospace;
    font-size: 0.5rem;
    letter-spacing: 0.24em;
    text-transform: uppercase;
    color: rgba(26,17,9,0.40);
    margin-bottom: 6px;
  }
  .psl-ref-naia {
    font-family: 'Cormorant Garamond', serif;
    font-style: italic;
    font-size: 0.95rem;
    line-height: 1.65;
    color: rgba(26,17,9,0.60);
  }

  /* Spend / Save / Own */
  .psl-sss-row {
    padding: 20px 0;
    border-bottom: 1px solid rgba(26,17,9,0.08);
  }
  .psl-sss-row:first-child { border-top: 1px solid rgba(26,17,9,0.08); }

  /* nAia callout box */
  .psl-naia-box {
    padding: 28px 32px;
    border-left: 3px solid #7a1e28;
    background: rgba(122,30,40,0.04);
    margin-bottom: 56px;
  }

  /* How to wear */
  .psl-how-row {
    display: grid;
    grid-template-columns: 140px 1fr;
    gap: 20px;
    padding: 16px 0;
    border-bottom: 1px solid rgba(26,17,9,0.07);
  }
  .psl-how-feeling {
    font-family: 'Space Mono', monospace;
    font-size: 0.58rem;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: #7a1e28;
    padding-top: 2px;
  }

  /* Sources */
  .psl-source {
    padding: 14px 0;
    border-bottom: 1px solid rgba(26,17,9,0.07);
  }
  .psl-source-publisher {
    font-family: 'Space Mono', monospace;
    font-size: 0.55rem;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: #7a1e28;
    margin-bottom: 4px;
  }
  .psl-source-descriptor {
    font-family: 'Cormorant Garamond', serif;
    font-style: italic;
    font-size: 0.9rem;
    color: rgba(26,17,9,0.55);
    margin-bottom: 4px;
  }
  .psl-source-title a {
    font-family: 'Cormorant Garamond', serif;
    font-size: 1rem;
    color: #1a1109;
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .psl-source-date {
    font-family: 'Space Mono', monospace;
    font-size: 0.55rem;
    color: rgba(26,17,9,0.40);
    margin-top: 4px;
  }

  /* ── Lens nav ───────────────────────────────────────────────── */
  .psl-lens {
    max-width: 48rem;
    margin: 0 auto 0;
    padding: 0 40px 40px;
  }
  .psl-lens-label {
    font-family: 'Space Mono', monospace;
    font-size: 0.58rem;
    letter-spacing: 0.3em;
    text-transform: uppercase;
    color: rgba(26,17,9,0.45);
    margin-bottom: 14px;
  }
  .psl-lens-desc {
    font-family: 'Cormorant Garamond', serif;
    font-style: italic;
    font-size: 1rem;
    color: rgba(26,17,9,0.60);
    line-height: 1.65;
    margin-bottom: 20px;
  }
  .psl-lens-row { display: flex; flex-wrap: wrap; gap: 8px; }
  .psl-lens-btn {
    display: inline-block;
    padding: 10px 20px;
    font-family: 'Space Mono', monospace;
    font-size: 0.58rem;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    text-decoration: none;
    border: 1px solid rgba(26,17,9,0.18);
    color: #1a1109;
    transition: border-color 0.15s, color 0.15s;
  }
  .psl-lens-btn:hover { border-color: #7a1e28; color: #7a1e28; }
  /* nAia Take callout */
  .psl-naia-take {
    padding: 28px 32px;
    border-left: 3px solid #7a1e28;
    background: rgba(122,30,40,0.04);
    margin-bottom: 48px;
  }
  .psl-naia-take-label {
    font-family: 'Space Mono', monospace;
    font-size: 0.58rem;
    letter-spacing: 0.34em;
    text-transform: uppercase;
    color: #7a1e28;
    margin-bottom: 16px;
  }
  .psl-naia-take-body {
    font-family: 'Cormorant Garamond', serif;
    font-size: 1.15rem;
    line-height: 1.85;
    color: rgba(26,17,9,0.9);
    font-style: italic;
  }
  /* My Edit — separated from professional lenses */
  .psl-my-edit-sep {
    margin-top: 28px;
    padding-top: 20px;
    border-top: 1px solid rgba(26,17,9,0.08);
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
  }
  .psl-my-edit-sep-label {
    font-family: 'Space Mono', monospace;
    font-size: 0.52rem;
    letter-spacing: 0.3em;
    text-transform: uppercase;
    color: rgba(26,17,9,0.40);
  }
  .psl-my-edit-btn {
    display: inline-block;
    padding: 12px 24px;
    font-family: 'Space Mono', monospace;
    font-size: 0.58rem;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    text-decoration: none;
    border: 1px solid rgba(122,30,40,0.35);
    color: rgba(26,17,9,0.75);
    transition: background 0.15s, color 0.15s, border-color 0.15s;
  }
  .psl-my-edit-btn:hover { background: #7a1e28; color: #f5f0e8; border-color: #7a1e28; }

  /* ── Personal CTA dark ──────────────────────────────────────── */
  .psl-cta {
    background: #2a1e17;
    color: #f0ebe2;
  }
  .psl-cta-inner {
    max-width: 80rem;
    margin: 0 auto;
    padding: 80px 40px;
    display: grid;
    gap: 40px;
  }
  @media (min-width: 640px) { .psl-cta-inner { padding: 96px 40px; } }
  @media (min-width: 1024px) { .psl-cta-inner { grid-template-columns: 1.1fr 1fr; align-items: flex-end; } }
  .psl-cta-title {
    font-family: 'Oswald', sans-serif;
    font-size: clamp(2.4rem, 5vw, 4.5rem);
    font-weight: 200;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    line-height: 0.95;
    margin: 0 0 32px;
  }
  .psl-cta-title em {
    font-family: 'Cormorant Garamond', serif;
    font-style: italic;
    font-weight: 300;
    text-transform: none;
    color: #e8c9a8;
  }
  .psl-cta-body {
    font-family: 'Cormorant Garamond', serif;
    font-size: 1.05rem;
    line-height: 1.75;
    color: rgba(240,235,226,0.75);
    max-width: 36rem;
    margin-bottom: 32px;
  }
  .psl-cta-btn {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    border: 1px solid rgba(240,235,226,0.8);
    border-radius: 9999px;
    padding: 12px 24px;
    font-family: 'Space Mono', monospace;
    font-size: 0.65rem;
    letter-spacing: 0.3em;
    text-transform: uppercase;
    color: #f0ebe2;
    text-decoration: none;
    transition: background 0.2s, color 0.2s;
  }
  .psl-cta-btn:hover { background: #f0ebe2; color: #1a1109; }

  /* ── More reports ───────────────────────────────────────────── */
  .psl-more {
    max-width: 100rem;
    margin: 0 auto;
    padding: 80px 40px;
  }
  .psl-more-header {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    border-bottom: 1px solid rgba(26,17,9,0.12);
    padding-bottom: 24px;
    margin-bottom: 40px;
  }
  .psl-more-title {
    font-family: 'Oswald', sans-serif;
    font-size: clamp(1.8rem, 3vw, 3rem);
    font-weight: 200;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    color: #1a1109;
    margin: 0;
  }
  .psl-more-title em {
    font-family: 'Cormorant Garamond', serif;
    font-style: italic;
    font-weight: 300;
    text-transform: none;
    color: #7a1e28;
  }
  .psl-more-link {
    font-family: 'Space Mono', monospace;
    font-size: 0.6rem;
    letter-spacing: 0.3em;
    text-transform: uppercase;
    color: rgba(26,17,9,0.55);
    text-decoration: none;
    transition: color 0.2s;
  }
  .psl-more-link:hover { color: #7a1e28; }
  .psl-more-grid {
    display: grid;
    gap: 20px;
  }
  @media (min-width: 640px) { .psl-more-grid { grid-template-columns: repeat(2, 1fr); } }
  @media (min-width: 1024px) { .psl-more-grid { grid-template-columns: repeat(3, 1fr); } }

  /* Shared card styles (same as pub-card) */
  .psl-card {
    position: relative;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    overflow: hidden;
    padding: 24px;
    text-decoration: none;
    color: inherit;
    transition: transform 0.5s ease;
    aspect-ratio: 4 / 5;
  }
  .psl-card:hover { transform: translateY(-4px); }
  .psl-card-num {
    position: absolute;
    right: -16px;
    top: -32px;
    font-family: 'Oswald', sans-serif;
    font-size: clamp(10rem, 12vw, 12rem);
    font-weight: 200;
    line-height: 1;
    color: rgba(26,17,9,0.06);
    pointer-events: none;
    user-select: none;
  }
  .psl-card-cat {
    position: relative;
    z-index: 1;
    font-family: 'Space Mono', monospace;
    font-size: 0.55rem;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    color: rgba(26,17,9,0.6);
  }
  .psl-card-bottom { position: relative; z-index: 1; }
  .psl-card-title {
    font-family: 'Oswald', sans-serif;
    font-size: clamp(1.6rem, 2.8vw, 2rem);
    font-weight: 200;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    line-height: 1.1;
    color: #1a1109;
    margin-bottom: 24px;
    transition: color 0.3s;
  }
  .psl-card:hover .psl-card-title { color: #7a1e28; }
  .psl-card-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-family: 'Space Mono', monospace;
    font-size: 0.6rem;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    color: rgba(26,17,9,0.45);
  }
  .psl-card-arrow { transition: color 0.3s; }
  .psl-card:hover .psl-card-arrow { color: #7a1e28; }

  /* ── Error ──────────────────────────────────────────────────── */
  .psl-error {
    max-width: 40rem;
    margin: 0 auto;
    padding: 128px 40px;
    text-align: center;
  }
  .psl-error-title {
    font-family: 'Oswald', sans-serif;
    font-size: 3rem;
    font-weight: 200;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    line-height: 0.9;
    color: #1a1109;
    margin-bottom: 32px;
  }
  .psl-error-title em {
    font-family: 'Cormorant Garamond', serif;
    font-style: italic;
    text-transform: none;
    color: #7a1e28;
  }

  @media print {
    .psl-header, .psl-hero-num, .psl-cta, .psl-more, .psl-lens, .psl-my-edit-sep,
    .psl-action-btn { display: none !important; }
    .psl-body { padding: 0 !important; max-width: 100% !important; }
  }
`;

export function ErrorBoundary() {
  return (
    <div className="psl-page">
      <link rel="stylesheet" href={FONTS} />
      <style>{css}</style>
      <header className="psl-header">
        <div className="psl-header-inner">
          <nav className="psl-sitenav-links" aria-label="Site navigation">
            {SITE_NAV.map((l) => (
              <Link key={l.to} to={l.to} className={`psl-sitenav-link${l.to === "/trends" ? " active" : ""}`}>
                {l.label}
              </Link>
            ))}
          </nav>
          <Link to="/" className="psl-header-logo">NADINE</Link>
          <div className="psl-header-right">
            <Link to="/trends/my-edits" className="psl-personal-link">My Trend Edits ↗</Link>
          </div>
        </div>
      </header>
      <div className="psl-error">
        <div className="psl-kicker">404</div>
        <h1 className="psl-error-title">
          report<br />
          <em>not found.</em>
        </h1>
        <Link to="/trends" className="psl-lens-btn" style={{ display: "inline-block", marginTop: "32px" }}>
          ← back to trend reports
        </Link>
      </div>
    </div>
  );
}

export default function TrendReportDetail() {
  const { report } = useLoaderData() as { report: TrendReportData };
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle");

  const reportIndex = trendReports.filter((r) => r.published).findIndex((r) => r.slug === report.slug);
  const tint = TINTS[Math.max(0, reportIndex) % TINTS.length];
  const num = String(Math.max(0, reportIndex)).padStart(2, "0");

  const otherReports = trendReports
    .filter((r) => r.published && r.slug !== report.slug)
    .slice(0, 3);

  const copyLink = async () => {
    if (typeof window === "undefined") return;
    const url = window.location.href;
    const fallbackCopy = () => {
      try {
        const textarea = document.createElement("textarea");
        textarea.value = url;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(textarea);
        return ok;
      } catch { return false; }
    };
    let ok = false;
    if (navigator.clipboard && window.isSecureContext) {
      try { await navigator.clipboard.writeText(url); ok = true; } catch { ok = fallbackCopy(); }
    } else { ok = fallbackCopy(); }
    setCopyStatus(ok ? "copied" : "error");
    window.setTimeout(() => setCopyStatus("idle"), 2500);
  };

  const downloadPdf = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { jsPDF } = (window as any).jspdf;
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pageW = doc.internal.pageSize.getWidth();
    const margin = 20;
    const maxW = pageW - margin * 2;
    let y = 20;
    const addText = (text: string, size: number, style: string, color: number[], spaceAfter?: number) => {
      doc.setFontSize(size);
      doc.setFont("helvetica", style || "normal");
      doc.setTextColor(...(color as [number, number, number]));
      const lines = doc.splitTextToSize(String(text || ""), maxW);
      lines.forEach((line: string) => {
        if (y > 270) { doc.addPage(); y = 20; }
        doc.text(line, margin, y);
        y += size * 0.45;
      });
      y += spaceAfter || 4;
    };
    doc.setFontSize(24); doc.setFont("helvetica", "bolditalic"); doc.setTextColor(34, 21, 22);
    doc.text("nAia", margin, y); y += 8;
    doc.setFontSize(8); doc.setFont("helvetica", "normal"); doc.setTextColor(139, 32, 53);
    doc.text("TREND INTELLIGENCE · " + report.season.toUpperCase(), margin, y); y += 6;
    if (report.mood) { doc.setFontSize(9); doc.setFont("helvetica", "italic"); doc.setTextColor(122, 111, 106); doc.text(report.mood, margin, y); y += 8; } else { y += 4; }
    doc.setDrawColor(34, 21, 22); doc.line(margin, y, pageW - margin, y); y += 10;
    addText(report.title, 20, "bold", [34, 21, 22], 6);
    addText(report.editorialIntro, 11, "italic", [122, 111, 106], 10);
    addText("KEY DIRECTIONS", 8, "bold", [139, 32, 53], 4);
    (report.keyTrends || []).forEach((t, i) => { addText(`${i + 1}. ${t.name}`, 12, "bold", [34, 21, 22], 2); addText(t.description, 10, "normal", [34, 21, 22], 6); });
    if (report.rising?.length) { addText("WHAT'S RISING", 8, "bold", [139, 32, 53], 3); addText(report.rising.map((r) => r.signal).join("  ·  "), 10, "normal", [34, 21, 22], 8); }
    if (report.fading?.length) { addText("WHAT'S FADING", 8, "bold", [139, 32, 53], 3); addText(report.fading.map((f) => f.signal).join("  ·  "), 10, "normal", [122, 111, 106], 8); }
    if (report.referencesBehindThisEdit?.length) {
      addText("REFERENCES BEHIND THIS EDIT", 8, "bold", [139, 32, 53], 4);
      report.referencesBehindThisEdit.forEach((ref) => { addText(ref.collection ? `${ref.brand} — ${ref.collection}` : ref.brand, 11, "bold", [34, 21, 22], 2); addText(ref.signal, 10, "italic", [34, 21, 22], 2); addText("nAia: " + ref.naiaRead, 9, "normal", [122, 111, 106], 6); });
      y += 4;
    }
    if (report.spendSaveSkip) {
      addText("INVESTMENT NOTES", 8, "bold", [139, 32, 53], 4);
      addText("Spend", 9, "bold", [139, 32, 53], 2); addText(report.spendSaveSkip.spend, 10, "normal", [34, 21, 22], 4);
      addText("Hold Off On", 9, "bold", [139, 32, 53], 2); addText(report.spendSaveSkip.save, 10, "normal", [34, 21, 22], 4);
      addText("Already Own It?", 9, "bold", [139, 32, 53], 2); addText(report.spendSaveSkip.alreadyOwn, 10, "normal", [34, 21, 22], 8);
    } else if (report.investmentNotes) { addText("INVESTMENT NOTES", 8, "bold", [139, 32, 53], 3); addText(report.investmentNotes, 10, "normal", [34, 21, 22], 8); }
    if (report.naiaInterpretation) {
      const boxPad = 8; const boxTextW = maxW - boxPad * 2;
      doc.setFontSize(8); doc.setFont("helvetica", "bold");
      const lLines = doc.splitTextToSize("NAIA INTERPRETATION", boxTextW);
      doc.setFontSize(11); doc.setFont("helvetica", "italic");
      const bLines = doc.splitTextToSize(String(report.naiaInterpretation), boxTextW);
      const lH = lLines.length * 8 * 0.45 + 3; const bH = bLines.length * 11 * 0.45;
      const boxH = lH + bH + boxPad * 2;
      if (y + boxH > 280) { doc.addPage(); y = 20; }
      doc.setFillColor(250, 245, 242); doc.rect(margin - 2, y - 2, maxW + 4, boxH, "F");
      doc.setDrawColor(139, 32, 53); doc.setLineWidth(0.8); doc.line(margin, y - 2, margin, y - 2 + boxH); doc.setLineWidth(0.2);
      let tY = y + boxPad;
      doc.setFontSize(8); doc.setFont("helvetica", "bold"); doc.setTextColor(139, 32, 53);
      lLines.forEach((l: string) => { doc.text(l, margin + boxPad, tY); tY += 8 * 0.45; }); tY += 3;
      doc.setFontSize(11); doc.setFont("helvetica", "italic"); doc.setTextColor(34, 21, 22);
      bLines.forEach((l: string) => { doc.text(l, margin + boxPad, tY); tY += 11 * 0.45; });
      y += boxH + 8;
    }
    if (report.naiaVerdict) { addText("NAIA VERDICT", 8, "bold", [139, 32, 53], 3); addText(report.naiaVerdict, 10, "normal", [34, 21, 22], 8); }
    if (report.howToWear?.length) { addText("HOW IT TRANSLATES", 8, "bold", [139, 32, 53], 4); report.howToWear.forEach((h) => { addText(`${h.feeling}: ${h.direction}`, 10, "normal", [34, 21, 22], 4); }); y += 4; }
    if (report.wardrobeNote) { addText("WHAT THIS MEANS FOR YOUR WARDROBE", 8, "bold", [139, 32, 53], 3); addText(report.wardrobeNote, 10, "normal", [34, 21, 22], 8); }
    if (report.sources?.length) {
      addText("SOURCES", 8, "bold", [139, 32, 53], 4);
      report.sources.forEach((s) => { addText(`${s.publisher} — ${s.title}${s.publishedAt ? ` (${formatSourceDate(s.publishedAt)})` : ""}`, 10, "normal", [34, 21, 22], 6); });
      const reportUrl = typeof window !== "undefined" ? window.location.href : "";
      addText(`Full source links: ${reportUrl}`, 9, "italic", [122, 111, 106], 8);
    }
    doc.setFontSize(7); doc.setFont("helvetica", "normal"); doc.setTextColor(122, 111, 106);
    doc.text("nAia Trend Reports · The nAia edit", margin, 285);
    doc.save(report.title.replace(/[^a-z0-9]/gi, "-").toLowerCase() + ".pdf");
  };

  return (
    <div className="psl-page">
      <link rel="stylesheet" href={FONTS} />
      <style>{css}</style>

      {/* NADINE site header */}
      <header className="psl-header">
        <div className="psl-header-inner">
          <nav className="psl-sitenav-links" aria-label="Site navigation">
            {SITE_NAV.map((l) => (
              <Link key={l.to} to={l.to} className={`psl-sitenav-link${l.to === "/trends" ? " active" : ""}`}>
                {l.label}
              </Link>
            ))}
          </nav>
          <Link to="/" className="psl-header-logo">NADINE</Link>
          <div className="psl-header-right">
            <button className={`psl-action-btn${copyStatus === "copied" ? " active" : ""}`} onClick={copyLink}>
              {copyStatus === "copied" ? "Copied ✓" : copyStatus === "error" ? "Failed" : "Copy link"}
            </button>
            <button className="psl-action-btn" onClick={downloadPdf}>Download PDF</button>
            <Link to="/trends/my-edits" className="psl-personal-link">My Trend Edits ↗</Link>
          </div>
        </div>
      </header>

      {/* Hero with tinted background */}
      <section className="psl-hero" style={{ background: tint }}>
        <span className="psl-hero-num" aria-hidden="true">{num}</span>
        <div className="psl-hero-inner">
          <Link to="/trends" className="psl-back">← Trend Reports</Link>
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
            <span>{new Date(report.publishedAt).toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</span>
          </div>
        </div>
      </section>

      {/* Body */}
      <section id="report" className="psl-body" style={{ scrollMarginTop: "40px" }}>

        {/* Key directions */}
        {report.keyTrends?.length > 0 && (
          <div className="psl-directions">
            <div className="psl-section-label">Key Directions</div>
            {report.keyTrends.map((t, i) => (
              <div key={i} className="psl-direction">
                <div className="psl-direction-label">
                  {String(i + 1).padStart(2, "0")} / {t.name}
                </div>
                <p className="psl-body-text">{t.description}</p>
              </div>
            ))}
          </div>
        )}

        {/* Rising / Fading */}
        {((report.rising?.length ?? 0) > 0 || (report.fading?.length ?? 0) > 0) && (
          <>
            <div className="psl-divider" />
            <div className="psl-two-col" style={{ marginBottom: "56px" }}>
              {report.rising?.length ? (
                <div>
                  <div className="psl-section-label">What&rsquo;s Rising</div>
                  <ul className="psl-dash-list">
                    {report.rising.map((r, i) => (
                      <li key={i} className="psl-signal-li">
                        {r.signal}
                        <span className="psl-signal-why">{r.why}</span>
                        <span className="psl-signal-source">{r.source}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {report.fading?.length ? (
                <div>
                  <div className="psl-section-label">What&rsquo;s Fading</div>
                  <ul className="psl-dash-list muted">
                    {report.fading.map((f, i) => (
                      <li key={i} className="psl-signal-li">
                        {f.signal}
                        <span className="psl-signal-why">{f.why}</span>
                        <span className="psl-signal-source">{f.source}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </>
        )}

        {/* References */}
        {(report.referencesBehindThisEdit?.length || report.brandsToWatch?.length) ? (
          <div className="psl-section">
            <div className="psl-section-label">References Behind This Edit</div>
            {report.referencesBehindThisEdit
              ? report.referencesBehindThisEdit.map((ref, i) => (
                  <div key={i} className="psl-ref-card">
                    <div className="psl-ref-brand">
                      {ref.collection ? `${ref.brand} — ${ref.collection}` : ref.brand}
                    </div>
                    <p className="psl-ref-signal">{ref.signal}</p>
                    <div className="psl-ref-naia-label">nAia</div>
                    <p className="psl-ref-naia">{ref.naiaRead}</p>
                  </div>
                ))
              : report.brandsToWatch?.map((b, i) => (
                  <div key={i} className="psl-ref-card">
                    <div className="psl-ref-brand">{b.name}</div>
                    <p className="psl-ref-signal">{b.why}</p>
                  </div>
                ))}
          </div>
        ) : null}

        {/* nAia Take */}
        {report.naiaTake && (
          <>
            <div className="psl-divider" />
            <div className="psl-naia-take">
              <div className="psl-naia-take-label">nAia Take</div>
              <p className="psl-naia-take-body">{report.naiaTake}</p>
            </div>
          </>
        )}

        {/* Investment Notes */}
        {(report.spendSaveSkip || report.investmentNotes) && (
          <>
            <div className="psl-divider" />
            <div className="psl-section">
              <div className="psl-section-label">Investment Notes</div>
              {report.spendSaveSkip ? (
                <>
                  <div className="psl-sss-row">
                    <div className="psl-section-label" style={{ marginBottom: "10px" }}>Spend</div>
                    <p className="psl-body-text">{report.spendSaveSkip.spend}</p>
                  </div>
                  <div className="psl-sss-row">
                    <div className="psl-section-label" style={{ marginBottom: "10px" }}>Hold Off On</div>
                    <p className="psl-body-text">{report.spendSaveSkip.save}</p>
                  </div>
                  <div className="psl-sss-row" style={{ borderBottom: "none" }}>
                    <div className="psl-section-label" style={{ marginBottom: "10px" }}>Already Own It?</div>
                    <p className="psl-body-text">{report.spendSaveSkip.alreadyOwn}</p>
                  </div>
                </>
              ) : (
                <p className="psl-body-text">{report.investmentNotes}</p>
              )}
            </div>
          </>
        )}

        {/* How It Translates */}
        {report.howToWear?.length ? (
          <>
            <div className="psl-divider" />
            <div className="psl-section">
              <div className="psl-section-label">How It Translates</div>
              {report.howToWear.map((h, i) => (
                <div key={i} className="psl-how-row">
                  <div className="psl-how-feeling">{h.feeling}</div>
                  <p className="psl-body-text" style={{ fontSize: "1rem" }}>{h.direction}</p>
                </div>
              ))}
            </div>
          </>
        ) : null}

        {/* Wardrobe Note */}
        {report.wardrobeNote && (
          <div className="psl-section" style={{ marginTop: "16px" }}>
            <div className="psl-section-label">What This Means for Your Wardrobe</div>
            <p className="psl-body-text">{report.wardrobeNote}</p>
          </div>
        )}

        {/* Sources */}
        {report.sources?.length > 0 && (
          <>
            <div className="psl-divider" />
            <div className="psl-section">
              <div className="psl-section-label">Sources</div>
              {report.sources.map((s, i) => (
                <div key={i} className="psl-source">
                  <div className="psl-source-publisher">{s.publisher}</div>
                  {s.descriptor && <div className="psl-source-descriptor">{s.descriptor}</div>}
                  <div className="psl-source-title">
                    <a href={s.url} target="_blank" rel="noreferrer">{s.title}</a>
                  </div>
                  {s.publishedAt && <div className="psl-source-date">{formatSourceDate(s.publishedAt)}</div>}
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      {/* Lens navigation */}
      <div className="psl-lens">
        <div className="psl-lens-label">Read this through a lens</div>
        <p className="psl-lens-desc">
          One report, five professional perspectives. Each lens reads the same direction through a different set of decisions.
        </p>
        <div className="psl-lens-row">
          <Link to={`/trends/${report.slug}/lens/designer`} className="psl-lens-btn">Designer</Link>
          <Link to={`/trends/${report.slug}/lens/buyer`} className="psl-lens-btn">Buyer</Link>
          <Link to={`/trends/${report.slug}/lens/marketer`} className="psl-lens-btn">Marketer</Link>
          <Link to={`/trends/${report.slug}/lens/creative-director`} className="psl-lens-btn">Creative Director</Link>
          <Link to={`/trends/${report.slug}/lens/stylist`} className="psl-lens-btn">Stylist</Link>
        </div>
        <div className="psl-my-edit-sep">
          <div className="psl-my-edit-sep-label">Make it personal</div>
          <Link to={`/trends/my-edits/${report.slug}`} className="psl-my-edit-btn">
            My Trend Edit →
          </Link>
        </div>
      </div>

      {/* Personal CTA */}
      <section className="psl-cta">
        <div className="psl-cta-inner">
          <div>
            <h2 className="psl-cta-title">
              want this report<br />
              <em>tailored to you?</em>
            </h2>
            <p className="psl-cta-body">
              nAia reads this direction against your Style DNA, what you already own, how you&rsquo;ve rated past outfits, and where your wardrobe has gaps. What remains is the part of this trend that is actually yours to wear.
            </p>
            <Link to={`/trends/my-edits/${report.slug}`} className="psl-cta-btn">
              open my trend edit →
            </Link>
          </div>
        </div>
      </section>

      {/* More reports */}
      {otherReports.length > 0 && (
        <section className="psl-more">
          <div className="psl-more-header">
            <h3 className="psl-more-title">
              more <em>reports.</em>
            </h3>
            <Link to="/trends" className="psl-more-link">view all →</Link>
          </div>
          <div className="psl-more-grid">
            {otherReports.map((r, i) => {
              const rIndex = trendReports.filter((x) => x.published).findIndex((x) => x.slug === r.slug);
              const rTint = TINTS[Math.max(0, rIndex) % TINTS.length];
              const rNum = String(Math.max(0, rIndex)).padStart(2, "0");
              return (
                <Link
                  key={r.slug}
                  to={`/trends/${r.slug}`}
                  className="psl-card"
                  style={{ background: rTint }}
                >
                  <span className="psl-card-num" aria-hidden="true">{rNum}</span>
                  <div className="psl-card-cat">{r.season}</div>
                  <div className="psl-card-bottom">
                    <div className="psl-card-title">{r.title}</div>
                    <div className="psl-card-footer">
                      <span>{new Date(r.publishedAt).toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</span>
                      <span className="psl-card-arrow">↗</span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
