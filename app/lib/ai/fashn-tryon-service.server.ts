// app/lib/ai/fashn-tryon-service.server.ts
// Phase 4A5 — Virtual try-on service layer.
//
// Orchestrates the full lifecycle:
//   eligibility → cooldown → job create → model photo download →
//   FASHN submission → result upload → job complete → result URL
//
// Privacy contract:
//   - Model photo data URL never logged (fetched and forwarded in memory only).
//   - Result URLs are short-lived (10-min expiry); never persisted.
//   - Result public ID is derived: naia-tryon/{customerId}/{jobId} — no extra migration needed.
//   - Cross-customer access is rejected at ownership check.
//
// DI contract:
//   - executeTryOn accepts injected functions for all I/O; tests substitute mocks.
//   - Standalone functions (downloadModelPhotoAsDataUrl, etc.) take _fetch/_getConfig directly.

import {
  buildPrivateDownloadUrl,
  uploadCloudinaryPrivate,
  getCloudinaryConfig,
  deleteCloudinaryAsset,
  type CloudinaryConfig,
  type DeleteAssetFn,
} from "../cloudinary-admin.server.js";
import prisma from "../../db.server.js";
import {
  runFashnTryOn,
  isValidModelImageDataUrl,
  submitTryOnToProvider,
  type SubmitToProviderResult,
} from "./fashn-try-on.server.js";
import {
  resolveVerifiedMedia,
  resolveComponentMedia,
  type FashnGarmentCategory,
} from "./naia-product-media.js";
import { getProductByHandle } from "./naia-catalog.js";
import {
  createOrFindTryOnJob,
  advanceTryOnJob,
  checkCustomerCooldown,
  type CreateJobParams,
} from "./my-naia-model.server.js";
import {
  POLICY_VERSION,
  ACTIVE_STATUSES,
  CUSTOMER_ERROR_MESSAGES,
  type VirtualTryOnInput,
  type VirtualTryOnResult,
  type VirtualTryOnJobRecord,
  type TryOnJobStatus,
} from "./virtual-try-on.types.js";
import { isTryOnEligible } from "./tryon-product-eligibility.js";

// ── Garment eligibility ───────────────────────────────────────────────────────

export interface GarmentEligibilityOk {
  ok: true;
  garmentUrl: string;
  garmentCategory: FashnGarmentCategory;
  isComponent: boolean;
}
export interface GarmentEligibilityFail {
  ok: false;
  code: string;
  reason: string;
}
export type GarmentEligibilityResult = GarmentEligibilityOk | GarmentEligibilityFail;

export function validateGarmentEligibility(handle: string): GarmentEligibilityResult {
  const main = resolveVerifiedMedia(handle);
  if (main) {
    if (main.eligibility !== "ready") {
      return { ok: false, code: "NOT_READY", reason: main.reason };
    }
    if (!main.resolvedUrl) {
      return { ok: false, code: "MISSING_URL", reason: "Verified URL not populated for ready entry." };
    }
    return { ok: true, garmentUrl: main.resolvedUrl, garmentCategory: main.garmentCategory, isComponent: false };
  }

  const comp = resolveComponentMedia(handle);
  if (comp) {
    if (comp.eligibility !== "ready") {
      return { ok: false, code: "NOT_READY", reason: comp.reason };
    }
    if (!comp.resolvedUrl) {
      return { ok: false, code: "MISSING_URL", reason: "Verified URL not populated for ready component." };
    }
    return { ok: true, garmentUrl: comp.resolvedUrl, garmentCategory: comp.garmentCategory, isComponent: true };
  }

  return { ok: false, code: "UNKNOWN_HANDLE", reason: `No entry found for handle: ${handle}` };
}

export function resolveGarmentUrl(handle: string): string | null {
  const result = validateGarmentEligibility(handle);
  return result.ok ? result.garmentUrl : null;
}

// ── Model photo download (Cloudinary private → base64 data URL) ───────────────
//
// The private_download URL contains a signed credential — it must never be logged.
// The returned dataUrl is the model photo in base64 format suitable for FASHN input.

function formatToMimeSubtype(format: string): string {
  const f = format.toLowerCase();
  if (f === "jpg" || f === "jpeg") return "jpeg";
  if (f === "webp") return "webp";
  return "png";
}

export async function downloadModelPhotoAsDataUrl(
  bodyPublicId: string,
  bodyFormat: string | null,
  deliveryType: string,
  _fetch: typeof fetch = fetch,
  _getConfig: () => CloudinaryConfig | null = getCloudinaryConfig,
): Promise<{ ok: true; dataUrl: string } | { ok: false; errorCode: string }> {
  const cfg = _getConfig();
  if (!cfg) return { ok: false, errorCode: "NOT_CONFIGURED" };

  const format = bodyFormat ?? "jpg";
  // downloadUrl contains signed credentials — must not be logged
  const downloadUrl = buildPrivateDownloadUrl(cfg, bodyPublicId, format, deliveryType);

  try {
    const res = await _fetch(downloadUrl);
    if (!res.ok) return { ok: false, errorCode: "PROVIDER_ERROR" };

    const buffer = await res.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    const mimeSubtype = formatToMimeSubtype(format);
    const dataUrl = `data:image/${mimeSubtype};base64,${base64}`;

    if (!isValidModelImageDataUrl(dataUrl)) {
      return { ok: false, errorCode: "INVALID_MODEL_IMAGE" };
    }

    return { ok: true, dataUrl };
  } catch {
    return { ok: false, errorCode: "NETWORK_ERROR" };
  }
}

// ── Result storage ────────────────────────────────────────────────────────────
//
// Result public ID is derived from customer and job IDs — no Prisma field needed.
// Result is stored as a private Cloudinary asset; access only via short-lived signed URL.

export function deriveTryOnResultPublicId(customerId: string, jobId: string): string {
  return `naia-tryon/${customerId}/${jobId}`;
}

export async function uploadTryOnResult(
  customerId: string,
  jobId: string,
  outputDataUrl: string,
  _fetch: typeof fetch = fetch,
  _getConfig: () => CloudinaryConfig | null = getCloudinaryConfig,
): Promise<{ ok: true } | { ok: false; errorCode: string }> {
  const publicId = deriveTryOnResultPublicId(customerId, jobId);
  const result = await uploadCloudinaryPrivate(publicId, outputDataUrl, "private", _fetch, _getConfig);
  if (!result.ok) return { ok: false, errorCode: result.errorCode };
  return { ok: true };
}

export function buildTryOnResultUrl(
  customerId: string,
  jobId: string,
  _getConfig: () => CloudinaryConfig | null = getCloudinaryConfig,
  nowFn: () => number = Date.now,
): string | null {
  const cfg = _getConfig();
  if (!cfg) return null;
  const publicId = deriveTryOnResultPublicId(customerId, jobId);
  return buildPrivateDownloadUrl(cfg, publicId, "png", "private", nowFn);
}

// ── Ownership check ───────────────────────────────────────────────────────────
//
// Result delivery is restricted to the customer who owns the job.
// Both IDs are internal DB UUIDs (not Shopify IDs).

export function checkResultOwnership(
  jobCustomerId: string,
  requestingCustomerId: string,
): boolean {
  if (!jobCustomerId || !requestingCustomerId) return false;
  return jobCustomerId === requestingCustomerId;
}

// ── Source-photo validity re-check (deletion-during-processing guard) ────────
//
// submitTryOnJob downloads the body photo once, at submission, and hands it
// to FASHN in memory — the source Cloudinary asset is never re-read after
// that. If the customer deletes their My nAia Model body photo while the job
// is still in flight, nothing before this stopped the job from completing
// and writing a brand-new Cloudinary result asset derived from a photo that
// no longer exists for this customer. Call this immediately before
// persisting any result, and refuse to proceed if it returns false.
//
// Known limitation: this confirms SOME current body photo exists for this
// customer and belongs to them — not that it is byte-identical to the exact
// photo used at submission. bodyPublicId is never persisted on the
// VirtualTryOnJob row itself (only one-way hashed into requestFingerprint),
// so a customer who deletes their photo and uploads a *different* one while
// a job is in flight will still pass this check. Closing that narrower gap
// would need a new column recording the exact publicId a job used, which is
// a separate, not-yet-approved schema change.

export type FindNaiaModelForValidationFn = (
  naiaModelId: string,
) => Promise<{ customerId: string; bodyPublicId: string | null } | null>;

async function _findNaiaModelForValidation(
  naiaModelId: string,
): Promise<{ customerId: string; bodyPublicId: string | null } | null> {
  return prisma.naiaModel.findUnique({
    where: { id: naiaModelId },
    select: { customerId: true, bodyPublicId: true },
  });
}

export async function isSourcePhotoStillValid(
  naiaModelId: string | null,
  jobCustomerId: string,
  _findNaiaModel: FindNaiaModelForValidationFn = _findNaiaModelForValidation,
): Promise<boolean> {
  if (!naiaModelId) return false;
  const model = await _findNaiaModel(naiaModelId);
  if (!model) return false;
  if (model.customerId !== jobCustomerId) return false;
  return typeof model.bodyPublicId === "string" && model.bodyPublicId.length > 0;
}

// ── submitTryOnJob ────────────────────────────────────────────────────────────
//
// M1 customer-facing orchestration: runs all pre-flight checks, creates the job,
// submits to FASHN (POST only — no poll), and persists the predictionId.
// Returns { jobId } immediately; M2 poll route completes PROCESSING → COMPLETED.
//
// Why not executeTryOn: its internal poll loop runs up to 90s, which exceeds
// Vercel's 60s serverless function timeout on any plan.

export interface SubmitJobParams {
  internalCustomerId: string;
  naiaModelId: string;
  bodyPublicId: string;
  bodyFormat: string | null;
  deliveryType: string;
  garmentHandle: string;
  virtualTryOnConsentAt: Date;
  saveTryOnResultConsentAt?: Date | null;
  idempotencyKey: string;
  // Gate: PENDING/null means body photo has not passed Layer 2+3 moderation.
  // submitTryOnJob rejects unless this is "APPROVED".
  bodyModerationStatus?: string | null;
  // Non-NADINE garment sources (closet, buyskip):
  // Route action verifies ownership + eligibility server-side and passes the
  // pre-resolved signed Cloudinary URL here. When set, catalog eligibility checks
  // (validateGarmentEligibility / isTryOnEligible) are skipped.
  resolvedGarmentUrl?: string;
  garmentSource?: "nadine" | "closet" | "buyskip";
}

export type SubmitJobResult =
  | { ok: true; jobId: string }
  | { ok: false; code: string; customerMessage: string; jobId?: string };

export type SubmitToProviderFn = (
  input: import("./virtual-try-on.types.js").VirtualTryOnInput,
) => Promise<SubmitToProviderResult>;

export interface SubmitJobDeps {
  _downloadPhoto?: DownloadPhotoFn;
  _submitToProvider?: SubmitToProviderFn;
  _createOrFindJob?: CreateOrFindJobFn;
  _advanceJob?: AdvanceJobFn;
  _checkCooldown?: CheckCooldownFn;
}

const SUBMIT_ERRORS = {
  NOT_READY:      "This garment is not available for virtual try-on yet.",
  COOLDOWN:       "Please wait a moment before starting another virtual try-on.",
  ACTIVE_JOB:     "Your preview is still generating. Please wait for it to finish before starting another try-on.",
  NOT_CONFIGURED: "Virtual try-on is temporarily unavailable.",
  STATE_ERROR:    "Virtual try-on is temporarily unavailable.",
} as const;

export async function submitTryOnJob(
  params: SubmitJobParams,
  deps: SubmitJobDeps = {},
): Promise<SubmitJobResult> {
  const {
    _downloadPhoto     = (pid, fmt, dt) => downloadModelPhotoAsDataUrl(pid, fmt, dt),
    _submitToProvider  = (input) => submitTryOnToProvider(input),
    _createOrFindJob   = createOrFindTryOnJob,
    _advanceJob        = (job, status, extras) => advanceTryOnJob(job, status, extras),
    _checkCooldown     = checkCustomerCooldown,
  } = deps;

  // 0. Body photo moderation gate — fail-closed: APPROVED is the only value that passes.
  // bodyModerationStatus is set to "APPROVED" in saveNaiaModelPhoto after Layer 2+3 pass.
  // undefined, null, PENDING, REJECTED, and any unknown status all block here.
  if (params.bodyModerationStatus !== "APPROVED") {
    return {
      ok: false,
      code: "NOT_READY",
      customerMessage: "Your model photo is pending review. Please try again in a moment.",
    };
  }

  // 1. Garment URL resolution — two paths:
  //   a. Pre-resolved (closet/buyskip): route action verified ownership + eligibility
  //      server-side; signed URL is already built. Skip catalog checks.
  //   b. NADINE catalog: resolve from handle via verified media registry and outcome gate.
  let garmentUrl: string;
  if (params.resolvedGarmentUrl) {
    garmentUrl = params.resolvedGarmentUrl;
  } else {
    const garment = validateGarmentEligibility(params.garmentHandle);
    if (!garment.ok) {
      return { ok: false, code: "NOT_READY", customerMessage: SUBMIT_ERRORS.NOT_READY };
    }
    // Outcome eligibility — block garments not yet accepted in live provider testing.
    // "pending" (not yet tested) and "not-eligible" (tested and rejected) both block here.
    if (!isTryOnEligible(params.garmentHandle)) {
      return { ok: false, code: "NOT_READY", customerMessage: SUBMIT_ERRORS.NOT_READY };
    }
    garmentUrl = garment.garmentUrl;
  }

  // 2. Per-customer cooldown
  const cooldown = await _checkCooldown(params.internalCustomerId);
  if (!cooldown.ok) {
    if (cooldown.reason === "ACTIVE_JOB") {
      return { ok: false, code: "ACTIVE_JOB", customerMessage: SUBMIT_ERRORS.ACTIVE_JOB };
    }
    return { ok: false, code: "COOLDOWN", customerMessage: SUBMIT_ERRORS.COOLDOWN };
  }

  // 3. Create or find job (Serializable transaction)
  const jobResult = await _createOrFindJob({
    customerId:              params.internalCustomerId,
    naiaModelId:             params.naiaModelId,
    productHandle:           params.garmentHandle,
    bodyPublicId:            params.bodyPublicId,
    virtualTryOnConsentAt:   params.virtualTryOnConsentAt,
    saveTryOnResultConsentAt: params.saveTryOnResultConsentAt ?? null,
    idempotencyKey:          params.idempotencyKey,
  });

  if (!jobResult.ok) {
    const msg = jobResult.code === "ACTIVE_JOB_EXISTS"
      ? SUBMIT_ERRORS.ACTIVE_JOB
      : SUBMIT_ERRORS.STATE_ERROR;
    return { ok: false, code: jobResult.code, customerMessage: msg };
  }

  const { job, created } = jobResult;

  // 4. Existing job — return immediately; client polls M2 for result
  if (!created) {
    if (
      job.status === "PROCESSING" ||
      job.status === "SUBMITTED" ||
      job.status === "COMPLETED"
    ) {
      return { ok: true, jobId: job.id };
    }
    // Terminal failure (FAILED / CANCELED / TIMED_OUT) — client must use a new idempotency key
    return {
      ok: false,
      code: "JOB_FAILED",
      customerMessage: CUSTOMER_ERROR_MESSAGES.PROVIDER_FAILED,
      jobId: job.id,
    };
  }

  // 5. Advance new job to SUBMITTED before any external I/O (crash-safe ordering)
  const submitResult = await _advanceJob(job, "SUBMITTED", {});
  if (!submitResult.ok) {
    return { ok: false, code: "STATE_ERROR", customerMessage: SUBMIT_ERRORS.STATE_ERROR };
  }
  const submittedJob = submitResult.job;

  // 6. Download model photo as base64 data URL (private Cloudinary → memory only, never logged)
  const photoResult = await _downloadPhoto(
    params.bodyPublicId,
    params.bodyFormat,
    params.deliveryType,
  );
  if (!photoResult.ok) {
    await _advanceJob(submittedJob, "FAILED", { errorCode: photoResult.errorCode });
    return {
      ok: false,
      code: photoResult.errorCode,
      customerMessage: CUSTOMER_ERROR_MESSAGES.INVALID_MODEL_IMAGE,
      jobId: submittedJob.id,
    };
  }

  // 7. Submit to FASHN — POST only, returns predictionId immediately (no polling)
  const fashnResult = await _submitToProvider({
    customerId:        params.internalCustomerId,
    modelImageDataUrl: photoResult.dataUrl,
    productImageUrl:   garmentUrl,
    productHandle:     params.garmentHandle,
    consent: {
      virtualTryOnConsent: true,
      policyVersion:       POLICY_VERSION,
      consentedAt:         params.virtualTryOnConsentAt.toISOString(),
    },
  });

  if (!fashnResult.ok) {
    await _advanceJob(submittedJob, "FAILED", { errorCode: fashnResult.code });
    return {
      ok: false,
      code: fashnResult.code,
      customerMessage: fashnResult.customerMessage,
      jobId: submittedJob.id,
    };
  }

  // 8. Advance to PROCESSING — persists predictionId for M2 polling
  const processingResult = await _advanceJob(submittedJob, "PROCESSING", {
    predictionId: fashnResult.predictionId,
  });
  if (!processingResult.ok) {
    // predictionId received but state transition failed — M2 can still resume
    // via the existing SUBMITTED job if the predictionId is separately recoverable.
    // Return an error; the client may retry with a new key.
    return {
      ok: false,
      code: "STATE_ERROR",
      customerMessage: SUBMIT_ERRORS.STATE_ERROR,
      jobId: submittedJob.id,
    };
  }

  return { ok: true, jobId: processingResult.job.id };
}

// ── executeTryOn ──────────────────────────────────────────────────────────────

const SERVICE_ERRORS = {
  NOT_READY:      "This garment is not available for virtual try-on yet.",
  COOLDOWN:       "Please wait a moment before starting another virtual try-on.",
  ACTIVE_JOB:     "Your preview is still generating. Please wait for it to finish before starting another try-on.",
  NOT_CONFIGURED: "Virtual try-on is temporarily unavailable.",
  STATE_ERROR:    "Virtual try-on is temporarily unavailable.",
} as const;

export interface ExecuteTryOnParams {
  internalCustomerId: string;
  naiaModelId: string;
  bodyPublicId: string;
  bodyFormat: string | null;
  deliveryType: string;
  garmentHandle: string;
  virtualTryOnConsentAt: Date;
  saveTryOnResultConsentAt?: Date | null;
  idempotencyKey: string;
  // Gate: PENDING/null/undefined means body photo has not passed Layer 2+3 moderation.
  // executeTryOn rejects unless this is "APPROVED".
  bodyModerationStatus?: string | null;
}

export type ExecuteTryOnResult =
  | { ok: true; jobId: string; resultUrl: string; isNewJob: boolean }
  | { ok: false; code: string; customerMessage: string; jobId?: string };

// Injectable types for testing — each replaces one I/O operation in executeTryOn.
export type AdvanceJobFn = (
  job: VirtualTryOnJobRecord,
  status: TryOnJobStatus,
  extras?: { predictionId?: string; errorCode?: string },
) => Promise<{ ok: true; job: VirtualTryOnJobRecord } | { ok: false; error: string }>;

export type CreateOrFindJobFn = (
  params: CreateJobParams,
) => Promise<
  | { ok: true; job: VirtualTryOnJobRecord; created: boolean }
  | { ok: false; error: string; code: string }
>;

export type CheckCooldownFn = (
  customerId: string,
) => Promise<{ ok: true } | { ok: false; reason: "ACTIVE_JOB" | "COOLDOWN"; retryAfterMs?: number }>;

export type TryOnAdapterFn = (input: VirtualTryOnInput) => Promise<VirtualTryOnResult>;

export type DownloadPhotoFn = (
  bodyPublicId: string,
  bodyFormat: string | null,
  deliveryType: string,
) => Promise<{ ok: true; dataUrl: string } | { ok: false; errorCode: string }>;

export type UploadResultFn = (
  customerId: string,
  jobId: string,
  outputDataUrl: string,
) => Promise<{ ok: true } | { ok: false; errorCode: string }>;

export type BuildResultUrlFn = (customerId: string, jobId: string) => string | null;

export interface ExecuteTryOnDeps {
  _downloadPhoto?: DownloadPhotoFn;
  _uploadResult?: UploadResultFn;
  _fashnTryOn?: TryOnAdapterFn;
  _createOrFindJob?: CreateOrFindJobFn;
  _advanceJob?: AdvanceJobFn;
  _checkCooldown?: CheckCooldownFn;
  _buildResultUrl?: BuildResultUrlFn;
}

export async function executeTryOn(
  params: ExecuteTryOnParams,
  deps: ExecuteTryOnDeps = {},
): Promise<ExecuteTryOnResult> {
  const {
    _downloadPhoto = (pid, fmt, dt) => downloadModelPhotoAsDataUrl(pid, fmt, dt),
    _uploadResult  = (cid, jid, data) => uploadTryOnResult(cid, jid, data),
    _fashnTryOn    = (input) => runFashnTryOn(input),
    _createOrFindJob = createOrFindTryOnJob,
    _advanceJob    = (job, status, extras) => advanceTryOnJob(job, status, extras),
    _checkCooldown = checkCustomerCooldown,
    _buildResultUrl = (cid, jid) => buildTryOnResultUrl(cid, jid),
  } = deps;

  // 0. Body photo moderation gate — fail-closed: APPROVED is the only value that passes.
  // undefined, null, PENDING, REJECTED, and any unknown status all block here.
  if (params.bodyModerationStatus !== "APPROVED") {
    return {
      ok: false,
      code: "NOT_READY",
      customerMessage: "Your model photo is pending review. Please try again in a moment.",
    };
  }

  // 1. Validate garment eligibility — fail-closed on non-ready
  const garment = validateGarmentEligibility(params.garmentHandle);
  if (!garment.ok) {
    return { ok: false, code: "NOT_READY", customerMessage: SERVICE_ERRORS.NOT_READY };
  }

  // 2. Check per-customer cooldown
  const cooldown = await _checkCooldown(params.internalCustomerId);
  if (!cooldown.ok) {
    if (cooldown.reason === "ACTIVE_JOB") {
      return { ok: false, code: "ACTIVE_JOB", customerMessage: SERVICE_ERRORS.ACTIVE_JOB };
    }
    return { ok: false, code: "COOLDOWN", customerMessage: SERVICE_ERRORS.COOLDOWN };
  }

  // 3. Create or find VirtualTryOnJob (Serializable transaction)
  const jobResult = await _createOrFindJob({
    customerId: params.internalCustomerId,
    naiaModelId: params.naiaModelId,
    productHandle: params.garmentHandle,
    bodyPublicId: params.bodyPublicId,
    virtualTryOnConsentAt: params.virtualTryOnConsentAt,
    saveTryOnResultConsentAt: params.saveTryOnResultConsentAt ?? null,
    idempotencyKey: params.idempotencyKey,
  });

  if (!jobResult.ok) {
    const msg = jobResult.code === "ACTIVE_JOB_EXISTS"
      ? SERVICE_ERRORS.ACTIVE_JOB
      : SERVICE_ERRORS.STATE_ERROR;
    return { ok: false, code: jobResult.code, customerMessage: msg };
  }

  const { job, created } = jobResult;

  // 4. Handle existing job (same idempotency key returned an existing record)
  if (!created) {
    if (job.status === "COMPLETED") {
      const resultUrl = _buildResultUrl(params.internalCustomerId, job.id);
      if (!resultUrl) {
        return { ok: false, code: "NOT_CONFIGURED", customerMessage: SERVICE_ERRORS.NOT_CONFIGURED, jobId: job.id };
      }
      return { ok: true, jobId: job.id, resultUrl, isNewJob: false };
    }
    if ((ACTIVE_STATUSES as readonly string[]).includes(job.status)) {
      return { ok: false, code: "ACTIVE_JOB", customerMessage: SERVICE_ERRORS.ACTIVE_JOB, jobId: job.id };
    }
    // Terminal failure with same idempotency key — caller should retry with a new key
    return { ok: false, code: "JOB_FAILED", customerMessage: CUSTOMER_ERROR_MESSAGES.PROVIDER_FAILED, jobId: job.id };
  }

  // 5. Advance new job to SUBMITTED before touching external systems
  const submitResult = await _advanceJob(job, "SUBMITTED", {});
  if (!submitResult.ok) {
    return { ok: false, code: "STATE_ERROR", customerMessage: SERVICE_ERRORS.STATE_ERROR, jobId: job.id };
  }
  const submittedJob = submitResult.job;

  // 6. Download model photo as base64 data URL (private Cloudinary → memory only, never logged)
  const photoResult = await _downloadPhoto(
    params.bodyPublicId,
    params.bodyFormat,
    params.deliveryType,
  );
  if (!photoResult.ok) {
    await _advanceJob(submittedJob, "FAILED", { errorCode: photoResult.errorCode });
    return {
      ok: false,
      code: photoResult.errorCode,
      customerMessage: CUSTOMER_ERROR_MESSAGES.INVALID_MODEL_IMAGE,
      jobId: submittedJob.id,
    };
  }

  // 7. Submit to FASHN provider (includes internal polling up to 90s)
  const fashnResult = await _fashnTryOn({
    customerId: params.internalCustomerId,
    modelImageDataUrl: photoResult.dataUrl,
    productImageUrl: garment.garmentUrl,
    productHandle: params.garmentHandle,
    consent: {
      virtualTryOnConsent: true,
      policyVersion: POLICY_VERSION,
      consentedAt: params.virtualTryOnConsentAt.toISOString(),
    },
  });

  if (!fashnResult.ok) {
    await _advanceJob(submittedJob, "FAILED", { errorCode: fashnResult.code });
    return {
      ok: false,
      code: fashnResult.code,
      customerMessage: fashnResult.customerMessage,
      jobId: submittedJob.id,
    };
  }

  // 8. Upload result to private Cloudinary storage (outputDataUrl must never be logged)
  const uploadResult = await _uploadResult(
    params.internalCustomerId,
    submittedJob.id,
    fashnResult.outputDataUrl,
  );
  if (!uploadResult.ok) {
    await _advanceJob(submittedJob, "FAILED", { errorCode: "PROVIDER_ERROR" });
    return {
      ok: false,
      code: "UPLOAD_FAILED",
      customerMessage: CUSTOMER_ERROR_MESSAGES.PROVIDER_FAILED,
      jobId: submittedJob.id,
    };
  }

  // 9. Advance to COMPLETED (SUBMITTED → COMPLETED is a valid transition)
  const completedResult = await _advanceJob(submittedJob, "COMPLETED", {
    predictionId: fashnResult.predictionId,
  });
  if (!completedResult.ok) {
    return {
      ok: false,
      code: "STATE_ERROR",
      customerMessage: SERVICE_ERRORS.STATE_ERROR,
      jobId: submittedJob.id,
    };
  }
  const completedJob = completedResult.job;

  // 10. Build short-lived result URL (never logged — contains signed credential)
  const resultUrl = _buildResultUrl(params.internalCustomerId, completedJob.id);
  if (!resultUrl) {
    return {
      ok: false,
      code: "NOT_CONFIGURED",
      customerMessage: SERVICE_ERRORS.NOT_CONFIGURED,
      jobId: completedJob.id,
    };
  }

  return { ok: true, jobId: completedJob.id, resultUrl, isNewJob: true };
}

// ── VTO result privacy deletion ───────────────────────────────────────────────
//
// Removes the persisted Cloudinary result images for all COMPLETED VTO jobs
// belonging to the authenticated customer. Job records and history are preserved.
//
// Public ID pattern (confirmed): naia-tryon/{customerId}/{jobId}
// Only COMPLETED jobs have uploaded result assets — other statuses never call
// uploadTryOnResult and have nothing stored in Cloudinary.
//
// Privacy contract:
//   - customerId is always the authenticated customer's ID (server-enforced).
//   - Only that customer's COMPLETED job rows are queried.
//   - "not found" from Cloudinary is treated as ok (idempotent).
//   - Job records, status, and history are not mutated.
//   - After deletion the result URL derived from the same jobId will 404 from
//     Cloudinary — no stored reference needs clearing because the publicId is derived.

export interface DeleteVtoResultsResult {
  deletedCount:  number;   // assets successfully removed from Cloudinary
  skippedCount:  number;   // assets Cloudinary could not delete (orphaned)
  failedAssets:  string[]; // publicIds that failed (for retry / audit)
}

export async function deleteCustomerVtoResults(
  customerId: string,
  _deleteAsset: DeleteAssetFn = deleteCloudinaryAsset,
): Promise<DeleteVtoResultsResult> {
  // Only COMPLETED jobs have uploaded Cloudinary result assets.
  const completedJobs = await prisma.virtualTryOnJob.findMany({
    where: { customerId, status: "COMPLETED" },
    select: { id: true },
  });

  let deletedCount  = 0;
  let skippedCount  = 0;
  const failedAssets: string[] = [];

  for (const job of completedJobs) {
    const publicId = deriveTryOnResultPublicId(customerId, job.id);
    const result   = await _deleteAsset(publicId, "private");
    if (result.ok) {
      deletedCount++;
    } else {
      skippedCount++;
      failedAssets.push(publicId);
    }
  }

  return { deletedCount, skippedCount, failedAssets };
}

// ── VTO result state check for loader ────────────────────────────────────────

export async function customerHasVtoResults(customerId: string): Promise<boolean> {
  const count = await prisma.virtualTryOnJob.count({
    where: { customerId, status: "COMPLETED" },
  });
  return count > 0;
}

// ── Single-preview deletion ───────────────────────────────────────────────────
//
// Deletes the Cloudinary result asset for exactly one job. Same contract as
// deleteCustomerVtoResults, scoped to one jobId: ownership-checked, job row
// and status untouched (so usage/history stays accurate), idempotent.

export type DeleteOneVtoResultResult =
  | { deleted: true }
  | { deleted: false; errorCode: "NOT_FOUND" };

export async function deleteOneVtoResult(
  jobId: string,
  customerId: string,
  _deleteAsset: DeleteAssetFn = deleteCloudinaryAsset,
): Promise<DeleteOneVtoResultResult> {
  // Ownership check: only this customer's own COMPLETED job matches.
  const job = await prisma.virtualTryOnJob.findFirst({
    where: { id: jobId, customerId, status: "COMPLETED" },
    select: { id: true },
  });
  if (!job) return { deleted: false, errorCode: "NOT_FOUND" };

  const publicId = deriveTryOnResultPublicId(customerId, job.id);
  await _deleteAsset(publicId, "private");
  // Job row is never mutated — the derived publicId simply 404s from
  // Cloudinary afterward; the customer-facing page treats that as the
  // "preview removed" state (onError fallback), not an error.
  return { deleted: true };
}

// ── Preview listing for the customer-facing gallery ───────────────────────────
//
// One entry per COMPLETED job — productHandle/createdAt come straight from
// the job row; previewUrl is a fresh signed URL built the same way the VTO
// experience itself renders a result (buildTryOnResultUrl). No new storage:
// everything here is already derivable from VirtualTryOnJob.

export interface CustomerVtoPreview {
  jobId: string;
  /** Always a human-readable name — never the raw productHandle (which for
   *  closet/buyskip-sourced jobs is an internal "source:recordId" string,
   *  not a display label). See resolveVtoPreviewLabel. */
  label: string;
  createdAt: Date;
  previewUrl: string | null;
}

// productHandle encodes its source as a prefix for closet/buyskip-originated
// try-ons (see api.trigger-tryon.tsx: `closet:${item.id}`, `buyskip:${analysis.id}`).
// A bare handle (no prefix) is a NADINE catalog handle. Resolving each into a
// real name — rather than displaying the raw "source:id" string — is what
// listCustomerVtoPreviews owes the customer-facing gallery; nothing here is
// ever shown to the customer as an internal identifier.
const CLOSET_SOURCE_PREFIX = "closet:";
const BUYSKIP_SOURCE_PREFIX = "buyskip:";
const FALLBACK_PREVIEW_LABEL = "Virtual Try-On";

async function resolveVtoPreviewLabels(
  customerId: string,
  productHandles: string[],
): Promise<Map<string, string>> {
  const closetIds: string[] = [];
  const buyskipIds: string[] = [];
  for (const handle of productHandles) {
    if (handle.startsWith(CLOSET_SOURCE_PREFIX)) closetIds.push(handle.slice(CLOSET_SOURCE_PREFIX.length));
    else if (handle.startsWith(BUYSKIP_SOURCE_PREFIX)) buyskipIds.push(handle.slice(BUYSKIP_SOURCE_PREFIX.length));
  }

  // `id: { in: [] }` is a safe no-op query — no ternary/branch-type gymnastics needed.
  const [closetItems, buyskipAnalyses]: [
    Array<{ id: string; name: string | null }>,
    Array<{ id: string; productName: string | null }>,
  ] = await Promise.all([
    prisma.closetItem.findMany({ where: { id: { in: closetIds }, customerId }, select: { id: true, name: true } }),
    prisma.buyOrSkipAnalysis.findMany({ where: { id: { in: buyskipIds }, customerId }, select: { id: true, productName: true } }),
  ]);
  const closetNameById = new Map<string, string | null>(closetItems.map((i): [string, string | null] => [i.id, i.name]));
  const buyskipNameById = new Map<string, string | null>(buyskipAnalyses.map((a): [string, string | null] => [a.id, a.productName]));

  const labels = new Map<string, string>();
  for (const handle of productHandles) {
    if (handle.startsWith(CLOSET_SOURCE_PREFIX)) {
      const name = closetNameById.get(handle.slice(CLOSET_SOURCE_PREFIX.length));
      labels.set(handle, name ?? FALLBACK_PREVIEW_LABEL);
    } else if (handle.startsWith(BUYSKIP_SOURCE_PREFIX)) {
      const name = buyskipNameById.get(handle.slice(BUYSKIP_SOURCE_PREFIX.length));
      labels.set(handle, name ?? FALLBACK_PREVIEW_LABEL);
    } else {
      // NADINE catalog handle — resolve the verified catalog title.
      const title = getProductByHandle(handle)?.parsed.identity.verifiedTitle;
      labels.set(handle, title ?? FALLBACK_PREVIEW_LABEL);
    }
  }
  return labels;
}

export async function listCustomerVtoPreviews(customerId: string): Promise<CustomerVtoPreview[]> {
  const jobs: Array<{ id: string; productHandle: string; createdAt: Date }> = await prisma.virtualTryOnJob.findMany({
    where: { customerId, status: "COMPLETED" },
    select: { id: true, productHandle: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  const labelByHandle = await resolveVtoPreviewLabels(customerId, jobs.map((j) => j.productHandle));
  return jobs.map((job) => ({
    jobId: job.id,
    label: labelByHandle.get(job.productHandle) ?? FALLBACK_PREVIEW_LABEL,
    createdAt: job.createdAt,
    previewUrl: buildTryOnResultUrl(customerId, job.id),
  }));
}
