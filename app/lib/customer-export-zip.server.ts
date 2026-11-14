// app/lib/customer-export-zip.server.ts
//
// Builds the downloadable ZIP export Legal requires: the same JSON
// compileCustomerExport already produces, plus the actual retained image
// bytes (Closet photos, the My nAia Model BODY photo only, and completed
// Virtual Try-On results) — so the customer's copy works offline, with no
// expiring signed link to chase.
//
// Deliberately reuses compileCustomerExport for every privacy-relevant
// decision (ownership scope, face/selfie exclusion, security-material
// scrubbing) rather than re-deriving any of it here. This file only adds:
// fetch the bytes compileCustomerExport already decided were safe to
// expose as a signed link, and name them inside the archive instead.
//
// Face/selfie photos stay excluded, exactly as in the JSON-only export —
// NaiaModel.facePublicId and SelfieAnalysis.photoPublicId are never
// fetched or zipped here either. See compileCustomerExport's own comment
// for why (tracked separately as its own open question).

import archiver from "archiver";
import type { Readable } from "node:stream";
import { compileCustomerExport, type CustomerExport } from "./customer-privacy.server";

// Conservative ceiling, chosen from the real, code-enforced 5MB-per-image
// upload cap (closet._index.tsx, my-naia-model.server.ts), not a live
// Cloudinary byte-size sample. At 300 images and 5MB each (~1.5GB), a
// sequential fetch-and-append is still comfortably inside Vercel Pro's
// duration budget — but a genuine customer today is nowhere near this
// number (the paid-tier Closet cap alone is 250, plan-limits.server.ts).
// This exists to protect the synchronous path from a future plan-limit
// increase or a data anomaly, not from anything a real customer can hit now.
export const MAX_SYNC_EXPORT_IMAGES = 300;

export type ExportZipResult =
  | { ok: true; stream: Readable; filename: string }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "too_large"; imageCount: number };

interface ExportImageRef {
  url: string;
  filename: string;
}

// Overrides compileCustomerExport's own `note` — which correctly describes
// the JSON-only /settings export (a temporary signed link that expires) —
// with wording accurate to what THIS export actually contains: real image
// files already bundled in the archive, no link to chase. The JSON-only
// export's own note is untouched; this only ever reaches the ZIP's data.json.
const ZIP_NOTE =
  "This export covers every record this application stores about you. " +
  "Closet, My nAia Model (body photo only), and Virtual Try-On result " +
  "photos are included as actual image files in this archive (see the " +
  "images/ folder) — there is no link to follow or download separately. " +
  "Any image that could not be bundled is listed in imageFetchFailures " +
  "below. Your face/selfie photo reference is included as a storage " +
  "identifier only, consistent with this app's stricter handling of face " +
  "photos elsewhere. It does not include any copy that FASHN AI, " +
  "Anthropic, or Bodygram may independently retain on their own systems — " +
  "those are governed by each provider's own data retention policy, not by " +
  "this application.";

function countExportImages(exportData: CustomerExport): number {
  const closetCount = (exportData.closet as Array<{ downloadUrl?: string | null }>).filter(
    (c) => !!c.downloadUrl,
  ).length;
  const modelCount = (exportData.naiaModel as { bodyDownloadUrl?: string | null } | null)?.bodyDownloadUrl
    ? 1
    : 0;
  const vtoCount = (exportData.virtualTryOnJobs as Array<{ downloadUrl?: string | null }>).filter(
    (j) => !!j.downloadUrl,
  ).length;
  return closetCount + modelCount + vtoCount;
}

// Each personalised-edit snapshot's `evidenceClosetItems`/`routeInItems`/
// `lookToTryItems` arrays carry a `closetItemId` + the short-lived signed
// `imageUrl` that was live at generation time — see EvidenceClosetItem in
// trend-evidence.server.ts. Left alone, those duplicate the exact same
// Closet photos the ZIP already bundles under images/closet/, but as dead
// links instead of the local file. This rewrites imageUrl to the matching
// bundled filename (or null, if that Closet item was deleted since, or its
// own image failed to fetch — see appendAll's imageFetchFailures) without
// touching any other field, so the historical snapshot content (name,
// category, roleNote, closetItemId) is preserved exactly as recorded.
const EVIDENCE_ITEM_ARRAY_KEYS = ["evidenceClosetItems", "routeInItems", "lookToTryItems"] as const;

function remapTrendEditSnapshotImages(
  personalisedTrendEditUsage: unknown[],
  closetFilenameById: Map<string, string>,
): unknown[] {
  return personalisedTrendEditUsage.map((row) => {
    const usage = row as Record<string, unknown>;
    const snapshot = usage.snapshot as Record<string, unknown> | null | undefined;
    const edit = snapshot?.edit as Record<string, unknown> | undefined;
    if (!snapshot || !edit) return usage;

    const rewrittenEdit = { ...edit };
    for (const key of EVIDENCE_ITEM_ARRAY_KEYS) {
      const items = edit[key] as Array<Record<string, unknown>> | undefined;
      if (!Array.isArray(items)) continue;
      rewrittenEdit[key] = items.map((item) => {
        const closetItemId = item.closetItemId as string | null;
        const filename = closetItemId ? closetFilenameById.get(closetItemId) : undefined;
        return { ...item, imageUrl: filename ?? null };
      });
    }

    return { ...usage, snapshot: { ...snapshot, edit: rewrittenEdit } };
  });
}

// Replaces each short-lived `downloadUrl` / `bodyDownloadUrl` field with
// the ZIP-internal `filename` the image will be saved under — a link that
// expires in minutes has no business inside a permanent offline archive.
// Returns the rewritten export data plus the ordered {url, filename} list
// to actually fetch.
function planImages(exportData: CustomerExport): {
  data: Record<string, unknown>;
  images: ExportImageRef[];
} {
  const images: ExportImageRef[] = [];

  const closetFilenameById = new Map<string, string>();
  const closet = (
    exportData.closet as Array<Record<string, unknown> & { id: string; downloadUrl?: string | null; imageFormat?: string | null }>
  ).map((item) => {
    const { downloadUrl, ...rest } = item;
    if (!downloadUrl) return { ...rest, filename: null };
    const ext = item.imageFormat || "jpg";
    const filename = `images/closet/${item.id}.${ext}`;
    images.push({ url: downloadUrl, filename });
    closetFilenameById.set(item.id, filename);
    return { ...rest, filename };
  });

  let naiaModel = exportData.naiaModel as
    | (Record<string, unknown> & { bodyDownloadUrl?: string | null; bodyFormat?: string | null })
    | null;
  if (naiaModel?.bodyDownloadUrl) {
    const { bodyDownloadUrl, ...rest } = naiaModel;
    const ext = naiaModel.bodyFormat || "jpg";
    const filename = `images/model/body-photo.${ext}`;
    images.push({ url: bodyDownloadUrl, filename });
    naiaModel = { ...rest, bodyFilename: filename };
  }

  const virtualTryOnJobs = (
    exportData.virtualTryOnJobs as Array<Record<string, unknown> & { id: string; downloadUrl?: string | null }>
  ).map((job) => {
    const { downloadUrl, ...rest } = job;
    if (!downloadUrl) return { ...rest, filename: null };
    const filename = `images/vto/${job.id}.png`;
    images.push({ url: downloadUrl, filename });
    return { ...rest, filename };
  });

  const personalisedTrendEditUsage = remapTrendEditSnapshotImages(
    exportData.personalisedTrendEditUsage,
    closetFilenameById,
  );

  return {
    data: { ...exportData, closet, naiaModel, virtualTryOnJobs, personalisedTrendEditUsage, note: ZIP_NOTE },
    images,
  };
}

export interface BuildExportZipDeps {
  _fetch?: typeof fetch;
}

export async function buildCustomerExportZip(
  customerId: string,
  deps: BuildExportZipDeps = {},
): Promise<ExportZipResult> {
  const _fetch = deps._fetch ?? fetch;

  const exportData = await compileCustomerExport(customerId);
  if (!exportData) return { ok: false, reason: "not_found" };

  const imageCount = countExportImages(exportData);
  if (imageCount > MAX_SYNC_EXPORT_IMAGES) {
    return { ok: false, reason: "too_large", imageCount };
  }

  const { data, images } = planImages(exportData);

  const archive = archiver("zip", { zlib: { level: 6 } });
  const imageFetchFailures: string[] = [];

  // Sequential, not parallel — the simplest implementation that stays
  // safe under MAX_SYNC_EXPORT_IMAGES above. One image buffered in memory
  // at a time keeps peak memory far below the function's limit regardless
  // of total export size; a single failed fetch is skipped and recorded
  // rather than failing the whole export.
  async function appendAll() {
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
    archive.append(JSON.stringify({ ...data, imageFetchFailures }, null, 2), { name: "data.json" });
    await archive.finalize();
  }

  // Fire-and-forget by design: archiver streams its output as entries are
  // appended, so the caller must start consuming `stream` immediately —
  // awaiting appendAll() here before returning would buffer the entire
  // archive in memory first and defeat streaming entirely.
  //
  // Per-image failures are already caught and recorded inside appendAll —
  // this .catch is for anything else going wrong (e.g. archive.append or
  // archive.finalize itself throwing). Without it, an uncaught rejection
  // here would leave the HTTP response hanging indefinitely rather than
  // ending — destroying the stream with the error instead makes it fail
  // visibly and immediately, so a customer can never be served a
  // truncated ZIP that looks complete but silently isn't.
  appendAll().catch((err) => archive.destroy(err instanceof Error ? err : new Error(String(err))));

  const dateStamp = new Date().toISOString().slice(0, 10);
  return { ok: true, stream: archive, filename: `naia-data-export-${dateStamp}.zip` };
}
