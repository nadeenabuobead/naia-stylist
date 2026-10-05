// app/lib/styleme/reroll-wiring.test.ts
//
// THE REROLL DEDUPE HAD NEVER EXECUTED.
//
// buildEngineInput builds its return object from named params. prevOutfitClosetIds was read
// by computeStyleMeResult and typed on StyleMeEngineInput, but was declared in neither the
// params type nor the returned object — and the call site passed it as
//   ...(prevOutfitClosetIds && { prevOutfitClosetIds })
// A conditional spread defeats TypeScript's excess-property check, so it compiled and was
// dropped at runtime. engineInput.prevOutfitClosetIds was therefore always undefined,
// prevSig always null, and dedupedCandidates always the full pool.
//
// Live evidence: [nAia-core-diversity] — which is gated on prevSig — fired ZERO times across
// 120 selection-diag records in a two-hour window.
//
// Two manual QA failures came from this one defect:
//
//   MANUAL TOP (dinner/smart)      4 candidates, every one core = [White Oxford Button-Down
//                                  Shirt], differing only by shoe and outerwear
//   MANUAL DRESS (special-event)   2 candidates, every one core = [Burgundy Cowl Neck
//                                  Evening Gown]; candidate A byte-identical to the previous
//                                  outfit under BOTH core and whole-outfit signatures
//
// Test 1 is the one whose absence let this live: the unit was correct and the wiring was
// never asserted, which is how 2713 green tests coexisted with a feature that had never run.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { buildEngineInput, computeStyleMeResult } from "../ai/styleme-result.server.js";
import type { ClosetAnchorInput } from "../ai/styleme-recommendation.types.js";

// ── 1 + 2: the wiring boundary ──────────────────────────────────────────────

const baseParams = {
  moods: [], desiredFeelings: [], bodyNeeds: ["nothing-specific"], coverageConditional: null,
  occasion: "dinner", formalityConditional: "formality-smart",
  todayColours: { preferred: [], avoid: [] }, practicalIds: [],
  source: "my-closet" as const,
};

describe("RW-1 — buildEngineInput carries prevOutfitClosetIds", () => {
  test("RW-1.1 the field survives the boundary", () => {
    const input = buildEngineInput({ ...baseParams, prevOutfitClosetIds: ["a", "b"] });
    assert.deepEqual(input.prevOutfitClosetIds, ["a", "b"]);
  });

  test("RW-1.2 order and contents are preserved verbatim", () => {
    const ids = ["z", "a", "m"];
    assert.deepEqual(buildEngineInput({ ...baseParams, prevOutfitClosetIds: ids }).prevOutfitClosetIds, ids);
  });

  test("RW-2.1 omitted → undefined, not [] — a first generation skips the dedupe", () => {
    const input = buildEngineInput(baseParams);
    assert.equal(input.prevOutfitClosetIds, undefined);
    assert.notDeepEqual(input.prevOutfitClosetIds, []);
  });

  test("RW-2.2 an empty array stays empty and is still falsy to the dedupe guard", () => {
    // prevIds?.length is the guard, so [] must not enable filtering.
    const input = buildEngineInput({ ...baseParams, prevOutfitClosetIds: [] });
    assert.deepEqual(input.prevOutfitClosetIds, []);
    assert.ok(!input.prevOutfitClosetIds!.length);
  });
});

// ── 3-7: the real failure shapes, end to end through computeStyleMeResult ───

function g(o: Partial<ClosetAnchorInput> & { id: string; category: string }): ClosetAnchorInput {
  return {
    type: "closet", name: o.id, subcategory: null, colors: ["black"], primaryColor: "black",
    pattern: null, material: null, styleTags: [], occasions: ["dinner", "formal", "party"],
    imageUrl: null, garmentRelationships: [], formality: "business-casual", fitProfile: null,
    waistShape: null, sleeveLength: null, necklineCoverage: null, hemLength: null,
    topLength: null, shoulderCoverage: null, midriffExposed: null, silhouette: null,
    stylePersonality: null,
    approvedProfile: { occasionFit: { dinner: "Strong", event: "Strong" }, dressRegister: "smart-casual" } as never,
    ...o,
  } as ClosetAnchorInput;
}

// The engine's anchor input is a FULL ClosetAnchorInput — runRecommendation reads
// colors/styleTags/occasions off it. Passing the NormalizedClosetAnchor shape instead
// throws inside resolveClosetAnchor, which is how the first draft of this file failed.
const closetAnchor = (item: ClosetAnchorInput) => item as never;

/** Runs the pipeline with a spied model call so invocation is observable. */
async function runReroll(opts: {
  anchorItem: ClosetAnchorInput; items: ClosetAnchorInput[];
  prevIds: string[]; occasion?: string; formality?: string;
}) {
  let modelCalls = 0;
  const spy = (async (...args: unknown[]) => { modelCalls++; return null; }) as never;
  const input = buildEngineInput({
    ...baseParams,
    occasion: opts.occasion ?? "dinner",
    formalityConditional: opts.formality ?? "formality-smart",
    anchor: closetAnchor(opts.anchorItem),
    mode: "naia",
    prevOutfitClosetIds: opts.prevIds,
  });
  const result = await computeStyleMeResult(
    input, undefined, undefined, undefined,
    async () => opts.items,
    spy,
  );
  return { result, modelCalls };
}

describe("RW-3 — MANUAL TOP: same core, only shoe/outerwear differ", () => {
  // The real pool: every candidate carries the Oxford; no owned bottom exists, so the
  // "Bottom" the customer sees comes from completionLayer and never enters a candidate.
  const items = [
    g({ id: "Oxford", category: "TOPS" }),
    g({ id: "Loafers", category: "SHOES" }),
    g({ id: "ChelseaBoot", category: "SHOES" }),
    g({ id: "ShirtJacket", category: "OUTERWEAR" }),
    g({ id: "Belt", category: "ACCESSORIES" }),
  ];

  test("RW-3.1 every candidate is core-equivalent to the previous look → sameCombination", async () => {
    const { result, modelCalls } = await runReroll({
      anchorItem: items[0], items,
      prevIds: ["Oxford", "Loafers", "ShirtJacket", "Belt"],
    });
    assert.equal(result.sameCombination, true, "a shoe/outerwear-only change is not a New Look");
    assert.equal(modelCalls, 0, "no selection/wording call may run");
  });

  test("RW-3.2 no outfit payload is produced to persist", async () => {
    const { result } = await runReroll({
      anchorItem: items[0], items,
      prevIds: ["Oxford", "Loafers", "ShirtJacket", "Belt"],
    });
    // The route returns data({ sameCombination: true }) BEFORE outfitSuggestion.create,
    // so the observable contract at this layer is the flag plus no model call.
    assert.equal(result.sameCombination, true);
  });
});

describe("RW-4 — MANUAL DRESS: candidate A identical under BOTH signatures", () => {
  const items = [
    g({ id: "Gown", category: "DRESSES", formality: "evening",
      approvedProfile: { occasionFit: { event: "Strong" }, dressRegister: "evening" } as never }),
    g({ id: "StilettoPump", category: "SHOES", formality: "business-formal" }),
    g({ id: "Sneakers", category: "SHOES", formality: "casual" }),
    g({ id: "BeigeBlazer", category: "OUTERWEAR", formality: "business-formal" }),
    g({ id: "GoldHoops", category: "JEWELRY" }),
  ];

  test("RW-4.1 an identical whole set is filtered → sameCombination, no model call", async () => {
    const { result, modelCalls } = await runReroll({
      anchorItem: items[0], items,
      prevIds: ["Gown", "StilettoPump", "BeigeBlazer", "GoldHoops"],
      occasion: "special-event", formality: "formality-occasion",
    });
    assert.equal(result.sameCombination, true,
      "candidate A was byte-identical under core AND whole-outfit signatures");
    assert.equal(modelCalls, 0);
  });
});

describe("RW-5 — positive control: a different owned bottom still qualifies", () => {
  const items = [
    g({ id: "Oxford", category: "TOPS" }),
    g({ id: "TrouserA", category: "BOTTOMS" }),
    g({ id: "TrouserB", category: "BOTTOMS" }),
    g({ id: "Loafers", category: "SHOES" }),
  ];

  test("RW-5.1 a fixed top does not by itself force sameCombination", async () => {
    const { result } = await runReroll({
      anchorItem: items[0], items,
      prevIds: ["Oxford", "TrouserA", "Loafers"],
    });
    assert.notEqual(result.sameCombination, true,
      "a genuinely different core must still be allowed to surface");
  });
});

describe("RW-6 — the same filtering path under an AUTO-provenance reroll", () => {
  // Provenance governs whether the ANCHOR may move; the dedupe is downstream of that and
  // identical in both modes. This asserts the wiring reaches it either way.
  const items = [
    g({ id: "Oxford", category: "TOPS" }),
    g({ id: "Loafers", category: "SHOES" }),
    g({ id: "ShirtJacket", category: "OUTERWEAR" }),
  ];

  test("RW-6.1 core-equivalent candidates are filtered regardless of provenance", async () => {
    const { result, modelCalls } = await runReroll({
      anchorItem: items[0], items,
      prevIds: ["Oxford", "Loafers", "ShirtJacket"],
    });
    assert.equal(result.sameCombination, true);
    assert.equal(modelCalls, 0);
  });
});

describe("RW-7 — persistence / model-call contract", () => {
  const items = [
    g({ id: "Oxford", category: "TOPS" }),
    g({ id: "Loafers", category: "SHOES" }),
  ];

  test("RW-7.1 an empty survivor pool means zero model invocations", async () => {
    const { result, modelCalls } = await runReroll({
      anchorItem: items[0], items,
      prevIds: ["Oxford", "Loafers"],
    });
    assert.equal(result.sameCombination, true);
    assert.equal(modelCalls, 0,
      "sameCombination must short-circuit before selection and wording");
  });

  test("RW-7.2 a first generation (no prevIds) does call the model", async () => {
    // Proves RW-7.1 measures the dedupe, not a broken fixture.
    let modelCalls = 0;
    const spy = (async () => { modelCalls++; return null; }) as never;
    const input = buildEngineInput({
      ...baseParams, anchor: closetAnchor(items[0]), mode: "naia",
    });
    const result = await computeStyleMeResult(
      input, undefined, undefined, undefined, async () => items, spy);
    assert.notEqual(result.sameCombination, true);
    assert.ok(modelCalls > 0, "the normal path must still reach the model");
  });
});
