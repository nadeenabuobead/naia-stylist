// app/lib/ai/my-naia-model.server.ts
// NaiaModel and VirtualTryOnJob service layer — Phase 4A2 hardened.
//
// Privacy contract:
//   - All new uploads use Cloudinary delivery type "private".
//   - Signed delivery URLs are generated per-request; never persisted.
//   - Deletion is Cloudinary-first (asset gone before DB reference clears).
//   - Compensation: DB failure after upload → delete the newly uploaded asset.
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
  moderateImageContent,
  type ModerationResult,
  type AnalyzeForModerationFn,
} from "../image-moderation.server.js";
import {
  screenVtoBodyPhoto,
  type VtoSuitabilityResult,
  type AnalyzeForSuitabilityFn,
} from "../image-suitability.server.js";

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
    (tx) =>
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
export function buildModelPreviewUrl(
  publicId: string,
  format: string | null,
  deliveryType: string = "private",
  _getConfig: () => CloudinaryConfig | null = getCloudinaryConfig,
  nowFn: () => number = Date.now,
): string | null {
  const cfg = _getConfig();
  if (!cfg) return null;
  return buildPrivateDownloadUrl(cfg, publicId, format ?? "jpg", deliveryType, nowFn);
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
): Promise<
  | { ok: true; model: NaiaModelRecord; orphanPublicId?: string }
  | { ok: false; error: string }
> {
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
    await _deleteAsset(newPublicId, asset.type || "private");
    return { ok: false, error: "Only image uploads are permitted for model photos." };
  }
  if (asset.type !== "private") {
    // Public or non-private asset — delete as compensation and reject.
    await _deleteAsset(newPublicId, asset.type || "upload");
    return { ok: false, error: "Public delivery type is not permitted for model photos." };
  }

  // Use server-verified values. Browser-supplied version/format are not persisted.
  const verifiedFormat = asset.format || null;
  const verifiedVersion = asset.version || null;

  // ── Layer 1: format allowlist, size cap, dimension bounds (Admin API only) ──
  const ALLOWED_FORMATS = new Set(["jpg", "jpeg", "png", "webp", "heic", "heif"]);
  if (verifiedFormat && !ALLOWED_FORMATS.has(verifiedFormat)) {
    await _deleteAsset(newPublicId, "private");
    return { ok: false, error: `File type "${verifiedFormat}" is not accepted. Use JPG, PNG, WEBP, or HEIC.` };
  }
  const MAX_BYTES = 5 * 1024 * 1024;
  if (asset.bytes && asset.bytes > MAX_BYTES) {
    await _deleteAsset(newPublicId, "private");
    return { ok: false, error: "Photo is too large. Maximum size is 5 MB." };
  }
  const MIN_DIM = 200;
  const MAX_DIM = 8000;
  if (asset.width !== null && asset.width < MIN_DIM) {
    await _deleteAsset(newPublicId, "private");
    return { ok: false, error: `Photo width (${asset.width}px) is below the minimum of ${MIN_DIM}px.` };
  }
  if (asset.height !== null && asset.height < MIN_DIM) {
    await _deleteAsset(newPublicId, "private");
    return { ok: false, error: `Photo height (${asset.height}px) is below the minimum of ${MIN_DIM}px.` };
  }
  if (asset.width !== null && asset.width > MAX_DIM) {
    await _deleteAsset(newPublicId, "private");
    return { ok: false, error: `Photo width (${asset.width}px) exceeds the maximum of ${MAX_DIM}px.` };
  }
  if (asset.height !== null && asset.height > MAX_DIM) {
    await _deleteAsset(newPublicId, "private");
    return { ok: false, error: `Photo height (${asset.height}px) exceeds the maximum of ${MAX_DIM}px.` };
  }

  // ── Layer 2: global content safety moderation (both slots) ───────────────
  const cfg = _getConfig();
  if (!cfg) {
    await _deleteAsset(newPublicId, "private");
    return { ok: false, error: "Image service is not configured. Please try again." };
  }
  const moderationUrl = buildPrivateDownloadUrl(cfg, newPublicId, verifiedFormat ?? "jpg", "private");
  const moderation = await _moderateContent(moderationUrl);
  if (moderation.status === "MODERATION_UNAVAILABLE") {
    await _deleteAsset(newPublicId, "private");
    return { ok: false, error: "Image review is temporarily unavailable. Please try again." };
  }
  if (moderation.status === "SAFETY_REJECT") {
    await _deleteAsset(newPublicId, "private");
    return { ok: false, error: "Photo could not be accepted. Please use a different image." };
  }

  // ── Layer 3: body photo suitability (body slot only) ─────────────────────
  let bodyModerationApproved = false;
  if (slot === "body") {
    const suitability = await _screenBodyPhoto(moderationUrl);
    if (suitability.status !== "PASS") {
      await _deleteAsset(newPublicId, "private");
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
    await _deleteAsset(newPublicId, "private");
    return { ok: false, error: "Failed to save photo reference. Your upload has been removed." };
  }

  // DB persisted. Now delete the old asset (different from new).
  if (oldPublicId && oldPublicId !== newPublicId) {
    const del = await _deleteAsset(oldPublicId, existing?.deliveryType ?? "private");
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
export async function withdrawSaveModelConsent(
  customerId: string,
  _upsertModelFn: UpsertModelFn = _upsertModel,
  _findModelFn: FindModelFn = _findModel,
  _deleteAsset: DeleteAssetFn = deleteCloudinaryAsset,
): Promise<{ ok: boolean; deletedAssets: string[]; failedAssets: string[] }> {
  const model = await _findModelFn(customerId);
  const deletedAssets: string[] = [];
  const failedAssets: string[] = [];

  // Attempt deletion for each asset independently (privacy-first, both attempted).
  if (model?.facePublicId) {
    const r = await _deleteAsset(model.facePublicId, model.deliveryType ?? "private");
    if (r.ok) deletedAssets.push(model.facePublicId);
    else failedAssets.push(model.facePublicId);
  }
  if (model?.bodyPublicId) {
    const r = await _deleteAsset(model.bodyPublicId, model.deliveryType ?? "private");
    if (r.ok) deletedAssets.push(model.bodyPublicId);
    else failedAssets.push(model.bodyPublicId);
  }

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

const COOLDOWN_MS = 10_000;

export async function checkCustomerCooldown(
  customerId: string,
  cooldownMs: number = COOLDOWN_MS,
  _findJobFn: FindJobFn = _findJob,
): Promise<{ ok: boolean; retryAfterMs?: number }> {
  const recentJob = await _findJobFn({ customerId }); // ordered by lastActivityAt desc
  if (!recentJob) return { ok: true };

  if ((ACTIVE_STATUSES as readonly string[]).includes(recentJob.status)) {
    return { ok: false, retryAfterMs: 0 }; // Blocked by an active job
  }

  const elapsed = Date.now() - recentJob.lastActivityAt.getTime();
  if (elapsed < cooldownMs) {
    return { ok: false, retryAfterMs: cooldownMs - elapsed };
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
