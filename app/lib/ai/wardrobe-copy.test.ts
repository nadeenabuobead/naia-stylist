// app/lib/ai/wardrobe-copy.test.ts
// Run with: node --test --import tsx/esm app/lib/ai/wardrobe-copy.test.ts
//
// This file guards the PRESENTATION layer. It asserts two things and nothing
// else: that engine conclusions survive translation intact, and that no
// internal vocabulary reaches the customer.
//
// The rewrites are pattern-based, which is the fragile part — a pattern that
// over-matches will happily produce a fluent sentence the engine never
// concluded. §WC-2 exists because exactly that happened: the engine joins its
// two strongest pairing reasons into one string, and an anchored `(.+)` ate
// across the join and merged two separate claims into one false one.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  registerDisplay,
  heroLabel,
  traitLabel,
  plainPairReason,
  plainText,
  styleMeReachText,
  groupEnough,
  headlineTopic,
  matchDimension,
  lifestyleMatch,
  type RegisterDisplay,
} from "./wardrobe-copy.ts";
import type { RegisterReading } from "./wardrobe-needs.ts";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeRegister(overrides: Partial<RegisterReading> = {}): RegisterReading {
  return {
    register: "everyday",
    label: "everyday and casual",
    depthLabel: "Strong everyday depth",
    depthNote: "You already have plenty of usable combinations here.",
    rawCount: 12, usableCount: 12, blockedCount: 0, unknownCount: 0,
    distinctLooks: 9, combinations: 144,
    needed: true, needSource: "lifestyle", needPhrase: "everyday dressing",
    ...overrides,
  };
}

// ── §WC-1 Register states ─────────────────────────────────────────────────────

describe("§WC-1 register depth becomes plain language", () => {
  it("1 — each engine depth state maps to a customer-facing state", () => {
    const cases: Array<[string, string]> = [
      ["Strong everyday depth", "Strong"],
      ["Workable work depth", "Covered, with limited variety"],
      ["Limited usable work depth", "Needs more range"],
      ["Your occasion wardrobe looks bigger than it really is", "Smaller than it looks"],
      ["Nothing here yet", "Nothing here yet"],
      ["Not enough evidence yet", "Still learning"],
    ];
    for (const [depthLabel, expected] of cases) {
      assert.equal(registerDisplay(makeRegister({ depthLabel })).stateText, expected, depthLabel);
    }
  });

  it("1b — no internal term survives into the register block, in ANY state", () => {
    // Every depth state the engine can produce, not just the happy one.
    const labels = [
      "Strong everyday depth",
      "Workable work depth",
      "Limited usable work depth",
      "Your occasion wardrobe looks bigger than it really is",
      "Nothing here yet",
      "Not enough evidence yet",
    ];
    for (const register of ["everyday", "work", "occasion"] as const) {
      for (const depthLabel of labels) {
        const d = registerDisplay(makeRegister({ register, depthLabel }));
        const shown = `${d.heading} ${d.stateText} ${d.plain}`.toLowerCase();
        // "depth" is deliberately absent from this list: "limited depth for
        // polished, work-ready dressing" is approved customer copy, not jargon.
        for (const word of ["raw", "blocked", "unread", "distinct", "combination", "register", "usable looks"]) {
          assert.doesNotMatch(shown, new RegExp(`\\b${word}\\b`), `"${word}" leaked via ${depthLabel}`);
        }
      }
    }
  });

  it("1c-2 — the state word itself never carries a number", () => {
    for (const depthLabel of ["Strong everyday depth", "Workable work depth", "Limited usable work depth"]) {
      assert.doesNotMatch(registerDisplay(makeRegister({ depthLabel })).stateText, /\d/);
    }
  });

  it("1c — headings are the customer's words for her own life", () => {
    assert.equal(registerDisplay(makeRegister({ register: "everyday" })).heading, "Everyday");
    assert.equal(registerDisplay(makeRegister({ register: "work" })).heading, "Work");
    assert.equal(registerDisplay(makeRegister({ register: "occasion" })).heading, "Dinners & events");
  });
});

// ── §WC-2 Pairing explanations ────────────────────────────────────────────────

describe("§WC-2 pairing reasons lose the jargon, not the meaning", () => {
  it("2 — every reason the engine can produce is rewritten without fashion vocabulary", () => {
    const cases: Array<[string, RegExp]> = [
      ["You've tagged these for weekend.", /tagged both of these for weekend/],
      ["One is tailored and the other relaxed — the structure is what makes it read deliberate.",
       /structured piece balances the softer one/],
      ["Both sit in the same purple family.", /Both are purple tones/],
      ["The charcoal anchors the mauve.", /charcoal is the calmer colour and balances the mauve/],
      ["One of them is a wardrobe neutral, so the pairing stays easy.", /goes with almost anything/],
      ["Both are wardrobe neutrals, so nothing competes.", /plain colours that go with almost anything/],
      ["A fitted shape against an oversized one keeps the proportions clear.",
       /fitted piece balances the fuller oversized one/],
      ["One carries more visual weight than the other, which stops the pairing flattening.",
       /heavier-looking than the other/],
      ["They sit at the same level of dress.", /equally dressed up/],
      ["Their levels of dress sit next to each other.", /similar degree/],
    ];
    for (const [engine, expected] of cases) {
      const out = plainPairReason(engine);
      assert.match(out, expected, `"${engine}" → "${out}"`);
      for (const jargon of ["wardrobe neutral", "visual weight", "proportions", "read deliberate", "anchors"]) {
        assert.doesNotMatch(out, new RegExp(jargon), `jargon survived in "${out}"`);
      }
    }
  });

  it("2b — a two-reason string is rewritten as TWO claims, never merged into one", () => {
    // The engine joins its two strongest reasons with a space (toPairing).
    const engine = "You've tagged these for weekend. One is tailored and the other relaxed — the structure is what makes it read deliberate.";
    const out = plainPairReason(engine);

    assert.match(out, /tagged both of these for weekend, so they're meant for the same kind of day\./);
    assert.match(out, /The structured piece balances the softer one, so the outfit still feels put together\./);
    // The bug this test exists for: the occasion clause swallowing the second
    // reason and inventing "…deliberate, so they're meant for the same day".
    assert.doesNotMatch(out, /read deliberate, so they're meant/);
  });

  it("2c — an unrecognised reason passes through rather than being mangled", () => {
    const novel = "Some future reason the engine has not written yet.";
    assert.equal(plainPairReason(novel), novel);
  });
});

// ── §WC-3 Labels ──────────────────────────────────────────────────────────────

describe("§WC-3 labels describe what a thing does", () => {
  it("3 — hero labels say what the piece does for her", () => {
    assert.equal(heroLabel("closet-connector", "Closet connector"), "Works with the most");
    assert.equal(heroLabel("passport-match", "Passport match"), "Matches your style");
    assert.equal(heroLabel("your-favourite", "Your favourite"), "Your favourite");
    assert.equal(heroLabel("most-versatile", "Most versatile"), "Most versatile");
  });

  it("3b — DNA character labels are readable without fashion knowledge", () => {
    const t = (id: string, label: string) => traitLabel({ id, label, evidence: "" });
    assert.equal(t("neutral-led", "Neutral-led"), "Mostly neutral");
    assert.equal(t("register-everyday", "Everyday-led"), "Built mostly for everyday");
    assert.equal(t("weight-substantial", "Substantial visual weight"), "Mostly heavier, weightier pieces");
    assert.equal(t("palette-anchor", "Black-anchored"), "Black is your main base colour");
  });

  it("3c — an unknown trait keeps the engine's own label rather than vanishing", () => {
    assert.equal(traitLabel({ id: "future-trait", label: "Something New", evidence: "" }), "Something New");
  });
});

// ── §WC-4 Free-text plain-language pass ───────────────────────────────────────

describe("§WC-4 engine prose is translated, not paraphrased away", () => {
  it("4 — known jargon is replaced", () => {
    assert.match(plainText("Sits comfortably with 12 other pieces in your Closet."), /^Pairs easily with 12 other/);
    assert.match(plainText("matches your Passport on style personality and colour"),
      /matches the style and colours you described in your Passport/);
    assert.match(plainText("the wardrobe roles you need are already represented"),
      /you already have the main types of pieces your wardrobe needs/);
    assert.match(plainText("Your wardrobe is stronger in one register"), /stronger for one kind of day/);
    assert.doesNotMatch(plainText("24 of the 34 pieces nAia has assessed read everyday and casual."), /\bread\b/);
  });

  it("4b — a raw combination count never reaches the customer", () => {
    const engine = "nAia can build 145 combinations from what you own without you adding anything.";
    const out = plainText(engine);
    assert.doesNotMatch(out, /\b145\b/);
    assert.match(out, /plenty of different ways/);
  });

  it("4c — the pass is idempotent and leaves unknown prose alone", () => {
    const plain = "A sentence with nothing to translate.";
    assert.equal(plainText(plain), plain);
    const once = plainText("Sits comfortably with 3 other pieces in your Closet.");
    assert.equal(plainText(once), once);
  });
});

// ── §WC-5 StyleMe activity ────────────────────────────────────────────────────

describe("§WC-5 activity counts", () => {
  it("5 — a large count becomes frequency; a small one stays exact", () => {
    assert.equal(styleMeReachText(85), "nAia reaches for this piece often when styling you.");
    assert.equal(styleMeReachText(12), "nAia has built 12 of your looks around this piece.");
  });

  it("5b — generated is never described as worn", () => {
    for (const n of [1, 12, 85, 400]) {
      const out = styleMeReachText(n);
      assert.doesNotMatch(out, /\byou wore\b|\byou've worn\b|\bworn\b/i, `wear implied: "${out}"`);
      assert.match(out, /nAia/, "the sentence must stay about what nAia did");
    }
  });
});

// ── §WC-6 Repetition control ──────────────────────────────────────────────────

describe("§WC-6 the same conclusion is not printed twice", () => {
  it("6 — findings that share an explanation are grouped into one entry", () => {
    const grouped = groupEnough([
      { id: "enough-everyday:top:neutral", title: "You already have enough everyday neutral tops", body: "Same body.", garmentIds: ["a"] },
      { id: "enough-everyday:bottom:neutral", title: "You already have enough everyday neutral bottoms", body: "Same body.", garmentIds: ["b"] },
    ]);
    assert.equal(grouped.length, 1, "one finding, not two");
    assert.equal(grouped[0].title, "You already have enough everyday neutral tops and everyday neutral bottoms");
    // Nothing is lost by grouping.
    assert.deepEqual(grouped[0].garmentIds, ["a", "b"]);
  });

  it("6b — genuinely different findings are left alone", () => {
    const grouped = groupEnough([
      { id: "a", title: "You already have enough everyday neutral tops", body: "One body.", garmentIds: [] },
      { id: "b", title: "You already have enough work trousers", body: "A different body.", garmentIds: [] },
    ]);
    assert.equal(grouped.length, 2);
  });

  it("6c — headline subjects group by what they are about, not by id", () => {
    assert.equal(headlineTopic("enough-everyday:top:neutral"), headlineTopic("enough-everyday:bottom:neutral"));
    assert.notEqual(headlineTopic("enough-everyday:top:neutral"), headlineTopic("enough-work:top:neutral"));
    // The two palette readings are one subject.
    assert.equal(headlineTopic("synth-colour"), headlineTopic("synth-neutral"));
    assert.notEqual(headlineTopic("need-work"), headlineTopic("need-occasion-effective"));
  });
});

// ── §WC-7 Passport match dimensions ───────────────────────────────────────────

describe("§WC-7 Closet-to-Passport match", () => {
  it("7 — each synthesis line becomes a named dimension with a state", () => {
    const m = matchDimension({ id: "synth-colour", kind: "alignment", reading: "The colours match." });
    assert.equal(m.dimension, "Colour");
    assert.equal(m.stateText, "Strong match");

    const t = matchDimension({ id: "synth-neutral", kind: "tension", reading: "They differ." });
    assert.equal(t.dimension, "Colour balance");
    assert.equal(t.stateText, "Where there's a gap");
  });

  it("7b — lifestyle coverage is stated only for the parts of life she named", () => {
    const strong = (heading: string): RegisterDisplay =>
      ({ heading, state: "strong", stateText: "Strong", plain: "", needed: true });
    const weak = (heading: string): RegisterDisplay =>
      ({ heading, state: "needs-range", stateText: "Needs more range", plain: "", needed: true });

    assert.equal(lifestyleMatch([]), null, "nothing stated means nothing claimed");
    assert.equal(
      lifestyleMatch([{ ...strong("Everyday"), needed: false }]),
      null,
      "a register she never named is not a lifestyle claim",
    );
    assert.equal(lifestyleMatch([strong("Everyday"), strong("Work")])!.stateText, "Strong match");
    assert.equal(lifestyleMatch([strong("Everyday"), weak("Work")])!.stateText, "Partial match");
    assert.match(lifestyleMatch([strong("Everyday"), weak("Work")])!.reading, /Everyday is well covered/);
  });
});
