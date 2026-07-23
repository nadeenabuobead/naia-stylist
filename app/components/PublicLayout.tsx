import { useState } from "react";
import { Link } from "react-router";

const SITE_NAV_LINKS = [
  { label: "HOME", to: "/" },
  { label: "THE HOUSE", to: "/about" },
  { label: "THE COLLECTION", to: "/naia-collection" },
  { label: "THE ART STORY", to: "/art-story" },
  { label: "nAia STYLIST", to: "/stylist" },
  { label: "TREND REPORTS", to: "/trends" },
];

const FOOTER_COLS = [
  {
    title: "customer care",
    links: [
      { label: "Shipping & Delivery", href: "#" },
      { label: "Returns & Refunds", href: "#" },
      { label: "FAQ", href: "#" },
      { label: "Contact", href: "#" },
    ],
  },
  {
    title: "the house",
    links: [
      { label: "The House", href: "/about" },
      { label: "The Collection", href: "/naia-collection" },
      { label: "The Art Story", href: "/art-story" },
      { label: "nAia Stylist", href: "/stylist" },
      { label: "Trend Reports", href: "/trends" },
    ],
  },
  {
    title: "account",
    links: [
      { label: "My nAia", href: "/my-naia" },
      { label: "Wishlist", href: "#" },
    ],
  },
  {
    title: "legal",
    links: [
      { label: "Privacy Policy", href: "#" },
      { label: "Terms of Service", href: "#" },
      { label: "Accessibility", href: "#" },
      { label: "Cookie Preferences", href: "#" },
    ],
  },
  {
    title: "follow",
    links: [
      { label: "Instagram", href: "#" },
      { label: "TikTok", href: "#" },
      { label: "Press", href: "#" },
    ],
  },
];

export function PublicNav({ tone = "light" }: { tone?: "light" | "dark" }) {
  const dark = tone === "dark";
  return (
    <header
      className="mn-sitenav"
      style={
        dark
          ? { position: "absolute", top: 0, left: 0, right: 0, zIndex: 30, background: "transparent", borderBottom: "none" }
          : undefined
      }
    >
      <div className="mn-sitenav-inner">
        <nav className="mn-sitenav-links" aria-label="Site navigation">
          {SITE_NAV_LINKS.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              className="mn-sitenav-link"
              style={dark ? { color: "rgba(255,255,255,0.9)" } : undefined}
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <Link
          to="/"
          className="mn-sitenav-wordmark"
          style={{ textTransform: "none", ...(dark ? { color: "white" } : {}) }}
        >
          NADINE
        </Link>

        <div className="mn-sitenav-actions">
          <button
            aria-label="search"
            className="mn-sitenav-icon-btn"
            style={dark ? { color: "rgba(255,255,255,0.9)" } : undefined}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
            </svg>
          </button>
          <button
            aria-label="wishlist"
            className="mn-sitenav-icon-btn"
            style={dark ? { color: "rgba(255,255,255,0.9)" } : undefined}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
          </button>
          <Link
            to="/my-naia"
            aria-label="My nAia account"
            className="mn-sitenav-icon-link"
            style={dark ? { color: "rgba(255,255,255,0.9)" } : undefined}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
            </svg>
          </Link>
          <button
            aria-label="bag"
            className="mn-sitenav-icon-btn"
            style={dark ? { color: "rgba(255,255,255,0.9)" } : undefined}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" /><line x1="3" y1="6" x2="21" y2="6" /><path d="M16 10a4 4 0 0 1-8 0" />
            </svg>
          </button>
        </div>
      </div>
    </header>
  );
}

export function PublicFooter() {
  const [openCol, setOpenCol] = useState<string | null>(null);

  return (
    <footer
      style={{
        borderTop: "1px solid var(--fg-10)",
        background: "var(--bg)",
        color: "var(--fg)",
      }}
    >
      {/* Desktop footer */}
      <div
        style={{
          maxWidth: "100rem",
          margin: "0 auto",
          padding: "4rem 2.5rem 3rem",
          display: "grid",
          gridTemplateColumns: "repeat(5, 1fr)",
          gap: "2rem",
        }}
        className="pub-footer-desktop"
      >
        {FOOTER_COLS.map((col) => (
          <div key={col.title}>
            <div
              style={{
                fontSize: "0.6rem",
                textTransform: "uppercase",
                letterSpacing: "0.34em",
                color: "var(--fg-55)",
                marginBottom: "1rem",
              }}
            >
              {col.title}
            </div>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "0.6rem" }}>
              {col.links.map((l) => (
                <li key={l.label}>
                  <a
                    href={l.href}
                    style={{
                      fontSize: "0.8rem",
                      color: "var(--fg-70)",
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

      {/* Mobile footer (accordion) */}
      <div className="pub-footer-mobile">
        {FOOTER_COLS.map((col) => {
          const isOpen = openCol === col.title;
          return (
            <div key={col.title} style={{ borderBottom: "1px solid var(--fg-08)" }}>
              <button
                type="button"
                onClick={() => setOpenCol(isOpen ? null : col.title)}
                style={{
                  width: "100%",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "1rem 1.25rem",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  fontSize: "0.6rem",
                  textTransform: "uppercase",
                  letterSpacing: "0.34em",
                  color: "var(--fg-55)",
                  textAlign: "left",
                }}
                aria-expanded={isOpen}
              >
                {col.title}
                <span style={{ fontSize: "0.9rem", color: "var(--fg-40)" }}>{isOpen ? "−" : "+"}</span>
              </button>
              {isOpen && (
                <ul style={{ listStyle: "none", padding: "0 1.25rem 1rem", margin: 0, display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                  {col.links.map((l) => (
                    <li key={l.label}>
                      <a href={l.href} style={{ fontSize: "0.85rem", color: "var(--fg-70)", textDecoration: "none" }}>
                        {l.label}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      <div
        style={{
          maxWidth: "100rem",
          margin: "0 auto",
          padding: "1.5rem 2.5rem",
          borderTop: "1px solid var(--fg-08)",
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.5rem",
        }}
      >
        <span
          style={{
            fontFamily: "var(--ff-display)",
            fontWeight: 200,
            fontSize: "1.1rem",
            letterSpacing: "0.2em",
          }}
        >
          NADINE
        </span>
        <span style={{ fontSize: "0.62rem", color: "var(--fg-45)", letterSpacing: "0.16em" }}>
          © 2026 NADINE. All rights reserved.
        </span>
      </div>

      <style>{`
        @media (min-width: 640px) {
          .pub-footer-desktop { display: grid !important; }
          .pub-footer-mobile { display: none !important; }
        }
        @media (max-width: 639px) {
          .pub-footer-desktop { display: none !important; }
          .pub-footer-mobile { display: block !important; }
        }
        @keyframes pub-ticker {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
      `}</style>
    </footer>
  );
}
