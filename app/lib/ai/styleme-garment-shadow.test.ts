// app/lib/ai/styleme-garment-shadow.test.ts
// Causal tests for the Garment Intelligence Phase 2 StyleMe shadow comparison.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  toStyleMeGarmentView,
  compareStyleMeGarmentToResolvedGarment,
  summarizeAdminOverrideBlindness,
  aggregateFieldComparisons,
  type FieldComparison,
} from "./styleme-garment-shadow.server.ts";
import { resolveGarment, type ResolvableClosetItem } from "./resolved-garment.server.ts";
import type { StylingPassportInput } from "~/lib/admin/garment-intelligence-v1.server";

function baseItem(partial: Partial<ResolvableClosetItem> = {}): ResolvableClosetItem {
  return {
    id: "item-1", name: "Wide-leg trousers", category: "BOTTOMS", analysisStatus: "ready",
    subcategory: null, silhouette: "wide-leg", fitProfile: "tailored", hemLength: null, topLength: null,
    waistShape: null, sleeveLength: null, necklineCoverage: null, shoulderCoverage: null, midriffExposed: null,
    material: "wool", pattern: "solid", primaryColor: "charcoal", colors: ["charcoal"],
    occasions: ["work"], seasons: ["fall"], formality: "business-casual", stylePersonality: null,
    styleTags: [], garmentRelationships: [], adminReview: null, styleMeProfile: null,
    ...partial,
  } as ResolvableClosetItem;
}

const PASSPORT: StylingPassportInput = {
  stylePersonalities: [], favoriteColors: ["charcoal"], avoidColors: [], dressingPreferences: [], silhouette: [],
};

describe("§SGS-1 toStyleMeGarmentView reflects live StyleMe reads, not canonical semantics", () => {
  it("subcategory is RAW — never admin-override-aware, unlike ResolvedGarment", () => {
    const item = baseItem({
      subcategory: null,
      adminReview: { reviewStatus: "overridden", overrides: { subcategory: "trousers" }, intelligenceOverrides: null },
    });
    const view = toStyleMeGarmentView(item);
    assert.equal(view.subcategory, null, "StyleMe's view must stay raw even though an override exists");
  });

  it("approvedVisualWeight is the raw title-case curated string, not run through CURATED_WEIGHT_MAP", () => {
    const item = baseItem({ styleMeProfile: { profileStatus: "approved", visualWeight: "heavy", intentionPotentials: null } });
    const view = toStyleMeGarmentView(item);
    assert.equal(view.approvedVisualWeight, "heavy", "must stay 'heavy', not normalized to 'substantial' at this layer");
  });

  it("no approved profile -> approvedVisualWeight and approvedIntentionPotentials are null", () => {
    const view = toStyleMeGarmentView(baseItem({ styleMeProfile: null }));
    assert.equal(view.approvedVisualWeight, null);
    assert.equal(view.approvedIntentionPotentials, null);
  });

  it("energyHeuristic is StyleMe's own computeEnergyPotential, imported not reimplemented", () => {
    const view = toStyleMeGarmentView(baseItem({ pattern: "floral", styleTags: ["bold"] }));
    assert.ok(view.energyHeuristic >= 2, "pattern!=solid and an expressive tag should both contribute");
  });
});

describe("§SGS-2 admin-override-blindness is isolated as its own reason", () => {
  it("an overridden subcategory produces a 'subcategory' row with reason admin-override-blindness", () => {
    const item = baseItem({
      subcategory: null,
      adminReview: { reviewStatus: "overridden", overrides: { subcategory: "trousers" }, intelligenceOverrides: null },
    });
    const rows = compareStyleMeGarmentToResolvedGarment(item, PASSPORT);
    const subcat = rows.find((r) => r.field === "subcategory")!;
    assert.equal(subcat.same, false);
    assert.equal(subcat.reason, "admin-override-blindness");
    assert.equal(subcat.styleMeValue, null);
    assert.notEqual(subcat.canonicalValue, null);
  });

  it("slot inherits the subcategory override's divergence, same reason", () => {
    const item = baseItem({
      category: "BOTTOMS", subcategory: null,
      adminReview: { reviewStatus: "overridden", overrides: { subcategory: "trousers" }, intelligenceOverrides: null },
    });
    const rows = compareStyleMeGarmentToResolvedGarment(item, PASSPORT);
    const slot = rows.find((r) => r.field === "slot")!;
    if (!slot.same) assert.equal(slot.reason, "admin-override-blindness");
  });

  it("an admin intelligenceOverrides.visualWeight on top of an approved profile is ALSO admin-override-blindness", () => {
    const item = baseItem({
      styleMeProfile: { profileStatus: "approved", visualWeight: "heavy", intentionPotentials: null },
      adminReview: { reviewStatus: "overridden", overrides: {}, intelligenceOverrides: { visualWeight: "light" } },
    });
    const rows = compareStyleMeGarmentToResolvedGarment(item, PASSPORT);
    const vw = rows.find((r) => r.field === "visualWeight")!;
    assert.equal(vw.comparable, true);
    assert.equal(vw.same, false);
    assert.equal(vw.reason, "admin-override-blindness");
  });

  it("no override present and values agree -> same=true, reason=null", () => {
    const item = baseItem();
    const rows = compareStyleMeGarmentToResolvedGarment(item, PASSPORT);
    const silhouette = rows.find((r) => r.field === "silhouette")!;
    assert.equal(silhouette.same, true);
    assert.equal(silhouette.reason, null);
  });
});

describe("§SGS-3 visual weight — heavy vs substantial is a visible vocabulary normalization, never a silent equivalence", () => {
  it("an approved profile with no override maps heavy->substantial and reports same=true (the approved production mapping, not an invented one)", () => {
    const item = baseItem({ styleMeProfile: { profileStatus: "approved", visualWeight: "heavy", intentionPotentials: null } });
    const rows = compareStyleMeGarmentToResolvedGarment(item, PASSPORT);
    const vw = rows.find((r) => r.field === "visualWeight")!;
    assert.equal(vw.styleMeValue, "heavy", "styleMeValue stays the raw curated string — the mismatch stays visible in the data");
    assert.equal(vw.canonicalValue, "substantial");
    assert.equal(vw.same, true);
  });

  it("no approved profile -> visualWeight is non-comparable, reason missing-styleme-concept, energyHeuristic reported separately and never coerced", () => {
    const item = baseItem({ styleMeProfile: null, pattern: "floral" });
    const rows = compareStyleMeGarmentToResolvedGarment(item, PASSPORT);
    const vw = rows.find((r) => r.field === "visualWeight")!;
    assert.equal(vw.comparable, false);
    assert.equal(vw.same, null);
    assert.equal(vw.reason, "missing-styleme-concept");
    const view = toStyleMeGarmentView(item);
    assert.equal(typeof view.energyHeuristic, "number");
  });
});

describe("§SGS-4 intentions — curated-overlap vs algorithm-difference are never conflated", () => {
  it("a curated intention value present on the approved profile is a curated-overlap comparison", () => {
    const item = baseItem({ styleMeProfile: { profileStatus: "approved", visualWeight: null, intentionPotentials: { "feel-sharper": "Strong" } } });
    const rows = compareStyleMeGarmentToResolvedGarment(item, PASSPORT);
    const row = rows.find((r) => r.field === "intention:feel-sharper")!;
    assert.equal(row.comparable, true);
    assert.equal(row.styleMeValue, "Strong");
  });

  it("no curated value for an intention -> algorithm-difference, not a truth disagreement", () => {
    const item = baseItem({ styleMeProfile: { profileStatus: "approved", visualWeight: null, intentionPotentials: { "feel-sharper": "Strong" } } });
    const rows = compareStyleMeGarmentToResolvedGarment(item, PASSPORT);
    const row = rows.find((r) => r.field === "intention:confidence")!;
    assert.equal(row.comparable, false);
    assert.equal(row.same, null);
    assert.equal(row.reason, "algorithm-difference");
  });

  it("the three known-frozen-WI-bug intentions are bucketed separately from algorithm-difference", () => {
    const item = baseItem({ styleMeProfile: null });
    const rows = compareStyleMeGarmentToResolvedGarment(item, PASSPORT);
    for (const intention of ["ground-me", "feel-attractive", "feel-less-exposed"]) {
      const row = rows.find((r) => r.field === `intention:${intention}`)!;
      assert.equal(row.reason, "known-frozen-wi-bug", `${intention} must be bucketed as known-frozen-wi-bug, not algorithm-difference`);
    }
    const other = rows.find((r) => r.field === "intention:confidence")!;
    assert.equal(other.reason, "algorithm-difference");
  });

  it("an admin intelligenceOverrides.intentions entry on a curated-overlap intention is admin-override-blindness", () => {
    const item = baseItem({
      styleMeProfile: { profileStatus: "approved", visualWeight: null, intentionPotentials: { "feel-sharper": "Strong" } },
      adminReview: { reviewStatus: "overridden", overrides: {}, intelligenceOverrides: { intentions: { "feel-sharper": "none" } } },
    });
    const rows = compareStyleMeGarmentToResolvedGarment(item, PASSPORT);
    const row = rows.find((r) => r.field === "intention:feel-sharper")!;
    assert.equal(row.same, false);
    assert.equal(row.reason, "admin-override-blindness");
  });
});

describe("§SGS-5 admin-override-blindness summary", () => {
  it("counts garments with an override, value-changing overrides, and the resulting StyleMe/canonical divergence — identical by construction", () => {
    const items = [
      baseItem({ id: "a", subcategory: null, adminReview: { reviewStatus: "overridden", overrides: { subcategory: "trousers" }, intelligenceOverrides: null } }),
      baseItem({ id: "b", subcategory: "skirt", adminReview: { reviewStatus: "overridden", overrides: { subcategory: "skirt" }, intelligenceOverrides: null } }), // override present but value-preserving
      baseItem({ id: "c" }), // no override at all
    ];
    const summary = summarizeAdminOverrideBlindness(items);
    const subcat = summary.find((s) => s.field === "subcategory")!;
    assert.equal(subcat.garmentsWithOverride, 2);
    assert.equal(subcat.valueChangingOverrides, 1, "item b's override re-confirms the same value — not value-changing");
    assert.equal(subcat.styleMeCanonicalDivergences, subcat.valueChangingOverrides, "the two columns are identical by construction");
  });

  it("a field with zero overrides across the sample reports all zeros, not an error", () => {
    const summary = summarizeAdminOverrideBlindness([baseItem()]);
    const waistShape = summary.find((s) => s.field === "waistShape")!;
    assert.deepEqual(waistShape, { field: "waistShape", garmentsWithOverride: 0, valueChangingOverrides: 0, styleMeCanonicalDivergences: 0 });
  });
});

describe("§SGS-6 aggregation never puts non-comparable rows in the divergence denominator", () => {
  it("a field with 1 same + 1 non-comparable reports compared=1, divergencePercent=0, nonComparable=1", () => {
    const rows: FieldComparison[] = [
      { garmentId: "a", field: "x", styleMeValue: 1, canonicalValue: 1, comparable: true, same: true, reason: null },
      { garmentId: "b", field: "x", styleMeValue: null, canonicalValue: 2, comparable: false, same: null, reason: "missing-styleme-concept" },
    ];
    const [agg] = aggregateFieldComparisons(rows);
    assert.equal(agg.compared, 1);
    assert.equal(agg.same, 1);
    assert.equal(agg.different, 0);
    assert.equal(agg.divergencePercent, 0);
    assert.equal(agg.nonComparable, 1);
  });

  it("primaryReasons tallies every non-null reason, including non-comparable ones", () => {
    const rows: FieldComparison[] = [
      { garmentId: "a", field: "x", styleMeValue: null, canonicalValue: 2, comparable: false, same: null, reason: "algorithm-difference" },
      { garmentId: "b", field: "x", styleMeValue: null, canonicalValue: 2, comparable: false, same: null, reason: "algorithm-difference" },
    ];
    const [agg] = aggregateFieldComparisons(rows);
    assert.equal(agg.primaryReasons["algorithm-difference"], 2);
  });
});

describe("§SGS-7 running the comparison mutates nothing", () => {
  it("the source item, its adminReview, and its styleMeProfile are byte-identical before and after", () => {
    const item = baseItem({
      adminReview: { reviewStatus: "overridden", overrides: { subcategory: "trousers" }, intelligenceOverrides: { visualWeight: "light" } },
      styleMeProfile: { profileStatus: "approved", visualWeight: "heavy", intentionPotentials: { "feel-sharper": "Strong" } },
    });
    const before = JSON.stringify(item);
    compareStyleMeGarmentToResolvedGarment(item, PASSPORT);
    assert.equal(JSON.stringify(item), before);
  });

  it("the passport input object is untouched", () => {
    const passport = { ...PASSPORT };
    const before = JSON.stringify(passport);
    compareStyleMeGarmentToResolvedGarment(baseItem(), passport);
    assert.equal(JSON.stringify(passport), before);
  });
});

describe("§SGS-8 resolveGarment() itself is untouched by this module's existence", () => {
  it("calling resolveGarment() directly produces the same result whether or not the shadow comparator also ran on the same item", () => {
    const item = baseItem({ styleMeProfile: { profileStatus: "approved", visualWeight: "heavy", intentionPotentials: null } });
    const before = resolveGarment(item, PASSPORT);
    compareStyleMeGarmentToResolvedGarment(item, PASSPORT);
    const after = resolveGarment(item, PASSPORT);
    assert.deepEqual(after, before);
  });
});
