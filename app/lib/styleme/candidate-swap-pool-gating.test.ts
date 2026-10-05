// app/lib/styleme/candidate-swap-pool-gating.test.ts
//
// THE INVARIANT: if an owned garment is rejected by the hard eligibility gates, it cannot
// re-enter the look through candidate B, C, D or E.
//
// That invariant is already written down at styleme-result.server.ts — "an item A rejected
// cannot re-enter through an alternative" — but it was only implemented for the finishing
// SUITABILITY predicate. The three hard profile gates live exclusively inside
// selectAdditionalClosetGarments, which builds candidate A:
//
//   if (!passesDressingRequirements(...))          continue;
//   if (!passesProfileOccasionGate(...))           continue;   // approved "No" is a HARD exclusion
//   if (!passesProfileRegisterGate(...))           continue;   // athletic / evening / range
//   if (!passesRegisterCoherenceWithAnchor(...))   continue;
//
// B scans raw `allItems`; its fallback branch scans raw `allItems` with even fewer checks
// (no altSlotSuitable); E scans `dressingEligibleItems`, which is `allItems` filtered by
// dressing requirements ALONE — and not even that when the customer has no dressing
// preferences. D inherits B. Only C is safe, because it is A minus its outerwear.
//
// Three live QA reproductions, all owned-closet garments, all offered to the model:
//   Active       cand E  White Oxford (occasionFit.active = "No") + business-formal trousers
//   Date night   cand B/D Beige Chino Trousers (occasionFit.date = "No")
//   Night out    cand E  athletic running shoes, formality unset
//
// WHY `formality: null` MATTERS (CSG-B). The real Night out garment carried no formality
// value, so finishingPieceIsSuitable(null, ...) fails open by design — an absent signal must
// never remove a garment. That is correct for the suitability rule and useless as a safety
// net: the only thing that should have excluded an athletic shoe from a Polished night out
// is the register gate, which the swap pools never consulted.
//
// WHAT "the model cannot select it" MEANS (CSG-D). The model chooses by id from the
// candidates it is handed, and computeStyleMeResult persists whichever it names. So the
// enforceable claim is about the OFFERED SET: if no candidate contains a rejected garment,
// none can be selected or persisted. CSG-D asserts that directly — it captures the
// candidates reaching _callNaiaSelection and has the mock deliberately hunt for a
// contaminated one to pick.
//
// FIXTURE NOTES, learned the hard way on this codebase:
//   - occasionFit is keyed on the ADMIN vocabulary, so girls-night is stored as "night-out"
//     and date-night as "date". Writing the canonical spelling tests nothing.
//   - dressRegister must match the garment's own register; mislabelling it makes the
//     pre-existing register gate reject the piece and looks like this rule misfiring.
//   - `occasions` must contain a token from SESSION_OCCASION_TO_CLOSET_TOKENS for the session
//     occasion, or the item scores <= 0 and is dropped before any gate is reached. The token
//     vocabulary is a THIRD spelling, distinct from both the session ID and the admin key:
//         girls-night -> ["evening", "girls-night"]      NOT "night-out"
//         date-night  -> ["date-night"]                  NOT "date"
//         dinner      -> ["evening", "dinner"]
//         active      -> ["active", "gym", "athletic", "sport"]
//     The first draft of this file used "night-out" for girls-night; every item scored <= 0,
//     was dropped before reaching a gate, and three tests passed while proving nothing.
//   - category tokens are plural: SHOES, BOTTOMS, TOPS, ACCESSORIES.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  buildNaiaOutfitCandidates,
  computeStyleMeResult,
  selectAdditionalClosetGarments,
} from "../ai/styleme-result.server.js";
import {
  passesDressingRequirements,
  passesProfileOccasionGate,
  passesProfileRegisterGate,
  passesRegisterCoherenceWithAnchor,
} from "../ai/styleme-profile-gate.js";
import type {
  ClosetAnchorInput, NormalizedClosetAnchor, StyleMeSessionInput, OutfitCandidate,
} from "../ai/styleme-recommendation.types.js";

// ── fixture builders ────────────────────────────────────────────────────────

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

const S = (occasion: string, formalityConditional: string | null, bodyNeeds = ["nothing-specific"]): StyleMeSessionInput => ({
  moods: [], desiredFeelings: [], bodyNeeds, coverageConditional: null,
  occasion, formalityConditional, todayColours: { preferred: [], avoid: [] },
  practicalIds: [], source: "my-closet", state: "nothing-in-particular", intentions: [],
} as unknown as StyleMeSessionInput);

const A = (id: string, slot: string) => ({
  type: "closet", id, slot, label: id, colors: ["black"], material: null, styleTags: [], imageUrl: null,
} as unknown as NormalizedClosetAnchor);

const build = (anchor: NormalizedClosetAnchor, sess: StyleMeSessionInput, items: ClosetAnchorInput[]) =>
  buildNaiaOutfitCandidates(anchor, sess, items, undefined, undefined)
    .filter((c): c is OutfitCandidate => c !== null);

/** Every closetId appearing in any candidate, tagged with the candidate it came from. */
const allPieces = (cands: OutfitCandidate[]) =>
  cands.flatMap((c) => c.pieces.map((p) => ({ cand: c.id, id: p.closetId, slot: p.slot })));

/** The real gates, run exactly as selectAdditionalClosetGarments runs them for candidate A. */
function hardGatesPass(
  item: ClosetAnchorInput,
  anchorItem: ClosetAnchorInput | null,
  occasion: string,
  dressingPreferences: readonly string[] | null,
): boolean {
  return passesDressingRequirements(item, dressingPreferences)
    && passesProfileOccasionGate(item, occasion)
    && passesProfileRegisterGate(item, occasion)
    && passesRegisterCoherenceWithAnchor(item, anchorItem, occasion);
}

// ── CSG-A: an approved "No" cannot re-enter through an alternative ──────────
//
// Dinner + Smart casual, band {2,3}. Two bottoms, identical but for the reviewer's rating.
// A can only take the approved one — Gate 1 removes the other before scoring. B then looks
// for a bottom alternative, finds the rejected one as the ONLY other bottom, and swaps it in.

describe("CSG-A — a garment rejected by occasionFit cannot appear in B/C/D/E", () => {
  const items = [
    g({ id: "top-ok",  category: "TOPS",    occasions: ["dinner"], formality: "smart-casual",
        approvedProfile: prof("smart-casual", { dinner: "Strong" }) }),
    g({ id: "btm-ok",  category: "BOTTOMS", occasions: ["dinner"], formality: "smart-casual",
        approvedProfile: prof("smart-casual", { dinner: "Strong" }) }),
    g({ id: "btm-no",  category: "BOTTOMS", occasions: ["dinner"], formality: "smart-casual",
        approvedProfile: prof("smart-casual", { dinner: "No" }) }),
    g({ id: "shoe-ok", category: "SHOES",   occasions: ["dinner"], formality: "smart-casual",
        approvedProfile: prof("smart-casual", { dinner: "Strong" }) }),
  ];
  const sess = S("dinner", "formality-smart");
  const anchor = A("top-ok", "top");

  test("CSG-A.1 candidate A never contains the rejected bottom (the gate that already works)", () => {
    const picked = selectAdditionalClosetGarments(anchor, null, sess, items, null).map((p) => p.id);
    assert.ok(!picked.includes("btm-no"), `A must not carry btm-no; got ${picked.join(",")}`);
    assert.ok(picked.includes("btm-ok"), `A should carry the approved bottom; got ${picked.join(",")}`);
  });

  test("CSG-A.2 NO candidate contains the rejected bottom", () => {
    const pieces = allPieces(build(anchor, sess, items));
    const offenders = pieces.filter((p) => p.id === "btm-no");
    assert.deepEqual(
      offenders, [],
      `btm-no is rejected by occasionFit and must not re-enter; found in ${offenders.map((o) => o.cand).join(",")}`,
    );
  });

  test("CSG-A.3 every owned piece in every candidate passes all four hard gates", () => {
    const byId = new Map(items.map((i) => [i.id, i]));
    const anchorItem = byId.get("top-ok") ?? null;
    for (const p of allPieces(build(anchor, sess, items))) {
      const item = byId.get(p.id);
      if (!item) continue;
      if (item.id === anchor.id) continue;             // anchor validated separately
      assert.ok(
        hardGatesPass(item, anchorItem, sess.occasion, null),
        `candidate ${p.cand} carries ${p.id} in slot ${p.slot}, which fails a hard gate`,
      );
    }
  });
});

// ── CSG-B: athletic footwear on a Polished night out ────────────────────────
//
// Exercises B's FALLBACK branch specifically: the per-slot winners all match A (there is
// one approved shoe and one approved bottom), so bDiffersFromA stays false and B falls
// through to the fallback, which applies neither altSlotSuitable nor any hard gate.
//
// The shoe carries formality: null — the real Night out failure shape. The suitability
// predicate fails open on an absent signal by design, so it offers no protection here;
// only passesProfileRegisterGate can exclude an athletic register from a non-active occasion.

describe("CSG-B — athletic footwear cannot enter a Polished night-out candidate", () => {
  const items = [
    g({ id: "top-ok",   category: "TOPS",    occasions: ["evening"], formality: "business-casual",
        approvedProfile: prof("smart-casual", { "night-out": "Strong" }) }),
    g({ id: "btm-ok",   category: "BOTTOMS", occasions: ["evening"], formality: "business-formal",
        approvedProfile: prof("polished", { "night-out": "Strong" }) }),
    g({ id: "shoe-ok",  category: "SHOES",   occasions: ["evening"], formality: "business-formal",
        approvedProfile: prof("polished", { "night-out": "Strong" }) }),
    // The offender: athletic register, no formality value, no approval for this occasion.
    g({ id: "shoe-ath", category: "SHOES",   occasions: ["evening"], formality: null,
        approvedProfile: prof("athletic", {}) }),
  ];
  const sess = S("girls-night", "formality-polished");
  const anchor = A("top-ok", "top");

  test("CSG-B.1 candidate A never carries the athletic shoe", () => {
    const picked = selectAdditionalClosetGarments(anchor, null, sess, items, null).map((p) => p.id);
    assert.ok(!picked.includes("shoe-ath"), `A must not carry shoe-ath; got ${picked.join(",")}`);
  });

  test("CSG-B.2 NO candidate carries the athletic shoe", () => {
    const shoes = allPieces(build(anchor, sess, items)).filter((p) => p.slot === "shoe");
    const offenders = shoes.filter((p) => p.id === "shoe-ath");
    assert.deepEqual(
      offenders, [],
      `an athletic shoe must not reach a Polished night out; found in ${offenders.map((o) => o.cand).join(",")}`,
    );
  });

  test("CSG-B.3 the register gate — not the suitability rule — is what must exclude it", () => {
    // Pins the reason, so a future change that makes suitability do this work by accident
    // does not disguise the hard gate being absent again.
    const ath = items.find((i) => i.id === "shoe-ath")!;
    assert.equal(ath.formality, null, "fixture must keep the real formality-unset shape");
    assert.equal(
      passesProfileRegisterGate(ath, "girls-night"), false,
      "the register gate is the only gate that can exclude this garment",
    );
  });
});

// ── CSG-C: the fix must gate, not empty ────────────────────────────────────
//
// The real risk of filtering a swap pool is losing variation. With two genuinely approved
// bottoms, B must still exist and must still differ from A. This test is expected to pass
// both before and after the fix — it is the guard against over-correction.

describe("CSG-C — valid approved alternatives still produce diversity", () => {
  const items = [
    g({ id: "top-ok",  category: "TOPS",    occasions: ["evening"], formality: "business-casual",
        approvedProfile: prof("smart-casual", { "night-out": "Strong" }) }),
    g({ id: "btm-1",   category: "BOTTOMS", occasions: ["evening"], formality: "business-formal",
        approvedProfile: prof("polished", { "night-out": "Strong" }) }),
    g({ id: "btm-2",   category: "BOTTOMS", occasions: ["evening"], formality: "business-formal",
        approvedProfile: prof("polished", { "night-out": "Strong" }), colors: ["navy"], primaryColor: "navy" }),
    g({ id: "shoe-ok", category: "SHOES",   occasions: ["evening"], formality: "business-formal",
        approvedProfile: prof("polished", { "night-out": "Strong" }) }),
  ];
  const sess = S("girls-night", "formality-polished");
  const anchor = A("top-ok", "top");

  test("CSG-C.1 more than one candidate is produced", () => {
    const cands = build(anchor, sess, items);
    assert.ok(cands.length >= 2, `expected an alternative; got ${cands.map((c) => c.id).join(",") || "none"}`);
  });

  test("CSG-C.2 both approved bottoms are reachable across the candidate set", () => {
    const bottoms = new Set(
      allPieces(build(anchor, sess, items)).filter((p) => p.slot === "bottom").map((p) => p.id),
    );
    assert.ok(bottoms.has("btm-1") || bottoms.has("btm-2"), "at least one approved bottom must appear");
    assert.equal(bottoms.size, 2, `both approved bottoms should be offered; got ${[...bottoms].join(",")}`);
  });
});

// ── CSG-D: the model cannot select or persist a contaminated candidate ─────
//
// Drives the real pipeline through its DI seams — _loadClosetItems for the closet and
// _callNaiaSelection for the model — so no database or network is touched. The mock
// deliberately tries to pick a contaminated candidate, which is the adversarial form of
// the claim: the protection must come from the offered set, not from the model's taste.
//
// HONEST STATUS: this group passes BOTH before and after the fix, so it is a standing
// guard rather than red proof. Calling buildNaiaOutfitCandidates directly with these exact
// inputs does produce a contaminated B, but something between construction and selection
// drops B in this particular pipeline configuration, so only A is ever offered here. I did
// not contrive a fixture to force it — the red proof for this defect lives at the builder
// level in CSG-A, CSG-B and CSG-E, which is where the defect is. What CSG-D adds is a lock
// on the end-to-end path: if a future change starts offering a contaminated candidate, an
// adversarial model picks it and this fails.

describe("CSG-D — a contaminated candidate cannot be offered, selected or persisted", () => {
  const anchorItem: ClosetAnchorInput = g({
    id: "d-top-ok", category: "TOPS", occasions: ["dinner"], formality: "smart-casual",
    approvedProfile: prof("smart-casual", { dinner: "Strong" }),
  });
  const items = [
    anchorItem,
    g({ id: "d-btm-ok", category: "BOTTOMS", occasions: ["dinner"], formality: "smart-casual",
        approvedProfile: prof("smart-casual", { dinner: "Strong" }) }),
    g({ id: "d-btm-no", category: "BOTTOMS", occasions: ["dinner"], formality: "smart-casual",
        approvedProfile: prof("smart-casual", { dinner: "No" }) }),
    g({ id: "d-shoe-ok", category: "SHOES", occasions: ["dinner"], formality: "smart-casual",
        approvedProfile: prof("smart-casual", { dinner: "Strong" }) }),
  ];

  const run = async () => {
    const offered: OutfitCandidate[][] = [];
    const mock = (async (candidates: OutfitCandidate[]) => {
      offered.push(candidates);
      // Adversarial: pick the contaminated candidate if one is on offer.
      const bad = candidates.find((c) => c.pieces.some((p) => p.closetId === "d-btm-no"));
      const chosen = bad ?? candidates[0];
      return {
        candidate: chosen,
        wording: {
          outfitName: "Test Look", whyThisWorks: "Mocked for the swap-pool gating test.",
          confidenceBoost: "Mocked.", perfumeNote: null,
        },
        perPieceNotes: new Map(chosen.pieces.map((p) => [p.closetId, `note ${p.slot}`])),
      };
    }) as unknown as Parameters<typeof computeStyleMeResult>[5];

    const result = await computeStyleMeResult(
      { session: S("dinner", "formality-smart"), anchor: anchorItem, mode: "naia", recentlyShownClosetIds: [] } as unknown as Parameters<typeof computeStyleMeResult>[0],
      undefined, undefined, false,
      async () => items,
      mock,
    );
    return { offered, result };
  };

  test("CSG-D.1 the rejected bottom is in none of the candidates handed to the model", async () => {
    const { offered } = await run();
    assert.ok(offered.length > 0, "the model selection seam must be reached");
    for (const set of offered) {
      for (const c of set) {
        assert.ok(
          !c.pieces.some((p) => p.closetId === "d-btm-no"),
          `candidate ${c.id} was offered to the model carrying the rejected bottom`,
        );
      }
    }
  });

  test("CSG-D.2 the selected look carries no rejected garment", async () => {
    // Scoped to the SELECTED outfit — the "most-you" direction is the candidate the model
    // chose. Asserting over the whole result object instead caught a SECOND, independent
    // bypass in computeNaiaResultDirections, which builds the "fresh" and "push-me" cards
    // straight from the closet array with no hard gates at all. That path is not owned by
    // this commit and is tracked separately; widening this assertion here would make this
    // test fail for a defect this fix does not claim to address.
    const { result } = await run();
    const selected = (result as unknown as { resultDirections?: Array<{ label: string; outfitPieces?: Array<{ id: string }> }> })
      .resultDirections?.find((d) => d.label === "most-you");
    assert.ok(selected, "the selected look must be present as the most-you direction");
    const ids = (selected!.outfitPieces ?? []).map((p) => p.id);
    assert.ok(
      !ids.includes("d-btm-no"),
      `the selected look carries the rejected bottom; pieces: ${ids.join(",")}`,
    );
  });
});

// ── CSG-E: the three live sessions ─────────────────────────────────────────
//
// Property check rather than an engineered failure: for each session, EVERY owned piece in
// EVERY candidate must pass all four hard gates. Fixtures mirror the shapes the live traces
// showed, including the detail that Active asks no dressiness question — which switches
// altSuitabilityActive off and leaves the Active swap pools with no formality check at all.

describe("CSG-E — Active, Date night and Girls night carry only gate-passing owned pieces", () => {
  const omar = [
    // athletic core — approved for active only
    g({ id: "track-jacket", category: "OUTERWEAR", subcategory: "track jacket", occasions: ["active", "gym"], formality: "casual",
        approvedProfile: prof("athletic", { active: "Strong", date: "No", "night-out": "No" }) }),
    g({ id: "nike-tee",     category: "TOPS",    occasions: ["active", "gym"], formality: "casual",
        approvedProfile: prof("athletic", { active: "Strong", date: "No", "night-out": "No" }) }),
    g({ id: "joggers",      category: "BOTTOMS", occasions: ["active", "gym"], formality: "casual",
        approvedProfile: prof("athletic", { active: "Strong", date: "No", "night-out": "No" }) }),
    g({ id: "run-sneakers", category: "SHOES",   occasions: ["active", "gym", "evening", "date-night"], formality: null,
        approvedProfile: prof("athletic", { active: "Strong" }) }),
    // smart core — approved for date/night-out, explicitly NOT for active
    g({ id: "oxford",       category: "TOPS",    occasions: ["active", "date-night", "evening"], formality: "business-casual",
        approvedProfile: prof("smart-casual", { active: "No", date: "Acceptable", "night-out": "Acceptable" }) }),
    g({ id: "navy-trousers", category: "BOTTOMS", occasions: ["active", "date-night", "evening"], formality: "business-formal",
        approvedProfile: prof("polished", { active: "No", date: "No", "night-out": "No" }) }),
    g({ id: "straight-jeans", category: "BOTTOMS", occasions: ["date-night", "active"], formality: "casual",
        approvedProfile: prof("casual", { date: "Strong", active: "No", "night-out": "No" }) }),
    g({ id: "loafers",      category: "SHOES",   occasions: ["date-night", "evening"], formality: "business-casual",
        approvedProfile: prof("smart-casual", { date: "Acceptable", "night-out": "Acceptable", active: "No" }) }),
  ];

  const scenarios = [
    { name: "Active / busy day",  sess: S("active", null, ["still-want-shape"]),                    anchorId: "track-jacket", slot: "outerwear" },
    { name: "Date night",         sess: S("date-night", "formality-smart", ["still-want-shape"]),   anchorId: "oxford",       slot: "top" },
    { name: "Girls night",        sess: S("girls-night", "formality-polished", ["still-want-shape"]), anchorId: "oxford",     slot: "top" },
  ];

  for (const sc of scenarios) {
    test(`CSG-E ${sc.name} — no candidate carries a hard-gate-rejected owned piece`, () => {
      const byId = new Map(omar.map((i) => [i.id, i]));
      const anchorItem = byId.get(sc.anchorId) ?? null;
      const cands = build(A(sc.anchorId, sc.slot), sc.sess, omar);
      assert.ok(cands.length > 0, `${sc.name} must still produce at least one candidate`);
      const bad: string[] = [];
      for (const p of allPieces(cands)) {
        const item = byId.get(p.id);
        if (!item || item.id === sc.anchorId) continue;
        if (!hardGatesPass(item, anchorItem, sc.sess.occasion, null)) {
          bad.push(`${p.cand}:${p.slot}:${p.id}`);
        }
      }
      assert.deepEqual(bad, [], `${sc.name} offered rejected pieces: ${bad.join(", ")}`);
    });
  }
});
