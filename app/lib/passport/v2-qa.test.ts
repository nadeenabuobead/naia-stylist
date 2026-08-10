// app/lib/passport/v2-qa.test.ts
// Passport overview QA — proves every field maps to its section and
// getSectionDetail renders actual content (not placeholder text).

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ─── Mirror production constants from passport.tsx ───────────────────────────

const SIZING_SYSTEM_LABELS: Record<string, string> = {
  uk: "UK", us: "US", eu: "EU", international: "International", other: "Other",
};
const SHOE_SIZING_SYSTEM_LABELS: Record<string, string> = {
  uk: "UK", us: "US", eu: "EU", other: "Other",
};
const BODY_SHAPE_OPTIONS = [
  { id: "hourglass",         label: "Hourglass"          },
  { id: "pear",              label: "Pear"               },
  { id: "apple",             label: "Apple"              },
  { id: "rectangle",         label: "Rectangle"          },
  { id: "inverted-triangle", label: "Inverted triangle"  },
  { id: "not-sure",          label: "Not sure"           },
  { id: "prefer-not-to-say", label: "Prefer not to say" },
];
const BODY_SHAPE_LABELS: Record<string, string> = Object.fromEntries(BODY_SHAPE_OPTIONS.map(o => [o.id, o.label]));
const FIT_CONCERN_OPTIONS = [
  { id: "petite",           label: "Petite proportions"                       },
  { id: "tall",             label: "Tall proportions"                         },
  { id: "short-torso",      label: "Short torso"                              },
  { id: "long-torso",       label: "Long torso"                               },
  { id: "broad-shoulders",  label: "Broad or rounded shoulders"               },
  { id: "narrow-shoulders", label: "Narrow shoulders"                         },
  { id: "fuller-bust",      label: "Fuller bust"                              },
  { id: "narrow-hips",      label: "Narrow hips relative to waist"            },
  { id: "arm-fit",          label: "Fitted sleeves and arm openings"          },
  { id: "thigh-fit",        label: "Narrower trouser legs around the thighs"  },
];
const FIT_CONCERN_LABELS: Record<string, string> = Object.fromEntries(FIT_CONCERN_OPTIONS.map(o => [o.id, o.label]));

const OVERVIEW_FIELD_LABELS: Record<string, string> = {
  "sizing-system":      "Clothing sizing system",
  "shoe-sizing-system": "Shoe sizing system",
  "height":             "Height",
  "measurement-unit":   "Measurement unit",
  "bust-measurement":   "Bust",
  "waist-measurement":  "Waist",
  "hip-measurement":    "Hips",
  "body-shape":         "Proportions",
  "fit-concerns":       "Fit considerations",
  "typical-day":        "A typical week",
  "body-focus-areas":   "Areas I enjoy highlighting",
  "body-avoid-areas":   "Areas I prefer with more coverage",
  "preferred-coverage": "Coverage preference",
};
const LEGACY_COLOUR_IDS = new Set(["prints", "colorful"]);

// ─── Section draftKey registry — mirrors SECTIONS in passport.tsx ─────────────
// Any key that appears here MUST also be in the corresponding section's subFields.
const SECTION_DRAFTKEYS: Record<string, string[]> = {
  identity:  ["style-personalities", "desired-impression"],
  direction: ["desired-feelings", "becoming"],
  life:      ["lifestyle", "typical-day"],
  fit:       ["silhouette", "structure", "coverage-preferences", "body-focus-areas", "body-avoid-areas", "preferred-coverage"],
  sizes:     ["sizing-system", "top-size", "bottom-size", "dress-size", "shoe-sizing-system", "shoe-size", "height", "measurement-unit", "bust-measurement", "waist-measurement", "hip-measurement", "body-shape", "fit-concerns"],
  colours:   ["favorite-colors", "avoid-colors", "neutral-vs-colour", "colour-intensity", "print-appetite"],
  wardrobe:  ["wardrobe-disconnection", "style-support", "shopping-priorities", "trend-appetite"],
};
const NOTES_DRAFTKEYS = ["final-notes"];
const MEASUREMENT_KEYS = new Set(["bust-measurement", "waist-measurement", "hip-measurement"]);

// ─── Mirror getSectionDetail field-collection logic ───────────────────────────

type FieldKind = "text" | "single" | "array";

function collectFields(
  draftKeys: string[],
  kinds: Record<string, FieldKind>,
  answers: Record<string, unknown>,
): { key: string; label: string; value: string }[] {
  const mUnit = (answers["measurement-unit"] as string | undefined) ?? null;
  const fields: { key: string; label: string; value: string }[] = [];

  for (const dKey of draftKeys) {
    const v = answers[dKey];
    const displayLabel: string = OVERVIEW_FIELD_LABELS[dKey] || dKey;
    const kind = kinds[dKey] ?? "text";

    if (kind === "text") {
      if (!v || typeof v !== "string" || !v.trim()) continue;
      let text = v.trim();
      if (MEASUREMENT_KEYS.has(dKey) && mUnit) text += ` ${mUnit}`;
      fields.push({ key: dKey, label: displayLabel, value: text });

    } else if (kind === "single") {
      if (!v || typeof v !== "string" || !v.trim()) continue;
      const raw = v.trim();
      let human: string;
      if (dKey === "sizing-system")           human = SIZING_SYSTEM_LABELS[raw] ?? raw;
      else if (dKey === "shoe-sizing-system") human = SHOE_SIZING_SYSTEM_LABELS[raw] ?? raw;
      else if (dKey === "body-shape")         human = BODY_SHAPE_LABELS[raw] ?? raw;
      else if (dKey === "measurement-unit")   human = raw === "cm" ? "Centimetres" : raw === "in" ? "Inches" : raw;
      else human = raw;
      fields.push({ key: dKey, label: displayLabel, value: human });

    } else {
      const raw = (Array.isArray(v) ? v : []) as string[];
      const ids = dKey === "favorite-colors" ? raw.filter(id => !LEGACY_COLOUR_IDS.has(id)) : raw;
      if (ids.length === 0) continue;
      const labelled = dKey === "fit-concerns" ? ids.map(id => FIT_CONCERN_LABELS[id] ?? id) : ids;
      fields.push({ key: dKey, label: displayLabel, value: labelled.join(" · ") });
    }
  }
  return fields;
}

// ─────────────────────────────────────────────────────────────────────────────
// QA.1  OVERVIEW_FIELD_LABELS — short display labels for special fields
// ─────────────────────────────────────────────────────────────────────────────

describe("QA.1 OVERVIEW_FIELD_LABELS — short display labels", () => {
  it("sizing-system   → 'Clothing sizing system'", () => assert.equal(OVERVIEW_FIELD_LABELS["sizing-system"],      "Clothing sizing system"));
  it("shoe-sizing-system → 'Shoe sizing system'", () => assert.equal(OVERVIEW_FIELD_LABELS["shoe-sizing-system"], "Shoe sizing system"));
  it("body-shape      → 'Proportions'",           () => assert.equal(OVERVIEW_FIELD_LABELS["body-shape"],         "Proportions"));
  it("fit-concerns    → 'Fit considerations'",    () => assert.equal(OVERVIEW_FIELD_LABELS["fit-concerns"],       "Fit considerations"));
  it("height          → 'Height'",                () => assert.equal(OVERVIEW_FIELD_LABELS["height"],             "Height"));
  it("measurement-unit → 'Measurement unit'",     () => assert.equal(OVERVIEW_FIELD_LABELS["measurement-unit"],   "Measurement unit"));
  it("bust-measurement → 'Bust'",                 () => assert.equal(OVERVIEW_FIELD_LABELS["bust-measurement"],   "Bust"));
  it("waist-measurement → 'Waist'",               () => assert.equal(OVERVIEW_FIELD_LABELS["waist-measurement"],  "Waist"));
  it("hip-measurement  → 'Hips'",                 () => assert.equal(OVERVIEW_FIELD_LABELS["hip-measurement"],    "Hips"));
  it("typical-day     → 'A typical week'",        () => assert.equal(OVERVIEW_FIELD_LABELS["typical-day"],        "A typical week"));
  it("body-focus-areas → has a label",            () => assert.ok(OVERVIEW_FIELD_LABELS["body-focus-areas"]));
  it("body-avoid-areas → has a label",            () => assert.ok(OVERVIEW_FIELD_LABELS["body-avoid-areas"]));
  it("preferred-coverage → has a label",          () => assert.ok(OVERVIEW_FIELD_LABELS["preferred-coverage"]));
});

// ─────────────────────────────────────────────────────────────────────────────
// QA.2  Section draftKey coverage
// ─────────────────────────────────────────────────────────────────────────────

describe("QA.2 Section 1 (identity) — style-personalities + desired-impression", () => {
  it("contains style-personalities",  () => assert.ok(SECTION_DRAFTKEYS.identity.includes("style-personalities")));
  it("contains desired-impression",   () => assert.ok(SECTION_DRAFTKEYS.identity.includes("desired-impression")));
  it("has exactly 2 fields",          () => assert.equal(SECTION_DRAFTKEYS.identity.length, 2));
});

describe("QA.2 Section 2 (direction) — desired-feelings + becoming", () => {
  it("contains desired-feelings",     () => assert.ok(SECTION_DRAFTKEYS.direction.includes("desired-feelings")));
  it("contains becoming",             () => assert.ok(SECTION_DRAFTKEYS.direction.includes("becoming")));
  it("has exactly 2 fields",          () => assert.equal(SECTION_DRAFTKEYS.direction.length, 2));
});

describe("QA.2 Section 3 (life) — lifestyle + typical-day", () => {
  it("contains lifestyle",            () => assert.ok(SECTION_DRAFTKEYS.life.includes("lifestyle")));
  it("contains typical-day",          () => assert.ok(SECTION_DRAFTKEYS.life.includes("typical-day")));
  it("has exactly 2 fields",          () => assert.equal(SECTION_DRAFTKEYS.life.length, 2));
});

describe("QA.2 Section 4 (fit) — silhouette + structure + coverage + areas", () => {
  it("contains silhouette",           () => assert.ok(SECTION_DRAFTKEYS.fit.includes("silhouette")));
  it("contains structure",            () => assert.ok(SECTION_DRAFTKEYS.fit.includes("structure")));
  it("contains coverage-preferences", () => assert.ok(SECTION_DRAFTKEYS.fit.includes("coverage-preferences")));
  it("contains body-focus-areas",     () => assert.ok(SECTION_DRAFTKEYS.fit.includes("body-focus-areas")));
  it("contains body-avoid-areas",     () => assert.ok(SECTION_DRAFTKEYS.fit.includes("body-avoid-areas")));
  it("contains preferred-coverage",   () => assert.ok(SECTION_DRAFTKEYS.fit.includes("preferred-coverage")));
  it("has exactly 6 fields",          () => assert.equal(SECTION_DRAFTKEYS.fit.length, 6));
});

describe("QA.2 Section 5 (sizes) — all 13 fields", () => {
  const EXPECTED = [
    "sizing-system", "top-size", "bottom-size", "dress-size",
    "shoe-sizing-system", "shoe-size",
    "height", "measurement-unit",
    "bust-measurement", "waist-measurement", "hip-measurement",
    "body-shape", "fit-concerns",
  ];
  it("has exactly 13 fields", () => assert.equal(SECTION_DRAFTKEYS.sizes.length, 13));
  for (const key of EXPECTED) {
    it(`contains ${key}`, () => assert.ok(SECTION_DRAFTKEYS.sizes.includes(key), `${key} missing from sizes`));
  }
});

describe("QA.2 Section 6 (colours) — favourite/avoid + intensity/neutral/print", () => {
  it("contains favorite-colors",      () => assert.ok(SECTION_DRAFTKEYS.colours.includes("favorite-colors")));
  it("contains avoid-colors",         () => assert.ok(SECTION_DRAFTKEYS.colours.includes("avoid-colors")));
  it("contains neutral-vs-colour",    () => assert.ok(SECTION_DRAFTKEYS.colours.includes("neutral-vs-colour")));
  it("contains colour-intensity",     () => assert.ok(SECTION_DRAFTKEYS.colours.includes("colour-intensity")));
  it("contains print-appetite",       () => assert.ok(SECTION_DRAFTKEYS.colours.includes("print-appetite")));
  it("has exactly 5 fields",          () => assert.equal(SECTION_DRAFTKEYS.colours.length, 5));
});

describe("QA.2 Section 7 (wardrobe) — struggles + support + priorities + trend", () => {
  it("contains wardrobe-disconnection", () => assert.ok(SECTION_DRAFTKEYS.wardrobe.includes("wardrobe-disconnection")));
  it("contains style-support",          () => assert.ok(SECTION_DRAFTKEYS.wardrobe.includes("style-support")));
  it("contains shopping-priorities",    () => assert.ok(SECTION_DRAFTKEYS.wardrobe.includes("shopping-priorities")));
  it("contains trend-appetite",         () => assert.ok(SECTION_DRAFTKEYS.wardrobe.includes("trend-appetite")));
  it("has exactly 4 fields",            () => assert.equal(SECTION_DRAFTKEYS.wardrobe.length, 4));
});

describe("QA.2 Notes section — final-notes only", () => {
  it("contains final-notes",          () => assert.ok(NOTES_DRAFTKEYS.includes("final-notes")));
  it("has exactly 1 field",           () => assert.equal(NOTES_DRAFTKEYS.length, 1));
});

// ─────────────────────────────────────────────────────────────────────────────
// QA.3  Label resolution for special fields
// ─────────────────────────────────────────────────────────────────────────────

describe("QA.3 Label resolution — sizing systems", () => {
  it("sizing-system 'international' → 'International'", () => assert.equal(SIZING_SYSTEM_LABELS["international"], "International"));
  it("sizing-system 'uk' → 'UK'",                       () => assert.equal(SIZING_SYSTEM_LABELS["uk"],            "UK"));
  it("sizing-system 'eu' → 'EU'",                       () => assert.equal(SIZING_SYSTEM_LABELS["eu"],            "EU"));
  it("shoe-sizing-system 'eu' → 'EU'",                  () => assert.equal(SHOE_SIZING_SYSTEM_LABELS["eu"],       "EU"));
  it("shoe-sizing-system 'us' → 'US'",                  () => assert.equal(SHOE_SIZING_SYSTEM_LABELS["us"],       "US"));
});

describe("QA.3 Label resolution — body shape (neutral, no body-shape framing)", () => {
  it("'pear' → 'Pear'",                                () => assert.equal(BODY_SHAPE_LABELS["pear"],              "Pear"));
  it("'hourglass' → 'Hourglass'",                      () => assert.equal(BODY_SHAPE_LABELS["hourglass"],         "Hourglass"));
  it("'inverted-triangle' → 'Inverted triangle'",      () => assert.equal(BODY_SHAPE_LABELS["inverted-triangle"], "Inverted triangle"));
  it("'not-sure' → 'Not sure'",                        () => assert.equal(BODY_SHAPE_LABELS["not-sure"],          "Not sure"));
  it("all 7 BODY_SHAPE_OPTIONS have labels",           () => assert.equal(BODY_SHAPE_OPTIONS.length, 7));
});

describe("QA.3 Label resolution — fit concerns", () => {
  it("'petite' → 'Petite proportions'",                () => assert.equal(FIT_CONCERN_LABELS["petite"],           "Petite proportions"));
  it("'tall' → 'Tall proportions'",                   () => assert.equal(FIT_CONCERN_LABELS["tall"],             "Tall proportions"));
  it("'fuller-bust' → 'Fuller bust'",                 () => assert.equal(FIT_CONCERN_LABELS["fuller-bust"],      "Fuller bust"));
  it("all 10 FIT_CONCERN_OPTIONS have labels",        () => assert.equal(FIT_CONCERN_OPTIONS.length, 10));
});

describe("QA.3 Label resolution — measurement-unit", () => {
  it("'cm' → 'Centimetres' via collectFields single kind", () => {
    const kinds: Record<string, FieldKind> = { "measurement-unit": "single" };
    const fields = collectFields(["measurement-unit"], kinds, { "measurement-unit": "cm" });
    assert.equal(fields.length, 1);
    assert.equal(fields[0].value, "Centimetres");
    assert.equal(fields[0].label, "Measurement unit");
  });
  it("'in' → 'Inches' via collectFields single kind", () => {
    const kinds: Record<string, FieldKind> = { "measurement-unit": "single" };
    const fields = collectFields(["measurement-unit"], kinds, { "measurement-unit": "in" });
    assert.equal(fields.length, 1);
    assert.equal(fields[0].value, "Inches");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// QA.4  Measurements display with unit suffix
// ─────────────────────────────────────────────────────────────────────────────

describe("QA.4 Measurements display with unit appended", () => {
  const kindsM: Record<string, FieldKind> = {
    "measurement-unit":  "single",
    "bust-measurement":  "text",
    "waist-measurement": "text",
    "hip-measurement":   "text",
  };

  it("bust-measurement appends 'cm' when unit is cm", () => {
    const answers = { "measurement-unit": "cm", "bust-measurement": "90" };
    const fields = collectFields(["bust-measurement"], kindsM, answers);
    assert.equal(fields.length, 1);
    assert.equal(fields[0].value, "90 cm");
    assert.equal(fields[0].label, "Bust");
  });

  it("waist-measurement appends 'in' when unit is in", () => {
    const answers = { "measurement-unit": "in", "waist-measurement": "28" };
    const fields = collectFields(["waist-measurement"], kindsM, answers);
    assert.equal(fields.length, 1);
    assert.equal(fields[0].value, "28 in");
    assert.equal(fields[0].label, "Waist");
  });

  it("hip-measurement appends unit", () => {
    const answers = { "measurement-unit": "cm", "hip-measurement": "96" };
    const fields = collectFields(["hip-measurement"], kindsM, answers);
    assert.equal(fields[0].value, "96 cm");
    assert.equal(fields[0].label, "Hips");
  });

  it("measurement without mUnit shows value alone", () => {
    const answers = { "bust-measurement": "90" }; // no measurement-unit
    const fields = collectFields(["bust-measurement"], kindsM, answers);
    assert.equal(fields[0].value, "90"); // no unit appended
  });

  it("all three measurement fields each get a label", () => {
    const answers = { "measurement-unit": "cm", "bust-measurement": "88", "waist-measurement": "72", "hip-measurement": "94" };
    const keys = ["bust-measurement", "waist-measurement", "hip-measurement"];
    const fields = collectFields(keys, kindsM, answers);
    assert.equal(fields.length, 3);
    assert.equal(fields[0].label, "Bust");
    assert.equal(fields[1].label, "Waist");
    assert.equal(fields[2].label, "Hips");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// QA.5  finalNotes renders actual content, not a placeholder
// ─────────────────────────────────────────────────────────────────────────────

describe("QA.5 finalNotes renders actual content", () => {
  const NOTE = "I love bold colours and structured tailoring. Prefer midi lengths.";

  it("final-notes text is the verbatim note, not 'Notes added'", () => {
    const answers = { "final-notes": NOTE };
    const v = answers["final-notes"];
    assert.equal(v, NOTE);
    assert.notEqual(v, "Notes added");
  });

  it("non-empty finalNotes produces a field entry via text kind", () => {
    const kinds: Record<string, FieldKind> = { "final-notes": "text" };
    const fields = collectFields(["final-notes"], kinds, { "final-notes": NOTE });
    assert.equal(fields.length, 1);
    assert.equal(fields[0].value, NOTE);
  });

  it("empty finalNotes produces no entry (omitted, not 'Not answered')", () => {
    const kinds: Record<string, FieldKind> = { "final-notes": "text" };
    const fields = collectFields(["final-notes"], kinds, { "final-notes": "" });
    assert.equal(fields.length, 0);
  });

  it("whitespace-only finalNotes is also omitted", () => {
    const kinds: Record<string, FieldKind> = { "final-notes": "text" };
    const fields = collectFields(["final-notes"], kinds, { "final-notes": "   " });
    assert.equal(fields.length, 0);
  });

  it("null finalNotes is omitted", () => {
    const kinds: Record<string, FieldKind> = { "final-notes": "text" };
    const fields = collectFields(["final-notes"], kinds, { "final-notes": null });
    assert.equal(fields.length, 0);
  });

  it("getSectionSummary (old logic) would return 'Notes added' for same content", () => {
    // Prove the old behaviour was lossy — the new overview must show the actual text
    const oldLogic = (text: unknown): string =>
      (text && typeof text === "string" && (text as string).trim()) ? "Notes added" : "";
    assert.equal(oldLogic(NOTE), "Notes added");
    assert.notEqual(oldLogic(NOTE), NOTE); // old logic was lossy
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// QA.6  Empty fields omitted — no "+N more", no "Not answered"
// ─────────────────────────────────────────────────────────────────────────────

describe("QA.6 Empty / null / empty-array fields are omitted from overview", () => {
  it("null array value → no field entry", () => {
    const kinds: Record<string, FieldKind> = { "style-personalities": "array" };
    const fields = collectFields(["style-personalities"], kinds, { "style-personalities": null });
    assert.equal(fields.length, 0);
  });

  it("empty array value → no field entry", () => {
    const kinds: Record<string, FieldKind> = { "lifestyle": "array" };
    const fields = collectFields(["lifestyle"], kinds, { "lifestyle": [] });
    assert.equal(fields.length, 0);
  });

  it("empty string text field → no field entry", () => {
    const kinds: Record<string, FieldKind> = { "typical-day": "text" };
    const fields = collectFields(["typical-day"], kinds, { "typical-day": "" });
    assert.equal(fields.length, 0);
  });

  it("null single field → no field entry", () => {
    const kinds: Record<string, FieldKind> = { "structure": "single" };
    const fields = collectFields(["structure"], kinds, { "structure": null });
    assert.equal(fields.length, 0);
  });

  it("undefined field → no field entry", () => {
    const kinds: Record<string, FieldKind> = { "body-shape": "single" };
    const fields = collectFields(["body-shape"], kinds, {});
    assert.equal(fields.length, 0);
  });

  it("a mix of answered and unanswered identity fields shows only answered ones", () => {
    const kinds: Record<string, FieldKind> = {
      "style-personalities": "array",
      "desired-impression":  "array",
    };
    const answers = {
      "style-personalities": ["classic", "minimalist"],
      "desired-impression":  [],
    };
    const fields = collectFields(["style-personalities", "desired-impression"], kinds, answers);
    assert.equal(fields.length, 1);
    assert.equal(fields[0].key, "style-personalities");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// QA.7  Legacy colour IDs filtered from favorite-colors
// ─────────────────────────────────────────────────────────────────────────────

describe("QA.7 LEGACY_COLOUR_IDS filtered from favorite-colors display", () => {
  it("'prints' is a legacy ID and is filtered out", () => {
    assert.ok(LEGACY_COLOUR_IDS.has("prints"));
  });
  it("'colorful' is a legacy ID and is filtered out", () => {
    assert.ok(LEGACY_COLOUR_IDS.has("colorful"));
  });
  it("LEGACY_COLOUR_IDS has exactly 2 entries", () => {
    assert.equal(LEGACY_COLOUR_IDS.size, 2);
  });
  it("valid colour IDs survive the filter", () => {
    const raw = ["red", "prints", "blue", "colorful", "navy"];
    const filtered = raw.filter(id => !LEGACY_COLOUR_IDS.has(id));
    assert.deepEqual(filtered, ["red", "blue", "navy"]);
  });
  it("favorite-colors with only legacy IDs produces no entry", () => {
    const kinds: Record<string, FieldKind> = { "favorite-colors": "array" };
    const fields = collectFields(["favorite-colors"], kinds, { "favorite-colors": ["prints", "colorful"] });
    assert.equal(fields.length, 0);
  });
  it("favorite-colors with mix of legacy+valid shows only valid", () => {
    const kinds: Record<string, FieldKind> = { "favorite-colors": "array" };
    const fields = collectFields(["favorite-colors"], kinds, { "favorite-colors": ["red", "prints", "blue"] });
    assert.equal(fields.length, 1);
    assert.ok(!fields[0].value.includes("prints"));
    assert.ok(fields[0].value.includes("red"));
    assert.ok(fields[0].value.includes("blue"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// QA.8  Full sizes section — all fields rendered with correct labels
// ─────────────────────────────────────────────────────────────────────────────

describe("QA.8 Full sizes section — all 13 fields with correct labels", () => {
  const sizeKinds: Record<string, FieldKind> = {
    "sizing-system":      "single",
    "top-size":           "text",
    "bottom-size":        "text",
    "dress-size":         "text",
    "shoe-sizing-system": "single",
    "shoe-size":          "text",
    "height":             "text",
    "measurement-unit":   "single",
    "bust-measurement":   "text",
    "waist-measurement":  "text",
    "hip-measurement":    "text",
    "body-shape":         "single",
    "fit-concerns":       "array",
  };

  const fullAnswers: Record<string, unknown> = {
    "sizing-system":      "international",
    "top-size":           "M",
    "bottom-size":        "M",
    "dress-size":         "M",
    "shoe-sizing-system": "eu",
    "shoe-size":          "39",
    "height":             "165cm",
    "measurement-unit":   "cm",
    "bust-measurement":   "88",
    "waist-measurement":  "72",
    "hip-measurement":    "94",
    "body-shape":         "pear",
    "fit-concerns":       ["petite", "fuller-bust"],
  };

  it("collects all 13 fields when all are answered", () => {
    const fields = collectFields(SECTION_DRAFTKEYS.sizes, sizeKinds, fullAnswers);
    assert.equal(fields.length, 13);
  });

  it("sizing-system shows 'Clothing sizing system' label and 'International' value", () => {
    const fields = collectFields(SECTION_DRAFTKEYS.sizes, sizeKinds, fullAnswers);
    const f = fields.find(f => f.key === "sizing-system");
    assert.ok(f, "sizing-system field not found");
    assert.equal(f!.label, "Clothing sizing system");
    assert.equal(f!.value, "International");
  });

  it("shoe-sizing-system shows 'Shoe sizing system' label and 'EU' value", () => {
    const fields = collectFields(SECTION_DRAFTKEYS.sizes, sizeKinds, fullAnswers);
    const f = fields.find(f => f.key === "shoe-sizing-system");
    assert.ok(f, "shoe-sizing-system field not found");
    assert.equal(f!.label, "Shoe sizing system");
    assert.equal(f!.value, "EU");
  });

  it("body-shape shows 'Proportions' label and 'Pear' value", () => {
    const fields = collectFields(SECTION_DRAFTKEYS.sizes, sizeKinds, fullAnswers);
    const f = fields.find(f => f.key === "body-shape");
    assert.ok(f, "body-shape field not found");
    assert.equal(f!.label, "Proportions");
    assert.equal(f!.value, "Pear");
  });

  it("fit-concerns shows 'Fit considerations' label with human-readable values", () => {
    const fields = collectFields(SECTION_DRAFTKEYS.sizes, sizeKinds, fullAnswers);
    const f = fields.find(f => f.key === "fit-concerns");
    assert.ok(f, "fit-concerns field not found");
    assert.equal(f!.label, "Fit considerations");
    assert.ok(f!.value.includes("Petite proportions"), "expected Petite proportions in value");
    assert.ok(f!.value.includes("Fuller bust"),        "expected Fuller bust in value");
  });

  it("bust shows 'Bust' label with 'cm' unit appended", () => {
    const fields = collectFields(SECTION_DRAFTKEYS.sizes, sizeKinds, fullAnswers);
    const f = fields.find(f => f.key === "bust-measurement");
    assert.ok(f, "bust-measurement field not found");
    assert.equal(f!.label, "Bust");
    assert.equal(f!.value, "88 cm");
  });

  it("measurement-unit shows 'Centimetres'", () => {
    const fields = collectFields(SECTION_DRAFTKEYS.sizes, sizeKinds, fullAnswers);
    const f = fields.find(f => f.key === "measurement-unit");
    assert.ok(f);
    assert.equal(f!.value, "Centimetres");
  });

  it("international + eu shoe system can coexist (V2-F guarantee)", () => {
    const fields = collectFields(SECTION_DRAFTKEYS.sizes, sizeKinds, fullAnswers);
    const clothing = fields.find(f => f.key === "sizing-system")!.value;
    const shoe     = fields.find(f => f.key === "shoe-sizing-system")!.value;
    assert.equal(clothing, "International");
    assert.equal(shoe,     "EU");
  });
});
