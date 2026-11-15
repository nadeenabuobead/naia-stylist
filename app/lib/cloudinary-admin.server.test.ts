// app/lib/cloudinary-admin.server.test.ts
//
// Focused coverage for the large-export privacy fix's additions to this
// module: resourceType parameterization on buildPrivateDownloadUrl /
// deleteCloudinaryAsset (both previously hardcoded to "image"), and the new
// uploadCloudinaryRawPrivate function for binary (ZIP) uploads. Every
// pre-existing function's own behavior is left untouched and is not
// re-verified here — only the new surface area.
//
// Run: npx vitest run app/lib/cloudinary-admin.server.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildPrivateDownloadUrl,
  deleteCloudinaryAsset,
  uploadCloudinaryRawPrivate,
  type CloudinaryConfig,
} from "./cloudinary-admin.server";

const CONFIG: CloudinaryConfig = { cloudName: "test-cloud", apiKey: "test-key", apiSecret: "test-secret" };

describe("buildPrivateDownloadUrl — resourceType parameterization", () => {
  it("defaults to the image download endpoint — unchanged for every existing caller", () => {
    const url = buildPrivateDownloadUrl(CONFIG, "naia-tryon/cust-1/job-1", "png", "private", () => 0);
    expect(url).toContain("/test-cloud/image/download?");
  });

  it("uses the raw download endpoint when resourceType: 'raw' is passed", () => {
    const url = buildPrivateDownloadUrl(CONFIG, "naia-exports/cust-1/job-1.zip", "zip", "private", () => 0, 600, undefined, "raw");
    expect(url).toContain("/test-cloud/raw/download?");
    expect(url).not.toContain("/image/download");
  });

  it("resourceType never appears in or changes the signature — it is a URL-path detail only", () => {
    const nowFn = () => 0;
    const imageUrl = buildPrivateDownloadUrl(CONFIG, "same-id", "zip", "private", nowFn, 600);
    const rawUrl = buildPrivateDownloadUrl(CONFIG, "same-id", "zip", "private", nowFn, 600, undefined, "raw");
    const imageSig = new URL(imageUrl).searchParams.get("signature");
    const rawSig = new URL(rawUrl).searchParams.get("signature");
    expect(imageSig).toBe(rawSig);
  });
});

describe("deleteCloudinaryAsset — resourceType parameterization", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ result: "ok" }) });
  });

  it("defaults to the image destroy endpoint — unchanged for every existing caller", async () => {
    await deleteCloudinaryAsset("naia-wardrobe/cust-1/item", "private", fetchMock as any, () => CONFIG);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/test-cloud/image/destroy"),
      expect.anything(),
    );
  });

  it("uses the raw destroy endpoint when resourceType: 'raw' is passed", async () => {
    await deleteCloudinaryAsset("naia-exports/cust-1/job-1.zip", "private", fetchMock as any, () => CONFIG, "raw");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/test-cloud/raw/destroy"),
      expect.anything(),
    );
  });

  it("'not found' from Cloudinary is still treated as a successful deletion for a raw asset, same as for images", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ result: "not found" }) });
    const result = await deleteCloudinaryAsset("naia-exports/cust-1/job-1.zip", "private", fetchMock as any, () => CONFIG, "raw");
    expect(result).toEqual({ ok: true });
  });
});

describe("uploadCloudinaryRawPrivate", () => {
  const fetchMock = vi.fn();
  beforeEach(() => fetchMock.mockReset());

  it("posts to the raw upload endpoint with the file as multipart form data, and returns ok+publicId on success", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ public_id: "naia-exports/cust-1/job-1.zip" }) });

    const result = await uploadCloudinaryRawPrivate(
      "naia-exports/cust-1/job-1.zip",
      Buffer.from("fake-zip-bytes"),
      "naia-data-export-job-1.zip",
      "private",
      fetchMock as any,
      () => CONFIG,
    );

    expect(result).toEqual({ ok: true, publicId: "naia-exports/cust-1/job-1.zip" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/test-cloud/raw/upload");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get("public_id")).toBe("naia-exports/cust-1/job-1.zip");
    expect((init.body as FormData).get("type")).toBe("private");
    const file = (init.body as FormData).get("file") as File;
    expect(file).toBeTruthy();
    expect(file.name).toBe("naia-data-export-job-1.zip");
  });

  it("returns NOT_CONFIGURED without calling fetch when Cloudinary config is unavailable", async () => {
    const result = await uploadCloudinaryRawPrivate(
      "pub-id", Buffer.from("x"), "f.zip", "private", fetchMock as any, () => null,
    );
    expect(result).toEqual({ ok: false, errorCode: "NOT_CONFIGURED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns PROVIDER_ERROR when the HTTP response itself is not ok", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({}) });
    const result = await uploadCloudinaryRawPrivate(
      "pub-id", Buffer.from("x"), "f.zip", "private", fetchMock as any, () => CONFIG,
    );
    expect(result).toEqual({ ok: false, errorCode: "PROVIDER_ERROR" });
  });

  it("returns PROVIDER_REJECTED when Cloudinary's own response body carries an error", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ error: { message: "bad request" } }) });
    const result = await uploadCloudinaryRawPrivate(
      "pub-id", Buffer.from("x"), "f.zip", "private", fetchMock as any, () => CONFIG,
    );
    expect(result).toEqual({ ok: false, errorCode: "PROVIDER_REJECTED" });
  });

  it("returns NETWORK_ERROR when fetch itself throws", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNRESET"));
    const result = await uploadCloudinaryRawPrivate(
      "pub-id", Buffer.from("x"), "f.zip", "private", fetchMock as any, () => CONFIG,
    );
    expect(result).toEqual({ ok: false, errorCode: "NETWORK_ERROR" });
  });
});
