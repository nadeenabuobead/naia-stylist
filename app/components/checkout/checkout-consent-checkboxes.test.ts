// app/components/checkout/checkout-consent-checkboxes.test.ts
//
// Source-text contract checks for TermsAcceptanceCheckbox and
// EarlyServiceConsentCheckbox — Legal handoff W1. Both are deliberately
// presentational/unwired; these pin down that neither one defaults to
// "accepted" and that neither invents legal wording it has no authority
// to write.
//
// Run: node --test --import tsx/esm app/components/checkout/checkout-consent-checkboxes.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TERMS_SRC = readFileSync(resolve(__dirname, "TermsAcceptanceCheckbox.tsx"), "utf8");
const EARLY_SRC = readFileSync(resolve(__dirname, "EarlyServiceConsentCheckbox.tsx"), "utf8");

describe("TermsAcceptanceCheckbox", () => {
  it("is a controlled checkbox — checked and onChange come from props, not local state", () => {
    assert.match(TERMS_SRC, /checked=\{checked\}/);
    assert.match(TERMS_SRC, /onChange=\{\(e\) => onChange\(e\.target\.checked\)\}/);
    assert.doesNotMatch(TERMS_SRC, /useState/, "no internal state — the caller owns this value, so it can gate submission");
  });

  it("does not link to or summarize an actual Terms of Service document that doesn't exist yet", () => {
    assert.doesNotMatch(TERMS_SRC, /<a\s/, "no link — there's nowhere real to send it to yet");
    assert.doesNotMatch(TERMS_SRC, /href=/);
  });

  it("required defaults to true — the checkbox is required unless a caller explicitly opts out", () => {
    assert.match(TERMS_SRC, /required\s*=\s*true/);
  });
});

describe("EarlyServiceConsentCheckbox", () => {
  it("is a controlled checkbox with no default value baked in beyond what the caller passes as `checked`", () => {
    assert.match(EARLY_SRC, /checked=\{checked\}/);
    assert.doesNotMatch(EARLY_SRC, /checked=\{true\}|defaultChecked/, "must never be hardcoded checked — W1 requires this starts unchecked");
  });

  it("does not persist anything itself — no prisma/db import, no server action", () => {
    assert.doesNotMatch(EARLY_SRC, /prisma|db\.server|~\/lib\/.*\.server/);
  });

  it("the exact statutory consequence of checking it is left as a visible placeholder, not invented legal wording", () => {
    assert.match(EARLY_SRC, /\[Exact statutory consequence/);
    assert.match(EARLY_SRC, /pending Legal\s+sign-off\.\]/);
  });

  it("states explicitly that leaving it unchecked delays activation, matching W1's delayed-start requirement", () => {
    assert.match(EARLY_SRC, /unchecked delays activation/i);
  });
});
