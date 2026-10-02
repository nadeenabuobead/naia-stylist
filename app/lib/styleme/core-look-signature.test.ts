// app/lib/styleme/core-look-signature.test.ts
//
// COMMIT A — "New Look, Same Vibe" must differ at the CORE.
//
// computeOutfitSignature covers every piece, so swapping only a bag produced a different
// string and the reroll dedupe let it through — a finishing-only variation presented as a
// New Look. That function is still correct for the internal C/D/E duplicate checks and is
// deliberately left alone.
//
// VERIFIED SLOT VOCABULARY (not inferred from category names). The authoritative union is
//   OutfitSlot = top | bottom | dress | set | outerwear | shoe | bag | accessory | jewelry | unknown
// There is NO jumpsuit slot: "jumpsuit" exists only as a silhouette token in
// closet-intelligence.server.ts. A jumpsuit resolves through DIRECT_SLOT_MAP as
// DRESSES -> dress or SETS -> set, both already core. CORE_LOOK_SLOTS therefore reuses the
// existing BASE_CLOTHING_SLOTS rather than introducing a second vocabulary.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  computeCoreLookSignature,
  computeOutfitSignature,
  CORE_LOOK_SLOTS,
} from "../ai/styleme-result.server.js";

const piece = (slot: string, closetId: string) => ({ slot, closetId });

/** A full separates outfit with every finishing slot occupied. */
const SEPARATES = [
  piece("top", "t1"), piece("bottom", "b1"),
  piece("outerwear", "o1"), piece("shoe", "s1"),
  piece("bag", "g1"), piece("accessory", "a1"), piece("jewelry", "j1"),
];
const DRESS_LED = [piece("dress", "d1"), piece("shoe", "s1"), piece("bag", "g1")];
const SET_LED = [piece("set", "x1"), piece("shoe", "s1"), piece("jewelry", "j1")];

const sig = computeCoreLookSignature;

// ── A: the signature moves for every structural slot ────────────────────────

describe("CL-A — a change in any structural slot changes the signature", () => {
  test("CL-A.1 a different top", () => {
    assert.notEqual(sig(SEPARATES), sig(SEPARATES.map((p) => p.slot === "top" ? piece("top", "t2") : p)));
  });
  test("CL-A.2 a different bottom", () => {
    assert.notEqual(sig(SEPARATES), sig(SEPARATES.map((p) => p.slot === "bottom" ? piece("bottom", "b2") : p)));
  });
  test("CL-A.3 a different dress", () => {
    assert.notEqual(sig(DRESS_LED), sig(DRESS_LED.map((p) => p.slot === "dress" ? piece("dress", "d2") : p)));
  });
  test("CL-A.4 a different set / one-piece", () => {
    assert.notEqual(sig(SET_LED), sig(SET_LED.map((p) => p.slot === "set" ? piece("set", "x2") : p)));
  });
  test("CL-A.5 a change of structural FORMULA — separates to dress-led", () => {
    assert.notEqual(sig(SEPARATES), sig(DRESS_LED));
  });
  test("CL-A.6 dress-led to set-led", () => {
    assert.notEqual(sig(DRESS_LED), sig(SET_LED));
  });
  test("CL-A.7 every core slot in the vocabulary is covered", () => {
    assert.deepEqual([...CORE_LOOK_SLOTS].sort(), ["bottom", "dress", "set", "top"]);
  });
});

// ── B: the signature ignores every finishing slot and outerwear ─────────────

describe("CL-B — finishing slots and outerwear do not move the signature", () => {
  for (const slot of ["bag", "shoe", "jewelry", "accessory", "outerwear"]) {
    test(`CL-B a different ${slot} alone leaves the core identical`, () => {
      const swapped = SEPARATES.map((p) => p.slot === slot ? piece(slot, `${slot}-NEW`) : p);
      assert.equal(sig(SEPARATES), sig(swapped), `${slot} must not change the core`);
      // …while the whole-outfit signature DOES change — which is exactly the old bug.
      assert.notEqual(
        computeOutfitSignature(SEPARATES.map((p) => p.closetId)),
        computeOutfitSignature(swapped.map((p) => p.closetId)),
      );
    });
  }

  test("CL-B.all every finishing slot swapped at once is still the same core", () => {
    const swapped = SEPARATES.map((p) =>
      CORE_LOOK_SLOTS.has(p.slot) ? p : piece(p.slot, `${p.slot}-NEW`));
    assert.equal(sig(SEPARATES), sig(swapped));
  });

  test("CL-B.removed dropping every finishing piece is still the same core", () => {
    assert.equal(sig(SEPARATES), sig(SEPARATES.filter((p) => CORE_LOOK_SLOTS.has(p.slot))));
  });
});

// ── C: determinism and order-independence ───────────────────────────────────

describe("CL-C — deterministic and order-independent", () => {
  test("CL-C.1 piece order does not matter", () => {
    assert.equal(sig(SEPARATES), sig([...SEPARATES].reverse()));
  });
  test("CL-C.2 repeated calls agree", () => {
    assert.equal(sig(SEPARATES), sig(SEPARATES));
  });
  test("CL-C.3 an outfit with no structural piece yields an empty signature", () => {
    assert.equal(sig([piece("bag", "g1"), piece("shoe", "s1")]), "");
  });
  test("CL-C.4 an unknown slot is not treated as core", () => {
    assert.equal(sig([...DRESS_LED, piece("unknown", "u1")]), sig(DRESS_LED));
  });
});
