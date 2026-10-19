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
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (relPath: string) => readFileSync(join(__dirname, relPath), "utf8");

describe("claude.server.ts — no raw AI payload in error logs", () => {
  const src = read("ai/claude.server.ts");

  it("API error log no longer prints the full raw response body", () => {
    assert.ok(!src.includes('console.error("Claude API Error:", data)'));
    assert.ok(src.includes('console.error("Claude API Error:", { status: response.status, errorType: data?.error?.type })'));
  });

  it("JSON-parse-failure log no longer prints the full raw response text", () => {
    assert.ok(!src.includes('console.error("Raw response:", response)'));
    assert.ok(src.includes("response.length"));
  });
});

describe("api.style.jsx — no raw Anthropic payload in error log", () => {
  const src = read("../routes/api.style.jsx");

  it("logs status/error-type only, not the full anthropicData object", () => {
    assert.ok(!src.includes('console.error("Anthropic API Error:", anthropicData)'));
    assert.ok(src.includes("errorType: anthropicData?.error?.type"));
  });
});

describe("api.analyze-item.jsx — no raw Claude payload in error log", () => {
  const src = read("../routes/api.analyze-item.jsx");

  it("logs status/error-type only, not the full analysisData object", () => {
    assert.ok(!src.includes('console.error("Claude error:", analysisData)'));
    assert.ok(src.includes("errorType: analysisData?.error?.type"));
  });
});

describe("api.wishlist.jsx — no raw AI payload snippet in the unexpected-shape log", () => {
  const src = read("../routes/api.wishlist.jsx");

  it("logs the response's keys only, not a JSON.stringify slice of its content", () => {
    assert.ok(!src.includes("JSON.stringify(aiData).slice(0, 200)"));
    assert.ok(src.includes("Object.keys(aiData"));
  });
});
