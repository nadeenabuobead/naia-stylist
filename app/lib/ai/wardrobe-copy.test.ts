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
  groupEnough,
  headlineTopic,
  matchDimension,
  lifestyleMatch,
  visibleObservations,
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

    assert.match(out, /tagged both of these for weekend\./);
    assert.match(out, /The structured piece balances the softer one, so the outfit still feels put together\./);
    // The bug this test exists for: the occasion clause swallowing the second
    // reason and inventing "…deliberate, so they're meant for the same day".
    assert.doesNotMatch(out, /read deliberate, so they're meant/);
  });

  it("2d — the wording matches the number of garments actually shown", () => {
    const engine = "You've tagged these for weekend.";
    assert.match(plainPairReason(engine, 2), /both of these/);
    assert.match(plainPairReason(engine, 3), /all three of these/);
    assert.match(plainPairReason(engine, 4), /these pieces/);
    // The copy must never contradict the images beside it.
    assert.doesNotMatch(plainPairReason(engine, 3), /\bboth\b/);
    assert.doesNotMatch(plainPairReason(engine, 4), /\bboth\b|\ball three\b/);
  });

  it("2e — nAia's own selection is never written as the customer's failure", () => {
    const out = plainText("This hasn't appeared in one of your nAia looks yet, though it works with 12 pieces you already own.");
    assert.match(out, /^nAia hasn't used this piece in a generated look yet/);
    assert.doesNotMatch(out, /This hasn't appeared/);
  });

  it("2e-2 — EVERY blame-attribution string the engine can emit is rewritten", () => {
    // These are the exact strings in wardrobe-intelligence.ts. Each frames a
    // nAia SELECTION decision as though the customer had neglected the garment.
    // Note the curly apostrophe in the first: patterns written with the ASCII
    // one silently failed against it, which is how this reached the live page.
    const engineStrings = [
      "Beige Tailored Blazer matches what you told nAia you want and works with 12 pieces you own \u2014 but it hasn\u2019t appeared in one of your nAia looks yet.",
      "This hasn't appeared in one of your nAia looks yet, though it works with 12 pieces you already own.",
      "Another that hasn't reached one of your nAia looks \u2014 12 pieces you own work with it.",
      "Also absent from your nAia looks so far, despite 12 that work with it.",
      "It hasn't appeared in a generated or saved look yet.",
      "4 pieces connect well with your wardrobe but haven't appeared in a saved or generated look yet.",
      "Opportunities appear once nAia can see enough of your wardrobe to tell a real gap from a piece you simply haven't styled yet.",
    ];

    for (const engine of engineStrings) {
      const out = plainText(engine);
      assert.notEqual(out, engine, `not rewritten: "${engine}"`);
      // The sentence must now be about what nAia did.
      assert.match(out, /nAia/, `no nAia attribution in "${out}"`);
      // And must no longer read as the customer's omission.
      for (const blame of [
        /\byou simply haven['\u2019]t styled\b/,
        /\bThis hasn['\u2019]t appeared in one of your nAia looks\b/,
        /\bbut it hasn['\u2019]t appeared in one of your nAia looks\b/,
        /\bbut haven['\u2019]t appeared in a saved or generated look\b/,
      ]) {
        assert.doesNotMatch(out, blame, `blame phrasing survived in "${out}"`);
      }
    }
  });

  it("2e-3 — a rewrite works regardless of which apostrophe character was typed", () => {
    const ascii = "This hasn't appeared in one of your nAia looks yet, though it works with 3 pieces you already own.";
    const curly = ascii.replace(/'/g, "\u2019");
    assert.notEqual(plainText(ascii), ascii);
    assert.notEqual(plainText(curly), curly, "the curly variant must be rewritten too");
  });

  it("2f — nAia never describes wear behaviour it does not track", () => {
    // The transparency footer states nAia does not know what she actually
    // wears. Any sentence that describes HOW or HOW OFTEN she wears a piece
    // contradicts that, whatever the underlying evidence was.
    const engine = "That usually means you\u2019re wearing it the same way each time \u2014 not that it\u2019s the wrong piece.";
    const out = plainText(engine);
    assert.notEqual(out, engine);
    assert.match(out, /Fewer partners means fewer different outfits/);
    assert.doesNotMatch(out, /wearing it/);
  });

  it("2g — no inferred-wear phrasing survives the plain-language pass", () => {
    const inferred = [
      "That usually means you\u2019re wearing it the same way each time.",
      "That usually means you're wearing it the same way each time.",
    ];
    for (const s of inferred) {
      const out = plainText(s);
      for (const pattern of [/you['\u2019]re wearing it/, /you wear it/, /how often you wear/]) {
        assert.doesNotMatch(out, pattern, `inferred wear survived: "${out}"`);
      }
    }
  });

  it("2h — the intention claim describes CAPABILITY, never preference", () => {
    // The underlying evidence counts garments rated "strong" for an intention.
    // That is what her Closet CAN do. Audited against her real sessions,
    // feel-put-together is her strongest Closet capability (22 pieces) and only
    // her 6th most-selected intention (12 of 156) — she asks to feel like
    // herself 69 times. The sentence must not claim her wardrobe was built for
    // a feeling she did not mostly ask for.
    assert.equal(plainText("Your strongest pieces pull the same way"), "What your Closet is strongest at");

    const claim = plainText("Your wardrobe is built, above all, to help you feel put together.");
    assert.equal(claim, "Your Closet is strongest at helping you feel put together.");
    assert.doesNotMatch(claim, /built, above all/, "capability stated as intent");
    assert.doesNotMatch(claim, /your wardrobe is built/i);

    const out = plainText("22 of your pieces read strongest for that. It\u2019s a clear strength — and it means other moods have fewer pieces behind them.");
    assert.equal(out, "22 pieces strongly support that, while some other kinds of look have fewer options behind them.");
    assert.match(out, /\b22\b/, "the count is evidence and survives verbatim");
    assert.doesNotMatch(out, /read strongest|pull the same way/);
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

// ── §WC-6d One idea, one place ───────────────────────────────────────────────

describe("§WC-6d one garment story, told once", () => {
  const obs = (kind: string, garmentIds: string[]) => ({ kind, garmentIds });

  it("6d-1 — a garment-led observation whose LEAD piece is in Rediscover is dropped", () => {
    // The live case: "Hard to style, but unusually well connected" leads with
    // the Cream Ribbed Knit Tank Top, which Rediscover already shows. The
    // remaining ids are its partners, not the subject.
    const shown = visibleObservations(
      [obs("contradiction-potential-struggle", ["cream", "p1", "p2", "p3"]), obs("repetition", ["m"])],
      new Set(["cream", "blazer-a", "blazer-b"]),
    );
    assert.deepEqual(shown.map((o) => o.kind), ["repetition"]);
  });

  it("6d-2 — a supporting garment overlapping is NOT enough to drop it", () => {
    // Matching on any garment would delete a six-piece observation because one
    // thumbnail happened to appear in Rediscover. Only the subject counts.
    const shown = visibleObservations(
      [obs("contradiction-potential-struggle", ["lead", "cream", "p2"])],
      new Set(["cream"]),
    );
    assert.equal(shown.length, 1, "the story is about `lead`, which Rediscover does not show");
  });

  it("6d-3 — untapped-potential follows the same lead rule", () => {
    assert.equal(visibleObservations([obs("untapped-potential", ["a", "x"])], new Set(["a"])).length, 0);
    assert.equal(visibleObservations([obs("untapped-potential", ["x", "a"])], new Set(["a"])).length, 1);
  });

  it("6d-4 — a system-centric observation is dropped outright", () => {
    // "This suits you and works with your Closet, but nAia hasn't generated it
    // yet" is a fact about nAia's own output. There is no advice underneath.
    const shown = visibleObservations([obs("contradiction-alignment-unused", ["z"])], new Set());
    assert.deepEqual(shown, [], "no Rediscover overlap needed — it goes regardless");
  });

  it("6d-5 — wardrobe-pattern observations are never touched", () => {
    const kinds = [
      "repetition", "struggle-pattern", "colour-pattern", "passport-alignment",
      "wardrobe-imbalance", "self-reported-reach", "connection-density",
      "intention-concentration",
    ];
    const shown = visibleObservations(kinds.map((k) => obs(k, ["a"])), new Set(["a"]));
    assert.equal(shown.length, kinds.length, "these are about the wardrobe, not one piece");
  });

  it("6d-7 — the single-intention observation gives way to the capability list", () => {
    const o = [obs("intention-concentration", ["a"])];
    assert.equal(visibleObservations(o, new Set(), { closetStrengthsShown: true }).length, 0,
      "the list already names the top three with counts");
    assert.equal(visibleObservations(o, new Set(), { closetStrengthsShown: false }).length, 1,
      "without the list it is still the only capability signal");
    assert.equal(visibleObservations(o, new Set()).length, 1, "defaults to showing it");
  });

  it("6d-6 — an observation with no garments is never suppressed", () => {
    assert.equal(visibleObservations([obs("untapped-potential", [])], new Set(["a"])).length, 1);
  });
});

// ── §WC-7 Passport match dimensions ───────────────────────────────────────────

describe("§WC-7 Closet-to-Passport match", () => {
  it("7-uneven — alignment without representation is never reported as a strong match", () => {
    const m = matchDimension({ id: "synth-colour", kind: "uneven", reading: "Part of it is barely there." });
    assert.equal(m.dimension, "Colour");
    assert.equal(m.stateText, "Strong alignment, uneven representation");
    assert.notEqual(m.stateText, "Strong match");
  });

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

// The colour reading sat directly above COVERAGE — PARTIAL MATCH, where
// "coverage" means how much of the body she wants covered. Two meanings, one
// word, one line apart.
describe("§WC-8 colour language", () => {
  it("§WC-8a the palette reading never borrows the word \"coverage\"", () => {
    for (const kind of ["alignment", "uneven", "tension", "unclear"] as const) {
      const m = matchDimension({ id: "synth-colour", kind, reading: "x" });
      assert.doesNotMatch(m.stateText, /coverage/i);
    }
  });
});
