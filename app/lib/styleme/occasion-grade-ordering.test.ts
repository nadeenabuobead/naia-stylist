// app/lib/styleme/occasion-grade-ordering.test.ts
//
// An authored "Strong" must actually win its slot.
//
// occasionFit is graded Strong / Acceptable / No, and the engine computed the grade
// correctly and then discarded it at the one moment it would change the outfit. Proven by
// construction: two garments identical except the grade produced identical
// baseScore (10), registerBonus (2.5) and all three gate verdicts; only
// getProfileOccasionTier differed (2 vs 1), and that is read solely by computeOccasionTier
// at CANDIDATE ranking — after slot selection has already chosen one piece per slot.
//
// So the grade never reached the comparison that mattered. Live consequence, from the
// confirmed post-edit catalogue:
//
//   Nadeen  Black High-Waist Leggings  Acceptable  final 17.588  <- won the bottom slot
//           Medium Blue Wash Jeans     Strong      final 15.75
//           Medium Blue Wide-Leg Jeans Strong      final 15.75
//   Omar    Black Nike Joggers         Acceptable              <- won, with a polo and
//           Dark Blue Denim Jeans      Strong                     a shirt jacket around it
//           Black Straight-Leg Jeans   Strong
//
// The fix is a two-level comparator, NOT an added score term. A tuned bonus would make the
// relationship depend on the numerical spread of unrelated signals — the spread here was
// 1.838, and nothing guarantees it stays that small.
//
// MISSING GRADE IS NOT A DEMOTION. An unreviewed garment ranks WITH Acceptable, never
// below it. The engine fails open on absent profile data everywhere else, and ranking
// unreviewed pieces last would quietly punish an incomplete catalogue — a data gap turning
// into a styling verdict.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { occasionGradeRank, CANONICAL_OCCASION_TO_PROFILE_KEY } from "../ai/styleme-profile-gate.js";
import type { ClosetAnchorInput } from "../ai/styleme-recommendation.types.js";

const ACTIVE = "active";

const piece = (id: string, grade: string | null, score: number) => ({
  item: {
    type: "closet", id, name: id, category: "BOTTOMS", colors: [], primaryColor: null,
    pattern: null, material: null, styleTags: [], occasions: ["casual"], imageUrl: "",
    approvedProfile: grade === null ? null : { dressRegister: "casual", occasionFit: { active: grade } },
  } as unknown as ClosetAnchorInput,
  score,
});

/** The production comparator, as used for every slot's list. */
const sortSlot = <T extends { item: ClosetAnchorInput; score: number }>(list: T[]): T[] =>
  [...list].sort((a, b) =>
    occasionGradeRank(b.item, ACTIVE) - occasionGradeRank(a.item, ACTIVE) || b.score - a.score);

const names = (l: Array<{ item: ClosetAnchorInput }>) => l.map((x) => x.item.id);

// ── OGO-A: the grade decides first ────────────────────────────────────────

describe("OGO-A — Strong outranks Acceptable regardless of score", () => {
  test("OGO-A.1 a Strong piece beats a higher-scoring Acceptable one", () => {
    // The exact live numbers: Acceptable leggings 17.588 vs Strong jeans 15.75.
    const sorted = sortSlot([
      piece("acceptable-leggings", "Acceptable", 17.588),
      piece("strong-jeans", "Strong", 15.75),
    ]);
    assert.deepEqual(names(sorted), ["strong-jeans", "acceptable-leggings"]);
  });

  test("OGO-A.2 it holds at any spread — the relationship is not tuned", () => {
    for (const gap of [0.01, 1.838, 5, 50, 1000]) {
      const sorted = sortSlot([
        piece("acceptable", "Acceptable", 100 + gap),
        piece("strong", "Strong", 100),
      ]);
      assert.equal(names(sorted)[0], "strong", `a ${gap}-point lead must not beat the grade`);
    }
  });
});

// ── OGO-B: within a grade, nothing changed ────────────────────────────────

describe("OGO-B — the existing score still decides inside a grade", () => {
  test("OGO-B.1 two Strong pieces are ordered by score", () => {
    const sorted = sortSlot([
      piece("strong-low", "Strong", 11),
      piece("strong-high", "Strong", 15.75),
    ]);
    assert.deepEqual(names(sorted), ["strong-high", "strong-low"]);
  });

  test("OGO-B.2 two Acceptable pieces are ordered by score", () => {
    const sorted = sortSlot([
      piece("acc-low", "Acceptable", 14.7),
      piece("acc-high", "Acceptable", 17.588),
    ]);
    assert.deepEqual(names(sorted), ["acc-high", "acc-low"]);
  });

  test("OGO-B.3 a same-grade list keeps its existing order exactly", () => {
    // The live bottom slot, had all four been Strong: ordering must be untouched.
    const input = [
      piece("leggings", "Strong", 17.588),
      piece("jeans-wash", "Strong", 15.75),
      piece("jeans-wide", "Strong", 15.75),
      piece("flare", "Strong", 14.7),
    ];
    assert.deepEqual(names(sortSlot(input)), names([...input].sort((a, b) => b.score - a.score)));
  });
});

// ── OGO-C: Acceptable still gets used ─────────────────────────────────────

describe("OGO-C — Acceptable wins when no Strong exists for the slot", () => {
  test("OGO-C.1 an all-Acceptable slot still produces a winner", () => {
    const sorted = sortSlot([
      piece("acc-a", "Acceptable", 12),
      piece("acc-b", "Acceptable", 17.588),
    ]);
    assert.equal(names(sorted)[0], "acc-b", "the slot must still fill, by score");
  });

  test("OGO-C.2 Acceptable is preferred over nothing, not excluded", () => {
    assert.equal(occasionGradeRank(piece("a", "Acceptable", 1).item, ACTIVE) > 0, true,
      "Acceptable remains eligible — this fix is about order, not eligibility");
  });
});

// ── OGO-D: No stays out, and missing is not punished ──────────────────────

describe("OGO-D — exclusion and fail-open are unchanged", () => {
  test("OGO-D.1 'No' ranks below everything, and the gate already removed it", () => {
    // Belt and braces: the gate excludes No before the sort, so this only guards against
    // a future caller that sorts an ungated list.
    assert.ok(occasionGradeRank(piece("no", "No", 1000).item, ACTIVE)
      < occasionGradeRank(piece("acc", "Acceptable", 0).item, ACTIVE));
  });

  test("OGO-D.2 a missing grade ranks WITH Acceptable, never below it", () => {
    const noProfile = occasionGradeRank(piece("unreviewed", null, 1).item, ACTIVE);
    const acceptable = occasionGradeRank(piece("acc", "Acceptable", 1).item, ACTIVE);
    assert.equal(noProfile, acceptable,
      "an unreviewed garment must not be demoted — a data gap is not a styling verdict");
  });

  test("OGO-D.3 a profile with no rating for THIS occasion also ranks with Acceptable", () => {
    const other = {
      ...piece("rated-elsewhere", "Strong", 1).item,
      approvedProfile: { dressRegister: "casual", occasionFit: { work: "Strong" } },
    } as unknown as ClosetAnchorInput;
    assert.equal(occasionGradeRank(other, ACTIVE),
      occasionGradeRank(piece("acc", "Acceptable", 1).item, ACTIVE));
  });

  test("OGO-D.4 unreviewed and Strong are not equal — Strong still wins", () => {
    const sorted = sortSlot([
      piece("unreviewed-high", null, 99),
      piece("strong-low", "Strong", 1),
    ]);
    assert.equal(names(sorted)[0], "strong-low",
      "fail-open means 'treated as Acceptable', not 'treated as Strong'");
  });
});

// ── OGO-E: the comparator is generic ──────────────────────────────────────

describe("OGO-E — the same semantics apply to every occasion", () => {
  test("OGO-E.1 the grade is read for any occasion, not just active", () => {
    for (const occ of ["everyday", "work", "dinner", "date-night", "girls-night", "special-event", "travel", "family"]) {
      const profileKey = CANONICAL_OCCASION_TO_PROFILE_KEY[occ] ?? occ;
      const strong = { ...piece("s", null, 1).item,
        approvedProfile: { dressRegister: "casual", occasionFit: { [profileKey]: "Strong" } } } as unknown as ClosetAnchorInput;
      const acceptable = { ...piece("a", null, 1).item,
        approvedProfile: { dressRegister: "casual", occasionFit: { [profileKey]: "Acceptable" } } } as unknown as ClosetAnchorInput;
      assert.ok(occasionGradeRank(strong, occ) > occasionGradeRank(acceptable, occ),
        `${occ} must honour the authored grade too`);
    }
  });

  test("OGO-E.2 the canonical key remap is respected", () => {
    // date-night reads occasionFit["date"], so a grade stored under the UI key must count.
    const strong = { ...piece("s", null, 1).item,
      approvedProfile: { dressRegister: "casual", occasionFit: { date: "Strong" } } } as unknown as ClosetAnchorInput;
    assert.ok(occasionGradeRank(strong, "date-night")
      > occasionGradeRank(piece("a", "Acceptable", 1).item, "date-night"));
  });
});
