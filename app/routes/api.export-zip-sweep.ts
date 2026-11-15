// app/routes/api.export-zip-sweep.ts
//
// The actual operational trigger for sweepExpiredExportJobs
// (customer-export-zip-large.server.ts) — without something hitting this
// route on a recurring schedule, an expired large export's Cloudinary bytes
// are never deleted. expiresAt on CustomerExportJob only blocks issuing a
// new signed download link; it does not remove anything by itself.
//
// No built-in cron: Vercel Cron only ever targets a project's PRODUCTION
// deployment (documented, not assumed — see
// api.staging-full-look-vto-sweep.ts's own header for the verified source),
// and this codebase's own established pattern for exactly this situation is
// a scheduled GitHub Actions workflow hitting a secret-gated route instead
// (same file). This route follows that same pattern, with its own
// dedicated secret — not CRON_SECRET or any other route's secret — so a
// leak here exposes only "can trigger this one cleanup sweep," nothing else.
//
// AUTH: two independent, header-only mechanisms, neither ever accepted from
// a query string or body, both constant-time compared:
//   - Authorization: Bearer <CRON_SECRET> — in case Vercel Cron against this
//     path is ever made to work (e.g. this project's production deployment
//     is the one actually serving customer traffic) without a code change.
//   - x-export-zip-sweep-secret matching EXPORT_ZIP_SWEEP_SECRET.
//
// Bounded per call (see SWEEP_BATCH_SIZE) — the response's `more` field
// tells the caller whether to expect another expired batch; a short
// recurring schedule (e.g. every 15–30 minutes) drains any backlog within a
// few calls rather than needing one unbounded run.
//
// Never mutates a VirtualTryOnJob, NaiaModel, or any other unrelated table —
// only CustomerExportJob rows this sweep itself owns.

import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { timingSafeEqual } from "node:crypto";
import { sweepExpiredExportJobs } from "~/lib/customer-export-zip-large.server";

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

  const dedicatedSecret = process.env.EXPORT_ZIP_SWEEP_SECRET;
  const provided = request.headers.get("x-export-zip-sweep-secret");
  if (dedicatedSecret && provided) {
    return timingSafeStringEqual(provided, dedicatedSecret);
  }
  return false;
}

export async function loader({ request }: LoaderFunctionArgs) {
  if (!isAuthorizedSweepRequest(request)) {
    return data({ ok: false, reason: "unauthorized" }, { status: 401 });
  }

  const result = await sweepExpiredExportJobs();
  return data(
    { ok: true, ...result },
    { headers: { "Cache-Control": "no-store" } },
  );
}
