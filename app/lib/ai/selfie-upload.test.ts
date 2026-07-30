// Unit tests for selfie-upload.server.ts
// Covers: magic-byte detection, file validation, dimension extraction.
// These tests run entirely in-process — no Cloudinary or DB connections required.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  detectMimeFromBytes,
  extractImageDimensions,
  validateSelfieFile,
  MAX_IMAGE_BYTES,
  MIN_DIMENSION_PX,
  ACCEPTED_MIME_TYPES,
} from "./selfie-upload.server.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function jpeg(extraBytes = 0): Buffer {
  // FF D8 FF E0 (minimal JPEG SOI + APP0 marker)
  const buf = Buffer.alloc(12 + extraBytes);
  buf[0] = 0xFF; buf[1] = 0xD8; buf[2] = 0xFF;
  return buf;
}

function png(width = 400, height = 500): Buffer {
  // Full PNG IHDR header (24 bytes)
  const buf = Buffer.alloc(24);
  // PNG signature
  buf[0] = 0x89; buf[1] = 0x50; buf[2] = 0x4E; buf[3] = 0x47;
  buf[4] = 0x0D; buf[5] = 0x0A; buf[6] = 0x1A; buf[7] = 0x0A;
  // IHDR chunk: 4 bytes length, "IHDR", 4 bytes width, 4 bytes height
  buf.writeUInt32BE(13, 8);      // chunk length
  buf[12] = 0x49; buf[13] = 0x48; buf[14] = 0x44; buf[15] = 0x52; // "IHDR"
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

function webp(): Buffer {
  // RIFF????WEBP
  const buf = Buffer.alloc(12);
  buf[0] = 0x52; buf[1] = 0x49; buf[2] = 0x46; buf[3] = 0x46; // "RIFF"
  buf[8] = 0x57; buf[9] = 0x45; buf[10] = 0x42; buf[11] = 0x50; // "WEBP"
  return buf;
}

function heic(): Buffer {
  // ftyp box with "heic" brand
  const buf = Buffer.alloc(12);
  buf[4] = 0x66; buf[5] = 0x74; buf[6] = 0x79; buf[7] = 0x70; // "ftyp"
  buf[8] = 0x68; buf[9] = 0x65; buf[10] = 0x69; buf[11] = 0x63; // "heic"
  return buf;
}

function randomBytes(n: number): Buffer {
  return Buffer.from("x".repeat(n));
}

// ── detectMimeFromBytes ───────────────────────────────────────────────────────

describe("detectMimeFromBytes", () => {
  it("detects JPEG from FF D8 FF header", () => {
    assert.equal(detectMimeFromBytes(jpeg()), "image/jpeg");
  });

  it("detects PNG from 89 50 4E 47... header", () => {
    assert.equal(detectMimeFromBytes(png()), "image/png");
  });

  it("detects WEBP from RIFF????WEBP header", () => {
    assert.equal(detectMimeFromBytes(webp()), "image/webp");
  });

  it("detects HEIC from ftyp + heic brand", () => {
    assert.equal(detectMimeFromBytes(heic()), "image/heic");
  });

  it("returns null for an unknown file format", () => {
    assert.equal(detectMimeFromBytes(randomBytes(20)), null);
  });

  it("returns null for a buffer that is too short (< 12 bytes)", () => {
    assert.equal(detectMimeFromBytes(Buffer.from([0xFF, 0xD8])), null);
  });

  it("returns null for empty buffer", () => {
    assert.equal(detectMimeFromBytes(Buffer.alloc(0)), null);
  });
});

// ── extractImageDimensions ────────────────────────────────────────────────────

describe("extractImageDimensions", () => {
  it("extracts correct dimensions from a synthetic PNG", () => {
    const dims = extractImageDimensions(png(800, 600));
    assert.deepEqual(dims, { width: 800, height: 600 });
  });

  it("returns null for WEBP (no in-process dimension parser)", () => {
    assert.equal(extractImageDimensions(webp()), null);
  });

  it("returns null for HEIC", () => {
    assert.equal(extractImageDimensions(heic()), null);
  });

  it("returns null for a buffer too short to parse", () => {
    assert.equal(extractImageDimensions(Buffer.from([0x89, 0x50])), null);
  });
});

// ── validateSelfieFile ────────────────────────────────────────────────────────

describe("validateSelfieFile — accepts valid files", () => {
  it("accepts a valid JPEG file with correct declared MIME", () => {
    const buf = jpeg(100);
    const result = validateSelfieFile(buf, "image/jpeg");
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.canonicalMime, "image/jpeg");
  });

  it("accepts a valid PNG file with correct declared MIME", () => {
    const buf = png(400, 400);
    const result = validateSelfieFile(buf, "image/png");
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.canonicalMime, "image/png");
  });

  it("accepts a valid WEBP file with correct declared MIME", () => {
    const buf = webp();
    const result = validateSelfieFile(buf, "image/webp");
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.canonicalMime, "image/webp");
  });

  it("accepts a valid HEIC file with correct declared MIME", () => {
    const buf = heic();
    const result = validateSelfieFile(buf, "image/heic");
    assert.equal(result.ok, true);
  });

  it("accepts HEIC content with image/heif declared MIME (same family)", () => {
    const result = validateSelfieFile(heic(), "image/heif");
    assert.equal(result.ok, true);
  });
});

describe("validateSelfieFile — rejects invalid files", () => {
  it("rejects empty buffer", () => {
    const result = validateSelfieFile(Buffer.alloc(0), "image/jpeg");
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.reason.length > 0);
  });

  it("rejects file exceeding MAX_IMAGE_BYTES size limit", () => {
    const oversized = Buffer.alloc(MAX_IMAGE_BYTES + 1);
    // put JPEG magic bytes to pass format check
    oversized[0] = 0xFF; oversized[1] = 0xD8; oversized[2] = 0xFF;
    const result = validateSelfieFile(oversized, "image/jpeg");
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.reason.includes("MB"), "reason should mention size limit");
  });

  it("rejects an unsupported declared MIME type (text/html)", () => {
    const result = validateSelfieFile(jpeg(100), "text/html");
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.reason.toLowerCase().includes("unsupported"));
  });

  it("rejects content that does not match declared MIME (JPEG content with image/png declared)", () => {
    const result = validateSelfieFile(jpeg(100), "image/png");
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.reason.toLowerCase().includes("content") || result.reason.toLowerCase().includes("match"));
  });

  it("rejects content with unrecognised magic bytes (treated as unknown format)", () => {
    const result = validateSelfieFile(randomBytes(200), "image/jpeg");
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.reason.length > 0);
  });

  it("rejects a PNG image that is too small (below MIN_DIMENSION_PX)", () => {
    const tinyPng = png(MIN_DIMENSION_PX - 1, MIN_DIMENSION_PX - 1);
    const result = validateSelfieFile(tinyPng, "image/png");
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.reason.toLowerCase().includes("small") || result.reason.includes("px"));
  });

  it("rejects a file with no bytes and any declared type", () => {
    for (const mime of Array.from(ACCEPTED_MIME_TYPES)) {
      const result = validateSelfieFile(Buffer.alloc(0), mime);
      assert.equal(result.ok, false, `Expected reject for ${mime}`);
    }
  });
});

describe("validateSelfieFile — boundary conditions", () => {
  it("accepted MIME types set includes all four required formats", () => {
    assert.ok(ACCEPTED_MIME_TYPES.has("image/jpeg"), "must accept image/jpeg");
    assert.ok(ACCEPTED_MIME_TYPES.has("image/png"),  "must accept image/png");
    assert.ok(ACCEPTED_MIME_TYPES.has("image/webp"), "must accept image/webp");
    assert.ok(ACCEPTED_MIME_TYPES.has("image/heic"), "must accept image/heic");
  });

  it("MAX_IMAGE_BYTES is 5 MB (5 * 1024 * 1024)", () => {
    assert.equal(MAX_IMAGE_BYTES, 5 * 1024 * 1024);
  });

  it("MIN_DIMENSION_PX is 200", () => {
    assert.equal(MIN_DIMENSION_PX, 200);
  });

  it("strips charset suffix from declared MIME type before checking", () => {
    // e.g. "image/jpeg; charset=utf-8" — shouldn't fail declared-type check
    const result = validateSelfieFile(jpeg(100), "image/jpeg; charset=utf-8");
    // Should pass the declared-type check and then also the magic-byte check
    assert.equal(result.ok, true);
  });

  it("canonicalMime in the result is always a lowercase clean type", () => {
    const result = validateSelfieFile(jpeg(100), "image/jpeg");
    if (result.ok) {
      assert.equal(result.canonicalMime, "image/jpeg");
      assert.ok(!result.canonicalMime.includes(";"));
    }
  });
});
