import { startTransition, StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";

// Shopify app proxy prepends /apps/<slug> to every URL, but the server
// matches routes without that prefix.  Setting basename on
// __reactRouterContext before hydrateRoot causes createBrowserHistory to
// strip the prefix during route matching — window.location is untouched.
const m = window.location.pathname.match(/^(\/apps\/[^/]+)\//);
if (m) {
  const ctx = (
    window as Window & { __reactRouterContext?: { basename?: string } }
  ).__reactRouterContext;
  if (ctx) ctx.basename = m[1];
}

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <HydratedRouter />
    </StrictMode>,
    {
      onRecoverableError(error: unknown, _info: { componentStack?: string | null }) {
        console.error("[naia] recoverable hydration error", error);
      },
    },
  );
});
