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
  classifyUsability,
  describeLooks,
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
    // 8 everyday looks, all neutral, plus a stated everyday life.
    const items = makeLook("casual", 8);
    const needs = run(items, { passport: makePassport({ lifestyle: ["everyday-casual"] }) });

    const everyday = registerOf(needs, "everyday");
    assert.ok(everyday.usableLooks >= 6, `expected deep everyday coverage, got ${everyday.usableLooks}`);
    assert.ok(!moreIds(needs).includes("everyday"), "a well-covered everyday register must never be a gap");
    assert.ok(needs.enough.length > 0, "deep neutral everyday depth should register as enough");
    assert.match(enoughText(needs), /unlikely to materially expand what you can wear/);
  });

  it("1b — the enough claim names the cluster, not the whole wardrobe", () => {
    const needs = run(makeLook("casual", 8), { passport: makePassport({ lifestyle: ["everyday-casual"] }) });
    // "enough tops" is never a true statement on its own; the claim must be scoped.
    for (const finding of needs.enough) {
      assert.match(finding.title, /everyday|work|occasion/, `unscoped enough claim: ${finding.title}`);
    }
  });
});

// ── §WN-2 A gap that matters ──────────────────────────────────────────────────

describe("§WN-2 gaps relative to the life she described", () => {
  it("2 — thin occasion depth plus a stated dinners life is a real opportunity", () => {
    const items = [
      ...makeLook("casual", 9),                                   // 9 everyday looks
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
      [...makeLook("casual", 9), makeGarment({ slot: "dress", category: "DRESSES", formality: "evening" })],
      { passport: makePassport({ lifestyle: ["dinners-going-out"] }) },
    );
    const finding = needs.couldUseMore.find((f) => f.register === "occasion")!;
    assert.match(finding.body, /complete look/);
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
    assert.match(finding!.body, /not quantity|isn't more/i);
    assert.match(finding!.title, /not quantity/i);
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
      assert.match(finding.body, /hasn't read yet/, "an unread wardrobe must say so");
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
      ...makeLook("casual", 4),
      ...makeLook("evening", 3, { hemLength: "maxi" }),
    ];
    const needs = run(items, {
      passport: makePassport({ lifestyle: ["dinners-going-out", "everyday-casual"] }),
    });

    const r = registerOf(needs, "occasion");
    assert.ok(r.usableLooks > 2, `3 working looks should clear the thin threshold, got ${r.usableLooks}`);
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
    const items = [...makeLook("casual", 5), ...makeLook("evening", 4, { hemLength: "maxi" })];
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
    const items = [...makeLook("casual", 8), makeGarment({ slot: "dress", formality: "evening" })];
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

  it("11d-2 — look counts stop being numbers once the number stops being useful", () => {
    // The arithmetic is real, but 13 tops x 13 bottoms = 169 is not information.
    assert.equal(describeLooks(0), "no complete look");
    assert.equal(describeLooks(1), "one complete look");
    assert.equal(describeLooks(5), "5 complete looks");
    assert.equal(describeLooks(12), "12 complete looks");
    assert.equal(describeLooks(169), "more ways to dress than nAia needs to count");

    // And nothing on the page prints the raw figure past the cap.
    const needs = run(makeLook("casual", 13), { passport: makePassport({ lifestyle: ["everyday-casual"] }) });
    const everyday = registerOf(needs, "everyday");
    assert.ok(everyday.usableLooks > 100, "the fixture really is combinatorially large");
    assert.doesNotMatch(enoughText(needs), /\b169\b/, "a raw combination count must never reach the customer");
  });

  it("11e — every finding carries evidence naming its signal", () => {
    const items = [...makeLook("casual", 9), makeGarment({ slot: "dress", formality: "evening" })];
    const needs = run(items, { passport: makePassport({ lifestyle: ["everyday-casual", "dinners-going-out"] }) });
    for (const finding of [...needs.enough, ...needs.couldUseMore]) {
      assert.ok(finding.evidence.length > 0, `${finding.id} has no evidence`);
      for (const e of finding.evidence) {
        assert.ok(e.signal && e.field && e.detail, `${finding.id} has a hollow evidence row`);
      }
    }
  });
});
