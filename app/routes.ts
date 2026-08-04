import type { RouteConfig } from "@react-router/dev/routes";
import { flatRoutes } from "@react-router/fs-routes";
import { route } from "@react-router/dev/routes";

export default [
  ...await flatRoutes(),
  route("quick-style", "./routes/quick-style/_index.tsx"),
  route("onboarding/step/:step", "./routes/onboarding/step.$step.tsx"),
  route("onboarding/complete", "./routes/onboarding/complete.tsx"),
  route("style-me", "./routes/style-me/_index.tsx"),
  route("style-me/comfort", "./routes/style-me/comfort.tsx"),
  route("style-me/result", "./routes/style-me/result.tsx"),
  route("full-style-profile", "./routes/full-style-profile/_index.tsx"),
  route("trends/:slug/lens/:lens", "./routes/trends.$slug.lens.$lens.tsx"),
  route("api/recommendation-feedback", "./routes/api.recommendation-feedback.tsx"),
  route("api/post-wear-review", "./routes/api.post-wear-review.tsx"),
  // These routes are skipped by flatRoutes() due to implicit parent collision between
  // my-naia._index.tsx and my-naia.saved.tsx (no my-naia.tsx layout file exists).
  // Registering them explicitly guarantees they appear in the route manifest.
  route("my-naia", "./routes/my-naia._index.tsx"),
  route("my-naia/saved", "./routes/my-naia.saved.tsx"),
  route("my-naia-model", "./routes/my-naia-model.tsx"),
  route("settings", "./routes/settings.tsx"),
  route("post-wear-review", "./routes/post-wear-review.tsx"),
  route("passport", "./routes/passport.tsx"),
  route("passport/selfie", "./routes/passport.selfie.tsx"),

] satisfies RouteConfig;
