import { redirect }           from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import {
  getOidcConfig,
  generatePkceBundle,
  buildAuthorizationUrl,
  validateReturnTo,
} from "~/lib/shopify-customer-oauth.server";
import { getSession, commitSession } from "~/lib/session.server";
import { resolveNaiaSession }        from "~/lib/naia-session.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const url      = new URL(request.url);
  const returnTo = validateReturnTo(url.searchParams.get("return_to"));

  // If caller already has a valid nAia session skip OAuth entirely
  const existing = await resolveNaiaSession(request);
  if (existing) return redirect(returnTo);

  const oidcConfig   = await getOidcConfig();
  const pkce         = generatePkceBundle();
  const redirectUri  = `${process.env.SHOPIFY_APP_URL}/auth/shopify/callback`;
  const authUrl      = buildAuthorizationUrl(oidcConfig, pkce, redirectUri);

  // Store PKCE values in the HMAC-signed handshake cookie only
  const session = await getSession(request.headers.get("Cookie"));
  session.set("pkce_verifier", pkce.codeVerifier);
  session.set("pkce_state",    pkce.state);
  session.set("pkce_nonce",    pkce.nonce);
  session.set("return_to",     returnTo);

  // Return a 200 page with a JS redirect instead of a 302.
  // Mobile Safari's bounce-tracking mitigation can drop cookies set in a
  // 302 response that immediately redirects away; a 200 + script gives the
  // browser time to commit the cookie before navigating to Shopify.
  const safeUrl = JSON.stringify(authUrl);
  return new Response(
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">`
    + `<meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<title>Signing in — nAia</title>`
    + `<style>body{margin:0;display:flex;align-items:center;justify-content:center;`
    + `min-height:100vh;font-family:-apple-system,sans-serif;background:#F6EFE8;color:#28150C;}`
    + `p{opacity:.6;font-size:1rem;}a{color:#6B1D26;font-size:.875rem;margin-top:.5rem;display:block;}</style>`
    + `</head><body><div><p>Signing in…</p><a id="l" href="">Continue →</a></div>`
    + `<script>var u=${safeUrl};document.getElementById('l').href=u;window.location.replace(u);<\/script>`
    + `</body></html>`,
    {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Set-Cookie": await commitSession(session),
      },
    }
  );
}
