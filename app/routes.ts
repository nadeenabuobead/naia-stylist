import type { RouteConfig } from "@react-router/dev/routes";
import { flatRoutes } from "@react-router/fs-routes";
import { route } from "@react-router/dev/routes";
import { readdirSync } from "node:fs";
import { join } from "node:path";

// Await flatRoutes() so the Promise is resolved before spreading.
const _discovered = await flatRoutes();

// --- debug: remove after diagnosis ---
const _apiDiscovered = _discovered.filter((r: { file?: string }) => r.file?.includes("api.")).map((r: { file?: string }) => r.file);
console.error("[routes.ts] flatRoutes api routes (" + _apiDiscovered.length + "):", _apiDiscovered.join(", "));
try {
  const _dir = join(process.cwd(), "app", "routes");
  const _fs = readdirSync(_dir).filter(f => f.startsWith("api."));
  console.error("[routes.ts] api.* files on disk (" + _fs.length + "):", _fs.join(", "));
} catch {}
// --- end debug ---

// IDs that will be registered explicitly below — exclude them from flatRoutes spread
// to prevent "duplicate route id" errors if await flatRoutes() now discovers them too.
const _explicitIds = new Set([
  "routes/account", "routes/buyskip._index", "routes/closet._index",
  "routes/quick-style/_index", "routes/trends", "routes/onboarding/step.$step",
  "routes/onboarding/complete", "routes/style-me/_index", "routes/style-me/result",
  "routes/full-style-profile/_index", "routes/api.analyze-item",
  "routes/api.cloudinary-signature", "routes/api.customer-account-identity",
  "routes/api.designer-dashboard", "routes/api.seed-staging",
  "routes/api.stats", "routes/api.track_event",
]);
const _fromFlat = _discovered.filter((r: { id?: string }) => !_explicitIds.has(r.id ?? ""));
console.error("[routes.ts] after dedup, flatRoutes contributes:", _fromFlat.length, "routes");

export default [
  ..._fromFlat,
  route("account", "./routes/account.jsx"),
  route("buyskip", "./routes/buyskip._index.tsx"),
  route("closet", "./routes/closet._index.tsx"),
  route("quick-style", "./routes/quick-style/_index.tsx"),
  route("trends", "./routes/trends.jsx"),
  route("onboarding/step/:step", "./routes/onboarding/step.$step.tsx"),
  route("onboarding/complete", "./routes/onboarding/complete.tsx"),
  route("style-me", "./routes/style-me/_index.tsx"),
  route("style-me/result", "./routes/style-me/result.tsx"),
  route("full-style-profile", "./routes/full-style-profile/_index.tsx"),
  route("api/analyze-item", "./routes/api.analyze-item.jsx"),
  route("api/cloudinary-signature", "./routes/api.cloudinary-signature.jsx"),
  route("api/customer-account-identity", "./routes/api.customer-account-identity.jsx"),
  route("api/designer-dashboard", "./routes/api.designer-dashboard.jsx"),
  route("api/seed-staging", "./routes/api.seed-staging.jsx"),
  route("api/stats", "./routes/api.stats.jsx"),
  route("api/track_event", "./routes/api.track_event.jsx"),
] satisfies RouteConfig;
