// app/lib/ai/virtual-try-on.types.ts
// Typed contracts for My nAia Model and virtual try-on integration.
// Provider: FASHN Try-On Max via server-side HTTP only.

// ── Consent ───────────────────────────────────────────────────────────────────

export interface VirtualTryOnConsent {
  virtualTryOnConsent: true;
  policyVersion: string;
  consentedAt: string; // ISO 8601
}

// Four separate consent categories. No consent is pre-checked.
export interface NaiaModelConsentState {
  photoAnalysisConsent: boolean;   // use photo for nAia visual/profile analysis
  saveModelConsent: boolean;       // store photos as My nAia Model
  virtualTryOnConsent: boolean;    // send full-body photo to external provider
  saveTryOnResultConsent: boolean; // save a generated result in nAia
}

export const DEFAULT_CONSENT_STATE: NaiaModelConsentState = {
  photoAnalysisConsent: false,
  saveModelConsent: false,
  virtualTryOnConsent: false,
  saveTryOnResultConsent: false,
};

// ── Virtual try-on input/output ───────────────────────────────────────────────

export interface VirtualTryOnInput {
  customerId: string;               // authenticated server-derived customer ID
  modelImageDataUrl: string;        // base64 data URL from customer full-body photo
  productImageUrl: string;          // verified server-resolved catalog/Shopify URL
  productHandle: string;            // V8 catalog handle
  consent: VirtualTryOnConsent;
}

export type VirtualTryOnResultOk = {
  ok: true;
  provider: "fashn";
  predictionId: string;             // preserved for support diagnostics
  outputDataUrl: string;            // base64 PNG data URL — ephemeral, not persisted by default
  outputFormat: "png";
};

export type VirtualTryOnResultErr = {
  ok: false;
  code: VirtualTryOnErrorCode;
  customerMessage: string;
};

export type VirtualTryOnResult = VirtualTryOnResultOk | VirtualTryOnResultErr;

export type VirtualTryOnErrorCode =
  | "NOT_CONFIGURED"
  | "INVALID_MODEL_IMAGE"
  | "INVALID_PRODUCT_IMAGE"
  | "CONSENT_REQUIRED"
  | "PROVIDER_REJECTED"
  | "PROVIDER_FAILED"
  | "TIMEOUT"
  | "RATE_LIMITED";

// Calm customer-facing messages. Provider names and stack traces are never shown.
export const CUSTOMER_ERROR_MESSAGES: Record<VirtualTryOnErrorCode, string> = {
  NOT_CONFIGURED:
    "Virtual try-on is temporarily unavailable.",
  INVALID_MODEL_IMAGE:
    "We couldn't create this preview from these images. Try a clearer full-body photo.",
  INVALID_PRODUCT_IMAGE:
    "Virtual try-on is not ready for this piece yet.",
  CONSENT_REQUIRED:
    "Confirm virtual try-on permission to continue.",
  PROVIDER_REJECTED:
    "We couldn't create this preview from these images. Try a clearer full-body photo.",
  PROVIDER_FAILED:
    "Virtual try-on is temporarily unavailable. Your styling result is still saved.",
  TIMEOUT:
    "This preview is taking longer than expected. Please try again in a moment.",
  RATE_LIMITED:
    "Virtual try-on is temporarily unavailable. Please try again in a moment.",
};

export const POLICY_VERSION = "1.0";

// Provider disclaimer — shown before and after generation.
export const PROVIDER_DISCLAIMER =
  "A visual preview generated from your photo. Fit, scale and fabric behaviour may differ in person.";

// ── NaiaModel DB record shape (mirrors Prisma NaiaModel) ─────────────────────

export interface NaiaModelRecord {
  id: string;
  customerId: string;
  facePublicId: string | null;
  faceVersion: string | null;
  faceFormat: string | null;  // Cloudinary file format (e.g. "jpg", "png") — needed for private_download URL
  bodyPublicId: string | null;
  bodyVersion: string | null;
  bodyFormat: string | null;  // Cloudinary file format for body photo
  // Delivery type used at upload time — needed for deletion signature and URL generation.
  // Always "private" for new uploads.
  deliveryType: string;
  photoAnalysisConsentAt: Date | null;
  saveModelConsentAt: Date | null;
  consentPolicyVersion: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ── VirtualTryOnJob DB record shape (mirrors Prisma VirtualTryOnJob) ──────────

export type TryOnJobStatus =
  | "CREATED"
  | "SUBMITTED"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELED"
  | "TIMED_OUT";

export const TERMINAL_STATUSES: readonly TryOnJobStatus[] = [
  "COMPLETED",
  "FAILED",
  "CANCELED",
  "TIMED_OUT",
] as const;

export const ACTIVE_STATUSES: readonly TryOnJobStatus[] = [
  "CREATED",
  "SUBMITTED",
  "PROCESSING",
] as const;

export const ALLOWED_TRANSITIONS: Record<TryOnJobStatus, readonly TryOnJobStatus[]> = {
  CREATED:    ["SUBMITTED", "FAILED", "CANCELED"],
  SUBMITTED:  ["PROCESSING", "COMPLETED", "FAILED", "CANCELED"],
  PROCESSING: ["COMPLETED", "FAILED", "CANCELED", "TIMED_OUT"],
  COMPLETED:  [],
  FAILED:     [],
  CANCELED:   [],
  TIMED_OUT:  [],
};

export interface VirtualTryOnJobRecord {
  id: string;
  customerId: string;
  naiaModelId: string | null;
  productHandle: string;
  provider: "FASHN";
  predictionId: string | null;
  status: TryOnJobStatus;
  virtualTryOnConsentAt: Date;
  consentPolicyVersion: string;
  saveTryOnResultConsentAt: Date | null;
  idempotencyKey: string;
  requestFingerprint: string | null;
  errorCode: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  lastActivityAt: Date;
}

// ── My nAia Model readiness ───────────────────────────────────────────────────

export interface NaiaModelReadiness {
  hasFacePhoto: boolean;
  hasFullBodyPhoto: boolean;
  isReadyForTryOn: boolean; // true only when hasFullBodyPhoto && virtualTryOnConsent
}

//   naiaModelPolicyVersion  String?     // policy version when consent was given
