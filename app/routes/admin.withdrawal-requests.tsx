// app/routes/admin.withdrawal-requests.tsx
//
// 2026-11-17 Operations follow-up — restricted case access for EU
// statutory withdrawal requests (Legal handoff W2, withdrawal-
// request.server.ts). Before this route existed, there was no way to see
// a submitted withdrawal request short of querying the database directly
// — no admin surface, no case-log entry, nothing. This is a read/triage
// surface only: it never touches Subscription, BillingTransaction, or
// Stripe — that boundary belongs entirely to the manual refund procedure
// in docs/ops/refund-operations-sop.md, which this route's handler uses
// alongside it, not instead of it.
//
// Auth: requireAdminSession + "owner" role, same convention as
// admin.billing-overrides.tsx and admin.maintenance.tsx — a statutory
// legal request record is at least as restricted as billing overrides.
//
// URL: /admin/withdrawal-requests

import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData } from "react-router";
import { requireAdminSession } from "~/lib/internal-auth.server";
import {
  listOpenWithdrawalRequests,
  acknowledgeWithdrawalRequest,
  closeWithdrawalRequest,
} from "~/lib/withdrawal-request.server";

async function requireOwner(request: Request) {
  const session = await requireAdminSession(request);
  if (session.identity.role !== "owner") {
    throw new Response("Forbidden", { status: 403 });
  }
  return session;
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requireOwner(request);
  const openRequests = await listOpenWithdrawalRequests();
  return { openRequests };
}

export async function action({ request }: ActionFunctionArgs) {
  const { identity } = await requireOwner(request);
  const form = await request.formData();
  const intent = form.get("intent");
  const id = String(form.get("id") ?? "");

  if (intent === "acknowledge") {
    const result = await acknowledgeWithdrawalRequest(id, identity.email);
    if (result.status === "not-found") return { ok: false as const, error: "Request not found." };
    if (result.status === "already-closed") return { ok: false as const, error: "This request is already closed." };
    return { ok: true as const, intent, message: "Marked acknowledged." };
  }

  if (intent === "close") {
    const note = String(form.get("note") ?? "");
    try {
      const result = await closeWithdrawalRequest(id, identity.email, note);
      if (result.status === "not-found") return { ok: false as const, error: "Request not found." };
      if (result.status === "already-closed") return { ok: false as const, error: "This request is already closed." };
      return { ok: true as const, intent, message: "Closed." };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : "Could not close this request." };
    }
  }

  return { ok: false as const, error: "Invalid request." };
}

export default function AdminWithdrawalRequests() {
  const actionData = useActionData<typeof action>();
  const { openRequests } = useLoaderData<typeof loader>();

  return (
    <div className="adm-page">
      <h1 className="adm-page-heading">EU Withdrawal Requests</h1>
      <p className="adm-page-sub">
        Statutory right-of-withdrawal requests (Legal handoff W2). This is a case-triage view only —
        it never issues a refund or changes membership access. Follow docs/ops/refund-operations-sop.md
        for the actual manual refund/cancellation steps, then close the case here once done.
      </p>

      {actionData && "message" in actionData && <p style={{ fontSize: "13px", color: "#16213e" }}>{actionData.message}</p>}
      {actionData && "error" in actionData && <p style={{ fontSize: "13px", color: "#b3261e" }}>{actionData.error}</p>}

      <div className="adm-card" style={{ padding: "0" }}>
        {openRequests.length === 0 ? (
          <p style={{ fontSize: "13px", color: "#6b7280", padding: "1rem 1.5rem" }}>No open withdrawal requests.</p>
        ) : (
          <table style={{ width: "100%", fontSize: "13px", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #dde1e7" }}>
                <th style={{ padding: "0.6rem 1rem" }}>Submitted</th>
                <th style={{ padding: "0.6rem 1rem" }}>Reference</th>
                <th style={{ padding: "0.6rem 1rem" }}>Customer</th>
                <th style={{ padding: "0.6rem 1rem" }}>Status</th>
                <th style={{ padding: "0.6rem 1rem" }}></th>
              </tr>
            </thead>
            <tbody>
              {openRequests.map((r) => (
                <tr key={r.id} style={{ borderBottom: "1px solid #f0f1f3" }}>
                  <td style={{ padding: "0.6rem 1rem", color: "#6b7280" }}>{new Date(r.submittedAt).toLocaleString()}</td>
                  <td style={{ padding: "0.6rem 1rem", fontFamily: "monospace", fontSize: "11px" }}>{r.reference}</td>
                  <td style={{ padding: "0.6rem 1rem" }}>
                    {r.customerNameAtRequest ?? "—"} ({r.customerEmailAtRequest})
                  </td>
                  <td style={{ padding: "0.6rem 1rem" }}>{r.status}</td>
                  <td style={{ padding: "0.6rem 1rem" }}>
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      {r.status === "SUBMITTED" && (
                        <form method="post">
                          <input type="hidden" name="intent" value="acknowledge" />
                          <input type="hidden" name="id" value={r.id} />
                          <button type="submit" style={maintenanceButtonStyle}>Acknowledge</button>
                        </form>
                      )}
                      <form
                        method="post"
                        style={{ display: "flex", gap: "0.3rem" }}
                        onSubmit={(e) => {
                          if (!window.confirm("Close this withdrawal-request case? This should only be done once it has actually been resolved.")) e.preventDefault();
                        }}
                      >
                        <input type="hidden" name="intent" value="close" />
                        <input type="hidden" name="id" value={r.id} />
                        <input type="text" name="note" placeholder="Resolution note (required)" required style={{ fontSize: "12px", padding: "0.3rem" }} />
                        <button type="submit" style={{ ...maintenanceButtonStyle, background: "#b3261e" }}>Close</button>
                      </form>
                    </div>
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
