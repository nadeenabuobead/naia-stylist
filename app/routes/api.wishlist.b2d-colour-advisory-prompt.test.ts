// app/routes/api.wishlist.b2d-colour-advisory-prompt.test.ts
//
// B2d — isolates ONE change: the Buy/Skip MODEL's own verdict reasoning no
// longer treats an avoided colour as independently sufficient evidence for a
// Hard SKIP. This was a deferred finding from the B2b closure report —
// structurally avoidColors was already advisory (checkColourPreference is
// computed separately from checkHardConstraints and never reaches
// applyHardConstraintVeto — proven in api.wishlist.b2b1-colour-authority.test.ts,
// which this file does not duplicate), but the VERDICT SEVERITY RULE sentence
// in the model prompt listed "an avoided colour present" alongside genuine
// hard-constraint violations as something that, alone, justified Hard SKIP.
// That is a prompt-contract defect, not a deterministic-logic defect, so these
// are static source-read assertions on the prompt text itself — there is no
// existing harness to mock the live Claude call end-to-end, and building one
// is out of scope for this narrow fix (see B2d instruction 11).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const api = readFileSync(resolve(ROOT, "app/routes/api.wishlist.jsx"), "utf-8");

function verdictSeverityRuleText(): string {
  const idx = api.indexOf("VERDICT SEVERITY RULE");
  assert.ok(idx !== -1, "VERDICT SEVERITY RULE must exist in the prompt");
  // The rule is one contiguous sentence block ending at the next blank line.
  const end = api.indexOf("\n\n", idx);
  return api.slice(idx, end === -1 ? idx + 1200 : end);
}

function colourRuleText(): string {
  const idx = api.indexOf("COLOUR RULE");
  assert.ok(idx !== -1, "COLOUR RULE must exist in the prompt");
  const end = api.indexOf("\n", idx);
  return api.slice(idx, end === -1 ? idx + 800 : end);
}

// ── A/B: single-colour avoided candidate, no hard violation ────────────────
// The prompt-contract proof for "an otherwise-strong single-colour avoided
// candidate must not be pushed to Hard SKIP by colour alone" is that the
// instruction which caused that behaviour is gone, and its replacement says
// the opposite explicitly. This is colour/category-agnostic — it is a static
// instruction, not a per-fixture one — so one assertion covers every such
// candidate class (orange trousers, pink top, etc.) without needing a second
// fixture-specific test.
describe("B2d — VERDICT SEVERITY RULE no longer lists avoided colour as a Hard SKIP trigger", () => {
  it("does not list 'an avoided colour present' among the Hard SKIP conditions", () => {
    const rule = verdictSeverityRuleText();
    assert.ok(
      !rule.includes("an avoided colour present"),
      "VERDICT SEVERITY RULE must no longer name an avoided colour as a standalone Hard SKIP condition",
    );
  });

  it("explicitly states an avoided colour alone is never sufficient for Hard SKIP", () => {
    const rule = verdictSeverityRuleText();
    assert.ok(
      rule.includes("avoided colour alone is never sufficient for Hard SKIP"),
      "VERDICT SEVERITY RULE must explicitly disarm colour as a standalone Hard SKIP trigger",
    );
  });

  it("frames avoided colour as a caution, not a disqualifying conflict", () => {
    const rule = verdictSeverityRuleText();
    assert.ok(
      rule.includes("caution to name, not a disqualifying conflict"),
      "VERDICT SEVERITY RULE must frame avoided colour as advisory caution, not disqualification",
    );
  });
});

// ── E: genuine hard-constraint violation retains real veto authority ───────
describe("B2d — genuine hard-SKIP triggers are preserved untouched", () => {
  it("still lists a dressing requirement violation as sufficient for Hard SKIP", () => {
    const rule = verdictSeverityRuleText();
    assert.ok(
      rule.includes("a dressing requirement violated"),
      "VERDICT SEVERITY RULE must still treat a dressing requirement violation as sufficient for Hard SKIP",
    );
  });

  it("still lists a duplicated regret pattern as sufficient for Hard SKIP", () => {
    const rule = verdictSeverityRuleText();
    assert.ok(
      rule.includes("an established regret pattern duplicated"),
      "VERDICT SEVERITY RULE must still treat a duplicated regret pattern as sufficient for Hard SKIP",
    );
  });

  it("still lists realistically near-zero wear as sufficient for Hard SKIP", () => {
    const rule = verdictSeverityRuleText();
    assert.ok(
      rule.includes("wear being realistically near-zero"),
      "VERDICT SEVERITY RULE must still treat realistically near-zero wear as sufficient for Hard SKIP",
    );
  });

  it("still routes uncertain wear frequency to SKIP FOR NOW, not SKIP (T20 regression)", () => {
    const rule = verdictSeverityRuleText();
    assert.ok(
      rule.includes("wear frequency is uncertain") && rule.includes("SKIP FOR NOW, not SKIP"),
      "VERDICT SEVERITY RULE must still direct uncertain wear frequency toward SKIP FOR NOW",
    );
  });

  it("still defaults uncertain-but-meritorious cases to SKIP FOR NOW (T20 regression)", () => {
    const rule = verdictSeverityRuleText();
    assert.ok(
      rule.includes("Default to SKIP FOR NOW"),
      "VERDICT SEVERITY RULE must still default uncertain cases with real merit to SKIP FOR NOW",
    );
  });
});

// ── F: avoided colour + an independent real negative can still SKIP ────────
describe("B2d — colour conflict combined with an independent negative can still SKIP", () => {
  it("names that a SKIP still needs one of the listed conflicts or another substantive negative", () => {
    const rule = verdictSeverityRuleText();
    assert.ok(
      rule.includes("a SKIP verdict needs one of the conflicts above or another substantive negative independent of colour"),
      "VERDICT SEVERITY RULE must make clear a SKIP is still available when real, independent negative evidence exists alongside a colour conflict",
    );
    // This is explicitly NOT "always BUY if only colour conflicts" (prohibited by
    // instruction 9) — the rule disarms colour as a *sole* trigger, it does not
    // forbid SKIP/SKIP FOR NOW when other evidence independently supports it.
    assert.ok(
      !rule.toLowerCase().includes("always buy"),
      "the rule must not introduce a new hard BUY-biasing instruction",
    );
  });
});

// ── D: no avoided colour on record — unaffected ─────────────────────────────
describe("B2d — COLOUR RULE unaffected when no colour is avoided", () => {
  it("the 'none specified' fallback for avoidColors is untouched", () => {
    assert.ok(
      api.includes(`styleProfile.avoidColors?.length > 0 ? styleProfile.avoidColors.join(", ") : "none specified"`),
      "the avoidColors none-specified fallback must remain exactly as it was before B2d",
    );
  });
});

// ── Symmetry: favourite vs avoided colour framing ───────────────────────────
describe("B2d — COLOUR RULE gives avoided colour the same non-exclusionary treatment as favourites", () => {
  it("still treats favourites as preferences, not exclusions (pre-existing, unchanged)", () => {
    const rule = colourRuleText();
    assert.ok(
      rule.includes("Treat favourites as preferences, not exclusions"),
      "COLOUR RULE must still treat favourite colours as non-exclusionary preferences",
    );
  });

  it("now states an avoided colour is a caution, not a disqualifier", () => {
    const rule = colourRuleText();
    assert.ok(
      rule.includes("An avoided colour is a caution worth naming, not a disqualifier"),
      "COLOUR RULE must state an avoided colour is advisory caution, not a disqualifier",
    );
  });

  it("states an avoided colour must never be the sole basis for a SKIP verdict", () => {
    const rule = colourRuleText();
    assert.ok(
      rule.includes("must never be the sole basis for a SKIP verdict"),
      "COLOUR RULE must state avoided colour can never alone justify SKIP",
    );
  });
});

// ── B2b3 caution copy is untouched by this prompt edit ──────────────────────
describe("B2d — B2b3 colour-caution display copy is untouched (separate, deterministic code path)", () => {
  it("'Worth Keeping in Mind' caution copy does not live inside this prompt string", () => {
    const promptStart = api.indexOf("You are assessing a clothing item for a specific customer");
    const promptEnd = api.indexOf("Respond ONLY with valid JSON");
    assert.ok(promptStart !== -1 && promptEnd !== -1, "could not locate the model prompt boundaries");
    const promptBody = api.slice(promptStart, promptEnd);
    assert.ok(
      !promptBody.includes("Worth Keeping in Mind"),
      "the B2b3 colour-caution copy must remain in deterministic display code, not the model prompt",
    );
  });
});

// ── B2b1/B2c deterministic authority: unchanged by this prompt-only fix ────
describe("B2d — deterministic avoidColors authority is untouched (structural, no code change)", () => {
  it("applyHardConstraintVeto is still called with constraintEvidence only, never colourPreferenceEvidence", () => {
    assert.ok(
      api.includes("applyHardConstraintVeto(constraintEvidence)"),
      "applyHardConstraintVeto must still be called with constraintEvidence alone — B2d made no deterministic-logic change",
    );
  });

  it("colourPreferenceEvidence is still computed via the dedicated checkColourPreference call", () => {
    assert.ok(
      api.includes("checkColourPreference(styleProfile?.avoidColors ?? null, productFacts)"),
      "colourPreferenceEvidence must still be computed separately from hard constraints — unchanged by B2d",
    );
  });
});
