// app/lib/styleme/direction-card-gating.test.ts
//
// THE INVARIANT: no owned garment rejected by the hard eligibility gates may appear in
// FRESH TWIST or PUSH ME — not as `product.handle`, and not in `outfitPieces`.
//
// computeNaiaResultDirections builds MOST LIKE ME / FRESH TWIST / PUSH ME from the
// customer's closet. Its intake loop applied three checks and no hard gates at all:
//
//   if (item.id === anchorId) continue;
//   if (slot === "unknown")   continue;
//   if (score <= 0)           continue;
//
// So the four gates that protect candidate A — dressing requirements, the approved
// occasion gate, the register gate, register coherence with the anchor — never ran here.
//
// WHY THIS PATH IS WORSE THAN THE CANDIDATE BYPASS. The candidate bypass fixed in the
// previous commit put rejected garments in front of the MODEL, which then had to choose
// them for any harm to occur. These cards have no such filter: whatever lands in the
// per-slot lists is rendered to the customer as a labelled alternative look.
//
// AND THE CARDS REACH FOR EXACTLY THE WRONG ITEM. MOST LIKE ME takes the best-scoring
// piece per slot; FRESH and PUSH ME deliberately index PAST it to produce variation. A
// rejected garment that scores second in its slot is therefore not an unlikely edge case —
// it is precisely what these two cards select. That is how a trouser a reviewer had rated
// occasionFit "No" became both the FRESH lead and the PUSH ME lead in the same result.
//
// FIXTURE NOTES (same traps as the swap-pool file):
//   - `occasions` must carry a SESSION_OCCASION_TO_CLOSET_TOKENS token or the item scores
//     <= 0 and is dropped by the intake loop before any gate could matter:
//         dinner -> ["evening", "dinner"]   girls-night -> ["evening", "girls-night"]
//   - occasionFit is keyed on the ADMIN vocabulary: "date", "event", "night-out".
//   - category tokens are plural: TOPS, BOTTOMS, SHOES.
//   - the rejected item needs a LOWER score than the approved one so it sorts second and
//     the variation cards index onto it. Fewer matching occasion tokens does that.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { computeNaiaResultDirections } from "../ai/styleme-result.server.js";
import {
  passesDressingRequirements,
  passesProfileOccasionGate,
  passesProfileRegisterGate,
  passesRegisterCoherenceWithAnchor,
} from "../ai/styleme-profile-gate.js";
import type { ClosetAnchorInput, StyleMeSessionInput } from "../ai/styleme-recommendation.types.js";

const prof = (dressRegister: string, occasionFit: Record<string, string>) =>
  ({ dressRegister, occasionFit }) as unknown as ClosetAnchorInput["approvedProfile"];

function g(o: Partial<ClosetAnchorInput> & { id: string; category: string }): ClosetAnchorInput {
  return {
    type: "closet", name: o.id, subcategory: null, colors: ["black"], primaryColor: "black",
    pattern: null, material: null, styleTags: [], occasions: [],
    imageUrl: null, garmentRelationships: [], formality: "business-casual", fitProfile: null,
    waistShape: null, sleeveLength: null, necklineCoverage: null, hemLength: null, topLength: null,
    shoulderCoverage: null, midriffExposed: null, silhouette: null, stylePersonality: null,
    approvedProfile: null, ...o,
  } as ClosetAnchorInput;
}

const sess = (occasion: string): Pick<StyleMeSessionInput, "occasion" | "moods" | "desiredFeelings"> =>
  ({ occasion, moods: [], desiredFeelings: [] });

function hardGatesPass(
  item: ClosetAnchorInput,
  anchorItem: ClosetAnchorInput | null,
  occasion: string,
): boolean {
  return passesDressingRequirements(item, null)
    && passesProfileOccasionGate(item, occasion)
    && passesProfileRegisterGate(item, occasion)
    && passesRegisterCoherenceWithAnchor(item, anchorItem, occasion);
}

/** Flattens every garment reference a direction can show the customer. */
const referenced = (d: { product?: { handle?: string } | null; outfitPieces?: Array<{ id: string }> }) => [
  ...(d.product?.handle ? [d.product.handle] : []),
  ...(d.outfitPieces ?? []).map((p) => p.id),
];

// ── DCG-A: Dinner — the reviewer's "No" must not reach a card ───────────────
//
// btm-no scores below btm-ok (one matching occasion token against two), so it sorts second
// in the bottom slot — exactly where FRESH and PUSH ME look for their variation.

describe("DCG-A — a rejected garment reaches neither FRESH nor PUSH ME", () => {
  const anchor = g({ id: "top-ok", category: "TOPS", occasions: ["evening", "dinner"], formality: "smart-casual",
                     approvedProfile: prof("smart-casual", { dinner: "Strong" }) });
  const items = [
    anchor,
    g({ id: "btm-ok",  category: "BOTTOMS", occasions: ["evening", "dinner"], formality: "smart-casual",
        approvedProfile: prof("smart-casual", { dinner: "Strong" }) }),
    g({ id: "btm-no",  category: "BOTTOMS", occasions: ["dinner"], formality: "smart-casual",
        approvedProfile: prof("smart-casual", { dinner: "No" }) }),
    g({ id: "shoe-ok", category: "SHOES",   occasions: ["evening", "dinner"], formality: "smart-casual",
        approvedProfile: prof("smart-casual", { dinner: "Strong" }) }),
  ];
  const dirs = () => computeNaiaResultDirections(items, "top-ok", sess("dinner"), null, undefined);

  test("DCG-A.1 the fixture is wired so a variation card WOULD reach for it", () => {
    // Guards the fixture itself: if btm-no stopped being gate-rejected this file would pass
    // while testing nothing.
    //
    // Deliberately does NOT assert that a variation card exists. The first draft did, and it
    // was satisfiable only by the bug: once btm-no is correctly excluded this fixture has a
    // single eligible bottom, so FRESH and PUSH ME have nothing to vary and are rightly not
    // produced. Against the unfixed code this fixture yielded three cards with btm-no leading
    // two of them, which is what DCG-A.2-A.5 pinned. That variation survives where a
    // legitimate alternative exists is DCG-C's job, on a fixture with two approved bottoms.
    const btmNo = items.find((i) => i.id === "btm-no")!;
    assert.equal(passesProfileOccasionGate(btmNo, "dinner"), false, "btm-no must be gate-rejected");
    assert.ok(dirs().length >= 1, "MOST LIKE ME must still be produced from the approved pieces");
  });

  test("DCG-A.2 FRESH carries no hard-gate-rejected garment", () => {
    const fresh = dirs().find((d) => d.label === "fresh");
    if (!fresh) return;                                   // no FRESH is a valid outcome
    assert.ok(!referenced(fresh).includes("btm-no"),
      `FRESH references btm-no: ${referenced(fresh).join(",")}`);
  });

  test("DCG-A.3 PUSH ME carries no hard-gate-rejected garment", () => {
    const push = dirs().find((d) => d.label === "push-me");
    if (!push) return;
    assert.ok(!referenced(push).includes("btm-no"),
      `PUSH ME references btm-no: ${referenced(push).join(",")}`);
  });

  test("DCG-A.4 no direction's product.handle is a rejected garment", () => {
    for (const d of dirs()) {
      assert.notEqual(d.product?.handle, "btm-no",
        `direction ${d.label} leads with the rejected garment`);
    }
  });

  test("DCG-A.5 every piece of every direction passes all four hard gates", () => {
    const byId = new Map(items.map((i) => [i.id, i]));
    for (const d of dirs()) {
      for (const id of referenced(d)) {
        const item = byId.get(id);
        if (!item || item.id === "top-ok") continue;
        assert.ok(hardGatesPass(item, anchor, "dinner"),
          `direction ${d.label} shows ${id}, which fails a hard gate`);
      }
    }
  });
});

// ── DCG-B: athletic footwear on a Polished night out ───────────────────────

describe("DCG-B — athletic footwear reaches no direction card", () => {
  const anchor = g({ id: "n-top", category: "TOPS", occasions: ["evening", "girls-night"], formality: "business-casual",
                     approvedProfile: prof("smart-casual", { "night-out": "Strong" }) });
  const items = [
    anchor,
    g({ id: "n-btm",      category: "BOTTOMS", occasions: ["evening", "girls-night"], formality: "business-formal",
        approvedProfile: prof("polished", { "night-out": "Strong" }) }),
    g({ id: "n-shoe-ok",  category: "SHOES",   occasions: ["evening", "girls-night"], formality: "business-formal",
        approvedProfile: prof("polished", { "night-out": "Strong" }) }),
    // athletic register, no formality value — the real Night out failure shape
    g({ id: "n-shoe-ath", category: "SHOES",   occasions: ["evening"], formality: null,
        approvedProfile: prof("athletic", {}) }),
  ];
  const dirs = () => computeNaiaResultDirections(items, "n-top", sess("girls-night"), null, undefined);

  test("DCG-B.1 the athletic shoe is gate-rejected and would otherwise be reachable", () => {
    const ath = items.find((i) => i.id === "n-shoe-ath")!;
    assert.equal(ath.formality, null, "fixture must keep the formality-unset shape");
    assert.equal(passesProfileRegisterGate(ath, "girls-night"), false,
      "the register gate is the only gate that can exclude this garment");
  });

  test("DCG-B.2 no direction references the athletic shoe", () => {
    for (const d of dirs()) {
      assert.ok(!referenced(d).includes("n-shoe-ath"),
        `direction ${d.label} references the athletic shoe: ${referenced(d).join(",")}`);
    }
  });
});

// ── DCG-C: the fix must gate, not empty ────────────────────────────────────
//
// Two genuinely approved bottoms must still produce a variation card. Expected to pass
// before and after — the guard against over-correction.

describe("DCG-C — valid alternatives still produce direction cards", () => {
  const anchor = g({ id: "c-top", category: "TOPS", occasions: ["evening", "dinner"], formality: "smart-casual",
                     approvedProfile: prof("smart-casual", { dinner: "Strong" }) });
  const items = [
    anchor,
    g({ id: "c-btm-1", category: "BOTTOMS", occasions: ["evening", "dinner"], formality: "smart-casual",
        approvedProfile: prof("smart-casual", { dinner: "Strong" }) }),
    g({ id: "c-btm-2", category: "BOTTOMS", occasions: ["dinner"], formality: "smart-casual",
        approvedProfile: prof("smart-casual", { dinner: "Acceptable" }) }),
    g({ id: "c-shoe",  category: "SHOES",   occasions: ["evening", "dinner"], formality: "smart-casual",
        approvedProfile: prof("smart-casual", { dinner: "Strong" }) }),
  ];
  const dirs = () => computeNaiaResultDirections(items, "c-top", sess("dinner"), null, undefined);

  test("DCG-C.1 more than one direction is produced", () => {
    assert.ok(dirs().length >= 2, `expected a variation card; got ${dirs().map((d) => d.label).join(",") || "none"}`);
  });

  test("DCG-C.2 both approved bottoms are reachable across the direction set", () => {
    const seen = new Set(dirs().flatMap(referenced));
    assert.ok(seen.has("c-btm-1"), "the best approved bottom must appear");
    assert.ok(seen.has("c-btm-2"), "the second approved bottom must remain reachable as variation");
  });
});

// ── DCG-D: anchor handling and sparse wardrobes ────────────────────────────

describe("DCG-D — anchor preserved, sparse wardrobes degrade cleanly", () => {
  const anchor = g({ id: "d-anchor", category: "TOPS", occasions: ["evening", "dinner"], formality: "smart-casual",
                     approvedProfile: prof("smart-casual", { dinner: "Strong" }) });

  test("DCG-D.1 the anchor is never listed as a direction piece — it is shown separately", () => {
    const items = [anchor,
      g({ id: "d-btm", category: "BOTTOMS", occasions: ["evening", "dinner"], formality: "smart-casual",
          approvedProfile: prof("smart-casual", { dinner: "Strong" }) })];
    const dirs = computeNaiaResultDirections(items, "d-anchor", sess("dinner"), null, undefined);
    for (const d of dirs) {
      assert.ok(!(d.outfitPieces ?? []).some((p) => p.id === "d-anchor"),
        `direction ${d.label} re-lists the anchor`);
    }
  });

  test("DCG-D.2 an anchor that would fail the gates is still not re-admitted as a piece", () => {
    // The anchor is exempt from the intake filter because it is validated upstream and is
    // excluded from these cards anyway. This pins that the exemption does not leak it back
    // in as a direction piece.
    const badAnchor = g({ id: "d-bad-anchor", category: "TOPS", occasions: ["evening", "dinner"],
      formality: "smart-casual", approvedProfile: prof("smart-casual", { dinner: "No" }) });
    const items = [badAnchor,
      g({ id: "d-btm", category: "BOTTOMS", occasions: ["evening", "dinner"], formality: "smart-casual",
          approvedProfile: prof("smart-casual", { dinner: "Strong" }) })];
    const dirs = computeNaiaResultDirections(items, "d-bad-anchor", sess("dinner"), null, undefined);
    for (const d of dirs) {
      assert.ok(!(d.outfitPieces ?? []).some((p) => p.id === "d-bad-anchor"),
        `direction ${d.label} re-admitted the anchor as a piece`);
    }
  });

  test("DCG-D.3 a wardrobe whose only alternatives are rejected yields fewer cards, not bad ones", () => {
    const items = [anchor,
      g({ id: "d-btm-ok", category: "BOTTOMS", occasions: ["evening", "dinner"], formality: "smart-casual",
          approvedProfile: prof("smart-casual", { dinner: "Strong" }) }),
      g({ id: "d-btm-no", category: "BOTTOMS", occasions: ["dinner"], formality: "smart-casual",
          approvedProfile: prof("smart-casual", { dinner: "No" }) })];
    const dirs = computeNaiaResultDirections(items, "d-anchor", sess("dinner"), null, undefined);
    const seen = new Set(dirs.flatMap(referenced));
    assert.ok(!seen.has("d-btm-no"), "a rejected bottom must not be shown to fill a card");
    assert.ok(dirs.length >= 1, "MOST LIKE ME must still be produced from the approved pieces");
  });

  test("DCG-D.4 an empty eligible pool returns no directions rather than throwing", () => {
    const items = [anchor,
      g({ id: "d-only-no", category: "BOTTOMS", occasions: ["dinner"], formality: "smart-casual",
          approvedProfile: prof("smart-casual", { dinner: "No" }) })];
    assert.doesNotThrow(() => computeNaiaResultDirections(items, "d-anchor", sess("dinner"), null, undefined));
    const seen = new Set(computeNaiaResultDirections(items, "d-anchor", sess("dinner"), null, undefined).flatMap(referenced));
    assert.ok(!seen.has("d-only-no"), "the sole rejected alternative must not be shown");
  });
});
