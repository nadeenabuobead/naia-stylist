// app/lib/styleme/statement-base-protection.test.ts
//
// ST16 — a valid bottom was selected and then deleted, leaving a ranked outfit with
// nothing on the lower body.
//
// WHAT THE PIPELINE DIAGNOSTICS SHOWED (girls-night + Dressy, band 4-5)
//
//   S1  bottom present, 4 candidates, Black Draped Maxi Skirt 19.263 (highest bottom)
//   S2  architecture exclusivity deleted `dress` only — bottom untouched, still 19.263
//   S3  Phase 1 selected [top: Black Embroidered Mesh Tank, bottom: Black Draped Maxi Skirt]
//   S4  returned [top, shoe, bag]                          <-- the bottom is gone
//   S5  candidates A and B: slots [outerwear, top, shoe, bag], hasBottomOrOnepiece false
//
// maxAdditional was 4 and only 3 pieces came back, so the piece budget was never the
// cause. Between S3 and S4 the only thing that can splice a base piece is the
// post-assembly statement-coherence resolver. The anchor (Black Tailored Blazer,
// outerwear) is never in `result`, so it is immune; the removal loop skipped only
// bag/accessory/jewelry, ran in reverse, found the shoe was not a statement, and deleted
// the bottom.
//
// FIXTURE NOTE: every item carries an approved occasionFit so it clears the
// `score <= 0` gate. Without that, synthetic closets lose most pieces to scoring and
// these tests pass for the wrong reason — the first draft of this file did exactly that.
// Verified by reverting the one-line guard: case SB-A then returns
// ["top:tank","shoe:pump"], reproducing ST16, while SB-B and SB-C are unchanged.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { selectAdditionalClosetGarments } from "../ai/styleme-result.server.js";
import type {
  ClosetAnchorInput, NormalizedClosetAnchor, StyleMeSessionInput,
} from "../ai/styleme-recommendation.types.js";

/** Approved profile that scores for a night out. */
const prof = (extra: Record<string, unknown> = {}) =>
  ({ occasionFit: { "night-out": "Strong" }, dressRegister: "dressy", ...extra }) as unknown as ClosetAnchorInput["approvedProfile"];
/** …and is rated a statement piece. */
const statement = (extra: Record<string, unknown> = {}) => prof({ statementLevel: "statement", ...extra });

function g(o: Partial<ClosetAnchorInput> & { id: string; category: string }): ClosetAnchorInput {
  return {
    type: "closet", name: o.id, subcategory: null, colors: ["black"], primaryColor: "black",
    pattern: null, material: null, styleTags: [], occasions: ["party"], imageUrl: null,
    garmentRelationships: [], formality: "business-formal", fitProfile: null, waistShape: null,
    sleeveLength: null, necklineCoverage: null, hemLength: null, topLength: null,
    shoulderCoverage: null, midriffExposed: null, silhouette: null, stylePersonality: null,
    approvedProfile: prof(), ...o,
  } as ClosetAnchorInput;
}

const session = (): StyleMeSessionInput => ({
  moods: [], desiredFeelings: [], bodyNeeds: ["nothing-specific"], coverageConditional: null,
  occasion: "girls-night", formalityConditional: "formality-occasion",
  todayColours: { preferred: [], avoid: [] }, practicalIds: [], source: "my-closet",
  state: "nothing-in-particular", intentions: [],
} as unknown as StyleMeSessionInput);

const outerwearAnchor = (id: string) => ({
  type: "closet", id, slot: "outerwear", label: id,
  colors: ["black"], material: null, styleTags: [], imageUrl: null,
} as unknown as NormalizedClosetAnchor);

const pick = (items: ClosetAnchorInput[]) =>
  selectAdditionalClosetGarments(outerwearAnchor("blazer"), null, session(), items, null)
    .map((p) => `${p.slot}:${p.id}`);

// ── SB-A: the ST16 shape — a statement base piece is protected ───────────────

describe("SB-A — a statement outerwear anchor cannot delete the only bottom", () => {
  const items = [
    g({ id: "blazer", category: "OUTERWEAR", approvedProfile: statement() }),
    g({ id: "tank", category: "TOPS", formality: "smart-casual" }),
    g({ id: "maxi", category: "BOTTOMS", formality: "occasion", approvedProfile: statement() }),
    g({ id: "pump", category: "SHOES" }),
  ];

  test("SB-A.1 the statement bottom survives alongside a statement anchor", () => {
    assert.deepEqual(pick(items), ["top:tank", "bottom:maxi", "shoe:pump"]);
  });

  test("SB-A.2 the outfit covers the lower body", () => {
    const slots = new Set(pick(items).map((s) => s.split(":")[0]));
    assert.ok(slots.has("bottom") || slots.has("dress") || slots.has("set"));
  });

  test("SB-A.3 nothing else was sacrificed to protect it", () => {
    const slots = pick(items).map((s) => s.split(":")[0]);
    assert.deepEqual(slots, ["top", "bottom", "shoe"], "top and shoe must also survive");
  });
});

// ── SB-B: non-base statement pieces are still removable ─────────────────────

describe("SB-B — a statement piece in a non-base slot can still be dropped", () => {
  // Identical to SB-A except the statement sits on the shoe and the bottom is plain.
  const items = [
    g({ id: "blazer", category: "OUTERWEAR", approvedProfile: statement() }),
    g({ id: "tank", category: "TOPS", formality: "smart-casual" }),
    g({ id: "maxi", category: "BOTTOMS", formality: "occasion" }),
    g({ id: "loud-shoe", category: "SHOES", approvedProfile: statement() }),
  ];

  test("SB-B.1 the statement shoe is removed to resolve the conflict", () => {
    const slots = pick(items);
    assert.ok(!slots.includes("shoe:loud-shoe"),
      `the statement shoe must still be removable; got ${JSON.stringify(slots)}`);
  });

  test("SB-B.2 and the base pieces are untouched by that removal", () => {
    assert.deepEqual(pick(items), ["top:tank", "bottom:maxi"]);
  });
});

// ── SB-C: no statements — baseline unchanged ─────────────────────────────────

describe("SB-C — the resolver does nothing when there is no conflict", () => {
  const items = [
    g({ id: "blazer", category: "OUTERWEAR" }),
    g({ id: "tank", category: "TOPS", formality: "smart-casual" }),
    g({ id: "maxi", category: "BOTTOMS", formality: "occasion" }),
    g({ id: "pump", category: "SHOES" }),
  ];

  test("SB-C.1 every piece is retained", () => {
    assert.deepEqual(pick(items), ["top:tank", "bottom:maxi", "shoe:pump"]);
  });
});

// ── SB-D: every base slot is protected, not just `bottom` ───────────────────

describe("SB-D — top, bottom, dress and set are all protected", () => {
  test("SB-D.1 a statement top survives", () => {
    const items = [
      g({ id: "blazer", category: "OUTERWEAR", approvedProfile: statement() }),
      g({ id: "loud-top", category: "TOPS", formality: "smart-casual", approvedProfile: statement() }),
      g({ id: "maxi", category: "BOTTOMS", formality: "occasion" }),
      g({ id: "pump", category: "SHOES" }),
    ];
    assert.ok(pick(items).includes("top:loud-top"));
  });

  test("SB-D.2 a statement dress survives", () => {
    const items = [
      g({ id: "blazer", category: "OUTERWEAR", approvedProfile: statement() }),
      g({ id: "loud-dress", category: "DRESSES", formality: "occasion", approvedProfile: statement() }),
      g({ id: "pump", category: "SHOES" }),
    ];
    assert.ok(pick(items).some((s) => s.startsWith("dress:")));
  });

  test("SB-D.3 two statement base pieces both survive — the conflict is left unresolved", () => {
    const items = [
      g({ id: "blazer", category: "OUTERWEAR", approvedProfile: statement() }),
      g({ id: "loud-top", category: "TOPS", formality: "smart-casual", approvedProfile: statement() }),
      g({ id: "loud-maxi", category: "BOTTOMS", formality: "occasion", approvedProfile: statement() }),
      g({ id: "pump", category: "SHOES" }),
    ];
    const slots = pick(items);
    assert.ok(slots.includes("top:loud-top"), "top retained");
    assert.ok(slots.includes("bottom:loud-maxi"), "bottom retained");
  });
});

// ── SB-E: the exact ST16 fixture, by name ───────────────────────────────────

describe("SB-E — ST16 regression", () => {
  const items = [
    g({ id: "Black Tailored Blazer", category: "OUTERWEAR", approvedProfile: statement() }),
    g({ id: "Black Embroidered Mesh Tank Top", category: "TOPS", formality: "smart-casual" }),
    g({ id: "Black Draped Maxi Skirt", category: "BOTTOMS", formality: "occasion", approvedProfile: statement() }),
    g({ id: "Black Patent Leather Stiletto Pump", category: "SHOES" }),
    g({ id: "Black Leather Tote Bag", category: "BAGS", formality: "business-casual" }),
  ];

  test("SB-E.1 the Black Draped Maxi Skirt is retained", () => {
    const picked = selectAdditionalClosetGarments(
      outerwearAnchor("Black Tailored Blazer"), null, session(), items, null);
    assert.ok(picked.some((p) => p.id === "Black Draped Maxi Skirt"),
      `got ${JSON.stringify(picked.map((p) => `${p.slot}:${p.id}`))}`);
  });

  test("SB-E.2 the result is no longer the bottomless outfit QA saw", () => {
    const picked = selectAdditionalClosetGarments(
      outerwearAnchor("Black Tailored Blazer"), null, session(), items, null);
    assert.ok(picked.map((p) => p.slot).includes("bottom"),
      "the observed failure was [top, shoe, bag] with no bottom");
  });
});
