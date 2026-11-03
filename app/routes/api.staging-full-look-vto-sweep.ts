// app/routes/api.staging-full-look-vto-sweep.ts
//
// STAGING-ONLY. Independent cleanup for Full-Look VTO QA pause sessions
// abandoned permanently (browser closed, never returns) — the one scenario
// nothing else in this app ever reaches, since every other cleanup path
// (advanceFullLookChain's own fast path, FAILED/COMPLETED transitions) only
// runs when a request for that specific chain arrives. This route makes
// that independent of any such request, for every customer and every
// reservation scope at once — see sweepAbandonedFullLookPauses's own doc
// comment in full-look-tryon-real.server.ts for exactly what it does and
// why it's safe to call repeatedly.
//
// VERCEL CRON DOES NOT TRIGGER THIS ROUTE ON THIS PROJECT (verified, not
// assumed): Vercel's own docs state cron jobs always target a project's
// PRODUCTION deployment — "Vercel makes an HTTP GET request to your
// project's production deployment URL." This project's staging environment
// is deliberately served from a Preview-target deployment, never promoted
// to Production (see every other staging route's own header comment on
// why) — so a vercel.json `crons` entry here would be silently dead
// configuration, never actually firing. No such entry exists. Until an
// explicitly-approved external trigger (e.g. a scheduled GitHub Actions
// workflow hitting this URL) is set up, this route is reachable only by
// deliberate, authenticated invocation — by an operator directly, or by
// whatever external scheduler is later approved for that purpose.
//
// AUTH: two independent, header-only mechanisms, neither ever accepted from
// a query string or body:
//   - Authorization: Bearer <CRON_SECRET> — Vercel's own documented
//     convention for securing cron-triggered routes, honored here in case
//     Vercel Cron against this path is ever made to work (e.g. a future
//     Production-target staging setup) without any code change.
//   - x-seed-secret matching STAGING_SEED_SECRET or WI_QA_LOGIN_SECRET —
//     reuses the EXACT secret convention api.seed-staging.jsx already
//     established, rather than inventing a third secret scheme for one
//     more staging-only diagnostic endpoint.
// Constant-time comparison on both — this gates a real (if narrowly-scoped)
// write capability (Cloudinary deletes), not a read-only diagnostic.
//
// NEVER deletes an active (not-yet-expired) paused session, never mutates
// any VirtualTryOnJob row, never calls FASHN, never resets any reservation.

import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { timingSafeEqual } from "node:crypto";
import { sweepAbandonedFullLookPauses } from "~/lib/ai/full-look-tryon-real.server";

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

  const provided = request.headers.get("x-seed-secret");
  if (!provided) return false;
  const candidates = [process.env.STAGING_SEED_SECRET, process.env.WI_QA_LOGIN_SECRET].filter(
    (v): v is string => typeof v === "string" && v.length > 0,
  );
  return candidates.some((candidate) => timingSafeStringEqual(provided, candidate));
}

export async function loader({ request }: LoaderFunctionArgs) {
  if (process.env.NAIA_PROJECT_VARIANT !== "staging") {
    throw new Response("Not Found", { status: 404 });
  }
  if (!isAuthorizedSweepRequest(request)) {
    return data({ ok: false, reason: "unauthorized" }, { status: 401 });
  }

  const result = await sweepAbandonedFullLookPauses();
  return data(
    { ok: true, ...result },
    { headers: { "Cache-Control": "no-store" } },
  );
}
