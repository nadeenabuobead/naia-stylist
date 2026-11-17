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
// Auth: owner OR staff, via the shared requireRole gate
// (internal-auth.server.ts). This is the first admin route in this
// codebase built as a least-privilege proof of concept: triaging a
// withdrawal-request case (acknowledge/close with a note, both fully
// audited via AdminAuditLog) is a reasonable task to delegate to a
// designated staff member without also handing them access to
// /admin/billing-overrides or /admin/maintenance, which remain
// owner-only, UNCHANGED by this file. See
// docs/ops/staff-role-and-dispute-alerting.md for why this one route was
// chosen first and what would need to be true before extending the same
// treatment to billing-overrides. Practically inert today regardless:
// INTERNAL_STAFF_SECRET is unset everywhere, so no staff session can
// actually be created yet (verifyStaffSecret fails closed) — see that
// function's own comment.
//
// URL: /admin/withdrawal-requests

import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData } from "react-router";
import type { PrismaClient } from "@prisma/client";
import dbServer from "~/db.server";
import { requireRole } from "~/lib/internal-auth.server";

// db.server.js is untyped JS — without this, query-result inference
// (the .findMany below) silently degrades to implicit any, same gap
// fixed the same way in several other routes this cycle.
const prisma: PrismaClient = dbServer;
import {
  listOpenWithdrawalRequests,
  acknowledgeWithdrawalRequest,
  closeWithdrawalRequest,
} from "~/lib/withdrawal-request.server";
import {
  evaluateWithdrawalRefundEligibility,
  processWithdrawalFullRefund,
} from "~/lib/billing/withdrawal-refund.server";

async function requireOwnerOrStaff(request: Request) {
  return requireRole(request, ["owner", "staff"]);
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requireOwnerOrStaff(request);
  const openRequests = await listOpenWithdrawalRequests();
  // Read-only display only — never mutates, never calls Stripe. Shows
  // whoever's triaging whether a prior evaluation/refund attempt exists
  // for this case, without them having to click "Check eligibility" just
  // to see that. A genuinely fresh evaluation still always re-runs before
  // any actual refund action — see processWithdrawalFullRefund's own
  // header for why a displayed outcome here is never trusted as current.
  const cases = await prisma.withdrawalRefundCase.findMany({
    where: { withdrawalRequestId: { in: openRequests.map((r) => r.id) } },
  });
  const caseByRequestId = new Map(cases.map((c) => [c.withdrawalRequestId, c]));
  return { openRequests, caseByRequestId: Object.fromEntries(caseByRequestId) };
}

export async function action({ request }: ActionFunctionArgs) {
  const { identity } = await requireOwnerOrStaff(request);
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

  // 2026-11-17 — read-only: available to owner or staff, same as the
  // triage actions above. Never issues a refund, never calls Stripe.
  if (intent === "check-eligibility") {
    const result = await evaluateWithdrawalRefundEligibility(id);
    return { ok: true as const, intent, message: `Eligibility: ${result.outcome}.`, outcome: result.outcome };
  }

  // Owner-only below this line — moves real money. identity is already
  // resolved above (requireOwnerOrStaff) — checked directly rather than
  // re-parsing the session a second time.
  if (intent === "process-full-refund") {
    if (identity.role !== "owner") {
      throw new Response("Forbidden", { status: 403 });
    }
    const result = await processWithdrawalFullRefund(id, identity.email);
    if (!result.ok) {
      return { ok: false as const, error: `Not processed — ${result.reason}.` };
    }
    return {
      ok: true as const,
      intent,
      message: `Refund requested (Stripe refund ${result.case.providerRefundId}). Access will be revoked and billing stopped automatically once Stripe confirms — this does not happen immediately.`,
    };
  }

  return { ok: false as const, error: "Invalid request." };
}

export default function AdminWithdrawalRequests() {
  const actionData = useActionData<typeof action>();
  const { openRequests, caseByRequestId } = useLoaderData<typeof loader>();

  return (
    <div className="adm-page">
      <h1 className="adm-page-heading">EU Withdrawal Requests</h1>
      <p className="adm-page-sub">
        Statutory right-of-withdrawal requests (Legal handoff W2). "Check eligibility" is read-only —
        it never issues a refund. "Issue full refund" (owner-only) is the one action that moves real
        money: it only ever requests a FULL refund (no pro-rata deduction) and only when evidence of
        early-service consent is absent for this subscription — an eligible case with such evidence
        is a separate, not-yet-built action, never this one. Access revocation and stopping future
        billing both happen automatically, once Stripe confirms the refund succeeded — not immediately
        on this click. Close the case here once actually resolved.
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
                <th style={{ padding: "0.6rem 1rem" }}>Refund eligibility</th>
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
                  <td style={{ padding: "0.6rem 1rem", fontSize: "11px", color: "#6b7280" }}>
                    {caseByRequestId[r.id]?.outcome ?? "not evaluated"}
                  </td>
                  <td style={{ padding: "0.6rem 1rem" }}>
                    <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                      {r.status === "SUBMITTED" && (
                        <form method="post">
                          <input type="hidden" name="intent" value="acknowledge" />
                          <input type="hidden" name="id" value={r.id} />
                          <button type="submit" style={maintenanceButtonStyle}>Acknowledge</button>
                        </form>
                      )}
                      <form method="post">
                        <input type="hidden" name="intent" value="check-eligibility" />
                        <input type="hidden" name="id" value={r.id} />
                        <button type="submit" style={maintenanceButtonStyle}>Check eligibility</button>
                      </form>
                      <form
                        method="post"
                        onSubmit={(e) => {
                          if (!window.confirm("Issue a FULL Stripe refund for this withdrawal request? This moves real money (test-mode only) and will stop future billing once Stripe confirms. Only proceed if eligibility shows ELIGIBLE_PENDING.")) e.preventDefault();
                        }}
                      >
                        <input type="hidden" name="intent" value="process-full-refund" />
                        <input type="hidden" name="id" value={r.id} />
                        <button type="submit" style={{ ...maintenanceButtonStyle, background: "#b3261e" }}>
                          Issue full refund
                        </button>
                      </form>
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
