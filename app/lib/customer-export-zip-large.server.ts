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
//   3. sweepExpiredExportJobs — admin-triggered cleanup (matching
//      data-retention.server.ts's own established convention — no cron
//      exists for this, deliberately, same as that module), deletes the
//      Cloudinary asset for every expired row and clears publicId so
//      nothing is left to leak or re-serve.
//
// Memory note, documented rather than hidden: unlike the streaming common
// path, this buffers the complete archive in memory before uploading (a
// Cloudinary raw upload needs the complete file; there is no verified
// streaming-upload path for this provider in this codebase today). At the
// same ~300-image / ~1.5GB envelope MAX_SYNC_EXPORT_IMAGES already assumes
// is safe for a sequential fetch, this stays within typical serverless
// memory budgets — if that ceiling is ever raised substantially, this
// buffering approach should be revisited before the ceiling is, not after.

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

function exportPublicId(customerId: string, jobId: string): string {
  return `naia-exports/${customerId}/${jobId}.zip`;
}

export interface LargeExportDeps {
  _fetch?: typeof fetch;
  _uploadRaw?: typeof uploadCloudinaryRawPrivate;
}

export type BuildLargeExportResult =
  | { ok: true; jobId: string }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "upload_failed"; jobId: string; errorCode: string };

export async function buildLargeCustomerExportZip(
  customerId: string,
  imageCount: number,
  deps: LargeExportDeps = {},
): Promise<BuildLargeExportResult> {
  const _fetch = deps._fetch ?? fetch;
  const _uploadRaw = deps._uploadRaw ?? uploadCloudinaryRawPrivate;

  const exportData = await compileCustomerExport(customerId);
  if (!exportData) return { ok: false, reason: "not_found" };

  const job = await prisma.customerExportJob.create({
    data: { customerId, imageCount, status: "PROCESSING" },
  });

  const { data, images } = planImages(exportData);
  const archive = archiver("zip", { zlib: { level: 6 } });
  const chunks: Buffer[] = [];
  archive.on("data", (chunk: Buffer) => chunks.push(chunk));

  const imageFetchFailures: string[] = [];
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
      archive.append(buf, { name: img.filename });
    } catch {
      imageFetchFailures.push(img.filename);
    }
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

  const buffer = Buffer.concat(chunks);
  const publicId = exportPublicId(customerId, job.id);
  const uploadResult = await _uploadRaw(publicId, buffer, `naia-data-export-${job.id}.zip`, EXPORT_DELIVERY_TYPE);

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
}

// Admin-triggered only — no cron exists for this, deliberately, matching
// data-retention.server.ts's own established convention for this codebase.
export async function sweepExpiredExportJobs(
  _deleteAsset: typeof deleteCloudinaryAsset = deleteCloudinaryAsset,
  nowFn: () => number = Date.now,
): Promise<SweepExpiredExportJobsResult> {
  const expired = await prisma.customerExportJob.findMany({
    where: { status: "COMPLETED", expiresAt: { lte: new Date(nowFn()) }, publicId: { not: null } },
  });

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

  return { checked: expired.length, deleted, failed };
}
