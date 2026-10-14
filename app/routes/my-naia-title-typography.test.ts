// app/routes/my-naia-title-typography.test.ts
//
// Every MY nAia customer page's title must share ONE typography system —
// the sp-shell-title / sp-shell-accent classes (naia-design-system.css),
// with My Trend Edits (trends.my-edits.tsx) as the canonical reference.
// Source-code assertions — no DOM, no Prisma connection, no network.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(process.cwd(), "app");
function read(rel: string) {
  return readFileSync(resolve(ROOT, rel), "utf-8");
}

const designSystemSrc = read("styles/naia-design-system.css");

describe("Unified title system — sp-shell-title is the single source of truth", () => {
  it("naia-design-system.css defines sp-shell-title's base rule exactly once, with Trend Edits' breakpoints (2rem -> 3rem @640 -> 4.25rem @1024)", () => {
    const baseMatches = designSystemSrc.match(/^\.sp-shell-title\s*{/gm) ?? [];
    assert.equal(baseMatches.length, 1, "sp-shell-title's base (non-media-query) rule must be defined exactly once — no per-page overrides");
    assert.ok(designSystemSrc.includes("font-weight: 200"), "font-weight 200");
    assert.ok(designSystemSrc.includes("line-height: 0.92"), "line-height 0.92");
    assert.ok(designSystemSrc.includes("letter-spacing: 0.02em"), "letter-spacing 0.02em");
    assert.ok(/@media \(min-width: 640px\) { \.sp-shell-title { font-size: 3rem; } }/.test(designSystemSrc), "3rem at 640px");
    assert.ok(/@media \(min-width: 1024px\) { \.sp-shell-title { font-size: 4\.25rem; } }/.test(designSystemSrc), "4.25rem at 1024px");
  });

  const pages: Array<{ name: string; path: string }> = [
    { name: "My Trend Edits (canonical reference)", path: "routes/trends.my-edits.tsx" },
    { name: "Overview", path: "routes/my-naia._index.tsx" },
    { name: "Style Passport", path: "routes/passport.tsx" },
    { name: "My Closet", path: "routes/closet._index.tsx" },
    { name: "Wardrobe Intelligence", path: "routes/closet.intelligence.tsx" },
    { name: "StyleMe", path: "routes/style-me/_index.tsx" },
    { name: "Buy or Skip", path: "routes/buyskip._index.tsx" },
    { name: "My nAia Model", path: "routes/my-naia-model.tsx" },
    { name: "Plan & Usage", path: "routes/my-naia.plan-usage.tsx" },
    { name: "Settings & Privacy", path: "routes/settings.tsx" },
  ];

  for (const page of pages) {
    it(`${page.name} (${page.path}) renders its page title with the shared sp-shell-title class`, () => {
      const src = read(page.path);
      assert.match(
        src,
        /<h[12] className="sp-shell-title">/,
        `${page.path} must have a title element using className="sp-shell-title"`,
      );
    });

    it(`${page.name} (${page.path}) does not locally redefine .sp-shell-title or a lookalike title rule`, () => {
      const src = read(page.path);
      assert.ok(!/\.sp-shell-title\s*{/.test(src), `${page.path} must not locally override .sp-shell-title`);
    });
  }

  it("the retired per-page title classes (cl-headline, wip-h1) no longer exist anywhere", () => {
    for (const page of pages) {
      const src = read(page.path);
      assert.ok(!src.includes("cl-headline"), `${page.path} must not use the retired cl-headline class`);
      assert.ok(!src.includes("wip-h1"), `${page.path} must not use the retired wip-h1 class`);
    }
    assert.ok(!designSystemSrc.includes("cl-headline"));
    assert.ok(!designSystemSrc.includes("wip-h1"));
  });
});
