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
// before anything is trusted.
//
// Single-use, not just time-boxed (2026-10-20): the session this points at
// was created with only a 60-second life. promoteHandoffSession extends it
// to the normal 30 days, but the WHERE clause backing that update only
// matches while expiresAt is still that exact original short value — the
// first successful call moves it, so a second call (replay, from the same
// browser or a different one, including a race between two concurrent
// attempts) always matches zero rows and fails. This is a single atomic
// database statement, not a read-then-write check, so it cannot be raced.
import { redirect, type LoaderFunctionArgs } from "react-router";
import { getSession } from "~/lib/session.server";
import { buildSessionCookieHeader, promoteHandoffSession } from "~/lib/naia-session.server";
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

  // The single-use check — see promoteHandoffSession's own comment. A
  // false here means: already consumed (replay), the row was never
  // created, or it genuinely expired — every case fails the same way.
  const promoted = await promoteHandoffSession(rawToken, expiresAt);
  if (!promoted) {
    return redirect("/auth/shopify/login");
  }

  return redirect(returnTo, {
    headers: { "Set-Cookie": buildSessionCookieHeader(rawToken) },
  });
}
