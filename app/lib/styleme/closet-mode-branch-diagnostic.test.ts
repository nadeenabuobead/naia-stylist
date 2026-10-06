// app/lib/styleme/closet-mode-branch-diagnostic.test.ts
//
// Proves the isNaiaClosetMode diagnostic cannot affect behaviour.
//
// It exists because a WI-origin Active-busy-day session produced descriptive
// Complete-the-Look text and the live trace showed zero [nAia-dressing-gate] candidate
// lines — so isNaiaClosetMode was false, and which of its three conjuncts failed is
// recorded nowhere. This is instrumentation only; the tests below are the guarantee that
// it stays that way.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = "app/lib/ai/styleme-result.server.ts";
const src = (): string => readFileSync(join(process.cwd(), SRC), "utf8");

/** The diagnostic block, from its guard to its closing brace. */
function block(): string {
  const s = src();
  const i = s.indexOf('if (process.env.NAIA_STYLEME_DIAGNOSTICS === "true") {\n    console.log("[nAia-closet-mode-branch]"');
  assert.ok(i > -1, "the diagnostic block must exist");
  return s.slice(i, s.indexOf("\n  }\n", i) + 4);
}

describe("CMB — the branch diagnostic is instrumentation only", () => {
  test("CMB.1 it is behind the existing diagnostics flag", () => {
    assert.match(block(), /^if \(process\.env\.NAIA_STYLEME_DIAGNOSTICS === "true"\) \{/);
  });

  test("CMB.2 it logs the four required fields", () => {
    const b = block();
    for (const f of ["mode", "anchorType", "hasGetClosetItems", "isNaiaClosetMode"]) {
      assert.match(b, new RegExp(`\\b${f}\\b`), `must log ${f}`);
    }
  });

  test("CMB.3 it assigns nothing and mutates nothing", () => {
    const b = block();
    // No assignment, no declaration, no await, no mutation of any collection.
    assert.doesNotMatch(b, /(^|[^=!<>])=[^=]/m, "no assignment inside the diagnostic");
    assert.doesNotMatch(b, /\b(const|let|var)\b/, "no declarations");
    assert.doesNotMatch(b, /\bawait\b/, "nothing asynchronous");
    assert.doesNotMatch(b, /\.(push|set|delete|unset|splice|sort)\(/, "no mutation");
    assert.doesNotMatch(b, /\breturn\b|\bthrow\b/, "no control flow");
  });

  test("CMB.4 it contains exactly one statement, a console.log", () => {
    const b = block();
    const calls = b.match(/\b[A-Za-z_$][\w$.]*\(/g) ?? [];
    // console.log + JSON.stringify are the only calls; getClosetItems is only coerced.
    assert.deepEqual([...new Set(calls)].sort(), ["JSON.stringify(", "console.log("]);
  });

  test("CMB.5 it reports the real isNaiaClosetMode, not a copy of the expression", () => {
    const s = src();
    const constAt = s.indexOf("const isNaiaClosetMode = mode === \"naia\"");
    const diagAt = s.indexOf('[nAia-closet-mode-branch]');
    assert.ok(constAt > -1 && diagAt > constAt,
      "it must sit after the const so it logs the value that decides the branch");
    // The decisive conjunction must appear exactly once in the file.
    assert.equal(
      (s.match(/mode === "naia" && anchor\?\.type === "closet" && !!getClosetItems/g) ?? []).length,
      1,
      "duplicating the condition would let the log drift from the branch",
    );
  });

  test("CMB.6 the branch it reports on is unchanged", () => {
    const s = src();
    assert.match(s, /const isNaiaClosetMode = mode === "naia" && anchor\?\.type === "closet" && !!getClosetItems;/);
    assert.match(s, /if \(isNaiaClosetMode\) \{/, "the branch itself is untouched");
  });
});
