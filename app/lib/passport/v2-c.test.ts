// V2-C contract tests.
//
// Tests: FOCUS_OPTIONS, AVOID_OPTIONS, mutual-exclusion maps, handleBodyAreaToggle logic,
// server normalization, editedField handling, Section 5 overview summary, Section 5
// missingSections exclusion, save-body construction.
//
// Run: node --test --import tsx/esm app/lib/passport/v2-c.test.ts

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ─────────────────────────────────────────────────────────────────────────────
// Mirrored constants (from passport.tsx and api.save-style-profile.jsx)
// ─────────────────────────────────────────────────────────────────────────────

const FOCUS_OPTIONS = [
  { id: "waist",          label: "Waist"           },
  { id: "arms-shoulders", label: "Arms & shoulders" },
  { id: "legs",           label: "Legs"             },
  { id: "neckline",       label: "Neckline"         },
  { id: "back",           label: "Back"             },
  { id: "bust",           label: "Bust"             },
  { id: "hips-curves",    label: "Hips & curves"   },
];
const AVOID_OPTIONS = [
  { id: "upper-arms",  label: "Upper arms"    },
  { id: "midriff",     label: "Midriff"       },
  { id: "bust",        label: "Bust"          },
  { id: "hips-thighs", label: "Hips & thighs" },
  { id: "back",        label: "Back"          },
  { id: "legs",        label: "Legs"          },
  { id: "waist",       label: "Waist"         },
  { id: "neckline",    label: "Neckline"      },
];

const FOCUS_TO_AVOID: Record<string, string> = {
  "waist": "waist", "arms-shoulders": "upper-arms", "legs": "legs",
  "neckline": "neckline", "back": "back", "bust": "bust", "hips-curves": "hips-thighs",
};
const AVOID_TO_FOCUS: Record<string, string> = {
  "waist": "waist", "legs": "legs", "neckline": "neckline", "back": "back",
  "bust": "bust", "upper-arms": "arms-shoulders", "hips-thighs": "hips-curves",
};

const FOCUS_VALID_IDS = new Set(["waist", "arms-shoulders", "legs", "neckline", "back", "bust", "hips-curves"]);
const AVOID_VALID_IDS = new Set(["upper-arms", "midriff", "bust", "hips-thighs", "back", "legs", "waist", "neckline"]);
const MAX_BODY_AREAS = 5;

const FOCUS_TO_AVOID_NORM: Record<string, string> = {
  "waist": "waist", "arms-shoulders": "upper-arms", "legs": "legs",
  "neckline": "neckline", "back": "back", "bust": "bust", "hips-curves": "hips-thighs",
};
const AVOID_TO_FOCUS_NORM: Record<string, string> = {
  "waist": "waist", "legs": "legs", "neckline": "neckline", "back": "back",
  "bust": "bust", "upper-arms": "arms-shoulders", "hips-thighs": "hips-curves",
};

// Simulate handleBodyAreaToggle (mirrored from passport.tsx)
function applyBodyAreaToggle(
  state: { focus: string[]; avoid: string[] },
  draftKey: "body-focus-areas" | "body-avoid-areas",
  optId: string,
): { focus: string[]; avoid: string[]; editedField: "bodyFocusAreas" | "bodyAvoidAreas" } {
  const apiKey = draftKey === "body-focus-areas" ? "bodyFocusAreas" as const : "bodyAvoidAreas" as const;
  const current = draftKey === "body-focus-areas" ? state.focus : state.avoid;
  const other   = draftKey === "body-focus-areas" ? state.avoid  : state.focus;
  const pairKey = draftKey === "body-focus-areas" ? "body-avoid-areas" : "body-focus-areas";
  const overlapMap = draftKey === "body-focus-areas" ? FOCUS_TO_AVOID : AVOID_TO_FOCUS;

  let nextCurrent: string[];
  let nextOther = other;

  if (current.includes(optId)) {
    nextCurrent = current.filter(id => id !== optId);
  } else {
    if (current.length >= MAX_BODY_AREAS) return { ...state, editedField: apiKey };
    nextCurrent = [...current, optId];
    const mappedId = overlapMap[optId];
    if (mappedId) nextOther = other.filter(id => id !== mappedId);
  }

  if (draftKey === "body-focus-areas") {
    return { focus: nextCurrent, avoid: nextOther, editedField: "bodyFocusAreas" };
  } else {
    return { focus: nextOther, avoid: nextCurrent, editedField: "bodyAvoidAreas" };
  }
}

// Simulate server normalization (mirrored from api.save-style-profile.jsx)
function serverNormalize(
  focus: string[],
  avoid: string[],
  editedField: string | undefined,
): { focus: string[]; avoid: string[] } {
  const ef = editedField === "bodyAvoidAreas" ? "bodyAvoidAreas" : "bodyFocusAreas";
  const cleanFocus = focus.filter(id => FOCUS_VALID_IDS.has(id));
  const cleanAvoid = avoid.filter(id => AVOID_VALID_IDS.has(id));
  let nFocus = cleanFocus;
  let nAvoid = cleanAvoid;
  if (ef === "bodyFocusAreas") {
    const conflicts = new Set(nFocus.map(id => FOCUS_TO_AVOID_NORM[id]).filter(Boolean));
    nAvoid = nAvoid.filter(id => !conflicts.has(id));
  } else {
    const conflicts = new Set(nAvoid.map(id => AVOID_TO_FOCUS_NORM[id]).filter(Boolean));
    nFocus = nFocus.filter(id => !conflicts.has(id));
  }
  return { focus: nFocus, avoid: nAvoid };
}

// ─────────────────────────────────────────────────────────────────────────────
// C.1 — FOCUS_OPTIONS constant
// ─────────────────────────────────────────────────────────────────────────────

describe("C.1 FOCUS_OPTIONS", () => {
  it("has exactly 7 options", () => {
    assert.equal(FOCUS_OPTIONS.length, 7);
  });

  it("every entry has id and label", () => {
    for (const o of FOCUS_OPTIONS) {
      assert.ok(o.id, `missing id: ${JSON.stringify(o)}`);
      assert.ok(o.label, `missing label: ${o.id}`);
    }
  });

  it("contains all 7 expected IDs", () => {
    const ids = new Set(FOCUS_OPTIONS.map(o => o.id));
    for (const id of ["waist", "arms-shoulders", "legs", "neckline", "back", "bust", "hips-curves"]) {
      assert.ok(ids.has(id), `missing: ${id}`);
    }
  });

  it("does NOT include 'midriff'", () => {
    assert.ok(!FOCUS_OPTIONS.some(o => o.id === "midriff"));
  });

  it("does NOT include 'upper-arms' (avoid-only concept)", () => {
    assert.ok(!FOCUS_OPTIONS.some(o => o.id === "upper-arms"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C.2 — AVOID_OPTIONS constant
// ─────────────────────────────────────────────────────────────────────────────

describe("C.2 AVOID_OPTIONS", () => {
  it("has exactly 8 options", () => {
    assert.equal(AVOID_OPTIONS.length, 8);
  });

  it("every entry has id and label", () => {
    for (const o of AVOID_OPTIONS) {
      assert.ok(o.id, `missing id: ${JSON.stringify(o)}`);
      assert.ok(o.label, `missing label: ${o.id}`);
    }
  });

  it("contains all 8 expected IDs", () => {
    const ids = new Set(AVOID_OPTIONS.map(o => o.id));
    for (const id of ["upper-arms", "midriff", "bust", "hips-thighs", "back", "legs", "waist", "neckline"]) {
      assert.ok(ids.has(id), `missing: ${id}`);
    }
  });

  it("includes 'midriff' (avoid-only — no focus counterpart)", () => {
    assert.ok(AVOID_OPTIONS.some(o => o.id === "midriff"));
  });

  it("does NOT include 'arms-shoulders' (focus-only concept)", () => {
    assert.ok(!AVOID_OPTIONS.some(o => o.id === "arms-shoulders"));
  });

  it("does NOT include 'hips-curves' (focus-only ID; avoid uses 'hips-thighs')", () => {
    assert.ok(!AVOID_OPTIONS.some(o => o.id === "hips-curves"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C.3 — Mutual-exclusion maps
// ─────────────────────────────────────────────────────────────────────────────

describe("C.3 mutual-exclusion maps", () => {
  it("FOCUS_TO_AVOID: arms-shoulders → upper-arms", () => {
    assert.equal(FOCUS_TO_AVOID["arms-shoulders"], "upper-arms");
  });

  it("FOCUS_TO_AVOID: hips-curves → hips-thighs", () => {
    assert.equal(FOCUS_TO_AVOID["hips-curves"], "hips-thighs");
  });

  it("FOCUS_TO_AVOID: waist → waist", () => {
    assert.equal(FOCUS_TO_AVOID["waist"], "waist");
  });

  it("AVOID_TO_FOCUS: upper-arms → arms-shoulders", () => {
    assert.equal(AVOID_TO_FOCUS["upper-arms"], "arms-shoulders");
  });

  it("AVOID_TO_FOCUS: hips-thighs → hips-curves", () => {
    assert.equal(AVOID_TO_FOCUS["hips-thighs"], "hips-curves");
  });

  it("AVOID_TO_FOCUS: waist → waist", () => {
    assert.equal(AVOID_TO_FOCUS["waist"], "waist");
  });

  it("midriff is NOT in AVOID_TO_FOCUS (no focus counterpart)", () => {
    assert.ok(!Object.hasOwn(AVOID_TO_FOCUS, "midriff"));
  });

  it("FOCUS_TO_AVOID has 7 entries (one per focus option)", () => {
    assert.equal(Object.keys(FOCUS_TO_AVOID).length, 7);
  });

  it("AVOID_TO_FOCUS has 7 entries (midriff excluded)", () => {
    assert.equal(Object.keys(AVOID_TO_FOCUS).length, 7);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C.4 — handleBodyAreaToggle: selecting focus removes paired avoid
// ─────────────────────────────────────────────────────────────────────────────

describe("C.4 toggle focus removes paired avoid", () => {
  it("selecting arms-shoulders removes upper-arms from avoid", () => {
    const state = { focus: [], avoid: ["upper-arms", "back"] };
    const result = applyBodyAreaToggle(state, "body-focus-areas", "arms-shoulders");
    assert.ok(result.focus.includes("arms-shoulders"));
    assert.ok(!result.avoid.includes("upper-arms"), "upper-arms should be removed from avoid");
    assert.ok(result.avoid.includes("back"), "unrelated avoid item stays");
  });

  it("selecting hips-curves removes hips-thighs from avoid", () => {
    const state = { focus: [], avoid: ["hips-thighs"] };
    const result = applyBodyAreaToggle(state, "body-focus-areas", "hips-curves");
    assert.ok(result.focus.includes("hips-curves"));
    assert.ok(!result.avoid.includes("hips-thighs"));
  });

  it("selecting waist (focus) removes waist from avoid", () => {
    const state = { focus: [], avoid: ["waist", "midriff"] };
    const result = applyBodyAreaToggle(state, "body-focus-areas", "waist");
    assert.ok(result.focus.includes("waist"));
    assert.ok(!result.avoid.includes("waist"), "waist removed from avoid");
    assert.ok(result.avoid.includes("midriff"), "midriff stays");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C.5 — handleBodyAreaToggle: selecting avoid removes paired focus
// ─────────────────────────────────────────────────────────────────────────────

describe("C.5 toggle avoid removes paired focus", () => {
  it("selecting upper-arms removes arms-shoulders from focus", () => {
    const state = { focus: ["arms-shoulders", "bust"], avoid: [] };
    const result = applyBodyAreaToggle(state, "body-avoid-areas", "upper-arms");
    assert.ok(result.avoid.includes("upper-arms"));
    assert.ok(!result.focus.includes("arms-shoulders"), "arms-shoulders removed from focus");
    assert.ok(result.focus.includes("bust"), "unrelated focus item stays");
  });

  it("selecting hips-thighs removes hips-curves from focus", () => {
    const state = { focus: ["hips-curves"], avoid: [] };
    const result = applyBodyAreaToggle(state, "body-avoid-areas", "hips-thighs");
    assert.ok(result.avoid.includes("hips-thighs"));
    assert.ok(!result.focus.includes("hips-curves"));
  });

  it("selecting midriff (avoid) does NOT remove any focus item", () => {
    const state = { focus: ["waist", "bust"], avoid: [] };
    const result = applyBodyAreaToggle(state, "body-avoid-areas", "midriff");
    assert.ok(result.avoid.includes("midriff"));
    assert.deepEqual(result.focus, ["waist", "bust"], "focus unchanged");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C.6 — handleBodyAreaToggle: cap at 5
// ─────────────────────────────────────────────────────────────────────────────

describe("C.6 cap at 5 per picker", () => {
  it("selecting a 6th focus item is rejected (cap at 5)", () => {
    const state = {
      focus: ["waist", "arms-shoulders", "legs", "neckline", "back"],
      avoid: [],
    };
    const result = applyBodyAreaToggle(state, "body-focus-areas", "bust");
    assert.equal(result.focus.length, 5, "still 5 after cap");
    assert.ok(!result.focus.includes("bust"));
  });

  it("selecting a 6th avoid item is rejected (cap at 5)", () => {
    const state = {
      focus: [],
      avoid: ["upper-arms", "midriff", "bust", "hips-thighs", "back"],
    };
    const result = applyBodyAreaToggle(state, "body-avoid-areas", "legs");
    assert.equal(result.avoid.length, 5, "still 5 after cap");
    assert.ok(!result.avoid.includes("legs"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C.7 — handleBodyAreaToggle: toggle off
// ─────────────────────────────────────────────────────────────────────────────

describe("C.7 toggle off deselects without removing paired item", () => {
  it("deselecting a focus item removes only that item", () => {
    const state = { focus: ["waist", "bust"], avoid: ["waist"] };
    const result = applyBodyAreaToggle(state, "body-focus-areas", "waist");
    assert.ok(!result.focus.includes("waist"), "waist deselected");
    assert.ok(result.focus.includes("bust"), "bust stays");
    assert.ok(result.avoid.includes("waist"), "paired avoid-waist NOT removed on deselect");
  });

  it("deselecting an avoid item removes only that item", () => {
    const state = { focus: ["arms-shoulders"], avoid: ["upper-arms", "back"] };
    const result = applyBodyAreaToggle(state, "body-avoid-areas", "upper-arms");
    assert.ok(!result.avoid.includes("upper-arms"), "upper-arms deselected");
    assert.ok(result.avoid.includes("back"), "back stays");
    assert.ok(result.focus.includes("arms-shoulders"), "paired focus-arms-shoulders NOT removed on deselect");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C.8 — handleBodyAreaToggle: sizeEditedField tracking
// ─────────────────────────────────────────────────────────────────────────────

describe("C.8 sizeEditedField tracks last-touched picker", () => {
  it("selecting focus sets editedField to bodyFocusAreas", () => {
    const result = applyBodyAreaToggle({ focus: [], avoid: [] }, "body-focus-areas", "waist");
    assert.equal(result.editedField, "bodyFocusAreas");
  });

  it("selecting avoid sets editedField to bodyAvoidAreas", () => {
    const result = applyBodyAreaToggle({ focus: [], avoid: [] }, "body-avoid-areas", "midriff");
    assert.equal(result.editedField, "bodyAvoidAreas");
  });

  it("deselecting focus also updates editedField to bodyFocusAreas", () => {
    const result = applyBodyAreaToggle({ focus: ["waist"], avoid: [] }, "body-focus-areas", "waist");
    assert.equal(result.editedField, "bodyFocusAreas");
  });

  it("deselecting avoid also updates editedField to bodyAvoidAreas", () => {
    const result = applyBodyAreaToggle({ focus: [], avoid: ["midriff"] }, "body-avoid-areas", "midriff");
    assert.equal(result.editedField, "bodyAvoidAreas");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C.9 — Server normalization: focus wins when editedField === bodyFocusAreas
// ─────────────────────────────────────────────────────────────────────────────

describe("C.9 server normalization — focus wins", () => {
  it("conflicting avoid item removed when focus wins (arms-shoulders / upper-arms)", () => {
    const result = serverNormalize(["arms-shoulders"], ["upper-arms", "back"], "bodyFocusAreas");
    assert.ok(!result.avoid.includes("upper-arms"), "upper-arms removed by focus win");
    assert.ok(result.avoid.includes("back"), "unrelated avoid stays");
    assert.ok(result.focus.includes("arms-shoulders"));
  });

  it("no conflict → both arrays unchanged", () => {
    const result = serverNormalize(["waist"], ["midriff"], "bodyFocusAreas");
    assert.deepEqual(result.focus, ["waist"]);
    assert.deepEqual(result.avoid, ["midriff"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C.10 — Server normalization: avoid wins when editedField === bodyAvoidAreas
// ─────────────────────────────────────────────────────────────────────────────

describe("C.10 server normalization — avoid wins", () => {
  it("conflicting focus item removed when avoid wins (upper-arms / arms-shoulders)", () => {
    const result = serverNormalize(["arms-shoulders", "bust"], ["upper-arms"], "bodyAvoidAreas");
    assert.ok(!result.focus.includes("arms-shoulders"), "arms-shoulders removed by avoid win");
    assert.ok(result.focus.includes("bust"), "unrelated focus stays");
    assert.ok(result.avoid.includes("upper-arms"));
  });

  it("midriff in avoid does not remove anything from focus (no mapping)", () => {
    const result = serverNormalize(["waist", "bust"], ["midriff"], "bodyAvoidAreas");
    assert.deepEqual(result.focus, ["waist", "bust"], "focus unchanged — midriff has no counterpart");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C.11 — Server normalization: focus wins as fallback (missing/invalid editedField)
// ─────────────────────────────────────────────────────────────────────────────

describe("C.11 server normalization — focus wins as fallback", () => {
  it("missing editedField → focus wins", () => {
    const result = serverNormalize(["hips-curves"], ["hips-thighs"], undefined);
    assert.ok(result.focus.includes("hips-curves"), "focus kept");
    assert.ok(!result.avoid.includes("hips-thighs"), "avoid conflict removed");
  });

  it("invalid editedField → focus wins", () => {
    const result = serverNormalize(["waist"], ["waist"], "bodyUnknown");
    assert.ok(result.focus.includes("waist"), "focus kept");
    assert.ok(!result.avoid.includes("waist"), "avoid conflict removed");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C.12 — Server normalization: invalid IDs stripped before normalization
// ─────────────────────────────────────────────────────────────────────────────

describe("C.12 invalid IDs stripped by server", () => {
  it("unknown focus IDs are stripped", () => {
    const result = serverNormalize(["waist", "unknown-area"], [], "bodyFocusAreas");
    assert.ok(!result.focus.includes("unknown-area"));
    assert.ok(result.focus.includes("waist"));
  });

  it("unknown avoid IDs are stripped", () => {
    const result = serverNormalize([], ["midriff", "bad-id"], "bodyAvoidAreas");
    assert.ok(!result.avoid.includes("bad-id"));
    assert.ok(result.avoid.includes("midriff"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C.13 — editedField is request-only (not in RECOGNISED_FIELDS)
// ─────────────────────────────────────────────────────────────────────────────

describe("C.13 editedField is request-only", () => {
  const RECOGNISED_FIELDS = new Set([
    "stylePersonalities", "desiredImpression", "lifestyle", "desiredFeelings",
    "becoming", "fitPreferences", "styleStruggles", "favoriteColors",
    "avoidColors", "styleSupport", "finalNotes",
    "silhouette", "structure", "coveragePreferences", "typicalDay",
    "neutralVsColour", "colourIntensity", "printAppetite", "shoppingPriorities", "trendAppetite",
    "bodyFocusAreas", "bodyAvoidAreas",
  ]);

  it("editedField is NOT in RECOGNISED_FIELDS", () => {
    assert.ok(!RECOGNISED_FIELDS.has("editedField"));
  });

  it("bodyFocusAreas IS in RECOGNISED_FIELDS", () => {
    assert.ok(RECOGNISED_FIELDS.has("bodyFocusAreas"));
  });

  it("bodyAvoidAreas IS in RECOGNISED_FIELDS", () => {
    assert.ok(RECOGNISED_FIELDS.has("bodyAvoidAreas"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C.14 — Section 5 is never "missing" (optional: true)
// ─────────────────────────────────────────────────────────────────────────────

describe("C.14 Section 5 never appears in missingSections", () => {
  interface SectionDef {
    id:        string;
    subFields: { draftKey: string; kind: "array" | "text" | "single" | "color" }[];
    optional?: boolean;
  }

  const sizes: SectionDef = {
    id: "sizes",
    subFields: [
      { draftKey: "body-focus-areas", kind: "array" },
      { draftKey: "body-avoid-areas", kind: "array" },
    ],
    optional: true,
  };

  function computeMissing(sections: SectionDef[], saved: Record<string, unknown>): SectionDef[] {
    return sections.filter(s => {
      if (s.optional) return false;
      const primary = s.subFields[0];
      if (!primary) return false;
      const v = saved[primary.draftKey];
      return !Array.isArray(v) || (v as string[]).length === 0;
    });
  }

  it("sizes is excluded when both body-area arrays are empty", () => {
    const missing = computeMissing([sizes], {});
    assert.ok(!missing.some(s => s.id === "sizes"));
  });

  it("sizes is excluded even when body-focus-areas has items", () => {
    const missing = computeMissing([sizes], { "body-focus-areas": ["waist"] });
    assert.ok(!missing.some(s => s.id === "sizes"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C.15 — Section 5 overview summary: label format (first 2 + "+N more")
// ─────────────────────────────────────────────────────────────────────────────

describe("C.15 Section 5 getSectionSummary label format", () => {
  const focusLabels = Object.fromEntries(FOCUS_OPTIONS.map(o => [o.id, o.label]));
  const avoidLabels = Object.fromEntries(AVOID_OPTIONS.map(o => [o.id, o.label]));

  function areaLine(ids: string[], labels: Record<string, string>, prefix: string): string {
    const humanLabels = ids.map(id => labels[id] ?? id.replace(/-/g, " "));
    const shown = humanLabels.slice(0, 2);
    const rest = humanLabels.length - 2;
    return `${prefix}: ${shown.join(", ")}${rest > 0 ? ` +${rest} more` : ""}`;
  }

  function getSizesSummary(focusIds: string[], avoidIds: string[]): string | "missing" {
    if (focusIds.length === 0 && avoidIds.length === 0) return "missing";
    const hasFocus = focusIds.length > 0;
    const hasAvoid = avoidIds.length > 0;
    if (hasFocus && hasAvoid) {
      return `${areaLine(focusIds, focusLabels, "Highlights")} | ${areaLine(avoidIds, avoidLabels, "Coverage")}`;
    }
    if (hasFocus) return areaLine(focusIds, focusLabels, "Highlights");
    return areaLine(avoidIds, avoidLabels, "Coverage");
  }

  it("both empty → 'missing'", () => {
    assert.equal(getSizesSummary([], []), "missing");
  });

  it("1 focus → 'Highlights: <label>'", () => {
    assert.equal(getSizesSummary(["waist"], []), "Highlights: Waist");
  });

  it("2 focus → 'Highlights: label1, label2'", () => {
    assert.equal(getSizesSummary(["waist", "legs"], []), "Highlights: Waist, Legs");
  });

  it("3 focus → 'Highlights: label1, label2 +1 more'", () => {
    assert.equal(getSizesSummary(["waist", "legs", "bust"], []), "Highlights: Waist, Legs +1 more");
  });

  it("5 focus → 'Highlights: label1, label2 +3 more'", () => {
    const ids = FOCUS_OPTIONS.map(o => o.id); // all 7, capped at 5 in practice
    const result = areaLine(ids.slice(0, 5), focusLabels, "Highlights");
    assert.ok(result.startsWith("Highlights:"), result);
    assert.ok(result.includes("+3 more"), result);
  });

  it("1 avoid → 'Coverage: <label>'", () => {
    assert.equal(getSizesSummary([], ["midriff"]), "Coverage: Midriff");
  });

  it("2 avoid → 'Coverage: label1, label2'", () => {
    assert.equal(getSizesSummary([], ["upper-arms", "midriff"]), "Coverage: Upper arms, Midriff");
  });

  it("3 avoid → 'Coverage: label1, label2 +1 more'", () => {
    assert.equal(getSizesSummary([], ["upper-arms", "midriff", "back"]), "Coverage: Upper arms, Midriff +1 more");
  });

  it("both set → shows Highlights and Coverage", () => {
    const result = getSizesSummary(["waist"], ["midriff"]);
    assert.ok(result.includes("Highlights: Waist"), `missing focus line: ${result}`);
    assert.ok(result.includes("Coverage: Midriff"), `missing avoid line: ${result}`);
  });

  it("uses human-readable labels, never raw IDs", () => {
    const result = getSizesSummary(["arms-shoulders"], ["hips-thighs"]);
    assert.ok(!result.includes("arms-shoulders"), "raw ID leaked into summary");
    assert.ok(!result.includes("hips-thighs"), "raw ID leaked into summary");
    assert.ok(result.includes("Arms & shoulders"), `expected label not found: ${result}`);
    assert.ok(result.includes("Hips & thighs"), `expected label not found: ${result}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C.16 — Section 5 subFields contract
// ─────────────────────────────────────────────────────────────────────────────

describe("C.16 Section 5 subFields contract", () => {
  const sizesSubFields = [
    { draftKey: "body-focus-areas", apiKey: "bodyFocusAreas", kind: "array", questionId: "body-focus-areas"  },
    { draftKey: "body-avoid-areas", apiKey: "bodyAvoidAreas", kind: "array", questionId: "body-avoid-areas" },
  ];

  it("has exactly 2 subFields", () => {
    assert.equal(sizesSubFields.length, 2);
  });

  it("first subField is bodyFocusAreas", () => {
    assert.equal(sizesSubFields[0].apiKey, "bodyFocusAreas");
    assert.equal(sizesSubFields[0].draftKey, "body-focus-areas");
    assert.equal(sizesSubFields[0].kind, "array");
  });

  it("second subField is bodyAvoidAreas", () => {
    assert.equal(sizesSubFields[1].apiKey, "bodyAvoidAreas");
    assert.equal(sizesSubFields[1].draftKey, "body-avoid-areas");
    assert.equal(sizesSubFields[1].kind, "array");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C.17 — Max selections per picker
// ─────────────────────────────────────────────────────────────────────────────

describe("C.17 max selections per picker", () => {
  it("MAX_BODY_AREAS is 5", () => {
    assert.equal(MAX_BODY_AREAS, 5);
  });

  it("focus cap enforced at 5", () => {
    const atMax = { focus: ["waist", "arms-shoulders", "legs", "neckline", "back"], avoid: [] };
    const result = applyBodyAreaToggle(atMax, "body-focus-areas", "bust");
    assert.equal(result.focus.length, 5);
    assert.ok(!result.focus.includes("bust"));
  });

  it("avoid cap enforced at 5", () => {
    const atMax = { focus: [], avoid: ["upper-arms", "midriff", "bust", "hips-thighs", "back"] };
    const result = applyBodyAreaToggle(atMax, "body-avoid-areas", "waist");
    assert.equal(result.avoid.length, 5);
    assert.ok(!result.avoid.includes("waist"));
  });

  it("exactly 5 items can be selected (cap is inclusive)", () => {
    let state = { focus: [] as string[], avoid: [] as string[] };
    for (const opt of FOCUS_OPTIONS.slice(0, 5)) {
      const r = applyBodyAreaToggle(state, "body-focus-areas", opt.id);
      state = { focus: r.focus, avoid: r.avoid };
    }
    assert.equal(state.focus.length, 5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C.18 — FOCUS_VALID_IDS and AVOID_VALID_IDS
// ─────────────────────────────────────────────────────────────────────────────

describe("C.18 valid ID sets", () => {
  it("FOCUS_VALID_IDS has 7 entries", () => {
    assert.equal(FOCUS_VALID_IDS.size, 7);
  });

  it("AVOID_VALID_IDS has 8 entries", () => {
    assert.equal(AVOID_VALID_IDS.size, 8);
  });

  it("midriff is in AVOID_VALID_IDS", () => {
    assert.ok(AVOID_VALID_IDS.has("midriff"));
  });

  it("midriff is NOT in FOCUS_VALID_IDS", () => {
    assert.ok(!FOCUS_VALID_IDS.has("midriff"));
  });

  it("arms-shoulders is in FOCUS_VALID_IDS", () => {
    assert.ok(FOCUS_VALID_IDS.has("arms-shoulders"));
  });

  it("arms-shoulders is NOT in AVOID_VALID_IDS", () => {
    assert.ok(!AVOID_VALID_IDS.has("arms-shoulders"));
  });

  it("bust appears in both FOCUS and AVOID valid IDs", () => {
    assert.ok(FOCUS_VALID_IDS.has("bust"));
    assert.ok(AVOID_VALID_IDS.has("bust"));
  });
});
