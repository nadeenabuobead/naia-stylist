import type { RouteConfig } from "@react-router/dev/routes";
import { flatRoutes } from "@react-router/fs-routes";
import { route } from "@react-router/dev/routes";

const _discovered = await flatRoutes();

throw new Error("DIAG:" + JSON.stringify(_discovered.map((r: any) => r.id ?? r.file)));

// Exclude routes registered explicitly below to prevent duplicate-id errors
// if flatRoutes() happens to discover the same files in some build contexts.
const _explicitIds = new Set([
  "routes/account",
  "routes/api.analyze-item",
  "routes/api.cloudinary-signature",
  "routes/api.customer-account-identity",
  "routes/api.designer-dashboard",
  "routes/api.seed-staging",
  "routes/api.stats",
  "routes/api.track_event",
]);

const _fromFlat = _discovered.filter((r: { id?: string }) => !_explicitIds.has(r.id ?? ""));

export default [
  ..._fromFlat,
  // Registered without leading "./" so Vite generates client stubs for these routes.
  route("account", "routes/account.jsx"),
  route("api/analyze-item", "routes/api.analyze-item.jsx"),
  route("api/cloudinary-signature", "routes/api.cloudinary-signature.jsx"),
  route("api/customer-account-identity", "routes/api.customer-account-identity.jsx"),
  route("api/designer-dashboard", "routes/api.designer-dashboard.jsx"),
  route("api/seed-staging", "routes/api.seed-staging.jsx"),
  route("api/stats", "routes/api.stats.jsx"),
  route("api/track_event", "routes/api.track_event.jsx"),
  // Subdirectory routes flatRoutes() cannot discover; these have real UI code
  // so they compile via the import graph regardless of the "./" prefix.
  route("quick-style", "./routes/quick-style/_index.tsx"),
  route("onboarding/step/:step", "./routes/onboarding/step.$step.tsx"),
  route("onboarding/complete", "./routes/onboarding/complete.tsx"),
  route("style-me", "./routes/style-me/_index.tsx"),
  route("style-me/result", "./routes/style-me/result.tsx"),
  route("full-style-profile", "./routes/full-style-profile/_index.tsx"),
] satisfies RouteConfig;
