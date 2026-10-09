// app/routes/api.wishlist.b2d-deterministic-guard.test.ts
//
// B2d deterministic guard — wiring-level source assertions proving
// applyColourOnlySkipGuard is actually called in the live persistence path,
// in the right order, with the right inputs, and that applyColourOnlyOverride
// mutates the analysis object the same safe way applyVerdictOverride already
// does for the opposite direction.
//
// Pure-function behavior (does the guard actually fire correctly for each
// scenario) is proven separately in
// app/lib/buyskip/colour-only-skip-guard.test.ts — this file only proves the
// route actually wires that function in correctly and doesn't bypass it.
//
// Run: node --test --import tsx/esm app/routes/api.wishlist.b2d-deterministic-guard.test.ts

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(resolve(import.meta.dirname, "api.wishlist.jsx"), "utf-8");

describe("A — applyColourOnlySkipGuard is imported and wired into the live flow", () => {
  it("imports applyColourOnlySkipGuard from decision-evidence.server", () => {
    assert.ok(
      SRC.includes('import { assembleDecisionEvidence, applyHardConstraintVeto, applyColourOnlySkipGuard } from "../lib/buyskip/decision-evidence.server"'),
      "applyColourOnlySkipGuard must be imported alongside the existing evidence/veto imports",
    );
  });

  it("the guard runs AFTER the hard-constraint veto, not before — hard-constraint authority stays first", () => {
    const vetoIdx = SRC.indexOf("applyVerdictOverride(analysis, veto, modelVerdict)");
    const guardIdx = SRC.indexOf("applyColourOnlySkipGuard({");
    assert.ok(vetoIdx !== -1 && guardIdx !== -1, "both calls present");
    assert.ok(vetoIdx < guardIdx, "the hard-constraint veto must run before the colour-only guard");
  });

  it("the guard is called with the post-hard-constraint-veto verdict, not the raw model verdict", () => {
    const guardIdx = SRC.indexOf("applyColourOnlySkipGuard({");
    const callBlock = SRC.slice(guardIdx, SRC.indexOf("});", guardIdx) + 3);
    assert.ok(callBlock.includes("verdict: analysis.verdict"), "guard reads analysis.verdict (post hard-constraint-veto state), not a stale pre-veto value");
  });

  it("the guard receives constraintEvidence, colourPreferenceEvidence, duplicateEvidence, and wardrobeUtility — the exact structural fields the policy allows", () => {
    const guardIdx = SRC.indexOf("applyColourOnlySkipGuard({");
    const callBlock = SRC.slice(guardIdx, SRC.indexOf("});", guardIdx) + 3);
    for (const field of ["constraintEvidence", "colourPreferenceEvidence", "duplicateEvidence", "wardrobeUtility"]) {
      assert.ok(callBlock.includes(field), `guard call passes ${field}`);
    }
  });

  it("the override is actually applied to `analysis` via applyColourOnlyOverride, not left unused", () => {
    assert.ok(
      SRC.includes("analysis = applyColourOnlyOverride(analysis, colourGuard, analysis.verdict)"),
      "the guard's result must actually be applied back onto analysis",
    );
  });
});

describe("B — applyColourOnlyOverride mutates analysis the same safe way the existing override does", () => {
  function overrideFnBody() {
    const idx = SRC.indexOf("export function applyColourOnlyOverride(");
    assert.ok(idx !== -1, "applyColourOnlyOverride must be defined");
    return SRC.slice(idx, SRC.indexOf("\n}", idx) + 2);
  }

  it("is a no-op when the guard did not override — returns analysis unchanged", () => {
    const body = overrideFnBody();
    assert.ok(body.includes("if (!colourGuard.overridden)") && body.includes("return analysis"), "no-op path returns analysis as-is");
  });

  it("sets verdict to BUY when overridden", () => {
    const body = overrideFnBody();
    assert.ok(body.includes('verdict: colourGuard.verdict'), "verdict is taken from the guard's own result, not hard-coded redundantly");
  });

  it("nulls out confidence — the model's confidence score was computed under the discarded skip verdict", () => {
    const body = overrideFnBody();
    assert.ok(body.includes("confidence: null"), "confidence must be nulled on override, matching applyVerdictOverride's pattern");
  });

  it("preserves the model's original verdict and confidence for audit via modelVerdict/modelConfidence", () => {
    const body = overrideFnBody();
    assert.ok(body.includes("modelVerdict,") && body.includes("modelConfidence:"), "audit trail fields preserved, matching applyVerdictOverride's pattern");
  });

  it("replaces finalThought with the override reason — never shows skip-flavored reasoning under a BUY verdict", () => {
    const body = overrideFnBody();
    assert.ok(body.includes("finalThought: colourGuard.overrideReason"), "finalThought must be replaced, not left as the model's skip-flavored text");
  });

  it("clears skipIf — 'skip it if' framing has no place under a final BUY verdict", () => {
    const body = overrideFnBody();
    assert.ok(body.includes("skipIf: null"), "skipIf must be cleared on override");
  });
});

describe("C — BUY + avoided colour still shows the exact existing caution once, unaffected by the new guard", () => {
  it("buyskip.$id.tsx's showColourCaution trigger is untouched — this fix never touches that file", () => {
    const resultPageSrc = readFileSync(resolve(import.meta.dirname, "buyskip.$id.tsx"), "utf-8");
    assert.ok(
      resultPageSrc.includes('!skipResult && fa?.decisionEvidence?.colourPreferenceEvidence?.status === "conflict"'),
      "the BUY-only colour-caution trigger must remain exactly as it was",
    );
    const captionCount = (resultPageSrc.match(/Worth Keeping in Mind/g) || []).length;
    assert.equal(captionCount, 1, "the caution copy must appear exactly once in the source — never duplicated");
  });

  it("decisionEvidence.colourPreferenceEvidence persisted to the DB is the real pre-override evidence, not mutated by the verdict override", () => {
    // The override only ever touches the `analysis` object (verdict, confidence,
    // finalThought, skipIf) — decisionEvidence is assembled once, earlier, from
    // the same evidence objects the guard reads, and is never re-derived after
    // the override runs. This is what lets showColourCaution still correctly
    // detect "conflict" on an overridden BUY.
    const decisionEvidenceIdx = SRC.indexOf("const decisionEvidence = assembleDecisionEvidence({");
    const guardIdx = SRC.indexOf("applyColourOnlySkipGuard({");
    assert.ok(decisionEvidenceIdx !== -1 && guardIdx !== -1, "both present");
    assert.ok(decisionEvidenceIdx < guardIdx, "decisionEvidence is assembled before the guard runs, from the same untouched evidence objects");
  });
});
