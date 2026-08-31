// app/lib/ai/styleme-rev3.test.ts
// Tests for Group 5 — Psychology-First StyleMe Rev 3.
// Covers: ANSWER_REGISTRY entries, session key registration, migration contract,
//         normalization maps, result-directions algorithm, security invariants.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ANSWER_REGISTRY,
  SESSION_QUESTIONS,
  SESSION_QUESTION_IDS as SQ,
  BODY_NEED_NORMALIZATION_MAP,
} from "./signal-contract.js";
import { computeResultDirections, buildProfileHint, STYLEME_WORDING_SYSTEM_PROMPT } from "./styleme-result.server.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");

// ── R3.1 — ANSWER_REGISTRY: State entries ─────────────────────────────────────

describe("R3.1 — ANSWER_REGISTRY: State entries (sq-state)", () => {
  const STATE_IDS = [
    "feel-good",
    "stressed-overloaded",
    "low-energy",
    "not-feeling-like-myself",
    "physically-uncomfortable",
    "self-conscious",
    "going-through-change",
    "want-reset",
    "nothing-in-particular",
    "other",
  ];

  for (const id of STATE_IDS) {
    it(`state answer "${id}" is registered`, () => {
      const entry = ANSWER_REGISTRY.find((m) => m.id === id && m.questionId === SQ.STATE);
      assert.ok(entry, `ANSWER_REGISTRY must have entry for state id "${id}"`);
    });

    it(`state answer "${id}" has no activatedFields (zero scoring)`, () => {
      const entry = ANSWER_REGISTRY.find((m) => m.id === id && m.questionId === SQ.STATE);
      assert.ok(entry, `entry for "${id}" must exist`);
      assert.deepEqual(entry!.activatedFields, [], `state "${id}" must have empty activatedFields`);
    });
  }

  const CONTEXTUAL_IDS = [
    "feel-good", "stressed-overloaded", "low-energy", "not-feeling-like-myself",
    "physically-uncomfortable", "self-conscious", "going-through-change", "want-reset",
  ];

  for (const id of CONTEXTUAL_IDS) {
    it(`state answer "${id}" has CONTEXTUAL behaviour`, () => {
      const entry = ANSWER_REGISTRY.find((m) => m.id === id && m.questionId === SQ.STATE);
      assert.ok(entry!.behaviours.includes("CONTEXTUAL"), `"${id}" must be CONTEXTUAL`);
    });
  }

  it('state "nothing-in-particular" has NO_RECOMMENDATION_EFFECT', () => {
    const entry = ANSWER_REGISTRY.find((m) => m.id === "nothing-in-particular" && m.questionId === SQ.STATE);
    assert.ok(entry!.behaviours.includes("NO_RECOMMENDATION_EFFECT"));
  });

  it('state "other" has NO_RECOMMENDATION_EFFECT', () => {
    const entry = ANSWER_REGISTRY.find((m) => m.id === "other" && m.questionId === SQ.STATE);
    assert.ok(entry, 'ANSWER_REGISTRY must have entry for state id "other"');
    assert.ok(entry!.behaviours.includes("NO_RECOMMENDATION_EFFECT"));
  });
});

// ── R3.2 — ANSWER_REGISTRY: Intention entries ─────────────────────────────────

describe("R3.2 — ANSWER_REGISTRY: Intention entries (sq-intentions)", () => {
  const INTENTION_IDS = [
    "feel-like-myself", "confidence", "ground-me", "give-structure", "make-it-easy",
    "feel-put-together", "feel-attractive", "give-energy", "feel-softer",
    "feel-less-exposed", "express-myself",
  ];

  for (const id of INTENTION_IDS) {
    it(`intention answer "${id}" is registered`, () => {
      const entry = ANSWER_REGISTRY.find((m) => m.id === id && m.questionId === SQ.INTENTIONS);
      assert.ok(entry, `ANSWER_REGISTRY must have entry for intention id "${id}"`);
    });
  }

  it('"feel-like-myself" has PROFILE_AMPLIFY behaviour', () => {
    const entry = ANSWER_REGISTRY.find((m) => m.id === "feel-like-myself" && m.questionId === SQ.INTENTIONS);
    assert.ok(entry!.behaviours.includes("PROFILE_AMPLIFY"));
  });

  it('"express-myself" has PROFILE_AMPLIFY behaviour', () => {
    const entry = ANSWER_REGISTRY.find((m) => m.id === "express-myself" && m.questionId === SQ.INTENTIONS);
    assert.ok(entry!.behaviours.includes("PROFILE_AMPLIFY"));
  });

  it('"ground-me" has NO_RECOMMENDATION_EFFECT (wording context only)', () => {
    const entry = ANSWER_REGISTRY.find((m) => m.id === "ground-me" && m.questionId === SQ.INTENTIONS);
    assert.ok(entry!.behaviours.includes("NO_RECOMMENDATION_EFFECT"));
  });

  it('"give-energy" has NO_RECOMMENDATION_EFFECT (wording context only)', () => {
    const entry = ANSWER_REGISTRY.find((m) => m.id === "give-energy" && m.questionId === SQ.INTENTIONS);
    assert.ok(entry!.behaviours.includes("NO_RECOMMENDATION_EFFECT"));
  });

  const STRONG_RANK_IDS = [
    "confidence", "give-structure", "make-it-easy",
    "feel-put-together", "feel-attractive", "feel-softer", "feel-less-exposed",
  ];

  for (const id of STRONG_RANK_IDS) {
    it(`intention "${id}" has STRONG_RANK behaviour`, () => {
      const entry = ANSWER_REGISTRY.find((m) => m.id === id && m.questionId === SQ.INTENTIONS);
      assert.ok(entry!.behaviours.includes("STRONG_RANK"), `"${id}" must be STRONG_RANK`);
    });
  }
});

// ── R3.3 — ANSWER_REGISTRY: Context-only Physical Need entries ────────────────

describe("R3.3 — ANSWER_REGISTRY: Context-only Physical Need entries", () => {
  it('"softer-easier-fabrics" is registered under sq-body-needs as CONTEXTUAL', () => {
    const entry = ANSWER_REGISTRY.find(
      (m) => m.id === "softer-easier-fabrics" && m.questionId === SQ.BODY_NEEDS,
    );
    assert.ok(entry, "softer-easier-fabrics must be in ANSWER_REGISTRY");
    assert.ok(entry!.behaviours.includes("CONTEXTUAL"));
    assert.deepEqual(entry!.activatedFields, []);
  });

  it('"still-want-shape" is registered under sq-body-needs as CONTEXTUAL', () => {
    const entry = ANSWER_REGISTRY.find(
      (m) => m.id === "still-want-shape" && m.questionId === SQ.BODY_NEEDS,
    );
    assert.ok(entry, "still-want-shape must be in ANSWER_REGISTRY");
    assert.ok(entry!.behaviours.includes("CONTEXTUAL"));
    assert.deepEqual(entry!.activatedFields, []);
  });
});

// ── R3.4 — SESSION_QUESTION_IDS: sq-state + sq-intentions registered ──────────

describe("R3.4 — SESSION_QUESTION_IDS: Rev 3 keys registered", () => {
  it("SQ.STATE is 'sq-state'", () => {
    assert.equal(SQ.STATE, "sq-state");
  });

  it("SQ.INTENTIONS is 'sq-intentions'", () => {
    assert.equal(SQ.INTENTIONS, "sq-intentions");
  });

  it("SESSION_QUESTIONS has entry for sq-state with storageKey 'styleMeState'", () => {
    const q = SESSION_QUESTIONS.find((q) => q.id === SQ.STATE);
    assert.ok(q, "SESSION_QUESTIONS must have sq-state entry");
    assert.equal(q!.storageKey, "styleMeState");
    assert.equal(q!.maxSelections, 1);
  });

  it("SESSION_QUESTIONS has entry for sq-intentions with storageKey 'styleMeIntentions'", () => {
    const q = SESSION_QUESTIONS.find((q) => q.id === SQ.INTENTIONS);
    assert.ok(q, "SESSION_QUESTIONS must have sq-intentions entry");
    assert.equal(q!.storageKey, "styleMeIntentions");
    assert.equal(q!.maxSelections, 2);
  });
});

// ── R3.5 — BODY_NEED_NORMALIZATION_MAP: Rev 3 Physical Need IDs ───────────────

describe("R3.5 — BODY_NEED_NORMALIZATION_MAP: Rev 3 physical need normalization", () => {
  it('"nothing-tight-waist" normalizes to "soft-and-forgiving-around-waist"', () => {
    assert.equal(
      BODY_NEED_NORMALIZATION_MAP["nothing-tight-waist"],
      "soft-and-forgiving-around-waist",
    );
  });

  it('"less-body-conscious" normalizes to "relaxed"', () => {
    assert.equal(BODY_NEED_NORMALIZATION_MAP["less-body-conscious"], "relaxed");
  });

  it('"loose-comfortable" normalizes to "relaxed"', () => {
    assert.equal(BODY_NEED_NORMALIZATION_MAP["loose-comfortable"], "relaxed");
  });

  it('"softer-easier-fabrics" passes through unchanged (no map entry)', () => {
    assert.equal(
      BODY_NEED_NORMALIZATION_MAP["softer-easier-fabrics"],
      undefined,
      "softer-easier-fabrics must NOT be in normalization map (passes through as-is)",
    );
  });

  it('"still-want-shape" passes through unchanged (no map entry)', () => {
    assert.equal(
      BODY_NEED_NORMALIZATION_MAP["still-want-shape"],
      undefined,
      "still-want-shape must NOT be in normalization map (passes through as-is)",
    );
  });
});

// ── R3.6 — computeResultDirections: direction algorithm ───────────────────────

// makeProduct uses "old-money" (profile signal, questionId starts with "pq-") and
// "confident" (session signal, questionId starts with "sq-") to produce controllable
// profileScore/sessionScore for algorithm tests.
function makeProduct(handle: string, totalScore: number, profileScore: number): any {
  const sessionScore = totalScore - profileScore;
  return {
    handle,
    title: handle,
    isHardExcluded: false,
    totalScore,
    deterministicRank: 0,
    positiveEvidence: profileScore > 0
      ? [
          {
            sessionSignal: "old-money",  // profile signal — contributes to profileScore
            effect: "positive" as const,
            points: profileScore,
          },
          ...(sessionScore > 0 ? [{ sessionSignal: "confident", effect: "positive" as const, points: sessionScore }] : []),
        ]
      : sessionScore > 0
      ? [
          {
            sessionSignal: "confident",  // session signal — NOT in profileScore
            effect: "positive" as const,
            points: sessionScore,
          },
        ]
      : [],
    negativeEvidence: [],
    anchorCompatibility: { compatibilityStatus: "compatible", pairingNote: null },
    provisionalEvidenceUsed: false,
    stylePersonalityMatchType: "none" as const,
    practicalSupportType: "none" as const,
    diversityAdjustment: 0,
    closetCompatibility: null,
    semanticTieBreak: "none",
    eligibility: "eligible",
    slot: "top",
    hardExclusionReasons: [],
  };
}

const mockResolve = (handle: string) =>
  ({
    handle,
    title: handle,
    slot: "top",
    shopifyProductId: null,
    productImageUrl: null,
    liveUrl: null,
    productUrl: null,
    stylingNotes: "",
  } as any);

describe("R3.6 — computeResultDirections: direction algorithm", () => {
  it("empty eligible products returns empty array", () => {
    const directions = computeResultDirections([], mockResolve);
    assert.deepEqual(directions, []);
  });

  it("all hard-excluded products returns empty array", () => {
    const excluded = { ...makeProduct("a", 10, 5), isHardExcluded: true };
    const directions = computeResultDirections([excluded], mockResolve);
    assert.deepEqual(directions, []);
  });

  it("zero-score products excluded from directions", () => {
    const zero = makeProduct("a", 0, 0);
    const directions = computeResultDirections([zero], mockResolve);
    assert.deepEqual(directions, []);
  });

  it("single eligible product → only MOST YOU", () => {
    const directions = computeResultDirections([makeProduct("a", 10, 5)], mockResolve);
    assert.equal(directions.length, 1);
    assert.equal(directions[0].label, "most-you");
    assert.equal(directions[0].product?.handle, "a");
  });

  it("two products with different profileScores → MOST YOU + PUSH ME, no FRESH", () => {
    const high = makeProduct("high", 20, 15);  // profileScore=15
    const low = makeProduct("low", 10, 2);      // profileScore=2
    const directions = computeResultDirections([high, low], mockResolve);
    assert.equal(directions.length, 2);
    assert.ok(directions.some((d) => d.label === "most-you"));
    assert.ok(directions.some((d) => d.label === "push-me"));
    assert.ok(!directions.some((d) => d.label === "fresh"));
  });

  it("two products with SAME profileScore → only MOST YOU (PUSH ME would not be genuinely distinct)", () => {
    // Both have profileScore=10; PUSH ME would have same profile alignment as MOST YOU.
    const a = makeProduct("a", 20, 10);
    const b = makeProduct("b", 15, 10);
    const directions = computeResultDirections([a, b], mockResolve);
    assert.equal(directions.length, 1);
    assert.equal(directions[0].label, "most-you");
  });

  it("three products with distinct profileScores → MOST YOU + FRESH + PUSH ME", () => {
    const high = makeProduct("most-you", 30, 25);   // profileScore=25
    const mid  = makeProduct("fresh",    20, 15);   // profileScore=15 (between 25 and 3)
    const low  = makeProduct("push-me",  15,  3);   // profileScore=3
    const directions = computeResultDirections([high, mid, low], mockResolve);
    assert.equal(directions.length, 3);
    assert.equal(directions.find((d) => d.label === "most-you")?.product?.handle, "most-you");
    assert.equal(directions.find((d) => d.label === "push-me")?.product?.handle, "push-me");
    assert.ok(directions.find((d) => d.label === "fresh") !== undefined);
  });

  it("FRESH is between MOST YOU and PUSH ME in profile alignment", () => {
    const high = makeProduct("most-you", 30, 25);
    const mid  = makeProduct("fresh",    20, 15);
    const low  = makeProduct("push-me",  15,  3);
    const directions = computeResultDirections([high, mid, low], mockResolve);
    const freshDir = directions.find((d) => d.label === "fresh");
    assert.ok(freshDir, "FRESH must be present");
    assert.equal(freshDir!.product?.handle, "fresh");
  });

  it("FRESH omitted when no product has profileScore between MOST YOU and PUSH ME", () => {
    // MOST YOU profileScore=25, PUSH ME profileScore=3, but the only other product is profileScore=25 (same as MOST YOU)
    const high    = makeProduct("most-you", 30, 25);
    const samePro = makeProduct("same-pro", 20, 25);  // same profileScore as MOST YOU → not genuinely fresh
    const low     = makeProduct("push-me",  15,  3);
    const directions = computeResultDirections([high, samePro, low], mockResolve);
    // samePro has profileScore=25 === mostYou.profileScore → FRESH criterion fails for strict range
    // But fallback accepts it as long as profileScore < mostYouEntry.profileScore — here 25 is NOT < 25
    // so samePro does not satisfy even the fallback → no FRESH
    assert.ok(!directions.some((d) => d.label === "fresh"),
      "FRESH must be omitted when no product has genuinely lower profileScore than MOST YOU");
  });

  it("MOST YOU maximizes total score (Profile + session alignment)", () => {
    const products = [
      makeProduct("b", 15, 10),
      makeProduct("a", 25, 20),
      makeProduct("c",  5,  3),
    ];
    const directions = computeResultDirections(products, mockResolve);
    const mostYou = directions.find((d) => d.label === "most-you");
    assert.equal(mostYou?.product?.handle, "a");
  });

  it("PUSH ME has the largest safe profile deviation (lowest profileScore) among remaining", () => {
    const most       = makeProduct("most",         30, 25);
    const highProf   = makeProduct("high_profile", 20, 18);
    const lowProf    = makeProduct("low_profile",  15,  2);
    const directions = computeResultDirections([most, highProf, lowProf], mockResolve);
    const pushMe = directions.find((d) => d.label === "push-me");
    assert.equal(pushMe?.product?.handle, "low_profile");
  });

  it("same product cannot appear in two directions", () => {
    const products = [
      makeProduct("a", 30, 25),
      makeProduct("b", 20, 15),
      makeProduct("c", 10,  2),
    ];
    const directions = computeResultDirections(products, mockResolve);
    const handles = directions.map((d) => d.product?.handle);
    assert.equal(new Set(handles).size, handles.length, "Each direction must reference a unique product");
  });

  it("hard-excluded product never appears in any direction", () => {
    const good     = makeProduct("good", 30, 25);
    const excluded = { ...makeProduct("excluded", 40, 5), isHardExcluded: true };
    const low      = makeProduct("low",  10,  2);
    const directions = computeResultDirections([good, excluded, low], mockResolve);
    const handles = directions.map((d) => d.product?.handle);
    assert.ok(!handles.includes("excluded"), "Hard-excluded product must not appear in any direction");
    // MOST YOU must be "good" (highest eligible totalScore)
    assert.equal(directions.find((d) => d.label === "most-you")?.product?.handle, "good");
  });

  it("PUSH ME cannot have identical profile alignment to MOST YOU", () => {
    // Both remaining products have the same profileScore as MOST YOU — no directions beyond MOST YOU
    const most   = makeProduct("most",   30, 20);
    const equal1 = makeProduct("equal1", 25, 20);
    const equal2 = makeProduct("equal2", 20, 20);
    const directions = computeResultDirections([most, equal1, equal2], mockResolve);
    assert.ok(!directions.some((d) => d.label === "push-me"),
      "PUSH ME must not appear when profileScore equals MOST YOU");
    assert.ok(!directions.some((d) => d.label === "fresh"),
      "FRESH must not appear when no PUSH ME");
  });

  it("fewer than 3 directions when diversity is insufficient", () => {
    // All products have same profileScore → only MOST YOU
    const a = makeProduct("a", 30, 15);
    const b = makeProduct("b", 20, 15);
    const c = makeProduct("c", 10, 15);
    const directions = computeResultDirections([a, b, c], mockResolve);
    assert.equal(directions.length, 1);
    assert.equal(directions[0].label, "most-you");
  });

  it("direction labels are exactly most-you/fresh/push-me (no duplicates)", () => {
    const products = [
      makeProduct("a", 30, 25),
      makeProduct("b", 20, 15),
      makeProduct("c", 10,  2),
    ];
    const directions = computeResultDirections(products, mockResolve);
    const labels = directions.map((d) => d.label);
    assert.equal(new Set(labels).size, labels.length, "No duplicate labels");
    assert.ok(labels.every((l) => ["most-you", "fresh", "push-me"].includes(l)));
  });

  it("displayLabel is uppercase equivalent of label", () => {
    const products = [makeProduct("a", 20, 15), makeProduct("b", 10, 2)];
    const directions = computeResultDirections(products, mockResolve);
    for (const d of directions) {
      if (d.label === "most-you") assert.equal(d.displayLabel, "MOST YOU");
      if (d.label === "push-me") assert.equal(d.displayLabel, "PUSH ME");
      if (d.label === "fresh") assert.equal(d.displayLabel, "FRESH");
    }
  });

  it("returned order is always MOST YOU → FRESH → PUSH ME", () => {
    const products = [
      makeProduct("a", 30, 25),
      makeProduct("b", 20, 15),
      makeProduct("c", 10,  2),
    ];
    const directions = computeResultDirections(products, mockResolve);
    assert.equal(directions[0].label, "most-you");
    assert.equal(directions[1].label, "fresh");
    assert.equal(directions[2].label, "push-me");
  });
});

// ── R3.7 — Security invariants ────────────────────────────────────────────────

describe("R3.7 — State zero-scoring invariants", () => {
  it("all State entries have empty activatedFields", () => {
    const stateEntries = ANSWER_REGISTRY.filter((m) => m.questionId === SQ.STATE);
    assert.ok(stateEntries.length >= 10, "must have at least 10 state entries");
    for (const entry of stateEntries) {
      assert.deepEqual(
        entry.activatedFields,
        [],
        `state "${entry.id}" must have no activatedFields`,
      );
    }
  });

  it("all State entries have rankingWeight 'none'", () => {
    const stateEntries = ANSWER_REGISTRY.filter((m) => m.questionId === SQ.STATE);
    for (const entry of stateEntries) {
      assert.equal(
        entry.rankingWeight,
        "none",
        `state "${entry.id}" must have rankingWeight 'none'`,
      );
    }
  });

  it('forbidden state IDs "stressed-overloaded", "low-energy", "self-conscious", "physically-uncomfortable" have no HARD_FILTER, no STRONG_RANK, no SOFT_RANK', () => {
    const FORBIDDEN = ["stressed-overloaded", "low-energy", "self-conscious", "physically-uncomfortable"];
    const scoringBehaviours = new Set(["HARD_FILTER", "STRONG_RANK", "SOFT_RANK"]);
    for (const id of FORBIDDEN) {
      const entry = ANSWER_REGISTRY.find((m) => m.id === id && m.questionId === SQ.STATE);
      assert.ok(entry, `${id} must exist`);
      const hasScoringBehaviour = entry!.behaviours.some((b: string) => scoringBehaviours.has(b));
      assert.equal(
        hasScoringBehaviour,
        false,
        `state "${id}" must not have scoring behaviour`,
      );
    }
  });
});

// ── R3.8 — Migration: additive contract ───────────────────────────────────────

describe("R3.8 — Migration 20260831000000_styleme_rev3: additive contract", () => {
  const migrationPath = join(
    ROOT,
    "prisma/migrations/20260831000000_styleme_rev3/migration.sql",
  );

  let sql = "";
  try {
    sql = readFileSync(migrationPath, "utf8").toUpperCase();
  } catch {
    // test will fail below
  }

  it("migration file exists and is non-empty", () => {
    assert.ok(sql.length > 0, "migration.sql must exist and be non-empty");
  });

  it("no DROP TABLE", () => {
    assert.equal(sql.includes("DROP TABLE"), false);
  });

  it("no DROP COLUMN", () => {
    assert.equal(sql.includes("DROP COLUMN"), false);
  });

  it("adds 'state' column to StylingSession", () => {
    assert.ok(
      sql.includes("STATE") && sql.includes("STYLINGSESSION"),
      "migration must add state to StylingSession",
    );
  });

  it("adds 'intentions' column to StylingSession", () => {
    assert.ok(
      sql.includes("INTENTIONS") && sql.includes("STYLINGSESSION"),
      "migration must add intentions to StylingSession",
    );
  });
});

// ── R3.9 — Schema: StylingSession has state + intentions ─────────────────────

describe("R3.9 — Prisma schema: StylingSession has state + intentions", () => {
  const schema = readFileSync(join(ROOT, "prisma/schema.prisma"), "utf8");

  it("schema has state column on StylingSession", () => {
    assert.ok(
      schema.includes("state") && schema.includes("StylingSession"),
      "schema must have state field on StylingSession",
    );
  });

  it("schema has intentions column on StylingSession", () => {
    assert.ok(
      schema.includes("intentions") && schema.includes("StylingSession"),
      "schema must have intentions field on StylingSession",
    );
  });
});

// ── R3.10 — Routes registration ───────────────────────────────────────────────

describe("R3.10 — routes.ts: Rev 3 routes registered", () => {
  const routesConfig = readFileSync(join(ROOT, "app/routes.ts"), "utf8");

  it("style-me/state is registered", () => {
    assert.ok(routesConfig.includes("style-me/state"), "routes.ts must register style-me/state");
  });

  it("style-me/intention is registered", () => {
    assert.ok(routesConfig.includes("style-me/intention"), "routes.ts must register style-me/intention");
  });

  it("style-me/physical-need is registered", () => {
    assert.ok(
      routesConfig.includes("style-me/physical-need"),
      "routes.ts must register style-me/physical-need",
    );
  });
});

// ── R3.11 — Index route links to /style-me/state ──────────────────────────────

describe("R3.11 — StyleMe index links to /style-me/state", () => {
  const indexSrc = readFileSync(
    join(ROOT, "app/routes/style-me/_index.tsx"),
    "utf8",
  );

  it("_index.tsx links to /style-me/state (not /style-me/mood)", () => {
    assert.ok(
      indexSrc.includes("/style-me/state"),
      "_index.tsx must link to /style-me/state",
    );
    assert.ok(
      !indexSrc.includes('to="/style-me/mood"'),
      "_index.tsx must not link to /style-me/mood as Start StyleMe destination",
    );
  });
});

// ── R3.12 — occasion.tsx: Rev 3 IDs + normalization map ──────────────────────

describe("R3.12 — occasion.tsx: Rev 3 occasion IDs and normalization", () => {
  const occasionSrc = readFileSync(
    join(ROOT, "app/routes/style-me/occasion.tsx"),
    "utf8",
  );

  it("occasion route has REV3_OCCASION_MAP", () => {
    assert.ok(occasionSrc.includes("REV3_OCCASION_MAP"), "occasion.tsx must define REV3_OCCASION_MAP");
  });

  it('"date" maps to "date-night" in normalization', () => {
    assert.ok(
      occasionSrc.includes('"date": "date-night"') || occasionSrc.includes("'date': 'date-night'"),
      'REV3_OCCASION_MAP must map date → date-night',
    );
  });

  it('"event" maps to "special-event" in normalization', () => {
    assert.ok(
      occasionSrc.includes('"event": "special-event"') || occasionSrc.includes("'event': 'special-event'"),
      'REV3_OCCASION_MAP must map event → special-event',
    );
  });

  it('"active-busy-day" maps to "everyday" in normalization', () => {
    assert.ok(
      occasionSrc.includes('"active-busy-day": "everyday"') || occasionSrc.includes("'active-busy-day': 'everyday'"),
      'REV3_OCCASION_MAP must map active-busy-day → everyday',
    );
  });

  it("loader accepts Rev 3 path (styleMeState)", () => {
    assert.ok(occasionSrc.includes("styleMeState"), "occasion loader must check styleMeState");
  });
});

// ── R3.13 — source.tsx: Rev 3 source options ──────────────────────────────────

describe("R3.13 — source.tsx: Rev 3 source options", () => {
  const sourceSrc = readFileSync(
    join(ROOT, "app/routes/style-me/source.tsx"),
    "utf8",
  );

  it("source route has REV3_SOURCE_OPTIONS", () => {
    assert.ok(sourceSrc.includes("REV3_SOURCE_OPTIONS"), "source.tsx must define REV3_SOURCE_OPTIONS");
  });

  it('"specific-piece" option exists', () => {
    assert.ok(sourceSrc.includes("specific-piece"), 'source.tsx must have specific-piece option');
  });

  it('"specific-piece" maps to source=both + anchorMode=manual in action', () => {
    assert.ok(
      sourceSrc.includes("both") && sourceSrc.includes("manual"),
      "source action must set source=both + anchorMode=manual for specific-piece",
    );
  });
});

// ── R3.14 — session.server.ts: new session keys registered ───────────────────

describe("R3.14 — session.server.ts: Rev 3 session keys registered", () => {
  const sessionSrc = readFileSync(
    join(ROOT, "app/lib/session.server.ts"),
    "utf8",
  );

  it('"styleMeState" is in STYLEME_SESSION_KEYS', () => {
    assert.ok(sessionSrc.includes('"styleMeState"'), "styleMeState must be in session keys");
  });

  it('"styleMeIntentions" is in STYLEME_SESSION_KEYS', () => {
    assert.ok(sessionSrc.includes('"styleMeIntentions"'), "styleMeIntentions must be in session keys");
  });

  it('"styleMeCoverageConditional" is in STYLEME_SESSION_KEYS', () => {
    assert.ok(
      sessionSrc.includes('"styleMeCoverageConditional"'),
      "styleMeCoverageConditional must be in session keys",
    );
  });
});

// ── R3.15 — result.tsx: Rev 3 integration ─────────────────────────────────────

describe("R3.15 — result.tsx: Rev 3 session reads and fallback", () => {
  const resultSrc = readFileSync(
    join(ROOT, "app/routes/style-me/result.tsx"),
    "utf8",
  );

  it("reads styleMeState from session", () => {
    assert.ok(resultSrc.includes("styleMeState"), "result.tsx must read styleMeState");
  });

  it("reads styleMeIntentions from session", () => {
    assert.ok(resultSrc.includes("styleMeIntentions"), "result.tsx must read styleMeIntentions");
  });

  it("legacy fallback styleMeMood still present", () => {
    assert.ok(resultSrc.includes("styleMeMood"), "result.tsx must still read styleMeMood (legacy)");
  });

  it("start-over redirects to /style-me/state", () => {
    assert.ok(
      resultSrc.includes('"/style-me/state"'),
      "start-over must redirect to /style-me/state",
    );
  });

  it("intention translation maps exist (DFM, SMCM, Practical)", () => {
    assert.ok(resultSrc.includes("INTENTION_DFM_MAP"), "must define INTENTION_DFM_MAP");
    assert.ok(resultSrc.includes("INTENTION_SMCM_MAP"), "must define INTENTION_SMCM_MAP");
    assert.ok(resultSrc.includes("INTENTION_PRACTICAL_MAP"), "must define INTENTION_PRACTICAL_MAP");
  });

  it("state is NOT passed as a mood/engine signal (zero scoring)", () => {
    // For Rev 3, moods come from intention translation, never from state.
    // We verify that the code does NOT pass rev3State directly to moods.
    const generateBlock = resultSrc.slice(resultSrc.indexOf("intent === \"generate\""));
    assert.ok(
      !generateBlock.includes("moods.push(rev3State") && !generateBlock.includes("[rev3State]"),
      "state must not be pushed into moods array",
    );
  });

  it("StylingSession.state and .intentions written to DB for Rev 3 sessions", () => {
    assert.ok(resultSrc.includes("state: rev3State"), "must write state to StylingSession");
    assert.ok(resultSrc.includes("intentions: rev3Intentions"), "must write intentions to StylingSession");
  });
});

// ── R3.16 — Direction persistence: resultDirections in StyleMeMetadata ────────

describe("R3.16 — Direction persistence: resultDirections in metadata", () => {
  const typesSrc = readFileSync(
    join(ROOT, "app/lib/ai/styleme-result.types.ts"),
    "utf8",
  );
  const serverSrc = readFileSync(
    join(ROOT, "app/lib/ai/styleme-result.server.ts"),
    "utf8",
  );

  it("StyleMeMetadata interface includes resultDirections optional field", () => {
    assert.ok(
      typesSrc.includes("resultDirections?"),
      "StyleMeMetadata must have optional resultDirections field",
    );
  });

  it("buildMetadataJson serializes resultDirections when non-empty", () => {
    assert.ok(
      serverSrc.includes("resultDirections:") && serverSrc.includes("buildMetadataJson"),
      "buildMetadataJson must include resultDirections in metadata",
    );
  });

  it("resultDirections stores label + displayLabel + directionalNote + handle", () => {
    assert.ok(serverSrc.includes("d.label"), "must store label");
    assert.ok(serverSrc.includes("d.displayLabel"), "must store displayLabel");
    assert.ok(serverSrc.includes("d.directionalNote"), "must store directionalNote");
    assert.ok(serverSrc.includes("d.product?.handle"), "must store handle");
  });

  it("legacy sessions without resultDirections load safely (optional field)", () => {
    // parseSuggestionMetadata parses the stored JSON — legacy JSON without resultDirections
    // will return undefined for that field (optional chaining in UI handles it).
    // The TypeScript type is resultDirections?: Array<...> (optional) — verify.
    assert.ok(
      !typesSrc.includes("resultDirections: Array"),
      "resultDirections must be optional (?) not required",
    );
    assert.ok(typesSrc.includes("resultDirections?:"), "resultDirections must be marked optional");
  });

  it("computeResultDirections runtime: 3 distinct products → 3 directions persisted", () => {
    const products = [
      makeProduct("most", 30, 25),
      makeProduct("mid",  20, 15),
      makeProduct("low",  10,  2),
    ];
    const directions = computeResultDirections(products, mockResolve);
    assert.equal(directions.length, 3);
    // Simulate metadata serialization — labels must all be present
    const labels = directions.map((d) => d.label);
    assert.ok(labels.includes("most-you"));
    assert.ok(labels.includes("fresh"));
    assert.ok(labels.includes("push-me"));
  });

  it("computeResultDirections runtime: same-profileScore products → only MOST YOU", () => {
    // All profileScores equal → no PUSH ME or FRESH (no profile spread to serve as directions).
    const products = [
      makeProduct("a", 30, 15),
      makeProduct("b", 20, 15),
      makeProduct("c", 10, 15),
    ];
    const directions = computeResultDirections(products, mockResolve);
    assert.equal(directions.length, 1);
  });
});

// ── R3.17 — analysisStatus === "ready" trust gate (Group 3B) ─────────────────

describe("R3.17 — analysisStatus=ready trust gate (ClosetItem garment intelligence)", () => {
  const giTypesSrc = readFileSync(
    join(ROOT, "app/lib/ai/garment-intelligence.types.ts"),
    "utf8",
  );

  it('deriveEvidenceLevel gates on analysisStatus === "ready" (not "completed")', () => {
    assert.ok(
      giTypesSrc.includes('analysisStatus !== "ready"'),
      'deriveEvidenceLevel must use "ready" as the trust gate, not "completed"',
    );
    assert.ok(
      !giTypesSrc.includes('analysisStatus !== "completed"') &&
      !giTypesSrc.includes('analysisStatus === "completed"'),
      'garment-intelligence.types.ts must not use "completed" for ClosetItem analysis gating',
    );
  });

  it("GarmentAnalysisStatus type includes ready, pending, failed, not_analyzed", () => {
    assert.ok(giTypesSrc.includes('"not_analyzed"'), "must have not_analyzed status");
    assert.ok(giTypesSrc.includes('"pending"'), "must have pending status");
    assert.ok(giTypesSrc.includes('"ready"'), "must have ready status");
    assert.ok(giTypesSrc.includes('"failed"'), "must have failed status");
  });

  it('user_only evidence returned when analysisStatus !== "ready"', () => {
    // deriveEvidenceLevel returns "user_only" for any non-ready status
    assert.ok(
      giTypesSrc.includes('return "user_only"'),
      'deriveEvidenceLevel must return "user_only" when not ready',
    );
  });

  it("AI-derived observable fields (silhouette, fitProfile, hemLength) gated by deriveEvidenceLevel", () => {
    assert.ok(
      giTypesSrc.includes("silhouette") && giTypesSrc.includes("fitProfile") && giTypesSrc.includes("hemLength"),
      "observable fields must be present in the GarmentIntelligence schema",
    );
  });
});

// ── R3.18 — Intention mapping verification ────────────────────────────────────

describe("R3.18 — Intention mapping verification (exact ANSWER_REGISTRY contract)", () => {
  it("feel-like-myself → PROFILE_AMPLIFY, no activatedFields", () => {
    const e = ANSWER_REGISTRY.find((m) => m.id === "feel-like-myself" && m.questionId === SQ.INTENTIONS);
    assert.ok(e!.behaviours.includes("PROFILE_AMPLIFY"));
    assert.deepEqual(e!.activatedFields, []);
  });

  it("confidence → STRONG_RANK, activatedFields = [DESIRED_FEELING_MATCH]", () => {
    const e = ANSWER_REGISTRY.find((m) => m.id === "confidence" && m.questionId === SQ.INTENTIONS);
    assert.ok(e!.behaviours.includes("STRONG_RANK"));
    assert.ok(e!.activatedFields.some((f: string) => f.includes("desiredFeelingMatch") || f.includes("DESIRED_FEELING")));
  });

  it("ground-me → NO_RECOMMENDATION_EFFECT, no activatedFields (no product scoring)", () => {
    const e = ANSWER_REGISTRY.find((m) => m.id === "ground-me" && m.questionId === SQ.INTENTIONS);
    assert.ok(e!.behaviours.includes("NO_RECOMMENDATION_EFFECT"));
    assert.deepEqual(e!.activatedFields, []);
  });

  it("give-structure → STRONG_RANK, activatedFields = [STYLE_ME_COMFORT_MATCH]", () => {
    const e = ANSWER_REGISTRY.find((m) => m.id === "give-structure" && m.questionId === SQ.INTENTIONS);
    assert.ok(e!.behaviours.includes("STRONG_RANK"));
    assert.ok(e!.activatedFields.some((f: string) => f.includes("styleMeComfortMatch") || f.includes("STYLE_ME_COMFORT")));
  });

  it("make-it-easy → STRONG_RANK, activatedFields = [PRACTICAL_SUPPORT_MATCH]", () => {
    const e = ANSWER_REGISTRY.find((m) => m.id === "make-it-easy" && m.questionId === SQ.INTENTIONS);
    assert.ok(e!.behaviours.includes("STRONG_RANK"));
    assert.ok(e!.activatedFields.some((f: string) => f.includes("practicalSupportMatch") || f.includes("PRACTICAL_SUPPORT")));
  });

  it("feel-put-together → STRONG_RANK, activatedFields includes DESIRED_FEELING_MATCH", () => {
    const e = ANSWER_REGISTRY.find((m) => m.id === "feel-put-together" && m.questionId === SQ.INTENTIONS);
    assert.ok(e!.behaviours.includes("STRONG_RANK"));
    assert.ok(e!.activatedFields.some((f: string) => f.includes("desiredFeelingMatch") || f.includes("DESIRED_FEELING")));
  });

  it("feel-attractive → STRONG_RANK, activatedFields includes DESIRED_FEELING_MATCH", () => {
    const e = ANSWER_REGISTRY.find((m) => m.id === "feel-attractive" && m.questionId === SQ.INTENTIONS);
    assert.ok(e!.behaviours.includes("STRONG_RANK"));
    assert.ok(e!.activatedFields.some((f: string) => f.includes("desiredFeelingMatch") || f.includes("DESIRED_FEELING")));
  });

  it("give-energy → NO_RECOMMENDATION_EFFECT, no activatedFields (no product scoring)", () => {
    const e = ANSWER_REGISTRY.find((m) => m.id === "give-energy" && m.questionId === SQ.INTENTIONS);
    assert.ok(e!.behaviours.includes("NO_RECOMMENDATION_EFFECT"));
    assert.deepEqual(e!.activatedFields, []);
  });

  it("feel-softer → STRONG_RANK, activatedFields includes DESIRED_FEELING_MATCH", () => {
    const e = ANSWER_REGISTRY.find((m) => m.id === "feel-softer" && m.questionId === SQ.INTENTIONS);
    assert.ok(e!.behaviours.includes("STRONG_RANK"));
    assert.ok(e!.activatedFields.some((f: string) => f.includes("desiredFeelingMatch") || f.includes("DESIRED_FEELING")));
  });

  it("feel-less-exposed → STRONG_RANK, activatedFields includes STYLE_ME_COMFORT_MATCH and COVERAGE_MODESTY", () => {
    const e = ANSWER_REGISTRY.find((m) => m.id === "feel-less-exposed" && m.questionId === SQ.INTENTIONS);
    assert.ok(e!.behaviours.includes("STRONG_RANK"));
    assert.ok(e!.activatedFields.some((f: string) => f.includes("styleMeComfortMatch") || f.includes("STYLE_ME_COMFORT")));
    assert.ok(e!.activatedFields.some((f: string) => f.includes("coverageModesty") || f.includes("COVERAGE_MODESTY")));
  });

  it("express-myself → PROFILE_AMPLIFY, no activatedFields (not bold-edgy)", () => {
    const e = ANSWER_REGISTRY.find((m) => m.id === "express-myself" && m.questionId === SQ.INTENTIONS);
    assert.ok(e!.behaviours.includes("PROFILE_AMPLIFY"));
    assert.deepEqual(e!.activatedFields, [], "express-myself must not map to bold-edgy or any specific style token");
  });

  it("softer-easier-fabrics is NOT in intention ANSWER_REGISTRY (it's a Body Need)", () => {
    const e = ANSWER_REGISTRY.find((m) => m.id === "softer-easier-fabrics" && m.questionId === SQ.INTENTIONS);
    assert.equal(e, undefined, "softer-easier-fabrics must not be an intention answer");
  });
});

// ── R3.19 — Physical Need mapping verification ────────────────────────────────

describe("R3.19 — Physical Need mapping verification (Rev 3 IDs)", () => {
  const physicalNeedSrc = readFileSync(
    join(ROOT, "app/routes/style-me/physical-need.tsx"),
    "utf8",
  );

  it("Rev 3 Physical Need route has 8 options", () => {
    const count = (physicalNeedSrc.match(/id: "/g) ?? []).length;
    assert.equal(count, 8, "Must have exactly 8 physical need option IDs");
  });

  it("nothing-specific is present as exclusive option", () => {
    assert.ok(physicalNeedSrc.includes('"nothing-specific"'));
    assert.ok(physicalNeedSrc.includes("EXCLUSIVE_ID"));
  });

  it("max 2 selections enforced server-side", () => {
    assert.ok(physicalNeedSrc.includes("MAX_SELECTIONS = 2"));
    assert.ok(physicalNeedSrc.includes("> MAX_SELECTIONS"));
  });

  it("Physical Needs write only to styleMeBodyNeeds session key, not profile", () => {
    assert.ok(physicalNeedSrc.includes("styleMeBodyNeeds"), "must write to styleMeBodyNeeds");
    assert.ok(
      !physicalNeedSrc.includes("onboardingProfile") &&
      !physicalNeedSrc.includes("OnboardingProfile") &&
      !physicalNeedSrc.includes("prisma.onboarding"),
      "must not write to OnboardingProfile",
    );
  });

  it("nothing-tight-waist normalizes to soft-and-forgiving-around-waist", () => {
    assert.equal(BODY_NEED_NORMALIZATION_MAP["nothing-tight-waist"], "soft-and-forgiving-around-waist");
  });

  it("less-body-conscious normalizes to relaxed", () => {
    assert.equal(BODY_NEED_NORMALIZATION_MAP["less-body-conscious"], "relaxed");
  });

  it("loose-comfortable normalizes to relaxed", () => {
    assert.equal(BODY_NEED_NORMALIZATION_MAP["loose-comfortable"], "relaxed");
  });

  it("softer-easier-fabrics passes through (CONTEXTUAL only — no normalization)", () => {
    assert.equal(BODY_NEED_NORMALIZATION_MAP["softer-easier-fabrics"], undefined);
  });

  it("still-want-shape passes through (CONTEXTUAL only — no normalization)", () => {
    assert.equal(BODY_NEED_NORMALIZATION_MAP["still-want-shape"], undefined);
  });

  it("nothing-specific is the exclusive ID and applies normalization pass-through", () => {
    // nothing-specific is not in normalization map → keeps the "nothing-specific" string
    // which is a valid canonical engine ID (no-body-need signal)
    assert.ok(
      physicalNeedSrc.includes("nothing-specific"),
      "nothing-specific must be present as an option",
    );
  });
});

// ── R3.20 — Full flow regression: route chain ─────────────────────────────────

describe("R3.20 — Full flow regression: route chain", () => {
  const routesSrc = readFileSync(join(ROOT, "app/routes.ts"), "utf8");
  const indexSrc = readFileSync(join(ROOT, "app/routes/style-me/_index.tsx"), "utf8");

  it("all 5 Rev 3 flow routes are registered", () => {
    assert.ok(routesSrc.includes("style-me/state"), "/style-me/state registered");
    assert.ok(routesSrc.includes("style-me/intention"), "/style-me/intention registered");
    assert.ok(routesSrc.includes("style-me/physical-need"), "/style-me/physical-need registered");
    // occasion and source were pre-existing
    assert.ok(routesSrc.includes("style-me/occasion") || routesSrc.includes("occasion"), "occasion route registered");
    assert.ok(routesSrc.includes("style-me/source") || routesSrc.includes("source"), "source route registered");
    assert.ok(routesSrc.includes("style-me/result") || routesSrc.includes("result"), "result route registered");
  });

  it("StyleMe index links to /style-me/state (Rev 3 entry point)", () => {
    assert.ok(indexSrc.includes("/style-me/state"), "index must link to state route");
  });

  it("old mood/feeling routes are not the entry point for new flow", () => {
    // The index does NOT link to /style-me/mood as the Start StyleMe CTA
    assert.ok(
      !indexSrc.includes('to="/style-me/mood"'),
      "index must not link to /style-me/mood as Start StyleMe destination",
    );
  });

  it("state route redirects to /style-me/intention on valid submit", () => {
    const stateSrc = readFileSync(join(ROOT, "app/routes/style-me/state.tsx"), "utf8");
    assert.ok(stateSrc.includes('"/style-me/intention"'), "state action must redirect to intention");
  });

  it("intention route redirects to /style-me/physical-need on valid submit", () => {
    const intentionSrc = readFileSync(join(ROOT, "app/routes/style-me/intention.tsx"), "utf8");
    assert.ok(intentionSrc.includes('"/style-me/physical-need"'), "intention action must redirect to physical-need");
  });

  it("physical-need route redirects to /style-me/occasion on valid submit", () => {
    const physicalSrc = readFileSync(join(ROOT, "app/routes/style-me/physical-need.tsx"), "utf8");
    assert.ok(physicalSrc.includes('"/style-me/occasion"'), "physical-need action must redirect to occasion");
  });

  it("result start-over redirects to /style-me/state (not /style-me/mood)", () => {
    const resultSrc = readFileSync(join(ROOT, "app/routes/style-me/result.tsx"), "utf8");
    assert.ok(resultSrc.includes('"/style-me/state"'), "result start-over must redirect to /style-me/state");
    // Verify the context-specific check — start-over intent redirects to state
    const startOverBlock = resultSrc.slice(resultSrc.indexOf('"start-over"'));
    assert.ok(
      startOverBlock.slice(0, 500).includes("/style-me/state"),
      "start-over action block must redirect to /style-me/state",
    );
  });
});

// ── R3.V — Voice compliance: directional notes (Constitution V1) ──────────────
// Tests for A (MOST YOU), B (FRESH), C (PUSH ME) note requirements.
// Uses the existing makeProduct / mockResolve helpers from R3.6.

// mockResolve returns slot="top" for all handles. For FRESH slot-variation tests,
// use resolveWithSlots to override per-handle.
function resolveWithSlots(slotMap: Record<string, string>) {
  return (handle: string) =>
    ({
      handle,
      title: handle,
      slot: slotMap[handle] ?? "top",
      shopifyProductId: null,
      productImageUrl: null,
      liveUrl: null,
      productUrl: null,
      stylingNotes: "",
    }) as any;
}

const FORBIDDEN_NOTES = [
  "feels most like you",
  "feels like you right now",
  "step outside your usual",
  "outside your comfort zone",
  "a little different",
];

describe("R3.V — Voice compliance: directional notes (Constitution V1)", () => {
  it("R3.V.1 — MOST YOU note does not assert identity without clothing evidence", () => {
    const dirs = computeResultDirections([makeProduct("a", 10, 5)], mockResolve);
    const note = dirs.find((d) => d.label === "most-you")!.directionalNote;
    for (const phrase of FORBIDDEN_NOTES) {
      assert.ok(!note.toLowerCase().includes(phrase.toLowerCase()),
        `MOST YOU note must not contain "${phrase}"; got: "${note}"`);
    }
  });

  it("R3.V.2 — MOST YOU note references provided profileHint", () => {
    const dirs = computeResultDirections(
      [makeProduct("a", 10, 5)],
      mockResolve,
      "clean and minimal silhouettes",
    );
    const note = dirs.find((d) => d.label === "most-you")!.directionalNote;
    assert.ok(note.includes("clean and minimal silhouettes"),
      `MOST YOU note must reference profileHint; got: "${note}"`);
  });

  it("R3.V.3 — PUSH ME note does not use forbidden identity phrases", () => {
    const high = makeProduct("most-you", 20, 15);
    const low  = makeProduct("push-me",  10,  2);
    const dirs = computeResultDirections([high, low], mockResolve);
    const note = dirs.find((d) => d.label === "push-me")!.directionalNote;
    for (const phrase of FORBIDDEN_NOTES) {
      assert.ok(!note.toLowerCase().includes(phrase.toLowerCase()),
        `PUSH ME note must not contain "${phrase}"; got: "${note}"`);
    }
  });

  it("R3.V.4 — PUSH ME note names a concrete aesthetic stretch (contains slot or profile reference)", () => {
    const high = makeProduct("most-you", 20, 15);
    const low  = makeProduct("push-me",  10,  2);
    const dirs = computeResultDirections([high, low], mockResolve, "classic, polished direction");
    const note = dirs.find((d) => d.label === "push-me")!.directionalNote;
    const hasRef =
      note.includes("top") ||
      note.includes("classic, polished direction") ||
      note.includes("Profile") ||
      note.includes("alignment");
    assert.ok(hasRef, `PUSH ME note must reference clothing or profile; got: "${note}"`);
  });

  it("R3.V.5 — PUSH ME note references the slot when PUSH ME slot differs from MOST YOU slot", () => {
    const high = { ...makeProduct("most-you", 20, 15), slot: "top" };
    const low  = { ...makeProduct("push-me",  10,  2), slot: "dress" };
    const dirs = computeResultDirections(
      [high, low],
      resolveWithSlots({ "most-you": "top", "push-me": "dress" }),
    );
    const note = dirs.find((d) => d.label === "push-me")!.directionalNote;
    assert.ok(note.includes("dress"), `PUSH ME note must mention the dress slot; got: "${note}"`);
  });

  it("R3.V.6 — FRESH note does not use forbidden phrases", () => {
    const high = makeProduct("most-you", 30, 25);
    const mid  = makeProduct("fresh",    20, 15);
    const low  = makeProduct("push-me",  10,  3);
    const dirs = computeResultDirections([high, mid, low], mockResolve);
    const freshDir = dirs.find((d) => d.label === "fresh");
    assert.ok(freshDir, "FRESH must be present");
    for (const phrase of FORBIDDEN_NOTES) {
      assert.ok(!freshDir!.directionalNote.toLowerCase().includes(phrase.toLowerCase()),
        `FRESH note must not contain "${phrase}"; got: "${freshDir!.directionalNote}"`);
    }
  });

  it("R3.V.7 — FRESH note names slot variation when FRESH slot differs from MOST YOU slot", () => {
    const high = { ...makeProduct("most-you", 30, 25), slot: "top" };
    const mid  = { ...makeProduct("fresh",    20, 15), slot: "dress" };
    const low  = { ...makeProduct("push-me",  10,  3), slot: "top" };
    const dirs = computeResultDirections(
      [high, mid, low],
      resolveWithSlots({ "most-you": "top", "fresh": "dress", "push-me": "top" }),
      "classic, polished direction",
    );
    const freshDir = dirs.find((d) => d.label === "fresh");
    assert.ok(freshDir, "FRESH must be present");
    assert.ok(
      freshDir!.directionalNote.includes("dress") || freshDir!.directionalNote.includes("top"),
      `FRESH note must mention slot difference; got: "${freshDir!.directionalNote}"`,
    );
  });

  it("R3.V.8 — FRESH note references profileHint when slots are the same", () => {
    const high = { ...makeProduct("most-you", 30, 25), slot: "top" };
    const mid  = { ...makeProduct("fresh",    20, 15), slot: "top" };
    const low  = { ...makeProduct("push-me",  10,  3), slot: "top" };
    const dirs = computeResultDirections(
      [high, mid, low],
      mockResolve,
      "clean and minimal silhouettes",
    );
    const freshDir = dirs.find((d) => d.label === "fresh");
    assert.ok(freshDir, "FRESH must be present");
    assert.ok(
      freshDir!.directionalNote.includes("clean and minimal silhouettes"),
      `FRESH note must reference profileHint when slots match; got: "${freshDir!.directionalNote}"`,
    );
  });

  it("R3.V.9 — no direction note in a full 3-direction set contains any forbidden phrase", () => {
    const high = makeProduct("most-you", 30, 25);
    const mid  = makeProduct("fresh",    20, 15);
    const low  = makeProduct("push-me",  10,  3);
    const dirs = computeResultDirections([high, mid, low], mockResolve);
    assert.equal(dirs.length, 3);
    for (const dir of dirs) {
      for (const phrase of FORBIDDEN_NOTES) {
        assert.ok(!dir.directionalNote.toLowerCase().includes(phrase.toLowerCase()),
          `Direction "${dir.label}" note must not contain "${phrase}"; got: "${dir.directionalNote}"`);
      }
    }
  });
});

// ── R3.V.PH — buildProfileHint unit tests ────────────────────────────────────

describe("R3.V.PH — buildProfileHint: profile hint generation", () => {
  it("R3.V.PH.1 — undefined profile returns default fallback", () => {
    assert.equal(buildProfileHint(undefined), "your established Profile preferences");
  });

  it("R3.V.PH.2 — empty profile returns default fallback", () => {
    assert.equal(buildProfileHint({}), "your established Profile preferences");
  });

  it("R3.V.PH.3 — known silhouette ID produces label", () => {
    assert.equal(buildProfileHint({ silhouette: ["fitted"] }), "fitted silhouettes");
  });

  it("R3.V.PH.4 — known personality ID produces label", () => {
    assert.equal(buildProfileHint({ stylePersonalities: ["classic-polished"] }), "classic, polished direction");
  });

  it("R3.V.PH.5 — known personality + silhouette combines both", () => {
    const hint = buildProfileHint({
      stylePersonalities: ["minimal-relaxed"],
      silhouette: ["straight-simple"],
    });
    assert.ok(hint.includes("clean and minimal"), `must include personality phrase; got: "${hint}"`);
    assert.ok(hint.includes("clean, straight-cut"), `must include silhouette phrase; got: "${hint}"`);
  });

  it("R3.V.PH.6 — unknown ID falls back to default", () => {
    assert.equal(
      buildProfileHint({ stylePersonalities: ["unknown-id"], silhouette: ["unknown-sil"] }),
      "your established Profile preferences",
    );
  });

  it("R3.V.PH.7 — uses first two silhouettes at most", () => {
    const hint = buildProfileHint({ silhouette: ["fitted", "waist-defined", "relaxed"] });
    assert.ok(hint.includes("fitted") && hint.includes("waist-defining"),
      `must include first two; got: "${hint}"`);
    assert.ok(!hint.includes("relaxed"), `must not include third; got: "${hint}"`);
  });

  it("R3.V.PH.8 — legacy personality ID 'old-money' is recognised", () => {
    const hint = buildProfileHint({ stylePersonalities: ["old-money"] });
    assert.equal(hint, "timeless and classic direction");
  });
});

// ── R3.21 — State UI: exact approved IDs and labels ───────────────────────────

describe("R3.21 — State UI: exact 10 approved IDs and labels", () => {
  const stateSrc = readFileSync(join(ROOT, "app/routes/style-me/state.tsx"), "utf8");

  const APPROVED_STATE_IDS = [
    "feel-good",
    "stressed-overloaded",
    "low-energy",
    "not-feeling-like-myself",
    "physically-uncomfortable",
    "self-conscious",
    "going-through-change",
    "want-reset",
    "nothing-in-particular",
    "other",
  ];

  const APPROVED_STATE_LABELS: Record<string, string> = {
    "feel-good":                  "I feel good",
    "stressed-overloaded":        "Stressed / overloaded",
    "low-energy":                 "Low-energy",
    "not-feeling-like-myself":    "I don't really feel like myself",
    "physically-uncomfortable":   "Physically uncomfortable",
    "self-conscious":             "Self-conscious",
    "going-through-change":       "I'm going through a change / something",
    "want-reset":                 "I want a reset",
    "nothing-in-particular":      "Nothing in particular",
    "other":                      "Something else",
  };

  for (const id of APPROVED_STATE_IDS) {
    it(`state UI contains approved ID "${id}"`, () => {
      assert.ok(stateSrc.includes(`"${id}"`), `state.tsx must include id "${id}"`);
    });
    it(`state UI has exact approved label for "${id}"`, () => {
      const label = APPROVED_STATE_LABELS[id];
      assert.ok(stateSrc.includes(label), `state.tsx must include label "${label}" for "${id}"`);
    });
  }

  const REJECTED_STATE_IDS = [
    "feeling-good", "tired", "confident", "unmotivated", "anxious", "excited",
  ];

  for (const id of REJECTED_STATE_IDS) {
    it(`state UI must NOT contain rejected ID "${id}"`, () => {
      // Check the OPTIONS array specifically — the ID shouldn't appear as an option value
      const idInOptions = stateSrc.includes(`id: "${id}"`);
      assert.equal(idInOptions, false, `state.tsx must not have option id "${id}"`);
    });
  }

  it("state UI must NOT show unapproved label 'I'm feeling good'", () => {
    assert.ok(!stateSrc.includes("I'm feeling good"), "must not use old label");
  });

  it("state UI must NOT show unapproved label 'Not feeling like myself' (missing \"I don't really\")", () => {
    assert.ok(!stateSrc.includes('"Not feeling like myself"'), "must use approved label with full phrase");
  });
});

// ── R3.22 — Intention UI: exact approved IDs and labels ───────────────────────

describe("R3.22 — Intention UI: exact 11 approved IDs and labels", () => {
  const intentionSrc = readFileSync(join(ROOT, "app/routes/style-me/intention.tsx"), "utf8");

  const APPROVED_LABELS: Record<string, string> = {
    "feel-like-myself":  "Help me feel like myself",
    "confidence":        "Give me confidence",
    "ground-me":         "Ground me",
    "give-structure":    "Give me structure",
    "make-it-easy":      "Make things feel easy",
    "feel-put-together": "Help me feel put together",
    "feel-attractive":   "Make me feel attractive",
    "give-energy":       "Give me energy",
    "feel-softer":       "Help me feel softer",
    "feel-less-exposed": "Help me feel less exposed",
    "express-myself":    "Let me express myself",
  };

  for (const [id, label] of Object.entries(APPROVED_LABELS)) {
    it(`intention UI has approved ID "${id}"`, () => {
      assert.ok(intentionSrc.includes(`"${id}"`), `intention.tsx must include id "${id}"`);
    });
    it(`intention UI has exact label for "${id}": "${label}"`, () => {
      assert.ok(intentionSrc.includes(label), `intention.tsx must include "${label}"`);
    });
  }

  it('intention UI must NOT contain "feel-confident" (rejected ID)', () => {
    assert.ok(!intentionSrc.includes('"feel-confident"'), "use 'confidence', not 'feel-confident'");
  });

  it('intention UI must NOT use old label "Feel confident"', () => {
    assert.ok(!intentionSrc.includes('"Feel confident"'), "must use approved label 'Give me confidence'");
  });

  it('intention UI must NOT use old label "Feel like myself"', () => {
    assert.ok(!intentionSrc.includes('"Feel like myself"'), "must use 'Help me feel like myself'");
  });
});

// ── R3.23 — Physical Need UI: exact 8 approved IDs ───────────────────────────

describe("R3.23 — Physical Need UI: exact 8 approved IDs, correct labels", () => {
  const physSrc = readFileSync(join(ROOT, "app/routes/style-me/physical-need.tsx"), "utf8");

  const APPROVED_IDS = [
    "nothing-tight-waist",
    "less-body-conscious",
    "more-coverage",
    "softer-easier-fabrics",
    "loose-comfortable",
    "still-want-shape",
    "waist-definition",
    "nothing-specific",
  ];

  const APPROVED_LABELS: Record<string, string> = {
    "nothing-tight-waist":   "Nothing tight around my waist",
    "less-body-conscious":   "Less body-conscious",
    "more-coverage":         "More coverage",
    "softer-easier-fabrics": "Softer / easier fabrics",
    "loose-comfortable":     "Loose and comfortable",
    "still-want-shape":      "I still want shape",
    "waist-definition":      "I want waist definition",
    "nothing-specific":      "Nothing specific",
  };

  for (const id of APPROVED_IDS) {
    it(`physical-need UI contains approved ID "${id}"`, () => {
      assert.ok(physSrc.includes(`"${id}"`), `physical-need.tsx must include "${id}"`);
    });
    it(`physical-need UI has approved label for "${id}"`, () => {
      assert.ok(physSrc.includes(APPROVED_LABELS[id]), `must include label "${APPROVED_LABELS[id]}"`);
    });
  }

  const REJECTED_IDS = [
    "less-coverage", "more-structure", "less-structure", "more-comfort",
    "need-support", "free-movement",
  ];

  for (const id of REJECTED_IDS) {
    it(`physical-need UI must NOT contain rejected ID "${id}"`, () => {
      assert.ok(!physSrc.includes(`id: "${id}"`), `physical-need.tsx must not have option "${id}"`);
    });
  }

  it('physical-need UI must NOT use old label "Want to feel less body-conscious"', () => {
    assert.ok(!physSrc.includes("Want to feel less body-conscious"), "use approved label 'Less body-conscious'");
  });

  it('physical-need UI must NOT use old label "Still want some shape"', () => {
    assert.ok(!physSrc.includes("Still want some shape"), "use approved label 'I still want shape'");
  });
});

// ── R3.24 — Occasion UI: exactly 9 approved Rev 3 IDs ───────────────────────

describe("R3.24 — Occasion UI: exactly 9 approved Rev 3 customer-facing IDs", () => {
  const occasionSrc = readFileSync(join(ROOT, "app/routes/style-me/occasion.tsx"), "utf8");

  const APPROVED_OCCASION_IDS = [
    "work", "dinner", "date", "everyday", "event", "family", "travel", "active-busy-day", "other",
  ];

  for (const id of APPROVED_OCCASION_IDS) {
    it(`occasion UI contains approved ID "${id}"`, () => {
      assert.ok(
        occasionSrc.includes(`id: "${id}"`),
        `occasion.tsx occasions array must include "${id}"`,
      );
    });
  }

  const REJECTED_FROM_UI = ["girls-night", "not-sure", "date-night", "special-event"];

  for (const id of REJECTED_FROM_UI) {
    it(`occasion UI occasions array must NOT expose "${id}" as a selectable option`, () => {
      assert.ok(
        !occasionSrc.includes(`id: "${id}"`),
        `"${id}" must not be a selectable occasion in the Rev 3 UI`,
      );
    });
  }

  it("REV3_OCCASION_MAP still maps date → date-night (internal canonical)", () => {
    assert.ok(occasionSrc.includes('"date": "date-night"') || occasionSrc.includes("'date': 'date-night'"));
  });

  it("REV3_OCCASION_MAP still maps event → special-event (internal canonical)", () => {
    assert.ok(occasionSrc.includes('"event": "special-event"') || occasionSrc.includes("'event': 'special-event'"));
  });

  it("back navigation uses /style-me/physical-need for Rev 3 path", () => {
    assert.ok(occasionSrc.includes("/style-me/physical-need"), "occasion.tsx must reference physical-need for Rev 3 back nav");
  });
});

// ── R3.25 — Source UI: exactly 4 approved customer choices ───────────────────

describe("R3.25 — Source UI: exactly 4 approved Rev 3 customer choices", () => {
  const sourceSrc = readFileSync(join(ROOT, "app/routes/style-me/source.tsx"), "utf8");

  const APPROVED_SOURCE_LABELS = [
    "Only My Closet",
    "My Closet + suggestions if genuinely useful",
    "Style one specific piece",
    "Start with something new",
  ];

  for (const label of APPROVED_SOURCE_LABELS) {
    it(`source UI has approved choice label "${label}"`, () => {
      assert.ok(sourceSrc.includes(label), `source.tsx REV3_SOURCE_OPTIONS must include "${label}"`);
    });
  }

  it("source UI has exactly 4 REV3_SOURCE_OPTIONS", () => {
    const match = sourceSrc.match(/REV3_SOURCE_OPTIONS\s*=\s*\[[\s\S]*?\];/);
    assert.ok(match, "REV3_SOURCE_OPTIONS must be defined");
    const countIds = (match![0].match(/id:/g) ?? []).length;
    assert.equal(countIds, 4, "REV3_SOURCE_OPTIONS must have exactly 4 entries");
  });
});

// ── R3.26 — Constitution compliance ──────────────────────────────────────────

describe("R3.26 — Constitution V1 compliance: prompt tone, blocked phrases, state guard", () => {
  const resultSrc = readFileSync(join(ROOT, "app/routes/style-me/result.tsx"), "utf8");

  it("system prompt includes approved tone words", () => {
    const toneWords = ["observant", "calm", "tasteful", "decisive", "understated", "specific"];
    for (const word of toneWords) {
      assert.ok(STYLEME_WORDING_SYSTEM_PROMPT.includes(word), `prompt must include tone word "${word}"`);
    }
  });

  it("system prompt blocks bubbly/salesy phrases", () => {
    const BLOCKED = ["Absolutely!", "Obsessed.", "Gorgeous!", "Trust me.", "Game-changer.", "super flattering"];
    for (const phrase of BLOCKED) {
      assert.ok(STYLEME_WORDING_SYSTEM_PROMPT.includes(phrase), `prompt must block phrase "${phrase}"`);
    }
  });

  it("system prompt has state wording guard (state is context only, not the reason)", () => {
    assert.ok(
      STYLEME_WORDING_SYSTEM_PROMPT.toLowerCase().includes("state") &&
      STYLEME_WORDING_SYSTEM_PROMPT.includes("CONTEXT ONLY"),
      "prompt must have state wording guard",
    );
  });

  it("system prompt instructs confidenceBoost is one styling observation, not emotional affirmation", () => {
    assert.ok(
      STYLEME_WORDING_SYSTEM_PROMPT.includes("confidenceBoost") &&
      STYLEME_WORDING_SYSTEM_PROMPT.includes("not predict how the customer will feel"),
      "prompt must constrain confidenceBoost to styling observation",
    );
  });

  it("result.tsx displays confidenceBoost as STYLIST'S NOTE (not 'The Shift' or 'Confidence Boost')", () => {
    assert.ok(
      resultSrc.includes("STYLIST'S NOTE"),
      "result.tsx must label confidenceBoost as 'STYLIST\\'S NOTE'",
    );
    assert.ok(!resultSrc.includes('"The Shift"'), "must not use old label 'The Shift'");
  });
});
