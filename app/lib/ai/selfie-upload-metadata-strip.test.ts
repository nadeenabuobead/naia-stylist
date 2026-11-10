// app/lib/ai/selfie-upload-metadata-strip.test.ts
// Verifies the fl_force_strip fix on selfie-upload.server.ts's OWN,
// independent signature construction (it never calls the shared
// api.cloudinary-signature.jsx endpoint). No network call — _fetch is
// injected, and no real/synthetic image bytes are used.
//
// Run: npx vitest run app/lib/ai/selfie-upload-metadata-strip.test.ts

import { describe, it, expect, vi } from "vitest";
import crypto from "node:crypto";
import { uploadSelfieToCloudinary } from "./selfie-upload.server";

const FAKE_CONFIG = { cloudName: "test-cloud", apiKey: "test-key", apiSecret: "test-secret" };
const getConfig = () => FAKE_CONFIG;

function capturingFetch() {
  let capturedBody: URLSearchParams | null = null;
  const fetchFn = vi.fn(async (_url: any, init: any) => {
    capturedBody = init.body;
    return {
      ok: true,
      json: async () => ({ public_id: "naia-selfies/cust_abc", format: "jpg" }),
    } as any;
  });
  return { fetchFn, getBody: () => capturedBody! };
}

describe("incoming metadata stripping is included correctly", () => {
  it("the actual POST body sent to Cloudinary includes transformation=fl_force_strip", async () => {
    const { fetchFn, getBody } = capturingFetch();
    await uploadSelfieToCloudinary(Buffer.from("fake-image-bytes"), "image/jpeg", "cust_abc", fetchFn, getConfig);
    expect(getBody().get("transformation")).toBe("fl_force_strip");
  });
});

describe("the signature covers every required parameter, including transformation", () => {
  it("the signature in the request body matches an independent recomputation that includes transformation", async () => {
    const { fetchFn, getBody } = capturingFetch();
    await uploadSelfieToCloudinary(Buffer.from("fake-image-bytes"), "image/jpeg", "cust_abc", fetchFn, getConfig);
    const body = getBody();
    const timestamp = body.get("timestamp");
    const publicId = body.get("public_id");

    const expected = crypto.createHash("sha1").update(
      `overwrite=true&public_id=${publicId}&timestamp=${timestamp}&transformation=fl_force_strip&type=private${FAKE_CONFIG.apiSecret}`
    ).digest("hex");

    expect(body.get("signature")).toBe(expected);
  });
});

describe("a client cannot remove the transformation while keeping a valid signature", () => {
  it("a signature recomputed without transformation does not match the real one", async () => {
    const { fetchFn, getBody } = capturingFetch();
    await uploadSelfieToCloudinary(Buffer.from("fake-image-bytes"), "image/jpeg", "cust_abc", fetchFn, getConfig);
    const body = getBody();
    const timestamp = body.get("timestamp");
    const publicId = body.get("public_id");

    const tampered = crypto.createHash("sha1").update(
      `overwrite=true&public_id=${publicId}&timestamp=${timestamp}&type=private${FAKE_CONFIG.apiSecret}`
    ).digest("hex");

    expect(tampered).not.toBe(body.get("signature"));
  });
});

describe("normal upload parameters remain unchanged", () => {
  it("overwrite, public_id prefix, and type are all still present and correct", async () => {
    const { fetchFn, getBody } = capturingFetch();
    await uploadSelfieToCloudinary(Buffer.from("fake-image-bytes"), "image/jpeg", "cust_abc", fetchFn, getConfig);
    const body = getBody();
    expect(body.get("overwrite")).toBe("true");
    expect(body.get("type")).toBe("private");
    expect(body.get("public_id")).toMatch(/cust_abc/);
  });

  it("no resize/crop/quality directive accompanies the strip flag", async () => {
    const { fetchFn, getBody } = capturingFetch();
    await uploadSelfieToCloudinary(Buffer.from("fake-image-bytes"), "image/jpeg", "cust_abc", fetchFn, getConfig);
    expect(getBody().get("transformation")).not.toMatch(/w_|h_|c_|q_/);
  });
});

describe("existing upload behavior remains compatible", () => {
  it("still returns ok:true on a successful provider response, same as before the fix", async () => {
    const { fetchFn } = capturingFetch();
    const result = await uploadSelfieToCloudinary(Buffer.from("fake-image-bytes"), "image/jpeg", "cust_abc", fetchFn, getConfig);
    expect(result.ok).toBe(true);
  });

  it("returns ok:false with PROVIDER_ERROR on a failed provider response, unaffected by the fix", async () => {
    const failingFetch = vi.fn(async () => ({ ok: false } as any));
    const result = await uploadSelfieToCloudinary(Buffer.from("fake-image-bytes"), "image/jpeg", "cust_abc", failingFetch, getConfig);
    expect(result).toEqual({ ok: false, errorCode: "PROVIDER_ERROR" });
  });
});
