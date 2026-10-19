// app/routes/onboarding/step-age-gate.test.ts
// Priority 5 (2026-10-19) — age-gate wiring into the onboarding step loader.
//
// Source-string assertion, same convention as the other *.test.ts files in
// this codebase — step.$step.tsx itself has substantial, untested-as-a-whole
// surface (prisma, pending-save, quiz-data); this targets exactly the new
// gate rather than attempting to mock the entire existing loader.
//
// Run: node --import tsx/esm --test app/routes/onboarding/step-age-gate.test.ts

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "step.$step.tsx"), "utf8");

describe("onboarding/step.$step.tsx — age-confirmation gate", () => {
  it("imports hasConfirmedCurrentAge from age-confirmation.server", () => {
    assert.ok(src.includes("hasConfirmedCurrentAge"));
    assert.ok(src.includes("~/lib/age-confirmation.server"));
  });

  it("checks the gate AFTER requireCurrentNaiaCustomer and BEFORE reading onboardingProfile", () => {
    const authIdx = src.indexOf("requireCurrentNaiaCustomer(request)");
    const gateIdx = src.indexOf("hasConfirmedCurrentAge(customer)");
    const opIdx = src.indexOf("customer.onboardingProfile");
    assert.ok(authIdx > -1 && gateIdx > -1 && opIdx > -1);
    assert.ok(authIdx < gateIdx, "gate runs after auth");
    assert.ok(gateIdx < opIdx, "gate runs before onboardingProfile is read");
  });

  it("redirects to /onboarding/age-confirm with the requested step preserved as next, never a silent pass-through", () => {
    const gateBlock = src.slice(src.indexOf("hasConfirmedCurrentAge(customer)"), src.indexOf("hasConfirmedCurrentAge(customer)") + 300);
    assert.ok(gateBlock.includes("/onboarding/age-confirm"));
    assert.ok(gateBlock.includes("return redirect"));
    assert.ok(gateBlock.includes("`/onboarding/step/${step}`"), "preserves the specific step requested, including a deep link");
  });

  it("does not touch getTotalSteps, the question bank, or step bounds-checking — purely additive", () => {
    // The pre-existing bounds-check and totalSteps call are untouched lines,
    // still present verbatim.
    assert.ok(src.includes("const totalSteps = getTotalSteps();"));
    assert.ok(src.includes('if (isNaN(step) || step < 1 || step > totalSteps) return redirect("/onboarding/step/1");'));
  });
});
