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
// Scoped to the actual rendered JSX only — the file's own header comment
// legitimately discusses "waive"/"does NOT waive" while explaining the
// Decision 2 constraint; checking customer-FACING text must not match on
// that prose, only on what a customer would actually see rendered.
const EARLY_RENDERED = EARLY_SRC.slice(EARLY_SRC.indexOf("return ("));
const PERF_SRC = readFileSync(resolve(__dirname, "ServicePerformanceAcknowledgement.tsx"), "utf8");
const PERF_RENDERED = PERF_SRC.slice(PERF_SRC.indexOf("return ("));
const DELAYED_SRC = readFileSync(resolve(__dirname, "DelayedStartNotice.tsx"), "utf8");

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

  it("the checkbox label is Decision 2's exact approved wording, not a paraphrase", () => {
    assert.match(
      EARLY_SRC,
      /I expressly request that my nAia Membership starts immediately, before any applicable statutory\s+withdrawal period ends\./,
    );
  });

  it("the explanation text is rendered, adjacent to the checkbox, as Decision 2's exact approved wording", () => {
    assert.match(EARLY_SRC, /early-service-consent-explanation/, "has its own class — a real adjacent element, not an afterthought");
    assert.match(EARLY_SRC, /Starting now does not itself remove your statutory withdrawal right\./);
    assert.match(EARLY_SRC, /we will refund your membership payment in\s+full, without deducting for membership usage\./);
  });

  it("never states or implies, in the rendered text itself, that checking this box waives the statutory withdrawal right or any digital-content withdrawal right — Decision 2 explicitly forbids an immediate digital-content waiver", () => {
    assert.doesNotMatch(EARLY_RENDERED, /\bwaive/i);
    assert.doesNotMatch(EARLY_RENDERED, /no longer (have|has) the right/i);
    assert.doesNotMatch(EARLY_RENDERED, /lose (your|the) (right|ability) to withdraw/i);
    // The explanation must say the opposite — that the right is NOT removed.
    assert.match(EARLY_RENDERED, /does not itself remove your statutory withdrawal right/);
  });

  it("explicitly does not create a voluntary refund right where no statutory right applies — Decision 2's own limiting clause, present verbatim", () => {
    assert.match(EARLY_RENDERED, /This does not create a voluntary refund right where no\s+statutory right applies\./);
  });
});

describe("ServicePerformanceAcknowledgement", () => {
  it("leaves the exact wording and jurisdictions as a visible, unfilled placeholder — not invented legal text", () => {
    assert.match(PERF_RENDERED, /\[Service-full-performance acknowledgement/);
    assert.match(PERF_RENDERED, /pending Legal.s\s+final check\.\]/);
  });

  it("states explicitly, in the rendered text, that this does not waive the digital-content withdrawal right — Decision 2's hard constraint", () => {
    assert.match(PERF_RENDERED, /does not waive your statutory digital-content withdrawal right/);
  });

  it("is a plain, stateless component — no props, no persistence, nothing that could silently activate anything", () => {
    assert.doesNotMatch(PERF_SRC, /prisma|db\.server|useState|onChange/);
  });
});

describe("DelayedStartNotice", () => {
  it("renders the computed service-start date, not a vague promise", () => {
    assert.match(DELAYED_SRC, /formatDelayedStartDate\(dates\.serviceStartDate\)/);
  });

  it("states plainly that billing happens on that same date, not before — no silent activation today", () => {
    assert.match(DELAYED_SRC, /you will be billed on that\s+same date — not before/);
  });

  it("does not persist anything or call any billing/Stripe code itself — pure presentation of dates it's given", () => {
    assert.doesNotMatch(DELAYED_SRC, /prisma|db\.server|stripe/i);
  });

  it("uses role=\"status\" so a screen reader announces this notice when it appears (e.g. on unchecking the early-start box)", () => {
    assert.match(DELAYED_SRC, /role="status"/);
  });
});
