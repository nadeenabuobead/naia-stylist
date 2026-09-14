// app/routes/admin.tsx
//
// Protected layout for the standalone nAia Internal Admin portal.
// Every child route inherits this auth check — requireAdminSession redirects
// unauthenticated requests to /admin/login before any child loader runs.
//
// /admin/login and /admin/logout are registered OUTSIDE this layout in routes.ts
// so they are always public (no redirect loop possible).

import type { LoaderFunctionArgs } from "react-router";
import { Outlet, NavLink, useLoaderData, useLocation } from "react-router";
import { requireAdminSession } from "~/lib/internal-auth.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { identity } = await requireAdminSession(request);
  return Response.json({ identity });
}

export default function AdminLayout() {
  const { identity } = useLoaderData<typeof loader>();
  const location = useLocation();

  const inNaia = location.pathname.startsWith("/admin/naia");
  const inNadine = location.pathname.startsWith("/admin/nadine");

  return (
    <div style={styles.shell}>
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <span style={styles.logo}>nAia</span>
          <span style={styles.badge}>Internal</span>
        </div>

        <nav style={styles.workspaceNav} aria-label="Workspace">
          <NavLink
            to="/admin/naia"
            style={({ isActive }) => ({
              ...styles.workspaceLink,
              ...(isActive || inNaia ? styles.workspaceLinkActive : {}),
            })}
          >
            nAia Admin
          </NavLink>
          <NavLink
            to="/admin/nadine"
            style={({ isActive }) => ({
              ...styles.workspaceLink,
              ...(isActive || inNadine ? styles.workspaceLinkActive : {}),
            })}
          >
            NADINE Designer
          </NavLink>
        </nav>

        <div style={styles.headerRight}>
          <span style={styles.identityLabel}>{identity.email}</span>
          <form method="post" action="/admin/logout" style={{ display: "inline" }}>
            <button type="submit" style={styles.logoutBtn}>
              Sign out
            </button>
          </form>
        </div>
      </header>

      <main style={styles.main} id="admin-main">
        <Outlet />
      </main>

      <style>{PORTAL_CSS}</style>
    </div>
  );
}

const styles = {
  shell: {
    minHeight: "100vh",
    background: "#f4f5f7",
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontSize: "14px",
    color: "#111",
    display: "flex",
    flexDirection: "column" as const,
  },
  header: {
    background: "#16213e",
    color: "#fff",
    height: "52px",
    display: "flex",
    alignItems: "center",
    gap: "1.5rem",
    padding: "0 1.5rem",
    position: "sticky" as const,
    top: 0,
    zIndex: 300,
    flexShrink: 0,
    boxShadow: "0 1px 3px rgba(0,0,0,0.35)",
  },
  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    flexShrink: 0,
  },
  logo: {
    fontWeight: 800,
    fontSize: "16px",
    letterSpacing: "0.05em",
    color: "#d4a843",
  },
  badge: {
    fontSize: "9px",
    fontWeight: 700,
    letterSpacing: "0.1em",
    textTransform: "uppercase" as const,
    background: "#0f172a",
    color: "#64748b",
    padding: "0.15rem 0.4rem",
    borderRadius: "3px",
    border: "1px solid #334155",
  },
  workspaceNav: {
    display: "flex",
    gap: "0.25rem",
    flex: 1,
  },
  workspaceLink: {
    padding: "0.3rem 0.875rem",
    borderRadius: "4px",
    fontSize: "13px",
    fontWeight: 500,
    color: "#94a3b8",
    textDecoration: "none",
    transition: "background 0.12s, color 0.12s",
    whiteSpace: "nowrap" as const,
  },
  workspaceLinkActive: {
    background: "rgba(212,168,67,0.15)",
    color: "#d4a843",
    fontWeight: 600,
  },
  headerRight: {
    display: "flex",
    alignItems: "center",
    gap: "0.875rem",
    flexShrink: 0,
    marginLeft: "auto",
  },
  identityLabel: {
    fontSize: "12px",
    color: "#64748b",
  },
  logoutBtn: {
    padding: "0.3rem 0.75rem",
    background: "transparent",
    border: "1px solid #334155",
    borderRadius: "4px",
    color: "#94a3b8",
    fontSize: "12px",
    cursor: "pointer",
  },
  main: {
    flex: 1,
  },
} as const;

const PORTAL_CSS = `
  *, *::before, *::after { box-sizing: border-box; }
  body { margin: 0; }

  /* ── Shared admin card ── */
  .adm-card {
    background: #fff;
    border: 1px solid #dde1e7;
    border-radius: 8px;
    overflow: hidden;
    margin-bottom: 1.25rem;
  }

  /* ── Workspace selector tiles ── */
  .adm-workspace-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 1.25rem;
    max-width: 680px;
    margin: 0 auto;
  }

  .adm-workspace-tile {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 1.75rem;
    background: #fff;
    border: 1px solid #dde1e7;
    border-radius: 10px;
    text-decoration: none;
    color: #111;
    transition: border-color 0.15s, box-shadow 0.15s;
  }

  .adm-workspace-tile:hover {
    border-color: #d4a843;
    box-shadow: 0 2px 12px rgba(212,168,67,0.12);
  }

  .adm-workspace-tile__name {
    font-size: 16px;
    font-weight: 700;
    color: #16213e;
  }

  .adm-workspace-tile__desc {
    font-size: 13px;
    color: #6b7280;
    line-height: 1.5;
  }

  .adm-workspace-tile__arrow {
    font-size: 18px;
    color: #d4a843;
    margin-top: auto;
    padding-top: 0.75rem;
  }

  /* ── Page wrapper ── */
  .adm-page {
    padding: 2rem 1.5rem;
    max-width: 1440px;
    width: 100%;
    margin: 0 auto;
  }

  .adm-page-heading {
    font-size: 22px;
    font-weight: 700;
    color: #111;
    margin: 0 0 0.5rem;
  }

  .adm-page-sub {
    font-size: 13px;
    color: #6b7280;
    margin: 0 0 2rem;
  }

  /* ── Placeholder state ── */
  .adm-placeholder {
    text-align: center;
    padding: 4rem 1.5rem;
    color: #9ca3af;
  }

  .adm-placeholder__icon {
    font-size: 36px;
    margin-bottom: 0.75rem;
  }

  .adm-placeholder__title {
    font-size: 15px;
    font-weight: 600;
    color: #6b7280;
    margin: 0 0 0.35rem;
  }

  .adm-placeholder__phase {
    display: inline-block;
    margin-top: 0.75rem;
    padding: 0.2rem 0.6rem;
    background: #f3f4f6;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #6b7280;
  }
`;
