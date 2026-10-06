// app/lib/ai/wardrobe-feedback-evidence.test.ts
// Causal/regression tests for StyleMe-feedback evidence, V1.
// Run with: node --test --import tsx/esm app/lib/ai/wardrobe-feedback-evidence.test.ts
//
// Acceptance bar: Closet + Passport + generation history held constant, only
// explicit StyleMe feedback changes, and a named, documented evidence result
// changes because of it. These tests prove the evidence derivation itself;
// wardrobe-intelligence.test.ts proves the two wiring points (tie-break,
// rediscovery) never exceed their locked scope.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  deriveFormulaEvidence,
  derivePositiveGarmentEvidence,
  deriveSlotChangeAttribution,
  verifyFormulaGarmentIds,
  evidenceTierRank,
  type RawOutcomeFact,
} from "./wardrobe-feedback-evidence.ts";

function outcome(partial: Partial<RawOutcomeFact> & { outcomeId: string }): RawOutcomeFact {
  return {
    suggestionId: `sug-${partial.outcomeId}`,
    outcomeStatus: "wore-it",
    changeTypes: [],
    submittedAt: new Date("2026-09-19T12:00:00.000Z"),
    items: [
      { closetItemId: "top-1", itemType: "TOP", shopifyProductId: null },
      { closetItemId: "bottom-1", itemType: "BOTTOM", shopifyProductId: null },
    ],
    ...partial,
  };
}

describe("§FB-1 genuine repeated positive feedback: SUPPORTED then STRONGLY_SUPPORTED", () => {
  it("1 distinct date is supported, not strongly-supported", () => {
    const ev = deriveFormulaEvidence([outcome({ outcomeId: "a", submittedAt: new Date("2026-09-01T10:00:00Z") })]);
    const [evidence] = [...ev.values()];
    assert.equal(evidence.state, "supported");
    assert.equal(evidence.positiveDates.length, 1);
  });

  it("3 distinct dates reaches strongly-supported", () => {
    const ev = deriveFormulaEvidence([
      outcome({ outcomeId: "a", submittedAt: new Date("2026-09-01T10:00:00Z") }),
      outcome({ outcomeId: "b", submittedAt: new Date("2026-09-10T10:00:00Z") }),
      outcome({ outcomeId: "c", submittedAt: new Date("2026-09-19T10:00:00Z") }),
    ]);
    const [evidence] = [...ev.values()];
    assert.equal(evidence.state, "strongly-supported");
    assert.equal(evidence.positiveDates.length, 3);
  });

  it("2 distinct dates is still only supported — the threshold is exact", () => {
    const ev = deriveFormulaEvidence([
      outcome({ outcomeId: "a", submittedAt: new Date("2026-09-01T10:00:00Z") }),
      outcome({ outcomeId: "b", submittedAt: new Date("2026-09-10T10:00:00Z") }),
    ]);
    const [evidence] = [...ev.values()];
    assert.equal(evidence.state, "supported");
  });

  it("no feedback at all produces no evidence entry", () => {
    const ev = deriveFormulaEvidence([]);
    assert.equal(ev.size, 0);
  });
});

describe("§FB-2 same-day duplicate feedback collapses to one event", () => {
  it("two wore-it outcomes on the same formula, same UTC date, count once — mirrors the real diagnostic-customer case (2 minutes apart)", () => {
    const ev = deriveFormulaEvidence([
      outcome({ outcomeId: "a", submittedAt: new Date("2026-09-19T12:07:02.667Z") }),
      outcome({ outcomeId: "b", submittedAt: new Date("2026-09-19T12:09:05.889Z") }),
    ]);
    const [evidence] = [...ev.values()];
    assert.equal(evidence.positiveDates.length, 1);
    assert.equal(evidence.state, "supported");
  });

  it("the same pair on two different real dates (the diagnostic customer's genuine repeat) counts as two events", () => {
    const ev = deriveFormulaEvidence([
      outcome({ outcomeId: "a", submittedAt: new Date("2026-09-23T12:30:38.598Z") }),
      outcome({ outcomeId: "b", submittedAt: new Date("2026-10-01T06:32:23.333Z") }),
    ]);
    const [evidence] = [...ev.values()];
    assert.equal(evidence.positiveDates.length, 2);
  });
});

describe("§FB-3 same-day conflicting feedback becomes mixed/ambiguous", () => {
  it("wore-it + changed-something on the same formula, same date, contributes to neither positive nor negative", () => {
    const ev = deriveFormulaEvidence([
      outcome({ outcomeId: "a", outcomeStatus: "wore-it", submittedAt: new Date("2026-09-19T09:00:00Z") }),
      outcome({ outcomeId: "b", outcomeStatus: "changed-something", changeTypes: ["different-fit"], submittedAt: new Date("2026-09-19T18:00:00Z") }),
    ]);
    const [evidence] = [...ev.values()];
    assert.equal(evidence.positiveDates.length, 0);
    assert.equal(evidence.negativeDates.length, 0);
    assert.equal(evidence.mixedDates.length, 1);
    assert.equal(evidence.state, "none");
  });

  it("a mixed date does not count toward STRONGLY_SUPPORTED even alongside two genuine positive dates", () => {
    const ev = deriveFormulaEvidence([
      outcome({ outcomeId: "a", outcomeStatus: "wore-it", submittedAt: new Date("2026-09-01T09:00:00Z") }),
      outcome({ outcomeId: "b", outcomeStatus: "wore-it", submittedAt: new Date("2026-09-10T09:00:00Z") }),
      outcome({ outcomeId: "c", outcomeStatus: "wore-it", submittedAt: new Date("2026-09-19T09:00:00Z") }),
      outcome({ outcomeId: "d", outcomeStatus: "changed-something", submittedAt: new Date("2026-09-19T18:00:00Z") }),
    ]);
    const [evidence] = [...ev.values()];
    // 09-19 is mixed (wore-it + changed-something that day), so only 09-01
    // and 09-10 remain positive — 2 distinct dates, not 3.
    assert.equal(evidence.positiveDates.length, 2);
    assert.equal(evidence.state, "supported");
  });
});

describe("§FB-4 wore-it vs changed-something produce different evidence", () => {
  it("wore-it produces positive evidence; changed-something on an otherwise-identical formula produces negative evidence, never positive", () => {
    const woreIt = deriveFormulaEvidence([outcome({ outcomeId: "a", outcomeStatus: "wore-it" })]);
    const changed = deriveFormulaEvidence([outcome({ outcomeId: "b", outcomeStatus: "changed-something", changeTypes: ["different-fit"] })]);
    const [a] = [...woreIt.values()];
    const [b] = [...changed.values()];
    assert.equal(a.state, "supported");
    assert.equal(a.hasNegativeEvidence, false);
    assert.equal(b.state, "none"); // "none"/"supported" is the POSITIVE ladder only
    assert.equal(b.hasNegativeEvidence, true);
    assert.equal(b.negativeDates.length, 1);
  });

  it("didnt-wear-it carries no polarity at all — not positive, not negative", () => {
    const ev = deriveFormulaEvidence([outcome({ outcomeId: "a", outcomeStatus: "didnt-wear-it" })]);
    assert.equal(ev.size, 0);
  });
});

describe("§FB-5 stale/deletion-ambiguous formulas are excluded, not reconstructed", () => {
  it("a formula-relevant slot with closetItemId=null and shopifyProductId=null (a deleted Closet garment) excludes the whole formula", () => {
    const ev = deriveFormulaEvidence([
      outcome({
        outcomeId: "a",
        items: [
          { closetItemId: "top-1", itemType: "TOP", shopifyProductId: null },
          { closetItemId: null, itemType: "BOTTOM", shopifyProductId: null }, // deleted
        ],
      }),
    ]);
    assert.equal(ev.size, 0);
  });

  it("a formula-relevant slot that was always a store-product recommendation (shopifyProductId set) also excludes the whole formula", () => {
    const ev = deriveFormulaEvidence([
      outcome({
        outcomeId: "a",
        items: [
          { closetItemId: "top-1", itemType: "TOP", shopifyProductId: null },
          { closetItemId: null, itemType: "BOTTOM", shopifyProductId: "shopify-prod-9" },
        ],
      }),
    ]);
    assert.equal(ev.size, 0);
  });

  it("a different, fully-verified outcome from the same customer is still used even when another outcome is excluded", () => {
    const ev = deriveFormulaEvidence([
      outcome({
        outcomeId: "a",
        items: [
          { closetItemId: "top-1", itemType: "TOP", shopifyProductId: null },
          { closetItemId: null, itemType: "BOTTOM", shopifyProductId: null }, // excluded
        ],
      }),
      outcome({ outcomeId: "b" }), // default fixture: fully verified
    ]);
    assert.equal(ev.size, 1);
    const [evidence] = [...ev.values()];
    assert.equal(evidence.state, "supported");
  });

  it("verifyFormulaGarmentIds directly: non-clothing slots (shoes/bag) never block verification", () => {
    const ids = verifyFormulaGarmentIds([
      { closetItemId: "top-1", itemType: "TOP", shopifyProductId: null },
      { closetItemId: "bottom-1", itemType: "BOTTOM", shopifyProductId: null },
      { closetItemId: null, itemType: "SHOES", shopifyProductId: "shopify-shoe-1" },
    ]);
    assert.deepEqual(ids, ["bottom-1", "top-1"].sort());
  });
});

describe("§FB-6 ambiguous slot-level changes are never attributed to a garment", () => {
  it("a slot tag matching exactly one item attributes that garment", () => {
    const o = outcome({
      outcomeId: "a",
      outcomeStatus: "changed-something",
      changeTypes: ["top"],
      items: [
        { closetItemId: "top-1", itemType: "TOP", shopifyProductId: null },
        { closetItemId: "bottom-1", itemType: "BOTTOM", shopifyProductId: null },
      ],
    });
    assert.deepEqual(deriveSlotChangeAttribution(o), ["top-1"]);
  });

  it("a slot tag matching ZERO items attributes nothing", () => {
    const o = outcome({
      outcomeId: "a",
      outcomeStatus: "changed-something",
      changeTypes: ["shoes"],
      items: [
        { closetItemId: "top-1", itemType: "TOP", shopifyProductId: null },
        { closetItemId: "bottom-1", itemType: "BOTTOM", shopifyProductId: null },
      ],
    });
    assert.deepEqual(deriveSlotChangeAttribution(o), []);
  });

  it("a slot tag matching MULTIPLE items (e.g. two layers) attributes nothing — genuinely ambiguous", () => {
    const o = outcome({
      outcomeId: "a",
      outcomeStatus: "changed-something",
      changeTypes: ["layer"],
      items: [
        { closetItemId: "outer-1", itemType: "OUTERWEAR", shopifyProductId: null },
        { closetItemId: "outer-2", itemType: "OUTERWEAR", shopifyProductId: null },
      ],
    });
    assert.deepEqual(deriveSlotChangeAttribution(o), []);
  });

  it("a non-slot changeType (fit/formality/colour) never attributes to any garment", () => {
    const o = outcome({
      outcomeId: "a",
      outcomeStatus: "changed-something",
      changeTypes: ["different-fit", "less-formal", "different-colour"],
    });
    assert.deepEqual(deriveSlotChangeAttribution(o), []);
  });

  it("an unverified slot (closetItemId null) never gets attributed even with an otherwise-unambiguous slot match", () => {
    const o = outcome({
      outcomeId: "a",
      outcomeStatus: "changed-something",
      changeTypes: ["top"],
      items: [
        { closetItemId: null, itemType: "TOP", shopifyProductId: "shopify-prod-1" },
        { closetItemId: "bottom-1", itemType: "BOTTOM", shopifyProductId: null },
      ],
    });
    assert.deepEqual(deriveSlotChangeAttribution(o), []);
  });

  it("wore-it outcomes never produce slot-change attribution at all", () => {
    assert.deepEqual(deriveSlotChangeAttribution(outcome({ outcomeId: "a", outcomeStatus: "wore-it" })), []);
  });
});

describe("§FB-7 positive garment evidence (rediscovery input) derives only from verified positive formulas", () => {
  it("every garment in a strongly-supported formula is credited", () => {
    const formulaEv = deriveFormulaEvidence([
      outcome({ outcomeId: "a", submittedAt: new Date("2026-09-01T10:00:00Z") }),
      outcome({ outcomeId: "b", submittedAt: new Date("2026-09-10T10:00:00Z") }),
      outcome({ outcomeId: "c", submittedAt: new Date("2026-09-19T10:00:00Z") }),
    ]);
    const garmentEv = derivePositiveGarmentEvidence(formulaEv);
    assert.ok(garmentEv.has("top-1"));
    assert.ok(garmentEv.has("bottom-1"));
  });

  it("a negative-only (changed-something) formula credits no garment", () => {
    const formulaEv = deriveFormulaEvidence([outcome({ outcomeId: "a", outcomeStatus: "changed-something", changeTypes: ["different-fit"] })]);
    const garmentEv = derivePositiveGarmentEvidence(formulaEv);
    assert.equal(garmentEv.size, 0);
  });
});

describe("§FB-8 evidenceTierRank orders strongly-supported > supported > none", () => {
  it("ranks in the expected order", () => {
    assert.ok(evidenceTierRank("strongly-supported") > evidenceTierRank("supported"));
    assert.ok(evidenceTierRank("supported") > evidenceTierRank("none"));
  });
});
