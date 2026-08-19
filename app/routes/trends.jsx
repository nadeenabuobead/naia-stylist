import { Link } from "react-router";
import { STOREFRONT_ORIGIN, STOREFRONT_NAV } from "../lib/storefront-config";
import { trendReports } from "../lib/trend-reports";

// Inline Lovable-matched Google Fonts — Oswald (thin-display), Cormorant Garamond (editorial), Space Mono (mono)
const FONTS =
  "https://fonts.googleapis.com/css2?family=Oswald:wght@200;300;400&family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300;1,400&family=Space+Mono&display=swap";

const TINTS = ["#efeae0", "#e6dccb", "#d9c9b5", "#efe6d7", "#e2d3bf", "#ede2cf"];

// Exact hex equivalents of Lovable oklch tokens
const C = {
  bg: "#f0ebe2",
  fg: "#1a1109",
  lip: "#7a1e28",
  dark: "#2a1e17",
  darkAccent: "#e8c9a8",
};

const css = `
  .pub-page {
    min-height: 100vh;
    background-color: ${C.bg};
    background-image:
      radial-gradient(circle at top right, rgba(122,30,40,0.06) 0, transparent 28%),
      linear-gradient(180deg, rgba(245,240,232,0.88) 0%, ${C.bg} 100%),
      url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.055 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>");
    color: ${C.fg};
    font-family: 'Cormorant Garamond', Garamond, serif;
    -webkit-font-smoothing: antialiased;
  }

  /* ── NADINE public navigation ───────────────────────────────────── */
  .pub-header { border-bottom: 1px solid rgba(26,17,9,0.08); }
  .pub-header-inner {
    max-width: 100rem;
    margin: 0 auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 18px 40px;
    gap: 32px;
  }
  @media (max-width: 639px) { .pub-header-inner { padding: 16px 24px; } }
  .pub-sitenav-links {
    display: none;
    align-items: center;
    gap: 20px;
    flex: 1;
  }
  @media (min-width: 768px) { .pub-sitenav-links { display: flex; } }
  .pub-sitenav-link {
    font-family: 'Space Mono', monospace;
    font-size: 0.58rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: rgba(26,17,9,0.55);
    text-decoration: none;
    transition: color 0.2s;
    white-space: nowrap;
  }
  .pub-sitenav-link:hover { color: ${C.lip}; }
  .pub-sitenav-link.active { color: ${C.lip}; }
  .pub-header-logo {
    font-family: 'Oswald', sans-serif;
    font-size: 0.875rem;
    font-weight: 200;
    letter-spacing: 0.4em;
    text-transform: uppercase;
    color: ${C.fg};
    text-decoration: none;
    white-space: nowrap;
  }
  .pub-header-right {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    flex: 1;
  }
  .pub-personal-link {
    font-family: 'Space Mono', monospace;
    font-size: 0.58rem;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: ${C.lip};
    text-decoration: none;
    transition: opacity 0.2s;
    white-space: nowrap;
  }
  .pub-personal-link:hover { opacity: 0.75; }

  /* ── Hero ───────────────────────────────────────────────────────── */
  .pub-hero {
    max-width: 100rem;
    margin: 0 auto;
    padding: 64px 40px 40px;
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: 24px;
  }
  @media (min-width: 640px) { .pub-hero { padding: 96px 40px 40px; } }
  .pub-hero-eyebrow {
    font-family: 'Space Mono', monospace;
    font-size: 0.65rem;
    letter-spacing: 0.34em;
    text-transform: uppercase;
    color: rgba(26,17,9,0.55);
    margin-bottom: 24px;
  }
  .pub-hero-title {
    font-family: 'Oswald', sans-serif;
    font-size: clamp(4rem, 9vw, 9rem);
    font-weight: 200;
    line-height: 0.88;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    color: ${C.fg};
    margin: 0;
  }
  .pub-hero-title em {
    font-family: 'Cormorant Garamond', serif;
    font-style: italic;
    font-weight: 300;
    text-transform: none;
    color: ${C.lip};
  }
  .pub-hero-right {
    max-width: 28rem;
  }
  .pub-hero-desc {
    font-family: 'Cormorant Garamond', serif;
    font-size: 1.15rem;
    font-style: italic;
    line-height: 1.75;
    color: rgba(26,17,9,0.75);
  }
  .pub-hero-sub {
    margin-top: 24px;
    font-family: 'Space Mono', monospace;
    font-size: 0.6rem;
    letter-spacing: 0.32em;
    text-transform: uppercase;
    color: rgba(26,17,9,0.45);
  }
  .pub-hero-sub span { color: ${C.lip}; }

  /* ── Featured card ──────────────────────────────────────────────── */
  .pub-featured {
    max-width: 100rem;
    margin: 0 auto;
    padding: 16px 40px 64px;
  }
  @media (min-width: 640px) { .pub-featured { padding: 16px 40px 80px; } }
  .pub-featured-card {
    position: relative;
    overflow: hidden;
    background: #efeae0;
  }
  .pub-featured-num {
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
    z-index: 0;
  }
  .pub-featured-inner {
    position: relative;
    z-index: 1;
    display: grid;
    gap: 40px;
    padding: 32px;
  }
  @media (min-width: 640px) { .pub-featured-inner { padding: 56px; } }
  @media (min-width: 1024px) { .pub-featured-inner { grid-template-columns: 1.1fr 1fr; gap: 64px; } }
  .pub-featured-kicker {
    font-family: 'Space Mono', monospace;
    font-size: 0.6rem;
    letter-spacing: 0.34em;
    text-transform: uppercase;
    color: rgba(26,17,9,0.55);
    margin-bottom: 24px;
  }
  .pub-featured-title {
    font-family: 'Oswald', sans-serif;
    font-size: clamp(3rem, 5vw, 5rem);
    font-weight: 200;
    line-height: 0.95;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    margin: 0 0 32px;
    color: ${C.fg};
  }
  .pub-featured-title em {
    font-family: 'Cormorant Garamond', serif;
    font-style: italic;
    font-weight: 300;
    text-transform: none;
    color: ${C.lip};
  }
  .pub-featured-lede {
    font-family: 'Cormorant Garamond', serif;
    font-size: 1.15rem;
    line-height: 1.75;
    color: rgba(26,17,9,0.75);
    max-width: 44rem;
    margin-bottom: 40px;
  }
  .pub-featured-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 16px;
    margin-bottom: 40px;
  }
  .pub-pill-btn {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    border: 1px solid rgba(26,17,9,0.8);
    border-radius: 9999px;
    padding: 12px 24px;
    font-family: 'Space Mono', monospace;
    font-size: 0.65rem;
    letter-spacing: 0.3em;
    text-transform: uppercase;
    color: ${C.fg};
    text-decoration: none;
    transition: background 0.2s, color 0.2s;
  }
  .pub-pill-btn:hover { background: ${C.fg}; color: ${C.bg}; }
  .pub-ghost-link {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 12px 8px;
    font-family: 'Space Mono', monospace;
    font-size: 0.65rem;
    letter-spacing: 0.3em;
    text-transform: uppercase;
    color: ${C.lip};
    text-decoration: none;
  }
  .pub-ghost-link span {
    border-bottom: 1px solid rgba(122,30,40,0.4);
    padding-bottom: 4px;
    transition: border-color 0.2s;
  }
  .pub-ghost-link:hover span { border-color: ${C.lip}; }
  .pub-featured-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 24px;
    font-family: 'Space Mono', monospace;
    font-size: 0.6rem;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    color: rgba(26,17,9,0.45);
  }
  .pub-featured-img {
    background: #d9c9b5;
    min-height: 22rem;
    position: relative;
  }
  .pub-featured-img-inner {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }
  .pub-featured-img-mood {
    font-family: 'Cormorant Garamond', serif;
    font-style: italic;
    font-weight: 300;
    font-size: clamp(3rem, 5.5vw, 5.5rem);
    color: rgba(26,17,9,0.10);
    text-align: center;
    line-height: 1.15;
    pointer-events: none;
    user-select: none;
    padding: 0 32px;
    letter-spacing: 0.01em;
  }
  .pub-featured-img-rule {
    width: 48px;
    height: 1px;
    background: rgba(26,17,9,0.12);
    margin: 18px 0;
  }
  .pub-featured-img-label {
    position: absolute;
    bottom: 28px;
    left: 28px;
    font-family: 'Space Mono', monospace;
    font-size: 0.52rem;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    color: rgba(26,17,9,0.3);
  }

  /* ── Card palette panel (Colour Direction) ─────────────────────── */
  .pub-card-palette-strip {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 46%;
    display: flex;
    z-index: 0;
    overflow: hidden;
  }
  .pub-card-palette-swatch {
    flex: 1;
  }

  /* ── Grid ───────────────────────────────────────────────────────── */
  .pub-grid-section {
    max-width: 100rem;
    margin: 0 auto;
    padding: 0 40px 64px;
  }
  @media (min-width: 640px) { .pub-grid-section { padding: 0 40px 80px; } }
  .pub-grid-label {
    border-bottom: 1px solid rgba(26,17,9,0.12);
    padding-bottom: 16px;
    margin-bottom: 20px;
    font-family: 'Space Mono', monospace;
    font-size: 0.65rem;
    letter-spacing: 0.3em;
    text-transform: uppercase;
    color: rgba(26,17,9,0.45);
  }
  .pub-grid {
    display: grid;
    gap: 20px;
  }
  @media (min-width: 640px) { .pub-grid { grid-template-columns: repeat(2, 1fr); } }
  @media (min-width: 1024px) { .pub-grid { grid-template-columns: repeat(3, 1fr); } }

  /* ── Card ───────────────────────────────────────────────────────── */
  .pub-card {
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
  .pub-card:hover { transform: translateY(-4px); }
  .pub-card-num {
    position: absolute;
    right: -16px;
    top: -32px;
    font-family: 'Oswald', sans-serif;
    font-size: clamp(10rem, 12vw, 12rem);
    font-weight: 200;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    line-height: 1;
    color: rgba(26,17,9,0.06);
    pointer-events: none;
    user-select: none;
    z-index: 0;
  }
  .pub-card-top {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    font-family: 'Space Mono', monospace;
    font-size: 0.55rem;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    color: rgba(26,17,9,0.6);
  }
  .pub-card-dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: ${C.lip};
    flex-shrink: 0;
  }
  .pub-card-bottom { position: relative; z-index: 1; }
  .pub-card-title {
    font-family: 'Oswald', sans-serif;
    font-size: clamp(1.6rem, 2.8vw, 2.2rem);
    font-weight: 200;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    line-height: 1.1;
    color: ${C.fg};
    margin-bottom: 16px;
    transition: color 0.3s;
  }
  .pub-card:hover .pub-card-title { color: ${C.lip}; }
  .pub-card-excerpt {
    font-family: 'Cormorant Garamond', serif;
    font-size: 0.95rem;
    font-style: italic;
    line-height: 1.65;
    color: rgba(26,17,9,0.70);
    margin-bottom: 24px;
  }
  .pub-card-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-family: 'Space Mono', monospace;
    font-size: 0.6rem;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    color: rgba(26,17,9,0.45);
  }
  .pub-card-arrow {
    font-size: 1rem;
    color: rgba(26,17,9,0.4);
    transition: color 0.3s, transform 0.3s;
  }
  .pub-card:hover .pub-card-arrow { color: ${C.lip}; transform: translate(2px, -2px); }

  /* ── Dark CTA ───────────────────────────────────────────────────── */
  .pub-cta {
    background: ${C.dark};
    color: ${C.bg};
  }
  .pub-cta-inner {
    max-width: 100rem;
    margin: 0 auto;
    padding: 80px 40px;
    display: grid;
    gap: 56px;
  }
  @media (min-width: 640px) { .pub-cta-inner { padding: 112px 40px; } }
  @media (min-width: 1024px) { .pub-cta-inner { grid-template-columns: 1.1fr 1fr; gap: 80px; } }
  .pub-cta-eyebrow {
    font-family: 'Space Mono', monospace;
    font-size: 0.6rem;
    letter-spacing: 0.34em;
    text-transform: uppercase;
    color: rgba(240,235,226,0.55);
    margin-bottom: 24px;
  }
  .pub-cta-title {
    font-family: 'Oswald', sans-serif;
    font-size: clamp(2.8rem, 5vw, 5rem);
    font-weight: 200;
    line-height: 0.9;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    margin: 0;
    color: ${C.bg};
  }
  .pub-cta-title em {
    font-family: 'Cormorant Garamond', serif;
    font-style: italic;
    font-weight: 300;
    text-transform: none;
    color: ${C.darkAccent};
  }
  .pub-cta-desc {
    font-family: 'Cormorant Garamond', serif;
    font-size: 1.1rem;
    line-height: 1.75;
    color: rgba(240,235,226,0.75);
    max-width: 36rem;
    margin-bottom: 40px;
  }
  .pub-cta-btn {
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
    color: ${C.bg};
    text-decoration: none;
    transition: background 0.2s, color 0.2s;
  }
  .pub-cta-btn:hover { background: ${C.bg}; color: ${C.fg}; }
  .pub-cta-note {
    margin-top: 24px;
    font-family: 'Space Mono', monospace;
    font-size: 0.6rem;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: rgba(240,235,226,0.45);
  }
  .pub-cta-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1px;
    background: rgba(240,235,226,0.1);
    align-self: center;
  }
  .pub-cta-cell {
    background: ${C.dark};
    padding: 24px;
  }
  @media (min-width: 640px) { .pub-cta-cell { padding: 32px; } }
  .pub-cta-cell-k {
    font-family: 'Space Mono', monospace;
    font-size: 0.55rem;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    color: ${C.darkAccent};
    margin-bottom: 12px;
  }
  .pub-cta-cell-v {
    font-family: 'Cormorant Garamond', serif;
    font-style: italic;
    color: rgba(240,235,226,0.70);
    font-size: 1rem;
    line-height: 1.5;
  }

  /* ── Empty ──────────────────────────────────────────────────────── */
  .pub-empty {
    padding: 96px 40px;
    text-align: center;
    max-width: 40rem;
    margin: 0 auto;
  }
  .pub-empty-title {
    font-family: 'Cormorant Garamond', serif;
    font-size: 1.5rem;
    font-style: italic;
    color: rgba(26,17,9,0.65);
    line-height: 1.6;
  }
`;


const COLOUR_PALETTE = [
  { bg: "#f2ede7", label: "soft white" },
  { bg: "#d4c8b4", label: "stone" },
  { bg: "#3e2a1c", label: "espresso" },
  { bg: "#8a9aaa", label: "denim" },
  { bg: "#a85060", label: "accent" },
];

function formatSeason(season) {
  // "Spring 2026" → "ss'26 ·" style
  const lower = season.toLowerCase();
  if (lower.includes("spring")) return `ss'${season.slice(-2)} ·`;
  if (lower.includes("autumn") || lower.includes("fall")) return `fw'${season.slice(-2)} ·`;
  return season;
}

export default function TrendReports() {
  const published = trendReports
    .filter((r) => r.published)
    .sort((a, b) => {
      if (a.publishedAt > b.publishedAt) return -1;
      if (a.publishedAt < b.publishedAt) return 1;
      return (a.order ?? 99) - (b.order ?? 99);
    });

  const [featured, ...rest] = published;

  return (
    <div className="pub-page">
      <link rel="stylesheet" href={FONTS} />
      <style>{css}</style>

      {/* NADINE site header */}
      <header className="pub-header">
        <div className="pub-header-inner">
          <nav className="pub-sitenav-links" aria-label="Site navigation">
            {STOREFRONT_NAV.map((l) => (
              <a key={l.path} href={`${STOREFRONT_ORIGIN}${l.path}`} className="pub-sitenav-link">{l.label}</a>
            ))}
            <Link to="/trends" className="pub-sitenav-link active">TREND REPORTS</Link>
          </nav>
          <a href={`${STOREFRONT_ORIGIN}/`} className="pub-header-logo">NADINE</a>
          <div className="pub-header-right">
            <Link to="/trends/my-edits" className="pub-personal-link">
              My Trend Edits ↗
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="pub-hero">
        <div>
          <div className="pub-hero-eyebrow">
            {featured ? `${formatSeason(featured.season)} trend intelligence` : "nAia editorial"}
          </div>
          <h1 className="pub-hero-title">
            trend<br />
            <em>reports.</em>
          </h1>
        </div>
        <div className="pub-hero-right">
          <p className="pub-hero-desc">
            Seasonal intelligence on the silhouettes, colours, materials and styling shifts worth paying attention to — and how to make them work in real life.
          </p>
          <div className="pub-hero-sub">
            curated by nAia · personalised in <span>My Trend Edits</span>
          </div>
        </div>
      </section>

      {/* Featured report */}
      {featured && (
        <section className="pub-featured">
          <div className="pub-featured-card">
            <span className="pub-featured-num" aria-hidden="true">00</span>
            <div className="pub-featured-inner">
              <div>
                <div className="pub-featured-kicker">latest report</div>
                <h2 className="pub-featured-title">
                  {featured.title.split(" ").slice(0, -1).join(" ")}{" "}
                  <em>{featured.title.split(" ").slice(-1)[0]}</em>
                </h2>
                <p className="pub-featured-lede">{featured.editorialIntro || featured.summary}</p>
                <div className="pub-featured-actions">
                  <Link to={`/trends/${featured.slug}`} className="pub-pill-btn">
                    Read the report →
                  </Link>
                  <Link to={`/trends/my-edits/${featured.slug}`} className="pub-ghost-link">
                    <span>make it personal</span> ↗
                  </Link>
                </div>
                <div className="pub-featured-meta">
                  <span>{featured.season}</span>
                  <span>{new Date(featured.publishedAt).toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</span>
                </div>
              </div>
              <div className="pub-featured-img">
                <div className="pub-featured-img-inner" aria-hidden="true">
                  <div className="pub-featured-img-mood">{featured.mood}</div>
                  <div className="pub-featured-img-rule" />
                </div>
                <span className="pub-featured-img-label">editorial · {featured.season.toLowerCase()}</span>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Rest of reports */}
      {rest.length > 0 && (
        <section className="pub-grid-section">
          <div className="pub-grid-label">all reports</div>
          <div className="pub-grid">
            {rest.map((report, i) => {
              const tint = TINTS[(i + 1) % TINTS.length];
              const num = String(i + 2).padStart(2, "0");
              const isColourDirection = report.slug === "spring-2026-colour-direction";
              return (
                <Link
                  key={report.slug}
                  to={`/trends/${report.slug}`}
                  className="pub-card"
                  style={{ background: tint }}
                >
                  {isColourDirection && (
                    <div className="pub-card-palette-strip" aria-hidden="true">
                      {COLOUR_PALETTE.map((s) => (
                        <div key={s.label} className="pub-card-palette-swatch" style={{ background: s.bg }} />
                      ))}
                    </div>
                  )}
                  <span className="pub-card-num" aria-hidden="true">{num}</span>
                  <div className="pub-card-top">
                    <span className="pub-card-dot" />
                    {report.season}
                  </div>
                  <div className="pub-card-bottom">
                    <div className="pub-card-title">{report.title}</div>
                    <p className="pub-card-excerpt">{report.summary}</p>
                    <div className="pub-card-footer">
                      <span>{new Date(report.publishedAt).toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</span>
                      <span className="pub-card-arrow">↗</span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {published.length === 0 && (
        <div className="pub-empty">
          <p className="pub-empty-title">Trend reports are being prepared. Check back shortly.</p>
        </div>
      )}

      {/* Personal CTA */}
      <section className="pub-cta">
        <div className="pub-cta-inner">
          <div>
            <div className="pub-cta-eyebrow">personal trend edit</div>
            <h2 className="pub-cta-title">
              make the<br />
              report <em>yours.</em>
            </h2>
            <p className="pub-cta-desc">
              The public report explains the shift. Your Personal Trend Edit considers your Style Passport, Closet, and previous choices — then shows what is relevant to you, what to skip, and how to wear it.
            </p>
            <Link to="/trends/my-edits" className="pub-cta-btn">
              open my trend edits →
            </Link>
            <p className="pub-cta-note">the public reports remain free to read.</p>
          </div>
          <div className="pub-cta-grid">
            {[
              { k: "you already own", v: "matched from your closet" },
              { k: "you've rated", v: "read from outfit reviews" },
              { k: "your style dna says", v: "from your style passport" },
              { k: "your wardrobe gaps", v: "identified by nAia" },
            ].map((e) => (
              <div key={e.k} className="pub-cta-cell">
                <div className="pub-cta-cell-k">{e.k}</div>
                <div className="pub-cta-cell-v">{e.v}</div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
