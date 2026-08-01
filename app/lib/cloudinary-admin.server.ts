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
): string {
  const timestamp = Math.floor(nowFn() / 1000);
  const expiresAt = timestamp + expirySeconds;

  // Parameters sorted alphabetically (e < f < p < t twice — expires_at, format, public_id, timestamp, type).
  const sigString =
    `expires_at=${expiresAt}` +
    `&format=${format}` +
    `&public_id=${publicId}` +
    `&timestamp=${timestamp}` +
    `&type=${deliveryType}` +
    config.apiSecret;

  const signature = crypto.createHash("sha1").update(sigString).digest("hex");

  const params = new URLSearchParams({
    api_key: config.apiKey,
    expires_at: String(expiresAt),
    format,
    public_id: publicId,
    signature,
    timestamp: String(timestamp),
    type: deliveryType,
  });

  return `https://api.cloudinary.com/v1_1/${config.cloudName}/image/download?${params.toString()}`;
}

// ── Private upload endpoint URL ──────────────────────────────────────────────
//
// Returns the Cloudinary REST upload endpoint for private-delivery assets.
// Delivery type is encoded in the URL path, not as a form field.
// The server provides this URL to the browser via the signature endpoint;
// the browser must use it verbatim and cannot substitute another endpoint.
export function buildModelUploadUrl(cloudName: string): string {
  return `https://api.cloudinary.com/v1_1/${cloudName}/image/private`;
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
      `https://api.cloudinary.com/v1_1/${cfg.cloudName}/image/destroy`,
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
//
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
): Promise<
  | { ok: true; publicId: string; format: string; version: string }
  | { ok: false; errorCode: string }
> {
  const cfg = _getConfig();
  if (!cfg) return { ok: false, errorCode: "NOT_CONFIGURED" };

  const timestamp = Math.floor(Date.now() / 1000);

  // type is included in signature when it is not the default "upload"
  const sigString =
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
  if (deliveryType && deliveryType !== "upload") {
    body.append("type", deliveryType);
  }
  body.append("file", dataUrl);

  try {
    const res = await _fetch(
      `https://api.cloudinary.com/v1_1/${cfg.cloudName}/image/upload`,
      { method: "POST", body },
    );

    if (!res.ok) return { ok: false, errorCode: "PROVIDER_ERROR" };

    const json = (await res.json()) as {
      public_id?: string;
      format?: string;
      version?: number;
      error?: { message?: string };
    };

    if (json.error) return { ok: false, errorCode: "PROVIDER_REJECTED" };

    return {
      ok: true,
      publicId: json.public_id ?? publicId,
      format: json.format ?? "png",
      version: json.version != null ? String(json.version) : "",
    };
  } catch {
    return { ok: false, errorCode: "NETWORK_ERROR" };
  }
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
