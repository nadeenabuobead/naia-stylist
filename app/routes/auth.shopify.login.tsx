import { redirect }           from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import {
  getOidcConfig,
  generatePkceBundle,
  buildAuthorizationUrl,
  validateReturnTo,
  validateOriginHost,
  shouldBounceToStorefront,
} from "~/lib/shopify-customer-oauth.server";
import { getSession, commitSession } from "~/lib/session.server";
import { resolveNaiaSession, buildHandoffNonceCookie } from "~/lib/naia-session.server";

// A SHA-256 hex digest — the exact, fixed shape buildHandoffNonceCookie's
// hash always produces. Anything else is not a value this app generated,
// so there is no reason to carry it any further through the flow.
function validateNonceHash(raw: string | null): string | null {
  if (!raw) return null;
  return /^[a-f0-9]{64}$/i.test(raw) ? raw : null;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url        = new URL(request.url);
  const returnTo   = validateReturnTo(url.searchParams.get("return_to"));
  const originHost = validateOriginHost(url.searchParams.get("origin_host"));
  const originNonceHash = validateNonceHash(url.searchParams.get("origin_nonce_hash"));
  // The absolute target to land on once auth succeeds — the originating
  // preview host + the relative return path, when one was captured and
  // validated; otherwise the existing relative-path behavior (stays on
  // whichever host serves this response, unchanged from before this fix).
  const finalReturnTarget = originHost ? `https://${originHost}${returnTo}` : returnTo;

  // When STOREFRONT_HOST is configured, the PKCE cookie must be set on the
  // storefront domain — because that is where Shopify will send the callback.
  //
  // The _sf=1 query flag indicates the request already arrived via the storefront
  // proxy (set either by requireCurrentNaiaCustomer or by the single redirect below).
  // Without it, redirect the browser to the storefront login once so the Vercel
  // proxy can forward the response and the browser commits the cookie on the
  // storefront domain. Relying on X-Forwarded-Host is not viable: Vercel does not
  // reliably forward that header in inter-project rewrites, and using it caused
  // an infinite redirect loop when the proxy re-requested the same URL internally.
  //
  // shouldBounceToStorefront also refuses this hop when the request has
  // already arrived on STOREFRONT_HOST itself — otherwise this would
  // redirect a request to the exact host it is already on (a no-op at best),
  // or, with a stale STOREFRONT_HOST value pointing at a different, defunct
  // host, silently strand both login AND logout on that other host instead
  // of the one actually serving this request.
  const storefrontHost = process.env.STOREFRONT_HOST ?? "";
  if (shouldBounceToStorefront(url.hostname, storefrontHost, url.searchParams.has("_sf"))) {
    const sfLogin = new URL(`https://${storefrontHost}/auth/shopify/login`);
    sfLogin.searchParams.set("return_to", returnTo);
    sfLogin.searchParams.set("_sf", "1");
    const bounceHeaders = new Headers();
    if (originHost) {
      sfLogin.searchParams.set("origin_host", originHost);
      // This request never carried _sf=1, so requireCurrentNaiaCustomer's
      // own nonce-setting never ran for it — mint one fresh here, on this
      // (the originating) host, before bouncing away. Any origin_nonce_hash
      // already on the incoming URL is ignored and overwritten: the only
      // legitimate source of that param is the cookie this exact branch is
      // about to set, so one arriving without it is not trustworthy.
      const nonce = buildHandoffNonceCookie();
      bounceHeaders.append("Set-Cookie", nonce.cookieHeader);
      sfLogin.searchParams.set("origin_nonce_hash", nonce.nonceHash);
    }
    return redirect(sfLogin.toString(), { status: 302, headers: bounceHeaders });
  }

  // If caller already has a valid nAia session skip OAuth entirely
  const existing = await resolveNaiaSession(request);
  if (existing) return redirect(finalReturnTarget);

  const oidcConfig   = await getOidcConfig();
  const pkce         = generatePkceBundle();
  // All customer-facing auth flows through the storefront Vercel proxy.
  // The PKCE cookie is set on the storefront domain (via proxy Set-Cookie
  // forwarding). STOREFRONT_HOST makes redirect_uri point back to the storefront
  // so Shopify sends the browser there and the cookie arrives with the callback.
  const callbackOrigin = storefrontHost
    ? `https://${storefrontHost}`
    : process.env.SHOPIFY_APP_URL!.replace(/\/$/, "");
  const redirectUri  = `${callbackOrigin}/auth/shopify/callback`;
  const authUrl      = buildAuthorizationUrl(oidcConfig, pkce, redirectUri);

  // Store PKCE values in the HMAC-signed handshake cookie only
  const session = await getSession(request.headers.get("Cookie"));
  session.set("pkce_verifier", pkce.codeVerifier);
  session.set("pkce_state",    pkce.state);
  session.set("pkce_nonce",    pkce.nonce);
  session.set("return_to",     returnTo);
  if (originHost) session.set("origin_host", originHost);
  if (originHost && originNonceHash) session.set("origin_nonce_hash", originNonceHash);

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
