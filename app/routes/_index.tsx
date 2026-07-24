// SUPERSEDED by Lovable/TanStack (nadine-storefront repo). Canonical version is live at /. Held for rollback — do not delete.
import { useState } from "react";
import type { LinksFunction, MetaFunction } from "react-router";
import { Link } from "react-router";
import naiaStyles from "~/styles/naia-design-system.css?url";
import { PublicNav } from "~/components/PublicLayout";
import { ScribbleUnderline } from "~/components/ScribbleUnderline";

export const meta: MetaFunction = () => [
  { title: "NADINE — Fashion That Reads You" },
  { name: "description", content: "NADINE — an AI-powered editorial fashion brand. Virtual try-on, AI styling, digital wardrobes, emotional personalization." },
];

export const links: LinksFunction = () => [{ rel: "stylesheet", href: naiaStyles }];

// ─────────────────────────────────────────────────────────────────────────────
// Data (mirrors Lovable index.tsx exactly)
// ─────────────────────────────────────────────────────────────────────────────

const marquee = [
  "EVERY BODY HAS A STORY TO TELL",
  "PAINTED BY INSTINCT",
  "FROM CANVAS TO CLOTH",
  "CUT WITH INTENTION",
  "MADE TO BE REMEMBERED",
];

const carouselProducts: { name: string; price: string; tryOn?: boolean }[] = [
  { name: "Becoming Alive",       price: "AED 2,150", tryOn: true },
  { name: "Becoming Real",        price: "AED 1,890" },
  { name: "Becoming Fragmented",  price: "AED 3,420", tryOn: true },
  { name: "Becoming Grounded",    price: "AED 2,680" },
  { name: "Becoming Unfiltered",  price: "AED 1,980" },
  { name: "Becoming Rooted",      price: "AED 4,120" },
  { name: "Becoming Seen",        price: "AED 2,340", tryOn: true },
  { name: "Becoming Whole",       price: "AED 3,760" },
  { name: "Becoming Clear",       price: "AED 1,750" },
  { name: "Becoming Her",         price: "AED 5,240", tryOn: true },
  { name: "Becoming Defined",     price: "AED 2,890" },
];

// Product strip image sources.
// Lovable uses piece.modelSrc (CDN model shot) falling back to piece.src (cutout).
// We must NOT substitute cutout garments for missing model shots — they are different assets.
// Only naia-look-01.jpg (piece 7) and naia-look-02.jpg (piece 8) are available locally.
// All other model shots (nadine-look-01 through nadine-look-07) are CDN-only PENDING.
const pieceModelSrcs: (string | null)[] = [
  null,                       // 0 archive-crewneck — nadine-look-01 PENDING
  null,                       // 1 print-collar-shirt — nadine-look-02 PENDING
  null,                       // 2 asymmetric-blazer — nadine-look-03 PENDING
  null,                       // 3 split-memory-coat — nadine-look-04 PENDING
  null,                       // 4 shawl-kimono — nadine-look-05 PENDING
  null,                       // 5 leather-drape-dress — nadine-look-06 PENDING
  null,                       // 6 belt-corset-skirt — nadine-look-07 PENDING
  "/nadine/naia-look-01.jpg", // 7 split-waist-denim — mLook08 (local)
  "/nadine/naia-look-02.jpg", // 8 chiffon-overlay-trouser — mLook09 (local)
  null,                       // 9 corset-memory-gown — no model shot
];

// ─────────────────────────────────────────────────────────────────────────────
// HomeFooter — dark, matches Lovable SiteFooter exactly
// Not using PublicFooter (light) on Home.
// ─────────────────────────────────────────────────────────────────────────────

type FooterGroup = { title: string; links: { label: string; href: string }[] };

const footerCols: FooterGroup[] = [
  {
    title: "customer care",
    links: [
      { label: "Shipping & Delivery", href: "#" },
      { label: "Returns & Refunds",   href: "#" },
      { label: "FAQ",                 href: "#" },
      { label: "Contact",             href: "#" },
    ],
  },
  {
    title: "the house",
    links: [
      { label: "The House",       href: "/about" },
      { label: "The Collection",  href: "/naia-collection" },
      { label: "The Art Story",   href: "/art-story" },
      { label: "nAia Stylist",    href: "/stylist" },
      { label: "Trend Reports",   href: "/trends" },
    ],
  },
  {
    title: "account",
    links: [
      { label: "My nAia",  href: "/my-naia" },
      { label: "Wishlist", href: "#" },
    ],
  },
  {
    title: "legal",
    links: [
      { label: "Privacy Policy",     href: "#" },
      { label: "Terms of Service",   href: "#" },
      { label: "Accessibility",      href: "#" },
      { label: "Cookie Preferences", href: "#" },
    ],
  },
  {
    title: "follow",
    links: [
      { label: "Instagram", href: "#" },
      { label: "TikTok",    href: "#" },
      { label: "Press",     href: "#" },
    ],
  },
];

function FooterAccordion({ group, defaultOpen = false }: { group: FooterGroup; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ borderBottom: "1px solid color-mix(in srgb, var(--bg) 10%, transparent)" }}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex",
          width: "100%",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "1rem 0",
          textAlign: "left",
          background: "none",
          border: "none",
          cursor: "pointer",
        }}
      >
        <span
          style={{
            fontFamily: "var(--ff-display)",
            fontWeight: 200,
            fontSize: "0.7rem",
            textTransform: "uppercase",
            letterSpacing: "0.34em",
            color: "color-mix(in srgb, var(--bg) 80%, transparent)",
          }}
        >
          {group.title}
        </span>
        <span
          aria-hidden="true"
          style={{
            color: "color-mix(in srgb, var(--bg) 60%, transparent)",
            transition: "transform 0.2s",
            transform: open ? "rotate(45deg)" : "none",
          }}
        >
          +
        </span>
      </button>
      {open && (
        <ul style={{ paddingBottom: "1.25rem", paddingLeft: "0.25rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {group.links.map((l) => (
            <li key={l.label}>
              <a
                href={l.href}
                style={{
                  fontSize: "0.85rem",
                  letterSpacing: "0.025em",
                  color: "color-mix(in srgb, var(--bg) 85%, transparent)",
                  textDecoration: "none",
                }}
              >
                {l.label}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function HomeFooter() {
  return (
    <footer style={{ background: "var(--fg)", color: "var(--bg)" }}>
      {/* Desktop / tablet: 5-column grid — hidden on mobile */}
      <div className="hf-desktop">
        {footerCols.map((c) => (
          <div key={c.title}>
            <div
              style={{
                fontFamily: "var(--ff-display)",
                fontWeight: 200,
                fontSize: "0.65rem",
                textTransform: "uppercase",
                letterSpacing: "0.34em",
                color: "color-mix(in srgb, var(--bg) 60%, transparent)",
              }}
            >
              {c.title}
            </div>
            <ul style={{ marginTop: "1.25rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {c.links.map((l) => (
                <li key={l.label}>
                  <a
                    href={l.href}
                    style={{
                      fontSize: "0.8rem",
                      letterSpacing: "0.025em",
                      color: "color-mix(in srgb, var(--bg) 85%, transparent)",
                      textDecoration: "none",
                    }}
                  >
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* Mobile: accordion */}
      <div className="hf-mobile">
        {footerCols.map((c, i) => (
          <FooterAccordion key={c.title} group={c} defaultOpen={i === 0} />
        ))}
      </div>

      {/* Bottom bar */}
      <div className="hf-bottom">
        <span>NADINE © 2026</span>
        <span>Fashion that reads you.</span>
      </div>
    </footer>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default function Index() {
  return (
    <main style={{ position: "relative", minHeight: "100vh", overflow: "hidden", background: "var(--bg)", color: "var(--fg)" }}>
      <style>{`
        /* ── Keyframes ──────────────────────────────────────────────────────── */
        @keyframes ticker {
          from { transform: translateX(0%); }
          to   { transform: translateX(-50%); }
        }

        /* ── Shared utilities ──────────────────────────────────────────────── */
        .h-thin-display {
          font-family: var(--ff-display);
          font-weight: 200;
          letter-spacing: 0.02em;
          line-height: 0.88;
          text-transform: uppercase;
        }
        .h-paper-bg {
          background-color: var(--bg);
          background-image:
            radial-gradient(at 12% 8%, color-mix(in srgb, var(--lipstick) 6%, transparent) 0%, transparent 40%),
            radial-gradient(at 92% 88%, color-mix(in srgb, var(--fg) 8%, transparent) 0%, transparent 45%);
        }
        .h-ticker-track {
          display: flex;
          min-width: max-content;
          align-items: center;
          gap: 1.5rem;
          white-space: nowrap;
          padding: 0.75rem 0;
          animation: ticker 26s linear infinite;
          font-size: 0.78rem;
          text-transform: uppercase;
          letter-spacing: 0.3em;
        }
        /* outline-pill: exact Lovable .outline-pill — py-2.5 px-7 */
        .h-pill {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 9999px;
          border: 1px solid rgba(255,255,255,0.7);
          padding: 0.625rem 1.75rem;
          font-size: 0.7rem;
          font-family: var(--ff-display);
          font-weight: 200;
          text-transform: uppercase;
          letter-spacing: 0.32em;
          color: white;
          text-decoration: none;
          transition: background 0.15s;
        }
        .h-pill:hover { background: rgba(255,255,255,0.12); }
        /* btn-hero: exact Lovable Button variant="hero" size="pill" — h-11 px-6 */
        .h-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 9999px;
          background: var(--lipstick);
          color: var(--bg);
          height: 2.75rem;
          padding: 0 1.5rem;
          font-size: 0.68rem;
          font-family: var(--ff-display);
          font-weight: 200;
          letter-spacing: 0.24em;
          text-transform: uppercase;
          text-decoration: none;
          border: 1px solid transparent;
          cursor: pointer;
          flex-shrink: 0;
          box-shadow: 0 18px 45px color-mix(in srgb, var(--lipstick) 24%, transparent);
          transition: transform 0.15s, opacity 0.15s;
        }
        .h-btn:hover { transform: translateY(-1px); opacity: 0.9; }

        /* ── 1. Hero ───────────────────────────────────────────────────────── */
        /* h1 wordmark: text-[20vw] sm:text-[16vw] lg:text-[15rem] */
        .h-h1 { font-size: 20vw; }
        @media (min-width: 640px)  { .h-h1 { font-size: 16vw; } }
        @media (min-width: 1024px) { .h-h1 { font-size: 15rem; } }

        /* bottom copy: bottom-[16%] left-5 sm:left-10 sm:bottom-[18%] */
        .h-hero-copy { bottom: 16%; left: 1.25rem; }
        @media (min-width: 640px) { .h-hero-copy { bottom: 18%; left: 2.5rem; } }

        /* tagline: text-[1.65rem] sm:text-[2.25rem] */
        .h-hero-tag { font-size: 1.65rem; }
        @media (min-width: 640px) { .h-hero-tag { font-size: 2.25rem; } }

        /* ── 3. Press strip ────────────────────────────────────────────────── */
        /* py-10 sm:py-14 — 2.5rem / 3.5rem */
        .h-press-inner { padding: 2.5rem 1.25rem; }
        @media (min-width: 640px) { .h-press-inner { padding: 3.5rem 2.5rem; } }
        /* logos: h-8 sm:h-10 */
        .h-logo { height: 2rem; }
        @media (min-width: 640px) { .h-logo { height: 2.5rem; } }
        /* gap-x-12 gap-y-6 sm:gap-x-20 */
        .h-logo-row { column-gap: 3rem; row-gap: 1.5rem; }
        @media (min-width: 640px) { .h-logo-row { column-gap: 5rem; } }

        /* ── 4a. Drop: meta strip ──────────────────────────────────────────── */
        /* px-5 sm:px-10 */
        .h-drop-px { padding-left: 1.25rem; padding-right: 1.25rem; }
        @media (min-width: 640px) { .h-drop-px { padding-left: 2.5rem; padding-right: 2.5rem; } }
        /* pt-16 sm:pt-24 */
        .h-drop-top { padding-top: 4rem; }
        @media (min-width: 640px) { .h-drop-top { padding-top: 6rem; } }
        /* the "— CHAPTER I COLLECTION" text — hidden on mobile, shown sm+ */
        .h-chap-label { display: none; }
        @media (min-width: 640px) { .h-chap-label { display: block; } }

        /* 4a sub-headline 3-col: mt-10 sm:mt-14; gap-8 lg:gap-12; lg:grid-cols-[1fr_auto_1fr] */
        .h-drop-edrow {
          display: grid;
          max-width: 100rem;
          margin-left: auto; margin-right: auto;
          gap: 2rem;
          margin-top: 2.5rem;
        }
        @media (min-width: 640px)  { .h-drop-edrow { margin-top: 3.5rem; } }
        @media (min-width: 1024px) { .h-drop-edrow { grid-template-columns: 1fr auto 1fr; align-items: end; gap: 3rem; } }
        /* right col: items-start lg:items-end lg:text-right */
        .h-drop-right { display: flex; flex-direction: column; align-items: flex-start; gap: 0.75rem; }
        @media (min-width: 1024px) { .h-drop-right { align-items: flex-end; text-align: right; } }

        /* figure: w-[72%] sm:w-[52%] */
        .h-print-fig { width: 72%; }
        @media (min-width: 640px) { .h-print-fig { width: 52%; } }

        /* ── 4b. Lookbook ──────────────────────────────────────────────────── */
        /* mt-16 sm:mt-24 */
        .h-look-wrap { margin-top: 4rem; }
        @media (min-width: 640px) { .h-look-wrap { margin-top: 6rem; } }
        /* aspect-[4/5] sm:aspect-[16/9] */
        .h-look-bg { aspect-ratio: 4 / 5; }
        @media (min-width: 640px) { .h-look-bg { aspect-ratio: 16 / 9; } }
        /* title: left-5 top-6 sm:left-10 sm:top-10 */
        .h-look-title { left: 1.25rem; top: 1.5rem; }
        @media (min-width: 640px) { .h-look-title { left: 2.5rem; top: 2.5rem; } }
        /* view all: right-5 top-7 sm:right-10 sm:top-12 */
        .h-look-va { right: 1.25rem; top: 1.75rem; }
        @media (min-width: 640px) { .h-look-va { right: 2.5rem; top: 3rem; } }
        /* strip bottom: bottom-8 sm:bottom-12 */
        .h-strip-wrap { bottom: 2rem; }
        @media (min-width: 640px) { .h-strip-wrap { bottom: 3rem; } }
        /* strip gap: gap-4 sm:gap-6 */
        .h-strip-inner { gap: 1rem; }
        @media (min-width: 640px) { .h-strip-inner { gap: 1.5rem; } }

        /* ── 5. nAia ───────────────────────────────────────────────────────── */
        /* py-24 sm:py-32 — 6rem / 8rem */
        .h-naia-pad { padding: 6rem 1.25rem; }
        @media (min-width: 640px) { .h-naia-pad { padding: 8rem 2.5rem; } }
        /* top grid: lg:grid-cols-[1.1fr_1fr] lg:gap-16 */
        .h-naia-top { display: grid; gap: 2.5rem; }
        @media (min-width: 1024px) { .h-naia-top { grid-template-columns: 1.1fr 1fr; align-items: end; gap: 4rem; } }
        /* h2: text-5xl sm:text-7xl lg:text-[6rem] */
        .h-naia-h2 { font-size: 3rem; }
        @media (min-width: 640px)  { .h-naia-h2 { font-size: 4.5rem; } }
        @media (min-width: 1024px) { .h-naia-h2 { font-size: 6rem; } }
        /* cap grid: sm:grid-cols-3 sm:gap-14 */
        .h-cap-grid { display: grid; gap: 2.5rem; }
        @media (min-width: 640px) { .h-cap-grid { grid-template-columns: repeat(3, 1fr); gap: 3.5rem; } }

        /* ── 6. Manifesto ──────────────────────────────────────────────────── */
        /* py-24 sm:py-32 */
        .h-mfst-pad { padding: 6rem 1.25rem; }
        @media (min-width: 640px) { .h-mfst-pad { padding: 8rem 2.5rem; } }
        /* h2: text-5xl sm:text-7xl lg:text-[6.5rem] */
        .h-mfst-h2 { font-size: 3rem; }
        @media (min-width: 640px)  { .h-mfst-h2 { font-size: 4.5rem; } }
        @media (min-width: 1024px) { .h-mfst-h2 { font-size: 6.5rem; } }
        /* 3-col: sm:grid-cols-3 */
        .h-mfst-cols { display: grid; gap: 2.5rem; }
        @media (min-width: 640px) { .h-mfst-cols { grid-template-columns: repeat(3, 1fr); } }

        /* ── 7. The Making ─────────────────────────────────────────────────── */
        /* py-24 sm:py-28 — 6rem / 7rem */
        .h-mkng-pad { padding: 6rem 1.25rem; }
        @media (min-width: 640px) { .h-mkng-pad { padding: 7rem 2.5rem; } }
        /* grid: lg:grid-cols-[1fr_1fr] lg:gap-16 */
        .h-mkng-grid { display: grid; gap: 2.5rem; }
        @media (min-width: 1024px) { .h-mkng-grid { grid-template-columns: 1fr 1fr; align-items: end; gap: 4rem; } }
        /* h2: text-5xl sm:text-7xl */
        .h-mkng-h2 { font-size: 3rem; }
        @media (min-width: 640px) { .h-mkng-h2 { font-size: 4.5rem; } }

        /* ── 8. Closing CTA ────────────────────────────────────────────────── */
        /* inner: px-5 pb-16 sm:px-10 sm:pb-20 */
        .h-cta-inner { padding: 0 1.25rem 4rem; }
        @media (min-width: 640px) { .h-cta-inner { padding: 0 2.5rem 5rem; } }
        /* h2: text-5xl sm:text-7xl lg:text-[7rem] */
        .h-cta-h2 { font-size: 3rem; }
        @media (min-width: 640px)  { .h-cta-h2 { font-size: 4.5rem; } }
        @media (min-width: 1024px) { .h-cta-h2 { font-size: 7rem; } }
        /* links row: flex-col sm:flex-row sm:items-center */
        .h-cta-links { flex-direction: column; align-items: flex-start; }
        @media (min-width: 640px) { .h-cta-links { flex-direction: row; align-items: center; } }

        /* ── 9. Footer ─────────────────────────────────────────────────────── */
        /* desktop grid: hidden → sm:grid 2-col → lg:grid 5-col */
        .hf-desktop {
          display: none;
          max-width: 100rem;
          margin-left: auto; margin-right: auto;
        }
        @media (min-width: 640px) {
          .hf-desktop {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 2.5rem;
            padding: 4rem 2.5rem;
          }
        }
        @media (min-width: 1024px) {
          .hf-desktop {
            grid-template-columns: repeat(5, 1fr);
            gap: 2.5rem;
            padding: 5rem 2.5rem;
          }
        }
        /* mobile accordion: shown → sm:hidden */
        .hf-mobile {
          max-width: 100rem;
          margin-left: auto; margin-right: auto;
          padding: 2.5rem 1.25rem;
        }
        @media (min-width: 640px) { .hf-mobile { display: none; } }
        /* bottom bar */
        .hf-bottom {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          justify-content: space-between;
          gap: 0.75rem;
          border-top: 1px solid color-mix(in srgb, var(--bg) 10%, transparent);
          max-width: 100rem;
          margin-left: auto; margin-right: auto;
          padding: 1.5rem 1.25rem;
          font-size: 0.65rem;
          text-transform: uppercase;
          letter-spacing: 0.28em;
          color: color-mix(in srgb, var(--bg) 55%, transparent);
        }
        @media (min-width: 640px) {
          .hf-bottom { flex-direction: row; align-items: center; padding: 1.5rem 2.5rem; }
        }
      `}</style>

      {/* ── 1. HERO ──────────────────────────────────────────────────────────────
          section#top h-[100svh] min-h-[640px] bg-paper
          video + poster: naia-hero.mp4 PENDING — poster only                   */}
      <section
        id="top"
        style={{
          position: "relative",
          height: "100svh",
          minHeight: "640px",
          width: "100%",
          overflow: "hidden",
          background: "#1a1108",
          color: "white",
        }}
      >
        <PublicNav tone="dark" />

        {/* Hero poster: naia-hero.mp4 + naia-hero-garment-poster.jpg PENDING */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage: "url(/nadine/naia-hero.jpg)",
            backgroundPosition: "center",
            backgroundSize: "cover",
            filter: "blur(2px) saturate(0.95)",
            opacity: 0.9,
          }}
        />
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(to bottom, rgba(0,0,0,0.4) 0%, rgba(0,0,0,0.1) 40%, rgba(0,0,0,0.55) 100%)",
          }}
        />

        {/* Masthead wordmark — thin-display text-[20vw] sm:text-[16vw] lg:text-[15rem] */}
        <h1
          className="h-thin-display h-h1"
          style={{
            position: "absolute",
            top: "16%",
            left: 0,
            right: 0,
            zIndex: 20,
            textAlign: "center",
            color: "white",
            letterSpacing: "0.04em",
            textTransform: "none",
          }}
        >
          NADINE
        </h1>

        {/* Bottom copy — bottom-[16%] left-5 sm:left-10 sm:bottom-[18%] */}
        <div
          className="h-hero-copy"
          style={{ position: "absolute", zIndex: 20, maxWidth: "34rem" }}
        >
          <p
            className="h-thin-display h-hero-tag"
            style={{ lineHeight: 1.2, letterSpacing: "0.02em", color: "rgba(255,255,255,0.9)" }}
          >
            EVERY BODY HAS A STORY TO TELL.
          </p>
          <p style={{ marginTop: "1rem", fontSize: "1rem", lineHeight: 1.75, color: "rgba(255,255,255,0.7)" }}>
            Founded in 2021 and featured in Vogue, Vanity Fair and Soul Arabia, NADINE translates original artwork, memory and emotion into pieces made to be lived in.
          </p>
          <div style={{ marginTop: "1.5rem", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "1rem" }}>
            <Link to="/naia-collection" className="h-pill">SHOP CHAPTER I</Link>
            <Link to="/stylist" className="h-pill">MEET YOUR nAia STYLIST</Link>
          </div>
        </div>

        {/* Scroll cue */}
        <div
          style={{
            position: "absolute",
            bottom: "1.5rem",
            right: "1.5rem",
            zIndex: 20,
            fontFamily: "var(--ff-display)",
            fontWeight: 200,
            fontSize: "0.65rem",
            textTransform: "uppercase",
            letterSpacing: "0.34em",
            color: "rgba(255,255,255,0.6)",
          }}
        >
          scroll ↓ chapter I
        </div>
      </section>

      {/* ── 2. BLACK MARQUEE STRIP ────────────────────────────────────────────── */}
      <section style={{ position: "relative", background: "var(--fg)", overflow: "hidden" }}>
        <div className="h-ticker-track" style={{ color: "var(--bg)" }}>
          {[...marquee, ...marquee].map((m, i) => (
            <span key={`${m}-${i}`} style={{ display: "flex", alignItems: "center", gap: "1.5rem" }}>
              <span>/</span>
              <span>{m}</span>
            </span>
          ))}
        </div>
      </section>

      {/* ── 3. PRESS STRIP ────────────────────────────────────────────────────── */}
      <section className="h-paper-bg" style={{ borderBottom: "1px solid var(--fg-10)" }}>
        <div
          className="h-press-inner"
          style={{
            marginLeft: "auto",
            marginRight: "auto",
            maxWidth: "100rem",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "1.5rem",
          }}
        >
          <div
            className="h-thin-display"
            style={{ fontSize: "0.65rem", letterSpacing: "0.4em", color: "var(--fg-55)" }}
          >
            featured in
          </div>
          <div
            className="h-logo-row"
            style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "center" }}
          >
            <img src="/nadine/vogue-logo.png" alt="Vogue" className="h-logo" style={{ width: "auto", objectFit: "contain", opacity: 0.8 }} />
            <img src="/nadine/vanity-fair-logo.png" alt="Vanity Fair" className="h-logo" style={{ width: "auto", objectFit: "contain", opacity: 0.8 }} />
            <img src="/nadine/soul-arabia-logo.png" alt="Soul Arabia" className="h-logo" style={{ width: "auto", objectFit: "contain", opacity: 0.8 }} />
          </div>
        </div>
      </section>

      {/* ── 4. DROP SHOWCASE — section#drop ───────────────────────────────────── */}
      <section id="drop" className="h-paper-bg" style={{ position: "relative", overflow: "hidden" }}>

        {/* ── 4a. PRINT / BECOMING masthead stack ── */}
        <div className="h-drop-top" style={{ position: "relative", width: "100%", overflow: "hidden" }}>

          {/* top meta strip */}
          <div
            className="h-drop-px"
            style={{
              marginLeft: "auto",
              marginRight: "auto",
              display: "flex",
              maxWidth: "100rem",
              alignItems: "center",
              justifyContent: "space-between",
              paddingBottom: "1.5rem",
            }}
          >
            <div style={{ fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.34em", color: "var(--fg-55)" }}>
              CHAPTER 01 / FW'26
            </div>
            <div
              className="h-chap-label"
              style={{ fontFamily: "var(--ff-editorial)", fontStyle: "italic", color: "var(--lipstick)", fontSize: "0.875rem" }}
            >
              — CHAPTER I COLLECTION
            </div>
          </div>

          {/* Masthead stack */}
          <div style={{ position: "relative" }}>

            {/* PRINT — outlined, full bleed, z:10 */}
            <h2
              className="h-thin-display"
              style={{
                position: "relative",
                zIndex: 10,
                textAlign: "center",
                lineHeight: 0.82,
                color: "transparent",
                WebkitTextStroke: "1px var(--fg)",
                fontSize: "clamp(5rem, 22vw, 22rem)",
                userSelect: "none",
              }}
            >
              PRINT
            </h2>

            {/* Print morph figure — naia-print-morph.mp4 PENDING, poster only */}
            {/* w-[72%] sm:w-[52%], aspect-[3/4], z:20 */}
            <figure
              className="h-print-fig"
              style={{
                position: "relative",
                zIndex: 20,
                marginLeft: "auto",
                marginRight: "auto",
                marginTop: "-6vw",
                marginBottom: "-6vw",
                maxWidth: "760px",
              }}
            >
              <div
                style={{
                  position: "relative",
                  aspectRatio: "3 / 4",
                  width: "100%",
                  overflow: "hidden",
                  background: "#efeae0",
                  boxShadow: "0 30px 80px -20px rgba(60,30,15,0.45)",
                }}
              >
                <img
                  src="/nadine/print-memory.png"
                  alt="PRINT / MEMORY — Chapter I (naia-print-morph.mp4 pending)"
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
                />
                <div
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    inset: 0,
                    mixBlendMode: "multiply",
                    opacity: 0.3,
                    background: "radial-gradient(120% 80% at 50% 30%, transparent 40%, rgba(60,30,15,0.35) 100%)",
                  }}
                />
                <span style={{ position: "absolute", left: "0.5rem", top: "0.5rem", display: "block", height: "0.75rem", width: "0.75rem", borderLeft: "1px solid rgba(60,30,15,0.5)", borderTop: "1px solid rgba(60,30,15,0.5)" }} />
                <span style={{ position: "absolute", right: "0.5rem", top: "0.5rem", display: "block", height: "0.75rem", width: "0.75rem", borderRight: "1px solid rgba(60,30,15,0.5)", borderTop: "1px solid rgba(60,30,15,0.5)" }} />
                <span style={{ position: "absolute", left: "0.5rem", bottom: "0.5rem", display: "block", height: "0.75rem", width: "0.75rem", borderLeft: "1px solid rgba(60,30,15,0.5)", borderBottom: "1px solid rgba(60,30,15,0.5)" }} />
                <span style={{ position: "absolute", right: "0.5rem", bottom: "0.5rem", display: "block", height: "0.75rem", width: "0.75rem", borderRight: "1px solid rgba(60,30,15,0.5)", borderBottom: "1px solid rgba(60,30,15,0.5)" }} />
              </div>
            </figure>

            {/* BECOMING — solid, z:30 */}
            <h2
              className="h-thin-display"
              style={{
                position: "relative",
                zIndex: 30,
                textAlign: "center",
                lineHeight: 0.82,
                color: "var(--fg)",
                fontSize: "clamp(5rem, 22vw, 22rem)",
                userSelect: "none",
              }}
            >
              BECOMING<span style={{ color: "var(--lipstick)" }}>.</span>
            </h2>
          </div>

          {/* Sub-headline 3-col — mt-10 sm:mt-14; lg:grid-cols-[1fr_auto_1fr] lg:gap-12 */}
          <div
            className="h-drop-edrow h-drop-px"
          >
            {/* Left col */}
            <div style={{ maxWidth: "24rem", fontSize: "0.875rem", lineHeight: 1.75, color: "var(--fg-75)" }}>
              <p style={{ marginTop: "1rem" }}>A hand-painted canvas in rust, bone and ember becomes the starting point for Chapter I.</p>
              <p style={{ marginTop: "1rem" }}>Its marks are translated into fabric, then shaped into pieces that move with the body: cut, sculpted, softened and made to be lived in.</p>
              <p style={{ marginTop: "1rem" }}>Leather holds. Suede softens. Cotton grounds. Each material carries its own feeling — together forming a collection about return, transformation and becoming.</p>
              <p className="h-thin-display" style={{ marginTop: "1.5rem", fontSize: "0.65rem", letterSpacing: "0.34em", color: "var(--fg-60)" }}>FW'26</p>
              <p className="h-thin-display" style={{ marginTop: "0.25rem", fontSize: "0.65rem", letterSpacing: "0.34em", color: "var(--fg-60)" }}>CHAPTER I.</p>
            </div>
            {/* Centre divider — auto col */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
              <span style={{ display: "inline-block", height: "1px", width: "4rem", background: "var(--fg-30)" }} />
            </div>
            {/* Right col — lg:items-end lg:text-right */}
            <div className="h-drop-right">
              <p style={{ maxWidth: "24rem", fontSize: "0.875rem", lineHeight: 1.75, color: "var(--fg-75)" }}>
                Every piece begins with a story. Discover the painting, fabric and construction behind Chapter I — then find the piece that becomes part of yours.
              </p>
              <Link to="/naia-collection" className="h-btn">EXPLORE THE COLLECTION</Link>
            </div>
          </div>
        </div>

        {/* ── 4b. LOOKBOOK — mt-16 sm:mt-24 ── */}
        <div
          className="h-look-wrap"
          style={{ position: "relative", marginLeft: "auto", marginRight: "auto", maxWidth: "100rem", overflow: "hidden" }}
        >
          {/* Background — nadine-look-05.png PENDING */}
          <div
            className="h-look-bg"
            style={{ position: "relative", width: "100%" }}
          >
            {/* [ASSET PENDING: nadine-look-05.png] */}
            <div
              style={{ position: "absolute", inset: 0, background: "#1a1108" }}
              aria-label="Lookbook background — nadine-look-05.png pending"
            >
              <span
                style={{
                  position: "absolute",
                  top: "50%",
                  left: "50%",
                  transform: "translate(-50%, -50%)",
                  fontFamily: "var(--ff-display)",
                  fontWeight: 200,
                  fontSize: "0.6rem",
                  textTransform: "uppercase",
                  letterSpacing: "0.34em",
                  color: "rgba(255,255,255,0.2)",
                  whiteSpace: "nowrap",
                }}
              >
                [ ASSET PENDING: nadine-look-05.png ]
              </span>
            </div>
            <div aria-hidden="true" style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.1) 50%, transparent 100%)" }} />

            {/* Title — left-5 top-6 sm:left-10 sm:top-10 */}
            <div className="h-look-title" style={{ position: "absolute", zIndex: 10 }}>
              <div style={{ fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.34em", color: "rgba(255,255,255,0.7)" }}>
                chapter 1 · fw'26
              </div>
              <h2
                className="h-thin-display"
                style={{ marginTop: "0.5rem", fontSize: "clamp(2rem, 6vw, 4rem)", color: "white" }}
              >
                THE COLLECTION<span style={{ color: "var(--lipstick)" }}>.</span>
              </h2>
            </div>

            {/* View all — right-5 top-7 sm:right-10 sm:top-12 */}
            <Link
              to="/naia-collection"
              className="h-look-va"
              style={{
                position: "absolute",
                zIndex: 10,
                fontFamily: "var(--ff-display)",
                fontWeight: 200,
                fontSize: "0.7rem",
                textTransform: "uppercase",
                letterSpacing: "0.3em",
                color: "rgba(255,255,255,0.7)",
                textDecoration: "none",
              }}
            >
              view all
            </Link>
          </div>

          {/* Scrolling product strip — bottom-8 sm:bottom-12; gap-4 sm:gap-6 */}
          <div
            className="h-strip-wrap"
            style={{ position: "absolute", left: 0, width: "100%", overflow: "hidden" }}
          >
            <div
              className="h-strip-inner"
              style={{ display: "flex", animation: "ticker 28s linear infinite", width: "max-content" }}
            >
              {[...carouselProducts, ...carouselProducts].map((product, idx) => {
                const pieceIdx = idx % pieceModelSrcs.length;
                const imgSrc = pieceModelSrcs[pieceIdx];
                return (
                  <Link
                    key={`${product.name}-${idx}`}
                    to="/naia-collection"
                    style={{ display: "block", flexShrink: 0, width: "clamp(140px, 18vw, 260px)", textDecoration: "none" }}
                    aria-label={`${product.name} — ${product.price}`}
                  >
                    <div style={{ position: "relative", aspectRatio: "3 / 4", overflow: "hidden", background: "#1e1510" }}>
                      {imgSrc ? (
                        <img
                          src={imgSrc}
                          alt={product.name}
                          loading="lazy"
                          style={{ height: "100%", width: "100%", objectFit: "cover" }}
                        />
                      ) : (
                        <div
                          style={{
                            position: "absolute",
                            inset: 0,
                            display: "flex",
                            alignItems: "flex-end",
                            padding: "0.5rem",
                          }}
                        >
                          <span
                            style={{
                              fontFamily: "var(--ff-display)",
                              fontWeight: 200,
                              fontSize: "0.5rem",
                              textTransform: "uppercase",
                              letterSpacing: "0.2em",
                              color: "rgba(255,255,255,0.2)",
                            }}
                          >
                            PENDING
                          </span>
                        </div>
                      )}
                      {product.tryOn && (
                        <span
                          style={{
                            position: "absolute",
                            left: "0.5rem",
                            top: "0.5rem",
                            border: "1px solid rgba(255,255,255,0.7)",
                            background: "rgba(0,0,0,0.25)",
                            padding: "0.25rem 0.5rem",
                            fontSize: "0.55rem",
                            textTransform: "uppercase",
                            letterSpacing: "0.28em",
                            color: "white",
                            backdropFilter: "blur(4px)",
                          }}
                        >
                          try on
                        </span>
                      )}
                    </div>
                    <div style={{ marginTop: "0.75rem", display: "flex", flexDirection: "column", gap: "0.125rem" }}>
                      <h3
                        className="h-thin-display"
                        style={{ fontSize: "0.7rem", letterSpacing: "0.18em", color: "white" }}
                      >
                        {product.name}
                      </h3>
                      <p style={{ fontSize: "0.65rem", letterSpacing: "0.12em", color: "rgba(255,255,255,0.7)" }}>
                        {product.price}
                      </p>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* ── 5. nAia — STYLED BY INTELLIGENCE ──────────────────────────────────── */}
      <section id="naia" className="h-paper-bg" style={{ position: "relative", borderTop: "1px solid var(--fg-10)" }}>
        <div
          className="h-naia-pad"
          style={{ marginLeft: "auto", marginRight: "auto", maxWidth: "100rem" }}
        >
          {/* Top 2-col: lg:grid-cols-[1.1fr_1fr] */}
          <div className="h-naia-top">
            <div>
              <div className="h-thin-display" style={{ fontSize: "0.65rem", letterSpacing: "0.4em", color: "var(--fg-55)" }}>
                the nAia stylist
              </div>
              <h2
                className="h-thin-display h-naia-h2"
                style={{ marginTop: "1.25rem", lineHeight: 0.95 }}
              >
                STYLED BY INTELLIGENCE.<br />
                <span
                  style={{
                    fontFamily: "var(--ff-editorial)",
                    fontStyle: "italic",
                    color: "var(--lipstick)",
                    textTransform: "none",
                    fontWeight: 400,
                  }}
                >
                  chosen for your life.
                </span>
              </h2>
            </div>
            <p style={{ maxWidth: "28rem", fontSize: "1rem", lineHeight: 1.75, color: "var(--fg-75)" }}>
              nAia looks beyond the piece — considering your preferences, your wardrobe and how you want to feel. Discover what works with what you already own, build a complete look and preview eligible pieces on you.
            </p>
          </div>

          {/* 3-col capability grid — sm:grid-cols-3 */}
          <div
            className="h-cap-grid"
            style={{ marginTop: "4rem", borderTop: "1px solid var(--fg-15)", paddingTop: "3.5rem" }}
          >
            {[
              { n: "I",   t: "UNDERSTAND YOUR STYLE", d: "Build a Style Passport shaped by your preferences, lifestyle and real feedback." },
              { n: "II",  t: "STYLE WHAT YOU OWN",    d: "Combine NADINE with clothing, shoes and bags already in your Closet." },
              { n: "III", t: "SEE THE LOOK ON YOU",   d: "Create a visual preview using your saved My nAia Model." },
            ].map((c) => (
              <div key={c.t}>
                <span
                  className="h-thin-display"
                  style={{ display: "block", color: "var(--lipstick)", fontSize: "0.875rem", letterSpacing: "0.34em" }}
                >
                  {c.n}
                </span>
                <h3
                  className="h-thin-display"
                  style={{ marginTop: "1rem", fontSize: "1.25rem", letterSpacing: "0.12em", lineHeight: 1.1 }}
                >
                  {c.t}
                </h3>
                <p style={{ marginTop: "1rem", fontSize: "0.875rem", lineHeight: 1.5, color: "var(--fg-70)" }}>
                  {c.d}
                </p>
              </div>
            ))}
          </div>

          <div style={{ marginTop: "3.5rem" }}>
            <Link to="/stylist" className="h-btn">MEET YOUR nAia STYLIST</Link>
          </div>
        </div>
      </section>

      {/* ── 6. MANIFESTO ─────────────────────────────────────────────────────────
          section#about py-24 sm:py-32, max-w-[80rem], sm:grid-cols-3           */}
      <section id="about" className="h-paper-bg" style={{ position: "relative" }}>
        <div
          className="h-mfst-pad"
          style={{ position: "relative", marginLeft: "auto", marginRight: "auto", maxWidth: "80rem" }}
        >
          <div style={{ fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.34em", color: "var(--fg-60)" }}>
            manifesto
          </div>
          <h2
            className="h-thin-display h-mfst-h2"
            style={{ marginTop: "1rem", lineHeight: 0.9 }}
          >
            WE DO NOT BEGIN WITH A TREND.<br />
            <span
              style={{
                position: "relative",
                display: "inline-block",
                fontFamily: "var(--ff-editorial)",
                fontStyle: "italic",
                color: "var(--lipstick)",
                textTransform: "none",
                fontWeight: 400,
              }}
            >
              we begin with a story.
              <ScribbleUnderline
                style={{
                  position: "absolute",
                  bottom: "-0.5rem",
                  left: 0,
                  height: "1rem",
                  width: "100%",
                  color: "var(--lipstick)",
                  display: "block",
                }}
              />
            </span>
          </h2>
          <div className="h-mfst-cols" style={{ marginTop: "3.5rem", fontSize: "1rem", lineHeight: 1.75, color: "var(--fg-75)" }}>
            <p>
              <span className="h-thin-display" style={{ display: "block", color: "var(--lipstick)", fontSize: "0.875rem", letterSpacing: "0.3em", marginBottom: "0.5rem" }}>01 / CANVAS</span>
              Every collection begins with an original work. Paint, texture and memory become the starting point.
            </p>
            <p>
              <span className="h-thin-display" style={{ display: "block", color: "var(--lipstick)", fontSize: "0.875rem", letterSpacing: "0.3em", marginBottom: "0.5rem" }}>02 / FORM</span>
              The story is translated through silhouette, construction and movement — cut to meet the body, not overpower it.
            </p>
            <p>
              <span className="h-thin-display" style={{ display: "block", color: "var(--lipstick)", fontSize: "0.875rem", letterSpacing: "0.3em", marginBottom: "0.5rem" }}>03 / FEELING</span>
              Pieces are made to stay with you: expressive, personal, and open to becoming part of your own story.
            </p>
          </div>
        </div>
      </section>

      {/* ── 7. THE MAKING — dark ─────────────────────────────────────────────────
          section#making bg-foreground py-24 sm:py-28, lg:grid-cols-[1fr_1fr]   */}
      <section id="making" style={{ position: "relative", background: "var(--fg)", color: "var(--bg)" }}>
        <div
          className="h-mkng-pad"
          style={{ position: "relative", marginLeft: "auto", marginRight: "auto", maxWidth: "90rem" }}
        >
          <div className="h-mkng-grid">
            <div>
              <div style={{ fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.34em", color: "color-mix(in srgb, var(--bg) 60%, transparent)" }}>
                the making
              </div>
              <h2
                className="h-thin-display h-mkng-h2"
                style={{ marginTop: "0.75rem", color: "var(--bg)" }}
              >
                FROM CANVAS TO CLOTH.
              </h2>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
              <p
                style={{
                  maxWidth: "28rem",
                  fontFamily: "var(--ff-editorial)",
                  fontStyle: "italic",
                  color: "color-mix(in srgb, var(--bg) 80%, transparent)",
                  fontSize: "1.125rem",
                }}
              >
                Every chapter begins with an original work — painting, memory, texture — then moves through fabric, form and feeling until it becomes something made to be worn.
              </p>
              <Link to="/art-story" className="h-btn">DISCOVER THE ART STORY</Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── 8. CLOSING CTA — wardrobe video ──────────────────────────────────────
          section#waitlist h-[90svh] min-h-[34rem]; naia-wardrobe.mp4 PENDING    */}
      <section
        id="waitlist"
        style={{ position: "relative", height: "90svh", minHeight: "34rem", width: "100%", overflow: "hidden", background: "var(--fg)" }}
      >
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage: "url(/nadine/naia-wardrobe.jpg)",
            backgroundPosition: "center",
            backgroundSize: "cover",
            filter: "blur(10px) saturate(0.9)",
            opacity: 0.8,
          }}
        />
        <div aria-hidden="true" style={{ position: "absolute", inset: 0, background: "linear-gradient(to bottom, rgba(0,0,0,0.3) 0%, rgba(0,0,0,0.2) 40%, rgba(0,0,0,0.65) 100%)" }} />
        <div
          className="h-cta-inner"
          style={{ position: "relative", zIndex: 10, display: "flex", height: "100%", flexDirection: "column", justifyContent: "flex-end" }}
        >
          <h2
            className="h-thin-display h-cta-h2"
            style={{ marginTop: "1rem", maxWidth: "64rem", lineHeight: 0.95 }}
          >
            THE NEXT CHAPTER<br />OF NADINE{" "}
            <span style={{ fontFamily: "var(--ff-editorial)", fontStyle: "italic", color: "rgba(255,255,255,0.9)", textTransform: "none", fontWeight: 400 }}>
              begins here.
            </span>
          </h2>
          <div
            className="h-cta-links"
            style={{ marginTop: "2rem", display: "flex", gap: "1.5rem" }}
          >
            <Link to="/naia-collection" className="h-pill">EXPLORE THE COLLECTION</Link>
            <Link to="/stylist" className="h-pill">MEET YOUR nAia STYLIST</Link>
          </div>
        </div>
      </section>

      {/* ── 9. FOOTER — dark, matches Lovable SiteFooter ─────────────────────── */}
      <HomeFooter />
    </main>
  );
}
