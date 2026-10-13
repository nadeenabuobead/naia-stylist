// vite.config.test.ts
//
// Asset-base precedence for Vite's `base` config — the root cause of a real
// bug: a disposable feature-branch Vercel preview deployment's HTML was
// loading its JS bundles from the shared staging alias
// (naia-stylist-staging.vercel.app) instead of its own unique host, because
// ASSET_BASE_URL/SHOPIFY_APP_URL (both pointing at that shared alias) could
// outrank VERCEL_URL (this deployment's own, correct host). The mismatched
// client bundle then hydrated against a DIFFERENT deployment's route
// manifest, and a route unrecognised there (e.g.
// /admin/naia/customers/:id/styleme/:sessionId, which only exists on the
// feature branch) could bounce the browser back to that other build's root.
//
// vite.config.js executes its asset-base IIFE once at import time from
// process.env, so re-importing it with different env combinations in one
// process doesn't re-evaluate it (ESM module caching) — these tests instead
// read the source text and assert the precedence ordering structurally,
// matching the convention already used for other config-shaped files in
// this repo (e.g. personalised-trend-edit-usage.test.ts's source-regex
// checks) rather than exercising runtime env-var branching directly.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "vite.config.js"), "utf8");

// The body of the `assetBase` IIFE only, so later file content can't
// accidentally satisfy an ordering assertion meant for this block.
const assetBaseStart = source.indexOf("const assetBase = (() => {");
const assetBaseEnd = source.indexOf("})();", assetBaseStart);
const assetBaseBody = source.slice(assetBaseStart, assetBaseEnd);

describe("vite.config.js asset-base precedence — preview deployments must serve their own assets", () => {
  it("checks VERCEL_ENV === production before anything else", () => {
    const firstIfIdx = assetBaseBody.indexOf("if (");
    const prodIdx = assetBaseBody.indexOf('VERCEL_ENV === "production"');
    assert.ok(prodIdx > -1, "a production branch must exist");
    // The first `if (` in the body must be the production check — i.e. no
    // other condition is tested before it.
    assert.ok(prodIdx > firstIfIdx && prodIdx - firstIfIdx < 20,
      "VERCEL_ENV === production must be the very first condition checked");
  });

  it("checks VERCEL_ENV === preview + VERCEL_URL before ASSET_BASE_URL or SHOPIFY_APP_URL", () => {
    const previewIdx = assetBaseBody.indexOf('VERCEL_ENV === "preview"');
    const assetBaseUrlIdx = assetBaseBody.indexOf("ASSET_BASE_URL");
    const shopifyAppUrlFallbackIdx = assetBaseBody.lastIndexOf("SHOPIFY_APP_URL");
    assert.ok(previewIdx > -1, "a preview branch must exist");
    assert.ok(previewIdx < assetBaseUrlIdx,
      "VERCEL_URL-for-preview must be checked before ASSET_BASE_URL — a preview deployment must never fall through to the shared-staging override");
    assert.ok(previewIdx < shopifyAppUrlFallbackIdx,
      "VERCEL_URL-for-preview must be checked before the SHOPIFY_APP_URL fallback");
  });

  it("the preview branch resolves to VERCEL_URL, not SHOPIFY_APP_URL or ASSET_BASE_URL", () => {
    const previewIdx = assetBaseBody.indexOf('VERCEL_ENV === "preview"');
    const nextIfIdx = assetBaseBody.indexOf("if (", previewIdx + 1);
    const previewBranch = assetBaseBody.slice(previewIdx, nextIfIdx === -1 ? undefined : nextIfIdx);
    assert.match(previewBranch, /return `https:\/\/\$\{process\.env\.VERCEL_URL\}\/`/);
    assert.doesNotMatch(previewBranch, /ASSET_BASE_URL/);
    assert.doesNotMatch(previewBranch, /SHOPIFY_APP_URL/);
  });

  it("ASSET_BASE_URL / SHOPIFY_APP_URL remain only as a fallback for when VERCEL_URL is unavailable", () => {
    // Both must still be present (not deleted outright) — they're the
    // documented escape hatch for the one deployment the shared alias is
    // actually pinned to — but only reached after the VERCEL_URL checks.
    assert.match(assetBaseBody, /ASSET_BASE_URL/);
    assert.match(assetBaseBody, /SHOPIFY_APP_URL/);
  });

  it("production never reads ASSET_BASE_URL — only the canonical SHOPIFY_APP_URL", () => {
    const prodIdx = assetBaseBody.indexOf('VERCEL_ENV === "production"');
    const previewIdx = assetBaseBody.indexOf('VERCEL_ENV === "preview"');
    const prodBranch = assetBaseBody.slice(prodIdx, previewIdx);
    assert.doesNotMatch(prodBranch, /ASSET_BASE_URL/);
    assert.match(prodBranch, /SHOPIFY_APP_URL/);
  });
});
