// app/lib/ai/colour-family.test.ts
//
// B2a behavioral suite: normalization, exact/alias/compound/multicolour
// resolution, unknown handling, and the overlap primitive — including
// every disagreement row from the B2 recon's causal matrix, both the ones
// where family resolution helps and the one (chocolate brown) where it
// doesn't. Deterministic, pure — no DB, no AI, no network.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolveCanonicalColourFamilies,
  resolveFreeTextColourFamilies,
  colourFamiliesOverlap,
} from "./colour-family";

describe("normalization — mechanical, predictable, never strips modifier words", () => {
  it("case-insensitive", () => {
    assert.deepEqual(resolveCanonicalColourFamilies("Navy"), resolveCanonicalColourFamilies("navy"));
    assert.deepEqual(resolveCanonicalColourFamilies("NAVY"), resolveCanonicalColourFamilies("navy"));
  });
  it("leading/trailing whitespace trimmed", () => {
    assert.deepEqual(resolveCanonicalColourFamilies("  navy  "), resolveCanonicalColourFamilies("navy"));
  });
  it("repeated internal whitespace collapsed", () => {
    assert.deepEqual(resolveCanonicalColourFamilies("dark   blue"), resolveCanonicalColourFamilies("dark blue"));
  });
  it("exact canonical resolution does NOT split on hyphens — 'off-black' is looked up as one literal key, not fragmented", () => {
    const r = resolveCanonicalColourFamilies("off-black");
    assert.equal(r.isNeutral, true);
    assert.deepEqual(r.hueFamilies, ["grey"]);
    assert.deepEqual(r.passportFamilies, ["black"]);
  });
});

describe("exact matches", () => {
  it("black resolves (neutral, no hue family, no passport family — matches real source exactly)", () => {
    const r = resolveCanonicalColourFamilies("black");
    assert.equal(r.isNeutral, true);
    assert.deepEqual(r.hueFamilies, []);
    assert.deepEqual(r.passportFamilies, []);
    assert.equal(r.unknown, false);
  });
  it("white resolves to white-cream passport family, no hue family", () => {
    const r = resolveCanonicalColourFamilies("white");
    assert.equal(r.isNeutral, true);
    assert.deepEqual(r.hueFamilies, []);
    assert.deepEqual(r.passportFamilies, ["white-cream"]);
  });
  it("navy resolves to both a hue family and a passport family, plus neutral — independent axes", () => {
    const r = resolveCanonicalColourFamilies("navy");
    assert.equal(r.isNeutral, true);
    assert.deepEqual(r.hueFamilies, ["blue"]);
    assert.deepEqual(r.passportFamilies, ["navy"]);
  });
});

describe("free-text compound fallback — exact first, tokenize only if unexplained, word-boundary only", () => {
  it("chocolate brown -> brown family (tokenizes since 'chocolate brown' is not itself a canonical key)", () => {
    const r = resolveFreeTextColourFamilies("chocolate brown");
    assert.deepEqual(r.hueFamilies, ["brown"]);
    assert.deepEqual(r.passportFamilies, ["beige-brown"]);
    assert.equal(r.unknown, false);
  });
  it("deep navy -> blue family", () => {
    const r = resolveFreeTextColourFamilies("deep navy");
    assert.deepEqual(r.hueFamilies, ["blue"]);
    assert.deepEqual(r.passportFamilies, ["navy"]);
  });
  it("soft burgundy -> red family", () => {
    const r = resolveFreeTextColourFamilies("soft burgundy");
    assert.deepEqual(r.hueFamilies, ["red"]);
    assert.deepEqual(r.passportFamilies, ["red-burgundy"]);
  });
  it("charcoal grey -> grey family, resolved directly as a literal compound key (no tokenizing needed)", () => {
    const r = resolveFreeTextColourFamilies("charcoal grey");
    assert.deepEqual(r.hueFamilies, ["grey"]);
    assert.deepEqual(r.passportFamilies, ["grey"]);
  });
  it("camel brown -> brown family (both words independently resolve to the same family)", () => {
    const r = resolveFreeTextColourFamilies("camel brown");
    assert.deepEqual(r.hueFamilies, ["brown"]);
    assert.deepEqual(r.passportFamilies, ["beige-brown"]);
  });
  it("sky blue -> blue family, resolved directly as a literal compound key", () => {
    const r = resolveFreeTextColourFamilies("sky blue");
    assert.deepEqual(r.hueFamilies, ["blue"]);
  });
  it("a pure modifier word with no colour meaning contributes nothing and is not an error", () => {
    const r = resolveFreeTextColourFamilies("deep");
    assert.equal(r.unknown, true);
  });
  it("never infers a family from a substring fragment — 'bred' does not resolve 'red', 'scream' does not resolve 'cream'", () => {
    assert.equal(resolveFreeTextColourFamilies("bred").unknown, true);
    assert.equal(resolveFreeTextColourFamilies("scream").unknown, true);
  });
});

describe("ambiguous multi-colour strings — union across tokens, never collapsed to one arbitrary family", () => {
  it("black and white -> both recognised, no hue family for either (both achromatic), one passport family (white-cream)", () => {
    const r = resolveFreeTextColourFamilies("black and white");
    assert.deepEqual(r.hueFamilies, []);
    assert.deepEqual(r.passportFamilies, ["white-cream"]);
    assert.equal(r.isNeutral, true);
    assert.equal(r.unknown, false);
  });
  it("red and blue -> two distinct hue families, both present", () => {
    const r = resolveFreeTextColourFamilies("red and blue");
    assert.deepEqual(r.hueFamilies, ["red", "blue"]);
  });
  it("navy with cream -> blue hue family; white-cream + navy passport families (fixed canonical order), neutral", () => {
    const r = resolveFreeTextColourFamilies("navy with cream");
    assert.deepEqual(r.hueFamilies, ["blue"]);
    assert.deepEqual(r.passportFamilies, ["white-cream", "navy"]);
    assert.equal(r.isNeutral, true);
  });
  it("burgundy / brown -> two distinct hue families and two distinct passport families, both present, fixed canonical order", () => {
    const r = resolveFreeTextColourFamilies("burgundy / brown");
    assert.deepEqual(r.hueFamilies, ["red", "brown"]);
    assert.deepEqual(r.passportFamilies, ["beige-brown", "red-burgundy"]);
  });
  it("blue-grey -> both families returned, no invented priority (nothing in the canonical source ranks them)", () => {
    const r = resolveFreeTextColourFamilies("blue-grey");
    assert.deepEqual(r.hueFamilies, ["blue", "grey"]);
    assert.deepEqual(r.passportFamilies, ["grey"]);
  });
  it("deterministic ordering is independent of input word order", () => {
    const a = resolveFreeTextColourFamilies("red and blue");
    const b = resolveFreeTextColourFamilies("blue and red");
    assert.deepEqual(a.hueFamilies, b.hueFamilies);
  });
});

describe("unknown handling — explicit empty representation, never a manufactured conflict", () => {
  for (const [label, value] of [
    ["null", null], ["undefined", undefined], ["empty string", ""], ["whitespace", "   "],
    ["unknown sentinel", "unknown"], ["n/a sentinel", "n/a"],
  ] as const) {
    it(`${label} -> fully empty, unknown=true`, () => {
      const r = resolveCanonicalColourFamilies(value as any);
      assert.deepEqual(r, { hueFamilies: [], isNeutral: false, passportFamilies: [], unknown: true });
      const rFree = resolveFreeTextColourFamilies(value as any);
      assert.deepEqual(rFree, { hueFamilies: [], isNeutral: false, passportFamilies: [], unknown: true });
    });
  }

  it("random non-colour prose -> unknown", () => {
    assert.equal(resolveFreeTextColourFamilies("a beautifully tailored piece").unknown, true);
  });

  it("a low-confidence annotation string accidentally passed through -> unknown, not a false colour match", () => {
    assert.equal(resolveFreeTextColourFamilies("low — image quality limits assessment").unknown, true);
  });

  it("unknown never produces a non-empty family array", () => {
    const r = resolveFreeTextColourFamilies("iridescent holographic");
    assert.deepEqual(r.hueFamilies, []);
    assert.deepEqual(r.passportFamilies, []);
  });
});

describe("overlap primitive — pure family-intersection fact, no policy", () => {
  it("black vs black: NOT an overlap by this primitive — black has no hue/passport family entry in the real source, so family-intersection is correctly empty even for an identical string. Exact-string identity is a different, feature-specific question this primitive deliberately does not answer.", () => {
    assert.equal(colourFamiliesOverlap(resolveCanonicalColourFamilies("black"), resolveCanonicalColourFamilies("black")), false);
  });
  it("white vs white: share the white-cream passport family -> overlap", () => {
    assert.equal(colourFamiliesOverlap(resolveCanonicalColourFamilies("white"), resolveCanonicalColourFamilies("white")), true);
  });

  // Causal-matrix disagreements the B2 recon found — family resolution recognises these:
  it("navy vs blue -> overlap (shared hue family 'blue') — the B0-substring false negative", () => {
    assert.equal(colourFamiliesOverlap(resolveCanonicalColourFamilies("navy"), resolveCanonicalColourFamilies("blue")), true);
  });
  it("burgundy vs red -> overlap (shared passport family 'red-burgundy' AND shared hue family 'red')", () => {
    assert.equal(colourFamiliesOverlap(resolveCanonicalColourFamilies("burgundy"), resolveCanonicalColourFamilies("red")), true);
  });
  it("red vs burgundy (reverse direction) -> overlap", () => {
    assert.equal(colourFamiliesOverlap(resolveCanonicalColourFamilies("red"), resolveCanonicalColourFamilies("burgundy")), true);
  });
  it("camel vs brown -> overlap (shared hue family 'brown' and passport family 'beige-brown')", () => {
    assert.equal(colourFamiliesOverlap(resolveCanonicalColourFamilies("camel"), resolveCanonicalColourFamilies("brown")), true);
  });
  it("camel vs tan -> overlap", () => {
    assert.equal(colourFamiliesOverlap(resolveCanonicalColourFamilies("camel"), resolveCanonicalColourFamilies("tan")), true);
  });
  it("charcoal vs grey -> overlap (shared hue family 'grey' and passport family 'grey')", () => {
    assert.equal(colourFamiliesOverlap(resolveCanonicalColourFamilies("charcoal"), resolveCanonicalColourFamilies("grey")), true);
  });

  // The one case substring caught that a naive family-only approach would miss —
  // proven here via the free-text resolver, which is exactly why it exists.
  it("chocolate brown vs brown -> overlap, but only via resolveFreeTextColourFamilies, NOT resolveCanonicalColourFamilies", () => {
    const canonical = colourFamiliesOverlap(resolveCanonicalColourFamilies("chocolate brown"), resolveCanonicalColourFamilies("brown"));
    assert.equal(canonical, false, "resolveCanonicalColourFamilies correctly does NOT know 'chocolate brown' — it has no compound-token fallback by design");
    const freeText = colourFamiliesOverlap(resolveFreeTextColourFamilies("chocolate brown"), resolveFreeTextColourFamilies("brown"));
    assert.equal(freeText, true, "resolveFreeTextColourFamilies recovers it via word-boundary tokenization");
  });

  // Negative proofs — distinct colours must NOT overlap. A utility that only
  // ever says "more things match" has not been proven correct.
  it("red vs blue -> no overlap", () => {
    assert.equal(colourFamiliesOverlap(resolveCanonicalColourFamilies("red"), resolveCanonicalColourFamilies("blue")), false);
  });
  it("khaki vs olive -> no overlap (khaki has no hue family in the real source — deliberately removed from COLOUR_FAMILY_MAP)", () => {
    assert.equal(colourFamiliesOverlap(resolveCanonicalColourFamilies("khaki"), resolveCanonicalColourFamilies("olive")), false);
  });
  it("charcoal vs black -> no overlap (near-but-distinct; charcoal's passport family is 'grey', black has none)", () => {
    assert.equal(colourFamiliesOverlap(resolveCanonicalColourFamilies("charcoal"), resolveCanonicalColourFamilies("black")), false);
  });
  it("beige vs cream -> no overlap (both beige-adjacent neutrals, but different passport families: beige-brown vs white-cream)", () => {
    assert.equal(colourFamiliesOverlap(resolveCanonicalColourFamilies("beige"), resolveCanonicalColourFamilies("cream")), false);
  });
  it("green vs purple -> no overlap", () => {
    assert.equal(colourFamiliesOverlap(resolveCanonicalColourFamilies("green"), resolveCanonicalColourFamilies("purple")), false);
  });
  it("unknown input never overlaps with anything, including another unknown", () => {
    assert.equal(colourFamiliesOverlap(resolveFreeTextColourFamilies("iridescent"), resolveFreeTextColourFamilies("red")), false);
    assert.equal(colourFamiliesOverlap(resolveFreeTextColourFamilies(null), resolveFreeTextColourFamilies(null)), false);
  });
  it("asymmetric sources compose correctly: a free-text candidate vs a canonical Closet colour", () => {
    // Exactly the realistic B2b/B2c shape: one side is AI prose, the other is reviewed data.
    assert.equal(colourFamiliesOverlap(resolveFreeTextColourFamilies("deep navy"), resolveCanonicalColourFamilies("blue")), true);
    assert.equal(colourFamiliesOverlap(resolveFreeTextColourFamilies("soft burgundy"), resolveCanonicalColourFamilies("green")), false);
  });
});
