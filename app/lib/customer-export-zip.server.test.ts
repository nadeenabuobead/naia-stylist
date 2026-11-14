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
});
