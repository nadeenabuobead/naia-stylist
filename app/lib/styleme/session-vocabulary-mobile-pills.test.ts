// app/lib/styleme/session-vocabulary-mobile-pills.test.ts
//
// 2026-10-24 — StyleMe questionnaire option cards on mobile: .sm-pills used
// flex-wrap, so pill widths followed content, producing inconsistent rows
// (one short pill floating next to empty space, or a longer label wrapping
// awkwardly mid-phrase inside its own flex item). Fixed with a balanced
// mobile-only two-column grid, with isLongOptionLabel flagging labels that
// should span the full row instead of squeezing into one column.
//
// isLongOptionLabel itself is unit-tested directly (plain function, no I/O).
// The four quiz step files (state/intention/physical-need/occasion) are
// covered by source-string assertions — same convention as the rest of this
// codebase for files with CSS imports.
//
// Run: node --import tsx/esm --test app/lib/styleme/session-vocabulary-mobile-pills.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { isLongOptionLabel } from "./session-vocabulary";

const __dirname = dirname(fileURLToPath(import.meta.url));
const routesDir = resolve(__dirname, "../../routes/style-me");
const css = readFileSync(resolve(__dirname, "../../styles/naia-design-system.css"), "utf-8");

describe("isLongOptionLabel — presentational only, not a signal/ranking decision", () => {
  it("short labels are not flagged wide", () => {
    assert.equal(isLongOptionLabel("Dinner"), false);
    assert.equal(isLongOptionLabel("Low-energy"), false);
    assert.equal(isLongOptionLabel("I feel calm"), false);
  });

  it("long labels ARE flagged wide", () => {
    assert.equal(isLongOptionLabel("I don't really feel like myself"), true);
    assert.equal(isLongOptionLabel("Softer / more flexible fabrics"), true);
    assert.equal(isLongOptionLabel("I'm going through something"), true);
  });
});

describe("naia-design-system.css — mobile .sm-pills is a balanced two-column grid", () => {
  it("a mobile-scoped rule switches .sm-pills from flex-wrap to a 2-column grid", () => {
    const mobileAt = css.indexOf("Balanced two-column option grid");
    assert.ok(mobileAt > -1, "the mobile two-column rule block must exist");
    const block = css.slice(mobileAt, mobileAt + 500);
    assert.match(block, /\.sm-pills\s*\{[^}]*grid-template-columns:\s*1fr 1fr/);
  });

  it(".sm-pill--wide spans the full row instead of a single column", () => {
    assert.match(css, /\.sm-pill--wide\s*\{\s*grid-column:\s*1\s*\/\s*-1/);
  });

  it("the original desktop .sm-pills rule (flex-wrap) is untouched outside the mobile block", () => {
    const baseRuleIdx = css.indexOf(".sm-pills { display: flex; flex-wrap: wrap;");
    assert.ok(baseRuleIdx > -1, "desktop flex-wrap layout must be preserved, not replaced");
  });
});

function stepSrc(file: string) {
  return readFileSync(resolve(routesDir, file), "utf-8");
}

describe("StyleMe quiz steps — each pill wires isLongOptionLabel for mobile layout", () => {
  for (const file of ["state.tsx", "intention.tsx", "physical-need.tsx", "occasion.tsx"]) {
    it(`${file} imports isLongOptionLabel from session-vocabulary`, () => {
      const src = stepSrc(file);
      assert.match(src, /isLongOptionLabel/);
      assert.match(src, /from "~\/lib\/styleme\/session-vocabulary"/);
    });

    it(`${file} applies sm-pill--wide conditionally in its pill className`, () => {
      const src = stepSrc(file);
      assert.match(src, /isLongOptionLabel\([^)]+\)\s*\?\s*" sm-pill--wide"\s*:\s*""/);
    });
  }
});
