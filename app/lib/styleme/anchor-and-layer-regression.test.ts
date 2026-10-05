// app/lib/styleme/anchor-and-layer-regression.test.ts
//
// Pins the two regressions found in the real QA run of 2026-10-01
// (Everyday + "Help me feel sharper", diagnostics enabled).
//
// WHAT THE LOGS SHOWED
//
//   [nAia-anchor-rank]  Black Leather Shoulder Bag  score 12.75  isAnchorCapable=false  ← WON
//                       Black Long-Sleeve Top       score 12.00  isAnchorCapable=true
//                       (and every other garment at 12.00)
//
//   The 0.75 margin is exactly the approved-intention bonus: Supporting 0.5 × 1.5. So
//   the bag won *because* she asked for something, and ANCHOR_CAPABLE_CATEGORIES —
//   which exists to say what may anchor an outfit — never got a vote, because it was
//   only the third tiebreak, consulted on exact ties.
//
//   [nAia-slot-score]   Gold Hoop Earrings      13.00   feel-sharper: None
//                       Camel Leather Belt      12.75   feel-sharper: Supporting
//                       Beige Oversized Blazer  12.50   feel-sharper: Strong, tailored
//
//   The bag anchor held one of the five outfit slots; Phase 1 took top and bottom;
//   shoes took the next; one slot remained and the earrings took it on half a point.
//   The only garment a human had rated Strong for what she asked for never entered
//   the outfit.
//
//   [nAia-candidates]   A, B, E  — C and D absent
//
//   So T6c and the no-outerwear twin were NOT the cause: there was no layer in the
//   selection to strip. The layer was lost earlier, in the piece budget.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  selectAdditionalClosetGarments,
  evaluateCompleteOutfit,
  getTargetFormalityRange,
} from "../ai/styleme-result.server.js";
import { autoSelectClosetAnchor } from "../ai/styleme-anchor.server.js";
import { passesCandidateDressingRequirements } from "../ai/styleme-result.server.js";
import type {
  ClosetAnchorInput,
  NormalizedClosetAnchor,
  StyleMeSessionInput,
  OutfitCandidate,
} from "../ai/styleme-recommendation.types.js";

// ── Fixtures ─────────────────────────────────────────────────────────────────

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

/** An approved profile carrying an intention rating. */
function rated(intention: string, rating: string, extra: Record<string, unknown> = {}) {
  return { intentionPotentials: { [intention]: rating }, ...extra } as unknown as ClosetAnchorInput["approvedProfile"];
}

function session(over: Partial<StyleMeSessionInput> = {}): StyleMeSessionInput {
  return {
    moods: [], desiredFeelings: [], bodyNeeds: ["nothing-specific"], coverageConditional: null,
    occasion: "everyday", formalityConditional: null, todayColours: { preferred: [], avoid: [] },
    practicalIds: [], source: "my-closet", state: "nothing-in-particular", intentions: [],
    ...over,
  } as unknown as StyleMeSessionInput;
}

// ── 1 + 2: anchor capability is a gate ───────────────────────────────────────

describe("AL-A — an accessory cannot become the automatic anchor", () => {
  // Mirrors the real ranking: the bag outscores every garment, as it did in production.
  const closetRows = [
    { id: "bag", name: "Black Leather Shoulder Bag", category: "BAGS", formality: "smart-casual",
      styleMeProfile: { profileStatus: "approved", intentionPotentials: { "feel-sharper": "Supporting" }, occasionFit: null, construction: "structured" } },
    { id: "top", name: "Black Long-Sleeve Top", category: "TOPS", formality: "casual",
      styleMeProfile: { profileStatus: "approved", intentionPotentials: { "feel-sharper": "None" }, occasionFit: null, construction: "soft" } },
    { id: "earrings", name: "Gold Hoop Earrings", category: "JEWELRY", formality: "smart-casual", styleMeProfile: null },
    { id: "sneakers", name: "White Platform Sneakers", category: "SHOES", formality: "casual", styleMeProfile: null },
  ].map((r) => ({
    subcategory: null, colors: [], primaryColor: null, pattern: null, material: null,
    styleTags: [], occasions: ["casual"], imageUrl: null, garmentRelationships: [],
    waistShape: null, hemLength: null, topLength: null, ...r,
  })) as never[];

  const fetchRows = async () => closetRows;

  test("AL-A.1 a bag that outscores every garment still does not anchor", async () => {
    const picked = await autoSelectClosetAnchor("cust", {
      occasion: "everyday", moods: [], desiredFeelings: [],
      intentions: ["feel-sharper"], bodyNeeds: ["nothing-specific"],
    }, fetchRows);
    assert.ok(picked, "an anchor should still be found");
    assert.notEqual(picked!.id, "bag", "a handbag must never be the automatic anchor");
  });

  test("AL-A.2 the anchor-capable garment wins over the higher-scoring accessory", async () => {
    const picked = await autoSelectClosetAnchor("cust", {
      occasion: "everyday", moods: [], desiredFeelings: [],
      intentions: ["feel-sharper"], bodyNeeds: ["nothing-specific"],
    }, fetchRows);
    assert.equal(picked!.id, "top");
  });

  test("AL-A.3 shoes and jewellery are equally ineligible", async () => {
    // Only the accessory categories are present besides one top; the top must win.
    const picked = await autoSelectClosetAnchor("cust", {
      occasion: "everyday", moods: [], desiredFeelings: [], intentions: [], bodyNeeds: [],
    }, fetchRows);
    assert.equal(picked!.id, "top");
  });

  test("AL-A.4 a closet of nothing but accessories yields no anchor rather than a bag", async () => {
    const onlyAccessories = closetRows.filter((r) => (r as { category: string }).category !== "TOPS");
    const picked = await autoSelectClosetAnchor("cust", {
      occasion: "everyday", moods: [], desiredFeelings: [], intentions: [], bodyNeeds: [],
    }, async () => onlyAccessories);
    assert.equal(picked, null, "better no anchor than an outfit built around a handbag");
  });

  test("AL-A.5 outerwear remains anchor-capable", async () => {
    const withCoat = [
      ...closetRows.filter((r) => (r as { category: string }).category !== "TOPS"),
      { id: "coat", name: "Beige Trench Coat", category: "OUTERWEAR", formality: "casual",
        subcategory: null, colors: [], primaryColor: null, pattern: null, material: null,
        styleTags: [], occasions: ["casual"], imageUrl: null, garmentRelationships: [],
        waistShape: null, hemLength: null, topLength: null, styleMeProfile: null },
    ] as never[];
    const picked = await autoSelectClosetAnchor("cust", {
      occasion: "everyday", moods: [], desiredFeelings: [], intentions: [], bodyNeeds: [],
    }, async () => withCoat);
    assert.equal(picked!.id, "coat");
  });
});

// ── 3 + 4 + 7: the layer keeps its slot when it is doing work ────────────────

describe("AL-B — a working layer is not crowded out of the piece budget", () => {
  const anchor: NormalizedClosetAnchor = {
    type: "closet", id: "top", slot: "top", label: "Black Long-Sleeve Top",
    colors: ["black"], material: null, styleTags: [], imageUrl: null,
  } as unknown as NormalizedClosetAnchor;

  /** Reproduces the real contest: an accessory outscores the layer on raw score. */
  function closet(layerRating: string | null): ClosetAnchorInput[] {
    return [
      g({ id: "top", name: "Black Long-Sleeve Top", category: "TOPS" }),
      g({ id: "jeans", name: "Medium Blue Wash Jeans", category: "BOTTOMS" }),
      g({ id: "sneakers", name: "White Platform Sneakers", category: "SHOES" }),
      // Two finishing pieces that both outscore the layer on raw score, exactly as the
      // real Gold Hoop Earrings (13.00) and Camel Leather Belt (12.75) outscored the
      // Beige Oversized Blazer (12.50). With the anchor, the bottom and the shoes
      // already placed, only ONE slot of MAX_OUTFIT_PIECES remains — so the layer and
      // these two are in direct competition, which is the condition that lost it.
      g({ id: "earrings", name: "Gold Hoop Earrings", category: "JEWELRY",
          occasions: ["casual", "weekend", "work"], garmentRelationships: ["favourite"] }),
      g({ id: "bag", name: "Black Shoulder Bag", category: "BAGS",
          occasions: ["casual", "weekend", "work"], garmentRelationships: ["favourite"] }),
      g({ id: "blazer", name: "Beige Oversized Blazer", category: "OUTERWEAR",
          styleTags: ["tailored"], fitProfile: "tailored", formality: "smart-casual",
          approvedProfile: layerRating ? rated("feel-sharper", layerRating, { construction: "tailored" }) : null }),
    ];
  }

  function pickedSlots(layerRating: string | null, intentions: string[]): string[] {
    const items = closet(layerRating);
    const chosen = selectAdditionalClosetGarments(
      anchor, null, session({ intentions }), items,
      { dressingPreferences: [] } as never, undefined,
    );
    return chosen.map((c) => c.slot);
  }

  test("AL-B.1 a layer rated Strong for today's intention keeps its slot", () => {
    assert.ok(
      pickedSlots("Strong", ["feel-sharper"]).includes("outerwear"),
      "the only garment rated Strong for the stated intention was dropped",
    );
  });

  test("AL-B.2 a layer rated Supporting also keeps its slot", () => {
    assert.ok(pickedSlots("Supporting", ["feel-sharper"]).includes("outerwear"));
  });

  test("AL-B.3 an unrated layer is NOT protected — it can still lose the slot", () => {
    // The fix must remove gratuitous layers, not keep every layer.
    const slots = pickedSlots(null, ["feel-sharper"]);
    assert.ok(
      !slots.includes("outerwear") || slots.length <= 4,
      "an unrated layer must not be promoted over a higher-scoring accessory",
    );
  });

  test("AL-B.4 a layer rated None for today's intention is not protected", () => {
    assert.ok(
      !pickedSlots("None", ["feel-sharper"]).includes("outerwear"),
      "an approved None must not be treated as evidence the layer is useful",
    );
  });

  test("AL-B.5 with no intention active, nothing is reserved", () => {
    // The reservation is intention-driven; with no intention it must not fire.
    const slots = pickedSlots("Strong", []);
    assert.ok(
      !slots.includes("outerwear") || slots.length <= 4,
      "reservation fired with no active intention",
    );
  });
});

// ── 3 + 4: T6c no longer treats every layer as burden ───────────────────────

describe("AL-C — T6c distinguishes a working layer from a gratuitous one", () => {
  const items = [
    g({ id: "top", category: "TOPS" }),
    g({ id: "jeans", category: "BOTTOMS" }),
    g({ id: "shoes", category: "SHOES" }),
    g({ id: "workingLayer", category: "OUTERWEAR", formality: "smart-casual",
        approvedProfile: rated("feel-sharper", "Strong") }),
    g({ id: "idleLayer", category: "OUTERWEAR", formality: "casual" }),
  ];
  const base = [
    { closetId: "top", slot: "top", label: "top", colors: [] },
    { closetId: "jeans", slot: "bottom", label: "jeans", colors: [] },
    { closetId: "shoes", slot: "shoe", label: "shoes", colors: [] },
  ];
  const withWorking: OutfitCandidate = { id: "W", pieces: [...base, { closetId: "workingLayer", slot: "outerwear", label: "w", colors: [] }] };
  const withIdle: OutfitCandidate = { id: "I", pieces: [...base, { closetId: "idleLayer", slot: "outerwear", label: "i", colors: [] }] };
  const bare: OutfitCandidate = { id: "N", pieces: base };
  const s = session({ intentions: ["feel-sharper"] });

  test("AL-C.1 a layer rated for today's intention is not counted as burden", () => {
    assert.equal(
      evaluateCompleteOutfit(withWorking, items, s).optionalPieceCount,
      evaluateCompleteOutfit(bare, items, s).optionalPieceCount,
      "a working layer must not make the outfit lose T6c to its own no-layer twin",
    );
  });

  test("AL-C.2 an unrated layer on a casual base IS still counted as burden", () => {
    assert.ok(
      evaluateCompleteOutfit(withIdle, items, s).optionalPieceCount >
      evaluateCompleteOutfit(bare, items, s).optionalPieceCount,
      "T6c must still be able to shed a gratuitous layer",
    );
  });

  test("AL-C.3 bags, accessories and jewellery are always burden", () => {
    const withBag: OutfitCandidate = { id: "B", pieces: [...base, { closetId: "bag", slot: "bag", label: "bag", colors: [] }] };
    const all = [...items, g({ id: "bag", category: "BAGS" })];
    assert.ok(
      evaluateCompleteOutfit(withBag, all, s).optionalPieceCount >
      evaluateCompleteOutfit(bare, all, s).optionalPieceCount,
    );
  });
});

// ── 5: the coverage guard that actually works ───────────────────────────────

describe("AL-D — a layer required for coverage cannot be removed", () => {
  // The real protection is passesCandidateDressingRequirements, not coverageConditional.
  // coverageConditional is hard-coded null at both buildEngineInput call sites, so the
  // Candidate C suppression branch that reads it is vestigial. This proves the working
  // guard, so the dead branch can be retired rather than wired to a second system.
  const items = [
    g({ id: "sleeveless", category: "TOPS", sleeveLength: "sleeveless" }),
    g({ id: "jeans", category: "BOTTOMS" }),
    g({ id: "coat", category: "OUTERWEAR", sleeveLength: "full" }),
  ];
  const withCoat: OutfitCandidate = { id: "A", pieces: [
    { closetId: "sleeveless", slot: "top", label: "t", colors: [] },
    { closetId: "jeans", slot: "bottom", label: "b", colors: [] },
    { closetId: "coat", slot: "outerwear", label: "c", colors: [] },
  ] };
  const withoutCoat: OutfitCandidate = { id: "C", pieces: withCoat.pieces.slice(0, 2) };

  test("AL-D.1 the no-layer twin is rejected when the layer was the covering piece", () => {
    assert.equal(passesCandidateDressingRequirements(withoutCoat, items, ["arms-covered"]), false);
  });

  test("AL-D.2 the outfit WITH the covering layer passes", () => {
    assert.equal(passesCandidateDressingRequirements(withCoat, items, ["arms-covered"]), true);
  });

  test("AL-D.3 with no coverage requirement set, the no-layer twin is allowed", () => {
    assert.equal(passesCandidateDressingRequirements(withoutCoat, items, []), true);
  });
});

// ── 6: Everyday formality is unchanged ──────────────────────────────────────

describe("AL-E — Everyday formality constraints remain intact", () => {
  test("AL-E.1 the Everyday band is still ranks 1–2", () => {
    assert.deepEqual(getTargetFormalityRange("everyday", null), { min: 1, max: 2 });
  });

  test("AL-E.2 a genuinely formal outfit is still judged overdressed for Everyday", () => {
    const items = [
      g({ id: "gown", category: "DRESSES", formality: "evening" }),
      g({ id: "heels", category: "SHOES", formality: "evening" }),
    ];
    const cand: OutfitCandidate = { id: "X", pieces: [
      { closetId: "gown", slot: "dress", label: "g", colors: [] },
      { closetId: "heels", slot: "shoe", label: "h", colors: [] },
    ] };
    assert.equal(evaluateCompleteOutfit(cand, items, session()).formalityFit, "overdressed");
  });

  test("AL-E.3 a working layer does not let a formal piece bypass the Everyday band", () => {
    // The T6c change must not become a back door for over-dressed garments: T2 is
    // evaluated independently of whether a layer counts as burden.
    const items = [
      g({ id: "top", category: "TOPS" }),
      g({ id: "jeans", category: "BOTTOMS" }),
      g({ id: "tux", category: "OUTERWEAR", formality: "evening", approvedProfile: rated("feel-sharper", "Strong") }),
    ];
    const cand: OutfitCandidate = { id: "X", pieces: [
      { closetId: "top", slot: "top", label: "t", colors: [] },
      { closetId: "jeans", slot: "bottom", label: "j", colors: [] },
      { closetId: "tux", slot: "outerwear", label: "x", colors: [] },
    ] };
    const out = evaluateCompleteOutfit(cand, items, session({ intentions: ["feel-sharper"] }));
    assert.ok(out.formalityOvershoot > 0, "an evening layer must still register as overshoot at T2");
  });
});

// ── Test 9: structural slot, not category allowlist ──────────────────────────
//
// ed21895 fixed the bag-anchor bug with the wrong abstraction — a fixed category
// allowlist {TOPS,BOTTOMS,DRESSES,OUTERWEAR}. ACTIVEWEAR is absent from it, so an
// "Active / busy day" session lost its entire valid wardrobe: 9 activewear garments
// plus 6 pairs of shoes were removed before scoring, the 21 survivors matched nothing
// for the occasion, and autoSelectClosetAnchor returned null — "nAia couldn't find a
// clear starting point."
//
// The product rule is structural garment vs finishing accessory, decided on the
// RESOLVED slot via closetItemToSlot. Any category that resolves to top / bottom /
// dress / set / outerwear qualifies; shoes, bags, accessories and jewellery never do.

import { canSlotAnchorOutfit, STRUCTURAL_ANCHOR_SLOTS, evaluateAnchorEligibility } from "../ai/styleme-profile-gate.js";
import { closetItemToSlot } from "../ai/closet-slot.js";

describe("AL-F — anchor capability is decided on the resolved slot", () => {
  function row(o: Record<string, unknown>) {
    return {
      subcategory: null, colors: [], primaryColor: null, pattern: null, material: null,
      styleTags: [], occasions: ["casual"], imageUrl: null, garmentRelationships: [],
      waistShape: null, hemLength: null, topLength: null, formality: "casual",
      styleMeProfile: null, ...o,
    };
  }
  /** One structural garment so a valid anchor always exists, plus the item under test. */
  const control = row({ id: "ctl", name: "Control Top", category: "TOPS" });

  async function anchorFrom(rows: unknown[]) {
    return autoSelectClosetAnchor("cust", {
      occasion: "everyday", moods: [], desiredFeelings: [], intentions: [], bodyNeeds: [],
    }, async () => rows as never[]);
  }

  test("AL-F.1 ACTIVEWEAR resolving to top CAN auto-anchor", async () => {
    const tee = row({ id: "aw-top", name: "Black Nike Dri-FIT T-Shirt", category: "ACTIVEWEAR", subcategory: "t-shirt",
      garmentRelationships: ["favourite"] }); // outscores the control
    assert.equal(closetItemToSlot("ACTIVEWEAR", "t-shirt"), "top");
    const picked = await anchorFrom([tee, control]);
    assert.equal(picked!.id, "aw-top");
  });

  test("AL-F.2 ACTIVEWEAR resolving to bottom CAN auto-anchor", async () => {
    const leggings = row({ id: "aw-bottom", name: "Black High-Waist Leggings", category: "ACTIVEWEAR",
      subcategory: "leggings", garmentRelationships: ["favourite"] });
    assert.equal(closetItemToSlot("ACTIVEWEAR", "leggings"), "bottom");
    const picked = await anchorFrom([leggings, control]);
    assert.equal(picked!.id, "aw-bottom");
  });

  test("AL-F.3 a bag CANNOT auto-anchor even scoring higher", async () => {
    const bag = row({ id: "bag", name: "Camel Suede Tote Bag", category: "BAGS",
      occasions: ["casual", "weekend", "work"], garmentRelationships: ["favourite"] });
    const picked = await anchorFrom([bag, control]);
    assert.equal(picked!.id, "ctl");
  });

  test("AL-F.4 shoes CANNOT auto-anchor", async () => {
    const shoes = row({ id: "shoe", name: "White Platform Sneakers", category: "SHOES",
      occasions: ["casual", "weekend", "work"], garmentRelationships: ["favourite"] });
    assert.equal(picked_id(await anchorFrom([shoes, control])), "ctl");
  });

  test("AL-F.5 jewellery and accessories CANNOT auto-anchor", async () => {
    for (const cat of ["JEWELRY", "ACCESSORIES"]) {
      const acc = row({ id: `acc-${cat}`, name: cat, category: cat,
        occasions: ["casual", "weekend", "work"], garmentRelationships: ["favourite"] });
      assert.equal(picked_id(await anchorFrom([acc, control])), "ctl", `${cat} must not anchor`);
    }
  });

  test("AL-F.6 ordinary TOPS / BOTTOMS / DRESSES / OUTERWEAR still anchor", async () => {
    for (const cat of ["TOPS", "BOTTOMS", "DRESSES", "OUTERWEAR"]) {
      const g = row({ id: `g-${cat}`, name: cat, category: cat, garmentRelationships: ["favourite"] });
      assert.equal(picked_id(await anchorFrom([g])), `g-${cat}`, `${cat} must still anchor`);
    }
  });

  test("AL-F.7 the rule is the slot set, not a category list", () => {
    assert.deepEqual([...STRUCTURAL_ANCHOR_SLOTS].sort(), ["bottom", "dress", "outerwear", "set", "top"]);
    for (const s of ["top", "bottom", "dress", "set", "outerwear"]) assert.equal(canSlotAnchorOutfit(s), true);
    for (const s of ["bag", "shoe", "accessory", "jewelry", "unknown"]) assert.equal(canSlotAnchorOutfit(s), false);
  });

  test("AL-F.8 SWIMWEAR / OTHER resolve to unknown and stay ineligible", async () => {
    for (const cat of ["SWIMWEAR", "OTHER"]) {
      assert.equal(closetItemToSlot(cat, null), "unknown");
      const g = row({ id: `u-${cat}`, name: cat, category: cat, garmentRelationships: ["favourite"] });
      assert.equal(picked_id(await anchorFrom([g, control])), "ctl");
    }
  });

  test("AL-F.9 manual anchoring is unchanged — eligibility ignores slot capability", () => {
    // The manual picker uses evaluateAnchorEligibility, which checks only dressing
    // requirements and approved occasionFit. It must NOT acquire a capability rule:
    // a customer who deliberately chooses an accessory is making a choice.
    const bagItem = g({ id: "bag", category: "BAGS" });
    assert.equal(evaluateAnchorEligibility(bagItem, "everyday", []).eligible, true);
    const shoeItem = g({ id: "shoe", category: "SHOES" });
    assert.equal(evaluateAnchorEligibility(shoeItem, "everyday", []).eligible, true);
  });

  test("AL-F.10 Test 2's bag-anchor regression stays fixed", async () => {
    // The original failure: a bag at 12.75 beating every garment at 12.00 because the
    // approved-intention bonus gave it the margin and capability was only a tiebreak.
    const bag = row({ id: "bag", name: "Black Leather Shoulder Bag", category: "BAGS", formality: "smart-casual",
      styleMeProfile: { profileStatus: "approved", intentionPotentials: { "feel-sharper": "Supporting" },
        occasionFit: null, construction: "structured" } });
    const top = row({ id: "top", name: "Black Long-Sleeve Top", category: "TOPS",
      styleMeProfile: { profileStatus: "approved", intentionPotentials: { "feel-sharper": "None" },
        occasionFit: null, construction: "soft" } });
    const picked = await autoSelectClosetAnchor("cust", {
      occasion: "everyday", moods: [], desiredFeelings: [],
      intentions: ["feel-sharper"], bodyNeeds: ["nothing-specific"],
    }, async () => [bag, top] as never[]);
    assert.equal(picked!.id, "top");
  });
});

function picked_id(p: { id: string } | null): string | null { return p ? p.id : null; }
