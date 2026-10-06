// app/lib/styleme/nadine-hero-selection.test.ts
//
// PHASE B — NADINE + My Closet: at most one NADINE hero, the rest from her closet.
//
// THREE CONTEXTS, ONE ENGINE:
//
//   naia                     closet only; the catalogue must never leak in
//   nadine / My Closet       closet only
//   nadine / NADINE + Closet exactly one eligible live NADINE hero + owned closet pieces
//
// TWO SETS THAT MUST NEVER BECOME SYNONYMS (NH-A.4 exists to stop that):
//
//   LIVE_NADINE_STYLING_HANDLES   what the engine may AUTO-SELECT. Five pieces.
//   LOCKED_CATALOGUE_HANDLES      what a customer may hand off from a PDP by tapping
//                                 "Style this piece". A superset: a product can be
//                                 purchasable, and so legitimately handoff-able, while
//                                 being outside the curated auto-selection set.
//
// Collapsing the second into the first would silently break "Style this piece" on every
// published PDP outside the live five. Collapsing the first into the second would let the
// engine merchandise historical stock nobody has curated.
//
// WHY OCCASION HAD TO BECOME A HARD GATE. checkHardExclusions covers self-exclusion, slot
// exclusions, firm-no colours and dressing preferences — not occasion. Occasion was only a
// soft score (+bonus when rankings.occasionTags includes session.occasion), so a product
// tagged for none of her occasions could still win on mood and feeling alone. For a
// five-piece collection that is the difference between a considered recommendation and
// pushing whatever is in stock.
//
// FIXTURE NOTE — "dinner" is the one occasion all five live pieces carry, so it is the
// only session value that leaves the full set eligible. Ranking tests use it deliberately;
// occasion-gate tests use "work" (only asymmetrical-pants and oversized-blazer) and
// "family" (none of the five).

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { runRecommendation } from "../ai/styleme-recommendation.js";
import { getProductByHandle } from "../ai/naia-catalog.js";
import { LOCKED_CATALOGUE_HANDLES } from "../ai/naia-product-media.js";
import {
  CANONICAL_REGISTER_BANDS,
  FORMALITY_CONDITIONAL_ADJUSTMENTS,
  resolveCanonicalRegisterBand,
} from "../ai/styleme-profile-gate.js";
import {
  LIVE_NADINE_STYLING_HANDLES,
  getLiveNadineStylingProducts,
} from "./live-nadine-catalogue.js";
import type { StyleMeSessionInput, StyleMeEngineInput } from "../ai/styleme-recommendation.types.js";

const LIVE_FIVE = [
  "double-top",
  "asymmetrical-pants",
  "oversized-blazer",
  "draped-leather-pants",
  "leather-suede-jacket",
] as const;

const S = (o: Partial<StyleMeSessionInput> & { occasion: string }): StyleMeSessionInput => ({
  moods: [], desiredFeelings: [], bodyNeeds: ["nothing-specific"], coverageConditional: null,
  formalityConditional: null, todayColours: { preferred: [], avoid: [] },
  practicalIds: [], source: "both", state: "nothing-in-particular", intentions: [],
  ...o,
} as unknown as StyleMeSessionInput);

/** NADINE + My Closet: nadine mode, source "both", no explicit NADINE anchor. */
const mixed = (session: StyleMeSessionInput, profile?: unknown) =>
  runRecommendation({ session, profile, mode: "nadine" } as unknown as StyleMeEngineInput);

// ── NH-A: the live set, and its separation from the handoff allowlist ──────

describe("NH-A — the live styling set is explicit and distinct", () => {
  test("NH-A.1 it is exactly the five approved handles", () => {
    assert.deepEqual([...LIVE_NADINE_STYLING_HANDLES].sort(), [...LIVE_FIVE].sort());
  });

  test("NH-A.2 every live handle resolves to a real catalogue product", () => {
    for (const h of LIVE_NADINE_STYLING_HANDLES) {
      assert.ok(getProductByHandle(h), `${h} must exist in getAllCatalogProducts()`);
    }
  });

  test("NH-A.3 the live set cannot drift from the catalogue silently", () => {
    const live = getLiveNadineStylingProducts().map((p) => p.handle).sort();
    assert.deepEqual(live, [...LIVE_FIVE].sort(),
      "getLiveNadineStylingProducts must return exactly the live set — no more, no fewer");
  });

  test("NH-A.4 the live set is NOT the PDP handoff allowlist", () => {
    // The guard this file exists for. A future engineer must not be able to make these
    // synonymous without this failing.
    const allow = new Set<string>(LOCKED_CATALOGUE_HANDLES as readonly string[]);
    for (const h of LIVE_NADINE_STYLING_HANDLES) {
      assert.ok(allow.has(h),
        `${h} is auto-selectable, so a customer tapping its PDP must also be able to hand it off`);
    }
    assert.ok(
      allow.size > LIVE_NADINE_STYLING_HANDLES.length,
      "the handoff allowlist must remain a strict superset: a product can be purchasable, " +
      "and so handoff-able, without being in the curated auto-selection set. If these two " +
      "ever become equal, 'Style this piece' has been silently broken on published PDPs " +
      "outside the live five — or the engine has been given historical stock to merchandise.",
    );
  });

  test("NH-A.5 handles absent from the catalogue are not in the allowlist", () => {
    // cropped-top and straight-pants had media entries but no catalogue product, so they
    // were already unresolvable — dead config that made the next miss harder to see.
    for (const gone of ["cropped-top", "straight-pants"]) {
      assert.ok(!(LOCKED_CATALOGUE_HANDLES as readonly string[]).includes(gone),
        `${gone} has no catalogue product and must not be allowlisted`);
    }
  });
});

// ── NH-B: nAia isolation — guards, green before and after ─────────────────

describe("NH-B — nAia and NADINE-My-Closet stay closet-only", () => {
  test("NH-B.1 nAia mode surfaces no product at all", () => {
    const r = runRecommendation({
      session: S({ occasion: "dinner" }), mode: "naia",
    } as unknown as StyleMeEngineInput);
    assert.equal(r.primary, null);
    assert.deepEqual(r.alternatives, []);
    assert.deepEqual(r.evaluatedProducts, []);
    assert.equal(r.coverage.totalCatalogProducts, 0);
  });

  test("NH-B.2 nAia mode is unaffected by occasion or signals", () => {
    for (const occ of ["dinner", "work", "family", "girls-night"]) {
      const r = runRecommendation({
        session: S({ occasion: occ, desiredFeelings: ["more-confident"], moods: ["confident"] }),
        mode: "naia",
      } as unknown as StyleMeEngineInput);
      assert.equal(r.primary, null, `nAia must stay closet-only for ${occ}`);
    }
  });
});

// ── NH-C: one hero, and only from the live set ────────────────────────────

describe("NH-C — NADINE + Closet selects exactly one live hero", () => {
  test("NH-C.1 an eligible live hero is selected", () => {
    const r = mixed(S({ occasion: "dinner", desiredFeelings: ["more-confident"] }));
    assert.ok(r.primary, "a live NADINE hero must be selected when one is eligible");
    assert.ok(
      (LIVE_NADINE_STYLING_HANDLES as readonly string[]).includes(r.primary!.handle),
      `the hero must come from the live set; got ${r.primary!.handle}`,
    );
  });

  test("NH-C.2 exactly one NADINE hero — never a second through alternatives", () => {
    // Replaces an earlier assertion that only said "at most one". That was satisfiable by
    // zero, which is exactly what the unfixed code returns, so it proved nothing.
    const r = mixed(S({ occasion: "dinner", desiredFeelings: ["more-confident"] }));
    const heroes = (r.primary ? 1 : 0) + r.alternatives.length;
    assert.equal(heroes, 1,
      `exactly one NADINE piece may appear; got ${heroes} ` +
      `(primary=${r.primary?.handle ?? "none"}, alternatives=${r.alternatives.map((a) => a.handle).join(",") || "none"})`);
  });

  test("NH-C.3 no non-live catalogue product can be auto-selected", () => {
    // collar-shirt carries "work" and would otherwise be a strong work candidate.
    for (const occ of ["work", "dinner", "everyday", "date-night", "girls-night", "travel", "special-event"]) {
      const r = mixed(S({ occasion: occ }));
      if (!r.primary) continue;
      assert.ok(
        (LIVE_NADINE_STYLING_HANDLES as readonly string[]).includes(r.primary.handle),
        `${occ}: selected ${r.primary.handle}, which is not in the live set`,
      );
      for (const alt of r.alternatives) {
        assert.ok((LIVE_NADINE_STYLING_HANDLES as readonly string[]).includes(alt.handle),
          `${occ}: alternative ${alt.handle} is not in the live set`);
      }
    }
  });

  test("NH-C.4 only live products are ever evaluated", () => {
    const r = mixed(S({ occasion: "dinner" }));
    for (const e of r.evaluatedProducts) {
      assert.ok((LIVE_NADINE_STYLING_HANDLES as readonly string[]).includes(e.handle),
        `${e.handle} was evaluated but is not live — the pool must be the live set only`);
    }
  });
});

// ── NH-D: occasion is a hard gate ────────────────────────────────────────

describe("NH-D — canonical occasion compatibility is required, not merely scored", () => {
  test("NH-D.1 a live product not tagged for the occasion is never the hero", () => {
    // work is carried only by asymmetrical-pants and oversized-blazer.
    const allowed = new Set(["asymmetrical-pants", "oversized-blazer"]);
    const r = mixed(S({ occasion: "work" }));
    if (r.primary) {
      assert.ok(allowed.has(r.primary.handle),
        `work: ${r.primary.handle} is not tagged for work and must not be selected`);
    }
    for (const e of r.evaluatedProducts.filter((x) => !x.isHardExcluded)) {
      assert.ok(allowed.has(e.handle),
        `work: ${e.handle} survived the gates but is not tagged for work`);
    }
  });

  test("NH-D.2 an occasion no live piece carries yields no hero at all", () => {
    // None of the five is tagged family or active — closet-only is the correct answer.
    for (const occ of ["family", "active"]) {
      const r = mixed(S({ occasion: occ }));
      assert.equal(r.primary, null,
        `${occ}: no live piece is tagged for it, so no hero may be forced`);
    }
  });

  test("NH-D.3 the NADINE vocabulary needs no closet-style bridge", () => {
    // occasionTags are already canonical — date-night, girls-night, special-event — unlike
    // closet occasionFit, which is keyed on the admin spelling and needs CANONICAL_OCCASION_
    // TO_PROFILE_KEY. Pins the asymmetry so nobody "fixes" it by adding a bridge here.
    for (const canonical of ["date-night", "girls-night", "special-event"]) {
      const anyTagged = LIVE_FIVE.some((h) =>
        getProductByHandle(h)!.parsed.rankings.occasionTags.includes(canonical));
      assert.ok(anyTagged, `${canonical} must match NADINE occasionTags verbatim`);
    }
  });
});

// ── NH-E: dressing / coverage hard requirements ───────────────────────────

describe("NH-E — dressing and coverage requirements are respected", () => {
  test("NH-E.1 a firm-no colour removes every piece carrying it", () => {
    // The hard colour gate reads profile.firmNoColors — a PASSPORT constraint — in the
    // COLOR_VOCAB_MAP id space. The first draft of this test used
    // session.todayColours.avoid, which is today's soft preference and reaches a different
    // code path entirely: it passed nothing to firmNoColorIds and so proved nothing.
    //
    // "burgundy" and "rust" both map to red-burgundy, which four of the five live pieces
    // carry. Only draped-leather-pants (taupe) is free of it.
    const r = mixed(S({ occasion: "dinner" }), { firmNoColors: ["red-burgundy"] });
    assert.ok(r.primary, "one live piece carries no burgundy, so a hero must remain");
    assert.equal(r.primary!.handle, "draped-leather-pants",
      `only the taupe piece survives a red-burgundy firm-no; got ${r.primary!.handle}`);
    for (const e of r.evaluatedProducts.filter((x) => !x.isHardExcluded)) {
      const colors = getProductByHandle(e.handle)!.parsed.identity.colors
        .map((c: string) => c.toLowerCase());
      assert.ok(!colors.some((c) => c.includes("burgundy") || c.includes("rust")),
        `${e.handle} survived the gate but carries a firm-no colour`);
    }
  });

  test("NH-E.2 a dressing preference reaches the exclusion path", () => {
    const withPref = mixed(
      S({ occasion: "dinner" }),
      { dressingPreferences: ["legs-covered", "arms-covered", "dresses-modestly"] },
    );
    // Not asserting a specific outcome: the point is the gate runs and the result stays
    // coherent rather than throwing or inventing a piece.
    if (withPref.primary) {
      assert.ok((LIVE_NADINE_STYLING_HANDLES as readonly string[]).includes(withPref.primary.handle));
    }
    assert.ok(Array.isArray(withPref.evaluatedProducts));
  });
});

// ── NH-F: soft signals rank, they do not veto ────────────────────────────

describe("NH-F — soft signals change the ranking among eligible pieces", () => {
  test("NH-F.1 desired feeling moves which live piece leads", () => {
    // more-feminine is carried only by double-top; more-effortless only by
    // oversized-blazer and leather-suede-jacket. Same occasion, different winner.
    const feminine = mixed(S({ occasion: "dinner", desiredFeelings: ["more-feminine"] }));
    const effortless = mixed(S({ occasion: "dinner", desiredFeelings: ["more-effortless"] }));
    assert.ok(feminine.primary && effortless.primary, "both sessions must produce a hero");
    assert.notEqual(
      feminine.primary!.handle, effortless.primary!.handle,
      "a signal only one piece carries must change the winner; " +
      `both returned ${feminine.primary!.handle}`,
    );
  });

  test("NH-F.2 a soft miss does not exclude — the pool stays populated", () => {
    // romantic is carried only by double-top. The other four must still be eligible.
    const r = mixed(S({ occasion: "dinner", moods: ["romantic"] }));
    const survivors = r.evaluatedProducts.filter((e) => !e.isHardExcluded).length;
    assert.ok(survivors > 1,
      `a soft signal must not veto; only ${survivors} piece(s) survived for dinner`);
  });
});

// ── NH-G: zero eligible → valid closet-led result ────────────────────────

describe("NH-G — no qualifying live piece means closet-led, not forced merchandise", () => {
  test("NH-G.1 the result is coherent with no hero", () => {
    const r = mixed(S({ occasion: "family" }));
    assert.equal(r.primary, null);
    assert.deepEqual(r.alternatives, [], "no hero means no alternatives either");
    assert.ok(r.outcome, "an outcome must still be reported");
  });

  test("NH-G.2 a closet anchor still leads when no live piece qualifies", () => {
    const r = runRecommendation({
      session: S({ occasion: "family" }),
      mode: "nadine",
      anchor: {
        type: "closet", id: "c1", name: "Her Own Top", category: "TOPS", colors: ["black"],
        primaryColor: "black", occasions: ["family"], styleTags: [], garmentRelationships: [],
      },
    } as unknown as StyleMeEngineInput);
    assert.equal(r.primary, null, "no live piece is tagged family, so none may be forced");
    assert.ok(r.anchor, "her own anchor must still lead the look");
  });
});

// ── NH-R: register is a PERMISSION, not a score ───────────────────────────
//
// Register had no eligibility rule at all. checkHardExclusions covers self-exclusion,
// slot, firm-no colours and dressing preferences; formality was soft points only, and
// MIN_TOTAL_SCORE of 2 cannot stand in for a gate against scores of ~30. Proven before
// the fix: `work` + formality-relaxed selected a rank-4 trouser against its band.
//
// The cause was two tables. The catalogue scorer read relaxed {1,3} / smart {2,4} /
// polished {3,5} / occasion {4,5}; the closet path read {1,2} / {2,3} / {3,4} / {4,6}.
// One answer, two meanings, in the same session.
//
// ELIGIBILITY AND SCORING ARE NOW DELIBERATELY DIFFERENT NUMBERS. Permission comes from
// CANONICAL_REGISTER_BANDS, shared with the closet path. Ranking affinity keeps the wider
// catalogue windows, because narrowing those would silently re-rank all eleven products
// and change a legacy path this feature has no business touching. NH-R.8 asserts the two
// are not equal, so nobody "tidies" them back together.
//
// The live collection is ranks 3-4, which is what makes these assertions bite.

describe("NH-R — canonical register eligibility", () => {
  const band = (f: string | null) => S({ occasion: "dinner", formalityConditional: f } as never);
  const rank = (h: string) => getProductByHandle(h)!.parsed.scalars.formalityScore;
  const pool = (f: string | null) =>
    mixed(band(f)).evaluatedProducts.filter((e) => !e.isHardExcluded).map((e) => e.handle).sort();

  test("NH-R.1 explicit Relaxed {1,2} yields no live hero — closet-only", () => {
    const r = mixed(band("formality-relaxed"));
    assert.equal(r.primary, null,
      "the live collection is ranks 3-4; nothing is inside {1,2}, and her request must " +
      "not be widened to manufacture a hero");
    assert.deepEqual(pool("formality-relaxed"), []);
  });

  test("NH-R.2 explicit Smart {2,3} admits only the rank-3 pieces", () => {
    assert.deepEqual(pool("formality-smart"), ["draped-leather-pants", "leather-suede-jacket"]);
    for (const h of pool("formality-smart")) assert.equal(rank(h), 3);
  });

  test("NH-R.3 explicit Polished {3,4} admits rank 3 and rank 4", () => {
    assert.equal(pool("formality-polished").length, 5, "every live piece is rank 3 or 4");
  });

  test("NH-R.4 explicit Dressy {4,6} admits only the rank-4 pieces", () => {
    assert.deepEqual(pool("formality-occasion"),
      ["asymmetrical-pants", "double-top", "oversized-blazer"]);
    for (const h of pool("formality-occasion")) assert.equal(rank(h), 4);
  });

  test("NH-R.5 an out-of-band piece cannot win on stronger soft signals", () => {
    // double-top is the only piece carrying more-feminine and romantic, and it is rank 4.
    // Under Smart {2,3} it is out of band, so no amount of signal may elect it — this is
    // the assertion that distinguishes a gate from a heavy penalty.
    const r = mixed(S({
      occasion: "dinner", formalityConditional: "formality-smart",
      desiredFeelings: ["more-feminine", "more-attractive"], moods: ["romantic"],
    } as never));
    assert.notEqual(r.primary?.handle, "double-top",
      "a rank-4 piece must not win a Smart brief however well it matches on feeling");
    if (r.primary) assert.equal(rank(r.primary.handle), 3);
  });

  test("NH-R.6 no explicit formality → no hard register exclusion", () => {
    // everyday maps to an implicit relaxed for SCORING. That inference must not become a
    // hidden veto: occasion is already a hard gate, and an assumption she never made must
    // not remove garments. Rank-4 pieces therefore stay eligible here.
    const r = mixed(S({ occasion: "everyday", formalityConditional: null } as never));
    const survivors = r.evaluatedProducts.filter((e) => !e.isHardExcluded).map((e) => e.handle);
    assert.ok(survivors.length > 0, "an unanswered dressiness must not empty the pool");
    assert.ok(survivors.some((h) => rank(h) === 4),
      `implicit relaxed must not exclude rank-4 pieces; survivors ${survivors.join(",")}`);
    assert.equal(resolveCanonicalRegisterBand(null), null);
    assert.equal(resolveCanonicalRegisterBand(undefined), null);
    assert.equal(resolveCanonicalRegisterBand(""), null);
  });

  test("NH-R.7 closet and NADINE eligibility read the SAME canonical definition", () => {
    // Identity, not equality — the drift guard. If the NADINE side ever grows its own
    // permission table again, this fails.
    assert.equal(CANONICAL_REGISTER_BANDS, FORMALITY_CONDITIONAL_ADJUSTMENTS,
      "permission semantics must be one object, shared by both paths");
    assert.deepEqual(resolveCanonicalRegisterBand("formality-relaxed"), { min: 1, max: 2 });
    assert.deepEqual(resolveCanonicalRegisterBand("formality-smart"), { min: 2, max: 3 });
    assert.deepEqual(resolveCanonicalRegisterBand("formality-polished"), { min: 3, max: 4 });
    assert.deepEqual(resolveCanonicalRegisterBand("formality-occasion"), { min: 4, max: 6 });
  });

  test("NH-R.8 the scoring window is deliberately NOT the permission window", () => {
    // Eligibility = what she may be shown. Scoring = how the allowed items rank. Keeping
    // them equal would collapse "allowed" into "well matched", and narrowing the scoring
    // table would re-rank all eleven catalogue products. Asserted so a future tidy-up of
    // the two tables into one is a deliberate decision rather than an accident.
    const src = readFileSync(join(process.cwd(), "app/lib/ai/styleme-recommendation.ts"), "utf8");
    assert.ok(src.includes("CATALOGUE_FORMALITY_SCORING_RANGES"),
      "the soft-score table must be named for what it is");
    assert.ok(/"formality-relaxed": \{ target: 2, min: 1, max: 3 \}/.test(src),
      "the catalogue scoring window stays wider than the canonical {1,2}");
    assert.ok(!/const range = FORMALITY_RANGES\[/.test(src),
      "scoring must read the scoring table by its explicit name");
  });
});
