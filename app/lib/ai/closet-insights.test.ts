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
  it("matches Black quiz ID to Black Closet display value", () => {
    const items = makeItems(5, { primaryColor: "Black" });
    const profile: ClosetInsightProfile = {
      ...emptyProfile,
      favoriteColors: ["black"],
    };
    const result = computeClosetInsights(items, profile);
    const fav = result.insights.find((i) => i.id === "favourite-colour-black");
    assert.ok(fav, "should emit favourite-colour-black");
    assert.ok(fav!.claim.includes("Black"), `claim: ${fav!.claim}`);
  });

  it("matches grey, navy, green, pink, yellow, orange quiz IDs to their Closet display values", () => {
    const colourPairs: [string, string][] = [
      ["grey", "Grey"], ["navy", "Navy"], ["green", "Green"],
      ["pink", "Pink"], ["yellow", "Yellow"], ["orange", "Orange"],
    ];
    for (const [quizId, displayValue] of colourPairs) {
      const items = makeItems(5, { primaryColor: displayValue });
      const profile: ClosetInsightProfile = { ...emptyProfile, favoriteColors: [quizId] };
      const result = computeClosetInsights(items, profile);
      const fav = result.insights.find((i) => i.id === `favourite-colour-${quizId}`);
      assert.ok(fav, `should emit insight for ${quizId}`);
      assert.ok(fav!.claim.includes(displayValue), `claim should mention ${displayValue}: ${fav!.claim}`);
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
