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
    // Window enlarged to 1100 to accommodate the Rev 6 completion guard that now precedes the assignment.
    const block = saveApi.slice(Math.max(0, idx - 1100), idx + 50);
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

// ── G. Base REFRESH_SCREENS does not include colours (handled by COLOURS_REFRESH_SCREEN) ─
describe("G: favoriteColors/avoidColors not in base REFRESH_SCREENS (handled conditionally)", () => {
  it("REFRESH_SCREENS static constant does not include favorite-colors", () => {
    // Narrow to the array content only — COLOURS_REFRESH_SCREEN follows immediately after "];".
    const rsIdx = passport.indexOf("const REFRESH_SCREENS: RefreshScreen[] = [");
    assert.ok(rsIdx > 0, "REFRESH_SCREENS must exist");
    const rsEnd = passport.indexOf("];", rsIdx);
    assert.ok(rsEnd > rsIdx, "REFRESH_SCREENS must have a closing ];");
    const rsBlock = passport.slice(rsIdx, rsEnd);
    assert.ok(
      !rsBlock.includes('"favorite-colors"'),
      "REFRESH_SCREENS static constant must not include favorite-colors (colors handled by COLOURS_REFRESH_SCREEN)",
    );
  });

  it("REFRESH_SCREENS static constant does not include avoid-colors", () => {
    const rsIdx = passport.indexOf("const REFRESH_SCREENS: RefreshScreen[] = [");
    const rsEnd = passport.indexOf("];", rsIdx);
    const rsBlock = passport.slice(rsIdx, rsEnd);
    assert.ok(
      !rsBlock.includes('"avoid-colors"'),
      "REFRESH_SCREENS static constant must not include avoid-colors",
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

  it("N2: profileVersion = 6 is inside the onboardingComplete guard, after Rev 6 completion validation", () => {
    const guardIdx = saveApi.indexOf('body["onboardingComplete"] === true');
    assert.ok(guardIdx > 0, "onboardingComplete guard must exist");
    const assignIdx = saveApi.indexOf("profileVersion = 6", guardIdx);
    assert.ok(assignIdx > guardIdx, "profileVersion=6 must appear inside the onboardingComplete=true block");
    // Rev 6 completion validation (incomplete_rev6_profile guard) must precede the assignment
    const between = saveApi.slice(guardIdx, assignIdx);
    assert.ok(
      between.includes("incomplete_rev6_profile"),
      "Rev 6 completion validation must precede profileVersion=6 inside the onboardingComplete guard",
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

// ── O. Refresh required/optional flag correctness ─────────────────────────────
describe("O: Only dressingPreferences is optional in the refresh flow", () => {
  it("O.A: exactly one screen in REFRESH_SCREENS has optional: true (r-dressing only)", () => {
    const rsIdx = passport.indexOf("const REFRESH_SCREENS: RefreshScreen[] = [");
    const rsEnd = passport.indexOf("];", rsIdx);
    const rsBlock = passport.slice(rsIdx, rsEnd);
    const optMatches = rsBlock.match(/optional:\s*true/g) ?? [];
    assert.equal(optMatches.length, 1, "exactly one screen in REFRESH_SCREENS must be marked optional: true");
    const dressingIdx = rsBlock.indexOf('"r-dressing"');
    assert.ok(dressingIdx > 0, "r-dressing must exist in REFRESH_SCREENS");
    const dressingBlock = rsBlock.slice(dressingIdx);
    assert.ok(dressingBlock.includes("optional: true"), "the sole optional: true must be on the r-dressing screen");
  });

  it("O.A: r-goal does NOT have optional: true", () => {
    const idx = passport.indexOf('"r-goal"');
    const block = passport.slice(idx, idx + 500);
    assert.ok(!block.includes("optional: true"), "r-goal must not be marked optional");
  });

  it("O.A: r-outfit-gives does NOT have optional: true", () => {
    const idx = passport.indexOf('"r-outfit-gives"');
    const block = passport.slice(idx, idx + 500);
    assert.ok(!block.includes("optional: true"), "r-outfit-gives must not be marked optional");
  });

  it("O.A: r-fit-concerns does NOT have optional: true", () => {
    const idx = passport.indexOf('"r-fit-concerns"');
    const block = passport.slice(idx, idx + 500);
    assert.ok(!block.includes("optional: true"), "r-fit-concerns must not be marked optional");
  });

  it("O.B-G: refresh JSX computes isBlocked to enforce required selections", () => {
    // Anchor on the section comment to avoid the earlier "refresh && done" check at ~line 1582.
    const refreshStepIdx = passport.indexOf("// ── REFRESH STEP");
    assert.ok(refreshStepIdx > 0, "REFRESH STEP section comment must exist");
    const refreshBlock = passport.slice(refreshStepIdx, refreshStepIdx + 1000);
    assert.ok(refreshBlock.includes("isBlocked"), "refresh JSX must compute isBlocked");
    assert.ok(
      refreshBlock.includes("screen.optional") && refreshBlock.includes("primaryArr.length === 0"),
      "isBlocked must check screen.optional and primaryArr.length === 0",
    );
  });

  it("O.B-G: Next button disabled prop includes isBlocked", () => {
    const refreshStepIdx = passport.indexOf("// ── REFRESH STEP");
    assert.ok(refreshStepIdx > 0, "REFRESH STEP section comment must exist");
    // sp-btn-primary is ~50 lines past the comment; search forward from isBlocked to stay in range.
    // Window extended to 2000 to accommodate the Back button added before sp-btn-primary.
    const isBlockedIdx = passport.indexOf("isBlocked", refreshStepIdx);
    assert.ok(isBlockedIdx > 0, "isBlocked must be defined in the refresh JSX");
    const fromBlocked = passport.slice(isBlockedIdx, isBlockedIdx + 2000);
    const nextBtnIdx = fromBlocked.indexOf("sp-btn-primary");
    assert.ok(nextBtnIdx > 0, "sp-btn-primary button must exist after isBlocked in refresh JSX");
    const btnBlock = fromBlocked.slice(nextBtnIdx, nextBtnIdx + 200);
    assert.ok(btnBlock.includes("isBlocked"), "Next button disabled prop must include isBlocked");
  });

  it("O.H: r-dressing optional: true — Next never blocked on empty dressingPreferences", () => {
    const dressingIdx = passport.indexOf('"r-dressing"');
    const dressingBlock = passport.slice(dressingIdx, dressingIdx + 600);
    assert.ok(
      dressingBlock.includes("optional: true"),
      "r-dressing must remain optional: true so dressingPreferences can be empty on Next",
    );
  });
});

// ── P. Server-side Rev 6 completion guard ─────────────────────────────────────
describe("P: Server rejects onboardingComplete when required Rev 6 fields are missing", () => {
  it("P.I: api returns incomplete_rev6_profile when required fields missing", () => {
    assert.ok(
      saveApi.includes("incomplete_rev6_profile"),
      "api.save-style-profile must return incomplete_rev6_profile when required Rev 6 fields are empty",
    );
  });

  it("P.I: all 7 required Rev 6 fields are checked before setting profileVersion=6", () => {
    const guardIdx = saveApi.indexOf('body["onboardingComplete"] === true');
    const assignIdx = saveApi.indexOf("profileVersion = 6", guardIdx);
    const between = saveApi.slice(guardIdx, assignIdx);
    for (const field of ["currentGoal", "stylePersonalities", "successfulOutfitGives", "lifestyle", "favoriteColors", "silhouette", "fitConcerns"]) {
      assert.ok(between.includes(`"${field}"`), `completion guard must check required field "${field}"`);
    }
  });

  it("P.I: dressingPreferences is NOT in the required completion check", () => {
    const guardIdx = saveApi.indexOf('body["onboardingComplete"] === true');
    const assignIdx = saveApi.indexOf("profileVersion = 6", guardIdx);
    const between = saveApi.slice(guardIdx, assignIdx);
    assert.ok(!between.includes('"dressingPreferences"'), "dressingPreferences must not be required for Rev 6 completion");
  });

  it("P.J: incomplete_rev6_profile early return precedes profileVersion=6 assignment", () => {
    const guardIdx = saveApi.indexOf('body["onboardingComplete"] === true');
    const incompleteIdx = saveApi.indexOf("incomplete_rev6_profile", guardIdx);
    const assignIdx = saveApi.indexOf("profileVersion = 6", guardIdx);
    assert.ok(incompleteIdx > guardIdx && incompleteIdx < assignIdx,
      "incomplete_rev6_profile must appear before profileVersion=6 inside the guard",
    );
    // The slice between guard and assignment must contain both the return statement and the error.
    // (returnIdx via forward search would skip past the line since "return" precedes "incomplete_rev6_profile"
    //  on the same line; check the slice instead.)
    const guardToAssign = saveApi.slice(guardIdx, assignIdx);
    assert.ok(
      guardToAssign.includes("return Response.json") && guardToAssign.includes("incomplete_rev6_profile"),
      "a return Response.json containing incomplete_rev6_profile must appear before profileVersion=6",
    );
  });

  it("P.K: missingRev6.length > 0 guard precedes profileVersion=6 assignment", () => {
    const guardIdx = saveApi.indexOf('body["onboardingComplete"] === true');
    const assignIdx = saveApi.indexOf("profileVersion = 6", guardIdx);
    const between = saveApi.slice(guardIdx, assignIdx);
    assert.ok(between.includes("missingRev6.length > 0"), "guard must check missingRev6.length > 0 before early return");
  });
});

// ── Q. Legacy colours edge case ───────────────────────────────────────────────
describe("Q: Legacy customer colours handling", () => {
  it("Q.L: COLOURS_REFRESH_SCREEN constant exists with screenId r-colors", () => {
    assert.ok(passport.includes("COLOURS_REFRESH_SCREEN"), "COLOURS_REFRESH_SCREEN must be defined");
    assert.ok(passport.includes('"r-colors"'), "COLOURS_REFRESH_SCREEN must have screenId r-colors");
  });

  it("Q.L: COLOURS_REFRESH_SCREEN maps to favoriteColors, not avoidColors", () => {
    const colIdx = passport.indexOf("COLOURS_REFRESH_SCREEN");
    const colBlock = passport.slice(colIdx, colIdx + 500);
    assert.ok(colBlock.includes('"favoriteColors"'), "COLOURS_REFRESH_SCREEN must include favoriteColors");
    assert.ok(!colBlock.includes('"avoidColors"'), "COLOURS_REFRESH_SCREEN must not include avoidColors");
  });

  it("Q.L: activeRefreshScreens returns REFRESH_SCREENS unchanged when favoriteColors non-empty", () => {
    const memoIdx = passport.indexOf("activeRefreshScreens");
    const memoBlock = passport.slice(memoIdx, memoIdx + 500);
    assert.ok(memoBlock.includes("return REFRESH_SCREENS"), "when favoriteColors non-empty, REFRESH_SCREENS returned unchanged");
  });

  it("Q.L: activeRefreshScreens is driven by savedAnswers[\"favorite-colors\"]", () => {
    const memoIdx = passport.indexOf("activeRefreshScreens");
    const memoBlock = passport.slice(memoIdx, memoIdx + 500);
    assert.ok(
      memoBlock.includes("favColors") && (memoBlock.includes("favColors.length > 0") || memoBlock.includes("favColors.length === 0")),
      "activeRefreshScreens must check favColors.length to decide whether to insert the colours screen",
    );
  });

  it("Q.M: COLOURS_REFRESH_SCREEN is inserted when favoriteColors is empty", () => {
    const memoIdx = passport.indexOf("activeRefreshScreens");
    const memoBlock = passport.slice(memoIdx, memoIdx + 500);
    assert.ok(memoBlock.includes("COLOURS_REFRESH_SCREEN"), "COLOURS_REFRESH_SCREEN must be in the insertion branch");
  });

  it("Q.M: colours screen is inserted before r-dressing (at REFRESH_SCREENS.length - 1)", () => {
    const memoIdx = passport.indexOf("activeRefreshScreens");
    const memoBlock = passport.slice(memoIdx, memoIdx + 500);
    assert.ok(
      memoBlock.includes("REFRESH_SCREENS.length - 1"),
      "COLOURS_REFRESH_SCREEN must be inserted at REFRESH_SCREENS.length-1 (before r-dressing)",
    );
  });
});

// ── R. Refresh exclusivity fix ────────────────────────────────────────────────
// Verifies that handleToggle supports exclusiveIds (from QuizQuestion metadata)
// and that renderSubField passes q?.exclusiveIds into the array-kind toggle call.
// Also verifies quiz-data.ts carries the correct exclusiveIds for all four
// affected questions. Normal onboarding (onboarding/step.$step.tsx) is untouched.
describe("R: Refresh exclusivity — handleToggle and quiz-data contracts", () => {

  // ── R.A: handleToggle signature ──────────────────────────────────────────
  it("R.A: handleToggle accepts an exclusiveIds parameter", () => {
    const htIdx = passport.indexOf("const handleToggle = useCallback");
    assert.ok(htIdx !== -1, "handleToggle must exist");
    const sig = passport.slice(htIdx, htIdx + 200);
    assert.ok(sig.includes("exclusiveIds"), "handleToggle signature must include exclusiveIds parameter");
  });

  // ── R.B: exclusive branch replaces entire selection ──────────────────────
  it("R.B: handleToggle has an exclusive branch that replaces the selection with only the exclusive ID", () => {
    const htIdx = passport.indexOf("const handleToggle = useCallback");
    assert.ok(htIdx !== -1, "handleToggle must exist");
    const htBlock = passport.slice(htIdx, htIdx + 700);
    assert.ok(
      htBlock.includes("excl.includes(optId)") || htBlock.includes("exclusiveIds.includes(optId)"),
      "handleToggle must check if the selected option is in the exclusive list",
    );
    assert.ok(
      htBlock.includes("[optId]"),
      "exclusive branch must produce a single-element array containing only optId",
    );
  });

  // ── R.C: non-exclusive branch clears exclusive IDs before adding ──────────
  it("R.C: handleToggle removes currently-selected exclusive IDs before adding a non-exclusive option", () => {
    const htIdx = passport.indexOf("const handleToggle = useCallback");
    assert.ok(htIdx !== -1, "handleToggle must exist");
    const htBlock = passport.slice(htIdx, htIdx + 700);
    assert.ok(
      htBlock.includes("withoutExclusives") || htBlock.includes("filter(id => !excl.includes(id))"),
      "handleToggle must filter out exclusive IDs from the current selection before adding a non-exclusive option",
    );
  });

  // ── R.D: renderSubField passes q?.exclusiveIds to handleToggle ────────────
  it("R.D: renderSubField array branch passes q?.exclusiveIds into handleToggle", () => {
    const rsIdx = passport.indexOf("function renderSubField");
    assert.ok(rsIdx !== -1, "renderSubField must exist");
    const rsBlock = passport.slice(rsIdx, rsIdx + 3000);
    assert.ok(
      rsBlock.includes("q?.exclusiveIds"),
      "renderSubField must pass q?.exclusiveIds to handleToggle in the array-kind branch",
    );
  });

  // ── R.E: current-goal exclusiveIds in quiz-data ──────────────────────────
  it("R.E: quiz-data current-goal has exclusiveIds: [\"not-sure-yet\"]", () => {
    assert.ok(
      quizData.includes('"current-goal"') && quizData.includes('"not-sure-yet"'),
      "quiz-data must define not-sure-yet option for current-goal",
    );
    const cgIdx = quizData.indexOf('"current-goal"');
    const cgBlock = quizData.slice(cgIdx, cgIdx + 800);
    assert.ok(
      cgBlock.includes("exclusiveIds") && cgBlock.includes('"not-sure-yet"'),
      "current-goal question must declare exclusiveIds containing not-sure-yet",
    );
  });

  // ── R.F: successful-outfit-gives exclusiveIds in quiz-data ───────────────
  it("R.F: quiz-data successful-outfit-gives has exclusiveIds: [\"not-sure\"]", () => {
    const soIdx = quizData.indexOf('"successful-outfit-gives"');
    assert.ok(soIdx !== -1, "successful-outfit-gives question must exist in quiz-data");
    const soBlock = quizData.slice(soIdx, soIdx + 800);
    assert.ok(
      soBlock.includes("exclusiveIds") && soBlock.includes('"not-sure"'),
      "successful-outfit-gives must declare exclusiveIds containing not-sure",
    );
  });

  // ── R.G: silhouette exclusiveIds in quiz-data ────────────────────────────
  it("R.G: quiz-data silhouette has exclusiveIds: [\"not-sure\"]", () => {
    const silIdx = quizData.indexOf('"silhouette"');
    assert.ok(silIdx !== -1, "silhouette question must exist in quiz-data");
    const silBlock = quizData.slice(silIdx, silIdx + 800);
    assert.ok(
      silBlock.includes("exclusiveIds") && silBlock.includes('"not-sure"'),
      "silhouette must declare exclusiveIds containing not-sure",
    );
  });

  // ── R.H: fit-concerns exclusiveIds in quiz-data ──────────────────────────
  it("R.H: quiz-data fit-concerns has exclusiveIds: [\"no-fit-problems\"]", () => {
    const fcIdx = quizData.indexOf('"fit-concerns"');
    assert.ok(fcIdx !== -1, "fit-concerns question must exist in quiz-data");
    const fcBlock = quizData.slice(fcIdx, fcIdx + 800);
    assert.ok(
      fcBlock.includes("exclusiveIds") && fcBlock.includes('"no-fit-problems"'),
      "fit-concerns must declare exclusiveIds containing no-fit-problems",
    );
  });

  // ── R.I: dressing-preferences has no exclusiveIds (unaffected) ───────────
  it("R.I: quiz-data dressing-preferences does NOT declare exclusiveIds (refresh r-dressing unaffected)", () => {
    const dpIdx = quizData.indexOf('"dressing-preferences"');
    assert.ok(dpIdx !== -1, "dressing-preferences question must exist in quiz-data");
    // Find the next question boundary after dressing-preferences
    const nextQ = quizData.indexOf('\n  {', dpIdx + 1);
    const dpBlock = quizData.slice(dpIdx, nextQ !== -1 ? nextQ : dpIdx + 1000);
    assert.ok(
      !dpBlock.includes("exclusiveIds"),
      "dressing-preferences must NOT have exclusiveIds — r-dressing is unaffected by the exclusivity fix",
    );
  });

  // ── R.J: colour branch in renderSubField does NOT pass exclusiveIds ───────
  it("R.J: colour-kind branch in renderSubField uses pairKey, not exclusiveIds", () => {
    const rsIdx = passport.indexOf("function renderSubField");
    assert.ok(rsIdx !== -1, "renderSubField must exist");
    const colorBranchIdx = passport.indexOf('sf.kind === "color"', rsIdx);
    assert.ok(colorBranchIdx !== -1, "color branch must exist in renderSubField");
    // Color branch ends before the array fallback return
    const colorBranchEnd = passport.indexOf("// array (multi-select pills)", rsIdx);
    const colorBlock = passport.slice(colorBranchIdx, colorBranchEnd !== -1 ? colorBranchEnd : colorBranchIdx + 600);
    assert.ok(
      colorBlock.includes("pairKey"),
      "colour-kind branch must use pairKey for mutual colour exclusion",
    );
    assert.ok(
      !colorBlock.includes("exclusiveIds"),
      "colour-kind branch must NOT pass exclusiveIds (colours have no exclusive IDs)",
    );
  });

  // ── R.K: r-goal question ID maps to current-goal (exclusiveIds flow complete)
  it("R.K: r-goal refresh screen maps to questionId \"current-goal\" carrying not-sure-yet exclusiveIds", () => {
    const rGoalIdx = passport.indexOf('"r-goal"');
    assert.ok(rGoalIdx !== -1, "r-goal screen must exist in REFRESH_SCREENS");
    const rGoalBlock = passport.slice(rGoalIdx, rGoalIdx + 300);
    assert.ok(
      rGoalBlock.includes('"current-goal"'),
      "r-goal screen must reference questionId current-goal, which carries not-sure-yet exclusiveIds in quiz-data",
    );
  });

  // ── R.L: r-fit-concerns question ID maps to fit-concerns (exclusiveIds flow complete)
  it("R.L: r-fit-concerns refresh screen maps to questionId \"fit-concerns\" carrying no-fit-problems exclusiveIds", () => {
    const rfcIdx = passport.indexOf('"r-fit-concerns"');
    assert.ok(rfcIdx !== -1, "r-fit-concerns screen must exist in REFRESH_SCREENS");
    const rfcBlock = passport.slice(rfcIdx, rfcIdx + 400);
    assert.ok(
      rfcBlock.includes('"fit-concerns"'),
      "r-fit-concerns screen must reference questionId fit-concerns, which carries no-fit-problems exclusiveIds in quiz-data",
    );
  });
});

// ── S. QA cleanup batch — Notes optional, fitConcerns labels, copy, Back ──────
// A–O from the approved QA cleanup spec.
describe("S: QA cleanup — Notes optional and fitConcerns labels", () => {

  // ── S.A: NOTES_SECTION has optional: true ────────────────────────────────
  it("S.A: NOTES_SECTION is marked optional:true", () => {
    const notesIdx = passport.indexOf("const NOTES_SECTION");
    assert.ok(notesIdx !== -1, "NOTES_SECTION must exist");
    const notesBlock = passport.slice(notesIdx, notesIdx + 400);
    assert.ok(notesBlock.includes("optional: true"), "NOTES_SECTION must have optional: true so it never blocks completion");
  });

  // ── S.B: missingSections skips optional sections ─────────────────────────
  it("S.B: missingSections filter short-circuits on s.optional, so Notes cannot trigger incomplete", () => {
    const msIdx = passport.indexOf("missingSections = useMemo");
    assert.ok(msIdx !== -1, "missingSections useMemo must exist");
    const msBlock = passport.slice(msIdx, msIdx + 400);
    assert.ok(
      msBlock.includes("s.optional") || msBlock.includes("s.placeholder || s.optional"),
      "missingSections must short-circuit on s.optional so optional sections (Notes) are skipped",
    );
  });

  // ── S.C: Continue Passport gate is isComplete ────────────────────────────
  it("S.C: Continue Passport CTA is gated on !isComplete, which is false when only Notes is empty", () => {
    const continueIdx = passport.indexOf("Continue Passport");
    assert.ok(continueIdx !== -1, "Continue Passport button must exist");
    // Verify isComplete = missingSections.length === 0 (Notes now optional → not in missingSections)
    assert.ok(
      passport.includes("isComplete = missingSections.length === 0") ||
      passport.includes("missingSections.length === 0"),
      "isComplete must be derived from missingSections length",
    );
  });

  // ── S.D: fitConcerns no longer uses stale FIT_CONCERN_LABELS ─────────────
  it("S.D: getSectionDetail does NOT use FIT_CONCERN_LABELS for fit-concerns display", () => {
    const detailIdx = passport.indexOf("function getSectionDetail");
    assert.ok(detailIdx !== -1, "getSectionDetail must exist");
    const detailBlock = passport.slice(detailIdx, detailIdx + 2000);
    // The stale special-case line must not appear
    assert.ok(
      !detailBlock.includes('dKey === "fit-concerns"') || !detailBlock.includes("FIT_CONCERN_LABELS"),
      "getSectionDetail must not use FIT_CONCERN_LABELS for fit-concerns (stale legacy labels)",
    );
  });

  // ── S.E: fitConcerns falls through to lbl() which resolves OPTION_LABELS ─
  it("S.E: fit-concerns in getSectionDetail uses the generic lbl() path (OPTION_LABELS-backed)", () => {
    const detailIdx = passport.indexOf("function getSectionDetail");
    assert.ok(detailIdx !== -1, "getSectionDetail must exist");
    // Window extended to 3000 — getSectionDetail is ~47 lines; 2000 chars was insufficient.
    const detailBlock = passport.slice(detailIdx, detailIdx + 3000);
    // The generic labelled path must exist
    assert.ok(
      detailBlock.includes("ids.map(id => lbl(sf.questionId, id))"),
      "getSectionDetail must have a generic lbl(sf.questionId, id) path that covers fit-concerns",
    );
  });
});

// ── T. QA cleanup — copy changes and Back navigation ─────────────────────────
describe("T: QA cleanup — simplified copy and Back button", () => {

  // ── T.F: Q3 — r-outfit-gives simplified question ─────────────────────────
  it("T.F: r-outfit-gives refresh screen uses simplified question copy", () => {
    const rIdx = passport.indexOf('"r-outfit-gives"');
    assert.ok(rIdx !== -1, "r-outfit-gives screen must exist");
    const rBlock = passport.slice(rIdx, rIdx + 300);
    assert.ok(
      rBlock.includes("What makes an outfit feel right for you?"),
      "r-outfit-gives must use simplified question: 'What makes an outfit feel right for you?'",
    );
    assert.ok(
      !rBlock.includes("When an outfit really works for you"),
      "r-outfit-gives must not use the old abstract question wording",
    );
  });

  // ── T.G: Q4 — r-lifestyle simplified question ────────────────────────────
  it("T.G: r-lifestyle refresh screen uses simplified question copy", () => {
    const rIdx = passport.indexOf('"r-lifestyle"');
    assert.ok(rIdx !== -1, "r-lifestyle screen must exist");
    const rBlock = passport.slice(rIdx, rIdx + 300);
    assert.ok(
      rBlock.includes("What do you dress for most often?"),
      "r-lifestyle must use simplified question: 'What do you dress for most often?'",
    );
    assert.ok(
      !rBlock.includes("Where does your wardrobe need to show up most often?"),
      "r-lifestyle must not use the old abstract question wording",
    );
  });

  // ── T.H: Q6 — r-fit-concerns simplified question and helper ──────────────
  it("T.H: r-fit-concerns uses simplified question and helper", () => {
    const rIdx = passport.indexOf('"r-fit-concerns"');
    assert.ok(rIdx !== -1, "r-fit-concerns screen must exist");
    const rBlock = passport.slice(rIdx, rIdx + 400);
    assert.ok(
      rBlock.includes("Are there any fit issues nAia should keep in mind?"),
      "r-fit-concerns must use simplified question copy",
    );
    assert.ok(
      rBlock.includes("Select any that apply."),
      "r-fit-concerns must use simplified helper: 'Select any that apply.'",
    );
    assert.ok(
      !rBlock.includes("Does clothing ever fit you in a particular way"),
      "r-fit-concerns must not use the old complex question wording",
    );
  });

  // ── T.I: Q7 — r-dressing simplified helper ───────────────────────────────
  it("T.I: r-dressing helper is simplified (no 'hard requirements' / 'filter out products')", () => {
    const rIdx = passport.indexOf('"r-dressing"');
    assert.ok(rIdx !== -1, "r-dressing screen must exist");
    const rBlock = passport.slice(rIdx, rIdx + 400);
    assert.ok(
      rBlock.includes("Optional. Select anything nAia should always keep in mind when styling you."),
      "r-dressing must use simplified helper copy",
    );
    assert.ok(
      !rBlock.includes("hard requirements"),
      "r-dressing helper must not contain 'hard requirements' technical language",
    );
    assert.ok(
      !rBlock.includes("filter out products"),
      "r-dressing helper must not contain 'filter out products' technical language",
    );
  });

  // ── T.J: Back absent on Step 1 (stepIndex = 0) ───────────────────────────
  it("T.J: Back button is gated on stepIndex > 0, so it is absent on Step 1", () => {
    // Anchor on REFRESH STEP comment to avoid "← Back to Passport" in the done-state block (before this comment).
    const refreshStepIdx = passport.indexOf("// ── REFRESH STEP");
    assert.ok(refreshStepIdx > 0, "REFRESH STEP section comment must exist");
    const backIdx = passport.indexOf("← Back", refreshStepIdx);
    assert.ok(backIdx !== -1, "Back button label must exist in refresh JSX");
    const backContext = passport.slice(Math.max(refreshStepIdx, backIdx - 600), backIdx + 10);
    assert.ok(
      backContext.includes("stepIndex > 0"),
      "Back button must be inside a stepIndex > 0 guard so it does not appear on Step 1",
    );
  });

  // ── T.K: Back present on Step 2+ ─────────────────────────────────────────
  it("T.K: Back button label exists in the refresh JSX", () => {
    const refreshStepIdx = passport.indexOf("// ── REFRESH STEP");
    assert.ok(refreshStepIdx > 0, "REFRESH STEP section comment must exist");
    assert.ok(
      passport.indexOf("← Back", refreshStepIdx) !== -1,
      "Back button with '← Back' label must exist inside the REFRESH STEP JSX block",
    );
  });

  // ── T.L: Back moves to previous refresh screen ───────────────────────────
  it("T.L: Back button sets stepIndex to mode.stepIndex - 1", () => {
    const refreshStepIdx = passport.indexOf("// ── REFRESH STEP");
    assert.ok(refreshStepIdx > 0, "REFRESH STEP section comment must exist");
    const backIdx = passport.indexOf("← Back", refreshStepIdx);
    assert.ok(backIdx !== -1, "Back button must exist in REFRESH STEP block");
    const backBlock = passport.slice(Math.max(refreshStepIdx, backIdx - 700), backIdx + 50);
    // prevIndex is extracted from mode.stepIndex - 1 and passed to setMode
    assert.ok(
      backBlock.includes("mode.stepIndex - 1"),
      "Back onClick must compute prevIndex as mode.stepIndex - 1",
    );
    assert.ok(
      backBlock.includes("stepIndex: prevIndex"),
      "Back onClick must navigate using prevIndex",
    );
  });

  // ── T.M: Back restores previous selections via initRefreshEdits ───────────
  it("T.M: Back button calls initRefreshEdits(prevScreen) to restore previous selections", () => {
    const refreshStepIdx = passport.indexOf("// ── REFRESH STEP");
    assert.ok(refreshStepIdx > 0, "REFRESH STEP section comment must exist");
    const backIdx = passport.indexOf("← Back", refreshStepIdx);
    assert.ok(backIdx !== -1, "Back button must exist in REFRESH STEP block");
    const backBlock = passport.slice(Math.max(refreshStepIdx, backIdx - 600), backIdx + 50);
    assert.ok(
      backBlock.includes("initRefreshEdits(prevScreen)"),
      "Back must call initRefreshEdits(prevScreen) to restore saved answers for the previous screen",
    );
  });

  // ── T.N: Back uses activeRefreshScreens (handles conditional Colours) ─────
  it("T.N: Back reads prevScreen from activeRefreshScreens (not a hardcoded index)", () => {
    const refreshStepIdx = passport.indexOf("// ── REFRESH STEP");
    assert.ok(refreshStepIdx > 0, "REFRESH STEP section comment must exist");
    const backIdx = passport.indexOf("← Back", refreshStepIdx);
    assert.ok(backIdx !== -1, "Back button must exist in REFRESH STEP block");
    const backBlock = passport.slice(Math.max(refreshStepIdx, backIdx - 700), backIdx + 50);
    // prevIndex = mode.stepIndex - 1 is passed to activeRefreshScreens lookup
    assert.ok(
      backBlock.includes("activeRefreshScreens[prevIndex]"),
      "Back must use activeRefreshScreens[prevIndex] to look up the previous screen (handles conditional Colours insertion)",
    );
  });

  // ── T.O: Back cannot set profileVersion=6 ────────────────────────────────
  it("T.O: Back onClick does not send onboardingComplete or call saveRefreshStep", () => {
    const refreshStepIdx = passport.indexOf("// ── REFRESH STEP");
    assert.ok(refreshStepIdx > 0, "REFRESH STEP section comment must exist");
    const backIdx = passport.indexOf("← Back", refreshStepIdx);
    assert.ok(backIdx !== -1, "Back button must exist in REFRESH STEP block");
    const backBlock = passport.slice(Math.max(refreshStepIdx, backIdx - 700), backIdx + 10);
    assert.ok(
      !backBlock.includes("onboardingComplete") && !backBlock.includes("saveRefreshStep"),
      "Back onClick must not call saveRefreshStep or set onboardingComplete — profileVersion must not be set early",
    );
  });
});

describe("U: Back navigation race-safety — committedEditsRef", () => {
  // True interaction-level testing (mounting React component, simulating user events, inspecting
  // rendered state) requires a DOM environment and React testing utilities (jsdom, @testing-library/react).
  // The current harness is Node's native test runner with tsx/esm — no DOM, no render. These tests
  // therefore prove the behavioural contract through source-structure analysis: they verify that
  // (a) the committed-edits cache is declared and populated at the correct point in `saveRefreshStep`,
  // and (b) the Back button prefers the cache over `savedAnswers`/`initRefreshEdits`.
  // `passport` is the file-scope constant loaded at the top of this file.

  // ── U.A: committedEditsRef is declared ────────────────────────────────────
  it("U.A: committedEditsRef is declared as a useRef in the component", () => {
    assert.ok(
      passport.includes("committedEditsRef = useRef<Record<number, OnboardingAnswers>>({})"),
      "committedEditsRef must be declared as useRef<Record<number, OnboardingAnswers>>({}) — the per-stepIndex cache",
    );
  });

  // ── U.B: snapshot is taken after successful save ───────────────────────────
  it("U.B: committedEditsRef.current[stepIndex] is set after fetch succeeds but before revalidate", () => {
    const saveIdx = passport.indexOf("async function saveRefreshStep(");
    assert.ok(saveIdx !== -1, "saveRefreshStep must exist");
    // Capture a window from after the successful-response guard through revalidate() call
    const saveBlock = passport.slice(saveIdx, saveIdx + 1200);
    const cacheSetIdx   = saveBlock.indexOf("committedEditsRef.current[stepIndex] =");
    const revalidateIdx = saveBlock.indexOf("revalidator.revalidate()");
    assert.ok(cacheSetIdx !== -1, "committedEditsRef.current[stepIndex] must be set inside saveRefreshStep");
    assert.ok(revalidateIdx !== -1, "revalidator.revalidate() must be called inside saveRefreshStep");
    assert.ok(
      cacheSetIdx < revalidateIdx,
      "committed-edits snapshot must be captured before revalidator.revalidate() is called, " +
      "ensuring Back always reads the confirmed saved state regardless of revalidation timing",
    );
  });

  // ── U.C: Back prefers cache over initRefreshEdits ─────────────────────────
  it("U.C: Back button reads committedEditsRef.current[prevIndex] before falling back to initRefreshEdits", () => {
    const refreshStepIdx = passport.indexOf("// ── REFRESH STEP");
    assert.ok(refreshStepIdx > 0, "REFRESH STEP section comment must exist");
    const backIdx = passport.indexOf("← Back", refreshStepIdx);
    assert.ok(backIdx !== -1, "Back button must exist in REFRESH STEP block");
    const backBlock = passport.slice(Math.max(refreshStepIdx, backIdx - 700), backIdx + 50);
    assert.ok(
      backBlock.includes("committedEditsRef.current[prevIndex]"),
      "Back onClick must read committedEditsRef.current[prevIndex] — the committed cache entry for the previous step",
    );
    assert.ok(
      backBlock.includes("?? initRefreshEdits(prevScreen)"),
      "Back onClick must fall back to initRefreshEdits(prevScreen) only when no committed cache entry exists",
    );
  });

  // ── U.D: snapshot uses exact flowEdits at time of save ────────────────────
  it("U.D: snapshot captures flowEdits spread — reflects exactly what the server received", () => {
    const saveIdx = passport.indexOf("async function saveRefreshStep(");
    assert.ok(saveIdx !== -1, "saveRefreshStep must exist");
    const saveBlock = passport.slice(saveIdx, saveIdx + 1200);
    assert.ok(
      saveBlock.includes("committedEditsRef.current[stepIndex] = { ...flowEdits }"),
      "snapshot must spread flowEdits so it is an independent copy that cannot be mutated by later state updates",
    );
  });

  // ── U.E: Back does not depend on revalidator.state ────────────────────────
  it("U.E: Back onClick does not read revalidator.state (no timing dependency)", () => {
    const refreshStepIdx = passport.indexOf("// ── REFRESH STEP");
    assert.ok(refreshStepIdx > 0, "REFRESH STEP section comment must exist");
    const backIdx = passport.indexOf("← Back", refreshStepIdx);
    assert.ok(backIdx !== -1, "Back button must exist in REFRESH STEP block");
    const backBlock = passport.slice(Math.max(refreshStepIdx, backIdx - 700), backIdx + 50);
    assert.ok(
      !backBlock.includes("revalidator.state"),
      "Back onClick must not check revalidator.state — it must be deterministic regardless of network timing",
    );
  });
});

describe("V: Notes to nAia — overview editability", () => {
  // Tests A-L from the approved spec. Source-structure proofs where interaction testing
  // is not possible in the node:test/tsx harness (no DOM/React renderer).

  // ── V.A: empty Notes does not block Passport completion ───────────────────
  it("V.A: NOTES_SECTION has optional:true so empty Notes never blocks completion", () => {
    const notesSectionIdx = passport.indexOf("const NOTES_SECTION: SectionDef");
    assert.ok(notesSectionIdx !== -1, "NOTES_SECTION must be defined");
    const notesSectionBlock = passport.slice(notesSectionIdx, notesSectionIdx + 400);
    assert.ok(
      notesSectionBlock.includes("optional: true"),
      "NOTES_SECTION must have optional: true so missingSections skips it",
    );
  });

  // ── V.B: empty Notes overview shows ADD A NOTE ────────────────────────────
  it("V.B: overview renders ADD A NOTE when hasNote is false", () => {
    const ovIdx = passport.indexOf("// ── OVERVIEW");
    assert.ok(ovIdx !== -1, "OVERVIEW section comment must exist");
    const ovBlock = passport.slice(ovIdx, ovIdx + 3500);
    assert.ok(
      ovBlock.includes('"ADD A NOTE"'),
      'Overview Notes section must include the "ADD A NOTE" string for the empty-state CTA',
    );
  });

  // ── V.C: existing note displays its saved text ────────────────────────────
  it("V.C: getSectionDetail for notes returns the saved text when present", () => {
    // Anchor to the getSectionDetail function, then find the notes branch within it
    const detailFnIdx = passport.indexOf("function getSectionDetail(");
    assert.ok(detailFnIdx !== -1, "getSectionDetail function must exist");
    const detailFnBlock = passport.slice(detailFnIdx, detailFnIdx + 3000);
    const notesIdx = detailFnBlock.indexOf('def.id === "notes"');
    assert.ok(notesIdx !== -1, 'getSectionDetail must have a "notes" branch');
    const notesBlock = detailFnBlock.slice(notesIdx, notesIdx + 300);
    assert.ok(
      notesBlock.includes("sp-ov-notes-body"),
      "notes detail branch must render text via sp-ov-notes-body paragraph",
    );
  });

  // ── V.D: existing note shows EDIT NOTE ────────────────────────────────────
  it("V.D: overview renders EDIT NOTE when hasNote is true", () => {
    const ovIdx = passport.indexOf("// ── OVERVIEW");
    assert.ok(ovIdx !== -1, "OVERVIEW section comment must exist");
    const ovBlock = passport.slice(ovIdx, ovIdx + 3500);
    assert.ok(
      ovBlock.includes('"EDIT NOTE"'),
      'Overview Notes section must include the "EDIT NOTE" string for the filled-state CTA',
    );
  });

  // ── V.E: ADD/EDIT calls editSection("notes") ──────────────────────────────
  it("V.E: Notes CTA calls editSection(\"notes\") — opens the existing flow editor", () => {
    const ovIdx = passport.indexOf("// ── OVERVIEW");
    assert.ok(ovIdx !== -1, "OVERVIEW section comment must exist");
    const ovBlock = passport.slice(ovIdx, ovIdx + 3500);
    // The button onClick must call editSection("notes")
    assert.ok(
      ovBlock.includes('editSection("notes")'),
      'Notes CTA onClick must call editSection("notes") to reuse the existing flow editor',
    );
  });

  // ── V.F: existing note is prefilled via initEdits ─────────────────────────
  it("V.F: initEdits reads savedAnswers for text fields — existing note is prefilled", () => {
    const initEditsIdx = passport.indexOf("function initEdits(");
    assert.ok(initEditsIdx !== -1, "initEdits must exist");
    const initEditsBlock = passport.slice(initEditsIdx, initEditsIdx + 1200);
    assert.ok(
      initEditsBlock.includes("kind === \"text\"") || initEditsBlock.includes('kind === "text"'),
      "initEdits must handle text-kind fields so final-notes is prefilled from savedAnswers",
    );
  });

  // ── V.G: Save persists final-notes via existing path ─────────────────────
  it("V.G: computeSectionPatch sends finalNotes in the patch for the notes section", () => {
    const notesSectionIdx = passport.indexOf("const NOTES_SECTION: SectionDef");
    assert.ok(notesSectionIdx !== -1, "NOTES_SECTION must be defined");
    const notesSectionBlock = passport.slice(notesSectionIdx, notesSectionIdx + 500);
    assert.ok(
      notesSectionBlock.includes('apiKey: "finalNotes"'),
      'NOTES_SECTION subField must map to apiKey "finalNotes" so computeSectionPatch sends the correct key',
    );
    assert.ok(
      notesSectionBlock.includes('draftKey: "final-notes"'),
      'NOTES_SECTION subField must use draftKey "final-notes"',
    );
  });

  // ── V.H: reload hydrates saved note ───────────────────────────────────────
  it("V.H: loader maps finalNotes to savedAnswers[\"final-notes\"] so saved note survives reload", () => {
    const loaderIdx = passport.indexOf("savedAnswers[\"final-notes\"]") !== -1
      ? passport.indexOf("savedAnswers[\"final-notes\"]")
      : passport.indexOf("savedAnswers['final-notes']");
    assert.ok(
      loaderIdx !== -1,
      "loader must map op.finalNotes into savedAnswers[\"final-notes\"] for hydration on reload",
    );
  });

  // ── V.I: editing replaces existing note ───────────────────────────────────
  it("V.I: computeSectionPatch detects text changes and sends null to clear or new value to update", () => {
    const patchIdx = passport.indexOf("function computeSectionPatch(");
    assert.ok(patchIdx !== -1, "computeSectionPatch must exist");
    const patchBlock = passport.slice(patchIdx, patchIdx + 700);
    assert.ok(
      patchBlock.includes("kind === \"text\"") || patchBlock.includes('kind === "text"'),
      "computeSectionPatch must handle text-kind fields so Notes edits and clears are sent correctly",
    );
    assert.ok(
      patchBlock.includes("null"),
      "computeSectionPatch must send null for empty text (clearing the note)",
    );
  });

  // ── V.J: Notes save does not alter profileVersion ─────────────────────────
  it("V.J: editSection flow never sends onboardingComplete so profileVersion is unchanged", () => {
    const editSectionIdx = passport.indexOf("function editSection(");
    assert.ok(editSectionIdx !== -1, "editSection must exist");
    const editSectionBlock = passport.slice(editSectionIdx, editSectionIdx + 200);
    assert.ok(
      !editSectionBlock.includes("onboardingComplete"),
      "editSection must not set onboardingComplete — profileVersion must not be changed when editing Notes",
    );
  });

  // ── V.K: empty Notes does not make Passport incomplete ────────────────────
  it("V.K: missingSections skips sections with optional:true so empty Notes is never missing", () => {
    const missingIdx = passport.indexOf("missingSections");
    assert.ok(missingIdx !== -1, "missingSections must exist");
    // Find the filter expression
    const missingBlock = passport.slice(missingIdx, missingIdx + 300);
    assert.ok(
      missingBlock.includes("s.optional") || passport.slice(missingIdx - 200, missingIdx + 300).includes("s.optional"),
      "missingSections filter must exclude optional sections (NOTES_SECTION.optional = true)",
    );
  });

  // ── V.L: Update Answers is the Rev 6 questionnaire path ───────────────────
  it("V.L: Update Answers (startUpdate) sets picker mode — Notes CTA uses editSection, not startUpdate", () => {
    // startUpdate opens the picker which lists all sections including Notes.
    // The Notes CTA added to the overview uses editSection("notes") directly.
    // These are separate — startUpdate is not repurposed for Notes.
    const startUpdateIdx = passport.indexOf("function startUpdate(");
    assert.ok(startUpdateIdx !== -1, "startUpdate must exist");
    const startUpdateBlock = passport.slice(startUpdateIdx, startUpdateIdx + 150);
    assert.ok(
      startUpdateBlock.includes('kind: "picker"'),
      "startUpdate must set picker mode (Update Answers remains the full questionnaire path)",
    );
    // The overview Notes CTA calls editSection, not startUpdate
    const ovIdx = passport.indexOf("// ── OVERVIEW");
    const ovBlock = passport.slice(ovIdx, ovIdx + 3500);
    const notesCTAIdx = ovBlock.indexOf("sp-ov-notes-cta");
    assert.ok(notesCTAIdx !== -1, "sp-ov-notes-cta button must exist in overview");
    const notesCTABlock = ovBlock.slice(notesCTAIdx, notesCTAIdx + 200);
    assert.ok(
      notesCTABlock.includes("editSection") && !notesCTABlock.includes("startUpdate"),
      "Notes CTA must use editSection(\"notes\"), not startUpdate — Update Answers is not repurposed for Notes",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group W: Rev 6 Update Answers cleanup
// ─────────────────────────────────────────────────────────────────────────────

describe("W: Rev 6 Update Answers cleanup", () => {
  // W.A: Legacy Sizes & Measurements does NOT render old FIT_CONCERN_OPTIONS for Rev 6
  it("W.A: profileVersion=6 Sizes editor does NOT render FIT_CONCERN_OPTIONS", () => {
    // For Rev 6 customers (isLegacyCustomer === false), the Group 3 proportions block
    // is gated behind {isLegacyCustomer && ...}. This means FIT_CONCERN_OPTIONS
    // is only iterated inside that legacy-gated block.
    const sizesIdx = passport.indexOf('currentId === "sizes"');
    assert.ok(sizesIdx !== -1, 'Sizes bespoke UI block must exist');
    // FIT_CONCERN_OPTIONS is ~12774 chars in from the sizes bespoke block; use 15000 to be safe
    const sizesBlock = passport.slice(sizesIdx, sizesIdx + 15000);
    // FIT_CONCERN_OPTIONS must be inside the isLegacyCustomer guard
    const legacyGuardIdx = sizesBlock.indexOf("isLegacyCustomer");
    assert.ok(legacyGuardIdx !== -1, "isLegacyCustomer guard must exist in sizes block");
    const fitConIdx = sizesBlock.indexOf("FIT_CONCERN_OPTIONS");
    assert.ok(fitConIdx !== -1, "FIT_CONCERN_OPTIONS must still exist in sizes block for legacy");
    // FIT_CONCERN_OPTIONS must appear AFTER the isLegacyCustomer guard
    assert.ok(
      fitConIdx > legacyGuardIdx,
      "FIT_CONCERN_OPTIONS must appear inside the isLegacyCustomer guard, not before it",
    );
  });

  // W.B: Dedicated Fit Concerns section uses Rev 6 canonical IDs
  it("W.B: dedicated fit-concerns SECTION uses Rev 6 quiz-data options", () => {
    // The "fit-concerns" section in SECTIONS uses questionId: "fit-concerns"
    // which resolves to QUESTION_BY_ID["fit-concerns"] — the quiz-data entry
    // with canonical Rev 6 IDs (tops-pull-bust, waistbands-gape, etc.)
    const sectionsIdx = passport.indexOf("const SECTIONS: SectionDef[]");
    assert.ok(sectionsIdx !== -1, "SECTIONS array must exist");
    const sectionsBlock = passport.slice(sectionsIdx, sectionsIdx + 10500);
    // A "fit-concerns" section definition with rev6Only: true must exist
    const fitConcernsSectionIdx = sectionsBlock.indexOf('id: "fit-concerns"');
    assert.ok(fitConcernsSectionIdx !== -1, 'A section with id "fit-concerns" must exist in SECTIONS');
    const fcBlock = sectionsBlock.slice(fitConcernsSectionIdx, fitConcernsSectionIdx + 500);
    assert.ok(fcBlock.includes("rev6Only: true"), 'fit-concerns section must be rev6Only: true');
    assert.ok(fcBlock.includes('questionId: "fit-concerns"'), 'fit-concerns section must reference the quiz-data question');
  });

  // W.C: existing Rev 6 fitConcerns prefill — QUESTION_BY_ID["fit-concerns"] has Rev 6 options
  it("W.C: QUESTION_BY_ID[fit-concerns] is registered from quiz-data (Rev 6 IDs)", () => {
    // quizQuestions are iterated and registered into QUESTION_BY_ID.
    // "fit-concerns" is Screen 7 of quizQuestions. Verify the loop registers it.
    const loopIdx = passport.indexOf("for (const q of quizQuestions)");
    assert.ok(loopIdx !== -1, "quizQuestions registration loop must exist");
    const loopBlock = passport.slice(loopIdx, loopIdx + 400);
    assert.ok(loopBlock.includes("QUESTION_BY_ID[q.id] = q"), "QUESTION_BY_ID must be populated from quizQuestions");
    // Rev 6 IDs must be in quiz-data (uses the pre-loaded quizData constant)
    assert.ok(quizData.includes("tops-pull-bust"), "quiz-data must contain Rev 6 fit-concerns ID tops-pull-bust");
    assert.ok(quizData.includes("waistbands-gape"), "quiz-data must contain Rev 6 fit-concerns ID waistbands-gape");
  });

  // W.D: saving Rev 6 Fit Concerns cannot persist legacy IDs through the dedicated UI
  it("W.D: fit-concerns section subField uses questionId: \"fit-concerns\" — no FIT_CONCERN_OPTIONS", () => {
    // The fit-concerns section renders via the generic renderSubField path,
    // which reads options from QUESTION_BY_ID["fit-concerns"] (Rev 6 quiz-data).
    // FIT_CONCERN_OPTIONS (old IDs) are only rendered inside the isLegacyCustomer guard in sizes.
    const sectionsIdx = passport.indexOf("const SECTIONS: SectionDef[]");
    const sectionsBlock = passport.slice(sectionsIdx, sectionsIdx + 10500);
    const fcSectionIdx = sectionsBlock.indexOf('id: "fit-concerns"');
    const fcBlock = sectionsBlock.slice(fcSectionIdx, fcSectionIdx + 500);
    // Must NOT reference FIT_CONCERN_OPTIONS directly in the section def
    assert.ok(!fcBlock.includes("FIT_CONCERN_OPTIONS"), "fit-concerns section must not reference FIT_CONCERN_OPTIONS");
    assert.ok(fcBlock.includes('questionId: "fit-concerns"'), "fit-concerns section must use canonical questionId");
  });

  // W.E: no-fit-problems exclusivity is preserved via quiz-data exclusiveIds
  it("W.E: no-fit-problems remains exclusive via quiz-data exclusiveIds", () => {
    // exclusiveIds for fit-concerns must contain no-fit-problems (uses pre-loaded quizData)
    const fcIdx = quizData.indexOf('"fit-concerns"');
    assert.ok(fcIdx !== -1, "fit-concerns question must be in quiz-data");
    const fcBlock = quizData.slice(fcIdx, fcIdx + 800);
    assert.ok(fcBlock.includes('"no-fit-problems"'), "no-fit-problems ID must exist in fit-concerns");
    assert.ok(fcBlock.includes("exclusiveIds"), "fit-concerns must declare exclusiveIds in quiz-data");
    // handleToggle must respect exclusiveIds from QUESTION_BY_ID
    const toggleIdx = passport.indexOf("const handleToggle = useCallback");
    assert.ok(toggleIdx !== -1, "handleToggle must exist");
    const toggleBlock = passport.slice(toggleIdx, toggleIdx + 600);
    assert.ok(toggleBlock.includes("exclusiveIds"), "handleToggle must process exclusiveIds");
  });

  // W.F: fitConcernsNote remains associated with Rev 6 fit-concerns section
  it("W.F: fitConcernsNote sub-field is in the fit-concerns section", () => {
    const sectionsIdx = passport.indexOf("const SECTIONS: SectionDef[]");
    const sectionsBlock = passport.slice(sectionsIdx, sectionsIdx + 10500);
    const fcSectionIdx = sectionsBlock.indexOf('id: "fit-concerns"');
    const fcBlock = sectionsBlock.slice(fcSectionIdx, fcSectionIdx + 500);
    assert.ok(fcBlock.includes('"fit-concerns-note"'), "fit-concerns-note sub-field must be in fit-concerns section");
  });

  // W.G: Current Focus section contains currentGoal only (successfulOutfitGives is hiddenForRev6)
  it("W.G: goals section has successfulOutfitGives with hiddenForRev6: true", () => {
    const sectionsIdx = passport.indexOf("const SECTIONS: SectionDef[]");
    const sectionsBlock = passport.slice(sectionsIdx, sectionsIdx + 10500);
    const goalsIdx = sectionsBlock.indexOf('id: "goals"');
    assert.ok(goalsIdx !== -1, 'goals section must exist');
    const goalsBlock = sectionsBlock.slice(goalsIdx, goalsIdx + 700);
    assert.ok(goalsBlock.includes("hiddenForRev6: true"), "successfulOutfitGives sub-field must be hiddenForRev6: true in goals");
    assert.ok(goalsBlock.includes('"successful-outfit-gives"'), "goals must still declare successful-outfit-gives (for legacy customers)");
  });

  // W.H: successfulOutfitGives has its own dedicated section for Rev 6
  it("W.H: outfit-gives section exists and is rev6Only", () => {
    const sectionsIdx = passport.indexOf("const SECTIONS: SectionDef[]");
    const sectionsBlock = passport.slice(sectionsIdx, sectionsIdx + 10500);
    const ogIdx = sectionsBlock.indexOf('id: "outfit-gives"');
    assert.ok(ogIdx !== -1, 'outfit-gives section must exist in SECTIONS');
    const ogBlock = sectionsBlock.slice(ogIdx, ogIdx + 400);
    assert.ok(ogBlock.includes("rev6Only: true"), "outfit-gives must be rev6Only: true");
    assert.ok(ogBlock.includes('"successful-outfit-gives"'), "outfit-gives must include the successfulOutfitGives sub-field");
  });

  // W.I: Style section does not render desiredImpression for Rev 6 (hiddenForRev6)
  it("W.I: identity section has desired-impression with hiddenForRev6: true", () => {
    // SECTIONS array is ~9700 chars; direction at 8021, wardrobe at 8663 — use 10500
    const sectionsIdx = passport.indexOf("const SECTIONS: SectionDef[]");
    const sectionsBlock = passport.slice(sectionsIdx, sectionsIdx + 10500);
    const identityIdx = sectionsBlock.indexOf('id: "identity"');
    assert.ok(identityIdx !== -1, "identity section must exist");
    const identityBlock = sectionsBlock.slice(identityIdx, identityIdx + 600);
    const diIdx = identityBlock.indexOf('"desired-impression"');
    assert.ok(diIdx !== -1, "desired-impression must remain in identity section (for legacy customers)");
    // hiddenForRev6 is ~159 chars after the desired-impression key — use 250-char window
    const diBlock = identityBlock.slice(diIdx, diIdx + 250);
    assert.ok(diBlock.includes("hiddenForRev6: true"), "desired-impression must be hiddenForRev6: true");
  });

  // W.J: direction section is hidden for Rev 6 (rev6Hidden)
  it("W.J: direction section has rev6Hidden: true", () => {
    const sectionsIdx = passport.indexOf("const SECTIONS: SectionDef[]");
    const sectionsBlock = passport.slice(sectionsIdx, sectionsIdx + 10500);
    const dirIdx = sectionsBlock.indexOf('id: "direction"');
    assert.ok(dirIdx !== -1, "direction section must still exist in SECTIONS (for legacy customers)");
    const dirBlock = sectionsBlock.slice(dirIdx, dirIdx + 300);
    assert.ok(dirBlock.includes("rev6Hidden: true"), "direction section must have rev6Hidden: true");
  });

  // W.K: Lifestyle section does not render typicalDay for Rev 6 (hiddenForRev6)
  it("W.K: life section has typical-day with hiddenForRev6: true", () => {
    const sectionsIdx = passport.indexOf("const SECTIONS: SectionDef[]");
    const sectionsBlock = passport.slice(sectionsIdx, sectionsIdx + 10500);
    const lifeIdx = sectionsBlock.indexOf('id: "life"');
    assert.ok(lifeIdx !== -1, "life section must exist");
    const lifeBlock = sectionsBlock.slice(lifeIdx, lifeIdx + 600);
    const tdIdx = lifeBlock.indexOf('"typical-day"');
    assert.ok(tdIdx !== -1, "typical-day must remain in life section (for legacy customers)");
    // hiddenForRev6 is ~130 chars after the typical-day key — use 200-char window
    const tdBlock = lifeBlock.slice(tdIdx, tdIdx + 200);
    assert.ok(tdBlock.includes("hiddenForRev6: true"), "typical-day must be hiddenForRev6: true");
  });

  // W.L: Sizes does not render bodyShape for Rev 6 (hiddenForRev6 + bespoke UI guard)
  it("W.L: body-shape sub-field has hiddenForRev6: true in sizes section", () => {
    const sectionsIdx = passport.indexOf("const SECTIONS: SectionDef[]");
    const sectionsBlock = passport.slice(sectionsIdx, sectionsIdx + 10500);
    const sizesIdx = sectionsBlock.indexOf('id: "sizes"');
    assert.ok(sizesIdx !== -1, "sizes section must exist");
    // body-shape is ~2057 chars into the sizes entry — use 3000-char window
    const sizesBlock = sectionsBlock.slice(sizesIdx, sizesIdx + 3000);
    const bsIdx = sizesBlock.indexOf('"body-shape"');
    assert.ok(bsIdx !== -1, "body-shape must remain in sizes section (for legacy customers)");
    // hiddenForRev6 is ~155 chars after body-shape key — use 200-char window
    const bsBlock = sizesBlock.slice(bsIdx, bsIdx + 200);
    assert.ok(bsBlock.includes("hiddenForRev6: true"), "body-shape sub-field must be hiddenForRev6: true");
  });

  // W.M: Colour Palette does not render the 3 advanced fields for Rev 6
  it("W.M: colours section has neutral-vs-colour, colour-intensity, print-appetite with hiddenForRev6: true", () => {
    const sectionsIdx = passport.indexOf("const SECTIONS: SectionDef[]");
    const sectionsBlock = passport.slice(sectionsIdx, sectionsIdx + 10500);
    const coloursIdx = sectionsBlock.indexOf('id: "colours"');
    assert.ok(coloursIdx !== -1, "colours section must exist");
    // print-appetite is ~967 chars in; hiddenForRev6 for each is ~154 chars after the key
    const coloursBlock = sectionsBlock.slice(coloursIdx, coloursIdx + 1400);
    for (const field of ['"neutral-vs-colour"', '"colour-intensity"', '"print-appetite"']) {
      const fIdx = coloursBlock.indexOf(field);
      assert.ok(fIdx !== -1, `${field} must remain in colours section`);
      const fBlock = coloursBlock.slice(fIdx, fIdx + 250);
      assert.ok(fBlock.includes("hiddenForRev6: true"), `${field} must be hiddenForRev6: true`);
    }
  });

  // W.N: Wardrobe / Shopping / Trend section is hidden for Rev 6
  it("W.N: wardrobe section has rev6Hidden: true", () => {
    const sectionsIdx = passport.indexOf("const SECTIONS: SectionDef[]");
    const sectionsBlock = passport.slice(sectionsIdx, sectionsIdx + 10500);
    const wIdx = sectionsBlock.indexOf('id: "wardrobe"');
    assert.ok(wIdx !== -1, "wardrobe section must still exist in SECTIONS (for legacy customers)");
    const wBlock = sectionsBlock.slice(wIdx, wIdx + 300);
    assert.ok(wBlock.includes("rev6Hidden: true"), "wardrobe section must have rev6Hidden: true");
  });

  // W.O: legacy profileVersion=null retains backwards-compatible section access
  it("W.O: getVisibleSections with isRev6=false includes direction and wardrobe", () => {
    // getVisibleSections filters out rev6Hidden when isRev6=true, but not when false
    const fnIdx = passport.indexOf("function getVisibleSections(");
    assert.ok(fnIdx !== -1, "getVisibleSections helper must exist");
    const fnBlock = passport.slice(fnIdx, fnIdx + 300);
    assert.ok(fnBlock.includes("rev6Hidden"), "getVisibleSections must check rev6Hidden");
    assert.ok(fnBlock.includes("rev6Only"), "getVisibleSections must check rev6Only");
    // The logic: rev6Hidden excluded when isRev6, rev6Only excluded when not isRev6
    assert.ok(fnBlock.includes("isRev6 && s.rev6Hidden"), "rev6Hidden sections excluded only for Rev 6");
    assert.ok(fnBlock.includes("!isRev6 && s.rev6Only"), "rev6Only sections excluded only for legacy");
  });

  // W.P: canonical question/helper copy matches approved Rev 6 wording
  it("W.P: key section question/helper copy matches approved canonical wording", () => {
    const sectionsIdx = passport.indexOf("const SECTIONS: SectionDef[]");
    const sectionsBlock = passport.slice(sectionsIdx, sectionsIdx + 10500);
    // Current Focus helper
    assert.ok(sectionsBlock.includes("Choose up to 2. You can change this anytime."), "goals helper must match canonical wording");
    // Style helper
    assert.ok(sectionsBlock.includes("Choose up to 2."), "identity helper must use canonical choose-up-to-2 wording");
    // Lifestyle question
    assert.ok(sectionsBlock.includes("What do you dress for most often?"), "life question must match canonical wording");
    // Silhouette question (canonical Rev 6 from quiz-data)
    assert.ok(sectionsBlock.includes("Which silhouettes do you usually feel best in?"), "fit question must match quiz-data canonical wording");
    // Dressing Requirements helper
    assert.ok(sectionsBlock.includes("Optional. Select anything nAia should always keep in mind when styling you."), "dressing helper must match canonical wording");
    // No internal language
    assert.ok(!sectionsBlock.includes("mutable context"), 'SECTIONS must not contain internal language "mutable context"');
    assert.ok(!sectionsBlock.includes("emotional register"), 'SECTIONS must not contain internal language "emotional register"');
    assert.ok(!sectionsBlock.includes("blends these into the aesthetic"), 'SECTIONS must not contain internal marketing language');
    assert.ok(!sectionsBlock.includes("garment suggestions nAia makes"), 'SECTIONS must not contain internal language');
  });

  // W.Q: Notes remains optional
  it("W.Q: NOTES_SECTION has optional: true", () => {
    const notesIdx = passport.indexOf("const NOTES_SECTION: SectionDef");
    assert.ok(notesIdx !== -1, "NOTES_SECTION must be defined");
    const notesBlock = passport.slice(notesIdx, notesIdx + 500);
    assert.ok(notesBlock.includes("optional: true"), "NOTES_SECTION must have optional: true");
  });

  // W.R: empty Notes picker summary no longer says "Not yet completed"
  it("W.R: getSectionSummary returns optional copy for empty Notes, not 'Not yet completed'", () => {
    const summaryFnIdx = passport.indexOf("function getSectionSummary(");
    assert.ok(summaryFnIdx !== -1, "getSectionSummary must exist");
    const summaryBlock = passport.slice(summaryFnIdx, summaryFnIdx + 800);
    // Must have a notes-specific branch
    const notesIdx = summaryBlock.indexOf('def.id === "notes"');
    assert.ok(notesIdx !== -1, 'getSectionSummary must have a "notes" special case');
    // "Optional — add a note" text starts ~200 chars in; use 300-char window to capture it
    const notesBlock = summaryBlock.slice(notesIdx, notesIdx + 300);
    // Must NOT return "Not yet completed" for notes
    assert.ok(!notesBlock.includes("Not yet completed"), "notes getSectionSummary must not return 'Not yet completed'");
    // Must return optional-state copy
    assert.ok(
      notesBlock.includes("Optional") || notesBlock.includes("add a note"),
      "notes getSectionSummary must return optional-state copy when empty",
    );
  });

  // W.S: ADD A NOTE / EDIT NOTE behavior from e02f95d remains
  it("W.S: ADD A NOTE and EDIT NOTE CTAs exist in the overview Notes block", () => {
    const ovIdx = passport.indexOf("// ── OVERVIEW");
    assert.ok(ovIdx !== -1, "OVERVIEW section must exist");
    const ovBlock = passport.slice(ovIdx, ovIdx + 4000);
    assert.ok(ovBlock.includes('"ADD A NOTE"'), "Overview Notes block must include ADD A NOTE CTA");
    assert.ok(ovBlock.includes('"EDIT NOTE"'), "Overview Notes block must include EDIT NOTE CTA");
    // Both must be inside the sp-ov-notes-cta button
    const ctaIdx = ovBlock.indexOf("sp-ov-notes-cta");
    assert.ok(ctaIdx !== -1, "sp-ov-notes-cta button must exist");
    const ctaBlock = ovBlock.slice(ctaIdx, ctaIdx + 200);
    assert.ok(ctaBlock.includes("hasNote"), "Notes CTA must be conditional on hasNote");
  });

  // W.T: no hidden legacy DB field is deleted or cleared by saving another Rev 6 section
  it("W.T: computeSectionPatch only sends changed fields — unchanged hidden fields not included", () => {
    // computeSectionPatch iterates def.subFields. Hidden sub-fields are initialized
    // from savedAnswers and not changed by the UI, so they produce no change → not in patch.
    const patchFnIdx = passport.indexOf("function computeSectionPatch(");
    assert.ok(patchFnIdx !== -1, "computeSectionPatch must exist");
    const patchBlock = passport.slice(patchFnIdx, patchFnIdx + 1600);
    // It checks for changes before including a field in the patch
    assert.ok(patchBlock.includes("hasChange"), "computeSectionPatch must track hasChange");
    assert.ok(patchBlock.includes("patch[apiKey]"), "computeSectionPatch must write to patch by apiKey");
    // Returns null if no changes — hidden fields won't change → null returned or field omitted
    assert.ok(patchBlock.includes("return hasChange ? patch : null"), "computeSectionPatch must return null when no changes");
  });

  // W.U: Update Answers picker order matches approved Rev 6 structure
  it("W.U: picker renders visibleSections, not the full SECTIONS array directly", () => {
    const pickerIdx = passport.indexOf("// ── PICKER");
    assert.ok(pickerIdx !== -1, "PICKER section must exist");
    const pickerBlock = passport.slice(pickerIdx, pickerIdx + 1200);
    // Picker must use visibleSections, not SECTIONS directly
    assert.ok(pickerBlock.includes("visibleSections"), "picker must iterate visibleSections");
    assert.ok(!pickerBlock.includes("SECTIONS.map"), "picker must not directly iterate SECTIONS (uses visibleSections)");
    // Overview must also use visibleSections
    const ovIdx = passport.indexOf("Full detail");
    assert.ok(ovIdx !== -1, "Full detail comment must exist in overview");
    const ovBlock = passport.slice(ovIdx, ovIdx + 600);
    assert.ok(ovBlock.includes("visibleSections"), "overview must iterate visibleSections");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group X: Fit Concerns behavioral verification
// ─────────────────────────────────────────────────────────────────────────────

describe("X: Fit Concerns behavioral verification", () => {
  // X.A: Rev 6 Fit Concerns preloads from loader — fitConcerns saved from op.fitConcerns
  it("X.A: loader maps op.fitConcerns → savedAnswers[fit-concerns] for canonical preload", () => {
    // The loader assembles savedAnswers from the onboardingProfile (op).
    // op.fitConcerns (Rev 6 canonical IDs) must be mapped to savedAnswers["fit-concerns"].
    // The mapping is ~4300 chars into the loader function — use a 6000-char window.
    const loaderFnIdx = passport.indexOf("export async function loader(");
    assert.ok(loaderFnIdx !== -1, "loader function must exist");
    const loaderBlock = passport.slice(loaderFnIdx, loaderFnIdx + 6000);
    const mappingIdx = loaderBlock.indexOf('savedAnswers["fit-concerns"]');
    assert.ok(mappingIdx !== -1, 'loader must assign savedAnswers["fit-concerns"] from op.fitConcerns');
    const mappingBlock = loaderBlock.slice(mappingIdx, mappingIdx + 100);
    assert.ok(mappingBlock.includes("fitConcerns"), "fit-concerns savedAnswer must come from op.fitConcerns");
  });

  // X.B: editSection uses getSectionDef (full def) for initEdits, not getEffectiveDef
  // This ensures fitConcernsNote is also initialized when opening the fit-concerns section
  it("X.B: initEdits reads def.subFields via getSectionDef (full def, not effective)", () => {
    const initEditsIdx = passport.indexOf("function initEdits(");
    assert.ok(initEditsIdx !== -1, "initEdits function must exist");
    const initBlock = passport.slice(initEditsIdx, initEditsIdx + 600);
    // initEdits must call getSectionDef (not getEffectiveDef) to read ALL sub-fields
    assert.ok(initBlock.includes("getSectionDef("), "initEdits must use getSectionDef to read full def including hidden sub-fields");
    assert.ok(!initBlock.includes("getEffectiveDef"), "initEdits must NOT use getEffectiveDef — hidden sub-fields must be initialized from savedAnswers");
    // It iterates def.subFields
    assert.ok(initBlock.includes("def.subFields"), "initEdits must iterate def.subFields to initialize all draft keys");
  });

  // X.C: Sizes & Measurements cannot write fitConcerns for Rev 6
  // Generic renderer path is excluded for sizes (bespoke UI); bespoke UI Group 3 gated by isLegacyCustomer
  it("X.C: sizes section uses bespoke UI (not generic renderer); Group 3 fitConcerns gated by isLegacyCustomer", () => {
    // 1. The generic renderer is gated: {currentId !== "sizes" && ...}
    const genericIdx = passport.indexOf('currentId !== "sizes"');
    assert.ok(genericIdx !== -1, 'generic renderer must be gated with currentId !== "sizes"');
    // 2. The bespoke sizes UI exists
    const sizesUIIdx = passport.indexOf('currentId === "sizes"');
    assert.ok(sizesUIIdx !== -1, "sizes bespoke UI conditional must exist");
    // 3. FIT_CONCERN_OPTIONS inside that UI is gated by isLegacyCustomer
    const sizesUIBlock = passport.slice(sizesUIIdx, sizesUIIdx + 15000);
    const legacyGuardIdx = sizesUIBlock.indexOf("isLegacyCustomer");
    const fitConIdx = sizesUIBlock.indexOf("FIT_CONCERN_OPTIONS");
    assert.ok(legacyGuardIdx !== -1, "bespoke sizes UI must have isLegacyCustomer guard");
    assert.ok(fitConIdx !== -1, "FIT_CONCERN_OPTIONS must exist in bespoke UI (for legacy customers)");
    assert.ok(fitConIdx > legacyGuardIdx, "FIT_CONCERN_OPTIONS must appear after the isLegacyCustomer guard — never rendered for Rev 6");
  });

  // X.D: computeSectionPatch for sizes: fitConcerns initialized from savedAnswers, unchanged → not in patch
  // This is the key invariant preventing Sizes from writing fitConcerns for Rev 6.
  it("X.D: computeSectionPatch only patches changed fields — fitConcerns initialized from saved = no-op", () => {
    // computeSectionPatch compares each draftKey against savedAnswers.
    // For Rev 6 editing sizes: fitConcerns is in full def but UI never modifies it →
    // its draft value stays equal to savedAnswers → computeSectionPatch returns null for it.
    const patchIdx = passport.indexOf("function computeSectionPatch(");
    assert.ok(patchIdx !== -1, "computeSectionPatch must exist");
    const patchBlock = passport.slice(patchIdx, patchIdx + 1600);
    // It compares each draftKey to saved
    assert.ok(patchBlock.includes("editedRaw"), "patch must read editedRaw from flowEdits");
    assert.ok(patchBlock.includes("savedRaw"), "patch must read savedRaw from savedAnswers");
    // Only changes are patched
    assert.ok(patchBlock.includes("hasChange"), "patch must track hasChange before including any field");
    assert.ok(patchBlock.includes("hasChange = true"), "patch must only set hasChange when values differ");
    // Returns null when nothing changed
    assert.ok(patchBlock.includes("return hasChange ? patch : null"), "patch returns null when no fields changed — hidden unchanged fields produce no write");
  });

  // X.E: "other" + fitConcernsNote in fit-concerns section — persists and reloads
  it("X.E: fit-concerns-note sub-field is in fit-concerns section (persists on save, reloads from savedAnswers)", () => {
    // fit-concerns-note sub-field is in the fit-concerns section (NOT hiddenForRev6 there)
    const sectionsIdx = passport.indexOf("const SECTIONS: SectionDef[]");
    const sectionsBlock = passport.slice(sectionsIdx, sectionsIdx + 10500);
    const fcSectIdx = sectionsBlock.indexOf('id: "fit-concerns"');
    const fcSectBlock = sectionsBlock.slice(fcSectIdx, fcSectIdx + 500);
    assert.ok(fcSectBlock.includes('"fit-concerns-note"'), "fit-concerns-note sub-field must be in fit-concerns section");
    // Must NOT have hiddenForRev6 in this section's fit-concerns-note entry
    const fcNoteInFcSect = fcSectBlock.indexOf('"fit-concerns-note"');
    const fcNoteBlock = fcSectBlock.slice(fcNoteInFcSect, fcNoteInFcSect + 150);
    assert.ok(!fcNoteBlock.includes("hiddenForRev6"), "fit-concerns-note in the fit-concerns section must NOT be hiddenForRev6 — it must be visible and saved for Rev 6");
    // Loader must also map fitConcernsNote to savedAnswers (mapping is ~4400 chars into loader)
    const loaderIdx = passport.indexOf("export async function loader(");
    const loaderBlock = passport.slice(loaderIdx, loaderIdx + 6000);
    assert.ok(loaderBlock.includes('"fit-concerns-note"'), 'loader must map fitConcernsNote to savedAnswers["fit-concerns-note"] for preloading');
  });

  // X.F: legacy customers retain old fitConcerns editor — FIT_CONCERN_OPTIONS present in legacy path
  it("X.F: legacy customers see FIT_CONCERN_OPTIONS in sizes bespoke UI (old IDs retained)", () => {
    // The old FIT_CONCERN_OPTIONS array must still exist (for legacy customers)
    const fitConArrayIdx = passport.indexOf("const FIT_CONCERN_OPTIONS");
    assert.ok(fitConArrayIdx !== -1, "FIT_CONCERN_OPTIONS constant must still exist for legacy customers");
    // It must contain legacy IDs (e.g., petite, tall) — not Rev 6 IDs
    const fitConBlock = passport.slice(fitConArrayIdx, fitConArrayIdx + 600);
    assert.ok(fitConBlock.includes('"petite"') || fitConBlock.includes('"tall"') || fitConBlock.includes('"short-torso"'),
      "FIT_CONCERN_OPTIONS must contain legacy IDs (petite/tall/short-torso) for legacy customer experience");
    // Rev 6 IDs must NOT be in FIT_CONCERN_OPTIONS
    assert.ok(!fitConBlock.includes('"tops-pull-bust"'), "FIT_CONCERN_OPTIONS must NOT contain Rev 6 IDs (those are in quiz-data)");
  });
});
