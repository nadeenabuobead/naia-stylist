// app/lib/ai/closet-preview-analysis.server.test.ts
// Unit tests for the closet preview analysis module.
//
// Uses static source-code assertions and inline logic tests — no real Claude
// calls and no Cloudinary calls, matching the pattern used throughout this codebase.
//
// Run with: node --test --import tsx/esm app/lib/ai/closet-preview-analysis.server.test.ts

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "closet-preview-analysis.server.ts"), "utf8");

// ── Static module contract tests ──────────────────────────────────────────────

describe("previewAnalyzeGarment: module contracts", () => {
  it("exports previewAnalyzeGarment", () => {
    assert.ok(src.includes("export async function previewAnalyzeGarment"), "must export previewAnalyzeGarment");
  });

  it("accepts downloadUrl parameter (not publicId) — private assets need authenticated API URL, not CDN URL", () => {
    // previewAnalyzeGarment must receive the pre-built authenticated download URL from the
    // endpoint. It must NOT build its own CDN URL — private Cloudinary assets cannot be
    // fetched by Claude via res.cloudinary.com/…/private/… (CDN does not serve private type).
    assert.ok(
      src.includes("downloadUrl: string"),
      "function signature must accept downloadUrl: string, not publicId",
    );
    assert.ok(
      !src.includes("buildSignedDeliveryUrl"),
      "must NOT use buildSignedDeliveryUrl — CDN URLs cannot serve private assets",
    );
  });

  it("does not call getCloudinaryConfig — URL is built by the caller", () => {
    // The endpoint builds downloadUrl at step 5 and passes it through; this module
    // no longer needs Cloudinary config.
    assert.ok(
      !src.includes("getCloudinaryConfig"),
      "must NOT call getCloudinaryConfig — the caller owns URL construction",
    );
  });

  it("uses a timeout to bound analysis duration", () => {
    assert.ok(src.includes("AbortController"), "must use AbortController for timeout");
    assert.ok(src.includes("PREVIEW_TIMEOUT_MS"), "must use a named timeout constant");
  });

  it("returns null on any error (catch block)", () => {
    const catchIdx = src.indexOf("} catch {");
    assert.ok(catchIdx !== -1, "must have a catch block");
    const catchBlock = src.slice(catchIdx, catchIdx + 80);
    assert.ok(catchBlock.includes("return null"), "catch block must return null to signal failure");
  });

  it("constructs summaryLine from non-null parts", () => {
    assert.ok(
      src.includes('summaryLine') && src.includes('join(" · ")'),
      "must construct summaryLine with · separator",
    );
    assert.ok(src.includes(".filter(Boolean)"), "must filter null parts before joining");
  });

  it("strips markdown fences from Claude response", () => {
    assert.ok(src.includes("replace(/^```"), "must strip leading markdown fences from Claude response");
  });

  it("normalises category to uppercase", () => {
    assert.ok(src.includes(".toUpperCase()"), "normalizeCategory must uppercase the input");
  });

  it("normalises pattern using GARMENT_PATTERN_VALUES", () => {
    assert.ok(src.includes("GARMENT_PATTERN_VALUES"), "must import and use GARMENT_PATTERN_VALUES for pattern normalisation");
  });

  it("normalises occasions using GARMENT_OCCASION_VALUES", () => {
    assert.ok(src.includes("GARMENT_OCCASION_VALUES"), "must import and use GARMENT_OCCASION_VALUES for occasion normalisation");
  });

  it("normalises seasons using GARMENT_SEASON_VALUES", () => {
    assert.ok(src.includes("GARMENT_SEASON_VALUES"), "must import and use GARMENT_SEASON_VALUES for season normalisation");
  });
});

// ── Inline logic tests (no imports needed) ────────────────────────────────────

describe("summaryLine construction logic", () => {
  function buildSummaryLine(primaryColor: string | null, subcategory: string | null, structureHint: string | null): string {
    return [primaryColor, subcategory, structureHint].filter(Boolean).join(" · ");
  }

  it("joins all three parts", () => assert.equal(buildSummaryLine("Black", "blazer", "tailored"), "Black · blazer · tailored"));
  it("skips null parts", () => assert.equal(buildSummaryLine("Ivory", null, "relaxed"), "Ivory · relaxed"));
  it("handles all null", () => assert.equal(buildSummaryLine(null, null, null), ""));
  it("handles single part", () => assert.equal(buildSummaryLine("Navy", null, null), "Navy"));
});

describe("category normalisation", () => {
  const VALID = new Set(["TOPS", "BOTTOMS", "DRESSES", "OUTERWEAR", "SHOES", "BAGS",
    "ACCESSORIES", "JEWELRY", "ACTIVEWEAR", "SWIMWEAR", "LOUNGEWEAR", "OTHER"]);

  function normalize(raw: unknown): string | null {
    if (typeof raw !== "string") return null;
    const upper = raw.trim().toUpperCase();
    return VALID.has(upper) ? upper : null;
  }

  it("accepts valid uppercase", () => assert.equal(normalize("TOPS"), "TOPS"));
  it("normalises lowercase to uppercase", () => assert.equal(normalize("outerwear"), "OUTERWEAR"));
  it("rejects unknown", () => assert.equal(normalize("HATS"), null));
  it("rejects null", () => assert.equal(normalize(null), null));
  it("rejects number", () => assert.equal(normalize(42), null));
});

describe("pattern normalisation", () => {
  const VALID = new Set(["solid", "stripes", "floral", "geometric", "animal-print",
    "check", "plaid", "abstract", "polka-dot", "houndstooth", "paisley", "graphic"]);

  function normalize(raw: unknown): string | null {
    if (typeof raw !== "string") return null;
    const lower = raw.trim().toLowerCase();
    return VALID.has(lower) ? lower : null;
  }

  it("accepts 'solid'", () => assert.equal(normalize("solid"), "solid"));
  it("normalises casing", () => assert.equal(normalize("Solid"), "solid"));
  it("accepts 'animal-print'", () => assert.equal(normalize("animal-print"), "animal-print"));
  it("rejects unknown", () => assert.equal(normalize("tie-dye"), null));
  it("rejects non-string", () => assert.equal(normalize(null), null));
});

describe("structureHint normalisation", () => {
  const VALID = new Set(["tailored", "structured", "relaxed", "flowy", "casual", "fitted", "oversized"]);

  function normalize(raw: unknown): string | null {
    if (typeof raw !== "string") return null;
    const lower = raw.trim().toLowerCase();
    if (lower === "n/a" || lower === "null") return null;
    return VALID.has(lower) ? lower : null;
  }

  it("accepts 'tailored'", () => assert.equal(normalize("tailored"), "tailored"));
  it("accepts 'oversized'", () => assert.equal(normalize("oversized"), "oversized"));
  it("treats n/a as null", () => assert.equal(normalize("n/a"), null));
  it("rejects 'boxy'", () => assert.equal(normalize("boxy"), null));
});

describe("string array normalisation against vocab", () => {
  const VOCAB = new Set(["work", "casual", "weekend", "evening", "date-night"]);

  function normalize(raw: unknown, vocab: Set<string>): string[] {
    if (!Array.isArray(raw)) return [];
    return (raw as unknown[]).filter((v): v is string => typeof v === "string" && vocab.has(v));
  }

  it("returns matching elements", () => assert.deepEqual(normalize(["work", "casual"], VOCAB), ["work", "casual"]));
  it("filters unknown", () => assert.deepEqual(normalize(["work", "party"], VOCAB), ["work"]));
  it("returns empty for non-array", () => assert.deepEqual(normalize("work", VOCAB), []));
  it("returns empty for null", () => assert.deepEqual(normalize(null, VOCAB), []));
});
