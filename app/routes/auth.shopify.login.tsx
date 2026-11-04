// app/routes/auth.shopify.login.tsx
//
// SUPERSEDED (2026-11-04) — Clerk is now nAia's primary customer-auth
// provider. This route no longer initiates the Shopify Customer Account
// OIDC/PKCE flow; it forwards to /sign-in, preserving return_to, so every
// existing hardcoded link/redirect to this URL across the app (closet,
// Passport, Buy or Skip, StyleMe, etc. — 11 call sites as of this cutover)
// keeps working with no per-call-site changes needed.
//
// The full OAuth implementation this loader used to run — PKCE handshake,
// cross-domain preview handoff via STOREFRONT_HOST, the Safari
// bounce-tracking 200+JS-redirect workaround — is NOT deleted. It moved
// nowhere; it simply stops being reachable from here, same SUPERSEDED
// posture as naia-session.server.ts's own banner comment. auth.shopify.
// callback.tsx and auth.shopify.handoff.tsx are untouched and still contain
// that real implementation, now unreachable in normal operation since
// nothing links here to start a fresh attempt — kept exactly as paused, per
// instruction, not resumed and not removed.
//
// This does not affect NADINE (nAia's Shopify retail storefront) or the
// Shopify embedded-admin app in any way — both are architecturally separate
// from this customer-login stack (verified 2026-11-04): NADINE's own
// product-intelligence code imports ~/lib/session.server and
// ~/shopify.server, never naia-session.server.ts or this route; the
// storefront's customer-facing personalization uses a third, independent
// path (api.customer-auth.jsx's own JWT verification via Shopify's App
// Proxy, unrelated to either).

import { redirect } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { validateReturnTo } from "~/lib/shopify-customer-oauth.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const returnTo = validateReturnTo(url.searchParams.get("return_to"));
  return redirect(`/sign-in?return_to=${encodeURIComponent(returnTo)}`);
}
