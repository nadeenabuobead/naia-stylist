// app/routes/admin.nadine.tsx
//
// NADINE Designer Intelligence workspace shell.
// Auth is inherited from admin.tsx parent — no independent auth call needed.

import { Outlet, NavLink, useNavigation } from "react-router";

const NAV_ITEMS: Array<{
  label: string;
  to?: string;
  active: boolean;
  phase?: string;
}> = [
  { label: "Overview",             to: "/admin/nadine", active: false, phase: "M2" },
  { label: "Products",             active: false, phase: "Phase 2" },
  { label: "Recommendations",      active: false, phase: "Phase 2" },
  { label: "Conversion",           active: false, phase: "Phase 2" },
  { label: "Collection Intelligence", active: false, phase: "Phase 2" },
];

export default function NadineWorkspace() {
  const navigation = useNavigation();
  const loading = navigation.state !== "idle";

  return (
    <div className="naia-admin-shell">
      <nav className="naia-admin-nav" aria-label="NADINE Designer">
        <div className="naia-admin-nav__brand">
          <span className="naia-admin-nav__logo">NADINE Designer</span>
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

      <main className="naia-admin-main" id="nadine-admin-main">
        <Outlet />
      </main>
    </div>
  );
}
