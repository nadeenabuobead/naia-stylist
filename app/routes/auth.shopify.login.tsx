import { redirect }           from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import {
  getOidcConfig,
  generatePkceBundle,
  buildAuthorizationUrl,
  validateReturnTo,
  validateOriginHost,
  shouldBounceToStorefront,
  encodeOAuthState,
  generateBindingToken,
  hashBindingToken,
  OAUTH_BINDING_COOKIE_NAME,
  OAUTH_BINDING_COOKIE_MAX_AGE_SECONDS,
} from "~/lib/shopify-customer-oauth.server";
import { getSession, commitSession } from "~/lib/session.server";
import { resolveNaiaSession, buildHandoffNonceCookie, createNaiaSession } from "~/lib/naia-session.server";

// A SHA-256 hex digest — the exact, fixed shape buildHandoffNonceCookie's
// hash always produces. Anything else is not a value this app generated,
// so there is no reason to carry it any further through the flow.
function validateNonceHash(raw: string | null): string | null {
  if (!raw) return null;
  return /^[a-f0-9]{64}$/i.test(raw) ? raw : null;
}

// Pulls just the cookie's own value out of a Set-Cookie header string, so it
// can be carried in a URL query param instead of a cookie for one hop. Same
// helper as auth.shopify.callback.tsx's own copy (not shared on purpose —
// see the cross-domain handoff comment below for why these two call sites
// are kept independent rather than refactored into one).
function extractSessionCookieValue(setCookieHeader: string): string {
  const eq = setCookieHeader.indexOf("=");
  const semi = setCookieHeader.indexOf(";");
  return setCookieHeader.slice(eq + 1, semi === -1 ? undefined : semi);
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
  if (existing) {
    // Cross-domain handoff (2026-11-02): mirrors auth.shopify.callback.tsx's
    // own fix for the identical failure mode (see that file's "if
    // (originHost) {" block and its comment for the full history). A bare
    // redirect straight to finalReturnTarget sets no cookie at all on
    // originHost — a cookie set on THIS response is scoped to the host
    // serving it, never a different one — so the browser would land there
    // with no session, requireCurrentNaiaCustomer would see "not
    // authenticated," bounce back to this exact login route, find the SAME
    // already-authenticated identity here again, and repeat forever:
    // ERR_TOO_MANY_REDIRECTS. The 2026-10-20 fix covered a FRESH OAuth
    // success in auth.shopify.callback.tsx but missed this already-has-a-
    // session shortcut, which takes the identical cross-domain redirect
    // without ever reaching that fix.
    if (originHost) {
      if (!originNonceHash) {
        return new Response("Missing browser-binding nonce", { status: 400 });
      }

      const HANDOFF_PENDING_MS = 60_000;
      const pendingExpiresAt = new Date(Date.now() + HANDOFF_PENDING_MS);

      let rawToken: string;
      try {
        rawToken = await createNaiaSession(existing.id, request, undefined, pendingExpiresAt);
      } catch {
        return new Response("Session creation failed", { status: 502 });
      }

      const handoff = await getSession();
      handoff.set("handoff_raw_token", rawToken);
      handoff.set("handoff_origin_host", originHost);
      handoff.set("handoff_expires_at", pendingExpiresAt.getTime());
      handoff.set("handoff_origin_nonce_hash", originNonceHash);
      const handoffCookie = await commitSession(handoff);
      const handoffValue = extractSessionCookieValue(handoffCookie);
      const handoffUrl = new URL(`https://${originHost}/auth/shopify/handoff`);
      handoffUrl.searchParams.set("h", handoffValue);
      handoffUrl.searchParams.set("return_to", returnTo);
      return redirect(handoffUrl.toString());
    }

    return redirect(finalReturnTarget);
  }

  const oidcConfig   = await getOidcConfig();
  const pkce         = generatePkceBundle();
  // All customer-facing auth flows through the storefront Vercel proxy.
  // redirect_uri must point at the storefront so Shopify sends the browser
  // there — unchanged from before. The PKCE handshake itself no longer
  // depends on a cookie surviving that trip at all; see encodeOAuthState's
  // own comment for why.
  const callbackOrigin = storefrontHost
    ? `https://${storefrontHost}`
    : process.env.SHOPIFY_APP_URL!.replace(/\/$/, "");
  const redirectUri  = `${callbackOrigin}/auth/shopify/callback`;

  // Browser binding: a SameSite=Lax cookie (not None — see
  // generateBindingToken's comment) set alongside the state-encoded
  // handshake, purely to prove the callback is being completed by the same
  // browser that started it.
  const bindingToken = generateBindingToken();
  const state = encodeOAuthState({
    verifier: pkce.codeVerifier,
    nonce: pkce.nonce,
    returnTo,
    bindingHash: hashBindingToken(bindingToken),
    originHost: originHost ?? undefined,
    originNonceHash: originNonceHash ?? undefined,
  });
  const authUrl = buildAuthorizationUrl(oidcConfig, pkce, redirectUri, state);

  const bindingCookie = [
    `${OAUTH_BINDING_COOKIE_NAME}=${bindingToken}`,
    "Path=/auth/shopify",
    `Max-Age=${OAUTH_BINDING_COOKIE_MAX_AGE_SECONDS}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
  ].join("; ");

  return redirect(authUrl, { status: 302, headers: { "Set-Cookie": bindingCookie } });
}
