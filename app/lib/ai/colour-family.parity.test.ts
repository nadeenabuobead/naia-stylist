// app/lib/ai/colour-family.parity.test.ts
//
// Exhaustive parity proof: resolveCanonicalColourFamilies must reproduce
// the real, live garment-intelligence-v1.server.ts semantics for EVERY
// currently enumerated token in NEUTRAL_COLORS, COLOUR_FAMILY_MAP, and
// PASSPORT_COLOUR_FAMILY_MAP — not a sample. The real source text is
// extracted and evaluated mechanically (the same technique the B2 recon
// used to prove its diagnostic copy was byte-identical), so this test
// fails loudly if either file drifts from the other, rather than trusting
// the hand-maintained mirror in colour-family.ts to stay honest on its own.

import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolveCanonicalColourFamilies,
  _MIRRORED_SOURCE_FOR_PARITY_TEST_ONLY as mirrored,
} from "./colour-family";

const SRC_PATH = new URL("../admin/garment-intelligence-v1.server.ts", import.meta.url);
const src = readFileSync(SRC_PATH, "utf8");

function extractBraced(constName: string): string {
  const startIdx = src.indexOf(`const ${constName}`);
  if (startIdx === -1) throw new Error(`const ${constName} not found in garment-intelligence-v1.server.ts — has it moved or been renamed?`);
  const eqIdx = src.indexOf("=", startIdx);
  let i = eqIdx + 1;
  while (/\s/.test(src[i])) i++;
  const openChar = src[i];
  const closeChar = openChar === "{" ? "}" : openChar === "[" ? "]" : null;
  if (!closeChar) throw new Error(`Unexpected initializer for ${constName}`);
  let depth = 0, j = i;
  for (; j < src.length; j++) {
    if (src[j] === openChar) depth++;
    else if (src[j] === closeChar) { depth--; if (depth === 0) { j++; break; } }
  }
  return src.slice(i, j);
}

function extractNewSetCall(constName: string): string {
  const startIdx = src.indexOf(`const ${constName}`);
  const newSetIdx = src.indexOf("new Set(", startIdx);
  const openParen = src.indexOf("(", newSetIdx);
  let depth = 0, k = openParen;
  for (; k < src.length; k++) {
    if (src[k] === "(") depth++;
    else if (src[k] === ")") { depth--; if (depth === 0) { k++; break; } }
  }
  return src.slice(openParen, k);
}

// eslint-disable-next-line no-new-func
const evalLiteral = (text: string) => new Function(`return (${text});`)();

const sourceNeutralColors: Set<string> = evalLiteral(`new Set${extractNewSetCall("NEUTRAL_COLORS")}`);
const sourceColourFamilyMap: Record<string, string> = evalLiteral(extractBraced("COLOUR_FAMILY_MAP"));
const sourcePassportColourFamilyMap: Record<string, string> = evalLiteral(extractBraced("PASSPORT_COLOUR_FAMILY_MAP"));

describe("B2a parity — the mirrored constants are themselves byte/entry-identical to the live source", () => {
  it("NEUTRAL_COLORS: same entries, no more, no fewer", () => {
    assert.deepEqual([...mirrored.NEUTRAL_COLORS].sort(), [...sourceNeutralColors].sort());
  });

  it("COLOUR_FAMILY_MAP: same keys, same values", () => {
    assert.deepEqual(Object.keys(mirrored.COLOUR_FAMILY_MAP).sort(), Object.keys(sourceColourFamilyMap).sort());
    for (const key of Object.keys(sourceColourFamilyMap)) {
      assert.equal((mirrored.COLOUR_FAMILY_MAP as Record<string, string>)[key], sourceColourFamilyMap[key], `COLOUR_FAMILY_MAP["${key}"] drifted`);
    }
  });

  it("PASSPORT_COLOUR_FAMILY_MAP: same keys, same values", () => {
    assert.deepEqual(Object.keys(mirrored.PASSPORT_COLOUR_FAMILY_MAP).sort(), Object.keys(sourcePassportColourFamilyMap).sort());
    for (const key of Object.keys(sourcePassportColourFamilyMap)) {
      assert.equal((mirrored.PASSPORT_COLOUR_FAMILY_MAP as Record<string, string>)[key], sourcePassportColourFamilyMap[key], `PASSPORT_COLOUR_FAMILY_MAP["${key}"] drifted`);
    }
  });
});

describe("B2a parity — resolveCanonicalColourFamilies reproduces GI semantics for EVERY currently enumerated token", () => {
  for (const token of sourceNeutralColors) {
    it(`"${token}" (neutral) resolves isNeutral=true`, () => {
      assert.equal(resolveCanonicalColourFamilies(token).isNeutral, true);
    });
  }

  for (const [token, expectedFamily] of Object.entries(sourceColourFamilyMap)) {
    it(`"${token}" resolves hueFamilies=["${expectedFamily}"]`, () => {
      const r = resolveCanonicalColourFamilies(token);
      assert.deepEqual(r.hueFamilies, [expectedFamily]);
      assert.equal(r.unknown, false);
    });
  }

  for (const [token, expectedFamily] of Object.entries(sourcePassportColourFamilyMap)) {
    it(`"${token}" resolves passportFamilies=["${expectedFamily}"]`, () => {
      const r = resolveCanonicalColourFamilies(token);
      assert.deepEqual(r.passportFamilies, [expectedFamily]);
      assert.equal(r.unknown, false);
    });
  }

  it("every source token count is non-trivial (sanity: this test is actually exercising real data, not an empty extraction)", () => {
    assert.ok(sourceNeutralColors.size >= 20);
    assert.ok(Object.keys(sourceColourFamilyMap).length >= 70);
    assert.ok(Object.keys(sourcePassportColourFamilyMap).length >= 25);
  });
});
