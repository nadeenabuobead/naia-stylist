// app/routes/style-me/result.full-look-vto-disclosure.test.ts
//
// Legal handoff W4 (2026-11-17), Full-Look VTO eight-gate review: the
// completed Full-Look VTO result rendered its AI-generated image with no
// disclosure anywhere near it — the pre-generation consent screen is a
// separate, earlier moment and isn't a substitute for one on the actual
// result. Source-text checks, matching this file's own established
// convention for single-fact render checks elsewhere in this route
// (result.post-wear-feedback-removed.test.tsx) rather than a full render
// harness — fullLookQA is local component state reached only via a live
// polling/FASHN callback, not loader data, so a full render test would
// need to fake that machinery rather than check the actual fix.
//
// Run: node --test --import tsx/esm app/routes/style-me/result.full-look-vto-disclosure.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(resolve(__dirname, "result.tsx"), "utf8");

function doneBlock(): string {
  const start = SRC.indexOf('fullLookQA.status === "done"');
  assert.ok(start !== -1, 'the fullLookQA "done" render branch exists');
  const end = SRC.indexOf('fullLookQA.status === "error"', start);
  assert.ok(end !== -1, "the next state branch exists, bounding the done block");
  return SRC.slice(start, end);
}

describe("Full-Look VTO result — AI-generated image disclosure (2026-11-17 fix)", () => {
  it("imports PROVIDER_DISCLAIMER — the existing, already-approved disclosure text, not new invented copy", () => {
    // Matches PROVIDER_DISCLAIMER being imported from this module, whether
    // alone or (as of the 2026-11-20 compositing-disclosure fix) alongside
    // FULL_LOOK_COMPOSITING_DISCLAIMER in the same import statement — the
    // real property under test is "PROVIDER_DISCLAIMER comes from the
    // shared module, not a hardcoded duplicate," not "it is the only thing
    // imported from there."
    assert.match(SRC, /import\s*\{[^}]*\bPROVIDER_DISCLAIMER\b[^}]*\}\s*from\s*"~\/lib\/ai\/virtual-try-on\.types"/);
  });

  it("the done block renders PROVIDER_DISCLAIMER, not a hardcoded duplicate string", () => {
    const block = doneBlock();
    assert.match(block, /\{PROVIDER_DISCLAIMER\}/);
  });

  it("the disclaimer appears AFTER the <img> and BEFORE the omitted-labels note — adjacent to the image, not buried below unrelated content", () => {
    const block = doneBlock();
    const imgIdx = block.indexOf("<img");
    const disclaimerIdx = block.indexOf("{PROVIDER_DISCLAIMER}");
    const omittedIdx = block.indexOf("Shown without:");
    assert.ok(imgIdx !== -1 && disclaimerIdx !== -1 && omittedIdx !== -1, "all three markers present");
    assert.ok(imgIdx < disclaimerIdx, "disclaimer comes after the image");
    assert.ok(disclaimerIdx < omittedIdx, "disclaimer comes before the (conditional) omitted-labels note");
  });

  it("the disclaimer is unconditional within the done block — it is not gated behind omittedLabels or any other optional state", () => {
    const block = doneBlock();
    const disclaimerIdx = block.indexOf("{PROVIDER_DISCLAIMER}");
    const precedingSlice = block.slice(0, disclaimerIdx);
    // The only "{...&&" conditional opened before the disclaimer line should
    // be the done-state fragment itself (already true by construction) —
    // assert no unclosed `omittedLabels &&`/similar guard wraps it by
    // checking the disclaimer's own <p> is not inside the omitted-labels
    // conditional block (which opens AFTER it per the previous test).
    assert.ok(!precedingSlice.includes("fullLookQA.omittedLabels &&"), "no conditional guard precedes the disclaimer");
  });

  it("reuses the shared sm-vto-body-note styling — no new CSS required for this fix to render correctly", () => {
    const block = doneBlock();
    assert.match(block, /className="sm-vto-body-note sm-vto-ai-disclaimer"/);
  });

  it("the five-garment render path (resultUrl, omittedLabels) is untouched — this fix adds a line, it does not restructure the done block", () => {
    const block = doneBlock();
    assert.match(block, /src=\{fullLookQA\.resultUrl\}/);
    assert.match(block, /alt="Your StyleMe outfit on your nAia Model"/);
    assert.match(block, /fullLookQA\.omittedLabels\.join\(", "\)/);
  });
});

describe("Full-Look VTO result — multi-step compositing fidelity disclosure (2026-11-20 fix)", () => {
  // Real-provider evidence: a confirmed five-garment acceptance test found a
  // piece (shoes) successfully predicted at its own chain step, but absent
  // from the final composited image, with no code defect found in the
  // chain/intermediate-image wiring. omittedLabels only discloses pieces
  // never submitted at all (a selection-time omission) — a different,
  // narrower case this does not replace or weaken.

  it("imports FULL_LOOK_COMPOSITING_DISCLAIMER alongside PROVIDER_DISCLAIMER, not a hardcoded duplicate string", () => {
    assert.match(
      SRC,
      /import\s*\{\s*PROVIDER_DISCLAIMER,\s*FULL_LOOK_COMPOSITING_DISCLAIMER\s*\}\s*from\s*"~\/lib\/ai\/virtual-try-on\.types"/,
    );
  });

  it("the done block renders FULL_LOOK_COMPOSITING_DISCLAIMER", () => {
    const block = doneBlock();
    assert.match(block, /\{FULL_LOOK_COMPOSITING_DISCLAIMER\}/);
  });

  it("appears AFTER PROVIDER_DISCLAIMER and BEFORE the omitted-labels note — both disclosures sit together, adjacent to the image", () => {
    const block = doneBlock();
    const providerIdx = block.indexOf("{PROVIDER_DISCLAIMER}");
    const compositingIdx = block.indexOf("{FULL_LOOK_COMPOSITING_DISCLAIMER}");
    const omittedIdx = block.indexOf("Shown without:");
    assert.ok(providerIdx !== -1 && compositingIdx !== -1 && omittedIdx !== -1, "all three markers present");
    assert.ok(providerIdx < compositingIdx, "compositing disclosure comes after the shared provider disclaimer");
    assert.ok(compositingIdx < omittedIdx, "compositing disclosure comes before the (conditional) omitted-labels note");
  });

  it("is unconditional within the done block — not gated behind omittedLabels or any other optional state", () => {
    const block = doneBlock();
    const compositingIdx = block.indexOf("{FULL_LOOK_COMPOSITING_DISCLAIMER}");
    const precedingSlice = block.slice(0, compositingIdx);
    assert.ok(!precedingSlice.includes("fullLookQA.omittedLabels &&"), "no conditional guard precedes it");
  });

  it("the shared PROVIDER_DISCLAIMER constant (single-item VTO's own disclosure, unrelated to this chain-specific risk) is unchanged — this fix adds a new constant, it does not edit the existing one", () => {
    const typesSrc = readFileSync(resolve(__dirname, "../../lib/ai/virtual-try-on.types.ts"), "utf8");
    assert.match(
      typesSrc,
      /export const PROVIDER_DISCLAIMER =\s*\n\s*"A visual preview generated from your photo\. Fit, scale and fabric behaviour may differ in person\."/,
    );
  });

  it("FULL_LOOK_COMPOSITING_DISCLAIMER is a distinct constant, exported from the same shared types file as PROVIDER_DISCLAIMER", () => {
    const typesSrc = readFileSync(resolve(__dirname, "../../lib/ai/virtual-try-on.types.ts"), "utf8");
    assert.match(typesSrc, /export const FULL_LOOK_COMPOSITING_DISCLAIMER =/);
  });
});
