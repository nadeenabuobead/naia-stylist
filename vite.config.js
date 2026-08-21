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

const host = new URL(process.env.SHOPIFY_APP_URL || "http://localhost").hostname;
let hmrConfig;

if (host === "localhost") {
  hmrConfig = { protocol: "ws", host: "localhost", port: 64999, clientPort: 64999 };
} else {
  hmrConfig = { protocol: "wss", host: host, port: parseInt(process.env.FRONTEND_PORT) || 8002, clientPort: 443 };
}

// For Vercel preview branch deployments SHOPIFY_APP_URL points to the
// main-branch auto-alias, which won't have new-hash assets from the feature
// branch. Normally we use the deployment-specific VERCEL_URL so the browser
// fetches assets from the same build that served the HTML.
// Exception: if ASSET_BASE_URL is set (staging project env), use it so that
// assets are served from the canonical staging alias rather than the
// deployment-specific URL (which sits behind its own Vercel SSO gate).
const assetBase = (() => {
  if (process.env.ASSET_BASE_URL) {
    return `${process.env.ASSET_BASE_URL}/`;
  }
  if (process.env.VERCEL_ENV === "preview" && process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}/`;
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