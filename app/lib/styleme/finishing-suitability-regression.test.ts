// app/lib/styleme/finishing-suitability-regression.test.ts
//
// "Best available owned item" is not the same as "good enough to recommend."
//
// ST15 paired a rank-6 evening gown with a business tote (rank 3) and block-heel ankle
// boots (rank 3) because they were the only bag and shoe in the closet. ST16, once the
// base-piece fix restored its evening skirt, paired that skirt with the same tote. In
// both runs the finishing piece was selected purely for being top of a bad field.
//
// THE RULE (finishingPieceIsSuitable, styleme-profile-gate.ts)
//
//   unsuitable  <=>  formality rank < band.min
//                    AND (baseRegister - rank) > FINISHING_SUITABILITY_MAX_GAP_BELOW_BASE
//
// Both conditions are required. Measured against the real QA runs, condition 1 alone
// also stripped Omar's penny loafers and his watch from a Night out, leaving him with no
// shoes, because his wardrobe tops out one rank below the band. Condition 2 scales the
// judgement to the outfit being built: rank 3 beside rank 4 is proportionate, rank 3
// beside a rank-6 gown is not.
//
// FORMALITY_RANK is reused deliberately — it is the scale getTargetFormalityRange speaks
// and evaluateCompleteOutfit already scores the outfit register with. No second formality
// system, and the approved dressRegister path is untouched.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  selectAdditionalClosetGarments,
  buildNaiaOutfitCandidates,
  buildCompletionLayer,
  evaluateCompleteOutfit,
  getMissingFinishingSlots,
  finishingSuggestionRegister,
} from "../ai/styleme-result.server.js";
import {
  finishingPieceIsSuitable,
  FINISHING_SUITABILITY_MAX_GAP_BELOW_BASE,
} from "../ai/styleme-profile-gate.js";
import type {
  ClosetAnchorInput, NormalizedClosetAnchor, StyleMeSessionInput,
} from "../ai/styleme-recommendation.types.js";

// dressRegister must match the garment's own register: it feeds the pre-existing hard
// register gate, and tagging a smart-casual piece "dressy" makes that gate reject it for
// a smart-casual session — which would look like this rule misfiring when it is not.
const prof = (dressRegister = "dressy") => ({
  occasionFit: { "night-out": "Strong", event: "Strong", dinner: "Strong", family: "Strong", everyday: "Strong", work: "Strong" },
  dressRegister,
}) as unknown as ClosetAnchorInput["approvedProfile"];

function g(o: Partial<ClosetAnchorInput> & { id: string; category: string }): ClosetAnchorInput {
  return {
    type: "closet", name: o.id, subcategory: null, colors: ["black"], primaryColor: "black",
    pattern: null, material: null, styleTags: [], occasions: ["party", "formal", "casual", "work"],
    imageUrl: null, garmentRelationships: [], formality: "business-formal", fitProfile: null,
    waistShape: null, sleeveLength: null, necklineCoverage: null, hemLength: null, topLength: null,
    shoulderCoverage: null, midriffExposed: null, silhouette: null, stylePersonality: null,
    approvedProfile: prof(), ...o,
  } as ClosetAnchorInput;
}

const S = (occasion: string, formalityConditional: string | null): StyleMeSessionInput => ({
  moods: [], desiredFeelings: [], bodyNeeds: ["nothing-specific"], coverageConditional: null,
  occasion, formalityConditional, todayColours: { preferred: [], avoid: [] },
  practicalIds: [], source: "my-closet", state: "nothing-in-particular", intentions: [],
} as unknown as StyleMeSessionInput);

const A = (id: string, slot: string) => ({
  type: "closet", id, slot, label: id, colors: ["black"], material: null, styleTags: [], imageUrl: null,
} as unknown as NormalizedClosetAnchor);

const picked = (anchor: NormalizedClosetAnchor, items: ClosetAnchorInput[], sess: StyleMeSessionInput) =>
  selectAdditionalClosetGarments(anchor, null, sess, items, null).map((p) => `${p.slot}:${p.id}`);
/** Mirrors how computeStyleMeResult wires the two together: selection reports which
 *  finishing slots it suppressed, and only those are described by the completion layer. */
const completion = (anchor: NormalizedClosetAnchor, items: ClosetAnchorInput[], sess: StyleMeSessionInput) => {
  const suppressed = new Set<string>();
  const sel = selectAdditionalClosetGarments(anchor, null, sess, items, null, undefined, suppressed);
  return buildCompletionLayer(
    anchor, null, sess, sel, undefined,
    [...suppressed].filter((x): x is "shoe" | "bag" => x === "shoe" || x === "bag"),
  );
};
const suggested = (anchor: NormalizedClosetAnchor, items: ClosetAnchorInput[], sess: StyleMeSessionInput) =>
  completion(anchor, items, sess).map((c) => c.slot);

// ── FS-A: the predicate in isolation ────────────────────────────────────────

describe("FS-A — finishingPieceIsSuitable", () => {
  const band = { min: 4, max: 6 };

  test("FS-A.1 below the floor and far below the base → unsuitable", () => {
    assert.equal(finishingPieceIsSuitable(3, 6, band), false);
  });

  test("FS-A.2 below the floor but close to the base → suitable", () => {
    assert.equal(finishingPieceIsSuitable(3, 4, band), true);
  });

  test("FS-A.3 inside the band → always suitable, whatever the base", () => {
    assert.equal(finishingPieceIsSuitable(4, 6, band), true);
    assert.equal(finishingPieceIsSuitable(6, 6, band), true);
  });

  test("FS-A.4 unknown formality is never removed (fail-open)", () => {
    assert.equal(finishingPieceIsSuitable(null, 6, band), true);
  });

  test("FS-A.5 unknown base register is never removed (fail-open)", () => {
    assert.equal(finishingPieceIsSuitable(1, null, band), true);
  });

  test("FS-A.6 the gap threshold is exactly one rank", () => {
    assert.equal(FINISHING_SUITABILITY_MAX_GAP_BELOW_BASE, 1);
    assert.equal(finishingPieceIsSuitable(3, 4, band), true);   // gap 1 → kept
    assert.equal(finishingPieceIsSuitable(3, 5, band), false);  // gap 2 → dropped
  });

  test("FS-A.7 a casual band never rejects anything", () => {
    for (let r = 1; r <= 6; r++) {
      assert.equal(finishingPieceIsSuitable(r, 1, { min: 1, max: 2 }), true);
    }
  });
});

// ── FS-B: suitable owned pieces are kept ────────────────────────────────────

describe("FS-B — a suitable owned bag and shoe are used", () => {
  const items = [
    g({ id: "gown", category: "DRESSES", formality: "evening" }),
    g({ id: "tote", category: "BAGS", formality: "business-casual" }),
    g({ id: "clutch", category: "BAGS", formality: "evening" }),
    g({ id: "boots", category: "SHOES", formality: "business-casual" }),
    g({ id: "heel", category: "SHOES", formality: "occasion" }),
  ];
  const sess = S("special-event", "formality-occasion");

  test("FS-B.1 the suitable bag is selected, not the higher-scoring unsuitable one", () => {
    assert.ok(picked(A("gown", "dress"), items, sess).includes("bag:clutch"));
  });

  test("FS-B.2 the suitable shoe is selected", () => {
    assert.ok(picked(A("gown", "dress"), items, sess).includes("shoe:heel"));
  });

  test("FS-B.3 nothing is suggested when both slots are properly filled", () => {
    assert.deepEqual(suggested(A("gown", "dress"), items, sess), []);
  });
});

// ── FS-C: all owned options unsuitable → suggestion, not a forced item ──────

describe("FS-C — ST15: every owned bag and shoe is below the register", () => {
  const items = [
    g({ id: "gown", category: "DRESSES", formality: "evening" }),
    g({ id: "tote", category: "BAGS", formality: "business-casual" }),
    g({ id: "boots", category: "SHOES", formality: "business-casual" }),
  ];
  const sess = S("special-event", "formality-occasion");

  test("FS-C.1 no owned bag is forced into the look", () => {
    assert.ok(!picked(A("gown", "dress"), items, sess).some((s) => s.startsWith("bag:")));
  });

  test("FS-C.2 no owned shoe is forced into the look", () => {
    assert.ok(!picked(A("gown", "dress"), items, sess).some((s) => s.startsWith("shoe:")));
  });

  test("FS-C.3 both slots produce a generated recommendation instead", () => {
    assert.deepEqual(suggested(A("gown", "dress"), items, sess).sort(), ["bag", "shoe"]);
  });

  test("FS-C.4 the recommendation is register-appropriate wording", () => {
    const descs = completion(A("gown", "dress"), items, sess).map((c) => c.description);
    assert.ok(descs.some((d) => /evening bag or clutch/i.test(d)), descs.join(" | "));
    assert.ok(descs.some((d) => /evening heel|strappy sandal/i.test(d)), descs.join(" | "));
  });
});

// ── FS-D: ST16 ──────────────────────────────────────────────────────────────

describe("FS-D — ST16: evening skirt retained, business tote not", () => {
  const items = [
    g({ id: "blazer", category: "OUTERWEAR", formality: "business-formal" }),
    g({ id: "tank", category: "TOPS", formality: "smart-casual" }),
    g({ id: "skirt", category: "BOTTOMS", formality: "occasion" }),
    g({ id: "pump", category: "SHOES", formality: "business-formal" }),
    g({ id: "tote", category: "BAGS", formality: "business-casual" }),
  ];
  const sess = S("girls-night", "formality-occasion");

  test("FS-D.1 the business tote is not selected", () => {
    assert.ok(!picked(A("blazer", "outerwear"), items, sess).includes("bag:tote"));
  });

  test("FS-D.2 the in-band shoe is still selected", () => {
    assert.ok(picked(A("blazer", "outerwear"), items, sess).includes("shoe:pump"));
  });

  test("FS-D.3 the base pieces are untouched — ST16 base protection still holds", () => {
    const p = picked(A("blazer", "outerwear"), items, sess);
    assert.ok(p.includes("top:tank"), p.join(" | "));
    assert.ok(p.includes("bottom:skirt"), p.join(" | "));
  });

  test("FS-D.4 a bag recommendation is generated", () => {
    assert.deepEqual(suggested(A("blazer", "outerwear"), items, sess), ["bag"]);
  });
});

// ── FS-E: ordinary looks must not lose valid finishing pieces ───────────────

describe("FS-E — casual and smart-casual looks keep their bags and shoes", () => {
  test("FS-E.1 an all-casual everyday look keeps both", () => {
    const items = [
      g({ id: "tee", category: "TOPS", formality: "casual" }),
      g({ id: "jeans", category: "BOTTOMS", formality: "casual" }),
      g({ id: "sneaker", category: "SHOES", formality: "casual" }),
      g({ id: "daybag", category: "BAGS", formality: "casual" }),
    ];
    const p = picked(A("tee", "top"), items, S("everyday", null));
    assert.ok(p.includes("shoe:sneaker"), p.join(" | "));
    assert.ok(p.includes("bag:daybag"), p.join(" | "));
  });

  test("FS-E.2 a wardrobe that owns no formalwear keeps its shoes (the O4 shape)", () => {
    // Base tops out at rank 4; loafers are rank 3, a gap of 1. Condition 2 spares them.
    const items = [
      g({ id: "blazer", category: "OUTERWEAR", formality: "business-formal" }),
      g({ id: "oxford", category: "TOPS", formality: "business-casual" }),
      g({ id: "trousers", category: "BOTTOMS", formality: "business-formal" }),
      g({ id: "loafers", category: "SHOES", formality: "business-casual" }),
    ];
    const p = picked(A("blazer", "outerwear"), items, S("girls-night", "formality-occasion"));
    assert.ok(p.includes("shoe:loafers"),
      `a wardrobe with no formalwear must not be left shoeless; got ${p.join(" | ")}`);
  });

  test("FS-E.3 a smart-casual dinner keeps a smart-casual bag", () => {
    const sc = prof("smart-casual");
    const items = [
      g({ id: "top", category: "TOPS", formality: "smart-casual", approvedProfile: sc }),
      g({ id: "trousers", category: "BOTTOMS", formality: "business-casual", approvedProfile: sc }),
      g({ id: "flat", category: "SHOES", formality: "smart-casual", approvedProfile: sc }),
      g({ id: "crossbody", category: "BAGS", formality: "smart-casual", approvedProfile: sc }),
    ];
    const p = picked(A("top", "top"), items, S("dinner", "formality-smart"));
    assert.ok(p.includes("bag:crossbody"), p.join(" | "));
    assert.ok(p.includes("shoe:flat"), p.join(" | "));
  });
});

// ── FS-G: the gate only fires when she answered the formality question ──────

describe("FS-G — no explicit formality means no removal (fail-open)", () => {
  // Without a formality answer the band is the occasion's whole envelope, not anything she
  // asked for, and computeRegisterAlignmentScore already softens to bonus-only in that
  // case. Removing a garment on that basis would be stronger than the signal supports.
  // Two existing contracts (WO.11.5, WO.11.7) depend on this: a casual shoe stays
  // selectable for an unspecified work day.
  const items = [
    g({ id: "shirt", category: "TOPS", formality: "business-casual", approvedProfile: prof("smart-casual") }),
    g({ id: "chinos", category: "BOTTOMS", formality: "business-casual", approvedProfile: prof("smart-casual") }),
    g({ id: "sneaker", category: "SHOES", formality: "casual", approvedProfile: prof("casual") }),
  ];

  test("FS-G.1 a casual shoe survives a work session with no formality answer", () => {
    const p = picked(A("chinos", "bottom"), items, S("work", null));
    assert.ok(p.includes("shoe:sneaker"),
      `without an explicit register nothing may be removed; got ${p.join(" | ")}`);
  });

  test("FS-G.2 the same shoe IS removed once she asks for Polished", () => {
    const p = picked(A("chinos", "bottom"), items, S("work", "formality-polished"));
    assert.ok(!p.includes("shoe:sneaker"),
      `with an explicit register the gate applies; got ${p.join(" | ")}`);
  });

  test("FS-G.3 and that removal is reported so a suggestion can replace it", () => {
    assert.ok(suggested(A("chinos", "bottom"), items, S("work", "formality-polished")).includes("shoe"));
  });
});

// ── FS-H: an optional slot must earn its place (strict bag) ─────────────────

describe("FS-H — a bag is judged on the band floor alone", () => {
  // ST16's tote survived the first version because its outfit's base register was 2, so a
  // rank-3 bag was not "below the base" at all and the lenient two-condition test cleared
  // it even though the band floor was 4. A bag is optional: if nothing clears the floor the
  // slot is simply described instead, so there is no risk in being strict.
  const band = { min: 4, max: 5 };

  test("FS-H.1 a below-floor bag is unsuitable even when the base register is lower still", () => {
    assert.equal(finishingPieceIsSuitable(3, 2, band, "bag"), false);
  });

  test("FS-H.2 a shoe in the same position is kept — an outfit needs shoes", () => {
    assert.equal(finishingPieceIsSuitable(3, 2, band, "shoe"), true);
  });

  test("FS-H.3 an in-band bag is still suitable", () => {
    assert.equal(finishingPieceIsSuitable(4, 2, band, "bag"), true);
  });

  test("FS-H.4 a casual band never rejects a bag", () => {
    assert.equal(finishingPieceIsSuitable(1, 1, { min: 1, max: 2 }, "bag"), true);
  });

  test("FS-H.5 unknown formality keeps the bag (fail-open)", () => {
    assert.equal(finishingPieceIsSuitable(null, 6, band, "bag"), true);
  });

  test("FS-H.6 ST16 shape end to end: the tote goes, the in-band shoe stays", () => {
    const items = [
      g({ id: "blazer", category: "OUTERWEAR", formality: "business-formal" }),
      g({ id: "tank", category: "TOPS", formality: "smart-casual", approvedProfile: prof("smart-casual") }),
      g({ id: "skirt", category: "BOTTOMS", formality: "business-formal" }),
      g({ id: "pump", category: "SHOES", formality: "business-formal" }),
      g({ id: "tote", category: "BAGS", formality: "business-casual" }),
    ];
    const p = picked(A("blazer", "outerwear"), items, S("girls-night", "formality-occasion"));
    assert.ok(!p.includes("bag:tote"), `the tote must not survive; got ${p.join(" | ")}`);
    assert.ok(p.includes("shoe:pump"), p.join(" | "));
  });
});

// ── FS-K: an oversized bag is unsuitable for a business-casual-and-up occasion,
//          independent of its formality tag (2026-10-24) ──────────────────────

describe("FS-K — oversized structure excludes a bag even when its formality tag would pass", () => {
  // Live bug: StyleMe recommended an oversized green tote for a "polished dinner" session
  // while its OWN generated explanation acknowledged a smaller evening bag would suit
  // better. The formality-rank check alone never looked at size/structure, so a tote whose
  // formality tag happened to be unset or in-band sailed through regardless of how
  // oversized it actually was. "dinner" + "formality-polished" resolves to band {3,4}.
  const band = { min: 3, max: 4 };

  test("FS-K.1 an oversized bag is unsuitable at business-casual and up, even with unknown formality", () => {
    assert.equal(finishingPieceIsSuitable(null, 4, band, "bag", { silhouette: "oversized" }), false);
  });

  test("FS-K.2 fitProfile: 'oversized' triggers the same exclusion as silhouette", () => {
    assert.equal(finishingPieceIsSuitable(null, 4, band, "bag", { fitProfile: "oversized" }), false);
  });

  test("FS-K.3 a casual/smart-casual band never excludes an oversized bag — it's a normal choice there", () => {
    assert.equal(finishingPieceIsSuitable(null, 1, { min: 1, max: 2 }, "bag", { silhouette: "oversized" }), true);
  });

  test("FS-K.4 unknown structure data is fail-open, same as every other signal in this gate", () => {
    assert.equal(finishingPieceIsSuitable(null, 4, band, "bag", {}), true);
    assert.equal(finishingPieceIsSuitable(null, 4, band, "bag"), true);
  });

  test("FS-K.5 a non-strict slot (shoe) is unaffected by the oversized check", () => {
    assert.equal(finishingPieceIsSuitable(null, 4, band, "shoe", { silhouette: "oversized" }), true);
  });

  // End-to-end fixtures need "dinner" in each item's occasions tag — scoring
  // requires a matching occasion tag to clear a positive score at all (a
  // separate, pre-existing gate this fix does not touch), and these items'
  // default occasions list (set by the g() helper, above) does not include it.
  const DINNER_TAGS = ["dinner", "formal", "party"];

  test("FS-K.6 end to end: the oversized tote is dropped, a smaller structured bag is picked instead", () => {
    const items = [
      g({ id: "top", category: "TOPS", formality: "business-casual", occasions: DINNER_TAGS, approvedProfile: prof("smart-casual") }),
      g({ id: "trousers", category: "BOTTOMS", formality: "business-casual", occasions: DINNER_TAGS }),
      g({ id: "heels", category: "SHOES", formality: "business-formal", occasions: DINNER_TAGS }),
      g({ id: "oversized-tote", category: "BAGS", formality: "business-casual", occasions: DINNER_TAGS, silhouette: "oversized" }),
      g({ id: "structured-clutch", category: "BAGS", formality: "business-casual", occasions: DINNER_TAGS, fitProfile: "structured" }),
    ];
    const p = picked(A("top", "top"), items, S("dinner", "formality-polished"));
    assert.ok(!p.includes("bag:oversized-tote"), `the oversized tote must not survive; got ${p.join(" | ")}`);
    assert.ok(p.includes("bag:structured-clutch"), `the structured bag should be picked instead; got ${p.join(" | ")}`);
  });

  test("FS-K.7 with no structured alternative in the closet, the slot is simply left unfilled — never a worse bag forced in", () => {
    const items = [
      g({ id: "top", category: "TOPS", formality: "business-casual", occasions: DINNER_TAGS, approvedProfile: prof("smart-casual") }),
      g({ id: "trousers", category: "BOTTOMS", formality: "business-casual", occasions: DINNER_TAGS }),
      g({ id: "heels", category: "SHOES", formality: "business-formal", occasions: DINNER_TAGS }),
      g({ id: "oversized-tote", category: "BAGS", formality: "business-casual", occasions: DINNER_TAGS, silhouette: "oversized" }),
    ];
    const p = picked(A("top", "top"), items, S("dinner", "formality-polished"));
    assert.ok(!p.includes("bag:oversized-tote"), `the oversized tote must still not survive; got ${p.join(" | ")}`);
  });
});

// ── FS-I: the alternative candidates obey the same gate ─────────────────────

describe("FS-I — B/C/D/E cannot re-admit what A rejected", () => {
  // ST15's boots never appeared in Candidate A's shoe list at all: A chose the stiletto
  // pump. Candidate E swapped the shoe on body-need/intention grounds, which is
  // formality-blind, and E then outranked A at T4. The gate now applies to every swap pool.
  const items = [
    g({ id: "gown", category: "DRESSES", formality: "evening" }),
    g({ id: "pump", category: "SHOES", formality: "business-formal" }),
    g({ id: "boots", category: "SHOES", formality: "business-casual" }),
    g({ id: "sneaker", category: "SHOES", formality: "casual" }),
  ];
  // A body need plus an intention are what make Candidate E get built at all.
  const sess = {
    ...S("special-event", "formality-occasion"),
    bodyNeeds: ["waist-definition"], intentions: ["express-myself"],
  } as unknown as StyleMeSessionInput;

  test("FS-I.1 no candidate contains the below-register shoe", () => {
    const cands = buildNaiaOutfitCandidates(A("gown", "dress"), sess, items, undefined, undefined)
      .filter((c): c is NonNullable<typeof c> => c !== null);
    const shoes = cands.flatMap((c) => c.pieces.filter((p) => p.slot === "shoe").map((p) => p.closetId));
    assert.ok(shoes.length > 0, "at least one candidate should carry a shoe");
    assert.ok(!shoes.includes("boots"), `boots must not re-enter via an alternative; got ${shoes.join(",")}`);
    assert.ok(!shoes.includes("sneaker"), `a casual shoe must not re-enter; got ${shoes.join(",")}`);
  });

  test("FS-I.2 the suitable shoe is what every candidate carries", () => {
    const cands = buildNaiaOutfitCandidates(A("gown", "dress"), sess, items, undefined, undefined)
      .filter((c): c is NonNullable<typeof c> => c !== null);
    for (const c of cands) {
      for (const p of c.pieces.filter((x) => x.slot === "shoe")) {
        assert.equal(p.closetId, "pump", `candidate ${c.id} carries ${p.closetId}`);
      }
    }
  });

  test("FS-I.3 without an explicit formality the alternatives are unrestricted", () => {
    const openSess = { ...sess, formalityConditional: null } as unknown as StyleMeSessionInput;
    const cands = buildNaiaOutfitCandidates(A("gown", "dress"), openSess, items, undefined, undefined)
      .filter((c): c is NonNullable<typeof c> => c !== null);
    const shoes = new Set(cands.flatMap((c) => c.pieces.filter((p) => p.slot === "shoe").map((p) => p.closetId)));
    assert.ok(shoes.size >= 1, "candidates still build without a formality answer");
  });
});

// ── FS-F: helper semantics ──────────────────────────────────────────────────

describe("FS-F — suggestion helpers", () => {
  test("FS-F.1 getMissingFinishingSlots reports only absent slots", () => {
    assert.deepEqual(getMissingFinishingSlots(null, [{ slot: "shoe" }]), ["bag"]);
    assert.deepEqual(getMissingFinishingSlots(null, [{ slot: "bag" }]), ["shoe"]);
    assert.deepEqual(getMissingFinishingSlots(null, [{ slot: "bag" }, { slot: "shoe" }]), []);
    assert.deepEqual(getMissingFinishingSlots(null, []).sort(), ["bag", "shoe"]);
  });

  test("FS-F.2 an anchor in a finishing slot counts as filled", () => {
    assert.deepEqual(getMissingFinishingSlots("shoe", []), ["bag"]);
  });

  test("FS-F.3 suggestion register tracks the resolved band", () => {
    assert.equal(finishingSuggestionRegister({ min: 4, max: 6 }), "evening");
    assert.equal(finishingSuggestionRegister({ min: 4, max: 5 }), "polished");
    assert.equal(finishingSuggestionRegister({ min: 2, max: 3 }), "smart");
    assert.equal(finishingSuggestionRegister({ min: 1, max: 2 }), "relaxed");
  });
});

// ── FS-J: accessories are optional, so they must earn their place ───────────
//
// ST13 recommended a Black Ribbed Knit Beanie (formality `casual`, rank 1) against an
// explicit Smart casual 2-2 target. The register penalty had already fired — the beanie
// scored -1.5 — but a penalty only lowers a score, it never excludes, and the beanie was
// the only accessory left with a positive total (the silk scarf and the belt both landed
// at -0.50 and were cut by the `score <= 0` gate). `accessory` simply was not a gated slot.
//
// Strict like bag, for the same reason: an accessory is optional, so leaving it out costs
// nothing. Unlike bag it produces no suggestion — getMissingFinishingSlots reports shoe and
// bag only, so an omitted accessory disappears cleanly.
//
// FIXTURE NOTE: the category token is ACCESSORIES, plural. "ACCESSORY" resolves to the
// `unknown` slot and the fixture never reaches the accessory contest at all — the first
// draft of this block did that and "passed" while testing nothing.

describe("FS-J — accessory suitability", () => {
  const smartFamily = S("family", "formality-smart");
  const base = () => [
    g({ id: "shirt", category: "TOPS", formality: "business-casual",
      occasions: ["family"], approvedProfile: prof("smart-casual") }),
    g({ id: "jeans", category: "BOTTOMS", formality: "casual",
      occasions: ["family"], approvedProfile: prof("casual") }),
    g({ id: "tote", category: "BAGS", formality: "smart-casual",
      occasions: ["family"], approvedProfile: prof("smart-casual") }),
  ];
  const acc = (id: string, formality: string, register: string) =>
    g({ id, category: "ACCESSORIES", formality, occasions: ["family"], approvedProfile: prof(register) });

  test("FS-J.1 band 2-2: a rank-1 accessory is omitted", () => {
    const items = [...base(), acc("beanie", "casual", "casual")];
    const p = picked(A("shirt", "top"), items, smartFamily);
    assert.ok(!p.some((x) => x.startsWith("accessory:")), `got ${p.join(" | ")}`);
  });

  test("FS-J.2 band 2-2: a rank-2 accessory is retained", () => {
    const items = [...base(), acc("belt", "smart-casual", "smart-casual")];
    const p = picked(A("shirt", "top"), items, smartFamily);
    assert.ok(p.includes("accessory:belt"), `got ${p.join(" | ")}`);
  });

  test("FS-J.3 band 2-2: a rank-3 accessory is retained", () => {
    const items = [...base(), acc("scarf", "business-casual", "smart-casual")];
    const p = picked(A("shirt", "top"), items, smartFamily);
    assert.ok(p.includes("accessory:scarf"), `got ${p.join(" | ")}`);
  });

  test("FS-J.4 the rank-1 accessory survives when there is no formality answer", () => {
    const items = [...base(), acc("beanie", "casual", "casual")];
    const p = picked(A("shirt", "top"), items, S("family", null));
    assert.ok(p.includes("accessory:beanie"),
      `without an explicit register nothing may be removed; got ${p.join(" | ")}`);
  });

  test("FS-J.5 omitting an accessory produces NO suggestion", () => {
    const items = [...base(), acc("beanie", "casual", "casual")];
    const slots = suggested(A("shirt", "top"), items, smartFamily);
    assert.ok(!slots.includes("accessory"), `got ${JSON.stringify(slots)}`);
  });

  test("FS-J.6 jewelry is unaffected — a rank-1 jewel is still selected", () => {
    const items = [
      ...base(),
      g({ id: "studs", category: "JEWELRY", formality: "casual",
        occasions: ["family"], approvedProfile: prof("casual") }),
    ];
    const p = picked(A("shirt", "top"), items, smartFamily);
    assert.ok(p.includes("jewelry:studs"),
      `jewelry was deliberately left ungated; got ${p.join(" | ")}`);
  });

  test("FS-J.7 the predicate itself: accessory is strict, shoe is not", () => {
    const band = { min: 2, max: 2 };
    // rank 1, base register 3 — a gap of 2, so both rules agree here.
    assert.equal(finishingPieceIsSuitable(1, 3, band, "accessory"), false);
    // rank 1 with the base also at 1 — only the strict rule still rejects it.
    assert.equal(finishingPieceIsSuitable(1, 1, band, "accessory"), false);
    assert.equal(finishingPieceIsSuitable(1, 1, band, "shoe"), true);
  });

  test("FS-J.8 ST13 lands within-target once the beanie is gone", () => {
    const items = [...base(), acc("beanie", "casual", "casual")];
    const suppressed = new Set<string>();
    const sel = selectAdditionalClosetGarments(
      A("shirt", "top"), null, smartFamily, items, null, undefined, suppressed);
    assert.ok(suppressed.has("accessory"), "the accessory slot must be reported as suppressed");
    const candidate = {
      id: "A",
      pieces: [{ slot: "top", closetId: "shirt", label: "shirt" },
        ...sel.map((x) => ({ slot: x.slot, closetId: x.id, label: x.label }))],
    } as unknown as Parameters<typeof evaluateCompleteOutfit>[0];
    const r = evaluateCompleteOutfit(candidate, items, smartFamily);
    assert.equal(r.formalityFit, "within-target",
      `register ${r.outfitFormalityRank} against ${JSON.stringify(r.targetFormalityRange)}`);
    assert.ok(Math.abs((r.outfitFormalityRank ?? 0) - 2.0) < 0.0001,
      `expected exactly 2.0, got ${r.outfitFormalityRank}`);
  });
});
