// app/lib/styleme/intention-changes-outfit.test.ts
//
// Reproduces the Test 1 / Test 2 QA failure of 2026-10-01 and pins the fix.
//
// THE FAILURE. Two StyleMe sessions identical in every input except the intention —
// "Help me feel like myself" vs "Help me feel sharper" — returned the same five
// garments. Only the title and explanation changed. The copy said "sharper"; the
// clothes did not.
//
// TWO ROOT CAUSES, both in the legacy (un-reviewed closet) structure path:
//
//   1. Vocabulary mismatch. STRUCTURE_TAGS was hand-written and did not match
//      GARMENT_STYLE_TAG_VOCAB, the set the Closet AI actually emits. "sharp" and
//      "minimalist" are not in that vocabulary and could never match anything, while
//      the AI's own sharpness words — clean, refined, elevated, sophisticated,
//      classic, minimal, understated — were not looked for. silhouette and formality
//      were not consulted at all. In an un-reviewed closet almost every garment
//      scored 0, T4 was flat, and the intention could not move the winner.
//
//   2. The metric inverted. outfitStructureScore was bestPieceScore / totalPieces,
//      so adding a sharper piece grew the denominator without growing the numerator:
//      blazer + tailored trousers + loafers scored LOWER than the same look without
//      the blazer. And because only the single best piece counted, swapping any other
//      piece changed nothing, so Candidate E's todayBetter() rejected real upgrades.
//
// What is NOT asserted here: any specific garment, colour, or category. The test
// states only that a different, more structured outfit wins — whichever one the
// engine chooses from the fixture.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  buildNaiaOutfitCandidates,
  computeIntentionFit,
  outfitStructureScore,
  evaluateCompleteOutfit,
  computeOccasionTier,
  computePassportAlignment,
  scoreBodyNeedFitForRanking,
  compareCandidateRankKeys,
} from "../ai/styleme-result.server.js";
import type {
  ClosetAnchorInput,
  NormalizedClosetAnchor,
  StyleMeSessionInput,
  OutfitCandidate,
} from "../ai/styleme-recommendation.types.js";

// ── Fixture: the QA customer's closet, un-reviewed (no approved profiles) ─────

function garment(over: Partial<ClosetAnchorInput> & { id: string }): ClosetAnchorInput {
  return {
    type: "closet", name: over.id, category: "TOPS", subcategory: null,
    colors: ["black"], primaryColor: "black", pattern: null, material: null,
    styleTags: [], occasions: ["casual"], imageUrl: null, garmentRelationships: [],
    formality: "casual", fitProfile: null, waistShape: null, sleeveLength: null,
    necklineCoverage: null, hemLength: null, topLength: null, shoulderCoverage: null,
    midriffExposed: null, silhouette: null, stylePersonality: null,
    approvedProfile: null, ...over,
  } as ClosetAnchorInput;
}

/** The five garments both tests returned, plus sharper alternatives that exist in the closet. */
function closet(): ClosetAnchorInput[] {
  return [
    garment({ id: "top", name: "Black Long-Sleeve Top", category: "TOPS" }),
    garment({ id: "jeans", name: "Medium Blue Wash Jeans", category: "BOTTOMS", colors: ["blue"], primaryColor: "blue" }),
    garment({ id: "earrings", name: "Gold Hoop Earrings", category: "JEWELRY" }),
    garment({ id: "sneakers", name: "White Platform Sneakers", category: "SHOES", colors: ["white"], primaryColor: "white" }),
    garment({ id: "bag", name: "Black Shoulder Bag", category: "BAGS" }),
    // Sharper alternatives, described the way the Closet AI actually describes them.
    //
    // Deliberately NOT tagged "structured"/"tailored"/"polished". Those three were the
    // only sharpness tokens the old STRUCTURE_TAGS matched, so a fixture using them
    // would pass even against the broken code and would not reproduce the QA failure.
    // These carry "refined", "clean" and "elevated" instead — all in
    // GARMENT_STYLE_TAG_VOCAB, all previously scored as zero structure. Before the fix
    // every candidate below scored a flat 0 at T4 and the winner collapsed onto the
    // control, which is exactly what QA observed on 2026-10-01.
    garment({ id: "blazer", name: "Black Blazer", category: "OUTERWEAR", styleTags: ["refined"], formality: "smart-casual" }),
    garment({ id: "trousers", name: "Black Trousers", category: "BOTTOMS", styleTags: ["clean"], silhouette: "straight", formality: "smart-casual" }),
    garment({ id: "loafers", name: "Black Loafers", category: "SHOES", styleTags: ["elevated"], formality: "smart-casual" }),
  ];
}

const ANCHOR: NormalizedClosetAnchor = {
  type: "closet", id: "top", slot: "top", label: "Black Long-Sleeve Top",
  colors: ["black"], material: null, styleTags: [], imageUrl: null,
} as unknown as NormalizedClosetAnchor;

/** Everything held constant except `intentions` — the A/B condition from QA. */
function session(intentions: string[]): StyleMeSessionInput {
  return {
    // The real flow derives moods from the intention translation; feel-like-myself
    // yields ["like-myself"] and feel-sharper yields nothing. Mirrored here so the
    // fixture matches what the route actually passes.
    moods: intentions.includes("feel-like-myself") ? ["like-myself"] : [],
    desiredFeelings: [],
    bodyNeeds: ["nothing-specific"],     // Fit / Comfort: "No specific preference"
    coverageConditional: null,
    occasion: "everyday",                 // Occasion: Everyday
    formalityConditional: null,
    todayColours: { preferred: [], avoid: [] },
    practicalIds: [],
    source: "my-closet",                  // Anchor: nAia chooses
    state: "nothing-in-particular",       // State: "I feel pretty neutral"
    intentions,
  } as unknown as StyleMeSessionInput;
}

const PROFILE = { dressingPreferences: [], stylePersonalities: [] } as never;

/** Runs the real ranker and returns the winning candidate's garment id set. */
function winningOutfit(intentions: string[]): { ids: Set<string>; t4: number[]; winner: OutfitCandidate } {
  const items = closet();
  const s = session(intentions);
  const cands = buildNaiaOutfitCandidates(ANCHOR, s, items, PROFILE, undefined)
    .filter((c): c is OutfitCandidate => c !== null);
  assert.ok(cands.length > 1, "fixture must produce more than one candidate to choose between");

  const scored = cands.map((c) => {
    const suit = evaluateCompleteOutfit(c, items, s);
    const bn = scoreBodyNeedFitForRanking(s.bodyNeeds ?? [], c, items);
    return {
      c,
      t4: computeIntentionFit(s.intentions ?? [], c, cands[0], items, PROFILE),
      key: {
        occasionTier: computeOccasionTier(c, items, s.occasion),
        formalityFitPriority: suit.formalityFit === "within-target" ? 1 : suit.formalityFit === "unknown" ? 0 : -1,
        knownViolationCount: bn.knownViolationCount,
        bodyNeedFitScore: bn.bodyNeedFitScore,
        intentionFit: computeIntentionFit(s.intentions ?? [], c, cands[0], items, PROFILE),
        passportAlignment: computePassportAlignment(c, items, PROFILE),
        formalityOvershootAbs: Math.abs(suit.formalityOvershoot),
        optionalNonMatchCount: suit.explicitNonMatchCount,
        discretionaryPieceCount: suit.optionalPieceCount,
      },
    };
  });

  scored.sort((a, b) => compareCandidateRankKeys(a.key, b.key));
  const winner = scored[0].c;
  return {
    ids: new Set(winner.pieces.map((p) => p.closetId)),
    t4: scored.map((x) => x.t4),
    winner,
  };
}

// ── The A/B condition ─────────────────────────────────────────────────────────

describe("IC-A — intention changes the clothes, not only the copy", () => {
  test("IC-A.1 feel-sharper selects a materially different outfit from feel-like-myself", () => {
    const control = winningOutfit(["feel-like-myself"]);
    const sharper = winningOutfit(["feel-sharper"]);

    const same = control.ids.size === sharper.ids.size &&
      [...control.ids].every((id) => sharper.ids.has(id));
    assert.ok(
      !same,
      `both intentions returned the same garments: ${[...control.ids].sort().join(", ")}`,
    );
  });

  test("IC-A.2 the sharper outfit is measurably more structured than the control", () => {
    const items = closet();
    const control = winningOutfit(["feel-like-myself"]).winner;
    const sharper = winningOutfit(["feel-sharper"]).winner;
    assert.ok(
      outfitStructureScore(sharper, items) > outfitStructureScore(control, items),
      `sharper=${outfitStructureScore(sharper, items)} control=${outfitStructureScore(control, items)}`,
    );
  });

  test("IC-A.3 T4 actually differentiates the candidates for feel-sharper", () => {
    // The failure signature was a flat T4 — every candidate scoring identically, so
    // the winner fell through to tie-breaks and matched the control.
    const t4 = winningOutfit(["feel-sharper"]).t4;
    assert.ok(new Set(t4.map((v) => v.toFixed(4))).size > 1, `T4 was flat: ${t4.join(", ")}`);
  });

  test("IC-A.4 intention does not override occasion — every candidate stays Everyday-valid", () => {
    // Priority must hold: T1 occasion outranks T4 intention. A sharper outfit may win
    // only from inside the set already valid for the occasion.
    const items = closet();
    const s = session(["feel-sharper"]);
    const cands = buildNaiaOutfitCandidates(ANCHOR, s, items, PROFILE, undefined)
      .filter((c): c is OutfitCandidate => c !== null);
    for (const c of cands) {
      assert.notEqual(
        computeOccasionTier(c, items, "everyday"), 0,
        `candidate ${c.id} is invalid for the occasion yet was offered`,
      );
    }
  });
});

// ── Why it was flat: the vocabulary did not match the Closet AI ───────────────

describe("IC-B — sharpness is read from the vocabulary the Closet AI emits", () => {
  // Every token below is in GARMENT_STYLE_TAG_VOCAB (garment-intelligence.types.ts).
  // Before the fix only "structured", "tailored" and "polished" scored; the rest — the
  // words the AI most often chooses for a sharp garment — scored exactly 0.
  for (const tag of ["clean", "refined", "elevated", "sophisticated", "classic", "minimal", "understated"]) {
    test(`IC-B.1 a garment tagged "${tag}" registers as structured`, () => {
      const item = garment({ id: tag, styleTags: [tag] });
      const cand: OutfitCandidate = { id: "X", pieces: [{ closetId: tag, slot: "top", label: tag, colors: [] }] };
      assert.ok(
        outfitStructureScore(cand, [item]) > 0,
        `"${tag}" is in the Closet AI vocabulary but scored 0`,
      );
    });
  }

  test("IC-B.2 dead tokens are gone — the set contains nothing the AI cannot emit", () => {
    // "sharp" and "minimalist" were in the old set and are not in GARMENT_STYLE_TAG_VOCAB.
    for (const dead of ["sharp", "minimalist"]) {
      const item = garment({ id: dead, styleTags: [dead] });
      const cand: OutfitCandidate = { id: "X", pieces: [{ closetId: dead, slot: "top", label: dead, colors: [] }] };
      assert.equal(
        outfitStructureScore(cand, [item]), 0,
        `"${dead}" is not a Closet AI token and must not be scored`,
      );
    }
  });

  test("IC-B.3 fitted is closeness to the body, not structure", () => {
    // Documented principle: fitted ≠ structured. A body-skimming jersey top is not sharp.
    for (const fp of ["fitted", "body-skimming"]) {
      const item = garment({ id: fp, fitProfile: fp });
      const cand: OutfitCandidate = { id: "X", pieces: [{ closetId: fp, slot: "top", label: fp, colors: [] }] };
      assert.equal(
        outfitStructureScore(cand, [item]), 0,
        `fitProfile "${fp}" must not read as structure`,
      );
    }
  });

  test("IC-B.4 construction fitProfile and a clean silhouette both count", () => {
    for (const over of [{ fitProfile: "structured" }, { fitProfile: "tailored" }, { silhouette: "straight" }, { silhouette: "column" }]) {
      const item = garment({ id: "g", ...over });
      const cand: OutfitCandidate = { id: "X", pieces: [{ closetId: "g", slot: "top", label: "g", colors: [] }] };
      assert.ok(outfitStructureScore(cand, [item]) > 0, `${JSON.stringify(over)} scored 0`);
    }
  });
});

// ── Why it was flat: the metric inverted ─────────────────────────────────────

describe("IC-C — the structure metric rewards more structure, not less", () => {
  test("IC-C.1 adding a structured layer raises the score", () => {
    // The old bestPiece/count formula did the opposite: blazer + trousers + loafers
    // scored 0.25 while trousers + loafers scored 0.33.
    const items = closet();
    const withoutLayer: OutfitCandidate = { id: "W", pieces: [
      { closetId: "top", slot: "top", label: "top", colors: [] },
      { closetId: "trousers", slot: "bottom", label: "trousers", colors: [] },
      { closetId: "loafers", slot: "shoe", label: "loafers", colors: [] },
    ] };
    const withLayer: OutfitCandidate = { id: "L", pieces: [
      ...withoutLayer.pieces,
      { closetId: "blazer", slot: "outerwear", label: "blazer", colors: [] },
    ] };
    assert.ok(
      outfitStructureScore(withLayer, items) > outfitStructureScore(withoutLayer, items),
      `with=${outfitStructureScore(withLayer, items)} without=${outfitStructureScore(withoutLayer, items)}`,
    );
  });

  test("IC-C.2 swapping a non-peak piece changes the score", () => {
    // Under a max-based metric this was invisible, which is why Candidate E's
    // todayBetter() check rejected every improvement that was not the single best piece.
    const items = closet();
    const base: OutfitCandidate = { id: "B", pieces: [
      { closetId: "top", slot: "top", label: "top", colors: [] },
      { closetId: "trousers", slot: "bottom", label: "trousers", colors: [] },
      { closetId: "sneakers", slot: "shoe", label: "sneakers", colors: [] },
    ] };
    const swapped: OutfitCandidate = { id: "S", pieces: [
      base.pieces[0], base.pieces[1],
      { closetId: "loafers", slot: "shoe", label: "loafers", colors: [] },
    ] };
    assert.notEqual(
      outfitStructureScore(base, items).toFixed(4),
      outfitStructureScore(swapped, items).toFixed(4),
      "swapping the shoe for a sharper one left the score unchanged",
    );
  });

  test("IC-C.3 an outfit with no structure evidence still scores 0", () => {
    const items = closet();
    const plain: OutfitCandidate = { id: "P", pieces: [
      { closetId: "top", slot: "top", label: "top", colors: [] },
      { closetId: "jeans", slot: "bottom", label: "jeans", colors: [] },
      { closetId: "sneakers", slot: "shoe", label: "sneakers", colors: [] },
    ] };
    assert.equal(outfitStructureScore(plain, items), 0);
  });
});
