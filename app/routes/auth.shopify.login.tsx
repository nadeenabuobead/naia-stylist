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

  return redirect(authUrl, {
    headers: { "Set-Cookie": await commitSession(session) },
  });
}
