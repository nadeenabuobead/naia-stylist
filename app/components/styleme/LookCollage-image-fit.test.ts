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

describe("LookCollage.tsx — tile shapes are consistent across how many images a look has", () => {
  // Source-string assertions against the literal gridStyle expression, same
  // convention as the rest of this file — no DOM rendering harness exists
  // in this codebase.
  const gridStyleIdx = collageSrc.indexOf("const gridStyle");
  const gridStyleSrc = collageSrc.slice(gridStyleIdx, collageSrc.indexOf(";\n", collageSrc.indexOf("return (", gridStyleIdx)));

  it("a 2-image look stacks tiles into one column, two equal rows — not side by side, not weighted", () => {
    // The old side-by-side split (gridTemplateColumns: "1fr 1fr", one row)
    // gave each tile a ~2:5 box on this card's 4:5 frame — so narrow that
    // any garment photo wider than a trouser leg (shoes, bags) had to shrink
    // to a sliver to fit, with large, inconsistent empty margins depending
    // on the photo's own shape. Stacking gives each tile a ~8:5 box instead.
    // 2026-11-12: a since-removed prototype weighted these rows by each
    // photo's own aspect ratio; real-photo QA found that signal too
    // unreliable (padded product photos share near-identical canvas ratios
    // regardless of the garment's actual shape) to justify the added
    // complexity — see the published real-photo comparison. Equal rows only.
    const twoImageBranch = gridStyleSrc.slice(
      gridStyleSrc.indexOf("images.length === 2"),
      gridStyleSrc.indexOf("images.length === 2") + 150,
    );
    assert.match(twoImageBranch, /gridTemplateColumns:\s*"1fr"/, "2-image case must be a single column");
    assert.match(twoImageBranch, /gridTemplateRows:\s*"1fr 1fr"/, "2-image case must be two equal stacked rows");
  });

  it("the 3/4-image case is a plain 2x2 grid, which gives each tile the card's own 4:5 ratio", () => {
    assert.match(gridStyleSrc, /gridTemplateColumns:\s*"1fr 1fr"/, "3/4-image case must keep two columns");
    assert.match(gridStyleSrc, /gridTemplateRows:\s*"1fr 1fr"/, "3/4-image case must keep two rows");
  });

  it("the first image in a 3-image look spans both columns of row 1 — simple, stable, independent of any photo's own proportions", () => {
    const fnIdx = collageSrc.indexOf("function tileCellStyle");
    const fnBody = collageSrc.slice(fnIdx, collageSrc.indexOf("\n  }\n", fnIdx));
    assert.match(fnBody, /images\.length === 3 && i === 0/, "span must be unconditional on index 0, not derived from any image's own shape");
    assert.match(fnBody, /gridColumn:\s*"1 \/ 3"/);
  });

  it("a 4-image look never spans any cell — a plain, equal 2x2", () => {
    const fnIdx = collageSrc.indexOf("function tileCellStyle");
    const fnBody = collageSrc.slice(fnIdx, collageSrc.indexOf("\n  }\n", fnIdx));
    assert.ok(!/images\.length >= 4/.test(fnBody), "no 4-image-specific spanning branch should exist");
  });

  it("every multi-image layout uses a consistent, small gap between tiles", () => {
    const occurrences = gridStyleSrc.match(/gap:\s*"2px"/g) ?? [];
    assert.equal(occurrences.length, 2, "both the 2-image and 3/4-image branches must use the same gap");
  });
});

describe("LookCollage.tsx — no grid-item can blow out its row/column and clip a sibling image", () => {
  // Source-string assertions, same convention as the rest of this file — this
  // codebase has no DOM rendering harness, and even if it did, jsdom does not
  // implement real CSS Grid track-size computation (getBoundingClientRect
  // always reports 0 in jsdom), so no automated test here can directly
  // reproduce the actual clipping bug. These checks lock in the PRESENCE and
  // UNCONDITIONAL application of both fixes; the authoritative regression
  // evidence is the real-browser verification reported alongside each
  // commit (manual, reproducible, not automatable in this codebase's
  // existing toolchain).
  it("defines a cellBaseStyle with minHeight:0 and minWidth:0 — the standard fix for the classic CSS Grid 'intrinsic min-height' gotcha", () => {
    assert.match(collageSrc, /cellBaseStyle[^=]*=\s*\{\s*minHeight:\s*0,\s*minWidth:\s*0\s*\}/);
  });

  it("applies cellBaseStyle to EVERY grid cell unconditionally via tileCellStyle — including the 3-image spanning cell, not just the plain ones", () => {
    const fnIdx = collageSrc.indexOf("function tileCellStyle");
    const fnBody = collageSrc.slice(fnIdx, collageSrc.indexOf("\n  }\n", fnIdx));
    assert.match(fnBody, /\{\s*\.\.\.cellBaseStyle,\s*gridColumn:\s*"1 \/ 3"\s*\}/, "the 3-image spanning cell must still carry the fix");
    assert.match(fnBody, /return cellBaseStyle/, "the non-spanning branch must return cellBaseStyle directly, never undefined");
  });

  it("BUGFIX (2026-11-05, real-photo QA): the component's own root div also gets minHeight/minWidth 0 — it's a grid item too, one level up, wherever the page wraps LookCollage in a place-items:center grid frame", () => {
    assert.match(
      collageSrc,
      /<div style=\{\{ position: "relative", width: "100%", height: "100%", minHeight: 0, minWidth: 0 \}\}>/,
      "the root div's own style object must carry minHeight:0/minWidth:0 alongside the pre-existing position/width/height",
    );
  });

  it("does not touch card dimensions or object-fit — both fixes are layout-only", () => {
    assert.match(collageSrc, /objectFit:\s*"contain"/);
    assert.match(collageSrc, /objectPosition:\s*"center top"/);
  });
});

describe("LookCollage.tsx — deliberately simple: no per-photo aspect-ratio logic", () => {
  // 2026-11-12: the branch previously carried an aspect-weighted-rows /
  // shape-driven-spanning prototype (Alt 1 / Alt 2). Real-photo QA showed
  // its signal (each photo's raw naturalWidth/naturalHeight) is unreliable
  // for real, padded product photography, and a follow-up content-bounding-
  // box investigation — while more informative — was judged added
  // complexity not yet justified by a demonstrated, consistent visual win.
  // These checks guard against that machinery silently reappearing; they are
  // not a statement that aspect-ratio-aware layout is wrong, only that it is
  // out of scope here unless real-photo evidence justifies it.
  it("tracks no per-image natural size — layout decisions must not depend on how a photo happens to be sized", () => {
    assert.ok(!/useState/.test(collageSrc), "no React state — this component has nothing to react to without per-image size tracking");
    assert.ok(!/onNaturalSize|naturalWidth|naturalHeight/.test(collageSrc));
  });

  it("no aspect-ratio thresholds, weighting, or outlier detection", () => {
    assert.ok(!/TALL_RATIO_THRESHOLD|WIDE_RATIO_THRESHOLD|MIN_WEIGHT|MAX_WEIGHT/.test(collageSrc));
    assert.ok(!/clampWeight|findSingleOutlier|twoImageRowTemplate|wideOutlierIndex|tallOutlierIndex/.test(collageSrc));
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
