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
  it("refresh/reopen cannot increment usage — every Prisma call buildShopperEdit/getShopperEvidence make is read-only", () => {
    // Count was temporarily added alongside findUnique for the live Closet-
    // truncation diagnostic — still strictly read-only, so the real
    // invariant (no writes, ever) is unaffected. If a write verb ever
    // appears here, that's the actual regression this test exists to catch.
    const prismaCalls = TREND_EVIDENCE_SRC.match(/prisma\.\w+\.\w+\(/g) ?? [];
    assert.ok(prismaCalls.length >= 1, "at least one Prisma call exists");
    const readOnlyVerbs = ["findUnique", "findFirst", "findMany", "count"];
    for (const call of prismaCalls) {
      assert.ok(readOnlyVerbs.some((v) => call.includes(v)), `${call} must be read-only`);
    }
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

// ═════════════════════════════════════════════════════════════════════════
// Fix #1 — the 20-item blind spot. Live staging diagnostic confirmed a real
// 47-item Closet had 27 pieces (including the only two non-neutral items
// found anywhere in the fetched window) invisible to every Trend Edit
// report, because the evidence query capped at the 20 most recently added
// items regardless of Closet size.
// ═════════════════════════════════════════════════════════════════════════

describe("V1 — the Closet evidence fetch is no longer capped at the 20 most recent items", () => {
  it("closetItems' take is a bounded high limit (matching the plan's 250-piece Closet cap), not 20", () => {
    const closetBlockIdx = TREND_EVIDENCE_SRC.indexOf("closetItems: {");
    assert.ok(closetBlockIdx !== -1, "closetItems Prisma block found");
    const closetBlockRaw = TREND_EVIDENCE_SRC.slice(closetBlockIdx, TREND_EVIDENCE_SRC.indexOf("select: {", closetBlockIdx));
    const closetBlock = closetBlockRaw.replace(/\/\/.*$/gm, ""); // strip comments — the explanatory comment deliberately mentions the old "take: 20" value
    assert.ok(!/take:\s*20\b/.test(closetBlock), "closetItems no longer caps at the 20 most recently added items");
    assert.ok(/take:\s*250\b/.test(closetBlock), "closetItems is bounded at 250 — the plan's own Closet size cap, not an unbounded fetch");
  });

  it("an item that would be the 21st+ most recently added one is still a real, selectable piece of evidence once fetched — buildShopperEdit has no fetch-order dependency of its own", () => {
    // buildShopperEdit only ever sees whatever closetItems getShopperEvidence
    // handed it — it has no concept of "recency" or array position. This
    // proves the SELECTION side has no residual 20-item-window assumption:
    // a strong accent item placed deliberately LAST in a 25-item array
    // (simulating "oldest, would have been truncated under the old take:20")
    // is still correctly surfaced as the accent.
    const closet: ShopperClosetItemEvidence[] = [];
    for (let i = 0; i < 24; i++) {
      closet.push(item({ name: `Neutral Filler ${i}`, category: "TOPS", primaryColor: "black" }));
    }
    closet.push(item({ name: "Older Crimson Bag", category: "BAGS", primaryColor: "red" })); // the 25th item — "oldest"
    const edit = buildShopperEdit(COLOUR_DIRECTION_REPORT, evidence(closet));
    assert.ok(edit.yourBestRouteIn.includes("Older Crimson Bag"), "an item at the end of a >20-item array is still correctly surfaced as the accent");
  });
});

// ═════════════════════════════════════════════════════════════════════════
// Colour Direction QA follow-up (live staging regression): a black beanie,
// a black/beige tote, a black skirt, and white sneakers — all NEUTRAL by
// colour-family.ts's own NEUTRAL_COLORS set — were (a) called "your
// stronger colour move" in Route In, and (b) declared sufficient coverage
// ("you do not need to buy anything") by Worth Investing In. Both were role-
// blind: coverage was category-based (any BAGS/SHOES/ACCESSORIES item "is"
// the accent, regardless of actual colour), and Route In named whichever
// item scored highest overall without checking its role.
// ═════════════════════════════════════════════════════════════════════════

describe("Colour Direction — role-based coverage: neutral-only Closet never claims full coverage", () => {
  it("four category-eligible items that are ALL neutral (black/beige/white) → Worth Investing In never says 'you do not need to buy anything' — it recommends the missing accent", () => {
    const closet = [
      item({ name: "Black Ribbed Knit Beanie", category: "ACCESSORIES", primaryColor: "black" }),
      item({ name: "Black and Beige Geometric Tote", category: "BAGS", primaryColor: "black" }),
      item({ name: "Black Draped Maxi Skirt", category: "DRESSES", primaryColor: "black" }),
      item({ name: "White Cloud Running Sneakers", category: "SHOES", primaryColor: "white" }),
    ];
    const edit = buildShopperEdit(COLOUR_DIRECTION_REPORT, evidence(closet));
    assert.doesNotMatch(edit.worthInvestingStatement ?? "", /do not need to buy/i);
    // Outcome B — real base coverage, accent genuinely missing: the gap is named as an extension, not hidden.
    assert.ok(edit.partToTake.some((b) => /accent/i.test(b)), "the missing accent role is named in partToTake, not silently dropped");
  });

  it("black, white, and beige items all resolve to the base-neutral role, not accent-colour, in a real buildShopperEdit run", () => {
    const closet = [
      item({ name: "Black Item", category: "ACCESSORIES", primaryColor: "black" }),
      item({ name: "White Item", category: "SHOES", primaryColor: "white" }),
      item({ name: "Beige Item", category: "BAGS", primaryColor: "beige" }),
    ];
    const edit = buildShopperEdit(COLOUR_DIRECTION_REPORT, evidence(closet));
    // None of these may be named as "the accent" in Route In — only as the base, or omitted.
    assert.ok(!/is the accent/i.test(edit.yourBestRouteIn), "no neutral item is ever labelled the accent");
  });

  it("a black item never becomes 'your stronger colour move' — that exact phrase is retired", () => {
    const closet = [
      item({ name: "Black Beanie", category: "ACCESSORIES", primaryColor: "black" }),
      item({ name: "Black Tote", category: "BAGS", primaryColor: "black" }),
    ];
    const edit = buildShopperEdit(COLOUR_DIRECTION_REPORT, evidence(closet));
    assert.ok(!edit.yourBestRouteIn.includes("stronger colour move"), "role-blind 'stronger colour move' framing must not appear for an all-neutral pair");
  });
});

describe("Colour Direction — a genuine accent item outranks a neutral accessory for the ACCENT role, even when the neutral item scores higher overall", () => {
  it("the real accent item is named as the accent in Route In, and the neutral item as the base — regardless of which one has the higher raw score", () => {
    const closet = [
      // Deliberately given an extra image-bonus point so it OUTSCORES the accent item overall —
      // proving role assignment is per-dimension, not "whichever item wins the overall race".
      item({ name: "Black Ribbed Beanie", category: "ACCESSORIES", primaryColor: "black", imageUrl: "https://example.com/beanie.jpg" }),
      item({ name: "Crimson Leather Bag", category: "BAGS", primaryColor: "red" }),
    ];
    const edit = buildShopperEdit(COLOUR_DIRECTION_REPORT, evidence(closet));
    assert.ok(edit.yourBestRouteIn.includes("Crimson Leather Bag"), "the genuine accent item is named as the accent");
    assert.ok(edit.yourBestRouteIn.includes("Black Ribbed Beanie"), "the neutral item is named too, as the base");
    assert.ok(!/Black Ribbed Beanie.{0,40}is the accent/.test(edit.yourBestRouteIn), "the neutral item is never mislabelled as the accent");
  });

  it("both the base-neutral and accent-colour items are selected into Closet Shows, each for their own dimension", () => {
    const closet = [
      item({ name: "Black Ribbed Beanie", category: "ACCESSORIES", primaryColor: "black", imageUrl: "https://example.com/beanie.jpg" }),
      item({ name: "Crimson Leather Bag", category: "BAGS", primaryColor: "red" }),
    ];
    const edit = buildShopperEdit(COLOUR_DIRECTION_REPORT, evidence(closet));
    const names = edit.evidenceClosetItems.map((i) => i.name);
    assert.ok(names.includes("Black Ribbed Beanie") && names.includes("Crimson Leather Bag"), "Closet Shows includes both the base and the accent evidence");
  });
});

describe("Colour Direction — base + genuine accent together may validly produce no-purchase-needed", () => {
  it("a real neutral base plus a real accent item → Worth Investing In may correctly say no purchase is needed", () => {
    const closet = [
      item({ name: "Cream Wide-Leg Trouser", category: "BOTTOMS", primaryColor: "cream" }),
      item({ name: "Crimson Leather Bag", category: "BAGS", primaryColor: "red" }),
    ];
    const edit = buildShopperEdit(COLOUR_DIRECTION_REPORT, evidence(closet));
    assert.match(edit.worthInvestingStatement ?? "", /do not need to buy/i);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// Section-repetition hard V1 invariants (live QA regression, confirmed
// across Colour Direction, Modern Tailoring, AND Soft Structure): the
// prose already varied by section, but every "Already Yours" strip
// rendered the SAME full Closet Shows array regardless — because
// ShopperEdit had no section-specific item-array field for the UI to read.
// These tests exercise all three current slugs.
// ═════════════════════════════════════════════════════════════════════════

const THREE_REPORTS: [string, TrendReportData][] = [
  ["Colour Direction", COLOUR_DIRECTION_REPORT],
  ["Modern Tailoring", MODERN_TAILORING_REPORT],
  ["Soft Structure", SOFT_STRUCTURE_REPORT],
];

describe("V1 hard invariant — evidenceClosetItems is never blindly reused as routeInItems or lookToTryItems", () => {
  it("the renderer source no longer maps edit.evidenceClosetItems under the Route In or A Look To Try 'Already Yours' strips", () => {
    const rendererSrc = readFileSync(resolve(import.meta.dirname, "../routes/trends.my-edits.$slug.tsx"), "utf-8");
    const routeInSectionIdx = rendererSrc.indexOf("03 / Your route in");
    const lookToTrySectionIdx = rendererSrc.indexOf("04 / A look to try");
    const worthInvestingIdx = rendererSrc.indexOf("05 / Worth investing in");
    assert.ok(routeInSectionIdx !== -1 && lookToTrySectionIdx !== -1 && worthInvestingIdx !== -1, "all three section markers found");

    const routeInBlock = rendererSrc.slice(routeInSectionIdx, lookToTrySectionIdx);
    const lookToTryBlock = rendererSrc.slice(lookToTrySectionIdx, worthInvestingIdx);
    assert.ok(routeInBlock.includes("edit.routeInItems"), "Route In's Already Yours strip reads edit.routeInItems");
    assert.ok(!routeInBlock.includes("edit.evidenceClosetItems"), "Route In's Already Yours strip no longer reads the shared Closet Shows array");
    assert.ok(lookToTryBlock.includes("edit.lookToTryItems"), "A Look To Try's Already Yours strip reads edit.lookToTryItems");
    assert.ok(!lookToTryBlock.includes("edit.evidenceClosetItems"), "A Look To Try's Already Yours strip no longer reads the shared Closet Shows array");
  });

  for (const [label, report] of THREE_REPORTS) {
    it(`${label}: routeInItems is a genuine subset of evidenceClosetItems, never the identical full array, when more evidence exists`, () => {
      const closet = [
        item({ name: "Alpha Piece", category: "OUTERWEAR", fitProfile: "tailored", formality: "business-formal", primaryColor: "black" }),
        item({ name: "Beta Piece", category: "TOPS", fitProfile: "relaxed", material: "jersey", primaryColor: "cream" }),
        item({ name: "Gamma Piece", category: "BOTTOMS", fitProfile: "tailored", silhouette: "wrap", primaryColor: "red" }),
        item({ name: "Delta Piece", category: "DRESSES", fitProfile: "flowy", silhouette: "a-line", primaryColor: "stone" }),
      ];
      const edit = buildShopperEdit(report, evidence(closet));
      assert.ok(edit.evidenceClosetItems.length >= 3, "Closet Shows surfaces multiple pieces of evidence");
      assert.ok(edit.routeInItems.length <= 2, "Route In never shows more than its own 1-2 selected items");
      assert.notDeepEqual(
        edit.routeInItems.map((i) => i.name).sort(),
        edit.evidenceClosetItems.map((i) => i.name).sort(),
        "Route In's item set is not identical to the full Closet Shows set",
      );
    });

    it(`${label}: lookToTryItems is a genuine subset of evidenceClosetItems, never the identical full array, when more evidence exists`, () => {
      const closet = [
        item({ name: "Alpha Piece", category: "OUTERWEAR", fitProfile: "tailored", formality: "business-formal", primaryColor: "black" }),
        item({ name: "Beta Piece", category: "TOPS", fitProfile: "relaxed", material: "jersey", primaryColor: "cream" }),
        item({ name: "Gamma Piece", category: "BOTTOMS", fitProfile: "tailored", silhouette: "wrap", primaryColor: "red" }),
        item({ name: "Delta Piece", category: "DRESSES", fitProfile: "flowy", silhouette: "a-line", primaryColor: "stone" }),
      ];
      const edit = buildShopperEdit(report, evidence(closet));
      assert.ok(edit.lookToTryItems.length <= 2, "A Look To Try never shows more than its own 1-2 selected items");
      assert.notDeepEqual(
        edit.lookToTryItems.map((i) => i.name).sort(),
        edit.evidenceClosetItems.map((i) => i.name).sort(),
        "A Look To Try's item set is not identical to the full Closet Shows set",
      );
    });
  }
});

describe("V1 hard invariant — A Look To Try differs from Route In by at least one item when a valid alternative exists", () => {
  for (const [label, report] of THREE_REPORTS) {
    it(`${label}: with 3+ wearable candidates, Route In and A Look To Try use different support items`, () => {
      const closet = [
        item({ name: "Primary Anchor", category: "OUTERWEAR", fitProfile: "tailored", formality: "business-formal", primaryColor: "black" }),
        item({ name: "Secondary Option", category: "TOPS", fitProfile: "relaxed", material: "jersey", primaryColor: "cream" }),
        item({ name: "Tertiary Option", category: "BOTTOMS", fitProfile: "tailored", silhouette: "wrap", primaryColor: "stone" }),
      ];
      const edit = buildShopperEdit(report, evidence(closet));
      const routeInNames = new Set(edit.routeInItems.map((i) => i.name));
      const lookToTryNames = new Set(edit.lookToTryItems.map((i) => i.name));
      assert.notDeepEqual(
        [...routeInNames].sort(),
        [...lookToTryNames].sort(),
        "the two sections' item sets differ when the Closet offers more than one valid support option",
      );
    });
  }
});

describe("V1 hard invariant — reuse is allowed, but only when it is the Closet's genuinely only/best option", () => {
  for (const [label, report] of THREE_REPORTS) {
    it(`${label}: with only 2 wearable items total, Route In and A Look To Try legitimately reuse the same pair — this is truthful, not padding`, () => {
      const closet = [
        item({ name: "Only Anchor", category: "OUTERWEAR", fitProfile: "tailored", formality: "business-formal", primaryColor: "black" }),
        item({ name: "Only Partner", category: "TOPS", fitProfile: "relaxed", material: "jersey", primaryColor: "cream" }),
      ];
      const edit = buildShopperEdit(report, evidence(closet));
      const routeInNames = edit.routeInItems.map((i) => i.name).sort();
      const lookToTryNames = edit.lookToTryItems.map((i) => i.name).sort();
      assert.deepEqual(routeInNames, lookToTryNames, "with no alternative, reusing the same pair is correct, not a bug");
    });
  }
});
