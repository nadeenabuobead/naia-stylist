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
  buildCompletionLayer,
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
