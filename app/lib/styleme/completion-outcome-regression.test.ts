// app/lib/styleme/completion-outcome-regression.test.ts
//
// Completion suggestions used to depend on WHY a finishing slot was empty, not on whether
// it was empty.
//
// buildCompletionLayer intersected getMissingFinishingSlots (outcome) with
// suppressedFinishingSlots (cause), and the latter is populated only inside the suitability
// gate. So a suggestion appeared only when a candidate had reached that gate and been
// rejected there.
//
// ST15 exposed the hole. Once C1 let the occasion gate honour a reviewer's "No" for `event`,
// every bag was excluded BEFORE scoring:
//
//   S1 keys: ['outerwear', 'accessory', 'jewelry', 'shoe']   <- no 'bag'
//   finishing-suitability records: accessory, shoe only      <- bag never reached the gate
//   bag slot-score rows: 0                                   <- never scored
//
// The suitability gate never ran for `bag`, suppressedFinishingSlots stayed empty, and "add
// a small evening bag or clutch" vanished — though the outfit plainly had no bag. The same
// silence covered a closet owning no bags at all, which is why O4 never got one either.
//
// The rule is now the outcome: a supported finishing slot missing from the finished outfit
// is described, whatever emptied it. Two things keep it narrow — getMissingFinishingSlots
// reports shoe and bag only, so accessory and jewelry still disappear cleanly (015c60c), and
// the explicit formalityConditional guard leaves casual and default sessions untouched,
// which is what preserves this function's long-standing top/bottom-only contracts.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  buildCompletionLayer,
  selectAdditionalClosetGarments,
  getMissingFinishingSlots,
} from "../ai/styleme-result.server.js";
import type {
  ClosetAnchorInput, NormalizedClosetAnchor, StyleMeSessionInput,
} from "../ai/styleme-recommendation.types.js";

const S = (occasion: string, formalityConditional: string | null): StyleMeSessionInput => ({
  moods: [], desiredFeelings: [], bodyNeeds: ["nothing-specific"], coverageConditional: null,
  occasion, formalityConditional, todayColours: { preferred: [], avoid: [] },
  practicalIds: [], source: "my-closet", state: "nothing-in-particular", intentions: [],
} as unknown as StyleMeSessionInput);

const anchorAt = (slot: string) => ({
  type: "closet", id: "anchor", slot, label: "anchor",
  colors: ["black"], material: null, styleTags: [], imageUrl: null,
} as unknown as NormalizedClosetAnchor);

/** Completion slots produced for an assembled outfit. `suppressed` is now diagnostic only. */
const layer = (
  anchorSlot: string,
  filled: string[],
  session: StyleMeSessionInput,
  suppressed: Array<"shoe" | "bag"> = [],
) => buildCompletionLayer(
  anchorAt(anchorSlot), null, session, filled.map((slot) => ({ slot })), undefined, suppressed,
).map((p) => p.slot);

const DRESSY_EVENT = S("special-event", "formality-occasion");
const DRESSY_NIGHT = S("girls-night", "formality-occasion");

function g(o: Partial<ClosetAnchorInput> & { id: string; category: string }): ClosetAnchorInput {
  return {
    type: "closet", name: o.id, subcategory: null, colors: ["black"], primaryColor: "black",
    pattern: null, material: null, styleTags: [], occasions: ["formal", "party"], imageUrl: null,
    garmentRelationships: [], formality: "business-formal", fitProfile: null, waistShape: null,
    sleeveLength: null, necklineCoverage: null, hemLength: null, topLength: null,
    shoulderCoverage: null, midriffExposed: null, silhouette: null, stylePersonality: null,
    approvedProfile: { occasionFit: { event: "Strong" }, dressRegister: "evening" } as never,
    ...o,
  } as ClosetAnchorInput;
}

// ── CO-A: a missing bag is described whatever emptied the slot ───────────────

describe("CO-A — the outcome decides, not the cause", () => {
  test("CO-A.1 bag rejected by finishing suitability → bag suggestion", () => {
    // The case that always worked: suitability reported the suppression.
    assert.deepEqual(layer("outerwear", ["top", "bottom", "shoe"], DRESSY_NIGHT, ["bag"]), ["bag"]);
  });

  test("CO-A.2 bag rejected upstream, nothing reported suppressed → bag suggestion", () => {
    // The ST15 regression: suppressed is empty because the bag never reached the gate.
    assert.deepEqual(layer("dress", ["shoe", "jewelry", "outerwear"], DRESSY_EVENT, []), ["bag"]);
  });

  test("CO-A.3 end to end: a bag rated No for `event` is excluded upstream, and still suggested", () => {
    const items = [
      g({ id: "gown", category: "DRESSES", formality: "evening" }),
      g({ id: "pump", category: "SHOES", formality: "business-formal" }),
      // C1 makes this a hard exclusion at the occasion gate, before scoring.
      g({ id: "tote", category: "BAGS", formality: "business-casual",
        approvedProfile: { occasionFit: { event: "No" }, dressRegister: "smart-casual" } as never }),
    ];
    const picked = selectAdditionalClosetGarments(
      anchorAt("dress"), null, DRESSY_EVENT, items, null);
    assert.ok(!picked.some((p) => p.slot === "bag"),
      `the No-rated bag must not be selected; got ${JSON.stringify(picked.map((p) => p.slot))}`);
    const slots = buildCompletionLayer(
      anchorAt("dress"), null, DRESSY_EVENT, picked, undefined, [],
    ).map((p) => p.slot);
    assert.ok(slots.includes("bag"), `expected a bag suggestion; got ${JSON.stringify(slots)}`);
  });

  test("CO-A.4 no bag owned at all → bag suggestion (the O4 shape)", () => {
    assert.ok(layer("outerwear", ["top", "shoe"], DRESSY_NIGHT, []).includes("bag"));
  });

  test("CO-A.5 a missing shoe after an upstream rejection → shoe suggestion", () => {
    assert.ok(layer("dress", ["bag", "jewelry"], DRESSY_EVENT, []).includes("shoe"));
  });

  test("CO-A.6 exactly one suggestion per missing slot, never duplicated", () => {
    const slots = layer("outerwear", ["top", "bottom", "shoe"], DRESSY_NIGHT, ["bag"]);
    assert.equal(slots.filter((s) => s === "bag").length, 1);
  });
});

// ── CO-B: filled slots stay quiet ───────────────────────────────────────────

describe("CO-B — a filled slot is never described", () => {
  test("CO-B.1 an owned bag in the outfit → no bag suggestion", () => {
    assert.ok(!layer("dress", ["shoe", "bag"], DRESSY_EVENT, []).includes("bag"));
  });

  test("CO-B.2 an owned shoe in the outfit → no shoe suggestion", () => {
    assert.ok(!layer("dress", ["shoe", "bag"], DRESSY_EVENT, []).includes("shoe"));
  });

  test("CO-B.3 a slot filled by the anchor counts as filled", () => {
    assert.ok(!layer("shoe", ["bag"], DRESSY_EVENT, []).includes("shoe"),
      "getMissingFinishingSlots folds the anchor slot into `present`");
  });

  test("CO-B.4 both filled → no finishing suggestions at all", () => {
    assert.deepEqual(layer("dress", ["shoe", "bag"], DRESSY_EVENT, []), []);
  });
});

// ── CO-C: scope stays shoe and bag ──────────────────────────────────────────

describe("CO-C — accessory and jewelry are never suggested", () => {
  test("CO-C.1 a missing accessory produces no suggestion", () => {
    const slots = layer("dress", ["shoe", "bag"], DRESSY_EVENT, []);
    assert.ok(!slots.includes("accessory"), `got ${JSON.stringify(slots)}`);
  });

  test("CO-C.2 a missing jewel produces no suggestion", () => {
    const slots = layer("dress", ["shoe", "bag"], DRESSY_EVENT, []);
    assert.ok(!slots.includes("jewelry"), `got ${JSON.stringify(slots)}`);
  });

  test("CO-C.3 the helper itself reports shoe and bag only", () => {
    assert.deepEqual(getMissingFinishingSlots(null, []), ["shoe", "bag"]);
    assert.deepEqual(getMissingFinishingSlots(null, [{ slot: "shoe" }, { slot: "bag" }]), []);
  });
});

// ── CO-D: the formalityConditional guard ────────────────────────────────────

describe("CO-D — sessions that never asked for a register are untouched", () => {
  test("CO-D.1 no explicit formality answer → no finishing suggestions", () => {
    assert.deepEqual(layer("dress", ["jewelry"], S("everyday", null), []), []);
  });

  test("CO-D.2 the same outfit WITH an explicit answer does get them", () => {
    const slots = layer("dress", ["jewelry"], S("girls-night", "formality-occasion"), []);
    assert.ok(slots.includes("shoe") && slots.includes("bag"));
  });

  test("CO-D.3 top/bottom completion is unaffected by the guard", () => {
    // An outerwear anchor with no base pieces still reports the missing bottom, as it always
    // has, whether or not a formality answer exists.
    assert.ok(layer("outerwear", ["top", "shoe", "bag"], S("everyday", null), []).includes("bottom"));
    assert.ok(layer("outerwear", ["top", "shoe", "bag"], DRESSY_NIGHT, []).includes("bottom"));
  });
});

// ── CO-E: the suggestion does not also render in Finishing Layer ────────────

describe("CO-E — duplicate-render protection still holds", () => {
  test("CO-E.1 a generated BAG finishing entry is suppressed when the layer describes bag", () => {
    // Mirrors isDuplicateOfCompletionSuggestion in result.tsx (64f41e4).
    const SLOT_TO_TYPE: Record<string, string> = {
      shoe: "SHOES", bag: "BAG", accessory: "ACCESSORY", jewelry: "ACCESSORY",
    };
    const completion = layer("dress", ["shoe", "jewelry", "outerwear"], DRESSY_EVENT, []);
    assert.deepEqual(completion, ["bag"], "precondition: the layer describes the bag");
    const isDup = (item: { itemType: string; closetItemId: string | null }) =>
      item.closetItemId ? false : completion.some((s) => SLOT_TO_TYPE[s] === item.itemType);
    assert.equal(isDup({ itemType: "BAG", closetItemId: null }), true, "generated bag card hidden");
    assert.equal(isDup({ itemType: "BAG", closetItemId: "owned" }), false, "an owned bag still shows");
    assert.equal(isDup({ itemType: "SHOES", closetItemId: null }), false, "the shoe is filled, so not covered");
  });
});
