// app/lib/session-secret-fallback.server.test.ts
//
// Regression coverage for the hardcoded session-signing fallback hotfixed
// 2026-11-12. session.server.ts used to fall back to the public literal
// "default-secret-change-me" when SESSION_SECRET was unset, which would
// silently let anyone forge/tamper the __naia_session cookie's signature.
// Deliberately a separate file from session.server.test.ts so it can leave
// SESSION_SECRET unset and import the module fresh, without disturbing that
// file's own (already-configured-secret) test setup.
//
// Run: node --test --import tsx/esm app/lib/session-secret-fallback.server.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";

test("session.server: throws at import time instead of falling back to the public literal when SESSION_SECRET is unset", async () => {
  const original = process.env.SESSION_SECRET;
  delete process.env.SESSION_SECRET;
  try {
    // Not a string literal at the call site — TypeScript only attempts to
    // statically resolve a dynamic import() to a real module (and therefore
    // a real type) when its specifier IS a literal; a variable reference is
    // treated as unresolvable and typed Promise<any>, same as any other
    // runtime-computed specifier. The cache-busting query string itself is
    // unchanged: it still forces a fresh module evaluation so this test
    // re-triggers the top-level throw regardless of whether some other test
    // in the same process already imported (and cached) session.server.ts.
    const freshModuleSpecifier: string = "./session.server.ts?unconfigured-secret-test";
    await assert.rejects(
      () => import(freshModuleSpecifier),
      /SESSION_SECRET/,
    );
  } finally {
    if (original !== undefined) process.env.SESSION_SECRET = original;
  }
});
