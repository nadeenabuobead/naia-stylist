// app/lib/ai/selfie-upload.server.ts
// Phase 4A8 — Selfie file validation, server-side Cloudinary upload, signed analysis URL.
//
// Security contract:
//   - photoPublicId is deterministic: naia-wardrobe/{customerId}/selfie
//   - Cloudinary asset is stored as delivery type "private"
//   - Signed access URL is generated server-side for analyzeImage; never sent to browser
//   - Magic-byte validation rejects files whose content mismatches the declared MIME type
//   - Server drives the full upload; browser never touches Cloudinary directly for selfies

import crypto from "node:crypto";
import {
  deleteCloudinaryAsset,
  buildPrivateDownloadUrl,
  getCloudinaryConfig,
  type DeleteAssetFn,
  type CloudinaryConfig,
} from "../cloudinary-admin.server.js";

// ── Accepted types ────────────────────────────────────────────────────────────

export const ACCEPTED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
export const MIN_DIMENSION_PX = 200;             // both width and height

// ── Magic-byte detection ──────────────────────────────────────────────────────
//
// Returns the canonical MIME type derived from file content, or null if unknown.
// HEIC/HEIF detection checks for the ftyp box; full box parse is skipped.

export function detectMimeFromBytes(buf: Buffer): string | null {
  if (buf.length < 12) return null;

  // JPEG: FF D8 FF
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return "image/jpeg";

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47 &&
    buf[4] === 0x0D && buf[5] === 0x0A && buf[6] === 0x1A && buf[7] === 0x0A
  ) return "image/png";

  // WEBP: RIFF????WEBP
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && // "RIFF"
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50   // "WEBP"
  ) return "image/webp";

  // HEIC/HEIF: ftyp box at offset 4 ("ftyp" = 66 74 79 70)
  if (
    buf.length >= 12 &&
    buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70  // "ftyp"
  ) {
    const brand = buf.toString("ascii", 8, 12);
    if (brand === "heic" || brand === "heis" || brand === "hevx" || brand === "mif1" || brand === "msf1") {
      return "image/heic";
    }
    if (brand === "heif") return "image/heif";
  }

  return null;
}

// ── Dimension extraction ──────────────────────────────────────────────────────
//
// Returns image dimensions for JPEG and PNG.
// Returns null when format is unrecognised (HEIC, some WEBP variants) — size-only
// validation applies in those cases.

export function extractImageDimensions(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 24) return null;

  // PNG: IHDR chunk at bytes 8–24 (4 length, 4 "IHDR", 4 width, 4 height)
  if (buf[0] === 0x89 && buf[1] === 0x50) {
    if (buf.length < 24) return null;
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    return width > 0 && height > 0 ? { width, height } : null;
  }

  // JPEG: scan forward for SOF0 (0xFF 0xC0) or SOF2 (0xFF 0xC2)
  if (buf[0] === 0xFF && buf[1] === 0xD8) {
    let offset = 2;
    while (offset + 8 < buf.length) {
      if (buf[offset] !== 0xFF) break;
      const marker = buf[offset + 1];
      const segLen = buf.readUInt16BE(offset + 2);
      if (marker === 0xC0 || marker === 0xC2) {
        const height = buf.readUInt16BE(offset + 5);
        const width = buf.readUInt16BE(offset + 7);
        return width > 0 && height > 0 ? { width, height } : null;
      }
      // SOI/EOI have no length field; everything else does
      if (marker === 0xD8 || marker === 0xD9) { offset += 2; continue; }
      offset += 2 + segLen;
    }
    return null;
  }

  return null;
}

// ── File validation ───────────────────────────────────────────────────────────

export type FileValidationResult =
  | { ok: true; canonicalMime: string }
  | { ok: false; reason: string };

export function validateSelfieFile(
  buf: Buffer,
  declaredMime: string,
): FileValidationResult {
  // 1. Size
  if (buf.length === 0) return { ok: false, reason: "No file received." };
  if (buf.length > MAX_IMAGE_BYTES) {
    return { ok: false, reason: `Photo exceeds ${MAX_IMAGE_BYTES / (1024 * 1024)} MB limit.` };
  }

  // 2. Declared type must be in accepted set
  const normDeclared = declaredMime.split(";")[0].trim().toLowerCase();
  if (!ACCEPTED_MIME_TYPES.has(normDeclared)) {
    return { ok: false, reason: "Unsupported file type. Upload a JPEG, PNG, WEBP, or HEIC photo." };
  }

  // 3. Magic bytes must match an accepted format
  const detected = detectMimeFromBytes(buf);
  if (!detected) {
    return { ok: false, reason: "The file does not appear to be a recognised image format." };
  }
  if (!ACCEPTED_MIME_TYPES.has(detected)) {
    return { ok: false, reason: "Unsupported image format detected in file content." };
  }

  // 4. Content-type must be broadly consistent (e.g. JPEG bytes with text/html declared = reject)
  // Allow HEIF/HEIC interchangeably; otherwise require category match.
  const heicFamily = new Set(["image/heic", "image/heif"]);
  const mismatch =
    heicFamily.has(normDeclared) && heicFamily.has(detected)
      ? false
      : normDeclared !== detected;
  if (mismatch) {
    return { ok: false, reason: "File content does not match the declared file type." };
  }

  // 5. Dimensions (where extractable)
  const dims = extractImageDimensions(buf);
  if (dims !== null) {
    if (dims.width < MIN_DIMENSION_PX || dims.height < MIN_DIMENSION_PX) {
      return {
        ok: false,
        reason: `Photo is too small (${dims.width}×${dims.height}px). Use a photo at least ${MIN_DIMENSION_PX}×${MIN_DIMENSION_PX}px.`,
      };
    }
  }

  return { ok: true, canonicalMime: detected };
}

// ── Public ID helper ──────────────────────────────────────────────────────────
//
// Deterministic slot — one selfie per customer.  Replace always overwrites the same path.

export function buildSelfiePublicId(customerId: string): string {
  return `naia-wardrobe/${customerId}/selfie`;
}

// ── Server-side Cloudinary upload (with overwrite) ────────────────────────────
//
// Uploads the selfie buffer to Cloudinary as a private asset.
// Uses overwrite=true so replacement is atomic in Cloudinary — no old-asset lookup needed.
// The upload endpoint is the standard /image/upload (delivery type encoded via `type` param).
//
// Signature params (alphabetical, excluding api_key and file):
//   overwrite, public_id, timestamp, type
//
// Injectable _fetch and _getConfig for tests.

export type UploadSelfieFn = (
  buf: Buffer,
  canonicalMime: string,
  customerId: string,
) => Promise<{ ok: true; publicId: string; format: string } | { ok: false; errorCode: string }>;

export async function uploadSelfieToCloudinary(
  buf: Buffer,
  canonicalMime: string,
  customerId: string,
  _fetch: typeof fetch = fetch,
  _getConfig: () => CloudinaryConfig | null = getCloudinaryConfig,
): Promise<{ ok: true; publicId: string; format: string } | { ok: false; errorCode: string }> {
  const cfg = _getConfig();
  if (!cfg) return { ok: false, errorCode: "NOT_CONFIGURED" };

  const publicId = buildSelfiePublicId(customerId);
  const timestamp = Math.floor(Date.now() / 1000);
  const deliveryType = "private";

  // Signature: alphabetical params (overwrite < public_id < timestamp < type) + secret
  const sigString =
    `overwrite=true` +
    `&public_id=${publicId}` +
    `&timestamp=${timestamp}` +
    `&type=${deliveryType}` +
    cfg.apiSecret;

  const signature = crypto.createHash("sha1").update(sigString).digest("hex");

  // Convert buffer to base64 data URL for Cloudinary upload
  const base64Data = buf.toString("base64");
  const dataUrl = `data:${canonicalMime};base64,${base64Data}`;

  const body = new URLSearchParams({
    api_key: cfg.apiKey,
    file: dataUrl,
    overwrite: "true",
    public_id: publicId,
    signature,
    timestamp: String(timestamp),
    type: deliveryType,
  });

  try {
    const res = await _fetch(
      `https://api.cloudinary.com/v1_1/${cfg.cloudName}/image/upload`,
      { method: "POST", body },
    );

    if (!res.ok) return { ok: false, errorCode: "PROVIDER_ERROR" };

    const json = (await res.json()) as {
      public_id?: string;
      format?: string;
      error?: { message?: string };
    };

    if (json.error) return { ok: false, errorCode: "PROVIDER_REJECTED" };

    return {
      ok: true,
      publicId: json.public_id ?? publicId,
      format: json.format ?? "jpg",
    };
  } catch {
    return { ok: false, errorCode: "NETWORK_ERROR" };
  }
}

// ── Short-lived signed analysis URL ──────────────────────────────────────────
//
// Generates a Cloudinary private_download URL for use by analyzeImage.
// TTL: 10 minutes — enough for one analysis call.
// This URL is NEVER returned to the browser; it is consumed entirely server-side.

export function buildSelfieAnalysisUrl(
  publicId: string,
  format: string,
  _getConfig: () => CloudinaryConfig | null = getCloudinaryConfig,
  nowFn: () => number = Date.now,
): string | null {
  const cfg = _getConfig();
  if (!cfg) return null;
  return buildPrivateDownloadUrl(cfg, publicId, format, "private", nowFn, 600);
}

// Re-export for injection in tests
export { deleteCloudinaryAsset };
export type { DeleteAssetFn };
