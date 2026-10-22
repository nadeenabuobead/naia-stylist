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
