import type { ActionFunctionArgs } from "react-router";
import { redirect }                 from "react-router";
import { destroySessionAndGetHint, buildClearSessionCookieHeader } from "~/lib/naia-session.server";
import { getOidcConfig, buildProviderLogoutUrl } from "~/lib/shopify-customer-oauth.server";

// POST /auth/logout
// Requires a <form method="post" action="/auth/logout"> — not a GET link.
// Using an action (POST) prevents logout-via-prefetch or link-following.

export async function action({ request }: ActionFunctionArgs) {
  const clearCookieHeaders = { "Set-Cookie": buildClearSessionCookieHeader() };

  // Sign Out must never surface a server error to the customer, no matter
  // what fails underneath. destroySessionAndGetHint already fails safe on
  // its own (never throws — see naia-session.server.ts), but this is the
  // final backstop for anything else that could go wrong in this block: a
  // live DB outage took this exact path down with an uncaught exception
  // once already (destroySessionAndGetHint's old findUnique had no
  // try/catch). Whatever happens inside, the one outcome that matters to
  // the customer — cookie cleared, landing on /auth/signed-out — is always
  // what gets returned.
  try {
    // Read the session's stored Shopify id_token hint while destroying it
    // (a single delete-and-select — see destroySessionAndGetHint). Local
    // logout has already fully happened by the time this returns,
    // regardless of what idTokenHint turns out to be.
    const idTokenHint = await destroySessionAndGetHint(request);

    // Provider (RP-initiated) logout is best-effort on top of the local
    // logout above — OIDC discovery failing, or there being no stored hint
    // (an older session, or a DB failure that destroySessionAndGetHint
    // already absorbed), must never block Sign Out. Both collapse to the
    // same safe fallback: go straight to /auth/signed-out. Never fabricate
    // a hint to force this path — a provider logout is only ever attempted
    // with a hint actually read back from this session's own row.
    let providerLogoutUrl: string | null = null;
    if (idTokenHint) {
      try {
        const oidcConfig = await getOidcConfig();
        // The already-approved staging logout URL (shopify.app.staging.toml's
        // [customer_authentication].logout_urls) — reusing it, rather than
        // registering /auth/signed-out itself, avoids a separate Shopify app
        // config deploy. Its own GET loader below terminates at
        // /auth/signed-out without re-triggering provider logout.
        const postLogoutRedirectUri = `${new URL(request.url).origin}/auth/logout`;
        providerLogoutUrl = buildProviderLogoutUrl(oidcConfig.end_session_endpoint, idTokenHint, postLogoutRedirectUri);
      } catch {
        providerLogoutUrl = null;
      }
    }

    // Never the raw Shopify store domain, and never straight into
    // /auth/shopify/login — that route, with no existing nAia session,
    // immediately starts a fresh Shopify OAuth authorization, which (absent
    // the provider logout above) would silently re-authenticate whichever
    // account the browser's own Shopify session still belongs to.
    return redirect(providerLogoutUrl ?? "/auth/signed-out", { headers: clearCookieHeaders });
  } catch (error) {
    console.error("auth.logout action failed unexpectedly — still signing out locally:", error);
    return redirect("/auth/signed-out", { headers: clearCookieHeaders });
  }
}

// GET /auth/logout serves two purposes:
//  1. Direct navigation to /auth/logout (no session to destroy on a GET).
//  2. The approved post_logout_redirect_uri Shopify's end_session_endpoint
//     returns the browser to once IT has ended its own session. Either way
//     this must terminate at the stable /auth/signed-out landing, never
//     re-read a session or re-initiate provider logout — a GET has no
//     session to read a hint from, and doing so here would risk looping
//     straight back into the same provider-logout redirect.
export async function loader() {
  return redirect("/auth/signed-out");
}
