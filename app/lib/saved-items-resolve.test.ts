// app/lib/saved-items-resolve.test.ts
//
// Pure resolver tests. No DB — the report is handed in directly, exactly as
// resolveSaveTarget's .server wrapper does after loading it.
//
// getProductByHandle is mocked: this file does not need the real NADINE
// catalog, only to prove PRODUCT resolution reads from whatever handle
// lookup is wired in.

import { describe, it, expect, vi } from "vitest";

vi.mock("./ai/naia-catalog", () => ({
  getProductByHandle: (handle: string) =>
    handle === "navy-blazer"
      ? {
          handle: "navy-blazer",
          parsed: {
            identity: { verifiedTitle: "Navy Blazer", featuredImageUrl: "https://cdn/navy.jpg" },
            prose: { stylingRole: "A tailored anchor" },
          },
        }
      : undefined,
}));

import { resolveSaveTargetFromReport } from "./saved-items-resolve";
import type { TrendReportData } from "./trend-reports";

const REPORT: TrendReportData = {
  slug: "spring-2026-soft-structure",
  title: "Spring 2026 Wardrobe Edit: Soft Structure",
  season: "Spring 2026",
  publishedAt: "2026-06-30",
  summary: "s",
  editorialIntro: "i",
  keyTrends: [{ name: "Softened Tailoring", description: "A longline blazer." }],
  rising: [{ signal: "Wide-leg trousers", why: "Comfort without losing shape", source: "Vogue" }],
  fading: [{ signal: "Skin-tight silhouettes", why: "Fatigue with body-con cuts", source: "WWD" }],
  referencesBehindThisEdit: [
    { brand: "Loro Piana", collection: "SS26", signal: "Soft tailoring throughout", naiaRead: "A controlled drape." },
  ],
  sources: [],
  published: true,
};

describe("resolveSaveTargetFromReport — TREND/SIGNAL/REFERENCE", () => {
  it("resolves a TREND whose contentKey matches slugify(entry.name) right now", () => {
    const result = resolveSaveTargetFromReport(
      { contentType: "TREND", contentKey: "softened-tailoring", reportSlug: REPORT.slug },
      REPORT,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.request.label).toBe("Softened Tailoring");
      expect(result.request.reportSlug).toBe(REPORT.slug);
      expect(result.request.sourcePath).toBe(`/trends/${REPORT.slug}`);
    }
  });

  it("resolves a SIGNAL from either rising or fading — contentType SIGNAL searches both", () => {
    const rising = resolveSaveTargetFromReport(
      { contentType: "SIGNAL", contentKey: "wide-leg-trousers", reportSlug: REPORT.slug },
      REPORT,
    );
    const fading = resolveSaveTargetFromReport(
      { contentType: "SIGNAL", contentKey: "skin-tight-silhouettes", reportSlug: REPORT.slug },
      REPORT,
    );
    expect(rising.ok).toBe(true);
    expect(fading.ok).toBe(true);
  });

  it("resolves a REFERENCE by brand + collection", () => {
    const result = resolveSaveTargetFromReport(
      { contentType: "REFERENCE", contentKey: "loro-piana-ss26", reportSlug: REPORT.slug },
      REPORT,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.request.label).toBe("Loro Piana — SS26");
  });

  it("a contentKey that matches nothing in the CURRENT report is content_not_found — not trusted from the client", () => {
    const result = resolveSaveTargetFromReport(
      { contentType: "TREND", contentKey: "a-trend-that-was-removed", reportSlug: REPORT.slug },
      REPORT,
    );
    expect(result).toEqual({ ok: false, reason: "content_not_found" });
  });

  it("report_not_found when the report itself does not resolve", () => {
    const result = resolveSaveTargetFromReport(
      { contentType: "TREND", contentKey: "softened-tailoring", reportSlug: "does-not-exist" },
      null,
    );
    expect(result).toEqual({ ok: false, reason: "report_not_found" });
  });
});

describe("resolveSaveTargetFromReport — PRODUCT (global, keyed by NADINE handle)", () => {
  it("resolves from the catalog handle, independent of any report", () => {
    const result = resolveSaveTargetFromReport({ contentType: "PRODUCT", contentKey: "navy-blazer" }, null);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.request.reportSlug).toBeNull();
      expect(result.request.label).toBe("Navy Blazer");
    }
  });

  it("content_not_found for a handle the catalog does not have", () => {
    const result = resolveSaveTargetFromReport({ contentType: "PRODUCT", contentKey: "no-such-handle" }, null);
    expect(result).toEqual({ ok: false, reason: "content_not_found" });
  });
});

describe("resolveSaveTargetFromReport — TAKEAWAY", () => {
  it("resolves the two sections that carry a Save control", () => {
    const routeIn = resolveSaveTargetFromReport(
      { contentType: "TAKEAWAY", contentKey: "yourBestRouteIn", reportSlug: REPORT.slug },
      REPORT,
      { takeawayText: "Start with the blazer you already own." },
    );
    expect(routeIn.ok).toBe(true);
    if (routeIn.ok) expect(routeIn.request.sublabel).toBe("Start with the blazer you already own.");

    const lookToTry = resolveSaveTargetFromReport(
      { contentType: "TAKEAWAY", contentKey: "aLookToTry", reportSlug: REPORT.slug },
      REPORT,
    );
    expect(lookToTry.ok).toBe(true);
  });

  it("a reserved-but-unwired section (e.g. partToTake) is unsupported, not content_not_found", () => {
    const result = resolveSaveTargetFromReport(
      { contentType: "TAKEAWAY", contentKey: "partToTake", reportSlug: REPORT.slug },
      REPORT,
    );
    expect(result).toEqual({ ok: false, reason: "unsupported" });
  });

  it("a section key outside the fixed 11 is content_not_found", () => {
    const result = resolveSaveTargetFromReport(
      { contentType: "TAKEAWAY", contentKey: "madeUpSection", reportSlug: REPORT.slug },
      REPORT,
    );
    expect(result).toEqual({ ok: false, reason: "content_not_found" });
  });
});
