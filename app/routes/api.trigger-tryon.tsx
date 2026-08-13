// app/routes/api.trigger-tryon.tsx
// M1 — Customer-facing VTO trigger route.
//
// POST /api/trigger-tryon
//
// Authenticates the customer, validates model readiness, per-generation consent,
// and garment eligibility, then submits to FASHN via the hardened service layer.
// Returns { ok: true, jobId } immediately — M2 poll route advances the job to COMPLETED.
//
// Security contract:
//   - Customer identity is resolved from the authenticated session only.
//   - customerId is never accepted from the request body.
//   - The NaiaModel (body photo public ID) is loaded from the DB, never from the client.
//   - The garment URL is resolved server-side from productHandle; clients never supply URLs.
//   - Per-generation VTO consent is required in the request body.
//   - Consent timestamp must be within 15 minutes (prevents stale consent replay).
//   - Idempotency key is client-generated; server enforces per-customer ownership.
//   - No measurement, body shape, weight, or fit information is inferred or persisted.

import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { getCurrentNaiaCustomer } from "~/lib/naia-session.server";
import {
  loadNaiaModel,
  computeModelReadinessFromRecord,
} from "~/lib/ai/my-naia-model.server";
import { submitTryOnJob } from "~/lib/ai/fashn-tryon-service.server";
import prisma from "~/db.server";
import {
  getCloudinaryConfig,
  buildPrivateDownloadUrl,
  validatePublicIdOwnership,
} from "~/lib/cloudinary-admin.server";
import { screenGarmentSuitability } from "~/lib/image-suitability.server";

// ── Constants ─────────────────────────────────────────────────────────────────

// Per-generation consent must be within this window.
const MAX_CONSENT_AGE_MS = 15 * 60 * 1000; // 15 minutes

// Idempotency key: base64url characters, 10–80 chars.
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_-]{10,80}$/;

// ── Error helpers ─────────────────────────────────────────────────────────────

function authRequired() {
  return data({ ok: false, code: "auth_required", message: "Authentication required." }, { status: 401 });
}

function badRequest(code: string, message: string) {
  return data({ ok: false, code, message }, { status: 400 });
}

function conflict(code: string, message: string) {
  return data({ ok: false, code, message }, { status: 409 });
}

function tooMany(message: string) {
  return data({ ok: false, code: "cooldown", message }, { status: 429 });
}

function serverError(message: string) {
  return data({ ok: false, code: "provider_error", message }, { status: 500 });
}

// ── Loader (GET) — not supported ─────────────────────────────────────────────

export async function loader() {
  return data({ error: "method_not_allowed" }, { status: 405 });
}

// ── Action (POST) ─────────────────────────────────────────────────────────────

export async function action({ request }: ActionFunctionArgs) {
  // ── 1. Authentication — session-only, never from request body ────────────
  const customer = await getCurrentNaiaCustomer(request);
  if (!customer) return authRequired();

  // ── 2. Parse and validate request body ───────────────────────────────────
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("invalid_request", "Request body must be JSON.");
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return badRequest("invalid_request", "Request body must be a JSON object.");
  }

  const {
    source: sourceRaw,
    // NADINE source
    productHandle,
    // Closet source
    closetItemId,
    // Buy/Skip source
    analysisId,
    // Shared
    virtualTryOnConsentAt: consentAtRaw,
    idempotencyKey,
    saveTryOnResultConsent,
  } = body as Record<string, unknown>;

  // ── 2a. Source validation ─────────────────────────────────────────────────
  const source = typeof sourceRaw === "string" ? sourceRaw : "nadine";
  if (!["nadine", "closet", "buyskip"].includes(source)) {
    return badRequest("invalid_request", "Invalid source.");
  }
  // Arbitrary client-supplied garment URLs are never accepted.
  // All garment images are resolved server-side from ownership-verified DB records.

  // ── 2b. Shared field validation ───────────────────────────────────────────
  if (typeof consentAtRaw !== "string" || consentAtRaw.length === 0) {
    return badRequest("consent_required", "Per-generation virtual try-on consent is required.");
  }

  const consentAt = new Date(consentAtRaw);
  if (isNaN(consentAt.getTime())) {
    return badRequest("consent_required", "Invalid consent timestamp.");
  }

  const consentAgeMs = Date.now() - consentAt.getTime();
  if (consentAgeMs < 0 || consentAgeMs > MAX_CONSENT_AGE_MS) {
    return badRequest("consent_expired", "Virtual try-on consent has expired. Please try again.");
  }

  if (typeof idempotencyKey !== "string" || !IDEMPOTENCY_KEY_RE.test(idempotencyKey)) {
    return badRequest("invalid_request", "idempotencyKey must be 10–80 base64url characters.");
  }

  const saveTryOnResultConsentAt = saveTryOnResultConsent === true ? new Date() : null;

  // ── 3. Load NaiaModel from DB — customer identity is authoritative ────────
  const naiaModel = await loadNaiaModel(customer.id);
  if (!naiaModel) {
    return badRequest("model_not_configured", "Set up your My nAia Model to use virtual try-on.");
  }

  // ── 4. Model readiness — body photo + save-model consent required ─────────
  const readiness = computeModelReadinessFromRecord(naiaModel);
  if (!readiness.hasFullBodyPhoto) {
    return badRequest("model_not_ready", "Add a full-body photo to your My nAia Model to use virtual try-on.");
  }
  if (!readiness.isReadyForTryOn) {
    return badRequest("model_not_ready", "Confirm My nAia Model consent to use virtual try-on.");
  }

  const bodyPublicId = naiaModel.bodyPublicId as string;

  // ── 5. Source-specific garment resolution (server-side only) ──────────────
  //
  // Each path: authenticate ownership, verify eligibility, build signed URL.
  // The client NEVER supplies garment image URLs — all resolution is internal.
  let garmentHandle: string;
  let resolvedGarmentUrl: string | undefined;

  if (source === "nadine") {
    // NADINE catalog garment — handle validated + URL resolved in service layer
    if (typeof productHandle !== "string" || productHandle.trim().length === 0) {
      return badRequest("invalid_request", "productHandle is required for NADINE source.");
    }
    garmentHandle = productHandle.trim();
    // resolvedGarmentUrl stays undefined → service layer applies catalog eligibility

  } else if (source === "closet") {
    // Closet garment — ownership enforced here; suitability assessed at VTO time.
    // Stage B was removed from Closet upload; garment suitability is checked here instead.
    if (typeof closetItemId !== "string" || closetItemId.trim().length === 0) {
      return badRequest("invalid_request", "closetItemId is required for closet source.");
    }
    const item = await prisma.closetItem.findUnique({
      where: { id: closetItemId.trim() },
      select: { id: true, customerId: true, category: true, imagePublicId: true, imageFormat: true },
    });
    if (!item || item.customerId !== customer.id) {
      return badRequest("not_found", "Closet item not found.");
    }
    if (!item.imagePublicId || !item.imageFormat) {
      return badRequest("not_eligible", "No image available for this item.");
    }
    const cfg = getCloudinaryConfig();
    if (!cfg) return serverError("Virtual try-on is temporarily unavailable.");
    // Build signed URL; use it for both suitability check and FASHN submission.
    const closetSignedUrl = buildPrivateDownloadUrl(cfg, item.imagePublicId, item.imageFormat, "private");
    // Run garment suitability at VTO time — replaces Stage B which was removed from upload.
    const garmentCheck = await screenGarmentSuitability(closetSignedUrl, { declaredCategory: item.category ?? undefined });
    if (garmentCheck.status !== "PASS") {
      return badRequest("not_eligible", "This item isn't suitable for a virtual try-on. Try a clearer photo of the garment on its own.");
    }
    resolvedGarmentUrl = closetSignedUrl;
    garmentHandle = `closet:${item.id}`;

  } else {
    // Buy/Skip garment — ownership + S0 pipeline + completed analysis enforced here
    if (typeof analysisId !== "string" || analysisId.trim().length === 0) {
      return badRequest("invalid_request", "analysisId is required for buyskip source.");
    }
    const analysis = await prisma.buyOrSkipAnalysis.findUnique({
      where: { id: analysisId.trim() },
      select: { id: true, customerId: true, imagePublicId: true, imageFormat: true, verdict: true, fullAnalysis: true },
    });
    if (!analysis || analysis.customerId !== customer.id) {
      return badRequest("not_found", "Analysis not found.");
    }
    // S0 gate: imagePublicId proves image passed safety + garment suitability pipeline
    if (!analysis.imagePublicId || !analysis.imageFormat) {
      return badRequest("not_eligible", "This item is not available for virtual try-on.");
    }
    // Analysis completion gate: verdict + fullAnalysis must both be present.
    // imagePublicId alone is not sufficient — the AI analysis must have completed successfully.
    if (!analysis.verdict || !analysis.fullAnalysis) {
      return badRequest("not_eligible", "This analysis is not complete enough for virtual try-on.");
    }
    const cfg = getCloudinaryConfig();
    if (!cfg) return serverError("Virtual try-on is temporarily unavailable.");
    // Re-verify publicId path integrity before generating signed URL
    const pubIdCheck = validatePublicIdOwnership(analysis.imagePublicId, customer.id);
    if (!pubIdCheck.ok) {
      return badRequest("not_found", "Analysis not found.");
    }
    resolvedGarmentUrl = buildPrivateDownloadUrl(cfg, analysis.imagePublicId, analysis.imageFormat, "private");
    garmentHandle = `buyskip:${analysis.id}`;
  }

  // ── 6. Call hardened service layer ────────────────────────────────────────
  const result = await submitTryOnJob({
    internalCustomerId:      customer.id,
    naiaModelId:             naiaModel.id,
    bodyPublicId,
    bodyFormat:              naiaModel.bodyFormat,
    deliveryType:            naiaModel.deliveryType,
    bodyModerationStatus:    naiaModel.bodyModerationStatus,
    garmentHandle,
    resolvedGarmentUrl,
    garmentSource:           source as "nadine" | "closet" | "buyskip",
    virtualTryOnConsentAt:   consentAt,
    saveTryOnResultConsentAt,
    idempotencyKey,
  });

  // ── 7. Map service result to HTTP response ────────────────────────────────
  if (!result.ok) {
    switch (result.code) {
      case "NOT_READY":
      case "UNKNOWN_HANDLE":
      case "MISSING_URL":
        return badRequest("product_not_eligible", result.customerMessage);

      case "COOLDOWN":
      case "RATE_LIMITED":
        return tooMany(result.customerMessage);

      case "ACTIVE_JOB_EXISTS":
      case "ACTIVE_JOB":
        return conflict("active_job", result.customerMessage);

      case "INVALID_MODEL_IMAGE":
        return badRequest("model_not_ready", result.customerMessage);

      case "CONSENT_REQUIRED":
        return badRequest("consent_required", result.customerMessage);

      case "JOB_FAILED":
        return badRequest("job_failed", result.customerMessage);

      default:
        return serverError(result.customerMessage);
    }
  }

  return data({ ok: true, jobId: result.jobId }, { status: 202 });
}
