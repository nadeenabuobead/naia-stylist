// app/routes/trends.my-edits.featured-card-size-regression.test.ts
//
// Five-Persona QA gap closure: the "oversized featured card" fix (a3861ec,
// then a cascade-order correction in b6a08d2) had zero automated coverage —
// its only verification was a one-time manual measurement recorded in the
// commit message (~176-181px at desktop/mobile). trends.my-edits.test.tsx's
// existing "current-month-featured / previous-editions split" describe block
// covers WHICH card is featured and its content; it never asserts anything
// about SIZE. This file covers that gap specifically, so a future CSS change
// can't silently reintroduce the regression with nothing to catch it.
//
// Source-text assertions only, same convention as this codebase's other
// CSS-correctness tests (e.g. closet mobile-overflow investigation) — no
// DOM, no real browser. A genuine computed-height assertion needs a real
// browser/viewport and is out of scope for this file; it asserts the exact
// mechanism the fix commits describe, so a regression in any of these specific
// properties is caught even without rendering.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "trends.my-edits.tsx"), "utf8");

const cardRuleStart = src.indexOf(".tme-card {");
const featuredRuleStart = src.indexOf(".tme-featured {");
const featuredNumRuleStart = src.indexOf(".tme-featured .tme-card-num {");
// ".tme-featured .tme-card-num {" contains ".tme-card-num {" as a literal
// substring, so a naive indexOf for the base rule can match INSIDE the
// featured-scoped one if that comes first in source (it does here) — skip
// past that ENTIRE match (not just +1, which still lands inside the same
// line) before searching for the real, unscoped base rule.
const cardNumRuleStart = src.indexOf(".tme-card-num {", featuredNumRuleStart + ".tme-featured .tme-card-num {".length);

describe("Trend Edits featured card — size regression guard", () => {
  it("both the base card rule and the featured override exist", () => {
    assert.ok(cardRuleStart > -1, ".tme-card rule found");
    assert.ok(featuredRuleStart > -1, ".tme-featured rule found");
    assert.ok(cardNumRuleStart > -1, "base .tme-card-num rule found, distinct from the featured-scoped override");
    assert.ok(
      !src.slice(Math.max(0, cardNumRuleStart - 14), cardNumRuleStart).includes(".tme-featured"),
      "the resolved base rule is genuinely the unscoped .tme-card-num, not the featured-scoped one matched by accident",
    );
  });

  it("CASCADE ORDER (the exact bug b6a08d2 fixed): .tme-featured is declared AFTER .tme-card in source", () => {
    // Both are single-class selectors with equal specificity — without this
    // ordering, .tme-card's aspect-ratio: 4/5 silently wins the cascade and
    // the featured override does nothing, regardless of what it contains.
    assert.ok(
      featuredRuleStart > cardRuleStart,
      ".tme-featured must come after .tme-card in the stylesheet source, or its own rules are silently overridden",
    );
  });

  it("REGRESSION GUARD: .tme-featured never reintroduces a forced min-height", () => {
    const featuredBlock = src.slice(featuredRuleStart, src.indexOf("}", featuredRuleStart));
    assert.ok(
      !/min-height/i.test(featuredBlock),
      "a forced min-height on .tme-featured was the original defect (the first compact pass still read as oversized because of it) — it must size to content instead",
    );
  });

  it("the featured card sizes to its content, not a fixed aspect-ratio — overrides .tme-card's aspect-ratio: 4/5 with 'auto'", () => {
    const featuredBlock = src.slice(featuredRuleStart, src.indexOf("}", featuredRuleStart));
    assert.ok(/aspect-ratio:\s*auto/.test(featuredBlock), ".tme-featured sets aspect-ratio: auto");
    assert.ok(/aspect-ratio:\s*4\s*\/\s*5/.test(src.slice(cardRuleStart, cardRuleStart + 400)), "sanity check: the base .tme-card still has the fixed 4/5 ratio this override exists to defeat");
  });

  it("REGRESSION GUARD: the decorative background numeral is shrunk specifically on the featured card, not left at the oversized base size", () => {
    assert.ok(featuredNumRuleStart > -1, ".tme-featured .tme-card-num override exists");
    const baseNumBlock = src.slice(cardNumRuleStart, src.indexOf("}", cardNumRuleStart));
    const featuredNumBlock = src.slice(featuredNumRuleStart, src.indexOf("}", featuredNumRuleStart));

    const baseMax = baseNumBlock.match(/font-size:\s*clamp\([^,]+,[^,]+,\s*([\d.]+)rem\)/);
    const featuredMax = featuredNumBlock.match(/font-size:\s*clamp\([^,]+,[^,]+,\s*([\d.]+)rem\)/);
    assert.ok(baseMax && featuredMax, "both numeral font-size clamps are parseable");

    const baseMaxRem = parseFloat(baseMax[1]);
    const featuredMaxRem = parseFloat(featuredMax[1]);
    assert.ok(
      featuredMaxRem < baseMaxRem,
      `featured numeral (max ${featuredMaxRem}rem) must stay smaller than the base card's numeral (max ${baseMaxRem}rem) — ` +
      `an oversized numeral pushing the CTA below the fold was part of the original defect`,
    );
    // Guards against the specific regression, not just "smaller than base":
    // the fix commit's own content describes the featured numeral as reading
    // "as a texture, not a headline" — anything at or above half the base
    // size would no longer satisfy that intent.
    assert.ok(featuredMaxRem <= baseMaxRem / 2, "featured numeral should be meaningfully de-emphasized, not just marginally smaller");
  });

  it("the featured variant keeps tighter vertical spacing than a generic card (compact padding/margins, not the roomier defaults)", () => {
    const featuredBlock = src.slice(featuredRuleStart, src.indexOf("}", featuredRuleStart));
    assert.ok(/padding:\s*22px/.test(featuredBlock), "featured card keeps its compact padding");
    assert.ok(/font-size:\s*0\.92rem/.test(src.slice(featuredRuleStart, featuredRuleStart + 600)), "subtitle/locked copy stays compact, not full-size");
  });
});
