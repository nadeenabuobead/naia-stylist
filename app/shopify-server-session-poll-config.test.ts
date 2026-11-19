// app/shopify-server-session-poll-config.test.ts
//
// Static source-code assertion, not a live import — shopify.server.js
// constructs a real PrismaSessionStorage against the real Prisma client
// and calls shopifyApp() with real env vars at import time (see
// shopify-session-storage-safety-net.server.test.ts's own header for why
// that file takes the same approach). Confirms the lazy-construction
// wiring (2026-11-19 — defers the session-table poll off every cold
// start's critical path, see shopify.server.js's own comment for the
// full writeup) is actually present in source, without needing to
// trigger those module-load-time side effects.
//
// Run: npx vitest run app/shopify-server-session-poll-config.test.ts

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const SHOPIFY_SERVER_SOURCE = readFileSync(path.resolve("app/shopify.server.js"), "utf8");

describe("shopify.server.js — lazy session-storage construction", () => {
  it("wraps session storage in createLazySessionStorage, not a bare PrismaSessionStorage construction", () => {
    expect(SHOPIFY_SERVER_SOURCE).toMatch(
      /const prismaSessionStorage = createLazySessionStorage\(/,
    );
  });

  it("the real PrismaSessionStorage is only constructed inside the lazy factory, with connectionRetries: 1", () => {
    expect(SHOPIFY_SERVER_SOURCE).toMatch(
      /createLazySessionStorage\(\(\) => \{[\s\S]{0,200}new PrismaSessionStorage\(\s*prisma\s*,\s*\{\s*connectionRetries:\s*1\s*\}\s*\)/,
    );
  });

  it("still attaches the existing crash-prevention/recovery safety net to the real instance", () => {
    expect(SHOPIFY_SERVER_SOURCE).toMatch(
      /const real = new PrismaSessionStorage[\s\S]{0,200}attachSessionStorageReadinessSafetyNet\(real\)/,
    );
  });

  it("passes the lazy wrapper, not a raw PrismaSessionStorage instance, to shopifyApp()", () => {
    expect(SHOPIFY_SERVER_SOURCE).toMatch(/sessionStorage:\s*prismaSessionStorage/);
  });
});
