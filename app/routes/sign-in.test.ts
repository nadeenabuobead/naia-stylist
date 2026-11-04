// app/routes/sign-in.test.ts
//
// Source-string contract checks for sign-in.tsx — the actual sign-in-or-up
// switching logic lives inside Clerk's own hosted <SignIn/> component,
// opaque to this codebase, so there's nothing to unit-test behaviorally
// here; these pin down that the props enabling it are actually present,
// so a future edit can't silently drop them.
//
// Run: node --test --import tsx/esm app/routes/sign-in.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(resolve(__dirname, "sign-in.tsx"), "utf8");

describe("sign-in.tsx — existing-customer transition", () => {
  it("withSignUp is enabled — a returning customer never has to manually switch to Sign Up to recover an existing account", () => {
    assert.match(SRC, /withSignUp\b/);
  });

  it("the sign-up half of the combined flow routes through the same provisioning callback as the standalone sign-up page", () => {
    assert.match(SRC, /signUpForceRedirectUrl="\/auth\/clerk-callback"/);
  });

  it("the sign-in half still routes through auth.clerk-callback.tsx, forwarding return_to", () => {
    assert.match(SRC, /forceRedirectUrl=\{callbackUrl\}/);
    assert.match(SRC, /\/auth\/clerk-callback/);
  });

  it("surfaces email_in_use and verification_email_failed error states from auth.clerk-callback.tsx's own redirects", () => {
    assert.match(SRC, /email_in_use/);
    assert.match(SRC, /verification_email_failed/);
  });
});
