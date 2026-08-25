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
  type CloudinaryConfig,
} from "../cloudinary-admin.server.js";
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
  COOLDOWN:       "Virtual try-on is temporarily unavailable. Please try again in a moment.",
  ACTIVE_JOB:     "Generation in progress. Try again shortly.",
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
  NOT_READY:    "This garment is not available for virtual try-on yet.",
  COOLDOWN:     "Virtual try-on is temporarily unavailable. Please try again in a moment.",
  ACTIVE_JOB:   "Generation in progress. Try again shortly.",
  NOT_CONFIGURED: "Virtual try-on is temporarily unavailable.",
  STATE_ERROR:  "Virtual try-on is temporarily unavailable.",
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
) => Promise<{ ok: boolean; retryAfterMs?: number }>;

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
