// app/lib/customer-export-zip-large.server.ts
//
// Secure completion mechanism for the >300-image export case (see
// MAX_SYNC_EXPORT_IMAGES in customer-export-zip.server.ts) — the common
// synchronous-stream path there is completely unchanged; this is reached
// only when that path refuses with reason: "too_large".
//
// Flow:
//   1. buildLargeCustomerExportZip — builds the SAME archive contents as
//      the normal path (reusing compileCustomerExport + planImages, never
//      re-deriving what gets bundled or which photos are excluded), buffers
//      the complete ZIP, uploads it to Cloudinary as a private RAW asset,
//      and records a CustomerExportJob row.
//   2. getExportJobForCustomer / buildExportJobDownloadUrl — the retrieval
//      side, used both for the first download and for a customer retrying
//      after a failed/expired download without triggering a full rebuild.
//      Customer-isolated by construction: looked up by (id, customerId)
//      together, never id alone — a mismatched customerId is indistinguishable
//      from "not found," same discipline as every other per-customer job
//      table in this app (VirtualTryOnJob, BuyOrSkipAnalysis).
//   3. sweepExpiredExportJobs — the ONLY thing that actually deletes the
//      Cloudinary bytes. Admin-triggered (or hit via api.export-zip-sweep.ts
//      with a dedicated secret, matching the GitHub-Actions-scheduled
//      pattern api.staging-full-look-vto-sweep.ts already established for
//      exactly this "no built-in cron" situation) — see that route for the
//      actual operational trigger. Retention correction, explicit: expiresAt
//      controls ACCESS only (buildExportJobDownloadUrl refuses to issue a
//      new signed link once past it) — it does NOT delete anything by
//      itself. If sweepExpiredExportJobs is never invoked by anything, an
//      expired export's Cloudinary bytes persist indefinitely, inaccessible
//      through this app but not actually gone. Final Integration MUST wire
//      api.export-zip-sweep.ts into a real recurring trigger before this can
//      be described as "deleted after 24 hours" anywhere customer-facing.
//
// Memory/time safety: MAX_LARGE_EXPORT_IMAGES below is a hard outer ceiling
// distinct from MAX_SYNC_EXPORT_IMAGES — this path buffers the complete
// archive before uploading (no verified streaming-upload path to this
// provider exists in this codebase, and a hand-rolled one couldn't be
// verified without a live Cloudinary call, which is out of bounds here), so
// peak memory scales with total image count. See the constant's own comment
// for the exact reasoning.
//
// Overlap guard (2026-11-16): buildLargeCustomerExportZip reserves its
// CustomerExportJob row inside a Serializable transaction (see
// reserveExportJobSlot) rather than calling .create() directly — otherwise a
// double-click, a retried fetch, or a customer re-requesting while their
// first >300-image export is still building would each start an independent
// full fetch-archive-upload cycle for the same customer at the same time.

import archiver from "archiver";
import prisma from "../db.server";
import { compileCustomerExport } from "./customer-privacy.server";
import { planImages, ZIP_NOTE } from "./customer-export-zip.server";
import {
  getCloudinaryConfig,
  buildPrivateDownloadUrl,
  deleteCloudinaryAsset,
  uploadCloudinaryRawPrivate,
  type CloudinaryConfig,
} from "./cloudinary-admin.server";

const EXPORT_EXPIRY_HOURS = 24;
const EXPORT_RESOURCE_TYPE = "raw";
const EXPORT_DELIVERY_TYPE = "private";
const DOWNLOAD_LINK_EXPIRY_SECONDS = 600; // 10 minutes — same signed-link convention as every other asset in this app

// Hard outer ceiling for the buffered path. Chosen as a data-anomaly
// backstop, not a realistic-customer sizing: the real Closet cap is 250
// (plan-limits.server.ts) and no genuine customer today comes remotely
// close to this number — same reasoning MAX_SYNC_EXPORT_IMAGES's own
// comment already uses for 300. At the code-enforced 5MB-per-image upload
// ceiling, 1000 images is ~5GB worst case; a request this large is treated
// as a data anomaly needing manual handling (same "contact support"
// fallback as the pre-existing too_large case), not something the
// synchronous buffered build should ever attempt. Final Integration should
// confirm this stays comfortably under the deployed function's actual
// memory limit — if real traffic ever approaches it, LOWER this constant
// rather than raise the function's memory/duration budget to chase it.
export const MAX_LARGE_EXPORT_IMAGES = 1000;

// Real byte-size backstop, not just an image-count proxy. MAX_LARGE_EXPORT_IMAGES
// alone assumes every image sits near the enforced per-image upload cap (5MB
// — closet._index.tsx's own SERVER_MAX_BYTES/MAX_FILE_BYTES convention,
// duplicated here rather than imported since a route module isn't a
// server-lib dependency) — true only in the worst case; the count check by
// itself never actually verifies the real archive size before buffering it.
// This tracks cumulative bytes actually fetched and aborts before memory
// pressure threatens the deployed function's own ceiling, rather than
// discovering the problem via an OOM crash mid-build. 2GB leaves headroom
// under Vercel's classic serverless function memory ceiling (3008MB) for
// the archiver's internal buffering, Node/V8 overhead, and the one image
// buffer transiently held mid-fetch.
export const MAX_LARGE_EXPORT_BYTES = 2 * 1024 * 1024 * 1024;

// Mirrors STALE_PROCESSING_THRESHOLD_MS's own 10-minute convention
// (full-look-tryon-real.server.ts) for the same underlying reason: this
// build runs entirely synchronously within one request, so while its
// container is alive PROCESSING means "actively running right now." Any
// container that dies mid-build (serverless function timeout) does so in
// well under 10 minutes, so a PROCESSING row surviving past this threshold
// can only mean its owning container is gone, never that it's still
// legitimately working.
export const STALE_EXPORT_PROCESSING_THRESHOLD_MS = 10 * 60 * 1000;

// Local retry/serialization-conflict convention — mirrors entitlement.server.ts's
// identically-shaped (but unexported) helpers for its own atomic
// reservations; duplicated rather than imported since that module's helpers
// aren't exported and this is a different domain's reservation.
const MAX_EXPORT_TX_RETRIES = 2;

function isExportSerializationError(e: unknown): boolean {
  // Prisma P2034: Transaction failed due to a write conflict or a deadlock.
  return (e as { code?: string })?.code === "P2034";
}

function exportPublicId(customerId: string, jobId: string): string {
  return `naia-exports/${customerId}/${jobId}.zip`;
}

export type RunExportReservationFn = <T>(
  fn: (tx: Pick<typeof prisma, "customerExportJob">) => Promise<T>,
) => Promise<T>;

const _runExportReservationTransaction: RunExportReservationFn = (fn) =>
  prisma.$transaction((tx: Pick<typeof prisma, "customerExportJob">) => fn(tx), {
    isolationLevel: "Serializable",
  });

export type ReserveExportJobResult =
  | { ok: true; job: { id: string } }
  | { ok: false; reason: "already_processing"; jobId: string };

// Closes the race a plain .create() call leaves open: re-checks for an
// existing, non-stale PROCESSING job and creates the new row inside one
// Serializable transaction, so two concurrent requests from the same
// customer cannot both pass the check before either commits. A stale
// PROCESSING row (see STALE_EXPORT_PROCESSING_THRESHOLD_MS) is terminalized
// in the SAME transaction as the fresh create — same reconciliation shape as
// reconcileStaleFullLookJobForCustomer (full-look-tryon-real.server.ts),
// applied to this job table instead.
export async function reserveExportJobSlot(
  customerId: string,
  imageCount: number,
  runTransaction: RunExportReservationFn = _runExportReservationTransaction,
  nowFn: () => number = Date.now,
): Promise<ReserveExportJobResult> {
  for (let attempt = 0; attempt <= MAX_EXPORT_TX_RETRIES; attempt++) {
    try {
      return await runTransaction(async (tx) => {
        const existing = await tx.customerExportJob.findFirst({
          where: { customerId, status: "PROCESSING" },
          orderBy: { createdAt: "desc" },
        });
        if (existing) {
          const ageMs = nowFn() - existing.createdAt.getTime();
          if (ageMs <= STALE_EXPORT_PROCESSING_THRESHOLD_MS) {
            return { ok: false, reason: "already_processing", jobId: existing.id };
          }
          await tx.customerExportJob.update({
            where: { id: existing.id },
            data: { status: "FAILED", errorCode: "ABANDONED_STALE_PROCESSING" },
          });
        }
        const job = await tx.customerExportJob.create({
          data: { customerId, imageCount, status: "PROCESSING" },
        });
        return { ok: true, job };
      });
    } catch (e) {
      if (isExportSerializationError(e) && attempt < MAX_EXPORT_TX_RETRIES) continue;
      throw e;
    }
  }
  // Unreachable — loop always returns or throws.
  throw new Error("Unexpected exit from reserveExportJobSlot retry loop");
}

export interface LargeExportDeps {
  _fetch?: typeof fetch;
  _uploadRaw?: typeof uploadCloudinaryRawPrivate;
  _runReservation?: RunExportReservationFn;
  _now?: () => number;
  // Overridable only so tests can exercise the ceiling without allocating
  // real gigabytes of Buffer data. Production callers never pass this —
  // it always defaults to the real MAX_LARGE_EXPORT_BYTES.
  _maxBytes?: number;
}

export type BuildLargeExportResult =
  | { ok: true; jobId: string }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "exceeds_hard_limit"; imageCount: number }
  | { ok: false; reason: "already_processing"; jobId: string }
  | { ok: false; reason: "upload_failed"; jobId: string; errorCode: string };

export async function buildLargeCustomerExportZip(
  customerId: string,
  imageCount: number,
  deps: LargeExportDeps = {},
): Promise<BuildLargeExportResult> {
  // Checked BEFORE touching the DB or compiling anything — a data-anomaly
  // count should never even start the expensive path, same discipline as
  // MAX_SYNC_EXPORT_IMAGES's own check in the synchronous path.
  if (imageCount > MAX_LARGE_EXPORT_IMAGES) {
    return { ok: false, reason: "exceeds_hard_limit", imageCount };
  }

  const _fetch = deps._fetch ?? fetch;
  const _uploadRaw = deps._uploadRaw ?? uploadCloudinaryRawPrivate;
  const _maxBytes = deps._maxBytes ?? MAX_LARGE_EXPORT_BYTES;

  const exportData = await compileCustomerExport(customerId);
  if (!exportData) return { ok: false, reason: "not_found" };

  const reservation = await reserveExportJobSlot(
    customerId,
    imageCount,
    deps._runReservation,
    deps._now,
  );
  if (!reservation.ok) {
    return { ok: false, reason: "already_processing", jobId: reservation.jobId };
  }
  const job = reservation.job;

  const { data, images } = planImages(exportData);
  const archive = archiver("zip", { zlib: { level: 6 } });
  const chunks: Buffer[] = [];
  archive.on("data", (chunk: Buffer) => chunks.push(chunk));

  const imageFetchFailures: string[] = [];
  let bytesFetched = 0;
  let exceededByteCeiling = false;
  // Sequential, not parallel — same reasoning as the common path: one image
  // buffered at a time keeps peak memory bounded regardless of total count.
  for (const img of images) {
    try {
      const res = await _fetch(img.url);
      if (!res.ok) {
        imageFetchFailures.push(img.filename);
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      bytesFetched += buf.length;
      if (bytesFetched > _maxBytes) {
        // Stop fetching immediately — the archive built so far is
        // incomplete and must never be finalized/uploaded as if it were a
        // real export. Terminalized as its own distinct errorCode below,
        // never silently truncated and marked COMPLETED.
        exceededByteCeiling = true;
        break;
      }
      archive.append(buf, { name: img.filename });
    } catch {
      imageFetchFailures.push(img.filename);
    }
  }

  if (exceededByteCeiling) {
    archive.destroy();
    const errorCode = "EXCEEDS_BYTE_CEILING";
    await prisma.customerExportJob.update({ where: { id: job.id }, data: { status: "FAILED", errorCode } });
    return { ok: false, reason: "upload_failed", jobId: job.id, errorCode };
  }

  archive.append(JSON.stringify({ ...data, note: ZIP_NOTE, imageFetchFailures }, null, 2), { name: "data.json" });

  const archiveSettled = new Promise<void>((resolve, reject) => {
    archive.on("end", resolve);
    archive.on("error", reject);
  });

  try {
    await archive.finalize();
    await archiveSettled;
  } catch (err) {
    const errorCode = err instanceof Error ? err.message.slice(0, 200) : "ARCHIVE_BUILD_FAILED";
    await prisma.customerExportJob.update({ where: { id: job.id }, data: { status: "FAILED", errorCode } });
    return { ok: false, reason: "upload_failed", jobId: job.id, errorCode };
  }

  // Pass the chunks array straight through — NOT Buffer.concat(chunks).
  // Concatenating first would allocate a second full-size copy of the
  // entire archive in addition to the chunks already held, roughly
  // doubling peak memory for no benefit; uploadCloudinaryRawPrivate accepts
  // the chunk array natively (see its own comment for why).
  const publicId = exportPublicId(customerId, job.id);
  const uploadResult = await _uploadRaw(publicId, chunks, `naia-data-export-${job.id}.zip`, EXPORT_DELIVERY_TYPE);

  if (!uploadResult.ok) {
    await prisma.customerExportJob.update({
      where: { id: job.id },
      data: { status: "FAILED", errorCode: uploadResult.errorCode },
    });
    return { ok: false, reason: "upload_failed", jobId: job.id, errorCode: uploadResult.errorCode };
  }

  const expiresAt = new Date(Date.now() + EXPORT_EXPIRY_HOURS * 60 * 60 * 1000);
  await prisma.customerExportJob.update({
    where: { id: job.id },
    data: { status: "COMPLETED", publicId, completedAt: new Date(), expiresAt },
  });

  return { ok: true, jobId: job.id };
}

// Isolation by construction: id AND customerId together in the WHERE
// clause — never looked up by id alone. A mismatched customerId simply
// doesn't match any row; this function can never return another
// customer's job, and the caller cannot distinguish "wrong customer" from
// "job doesn't exist" — exactly as it should be.
export async function getExportJobForCustomer(jobId: string, customerId: string) {
  return prisma.customerExportJob.findFirst({ where: { id: jobId, customerId } });
}

export type ExportJobDownloadResult =
  | { ok: true; downloadUrl: string; expiresInSeconds: number }
  | { ok: false; reason: "not_found" | "not_ready" | "expired" };

export async function buildExportJobDownloadUrl(
  jobId: string,
  customerId: string,
  _getConfig: () => CloudinaryConfig | null = getCloudinaryConfig,
  nowFn: () => number = Date.now,
): Promise<ExportJobDownloadResult> {
  const job = await getExportJobForCustomer(jobId, customerId);
  if (!job) return { ok: false, reason: "not_found" };
  if (job.status !== "COMPLETED" || !job.publicId) return { ok: false, reason: "not_ready" };
  if (job.expiresAt && job.expiresAt.getTime() <= nowFn()) return { ok: false, reason: "expired" };

  const cfg = _getConfig();
  if (!cfg) return { ok: false, reason: "not_ready" };

  const downloadUrl = buildPrivateDownloadUrl(
    cfg,
    job.publicId,
    "zip",
    EXPORT_DELIVERY_TYPE,
    nowFn,
    DOWNLOAD_LINK_EXPIRY_SECONDS,
    undefined,
    EXPORT_RESOURCE_TYPE,
  );

  // Best-effort bookkeeping only — never blocks the response. The signed
  // link's own short expiry is what actually gates access, not this
  // timestamp; a failure here must not prevent the customer getting their link.
  await prisma.customerExportJob
    .update({ where: { id: job.id }, data: { downloadedAt: new Date() } })
    .catch(() => {});

  return { ok: true, downloadUrl, expiresInSeconds: DOWNLOAD_LINK_EXPIRY_SECONDS };
}

export interface SweepExpiredExportJobsResult {
  checked: number;
  deleted: number;
  failed: number;
  // True when more expired rows exist beyond this call's own batch cap —
  // the caller (the cron/admin trigger) should invoke this again rather
  // than assume one call always drains the full backlog.
  more: boolean;
}

// Bounded per call — an unbounded sweep could itself run long enough to
// risk a serverless timeout if a large backlog ever accumulates (e.g. the
// trigger route below went unwired for a while). Each invocation processes
// at most this many rows and reports whether more remain; the trigger is
// expected to run on a short recurring schedule (see
// api.export-zip-sweep.ts), so draining a backlog over a few calls is fine.
export const SWEEP_BATCH_SIZE = 50;

// Admin-triggered only — no cron exists for this, deliberately, matching
// data-retention.server.ts's own established convention for this codebase.
// In practice this must actually be invoked by something recurring (see
// api.export-zip-sweep.ts) or expired exports are never actually deleted
// from Cloudinary — expiresAt alone only blocks issuing a new signed link,
// it does not remove the underlying bytes.
export async function sweepExpiredExportJobs(
  _deleteAsset: typeof deleteCloudinaryAsset = deleteCloudinaryAsset,
  nowFn: () => number = Date.now,
): Promise<SweepExpiredExportJobsResult> {
  const expired = await prisma.customerExportJob.findMany({
    where: { status: "COMPLETED", expiresAt: { lte: new Date(nowFn()) }, publicId: { not: null } },
    take: SWEEP_BATCH_SIZE + 1, // +1 purely to detect "more remain" without a second count query
  });
  const more = expired.length > SWEEP_BATCH_SIZE;
  if (more) expired.length = SWEEP_BATCH_SIZE;

  let deleted = 0;
  let failed = 0;
  for (const job of expired) {
    const result = await _deleteAsset(job.publicId as string, EXPORT_DELIVERY_TYPE, undefined, undefined, EXPORT_RESOURCE_TYPE);
    if (result.ok) {
      await prisma.customerExportJob.update({ where: { id: job.id }, data: { status: "EXPIRED", publicId: null } });
      deleted++;
    } else {
      failed++;
    }
  }

  return { checked: expired.length, deleted, failed, more };
}
