// app/lib/passport/rev7-validation.test.ts
//
// Passport Rev 7 — save/load behaviour and downstream consumer contract.
//
//   1. Save API recognises and persists the Rev 7 fields
//   2. stylePersonalities is never written by the Rev 7 flow
//   3. Completion guard requires the Rev 7 answer set and stamps profileVersion 7
//   4. buildProfileSignals surfaces the Rev 7 fields (legacy profiles unchanged)
//   5. Scoring reads the projection, not the stale legacy row
//   6. Strict dressing requirements stay constraints, not preferences
//   7. Rev 7 fields are NOT added to the regenerate/session fingerprint
//
// Run: node --test --import tsx/esm app/lib/passport/rev7-validation.test.ts

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildProfileSignals } from "../ai/styleme-result.server.js";
import { scoringArchetypesFor } from "../ai/styleme-anchor.server.js";
import { computeNaiaFirstRead } from "../ai/first-naia-read.js";

const SAVE_API = readFileSync("app/routes/api.save-style-profile.jsx", "utf8");
const RECOMMEND = readFileSync("app/lib/ai/styleme-recommendation.ts", "utf8");
const RESULT = readFileSync("app/lib/ai/styleme-result.server.ts", "utf8");
const WISHLIST = readFileSync("app/routes/api.wishlist.jsx", "utf8");
const PASSPORT = readFileSync("app/routes/passport.tsx", "utf8");

const REV7_FIELDS = [
  "styleExpression",
  "explorationLevel",
  "styleDirections",
  "dressingHabits",
  "dressingRequirementsNote",
] as const;

// A fully-populated Rev 7 profile row as Prisma would return it.
const rev7Profile = {
  stylePersonalities: ["old-money"],          // stale legacy row — must not be used
  styleDirections: ["polished-refined", "sporty-functional"],
  styleExpression: ["quiet-confidence", "understated"],
  explorationLevel: "familiar-small-twists",
  dressingHabits: ["overthink", "play-it-safe"],
  dressingRequirementsNote: "  I follow a community dress code.  ",
  dressingPreferences: ["dresses-modestly", "other-cultural-religious"],
  lifestyle: ["work-office", "fitness-gym", "mostly-at-home", "travel", "study-university"],
  favoriteColors: ["navy", "blue"],
  silhouette: ["fitted", "longline", "cropped-fit", "mixing-fits"],
  fitConcerns: ["fabric-texture-sensitivity"],
};

// ── 1. Save API field recognition ────────────────────────────────────────────

describe("R7V.1 — save API recognises and persists the Rev 7 fields", () => {
  for (const f of REV7_FIELDS) {
    it(`${f} is a recognised field`, () => {
      assert.ok(
        new RegExp(`"${f}"`).test(SAVE_API.slice(0, SAVE_API.indexOf("export async function action"))),
        `${f} must appear in the recognised/array field lists`,
      );
    });

    it(`${f} is written to profileData`, () => {
      assert.ok(
        new RegExp(`${f}:\\s+`).test(SAVE_API.slice(SAVE_API.indexOf("const profileData = {"))),
        `${f} must be persisted`,
      );
    });
  }

  it("the three new array fields are type-checked as string arrays", () => {
    const arrayBlock = SAVE_API.slice(
      SAVE_API.indexOf("const ARRAY_FIELDS"),
      SAVE_API.indexOf("const ARRAY_FIELDS") + 1200,
    );
    for (const f of ["styleExpression", "styleDirections", "dressingHabits"]) {
      assert.ok(arrayBlock.includes(`"${f}"`), `${f} must be in ARRAY_FIELDS`);
    }
  });

  it("partial-patch behaviour is preserved — absent keys fall back to the stored value", () => {
    for (const f of ["styleExpression", "styleDirections", "dressingHabits"]) {
      assert.ok(SAVE_API.includes(`pickArr("${f}",`), `${f} must use the pickArr fallback`);
    }
    assert.ok(SAVE_API.includes('pickText("explorationLevel", op?.explorationLevel)'));
  });

  it("unknown top-level keys are still rejected", () => {
    assert.ok(SAVE_API.includes("if (!REQUEST_ONLY_KEYS.has(key) && !RECOGNISED_FIELDS.has(key))"));
  });

  it("avoid-colors option IDs now resolve (secondary questions are registered)", () => {
    assert.ok(
      SAVE_API.includes("VALID_OPTION_IDS[sq.id] = new Set(sq.colors.map(c => c.id))"),
      "the secondary colour question must be registered or every avoidColors save is rejected",
    );
  });
});

// ── 2. stylePersonalities is never written by the Rev 7 flow ─────────────────

describe("R7V.2 — legacy style field is preserved, not rewritten", () => {
  it("the Rev 7 onboarding flow does not emit a style-personalities key", () => {
    const quiz = readFileSync("app/lib/onboarding/quiz-data.ts", "utf8");
    const flow = quiz.slice(
      quiz.indexOf("export const quizQuestions"),
      quiz.indexOf("export const LEGACY_QUESTIONS"),
    );
    assert.ok(!flow.includes('id: "style-personalities"'),
      "style-personalities must not be part of the live flow");
  });

  it("the refresh flow asks style-directions, not style-personalities", () => {
    const refresh = PASSPORT.slice(
      PASSPORT.indexOf("const REFRESH_SCREENS: RefreshScreen[] = ["),
      PASSPORT.indexOf("const COLOURS_REFRESH_SCREEN"),
    );
    assert.ok(refresh.includes('apiKey: "styleDirections"'),
      "the legacy refresh must collect styleDirections");
    assert.ok(!refresh.includes('apiKey: "stylePersonalities"'),
      "the legacy refresh must no longer write stylePersonalities");
  });

  it("the refresh does not prefill style directions from legacy archetypes", () => {
    const refresh = PASSPORT.slice(
      PASSPORT.indexOf('screenId: "r-identity"'),
      PASSPORT.indexOf('screenId: "r-lifestyle"'),
    );
    assert.ok(refresh.includes("noAutoFill: true"),
      "legacy archetypes are a different vocabulary — nothing may be prefilled");
  });

  it("stylePersonalities still round-trips for a legacy customer", () => {
    const signals = buildProfileSignals({ stylePersonalities: ["old-money", "artsy"] });
    assert.deepEqual(signals?.stylePersonalities, ["old-money", "artsy"]);
    assert.equal(signals?.styleDirections, undefined);
  });

  it("the retired question stays editable for legacy and Rev 6 customers", () => {
    assert.ok(PASSPORT.includes("rev7Hidden: true"),
      "the retired Style section must be hidden only for Rev 7 customers");
  });
});

// ── 3. Completion guard ──────────────────────────────────────────────────────

describe("R7V.3 — completion guard", () => {
  const guard = SAVE_API.slice(SAVE_API.indexOf("const requiredRev7Arrays"));

  it("stamps profileVersion 7, not 6", () => {
    assert.ok(SAVE_API.includes("profileData.profileVersion = REV7_PROFILE_VERSION"));
    assert.ok(!SAVE_API.includes("profileData.profileVersion = 6"));
  });

  it("requires every core Rev 7 answer", () => {
    for (const f of ["currentGoal", "successfulOutfitGives", "styleExpression", "styleDirections",
                     "lifestyle", "favoriteColors", "silhouette", "fitConcerns", "dressingHabits"]) {
      assert.ok(guard.includes(`"${f}"`), `${f} must be required for completion`);
    }
    assert.ok(guard.includes('missingRev7.push("explorationLevel")'),
      "explorationLevel is a single-select and must be checked separately");
  });

  it("does NOT require the optional dressing requirements question", () => {
    const required = guard.slice(0, guard.indexOf("];"));
    assert.ok(!required.includes('"dressingPreferences"'),
      "dressing requirements are explicitly optional");
  });

  it("does NOT gate completion on the retired stylePersonalities field", () => {
    const required = guard.slice(0, guard.indexOf("];"));
    assert.ok(!required.includes('"stylePersonalities"'),
      "a legacy customer's stored archetype must not block Rev 7 completion");
  });

  it("one or more lifestyle values satisfies the requirement", () => {
    assert.ok(guard.includes("!Array.isArray(v) || v.length === 0"),
      "lifestyle passes on any non-empty array — there is no cap and no minimum above 1");
  });

  it("reports which fields are missing rather than failing opaquely", () => {
    assert.ok(SAVE_API.includes('error: "incomplete_rev7_profile", missingFields: missingRev7'));
  });

  it("normal section saves never stamp a profile version", () => {
    assert.ok(SAVE_API.includes('if (body["onboardingComplete"] === true) {'),
      "version stamping must stay behind the onboardingComplete flag");
  });
});

// ── 4. buildProfileSignals ───────────────────────────────────────────────────

describe("R7V.4 — Rev 7 fields reach the recommendation layer", () => {
  const signals = buildProfileSignals(rev7Profile)!;

  it("styleExpression is surfaced", () => {
    assert.deepEqual(signals.styleExpression, ["quiet-confidence", "understated"]);
  });

  it("explorationLevel is surfaced", () => {
    assert.equal(signals.explorationLevel, "familiar-small-twists");
  });

  it("styleDirections is surfaced verbatim", () => {
    assert.deepEqual(signals.styleDirections, ["polished-refined", "sporty-functional"]);
  });

  it("dressingHabits is surfaced", () => {
    assert.deepEqual(signals.dressingHabits, ["overthink", "play-it-safe"]);
  });

  it("dressingRequirementsNote is surfaced and trimmed", () => {
    assert.equal(signals.dressingRequirementsNote, "I follow a community dress code.");
  });

  it("the archetype projection is computed alongside the raw directions", () => {
    assert.deepEqual(signals.styleDirectionArchetypes, ["classic-polished"]);
  });

  it("unmapped directions are tracked, not dropped", () => {
    assert.deepEqual(signals.unmappedStyleDirections, ["sporty-functional"]);
  });

  it("an uncapped lifestyle selection survives intact", () => {
    assert.equal(signals.lifestyle?.length, 5);
  });

  it("a legacy profile is completely unaffected", () => {
    const legacy = buildProfileSignals({
      stylePersonalities: ["corporate-chic"],
      lifestyle: ["office"],
      favoriteColors: ["black"],
    })!;
    assert.deepEqual(legacy.stylePersonalities, ["corporate-chic"]);
    for (const f of ["styleExpression", "explorationLevel", "styleDirections",
                     "dressingHabits", "dressingRequirementsNote",
                     "styleDirectionArchetypes", "unmappedStyleDirections"]) {
      assert.equal((legacy as Record<string, unknown>)[f], undefined,
        `${f} must be absent for a legacy profile`);
    }
  });

  it("an empty profile still yields undefined, not an empty husk", () => {
    assert.equal(buildProfileSignals(null), undefined);
  });

  it("a blank dressingRequirementsNote is not surfaced", () => {
    const s = buildProfileSignals({ ...rev7Profile, dressingRequirementsNote: "   " })!;
    assert.equal(s.dressingRequirementsNote, undefined);
  });
});

// ── 5. Scoring reads the projection ──────────────────────────────────────────

describe("R7V.5 — the numeric scorer uses the projection, never the stale legacy row", () => {
  it("scoringArchetypesFor prefers the projection", () => {
    assert.deepEqual(
      scoringArchetypesFor({ stylePersonalities: ["old-money"], styleDirectionArchetypes: ["bold-edgy"] }),
      ["bold-edgy"],
    );
  });

  it("scoringArchetypesFor falls back to the legacy row", () => {
    assert.deepEqual(scoringArchetypesFor({ stylePersonalities: ["old-money"] }), ["old-money"]);
  });

  it("scoringArchetypesFor tolerates null/undefined", () => {
    assert.deepEqual(scoringArchetypesFor(null), []);
    assert.deepEqual(scoringArchetypesFor(undefined), []);
  });

  it("the NADINE catalogue scorer reads styleDirectionArchetypes first", () => {
    assert.ok(
      RECOMMEND.includes("profile?.styleDirectionArchetypes?.length"),
      "the archetype scorer must consume the Rev 7 projection",
    );
  });

  it("no new numeric weight is introduced for any Rev 7 field", () => {
    for (const f of REV7_FIELDS) {
      assert.ok(
        !new RegExp(`SCORING_WEIGHTS\\.[A-Z_]*${f.toUpperCase()}`).test(RECOMMEND),
        `${f} must not have been given a scoring weight in this revision`,
      );
    }
    assert.ok(!RECOMMEND.includes("STYLE_EXPRESSION_WEIGHT"));
    assert.ok(!RECOMMEND.includes("EXPLORATION_LEVEL_WEIGHT"));
    assert.ok(!RECOMMEND.includes("DRESSING_HABIT_WEIGHT"));
  });

  it("First Read uses styleDirections when present and stylePersonalities otherwise", () => {
    const rev7 = computeNaiaFirstRead({
      styleDirections: ["polished-refined"],
      stylePersonalities: ["artsy"],
      silhouette: ["fitted"],
    });
    const styleObs = rev7.observations.find(o => o.type === "style-direction")!;
    assert.ok(styleObs.evidenceFields.includes("styleDirections"));
    assert.ok(!styleObs.evidenceFields.includes("stylePersonalities"));
    assert.ok(styleObs.claim.includes("polished and refined"));
    assert.ok(!styleObs.claim.includes("artistic"));

    const legacy = computeNaiaFirstRead({ stylePersonalities: ["artsy"], silhouette: ["fitted"] });
    const legacyObs = legacy.observations.find(o => o.type === "style-direction")!;
    assert.ok(legacyObs.evidenceFields.includes("stylePersonalities"));
  });

  it("a legacy First Read observation key is byte-identical to before Rev 7", () => {
    const legacy = computeNaiaFirstRead({ stylePersonalities: ["artsy"], silhouette: ["fitted"] });
    const obs = legacy.observations.find(o => o.type === "style-direction")!;
    assert.equal(
      obs.observationKey,
      // makeKey sorts field names, so the key is insertion-order independent.
      "first-read-v1|style-direction|silhouette:fitted|stylePersonalities:artsy",
      "changing this key would orphan every stored NaiaObservationFeedback row",
    );
  });
});

// ── 6. Strict dressing requirements stay constraints ─────────────────────────

describe("R7V.6 — dressing requirements remain constraints, not preferences", () => {
  it("dressingPreferences is still always populated for the hard-exclusion engine", () => {
    const signals = buildProfileSignals({ stylePersonalities: ["minimal"] })!;
    assert.deepEqual(signals.dressingPreferences, [],
      "an empty array, not undefined, so the engine does not fall back to its own default");
  });

  it("the hard-exclusion engine still runs on dressingPreferences", () => {
    assert.ok(RECOMMEND.includes("dressingPreferenceIds"));
    assert.ok(RECOMMEND.includes('dressingPreferenceIds.has("dresses-modestly")'));
  });

  it("the StyleMe prompt states the free-text requirement is a requirement, not a preference", () => {
    assert.ok(RESULT.includes("Cultural or religious dressing requirement"));
    assert.ok(RESULT.includes("not as a preference"));
    assert.ok(RESULT.includes("do not recommend that piece"));
  });

  it("Buy or Skip gives the free-text requirement the same standing as the explicit ones", () => {
    assert.ok(WISHLIST.includes("CULTURAL OR RELIGIOUS DRESSING REQUIREMENT"));
    assert.ok(WISHLIST.includes("same standing as the explicit requirements above"));
    assert.ok(WISHLIST.includes("must not receive a BUY verdict"));
  });

  it("the free-text requirement is never turned into an invented deterministic rule", () => {
    assert.ok(WISHLIST.includes("Do not reinterpret, narrow, or infer additional rules"));
    for (const src of [RECOMMEND, RESULT]) {
      assert.ok(
        !/dressingRequirementsNote[\s\S]{0,400}(isExcluded|hardExclusion|checkHardExclusions)/.test(src),
        "the free-text note must not drive the deterministic exclusion engine",
      );
    }
  });

  it("the note is sanitised before it enters either prompt", () => {
    assert.ok(RESULT.includes("safeDressingRequirementsNote"));
    assert.ok(WISHLIST.includes("sanitize(styleProfile.dressingRequirementsNote)"));
  });

  it("the four new signals are labelled so the model understands each distinction", () => {
    for (const src of [RESULT, WISHLIST]) {
      assert.ok(src.includes("words this customer says feel most like them"));
      assert.ok(src.includes("how far nAia should move beyond"));
      assert.ok(src.includes("the visual aesthetics this customer is drawn to"));
      assert.ok(src.includes("behavioural context"));
    }
  });

  it("unmapped style directions are still named in the StyleMe prompt", () => {
    assert.ok(RESULT.includes("unmappedDirectionsStr"));
    assert.ok(RESULT.includes("treat as a first-class style signal"));
  });
});

// ── 7. Regeneration behaviour is unchanged ───────────────────────────────────

describe("R7V.7 — the session fingerprint is untouched", () => {
  const fingerprint = RECOMMEND.slice(
    RECOMMEND.indexOf("function buildSessionFingerprint"),
    RECOMMEND.indexOf("function buildSessionFingerprint") + 2000,
  );

  it("no Rev 7 field is mixed into the regenerate fingerprint", () => {
    for (const f of [...REV7_FIELDS, "styleDirectionArchetypes", "unmappedStyleDirections"]) {
      assert.ok(!fingerprint.includes(f),
        `${f} must not change regenerate behaviour for existing sessions`);
    }
  });

  it("the fingerprint still reads stylePersonalities exactly as before", () => {
    assert.ok(fingerprint.includes("profile?.stylePersonalities ?? []"));
  });
});
