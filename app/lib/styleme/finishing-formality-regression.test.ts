// app/lib/styleme/finishing-formality-regression.test.ts
//
// RC-D — finishing pieces were exempt from the formality judgement, in both the
// ranking and the selection.
//
// WHAT THE QA LOGS SHOWED (Night out + Dressy, band 4-6 before RC-C)
//
//   [nAia-selection-diag] cand A  within-target  rank 4.740
//     dress      base      evening           Burgundy Cowl Neck Evening Gown
//     shoe       shoe      business-formal   Black Patent Leather Stiletto Pump
//     outerwear  optional  business-formal   Black Tailored Blazer
//     jewelry    optional  smart-casual      Gold Hoop Earrings      <- rank 2 in a 4-6 band
//     bag        optional  business-casual   Black Leather Tote Bag  <- rank 3 in a 4-6 band
//
// Two pieces sat well below the band and neither was counted: PIECE_FORMALITY_WEIGHT
// gave bag, accessory and jewelry a weight of 0. Shoes, at weight 1.0, worked
// correctly in the same run — candidate B's running sneakers were scored
// underdressed and lost. So the mechanism was sound wherever it was switched on.
//
// Selection had the same hole from the other side: registerBonus reads the approved
// GarmentStyleMeProfile and nothing else, so for an unreviewed garment it is always
// 0, and Phase 2 ordered optionals on occasion tags and relationship history alone.
// A frequently-worn business tote wins that contest on familiarity.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  evaluateCompleteOutfit,
  selectAdditionalClosetGarments,
  getTargetFormalityRange,
  FINISHING_PIECE_FORMALITY_WEIGHT,
} from "../ai/styleme-result.server.js";
import type {
  ClosetAnchorInput, NormalizedClosetAnchor, StyleMeSessionInput, OutfitCandidate,
} from "../ai/styleme-recommendation.types.js";

function g(o: Partial<ClosetAnchorInput> & { id: string; category: string }): ClosetAnchorInput {
  return {
    type: "closet", name: o.id, subcategory: null, colors: ["black"], primaryColor: "black",
    pattern: null, material: null, styleTags: [], occasions: ["party"], imageUrl: null,
    garmentRelationships: [], formality: "casual", fitProfile: null, waistShape: null,
    sleeveLength: null, necklineCoverage: null, hemLength: null, topLength: null,
    shoulderCoverage: null, midriffExposed: null, silhouette: null, stylePersonality: null,
    approvedProfile: null, ...o,
  } as ClosetAnchorInput;
}

function session(over: Partial<StyleMeSessionInput> = {}): StyleMeSessionInput {
  return {
    moods: [], desiredFeelings: [], bodyNeeds: ["nothing-specific"], coverageConditional: null,
    occasion: "girls-night", formalityConditional: "formality-occasion",
    todayColours: { preferred: [], avoid: [] }, practicalIds: [], source: "my-closet",
    state: "nothing-in-particular", intentions: [], ...over,
  } as unknown as StyleMeSessionInput;
}

function candidate(id: string, pieces: Array<[string, string]>): OutfitCandidate {
  return { id, pieces: pieces.map(([slot, closetId]) => ({ slot, closetId, label: closetId })) } as unknown as OutfitCandidate;
}

// ── FF-A: the weight is bounded so structure stays dominant ──────────────────

describe("FF-A — finishing pieces are visible but cannot steer the register", () => {
  test("FF-A.1 the whole finishing layer weighs less than one removable layer", () => {
    assert.ok(FINISHING_PIECE_FORMALITY_WEIGHT * 3 < 0.7,
      "bag + accessory + jewelry must not outweigh one outerwear piece");
  });

  test("FF-A.2 one finishing piece weighs less than a fifth of a base garment", () => {
    assert.ok(FINISHING_PIECE_FORMALITY_WEIGHT < 1.0 / 5);
  });

  test("FF-A.3 it is non-zero — the whole point of RC-D", () => {
    assert.ok(FINISHING_PIECE_FORMALITY_WEIGHT > 0);
  });
});

// ── FF-B: 1 — Night out + Dressy prefers the evening-appropriate finish ──────

describe("FF-B — Night out + Dressy, structural pieces equivalent", () => {
  // Band for girls-night + Dressy is 4-5 after RC-C.
  const BAND = getTargetFormalityRange("girls-night", "formality-occasion");
  const structural: Array<[string, string]> = [
    ["dress", "gown"], ["shoe", "pump"],
  ];
  const closet = [
    g({ id: "gown", category: "DRESSES", formality: "occasion" }),
    g({ id: "pump", category: "SHOES", formality: "business-formal" }),
    g({ id: "tote", category: "BAGS", formality: "business-casual" }),   // rank 3 — below band
    g({ id: "clutch", category: "BAGS", formality: "occasion" }),        // rank 5 — in band
  ];

  test("FF-B.1 the band is 4-5", () => {
    assert.deepEqual(BAND, { min: 4, max: 5 });
  });

  test("FF-B.2 the business tote drags the outfit register down; the clutch does not", () => {
    // With a gown (occasion, 5) and a pump (business-formal, 4) there is headroom inside
    // the 4-5 band, so a 0.15-weight bag correctly does NOT flip the fit class — that is
    // the bound working, not a failure. What it must do is move the register, downward:
    // 4.395 with the tote against 4.535 with the clutch.
    const withTote = evaluateCompleteOutfit(candidate("tote", [...structural, ["bag", "tote"]]), closet, session());
    const withClutch = evaluateCompleteOutfit(candidate("clutch", [...structural, ["bag", "clutch"]]), closet, session());
    assert.ok(withTote.outfitFormalityRank! < withClutch.outfitFormalityRank!,
      "a below-band bag must lower the outfit register, not raise it");
    assert.equal(withTote.formalityFit, "within-target", "structure still decides the class");
  });

  test("FF-B.5 and when the structure sits at the band floor, the tote does flip the class", () => {
    // Proves the new visibility is consequential rather than cosmetic. Both structural
    // pieces at business-formal (4) put the outfit exactly on the floor of the 4-5 band.
    const edge = [
      g({ id: "dress4", category: "DRESSES", formality: "business-formal" }),
      g({ id: "pump", category: "SHOES", formality: "business-formal" }),
      g({ id: "tote", category: "BAGS", formality: "business-casual" }),
      g({ id: "clutch", category: "BAGS", formality: "occasion" }),
    ];
    const atEdge: Array<[string, string]> = [["dress", "dress4"], ["shoe", "pump"]];
    const withTote = evaluateCompleteOutfit(candidate("t", [...atEdge, ["bag", "tote"]]), edge, session());
    const withClutch = evaluateCompleteOutfit(candidate("c", [...atEdge, ["bag", "clutch"]]), edge, session());
    assert.equal(withTote.formalityFit, "underdressed");
    assert.equal(withClutch.formalityFit, "within-target");
  });

  test("FF-B.3 the tote was previously invisible — identical outfits before RC-D", () => {
    // Proves the test would not have passed before: with weight 0 both outfits had
    // exactly the same weighted rank, so no ranking could separate them.
    const withTote = evaluateCompleteOutfit(candidate("tote", [...structural, ["bag", "tote"]]), closet, session());
    const withClutch = evaluateCompleteOutfit(candidate("clutch", [...structural, ["bag", "clutch"]]), closet, session());
    assert.notEqual(withTote.outfitFormalityRank, withClutch.outfitFormalityRank);
  });

  test("FF-B.4 selection prefers the evening bag over the business tote", () => {
    const anchor = { type: "closet", id: "gown", slot: "dress", label: "gown",
      colors: ["black"], material: null, styleTags: [], imageUrl: null } as unknown as NormalizedClosetAnchor;
    const picked = selectAdditionalClosetGarments(anchor, null, session(), closet, null);
    const bag = picked.find((p) => p.slot === "bag");
    assert.ok(bag, "a bag should still be selected");
    assert.equal(bag!.id, "clutch");
  });
});

// ── FF-C: 2 — Special event + Dressy still allows the more formal finish ─────

describe("FF-C — Special event + Dressy still admits the most formal finish", () => {
  const sEvent = session({ occasion: "special-event" });
  const closet = [
    g({ id: "gown", category: "DRESSES", formality: "evening", occasions: ["formal"] }),
    g({ id: "pump", category: "SHOES", formality: "business-formal", occasions: ["formal"] }),
    g({ id: "evening-clutch", category: "BAGS", formality: "evening", occasions: ["formal"] }),
    g({ id: "tote", category: "BAGS", formality: "business-casual", occasions: ["formal"] }),
  ];

  test("FF-C.1 the band reaches evening", () => {
    assert.deepEqual(getTargetFormalityRange("special-event", "formality-occasion"), { min: 4, max: 6 });
  });

  test("FF-C.2 an evening clutch is not penalised at a special event", () => {
    const withEvening = evaluateCompleteOutfit(
      candidate("a", [["dress", "gown"], ["shoe", "pump"], ["bag", "evening-clutch"]]), closet, sEvent);
    assert.equal(withEvening.formalityFit, "within-target");
  });

  test("FF-C.3 the evening clutch is chosen over the tote", () => {
    const anchor = { type: "closet", id: "gown", slot: "dress", label: "gown",
      colors: ["black"], material: null, styleTags: [], imageUrl: null } as unknown as NormalizedClosetAnchor;
    const picked = selectAdditionalClosetGarments(anchor, null, sEvent, closet, null);
    const bag = picked.find((p) => p.slot === "bag");
    assert.equal(bag?.id, "evening-clutch");
  });
});

// ── FF-D: 3 — Everyday / Relaxed must not drift upward ───────────────────────

describe("FF-D — casual sessions do not become over-formal", () => {
  const everyday = session({ occasion: "everyday", formalityConditional: null, bodyNeeds: ["nothing-specific"] });
  const closet = [
    g({ id: "tee", category: "TOPS", formality: "casual", occasions: ["casual"] }),
    g({ id: "jeans", category: "BOTTOMS", formality: "casual", occasions: ["casual"] }),
    g({ id: "sneakers", category: "SHOES", formality: "casual", occasions: ["casual"] }),
    g({ id: "smart-tote", category: "BAGS", formality: "smart-casual", occasions: ["casual"] }),
    g({ id: "formal-bag", category: "BAGS", formality: "business-formal", occasions: ["casual"] }),
  ];
  const core: Array<[string, string]> = [["top", "tee"], ["bottom", "jeans"], ["shoe", "sneakers"]];

  test("FF-D.1 a smart-casual bag does not push an everyday outfit out of band", () => {
    const r = evaluateCompleteOutfit(candidate("a", [...core, ["bag", "smart-tote"]]), closet, everyday);
    assert.equal(r.formalityFit, "within-target", "everyday 1-2 must still fit with a smart-casual bag");
  });

  test("FF-D.2 even a business-formal bag cannot tip an all-casual outfit out of band", () => {
    // 0.15 weight against 3.0 of casual structure — the finishing layer must not be
    // able to overturn what the clothes say.
    const r = evaluateCompleteOutfit(candidate("a", [...core, ["bag", "formal-bag"]]), closet, everyday);
    assert.equal(r.formalityFit, "within-target");
  });

  test("FF-D.3 no explicit formality means no finishing-slot penalty (fail-open)", () => {
    // computeRegisterAlignmentScore returns +1.0/0 and never a penalty when the
    // customer was not asked about formality, so an everyday session cannot lose a bag
    // it would previously have been given.
    const anchor = { type: "closet", id: "tee", slot: "top", label: "tee",
      colors: ["black"], material: null, styleTags: [], imageUrl: null } as unknown as NormalizedClosetAnchor;
    const picked = selectAdditionalClosetGarments(anchor, null, everyday, closet, null);
    assert.ok(picked.some((p) => p.slot === "bag"), "a bag must still be offered for an everyday look");
  });
});

// ── FF-F: piece role must not be inferred from the formality weight ─────────

describe("FF-F — burden is a question about role, not about register weight", () => {
  // optionalPieceCount asked whether a slot's PIECE_FORMALITY_WEIGHT was 0, which was
  // true of exactly bag/accessory/jewelry — so giving them a weight in RC-D silently
  // stopped T6c counting them as discretionary. The two signals are now independent.
  const items = [
    g({ id: "top", category: "TOPS", formality: "smart-casual", occasions: ["casual"] }),
    g({ id: "jeans", category: "BOTTOMS", formality: "casual", occasions: ["casual"] }),
    g({ id: "shoes", category: "SHOES", formality: "casual", occasions: ["casual"] }),
    g({ id: "bag", category: "BAGS", formality: "smart-casual", occasions: ["casual"] }),
    g({ id: "jewel", category: "JEWELRY", formality: "smart-casual", occasions: ["casual"] }),
  ];
  const everyday = session({ occasion: "everyday", formalityConditional: null });
  const core: Array<[string, string]> = [["top", "top"], ["bottom", "jeans"], ["shoe", "shoes"]];

  test("FF-F.1 a bag still counts as a discretionary piece", () => {
    const bare = evaluateCompleteOutfit(candidate("bare", core), items, everyday);
    const withBag = evaluateCompleteOutfit(candidate("bag", [...core, ["bag", "bag"]]), items, everyday);
    assert.equal(withBag.optionalPieceCount, bare.optionalPieceCount + 1);
  });

  test("FF-F.2 jewellery too", () => {
    const bare = evaluateCompleteOutfit(candidate("bare", core), items, everyday);
    const withJewel = evaluateCompleteOutfit(candidate("j", [...core, ["jewelry", "jewel"]]), items, everyday);
    assert.equal(withJewel.optionalPieceCount, bare.optionalPieceCount + 1);
  });

  test("FF-F.3 base pieces and shoes are never discretionary", () => {
    assert.equal(evaluateCompleteOutfit(candidate("bare", core), items, everyday).optionalPieceCount, 0);
  });
});

// ── FF-E: 4 — structural formality ranking is untouched ──────────────────────

describe("FF-E — structural-piece formality ranking is unchanged", () => {
  const closet = [
    g({ id: "gown", category: "DRESSES", formality: "occasion" }),
    g({ id: "pump", category: "SHOES", formality: "business-formal" }),
    g({ id: "sneaker", category: "SHOES", formality: "casual" }),
    g({ id: "blazer", category: "OUTERWEAR", formality: "business-formal" }),
  ];

  test("FF-E.1 a casual shoe still makes a Dressy outfit underdressed", () => {
    const good = evaluateCompleteOutfit(candidate("a", [["dress", "gown"], ["shoe", "pump"]]), closet, session());
    const bad = evaluateCompleteOutfit(candidate("b", [["dress", "gown"], ["shoe", "sneaker"]]), closet, session());
    assert.equal(good.formalityFit, "within-target");
    assert.equal(bad.formalityFit, "underdressed");
  });

  test("FF-E.2 the shoe still carries full weight — a finishing piece cannot rescue it", () => {
    const withClutch = evaluateCompleteOutfit(
      candidate("b", [["dress", "gown"], ["shoe", "sneaker"], ["bag", "pump"]]), closet, session());
    assert.equal(withClutch.formalityFit, "underdressed",
      "no finishing piece may overturn a structural formality miss");
  });

  test("FF-E.3 the formality fallback reaches finishing slots and no others", () => {
    // One fixture, both directions. Everyday's band is 1-2. Each pair holds two
    // unreviewed garments differing ONLY in formality, with the out-of-band one listed
    // first so input order and formality order disagree.
    //
    //   top:  business-formal (4, out of band) first, casual (1, in band) second
    //   bag:  business-formal (4, out of band) first, casual (1, in band) second
    //
    // The top must stay business-formal — structural ranking is untouched, so the
    // out-of-band piece keeps its position. The bag must switch to casual — the fallback
    // applies there. If the fallback leaked into structural slots the top would flip too,
    // and every unreviewed garment in the closet would be re-ranked by formality.
    const everyday = session({ occasion: "everyday", formalityConditional: null });
    const items = [
      g({ id: "jeans", category: "BOTTOMS", occasions: ["casual"] }),
      g({ id: "top-formal", category: "TOPS", formality: "business-formal", occasions: ["casual"] }),
      g({ id: "top-casual", category: "TOPS", formality: "casual", occasions: ["casual"] }),
      g({ id: "bag-formal", category: "BAGS", formality: "business-formal", occasions: ["casual"] }),
      g({ id: "bag-casual", category: "BAGS", formality: "casual", occasions: ["casual"] }),
    ];
    const anchor = { type: "closet", id: "jeans", slot: "bottom", label: "jeans",
      colors: ["black"], material: null, styleTags: [], imageUrl: null } as unknown as NormalizedClosetAnchor;
    const picked = selectAdditionalClosetGarments(anchor, null, everyday, items, null);
    assert.equal(picked.find((p) => p.slot === "top")?.id, "top-formal",
      "structural selection must not be re-ordered by the finishing-slot fallback");
    assert.equal(picked.find((p) => p.slot === "bag")?.id, "bag-casual",
      "the finishing slot must be formality-aware");
  });
});
