// app/lib/styleme/nadine-fallback-note.test.ts
//
// She chose "NADINE + MY CLOSET", no live NADINE product qualified, and the page said
// nothing — so a deliberate styling decision was indistinguishable from having chosen
// "MY CLOSET". The engine was right; the result page was silent.
//
// THE SIGNAL. Traced to persisted facts, not rendered copy or card contents:
//
//   mode === "nadine"            she asked for NADINE merchandise. Set by the source
//                                screen only for (NADINE entry + source "both"), and by
//                                the PDP handoff. Absent on legacy suggestions, which is
//                                why absence must never qualify.
//   anchor.type !== "nadine"     excludes the PDP explicit-anchor flow, where the tapped
//                                product IS the anchor. mode alone cannot do this —
//                                api.styleme-handoff.tsx also sets mode "nadine".
//   outcome === "closet-led"     the engine's own verdict when no catalogue candidate
//     and primaryHandle === null cleared the threshold while a closet anchor existed
//                                (styleme-recommendation.ts: aboveThreshold.length === 0).
//                                Both are asserted because they are two independent
//                                records of the same fact.
//
// WHAT THIS IS NOT. Not an error state, and not a change to eligibility: no selector,
// ranking or gating behaviour moves. The look is unchanged — only the page now says why
// it is closet-only.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { shouldExplainNoNadineHero, NO_NADINE_HERO_NOTE } from "./nadine-fallback-note.js";

type Meta = Parameters<typeof shouldExplainNoNadineHero>[0];
const meta = (o: Partial<NonNullable<Meta>>): Meta =>
  ({ mode: undefined, outcome: "closet-led", anchor: null, primaryHandle: null, ...o } as Meta);

const CLOSET_ANCHOR = { type: "closet" as const, id: "closet-1" };
const NADINE_ANCHOR = { type: "nadine" as const, handle: "double-top" };

// ── ZNH-A: the genuine fallback explains itself ───────────────────────────

describe("ZNH-A — NADINE + My Closet with zero eligible hero", () => {
  test("ZNH-A.1 the note applies", () => {
    assert.equal(shouldExplainNoNadineHero(meta({
      mode: "nadine", outcome: "closet-led", anchor: CLOSET_ANCHOR, primaryHandle: null,
    })), true);
  });

  test("ZNH-A.2 it applies with an auto-selected closet anchor too", () => {
    assert.equal(shouldExplainNoNadineHero(meta({
      mode: "nadine", outcome: "closet-led", anchor: { type: "closet", id: "auto-9" }, primaryHandle: null,
    })), true);
  });
});

// ── ZNH-B: every case it must stay silent for ────────────────────────────

describe("ZNH-B — it never appears anywhere else", () => {
  test("ZNH-B.1 a NADINE hero is present", () => {
    assert.equal(shouldExplainNoNadineHero(meta({
      mode: "nadine", outcome: "nadine-recommendation", anchor: CLOSET_ANCHOR, primaryHandle: "oversized-blazer",
    })), false, "there is a NADINE piece in the look — nothing to explain");
  });

  test("ZNH-B.2 ordinary nAia / My Closet", () => {
    assert.equal(shouldExplainNoNadineHero(meta({
      mode: "naia", outcome: "closet-led", anchor: CLOSET_ANCHOR, primaryHandle: null,
    })), false, "she never asked for NADINE merchandise");
  });

  test("ZNH-B.3 the PDP explicit-anchor flow", () => {
    // api.styleme-handoff.tsx sets mode "nadine" too, so the anchor is the discriminator.
    assert.equal(shouldExplainNoNadineHero(meta({
      mode: "nadine", outcome: "nadine-recommendation", anchor: NADINE_ANCHOR, primaryHandle: "double-top",
    })), false);
  });

  test("ZNH-B.4 a PDP anchor that produced no further hero", () => {
    assert.equal(shouldExplainNoNadineHero(meta({
      mode: "nadine", outcome: "closet-led", anchor: NADINE_ANCHOR, primaryHandle: null,
    })), false, "she is being styled around a NADINE piece she chose — not a fallback");
  });

  test("ZNH-B.5 a legacy suggestion with no recorded mode", () => {
    assert.equal(shouldExplainNoNadineHero(meta({
      mode: undefined, outcome: "closet-led", anchor: CLOSET_ANCHOR, primaryHandle: null,
    })), false, "absence of mode is not consent — history must not sprout a new note");
  });

  test("ZNH-B.6 an all-owned look where she did not choose 'both'", () => {
    // The guard is the recorded choice, never the contents of the look.
    assert.equal(shouldExplainNoNadineHero(meta({
      mode: "naia", outcome: "closet-led", anchor: CLOSET_ANCHOR, primaryHandle: null,
    })), false);
  });

  test("ZNH-B.7 no-eligible-product is a different situation", () => {
    assert.equal(shouldExplainNoNadineHero(meta({
      mode: "nadine", outcome: "no-eligible-product", anchor: null, primaryHandle: null,
    })), false, "nothing anchored the look at all — that is not 'kept to your own pieces'");
  });

  test("ZNH-B.8 missing or malformed metadata never explains", () => {
    assert.equal(shouldExplainNoNadineHero(null), false);
    assert.equal(shouldExplainNoNadineHero(undefined), false);
    assert.equal(shouldExplainNoNadineHero(meta({ mode: "NADINE" as never })), false, "mode is lowercase");
  });
});

// ── ZNH-C: the copy is pinned ────────────────────────────────────────────

describe("ZNH-C — the explanation cannot silently drift or vanish", () => {
  test("ZNH-C.1 the exact approved sentences", () => {
    assert.equal(
      NO_NADINE_HERO_NOTE,
      "No NADINE piece was the right fit for this look today. " +
      "I kept this one to pieces you already own rather than forcing something " +
      "that didn't fit your occasion or preferences.",
    );
  });

  test("ZNH-C.2 it reads as a decision, not a failure", () => {
    for (const word of [/rather than forcing/i, /pieces you already own/i]) {
      assert.match(NO_NADINE_HERO_NOTE, word);
    }
    for (const word of [/error/i, /sorry/i, /unable/i, /failed/i, /couldn't find/i]) {
      assert.doesNotMatch(NO_NADINE_HERO_NOTE, word, "this is not an error state");
    }
  });

  test("ZNH-C.3 the result page renders it through the guard, not inline logic", () => {
    const src = readFileSync(join(process.cwd(), "app/routes/style-me/result.tsx"), "utf8");
    assert.match(src, /shouldExplainNoNadineHero\(/, "the decision must be derived");
    assert.match(src, /NO_NADINE_HERO_NOTE/, "the copy must come from the pinned constant");
    assert.equal(
      (src.match(/No NADINE piece was the right fit/g) ?? []).length, 0,
      "a literal here is how pinned copy drifts",
    );
  });
});

// ── ZNH-D: nothing about selection moved ─────────────────────────────────

describe("ZNH-D — no selector, ranking or gating change", () => {
  test("ZNH-D.1 the hero threshold rule is untouched", () => {
    const src = readFileSync(join(process.cwd(), "app/lib/ai/styleme-recommendation.ts"), "utf8");
    assert.match(src, /outcome = \(session\.source === "my-closet" \|\| hasClosetAnchor\)\s*\n\s*\? "closet-led"\s*\n\s*: "no-eligible-product";/);
    assert.match(src, /const aboveThreshold = candidates\.filter\(meetsMinimumThreshold\);/);
  });

  test("ZNH-D.2 the note module reads metadata only — it cannot influence selection", () => {
    const src = readFileSync(join(process.cwd(), "app/lib/styleme/nadine-fallback-note.ts"), "utf8");
    assert.doesNotMatch(src, /import .*styleme-recommendation(?!\.types)/,
      "no dependency on the selector");
    assert.doesNotMatch(src, /prisma|\.server/, "no data access");
  });
});
