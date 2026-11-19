// 2026-11-16 security hotfix: api.outfit-history.jsx and api.outfit-rating.jsx
// previously sent "Access-Control-Allow-Origin: *" on every response. CORS
// does not gate the server from processing a request or returning data over
// the wire — it only controls which websites' JavaScript, running in a
// user's browser, may read the response. A wildcard here means that if a
// customer's token were ever obtained by a malicious page (e.g. via an XSS
// bug elsewhere, or a leaked token), that page could read these endpoints'
// responses directly from the victim's browser. Replaced with an allowlist
// of the storefront domains this app's own auth architecture actually
// trusts.
//
// Traced, not guessed: extensions/naia-storefront/assets/naia-stylist.js
// (the theme script running ON the merchant's storefront) calls this app's
// api/customer-auth cross-origin, then does a FULL PAGE NAVIGATION to
// /stylist?naia_token=... — and /stylist (app/routes/stylist.jsx) is a
// same-origin redirect to /style-me. That means the actual StyleMe flow,
// including outfit-history/outfit-rating, runs same-origin on
// naia-stylist.vercel.app once the user lands there; no direct evidence
// was found of anything calling these two routes cross-origin today. The
// allowlist below is the one real external origin pair this app's
// architecture is confirmed to trust anywhere (production storefront +
// the documented staging test store, see reference-infra), included as a
// conservative margin in case another caller exists that wasn't found —
// not the unrestricted wildcard it replaces, and not a new guess.
//
// A prior version of this file guessed app/lib/storefront-config.ts's
// STOREFRONT_ORIGIN (nadine-storefront.vercel.app) — that constant is
// explicitly scoped to Trend Reports navigation only, a different feature,
// and was the wrong origin for these routes. Corrected before this PR was
// pushed for review.
//
// Fails closed: an Origin that isn't on the allowlist gets NO
// Access-Control-Allow-Origin header at all (never a wildcard fallback), so
// an unapproved origin's JavaScript cannot read the response. A same-origin
// request, or a non-browser caller (curl, server-to-server), is unaffected
// either way — CORS headers are irrelevant to those.
//
// 2026-11-19 — extended to 6 more authenticated customer-facing routes found
// with the same unconditional wildcard, during a follow-up audit of this
// hotfix's own scope (api.closet.jsx, api.confidence-dashboard.jsx,
// api.customer-profile.jsx, api.track_event.jsx, api.wishlist.jsx; a 6th,
// api.wardrobe-insights.jsx, exists only on main/production, not on this
// trunk lineage — see that commit's own message). Each needs its own
// allowed-methods set (GET-only, POST-only, or GET+POST+DELETE depending on
// the route), so `methods` is now an optional parameter — every existing
// caller that doesn't pass it keeps the exact same "GET, POST, OPTIONS" it
// already had, unchanged.

const ALLOWED_ORIGINS = [
  "https://naiabynadine.com", // production Shopify storefront
  "https://naia-test-store.myshopify.com", // staging Shopify test store
];

export function buildCorsHeaders(request: Request, methods: string = "GET, POST, OPTIONS"): Record<string, string> {
  const origin = request.headers.get("Origin");
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": methods,
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Vary"] = "Origin";
  }
  return headers;
}
