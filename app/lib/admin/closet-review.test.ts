import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  validateOverrides,
  computeReviewStatus,
  getEffectiveClosetItem,
} from "./closet-review.server";
import type { ClosetItemFields, ClosetItemOverrides } from "./closet-review.server";

// ── Helpers ───────────────────────────────────────────────────────────────────

function baseItem(): ClosetItemFields {
  return {
    subcategory:      "midi dress",
    silhouette:       "a-line",
    fitProfile:       "body-skimming",
    hemLength:        "midi",
    topLength:        "n/a",
    waistShape:       "high-rise",
    sleeveLength:     "sleeveless",
    necklineCoverage: "v-neck",
    shoulderCoverage: false,
    midriffExposed:   false,
    material:         "silk",
    pattern:          "floral",
    primaryColor:     "sage green",
    colors:           ["sage green", "ivory"],
    occasions:        ["casual", "weekend"],
    seasons:          ["spring", "summer"],
    formality:        "smart-casual",
    styleTags:        ["feminine", "flowy"],
    stylePersonality: "feminine-romantic",
  };
}

// ── CR-01: review status semantics ────────────────────────────────────────────

describe("CR-01 computeReviewStatus", () => {
  it("null overrides → reviewed", () => {
    assert.equal(computeReviewStatus(null), "reviewed");
  });

  it("undefined overrides → reviewed", () => {
    assert.equal(computeReviewStatus(undefined), "reviewed");
  });

  it("empty object → reviewed", () => {
    assert.equal(computeReviewStatus({}), "reviewed");
  });

  it("one override key → overridden", () => {
    assert.equal(computeReviewStatus({ formality: "casual" }), "overridden");
  });

  it("multiple override keys → overridden", () => {
    assert.equal(computeReviewStatus({ formality: "casual", styleTags: ["classic"] }), "overridden");
  });

  it("removing all keys (empty object) returns to reviewed from overridden state", () => {
    // Simulate the reviewer deleting all overrides
    const withOverrides = computeReviewStatus({ formality: "casual" });
    assert.equal(withOverrides, "overridden");
    const withNoOverrides = computeReviewStatus({});
    assert.equal(withNoOverrides, "reviewed");
  });
});

// ── CR-02: validateOverrides — valid inputs ────────────────────────────────────

describe("CR-02 validateOverrides valid inputs", () => {
  it("empty object is valid", () => {
    assert.deepEqual(validateOverrides({}), {});
  });

  it("null input returns empty object", () => {
    assert.deepEqual(validateOverrides(null), {});
  });

  it("valid formality token", () => {
    const result = validateOverrides({ formality: "casual" });
    assert.equal(result.formality, "casual");
  });

  it("valid silhouette token", () => {
    const result = validateOverrides({ silhouette: "a-line" });
    assert.equal(result.silhouette, "a-line");
  });

  it("null scalar is a valid intentional override", () => {
    const result = validateOverrides({ formality: null });
    assert.ok(Object.prototype.hasOwnProperty.call(result, "formality"), "key must be present");
    assert.equal(result.formality, null);
  });

  it("null shoulderCoverage is a valid intentional override", () => {
    const result = validateOverrides({ shoulderCoverage: null });
    assert.ok(Object.prototype.hasOwnProperty.call(result, "shoulderCoverage"));
    assert.equal(result.shoulderCoverage, null);
  });

  it("empty array is a valid intentional override for occasions", () => {
    const result = validateOverrides({ occasions: [] });
    assert.ok(Object.prototype.hasOwnProperty.call(result, "occasions"), "key must be present");
    assert.deepEqual(result.occasions, []);
  });

  it("empty array is a valid intentional override for styleTags", () => {
    const result = validateOverrides({ styleTags: [] });
    assert.deepEqual(result.styleTags, []);
  });

  it("empty array is a valid intentional override for seasons", () => {
    const result = validateOverrides({ seasons: [] });
    assert.deepEqual(result.seasons, []);
  });

  it("valid occasions array", () => {
    const result = validateOverrides({ occasions: ["work", "casual"] });
    assert.deepEqual(result.occasions, ["work", "casual"]);
  });

  it("styleTags capped at 3 valid tokens", () => {
    const result = validateOverrides({ styleTags: ["feminine", "flowy", "romantic"] });
    assert.deepEqual(result.styleTags, ["feminine", "flowy", "romantic"]);
  });

  it("subcategory is a free string (trimmed/lowercased)", () => {
    const result = validateOverrides({ subcategory: "  Midi Dress  " });
    assert.equal(result.subcategory, "midi dress");
  });

  it("primaryColor is a free string (trimmed/lowercased)", () => {
    const result = validateOverrides({ primaryColor: "  Navy  " });
    assert.equal(result.primaryColor, "navy");
  });

  it("colors array items are normalized to lowercase", () => {
    const result = validateOverrides({ colors: ["Black", "IVORY"] });
    assert.deepEqual(result.colors, ["black", "ivory"]);
  });

  it("boolean true is valid for shoulderCoverage", () => {
    const result = validateOverrides({ shoulderCoverage: true });
    assert.equal(result.shoulderCoverage, true);
  });

  it("boolean false is valid for midriffExposed", () => {
    const result = validateOverrides({ midriffExposed: false });
    assert.equal(result.midriffExposed, false);
  });

  it("all allowed fields can be set together", () => {
    const input = {
      subcategory: "blazer",
      silhouette: "straight",
      fitProfile: "tailored",
      hemLength: "n/a",
      topLength: "hip-length",
      waistShape: "high-rise",
      sleeveLength: "full",
      necklineCoverage: "v-neck",
      shoulderCoverage: true,
      midriffExposed: false,
      material: "wool",
      pattern: "solid",
      primaryColor: "charcoal",
      colors: ["charcoal"],
      occasions: ["work"],
      seasons: ["fall", "winter"],
      formality: "business-casual",
      styleTags: ["classic"],
      stylePersonality: "classic-polished",
    };
    const result = validateOverrides(input);
    assert.equal(Object.keys(result).length, Object.keys(input).length);
  });
});

// ── CR-03: validateOverrides — invalid inputs ─────────────────────────────────

describe("CR-03 validateOverrides invalid inputs", () => {
  it("rejects non-object input (array)", () => {
    assert.throws(() => validateOverrides([{ formality: "casual" }]), /plain object/i);
  });

  it("rejects non-object input (string)", () => {
    assert.throws(() => validateOverrides("casual"), /plain object/i);
  });

  it("unknown key is rejected", () => {
    assert.throws(() => validateOverrides({ unknownField: "value" }), /unknown override key/i);
  });

  it("__proto__ key is rejected when delivered via JSON.parse (real attack vector)", () => {
    // Literal { __proto__: ... } sets the prototype — it is not an own key, so
    // Object.keys() never returns it. JSON.parse creates an actual own property.
    const raw = JSON.parse('{"__proto__": {"injected": true}}');
    assert.throws(() => validateOverrides(raw), /not permitted/i);
  });

  it("constructor key is rejected", () => {
    assert.throws(() => validateOverrides({ constructor: "value" }), /not permitted/i);
  });

  it("prototype key is rejected", () => {
    assert.throws(() => validateOverrides({ prototype: "value" }), /not permitted/i);
  });

  it("invalid formality token rejected", () => {
    assert.throws(() => validateOverrides({ formality: "semi-formal" }), /valid vocabulary token/i);
  });

  it("invalid silhouette token rejected", () => {
    assert.throws(() => validateOverrides({ silhouette: "trapeze" }), /valid vocabulary token/i);
  });

  it("invalid occasion token rejected", () => {
    assert.throws(() => validateOverrides({ occasions: ["casual", "partytime"] }), /valid vocabulary token/i);
  });

  it("invalid stylePersonality token rejected", () => {
    assert.throws(() => validateOverrides({ stylePersonality: "boho-chic" }), /valid vocabulary token/i);
  });

  it("styleTags exceeding 3 items rejected", () => {
    assert.throws(() => validateOverrides({ styleTags: ["feminine", "flowy", "romantic", "chic"] }), /at most 3/i);
  });

  it("non-boolean shoulderCoverage rejected", () => {
    assert.throws(() => validateOverrides({ shoulderCoverage: "yes" }), /boolean/i);
  });

  it("non-boolean midriffExposed rejected", () => {
    assert.throws(() => validateOverrides({ midriffExposed: 1 }), /boolean/i);
  });

  it("occasions must be an array, not a string", () => {
    assert.throws(() => validateOverrides({ occasions: "work" }), /array/i);
  });

  it("empty string subcategory rejected (use null to clear)", () => {
    assert.throws(() => validateOverrides({ subcategory: "  " }), /empty string/i);
  });

  it("empty string primaryColor rejected", () => {
    assert.throws(() => validateOverrides({ primaryColor: "" }), /empty string/i);
  });

  it("colors array with non-string item rejected", () => {
    assert.throws(() => validateOverrides({ colors: ["black", 42] }), /string/i);
  });
});

// ── CR-04: getEffectiveClosetItem — value resolution ─────────────────────────

describe("CR-04 getEffectiveClosetItem value resolution", () => {
  it("no review → returns item values unchanged", () => {
    const item = baseItem();
    const effective = getEffectiveClosetItem(item, null);
    assert.deepEqual(effective, item);
  });

  it("review with null overrides → returns item values unchanged", () => {
    const item = baseItem();
    const effective = getEffectiveClosetItem(item, { reviewStatus: "reviewed", overrides: null });
    assert.deepEqual(effective, item);
  });

  it("admin override wins over item value", () => {
    const item = baseItem();
    const effective = getEffectiveClosetItem(item, {
      reviewStatus: "overridden",
      overrides: { formality: "casual" } as ClosetItemOverrides,
    });
    assert.equal(effective.formality, "casual", "admin override must win");
    assert.equal(effective.silhouette, item.silhouette, "other fields must be unchanged");
  });

  it("absent key falls through to item value", () => {
    const item = baseItem();
    const effective = getEffectiveClosetItem(item, {
      reviewStatus: "overridden",
      overrides: { formality: "casual" } as ClosetItemOverrides,
    });
    assert.equal(effective.styleTags, item.styleTags, "absent override key must use item value");
  });

  it("admin override with null value clears the field", () => {
    const item = baseItem();
    const effective = getEffectiveClosetItem(item, {
      reviewStatus: "overridden",
      overrides: { formality: null } as ClosetItemOverrides,
    });
    assert.equal(effective.formality, null, "null override must clear the field");
  });

  it("admin override with empty array wins over non-empty item array", () => {
    const item = baseItem();
    assert.ok(item.occasions.length > 0, "precondition: item has occasions");
    const effective = getEffectiveClosetItem(item, {
      reviewStatus: "overridden",
      overrides: { occasions: [] } as ClosetItemOverrides,
    });
    assert.deepEqual(effective.occasions, [], "empty array override must clear occasions");
  });

  it("key present with empty array wins (not skipped due to .length === 0)", () => {
    const item = baseItem();
    const effective = getEffectiveClosetItem(item, {
      reviewStatus: "overridden",
      overrides: { styleTags: [] } as ClosetItemOverrides,
    });
    assert.deepEqual(effective.styleTags, [], "key presence determines override, not .length");
  });

  it("original item object is not mutated", () => {
    const item = baseItem();
    const originalFormality = item.formality;
    getEffectiveClosetItem(item, {
      reviewStatus: "overridden",
      overrides: { formality: "casual" } as ClosetItemOverrides,
    });
    assert.equal(item.formality, originalFormality, "original item must not be mutated");
  });

  it("extra fields on item (beyond the ClosetItemFields interface) are preserved", () => {
    const item = { ...baseItem(), id: "item-123", customerId: "cust-abc", name: "Blue dress" } as ClosetItemFields & { id: string; customerId: string; name: string };
    const effective = getEffectiveClosetItem(item, {
      reviewStatus: "overridden",
      overrides: { formality: "casual" } as ClosetItemOverrides,
    });
    assert.equal((effective as typeof item).id, "item-123", "extra fields must pass through");
    assert.equal((effective as typeof item).name, "Blue dress");
  });

  it("admin override for boolean field with explicit false wins", () => {
    const item = { ...baseItem(), midriffExposed: true };
    const effective = getEffectiveClosetItem(item, {
      reviewStatus: "overridden",
      overrides: { midriffExposed: false } as ClosetItemOverrides,
    });
    assert.equal(effective.midriffExposed, false, "explicit false override must win");
  });
});
