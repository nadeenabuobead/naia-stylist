// app/lib/ai/closet-insights.test.ts
// V2-A4 certification suite for the deterministic Closet Insights engine.
// Run with: node --test --import tsx/esm app/lib/ai/closet-insights.test.ts

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeClosetInsights,
  type ClosetItemSnapshot,
  type ClosetInsightProfile,
} from "./closet-insights.ts";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeItem(overrides: Partial<ClosetItemSnapshot> = {}): ClosetItemSnapshot {
  return {
    id: overrides.id ?? "item-1",
    category: overrides.category ?? "TOPS",
    primaryColor: overrides.primaryColor ?? null,
    occasions: overrides.occasions ?? null,
    seasons: overrides.seasons ?? null,
    garmentRelationships: overrides.garmentRelationships ?? [],
    silhouette: overrides.silhouette ?? null,
    fitProfile: overrides.fitProfile ?? null,
    formality: overrides.formality ?? null,
    stylePersonality: overrides.stylePersonality ?? null,
    pattern: overrides.pattern ?? null,
  };
}

function makeItems(count: number, overrides: Partial<ClosetItemSnapshot> = {}): ClosetItemSnapshot[] {
  return Array.from({ length: count }, (_, i) =>
    makeItem({ ...overrides, id: `item-${i + 1}` }),
  );
}

const emptyProfile: ClosetInsightProfile = {
  lifestyle: [],
  styleStruggles: [],
  styleSupport: [],
  favoriteColors: [],
  avoidColors: [],
  stylePersonalities: [],
  desiredImpression: [],
  desiredFeelings: [],
  becoming: [],
  passportSilhouette: [],
  passportStructure: null,
  passportFitPreferences: [],
};

// ── CI.1 — 0 items → ineligible ───────────────────────────────────────────────
describe("CI.1 — 0 items", () => {
  it("returns compositionEligible false and no insights", () => {
    const result = computeClosetInsights([], null);
    assert.equal(result.dataQuality.compositionEligible, false);
    assert.equal(result.dataQuality.totalItems, 0);
    assert.deepEqual(result.insights, []);
  });
});

// ── CI.2 — 4 items → ineligible ───────────────────────────────────────────────
describe("CI.2 — 4 items", () => {
  it("returns compositionEligible false and no insights", () => {
    const result = computeClosetInsights(makeItems(4), null);
    assert.equal(result.dataQuality.compositionEligible, false);
    assert.deepEqual(result.insights, []);
  });
});

// ── CI.3 — 5 items → compositionEligible ─────────────────────────────────────
describe("CI.3 — 5 items", () => {
  it("returns compositionEligible true", () => {
    const result = computeClosetInsights(makeItems(5), null);
    assert.equal(result.dataQuality.compositionEligible, true);
    assert.equal(result.dataQuality.totalItems, 5);
  });
});

// ── CI.4 — category below 50% → no concentration ─────────────────────────────
describe("CI.4 — category below 50%", () => {
  it("does not emit category-concentration when top category < 50%", () => {
    // 4 TOPS (40%), 6 BOTTOMS (60%) → BOTTOMS has 60% and qualifies
    // but 4 TOPS out of 10 total → TOPS below 50%
    // Here: 4 TOPS, 4 BOTTOMS, 2 SHOES → no category ≥50%
    const items = [
      ...makeItems(4, { category: "TOPS" }),
      ...makeItems(4, { category: "BOTTOMS" }).map((i, idx) => ({ ...i, id: `b-${idx}` })),
      ...makeItems(2, { category: "SHOES" }).map((i, idx) => ({ ...i, id: `s-${idx}` })),
    ];
    const result = computeClosetInsights(items, emptyProfile);
    assert.equal(result.dataQuality.compositionEligible, true);
    assert.equal(result.insights.find((i) => i.type === "category-concentration"), undefined);
  });

  it("does not emit when top category is at 40% of 10 items", () => {
    const items = [
      ...makeItems(4, { category: "TOPS" }),
      ...makeItems(6, { category: "BOTTOMS" }).map((i, idx) => ({ ...i, id: `b-${idx}` })),
    ];
    const result = computeClosetInsights(items, emptyProfile);
    // BOTTOMS: 6/10 = 60% ≥ 50%, 6 ≥ 3 → should fire for BOTTOMS
    const cat = result.insights.find((i) => i.type === "category-concentration");
    assert.ok(cat, "BOTTOMS should fire");
    assert.ok(cat!.claim.includes("bottoms"));
    // TOPS: 4/10 = 40% → should NOT be the concentration leader
    assert.ok(!cat!.claim.includes("tops"));
  });
});

// ── CI.5 — category ≥50% and ≥3, unique → concentration fires ────────────────
describe("CI.5 — category concentration fires", () => {
  it("fires when a single category holds 60% of 5 items", () => {
    const items = [
      ...makeItems(3, { category: "TOPS" }),
      ...makeItems(2, { category: "BOTTOMS" }).map((i, idx) => ({ ...i, id: `b-${idx}` })),
    ];
    const result = computeClosetInsights(items, emptyProfile);
    const cat = result.insights.find((i) => i.type === "category-concentration");
    assert.ok(cat, "concentration insight should be present");
    assert.ok(cat!.claim.includes("tops"), `claim: ${cat!.claim}`);
    assert.ok(cat!.claim.includes("3"), `claim: ${cat!.claim}`);
    assert.ok(cat!.claim.includes("5"), `claim: ${cat!.claim}`);
  });

  it("claim uses lowercase category label", () => {
    const items = [
      ...makeItems(3, { category: "DRESSES" }),
      ...makeItems(2, { category: "SHOES" }).map((i, idx) => ({ ...i, id: `s-${idx}` })),
    ];
    const result = computeClosetInsights(items, emptyProfile);
    const cat = result.insights.find((i) => i.type === "category-concentration");
    assert.ok(cat);
    assert.ok(cat!.claim.includes("dresses"), `expected lowercase, got: ${cat!.claim}`);
    assert.ok(!cat!.claim.includes("DRESSES"), "should not contain uppercase category");
  });
});

// ── CI.6 — 50/50 category tie → no concentration ─────────────────────────────
describe("CI.6 — 50/50 category tie", () => {
  it("does not emit when two categories are tied at 50%", () => {
    const items = [
      ...makeItems(5, { category: "TOPS" }),
      ...makeItems(5, { category: "BOTTOMS" }).map((i, idx) => ({ ...i, id: `b-${idx}` })),
    ];
    const result = computeClosetInsights(items, emptyProfile);
    assert.equal(result.insights.find((i) => i.type === "category-concentration"), undefined);
  });

  it("does not emit when two categories are tied at 3 items in 6 total (50%)", () => {
    const items = [
      ...makeItems(3, { category: "TOPS" }),
      ...makeItems(3, { category: "BOTTOMS" }).map((i, idx) => ({ ...i, id: `b-${idx}` })),
    ];
    const result = computeClosetInsights(items, emptyProfile);
    assert.equal(result.insights.find((i) => i.type === "category-concentration"), undefined);
  });
});

// ── CI.7 — colour coverage <60% → palette ineligible ─────────────────────────
describe("CI.7 — colour coverage below threshold", () => {
  it("does not emit palette insights when colour coverage is 40% of 5 items", () => {
    const items = [
      makeItem({ id: "1", primaryColor: "Black" }),
      makeItem({ id: "2", primaryColor: "Grey" }),
      makeItem({ id: "3", primaryColor: null }),
      makeItem({ id: "4", primaryColor: null }),
      makeItem({ id: "5", primaryColor: null }),
    ];
    const result = computeClosetInsights(items, emptyProfile);
    assert.equal(result.dataQuality.paletteEligible, false);
    assert.equal(result.insights.filter((i) => i.type === "palette-distribution").length, 0);
  });
});

// ── CI.8 — colour coverage 60% → palette eligible ────────────────────────────
describe("CI.8 — colour coverage at threshold", () => {
  it("emits palette-distribution when exactly 60% of items have recorded colour", () => {
    const items = [
      makeItem({ id: "1", primaryColor: "Black" }),
      makeItem({ id: "2", primaryColor: "Black" }),
      makeItem({ id: "3", primaryColor: "Grey" }),
      makeItem({ id: "4", primaryColor: null }),
      makeItem({ id: "5", primaryColor: null }),
    ];
    const result = computeClosetInsights(items, emptyProfile);
    assert.equal(result.dataQuality.paletteEligible, true);
    assert.equal(result.dataQuality.colouredItems, 3);
    assert.ok(result.insights.some((i) => i.type === "palette-distribution"));
  });
});

// ── CI.9 — dominant colour ≥2 AND ≥40% ───────────────────────────────────────
describe("CI.9 — dominant colour", () => {
  it("names the dominant colour when one colour meets both thresholds", () => {
    const items = [
      makeItem({ id: "1", primaryColor: "Black" }),
      makeItem({ id: "2", primaryColor: "Black" }),
      makeItem({ id: "3", primaryColor: "Black" }),
      makeItem({ id: "4", primaryColor: "White" }),
      makeItem({ id: "5", primaryColor: "Grey" }),
    ];
    const result = computeClosetInsights(items, emptyProfile);
    const palette = result.insights.find((i) => i.type === "palette-distribution");
    assert.ok(palette);
    assert.ok(palette!.claim.includes("Black"), `claim: ${palette!.claim}`);
    assert.ok(palette!.claim.includes("3"), `claim: ${palette!.claim}`);
  });

  it("names unique leader when counts differ", () => {
    const items = [
      makeItem({ id: "1", primaryColor: "Navy" }),
      makeItem({ id: "2", primaryColor: "Navy" }),
      makeItem({ id: "3", primaryColor: "Navy" }),
      makeItem({ id: "4", primaryColor: "Black" }),
      makeItem({ id: "5", primaryColor: "Black" }),
    ];
    const result = computeClosetInsights(items, emptyProfile);
    const palette = result.insights.find((i) => i.type === "palette-distribution");
    assert.ok(palette);
    assert.ok(palette!.claim.includes("Navy"), `claim: ${palette!.claim}`);
  });
});

// ── CI.10 — mixed palette when no colour qualifies ───────────────────────────
describe("CI.10 — mixed palette", () => {
  it("emits spread claim when no single colour meets dominant thresholds", () => {
    // 5 items each a different colour → none ≥ 40%
    const items = [
      makeItem({ id: "1", primaryColor: "Black" }),
      makeItem({ id: "2", primaryColor: "White" }),
      makeItem({ id: "3", primaryColor: "Grey" }),
      makeItem({ id: "4", primaryColor: "Navy" }),
      makeItem({ id: "5", primaryColor: "Green" }),
    ];
    const result = computeClosetInsights(items, emptyProfile);
    const palette = result.insights.find((i) => i.type === "palette-distribution");
    assert.ok(palette);
    assert.ok(
      palette!.claim.toLowerCase().includes("spread") ||
      palette!.claim.toLowerCase().includes("multiple") ||
      palette!.claim.toLowerCase().includes("varied"),
      `claim should describe a mixed palette: ${palette!.claim}`,
    );
  });

  it("emits spread claim when two colours tie at the dominant threshold", () => {
    // 5 items: 2 Black (40%), 2 White (40%), 1 Grey — tie at top
    const items = [
      makeItem({ id: "1", primaryColor: "Black" }),
      makeItem({ id: "2", primaryColor: "Black" }),
      makeItem({ id: "3", primaryColor: "White" }),
      makeItem({ id: "4", primaryColor: "White" }),
      makeItem({ id: "5", primaryColor: "Grey" }),
    ];
    const result = computeClosetInsights(items, emptyProfile);
    const palette = result.insights.find((i) => i.type === "palette-distribution");
    assert.ok(palette);
    assert.ok(
      !palette!.claim.includes("most represented"),
      `should not name a single dominant colour: ${palette!.claim}`,
    );
  });
});

// ── CI.11 — colour normalization ──────────────────────────────────────────────
describe("CI.11 — colour normalization", () => {
  it("matches Black quiz ID to Black Closet display value — merged into palette claim when dominant", () => {
    // All 5 items are Black → Black is palette leader AND a favourite → merged
    const items = makeItems(5, { primaryColor: "Black" });
    const profile: ClosetInsightProfile = {
      ...emptyProfile,
      favoriteColors: ["black"],
    };
    const result = computeClosetInsights(items, profile);
    // No separate favourite-colour-black insight — it's merged into palette-distribution
    assert.equal(result.insights.find((i) => i.id === "favourite-colour-black"), undefined,
      "should NOT emit separate favourite-colour-black when Black is palette leader");
    const palette = result.insights.find((i) => i.type === "palette-distribution");
    assert.ok(palette, "palette-distribution should exist");
    assert.ok(palette!.claim.includes("Black"), `claim: ${palette!.claim}`);
    assert.ok(palette!.claim.toLowerCase().includes("favourite"), `palette claim should mention 'favourite': ${palette!.claim}`);
  });

  it("matches grey, navy, green, pink, yellow, orange quiz IDs to their Closet display values", () => {
    // When all 5 items share the same colour, that colour is the palette leader AND a favourite.
    // The palette-distribution claim absorbs the favourite fact; no separate favourite insight fires.
    const colourPairs: [string, string][] = [
      ["grey", "Grey"], ["navy", "Navy"], ["green", "Green"],
      ["pink", "Pink"], ["yellow", "Yellow"], ["orange", "Orange"],
    ];
    for (const [quizId, displayValue] of colourPairs) {
      const items = makeItems(5, { primaryColor: displayValue });
      const profile: ClosetInsightProfile = { ...emptyProfile, favoriteColors: [quizId] };
      const result = computeClosetInsights(items, profile);
      // No separate favourite insight — merged into palette-distribution
      assert.equal(result.insights.find((i) => i.id === `favourite-colour-${quizId}`), undefined,
        `${quizId} is palette leader — separate favourite insight must be suppressed`);
      const palette = result.insights.find((i) => i.type === "palette-distribution");
      assert.ok(palette, `palette-distribution should exist for ${quizId}`);
      assert.ok(palette!.claim.includes(displayValue), `claim should mention ${displayValue}: ${palette!.claim}`);
    }
  });

  it("emits no comparison for unmappable quiz IDs (white-cream, beige-brown, red-burgundy, prints, colorful)", () => {
    const items = makeItems(5, { primaryColor: "White" });
    const profile: ClosetInsightProfile = {
      ...emptyProfile,
      favoriteColors: ["white-cream", "beige-brown", "red-burgundy", "prints", "colorful"],
    };
    const result = computeClosetInsights(items, profile);
    const favInsights = result.insights.filter((i) => i.type === "favourite-colour-comparison");
    assert.equal(favInsights.length, 0, "unmappable IDs should produce no insights");
  });
});

// ── CI.12 — favourite absent → factual absence only ──────────────────────────
describe("CI.12 — favourite colour absent", () => {
  it("emits factual absence claim without gap/need/buy language", () => {
    const items = makeItems(5, { primaryColor: "White" });
    const profile: ClosetInsightProfile = { ...emptyProfile, favoriteColors: ["black"] };
    const result = computeClosetInsights(items, profile);
    const fav = result.insights.find((i) => i.id === "favourite-colour-black");
    assert.ok(fav, "should emit absence insight");
    assert.ok(fav!.claim.includes("isn't currently represented"), `claim: ${fav!.claim}`);
    const lower = fav!.claim.toLowerCase();
    assert.ok(!lower.includes("gap"), `no gap language: ${fav!.claim}`);
    assert.ok(!lower.includes("need"), `no need language: ${fav!.claim}`);
    assert.ok(!lower.includes("buy"), `no buy language: ${fav!.claim}`);
    assert.ok(!lower.includes("missing"), `no missing language: ${fav!.claim}`);
  });
});

// ── CI.13 — avoided colour absent → no insight ───────────────────────────────
describe("CI.13 — avoided colour absent from closet", () => {
  it("emits no avoided-colour insight when the colour is not in the closet", () => {
    const items = makeItems(5, { primaryColor: "White" });
    const profile: ClosetInsightProfile = { ...emptyProfile, avoidColors: ["black"] };
    const result = computeClosetInsights(items, profile);
    assert.equal(result.insights.filter((i) => i.type === "avoided-colour-mismatch").length, 0);
  });
});

// ── CI.14 — avoided colour present → factual mismatch ────────────────────────
describe("CI.14 — avoided colour present in closet", () => {
  it("emits avoided-colour-mismatch claim when the colour is present", () => {
    const items = [
      makeItem({ id: "1", primaryColor: "Orange" }),
      makeItem({ id: "2", primaryColor: "Orange" }),
      makeItem({ id: "3", primaryColor: "White" }),
      makeItem({ id: "4", primaryColor: "White" }),
      makeItem({ id: "5", primaryColor: "White" }),
    ];
    const profile: ClosetInsightProfile = { ...emptyProfile, avoidColors: ["orange"] };
    const result = computeClosetInsights(items, profile);
    const avoided = result.insights.find((i) => i.id === "avoided-colour-orange");
    assert.ok(avoided, "should emit avoided-colour-orange insight");
    assert.ok(avoided!.claim.includes("orange"), `claim: ${avoided!.claim}`);
    assert.ok(avoided!.claim.includes("2"), `claim should mention count: ${avoided!.claim}`);
    assert.ok(avoided!.passportEffects.some((e) => e.field === "avoidColors" && e.matchedId === "orange"));
  });
});

// ── CI.15 — occasion coverage <60% → no occasion claim ───────────────────────
describe("CI.15 — occasion coverage below threshold", () => {
  it("does not emit occasion insight when <60% of items have occasion tags", () => {
    const items = [
      makeItem({ id: "1", occasions: ["Work"] }),
      makeItem({ id: "2", occasions: ["Casual"] }),
      makeItem({ id: "3", occasions: null }),
      makeItem({ id: "4", occasions: null }),
      makeItem({ id: "5", occasions: null }),
    ];
    const profile: ClosetInsightProfile = { ...emptyProfile, lifestyle: ["events"] };
    const result = computeClosetInsights(items, profile);
    assert.equal(result.dataQuality.occasionEligible, false);
    assert.equal(result.insights.find((i) => i.type === "occasion-coverage"), undefined);
  });
});

// ── CI.16 — lifestyle events + zero relevant → limited-support claim ──────────
describe("CI.16 — lifestyle events, zero relevant occasion items", () => {
  it("emits occasion-coverage with 'supports less strongly' phrasing when count is zero", () => {
    const items = [
      makeItem({ id: "1", occasions: ["Work"] }),
      makeItem({ id: "2", occasions: ["Casual"] }),
      makeItem({ id: "3", occasions: ["Weekend"] }),
      makeItem({ id: "4", occasions: ["Work"] }),
      makeItem({ id: "5", occasions: ["Casual"] }),
    ];
    // lifestyle = events → Dinner, Party, Formal, Date
    // None of the items are tagged for those occasions
    const profile: ClosetInsightProfile = { ...emptyProfile, lifestyle: ["events"] };
    const result = computeClosetInsights(items, profile);
    const occ = result.insights.find((i) => i.type === "occasion-coverage");
    assert.ok(occ, "should emit occasion insight");
    assert.ok(
      occ!.claim.includes("none") || occ!.claim.includes("0"),
      `claim should reflect zero relevant items: ${occ!.claim}`,
    );
    assert.ok(
      occ!.claim.toLowerCase().includes("less strongly") || occ!.claim.toLowerCase().includes("none"),
      `claim: ${occ!.claim}`,
    );
  });
});

// ── CI.17 — 1-2 relevant items → limited representation ──────────────────────
describe("CI.17 — 1 relevant occasion item", () => {
  it("emits limited-coverage phrasing when only 1 item matches lifestyle occasions", () => {
    const items = [
      makeItem({ id: "1", occasions: ["Dinner"] }),    // relevant for events
      makeItem({ id: "2", occasions: ["Work"] }),
      makeItem({ id: "3", occasions: ["Casual"] }),
      makeItem({ id: "4", occasions: ["Weekend"] }),
      makeItem({ id: "5", occasions: ["Work"] }),
    ];
    const profile: ClosetInsightProfile = { ...emptyProfile, lifestyle: ["events"] };
    const result = computeClosetInsights(items, profile);
    const occ = result.insights.find((i) => i.type === "occasion-coverage");
    assert.ok(occ, "should emit occasion insight");
    assert.ok(
      occ!.claim.includes("1"),
      `claim should mention count 1: ${occ!.claim}`,
    );
    assert.ok(
      occ!.claim.toLowerCase().includes("limited"),
      `claim should include 'limited': ${occ!.claim}`,
    );
  });
});

// ── CI.18 — 3+ relevant items → factual count ────────────────────────────────
describe("CI.18 — 3 relevant occasion items", () => {
  it("emits factual count claim when 3 items match lifestyle occasions", () => {
    const items = [
      makeItem({ id: "1", occasions: ["Dinner"] }),
      makeItem({ id: "2", occasions: ["Party"] }),
      makeItem({ id: "3", occasions: ["Formal"] }),
      makeItem({ id: "4", occasions: ["Work"] }),
      makeItem({ id: "5", occasions: ["Casual"] }),
    ];
    const profile: ClosetInsightProfile = { ...emptyProfile, lifestyle: ["events"] };
    const result = computeClosetInsights(items, profile);
    const occ = result.insights.find((i) => i.type === "occasion-coverage");
    assert.ok(occ, "should emit occasion insight");
    assert.ok(occ!.claim.includes("3"), `claim: ${occ!.claim}`);
    assert.ok(
      !occ!.claim.toLowerCase().includes("limited"),
      `factual claim should not say limited: ${occ!.claim}`,
    );
  });
});

// ── CI.19 — readLifestyle multi-value ────────────────────────────────────────
describe("CI.19 — multi-value lifestyle", () => {
  it("unions relevant occasions across multiple lifestyle IDs", () => {
    // lifestyle = ["events","office"] → occasions: Dinner,Party,Formal,Date,Work
    const items = [
      makeItem({ id: "1", occasions: ["Dinner"] }),   // events
      makeItem({ id: "2", occasions: ["Work"] }),     // office
      makeItem({ id: "3", occasions: ["Work"] }),     // office
      makeItem({ id: "4", occasions: ["Casual"] }),
      makeItem({ id: "5", occasions: ["Weekend"] }),
    ];
    const profile: ClosetInsightProfile = { ...emptyProfile, lifestyle: ["events", "office"] };
    const result = computeClosetInsights(items, profile);
    const occ = result.insights.find((i) => i.type === "occasion-coverage");
    assert.ok(occ, "should emit occasion insight for multi-value lifestyle");
    // Dinner (events) + Work x2 (office) = 3 relevant
    assert.ok(occ!.claim.includes("3"), `should count 3 relevant: ${occ!.claim}`);
    // Passport effect should reference both lifestyle IDs
    const lifestyleEffect = occ!.passportEffects.find((e) => e.field === "lifestyle");
    assert.ok(lifestyleEffect, "should have lifestyle passport effect");
    assert.ok(
      lifestyleEffect!.matchedId.includes("events") && lifestyleEffect!.matchedId.includes("office"),
      `matchedId: ${lifestyleEffect!.matchedId}`,
    );
  });
});

// ── CI.20 — season wording scopes to recorded information ─────────────────────
describe("CI.20 — season claim wording", () => {
  it("claim says 'recorded season information' not just 'items'", () => {
    const items = [
      makeItem({ id: "1", seasons: ["Spring"] }),
      makeItem({ id: "2", seasons: ["Summer"] }),
      makeItem({ id: "3", seasons: ["Spring"] }),
      makeItem({ id: "4", seasons: ["Summer"] }),
      makeItem({ id: "5", seasons: ["Spring"] }),
    ];
    // Spring and Summer covered; Fall and Winter not covered
    const result = computeClosetInsights(items, emptyProfile);
    const season = result.insights.find((i) => i.type === "season-coverage");
    assert.ok(season, "should emit season insight");
    assert.ok(
      season!.claim.includes("recorded season information"),
      `claim must say 'recorded season information': ${season!.claim}`,
    );
    assert.ok(season!.claim.includes("Fall"), `should mention Fall: ${season!.claim}`);
    assert.ok(season!.claim.includes("Winter"), `should mention Winter: ${season!.claim}`);
  });

  it("All Season items count toward seasonal coverage", () => {
    const items = [
      makeItem({ id: "1", seasons: ["All Season"] }),
      makeItem({ id: "2", seasons: ["Spring"] }),
      makeItem({ id: "3", seasons: ["Summer"] }),
      makeItem({ id: "4", seasons: ["All Season"] }),
      makeItem({ id: "5", seasons: ["All Season"] }),
    ];
    // All Season covers Spring, Summer, Fall, Winter — no uncovered seasons
    const result = computeClosetInsights(items, emptyProfile);
    const season = result.insights.find((i) => i.type === "season-coverage");
    assert.equal(season, undefined, "should not emit season insight when All Season covers gaps");
  });
});

// ── CI.21 — event struggle promotes existing occasion insight ─────────────────
describe("CI.21 — event struggle passport effect", () => {
  it("adds prioritised passportEffect to occasion insight when event is in styleStruggles", () => {
    const items = makeItems(5, { occasions: ["Dinner"] });
    const profile: ClosetInsightProfile = {
      ...emptyProfile,
      lifestyle: ["events"],
      styleStruggles: ["event"],
    };
    const result = computeClosetInsights(items, profile);
    const occ = result.insights.find((i) => i.type === "occasion-coverage");
    assert.ok(occ, "occasion insight should exist");
    const effect = occ!.passportEffects.find(
      (e) => e.field === "styleStruggles" && e.matchedId === "event",
    );
    assert.ok(effect, "should have event passportEffect");
    assert.equal(effect!.effect, "prioritised");
  });

  it("does NOT change the position of the occasion insight in the output", () => {
    const items = [
      ...makeItems(3, { category: "TOPS" }),
      ...makeItems(2, { category: "BOTTOMS" }).map((i, idx) => ({ ...i, id: `b-${idx}`, occasions: ["Dinner"] as string[] })),
    ];
    const allItems = items.map((it, idx) => ({
      ...it,
      id: `item-${idx}`,
      occasions: idx < 3 ? ["Dinner"] as string[] : it.occasions,
    }));
    const profile: ClosetInsightProfile = {
      ...emptyProfile,
      lifestyle: ["events"],
      styleStruggles: ["event"],
    };
    const result = computeClosetInsights(allItems, profile);
    if (result.insights.length >= 2) {
      assert.equal(result.insights[0].type, "occasion-coverage");
    }
  });
});

// ── CI.22 — event struggle without occasion insight → no effect ───────────────
describe("CI.22 — event struggle with no occasion insight", () => {
  it("does not create an occasion insight when occasionEligible is false", () => {
    // Only 2 of 5 items have occasion tags (40% → ineligible)
    const items = [
      makeItem({ id: "1", occasions: ["Dinner"] }),
      makeItem({ id: "2", occasions: ["Party"] }),
      makeItem({ id: "3" }),
      makeItem({ id: "4" }),
      makeItem({ id: "5" }),
    ];
    const profile: ClosetInsightProfile = {
      ...emptyProfile,
      lifestyle: ["events"],
      styleStruggles: ["event"],
    };
    const result = computeClosetInsights(items, profile);
    assert.equal(result.dataQuality.occasionEligible, false);
    assert.equal(result.insights.find((i) => i.type === "occasion-coverage"), undefined);
  });
});

// ── CI.23 — dont-style creates nothing ───────────────────────────────────────
describe("CI.23 — dont-style struggle has no effect", () => {
  it("dont-style does not create or modify any insight", () => {
    const items = makeItems(5);
    const profileWith = { ...emptyProfile, styleStruggles: ["dont-style"] };
    const profileWithout = { ...emptyProfile };
    const with_ = computeClosetInsights(items, profileWith);
    const without = computeClosetInsights(items, profileWithout);
    assert.deepEqual(with_.insights, without.insights);
  });
});

// ── CI.24 — other struggles have no effect ────────────────────────────────────
describe("CI.24 — other struggles have no effect", () => {
  it("rush, body-different, elevated, mood-mismatch, too-basic, new-phase have no effect", () => {
    const items = makeItems(5);
    const struggles = ["rush", "body-different", "elevated", "mood-mismatch", "too-basic", "new-phase"];
    const base = computeClosetInsights(items, emptyProfile);
    for (const struggle of struggles) {
      const result = computeClosetInsights(items, { ...emptyProfile, styleStruggles: [struggle] });
      assert.deepEqual(result.insights, base.insights, `struggle ${struggle} should have no effect`);
    }
  });
});

// ── CI.25 — style-what-i-own changes category wording only ───────────────────
describe("CI.25 — style-what-i-own reframes category claim", () => {
  it("changes wording when style-what-i-own is in styleSupport", () => {
    const items = [
      ...makeItems(3, { category: "TOPS" }),
      ...makeItems(2, { category: "BOTTOMS" }).map((i, idx) => ({ ...i, id: `b-${idx}` })),
    ];
    const withSupport = computeClosetInsights(items, { ...emptyProfile, styleSupport: ["style-what-i-own"] });
    const without = computeClosetInsights(items, emptyProfile);

    const catWith = withSupport.insights.find((i) => i.type === "category-concentration");
    const catWithout = without.insights.find((i) => i.type === "category-concentration");

    assert.ok(catWith, "should still emit category insight");
    assert.ok(catWithout, "without support should also emit");
    assert.notEqual(catWith!.claim, catWithout!.claim, "claims should differ");
    assert.ok(
      catWith!.claim.toLowerCase().includes("work with"),
      `reframed claim: ${catWith!.claim}`,
    );
    assert.ok(
      catWith!.passportEffects.some((e) => e.matchedId === "style-what-i-own"),
      "should record passport effect",
    );
  });

  it("does not affect any other insight type", () => {
    const items = makeItems(5, { primaryColor: "Black" });
    const with_ = computeClosetInsights(items, { ...emptyProfile, styleSupport: ["style-what-i-own"] });
    const without = computeClosetInsights(items, emptyProfile);
    const paletteWith = with_.insights.find((i) => i.type === "palette-distribution");
    const paletteWithout = without.insights.find((i) => i.type === "palette-distribution");
    if (paletteWith && paletteWithout) {
      assert.equal(paletteWith.claim, paletteWithout.claim, "palette claim should be unchanged");
    }
  });
});

// ── CI.26 — event-outfits changes occasion wording; no outfit-building claim ──
describe("CI.26 — event-outfits styleSupport framing", () => {
  it("changes occasion insight wording when event-outfits is in styleSupport", () => {
    const items = makeItems(5, { occasions: ["Dinner"] as string[] });
    const without = computeClosetInsights(items, { ...emptyProfile, lifestyle: ["events"] });
    const with_ = computeClosetInsights(items, {
      ...emptyProfile,
      lifestyle: ["events"],
      styleSupport: ["event-outfits"],
    });

    const occWith = with_.insights.find((i) => i.type === "occasion-coverage");
    const occWithout = without.insights.find((i) => i.type === "occasion-coverage");

    assert.ok(occWith, "should emit occasion insight");
    if (occWithout) {
      assert.notEqual(occWith!.claim, occWithout.claim, "claims should differ");
    }
    assert.ok(
      occWith!.claim.toLowerCase().includes("event-outfit"),
      `reframed claim: ${occWith!.claim}`,
    );
    assert.ok(
      occWith!.passportEffects.some((e) => e.matchedId === "event-outfits"),
      "should record passport effect",
    );
  });

  it("claim does not contain 'harder to build' language", () => {
    const items = makeItems(5, { occasions: ["Work"] as string[] });
    const profile: ClosetInsightProfile = {
      ...emptyProfile,
      lifestyle: ["events"],
      styleSupport: ["event-outfits"],
    };
    const result = computeClosetInsights(items, profile);
    const occ = result.insights.find((i) => i.type === "occasion-coverage");
    if (occ) {
      assert.ok(
        !occ.claim.toLowerCase().includes("harder to build"),
        `claim must not say 'harder to build': ${occ.claim}`,
      );
      assert.ok(
        !occ.claim.toLowerCase().includes("harder"),
        `claim must not say 'harder': ${occ.claim}`,
      );
    }
  });
});

// ── CI.27 — polished-easy has no effect ──────────────────────────────────────
describe("CI.27 — polished-easy has no effect", () => {
  it("produces identical insights with or without polished-easy", () => {
    const items = [
      ...makeItems(3, { category: "TOPS" }),
      ...makeItems(2, { category: "BOTTOMS" }).map((i, idx) => ({ ...i, id: `b-${idx}` })),
    ];
    const with_ = computeClosetInsights(items, { ...emptyProfile, styleSupport: ["polished-easy"] });
    const without = computeClosetInsights(items, emptyProfile);
    assert.deepEqual(with_.insights, without.insights);
  });
});

// ── CI.28 — deferred Passport fields have zero effect ────────────────────────
describe("CI.28 — deferred Passport fields have zero effect", () => {
  it("stylePersonalities, desiredImpression, desiredFeelings, becoming have no effect on Closet insights", () => {
    const items = makeItems(5);
    const base = computeClosetInsights(items, emptyProfile);
    const withAll = computeClosetInsights(items, {
      ...emptyProfile,
      stylePersonalities: ["old-money", "artsy"],
      desiredImpression: ["powerful", "refined"],
      desiredFeelings: ["confident", "elegant"],
      becoming: ["more-confident", "more-polished"],
    });
    assert.deepEqual(withAll.insights, base.insights);
  });
});

// ── CI.29 — null profile → Closet-only insights fire ─────────────────────────
describe("CI.29 — null profile", () => {
  it("still emits Closet-composition insights when profile is null", () => {
    const items = [
      ...makeItems(3, { category: "TOPS" }),
      ...makeItems(2, { category: "BOTTOMS" }).map((i, idx) => ({ ...i, id: `b-${idx}` })),
    ];
    const result = computeClosetInsights(items, null);
    const cat = result.insights.find((i) => i.type === "category-concentration");
    assert.ok(cat, "should emit category-concentration with null profile");
  });

  it("no occasion insight when profile is null (no lifestyle)", () => {
    const items = makeItems(5, { occasions: ["Dinner"] as string[] });
    const result = computeClosetInsights(items, null);
    assert.equal(result.insights.find((i) => i.type === "occasion-coverage"), undefined);
  });
});

// ── CI.30 — dataQuality reflects reality ─────────────────────────────────────
describe("CI.30 — dataQuality fields", () => {
  it("reports correct coverage ratios", () => {
    const items = [
      makeItem({ id: "1", primaryColor: "Black", occasions: ["Work"], seasons: ["Fall"] }),
      makeItem({ id: "2", primaryColor: "Grey", occasions: ["Casual"], seasons: ["Spring"] }),
      makeItem({ id: "3", primaryColor: null, occasions: null, seasons: null }),
      makeItem({ id: "4", primaryColor: null, occasions: null, seasons: null }),
      makeItem({ id: "5", primaryColor: null, occasions: null, seasons: null }),
    ];
    const { dataQuality } = computeClosetInsights(items, null);
    assert.equal(dataQuality.totalItems, 5);
    assert.equal(dataQuality.colouredItems, 2);
    assert.equal(dataQuality.colourCoverageRatio, 0.4);
    assert.equal(dataQuality.occasionTaggedItems, 2);
    assert.equal(dataQuality.occasionCoverageRatio, 0.4);
    assert.equal(dataQuality.seasonTaggedItems, 2);
    assert.equal(dataQuality.seasonCoverageRatio, 0.4);
    assert.equal(dataQuality.paletteEligible, false);
    assert.equal(dataQuality.occasionEligible, false);
    assert.equal(dataQuality.seasonEligible, false);
  });
});

// ── CI.32 — favourite colour 1/5: no "well represented", singular grammar ─────
describe("CI.32 — favourite colour 1 of 5: factual, singular grammar", () => {
  it("does not say 'well represented' for count=1 and uses singular 'is'", () => {
    const items = [
      makeItem({ id: "1", primaryColor: "Grey" }),
      makeItem({ id: "2", primaryColor: "Black" }),
      makeItem({ id: "3", primaryColor: "Black" }),
      makeItem({ id: "4", primaryColor: "Black" }),
      makeItem({ id: "5", primaryColor: "Black" }),
    ];
    const profile: ClosetInsightProfile = { ...emptyProfile, favoriteColors: ["grey"] };
    const result = computeClosetInsights(items, profile);
    const fav = result.insights.find((i) => i.id === "favourite-colour-grey");
    assert.ok(fav, "should emit favourite-colour-grey insight");
    const claim = fav!.claim;
    assert.ok(!claim.includes("well represented"), `should not say 'well represented' for 1 of 5: ${claim}`);
    assert.ok(claim.includes(" is grey"), `should use singular 'is': ${claim}`);
    assert.ok(claim.includes("1"), `should mention count 1: ${claim}`);
  });

  it("uses singular 'piece' for count=1", () => {
    const items = [
      makeItem({ id: "1", primaryColor: "Navy" }),
      makeItem({ id: "2", primaryColor: "Black" }),
      makeItem({ id: "3", primaryColor: "Black" }),
      makeItem({ id: "4", primaryColor: "Black" }),
      makeItem({ id: "5", primaryColor: "Black" }),
    ];
    const profile: ClosetInsightProfile = { ...emptyProfile, favoriteColors: ["navy"] };
    const result = computeClosetInsights(items, profile);
    const fav = result.insights.find((i) => i.id === "favourite-colour-navy");
    assert.ok(fav, "should emit favourite-colour-navy insight");
    assert.ok(fav!.claim.includes("piece") && !fav!.claim.includes("pieces"), `should say 'piece' not 'pieces': ${fav!.claim}`);
  });
});

// ── CI.33 — favourite colour 3/5 dominant: merged into palette claim ──────────
describe("CI.33 — favourite colour 3 of 5 dominant: merged into palette-distribution", () => {
  it("merges into palette claim when Grey is dominant AND a favourite — no separate insight", () => {
    // Grey = 3/5 = 60% ≥ 40%, count ≥ 2 → palette leader = Grey. Grey is also a favourite.
    const items = [
      makeItem({ id: "1", primaryColor: "Grey" }),
      makeItem({ id: "2", primaryColor: "Grey" }),
      makeItem({ id: "3", primaryColor: "Grey" }),
      makeItem({ id: "4", primaryColor: "Black" }),
      makeItem({ id: "5", primaryColor: "Black" }),
    ];
    const profile: ClosetInsightProfile = { ...emptyProfile, favoriteColors: ["grey"] };
    const result = computeClosetInsights(items, profile);
    // No separate favourite-colour-grey — merged into palette-distribution
    assert.equal(result.insights.find((i) => i.id === "favourite-colour-grey"), undefined,
      "should NOT emit separate favourite-colour-grey when Grey is palette leader");
    const palette = result.insights.find((i) => i.type === "palette-distribution");
    assert.ok(palette, "palette-distribution should exist");
    assert.ok(palette!.claim.includes("Grey"), `claim: ${palette!.claim}`);
    assert.ok(palette!.claim.toLowerCase().includes("favourite"), `palette claim should mention 'favourite': ${palette!.claim}`);
    assert.ok(palette!.claim.includes("3"), `claim should mention count 3: ${palette!.claim}`);
  });

  it("does not say 'well represented' when count=2 and ratio < 0.3", () => {
    // 2 grey of 8 coloured = 25% < 30% → no "well represented"
    const items = [
      makeItem({ id: "1", primaryColor: "Grey" }),
      makeItem({ id: "2", primaryColor: "Grey" }),
      makeItem({ id: "3", primaryColor: "Black" }),
      makeItem({ id: "4", primaryColor: "Black" }),
      makeItem({ id: "5", primaryColor: "Black" }),
      makeItem({ id: "6", primaryColor: "Black" }),
      makeItem({ id: "7", primaryColor: "White" }),
      makeItem({ id: "8", primaryColor: "White" }),
    ];
    const profile: ClosetInsightProfile = { ...emptyProfile, favoriteColors: ["grey"] };
    const result = computeClosetInsights(items, profile);
    const fav = result.insights.find((i) => i.id === "favourite-colour-grey");
    assert.ok(fav, "should emit favourite-colour-grey insight");
    assert.ok(!fav!.claim.includes("well represented"), `should not say 'well represented' for 2 of 8: ${fav!.claim}`);
  });
});

// ── CI.35 — unrecognized season values → no season insight ────────────────────
describe("CI.35 — unrecognized season values produce no season insight", () => {
  it("does not emit season-coverage when items have only unrecognized season strings", () => {
    // Items have a non-null season array with an unrecognized value.
    // This should NOT count as season-tagged.
    const items = Array.from({ length: 8 }, (_, i) =>
      makeItem({ id: `item-${i + 1}`, seasons: [""] as string[] }),
    );
    const result = computeClosetInsights(items, emptyProfile);
    assert.equal(result.dataQuality.seasonTaggedItems, 0,
      "empty-string season values must not be counted as tagged");
    assert.equal(result.dataQuality.seasonEligible, false);
    assert.equal(result.insights.find((i) => i.type === "season-coverage"), undefined,
      "should not emit season insight");
  });

  it("does not emit season-coverage when items have null seasons", () => {
    const items = makeItems(8, { seasons: null });
    const result = computeClosetInsights(items, emptyProfile);
    assert.equal(result.dataQuality.seasonTaggedItems, 0);
    assert.equal(result.insights.find((i) => i.type === "season-coverage"), undefined);
  });
});

// ── CI.36 — unrecognized occasion values → no occasion insight ────────────────
describe("CI.36 — unrecognized occasion values produce no occasion insight", () => {
  it("does not emit occasion-coverage when items have only unrecognized occasion strings", () => {
    const items = Array.from({ length: 8 }, (_, i) =>
      makeItem({ id: `item-${i + 1}`, occasions: [""] as string[] }),
    );
    const profile: ClosetInsightProfile = { ...emptyProfile, lifestyle: ["events"] };
    const result = computeClosetInsights(items, profile);
    assert.equal(result.dataQuality.occasionTaggedItems, 0,
      "empty-string occasion values must not be counted as tagged");
    assert.equal(result.dataQuality.occasionEligible, false);
    assert.equal(result.insights.find((i) => i.type === "occasion-coverage"), undefined,
      "should not emit occasion insight");
  });

  it("counts only items with recognized occasion values", () => {
    const items = [
      makeItem({ id: "1", occasions: ["Work"] }),       // recognized
      makeItem({ id: "2", occasions: [""] }),            // unrecognized — must not count
      makeItem({ id: "3", occasions: ["Casual"] }),      // recognized
      makeItem({ id: "4", occasions: null }),             // null — must not count
      makeItem({ id: "5", occasions: ["unknown-val"] }), // unrecognized — must not count
    ];
    const result = computeClosetInsights(items, emptyProfile);
    assert.equal(result.dataQuality.occasionTaggedItems, 2,
      "only 2 items have recognized occasion values");
  });
});

// ── CI.37 — dominant colour + favourite: merged, no duplicate ─────────────────
describe("CI.37 — dominant colour that is also a favourite is merged into palette claim", () => {
  it("palette claim mentions 'favourite' when dominant colour is a favourite", () => {
    const items = [
      makeItem({ id: "1", primaryColor: "Navy" }),
      makeItem({ id: "2", primaryColor: "Navy" }),
      makeItem({ id: "3", primaryColor: "Navy" }),
      makeItem({ id: "4", primaryColor: "Black" }),
      makeItem({ id: "5", primaryColor: "Black" }),
    ];
    const profile: ClosetInsightProfile = { ...emptyProfile, favoriteColors: ["navy"] };
    const result = computeClosetInsights(items, profile);
    const palette = result.insights.find((i) => i.type === "palette-distribution");
    assert.ok(palette, "palette-distribution should exist");
    assert.ok(palette!.claim.toLowerCase().includes("favourite"),
      `palette claim should mention 'favourite': ${palette!.claim}`);
    assert.equal(result.insights.find((i) => i.id === "favourite-colour-navy"), undefined,
      "should not emit separate favourite-colour-navy — already in palette");
  });

  it("non-dominant favourite still gets its own insight", () => {
    // Navy = 3/5 dominant + favourite. Black is NOT a favourite.
    // Add Green as a non-dominant favourite → Green gets its own insight.
    const items = [
      makeItem({ id: "1", primaryColor: "Navy" }),
      makeItem({ id: "2", primaryColor: "Navy" }),
      makeItem({ id: "3", primaryColor: "Navy" }),
      makeItem({ id: "4", primaryColor: "Black" }),
      makeItem({ id: "5", primaryColor: "Black" }),
    ];
    const profile: ClosetInsightProfile = { ...emptyProfile, favoriteColors: ["navy", "green"] };
    const result = computeClosetInsights(items, profile);
    // Navy merged into palette — no separate insight
    assert.equal(result.insights.find((i) => i.id === "favourite-colour-navy"), undefined,
      "navy merged into palette — no separate insight");
    // Green has 0 items → separate absence insight
    const green = result.insights.find((i) => i.id === "favourite-colour-green");
    assert.ok(green, "should emit separate favourite-colour-green");
    assert.ok(green!.claim.includes("isn't currently represented"), `claim: ${green!.claim}`);
  });

  it("palette passportEffects records the merged favouriteColors effect", () => {
    const items = [
      makeItem({ id: "1", primaryColor: "Black" }),
      makeItem({ id: "2", primaryColor: "Black" }),
      makeItem({ id: "3", primaryColor: "Black" }),
      makeItem({ id: "4", primaryColor: "Grey" }),
      makeItem({ id: "5", primaryColor: "Grey" }),
    ];
    const profile: ClosetInsightProfile = { ...emptyProfile, favoriteColors: ["black"] };
    const result = computeClosetInsights(items, profile);
    const palette = result.insights.find((i) => i.type === "palette-distribution");
    assert.ok(palette, "palette-distribution should exist");
    const effect = palette!.passportEffects.find((e) => e.field === "favoriteColors" && e.matchedId === "black");
    assert.ok(effect, "palette-distribution should carry the favoriteColors passport effect");
    assert.equal(effect!.effect, "framing");
  });
});

// ── CI.34 — lifestyle fallback claim is neutral ────────────────────────────────
describe("CI.34 — lifestyle fallback wording is not overclaiming", () => {
  it("does not produce 'Your lifestyle calls for specific occasion dressing' for any profile", () => {
    const overclaimPhrase = "Your lifestyle calls for specific occasion dressing";
    const items = makeItems(5, { occasions: ["Casual"] as string[] });
    const profiles: ClosetInsightProfile[] = [
      { ...emptyProfile, lifestyle: ["events"] },
      { ...emptyProfile, lifestyle: ["office"] },
      { ...emptyProfile, lifestyle: ["travel"] },
      { ...emptyProfile, lifestyle: ["everyday"] },
      { ...emptyProfile, lifestyle: ["events", "office", "travel"] },
    ];
    for (const profile of profiles) {
      const result = computeClosetInsights(items, profile);
      for (const insight of result.insights) {
        assert.ok(
          !insight.claim.includes(overclaimPhrase),
          `Claim must not say "${overclaimPhrase}": ${insight.claim}`,
        );
      }
    }
  });
});

// ── CI.38 — wear-behaviour fires at ≥60% relationship coverage ────────────────
describe("CI.38 — wear-behaviour fires at ≥60% relationship coverage", () => {
  it("emits wear-behaviour when 3 of 5 items are tagged (60%)", () => {
    const items = [
      makeItem({ id: "1", garmentRelationships: ["favourite"] }),
      makeItem({ id: "2", garmentRelationships: ["wear-often"] }),
      makeItem({ id: "3", garmentRelationships: ["wear-often"] }),
      makeItem({ id: "4" }),
      makeItem({ id: "5" }),
    ];
    const result = computeClosetInsights(items, emptyProfile);
    assert.equal(result.dataQuality.relationshipTaggedItems, 3);
    assert.equal(result.dataQuality.relationshipEligible, true);
    const wb = result.insights.find((i) => i.type === "wear-behaviour");
    assert.ok(wb, "wear-behaviour should fire at 60% coverage");
    assert.ok(wb!.claim.includes("3"), `claim should mention count 3: ${wb!.claim}`);
    assert.ok(
      wb!.claim.toLowerCase().includes("favourites") ||
      wb!.claim.toLowerCase().includes("regularly"),
      `claim: ${wb!.claim}`,
    );
  });

  it("does NOT emit wear-behaviour when only 2 of 5 items are tagged (40%)", () => {
    const items = [
      makeItem({ id: "1", garmentRelationships: ["favourite"] }),
      makeItem({ id: "2", garmentRelationships: ["wear-often"] }),
      makeItem({ id: "3" }),
      makeItem({ id: "4" }),
      makeItem({ id: "5" }),
    ];
    const result = computeClosetInsights(items, emptyProfile);
    assert.equal(result.dataQuality.relationshipEligible, false);
    assert.equal(result.insights.find((i) => i.type === "wear-behaviour"), undefined);
  });
});

// ── CI.39 — wear-behaviour wording reflects the actual distribution ────────────
describe("CI.39 — wear-behaviour wording cases", () => {
  it("uses strong-core wording when ≥50% positive and ≤20% friction", () => {
    const items = [
      makeItem({ id: "1", garmentRelationships: ["favourite"] }),
      makeItem({ id: "2", garmentRelationships: ["wear-often"] }),
      makeItem({ id: "3", garmentRelationships: ["favourite"] }),
      makeItem({ id: "4", garmentRelationships: ["like"] }),
      makeItem({ id: "5", garmentRelationships: ["like"] }),
    ];
    const result = computeClosetInsights(items, emptyProfile);
    const wb = result.insights.find((i) => i.type === "wear-behaviour");
    assert.ok(wb, "wear-behaviour should fire");
    assert.ok(
      wb!.claim.toLowerCase().includes("core") || wb!.claim.toLowerCase().includes("often"),
      `strong-core phrasing expected: ${wb!.claim}`,
    );
  });

  it("uses spread wording when positive and friction are roughly equal", () => {
    const items = [
      makeItem({ id: "1", garmentRelationships: ["favourite"] }),
      makeItem({ id: "2", garmentRelationships: ["wear-often"] }),
      makeItem({ id: "3", garmentRelationships: ["love-style-struggle"] }),
      makeItem({ id: "4", garmentRelationships: ["unsure"] }),
      makeItem({ id: "5", garmentRelationships: ["like"] }),
    ];
    const result = computeClosetInsights(items, emptyProfile);
    const wb = result.insights.find((i) => i.type === "wear-behaviour");
    assert.ok(wb, "wear-behaviour should fire");
    // Mixed case — claim should describe the spread
    assert.ok(
      wb!.claim.includes("2") || wb!.claim.toLowerCase().includes("spread") || wb!.claim.toLowerCase().includes("mix"),
      `spread phrasing expected: ${wb!.claim}`,
    );
  });
});

// ── CI.40 — friction-signal fires at ≥2 love-style-struggle (no coverage gate) ─
describe("CI.40 — friction-signal fires at ≥2 struggle items regardless of coverage", () => {
  it("fires when exactly 2 items are tagged love-style-struggle (40% of 5)", () => {
    const items = [
      makeItem({ id: "1", garmentRelationships: ["love-style-struggle"] }),
      makeItem({ id: "2", garmentRelationships: ["love-style-struggle"] }),
      makeItem({ id: "3" }),
      makeItem({ id: "4" }),
      makeItem({ id: "5" }),
    ];
    const result = computeClosetInsights(items, emptyProfile);
    assert.equal(result.dataQuality.relationshipEligible, false, "coverage is only 40% — relationshipEligible should be false");
    const friction = result.insights.find((i) => i.type === "friction-signal");
    assert.ok(friction, "friction-signal should fire even below the coverage threshold");
    assert.ok(friction!.claim.includes("2"), `claim: ${friction!.claim}`);
    assert.ok(
      friction!.claim.toLowerCase().includes("struggle") || friction!.claim.toLowerCase().includes("style"),
      `claim: ${friction!.claim}`,
    );
  });

  it("does NOT fire when only 1 item is tagged love-style-struggle", () => {
    const items = makeItems(5, { garmentRelationships: [] });
    items[0] = makeItem({ id: "item-1", garmentRelationships: ["love-style-struggle"] });
    const result = computeClosetInsights(items, emptyProfile);
    assert.equal(result.insights.find((i) => i.type === "friction-signal"), undefined,
      "friction-signal must not fire for count=1");
  });
});

// ── CI.41 — low-use-signal fires at ≥2 rarely-wear/regret AND ≥8 total items ──
describe("CI.41 — low-use-signal gating", () => {
  it("fires when 2 of 8 items are rarely-wear or regret", () => {
    const items = [
      ...makeItems(6),
      makeItem({ id: "item-7", garmentRelationships: ["rarely-wear"] }),
      makeItem({ id: "item-8", garmentRelationships: ["regret"] }),
    ];
    const result = computeClosetInsights(items, emptyProfile);
    assert.equal(result.dataQuality.totalItems, 8);
    const lowUse = result.insights.find((i) => i.type === "low-use-signal");
    assert.ok(lowUse, "low-use-signal should fire with 2 low-use items in an 8-item Closet");
    assert.ok(lowUse!.claim.includes("2"), `claim: ${lowUse!.claim}`);
  });

  it("does NOT fire when total items < 8 even with 2 rarely-worn", () => {
    const items = [
      ...makeItems(5),
      makeItem({ id: "item-6", garmentRelationships: ["rarely-wear"] }),
      makeItem({ id: "item-7", garmentRelationships: ["regret"] }),
    ];
    const result = computeClosetInsights(items, emptyProfile);
    assert.equal(result.dataQuality.totalItems, 7);
    assert.equal(result.insights.find((i) => i.type === "low-use-signal"), undefined,
      "low-use-signal must not fire below 8 total items");
  });

  it("does NOT fire when only 1 item is low-use regardless of closet size", () => {
    const items = [
      ...makeItems(8),
      makeItem({ id: "item-9", garmentRelationships: ["rarely-wear"] }),
    ];
    items[0] = makeItem({ id: "item-1", garmentRelationships: ["rarely-wear"] });
    // only 1 unique low-use item in a 9-item closet — wait, item-1 and item-9 both have rarely-wear
    // that's 2. Let me redo this test properly.
    // Actually the above gives 2 — use a different fixture
    const items2 = [
      ...Array.from({ length: 9 }, (_, i) => makeItem({ id: `item-${i + 1}` })),
    ];
    items2[0] = makeItem({ id: "item-1", garmentRelationships: ["rarely-wear"] });
    const result = computeClosetInsights(items2, emptyProfile);
    assert.equal(result.insights.find((i) => i.type === "low-use-signal"), undefined,
      "low-use-signal must not fire for count=1");
  });
});

// ── CI.42 — formality-distribution fires at ≥60% AI coverage ─────────────────
describe("CI.42 — formality-distribution fires at ≥60% AI formality coverage", () => {
  it("emits formality-distribution when 4 of 5 items have formality data", () => {
    const items = [
      makeItem({ id: "1", formality: "casual" }),
      makeItem({ id: "2", formality: "casual" }),
      makeItem({ id: "3", formality: "casual" }),
      makeItem({ id: "4", formality: "smart-casual" }),
      makeItem({ id: "5", formality: null }),
    ];
    const result = computeClosetInsights(items, emptyProfile);
    assert.equal(result.dataQuality.formalityEligible, true);
    const fd = result.insights.find((i) => i.type === "formality-distribution");
    assert.ok(fd, "formality-distribution should fire");
    assert.ok(
      fd!.claim.toLowerCase().includes("casual") || fd!.claim.includes("4"),
      `claim: ${fd!.claim}`,
    );
  });

  it("does NOT fire when fewer than 60% of items have formality data", () => {
    const items = [
      makeItem({ id: "1", formality: "casual" }),
      makeItem({ id: "2", formality: "casual" }),
      makeItem({ id: "3", formality: null }),
      makeItem({ id: "4", formality: null }),
      makeItem({ id: "5", formality: null }),
    ];
    const result = computeClosetInsights(items, emptyProfile);
    assert.equal(result.dataQuality.formalityEligible, false);
    assert.equal(result.insights.find((i) => i.type === "formality-distribution"), undefined);
  });
});

// ── CI.43 — curation: max 4 insights, priority order maintained ───────────────
describe("CI.43 — curation: max 4 insights returned in priority order", () => {
  it("never returns more than 4 insights", () => {
    // Trigger as many insight types as possible
    const items = [
      makeItem({ id: "1", primaryColor: "Black", occasions: ["Dinner"], seasons: ["Fall"], garmentRelationships: ["favourite"], formality: "casual" }),
      makeItem({ id: "2", primaryColor: "Black", occasions: ["Party"], seasons: ["Winter"], garmentRelationships: ["wear-often"], formality: "casual" }),
      makeItem({ id: "3", primaryColor: "Black", occasions: ["Formal"], seasons: ["Spring"], garmentRelationships: ["love-style-struggle"], formality: "casual" }),
      makeItem({ id: "4", primaryColor: "Grey", occasions: ["Work"], seasons: ["Summer"], garmentRelationships: ["love-style-struggle"], formality: "smart-casual" }),
      makeItem({ id: "5", primaryColor: "Grey", occasions: ["Work"], seasons: ["Fall"], garmentRelationships: ["unsure"], formality: "business-casual" }),
    ];
    const profile: ClosetInsightProfile = {
      ...emptyProfile,
      lifestyle: ["events", "office"],
      favoriteColors: ["black", "grey"],
      avoidColors: ["orange"],
    };
    const result = computeClosetInsights(items, profile);
    assert.ok(result.insights.length <= 4, `should return at most 4 insights, got ${result.insights.length}`);
  });

  it("wear-behaviour appears before colour insights when both fire", () => {
    const items = [
      makeItem({ id: "1", primaryColor: "Black", garmentRelationships: ["favourite"] }),
      makeItem({ id: "2", primaryColor: "Black", garmentRelationships: ["wear-often"] }),
      makeItem({ id: "3", primaryColor: "Black", garmentRelationships: ["wear-often"] }),
      makeItem({ id: "4", primaryColor: "Grey", garmentRelationships: ["like"] }),
      makeItem({ id: "5", primaryColor: "Grey", garmentRelationships: ["like"] }),
    ];
    const profile: ClosetInsightProfile = { ...emptyProfile, favoriteColors: ["grey"] };
    const result = computeClosetInsights(items, profile);
    const wbIdx = result.insights.findIndex((i) => i.type === "wear-behaviour");
    const colourIdx = result.insights.findIndex(
      (i) => i.type === "palette-distribution" || i.type === "favourite-colour-comparison",
    );
    assert.ok(wbIdx !== -1, "wear-behaviour should fire");
    assert.ok(colourIdx !== -1, "a colour insight should fire");
    assert.ok(wbIdx < colourIdx, `wear-behaviour (idx ${wbIdx}) should precede colour insight (idx ${colourIdx})`);
  });
});

// ── CI.44 — new profile fields are forward-compat (no insight effect) ─────────
describe("CI.44 — passportSilhouette, passportStructure, passportFitPreferences have no effect", () => {
  it("adding Passport body fields does not change any insight output", () => {
    const items = makeItems(5);
    const base = computeClosetInsights(items, emptyProfile);
    const withPassport = computeClosetInsights(items, {
      ...emptyProfile,
      passportSilhouette: ["fitted", "waist-defined"],
      passportStructure: "tailored",
      passportFitPreferences: ["fitted", "tailored"],
    });
    assert.deepEqual(withPassport.insights, base.insights);
  });
});

// ── CI.45 — unrecognized relationship values are ignored ───────────────────────
describe("CI.45 — unrecognized garmentRelationship values produce no relationship insights", () => {
  it("empty-string relationship values do not count toward coverage", () => {
    const items = Array.from({ length: 5 }, (_, i) =>
      makeItem({ id: `item-${i + 1}`, garmentRelationships: [""] }),
    );
    const result = computeClosetInsights(items, emptyProfile);
    assert.equal(result.dataQuality.relationshipTaggedItems, 0,
      "unrecognized relationship values must not count as tagged");
    assert.equal(result.dataQuality.relationshipEligible, false);
    assert.equal(result.insights.find((i) => i.type === "wear-behaviour"), undefined);
    assert.equal(result.insights.find((i) => i.type === "friction-signal"), undefined);
  });

  it("love-style-struggle still counts for friction-signal even when coverage is via unrecognized values", () => {
    // 2 items with valid struggle tag, 3 items with unrecognized tag
    // → coverage=40% (below threshold) but friction-signal should still fire
    const items = [
      makeItem({ id: "1", garmentRelationships: ["love-style-struggle"] }),
      makeItem({ id: "2", garmentRelationships: ["love-style-struggle"] }),
      makeItem({ id: "3", garmentRelationships: ["unknown-tag"] }),
      makeItem({ id: "4", garmentRelationships: ["unknown-tag"] }),
      makeItem({ id: "5", garmentRelationships: ["unknown-tag"] }),
    ];
    const result = computeClosetInsights(items, emptyProfile);
    assert.equal(result.dataQuality.relationshipTaggedItems, 2,
      "only recognized values count toward coverage");
    assert.equal(result.dataQuality.relationshipEligible, false);
    const friction = result.insights.find((i) => i.type === "friction-signal");
    assert.ok(friction, "friction-signal should still fire for 2 struggle items");
  });
});

// ── CI.31 — prohibited inferences never appear ────────────────────────────────
describe("CI.31 — prohibited inference strings", () => {
  it("no claim contains 'your style is', 'you tend to', 'would suit', 'would look', 'you should buy', 'need to buy'", () => {
    const prohibited = [
      "your style is",
      "you tend to",
      "would suit you",
      "would look good",
      "you should buy",
      "need to buy",
    ];

    const items = [
      makeItem({ id: "1", primaryColor: "Black", occasions: ["Dinner"], seasons: ["Fall"] }),
      makeItem({ id: "2", primaryColor: "Black", occasions: ["Party"], seasons: ["Winter"] }),
      makeItem({ id: "3", primaryColor: "Black", occasions: ["Formal"], seasons: ["Spring"] }),
      makeItem({ id: "4", primaryColor: "Grey", occasions: ["Work"], seasons: ["Summer"] }),
      makeItem({ id: "5", primaryColor: "Grey", occasions: ["Work"], seasons: ["Fall"] }),
    ];
    const profile: ClosetInsightProfile = {
      lifestyle: ["events", "office"],
      styleStruggles: ["event", "rush"],
      styleSupport: ["style-what-i-own", "event-outfits"],
      favoriteColors: ["black", "grey"],
      avoidColors: ["orange"],
      stylePersonalities: ["old-money"],
      desiredImpression: ["powerful"],
      desiredFeelings: ["confident"],
      becoming: ["more-polished"],
      passportSilhouette: [],
      passportStructure: null,
      passportFitPreferences: [],
    };

    const result = computeClosetInsights(items, profile);
    for (const insight of result.insights) {
      const lower = insight.claim.toLowerCase();
      for (const phrase of prohibited) {
        assert.ok(
          !lower.includes(phrase),
          `Claim "${insight.claim}" contains prohibited phrase "${phrase}"`,
        );
      }
    }
  });
});
