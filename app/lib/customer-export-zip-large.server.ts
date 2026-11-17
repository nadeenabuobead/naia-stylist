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
//      re-deriving what gets bundled or which photos are excluded),
//      streaming the archive to Cloudinary as a private RAW asset via
//      chunked upload as it's produced (never buffering the whole ZIP in
//      memory — see this file's own memory/time safety note below), and
//      records a CustomerExportJob row.
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
// Memory/time safety (REVISED 2026-11-16 against the project's actual
// verified Vercel limits — `vercel inspect <deployment-url> --json` against
// this project's real staging deployment reports every route, including
// api/export-zip, sharing ONE function instance with memorySize: 2048 (2048
// MB) and timeout: 300 (300s). A fixed byte-count ceiling on an in-memory
// buffer (the previous approach) cannot be sized safely against that real
// 2048 MB ceiling once Fluid Compute's "optimized concurrency" is accounted
// for — two concurrent large-export requests could land in the SAME
// instance, and any single generously-sized in-memory buffer risks an OOM
// that an arbitrary byte ceiling only ever gambles against, never removes.
//
// So this no longer buffers the whole archive. buildLargeCustomerExportZip
// streams archiver's output into Cloudinary via chunked upload
// (createChunkedRawUploader, cloudinary-admin.server.ts) as each piece is
// produced — peak memory for the upload itself stays bounded to roughly one
// CHUNK_SIZE_BYTES (20 MB) regardless of total export size, the one
// genuinely scale-independent fix for the memory risk. MAX_LARGE_EXPORT_BYTES
// below is kept only as a secondary sanity/cost backstop (an anomalous
// export shouldn't silently run to an unbounded size just because memory is
// no longer the limiting factor) — it is NOT the primary defense anymore.
//
// Execution time is the remaining real risk: the verified 300s function
// timeout is a hard platform kill with no chance for this code to run its
// own cleanup. MAX_TIME_BUDGET_MS below proactively aborts the fetch loop
// with margin BEFORE that kill, so a run that's taking too long fails
// cleanly (job marked FAILED, a fresh retry can start) instead of leaving a
// row that can only be recovered by the separate stale-job reconciliation
// after the fact.
//
// Stale-job reconciliation safety: STALE_EXPORT_PROCESSING_THRESHOLD_MS (10
// minutes) cannot incorrectly terminate a row that's still legitimately
// processing, because no single invocation can legitimately still be
// running past the verified 300s (5 minute) real function timeout — the
// platform itself guarantees that. 10 minutes carries a full 2x safety
// margin past the longest any one invocation can possibly still be alive.
//
// Overlap guard (2026-11-16): buildLargeCustomerExportZip reserves its
// CustomerExportJob row inside a Serializable transaction (see
// reserveExportJobSlot) rather than calling .create() directly — otherwise a
// double-click, a retried fetch, or a customer re-requesting while their
// first >300-image export is still building would each start an independent
// full fetch-archive-upload cycle for the same customer at the same time.
//
// Open, unverified item (flagged, not assumed): Cloudinary's own maximum
// file size per chunked upload depends on the account's plan and was not
// checked here — that would require a live call, which is out of bounds
// for this change. Confirm it against the actual Cloudinary account before
// relying on this path for a genuinely large (multi-hundred-MB+) export.

import archiver from "archiver";
import prisma from "../db.server";
import { compileCustomerExport } from "./customer-privacy.server";
import { planImages, ZIP_NOTE } from "./customer-export-zip.server";
import {
  getCloudinaryConfig,
  buildPrivateDownloadUrl,
  deleteCloudinaryAsset,
  createChunkedRawUploader,
  type CloudinaryConfig,
} from "./cloudinary-admin.server";
import { recordFailedCloudinaryDeletion } from "./cloudinary-deletion-record.server";

const EXPORT_EXPIRY_HOURS = 24;
const EXPORT_RESOURCE_TYPE = "raw";
const EXPORT_DELIVERY_TYPE = "private";
const DOWNLOAD_LINK_EXPIRY_SECONDS = 600; // 10 minutes — same signed-link convention as every other asset in this app

// Data-anomaly backstop, not a realistic-customer sizing: the real Closet
// cap is 250 (plan-limits.server.ts) and no genuine customer today comes
// remotely close to this number — same reasoning MAX_SYNC_EXPORT_IMAGES's
// own comment already uses for 300. A request this large is treated as a
// data anomaly needing manual handling (same "contact support" fallback as
// the pre-existing too_large case). This is NOT the real defense against
// the execution-time risk — MAX_TIME_BUDGET_MS below is, since it reacts to
// actual elapsed time rather than an assumed per-image duration.
export const MAX_LARGE_EXPORT_IMAGES = 1000;

// Secondary sanity/cost backstop only — now that the upload itself streams
// in bounded chunks (createChunkedRawUploader), memory no longer scales
// with this number, so it is not load-bearing for the OOM risk the way it
// used to be. Kept so an anomalous export doesn't silently grow to an
// unbounded size, and because Cloudinary's own maximum file size per
// account plan is unverified (see this file's top-of-file note) — 2GB is a
// conservative guess at "probably fine," not a confirmed safe value.
export const MAX_LARGE_EXPORT_BYTES = 2 * 1024 * 1024 * 1024;

// The real defense against the execution-time risk. Verified real function
// timeout for this project is 300s (see this file's top-of-file note) — a
// hard platform kill with zero chance to run our own cleanup once it fires.
// 240s leaves a fixed 60s margin for appending data.json, finalizing the
// archive, flushing the last upload chunk, and writing the terminal DB
// status — all of which still need to happen AFTER this check trips.
export const MAX_TIME_BUDGET_MS = 240 * 1000;

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
  _createUploader?: typeof createChunkedRawUploader;
  _runReservation?: RunExportReservationFn;
  // Shared by the reservation's staleness check AND the time-budget abort —
  // one clock for the whole call, same discipline as every other injected
  // nowFn in this codebase.
  _now?: () => number;
  // Overridable only so tests can exercise the ceiling without allocating
  // real gigabytes of Buffer data. Production callers never pass this —
  // it always defaults to the real MAX_LARGE_EXPORT_BYTES.
  _maxBytes?: number;
  // Same idea for MAX_TIME_BUDGET_MS — lets a test trip the abort in
  // milliseconds of fake-clock time instead of waiting 240 real seconds.
  _maxTimeBudgetMs?: number;
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
  const _createUploader = deps._createUploader ?? createChunkedRawUploader;
  const _now = deps._now ?? Date.now;
  const _maxBytes = deps._maxBytes ?? MAX_LARGE_EXPORT_BYTES;
  const _maxTimeBudgetMs = deps._maxTimeBudgetMs ?? MAX_TIME_BUDGET_MS;
  const startTime = _now();

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
  const publicId = exportPublicId(customerId, job.id);
  const uploader = _createUploader(publicId, `naia-data-export-${job.id}.zip`, EXPORT_DELIVERY_TYPE, { _fetch });

  // Drains archive's compressed output into the uploader AS it's produced —
  // started before the fetch loop below so nothing backs up unconsumed in
  // archiver's own internal stream buffer. uploadFailure is a plain mutable
  // ref (not just this promise's eventual resolution) specifically so the
  // synchronous fetch loop below can notice a failed chunk upload and stop
  // feeding more images into a stream nobody is draining anymore, rather
  // than only finding out after every image has already been fetched.
  const uploadFailure: { current: { ok: false; errorCode: string } | null } = { current: null };
  // Read through a function rather than the bare property everywhere below
  // — TS's control-flow narrowing otherwise treats `uploadFailure.current`
  // as permanently falsy after the first `if (!uploadFailure.current)`-style
  // check in this function, since it can't see that the async closure below
  // mutates it across an await boundary. A function call's return value is
  // never narrowed by unrelated prior conditionals, which sidesteps that.
  function getUploadFailure() {
    return uploadFailure.current;
  }
  const consumeUpload = (async (): Promise<void> => {
    try {
      for await (const chunk of archive as unknown as AsyncIterable<Buffer>) {
        if (uploadFailure.current) {
          archive.destroy();
          return;
        }
        const result = await uploader.write(chunk);
        if (!result.ok) {
          uploadFailure.current = result;
          // Destroy immediately, from right here — waiting for the fetch
          // loop below to notice on its next iteration would leave
          // archiver's internal buffer filling with nothing draining it,
          // which can stall archive.finalize() indefinitely waiting for a
          // 'drain' that will never come once nobody reads the output side
          // again.
          archive.destroy();
          return;
        }
      }
    } catch (err) {
      if (!uploadFailure.current) {
        uploadFailure.current = {
          ok: false,
          errorCode: err instanceof Error ? err.message.slice(0, 200) : "ARCHIVE_STREAM_ERROR",
        };
      }
    }
  })();

  const imageFetchFailures: string[] = [];
  let bytesFetched = 0;
  let abortReason: "EXCEEDS_BYTE_CEILING" | "EXCEEDS_TIME_BUDGET" | null = null;
  // Sequential, not parallel — keeps the fetch side simple and ordered;
  // peak memory is no longer a reason to stay sequential (the uploader
  // streams in bounded chunks regardless), but nothing here needed
  // concurrency to be safe within the real time budget either.
  for (const img of images) {
    if (getUploadFailure()) break;
    if (_now() - startTime > _maxTimeBudgetMs) {
      abortReason = "EXCEEDS_TIME_BUDGET";
      break;
    }
    try {
      const res = await _fetch(img.url);
      if (!res.ok) {
        imageFetchFailures.push(img.filename);
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      bytesFetched += buf.length;
      if (bytesFetched > _maxBytes) {
        abortReason = "EXCEEDS_BYTE_CEILING";
        break;
      }
      archive.append(buf, { name: img.filename });
    } catch {
      imageFetchFailures.push(img.filename);
    }
  }

  if (abortReason || getUploadFailure()) {
    // Snapshot the real reason BEFORE destroying — destroying the stream
    // can itself make consumeUpload's for-await throw a "Premature close"
    // style stream error, which must never override the actual reason this
    // abort happened in the first place. abortReason (a proactive local
    // check) always takes precedence over whatever uploadFailure held at
    // this exact moment, since abortReason being set means THAT is what
    // triggered this branch, not an upload failure.
    const errorCode = abortReason ?? getUploadFailure()!.errorCode;
    // The archive built so far is incomplete and must never be
    // finalized/uploaded as if it were a real export.
    archive.destroy();
    await consumeUpload;
    await prisma.customerExportJob.update({ where: { id: job.id }, data: { status: "FAILED", errorCode } });
    return { ok: false, reason: "upload_failed", jobId: job.id, errorCode };
  }

  archive.append(JSON.stringify({ ...data, note: ZIP_NOTE, imageFetchFailures }, null, 2), { name: "data.json" });

  let finalizeError: string | null = null;
  const finalizeTask = archive.finalize().catch((err: unknown) => {
    finalizeError = err instanceof Error ? err.message.slice(0, 200) : "ARCHIVE_BUILD_FAILED";
  });

  // Race, don't sequence: if the upload fails WHILE finalize is still
  // flushing (plausible for a small archive — nothing may reach the
  // uploader until finalize's own flush), consumeUpload destroys the
  // stream and returns immediately, but archive.finalize()'s own promise
  // is tied to the stream ending NORMALLY — a forced destroy may leave it
  // settling late or never. Waiting on finalizeTask first would risk
  // hanging forever on exactly the failure path this code exists to
  // handle cleanly. Whichever settles first is enough to act on.
  await Promise.race([finalizeTask, consumeUpload]);

  const failureFromRace = getUploadFailure();
  if (failureFromRace) {
    const errorCode = failureFromRace.errorCode;
    await prisma.customerExportJob.update({ where: { id: job.id }, data: { status: "FAILED", errorCode } });
    return { ok: false, reason: "upload_failed", jobId: job.id, errorCode };
  }

  // No upload failure — so finalizeTask must be the one that actually
  // settled (or settles shortly); wait for it properly now.
  await finalizeTask;
  if (finalizeError) {
    const errorCode = finalizeError;
    await prisma.customerExportJob.update({ where: { id: job.id }, data: { status: "FAILED", errorCode } });
    return { ok: false, reason: "upload_failed", jobId: job.id, errorCode };
  }

  // Resolves once archive's stream has fully ended (for-await's own
  // completion signals that) — this IS the "archive settled" wait, no
  // separate end/error listener needed alongside it.
  await consumeUpload;
  const failureAfterSettle = getUploadFailure();
  if (failureAfterSettle) {
    const errorCode = failureAfterSettle.errorCode;
    await prisma.customerExportJob.update({ where: { id: job.id }, data: { status: "FAILED", errorCode } });
    return { ok: false, reason: "upload_failed", jobId: job.id, errorCode };
  }

  const finishResult = await uploader.finish();
  if (!finishResult.ok) {
    await prisma.customerExportJob.update({
      where: { id: job.id },
      data: { status: "FAILED", errorCode: finishResult.errorCode },
    });
    return { ok: false, reason: "upload_failed", jobId: job.id, errorCode: finishResult.errorCode };
  }

  const expiresAt = new Date(Date.now() + EXPORT_EXPIRY_HOURS * 60 * 60 * 1000);
  await prisma.customerExportJob.update({
    where: { id: job.id },
    data: { status: "COMPLETED", publicId: finishResult.publicId, completedAt: new Date(), expiresAt },
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
  _record: typeof recordFailedCloudinaryDeletion = recordFailedCloudinaryDeletion,
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
      // 2026-11-17 (H7 completion) — this used to just increment `failed`
      // and move on. The job row stays COMPLETED with its expired publicId
      // still set (the DB update above only runs in the result.ok branch),
      // so the sweep's own return value was the only trace of the failure —
      // nothing durable, nothing the retry sweep or /admin/maintenance could
      // ever pick up. resourceType is explicitly "raw" (not the recorder's
      // "image" default): this is a ZIP archive, and the retry path must
      // destroy it under the same resource_type it was uploaded as, or
      // Cloudinary's Admin API will not find it.
      await _record({
        customerId: job.customerId,
        publicId: job.publicId as string,
        deliveryType: EXPORT_DELIVERY_TYPE,
        resourceType: EXPORT_RESOURCE_TYPE,
        context: "export-zip-sweep-expired",
        lastError: result.errorCode ?? "Cloudinary deletion failed",
      });
    }
  }

  return { checked: expired.length, deleted, failed, more };
}
