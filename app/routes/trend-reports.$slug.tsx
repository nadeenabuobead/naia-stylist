// Serves /trend-reports/:slug at the same path used by the storefront proxy.
// Re-exports the loader, meta, and component from the canonical trends slug route
// so the Vercel rewrite (storefront → naia-stylist) sees a matching Remix route
// and hydration succeeds (browser URL matches the route path).
export { loader, meta, default } from "./trends.$slug.tsx";
