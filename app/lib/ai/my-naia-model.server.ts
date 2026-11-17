// app/lib/ai/my-naia-model.server.ts
// NaiaModel and VirtualTryOnJob service layer — Phase 4A2 hardened.
//
// Privacy contract:
//   - All new uploads use Cloudinary delivery type "private".
//   - Signed delivery URLs are generated per-request; never persisted.
//   - Deletion is Cloudinary-first (asset gone before DB reference clears).
//   - Compensation: DB failure after upload → delete the newly uploaded asset.
//   - 2026-11-17 (H7): every compensation/replacement deletion whose failure
//     used to be DISCARDED now records a PendingCloudinaryDeletion row so the
//     retry sweep can drain it. See the H7 note above saveNaiaModelPhoto for
//     which sites were real gaps and which deliberately are not.
//
// Concurrency contract:
//   - Active-job-check and job-create are wrapped in a Serializable transaction.
//   - Bounded retry on serialization/deadlock errors.
//   - Idempotency key prevents duplicate chargeable jobs.
//
// DI contract:
//   - All DB operations accept optional injected functions for testability.
//   - No live DB or Cloudinary calls in tests.

import { createHash, randomBytes } from "node:crypto";
import prisma from "../../db.server.js";
import type {
  NaiaModelRecord,
  VirtualTryOnJobRecord,
  TryOnJobStatus,
  NaiaModelReadiness,
  NaiaModelConsentState,
} from "./virtual-try-on.types.js";
import {
  DEFAULT_CONSENT_STATE,
  POLICY_VERSION,
  ALLOWED_TRANSITIONS,
  ACTIVE_STATUSES,
} from "./virtual-try-on.types.js";
import {
  validatePublicIdOwnership,
  buildSignedDeliveryUrl,
  buildPrivateDownloadUrl,
  verifyCloudinaryAsset,
  deleteCloudinaryAsset,
  getCloudinaryConfig,
  type DeleteAssetFn,
  type VerifyAssetFn,
  type CloudinaryConfig,
} from "../cloudinary-admin.server.js";
import {
  deleteCloudinaryAssetOrRecord,
  recordFailedCloudinaryDeletion,
} from "../cloudinary-deletion-record.server.js";
import {
  moderateImageContent,
  type ModerationResult,
  type AnalyzeForModerationFn,
} from "../image-moderation.server.js";
import {
  screenVtoBodyPhoto,
  type VtoSuitabilityResult,
  type AnalyzeForSuitabilityFn,
} from "../image-suitability.server.js";
import {
  checkSelfieQuality,
  type SelfieAnalyzerFn,
} from "./selfie-analysis.server.js";

export { POLICY_VERSION, validatePublicIdOwnership, buildSignedDeliveryUrl, buildPrivateDownloadUrl };
export type { NaiaModelRecord, VirtualTryOnJobRecord, TryOnJobStatus, VerifyAssetFn };

// ── DI types ──────────────────────────────────────────────────────────────────

export type FindModelFn = (customerId: string) => Promise<NaiaModelRecord | null>;
export type UpsertModelFn = (
  customerId: string,
  data: Partial<Omit<NaiaModelRecord, "id" | "customerId" | "createdAt" | "updatedAt">>,
) => Promise<NaiaModelRecord>;
export type FindJobFn = (
  where: { customerId?: string; idempotencyKey?: string },
) => Promise<VirtualTryOnJobRecord | null>;
export type CreateJobFn = (
  data: Omit<VirtualTryOnJobRecord, "id" | "createdAt" | "updatedAt">,
) => Promise<VirtualTryOnJobRecord>;
export type UpdateJobFn = (
  id: string,
  data: Partial<Omit<VirtualTryOnJobRecord, "id" | "customerId" | "createdAt">>,
) => Promise<VirtualTryOnJobRecord>;

// RunTransactionFn: injectable atomic active-job-check + create.
// The real implementation runs inside a Serializable Prisma transaction.
// Test implementations call fn directly with mock ops — no actual transaction.
export type TxOps = {
  findActiveJob: (customerId: string) => Promise<VirtualTryOnJobRecord | null>;
  createJob: CreateJobFn;
};
export type RunTransactionFn = (
  fn: (ops: TxOps) => Promise<{ blocked: boolean; job: VirtualTryOnJobRecord }>,
) => Promise<{ blocked: boolean; job: VirtualTryOnJobRecord }>;

// ── Real Prisma DB implementations ────────────────────────────────────────────

async function _findModel(customerId: string): Promise<NaiaModelRecord | null> {
  return prisma.naiaModel.findUnique({ where: { customerId } }) as Promise<NaiaModelRecord | null>;
}

async function _upsertModel(
  customerId: string,
  data: Partial<Omit<NaiaModelRecord, "id" | "customerId" | "createdAt" | "updatedAt">>,
): Promise<NaiaModelRecord> {
  return prisma.naiaModel.upsert({
    where: { customerId },
    create: { customerId, ...data },
    update: data,
  }) as Promise<NaiaModelRecord>;
}

async function _findJob(
  where: { customerId?: string; idempotencyKey?: string },
): Promise<VirtualTryOnJobRecord | null> {
  return prisma.virtualTryOnJob.findFirst({
    where,
    // 3-level deterministic ordering: ties on lastActivityAt broken by createdAt, then id.
    // Pure lastActivityAt ordering is non-deterministic when rows share the same timestamp.
    orderBy: [
      { lastActivityAt: "desc" },
      { createdAt: "desc" },
      { id: "desc" },
    ],
  }) as Promise<VirtualTryOnJobRecord | null>;
}

async function _createJob(
  data: Omit<VirtualTryOnJobRecord, "id" | "createdAt" | "updatedAt">,
): Promise<VirtualTryOnJobRecord> {
  return prisma.virtualTryOnJob.create({ data }) as Promise<VirtualTryOnJobRecord>;
}

async function _updateJob(
  id: string,
  data: Partial<Omit<VirtualTryOnJobRecord, "id" | "customerId" | "createdAt">>,
): Promise<VirtualTryOnJobRecord> {
  return prisma.virtualTryOnJob.update({
    where: { id },
    data: { ...data, updatedAt: new Date() },
  }) as Promise<VirtualTryOnJobRecord>;
}

// Serializable transaction: active-job-check + create are atomic.
// Prevents two simultaneous requests from creating two active chargeable jobs.
const _runJobTransaction: RunTransactionFn = (fn) =>
  prisma.$transaction(
    (tx: { virtualTryOnJob: { findFirst: (args: unknown) => Promise<unknown>; create: (args: unknown) => Promise<unknown> } }) =>
      fn({
        findActiveJob: (customerId) =>
          tx.virtualTryOnJob.findFirst({
            where: { customerId, status: { in: ACTIVE_STATUSES as string[] } },
            orderBy: { lastActivityAt: "desc" },
          }) as Promise<VirtualTryOnJobRecord | null>,
        createJob: (data) =>
          tx.virtualTryOnJob.create({ data }) as Promise<VirtualTryOnJobRecord>,
      }),
    { isolationLevel: "Serializable" },
  );

// ── NaiaModel — load ──────────────────────────────────────────────────────────

export async function loadNaiaModel(
  customerId: string,
  _findModelFn: FindModelFn = _findModel,
): Promise<NaiaModelRecord | null> {
  return _findModelFn(customerId);
}

// ── Time-limited preview URL (loader/action use only — never persist) ─────────
//
// Generates a Cloudinary private_download URL with a server-controlled 10-minute
// expiry. Only the server (with api_secret) can produce a valid URL. The expiry
// is enforced by the Cloudinary API server — the URL becomes invalid after expires_at.
// Client has no input into the expiry duration.
// The returned URL must NOT be stored in the DB. Must never be logged.
//
// format must be the asset's real, server-verified format. A null format (a
// legacy row saved before format tracking, or propagated from another
// nullable source such as SelfieAnalysis.photoFormat) must never be guessed
// at — Cloudinary's /image/download endpoint performs a real format
// conversion whenever the requested format differs from what's actually
// stored, and that conversion is cached by Cloudinary as a derived resource
// regardless of Strict Transformations (which only gates new *unsigned* CDN
// transformation requests, not this authenticated Admin API call). Guessing
// "jpg" for a row whose real format is e.g. png silently materializes one of
// these derivatives on every preview render. Matches the fail-closed, never-
// guess precedent already established for Closet garment analysis.
export function buildModelPreviewUrl(
  publicId: string,
  format: string | null,
  deliveryType: string = "private",
  _getConfig: () => CloudinaryConfig | null = getCloudinaryConfig,
  nowFn: () => number = Date.now,
): string | null {
  if (!format) return null;
  const cfg = _getConfig();
  if (!cfg) return null;
  return buildPrivateDownloadUrl(cfg, publicId, format, deliveryType, nowFn);
}

// ── NaiaModel — save photo reference (with compensation) ─────────────────────
//
// Called after the client uploads to Cloudinary.
// Validates ownership, persists the new public ID, then deletes the old asset.
//
// Compensation (privacy + consistency):
//   - If DB persistence fails → delete the newly uploaded Cloudinary asset.
//   - The old reference is preserved untouched.
//   - Success is never reported when DB persistence fails.
//
// Replace flow (ordering guarantee):
//   1. Validate ownership of new public ID.
//   2. Read current model (captures old public ID before overwriting).
//   3. Persist new public ID in DB.
//   4. On DB failure → delete new asset (compensation) → return error.
//   5. On DB success → delete old asset (if different from new).
//   6. On old-asset deletion failure → return { ok: true, orphanPublicId } for retry.

// PERMITTED_DELIVERY_TYPES: fast early rejection before the Admin API call.
// "upload" is Cloudinary's public default — never acceptable for model photos.
const PERMITTED_DELIVERY_TYPES = new Set(["private", "authenticated"]);

// Real implementation: always verifies against "private" delivery type.
const _verifyModelAsset: VerifyAssetFn = (publicId) =>
  verifyCloudinaryAsset(publicId, "private");

// DI types for moderation (injectable so tests don't hit Claude)
export type ModerateFn = (imageUrl: string, _analyze?: AnalyzeForModerationFn) => Promise<ModerationResult>;
export type ScreenBodyFn = (imageUrl: string, _analyze?: AnalyzeForSuitabilityFn) => Promise<VtoSuitabilityResult>;
export type CheckFaceQualityFn = typeof checkSelfieQuality;

// 2026-11-17 (H7) — injectable so the node:test suite can assert that a
// failed deletion is recorded, without a DB. Same DI contract as every other
// seam in this module ("All DB operations accept optional injected functions
// for testability"). Always the LAST parameter, so existing positional calls
// are unaffected.
export type RecordFailedDeletionFn = typeof recordFailedCloudinaryDeletion;

// ── H7 (Nov 12 privacy audit) — which deletions here were real gaps ──────────
//
// This module performs model face/body photo deletions in four places. Three
// discarded their failures and are fixed; one deliberately does not record
// and must not start.
//
//   FIXED — saveNaiaModelPhoto's compensation deletes (14 sites below). Every
//     validation/moderation rejection, and the DB-write-failure compensation,
//     deletes the just-uploaded newPublicId. No DB row ever referenced it, so
//     a dropped failure left an unreferenced asset — a derivative of the
//     customer's FACE or BODY photo — with nothing recording that it still
//     needed deleting.
//
//   FIXED — saveNaiaModelPhoto's old-asset replacement delete. Its result was
//     already checked and surfaced as a typed partial success
//     (orphanPublicId), but the only consumer, my-naia-model.tsx:110-113,
//     merely console.warn'd it. A log line is not a durable obligation and no
//     sweep reads logs.
//
//   FIXED — withdrawSaveModelConsent's attemptDelete. It collects failures in
//     failedAssets and returns them; the account-erasure caller
//     (customer-privacy.server.ts:344) records them, but the two
//     customer-facing callers do not. withdrawSaveModelConsentAndVtoResults
//     passes them straight through in its return value, and its VTO-sweep
//     obligation covers only the derived VTO RESULT assets, never the model
//     photos themselves.
//
//   DELIBERATELY NOT RECORDED — deleteNaiaModelPhoto. On a Cloudinary failure
//     it returns ok:false and leaves the DB reference IN PLACE, so the asset
//     is still live and still referenced, and the customer sees an error and
//     can retry. Recording it would be actively wrong: while a
//     PendingCloudinaryDeletion row is unresolved, assertPublicIdAvailable
//     refuses to let any new DB row reference that publicId, so recording
//     here would claim an asset the customer still legitimately owns.
//
// Why these mattered despite the orphan sweep existing: unreferenced assets
// under naia-wardrobe/ are reclaimable by cloudinary-orphan-sweep.server.ts,
// but runBoundedSweep has no scheduled trigger — vercel.json defines no crons
// and its only caller is admin.maintenance.tsx's action. Recovery depended on
// a human enumerating a customer's whole Cloudinary folder.
export async function saveNaiaModelPhoto(
  customerId: string,
  slot: "face" | "body",
  newPublicId: string,
  version: string | null,         // browser-supplied; superseded by Admin API verified value
  format: string | null,          // browser-supplied; superseded by Admin API verified value
  deliveryType: string = "private",
  _findModelFn: FindModelFn = _findModel,
  _upsertModelFn: UpsertModelFn = _upsertModel,
  _deleteAsset: DeleteAssetFn = deleteCloudinaryAsset,
  _verifyAsset: VerifyAssetFn = _verifyModelAsset,
  _moderateContent: ModerateFn = moderateImageContent,
  _screenBodyPhoto: ScreenBodyFn = screenVtoBodyPhoto,
  _getConfig: () => CloudinaryConfig | null = getCloudinaryConfig,
  _checkFaceQuality: CheckFaceQualityFn = checkSelfieQuality,
  _recordFailure: RecordFailedDeletionFn = recordFailedCloudinaryDeletion,
): Promise<
  | { ok: true; model: NaiaModelRecord; orphanPublicId?: string }
  | { ok: false; error: string }
> {
  // H7 — every compensation delete below goes through this instead of calling
  // _deleteAsset directly and dropping the result. The injected _deleteAsset
  // is passed straight through, so the existing DI seam is unchanged; the only
  // difference is that a failure now lands in PendingCloudinaryDeletion for
  // the retry sweep. Never throws, so a rejection path still returns its own
  // customer-facing error rather than a 500.
  const deleteRejectedUpload = (publicId: string, assetDeliveryType: string) =>
    deleteCloudinaryAssetOrRecord(
      {
        customerId,
        publicId,
        deliveryType: assetDeliveryType,
        context: "model-photo-upload-rejected",
      },
      _deleteAsset,
      _recordFailure,
    );

  // Fast early rejection of obviously public delivery types (before any network call).
  if (!PERMITTED_DELIVERY_TYPES.has(deliveryType)) {
    return { ok: false, error: "Public delivery type is not permitted for model photos." };
  }

  // Local ownership check — cheap, no network call.
  const ownership = validatePublicIdOwnership(newPublicId, customerId);
  if (!ownership.ok) {
    return { ok: false, error: ownership.error };
  }

  // ── Server-side Cloudinary asset verification ─────────────────────────────
  // Calls the Cloudinary Admin API with server credentials.
  // Browser-supplied deliveryType, version, and format are NOT trusted.
  // The Admin API response is authoritative for type, resource_type, format, and version.
  // A forged browser payload cannot bypass this check.
  const verification = await _verifyAsset(newPublicId);
  if (!verification.ok) {
    // NOT_FOUND: nothing to delete. NETWORK_ERROR / PROVIDER_ERROR: cannot safely operate.
    return { ok: false, error: "Asset could not be verified. Please try uploading again." };
  }

  const { asset } = verification;

  if (asset.resourceType !== "image") {
    // Non-image asset — delete as compensation and reject.
    await deleteRejectedUpload(newPublicId, asset.type || "private");
    return { ok: false, error: "Only image uploads are permitted for model photos." };
  }
  if (asset.type !== "private") {
    // Public or non-private asset — delete as compensation and reject.
    await deleteRejectedUpload(newPublicId, asset.type || "upload");
    return { ok: false, error: "Public delivery type is not permitted for model photos." };
  }

  // Use server-verified values. Browser-supplied version/format are not persisted.
  const verifiedFormat = asset.format || null;
  const verifiedVersion = asset.version || null;

  // ── Layer 1: format allowlist, size cap, dimension bounds (Admin API only) ──
  const ALLOWED_FORMATS = new Set(["jpg", "jpeg", "png", "webp", "heic", "heif"]);
  if (verifiedFormat && !ALLOWED_FORMATS.has(verifiedFormat)) {
    await deleteRejectedUpload(newPublicId, "private");
    return { ok: false, error: `File type "${verifiedFormat}" is not accepted. Use JPG, PNG, WEBP, or HEIC.` };
  }
  const MAX_BYTES = 5 * 1024 * 1024;
  if (asset.bytes && asset.bytes > MAX_BYTES) {
    await deleteRejectedUpload(newPublicId, "private");
    return { ok: false, error: "Photo is too large. Maximum size is 5 MB." };
  }
  const MIN_DIM = 200;
  const MAX_DIM = 8000;
  if (asset.width !== null && asset.width < MIN_DIM) {
    await deleteRejectedUpload(newPublicId, "private");
    return { ok: false, error: `Photo width (${asset.width}px) is below the minimum of ${MIN_DIM}px.` };
  }
  if (asset.height !== null && asset.height < MIN_DIM) {
    await deleteRejectedUpload(newPublicId, "private");
    return { ok: false, error: `Photo height (${asset.height}px) is below the minimum of ${MIN_DIM}px.` };
  }
  if (asset.width !== null && asset.width > MAX_DIM) {
    await deleteRejectedUpload(newPublicId, "private");
    return { ok: false, error: `Photo width (${asset.width}px) exceeds the maximum of ${MAX_DIM}px.` };
  }
  if (asset.height !== null && asset.height > MAX_DIM) {
    await deleteRejectedUpload(newPublicId, "private");
    return { ok: false, error: `Photo height (${asset.height}px) exceeds the maximum of ${MAX_DIM}px.` };
  }

  // ── Layer 2: global content safety moderation (both slots) ───────────────
  const cfg = _getConfig();
  if (!cfg) {
    await deleteRejectedUpload(newPublicId, "private");
    return { ok: false, error: "Image service is not configured. Please try again." };
  }
  const moderationUrl = buildPrivateDownloadUrl(cfg, newPublicId, verifiedFormat ?? "jpg", "private");
  const moderation = await _moderateContent(moderationUrl);
  if (moderation.status === "MODERATION_UNAVAILABLE") {
    await deleteRejectedUpload(newPublicId, "private");
    return { ok: false, error: "Image review is temporarily unavailable. Please try again." };
  }
  if (moderation.status === "SAFETY_REJECT") {
    await deleteRejectedUpload(newPublicId, "private");
    return { ok: false, error: "Photo could not be accepted. Please use a different image." };
  }

  // ── Layer 3: face quality gate (face slot only) ──────────────────────────
  // Reuses the selfie quality check to confirm the photo contains a clear,
  // forward-facing face — the same gate used during Selfie Style Analysis.
  if (slot === "face") {
    const faceQualityUrl = buildPrivateDownloadUrl(cfg, newPublicId, verifiedFormat ?? "jpg", "private");
    const faceQuality = await _checkFaceQuality({ imageUrl: faceQualityUrl });
    if (!faceQuality.pass) {
      await deleteRejectedUpload(newPublicId, "private");
      const msg = faceQuality.guidance
        ?? "Photo doesn't show a clear, forward-facing face. Please try a different photo.";
      return { ok: false, error: msg };
    }
  }

  // ── Layer 4: body photo suitability (body slot only) ─────────────────────
  let bodyModerationApproved = false;
  if (slot === "body") {
    const suitability = await _screenBodyPhoto(moderationUrl);
    if (suitability.status !== "PASS") {
      await deleteRejectedUpload(newPublicId, "private");
      const VTO_GUIDANCE: Record<string, string> = {
        no_person: "No person detected. Please upload a clear full-body photo.",
        multiple_people: "Only one person should be visible in the photo.",
        body_area_not_visible: "Please ensure your full body is visible from head to ankle.",
        image_too_blurry: "Photo is too blurry. Please try a clearer photo.",
        unusable_pose: "Framing or pose is not suitable. Try a front-facing full-body photo.",
        assessment_failed: "Photo assessment is temporarily unavailable. Please try again.",
      };
      const msg = VTO_GUIDANCE[(suitability as { status: "RETRY_IMAGE"; subCode: string }).subCode]
        ?? "Photo is not suitable for virtual try-on. Please try a different photo.";
      return { ok: false, error: msg };
    }
    bodyModerationApproved = true;
  }
  // ─────────────────────────────────────────────────────────────────────────

  // Capture the old reference before overwriting (for post-persistence cleanup).
  const existing = await _findModelFn(customerId);
  const oldPublicId = slot === "face" ? existing?.facePublicId : existing?.bodyPublicId;

  const slotData =
    slot === "face"
      ? { facePublicId: newPublicId, faceVersion: verifiedVersion, faceFormat: verifiedFormat, deliveryType: asset.type }
      : {
          bodyPublicId: newPublicId,
          bodyVersion: verifiedVersion,
          bodyFormat: verifiedFormat,
          deliveryType: asset.type,
          bodyModerationStatus: bodyModerationApproved ? "APPROVED" : "PENDING",
          bodyModerationAt: bodyModerationApproved ? new Date() : null,
        };

  let model: NaiaModelRecord;
  try {
    model = await _upsertModelFn(customerId, slotData);
  } catch {
    // DB failed — compensate by deleting the newly uploaded (orphaned) asset.
    await deleteRejectedUpload(newPublicId, "private");
    return { ok: false, error: "Failed to save photo reference. Your upload has been removed." };
  }

  // DB persisted. Now delete the old asset (different from new).
  if (oldPublicId && oldPublicId !== newPublicId) {
    // H7 — the typed partial success below is preserved exactly, but the
    // failure is now ALSO recorded durably. The orphanPublicId contract was
    // only ever as strong as its consumer, and the sole consumer
    // (my-naia-model.tsx:110-113) just console.warn'd it: the DB row now
    // points at newPublicId, so oldPublicId is unreferenced, and no sweep
    // reads log lines.
    const del = await deleteCloudinaryAssetOrRecord(
      {
        customerId,
        publicId: oldPublicId,
        deliveryType: existing?.deliveryType ?? "private",
        context: "model-photo-replaced-old-asset",
      },
      _deleteAsset,
      _recordFailure,
    );
    if (!del.ok) {
      // Old asset not deleted — return a typed partial-success so the caller can retry cleanup.
      return { ok: true, model, orphanPublicId: oldPublicId };
    }
  }

  return { ok: true, model };
}

// ── NaiaModel — delete photo reference (privacy-first order) ──────────────────
//
// Deletes the Cloudinary asset FIRST, then clears the DB reference.
//
// Privacy-first rationale:
//   - A deleted Cloudinary asset is immediately inaccessible (no URL can serve it).
//   - A stale DB reference to a deleted asset produces only 404s from Cloudinary.
//   - Clearing DB before Cloudinary deletion would leave a live accessible asset
//     with no record of it — worse from a privacy standpoint.
//
// Return semantics:
//   cloudinaryOk: true  — asset was deleted (or was not found, idempotent).
//   dbCleared: true     — DB reference was cleared.
//   staleReference: true — Cloudinary deleted but DB clear failed; DB still has the publicId,
//                          but no valid preview URL can be served (asset is gone from Cloudinary).

export async function deleteNaiaModelPhoto(
  customerId: string,
  slot: "face" | "body",
  _findModelFn: FindModelFn = _findModel,
  _upsertModelFn: UpsertModelFn = _upsertModel,
  _deleteAsset: DeleteAssetFn = deleteCloudinaryAsset,
): Promise<{
  ok: boolean;
  cloudinaryOk: boolean;
  dbCleared: boolean;
  staleReference: boolean;
  error?: string;
}> {
  const model = await _findModelFn(customerId);
  if (!model) {
    return { ok: true, cloudinaryOk: true, dbCleared: true, staleReference: false };
  }

  const publicId = slot === "face" ? model.facePublicId : model.bodyPublicId;
  if (!publicId) {
    return { ok: true, cloudinaryOk: true, dbCleared: true, staleReference: false };
  }

  // Step 1: Delete Cloudinary asset FIRST (privacy-first).
  //
  // H7 — deliberately NOT routed through deleteCloudinaryAssetOrRecord, and
  // this is not an oversight. On failure this returns ok:false and leaves the
  // DB reference IN PLACE (dbCleared:false), so the asset is still live and
  // still referenced, and the customer gets an error they can retry. Nothing
  // is orphaned, so there is nothing for the retry sweep to reclaim.
  //
  // Recording here would be actively harmful: while a
  // PendingCloudinaryDeletion row is unresolved, assertPublicIdAvailable
  // refuses to let any new DB row reference that publicId — so a transient
  // Cloudinary error would permanently claim a photo the customer still owns
  // and still has referenced.
  const delResult = await _deleteAsset(publicId, model.deliveryType ?? "private");
  if (!delResult.ok) {
    return {
      ok: false,
      cloudinaryOk: false,
      dbCleared: false,
      staleReference: false,
      error: delResult.errorCode,
    };
  }

  // Step 2: Clear DB reference.
  const clearData =
    slot === "face"
      ? { facePublicId: null, faceVersion: null, faceFormat: null }
      : {
          bodyPublicId: null,
          bodyVersion: null,
          bodyFormat: null,
          bodyModerationStatus: null,
          bodyModerationAt: null,
        };

  try {
    await _upsertModelFn(customerId, clearData);
  } catch {
    // Asset deleted from Cloudinary but DB clear failed.
    // The DB still references a now-deleted asset — signed URLs for it will 404.
    // This is a stale reference: no usable preview URL can be generated.
    return { ok: false, cloudinaryOk: true, dbCleared: false, staleReference: true };
  }

  return { ok: true, cloudinaryOk: true, dbCleared: true, staleReference: false };
}

// ── NaiaModel — save selfie as model face (trusted path) ─────────────────────
//
// Trusted-path transfer: the selfie has already passed content moderation and the
// face quality gate during Selfie Style Analysis. No re-verification needed.
// Ownership moves from SelfieAnalysis to NaiaModel — the caller must call
// clearSelfiePhotoOwnership() afterwards to prevent double-deletion.
//
// Replace flow:
//   1. Read current model to capture old facePublicId.
//   2. Upsert new facePublicId in DB.
//   3. On DB failure → return error (caller keeps the selfie as a fallback).
//   4. On DB success → delete old facePublicId from Cloudinary if different.

export async function saveSelfieAsModelFace(
  customerId: string,
  selfiePublicId: string,
  selfieFormat: string | null,
  _findModelFn: FindModelFn = _findModel,
  _upsertModelFn: UpsertModelFn = _upsertModel,
  _deleteAsset: DeleteAssetFn = deleteCloudinaryAsset,
  _recordFailure: RecordFailedDeletionFn = recordFailedCloudinaryDeletion,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const existing = await _findModelFn(customerId);
  const oldFacePublicId = existing?.facePublicId ?? null;

  try {
    await _upsertModelFn(customerId, {
      facePublicId: selfiePublicId,
      faceVersion: null,
      faceFormat: selfieFormat,
      deliveryType: "private",
    });
  } catch {
    return { ok: false, error: "Failed to save photo reference." };
  }

  if (oldFacePublicId && oldFacePublicId !== selfiePublicId) {
    // H7 — "an orphan at worst" was the whole problem. The DB row above now
    // points at selfiePublicId, so a failure here leaves the customer's
    // previous FACE photo in storage, unreferenced, with nothing recording
    // that it still needs deleting. Recorded for the retry sweep instead.
    // Still never blocks: the selfie is already saved as the model face.
    await deleteCloudinaryAssetOrRecord(
      {
        customerId,
        publicId: oldFacePublicId,
        deliveryType: existing?.deliveryType ?? "private",
        context: "model-face-replaced-by-selfie",
      },
      _deleteAsset,
      _recordFailure,
    );
  }

  return { ok: true };
}

// ── NaiaModel — clear face reference without Cloudinary deletion ──────────────
//
// Clears facePublicId/faceFormat/faceVersion in NaiaModel WITHOUT deleting the
// Cloudinary asset. Used when another code path (e.g. deleteSelfiePhoto in the
// keep-analysis flow) already owns and will perform the single Cloudinary deletion,
// preventing double-deletion when SelfieAnalysis and NaiaModel share the same asset.

export async function clearNaiaModelFaceReference(
  customerId: string,
  _upsertModelFn: UpsertModelFn = _upsertModel,
): Promise<void> {
  await _upsertModelFn(customerId, {
    facePublicId: null,
    faceVersion: null,
    faceFormat: null,
  });
}

// ── NaiaModel — consent ───────────────────────────────────────────────────────

export type ConsentType = "photoAnalysis" | "saveModel";

export async function saveNaiaModelConsent(
  customerId: string,
  types: ConsentType[],
  policyVersion: string,
  now: Date = new Date(),
  _upsertModelFn: UpsertModelFn = _upsertModel,
): Promise<NaiaModelRecord> {
  const data: Partial<NaiaModelRecord> = { consentPolicyVersion: policyVersion };
  if (types.includes("photoAnalysis")) data.photoAnalysisConsentAt = now;
  if (types.includes("saveModel")) data.saveModelConsentAt = now;
  return _upsertModelFn(customerId, data);
}

// Withdraw photo-analysis consent only.
// Does NOT touch save-model consent, photos, or any other consent field.
// Per-generation provider consent is per-job and has no withdrawal path (immutable audit record).
export async function withdrawPhotoAnalysisConsent(
  customerId: string,
  _upsertModelFn: UpsertModelFn = _upsertModel,
): Promise<NaiaModelRecord> {
  return _upsertModelFn(customerId, { photoAnalysisConsentAt: null });
}

// Withdraw save-model consent:
//   1. Attempt Cloudinary deletion for face and body assets (both attempted even if one fails).
//   2. Clear DB photo references and saveModelConsentAt — ALWAYS (disables readiness).
//   3. Return typed partial-deletion result for retry if needed.
// A failed deletion's full identity — enough for a retry to target the
// correct asset without re-guessing its delivery type. deliveryType is
// either the real, Cloudinary-confirmed type, or the sentinel "unknown"
// when it could not be established (see resolveModelAssetDeliveryType) —
// "unknown" is a durable marker for a retry to re-resolve, never a value
// passed to an actual Cloudinary API call.
export interface FailedModelAsset {
  publicId: string;
  deliveryType: string;
  errorCode: string;
}

const MODEL_DELIVERY_TYPE_CANDIDATES = ["private", "authenticated"] as const;

// Establishes an asset's real Cloudinary delivery type via the Admin API's
// own authoritative response — never guessed, never defaulted to "private".
// model.deliveryType (stamped at upload time by saveNaiaModelPhoto, from the
// Admin API's own asset.type) is the normal, zero-extra-call source; this is
// only reached for a legacy row that predates that field. Tries each
// candidate type in turn — the first the asset is confirmed to actually
// exist under is the real type. Returns null if neither resolves (asset
// genuinely gone, or the provider is unreachable); the caller must not then
// assume any particular type.
//
// NaiaModel.deliveryType is NOT NULL with @default("private") in
// schema.prisma, so this fallback is not reachable through any ordinary
// application code path today (every real row always has a value) — it
// exists as defense in depth against a row this constraint doesn't cover
// (a raw write, a future schema change), kept deliberately rather than
// assumed-safe to omit.
async function resolveModelAssetDeliveryType(
  publicId: string,
  _verifyAssetByType: (
    publicId: string,
    deliveryType: string,
  ) => Promise<{ ok: true; asset: { type: string } } | { ok: false; errorCode: string }>,
): Promise<string | null> {
  for (const candidate of MODEL_DELIVERY_TYPE_CANDIDATES) {
    const result = await _verifyAssetByType(publicId, candidate);
    if (result.ok) return result.asset.type || candidate;
  }
  return null;
}

export async function withdrawSaveModelConsent(
  customerId: string,
  _upsertModelFn: UpsertModelFn = _upsertModel,
  _findModelFn: FindModelFn = _findModel,
  _deleteAsset: DeleteAssetFn = deleteCloudinaryAsset,
  _verifyAssetByType: (
    publicId: string,
    deliveryType: string,
  ) => Promise<{ ok: true; asset: { type: string } } | { ok: false; errorCode: string }> = verifyCloudinaryAsset,
  _recordFailure: RecordFailedDeletionFn = recordFailedCloudinaryDeletion,
): Promise<{ ok: boolean; deletedAssets: string[]; failedAssets: FailedModelAsset[] }> {
  const model = await _findModelFn(customerId);
  const deletedAssets: string[] = [];
  const failedAssets: FailedModelAsset[] = [];

  async function attemptDelete(publicId: string): Promise<void> {
    let deliveryType = model?.deliveryType ?? null;
    if (!deliveryType) {
      deliveryType = await resolveModelAssetDeliveryType(publicId, _verifyAssetByType);
    }
    if (!deliveryType) {
      // Delivery type could not be established — do not attempt a delete
      // against a guessed type. Durable unresolved record (deliveryType:
      // "unknown"), not a reported success.
      //
      // H7 — "durable" now actually means durable. The DB references are
      // cleared unconditionally below, so returning this only in failedAssets
      // left the asset unreferenced and untracked for every caller that did
      // not persist the array. The "unknown" sentinel is recorded verbatim:
      // retryPendingCloudinaryDeletion re-resolves it via the Admin API
      // rather than deleting against a guess.
      failedAssets.push({ publicId, deliveryType: "unknown", errorCode: "DELIVERY_TYPE_UNKNOWN" });
      await _recordFailure({
        customerId,
        publicId,
        deliveryType: "unknown",
        context: "model-consent-withdrawn-deletion-failed",
        lastError: "DELIVERY_TYPE_UNKNOWN",
      });
      return;
    }
    // H7 — recorded at the point of failure, not left to the caller. The
    // account-erasure caller (customer-privacy.server.ts:344) does persist
    // failedAssets, but the two customer-facing callers do not:
    // withdrawSaveModelConsentAndVtoResults passes them straight through in
    // its return value, and its VTO-sweep obligation covers only the derived
    // VTO RESULT assets, never these model photos. A repeat record for the
    // erasure path is harmless — publicId is @unique, so the upsert bumps
    // attemptCount rather than duplicating the row.
    const r = await deleteCloudinaryAssetOrRecord(
      {
        customerId,
        publicId,
        deliveryType,
        context: "model-consent-withdrawn-deletion-failed",
      },
      _deleteAsset,
      _recordFailure,
    );
    if (r.ok) deletedAssets.push(publicId);
    else failedAssets.push({ publicId, deliveryType, errorCode: r.errorCode ?? "UNKNOWN" });
  }

  // Attempt deletion for each asset independently (privacy-first, both attempted).
  if (model?.facePublicId) await attemptDelete(model.facePublicId);
  if (model?.bodyPublicId) await attemptDelete(model.bodyPublicId);

  // Always clear DB photo references and saveModelConsent — disables readiness regardless.
  await _upsertModelFn(customerId, {
    facePublicId: null,
    faceVersion: null,
    bodyPublicId: null,
    bodyVersion: null,
    saveModelConsentAt: null,
    consentPolicyVersion: null,
  });

  return { ok: failedAssets.length === 0, deletedAssets, failedAssets };
}

// ── NaiaModel — readiness ─────────────────────────────────────────────────────

export function computeModelReadiness(
  facePhotoUrl?: string | null,
  fullBodyPhotoUrl?: string | null,
  consent?: NaiaModelConsentState,
): NaiaModelReadiness {
  const hasFacePhoto = typeof facePhotoUrl === "string" && facePhotoUrl.length > 0;
  const hasFullBodyPhoto = typeof fullBodyPhotoUrl === "string" && fullBodyPhotoUrl.length > 0;
  const resolvedConsent = consent ?? DEFAULT_CONSENT_STATE;
  const isReadyForTryOn = hasFullBodyPhoto && resolvedConsent.virtualTryOnConsent;
  return { hasFacePhoto, hasFullBodyPhoto, isReadyForTryOn };
}

export function computeModelReadinessFromRecord(
  model: NaiaModelRecord | null,
): NaiaModelReadiness {
  if (!model) {
    return { hasFacePhoto: false, hasFullBodyPhoto: false, isReadyForTryOn: false };
  }
  const hasFacePhoto = typeof model.facePublicId === "string" && model.facePublicId.length > 0;
  const hasFullBodyPhoto =
    typeof model.bodyPublicId === "string" && model.bodyPublicId.length > 0;
  const isReadyForTryOn = hasFullBodyPhoto && model.saveModelConsentAt !== null;
  return { hasFacePhoto, hasFullBodyPhoto, isReadyForTryOn };
}

// ── VirtualTryOnJob — idempotency helpers ────────────────────────────────────

export function generateIdempotencyKey(): string {
  return randomBytes(20).toString("base64url");
}

export function computeRequestFingerprint(
  customerId: string,
  productHandle: string,
  bodyPublicId: string | null,
): string {
  return createHash("sha256")
    .update(`${customerId}:${productHandle}:${bodyPublicId ?? ""}`)
    .digest("hex")
    .slice(0, 32);
}

// ── VirtualTryOnJob — state machine ──────────────────────────────────────────

export function validateJobTransition(
  from: TryOnJobStatus,
  to: TryOnJobStatus,
): { ok: true } | { ok: false; error: string } {
  const allowed = ALLOWED_TRANSITIONS[from];
  if (!(allowed as readonly string[]).includes(to)) {
    return { ok: false, error: `Invalid status transition: ${from} → ${to}` };
  }
  return { ok: true };
}

// ── VirtualTryOnJob — cooldown check ─────────────────────────────────────────
//
// Two distinct rejection reasons:
//   ACTIVE_JOB — a CREATED/SUBMITTED/PROCESSING job already exists for this
//                customer; starting another would double-charge the provider.
//   COOLDOWN   — a short (2 s) post-completion buffer against accidental
//                double-taps. Does not fire between different items when the
//                user pauses even briefly between tries.

const COOLDOWN_MS = 2_000;

export type CooldownResult =
  | { ok: true }
  | { ok: false; reason: "ACTIVE_JOB" | "COOLDOWN"; retryAfterMs?: number };

export async function checkCustomerCooldown(
  customerId: string,
  cooldownMs: number = COOLDOWN_MS,
  _findJobFn: FindJobFn = _findJob,
): Promise<CooldownResult> {
  const recentJob = await _findJobFn({ customerId }); // ordered by lastActivityAt desc
  if (!recentJob) return { ok: true };

  if ((ACTIVE_STATUSES as readonly string[]).includes(recentJob.status)) {
    return { ok: false, reason: "ACTIVE_JOB" };
  }

  const elapsed = Date.now() - recentJob.lastActivityAt.getTime();
  if (elapsed < cooldownMs) {
    return { ok: false, reason: "COOLDOWN", retryAfterMs: cooldownMs - elapsed };
  }
  return { ok: true };
}

// ── VirtualTryOnJob — concurrency-safe create or find ────────────────────────
//
// Idempotency check (no transaction, cheap):
//   - Same idempotency key + same customer → return existing job.
//   - Same idempotency key + different customer → IDEMPOTENCY_CONFLICT.
//
// Atomic active-job-check + create (Serializable transaction):
//   - Prevents two simultaneous requests creating two active chargeable jobs.
//   - Retries bounded at MAX_TX_RETRIES for serialization/deadlock errors.
//   - After retry exhaustion, propagates the error (caller handles 500).
//
// No provider submission occurs before this function returns { ok: true }.

const MAX_TX_RETRIES = 2;

function isSerializationError(e: unknown): boolean {
  // Prisma P2034: Transaction failed due to a write conflict or a deadlock.
  return (e as any)?.code === "P2034";
}

function isDuplicateKeyError(e: unknown): boolean {
  // Prisma P2002: Unique constraint violation.
  return (e as any)?.code === "P2002";
}

export interface CreateJobParams {
  customerId: string;
  naiaModelId: string | null;
  productHandle: string;
  bodyPublicId: string | null;
  virtualTryOnConsentAt: Date;
  saveTryOnResultConsentAt?: Date | null;
  idempotencyKey: string;
  // Omitted by the single-item flow (defaults to null, byte-identical to
  // before this field existed). Set by the full-look chain on every step.
  outfitSuggestionId?: string | null;
}

export async function createOrFindTryOnJob(
  params: CreateJobParams,
  _findJobFn: FindJobFn = _findJob,
  _runTransaction: RunTransactionFn = _runJobTransaction,
): Promise<
  | { ok: true; job: VirtualTryOnJobRecord; created: boolean }
  | { ok: false; error: string; code: string }
> {
  // Fast idempotency check before entering the transaction.
  const existing = await _findJobFn({ idempotencyKey: params.idempotencyKey });
  if (existing) {
    if (existing.customerId !== params.customerId) {
      return { ok: false, error: "Invalid idempotency key.", code: "IDEMPOTENCY_CONFLICT" };
    }
    return { ok: true, job: existing, created: false };
  }

  const fingerprint = computeRequestFingerprint(
    params.customerId,
    params.productHandle,
    params.bodyPublicId,
  );
  const now = new Date();
  const jobData: Omit<VirtualTryOnJobRecord, "id" | "createdAt" | "updatedAt"> = {
    customerId: params.customerId,
    naiaModelId: params.naiaModelId,
    productHandle: params.productHandle,
    provider: "FASHN",
    predictionId: null,
    status: "CREATED",
    virtualTryOnConsentAt: params.virtualTryOnConsentAt,
    consentPolicyVersion: POLICY_VERSION,
    saveTryOnResultConsentAt: params.saveTryOnResultConsentAt ?? null,
    idempotencyKey: params.idempotencyKey,
    requestFingerprint: fingerprint,
    errorCode: null,
    completedAt: null,
    lastActivityAt: now,
    outfitSuggestionId: params.outfitSuggestionId ?? null,
  };

  for (let attempt = 0; attempt <= MAX_TX_RETRIES; attempt++) {
    try {
      const result = await _runTransaction(async (ops) => {
        const activeJob = await ops.findActiveJob(params.customerId);
        if (activeJob) return { blocked: true, job: activeJob };
        const job = await ops.createJob(jobData);
        return { blocked: false, job };
      });

      if (result.blocked) {
        return { ok: false, error: "Generation in progress. Try again shortly.", code: "ACTIVE_JOB_EXISTS" };
      }
      return { ok: true, job: result.job, created: true };
    } catch (e) {
      if (isSerializationError(e) && attempt < MAX_TX_RETRIES) {
        // Bounded retry for serialization/deadlock conflicts.
        continue;
      }
      if (isDuplicateKeyError(e)) {
        // Concurrent create with the same idempotency key won the race — re-read it.
        const concurrent = await _findJobFn({ idempotencyKey: params.idempotencyKey });
        if (concurrent && concurrent.customerId === params.customerId) {
          return { ok: true, job: concurrent, created: false };
        }
      }
      throw e;
    }
  }
  // Unreachable — loop always returns or throws.
  throw new Error("Unexpected exit from createOrFindTryOnJob retry loop");
}

// ── VirtualTryOnJob — advance status ─────────────────────────────────────────

export async function advanceTryOnJob(
  job: VirtualTryOnJobRecord,
  newStatus: TryOnJobStatus,
  extras: { predictionId?: string; errorCode?: string } = {},
  _updateJobFn: UpdateJobFn = _updateJob,
): Promise<
  | { ok: true; job: VirtualTryOnJobRecord }
  | { ok: false; error: string }
> {
  const validation = validateJobTransition(job.status, newStatus);
  if (!validation.ok) {
    return { ok: false, error: validation.error };
  }

  const isTerminal = !(ACTIVE_STATUSES as readonly string[]).includes(newStatus);
  const now = new Date();

  const updated = await _updateJobFn(job.id, {
    status: newStatus,
    predictionId: extras.predictionId ?? job.predictionId,
    errorCode: extras.errorCode ?? job.errorCode,
    completedAt: isTerminal ? now : job.completedAt,
    lastActivityAt: now,
  });

  return { ok: true, job: updated };
}

// ── Atomic compare-and-set close-out (2026-11-16) ───────────────────────────
//
// advanceTryOnJob (above) performs an UNCONDITIONAL update by id — correct
// for every one of its own existing callers, where only one caller could
// ever reach that exact transition (a fresh submission; a brand-new
// recovery row nothing else is watching). It is NOT safe for a row that a
// genuinely concurrent SECOND caller might also be closing out at the same
// instant — the real scenario found in Full-Look VTO's own server-side
// reconciliation work: a customer's own live poll and an independent
// reconciliation sweep (or two overlapping reconciliation workers) can
// both observe the same PROCESSING row's provider status at the same time
// and both decide to close it out. A separate read-then-write re-check
// cannot close that: two readers can both observe PROCESSING before
// either's write lands.
//
// This performs the transition and the "is this row still mine to close"
// check as ONE atomic SQL statement. updateMany's WHERE clause is
// evaluated against the database's own currently-committed row at the
// instant each UPDATE physically executes, so of two genuinely
// simultaneous attempts to close out the SAME row, only one can ever
// match `status: "PROCESSING"` and actually write — the other affects
// zero rows and is told so directly (claimed: false). No explicit lock,
// no new intermediate status value, no schema change (TryOnJobStatus
// already has every value this needs).
//
// Generic over which job/table this guards (not Full-Look-specific) —
// lives here, next to advanceTryOnJob and the Prisma client both already
// use, rather than in full-look-tryon-real.server.ts, so any other
// feature with the same "two independent pollers might race to close the
// same row" shape can reuse it instead of re-deriving this.
export type AtomicCloseOutResult =
  | { claimed: true; job: VirtualTryOnJobRecord }
  | { claimed: false };

// DI hook (same convention as advanceTryOnJob's own _updateJobFn) so this
// can be unit-tested against a small, realistic fake that implements the
// actual conditional-update contract, without mocking the whole module
// away — see this file's own test suite for exactly that, including a
// genuinely concurrent (same-tick, not sequential) two-caller race.
export type AtomicUpdateManyFn = (
  jobId: string,
  data: { status: "COMPLETED" | "FAILED"; predictionId: string | null; errorCode: string | null; completedAt: Date; lastActivityAt: Date },
) => Promise<{ count: number }>;

async function _defaultAtomicUpdateMany(
  jobId: string,
  data: { status: "COMPLETED" | "FAILED"; predictionId: string | null; errorCode: string | null; completedAt: Date; lastActivityAt: Date },
): Promise<{ count: number }> {
  return prisma.virtualTryOnJob.updateMany({ where: { id: jobId, status: "PROCESSING" }, data });
}

export async function atomicallyCloseOutProcessingJob(
  job: VirtualTryOnJobRecord,
  newStatus: "COMPLETED" | "FAILED",
  extras: { predictionId?: string; errorCode?: string } = {},
  _updateMany: AtomicUpdateManyFn = _defaultAtomicUpdateMany,
): Promise<AtomicCloseOutResult> {
  const now = new Date();
  const predictionId = extras.predictionId ?? job.predictionId;
  const errorCode = extras.errorCode ?? job.errorCode;
  const result = await _updateMany(job.id, { status: newStatus, predictionId, errorCode, completedAt: now, lastActivityAt: now });
  if (result.count === 0) {
    // Someone else — the customer's own concurrent poll, or another
    // reconciliation worker — already closed this row out first. Never
    // write, never overwrite whatever THEY persisted.
    return { claimed: false };
  }
  return { claimed: true, job: { ...job, status: newStatus, predictionId, errorCode, completedAt: now, lastActivityAt: now } };
}

// ── Claim-before-side-effect lease (2026-11-16) ─────────────────────────────
//
// CONFIRMED GAP in atomicallyCloseOutProcessingJob alone: that function
// only makes the FINAL database write atomic. Everything before it —
// checking the provider's status, then uploading the real result to
// Cloudinary — still runs unguarded. Two genuinely concurrent callers (a
// customer's own live poll racing the independent reconciliation sweep,
// or two overlapping reconciliation workers) could BOTH reach the
// Cloudinary upload before either's atomic close-out resolves anything.
// The upload itself is idempotent (same publicId, overwrite semantics —
// proven in cloudinary-admin.server.test.ts), so this was never a
// correctness bug, but it is a real, avoidable waste: a second real
// network call to Cloudinary that serves no purpose.
//
// This closes that gap the same way the close-out above does — one
// atomic conditional UPDATE, this time reusing the EXISTING
// lastActivityAt column as a lease marker instead of adding a new status
// value or schema change. Acquiring the lease is exactly "bump
// lastActivityAt to now, but ONLY if it's currently older than the lease
// duration" — a genuinely concurrent second caller's own attempt to bump
// the SAME column, checked against the SAME condition, fails the instant
// the first caller's bump has landed, for exactly the same database-level
// reason atomicallyCloseOutProcessingJob's own claim works.
//
// CRASH RECOVERY is a direct, free consequence of reusing this column
// rather than inventing a separate lock table or lock row: if a caller
// acquires the lease and then crashes before ever reaching the final
// close-out, the row is left at status PROCESSING with a freshly-bumped
// lastActivityAt — indistinguishable, to any other caller, from a lease
// that is still legitimately in use. Once leaseDurationMs elapses with
// no further activity, lastActivityAt ages past the threshold again and
// the NEXT caller's own lease-acquire attempt succeeds, safely retrying
// the whole operation from scratch (a fresh, free status check; an
// idempotent re-upload under the same publicId; a fresh close-out
// attempt) — no stuck row, no manual intervention, and never a second
// paid prediction, since nothing here ever resubmits to the provider.
export type TryAcquireLeaseResult = { acquired: true } | { acquired: false };

export type LeaseUpdateManyFn = (
  jobId: string,
  cutoff: Date,
  now: Date,
) => Promise<{ count: number }>;

async function _defaultLeaseUpdateMany(jobId: string, cutoff: Date, now: Date): Promise<{ count: number }> {
  return prisma.virtualTryOnJob.updateMany({
    where: { id: jobId, status: "PROCESSING", lastActivityAt: { lt: cutoff } },
    data: { lastActivityAt: now },
  });
}

export async function tryAcquireProcessingLease(
  jobId: string,
  leaseDurationMs: number,
  _updateMany: LeaseUpdateManyFn = _defaultLeaseUpdateMany,
  _now: () => number = Date.now,
): Promise<TryAcquireLeaseResult> {
  const now = _now();
  const result = await _updateMany(jobId, new Date(now - leaseDurationMs), new Date(now));
  return { acquired: result.count > 0 };
}

// ── Re-exports for route / component compatibility ────────────────────────────

export { DEFAULT_CONSENT_STATE };

export type PhotoValidationResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

export function validateCloudinaryPhotoUrl(
  url: string,
  customerId: string,
): PhotoValidationResult {
  if (!url || typeof url !== "string") {
    return { ok: false, error: "Photo URL is required." };
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: "Invalid photo URL." };
  }
  if (parsed.protocol !== "https:") return { ok: false, error: "Invalid photo URL." };
  if (!parsed.hostname.endsWith("cloudinary.com")) return { ok: false, error: "Invalid photo URL." };
  if (!parsed.pathname.includes(`naia-wardrobe/${customerId}/`)) {
    return { ok: false, error: "Photo does not belong to this account." };
  }
  const ALLOWED_FORMATS = new Set(["jpg", "jpeg", "png", "webp", "heic", "heif"]);
  const ext = parsed.pathname.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_FORMATS.has(ext)) return { ok: false, error: "Unsupported image format." };
  return { ok: true, url };
}

export function assertPhotoOwnership(url: string, customerId: string): void {
  const result = validateCloudinaryPhotoUrl(url, customerId);
  if (!result.ok) throw new Error(`Photo ownership check failed: ${result.error}`);
}
