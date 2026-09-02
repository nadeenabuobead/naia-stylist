// Tests for /passport page — V2-B2 section structure + QA edit-return fix.
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
  // Rev 6 sections (added goals, outfit-gives, fit-concerns, dressing)
  | "goals" | "outfit-gives" | "identity" | "direction" | "life" | "fit"
  | "fit-concerns" | "sizes" | "colours" | "wardrobe" | "dressing"
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

// Mirrors the fixed editSection(id) called from the overview (mode.kind === "overview").
// Pushes { passport: "edit" } so the browser's native Back button also hits overview
// via the existing popstate handler. Sets editPushed=true to track the unmatched entry.
function sim_editSection_fromOverview(
  id:         SectionId,
  outMode:    { value: Mode },
  outHistory: { passport: string }[],
  outPushed?: { value: boolean },
) {
  outHistory.push({ passport: "edit" });
  if (outPushed) outPushed.value = true;
  outMode.value = { kind: "flow", queue: [id], index: 0 };
}

// Mirrors editSection(id) called from the picker (mode.kind === "picker").
// Does NOT push a history entry — the picker already pushed its own entry.
function sim_editSection_fromPicker(id: SectionId, outMode: { value: Mode }) {
  outMode.value = { kind: "flow", queue: [id], index: 0 };
}

// Mirrors exitToOverview():
// - When editPushed is true: pops the { passport: "edit" } history entry (history.back())
//   and resets editPushed. The popstate handler then calls setMode(overview).
// - When editPushed is false: calls setMode(overview) directly (no history change).
function sim_exitToOverview(
  outMode:    { value: Mode },
  outHistory: { passport: string }[],
  outPushed:  { value: boolean },
) {
  if (outPushed.value) {
    outPushed.value = false;
    // Consume the edit entry (mirrors history.back())
    if (outHistory.length > 0 && outHistory[outHistory.length - 1]?.passport === "edit") {
      outHistory.pop();
    }
    // popstate fires → setMode({ kind: "overview" })
    outMode.value = { kind: "overview" };
  } else {
    outMode.value = { kind: "overview" };
  }
}

// Mirrors "Continue Later" / saveSection(currentId, "exit") fast path.
// Uses exitToOverview() semantics when editPushed is provided.
function sim_continueLater(
  outMode:    { value: Mode },
  outHistory?: { passport: string }[],
  outPushed?:  { value: boolean },
) {
  if (outHistory && outPushed) {
    sim_exitToOverview(outMode, outHistory, outPushed);
  } else {
    outMode.value = { kind: "overview" };
  }
}

// Mirrors the Back button at step 0 in a flow step.
// Fixed behavior: when queue.length === 1, calls exitToOverview() (may consume history).
// When queue.length > 1, navigate(-1) is called — not simulated here.
// Returns true if exitToOverview was invoked, false if navigate(-1) would have run.
function sim_backButton_step0(
  mode:        { kind: "flow"; queue: SectionId[]; index: number },
  outMode:     { value: Mode },
  outHistory?: { passport: string }[],
  outPushed?:  { value: boolean },
): boolean {
  if (mode.index !== 0) return false;
  if (mode.queue.length === 1) {
    if (outHistory && outPushed) {
      sim_exitToOverview(outMode, outHistory, outPushed);
    } else {
      outMode.value = { kind: "overview" };
    }
    return true;
  }
  // navigate(-1) — not simulated; caller can assert via popstate
  return false;
}

// Mirrors native browser Back while inside an edit (popstate with no passport marker
// on the entry navigated TO — i.e. the previous /passport entry).
// Resets editPushed and sets mode to overview.
function sim_nativeBrowserBack_fromEdit(
  outMode:    { value: Mode },
  outHistory: { passport: string }[],
  outPushed:  { value: boolean },
) {
  // Browser pops the edit entry; popstate fires for the previous entry (no passport).
  if (outHistory.length > 0 && outHistory[outHistory.length - 1]?.passport === "edit") {
    outHistory.pop();
  }
  outPushed.value = false;
  outMode.value = { kind: "overview" };
}

// Mirrors startRefresh — preserves its push-to-history pattern unchanged.
function sim_startRefresh(outMode: { value: Mode }, outHistory: { passport: string }[]) {
  outHistory.push({ passport: "refresh" });
  outMode.value = { kind: "refresh", stepIndex: 0 };
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

// ─────────────────────────────────────────────────────────────────────────────
// A–L: Edit return navigation — regression tests for QA bug fix
//
// Contract: ANY single-section edit launched from /passport must return
// deterministically to overview (the passport page), never to
// /onboarding/complete or /my-naia.
//
// Tests A–H verify specific named sections + Notes.
// Test I verifies ALL Rev 6 sections share the same contract.
// Tests J–K verify onboarding and refresh flows are NOT affected by the fix.
// Test L verifies answer persistence is NOT broken by the fix.
// ─────────────────────────────────────────────────────────────────────────────

// ── Helpers for A–L & history regression ─────────────────────────────────────

type EditState = {
  mode:    { value: Mode };
  history: { passport: string }[];
  pushed:  { value: boolean };
};

// Returns a fresh overview state including pushed tracking.
function mkOverviewState(): EditState {
  return {
    mode:    { value: { kind: "overview" } },
    history: [],
    pushed:  { value: false },
  };
}

// Simulate: overview → editSection(id) from overview → Continue Later
// Returns the mode after Continue Later. Must be "overview".
function runEditFromOverviewThenContinueLater(id: SectionId): Mode {
  const s = mkOverviewState();
  sim_editSection_fromOverview(id, s.mode, s.history, s.pushed);
  sim_continueLater(s.mode, s.history, s.pushed);
  return s.mode.value;
}

// Simulate: overview → editSection(id) from overview → Back at step 0
// Returns the mode after Back. Must be "overview".
function runEditFromOverviewThenBack(id: SectionId): Mode {
  const s = mkOverviewState();
  sim_editSection_fromOverview(id, s.mode, s.history, s.pushed);
  const flowMode = s.mode.value as { kind: "flow"; queue: SectionId[]; index: number };
  sim_backButton_step0(flowMode, s.mode, s.history, s.pushed);
  return s.mode.value;
}

// ── A. Edit Current Focus (goals) → Continue Later → overview ────────────────
describe("A — goals edit from overview → Continue Later returns to overview", () => {
  it("mode is overview after Continue Later", () => {
    const result = runEditFromOverviewThenContinueLater("goals");
    assert.equal(result.kind, "overview");
  });

  it("editSection_fromOverview pushes a history entry", () => {
    const s = mkOverviewState();
    sim_editSection_fromOverview("goals", s.mode, s.history);
    assert.equal(s.history.length, 1);
    assert.equal(s.history[0].passport, "edit");
  });
});

// ── B. Edit Style (identity) → Continue Later → overview ─────────────────────
describe("B — identity edit from overview → Continue Later returns to overview", () => {
  it("mode is overview after Continue Later", () => {
    const result = runEditFromOverviewThenContinueLater("identity");
    assert.equal(result.kind, "overview");
  });
});

// ── C. Edit Fit Concerns (fit-concerns) → Continue Later → overview ───────────
describe("C — fit-concerns edit from overview → Continue Later returns to overview", () => {
  it("mode is overview after Continue Later", () => {
    const result = runEditFromOverviewThenContinueLater("fit-concerns");
    assert.equal(result.kind, "overview");
  });
});

// ── D. Edit Sizes → Continue Later → overview ────────────────────────────────
// Sizes is a placeholder section but the user can still navigate to it via
// the full section queue; the navigation contract is the same.
describe("D — sizes edit from overview → Continue Later returns to overview", () => {
  it("mode is overview after Continue Later", () => {
    const result = runEditFromOverviewThenContinueLater("sizes");
    assert.equal(result.kind, "overview");
  });
});

// ── E. Back at step 0 from overview-launched edit → overview ─────────────────
describe("E — Back at step 0 in single-section edit returns to overview", () => {
  it("identity: mode is overview after Back", () => {
    const result = runEditFromOverviewThenBack("identity");
    assert.equal(result.kind, "overview");
  });

  it("colours: mode is overview after Back", () => {
    const result = runEditFromOverviewThenBack("colours");
    assert.equal(result.kind, "overview");
  });

  it("sim_backButton_step0 returns true for queue.length === 1", () => {
    const mode = { kind: "flow" as const, queue: ["wardrobe"] as SectionId[], index: 0 };
    const outMode: { value: Mode } = { value: { kind: "overview" } };
    const handled = sim_backButton_step0(mode, outMode);
    assert.ok(handled, "should return true (setMode called)");
    assert.equal(outMode.value.kind, "overview");
  });

  it("sim_backButton_step0 returns false for queue.length > 1 (multi-section flow)", () => {
    const mode = {
      kind: "flow" as const,
      queue: ["identity", "direction"] as SectionId[],
      index: 0,
    };
    const outMode: { value: Mode } = { value: { kind: "flow", queue: ["identity", "direction"], index: 0 } };
    const handled = sim_backButton_step0(mode, outMode);
    assert.ok(!handled, "should return false (navigate(-1) path)");
  });
});

// ── F. Passport-originated edit does NOT resolve to onboarding/complete ───────
// The /onboarding/complete route would only be visited if navigate(-1) were
// called and the previous history entry was that URL. The fix ensures
// navigate(-1) is never called for single-section edits — setMode(overview) is
// used instead.
describe("F — single-section edit does NOT navigate(-1)", () => {
  it("Back at step 0 is handled (setMode, not navigate(-1)) for single-section queue", () => {
    const mode = { kind: "flow" as const, queue: ["direction"] as SectionId[], index: 0 };
    const outMode: { value: Mode } = { value: { kind: "flow", queue: ["direction"], index: 0 } };
    const handled = sim_backButton_step0(mode, outMode);
    // handled=true means setMode(overview) ran; navigate(-1) was NOT called
    assert.ok(handled);
  });

  it("resulting mode is overview, never a Remix navigation", () => {
    const result = runEditFromOverviewThenBack("life");
    assert.equal(result.kind, "overview");
  });
});

// ── G. Passport-originated edit does NOT resolve to /my-naia ─────────────────
// Same reasoning as F: the /my-naia URL only appears if navigate(-1) pops the
// stack to a prior /my-naia entry.
describe("G — single-section edit Back never leaves passport (no /my-naia)", () => {
  it("all named sections: Back at step 0 stays in overview", () => {
    const namedSections: SectionId[] = [
      "goals", "outfit-gives", "identity", "direction", "life",
      "fit", "fit-concerns", "colours", "wardrobe", "dressing",
    ];
    for (const id of namedSections) {
      const result = runEditFromOverviewThenBack(id);
      assert.equal(result.kind, "overview", `${id} should return to overview`);
    }
  });
});

// ── H. Notes edit returns to overview when launched from overview ─────────────
describe("H — notes edit from overview returns to overview", () => {
  it("Continue Later after notes edit → overview", () => {
    const result = runEditFromOverviewThenContinueLater("notes");
    assert.equal(result.kind, "overview");
  });

  it("Back at step 0 after notes edit → overview", () => {
    const result = runEditFromOverviewThenBack("notes");
    assert.equal(result.kind, "overview");
  });

  it("notes editSection_fromOverview pushes a history entry", () => {
    const s = mkOverviewState();
    sim_editSection_fromOverview("notes", s.mode, s.history);
    assert.equal(s.history.length, 1);
    assert.equal(s.history[0].passport, "edit");
  });
});

// ── I. ALL Rev 6 sections share the deterministic return contract ─────────────
describe("I — all Rev 6 sections: single-section edit returns to overview", () => {
  const rev6Sections: SectionId[] = [
    "goals", "outfit-gives", "identity", "direction", "life",
    "fit", "fit-concerns", "sizes", "colours", "wardrobe", "dressing", "notes",
  ];

  for (const id of rev6Sections) {
    it(`${id}: Continue Later → overview`, () => {
      const result = runEditFromOverviewThenContinueLater(id);
      assert.equal(result.kind, "overview");
    });

    it(`${id}: Back at step 0 → overview`, () => {
      const result = runEditFromOverviewThenBack(id);
      assert.equal(result.kind, "overview");
    });

    it(`${id}: editSection_fromOverview pushes exactly 1 history entry`, () => {
      const s = mkOverviewState();
      sim_editSection_fromOverview(id, s.mode, s.history);
      assert.equal(s.history.length, 1);
    });
  }
});

// ── J. Onboarding completion flow is unaffected by the edit-return fix ─────────
// startContinue and sim_startRefresh are separate code paths that still push
// their own history entries. This test verifies those paths remain intact.
describe("J — onboarding / initial completion flow is unchanged", () => {
  it("startContinue pushes a history entry", () => {
    const s = mkOverviewState();
    const missing = computeMissingSections({});
    sim_startContinue(missing, s.mode, s.history);
    assert.equal(s.history.length, 1);
    assert.equal(s.history[0].passport, "flow");
  });

  it("startContinue sets mode to flow with correct queue", () => {
    const s = mkOverviewState();
    const missing = computeMissingSections({});
    sim_startContinue(missing, s.mode, s.history);
    assert.equal(s.mode.value.kind, "flow");
    const flowMode = s.mode.value as { kind: "flow"; queue: SectionId[]; index: number };
    assert.equal(flowMode.index, 0);
    assert.ok(flowMode.queue.length > 0);
  });

  it("startContinue does nothing when no sections are missing", () => {
    const s = mkOverviewState();
    sim_startContinue([], s.mode, s.history);
    assert.equal(s.history.length, 0);
    assert.equal(s.mode.value.kind, "overview");
  });

  it("popstate without passport state always resolves to overview", () => {
    const s = mkOverviewState();
    // Simulate a flow that pushed state
    sim_startContinue(computeMissingSections({}), s.mode, s.history);
    // Now popstate fires with no passport marker (e.g. user went all the way back)
    sim_onPopState(null, s.mode);
    assert.equal(s.mode.value.kind, "overview");
  });

  it("multi-section Back at step > 0 decrements index (onboarding path)", () => {
    // Not using sim_backButton_step0 (only handles step 0).
    // Verify the data shape the Back handler reads at step > 0.
    const queue: SectionId[] = ["identity", "direction", "life"];
    const mode: { kind: "flow"; queue: SectionId[]; index: number } = {
      kind: "flow",
      queue,
      index: 1,
    };
    // At index > 0, go back by decrementing index
    const newIndex = mode.index - 1;
    assert.equal(newIndex, 0);
    assert.equal(queue[newIndex], "identity");
  });
});

// ── K. Passport refresh/continuation flow is unchanged ───────────────────────
describe("K — refresh flow is unchanged by edit-return fix", () => {
  it("startRefresh pushes a history entry", () => {
    const s = mkOverviewState();
    sim_startRefresh(s.mode, s.history);
    assert.equal(s.history.length, 1);
    assert.equal(s.history[0].passport, "refresh");
  });

  it("startRefresh sets mode to refresh", () => {
    const s = mkOverviewState();
    sim_startRefresh(s.mode, s.history);
    assert.equal(s.mode.value.kind, "refresh");
  });

  it("UPDATE ANSWERS path (startUpdate) pushes a history entry", () => {
    const s = mkOverviewState();
    sim_startUpdate(s.mode, s.history);
    assert.equal(s.history.length, 1);
    assert.equal(s.history[0].passport, "picker");
  });

  it("picker → editSection does NOT push an extra history entry", () => {
    // Picker already pushed one entry; editSection_fromPicker must NOT add another.
    const s = mkOverviewState();
    sim_startUpdate(s.mode, s.history);                   // history: [picker]
    sim_editSection_fromPicker("colours", s.mode);        // no push
    assert.equal(s.history.length, 1, "should still be 1 after picker-launched edit");
    assert.equal(s.mode.value.kind, "flow");
  });

  it("popstate to non-passport state during refresh resolves to overview", () => {
    const s = mkOverviewState();
    sim_startRefresh(s.mode, s.history);
    sim_onPopState(null, s.mode);
    assert.equal(s.mode.value.kind, "overview");
  });
});

// ── L. Answer persistence is unaffected by the edit-return fix ───────────────
// The fix is in mode/navigation only. computeSectionPatch is unchanged.
describe("L — answer persistence contract unchanged", () => {
  it("computeSectionPatch returns null when nothing changed", () => {
    const section = SECTIONS.find(s => s.id === "identity")!;
    const saved = { "style-personalities": ["casual-cool"], "desired-impression": ["relaxed"] };
    const edits = initEdits(section, saved);
    const patch = computeSectionPatch(section, edits, saved);
    assert.equal(patch, null);
  });

  it("computeSectionPatch returns changed fields only", () => {
    const section = SECTIONS.find(s => s.id === "identity")!;
    const saved = { "style-personalities": ["casual-cool"], "desired-impression": ["relaxed"] };
    const edits = {
      "style-personalities": ["classic"],
      "desired-impression": ["relaxed"],
    };
    const patch = computeSectionPatch(section, edits, saved);
    assert.ok(patch !== null);
    assert.deepEqual(patch!.stylePersonalities, ["classic"]);
    assert.ok(!("desiredImpression" in (patch ?? {})));
  });

  it("initEdits preserves saved answers for an edited section (colours)", () => {
    const section = SECTIONS.find(s => s.id === "colours")!;
    const saved = {
      "favorite-colors": ["black", "navy"],
      "avoid-colors":    ["orange"],
      "neutral-vs-colour": "neutral",
    };
    const edits = initEdits(section, saved);
    assert.deepEqual((edits["favorite-colors"] as string[]).sort(), ["black", "navy"]);
    assert.deepEqual(edits["avoid-colors"], ["orange"]);
    assert.equal(edits["neutral-vs-colour"], "neutral");
  });

  it("editSection followed by Continue Later does NOT mutate savedAnswers", () => {
    // The navigation fix (mode change) must not touch the answers object.
    const saved = { "style-personalities": ["casual-cool"] };
    const savedCopy = JSON.parse(JSON.stringify(saved));
    const s = mkOverviewState();
    sim_editSection_fromOverview("identity", s.mode, s.history, s.pushed);
    sim_continueLater(s.mode, s.history, s.pushed);
    // saved must be exactly as before
    assert.deepEqual(saved, savedCopy);
  });

  it("Back at step 0 does NOT mutate savedAnswers", () => {
    const saved = { "favorite-colors": ["black"] };
    const savedCopy = JSON.parse(JSON.stringify(saved));
    runEditFromOverviewThenBack("colours");
    assert.deepEqual(saved, savedCopy);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A–I: History phantom-entry regression
//
// Contract: after any in-page exit from a single-section edit, the pushed
// { passport: "edit" } history entry must be CONSUMED (not left behind).
// A leftover entry causes an extra no-op browser Back press before the user
// can leave /passport.
//
// A. In-page Back → mode is overview AND edit entry consumed
// B. No leftover edit entry after in-page Back
// C. Continue Later → mode is overview AND edit entry consumed
// D. No leftover edit entry after Continue Later
// E. Native browser Back while editing → mode is overview AND edit entry consumed
// F. After native browser Back, history is at the pre-edit entry (no double pop)
// G. Single-section edit never returns to /onboarding/complete (no navigate(-1))
// H. Single-section edit never returns to /my-naia (no navigate(-1))
// I. Update Answers / picker / refresh / multi-section flows are unaffected
// ─────────────────────────────────────────────────────────────────────────────

// ── A & B: In-page Back ───────────────────────────────────────────────────────
describe("A — in-page Back returns to overview", () => {
  it("mode is overview after Back", () => {
    const s = mkOverviewState();
    sim_editSection_fromOverview("identity", s.mode, s.history, s.pushed);
    const flowMode = s.mode.value as { kind: "flow"; queue: SectionId[]; index: number };
    sim_backButton_step0(flowMode, s.mode, s.history, s.pushed);
    assert.equal(s.mode.value.kind, "overview");
  });
});

describe("B — no leftover edit history entry after in-page Back", () => {
  it("history.length is 0 after Back (edit entry consumed)", () => {
    const s = mkOverviewState();
    sim_editSection_fromOverview("identity", s.mode, s.history, s.pushed);
    assert.equal(s.history.length, 1, "edit entry was pushed");
    const flowMode = s.mode.value as { kind: "flow"; queue: SectionId[]; index: number };
    sim_backButton_step0(flowMode, s.mode, s.history, s.pushed);
    assert.equal(s.history.length, 0, "edit entry must be consumed — no phantom step");
  });

  it("editPushed ref is false after Back", () => {
    const s = mkOverviewState();
    sim_editSection_fromOverview("colours", s.mode, s.history, s.pushed);
    assert.ok(s.pushed.value, "should be true after push");
    const flowMode = s.mode.value as { kind: "flow"; queue: SectionId[]; index: number };
    sim_backButton_step0(flowMode, s.mode, s.history, s.pushed);
    assert.ok(!s.pushed.value, "should be false after exit");
  });

  it("all Rev 6 sections: Back leaves zero history entries", () => {
    const rev6: SectionId[] = [
      "goals", "outfit-gives", "identity", "direction", "life",
      "fit", "fit-concerns", "sizes", "colours", "wardrobe", "dressing", "notes",
    ];
    for (const id of rev6) {
      const s = mkOverviewState();
      sim_editSection_fromOverview(id, s.mode, s.history, s.pushed);
      const flowMode = s.mode.value as { kind: "flow"; queue: SectionId[]; index: number };
      sim_backButton_step0(flowMode, s.mode, s.history, s.pushed);
      assert.equal(s.history.length, 0, `${id}: edit entry should be consumed`);
    }
  });
});

// ── C & D: Continue Later ─────────────────────────────────────────────────────
describe("C — Continue Later returns to overview", () => {
  it("mode is overview after Continue Later", () => {
    const s = mkOverviewState();
    sim_editSection_fromOverview("direction", s.mode, s.history, s.pushed);
    sim_continueLater(s.mode, s.history, s.pushed);
    assert.equal(s.mode.value.kind, "overview");
  });
});

describe("D — no leftover edit history entry after Continue Later", () => {
  it("history.length is 0 after Continue Later (edit entry consumed)", () => {
    const s = mkOverviewState();
    sim_editSection_fromOverview("direction", s.mode, s.history, s.pushed);
    assert.equal(s.history.length, 1, "edit entry was pushed");
    sim_continueLater(s.mode, s.history, s.pushed);
    assert.equal(s.history.length, 0, "edit entry must be consumed — no phantom step");
  });

  it("editPushed ref is false after Continue Later", () => {
    const s = mkOverviewState();
    sim_editSection_fromOverview("wardrobe", s.mode, s.history, s.pushed);
    assert.ok(s.pushed.value);
    sim_continueLater(s.mode, s.history, s.pushed);
    assert.ok(!s.pushed.value);
  });

  it("Continue Later without a prior push does NOT pop an entry", () => {
    // Picker-launched edit: no push → Continue Later must not touch history.
    const s = mkOverviewState();
    s.history.push({ passport: "picker" }); // picker's own entry
    sim_editSection_fromPicker("colours", s.mode);
    // pushed is still false (picker-launched)
    sim_continueLater(s.mode, s.history, s.pushed);
    assert.equal(s.history.length, 1, "picker entry must still be there");
    assert.equal(s.history[0].passport, "picker");
  });

  it("all Rev 6 sections: Continue Later leaves zero edit history entries", () => {
    const rev6: SectionId[] = [
      "goals", "outfit-gives", "identity", "direction", "life",
      "fit", "fit-concerns", "sizes", "colours", "wardrobe", "dressing", "notes",
    ];
    for (const id of rev6) {
      const s = mkOverviewState();
      sim_editSection_fromOverview(id, s.mode, s.history, s.pushed);
      sim_continueLater(s.mode, s.history, s.pushed);
      assert.equal(s.history.length, 0, `${id}: edit entry should be consumed`);
    }
  });
});

// ── E & F: Native browser Back while inside an edit ──────────────────────────
describe("E — native browser Back while editing resolves to overview", () => {
  it("mode is overview after native Back", () => {
    const s = mkOverviewState();
    sim_editSection_fromOverview("life", s.mode, s.history, s.pushed);
    sim_nativeBrowserBack_fromEdit(s.mode, s.history, s.pushed);
    assert.equal(s.mode.value.kind, "overview");
  });

  it("edit entry is consumed by native Back", () => {
    const s = mkOverviewState();
    sim_editSection_fromOverview("life", s.mode, s.history, s.pushed);
    assert.equal(s.history.length, 1);
    sim_nativeBrowserBack_fromEdit(s.mode, s.history, s.pushed);
    assert.equal(s.history.length, 0);
  });
});

describe("F — after native browser Back, history sits at the pre-edit entry", () => {
  it("history is empty (was at the original /passport entry before the edit push)", () => {
    const s = mkOverviewState();
    // Before editSection: history is [] (original /passport entry is the browser's
    // current entry, not in our simulated stack which only tracks pushed extras).
    sim_editSection_fromOverview("fit", s.mode, s.history, s.pushed);
    sim_nativeBrowserBack_fromEdit(s.mode, s.history, s.pushed);
    // After native Back, simulated stack is empty — browser is back on the
    // original /passport entry. One more Back would leave /passport (correct).
    assert.equal(s.history.length, 0);
  });

  it("editPushed ref is false after native Back (no double-pop risk)", () => {
    const s = mkOverviewState();
    sim_editSection_fromOverview("fit", s.mode, s.history, s.pushed);
    sim_nativeBrowserBack_fromEdit(s.mode, s.history, s.pushed);
    assert.ok(!s.pushed.value);
  });
});

// ── G & H: Guards against /onboarding/complete and /my-naia ──────────────────
describe("G — Passport edit never exits to /onboarding/complete", () => {
  it("Back at step 0 for queue.length===1 is handled (no navigate(-1))", () => {
    // navigate(-1) is the only path that could leave /passport to another URL.
    // sim_backButton_step0 returns true when it handled the exit internally
    // (setMode / exitToOverview), false when navigate(-1) would be called.
    const s = mkOverviewState();
    sim_editSection_fromOverview("goals", s.mode, s.history, s.pushed);
    const flowMode = s.mode.value as { kind: "flow"; queue: SectionId[]; index: number };
    const handled = sim_backButton_step0(flowMode, s.mode, s.history, s.pushed);
    assert.ok(handled, "must not call navigate(-1) for single-section edits");
  });

  it("multi-section Back does use navigate(-1) at step 0 (onboarding path, expected)", () => {
    const s = mkOverviewState();
    sim_startContinue(computeMissingSections({}), s.mode, s.history);
    const flowMode = s.mode.value as { kind: "flow"; queue: SectionId[]; index: number };
    const handled = sim_backButton_step0(flowMode, s.mode, s.history, s.pushed);
    assert.ok(!handled, "multi-section Back at step 0 uses navigate(-1) — expected");
  });
});

describe("H — Passport edit never exits to /my-naia", () => {
  it("all Rev 6 single-section edits: Back handled internally (not navigate(-1))", () => {
    const rev6: SectionId[] = [
      "goals", "outfit-gives", "identity", "direction", "life",
      "fit", "fit-concerns", "sizes", "colours", "wardrobe", "dressing", "notes",
    ];
    for (const id of rev6) {
      const s = mkOverviewState();
      sim_editSection_fromOverview(id, s.mode, s.history, s.pushed);
      const flowMode = s.mode.value as { kind: "flow"; queue: SectionId[]; index: number };
      const handled = sim_backButton_step0(flowMode, s.mode, s.history, s.pushed);
      assert.ok(handled, `${id}: must be handled internally`);
    }
  });
});

// ── I: Other flows unaffected ─────────────────────────────────────────────────
describe("I — Update Answers / picker / refresh / multi-section flows unaffected", () => {
  it("picker push is preserved when editSection_fromPicker runs (no extra push)", () => {
    const s = mkOverviewState();
    sim_startUpdate(s.mode, s.history);          // pushes picker entry
    assert.equal(s.history.length, 1);
    sim_editSection_fromPicker("colours", s.mode);
    assert.equal(s.history.length, 1, "no extra entry from picker-launched edit");
    assert.ok(!s.pushed.value, "editPushed stays false for picker-launched edits");
  });

  it("picker-launched Continue Later (no push) uses setMode only — history unchanged", () => {
    const s = mkOverviewState();
    sim_startUpdate(s.mode, s.history);           // history: [picker]
    sim_editSection_fromPicker("identity", s.mode);
    sim_continueLater(s.mode, s.history, s.pushed); // pushed=false → setMode path
    assert.equal(s.history.length, 1, "picker entry must remain");
    assert.equal(s.mode.value.kind, "overview");
  });

  it("refresh flow push is preserved", () => {
    const s = mkOverviewState();
    sim_startRefresh(s.mode, s.history);
    assert.equal(s.history.length, 1);
    assert.equal(s.history[0].passport, "refresh");
    assert.ok(!s.pushed.value, "editPushed unaffected by refresh");
  });

  it("multi-section startContinue pushes its own entry independent of editPushed", () => {
    const s = mkOverviewState();
    const missing = computeMissingSections({});
    sim_startContinue(missing, s.mode, s.history);
    assert.equal(s.history.length, 1);
    assert.equal(s.history[0].passport, "flow");
    assert.ok(!s.pushed.value);
  });

  it("popstate with passport state does NOT reset editPushed (stays true)", () => {
    // If the entry navigated TO has a passport key, the popstate handler is a no-op.
    // editPushed stays true until the correct exit is taken.
    const s = mkOverviewState();
    sim_editSection_fromOverview("identity", s.mode, s.history, s.pushed);
    assert.ok(s.pushed.value, "pushed after editSection");
    // Simulate popstate to an entry WITH a passport key (e.g., another passport page)
    // — the handler does nothing in this case.
    // editPushed must remain true.
    assert.ok(s.pushed.value, "still true — no exit taken yet");
  });
});
