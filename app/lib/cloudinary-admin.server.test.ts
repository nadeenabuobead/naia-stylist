// app/lib/cloudinary-admin.server.test.ts
//
// Focused coverage for the large-export privacy fix's additions to this
// module: resourceType parameterization on buildPrivateDownloadUrl /
// deleteCloudinaryAsset (both previously hardcoded to "image"), and the new
// uploadCloudinaryRawPrivate function for binary (ZIP) uploads. Every
// pre-existing function's own behavior is left untouched and is not
// re-verified here — only the new surface area.
//
// Also covers the real Attempt B investigation's fix: uploadCloudinaryPrivate
// used to discard the HTTP status entirely on a failed upload, returning a
// bare "PROVIDER_ERROR" that could never later distinguish a 404/401/403/
// 429/5xx. No live Cloudinary call of any kind.
//
// Run: npx vitest run app/lib/cloudinary-admin.server.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildPrivateDownloadUrl,
  deleteCloudinaryAsset,
  uploadCloudinaryRawPrivate,
  uploadCloudinaryPrivate,
  createChunkedRawUploader,
  CHUNK_SIZE_BYTES,
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

describe("createChunkedRawUploader — bounded-memory streaming upload", () => {
  const fetchMock = vi.fn();
  beforeEach(() => fetchMock.mockReset());

  function okResponse(body: Record<string, unknown> = {}) {
    return { ok: true, json: async () => body };
  }

  it("never sends a chunk until CHUNK_SIZE_BYTES has accumulated — several small writes stay buffered", async () => {
    const uploader = createChunkedRawUploader("pub-id", "f.zip", "private", { _fetch: fetchMock as any, _getConfig: () => CONFIG });
    await uploader.write(Buffer.alloc(1024));
    await uploader.write(Buffer.alloc(1024));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("flushes exactly one chunk of CHUNK_SIZE_BYTES as soon as the threshold is crossed, keeping the remainder buffered", async () => {
    fetchMock.mockResolvedValueOnce(okResponse());
    const uploader = createChunkedRawUploader("pub-id", "f.zip", "private", { _fetch: fetchMock as any, _getConfig: () => CONFIG });

    const overCeiling = Buffer.alloc(CHUNK_SIZE_BYTES + 1000);
    await uploader.write(overCeiling);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers["Content-Range"]).toBe(`bytes 0-${CHUNK_SIZE_BYTES - 1}/-1`);
    const sentFile = (init.body as FormData).get("file") as File;
    expect(sentFile.size).toBe(CHUNK_SIZE_BYTES);
  });

  it("every chunk of the same upload carries the SAME X-Unique-Upload-Id header", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const uploader = createChunkedRawUploader("pub-id", "f.zip", "private", { _fetch: fetchMock as any, _getConfig: () => CONFIG });

    await uploader.write(Buffer.alloc(CHUNK_SIZE_BYTES));
    await uploader.write(Buffer.alloc(CHUNK_SIZE_BYTES));
    await uploader.finish();

    const ids = fetchMock.mock.calls.map((c: any[]) => c[1].headers["X-Unique-Upload-Id"]);
    expect(ids.length).toBe(3);
    expect(new Set(ids).size).toBe(1);
  });

  it("Content-Range start/end advance correctly across consecutive chunks, never overlapping or skipping bytes", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const uploader = createChunkedRawUploader("pub-id", "f.zip", "private", { _fetch: fetchMock as any, _getConfig: () => CONFIG });

    await uploader.write(Buffer.alloc(CHUNK_SIZE_BYTES));
    await uploader.write(Buffer.alloc(CHUNK_SIZE_BYTES));
    await uploader.finish();

    const ranges = fetchMock.mock.calls.map((c: any[]) => c[1].headers["Content-Range"]);
    expect(ranges[0]).toBe(`bytes 0-${CHUNK_SIZE_BYTES - 1}/-1`);
    expect(ranges[1]).toBe(`bytes ${CHUNK_SIZE_BYTES}-${2 * CHUNK_SIZE_BYTES - 1}/-1`);
  });

  it("finish() sends whatever remains as the final chunk, with the real now-known total size", async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ public_id: "naia-exports/cust-1/job-1.zip" }));
    const uploader = createChunkedRawUploader("naia-exports/cust-1/job-1.zip", "f.zip", "private", {
      _fetch: fetchMock as any, _getConfig: () => CONFIG,
    });

    await uploader.write(Buffer.alloc(500));
    const result = await uploader.finish();

    expect(result).toEqual({ ok: true, publicId: "naia-exports/cust-1/job-1.zip" });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers["Content-Range"]).toBe("bytes 0-499/500");
  });

  it("finish() with nothing ever written still sends one valid (empty) final chunk — never skips the upload entirely", async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ public_id: "pub-id" }));
    const uploader = createChunkedRawUploader("pub-id", "f.zip", "private", { _fetch: fetchMock as any, _getConfig: () => CONFIG });

    const result = await uploader.finish();
    expect(result).toEqual({ ok: true, publicId: "pub-id" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a mid-upload PROVIDER_ERROR is surfaced from write(), and no further chunks are ever sent afterward", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({}) });
    const uploader = createChunkedRawUploader("pub-id", "f.zip", "private", { _fetch: fetchMock as any, _getConfig: () => CONFIG });

    const result = await uploader.write(Buffer.alloc(CHUNK_SIZE_BYTES));
    expect(result).toEqual({ ok: false, errorCode: "PROVIDER_ERROR" });

    // A later write/finish must not retry or send anything further — the
    // uploader is permanently failed once one chunk fails.
    fetchMock.mockClear();
    await uploader.write(Buffer.alloc(100));
    const finishResult = await uploader.finish();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(finishResult).toEqual({ ok: false, errorCode: "PROVIDER_ERROR" });
  });

  it("returns NOT_CONFIGURED without calling fetch when Cloudinary config is unavailable", async () => {
    const uploader = createChunkedRawUploader("pub-id", "f.zip", "private", { _fetch: fetchMock as any, _getConfig: () => null });
    const result = await uploader.finish();
    expect(result).toEqual({ ok: false, errorCode: "NOT_CONFIGURED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns NETWORK_ERROR when the chunk's own fetch throws", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNRESET"));
    const uploader = createChunkedRawUploader("pub-id", "f.zip", "private", { _fetch: fetchMock as any, _getConfig: () => CONFIG });
    const result = await uploader.write(Buffer.alloc(CHUNK_SIZE_BYTES));
    expect(result).toEqual({ ok: false, errorCode: "NETWORK_ERROR" });
  });
});

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
