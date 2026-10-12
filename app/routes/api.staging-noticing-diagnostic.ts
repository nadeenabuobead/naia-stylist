// app/routes/api.staging-noticing-diagnostic.ts
//
// ╔═══════════════════════════════════════════════════════════════════════╗
// ║  TEMP QA DIAGNOSTIC — What nAia Is Noticing (Taste & Evidence V1)      ║
// ║  Delete once the Noticing evidence investigation is closed.           ║
// ╚═══════════════════════════════════════════════════════════════════════╝
//
// Staging-only, session-authenticated, READ-ONLY diagnostic for the
// currently logged-in customer. Diagnoses why /what-naia-is-noticing may
// show "STILL LEARNING" despite substantial activity.
//
// Security:
//   - 404s unless process.env.NAIA_PROJECT_VARIANT === "staging" (checked
//     before auth, before touching the DB — same pattern as
//     api.seed-staging.jsx).
//   - Requires the normal authenticated customer session
//     (requireCurrentNaiaCustomer) — redirects to login if absent, exactly
//     like every other customer-facing page. No email/id/secret accepted
//     via query string, body, or header; the customer is always the one
//     already logged in.
//   - Diagnoses ONLY the session's own customerId — never accepts or
//     exposes any other customer's data.
//
// Read-only contract (see app/lib/ai/taste-evidence-diagnostic.server.ts
// for the full guarantee): no prisma create/update/delete/upsert, no call
// to writeSourceEvidence()/reconcileObservations(), no threshold or
// application-code change. Never returns DATABASE_URL, secrets, tokens, or
// any other credential.
//
// GET /api/staging-noticing-diagnostic → JSON report (same shape as
// scripts/qa-noticing-evidence-diagnostic.ts; both call the same shared
// function so they can never drift from each other).

import { type LoaderFunctionArgs } from "react-router";
import { requireCurrentNaiaCustomer } from "../lib/naia-session.server";
import { buildTasteEvidenceDiagnosticReport } from "../lib/ai/taste-evidence-diagnostic.server";

export async function loader({ request }: LoaderFunctionArgs) {
  // Hard block outside staging — before auth, before any DB access.
  if (process.env.NAIA_PROJECT_VARIANT !== "staging") {
    return new Response("Not Found", { status: 404 });
  }

  // Normal authenticated customer session — redirects to login if absent.
  const customer = await requireCurrentNaiaCustomer(request);

  const report = await buildTasteEvidenceDiagnosticReport(customer.id);

  return new Response(JSON.stringify(report, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
