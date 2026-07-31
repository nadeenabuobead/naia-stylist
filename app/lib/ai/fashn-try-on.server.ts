// app/lib/ai/fashn-try-on.server.ts
// FASHN Try-On Max adapter.
// Only the full-body photo reaches FASHN. Face photos never do.
// All DI points (fetch, sleep, getApiKey) are overridable for testing.
// FASHN_API_KEY is server-side only — never returned to the client.
//
// Logging rules: base64 image data, auth headers, and response images
// must never appear in logs. Prediction IDs and error codes may be logged.

import type {
  VirtualTryOnInput,
  VirtualTryOnResult,
  VirtualTryOnErrorCode,
  VirtualTryOnConsent,
} from "./virtual-try-on.types.js";
import { CUSTOMER_ERROR_MESSAGES } from "./virtual-try-on.types.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const BASE_URL = "https://api.fashn.ai";
const POLL_INTERVAL_MS = 2_000;
const MAX_POLL_ATTEMPTS = 45; // 90s ceiling at 2s interval

// ── In-process rate limit (development / single-instance only) ────────────────
// NOT suitable for multi-instance production deployments.
const DEV_RATE_LIMIT_MS = 10_000;
const _customerLastRun = new Map<string, number>();

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

    // ── 3. In-process rate limit (development only) ───────────────────────────
    const now = Date.now();
    const lastRun = _customerLastRun.get(input.customerId);
    if (lastRun !== undefined && now - lastRun < DEV_RATE_LIMIT_MS) {
      return err("RATE_LIMITED");
    }
    _customerLastRun.set(input.customerId, now);

    // ── 4. Submit to FASHN ────────────────────────────────────────────────────
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
      });

      if (!runRes.ok) {
        return err("PROVIDER_REJECTED");
      }

      const runBody = (await runRes.json()) as FashnRunResponse;
      if (runBody.error || !runBody.id) {
        return err("PROVIDER_REJECTED");
      }
      predictionId = runBody.id;
      // Persist the ID before polling so a timeout doesn't lose it.
      onPredictionId?.(predictionId);
    } catch {
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
      });
      if (!statusRes.ok) {
        return err("PROVIDER_FAILED");
      }
      statusBody = (await statusRes.json()) as FashnStatusResponse;
    } catch {
      return err("PROVIDER_FAILED");
    }

    const status = statusBody.status;

    if (status === "completed") {
      const outputs = statusBody.output;
      if (!Array.isArray(outputs) || outputs.length === 0 || typeof outputs[0] !== "string") {
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
      return err("PROVIDER_FAILED");
    }

    // starting | in_queue | processing — continue polling
  }

  return err("TIMEOUT");
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function err(code: VirtualTryOnErrorCode): VirtualTryOnResult {
  return {
    ok: false,
    code,
    customerMessage: CUSTOMER_ERROR_MESSAGES[code],
  };
}

