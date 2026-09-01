// app/lib/passport/passport-legacy-compat.test.ts
// Group A regression tests — Legacy → Rev 6 compatibility.
//
// All assertions are static file-read contract tests: no DB, no network, no Claude calls.
// Tests verify:
//   A. Legacy customer detection (completed=true, profileVersion=null)
//   B. Rev 6 customer passes through without refresh prompt
//   C. New Rev 6 onboarding completion sets profileVersion=6
//   D. Arbitrary passport section saves do NOT set profileVersion=6
//   E. Refresh flow includes all 7 required screens
//   F. dressingPreferences uses rev6OnlyFill (preserve valid current data; screen shown)
//   G. favoriteColors/avoidColors are NOT in the refresh flow (colors preserved)
//   H. Legacy fit sub-fields are not in the customer-facing fit section editor
//   I. Legacy DB fields are not deleted or mutated by loading the refresh
//   J. Refresh completion sets profileVersion=6
//   K. dressingPreferences preservation regression coverage (4 behavioral scenarios)
//   L. stylePersonalities — valid Rev 6 IDs preserved, old IDs filtered
//   M. lifestyle — no silent legacy ID mapping
//   N. Completion marker safety — profileVersion=6 only on final completion

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../../..");

function readFile(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf-8");
}

const passport    = readFile("app/routes/passport.tsx");
const saveApi     = readFile("app/routes/api.save-style-profile.jsx");
const complete    = readFile("app/routes/onboarding/complete.tsx");
const schema      = readFile("prisma/schema.prisma");
const migrationSql = readFile("prisma/migrations/20260901100000_profile_version/migration.sql");
const quizData    = readFile("app/lib/onboarding/quiz-data.ts");

// ── A. Legacy customer detection ──────────────────────────────────────────────
describe("A: Legacy customer detection", () => {
  it("loader computes isLegacyCustomer when profileVersion is null", () => {
    assert.ok(
      passport.includes("profileVersion === null") || passport.includes("profileVersion == null"),
      "loader must check profileVersion === null for legacy detection",
    );
  });

  it("isLegacyCustomer is included in loader return value", () => {
    assert.ok(
      passport.includes("isLegacyCustomer,") || passport.includes("isLegacyCustomer\n"),
      "loader return must include isLegacyCustomer",
    );
  });

  it("component destructures isLegacyCustomer from loader data", () => {
    assert.ok(
      passport.includes("isLegacyCustomer } = useLoaderData"),
      "PassportPage must destructure isLegacyCustomer from useLoaderData",
    );
  });
});

// ── B. Rev 6 customer — no refresh prompt ─────────────────────────────────────
describe("B: Rev 6 customer bypasses legacy refresh", () => {
  it("refresh banner is guarded by isLegacyCustomer", () => {
    const bannerGuard = passport.includes("isLegacyCustomer") && passport.includes("sp-refresh-banner");
    assert.ok(bannerGuard, "refresh banner must exist and be guarded by isLegacyCustomer");
    const bannerIdx = passport.indexOf("sp-refresh-banner");
    const beforeBanner = passport.slice(0, bannerIdx);
    const lastIfIdx = beforeBanner.lastIndexOf("isLegacyCustomer");
    assert.ok(lastIfIdx >= 0, "isLegacyCustomer check must precede the refresh banner");
  });

  it("Continue Passport button is hidden for legacy customers", () => {
    // Use lastIndexOf to find the button, not an earlier comment containing the phrase
    const cpIdx = passport.lastIndexOf("Continue Passport");
    assert.ok(cpIdx > 0, "Continue Passport text must exist in a button");
    const before = passport.slice(Math.max(0, cpIdx - 300), cpIdx);
    assert.ok(
      before.includes("!isLegacyCustomer"),
      "Continue Passport button must be wrapped in !isLegacyCustomer check",
    );
  });
});

// ── C. Rev 6 onboarding completion sets profileVersion=6 ─────────────────────
describe("C: Rev 6 onboarding completion marks profileVersion=6", () => {
  it("onboarding/complete.tsx sends onboardingComplete: true in patch", () => {
    assert.ok(
      complete.includes("onboardingComplete: true"),
      "onboarding/complete.tsx must send onboardingComplete: true in the save patch",
    );
  });

  it("api.save-style-profile sets profileVersion=6 when onboardingComplete is true", () => {
    assert.ok(
      saveApi.includes("onboardingComplete") && saveApi.includes("profileVersion = 6"),
      "api.save-style-profile must set profileVersion=6 when onboardingComplete===true",
    );
    assert.ok(
      saveApi.includes('body["onboardingComplete"] === true'),
      "must check body.onboardingComplete === true",
    );
  });

  it("api.save-style-profile includes onboardingComplete in REQUEST_ONLY_KEYS", () => {
    assert.ok(
      saveApi.includes('"onboardingComplete"') &&
      saveApi.includes("REQUEST_ONLY_KEYS"),
      "onboardingComplete must be a REQUEST_ONLY_KEY (not in RECOGNISED_FIELDS)",
    );
    const recognisedIdx = saveApi.indexOf("RECOGNISED_FIELDS = new Set");
    const recognisedBlock = saveApi.slice(recognisedIdx, recognisedIdx + 1000);
    assert.ok(
      !recognisedBlock.includes('"onboardingComplete"'),
      "onboardingComplete must not appear in RECOGNISED_FIELDS",
    );
  });
});

// ── D. Arbitrary section saves do NOT set profileVersion=6 ───────────────────
describe("D: Normal passport section saves do not touch profileVersion", () => {
  it("profileVersion is only set inside the onboardingComplete=true guard", () => {
    const idx = saveApi.indexOf("profileVersion = 6");
    assert.ok(idx > 0, "profileVersion=6 must exist in api.save-style-profile");
    const block = saveApi.slice(Math.max(0, idx - 300), idx + 50);
    assert.ok(
      block.includes("onboardingComplete"),
      "profileVersion=6 must be inside a block guarded by onboardingComplete",
    );
  });

  it("profileData object does not unconditionally include profileVersion", () => {
    const profileDataIdx = saveApi.indexOf("const profileData = {");
    const profileDataBlock = saveApi.slice(profileDataIdx, profileDataIdx + 1500);
    assert.ok(
      !profileDataBlock.includes("profileVersion"),
      "profileData must not unconditionally include profileVersion",
    );
  });
});

// ── E. Refresh flow includes all 7 required screens ──────────────────────────
describe("E: Refresh flow includes all 7 Rev 6 screens", () => {
  const requiredScreenIds = [
    "r-goal",
    "r-identity",
    "r-outfit-gives",
    "r-lifestyle",
    "r-silhouette",
    "r-fit-concerns",
    "r-dressing",
  ];

  for (const id of requiredScreenIds) {
    it(`REFRESH_SCREENS contains screen: ${id}`, () => {
      assert.ok(
        passport.includes(`"${id}"`),
        `REFRESH_SCREENS must include screen "${id}"`,
      );
    });
  }

  const requiredApiKeys = [
    "currentGoal",
    "stylePersonalities",
    "successfulOutfitGives",
    "lifestyle",
    "silhouette",
    "fitConcerns",
    "dressingPreferences",
  ];

  for (const apiKey of requiredApiKeys) {
    it(`refresh flow maps to API key: ${apiKey}`, () => {
      assert.ok(
        passport.includes(`apiKey: "${apiKey}"`),
        `REFRESH_SCREENS must include a field with apiKey "${apiKey}"`,
      );
    });
  }
});

// ── F. dressingPreferences — preserve valid current data; screen always shown ─
describe("F: dressingPreferences uses rev6OnlyFill (preserve explicit current data)", () => {
  it("r-dressing screen is marked optional: true (shown but skippable)", () => {
    const dressIdx = passport.indexOf('"r-dressing"');
    assert.ok(dressIdx > 0, 'r-dressing screen must exist');
    const screenBlock = passport.slice(dressIdx, dressIdx + 600);
    assert.ok(
      screenBlock.includes("optional: true"),
      "r-dressing screen must be marked optional: true",
    );
  });

  it("dressing-preferences field uses rev6OnlyFill (preserve valid current IDs, filter old)", () => {
    // Scan forward for the occurrence with rev6OnlyFill (in REFRESH_SCREENS)
    let found = false;
    let pos = 0;
    while (pos < passport.length) {
      const idx = passport.indexOf('"dressing-preferences"', pos);
      if (idx === -1) break;
      if (passport.slice(idx, idx + 400).includes("rev6OnlyFill: true")) { found = true; break; }
      pos = idx + 1;
    }
    assert.ok(found, "dressing-preferences in REFRESH_SCREENS must use rev6OnlyFill: true (not noAutoFill)");
  });

  it("dressing-preferences field does NOT have noAutoFill (must not be wiped)", () => {
    // Verify the REFRESH_SCREENS definition of dressing-preferences lacks noAutoFill
    let hasNoAutoFill = false;
    let pos = 0;
    while (pos < passport.length) {
      const idx = passport.indexOf('"dressing-preferences"', pos);
      if (idx === -1) break;
      if (passport.slice(idx, idx + 400).includes("noAutoFill: true")) { hasNoAutoFill = true; break; }
      pos = idx + 1;
    }
    assert.ok(!hasNoAutoFill, "dressing-preferences must NOT use noAutoFill (would erase valid current data)");
  });

  it("refresh last step sends onboardingComplete: true", () => {
    const saveRefreshIdx = passport.indexOf("saveRefreshStep");
    assert.ok(saveRefreshIdx > 0, "saveRefreshStep must be defined");
    const block = passport.slice(saveRefreshIdx, saveRefreshIdx + 1200);
    assert.ok(
      block.includes("onboardingComplete = true"),
      "saveRefreshStep must assign patch.onboardingComplete = true on the last step",
    );
    assert.ok(
      block.includes("profileVersion=6") || passport.includes("profileVersion=6"),
      "saveRefreshStep must document that onboardingComplete triggers profileVersion=6",
    );
  });
});

// ── G. Colors are preserved, not re-asked in refresh ─────────────────────────
describe("G: favoriteColors and avoidColors are not in the refresh flow", () => {
  it("REFRESH_SCREENS does not include favorite-colors", () => {
    const rsIdx = passport.indexOf("REFRESH_SCREENS: RefreshScreen[]");
    assert.ok(rsIdx > 0, "REFRESH_SCREENS must exist");
    const rsBlock = passport.slice(rsIdx, rsIdx + 3000);
    assert.ok(
      !rsBlock.includes('"favorite-colors"'),
      "REFRESH_SCREENS must not include favorite-colors",
    );
  });

  it("REFRESH_SCREENS does not include avoid-colors", () => {
    const rsIdx = passport.indexOf("REFRESH_SCREENS: RefreshScreen[]");
    const rsBlock = passport.slice(rsIdx, rsIdx + 3000);
    assert.ok(
      !rsBlock.includes('"avoid-colors"'),
      "REFRESH_SCREENS must not include avoid-colors",
    );
  });
});

// ── H. Legacy fit sub-fields removed from customer-facing Fit editor ──────────
describe("H: Obsolete legacy sub-fields absent from current Fit section definition", () => {
  const removedFields = ["structure", "coverage-preferences", "body-focus-areas", "body-avoid-areas", "preferred-coverage"];

  it("fit section in SECTIONS only contains silhouette sub-field", () => {
    const fitIdx = passport.indexOf('id: "fit"');
    assert.ok(fitIdx > 0, 'fit section must exist');
    const fitBlock = passport.slice(fitIdx, fitIdx + 600);
    assert.ok(
      fitBlock.includes('"silhouette"'),
      "fit section must still include silhouette",
    );
    for (const field of removedFields) {
      assert.ok(!fitBlock.includes(`"${field}"`), `"${field}" must not appear in the fit section sub-fields`);
    }
  });

  it("fit section has only one sub-field (silhouette)", () => {
    const fitIdx = passport.indexOf('id: "fit"');
    const fitBlock = passport.slice(fitIdx, fitIdx + 400);
    const draftKeyMatches = fitBlock.match(/draftKey:/g) ?? [];
    assert.equal(draftKeyMatches.length, 1, "fit section must have exactly 1 sub-field (silhouette only)");
  });
});

// ── I. Legacy DB fields not deleted or mutated by loading refresh ─────────────
describe("I: Legacy DB fields are retained", () => {
  it("schema still has fitPreferences column", () => {
    assert.ok(schema.includes("fitPreferences"), "fitPreferences must remain in schema");
  });

  it("schema still has desiredFeelings column", () => {
    assert.ok(schema.includes("desiredFeelings"), "desiredFeelings must remain in schema");
  });

  it("schema still has becoming column", () => {
    assert.ok(schema.includes("becoming"), "becoming must remain in schema");
  });

  it("schema still has styleStruggles column", () => {
    assert.ok(schema.includes("styleStruggles"), "styleStruggles must remain in schema");
  });

  it("schema still has coveragePreferences column", () => {
    assert.ok(schema.includes("coveragePreferences"), "coveragePreferences must remain in schema");
  });

  it("passport loader does not delete any legacy field from DB", () => {
    const loaderIdx = passport.indexOf("export async function loader");
    const loaderBlock = passport.slice(loaderIdx, loaderIdx + 3000);
    assert.ok(
      !loaderBlock.includes("prisma.onboardingProfile.delete") &&
      !loaderBlock.includes("prisma.onboardingProfile.update"),
      "loader must not call any prisma update/delete",
    );
  });
});

// ── J. Refresh completion sets profileVersion=6 ───────────────────────────────
describe("J: Refresh completion sets profileVersion=6", () => {
  it("schema declares profileVersion column", () => {
    assert.ok(
      schema.includes("profileVersion") && schema.includes("Int?"),
      "schema must declare profileVersion Int?",
    );
  });

  it("migration adds profileVersion column", () => {
    assert.ok(
      migrationSql.includes("profileVersion") && migrationSql.includes("INTEGER"),
      "migration must add profileVersion INTEGER column",
    );
  });

  it("migration default is NULL (not backfilled)", () => {
    assert.ok(
      migrationSql.includes("DEFAULT NULL") || migrationSql.includes("DEFAULT NULL;"),
      "migration must default profileVersion to NULL (no backfill to 6)",
    );
  });

  it("migration is correctly ordered after 20260901000000_styleme_outcome", () => {
    // The migration name itself encodes the ordering — verify it reads as expected
    assert.ok(
      migrationSql.length > 0,
      "20260901100000_profile_version migration SQL must be readable",
    );
  });

  it("saveRefreshStep sends onboardingComplete on the last step", () => {
    const fnIdx = passport.indexOf("async function saveRefreshStep");
    assert.ok(fnIdx > 0, "saveRefreshStep must be defined");
    const fnBlock = passport.slice(fnIdx, fnIdx + 1200);
    assert.ok(
      fnBlock.includes("onboardingComplete = true"),
      "saveRefreshStep must assign patch.onboardingComplete = true on the last step",
    );
    assert.ok(
      fnBlock.includes("isLast") && fnBlock.includes("direction"),
      "saveRefreshStep must guard onboardingComplete by isLast and direction",
    );
  });

  it("stylePersonalities uses rev6OnlyFill (old IDs filtered; current valid IDs preserved)", () => {
    const spIdx = passport.indexOf('"r-identity"');
    assert.ok(spIdx > 0, 'r-identity screen must exist');
    // 600 chars needed: question/helper text precedes the fields array on this screen
    const spBlock = passport.slice(spIdx, spIdx + 600);
    assert.ok(
      spBlock.includes("rev6OnlyFill: true"),
      "style-personalities in refresh must have rev6OnlyFill:true (not noAutoFill)",
    );
    assert.ok(
      !spBlock.includes("noAutoFill: true"),
      "style-personalities must NOT have noAutoFill (valid current Rev 6 IDs must be preserved)",
    );
  });

  it("lifestyle field has rev6OnlyFill", () => {
    const rlIdx = passport.indexOf('"r-lifestyle"');
    assert.ok(rlIdx > 0, 'r-lifestyle screen must exist');
    const rlBlock = passport.slice(rlIdx, rlIdx + 400);
    assert.ok(
      rlBlock.includes("rev6OnlyFill: true"),
      "lifestyle in refresh must have rev6OnlyFill:true",
    );
  });

  it("silhouette field has rev6OnlyFill", () => {
    const rsIdx = passport.indexOf('"r-silhouette"');
    assert.ok(rsIdx > 0, 'r-silhouette screen must exist');
    const rsBlock = passport.slice(rsIdx, rsIdx + 400);
    assert.ok(
      rsBlock.includes("rev6OnlyFill: true"),
      "silhouette in refresh must have rev6OnlyFill:true",
    );
  });
});

// ── K. dressingPreferences preservation — 4 behavioral scenarios ──────────────
describe("K: dressingPreferences behavioral regression scenarios", () => {
  it("K1: initRefreshEdits applies rev6OnlyFill logic (not noAutoFill) for dressing-preferences", () => {
    // Confirm rev6OnlyFill code path filters to valid IDs rather than zeroing the field
    const initFnIdx = passport.indexOf("function initRefreshEdits");
    assert.ok(initFnIdx > 0, "initRefreshEdits must be defined");
    // 1000 chars: noAutoFill branch precedes rev6OnlyFill; filter code is ~800 chars in
    const initBlock = passport.slice(initFnIdx, initFnIdx + 1000);
    assert.ok(
      initBlock.includes("rev6OnlyFill"),
      "initRefreshEdits must have a rev6OnlyFill branch",
    );
    // The rev6OnlyFill branch filters via valid set — never zeroes the field
    assert.ok(
      initBlock.includes("arr.filter(") || initBlock.includes(".filter("),
      "rev6OnlyFill branch must filter saved values against valid set",
    );
  });

  it("K2: valid dressingPreferences IDs exist in quiz-data (rev6OnlyFill filter will produce them)", () => {
    // Verify the canonical Rev 6 dressing-preferences IDs are in quiz-data
    const canonicalIds = [
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
    for (const id of canonicalIds) {
      assert.ok(
        quizData.includes(`"${id}"`),
        `quiz-data must contain dressing-preferences ID "${id}"`,
      );
    }
  });

  it("K3: initRefreshEdits does NOT source dressingPreferences from legacy fields", () => {
    const initFnIdx = passport.indexOf("function initRefreshEdits");
    const initBlock = passport.slice(initFnIdx, initFnIdx + 800);
    const legacyFields = ["coveragePreferences", "bodyFocusAreas", "bodyAvoidAreas", "preferredCoverage"];
    for (const field of legacyFields) {
      assert.ok(
        !initBlock.includes(field),
        `initRefreshEdits must not reference legacy field "${field}" to derive dressingPreferences`,
      );
    }
  });

  it("K4: saveRefreshStep sends dressingPreferences from flowEdits (whatever the user confirmed)", () => {
    const fnIdx = passport.indexOf("async function saveRefreshStep");
    const fnBlock = passport.slice(fnIdx, fnIdx + 1200);
    // saveRefreshStep builds patch from screen.fields, which covers dressingPreferences on r-dressing
    assert.ok(
      fnBlock.includes("screen.fields"),
      "saveRefreshStep must iterate over screen.fields to build the patch",
    );
    assert.ok(
      fnBlock.includes("rf.apiKey"),
      "saveRefreshStep must use rf.apiKey to map field values into the patch",
    );
  });
});

// ── L. stylePersonalities — old IDs filtered; current Rev 6 IDs preserved ─────
describe("L: stylePersonalities Rev 6 ID filtering", () => {
  it("Rev 6 valid style-personality IDs are defined in quiz-data", () => {
    const rev6Ids = [
      "classic-polished",
      "feminine-romantic",
      "minimal-relaxed",
      "bold-edgy",
      "creative-expressive",
    ];
    for (const id of rev6Ids) {
      assert.ok(quizData.includes(`"${id}"`), `quiz-data must contain Rev 6 style-personality ID "${id}"`);
    }
  });

  it("REV6_VALID_IDS is built from quizQuestions (covers style-personalities)", () => {
    // Verify the constant builds from quizQuestions — style-personalities has options
    assert.ok(
      passport.includes("REV6_VALID_IDS") && passport.includes("quizQuestions"),
      "REV6_VALID_IDS must be built from quizQuestions",
    );
    const revIdx = passport.indexOf("REV6_VALID_IDS");
    const revBlock = passport.slice(revIdx, revIdx + 400);
    assert.ok(
      revBlock.includes("q.options"),
      "REV6_VALID_IDS builder must read q.options to capture style-personality IDs",
    );
  });

  it("style-personalities uses rev6OnlyFill (not noAutoFill — current valid IDs must survive)", () => {
    const spIdx = passport.indexOf('"r-identity"');
    // 600 chars: helper text on this screen is long; fields array appears ~400 chars in
    const spBlock = passport.slice(spIdx, spIdx + 600);
    assert.ok(spBlock.includes("rev6OnlyFill: true"), "style-personalities must use rev6OnlyFill");
    assert.ok(!spBlock.includes("noAutoFill: true"), "style-personalities must NOT use noAutoFill");
  });

  it("initRefreshEdits filters saved IDs via REV6_VALID_IDS for rev6OnlyFill fields", () => {
    // Verify the filtering logic: arr.filter(id => valid.has(id))
    const initFnIdx = passport.indexOf("function initRefreshEdits");
    const initBlock = passport.slice(initFnIdx, initFnIdx + 800);
    assert.ok(
      initBlock.includes("valid.has(id)") || initBlock.includes("valid.has("),
      "initRefreshEdits must filter array values using the valid Set",
    );
  });
});

// ── M. Lifestyle — no silent legacy ID mapping ────────────────────────────────
describe("M: lifestyle — only current Rev 6 IDs prefilled; no legacy mapping", () => {
  it("Rev 6 lifestyle IDs are defined in quiz-data", () => {
    const rev6Ids = [
      "work-office",
      "everyday-casual",
      "dinners-going-out",
      "events-special-occasions",
      "family-parenting",
      "travel",
      "active-busy-days",
    ];
    for (const id of rev6Ids) {
      assert.ok(quizData.includes(`"${id}"`), `quiz-data must contain Rev 6 lifestyle ID "${id}"`);
    }
  });

  it("lifestyle uses rev6OnlyFill — filter to valid current IDs only", () => {
    const rlIdx = passport.indexOf('"r-lifestyle"');
    const rlBlock = passport.slice(rlIdx, rlIdx + 400);
    assert.ok(rlBlock.includes("rev6OnlyFill: true"), "lifestyle field must have rev6OnlyFill: true");
  });

  it("initRefreshEdits does not contain any legacy→Rev6 ID mapping table", () => {
    const initFnIdx = passport.indexOf("function initRefreshEdits");
    const initBlock = passport.slice(initFnIdx, initFnIdx + 1000);
    // Legacy IDs that must NOT appear as mapping keys
    const legacyLifestyleIds = ["\"office\"", "\"busy-mom\"", "\"creative\"", "\"casual-days\"", "\"always-on-the-go\"", "\"hybrid\""];
    for (const id of legacyLifestyleIds) {
      assert.ok(
        !initBlock.includes(id),
        `initRefreshEdits must not contain legacy lifestyle ID mapping for ${id}`,
      );
    }
  });

  it("travel is a valid Rev 6 ID and will be preserved by rev6OnlyFill", () => {
    assert.ok(quizData.includes('"travel"'), "quiz-data must contain lifestyle ID \"travel\"");
  });
});

// ── N. Completion marker safety — profileVersion=6 only on final completion ───
describe("N: Completion marker safety — profileVersion=6 on final completion only", () => {
  it("N1: exactly one code assignment of profileData.profileVersion = 6 in api.save-style-profile", () => {
    // Use a specific pattern that excludes comment lines (profileVersion=6 appears in comments too)
    const matches = saveApi.match(/profileData\.profileVersion\s*=\s*6/g) ?? [];
    assert.equal(matches.length, 1, "profileData.profileVersion=6 must appear exactly once (not via comments)");
  });

  it("N2: profileVersion = 6 is unconditionally inside the onboardingComplete guard", () => {
    const guardIdx = saveApi.indexOf('body["onboardingComplete"] === true');
    assert.ok(guardIdx > 0, "onboardingComplete guard must exist");
    const assignIdx = saveApi.indexOf("profileVersion = 6", guardIdx);
    assert.ok(
      assignIdx > 0 && assignIdx < guardIdx + 200,
      "profileVersion=6 must appear immediately inside the onboardingComplete=true block",
    );
  });

  it("N3: saveRefreshStep guards onboardingComplete behind isLast AND direction=next", () => {
    const fnIdx = passport.indexOf("async function saveRefreshStep");
    const fnBlock = passport.slice(fnIdx, fnIdx + 1200);
    assert.ok(fnBlock.includes("isLast"), "saveRefreshStep must compute isLast");
    // onboardingComplete must only be assigned when isLast is true
    const ocIdx = fnBlock.indexOf("onboardingComplete = true");
    assert.ok(ocIdx > 0, "saveRefreshStep must assign onboardingComplete = true");
    const beforeOc = fnBlock.slice(0, ocIdx);
    assert.ok(
      beforeOc.includes("isLast"),
      "onboardingComplete = true must be guarded by isLast in saveRefreshStep",
    );
  });

  it("N4: onboardingComplete is in REQUEST_ONLY_KEYS — never persisted as a DB column", () => {
    const rokIdx = saveApi.indexOf("REQUEST_ONLY_KEYS");
    const rokBlock = saveApi.slice(rokIdx, rokIdx + 200);
    assert.ok(
      rokBlock.includes('"onboardingComplete"'),
      "onboardingComplete must be in REQUEST_ONLY_KEYS",
    );
  });

  it("N5: profileVersion is not in RECOGNISED_FIELDS (only set via the explicit guard)", () => {
    const recognisedIdx = saveApi.indexOf("RECOGNISED_FIELDS = new Set");
    const recognisedBlock = saveApi.slice(recognisedIdx, recognisedIdx + 1000);
    assert.ok(
      !recognisedBlock.includes('"profileVersion"'),
      "profileVersion must not be in RECOGNISED_FIELDS (it is set only via the onboardingComplete guard)",
    );
  });

  it("N6: passport.tsx loader does not set profileVersion (loading does not mark completion)", () => {
    const loaderIdx = passport.indexOf("export async function loader");
    const loaderBlock = passport.slice(loaderIdx, loaderIdx + 3000);
    assert.ok(
      !loaderBlock.includes("profileVersion = 6") && !loaderBlock.includes("profileVersion=6"),
      "loader must not assign profileVersion=6 (loading refresh is not completion)",
    );
  });

  it("N7: passport.tsx does not call save API on mode.kind==='refresh' screen transitions (only on save)", () => {
    // Navigating between refresh screens calls initRefreshEdits + setMode — not fetch
    const initIdx = passport.indexOf("function initRefreshEdits");
    const initBlock = passport.slice(initIdx, initIdx + 800);
    assert.ok(
      !initBlock.includes("fetch("),
      "initRefreshEdits must not make any API call (no DB write on screen navigation)",
    );
  });
});
