import type { RouteConfig } from "@react-router/dev/routes";
import { flatRoutes } from "@react-router/fs-routes";
import { route } from "@react-router/dev/routes";

export default [
  ...flatRoutes(),
  route("account", "./routes/account.jsx")
] satisfies RouteConfig;
