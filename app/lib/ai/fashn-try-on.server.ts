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

const BASE_URL = "https://api.fashn.ai";
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

// Logs only a classified failure — never the provider's raw `error` text,
// never image data, never auth headers. customerId is one-way hashed.
function logFashnFailure(
  stage: "submit" | "poll",
  code: VirtualTryOnErrorCode,
  customerId: string,
  extra?: { predictionId?: string; httpStatus?: number; providerStatus?: string },
): void {
  captureFailure(`fashn:${stage}`, code, {
    customerIdHash: hashCustomerId(customerId),
    ...(extra?.predictionId ? { predictionId: extra.predictionId } : {}),
    ...(extra?.httpStatus !== undefined ? { httpStatus: extra.httpStatus } : {}),
    ...(extra?.providerStatus ? { providerStatus: extra.providerStatus } : {}),
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
}

export type SubmitToProviderResult =
  | { ok: true; predictionId: string }
  | { ok: false; code: VirtualTryOnErrorCode; customerMessage: string };

export async function submitTryOnToProvider(
  input: VirtualTryOnInput,
  { _fetch = fetch, _getApiKey = () => process.env.FASHN_API_KEY }: SubmitToProviderOptions = {},
): Promise<SubmitToProviderResult> {
  const apiKey = _getApiKey();
  if (!apiKey) return submitErr("NOT_CONFIGURED");

  if (!hasVirtualTryOnConsent(input.consent)) return submitErr("CONSENT_REQUIRED");
  if (!isValidModelImageDataUrl(input.modelImageDataUrl)) return submitErr("INVALID_MODEL_IMAGE");
  if (!isAllowedProductImageUrl(input.productImageUrl)) return submitErr("INVALID_PRODUCT_IMAGE");

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
      logFashnFailure("submit", "PROVIDER_REJECTED", input.customerId, { httpStatus: runRes.status });
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

