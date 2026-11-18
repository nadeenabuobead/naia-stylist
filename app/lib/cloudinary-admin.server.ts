// app/lib/cloudinary-admin.server.ts
// Server-side Cloudinary Admin API operations.
// Credentials (CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET, CLOUDINARY_CLOUD_NAME)
// are accessed only here and never returned to the client.
//
// Logging rules: API keys, secrets, and asset delivery URLs must NEVER appear in logs.
// Public IDs may be logged (they are not secrets in isolation).

import crypto from "node:crypto";

export interface CloudinaryConfig {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}

// DI-injectable delete function signature.
// deliveryType matches the Cloudinary delivery type used at upload time (e.g. "private").
export type DeleteAssetFn = (
  publicId: string,
  deliveryType?: string,
) => Promise<{ ok: boolean; errorCode?: string }>;

export function getCloudinaryConfig(): CloudinaryConfig | null {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) return null;
  return { cloudName, apiKey, apiSecret };
}

// ── Time-limited private-download URL (primary preview mechanism) ─────────────
//
// Generates a Cloudinary private_download URL with a server-controlled expiry.
//
// Privacy model:
//   - Asset is stored as deliveryType "private" — not publicly accessible via CDN.
//   - Access requires a valid private_download URL signed with api_secret.
//   - The `expires_at` parameter is enforced by the Cloudinary API server:
//     the URL becomes invalid after that timestamp regardless of signature validity.
//   - Server controls expires_at via nowFn; client has no input into the expiry.
//   - URL is generated per-request, never persisted or logged.
//   - No transformations are applied (original asset served directly).
//
// Signature params (sorted alphabetically, excluding api_key):
//   expires_at={e}&format={f}&public_id={p}&timestamp={t}&type={type}
//   followed immediately by apiSecret (no trailing &).
export function buildPrivateDownloadUrl(
  config: CloudinaryConfig,
  publicId: string,
  format: string,
  deliveryType: string = "private",
  nowFn: () => number = Date.now,
  expirySeconds: number = 600, // 10 minutes — within the required 5–15 min range
  transformation?: string, // optional Cloudinary transformation string, e.g. "w_300,h_400,c_fill,q_60"
  resourceType: string = "image", // "image" | "raw" — part of the URL path only, never signed (see signature params below)
): string {
  const timestamp = Math.floor(nowFn() / 1000);
  const expiresAt = timestamp + expirySeconds;

  // Parameters sorted alphabetically.
  // Without transformation: expires_at, format, public_id, timestamp, type.
  // With transformation: expires_at, format, public_id, timestamp, transformation, type.
  const sigString = transformation
    ? `expires_at=${expiresAt}` +
      `&format=${format}` +
      `&public_id=${publicId}` +
      `&timestamp=${timestamp}` +
      `&transformation=${transformation}` +
      `&type=${deliveryType}` +
      config.apiSecret
    : `expires_at=${expiresAt}` +
      `&format=${format}` +
      `&public_id=${publicId}` +
      `&timestamp=${timestamp}` +
      `&type=${deliveryType}` +
      config.apiSecret;

  const signature = crypto.createHash("sha1").update(sigString).digest("hex");

  const urlParams: Record<string, string> = {
    api_key: config.apiKey,
    expires_at: String(expiresAt),
    format,
    public_id: publicId,
    signature,
    timestamp: String(timestamp),
    type: deliveryType,
  };
  if (transformation) urlParams.transformation = transformation;

  return `https://api.cloudinary.com/v1_1/${config.cloudName}/${resourceType}/download?${new URLSearchParams(urlParams).toString()}`;
}

// ── Browser upload endpoint URL ──────────────────────────────────────────────
//
// Returns the Cloudinary REST upload endpoint for browser-direct uploads.
// The browser upload API only supports CORS on the /image/upload endpoint.
// Delivery type is controlled by the signed `type` parameter in the request body,
// not by the URL path. The server provides this URL via the signature endpoint;
// the browser must use it verbatim and cannot substitute another endpoint.
export function buildModelUploadUrl(cloudName: string): string {
  return `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`;
}

// ── Cloudinary asset verification (Admin API) ─────────────────────────────────
//
// Verifies a Cloudinary asset via the Admin API before persisting its reference.
// Used server-side only — credentials are never exposed to the browser.
//
// Verifies: asset exists, resource_type=image, delivery type, public_id, format, version.
// The browser-supplied version and format must NOT be trusted; use this response instead.
//
// Auth: HTTP Basic with api_key:api_secret (server credentials, never returned to client).
// Endpoint: GET /v1_1/{cloudName}/resources/image/{deliveryType}/{publicId}

export interface CloudinaryAssetInfo {
  publicId: string;
  resourceType: string; // "image" | "video" | "raw"
  type: string;         // "private" | "upload" | "authenticated"
  version: string;
  format: string;
  bytes: number;         // server-verified file size in bytes
  width: number | null;  // server-verified image width (null for non-image or unavailable)
  height: number | null; // server-verified image height
}

export type VerifyAssetFn = (
  publicId: string,
) => Promise<{ ok: true; asset: CloudinaryAssetInfo } | { ok: false; errorCode: string }>;

export async function verifyCloudinaryAsset(
  publicId: string,
  deliveryType: string = "private",
  _fetch: typeof fetch = fetch,
  _getConfig: () => CloudinaryConfig | null = getCloudinaryConfig,
): Promise<{ ok: true; asset: CloudinaryAssetInfo } | { ok: false; errorCode: string }> {
  const cfg = _getConfig();
  if (!cfg) return { ok: false, errorCode: "NOT_CONFIGURED" };

  // Admin API authenticates with HTTP Basic (api_key:api_secret).
  // Public IDs containing slashes are kept as-is in the URL path.
  const url = `https://api.cloudinary.com/v1_1/${cfg.cloudName}/resources/image/${deliveryType}/${publicId}`;
  const credentials = Buffer.from(`${cfg.apiKey}:${cfg.apiSecret}`).toString("base64");

  try {
    const res = await _fetch(url, {
      headers: { Authorization: `Basic ${credentials}` },
    });
    if (res.status === 404) return { ok: false, errorCode: "NOT_FOUND" };
    if (!res.ok) return { ok: false, errorCode: "PROVIDER_ERROR" };

    const json = (await res.json()) as {
      public_id?: string;
      resource_type?: string;
      type?: string;
      version?: number;
      format?: string;
      bytes?: number;
      width?: number;
      height?: number;
    };

    return {
      ok: true,
      asset: {
        publicId: json.public_id ?? "",
        resourceType: json.resource_type ?? "",
        type: json.type ?? "",
        version: json.version != null ? String(json.version) : "",
        format: json.format ?? "",
        bytes: json.bytes ?? 0,
        width: json.width ?? null,
        height: json.height ?? null,
      },
    };
  } catch {
    return { ok: false, errorCode: "NETWORK_ERROR" };
  }
}

// ── List resources by prefix (Admin API) ───────────────────────────────────────
//
// Used only by the abandoned-upload sweep (cloudinary-orphan-sweep.server.ts)
// to enumerate what actually exists under a customer's own folder — never
// used to decide ownership (validatePublicIdOwnership already does that via
// the string prefix itself) or to decide what's safe to delete (the sweep's
// own DB reference check does that). This just answers "what's here."
//
// IMPORTANT: a customer's folder can hold assets under EITHER delivery type
// "private" or "authenticated" — NaiaModel photos are the one asset type in
// this app that can legitimately be either (see my-naia-model.server.ts's
// PERMITTED_DELIVERY_TYPES). Callers must list both types; this function
// only ever queries the one type passed in.
//
// Endpoint: GET /v1_1/{cloudName}/resources/image/{deliveryType}?prefix=...
// Auth: HTTP Basic (api_key:api_secret), same as verifyCloudinaryAsset.
// Rate limit: this IS a rate-limited Admin API call (unlike destroy, which
// uses the separate, unlimited Upload API) — callers must track
// rateLimitRemaining and stop early rather than exhausting the account's
// hourly quota.

export interface CloudinaryListedAsset {
  publicId: string;
  resourceType: string;
  type: string; // delivery type as Cloudinary itself reports it
  format: string;
  createdAt: string; // ISO 8601, as reported by Cloudinary — authoritative age source
}

export interface ListAssetsResult {
  ok: boolean;
  assets: CloudinaryListedAsset[];
  nextCursor: string | null;
  rateLimitRemaining: number | null;
  errorCode?: string;
}

export async function listCloudinaryAssetsByPrefix(
  prefix: string,
  deliveryType: "private" | "authenticated",
  opts: { cursor?: string | null; maxResults?: number } = {},
  _fetch: typeof fetch = fetch,
  _getConfig: () => CloudinaryConfig | null = getCloudinaryConfig,
): Promise<ListAssetsResult> {
  const cfg = _getConfig();
  if (!cfg) return { ok: false, assets: [], nextCursor: null, rateLimitRemaining: null, errorCode: "NOT_CONFIGURED" };

  const maxResults = Math.min(opts.maxResults ?? 100, 500);
  const params = new URLSearchParams({
    type: deliveryType,
    prefix,
    max_results: String(maxResults),
  });
  if (opts.cursor) params.set("next_cursor", opts.cursor);

  const url = `https://api.cloudinary.com/v1_1/${cfg.cloudName}/resources/image/${deliveryType}?${params.toString()}`;
  const credentials = Buffer.from(`${cfg.apiKey}:${cfg.apiSecret}`).toString("base64");

  try {
    const res = await _fetch(url, { headers: { Authorization: `Basic ${credentials}` } });
    const rateLimitRemaining = res.headers.has("X-RateLimit-Remaining")
      ? Number(res.headers.get("X-RateLimit-Remaining"))
      : null;

    if (res.status === 420) return { ok: false, assets: [], nextCursor: null, rateLimitRemaining, errorCode: "RATE_LIMITED" };
    if (!res.ok) return { ok: false, assets: [], nextCursor: null, rateLimitRemaining, errorCode: "PROVIDER_ERROR" };

    const json = (await res.json()) as {
      resources?: Array<{
        public_id?: string;
        resource_type?: string;
        type?: string;
        format?: string;
        created_at?: string;
      }>;
      next_cursor?: string;
    };

    const assets: CloudinaryListedAsset[] = (json.resources ?? []).map((r) => ({
      publicId: r.public_id ?? "",
      resourceType: r.resource_type ?? "",
      type: r.type ?? deliveryType,
      format: r.format ?? "",
      createdAt: r.created_at ?? "",
    }));

    return { ok: true, assets, nextCursor: json.next_cursor ?? null, rateLimitRemaining };
  } catch {
    return { ok: false, assets: [], nextCursor: null, rateLimitRemaining: null, errorCode: "NETWORK_ERROR" };
  }
}

// ── Signed delivery URL (kept for test compatibility) ─────────────────────────
//
// Generates an s--sig-- Cloudinary CDN signed URL.
// NOTE: This URL has NO server-enforced expiry. Use buildPrivateDownloadUrl for
// preview URLs. This function is retained for backward compatibility with existing
// CL.7 / PV.2-5 tests and any future use cases that require CDN-path signing.
export function buildSignedDeliveryUrl(
  config: CloudinaryConfig,
  publicId: string,
  version: string | null,
  deliveryType: string = "private",
): string {
  const vPart = version ? `v${version}/` : "";
  const pathComponent = `${vPart}${publicId}`;
  // Cloudinary signs: "/" + pathComponent + api_secret
  const stringToSign = `/${pathComponent}` + config.apiSecret;
  const signature = crypto
    .createHash("sha1")
    .update(stringToSign)
    .digest("base64url")
    .slice(0, 8);
  return `https://res.cloudinary.com/${config.cloudName}/image/${deliveryType}/s--${signature}--/${pathComponent}`;
}

// ── Cloudinary asset deletion (Admin API) ─────────────────────────────────────
//
// Deletes a Cloudinary asset by public ID. Signature parameters must match
// the delivery type used at upload time.
//
// For private assets (deliveryType="private"), the signature includes type=private.
// For standard uploads (deliveryType="upload" or omitted), type is not signed.
//
// "not found" from Cloudinary is treated as ok — idempotent delete.
export async function deleteCloudinaryAsset(
  publicId: string,
  deliveryType: string = "private",
  _fetch: typeof fetch = fetch,
  _getConfig: () => CloudinaryConfig | null = getCloudinaryConfig,
  resourceType: string = "image", // "image" | "raw" — part of the URL path only, never signed
): Promise<{ ok: boolean; errorCode?: string }> {
  const cfg = _getConfig();
  if (!cfg) {
    return { ok: false, errorCode: "NOT_CONFIGURED" };
  }

  const timestamp = Math.floor(Date.now() / 1000);

  // Parameters must be sorted alphabetically for Cloudinary signature verification.
  // public_id < timestamp < type (p < t, then i < y)
  const sigParts = [`public_id=${publicId}`, `timestamp=${timestamp}`];
  if (deliveryType && deliveryType !== "upload") {
    sigParts.push(`type=${deliveryType}`);
  }
  const sigString = sigParts.join("&") + cfg.apiSecret;

  const signature = crypto.createHash("sha1").update(sigString).digest("hex");

  const body = new URLSearchParams({
    public_id: publicId,
    api_key: cfg.apiKey,
    timestamp: String(timestamp),
    signature,
  });
  if (deliveryType && deliveryType !== "upload") {
    body.append("type", deliveryType);
  }

  try {
    const res = await _fetch(
      `https://api.cloudinary.com/v1_1/${cfg.cloudName}/${resourceType}/destroy`,
      { method: "POST", body },
    );

    if (!res.ok) {
      return { ok: false, errorCode: "PROVIDER_ERROR" };
    }

    const json = (await res.json()) as { result?: string };
    if (json.result !== "ok" && json.result !== "not found") {
      return { ok: false, errorCode: "PROVIDER_REJECTED" };
    }
    return { ok: true };
  } catch {
    return { ok: false, errorCode: "NETWORK_ERROR" };
  }
}

// ── Server-side private asset upload ─────────────────────────────────────────
// 2026-11-16 CONFIRMED GAP — this call had no bounded timeout at all
// (unlike submitTryOnToProvider's own AbortSignal.timeout), so a hung
// connection to Cloudinary would ride all the way to the platform's own
// function timeout instead of failing fast with a classification our own
// code can act on. 20s is comfortably under a single garment step's share
// of the request budget while still generous for a private image upload.
const CLOUDINARY_UPLOAD_TIMEOUT_MS = 20_000;

// A bounded, idempotent retry — same publicId every attempt, so a retry
// can only ever overwrite the same asset, never create a duplicate or
// charge anything twice. Only for signatures that are plausibly transient
// (a timed-out/reset connection, a 5xx, or a 429 rate-limit — all
// conventionally retry-safe); never for PROVIDER_REJECTED (Cloudinary
// explicitly rejected this exact content — retrying identical content
// changes nothing) or any other 4xx (a malformed request/signature that
// retrying won't fix either).
const CLOUDINARY_UPLOAD_MAX_ATTEMPTS = 2;
const CLOUDINARY_UPLOAD_RETRY_DELAY_MS = 300;

function isTransientCloudinaryErrorCode(errorCode: string): boolean {
  if (errorCode === "NETWORK_ERROR") return true;
  const statusMatch = /^PROVIDER_ERROR_(\d+)$/.exec(errorCode);
  if (!statusMatch) return false;
  const status = Number(statusMatch[1]);
  return status === 429 || status >= 500;
}

// Uploads a base64 data URL to Cloudinary with delivery type "private".
// Used for result ingestion (try-on output). base64 data must never appear in logs.
//
// Signature params (alphabetical, excluding api_key and file):
//   public_id < timestamp < type  (i < y → timestamp before type)
export async function uploadCloudinaryPrivate(
  publicId: string,
  dataUrl: string,
  deliveryType: string = "private",
  _fetch: typeof fetch = fetch,
  _getConfig: () => CloudinaryConfig | null = getCloudinaryConfig,
  _sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  // Optional: forces Cloudinary to transcode the uploaded asset to this exact
  // format on ingest (server-side, Cloudinary's own infrastructure — not a
  // guess about what the input bytes already are). Callers that later build a
  // download URL with a hardcoded format (e.g. "png" for an AI-generated
  // result) must pass that same format here so the hardcoded assumption is
  // true by construction, never assumed.
  targetFormat?: string,
): Promise<
  | { ok: true; publicId: string; format: string; version: string }
  | { ok: false; errorCode: string }
> {
  const cfg = _getConfig();
  if (!cfg) return { ok: false, errorCode: "NOT_CONFIGURED" };

  let lastFailure: { ok: false; errorCode: string } = { ok: false, errorCode: "NETWORK_ERROR" };

  for (let attempt = 1; attempt <= CLOUDINARY_UPLOAD_MAX_ATTEMPTS; attempt++) {
    // Timestamp (and therefore the signature) is recomputed every attempt
    // — Cloudinary's signature is timestamp-bound, so a retry can never
    // reuse the first attempt's signed body.
    const timestamp = Math.floor(Date.now() / 1000);

    // Parameters sorted alphabetically for signing: format, public_id, timestamp, type.
    const sigString =
      (targetFormat ? `format=${targetFormat}&` : "") +
      `public_id=${publicId}` +
      `&timestamp=${timestamp}` +
      (deliveryType && deliveryType !== "upload" ? `&type=${deliveryType}` : "") +
      cfg.apiSecret;

    const signature = crypto.createHash("sha1").update(sigString).digest("hex");

    const body = new URLSearchParams({
      public_id: publicId,
      api_key: cfg.apiKey,
      timestamp: String(timestamp),
      signature,
    });
    if (targetFormat) {
      body.append("format", targetFormat);
    }
    if (deliveryType && deliveryType !== "upload") {
      body.append("type", deliveryType);
    }
    body.append("file", dataUrl);

    try {
      const res = await _fetch(`https://api.cloudinary.com/v1_1/${cfg.cloudName}/image/upload`, {
        method: "POST",
        body,
        signal: AbortSignal.timeout(CLOUDINARY_UPLOAD_TIMEOUT_MS),
      });

      // Confirmed actionable gap (2026-11-16, from the real Attempt B
      // investigation): see downloadIntermediateStepResult's identical fix
      // (full-look-tryon-real.server.ts) for the full reasoning — a bare
      // "PROVIDER_ERROR" with no HTTP status erased the one piece of
      // information that would have distinguished a transient failure from
      // a persistent one.
      if (!res.ok) {
        lastFailure = { ok: false, errorCode: `PROVIDER_ERROR_${res.status}` };
      } else {
        const json = (await res.json()) as {
          public_id?: string;
          format?: string;
          version?: number;
          error?: { message?: string };
        };

        if (json.error) {
          lastFailure = { ok: false, errorCode: "PROVIDER_REJECTED" };
        } else if (!json.format) {
          // A missing format in Cloudinary's own upload response must never
          // be guessed at — a caller that builds a download URL with a
          // hardcoded/guessed format off a false "it's definitely X" premise
          // forces a real, cached format conversion on every later download.
          lastFailure = { ok: false, errorCode: "MISSING_UPLOAD_FORMAT" };
        } else {
          return {
            ok: true,
            publicId: json.public_id ?? publicId,
            format: json.format,
            version: json.version != null ? String(json.version) : "",
          };
        }
      }
    } catch {
      lastFailure = { ok: false, errorCode: "NETWORK_ERROR" };
    }

    if (attempt < CLOUDINARY_UPLOAD_MAX_ATTEMPTS && isTransientCloudinaryErrorCode(lastFailure.errorCode)) {
      await _sleep(CLOUDINARY_UPLOAD_RETRY_DELAY_MS);
      continue;
    }
    break;
  }

  return lastFailure;
}

// ── Server-side private RAW-file upload ──────────────────────────────────────
//
// For binary files that are not images (e.g. a generated ZIP archive) —
// uploaded as a Buffer via multipart/form-data, not a base64 data URL like
// uploadCloudinaryPrivate. A separate function rather than branching inside
// uploadCloudinaryPrivate: the body construction genuinely differs (binary
// multipart vs. a base64 string field), and base64-encoding a large archive
// just to fit the existing function's data-URL shape would both bloat memory
// and lose the point of using a raw upload in the first place.
//
// Signature params — identical alphabetical convention to uploadCloudinaryPrivate's own comment above.
//
// Accepts a single Buffer OR an array of Buffers (the exact chunks a stream
// emitted) — a caller holding the file as streamed chunks should pass the
// array directly rather than pre-concatenating with Buffer.concat first.
// Buffer.concat allocates one new contiguous buffer the size of the whole
// file IN ADDITION to the chunks already held — for a large file that is a
// real, avoidable doubling of peak memory, which is exactly what
// customer-export-zip-large.server.ts's buffered path needs to avoid. The
// Blob constructor accepts multiple parts natively and does not require the
// caller to pre-join them.
export async function uploadCloudinaryRawPrivate(
  publicId: string,
  buffer: Buffer | Buffer[],
  filename: string,
  deliveryType: string = "private",
  _fetch: typeof fetch = fetch,
  _getConfig: () => CloudinaryConfig | null = getCloudinaryConfig,
): Promise<
  | { ok: true; publicId: string }
  | { ok: false; errorCode: string }
> {
  const cfg = _getConfig();
  if (!cfg) return { ok: false, errorCode: "NOT_CONFIGURED" };

  const timestamp = Math.floor(Date.now() / 1000);

  const sigString =
    `public_id=${publicId}` +
    `&timestamp=${timestamp}` +
    (deliveryType && deliveryType !== "upload" ? `&type=${deliveryType}` : "") +
    cfg.apiSecret;

  const signature = crypto.createHash("sha1").update(sigString).digest("hex");

  const body = new FormData();
  body.append("public_id", publicId);
  body.append("api_key", cfg.apiKey);
  body.append("timestamp", String(timestamp));
  body.append("signature", signature);
  if (deliveryType && deliveryType !== "upload") {
    body.append("type", deliveryType);
  }
  // Buffer(s) -> Blob via plain Uint8Array views (same bytes, a type BlobPart
  // accepts) — passed as multiple parts when given an array, never
  // pre-concatenated into a second full-size copy.
  const parts = (Array.isArray(buffer) ? buffer : [buffer]).map((b) => new Uint8Array(b));
  body.append("file", new Blob(parts, { type: "application/zip" }), filename);

  try {
    const res = await _fetch(
      `https://api.cloudinary.com/v1_1/${cfg.cloudName}/raw/upload`,
      { method: "POST", body },
    );

    if (!res.ok) return { ok: false, errorCode: "PROVIDER_ERROR" };

    const json = (await res.json()) as { public_id?: string; error?: { message?: string } };
    if (json.error) return { ok: false, errorCode: "PROVIDER_REJECTED" };

    return { ok: true, publicId: json.public_id ?? publicId };
  } catch {
    return { ok: false, errorCode: "NETWORK_ERROR" };
  }
}

// ── Chunked streaming raw upload (2026-11-16) ────────────────────────────────
//
// uploadCloudinaryRawPrivate above requires the ENTIRE file already sitting
// in memory as a Buffer/Buffer[] before the first byte is sent — fine for a
// small file, but customer-export-zip-large.server.ts's archive output can
// legitimately reach hundreds of MB to low GB, and holding that much in one
// Vercel Function instance (verified: 2048 MB real memory, 300s real
// duration for this project's actual deployed function — see that file's
// own comment) was the exact risk a byte-count ceiling alone could only ever
// paper over, never remove. This uses Cloudinary's own documented chunked
// upload protocol (POST the same /raw/upload endpoint repeatedly, same
// X-Unique-Upload-Id per chunk, Content-Range bytes <start>-<end>/<total>,
// -1 for <total> until the final chunk) so peak memory for the upload
// itself stays bounded at roughly one chunk (CHUNK_SIZE_BYTES), regardless
// of total file size — the caller streams bytes in via write() as they're
// produced instead of collecting them all first.
//
// Minimum chunk size per Cloudinary's own documented limit: every chunk
// except the final one must exceed 5 MB. CHUNK_SIZE_BYTES (20 MB) is
// Cloudinary's own documented default/recommended size — comfortably above
// that floor with margin, and small enough to keep this function's own
// memory footprint trivial next to the 2048 MB real ceiling.
export const CHUNK_SIZE_BYTES = 20 * 1024 * 1024;

export interface ChunkedUploadDeps {
  _fetch?: typeof fetch;
  _getConfig?: () => CloudinaryConfig | null;
  _uniqueUploadId?: () => string;
}

export type ChunkWriteResult = { ok: true } | { ok: false; errorCode: string };
export type ChunkFinishResult = { ok: true; publicId: string } | { ok: false; errorCode: string };

export interface ChunkedRawUploader {
  // Feed the next slice of bytes as it's produced. Internally buffers until
  // a full CHUNK_SIZE_BYTES is available, then sends exactly one HTTP call
  // per threshold crossing — never holds more than ~one chunk at a time.
  write(buf: Buffer): Promise<ChunkWriteResult>;
  // Sends whatever remains (the final chunk, which may be smaller than
  // CHUNK_SIZE_BYTES and is exempt from the 5 MB-per-chunk minimum) with the
  // now-known real total size, completing the upload.
  finish(): Promise<ChunkFinishResult>;
}

export function createChunkedRawUploader(
  publicId: string,
  filename: string,
  deliveryType: string = "private",
  deps: ChunkedUploadDeps = {},
): ChunkedRawUploader {
  const _fetch = deps._fetch ?? fetch;
  const _getConfig = deps._getConfig ?? getCloudinaryConfig;
  const uploadId = (deps._uniqueUploadId ?? (() => crypto.randomUUID()))();

  let pending: Buffer[] = [];
  let pendingBytes = 0;
  let bytesSent = 0;
  let failure: { ok: false; errorCode: string } | null = null;

  async function sendChunk(chunk: Buffer, isFinal: boolean): Promise<ChunkFinishResult> {
    const cfg = _getConfig();
    if (!cfg) return { ok: false, errorCode: "NOT_CONFIGURED" };

    const timestamp = Math.floor(Date.now() / 1000);
    // Same alphabetical signature convention as uploadCloudinaryRawPrivate —
    // identical across every chunk of this upload (public_id and type never
    // change mid-upload; only the Content-Range/body differ).
    const sigString =
      `public_id=${publicId}` +
      `&timestamp=${timestamp}` +
      (deliveryType && deliveryType !== "upload" ? `&type=${deliveryType}` : "") +
      cfg.apiSecret;
    const signature = crypto.createHash("sha1").update(sigString).digest("hex");

    const body = new FormData();
    body.append("public_id", publicId);
    body.append("api_key", cfg.apiKey);
    body.append("timestamp", String(timestamp));
    body.append("signature", signature);
    if (deliveryType && deliveryType !== "upload") body.append("type", deliveryType);
    body.append("file", new Blob([new Uint8Array(chunk)], { type: "application/zip" }), filename);

    const start = bytesSent;
    const end = start + chunk.length - 1;
    // Real total is only known once the final chunk is being sent — every
    // prior chunk reports -1, per Cloudinary's own documented protocol for
    // an upload whose total size isn't known upfront (true here: the real
    // archive size depends on which image fetches succeed/fail and isn't
    // fixed ahead of time).
    const total = isFinal ? end + 1 : -1;

    try {
      const res = await _fetch(`https://api.cloudinary.com/v1_1/${cfg.cloudName}/raw/upload`, {
        method: "POST",
        headers: { "X-Unique-Upload-Id": uploadId, "Content-Range": `bytes ${start}-${end}/${total}` },
        body,
      });
      if (!res.ok) return { ok: false, errorCode: "PROVIDER_ERROR" };

      const json = (await res.json()) as { public_id?: string; error?: { message?: string } };
      if (json.error) return { ok: false, errorCode: "PROVIDER_REJECTED" };

      bytesSent = end + 1;
      return { ok: true, publicId: json.public_id ?? publicId };
    } catch {
      return { ok: false, errorCode: "NETWORK_ERROR" };
    }
  }

  return {
    async write(buf: Buffer): Promise<ChunkWriteResult> {
      if (failure) return failure;
      pending.push(buf);
      pendingBytes += buf.length;
      // Flush every time a full chunk has accumulated — may fire more than
      // once per write() if a single incoming slice is itself large.
      while (pendingBytes >= CHUNK_SIZE_BYTES) {
        const joined = Buffer.concat(pending, pendingBytes); // bounded to ~one chunk, never the whole file
        const toSend = joined.subarray(0, CHUNK_SIZE_BYTES);
        const rest = joined.subarray(CHUNK_SIZE_BYTES);
        const result = await sendChunk(toSend, false);
        if (!result.ok) {
          failure = result;
          return result;
        }
        pending = rest.length ? [rest] : [];
        pendingBytes = rest.length;
      }
      return { ok: true };
    },
    async finish(): Promise<ChunkFinishResult> {
      if (failure) return failure;
      const finalChunk = Buffer.concat(pending, pendingBytes);
      return sendChunk(finalChunk, true);
    },
  };
}

// ── Public ID ownership validation ───────────────────────────────────────────
//
// Validates that a Cloudinary public ID belongs to the authenticated customer's folder.
// Customer cannot submit an arbitrary public ID belonging to another customer.
export function validatePublicIdOwnership(
  publicId: string,
  customerId: string,
): { ok: true } | { ok: false; error: string } {
  if (!publicId || typeof publicId !== "string") {
    return { ok: false, error: "Invalid public ID." };
  }
  const expected = `naia-wardrobe/${customerId}/`;
  if (!publicId.startsWith(expected)) {
    return { ok: false, error: "Photo does not belong to this account." };
  }
  return { ok: true };
}

// ── Legacy public imageUrl ownership validation ──────────────────────────────
//
// 2026-11-18 — QA #36 exposure review: ClosetItem.imageUrl (and the same
// field on the handful of other models that share it) is a pre-private-
// delivery-migration legacy field — a genuine unsigned, non-expiring,
// publicly-fetchable Cloudinary URL, confirmed via this codebase's own
// comment ("legacy public imageUrl") in customer-360.server.ts. Every call
// site that resolves a display image already checks
// validatePublicIdOwnership() on the SIGNED (imagePublicId) branch before
// using it — the legacy-URL fallback branch did not have an equivalent
// check anywhere, even though it carries the same "could this row belong to
// someone else" risk the signed branch was explicitly written to guard
// against. No caller found during this review currently passes a
// mismatched item/customerId pair (every current query scopes by
// customerId upstream) — this is deliberate defense-in-depth for that
// invariant, not a fix for a confirmed live exploit.
//
// Deliberately asymmetric, NOT a simple "must match my prefix" check:
// confirmed via git history (911c1cf, 2026-08-11) that the
// naia-wardrobe/{customerId}/ public_id prefix convention itself was only
// made reliable on that date — before it, Cloudinary's dynamic folder mode
// (asset_folder) could produce a bare, unprefixed public_id. A legacy
// imageUrl predating that fix may legitimately belong to its customer
// without carrying any naia-wardrobe/ segment at all. Blocking every
// unprefixed legacy URL outright would silently hide real photos for
// whichever customers uploaded before that date — the exact "broken
// reference" regression this fix must not introduce. So: reject only on
// POSITIVE evidence the URL names a DIFFERENT customer's folder; an
// ambiguous/pre-convention URL with no determinable owner is allowed
// through here, relying on the same upstream customerId-scoped query every
// current caller already uses to reach this value in the first place.
export function validateImageUrlOwnership(
  imageUrl: string | null | undefined,
  customerId: string,
): boolean {
  if (!imageUrl || typeof imageUrl !== "string") return false;
  const match = imageUrl.match(/\/naia-wardrobe\/([^/]+)\//);
  if (!match) return true; // no determinable owner segment — pre-convention legacy format, not evidence of mismatch
  return match[1] === customerId;
}
