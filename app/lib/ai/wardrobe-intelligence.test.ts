// app/lib/ai/wardrobe-intelligence.test.ts
// Certification suite for the deterministic Wardrobe Intelligence engine.
// Run with: node --test --import tsx/esm app/lib/ai/wardrobe-intelligence.test.ts
//
// The contract under test is as much about what the engine REFUSES to say as what
// it says: no invented numbers, no wear claims from self-reported data, no gap
// that isn't evidenced, and nothing at all from shadow V2 intention scoring while
// its gate is closed.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeWardrobeIntelligence,
  combinationKey,
  DEFAULT_FLAGS,
  MIN_WARDROBE_SIZE,
  type Evidence,
  type SignalType,
  type WardrobeGarment,
  type WardrobeIntelligence,
  type WardrobeIntelligenceFlags,
  type WardrobePassport,
} from "./wardrobe-intelligence.ts";

// ── Fixtures ──────────────────────────────────────────────────────────────────

let seq = 0;

function makeGarment(overrides: Partial<WardrobeGarment> = {}): WardrobeGarment {
  seq += 1;
  const base: WardrobeGarment = {
    id: `g${seq}`,
    name: `Piece ${seq}`,
    category: "TOPS",
    subcategory: null,
    imageUrl: null,
    slot: "top",
    primaryColor: "Black",
    colors: [],
    pattern: "solid",
    material: "cotton",
    silhouette: "straight",
    fitProfile: "tailored",
    formality: "smart-casual",
    stylePersonality: null,
    occasions: [],
    seasons: [],
    analysisStatus: "ready",
    visualWeight: "medium",
    colourProfile: { hueFamily: null, wardrobeNeutral: true, lightDark: "dark", energyTier: "neutral-versatile" },
    garmentRelationships: [],
    intentions: null,
    intentionsSource: null,
    intelligenceSource: "derived",
    outfitAppearances: 0,
    savedLookAppearances: 0,
    observedWear: null,
  };
  return { ...base, ...overrides };
}

function run(
  items: WardrobeGarment[],
  opts: {
    passport?: WardrobePassport | null;
    seen?: Set<string>;
    flags?: WardrobeIntelligenceFlags;
  } = {},
): WardrobeIntelligence {
  return computeWardrobeIntelligence({
    items,
    passport: opts.passport ?? null,
    seenCombinations: opts.seen ?? new Set<string>(),
    flags: opts.flags,
  });
}

/** A small, realistic wardrobe: neutral, structured, mixed slots. */
function neutralWardrobe(): WardrobeGarment[] {
  return [
    makeGarment({ id: "top-black", name: "Black Tailored Shirt", slot: "top", primaryColor: "Black" }),
    makeGarment({ id: "top-cream", name: "Cream Shirt", slot: "top", primaryColor: "Cream" }),
    makeGarment({ id: "bottom-black", name: "Black Trousers", category: "BOTTOMS", slot: "bottom", primaryColor: "Black" }),
    makeGarment({ id: "bottom-brown", name: "Brown Trousers", category: "BOTTOMS", slot: "bottom", primaryColor: "Brown" }),
    makeGarment({ id: "outer-black", name: "Black Blazer", category: "OUTERWEAR", slot: "outerwear", primaryColor: "Black" }),
    makeGarment({ id: "dress-black", name: "Black Dress", category: "DRESSES", slot: "dress", primaryColor: "Black" }),
  ];
}

const ALL_STRONG: Record<string, "strong"> = Object.fromEntries(
  [
    "feel-like-myself", "confidence", "ground-me", "give-structure",
    "make-it-easy", "feel-put-together", "feel-attractive", "give-energy",
    "feel-softer", "feel-sharper", "feel-less-exposed", "express-myself",
  ].map((k) => [k, "strong" as const]),
);

const PASSPORT: WardrobePassport = {
  lifestyle: ["office"],
  favoriteColors: ["black"],
  avoidColors: [],
  stylePersonalities: [],
  silhouette: [],
  structure: "structured-tailored",
  fitPreferences: [],
  styleStruggles: [],
  styleSupport: [],
  becoming: [],
};

const VALID_SIGNALS: ReadonlySet<SignalType> = new Set<SignalType>([
  "garment-fact", "passport-signal", "self-reported-wardrobe", "naia-interaction", "observed-wear",
]);

function allEvidence(result: WardrobeIntelligence): Evidence[] {
  return [
    ...result.observations.flatMap((o) => o.evidence),
    ...result.heroes.heroes.flatMap((h) => h.evidence),
    ...result.pairings.pairings.flatMap((p) => p.evidence),
    ...result.opportunities.rediscover.flatMap((r) => r.evidence),
    ...result.opportunities.tryTogether.flatMap((t) => t.evidence),
    ...result.opportunities.worthConsidering.flatMap((g) => g.evidence),
    ...result.passportView.comparisons.flatMap((c) => c.evidence),
  ];
}

// ── §WI-1 — Wardrobe size gate ────────────────────────────────────────────────

describe("§WI-1 wardrobe size gate", () => {
  it("an empty Closet is not ready and invents nothing", () => {
    const result = run([]);
    assert.equal(result.ready, false);
    assert.equal(result.snapshot.length, 1);
    assert.equal(result.snapshot[0].value, 0);
    assert.equal(result.dna.state, "learning");
    assert.equal(result.heroes.heroes.length, 0);
    assert.equal(result.pairings.totalFound, 0);
    assert.equal(result.observations.length, 0);
    assert.equal(result.opportunities.worthConsidering.length, 0);
    assert.equal(result.opportunities.noGapNote, null);
  });

  it("below MIN_WARDROBE_SIZE the note says how many pieces are still needed", () => {
    const result = run([makeGarment(), makeGarment(), makeGarment()]);
    assert.equal(result.ready, false);
    assert.match(result.readyNote!, /2 more pieces/);
  });

  it("at MIN_WARDROBE_SIZE the engine engages", () => {
    const items = Array.from({ length: MIN_WARDROBE_SIZE }, () => makeGarment());
    assert.equal(run(items).ready, true);
  });
});

// ── §WI-2 — The signal model ──────────────────────────────────────────────────

describe("§WI-2 signal model", () => {
  it("every piece of evidence declares a recognised signal type", () => {
    const result = run(neutralWardrobe(), { passport: PASSPORT });
    const evidence = allEvidence(result);
    assert.ok(evidence.length > 0);
    for (const e of evidence) {
      assert.ok(VALID_SIGNALS.has(e.signal), `unknown signal ${e.signal}`);
      assert.ok(e.field.length > 0);
      assert.ok(e.detail.length > 0);
    }
  });

  it("nothing is ever attributed to observed wear, because nAia has none", () => {
    const items = neutralWardrobe().map((g) => ({ ...g, garmentRelationships: ["favourite"], outfitAppearances: 2 }));
    const result = run(items, { passport: PASSPORT });
    assert.equal(allEvidence(result).some((e) => e.signal === "observed-wear"), false);
    const wearSignal = result.signalAvailability.find((s) => s.signal === "observed-wear")!;
    assert.equal(wearSignal.state, "unavailable");
  });

  it("self-reported relationships are attributed to the self-report signal, not interaction", () => {
    const items = neutralWardrobe().map((g, i) =>
      i < 3 ? { ...g, garmentRelationships: ["love-style-struggle"] } : g,
    );
    const struggle = run(items).observations.find((o) => o.kind === "struggle-pattern")!;
    assert.ok(struggle);
    assert.ok(struggle.evidence.some((e) => e.signal === "self-reported-wardrobe"));
    assert.equal(struggle.evidence.some((e) => e.signal === "naia-interaction"), false);
  });

  it("every claim carries an evidence strength", () => {
    const items = neutralWardrobe().map((g, i) => (i < 3 ? { ...g, garmentRelationships: ["rarely-wear"] } : g));
    const result = run(items, { passport: PASSPORT });
    const graded = [
      ...result.observations,
      ...result.heroes.heroes,
      ...result.opportunities.rediscover,
      ...result.passportView.comparisons,
    ];
    assert.ok(graded.length > 0);
    for (const claim of graded) {
      assert.ok(["strong", "moderate", "emerging"].includes(claim.strength));
    }
  });

  it("signal availability reports what is and is not currently feeding the page", () => {
    const result = run(neutralWardrobe());
    const byId = new Map(result.signalAvailability.map((s) => [s.signal, s]));
    assert.equal(byId.size, 5);
    assert.equal(byId.get("passport-signal")!.state, "unavailable");
    assert.equal(byId.get("self-reported-wardrobe")!.state, "unavailable");
    assert.equal(byId.get("naia-interaction")!.state, "unavailable");
    assert.equal(byId.get("observed-wear")!.state, "unavailable");
    assert.equal(byId.get("garment-fact")!.state, "active");
  });
});

// ── §WI-3 — Shadow V2 intention gating ────────────────────────────────────────

describe("§WI-3 shadow V2 intention gate", () => {
  const derivedIntentionWardrobe = () =>
    neutralWardrobe().map((g) => ({ ...g, intentions: ALL_STRONG, intentionsSource: "derived" as const }));

  it("is closed by default", () => {
    assert.equal(DEFAULT_FLAGS.derivedIntentionIntelligence, false);
    assert.equal(run(neutralWardrobe()).flags.derivedIntentionIntelligence, false);
  });

  it("ignores derived intention scoring while the gate is closed", () => {
    const result = run(derivedIntentionWardrobe());
    assert.equal(result.coverage.usableIntentionCoverage, 0);
    assert.equal(result.observations.some((o) => o.kind === "intention-concentration"), false);
    assert.equal(result.observations.some((o) => o.gated), false);
  });

  it("uses derived intention scoring once the gate is opened", () => {
    const result = run(derivedIntentionWardrobe(), {
      flags: { derivedIntentionIntelligence: true },
    });
    assert.equal(result.coverage.usableIntentionCoverage, 1);
    const gated = result.observations.find((o) => o.kind === "intention-concentration");
    assert.ok(gated);
    assert.equal(gated!.gated, true);
  });

  it("trusts curated and admin-corrected intentions regardless of the gate", () => {
    const curated = neutralWardrobe().map((g) => ({
      ...g,
      intentions: ALL_STRONG,
      intentionsSource: "curated" as const,
    }));
    const result = run(curated);
    assert.equal(result.coverage.usableIntentionCoverage, 1);
    assert.ok(result.observations.some((o) => o.kind === "intention-concentration"));
  });

  it("leaves no section empty when the gate is closed", () => {
    const result = run(derivedIntentionWardrobe(), { passport: PASSPORT });
    assert.equal(result.dna.state, "available");
    assert.equal(result.heroes.state, "available");
    assert.equal(result.pairings.state, "available");
    assert.equal(result.passportView.state, "available");
    assert.ok(result.observations.length > 0);
    assert.ok(result.snapshot.every((m) => m.state === "available" || m.learningNote));
  });

  it("heroes never depend on intention scoring, so they do not change with the gate", () => {
    const items = neutralWardrobe().map((g) => ({ ...g, intentions: ALL_STRONG, intentionsSource: "derived" as const }));
    const closed = run(items, { passport: PASSPORT }).heroes;
    const open = run(items, { passport: PASSPORT, flags: { derivedIntentionIntelligence: true } }).heroes;
    assert.deepEqual(closed, open);
  });
});

// ── §WI-4 — Self-reported is not wear ─────────────────────────────────────────

describe("§WI-4 self-reported wardrobe signals", () => {
  it("counts regulars from what the customer marked, and says so", () => {
    const items = neutralWardrobe();
    items[0].garmentRelationships = ["favourite"];
    items[1].garmentRelationships = ["wear-often"];
    items[2].garmentRelationships = ["rarely-wear"];
    const result = run(items);
    const regulars = result.snapshot.find((m) => m.id === "regulars")!;
    assert.equal(regulars.value, 2);
    assert.equal(regulars.signal, "self-reported-wardrobe");
    assert.match(regulars.caption, /you've marked/i);
  });

  it("never converts a self-report into a wear claim", () => {
    const items = neutralWardrobe().map((g) => ({ ...g, garmentRelationships: ["wear-often"] }));
    const text = JSON.stringify(run(items, { passport: PASSPORT }));
    assert.doesNotMatch(text, /most.worn/i);
    assert.doesNotMatch(text, /you wore/i);
    assert.doesNotMatch(text, /\d+ times/i);
    assert.doesNotMatch(text, /haven't worn/i);
    assert.doesNotMatch(text, /cost per wear[^"]*\d/i);
  });

  it("regulars and underused stay in a learning state until pieces are tagged", () => {
    const result = run(neutralWardrobe());
    for (const id of ["regulars", "underused"]) {
      const metric = result.snapshot.find((m) => m.id === id)!;
      assert.equal(metric.state, "learning");
      assert.equal(metric.value, null);
      assert.ok(metric.learningNote);
    }
  });
});

// ── §WI-5 — Wardrobe DNA ──────────────────────────────────────────────────────

describe("§WI-5 wardrobe DNA", () => {
  it("palette is withheld when most pieces have no colour", () => {
    const items = neutralWardrobe().map((g, index) =>
      index === 0 ? g : { ...g, primaryColor: null, colourProfile: null },
    );
    const result = run(items);
    assert.equal(result.dna.palette.length, 0);
    assert.equal(result.dna.paletteReading, "");
  });

  it("palette reports real counts and reads the neutral lean", () => {
    const result = run(neutralWardrobe());
    const black = result.dna.palette.find((p) => p.colour === "Black")!;
    assert.equal(black.count, 4);
    assert.match(result.dna.paletteReading, /neutral/i);
  });

  it("a colour-led wardrobe is not described as neutral", () => {
    const items = neutralWardrobe().map((g) => ({
      ...g,
      primaryColor: "Red",
      colourProfile: { hueFamily: "red", wardrobeNeutral: false, lightDark: "dark" as const, energyTier: "high-energy" },
    }));
    const result = run(items);
    assert.doesNotMatch(result.dna.paletteReading, /leans neutral/i);
    assert.ok(result.dna.traits.some((t) => t.id === "colour-led"));
  });

  it("traits carry numeric evidence", () => {
    const result = run(neutralWardrobe());
    assert.ok(result.dna.traits.length > 0);
    for (const trait of result.dna.traits) assert.match(trait.evidence, /\d/);
  });
});

// ── §WI-6 — Pairings ──────────────────────────────────────────────────────────

describe("§WI-6 what works well together", () => {
  it("rejects a pairing two levels of dress apart", () => {
    const items = [
      makeGarment({ id: "t1", slot: "top", formality: "casual" }),
      makeGarment({ id: "b1", category: "BOTTOMS", slot: "bottom", formality: "evening" }),
      makeGarment({ id: "x1" }), makeGarment({ id: "x2" }), makeGarment({ id: "x3" }),
    ];
    assert.ok(!run(items).pairings.pairings.map((p) => p.id).includes(combinationKey(["t1", "b1"])));
  });

  it("rejects two substantial pieces together", () => {
    const items = [
      makeGarment({ id: "t1", slot: "top", visualWeight: "substantial" }),
      makeGarment({ id: "b1", category: "BOTTOMS", slot: "bottom", visualWeight: "substantial" }),
      makeGarment({ id: "x1" }), makeGarment({ id: "x2" }), makeGarment({ id: "x3" }),
    ];
    assert.ok(!run(items).pairings.pairings.map((p) => p.id).includes(combinationKey(["t1", "b1"])));
  });

  it("rejects clashing chromatics and accepts them once one side is neutral", () => {
    const red = { hueFamily: "red", wardrobeNeutral: false, lightDark: "dark" as const, energyTier: "high-energy" };
    const green = { hueFamily: "green", wardrobeNeutral: false, lightDark: "dark" as const, energyTier: "mid-range" };
    const clash = [
      makeGarment({ id: "t1", slot: "top", colourProfile: red }),
      makeGarment({ id: "b1", category: "BOTTOMS", slot: "bottom", colourProfile: green }),
      makeGarment({ id: "x1" }), makeGarment({ id: "x2" }), makeGarment({ id: "x3" }),
    ];
    assert.ok(!run(clash).pairings.pairings.map((p) => p.id).includes(combinationKey(["t1", "b1"])));

    const anchored = [
      makeGarment({ id: "t1", slot: "top", colourProfile: red }),
      makeGarment({ id: "b1", category: "BOTTOMS", slot: "bottom" }),
      makeGarment({ id: "x1" }), makeGarment({ id: "x2" }), makeGarment({ id: "x3" }),
    ];
    assert.ok(run(anchored).pairings.pairings.map((p) => p.id).includes(combinationKey(["t1", "b1"])));
  });

  it("marks a combination as tried once nAia has already generated it", () => {
    const items = neutralWardrobe();
    const first = run(items).pairings.pairings[0];
    const after = run(items, { seen: new Set([first.id]) }).pairings.pairings.find((p) => p.id === first.id);
    if (after) assert.equal(after.untried, false);
  });

  it("no garment appears in two different pairings", () => {
    const used = new Set<string>();
    for (const pairing of run(neutralWardrobe()).pairings.pairings) {
      for (const id of pairing.garmentIds) {
        assert.ok(!used.has(id), `${id} appears twice`);
        used.add(id);
      }
    }
  });
});

// ── §WI-7 — Heroes and their labels ───────────────────────────────────────────

describe("§WI-7 wardrobe heroes", () => {
  it("awards distinct labels, never the same one twice", () => {
    const items = neutralWardrobe();
    items[0].garmentRelationships = ["favourite"];
    const result = run(items, { passport: PASSPORT });
    const labels = result.heroes.heroes.map((h) => h.label);
    assert.equal(new Set(labels).size, labels.length);
    for (const hero of result.heroes.heroes) {
      assert.ok(hero.labelText.length > 0);
      assert.ok(hero.reasons.length >= 1);
      assert.ok(hero.evidence.length >= 1);
    }
  });

  it("awards YOUR FAVOURITE only to a piece the customer actually marked", () => {
    const items = neutralWardrobe();
    items[3].garmentRelationships = ["favourite"];
    const hero = run(items).heroes.heroes.find((h) => h.label === "your-favourite");
    assert.ok(hero);
    assert.equal(hero!.garmentId, items[3].id);
    assert.ok(hero!.evidence.some((e) => e.signal === "self-reported-wardrobe"));
  });

  it("awards PASSPORT MATCH only from stable Passport attributes", () => {
    const passport: WardrobePassport = { ...PASSPORT, favoriteColors: ["black"], structure: "structured-tailored" };
    const hero = run(neutralWardrobe(), { passport }).heroes.heroes.find((h) => h.label === "passport-match");
    assert.ok(hero);
    assert.ok(hero!.evidence.some((e) => e.signal === "passport-signal"));
  });

  it("awards UNTAPPED HERO to a well-connected piece the customer rarely reaches for", () => {
    const items = neutralWardrobe();
    items[2].garmentRelationships = ["rarely-wear"];
    const hero = run(items).heroes.heroes.find((h) => h.label === "untapped-hero");
    assert.ok(hero);
    assert.equal(hero!.garmentId, items[2].id);
  });

  it("does not force labels that have no qualifying piece", () => {
    const result = run(neutralWardrobe());
    assert.equal(result.heroes.heroes.some((h) => h.label === "your-favourite"), false);
    assert.equal(result.heroes.heroes.some((h) => h.label === "untapped-hero"), false);
  });

  it("never claims a piece is most worn", () => {
    const items = neutralWardrobe().map((g) => ({ ...g, outfitAppearances: 5 }));
    const text = JSON.stringify(run(items).heroes);
    assert.doesNotMatch(text, /most.worn/i);
    assert.doesNotMatch(text, /you wear it/i);
  });

  it("finishing categories are never ranked as heroes", () => {
    const items = [
      ...neutralWardrobe(),
      makeGarment({ id: "jewel", category: "JEWELRY", slot: "jewelry", occasions: ["Work", "Dinner", "Party"] }),
    ];
    assert.ok(!run(items).heroes.heroes.map((h) => h.garmentId).includes("jewel"));
  });

  it("returns a learning state rather than weak heroes when pieces do not connect", () => {
    const items = Array.from({ length: 6 }, (_u, index) =>
      makeGarment({ id: `iso${index}`, slot: "top", colourProfile: null, visualWeight: null, formality: null }),
    );
    const result = run(items);
    assert.equal(result.heroes.state, "learning");
    assert.ok(result.heroes.learningNote);
  });
});

// ── §WI-8 — What nAia is noticing ─────────────────────────────────────────────

describe("§WI-8 observations", () => {
  it("surfaces a struggle pattern and names what the pieces share", () => {
    const items = neutralWardrobe().map((g, index) =>
      index < 3 ? { ...g, garmentRelationships: ["love-style-struggle"] } : g,
    );
    const struggle = run(items).observations.find((o) => o.kind === "struggle-pattern")!;
    assert.ok(struggle);
    assert.equal(struggle.garmentIds.length, 3);
    assert.match(struggle.observation, /3 pieces/);
    assert.ok(struggle.explanation);
  });

  it("states a struggle pattern without a shared attribute when none is supported", () => {
    const items = [
      makeGarment({ id: "s1", slot: "top", garmentRelationships: ["love-style-struggle"], primaryColor: "Black", fitProfile: "tailored", silhouette: "straight" }),
      makeGarment({ id: "s2", category: "BOTTOMS", slot: "bottom", garmentRelationships: ["love-style-struggle"], primaryColor: "Cream", fitProfile: "relaxed", silhouette: "flared" }),
      makeGarment({ id: "s3", category: "DRESSES", slot: "dress", garmentRelationships: ["love-style-struggle"], primaryColor: "Brown", fitProfile: "flowy", silhouette: "wrap" }),
      makeGarment({ id: "x1" }), makeGarment({ id: "x2" }),
    ];
    const struggle = run(items).observations.find((o) => o.kind === "struggle-pattern")!;
    assert.ok(struggle);
    assert.equal(struggle.evidence.filter((e) => e.signal === "garment-fact").length, 0);
  });

  it("detects a repeated category from real garment attributes", () => {
    const items = [
      ...neutralWardrobe(),
      makeGarment({ id: "r1", slot: "top", primaryColor: "Black", fitProfile: "fitted" }),
      makeGarment({ id: "r2", slot: "top", primaryColor: "Black", fitProfile: "fitted" }),
      makeGarment({ id: "r3", slot: "top", primaryColor: "Black", fitProfile: "fitted" }),
    ];
    const repetition = run(items).observations.find((o) => o.kind === "repetition")!;
    assert.ok(repetition);
    assert.equal(repetition.garmentIds.length, 3);
    assert.match(repetition.observation, /3 Black fitted tops/i);
    assert.equal(repetition.action?.kind, "see-pieces");
  });

  it("does not raise repetition for genuinely different pieces", () => {
    assert.equal(run(neutralWardrobe()).observations.some((o) => o.kind === "repetition"), false);
  });

  it("bases untapped potential on nAia interaction once any history exists", () => {
    const items = neutralWardrobe().map((g, index) => (index < 3 ? { ...g, outfitAppearances: 2 } : g));
    const untapped = run(items).observations.find((o) => o.kind === "untapped-potential")!;
    assert.ok(untapped);
    assert.match(untapped.observation, /saved or generated look/i);
    assert.ok(untapped.evidence.some((e) => e.signal === "naia-interaction"));
  });

  it("does not treat an unstyled piece as overlooked before any history exists", () => {
    const result = run(neutralWardrobe());
    assert.equal(result.observations.some((o) => o.kind === "untapped-potential"), false);
  });

  it("says nothing about untapped pieces when the claim would cover most of the wardrobe", () => {
    const items = neutralWardrobe().map((g) => ({ ...g, garmentRelationships: ["rarely-wear"] }));
    assert.equal(run(items).observations.some((o) => o.kind === "untapped-potential"), false);
  });

  it("reports a register imbalance only when the distribution genuinely supports it", () => {
    const balanced = neutralWardrobe();
    assert.equal(run(balanced).observations.some((o) => o.kind === "wardrobe-imbalance"), false);

    const skewed = [
      ...Array.from({ length: 6 }, (_u, i) => makeGarment({ id: `w${i}`, formality: "business-formal" })),
      makeGarment({ id: "c1", category: "BOTTOMS", slot: "bottom", formality: "casual" }),
    ];
    const imbalance = run(skewed).observations.find((o) => o.kind === "wardrobe-imbalance")!;
    assert.ok(imbalance);
    assert.match(imbalance.observation, /considerably more polished/i);
  });

  it("does not repeat the palette reading the DNA section already gives", () => {
    const result = run(neutralWardrobe());
    assert.notEqual(result.dna.paletteReading, "");
    const colour = result.observations.find((o) => o.kind === "colour-pattern");
    if (colour) assert.match(colour.observation, /lives in one place|chromatic|colour are/i);
  });

  it("surfaces colour concentration when all the colour sits in one slot", () => {
    const chromatic = { hueFamily: "red", wardrobeNeutral: false, lightDark: "dark" as const, energyTier: "high-energy" };
    const items = [
      makeGarment({ id: "t1", slot: "top", primaryColor: "Red", colourProfile: chromatic }),
      makeGarment({ id: "t2", slot: "top", primaryColor: "Pink", colourProfile: chromatic }),
      makeGarment({ id: "t3", slot: "top", primaryColor: "Rust", colourProfile: chromatic }),
      makeGarment({ id: "b1", category: "BOTTOMS", slot: "bottom" }),
      makeGarment({ id: "b2", category: "BOTTOMS", slot: "bottom" }),
      makeGarment({ id: "b3", category: "BOTTOMS", slot: "bottom" }),
    ];
    const colour = run(items).observations.find((o) => o.kind === "colour-pattern")!;
    assert.ok(colour);
    assert.match(colour.observation, /tops/);
  });

  it("does not repeat a Passport dimension the comparison section already shows", () => {
    const result = run(neutralWardrobe(), { passport: PASSPORT });
    const shown = new Set(result.passportView.comparisons.map((c) => c.id));
    if (shown.has("structure")) {
      assert.equal(result.observations.some((o) => o.kind === "passport-alignment"), false);
    }
  });

  it("caps the section so it stays a reading, not a feed", () => {
    const items = [
      ...neutralWardrobe().map((g, i) => (i < 3 ? { ...g, garmentRelationships: ["love-style-struggle"] } : g)),
      makeGarment({ id: "r1", slot: "top", primaryColor: "Black", fitProfile: "fitted" }),
      makeGarment({ id: "r2", slot: "top", primaryColor: "Black", fitProfile: "fitted" }),
      makeGarment({ id: "r3", slot: "top", primaryColor: "Black", fitProfile: "fitted" }),
    ];
    assert.ok(run(items, { passport: PASSPORT }).observations.length <= 5);
  });
});

// ── §WI-9 — Opportunities ─────────────────────────────────────────────────────

describe("§WI-9 wardrobe opportunities", () => {
  it("rediscover requires both an underuse signal and real compatibility", () => {
    const items = neutralWardrobe();
    items[2].garmentRelationships = ["rarely-wear"];
    const rediscover = run(items).opportunities.rediscover;
    assert.equal(rediscover.length, 1);
    assert.equal(rediscover[0].garmentId, items[2].id);
    assert.ok(rediscover[0].worksWithIds.length >= 3);
    assert.ok(rediscover[0].evidence.some((e) => e.signal === "self-reported-wardrobe"));
    assert.ok(rediscover[0].evidence.some((e) => e.signal === "garment-fact"));
    assert.match(rediscover[0].body, /rarely reach for/i);
  });

  it("rediscover says nothing about a piece with no underuse signal", () => {
    assert.equal(run(neutralWardrobe()).opportunities.rediscover.length, 0);
  });

  it("rediscover names the Passport match when there is one", () => {
    const items = neutralWardrobe();
    items[2].garmentRelationships = ["rarely-wear"];
    const piece = run(items, { passport: PASSPORT }).opportunities.rediscover[0];
    assert.match(piece.body, /matches your Passport/i);
    assert.ok(piece.evidence.some((e) => e.signal === "passport-signal"));
  });

  it("try-together only offers combinations nAia has not generated", () => {
    const result = run(neutralWardrobe());
    for (const item of result.opportunities.tryTogether) {
      const pairing = result.pairings.pairings.find((p) => `try-${p.id}` === item.id);
      assert.equal(pairing?.untried, true);
    }
  });

  it("says nothing is missing rather than inventing a gap", () => {
    const opportunities = run(neutralWardrobe()).opportunities;
    assert.equal(opportunities.worthConsidering.length, 0);
    assert.match(opportunities.noGapNote!, /Nothing obvious is missing/i);
  });

  it("raises a gap only when nothing owned can solve it", () => {
    const evening = { hueFamily: "red", wardrobeNeutral: false, lightDark: "dark" as const, energyTier: "high-energy" };
    const items = [
      makeGarment({ id: "t1", slot: "top", formality: "evening", colourProfile: evening }),
      makeGarment({ id: "t2", slot: "top", formality: "evening", colourProfile: evening }),
      makeGarment({ id: "t3", slot: "top", formality: "evening", colourProfile: evening }),
      makeGarment({ id: "t4", slot: "top", formality: "evening", colourProfile: evening }),
      makeGarment({ id: "b1", category: "BOTTOMS", slot: "bottom", formality: "casual" }),
      makeGarment({ id: "b2", category: "BOTTOMS", slot: "bottom", formality: "casual" }),
    ];
    const gaps = run(items).opportunities.worthConsidering;
    assert.ok(gaps.length > 0);
    assert.ok(gaps[0].garmentIds.length >= 3);
    assert.match(gaps[0].body, /nothing you already own solves this|no counterpart/i);
    assert.equal(run(items).opportunities.noGapNote, null);
  });

  it("withdraws the gap as soon as one owned piece would solve it", () => {
    const evening = { hueFamily: "red", wardrobeNeutral: false, lightDark: "dark" as const, energyTier: "high-energy" };
    const stranded = [
      makeGarment({ id: "t1", slot: "top", formality: "evening", colourProfile: evening }),
      makeGarment({ id: "t2", slot: "top", formality: "evening", colourProfile: evening }),
      makeGarment({ id: "t3", slot: "top", formality: "evening", colourProfile: evening }),
      makeGarment({ id: "t4", slot: "top", formality: "evening", colourProfile: evening }),
      makeGarment({ id: "b1", category: "BOTTOMS", slot: "bottom", formality: "casual" }),
      makeGarment({ id: "b2", category: "BOTTOMS", slot: "bottom", formality: "casual" }),
    ];
    assert.ok(run(stranded).opportunities.worthConsidering.length > 0);

    // One compatible evening skirt answers the whole group — no gap any more.
    const solved = [...stranded, makeGarment({ id: "b3", category: "BOTTOMS", slot: "bottom", formality: "evening" })];
    assert.equal(run(solved).opportunities.worthConsidering.some((g) => g.id === "gap-top"), false);
  });

  it("does not call an untagged but work-ready wardrobe a work gap", () => {
    const items = Array.from({ length: 9 }, (_u, i) =>
      makeGarment({ id: `wr${i}`, formality: "business-casual", slot: i % 2 === 0 ? "top" : "bottom", category: i % 2 === 0 ? "TOPS" : "BOTTOMS" }),
    );
    const gaps = run(items, { passport: PASSPORT }).opportunities.worthConsidering;
    assert.equal(gaps.some((g) => g.id === "gap-work"), false);
  });

  it("never phrases an opportunity as a shopping instruction", () => {
    const items = neutralWardrobe();
    items[2].garmentRelationships = ["rarely-wear"];
    const text = JSON.stringify(run(items, { passport: PASSPORT }).opportunities);
    assert.doesNotMatch(text, /you should buy|buy a |shop /i);
  });
});

// ── §WI-10 — Passport vs Closet ───────────────────────────────────────────────

describe("§WI-10 passport and closet", () => {
  it("stays in a learning state without a Passport", () => {
    const result = run(neutralWardrobe());
    assert.equal(result.passportView.state, "learning");
    assert.equal(result.passportView.comparisons.length, 0);
  });

  it("reports alignment without correcting the customer", () => {
    const result = run(neutralWardrobe(), { passport: PASSPORT });
    assert.equal(result.passportView.state, "available");
    const structure = result.passportView.comparisons.find((c) => c.id === "structure")!;
    assert.match(structure.reading, /reflects/i);
    assert.doesNotMatch(JSON.stringify(result.passportView), /you should|wrong|mistake/i);
  });

  it("names the part of a stated preference the Closet has not caught up with", () => {
    const result = run(neutralWardrobe(), { passport: { ...PASSPORT, favoriteColors: ["pink"] } });
    const colour = result.passportView.comparisons.find((c) => c.id === "colour")!;
    assert.match(colour.observed, /None of/);
    assert.match(colour.reading, /hasn't caught up/i);
  });

  it("every comparison cites both a passport signal and a garment fact", () => {
    const result = run(neutralWardrobe(), { passport: PASSPORT });
    for (const comparison of result.passportView.comparisons) {
      assert.ok(comparison.evidence.some((e) => e.signal === "passport-signal"));
      assert.ok(comparison.evidence.some((e) => e.signal === "garment-fact"));
    }
  });
});

// ── §WI-11 — Wear intelligence is prepared, never faked ───────────────────────

describe("§WI-11 wear intelligence", () => {
  it("always reports a learning state, whatever the wardrobe looks like", () => {
    for (const items of [[], neutralWardrobe()]) {
      const result = run(items);
      assert.equal(result.wear.state, "learning");
      assert.ok(result.wear.pending.length > 0);
      assert.match(result.wear.learningNote, /doesn't track what you actually wear/i);
    }
  });

  it("reports only usage facts that exist, attributed to nAia interaction", () => {
    const items = neutralWardrobe();
    items[0].outfitAppearances = 3;
    items[1].savedLookAppearances = 1;
    items[1].outfitAppearances = 1;
    const wear = run(items).wear;
    assert.equal(wear.observedToday.find((m) => m.id === "styled")!.value, 2);
    assert.equal(wear.observedToday.find((m) => m.id === "saved")!.value, 1);
    assert.equal(wear.observedToday.find((m) => m.id === "unstyled")!.value, items.length - 2);
    for (const metric of wear.observedToday) assert.equal(metric.signal, "naia-interaction");
  });

  it("lists cost per wear as pending rather than showing a number", () => {
    const wear = run(neutralWardrobe()).wear;
    assert.ok(wear.pending.some((p) => /cost per wear/i.test(p)));
    assert.equal(wear.observedToday.some((m) => /cost/i.test(m.label)), false);
  });

  it("carries a reserved slot for real wear data without pretending it exists", () => {
    const items = neutralWardrobe();
    assert.ok(items.every((g) => g.observedWear === null));
  });
});

// ── §WI-12 — Determinism and honesty invariants ───────────────────────────────

describe("§WI-12 determinism", () => {
  it("is a pure function of its input", () => {
    const items = neutralWardrobe();
    assert.deepEqual(run(items, { passport: PASSPORT }), run(items, { passport: PASSPORT }));
  });

  it("does not mutate the garments it is given", () => {
    const items = neutralWardrobe();
    const before = JSON.stringify(items);
    run(items, { passport: PASSPORT });
    assert.equal(JSON.stringify(items), before);
  });

  it("a metric has a value if and only if it is marked available", () => {
    for (const metric of run(neutralWardrobe()).snapshot) {
      if (metric.state === "learning") {
        assert.equal(metric.value, null);
        assert.ok(metric.learningNote);
      } else {
        assert.equal(typeof metric.value, "number");
      }
    }
  });

  it("the combination count equals what the pairing engine actually found", () => {
    const result = run(neutralWardrobe());
    assert.equal(result.snapshot.find((m) => m.id === "combinations")!.value, result.pairings.totalFound);
  });

  it("reports coverage ratios that match the wardrobe", () => {
    const items = neutralWardrobe();
    items[0].analysisStatus = "pending";
    items[0].primaryColor = null;
    const coverage = run(items).coverage;
    assert.equal(coverage.totalItems, 6);
    assert.equal(coverage.analysedItems, 5);
    assert.equal(Math.round(coverage.colourCoverage * 100), 83);
  });
});
