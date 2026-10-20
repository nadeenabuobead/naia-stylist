import { redirect }               from "react-router";
import type { LoaderFunctionArgs }   from "react-router";
import { timingSafeEqual }           from "crypto";
import {
  getOidcConfig,
  exchangeCodeForTokens,
  validateIdToken,
  fetchCustomerProfile,
  validateReturnTo,
  validateOriginHost,
} from "~/lib/shopify-customer-oauth.server";
import { usableName, resolveNameUpdate } from "~/lib/shopify-customer-name-sync.server";
import { getSession, commitSession } from "~/lib/session.server";
import {
  createNaiaSession,
  buildSessionCookieHeader,
} from "~/lib/naia-session.server";
import prisma from "~/db.server";
import { Prisma } from "@prisma/client";

export async function loader({ request }: LoaderFunctionArgs) {
  const url     = new URL(request.url);
  const session = await getSession(request.headers.get("Cookie"));

  // ── Read and immediately clear all PKCE fields from the handshake session ──
  const storedState    = session.get("pkce_state")    as string | undefined;
  const storedVerifier = session.get("pkce_verifier") as string | undefined;
  const storedNonce    = session.get("pkce_nonce")    as string | undefined;
  const returnTo       = validateReturnTo(session.get("return_to") as string | null);
  // Re-validated here too (defense in depth), even though it already passed
  // through this same check on the way into the signed session in
  // auth.shopify.login — see validateOriginHost for why this can only ever
  // be this app's own preview host, the storefront host, or the canonical
  // app host, never an arbitrary external one.
  const originHost     = validateOriginHost(session.get("origin_host") as string | null);
  // The final redirect target: back to the preview that actually started
  // this flow when one was captured, otherwise the existing relative-path
  // behavior (stays on whichever host serves this callback — unchanged for
  // production and for flows that started on the storefront host itself).
  const finalReturnTarget = originHost ? `https://${originHost}${returnTo}` : returnTo;

  session.unset("pkce_state");
  session.unset("pkce_verifier");
  session.unset("pkce_nonce");
  session.unset("return_to");
  session.unset("origin_host");

  const clearedSessionCookie = await commitSession(session);

  // Helper: fail cleanly — always clears PKCE state
  const fail = (status: number, message: string) =>
    new Response(message, {
      status,
      headers: { "Set-Cookie": clearedSessionCookie },
    });

  // ── OAuth error from Shopify (user denied, etc.) ──
  const oauthError = url.searchParams.get("error");
  if (oauthError) {
    return redirect(`/auth/shopify/login`, {
      headers: { "Set-Cookie": clearedSessionCookie },
    });
  }

  const code  = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  // ── Validate all required parameters present ──
  if (!code || !state || !storedState || !storedVerifier || !storedNonce) {
    // TEMP DIAGNOSTIC — visible in browser, remove after root-cause confirmed
    const diag = {
      hasCode: !!code,
      hasState: !!state,
      hasStoredState: !!storedState,
      hasStoredVerifier: !!storedVerifier,
      hasStoredNonce: !!storedNonce,
      hasCookieHeader: !!request.headers.get("Cookie"),
      cookieHeaderLen: request.headers.get("Cookie")?.length ?? 0,
      requestHost: url.hostname,
    };
    return new Response(
      `Missing OAuth parameters\n\n${JSON.stringify(diag, null, 2)}`,
      { status: 400, headers: { "Set-Cookie": clearedSessionCookie } }
    );
  }

  // ── 1: state — timing-safe comparison ──
  let stateMatch = false;
  try {
    stateMatch =
      state.length === storedState.length &&
      timingSafeEqual(Buffer.from(state, "utf8"), Buffer.from(storedState, "utf8"));
  } catch {
    stateMatch = false;
  }
  if (!stateMatch) return fail(400, "State mismatch");

  // ── Fetch OIDC configuration ──
  let oidcConfig;
  try {
    oidcConfig = await getOidcConfig();
  } catch {
    return fail(502, "Could not reach Shopify OIDC configuration");
  }

  // Must exactly match the redirect_uri sent in the authorization request.
  // Mirrors the same STOREFRONT_HOST logic from auth.shopify.login.
  const storefrontHost = process.env.STOREFRONT_HOST ?? "";
  const callbackOrigin = storefrontHost
    ? `https://${storefrontHost}`
    : process.env.SHOPIFY_APP_URL!.replace(/\/$/, "");
  const redirectUri = `${callbackOrigin}/auth/shopify/callback`;

  // ── 2: exchange code + code_verifier for tokens (Shopify validates PKCE) ──
  let tokens;
  try {
    tokens = await exchangeCodeForTokens(code, storedVerifier, redirectUri, oidcConfig);
  } catch (error) {
    // Diagnostic only — server-side log, never surfaced to the browser.
    // error.message already carries nothing beyond status/error/
    // error_description (see buildTokenExchangeFailureMessage); presence
    // booleans here, never the actual code/verifier/state/nonce values.
    console.error("shopify_token_exchange_failed", JSON.stringify({
      message: error instanceof Error ? error.message : String(error),
      callbackHostname: url.hostname,
      redirectUri,
      codePresent: !!code,
      codeVerifierPresent: !!storedVerifier,
      storedStatePresent: !!storedState,
      storedNoncePresent: !!storedNonce,
    }));
    return fail(502, "Token exchange failed");
  }

  // ── 3–7: validate id_token (signature, issuer, audience, expiry, max-age, nonce) ──
  try {
    await validateIdToken(tokens.id_token, storedNonce, oidcConfig);
  } catch {
    return fail(400, "ID token validation failed");
  }

  // ── 8: access_token guard ──
  if (typeof tokens.access_token !== "string" || tokens.access_token.length === 0) {
    return fail(502, "No access token returned");
  }

  // ── 9: resolve verified customer identity (GID + name) via Customer Account API ──
  let shopifyProfile: { customerId: string; firstName: string | null; lastName: string | null };
  try {
    shopifyProfile = await fetchCustomerProfile(tokens.access_token);
  } catch {
    return fail(502, "Customer identity lookup failed");
  }
  const shopifyCustomerId = shopifyProfile.customerId;

  // ── Resolve or create the Customer record ──
  let customer;
  try {
    customer = await prisma.customer.findUnique({ where: { shopifyCustomerId } });
  } catch {
    return fail(502, "Database error");
  }

  if (!customer) {
    // First-time Shopify customer — create using the already-verified shopifyCustomerId,
    // plus firstName/lastName from the same Customer Account API response, if usable.
    // email is left null; no additional token parsing needed.
    try {
      customer = await prisma.customer.create({
        data: {
          shopifyCustomerId,
          firstName: usableName(shopifyProfile.firstName),
          lastName:  usableName(shopifyProfile.lastName),
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        // Concurrent callback won the race on the unique key — re-read the row.
        try {
          customer = await prisma.customer.findUnique({ where: { shopifyCustomerId } });
        } catch {
          return fail(502, "Database error");
        }
        if (!customer) return fail(502, "Database error");
      } else {
        return fail(502, "Database error");
      }
    }
  }

  // ── Sync name from Shopify on every successful login ──
  // Never overwrites an existing usable local name with a null/blank Shopify
  // value. A failure here is non-fatal — login proceeds with the name as-is.
  const nameUpdate = resolveNameUpdate(
    { firstName: shopifyProfile.firstName, lastName: shopifyProfile.lastName },
    { firstName: customer.firstName,       lastName: customer.lastName },
  );
  if (Object.keys(nameUpdate).length > 0) {
    try {
      customer = await prisma.customer.update({ where: { id: customer.id }, data: nameUpdate });
    } catch {
      // Non-fatal — proceed with the previously-resolved customer record.
    }
  }

  // ── Create the nAia session ──
  // tokens.id_token is already validated above (validateIdToken) — stored
  // only as logout's future id_token_hint for Shopify's end_session_endpoint,
  // never logged, never returned in any loader data, never sent to the
  // client.
  let rawToken: string;
  try {
    rawToken = await createNaiaSession(customer.id, request, tokens.id_token);
  } catch {
    return fail(502, "Session creation failed");
  }

  const headers = new Headers();
  headers.append("Set-Cookie", clearedSessionCookie);
  headers.append("Set-Cookie", buildSessionCookieHeader(rawToken));

  // Cross-domain handoff (2026-10-20): the cookie just set above is scoped
  // to THIS response's domain (the storefront host) — it is never sent to
  // originHost, a different domain by definition. Previously this redirect
  // went straight to finalReturnTarget, landing the browser on originHost
  // with no session at all: the app saw "not authenticated," bounced back
  // to login, Shopify silently re-approved the already-authenticated
  // identity, and the cycle repeated — ERR_TOO_MANY_REDIRECTS. Never
  // reachable in production (originHost is only ever set for a preview
  // host, see validateOriginHost), so this never touches today's normal,
  // working flow.
  //
  // Fix: route through /auth/shopify/handoff with a short-lived (60s),
  // tamper-proof token instead of handing the browser a long-lived
  // credential in a URL. Built with the exact same signed-cookie machinery
  // already used for the PKCE handshake (session.server.ts, SESSION_SECRET)
  // — no new secret, no new database table. It carries the already-created
  // rawToken only as long as it takes the browser to follow one redirect;
  // once exchanged, the destination host has its own normal cookie and this
  // token is never consulted again. Bound to the specific originHost it was
  // issued for, so it cannot be replayed against a different destination.
  if (originHost) {
    const handoff = await getSession();
    handoff.set("handoff_raw_token", rawToken);
    handoff.set("handoff_origin_host", originHost);
    handoff.set("handoff_expires_at", Date.now() + 60_000);
    const handoffCookie = await commitSession(handoff);
    const handoffValue = extractSessionCookieValue(handoffCookie);
    const handoffUrl = new URL(`https://${originHost}/auth/shopify/handoff`);
    handoffUrl.searchParams.set("h", handoffValue);
    handoffUrl.searchParams.set("return_to", returnTo);
    return redirect(handoffUrl.toString(), { headers });
  }

  return redirect(finalReturnTarget, { headers });
}

// Pulls just the cookie's own value out of a Set-Cookie header string, so it
// can be carried in a URL query param instead of a cookie for one hop. The
// value itself is still the same signed/encrypted blob commitSession always
// produces — this does not change what's inside it or how it's verified.
function extractSessionCookieValue(setCookieHeader: string): string {
  const eq = setCookieHeader.indexOf("=");
  const semi = setCookieHeader.indexOf(";");
  return setCookieHeader.slice(eq + 1, semi === -1 ? undefined : semi);
}
