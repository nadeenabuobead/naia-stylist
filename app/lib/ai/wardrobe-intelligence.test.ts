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
import { COLOUR_FAMILIES, quizQuestions } from "../onboarding/quiz-data.ts";
import {
  computeWardrobeIntelligence,
  PASSPORT_COLOUR_FAMILIES,
  PASSPORT_LIFESTYLE_REGISTERS,
  CLOSET_COLOUR_FAMILY,
  closetColourFamily,
  combinationKey,
  DEFAULT_FLAGS,
  MIN_WARDROBE_SIZE,
  wardrobeCharacterLine,
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

/** Every string the customer can actually read. Evidence `detail` is internal. */
function customerFacingStrings(result: WardrobeIntelligence): string[] {
  return [
    ...result.snapshot.flatMap((m) => [m.label, m.caption, m.learningNote ?? ""]),
    result.dna.paletteReading,
    result.dna.shapesReading,
    ...result.dna.traits.flatMap((t) => [t.label, t.evidence]),
    ...result.heroes.heroes.flatMap((h) => [h.labelText, h.headline, ...h.reasons]),
    ...result.pairings.pairings.map((p) => p.reason),
    ...result.observations.flatMap((o) => [o.headline, o.observation, o.explanation ?? ""]),
    ...result.opportunities.rediscover.map((r) => r.body),
    ...result.opportunities.worthConsidering.flatMap((g) => [g.title, g.body]),
    result.opportunities.noGapNote ?? "",
    ...result.passportView.comparisons.flatMap((c) => [c.stated, c.observed, c.reading]),
    ...result.signalAvailability.flatMap((s) => [s.title, s.body, s.statusText]),
    result.wear.learningNote,
    ...result.wear.observedToday.flatMap((m) => [m.label, m.caption]),
  ].filter((t) => t.length > 0);
}

const VALID_SIGNALS: ReadonlySet<SignalType> = new Set<SignalType>([
  "garment-fact", "passport-signal", "self-reported-wardrobe", "naia-interaction", "observed-wear",
]);

function allEvidence(result: WardrobeIntelligence): Evidence[] {
  return [
    ...result.observations.flatMap((o) => o.evidence),
    ...result.heroes.heroes.flatMap((h) => h.evidence),
    ...result.pairings.pairings.flatMap((p) => p.evidence),
    ...result.opportunities.rediscover.flatMap((r) => r.evidence),
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

  it("never asserts wear behaviour nAia cannot observe", () => {
    // Every wardrobe shape that could tempt the engine into a wear verdict.
    const shapes: WardrobeGarment[][] = [
      neutralWardrobe().map((g) => ({ ...g, garmentRelationships: ["rarely-wear"] })),
      neutralWardrobe().map((g, i) => (i < 3 ? { ...g, garmentRelationships: ["regret"] } : g)),
      neutralWardrobe().map((g, i) => (i < 2 ? { ...g, garmentRelationships: ["love-style-struggle"] } : { ...g, outfitAppearances: 2 })),
      richWardrobe().map((g, i) => (i < 3 ? { ...g, garmentRelationships: ["favourite"], outfitAppearances: 3 } : g)),
    ];
    const banned = [
      /you don't wear/i,
      /you rarely wear/i,
      /you haven't worn/i,
      /\bis underused\b/i,
      /\bunderused\b/i,
      /you never wear/i,
      /\bunworn\b/i,
    ];
    for (const items of shapes) {
      const result = run(items, { passport: FIT_PASSPORT });
      for (const text of customerFacingStrings(result)) {
        for (const phrase of banned) {
          assert.doesNotMatch(text, phrase, `forbidden wear claim in customer copy: "${text}"`);
        }
      }
    }
  });

  it("attributes every low-use statement to the customer's own marking", () => {
    // Both apostrophe forms — nAia's copy uses the typographic one.
    const provenance = /you['\u2019]ve (marked|said|told)|pieces you['\u2019]ve|ones you/i;
    // Use language only — "rarely limits what it goes with" is about colour.
    const lowUse = /rarely (wear|worn|reach)|rarely reached|reach for|difficult to style|struggle to style/i;
    const items = neutralWardrobe().map((g, i) => (i < 2 ? { ...g, garmentRelationships: ["rarely-wear"] } : g));
    const result = run(items, { passport: FIT_PASSPORT });

    // A snapshot metric is a heading plus its caption; the caption is where the
    // provenance lives, and the two are always rendered together.
    for (const metric of result.snapshot) {
      if (!lowUse.test(metric.label) && !lowUse.test(metric.caption)) continue;
      assert.match(metric.caption, provenance, `metric "${metric.label}" must name its source in the caption`);
    }

    // Claims about garments. The signal ledger is excluded: "What you actually
    // reach for, day to day" NAMES the signal nAia is still missing rather than
    // making a claim with it, which is the whole point of that section.
    const claims = [
      ...result.observations.flatMap((o) => [o.headline, o.observation, o.explanation ?? ""]),
      ...result.heroes.heroes.flatMap((h) => [h.headline, ...h.reasons]),
      ...result.opportunities.rediscover.map((r) => r.body),
        ...result.opportunities.worthConsidering.flatMap((g) => [g.title, g.body]),
      ...result.passportView.comparisons.flatMap((c) => [c.stated, c.observed, c.reading]),
    ].filter((t) => t.length > 0);
    for (const text of claims) {
      if (!lowUse.test(text)) continue;
      assert.match(text, provenance, `low-use copy must name its source: "${text}"`);
    }
  });

  it("never uses wear language in an nAia-activity headline", () => {
    const items = richWardrobe().map((g, i) => {
      if (i === 0) return { ...g, outfitAppearances: 3 };
      if (i === 1) return { ...g, fitProfile: "tailored", primaryColor: "Black", ...ALIGNED };
      return g;
    });
    for (const observation of run(items, { passport: FIT_PASSPORT }).observations) {
      assert.doesNotMatch(observation.headline, /\bworn\b|\bwear\b/i, observation.headline);
    }
  });

  it("separates 'not seen in nAia activity' from 'not worn'", () => {
    const items = richWardrobe().map((g, i) => (i < 3 ? { ...g, outfitAppearances: 2 } : g));
    const result = run(items, { passport: FIT_PASSPORT });
    for (const text of customerFacingStrings(result)) {
      if (!/appeared|generated|saved look|styled/i.test(text)) continue;
      // Interaction copy must talk about nAia, never about wearing.
      assert.doesNotMatch(text, /\bworn\b|\bwear\b/i, `nAia-activity copy must not imply wear: "${text}"`);
    }
  });

  it("opens with a reading, then at most three supporting facts", () => {
    const items = neutralWardrobe().map((g, i) => (i < 2 ? { ...g, garmentRelationships: ["love-style-struggle"] } : g));
    const result = run(items);
    assert.ok(result.snapshotReading, "the first thing read should be what nAia understands");
    assert.match(result.snapshotReading!, /^Your wardrobe leans /);
    assert.ok(result.snapshot.length <= 3, "the opening is not a metrics grid");
    assert.equal(result.snapshot[0].id, "pieces");
  });

  it("keeps engine internals out of the opening", () => {
    const ids = run(neutralWardrobe()).snapshot.map((m) => m.id);
    assert.equal(ids.includes("read"), false, "pieces nAia has read is an engine internal");
    assert.equal(ids.includes("combinations"), false, "combination counts belong in the relationships section");
  });

  it("names a difficult-to-style count as the customer's own marking", () => {
    const items = neutralWardrobe().map((g, i) => (i < 2 ? { ...g, garmentRelationships: ["love-style-struggle"] } : g));
    const metric = run(items).snapshot.find((m) => m.id === "difficult")!;
    assert.ok(metric);
    assert.equal(metric.value, 2);
    assert.equal(metric.signal, "self-reported-wardrobe");
    assert.match(metric.label, /difficult to style/i);
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
    const passport: WardrobePassport = {
      ...PASSPORT,
      favoriteColors: ["black"],
      structure: "structured-tailored",
      stylePersonalities: ["classic-polished"],
    };
    const items = neutralWardrobe().map((g) => (g.id === "top-black" ? { ...g, ...ALIGNED } : g));
    const hero = run(items, { passport }).heroes.heroes.find((h) => h.label === "passport-match");
    assert.ok(hero);
    assert.equal(hero!.garmentId, "top-black");
    assert.ok(hero!.evidence.some((e) => e.signal === "passport-signal"));
  });

  it("does not make a Passport hero out of colour and shape alone", () => {
    // Black + tailored hits two common dimensions and nothing distinctive.
    const items = neutralWardrobe().map((g) => (g.id === "top-black" ? { ...g, fitProfile: "tailored" } : g));
    const hero = run(items, { passport: FIT_PASSPORT }).heroes.heroes.find((h) => h.label === "passport-match");
    assert.equal(hero, undefined, "colour + fit is a coincidence, not a hero");
  });

  it("accepts colour and shape alone when a second kind of signal backs it", () => {
    const items = neutralWardrobe().map((g) =>
      g.id === "top-black" ? { ...g, fitProfile: "tailored", garmentRelationships: ["favourite"] } : g,
    );
    const heroes = run(items, { passport: FIT_PASSPORT }).heroes.heroes;
    const hero = heroes.find((h) => h.garmentId === "top-black");
    assert.ok(hero, "a favourite that also matches the Passport should qualify");
    if (hero!.label === "passport-match") {
      assert.ok(hero!.evidence.some((e) => e.signal === "self-reported-wardrobe"));
    }
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
    // Leads with the reading; the counts follow as supporting evidence.
    assert.match(imbalance.observation, /leans heavily polished/i);
    assert.match(imbalance.explanation!, /6 of the 7/);
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

  it("says 'worth trying' once at section level when every relationship is novel", () => {
    // A customer with no nAia history: everything is novel, so a badge on every
    // row would be noise. The state is stated once instead.
    const result = run(neutralWardrobe());
    assert.ok(result.pairings.pairings.every((p) => p.untried));
    assert.equal(result.pairings.untriedPresentation, "section");
    assert.ok(result.pairings.untriedNote);
    // The note is about nAia's own history, never about what she has worn.
    assert.match(result.pairings.untriedNote!, /nAia hasn't put together/i);
    assert.doesNotMatch(result.pairings.untriedNote!, /\bworn\b|\bwear\b/i);
  });

  it("tags only the novel relationships when the section is mixed", () => {
    // No outer layer, so each relationship is a plain top-and-bottom pair and the
    // section can display more than one of them.
    const items = [
      makeGarment({ id: "t1", name: "Black Shirt", slot: "top" }),
      makeGarment({ id: "t2", name: "Cream Shirt", slot: "top", primaryColor: "Cream" }),
      makeGarment({ id: "t3", name: "Grey Knit", slot: "top", primaryColor: "Grey" }),
      makeGarment({ id: "b1", name: "Black Trousers", category: "BOTTOMS", slot: "bottom" }),
      makeGarment({ id: "b2", name: "Brown Trousers", category: "BOTTOMS", slot: "bottom", primaryColor: "Brown" }),
    ];
    const displayed = run(items).pairings.pairings;
    assert.ok(displayed.length >= 2, "fixture must produce more than one relationship");

    const seen = new Set([displayed[0].id]);
    const mixed = run(items, { seen }).pairings;
    assert.ok(mixed.pairings.some((p) => p.untried), "some should still be novel");
    assert.ok(mixed.pairings.some((p) => !p.untried), "one should be known to nAia");
    assert.equal(mixed.untriedPresentation, "per-item");
    assert.equal(mixed.untriedNote, null, "no section note when the tag carries the meaning");
  });

  it("says nothing about novelty when nothing displayed is novel", () => {
    const items = neutralWardrobe();
    const seen = new Set(run(items).pairings.pairings.map((p) => p.id));
    const settled = run(items, { seen }).pairings;
    assert.equal(settled.pairings.some((p) => p.untried), false);
    assert.equal(settled.untriedPresentation, "none");
    assert.equal(settled.untriedNote, null);
  });

  it("keeps the underlying novelty detection whatever the presentation", () => {
    for (const result of [run(neutralWardrobe()), run(richWardrobe())]) {
      for (const pairing of result.pairings.pairings) {
        assert.equal(typeof pairing.untried, "boolean");
      }
    }
  });

  it("surfaces untried combinations inside the relationships section, not a second one", () => {
    const result = run(neutralWardrobe());
    assert.equal("tryTogether" in result.opportunities, false, "Try Together must not return as its own section");
    // Any untried combination is simply a flagged relationship.
    for (const pairing of result.pairings.pairings) {
      assert.equal(typeof pairing.untried, "boolean");
    }
    assert.ok(result.pairings.pairings.some((p) => p.untried), "a fresh wardrobe has untried combinations");
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

  it("does not repeat one sentence across every rediscovered piece", () => {
    const items = richWardrobe().map((g, i) => {
      if (i === 0) return { ...g, garmentRelationships: ["rarely-wear"] };
      if (i === 1) return { ...g, garmentRelationships: ["love-style-struggle"] };
      return { ...g, outfitAppearances: i === 2 ? 3 : 0 };
    });
    const bodies = run(items, { passport: FIT_PASSPORT }).opportunities.rediscover.map((r) => r.body);
    assert.ok(bodies.length >= 2);
    assert.equal(new Set(bodies.map((b) => b.slice(0, 40))).size, bodies.length, "each reason should reflect its own signal");
  });

  it("does not repeat the same preamble when pieces share one signal", () => {
    const items = richWardrobe().map((g, i) =>
      i < 3 ? { ...g, garmentRelationships: ["love-style-struggle"] } : g,
    );
    const bodies = run(items, { passport: FIT_PASSPORT }).opportunities.rediscover.map((r) => r.body);
    assert.ok(bodies.length >= 2);
    const openers = bodies.map((b) => b.split(".")[0]);
    assert.equal(new Set(openers).size, openers.length, `repeated opener: ${openers.join(" | ")}`);
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

  it("every displayed relationship is one the engine actually found", () => {
    const result = run(neutralWardrobe());
    assert.ok(result.pairings.pairings.length <= result.pairings.totalFound);
    for (const pairing of result.pairings.pairings) {
      assert.ok(pairing.reason.length > 0);
      assert.ok(pairing.garmentIds.length >= 2);
    }
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

// ── §WI-13 — Hero eligibility is category-aware, not category-banned ──────────

/** 8 pieces across 4 slots — enough for partner counts to mean something. */
function richWardrobe(): WardrobeGarment[] {
  return [
    makeGarment({ id: "t1", name: "Black Shirt", slot: "top" }),
    makeGarment({ id: "t2", name: "Cream Shirt", slot: "top", primaryColor: "Cream" }),
    makeGarment({ id: "t3", name: "Grey Knit", slot: "top", primaryColor: "Grey" }),
    makeGarment({ id: "b1", name: "Black Trousers", category: "BOTTOMS", slot: "bottom" }),
    makeGarment({ id: "b2", name: "Brown Trousers", category: "BOTTOMS", slot: "bottom", primaryColor: "Brown" }),
    makeGarment({ id: "b3", name: "Navy Trousers", category: "BOTTOMS", slot: "bottom", primaryColor: "Navy" }),
    makeGarment({ id: "o1", name: "Black Blazer", category: "OUTERWEAR", slot: "outerwear" }),
    makeGarment({ id: "d1", name: "Black Dress", category: "DRESSES", slot: "dress" }),
  ];
}

const FIT_PASSPORT: WardrobePassport = {
  ...PASSPORT,
  fitPreferences: ["tailored"],
  stylePersonalities: ["classic-polished"],
};

/** Garment personality that matches FIT_PASSPORT — the distinctive dimension. */
const ALIGNED = { stylePersonality: "classic-polished" } as const;

describe("§WI-13 hero eligibility by category", () => {
  it("a tote never wins a connectivity label just by matching everything", () => {
    const items = [
      ...richWardrobe(),
      makeGarment({ id: "tote", name: "Black Tote", category: "BAGS", slot: "bag" }),
    ];
    const heroes = run(items, { passport: FIT_PASSPORT }).heroes.heroes;
    const versatile = heroes.find((h) => h.label === "most-versatile");
    const connector = heroes.find((h) => h.label === "closet-connector");
    assert.notEqual(versatile?.garmentId, "tote");
    assert.notEqual(connector?.garmentId, "tote");
  });

  it("a favourite pair of boots CAN become a hero on its own evidence", () => {
    const items = [
      ...richWardrobe(),
      makeGarment({
        id: "boots", name: "Black Chelsea Boots", category: "SHOES", slot: "shoe",
        garmentRelationships: ["favourite"], fitProfile: "tailored", ...ALIGNED,
      }),
    ];
    const hero = run(items, { passport: FIT_PASSPORT }).heroes.heroes.find((h) => h.garmentId === "boots");
    assert.ok(hero, "boots with a favourite marking and a Passport match should qualify");
    // It won on evidence, never on connectivity.
    assert.ok(["your-favourite", "passport-match", "untapped-hero"].includes(hero!.label));
  });

  it("a core garment outranks a finishing piece when both qualify for the same label", () => {
    // Both the trousers and the boots carry a Passport match on colour and fit.
    const items = [
      ...richWardrobe().map((g) => (g.id === "b1" ? { ...g, fitProfile: "tailored", primaryColor: "Black", ...ALIGNED } : g)),
      makeGarment({
        id: "boots", name: "Black Chelsea Boots", category: "SHOES", slot: "shoe",
        garmentRelationships: ["favourite"], fitProfile: "tailored", ...ALIGNED,
      }),
    ];
    const heroes = run(items, { passport: FIT_PASSPORT }).heroes.heroes;
    const passportMatch = heroes.find((h) => h.label === "passport-match");
    assert.ok(passportMatch);
    assert.notEqual(passportMatch!.garmentId, "boots", "a core garment takes the contested label");
    // The boots are not shut out — they win on the evidence only they have.
    assert.ok(heroes.some((h) => h.garmentId === "boots"));
  });

  it("never fills the section with finishing pieces", () => {
    const finishing = (id: string, category: string, slot: string) =>
      makeGarment({
        id, name: id, category, slot,
        garmentRelationships: ["favourite"], fitProfile: "tailored", ...ALIGNED,
      });
    const items = [
      ...richWardrobe(),
      finishing("boots", "SHOES", "shoe"),
      finishing("bag", "BAGS", "bag"),
      finishing("belt", "ACCESSORIES", "accessory"),
    ];
    const heroes = run(items, { passport: FIT_PASSPORT }).heroes.heroes;
    const finishingHeroes = heroes.filter((h) => ["boots", "bag", "belt"].includes(h.garmentId));
    assert.ok(finishingHeroes.length <= 1, `expected at most one finishing hero, got ${finishingHeroes.length}`);
  });

  it("activewear is ranked on connectivity when it is genuinely part of the wardrobe", () => {
    const items = [
      ...Array.from({ length: 5 }, (_u, i) =>
        makeGarment({ id: `a${i}`, name: `Sports Top ${i}`, category: "ACTIVEWEAR", slot: "top" }),
      ),
      makeGarment({ id: "b1", category: "BOTTOMS", slot: "bottom" }),
      makeGarment({ id: "b2", category: "BOTTOMS", slot: "bottom" }),
      makeGarment({ id: "b3", category: "BOTTOMS", slot: "bottom" }),
      makeGarment({ id: "track", name: "Track Jacket", category: "ACTIVEWEAR", slot: "outerwear" }),
    ];
    const versatile = run(items).heroes.heroes.find((h) => h.label === "most-versatile");
    assert.ok(versatile);
    assert.equal(versatile!.garmentId, "track", "an activewear-led wardrobe should be allowed an activewear hero");
  });

  it("incidental activewear is not ranked on connectivity", () => {
    // The same track jacket, with the same connectivity, in a wardrobe where
    // activewear is a footnote rather than a way of life.
    const items = [
      ...richWardrobe(),
      makeGarment({ id: "track", name: "Track Jacket", category: "ACTIVEWEAR", slot: "outerwear" }),
    ];
    const versatile = run(items).heroes.heroes.find((h) => h.label === "most-versatile");
    assert.notEqual(versatile?.garmentId, "track");
  });

  it("a stated active lifestyle is enough to make activewear count", () => {
    // The track jacket is the only layer, so it is the most connected piece in
    // the wardrobe. Whether it may say so depends entirely on relevance.
    const items = [
      ...richWardrobe().filter((g) => g.id !== "o1"),
      makeGarment({ id: "track", name: "Track Jacket", category: "ACTIVEWEAR", slot: "outerwear" }),
    ];
    const withoutLifestyle = run(items).heroes.heroes.find((h) => h.label === "most-versatile");
    assert.notEqual(withoutLifestyle?.garmentId, "track");

    const active: WardrobePassport = { ...PASSPORT, lifestyle: ["active-busy-days"] };
    const withLifestyle = run(items, { passport: active }).heroes.heroes.find((h) => h.label === "most-versatile");
    assert.equal(withLifestyle?.garmentId, "track");
  });
});

// ── §WI-14 — Contradictions ──────────────────────────────────────────────────

describe("§WI-14 contradiction insights", () => {
  it("surfaces a well-connected piece the customer finds hard to style", () => {
    const items = richWardrobe().map((g) =>
      g.id === "t1" ? { ...g, garmentRelationships: ["love-style-struggle"] } : g,
    );
    const contradiction = run(items).observations.find((o) => o.kind === "contradiction-potential-struggle");
    assert.ok(contradiction);
    assert.match(contradiction!.observation, /difficult to style/i);
    assert.match(contradiction!.observation, /connects with more of your Closet/i);
    assert.ok(contradiction!.evidence.some((e) => e.signal === "self-reported-wardrobe"));
    assert.ok(contradiction!.evidence.some((e) => e.signal === "garment-fact"));
  });

  it("ranks contradictions above descriptive observations", () => {
    const items = richWardrobe().map((g) =>
      g.id === "t1" ? { ...g, garmentRelationships: ["love-style-struggle"] } : g,
    );
    const kinds = run(items).observations.map((o) => o.kind);
    const contradictionIdx = kinds.indexOf("contradiction-potential-struggle");
    assert.equal(contradictionIdx, 0);
    for (const descriptive of ["colour-pattern", "connection-density", "repetition"] as const) {
      const idx = kinds.indexOf(descriptive);
      if (idx !== -1) assert.ok(contradictionIdx < idx, `${descriptive} should rank below a contradiction`);
    }
  });

  it("surfaces a well-aligned piece nAia has never styled", () => {
    const items = richWardrobe().map((g) => {
      if (g.id === "b1") return { ...g, outfitAppearances: 2 };
      if (g.id === "t1") return { ...g, fitProfile: "tailored", primaryColor: "Black", ...ALIGNED };
      return g;
    });
    const contradiction = run(items, { passport: FIT_PASSPORT }).observations.find(
      (o) => o.kind === "contradiction-alignment-unused",
    );
    assert.ok(contradiction);
    assert.ok(contradiction!.evidence.some((e) => e.signal === "passport-signal"));
    assert.ok(contradiction!.evidence.some((e) => e.signal === "naia-interaction"));
  });

  it("surfaces a favourite with unusually few partners", () => {
    const items = [
      ...richWardrobe().map((g) =>
        ["t1", "b1", "o1"].includes(g.id) ? { ...g, garmentRelationships: ["favourite"] } : g,
      ),
      makeGarment({
        id: "gown", name: "Burgundy Gown", category: "DRESSES", slot: "dress",
        formality: "evening", garmentRelationships: ["favourite"],
        colourProfile: { hueFamily: "red", wardrobeNeutral: false, lightDark: "dark", energyTier: "high-energy" },
      }),
    ];
    const contradiction = run(items).observations.find((o) => o.kind === "contradiction-favourite-isolated");
    assert.ok(contradiction);
    assert.equal(contradiction!.garmentIds[0], "gown");
  });

  it("does not force a contradiction when nothing contradicts", () => {
    const kinds = run(richWardrobe(), { passport: PASSPORT }).observations.map((o) => o.kind);
    assert.equal(kinds.some((k) => k.startsWith("contradiction-")), false);
  });

  it("drops the generic struggle pattern when a sharper contradiction covers it", () => {
    // Two struggling pieces with nothing in common — so the group observation
    // has nothing to add beyond the contradiction already named.
    const items = richWardrobe().map((g) => {
      if (g.id === "t1") return { ...g, garmentRelationships: ["love-style-struggle"], silhouette: "a-line", fitProfile: "tailored" };
      if (g.id === "b2") return { ...g, garmentRelationships: ["love-style-struggle"], silhouette: "flared", fitProfile: "relaxed" };
      return g;
    });
    const kinds = run(items).observations.map((o) => o.kind);
    assert.ok(kinds.includes("contradiction-potential-struggle"));
    assert.equal(kinds.includes("struggle-pattern"), false);
  });
});

// ── §WI-15 — Customer copy carries no analytics ──────────────────────────────

describe("§WI-15 customer copy", () => {
  const customerStrings = customerFacingStrings;

  it("never shows a percentage to the customer", () => {
    const items = [
      ...richWardrobe().map((g, i) => (i < 2 ? { ...g, garmentRelationships: ["rarely-wear"] } : g)),
      makeGarment({ id: "x1", category: "BOTTOMS", slot: "bottom" }),
    ];
    const result = run(items, { passport: FIT_PASSPORT });
    for (const text of customerStrings(result)) {
      assert.doesNotMatch(text, /%/, `customer copy must not contain a percentage: "${text}"`);
    }
  });

  it("leads connection density with the meaning, not the ratio", () => {
    const density = run(richWardrobe()).observations.find((o) => o.kind === "connection-density");
    if (density) {
      assert.doesNotMatch(density.observation, /\d+ of \d+|%/);
      assert.match(density.headline, /strong base wardrobe|connect less often/i);
      // The count survives as internal evidence.
      assert.ok(density.evidence.some((e) => /%/.test(e.detail)));
    }
  });
});

// ── §WI-16 — What nAia knows so far ──────────────────────────────────────────

describe("§WI-16 knowledge expression", () => {
  it("expresses each signal in the customer's language while keeping provenance", () => {
    const result = run(richWardrobe(), { passport: PASSPORT });
    const titles = result.signalAvailability.map((s) => s.title);
    assert.deepEqual(titles, ["Closet", "Style Passport", "Your feedback", "nAia activity", "Wear behaviour"]);
    for (const signal of result.signalAvailability) {
      assert.ok(VALID_SIGNALS.has(signal.signal), "internal provenance is preserved");
      assert.ok(signal.body.length > 0);
      assert.ok(["Reading", "Partly known", "Still learning"].includes(signal.statusText));
      assert.ok(signal.detail.length > 0);
    }
    assert.equal(result.signalAvailability.find((s) => s.signal === "observed-wear")!.statusText, "Still learning");
  });
});

// ── §WI-17 — One voice across Closet and Wardrobe Intelligence ───────────────

describe("§WI-17 wardrobe character line", () => {
  it("describes the wardrobe using the same traits the DNA section shows", () => {
    const items = richWardrobe();
    const line = wardrobeCharacterLine(items)!;
    assert.ok(line);
    const traits = run(items).dna.traits;
    assert.ok(traits.length > 0);
    assert.ok(line.toLowerCase().includes(traits[0].label.toLowerCase()));
  });

  it("says nothing when there is not enough to say", () => {
    assert.equal(wardrobeCharacterLine([]), null);
    assert.equal(wardrobeCharacterLine([makeGarment(), makeGarment()]), null);
  });
});


// ── §WI-18 — Passport colour vocabulary is exhaustive ────────────────────────
//
// The Passport and the Closet name colours differently. If a Passport colour is
// ever added without a Wardrobe Intelligence mapping, the stated preference
// silently disappears from every comparison — so that must fail here instead.

describe("§WI-18 passport colour bridge", () => {
  it("maps every colour the Style Passport can actually collect", () => {
    for (const family of COLOUR_FAMILIES) {
      assert.ok(
        PASSPORT_COLOUR_FAMILIES[family.id],
        `Passport colour "${family.id}" (${family.name}) has no Wardrobe Intelligence mapping`,
      );
    }
  });

  it("maps nothing the Passport cannot collect", () => {
    const known = new Set(COLOUR_FAMILIES.map((f) => f.id));
    for (const token of Object.keys(PASSPORT_COLOUR_FAMILIES)) {
      assert.ok(known.has(token), `"${token}" is not a Style Passport colour`);
    }
  });

  it("resolves every family a Passport token claims", () => {
    const closetFamilies = new Set(Object.values(CLOSET_COLOUR_FAMILY));
    for (const [token, families] of Object.entries(PASSPORT_COLOUR_FAMILIES)) {
      assert.ok(families.length > 0, `${token} maps to nothing`);
      for (const family of families) {
        assert.ok(closetFamilies.has(family), `${token} → "${family}" is not a Closet colour family`);
      }
    }
  });

  it("reads compound tokens as the families they name", () => {
    assert.deepEqual([...PASSPORT_COLOUR_FAMILIES["white-cream"]], ["white", "cream"]);
    assert.deepEqual([...PASSPORT_COLOUR_FAMILIES["beige-brown"]], ["beige", "brown"]);
    assert.deepEqual([...PASSPORT_COLOUR_FAMILIES["red-burgundy"]], ["red", "burgundy"]);
    assert.equal(closetColourFamily("Burgundy"), "burgundy");
    assert.equal(closetColourFamily("Ivory"), "cream");
    assert.equal(closetColourFamily("Charcoal Gray"), "grey");
    assert.equal(closetColourFamily("Camel"), "brown");
    assert.equal(closetColourFamily("Periwinkle Blue"), "blue");
    assert.equal(closetColourFamily("Gold"), "metallic");
    assert.equal(closetColourFamily("Silver"), "metallic");
    assert.equal(closetColourFamily("Unlisted Colour"), null);
  });

  it("keeps navy and blue separate — they are two Passport choices, not one", () => {
    assert.equal(closetColourFamily("Navy"), "navy");
    assert.equal(closetColourFamily("Medium Blue"), "blue");
    assert.equal([...PASSPORT_COLOUR_FAMILIES["navy"]].includes("blue"), false);
    assert.equal([...PASSPORT_COLOUR_FAMILIES["blue"]].includes("navy"), false);
  });

  it("maps every lifestyle the Style Passport can actually collect", () => {
    // Same guard as colours, for the other vocabulary Wardrobe Intelligence reads.
    // An unmapped lifestyle makes the register comparison claim her Closet is
    // built for something she never described.
    const tokens = quizQuestions
      .filter((q) => q.id === "lifestyle" || q.id === "lifestyle-legacy")
      .flatMap((q) => (q.options ?? []).map((o) => o.id));
    assert.ok(tokens.length > 0, "the lifestyle question must be findable");
    for (const token of tokens) {
      assert.ok(
        PASSPORT_LIFESTYLE_REGISTERS[token] !== undefined,
        `Passport lifestyle "${token}" has no Wardrobe Intelligence mapping`,
      );
    }
  });

  it("does not claim a mismatch when nothing she said maps to a register", () => {
    const passport: WardrobePassport = { ...PASSPORT, lifestyle: ["other-lifestyle"] };
    const register = run(neutralWardrobe(), { passport }).passportView.comparisons.find((c) => c.id === "register");
    if (register) {
      assert.doesNotMatch(register.reading, /isn't the part of your life/i);
    }
  });

  it("counts a garment once when several stated tokens could claim it", () => {
    const burgundy = { hueFamily: "red", wardrobeNeutral: false, lightDark: "dark" as const, energyTier: "high-energy" };
    const items = neutralWardrobe().map((g, i) =>
      i < 2 ? { ...g, primaryColor: "Burgundy", colourProfile: burgundy } : g,
    );
    // "red-burgundy" covers both red and burgundy; the two pieces must count twice, not four times.
    const passport: WardrobePassport = { ...PASSPORT, favoriteColors: ["red-burgundy"] };
    const colour = run(items, { passport }).passportView.comparisons.find((c) => c.id === "colour")!;
    assert.ok(colour);
    assert.match(colour.observed, /^2 of the \d+ colour-tagged pieces/);
  });
});


// ── §WI-19 — The refinement pass ─────────────────────────────────────────────

describe("§WI-19 display discipline", () => {
  it("shows at most one finishing piece among the heroes", () => {
    const finishing = (id: string, category: string, slot: string) =>
      makeGarment({
        id, name: id, category, slot, garmentRelationships: ["favourite", "wear-often"],
        fitProfile: "tailored", outfitAppearances: 5, savedLookAppearances: 2, ...ALIGNED,
      });
    const items = [
      ...richWardrobe(),
      finishing("boots", "SHOES", "shoe"),
      finishing("bag", "BAGS", "bag"),
      finishing("belt", "ACCESSORIES", "accessory"),
    ];
    const heroes = run(items, { passport: FIT_PASSPORT }).heroes.heroes;
    assert.equal(heroes.filter((h) => h.tier === "finishing").length, 1);
  });

  it("keeps the strongest finishing piece when several qualify", () => {
    const base = {
      category: "SHOES", slot: "shoe", fitProfile: "tailored", ...ALIGNED,
    } as Partial<WardrobeGarment>;
    const items = [
      ...richWardrobe(),
      makeGarment({ ...base, id: "weak-shoe", name: "Weak Shoe", garmentRelationships: ["favourite"] }),
      makeGarment({
        ...base, id: "strong-shoe", name: "Strong Shoe", category: "BAGS", slot: "bag",
        garmentRelationships: ["favourite", "wear-often"], outfitAppearances: 9, savedLookAppearances: 3,
      }),
    ];
    const finishingHero = run(items, { passport: FIT_PASSPORT }).heroes.heroes.find((h) => h.tier === "finishing");
    if (finishingHero) assert.equal(finishingHero.garmentId, "strong-shoe");
  });

  it("would rather show three heroes than weaken the bar to reach four", () => {
    const heroes = run(richWardrobe()).heroes.heroes;
    assert.ok(heroes.length >= 1 && heroes.length <= 4);
    for (const hero of heroes) assert.ok(hero.reasons.length >= 1);
  });

  it("does not lead two relationships with the same sentence", () => {
    const result = run(richWardrobe());
    const leads = result.pairings.pairings.map((p) => p.reason.split(". ")[0]);
    assert.equal(new Set(leads).size, leads.length, `repeated pairing reason: ${leads.join(" | ")}`);
  });

  it("only calls a shape a wardrobe characteristic when it genuinely recurs", () => {
    // One a-line piece among eight garments is not a characteristic.
    const items = richWardrobe().map((g, i) => ({ ...g, silhouette: i === 0 ? "a-line" : "straight" }));
    const shapes = run(items).dna.shapes.map((sh) => sh.label);
    assert.equal(shapes.includes("A-line"), false);
    assert.ok(shapes.includes("Straight"));
  });

  it("marks contradictions as discoveries and everything else as patterns", () => {
    const items = richWardrobe().map((g) =>
      g.id === "t1" ? { ...g, garmentRelationships: ["love-style-struggle"] } : g,
    );
    const observations = run(items).observations;
    for (const observation of observations) {
      assert.equal(
        observation.tier,
        observation.kind.startsWith("contradiction-") ? "discovery" : "pattern",
      );
    }
    assert.equal(observations[0].tier, "discovery");
  });

  it("states the no-gap result as a conclusion, not an absence", () => {
    const note = run(neutralWardrobe()).opportunities.noGapNote!;
    assert.match(note, /Nothing obvious is missing right now/);
    assert.match(note, /already represented/);
    assert.doesNotMatch(note, /complete|everything you need/i);
  });
});
