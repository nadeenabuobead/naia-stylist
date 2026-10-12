// app/routes/api.staging-noticing-qa-reset.ts
//
// ╔═══════════════════════════════════════════════════════════════════════╗
// ║  TEMP STAGING QA RESET — What nAia Is Noticing manual QA               ║
// ║  Delete this route + its routes.ts registration once manual QA of     ║
// ║  the Not Quite / Accurate feedback paths is closed.                   ║
// ╚═══════════════════════════════════════════════════════════════════════╝
//
// Why this exists: a REJECTED / customerFeedback="not-quite" StyleTendency
// is deliberately immutable through every existing path —
// reconcileObservations refuses to touch a REJECTED row
// (`if (existing.state === "REJECTED") return;`), and
// /api/taste-observation-feedback refuses any further action on one
// (ALREADY_REJECTED). That immutability is intentional product behavior,
// not a bug — there is no "undo rejection" anywhere in the real product.
// A QA tester who rejects an observation while manually testing the
// Not-Quite flow has no way to get it back for a second test pass. This
// route is the one-time, explicitly-authorised exception: a narrow,
// staging-only reset of exactly that state, scoped to the logged-in
// customer only, so the same real evidence can be re-evaluated by the
// unmodified reconciliation logic.
//
// Security / scope contract:
//   - 404s unless process.env.NAIA_PROJECT_VARIANT === "staging" (checked
//     before auth, before touching the DB — same pattern as every other
//     staging-only route in this codebase).
//   - Requires the normal authenticated customer session
//     (requireCurrentNaiaCustomer) — redirects to login if absent.
//   - Operates ONLY on the session's own customerId. No customer id/email/
//     tendencyId is ever accepted from the URL, query string, or body —
//     this is not a generic admin reset tool for arbitrary customers.
//   - Touches ONLY StyleTendency rows already in
//     { state: "REJECTED", customerFeedback: "not-quite" } for this one
//     customer. Never touches TasteEvidence, StyleMeOutcome,
//     PostOutfitReview, ClosetItem, BuyOrSkipAnalysis/BuySkipOutcome, or
//     OnboardingProfile (Style Passport) in any way — no deletes, no
//     writes, not even a read beyond what reconcileObservations already
//     does internally.
//   - No raw SQL, no arbitrary field names accepted from the client —
//     the exact fields cleared are hard-coded below.
//   - Does not fabricate evidence and does not force a state. The reset
//     clears the rejection fields and moves `state` off "REJECTED" to a
//     neutral placeholder ("CANDIDATE") ONLY so reconcileObservations'
//     existing "active generation" branch picks the row back up — that
//     same call immediately recomputes the REAL state (CONFIRMED /
//     CANDIDATE / SUPPRESSED) from the customer's real, untouched
//     TasteEvidence rows, in the same request, before anything is
//     returned. No threshold, weight, contradiction, or feedback-write
//     semantic in taste-contract.ts / taste-reconcile.server.ts /
//     taste-feedback-engine.ts is modified by this route.
//
// GET  → read-only preview: which REJECTED tendencies exist right now and
//        exactly what a reset would clear. No write.
// POST → performs the reset for those same rows, then re-runs
//        reconcileObservations(customerId), then returns the resulting
//        states computed from real evidence.

import { type LoaderFunctionArgs, type ActionFunctionArgs, data } from "react-router";
import { requireCurrentNaiaCustomer } from "~/lib/naia-session.server";
import prisma from "~/db.server";
import { reconcileObservations } from "~/lib/ai/taste-reconcile.server";

const RESET_FIELDS = {
  customerFeedback: null,
  notQuiteReason: null,
  notQuiteNote: null,
  customerFeedbackAt: null,
} as const;

async function findRejected(customerId: string) {
  return prisma.styleTendency.findMany({
    where: { customerId, state: "REJECTED", customerFeedback: "not-quite" },
    select: { id: true, dimension: true, value: true, generation: true },
  });
}

export async function loader({ request }: LoaderFunctionArgs) {
  if (process.env.NAIA_PROJECT_VARIANT !== "staging") {
    return new Response("Not Found", { status: 404 });
  }
  const customer = await requireCurrentNaiaCustomer(request);
  const rejected = await findRejected(customer.id);

  return data({
    rejectedTendenciesFound: rejected.map(r => ({ dimension: r.dimension, value: r.value, generation: r.generation })),
    exactFieldsToClear: Object.keys(RESET_FIELDS),
    reconciliationPathToRun: "reconcileObservations(customerId) — the same function writeSourceEvidence/backfillTaste already call; re-evaluates every (dimension, value) group from this customer's real, untouched TasteEvidence rows",
    note: "GET is read-only — nothing has been changed. POST to this same URL to perform the reset.",
  });
}

export async function action({ request }: ActionFunctionArgs) {
  if (process.env.NAIA_PROJECT_VARIANT !== "staging") {
    return new Response("Not Found", { status: 404 });
  }
  if (request.method !== "POST") {
    return data({ error: "method-not-allowed" }, { status: 405 });
  }

  const customer = await requireCurrentNaiaCustomer(request);
  const rejected = await findRejected(customer.id);

  if (rejected.length === 0) {
    return data({ ok: true, tendenciesReset: [], reconciliationRun: false, resultingStates: [] });
  }

  // Move state off REJECTED so reconcileObservations' active-generation
  // branch re-evaluates these rows — it overwrites `state` with the real
  // computed value below in the same request. CANDIDATE is a placeholder
  // only; it is never read by anything before reconcile runs.
  await prisma.styleTendency.updateMany({
    where: { id: { in: rejected.map(r => r.id) } },
    data: { ...RESET_FIELDS, state: "CANDIDATE", updatedAt: new Date() },
  });

  await reconcileObservations(customer.id);

  const resultingStates = await prisma.styleTendency.findMany({
    where: { id: { in: rejected.map(r => r.id) } },
    select: {
      dimension: true, value: true, state: true,
      effectiveSupport: true, wNet: true, distinctRecords: true,
    },
  });

  return data({
    ok: true,
    tendenciesReset: rejected.map(r => ({ dimension: r.dimension, value: r.value })),
    fieldsCleared: Object.keys(RESET_FIELDS),
    reconciliationRun: true,
    resultingStates,
  });
}
