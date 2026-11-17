// app/lib/ai/selfie-upload-format-fallback.test.ts
//
// QA #36 follow-up (2026-11-17) — uploadSelfieToCloudinary() used to default
// a missing Cloudinary upload-response `format` field to "jpg" instead of
// failing closed. That guessed value is persisted as
// SelfieAnalysis.photoFormat and reused for every later reanalysis/retry via
// buildSelfieAnalysisUrl -> buildPrivateDownloadUrl. A wrong guess there
// forces a real format conversion on Cloudinary's authenticated
// /image/download endpoint, cached as a derived resource regardless of
// Strict Transformations — the same mechanism already fixed for
// NaiaModel/ClosetItem formats (b5f01ed). This is the same bug class, one
// step removed: a guessed value planted at upload time rather than read
// directly from a nullable DB column.
//
// Run: npx vitest run app/lib/ai/selfie-upload-format-fallback.test.ts

import { describe, it, expect, vi } from "vitest";
import { uploadSelfieToCloudinary } from "./selfie-upload.server";

const FAKE_CONFIG = { cloudName: "test-cloud", apiKey: "test-key", apiSecret: "test-secret" };
const getConfig = () => FAKE_CONFIG;

function fetchReturning(json: Record<string, unknown>) {
  return vi.fn(async () => ({ ok: true, json: async () => json }) as any);
}

describe("uploadSelfieToCloudinary — format fallback", () => {
  it("a missing format in Cloudinary's upload response never guesses \"jpg\" — fails closed with MISSING_UPLOAD_FORMAT", async () => {
    const fetchFn = fetchReturning({ public_id: "naia-selfies/cust_abc" }); // no format field
    const result = await uploadSelfieToCloudinary(
      Buffer.from("fake-image-bytes"),
      "image/jpeg",
      "cust_abc",
      fetchFn,
      getConfig,
    );
    expect(result).toEqual({ ok: false, errorCode: "MISSING_UPLOAD_FORMAT" });
  });

  it("a present, real format (e.g. png) is passed through verbatim, never coerced to jpg", async () => {
    const fetchFn = fetchReturning({ public_id: "naia-selfies/cust_abc", format: "png" });
    const result = await uploadSelfieToCloudinary(
      Buffer.from("fake-image-bytes"),
      "image/jpeg",
      "cust_abc",
      fetchFn,
      getConfig,
    );
    expect(result).toEqual({ ok: true, publicId: "naia-selfies/cust_abc", format: "png" });
  });

  it("an empty-string format is also treated as missing — never passed through as a falsy-but-truthy-looking value", async () => {
    const fetchFn = fetchReturning({ public_id: "naia-selfies/cust_abc", format: "" });
    const result = await uploadSelfieToCloudinary(
      Buffer.from("fake-image-bytes"),
      "image/jpeg",
      "cust_abc",
      fetchFn,
      getConfig,
    );
    expect(result).toEqual({ ok: false, errorCode: "MISSING_UPLOAD_FORMAT" });
  });

  it("a successful upload with a real format is unaffected by the fix — same shape as before", async () => {
    const fetchFn = fetchReturning({ public_id: "naia-selfies/cust_abc", format: "jpg" });
    const result = await uploadSelfieToCloudinary(
      Buffer.from("fake-image-bytes"),
      "image/jpeg",
      "cust_abc",
      fetchFn,
      getConfig,
    );
    expect(result.ok).toBe(true);
  });
});
