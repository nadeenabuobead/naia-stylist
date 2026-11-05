// app/components/styleme/LookCollage-render.test.tsx
//
// Genuine render-level tests — these actually execute LookCollage via
// react-dom/server's renderToStaticMarkup and assert on the real rendered
// output, not on the .tsx source text (LookCollage-image-fit.test.ts's
// convention, kept for the fast, zero-setup checks it's good at). This
// codebase has no DOM-rendering test harness and jsdom doesn't implement
// real CSS Grid track-size computation anyway, so these still can't prove
// final on-screen pixel layout — that's the real-browser verification
// reported alongside each commit. What SSR *can* prove, and the old
// source-string convention couldn't: that the component's actual control
// flow, given real props, produces the right style object on the right
// element — not just that the right-looking string appears somewhere in
// the file.
//
// This is viable now specifically because the approved, simplified
// LookCollage (1fda6f6) has no per-image natural-size dependency left —
// its entire output is a pure function of (images.length, index). Before
// the simplification, SSR couldn't exercise Alt 1/Alt 2 at all (onLoad
// never fires in renderToStaticMarkup output, a methodology trap hit and
// corrected earlier in this project's history) — that limitation is now
// moot because there is no onLoad left to not-fire.
//
// Run: node --import tsx/esm --test app/components/styleme/LookCollage-render.test.tsx

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { LookCollage } from "./LookCollage";

// Real, representative garment photo identifiers — tall/narrow (trousers,
// leggings), wide/flat (loafers, earrings), and square (sweater) — used as
// plain src strings. LookCollage no longer reads any pixel data or natural
// size, so these only need to be realistic labels, not loadable files.
const TROUSERS = "/real-photos/black-tailored-trousers-tall-narrow.jpg";
const LOAFERS = "/real-photos/black-leather-loafers-wide-flat.jpg";
const SWEATER = "/real-photos/cream-knit-sweater.jpg";
const LEGGINGS = "/real-photos/grey-flare-leggings-tall-narrow.jpg";
const EARRINGS = "/real-photos/gold-hoop-earrings-wide-flat.jpg";
const BLAZER = "/real-photos/black-blazer.jpg";
const BAG = "/real-photos/celine-black-tote.jpg";

function render(images: string[], extraCount = 0) {
  return renderToStaticMarkup(
    <LookCollage images={images} extraCount={extraCount} alt="Test look" />,
  );
}

// Minimal style-attribute extraction — good enough for this file's own SSR
// output, which only ever uses double-quoted style="..." attributes.
function styleAttrsOf(html: string): string[] {
  return [...html.matchAll(/style="([^"]*)"/g)].map((m) => m[1]);
}

// Index 0 is the root div, index 1 is the grid div, then each image
// contributes exactly 5 style attrs in a fixed order: the cell wrapper
// (tileCellStyle), CollageTile's own wrapper, the <img> itself, the
// hidden fallback wrapper, and the fallback SVG. The CELL style — the one
// carrying the minHeight:0 fix and any grid-column/grid-row span — is
// always the first of each group of 5.
function cellStylesOf(html: string): string[] {
  const rest = styleAttrsOf(html).slice(2);
  return rest.filter((_, i) => i % 5 === 0);
}

describe("LookCollage — both clipping fixes are actually present in rendered output", () => {
  it("the root div carries min-height:0 and min-width:0, for every image count", () => {
    for (const images of [[TROUSERS], [TROUSERS, LOAFERS], [SWEATER, TROUSERS, LOAFERS], [SWEATER, TROUSERS, LOAFERS, BAG]]) {
      const html = render(images);
      const rootStyle = styleAttrsOf(html)[0];
      assert.match(rootStyle, /min-height:0(;|$)/, `root div missing min-height:0 for ${images.length}-image look`);
      assert.match(rootStyle, /min-width:0(;|$)/, `root div missing min-width:0 for ${images.length}-image look`);
    }
  });

  it("every grid cell carries min-height:0 and min-width:0 — including the 3-image spanning cell", () => {
    const html = render([BLAZER, LEGGINGS, EARRINGS]);
    const cellStyles = cellStylesOf(html);
    assert.equal(cellStyles.length, 3, "expected exactly one cell style per image");
    for (const s of cellStyles) {
      assert.match(s, /min-height:0(;|$)/);
      assert.match(s, /min-width:0(;|$)/);
    }
  });
});

describe("LookCollage — layout is identical regardless of which real photos are passed (no per-image sizing)", () => {
  it("2-image: tall+narrow paired with wide+flat renders the same equal rows as two square photos", () => {
    const tallWithWide = render([TROUSERS, LOAFERS]);
    const squareWithSquare = render([SWEATER, BAG]);
    const rowsOf = (html: string) => styleAttrsOf(html)[1].match(/grid-template-rows:([^;]+)/)?.[1];
    assert.equal(rowsOf(tallWithWide), rowsOf(squareWithSquare), "row split must not depend on which real photos are in it");
    assert.match(rowsOf(tallWithWide)!, /^1fr 1fr$/);
  });

  it("3-image: index 0 always spans both columns of row 1, regardless of which real photo is at index 0", () => {
    const trousersFirst = render([TROUSERS, LOAFERS, EARRINGS]);
    const earringsFirst = render([EARRINGS, TROUSERS, LOAFERS]);
    for (const html of [trousersFirst, earringsFirst]) {
      const cellStyles = cellStylesOf(html);
      assert.match(cellStyles[0], /grid-column:1 \/ 3/, "index 0 must span, whatever photo it is");
      assert.ok(!/grid-column|grid-row/.test(cellStyles[1]), "index 1 must not span");
      assert.ok(!/grid-column|grid-row/.test(cellStyles[2]), "index 2 must not span");
    }
  });

  it("4-image: plain 2x2, no cell spans, for any real-photo combination including two tall/narrow pieces", () => {
    const html = render([TROUSERS, LEGGINGS, LOAFERS, EARRINGS]); // two tall/narrow + two wide/flat
    const gridStyle = styleAttrsOf(html)[1];
    assert.match(gridStyle, /grid-template-columns:1fr 1fr/);
    assert.match(gridStyle, /grid-template-rows:1fr 1fr/);
    const cellStyles = cellStylesOf(html);
    assert.equal(cellStyles.length, 4);
    for (const s of cellStyles) assert.ok(!/grid-column|grid-row/.test(s), "no 4-image cell may span");
  });
});

describe("LookCollage — image presentation and edge cases, at render time", () => {
  it("every <img> uses object-fit:contain and object-position:center top, for 1/2/3/4-image looks", () => {
    for (const images of [[TROUSERS], [TROUSERS, LOAFERS], [SWEATER, TROUSERS, LOAFERS], [SWEATER, TROUSERS, LOAFERS, BAG]]) {
      const html = render(images);
      const imgTags = [...html.matchAll(/<img[^>]*>/g)].map((m) => m[0]);
      assert.equal(imgTags.length, images.length);
      for (const tag of imgTags) {
        assert.match(tag, /object-fit:contain/);
        assert.match(tag, /object-position:center top/);
      }
    }
  });

  it("an empty look renders the empty-state icon, not a broken collage", () => {
    const html = render([]);
    assert.match(html, /<svg/);
    assert.ok(!html.includes("<img"), "no <img> should render for an empty look");
  });

  it("extraCount renders the +N badge only when positive", () => {
    const withExtra = render([TROUSERS, LOAFERS], 3);
    assert.match(withExtra, />\+3</);
    const withoutExtra = render([TROUSERS, LOAFERS], 0);
    assert.ok(!withoutExtra.includes("+0"), "extraCount:0 must not render a +0 badge");
  });
});
