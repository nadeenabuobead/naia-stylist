// app/routes/style-me/results-page-ux-redesign.test.ts
//
// StyleMe results-page UX improvement (second staging acceptance pass): the page read as
// a long sequence of disconnected, oversized garment images with the primary actions
// buried below a long tail of secondary content (Also Works / Why This Works / the
// sensory grid / Virtual Try-On).
//
// WHAT CHANGED, and nothing else:
//   1. The three garment-card groups (Your Outfit Direction, Complete the Look, Finishing
//      Layer) are each wrapped in a CSS grid container so multiple pieces present as one
//      cohesive look instead of one full-width row per garment.
//   2. .sm-item-img no longer carries a fixed max-width: 200px — it now scales to its grid
//      cell, so sizing is consistent and proportionate rather than oversized.
//   3. .sm-item-card--primary (a class the JSX already applied, but which had NO CSS rule
//      at all before this change) now gets a visible accent, restoring the visual
//      hierarchy the class name always implied.
//   4. The whole Actions block (Save Look / New Look Same Vibe / Adjust Vibe / Start Over)
//      moved from after the sensory grid/VTO section to directly after the look itself —
//      same block, same handlers, same conditionals, just earlier in the page.
//   5. A tablet breakpoint (max-width: 1023px) was added alongside the existing mobile one.
// Nothing about session handling, ownership checks, the styling engine, or any backend
// persistence was touched — this is presentation-only, source-regex tests (same reason as
// every other result.tsx test in this codebase: it imports *.css?url and cannot be loaded
// directly under plain node --test).

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname ?? new URL(".", import.meta.url).pathname, "..", "..", "..");
const resultSrc = (): string => readFileSync(join(ROOT, "app/routes/style-me/result.tsx"), "utf8");
const css = (): string => readFileSync(join(ROOT, "app/styles/naia-design-system.css"), "utf8");

// ── 1. The look presents as one cohesive grid, not a stacked column ─────────

describe("RD-1 — the three garment-card groups are wrapped in grid containers", () => {
  test("RD-1.1 Your Outfit Direction's item map is wrapped in sm-outfit-grid", () => {
    const src = resultSrc();
    const headingAt = src.indexOf("Your Outfit Direction");
    const mapAt = src.indexOf("suggestion.items?.filter((item: any) => item.itemType !== \"SHOES\"");
    assert.ok(headingAt > -1 && mapAt > headingAt, "sanity: the heading and the map must exist in order");
    const between = src.slice(headingAt, mapAt);
    assert.match(between, /<div className="sm-outfit-grid">/, "the outfit-direction map must be wrapped in the grid container");
  });

  test("RD-1.2 Finishing Layer's item map is wrapped in sm-finishing-grid", () => {
    // "Finishing Layer" also appears in an unrelated comment earlier in the file (about a
    // completion/finishing duplicate-gap bug) — anchor on the actual JSX heading.
    const src = resultSrc();
    const headingAt = src.indexOf('<p className="sm-result-section-head">Finishing Layer</p>');
    assert.ok(headingAt > -1, "the Finishing Layer heading must exist");
    const scope = src.slice(headingAt, headingAt + 200);
    assert.match(scope, /<div className="sm-finishing-grid">/);
  });

  test("RD-1.3 Complete the Look's item map is wrapped in sm-complete-grid", () => {
    // "Complete the Look" also appears in an unrelated comment earlier in the file (about a
    // type-label bug) — anchor on the actual JSX heading, not the bare substring.
    const src = resultSrc();
    const headingAt = src.indexOf('<p className="sm-result-section-head">Complete the Look</p>');
    assert.ok(headingAt > -1, "the Complete the Look heading must exist");
    const scope = src.slice(headingAt, headingAt + 200);
    assert.match(scope, /<div className="sm-complete-grid">/);
  });

  test("RD-1.4 all three grid containers are real CSS grids, not just class names with no rule", () => {
    const sheet = css();
    assert.match(sheet, /\.sm-outfit-grid\s*\{[^}]*display:\s*grid/);
    assert.match(sheet, /\.sm-finishing-grid,\s*\.sm-complete-grid\s*\{[^}]*display:\s*grid/);
  });
});

// ── 2. Image sizing no longer pinned at a fixed, oversized width ────────────

describe("RD-2 — garment images scale to their grid cell instead of a fixed oversized width", () => {
  test("RD-2.1 .sm-item-img no longer carries the old fixed 200px cap", () => {
    const sheet = css();
    assert.doesNotMatch(sheet, /\.sm-item-img\s*\{[^}]*max-width:\s*200px/, "the fixed 200px cap must be gone");
  });

  test("RD-2.2 .sm-item-img fills its grid cell (width/max-width: 100%) and keeps a consistent aspect ratio", () => {
    // ".sm-item-img {" also appears as the tail of the compound selector
    // ".sm-item-card--primary .sm-item-img {" — anchor on a leading newline so this matches
    // only the base rule, not the compound one.
    const sheet = css();
    const ruleAt = sheet.indexOf("\n.sm-item-img {");
    assert.ok(ruleAt > -1, "the base .sm-item-img rule must exist");
    const rule = sheet.slice(ruleAt, ruleAt + 220);
    assert.match(rule, /width:\s*100%/);
    assert.match(rule, /max-width:\s*100%/);
    assert.match(rule, /aspect-ratio:\s*3\/4/, "aspect ratio must still be preserved so imagery doesn't distort");
  });
});

// ── 3. Visual hierarchy: the primary piece now actually looks different ────

describe("RD-3 — sm-item-card--primary (previously a no-op class) now has a real visual rule", () => {
  test("RD-3.1 the JSX still applies sm-item-card--primary to the first NADINE (non-closet) item, unchanged", () => {
    const src = resultSrc();
    assert.match(src, /const isPrimary = idx === 0 && !item\.closetItemId;/);
    assert.match(src, /className=\{`sm-item-card\$\{isPrimary \? " sm-item-card--primary" : ""\}`\}/);
  });

  test("RD-3.2 the stylesheet now defines a visible rule for sm-item-card--primary", () => {
    const sheet = css();
    assert.match(sheet, /\.sm-item-card--primary[^{]*\{[^}]+\}/, "must carry an actual declaration, not just exist as a selector with nothing in it");
  });
});

// ── 4. Primary actions reachable without scrolling the full secondary tail ──

describe("RD-4 — Actions moved directly below the look, ahead of Also Works / Why This Works / VTO", () => {
  test("RD-4.1 the Actions block now appears BEFORE the Alternatives (Also Works) section, not after", () => {
    const src = resultSrc();
    const finishingLayerAt = src.indexOf('<p className="sm-result-section-head">Finishing Layer</p>');
    const actionsAt = src.indexOf('<div className="sm-result-actions">');
    const alternativesAt = src.indexOf("{/* Alternatives */}");
    assert.ok(finishingLayerAt > -1 && actionsAt > -1 && alternativesAt > -1, "sanity: all three markers must exist");
    assert.ok(
      finishingLayerAt < actionsAt && actionsAt < alternativesAt,
      "order must be Finishing Layer -> Actions -> Alternatives; actions must no longer sit after the sensory grid / VTO content",
    );
  });

  test("RD-4.2 the Actions block still appears strictly before the sensory grid and Virtual Try-On section", () => {
    const src = resultSrc();
    const actionsAt = src.indexOf('<div className="sm-result-actions">');
    const sensoryAt = src.indexOf('<div className="sm-sensory-grid">');
    const vtoAt = src.indexOf('<div className="sm-vto-section"');
    assert.ok(actionsAt > -1 && sensoryAt > -1 && vtoAt > -1);
    assert.ok(actionsAt < sensoryAt && actionsAt < vtoAt);
  });

  test("RD-4.3 all four preserved actions — Save Look, New Look Same Vibe, Adjust Vibe, Start Over — are all still present with their original intents/handlers, unchanged by the move", () => {
    const src = resultSrc();
    const actionsAt = src.indexOf('<div className="sm-result-actions">');
    const nextSectionAt = src.indexOf("{/* Alternatives */}");
    const block = src.slice(actionsAt, nextSectionAt);
    assert.match(block, /saveFetcher\.submit\(\{ intent: "save", suggestionId: suggestion\.id \}/, "Save Look");
    assert.match(block, /generateFetcher\.submit\(\{ intent: "regenerate", sessionId: sid \}/, "New Look, Same Vibe");
    assert.match(block, /<input type="hidden" name="intent" value="adjust-vibe" \/>/, "Adjust Vibe");
    assert.match(block, /<input type="hidden" name="intent" value="start-over" \/>/, "Start Over");
  });

  test("RD-4.4 the companion-recovery fail-closed message and the sameCombination message still ride inside the (relocated) Actions block", () => {
    // Guards against the move silently dropping either message instead of just repositioning it.
    const src = resultSrc();
    const actionsAt = src.indexOf('<div className="sm-result-actions">');
    const nextSectionAt = src.indexOf("{/* Alternatives */}");
    const block = src.slice(actionsAt, nextSectionAt);
    assert.match(block, /generateFetcher\.data\?\.sameCombination/);
    assert.match(block, /generateFetcher\.data\?\.companionRecoveryBlocked/);
  });
});

// ── 5. Responsive: a tablet breakpoint now exists alongside the mobile one ──

describe("RD-5 — responsive coverage spans desktop, tablet and mobile", () => {
  test("RD-5.1 a tablet breakpoint (max-width: 1023px) exists in addition to the existing mobile one (max-width: 767px)", () => {
    const sheet = css();
    assert.match(sheet, /@media \(max-width:\s*1023px\)/, "tablet breakpoint must exist");
    assert.match(sheet, /@media \(max-width:\s*767px\)/, "the original mobile breakpoint must still exist");
  });

  test("RD-5.2 the mobile breakpoint caps the new garment grids to 2 columns, not an unbounded single-column stretch", () => {
    // The stylesheet has more than one "@media (max-width: 767px)" block (StyleMe's own
    // and MyNaiaLayout's "mn-*" one) — anchor on the Responsive section comment that
    // precedes the StyleMe one specifically, not the first occurrence in the file.
    const sheet = css();
    const responsiveSectionAt = sheet.indexOf("/* ── Responsive ");
    assert.ok(responsiveSectionAt > -1, "the StyleMe Responsive section comment must exist");
    const mobileAt = sheet.indexOf("@media (max-width: 767px)", responsiveSectionAt);
    const mobileBlock = sheet.slice(mobileAt, sheet.indexOf("@media (prefers-reduced-motion", mobileAt));
    assert.match(mobileBlock, /\.sm-outfit-grid\s*\{\s*grid-template-columns:\s*repeat\(2,\s*1fr\)/);
  });

  test("RD-5.3 the garment grids use minmax(...) tile caps on desktop so a short list of pieces reads as a tidy cluster, not a row stretched edge-to-edge", () => {
    const sheet = css();
    const ruleAt = sheet.indexOf(".sm-outfit-grid {");
    const rule = sheet.slice(ruleAt, ruleAt + 150);
    assert.match(rule, /minmax\(\d+px,\s*\d+px\)/, "each tile must have an upper bound, not just a lower one");
  });
});

// ── 6. Preserve: nothing in scope for the previous tasks was touched ────────

describe("RD-6 — prior protections are untouched by this presentation-only change", () => {
  test("RD-6.1 the ownership guards on generate/regenerate/review are all still present, byte-identical", () => {
    const src = resultSrc();
    assert.match(src, /if \(!naiaCustomer \|\| session\.customerId !== naiaCustomer\.id\)/);
    assert.match(src, /if \(!naiaCustomer \|\| reviewSession\.customerId !== naiaCustomer\.id\)/);
  });

  test("RD-6.2 companion recovery (resolveRegenCompanionIds) is still wired into regenerate, unchanged", () => {
    const src = resultSrc();
    assert.match(src, /resolveRegenCompanionIds\(/);
  });

  test("RD-6.3 the post-wear 'After You Wear This' questionnaire remains absent", () => {
    const src = resultSrc();
    assert.doesNotMatch(src, /After You Wear This/);
    assert.doesNotMatch(src, /What happened with this look\?/);
  });

  test("RD-6.4 the Save QA Page button is still gated by the explicit server-computed flag, not isStagingProject", () => {
    const src = resultSrc();
    const btnAt = src.indexOf("SAVE QA PAGE");
    const gateAt = src.lastIndexOf("qaExportEnabled &&", btnAt);
    assert.ok(gateAt > -1 && gateAt < btnAt, "the button must still be gated by qaExportEnabled");
  });

  test("RD-6.5 'View Saved Looks' still anchors directly to the Your StyleMe Looks section", () => {
    const src = resultSrc();
    assert.match(src, /<Link to="\/style-me#your-styleme-looks" className="sm-banner-cta">View Saved Looks/);
  });

  test("RD-6.6 the 'Complete This Look' WI combination CTA wording is untouched by this page's redesign (it lives in a different route)", () => {
    const wiSrc = readFileSync(join(ROOT, "app/routes/closet.intelligence.tsx"), "utf8");
    assert.match(wiSrc, /Complete This Look →/);
  });
});
