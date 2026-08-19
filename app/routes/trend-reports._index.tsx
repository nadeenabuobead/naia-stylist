// Serves /trend-reports (landing page) via the storefront proxy.
// Re-exports the canonical trends landing component so the Vercel rewrite
// (storefront → naia-stylist /trend-reports) sees a matching Remix route
// and hydration succeeds — the browser URL matches the registered route path.
export { default } from "./trends.jsx";
