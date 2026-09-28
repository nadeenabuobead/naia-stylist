// app/lib/ai/wardrobe-recommendations.test.ts
// Run with: node --test --import tsx/esm app/lib/ai/wardrobe-recommendations.test.ts
//
// This suite exists to stop the recommendation sounding more certain than it
// is. Almost everything asserted here is a CEILING, not a floor: how specific
// nAia is allowed to be given the evidence, and what it must refuse to say.
//
// The failure this guards against is fluency. "Work needs more range" inflates
// into "buy white trousers" very easily, and the sentence reads well enough
// that nobody checks whether trousers, white, or straight-leg were ever
// supported by anything.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeWardrobeRecommendations } from "./wardrobe-recommendations.ts";
import { computeWardrobeNeeds } from "./wardrobe-needs.ts";
import type { WardrobeGarment, WardrobePassport } from "./wardrobe-intelligence.ts";

// ── Fixtures ──────────────────────────────────────────────────────────────────

let seq = 0;

function makeGarment(overrides: Partial<WardrobeGarment> = {}): WardrobeGarment {
  seq += 1;
  return {
    id: `g${seq}`, name: `Piece ${seq}`, category: "TOPS", subcategory: null, imageUrl: null,
    slot: "top", primaryColor: "Black", colors: [], pattern: "solid", material: "cotton",
    silhouette: "straight", fitProfile: "relaxed", formality: "casual", stylePersonality: null,
    occasions: ["Weekend"], seasons: [], analysisStatus: "ready", visualWeight: "medium",
    colourProfile: { hueFamily: null, wardrobeNeutral: true, lightDark: "dark", energyTier: "neutral-versatile" },
    garmentRelationships: [], intentions: null, intentionsSource: null, intelligenceSource: "derived",
    sleeveLength: "full", necklineCoverage: "crew", hemLength: "n/a", topLength: "hip-length",
    midriffExposed: false, shoulderCoverage: true, outfitAppearances: 0, savedLookAppearances: 0,
    outcomeKept: 0, outcomeChanged: 0, outcomeNotWorn: 0, observedWear: null,
    ...overrides,
  };
}

const TOP_SHAPES = [
  { silhouette: "fitted", fitProfile: "tailored" }, { silhouette: "oversized", fitProfile: "loose" },
  { silhouette: "boxy", fitProfile: "relaxed" }, { silhouette: "wrap", fitProfile: "fitted" },
  { silhouette: "column", fitProfile: "slim" },
];
const BOTTOM_SHAPES = [
  { silhouette: "straight", fitProfile: "tailored" }, { silhouette: "flared", fitProfile: "flowy" },
  { silhouette: "tapered", fitProfile: "slim" }, { silhouette: "a-line", fitProfile: "relaxed" },
  { silhouette: "balloon", fitProfile: "oversized" },
];

/** n varied complete looks at a register. */
function variedLooks(formality: string, n: number, overrides: Partial<WardrobeGarment> = {}): WardrobeGarment[] {
  const out: WardrobeGarment[] = [];
  for (let i = 0; i < n; i++) {
    out.push(makeGarment({ slot: "top", category: "TOPS", formality, topLength: "hip-length", hemLength: "n/a", ...TOP_SHAPES[i % TOP_SHAPES.length], ...overrides }));
    out.push(makeGarment({ slot: "bottom", category: "BOTTOMS", formality, topLength: "n/a", hemLength: "full", ...BOTTOM_SHAPES[i % BOTTOM_SHAPES.length], ...overrides }));
  }
  return out;
}

function makePassport(overrides: Partial<WardrobePassport> = {}): WardrobePassport {
  return {
    lifestyle: [], favoriteColors: [], avoidColors: [], stylePersonalities: [], silhouette: [],
    structure: null, fitPreferences: [], styleStruggles: [], styleSupport: [], becoming: [],
    ...overrides,
  };
}

function run(items: WardrobeGarment[], passport: WardrobePassport | null) {
  const needs = computeWardrobeNeeds({ items, passport, styleMeSessions: null, outcomes: null });
  return { needs, recs: computeWardrobeRecommendations({ needs, items, passport }) };
}

// ── §WR-1 Nothing is recommended without a gap ────────────────────────────────

describe("§WR-1 a recommendation requires a gap the engine already found", () => {
  it("1 — a wardrobe with no gap gets no recommendation", () => {
    const items = [...variedLooks("casual", 5), ...variedLooks("evening", 4, { hemLength: "maxi" })];
    const { needs, recs } = run(items, makePassport({ lifestyle: ["everyday-casual", "dinners-going-out"] }));

    assert.equal(needs.couldUseMore.length, 0, "fixture really has no gap");
    assert.equal(recs.state, "learning");
    assert.equal(recs.recommendations.length, 0, "nothing to recommend when nothing is missing");
    assert.match(recs.learningNote ?? "", /hasn't found a gap worth shopping for/);
  });

  it("1b — this layer never invents a gap of its own", () => {
    // A Passport that names nothing means the needs engine asserts no gap, so
    // there is nothing here to build a recommendation on.
    const { needs, recs } = run(variedLooks("casual", 5), null);
    assert.equal(needs.couldUseMore.length, 0);
    assert.equal(recs.recommendations.length, 0);
  });

  it("1c — a wardrobe below the minimum recommends nothing", () => {
    const { recs } = run([makeGarment(), makeGarment()], makePassport({ lifestyle: ["work-office"] }));
    assert.equal(recs.state, "learning");
    assert.equal(recs.recommendations.length, 0);
  });
});

// ── §WR-2 The specificity ladder ──────────────────────────────────────────────

describe("§WR-2 specificity is earned, rung by rung", () => {
  it("2 — with no slot-level constraint, nAia stays at a direction and names no garment", () => {
    // Work is named and thin, but tops and bottoms are equally sparse, so
    // nothing identifies WHICH side of the outfit is the problem.
    const items = [
      ...variedLooks("casual", 6),
      makeGarment({ slot: "top", formality: "business-casual" }),
      makeGarment({ slot: "bottom", category: "BOTTOMS", formality: "business-casual", topLength: "n/a", hemLength: "full" }),
    ];
    const { recs } = run(items, makePassport({ lifestyle: ["everyday-casual", "work-office"] }));
    const work = recs.recommendations.find((r) => r.register === "work");

    if (work) {
      assert.equal(work.specificity, "direction", `over-specified: "${work.title}"`);
      assert.equal(work.criteria.slot, null, "no garment type may be named without slot evidence");
      assert.deepEqual(work.attributes, [], "no attributes without a slot");
      assert.match(work.body, /not yet which kind of piece/);
    }
  });

  it("2b — one side of the outfit missing entirely escalates to a slot", () => {
    // Four work tops, zero work bottoms: the constraint is unambiguous.
    const items = [
      ...variedLooks("casual", 6),
      ...Array.from({ length: 4 }, (_, i) =>
        makeGarment({ slot: "top", formality: "business-casual", ...TOP_SHAPES[i % TOP_SHAPES.length] })),
    ];
    const { recs } = run(items, makePassport({ lifestyle: ["everyday-casual", "work-office"] }));
    const work = recs.recommendations.find((r) => r.register === "work");

    assert.ok(work, "a work recommendation should exist");
    assert.equal(work!.criteria.slot, "bottom", "the missing half is the recommendation");
    assert.ok(work!.specificity !== "direction", "slot evidence exists, so it should have escalated");
  });

  it("2c — a colour is only named when she named it", () => {
    const items = [
      ...variedLooks("casual", 6),
      ...Array.from({ length: 4 }, (_, i) =>
        makeGarment({ slot: "top", formality: "business-casual", ...TOP_SHAPES[i % TOP_SHAPES.length] })),
    ];
    const lifestyle = ["everyday-casual", "work-office"];

    const without = run(items, makePassport({ lifestyle })).recs.recommendations.find((r) => r.register === "work");
    assert.ok(without);
    assert.deepEqual(without!.criteria.colourFamilies, [], "no stated colour means no colour claim");
    assert.ok(!without!.attributes.some((a) => a.kind === "colour"));

    const withColour = run(items, makePassport({ lifestyle, favoriteColors: ["black", "grey"] }))
      .recs.recommendations.find((r) => r.register === "work");
    assert.ok(withColour);
    assert.ok(withColour!.criteria.colourFamilies.length > 0, "a stated colour may be used");
    const colourAttr = withColour!.attributes.find((a) => a.kind === "colour");
    assert.ok(colourAttr);
    assert.equal(colourAttr!.source, "passport", "the colour must be attributed to her, not to nAia");
  });

  it("2d — a colour she asked nAia to avoid is never recommended", () => {
    const items = [
      ...variedLooks("casual", 6),
      ...Array.from({ length: 4 }, (_, i) =>
        makeGarment({ slot: "top", formality: "business-casual", ...TOP_SHAPES[i % TOP_SHAPES.length] })),
    ];
    const { recs } = run(items, makePassport({
      lifestyle: ["everyday-casual", "work-office"],
      favoriteColors: ["black", "red-burgundy"],
      avoidColors: ["red-burgundy"],
    }));
    const work = recs.recommendations.find((r) => r.register === "work");
    assert.ok(work);
    assert.ok(!work!.criteria.colourFamilies.includes("red"), "an avoided family must not be proposed");
    assert.ok(!work!.criteria.colourFamilies.includes("burgundy"));
  });

  it("2e — every attribute cites a source, and none of them is invented", () => {
    const items = [
      ...variedLooks("casual", 6),
      ...Array.from({ length: 4 }, (_, i) =>
        makeGarment({ slot: "bottom", category: "BOTTOMS", formality: "business-casual", topLength: "n/a", hemLength: "full", ...BOTTOM_SHAPES[i % BOTTOM_SHAPES.length] })),
    ];
    const { recs } = run(items, makePassport({
      lifestyle: ["everyday-casual", "work-office"],
      favoriteColors: ["black"],
      dressingPreferences: ["arms-covered"],
    }));

    for (const rec of recs.recommendations) {
      for (const attr of rec.attributes) {
        assert.ok(["passport", "closet", "styleme"].includes(attr.source), `uncited attribute: ${attr.kind}`);
        assert.ok(attr.values.length > 0, `attribute "${attr.kind}" carries no value`);
        assert.ok(attr.label.length > 0);
      }
    }
  });

  it("2f — a coverage requirement she stated is carried into the recommendation", () => {
    const items = [
      ...variedLooks("casual", 6),
      ...Array.from({ length: 4 }, (_, i) =>
        makeGarment({ slot: "bottom", category: "BOTTOMS", formality: "evening", topLength: "n/a", hemLength: "maxi", ...BOTTOM_SHAPES[i % BOTTOM_SHAPES.length] })),
    ];
    const { recs } = run(items, makePassport({
      lifestyle: ["everyday-casual", "dinners-going-out"],
      dressingPreferences: ["arms-covered"],
    }));
    const occasion = recs.recommendations.find((r) => r.register === "occasion");
    if (occasion && (occasion.criteria.slot === "top" || occasion.criteria.slot === "dress")) {
      // The requirement is never optional — but it may be stated in the NAME
      // ("a sleeved occasion dress") rather than beside it. criteria is the
      // invariant; where it surfaces is presentation.
      assert.ok(occasion.criteria.coverage.includes("arms-covered"));
      const attr = occasion.attributes.find((a) => a.kind === "coverage");
      const named = /sleeved|higher-necked|full-length|longer|looser/.test(occasion.title);
      assert.ok(attr || named, `stated coverage appears nowhere: "${occasion.title}"`);
      if (attr) assert.equal(attr.source, "passport");
    }
  });
});

// ── §WR-2g Scarcity is not need; difference is not improvement ───────────────

describe("§WR-2g a recommendation is downstream of a proven need", () => {
  it("2g — no outer layer in a wardrobe that works is NOT a reason to recommend one", () => {
    // Zero outerwear, well over 8 core pieces, and both everyday and occasion
    // genuinely covered. The old scarcity rule would have proposed a layer.
    const items = [...variedLooks("casual", 6), ...variedLooks("evening", 4, { hemLength: "maxi" })];
    const { needs, recs } = run(items, makePassport({ lifestyle: ["everyday-casual", "dinners-going-out"] }));

    assert.equal(items.filter((g) => g.slot === "outerwear").length, 0);
    assert.equal(needs.couldUseMore.length, 0, "the wardrobe really has no proven gap");
    assert.equal(recs.recommendations.length, 0, "absence alone must never produce a recommendation");
  });

  it("2h — layering is only proposed where the proven gap is repetition", () => {
    // Work is thin because one half is missing, not because looks repeat.
    const items = [
      ...variedLooks("casual", 6),
      ...Array.from({ length: 4 }, (_, i) =>
        makeGarment({ slot: "top", formality: "business-casual", ...TOP_SHAPES[i % TOP_SHAPES.length] })),
    ];
    const { recs } = run(items, makePassport({ lifestyle: ["everyday-casual", "work-office"] }));
    const work = recs.recommendations.find((r) => r.register === "work");
    assert.ok(work);
    assert.equal(work!.criteria.slot, "bottom", "the missing half, not a layer");
    assert.notEqual(work!.criteria.slot, "outerwear");
  });

  it("2i — a dominant fit family is not on its own a reason to recommend its opposite", () => {
    // Work tops are uniformly tailored. Contrast is only allowed if it opens
    // combinations that do not already exist.
    const items = [
      ...variedLooks("casual", 6),
      ...Array.from({ length: 4 }, () =>
        makeGarment({ slot: "top", formality: "business-casual", fitProfile: "tailored", silhouette: "fitted" })),
    ];
    const { recs } = run(items, makePassport({ lifestyle: ["everyday-casual", "work-office"] }));
    const work = recs.recommendations.find((r) => r.register === "work");
    if (work && work.criteria.structure !== null) {
      // If contrast was proposed at all, it had to strictly increase range.
      assert.ok(work.unlocksIds.length > 0, "contrast must buy something, not just differ");
    }
  });

  it("2j — contrast is never proposed against a fit preference she stated", () => {
    const items = [
      ...variedLooks("casual", 6),
      ...Array.from({ length: 4 }, () =>
        makeGarment({ slot: "top", formality: "business-casual", fitProfile: "relaxed", silhouette: "boxy" })),
    ];
    const { recs } = run(items, makePassport({
      lifestyle: ["everyday-casual", "work-office"],
      dressingPreferences: ["looser-fitting"],
    }));
    for (const rec of recs.recommendations) {
      assert.notEqual(rec.criteria.structure, "structured",
        "she asked for looser-fitting clothes; structured contrast contradicts her");
    }
  });
});

// ── §WR-2k An underrepresented loved colour refines, never creates ───────────

describe("§WR-2k a thin loved colour refines a need; it never invents one", () => {
  it("2k — a loved colour she barely owns does NOT create a shopping need", () => {
    // Everyday and occasion both genuinely covered, so there is no gap at all.
    // She loves black, grey and cream and owns only black. That is an
    // observation about her palette, not a reason to buy anything.
    const items = [...variedLooks("casual", 6), ...variedLooks("evening", 4, { hemLength: "maxi" })];
    const { needs, recs } = run(items, makePassport({
      lifestyle: ["everyday-casual", "dinners-going-out"],
      favoriteColors: ["black", "grey", "white-cream"],
    }));

    assert.equal(needs.couldUseMore.length, 0, "the wardrobe has no proven gap");
    assert.equal(recs.recommendations.length, 0, "a thin colour alone must not produce a purchase");

    // The palette observation still surfaces — it just isn't a shopping need.
    const line = needs.synthesis.lines.find((l) => l.id === "synth-colour");
    assert.ok(line, "the uneven palette is still worth telling her about");
    assert.equal(line!.kind, "uneven");
  });

  it("2l — with a real gap, the thinnest loved colour leads the recommendation", () => {
    // Work genuinely lacks a bottom half. She loves black, grey and cream and
    // owns only black — so a grey work bottom adds an option a black one cannot.
    const items = [
      ...variedLooks("casual", 6),
      ...Array.from({ length: 4 }, (_, i) =>
        makeGarment({ slot: "top", formality: "business-casual", ...TOP_SHAPES[i % TOP_SHAPES.length] })),
    ];
    const { needs, recs } = run(items, makePassport({
      lifestyle: ["everyday-casual", "work-office"],
      favoriteColors: ["black", "grey", "white-cream"],
    }));

    assert.ok(needs.couldUseMore.some((f) => f.register === "work"), "the gap is real and comes first");
    const work = recs.recommendations.find((r) => r.register === "work");
    assert.ok(work);
    assert.equal(work!.criteria.slot, "bottom", "the garment need is established independently");

    // Black is what she already owns; the colours she is short of lead.
    const colours = work!.criteria.colourFamilies;
    assert.ok(colours.length > 0, "a stated palette should refine the colour");
    assert.notEqual(colours[0], "black", `black is already well covered, got "${colours[0]}"`);
  });

  it("2m — with no stated palette, no colour is attached to the recommendation", () => {
    const items = [
      ...variedLooks("casual", 6),
      ...Array.from({ length: 4 }, (_, i) =>
        makeGarment({ slot: "top", formality: "business-casual", ...TOP_SHAPES[i % TOP_SHAPES.length] })),
    ];
    const { recs } = run(items, makePassport({ lifestyle: ["everyday-casual", "work-office"] }));
    const work = recs.recommendations.find((r) => r.register === "work");
    assert.ok(work);
    assert.deepEqual(work!.criteria.colourFamilies, []);
  });
});

// ── §WR-2n Signals that exist must actually be used ──────────────────────────

describe("§WR-2n the ladder uses every signal it already has", () => {
  it("2n — an effective-depth gap names the slot her own coverage rules block", () => {
    // Eight occasion dresses, six ruled out by a preference she stated. The
    // missing capability is diagnosable: a dress that meets her coverage.
    // This previously fell through every branch and reported "not yet which
    // kind of piece would fix it".
    const items = [
      ...variedLooks("casual", 6),
      makeGarment({ slot: "dress", category: "DRESSES", formality: "evening", hemLength: "maxi", topLength: "n/a", silhouette: "column" }),
      makeGarment({ slot: "dress", category: "DRESSES", formality: "evening", hemLength: "maxi", topLength: "n/a", silhouette: "a-line" }),
      ...Array.from({ length: 6 }, () =>
        makeGarment({ slot: "dress", category: "DRESSES", formality: "evening", sleeveLength: "sleeveless", hemLength: "maxi", topLength: "n/a" })),
    ];
    const { needs, recs } = run(items, makePassport({
      lifestyle: ["everyday-casual", "dinners-going-out"],
      dressingPreferences: ["arms-covered"],
    }));

    assert.ok(needs.couldUseMore.some((f) => f.register === "occasion" && f.kind === "effective-depth"));
    const occasion = recs.recommendations.find((r) => r.register === "occasion");
    assert.ok(occasion, "an effective-depth gap is diagnosable and must not stay vague");
    assert.notEqual(occasion!.specificity, "direction", "the blocked-slot signal identifies the garment type");
    assert.equal(occasion!.criteria.slot, "dress");
    assert.ok(occasion!.criteria.coverage.includes("arms-covered"));
    // Either phrasing states the requirement; "sleeved" is the more specific.
    assert.match(occasion!.title, /sleeved|with more coverage/);
  });

  it("2n-2 — a one-piece is not rejected for failing a cross-slot partner test", () => {
    // A dress is a complete look on its own; requiring three owned partners
    // asked the wrong question and suppressed the recommendation entirely.
    const items = [
      ...variedLooks("casual", 6),
      makeGarment({ slot: "dress", category: "DRESSES", formality: "evening", hemLength: "maxi", topLength: "n/a" }),
      makeGarment({ slot: "dress", category: "DRESSES", formality: "evening", hemLength: "maxi", topLength: "n/a" }),
      ...Array.from({ length: 6 }, () =>
        makeGarment({ slot: "dress", category: "DRESSES", formality: "evening", sleeveLength: "sleeveless", hemLength: "maxi", topLength: "n/a" })),
    ];
    const { recs } = run(items, makePassport({
      lifestyle: ["everyday-casual", "dinners-going-out"],
      dressingPreferences: ["arms-covered"],
    }));
    const occasion = recs.recommendations.find((r) => r.register === "occasion");
    assert.ok(occasion);
    assert.match(occasion!.body, /complete look on its own/);
  });

  it("2n-3 — the limiting side is measured in variety, not only in piece count", () => {
    // Five work tops that are all the same top, four bottoms that differ.
    // By count the tops look healthier; by variety they are the bottleneck.
    const items = [
      ...variedLooks("casual", 6),
      ...Array.from({ length: 5 }, () =>
        makeGarment({ slot: "top", formality: "business-casual", silhouette: "fitted", fitProfile: "tailored" })),
      ...Array.from({ length: 4 }, (_, i) =>
        makeGarment({ slot: "bottom", category: "BOTTOMS", formality: "business-casual", topLength: "n/a", hemLength: "full", ...BOTTOM_SHAPES[i % BOTTOM_SHAPES.length] })),
    ];
    const { recs } = run(items, makePassport({ lifestyle: ["everyday-casual", "work-office"] }));
    const work = recs.recommendations.find((r) => r.register === "work");
    if (work && work.criteria.slot !== null && work.criteria.slot !== "outerwear") {
      assert.equal(work.criteria.slot, "top", "the side with one repeated shape is the constraint");
    }
  });

  it("2n-4 — the article agrees with the noun that follows it", () => {
    const items = [
      ...variedLooks("casual", 6),
      makeGarment({ slot: "dress", category: "DRESSES", formality: "evening", hemLength: "maxi", topLength: "n/a" }),
      makeGarment({ slot: "dress", category: "DRESSES", formality: "evening", hemLength: "maxi", topLength: "n/a" }),
      ...Array.from({ length: 6 }, () =>
        makeGarment({ slot: "dress", category: "DRESSES", formality: "evening", sleeveLength: "sleeveless", hemLength: "maxi", topLength: "n/a" })),
    ];
    const { recs } = run(items, makePassport({
      lifestyle: ["everyday-casual", "dinners-going-out"],
      dressingPreferences: ["arms-covered"],
    }));
    for (const rec of recs.recommendations) {
      assert.doesNotMatch(rec.title, /^One option to explore: a [aeiou]/i, `article disagrees: "${rec.title}"`);
    }
  });
});

// ── §WR-2p Live-data regressions ─────────────────────────────────────────────

describe("§WR-2p the partner count and coverage use the right scope", () => {
  it("2p — compatibility is measured across the wardrobe, not only the register", () => {
    // Two work tops, two work bottoms, plus smart-casual tops that scorePair
    // genuinely accepts for a work bottom (one step of dress apart).
    // Measuring only the work register scored 2 against a minimum of 3 and
    // suppressed the recommendation entirely — the level-of-dress rule was
    // being applied twice, once by scorePair and again by the pool.
    const items = [
      ...variedLooks("casual", 4),
      ...Array.from({ length: 3 }, (_, i) =>
        makeGarment({ slot: "top", formality: "smart-casual", ...TOP_SHAPES[i % TOP_SHAPES.length] })),
      // Two work tops of DIFFERENT shapes, two bottoms of the same shape —
      // the live customer's exact profile, where the bottom side is the
      // bottleneck by variety even though both sides hold two pieces.
      makeGarment({ slot: "top", formality: "business-casual", silhouette: "fitted", fitProfile: "tailored" }),
      makeGarment({ slot: "top", formality: "business-casual", silhouette: "boxy", fitProfile: "relaxed" }),
      ...Array.from({ length: 2 }, () =>
        makeGarment({ slot: "bottom", category: "BOTTOMS", formality: "business-casual", topLength: "n/a", hemLength: "full", silhouette: "straight", fitProfile: "tailored" })),
    ];
    const { needs, recs } = run(items, makePassport({ lifestyle: ["everyday-casual", "work-office"] }));

    assert.ok(needs.couldUseMore.some((f) => f.register === "work"), "the gap is real");
    const work = recs.recommendations.find((r) => r.register === "work");
    assert.ok(work, "a diagnosable gap must not be suppressed by a starved partner count");
    assert.ok(work!.unlocksIds.length >= 3, `expected partners beyond the register, got ${work!.unlocksIds.length}`);
  });

  it("2p-2 — a coverage requirement is only attached to garments it can describe", () => {
    // legs-covered describes a bottom or a dress; arms-covered describes a top.
    // A single top/dress gate dropped every leg requirement from bottom
    // recommendations, so "prefers full-length trousers" produced a bottom
    // recommendation with no length at all.
    const items = [
      ...variedLooks("casual", 4),
      ...Array.from({ length: 3 }, (_, i) =>
        makeGarment({ slot: "top", formality: "smart-casual", ...TOP_SHAPES[i % TOP_SHAPES.length] })),
      makeGarment({ slot: "top", formality: "business-casual", silhouette: "fitted", fitProfile: "tailored" }),
      makeGarment({ slot: "top", formality: "business-casual", silhouette: "boxy", fitProfile: "relaxed" }),
      ...Array.from({ length: 2 }, () =>
        makeGarment({ slot: "bottom", category: "BOTTOMS", formality: "business-casual", topLength: "n/a", hemLength: "full", silhouette: "straight", fitProfile: "tailored" })),
    ];
    const { recs } = run(items, makePassport({
      lifestyle: ["everyday-casual", "work-office"],
      dressingPreferences: ["legs-covered", "prefer-full-length-trousers", "arms-covered"],
    }));
    const work = recs.recommendations.find((r) => r.register === "work");
    assert.ok(work);
    if (work!.criteria.slot === "bottom") {
      assert.ok(
        work!.criteria.coverage.includes("legs-covered") ||
          work!.criteria.coverage.includes("prefer-full-length-trousers"),
        "a leg requirement belongs on a bottom",
      );
      assert.ok(!work!.criteria.coverage.includes("arms-covered"), "an arm requirement does not describe a bottom");
      const attrLabel = work!.attributes.find((a) => a.kind === "coverage")?.label ?? "";
      assert.ok(
        /full length/.test(attrLabel) || /full-length/.test(work!.title),
        `length requirement stated nowhere: "${work!.title}" / "${attrLabel}"`,
      );
    }
  });
});

// ── §WR-2q Colours are ranked alternatives, not a specification ──────────────

describe("§WR-2q colour reads as a choice, not a requirement", () => {
  const workGapItems = () => [
    ...variedLooks("casual", 4),
    ...Array.from({ length: 3 }, (_, i) =>
      makeGarment({ slot: "top", formality: "smart-casual", ...TOP_SHAPES[i % TOP_SHAPES.length] })),
    makeGarment({ slot: "top", formality: "business-casual", silhouette: "fitted", fitProfile: "tailored" }),
    makeGarment({ slot: "top", formality: "business-casual", silhouette: "boxy", fitProfile: "relaxed" }),
    ...Array.from({ length: 2 }, () =>
      makeGarment({ slot: "bottom", category: "BOTTOMS", formality: "business-casual", topLength: "n/a", hemLength: "full", silhouette: "straight", fitProfile: "tailored" })),
  ];

  it("2q — the attribute names ONE colour, never a list of three", () => {
    const { recs } = run(workGapItems(), makePassport({
      lifestyle: ["everyday-casual", "work-office"],
      favoriteColors: ["black", "grey", "red-burgundy"],
    }));
    const work = recs.recommendations.find((r) => r.register === "work");
    assert.ok(work);
    const colour = work!.attributes.find((a) => a.kind === "colour");
    assert.ok(colour, "a stated palette should refine the colour");
    // "grey, red and burgundy" read as though one garment must be all three.
    assert.doesNotMatch(colour!.label, /,/, `label lists several colours: "${colour!.label}"`);
    assert.doesNotMatch(colour!.label, /\band\b/, `label reads as a requirement: "${colour!.label}"`);
    // The full set is still exposed for Buy or Skip to match on.
    assert.ok(work!.criteria.colourFamilies.length > 1);
    assert.equal(work!.criteria.colourFamilies[0], colour!.label, "the label is the lead of the ranked set");
  });

  it("2q-2 — the body ranks them, leading with the colour she owns least of", () => {
    const { recs } = run(workGapItems(), makePassport({
      lifestyle: ["everyday-casual", "work-office"],
      favoriteColors: ["black", "grey", "red-burgundy"],
    }));
    const work = recs.recommendations.find((r) => r.register === "work");
    assert.ok(work);
    assert.match(work!.body, /is a colour you said you like\./);
    // Underrepresentation may refine a need; it never creates or proves one.
    assert.doesNotMatch(work!.body, /would add the most|colour you named that your Closet has least of/);
    assert.match(work!.body, /are also within the palette you described/);
    // Alternatives are offered with "or", and only the sentence start is capitalised.
    assert.doesNotMatch(work!.body, /\bor [A-Z]/, "mid-sentence capital in the alternatives");
  });

  it("2q-3 — a single loved colour names no alternatives", () => {
    const { recs } = run(workGapItems(), makePassport({
      lifestyle: ["everyday-casual", "work-office"],
      favoriteColors: ["grey"],
    }));
    const work = recs.recommendations.find((r) => r.register === "work");
    assert.ok(work);
    assert.doesNotMatch(work!.body, /would also sit within the palette/);
  });
});

// ── §WR-2r The coverage requirement names the garment ────────────────────────

describe("§WR-2r coverage belongs in the name, not beside it", () => {
  const bottomGap = () => [
    ...variedLooks("casual", 4),
    ...Array.from({ length: 3 }, (_, i) =>
      makeGarment({ slot: "top", formality: "smart-casual", ...TOP_SHAPES[i % TOP_SHAPES.length] })),
    makeGarment({ slot: "top", formality: "business-casual", silhouette: "fitted", fitProfile: "tailored" }),
    makeGarment({ slot: "top", formality: "business-casual", silhouette: "boxy", fitProfile: "relaxed" }),
    ...Array.from({ length: 2 }, () =>
      makeGarment({ slot: "bottom", category: "BOTTOMS", formality: "business-casual", topLength: "n/a", hemLength: "full", silhouette: "straight", fitProfile: "tailored" })),
  ];

  it("2r — a length requirement becomes an adjective in the title", () => {
    const { recs } = run(bottomGap(), makePassport({
      lifestyle: ["everyday-casual", "work-office"],
      favoriteColors: ["black", "grey"],
      dressingPreferences: ["legs-covered", "prefer-full-length-trousers"],
    }));
    const work = recs.recommendations.find((r) => r.register === "work");
    assert.ok(work);
    assert.match(work!.title, /^One option to explore: a full-length work bottom$/);
    // The attributes line carries the colour alone — the name already says the
    // rest, and "grey · full length" read as two equal tags for one garment.
    assert.ok(!work!.attributes.some((a) => a.kind === "coverage"), "coverage should not be repeated beside the name");
    assert.deepEqual(work!.attributes.map((a) => a.kind), ["colour"]);
  });

  it("2r-2 — the structured payload still carries every stated requirement", () => {
    const { recs } = run(bottomGap(), makePassport({
      lifestyle: ["everyday-casual", "work-office"],
      favoriteColors: ["black", "grey"],
      dressingPreferences: ["legs-covered", "prefer-full-length-trousers"],
    }));
    const work = recs.recommendations.find((r) => r.register === "work");
    assert.ok(work);
    assert.ok(work!.criteria.coverage.includes("legs-covered"), "moving it into the name must not drop it from criteria");
    assert.equal(work!.specificity, "detailed", "a named requirement is still specificity");
  });

  it("2r-3 — a requirement with no adjective form stays on the attributes line", () => {
    // no-cropped-tops has no natural adjective; it must not become
    // "a not cropped work top".
    const items = [
      ...variedLooks("casual", 4),
      ...Array.from({ length: 4 }, (_, i) =>
        makeGarment({ slot: "bottom", category: "BOTTOMS", formality: "business-casual", topLength: "n/a", hemLength: "full", ...BOTTOM_SHAPES[i % BOTTOM_SHAPES.length] })),
    ];
    const { recs } = run(items, makePassport({
      lifestyle: ["everyday-casual", "work-office"],
      dressingPreferences: ["no-cropped-tops"],
    }));
    for (const rec of recs.recommendations) {
      assert.doesNotMatch(rec.title, /not cropped/, `unnatural adjective in title: "${rec.title}"`);
    }
  });

  it("2r-4 — the name never carries the requirement twice", () => {
    const items = [
      ...variedLooks("casual", 4),
      makeGarment({ slot: "dress", category: "DRESSES", formality: "evening", hemLength: "maxi", topLength: "n/a" }),
      ...Array.from({ length: 6 }, () =>
        makeGarment({ slot: "dress", category: "DRESSES", formality: "evening", hemLength: "midi", topLength: "n/a" })),
    ];
    const { recs } = run(items, makePassport({
      lifestyle: ["everyday-casual", "dinners-going-out"],
      dressingPreferences: ["legs-covered"],
    }));
    for (const rec of recs.recommendations) {
      const both = /full-length/.test(rec.title) && /with more coverage/.test(rec.title);
      assert.ok(!both, `requirement stated twice: "${rec.title}"`);
    }
  });
});

// ── §WR-3 A recommendation must actually be usable ────────────────────────────

describe("§WR-3 the proposal has to work with what she owns", () => {
  it("3 — a recommendation reports the pieces it would combine with", () => {
    const items = [
      ...variedLooks("casual", 6),
      ...Array.from({ length: 4 }, (_, i) =>
        makeGarment({ slot: "top", formality: "business-casual", ...TOP_SHAPES[i % TOP_SHAPES.length] })),
    ];
    const { recs } = run(items, makePassport({ lifestyle: ["everyday-casual", "work-office"] }));
    const work = recs.recommendations.find((r) => r.register === "work");
    assert.ok(work);
    assert.ok(work!.unlocksIds.length > 0, "a recommendation must show what it unlocks");
    assert.match(work!.body, /could pair with \d+ pieces? already in your Closet/);
  });

  it("3b — nothing is recommended that would barely combine with anything", () => {
    // Work tops exist but sit at an incompatible level of dress from everything
    // else, so a proposed bottom would unlock almost nothing.
    const items = [
      ...variedLooks("casual", 6),
      makeGarment({ slot: "top", formality: "business-formal" }),
      makeGarment({ slot: "top", formality: "business-formal" }),
    ];
    const { recs } = run(items, makePassport({ lifestyle: ["everyday-casual", "work-office"] }));
    for (const rec of recs.recommendations) {
      if (rec.specificity !== "direction") {
        assert.ok(rec.unlocksIds.length > 0, `${rec.id} recommends a piece that unlocks nothing`);
      }
    }
  });
});

// ── §WR-4 What NOT to buy ─────────────────────────────────────────────────────

describe("§WR-4 the counter-recommendation", () => {
  it("4 — where depth is strong and another area is thin, nAia says what not to buy", () => {
    const items = [
      ...variedLooks("casual", 6),
      ...Array.from({ length: 4 }, (_, i) =>
        makeGarment({ slot: "top", formality: "business-casual", ...TOP_SHAPES[i % TOP_SHAPES.length] })),
    ];
    const { needs, recs } = run(items, makePassport({ lifestyle: ["everyday-casual", "work-office"] }));

    if (needs.enough.length > 0 && needs.couldUseMore.length > 0) {
      assert.equal(recs.notAPriority.length, 1);
      assert.match(recs.notAPriority[0].body, /add very little compared with strengthening your/);
    }
  });

  it("4b — with no thinner area, nothing is called a non-priority", () => {
    const items = [...variedLooks("casual", 6), ...variedLooks("evening", 4, { hemLength: "maxi" })];
    const { recs } = run(items, makePassport({ lifestyle: ["everyday-casual", "dinners-going-out"] }));
    assert.deepEqual(recs.notAPriority, [], "nothing to trade against means no counter-recommendation");
  });
});

// ── §WR-5 Structured output for a future Buy or Skip ──────────────────────────

describe("§WR-5 machine-readable criteria", () => {
  it("5 — every recommendation exposes criteria that can be matched without parsing prose", () => {
    const items = [
      ...variedLooks("casual", 6),
      ...Array.from({ length: 4 }, (_, i) =>
        makeGarment({ slot: "top", formality: "business-casual", ...TOP_SHAPES[i % TOP_SHAPES.length] })),
    ];
    const { recs } = run(items, makePassport({ lifestyle: ["everyday-casual", "work-office"], favoriteColors: ["black"] }));

    for (const rec of recs.recommendations) {
      assert.ok(["everyday", "work", "occasion"].includes(rec.criteria.register));
      assert.ok(Array.isArray(rec.criteria.colourFamilies));
      assert.ok(Array.isArray(rec.criteria.coverage));
      assert.ok(rec.criteria.structure === null || ["structured", "soft"].includes(rec.criteria.structure));
      // The prose and the criteria must agree: a colour named in one is named
      // in the other, so Buy or Skip and the page can never disagree.
      const namesColour = rec.attributes.some((a) => a.kind === "colour");
      assert.equal(namesColour, rec.criteria.colourFamilies.length > 0);
    }
  });

  it("5b — a direction-only recommendation commits to nothing in its criteria", () => {
    const items = [
      ...variedLooks("casual", 6),
      makeGarment({ slot: "top", formality: "business-casual" }),
      makeGarment({ slot: "bottom", category: "BOTTOMS", formality: "business-casual", topLength: "n/a", hemLength: "full" }),
    ];
    const { recs } = run(items, makePassport({ lifestyle: ["everyday-casual", "work-office"] }));
    for (const rec of recs.recommendations.filter((r) => r.specificity === "direction")) {
      assert.equal(rec.criteria.slot, null);
      assert.deepEqual(rec.criteria.colourFamilies, []);
      assert.equal(rec.criteria.structure, null);
      assert.deepEqual(rec.criteria.coverage, []);
    }
  });
});

// ── §WR-6 No fashion rules, no psychology ─────────────────────────────────────

describe("§WR-6 nAia does not invent reasons", () => {
  it("6 — no recommendation asserts a fashion rule or a personality claim", () => {
    const items = [
      ...variedLooks("casual", 6),
      ...Array.from({ length: 4 }, (_, i) =>
        makeGarment({ slot: "top", formality: "business-casual", ...TOP_SHAPES[i % TOP_SHAPES.length] })),
    ];
    const { recs } = run(items, makePassport({
      lifestyle: ["everyday-casual", "work-office"],
      favoriteColors: ["black"],
      styleDirections: ["minimal"],
    }));

    const prose = [
      ...recs.recommendations.map((r) => `${r.title} ${r.body}`),
      ...recs.notAPriority.map((n) => `${n.title} ${n.body}`),
    ].join(" ").toLowerCase();

    // Psychological leaps: "because you are calm, you need…"
    for (const phrase of ["because you're", "because you are", "your personality", "people like you", "you seem"]) {
      assert.ok(!prose.includes(phrase), `psychological leap: "${phrase}"`);
    }
    // Fashion rules stated as fact.
    for (const phrase of ["every wardrobe needs", "a must-have", "essential piece", "the rule is", "you should always"]) {
      assert.ok(!prose.includes(phrase), `invented fashion rule: "${phrase}"`);
    }
  });

  it("6b — the reason given is always about combinations, not about taste", () => {
    const items = [
      ...variedLooks("casual", 6),
      ...Array.from({ length: 4 }, (_, i) =>
        makeGarment({ slot: "top", formality: "business-casual", ...TOP_SHAPES[i % TOP_SHAPES.length] })),
    ];
    const { recs } = run(items, makePassport({ lifestyle: ["everyday-casual", "work-office"] }));
    for (const rec of recs.recommendations.filter((r) => r.specificity !== "direction")) {
      assert.match(rec.body, /adds ways to dress rather than another version of something you have/);
    }
  });
});
