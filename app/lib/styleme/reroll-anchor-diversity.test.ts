// app/lib/styleme/reroll-anchor-diversity.test.ts
//
// COMMIT B — the reroll may move the structural centre.
//
// The anchor was chosen once at the source step and persisted as
// StylingSession.closetAnchorId, so every reroll rebuilt on the SAME garment. Since the
// anchor appears in every candidate, the core could barely move and a reroll could only
// vary finishing pieces. Commit A stopped that being PRESENTED as a new look; this lets a
// genuinely different core exist in the first place.
//
// TIER PLACEMENT — the weakest tier that can still do the job:
//
//   occasion eligibility > formality ceiling > formality floor
//     > single-point-band fallback > THIS > score / stable ordering
//
// It only chooses between anchors already equally correct: same viability terms as the
// default winner, tied on ceiling AND floor. It never promotes a lower-tier anchor and
// never runs when the single-point fallback has decided.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { autoSelectClosetAnchor } from "../ai/styleme-anchor.server.js";
import { passesCandidateDressingRequirements } from "../ai/styleme-result.server.js";

const row = (o: Record<string, unknown>) => ({
  subcategory: null, colors: [], primaryColor: null, pattern: null, material: null,
  styleTags: [], occasions: ["party", "formal", "casual", "family"], imageUrl: null,
  garmentRelationships: [], waistShape: null, hemLength: null, topLength: null,
  sleeveLength: null, necklineCoverage: null, shoulderCoverage: null, midriffExposed: null,
  styleMeProfile: null, formality: "business-formal", ...o,
});

const sig = (occasion: string, formality: string | null, previous?: string[]) => ({
  occasion, formalityConditional: formality,
  moods: [], desiredFeelings: [], intentions: [], bodyNeeds: [],
  ...(previous ? { previousOutfitClosetIds: previous } : {}),
});

const pick = async (rows: unknown[], s: ReturnType<typeof sig>) =>
  (await autoSelectClosetAnchor("cust", s as never, async () => rows as never))?.id ?? null;

// ── RD-A: a different structural centre when one is equally correct ──────────

describe("RD-A — the reroll prefers an unused structural anchor", () => {
  // Two equally valid tops. Without a previous outfit the first wins on stable order.
  const two = [
    row({ id: "topA", name: "Top A", category: "TOPS" }),
    row({ id: "topB", name: "Top B", category: "TOPS" }),
  ];

  test("RD-A.1 baseline: no previous outfit → unchanged behaviour", async () => {
    assert.equal(await pick(two, sig("girls-night", "formality-occasion")), "topA");
  });

  test("RD-A.2 previous outfit used topA → topB is chosen", async () => {
    assert.equal(await pick(two, sig("girls-night", "formality-occasion", ["topA"])), "topB");
  });

  test("RD-A.3 previous outfit used a piece that is not the anchor → unchanged", async () => {
    // The default winner is already outside the previous look; nothing to vary.
    assert.equal(await pick(two, sig("girls-night", "formality-occasion", ["someBag"])), "topA");
  });

  test("RD-A.4 several alternatives → the best-ranked fresh one, not an arbitrary one", async () => {
    const many = [
      row({ id: "topA", name: "Top A", category: "TOPS" }),
      row({ id: "topB", name: "Top B", category: "TOPS" }),
      row({ id: "topC", name: "Top C", category: "TOPS" }),
    ];
    const got = await pick(many, sig("girls-night", "formality-occasion", ["topA"]));
    assert.equal(got, "topB", "ranking order still decides among the fresh candidates");
  });

  test("RD-A.5 structural formula may change — a dress can replace a top", async () => {
    const mixed = [
      row({ id: "topA", name: "Top A", category: "TOPS" }),
      row({ id: "gown", name: "Gown", category: "DRESSES", formality: "occasion" }),
    ];
    const got = await pick(mixed, sig("girls-night", "formality-occasion", ["topA"]));
    assert.equal(got, "gown");
  });
});

// ── RD-B: fail-open — never withhold, never force ───────────────────────────

describe("RD-B — fail-open in every direction", () => {
  test("RD-B.1 the only valid anchor is the previous one → it is kept", async () => {
    const one = [row({ id: "onlyTop", name: "Only Top", category: "TOPS" })];
    assert.equal(await pick(one, sig("girls-night", "formality-occasion", ["onlyTop"])), "onlyTop",
      "an anchor is never withheld to manufacture diversity");
  });

  test("RD-B.2 an empty previous list changes nothing", async () => {
    const two = [row({ id: "topA", category: "TOPS" }), row({ id: "topB", category: "TOPS" })];
    assert.equal(await pick(two, sig("girls-night", "formality-occasion", [])), "topA");
  });

  test("RD-B.3 a closet with no eligible anchor still returns null, not a forced pick", async () => {
    const accessoriesOnly = [
      row({ id: "bag", category: "BAGS" }),
      row({ id: "jewel", category: "JEWELRY" }),
    ];
    assert.equal(await pick(accessoriesOnly, sig("girls-night", "formality-occasion", ["bag"])), null);
  });
});

// ── RD-C: correctness outranks diversity at every higher tier ───────────────

describe("RD-C — diversity never overrides a correctness tier", () => {
  test("RD-C.1 an out-of-range alternative does not displace an in-range previous anchor", async () => {
    // girls-night + Dressy band is 4-5. The fresh alternative is casual (rank 1) and so sits
    // below the ceiling tier — it must NOT be promoted just because it is unused.
    const rows = [
      row({ id: "inBand", name: "In Band", category: "TOPS", formality: "business-formal" }),
      row({ id: "freshCasual", name: "Fresh Casual", category: "TOPS", formality: "casual" }),
    ];
    assert.equal(await pick(rows, sig("girls-night", "formality-occasion", ["inBand"])), "inBand",
      "the ceiling/floor tiers rank above diversity");
  });

  test("RD-C.2 an occasion-incompatible alternative is never chosen", async () => {
    const rows = [
      row({ id: "ok", name: "OK", category: "TOPS", occasions: ["party"] }),
      row({ id: "wrongOccasion", name: "Wrong", category: "TOPS", occasions: ["active"],
        styleMeProfile: { profileStatus: "approved", occasionFit: { "night-out": "No" },
          intentionPotentials: null } }),
    ];
    assert.equal(await pick(rows, sig("girls-night", "formality-occasion", ["ok"])), "ok");
  });

  test("RD-C.3 a HEM-based dressing requirement is never overridden by diversity", async () => {
    // legs-covered is evaluated from hemLength, which the anchor pre-filter does supply.
    const rows = [
      row({ id: "longSkirt", name: "Long Skirt", category: "BOTTOMS", hemLength: "maxi" }),
      row({ id: "miniSkirt", name: "Mini Skirt", category: "BOTTOMS", hemLength: "mini" }),
    ];
    const got = await autoSelectClosetAnchor("cust", {
      ...sig("girls-night", "formality-occasion", ["longSkirt"]),
      dressingPreferences: ["legs-covered"],
    } as never, async () => rows as never);
    assert.equal(got?.id ?? null, "longSkirt",
      "a Passport dressing requirement the gate can evaluate outranks the diversity preference");
  });

  test("RD-C.3b a sleeveless anchor is CORRECTLY allowed — arms-covered is compensable", async () => {
    // Not a gap. passesDressingRequirements is the item-level gate and deliberately applies
    // ONLY non-compensable rules — legs-covered (hemLength) and no-cropped-tops (topLength).
    // Its own contract says so: "Compensable requirements (arms-covered,
    // chest-neckline-covered, dresses-modestly) are evaluated at the complete-outfit level
    // in passesCandidateDressingRequirements, never rejected at item-selection time."
    //
    // A sleeveless top plus a sleeved blazer satisfies arms-covered, so rejecting it at the
    // anchor would discard outfits that are perfectly valid. The enforcement happens after
    // assembly, where layering can be seen. RD-D covers that half.
    const rows = [
      row({ id: "covered", name: "Covered", category: "TOPS", sleeveLength: "full" }),
      row({ id: "bare", name: "Bare", category: "TOPS", sleeveLength: "sleeveless" }),
    ];
    const got = await autoSelectClosetAnchor("cust", {
      ...sig("girls-night", "formality-occasion", ["covered"]),
      dressingPreferences: ["arms-covered"],
    } as never, async () => rows as never);
    assert.equal(got?.id ?? null, "bare",
      "the item-level gate must not pre-reject a compensable exposure");
  });

  test("RD-C.4 the single-point-band fallback still decides when it applies", async () => {
    // family + Smart casual resolves to 2-2 with nothing in band; ST13's fallback prefers the
    // above-band anchor. Diversity must not override that even though it is the previous one.
    const rows = [
      row({ id: "jeans", name: "Jeans", category: "BOTTOMS", formality: "casual", occasions: ["family"] }),
      row({ id: "trousers", name: "Trousers", category: "BOTTOMS", formality: "business-casual", occasions: ["family"] }),
    ];
    assert.equal(await pick(rows, sig("family", "formality-smart", ["trousers"])), "trousers",
      "the ST13 fallback ranks above diversity");
  });
});

// ── RD-D: the other half — the candidate gate enforces what the anchor cannot ─
//
// Anchor eligibility and outfit eligibility are two deliberately different questions.
// passesDressingRequirements asks "could this item ever satisfy the requirement?" and so
// applies only non-compensable rules. passesCandidateDressingRequirements asks "does this
// assembled outfit satisfy it?" and can see the layering that compensates.
//
// Reroll diversity may surface a fresh sleeveless anchor. These prove that cannot ship an
// uncovered outfit: the candidate gate rejects it unless something actually covers the zone,
// and when every candidate is rejected filteredCandidates empties and the existing
// sameCombination path keeps the previous look.

describe("RD-D — a diverse anchor cannot smuggle a coverage violation into the outfit", () => {
  const g = (o: Record<string, unknown>) => ({
    type: "closet", subcategory: null, colors: [], primaryColor: null, pattern: null,
    material: null, styleTags: [], occasions: ["party"], imageUrl: null,
    garmentRelationships: [], formality: "business-formal", fitProfile: null, waistShape: null,
    sleeveLength: null, necklineCoverage: null, hemLength: null, topLength: null,
    shoulderCoverage: null, midriffExposed: null, silhouette: null, stylePersonality: null,
    approvedProfile: null, ...o,
  });
  const candidate = (pieces: Array<[string, string]>) =>
    ({ id: "X", pieces: pieces.map(([slot, closetId]) => ({ slot, closetId, label: closetId })) });

  const items = [
    g({ id: "bare", category: "TOPS", sleeveLength: "sleeveless" }),
    g({ id: "trousers", category: "BOTTOMS", hemLength: "full" }),
    g({ id: "sleevedBlazer", category: "OUTERWEAR", sleeveLength: "full" }),
    g({ id: "vest", category: "OUTERWEAR", sleeveLength: "sleeveless" }),
  ];

  test("RD-D.1 sleeveless base with NO covering layer is rejected", () => {
    assert.equal(
      passesCandidateDressingRequirements(
        candidate([["top", "bare"], ["bottom", "trousers"]]) as never,
        items as never, ["arms-covered"]),
      false);
  });

  test("RD-D.2 the same base WITH a sleeved layer is accepted", () => {
    assert.equal(
      passesCandidateDressingRequirements(
        candidate([["top", "bare"], ["bottom", "trousers"], ["outerwear", "sleevedBlazer"]]) as never,
        items as never, ["arms-covered"]),
      true, "layering is exactly what makes this requirement compensable");
  });

  test("RD-D.3 a sleeveless layer does not compensate", () => {
    assert.equal(
      passesCandidateDressingRequirements(
        candidate([["top", "bare"], ["bottom", "trousers"], ["outerwear", "vest"]]) as never,
        items as never, ["arms-covered"]),
      false);
  });

  test("RD-D.4 no dressing requirement means no rejection", () => {
    assert.equal(
      passesCandidateDressingRequirements(
        candidate([["top", "bare"], ["bottom", "trousers"]]) as never, items as never, []),
      true);
  });
});
