import type { RouteConfig } from "@react-router/dev/routes";
import { flatRoutes } from "@react-router/fs-routes";
import { route } from "@react-router/dev/routes";

export default [
  ...await flatRoutes(),
  route("quick-style", "./routes/quick-style/_index.tsx"),
  route("onboarding/step/:step", "./routes/onboarding/step.$step.tsx"),
  route("onboarding/complete", "./routes/onboarding/complete.tsx"),
  route("style-me", "./routes/style-me/_index.tsx"),
  route("style-me/result", "./routes/style-me/result.tsx"),
  route("full-style-profile", "./routes/full-style-profile/_index.tsx"),
] satisfies RouteConfig;
