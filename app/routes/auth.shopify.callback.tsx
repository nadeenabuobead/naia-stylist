import { redirect }               from "react-router";
import type { LoaderFunctionArgs }   from "react-router";
import { timingSafeEqual }           from "crypto";
import {
  getOidcConfig,
  exchangeCodeForTokens,
  validateIdToken,
  fetchCustomerGid,
  validateReturnTo,
  IdTokenValidationError,
} from "~/lib/shopify-customer-oauth.server";
import { getSession, commitSession } from "~/lib/session.server";
import {
  createNaiaSession,
  buildSessionCookieHeader,
} from "~/lib/naia-session.server";
import prisma from "~/db.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const url     = new URL(request.url);
  const session = await getSession(request.headers.get("Cookie"));

  // ── Read and immediately clear all PKCE fields from the handshake session ──
  const storedState    = session.get("pkce_state")    as string | undefined;
  const storedVerifier = session.get("pkce_verifier") as string | undefined;
  const storedNonce    = session.get("pkce_nonce")    as string | undefined;
  const returnTo       = validateReturnTo(session.get("return_to") as string | null);

  session.unset("pkce_state");
  session.unset("pkce_verifier");
  session.unset("pkce_nonce");
  session.unset("return_to");

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
    return fail(400, "Missing OAuth parameters");
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

  const redirectUri = `${process.env.SHOPIFY_APP_URL}/auth/shopify/callback`;

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
  } catch (e) {
    console.error(JSON.stringify({
      stage:     "id_token_validation",
      category:  e instanceof IdTokenValidationError ? e.category : "unknown_validation_error",
      errorName: e instanceof Error ? e.name : "Unknown",
      ...(e instanceof IdTokenValidationError && e.joseCode ? { joseCode: e.joseCode } : {}),
    }));
    return fail(400, "ID token validation failed");
  }

  // ── 8: access_token guard ──
  if (typeof tokens.access_token !== "string" || tokens.access_token.length === 0) {
    return fail(502, "No access token returned");
  }

  // ── 9: resolve verified customer GID via Customer Account API ──
  let shopifyCustomerId: string;
  try {
    shopifyCustomerId = await fetchCustomerGid(tokens.access_token);
  } catch {
    return fail(502, "Customer identity lookup failed");
  }

  // ── Resolve or create the Customer record (with staging DB diagnostics) ──
  const stagingDiag = Boolean(process.env.STAGING_SEED_SECRET);

  let customer;
  try {
    customer = await prisma.customer.findUnique({ where: { shopifyCustomerId } });
  } catch {
    if (stagingDiag) console.error(JSON.stringify({ stage: "db_op", category: "db_connection" }));
    return fail(502, "Database error");
  }

  if (!customer) {
    if (stagingDiag) console.error(JSON.stringify({ stage: "db_op", category: "customer_not_found" }));
    // No nAia profile for this Shopify customer yet — redirect to onboarding entry
    return redirect("/quick-style", {
      headers: { "Set-Cookie": clearedSessionCookie },
    });
  }

  // ── Create the nAia session ──
  let rawToken: string;
  try {
    rawToken = await createNaiaSession(customer.id, request);
  } catch {
    if (stagingDiag) console.error(JSON.stringify({ stage: "db_op", category: "session_create" }));
    return fail(502, "Session creation failed");
  }

  if (stagingDiag) console.error(JSON.stringify({ stage: "db_op", category: "success" }));

  const headers = new Headers();
  headers.append("Set-Cookie", clearedSessionCookie);
  headers.append("Set-Cookie", buildSessionCookieHeader(rawToken));

  return redirect(returnTo, { headers });
}
