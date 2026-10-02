// app/lib/styleme/same-combination-render.test.ts
//
// A correct no-alternative reroll rendered "Something went wrong".
//
// LIVE EVIDENCE (manual dress, special-event + Dressy, 14:11 UTC):
//
//   prevCoreSig      cmtqxaevb000ml904ie8n1ye4   (Burgundy Cowl Neck Evening Gown)
//   usedCoreComparison true
//   candidates       A, B, C, D — all coreDiffers: false
//   survivingCount   0
//   sameCombination  true
//   _callNaiaSelection not invoked, no OutfitSuggestion persisted, no server exception
//
// The server was exactly right. The action returns data({ sameCombination: true }) with no
// `suggestion`, and the component did:
//
//   const suggestion = generateFetcher.data?.suggestion || loaderData.suggestion;
//   if (error || !suggestion) { …"Something went wrong"… }
//
// Reached through the generation flow, loaderData.suggestion is null, so a valid settled
// response left `suggestion` falsy and the error screen rendered before the intended
// message at the bottom of the page could ever be reached.
//
// The fix adds a terminal state BEFORE that guard. The guard's own condition is unchanged,
// so genuine failures still render the error. There is no component-render harness in this
// repo, so these are source-contract tests plus a truth table over the real guard
// conditions — the same approach used by §M and §N in styleme-rev3-ux.test.ts.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = () => readFileSync(join(process.cwd(), "app/routes/style-me/result.tsx"), "utf8");

/**
 * The component's render precedence, with the ORDER READ FROM THE SOURCE rather than
 * assumed. Modelling the intended order would make these tests pass even if the guard were
 * deleted — they would assert my description of the component, not the component. Deriving
 * the order means SC-A.1 and SC-A.2 fail if the no-alternative return is removed or moved
 * back below the error guard, which is the regression they exist to catch.
 */
type Screen = "loading" | "no-alternative" | "error" | "suggestion";

const SOURCE = src();
const SAME_AT = SOURCE.indexOf("if (generateFetcher.data?.sameCombination && !suggestion)");
const ERROR_AT = SOURCE.indexOf("if (error || !suggestion) {");
/** True only when the component really does check the terminal state first. */
const NO_ALT_GUARD_RUNS_FIRST = SAME_AT > 0 && ERROR_AT > 0 && SAME_AT < ERROR_AT;

function screenFor(o: {
  isLoading?: boolean;
  fetcher?: { suggestion?: unknown; error?: string; sameCombination?: boolean };
  loaderSuggestion?: unknown;
  loaderError?: string;
}): Screen {
  const suggestion = o.fetcher?.suggestion || o.loaderSuggestion;
  const error = o.fetcher?.error || o.loaderError;
  if (o.isLoading) return "loading";
  if (NO_ALT_GUARD_RUNS_FIRST && o.fetcher?.sameCombination && !suggestion) return "no-alternative";
  if (error || !suggestion) return "error";
  return "suggestion";
}

// ── SC-A: the five required behaviours ──────────────────────────────────────

describe("SC-A — render precedence", () => {
  test("SC-A.1 sameCombination + no suggestion does NOT render the generic error", () => {
    const s = screenFor({ fetcher: { sameCombination: true }, loaderSuggestion: null });
    assert.notEqual(s, "error");
  });

  test("SC-A.2 …it renders the no-alternative state", () => {
    assert.equal(screenFor({ fetcher: { sameCombination: true }, loaderSuggestion: null }), "no-alternative");
  });

  test("SC-A.3 neither sameCombination nor suggestion still renders the error", () => {
    assert.equal(screenFor({ fetcher: {}, loaderSuggestion: null }), "error");
    assert.equal(screenFor({ fetcher: { error: "boom" }, loaderSuggestion: null }), "error");
  });

  test("SC-A.4 a normal successful reroll still renders the suggestion", () => {
    assert.equal(screenFor({ fetcher: { suggestion: { id: "new" } }, loaderSuggestion: null }), "suggestion");
  });

  test("SC-A.5 loading still wins over everything", () => {
    assert.equal(screenFor({ isLoading: true, fetcher: { sameCombination: true } }), "loading");
    assert.equal(screenFor({ isLoading: true, fetcher: {} }), "loading");
  });
});

// ── SC-B: the case that must keep working — a look already on screen ────────

describe("SC-B — sameCombination with a previous look visible", () => {
  test("SC-B.1 the existing look is kept, not replaced by the terminal screen", () => {
    // loaderData.suggestion is present on a page that already rendered a look, so the
    // inline message beside the New Look button handles it. The `!suggestion` scoping is
    // what preserves this.
    const s = screenFor({ fetcher: { sameCombination: true }, loaderSuggestion: { id: "previous" } });
    assert.equal(s, "suggestion");
  });

  test("SC-B.2 a real error still beats a visible previous look", () => {
    assert.equal(screenFor({ fetcher: { error: "boom" }, loaderSuggestion: { id: "previous" } }), "error");
  });
});

// ── SC-C: source contract — order and copy ──────────────────────────────────

describe("SC-C — the component itself", () => {
  test("SC-C.1 the no-alternative return precedes the error guard", () => {
    const s = src();
    const same = s.indexOf("if (generateFetcher.data?.sameCombination && !suggestion)");
    const err = s.indexOf("if (error || !suggestion) {");
    assert.ok(same > 0 && err > 0, "both guards must exist");
    assert.ok(same < err, "order is the fix — the error guard must not run first");
  });

  test("SC-C.2 the error guard's condition is unchanged", () => {
    assert.ok(/if \(error \|\| !suggestion\) \{/.test(src()),
      "genuine failures must still reach the generic error");
  });

  test("SC-C.3 it renders the intended copy", () => {
    const s = src();
    const i = s.indexOf("if (generateFetcher.data?.sameCombination && !suggestion)");
    const block = s.slice(i, i + 1400);
    assert.ok(/couldn&rsquo;t find a different combination with your available pieces/.test(block));
  });

  test("SC-C.4 it fabricates no suggestion and triggers no request", () => {
    const s = src();
    const i = s.indexOf("if (generateFetcher.data?.sameCombination && !suggestion)");
    const block = s.slice(i, s.indexOf("// ── Error state", i));
    assert.ok(!/generateFetcher\.submit/.test(block), "must not re-submit");
    assert.ok(!/suggestion\s*=/.test(block), "must not synthesise a suggestion");
  });

  test("SC-C.5 the inline message beside the New Look button is retained", () => {
    const s = src();
    assert.ok(/generateFetcher\.data\?\.sameCombination && \(/.test(s),
      "the in-page path for a visible previous look must still exist");
  });
});
