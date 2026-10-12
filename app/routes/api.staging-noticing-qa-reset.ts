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
// not a bug — there is no "undo rejection" (or "undo accurate") anywhere
// in the real product. A QA tester who clicks Accurate or Not Quite while
// manually testing has no way to get a card back to a neutral,
// button-showing state for a second test pass. This route is the
// one-time, explicitly-authorised exception: a narrow, staging-only reset
// of exactly that feedback, scoped to the logged-in customer only, so the
// same real evidence can be re-evaluated by the unmodified reconciliation
// logic.
//
// Extended from the original not-quite-only version: an Accurate
// submission never changes `state` at all (see
// taste-feedback-engine.ts's applyFeedbackWithDeps — the else branch
// writes customerFeedback/customerFeedbackAt only), so an "accurate" row
// needed its own, simpler reset path that leaves `state` untouched —
// unlike a REJECTED row, which needs `state` moved off REJECTED first or
// reconcileObservations will keep refusing to touch it.
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
//     customerFeedback IN ("not-quite", "accurate") for this one customer.
//     Never touches TasteEvidence, StyleMeOutcome, PostOutfitReview,
//     ClosetItem, BuyOrSkipAnalysis/BuySkipOutcome, or OnboardingProfile
//     (Style Passport) in any way — no deletes, no writes, not even a
//     read beyond what reconcileObservations already does internally.
//   - No raw SQL, no arbitrary field names accepted from the client — the
//     exact fields cleared (customerFeedback, customerFeedbackAt,
//     notQuiteReason, notQuiteNote) are hard-coded below, for both
//     feedback types.
//   - Does not fabricate evidence and does not force a state. For a
//     REJECTED row, the reset clears the feedback fields and moves
//     `state` off "REJECTED" to a neutral placeholder ("CANDIDATE") ONLY
//     so reconcileObservations' existing "active generation" branch picks
//     the row back up. For an "accurate" row (never REJECTED), `state` is
//     left completely untouched — only the feedback fields are cleared.
//     reconcileObservations then immediately recomputes the REAL state
//     (CONFIRMED / CANDIDATE / SUPPRESSED) for every affected row from the
//     customer's real, untouched TasteEvidence, in the same request,
//     before anything is returned. No threshold, weight, contradiction,
//     or feedback-write semantic in taste-contract.ts /
//     taste-reconcile.server.ts / taste-feedback-engine.ts is modified by
//     this route.
//
// GET  → read-only preview: which not-quite/accurate tendencies exist
//        right now and exactly what a reset would clear. No write.
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

type FeedbackRow = { id: string; dimension: string; value: string; generation: number; state: string; customerFeedback: string | null };

async function findFeedbackRows(customerId: string): Promise<FeedbackRow[]> {
  return prisma.styleTendency.findMany({
    where: { customerId, customerFeedback: { in: ["not-quite", "accurate"] } },
    select: { id: true, dimension: true, value: true, generation: true, state: true, customerFeedback: true },
  });
}

export async function loader({ request }: LoaderFunctionArgs) {
  if (process.env.NAIA_PROJECT_VARIANT !== "staging") {
    return new Response("Not Found", { status: 404 });
  }
  const customer = await requireCurrentNaiaCustomer(request);
  const rows = await findFeedbackRows(customer.id);

  return data({
    tendenciesFound: rows.map(r => ({ dimension: r.dimension, value: r.value, generation: r.generation, state: r.state, customerFeedback: r.customerFeedback })),
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
  const rows = await findFeedbackRows(customer.id);

  if (rows.length === 0) {
    return data({ ok: true, tendenciesReset: [], reconciliationRun: false, resultingStates: [] });
  }

  const rejectedRows = rows.filter(r => r.state === "REJECTED");
  const accurateRows = rows.filter(r => r.state !== "REJECTED");

  if (rejectedRows.length > 0) {
    // Move state off REJECTED so reconcileObservations' active-generation
    // branch re-evaluates these rows — it overwrites `state` with the
    // real computed value below, in the same request. CANDIDATE is a
    // placeholder only; it is never read by anything before reconcile
    // runs.
    await prisma.styleTendency.updateMany({
      where: { id: { in: rejectedRows.map(r => r.id) } },
      data: { ...RESET_FIELDS, state: "CANDIDATE", updatedAt: new Date() },
    });
  }
  if (accurateRows.length > 0) {
    // An "accurate" row was never REJECTED and its state already reflects
    // real evidence — only the feedback fields themselves need clearing,
    // state is left exactly as-is.
    await prisma.styleTendency.updateMany({
      where: { id: { in: accurateRows.map(r => r.id) } },
      data: { ...RESET_FIELDS, updatedAt: new Date() },
    });
  }

  await reconcileObservations(customer.id);

  const resultingStates = await prisma.styleTendency.findMany({
    where: { id: { in: rows.map(r => r.id) } },
    select: {
      dimension: true, value: true, state: true,
      effectiveSupport: true, wNet: true, distinctRecords: true,
    },
  });

  return data({
    ok: true,
    tendenciesReset: rows.map(r => ({ dimension: r.dimension, value: r.value, previousFeedback: r.customerFeedback })),
    fieldsCleared: Object.keys(RESET_FIELDS),
    reconciliationRun: true,
    resultingStates,
  });
}
