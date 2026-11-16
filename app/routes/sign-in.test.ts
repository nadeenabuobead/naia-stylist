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
    assert.match(SRC, /signUpForceRedirectUrl=\{callbackUrl\}/);
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

describe("sign-in.tsx — return_to continuity for the combined sign-up branch (2026-11-16 fix)", () => {
  // Root cause: signUpForceRedirectUrl used to be a bare "/auth/clerk-callback"
  // string literal, independent of callbackUrl — so a signed-out visitor
  // deep-linked here with a return_to who created their account INLINE
  // (via withSignUp) rather than navigating to the separate /sign-up page
  // lost return_to silently and landed on the generic /my-naia default
  // instead of back on the page they actually came from.

  it("forceRedirectUrl and signUpForceRedirectUrl are the exact same expression — one source of truth, not two props that can drift apart", () => {
    const forceRedirect = SRC.match(/forceRedirectUrl=\{([^}]+)\}/);
    const signUpForceRedirect = SRC.match(/signUpForceRedirectUrl=\{([^}]+)\}/);
    assert.ok(forceRedirect, "forceRedirectUrl is a JSX expression");
    assert.ok(signUpForceRedirect, "signUpForceRedirectUrl is a JSX expression, not a hardcoded string");
    assert.strictEqual(forceRedirect[1], signUpForceRedirect[1], "both props must reference the identical expression");
  });

  it("neither redirect prop is ever a bare, return_to-blind string literal", () => {
    assert.doesNotMatch(SRC, /signUpForceRedirectUrl="\/auth\/clerk-callback"/);
    assert.doesNotMatch(SRC, /forceRedirectUrl="\/auth\/clerk-callback"/);
  });

  it("callbackUrl itself still builds from the same return_to param either branch would rely on", () => {
    assert.match(SRC, /const callbackUrl = returnTo \? `\/auth\/clerk-callback\?return_to=\$\{encodeURIComponent\(returnTo\)\}` : "\/auth\/clerk-callback";/);
  });
});
