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
//   - production  -> the canonical production app URL (SHOPIFY_APP_URL)
//   - preview     -> this deployment's OWN unique host (VERCEL_URL), always
//   - fallback    -> ASSET_BASE_URL / SHOPIFY_APP_URL, only if VERCEL_URL is
//                    somehow unavailable (shouldn't happen on Vercel)
//
// VERCEL_URL must win for every preview deployment, full stop. SHOPIFY_APP_URL
// and ASSET_BASE_URL both point at the shared staging alias
// (naia-stylist-staging.vercel.app) — if a feature-branch preview's HTML
// loaded its JS bundles from that shared host instead of its own, the client
// router would hydrate against a DIFFERENT deployment's route manifest.
// A route that exists on this branch but not on whatever is currently live
// on the shared alias (e.g. /admin/naia/customers/:id/styleme/:sessionId)
// would then be unrecognised by that mismatched client bundle, which can
// bounce the browser back to that other build's root — the exact
// "unique preview redirects to shared staging" bug this ordering prevents.
// ASSET_BASE_URL exists only for the one deployment the shared alias is
// actually pinned to, whose own assets might sit behind Vercel SSO — never
// for a disposable feature-branch preview that already has its own
// (unprotected) VERCEL_URL to serve from.
const assetBase = (() => {
  if (process.env.VERCEL_ENV === "production") {
    return process.env.SHOPIFY_APP_URL ? `${process.env.SHOPIFY_APP_URL}/` : "/";
  }
  if (process.env.VERCEL_ENV === "preview" && process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}/`;
  }
  if (process.env.ASSET_BASE_URL) {
    return `${process.env.ASSET_BASE_URL}/`;
  }
  return process.env.SHOPIFY_APP_URL
    ? `${process.env.SHOPIFY_APP_URL}/`
    : "/";
})();

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