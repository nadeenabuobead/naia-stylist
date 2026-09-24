// app/lib/passport/rev7-q3-compat.test.ts
//
// Q3 compatibility + Rev 7 completion stamping.
//
// Q3 did not merely lose options when it became the Personality question — the
// question changed meaning. A stored "polished" answered "how do you want your
// clothes to come across", not "which words feel like you". Every surface must
// therefore treat retired Q3 values as history, never as a Personality answer,
// while the stored row itself is left untouched.
//
//   Q3C.1  a profile holding only retired Q3 values is missing Personality
//   Q3C.2  retired Q3 values never appear in the Personality picker
//   Q3C.3  retired Q3 values do not consume the max-3 cap
//   Q3C.4  opening and leaving Q3 without choosing does not erase legacy values
//   Q3C.5  saving new Personality answers replaces the retired values
//   Q3C.6  StyleMe / Buy or Skip use a labelled legacy fallback, and only until
//          a current Personality answer exists
//   Q3C.7  My nAia never presents legacy Style Expression as Personality
//   Q3C.8  the final Rev 7 top-up save sends the completion flag
//   Q3C.9  the server completeness guard blocks a premature V7 stamp
//   Q3C.10 a completed Rev 7 top-up stamps profileVersion = 7
//
// Run: node --test --import tsx/esm app/lib/passport/rev7-q3-compat.test.ts

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  STYLE_EXPRESSION_IDS,
  STYLE_EXPRESSION_CURRENT_IDS,
  STYLE_EXPRESSION_VALID_IDS,
  STYLE_EXPRESSION_MAX,
  RETIRED_STYLE_EXPRESSION_IDS,
  currentStyleExpression,
  legacyStyleExpression,
  splitStyleExpression,
} from "./rev7-vocabulary.js";
import { quizQuestions } from "../onboarding/quiz-data.js";
import { buildProfileSignals } from "../ai/styleme-result.server.js";

const PASSPORT  = readFileSync("app/routes/passport.tsx", "utf8");
const SAVE_API  = readFileSync("app/routes/api.save-style-profile.jsx", "utf8");
const DASH      = readFileSync("app/routes/my-naia._index.tsx", "utf8");
const STYLEME   = readFileSync("app/lib/ai/styleme-result.server.ts", "utf8");
const WISHLIST  = readFileSync("app/routes/api.wishlist.jsx", "utf8");
const ADMIN_CUS = readFileSync("app/routes/admin.naia.customers.$customerId.tsx", "utf8");
const ADMIN_ITM = readFileSync("app/routes/admin.naia.closet.$itemId.tsx", "utf8");

/** A profile as it exists for a Rev 6 customer who has never answered new Q3. */
const LEGACY_ONLY = ["quiet-confidence", "polished", "effortless"];

// ── Vocabulary foundation ────────────────────────────────────────────────────

describe("Q3C.0 — current vs valid vocabulary", () => {
  it("offers exactly 14 current Personality IDs", () => {
    assert.equal(STYLE_EXPRESSION_CURRENT_IDS.size, 14);
  });

  it("keeps every retired ID server-valid for backward compatibility", () => {
    for (const id of RETIRED_STYLE_EXPRESSION_IDS) {
      assert.ok(STYLE_EXPRESSION_VALID_IDS.has(id), `${id} must stay valid on re-save`);
      assert.ok(!STYLE_EXPRESSION_CURRENT_IDS.has(id), `${id} must not be a current answer`);
    }
  });

  it("current and valid partition the vocabulary with no gaps", () => {
    assert.equal(
      STYLE_EXPRESSION_CURRENT_IDS.size + RETIRED_STYLE_EXPRESSION_IDS.size,
      new Set(STYLE_EXPRESSION_IDS).size,
    );
  });

  it("never blends the two vocabularies", () => {
    const mixed = splitStyleExpression(["polished", "calm", "effortless"]);
    assert.deepEqual(mixed.current, ["calm"]);
    assert.deepEqual(mixed.legacy, [], "legacy is suppressed once a current answer exists");

    const legacyOnly = splitStyleExpression(LEGACY_ONLY);
    assert.deepEqual(legacyOnly.current, []);
    assert.deepEqual(legacyOnly.legacy, LEGACY_ONLY);

    assert.deepEqual(splitStyleExpression([]), { current: [], legacy: [] });
    assert.deepEqual(splitStyleExpression(null), { current: [], legacy: [] });
  });
});

// ── 1. Personality counted as missing ────────────────────────────────────────

describe("Q3C.1 — a retired-only profile is missing Personality", () => {
  it("has no current Personality answer", () => {
    assert.equal(currentStyleExpression(LEGACY_ONLY).length, 0);
    assert.deepEqual(legacyStyleExpression(LEGACY_ONLY), LEGACY_ONLY);
  });

  it("missingRev7Sections measures style-expression on current IDs only", () => {
    const block = PASSPORT.slice(
      PASSPORT.indexOf("const missingRev7Sections"),
      PASSPORT.indexOf("const needsRev7"),
    );
    assert.ok(block.includes('primary.draftKey === "style-expression"'),
      "the top-up scan must special-case style-expression");
    assert.ok(/currentStyleExpression\([\s\S]*?\)\.length === 0/.test(block),
      "it must treat a retired-only value as unanswered");
  });

  it("the dashboard invitation also survives a retired-only Personality", () => {
    const block = DASH.slice(DASH.indexOf("const missingRev7Answers"), DASH.indexOf("return {", DASH.indexOf("const missingRev7Answers")));
    assert.ok(block.includes("currentStyleExpression"),
      "the Rev 7 invitation must not be satisfied by retired Q3 values");
  });
});

// ── 2. Picker never shows retired Q3 values ──────────────────────────────────

describe("Q3C.2 — retired Q3 values never render in the Personality picker", () => {
  const RENDER = PASSPORT.slice(
    PASSPORT.indexOf("function renderSubField"),
    PASSPORT.indexOf("// ── OVERVIEW"),
  );

  it("suppresses the selected-option escape hatch for style-expression", () => {
    assert.ok(RENDER.includes('const isStyleExpression = sf.draftKey === "style-expression"'));
    const filters = RENDER.match(/\.filter\(o => \(!o\.reserved && !o\.retired\)[^)]*\)+/g) ?? [];
    assert.ok(filters.length >= 2, "both the single and array pickers must be covered");
    for (const f of filters) {
      assert.ok(f.includes("!isStyleExpression"),
        `picker filter must exclude retired Q3 options: ${f}`);
    }
  });

  it("other questions keep showing a retired option that is still selected", () => {
    // Q12's retired habits remain true of the customer, so they stay visible.
    assert.ok(RENDER.includes("sel.includes(o.id)"),
      "the escape hatch must still exist for every other question");
  });

  it("the draft is prefilled from the current vocabulary only", () => {
    const initEdits = PASSPORT.slice(PASSPORT.indexOf("function initEdits"), PASSPORT.indexOf("function startContinue"));
    assert.ok(initEdits.includes('draftKey === "style-expression"'));
    assert.ok(initEdits.includes("currentStyleExpression(arr)"));

    const initRefresh = PASSPORT.slice(PASSPORT.indexOf("function initRefreshEdits"), PASSPORT.indexOf("function startRefresh"));
    assert.ok(initRefresh.includes('rf.draftKey === "style-expression"'));
    assert.ok(initRefresh.includes("currentStyleExpression"));
  });

  it("the question itself still carries the retired options for label resolution", () => {
    const q3 = quizQuestions.find(q => q.id === "style-expression");
    assert.ok(q3, "Q3 must exist");
    const retiredOpts = (q3!.options ?? []).filter(o => (o as { retired?: boolean }).retired);
    assert.equal(retiredOpts.length, RETIRED_STYLE_EXPRESSION_IDS.size,
      "every retired ID keeps a label so no stored answer degrades to a slug");
  });
});

// ── 3. Cap ───────────────────────────────────────────────────────────────────

describe("Q3C.3 — retired Q3 values do not consume the max-3 cap", () => {
  it("the server counts current IDs against the cap", () => {
    const block = SAVE_API.slice(
      SAVE_API.indexOf('if (Object.hasOwn(body, "styleExpression"))'),
      SAVE_API.indexOf('// explorationLevel — single-select'),
    );
    assert.ok(block.includes("currentStyleExpression(v).length > STYLE_EXPRESSION_MAX"),
      "the cap must be measured on current Personality answers");
    assert.ok(!/\bv\.length > STYLE_EXPRESSION_MAX\b/.test(block),
      "the raw array length must no longer gate the cap");
  });

  it("a retired-only array of cap length leaves all three slots free", () => {
    assert.equal(currentStyleExpression(LEGACY_ONLY).length, 0);
    assert.equal(STYLE_EXPRESSION_MAX - currentStyleExpression(LEGACY_ONLY).length, 3);
  });

  it("the picker's atCap is derived from the stripped draft", () => {
    const RENDER = PASSPORT.slice(PASSPORT.indexOf("function renderSubField"), PASSPORT.indexOf("// ── OVERVIEW"));
    assert.ok(RENDER.includes("const atCap = sel.length >= max"),
      "atCap reads the draft, which initEdits already stripped to current IDs");
  });
});

// ── 4. Empty-draft guard ─────────────────────────────────────────────────────

describe("Q3C.4 — opening and leaving Q3 without choosing preserves history", () => {
  const GUARD = SAVE_GUARD();

  function SAVE_GUARD() {
    const start = PASSPORT.indexOf("let patch = computeSectionPatch");
    return PASSPORT.slice(start, PASSPORT.indexOf('if (sectionId === "about-you")', start));
  }

  it("drops a styleExpression patch that would clear a retired-only value", () => {
    assert.ok(GUARD.includes('Object.hasOwn(patch, "styleExpression")'));
    assert.ok(GUARD.includes("drafted.length === 0"));
    assert.ok(GUARD.includes("currentStyleExpression(stored).length === 0"));
    assert.ok(GUARD.includes("stored.length > 0"),
      "a genuinely empty stored value must not be special-cased");
  });

  it("collapses to no request when Personality was the only field", () => {
    assert.ok(GUARD.includes("patch = Object.keys(rest).length > 0 ? rest : null"),
      "an otherwise-empty patch must become null so no save is issued");
  });

  it("does not suppress a real clear by a customer who has current answers", () => {
    // stored = ["calm"] → currentStyleExpression(stored).length === 1 → guard inert.
    assert.equal(currentStyleExpression(["calm"]).length, 1);
  });
});

// ── 5. Replacement on save ───────────────────────────────────────────────────

describe("Q3C.5 — saving new Personality answers replaces the retired values", () => {
  it("the API drops retired carry-over once a current answer is present", () => {
    const start = SAVE_API.indexOf("// Rev 7 exclusive rules");
    const block = SAVE_API.slice(start, SAVE_API.indexOf('if (Object.hasOwn(body, "styleDirections"))', start));
    assert.ok(block.includes("const current = currentStyleExpression(withExclusive)"));
    assert.ok(block.includes('body["styleExpression"] = current.length > 0 ? current : withExclusive'),
      "a mixed submission must store the current vocabulary only");
  });

  it("an all-retired submission is preserved untouched", () => {
    // current.length === 0 → the original array is stored, so an un-migrated
    // profile re-saving another section never loses or fails on its history.
    assert.deepEqual(currentStyleExpression(LEGACY_ONLY), []);
  });

  it("section patches replace arrays wholesale", () => {
    assert.ok(PASSPORT.includes("if (!arraysEqualAsSet(edited, current)) { patch[apiKey] = edited; hasChange = true; }"),
      "array fields are replaced, not merged, so the new answer supersedes the old");
  });
});

// ── 6. AI-facing labelled fallback ───────────────────────────────────────────

describe("Q3C.6 — StyleMe and Buy or Skip use a labelled legacy fallback", () => {
  it("buildProfileSignals carries current answers as styleExpression", () => {
    const s = buildProfileSignals({ styleExpression: ["calm", "playful"] } as never);
    assert.deepEqual(s.styleExpression, ["calm", "playful"]);
    assert.equal((s as { legacyStyleExpression?: string[] }).legacyStyleExpression, undefined,
      "no fallback once a current answer exists");
  });

  it("buildProfileSignals carries retired answers under a separate key", () => {
    const s = buildProfileSignals({ styleExpression: LEGACY_ONLY } as never) as {
      styleExpression?: string[]; legacyStyleExpression?: string[];
    };
    assert.equal(s.styleExpression, undefined, "retired values are never Personality");
    assert.deepEqual(s.legacyStyleExpression, LEGACY_ONLY);
  });

  it("a mixed stored value yields only the current answers", () => {
    const s = buildProfileSignals({ styleExpression: ["polished", "calm"] } as never) as {
      styleExpression?: string[]; legacyStyleExpression?: string[];
    };
    assert.deepEqual(s.styleExpression, ["calm"]);
    assert.equal(s.legacyStyleExpression, undefined);
  });

  it("an empty profile carries neither key", () => {
    const s = buildProfileSignals({} as never) as Record<string, unknown>;
    assert.equal(s.styleExpression, undefined);
    assert.equal(s.legacyStyleExpression, undefined);
  });

  for (const [name, src] of [["StyleMe", STYLEME], ["Buy or Skip", WISHLIST]] as const) {
    it(`${name} labels the fallback "Earlier Style Expression", never Personality`, () => {
      assert.ok(src.includes("Earlier Style Expression"),
        "the legacy line must carry its own explicit label");
      const line = src.slice(src.indexOf("Earlier Style Expression"));
      const sentence = line.slice(0, line.indexOf("\n"));
      assert.ok(!sentence.includes("Personality (words"),
        "the legacy line must not reuse the Personality description");
    });

    it(`${name} suppresses the fallback as soon as a current answer exists`, () => {
      assert.ok(/!(styleExpressionStr|personalityStr) && (legacyStyleExpressionStr|legacyExpressionStr)/.test(src),
        "the fallback must be gated on the absence of a current Personality answer");
    });

    it(`${name} derives both strings from splitStyleExpression`, () => {
      assert.ok(src.includes("splitStyleExpression"),
        "both vocabularies must come from the single mutually-exclusive helper");
    });
  }

  it("introduces no scoring weight for either vocabulary", () => {
    const weights = STYLEME.slice(STYLEME.indexOf("SCORING_WEIGHTS"));
    assert.ok(!weights.includes("legacyStyleExpression"),
      "the legacy fallback is prompt context only");
  });
});

// ── 7. User-facing surfaces ──────────────────────────────────────────────────

describe("Q3C.7 — customer surfaces never present legacy values as Personality", () => {
  it("the dashboard snapshot filters to current IDs", () => {
    const snap = DASH.slice(DASH.indexOf("function PassportSnapshot"), DASH.indexOf("export async function loader"));
    assert.ok(/currentStyleExpression\(arr\("styleExpression"/.test(snap),
      "the Personality row must be built from current IDs only");
  });

  it("the Passport overview shows Personality from current IDs only", () => {
    assert.ok(PASSPORT.includes('const styleExpression  = currentStyleExpression(getArr("style-expression"))'),
      "the dossier cell must filter before rendering");
  });

  it("a retired-only profile reads as not yet set rather than blank-labelled", () => {
    const cell = PASSPORT.slice(PASSPORT.indexOf('<span className="sp-ov-section-header">Personality</span>'));
    assert.ok(cell.slice(0, 900).includes("Optional — not yet set"),
      "an empty Personality cell must invite an answer");
  });

  it("admin separates current Personality from earlier answers", () => {
    for (const [name, src] of [["customer detail", ADMIN_CUS], ["closet item", ADMIN_ITM]] as const) {
      assert.ok(src.includes("const personalitySplit = splitStyleExpression(ctx.styleExpression)"),
        `${name} must split the stored value`);
      assert.ok(src.includes('{ label: "Personality", field: "styleExpression", values: personalitySplit.current }'),
        `${name} Personality row must carry current IDs only`);
      assert.ok(src.includes('{ label: "Earlier Style Expression", field: "styleExpression", values: personalitySplit.legacy }'),
        `${name} must show retired values under their own label`);
      assert.ok(!src.includes('{ label: "Personality", field: "styleExpression", values: ctx.styleExpression }'),
        `${name} must no longer label the raw array Personality`);
    }
  });
});

// ── 8. Completion flag ───────────────────────────────────────────────────────

describe("Q3C.8 — the final Rev 7 top-up save sends the completion flag", () => {
  it("the top-up queue is marked on the flow mode", () => {
    assert.ok(PASSPORT.includes('setMode({ kind: "flow", queue: missingRev7Sections.map(sec => sec.id), index: 0, rev7TopUp: true })'),
      "startRev7TopUp must mark its queue");
    assert.ok(PASSPORT.includes('kind: "flow"; queue: SectionId[]; index: number; done?: boolean; rev7TopUp?: true'),
      "the Mode type must carry the marker");
  });

  it("saveSection sends onboardingComplete on the last top-up step", () => {
    assert.ok(PASSPORT.includes("mode.kind === \"flow\" && mode.rev7TopUp === true && mode.index + 1 >= mode.queue.length"),
      "the flag must be gated on the final step of a top-up queue");
    assert.ok(PASSPORT.includes("if (isLegacyCustomer || isFinalRev7TopUpStep)"),
      "Rev 6 customers must now reach the stamp path too");
  });

  it("an ordinary section edit still does not request the stamp", () => {
    // editSection() builds a single-section queue with no rev7TopUp marker.
    assert.ok(PASSPORT.includes('setMode({ kind: "flow", queue: [id], index: 0 })'),
      "a plain edit queue carries no top-up marker, so no flag is sent");
  });
});

// ── 9 + 10. Server guard remains authoritative ───────────────────────────────

describe("Q3C.9 — the completeness guard blocks a premature V7 stamp", () => {
  const GUARD = SAVE_API.slice(
    SAVE_API.indexOf('if (body["onboardingComplete"] === true)'),
    SAVE_API.indexOf("if (op) {"),
  );

  it("measures styleExpression on current Personality IDs", () => {
    assert.ok(GUARD.includes('["styleExpression",       currentStyleExpression(profileData.styleExpression)]'),
      "a retired-only value must not satisfy the Personality requirement");
  });

  it("still requires every other Rev 7 field", () => {
    for (const f of ["currentGoal", "successfulOutfitGives", "styleDirections",
                     "lifestyle", "favoriteColors", "silhouette", "fitConcerns", "dressingHabits"]) {
      assert.ok(GUARD.includes(`"${f}"`), `${f} must remain required`);
    }
    assert.ok(GUARD.includes("if (!profileData.explorationLevel) missingRev7.push"),
      "explorationLevel must remain required");
  });

  it("stamps only when nothing is missing", () => {
    assert.ok(GUARD.includes("if (missingRev7.length === 0) {"));
    assert.ok(GUARD.includes("profileData.profileVersion = REV7_PROFILE_VERSION"));
    const stampIdx = GUARD.indexOf("profileData.profileVersion = REV7_PROFILE_VERSION");
    const checkIdx = GUARD.indexOf("if (missingRev7.length === 0) {");
    assert.ok(checkIdx < stampIdx && checkIdx !== -1, "the stamp must sit inside the guard");
  });

  it("the guard was not weakened or bypassed", () => {
    const stamps = SAVE_API.match(/profileData\.profileVersion\s*=/g) ?? [];
    assert.equal(stamps.length, 1, "profileVersion must be assigned in exactly one place");
    assert.ok(SAVE_API.includes('if (body["onboardingComplete"] === true) {'),
      "the stamp must stay gated on an explicit completion request");
  });
});

describe("Q3C.10 — a completed Rev 7 top-up stamps profileVersion = 7", () => {
  it("every required field a top-up collects is reachable from its queue", () => {
    const ids = PASSPORT.slice(PASSPORT.indexOf("const REV7_SECTION_IDS"), PASSPORT.indexOf("const missingRev7Sections"));
    for (const sec of ["style-expression", "exploration", "style-directions", "dressing-habits"]) {
      assert.ok(ids.includes(`"${sec}"`), `${sec} must be part of the Rev 7 top-up`);
    }
  });

  it("the stamped value is the Rev 7 constant, not a literal", () => {
    assert.ok(SAVE_API.includes("profileData.profileVersion = REV7_PROFILE_VERSION;"));
    assert.ok(!/profileData\.profileVersion\s*=\s*7\b/.test(SAVE_API), "no hardcoded 7");
  });

  it("a Rev 6 profile is not rejected while it remains incomplete", () => {
    const GUARD = SAVE_API.slice(SAVE_API.indexOf('if (body["onboardingComplete"] === true)'), SAVE_API.indexOf("if (op) {"));
    assert.ok(GUARD.includes("if (missingRev7.length > 0 && !op?.completed)"),
      "an already-complete profile must not 400 — it simply stays unstamped");
  });
});
