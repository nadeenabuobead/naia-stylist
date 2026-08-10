// Tests for /passport page — V2-B2 section structure.
//
// Uses node:test + tsx/esm (same runner as the rest of the project).
// No DOM or Prisma required — we test the pure state-machine logic mirrored
// from passport.tsx so we can import without pulling in react-router server APIs.
//
// Run: node --test --import tsx/esm app/routes/passport.test.ts

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ─────────────────────────────────────────────────────────────────────────────
// Types & data structures mirrored from passport.tsx (V2-B2)
// ─────────────────────────────────────────────────────────────────────────────

type SectionId =
  | "identity" | "direction" | "life" | "fit" | "sizes" | "colours" | "wardrobe"
  | "notes";

type FieldKind = "array" | "color" | "single" | "text";

interface SubField {
  draftKey: string;
  apiKey:   string;
  kind:     FieldKind;
}

interface SectionDef {
  id:          SectionId;
  subFields:   SubField[];
  placeholder?: boolean;
}

type Mode =
  | { kind: "overview" }
  | { kind: "picker" }
  | { kind: "flow"; queue: SectionId[]; index: number; done?: boolean };

// Mirrored from passport.tsx — 7 named sections (sizes is placeholder)
const SECTIONS: SectionDef[] = [
  { id: "identity", subFields: [
    { draftKey: "style-personalities", apiKey: "stylePersonalities", kind: "array" },
    { draftKey: "desired-impression",  apiKey: "desiredImpression",  kind: "array" },
  ]},
  { id: "direction", subFields: [
    { draftKey: "desired-feelings", apiKey: "desiredFeelings", kind: "array" },
    { draftKey: "becoming",         apiKey: "becoming",        kind: "array" },
  ]},
  { id: "life", subFields: [
    { draftKey: "lifestyle",    apiKey: "lifestyle",   kind: "array" },
    { draftKey: "typical-day", apiKey: "typicalDay",  kind: "text"  },
  ]},
  { id: "fit", subFields: [
    { draftKey: "silhouette",           apiKey: "silhouette",          kind: "array"  },
    { draftKey: "structure",            apiKey: "structure",           kind: "single" },
    { draftKey: "coverage-preferences", apiKey: "coveragePreferences", kind: "array"  },
  ]},
  { id: "sizes", subFields: [], placeholder: true },
  { id: "colours", subFields: [
    { draftKey: "favorite-colors",   apiKey: "favoriteColors",  kind: "color"  },
    { draftKey: "avoid-colors",      apiKey: "avoidColors",     kind: "color"  },
    { draftKey: "neutral-vs-colour", apiKey: "neutralVsColour", kind: "single" },
    { draftKey: "colour-intensity",  apiKey: "colourIntensity", kind: "single" },
    { draftKey: "print-appetite",    apiKey: "printAppetite",   kind: "single" },
  ]},
  { id: "wardrobe", subFields: [
    { draftKey: "wardrobe-disconnection", apiKey: "styleStruggles",     kind: "array"  },
    { draftKey: "style-support",          apiKey: "styleSupport",       kind: "array"  },
    { draftKey: "shopping-priorities",    apiKey: "shoppingPriorities", kind: "array"  },
    { draftKey: "trend-appetite",         apiKey: "trendAppetite",      kind: "single" },
  ]},
];

// Notes — outside the 7 named sections
const NOTES_SECTION: SectionDef = {
  id: "notes",
  subFields: [
    { draftKey: "final-notes", apiKey: "finalNotes", kind: "text" },
  ],
};

const ALL_SECTIONS: SectionDef[] = [...SECTIONS, NOTES_SECTION];

const LEGACY_COLOUR_IDS = new Set(["prints", "colorful"]);

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers (mirrored from passport.tsx)
// ─────────────────────────────────────────────────────────────────────────────

function computeMissingSections(savedAnswers: Record<string, unknown>): SectionDef[] {
  return ALL_SECTIONS.filter(s => {
    if (s.placeholder) return false;
    const primary = s.subFields[0];
    if (!primary) return false;

    const v = savedAnswers[primary.draftKey];

    if (primary.kind === "text" || primary.kind === "single") {
      return !v || (typeof v === "string" && !v.trim());
    }
    // array / color: strip legacy IDs for favorite-colors
    const raw = (Array.isArray(v) ? v : []) as string[];
    const effective = primary.draftKey === "favorite-colors"
      ? raw.filter(id => !LEGACY_COLOUR_IDS.has(id))
      : raw;
    return effective.length === 0;
  });
}

function arraysEqualAsSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

function computeSectionPatch(
  section: SectionDef,
  edits:   Record<string, unknown>,
  saved:   Record<string, unknown>,
): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {};
  let hasChange = false;

  for (const { draftKey, apiKey, kind } of section.subFields) {
    const editedRaw = edits[draftKey];
    const savedRaw  = saved[draftKey];

    if (kind === "text") {
      const edited  = (typeof editedRaw === "string" && editedRaw.trim()) ? editedRaw : null;
      const current = (typeof savedRaw  === "string" && savedRaw.trim())  ? savedRaw  : null;
      if (edited !== current) { patch[apiKey] = edited; hasChange = true; }
    } else if (kind === "single") {
      const edited  = (typeof editedRaw === "string" && editedRaw !== "") ? editedRaw : null;
      const current = (typeof savedRaw  === "string" && savedRaw  !== "") ? savedRaw  : null;
      if (edited !== current) { patch[apiKey] = edited; hasChange = true; }
    } else {
      const edited  = (Array.isArray(editedRaw) ? editedRaw : []) as string[];
      const current = (Array.isArray(savedRaw)  ? savedRaw  : []) as string[];
      if (!arraysEqualAsSet(edited, current)) { patch[apiKey] = edited; hasChange = true; }
    }
  }

  return hasChange ? patch : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Button handler simulations (mirrored from passport.tsx onClick handlers)
// ─────────────────────────────────────────────────────────────────────────────

function sim_startContinue(
  missingSections: SectionDef[],
  outMode:         { value: Mode },
  outHistory:      { passport: string }[],
) {
  if (!missingSections.length) return;
  outHistory.push({ passport: "flow" });
  outMode.value = { kind: "flow", queue: missingSections.map(s => s.id), index: 0 };
}

function sim_startUpdate(outMode: { value: Mode }, outHistory: { passport: string }[]) {
  outHistory.push({ passport: "picker" });
  outMode.value = { kind: "picker" };
}

function sim_onPopState(state: { passport?: string } | null, outMode: { value: Mode }) {
  if (!state?.passport) outMode.value = { kind: "overview" };
}

function sim_pickerSelect(sectionId: SectionId, outMode: { value: Mode }, outHistory: { passport: string }[]) {
  outHistory.push({ passport: "flow" });
  outMode.value = { kind: "flow", queue: [sectionId], index: 0 };
}

// Mirrored initEdits — strips legacy colours from favorite-colors
function initEdits(sectionDef: SectionDef, savedAnswers: Record<string, unknown>): Record<string, unknown> {
  const edits: Record<string, unknown> = {};
  for (const { draftKey, kind } of sectionDef.subFields) {
    const v = savedAnswers[draftKey];
    if (kind === "text" || kind === "single") {
      edits[draftKey] = typeof v === "string" ? v : "";
    } else {
      const arr = (Array.isArray(v) ? [...v] : []) as string[];
      edits[draftKey] = draftKey === "favorite-colors"
        ? arr.filter(id => !LEGACY_COLOUR_IDS.has(id))
        : arr;
    }
  }
  return edits;
}

// Mirrored handleToggle — mutual exclusion for colour pickers
function handleToggle(
  edits:   Record<string, unknown>,
  draftKey: string,
  optId:   string,
  max:     number,
  pairKey?: string,
): Record<string, unknown> {
  const current = ((edits[draftKey] as string[] | undefined) ?? []);
  if (current.includes(optId)) {
    return { ...edits, [draftKey]: current.filter(id => id !== optId) };
  }
  if (current.length < max) {
    const next: Record<string, unknown> = { ...edits, [draftKey]: [...current, optId] };
    if (pairKey) {
      const pair = ((edits[pairKey] as string[] | undefined) ?? []);
      next[pairKey] = pair.filter(id => id !== optId);
    }
    return next;
  }
  return edits;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared fixtures
// ─────────────────────────────────────────────────────────────────────────────

const ALMOST_COMPLETE: Record<string, unknown> = {
  "style-personalities":    ["casual-cool"],
  "desired-feelings":       ["confident"],
  lifestyle:                ["office"],
  silhouette:               ["straight"],
  "favorite-colors":        ["black"],   // non-legacy
  "wardrobe-disconnection": ["rush"],
  // final-notes intentionally absent → notes section still missing
};

const COMPLETE: Record<string, unknown> = {
  ...ALMOST_COMPLETE,
  "final-notes": "Ready to go",
};

// ─────────────────────────────────────────────────────────────────────────────
// Section structure
// ─────────────────────────────────────────────────────────────────────────────

describe("section structure", () => {
  it("SECTIONS has exactly 7 entries (the 7 named passport sections)", () => {
    assert.equal(SECTIONS.length, 7);
  });

  it("SECTIONS entries are in the correct order", () => {
    assert.deepEqual(SECTIONS.map(s => s.id), [
      "identity", "direction", "life", "fit", "sizes", "colours", "wardrobe",
    ]);
  });

  it("NOTES_SECTION is not in SECTIONS", () => {
    assert.ok(!SECTIONS.some(s => s.id === "notes"));
  });

  it("NOTES_SECTION.id is 'notes'", () => {
    assert.equal(NOTES_SECTION.id, "notes");
  });

  it("ALL_SECTIONS has 8 entries (7 + notes)", () => {
    assert.equal(ALL_SECTIONS.length, 8);
  });

  it("sizes section has placeholder: true and no subFields", () => {
    const sizes = SECTIONS.find(s => s.id === "sizes")!;
    assert.ok(sizes.placeholder === true);
    assert.equal(sizes.subFields.length, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// missingSections — drives "Continue Passport" visibility and queue
// ─────────────────────────────────────────────────────────────────────────────

describe("missingSections", () => {
  it("returns 7 sections when savedAnswers is empty (sizes excluded as placeholder)", () => {
    const missing = computeMissingSections({});
    assert.equal(missing.length, 7);
    assert.ok(!missing.some(s => s.id === "sizes"));
  });

  it("excludes a section whose primary subField has data", () => {
    const missing = computeMissingSections({ "style-personalities": ["casual-cool"] });
    const ids = missing.map(s => s.id);
    assert.ok(!ids.includes("identity"));
    assert.ok(ids.includes("direction"));
  });

  it("sizes section never appears in missingSections", () => {
    const missing = computeMissingSections({});
    assert.ok(!missing.map(s => s.id).includes("sizes"));
  });

  it("favourite-colors with only legacy IDs counts as missing", () => {
    const missing = computeMissingSections({ "favorite-colors": ["prints", "colorful"] });
    assert.ok(missing.map(s => s.id).includes("colours"));
  });

  it("favourite-colors with at least one non-legacy ID does not count as missing", () => {
    const missing = computeMissingSections({ "favorite-colors": ["prints", "black"] });
    assert.ok(!missing.map(s => s.id).includes("colours"));
  });

  it("includes notes section when final-notes is absent", () => {
    assert.ok(computeMissingSections(ALMOST_COMPLETE).map(s => s.id).includes("notes"));
  });

  it("includes notes section when final-notes is empty string", () => {
    assert.ok(computeMissingSections({ "final-notes": "" }).map(s => s.id).includes("notes"));
  });

  it("excludes notes section when final-notes has content", () => {
    assert.ok(!computeMissingSections({ "final-notes": "Some notes" }).map(s => s.id).includes("notes"));
  });

  it("returns empty array (isComplete) when all primary fields are filled", () => {
    assert.equal(computeMissingSections(COMPLETE).length, 0);
  });

  it("direction section keyed by desired-feelings (not desired-feelings-old)", () => {
    const missing = computeMissingSections({ "desired-feelings": ["confident"] });
    assert.ok(!missing.map(s => s.id).includes("direction"));
  });

  it("fit section keyed by silhouette", () => {
    const missing = computeMissingSections({ silhouette: ["straight"] });
    assert.ok(!missing.map(s => s.id).includes("fit"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Continue Passport button
// ─────────────────────────────────────────────────────────────────────────────

describe("Continue Passport button", () => {
  it("transitions mode to flow with notes queue when notes is the only missing section", () => {
    const missing = computeMissingSections(ALMOST_COMPLETE);
    const mode = { value: { kind: "overview" } as Mode };
    const history: { passport: string }[] = [];
    sim_startContinue(missing, mode, history);
    assert.equal(mode.value.kind, "flow");
    assert.deepEqual((mode.value as { queue: SectionId[] }).queue, ["notes"]);
  });

  it("pushes a { passport: 'flow' } history entry when clicked", () => {
    const missing = computeMissingSections(ALMOST_COMPLETE);
    const mode    = { value: { kind: "overview" } as Mode };
    const history: { passport: string }[] = [];
    sim_startContinue(missing, mode, history);
    assert.equal(history.length, 1);
    assert.deepEqual(history[0], { passport: "flow" });
  });

  it("does nothing when profile is already complete", () => {
    const missing = computeMissingSections(COMPLETE);
    const mode    = { value: { kind: "overview" } as Mode };
    const history: { passport: string }[] = [];
    sim_startContinue(missing, mode, history);
    assert.equal(mode.value.kind, "overview");
    assert.equal(history.length, 0);
  });

  it("queues multiple sections in ALL_SECTIONS order when several are missing", () => {
    const missing = computeMissingSections({ "style-personalities": ["casual-cool"] });
    const mode    = { value: { kind: "overview" } as Mode };
    const history: { passport: string }[] = [];
    sim_startContinue(missing, mode, history);
    const queue = (mode.value as { queue: SectionId[] }).queue;
    assert.ok(queue[0] === "direction", "first missing section should be direction");
    assert.ok(queue.includes("life"));
    assert.ok(queue.includes("fit"));
    assert.ok(queue.includes("colours"));
    assert.ok(queue.includes("wardrobe"));
    assert.ok(queue.includes("notes"));
    assert.ok(!queue.includes("identity"));
    assert.ok(!queue.includes("sizes"), "sizes (placeholder) must never appear in queue");
  });

  it("opens flow at notes — the Notes to nAia field has kind 'text'", () => {
    const missing = computeMissingSections(ALMOST_COMPLETE);
    const mode    = { value: { kind: "overview" } as Mode };
    sim_startContinue(missing, mode, []);
    const flow = mode.value as { queue: SectionId[]; index: number };
    const section = ALL_SECTIONS.find(s => s.id === flow.queue[flow.index])!;
    const primary = section.subFields[0];
    assert.equal(section.id, "notes");
    assert.equal(primary.kind, "text");
    assert.equal(primary.draftKey, "final-notes");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Update Answers button
// ─────────────────────────────────────────────────────────────────────────────

describe("Update Answers button", () => {
  it("transitions mode to picker", () => {
    const mode    = { value: { kind: "overview" } as Mode };
    const history: { passport: string }[] = [];
    sim_startUpdate(mode, history);
    assert.equal(mode.value.kind, "picker");
  });

  it("pushes a { passport: 'picker' } history entry when clicked", () => {
    const mode    = { value: { kind: "overview" } as Mode };
    const history: { passport: string }[] = [];
    sim_startUpdate(mode, history);
    assert.deepEqual(history[0], { passport: "picker" });
  });

  it("SECTIONS has exactly 7 named sections available in the picker", () => {
    assert.equal(SECTIONS.length, 7);
  });

  it("notes section is available via NOTES_SECTION (shown separately from the 7)", () => {
    assert.equal(NOTES_SECTION.id, "notes");
    assert.ok(!SECTIONS.some(s => s.id === "notes"));
  });

  it("selecting a section from picker starts a single-section flow", () => {
    const mode    = { value: { kind: "picker" } as Mode };
    const history: { passport: string }[] = [];
    sim_pickerSelect("identity", mode, history);
    assert.equal(mode.value.kind, "flow");
    assert.deepEqual((mode.value as { queue: SectionId[] }).queue, ["identity"]);
  });

  it("sizes can be selected from picker and opens flow (placeholder renders shell)", () => {
    const mode    = { value: { kind: "picker" } as Mode };
    const history: { passport: string }[] = [];
    sim_pickerSelect("sizes", mode, history);
    assert.equal(mode.value.kind, "flow");
    assert.deepEqual((mode.value as { queue: SectionId[] }).queue, ["sizes"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Browser Back button — popstate handler
// ─────────────────────────────────────────────────────────────────────────────

describe("browser back button (popstate handler)", () => {
  it("resets mode to overview when back pops null state", () => {
    const mode = { value: { kind: "flow", queue: ["notes" as SectionId], index: 0 } as Mode };
    sim_onPopState(null, mode);
    assert.equal(mode.value.kind, "overview");
  });

  it("resets mode to overview when back pops a non-passport state object", () => {
    const mode = { value: { kind: "flow", queue: ["notes" as SectionId], index: 0 } as Mode };
    sim_onPopState({}, mode);
    assert.equal(mode.value.kind, "overview");
  });

  it("resets mode to overview from picker on back", () => {
    const mode = { value: { kind: "picker" } as Mode };
    sim_onPopState({}, mode);
    assert.equal(mode.value.kind, "overview");
  });

  it("does NOT reset when back pops a passport-marked state", () => {
    const mode = { value: { kind: "flow", queue: ["notes" as SectionId], index: 0 } as Mode };
    sim_onPopState({ passport: "flow" }, mode);
    assert.equal(mode.value.kind, "flow");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// computeSectionPatch
// ─────────────────────────────────────────────────────────────────────────────

describe("computeSectionPatch — notes section (text kind)", () => {
  const notesDef = NOTES_SECTION;

  it("returns null when no text was typed (no change from empty saved)", () => {
    assert.equal(computeSectionPatch(notesDef, { "final-notes": "" }, {}), null);
  });

  it("returns a patch when new notes are entered", () => {
    assert.deepEqual(
      computeSectionPatch(notesDef, { "final-notes": "I prefer blazers" }, {}),
      { finalNotes: "I prefer blazers" },
    );
  });

  it("returns null when the typed text matches saved text", () => {
    assert.equal(
      computeSectionPatch(notesDef, { "final-notes": "Existing note" }, { "final-notes": "Existing note" }),
      null,
    );
  });

  it("returns a patch setting finalNotes to null when cleared", () => {
    assert.deepEqual(
      computeSectionPatch(notesDef, { "final-notes": "" }, { "final-notes": "Old note" }),
      { finalNotes: null },
    );
  });
});

describe("computeSectionPatch — array section (identity)", () => {
  const identityDef = SECTIONS.find(s => s.id === "identity")!;

  it("returns null when selection is unchanged", () => {
    assert.equal(
      computeSectionPatch(
        identityDef,
        { "style-personalities": ["minimal"], "desired-impression": ["refined"] },
        { "style-personalities": ["minimal"], "desired-impression": ["refined"] },
      ),
      null,
    );
  });

  it("returns patch when a selection changes", () => {
    const patch = computeSectionPatch(
      identityDef,
      { "style-personalities": ["edgy"], "desired-impression": ["refined"] },
      { "style-personalities": ["minimal"], "desired-impression": ["refined"] },
    );
    assert.ok(patch !== null);
    assert.deepEqual((patch as Record<string, unknown>).stylePersonalities, ["edgy"]);
  });

  it("treats order differences as equal (set semantics)", () => {
    assert.equal(
      computeSectionPatch(
        identityDef,
        { "style-personalities": ["edgy", "minimal"], "desired-impression": ["refined"] },
        { "style-personalities": ["minimal", "edgy"], "desired-impression": ["refined"] },
      ),
      null,
    );
  });
});

describe("computeSectionPatch — single kind (fit.structure)", () => {
  const fitDef = SECTIONS.find(s => s.id === "fit")!;

  it("returns patch when structure changes from null to a value", () => {
    const patch = computeSectionPatch(
      fitDef,
      { silhouette: ["straight"], structure: "soft-fluid", "coverage-preferences": [] },
      { silhouette: ["straight"] },
    );
    assert.ok(patch !== null);
    assert.equal((patch as Record<string, unknown>).structure, "soft-fluid");
  });

  it("returns null when structure is unchanged", () => {
    assert.equal(
      computeSectionPatch(
        fitDef,
        { silhouette: ["straight"], structure: "soft-fluid", "coverage-preferences": [] },
        { silhouette: ["straight"], structure: "soft-fluid", "coverage-preferences": [] },
      ),
      null,
    );
  });

  it("returns patch setting structure to null when cleared", () => {
    const patch = computeSectionPatch(
      fitDef,
      { silhouette: ["straight"], structure: "", "coverage-preferences": [] },
      { silhouette: ["straight"], structure: "soft-fluid", "coverage-preferences": [] },
    );
    assert.ok(patch !== null);
    assert.equal((patch as Record<string, unknown>).structure, null);
  });
});

describe("computeSectionPatch — colours section (legacy interaction)", () => {
  const coloursDef = SECTIONS.find(s => s.id === "colours")!;

  it("detects change when legacy IDs were stripped in initEdits", () => {
    // savedRaw has prints; initEdits produces [] (stripped); patch detects change
    const patch = computeSectionPatch(
      coloursDef,
      { "favorite-colors": [], "avoid-colors": [], "neutral-vs-colour": "", "colour-intensity": "", "print-appetite": "" },
      { "favorite-colors": ["prints"], "avoid-colors": [] },
    );
    assert.ok(patch !== null);
    assert.deepEqual((patch as Record<string, unknown>).favoriteColors, []);
  });

  it("no change when non-legacy values are the same after initEdits", () => {
    assert.equal(
      computeSectionPatch(
        coloursDef,
        { "favorite-colors": ["black"], "avoid-colors": [], "neutral-vs-colour": "", "colour-intensity": "", "print-appetite": "" },
        { "favorite-colors": ["black"], "avoid-colors": [], "neutral-vs-colour": "", "colour-intensity": "", "print-appetite": "" },
      ),
      null,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// initEdits — legacy stripping on the colours section
// ─────────────────────────────────────────────────────────────────────────────

describe("initEdits — legacy colour stripping", () => {
  const coloursDef = SECTIONS.find(s => s.id === "colours")!;

  it("strips 'prints' from favorite-colors draft", () => {
    const edits = initEdits(coloursDef, { "favorite-colors": ["prints", "black"] });
    assert.ok(!(edits["favorite-colors"] as string[]).includes("prints"));
  });

  it("strips 'colorful' from favorite-colors draft", () => {
    const edits = initEdits(coloursDef, { "favorite-colors": ["colorful", "black"] });
    assert.ok(!(edits["favorite-colors"] as string[]).includes("colorful"));
  });

  it("preserves non-legacy colors in favorite-colors draft", () => {
    const edits = initEdits(coloursDef, { "favorite-colors": ["prints", "black", "navy"] });
    assert.deepEqual((edits["favorite-colors"] as string[]).sort(), ["black", "navy"]);
  });

  it("does NOT strip legacy IDs from avoid-colors (only favorite-colors needs stripping)", () => {
    const edits = initEdits(coloursDef, { "avoid-colors": ["prints", "black"] });
    assert.ok((edits["avoid-colors"] as string[]).includes("prints"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// handleToggle — mutual exclusion between favourite and avoided colours
// ─────────────────────────────────────────────────────────────────────────────

describe("handleToggle — mutual exclusion for colour pickers", () => {
  it("adding a colour to favorites removes it from avoidColors", () => {
    let edits: Record<string, unknown> = {
      "favorite-colors": [],
      "avoid-colors": ["red-burgundy"],
    };
    edits = handleToggle(edits, "favorite-colors", "red-burgundy", 5, "avoid-colors");
    assert.ok((edits["favorite-colors"] as string[]).includes("red-burgundy"));
    assert.ok(!(edits["avoid-colors"] as string[]).includes("red-burgundy"));
  });

  it("adding a colour to avoidColors removes it from favorites", () => {
    let edits: Record<string, unknown> = {
      "favorite-colors": ["black"],
      "avoid-colors": [],
    };
    edits = handleToggle(edits, "avoid-colors", "black", 5, "favorite-colors");
    assert.ok((edits["avoid-colors"] as string[]).includes("black"));
    assert.ok(!(edits["favorite-colors"] as string[]).includes("black"));
  });

  it("clicking a selected option deselects it (toggle off)", () => {
    let edits: Record<string, unknown> = { "favorite-colors": ["black"] };
    edits = handleToggle(edits, "favorite-colors", "black", 5);
    assert.ok(!(edits["favorite-colors"] as string[]).includes("black"));
  });

  it("does not add when at capacity", () => {
    let edits: Record<string, unknown> = { "favorite-colors": ["a", "b", "c", "d", "e"] };
    edits = handleToggle(edits, "favorite-colors", "new-color", 5);
    assert.equal((edits["favorite-colors"] as string[]).length, 5);
  });
});
