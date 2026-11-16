// app/routes/api.full-look-vto-reconcile.ts
//
// Server-side reconciliation trigger for the REAL customer-facing
// Full-Look VTO pipeline — closes the structural gap confirmed during the
// Attempt C investigation: the real customer route only ever checks
// FASHN status reactively, when the customer's own browser polls. A
// customer who closes the tab mid-generation and doesn't return within
// FASHN's documented 60-minute return_base64 window loses the image,
// regardless of any retry logic, because nothing checks on their behalf
// while they're away.
//
// VERIFIED, NOT ASSUMED, before choosing Vercel Cron as the trigger:
// api.staging-full-look-vto-sweep.ts (this same codebase, 2026-11-04)
// already hit this exact question for its OWN scheduled backstop, and
// documents that Vercel Cron never applies there — "Vercel Cron Jobs
// always target a project's PRODUCTION deployment... this project's
// staging environment is deliberately served from a Preview-target
// deployment, never promoted to Production," so that route is scheduled
// via GitHub Actions instead. That constraint does NOT apply here: this
// route exists to protect the real customer pipeline, which runs on the
// actual PRODUCTION deployment — exactly the target Vercel Cron is built
// for. Confirmed directly against Vercel's own docs (vercel.com/docs/
// cron-jobs, vercel.com/docs/cron-jobs/manage-cron-jobs): cron invokes
// via HTTP GET, sends `Authorization: Bearer <CRON_SECRET>`, and Vercel
// can invoke a job more than once concurrently if one run outlasts the
// schedule interval — this route's own idempotency (see
// reconcilePendingFullLookPredictions's header) is what makes that safe
// without a distributed lock.
//
// GET only for the real Vercel Cron trigger path (matches their
// documented method exactly) — also accepts POST for a manual/ops-
// triggered run, same auth either way, mirroring this project's own
// admin.maintenance.tsx convention for its other deferred-cron actions.
//
// AUTH — same dual-secret shape as api.staging-full-look-vto-sweep.ts,
// for the same reason (a route a schedule reaches with no human session
// needs its own always-available credential, independent of whichever
// scheduler ends up calling it):
//   - Authorization: Bearer <CRON_SECRET> — Vercel's own convention; this
//     is the one that actually matters once a vercel.json `crons` entry
//     is approved and added.
//   - x-full-look-reconcile-secret matching FULL_LOOK_VTO_RECONCILE_SECRET
//     — a DEDICATED secret scoped to only this endpoint's one capability
//     (checking and persisting an already-completed, already-paid-for
//     prediction). Deliberately its own secret, not CRON_SECRET or any
//     broader-access one — a leak exposes nothing beyond "can trigger
//     this one read-mostly reconciliation," never account access,
//     customer creation, or any other data.
// Both compared timing-safe. Fails closed: neither secret configured, or
// neither header matching, rejects every request — never falls open.
//
// NOT ACTIVATED: no `crons` entry exists in vercel.json yet. Per this
// project's own standing policy (see data-retention.server.ts's header —
// "adding [crons] is a shared Vercel configuration change this
// workstream is not authorised to make"), wiring the actual schedule is
// a separate, explicitly-approved step — this route is complete and
// tested, callable manually (GET/POST, with either secret) right now,
// but nothing currently schedules it.
//
// NEVER submits anything new: reconcilePendingFullLookPredictions (full-
// look-tryon-real.server.ts) only ever performs the same read-only FASHN
// status check every live customer poll already makes, and only ever
// persists an ALREADY-COMPLETED prediction's output. It cannot create a
// new paid prediction and cannot retry a job once it has left
// "PROCESSING" — see that function's own header for the full reasoning.
//
// Response is aggregate counts only (how many rows were scanned/
// recovered/still-processing/check-failed) — no job IDs, no customer
// IDs, no image data, ever.

import { data } from "react-router";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { timingSafeEqual } from "node:crypto";
import { reconcilePendingFullLookPredictions } from "~/lib/ai/full-look-tryon-real.server";

function timingSafeStringEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

function isAuthorizedReconcileRequest(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (cronSecret && authHeader) {
    const expected = `Bearer ${cronSecret}`;
    if (authHeader.length === expected.length && timingSafeStringEqual(authHeader, expected)) return true;
  }

  const dedicatedSecret = process.env.FULL_LOOK_VTO_RECONCILE_SECRET;
  const provided = request.headers.get("x-full-look-reconcile-secret");
  if (dedicatedSecret && provided) {
    return timingSafeStringEqual(provided, dedicatedSecret);
  }
  return false;
}

async function handleReconcileRequest(request: Request) {
  if (!isAuthorizedReconcileRequest(request)) {
    return data({ ok: false, code: "unauthorized" }, { status: 401 });
  }
  const result = await reconcilePendingFullLookPredictions();
  return data({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
}

export async function loader({ request }: LoaderFunctionArgs) {
  return handleReconcileRequest(request);
}

export async function action({ request }: ActionFunctionArgs) {
  return handleReconcileRequest(request);
}
