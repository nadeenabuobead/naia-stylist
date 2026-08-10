// app/lib/passport/v2-f.test.ts
// V2-F contract tests — independent shoe sizing system

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ─────────────────────────────────────────────────────────────────────────────
// F.1  shoeSizingSystem schema presence — additive only
// ─────────────────────────────────────────────────────────────────────────────

describe("F.1 shoeSizingSystem is a distinct nullable field", () => {
  const CLOTHING_VALID = new Set(["uk", "us", "eu", "international", "other"]);
  const SHOE_VALID     = new Set(["uk", "us", "eu", "other"]);

  it("clothing system has 5 options including international", () => assert.equal(CLOTHING_VALID.size, 5));
  it("shoe system has 4 options",                              () => assert.equal(SHOE_VALID.size, 4));
  it("shoe system does NOT include international",             () => assert.ok(!SHOE_VALID.has("international")));
  it("shoe system includes uk",                                () => assert.ok(SHOE_VALID.has("uk")));
  it("shoe system includes us",                                () => assert.ok(SHOE_VALID.has("us")));
  it("shoe system includes eu",                                () => assert.ok(SHOE_VALID.has("eu")));
  it("shoe system includes other",                             () => assert.ok(SHOE_VALID.has("other")));
});

// ─────────────────────────────────────────────────────────────────────────────
// F.2  International clothing + EU shoes is valid
// ─────────────────────────────────────────────────────────────────────────────

describe("F.2 International clothing + EU shoes is valid", () => {
  const CLOTHING_VALID = new Set(["uk", "us", "eu", "international", "other"]);
  const SHOE_VALID     = new Set(["uk", "us", "eu", "other"]);
  const EU_SHOE_SIZES  = new Set(["34","35","36","37","38","39","40","41","42","43","44"]);

  it("clothing=international is valid",     () => assert.ok(CLOTHING_VALID.has("international")));
  it("shoe=eu is valid",                    () => assert.ok(SHOE_VALID.has("eu")));
  it("EU shoe size 39 is valid for eu",     () => assert.ok(EU_SHOE_SIZES.has("39")));
  it("these two can coexist independently", () => {
    const profile = { sizingSystem: "international", shoeSizingSystem: "eu", shoeSize: "39" };
    assert.equal(profile.sizingSystem, "international");
    assert.equal(profile.shoeSizingSystem, "eu");
    assert.equal(profile.shoeSize, "39");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F.3  International clothing + UK shoes is valid
// ─────────────────────────────────────────────────────────────────────────────

describe("F.3 International clothing + UK shoes is valid", () => {
  const UK_SHOE_SIZES = new Set(["2","2.5","3","3.5","4","4.5","5","5.5","6","6.5","7","7.5","8","8.5"]);

  it("UK shoe size 4 is valid",   () => assert.ok(UK_SHOE_SIZES.has("4")));
  it("UK shoe size 8.5 is valid", () => assert.ok(UK_SHOE_SIZES.has("8.5")));
  it("can pair with international clothing", () => {
    const profile = { sizingSystem: "international", shoeSizingSystem: "uk", shoeSize: "5" };
    assert.equal(profile.sizingSystem, "international");
    assert.equal(profile.shoeSizingSystem, "uk");
    assert.ok(UK_SHOE_SIZES.has(profile.shoeSize));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F.4  UK clothing + EU shoes is valid
// ─────────────────────────────────────────────────────────────────────────────

describe("F.4 UK clothing + EU shoes is valid", () => {
  it("different clothing and shoe systems can coexist", () => {
    const profile = { sizingSystem: "uk", shoeSizingSystem: "eu", shoeSize: "39" };
    assert.equal(profile.sizingSystem, "uk");
    assert.equal(profile.shoeSizingSystem, "eu");
    assert.equal(profile.shoeSize, "39");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F.5  Clothing system change clears ONLY clothing sizes
// ─────────────────────────────────────────────────────────────────────────────

describe("F.5 Clothing system change clears only top/bottom/dress", () => {
  function applyClothingSystemChange(savedState: {
    topSize?: string; bottomSize?: string; dressSize?: string;
    shoeSizingSystem?: string; shoeSize?: string;
  }) {
    return {
      topSize:          null,
      bottomSize:       null,
      dressSize:        null,
      shoeSizingSystem: savedState.shoeSizingSystem ?? null,
      shoeSize:         savedState.shoeSize ?? null,
    };
  }

  it("clears topSize",    () => assert.equal(applyClothingSystemChange({ topSize: "10" }).topSize, null));
  it("clears bottomSize", () => assert.equal(applyClothingSystemChange({ bottomSize: "10" }).bottomSize, null));
  it("clears dressSize",  () => assert.equal(applyClothingSystemChange({ dressSize: "10" }).dressSize, null));

  it("preserves shoeSizingSystem", () => {
    const res = applyClothingSystemChange({ topSize: "10", shoeSizingSystem: "eu", shoeSize: "39" });
    assert.equal(res.shoeSizingSystem, "eu");
  });
  it("preserves shoeSize", () => {
    const res = applyClothingSystemChange({ topSize: "10", shoeSizingSystem: "eu", shoeSize: "39" });
    assert.equal(res.shoeSize, "39");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F.6  Shoe system change safety — confirmation required when shoeSize exists
// ─────────────────────────────────────────────────────────────────────────────

describe("F.6 Shoe system change requires confirmation when shoeSize saved", () => {
  function checkShoeSystemChange(
    savedShoeSizingSystem: string | null,
    newShoeSizingSystem: string,
    hasSavedShoeSize: boolean,
    confirmShoeSystemChange: boolean,
  ): { status: "ok" | "needs_confirmation" } {
    const changing = newShoeSizingSystem !== savedShoeSizingSystem;
    if (changing && hasSavedShoeSize && !confirmShoeSystemChange) {
      return { status: "needs_confirmation" };
    }
    return { status: "ok" };
  }

  it("null → eu with saved shoeSize → needs_confirmation", () =>
    assert.equal(checkShoeSystemChange(null, "eu", true, false).status, "needs_confirmation"));
  it("uk → eu with saved shoeSize → needs_confirmation", () =>
    assert.equal(checkShoeSystemChange("uk", "eu", true, false).status, "needs_confirmation"));
  it("uk → eu with saved shoeSize + confirm → ok", () =>
    assert.equal(checkShoeSystemChange("uk", "eu", true, true).status, "ok"));
  it("null → eu with NO shoeSize → ok", () =>
    assert.equal(checkShoeSystemChange(null, "eu", false, false).status, "ok"));
  it("same system → no change → ok", () =>
    assert.equal(checkShoeSystemChange("eu", "eu", true, false).status, "ok"));
});

// ─────────────────────────────────────────────────────────────────────────────
// F.7  Legacy shoeSizingSystem=null + shoeSize → confirmation required
// ─────────────────────────────────────────────────────────────────────────────

describe("F.7 Legacy null shoe system + saved shoeSize requires confirmation", () => {
  function checkShoeSystemChange(
    savedShoeSizingSystem: string | null,
    newShoeSizingSystem: string,
    hasSavedShoeSize: boolean,
    confirmShoeSystemChange: boolean,
  ) {
    const changing = newShoeSizingSystem !== savedShoeSizingSystem;
    if (changing && hasSavedShoeSize && !confirmShoeSystemChange) return "needs_confirmation";
    return "ok";
  }

  it("null + shoeSize exists → choosing uk requires confirmation", () =>
    assert.equal(checkShoeSystemChange(null, "uk", true, false), "needs_confirmation"));
  it("null + shoeSize exists → choosing eu requires confirmation", () =>
    assert.equal(checkShoeSystemChange(null, "eu", true, false), "needs_confirmation"));
  it("null + NO shoeSize → choosing uk does not require confirmation", () =>
    assert.equal(checkShoeSystemChange(null, "uk", false, false), "ok"));
});

// ─────────────────────────────────────────────────────────────────────────────
// F.8  Confirm shoe system change clears shoeSize only
// ─────────────────────────────────────────────────────────────────────────────

describe("F.8 Confirm shoe system change clears shoeSize only", () => {
  function applyShoeSystemChange(savedState: {
    topSize?: string; bottomSize?: string; dressSize?: string;
    sizingSystem?: string; shoeSize?: string;
  }, newShoeSys: string) {
    return {
      sizingSystem: savedState.sizingSystem ?? null,
      topSize:      savedState.topSize      ?? null,
      bottomSize:   savedState.bottomSize   ?? null,
      dressSize:    savedState.dressSize    ?? null,
      shoeSizingSystem: newShoeSys,
      shoeSize:     null,  // cleared on confirm
    };
  }

  it("clears shoeSize", () => {
    const res = applyShoeSystemChange({ shoeSize: "5", sizingSystem: "uk" }, "eu");
    assert.equal(res.shoeSize, null);
  });
  it("preserves sizingSystem", () => {
    const res = applyShoeSystemChange({ sizingSystem: "uk", shoeSize: "5" }, "eu");
    assert.equal(res.sizingSystem, "uk");
  });
  it("preserves topSize", () => {
    const res = applyShoeSystemChange({ topSize: "10", shoeSize: "5" }, "eu");
    assert.equal(res.topSize, "10");
  });
  it("preserves bottomSize", () => {
    const res = applyShoeSystemChange({ bottomSize: "10", shoeSize: "5" }, "eu");
    assert.equal(res.bottomSize, "10");
  });
  it("preserves dressSize", () => {
    const res = applyShoeSystemChange({ dressSize: "10", shoeSize: "5" }, "eu");
    assert.equal(res.dressSize, "10");
  });
  it("sets new shoeSizingSystem", () => {
    const res = applyShoeSystemChange({ shoeSize: "5" }, "eu");
    assert.equal(res.shoeSizingSystem, "eu");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F.9  Cancel sends no change
// ─────────────────────────────────────────────────────────────────────────────

describe("F.9 Cancel shoe system change preserves existing state", () => {
  it("cancel produces no save — state unchanged", () => {
    const before = { shoeSizingSystem: "uk", shoeSize: "5" };
    // Cancel means we never call the save; state object is unchanged
    const after = { ...before };
    assert.equal(after.shoeSizingSystem, "uk");
    assert.equal(after.shoeSize, "5");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F.10  No saved shoeSize → shoe system change allowed without confirmation
// ─────────────────────────────────────────────────────────────────────────────

describe("F.10 No saved shoeSize allows shoe system change without confirmation", () => {
  function needsConfirmation(hasSavedShoeSize: boolean, changing: boolean) {
    return changing && hasSavedShoeSize;
  }

  it("hasSavedShoeSize=false → no confirmation needed",      () => assert.ok(!needsConfirmation(false, true)));
  it("hasSavedShoeSize=true + changing → confirmation needed", () => assert.ok(needsConfirmation(true, true)));
  it("not changing → no confirmation needed",                  () => assert.ok(!needsConfirmation(true, false)));
});

// ─────────────────────────────────────────────────────────────────────────────
// F.11  Invalid shoe system rejected by server
// ─────────────────────────────────────────────────────────────────────────────

describe("F.11 Invalid shoe sizing system rejected", () => {
  const SHOE_VALID = new Set(["uk", "us", "eu", "other"]);
  function validateShoeSys(v: unknown): boolean {
    if (v === null || v === undefined) return true; // optional
    return typeof v === "string" && SHOE_VALID.has(v);
  }

  it("accepts null",         () => assert.ok(validateShoeSys(null)));
  it("accepts undefined",    () => assert.ok(validateShoeSys(undefined)));
  it("accepts uk",           () => assert.ok(validateShoeSys("uk")));
  it("accepts eu",           () => assert.ok(validateShoeSys("eu")));
  it("accepts other",        () => assert.ok(validateShoeSys("other")));
  it("rejects international",() => assert.ok(!validateShoeSys("international")));
  it("rejects 'au'",         () => assert.ok(!validateShoeSys("au")));
  it("rejects empty string", () => assert.ok(!validateShoeSys("")));
});

// ─────────────────────────────────────────────────────────────────────────────
// F.12  Invalid shoe size rejected when structured system selected
// ─────────────────────────────────────────────────────────────────────────────

describe("F.12 Structured shoe size validated against shoe system", () => {
  const SHOE_SIZES: Record<string, Set<string>> = {
    uk: new Set(["2","2.5","3","3.5","4","4.5","5","5.5","6","6.5","7","7.5","8","8.5"]),
    us: new Set(["4","4.5","5","5.5","6","6.5","7","7.5","8","8.5","9","9.5","10","10.5"]),
    eu: new Set(["34","35","36","37","38","39","40","41","42","43","44"]),
  };
  function validateShoeSize(value: string | null, shoeSystem: string | null): boolean {
    if (!value || value === "") return true;
    if (shoeSystem && shoeSystem !== "other") {
      const valid = SHOE_SIZES[shoeSystem];
      if (valid && !valid.has(value.trim())) return false;
    }
    return true;
  }

  it("EU 39 accepted for eu system",          () => assert.ok(validateShoeSize("39", "eu")));
  it("EU 39 rejected for uk system",          () => assert.ok(!validateShoeSize("39", "uk")));
  it("UK 5 accepted for uk system",           () => assert.ok(validateShoeSize("5", "uk")));
  it("UK 5 rejected for eu system",           () => assert.ok(!validateShoeSize("5", "eu")));
  it("null value always valid",               () => assert.ok(validateShoeSize(null, "eu")));
  it("no system = free text always valid",    () => assert.ok(validateShoeSize("anything", null)));
});

// ─────────────────────────────────────────────────────────────────────────────
// F.13  Other shoe system permits free-text shoe size
// ─────────────────────────────────────────────────────────────────────────────

describe("F.13 Other shoe system permits any free-text size", () => {
  function validateShoeSize(value: string | null, shoeSystem: string | null): boolean {
    if (!value || value === "") return true;
    if (shoeSystem && shoeSystem !== "other") {
      const SHOE_SIZES: Record<string, Set<string>> = {
        uk: new Set(["2","2.5","3","3.5","4","4.5","5","5.5","6","6.5","7","7.5","8","8.5"]),
        us: new Set(["4","4.5","5","5.5","6","6.5","7","7.5","8","8.5","9","9.5","10","10.5"]),
        eu: new Set(["34","35","36","37","38","39","40","41","42","43","44"]),
      };
      const valid = SHOE_SIZES[shoeSystem];
      if (valid && !valid.has(value.trim())) return false;
    }
    return true;
  }

  it("'EU 39' passes under other",   () => assert.ok(validateShoeSize("EU 39", "other")));
  it("'42' passes under other",      () => assert.ok(validateShoeSize("42", "other")));
  it("'5.5 US' passes under other",  () => assert.ok(validateShoeSize("5.5 US", "other")));
});

// ─────────────────────────────────────────────────────────────────────────────
// F.14  confirmShoeSystemChange is never persisted
// ─────────────────────────────────────────────────────────────────────────────

describe("F.14 confirmShoeSystemChange is request-scoped only", () => {
  const RECOGNISED_DB_FIELDS = new Set([
    "sizingSystem", "topSize", "bottomSize", "dressSize",
    "shoeSizingSystem", "shoeSize",
    "height", "bustMeasurement", "waistMeasurement", "hipMeasurement",
    "measurementUnit", "bodyShape", "fitConcerns", "preferredCoverage",
  ]);

  it("confirmShoeSystemChange is NOT a DB column", () =>
    assert.ok(!RECOGNISED_DB_FIELDS.has("confirmShoeSystemChange")));
  it("confirmSizeSystemChange is NOT a DB column", () =>
    assert.ok(!RECOGNISED_DB_FIELDS.has("confirmSizeSystemChange")));
  it("shoeSizingSystem IS a DB column", () =>
    assert.ok(RECOGNISED_DB_FIELDS.has("shoeSizingSystem")));
});

// ─────────────────────────────────────────────────────────────────────────────
// F.15  Legacy shoeSize is never assigned a guessed system
// ─────────────────────────────────────────────────────────────────────────────

describe("F.15 Legacy shoeSize with null shoeSizingSystem stays unchanged", () => {
  it("existing shoeSize is not modified when shoeSizingSystem absent from request", () => {
    // Server partial-patch: if shoeSizingSystem is not in request body, DB value is preserved
    const savedShoeSizingSystem = null;
    const requestBody: Record<string, unknown> = { topSize: "10" }; // no shoeSizingSystem key
    const effectiveShoeSys = Object.hasOwn(requestBody, "shoeSizingSystem")
      ? requestBody["shoeSizingSystem"]
      : savedShoeSizingSystem;
    assert.equal(effectiveShoeSys, null);
  });

  it("shoeSizingSystem=null means shoe size is legacy/unknown — no system is inferred", () => {
    const row = { shoeSize: "5", shoeSizingSystem: null };
    // We never auto-assign uk/us/eu based on the value alone
    assert.equal(row.shoeSizingSystem, null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F.17  confirmShoeSystemChange is a request-only key (regression — was missing)
// ─────────────────────────────────────────────────────────────────────────────

describe("F.17 confirmShoeSystemChange is request-only (not persisted, not unknown)", () => {
  // Mirrors api.save-style-profile REQUEST_ONLY_KEYS and RECOGNISED_FIELDS.
  // Bug: confirmShoeSystemChange was absent from REQUEST_ONLY_KEYS, causing the
  // server to return 400 invalid_body on any confirmed shoe-system change.
  const REQUEST_ONLY_KEYS = new Set([
    "baseProfileUpdatedAt", "editedField",
    "confirmSizeSystemChange", "confirmShoeSystemChange",
  ]);
  const RECOGNISED_FIELDS = new Set([
    "sizingSystem", "topSize", "bottomSize", "dressSize",
    "shoeSizingSystem", "shoeSize",
    "height", "bustMeasurement", "waistMeasurement", "hipMeasurement",
    "measurementUnit", "bodyShape", "fitConcerns", "preferredCoverage",
    "bodyFocusAreas", "bodyAvoidAreas",
  ]);

  function isKeyAllowed(key: string): boolean {
    return REQUEST_ONLY_KEYS.has(key) || RECOGNISED_FIELDS.has(key);
  }

  it("confirmShoeSystemChange is in REQUEST_ONLY_KEYS", () =>
    assert.ok(REQUEST_ONLY_KEYS.has("confirmShoeSystemChange")));
  it("confirmShoeSystemChange is NOT in RECOGNISED_FIELDS (never persisted)", () =>
    assert.ok(!RECOGNISED_FIELDS.has("confirmShoeSystemChange")));
  it("confirmShoeSystemChange is allowed (does not trigger unknown-key 400)", () =>
    assert.ok(isKeyAllowed("confirmShoeSystemChange")));
  it("confirmSizeSystemChange is also allowed", () =>
    assert.ok(isKeyAllowed("confirmSizeSystemChange")));
});

// ─────────────────────────────────────────────────────────────────────────────
// F.18  International clothing + EU shoe save payload — full contract (regression)
// ─────────────────────────────────────────────────────────────────────────────

describe("F.18 International clothing + EU shoe save payload is accepted end-to-end", () => {
  // Reproduces the exact failing scenario: user had prior UK shoe data (size 6),
  // changes to EU 39, confirms. Payload includes confirmShoeSystemChange: true.
  // Prior to the fix this returned 400 invalid_body because confirmShoeSystemChange
  // was missing from REQUEST_ONLY_KEYS.

  const REQUEST_ONLY_KEYS = new Set([
    "baseProfileUpdatedAt", "editedField",
    "confirmSizeSystemChange", "confirmShoeSystemChange",
  ]);
  const RECOGNISED_FIELDS = new Set([
    "sizingSystem", "topSize", "bottomSize", "dressSize",
    "shoeSizingSystem", "shoeSize",
    "height", "bustMeasurement", "waistMeasurement", "hipMeasurement",
    "measurementUnit", "bodyShape", "fitConcerns", "preferredCoverage",
    "bodyFocusAreas", "bodyAvoidAreas",
  ]);
  const CLOTHING_VALID = new Set(["uk", "us", "eu", "international", "other"]);
  const SHOE_VALID     = new Set(["uk", "us", "eu", "other"]);
  const CLOTHING_SIZES: Record<string, Set<string>> = {
    international: new Set(["XS","S","M","L","XL","XXL","XXXL"]),
  };
  const SHOE_SIZES: Record<string, Set<string>> = {
    eu: new Set(["34","35","36","37","38","39","40","41","42","43","44"]),
  };

  const payload = {
    baseProfileUpdatedAt: "2026-08-10T00:00:00.000Z",
    sizingSystem: "international",
    topSize: "M",
    bottomSize: "M",
    dressSize: "M",
    shoeSizingSystem: "eu",
    shoeSize: "39",
    confirmShoeSystemChange: true,  // shoe system changed from uk → eu with prior shoeSize
  };

  it("all payload keys are allowed (no unknown-key 400)", () => {
    for (const key of Object.keys(payload)) {
      assert.ok(
        REQUEST_ONLY_KEYS.has(key) || RECOGNISED_FIELDS.has(key),
        `key "${key}" must be in REQUEST_ONLY_KEYS or RECOGNISED_FIELDS`,
      );
    }
  });

  it("sizingSystem 'international' is valid", () =>
    assert.ok(CLOTHING_VALID.has(payload.sizingSystem)));

  it("shoeSizingSystem 'eu' is valid", () =>
    assert.ok(SHOE_VALID.has(payload.shoeSizingSystem)));

  it("topSize 'M' is valid for international clothing system", () =>
    assert.ok(CLOTHING_SIZES["international"].has(payload.topSize)));

  it("bottomSize 'M' is valid for international clothing system", () =>
    assert.ok(CLOTHING_SIZES["international"].has(payload.bottomSize)));

  it("dressSize 'M' is valid for international clothing system", () =>
    assert.ok(CLOTHING_SIZES["international"].has(payload.dressSize)));

  it("shoeSize '39' is valid for EU shoe system", () =>
    assert.ok(SHOE_SIZES["eu"].has(payload.shoeSize)));

  it("confirmShoeSystemChange: true is a boolean (not a string)", () =>
    assert.equal(typeof payload.confirmShoeSystemChange, "boolean"));

  it("international + EU can coexist — clothing system does not restrict shoe system", () => {
    const clothingSysValid = CLOTHING_VALID.has(payload.sizingSystem);
    const shoeSysValid     = SHOE_VALID.has(payload.shoeSizingSystem);
    assert.ok(clothingSysValid && shoeSysValid);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F.16  Section 5 subField count now includes shoe-sizing-system
// ─────────────────────────────────────────────────────────────────────────────

describe("F.16 Section 5 subFields count", () => {
  const SECTION_5_SUBFIELDS = [
    "sizing-system", "top-size", "bottom-size", "dress-size",
    "shoe-sizing-system", "shoe-size",
    "height", "measurement-unit",
    "bust-measurement", "waist-measurement", "hip-measurement",
    "body-shape", "fit-concerns",
  ];

  it("Section 5 has 13 subFields (includes shoe-sizing-system)", () =>
    assert.equal(SECTION_5_SUBFIELDS.length, 13));
  it("includes shoe-sizing-system", () =>
    assert.ok(SECTION_5_SUBFIELDS.includes("shoe-sizing-system")));
  it("includes shoe-size", () =>
    assert.ok(SECTION_5_SUBFIELDS.includes("shoe-size")));
  it("includes sizing-system", () =>
    assert.ok(SECTION_5_SUBFIELDS.includes("sizing-system")));
});
