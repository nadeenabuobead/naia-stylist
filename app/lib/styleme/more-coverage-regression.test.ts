// app/lib/styleme/more-coverage-regression.test.ts
//
// RC-A — "Give me more coverage" could not influence either selection stage.
//
// WHAT THE QA LOGS SHOWED (date-night + Polished + feel-attractive + more-coverage)
//
//   [nAia-anchor-rank]  Black Embroidered Mesh Tank Top  score 10.00  ← WON
//                       Black Tailored Trousers           score  5.25
//                       Black Tailored Blazer             score  5.25
//
//   A 4.75 lead to which more-coverage contributed nothing. Six of the nine Rev3
//   body needs had an anchor-level bonus branch; more-coverage had none, and
//   computeBodyNeedSlotBonus had none either. The sleeveless anchor then appeared
//   as the `top` of candidates A, B and E, so T3a's violation count was identical
//   pool-wide and T3b could not discriminate. The one need she chose was inert
//   from end to end.
//
//   A second cause sat underneath it: AutoSelectItem selected only hemLength and
//   topLength, so even a wired-up bonus would have read null for sleeves,
//   neckline, shoulders and midriff — the four signals that actually decide
//   whether a garment covers.
//
// The bonus magnitude deliberately matches less-body-conscious (-2.0 violation,
// +1.7 × fitScore reward): both are exposure-avoidance needs, so neither may
// outweigh the other.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { computeBodyNeedSlotBonus } from "../ai/styleme-result.server.js";
import { autoSelectClosetAnchor, scoreBodyNeedForClosetItem } from "../ai/styleme-anchor.server.js";
import type { ClosetAnchorInput } from "../ai/styleme-recommendation.types.js";

function g(o: Partial<ClosetAnchorInput> & { id: string; category: string }): ClosetAnchorInput {
  return {
    type: "closet", name: o.id, subcategory: null, colors: ["black"], primaryColor: "black",
    pattern: null, material: null, styleTags: [], occasions: ["casual"], imageUrl: null,
    garmentRelationships: [], formality: "casual", fitProfile: null, waistShape: null,
    sleeveLength: null, necklineCoverage: null, hemLength: null, topLength: null,
    shoulderCoverage: null, midriffExposed: null, silhouette: null, stylePersonality: null,
    approvedProfile: null, ...o,
  } as ClosetAnchorInput;
}

/** The real offender: sleeveless, low neckline, bare shoulders, midriff shown. */
const MESH_TANK = g({
  id: "mesh-tank", category: "TOPS", name: "Black Embroidered Mesh Tank Top",
  sleeveLength: "sleeveless", necklineCoverage: "low",
  shoulderCoverage: false, midriffExposed: true, topLength: "cropped",
});

/** Its covering counterpart. */
const LONG_SLEEVE = g({
  id: "long-sleeve", category: "TOPS", name: "Black Long-Sleeve Top",
  sleeveLength: "full", necklineCoverage: "crew",
  shoulderCoverage: true, midriffExposed: false, topLength: "hip",
});

const NEEDS = ["more-coverage"];

// ── MC-A: the slot bonus now exists and points the right way ─────────────────

describe("MC-A — computeBodyNeedSlotBonus honours more-coverage", () => {
  test("MC-A.1 an exposing piece is penalised", () => {
    assert.ok(computeBodyNeedSlotBonus(NEEDS, MESH_TANK, "top") < 0);
  });

  test("MC-A.2 a covering piece is rewarded", () => {
    assert.ok(computeBodyNeedSlotBonus(NEEDS, LONG_SLEEVE, "top") > 0);
  });

  test("MC-A.3 the covering piece beats the exposing one", () => {
    assert.ok(
      computeBodyNeedSlotBonus(NEEDS, LONG_SLEEVE, "top") >
      computeBodyNeedSlotBonus(NEEDS, MESH_TANK, "top"),
    );
  });

  test("MC-A.4 unknown geometry is never penalised", () => {
    const unknown = g({ id: "plain", category: "TOPS" });
    assert.equal(computeBodyNeedSlotBonus(NEEDS, unknown, "top"), 0);
  });

  test("MC-A.5 the bonus stays inside the shared body-need scale", () => {
    for (const item of [MESH_TANK, LONG_SLEEVE]) {
      const b = computeBodyNeedSlotBonus(NEEDS, item, "top");
      assert.ok(b >= -2.0 && b <= 1.7, `bonus ${b} outside [-2.0, 1.7]`);
    }
  });

  test("MC-A.6 a bag cannot satisfy a coverage need", () => {
    assert.equal(computeBodyNeedSlotBonus(NEEDS, MESH_TANK, "bag"), 0);
    assert.equal(computeBodyNeedSlotBonus(NEEDS, LONG_SLEEVE, "jewelry"), 0);
  });

  test("MC-A.7 no more-coverage need means no change at all", () => {
    assert.equal(computeBodyNeedSlotBonus(["nothing-specific"], MESH_TANK, "top"), 0);
    assert.equal(computeBodyNeedSlotBonus(["nothing-specific"], LONG_SLEEVE, "top"), 0);
  });
});

// ── MC-B: the anchor sees the coverage geometry ──────────────────────────────

const anchorRow = (o: Record<string, unknown>) => ({
  subcategory: null, colors: [], primaryColor: null, pattern: null, material: null,
  styleTags: [], occasions: ["casual"], imageUrl: null, garmentRelationships: [],
  waistShape: null, hemLength: null, topLength: null,
  sleeveLength: null, necklineCoverage: null, shoulderCoverage: null, midriffExposed: null,
  styleMeProfile: null, formality: "casual", ...o,
});

describe("MC-B — more-coverage reaches anchor selection", () => {
  // Two tops identical in every scored respect except coverage geometry, so only
  // the body-need bonus can separate them.
  const rows = [
    anchorRow({ id: "mesh-tank", name: "Black Embroidered Mesh Tank Top", category: "TOPS",
      sleeveLength: "sleeveless", necklineCoverage: "low", shoulderCoverage: false, midriffExposed: true }),
    anchorRow({ id: "long-sleeve", name: "Black Long-Sleeve Top", category: "TOPS",
      sleeveLength: "full", necklineCoverage: "crew", shoulderCoverage: true, midriffExposed: false }),
  ] as never[];
  const fetchRows = async () => rows;

  test("MC-B.1 the covering top anchors when she asked for more coverage", async () => {
    const picked = await autoSelectClosetAnchor("cust", {
      occasion: "everyday", moods: [], desiredFeelings: [],
      intentions: [], bodyNeeds: ["more-coverage"],
    }, fetchRows);
    assert.equal(picked!.id, "long-sleeve");
  });

  test("MC-B.2 without the need the ranking is untouched", async () => {
    // Both tie on base score; the tiebreak order is stable, not coverage-driven.
    const picked = await autoSelectClosetAnchor("cust", {
      occasion: "everyday", moods: [], desiredFeelings: [],
      intentions: [], bodyNeeds: ["nothing-specific"],
    }, fetchRows);
    assert.equal(picked!.id, "mesh-tank", "stable order must be preserved when the need is absent");
  });

  test("MC-B.3 the four previously-unselected geometry signals are read", () => {
    // hemLength alone cannot distinguish these two; sleeves/neckline/shoulders/midriff can.
    const bare = scoreBodyNeedForClosetItem("more-coverage", {
      ...MESH_TANK, hemLength: null,
    } as never);
    assert.equal(bare.violation, true, "sleeveless + low neck + bare shoulders + midriff must register");
  });
});
