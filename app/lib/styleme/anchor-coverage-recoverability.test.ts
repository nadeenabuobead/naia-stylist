// app/lib/styleme/anchor-coverage-recoverability.test.ts
//
// "No layer can change that" was being said about garments a layer could absolutely change.
//
// Manual QA: a bra chosen as the manual anchor was refused with
//   "This piece doesn't meet the coverage you've set in your Style Passport,
//    and no layer can change that."
// That sentence is false. A bra under an opaque shirt satisfies no-cropped-tops — the
// preference is about midriff exposure in the LOOK (its quiz label is "I avoid cropped
// tops", and Buy/Skip evaluates the same preference via midriffExposed), not about the
// garment existing in the outfit.
//
// Traced cause: evaluateAnchorEligibility delegates to passesDressingRequirements, an
// ITEM-LEVEL pool filter that asks "can this garment, standing as the visible outfit
// component, satisfy the requirement alone?" — not the anchor question. Measured: of the
// five dressing preferences, only no-cropped-tops and legs-covered reject at item level;
// arms-covered, chest-neckline-covered and dresses-modestly already allow the anchor and
// are compensated at candidate level by passesCandidateDressingRequirements.
//
// WHAT THIS CHANGE IS AND IS NOT. The bra is still REJECTED — deliberately. OutfitSlot has
// no underlayer, and candidates hold one piece per slot, so the engine cannot guarantee an
// opaque top over the anchor; allowing it would waive the Passport requirement rather than
// satisfy it. So the requirement stands and only the CLASSIFICATION and the sentence
// change: a conflict the engine merely cannot construct yet must not be reported as a
// structural impossibility. The underlayer architecture is a separate, deferred follow-up.
//
// Two categories, and the distinction is the whole point:
//   unrecoverable           legs-covered on a leg garment — no slot can lengthen a hem,
//                           and there is no under-bottom slot. "No layer" is TRUE here.
//   recoverable-unsupported no-cropped-tops — a non-cropped top over it would resolve it,
//                           but StyleMe cannot build a layered anchor yet.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  evaluateAnchorEligibility,
  passesDressingRequirements,
  classifyAnchorCoverageConflict,
} from "../ai/styleme-profile-gate.js";
import type { ClosetAnchorInput } from "../ai/styleme-recommendation.types.js";

const item = (o: Record<string, unknown>): ClosetAnchorInput =>
  ({ hemLength: null, topLength: null, approvedProfile: null, ...o } as unknown as ClosetAnchorInput);

// A bra: covers no legs (hem n/a), explicitly cropped on the torso.
const BRA = item({ hemLength: "n/a", topLength: "cropped", midriffExposed: true });
const CROPPED_TOP = item({ hemLength: "n/a", topLength: "cropped" });
const MINI_SKIRT = item({ hemLength: "mini", topLength: "n/a" });
const MIDI_SKIRT = item({ hemLength: "midi", topLength: "n/a" });
const MAXI_SKIRT = item({ hemLength: "maxi", topLength: "n/a" });
const SLEEVELESS_TOP = item({ hemLength: "n/a", topLength: "regular", sleeveLength: "sleeveless" });
const PLAIN_TOP = item({ hemLength: "n/a", topLength: "regular" });

const NO_LAYER_CLAIM = /no layer can change that/i;

// ── ACR-A: the bra is refused for the RIGHT reason ────────────────────────

describe("ACR-A — a cropped anchor is refused as unsupported, not impossible", () => {
  test("ACR-A.1 a bra anchor is still rejected under no-cropped-tops", () => {
    // The requirement is NOT waived. This is the deliberate interim behaviour.
    const r = evaluateAnchorEligibility(BRA, "everyday", ["no-cropped-tops"]);
    assert.equal(r.eligible, false, "the Passport requirement must still stand");
  });

  test("ACR-A.2 it carries the layered-anchor code, not the unrecoverable one", () => {
    const r = evaluateAnchorEligibility(BRA, "everyday", ["no-cropped-tops"]);
    assert.equal(r.code, "layered-anchor-unsupported");
  });

  test("ACR-A.3 the message must NOT claim no layer can change it", () => {
    const r = evaluateAnchorEligibility(BRA, "everyday", ["no-cropped-tops"]);
    assert.doesNotMatch(r.message ?? "", NO_LAYER_CLAIM,
      "a layer CAN change this — saying otherwise is a false statement to the customer");
  });

  test("ACR-A.4 the message says what is actually true: a layer is needed, and unsupported", () => {
    const m = evaluateAnchorEligibility(BRA, "everyday", ["no-cropped-tops"]).message ?? "";
    assert.match(m, /layer/i, "it must name the layer the piece would need");
    assert.match(m, /yet/i, "it must say this is a current limitation, not a permanent one");
    assert.match(m, /Choose another piece/i, "it must say what to do next");
  });

  test("ACR-A.5 a plain cropped top is classified the same way as the bra", () => {
    // The rule is about the garment's coverage, not about it being underwear.
    const r = evaluateAnchorEligibility(CROPPED_TOP, "everyday", ["no-cropped-tops"]);
    assert.equal(r.eligible, false);
    assert.equal(r.code, "layered-anchor-unsupported");
  });

  test("ACR-A.6 the classifier reports recoverability directly", () => {
    const c = classifyAnchorCoverageConflict(BRA, ["no-cropped-tops"]);
    assert.equal(c?.requirement, "no-cropped-tops");
    assert.equal(c?.recoverability, "recoverable-unsupported");
  });
});

// ── ACR-B: a genuinely unrecoverable conflict keeps the strong wording ────

describe("ACR-B — legs-covered on a leg garment stays unrecoverable", () => {
  test("ACR-B.1 a mini skirt is still rejected", () => {
    const r = evaluateAnchorEligibility(MINI_SKIRT, "everyday", ["legs-covered"]);
    assert.equal(r.eligible, false);
    assert.equal(r.code, "dressing-requirement");
  });

  test("ACR-B.2 and it DOES say no layer can change that, because that is true", () => {
    const m = evaluateAnchorEligibility(MINI_SKIRT, "everyday", ["legs-covered"]).message ?? "";
    assert.match(m, NO_LAYER_CLAIM, "no slot can lengthen a hem — the strong wording is earned here");
    assert.match(m, /Choose another piece/i);
  });

  test("ACR-B.3 a midi hem is also unrecoverable, not merely unsupported", () => {
    const c = classifyAnchorCoverageConflict(MIDI_SKIRT, ["legs-covered"]);
    assert.equal(c?.recoverability, "unrecoverable");
  });

  test("ACR-B.4 a maxi hem still anchors fine", () => {
    assert.equal(evaluateAnchorEligibility(MAXI_SKIRT, "everyday", ["legs-covered"]).eligible, true);
  });

  test("ACR-B.5 the two categories never share a code", () => {
    const unrec = evaluateAnchorEligibility(MINI_SKIRT, "everyday", ["legs-covered"]).code;
    const unsup = evaluateAnchorEligibility(BRA, "everyday", ["no-cropped-tops"]).code;
    assert.notEqual(unrec, unsup, "the whole point is that these are different situations");
  });
});

// ── ACR-C: requirements that were already recoverable stay that way ───────

describe("ACR-C — already-compensable requirements are untouched", () => {
  // Regression LOCK, not a fix: these already pass today, verified by trace before the
  // change. They are here so the new classifier cannot quietly start rejecting them.
  test("ACR-C.1 a sleeveless top still anchors an arms-covered session", () => {
    assert.equal(evaluateAnchorEligibility(SLEEVELESS_TOP, "everyday", ["arms-covered"]).eligible, true,
      "outerwear with sleeves resolves this at candidate level");
  });

  test("ACR-C.2 a bra anchors fine under arms/neckline/modesty requirements alone", () => {
    for (const pref of ["arms-covered", "chest-neckline-covered", "dresses-modestly"]) {
      assert.equal(evaluateAnchorEligibility(BRA, "everyday", [pref]).eligible, true,
        `${pref} is compensated at candidate level and must not reject the anchor`);
    }
  });

  test("ACR-C.3 no requirements at all never rejects", () => {
    assert.equal(evaluateAnchorEligibility(BRA, "everyday", []).eligible, true);
    assert.equal(evaluateAnchorEligibility(BRA, "everyday", null).eligible, true);
    assert.equal(classifyAnchorCoverageConflict(BRA, []), null);
  });

  test("ACR-C.4 unknown metadata still fails OPEN", () => {
    assert.equal(classifyAnchorCoverageConflict(item({ hemLength: null, topLength: null }), ["legs-covered", "no-cropped-tops"]), null);
    assert.equal(evaluateAnchorEligibility(PLAIN_TOP, "everyday", ["legs-covered", "no-cropped-tops"]).eligible, true);
  });
});

// ── ACR-D: the outfit-level gate and the pool filter are unchanged ────────

describe("ACR-D — nothing downstream of the anchor gate moved", () => {
  test("ACR-D.1 passesDressingRequirements verdicts are byte-identical", () => {
    // The pool filter must keep filtering exactly as before: same inputs, same verdicts.
    const cases: Array<[ClosetAnchorInput, string[], boolean]> = [
      [BRA,            ["no-cropped-tops"], false],
      [CROPPED_TOP,    ["no-cropped-tops"], false],
      [PLAIN_TOP,      ["no-cropped-tops"], true],
      [MINI_SKIRT,     ["legs-covered"],    false],
      [MIDI_SKIRT,     ["legs-covered"],    false],
      [MAXI_SKIRT,     ["legs-covered"],    true],
      [SLEEVELESS_TOP, ["arms-covered"],    true],
      [BRA,            [],                  true],
    ];
    for (const [it, prefs, expected] of cases) {
      assert.equal(passesDressingRequirements(it, prefs), expected);
    }
  });

  test("ACR-D.2 the candidate-level gate is not referenced by the anchor gate", () => {
    const src = readFileSync(join(process.cwd(), "app/lib/ai/styleme-profile-gate.ts"), "utf8");
    const fn = src.slice(src.indexOf("export function evaluateAnchorEligibility"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    assert.doesNotMatch(body, /passesCandidateDressingRequirements/,
      "the anchor gate must not reach into outfit-level evaluation");
  });

  test("ACR-D.3 candidate construction, slots and scoring are untouched", () => {
    const types = readFileSync(join(process.cwd(), "app/lib/ai/styleme-recommendation.types.ts"), "utf8");
    assert.match(types, /export type OutfitSlot =\s*"top" \| "bottom" \| "dress" \| "set" \| "outerwear" \| "shoe" \| "bag" \| "accessory" \| "jewelry" \| "unknown";/,
      "no underlayer slot in this release — that is the deferred follow-up");
  });
});

// ── ACR-E: the anchor she picked is never swapped ─────────────────────────

describe("ACR-E — the manual anchor is never silently substituted", () => {
  const source = (): string =>
    readFileSync(join(process.cwd(), "app/routes/style-me/source.tsx"), "utf8");

  test("ACR-E.1 a refusal returns a 400 and no anchor is set", () => {
    const text = source();
    const setAnchor = text.slice(text.indexOf('intent === "set-anchor"'));
    const upToRefusal = setAnchor.slice(0, setAnchor.indexOf("status: 400") + 20);
    assert.doesNotMatch(upToRefusal, /autoSelectClosetAnchor\(/,
      "a rejected hand-picked anchor must never fall back to auto-selection");
    assert.doesNotMatch(upToRefusal, /session\.set\("styleMeClosetAnchorId"/,
      "nothing is committed when the piece is refused");
  });

  test("ACR-E.2 an accepted anchor is stored as the customer's own choice", () => {
    const text = source();
    // Window widened: the rejection branch now also remembers a rejected pick as pending
    // (styleMePendingClosetAnchorId), pushing this success block further from the start.
    const setAnchor = text.slice(text.indexOf('intent === "set-anchor"')).slice(0, 3200);
    assert.match(setAnchor, /session\.set\("styleMeClosetAnchorId", closetItemId\)/);
    assert.match(setAnchor, /session\.set\("styleMeAnchorProvenance", "MANUAL"\)/);
  });
});
