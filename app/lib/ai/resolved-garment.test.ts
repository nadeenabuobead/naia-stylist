// app/lib/ai/resolved-garment.test.ts
//
// Causal tests for the Garment Intelligence Phase 1 extraction.
//
// referenceResolve() below is a frozen, hand-copied reproduction of the
// EXACT inline logic that used to live in wardrobe-intelligence.server.ts
// before this extraction — not a reimplementation from the spec, a literal
// copy, kept deliberately independent of resolved-garment.server.ts's own
// source so a bug introduced during extraction has no way to appear
// identically in both places. Every test compares resolveGarment()'s real
// output against this frozen copy; the two must always agree.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getEffectiveClosetItem, type IntelligenceOverrides, type ClosetItemFields } from "~/lib/admin/closet-review.server";
import {
  deriveGarmentStylingIntelligence,
  ALL_INTENTIONS,
  type StylingPassportInput,
} from "~/lib/admin/garment-intelligence-v1.server";
import type { ClosetClassification } from "~/lib/admin/closet-intelligence.server";
import { closetItemToSlot } from "~/lib/ai/closet-slot";
import type { ResolvedIntentionStrength, ResolvedVisualWeight, ResolvedColourProfile } from "~/lib/ai/wardrobe-intelligence";
import { resolveGarment, type ResolvableClosetItem } from "./resolved-garment.server.ts";

type EffectiveItem = ClosetItemFields & { category: string; garmentRelationships: string[] };

function referenceToClassification(item: EffectiveItem): ClosetClassification {
  return {
    category: item.category ?? null,
    subcategory: item.subcategory,
    silhouette: item.silhouette,
    fitProfile: item.fitProfile,
    hemLength: item.hemLength,
    topLength: item.topLength,
    waistShape: item.waistShape,
    sleeveLength: item.sleeveLength,
    necklineCoverage: item.necklineCoverage,
    shoulderCoverage: item.shoulderCoverage,
    midriffExposed: item.midriffExposed,
    material: item.material,
    pattern: item.pattern,
    primaryColor: item.primaryColor,
    colors: item.colors ?? [],
    occasions: item.occasions ?? [],
    seasons: item.seasons ?? [],
    formality: item.formality,
    stylePersonality: item.stylePersonality,
    styleTags: item.styleTags ?? [],
    garmentRelationships: item.garmentRelationships ?? [],
  };
}

const REFERENCE_CURATED_WEIGHT_MAP: Readonly<Record<string, ResolvedVisualWeight>> = {
  light: "light", medium: "medium", heavy: "substantial",
};
const REFERENCE_CURATED_STRENGTH_MAP: Readonly<Record<string, ResolvedIntentionStrength>> = {
  Strong: "strong", Supporting: "supporting", None: "none",
};
const REFERENCE_CURATED_APPROVED_STATUS = "approved";

function referenceResolve(item: ResolvableClosetItem, passportInput: StylingPassportInput | null) {
  const effective = getEffectiveClosetItem(item, item.adminReview);
  const classification = referenceToClassification(effective);

  const derived = deriveGarmentStylingIntelligence(classification, passportInput);
  const overrides = (item.adminReview?.intelligenceOverrides ?? null) as IntelligenceOverrides | null;
  const curated =
    item.styleMeProfile && item.styleMeProfile.profileStatus === REFERENCE_CURATED_APPROVED_STATUS
      ? item.styleMeProfile
      : null;

  let visualWeight: ResolvedVisualWeight | null = derived.visualWeight.value;
  let source: "curated" | "derived" | "none" = visualWeight === null ? "none" : "derived";
  if (curated?.visualWeight && REFERENCE_CURATED_WEIGHT_MAP[curated.visualWeight]) {
    visualWeight = REFERENCE_CURATED_WEIGHT_MAP[curated.visualWeight];
    source = "curated";
  }
  if (overrides && Object.prototype.hasOwnProperty.call(overrides, "visualWeight")) {
    visualWeight = (overrides.visualWeight ?? null) as ResolvedVisualWeight | null;
    source = "curated";
  }

  const colourProfile: ResolvedColourProfile = {
    hueFamily: derived.colourProfile.hueFamily,
    wardrobeNeutral: derived.colourProfile.wardrobeNeutral,
    lightDark: derived.colourProfile.lightDark,
    energyTier: derived.colourProfile.energyTier,
  };
  const cpOverride = overrides?.colourProfile;
  if (cpOverride) {
    if (Object.prototype.hasOwnProperty.call(cpOverride, "hueFamily")) colourProfile.hueFamily = cpOverride.hueFamily ?? null;
    if (Object.prototype.hasOwnProperty.call(cpOverride, "wardrobeNeutral")) colourProfile.wardrobeNeutral = cpOverride.wardrobeNeutral ?? false;
    if (Object.prototype.hasOwnProperty.call(cpOverride, "lightDark")) colourProfile.lightDark = cpOverride.lightDark ?? null;
    if (Object.prototype.hasOwnProperty.call(cpOverride, "energyTier")) colourProfile.energyTier = cpOverride.energyTier ?? null;
    source = "curated";
  }

  const intentions: Record<string, ResolvedIntentionStrength> = {};
  const humanReviewed = new Set<string>();
  for (const potential of derived.intentionPotentials) {
    intentions[potential.intention] = potential.strength;
  }
  const curatedIntentions = curated?.intentionPotentials as Record<string, string> | null | undefined;
  if (curatedIntentions && typeof curatedIntentions === "object") {
    for (const intention of ALL_INTENTIONS) {
      const raw = curatedIntentions[intention];
      if (typeof raw === "string" && REFERENCE_CURATED_STRENGTH_MAP[raw]) {
        intentions[intention] = REFERENCE_CURATED_STRENGTH_MAP[raw];
        humanReviewed.add(intention);
        source = "curated";
      }
    }
  }
  if (overrides?.intentions) {
    for (const [intention, value] of Object.entries(overrides.intentions)) {
      if (value === null) continue;
      intentions[intention] = value as ResolvedIntentionStrength;
      humanReviewed.add(intention);
      source = "curated";
    }
  }
  const intentionsSource: "curated" | "derived" =
    ALL_INTENTIONS.every((intention) => humanReviewed.has(intention)) ? "curated" : "derived";

  const hasIntelligence = item.analysisStatus === "ready" || source === "curated";

  return {
    id: item.id,
    name: item.name,
    category: item.category as string,
    subcategory: effective.subcategory ?? null,
    slot: closetItemToSlot(item.category as string, effective.subcategory ?? null),

    primaryColor: effective.primaryColor ?? null,
    colors: effective.colors ?? [],
    pattern: effective.pattern ?? null,
    material: effective.material ?? null,
    silhouette: effective.silhouette ?? null,
    fitProfile: effective.fitProfile ?? null,
    formality: effective.formality ?? null,
    stylePersonality: effective.stylePersonality ?? null,
    occasions: effective.occasions ?? [],
    seasons: effective.seasons ?? [],
    garmentRelationships: item.garmentRelationships ?? [],
    analysisStatus: item.analysisStatus,

    visualWeight: hasIntelligence ? visualWeight : null,
    colourProfile: hasIntelligence ? colourProfile : null,
    intentions: hasIntelligence ? intentions : null,
    intentionsSource: hasIntelligence ? intentionsSource : null,
    intelligenceSource: hasIntelligence ? source : "none",

    sleeveLength: effective.sleeveLength ?? null,
    necklineCoverage: effective.necklineCoverage ?? null,
    hemLength: effective.hemLength ?? null,
    topLength: effective.topLength ?? null,
    midriffExposed: effective.midriffExposed ?? null,
    shoulderCoverage: effective.shoulderCoverage ?? null,
  };
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

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

function assertAgreesWithReference(item: ResolvableClosetItem, passport: StylingPassportInput | null = PASSPORT) {
  const actual = resolveGarment(item, passport);
  const expected = referenceResolve(item, passport);
  assert.deepEqual(actual, expected);
  return actual;
}

describe("§RG-1 derived fallback — no admin review, no curated profile, analysisStatus ready", () => {
  it("matches the frozen reference exactly", () => {
    const g = assertAgreesWithReference(baseItem());
    assert.equal(g.intelligenceSource === "derived" || g.intelligenceSource === "none", true);
  });
});

describe("§RG-2 admin observable overrides win over raw ClosetItem fields", () => {
  it("an overridden subcategory changes slot, matching the reference", () => {
    const item = baseItem({
      category: "BOTTOMS", subcategory: null,
      adminReview: { reviewStatus: "overridden", overrides: { subcategory: "trousers" }, intelligenceOverrides: null },
    });
    const g = assertAgreesWithReference(item);
    assert.notEqual(g.subcategory, null);
  });

  it("an overridden silhouette/fitProfile reaches derived intelligence via classification, matching the reference", () => {
    const item = baseItem({
      silhouette: "straight", fitProfile: "relaxed",
      adminReview: { reviewStatus: "overridden", overrides: { silhouette: "oversized", fitProfile: "soft" }, intelligenceOverrides: null },
    });
    assertAgreesWithReference(item);
  });
});

describe("§RG-3 intelligenceOverrides win over curated and derived", () => {
  it("an intelligenceOverrides.visualWeight wins even when a curated profile also sets visualWeight", () => {
    const item = baseItem({
      styleMeProfile: { profileStatus: "approved", visualWeight: "heavy", intentionPotentials: null },
      adminReview: { reviewStatus: "overridden", overrides: {}, intelligenceOverrides: { visualWeight: "light" } },
    });
    const g = assertAgreesWithReference(item);
    assert.equal(g.visualWeight, "light");
    assert.equal(g.intelligenceSource, "curated");
  });

  it("an intelligenceOverrides.colourProfile sub-field wins over derived colour, per sub-field presence", () => {
    const item = baseItem({
      adminReview: { reviewStatus: "overridden", overrides: {}, intelligenceOverrides: { colourProfile: { hueFamily: "blue" } } },
    });
    const g = assertAgreesWithReference(item);
    assert.equal(g.colourProfile?.hueFamily, "blue");
  });

  it("an intelligenceOverrides.intentions entry wins over both curated and derived for that intention", () => {
    const item = baseItem({
      styleMeProfile: { profileStatus: "approved", visualWeight: null, intentionPotentials: { "feel-sharper": "Strong" } },
      adminReview: { reviewStatus: "overridden", overrides: {}, intelligenceOverrides: { intentions: { "feel-sharper": "none" } } },
    });
    const g = assertAgreesWithReference(item);
    assert.equal(g.intentions?.["feel-sharper"], "none");
  });

  it("an explicit null in intelligenceOverrides.intentions does not count as human-reviewed (matches reference's `continue`)", () => {
    const item = baseItem({
      adminReview: { reviewStatus: "overridden", overrides: {}, intelligenceOverrides: { intentions: { "feel-sharper": null } } },
    });
    assertAgreesWithReference(item);
  });
});

describe("§RG-4 approved GarmentStyleMeProfile wins over derived intelligence", () => {
  it("curated visualWeight (mapped heavy->substantial) wins over derived, with no admin override present", () => {
    const item = baseItem({ styleMeProfile: { profileStatus: "approved", visualWeight: "heavy", intentionPotentials: null } });
    const g = assertAgreesWithReference(item);
    assert.equal(g.visualWeight, "substantial");
    assert.equal(g.intelligenceSource, "curated");
  });

  it("a non-approved profile (e.g. pending) is ignored, falling through to derived — matches reference", () => {
    const item = baseItem({ styleMeProfile: { profileStatus: "pending", visualWeight: "heavy", intentionPotentials: null } });
    const g = assertAgreesWithReference(item);
    assert.notEqual(g.intelligenceSource, "curated");
  });

  it("curated intentionPotentials only counts a recognized title-case value (Strong/Supporting/None)", () => {
    const item = baseItem({ styleMeProfile: { profileStatus: "approved", visualWeight: null, intentionPotentials: { "feel-sharper": "strong" } } });
    assertAgreesWithReference(item); // lowercase "strong" must NOT match CURATED_STRENGTH_MAP
  });

  it("intentionsSource is curated only when ALL 12 intentions are human-reviewed — a partial mix stays derived", () => {
    const item = baseItem({
      styleMeProfile: { profileStatus: "approved", visualWeight: null, intentionPotentials: { "feel-sharper": "Strong" } },
    });
    const g = assertAgreesWithReference(item);
    assert.equal(g.intentionsSource, "derived");
  });
});

describe("§RG-5 missing optional intelligence behaves exactly as before", () => {
  it("analysisStatus not ready, no curated profile, no overrides -> intelligence fields are null, source 'none'", () => {
    const item = baseItem({ analysisStatus: "pending" });
    const g = assertAgreesWithReference(item);
    assert.equal(g.visualWeight, null);
    assert.equal(g.colourProfile, null);
    assert.equal(g.intentions, null);
    assert.equal(g.intentionsSource, null);
    assert.equal(g.intelligenceSource, "none");
  });

  it("analysisStatus not ready, but a curated profile IS present -> intelligence still surfaces (curated bypasses the ready gate)", () => {
    const item = baseItem({ analysisStatus: "pending", styleMeProfile: { profileStatus: "approved", visualWeight: "light", intentionPotentials: null } });
    const g = assertAgreesWithReference(item);
    assert.notEqual(g.intelligenceSource, "none");
  });

  it("a null passport input is handled identically to the reference", () => {
    assertAgreesWithReference(baseItem(), null);
  });
});

describe("§RG-6 resolving does not mutate the source item, review, or profile objects", () => {
  it("adminReview.overrides and intelligenceOverrides are untouched after resolution", () => {
    const item = baseItem({
      adminReview: { reviewStatus: "overridden", overrides: { subcategory: "trousers" }, intelligenceOverrides: { visualWeight: "light" } },
      styleMeProfile: { profileStatus: "approved", visualWeight: "heavy", intentionPotentials: { "feel-sharper": "Strong" } },
    });
    const before = JSON.stringify(item);
    resolveGarment(item, PASSPORT);
    assert.equal(JSON.stringify(item), before);
  });
});

describe("§RG-7 category/slot resolution matches the reference across categories", () => {
  for (const category of ["TOPS", "BOTTOMS", "DRESSES", "OUTERWEAR"]) {
    it(`category=${category}`, () => {
      assertAgreesWithReference(baseItem({ category }));
    });
  }
});
