// app/lib/styleme/register-range-canonical-keys.test.ts
//
// OCCASION_REGISTER_RANGE is looked up with the CANONICAL session occasion, but three of
// its keys were spelled in the StyleMe UI vocabulary:
//
//   map held "date"      · gate looked up "date-night"
//   map held "event"     · gate looked up "special-event"
//   map held "night-out" · gate looked up "girls-night"
//
// WHY THE EARLY RETURN IS THE WHOLE BUG. passesProfileRegisterGate reads:
//
//   const range = OCCASION_REGISTER_RANGE[sessionOccasion];
//   if (!range) return true;              <-- reached for those three occasions
//   ... occasionFit Strong/Acceptable -> true
//   ... athletic && occasion !== "active" -> false
//   ... evening && [active|everyday|family|travel] -> false
//   return itemRank >= range.min - 2 && itemRank <= range.max + 2;
//
// The miss returned true BEFORE the athletic block, so activewear was admitted to a Date
// night, a Special event and a Girls night with no approval behind it. The general range
// check is not what these occasions lost: their ranges widen to 0-6, 1-8 and 0-8 once the
// +/-2 tolerance is applied, which blocks nothing a human would notice. The athletic block
// is the gate that was being skipped, so that is what these tests pin.
//
// Verified rank scale (DRESS_REGISTER_RANK, not inferred):
//   athletic 0 · casual 1 · elevated-casual 2 · smart-casual 3 · polished 4 · dressy 5 · evening 6
//
// The escape hatch is asserted too. Correcting the keys alone would have been unsafe before
// the C1 bridge, because occasionFit is keyed on the admin spelling and an approved "Strong"
// could not be read for these three occasions — the gate would have begun blocking garments
// a reviewer had explicitly approved, silently. C1 routed every occasionFit read through
// profileOccasionRating, and RRC-C is the proof that the approval can still speak.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  OCCASION_REGISTER_RANGE,
  passesProfileRegisterGate,
  profileOccasionRating,
} from "../ai/styleme-profile-gate.js";
import type { ClosetAnchorInput } from "../ai/styleme-recommendation.types.js";

/** A garment carrying one approved dressRegister and occasionFit map. */
function item(
  dressRegister: string,
  occasionFit: Record<string, string> | null = null,
): ClosetAnchorInput {
  return {
    type: "closet", id: "g", name: "g", category: "TOPS", subcategory: null,
    colors: [], primaryColor: null, pattern: null, material: null, styleTags: [],
    occasions: [], imageUrl: null, garmentRelationships: [], formality: "casual",
    fitProfile: null, waistShape: null, sleeveLength: null, necklineCoverage: null,
    hemLength: null, topLength: null, shoulderCoverage: null, midriffExposed: null,
    silhouette: null, stylePersonality: null,
    approvedProfile: { dressRegister, occasionFit } as never,
  } as unknown as ClosetAnchorInput;
}

// The three canonical spellings the session actually stores, with the admin spelling each
// one's occasionFit is keyed on.
const MISKEYED = [
  { session: "date-night",    adminKey: "date",      range: { min: 2, max: 4 } },
  { session: "special-event", adminKey: "event",     range: { min: 3, max: 6 } },
  { session: "girls-night",   adminKey: "night-out", range: { min: 2, max: 6 } },
] as const;

// ── RRC-A: the canonical session keys reach their ranges ────────────────────

describe("RRC-A — OCCASION_REGISTER_RANGE is keyed on the canonical session occasion", () => {
  for (const { session, range } of MISKEYED) {
    test(`RRC-A.1 ${session} resolves to ${range.min}-${range.max}`, () => {
      assert.deepEqual(
        OCCASION_REGISTER_RANGE[session], range,
        `${session} must be a key — it is the value the session stores`,
      );
    });
  }

  test("RRC-A.2 the UI spellings are gone — a stale key would mask a regression", () => {
    for (const ui of ["date", "event", "night-out"]) {
      assert.equal(
        OCCASION_REGISTER_RANGE[ui], undefined,
        `${ui} must not remain: nothing looks the map up with the UI spelling, so a ` +
        `surviving key is dead weight that makes the next miss harder to see`,
      );
    }
  });

  test("RRC-A.3 the six already-canonical occasions are untouched", () => {
    assert.deepEqual(OCCASION_REGISTER_RANGE["active"],   { min: 0, max: 1 });
    assert.deepEqual(OCCASION_REGISTER_RANGE["everyday"], { min: 1, max: 3 });
    assert.deepEqual(OCCASION_REGISTER_RANGE["family"],   { min: 1, max: 3 });
    assert.deepEqual(OCCASION_REGISTER_RANGE["travel"],   { min: 1, max: 3 });
    assert.deepEqual(OCCASION_REGISTER_RANGE["work"],     { min: 2, max: 4 });
    assert.deepEqual(OCCASION_REGISTER_RANGE["dinner"],   { min: 2, max: 5 });
  });

  test("RRC-A.4 every canonical occasion the session can store has a range", () => {
    // not-sure is deliberately excluded: it carries no register expectation, and the
    // gate's fail-open path is the intended behaviour for it.
    for (const o of ["everyday", "work", "dinner", "date-night", "special-event",
                     "girls-night", "family", "travel", "active"]) {
      assert.ok(OCCASION_REGISTER_RANGE[o], `${o} must have a register range`);
    }
  });
});

// ── RRC-B: the gate no longer fails open ────────────────────────────────────

describe("RRC-B — the gate reaches the athletic block for the three occasions", () => {
  for (const { session } of MISKEYED) {
    test(`RRC-B.1 athletic with no approval is blocked on ${session}`, () => {
      assert.equal(
        passesProfileRegisterGate(item("athletic"), session), false,
        `activewear must not be admitted to ${session} unreviewed — the missing key ` +
        `returned true before the athletic block could run`,
      );
    });
  }

  test("RRC-B.2 athletic stays allowed on active, and blocked on the six that already worked", () => {
    assert.equal(passesProfileRegisterGate(item("athletic"), "active"), true,
      "active is where activewear belongs");
    for (const o of ["everyday", "work", "dinner", "family", "travel"]) {
      assert.equal(passesProfileRegisterGate(item("athletic"), o), false,
        `${o} already blocked athletic and must continue to`);
    }
  });

  test("RRC-B.3 non-athletic garments are NOT newly blocked — this is not a widening", () => {
    // The whole risk of correcting a key is over-blocking. Every non-athletic register
    // must still pass all three occasions, exactly as it did while the key was missing.
    for (const { session } of MISKEYED) {
      for (const reg of ["casual", "elevated-casual", "smart-casual", "polished",
                         "dressy", "evening"]) {
        assert.equal(
          passesProfileRegisterGate(item(reg), session), true,
          `${reg} must still pass ${session}: the +/-2 tolerance makes these ranges wide, ` +
          `so correcting the key must change nothing but the athletic case`,
        );
      }
    }
  });

  test("RRC-B.4 an unknown occasion still fails open", () => {
    assert.equal(passesProfileRegisterGate(item("athletic"), "not-sure"), true,
      "no range means no register expectation — fail open, as before");
  });
});

// ── RRC-C: the approved escape hatch still speaks ───────────────────────────

describe("RRC-C — approved occasionFit overrides the block via profileOccasionRating", () => {
  for (const { session, adminKey } of MISKEYED) {
    test(`RRC-C.1 Strong on occasionFit.${adminKey} re-admits athletic to ${session}`, () => {
      const g = item("athletic", { [adminKey]: "Strong" });
      assert.equal(
        profileOccasionRating({ [adminKey]: "Strong" }, session), "Strong",
        "the bridge must resolve the session spelling to the admin key",
      );
      assert.equal(
        passesProfileRegisterGate(g, session), true,
        `a reviewer's Strong must override the register block for ${session} — without ` +
        `the C1 bridge this approval could not be read and correcting the key would ` +
        `have silently blocked an approved garment`,
      );
    });

    test(`RRC-C.2 Acceptable on occasionFit.${adminKey} also re-admits it to ${session}`, () => {
      assert.equal(passesProfileRegisterGate(item("athletic", { [adminKey]: "Acceptable" }), session), true);
    });

    test(`RRC-C.3 No on occasionFit.${adminKey} falls through and stays blocked on ${session}`, () => {
      assert.equal(
        passesProfileRegisterGate(item("athletic", { [adminKey]: "No" }), session), false,
        "No is not an approval — it must fall through to the register rule, not bypass it",
      );
    });
  }

  test("RRC-C.4 a canonical-spelled approval is not consulted — the admin cannot store one", () => {
    // Guards against a future 'fix' that makes the bridge fall back to the session
    // spelling, which would re-admit the broken lookup from the other direction.
    assert.equal(
      passesProfileRegisterGate(item("athletic", { "date-night": "Strong" }), "date-night"),
      false,
      "occasionFit is keyed on the admin vocabulary; a canonical key is not a real rating",
    );
  });
});
