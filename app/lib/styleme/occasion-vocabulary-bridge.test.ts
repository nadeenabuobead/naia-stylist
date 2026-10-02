// app/lib/styleme/occasion-vocabulary-bridge.test.ts
//
// C1 — the canonical session occasion → approvedProfile.occasionFit vocabulary bridge.
//
// StyleMe sessions carry canonical occasion IDs; GarmentStyleMeProfile.occasionFit is stored
// under the admin's OCCASION_IDS vocabulary. Six of the nine spellings coincide; three do
// not, and every read indexed occasionFit by the session value directly:
//
//   date-night      -> date
//   special-event   -> event
//   girls-night     -> night-out
//
// For those three the key missed and every approved occasion rating was silently discarded —
// a reviewer's "No" for a night out carried exactly as much weight as no rating at all. The
// QA traces showed the consequence: ST15, ST16 and O4 all fell through to the legacy
// occasions[] array for tiering, and O4's uniform occasionTier 0 came from that fallback
// rather than from anything a reviewer had said.
//
// These tests assert only that the right key is consulted. They deliberately do NOT assert
// an outfit: existing ranking rules stay authoritative, and what a reviewer actually said
// about this closet is data, not something a test should pin.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  profileOccasionRating,
  CANONICAL_OCCASION_TO_PROFILE_KEY,
  getProfileOccasionTier,
  passesProfileOccasionGate,
} from "../ai/styleme-profile-gate.js";
import type { ClosetAnchorInput } from "../ai/styleme-recommendation.types.js";

/** A garment carrying one approved occasionFit map. */
function item(occasionFit: Record<string, string> | null): ClosetAnchorInput {
  return {
    type: "closet", id: "g", name: "g", category: "TOPS", subcategory: null,
    colors: [], primaryColor: null, pattern: null, material: null, styleTags: [],
    occasions: [], imageUrl: null, garmentRelationships: [], formality: "smart-casual",
    fitProfile: null, waistShape: null, sleeveLength: null, necklineCoverage: null,
    hemLength: null, topLength: null, shoulderCoverage: null, midriffExposed: null,
    silhouette: null, stylePersonality: null,
    approvedProfile: occasionFit ? ({ occasionFit } as never) : null,
  } as unknown as ClosetAnchorInput;
}

// ── OB-A: the three mis-keyed occasions now resolve ─────────────────────────

describe("OB-A — the three mismatched occasions read the admin key", () => {
  test("OB-A.1 date-night reads occasionFit.date", () => {
    assert.equal(profileOccasionRating({ date: "Strong" }, "date-night"), "Strong");
    assert.equal(getProfileOccasionTier(item({ date: "Strong" }), "date-night"), 2);
    assert.equal(getProfileOccasionTier(item({ date: "No" }), "date-night"), 0);
  });

  test("OB-A.2 special-event reads occasionFit.event", () => {
    assert.equal(profileOccasionRating({ event: "Acceptable" }, "special-event"), "Acceptable");
    assert.equal(getProfileOccasionTier(item({ event: "Acceptable" }), "special-event"), 1);
    assert.equal(getProfileOccasionTier(item({ event: "No" }), "special-event"), 0);
  });

  test("OB-A.3 girls-night reads occasionFit['night-out']", () => {
    assert.equal(profileOccasionRating({ "night-out": "Strong" }, "girls-night"), "Strong");
    assert.equal(getProfileOccasionTier(item({ "night-out": "Strong" }), "girls-night"), 2);
    assert.equal(getProfileOccasionTier(item({ "night-out": "No" }), "girls-night"), 0);
  });

  test("OB-A.4 a canonical-spelled key is NOT consulted — the admin cannot store one", () => {
    // Proves the bridge maps rather than falling back to the session spelling, which would
    // quietly re-admit the broken lookup.
    assert.equal(profileOccasionRating({ "date-night": "Strong" }, "date-night"), undefined);
    assert.equal(profileOccasionRating({ "special-event": "Strong" }, "special-event"), undefined);
    assert.equal(profileOccasionRating({ "girls-night": "Strong" }, "girls-night"), undefined);
  });

  test("OB-A.5 the map holds exactly the three known mismatches", () => {
    assert.deepEqual({ ...CANONICAL_OCCASION_TO_PROFILE_KEY }, {
      "date-night": "date", "special-event": "event", "girls-night": "night-out",
    });
  });
});

// ── OB-B: controls — the six matching spellings are untouched ───────────────

describe("OB-B — already-matching occasions resolve to themselves", () => {
  for (const occ of ["everyday", "work", "dinner", "family", "travel", "active"]) {
    test(`OB-B ${occ} stays ${occ}`, () => {
      assert.equal(profileOccasionRating({ [occ]: "Strong" }, occ), "Strong");
      assert.equal(getProfileOccasionTier(item({ [occ]: "Strong" }), occ), 2);
    });
  }

  test("OB-B.cross a rating for one occasion does not leak to another", () => {
    assert.equal(profileOccasionRating({ dinner: "Strong" }, "work"), undefined);
    assert.equal(profileOccasionRating({ date: "Strong" }, "dinner"), undefined);
  });
});

// ── OB-C: fail-open is preserved exactly ───────────────────────────────────

describe("OB-C — absent data behaves as before", () => {
  test("OB-C.1 no occasionFit map at all", () => {
    assert.equal(profileOccasionRating(null, "girls-night"), undefined);
    assert.equal(profileOccasionRating(undefined, "girls-night"), undefined);
    assert.equal(getProfileOccasionTier(item(null), "girls-night"), null);
  });

  test("OB-C.2 a mapped occasion with no matching key falls through to null", () => {
    // girls-night maps to night-out, which this garment has no rating for.
    assert.equal(profileOccasionRating({ dinner: "Strong" }, "girls-night"), undefined);
    assert.equal(getProfileOccasionTier(item({ dinner: "Strong" }), "girls-night"), null);
  });

  test("OB-C.3 an unknown occasion resolves to itself and stays null", () => {
    assert.equal(profileOccasionRating({ date: "Strong" }, "not-a-real-occasion"), undefined);
    assert.equal(getProfileOccasionTier(item({ date: "Strong" }), "not-a-real-occasion"), null);
  });

  test("OB-C.4 an unrecognised rating value is still null, not a tier", () => {
    assert.equal(getProfileOccasionTier(item({ "night-out": "Maybe" }), "girls-night"), null);
  });

  test("OB-C.5 the occasion gate fails open without a map and honours a mapped No", () => {
    assert.equal(passesProfileOccasionGate(item(null), "girls-night"), true);
    assert.equal(passesProfileOccasionGate(item({ dinner: "No" }), "girls-night"), true,
      "a No for a different occasion must not block this one");
    assert.equal(passesProfileOccasionGate(item({ "night-out": "No" }), "girls-night"), false,
      "a reviewer's No for a night out is now honoured");
  });
});

// ── OB-D: the three QA cases consult the right profile ─────────────────────
//
// One assertion each: the reviewer's rating under the admin key now reaches the engine for
// that canonical occasion. No outfit is asserted — ranking remains authoritative.

describe("OB-D — ST15, ST16 and O4 occasions are now wired", () => {
  const cases: Array<[string, string, string]> = [
    ["ST15 special-event", "special-event", "event"],
    ["ST16 girls-night / evening out", "girls-night", "night-out"],
    ["O4 girls-night / evening out", "girls-night", "night-out"],
  ];
  for (const [label, sessionOccasion, adminKey] of cases) {
    test(`OB-D ${label} reads occasionFit['${adminKey}']`, () => {
      assert.equal(getProfileOccasionTier(item({ [adminKey]: "Strong" }), sessionOccasion), 2);
      assert.equal(getProfileOccasionTier(item({ [adminKey]: "No" }), sessionOccasion), 0);
      // and was previously invisible: the session spelling is not a stored key
      assert.equal(profileOccasionRating({ [sessionOccasion]: "Strong" }, sessionOccasion), undefined);
    });
  }
});
