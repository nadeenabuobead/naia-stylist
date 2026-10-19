// app/routes/admin.maintenance.tsx
//
// Priority 5 (2026-10-19) — manual trigger for the retention purge
// functions (app/lib/data-retention.server.ts). No cron is configured for
// this project, so until one is approved and added, this is the only way
// those purges actually run.
//
// Auth: requireAdminSession called in both loader and action — belt and
// suspenders, same convention as admin.naia.phase3c-export.tsx (the parent
// admin.tsx layout's loader auth does not cover this route's own action).
//
// Safety: both purges only ever delete rows that are already past their
// retention window / already expired — never live data. No customer-facing
// effect either way.
//
// URL: /admin/maintenance

import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useActionData } from "react-router";
import { requireAdminSession } from "~/lib/internal-auth.server";
import { purgeExpiredJourneyEvents, purgeExpiredNaiaSessions } from "~/lib/data-retention.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdminSession(request);
  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  await requireAdminSession(request);

  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "purge-journey-events") {
    const result = await purgeExpiredJourneyEvents();
    return { ok: true as const, intent, message: `Purged ${result.count} JourneyEvent row(s) past the retention window.` };
  }

  if (intent === "purge-sessions") {
    const result = await purgeExpiredNaiaSessions();
    return { ok: true as const, intent, message: `Purged ${result.count} expired session(s).` };
  }

  return { ok: false as const, error: "Invalid request." };
}

export default function AdminMaintenance() {
  const actionData = useActionData<typeof action>();

  return (
    <div className="adm-page">
      <h1 className="adm-page-heading">Data Retention</h1>
      <p className="adm-page-sub">
        Manual cleanup — no cron is configured for this project yet. Both actions below only ever
        delete rows already past their retention window or already expired.
      </p>

      <div className="adm-card" style={{ padding: "1.5rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
        <form method="post" style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <input type="hidden" name="intent" value="purge-journey-events" />
          <button type="submit" style={maintenanceButtonStyle}>
            Purge expired JourneyEvent rows
          </button>
          <span style={{ fontSize: "12px", color: "#6b7280" }}>
            Deletes rows older than the retention window (default 180 days).
          </span>
        </form>

        <form method="post" style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <input type="hidden" name="intent" value="purge-sessions" />
          <button type="submit" style={maintenanceButtonStyle}>
            Purge expired sessions
          </button>
          <span style={{ fontSize: "12px", color: "#6b7280" }}>
            Deletes NaiaSession rows whose expiresAt has already passed.
          </span>
        </form>

        {actionData && "message" in actionData && (
          <p style={{ fontSize: "13px", color: "#16213e" }}>{actionData.message}</p>
        )}
        {actionData && "error" in actionData && (
          <p style={{ fontSize: "13px", color: "#b3261e" }}>{actionData.error}</p>
        )}
      </div>
    </div>
  );
}

const maintenanceButtonStyle = {
  padding: "0.4rem 0.875rem",
  background: "#16213e",
  color: "#fff",
  border: "none",
  borderRadius: "5px",
  fontSize: "13px",
  fontWeight: 600,
  cursor: "pointer",
} as const;
