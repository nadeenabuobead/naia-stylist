// app/lib/sensitive-logging.test.ts
// Priority 5 (2026-10-19) — sensitive logging sweep.
//
// Phase 2 audit previously trimmed api.outfit-history.jsx and
// api.outfit-rating.jsx (commit 1f52ca5). This closes four more call sites
// found in the repo-wide Priority 5 sweep that logged a full raw AI
// provider response/error object — which, for these specific call sites,
// can echo back body/style/garment content that was in the triggering
// prompt. Trimmed to status/error-type/shape only, same debugging value
// (did this fail, what kind of failure) without the content.
//
// Source-string assertion, same convention as the other *.test.ts files —
// no live AI call, no network.
//
// Run: node --import tsx/esm --test app/lib/sensitive-logging.test.ts

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (relPath: string) => readFileSync(join(__dirname, relPath), "utf8");

describe("claude.server.ts — no raw AI payload in error logs", () => {
  const src = read("ai/claude.server.ts");

  // 2026-11-17 (launch-readiness audit): the original "Claude API Error"
  // raw-HTTP-error log this test protected against no longer exists in
  // this file at all — grepped the whole app/ tree, confirmed it doesn't
  // exist anywhere, meaning that code path was refactored away, not
  // silently regressed back to logging raw content under cover of a
  // passing test. Replaced with an assertion against what this file
  // actually does today.
  it("does not log a raw HTTP error-response body anywhere in this file", () => {
    assert.ok(!src.includes('console.error("Claude API Error:", data)'));
    assert.ok(!src.includes("Claude API Error"), "the raw-HTTP-error log path no longer exists in this file");
  });

  it("JSON-parse-failure log no longer prints the full raw response text", () => {
    assert.ok(!src.includes('console.error("Raw response:", response)'));
    assert.ok(src.includes("response.length"));
  });
});

describe("api.style.jsx — retired 2026-11-02 (security remediation), confirmed not reintroduced", () => {
  // 2026-11-17 (launch-readiness audit): this describe block previously
  // called read("../routes/api.style.jsx") unconditionally at suite-setup
  // time — that file was retired 2026-11-02, well before this session, so
  // every test run since then has thrown ENOENT constructing the suite
  // itself rather than genuinely failing a logging-hygiene check. Fixed to
  // assert the actual current, intended state instead of crashing on a
  // stale path.
  it("api.style.jsx does not exist and is not registered", () => {
    assert.ok(!existsSync(join(__dirname, "../routes/api.style.jsx")), "retired route file must not be reintroduced");
    const routes = readFileSync(join(__dirname, "../routes.ts"), "utf8");
    assert.ok(!routes.includes("api.style.jsx"), "route registry must not reference the retired endpoint");
  });
});

// api.analyze-item.jsx retired 2026-11-17 (launch-readiness audit) — a
// publicly-discoverable, orphaned paid-AI endpoint with zero callers
// anywhere in the product. Its logging-hygiene coverage above is moot
// now that the file no longer exists; see naia-identity-security.test.ts's
// A02/A03/C01 for the retirement itself.

describe("api.wishlist.jsx — no raw AI payload snippet in the unexpected-shape log", () => {
  const src = read("../routes/api.wishlist.jsx");

  it("logs the response's keys only, not a JSON.stringify slice of its content", () => {
    assert.ok(!src.includes("JSON.stringify(aiData).slice(0, 200)"));
    assert.ok(src.includes("Object.keys(aiData"));
  });
});
