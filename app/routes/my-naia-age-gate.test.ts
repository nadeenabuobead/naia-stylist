// app/routes/my-naia-age-gate.test.ts
// Priority 5 (2026-10-19) — age-declaration backfill for existing customers.
//
// Source-string assertion, same convention and same reasoning as
// onboarding/step-age-gate.test.ts — my-naia._index.tsx's loader has
// substantial, untested-as-a-whole surface (many sequential Prisma
// queries); this targets exactly the new gate.
//
// Run: node --import tsx/esm --test app/routes/my-naia-age-gate.test.ts

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "my-naia._index.tsx"), "utf8");

describe("my-naia._index.tsx — existing-customer age-declaration backfill", () => {
  it("imports hasConfirmedCurrentAge from age-confirmation.server", () => {
    assert.ok(src.includes("hasConfirmedCurrentAge"));
    assert.ok(src.includes("~/lib/age-confirmation.server"));
  });

  it("the gate runs immediately after requireCurrentNaiaCustomer, before any other query", () => {
    const authIdx = src.indexOf("requireCurrentNaiaCustomer(request)");
    const gateIdx = src.indexOf("hasConfirmedCurrentAge(customer)");
    const firstQueryIdx = src.indexOf("prisma.stylingSession.findMany");
    assert.ok(authIdx > -1 && gateIdx > -1 && firstQueryIdx > -1);
    assert.ok(authIdx < gateIdx);
    assert.ok(gateIdx < firstQueryIdx);
  });

  it("test/QA/demo accounts (accountType !== CUSTOMER) are exempt from the gate", () => {
    const gateLineIdx = src.indexOf("if (customer.accountType === \"CUSTOMER\"");
    assert.ok(gateLineIdx > -1, "gate must condition on accountType === CUSTOMER, not apply unconditionally");
  });

  it("redirects to /onboarding/age-confirm with next=/my-naia — never silently continuing", () => {
    const gateIdx = src.indexOf("hasConfirmedCurrentAge(customer)");
    const gateBlock = src.slice(gateIdx, gateIdx + 200);
    assert.ok(gateBlock.includes("/onboarding/age-confirm"));
    assert.ok(gateBlock.includes("return redirect"));
    assert.ok(gateBlock.includes("/my-naia"));
  });
});
