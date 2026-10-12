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

  it("two tailored-anchor items (OUTERWEAR + BOTTOMS), zero relaxed-counterpart evidence → still a real gap, not 'no purchase needed' (the exact live-QA false-coverage bug: owning both OLD category routes is not the same as owning both real roles)", () => {
    const closet = [
      item({ name: "Structured Navy Blazer", category: "OUTERWEAR", fitProfile: "tailored", formality: "business-formal" }),
      item({ name: "Tailored Wide-Leg Trouser", category: "BOTTOMS", fitProfile: "tailored" }),
    ];
    const edit = buildShopperEdit(MODERN_TAILORING_REPORT, evidence(closet));
    assert.equal(edit.worthInvestingStatement, null, "category presence alone (OUTERWEAR + BOTTOMS) must not satisfy coverage when every owned item is tailored-anchor and no relaxed-counterpart evidence exists at all");
  });

  it("Outcome C: genuine evidence for BOTH roles (tailored-anchor + relaxed-counterpart) → 'no purchase needed', grounded in the actual owned pieces", () => {
    const closet = [
      item({ name: "Structured Navy Blazer", category: "OUTERWEAR", fitProfile: "tailored", formality: "business-formal" }),
      item({ name: "Relaxed Chambray Shirt", category: "TOPS", fitProfile: "relaxed", material: "jersey" }),
    ];
    const edit = buildShopperEdit(MODERN_TAILORING_REPORT, evidence(closet));
    assert.ok(edit.worthInvestingStatement !== null, "genuine evidence for both roles produces a no-purchase-needed statement");
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

// ═════════════════════════════════════════════════════════════════════════
// Fix #2 — role-aware category priority. Live staging QA confirmed every
// neutral item scored an identical flat 6 regardless of category, so the
// text-overlap tie-break (not product judgement) decided the winner — a
// black beanie outranked a tailored blazer for the base role. Fix #2 makes
// foundation garments (TOPS/BOTTOMS/DRESSES/OUTERWEAR) strictly outrank
// accessories/bags/shoes for base-neutral, and makes everyday-formality
// accent pieces outrank occasion/evening-formality ones for accent-colour,
// without ever hard-coding an item name.
// ═════════════════════════════════════════════════════════════════════════

describe("Fix #2 — a foundation garment beats a neutral accessory for the BASE role", () => {
  it("a neutral blazer (OUTERWEAR) outranks a neutral beanie (ACCESSORIES) for base-neutral, even though both are genuinely neutral", () => {
    const closet = [
      item({ name: "Black Ribbed Knit Beanie", category: "ACCESSORIES", primaryColor: "black" }),
      item({ name: "Black Tailored Blazer", category: "OUTERWEAR", primaryColor: "black" }),
    ];
    const edit = buildShopperEdit(COLOUR_DIRECTION_REPORT, evidence(closet));
    assert.ok(
      edit.yourBestRouteIn.includes("Black Tailored Blazer"),
      "the foundation garment, not the accessory, is named as the base in Route In",
    );
    assert.ok(
      !edit.yourBestRouteIn.includes("Beanie"),
      "the beanie is not named as the base when a stronger foundation garment exists",
    );
  });

  it("this holds across all four foundation categories against all three accessory categories", () => {
    for (const foundationCat of ["TOPS", "BOTTOMS", "DRESSES", "OUTERWEAR"]) {
      for (const accessoryCat of ["BAGS", "SHOES", "ACCESSORIES"]) {
        const closet = [
          item({ name: "Accessory Item", category: accessoryCat, primaryColor: "black" }),
          item({ name: "Foundation Item", category: foundationCat, primaryColor: "black" }),
        ];
        const edit = buildShopperEdit(COLOUR_DIRECTION_REPORT, evidence(closet));
        assert.ok(
          edit.yourBestRouteIn.includes("Foundation Item"),
          `${foundationCat} must outrank ${accessoryCat} for the base role`,
        );
      }
    }
  });
});

describe("Fix #2 — everyday-formality accent evidence outranks occasion/evening accent evidence by default", () => {
  it("casual jeans outrank an evening gown for the accent role when both are genuinely coloured", () => {
    // Base anchor is OUTERWEAR (not BOTTOMS) deliberately — it's the one
    // category that can wear alongside BOTH a BOTTOMS accent (jeans) and a
    // DRESSES accent (gown), per categoriesAreWearablePair's own rules, so
    // the test isolates the formality-priority question from wearable-pair
    // mechanics.
    const closet = [
      item({ name: "Burgundy Evening Gown", category: "DRESSES", primaryColor: "burgundy", formality: "evening" }),
      item({ name: "Blue Wash Jeans", category: "BOTTOMS", primaryColor: "blue", formality: "casual" }),
      item({ name: "Cream Blazer", category: "OUTERWEAR", primaryColor: "cream" }),
    ];
    const edit = buildShopperEdit(COLOUR_DIRECTION_REPORT, evidence(closet));
    assert.ok(
      edit.yourBestRouteIn.includes("Blue Wash Jeans"),
      "the everyday-formality accent piece is named over the evening-formality one",
    );
  });

  it("a genuinely coloured evening piece still qualifies as accent evidence when it is the only accent candidate", () => {
    const closet = [
      item({ name: "Cream Blazer", category: "OUTERWEAR", primaryColor: "cream" }),
      item({ name: "Burgundy Evening Gown", category: "DRESSES", primaryColor: "burgundy", formality: "evening" }),
    ];
    const edit = buildShopperEdit(COLOUR_DIRECTION_REPORT, evidence(closet));
    assert.ok(
      edit.yourBestRouteIn.includes("Burgundy Evening Gown"),
      "an evening-formality accent piece is still named as the accent when it's the only real accent evidence — being lower-priority is not the same as being excluded",
    );
  });
});

describe("Fix #2 — Your Closet Shows represents both roles, and never pads with irrelevant neutrals", () => {
  it("with abundant base-neutral evidence and exactly one real accent, Closet Shows returns base+accent, not four neutrals", () => {
    const closet = [
      item({ name: "Neutral One", category: "TOPS", primaryColor: "black" }),
      item({ name: "Neutral Two", category: "BOTTOMS", primaryColor: "cream" }),
      item({ name: "Neutral Three", category: "OUTERWEAR", primaryColor: "beige" }),
      item({ name: "Neutral Four", category: "DRESSES", primaryColor: "stone" }),
      item({ name: "Real Accent", category: "BAGS", primaryColor: "red" }),
    ];
    const edit = buildShopperEdit(COLOUR_DIRECTION_REPORT, evidence(closet));
    const shownNames = edit.evidenceClosetItems.map((i) => i.name);
    assert.ok(shownNames.includes("Real Accent"), "the genuine accent piece is represented in Closet Shows");
    const baseCount = shownNames.filter((n) => n !== "Real Accent").length;
    assert.ok(baseCount <= 2, `Closet Shows should surface at most 2 base pieces alongside the accent, got ${baseCount}: ${shownNames.join(", ")}`);
  });

  it("with only one base piece and one accent piece, Closet Shows returns exactly those 2 — never padded to 4 with irrelevant items", () => {
    const closet = [
      item({ name: "Only Base", category: "TOPS", primaryColor: "black" }),
      item({ name: "Only Accent", category: "BAGS", primaryColor: "red" }),
    ];
    const edit = buildShopperEdit(COLOUR_DIRECTION_REPORT, evidence(closet));
    assert.equal(edit.evidenceClosetItems.length, 2, "no padding — exactly the 2 genuinely useful pieces are shown");
    assert.deepEqual(
      edit.evidenceClosetItems.map((i) => i.name).sort(),
      ["Only Accent", "Only Base"],
      "both the base and the accent are represented",
    );
  });

  it("with real evidence for both roles, Closet Shows contains at least one item from each role", () => {
    const closet = [
      item({ name: "Base Alpha", category: "TOPS", primaryColor: "black" }),
      item({ name: "Base Beta", category: "BOTTOMS", primaryColor: "cream" }),
      item({ name: "Accent Alpha", category: "BAGS", primaryColor: "red" }),
      item({ name: "Accent Beta", category: "SHOES", primaryColor: "blue" }),
    ];
    const edit = buildShopperEdit(COLOUR_DIRECTION_REPORT, evidence(closet));
    const shownNames = new Set(edit.evidenceClosetItems.map((i) => i.name));
    const hasBase = shownNames.has("Base Alpha") || shownNames.has("Base Beta");
    const hasAccent = shownNames.has("Accent Alpha") || shownNames.has("Accent Beta");
    assert.ok(hasBase, "at least one base-role item is represented");
    assert.ok(hasAccent, "at least one accent-role item is represented");
  });
});

describe("Fix #2 — Route In and A Look To Try prefer a genuine accent over a second neutral", () => {
  it("Route In's support slot is the real accent item, not another neutral that happens to be wearable", () => {
    const closet = [
      item({ name: "Quiet Base", category: "TOPS", primaryColor: "black" }),
      item({ name: "Second Neutral", category: "BOTTOMS", primaryColor: "cream" }),
      item({ name: "Real Accent", category: "BOTTOMS", primaryColor: "blue", formality: "casual" }),
    ];
    const edit = buildShopperEdit(COLOUR_DIRECTION_REPORT, evidence(closet));
    const routeInNames = edit.routeInItems.map((i) => i.name);
    assert.ok(routeInNames.includes("Real Accent"), "the genuine accent is picked over a second neutral for Route In's support slot");
    assert.ok(!routeInNames.includes("Second Neutral"), "the second neutral is not used when real accent evidence is wearable with the base");
  });

  it("A Look To Try picks a DIFFERENT real accent than Route In used, when a second one exists", () => {
    const closet = [
      item({ name: "Quiet Base", category: "TOPS", primaryColor: "black" }),
      item({ name: "Accent One", category: "BOTTOMS", primaryColor: "blue", formality: "casual" }),
      item({ name: "Accent Two", category: "BAGS", primaryColor: "burgundy", formality: "casual" }),
    ];
    const edit = buildShopperEdit(COLOUR_DIRECTION_REPORT, evidence(closet));
    const routeInNames = new Set(edit.routeInItems.map((i) => i.name));
    const lookToTryNames = new Set(edit.lookToTryItems.map((i) => i.name));
    assert.notDeepEqual([...routeInNames].sort(), [...lookToTryNames].sort(), "Route In and A Look To Try use different accent items when two genuine accents exist");
  });
});

// ═════════════════════════════════════════════════════════════════════════
// Fix #3 — role-aware copy everywhere. Live staging QA found a direct
// contradiction: white sneakers (genuinely neutral — base-neutral role)
// were called "the base" in one place and "the accent note at ground
// level" in another (buildEvidenceItemRoleNote), purely because SHOES was
// in a category-keyed map. These tests prove the roleNote shown under
// Your Closet Shows always matches the item's actual resolved role.
// ═════════════════════════════════════════════════════════════════════════

// The specific unconditional category-level sentences the live QA bug
// traced to — these must never appear on an item whose resolved role is
// base-neutral, no matter its category. (Legitimate base copy is still
// allowed to use the word "accent" in passing — e.g. "introduce one
// deliberate accent through a bag, flat, or scarf" — so the test checks
// for these exact self-referential accent CLAIMS, not the bare word.)
const SELF_CLAIMED_ACCENT_PHRASES = [
  "The accent note at ground level",
  "A low-commitment entry into this direction",
  "An entry point into this direction at the accessory level",
  "The accent note in this direction",
];

function claimsSelfIsAccent(roleNote: string): boolean {
  return SELF_CLAIMED_ACCENT_PHRASES.some((p) => roleNote.includes(p));
}

describe("Fix #3 — Closet Shows roleNote copy always matches the resolved role, never raw category", () => {
  it("a neutral white shoe never receives accent wording", () => {
    const closet = [item({ name: "White Running Sneakers", category: "SHOES", primaryColor: "white" })];
    const edit = buildShopperEdit(COLOUR_DIRECTION_REPORT, evidence(closet));
    const card = edit.evidenceClosetItems.find((i) => i.name === "White Running Sneakers");
    assert.ok(card, "the item is shown");
    assert.ok(!claimsSelfIsAccent(card!.roleNote), `a neutral shoe must not claim itself as the accent, got: "${card!.roleNote}"`);
    assert.ok(card!.roleNote.includes("base"), `a neutral shoe's note should use base/support language, got: "${card!.roleNote}"`);
  });

  it("a neutral black beanie never receives accent wording", () => {
    const closet = [item({ name: "Black Ribbed Knit Beanie", category: "ACCESSORIES", primaryColor: "black" })];
    const edit = buildShopperEdit(COLOUR_DIRECTION_REPORT, evidence(closet));
    const card = edit.evidenceClosetItems.find((i) => i.name === "Black Ribbed Knit Beanie");
    assert.ok(card, "the item is shown");
    assert.ok(!claimsSelfIsAccent(card!.roleNote), `a neutral beanie must not claim itself as the accent, got: "${card!.roleNote}"`);
  });

  it("a neutral beige tote never receives accent wording", () => {
    const closet = [item({ name: "Beige Suede Tote Bag", category: "BAGS", primaryColor: "beige" })];
    const edit = buildShopperEdit(COLOUR_DIRECTION_REPORT, evidence(closet));
    const card = edit.evidenceClosetItems.find((i) => i.name === "Beige Suede Tote Bag");
    assert.ok(card, "the item is shown");
    assert.ok(!claimsSelfIsAccent(card!.roleNote), `a neutral bag must not claim itself as the accent, got: "${card!.roleNote}"`);
  });

  it("a real coloured accessory (red bag) may receive accent wording", () => {
    const closet = [item({ name: "Crimson Leather Bag", category: "BAGS", primaryColor: "red" })];
    const edit = buildShopperEdit(COLOUR_DIRECTION_REPORT, evidence(closet));
    const card = edit.evidenceClosetItems.find((i) => i.name === "Crimson Leather Bag");
    assert.ok(card, "the item is shown");
    assert.ok(/accent/i.test(card!.roleNote), `a genuinely coloured bag should get accent wording, got: "${card!.roleNote}"`);
  });

  it("a real coloured garment (blue shirt) may receive accent wording", () => {
    const closet = [item({ name: "Blue Chambray Shirt", category: "TOPS", primaryColor: "blue", formality: "business-casual" })];
    const edit = buildShopperEdit(COLOUR_DIRECTION_REPORT, evidence(closet));
    const card = edit.evidenceClosetItems.find((i) => i.name === "Blue Chambray Shirt");
    assert.ok(card, "the item is shown");
    assert.ok(/accent/i.test(card!.roleNote), `a genuinely coloured garment should get accent wording, got: "${card!.roleNote}"`);
  });

  it("a real coloured garment (burgundy blouse) may receive accent wording", () => {
    const closet = [item({ name: "Burgundy Draped Blouse", category: "TOPS", primaryColor: "burgundy", formality: "evening" })];
    const edit = buildShopperEdit(COLOUR_DIRECTION_REPORT, evidence(closet));
    const card = edit.evidenceClosetItems.find((i) => i.name === "Burgundy Draped Blouse");
    assert.ok(card, "the item is shown");
    assert.ok(/accent/i.test(card!.roleNote), `a genuinely coloured blouse should get accent wording, got: "${card!.roleNote}"`);
  });

  it("the same white shoe is never called the base in one place and the accent in another within a single report", () => {
    const closet = [
      item({ name: "White Running Sneakers", category: "SHOES", primaryColor: "white" }),
      item({ name: "Crimson Leather Bag", category: "BAGS", primaryColor: "red" }),
    ];
    const edit = buildShopperEdit(COLOUR_DIRECTION_REPORT, evidence(closet));
    const card = edit.evidenceClosetItems.find((i) => i.name === "White Running Sneakers");
    assert.ok(card, "the item is shown");
    assert.ok(!claimsSelfIsAccent(card!.roleNote), "the white shoe's own card never claims itself as the accent");
    assert.ok(!edit.yourBestRouteIn.toLowerCase().includes("white running sneakers is the accent"), "Route In never separately claims this same neutral shoe is the accent");
  });
});

// ═════════════════════════════════════════════════════════════════════════
// Synthetic regression matching the real staging Closet's actual shape:
// many recently-added neutral items, with the only real accent-colour
// evidence sitting among older pieces that a take:20 cap would have hidden.
// Confirms Fix #1 (take:250) and Fix #2/#3's role-aware selection compose
// correctly end-to-end, not just in isolation.
// ═════════════════════════════════════════════════════════════════════════

describe("Fix #1 + Fix #2 composed — older blue/burgundy garments surface correctly once fetched", () => {
  it("25 recent neutral fillers + 2 older genuinely-coloured garments: the older accents are named, not a neutral filler", () => {
    const closet: ShopperClosetItemEvidence[] = [];
    for (let i = 0; i < 25; i++) {
      closet.push(item({ name: `Recent Neutral ${i}`, category: i % 2 === 0 ? "TOPS" : "ACCESSORIES", primaryColor: "black" }));
    }
    closet.push(item({ name: "Older Blue Jeans", category: "BOTTOMS", primaryColor: "blue", formality: "casual" }));
    closet.push(item({ name: "Older Burgundy Blouse", category: "TOPS", primaryColor: "burgundy", formality: "evening" }));

    const edit = buildShopperEdit(COLOUR_DIRECTION_REPORT, evidence(closet));

    assert.ok(edit.yourBestRouteIn.includes("Older Blue Jeans"), "the real, everyday-formality accent is named in Route In over any neutral filler");

    const shownNames = edit.evidenceClosetItems.map((i) => i.name);
    assert.ok(
      shownNames.includes("Older Blue Jeans") || shownNames.includes("Older Burgundy Blouse"),
      "at least one of the older genuine accents is represented in Closet Shows",
    );

    const blueCard = edit.evidenceClosetItems.find((i) => i.name === "Older Blue Jeans");
    if (blueCard) assert.ok(/accent/i.test(blueCard.roleNote), "the older blue jeans get accent wording, not base/neutral wording");
  });
});

// ═════════════════════════════════════════════════════════════════════════
// Fix #4 — semantic diversity, not just item-ID diversity. Live staging QA
// confirmed the engine satisfied "4 different Closet rows" while repeating
// the exact same styling idea twice: two pairs of medium-blue jeans filled
// both accent slots in Closet Shows, and A Look To Try "differed" from
// Route In only by swapping one pair of blue jeans for the other — not a
// meaningfully different look, even though real burgundy accent evidence
// (a skirt, a blouse, an evening gown) existed in the same Closet. These
// tests prove selection now compares candidates by role + hue family +
// category, not item identity.
// ═════════════════════════════════════════════════════════════════════════

describe("Fix #4 — Closet Shows does not fill both accent slots with the same hue-family+category idea", () => {
  it("two blue bottoms + one burgundy bottom, all genuine accent evidence: Closet Shows does not select both blue items when burgundy is also strong", () => {
    const closet = [
      item({ name: "Quiet Base Top", category: "TOPS", primaryColor: "cream" }),
      item({ name: "Blue Jeans One", category: "BOTTOMS", primaryColor: "blue", formality: "casual" }),
      item({ name: "Blue Jeans Two", category: "BOTTOMS", primaryColor: "blue", formality: "casual" }),
      item({ name: "Burgundy Skirt", category: "BOTTOMS", primaryColor: "burgundy", formality: "evening" }),
    ];
    const edit = buildShopperEdit(COLOUR_DIRECTION_REPORT, evidence(closet));
    const shown = new Set(edit.evidenceClosetItems.map((i) => i.name));
    const blueCount = ["Blue Jeans One", "Blue Jeans Two"].filter((n) => shown.has(n)).length;
    assert.ok(blueCount <= 1, `at most one blue item should occupy an accent slot when burgundy evidence is also available, got both: ${[...shown].join(", ")}`);
    assert.ok(shown.has("Burgundy Skirt"), "the genuinely different accent (burgundy) is represented instead of a second blue item");
  });

  it("different item IDs alone are not sufficient diversity — same hue family + same category is a near-duplicate even with different names", () => {
    const closet = [
      item({ name: "Quiet Base Top", category: "TOPS", primaryColor: "cream" }),
      item({ name: "Navy Trouser A", category: "BOTTOMS", primaryColor: "blue", formality: "casual" }),
      item({ name: "Navy Trouser B", category: "BOTTOMS", primaryColor: "blue", formality: "casual" }),
      item({ name: "Red Blouse", category: "TOPS", primaryColor: "red", formality: "casual" }),
    ];
    // Red Blouse is TOPS, same category as the anchor — not wearable as a
    // second accent alongside it, but IS a genuinely different hue+category
    // than the two blue trousers. Closet Shows should still prefer breadth
    // over a second near-identical blue trouser where a scored alternative
    // exists at all.
    const edit = buildShopperEdit(COLOUR_DIRECTION_REPORT, evidence(closet));
    const shown = edit.evidenceClosetItems.map((i) => i.name);
    const blueTrouserCount = shown.filter((n) => n === "Navy Trouser A" || n === "Navy Trouser B").length;
    assert.ok(blueTrouserCount <= 1, "two same-hue-family, same-category trousers are a near-duplicate — at most one occupies an accent slot");
  });
});

describe("Fix #4 — A Look To Try prefers a genuinely different accent idea from Route In, not another SKU of the same idea", () => {
  it("Route In uses a blue bottom as the accent; A Look To Try prefers a burgundy piece over a second pair of blue jeans", () => {
    const closet = [
      item({ name: "Cream Tank", category: "TOPS", primaryColor: "cream" }),
      item({ name: "Medium Blue Wash Jeans", category: "BOTTOMS", primaryColor: "blue", formality: "casual" }),
      item({ name: "Medium Blue Wide-Leg Jeans", category: "BOTTOMS", primaryColor: "blue", formality: "casual" }),
      item({ name: "Burgundy Midi Skirt", category: "BOTTOMS", primaryColor: "burgundy", formality: "evening" }),
    ];
    const edit = buildShopperEdit(COLOUR_DIRECTION_REPORT, evidence(closet));
    const routeInNames = edit.routeInItems.map((i) => i.name);
    const lookToTryNames = edit.lookToTryItems.map((i) => i.name);

    assert.ok(routeInNames.includes("Medium Blue Wash Jeans"), "Route In uses the strongest (blue) accent — the simplest, most obvious entry");
    assert.ok(
      lookToTryNames.includes("Burgundy Midi Skirt"),
      `A Look To Try should prefer the genuinely different burgundy accent over a second pair of blue jeans, got: ${lookToTryNames.join(", ")}`,
    );
    assert.ok(
      !lookToTryNames.includes("Medium Blue Wide-Leg Jeans"),
      "A Look To Try should not fall back to a same-hue-family, same-category item when a genuinely different one is available",
    );
  });

  it("this holds end-to-end for the real staging Closet shape that surfaced the bug", () => {
    const closet = [
      item({ name: "Cream Ribbed Knit Tank Top", category: "TOPS", primaryColor: "cream" }),
      item({ name: "Medium Blue Wash Jeans", category: "BOTTOMS", primaryColor: "Medium Blue", formality: "casual", fitProfile: "relaxed" }),
      item({ name: "Black Draped Maxi Skirt", category: "BOTTOMS", primaryColor: "black", fitProfile: "flowy", formality: "smart-casual" }),
      item({ name: "Medium Blue Wide-Leg Jeans", category: "BOTTOMS", primaryColor: "Medium Blue", formality: "casual", fitProfile: "relaxed" }),
      item({ name: "Burgundy Midi Skirt", category: "BOTTOMS", primaryColor: "Burgundy", formality: "evening", fitProfile: "fitted" }),
      item({ name: "Blue Chambray Button-Up Shirt", category: "TOPS", primaryColor: "Periwinkle Blue", formality: "business-casual", fitProfile: "relaxed" }),
      item({ name: "Burgundy Cowl Neck Evening Gown", category: "DRESSES", primaryColor: "Burgundy", formality: "evening", fitProfile: "fitted" }),
      item({ name: "Burgundy Draped Sleeveless Blouse", category: "TOPS", primaryColor: "Burgundy", formality: "evening", fitProfile: "body-skimming" }),
    ];
    const edit = buildShopperEdit(COLOUR_DIRECTION_REPORT, evidence(closet));

    const closetShowsNames = edit.evidenceClosetItems.map((i) => i.name);
    const blueBottomsShown = closetShowsNames.filter((n) => n === "Medium Blue Wash Jeans" || n === "Medium Blue Wide-Leg Jeans").length;
    assert.ok(blueBottomsShown <= 1, `Closet Shows must not fill both accent slots with the two blue jeans, got: ${closetShowsNames.join(", ")}`);
    assert.ok(
      closetShowsNames.some((n) => n.includes("Burgundy")),
      `Closet Shows should represent the burgundy accent family alongside blue, got: ${closetShowsNames.join(", ")}`,
    );

    const routeInNames = edit.routeInItems.map((i) => i.name);
    const lookToTryNames = edit.lookToTryItems.map((i) => i.name);
    assert.notDeepEqual(
      [...routeInNames].sort(),
      [...lookToTryNames].sort(),
      "Route In and A Look To Try must not be the exact same item set",
    );
    const lookToTryIsJustTheOtherBlueJeans =
      lookToTryNames.includes("Medium Blue Wide-Leg Jeans") && routeInNames.includes("Medium Blue Wash Jeans");
    assert.ok(!lookToTryIsJustTheOtherBlueJeans, "A Look To Try must not be 'the same idea, different SKU' — swapping one pair of blue jeans for the other pair");
  });
});

describe("Fix #4 — repetition of the same hue-family+category idea remains allowed when no semantically distinct alternative exists", () => {
  it("with only two same-hue-family bottoms and nothing else wearable, A Look To Try legitimately reuses the same accent idea", () => {
    const closet = [
      item({ name: "Cream Tank", category: "TOPS", primaryColor: "cream" }),
      item({ name: "Blue Jeans One", category: "BOTTOMS", primaryColor: "blue", formality: "casual" }),
      item({ name: "Blue Jeans Two", category: "BOTTOMS", primaryColor: "blue", formality: "casual" }),
    ];
    const edit = buildShopperEdit(COLOUR_DIRECTION_REPORT, evidence(closet));
    const routeInNames = edit.routeInItems.map((i) => i.name);
    const lookToTryNames = edit.lookToTryItems.map((i) => i.name);
    assert.ok(
      routeInNames.includes("Blue Jeans One") || routeInNames.includes("Blue Jeans Two"),
      "a real accent is still named even though both candidates share the same hue family and category",
    );
    assert.ok(lookToTryNames.length > 0, "A Look To Try still produces a real pairing — repetition here is truthful, not a bug, since no distinct alternative exists");
  });
});

// ═════════════════════════════════════════════════════════════════════════
// Fix #5 — generalized role-aware selection for Modern Tailoring / Soft
// Structure. Live staging QA confirmed both reports selected the exact
// same 4 Closet pieces (only reordered) because Route In / A Look To Try
// used the generic "global top scorer + next wearable scorer" path, which
// has no concept of primary vs. secondary role — so a second tailored-
// anchor item stood in for the genuine relaxed-counterpart/soft-flowing
// evidence that existed elsewhere in the Closet. These tests prove the
// same role-aware + semantic-novelty machinery already built and tested
// for Colour Direction now applies to Modern Tailoring and Soft Structure
// via each slug's own real dimensionIdsForSlug profile — not via any new,
// slug-specific logic or hard-coded item name.
//
// Synthetic items are modeled on the real staging Closet shape (a tailored
// blazer, tailored trousers, a relaxed chambray shirt, a draped flowy maxi
// skirt, a relaxed button-down) without using the real customer's actual
// item names.
// ═════════════════════════════════════════════════════════════════════════

function tailoredBlazer(name = "Tailored Blazer") {
  return item({ name, category: "OUTERWEAR", subcategory: "blazer", fitProfile: "tailored", silhouette: "straight", formality: "business-formal", material: "wool" });
}
function tailoredTrousers(name = "Tailored Trousers") {
  return item({ name, category: "BOTTOMS", subcategory: "trousers", fitProfile: "tailored", silhouette: "straight", formality: "business-casual", material: "wool" });
}
function relaxedChambrayShirt(name = "Relaxed Chambray Shirt") {
  return item({ name, category: "TOPS", subcategory: "button-up shirt", fitProfile: "relaxed", silhouette: "straight", formality: "business-casual", material: "cotton" });
}
function drapedFlowyMaxiSkirt(name = "Draped Flowy Maxi Skirt") {
  // silhouette "wrap" + a non-soft material deliberately gives this item a
  // much stronger soft-flowing score (fitProfile + silhouette bonus) than
  // relaxed-counterpart score (fitProfile only, no TOPS category bonus) —
  // the real-world asymmetry that makes it a clear Soft Structure pick but
  // only a middling Modern Tailoring one, used to prove genuine divergence
  // below rather than relying on a coincidental tie.
  return item({ name, category: "BOTTOMS", subcategory: "skirt", fitProfile: "flowy", silhouette: "wrap", formality: "smart-casual" });
}
function relaxedButtonDown(name = "Relaxed Button-Down") {
  return item({ name, category: "TOPS", subcategory: "button-up shirt", fitProfile: "relaxed", silhouette: "straight", formality: "business-casual", material: "cotton" });
}
function relaxedLinenTrouser(name = "Relaxed Linen Trouser") {
  // A third, genuinely distinct secondary-role candidate (BOTTOMS/trousers,
  // not TOPS like the shirt or skirt-subcategory like the draped skirt) —
  // used where a test needs real score-driven divergence between Modern
  // Tailoring and Soft Structure without the semantic-novelty dedup logic
  // (Fix #4/#5) stepping in to swap out a near-duplicate first.
  return item({ name, category: "BOTTOMS", subcategory: "trousers", fitProfile: "relaxed", silhouette: "straight", formality: "casual" });
}

describe("Fix #5 — Modern Tailoring Route In uses the real primary + secondary role, not two anchor items", () => {
  it("Route In = tailored-anchor + relaxed-counterpart, not the second tailored-anchor item", () => {
    const closet = [tailoredBlazer(), tailoredTrousers(), relaxedChambrayShirt()];
    const edit = buildShopperEdit(MODERN_TAILORING_REPORT, evidence(closet));
    const routeInNames = edit.routeInItems.map((i) => i.name);
    assert.ok(routeInNames.includes("Tailored Blazer"), "the strongest tailored-anchor item is the anchor");
    assert.ok(routeInNames.includes("Relaxed Chambray Shirt"), "the genuine relaxed-counterpart item is the support");
    assert.ok(!routeInNames.includes("Tailored Trousers"), "a second tailored-anchor item is not used as the support when real relaxed-counterpart evidence exists");
  });
});

describe("Fix #5 — Soft Structure Route In uses structured-anchor + soft-flowing, not two structured items", () => {
  it("Route In = structured-anchor + soft-flowing, not a second structured item", () => {
    const closet = [tailoredBlazer(), tailoredTrousers(), drapedFlowyMaxiSkirt()];
    const edit = buildShopperEdit(SOFT_STRUCTURE_REPORT, evidence(closet));
    const routeInNames = edit.routeInItems.map((i) => i.name);
    assert.ok(routeInNames.includes("Tailored Blazer"), "the strongest structured-anchor item is the anchor");
    assert.ok(routeInNames.includes("Draped Flowy Maxi Skirt"), "the genuine soft-flowing item is the support");
    assert.ok(!routeInNames.includes("Tailored Trousers"), "a second structured item is not used as the support when real soft-flowing evidence exists");
  });
});

describe("Fix #5 — Modern Tailoring and Soft Structure may share a genuine anchor but do not collapse to the same full evidence set", () => {
  it("with more secondary-role candidates than slots, the two reports' differing weights select a genuinely different full evidence set", () => {
    // 2 primary-role items + 3 genuinely distinct secondary-role candidates
    // (one more than the 2 slots available, each a different
    // category/subcategory so Fix #4/#5's own near-duplicate avoidance
    // doesn't itself decide the outcome) — Modern Tailoring's
    // relaxed-counterpart formula favours the TOPS piece (category bonus);
    // Soft Structure's soft-flowing formula favours the wrap-silhouette
    // skirt instead (silhouette bonus, no category bonus to lose). Each
    // report's own weighting decides which candidate it leaves out.
    const closet = [
      tailoredBlazer(), tailoredTrousers(),
      relaxedChambrayShirt(), relaxedLinenTrouser(), drapedFlowyMaxiSkirt(),
    ];
    const mtEdit = buildShopperEdit(MODERN_TAILORING_REPORT, evidence(closet));
    const ssEdit = buildShopperEdit(SOFT_STRUCTURE_REPORT, evidence(closet));

    const mtRouteIn = mtEdit.routeInItems.map((i) => i.name).sort();
    const ssRouteIn = ssEdit.routeInItems.map((i) => i.name).sort();
    assert.notDeepEqual(mtRouteIn, ssRouteIn, "Route In's pairing differs between the two reports even though both may use the same anchor");

    const mtShows = new Set(mtEdit.evidenceClosetItems.map((i) => i.name));
    const ssShows = new Set(ssEdit.evidenceClosetItems.map((i) => i.name));
    assert.notDeepEqual([...mtShows].sort(), [...ssShows].sort(), "Closet Shows' full evidence set differs between the two reports — this is the exact live-QA regression (same 4 items, only reordered)");
    assert.ok(mtShows.has("Relaxed Linen Trouser"), "Modern Tailoring's category-weighted formula keeps the trouser over the skirt");
    assert.ok(ssShows.has("Draped Flowy Maxi Skirt"), "Soft Structure's silhouette-weighted formula surfaces the wrap-silhouette skirt instead");
  });

  it("a blazer that genuinely belongs in both reports may legitimately appear in both — shared anchors are not forced apart", () => {
    const closet = [tailoredBlazer(), relaxedChambrayShirt(), drapedFlowyMaxiSkirt()];
    const mtEdit = buildShopperEdit(MODERN_TAILORING_REPORT, evidence(closet));
    const ssEdit = buildShopperEdit(SOFT_STRUCTURE_REPORT, evidence(closet));
    assert.ok(mtEdit.routeInItems.some((i) => i.name === "Tailored Blazer"), "MT genuinely uses the blazer as its anchor");
    assert.ok(ssEdit.routeInItems.some((i) => i.name === "Tailored Blazer"), "SS genuinely uses the same blazer as its anchor — legitimate reuse, not a bug");
  });
});

describe("Fix #5 — A Look To Try differs meaningfully from Route In for Modern Tailoring and Soft Structure", () => {
  it("Modern Tailoring: A Look To Try prefers a different relaxed-counterpart candidate than Route In used, when one exists", () => {
    const closet = [tailoredBlazer(), relaxedChambrayShirt(), relaxedButtonDown()];
    const edit = buildShopperEdit(MODERN_TAILORING_REPORT, evidence(closet));
    const routeInNames = new Set(edit.routeInItems.map((i) => i.name));
    const lookToTryNames = new Set(edit.lookToTryItems.map((i) => i.name));
    assert.notDeepEqual([...routeInNames].sort(), [...lookToTryNames].sort(), "Route In and A Look To Try use different relaxed-counterpart pieces when two exist");
  });

  it("Soft Structure: A Look To Try prefers a genuinely different composition from Route In when the Closet supports it", () => {
    const closet = [tailoredBlazer(), drapedFlowyMaxiSkirt(), tailoredTrousers()];
    const edit = buildShopperEdit(SOFT_STRUCTURE_REPORT, evidence(closet));
    const routeInNames = new Set(edit.routeInItems.map((i) => i.name));
    const lookToTryNames = new Set(edit.lookToTryItems.map((i) => i.name));
    assert.notDeepEqual([...routeInNames].sort(), [...lookToTryNames].sort(), "Route In and A Look To Try differ when a valid alternative composition exists");
  });
});

describe("Fix #5 — Closet Shows represents evidence from both configured roles for Modern Tailoring and Soft Structure", () => {
  it("Modern Tailoring: Closet Shows includes both a tailored-anchor piece and a relaxed-counterpart piece", () => {
    const closet = [tailoredBlazer(), tailoredTrousers(), relaxedChambrayShirt()];
    const edit = buildShopperEdit(MODERN_TAILORING_REPORT, evidence(closet));
    const shown = new Set(edit.evidenceClosetItems.map((i) => i.name));
    assert.ok(shown.has("Tailored Blazer") || shown.has("Tailored Trousers"), "a tailored-anchor piece is represented");
    assert.ok(shown.has("Relaxed Chambray Shirt"), "the genuine relaxed-counterpart piece is represented, not displaced by a second anchor item");
  });

  it("Soft Structure: Closet Shows includes both a structured-anchor piece and a soft-flowing piece", () => {
    const closet = [tailoredBlazer(), tailoredTrousers(), drapedFlowyMaxiSkirt()];
    const edit = buildShopperEdit(SOFT_STRUCTURE_REPORT, evidence(closet));
    const shown = new Set(edit.evidenceClosetItems.map((i) => i.name));
    assert.ok(shown.has("Tailored Blazer") || shown.has("Tailored Trousers"), "a structured-anchor piece is represented");
    assert.ok(shown.has("Draped Flowy Maxi Skirt"), "the genuine soft-flowing piece is represented, not displaced by a second anchor item");
  });
});

describe("Fix #5 — Worth Investing In cannot declare coverage from category presence alone for Modern Tailoring or Soft Structure", () => {
  it("Modern Tailoring: two tailored-anchor items (OUTERWEAR + BOTTOMS categories both present) with zero relaxed-counterpart evidence is a genuine gap", () => {
    const closet = [tailoredBlazer(), tailoredTrousers()];
    const edit = buildShopperEdit(MODERN_TAILORING_REPORT, evidence(closet));
    assert.equal(edit.worthInvestingStatement, null, "owning OUTERWEAR and BOTTOMS category items is not sufficient — relaxed-counterpart evidence is genuinely missing");
  });

  it("Modern Tailoring: genuine evidence for both roles → a valid no-purchase-needed conclusion", () => {
    const closet = [tailoredBlazer(), relaxedChambrayShirt()];
    const edit = buildShopperEdit(MODERN_TAILORING_REPORT, evidence(closet));
    assert.ok(edit.worthInvestingStatement !== null, "genuine evidence for both roles can produce a valid no-purchase-needed conclusion");
  });

  it("Soft Structure: two structured items (OUTERWEAR + BOTTOMS categories both present) with zero soft-flowing evidence is a genuine gap", () => {
    const closet = [tailoredBlazer(), tailoredTrousers()];
    const edit = buildShopperEdit(SOFT_STRUCTURE_REPORT, evidence(closet));
    assert.equal(edit.worthInvestingStatement, null, "owning OUTERWEAR and BOTTOMS category items is not sufficient — soft-flowing evidence is genuinely missing");
  });

  it("Soft Structure: genuine evidence for both roles → a valid no-purchase-needed conclusion", () => {
    const closet = [tailoredBlazer(), drapedFlowyMaxiSkirt()];
    const edit = buildShopperEdit(SOFT_STRUCTURE_REPORT, evidence(closet));
    assert.ok(edit.worthInvestingStatement !== null, "genuine evidence for both roles can produce a valid no-purchase-needed conclusion");
  });
});
