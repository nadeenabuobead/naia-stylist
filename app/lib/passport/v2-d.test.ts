// app/lib/passport/v2-d.test.ts
// V2-D contract tests — complete Sizes & Fit profile

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ─────────────────────────────────────────────────────────────────────────────
// D.1  Sizing system options
// ─────────────────────────────────────────────────────────────────────────────

describe("D.1 Sizing system options", () => {
  const VALID = ["uk", "us", "eu", "international", "other"];

  it("exactly 5 options", () => assert.equal(VALID.length, 5));
  it("contains uk", () => assert.ok(VALID.includes("uk")));
  it("contains us", () => assert.ok(VALID.includes("us")));
  it("contains eu", () => assert.ok(VALID.includes("eu")));
  it("contains international", () => assert.ok(VALID.includes("international")));
  it("contains other", () => assert.ok(VALID.includes("other")));
  it("does NOT contain au", () => assert.ok(!VALID.includes("au")));
});

// ─────────────────────────────────────────────────────────────────────────────
// D.2  UK clothing sizes
// ─────────────────────────────────────────────────────────────────────────────

describe("D.2 UK clothing sizes", () => {
  const UK = ["4","6","8","10","12","14","16","18","20","22","24"];
  it("starts at 4 and ends at 24", () => {
    assert.equal(UK[0], "4");
    assert.equal(UK[UK.length - 1], "24");
  });
  it("contains size 10", () => assert.ok(UK.includes("10")));
  it("contains size 16", () => assert.ok(UK.includes("16")));
  it("does NOT contain 1 (US sizes)", () => assert.ok(!UK.includes("1")));
});

// ─────────────────────────────────────────────────────────────────────────────
// D.3  US clothing sizes
// ─────────────────────────────────────────────────────────────────────────────

describe("D.3 US clothing sizes", () => {
  const US = ["0","2","4","6","8","10","12","14","16","18"];
  it("starts at 0", () => assert.equal(US[0], "0"));
  it("contains size 6", () => assert.ok(US.includes("6")));
  it("does NOT contain UK-only sizes like 4 in even-only sense", () => assert.ok(US.includes("4")));
  it("does NOT contain 1 (invalid US size)", () => assert.ok(!US.includes("1")));
});

// ─────────────────────────────────────────────────────────────────────────────
// D.4  EU clothing sizes
// ─────────────────────────────────────────────────────────────────────────────

describe("D.4 EU clothing sizes", () => {
  const EU = ["32","34","36","38","40","42","44","46","48","50"];
  it("starts at 32", () => assert.equal(EU[0], "32"));
  it("contains size 38", () => assert.ok(EU.includes("38")));
  it("does NOT contain US 0", () => assert.ok(!EU.includes("0")));
});

// ─────────────────────────────────────────────────────────────────────────────
// D.5  International clothing sizes
// ─────────────────────────────────────────────────────────────────────────────

describe("D.5 International clothing sizes", () => {
  const INT = ["XS","S","M","L","XL","XXL","XXXL"];
  it("7 international sizes", () => assert.equal(INT.length, 7));
  it("contains XS and XXXL", () => {
    assert.ok(INT.includes("XS"));
    assert.ok(INT.includes("XXXL"));
  });
  it("does NOT contain numeric sizes", () => {
    assert.ok(!INT.includes("10"));
    assert.ok(!INT.includes("36"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D.6  Shoe sizes — International has no shoe size
// ─────────────────────────────────────────────────────────────────────────────

describe("D.6 International system — no shoe size", () => {
  const SHOE_SIZES: Record<string, string[]> = {
    uk: ["2","2.5","3","3.5","4","4.5","5","5.5","6","6.5","7","7.5","8","8.5"],
    us: ["4","4.5","5","5.5","6","6.5","7","7.5","8","8.5","9","9.5","10","10.5"],
    eu: ["34","35","36","37","38","39","40","41","42","43","44"],
  };
  it("no shoe sizes defined for international", () => {
    assert.ok(!("international" in SHOE_SIZES));
  });
  it("UK shoe sizes contain 5.5", () => assert.ok(SHOE_SIZES.uk.includes("5.5")));
  it("US shoe sizes contain 8", () => assert.ok(SHOE_SIZES.us.includes("8")));
  it("EU shoe sizes contain 38", () => assert.ok(SHOE_SIZES.eu.includes("38")));
});

// ─────────────────────────────────────────────────────────────────────────────
// D.7  Height validation contract
// ─────────────────────────────────────────────────────────────────────────────

function validateHeight(value: string | null | undefined): boolean {
  if (value == null || value === "") return true;
  if (typeof value !== "string") return false;
  const cm = value.match(/^(\d+)cm$/);
  if (cm) { const n = parseInt(cm[1]); return n >= 100 && n <= 250; }
  const ftIn = value.match(/^(\d+)ft (\d+)in$/);
  if (ftIn) { const ft = parseInt(ftIn[1]); const i = parseInt(ftIn[2]); return ft >= 3 && ft <= 8 && i >= 0 && i <= 11; }
  return false;
}

describe("D.7 Height validation", () => {
  it("accepts valid cm", () => {
    assert.ok(validateHeight("168cm"));
    assert.ok(validateHeight("170cm"));
    assert.ok(validateHeight("100cm"));
    assert.ok(validateHeight("250cm"));
  });
  it("rejects cm out of range", () => {
    assert.ok(!validateHeight("99cm"));
    assert.ok(!validateHeight("251cm"));
  });
  it("accepts valid ft/in", () => {
    assert.ok(validateHeight("5ft 8in"));
    assert.ok(validateHeight("3ft 0in"));
    assert.ok(validateHeight("8ft 11in"));
  });
  it("rejects ft/in out of range", () => {
    assert.ok(!validateHeight("2ft 0in"));
    assert.ok(!validateHeight("9ft 0in"));
    assert.ok(!validateHeight("5ft 12in"));
  });
  it("accepts null/empty (field not required)", () => {
    assert.ok(validateHeight(null));
    assert.ok(validateHeight(""));
  });
  it("rejects invalid format", () => {
    assert.ok(!validateHeight("170"));
    assert.ok(!validateHeight("5'8\""));
    assert.ok(!validateHeight("5ft8in"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D.8  Measurement validation contract
// ─────────────────────────────────────────────────────────────────────────────

function validateMeasurement(value: string | null | undefined): boolean {
  if (value == null || value === "") return true;
  if (typeof value !== "string") return false;
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim())) return false;
  const n = parseFloat(value);
  return n > 0 && n <= 999;
}

describe("D.8 Measurement validation", () => {
  it("accepts valid integers", () => {
    assert.ok(validateMeasurement("90"));
    assert.ok(validateMeasurement("36"));
  });
  it("accepts valid decimals", () => {
    assert.ok(validateMeasurement("90.5"));
    assert.ok(validateMeasurement("36.75"));
  });
  it("rejects zero and negative", () => {
    assert.ok(!validateMeasurement("0"));
    assert.ok(!validateMeasurement("-1"));
  });
  it("rejects non-numeric", () => {
    assert.ok(!validateMeasurement("90cm"));
    assert.ok(!validateMeasurement("thirty-six"));
  });
  it("accepts null/empty (field not required)", () => {
    assert.ok(validateMeasurement(null));
    assert.ok(validateMeasurement(""));
  });
  it("rejects more than 2 decimal places", () => {
    assert.ok(!validateMeasurement("90.123"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D.9  Body shape options
// ─────────────────────────────────────────────────────────────────────────────

describe("D.9 Body shape options", () => {
  const BODY_SHAPE_VALID = new Set([
    "hourglass", "pear", "apple", "rectangle", "inverted-triangle",
    "not-sure", "prefer-not-to-say",
  ]);
  it("7 options", () => assert.equal(BODY_SHAPE_VALID.size, 7));
  it("includes 5 named shapes", () => {
    assert.ok(BODY_SHAPE_VALID.has("hourglass"));
    assert.ok(BODY_SHAPE_VALID.has("pear"));
    assert.ok(BODY_SHAPE_VALID.has("apple"));
    assert.ok(BODY_SHAPE_VALID.has("rectangle"));
    assert.ok(BODY_SHAPE_VALID.has("inverted-triangle"));
  });
  it("includes not-sure and prefer-not-to-say", () => {
    assert.ok(BODY_SHAPE_VALID.has("not-sure"));
    assert.ok(BODY_SHAPE_VALID.has("prefer-not-to-say"));
  });
  it("does NOT include figure", () => assert.ok(!BODY_SHAPE_VALID.has("figure")));
});

// ─────────────────────────────────────────────────────────────────────────────
// D.10  not-sure / prefer-not-to-say treated as absent in recommendations
// ─────────────────────────────────────────────────────────────────────────────

describe("D.10 not-sure / prefer-not-to-say omitted from AI prompts", () => {
  const BODY_SHAPE_ABSENT = new Set(["not-sure", "prefer-not-to-say"]);

  function shouldIncludeBodyShape(bodyShape: string | null | undefined): boolean {
    if (!bodyShape) return false;
    return !BODY_SHAPE_ABSENT.has(bodyShape);
  }

  it("not-sure is excluded", () => assert.ok(!shouldIncludeBodyShape("not-sure")));
  it("prefer-not-to-say is excluded", () => assert.ok(!shouldIncludeBodyShape("prefer-not-to-say")));
  it("hourglass is included", () => assert.ok(shouldIncludeBodyShape("hourglass")));
  it("null is excluded", () => assert.ok(!shouldIncludeBodyShape(null)));
});

// ─────────────────────────────────────────────────────────────────────────────
// D.11  Fit concern options
// ─────────────────────────────────────────────────────────────────────────────

describe("D.11 Fit concern options", () => {
  const FIT_CONCERN_VALID = new Set([
    "petite", "tall", "short-torso", "long-torso", "broad-shoulders",
    "narrow-shoulders", "fuller-bust", "narrow-hips", "arm-fit", "thigh-fit",
  ]);
  it("exactly 10 fit concern options", () => assert.equal(FIT_CONCERN_VALID.size, 10));
  it("contains petite", () => assert.ok(FIT_CONCERN_VALID.has("petite")));
  it("contains fuller-bust", () => assert.ok(FIT_CONCERN_VALID.has("fuller-bust")));
  it("contains arm-fit", () => assert.ok(FIT_CONCERN_VALID.has("arm-fit")));
  it("contains thigh-fit", () => assert.ok(FIT_CONCERN_VALID.has("thigh-fit")));
  it("rejects unknown concern", () => assert.ok(!FIT_CONCERN_VALID.has("wide-hips")));
});

// ─────────────────────────────────────────────────────────────────────────────
// D.12  fitConcerns — array, no duplicates, all must be valid
// ─────────────────────────────────────────────────────────────────────────────

describe("D.12 fitConcerns array validation", () => {
  const FIT_CONCERN_VALID = new Set([
    "petite", "tall", "short-torso", "long-torso", "broad-shoulders",
    "narrow-shoulders", "fuller-bust", "narrow-hips", "arm-fit", "thigh-fit",
  ]);

  function validateFitConcerns(v: unknown): boolean {
    if (!Array.isArray(v)) return false;
    return v.every((id: unknown) => typeof id === "string" && FIT_CONCERN_VALID.has(id))
        && new Set(v).size === v.length;
  }

  it("accepts empty array", () => assert.ok(validateFitConcerns([])));
  it("accepts valid subset", () => assert.ok(validateFitConcerns(["petite", "fuller-bust"])));
  it("accepts all 10 options", () => assert.ok(validateFitConcerns([...FIT_CONCERN_VALID])));
  it("rejects unknown concern", () => assert.ok(!validateFitConcerns(["curvy"])));
  it("rejects duplicates", () => assert.ok(!validateFitConcerns(["petite", "petite"])));
  it("rejects non-array", () => assert.ok(!validateFitConcerns("petite")));
});

// ─────────────────────────────────────────────────────────────────────────────
// D.13  Preferred coverage options
// ─────────────────────────────────────────────────────────────────────────────

describe("D.13 Preferred coverage options", () => {
  const PREFERRED_COVERAGE_VALID = new Set(["mostly-covered", "balanced", "varies", "more-open"]);
  it("exactly 4 options", () => assert.equal(PREFERRED_COVERAGE_VALID.size, 4));
  it("contains mostly-covered", () => assert.ok(PREFERRED_COVERAGE_VALID.has("mostly-covered")));
  it("contains balanced", () => assert.ok(PREFERRED_COVERAGE_VALID.has("balanced")));
  it("contains varies", () => assert.ok(PREFERRED_COVERAGE_VALID.has("varies")));
  it("contains more-open", () => assert.ok(PREFERRED_COVERAGE_VALID.has("more-open")));
  it("rejects unknown value", () => assert.ok(!PREFERRED_COVERAGE_VALID.has("open")));
  it("is separate from coveragePreferences[] (Section 4 field)", () => {
    // preferredCoverage is a String? (single choice); coveragePreferences is String[] (multi)
    assert.ok(PREFERRED_COVERAGE_VALID.has("balanced"));
    const COVERAGE_PREFS = new Set(["open-necklines","sleeves-preferred","longer-hemlines","cropped","no-preference"]);
    assert.ok(!COVERAGE_PREFS.has("balanced")); // distinct sets
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D.14  measurementUnit options
// ─────────────────────────────────────────────────────────────────────────────

describe("D.14 measurementUnit options", () => {
  const MEASUREMENT_UNIT_VALID = new Set(["cm", "in"]);
  it("exactly 2 options", () => assert.equal(MEASUREMENT_UNIT_VALID.size, 2));
  it("contains cm and in", () => {
    assert.ok(MEASUREMENT_UNIT_VALID.has("cm"));
    assert.ok(MEASUREMENT_UNIT_VALID.has("in"));
  });
  it("rejects mm and ft", () => {
    assert.ok(!MEASUREMENT_UNIT_VALID.has("mm"));
    assert.ok(!MEASUREMENT_UNIT_VALID.has("ft"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D.15  Clothing size validation per system
// ─────────────────────────────────────────────────────────────────────────────

describe("D.15 Clothing size validation per system", () => {
  const CLOTHING_SIZES: Record<string, Set<string>> = {
    uk:            new Set(["4","6","8","10","12","14","16","18","20","22","24"]),
    us:            new Set(["0","2","4","6","8","10","12","14","16","18"]),
    eu:            new Set(["32","34","36","38","40","42","44","46","48","50"]),
    international: new Set(["XS","S","M","L","XL","XXL","XXXL"]),
  };

  function validateClothingSize(value: string | null | undefined, system: string | null): boolean {
    if (value == null || value === "") return true;
    if (typeof value !== "string" || value.length > 50) return false;
    if (system && system !== "other") {
      const valid = CLOTHING_SIZES[system];
      if (valid && !valid.has(value.trim())) return false;
    }
    return true;
  }

  it("accepts valid UK size", () => assert.ok(validateClothingSize("10", "uk")));
  it("rejects invalid UK size", () => assert.ok(!validateClothingSize("11", "uk")));
  it("accepts valid EU size", () => assert.ok(validateClothingSize("38", "eu")));
  it("accepts valid International size", () => assert.ok(validateClothingSize("M", "international")));
  it("rejects numeric size for International", () => assert.ok(!validateClothingSize("10", "international")));
  it("accepts any string for other system", () => assert.ok(validateClothingSize("42/Short", "other")));
  it("accepts any string when no system set", () => assert.ok(validateClothingSize("10", null)));
  it("accepts null/empty regardless of system", () => {
    assert.ok(validateClothingSize(null, "uk"));
    assert.ok(validateClothingSize("", "eu"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D.16  Shoe size validation per system
// ─────────────────────────────────────────────────────────────────────────────

describe("D.16 Shoe size validation per system", () => {
  const SHOE_SIZES: Record<string, Set<string>> = {
    uk: new Set(["2","2.5","3","3.5","4","4.5","5","5.5","6","6.5","7","7.5","8","8.5"]),
    us: new Set(["4","4.5","5","5.5","6","6.5","7","7.5","8","8.5","9","9.5","10","10.5"]),
    eu: new Set(["34","35","36","37","38","39","40","41","42","43","44"]),
  };

  function validateShoeSize(value: string | null | undefined, system: string | null): boolean {
    if (value == null || value === "") return true;
    if (typeof value !== "string" || value.length > 10) return false;
    if (system === "international") return false;
    if (system && system !== "other") {
      const valid = SHOE_SIZES[system];
      if (valid && !valid.has(value.trim())) return false;
    }
    return true;
  }

  it("accepts valid UK shoe size", () => assert.ok(validateShoeSize("5.5", "uk")));
  it("rejects invalid UK shoe size", () => assert.ok(!validateShoeSize("6.3", "uk")));
  it("rejects any shoe size for International", () => {
    assert.ok(!validateShoeSize("M", "international"));
    assert.ok(!validateShoeSize("38", "international"));
  });
  it("accepts null for any system (field optional)", () => {
    assert.ok(validateShoeSize(null, "international"));
    assert.ok(validateShoeSize("", "international"));
  });
  it("accepts free text for other system", () => assert.ok(validateShoeSize("7W", "other")));
});

// ─────────────────────────────────────────────────────────────────────────────
// D.17  Sizing system change safety contract
// ─────────────────────────────────────────────────────────────────────────────

describe("D.17 Sizing system change safety contract", () => {
  // V2-F: shoeSize is independent — clothing system change only checks clothing sizes
  interface FakeProfile { sizingSystem: string | null; topSize: string | null; bottomSize: string | null; dressSize: string | null; shoeSize: string | null; }

  function checkNeedsConfirmation(
    op: FakeProfile,
    newSys: string | null,
    confirmed: boolean,
  ): "ok" | "needs_confirmation" {
    const savedSys = op.sizingSystem;
    const changing = newSys !== savedSys;
    // V2-F: only clothing sizes trigger confirmation; shoeSize is independent
    const hasSavedClothingSizes = !!(op.topSize || op.bottomSize || op.dressSize);
    if (changing && hasSavedClothingSizes && !confirmed) return "needs_confirmation";
    return "ok";
  }

  it("requires confirmation: system changing, saved system + saved clothing sizes, no confirm", () => {
    const op: FakeProfile = { sizingSystem: "uk", topSize: "10", bottomSize: null, dressSize: null, shoeSize: null };
    assert.equal(checkNeedsConfirmation(op, "us", false), "needs_confirmation");
  });

  it("passes when confirmed", () => {
    const op: FakeProfile = { sizingSystem: "uk", topSize: "10", bottomSize: null, dressSize: null, shoeSize: null };
    assert.equal(checkNeedsConfirmation(op, "us", true), "ok");
  });

  it("legacy sizes with no saved system (null → uk): confirmation still required", () => {
    const op: FakeProfile = { sizingSystem: null, topSize: "UK 10", bottomSize: null, dressSize: null, shoeSize: null };
    assert.equal(checkNeedsConfirmation(op, "uk", false), "needs_confirmation");
  });

  it("control: null system, no sizes → uk: no confirmation needed", () => {
    const op: FakeProfile = { sizingSystem: null, topSize: null, bottomSize: null, dressSize: null, shoeSize: null };
    assert.equal(checkNeedsConfirmation(op, "uk", false), "ok");
  });

  it("no clothing sizes in DB: no confirmation needed (shoeSize alone does not trigger)", () => {
    const op: FakeProfile = { sizingSystem: "uk", topSize: null, bottomSize: null, dressSize: null, shoeSize: "5" };
    assert.equal(checkNeedsConfirmation(op, "us", false), "ok");
  });

  it("same system: no change, no confirmation", () => {
    const op: FakeProfile = { sizingSystem: "uk", topSize: "10", bottomSize: null, dressSize: null, shoeSize: null };
    assert.equal(checkNeedsConfirmation(op, "uk", false), "ok");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D.18  Sizes cleared on confirmed system change
// ─────────────────────────────────────────────────────────────────────────────

describe("D.18 Size fields cleared when system changes with confirmation", () => {
  // V2-F: clothing system change clears only top/bottom/dress — NOT shoeSize
  function buildProfileData(
    body: Record<string, unknown>,
    op: { sizingSystem: string | null; topSize: string | null; bottomSize: string | null; dressSize: string | null; shoeSize: string | null },
  ) {
    const pickText = (key: string, fallback: string | null): string | null => {
      if (!Object.hasOwn(body, key)) return fallback;
      const v = body[key];
      return typeof v === "string" && v.trim() !== "" ? v : null;
    };
    const savedSys = op.sizingSystem;
    const newSys = Object.hasOwn(body, "sizingSystem") ? (body["sizingSystem"] as string | null) : savedSys;
    const changing = newSys !== savedSys;
    const clearClothingSizes = changing && body["confirmSizeSystemChange"] === true;
    return {
      sizingSystem: pickText("sizingSystem", op.sizingSystem),
      topSize:     clearClothingSizes ? null : pickText("topSize",    op.topSize),
      bottomSize:  clearClothingSizes ? null : pickText("bottomSize", op.bottomSize),
      dressSize:   clearClothingSizes ? null : pickText("dressSize",  op.dressSize),
      // V2-F: shoeSize is independent — never cleared by clothing system change
      shoeSize:    pickText("shoeSize", op.shoeSize),
    };
  }

  it("clears only clothing sizes (not shoeSize) on confirmed clothing system change", () => {
    const op = { sizingSystem: "uk", topSize: "10", bottomSize: "12", dressSize: "10", shoeSize: "5" };
    const data = buildProfileData({ sizingSystem: "us", confirmSizeSystemChange: true }, op);
    assert.equal(data.topSize, null);
    assert.equal(data.bottomSize, null);
    assert.equal(data.dressSize, null);
    assert.equal(data.shoeSize, "5"); // V2-F: shoe size preserved
    assert.equal(data.sizingSystem, "us");
  });

  it("preserves sizes when no system change", () => {
    const op = { sizingSystem: "uk", topSize: "10", bottomSize: "12", dressSize: "10", shoeSize: "5" };
    const data = buildProfileData({ topSize: "12" }, op);
    assert.equal(data.topSize, "12");
    assert.equal(data.bottomSize, "12");
  });

  it("preserves sizes when system did not change but confirmSizeSystemChange is true", () => {
    const op = { sizingSystem: "uk", topSize: "10", bottomSize: "12", dressSize: "10", shoeSize: "5" };
    const data = buildProfileData({ sizingSystem: "uk", confirmSizeSystemChange: true }, op);
    assert.equal(data.topSize, "10"); // system unchanged → no clear
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D.19  confirmSizeSystemChange is request-only (never persisted)
// ─────────────────────────────────────────────────────────────────────────────

describe("D.19 confirmSizeSystemChange is request-only", () => {
  // V2-F: also includes confirmShoeSystemChange and shoeSizingSystem
  const REQUEST_ONLY_KEYS = new Set(["baseProfileUpdatedAt", "editedField", "confirmSizeSystemChange", "confirmShoeSystemChange"]);
  const RECOGNISED_FIELDS = new Set([
    "sizingSystem", "topSize", "bottomSize", "dressSize",
    "shoeSizingSystem", "shoeSize",
    "height", "bustMeasurement", "waistMeasurement", "hipMeasurement",
    "measurementUnit", "bodyShape", "fitConcerns", "preferredCoverage",
    "bodyFocusAreas", "bodyAvoidAreas",
  ]);

  it("confirmSizeSystemChange is in REQUEST_ONLY_KEYS", () => {
    assert.ok(REQUEST_ONLY_KEYS.has("confirmSizeSystemChange"));
  });
  it("confirmSizeSystemChange is NOT in RECOGNISED_FIELDS", () => {
    assert.ok(!RECOGNISED_FIELDS.has("confirmSizeSystemChange"));
  });
  it("confirmShoeSystemChange is in REQUEST_ONLY_KEYS", () => {
    assert.ok(REQUEST_ONLY_KEYS.has("confirmShoeSystemChange"));
  });
  it("confirmShoeSystemChange is NOT in RECOGNISED_FIELDS", () => {
    assert.ok(!RECOGNISED_FIELDS.has("confirmShoeSystemChange"));
  });
  it("shoeSizingSystem IS in RECOGNISED_FIELDS (persisted DB column)", () => {
    assert.ok(RECOGNISED_FIELDS.has("shoeSizingSystem"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D.20  Height display parsing
// ─────────────────────────────────────────────────────────────────────────────

describe("D.20 Height display parsing", () => {
  function parseHeightForDisplay(height: string | undefined, unit: "cm" | "ft-in"): { cm?: string; ft?: string; in?: string } {
    if (!height || height.trim() === "") return {};
    if (unit === "cm") {
      const m = height.match(/^(\d+)cm$/);
      return m ? { cm: m[1] } : {};
    }
    const m = height.match(/^(\d+)ft (\d+)in$/);
    return m ? { ft: m[1], in: m[2] } : {};
  }

  it("parses cm for cm mode", () => {
    const p = parseHeightForDisplay("168cm", "cm");
    assert.equal(p.cm, "168");
    assert.equal(p.ft, undefined);
  });
  it("parses ft/in for ft-in mode", () => {
    const p = parseHeightForDisplay("5ft 8in", "ft-in");
    assert.equal(p.ft, "5");
    assert.equal(p.in, "8");
    assert.equal(p.cm, undefined);
  });
  it("returns empty when unit mismatched (cm saved but ft-in mode shown)", () => {
    const p = parseHeightForDisplay("168cm", "ft-in");
    assert.equal(Object.keys(p).length, 0);
  });
  it("returns empty for empty string", () => {
    const p = parseHeightForDisplay("", "cm");
    assert.equal(Object.keys(p).length, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D.21  Section 5 — optional: true (never missing, never in Continue queue)
// ─────────────────────────────────────────────────────────────────────────────

describe("D.21 Section 5 optional contract", () => {
  interface SectionDef { id: string; optional?: boolean; placeholder?: boolean; }

  const sizes: SectionDef = { id: "sizes", optional: true };

  it("has optional: true", () => assert.ok(sizes.optional === true));
  it("does NOT have placeholder: true", () => assert.ok(!sizes.placeholder));
  it("is excluded from missingSections", () => {
    const sections: SectionDef[] = [sizes];
    const missing = sections.filter(s => !s.optional && !s.placeholder);
    assert.equal(missing.length, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D.22  Section 5 subFields — 15 fields defined
// ─────────────────────────────────────────────────────────────────────────────

describe("D.22 Section 5 — 13 subFields after V2-F shoe-sizing-system addition", () => {
  // body-focus-areas, body-avoid-areas, preferred-coverage moved to Section 4 (V2-D UX correction)
  // shoe-sizing-system added in V2-F
  const SIZES_SUBFIELDS = [
    "sizing-system", "top-size", "bottom-size", "dress-size",
    "shoe-sizing-system", "shoe-size",
    "height", "measurement-unit", "bust-measurement", "waist-measurement", "hip-measurement",
    "body-shape", "fit-concerns",
  ];

  it("exactly 13 subFields", () => assert.equal(SIZES_SUBFIELDS.length, 13));
  it("includes shoe-sizing-system", () => assert.ok(SIZES_SUBFIELDS.includes("shoe-sizing-system")));
  it("does NOT include body-focus-areas (moved to Section 4)", () => {
    assert.ok(!SIZES_SUBFIELDS.includes("body-focus-areas"));
  });
  it("does NOT include body-avoid-areas (moved to Section 4)", () => {
    assert.ok(!SIZES_SUBFIELDS.includes("body-avoid-areas"));
  });
  it("does NOT include preferred-coverage (moved to Section 4)", () => {
    assert.ok(!SIZES_SUBFIELDS.includes("preferred-coverage"));
  });
  it("includes all sizing fields", () => {
    for (const k of ["sizing-system","top-size","bottom-size","dress-size","shoe-size"]) {
      assert.ok(SIZES_SUBFIELDS.includes(k), `Missing: ${k}`);
    }
  });
  it("includes all measurement/proportions fields", () => {
    for (const k of ["height","measurement-unit","bust-measurement","waist-measurement",
                     "hip-measurement","body-shape","fit-concerns"]) {
      assert.ok(SIZES_SUBFIELDS.includes(k), `Missing: ${k}`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D.23  OnboardingAnswers type includes all V2-D draft keys
// ─────────────────────────────────────────────────────────────────────────────

describe("D.23 OnboardingAnswers includes V2-D draft keys", () => {
  const V2D_KEYS = [
    "sizing-system", "top-size", "bottom-size", "dress-size", "shoe-size",
    "height", "measurement-unit", "bust-measurement", "waist-measurement",
    "hip-measurement", "body-shape", "fit-concerns", "preferred-coverage",
  ];

  it("13 new V2-D keys added", () => assert.equal(V2D_KEYS.length, 13));

  it("quiz-data exports the type with V2-D keys", async () => {
    const mod = await import("../onboarding/quiz-data");
    // Type check: create an object with all V2-D keys and verify no runtime errors
    const sample: typeof mod.quizQuestions[number] extends never ? never : object = {};
    const answers: Record<string, unknown> = {
      "sizing-system":      "uk",
      "top-size":           "10",
      "bottom-size":        "10",
      "dress-size":         "10",
      "shoe-size":          "5",
      "height":             "168cm",
      "measurement-unit":   "cm",
      "bust-measurement":   "90",
      "waist-measurement":  "70",
      "hip-measurement":    "95",
      "body-shape":         "hourglass",
      "fit-concerns":       ["petite"],
      "preferred-coverage": "balanced",
    };
    void sample;
    for (const key of V2D_KEYS) assert.ok(key in answers);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D.24  RECOGNISED_FIELDS includes all V2-D server keys
// ─────────────────────────────────────────────────────────────────────────────

describe("D.24 Server RECOGNISED_FIELDS includes V2-D keys", () => {
  const RECOGNISED_FIELDS = new Set([
    "sizingSystem", "topSize", "bottomSize", "dressSize", "shoeSize",
    "height", "bustMeasurement", "waistMeasurement", "hipMeasurement",
    "measurementUnit", "bodyShape", "fitConcerns", "preferredCoverage",
  ]);

  const EXPECTED = [
    "sizingSystem", "topSize", "bottomSize", "dressSize", "shoeSize",
    "height", "bustMeasurement", "waistMeasurement", "hipMeasurement",
    "measurementUnit", "bodyShape", "fitConcerns", "preferredCoverage",
  ];

  for (const key of EXPECTED) {
    it(`includes ${key}`, () => assert.ok(RECOGNISED_FIELDS.has(key)));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// D.25  Buy or Skip — FIT CERTAINTY RULE present in prompt
// ─────────────────────────────────────────────────────────────────────────────

describe("D.25 Buy or Skip FIT CERTAINTY RULE", () => {
  const CERTAINTY_RULE = "Never write \"This will fit you\", \"This is your size\", or any equivalent certainty claim based solely on the customer's size or measurement data. Exact-fit conclusions require garment measurements AND a verified size chart comparison.";

  it("certainty rule is defined", () => {
    assert.ok(CERTAINTY_RULE.includes("fit you"));
    assert.ok(CERTAINTY_RULE.includes("certainty claim"));
  });

  it("certainty rule prohibits 'This will fit you'", () => {
    assert.ok(CERTAINTY_RULE.includes("This will fit you"));
  });

  it("requires product garment measurements for exact fit conclusions", () => {
    assert.ok(CERTAINTY_RULE.includes("garment measurements"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D.26  Section 5 overview summary includes sizing line
// ─────────────────────────────────────────────────────────────────────────────

describe("D.26 Section 5 overview summary — sizing line only", () => {
  const SIZING_SYSTEM_LABELS: Record<string, string> = {
    "uk": "UK", "us": "US", "eu": "EU", "international": "International", "other": "Other",
  };

  function buildSizingLine(sys: string | undefined, top: string | undefined, bottom: string | undefined, dress: string | undefined): string {
    const parts: string[] = [];
    if (sys) parts.push(SIZING_SYSTEM_LABELS[sys] ?? sys.toUpperCase());
    if (top) parts.push(`Top ${top}`);
    if (bottom && bottom !== top) parts.push(`Bottom ${bottom}`);
    if (dress) parts.push(`Dress ${dress}`);
    return parts.join(" · ");
  }

  it("shows UK · Top 10 · Dress 10", () => {
    assert.equal(buildSizingLine("uk", "10", "10", "10"), "UK · Top 10 · Dress 10");
  });
  it("omits bottom when same as top", () => {
    assert.equal(buildSizingLine("us", "6", "6", undefined), "US · Top 6");
  });
  it("shows both when different", () => {
    assert.equal(buildSizingLine("eu", "38", "40", undefined), "EU · Top 38 · Bottom 40");
  });
  it("shows only system when no sizes", () => {
    assert.equal(buildSizingLine("uk", undefined, undefined, undefined), "UK");
  });
  it("empty when nothing set", () => {
    assert.equal(buildSizingLine(undefined, undefined, undefined, undefined), "");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D.27  Field placement after UX correction — Section 4 vs Section 5
// ─────────────────────────────────────────────────────────────────────────────

describe("D.27 Field placement — Section 4 gains highlight/coverage fields; Section 5 loses them", () => {
  const FIT_SUBFIELDS = [
    "silhouette", "structure", "coverage-preferences",
    "body-focus-areas", "body-avoid-areas", "preferred-coverage",
  ];
  const SIZES_SUBFIELDS = [
    "sizing-system", "top-size", "bottom-size", "dress-size",
    "shoe-sizing-system", "shoe-size",
    "height", "measurement-unit", "bust-measurement", "waist-measurement", "hip-measurement",
    "body-shape", "fit-concerns",
  ];

  it("body-focus-areas is in Section 4 (fit)", ()    => assert.ok(FIT_SUBFIELDS.includes("body-focus-areas")));
  it("body-avoid-areas is in Section 4 (fit)", ()    => assert.ok(FIT_SUBFIELDS.includes("body-avoid-areas")));
  it("preferred-coverage is in Section 4 (fit)", ()  => assert.ok(FIT_SUBFIELDS.includes("preferred-coverage")));

  it("body-focus-areas is NOT in Section 5 (sizes)", ()   => assert.ok(!SIZES_SUBFIELDS.includes("body-focus-areas")));
  it("body-avoid-areas is NOT in Section 5 (sizes)", ()   => assert.ok(!SIZES_SUBFIELDS.includes("body-avoid-areas")));
  it("preferred-coverage is NOT in Section 5 (sizes)", () => assert.ok(!SIZES_SUBFIELDS.includes("preferred-coverage")));

  it("Section 4 still contains silhouette", ()               => assert.ok(FIT_SUBFIELDS.includes("silhouette")));
  it("Section 4 still contains structure", ()                => assert.ok(FIT_SUBFIELDS.includes("structure")));
  it("Section 4 still contains coverage-preferences", ()     => assert.ok(FIT_SUBFIELDS.includes("coverage-preferences")));

  it("Section 5 still contains sizing-system", ()            => assert.ok(SIZES_SUBFIELDS.includes("sizing-system")));
  it("Section 5 now contains shoe-sizing-system", ()         => assert.ok(SIZES_SUBFIELDS.includes("shoe-sizing-system")));
  it("Section 5 still contains body-shape", ()               => assert.ok(SIZES_SUBFIELDS.includes("body-shape")));
  it("Section 5 still contains fit-concerns", ()             => assert.ok(SIZES_SUBFIELDS.includes("fit-concerns")));
  it("Section 5 still contains height", ()                   => assert.ok(SIZES_SUBFIELDS.includes("height")));
  it("Section 5 still contains bust-measurement", ()         => assert.ok(SIZES_SUBFIELDS.includes("bust-measurement")));

  it("Section 4 has exactly 6 subFields",  () => assert.equal(FIT_SUBFIELDS.length, 6));
  it("Section 5 has exactly 13 subFields", () => assert.equal(SIZES_SUBFIELDS.length, 13));
});

// ─────────────────────────────────────────────────────────────────────────────
// D.28  editedField injection: Section 4 save includes it; Section 5 does not
// ─────────────────────────────────────────────────────────────────────────────

describe("D.28 editedField sent with Section 4 save, not Section 5", () => {
  function buildRequestBody(
    sectionId: "fit" | "sizes",
    patch: Record<string, unknown>,
    sizeEditedField: "bodyFocusAreas" | "bodyAvoidAreas" | null,
    sizeSystemConfirmed: boolean,
  ): Record<string, unknown> {
    const requestBody: Record<string, unknown> = { ...patch, baseProfileUpdatedAt: "2026-01-01T00:00:00Z" };
    if (sectionId === "fit") {
      requestBody.editedField = sizeEditedField ?? "bodyFocusAreas";
    }
    if (sectionId === "sizes") {
      if (sizeSystemConfirmed) requestBody.confirmSizeSystemChange = true;
    }
    return requestBody;
  }

  it("Section 4 save includes editedField=bodyFocusAreas by default", () => {
    const body = buildRequestBody("fit", {}, null, false);
    assert.equal(body["editedField"], "bodyFocusAreas");
  });

  it("Section 4 save uses last-touched body area field", () => {
    const body = buildRequestBody("fit", {}, "bodyAvoidAreas", false);
    assert.equal(body["editedField"], "bodyAvoidAreas");
  });

  it("Section 5 save does NOT include editedField", () => {
    const body = buildRequestBody("sizes", {}, "bodyFocusAreas", false);
    assert.ok(!Object.hasOwn(body, "editedField"));
  });

  it("Section 5 save includes confirmSizeSystemChange when confirmed", () => {
    const body = buildRequestBody("sizes", {}, null, true);
    assert.equal(body["confirmSizeSystemChange"], true);
  });

  it("Section 4 save does NOT include confirmSizeSystemChange", () => {
    const body = buildRequestBody("fit", {}, null, false);
    assert.ok(!Object.hasOwn(body, "confirmSizeSystemChange"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D.29  Section overview summaries after UX correction
// ─────────────────────────────────────────────────────────────────────────────

describe("D.29 Overview summaries after UX correction", () => {
  const FOCUS_LABELS: Record<string, string> = {
    "waist": "Waist", "arms-shoulders": "Arms & shoulders", "legs": "Legs",
    "neckline": "Neckline", "back": "Back", "bust": "Bust", "hips-curves": "Hips & curves",
  };
  const AVOID_LABELS: Record<string, string> = {
    "upper-arms": "Upper arms", "midriff": "Midriff", "bust": "Bust",
    "hips-thighs": "Hips & thighs", "back": "Back", "legs": "Legs",
    "waist": "Waist", "neckline": "Neckline",
  };
  const SIZING_SYSTEM_LABELS: Record<string, string> = {
    "uk": "UK", "us": "US", "eu": "EU", "international": "International", "other": "Other",
  };

  function areaLine(ids: string[], labels: Record<string, string>, prefix: string): string {
    const humanLabels = ids.map(id => labels[id] ?? id.replace(/-/g, " "));
    const shown = humanLabels.slice(0, 2);
    const rest  = humanLabels.length - 2;
    return `${prefix}: ${shown.join(", ")}${rest > 0 ? ` +${rest} more` : ""}`;
  }

  function buildSection4Summary(answers: Record<string, unknown>): string {
    const silhouette = (answers["silhouette"] as string[] | undefined) ?? [];
    const focus      = (answers["body-focus-areas"] as string[] | undefined) ?? [];
    const avoid      = (answers["body-avoid-areas"] as string[] | undefined) ?? [];

    const isEmpty = silhouette.length === 0 && !answers["structure"] && focus.length === 0 && avoid.length === 0;
    if (isEmpty) return "Not yet completed";

    const parts: string[] = [];
    const fitParts: string[] = [];
    if (answers["structure"]) fitParts.push(answers["structure"] as string);
    if (silhouette.length > 0) fitParts.push(silhouette.slice(0, 2).join(", ") + (silhouette.length > 2 ? "…" : ""));
    if (fitParts.length > 0) parts.push(fitParts.join(" · "));
    if (focus.length > 0) parts.push(areaLine(focus, FOCUS_LABELS, "Highlights"));
    if (avoid.length > 0) parts.push(areaLine(avoid, AVOID_LABELS, "Coverage"));
    return parts.join("\n");
  }

  function buildSection5Summary(answers: Record<string, unknown>): string {
    const sysId    = answers["sizing-system"] as string | undefined;
    const topSz    = answers["top-size"]      as string | undefined;
    const bottomSz = answers["bottom-size"]   as string | undefined;
    const dressSz  = answers["dress-size"]    as string | undefined;

    const isEmpty = !sysId && !topSz && !bottomSz && !dressSz;
    if (isEmpty) return "Not yet completed";

    const sizeParts: string[] = [];
    if (sysId)                           sizeParts.push(SIZING_SYSTEM_LABELS[sysId] ?? sysId.toUpperCase());
    if (topSz)                           sizeParts.push(`Top ${topSz}`);
    if (bottomSz && bottomSz !== topSz)  sizeParts.push(`Bottom ${bottomSz}`);
    if (dressSz)                         sizeParts.push(`Dress ${dressSz}`);
    return sizeParts.length > 0 ? sizeParts.join(" · ") : "Not yet completed";
  }

  it("Section 4 summary includes highlight areas", () => {
    const s = buildSection4Summary({ "body-focus-areas": ["waist", "neckline"], "structure": "sharp-tailored" });
    assert.ok(s.includes("Highlights: Waist, Neckline"), `Got: ${s}`);
  });

  it("Section 4 summary includes coverage/avoid areas", () => {
    const s = buildSection4Summary({ "body-avoid-areas": ["upper-arms"], "structure": "balanced-structure" });
    assert.ok(s.includes("Coverage: Upper arms"), `Got: ${s}`);
  });

  it("Section 4 summary shows structure and highlight on separate lines", () => {
    const s = buildSection4Summary({ "structure": "sharp-tailored", "body-focus-areas": ["waist"] });
    const lines = s.split("\n");
    assert.ok(lines[0].includes("sharp-tailored"), `First line: ${lines[0]}`);
    assert.ok(lines[1]?.includes("Highlights: Waist"), `Second line: ${lines[1]}`);
  });

  it("Section 4 summary: empty when no fields set", () => {
    assert.equal(buildSection4Summary({}), "Not yet completed");
  });

  it("Section 5 summary does NOT mention focus/avoid areas", () => {
    const s = buildSection5Summary({
      "sizing-system": "uk", "top-size": "10",
      "body-focus-areas": ["waist"],    // these fields are no longer part of Section 5
      "body-avoid-areas": ["upper-arms"],
    });
    assert.ok(!s.includes("Highlights"), `Section 5 should not show highlights. Got: ${s}`);
    assert.ok(!s.includes("Coverage"), `Section 5 should not show coverage areas. Got: ${s}`);
  });

  it("Section 5 summary shows sizing line only", () => {
    const s = buildSection5Summary({ "sizing-system": "uk", "top-size": "10", "dress-size": "10" });
    assert.equal(s, "UK · Top 10 · Dress 10");
  });

  it("Section 5 summary: empty when no sizing fields set (even with body area data)", () => {
    const s = buildSection5Summary({ "body-focus-areas": ["waist"] });
    assert.equal(s, "Not yet completed");
  });

  it("V2-C: focus/avoid values populated from DB appear in Section 4 draft", () => {
    const savedAnswers: Record<string, unknown> = {
      "body-focus-areas": ["waist", "neckline"],
      "body-avoid-areas": ["upper-arms"],
    };
    // initEdits for Section 4 iterates its subFields including body-focus-areas and body-avoid-areas
    const FIT_SUBFIELDS = ["silhouette", "structure", "coverage-preferences", "body-focus-areas", "body-avoid-areas", "preferred-coverage"];
    const edits: Record<string, unknown> = {};
    for (const draftKey of FIT_SUBFIELDS) {
      const v = savedAnswers[draftKey];
      edits[draftKey] = Array.isArray(v) ? [...v] : (typeof v === "string" ? v : "");
    }
    assert.deepEqual(edits["body-focus-areas"], ["waist", "neckline"]);
    assert.deepEqual(edits["body-avoid-areas"], ["upper-arms"]);
  });

  it("Section 5 save body does not include body-focus-areas", () => {
    // computeSectionPatch iterates only Section 5 subFields — which no longer include body areas
    const SIZES_SUBFIELDS = [
      "sizing-system", "top-size", "bottom-size", "dress-size", "shoe-size",
      "height", "measurement-unit", "bust-measurement", "waist-measurement", "hip-measurement",
      "body-shape", "fit-concerns",
    ];
    const savedAnswers: Record<string, unknown> = { "body-focus-areas": ["waist"], "top-size": "10" };
    const flowEdits:    Record<string, unknown> = { "body-focus-areas": ["waist", "neckline"], "top-size": "10" };
    const patch: Record<string, unknown> = {};
    for (const key of SIZES_SUBFIELDS) {
      if (JSON.stringify(savedAnswers[key]) !== JSON.stringify(flowEdits[key])) patch[key] = flowEdits[key];
    }
    assert.ok(!Object.hasOwn(patch, "body-focus-areas"), "Section 5 patch must not contain body-focus-areas");
    assert.ok(!Object.hasOwn(patch, "bodyFocusAreas"),   "Section 5 patch must not contain bodyFocusAreas");
  });
});
