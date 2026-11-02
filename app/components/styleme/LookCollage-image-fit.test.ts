// app/components/styleme/LookCollage-image-fit.test.ts
//
// 2026-10-24: garment images in LookCollage (Saved Looks / StyleMe looks
// gallery tiles) and my-naia.saved.tsx's own thumbnail tiles used
// object-fit: cover, which crops whatever doesn't match the tile's aspect
// ratio — cutting off the top/bottom or sides of the garment's own
// silhouette. Source-string assertions, no DOM rendering harness in this
// codebase (same convention as MyNaiaLayout.test.ts, root.test.ts).
//
// Run: node --import tsx/esm --test app/components/styleme/LookCollage-image-fit.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const collageSrc = readFileSync(resolve(__dirname, "LookCollage.tsx"), "utf-8");
const designSystemCss = readFileSync(
  resolve(__dirname, "../../styles/naia-design-system.css"),
  "utf-8",
);

describe("LookCollage.tsx — garment images preserve their full silhouette, not cropped", () => {
  it("CollageTile's <img> uses object-fit: contain, not cover", () => {
    assert.match(collageSrc, /objectFit:\s*"contain"/);
    assert.ok(!collageSrc.includes('objectFit: "cover"'), "cover must not reappear — it crops the garment");
  });

  it("the tile has a visible background so contain's letterboxing reads as intentional", () => {
    const tileIdx = collageSrc.indexOf("function CollageTile");
    const tileBody = collageSrc.slice(tileIdx, collageSrc.indexOf("</div>", tileIdx));
    assert.match(tileBody, /background:\s*"color-mix/);
  });

  it("the <img> is top-aligned, not centered — this is what fixes 'garments appear at inconsistent heights' in a 3/4-image collage (2026-11-08)", () => {
    // Centering both ways was the regression: a wide/short item (shoes, bags)
    // letterboxes top AND bottom and so starts partway down its tile, while a
    // tall item (trousers, dresses) fills top-to-bottom and starts at the
    // tile's own top edge — side by side that reads as "this one sits lower"
    // even though nothing is misaligned. Top-aligning removes the mismatch:
    // every garment starts at the same edge of its own tile regardless of its
    // own photo's aspect ratio. Horizontal stays centered — the reported
    // inconsistency was specifically about vertical position.
    assert.match(collageSrc, /objectPosition:\s*"center top"/);
    assert.ok(!collageSrc.includes('objectPosition: "center"'), 'plain center must not reappear on its own — it reintroduces the height mismatch');
  });
});

describe("LookCollage.tsx — tile shapes are consistent across how many images a look has (2026-11-08)", () => {
  // Source-string assertions against the literal gridStyle expression, same
  // convention as the rest of this file — no DOM rendering harness exists
  // in this codebase.
  const gridStyleIdx = collageSrc.indexOf("const gridStyle");
  const gridStyleSrc = collageSrc.slice(gridStyleIdx, collageSrc.indexOf(";\n", collageSrc.indexOf("return (", gridStyleIdx)));

  it("a 2-image look stacks tiles into one column, two rows — not side by side", () => {
    // The old side-by-side split (gridTemplateColumns: "1fr 1fr", one row)
    // gave each tile a ~2:5 box on this card's 4:5 frame — so narrow that
    // any garment photo wider than a trouser leg (shoes, bags) had to shrink
    // to a sliver to fit, with large, inconsistent empty margins depending
    // on the photo's own shape. Stacking gives each tile a ~8:5 box instead.
    const twoImageBranch = gridStyleSrc.slice(
      gridStyleSrc.indexOf("images.length === 2"),
      gridStyleSrc.indexOf("images.length === 2") + 150,
    );
    assert.match(twoImageBranch, /gridTemplateColumns:\s*"1fr"/, "2-image case must be a single column");
    assert.match(twoImageBranch, /gridTemplateRows:\s*"1fr 1fr"/, "2-image case must be two rows (stacked)");
  });

  it("the 3/4-image case is unchanged: a 2x2 grid, which already gave each tile the card's own 4:5 ratio", () => {
    assert.match(gridStyleSrc, /gridTemplateColumns:\s*"1fr 1fr"/, "3/4-image case keeps two columns");
    assert.match(gridStyleSrc, /gridTemplateRows:\s*"1fr 1fr"/, "3/4-image case keeps two rows");
  });

  it("every multi-image layout still uses a consistent, small gap between tiles", () => {
    const occurrences = gridStyleSrc.match(/gap:\s*"2px"/g) ?? [];
    assert.equal(occurrences.length, 2, "both the 2-image and 3/4-image branches must use the same gap");
  });
});

describe("naia-design-system.css — Saved Looks thumbnails preserve the full garment silhouette", () => {
  it(".sv-card-thumb img uses object-fit: contain, not cover", () => {
    const ruleIdx = designSystemCss.indexOf(".sv-card-thumb img {");
    assert.ok(ruleIdx !== -1, "rule must exist");
    const rule = designSystemCss.slice(ruleIdx, ruleIdx + 120);
    assert.match(rule, /object-fit:\s*contain/);
  });

  it(".sv-card-thumb-img-tile img uses object-fit: contain, not cover", () => {
    const ruleIdx = designSystemCss.indexOf(".sv-card-thumb-img-tile img {");
    assert.ok(ruleIdx !== -1, "rule must exist");
    const rule = designSystemCss.slice(ruleIdx, ruleIdx + 120);
    assert.match(rule, /object-fit:\s*contain/);
  });

  it("both thumbnail tiles still have a background to letterbox against", () => {
    const thumbRule = designSystemCss.slice(
      designSystemCss.indexOf(".sv-card-thumb {"),
      designSystemCss.indexOf(".sv-card-thumb {") + 200,
    );
    assert.match(thumbRule, /background:/);
    const tileRule = designSystemCss.slice(
      designSystemCss.indexOf(".sv-card-thumb-img-tile {"),
      designSystemCss.indexOf(".sv-card-thumb-img-tile {") + 150,
    );
    assert.match(tileRule, /background:/);
  });
});
