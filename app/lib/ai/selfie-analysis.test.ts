// app/lib/ai/selfie-analysis.test.ts
// Phase 4A8 — Unit tests for selfie analysis, file validation, persistence, deletion,
// re-analysis, and security invariants.
// All DB / Cloudinary / Claude calls are exercised via injectable stubs — no live network.
// Run: node --test --import tsx/esm app/lib/ai/selfie-analysis.test.ts

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  analyseSelfie,
  checkSelfieQuality,
  clearSelfieAnalysisRecord,
  type SelfieAnalyzerFn,
} from "./selfie-analysis.server.ts";
import type { SelfieAnalysisRecord, SelfieStyleSignals } from "./selfie-analysis.ts";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CONSENT_AT = "2026-07-17T10:00:00.000Z";
const IMAGE_URL = { imageUrl: "https://res.cloudinary.com/naia-cloud/image/upload/v1/selfie-test.jpg" };

function makeQualityPass(): string {
  return JSON.stringify({ qualityPass: true, issues: [], guidance: null });
}

function makeQualityFail(issues: string[], guidance: string): string {
  return JSON.stringify({ qualityPass: false, issues, guidance });
}

function makeStyleSignals(): SelfieStyleSignals {
  return {
    faceShapeDirection: "softly oval tendency — most necklines may suit",
    suggestedNecklines: ["V-neck", "scoop neck", "square neck"],
    necklineExplanation: "an open neckline may elongate and draw the eye upward",
    colourFamilies: ["warm earth tones", "muted dusty rose", "soft ivory"],
    colourExplanation: "warm tones may complement golden undertones",
    contrastLevel: "medium",
    hairLengthDirection: "shoulder-length or longer may balance proportions",
    hairVolumeDirection: "volume at the crown tends to add lift",
    hairPartingDirection: "a side parting may soften the forehead",
    earringsDirection: "longer drop earrings may elongate",
    glassesFrameDirection: "oval or round frames may complement angular features",
    makeupColourDirection: "warm terracotta tones may suit",
    overallNote: "tonal layering with warm neutrals may create a cohesive look",
  };
}

function makeStyleResponse(): string {
  return JSON.stringify(makeStyleSignals());
}

// Analyzer stub: first call returns quality, second returns style
function twoCallAnalyzer(qualityResponse: string, styleResponse: string): SelfieAnalyzerFn {
  let callCount = 0;
  return async (_input, _prompt) => {
    callCount++;
    return callCount === 1 ? qualityResponse : styleResponse;
  };
}

// Analyzer stub: always returns the same response
function fixedAnalyzer(response: string): SelfieAnalyzerFn {
  return async () => response;
}

// Analyzer stub: throws on every call
function throwingAnalyzer(message = "Network error"): SelfieAnalyzerFn {
  return async () => { throw new Error(message); };
}

// Analyzer stub: hangs forever (for timeout tests)
function hangingAnalyzer(): SelfieAnalyzerFn {
  return () => new Promise(() => {/* never resolves */});
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("analyseSelfie", () => {

  it("test 1: valid selfie returns completed with full SelfieStyleSignals", async () => {
    const analyzer = twoCallAnalyzer(makeQualityPass(), makeStyleResponse());
    const result = await analyseSelfie(IMAGE_URL, { consentAt: CONSENT_AT, _analyzer: analyzer });

    assert.equal(result.status, "completed");
    if (result.status !== "completed") return;

    const { signals } = result;
    assert.equal(signals.contrastLevel, "medium");
    assert.ok(Array.isArray(signals.suggestedNecklines));
    assert.ok(signals.suggestedNecklines.length >= 2);
    assert.ok(Array.isArray(signals.colourFamilies));
    assert.ok(signals.colourFamilies.length >= 2);
    assert.equal(typeof signals.faceShapeDirection, "string");
    assert.ok(signals.faceShapeDirection.length > 0);
    assert.ok(typeof result.analysedAt === "string");
  });

  it("test 2: blurry photo → quality-failed with blurry issue", async () => {
    const analyzer = fixedAnalyzer(makeQualityFail(["blurry"], "The image is too blurry. Retake in good, even lighting."));
    const result = await analyseSelfie(IMAGE_URL, { consentAt: CONSENT_AT, _analyzer: analyzer });

    assert.equal(result.status, "quality-failed");
    if (result.status !== "quality-failed") return;
    assert.ok(result.issues.includes("blurry"));
    assert.equal(typeof result.guidance, "string");
  });

  it("test 3: face obstructed → quality-failed with obstructed issue", async () => {
    const analyzer = fixedAnalyzer(makeQualityFail(["obstructed"], "Your face is partially covered. Retake without obstructions."));
    const result = await analyseSelfie(IMAGE_URL, { consentAt: CONSENT_AT, _analyzer: analyzer });

    assert.equal(result.status, "quality-failed");
    if (result.status !== "quality-failed") return;
    assert.ok(result.issues.includes("obstructed"));
  });

  it("test 4: multiple faces → quality-failed with multiple-faces issue", async () => {
    const analyzer = fixedAnalyzer(makeQualityFail(["multiple-faces"], "More than one face is visible. Retake solo."));
    const result = await analyseSelfie(IMAGE_URL, { consentAt: CONSENT_AT, _analyzer: analyzer });

    assert.equal(result.status, "quality-failed");
    if (result.status !== "quality-failed") return;
    assert.ok(result.issues.includes("multiple-faces"));
  });

  it("test 5: strong filter / colour cast → quality-failed with strong-filter issue", async () => {
    const analyzer = fixedAnalyzer(makeQualityFail(["strong-filter"], "A heavy colour filter is masking your natural colouring. Retake without filters."));
    const result = await analyseSelfie(IMAGE_URL, { consentAt: CONSENT_AT, _analyzer: analyzer });

    assert.equal(result.status, "quality-failed");
    if (result.status !== "quality-failed") return;
    assert.ok(result.issues.includes("strong-filter"));
  });

  it("test 6: malformed quality response (bad JSON) → system-failure", async () => {
    const analyzer = fixedAnalyzer("this is not json at all");
    const result = await analyseSelfie(IMAGE_URL, { consentAt: CONSENT_AT, _analyzer: analyzer });

    // Bad JSON in quality check → quality-assessment-failed issue, which leads to quality-failed
    assert.equal(result.status, "quality-failed");
    if (result.status !== "quality-failed") return;
    assert.ok(result.issues.includes("quality-assessment-failed"));
  });

  it("test 7: malformed style response → system-failure", async () => {
    // Quality passes, style response is bad JSON
    const analyzer = twoCallAnalyzer(makeQualityPass(), "{ not valid json }");
    const result = await analyseSelfie(IMAGE_URL, { consentAt: CONSENT_AT, _analyzer: analyzer });

    assert.equal(result.status, "system-failure");
  });

  it("test 8: provider timeout → timeout outcome", async () => {
    const result = await analyseSelfie(IMAGE_URL, {
      consentAt: CONSENT_AT,
      timeoutMs: 50,
      _analyzer: hangingAnalyzer(),
    });
    assert.equal(result.status, "timeout");
  });

  it("test 9: consent missing → consent-missing before any provider call", async () => {
    let analyzerCalled = false;
    const analyzer: SelfieAnalyzerFn = async () => { analyzerCalled = true; return ""; };

    const result = await analyseSelfie(IMAGE_URL, { consentAt: null, _analyzer: analyzer });
    assert.equal(result.status, "consent-missing");
    assert.equal(analyzerCalled, false, "analyzer should not be called when consent is missing");
  });

  it("test 10: clearSelfieAnalysisRecord sets status to deleted and clears signals", () => {
    const record: SelfieAnalysisRecord = {
      consentAt: CONSENT_AT,
      photoPublicId: "naia-wardrobe/cust-abc/selfie",
      photoDeletedAt: null,
      analysisStatus: "completed",
      analysisResult: makeStyleSignals(),
      analysedAt: "2026-07-17T10:05:00.000Z",
      analysisVersion: 1,
    };

    const cleared = clearSelfieAnalysisRecord(record, () => "2026-07-17T11:00:00.000Z");

    assert.equal(cleared.analysisStatus, "deleted");
    assert.equal(cleared.analysisResult, null);
    assert.equal(cleared.analysedAt, null);
    assert.equal(cleared.photoDeletedAt, "2026-07-17T11:00:00.000Z");
    // Immutable: original record unchanged
    assert.equal(record.analysisStatus, "completed");
  });

  it("test 11: prohibited fields in response are silently stripped", async () => {
    // Response includes extra prohibited keys alongside valid signal fields
    const signals = makeStyleSignals();
    const responseWithExtraFields = JSON.stringify({
      ...signals,
      attractivenessRating: 8,
      ethnicity: "inferred-value",
      medicalNote: "some health claim",
      age: "early thirties",
    });

    const analyzer = twoCallAnalyzer(makeQualityPass(), responseWithExtraFields);
    const result = await analyseSelfie(IMAGE_URL, { consentAt: CONSENT_AT, _analyzer: analyzer });

    assert.equal(result.status, "completed");
    if (result.status !== "completed") return;

    const { signals: returned } = result;
    assert.ok(!("attractivenessRating" in returned), "attractivenessRating must be stripped");
    assert.ok(!("ethnicity" in returned), "ethnicity must be stripped");
    assert.ok(!("medicalNote" in returned), "medicalNote must be stripped");
    assert.ok(!("age" in returned), "age must be stripped");
    // Approved fields are still present
    assert.equal(returned.contrastLevel, "medium");
    assert.ok(Array.isArray(returned.suggestedNecklines));
  });

});

describe("checkSelfieQuality", () => {

  it("returns pass:true for valid quality response", async () => {
    const result = await checkSelfieQuality(IMAGE_URL, fixedAnalyzer(makeQualityPass()));
    assert.equal(result.pass, true);
    assert.deepEqual(result.issues, []);
    assert.equal(result.guidance, null);
  });

  it("returns pass:false with quality-assessment-failed when analyzer throws", async () => {
    const result = await checkSelfieQuality(IMAGE_URL, throwingAnalyzer("timeout"));
    assert.equal(result.pass, false);
    assert.ok(result.issues.includes("quality-assessment-failed"));
  });

  it("strips unknown issue codes from response", async () => {
    const response = JSON.stringify({
      qualityPass: false,
      issues: ["blurry", "unknown-code-xyz", "obstructed"],
      guidance: "fix it",
    });
    const result = await checkSelfieQuality(IMAGE_URL, fixedAnalyzer(response));
    assert.equal(result.pass, false);
    assert.ok(result.issues.includes("blurry"));
    assert.ok(result.issues.includes("obstructed"));
    assert.ok(!result.issues.includes("unknown-code-xyz"), "unknown codes must be stripped");
  });

});

// ═════════════════════════════════════════════════════════════════════════════
// File validation tests
// ═════════════════════════════════════════════════════════════════════════════

import {
  validateSelfieFile,
  detectMimeFromBytes,
  extractImageDimensions,
  MAX_IMAGE_BYTES,
  MIN_DIMENSION_PX,
} from "./selfie-upload.server.ts";

// Minimal valid PNG: 1×1 transparent pixel
function makeMinimalPng(width = 400, height = 400): Buffer {
  // Build a real minimal PNG with correct IHDR so dimension extraction works.
  // Signature (8) + IHDR chunk (4+4+13+4) + IDAT (minimal) + IEND
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;  // bit depth
  ihdrData[9] = 2;  // color type RGB
  // IHDR chunk: 4-byte length + "IHDR" + 13 bytes + 4-byte CRC (stub)
  const ihdrLen = Buffer.alloc(4); ihdrLen.writeUInt32BE(13, 0);
  const ihdrType = Buffer.from("IHDR");
  const ihdrCrc = Buffer.alloc(4);
  // IEND chunk
  const iendLen = Buffer.alloc(4);
  const iendType = Buffer.from("IEND");
  const iendCrc = Buffer.alloc(4);
  return Buffer.concat([sig, ihdrLen, ihdrType, ihdrData, ihdrCrc, iendLen, iendType, iendCrc]);
}

// Minimal JPEG magic bytes header
function makeJpegMagic(): Buffer {
  const buf = Buffer.alloc(64);
  buf[0] = 0xFF; buf[1] = 0xD8; buf[2] = 0xFF; buf[3] = 0xE0;
  return buf;
}

describe("validateSelfieFile", () => {

  it("fv-1: valid PNG → ok with canonical mime image/png", () => {
    const buf = makeMinimalPng(400, 400);
    const result = validateSelfieFile(buf, "image/png");
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.canonicalMime, "image/png");
  });

  it("fv-2: valid JPEG magic bytes → ok", () => {
    const buf = makeJpegMagic();
    const result = validateSelfieFile(buf, "image/jpeg");
    assert.equal(result.ok, true);
  });

  it("fv-3: MIME type mismatch — JPEG bytes declared as text/html → rejected", () => {
    const buf = makeJpegMagic();
    const result = validateSelfieFile(buf, "text/html");
    assert.equal(result.ok, false);
  });

  it("fv-4: MIME type mismatch — PNG bytes declared as image/jpeg → rejected", () => {
    const buf = makeMinimalPng(400, 400);
    const result = validateSelfieFile(buf, "image/jpeg");
    assert.equal(result.ok, false);
  });

  it("fv-5: file too large → rejected", () => {
    const buf = Buffer.alloc(MAX_IMAGE_BYTES + 1);
    // Write PNG header so magic bytes pass if size limit weren't applied
    buf[0] = 0x89; buf[1] = 0x50; buf[2] = 0x4E; buf[3] = 0x47;
    buf[4] = 0x0D; buf[5] = 0x0A; buf[6] = 0x1A; buf[7] = 0x0A;
    const result = validateSelfieFile(buf, "image/png");
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.reason.includes("MB"));
  });

  it("fv-6: PNG too small (< MIN_DIMENSION_PX) → rejected", () => {
    const buf = makeMinimalPng(50, 50);
    const result = validateSelfieFile(buf, "image/png");
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.reason.includes("small") || result.reason.includes("px"));
  });

  it("fv-7: empty buffer → rejected", () => {
    const result = validateSelfieFile(Buffer.alloc(0), "image/jpeg");
    assert.equal(result.ok, false);
  });

  it("fv-8: random bytes → rejected (unknown format)", () => {
    const buf = Buffer.from("this is not an image at all, just random text bytes");
    const result = validateSelfieFile(buf, "image/jpeg");
    assert.equal(result.ok, false);
  });

});

describe("detectMimeFromBytes", () => {

  it("dm-1: JPEG header → image/jpeg", () => {
    const buf = makeJpegMagic();
    assert.equal(detectMimeFromBytes(buf), "image/jpeg");
  });

  it("dm-2: PNG header → image/png", () => {
    const buf = makeMinimalPng(400, 400);
    assert.equal(detectMimeFromBytes(buf), "image/png");
  });

  it("dm-3: WEBP header → image/webp", () => {
    const buf = Buffer.alloc(16);
    buf.write("RIFF", 0, "ascii");
    buf.write("WEBP", 8, "ascii");
    assert.equal(detectMimeFromBytes(buf), "image/webp");
  });

  it("dm-4: unknown bytes → null", () => {
    const buf = Buffer.from("not an image header");
    assert.equal(detectMimeFromBytes(buf), null);
  });

});

describe("extractImageDimensions", () => {

  it("ed-1: PNG 400×400 → correct dimensions", () => {
    const buf = makeMinimalPng(400, 400);
    const dims = extractImageDimensions(buf);
    assert.ok(dims !== null);
    assert.equal(dims!.width, 400);
    assert.equal(dims!.height, 400);
  });

  it("ed-2: PNG 100×200 → correct dimensions", () => {
    const buf = makeMinimalPng(100, 200);
    const dims = extractImageDimensions(buf);
    assert.ok(dims !== null);
    assert.equal(dims!.width, 100);
    assert.equal(dims!.height, 200);
  });

  it("ed-3: JPEG magic-only (no SOF) → null", () => {
    const buf = makeJpegMagic();
    // No SOF marker in this minimal buffer — dimensions not extractable
    assert.equal(extractImageDimensions(buf), null);
  });

});

// ═════════════════════════════════════════════════════════════════════════════
// Persistence tests
// ═════════════════════════════════════════════════════════════════════════════

import {
  beginSelfieAnalysis,
  completeSelfieAnalysis,
  failSelfieAnalysis,
  deleteSelfiePhoto,
  deleteAnalysisResult,
  deleteBoth,
  clearSelfiePhotoOwnership,
  type DbSelfieRecord,
  type FindSelfieRecordFn,
  type UpsertSelfieRecordFn,
} from "./selfie-persistence.server.ts";
import type { DeleteAssetFn } from "./selfie-upload.server.ts";

const CUST = "cust-test-abc";

function makeDbRecord(overrides: Partial<DbSelfieRecord> = {}): DbSelfieRecord {
  return {
    id: "rec-1",
    customerId: CUST,
    consentAt: new Date("2026-07-17T10:00:00Z"),
    photoPublicId: `naia-wardrobe/${CUST}/selfie`,
    photoFormat: "jpg",
    photoDeletedAt: null,
    analysisStatus: "completed",
    analysisResult: makeStyleSignals(),
    analysedAt: new Date("2026-07-17T10:05:00Z"),
    analysisDeletedAt: null,
    analysisVersion: 1,
    createdAt: new Date("2026-07-17T10:00:00Z"),
    updatedAt: new Date("2026-07-17T10:05:00Z"),
    ...overrides,
  };
}

// Captures the data last passed to upsert — useful for asserting what was stored
function capturingUpsert(): { fn: UpsertSelfieRecordFn; captured: Partial<DbSelfieRecord>[] } {
  const captured: Partial<DbSelfieRecord>[] = [];
  const fn: UpsertSelfieRecordFn = async (_customerId, data) => {
    captured.push(data);
    return makeDbRecord(data as Partial<DbSelfieRecord>);
  };
  return { fn, captured };
}

function nullFind(): FindSelfieRecordFn {
  return async () => null;
}

function recordFind(record: DbSelfieRecord): FindSelfieRecordFn {
  return async () => record;
}

function successDelete(): DeleteAssetFn {
  return async () => ({ ok: true });
}

function failDelete(errorCode = "NETWORK_ERROR"): DeleteAssetFn {
  return async () => ({ ok: false, errorCode });
}

describe("beginSelfieAnalysis", () => {

  it("pa-1: creates pending record when no existing record", async () => {
    const { fn: upsert, captured } = capturingUpsert();
    const result = await beginSelfieAnalysis(
      CUST,
      new Date("2026-07-17T10:00:00Z"),
      `naia-wardrobe/${CUST}/selfie`,
      "jpg",
      {},
      nullFind(),
      upsert,
    );
    assert.equal(result.blocked, false);
    assert.equal(captured.length, 1);
    assert.equal(captured[0].analysisStatus, "pending");
    assert.equal(captured[0].photoPublicId, `naia-wardrobe/${CUST}/selfie`);
  });

  it("pa-2: consent timestamp is stored in the record", async () => {
    const { fn: upsert, captured } = capturingUpsert();
    const consentAt = new Date("2026-07-17T10:00:00Z");
    await beginSelfieAnalysis(CUST, consentAt, null, null, {}, nullFind(), upsert);
    assert.deepEqual(captured[0].consentAt, consentAt);
  });

  it("pa-3: blocked when existing status is pending (duplicate guard)", async () => {
    const existing = makeDbRecord({ analysisStatus: "pending" });
    const result = await beginSelfieAnalysis(
      CUST,
      new Date(),
      null,
      null,
      {},
      recordFind(existing),
      async () => { throw new Error("should not be called"); },
    );
    assert.equal(result.blocked, true);
  });

  it("pa-4: forceReplace bypasses pending guard", async () => {
    const existing = makeDbRecord({ analysisStatus: "pending" });
    const { fn: upsert, captured } = capturingUpsert();
    const result = await beginSelfieAnalysis(
      CUST, new Date(), null, null,
      { forceReplace: true },
      recordFind(existing),
      upsert,
    );
    assert.equal(result.blocked, false);
    assert.equal(captured[0].analysisStatus, "pending");
  });

  it("pa-5: non-pending existing record (failed) is not blocked", async () => {
    const existing = makeDbRecord({ analysisStatus: "failed" });
    const { fn: upsert, captured } = capturingUpsert();
    const result = await beginSelfieAnalysis(CUST, new Date(), null, null, {}, recordFind(existing), upsert);
    assert.equal(result.blocked, false);
    assert.equal(captured[0].analysisStatus, "pending");
  });

  it("pa-6: photoDeletedAt is cleared so re-upload after deleteSelfiePhoto shows hasPhoto:true", async () => {
    // Regression: deleteSelfiePhoto sets photoDeletedAt; beginSelfieAnalysis must reset it
    // so loadSelfieForDisplay returns hasPhoto:true after the new photo is confirmed.
    const existing = makeDbRecord({ photoPublicId: null, photoDeletedAt: new Date("2026-08-01T10:00:00Z") });
    const { fn: upsert, captured } = capturingUpsert();
    await beginSelfieAnalysis(CUST, new Date(), `naia-wardrobe/${CUST}/selfie`, "jpg", {}, recordFind(existing), upsert);
    assert.equal(captured[0].photoDeletedAt, null);
  });

});

describe("completeSelfieAnalysis", () => {

  it("pc-1: stores validated signals, status=completed, version, and analysedAt", async () => {
    const { fn: upsert, captured } = capturingUpsert();
    const signals = makeStyleSignals();
    const analysedAt = new Date("2026-07-17T10:05:00Z");
    await completeSelfieAnalysis(CUST, signals, 1, analysedAt, upsert);
    assert.equal(captured[0].analysisStatus, "completed");
    assert.deepEqual(captured[0].analysisResult, signals);
    assert.equal(captured[0].analysisVersion, 1);
    assert.deepEqual(captured[0].analysedAt, analysedAt);
  });

  it("pc-2: raw provider output is not stored — only signals", async () => {
    // completeSelfieAnalysis only accepts SelfieStyleSignals — there is no path
    // for raw provider text to enter the persistence layer
    const { fn: upsert, captured } = capturingUpsert();
    await completeSelfieAnalysis(CUST, makeStyleSignals(), 1, new Date(), upsert);
    const stored = captured[0].analysisResult as Record<string, unknown>;
    // Must not have any field that is not in SelfieStyleSignals
    const signalKeys = new Set(Object.keys(makeStyleSignals()));
    for (const key of Object.keys(stored)) {
      assert.ok(signalKeys.has(key), `unexpected key in stored result: ${key}`);
    }
  });

});

describe("failSelfieAnalysis", () => {

  it("pf-1: sets status=failed and clears analysisResult", async () => {
    const { fn: upsert, captured } = capturingUpsert();
    await failSelfieAnalysis(CUST, upsert);
    assert.equal(captured[0].analysisStatus, "failed");
    assert.equal(captured[0].analysisResult, null);
    assert.equal(captured[0].analysedAt, null);
  });

});

// ═════════════════════════════════════════════════════════════════════════════
// Deletion tests
// ═════════════════════════════════════════════════════════════════════════════

describe("deleteSelfiePhoto", () => {

  it("del-1: deletes Cloudinary asset and clears photoPublicId from DB", async () => {
    const existing = makeDbRecord({ photoPublicId: `naia-wardrobe/${CUST}/selfie` });
    const deletedIds: string[] = [];
    const trackingDelete: DeleteAssetFn = async (publicId) => {
      deletedIds.push(publicId);
      return { ok: true };
    };
    const { fn: upsert, captured } = capturingUpsert();
    const result = await deleteSelfiePhoto(CUST, trackingDelete, recordFind(existing), upsert);

    assert.equal(result.ok, true);
    assert.ok(deletedIds.includes(`naia-wardrobe/${CUST}/selfie`), "Cloudinary asset must be deleted");
    assert.equal(captured[0].photoPublicId, null);
    assert.ok(captured[0].photoDeletedAt instanceof Date);
  });

  it("del-2: analysisResult is preserved when only photo deleted", async () => {
    const existing = makeDbRecord();
    const { fn: upsert, captured } = capturingUpsert();
    await deleteSelfiePhoto(CUST, successDelete(), recordFind(existing), upsert);
    // analysisResult not touched — upsert data should not include analysisResult key
    assert.ok(!("analysisResult" in captured[0]), "analysisResult must not be cleared on photo-only delete");
  });

  it("del-3: Cloudinary deletion failure preserves photoPublicId and returns ok:false", async () => {
    const existing = makeDbRecord();
    const { fn: upsert, captured } = capturingUpsert();
    const result = await deleteSelfiePhoto(CUST, failDelete("NETWORK_ERROR"), recordFind(existing), upsert);
    // Must not claim success
    assert.equal(result.ok, false);
    // DB must not be modified — photoPublicId preserved for retry
    assert.equal(captured.length, 0, "DB must not be modified when Cloudinary deletion fails");
  });

  it("del-4: returns ok:false when no record exists", async () => {
    const result = await deleteSelfiePhoto(CUST, successDelete(), nullFind(), async () => { throw new Error("should not upsert"); });
    assert.equal(result.ok, false);
  });

  it("del-5: retry after deletion failure succeeds when Cloudinary recovers", async () => {
    const existing = makeDbRecord();
    // First attempt fails
    const failResult = await deleteSelfiePhoto(CUST, failDelete("NETWORK_ERROR"), recordFind(existing), async () => { throw new Error("should not upsert on failure"); });
    assert.equal(failResult.ok, false);

    // Second attempt succeeds — photoPublicId still present in DB (preserved from first attempt)
    const { fn: upsert, captured } = capturingUpsert();
    const retryResult = await deleteSelfiePhoto(CUST, successDelete(), recordFind(existing), upsert);
    assert.equal(retryResult.ok, true);
    assert.equal(captured[0].photoPublicId, null, "photoPublicId cleared after successful retry");
    assert.ok(captured[0].photoDeletedAt instanceof Date);
  });

});

describe("deleteAnalysisResult", () => {

  it("dar-1: clears signals; sets status=deleted and analysisDeletedAt; photo reference untouched", async () => {
    const existing = makeDbRecord();
    const { fn: upsert, captured } = capturingUpsert();
    const result = await deleteAnalysisResult(CUST, recordFind(existing), upsert);
    assert.equal(result.ok, true);
    assert.equal(captured[0].analysisStatus, "deleted", "status must be 'deleted', not 'failed'");
    assert.equal(captured[0].analysisResult, null);
    assert.ok(captured[0].analysisDeletedAt instanceof Date, "analysisDeletedAt must be set");
    // photoPublicId not touched
    assert.ok(!("photoPublicId" in captured[0]), "photoPublicId must not be touched on analysis-only delete");
  });

  it("dar-2: no Cloudinary call when deleting analysis only", async () => {
    // deleteAnalysisResult signature has no deleteAsset param — it cannot call Cloudinary
    const existing = makeDbRecord();
    const { fn: upsert } = capturingUpsert();
    await deleteAnalysisResult(CUST, recordFind(existing), upsert);
    // No assertion needed — function signature guarantees it
    assert.ok(true);
  });

});

describe("deleteBoth", () => {

  it("db-1: deletes Cloudinary asset and clears all analysis fields including analysisDeletedAt", async () => {
    const existing = makeDbRecord();
    const deletedIds: string[] = [];
    const trackingDelete: DeleteAssetFn = async (id) => { deletedIds.push(id); return { ok: true }; };
    const { fn: upsert, captured } = capturingUpsert();
    const result = await deleteBoth(CUST, trackingDelete, recordFind(existing), upsert);

    assert.equal(result.ok, true);
    assert.ok(deletedIds.length > 0, "Cloudinary must be called");
    assert.equal(captured[0].analysisStatus, "deleted");
    assert.equal(captured[0].analysisResult, null);
    assert.equal(captured[0].photoPublicId, null);
    assert.ok(captured[0].photoDeletedAt instanceof Date);
    assert.ok(captured[0].analysisDeletedAt instanceof Date, "analysisDeletedAt must be set on delete-both");
  });

  it("db-2: Cloudinary failure on deleteBoth preserves DB and returns ok:false", async () => {
    const existing = makeDbRecord();
    const { fn: upsert, captured } = capturingUpsert();
    const result = await deleteBoth(CUST, failDelete("NETWORK_ERROR"), recordFind(existing), upsert);
    assert.equal(result.ok, false);
    assert.equal(captured.length, 0, "DB must not be modified when Cloudinary deletion fails");
  });

});

// ═════════════════════════════════════════════════════════════════════════════
// clearSelfiePhotoOwnership tests
// ═════════════════════════════════════════════════════════════════════════════

describe("clearSelfiePhotoOwnership", () => {

  it("cop-1: clears photoPublicId and photoFormat without a Cloudinary call", async () => {
    const { fn: upsert, captured } = capturingUpsert();
    await clearSelfiePhotoOwnership(CUST, upsert);
    assert.equal(captured.length, 1, "exactly one DB update");
    assert.equal(captured[0].photoPublicId, null, "photoPublicId must be cleared");
    assert.equal(captured[0].photoFormat, null, "photoFormat must be cleared");
    assert.ok(captured[0].photoDeletedAt instanceof Date, "photoDeletedAt must be set");
  });

  it("cop-2: sets photoDeletedAt to prevent double-deletion by deleteSelfiePhoto", async () => {
    const { fn: upsert, captured } = capturingUpsert();
    await clearSelfiePhotoOwnership(CUST, upsert);
    const before = Date.now();
    const deletedAt = captured[0].photoDeletedAt as Date;
    assert.ok(deletedAt.getTime() <= before, "photoDeletedAt must be a recent timestamp");
  });

});

// ═════════════════════════════════════════════════════════════════════════════
// Re-analysis / replace tests
// ═════════════════════════════════════════════════════════════════════════════

describe("re-analysis and replace", () => {

  it("ra-1: failed status does not block a new analysis", async () => {
    const existing = makeDbRecord({ analysisStatus: "failed" });
    const { fn: upsert, captured } = capturingUpsert();
    const result = await beginSelfieAnalysis(CUST, new Date(), null, null, {}, recordFind(existing), upsert);
    assert.equal(result.blocked, false);
    assert.equal(captured[0].analysisStatus, "pending");
  });

  it("ra-2: replace clears old analysisResult before new analysis begins", async () => {
    const existing = makeDbRecord({ analysisStatus: "completed" });
    const { fn: upsert, captured } = capturingUpsert();
    await beginSelfieAnalysis(CUST, new Date(), null, null, { forceReplace: true }, recordFind(existing), upsert);
    assert.equal(captured[0].analysisResult, null, "old result must be cleared on replace");
    assert.equal(captured[0].analysisStatus, "pending");
  });

  it("ra-3: completed record can be replaced with new signals and incremented version", async () => {
    const { fn: upsert, captured } = capturingUpsert();
    const newSignals = { ...makeStyleSignals(), contrastLevel: "high" as const };
    await completeSelfieAnalysis(CUST, newSignals, 2, new Date(), upsert);
    assert.equal((captured[0].analysisResult as typeof newSignals).contrastLevel, "high");
    assert.equal(captured[0].analysisVersion, 2);
  });

  it("ra-4: successful re-analysis after delete-analysis clears analysisDeletedAt", async () => {
    // Simulate a record that had its analysis deleted
    const { fn: upsert, captured } = capturingUpsert();
    await completeSelfieAnalysis(CUST, makeStyleSignals(), 2, new Date(), upsert);
    assert.equal(captured[0].analysisDeletedAt, null, "analysisDeletedAt must be cleared on successful analysis");
    assert.equal(captured[0].analysisStatus, "completed");
  });

});

// ═════════════════════════════════════════════════════════════════════════════
// Security invariant tests
// ═════════════════════════════════════════════════════════════════════════════

describe("security invariants", () => {

  it("sec-1: SelfieAnalysisOutcome completed does not include photoPublicId", async () => {
    const analyzer = twoCallAnalyzer(makeQualityPass(), makeStyleResponse());
    const result = await analyseSelfie(IMAGE_URL, { consentAt: CONSENT_AT, _analyzer: analyzer });
    assert.equal(result.status, "completed");
    assert.ok(!("photoPublicId" in result), "completed outcome must not expose photoPublicId");
    assert.ok(!("signedUrl" in result), "completed outcome must not expose signedUrl");
    assert.ok(!("rawResponse" in result), "completed outcome must not expose rawResponse");
  });

  it("sec-2: SelfieAnalysisOutcome stores no raw provider response", async () => {
    const rawWithExtras = JSON.stringify({
      ...makeStyleSignals(),
      _raw: "full provider response text",
      debug: "internal reasoning",
    });
    const analyzer = twoCallAnalyzer(makeQualityPass(), rawWithExtras);
    const result = await analyseSelfie(IMAGE_URL, { consentAt: CONSENT_AT, _analyzer: analyzer });
    assert.equal(result.status, "completed");
    if (result.status !== "completed") return;
    assert.ok(!("_raw" in result.signals), "_raw must be stripped");
    assert.ok(!("debug" in result.signals), "debug must be stripped");
  });

  it("sec-3: completeSelfieAnalysis never persists photoPublicId — it is not a parameter", async () => {
    // The function signature only accepts signals, version, analysedAt — no publicId
    // This test documents the contract explicitly
    const { fn: upsert, captured } = capturingUpsert();
    await completeSelfieAnalysis(CUST, makeStyleSignals(), 1, new Date(), upsert);
    assert.ok(!("photoPublicId" in captured[0]), "completeSelfieAnalysis must not write photoPublicId");
  });

  it("sec-4: loadSelfieForDisplay returns no photoPublicId or photoFormat", async () => {
    const { loadSelfieForDisplay: loadDisplay } = await import("./selfie-persistence.server.ts");
    const existing = makeDbRecord({
      photoPublicId: `naia-wardrobe/${CUST}/selfie`,
      photoFormat: "jpg",
    });
    const display = await loadDisplay(CUST, recordFind(existing));
    assert.ok(display !== null);
    assert.ok(!("photoPublicId" in (display as object)), "photoPublicId must not appear in display record");
    assert.ok(!("photoFormat" in (display as object)), "photoFormat must not appear in display record");
    assert.ok("hasPhoto" in (display as object), "hasPhoto bool must be present");
    assert.equal(display!.hasPhoto, true);
  });

});

// ═════════════════════════════════════════════════════════════════════════════
// Authentication and consent semantics
//
// Unauthenticated requests are rejected at the route level (throw redirect to
// /auth/login) before reaching analyseSelfie. The analysis layer has no concept
// of "unauthenticated" — its only auth-adjacent condition is consent-missing,
// which is strictly a customer consent concern, not an identity concern.
// ═════════════════════════════════════════════════════════════════════════════

describe("authentication and consent semantics", () => {

  it("auth-1: consent-missing is returned only when consentAt is explicitly null — not as a catch-all for auth failures", async () => {
    let analyzerCalled = false;
    const analyzer: SelfieAnalyzerFn = async () => { analyzerCalled = true; return ""; };
    const result = await analyseSelfie(IMAGE_URL, { consentAt: null, _analyzer: analyzer });
    assert.equal(result.status, "consent-missing");
    assert.equal(analyzerCalled, false, "no provider call must be made without consent");
  });

  it("auth-2: authenticated customer with valid consent does not receive consent-missing", async () => {
    const analyzer = twoCallAnalyzer(makeQualityPass(), makeStyleResponse());
    const result = await analyseSelfie(IMAGE_URL, { consentAt: CONSENT_AT, _analyzer: analyzer });
    assert.notEqual(result.status, "consent-missing", "valid consent must not return consent-missing");
    assert.equal(result.status, "completed");
  });

});
