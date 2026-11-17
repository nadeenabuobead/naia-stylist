// app/routes/api.clerk-cleanup-sweep.ts
//
// The actual operational trigger for sweepPendingClerkCleanups
// (clerk-cleanup.server.ts) — without something hitting this route on a
// recurring schedule, a Clerk user whose deletion failed during an
// unattended customers/redact or shop/redact webhook is never retried
// unless a human happens to open /admin/maintenance and click it manually.
//
// No built-in cron: Vercel Cron only ever targets a project's PRODUCTION
// deployment (documented, not assumed — see
// api.staging-full-look-vto-sweep.ts's own header for the verified source),
// and this codebase's own established pattern for exactly this situation is
// a scheduled GitHub Actions workflow hitting a secret-gated route instead
// (same file, see api.export-zip-sweep.ts). This route follows that same
// pattern, with its own dedicated secret — not CRON_SECRET or any other
// route's secret — so a leak here exposes only "can trigger this one
// cleanup-retry sweep," nothing else.
//
// AUTH: two independent, header-only mechanisms, neither ever accepted from
// a query string or body, both constant-time compared:
//   - Authorization: Bearer <CRON_SECRET> — in case Vercel Cron against this
//     path is ever made to work (e.g. this project's production deployment
//     is the one actually serving customer traffic) without a code change.
//   - x-clerk-cleanup-sweep-secret matching CLERK_CLEANUP_SWEEP_SECRET.
//
// Bounded per call (see CLERK_CLEANUP_SWEEP_BATCH_SIZE) — the response's
// `more` field tells the caller whether to expect another unresolved
// batch; a short recurring schedule (e.g. every 15–30 minutes) drains any
// backlog within a few calls rather than needing one unbounded run.
//
// Never touches a Customer row, VirtualTryOnJob, or any other unrelated
// table — only PendingClerkCleanup rows this sweep itself owns, via the
// exact same retryPendingClerkCleanup call /admin/maintenance's manual
// button already uses.

import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { timingSafeEqual } from "node:crypto";
import { sweepPendingClerkCleanups } from "~/lib/clerk-cleanup.server";

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

  const dedicatedSecret = process.env.CLERK_CLEANUP_SWEEP_SECRET;
  const provided = request.headers.get("x-clerk-cleanup-sweep-secret");
  if (dedicatedSecret && provided) {
    return timingSafeStringEqual(provided, dedicatedSecret);
  }
  return false;
}

export async function loader({ request }: LoaderFunctionArgs) {
  if (!isAuthorizedSweepRequest(request)) {
    return data({ ok: false, reason: "unauthorized" }, { status: 401 });
  }

  const result = await sweepPendingClerkCleanups();
  return data(
    { ok: true, ...result },
    { headers: { "Cache-Control": "no-store" } },
  );
}
