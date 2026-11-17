import { useState } from "react";
import { Form, Link, useLocation } from "react-router";
import { useClerk } from "@clerk/react-router";
import { STOREFRONT_ORIGIN, STOREFRONT_NAV } from "~/lib/storefront-config";

type NavItem = { to: string; label: string; exact?: boolean; logout?: boolean };
type NavGroup = { title: string; items: NavItem[] };

const MY_NAIA_NAV: NavGroup[] = [
  {
    title: "Main",
    items: [
      { to: "/my-naia", label: "Overview", exact: true },
      { to: "/passport", label: "Style Passport" },
      { to: "/closet", label: "My Closet", exact: true },
      { to: "/closet/intelligence", label: "Wardrobe Intelligence" },
      { to: "/style-me", label: "StyleMe" },
      { to: "/buyskip", label: "Buy or Skip" },
      { to: "/trends/my-edits", label: "My Trend Edits" },
    ],
  },
  {
    title: "Personalisation",
    items: [
      { to: "/my-naia-model", label: "My nAia Model" },
      // The Noticing nav item moved into Style Passport (/passport#noticing) —
      // no longer a standalone nav destination. See passport.tsx's section.
    ],
  },
  {
    title: "Account",
    items: [
      { to: "/my-naia/plan-usage", label: "Plan & Usage" },
      // Legal handoff W2/Decision 2 (2026-11-17): the EU withdrawal-request
      // mechanism (my-naia.withdrawal-request.tsx) had no discoverable link
      // anywhere in the app — a customer would need to already know the
      // exact URL. "Clearly accessible during the withdrawal period" is an
      // explicit requirement; this is that access point.
      { to: "/my-naia/withdrawal-request", label: "Withdrawal Request" },
      { to: "/settings", label: "Settings & Privacy" },
      { to: "/auth/logout", label: "Sign Out", logout: true },
    ],
  },
];

function isActive(pathname: string, item: NavItem) {
  if (!item.to || item.logout) return false;
  return item.exact ? pathname === item.to : pathname.startsWith(item.to);
}


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
      // Wishlist has no backing data model yet (WishlistItem doesn't exist
      // in schema) — same "real feature, not built yet" situation as
      // Privacy/Terms below, so it gets the same honest treatment.
      { label: "Wishlist", href: "#", pending: true },
    ],
  },
  {
    title: "legal",
    links: [
      // Priority 5 (2026-10-19): these two carry real legal/compliance
      // weight — a customer clicking "Privacy Policy" or "Terms of
      // Service" and landing nowhere reads as those documents existing
      // when they don't. Marked pending so they render as plain, honest
      // text rather than a dead link that looks complete.
      //
      // 2026-11-13: Accessibility and Cookie Preferences carry the same
      // weight — "Accessibility" rendered as a dead link is a particularly
      // bad look to ship — so they now get the identical treatment rather
      // than being left as silent `#` links.
      { label: "Privacy Policy", href: "#", pending: true },
      { label: "Terms of Service", href: "#", pending: true },
      { label: "Accessibility", href: "#", pending: true },
      { label: "Cookie Preferences", href: "#", pending: true },
    ],
  },
  {
    title: "follow",
    links: [
      // 2026-11-13, revised same day: unlike Privacy/Terms/Accessibility/
      // Cookie Preferences/Wishlist above, there's no basis here to claim
      // these are "coming soon" — that's a business fact outside this
      // change's visibility, and asserting it would be its own kind of
      // invented promise. suffix: "" keeps the same non-clickable
      // treatment (reduced opacity, no cursor) without the claim — just
      // the label, honestly inert, until there's a real link or a real
      // decision to remove the item.
      { label: "Instagram", href: "#", pending: true, suffix: "" },
      { label: "TikTok", href: "#", pending: true, suffix: "" },
      { label: "Press", href: "#", pending: true, suffix: "" },
    ],
  },
];

// Pending footer links default to "— coming soon" (Privacy Policy, Terms
// of Service, Accessibility, Cookie Preferences, Wishlist — all real,
// planned work). An explicit suffix: "" opts out of that claim for items
// where "coming soon" isn't a fact this codebase can vouch for (see
// "follow" above) — the item still renders non-clickable, just without
// asserting a timeline.
//
// Inlined at each call site rather than factored into a typed helper:
// FOOTER_COLS's per-column literal shapes don't unify into one type TS
// can narrow cleanly across a function-call boundary, and typing that
// properly isn't worth it for two call sites doing one property read.
function footerPendingSuffix(link: Record<string, unknown>): string | null {
  const suffix = "suffix" in link ? (link.suffix as string) : "— coming soon";
  return suffix ? suffix : null;
}

interface Props {
  children: React.ReactNode;
  compact?: boolean;
}

export default function MyNaiaLayout({ children, compact = false }: Props) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [footerOpen, setFooterOpen] = useState<string | null>("customer care");
  const { pathname } = useLocation();
  const { signOut } = useClerk();

  // 2026-11-12 fix (fix/stripe-clerk-phase1-security): /auth/logout's own
  // action only ever cleared the legacy NaiaSession/__naia_tok cookie — it
  // has no way to end a Clerk session, since that's managed through Clerk's
  // own Frontend API, not a cookie this server can simply clear. Without
  // this, a customer authenticated via Clerk who clicked "Sign Out" kept
  // their Clerk session alive in that browser. signOut() here ends it for
  // real (invalidating it server-side via Clerk, not just a client cookie
  // wipe) before the existing POST still runs, unchanged, for the legacy
  // cleanup. form.submit() bypasses React's onSubmit entirely, so this
  // can't recurse back into itself.
  async function signOutThenSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      await signOut();
    } catch {
      // Clerk sign-out failing must never block local sign-out — the
      // POST below is what actually matters for this app's own session.
    }
    form.submit();
  }

  return (
    <main className="mn-page">
      {/* ── Site-level header (NADINE brand) — parity with nadine-storefront SiteNav ── */}
      <header className="mn-sitenav">
        <div className="mn-sitenav-inner">
          <nav className="mn-sitenav-links" aria-label="Site navigation">
            {STOREFRONT_NAV.map((l) => (
              <a key={l.path} href={`${STOREFRONT_ORIGIN}${l.path}`} className="mn-sitenav-link">
                {l.label}
              </a>
            ))}
            <Link to="/trends" className="mn-sitenav-link">TREND REPORTS</Link>
          </nav>

          <a href={`${STOREFRONT_ORIGIN}/`} className="mn-sitenav-wordmark">
            NADINE
          </a>

          <div className="mn-sitenav-actions">
            <a href={STOREFRONT_ORIGIN} aria-label="search" className="mn-sitenav-icon-link">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/>
              </svg>
            </a>
            <a href={STOREFRONT_ORIGIN} aria-label="wishlist" className="mn-sitenav-icon-link">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5"/>
              </svg>
            </a>
            <Link to="/my-naia" aria-label="My nAia account" className="mn-sitenav-icon-link">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M18 20a6 6 0 0 0-12 0"/><circle cx="12" cy="10" r="4"/><circle cx="12" cy="12" r="10"/>
              </svg>
            </Link>
            <a href={STOREFRONT_ORIGIN} aria-label="bag" className="mn-sitenav-icon-link">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M16 10a4 4 0 0 1-8 0"/><path d="M3.103 6.034h17.794"/><path d="M3.4 5.467a2 2 0 0 0-.4 1.2V20a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6.667a2 2 0 0 0-.4-1.2l-2-2.667A2 2 0 0 0 17 2H7a2 2 0 0 0-1.6.8z"/>
              </svg>
            </a>
          </div>
        </div>
      </header>

      {/* ── MY nAia. heading — suppressed in compact (feature-page) mode ── */}
      {!compact && (
        <section className="mn-page-head">
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
                    if (item.logout) {
                      return (
                        <li key={item.to}>
                          <Form method="post" action="/auth/logout" reloadDocument onSubmit={signOutThenSubmit} style={{ display: "contents" }}>
                            <button
                              type="submit"
                              onClick={() => setMobileOpen(false)}
                              className="mn-mobile-nav-link mn-nav-button-reset"
                            >
                              {item.label}
                            </button>
                          </Form>
                        </li>
                      );
                    }
                    const active = isActive(pathname, item);
                    return (
                      <li key={item.to}>
                        <Link
                          to={item.to}
                          onClick={() => setMobileOpen(false)}
                          className={["mn-mobile-nav-link", active ? "mn-active" : ""].join(" ")}
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
                      if (item.logout) {
                        return (
                          <li key={item.to} className="mn-sidebar-nav-item">
                            <Form method="post" action="/auth/logout" reloadDocument onSubmit={signOutThenSubmit} style={{ display: "contents" }}>
                              <button type="submit" className="mn-sidebar-nav-link mn-nav-button-reset">
                                <span className="mn-sidebar-nav-line" aria-hidden="true" />
                                {item.label}
                              </button>
                            </Form>
                          </li>
                        );
                      }
                      const active = isActive(pathname, item);
                      return (
                        <li key={item.to} className="mn-sidebar-nav-item">
                          <Link
                            to={item.to}
                            className={["mn-sidebar-nav-link", active ? "mn-active" : ""].join(" ")}
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
                    {"pending" in l && l.pending ? (
                      <span className="mn-footer-link" style={{ opacity: 0.55, cursor: "default" }}>
                        {l.label}{footerPendingSuffix(l) ? <> <em style={{ fontStyle: "normal", fontSize: "0.85em" }}>{footerPendingSuffix(l)}</em></> : null}
                      </span>
                    ) : (
                      <a href={l.href} className="mn-footer-link">{l.label}</a>
                    )}
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
                aria-controls={`mn-footer-panel-${col.title.replace(/\s+/g, "-")}`}
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
                <ul className="mn-footer-accordion-list" id={`mn-footer-panel-${col.title.replace(/\s+/g, "-")}`}>
                  {col.links.map((l) => (
                    <li key={l.label}>
                      {"pending" in l && l.pending ? (
                        <span className="mn-footer-link" style={{ opacity: 0.55, cursor: "default" }}>
                          {l.label}{footerPendingSuffix(l) ? <> <em style={{ fontStyle: "normal", fontSize: "0.85em" }}>{footerPendingSuffix(l)}</em></> : null}
                        </span>
                      ) : (
                        <a href={l.href} className="mn-footer-link">{l.label}</a>
                      )}
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
