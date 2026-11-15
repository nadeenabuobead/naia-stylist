// app/lib/cloudinary-admin.server.test.ts
//
// Focused coverage for the real Attempt B investigation's fix:
// uploadCloudinaryPrivate used to discard the HTTP status entirely on a
// failed upload, returning a bare "PROVIDER_ERROR" that could never later
// distinguish a 404/401/403/429/5xx. No live Cloudinary call of any kind.
//
// Run: npx vitest run app/lib/cloudinary-admin.server.test.ts

import { describe, it, expect, vi } from "vitest";
import { uploadCloudinaryPrivate, type CloudinaryConfig } from "./cloudinary-admin.server";

const CONFIG: CloudinaryConfig = { cloudName: "test-cloud", apiKey: "test-key", apiSecret: "test-secret" };

describe("uploadCloudinaryPrivate — error detail", () => {
  it("REGRESSION — preserves the real HTTP status in errorCode instead of a bare PROVIDER_ERROR, so a 404 is distinguishable from a 401/403/429/5xx after the fact", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({}) });
    const result = await uploadCloudinaryPrivate(
      "naia-tryon/cust-1/job-1", "data:image/png;base64,abc", "private", fetchMock as any, () => CONFIG,
    );
    expect(result).toEqual({ ok: false, errorCode: "PROVIDER_ERROR_403" });
  });

  it("a different status code produces a different errorCode", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });
    const result = await uploadCloudinaryPrivate(
      "naia-tryon/cust-1/job-1", "data:image/png;base64,abc", "private", fetchMock as any, () => CONFIG,
    );
    expect(result).toEqual({ ok: false, errorCode: "PROVIDER_ERROR_429" });
  });

  it("success path and NOT_CONFIGURED/NETWORK_ERROR paths are unaffected by the error-detail change", async () => {
    const okFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ public_id: "pub-1", format: "png", version: 1 }) });
    const okResult = await uploadCloudinaryPrivate("pub-1", "data:image/png;base64,x", "private", okFetch as any, () => CONFIG);
    expect(okResult).toEqual({ ok: true, publicId: "pub-1", format: "png", version: "1" });

    const notConfigured = await uploadCloudinaryPrivate("pub-1", "data:image/png;base64,x", "private", vi.fn() as any, () => null);
    expect(notConfigured).toEqual({ ok: false, errorCode: "NOT_CONFIGURED" });

    const throwingFetch = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    const networkError = await uploadCloudinaryPrivate("pub-1", "data:image/png;base64,x", "private", throwingFetch as any, () => CONFIG);
    expect(networkError).toEqual({ ok: false, errorCode: "NETWORK_ERROR" });
  });
});
