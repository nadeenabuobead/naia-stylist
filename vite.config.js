import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

if (
  process.env.HOST &&
  (!process.env.SHOPIFY_APP_URL ||
    process.env.SHOPIFY_APP_URL === process.env.HOST)
) {
  process.env.SHOPIFY_APP_URL = process.env.HOST;
  delete process.env.HOST;
}

// SHOPIFY_APP_URL is expected to be a full URL, but a malformed or placeholder
// value in a local .env.local (not committed; set per-developer) must not take
// down every local build/typecheck/test invocation that loads this config —
// fall back to localhost rather than crashing on an un-parseable value.
let host;
try {
  host = new URL(process.env.SHOPIFY_APP_URL || "http://localhost").hostname;
} catch {
  console.warn(
    `[vite.config.js] SHOPIFY_APP_URL is not a valid URL — falling back to localhost. ` +
    `Check .env.local if this is unexpected.`,
  );
  host = "localhost";
}
let hmrConfig;

if (host === "localhost") {
  hmrConfig = { protocol: "ws", host: "localhost", port: 64999, clientPort: 64999 };
} else {
  hmrConfig = { protocol: "wss", host: host, port: parseInt(process.env.FRONTEND_PORT) || 8002, clientPort: 443 };
}

// Environment-aware asset base — each case names the ONE host that should
// win, rather than letting whichever env var happens to be set override the
// others:
//   - production        -> the canonical production app URL (SHOPIFY_APP_URL)
//   - preview, pinned    -> ASSET_BASE_URL, when explicitly set for this build
//   - preview, ordinary  -> this deployment's OWN unique host (VERCEL_URL)
//   - fallback           -> SHOPIFY_APP_URL, only if VERCEL_URL is somehow
//                           unavailable (shouldn't happen on Vercel)
//
// VERCEL_URL wins for every ORDINARY preview deployment, full stop — a
// disposable feature-branch preview that loaded its JS bundles from the
// shared staging alias instead of its own host would hydrate the client
// router against a DIFFERENT deployment's route manifest. A route that
// exists on this branch but not on whatever is currently live on the shared
// alias (e.g. /admin/naia/customers/:id/styleme/:sessionId) would then be
// unrecognised by that mismatched client bundle, which can bounce the
// browser back to that other build's root — the exact "unique preview
// redirects to shared staging" bug this ordering prevents.
//
// ASSET_BASE_URL is the one deliberate exception, and must be checked BEFORE
// VERCEL_URL, not after (2026-10-20) — VERCEL_URL is set on every Vercel
// deployment without exception, so a check ordered the other way around
// means ASSET_BASE_URL can never actually take effect. It exists only for
// the one preview deployment the shared alias is deliberately pinned to
// (set as a branch-scoped Preview env var for that branch only) — that
// deployment's own unique host sits behind Vercel Authentication, so its
// assets must instead be served from the alias visitors are actually on.
// Every other, disposable feature-branch preview never sets this and keeps
// the ordinary VERCEL_URL isolation above.
export function resolveAssetBase(env) {
  if (env.VERCEL_ENV === "production") {
    return env.SHOPIFY_APP_URL ? `${env.SHOPIFY_APP_URL}/` : "/";
  }
  if (env.VERCEL_ENV === "preview" && env.ASSET_BASE_URL) {
    return `${env.ASSET_BASE_URL}/`;
  }
  if (env.VERCEL_ENV === "preview" && env.VERCEL_URL) {
    return `https://${env.VERCEL_URL}/`;
  }
  return env.SHOPIFY_APP_URL
    ? `${env.SHOPIFY_APP_URL}/`
    : "/";
}

const assetBase = resolveAssetBase(process.env);

export default defineConfig({
  base: assetBase,
  server: {
    allowedHosts: [host],
    cors: { preflightContinue: true },
    port: Number(process.env.PORT || 3000),
    hmr: hmrConfig,
    fs: { allow: ["app", "node_modules"] },
  },
  plugins: [reactRouter(), tsconfigPaths()],
  build: { assetsInlineLimit: 0 },
  ssr: { external: ["canvas"] },
  environments: {
    ssr: { build: { rollupOptions: { external: ["canvas"] } } },
  },
  optimizeDeps: { include: ["@shopify/app-bridge-react"] },
});