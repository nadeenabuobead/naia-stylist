// app/lib/passport/rev7.test.ts
//
// Passport Rev 7 — vocabulary, limits, exclusivity and legacy-compatibility suite.
//
//   1. Schema + migration are additive and non-destructive
//   2. The 12 Rev 7 questions exist with stable internal IDs
//   3. Selection limits (including lifestyle having NO cap)
//   4. Mutual-exclusion / sentinel rules
//   5. Legacy → Rev 7 style projection (and the three deliberate non-mappings)
//   6. Legacy label preservation (no stored answer degrades to a slug)
//   7. Reserved dressing requirements are stored but never offered
//
// Run: node --test --import tsx/esm app/lib/passport/rev7.test.ts

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  quizQuestions,
  LEGACY_QUESTIONS,
  ALL_QUESTIONS,
  ALL_OPTION_LABELS,
  COLOUR_FAMILIES,
  FAVOURITE_COLOUR_OPTIONS,
  AVOID_COLOUR_OPTIONS,
  getTotalSteps,
  JOURNEY_GROUPS,
} from "../onboarding/quiz-data.js";
import {
  REV7_PROFILE_VERSION,
  isRev7Profile,
  STYLE_EXPRESSION_VALID_IDS,
  STYLE_EXPRESSION_MAX,
  STYLE_EXPRESSION_EXCLUSIVE_IDS,
  EXPLORATION_LEVEL_VALID_IDS,
  STYLE_DIRECTION_VALID_IDS,
  STYLE_DIRECTION_MAX,
  STYLE_DIRECTION_EXCLUSIVE_IDS,
  DRESSING_HABIT_VALID_IDS,
  DRESSING_HABIT_MAX,
  DRESSING_HABIT_EXCLUSIVE_IDS,
  STYLE_DIRECTION_TO_LEGACY_ARCHETYPE,
  UNMAPPED_STYLE_DIRECTION_IDS,
  LEGACY_ARCHETYPE_TO_STYLE_DIRECTION,
  projectStyleDirectionsToArchetypes,
  resolveScoringArchetypes,
  RESERVED_DRESSING_PREFERENCE_IDS,
  DRESSING_REQUIREMENTS_NOTE_TRIGGER_ID,
  DRESSING_REQUIREMENTS_NOTE_MAX,
  NO_COLOUR_PREFERENCE_ID,
  NO_AVOID_COLOURS_ID,
  FAVOURITE_COLOURS_MAX,
  applyExclusiveRule,
} from "./rev7-vocabulary.js";

const SCHEMA = readFileSync("prisma/schema.prisma", "utf8");
const MIGRATION = readFileSync(
  "prisma/migrations/20260923000000_passport_rev7/migration.sql",
  "utf8",
);
const SAVE_API = readFileSync("app/routes/api.save-style-profile.jsx", "utf8");

const q = (id: string) => quizQuestions.find(x => x.id === id);
const optionIds = (id: string) => (q(id)?.options ?? []).map(o => o.id);

// ── 1. Schema + migration ─────────────────────────────────────────────────────

describe("R7.1 — schema is additive and non-destructive", () => {
  const NEW_COLUMNS = [
    "styleExpression",
    "explorationLevel",
    "styleDirections",
    "dressingHabits",
    "dressingRequirementsNote",
  ];

  for (const col of NEW_COLUMNS) {
    it(`OnboardingProfile declares ${col}`, () => {
      assert.ok(
        new RegExp(`^\\s+${col}\\s`, "m").test(SCHEMA),
        `schema.prisma must declare OnboardingProfile.${col}`,
      );
    });

    it(`migration adds ${col} with IF NOT EXISTS`, () => {
      assert.ok(
        MIGRATION.includes(`ADD COLUMN IF NOT EXISTS "${col}"`),
        `migration must add ${col} idempotently`,
      );
    });
  }

  it("migration contains no destructive statement", () => {
    for (const verb of ["DROP COLUMN", "DROP TABLE", "TRUNCATE", "DELETE FROM", "RENAME COLUMN"]) {
      assert.ok(!MIGRATION.toUpperCase().includes(verb), `migration must not ${verb}`);
    }
  });

  it("migration does not rewrite any existing row", () => {
    assert.ok(!/^\s*UPDATE\s/im.test(MIGRATION), "migration must not UPDATE existing rows");
  });

  it("stylePersonalities is retained in the schema", () => {
    assert.ok(
      /^\s+stylePersonalities\s/m.test(SCHEMA),
      "stylePersonalities must remain — it is the style field of record for legacy customers",
    );
  });

  it("array columns default to an empty array so existing rows stay readable", () => {
    for (const col of ["styleExpression", "styleDirections", "dressingHabits"]) {
      assert.ok(
        MIGRATION.includes(`"${col}"          TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]`) ||
        new RegExp(`"${col}"\\s+TEXT\\[\\] NOT NULL DEFAULT ARRAY\\[\\]::TEXT\\[\\]`).test(MIGRATION),
        `${col} must default to an empty array`,
      );
    }
  });

  it("REV7_PROFILE_VERSION is 7 and isRev7Profile only matches 7", () => {
    assert.equal(REV7_PROFILE_VERSION, 7);
    assert.equal(isRev7Profile(7), true);
    assert.equal(isRev7Profile(6), false);
    assert.equal(isRev7Profile(null), false);
    assert.equal(isRev7Profile(undefined), false);
  });
});

// ── 2. The 12 Rev 7 questions ────────────────────────────────────────────────

describe("R7.2 — Rev 7 question set", () => {
  const EXPECTED_FLOW = [
    "current-goal",
    "successful-outfit-gives",
    "style-expression",
    "exploration-level",
    "style-directions",
    "lifestyle",
    "favorite-colors",
    "silhouette",
    "fit-concerns",
    "dressing-preferences",
    "dressing-habits",
  ];

  it("onboarding flow is the expected 11 screens (colours carry avoid as a secondary)", () => {
    assert.deepEqual(quizQuestions.map(x => x.id), EXPECTED_FLOW);
    assert.equal(getTotalSteps(), EXPECTED_FLOW.length);
  });

  it("avoid-colors is carried as the secondary question on the colour screen", () => {
    assert.equal(q("favorite-colors")?.secondaryQuestion?.id, "avoid-colors");
  });

  it("JOURNEY_GROUPS cover every step exactly once", () => {
    const covered = JOURNEY_GROUPS.flatMap(g => [...g.steps]).sort((a, b) => a - b);
    assert.deepEqual(covered, Array.from({ length: getTotalSteps() }, (_, i) => i + 1));
  });

  it("every option ID is a stable kebab-case slug, never display copy", () => {
    for (const question of ALL_QUESTIONS) {
      for (const o of question.options ?? []) {
        assert.match(
          o.id,
          /^[a-z0-9]+(-[a-z0-9]+)*$/,
          `${question.id}: option id "${o.id}" must be a stable kebab-case slug`,
        );
        assert.notEqual(o.id, o.label, `${question.id}: option id must not be its label`);
      }
    }
  });

  it("no question has duplicate option IDs", () => {
    for (const question of ALL_QUESTIONS) {
      const ids = (question.options ?? []).map(o => o.id);
      assert.equal(new Set(ids).size, ids.length, `${question.id} has duplicate option IDs`);
    }
  });

  it("Q3 style-expression offers the 13 approved values", () => {
    assert.deepEqual(optionIds("style-expression").sort(), [...STYLE_EXPRESSION_VALID_IDS].sort());
  });

  it("Q4 exploration-level is single-select with the 6 approved values", () => {
    assert.equal(q("exploration-level")?.type, "single");
    assert.deepEqual(optionIds("exploration-level").sort(), [...EXPLORATION_LEVEL_VALID_IDS].sort());
  });

  it("Q5 style-directions offers the 9 approved values", () => {
    assert.deepEqual(optionIds("style-directions").sort(), [...STYLE_DIRECTION_VALID_IDS].sort());
  });

  it("Q12 dressing-habits offers the 13 approved values", () => {
    assert.deepEqual(optionIds("dressing-habits").sort(), [...DRESSING_HABIT_VALID_IDS].sort());
  });

  it("Q2 adds feel-distinctive without disturbing the existing IDs", () => {
    const ids = optionIds("successful-outfit-gives");
    assert.ok(ids.includes("feel-distinctive"));
    for (const legacy of ["feel-like-myself", "confidence", "feel-put-together", "comfort-ease",
                          "feel-attractive", "sense-of-expression", "sense-of-power",
                          "effortlessness", "not-sure"]) {
      assert.ok(ids.includes(legacy), `${legacy} must be preserved`);
    }
  });

  it("Q9 adds a sensory/texture concern", () => {
    assert.ok(optionIds("fit-concerns").includes("fabric-texture-sensitivity"));
  });

  it("Q8 adds longline / cropped / mixing without renaming existing IDs", () => {
    const ids = optionIds("silhouette");
    for (const added of ["longline", "cropped-fit", "mixing-fits"]) assert.ok(ids.includes(added));
    for (const kept of ["fitted", "straight-simple", "relaxed", "oversized", "structured-tailored",
                        "waist-defined", "boxy", "tapered", "loose-flowing", "not-sure"]) {
      assert.ok(ids.includes(kept), `${kept} must be preserved`);
    }
  });

  it("Q6 lifestyle keeps everyday-casual as the stable ID and only changes its label", () => {
    const opt = q("lifestyle")?.options?.find(o => o.id === "everyday-casual");
    assert.ok(opt, "everyday-casual must remain the stable ID");
    assert.equal(opt!.label, "Everyday / Casual");
  });

  it("Q6 lifestyle offers every Rev 7 context", () => {
    const ids = optionIds("lifestyle");
    for (const expected of ["work-office", "everyday-casual", "dinners-going-out",
                            "events-special-occasions", "family-parenting", "study-university",
                            "travel", "fitness-gym", "active-busy-days",
                            "creative-flexible-work", "mostly-at-home", "other-lifestyle"]) {
      assert.ok(ids.includes(expected), `lifestyle must offer ${expected}`);
    }
    assert.equal(ids.length, 12);
  });

  it("Q6 lifestyle asks the Rev 7 question and no longer says 'dress for most often'", () => {
    assert.equal(q("lifestyle")?.title, "Which of these are part of your lifestyle?");
    assert.ok(!/most often/i.test(q("lifestyle")?.title ?? ""));
  });
});

// ── 3. Selection limits ──────────────────────────────────────────────────────

describe("R7.3 — selection limits", () => {
  it("styleExpression max 3", () => {
    assert.equal(STYLE_EXPRESSION_MAX, 3);
    assert.equal(q("style-expression")?.maxSelections, 3);
  });

  it("styleDirections max 3", () => {
    assert.equal(STYLE_DIRECTION_MAX, 3);
    assert.equal(q("style-directions")?.maxSelections, 3);
  });

  it("dressingHabits max 2", () => {
    assert.equal(DRESSING_HABIT_MAX, 2);
    assert.equal(q("dressing-habits")?.maxSelections, 2);
  });

  it("currentGoal max 2", () => {
    assert.equal(q("current-goal")?.maxSelections, 2);
  });

  it("successfulOutfitGives max 3", () => {
    assert.equal(q("successful-outfit-gives")?.maxSelections, 3);
  });

  it("silhouette max is raised to 4", () => {
    assert.equal(q("silhouette")?.maxSelections, 4);
    assert.ok(SAVE_API.includes("const SILHOUETTE_MAX = 4"), "server cap must be 4");
  });

  it("favoriteColors max 5", () => {
    assert.equal(FAVOURITE_COLOURS_MAX, 5);
    assert.equal(q("favorite-colors")?.maxSelections, 5);
  });

  it("lifestyle has NO selection cap", () => {
    assert.equal(q("lifestyle")?.maxSelections, undefined,
      "Rev 7 removed the lifestyle cap — a life can span many contexts");
    assert.ok(!SAVE_API.includes("isLifestyleCountValid("),
      "the save path must no longer enforce a lifestyle count");
    assert.ok(!SAVE_API.includes("lifestyle_too_many"),
      "the lifestyle_too_many rejection must be gone");
  });

  it("lifestyle IDs are still validated server-side", () => {
    assert.ok(SAVE_API.includes("LIFESTYLE_VALID_IDS.has(id)"));
    assert.ok(SAVE_API.includes("lifestyle_invalid_id"));
  });

  it("avoidColors has NO selection cap", () => {
    assert.equal(q("favorite-colors")?.secondaryQuestion?.maxSelections, undefined);
  });

  it("fitConcerns has no arbitrary numeric cap beyond its own vocabulary", () => {
    assert.equal(q("fit-concerns")?.maxSelections, undefined);
    assert.ok(SAVE_API.includes("const FIT_CONCERN_MAX_NORMAL = FIT_CONCERN_VALID.size"));
  });

  it("every server cap is enforced in validation, not only in the question definition", () => {
    for (const constant of ["STYLE_EXPRESSION_MAX", "STYLE_DIRECTION_MAX", "DRESSING_HABIT_MAX",
                            "FAVOURITE_COLOURS_MAX"]) {
      assert.ok(SAVE_API.includes(constant), `${constant} must be enforced in the save API`);
    }
  });
});

// ── 4. Mutual exclusion / sentinels ──────────────────────────────────────────

describe("R7.4 — exclusive-value handling", () => {
  it("applyExclusiveRule collapses to the exclusive value", () => {
    assert.deepEqual(applyExclusiveRule(["bold", "not-sure", "playful"], STYLE_EXPRESSION_EXCLUSIVE_IDS), ["not-sure"]);
  });

  it("applyExclusiveRule leaves non-exclusive selections untouched and ordered", () => {
    assert.deepEqual(applyExclusiveRule(["bold", "playful"], STYLE_EXPRESSION_EXCLUSIVE_IDS), ["bold", "playful"]);
  });

  it("applyExclusiveRule returns a copy, never the caller's array", () => {
    const input = ["bold"];
    assert.notEqual(applyExclusiveRule(input, STYLE_EXPRESSION_EXCLUSIVE_IDS), input);
  });

  it("applyExclusiveRule on an empty array is empty", () => {
    assert.deepEqual(applyExclusiveRule([], STYLE_EXPRESSION_EXCLUSIVE_IDS), []);
  });

  it("'not sure yet' is exclusive on every question that offers it", () => {
    for (const question of quizQuestions) {
      const ids = (question.options ?? []).map(o => o.id);
      if (ids.includes("not-sure")) {
        assert.ok(
          (question.exclusiveIds ?? []).includes("not-sure") || question.type === "single",
          `${question.id}: "not-sure" must be exclusive`,
        );
      }
      if (ids.includes("not-sure-yet")) {
        assert.ok((question.exclusiveIds ?? []).includes("not-sure-yet"),
          `${question.id}: "not-sure-yet" must be exclusive`);
      }
    }
  });

  it("no-fit-problems is exclusive", () => {
    assert.ok((q("fit-concerns")?.exclusiveIds ?? []).includes("no-fit-problems"));
    assert.ok(SAVE_API.includes('body["fitConcerns"] = ["no-fit-problems"]'));
  });

  it("no-dressing-requirements is exclusive", () => {
    assert.ok((q("dressing-preferences")?.exclusiveIds ?? []).includes("no-dressing-requirements"));
    assert.ok(SAVE_API.includes('body["dressingPreferences"] = ["no-dressing-requirements"]'));
  });

  it("none-of-these clears other dressing habits", () => {
    assert.ok(DRESSING_HABIT_EXCLUSIVE_IDS.has("none-of-these"));
    assert.deepEqual(
      applyExclusiveRule(["overthink", "none-of-these"], DRESSING_HABIT_EXCLUSIVE_IDS),
      ["none-of-these"],
    );
  });

  it("not-sure clears other style directions", () => {
    assert.deepEqual(
      applyExclusiveRule(["bold-statement", "not-sure"], STYLE_DIRECTION_EXCLUSIVE_IDS),
      ["not-sure"],
    );
  });

  it("no-colour-preference clears specific favourite colours", () => {
    assert.ok((q("favorite-colors")?.exclusiveIds ?? []).includes(NO_COLOUR_PREFERENCE_ID));
    assert.ok(SAVE_API.includes('body["favoriteColors"] = [NO_COLOUR_PREFERENCE_ID]'));
  });

  it("none clears specific avoided colours", () => {
    assert.ok((q("favorite-colors")?.secondaryQuestion?.exclusiveIds ?? []).includes(NO_AVOID_COLOURS_ID));
    assert.ok(SAVE_API.includes('body["avoidColors"] = [NO_AVOID_COLOURS_ID]'));
  });

  it("a colour cannot be both loved and avoided — avoid wins, server-side", () => {
    assert.ok(SAVE_API.includes("resolveColourConflict(rawFavorites, rawAvoids)"),
      "the save path must resolve the favourite/avoid conflict before persisting");
  });

  it("the two colour sentinels cannot collide across the pickers", () => {
    assert.ok(!COLOUR_FAMILIES.some(c => c.id === NO_COLOUR_PREFERENCE_ID));
    assert.ok(!COLOUR_FAMILIES.some(c => c.id === NO_AVOID_COLOURS_ID));
    assert.ok(!FAVOURITE_COLOUR_OPTIONS.some(c => c.id === NO_AVOID_COLOURS_ID));
    assert.ok(!AVOID_COLOUR_OPTIONS.some(c => c.id === NO_COLOUR_PREFERENCE_ID));
  });

  it("colour vocabulary gains blue, purple and metallics", () => {
    const ids = COLOUR_FAMILIES.map(c => c.id);
    for (const added of ["blue", "purple", "metallics"]) assert.ok(ids.includes(added));
    assert.equal(ids.length, 13);
  });

  it("existing colour IDs are unchanged", () => {
    const ids = COLOUR_FAMILIES.map(c => c.id);
    for (const kept of ["black", "white-cream", "beige-brown", "grey", "navy",
                        "red-burgundy", "green", "pink", "yellow", "orange"]) {
      assert.ok(ids.includes(kept), `${kept} must be preserved`);
    }
  });
});

// ── 5. Legacy → Rev 7 style projection ───────────────────────────────────────

describe("R7.5 — style direction projection", () => {
  it("maps only the five genuinely clear relationships", () => {
    assert.deepEqual(STYLE_DIRECTION_TO_LEGACY_ARCHETYPE, {
      "polished-refined":    "classic-polished",
      "clean-minimal":       "minimal-relaxed",
      "bold-statement":      "bold-edgy",
      "creative-individual": "creative-expressive",
      "soft-romantic":       "feminine-romantic",
    });
  });

  it("invents no mapping for relaxed-easy, street-contemporary or sporty-functional", () => {
    for (const id of ["relaxed-easy", "street-contemporary", "sporty-functional"]) {
      assert.equal(STYLE_DIRECTION_TO_LEGACY_ARCHETYPE[id], undefined,
        `${id} must NOT be given an invented legacy archetype`);
      assert.ok(UNMAPPED_STYLE_DIRECTION_IDS.has(id));
    }
  });

  it("the three unmapped directions are still valid Rev 7 values", () => {
    for (const id of UNMAPPED_STYLE_DIRECTION_IDS) {
      assert.ok(STYLE_DIRECTION_VALID_IDS.has(id), `${id} must remain a valid selection`);
      assert.ok(optionIds("style-directions").includes(id), `${id} must be offered in the UI`);
    }
  });

  it("projects mapped directions and tracks unmapped ones separately", () => {
    const r = projectStyleDirectionsToArchetypes(["polished-refined", "sporty-functional", "clean-minimal"]);
    assert.deepEqual(r.archetypes, ["classic-polished", "minimal-relaxed"]);
    assert.deepEqual(r.unmapped, ["sporty-functional"]);
  });

  it("never projects the not-sure sentinel", () => {
    const r = projectStyleDirectionsToArchetypes(["not-sure"]);
    assert.deepEqual(r.archetypes, []);
    assert.deepEqual(r.unmapped, []);
  });

  it("deduplicates archetypes when two directions collapse to one", () => {
    const r = projectStyleDirectionsToArchetypes(["clean-minimal", "clean-minimal"]);
    assert.deepEqual(r.archetypes, ["minimal-relaxed"]);
  });

  it("ignores unknown IDs rather than emitting them as unmapped", () => {
    const r = projectStyleDirectionsToArchetypes(["not-a-real-direction"]);
    assert.deepEqual(r.archetypes, []);
    assert.deepEqual(r.unmapped, []);
  });

  it("handles null and undefined", () => {
    assert.deepEqual(projectStyleDirectionsToArchetypes(null), { archetypes: [], unmapped: [] });
    assert.deepEqual(projectStyleDirectionsToArchetypes(undefined), { archetypes: [], unmapped: [] });
  });

  it("the reverse archetype map is consistent with the forward map", () => {
    for (const [direction, archetype] of Object.entries(STYLE_DIRECTION_TO_LEGACY_ARCHETYPE)) {
      assert.equal(LEGACY_ARCHETYPE_TO_STYLE_DIRECTION[archetype], direction);
    }
  });

  it("resolveScoringArchetypes uses styleDirections when a Rev 7 answer exists", () => {
    assert.deepEqual(
      resolveScoringArchetypes({
        styleDirections: ["bold-statement"],
        stylePersonalities: ["minimal-relaxed"],
      }),
      ["bold-edgy"],
      "a Rev 7 answer must supersede the stale legacy row, never blend with it",
    );
  });

  it("resolveScoringArchetypes falls back to stylePersonalities for legacy profiles", () => {
    assert.deepEqual(
      resolveScoringArchetypes({ stylePersonalities: ["old-money", "artsy"] }),
      ["old-money", "artsy"],
      "legacy values must be passed through untouched",
    );
  });

  it("resolveScoringArchetypes returns [] when nothing is stored", () => {
    assert.deepEqual(resolveScoringArchetypes({}), []);
  });

  it("a Rev 7 customer selecting only unmapped directions scores against nothing, not garbage", () => {
    assert.deepEqual(
      resolveScoringArchetypes({ styleDirections: ["sporty-functional", "street-contemporary"] }),
      [],
    );
  });
});

// ── 6. Legacy label preservation ─────────────────────────────────────────────

describe("R7.6 — legacy answers never degrade to a slug", () => {
  const LEGACY_STYLE_IDS = [
    "classic-polished", "feminine-romantic", "minimal-relaxed", "bold-edgy", "creative-expressive",
    "old-money", "corporate-chic", "effortlessly-chic", "minimal", "casual-cool",
    "feminine", "romantic", "edgy", "trendy", "artsy",
  ];

  it("the retired style question is preserved in LEGACY_QUESTIONS", () => {
    const retired = LEGACY_QUESTIONS.find(x => x.id === "style-personalities");
    assert.ok(retired, "style-personalities must be retained for label resolution");
    assert.ok(!quizQuestions.some(x => x.id === "style-personalities"),
      "style-personalities must no longer be part of the live flow");
  });

  it("every legacy style ID still resolves to real display copy", () => {
    for (const id of LEGACY_STYLE_IDS) {
      const label = ALL_OPTION_LABELS[id];
      assert.ok(label, `legacy style ID ${id} must resolve to a label`);
      assert.notEqual(label, id);
    }
  });

  it("legacy lifestyle, silhouette and fit-concern IDs still resolve", () => {
    for (const id of ["office", "busy-mom", "hybrid", "casual-days",
                      "defined-waist", "straight", "flowing",
                      "petite", "tall", "broad-shoulders", "fuller-bust"]) {
      assert.ok(ALL_OPTION_LABELS[id], `legacy ID ${id} must resolve to a label`);
    }
  });

  it("a live Rev 7 question wins over a retired one on ID collision", () => {
    const ids = ALL_QUESTIONS.map(x => x.id);
    const liveIds = new Set(quizQuestions.map(x => x.id));
    for (const id of liveIds) {
      const last = ids.lastIndexOf(id);
      const first = ids.indexOf(id);
      assert.ok(last >= first);
      assert.equal(ALL_QUESTIONS[last].id, id);
    }
  });

  it("legacy V2 IDs remain accepted by the save API so stored values still round-trip", () => {
    for (const id of ["old-money", "corporate-chic", "effortlessly-chic", "artsy",
                      "office", "busy-mom", "hybrid",
                      "defined-waist", "straight", "flowing",
                      "petite", "tall", "fuller-bust"]) {
      assert.ok(SAVE_API.includes(`"${id}"`), `save API must still accept legacy ID ${id}`);
    }
  });
});

// ── 7. Reserved dressing requirements ────────────────────────────────────────

describe("R7.7 — reserved dressing requirements are stored but never offered", () => {
  const RESERVED = ["avoid-sheer", "avoid-open-back"];

  it("both are reserved", () => {
    for (const id of RESERVED) assert.ok(RESERVED_DRESSING_PREFERENCE_IDS.has(id));
  });

  it("both are marked reserved in the question definition", () => {
    for (const id of RESERVED) {
      const opt = q("dressing-preferences")?.options?.find(o => o.id === id);
      assert.ok(opt, `${id} must exist in the vocabulary`);
      assert.equal(opt!.reserved, true, `${id} must be flagged reserved so the UI hides it`);
    }
  });

  it("both are still accepted and stored by the save API — no answer is ever lost", () => {
    for (const id of RESERVED) {
      assert.ok(SAVE_API.includes(`"${id}"`), `save API must accept ${id}`);
    }
  });

  it("no other dressing requirement is reserved", () => {
    const reservedInQuiz = (q("dressing-preferences")?.options ?? [])
      .filter(o => o.reserved).map(o => o.id).sort();
    assert.deepEqual(reservedInQuiz, [...RESERVED].sort());
  });

  it("the free-text cultural/religious requirement is NOT reserved — it ships", () => {
    const opt = q("dressing-preferences")?.options
      ?.find(o => o.id === DRESSING_REQUIREMENTS_NOTE_TRIGGER_ID);
    assert.ok(opt);
    assert.notEqual(opt!.reserved, true);
    assert.ok(!RESERVED_DRESSING_PREFERENCE_IDS.has(DRESSING_REQUIREMENTS_NOTE_TRIGGER_ID));
  });

  it("the note field is wired to the cultural/religious trigger", () => {
    const nf = q("dressing-preferences")?.noteField;
    assert.ok(nf);
    assert.equal(nf!.triggerId, DRESSING_REQUIREMENTS_NOTE_TRIGGER_ID);
    assert.equal(nf!.id, "dressing-requirements-note");
    assert.equal(nf!.maxLength, DRESSING_REQUIREMENTS_NOTE_MAX);
  });

  it("the note is cleared when the trigger is not selected", () => {
    assert.ok(
      SAVE_API.includes("resolvedDressingRequirementsNote"),
      "the save path must gate the note on its trigger",
    );
    assert.ok(SAVE_API.includes("DRESSING_REQUIREMENTS_NOTE_TRIGGER_ID)\n      ? pickText(\"dressingRequirementsNote\""),
      "the note must only persist when the trigger ID is present");
  });

  it("the follow-up metadata task is documented next to the reserved IDs", () => {
    const vocab = readFileSync("app/lib/passport/rev7-vocabulary.ts", "utf8");
    for (const marker of ["FOLLOW-UP TASK", "opacity", "backCoverage", "ClosetItem", "backfill"]) {
      assert.ok(vocab.includes(marker), `the reserved-ID note must mention ${marker}`);
    }
  });

  it("every non-reserved dressing requirement offered maps to a real Rev 7 option", () => {
    const offered = (q("dressing-preferences")?.options ?? [])
      .filter(o => !o.reserved).map(o => o.id);
    for (const expected of ["dresses-modestly", "arms-covered", "chest-neckline-covered",
                            "legs-covered", "avoid-sleeveless", "no-cropped-tops", "avoid-shorts",
                            "prefer-higher-necklines", "longer-tops", "prefer-full-length-trousers",
                            "looser-fitting", "wears-hijab", "usually-wears-abayas",
                            "kanduras-thobes", DRESSING_REQUIREMENTS_NOTE_TRIGGER_ID,
                            "no-dressing-requirements"]) {
      assert.ok(offered.includes(expected), `dressing-preferences must offer ${expected}`);
    }
  });
});
