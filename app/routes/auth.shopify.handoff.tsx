// app/routes/auth.shopify.handoff.tsx
// GET /auth/shopify/handoff?h=<signed-token>&return_to=<path>
//
// The receiving end of the cross-domain handoff auth.shopify.callback.tsx
// sends the browser to when it needs to return a preview deployment that
// Vercel Authentication protects separately from the storefront host the
// Shopify OAuth round trip had to use. See the comment in that file for
// why this exists and what it replaces (a direct redirect that silently
// carried no session at all, causing ERR_TOO_MANY_REDIRECTS).
//
// `h` is a short-lived (60s), signed session-cookie value — not a cookie
// here, a URL param, because this is the one hop where the browser hasn't
// reached the destination host yet. It is verified with the exact same
// signing key and mechanism (session.server.ts, SESSION_SECRET) already
// used for the PKCE handshake, so a tampered or expired value is rejected
// before anything is trusted. On success, this sets the real, normal
// __naia_tok cookie on THIS host and redirects to the clean return path —
// the handoff value is never consulted again after this one exchange.
import { redirect, type LoaderFunctionArgs } from "react-router";
import { getSession } from "~/lib/session.server";
import { buildSessionCookieHeader } from "~/lib/naia-session.server";
import { validateReturnTo, validateOriginHost } from "~/lib/shopify-customer-oauth.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const h = url.searchParams.get("h");
  const returnTo = validateReturnTo(url.searchParams.get("return_to"));

  if (!h) {
    return redirect("/auth/shopify/login");
  }

  // Reconstruct the one cookie this value came from, so the existing signed-
  // cookie verification in session.server.ts does the actual signature
  // check — no separate crypto here to get wrong.
  const handoff = await getSession(`__naia_session=${h}`);

  const rawToken = handoff.get("handoff_raw_token") as string | undefined;
  const originHost = handoff.get("handoff_origin_host") as string | undefined;
  const expiresAt = handoff.get("handoff_expires_at") as number | undefined;

  if (!rawToken || !originHost || typeof expiresAt !== "number") {
    // Missing or failed signature verification (tampered/forged value) —
    // getSession() on an invalid signature silently returns an empty
    // session rather than throwing, so this is the fail-closed check.
    return redirect("/auth/shopify/login");
  }

  if (Date.now() > expiresAt) {
    return redirect("/auth/shopify/login");
  }

  // Bound to the exact host it was issued for — cannot be replayed to a
  // different destination even if somehow captured in transit.
  if (validateOriginHost(originHost) !== originHost || url.hostname !== originHost) {
    return redirect("/auth/shopify/login");
  }

  return redirect(returnTo, {
    headers: { "Set-Cookie": buildSessionCookieHeader(rawToken) },
  });
}
