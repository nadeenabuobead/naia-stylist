// app/lib/ai/wardrobe-needs.test.ts
// Certification suite for the Wardrobe Needs synthesis layer.
// Run with: node --test --import tsx/esm app/lib/ai/wardrobe-needs.test.ts
//
// This layer exists to stop nAia manufacturing shopping advice. Most of what is
// asserted here is therefore a REFUSAL: a low count that is not a gap, a high
// count that is not sufficiency, a generated look that is not a worn one, and an
// unanalysed garment that is not a blocked one.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeWardrobeNeeds,
  computePaletteCoverage,
  classifyUsability,
  outfitClassKey,
  supportedPair,
  currentStyleDirection,
  garmentRegister,
  styleMeSessionRegister,
  type OutcomeFact,
  type StyleMeSessionFact,
  type WardrobeNeeds,
} from "./wardrobe-needs.ts";
import type { WardrobeGarment, WardrobePassport } from "./wardrobe-intelligence.ts";

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
    fitProfile: "relaxed",
    formality: "casual",
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
    sleeveLength: "full",
    necklineCoverage: "crew",
    hemLength: "n/a",
    topLength: "hip-length",
    midriffExposed: false,
    shoulderCoverage: true,
    outfitAppearances: 0,
    savedLookAppearances: 0,
    outcomeKept: 0,
    outcomeChanged: 0,
    outcomeNotWorn: 0,
    observedWear: null,
  };
  return { ...base, ...overrides };
}

/** A compatible top/bottom pair at a given register — one complete look. */
function makeLook(formality: string, n: number, overrides: Partial<WardrobeGarment> = {}): WardrobeGarment[] {
  const out: WardrobeGarment[] = [];
  for (let i = 0; i < n; i++) {
    out.push(makeGarment({ slot: "top", category: "TOPS", formality, topLength: "hip-length", hemLength: "n/a", ...overrides }));
    out.push(makeGarment({ slot: "bottom", category: "BOTTOMS", formality, topLength: "n/a", hemLength: "full", ...overrides }));
  }
  return out;
}

/**
 * n genuinely different top shapes against n genuinely different bottoms —
 * varied enough that each pair reads as its own look. Contrast with makeLook(),
 * whose pieces are interchangeable clones.
 */
const TOP_SHAPES = [
  { silhouette: "fitted",   fitProfile: "tailored", primaryColor: "Black" },
  { silhouette: "oversized", fitProfile: "loose",   primaryColor: "Navy"  },
  { silhouette: "boxy",     fitProfile: "relaxed",  primaryColor: "Cream" },
  { silhouette: "wrap",     fitProfile: "fitted",   primaryColor: "Green" },
  { silhouette: "column",   fitProfile: "slim",     primaryColor: "Grey"  },
];
const BOTTOM_SHAPES = [
  { silhouette: "straight", fitProfile: "tailored", primaryColor: "Charcoal" },
  { silhouette: "flared",   fitProfile: "flowy",    primaryColor: "Beige"    },
  { silhouette: "tapered",  fitProfile: "slim",     primaryColor: "Navy"     },
  { silhouette: "a-line",   fitProfile: "relaxed",  primaryColor: "Brown"    },
  { silhouette: "balloon",  fitProfile: "oversized", primaryColor: "Black"   },
];

function variedLooks(
  formality: string,
  n: number,
  overrides: Partial<WardrobeGarment> = {},
): WardrobeGarment[] {
  const out: WardrobeGarment[] = [];
  // All wardrobe neutrals, so they sit in one depth cluster — the variety is in
  // shape and fit, which is what actually makes a look read differently.
  const neutral = { hueFamily: null, wardrobeNeutral: true, lightDark: "dark" as const, energyTier: "neutral-versatile" as const };
  for (let i = 0; i < n; i++) {
    const t = TOP_SHAPES[i % TOP_SHAPES.length];
    const b = BOTTOM_SHAPES[i % BOTTOM_SHAPES.length];
    out.push(makeGarment({
      slot: "top", category: "TOPS", formality, topLength: "hip-length", hemLength: "n/a",
      occasions: ["Weekend"], colourProfile: neutral, ...t, ...overrides,
    }));
    out.push(makeGarment({
      slot: "bottom", category: "BOTTOMS", formality, topLength: "n/a", hemLength: "full",
      occasions: ["Weekend"], colourProfile: neutral, ...b, ...overrides,
    }));
  }
  return out;
}

function makePassport(overrides: Partial<WardrobePassport> = {}): WardrobePassport {
  const base: WardrobePassport = {
    lifestyle: [],
    favoriteColors: [],
    avoidColors: [],
    stylePersonalities: [],
    silhouette: [],
    structure: null,
    fitPreferences: [],
    styleStruggles: [],
    styleSupport: [],
    becoming: [],
  };
  return { ...base, ...overrides };
}

function run(
  items: WardrobeGarment[],
  opts: {
    passport?: WardrobePassport | null;
    sessions?: StyleMeSessionFact[] | null;
    outcomes?: OutcomeFact[] | null;
  } = {},
): WardrobeNeeds {
  return computeWardrobeNeeds({
    items,
    passport: opts.passport ?? null,
    styleMeSessions: opts.sessions ?? null,
    outcomes: opts.outcomes ?? null,
  });
}

const registerOf = (needs: WardrobeNeeds, id: string) => needs.registers.find((r) => r.register === id)!;
const moreIds = (needs: WardrobeNeeds) => needs.couldUseMore.map((f) => f.register);
const enoughText = (needs: WardrobeNeeds) => needs.enough.map((f) => `${f.title} ${f.body}`).join(" ");

// ── §WN-1 Enough, not a gap ───────────────────────────────────────────────────

describe("§WN-1 depth that is already sufficient", () => {
  it("1 — lots of basics with adequate everyday coverage reads as enough, never as a gap", () => {
    // Genuine variety: five distinguishable top shapes against five bottoms.
    const items = variedLooks("casual", 5);
    const needs = run(items, { passport: makePassport({ lifestyle: ["everyday-casual"] }) });

    const everyday = registerOf(needs, "everyday");
    assert.ok(everyday.distinctLooks >= 6, `expected deep everyday coverage, got ${everyday.distinctLooks}`);
    assert.ok(!moreIds(needs).includes("everyday"), "a well-covered everyday register must never be a gap");
    assert.ok(needs.enough.length > 0, "deep neutral everyday depth should register as enough");
    assert.match(enoughText(needs), /Another similar piece is unlikely to materially expand what you can wear/);
    // Where a thinner register exists, the alternative is offered positively
    // rather than as a comparison the customer has to unpack.
    assert.doesNotMatch(enoughText(needs), /, where .* would\./);
  });

  it("1a-2 — a thinner register is named as something to strengthen, not as a comparison", () => {
    const items = [
      ...variedLooks("casual", 5),
      makeGarment({ slot: "top", formality: "business-casual" }),
      makeGarment({ slot: "bottom", category: "BOTTOMS", formality: "business-casual", topLength: "n/a", hemLength: "full" }),
    ];
    const needs = run(items, { passport: makePassport({ lifestyle: ["everyday-casual", "work-office"] }) });
    assert.ok(needs.enough.length > 0, "everyday should still read as enough");
    assert.match(enoughText(needs), /strengthening your work options would add more\./);
  });

  it("1b — the enough claim names the cluster, not the whole wardrobe", () => {
    const needs = run(variedLooks("casual", 5), { passport: makePassport({ lifestyle: ["everyday-casual"] }) });
    // "enough tops" is never a true statement on its own; the claim must be scoped.
    for (const finding of needs.enough) {
      assert.match(finding.title, /everyday|work|occasion/, `unscoped enough claim: ${finding.title}`);
    }
  });
});

// ── §WN-1c The Cartesian trap ─────────────────────────────────────────────────

describe("§WN-1c depth is not a cross product", () => {
  it("1c — 13 interchangeable tops and 13 interchangeable bottoms are not 169 looks", () => {
    const items = makeLook("casual", 13); // 26 pieces, all clones of each other
    const needs = run(items, { passport: makePassport({ lifestyle: ["everyday-casual"] }) });
    const everyday = registerOf(needs, "everyday");

    assert.equal(everyday.usableCount, 26, "all 26 pieces are usable");
    assert.ok(everyday.combinations > 100, `the raw cross product really is large (${everyday.combinations})`);
    // ...and yet there is exactly one outfit formula here.
    assert.equal(everyday.distinctLooks, 1, `interchangeable pieces make one look, got ${everyday.distinctLooks}`);
    assert.ok(
      !needs.enough.some((f) => f.register === "everyday"),
      "a wardrobe of clones must never be called deep on the strength of its combination count",
    );
  });

  it("1d — many pieces that do not combine are reported as repetition, not as 'buy more'", () => {
    const needs = run(makeLook("casual", 13), { passport: makePassport({ lifestyle: ["everyday-casual"] }) });
    const finding = needs.couldUseMore.find((f) => f.register === "everyday");
    assert.ok(finding, "26 near-identical pieces serving a stated life is a real finding");
    assert.equal(finding!.kind, "repetition");
    assert.match(finding!.body, /same outfit/);
    assert.match(finding!.body, /wouldn't widen what you can wear/);
    // The one thing it must never do is recommend more of the same.
    assert.doesNotMatch(finding!.body, /you could use more of|buy more like/i);
  });

  it("1e — the page never says 'enough' and 'need more' about one register", () => {
    for (const fixture of [makeLook("casual", 13), variedLooks("casual", 5), makeLook("casual", 5)]) {
      const needs = run(fixture, { passport: makePassport({ lifestyle: ["everyday-casual"] }) });
      const enoughRegisters = new Set(needs.enough.map((f) => f.register));
      for (const f of needs.couldUseMore) {
        assert.ok(!enoughRegisters.has(f.register), `contradiction on ${f.register}`);
      }
    }
  });

  it("1f — a pair needs a reason about the two garments, not just a shared register", () => {
    // Same formality, nothing else in common that scorePair can name.
    const a = makeGarment({ slot: "top", formality: "casual", colourProfile: null, fitProfile: null, silhouette: null, visualWeight: null, occasions: [] });
    const b = makeGarment({ slot: "bottom", formality: "casual", colourProfile: null, fitProfile: null, silhouette: null, visualWeight: null, occasions: [] });
    assert.equal(supportedPair(a, b), false, "register agreement alone is not compatibility evidence");

    // Give them a real relationship and it qualifies.
    const c = makeGarment({ slot: "bottom", formality: "casual", occasions: ["Weekend"] });
    const d = makeGarment({ slot: "top", formality: "casual", occasions: ["Weekend"] });
    assert.equal(supportedPair(c, d), true, "a shared occasion tag she applied is real evidence");
  });

  it("1g — interchangeability ignores identity and tracks what changes a look", () => {
    const a = makeGarment({ slot: "top", silhouette: "fitted", fitProfile: "tailored" });
    const b = makeGarment({ slot: "top", silhouette: "fitted", fitProfile: "tailored" });
    const c = makeGarment({ slot: "top", silhouette: "oversized", fitProfile: "loose" });
    assert.equal(outfitClassKey(a), outfitClassKey(b), "two identical tops are one option");
    assert.notEqual(outfitClassKey(a), outfitClassKey(c), "a different shape is a different option");
  });
});

// ── §WN-2 A gap that matters ──────────────────────────────────────────────────

describe("§WN-2 gaps relative to the life she described", () => {
  it("2 — thin occasion depth plus a stated dinners life is a real opportunity", () => {
    const items = [
      ...variedLooks("casual", 5),                                // real everyday range
      makeGarment({ slot: "dress", category: "DRESSES", formality: "evening", hemLength: "midi", topLength: "n/a" }),
    ];
    const needs = run(items, {
      passport: makePassport({ lifestyle: ["everyday-casual", "dinners-going-out"] }),
    });

    assert.ok(moreIds(needs).includes("occasion"), "occasion depth should surface as the opportunity");
    assert.ok(!moreIds(needs).includes("everyday"), "everyday is well covered and must not be flagged");

    const finding = needs.couldUseMore.find((f) => f.register === "occasion")!;
    // The reason must be her own words, not a bare count.
    assert.match(finding.body, /dinners and going out/);
  });

  it("2b — the opportunity is stated in complete looks, not piece counts", () => {
    const needs = run(
      [...variedLooks("casual", 5), makeGarment({ slot: "dress", category: "DRESSES", formality: "evening" })],
      { passport: makePassport({ lifestyle: ["dinners-going-out"] }) },
    );
    const finding = needs.couldUseMore.find((f) => f.register === "occasion")!;
    // The body says what it means for her; it never quotes an internal count.
    assert.match(finding.body, /very little in your Closet that combines/);
    assert.doesNotMatch(finding.body, /\d+ complete look/);
  });
});

// ── §WN-3 Low count that is not a gap ─────────────────────────────────────────

describe("§WN-3 irrelevance is not absence", () => {
  it("3 — a near-empty register the Passport never asks for is not called a gap", () => {
    // Zero work pieces, and nothing in her life asks for work dressing.
    const needs = run(makeLook("casual", 8), {
      passport: makePassport({ lifestyle: ["everyday-casual"] }),
    });

    const work = registerOf(needs, "work");
    assert.equal(work.rawCount, 0);
    assert.equal(work.needed, false);
    assert.ok(!moreIds(needs).includes("work"), "an unneeded empty register must never be reported as a gap");
  });

  it("3b — with no Passport at all, nAia reports no needs rather than guessing", () => {
    const needs = run(makeLook("casual", 8), { passport: null });
    assert.deepEqual(moreIds(needs), [], "no stated life means no gap may be asserted");
  });
});

// ── §WN-4 Raw depth vs usable depth ───────────────────────────────────────────

describe("§WN-4 effective depth", () => {
  it("4 — high raw count with few usable pieces is an effective-depth gap, not a quantity gap", () => {
    // 8 occasion pieces. 6 of them are sleeveless, and she keeps her arms covered.
    const occasion = [
      ...makeLook("evening", 1, { hemLength: "maxi" }),                       // 1 usable look
      ...Array.from({ length: 6 }, () =>
        makeGarment({ slot: "dress", category: "DRESSES", formality: "evening", sleeveLength: "sleeveless", hemLength: "maxi" }),
      ),
    ];
    const needs = run([...makeLook("casual", 6), ...occasion], {
      passport: makePassport({
        lifestyle: ["dinners-going-out", "everyday-casual"],
        dressingPreferences: ["arms-covered"],
      }),
    });

    const r = registerOf(needs, "occasion");
    assert.ok(r.rawCount >= 6, `expected real raw depth, got ${r.rawCount}`);
    assert.ok(r.blockedCount >= 3, `expected blocked pieces, got ${r.blockedCount}`);

    const finding = needs.couldUseMore.find((f) => f.register === "occasion");
    assert.ok(finding, "occasion should surface");
    assert.equal(finding!.kind, "effective-depth");
    assert.match(finding!.title, /not quantity/i);
    assert.match(
      finding!.body,
      /but only 2 currently meet your stated coverage preferences — including keeping your arms covered\./,
    );
    assert.match(
      finding!.body,
      /it's occasion and evening dressing that fits the way you've told nAia you prefer to dress\./,
    );
    // The point is fit-to-her, not a vague appeal to what she would "actually" wear.
    assert.doesNotMatch(finding!.body, /you'd actually wear/);
    // The standard is named once, at the close — not repeated mid-sentence.
    assert.equal(
      (finding!.body.match(/the way you've told nAia you prefer to dress/g) ?? []).length,
      1,
      "the standard should be stated once, not twice in one paragraph",
    );
  });

  it("4b — unanalysed pieces are unknown, never blocked, and cannot create a gap", () => {
    // Same shape as above, but the pieces are simply not read yet.
    const unread = Array.from({ length: 6 }, () =>
      makeGarment({ slot: "dress", category: "DRESSES", formality: "evening", analysisStatus: "not_analyzed", intelligenceSource: "none" }),
    );
    const needs = run([...makeLook("casual", 6), ...unread], {
      passport: makePassport({ lifestyle: ["dinners-going-out"], dressingPreferences: ["arms-covered"] }),
    });

    const r = registerOf(needs, "occasion");
    assert.equal(r.blockedCount, 0, "not-yet-read pieces must never count as blocked");
    assert.equal(r.unknownCount, 6);

    const finding = needs.couldUseMore.find((f) => f.register === "occasion");
    if (finding) {
      assert.notEqual(finding.kind, "effective-depth", "missing analysis must not masquerade as a coverage conflict");
      assert.match(finding.body, /still being read/, "an unread wardrobe must say so");
    }
  });

  it("4c — classifyUsability keeps unknown, blocked and usable strictly apart", () => {
    const passport = makePassport({ dressingPreferences: ["arms-covered"] });
    assert.equal(classifyUsability(makeGarment({ sleeveLength: "full" }), passport).usability, "usable");
    assert.equal(classifyUsability(makeGarment({ sleeveLength: "sleeveless" }), passport).usability, "blocked");
    assert.equal(classifyUsability(makeGarment({ sleeveLength: null }), passport).usability, "unknown");
    // "n/a" means the field does not apply to this garment type — exempt, not blocked.
    assert.equal(classifyUsability(makeGarment({ sleeveLength: "n/a" }), passport).usability, "usable");
    // Never read at all → unknown regardless of stated preferences.
    assert.equal(
      classifyUsability(makeGarment({ analysisStatus: "not_analyzed", intelligenceSource: "none" }), passport).usability,
      "unknown",
    );
  });
});

// ── §WN-5 Small but sufficient ────────────────────────────────────────────────

describe("§WN-5 a small wardrobe that works is not a gap", () => {
  it("5 — low raw count with strong usable coverage produces no fake gap", () => {
    // Three occasion looks from six pieces — small, but every piece works.
    const items = [
      ...variedLooks("casual", 4),
      ...variedLooks("evening", 3, { hemLength: "maxi" }),
    ];
    const needs = run(items, {
      passport: makePassport({ lifestyle: ["dinners-going-out", "everyday-casual"] }),
    });

    const r = registerOf(needs, "occasion");
    assert.ok(r.usableCount <= 6, "this really is a small register");
    assert.ok(r.distinctLooks > 2, `a small but varied register should clear the thin threshold, got ${r.distinctLooks}`);
    assert.ok(!moreIds(needs).includes("occasion"), "a small register that covers her needs is not a gap");
  });
});

// ── §WN-6 / §WN-7 Passport synthesis ──────────────────────────────────────────

describe("§WN-6 Passport and Closet alignment", () => {
  it("6 — a closet that matches the stated palette reads as alignment", () => {
    const items = makeLook("casual", 5, { primaryColor: "Black" });
    // "black" is the real Passport colour token (see PASSPORT_COLOUR_FAMILIES).
    const needs = run(items, { passport: makePassport({ favoriteColors: ["black"] }) });

    const line = needs.synthesis.lines.find((l) => l.id === "synth-colour");
    assert.ok(line, "a colour reading should exist");
    assert.equal(line!.kind, "alignment");
    // Both halves must be evidenced — a statement and a measurement.
    assert.ok(line!.evidence.some((e) => e.signal === "passport-signal"));
    assert.ok(line!.evidence.some((e) => e.signal === "garment-fact"));
  });

  it("6b — a Passport colour token outside the vocabulary never fakes alignment", () => {
    const items = makeLook("casual", 5, { primaryColor: "Black" });
    const needs = run(items, { passport: makePassport({ favoriteColors: ["black-grey"] }) });
    const line = needs.synthesis.lines.find((l) => l.id === "synth-colour");
    // An unmappable token matches nothing, so the honest reading is tension —
    // never a quiet upgrade to "your closet reflects your palette".
    assert.notEqual(line?.kind, "alignment");
  });
});

describe("§WN-7 Passport and Closet tension", () => {
  it("7 — a stated colour appetite against a neutral closet reads as tension, not failure", () => {
    const items = makeLook("casual", 5, { primaryColor: "Black" });
    const needs = run(items, {
      passport: makePassport({ neutralVsColour: "mostly-colour", favoriteColors: [] }),
    });

    const line = needs.synthesis.lines.find((l) => l.id === "synth-neutral");
    assert.ok(line, "a neutral-appetite reading should exist");
    assert.equal(line!.kind, "tension");
    assert.match(line!.reading, /appetite is there/i);
  });

  it("6c — an aligned palette is reported as alignment, never as intent", () => {
    const items = variedLooks("casual", 5);
    const needs = run(items, { passport: makePassport({ neutralVsColour: "mostly-neutral" }) });

    const line = needs.synthesis.lines.find((l) => l.id === "synth-neutral");
    assert.ok(line, "a neutral-appetite reading should exist");
    assert.equal(line!.kind, "alignment");
    assert.equal(line!.reading, "Your Closet is strongly neutral, matching the balance you said you prefer.");

    // Palette agreement is evidence of a match, not of deliberateness, restraint
    // or any other motive. nAia does not read intent out of colour data.
    for (const word of ["deliberate", "accidental", "restraint", "intentional", "disciplined"]) {
      assert.doesNotMatch(line!.reading.toLowerCase(), new RegExp(word), `motive inferred: "${word}"`);
    }
  });

  it("6d — the two palette readings name different things and never claim purchase behaviour", () => {
    const items = variedLooks("casual", 5).map((g) => ({ ...g, primaryColor: "Black" }));
    const needs = run(items, {
      passport: makePassport({ favoriteColors: ["black"], neutralVsColour: "mostly-neutral" }),
    });

    const colour = needs.synthesis.lines.find((l) => l.id === "synth-colour");
    const neutral = needs.synthesis.lines.find((l) => l.id === "synth-neutral");
    assert.ok(colour && neutral, "both palette dimensions should read");

    assert.equal(colour!.reading, "The colours you told nAia you love are all well represented in your Closet.");
    assert.equal(neutral!.reading, "Your Closet is strongly neutral, matching the balance you said you prefer.");
    assert.notEqual(colour!.reading, neutral!.reading, "two dimensions must not read as one");

    // The Closet proves ownership, never how or when a piece was acquired.
    for (const reading of [colour!.reading, neutral!.reading]) {
      for (const word of ["what you buy", "you bought", "purchase", "shopping"]) {
        assert.doesNotMatch(reading.toLowerCase(), new RegExp(word), `purchase behaviour claimed: "${word}"`);
      }
    }
  });

  it("7b — where no dimension is evidenced, nAia says the connection isn't clear", () => {
    // A read closet, but a Passport that states none of the comparable dimensions.
    const needs = run(makeLook("casual", 5), { passport: makePassport({ lifestyle: ["everyday-casual"] }) });
    assert.equal(needs.synthesis.state, "learning");
    assert.match(needs.synthesis.learningNote ?? "", /can't yet draw a clear line/);
    assert.equal(needs.synthesis.lines.length, 0, "no invented connection may be shown");
  });

  it("7c — a retired Q3 answer is never presented as the current style direction", () => {
    const legacy = makePassport({ stylePersonalities: ["classic", "romantic"] });
    assert.deepEqual(currentStyleDirection(legacy), { values: ["classic", "romantic"], source: "legacy" });

    const rev7 = makePassport({ stylePersonalities: ["classic"], styleDirections: ["minimal"] });
    assert.deepEqual(currentStyleDirection(rev7), { values: ["minimal"], source: "rev7" });

    // On the page, a legacy-only profile is told the answer is out of date.
    const needs = run(makeLook("casual", 5), { passport: legacy });
    const line = needs.synthesis.lines.find((l) => l.id === "synth-direction");
    assert.ok(line, "a legacy-only profile should be told its style answer is superseded");
    assert.equal(line!.kind, "unclear");
    assert.match(line!.reading, /older style question/);
  });
});

// ── §WN-6p Palette alignment vs palette coverage ─────────────────────────────

describe("§WN-6p a palette can be aligned and still not covered", () => {
  /** n pieces in one colour family, at everyday level. */
  const inColour = (n: number, colour: string, neutral = true) =>
    Array.from({ length: n }, () => makeGarment({
      primaryColor: colour,
      colourProfile: { hueFamily: null, wardrobeNeutral: neutral, lightDark: "dark", energyTier: "neutral-versatile" },
    }));

  it("6p-1 — three loved colours but a Closet of one reads as uneven, never strong", () => {
    // Loves black, grey and cream. Owns 12 black, no grey, no cream.
    const items = inColour(12, "Black");
    const needs = run(items, {
      passport: makePassport({ favoriteColors: ["black", "grey", "white-cream"] }),
    });

    const line = needs.synthesis.lines.find((l) => l.id === "synth-colour");
    assert.ok(line, "a colour reading should exist");
    assert.equal(line!.kind, "uneven", "100% inside the palette is not the same as covering it");
    assert.notEqual(line!.kind, "alignment");
    assert.match(line!.reading, /stays closely within the colours you told nAia you like/);
    assert.match(line!.reading, /barely represented/);
    assert.match(line!.reading, /grey/);
    assert.match(line!.reading, /cream|white/);
  });

  it("6p-2 — every loved colour genuinely present reads as a strong match", () => {
    const items = [...inColour(5, "Black"), ...inColour(5, "Grey"), ...inColour(5, "Cream")];
    const needs = run(items, {
      passport: makePassport({ favoriteColors: ["black", "grey", "white-cream"] }),
    });
    const line = needs.synthesis.lines.find((l) => l.id === "synth-colour");
    assert.ok(line);
    assert.equal(line!.kind, "alignment");
    assert.match(line!.reading, /all well represented/);
  });

  it("6p-3 — a Closet mostly outside the loved palette reads as tension", () => {
    const items = [...inColour(2, "Black"), ...inColour(12, "Green", false)];
    const needs = run(items, { passport: makePassport({ favoriteColors: ["black"] }) });
    const line = needs.synthesis.lines.find((l) => l.id === "synth-colour");
    assert.ok(line);
    assert.equal(line!.kind, "tension");
  });

  it("6p-4 — unreadable colour is unknown, never counted as a missing colour", () => {
    // Six black, six with no colour nAia can read.
    const items = [
      ...inColour(6, "Black"),
      ...Array.from({ length: 6 }, () => makeGarment({ primaryColor: null, colourProfile: null })),
    ];
    const coverage = computePaletteCoverage(items, makePassport({ favoriteColors: ["black", "grey"] }));

    assert.equal(coverage.unknown, 6, "unreadable pieces are counted as unknown");
    assert.equal(coverage.colourReadable, 6);
    const black = coverage.families.find((f) => f.token === "black")!;
    assert.equal(black.count, 6, "unknown pieces neither add to nor subtract from a family");
    assert.equal(black.covered, true);
    // grey is genuinely absent — but that is measured on READABLE pieces only.
    const grey = coverage.families.find((f) => f.token === "grey")!;
    assert.equal(grey.count, 0);
  });

  it("6p-5 — coverage counts only families the colour bridge actually supports", () => {
    const coverage = computePaletteCoverage(
      Array.from({ length: 6 }, () => makeGarment({ primaryColor: "Black" })),
      makePassport({ favoriteColors: ["black", "not-a-real-colour-token"] }),
    );
    assert.deepEqual(coverage.families.map((f) => f.token), ["black"],
      "an unmappable token is dropped, never approximated into a family");
  });
});

// ── §WN-8 Generated is not worn ───────────────────────────────────────────────

describe("§WN-8 StyleMe history never becomes wear behaviour", () => {
  it("8 — a heavily generated piece is described as generated, never as worn", () => {
    const hero = makeGarment({ slot: "top", outfitAppearances: 9 });
    const items = [hero, ...makeLook("casual", 5)];
    const sessions: StyleMeSessionFact[] = [
      { id: "s1", register: "everyday", intentions: ["feel-put-together"], garmentIds: [hero.id] },
      { id: "s2", register: "everyday", intentions: ["feel-put-together"], garmentIds: [hero.id] },
    ];

    const needs = run(items, { passport: makePassport({ lifestyle: ["everyday-casual"] }), sessions });
    const reached = needs.styleMe.reachedFor.find((p) => p.garmentId === hero.id);
    assert.ok(reached, "a repeatedly used piece should surface");
    assert.match(reached!.note, /nAia has built/, "must describe what nAia did");
    assert.doesNotMatch(reached!.note, /you wore|you've worn|worn/i, "generated looks are not wear evidence");
  });

  it("8b — no StyleMe history at all produces no claims, and says why", () => {
    const needs = run(makeLook("casual", 5), { sessions: [] });
    assert.equal(needs.styleMe.state, "learning");
    assert.equal(needs.styleMe.reachedFor.length, 0);
    assert.equal(needs.styleMe.struggles.length, 0);
  });

  it("8c — not querying StyleMe reads differently from having no StyleMe history", () => {
    const notQueried = run(makeLook("casual", 5), { sessions: null });
    const queriedEmpty = run(makeLook("casual", 5), { sessions: [] });
    assert.notEqual(notQueried.styleMe.learningNote, queriedEmpty.styleMe.learningNote);
  });

  it("8d — the session register mapper only trusts the shipped vocabularies", () => {
    assert.equal(styleMeSessionRegister("work", null), "work");
    assert.equal(styleMeSessionRegister("dinner", null), "occasion");
    assert.equal(styleMeSessionRegister("everyday", null), "everyday");
    // The conditional formality answer is the more specific statement and wins.
    assert.equal(styleMeSessionRegister("everyday", "formality-occasion"), "occasion");
    // An unreadable request is left unbucketed rather than guessed.
    assert.equal(styleMeSessionRegister("brunch-with-nan", null), null);
    assert.equal(styleMeSessionRegister(null, null), null);
  });
});

// ── §WN-9 Feedback only speaks when it exists ─────────────────────────────────

describe("§WN-9 outcome feedback", () => {
  it("9 — with no recorded outcomes nAia makes no feedback claim", () => {
    const needs = run(makeLook("casual", 5), { outcomes: [] });
    assert.equal(needs.outcomes.state, "learning");
    assert.equal(needs.outcomes.keptNote, null);
    assert.equal(needs.outcomes.changedNote, null);
    assert.ok(!needs.headlines.some((h) => h.source === "outcome"));
  });

  it("9b — real outcomes produce a register-level reading, never a garment-level one", () => {
    const outcomes: OutcomeFact[] = [
      { suggestionId: "a", status: "changed-something", register: "occasion", garmentIds: ["g1"] },
      { suggestionId: "b", status: "changed-something", register: "occasion", garmentIds: ["g1"] },
      { suggestionId: "c", status: "changed-something", register: "occasion", garmentIds: ["g2"] },
    ];
    const needs = run(makeLook("casual", 5), { outcomes });
    assert.equal(needs.outcomes.state, "available");
    assert.equal(needs.outcomes.totalOutcomes, 3);
    assert.ok(needs.outcomes.changedNote);
    assert.match(needs.outcomes.changedNote!, /occasion and evening dressing/);
  });

  it("9c — one or two outcomes are not enough to conclude anything", () => {
    const outcomes: OutcomeFact[] = [
      { suggestionId: "a", status: "changed-something", register: "occasion", garmentIds: [] },
      { suggestionId: "b", status: "changed-something", register: "occasion", garmentIds: [] },
    ];
    const needs = run(makeLook("casual", 5), { outcomes });
    assert.equal(needs.outcomes.state, "learning");
    assert.equal(needs.outcomes.changedNote, null);
  });

  it("9d — not querying outcomes reads differently from having none", () => {
    const notQueried = run(makeLook("casual", 5), { outcomes: null });
    const queriedEmpty = run(makeLook("casual", 5), { outcomes: [] });
    assert.notEqual(notQueried.outcomes.learningNote, queriedEmpty.outcomes.learningNote);
  });
});

// ── §WN-10 Permission to conclude nothing is needed ───────────────────────────

describe("§WN-10 no urgent shopping need", () => {
  it("10 — a wardrobe that covers her stated life is told nothing needs buying", () => {
    const items = [...variedLooks("casual", 5), ...variedLooks("evening", 4, { hemLength: "maxi" })];
    const needs = run(items, {
      passport: makePassport({ lifestyle: ["everyday-casual", "dinners-going-out"] }),
    });

    assert.deepEqual(moreIds(needs), [], "no gap should be asserted");
    assert.ok(needs.noUrgentNeed, "nAia must be willing to say nothing is needed");
    assert.match(needs.noUrgentNeed!, /needs buying right now/);
    assert.ok(
      needs.headlines.some((h) => h.id === "no-urgent-need"),
      "that conclusion belongs in the headlines like any other",
    );
  });

  it("10b — the headline block never repeats one finding twice", () => {
    const items = [...variedLooks("casual", 5), makeGarment({ slot: "dress", formality: "evening" })];
    const needs = run(items, { passport: makePassport({ lifestyle: ["everyday-casual", "dinners-going-out"] }) });
    const ids = needs.headlines.map((h) => h.id);
    assert.equal(new Set(ids).size, ids.length, `duplicate headline: ${ids.join(", ")}`);
    assert.ok(ids.length <= 5, "the summary stays a summary");
  });
});

// ── §WN-11 Structural guards ──────────────────────────────────────────────────

describe("§WN-11 structural guards", () => {
  it("11 — a wardrobe below the minimum says so instead of guessing", () => {
    const needs = run([makeGarment(), makeGarment()]);
    assert.equal(needs.state, "learning");
    assert.equal(needs.couldUseMore.length, 0);
    assert.equal(needs.enough.length, 0);
    assert.equal(needs.headlines.length, 0);
  });

  it("11b — register assignment prefers formality and falls back to occasion tags", () => {
    assert.equal(garmentRegister(makeGarment({ formality: "business-formal" })), "work");
    assert.equal(garmentRegister(makeGarment({ formality: "evening" })), "occasion");
    assert.equal(garmentRegister(makeGarment({ formality: null, occasions: ["Work"] })), "work");
    assert.equal(garmentRegister(makeGarment({ formality: null, occasions: [] })), null);
  });

  it("11c — derived (shadow) intention data never reaches an intention claim", () => {
    const items = makeLook("casual", 5).map((g) => ({
      ...g,
      intentions: { "feel-put-together": "strong" as const },
      intentionsSource: "derived" as const,
    }));
    const sessions: StyleMeSessionFact[] = [
      { id: "s1", register: "everyday", intentions: ["feel-put-together"], garmentIds: [] },
    ];
    const needs = run(items, { sessions });
    assert.deepEqual(needs.styleMe.strongIntentions, [], "shadow V2 output must stay off the page");
  });

  it("11d — curated intention data is allowed to speak", () => {
    const items = makeLook("casual", 5).map((g) => ({
      ...g,
      intentions: { "feel-put-together": "strong" as const },
      intentionsSource: "curated" as const,
    }));
    const sessions: StyleMeSessionFact[] = [
      { id: "s1", register: "everyday", intentions: ["feel-put-together"], garmentIds: [] },
    ];
    const needs = run(items, { sessions });
    assert.ok(needs.styleMe.strongIntentions.includes("feel put together"));
  });

  it("11c-2 — a thin register names itself in the depth note", () => {
    // Work is named in her lifestyle but barely present in the Closet.
    const items = [
      ...variedLooks("casual", 5),
      makeGarment({ slot: "top", formality: "business-casual" }),
      makeGarment({ slot: "bottom", category: "BOTTOMS", formality: "business-casual", topLength: "n/a", hemLength: "full" }),
    ];
    const needs = run(items, { passport: makePassport({ lifestyle: ["work-office", "everyday-casual"] }) });

    const work = registerOf(needs, "work");
    assert.equal(work.depthLabel, "Limited usable work depth");
    assert.equal(work.depthNote, "You currently have limited depth for polished, work-ready dressing.");
    // The note says what is thin, not how the engine decided it was thin.
    assert.doesNotMatch(work.depthNote, /combine|wear out|\d/);
  });

  it("11d-2 — no internal number or engineering label reaches the customer", () => {
    const needs = run(variedLooks("casual", 5), { passport: makePassport({ lifestyle: ["everyday-casual"] }) });
    const shown = [
      ...needs.headlines.map((h) => h.text),
      ...needs.registers.map((r) => `${r.depthLabel} ${r.depthNote}`),
      ...[...needs.enough, ...needs.couldUseMore].map((f) => `${f.title} ${f.body}`),
      ...needs.synthesis.lines.map((l) => `${l.passportSays} ${l.closetShows} ${l.reading}`),
    ].join(" ");

    for (const word of ["raw", "blocked", "unread", "usable count", "combination count", "threshold", "distinctLooks", "cluster"]) {
      assert.doesNotMatch(shown.toLowerCase(), new RegExp(`\\b${word}\\b`), `engineering term "${word}" reached the page`);
    }
    // The depth verdict is a conclusion, not a tally.
    for (const r of needs.registers) {
      assert.doesNotMatch(r.depthLabel, /\d/, `depth label should not carry a number: "${r.depthLabel}"`);
    }
  });

  it("11e — every finding carries evidence naming its signal", () => {
    const items = [...variedLooks("casual", 5), makeGarment({ slot: "dress", formality: "evening" })];
    const needs = run(items, { passport: makePassport({ lifestyle: ["everyday-casual", "dinners-going-out"] }) });
    for (const finding of [...needs.enough, ...needs.couldUseMore]) {
      assert.ok(finding.evidence.length > 0, `${finding.id} has no evidence`);
      for (const e of finding.evidence) {
        assert.ok(e.signal && e.field && e.detail, `${finding.id} has a hollow evidence row`);
      }
    }
  });
});
