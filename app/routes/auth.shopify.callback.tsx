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
import {
  usableName,
  resolveNameUpdate,
  usableEmail,
  resolveEmailUpdate,
  isEmailUniqueConstraintViolation,
} from "~/lib/shopify-customer-name-sync.server";
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
  // The browser-binding nonce hash captured in auth.shopify.login — carried
  // through so the handoff can demand the matching raw cookie be presented
  // by whoever redeems it. See naia-session.server.ts's
  // buildHandoffNonceCookie/verifyHandoffNonce for what this protects
  // against.
  const originNonceHash = session.get("origin_nonce_hash") as string | undefined;
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
  session.unset("origin_nonce_hash");

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

  // ── 9: resolve customer identity (GID, cryptographically verified; name + email, as on file) via Customer Account API ──
  let shopifyProfile: {
    customerId: string;
    firstName:  string | null;
    lastName:   string | null;
    email:      string | null;
  };
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
    // plus firstName/lastName/email from the same Customer Account API response, if usable.
    const emailAtCreate = usableEmail(shopifyProfile.email);
    try {
      customer = await prisma.customer.create({
        data: {
          shopifyCustomerId,
          firstName: usableName(shopifyProfile.firstName),
          lastName:  usableName(shopifyProfile.lastName),
          email:     emailAtCreate,
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
        // Re-read found nothing, so the collision wasn't the shopifyCustomerId
        // race above. Confirm via the error's own meta.target — not just by
        // elimination — that this was specifically the email unique
        // constraint before dropping email and retrying; any other cause is
        // a genuinely unrelated database error and must fail loudly, not be
        // silently reinterpreted as an email collision.
        if (!customer && emailAtCreate && isEmailUniqueConstraintViolation(err)) {
          try {
            customer = await prisma.customer.create({
              data: {
                shopifyCustomerId,
                firstName: usableName(shopifyProfile.firstName),
                lastName:  usableName(shopifyProfile.lastName),
              },
            });
          } catch {
            return fail(502, "Database error");
          }
        }
        if (!customer) return fail(502, "Database error");
      } else {
        return fail(502, "Database error");
      }
    }
  }

  // ── Sync name + email from Shopify on every successful login ──
  // Never overwrites an existing usable local value with a null/blank
  // Shopify value. A failure here is non-fatal — login proceeds regardless.
  const nameUpdate  = resolveNameUpdate(
    { firstName: shopifyProfile.firstName, lastName: shopifyProfile.lastName },
    { firstName: customer.firstName,       lastName: customer.lastName },
  );
  const emailUpdate = resolveEmailUpdate(shopifyProfile.email, customer.email);
  const profileUpdate = { ...nameUpdate, ...emailUpdate };
  if (Object.keys(profileUpdate).length > 0) {
    try {
      customer = await prisma.customer.update({ where: { id: customer.id }, data: profileUpdate });
    } catch (err) {
      // Non-fatal — login must never fail over a profile-sync write. Retry
      // with the name-only subset ONLY when the error's own meta.target
      // confirms this was specifically an email collision (never inferred
      // just from "we happened to include email in this write") — any other
      // cause falls through unretried rather than being mis-handled as one.
      if (
        isEmailUniqueConstraintViolation(err) &&
        "email" in emailUpdate &&
        Object.keys(nameUpdate).length > 0
      ) {
        try {
          customer = await prisma.customer.update({ where: { id: customer.id }, data: nameUpdate });
        } catch {
          // Non-fatal — proceed with the previously-resolved customer record.
        }
      }
    }
  }

  const headers = new Headers();
  headers.append("Set-Cookie", clearedSessionCookie);

  // Cross-domain handoff (2026-10-20): a cookie set in this response is
  // scoped to THIS domain (the storefront host) — it is never sent to
  // originHost, a different domain by definition. Previously this redirect
  // went straight to finalReturnTarget with the normal cookie set here,
  // landing the browser on originHost with no session at all: the app saw
  // "not authenticated," bounced back to login, Shopify silently
  // re-approved the already-authenticated identity, and the cycle
  // repeated — ERR_TOO_MANY_REDIRECTS. Never reachable in production
  // (originHost is only ever set for a preview host, see
  // validateOriginHost), so this never touches today's normal, working
  // flow — confirmed by the else branch below being byte-identical to
  // before this fix.
  //
  // Fix: the session created for this case starts with a short (60s)
  // expiry rather than the normal 30 days, and only a tamper-proof,
  // short-lived handoff value (not the raw session token itself) travels
  // in the URL — built with the exact same signed-cookie machinery already
  // used for the PKCE handshake (session.server.ts, SESSION_SECRET), no
  // new secret. /auth/shopify/handoff calls promoteHandoffSession to
  // extend the session to its normal full length, but only once, ever,
  // enforced by a single atomic database statement — a captured handoff
  // URL cannot be replayed afterward, from the same browser or a
  // different one, and no long-lived cookie is ever set on the storefront
  // host for this case at all.
  //
  // Browser-binding (2026-10-20): single-use stops a SECOND redemption,
  // but not a race to be FIRST — without originNonceHash, any client that
  // merely has this URL could redeem it ahead of the real browser. If the
  // nonce somehow never made it this far (a malformed or forged request
  // that skipped auth.shopify.login entirely), that is treated the same
  // as any other broken handoff attempt: refuse to create one at all.
  if (originHost) {
    if (!originNonceHash) {
      return fail(400, "Missing browser-binding nonce");
    }

    const HANDOFF_PENDING_MS = 60_000;
    const pendingExpiresAt = new Date(Date.now() + HANDOFF_PENDING_MS);

    let rawToken: string;
    try {
      rawToken = await createNaiaSession(customer.id, request, tokens.id_token, pendingExpiresAt);
    } catch {
      return fail(502, "Session creation failed");
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
    return redirect(handoffUrl.toString(), { headers });
  }

  // ── Create the nAia session (unchanged from before this fix) ──
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
  headers.append("Set-Cookie", buildSessionCookieHeader(rawToken));

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
