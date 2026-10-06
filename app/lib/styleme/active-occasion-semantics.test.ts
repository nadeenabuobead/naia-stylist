// app/lib/styleme/active-occasion-semantics.test.ts
//
// "Active / busy day" means a practical, mobile, on-the-go day — errands, commuting,
// appointments, a packed workday, travel, the school run. It does NOT mean gym only.
//
// It was implemented as athletic-only: SESSION_OCCASION_TO_CLOSET_TOKENS.active was
// ["active","gym","athletic","sport"], with the source comment "athletic and
// workout-specific items". Everything in a practical wardrobe tagged casual / weekend /
// work / travel therefore matched nothing, and computeOccasionTier returns 0 — invalid —
// for a core slot that has tags but matches none. A work-tagged shirt scored the same as
// a ball gown for a day of errands.
//
// Scope note, because two different fields were conflated while diagnosing this:
//   ClosetItem.occasions   reviewed TAGS. Feeds candidate compatibility via
//                          matchesSessionOccasion -> computeOccasionTier. This is what
//                          the token map fixes.
//   occasionFit            a separate approved per-occasion RATING, read only by
//                          passesProfileOccasionGate / passesProfileRegisterGate. An
//                          explicit "No" stays a hard rejection; a MISSING rating keeps
//                          failing open. Untouched here, and pinned below so it stays so.
//
// Assertions are on effective verdicts from the real functions, not on literal map values,
// except AOS-E which pins the untouched maps. Behaviour is the contract; the table is one
// implementation of it.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  SESSION_OCCASION_TO_CLOSET_TOKENS,
  matchesSessionOccasion,
} from "../ai/styleme-occasion-tokens.js";
import {
  OCCASION_REGISTER_RANGE,
  DRESS_REGISTER_RANK,
  passesProfileRegisterGate,
  passesProfileOccasionGate,
  evaluateAnchorEligibility,
} from "../ai/styleme-profile-gate.js";
import { computeOccasionTier } from "../ai/styleme-result.server.js";
import type { ClosetAnchorInput, OutfitCandidate } from "../ai/styleme-recommendation.types.js";

const ACTIVE = "active";

const item = (id: string, occasions: string[], extra: Record<string, unknown> = {}): ClosetAnchorInput =>
  ({ type: "closet", id, name: id, category: "TOPS", colors: [], primaryColor: null, pattern: null,
     material: null, styleTags: [], occasions, imageUrl: "", approvedProfile: null, ...extra } as unknown as ClosetAnchorInput);

const candidate = (pieces: Array<[string, string]>): OutfitCandidate =>
  ({ id: "A", pieces: pieces.map(([slot, closetId]) => ({ slot, closetId, label: closetId, colors: [] })) } as OutfitCandidate);

// ── AOS-A: a practical wardrobe is compatible with a practical day ────────

describe("AOS-A — practical, mobile, on-the-go garments qualify", () => {
  test("AOS-A.1 a casual/weekend piece qualifies", () => {
    assert.equal(matchesSessionOccasion(["casual", "weekend"], ACTIVE), true);
    assert.equal(matchesSessionOccasion(["casual"], ACTIVE), true);
    assert.equal(matchesSessionOccasion(["weekend"], ACTIVE), true);
    assert.equal(matchesSessionOccasion(["everyday"], ACTIVE), true);
  });

  test("AOS-A.2 a work-tagged practical piece qualifies", () => {
    assert.equal(matchesSessionOccasion(["work"], ACTIVE), true,
      "a packed workday is an Active / busy day");
  });

  test("AOS-A.3 a travel-tagged piece qualifies", () => {
    assert.equal(matchesSessionOccasion(["travel"], ACTIVE), true,
      "travel / airport is the canonical on-the-go case");
  });

  test("AOS-A.4 an athletic piece still qualifies", () => {
    for (const tag of ["active", "gym", "athletic", "sport"]) {
      assert.equal(matchesSessionOccasion([tag], ACTIVE), true, `${tag} must remain valid`);
    }
  });

  test("AOS-A.5 the real reviewed tag set from QA qualifies", () => {
    // The Cream Ribbed Knit Tank Top, as actually reviewed on staging.
    assert.equal(
      matchesSessionOccasion(["work", "casual", "weekend", "evening", "date-night"], ACTIVE),
      true,
      "a smart-casual top is wearable on a busy day",
    );
  });
});

// ── AOS-B: the gate stays meaningful ──────────────────────────────────────

describe("AOS-B — occasion remains a real gate, not a pass-through", () => {
  test("AOS-B.1 an evening/date-night/special-only piece still fails", () => {
    assert.equal(matchesSessionOccasion(["evening"], ACTIVE), false);
    assert.equal(matchesSessionOccasion(["dinner"], ACTIVE), false);
    assert.equal(matchesSessionOccasion(["date-night"], ACTIVE), false);
    assert.equal(matchesSessionOccasion(["special-event"], ACTIVE), false);
    assert.equal(matchesSessionOccasion(["special-occasion"], ACTIVE), false);
    assert.equal(matchesSessionOccasion(["evening", "date-night", "special-occasion"], ACTIVE), false,
      "a gown does not become practical because the day is busy");
  });

  test("AOS-B.2 an untagged piece stays versatile, unchanged", () => {
    assert.equal(matchesSessionOccasion([], ACTIVE), false,
      "empty = no-metadata, handled as versatile by the caller, not by this matcher");
  });
});

// ── AOS-C: computeOccasionTier stops calling practical pieces invalid ─────

describe("AOS-C — a practical core piece is no longer tier 0", () => {
  const tier = (occasions: string[]) => {
    const it = item("core", occasions);
    return computeOccasionTier(candidate([["top", "core"]]), [it], ACTIVE);
  };

  test("AOS-C.1 casual / weekend / work / travel core pieces are not invalid", () => {
    for (const tags of [["casual"], ["weekend"], ["work"], ["travel"], ["casual", "weekend"]]) {
      assert.notEqual(tier(tags), 0,
        `tier 0 means "invalid for this occasion" — wrong for ${tags.join("+")} on a busy day`);
    }
  });

  test("AOS-C.2 an athletic core piece is still not invalid", () => {
    assert.notEqual(tier(["active", "gym"]), 0);
  });

  test("AOS-C.3 an evening-only core piece IS still invalid", () => {
    assert.equal(tier(["evening", "date-night"]), 0,
      "the tier-0 verdict must survive for genuinely unsuitable pieces");
  });
});

// ── AOS-D: register — asserted as effective verdicts ─────────────────────

describe("AOS-D — Active accepts registers 0-3 and blocks 4+", () => {
  const reg = (dressRegister: string) =>
    passesProfileRegisterGate(item("r", [], { approvedProfile: { dressRegister, occasionFit: null } }), ACTIVE);

  test("AOS-D.1 registers 0-3 are accepted", () => {
    for (const name of ["athletic", "casual", "elevated-casual", "smart-casual"]) {
      assert.equal(reg(name), true, `${name} (rank ${DRESS_REGISTER_RANK[name]}) must be valid for a busy day`);
    }
  });

  test("AOS-D.2 register 4+ remains outside the default Active range", () => {
    for (const name of ["polished", "dressy", "evening"]) {
      assert.equal(reg(name), false,
        `${name} (rank ${DRESS_REGISTER_RANK[name]}) must NOT be allowed by default`);
    }
  });

  test("AOS-D.3 the declared range does not itself admit 4+", () => {
    const r = OCCASION_REGISTER_RANGE[ACTIVE];
    assert.ok(r, "active must have a declared range");
    assert.equal(r.min, 0);
    assert.ok(r.max <= 3, `declared max is ${r.max}; 4+ must not be in the default range`);
  });
});

// ── AOS-E: nothing else moves ─────────────────────────────────────────────

describe("AOS-E — no other occasion changes", () => {
  test("AOS-E.1 every other token set is untouched", () => {
    const expected: Record<string, string[]> = {
      everyday: ["casual", "weekend", "everyday"],
      work: ["work"],
      dinner: ["evening", "dinner"],
      "date-night": ["date-night"],
      "girls-night": ["evening", "girls-night"],
      "special-event": ["special-occasion", "special-event"],
      travel: ["travel"],
      family: ["family"],
      "not-sure": [],
    };
    for (const [occ, tokens] of Object.entries(expected)) {
      assert.deepEqual([...(SESSION_OCCASION_TO_CLOSET_TOKENS[occ] ?? [])], tokens, occ);
    }
  });

  test("AOS-E.2 every other register range is untouched", () => {
    const expected: Record<string, { min: number; max: number }> = {
      everyday: { min: 1, max: 3 }, family: { min: 1, max: 3 }, travel: { min: 1, max: 3 },
      work: { min: 2, max: 4 }, dinner: { min: 2, max: 5 },
      "date-night": { min: 2, max: 4 }, "special-event": { min: 3, max: 6 },
      "girls-night": { min: 2, max: 6 },
    };
    for (const [occ, r] of Object.entries(expected)) {
      assert.deepEqual(OCCASION_REGISTER_RANGE[occ], r, occ);
    }
  });
});

// ── AOS-F: occasionFit is a separate signal and stays as it is ────────────

describe("AOS-F — occasionFit behaviour is unchanged", () => {
  const withFit = (fit: Record<string, string> | null) =>
    item("a", ["casual"], { hemLength: "n/a", topLength: "hip-length",
      approvedProfile: { dressRegister: null, occasionFit: fit } });

  test("AOS-F.1 explicit occasionFit.active = 'No' still rejects a locked anchor", () => {
    assert.equal(passesProfileOccasionGate(withFit({ active: "No" }), ACTIVE), false);
    const r = evaluateAnchorEligibility(withFit({ active: "No" }), ACTIVE, []);
    assert.equal(r.eligible, false);
    assert.equal(r.code, "occasion-not-suitable",
      "an explicit human No remains a hard rejection, with its own reason");
  });

  test("AOS-F.2 a missing occasionFit.active remains fail-open", () => {
    assert.equal(passesProfileOccasionGate(withFit({ work: "Strong" }), ACTIVE), true,
      "absence is not a No");
    assert.equal(passesProfileOccasionGate(withFit(null), ACTIVE), true);
    assert.equal(evaluateAnchorEligibility(withFit({ work: "Strong" }), ACTIVE, []).eligible, true);
  });

  test("AOS-F.3 tags alone never reject an anchor", () => {
    // The anchor gate reads occasionFit only — never ClosetItem.occasions.
    const evening = item("e", ["evening"], { hemLength: "n/a", topLength: "hip-length" });
    assert.equal(evaluateAnchorEligibility(evening, ACTIVE, []).eligible, true,
      "tag mismatch affects candidate compatibility, not anchor eligibility");
  });
});

// ── AOS-G: the {0,1} declaration is deliberate ───────────────────────────

describe("AOS-G — the declared Active band must not be 'corrected' to {0,3}", () => {
  test("AOS-G.1 declared {0,1} + the shared ±2 tolerance == effective 0-3", () => {
    const r = OCCASION_REGISTER_RANGE[ACTIVE];
    const reg = (dressRegister: string) =>
      passesProfileRegisterGate(
        item("r", [], { approvedProfile: { dressRegister, occasionFit: null } }), ACTIVE);

    // The declaration and the effective window are different numbers on purpose.
    assert.deepEqual(r, { min: 0, max: 1 },
      "if this changed, read the comment above the table before touching anything else");

    const effective = Object.entries(DRESS_REGISTER_RANK)
      .filter(([name]) => reg(name))
      .map(([, rank]) => rank)
      .sort((a, b) => a - b);
    assert.deepEqual(effective, [0, 1, 2, 3],
      "the ±2 tolerance already yields the intended four bands; widening the declared " +
      "band to {0,3} makes this [0,1,2,3,4,5] and admits polished + dressy to a busy day");
  });

  test("AOS-G.2 the tolerance is shared, and register exclusions layer on top of it", () => {
    // Measured, not assumed. Two mechanisms decide this, and conflating them is how the
    // declared band gets misread:
    //   the shared ±2 range tolerance (line 236), and
    //   register-specific exclusions above it — athletic is barred from every occasion
    //   EXCEPT active (227), and evening is barred from active/everyday/family/travel (230).
    // So `active` passing rank 0 is the athletic exemption, not the range; and `everyday`
    // passing ranks 4-5 is the tolerance, not an intent to dress up for errands.
    const regFor = (dressRegister: string, occ: string) =>
      passesProfileRegisterGate(
        item("r", [], { approvedProfile: { dressRegister, occasionFit: null } }), occ);

    assert.deepEqual(OCCASION_REGISTER_RANGE["everyday"], { min: 1, max: 3 });
    assert.equal(regFor("athletic", "everyday"), false,
      "athletic is excluded from everyday by the register rule, not by the range");
    assert.equal(regFor("athletic", ACTIVE), true,
      "active is the one occasion that exempts athletic — which is why athletic stays a " +
      "valid SUBSET of a busy day rather than its definition");
    assert.equal(regFor("dressy", "everyday"), true, "rank 5 passes everyday via max+2");
    assert.equal(regFor("evening", "everyday"), false, "evening is excluded outright");
  });
});
