import type { RouteConfig } from "@react-router/dev/routes";
import { flatRoutes } from "@react-router/fs-routes";
import { route } from "@react-router/dev/routes";

export default [
  ...flatRoutes(),
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
  // Explicit registrations for routes flatRoutes() fails to discover
  route("api/analyze-item", "./routes/api.analyze-item.jsx"),
  route("api/cloudinary-signature", "./routes/api.cloudinary-signature.jsx"),
  route("api/customer-account-identity", "./routes/api.customer-account-identity.jsx"),
  route("api/designer-dashboard", "./routes/api.designer-dashboard.jsx"),
  route("api/seed-staging", "./routes/api.seed-staging.jsx"),
  route("api/stats", "./routes/api.stats.jsx"),
  route("api/track_event", "./routes/api.track_event.jsx")
] satisfies RouteConfig;
