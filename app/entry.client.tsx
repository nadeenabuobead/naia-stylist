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
      onRecoverableError(error: unknown, info: { componentStack?: string | null }) {
        // Temporary diagnostic — writes hydration errors visibly without DevTools.
        // Remove after root cause is confirmed.
        try {
          const bar = document.createElement("div");
          bar.style.cssText =
            "position:fixed;top:0;left:0;right:0;z-index:99999;" +
            "background:#8b2035;color:#fff;padding:8px 12px;" +
            "font-size:10px;font-family:monospace;word-break:break-all;white-space:pre-wrap;" +
            "max-height:60vh;overflow-y:auto";
          const e = error as any;
          const cause = e?.cause;
          const lines: string[] = [
            "NAIA HYDRATION ERROR",
            "msg: " + String(e?.message ?? error).slice(0, 300),
          ];
          if (cause) {
            lines.push("cause.msg: " + String(cause?.message ?? cause).slice(0, 300));
            if (cause?.stack) lines.push("cause.stack:\n" + String(cause.stack).slice(0, 800));
          }
          if (info?.componentStack) {
            lines.push("componentStack:\n" + info.componentStack.slice(0, 2000));
          }
          bar.textContent = lines.join("\n");
          document.body?.appendChild(bar);
        } catch (_) {}
      },
    },
  );
});
