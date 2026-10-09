// app/lib/trend-evidence.v1-selection.test.ts
//
// End-to-end proof of the Personalised Trend Edit V1 architecture fix: real
// selection differs by trend, sections select independently instead of
// repeating one shared top-2 slice, Worth Investing In's gap logic still
// works, and the data-boundary guarantees (Passport read-only, usage
// recording untouched, no raw Taste consumption) hold.
//
// Report fixtures deliberately use generic, non-overlapping copy so no
// Closet item accidentally scores via the old text-overlap path — every
// ranking below is driven by structured attribute evidence alone, making
// the proof unambiguous.
//
// Run: node --test --import tsx/esm app/lib/trend-evidence.v1-selection.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { buildShopperEdit } from "./trend-evidence.server.ts";
import type { ShopperEvidenceBundle, ShopperClosetItemEvidence } from "./trend-evidence.server.ts";
import type { TrendReportData } from "./trend-reports.ts";

const TREND_EVIDENCE_SRC = readFileSync(resolve(import.meta.dirname, "trend-evidence.server.ts"), "utf-8");
const ATTRIBUTE_SCORING_SRC = readFileSync(resolve(import.meta.dirname, "trend-evidence-attribute-scoring.server.ts"), "utf-8");

// ── Minimal report fixtures — deliberately generic copy, no overlap with any item's own vocabulary ──

const GENERIC_COPY = {
  editorialIntro: "A considered approach to dressing this season.",
  sources: [] as TrendReportData["sources"],
  keyTrends: [{ name: "Direction", description: "A considered approach to dressing this season." }],
  howToWear: [{ feeling: "For everyday", direction: "Build from pieces that already feel like you." }],
  fading: [],
  investmentNotes: undefined,
  naiaInterpretation: undefined,
  naiaVerdict: undefined,
  wardrobeNote: undefined,
  published: true,
  publishedAt: "2026-06-01",
};

const SOFT_STRUCTURE_REPORT: TrendReportData = {
  slug: "spring-2026-soft-structure",
  title: "Soft Structure",
  season: "Spring 2026",
  summary: "Soft structure summary.",
  ...GENERIC_COPY,
};

const MODERN_TAILORING_REPORT: TrendReportData = {
  slug: "modern-tailoring-spring-2026",
  title: "Modern Tailoring",
  season: "Spring 2026",
  summary: "Modern tailoring summary.",
  ...GENERIC_COPY,
};

const COLOUR_DIRECTION_REPORT: TrendReportData = {
  slug: "spring-2026-colour-direction",
  title: "Colour Direction",
  season: "Spring 2026",
  summary: "Colour direction summary.",
  ...GENERIC_COPY,
};

const BASE_PROFILE = {
  stylePersonalities: ["minimal"],
  favoriteColors: [],
  avoidColors: [],
  lifestyle: [],
  desiredFeeling: null,
  desiredFeelings: [],
  desiredImpression: [],
  fitPreferences: [],
  becoming: [],
  styleSupport: [],
};

function evidence(closetItems: ShopperClosetItemEvidence[]): ShopperEvidenceBundle {
  return {
    hasProfile: true,
    profile: BASE_PROFILE,
    closetItems,
    reviewSignal: { reviewCount: 0, workedTags: [], didntWorkTags: [] },
  };
}

function item(overrides: Partial<ShopperClosetItemEvidence> & { name: string; category: string }): ShopperClosetItemEvidence {
  return {
    imageUrl: null,
    subcategory: null,
    primaryColor: null,
    styleTags: [],
    occasions: [],
    material: null,
    ...overrides,
  };
}

// ── 1-3: trend-specific ranking ─────────────────────────────────────────────

describe("V1 — each report ranks trend-relevant Closet evidence, not generic compatibility", () => {
  it("Colour Direction: a red bag (real accent evidence) is named over an uncoloured, unrelated accessory", () => {
    const closet = [
      item({ name: "Crimson Leather Bag", category: "BAGS", primaryColor: "red" }),
      item({ name: "Plain Phone Case", category: "ACCESSORIES" }), // no colour data at all — must not outrank real evidence
    ];
    const edit = buildShopperEdit(COLOUR_DIRECTION_REPORT, evidence(closet));
    assert.ok(edit.evidenceClosetItems.some((c) => c.name === "Crimson Leather Bag"), "the real accent-colour item is surfaced");
  });

  it("Modern Tailoring: a tailored blazer is named as the anchor over an uncoloured, unstructured accessory", () => {
    const closet = [
      item({ name: "Structured Navy Blazer", category: "OUTERWEAR", fitProfile: "tailored", formality: "business-formal" }),
      item({ name: "Plain Phone Case", category: "ACCESSORIES" }),
    ];
    const edit = buildShopperEdit(MODERN_TAILORING_REPORT, evidence(closet));
    assert.ok(edit.yourBestRouteIn.includes("Structured Navy Blazer"), "the tailored anchor is named in Route In");
  });

  it("Soft Structure: a flowy wrap dress is named as evidence over an uncoloured, unstructured accessory", () => {
    const closet = [
      item({ name: "Flowy Wrap Midi Dress", category: "DRESSES", fitProfile: "flowy", silhouette: "wrap" }),
      item({ name: "Plain Phone Case", category: "ACCESSORIES" }),
    ];
    const edit = buildShopperEdit(SOFT_STRUCTURE_REPORT, evidence(closet));
    assert.ok(edit.yourBestRouteIn.includes("Flowy Wrap Midi Dress"), "the soft-flowing dress is named in Route In");
  });

  it("the SAME Closet produces DIFFERENT top evidence for Modern Tailoring vs. Soft Structure — this is the live-QA regression (same two pieces reused across structurally different reports)", () => {
    const closet = [
      item({ name: "Structured Navy Blazer", category: "OUTERWEAR", fitProfile: "tailored", formality: "business-formal" }),
      item({ name: "Flowy Wrap Midi Skirt", category: "BOTTOMS", fitProfile: "flowy", silhouette: "wrap" }),
    ];
    const tailoringEdit = buildShopperEdit(MODERN_TAILORING_REPORT, evidence(closet));
    const softStructureEdit = buildShopperEdit(SOFT_STRUCTURE_REPORT, evidence(closet));
    // Modern Tailoring's strongest anchor is the blazer (tailored-anchor evidence).
    assert.ok(tailoringEdit.yourBestRouteIn.includes("Structured Navy Blazer"));
    // Soft Structure's strongest anchor is the flowy skirt (soft-flowing evidence) — DIFFERENT from Tailoring's anchor.
    assert.ok(softStructureEdit.yourBestRouteIn.includes("Flowy Wrap Midi Skirt"));
    assert.notEqual(tailoringEdit.yourBestRouteIn, softStructureEdit.yourBestRouteIn);
  });
});

// ── 4: weak-but-compatible items never outrank real evidence ───────────────

describe("V1 — generally-compatible items do not outrank materially better evidence", () => {
  it("Colour Direction: a beanie with no real colour signal does not outrank a trouser with genuine neutral-colour evidence", () => {
    const closet = [
      item({ name: "Ribbed Knit Beanie", category: "ACCESSORIES" }), // category-eligible, zero colour evidence
      item({ name: "Stone Wide-Leg Trouser", category: "BOTTOMS", primaryColor: "stone" }), // real base-neutral evidence
    ];
    const edit = buildShopperEdit(COLOUR_DIRECTION_REPORT, evidence(closet));
    assert.ok(
      edit.yourBestRouteIn.includes("Stone Wide-Leg Trouser"),
      "the item with real colour evidence anchors Route In, not the merely-compatible beanie",
    );
  });
});

// ── 5: sections select independently ────────────────────────────────────────

describe("V1 — different sections select different pieces for different jobs", () => {
  it("Route In and A Look To Try use different supporting pieces when the Closet offers more than one wearable option", () => {
    const closet = [
      item({ name: "Structured Navy Blazer", category: "OUTERWEAR", fitProfile: "tailored", formality: "business-formal" }), // anchor, strongest
      item({ name: "Soft Jersey Top", category: "TOPS", fitProfile: "relaxed", material: "jersey" }), // 2nd-best wearable partner
      item({ name: "Tailored Wide-Leg Trouser", category: "BOTTOMS", fitProfile: "tailored" }), // 3rd-best wearable partner
    ];
    const edit = buildShopperEdit(MODERN_TAILORING_REPORT, evidence(closet));
    assert.ok(edit.yourBestRouteIn.includes("Structured Navy Blazer"), "anchor is the strongest item");
    assert.ok(edit.yourBestRouteIn.includes("Soft Jersey Top"), "Route In pairs the anchor with the strongest wearable partner");
    assert.ok(edit.aLookToTry.includes("Structured Navy Blazer"), "Look To Try keeps the same strong anchor");
    assert.ok(
      edit.aLookToTry.includes("Tailored Wide-Leg Trouser") && !edit.aLookToTry.includes("Soft Jersey Top"),
      "Look To Try uses a DIFFERENT supporting piece than Route In when the Closet supports it",
    );
  });
});

// ── 6: legitimate repetition when it IS the best evidence ──────────────────

describe("V1 — repetition is still allowed when a piece is genuinely the only/best evidence", () => {
  it("Route In and A Look To Try reuse the same pair when no other wearable partner exists", () => {
    const closet = [
      item({ name: "Structured Navy Blazer", category: "OUTERWEAR", fitProfile: "tailored", formality: "business-formal" }),
      item({ name: "Soft Jersey Top", category: "TOPS", fitProfile: "relaxed", material: "jersey" }),
      // No third wearable item exists — Look To Try has nothing else to pick.
    ];
    const edit = buildShopperEdit(MODERN_TAILORING_REPORT, evidence(closet));
    assert.ok(edit.yourBestRouteIn.includes("Soft Jersey Top"));
    assert.ok(
      edit.aLookToTry.includes("Soft Jersey Top"),
      "reusing the Jersey Top in both sections is intentional here — it's the only wearable partner the Closet offers, not automatic rotation",
    );
  });
});

// ── 7: Worth Investing In gap logic still works ─────────────────────────────

describe("V1 — Worth Investing In still produces a real gap OR no-purchase-needed from evidence", () => {
  it("Outcome A: no viable route exists → a real gap is surfaced, not 'no purchase needed'", () => {
    const closet = [
      item({ name: "Plain Phone Case", category: "ACCESSORIES" }), // qualifies on nothing — not even category-compatible for tailoring's routes alone
    ];
    const edit = buildShopperEdit(MODERN_TAILORING_REPORT, evidence(closet));
    assert.equal(edit.worthInvestingStatement, null);
  });

  it("Outcome C: both tailored-anchor routes are covered (no optional role left missing) → 'no purchase needed', grounded in the actual owned pieces", () => {
    const closet = [
      item({ name: "Structured Navy Blazer", category: "OUTERWEAR", fitProfile: "tailored", formality: "business-formal" }),
      item({ name: "Tailored Wide-Leg Trouser", category: "BOTTOMS", fitProfile: "tailored" }),
    ];
    const edit = buildShopperEdit(MODERN_TAILORING_REPORT, evidence(closet));
    assert.ok(edit.worthInvestingStatement !== null, "a satisfied route produces a no-purchase-needed statement");
    assert.match(edit.worthInvestingStatement!, /do not need to buy/i);
    assert.ok(edit.worthInvestingStatement!.includes("Structured Navy Blazer"), "the statement is grounded in the actual owned piece, not invented");
  });
});

// ── 8/9/10: data-boundary guarantees ────────────────────────────────────────

describe("V1 — data boundaries preserved", () => {
  it("refresh/reopen cannot increment usage — buildShopperEdit and getShopperEvidence make exactly one Prisma call, and it is read-only", () => {
    const prismaCalls = TREND_EVIDENCE_SRC.match(/prisma\.\w+\.\w+\(/g) ?? [];
    assert.equal(prismaCalls.length, 1, "exactly one Prisma call in the whole evidence/selection pipeline");
    assert.ok(prismaCalls[0].includes("findUnique"), "that one call is a read (findUnique), never a write");
    assert.ok(
      !TREND_EVIDENCE_SRC.includes("personalised-trend-edit-usage"),
      "this file never imports or calls the usage-recording module — usage accounting is wired at the route loader, outside this pure selection pipeline",
    );
  });

  it("Passport is never written — no .update(/.create(/.upsert( call anywhere in the selection pipeline", () => {
    for (const writeOp of [".update(", ".create(", ".upsert(", ".delete("]) {
      assert.ok(!TREND_EVIDENCE_SRC.includes(writeOp), `no ${writeOp} call in trend-evidence.server.ts`);
      assert.ok(!ATTRIBUTE_SCORING_SRC.includes(writeOp), `no ${writeOp} call in trend-evidence-attribute-scoring.server.ts`);
    }
  });

  it("no raw Taste/StyleTendency module is imported anywhere in the selection pipeline", () => {
    assert.ok(!/taste|StyleTendency/i.test(TREND_EVIDENCE_SRC.replace(/\/\/.*$/gm, "")), "no taste/StyleTendency reference in trend-evidence.server.ts (outside comments)");
    assert.ok(!/taste|StyleTendency/i.test(ATTRIBUTE_SCORING_SRC), "no taste/StyleTendency reference in trend-evidence-attribute-scoring.server.ts");
  });
});
