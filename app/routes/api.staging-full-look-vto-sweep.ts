// app/routes/api.staging-full-look-vto-sweep.ts
//
// STAGING-ONLY. Independent cleanup for Full-Look VTO chains abandoned
// permanently (browser closed, never returns) — the one scenario nothing
// else in this app ever reaches, since every other cleanup path
// (advanceFullLookChain's own fast path, FAILED/COMPLETED transitions) only
// runs when a request for that specific chain arrives. This route makes
// that independent of any such request, for every customer and every
// reservation scope at once.
//
// Runs BOTH independent sweeps this app has for this problem — see each
// function's own doc comment in full-look-tryon-real.server.ts for exactly
// what it does and why it's safe to call repeatedly:
//   - sweepAbandonedFullLookPauses: the QA pause checkpoint (AWAITING_CONTINUE)
//     abandoned without ever continuing. Image cleanup only, no status write.
//   - sweepStaleFullLookSteps (2026-11-14): a mid-chain step left in
//     PROCESSING because the customer never polled again. Transitions the
//     job to TIMED_OUT via a status-guarded conditional write (so it stops
//     blocking that customer's cooldown check forever) and cleans up any
//     earlier steps' now-orphaned images.
//
// VERCEL CRON DOES NOT TRIGGER THIS ROUTE ON THIS PROJECT (verified, not
// assumed): Vercel's own docs state cron jobs always target a project's
// PRODUCTION deployment — "Vercel makes an HTTP GET request to your
// project's production deployment URL." This project's staging environment
// is deliberately served from a Preview-target deployment, never promoted
// to Production — so a vercel.json `crons` entry here would be silently
// dead configuration; none exists. The approved alternative is a scheduled
// GitHub Actions workflow (.github/workflows/full-look-vto-sweep.yml)
// hitting this path on the STABLE ALIAS domain — an unaliased Preview URL
// sits behind Vercel Authentication, which no external request can pass.
//
// AUTH (2026-11-04): a DEDICATED secret, not a reused broader-access one.
// Two independent, header-only mechanisms, neither ever accepted from a
// query string or body:
//   - Authorization: Bearer <CRON_SECRET> — Vercel's own documented
//     convention for securing cron-triggered routes, honored here in case
//     Vercel Cron against this path is ever made to work (e.g. a future
//     Production-target staging setup) without any code change.
//   - x-full-look-sweep-secret matching FULL_LOOK_VTO_SWEEP_SECRET — a
//     secret scoped to ONLY this endpoint's two sweep capabilities
//     (Cloudinary deletes of already-abandoned intermediate images, plus,
//     as of 2026-11-14, a status-guarded TIMED_OUT write on an already-stale
//     PROCESSING job — see sweepStaleFullLookSteps), deliberately NOT
//     STAGING_SEED_SECRET or WI_QA_LOGIN_SECRET (api.seed-staging.jsx's own
//     secrets, which also gate customer/session creation and far broader
//     staging access). A leak of this value exposes nothing beyond "can
//     trigger these two cleanup sweeps" — it cannot create accounts, log
//     anyone in, or touch any other data.
// Constant-time comparison on both — this gates a real (if narrowly-scoped)
// write capability, not a read-only diagnostic.
//
// NEVER deletes an active (not-yet-expired) paused session, never calls
// FASHN, never resets any reservation. The only VirtualTryOnJob mutation
// either sweep performs is sweepStaleFullLookSteps's own status-guarded
// TIMED_OUT write on a job already stale by STALE_PROCESSING_THRESHOLD_MS —
// never on an active one.

import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { timingSafeEqual } from "node:crypto";
import { sweepAbandonedFullLookPauses, sweepStaleFullLookSteps } from "~/lib/ai/full-look-tryon-real.server";

function timingSafeStringEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

function isAuthorizedSweepRequest(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) return true;

  const dedicatedSecret = process.env.FULL_LOOK_VTO_SWEEP_SECRET;
  const provided = request.headers.get("x-full-look-sweep-secret");
  if (dedicatedSecret && provided) {
    return timingSafeStringEqual(provided, dedicatedSecret);
  }
  return false;
}

export async function loader({ request }: LoaderFunctionArgs) {
  if (process.env.NAIA_PROJECT_VARIANT !== "staging") {
    throw new Response("Not Found", { status: 404 });
  }
  if (!isAuthorizedSweepRequest(request)) {
    return data({ ok: false, reason: "unauthorized" }, { status: 401 });
  }

  // Independent sweeps, independent failure handling — one throwing must
  // never prevent the other from running or being reported.
  const [pauseResult, staleResult] = await Promise.allSettled([
    sweepAbandonedFullLookPauses(),
    sweepStaleFullLookSteps(),
  ]);

  const pauseSweep = pauseResult.status === "fulfilled"
    ? pauseResult.value
    : { error: String(pauseResult.reason) };
  const staleStepSweep = staleResult.status === "fulfilled"
    ? staleResult.value
    : { error: String(staleResult.reason) };

  return data(
    { ok: pauseResult.status === "fulfilled" && staleResult.status === "fulfilled", pauseSweep, staleStepSweep },
    { headers: { "Cache-Control": "no-store" } },
  );
}
