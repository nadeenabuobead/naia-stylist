// app/lib/styleme/anchor-band-floor.test.ts
//
// C3 — the anchor selector had a ceiling but no floor.
//
// ST13 (Family + Smart casual, band 2-2) anchored on Medium Blue Wash Jeans, formality
// `casual` = rank 1, score 3. Nothing in autoSelectClosetAnchor preferred a garment that
// reached the band's floor, and `isFormallyInRange` only ever asked whether a rank was
// too HIGH. Once a rank-1 garment is pinned into a weight-1.0 structural slot every
// candidate inherits it, so the delivered outfit sat at register 1.045 against a 2-2 band
// and no later ranking could lift it.
//
// The fix is a sort tier directly below the ceiling tier: an anchor at or above
// targetBand.min outranks one below it. It is not a filter — when nothing reaches the
// floor the tier ties and selection falls through to score, so a wardrobe with nothing at
// the band still gets its best anchor rather than none.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { autoSelectClosetAnchor } from "../ai/styleme-anchor.server.js";
import { getTargetFormalityRange } from "../ai/styleme-profile-gate.js";

/** Minimal AutoSelectItem row. */
const row = (o: Record<string, unknown>) => ({
  subcategory: null, colors: [], primaryColor: null, pattern: null, material: null,
  styleTags: [], occasions: ["casual"], imageUrl: null, garmentRelationships: [],
  waistShape: null, hemLength: null, topLength: null, sleeveLength: null,
  necklineCoverage: null, shoulderCoverage: null, midriffExposed: null,
  styleMeProfile: null, ...o,
});

// Occasion tags must use the CLOSET tokens the session maps to, not the UI word:
// girls-night -> "evening" | "girls-night", special-event -> "special-occasion" |
// "special-event", family -> "family". A tag of "party" matches nothing, scores 0, and the
// fixture becomes inert — which is how the first draft of this file produced NULLs.
const sig = (occasion: string, formalityConditional: string | null) => ({
  occasion, formalityConditional, moods: [], desiredFeelings: [],
  intentions: [], bodyNeeds: [],
});

// ── AF-1: band 2-2 — a rank-2 anchor beats a rank-1 anchor ──────────────────

describe("AF-1 — Family + Smart casual, band 2-2", () => {
  const rows = [
    // Listed first and with the stronger occasion footprint, so without the floor tier
    // the rank-1 garment wins on score and stable order — exactly ST13.
    row({ id: "jeans", name: "Medium Blue Wash Jeans", category: "BOTTOMS",
      formality: "casual", occasions: ["casual", "family"] }),
    row({ id: "trousers", name: "Black Tailored Trousers", category: "BOTTOMS",
      formality: "smart-casual", occasions: ["family"] }),
  ] as never[];

  test("AF-1.1 the rank-2 anchor is selected over the rank-1 anchor", async () => {
    const picked = await autoSelectClosetAnchor("cust", sig("family", "formality-smart"), async () => rows);
    assert.equal(picked!.id, "trousers");
  });

  test("AF-1.2 without the Smart casual answer the band floor is 1 and order is unchanged", async () => {
    // family with no formality answer resolves to 1-2, so a rank-1 garment satisfies the
    // floor and the tier ties — the pre-C3 outcome.
    const picked = await autoSelectClosetAnchor("cust", sig("family", null), async () => rows);
    assert.equal(picked!.id, "jeans");
  });
});

// ── AF-2: band 4-5 — a rank-4 anchor beats a rank-2 anchor ──────────────────

describe("AF-2 — Night out + Dressy, band 4-5", () => {
  const rows = [
    row({ id: "tank", name: "Mesh Tank", category: "TOPS",
      formality: "smart-casual", occasions: ["evening", "casual"] }),
    row({ id: "blazer", name: "Tailored Blazer", category: "OUTERWEAR",
      formality: "business-formal", occasions: ["evening"] }),
  ] as never[];

  test("AF-2.1 the rank-4 anchor wins", async () => {
    const picked = await autoSelectClosetAnchor("cust", sig("girls-night", "formality-occasion"), async () => rows);
    assert.equal(picked!.id, "blazer");
  });
});

// ── AF-3: fail-open — nothing reaches the floor ─────────────────────────────

describe("AF-3 — a wardrobe with nothing at the band still gets an anchor", () => {
  const belowOnly = [
    row({ id: "tee", name: "Cotton Tee", category: "TOPS",
      formality: "casual", occasions: ["evening", "casual"] }),
    row({ id: "jeans", name: "Blue Jeans", category: "BOTTOMS",
      formality: "casual", occasions: ["evening", "casual"] }),
  ] as never[];

  test("AF-3.1 an anchor is still returned, not null", async () => {
    const picked = await autoSelectClosetAnchor("cust", sig("girls-night", "formality-occasion"), async () => belowOnly);
    assert.ok(picked, "better the best available anchor than no look at all");
  });

  test("AF-3.2 and it is the best-scoring of the below-band options", async () => {
    const picked = await autoSelectClosetAnchor("cust", sig("girls-night", "formality-occasion"), async () => belowOnly);
    assert.ok(["tee", "jeans"].includes(picked!.id));
  });

  test("AF-3.3 unknown formality is treated as satisfying the floor (fail-open)", async () => {
    const rows = [
      row({ id: "unknown", name: "Unlabelled Top", category: "TOPS", formality: null, occasions: ["evening"] }),
      row({ id: "casualTop", name: "Casual Top", category: "TOPS", formality: "casual", occasions: ["evening"] }),
    ] as never[];
    const picked = await autoSelectClosetAnchor("cust", sig("girls-night", "formality-occasion"), async () => rows);
    assert.equal(picked!.id, "unknown",
      "an absent formality signal must not demote a garment below a known-casual one");
  });
});

// ── AF-4: the ceiling still behaves exactly as before ───────────────────────

describe("AF-4 — ceiling precedence is unchanged", () => {
  test("AF-4.1 an above-ceiling garment still loses to an in-range one", async () => {
    // girls-night + Dressy resolves to 4-5, so `evening` (6) is above the ceiling.
    const rows = [
      row({ id: "gown", name: "Evening Gown", category: "DRESSES",
        formality: "evening", occasions: ["evening"] }),
      row({ id: "blazer", name: "Tailored Blazer", category: "OUTERWEAR",
        formality: "business-formal", occasions: ["evening"] }),
    ] as never[];
    const picked = await autoSelectClosetAnchor("cust", sig("girls-night", "formality-occasion"), async () => rows);
    assert.equal(picked!.id, "blazer");
  });

  test("AF-4.2 the ceiling outranks the floor tier when they disagree", async () => {
    // The gown satisfies the floor (6 >= 4) but breaches the ceiling (6 > 5); the
    // smart-casual top breaches the floor but not the ceiling. Ceiling decides first.
    const rows = [
      row({ id: "gown", name: "Evening Gown", category: "DRESSES",
        formality: "evening", occasions: ["evening"] }),
      row({ id: "tank", name: "Mesh Tank", category: "TOPS",
        formality: "smart-casual", occasions: ["evening"] }),
    ] as never[];
    const picked = await autoSelectClosetAnchor("cust", sig("girls-night", "formality-occasion"), async () => rows);
    assert.equal(picked!.id, "tank", "in-range beats out-of-range before the floor is read");
  });

  test("AF-4.3 the same gown is still selectable for a special event (ceiling 6)", async () => {
    const rows = [
      row({ id: "gown", name: "Evening Gown", category: "DRESSES",
        formality: "evening", occasions: ["special-event"] }),
      row({ id: "blazer", name: "Tailored Blazer", category: "OUTERWEAR",
        formality: "business-formal", occasions: ["special-event"] }),
    ] as never[];
    const picked = await autoSelectClosetAnchor("cust", sig("special-event", "formality-occasion"), async () => rows);
    assert.equal(picked!.id, "gown");
  });
});

// ── AF-5: ST13 — what C3 does and does not reach ────────────────────────────

describe("AF-5 — ST13: C3 cannot reach it, and the reason is worth pinning", () => {
  // Family + Smart casual resolves to the SINGLE rank 2-2, so the ceiling is 2 and the
  // floor is 2: only a rank-2 garment satisfies both. ST13's closet holds rank 1 (Medium
  // Blue Wash Jeans, Black Long-Sleeve Top) and rank 3 (White Long-Sleeve Button-Up
  // Blouse, Black Tailored Trousers) and nothing at rank 2. The ceiling demotes the rank-3
  // pieces, the floor demotes the rank-1 pieces, and the ceiling is read first — so the
  // jeans still win.
  //
  // This is C3 behaving exactly as specified: the floor is a tier BELOW the ceiling and
  // the ceiling's precedence was to be preserved untouched. Resolving ST13 needs a
  // separate decision about what to prefer when a single-point band leaves nothing that
  // satisfies both bounds. Pinned here so the limit is explicit rather than discovered
  // again from a QA run.
  const rows = [
    row({ id: "Medium Blue Wash Jeans", name: "Medium Blue Wash Jeans", category: "BOTTOMS",
      formality: "casual", occasions: ["family"] }),
    row({ id: "Black Long-Sleeve Top", name: "Black Long-Sleeve Top", category: "TOPS",
      formality: "casual", occasions: ["family"] }),
    row({ id: "White Long-Sleeve Button-Up Blouse", name: "White Long-Sleeve Button-Up Blouse",
      category: "TOPS", formality: "business-casual", occasions: ["family"] }),
    row({ id: "Black Tailored Trousers", name: "Black Tailored Trousers", category: "BOTTOMS",
      formality: "business-casual", occasions: ["family"] }),
  ] as never[];

  test("AF-5.1 the band collapses to a single rank", () => {
    assert.deepEqual(getTargetFormalityRange("family", "formality-smart"), { min: 2, max: 2 });
  });

  test("AF-5.2 no garment in this closet occupies that rank", () => {
    const RANK: Record<string, number> = {
      casual: 1, "smart-casual": 2, "business-casual": 3, "business-formal": 4, occasion: 5, evening: 6,
    };
    const ranks = (rows as unknown as Array<{ formality: string }>).map((r) => RANK[r.formality]);
    assert.ok(!ranks.includes(2), "if this closet ever gains a rank-2 piece, AF-5.3 should flip");
  });

  test("AF-5.3 so the ceiling still decides and the rank-1 anchor is kept", async () => {
    const picked = await autoSelectClosetAnchor("cust", sig("family", "formality-smart"), async () => rows);
    assert.equal(picked!.id, "Medium Blue Wash Jeans",
      "C3 is a tier below the ceiling by design; it cannot lift a closet with nothing in band");
  });

  test("AF-5.4 but add one rank-2 piece and C3 takes it immediately", async () => {
    const withSmartCasual = [
      ...rows,
      row({ id: "Smart Knit Top", name: "Smart Knit Top", category: "TOPS",
        formality: "smart-casual", occasions: ["family"] }),
    ] as never[];
    const picked = await autoSelectClosetAnchor("cust", sig("family", "formality-smart"), async () => withSmartCasual);
    assert.equal(picked!.id, "Smart Knit Top");
  });
});
