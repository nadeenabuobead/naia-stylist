// app/lib/ai/closet-garment-analysis-wiring.test.ts
//
// Exercises the REAL production entry point, analyzeClosetGarment — not
// runClosetGarmentAnalysis with an injected getDownloadUrl. This is the
// function actually called from closet._index.tsx; its own internal
// closure wires buildPrivateDownloadUrl together with whatever Cloudinary
// env vars are set. Only analyzeImage (Anthropic) and prisma (DB) are
// mocked — the URL-building path is real, so a regression that silently
// reintroduces buildSignedDeliveryUrl, or that resurrects a format-guessing
// fallback, would be caught here even though the unit tests in
// closet-garment-analysis.test.ts (which inject getDownloadUrl directly)
// would not catch it.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../db.server.js", () => ({
  default: {
    $transaction: vi.fn(async (fn: any) => fn({
      closetItem: { update: vi.fn().mockResolvedValue(undefined) },
      closetItemAnalysisSnapshot: { create: vi.fn().mockResolvedValue(undefined) },
    })),
    closetItem: { update: vi.fn().mockResolvedValue(undefined) },
  },
}));

vi.mock("./claude.server.js", () => ({ analyzeImage: vi.fn() }));

import prisma from "../../db.server.js";
import { analyzeImage } from "./claude.server.js";
import { analyzeClosetGarment } from "./closet-garment-analysis.server";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CLOUDINARY_CLOUD_NAME = "test-cloud";
  process.env.CLOUDINARY_API_KEY = "test-key";
  process.env.CLOUDINARY_API_SECRET = "test-secret";
});

function validExtractionJson() {
  return JSON.stringify({
    observables: { subcategory: null, silhouette: null, fitProfile: null, hemLength: null, topLength: null, waistShape: null, sleeveLength: null, necklineCoverage: null, shoulderCoverage: null, midriffExposed: null, material: null, pattern: null, primaryColor: null, secondaryColors: [] },
    matchingSignals: { occasions: [], seasons: [], formality: null, styleTags: [], stylePersonality: null },
    fieldConfidence: {},
  });
}

describe("production wiring: analyzeClosetGarment builds a real buildPrivateDownloadUrl URL", () => {
  it("calls Anthropic with a time-limited private-download URL, not the old CDN signed-delivery URL", async () => {
    (analyzeImage as any).mockResolvedValue(validExtractionJson());

    await analyzeClosetGarment({
      closetItemId: "wiring-item-1",
      imagePublicId: "naia-wardrobe/cust_1/garment123",
      category: "TOPS",
      imageFormat: "jpg",
    });

    expect(analyzeImage).toHaveBeenCalledTimes(1);
    const { imageUrl } = (analyzeImage as any).mock.calls[0][0];

    // buildPrivateDownloadUrl's real shape: the Admin "download" API, with a
    // server-controlled expires_at and the format baked in as a query param.
    expect(imageUrl).toContain("https://api.cloudinary.com/v1_1/test-cloud/image/download?");
    expect(imageUrl).toContain("format=jpg");
    expect(imageUrl).toContain("expires_at=");
    expect(imageUrl).toContain("public_id=naia-wardrobe");

    // The old mechanism (buildSignedDeliveryUrl) builds a CDN path under
    // res.cloudinary.com with an s--...-- signature segment — must never
    // appear, since that URL is what the garment-analysis bug report
    // identified as unfetchable by Claude for private assets.
    expect(imageUrl).not.toContain("res.cloudinary.com");
    expect(imageUrl).not.toMatch(/\/s--[^/]+--\//);
  });

  it("preserves the 15-second Anthropic timeout via the same AbortController wiring", async () => {
    (analyzeImage as any).mockResolvedValue(validExtractionJson());

    await analyzeClosetGarment({
      closetItemId: "wiring-item-2",
      imagePublicId: "naia-wardrobe/cust_2/garment456",
      category: "DRESSES",
      imageFormat: "png",
    });

    const { signal } = (analyzeImage as any).mock.calls[0][0];
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(false); // not pre-aborted; timeout is still pending at call time
  });
});

describe("production wiring: nullable imageFormat fails closed without ever reaching Anthropic", () => {
  it("imageFormat: null never calls analyzeImage and writes analysisStatus failed via the real prisma wiring", async () => {
    await analyzeClosetGarment({
      closetItemId: "wiring-item-null",
      imagePublicId: "naia-wardrobe/cust_3/garment789",
      category: "TOPS",
      imageFormat: null,
    });

    expect(analyzeImage).not.toHaveBeenCalled();
    expect((prisma as any).closetItem.update).toHaveBeenCalledTimes(1);
    const [arg] = (prisma as any).closetItem.update.mock.calls[0];
    expect(arg.where).toEqual({ id: "wiring-item-null" });
    expect(arg.data.analysisStatus).toBe("failed");
    // No snapshot write on this path — $transaction (the success path) must
    // never be invoked when format is missing.
    expect((prisma as any).$transaction).not.toHaveBeenCalled();
  });
});
