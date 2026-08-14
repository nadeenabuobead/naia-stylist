import { useState } from "react";
import { Link, useLocation } from "react-router";

type NavItem = { to: string; label: string; exact?: boolean; indent?: boolean };
type NavGroup = { title: string; items: NavItem[] };

const MY_NAIA_NAV: NavGroup[] = [
  {
    title: "Main",
    items: [
      { to: "/my-naia", label: "Overview", exact: true },
      { to: "/passport", label: "Style Passport" },
      { to: "/closet", label: "My Closet" },
      { to: "/style-me", label: "StyleMe" },
      { to: "/buyskip", label: "Buy or Skip" },
      { to: "/trends", label: "My Trend Edits" },
      { to: "/passport/selfie", label: "Selfie Style Analysis" },
    ],
  },
  {
    title: "Account",
    items: [
      { to: "/my-naia/saved", label: "Saved" },
      { to: "/my-naia/orders", label: "Orders" },
      { to: "/my-naia/personalisation", label: "Personalisation" },
      { to: "/my-naia-model", label: "My nAia Model", indent: true },
      { to: "/my-naia/what-naia-notices", label: "What nAia Is Noticing", indent: true },
      { to: "/my-naia/plan-usage", label: "Plan & Usage" },
      { to: "/settings", label: "Settings & Privacy" },
    ],
  },
];

function isActive(pathname: string, item: NavItem) {
  return item.exact ? pathname === item.to : pathname.startsWith(item.to);
}

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

interface Props {
  children: React.ReactNode;
  compact?: boolean;
}

export default function MyNaiaLayout({ children, compact = false }: Props) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [footerOpen, setFooterOpen] = useState<string | null>("customer care");
  const { pathname } = useLocation();

  return (
    <main className="mn-page">
      {/* ── Site-level header (NADINE brand) ── */}
      <header className="mn-sitenav">
        <div className="mn-sitenav-inner">
          <nav className="mn-sitenav-links" aria-label="Site navigation">
            {SITE_NAV_LINKS.map((l) => (
              <Link key={l.to} to={l.to} className="mn-sitenav-link">
                {l.label}
              </Link>
            ))}
          </nav>

          <Link to="/" className="mn-sitenav-wordmark" style={{ textTransform: "none" }}>
            NADINE
          </Link>

          <div className="mn-sitenav-actions">
            <button aria-label="search" className="mn-sitenav-icon-btn">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
              </svg>
            </button>
            <button aria-label="wishlist" className="mn-sitenav-icon-btn">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
              </svg>
            </button>
            <Link to="/my-naia" aria-label="My nAia account" className="mn-sitenav-icon-link">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="8" r="4" />
                <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
              </svg>
            </Link>
            <button aria-label="bag" className="mn-sitenav-icon-btn">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/>
              </svg>
            </button>
          </div>
        </div>
      </header>

      {/* ── MY nAia. heading — suppressed in compact (feature-page) mode ── */}
      {!compact && (
        <section className="mn-page-head">
          <div className="mn-page-head-meta">
            <div />
            <span className="mn-page-head-badge">Preview · Sample Information</span>
          </div>
          <h1 className="mn-page-head-title">
            MY{" "}
            <span className="mn-title-accent">nAia.</span>
          </h1>
        </section>
      )}

      {/* ── Mobile nav trigger (< lg) ── */}
      <div className="mn-mobile-trigger">
        <span className="mn-mobile-trigger-label">Sections</span>
        <button
          type="button"
          className="mn-mobile-menu-btn"
          onClick={() => setMobileOpen((o) => !o)}
          aria-expanded={mobileOpen}
          aria-controls="mn-mobile-nav"
        >
          <span className={`mn-mobile-menu-icon${mobileOpen ? " mn-open" : ""}`} aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          Menu
        </button>
      </div>

      {/* ── Mobile nav panel ── */}
      {mobileOpen && (
        <nav id="mn-mobile-nav" className="mn-mobile-nav">
          <div className="mn-mobile-nav-inner">
            {MY_NAIA_NAV.map((group) => (
              <div key={group.title} className="mn-mobile-nav-group">
                <div className="mn-mobile-nav-group-title">{group.title}</div>
                <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                  {group.items.map((item) => {
                    const active = isActive(pathname, item);
                    return (
                      <li key={item.to}>
                        <Link
                          to={item.to}
                          onClick={() => setMobileOpen(false)}
                          className={[
                            "mn-mobile-nav-link",
                            item.indent ? "mn-nav-indent" : "",
                            active ? "mn-active" : "",
                          ].join(" ")}
                        >
                          {item.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </nav>
      )}

      {/* ── Two-column body ── */}
      <section className={compact ? "mn-body mn-body--compact" : "mn-body"}>
        {/* Desktop sidebar (≥ lg) */}
        <aside className="mn-sidebar" aria-label="My nAia navigation">
          <div className="mn-sidebar-inner">
            {MY_NAIA_NAV.map((group) => (
              <div key={group.title}>
                <div className="mn-sidebar-group-title">{group.title}</div>
                <nav aria-label={group.title}>
                  <ol className="mn-sidebar-nav">
                    {group.items.map((item) => {
                      const active = isActive(pathname, item);
                      return (
                        <li
                          key={item.to}
                          className={[
                            "mn-sidebar-nav-item",
                            item.indent ? "mn-nav-indent" : "",
                          ].join(" ")}
                        >
                          <Link
                            to={item.to}
                            className={[
                              "mn-sidebar-nav-link",
                              active ? "mn-active" : "",
                            ].join(" ")}
                          >
                            <span className="mn-sidebar-nav-line" aria-hidden="true" />
                            {item.label}
                          </Link>
                        </li>
                      );
                    })}
                  </ol>
                </nav>
              </div>
            ))}
          </div>
        </aside>

        {/* Page content */}
        <div className="mn-content">
          {children}
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="mn-footer">
        {/* Desktop grid */}
        <div className="mn-footer-grid">
          {FOOTER_COLS.map((col) => (
            <div key={col.title}>
              <div className="mn-footer-col-title">{col.title}</div>
              <ul className="mn-footer-list">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <a href={l.href} className="mn-footer-link">{l.label}</a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Mobile accordion */}
        <div className="mn-footer-accordion">
          {FOOTER_COLS.map((col) => (
            <div key={col.title} className="mn-footer-accordion-item">
              <button
                type="button"
                className="mn-footer-accordion-btn"
                aria-expanded={footerOpen === col.title}
                onClick={() => setFooterOpen((o) => o === col.title ? null : col.title)}
              >
                <span className="mn-footer-accordion-title">{col.title}</span>
                <span aria-hidden="true" style={{
                  color: "oklch(0.955 0.012 70 / 0.60)",
                  transition: "transform 0.15s",
                  transform: footerOpen === col.title ? "rotate(45deg)" : "none",
                }}>+</span>
              </button>
              {footerOpen === col.title && (
                <ul className="mn-footer-accordion-list">
                  {col.links.map((l) => (
                    <li key={l.label}>
                      <a href={l.href} className="mn-footer-link">{l.label}</a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>

        <div className="mn-footer-bar">
          <span>NADINE © 2026</span>
          <span>Fashion that reads you.</span>
        </div>
      </footer>
    </main>
  );
}
