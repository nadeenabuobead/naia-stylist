// app/lib/ai/fashn-try-on.server.ts
// FASHN Try-On Max adapter.
// Only the full-body photo reaches FASHN. Face photos never do.
// All DI points (fetch, sleep, getApiKey) are overridable for testing.
// FASHN_API_KEY is server-side only — never returned to the client.
//
// Logging rules: base64 image data, auth headers, response images, and the
// provider's own free-text `error` field are never logged (that field is
// provider-controlled and not something we can guarantee is PII-free). Only
// our own classified error code, the request stage, an HTTP status when
// available, the predictionId (opaque, not PII), and a one-way SHA-256 hash
// of customerId may be logged — see logFashnFailure() below.

import type {
  VirtualTryOnInput,
  VirtualTryOnResult,
  VirtualTryOnErrorCode,
  VirtualTryOnConsent,
} from "./virtual-try-on.types.js";
import { CUSTOMER_ERROR_MESSAGES } from "./virtual-try-on.types.js";
import { hashCustomerId } from "./journey-events.server.js";
import { captureFailure } from "../error-tracking.server.js";

// ── Constants ─────────────────────────────────────────────────────────────────

// Load-test / local-dev escape hatch: lets a disposable mock FASHN server
// stand in for the real provider so a synthetic load test never makes a
// real paid call. Both ALLOW_PROVIDER_MOCKS="true" AND FASHN_MOCK_BASE_URL
// must be set for the override to take effect — setting only one (e.g. a
// stray FASHN_MOCK_BASE_URL left in an environment) has no effect, same
// fail-safe shape as ENTITLEMENT_ENFORCEMENT elsewhere in this codebase.
// Neither variable is set anywhere in this repo's own config, so behavior
// is unchanged by default on every existing deployment.
const BASE_URL =
  process.env.ALLOW_PROVIDER_MOCKS === "true" && process.env.FASHN_MOCK_BASE_URL
    ? process.env.FASHN_MOCK_BASE_URL
    : "https://api.fashn.ai";
const POLL_INTERVAL_MS = 2_000;
const MAX_POLL_ATTEMPTS = 45; // 90s ceiling at 2s interval

// Per-HTTP-call timeout. This bounds a single fetch to FASHN, not the whole
// 90s poll loop — a submit or status call that's still pending past this
// many ms indicates a hung connection, not a slow-but-working generation
// (generation progress is reported via repeated "processing" polls, each a
// fast request/response). Existing retry/error-handling shape is
// unchanged: a timeout simply reaches the same catch block that a network
// failure already did, so it surfaces as the existing PROVIDER_FAILED path.
const FASHN_REQUEST_TIMEOUT_MS = 15_000;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Logs only a classified failure — never the provider's raw `error` text,
// never image data, never auth headers. customerId is one-way hashed.
function logFashnFailure(
  stage: "submit" | "poll",
  code: VirtualTryOnErrorCode,
  customerId: string,
  extra?: { predictionId?: string; httpStatus?: number; providerStatus?: string; fashnErrorName?: string },
): void {
  captureFailure(`fashn:${stage}`, code, {
    customerIdHash: hashCustomerId(customerId),
    ...(extra?.predictionId ? { predictionId: extra.predictionId } : {}),
    ...(extra?.httpStatus !== undefined ? { httpStatus: extra.httpStatus } : {}),
    ...(extra?.providerStatus ? { providerStatus: extra.providerStatus } : {}),
    // Safe to log as-is: fashnErrorName is only ever one of the three fixed,
    // documented 429 names (see FASHN_429_ERROR_NAMES) — never the
    // provider's raw free-text error field, which this module never logs.
    ...(extra?.fashnErrorName ? { fashnErrorName: extra.fashnErrorName } : {}),
  });
}

// ── URL safety ────────────────────────────────────────────────────────────────

const PRIVATE_PREFIXES = [
  "10.",
  "192.168.",
  "172.16.",
  "172.17.",
  "172.18.",
  "172.19.",
  "172.20.",
  "172.21.",
  "172.22.",
  "172.23.",
  "172.24.",
  "172.25.",
  "172.26.",
  "172.27.",
  "172.28.",
  "172.29.",
  "172.30.",
  "172.31.",
];

export function isAllowedProductImageUrl(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") return false;
  for (const prefix of PRIVATE_PREFIXES) {
    if (host.startsWith(prefix)) return false;
  }
  return true;
}

// ── Data URL validation ───────────────────────────────────────────────────────

export function isValidModelImageDataUrl(raw: string): boolean {
  return /^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(raw);
}

// ── Consent guard ─────────────────────────────────────────────────────────────

export function hasVirtualTryOnConsent(consent: VirtualTryOnConsent): boolean {
  return (
    consent.virtualTryOnConsent === true &&
    typeof consent.policyVersion === "string" &&
    consent.policyVersion.length > 0 &&
    typeof consent.consentedAt === "string" &&
    consent.consentedAt.length > 0
  );
}

// ── DI types ──────────────────────────────────────────────────────────────────

export type FetchFn = typeof fetch;
export type SleepFn = (ms: number) => Promise<void>;
export type GetApiKeyFn = () => string | undefined;

// ── FASHN provider response shapes ───────────────────────────────────────────
// Minimal types — only the fields we act on.

interface FashnRunResponse {
  id: string;
  error?: string;
}

// FASHN's documented 429 sub-types (docs.fashn.ai/api-overview/error-handling)
// — the response body's `error` field is exactly one of these three strings
// for a rate-limit-class rejection. Only RateLimitExceeded and
// ConcurrencyLimitExceeded are transient; OutOfCredits means the account has
// no credits left and will return the identical rejection no matter how many
// times or how long we wait — retrying it is never appropriate.
type Fashn429ErrorName = "RateLimitExceeded" | "ConcurrencyLimitExceeded" | "OutOfCredits";
const FASHN_429_ERROR_NAMES: ReadonlySet<string> = new Set<Fashn429ErrorName>([
  "RateLimitExceeded",
  "ConcurrencyLimitExceeded",
  "OutOfCredits",
]);

type FashnStatus = "starting" | "in_queue" | "processing" | "completed" | "failed" | "canceled";

interface FashnStatusResponse {
  status: FashnStatus;
  output?: string[]; // base64 data URLs when return_base64=true
  error?: string;
}

// ── Adapter ───────────────────────────────────────────────────────────────────

export interface RunTryOnOptions {
  _fetch?: FetchFn;
  _sleep?: SleepFn;
  _getApiKey?: GetApiKeyFn;
  // When set, skip POST /v1/run and resume polling this prediction ID.
  // Does not consume a new call slot. Consent and input validation are bypassed.
  existingPredictionId?: string;
  // Called immediately after POST /v1/run returns an ID, before polling starts.
  // Use this to persist the ID for crash-safe resume on timeout.
  onPredictionId?: (id: string) => void;
}

export async function runFashnTryOn(
  input: VirtualTryOnInput,
  {
    _fetch = fetch,
    _sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    _getApiKey = () => process.env.FASHN_API_KEY,
    existingPredictionId,
    onPredictionId,
  }: RunTryOnOptions = {},
): Promise<VirtualTryOnResult> {
  // API key is required for both submission and polling.
  const apiKey = _getApiKey();
  if (!apiKey) {
    return err("NOT_CONFIGURED");
  }

  let predictionId: string;

  if (existingPredictionId) {
    // ── Resume polling path — skip consent, validation, rate-limit, submit ─────
    predictionId = existingPredictionId;
  } else {
    // ── New submission path ──────────────────────────────────────────────────

    // ── 1. Consent ────────────────────────────────────────────────────────────
    if (!hasVirtualTryOnConsent(input.consent)) {
      return err("CONSENT_REQUIRED");
    }

    // ── 2. Input validation ───────────────────────────────────────────────────
    if (!isValidModelImageDataUrl(input.modelImageDataUrl)) {
      return err("INVALID_MODEL_IMAGE");
    }
    if (!isAllowedProductImageUrl(input.productImageUrl)) {
      return err("INVALID_PRODUCT_IMAGE");
    }

    // ── 3. Submit to FASHN ────────────────────────────────────────────────────
    try {
      const runRes = await _fetch(`${BASE_URL}/v1/run`, {
        method: "POST",
        headers: {
          // Header value intentionally omitted from all logging
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model_name: "tryon-max",
          inputs: {
            model_image: input.modelImageDataUrl,
            product_image: input.productImageUrl,
            return_base64: true,
            output_format: "png",
            resolution: "1k",
            generation_mode: "fast",
            num_images: 1,
          },
        }),
        signal: AbortSignal.timeout(FASHN_REQUEST_TIMEOUT_MS),
      });

      if (!runRes.ok) {
        logFashnFailure("submit", "PROVIDER_REJECTED", input.customerId, { httpStatus: runRes.status });
        return err("PROVIDER_REJECTED");
      }

      const runBody = (await runRes.json()) as FashnRunResponse;
      if (runBody.error || !runBody.id) {
        logFashnFailure("submit", "PROVIDER_REJECTED", input.customerId);
        return err("PROVIDER_REJECTED");
      }
      predictionId = runBody.id;
      // Persist the ID before polling so a timeout doesn't lose it.
      onPredictionId?.(predictionId);
    } catch {
      logFashnFailure("submit", "PROVIDER_FAILED", input.customerId);
      return err("PROVIDER_FAILED");
    }
  }

  // ── 5. Poll for completion ───────────────────────────────────────────────────
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await _sleep(POLL_INTERVAL_MS);

    let statusBody: FashnStatusResponse;
    try {
      const statusRes = await _fetch(`${BASE_URL}/v1/status/${predictionId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(FASHN_REQUEST_TIMEOUT_MS),
      });
      if (!statusRes.ok) {
        logFashnFailure("poll", "PROVIDER_FAILED", input.customerId, { predictionId, httpStatus: statusRes.status });
        return err("PROVIDER_FAILED");
      }
      statusBody = (await statusRes.json()) as FashnStatusResponse;
    } catch {
      logFashnFailure("poll", "PROVIDER_FAILED", input.customerId, { predictionId });
      return err("PROVIDER_FAILED");
    }

    const status = statusBody.status;

    if (status === "completed") {
      const outputs = statusBody.output;
      if (!Array.isArray(outputs) || outputs.length === 0 || typeof outputs[0] !== "string") {
        logFashnFailure("poll", "PROVIDER_FAILED", input.customerId, { predictionId, providerStatus: status });
        return err("PROVIDER_FAILED");
      }
      return {
        ok: true,
        provider: "fashn",
        predictionId,
        outputDataUrl: outputs[0],
        outputFormat: "png",
      };
    }

    if (status === "failed" || status === "canceled") {
      logFashnFailure("poll", "PROVIDER_FAILED", input.customerId, { predictionId, providerStatus: status });
      return err("PROVIDER_FAILED");
    }

    // starting | in_queue | processing — continue polling
  }

  logFashnFailure("poll", "TIMEOUT", input.customerId, { predictionId });
  return err("TIMEOUT");
}

// ── Submit-only adapter (no poll) ────────────────────────────────────────────
//
// Validates consent and input, posts to FASHN /v1/run, returns predictionId.
// Does NOT poll for completion — the caller persists predictionId and an M2
// route polls /v1/status/{id} later.
//
// Use this inside a customer-facing trigger route where the full runFashnTryOn
// poll loop (up to 90s) would exceed Vercel's 60s function timeout.

export interface SubmitToProviderOptions {
  _fetch?: FetchFn;
  _getApiKey?: GetApiKeyFn;
  _sleep?: (ms: number) => Promise<void>;
}

export type SubmitToProviderResult =
  | { ok: true; predictionId: string }
  | { ok: false; code: VirtualTryOnErrorCode; customerMessage: string };

// 2026-11-16 live incident — the first controlled Full-Look VTO test failed
// on garment 2's submission with a bare HTTP 429 from FASHN, ~100ms after
// garment 1's own status check reported COMPLETED (advanceFullLookChain
// submits the next step immediately upon observing the current one finish —
// see full-look-tryon-real.server.ts). The request was rejected before
// FASHN ever created a prediction (confirmed: predictionId stayed null on
// the FAILED row) — nothing was billed, but the whole chain stopped for a
// single transient rate-limit response.
//
// A bounded retry closes this — but the original fix (retry on bare HTTP
// 429/5xx) was too coarse: FASHN's own docs (docs.fashn.ai/api-overview/
// error-handling) distinguish THREE distinct 429 sub-types in the response
// body's `error` field, and only two of them are actually worth retrying.
// classifyFashnSubmitRejection below reads that field when present;
// OutOfCredits is excluded from retry entirely (waiting does not help —
// the account has no credits until it's topped up), and an unrecognized or
// absent error field falls back to the bare HTTP status (429/5xx), the
// same posture downloadIntermediateStepResult already uses for transient
// Cloudinary failures (isTransientCloudinaryDownloadErrorCode). Deliberately
// NOT applied to any other !runRes.ok status (400/401/413/...) — those are
// the provider rejecting the actual request content, not a capacity signal.
//
// Retry-After: not documented by FASHN today, but read and honored if ever
// present (standard HTTP practice for 429/503) — capped so a large or
// malformed value can never stall a serverless invocation anywhere close
// to its own timeout.
const FASHN_SUBMIT_MAX_ATTEMPTS = 2;
const FASHN_SUBMIT_DEFAULT_RETRY_DELAY_MS = 500;
const FASHN_SUBMIT_MAX_RETRY_DELAY_MS = 5_000;

type FashnSubmitRetryDecision = { retry: true; delayMs: number } | { retry: false; errorName?: Fashn429ErrorName };

function parseRetryAfterMs(headerValue: string | null): number | null {
  if (!headerValue) return null;
  // Retry-After is either an integer number of seconds, or an HTTP-date —
  // only the (overwhelmingly common) seconds form is worth supporting here.
  const seconds = Number(headerValue);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.min(seconds * 1000, FASHN_SUBMIT_MAX_RETRY_DELAY_MS);
}

function classifyFashnSubmitRejection(res: Response, errorField: string | undefined): FashnSubmitRetryDecision {
  const errorName = errorField && FASHN_429_ERROR_NAMES.has(errorField) ? (errorField as Fashn429ErrorName) : undefined;

  if (errorName === "OutOfCredits") {
    // Never retry — explicitly excluded regardless of status code or
    // Retry-After. Waiting cannot fix an empty credit balance.
    return { retry: false, errorName };
  }
  if (errorName === "RateLimitExceeded" || errorName === "ConcurrencyLimitExceeded") {
    const retryAfterMs = parseRetryAfterMs(res.headers.get("Retry-After"));
    return { retry: true, delayMs: retryAfterMs ?? FASHN_SUBMIT_DEFAULT_RETRY_DELAY_MS };
  }
  // No recognized error field — fall back to the bare HTTP status. A
  // genuine permanent rejection (400/401/413/...) never reaches here as
  // "transient"; only 429 (unclassified) or 5xx do.
  if (res.status === 429 || res.status >= 500) {
    const retryAfterMs = parseRetryAfterMs(res.headers.get("Retry-After"));
    return { retry: true, delayMs: retryAfterMs ?? FASHN_SUBMIT_DEFAULT_RETRY_DELAY_MS };
  }
  return { retry: false };
}

export async function submitTryOnToProvider(
  input: VirtualTryOnInput,
  { _fetch = fetch, _getApiKey = () => process.env.FASHN_API_KEY, _sleep = defaultSleep }: SubmitToProviderOptions = {},
): Promise<SubmitToProviderResult> {
  const apiKey = _getApiKey();
  if (!apiKey) return submitErr("NOT_CONFIGURED");

  if (!hasVirtualTryOnConsent(input.consent)) return submitErr("CONSENT_REQUIRED");
  if (!isValidModelImageDataUrl(input.modelImageDataUrl)) return submitErr("INVALID_MODEL_IMAGE");
  if (!isAllowedProductImageUrl(input.productImageUrl)) return submitErr("INVALID_PRODUCT_IMAGE");

  for (let attempt = 1; attempt <= FASHN_SUBMIT_MAX_ATTEMPTS; attempt++) {
    try {
      const runRes = await _fetch(`${BASE_URL}/v1/run`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model_name: "tryon-max",
          inputs: {
            model_image: input.modelImageDataUrl,
            product_image: input.productImageUrl,
            return_base64: true,
            output_format: "png",
            resolution: "1k",
            generation_mode: input.generationMode ?? "fast",
            num_images: 1,
            // prompt omitted entirely (not sent as an empty string) when unset —
            // every existing caller gets the exact previous request body.
            ...(input.prompt ? { prompt: input.prompt } : {}),
          },
        }),
        signal: AbortSignal.timeout(FASHN_REQUEST_TIMEOUT_MS),
      });

      if (!runRes.ok) {
        // Read the body (tolerating a non-JSON or empty one) so a 429 can be
        // classified by FASHN's own documented error name rather than
        // guessed at from the HTTP status alone.
        let errorField: string | undefined;
        try {
          const errorBody = (await runRes.json()) as { error?: string };
          errorField = errorBody?.error;
        } catch {
          // No parseable body — classification falls back to bare status.
        }
        const decision = classifyFashnSubmitRejection(runRes, errorField);
        if (decision.retry && attempt < FASHN_SUBMIT_MAX_ATTEMPTS) {
          await _sleep(decision.delayMs);
          continue;
        }
        logFashnFailure("submit", "PROVIDER_REJECTED", input.customerId, {
          httpStatus: runRes.status,
          ...(!decision.retry && decision.errorName ? { fashnErrorName: decision.errorName } : {}),
        });
        return submitErr("PROVIDER_REJECTED");
      }
      const runBody = (await runRes.json()) as FashnRunResponse;
      if (runBody.error || !runBody.id) {
        logFashnFailure("submit", "PROVIDER_REJECTED", input.customerId);
        return submitErr("PROVIDER_REJECTED");
      }

      return { ok: true, predictionId: runBody.id };
    } catch {
      logFashnFailure("submit", "PROVIDER_FAILED", input.customerId);
      return submitErr("PROVIDER_FAILED");
    }
  }

  // Unreachable — the loop always returns or continues, and the final
  // iteration's `attempt < FASHN_SUBMIT_MAX_ATTEMPTS` is false so it always
  // returns. Satisfies the compiler's control-flow analysis.
  logFashnFailure("submit", "PROVIDER_REJECTED", input.customerId);
  return submitErr("PROVIDER_REJECTED");
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function err(code: VirtualTryOnErrorCode): VirtualTryOnResult {
  return {
    ok: false,
    code,
    customerMessage: CUSTOMER_ERROR_MESSAGES[code],
  };
}

function submitErr(code: VirtualTryOnErrorCode): SubmitToProviderResult {
  return { ok: false, code, customerMessage: CUSTOMER_ERROR_MESSAGES[code] };
}

