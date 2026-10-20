// vite-asset-base.test.ts
//
// Unit coverage for vite.config.js's resolveAssetBase — the precedence fix
// (2026-10-20) that lets a branch-scoped ASSET_BASE_URL override the
// per-deployment VERCEL_URL default for exactly one pinned preview build,
// without disturbing production or any ordinary feature-branch preview.

import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveAssetBase } from "./vite.config.js";

test("production uses SHOPIFY_APP_URL, never VERCEL_URL or ASSET_BASE_URL", () => {
  const base = resolveAssetBase({
    VERCEL_ENV: "production",
    SHOPIFY_APP_URL: "https://naia-stylist.vercel.app",
    VERCEL_URL: "naia-stylist-abc123-team.vercel.app",
    ASSET_BASE_URL: "https://naia-stylist-staging.vercel.app",
  });
  assert.equal(base, "https://naia-stylist.vercel.app/");
});

test("production with no SHOPIFY_APP_URL falls back to a relative base", () => {
  const base = resolveAssetBase({ VERCEL_ENV: "production" });
  assert.equal(base, "/");
});

test("ordinary preview (no ASSET_BASE_URL) uses its own unique VERCEL_URL", () => {
  const base = resolveAssetBase({
    VERCEL_ENV: "preview",
    VERCEL_URL: "naia-stylist-staging-xyz789-team.vercel.app",
  });
  assert.equal(base, "https://naia-stylist-staging-xyz789-team.vercel.app/");
});

test("ordinary preview is unaffected even when SHOPIFY_APP_URL is also set", () => {
  const base = resolveAssetBase({
    VERCEL_ENV: "preview",
    VERCEL_URL: "naia-stylist-staging-xyz789-team.vercel.app",
    SHOPIFY_APP_URL: "https://naia-stylist-staging.vercel.app",
  });
  assert.equal(base, "https://naia-stylist-staging-xyz789-team.vercel.app/");
});

test("preview with ASSET_BASE_URL set overrides VERCEL_URL — the fixed precedence", () => {
  const base = resolveAssetBase({
    VERCEL_ENV: "preview",
    VERCEL_URL: "naia-stylist-staging-xyz789-team.vercel.app",
    ASSET_BASE_URL: "https://naia-stylist-staging.vercel.app",
  });
  assert.equal(base, "https://naia-stylist-staging.vercel.app/");
});

test("preview with ASSET_BASE_URL set but no VERCEL_URL still honours the override", () => {
  const base = resolveAssetBase({
    VERCEL_ENV: "preview",
    ASSET_BASE_URL: "https://naia-stylist-staging.vercel.app",
  });
  assert.equal(base, "https://naia-stylist-staging.vercel.app/");
});

test("ASSET_BASE_URL is scoped to preview only — ignored outside VERCEL_ENV=preview", () => {
  const base = resolveAssetBase({
    SHOPIFY_APP_URL: "https://naia-stylist-staging.vercel.app",
    ASSET_BASE_URL: "https://some-other-host.vercel.app",
  });
  assert.equal(base, "https://naia-stylist-staging.vercel.app/");
});

test("no VERCEL_ENV at all (local dev) falls back to SHOPIFY_APP_URL", () => {
  const base = resolveAssetBase({ SHOPIFY_APP_URL: "http://localhost:3000" });
  assert.equal(base, "http://localhost:3000/");
});

test("nothing set at all falls back to a relative base", () => {
  const base = resolveAssetBase({});
  assert.equal(base, "/");
});
