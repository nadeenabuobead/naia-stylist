import { StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";

// ── Diagnostic markers (TEMPORARY — remove after root cause confirmed) ────────
console.log("[NAIA] NAIA_CLIENT_ENTRY_STARTED");
document.documentElement.dataset.naiaClientStarted = "true";

// Capture-phase click listener — fires before React synthetic events.
// If this logs but buttons still appear dead, React event delegation is the issue.
// If this does NOT log, something above the app is absorbing pointer events.
document.addEventListener(
  "click",
  (e) => {
    const el = e.target as Element;
    console.log(
      "[NAIA] native-click tag=" + el.tagName +
      " id=" + (el.id || "(none)") +
      " text=" + (el.textContent ?? "").trim().slice(0, 40),
    );
  },
  true, // capture phase — fires even if bubble is stopped
);
// ─────────────────────────────────────────────────────────────────────────────

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

// startTransition REMOVED for diagnostic: testing whether deferred hydration
// is the root cause of dead interactions in the Shopify Admin embedded iframe.
// React Router 7 template uses startTransition but it makes hydration low-priority
// and interruptible — App Bridge initialisation may be starving it indefinitely.
console.log("[NAIA] NAIA_HYDRATION_CALLBACK_REACHED");
try {
  hydrateRoot(
    document,
    <StrictMode>
      <HydratedRouter />
    </StrictMode>,
  );
  document.documentElement.dataset.naiaHydrated = "true";
  console.log("[NAIA] hydrateRoot invoked — watching for React errors in console");
} catch (err) {
  console.error("[NAIA] hydrateRoot threw synchronously:", err);
  document.documentElement.dataset.naiaHydrationError = String(err);
}
