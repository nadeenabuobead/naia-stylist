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
// Access is further restricted to the "owner" role specifically — every
// session today IS owner (internal-auth.server.ts has no staff-role
// session creation path yet), but a bulk-delete maintenance action should
// not silently become reachable the moment a staff-role session exists.
//
// Confirmation: each purge requires a native browser confirm() before the
// form submits — a deliberate double-check for a bulk-delete action, even
// though both purges only ever touch rows already past retention/expiry.
//
// Auditability: every run is recorded in AdminAuditLog (performedBy from
// the session identity, never client input) and the most recent entries
// are listed on this page.
//
// URL: /admin/maintenance

import type { FormEvent } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData } from "react-router";
import { requireAdminSession } from "~/lib/internal-auth.server";
import { purgeExpiredJourneyEvents, purgeExpiredNaiaSessions, purgeUnconfirmedSelfiePhotos } from "~/lib/data-retention.server";
import { recordAdminAction, listRecentAdminActions } from "~/lib/admin-audit-log.server";
import { listPendingClerkCleanups, retryPendingClerkCleanup } from "~/lib/clerk-cleanup.server";

async function requireOwner(request: Request) {
  const session = await requireAdminSession(request);
  if (session.identity.role !== "owner") {
    throw new Response("Forbidden", { status: 403 });
  }
  return session;
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requireOwner(request);
  const [recentActions, pendingClerkCleanups] = await Promise.all([
    listRecentAdminActions(20),
    listPendingClerkCleanups(),
  ]);
  return { recentActions, pendingClerkCleanups };
}

export async function action({ request }: ActionFunctionArgs) {
  const { identity } = await requireOwner(request);

  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "purge-journey-events") {
    const result = await purgeExpiredJourneyEvents();
    await recordAdminAction(identity.email, "purge-journey-events", { count: result.count });
    return { ok: true as const, intent, message: `Purged ${result.count} JourneyEvent row(s) past the retention window.` };
  }

  if (intent === "purge-sessions") {
    const result = await purgeExpiredNaiaSessions();
    await recordAdminAction(identity.email, "purge-sessions", { count: result.count });
    return { ok: true as const, intent, message: `Purged ${result.count} expired session(s).` };
  }

  if (intent === "purge-unconfirmed-selfies") {
    const result = await purgeUnconfirmedSelfiePhotos();
    await recordAdminAction(identity.email, "purge-unconfirmed-selfies", result);
    return {
      ok: true as const,
      intent,
      message: result.attempted === result.count
        ? `Purged ${result.count} unconfirmed selfie photo(s).`
        : `Purged ${result.count} of ${result.attempted} unconfirmed selfie photo(s) — ${result.attempted - result.count} failed and will retry next run.`,
    };
  }

  if (intent === "retry-clerk-cleanup") {
    const id = String(form.get("id") ?? "");
    const result = await retryPendingClerkCleanup(id);
    await recordAdminAction(identity.email, "retry-clerk-cleanup", { id, result: result.status });
    if (result.status === "resolved") {
      return { ok: true as const, intent, message: "Clerk user deleted — cleanup resolved." };
    }
    if (result.status === "failed-again") {
      return { ok: false as const, error: `Retry failed again: ${result.error}` };
    }
    return { ok: false as const, error: result.status === "not-found" ? "Record not found." : "Already resolved." };
  }

  return { ok: false as const, error: "Invalid request." };
}

function confirmPurge(e: FormEvent<HTMLFormElement>, label: string) {
  if (!window.confirm(`${label}? This cannot be undone.`)) {
    e.preventDefault();
  }
}

export default function AdminMaintenance() {
  const actionData = useActionData<typeof action>();
  const { recentActions, pendingClerkCleanups } = useLoaderData<typeof loader>();

  return (
    <div className="adm-page">
      <h1 className="adm-page-heading">Data Retention</h1>
      <p className="adm-page-sub">
        Manual cleanup — no cron is configured for this project yet. Both actions below only ever
        delete rows already past their retention window or already expired.
      </p>

      <div className="adm-card" style={{ padding: "1.5rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
        <form method="post" style={{ display: "flex", alignItems: "center", gap: "1rem" }}
          onSubmit={e => confirmPurge(e, "Purge expired JourneyEvent rows")}>
          <input type="hidden" name="intent" value="purge-journey-events" />
          <button type="submit" style={maintenanceButtonStyle}>
            Purge expired JourneyEvent rows
          </button>
          <span style={{ fontSize: "12px", color: "#6b7280" }}>
            Deletes rows older than the retention window (default 180 days).
          </span>
        </form>

        <form method="post" style={{ display: "flex", alignItems: "center", gap: "1rem" }}
          onSubmit={e => confirmPurge(e, "Purge expired sessions")}>
          <input type="hidden" name="intent" value="purge-sessions" />
          <button type="submit" style={maintenanceButtonStyle}>
            Purge expired sessions
          </button>
          <span style={{ fontSize: "12px", color: "#6b7280" }}>
            Deletes NaiaSession rows whose expiresAt has already passed.
          </span>
        </form>

        <form method="post" style={{ display: "flex", alignItems: "center", gap: "1rem" }}
          onSubmit={e => confirmPurge(e, "Purge unconfirmed selfie photos")}>
          <input type="hidden" name="intent" value="purge-unconfirmed-selfies" />
          <button type="submit" style={maintenanceButtonStyle}>
            Purge unconfirmed selfie photos
          </button>
          <span style={{ fontSize: "12px", color: "#6b7280" }}>
            Deletes the stored photo (analysis text preserved) for selfies with no keep/delete decision after 30 days.
          </span>
        </form>

        {actionData && "message" in actionData && (
          <p style={{ fontSize: "13px", color: "#16213e" }}>{actionData.message}</p>
        )}
        {actionData && "error" in actionData && (
          <p style={{ fontSize: "13px", color: "#b3261e" }}>{actionData.error}</p>
        )}
      </div>

      <h2 className="adm-page-heading" style={{ fontSize: "16px", marginTop: "2rem" }}>
        Pending Clerk account cleanups
      </h2>
      <p className="adm-page-sub" style={{ marginBottom: "0.75rem" }}>
        A customer's own nAia data was successfully deleted, but deleting their Clerk login
        afterward failed — the row below is the only trace of that until it's retried successfully.
      </p>
      <div className="adm-card" style={{ padding: "0" }}>
        {pendingClerkCleanups.length === 0 ? (
          <p style={{ fontSize: "13px", color: "#6b7280", padding: "1rem 1.5rem" }}>
            No pending Clerk cleanups — nothing needs attention.
          </p>
        ) : (
          <table style={{ width: "100%", fontSize: "13px", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #dde1e7" }}>
                <th style={{ padding: "0.6rem 1rem" }}>First failed</th>
                <th style={{ padding: "0.6rem 1rem" }}>Former customer</th>
                <th style={{ padding: "0.6rem 1rem" }}>Clerk user</th>
                <th style={{ padding: "0.6rem 1rem" }}>Attempts</th>
                <th style={{ padding: "0.6rem 1rem" }}>Last error</th>
                <th style={{ padding: "0.6rem 1rem" }}></th>
              </tr>
            </thead>
            <tbody>
              {pendingClerkCleanups.map(entry => (
                <tr key={entry.id} style={{ borderBottom: "1px solid #f0f1f3" }}>
                  <td style={{ padding: "0.6rem 1rem", color: "#6b7280" }}>{new Date(entry.createdAt).toLocaleString()}</td>
                  <td style={{ padding: "0.6rem 1rem" }}>{entry.customerId}</td>
                  <td style={{ padding: "0.6rem 1rem" }}>{entry.clerkUserId}</td>
                  <td style={{ padding: "0.6rem 1rem" }}>{entry.attemptCount}</td>
                  <td style={{ padding: "0.6rem 1rem", color: "#b3261e" }}>{entry.lastError}</td>
                  <td style={{ padding: "0.6rem 1rem" }}>
                    <form method="post">
                      <input type="hidden" name="intent" value="retry-clerk-cleanup" />
                      <input type="hidden" name="id" value={entry.id} />
                      <button type="submit" style={maintenanceButtonStyle}>Retry</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <h2 className="adm-page-heading" style={{ fontSize: "16px", marginTop: "2rem" }}>Recent maintenance actions</h2>
      <div className="adm-card" style={{ padding: "0" }}>
        {recentActions.length === 0 ? (
          <p style={{ fontSize: "13px", color: "#6b7280", padding: "1rem 1.5rem" }}>No maintenance actions recorded yet.</p>
        ) : (
          <table style={{ width: "100%", fontSize: "13px", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #dde1e7" }}>
                <th style={{ padding: "0.6rem 1rem" }}>When</th>
                <th style={{ padding: "0.6rem 1rem" }}>Action</th>
                <th style={{ padding: "0.6rem 1rem" }}>By</th>
                <th style={{ padding: "0.6rem 1rem" }}>Detail</th>
              </tr>
            </thead>
            <tbody>
              {recentActions.map(entry => (
                <tr key={entry.id} style={{ borderBottom: "1px solid #f0f1f3" }}>
                  <td style={{ padding: "0.6rem 1rem", color: "#6b7280" }}>{new Date(entry.createdAt).toLocaleString()}</td>
                  <td style={{ padding: "0.6rem 1rem" }}>{entry.action}</td>
                  <td style={{ padding: "0.6rem 1rem" }}>{entry.performedBy}</td>
                  <td style={{ padding: "0.6rem 1rem", color: "#6b7280" }}>
                    {entry.detail ? JSON.stringify(entry.detail) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
