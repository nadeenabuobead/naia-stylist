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
import { listPendingCustomerErasureFailures, retryPendingCustomerErasureFailure } from "~/lib/customer-erasure-failures.server";
import {
  listPendingCloudinaryDeletions,
  retryPendingCloudinaryDeletion,
  purgeResolvedCloudinaryDeletions,
} from "~/lib/cloudinary-deletion-claim.server";
import { runBoundedSweep } from "~/lib/cloudinary-orphan-sweep.server";
import { revokeAllCustomerSessions } from "~/lib/customer-session-revocation.server";

async function requireOwner(request: Request) {
  const session = await requireAdminSession(request);
  if (session.identity.role !== "owner") {
    throw new Response("Forbidden", { status: 403 });
  }
  return session;
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requireOwner(request);
  const [recentActions, pendingClerkCleanups, pendingCustomerErasureFailures, pendingCloudinaryDeletions] = await Promise.all([
    listRecentAdminActions(20),
    listPendingClerkCleanups(),
    listPendingCustomerErasureFailures(),
    listPendingCloudinaryDeletions(),
  ]);
  return { recentActions, pendingClerkCleanups, pendingCustomerErasureFailures, pendingCloudinaryDeletions };
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
    await recordAdminAction(identity.email, "purge-unconfirmed-selfies", { ...result });
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

  if (intent === "retry-customer-erasure-failure") {
    const id = String(form.get("id") ?? "");
    const result = await retryPendingCustomerErasureFailure(id);
    await recordAdminAction(identity.email, "retry-customer-erasure-failure", { id, result: result.status });
    if (result.status === "resolved") {
      return { ok: true as const, intent, message: "Customer erasure completed — resolved." };
    }
    if (result.status === "failed-again") {
      return { ok: false as const, error: `Retry failed again: ${result.error}` };
    }
    return { ok: false as const, error: result.status === "not-found" ? "Record not found." : "Already resolved." };
  }

  if (intent === "sweep-cloudinary-dry-run" || intent === "sweep-cloudinary-execute") {
    // Default is always dry-run — a real execution additionally requires
    // this exact confirmation value, not just the intent name, so a
    // mis-wired form or a replayed request can't silently execute.
    const dryRun = intent === "sweep-cloudinary-dry-run" || form.get("confirmExecute") !== "EXECUTE";
    const result = await runBoundedSweep({ mode: "ADMIN", dryRun });
    await recordAdminAction(identity.email, dryRun ? "sweep-cloudinary-dry-run" : "sweep-cloudinary-execute", {
      runId: result.runId,
      stoppedReason: result.stoppedReason,
      customersChecked: result.customersChecked,
      assetsDeleted: result.assetsDeleted,
      failures: result.failures,
    });
    if (result.stoppedReason === "ALREADY_RUNNING") {
      return { ok: false as const, error: "A sweep is already running — try again shortly." };
    }
    return {
      ok: true as const,
      intent,
      message: `${dryRun ? "[Dry run] " : ""}Checked ${result.customersChecked} customer(s), ${result.assetsChecked} asset(s). ` +
        `${dryRun ? "Would delete" : "Deleted"} ${result.assetsDeleted}, ${result.assetsSkippedReferenced} still referenced, ` +
        `${result.assetsSkippedRecent} too recent, ${result.failures} failed. Stopped: ${result.stoppedReason}.`,
    };
  }

  if (intent === "retry-cloudinary-deletion") {
    const id = String(form.get("id") ?? "");
    const result = await retryPendingCloudinaryDeletion(id);
    await recordAdminAction(identity.email, "retry-cloudinary-deletion", { id, result: result.status });
    if (result.status === "resolved") {
      return { ok: true as const, intent, message: "Cloudinary asset deleted — resolved." };
    }
    if (result.status === "failed-again") {
      return { ok: false as const, error: `Retry failed again: ${result.error}` };
    }
    return { ok: false as const, error: result.status === "not-found" ? "Record not found." : "Already resolved." };
  }

  if (intent === "purge-resolved-cloudinary-deletions") {
    const result = await purgeResolvedCloudinaryDeletions();
    await recordAdminAction(identity.email, "purge-resolved-cloudinary-deletions", result);
    return { ok: true as const, intent, message: `Purged ${result.count} resolved Cloudinary deletion record(s) past retention.` };
  }

  // 2026-11-17 (H4) — incident response: end every live session for one
  // customer, for a reported/suspected compromise. Requires the exact
  // confirmation value as well as the intent, same discipline as the
  // Cloudinary execute path above.
  //
  // 2026-11-21 — this now genuinely locks the customer out, not just out of
  // nAia's own legacy session store. revokeAllCustomerSessions
  // (customer-session-revocation.server.ts) ends BOTH the legacy NaiaSession
  // rows (naia-session.server.ts — still live for the not-yet-removed
  // Shopify OAuth routes) AND, since Clerk is the current PRIMARY customer-
  // auth provider, every live Clerk session for the same customer, through
  // Clerk's own Backend API. Earlier, this call only ever touched the first
  // of those two — a real gap, since the vast majority of live customers
  // authenticate via Clerk and were completely unaffected by this control.
  //
  // Still not an account lockout in the broader sense: this ends existing
  // sessions, it does not change or block the customer's credentials, so
  // they can sign in again immediately if they still hold them. For a
  // credential-compromise response (not just a stolen session token), that
  // follow-up step is still the operator's to take separately.
  //
  // Fail-closed: if the customer has a linked Clerk identity and Clerk
  // revocation does not fully succeed, revokeAllCustomerSessions throws
  // rather than returning a partial result — this intentionally propagates
  // past this handler (same as it always has for a NaiaSession DB failure)
  // rather than ever reporting success while a session might still be live.
  if (intent === "revoke-customer-sessions") {
    const customerId = String(form.get("customerId") ?? "").trim();
    if (!customerId) {
      return { ok: false as const, error: "Customer ID is required." };
    }
    if (form.get("confirmRevoke") !== "REVOKE") {
      return { ok: false as const, error: "Confirmation value missing — nothing was revoked." };
    }

    const result = await revokeAllCustomerSessions(customerId);
    const totalRevoked = result.legacyRevokedCount + result.clerkRevokedCount;
    await recordAdminAction(identity.email, "revoke-customer-sessions", {
      customerId,
      legacyRevokedCount: result.legacyRevokedCount,
      clerkRevokedCount: result.clerkRevokedCount,
      clerkLinked: result.clerkLinked,
    });

    // 0 is reported honestly rather than as a bland success: for an
    // incident-response action, "nothing was there to revoke" and "sessions
    // were revoked" must not look the same to the operator — the former
    // usually means a wrong customer ID was pasted.
    if (totalRevoked === 0) {
      return {
        ok: true as const,
        intent,
        message: `No active sessions found for ${customerId} — nothing to revoke (checked both the legacy nAia session store and${result.clerkLinked ? "" : " — no linked Clerk identity for this customer —"} Clerk). Check the customer ID is correct.`,
      };
    }
    return {
      ok: true as const,
      intent,
      message: result.clerkLinked
        ? `Revoked ${result.legacyRevokedCount} legacy nAia session(s) and ${result.clerkRevokedCount} Clerk session(s) for ${customerId}. Their current sign-in is ended — they will need to sign in again, though they can do so immediately if they still hold valid credentials.`
        : `Revoked ${result.legacyRevokedCount} legacy nAia session(s) for ${customerId}. No linked Clerk identity was found for this customer, so there was no Clerk-side session to end.`,
    };
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
  const { recentActions, pendingClerkCleanups, pendingCustomerErasureFailures, pendingCloudinaryDeletions } = useLoaderData<typeof loader>();

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

      {/* ── H4 — incident response: revoke one customer's live sessions ──── */}
      <h2 className="adm-page-heading" style={{ fontSize: "16px", marginTop: "2rem" }}>
        Revoke a customer&rsquo;s sessions
      </h2>
      <p className="adm-page-sub" style={{ marginBottom: "0.75rem" }}>
        For a reported or suspected account compromise: immediately ends every active nAia session
        for one customer, signing them out on all devices. Use this when a stolen session token or
        an unauthorised sign-in is suspected.
      </p>
      <p className="adm-page-sub" style={{ marginBottom: "0.75rem", color: "#b3261e" }}>
        <strong>This is not an account lockout.</strong> It revokes nAia&rsquo;s own sessions only
        &mdash; it does not end the customer&rsquo;s Clerk or Shopify identity session, so anyone
        holding their credentials can sign in again and get a new session. Treat it as containment
        of a stolen session, and follow it with a credential reset on the identity provider.
      </p>
      <div className="adm-card" style={{ padding: "1.5rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
        <form
          method="post"
          style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}
          onSubmit={e => {
            if (!window.confirm("Revoke ALL active nAia sessions for this customer? They will be signed out on every device.")) {
              e.preventDefault();
            }
          }}
        >
          <input type="hidden" name="intent" value="revoke-customer-sessions" />
          <input type="hidden" name="confirmRevoke" value="REVOKE" />
          <input
            type="text"
            name="customerId"
            placeholder="Customer ID"
            required
            style={{
              padding: "0.5rem 0.75rem",
              border: "1px solid #d1d5db",
              borderRadius: "4px",
              fontSize: "13px",
              minWidth: "280px",
            }}
          />
          <button type="submit" style={{ ...maintenanceButtonStyle, background: "#b3261e" }}>
            Revoke all sessions
          </button>
        </form>
        {actionData && "message" in actionData && actionData.intent === "revoke-customer-sessions" && (
          <p style={{ fontSize: "13px", color: "#16213e" }}>{actionData.message}</p>
        )}
      </div>

      <h2 className="adm-page-heading" style={{ fontSize: "16px", marginTop: "2rem" }}>
        Abandoned Cloudinary uploads
      </h2>
      <p className="adm-page-sub" style={{ marginBottom: "0.75rem" }}>
        Closet/Buy-or-Skip photos uploaded but never saved (the customer closed the tab or
        navigated away before the final "Add"/"Analyze" click) — bounded, resumable, and always a
        dry run unless explicitly confirmed below. Never deletes a photo still referenced by a
        ClosetItem, Buy-or-Skip analysis, Style Passport model, or selfie.
      </p>
      <div className="adm-card" style={{ padding: "1.5rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
        <form method="post" style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <input type="hidden" name="intent" value="sweep-cloudinary-dry-run" />
          <button type="submit" style={maintenanceButtonStyle}>Run dry run</button>
          <span style={{ fontSize: "12px", color: "#6b7280" }}>Lists what would be deleted — makes zero Cloudinary calls.</span>
        </form>
        <form method="post" style={{ display: "flex", alignItems: "center", gap: "1rem" }}
          onSubmit={e => { if (!window.confirm("Execute real Cloudinary deletion for abandoned uploads? This cannot be undone.")) e.preventDefault(); }}>
          <input type="hidden" name="intent" value="sweep-cloudinary-execute" />
          <input type="hidden" name="confirmExecute" value="EXECUTE" />
          <button type="submit" style={{ ...maintenanceButtonStyle, background: "#b3261e" }}>Execute real cleanup</button>
          <span style={{ fontSize: "12px", color: "#6b7280" }}>Only deletes assets older than 24h and unreferenced at the moment of deletion.</span>
        </form>
        {actionData && "message" in actionData && (actionData.intent === "sweep-cloudinary-dry-run" || actionData.intent === "sweep-cloudinary-execute") && (
          <p style={{ fontSize: "13px", color: "#16213e" }}>{actionData.message}</p>
        )}
      </div>

      <h2 className="adm-page-heading" style={{ fontSize: "16px", marginTop: "2rem" }}>
        Pending Cloudinary deletions
      </h2>
      <p className="adm-page-sub" style={{ marginBottom: "0.75rem" }}>
        A Cloudinary asset the app has already decided to delete (abandoned upload, or account
        erasure) whose delete call failed — retryable individually; never resolved automatically.
      </p>
      <div className="adm-card" style={{ padding: "0" }}>
        {pendingCloudinaryDeletions.length === 0 ? (
          <p style={{ fontSize: "13px", color: "#6b7280", padding: "1rem 1.5rem" }}>
            No pending Cloudinary deletions — nothing needs attention.
          </p>
        ) : (
          <table style={{ width: "100%", fontSize: "13px", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #dde1e7" }}>
                <th style={{ padding: "0.6rem 1rem" }}>First failed</th>
                <th style={{ padding: "0.6rem 1rem" }}>Customer</th>
                <th style={{ padding: "0.6rem 1rem" }}>Public ID</th>
                <th style={{ padding: "0.6rem 1rem" }}>Type</th>
                <th style={{ padding: "0.6rem 1rem" }}>Context</th>
                <th style={{ padding: "0.6rem 1rem" }}>Attempts</th>
                <th style={{ padding: "0.6rem 1rem" }}>Last error</th>
                <th style={{ padding: "0.6rem 1rem" }}></th>
              </tr>
            </thead>
            <tbody>
              {pendingCloudinaryDeletions.map(entry => (
                <tr key={entry.id} style={{ borderBottom: "1px solid #f0f1f3" }}>
                  <td style={{ padding: "0.6rem 1rem", color: "#6b7280" }}>{new Date(entry.createdAt).toLocaleString()}</td>
                  <td style={{ padding: "0.6rem 1rem" }}>{entry.customerId}</td>
                  <td style={{ padding: "0.6rem 1rem", fontFamily: "monospace", fontSize: "11px" }}>{entry.publicId}</td>
                  <td style={{ padding: "0.6rem 1rem" }}>{entry.deliveryType}</td>
                  <td style={{ padding: "0.6rem 1rem" }}>{entry.context}</td>
                  <td style={{ padding: "0.6rem 1rem" }}>{entry.attemptCount}</td>
                  <td style={{ padding: "0.6rem 1rem", color: "#b3261e" }}>{entry.lastError ?? "—"}</td>
                  <td style={{ padding: "0.6rem 1rem" }}>
                    <form method="post">
                      <input type="hidden" name="intent" value="retry-cloudinary-deletion" />
                      <input type="hidden" name="id" value={entry.id} />
                      <button type="submit" style={maintenanceButtonStyle}>Retry</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <form method="post" style={{ padding: "0.75rem 1rem" }}
          onSubmit={e => confirmPurge(e, "Purge resolved Cloudinary deletion records older than 90 days")}>
          <input type="hidden" name="intent" value="purge-resolved-cloudinary-deletions" />
          <button type="submit" style={maintenanceButtonStyle}>Purge old resolved records</button>
        </form>
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

      <h2 className="adm-page-heading" style={{ fontSize: "16px", marginTop: "2rem" }}>
        Pending customer erasure failures
      </h2>
      <p className="adm-page-sub" style={{ marginBottom: "0.75rem" }}>
        A GDPR erasure (self-service deletion, or the shop/redact or customers/redact Shopify webhook) hit a
        genuinely unexpected failure partway through — not a stuck Cloudinary asset, and not billing history
        (both are handled automatically). The row below is the only trace of that until it's retried successfully.
      </p>
      <div className="adm-card" style={{ padding: "0" }}>
        {pendingCustomerErasureFailures.length === 0 ? (
          <p style={{ fontSize: "13px", color: "#6b7280", padding: "1rem 1.5rem" }}>
            No pending customer erasure failures — nothing needs attention.
          </p>
        ) : (
          <table style={{ width: "100%", fontSize: "13px", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #dde1e7" }}>
                <th style={{ padding: "0.6rem 1rem" }}>First failed</th>
                <th style={{ padding: "0.6rem 1rem" }}>Customer</th>
                <th style={{ padding: "0.6rem 1rem" }}>Context</th>
                <th style={{ padding: "0.6rem 1rem" }}>Attempts</th>
                <th style={{ padding: "0.6rem 1rem" }}>Last error</th>
                <th style={{ padding: "0.6rem 1rem" }}></th>
              </tr>
            </thead>
            <tbody>
              {pendingCustomerErasureFailures.map(entry => (
                <tr key={entry.id} style={{ borderBottom: "1px solid #f0f1f3" }}>
                  <td style={{ padding: "0.6rem 1rem", color: "#6b7280" }}>{new Date(entry.createdAt).toLocaleString()}</td>
                  <td style={{ padding: "0.6rem 1rem" }}>{entry.customerId}</td>
                  <td style={{ padding: "0.6rem 1rem" }}>{entry.context}</td>
                  <td style={{ padding: "0.6rem 1rem" }}>{entry.attemptCount}</td>
                  <td style={{ padding: "0.6rem 1rem", color: "#b3261e" }}>{entry.lastError}</td>
                  <td style={{ padding: "0.6rem 1rem" }}>
                    <form method="post">
                      <input type="hidden" name="intent" value="retry-customer-erasure-failure" />
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
