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
    await assert.rejects(
      () => import("./session.server.ts?unconfigured-secret-test"),
      /SESSION_SECRET/,
    );
  } finally {
    if (original !== undefined) process.env.SESSION_SECRET = original;
  }
});
