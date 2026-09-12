// nAia Admin — root layout shell.
//
// Lives at /app/naia-admin/* inside the Shopify embedded Admin frame.
// Auth: requireNaiaAdminAccess — completely separate from NADINE Designer
//       Intelligence (requireStaffAccess). Different env vars, different gate.
//
// Phase 2: Closet Intelligence is active.
//          Other nav sections are present but disabled ("coming soon").

import { Outlet, NavLink, useNavigation } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { requireNaiaAdminAccess } from "~/lib/naia-admin-auth.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await requireNaiaAdminAccess(request);
  return null;
}

// ── Nav structure ─────────────────────────────────────────────────────────────

const NAV_ITEMS: Array<{
  label: string;
  to?: string;
  active: boolean;
  phase?: string;
}> = [
  { label: "Overview",           active: false, phase: "Phase 3" },
  { label: "Customers",          active: false, phase: "Phase 3" },
  { label: "Closet Intelligence", to: "/app/naia-admin/closet", active: true },
  { label: "StyleMe QA",         active: false, phase: "Phase 3" },
  { label: "Feedback & Outcomes", active: false, phase: "Phase 3" },
  { label: "Feature Usage",      active: false, phase: "Phase 3" },
];

export default function NaiaAdminLayout() {
  const navigation = useNavigation();
  const loading = navigation.state !== "idle";

  return (
    <div className="naia-admin-shell">
      <nav className="naia-admin-nav" aria-label="nAia Admin">
        <div className="naia-admin-nav__brand">
          <span className="naia-admin-nav__logo">nAia Admin</span>
          <span className="naia-admin-nav__badge">Internal</span>
        </div>
        <ul className="naia-admin-nav__links" role="list">
          {NAV_ITEMS.map((item) =>
            item.active && item.to ? (
              <li key={item.label}>
                <NavLink
                  to={item.to}
                  className={({ isActive }) =>
                    `naia-admin-nav__link${isActive ? " naia-admin-nav__link--active" : ""}`
                  }
                >
                  {item.label}
                </NavLink>
              </li>
            ) : (
              <li key={item.label}>
                <span
                  className="naia-admin-nav__link naia-admin-nav__link--disabled"
                  title={item.phase ? `Coming in ${item.phase}` : "Coming soon"}
                  aria-disabled="true"
                >
                  {item.label}
                  {item.phase && (
                    <span className="naia-admin-nav__soon">{item.phase}</span>
                  )}
                </span>
              </li>
            ),
          )}
        </ul>
      </nav>

      {loading && (
        <div className="naia-admin-loader" role="status" aria-label="Loading…" />
      )}

      <main className="naia-admin-main" id="main-content">
        <Outlet />
      </main>

      <style>{ADMIN_CSS}</style>
    </div>
  );
}

// ── Inline admin CSS ──────────────────────────────────────────────────────────

const ADMIN_CSS = `
  *, *::before, *::after { box-sizing: border-box; }

  .naia-admin-shell {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 14px;
    color: #111;
    min-height: 100vh;
    background: #f4f5f7;
    display: flex;
    flex-direction: column;
  }

  /* ── Nav ── */
  .naia-admin-nav {
    background: #16213e;
    color: #fff;
    display: flex;
    align-items: center;
    gap: 2rem;
    padding: 0 1.5rem;
    height: 52px;
    position: sticky;
    top: 0;
    z-index: 200;
    flex-shrink: 0;
    box-shadow: 0 1px 3px rgba(0,0,0,0.3);
  }

  .naia-admin-nav__brand {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-shrink: 0;
  }

  .naia-admin-nav__logo {
    font-weight: 700;
    font-size: 15px;
    letter-spacing: 0.04em;
    color: #d4a843;
    white-space: nowrap;
  }

  .naia-admin-nav__badge {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    background: #2a3f6f;
    color: #8ba3d4;
    padding: 0.15rem 0.4rem;
    border-radius: 3px;
  }

  .naia-admin-nav__links {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    gap: 0.15rem;
    flex: 1;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .naia-admin-nav__links::-webkit-scrollbar { display: none; }

  .naia-admin-nav__link {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.35rem 0.7rem;
    color: #9baac0;
    text-decoration: none;
    border-radius: 4px;
    font-size: 13px;
    white-space: nowrap;
    transition: background 0.12s, color 0.12s;
    cursor: pointer;
    user-select: none;
  }

  .naia-admin-nav__link:not(.naia-admin-nav__link--disabled):hover {
    background: rgba(255,255,255,0.07);
    color: #e2e8f0;
  }

  .naia-admin-nav__link--active {
    background: rgba(212,168,67,0.15) !important;
    color: #d4a843 !important;
    font-weight: 600;
  }

  .naia-admin-nav__link--disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .naia-admin-nav__soon {
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    background: #1e3a5f;
    color: #5a8dc0;
    padding: 0.1rem 0.3rem;
    border-radius: 2px;
  }

  /* ── Loading bar ── */
  .naia-admin-loader {
    height: 2px;
    background: linear-gradient(90deg, transparent 0%, #d4a843 50%, transparent 100%);
    background-size: 200% 100%;
    animation: naia-sweep 1s linear infinite;
    flex-shrink: 0;
  }

  @keyframes naia-sweep {
    0%   { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }

  /* ── Main content ── */
  .naia-admin-main {
    flex: 1;
    padding: 1.5rem;
    max-width: 1440px;
    width: 100%;
    margin: 0 auto;
  }

  /* ── Shared card ── */
  .na-card {
    background: #fff;
    border: 1px solid #dde1e7;
    border-radius: 8px;
    overflow: hidden;
    margin-bottom: 1.25rem;
  }

  .na-card__header {
    padding: 0.875rem 1.25rem;
    border-bottom: 1px solid #dde1e7;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    background: #fafbfc;
  }

  .na-card__title {
    font-size: 13px;
    font-weight: 700;
    margin: 0;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #374151;
  }

  .na-card__subtitle {
    font-size: 12px;
    color: #6b7280;
  }

  .na-card__body {
    padding: 1.25rem;
  }

  /* ── Status badges ── */
  .na-badge {
    display: inline-block;
    padding: 0.2rem 0.55rem;
    border-radius: 3px;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    white-space: nowrap;
  }

  /* Analysis status */
  .na-badge--ready        { background: #dcfce7; color: #14532d; }
  .na-badge--failed       { background: #fee2e2; color: #7f1d1d; }
  .na-badge--pending      { background: #fef9c3; color: #713f12; }
  .na-badge--not-analyzed { background: #f3f4f6; color: #374151; }

  /* Review status */
  .na-badge--ai-only    { background: #f3f4f6; color: #4b5563; }
  .na-badge--reviewed   { background: #dbeafe; color: #1e3a8a; }
  .na-badge--overridden { background: #ede9fe; color: #4c1d95; }

  /* Confidence */
  .na-badge--high   { background: #dcfce7; color: #14532d; }
  .na-badge--medium { background: #fef9c3; color: #713f12; }
  .na-badge--low    { background: #fee2e2; color: #7f1d1d; }

  /* Warning */
  .na-badge--warn   { background: #fff3cd; color: #7d5f00; }

  /* ── Confidence inline ── */
  .na-conf {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 12px;
  }

  .na-conf__dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .na-conf__dot--high   { background: #16a34a; }
  .na-conf__dot--medium { background: #ca8a04; }
  .na-conf__dot--low    { background: #dc2626; }
  .na-conf__dot--none   { background: #d1d5db; }

  /* ── Table ── */
  .na-table-wrap { overflow-x: auto; }

  .na-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }

  .na-table th {
    text-align: left;
    padding: 0.55rem 0.875rem;
    background: #f8f9fa;
    border-bottom: 2px solid #dde1e7;
    font-weight: 700;
    color: #374151;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    white-space: nowrap;
  }

  .na-table td {
    padding: 0.65rem 0.875rem;
    border-bottom: 1px solid #f0f1f3;
    vertical-align: middle;
  }

  .na-table tr:last-child td { border-bottom: none; }

  .na-table tbody tr:hover td { background: #fafbfc; }

  .na-table a {
    color: #1d4ed8;
    text-decoration: none;
    font-weight: 500;
  }

  .na-table a:hover { text-decoration: underline; }

  .na-thumb {
    width: 36px;
    height: 36px;
    object-fit: cover;
    border-radius: 4px;
    background: #f3f4f6;
    display: block;
  }

  .na-thumb--placeholder {
    width: 36px;
    height: 36px;
    background: #f3f4f6;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #9ca3af;
    font-size: 16px;
  }

  /* ── Filters bar ── */
  .na-filters {
    display: flex;
    gap: 0.65rem;
    flex-wrap: wrap;
    align-items: flex-end;
    padding: 1rem 1.25rem;
    border-bottom: 1px solid #dde1e7;
    background: #f8f9fa;
  }

  .na-filter-group {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  .na-filter-group label {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #6b7280;
  }

  .na-filter-group select,
  .na-filter-group input[type="search"],
  .na-filter-group input[type="text"] {
    height: 30px;
    padding: 0 0.5rem;
    border: 1px solid #d1d5db;
    border-radius: 5px;
    font-size: 12px;
    background: #fff;
    color: #111;
    min-width: 130px;
  }

  .na-filter-group input[type="search"] { min-width: 200px; }

  .na-filter-checkbox {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    height: 30px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
  }

  .na-filter-actions {
    display: flex;
    gap: 0.5rem;
    align-self: flex-end;
  }

  .na-filter-btn {
    height: 30px;
    padding: 0 0.875rem;
    background: #16213e;
    color: #fff;
    border: none;
    border-radius: 5px;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    white-space: nowrap;
  }

  .na-filter-btn:hover { background: #1e2f5c; }

  .na-filter-btn--secondary {
    background: #fff;
    color: #374151;
    border: 1px solid #d1d5db;
  }

  .na-filter-btn--secondary:hover { background: #f3f4f6; }

  /* ── Pagination ── */
  .na-pagination {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1.25rem;
    border-top: 1px solid #dde1e7;
    font-size: 12px;
    color: #6b7280;
  }

  .na-pagination__controls { display: flex; gap: 0.5rem; }

  .na-pagination__btn {
    padding: 0.3rem 0.75rem;
    border: 1px solid #d1d5db;
    border-radius: 5px;
    background: #fff;
    font-size: 12px;
    cursor: pointer;
    color: #374151;
    text-decoration: none;
    display: inline-block;
    white-space: nowrap;
  }

  .na-pagination__btn:hover { background: #f3f4f6; }
  .na-pagination__btn[aria-disabled="true"] { opacity: 0.35; pointer-events: none; }

  /* ── Detail layout ── */
  .na-detail-grid {
    display: grid;
    grid-template-columns: 260px 1fr;
    gap: 1.25rem;
    align-items: start;
  }

  @media (max-width: 900px) { .na-detail-grid { grid-template-columns: 1fr; } }

  .na-detail-sidebar, .na-detail-main { display: flex; flex-direction: column; }

  /* ── Item image ── */
  .na-item-img {
    width: 100%;
    aspect-ratio: 3/4;
    object-fit: cover;
    display: block;
    background: #f3f4f6;
  }

  .na-item-img--placeholder {
    aspect-ratio: 3/4;
    background: #f3f4f6;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    gap: 0.5rem;
    color: #9ca3af;
    font-size: 12px;
  }

  /* ── Field table ── */
  .na-field-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }

  .na-field-table tr { border-bottom: 1px solid #f0f1f3; }
  .na-field-table tr:last-child { border-bottom: none; }

  .na-field-table th {
    width: 38%;
    text-align: left;
    padding: 0.45rem 0.875rem;
    font-weight: 600;
    color: #6b7280;
    background: #fafbfc;
    white-space: nowrap;
    vertical-align: top;
  }

  .na-field-table td {
    padding: 0.45rem 0.875rem;
    color: #111;
    word-break: break-word;
    vertical-align: top;
  }

  /* ── Provenance sections ── */
  .na-provenance-label {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #6b7280;
    margin: 0 0 0.75rem;
    padding: 0 0 0.4rem;
    border-bottom: 1px solid #e5e7ea;
  }

  .na-provenance-unavailable {
    background: #fffbeb;
    border: 1px solid #f59e0b;
    border-radius: 6px;
    padding: 0.875rem 1rem;
    font-size: 13px;
    color: #92400e;
  }

  /* ── JSON debug section ── */
  .na-json-expand {
    background: none;
    border: 1px solid #d1d5db;
    border-radius: 4px;
    padding: 0.3rem 0.6rem;
    font-size: 11px;
    color: #6b7280;
    cursor: pointer;
    margin-top: 0.75rem;
  }

  .na-json-expand:hover { background: #f3f4f6; }

  .na-json-pre {
    background: #f8f9fa;
    border: 1px solid #e5e7ea;
    border-radius: 5px;
    padding: 0.75rem;
    overflow: auto;
    font-size: 11px;
    line-height: 1.5;
    margin: 0.5rem 0 0;
    max-height: 280px;
  }

  /* ── Snapshot history ── */
  .na-snapshot-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.55rem 0;
    border-bottom: 1px solid #f0f1f3;
    font-size: 12px;
    gap: 1rem;
  }

  .na-snapshot-row:last-child { border-bottom: none; }

  /* ── Back link / page heading ── */
  .na-back {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    color: #6b7280;
    font-size: 12px;
    text-decoration: none;
    margin-bottom: 0.875rem;
  }

  .na-back:hover { color: #111; }

  .na-page-heading {
    font-size: 20px;
    font-weight: 700;
    margin: 0 0 1.25rem;
    color: #111;
    line-height: 1.2;
  }

  /* ── Empty / null states ── */
  .na-null {
    color: #9ca3af;
    font-style: italic;
    font-size: 12px;
  }

  .na-empty {
    text-align: center;
    padding: 3rem 1rem;
    color: #9ca3af;
    font-size: 13px;
  }

  /* ── Tag chips ── */
  .na-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }

  .na-chip {
    background: #f3f4f6;
    border-radius: 3px;
    padding: 0.1rem 0.35rem;
    font-size: 11px;
    font-family: monospace;
    color: #374151;
    white-space: nowrap;
  }

  /* ── Icons (text-based) ── */
  .na-warn-icon { color: #f59e0b; }
  .na-ok-icon   { color: #16a34a; }
`;
