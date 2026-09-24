// app/lib/passport/rev7-display.test.ts
//
// Rev 7 display wiring — My nAia dashboard and the Passport summary/edit view.
// Data/display only; no redesign is asserted here beyond the existing hierarchy.
//
//   1. Dashboard snapshot leads with the Rev 7 fields, falls back for legacy
//   2. No raw stored ID can reach the screen
//   3. Lifestyle is not capped at 3 anywhere in the display path
//   4. Dashboard stays concise, and requirements are never summarised away
//   5. Passport editor carries every Rev 7 section
//   6. Completion / CTA logic understands profileVersion 7
//
// Run: node --test --import tsx/esm app/lib/passport/rev7-display.test.ts

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { ALL_OPTION_LABELS, quizQuestions, LEGACY_QUESTIONS } from "../onboarding/quiz-data.js";

const DASH = readFileSync("app/routes/my-naia._index.tsx", "utf8");
const PASSPORT = readFileSync("app/routes/passport.tsx", "utf8");

// ── 1. Dashboard reads the Rev 7 fields ──────────────────────────────────────

describe("R7D.1 — dashboard snapshot leads with the Rev 7 fields", () => {
  const snapshot = DASH.slice(
    DASH.indexOf("function PassportSnapshot"),
    DASH.indexOf("export async function loader"),
  );

  for (const field of ["styleDirections", "styleExpression", "explorationLevel", "dressingHabits"]) {
    it(`reads ${field}`, () => {
      assert.ok(snapshot.includes(field), `the snapshot must read ${field}`);
    });
  }

  it("keeps the existing information customers already rely on", () => {
    for (const field of ["favoriteColors", "silhouette", "successfulOutfitGives",
                         "currentGoal", "lifestyle", "dressingPreferences"]) {
      assert.ok(snapshot.includes(field), `the snapshot must keep showing ${field}`);
    }
  });

  it("styleDirections supersedes stylePersonalities rather than joining it", () => {
    const idx = snapshot.indexOf("styleDirections");
    const legacyIdx = snapshot.indexOf("stylePersonalities");
    assert.ok(idx > 0 && legacyIdx > idx,
      "the Rev 7 field must be read first, with the legacy row as the else-branch");
    assert.ok(snapshot.includes("} else {"),
      "the legacy row must be a fallback, not an additional signal");
  });

  it("a legacy customer still renders through the compatibility path", () => {
    assert.ok(snapshot.includes("STYLE_PERSONALITY_LABELS"),
      "legacy archetype labels must still be resolvable on the dashboard");
  });

  it("sentinel opt-outs are filtered rather than displayed", () => {
    for (const sentinel of ["not-sure", "not-sure-yet", "none-of-these",
                            "no-colour-preference", "no-dressing-requirements"]) {
      assert.ok(snapshot.includes(`"${sentinel}"`), `${sentinel} must be filtered from display`);
    }
  });
});

// ── 2. No raw IDs on screen ──────────────────────────────────────────────────

describe("R7D.2 — stored IDs always resolve to human-readable labels", () => {
  it("dashboard label resolution falls back to the canonical option labels", () => {
    assert.ok(DASH.includes("ALL_OPTION_LABELS[id]"),
      "labelFrom must fall back to the canonical label map before humanizing an ID");
  });

  it("favourite colours are resolved, not printed raw", () => {
    const snapshot = DASH.slice(DASH.indexOf("function PassportSnapshot"), DASH.indexOf("export async function loader"));
    assert.ok(!snapshot.includes("colours.slice(0, 4).join"),
      "colour IDs such as white-cream must not be joined raw into the row");
    assert.ok(/colours\.map\(c => labelFrom/.test(snapshot),
      "each colour ID must be resolved through labelFrom");
  });

  it("every Rev 7 option ID resolves to copy that is not just its slug", () => {
    for (const q of quizQuestions) {
      for (const o of q.options ?? []) {
        const label = ALL_OPTION_LABELS[o.id];
        assert.ok(label, `${q.id}:${o.id} must resolve to a label`);
        assert.notEqual(label, o.id);
      }
      for (const c of q.colors ?? []) {
        assert.ok(ALL_OPTION_LABELS[c.id], `${q.id}:${c.id} must resolve to a colour name`);
      }
    }
  });

  it("every legacy option ID also resolves, so old Passports never show a slug", () => {
    for (const q of LEGACY_QUESTIONS) {
      for (const o of q.options ?? []) {
        assert.ok(ALL_OPTION_LABELS[o.id], `legacy ${q.id}:${o.id} must resolve to a label`);
      }
    }
  });
});

// ── 3. Lifestyle is uncapped in the display path ─────────────────────────────

describe("R7D.3 — lifestyle display no longer assumes a maximum of three", () => {
  const snapshot = DASH.slice(DASH.indexOf("function PassportSnapshot"), DASH.indexOf("export async function loader"));

  it("does not slice lifestyle to three", () => {
    assert.ok(!snapshot.includes("lifestyle.slice(0, 3)"),
      "Rev 7 removed the lifestyle cap — the display must not reimpose it");
  });

  it("does not gate the lifestyle row behind a signal-count check", () => {
    assert.ok(!snapshot.includes("signals.length < 5"),
      "lifestyle must not be dropped because earlier rows filled a quota");
  });

  it("names several contexts and counts the remainder", () => {
    assert.ok(/joinCapped\(lifestyle\.map/.test(snapshot),
      "lifestyle must render through the capped-join helper");
    assert.ok(DASH.includes("+${labels.length - shown} more"),
      "the helper must count the contexts it does not name");
  });

  it("carries a label for every Rev 7 lifestyle context", () => {
    const lifestyleQ = quizQuestions.find(q => q.id === "lifestyle")!;
    const map = DASH.slice(DASH.indexOf("const LIFESTYLE_LABELS"), DASH.indexOf("function humanizeId"));
    for (const o of lifestyleQ.options ?? []) {
      assert.ok(map.includes(`"${o.id}"`), `dashboard must label lifestyle context ${o.id}`);
    }
  });
});

// ── 4. Concise, with requirements pinned ─────────────────────────────────────

describe("R7D.4 — the dashboard stays a snapshot", () => {
  it("caps the number of rows", () => {
    assert.ok(DASH.includes("const MAX_ROWS = 7"), "the snapshot must remain bounded");
  });

  it("renders one list, not a card per field", () => {
    const snapshot = DASH.slice(DASH.indexOf("function PassportSnapshot"), DASH.indexOf("export async function loader"));
    assert.equal((snapshot.match(/<ul /g) ?? []).length, 1,
      "the snapshot must stay a single list in the existing hierarchy");
  });

  it("pins dressing requirements so a constraint is never truncated away", () => {
    assert.ok(DASH.includes("const requirementRow = signals.find"),
      "the requirements row must survive the row cap");
    assert.ok(DASH.includes("not a taste that can be summarised away"),
      "the reason the row is pinned must be recorded");
  });

  it("does not leak the customer's free-text requirement onto the dashboard", () => {
    const snapshot = DASH.slice(DASH.indexOf("function PassportSnapshot"), DASH.indexOf("export async function loader"));
    assert.ok(!/\$\{[^}]*dressingRequirementsNote/.test(snapshot),
      "the note's content must not be interpolated into a dashboard row");
    assert.ok(snapshot.includes('"a requirement you described"'),
      "its presence is acknowledged without reprinting it");
  });
});

// ── 5. Passport editor carries every Rev 7 section ───────────────────────────

describe("R7D.5 — Passport summary/edit view covers the Rev 7 set", () => {
  const sections = PASSPORT.slice(
    PASSPORT.indexOf("const SECTIONS: SectionDef[]"),
    PASSPORT.indexOf("// Notes to nAia"),
  );

  const EXPECTED_API_KEYS = [
    "currentGoal", "successfulOutfitGives", "styleExpression", "explorationLevel",
    "styleDirections", "lifestyle", "favoriteColors", "avoidColors", "silhouette",
    "fitConcerns", "dressingPreferences", "dressingRequirementsNote", "dressingHabits",
  ];

  for (const key of EXPECTED_API_KEYS) {
    it(`SECTIONS exposes ${key}`, () => {
      assert.ok(sections.includes(`apiKey: "${key}"`), `the Passport editor must expose ${key}`);
    });
  }

  it("every Rev 7 onboarding question is reachable from the editor", () => {
    for (const q of quizQuestions) {
      const questionId = q.id === "favorite-colors" ? "favorite-colors" : q.id;
      assert.ok(sections.includes(`questionId: "${questionId}"`),
        `question ${q.id} must be editable in the Passport`);
    }
  });

  it("the retired style question is kept for legacy and Rev 6 customers only", () => {
    assert.ok(sections.includes('apiKey: "stylePersonalities"'),
      "legacy customers must keep access to their stored answer");
    assert.ok(sections.includes("rev7Hidden: true"),
      "it must be hidden once the customer has a Rev 7 Passport");
  });

  it("an unanswered optional section reads as optional, not as a gap", () => {
    assert.ok(PASSPORT.includes('if (def.optional) return <span className="sp-detail-optional">Optional</span>;'),
      "optional sections must not be presented as 'Not yet completed'");
  });
});

// ── 5b. The Rev 6+ dossier overview actually RENDERS the Rev 7 sections ──────
//
// Regression guard. Rev 7 originally added its four sections to SECTIONS — which
// drives the editor, the legacy flat overview and the completion logic — but the
// Rev 6+ overview is a hand-built dossier grid that iterates nothing. The sections
// were therefore editable and complete-able while being invisible on /passport,
// and the original §5 checks passed because they only inspected SECTIONS.

describe("R7D.5b — the Rev 6+ dossier overview renders the Rev 7 sections", () => {
  const dossier = PASSPORT.slice(
    PASSPORT.indexOf('<div className="sp-ov-dossier">'),
    PASSPORT.indexOf("{/* Row 6: Notes to nAia"),
  );

  it("the dossier block is locatable", () => {
    assert.ok(dossier.length > 500, "the Rev 6+ dossier grid must exist");
  });

  for (const [label, sectionId] of [
    ["Style Direction",   "style-directions"],
    ["Style Expression",  "style-expression"],
    ["Style Exploration", "exploration"],
    ["Dressing Habits",   "dressing-habits"],
  ] as const) {
    it(`${label} has a cell with an EDIT entry point`, () => {
      assert.ok(dossier.includes(`>${label}<`), `the dossier must render a ${label} header`);
      assert.ok(dossier.includes(`editSection("${sectionId}")`),
        `${label} must be editable from the dossier`);
    });
  }

  it("Style Direction supersedes the legacy Style cell rather than sitting beside it", () => {
    assert.ok(dossier.includes("styleDirections.length > 0 ? ("),
      "the Style cell must branch on styleDirections");
    assert.ok(dossier.includes('editSection("identity")'),
      "the legacy Style cell must remain reachable while styleDirections is unanswered");
  });

  it("every Rev 7 value is label-resolved, never printed as a raw ID", () => {
    for (const q of ["style-directions", "style-expression", "exploration-level", "dressing-habits"]) {
      assert.ok(dossier.includes(`lbl("${q}"`), `${q} values must go through lbl()`);
    }
  });
});

// ── 5c. A pre-Rev 7 customer is invited, not told they are incomplete ────────

describe("R7D.5c — Rev 7 invitation on /passport", () => {
  it("needsRev7 is derived from the stored answers, not from profileVersion alone", () => {
    assert.ok(PASSPORT.includes("const missingRev7Sections"),
      "the unanswered Rev 7 sections must be computed from savedAnswers");
    assert.ok(PASSPORT.includes("!isLegacyCustomer && !isRev7 && missingRev7Sections.length > 0"),
      "needsRev7 must combine the generation with the actual unanswered sections");
  });

  it("the status never claims 'up to date' while new questions are unanswered", () => {
    assert.ok(PASSPORT.includes('"Your Style Passport is complete — and there are new questions to answer."'),
      "a pre-Rev 7 Passport must get its own status line");
    const statusBlock = PASSPORT.slice(
      PASSPORT.indexOf('<p className="sp-status-text">'),
      PASSPORT.indexOf('<div className="sp-status-date"'),
    );
    assert.ok(statusBlock.indexOf("needsRev7") < statusBlock.indexOf("is up to date"),
      "the needsRev7 branch must be evaluated before the up-to-date wording");
  });

  it("an obvious invitation is shown", () => {
    assert.ok(PASSPORT.includes("New Style Passport questions"));
    assert.ok(PASSPORT.includes("Your existing answers are preserved."));
  });

  it("the invitation queues ONLY the unanswered Rev 7 sections", () => {
    const fn = PASSPORT.slice(PASSPORT.indexOf("function startRev7TopUp"), PASSPORT.indexOf("function startUpdate"));
    assert.ok(fn.includes("missingRev7Sections.map(sec => sec.id)"),
      "the queue must contain only the unanswered Rev 7 sections");
    assert.ok(!fn.includes("missingSections"),
      "the top-up must not pull in the ordinary missing-section queue");
  });

  it("nothing in the top-up path clears stylePersonalities", () => {
    const fn = PASSPORT.slice(PASSPORT.indexOf("function startRev7TopUp"), PASSPORT.indexOf("function startUpdate"));
    assert.ok(!fn.includes("stylePersonalities"),
      "the retired legacy answer must never be touched by the Rev 7 top-up");
  });
});

// ── 6. Completion and CTA logic ──────────────────────────────────────────────

describe("R7D.6 — completion and CTA logic understands profileVersion 7", () => {
  it("dashboard treats any stamped generation as a viewable Passport", () => {
    assert.ok(DASH.includes("profileVersion !== null && profileVersion >= 6"),
      "the view state must not be hard-coded to a single version number");
    assert.ok(!DASH.includes("profileVersion === 6 ?"),
      "the Rev 6-only equality check must be gone");
  });

  it("a Rev 6 customer is invited to add the new answers, not told they are incomplete", () => {
    assert.ok(DASH.includes("missingRev7Answers"), "the dashboard must detect a pre-Rev 7 Passport");
    assert.ok(DASH.includes("New Style Passport questions"),
      "the invitation must not be phrased as an incomplete Passport");
    const idx = DASH.indexOf("missingRev7Answers");
    assert.ok(DASH.slice(idx, idx + 1200).includes("complete for the generation they answered")
      || DASH.includes("complete for the generation they answered"),
      "the distinction must be documented");
  });

  it("a Rev 7 customer triggers no outstanding-answers prompt", () => {
    assert.ok(DASH.includes("profileVersion < REV7_PROFILE_VERSION"),
      "the prompt must be gated on the version, not on field emptiness alone");
  });

  it("Passport completion is derived from the section list, not a fixed question count", () => {
    const block = PASSPORT.slice(PASSPORT.indexOf("const missingSections = useMemo"), PASSPORT.indexOf("const isComplete"));
    assert.ok(block.includes("visibleAllSections.filter"),
      "completion must be derived from the visible sections for this customer");
    assert.ok(block.includes("s.optional"), "optional sections must never count as missing");
    assert.ok(!/length\s*[<>=]=?\s*(7|8|11)\b/.test(block),
      "completion must not assume a fixed number of questions");
  });

  it("the refresh flow stamps the current generation", () => {
    assert.ok(PASSPORT.includes("triggers profileVersion=7 in the API"));
  });
});
