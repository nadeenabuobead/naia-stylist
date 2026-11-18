import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("./customer-privacy.server", () => ({
  compileCustomerExport: vi.fn(),
}));

import { compileCustomerExport, type CustomerExport } from "./customer-privacy.server";
import { buildCustomerExportZip, MAX_SYNC_EXPORT_IMAGES } from "./customer-export-zip.server";

function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (c: Buffer) => chunks.push(c));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

// ZIP entries are individually compressed — a raw substring search on the
// archive's bytes only works for filenames (stored uncompressed in the
// local/central headers), never for file CONTENT. These tests genuinely
// unzip via the system `unzip` binary (macOS/Linux dev environment) rather
// than asserting against compressed bytes.
let tmpDir: string;
function writeZipToTmp(buf: Buffer): string {
  tmpDir = mkdtempSync(join(tmpdir(), "naia-export-zip-test-"));
  const path = join(tmpDir, "export.zip");
  writeFileSync(path, buf);
  return path;
}
function listZipEntries(zipPath: string): string[] {
  const out = execFileSync("unzip", ["-Z1", zipPath], { encoding: "utf-8" });
  return out.trim().split("\n").filter(Boolean);
}
function readZipEntry(zipPath: string, entry: string): string {
  return execFileSync("unzip", ["-p", zipPath, entry], { encoding: "utf-8" });
}

function baseExport(overrides: Partial<CustomerExport> = {}): CustomerExport {
  return {
    exportedAt: "2026-11-14T00:00:00.000Z",
    customer: { id: "cust-1" },
    stylePassport: null,
    closet: [],
    wardrobeSnapshots: [],
    styleMeSessions: [],
    buyOrSkipAnalyses: [],
    wardrobeInsights: [],
    savedLooks: [],
    postOutfitReviews: [],
    confidenceScores: [],
    trendReportViews: [],
    stylingEvents: [],
    naiaModel: null,
    virtualTryOnJobs: [],
    recommendationFeedback: [],
    selfieAnalysis: null,
    naiaObservationFeedback: [],
    styleMeOutcomes: [],
    tasteEvidence: [],
    styleTendencies: [],
    personalisedTrendEditUsage: [],
    loginSessions: [],
    identityLinkRequests: [],
    note: "test note",
    ...overrides,
  } as CustomerExport;
}

describe("buildCustomerExportZip", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns not_found when compileCustomerExport returns null", async () => {
    vi.mocked(compileCustomerExport).mockResolvedValueOnce(null);
    const result = await buildCustomerExportZip("cust-1");
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("returns too_large and never fetches any image when the image count exceeds the safeguard", async () => {
    const closet = Array.from({ length: MAX_SYNC_EXPORT_IMAGES + 1 }, (_, i) => ({
      id: `item-${i}`,
      imageFormat: "jpg",
      downloadUrl: `https://example.com/${i}`,
    }));
    vi.mocked(compileCustomerExport).mockResolvedValueOnce(baseExport({ closet }) as any);
    const _fetch = vi.fn();

    const result = await buildCustomerExportZip("cust-1", { _fetch });

    expect(result).toEqual({ ok: false, reason: "too_large", imageCount: MAX_SYNC_EXPORT_IMAGES + 1 });
    expect(_fetch).not.toHaveBeenCalled();
  });

  it("produces a real zip archive containing data.json and every available image, under filenames not signed URLs", async () => {
    vi.mocked(compileCustomerExport).mockResolvedValueOnce(
      baseExport({
        closet: [
          { id: "closet-1", imageFormat: "jpg", downloadUrl: "https://cdn.example/closet-1" } as any,
        ],
        naiaModel: { bodyFormat: "png", bodyDownloadUrl: "https://cdn.example/body" } as any,
        virtualTryOnJobs: [
          { id: "job-1", status: "COMPLETED", downloadUrl: "https://cdn.example/job-1" } as any,
        ],
      }) as any,
    );

    const _fetch = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new TextEncoder().encode("fake-image-bytes").buffer,
    })) as unknown as typeof fetch;

    const result = await buildCustomerExportZip("cust-1", { _fetch });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");

    const zipBuffer = await streamToBuffer(result.stream);
    const zipPath = writeZipToTmp(zipBuffer);
    const entries = listZipEntries(zipPath);

    // Real filenames present inside the archive — not the signed URLs.
    expect(entries).toContain("images/closet/closet-1.jpg");
    expect(entries).toContain("images/model/body-photo.png");
    expect(entries).toContain("images/vto/job-1.png");
    expect(entries).toContain("data.json");

    const json = JSON.parse(readZipEntry(zipPath, "data.json"));
    expect(json.closet[0].filename).toBe("images/closet/closet-1.jpg");
    expect(json.closet[0].downloadUrl).toBeUndefined();
    expect(JSON.stringify(json)).not.toContain("cdn.example");

    expect(_fetch).toHaveBeenCalledTimes(3);
    expect(result.filename).toMatch(/^naia-data-export-\d{4}-\d{2}-\d{2}\.zip$/);
  });

  // 2026-11-18 — archiver 7->8 migration (ZipArchive class, ESM-only):
  // the test above confirms filenames and data.json content survive a
  // real unzip round-trip, but never checks that an appended image's
  // actual BYTES come back unchanged — compression/decompression is
  // exactly where a broken archiver integration could silently corrupt
  // binary content while leaving filenames/JSON untouched. This closes
  // that gap with synthetic (non-real) binary data standing in for a
  // customer photo.
  it("an appended image's bytes round-trip exactly through real zip compression and extraction", async () => {
    // Deterministic pseudo-random bytes, not a real photo — large enough
    // (16 KiB) that a truncation or corruption bug would reliably differ,
    // small enough to stay fast.
    const syntheticImageBytes = Buffer.alloc(16 * 1024);
    for (let i = 0; i < syntheticImageBytes.length; i++) {
      syntheticImageBytes[i] = (i * 2654435761) % 256;
    }

    vi.mocked(compileCustomerExport).mockResolvedValueOnce(
      baseExport({
        closet: [
          { id: "closet-1", imageFormat: "jpg", downloadUrl: "https://cdn.example/closet-1" } as any,
        ],
      }) as any,
    );
    const _fetch = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => syntheticImageBytes.buffer.slice(
        syntheticImageBytes.byteOffset,
        syntheticImageBytes.byteOffset + syntheticImageBytes.byteLength,
      ),
    })) as unknown as typeof fetch;

    const result = await buildCustomerExportZip("cust-1", { _fetch });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");

    const zipBuffer = await streamToBuffer(result.stream);
    const zipPath = writeZipToTmp(zipBuffer);

    const extractedBuffer = execFileSync("unzip", ["-p", zipPath, "images/closet/closet-1.jpg"], {
      maxBuffer: 1024 * 1024,
    });

    expect(extractedBuffer.length).toBe(syntheticImageBytes.length);
    expect(Buffer.compare(extractedBuffer, syntheticImageBytes)).toBe(0);
  });

  it("skips an image whose fetch fails, records it, and still completes the archive", async () => {
    vi.mocked(compileCustomerExport).mockResolvedValueOnce(
      baseExport({
        closet: [
          { id: "closet-ok", imageFormat: "jpg", downloadUrl: "https://cdn.example/ok" } as any,
          { id: "closet-fail", imageFormat: "jpg", downloadUrl: "https://cdn.example/fail" } as any,
        ],
      }) as any,
    );

    const _fetch = vi.fn(async (url: string) => {
      if (String(url).includes("fail")) return { ok: false, arrayBuffer: async () => new ArrayBuffer(0) };
      return { ok: true, arrayBuffer: async () => new TextEncoder().encode("bytes").buffer };
    }) as unknown as typeof fetch;

    const result = await buildCustomerExportZip("cust-1", { _fetch });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");

    const zipBuffer = await streamToBuffer(result.stream);
    const zipPath = writeZipToTmp(zipBuffer);
    const entries = listZipEntries(zipPath);

    // The failed image never becomes a real zip entry...
    expect(entries).toContain("images/closet/closet-ok.jpg");
    expect(entries).not.toContain("images/closet/closet-fail.jpg");

    // ...but it IS recorded in the JSON, so the export is still complete
    // and honest about what didn't make it, rather than failing outright.
    const json = JSON.parse(readZipEntry(zipPath, "data.json"));
    expect(json.imageFetchFailures).toContain("images/closet/closet-fail.jpg");
  });

  it("includes no image entry at all when an item has no downloadUrl (e.g. face/selfie exclusion upstream)", async () => {
    vi.mocked(compileCustomerExport).mockResolvedValueOnce(
      baseExport({
        naiaModel: { bodyFormat: null, bodyDownloadUrl: null } as any,
        selfieAnalysis: { photoPublicId: "naia-wardrobe/cust-1/selfie" } as any,
      }) as any,
    );
    const _fetch = vi.fn();

    const result = await buildCustomerExportZip("cust-1", { _fetch });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");

    const zipBuffer = await streamToBuffer(result.stream);
    const zipPath = writeZipToTmp(zipBuffer);
    const entries = listZipEntries(zipPath);
    expect(entries.some((e) => e.startsWith("images/model/body-photo"))).toBe(false);
    expect(entries.some((e) => e.startsWith("images/"))).toBe(false);
    expect(_fetch).not.toHaveBeenCalled();
  });

  it("an unexpected build failure (not a per-image fetch failure) destroys the stream cleanly — never a silently truncated or hanging archive", async () => {
    // A BigInt anywhere in the export breaks JSON.stringify — this is
    // deliberately NOT a per-image fetch error (those are already caught
    // and recorded); it simulates anything else going wrong while
    // assembling data.json, which must surface as a stream error, not an
    // unhandled rejection or a response that never ends.
    vi.mocked(compileCustomerExport).mockResolvedValueOnce(
      baseExport({ customer: { id: "cust-1", corruptedField: 10n } as any }) as any,
    );
    const _fetch = vi.fn();

    const result = await buildCustomerExportZip("cust-1", { _fetch });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");

    await expect(streamToBuffer(result.stream)).rejects.toThrow();
  });

  it("remaps personalisedTrendEditUsage snapshot imageUrls to the bundled Closet filename, preserving all other snapshot content", async () => {
    vi.mocked(compileCustomerExport).mockResolvedValueOnce(
      baseExport({
        closet: [
          { id: "closet-1", imageFormat: "jpg", downloadUrl: "https://cdn.example/closet-1" } as any,
        ],
        personalisedTrendEditUsage: [
          {
            id: "usage-1",
            reportSlug: "spring-2026",
            periodKey: "2026-11",
            snapshot: {
              schemaVersion: "trend-edit-snapshot-v1",
              reportSlug: "spring-2026",
              reportTitle: "Spring 2026",
              generatedAt: "2026-11-01T00:00:00.000Z",
              edit: {
                subTitle: "Your version",
                evidenceClosetItems: [
                  {
                    name: "Navy Blazer",
                    imageUrl: "https://res.cloudinary.com/signed/closet-1-stale",
                    closetItemId: "closet-1",
                    category: "outerwear",
                    roleNote: "already yours",
                  },
                ],
                routeInItems: [
                  {
                    name: "Navy Blazer",
                    imageUrl: "https://res.cloudinary.com/signed/closet-1-stale",
                    closetItemId: "closet-1",
                    category: "outerwear",
                    roleNote: "route in",
                  },
                ],
                lookToTryItems: [
                  {
                    name: "Deleted Item",
                    imageUrl: "https://res.cloudinary.com/signed/deleted-stale",
                    closetItemId: "closet-deleted",
                    category: "tops",
                    roleNote: "look to try",
                  },
                ],
              },
              nadineRecommendation: { imageUrl: "https://cdn.shopify.com/product.jpg" },
            },
          },
        ],
      }) as any,
    );

    const _fetch = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new TextEncoder().encode("bytes").buffer,
    })) as unknown as typeof fetch;

    const result = await buildCustomerExportZip("cust-1", { _fetch });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");

    const zipBuffer = await streamToBuffer(result.stream);
    const zipPath = writeZipToTmp(zipBuffer);
    const json = JSON.parse(readZipEntry(zipPath, "data.json"));

    const [usage] = json.personalisedTrendEditUsage;
    const [evidenceItem] = usage.snapshot.edit.evidenceClosetItems;
    const [routeInItem] = usage.snapshot.edit.routeInItems;
    const [lookToTryItem] = usage.snapshot.edit.lookToTryItems;

    // Items whose closetItemId is still bundled point at the local filename...
    expect(evidenceItem.imageUrl).toBe("images/closet/closet-1.jpg");
    expect(routeInItem.imageUrl).toBe("images/closet/closet-1.jpg");
    // ...an item whose Closet item no longer exists (nothing bundled under
    // that id) gets null, never the stale dead link...
    expect(lookToTryItem.imageUrl).toBeNull();
    // ...a product-catalog image (not a customer photo, nothing bundled for
    // it) is untouched — it was never a Closet-photo duplicate to begin with.
    expect(usage.snapshot.nadineRecommendation.imageUrl).toBe("https://cdn.shopify.com/product.jpg");

    // Every other field on the snapshot/items is preserved exactly.
    expect(evidenceItem.name).toBe("Navy Blazer");
    expect(evidenceItem.category).toBe("outerwear");
    expect(evidenceItem.roleNote).toBe("already yours");
    expect(evidenceItem.closetItemId).toBe("closet-1");
    expect(usage.snapshot.reportTitle).toBe("Spring 2026");
    expect(usage.snapshot.edit.subTitle).toBe("Your version");

    // No stale signed Cloudinary link survives anywhere in the export.
    expect(JSON.stringify(json)).not.toContain("res.cloudinary.com/signed");
  });

  it("leaves personalisedTrendEditUsage rows with no snapshot (legacy/no-snapshot rows) completely untouched", async () => {
    vi.mocked(compileCustomerExport).mockResolvedValueOnce(
      baseExport({
        personalisedTrendEditUsage: [
          { id: "usage-legacy", reportSlug: "old-report", periodKey: "2026-01", snapshot: null },
        ],
      }) as any,
    );

    const result = await buildCustomerExportZip("cust-1", { _fetch: vi.fn() });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");

    const zipBuffer = await streamToBuffer(result.stream);
    const zipPath = writeZipToTmp(zipBuffer);
    const json = JSON.parse(readZipEntry(zipPath, "data.json"));
    expect(json.personalisedTrendEditUsage).toEqual([
      { id: "usage-legacy", reportSlug: "old-report", periodKey: "2026-01", snapshot: null },
    ]);
  });

  it("describes the ZIP's actual bundled-files behaviour in its note, not the JSON-only export's expiring-link wording", async () => {
    vi.mocked(compileCustomerExport).mockResolvedValueOnce(
      baseExport({ note: "This export's images expire shortly after generation — download them separately." }) as any,
    );

    const result = await buildCustomerExportZip("cust-1", { _fetch: vi.fn() });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");

    const zipBuffer = await streamToBuffer(result.stream);
    const zipPath = writeZipToTmp(zipBuffer);
    const json = JSON.parse(readZipEntry(zipPath, "data.json"));

    expect(json.note).not.toContain("expire");
    expect(json.note).not.toContain("download them separately");
    expect(json.note).toContain("included as actual image files in this archive");
  });

  it("contains no auth tokens, credentials, or internal secrets anywhere in the ZIP's data.json", async () => {
    vi.mocked(compileCustomerExport).mockResolvedValueOnce(
      baseExport({
        loginSessions: [
          { id: "sess-1", createdAt: "2026-11-01T00:00:00.000Z", lastSeenAt: null, expiresAt: null, userAgent: "test-agent" },
        ],
        identityLinkRequests: [
          { id: "link-1", email: "shopper@example.com", attemptCount: 1, expiresAt: null, confirmedAt: null, createdAt: "2026-11-01T00:00:00.000Z" },
        ],
      }) as any,
    );

    const result = await buildCustomerExportZip("cust-1", { _fetch: vi.fn() });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");

    const zipBuffer = await streamToBuffer(result.stream);
    const zipPath = writeZipToTmp(zipBuffer);
    const json = JSON.parse(readZipEntry(zipPath, "data.json"));

    // loginSessions/identityLinkRequests already come pre-scrubbed out of
    // compileCustomerExport (see customer-privacy.server.ts) — this proves
    // the ZIP path doesn't reintroduce anything beyond what it was given.
    const raw = JSON.stringify(json);
    for (const forbidden of ["sessionTokenHash", "idToken", "oneTimeCodeHash", "password", "secret", "Bearer "]) {
      expect(raw).not.toContain(forbidden);
    }
    expect(json.loginSessions[0]).toEqual({
      id: "sess-1", createdAt: "2026-11-01T00:00:00.000Z", lastSeenAt: null, expiresAt: null, userAgent: "test-agent",
    });
  });

  it("cross-customer isolation: the exact customerId passed in is the only one ever queried — never widened, never a second customer's id", async () => {
    vi.mocked(compileCustomerExport).mockResolvedValueOnce(baseExport() as any);
    await buildCustomerExportZip("cust-A", { _fetch: vi.fn() });

    expect(compileCustomerExport).toHaveBeenCalledTimes(1);
    expect(compileCustomerExport).toHaveBeenCalledWith("cust-A");
    // Never called with anything else — e.g. no accidental second lookup,
    // no customerId derived from elsewhere. compileCustomerExport's own
    // test suite (customer-privacy.test.ts) separately proves its Prisma
    // query is scoped by this exact id — this test proves the ZIP builder
    // never substitutes, widens, or duplicates that id.
    expect(vi.mocked(compileCustomerExport).mock.calls).toEqual([["cust-A"]]);
  });
});
