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
  } catch {
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

  return redirect(finalReturnTarget, { headers });
}
