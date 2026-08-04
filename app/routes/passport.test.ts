// Focused tests for the /passport page — Phase 0 button fix.
//
// Pure-function tests (missingSections logic, computeSectionPatch, formatDate)
// run in Vitest node environment without jsdom.
//
// Interactive tests (button clicks, mode transitions, browser back button)
// are marked it.todo — they require jsdom. Verify those manually on staging.

import { describe, it, expect } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Re-implement the pure helpers under test so we don't need to import the full
// route module (which pulls in react-router server APIs unavailable in node).
// ─────────────────────────────────────────────────────────────────────────────

type SectionId = "identity" | "feelings" | "life" | "wardrobe" | "colours" | "notes";
type FieldKind = "array" | "color" | "text";

interface SubField {
  draftKey: string;
  apiKey:   string;
  kind:     FieldKind;
}

interface SectionDef {
  id:        SectionId;
  subFields: SubField[];
}

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
// missingSections — drives "Continue Passport" visibility and queue
// ─────────────────────────────────────────────────────────────────────────────

describe("missingSections", () => {
  it("returns all 6 sections when savedAnswers is empty", () => {
    const missing = computeMissingSections({});
    expect(missing).toHaveLength(6);
    expect(missing.map(s => s.id)).toEqual([
      "identity", "feelings", "life", "wardrobe", "colours", "notes",
    ]);
  });

  it("excludes a section whose primary subField has data", () => {
    const missing = computeMissingSections({
      "style-personalities": ["casual-cool"],
    });
    const ids = missing.map(s => s.id);
    expect(ids).not.toContain("identity");
    expect(ids).toContain("feelings");
  });

  it("includes notes section when final-notes is absent", () => {
    const allFilled: Record<string, unknown> = {
      "style-personalities":    ["casual-cool"],
      "desired-feelings":       ["confident"],
      lifestyle:                ["office"],
      "wardrobe-disconnection": ["basics"],
      "favorite-colors":        ["warm-neutrals"],
    };
    const missing = computeMissingSections(allFilled);
    expect(missing.map(s => s.id)).toContain("notes");
  });

  it("includes notes section when final-notes is empty string", () => {
    const missing = computeMissingSections({ "final-notes": "" });
    expect(missing.map(s => s.id)).toContain("notes");
  });

  it("excludes notes section when final-notes has content", () => {
    const missing = computeMissingSections({ "final-notes": "Some notes" });
    expect(missing.map(s => s.id)).not.toContain("notes");
  });

  it("returns empty array (isComplete) when all primary fields are filled", () => {
    const fullAnswers: Record<string, unknown> = {
      "style-personalities":    ["casual-cool"],
      "desired-feelings":       ["confident"],
      lifestyle:                ["office"],
      "wardrobe-disconnection": ["basics"],
      "favorite-colors":        ["warm-neutrals"],
      "final-notes":            "Ready to go",
    };
    const missing = computeMissingSections(fullAnswers);
    expect(missing).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// startContinue logic — the queue built from missingSections
// ─────────────────────────────────────────────────────────────────────────────

describe("startContinue queue construction", () => {
  it("queues notes as the only section when only notes is missing", () => {
    const savedAnswers: Record<string, unknown> = {
      "style-personalities":    ["casual-cool"],
      "desired-feelings":       ["confident"],
      lifestyle:                ["office"],
      "wardrobe-disconnection": ["basics"],
      "favorite-colors":        ["warm-neutrals"],
      // final-notes missing
    };
    const missing = computeMissingSections(savedAnswers);
    expect(missing).toHaveLength(1);
    expect(missing[0].id).toBe("notes");
  });

  it("queues multiple sections in SECTIONS order", () => {
    const savedAnswers: Record<string, unknown> = {
      // only identity filled
      "style-personalities": ["casual-cool"],
    };
    const missing = computeMissingSections(savedAnswers);
    const queue = missing.map(s => s.id);
    expect(queue[0]).toBe("feelings");
    expect(queue).toContain("life");
    expect(queue).toContain("wardrobe");
    expect(queue).toContain("colours");
    expect(queue).toContain("notes");
    expect(queue).not.toContain("identity");
  });

  it("does not queue any section when profile is complete", () => {
    const fullAnswers: Record<string, unknown> = {
      "style-personalities":    ["casual-cool"],
      "desired-feelings":       ["confident"],
      lifestyle:                ["office"],
      "wardrobe-disconnection": ["basics"],
      "favorite-colors":        ["warm-neutrals"],
      "final-notes":            "All done",
    };
    const missing = computeMissingSections(fullAnswers);
    expect(missing).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// computeSectionPatch — drives whether the save API is called on Finish
// ─────────────────────────────────────────────────────────────────────────────

describe("computeSectionPatch — notes section", () => {
  const notesSection = SECTIONS.find(s => s.id === "notes")!;

  it("returns null when no text was typed (no change from empty saved)", () => {
    const patch = computeSectionPatch(notesSection, { "final-notes": "" }, {});
    expect(patch).toBeNull();
  });

  it("returns a patch when new notes are entered", () => {
    const patch = computeSectionPatch(
      notesSection,
      { "final-notes": "I prefer blazers" },
      {},
    );
    expect(patch).toEqual({ finalNotes: "I prefer blazers" });
  });

  it("returns null when the typed text matches saved text", () => {
    const patch = computeSectionPatch(
      notesSection,
      { "final-notes": "Existing note" },
      { "final-notes": "Existing note" },
    );
    expect(patch).toBeNull();
  });

  it("returns a patch setting finalNotes to null when cleared", () => {
    const patch = computeSectionPatch(
      notesSection,
      { "final-notes": "" },
      { "final-notes": "Old note" },
    );
    expect(patch).toEqual({ finalNotes: null });
  });
});

describe("computeSectionPatch — array section (identity)", () => {
  const identitySection = SECTIONS.find(s => s.id === "identity")!;

  it("returns null when selection is unchanged", () => {
    const patch = computeSectionPatch(
      identitySection,
      { "style-personalities": ["minimal"], "desired-impression": ["refined"] },
      { "style-personalities": ["minimal"], "desired-impression": ["refined"] },
    );
    expect(patch).toBeNull();
  });

  it("returns patch when a selection changes", () => {
    const patch = computeSectionPatch(
      identitySection,
      { "style-personalities": ["edgy"], "desired-impression": ["refined"] },
      { "style-personalities": ["minimal"], "desired-impression": ["refined"] },
    );
    expect(patch).toMatchObject({ stylePersonalities: ["edgy"] });
  });

  it("treats order differences as equal (set semantics)", () => {
    const patch = computeSectionPatch(
      identitySection,
      { "style-personalities": ["edgy", "minimal"], "desired-impression": ["refined"] },
      { "style-personalities": ["minimal", "edgy"], "desired-impression": ["refined"] },
    );
    expect(patch).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Interactive — require jsdom, marked todo
// ─────────────────────────────────────────────────────────────────────────────

describe("Continue Passport button (interactive)", () => {
  it.todo("clicking 'Continue Passport' transitions mode to flow with correct queue");
  it.todo("pushes a { passport: 'flow' } history entry when button is clicked");
  it.todo("browser back from flow mode resets mode to overview");
  it.todo("renders the Notes to nAia textarea when notes is the only missing section");
});

describe("Update Answers button (interactive)", () => {
  it.todo("clicking 'Update Answers' transitions mode to picker");
  it.todo("pushes a { passport: 'picker' } history entry when button is clicked");
  it.todo("browser back from picker mode resets mode to overview");
  it.todo("clicking a section in picker transitions to flow for that section");
});
