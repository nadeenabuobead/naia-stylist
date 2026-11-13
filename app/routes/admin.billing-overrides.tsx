// app/routes/admin.billing-overrides.tsx
//
// Correctness review (2026-11-13) — Founder Decision 16's own admin-
// override allowance ("lost dispute: revoke by default, subject to the
// approved review/override rules") had no operational path:
// applyAdminRestoreOverride/applyAdminRevokeOverride
// (admin-revocation-override.server.ts) existed only as library code with
// zero callers anywhere in the app. This is the minimal admin-auth-gated
// surface to actually exercise them, and to triage ManualReviewFlag rows
// (manual-review.server.ts) — same auth/audit conventions as
// admin.maintenance.tsx.
//
// Auth: requireAdminSession + "owner" role, belt-and-suspenders in both
// loader and action, matching admin.maintenance.tsx exactly — a billing
// override is at least as sensitive as the bulk-delete maintenance actions
// gated the same way there.
//
// Confirmation: restore/revoke both require a native confirm() before
// submit, same as admin.maintenance.tsx's purge actions.
//
// URL: /admin/billing-overrides

import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData } from "react-router";
import { requireAdminSession } from "~/lib/internal-auth.server";
import {
  applyAdminRestoreOverride,
  applyAdminRevokeOverride,
  listActiveAccessRevocations,
} from "~/lib/billing/admin-revocation-override.server";
import { listOpenManualReviewFlags, resolveManualReviewFlag } from "~/lib/billing/manual-review.server";

async function requireOwner(request: Request) {
  const session = await requireAdminSession(request);
  if (session.identity.role !== "owner") {
    throw new Response("Forbidden", { status: 403 });
  }
  return session;
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requireOwner(request);
  const [activeRevocations, openReviewFlags] = await Promise.all([
    listActiveAccessRevocations(),
    listOpenManualReviewFlags(),
  ]);
  return { activeRevocations, openReviewFlags };
}

export async function action({ request }: ActionFunctionArgs) {
  const { identity } = await requireOwner(request);
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "restore-access") {
    const subscriptionId = String(form.get("subscriptionId") ?? "");
    const customerId = String(form.get("customerId") ?? "");
    const reason = String(form.get("reason") ?? "");
    const result = await applyAdminRestoreOverride({ subscriptionId, customerId, performedBy: identity.email, reason });
    if (!result.ok) return { ok: false as const, error: result.reason };
    return {
      ok: true as const,
      intent,
      message: `Restored access for subscription ${subscriptionId} — resolved ${result.resolvedCount} revocation(s).`,
    };
  }

  if (intent === "revoke-access") {
    const subscriptionId = String(form.get("subscriptionId") ?? "");
    const customerId = String(form.get("customerId") ?? "");
    const reason = String(form.get("reason") ?? "");
    const reasonCode = form.get("reasonCode") === "DISPUTE_LOST" ? ("DISPUTE_LOST" as const) : ("REFUND" as const);
    const result = await applyAdminRevokeOverride({ subscriptionId, customerId, performedBy: identity.email, reason, reasonCode });
    if (!result.ok) return { ok: false as const, error: result.reason };
    return { ok: true as const, intent, message: `Revoked access for subscription ${subscriptionId}.` };
  }

  if (intent === "resolve-review-flag") {
    const id = String(form.get("id") ?? "");
    const note = String(form.get("note") ?? "");
    const result = await resolveManualReviewFlag(id, identity.email, note || undefined);
    if (result.status !== "resolved") {
      return { ok: false as const, error: result.status === "not-found" ? "Flag not found." : "Already resolved." };
    }
    return { ok: true as const, intent, message: "Review flag resolved." };
  }

  return { ok: false as const, error: "Invalid request." };
}

export default function AdminBillingOverrides() {
  const actionData = useActionData<typeof action>();
  const { activeRevocations, openReviewFlags } = useLoaderData<typeof loader>();

  return (
    <div className="adm-page">
      <h1 className="adm-page-heading">Billing Overrides &amp; Manual Review</h1>
      <p className="adm-page-sub">
        Founder Decision 16 overrides for refund/dispute access revocation, and funded-period
        manual-review obligations the automatic logic correctly refused to guess at.
      </p>

      {actionData && "message" in actionData && <p style={{ fontSize: "13px", color: "#16213e" }}>{actionData.message}</p>}
      {actionData && "error" in actionData && <p style={{ fontSize: "13px", color: "#b3261e" }}>{actionData.error}</p>}

      <h2 className="adm-page-heading" style={{ fontSize: "16px", marginTop: "2rem" }}>Active access revocations</h2>
      <div className="adm-card" style={{ padding: "0" }}>
        {activeRevocations.length === 0 ? (
          <p style={{ fontSize: "13px", color: "#6b7280", padding: "1rem 1.5rem" }}>No active revocations.</p>
        ) : (
          <table style={{ width: "100%", fontSize: "13px", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #dde1e7" }}>
                <th style={{ padding: "0.6rem 1rem" }}>Since</th>
                <th style={{ padding: "0.6rem 1rem" }}>Subscription</th>
                <th style={{ padding: "0.6rem 1rem" }}>Customer</th>
                <th style={{ padding: "0.6rem 1rem" }}>Reason</th>
                <th style={{ padding: "0.6rem 1rem" }}></th>
              </tr>
            </thead>
            <tbody>
              {activeRevocations.map((r) => (
                <tr key={r.id} style={{ borderBottom: "1px solid #f0f1f3" }}>
                  <td style={{ padding: "0.6rem 1rem", color: "#6b7280" }}>{new Date(r.createdAt).toLocaleString()}</td>
                  <td style={{ padding: "0.6rem 1rem", fontFamily: "monospace", fontSize: "11px" }}>{r.subscriptionId}</td>
                  <td style={{ padding: "0.6rem 1rem" }}>{r.customerId}</td>
                  <td style={{ padding: "0.6rem 1rem" }}>{r.reason}</td>
                  <td style={{ padding: "0.6rem 1rem" }}>
                    <form
                      method="post"
                      style={{ display: "flex", gap: "0.5rem" }}
                      onSubmit={(e) => {
                        if (!window.confirm("Restore access for this subscription? This resolves ALL active revocations on it.")) e.preventDefault();
                      }}
                    >
                      <input type="hidden" name="intent" value="restore-access" />
                      <input type="hidden" name="subscriptionId" value={r.subscriptionId} />
                      <input type="hidden" name="customerId" value={r.customerId} />
                      <input type="text" name="reason" placeholder="Reason (required)" required style={{ fontSize: "12px", padding: "0.3rem" }} />
                      <button type="submit" style={maintenanceButtonStyle}>Restore</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <h2 className="adm-page-heading" style={{ fontSize: "16px", marginTop: "2rem" }}>Manually revoke access</h2>
      <div className="adm-card" style={{ padding: "1.5rem" }}>
        <form
          method="post"
          style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}
          onSubmit={(e) => {
            if (!window.confirm("Manually revoke access for this subscription?")) e.preventDefault();
          }}
        >
          <input type="hidden" name="intent" value="revoke-access" />
          <input type="text" name="subscriptionId" placeholder="Subscription ID" required style={{ fontSize: "12px", padding: "0.3rem" }} />
          <input type="text" name="customerId" placeholder="Customer ID" required style={{ fontSize: "12px", padding: "0.3rem" }} />
          <select name="reasonCode" style={{ fontSize: "12px", padding: "0.3rem" }}>
            <option value="REFUND">REFUND</option>
            <option value="DISPUTE_LOST">DISPUTE_LOST</option>
          </select>
          <input type="text" name="reason" placeholder="Reason (required)" required style={{ fontSize: "12px", padding: "0.3rem", flex: 1 }} />
          <button type="submit" style={{ ...maintenanceButtonStyle, background: "#b3261e" }}>Revoke</button>
        </form>
      </div>

      <h2 className="adm-page-heading" style={{ fontSize: "16px", marginTop: "2rem" }}>Open manual-review flags</h2>
      <div className="adm-card" style={{ padding: "0" }}>
        {openReviewFlags.length === 0 ? (
          <p style={{ fontSize: "13px", color: "#6b7280", padding: "1rem 1.5rem" }}>Nothing needs review.</p>
        ) : (
          <table style={{ width: "100%", fontSize: "13px", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #dde1e7" }}>
                <th style={{ padding: "0.6rem 1rem" }}>Since</th>
                <th style={{ padding: "0.6rem 1rem" }}>Category</th>
                <th style={{ padding: "0.6rem 1rem" }}>Subscription</th>
                <th style={{ padding: "0.6rem 1rem" }}>Transaction/Dispute</th>
                <th style={{ padding: "0.6rem 1rem" }}>Detail</th>
                <th style={{ padding: "0.6rem 1rem" }}></th>
              </tr>
            </thead>
            <tbody>
              {openReviewFlags.map((f) => (
                <tr key={f.id} style={{ borderBottom: "1px solid #f0f1f3" }}>
                  <td style={{ padding: "0.6rem 1rem", color: "#6b7280" }}>{new Date(f.createdAt).toLocaleString()}</td>
                  <td style={{ padding: "0.6rem 1rem" }}>{f.category}</td>
                  <td style={{ padding: "0.6rem 1rem", fontFamily: "monospace", fontSize: "11px" }}>{f.subscriptionId ?? "—"}</td>
                  <td style={{ padding: "0.6rem 1rem", fontFamily: "monospace", fontSize: "11px" }}>{f.transactionId ?? f.disputeId ?? "—"}</td>
                  <td style={{ padding: "0.6rem 1rem", color: "#6b7280" }}>{f.detail ? JSON.stringify(f.detail) : "—"}</td>
                  <td style={{ padding: "0.6rem 1rem" }}>
                    <form method="post">
                      <input type="hidden" name="intent" value="resolve-review-flag" />
                      <input type="hidden" name="id" value={f.id} />
                      <button type="submit" style={maintenanceButtonStyle}>Mark reviewed</button>
                    </form>
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
