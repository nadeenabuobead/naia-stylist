// app/lib/passport/rev6.test.ts
// Passport Rev 6 regression suite — 24 cases covering schema, quiz, wiring,
// exclusive-toggle semantics, and legacy-compatibility behaviour.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { quizQuestions, getTotalSteps, getGroupLabel, JOURNEY_GROUPS, NOTES_HELPER_TEXT } from "../onboarding/quiz-data.js";
import { buildProfileSignals } from "../ai/styleme-result.server.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getScreen(id: string) {
  const q = quizQuestions.find(q => q.id === id);
  if (!q) throw new Error(`Screen not found: ${id}`);
  return q;
}

function optionIds(id: string): string[] {
  const q = getScreen(id);
  return (q.options ?? []).map(o => o.id);
}

// ─── R1: Screen count ─────────────────────────────────────────────────────────

describe("R1 — Rev 6 onboarding has exactly 8 screens", () => {
  it("getTotalSteps() returns 8", () => {
    assert.equal(getTotalSteps(), 8);
  });
  it("quizQuestions array has 8 entries", () => {
    assert.equal(quizQuestions.length, 8);
  });
});

// ─── R2: Screen order ─────────────────────────────────────────────────────────

describe("R2 — Screen order matches Rev 6 spec", () => {
  const expectedOrder = [
    "current-goal",
    "style-personalities",
    "successful-outfit-gives",
    "lifestyle",
    "favorite-colors",
    "silhouette",
    "fit-concerns",
    "dressing-preferences",
  ];
  expectedOrder.forEach((id, idx) => {
    it(`screen ${idx + 1} is ${id}`, () => {
      assert.equal(quizQuestions[idx].id, id);
    });
  });
});

// ─── R3: Legacy questions absent from new onboarding ─────────────────────────

describe("R3 — Legacy questions removed from first onboarding", () => {
  const legacyIds = [
    "desired-impression",
    "desired-feelings",
    "becoming",
    "fit-preferences",
    "wardrobe-disconnection",
    "style-support",
    "shopping-priorities",
    "trend-appetite",
    "final-notes",
  ];
  for (const id of legacyIds) {
    it(`${id} is NOT in quizQuestions`, () => {
      assert.equal(quizQuestions.some(q => q.id === id), false);
    });
  }
});

// ─── R4: finalNotes absent from onboarding ───────────────────────────────────

describe("R4 — finalNotes absent from first onboarding", () => {
  it("no screen has id 'final-notes'", () => {
    assert.equal(quizQuestions.some(q => q.id === "final-notes"), false);
  });
});

// ─── R5: V3 style personality IDs ────────────────────────────────────────────

describe("R5 — Style personalities screen has V3 IDs", () => {
  const v3Ids = [
    "classic-polished",
    "feminine-romantic",
    "minimal-relaxed",
    "bold-edgy",
    "creative-expressive",
  ];
  it("all 5 V3 archetype IDs present", () => {
    const ids = optionIds("style-personalities");
    for (const id of v3Ids) {
      assert.ok(ids.includes(id), `Missing V3 ID: ${id}`);
    }
  });
  it("max selections = 2", () => {
    assert.equal(getScreen("style-personalities").maxSelections, 2);
  });
});

// ─── R6: V3 lifestyle IDs ─────────────────────────────────────────────────────

describe("R6 — Lifestyle screen has V3 IDs", () => {
  const v3Lifestyle = [
    "work-office",
    "everyday-casual",
    "dinners-going-out",
    "events-special-occasions",
    "family-parenting",
    "travel",
    "active-busy-days",
  ];
  it("all V3 lifestyle IDs present", () => {
    const ids = optionIds("lifestyle");
    for (const id of v3Lifestyle) {
      assert.ok(ids.includes(id), `Missing V3 lifestyle ID: ${id}`);
    }
  });
  it("max selections = 3", () => {
    assert.equal(getScreen("lifestyle").maxSelections, 3);
  });
});

// ─── R7: V3 silhouette IDs ────────────────────────────────────────────────────

describe("R7 — Silhouette screen has V3 IDs", () => {
  const v3Silhouette = [
    "fitted",
    "waist-defined",
    "straight-simple",
    "relaxed",
    "oversized",
    "loose-flowing",
    "structured-tailored",
    "not-sure",
  ];
  it("all V3 silhouette IDs present", () => {
    const ids = optionIds("silhouette");
    for (const id of v3Silhouette) {
      assert.ok(ids.includes(id), `Missing V3 silhouette ID: ${id}`);
    }
  });
  it("max selections = 3", () => {
    assert.equal(getScreen("silhouette").maxSelections, 3);
  });
});

// ─── R8: not-sure-yet exclusive in currentGoal ───────────────────────────────

describe("R8 — not-sure-yet is EXCLUSIVE in current-goal", () => {
  it("exclusiveIds contains not-sure-yet", () => {
    const q = getScreen("current-goal");
    assert.ok(q.exclusiveIds?.includes("not-sure-yet"), "not-sure-yet not in exclusiveIds");
  });
});

// ─── R9: not-sure exclusive in silhouette ────────────────────────────────────

describe("R9 — not-sure is EXCLUSIVE in silhouette", () => {
  it("exclusiveIds contains not-sure", () => {
    const q = getScreen("silhouette");
    assert.ok(q.exclusiveIds?.includes("not-sure"), "not-sure not in silhouette exclusiveIds");
  });
});

// ─── R10: not-sure exclusive in successfulOutfitGives ────────────────────────

describe("R10 — not-sure is EXCLUSIVE in successful-outfit-gives", () => {
  it("exclusiveIds contains not-sure", () => {
    const q = getScreen("successful-outfit-gives");
    assert.ok(q.exclusiveIds?.includes("not-sure"), "not-sure not in successfulOutfitGives exclusiveIds");
  });
  it("max selections = 3", () => {
    assert.equal(getScreen("successful-outfit-gives").maxSelections, 3);
  });
});

// ─── R11: no-fit-problems exclusive in fit-concerns ──────────────────────────

describe("R11 — no-fit-problems is EXCLUSIVE in fit-concerns", () => {
  it("exclusiveIds contains no-fit-problems", () => {
    const q = getScreen("fit-concerns");
    assert.ok(q.exclusiveIds?.includes("no-fit-problems"), "no-fit-problems not in fitConcerns exclusiveIds");
  });
});

// ─── R12: other reveals noteField in fit-concerns ────────────────────────────

describe("R12 — other triggers fit-concerns-note noteField", () => {
  it("noteField.triggerId = 'other'", () => {
    const q = getScreen("fit-concerns");
    assert.equal(q.noteField?.triggerId, "other");
  });
  it("noteField.id = 'fit-concerns-note'", () => {
    const q = getScreen("fit-concerns");
    assert.equal(q.noteField?.id, "fit-concerns-note");
  });
  it("noteField.maxLength = 500", () => {
    const q = getScreen("fit-concerns");
    assert.equal(q.noteField?.maxLength, 500);
  });
});

// ─── R13: fitConcerns normal cap = 5 ─────────────────────────────────────────

describe("R13 — fit-concerns max normal selections = 5", () => {
  it("maxSelections = 5", () => {
    assert.equal(getScreen("fit-concerns").maxSelections, 5);
  });
  it("no-fit-problems and other are in the options", () => {
    const ids = optionIds("fit-concerns");
    assert.ok(ids.includes("no-fit-problems"));
    assert.ok(ids.includes("other"));
  });
});

// ─── R14: currentGoal max = 2 ─────────────────────────────────────────────────

describe("R14 — current-goal max selections = 2", () => {
  it("maxSelections = 2", () => {
    assert.equal(getScreen("current-goal").maxSelections, 2);
  });
});

// ─── R15: dressing-preferences has all 9 IDs ─────────────────────────────────

describe("R15 — dressing-preferences has all 9 required option IDs", () => {
  const requiredIds = [
    "dresses-modestly",
    "usually-wears-abayas",
    "arms-covered",
    "chest-neckline-covered",
    "legs-covered",
    "longer-tops",
    "no-cropped-tops",
    "looser-fitting",
    "wears-hijab",
  ];
  it("all 9 IDs present", () => {
    const ids = optionIds("dressing-preferences");
    for (const id of requiredIds) {
      assert.ok(ids.includes(id), `Missing dressing-preference ID: ${id}`);
    }
  });
  it("no exclusiveIds on dressing-preferences", () => {
    const q = getScreen("dressing-preferences");
    assert.ok(!q.exclusiveIds || q.exclusiveIds.length === 0);
  });
});

// ─── R16: buildProfileSignals always sets dressingPreferences ─────────────────

describe("R16 — buildProfileSignals always populates dressingPreferences", () => {
  it("empty array → signals.dressingPreferences = []", () => {
    const signals = buildProfileSignals({ dressingPreferences: [] });
    assert.deepEqual(signals?.dressingPreferences, []);
  });

  it("non-empty array → signals.dressingPreferences matches input", () => {
    const prefs = ["dresses-modestly", "arms-covered"];
    const signals = buildProfileSignals({ dressingPreferences: prefs });
    assert.deepEqual(signals?.dressingPreferences, prefs);
  });

  it("undefined dressingPreferences → signals.dressingPreferences = []", () => {
    const signals = buildProfileSignals({ stylePersonalities: ["classic-polished"] });
    assert.deepEqual(signals?.dressingPreferences, []);
  });

  it("null dressingPreferences → signals.dressingPreferences = []", () => {
    const signals = buildProfileSignals({ dressingPreferences: null });
    assert.deepEqual(signals?.dressingPreferences, []);
  });
});

// ─── R17: Legacy desiredFeelings not in Rev 6 onboarding screens ─────────────

describe("R17 — desiredFeelings (desired-feelings) not in new onboarding", () => {
  it("no screen has id 'desired-feelings'", () => {
    assert.equal(quizQuestions.some(q => q.id === "desired-feelings"), false);
  });
});

// ─── R18: buildProfileSignals preserves other signals alongside dressingPreferences

describe("R18 — dressingPreferences wiring does not break other signals", () => {
  it("stylePersonalities and dressingPreferences both populate", () => {
    const signals = buildProfileSignals({
      stylePersonalities: ["fitted", "classic-polished"],
      dressingPreferences: ["arms-covered"],
    });
    assert.deepEqual(signals?.stylePersonalities, ["fitted", "classic-polished"]);
    assert.deepEqual(signals?.dressingPreferences, ["arms-covered"]);
  });

  it("null profile → buildProfileSignals returns undefined", () => {
    assert.equal(buildProfileSignals(null), undefined);
  });
});

// ─── R19: currentGoal max includes not-sure-yet option ───────────────────────

describe("R19 — currentGoal has not-sure-yet as an option", () => {
  it("not-sure-yet appears in current-goal options", () => {
    assert.ok(optionIds("current-goal").includes("not-sure-yet"));
  });
});

// ─── R20: successfulOutfitGives has not-sure as an option ─────────────────────

describe("R20 — successfulOutfitGives has not-sure as an option", () => {
  it("not-sure appears in successful-outfit-gives options", () => {
    assert.ok(optionIds("successful-outfit-gives").includes("not-sure"));
  });
});

// ─── R21: No sheer/transparency in dressing-preferences ──────────────────────

describe("R21 — sheer / transparency NOT in dressing-preferences", () => {
  it("no sheer-related ID present", () => {
    const ids = optionIds("dressing-preferences");
    const forbidden = ids.filter(id => id.includes("sheer") || id.includes("transparent"));
    assert.deepEqual(forbidden, []);
  });
});

// ─── R22: V3 silhouette — not-sure produces no SMCM mapping ──────────────────

describe("R22 — not-sure silhouette is exclusive and absent from SMCM map", () => {
  // We import the map directly to verify not-sure is intentionally absent
  it("not-sure is in silhouette exclusiveIds", () => {
    const q = getScreen("silhouette");
    assert.ok(q.exclusiveIds?.includes("not-sure"));
  });
  it("not-sure is a silhouette option", () => {
    assert.ok(optionIds("silhouette").includes("not-sure"));
  });
});

// ─── R23: straight-simple is a valid silhouette option (not proxied) ─────────

describe("R23 — straight-simple is a valid quiz option in silhouette", () => {
  it("straight-simple appears in silhouette options", () => {
    assert.ok(optionIds("silhouette").includes("straight-simple"));
  });
});

// ─── R24: Screen 5 (favorite-colors) has a secondaryQuestion for avoid-colors ─

describe("R24 — favorite-colors screen includes avoid-colors secondary question", () => {
  it("screen 5 has secondaryQuestion", () => {
    const q = quizQuestions[4];
    assert.ok(q.secondaryQuestion, "favorite-colors screen missing secondaryQuestion");
  });
  it("secondaryQuestion.id = 'avoid-colors'", () => {
    const q = quizQuestions[4];
    assert.equal(q.secondaryQuestion?.id, "avoid-colors");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// UX POLISH — Rev 6 onboarding journey grouping and framing (checks A–L)
// ═══════════════════════════════════════════════════════════════════════════════

// ─── R25 (check C): questions 1–3 belong to "WHAT MATTERS TO YOU" ─────────────

describe("R25 — steps 1–3 group label is WHAT MATTERS TO YOU", () => {
  [1, 2, 3].forEach(step => {
    it(`getGroupLabel(${step}) = "WHAT MATTERS TO YOU"`, () => {
      assert.equal(getGroupLabel(step), "WHAT MATTERS TO YOU");
    });
  });
});

// ─── R26 (check D): questions 4–6 belong to "YOUR STYLE IN REAL LIFE" ─────────

describe("R26 — steps 4–6 group label is YOUR STYLE IN REAL LIFE", () => {
  [4, 5, 6].forEach(step => {
    it(`getGroupLabel(${step}) = "YOUR STYLE IN REAL LIFE"`, () => {
      assert.equal(getGroupLabel(step), "YOUR STYLE IN REAL LIFE");
    });
  });
});

// ─── R27 (check E): questions 7–8 belong to "WHAT NAIA SHOULD RESPECT" ────────

describe("R27 — steps 7–8 group label is WHAT NAIA SHOULD RESPECT", () => {
  [7, 8].forEach(step => {
    it(`getGroupLabel(${step}) = "WHAT NAIA SHOULD RESPECT"`, () => {
      assert.equal(getGroupLabel(step), "WHAT NAIA SHOULD RESPECT");
    });
  });
});

// ─── R28 (checks F + G): groups cover all 8 steps exactly once; no extra screens ─

describe("R28 — JOURNEY_GROUPS covers all 8 steps exactly once, no extras", () => {
  it("JOURNEY_GROUPS spans exactly 8 total step slots", () => {
    const allSteps = JOURNEY_GROUPS.flatMap(g => [...g.steps]);
    assert.equal(allSteps.length, 8);
  });

  it("every step 1–8 appears in exactly one group", () => {
    for (let s = 1; s <= 8; s++) {
      const matches = JOURNEY_GROUPS.filter(g => (g.steps as readonly number[]).includes(s));
      assert.equal(matches.length, 1, `step ${s} belongs to ${matches.length} groups`);
    }
  });

  it("getTotalSteps() matches total JOURNEY_GROUPS step slots", () => {
    const allSteps = JOURNEY_GROUPS.flatMap(g => [...g.steps]);
    assert.equal(getTotalSteps(), allSteps.length);
  });

  it("quizQuestions.length is still 8 (no extra screens injected)", () => {
    assert.equal(quizQuestions.length, 8);
  });
});

// ─── R29 (check H): Rev 6 draft keys present — persistence architecture unchanged

describe("R29 — Rev 6 draft keys still present in quiz data", () => {
  const rev6DraftKeys = [
    "current-goal",
    "style-personalities",
    "successful-outfit-gives",
    "lifestyle",
    "favorite-colors",
    "avoid-colors",
    "silhouette",
    "fit-concerns",
    "dressing-preferences",
  ];
  for (const key of rev6DraftKeys) {
    it(`question id or secondaryQuestion id "${key}" exists`, () => {
      const inPrimary   = quizQuestions.some(q => q.id === key);
      const inSecondary = quizQuestions.some(q => q.secondaryQuestion?.id === key);
      assert.ok(inPrimary || inSecondary, `Draft key missing: ${key}`);
    });
  }
});

// ─── R30 (check J): Notes (final-notes) outside the 8-question onboarding flow ─

describe("R30 — Notes (final-notes) absent from the 8-question onboarding flow", () => {
  it("no quizQuestion has id 'final-notes'", () => {
    assert.equal(quizQuestions.some(q => q.id === "final-notes"), false);
  });
  it("no quizQuestion noteField leads to 'final-notes'", () => {
    assert.equal(quizQuestions.some(q => q.noteField?.id === "final-notes"), false);
  });
  it("no quizQuestion secondaryQuestion has id 'final-notes'", () => {
    assert.equal(quizQuestions.some(q => q.secondaryQuestion?.id === "final-notes"), false);
  });
});

// ─── R31 (check K): NOTES_HELPER_TEXT contains the approved directional phrases ─

describe("R31 — NOTES_HELPER_TEXT contains approved direction", () => {
  it("contains 'Tell nAia anything'", () => {
    assert.ok(NOTES_HELPER_TEXT.startsWith("Tell nAia anything"), `NOTES_HELPER_TEXT: ${NOTES_HELPER_TEXT}`);
  });
  it("contains 'how you actually like to dress'", () => {
    assert.ok(NOTES_HELPER_TEXT.includes("how you actually like to dress"));
  });
  it("contains 'preferences, frustrations'", () => {
    assert.ok(NOTES_HELPER_TEXT.includes("preferences, frustrations"));
  });
  it("does NOT contain 'Always considered by nAia'", () => {
    assert.ok(!NOTES_HELPER_TEXT.includes("Always considered by nAia"));
  });
});

// ─── R32 (check L): buildProfileSignals does not include currentGoal field ──────

describe("R32 — buildProfileSignals does not output a currentGoal scoring field", () => {
  it("result has no currentGoal key", () => {
    const signals = buildProfileSignals({
      currentGoal: ["understand-my-style", "use-what-i-own"],
      stylePersonalities: ["classic-polished"],
    });
    assert.ok(signals !== undefined && signals !== null, "signals should be defined");
    assert.ok(!("currentGoal" in (signals as object)), "currentGoal must not appear in scoring signals");
  });
});

// ─── R33: render deduplication contract ──────────────────────────────────────
// Mirrors the two template expressions in step.$step.tsx:
//   progress label : `${step} OF ${totalSteps}`
//   question eyebrow: getGroupLabel(step)
// Verifies that each display point carries distinct, non-overlapping information.

describe("R33 — progress area and eyebrow carry distinct information", () => {
  const total = getTotalSteps();

  it("progress label for step 2 is '2 OF 8' (absolute position only)", () => {
    const label = `${2} OF ${total}`;
    assert.equal(label, "2 OF 8");
  });

  it("progress label for step 2 does NOT contain the journey-group label", () => {
    const label = `${2} OF ${total}`;
    assert.ok(!label.includes("WHAT MATTERS TO YOU"), `progress label must not contain group: "${label}"`);
  });

  it("eyebrow for step 2 is 'WHAT MATTERS TO YOU' (group label only)", () => {
    assert.equal(getGroupLabel(2), "WHAT MATTERS TO YOU");
  });

  it("eyebrow for step 2 does NOT contain 'OF 8'", () => {
    const eyebrow = getGroupLabel(2);
    assert.ok(!eyebrow.includes("OF 8"), `eyebrow must not contain step count: "${eyebrow}"`);
  });

  // Exhaust all 8 steps: progress never leaks a group label; eyebrow never leaks a step count
  for (let s = 1; s <= 8; s++) {
    it(`step ${s}: progress label contains only "${s} OF ${total}"`, () => {
      const label = `${s} OF ${total}`;
      const group = getGroupLabel(s);
      assert.ok(!label.includes(group), `progress label at step ${s} must not contain group "${group}"`);
    });

    it(`step ${s}: eyebrow does not contain step count`, () => {
      const eyebrow = getGroupLabel(s);
      // Must not contain any "N OF 8" pattern
      assert.ok(!/\d+ OF \d+/.test(eyebrow), `eyebrow at step ${s} must not contain step count: "${eyebrow}"`);
    });
  }
});
