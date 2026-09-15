// app/routes/admin.naia.tsx
//
// nAia Admin workspace shell.
// Auth is inherited from admin.tsx parent — no independent auth call needed.
// Nav items: most are placeholders until their respective phases ship.

import { Outlet, NavLink, useNavigation } from "react-router";

const NAV_ITEMS: Array<{
  label: string;
  to?: string;
  active: boolean;
  phase?: string;
}> = [
  { label: "Closet Intelligence", to: "/admin/naia/closet", active: true },
  { label: "StyleMe QA",          to: "/admin/naia/styleme", active: false, phase: "Phase 4" },
  { label: "Customers",           active: false, phase: "Phase 3" },
  { label: "Feedback",            active: false, phase: "Phase 5" },
  { label: "Usage",               active: false, phase: "Phase 5" },
];

export default function NaiaAdminWorkspace() {
  const navigation = useNavigation();
  const loading = navigation.state !== "idle";

  return (
    <div className="naia-admin-shell">
      <nav className="naia-admin-nav" aria-label="nAia Admin">
        <div className="naia-admin-nav__brand">
          <span className="naia-admin-nav__logo">nAia Admin</span>
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

      <main className="naia-admin-main" id="naia-admin-main">
        <Outlet />
      </main>

      <style>{NAIA_ADMIN_CSS}</style>
    </div>
  );
}

// CSS ported from app.naia-admin.tsx — paths and scope unchanged.
const NAIA_ADMIN_CSS = `
  .naia-admin-shell {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 14px;
    color: #111;
    min-height: calc(100vh - 52px);
    background: #f4f5f7;
    display: flex;
    flex-direction: column;
  }

  .naia-admin-nav {
    background: #1e2f5c;
    color: #fff;
    display: flex;
    align-items: center;
    gap: 2rem;
    padding: 0 1.5rem;
    height: 44px;
    flex-shrink: 0;
    border-bottom: 1px solid rgba(255,255,255,0.06);
  }

  .naia-admin-nav__brand {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-shrink: 0;
  }

  .naia-admin-nav__logo {
    font-weight: 700;
    font-size: 13px;
    letter-spacing: 0.05em;
    color: #d4a843;
    white-space: nowrap;
    text-transform: uppercase;
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
    padding: 0.3rem 0.65rem;
    color: #9baac0;
    text-decoration: none;
    border-radius: 4px;
    font-size: 12px;
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

  .na-card__subtitle { font-size: 12px; color: #6b7280; }
  .na-card__body { padding: 1.25rem; }

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

  .na-badge--ready        { background: #dcfce7; color: #14532d; }
  .na-badge--failed       { background: #fee2e2; color: #7f1d1d; }
  .na-badge--pending      { background: #fef9c3; color: #713f12; }
  .na-badge--not-analyzed { background: #f3f4f6; color: #374151; }
  .na-badge--ai-only      { background: #f3f4f6; color: #4b5563; }
  .na-badge--reviewed     { background: #dbeafe; color: #1e3a8a; }
  .na-badge--overridden   { background: #ede9fe; color: #4c1d95; }
  .na-badge--high         { background: #dcfce7; color: #14532d; }
  .na-badge--medium       { background: #fef9c3; color: #713f12; }
  .na-badge--low          { background: #fee2e2; color: #7f1d1d; }
  .na-badge--warn         { background: #fff3cd; color: #7d5f00; }

  /* ── Confidence inline ── */
  .na-conf { display: inline-flex; align-items: center; gap: 0.35rem; font-size: 12px; }
  .na-conf__dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
  .na-conf__dot--high   { background: #16a34a; }
  .na-conf__dot--medium { background: #ca8a04; }
  .na-conf__dot--low    { background: #dc2626; }
  .na-conf__dot--none   { background: #d1d5db; }

  /* ── Table ── */
  .na-table-wrap { overflow-x: auto; }

  .na-table { width: 100%; border-collapse: collapse; font-size: 13px; }

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
  .na-table a { color: #1d4ed8; text-decoration: none; font-weight: 500; }
  .na-table a:hover { text-decoration: underline; }

  .na-thumb { width: 36px; height: 36px; object-fit: cover; border-radius: 4px; background: #f3f4f6; display: block; }
  .na-thumb--placeholder { width: 36px; height: 36px; background: #f3f4f6; border-radius: 4px; display: flex; align-items: center; justify-content: center; color: #9ca3af; font-size: 16px; }

  /* ── Filters bar ── */
  .na-filters { display: flex; gap: 0.65rem; flex-wrap: wrap; align-items: flex-end; padding: 1rem 1.25rem; border-bottom: 1px solid #dde1e7; background: #f8f9fa; }
  .na-filter-group { display: flex; flex-direction: column; gap: 0.2rem; }
  .na-filter-group label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #6b7280; }
  .na-filter-group select, .na-filter-group input[type="search"], .na-filter-group input[type="text"] { height: 30px; padding: 0 0.5rem; border: 1px solid #d1d5db; border-radius: 5px; font-size: 12px; background: #fff; color: #111; min-width: 130px; }
  .na-filter-group input[type="search"] { min-width: 200px; }
  .na-filter-checkbox { display: flex; align-items: center; gap: 0.35rem; height: 30px; font-size: 12px; font-weight: 500; cursor: pointer; white-space: nowrap; }
  .na-filter-actions { display: flex; gap: 0.5rem; align-self: flex-end; }
  .na-filter-btn { height: 30px; padding: 0 0.875rem; background: #16213e; color: #fff; border: none; border-radius: 5px; font-size: 12px; font-weight: 700; cursor: pointer; white-space: nowrap; text-decoration: none; display: inline-flex; align-items: center; }
  .na-filter-btn:hover { background: #1e2f5c; }
  .na-filter-btn--secondary { background: #fff; color: #374151; border: 1px solid #d1d5db; }
  .na-filter-btn--secondary:hover { background: #f3f4f6; }

  /* ── Pagination ── */
  .na-pagination { display: flex; align-items: center; justify-content: space-between; padding: 0.75rem 1.25rem; border-top: 1px solid #dde1e7; font-size: 12px; color: #6b7280; }
  .na-pagination__controls { display: flex; gap: 0.5rem; }
  .na-pagination__btn { padding: 0.3rem 0.75rem; border: 1px solid #d1d5db; border-radius: 5px; background: #fff; font-size: 12px; cursor: pointer; color: #374151; text-decoration: none; display: inline-block; white-space: nowrap; }
  .na-pagination__btn:hover { background: #f3f4f6; }
  .na-pagination__btn[aria-disabled="true"] { opacity: 0.35; pointer-events: none; }

  /* ── Detail layout ── */
  .na-detail-grid { display: grid; grid-template-columns: 260px 1fr; gap: 1.25rem; align-items: start; }
  @media (max-width: 900px) { .na-detail-grid { grid-template-columns: 1fr; } }
  .na-detail-sidebar, .na-detail-main { display: flex; flex-direction: column; }

  .na-item-img { width: 100%; aspect-ratio: 3/4; object-fit: cover; display: block; background: #f3f4f6; }
  .na-item-img--placeholder { aspect-ratio: 3/4; background: #f3f4f6; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 0.5rem; color: #9ca3af; font-size: 12px; }

  .na-field-table { width: 100%; border-collapse: collapse; font-size: 12px; }
  .na-field-table tr { border-bottom: 1px solid #f0f1f3; }
  .na-field-table tr:last-child { border-bottom: none; }
  .na-field-table th { width: 38%; text-align: left; padding: 0.45rem 0.875rem; font-weight: 600; color: #6b7280; background: #fafbfc; white-space: nowrap; vertical-align: top; }
  .na-field-table td { padding: 0.45rem 0.875rem; color: #111; word-break: break-word; vertical-align: top; }

  .na-provenance-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #6b7280; margin: 0 0 0.75rem; padding: 0 0 0.4rem; border-bottom: 1px solid #e5e7ea; }
  .na-provenance-unavailable { background: #fffbeb; border: 1px solid #f59e0b; border-radius: 6px; padding: 0.875rem 1rem; font-size: 13px; color: #92400e; }

  .na-json-expand { background: none; border: 1px solid #d1d5db; border-radius: 4px; padding: 0.3rem 0.6rem; font-size: 11px; color: #6b7280; cursor: pointer; margin-top: 0.75rem; }
  .na-json-expand:hover { background: #f3f4f6; }
  .na-json-pre { background: #f8f9fa; border: 1px solid #e5e7ea; border-radius: 5px; padding: 0.75rem; overflow: auto; font-size: 11px; line-height: 1.5; margin: 0.5rem 0 0; max-height: 280px; }

  .na-snapshot-row { display: flex; justify-content: space-between; align-items: center; padding: 0.55rem 0; border-bottom: 1px solid #f0f1f3; font-size: 12px; gap: 1rem; }
  .na-snapshot-row:last-child { border-bottom: none; }

  .na-back { display: inline-flex; align-items: center; gap: 0.25rem; color: #6b7280; font-size: 12px; text-decoration: none; margin-bottom: 0.875rem; }
  .na-back:hover { color: #111; }

  .na-page-heading { font-size: 20px; font-weight: 700; margin: 0 0 1.25rem; color: #111; line-height: 1.2; }

  .na-null { color: #9ca3af; font-style: italic; font-size: 12px; }
  .na-empty { text-align: center; padding: 3rem 1rem; color: #9ca3af; font-size: 13px; }

  .na-chips { display: flex; flex-wrap: wrap; gap: 0.25rem; }
  .na-chip { background: #f3f4f6; border-radius: 3px; padding: 0.1rem 0.35rem; font-size: 11px; font-family: monospace; color: #374151; white-space: nowrap; }

  .na-warn-icon { color: #f59e0b; }
  .na-ok-icon   { color: #16a34a; }

  /* ── Section 1: HOW nAia READS THIS PIECE ── */
  .na-interp-labels { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 1.25rem; }
  .na-interp-label  { background: #16213e; color: #fff; padding: 0.45rem 1rem; border-radius: 20px; font-size: 13px; font-weight: 600; letter-spacing: 0.02em; }
  .na-interp-empty  { margin: 0; font-size: 13px; color: #9ca3af; font-style: italic; }
  .na-interp-why-group { display: flex; flex-direction: column; gap: 0.4rem; margin-top: 0.25rem; }
  .na-interp-why-row  { display: flex; align-items: baseline; gap: 0.5rem; font-size: 12px; line-height: 1.5; }
  .na-interp-why-lbl  { font-weight: 600; color: #111; min-width: 120px; flex-shrink: 0; }
  .na-interp-why-arr  { color: #9ca3af; flex-shrink: 0; }
  .na-interp-why-evid { color: #6b7280; }

  /* ── Section 2: WHAT AI SEES ── */
  .na-what-grid { display: grid; grid-template-columns: 140px 1fr; gap: 0; align-items: start; }
  .na-what-key  { font-size: 11px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em; padding: 0.5rem 1rem; background: #fafbfc; border-bottom: 1px solid #f0f1f3; }
  .na-what-val  { font-size: 12px; color: #111; padding: 0.5rem 1rem; border-bottom: 1px solid #f0f1f3; word-break: break-word; }

  /* ── Section 3: TECHNICAL ── */
  .na-tech-section  { border-top: 1px solid #f0f1f3; }
  .na-tech-section:first-child { border-top: none; }
  .na-tech-summary  { list-style: none; display: flex; align-items: center; gap: 0.5rem; padding: 0.75rem 1.25rem; font-size: 12px; font-weight: 600; color: #374151; cursor: pointer; user-select: none; }
  .na-tech-summary::-webkit-details-marker { display: none; }
  .na-tech-summary::before { content: "▶"; font-size: 10px; color: #9ca3af; transition: transform 0.15s; }
  details[open] > .na-tech-summary::before { transform: rotate(90deg); }
  .na-tech-body     { padding: 0.75rem 1.25rem 1rem; background: #fafbfc; border-top: 1px solid #f0f1f3; }

  /* ── Card subtitle ── */
  .na-card__subtitle { font-size: 11px; color: #9ca3af; font-weight: 400; }

  /* ── Phase 3A: Teach nAia ── */
  .na-teach-card { border-left: 3px solid #6366f1; }
  .na-teach-actions { display: flex; gap: 0.75rem; flex-wrap: wrap; margin-bottom: 0.75rem; }
  .na-teach-note { margin: 1rem 0 0; font-size: 12px; color: #6366f1; }
  .na-teach-error { margin: 0.5rem 0 0; font-size: 12px; color: #dc2626; background: #fef2f2; padding: 0.4rem 0.75rem; border-radius: 4px; }
  .na-teach-ok { margin: 0.5rem 0 0; font-size: 12px; color: #16a34a; }

  /* Buttons */
  .na-btn { cursor: pointer; border: none; border-radius: 6px; font-size: 13px; font-weight: 500; padding: 0.45rem 1rem; transition: opacity 0.15s; }
  .na-btn:hover { opacity: 0.85; }
  .na-btn--primary { background: #16213e; color: #fff; }
  .na-btn--secondary { background: #f0fdf4; color: #15803d; border: 1px solid #bbf7d0; }
  .na-btn--outline { background: #fff; color: #374151; border: 1px solid #d1d5db; }
  .na-btn-revert { cursor: pointer; background: none; border: 1px solid #e9d5ff; color: #7c3aed; border-radius: 4px; font-size: 11px; padding: 0.15rem 0.5rem; }
  .na-btn-revert:hover { background: #f5f3ff; }

  /* Override indicator in Section 2 */
  .na-ov-badge { background: #ede9fe; color: #4c1d95; border-radius: 3px; font-size: 10px; font-weight: 600; padding: 0.1rem 0.35rem; margin-right: 0.35rem; text-transform: uppercase; letter-spacing: 0.04em; }
  .na-ov-stored { font-size: 11px; color: #9ca3af; margin-left: 0.35rem; }

  /* Edit classification form */
  .na-edit-form { margin-top: 1.25rem; border-top: 1px solid #f0f1f3; padding-top: 1.25rem; }
  .na-edit-group-title { font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.08em; margin: 0 0 0.6rem; }
  .na-edit-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; }

  .na-edit-row { background: #fafbfc; border: 1px solid #f0f1f3; border-radius: 6px; padding: 0.6rem 0.75rem; display: flex; flex-direction: column; gap: 0.3rem; }
  .na-edit-row--overridden { border-color: #e9d5ff; background: #faf5ff; }
  .na-edit-row__check { display: flex; align-items: center; gap: 0.5rem; cursor: pointer; user-select: none; }
  .na-edit-row__label { font-size: 12px; font-weight: 500; color: #374151; }
  .na-edit-row__input { margin-top: 0.2rem; }
  .na-edit-row__revert { margin-top: 0.2rem; }

  .na-edit-input { width: 100%; font-size: 12px; border: 1px solid #d1d5db; border-radius: 4px; padding: 0.3rem 0.5rem; background: #fff; }
  .na-edit-input:disabled { background: #f9fafb; color: #9ca3af; }
  .na-edit-select { width: 100%; font-size: 12px; border: 1px solid #d1d5db; border-radius: 4px; padding: 0.3rem 0.4rem; background: #fff; }
  .na-edit-select:disabled { background: #f9fafb; color: #9ca3af; }

  /* Three-value display */
  .na-three-val { display: flex; align-items: center; gap: 0.4rem; font-size: 11px; margin-top: 0.2rem; flex-wrap: wrap; }
  .na-three-val__stored { color: #9ca3af; }
  .na-three-val__arr { color: #c4b5fd; }
  .na-three-val__corr { color: #7c3aed; font-weight: 500; }

  /* Checkbox sections for arrays */
  .na-edit-check-section { margin-top: 0.75rem; background: #fafbfc; border: 1px solid #f0f1f3; border-radius: 6px; padding: 0.6rem 0.75rem; }
  .na-edit-check-section:has(input[name^="override_"]:checked) { border-color: #e9d5ff; background: #faf5ff; }
  .na-edit-check-label { display: flex; align-items: center; gap: 0.5rem; cursor: pointer; font-size: 12px; font-weight: 500; color: #374151; user-select: none; }
  .na-edit-checkgroup { display: flex; flex-direction: column; gap: 0.3rem; margin-top: 0.5rem; }
  .na-edit-checkgroup--wrap { flex-direction: row; flex-wrap: wrap; gap: 0.4rem 1rem; }
  .na-edit-check-item { display: flex; align-items: center; gap: 0.35rem; font-size: 12px; color: #374151; cursor: pointer; user-select: none; }

  .na-edit-footer { margin-top: 1rem; display: flex; align-items: center; gap: 1rem; padding-top: 0.75rem; border-top: 1px solid #f0f1f3; }
  .na-edit-hint { font-size: 11px; color: #9ca3af; }

  /* ── Phase 3B: Review queue speed ── */

  /* Inline quick-approve button on list rows */
  .na-btn-quick-approve {
    cursor: pointer;
    background: #f0fdf4;
    color: #15803d;
    border: 1px solid #bbf7d0;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 700;
    padding: 0.1rem 0.45rem;
    line-height: 1.4;
    flex-shrink: 0;
    transition: background 0.1s;
  }
  .na-btn-quick-approve:hover:not(:disabled) { background: #dcfce7; }
  .na-btn-quick-approve:disabled { opacity: 0.5; cursor: default; }

  /* Queue next-item link (detail page header) */
  .na-btn-queue-next {
    display: inline-flex;
    align-items: center;
    padding: 0.3rem 0.875rem;
    background: #16213e;
    color: #fff;
    text-decoration: none;
    border-radius: 5px;
    font-size: 12px;
    font-weight: 600;
    transition: background 0.12s;
  }
  .na-btn-queue-next:hover { background: #1e2f5c; color: #fff; }

  /* Corrections view — read-only summary of active corrections */
  .na-corrections-view { margin-top: 0.75rem; border-top: 1px solid #f0f1f3; padding-top: 0.75rem; }
  .na-corrections-view__title { font-size: 11px; font-weight: 700; color: #7c3aed; text-transform: uppercase; letter-spacing: 0.08em; margin: 0 0 0.5rem; }
  .na-correction-row { display: flex; align-items: center; gap: 0.75rem; padding: 0.3rem 0; border-bottom: 1px solid #f5f3ff; font-size: 12px; }
  .na-correction-row:last-child { border-bottom: none; }
  .na-correction-row__key { font-weight: 500; color: #374151; min-width: 130px; flex-shrink: 0; }
  .na-correction-row__val { color: #7c3aed; flex: 1; }

  /* ── Phase 3B gaps ── */

  /* Review progress summary bar */
  .na-review-progress {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem;
    padding: 0.6rem 0;
    margin-bottom: 0.875rem;
    font-size: 12px;
    color: #374151;
  }
  .na-review-progress__label { font-weight: 500; }
  .na-review-progress__sep { color: #d1d5db; }
  .na-review-progress__chip { font-size: 11px; font-weight: 600; padding: 0.15rem 0.45rem; border-radius: 3px; }
  .na-review-progress__chip--ai       { background: #f3f4f6; color: #4b5563; }
  .na-review-progress__chip--reviewed  { background: #dbeafe; color: #1e3a8a; }
  .na-review-progress__chip--corrected { background: #ede9fe; color: #4c1d95; }

  /* Adjacent prev/next navigation (read-only browsing) */
  .na-nav-adj {
    display: inline-flex;
    align-items: center;
    padding: 0.2rem 0.55rem;
    border: 1px solid #e5e7ea;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 500;
    color: #6b7280;
    text-decoration: none;
    background: #fff;
    transition: background 0.1s, color 0.1s;
  }
  .na-nav-adj:hover { background: #f3f4f6; color: #374151; }

  /* Vocabulary gap flag badge */
  .na-badge--vocab-gap { background: #fff3cd; color: #7d5f00; }

  /* Vocabulary gap toggle container */
  .na-vocab-gap { margin-top: 0.75rem; padding-top: 0.75rem; border-top: 1px solid #f0f1f3; }

  /* ── Delete / bulk delete ── */

  /* Selected row highlight */
  .na-row--selected { background: #fef9f0; }

  /* Bulk action bar */
  .na-bulk-bar {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.6rem 1.25rem;
    background: #fff8ed;
    border-bottom: 1px solid #f5d99e;
    font-size: 13px;
  }
  .na-bulk-bar__count { font-weight: 600; color: #7d5f00; }
  .na-bulk-bar__clear {
    background: none;
    border: none;
    color: #6b7280;
    font-size: 12px;
    cursor: pointer;
    padding: 0;
    text-decoration: underline;
  }
  .na-bulk-bar__clear:hover { color: #374151; }

  /* Bulk delete button */
  .na-btn-delete {
    padding: 0.3rem 0.8rem;
    border: 1px solid #dc2626;
    border-radius: 4px;
    background: #fff;
    color: #dc2626;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.1s, color 0.1s;
  }
  .na-btn-delete:hover:not(:disabled) { background: #dc2626; color: #fff; }
  .na-btn-delete:disabled { opacity: 0.5; cursor: not-allowed; }

  /* Per-row delete button */
  .na-btn-row-delete {
    width: 24px;
    height: 24px;
    padding: 0;
    border: 1px solid #e5e7eb;
    border-radius: 4px;
    background: #fff;
    color: #9ca3af;
    font-size: 11px;
    cursor: pointer;
    transition: background 0.1s, color 0.1s, border-color 0.1s;
    line-height: 1;
  }
  .na-btn-row-delete:hover:not(:disabled) {
    background: #fee2e2;
    border-color: #dc2626;
    color: #dc2626;
  }
  .na-btn-row-delete:disabled { opacity: 0.4; cursor: not-allowed; }
`;
