// Tests for /passport page — Phase 0 button fix.
//
// Uses node:test + tsx/esm (same runner as the rest of the project).
// No DOM or Prisma required — we test the pure state-machine logic that
// backs each button, reimplemented here from passport.tsx so we can import
// without pulling in react-router server APIs.
//
// Run: node --test --import tsx/esm app/routes/passport.test.ts

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

// ─────────────────────────────────────────────────────────────────────────────
// Types & data structures mirrored from passport.tsx
// ─────────────────────────────────────────────────────────────────────────────

type SectionId = "identity" | "feelings" | "life" | "wardrobe" | "colours" | "notes";
type FieldKind  = "array" | "color" | "text";

interface SubField {
  draftKey: string;
  apiKey:   string;
  kind:     FieldKind;
}

interface SectionDef {
  id:        SectionId;
  subFields: SubField[];
}

type Mode =
  | { kind: "overview" }
  | { kind: "picker" }
  | { kind: "flow"; queue: SectionId[]; index: number };

const SECTIONS: SectionDef[] = [
  { id: "identity", subFields: [
    { draftKey: "style-personalities", apiKey: "stylePersonalities", kind: "array" },
    { draftKey: "desired-impression",  apiKey: "desiredImpression",  kind: "array" },
  ]},
  { id: "feelings", subFields: [
    { draftKey: "desired-feelings", apiKey: "desiredFeelings", kind: "array" },
    { draftKey: "becoming",         apiKey: "becoming",        kind: "array" },
  ]},
  { id: "life", subFields: [
    { draftKey: "lifestyle",       apiKey: "lifestyle",      kind: "array" },
    { draftKey: "fit-preferences", apiKey: "fitPreferences", kind: "array" },
  ]},
  { id: "wardrobe", subFields: [
    { draftKey: "wardrobe-disconnection", apiKey: "styleStruggles", kind: "array" },
    { draftKey: "style-support",          apiKey: "styleSupport",   kind: "array" },
  ]},
  { id: "colours", subFields: [
    { draftKey: "favorite-colors", apiKey: "favoriteColors", kind: "color" },
    { draftKey: "avoid-colors",    apiKey: "avoidColors",    kind: "color" },
  ]},
  { id: "notes", subFields: [
    { draftKey: "final-notes", apiKey: "finalNotes", kind: "text" },
  ]},
];

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers (mirrored from passport.tsx)
// ─────────────────────────────────────────────────────────────────────────────

function computeMissingSections(savedAnswers: Record<string, unknown>): SectionDef[] {
  return SECTIONS.filter(s => {
    const primary = s.subFields[0];
    const v = savedAnswers[primary.draftKey];
    return primary.kind === "text"
      ? !v || (typeof v === "string" && !v.trim())
      : !Array.isArray(v) || (v as string[]).length === 0;
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
  edits: Record<string, unknown>,
  saved: Record<string, unknown>,
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
    } else {
      const edited  = Array.isArray(editedRaw) ? editedRaw as string[] : [];
      const current = Array.isArray(savedRaw)  ? savedRaw  as string[] : [];
      if (!arraysEqualAsSet(edited, current)) { patch[apiKey] = edited; hasChange = true; }
    }
  }
  return hasChange ? patch : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Button handler simulations (exact logic from passport.tsx onClick handlers)
// ─────────────────────────────────────────────────────────────────────────────

function sim_startContinue(
  missingSections: SectionDef[],
  outMode: { value: Mode },
  outHistory: { passport: string }[],
) {
  if (!missingSections.length) return;
  outHistory.push({ passport: "flow" });          // window.history.pushState
  outMode.value = {
    kind:  "flow",
    queue: missingSections.map(s => s.id),
    index: 0,
  };
}

function sim_startUpdate(
  outMode: { value: Mode },
  outHistory: { passport: string }[],
) {
  outHistory.push({ passport: "picker" });         // window.history.pushState
  outMode.value = { kind: "picker" };
}

function sim_onPopState(
  state: { passport?: string } | null,
  outMode: { value: Mode },
) {
  if (!state?.passport) outMode.value = { kind: "overview" };
}

function sim_pickerSelect(
  sectionId: SectionId,
  savedAnswers: Record<string, unknown>,
  outMode: { value: Mode },
  outHistory: { passport: string }[],
) {
  // Picker "Continue" button — starts a single-section flow
  outHistory.push({ passport: "flow" });
  outMode.value = { kind: "flow", queue: [sectionId], index: 0 };
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared fixture — profile with all sections filled except notes
// ─────────────────────────────────────────────────────────────────────────────

const ALMOST_COMPLETE: Record<string, unknown> = {
  "style-personalities":    ["casual-cool"],
  "desired-feelings":       ["confident"],
  lifestyle:                ["office"],
  "wardrobe-disconnection": ["basics"],
  "favorite-colors":        ["warm-neutrals"],
  // final-notes intentionally absent
};

const COMPLETE: Record<string, unknown> = {
  ...ALMOST_COMPLETE,
  "final-notes": "Ready to go",
};

// ─────────────────────────────────────────────────────────────────────────────
// missingSections — drives "Continue Passport" visibility and queue
// ─────────────────────────────────────────────────────────────────────────────

describe("missingSections", () => {
  it("returns all 6 sections when savedAnswers is empty", () => {
    const missing = computeMissingSections({});
    assert.equal(missing.length, 6);
    assert.deepEqual(missing.map(s => s.id), [
      "identity", "feelings", "life", "wardrobe", "colours", "notes",
    ]);
  });

  it("excludes a section whose primary subField has data", () => {
    const missing = computeMissingSections({ "style-personalities": ["casual-cool"] });
    const ids = missing.map(s => s.id);
    assert.ok(!ids.includes("identity"));
    assert.ok(ids.includes("feelings"));
  });

  it("includes notes section when final-notes is absent", () => {
    const missing = computeMissingSections(ALMOST_COMPLETE);
    assert.ok(missing.map(s => s.id).includes("notes"));
  });

  it("includes notes section when final-notes is empty string", () => {
    const missing = computeMissingSections({ "final-notes": "" });
    assert.ok(missing.map(s => s.id).includes("notes"));
  });

  it("excludes notes section when final-notes has content", () => {
    const missing = computeMissingSections({ "final-notes": "Some notes" });
    assert.ok(!missing.map(s => s.id).includes("notes"));
  });

  it("returns empty array (isComplete) when all primary fields are filled", () => {
    assert.equal(computeMissingSections(COMPLETE).length, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Continue Passport button — onClick handler
// ─────────────────────────────────────────────────────────────────────────────

describe("Continue Passport button", () => {
  it("transitions mode to flow with notes queue when notes is the only missing section", () => {
    const missing = computeMissingSections(ALMOST_COMPLETE);
    const mode    = { value: { kind: "overview" } as Mode };
    const history: { passport: string }[] = [];

    sim_startContinue(missing, mode, history);

    assert.equal(mode.value.kind, "flow");
    assert.deepEqual((mode.value as { kind: "flow"; queue: SectionId[]; index: number }).queue, ["notes"]);
    assert.equal((mode.value as { kind: "flow"; queue: SectionId[]; index: number }).index, 0);
  });

  it("pushes a { passport: 'flow' } history entry when clicked", () => {
    const missing = computeMissingSections(ALMOST_COMPLETE);
    const mode    = { value: { kind: "overview" } as Mode };
    const history: { passport: string }[] = [];

    sim_startContinue(missing, mode, history);

    assert.equal(history.length, 1);
    assert.deepEqual(history[0], { passport: "flow" });
  });

  it("does nothing when profile is already complete (button should not render)", () => {
    const missing = computeMissingSections(COMPLETE);
    const mode    = { value: { kind: "overview" } as Mode };
    const history: { passport: string }[] = [];

    sim_startContinue(missing, mode, history);

    assert.equal(mode.value.kind, "overview");
    assert.equal(history.length, 0);
  });

  it("queues multiple sections in SECTIONS order when several are missing", () => {
    const missing = computeMissingSections({ "style-personalities": ["casual-cool"] });
    const mode    = { value: { kind: "overview" } as Mode };
    const history: { passport: string }[] = [];

    sim_startContinue(missing, mode, history);

    assert.equal(mode.value.kind, "flow");
    const queue = (mode.value as { queue: SectionId[] }).queue;
    assert.equal(queue[0], "feelings");
    assert.ok(queue.includes("life"));
    assert.ok(queue.includes("wardrobe"));
    assert.ok(queue.includes("colours"));
    assert.ok(queue.includes("notes"));
    assert.ok(!queue.includes("identity"));
  });

  it("opens flow at the notes section — the Notes to nAia textarea subField has kind 'text'", () => {
    const missing = computeMissingSections(ALMOST_COMPLETE);
    const mode    = { value: { kind: "overview" } as Mode };
    const history: { passport: string }[] = [];

    sim_startContinue(missing, mode, history);

    const flowMode = mode.value as { kind: "flow"; queue: SectionId[]; index: number };
    const currentSectionId = flowMode.queue[flowMode.index];
    const section = SECTIONS.find(s => s.id === currentSectionId)!;
    const primaryField = section.subFields[0];

    assert.equal(currentSectionId, "notes");
    assert.equal(primaryField.kind, "text"); // renders <textarea>, not checkbox grid
    assert.equal(primaryField.draftKey, "final-notes");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Update Answers button — onClick handler
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

    assert.equal(history.length, 1);
    assert.deepEqual(history[0], { passport: "picker" });
  });

  it("picker lists all 6 sections so the user can choose which to update", () => {
    // When mode is picker, SECTIONS is rendered as a list.
    // This asserts the full set of sections is available.
    assert.equal(SECTIONS.length, 6);
    assert.deepEqual(SECTIONS.map(s => s.id), [
      "identity", "feelings", "life", "wardrobe", "colours", "notes",
    ]);
  });

  it("selecting a section from picker starts a single-section flow", () => {
    const mode    = { value: { kind: "picker" } as Mode };
    const history: { passport: string }[] = [];

    sim_pickerSelect("identity", {}, mode, history);

    assert.equal(mode.value.kind, "flow");
    assert.deepEqual((mode.value as { queue: SectionId[] }).queue, ["identity"]);
    assert.deepEqual(history[0], { passport: "flow" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Browser Back button — popstate handler
// ─────────────────────────────────────────────────────────────────────────────

describe("browser back button (popstate handler)", () => {
  it("resets mode to overview when back leaves passport history entry", () => {
    const mode = { value: { kind: "flow", queue: ["notes" as SectionId], index: 0 } as Mode };

    sim_onPopState(null, mode); // null = state from before /passport was entered

    assert.equal(mode.value.kind, "overview");
  });

  it("resets mode to overview from flow when back pops a non-passport state", () => {
    const mode = { value: { kind: "flow", queue: ["notes" as SectionId], index: 0 } as Mode };

    sim_onPopState({}, mode);

    assert.equal(mode.value.kind, "overview");
  });

  it("resets mode to overview from picker when back pops a non-passport state", () => {
    const mode = { value: { kind: "picker" } as Mode };

    sim_onPopState({}, mode);

    assert.equal(mode.value.kind, "overview");
  });

  it("does NOT reset mode when back pops a passport-marked state", () => {
    const mode = { value: { kind: "flow", queue: ["notes" as SectionId], index: 0 } as Mode };

    sim_onPopState({ passport: "flow" }, mode);

    assert.equal(mode.value.kind, "flow"); // unchanged — still inside passport flow
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// computeSectionPatch — drives whether the save API is called on Finish
// ─────────────────────────────────────────────────────────────────────────────

describe("computeSectionPatch — notes section", () => {
  const notesSection = SECTIONS.find(s => s.id === "notes")!;

  it("returns null when no text was typed (no change from empty saved)", () => {
    assert.equal(computeSectionPatch(notesSection, { "final-notes": "" }, {}), null);
  });

  it("returns a patch when new notes are entered", () => {
    assert.deepEqual(
      computeSectionPatch(notesSection, { "final-notes": "I prefer blazers" }, {}),
      { finalNotes: "I prefer blazers" },
    );
  });

  it("returns null when the typed text matches saved text", () => {
    assert.equal(
      computeSectionPatch(
        notesSection,
        { "final-notes": "Existing note" },
        { "final-notes": "Existing note" },
      ),
      null,
    );
  });

  it("returns a patch setting finalNotes to null when cleared", () => {
    assert.deepEqual(
      computeSectionPatch(
        notesSection,
        { "final-notes": "" },
        { "final-notes": "Old note" },
      ),
      { finalNotes: null },
    );
  });
});

describe("computeSectionPatch — array section (identity)", () => {
  const identitySection = SECTIONS.find(s => s.id === "identity")!;

  it("returns null when selection is unchanged", () => {
    assert.equal(
      computeSectionPatch(
        identitySection,
        { "style-personalities": ["minimal"], "desired-impression": ["refined"] },
        { "style-personalities": ["minimal"], "desired-impression": ["refined"] },
      ),
      null,
    );
  });

  it("returns patch when a selection changes", () => {
    const patch = computeSectionPatch(
      identitySection,
      { "style-personalities": ["edgy"], "desired-impression": ["refined"] },
      { "style-personalities": ["minimal"], "desired-impression": ["refined"] },
    );
    assert.ok(patch !== null);
    assert.deepEqual((patch as Record<string, unknown>).stylePersonalities, ["edgy"]);
  });

  it("treats order differences as equal (set semantics)", () => {
    assert.equal(
      computeSectionPatch(
        identitySection,
        { "style-personalities": ["edgy", "minimal"], "desired-impression": ["refined"] },
        { "style-personalities": ["minimal", "edgy"], "desired-impression": ["refined"] },
      ),
      null,
    );
  });
});
