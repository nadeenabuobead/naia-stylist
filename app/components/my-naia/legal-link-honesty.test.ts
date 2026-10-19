// app/components/my-naia/legal-link-honesty.test.ts
// Priority 5 (2026-10-19) — Privacy Policy / Terms of Service links must
// not falsely appear complete while the actual legal documents are still
// pending.
//
// Source-string assertion. Scoped deliberately to just these two links —
// Accessibility/Cookie Preferences and the unrelated Shipping/Returns/
// Social placeholders are out of scope for this pass.
//
// Run: node --import tsx/esm --test app/components/my-naia/legal-link-honesty.test.ts

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "MyNaiaLayout.tsx"), "utf8");

describe("Privacy Policy / Terms of Service footer entries are marked pending", () => {
  it('"Privacy Policy" is flagged pending: true in FOOTER_COLS', () => {
    const idx = src.indexOf('{ label: "Privacy Policy"');
    assert.ok(idx > -1);
    assert.ok(src.slice(idx, idx + 60).includes("pending: true"));
  });

  it('"Terms of Service" is flagged pending: true in FOOTER_COLS', () => {
    const idx = src.indexOf('{ label: "Terms of Service"');
    assert.ok(idx > -1);
    assert.ok(src.slice(idx, idx + 60).includes("pending: true"));
  });

  it("both render blocks (desktop grid + mobile accordion) render a pending link as non-clickable text, not an <a>", () => {
    const occurrences = [...src.matchAll(/"pending" in l && l\.pending/g)];
    assert.equal(occurrences.length, 2, "expected the pending check in both the desktop and mobile accordion render blocks");
  });

  it("the pending copy says 'coming soon' rather than silently matching the real-link visual style", () => {
    assert.ok(src.includes("coming soon"));
  });

  it("Accessibility and Cookie Preferences are left untouched — out of scope for this pass", () => {
    const accessIdx = src.indexOf('{ label: "Accessibility"');
    assert.ok(!src.slice(accessIdx, accessIdx + 60).includes("pending"));
    const cookieIdx = src.indexOf('{ label: "Cookie Preferences"');
    assert.ok(!src.slice(cookieIdx, cookieIdx + 60).includes("pending"));
  });
});
