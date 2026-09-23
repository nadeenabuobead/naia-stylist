// app/lib/saved-items-resolve.test.ts
//
// The save endpoint accepts identifiers from the browser and nothing else.
// These tests pin the two things that depend on: a tampered payload cannot
// write arbitrary copy into a Saved card, and the provenance on the card is
// read from the report rather than from whatever the DOM said at click time.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { resolveSaveTargetFromReport } from "./saved-items-resolve.ts";
import type { TrendReportData } from "./trend-reports.ts";

const TREND_ID = "tc_aaaaaaaaaaaa";
const RISING_ID = "tc_bbbbbbbbbbbb";
const REF_ID = "tc_cccccccccccc";

const REPORT = {
  id: "cmq8f2k1a0000ab12cd34ef56",
  slug: "autumn-edit-2026",
  title: "Autumn Edit",
  season: "September 2026",
  publishedAt: "2026-09-01",
  summary: "s",
  editorialIntro: "e",
  keyTrends: [{ id: TREND_ID, name: "Suede Textures", description: "Suede returns as a surface." }],
  rising: [{ id: RISING_ID, signal: "Relaxed tailoring", why: "Softer shoulders", source: "Vogue" }],
  fading: [],
  referencesBehindThisEdit: [
    { id: REF_ID, brand: "The Row", collection: "AW26", signal: "Soft leather", naiaRead: "Quiet structure" },
  ],
  sources: [],
  published: true,
} as unknown as TrendReportData;

// ── §SR-1 report content ──────────────────────────────────────────────────────

describe("§SR-1 resolving report content", () => {
  it("reads a trend's label and description from the report, not the client", () => {
    const result = resolveSaveTargetFromReport({ contentType: "TREND", contentId: TREND_ID, reportSlug: REPORT.slug }, REPORT);
    assert.ok(result.ok);
    assert.equal(result.request.label, "Suede Textures");
    assert.equal(result.request.sublabel, "Suede returns as a surface.");
    assert.equal(result.request.reportId, REPORT.id);
  });

  it("carries structured provenance — never parsed from display copy later", () => {
    const result = resolveSaveTargetFromReport({ contentType: "TREND", contentId: TREND_ID, reportSlug: REPORT.slug }, REPORT);
    assert.ok(result.ok);
    assert.equal(result.request.sourceKind, "TREND_REPORT");
    assert.equal(result.request.sourceReportTitle, "Autumn Edit");
    assert.equal(result.request.sourceSeason, "September 2026");
    assert.equal(result.request.sourcePath, "/trends/autumn-edit-2026");
  });

  it("resolves a rising signal", () => {
    const result = resolveSaveTargetFromReport({ contentType: "SIGNAL", contentId: RISING_ID, reportSlug: REPORT.slug }, REPORT);
    assert.ok(result.ok);
    assert.equal(result.request.label, "Relaxed tailoring");
    assert.equal(result.request.sublabel, "Softer shoulders");
  });

  it("resolves a reference as brand — collection", () => {
    const result = resolveSaveTargetFromReport({ contentType: "REFERENCE", contentId: REF_ID, reportSlug: REPORT.slug }, REPORT);
    assert.ok(result.ok);
    assert.equal(result.request.label, "The Row — AW26");
    assert.equal(result.request.sublabel, "Soft leather");
  });

  it("refuses a content id that is not in this report", () => {
    const result = resolveSaveTargetFromReport({ contentType: "TREND", contentId: "tc_ffffffffffff", reportSlug: REPORT.slug }, REPORT);
    assert.equal(result.ok, false);
    assert.equal((result as { reason: string }).reason, "content_not_found");
  });

  it("refuses a TYPE MISMATCH — a signal id cannot be saved as a trend", () => {
    // Without this, a crafted payload could file a signal under the wrong type.
    const result = resolveSaveTargetFromReport({ contentType: "TREND", contentId: RISING_ID, reportSlug: REPORT.slug }, REPORT);
    assert.equal(result.ok, false);
    assert.equal((result as { reason: string }).reason, "content_not_found");
  });

  it("refuses a malformed content id", () => {
    const result = resolveSaveTargetFromReport({ contentType: "TREND", contentId: "../../etc/passwd", reportSlug: REPORT.slug }, REPORT);
    assert.equal(result.ok, false);
  });

  it("refuses when the report is missing", () => {
    const result = resolveSaveTargetFromReport({ contentType: "TREND", contentId: TREND_ID, reportSlug: "nope" }, null);
    assert.equal((result as { reason: string }).reason, "report_not_found");
  });

  it("refuses a report with no row id — the refKey would orphan once seeded", () => {
    const unseeded = { ...REPORT, id: undefined } as unknown as TrendReportData;
    const result = resolveSaveTargetFromReport({ contentType: "TREND", contentId: TREND_ID, reportSlug: REPORT.slug }, unseeded);
    assert.equal((result as { reason: string }).reason, "report_not_found");
  });
});

// ── §SR-2 takeaways ───────────────────────────────────────────────────────────

describe("§SR-2 resolving a personalised takeaway", () => {
  it("uses the section key and its fixed customer-facing name", () => {
    const result = resolveSaveTargetFromReport(
      { contentType: "TAKEAWAY", contentId: "aLookToTry", reportSlug: REPORT.slug },
      REPORT,
      { takeawayText: "Your navy blazer + a fluid trouser." },
    );
    assert.ok(result.ok);
    assert.equal(result.request.contentId, "aLookToTry");
    assert.equal(result.request.label, "A look to try");
    assert.equal(result.request.sublabel, "Your navy blazer + a fluid trouser.");
  });

  it("identity is the section, so regenerating the edit keeps the save attached", () => {
    const first = resolveSaveTargetFromReport(
      { contentType: "TAKEAWAY", contentId: "aLookToTry", reportSlug: REPORT.slug }, REPORT, { takeawayText: "First wording." });
    const second = resolveSaveTargetFromReport(
      { contentType: "TAKEAWAY", contentId: "aLookToTry", reportSlug: REPORT.slug }, REPORT, { takeawayText: "Completely different wording." });
    assert.ok(first.ok && second.ok);
    assert.equal(first.request.contentId, second.request.contentId);
  });

  it("refuses a positional bullet id — that identifies a slot, not a thing", () => {
    const result = resolveSaveTargetFromReport(
      { contentType: "TAKEAWAY", contentId: "partToTake:1", reportSlug: REPORT.slug }, REPORT);
    assert.equal(result.ok, false);
  });

  it("refuses an unknown section", () => {
    const result = resolveSaveTargetFromReport(
      { contentType: "TAKEAWAY", contentId: "notASection", reportSlug: REPORT.slug }, REPORT);
    assert.equal(result.ok, false);
  });
});

// ── §SR-3 products ────────────────────────────────────────────────────────────

describe("§SR-3 resolving a NADINE piece", () => {
  it("refuses a handle that is not in the locked catalogue", () => {
    const result = resolveSaveTargetFromReport(
      { contentType: "PRODUCT", contentId: "not-a-real-handle", reportSlug: REPORT.slug }, REPORT);
    assert.equal(result.ok, false);
    assert.equal((result as { reason: string }).reason, "content_not_found");
  });
});

// ── §SR-4 unsupported types ──────────────────────────────────────────────────

describe("§SR-4 scope", () => {
  it("FACET and LOOK are supported by the architecture but have no report affordance yet", () => {
    for (const contentType of ["FACET", "LOOK"] as const) {
      const result = resolveSaveTargetFromReport(
        { contentType, contentId: "material:suede", reportSlug: REPORT.slug }, REPORT);
      assert.equal(result.ok, false);
      assert.equal((result as { reason: string }).reason, "unsupported");
    }
  });
});

// ── §SR-5 the static pre-seed fallback ───────────────────────────────────────
//
// /trends/:slug renders from the static array when no EditorialTrendReport row
// exists. That report has content ids but NO canonical row id, so a refKey built
// against it would name an identity that ceases to exist the moment the table is
// seeded. Nothing on such a page may be saved.

const FALLBACK = { ...REPORT, id: undefined } as unknown as TrendReportData;

describe("§SR-5 no save against a non-canonical report", () => {
  it("refuses a TREND", () => {
    const r = resolveSaveTargetFromReport({ contentType: "TREND", contentId: TREND_ID, reportSlug: REPORT.slug }, FALLBACK);
    assert.equal(r.ok, false);
    assert.equal((r as { reason: string }).reason, "report_not_found");
  });

  it("refuses a SIGNAL", () => {
    const r = resolveSaveTargetFromReport({ contentType: "SIGNAL", contentId: RISING_ID, reportSlug: REPORT.slug }, FALLBACK);
    assert.equal(r.ok, false);
  });

  it("refuses a REFERENCE", () => {
    const r = resolveSaveTargetFromReport({ contentType: "REFERENCE", contentId: REF_ID, reportSlug: REPORT.slug }, FALLBACK);
    assert.equal(r.ok, false);
  });

  it("refuses a TAKEAWAY", () => {
    const r = resolveSaveTargetFromReport(
      { contentType: "TAKEAWAY", contentId: "aLookToTry", reportSlug: REPORT.slug }, FALLBACK, { takeawayText: "x" });
    assert.equal(r.ok, false);
  });

  it("refuses a PRODUCT discovered under a non-canonical report", () => {
    // The product's own identity is global and would be fine. Its PROVENANCE is
    // the problem: sourceContentId would name a throwaway id from the fallback.
    const r = resolveSaveTargetFromReport(
      { contentType: "PRODUCT", contentId: "oversized-blazer", reportSlug: REPORT.slug, sourceContentId: TREND_ID },
      FALLBACK,
    );
    assert.equal(r.ok, false);
    assert.equal((r as { reason: string }).reason, "report_not_found");
  });

  it("never yields a request carrying a slug-derived reportId", () => {
    for (const contentType of ["TREND", "SIGNAL", "REFERENCE", "TAKEAWAY", "PRODUCT"] as const) {
      const r = resolveSaveTargetFromReport(
        { contentType, contentId: contentType === "PRODUCT" ? "oversized-blazer" : TREND_ID, reportSlug: REPORT.slug },
        FALLBACK,
      );
      if (r.ok) {
        assert.notEqual(r.request.reportId, REPORT.slug, `${contentType} used the slug as identity`);
        assert.notEqual(r.request.reportId, "autumn-edit-2026");
      }
    }
  });

  it("still allows a product saved with NO report context — identity is global", () => {
    const r = resolveSaveTargetFromReport({ contentType: "PRODUCT", contentId: "oversized-blazer" }, null);
    // Either accepted with null provenance, or declined because the handle is
    // not in the locked catalogue — never accepted with synthetic provenance.
    if (r.ok) {
      assert.equal(r.request.reportId, null);
      assert.equal(r.request.sourceReportTitle, null);
      assert.equal(r.request.sourceContentId, null);
    }
  });

  it("a canonical report still saves normally — the guard is not over-broad", () => {
    const r = resolveSaveTargetFromReport({ contentType: "TREND", contentId: TREND_ID, reportSlug: REPORT.slug }, REPORT);
    assert.ok(r.ok);
    assert.equal(r.request.reportId, REPORT.id);
  });
});
