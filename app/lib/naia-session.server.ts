import { createHash, randomBytes, timingSafeEqual } from "crypto";
import prisma from "~/db.server";
import { DatabaseUnavailableError, withTransientRetry } from "./prisma-transient-retry.server";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COOKIE_NAME    = "__naia_tok";
const MAX_AGE_S      = 30 * 24 * 60 * 60;      // 30 days in seconds
const MAX_AGE_MS     = MAX_AGE_S * 1000;

// ---------------------------------------------------------------------------
// Token helpers — raw token in browser, hash in database
// ---------------------------------------------------------------------------

function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

function generateRawToken(): string {
  return randomBytes(32).toString("base64url"); // 43 URL-safe chars
}

function extractRawToken(request: Request): string | null {
  const cookies = request.headers.get("Cookie") ?? "";
  // Match base64url alphabet: A-Z a-z 0-9 - _
  const match = cookies.match(/__naia_tok=([A-Za-z0-9_-]+)/);
  return match?.[1] ?? null;
}

// ---------------------------------------------------------------------------
// Cookie header builders
// ---------------------------------------------------------------------------

export function buildSessionCookieHeader(rawToken: string): string {
  return `${COOKIE_NAME}=${rawToken}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${MAX_AGE_S}`;
}

export function buildClearSessionCookieHeader(): string {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

// ---------------------------------------------------------------------------
// Cross-domain handoff browser-binding nonce (2026-10-20)
//
// Single-use enforcement (promoteHandoffSession) stops a handoff token
// being redeemed a SECOND time, but says nothing about who redeems it
// FIRST — a captured handoff URL could be used by a completely unrelated
// client before the real browser gets there, and single-use would then
// reject the legitimate browser instead. This nonce closes that gap: set
// as an HttpOnly/Secure cookie on the ORIGINATING preview host — the one
// place that can set a cookie the destination host will actually receive
// back later, because it never leaves this host at all. Only its SHA-256
// hash travels through the redirect chain (query param → signed PKCE
// session → signed handoff payload); /auth/shopify/handoff demands the
// matching raw cookie be present on the SAME request that presents the
// token, so a client with the URL but not this specific cookie cannot
// redeem it, no matter how fast it is.
// ---------------------------------------------------------------------------

const HANDOFF_NONCE_COOKIE = "__naia_handoff_nonce";

export function buildHandoffNonceCookie(): { cookieHeader: string; nonceHash: string } {
  const rawNonce = generateRawToken();
  return {
    cookieHeader: `${HANDOFF_NONCE_COOKIE}=${rawNonce}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=120`,
    nonceHash: hashToken(rawNonce),
  };
}

export function verifyHandoffNonce(request: Request, expectedHash: string): boolean {
  const cookies = request.headers.get("Cookie") ?? "";
  const match = cookies.match(new RegExp(`${HANDOFF_NONCE_COOKIE}=([A-Za-z0-9_-]+)`));
  if (!match) return false;
  const actualHash = hashToken(match[1]);
  // Both sides are fixed-length hex SHA-256 digests — timingSafeEqual needs
  // equal-length buffers, which this already guarantees by construction.
  return (
    actualHash.length === expectedHash.length &&
    timingSafeEqual(Buffer.from(actualHash, "utf8"), Buffer.from(expectedHash, "utf8"))
  );
}

export function buildClearHandoffNonceCookieHeader(): string {
  return `${HANDOFF_NONCE_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

// ---------------------------------------------------------------------------
// Create a new nAia session in the database after successful OAuth
// Returns the raw token to set in the browser cookie.
// ---------------------------------------------------------------------------

export async function createNaiaSession(
  customerId: string,
  request:    Request,
  // The Shopify OIDC id_token from the login that created this session —
  // kept only so logout can later pass it as id_token_hint to Shopify's
  // end_session_endpoint. Optional: callers that have no id_token (none
  // today, but the type stays honest) simply store no hint, same as an
  // older session created before this field existed.
  shopifyIdTokenHint?: string | null,
  // Cross-domain handoff only (2026-10-20): a session created pending
  // promotion by promoteHandoffSession expires at this exact Date instead
  // of the normal 30 days out, until that one-time exchange succeeds.
  // Every other caller omits this and gets the unchanged, full-length
  // session. Takes an explicit Date, not a duration, so the caller can
  // reuse the exact same value for promoteHandoffSession's exact-match
  // check later — two independent Date.now() calls computed moments apart
  // would never agree down to the millisecond.
  overrideExpiresAt?: Date,
): Promise<string> {
  const rawToken = generateRawToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = overrideExpiresAt ?? new Date(Date.now() + MAX_AGE_MS);

  await prisma.naiaSession.create({
    data: {
      tokenHash,
      customerId,
      expiresAt,
      userAgent: request.headers.get("User-Agent") ?? undefined,
      shopifyIdTokenHint: shopifyIdTokenHint ?? undefined,
    },
  });

  return rawToken;
}

// ---------------------------------------------------------------------------
// Cross-domain handoff only (2026-10-20) — promote a short-lived, pending
// session to a normal full-length one, exactly once.
//
// createNaiaSession above is reused as-is for the handoff case, just with a
// short expiresInMs instead of the normal 30 days — the row this creates is
// real and already usable, but only for a brief window, until this
// function is called. The WHERE clause's exact match on the original
// expiresAt is the single-use guard: the very first successful call moves
// expiresAt to the full 30-day value, so a second call with the same token
// finds expiresAt no longer matches (it's already been promoted) and the
// Prisma update affects zero rows — a replay, from the same browser or a
// different one, after the legitimate exchange has already happened. This
// is a single atomic database statement, so two concurrent replay attempts
// can never both succeed (one UPDATE always loses the race and matches
// zero rows) — it is not a read-then-write check with a window to race.
// ---------------------------------------------------------------------------

export async function promoteHandoffSession(
  rawToken: string,
  expectedPendingExpiresAt: number,
): Promise<boolean> {
  const tokenHash = hashToken(rawToken);
  const result = await prisma.naiaSession.updateMany({
    where: { tokenHash, expiresAt: new Date(expectedPendingExpiresAt) },
    data: { expiresAt: new Date(Date.now() + MAX_AGE_MS) },
  });
  return result.count === 1;
}

// ---------------------------------------------------------------------------
// Transient database connectivity — a live staging incident proved this
// must NEVER be collapsed into "no session". The two are different states:
// "not authenticated" (a real, valid DB answer: no row) must send the
// customer to sign in; "couldn't even check" (the DB itself was
// unreachable) must not — a currently-signed-in customer must never be
// bounced into fresh Shopify authentication just because the database had
// a bad moment. DatabaseUnavailableError exists so the distinction survives
// all the way up to wherever it's actually handled (the root ErrorBoundary,
// not requireCurrentNaiaCustomer's login-redirect branch).
// ---------------------------------------------------------------------------

// Re-exported for every existing caller/test that imports
// DatabaseUnavailableError from this file directly — same class reference
// as clerk-session.server.ts's own re-export, consolidated in
// prisma-transient-retry.server.ts.
export { DatabaseUnavailableError };

// ---------------------------------------------------------------------------
// Resolve a session from an inbound request.
// Returns the Customer (with onboardingProfile), or null — strictly for the
// case where the database was successfully reached and genuinely has no
// matching, unexpired row. A transient connectivity failure throws
// DatabaseUnavailableError instead of returning null, so a caller can never
// mistake "couldn't check" for "not signed in". Any other, unclassified
// error is rethrown as-is — only the known transient-connectivity class
// gets this special treatment.
// ---------------------------------------------------------------------------

// Same bounded-retry rationale as clerk-session.server.ts's
// getCurrentNaiaCustomer (2026-11-13 live incident) — one retry, on this
// read-only lookup alone, never on anything that writes/uploads/charges.
// Mechanics shared via prisma-transient-retry.server.ts.
export interface ResolveNaiaSessionDeps {
  _sleep?: (ms: number) => Promise<void>;
}

function lookupNaiaSession(tokenHash: string) {
  return prisma.naiaSession.findUnique({
    where:   { tokenHash },
    include: { customer: { include: { onboardingProfile: true } } },
  });
}

export async function resolveNaiaSession(request: Request, deps: ResolveNaiaSessionDeps = {}) {
  const rawToken = extractRawToken(request);
  if (!rawToken) return null;

  const tokenHash = hashToken(rawToken);

  // Explicit type argument, not inferred — TypeScript's inference fails to
  // resolve withTransientRetry's generic through this Prisma payload type
  // (a nested `include`-derived conditional type) when left implicit,
  // silently collapsing the whole call site's type to `{}` with no runtime
  // symptom at all. Caught by diffing the typecheck baseline before/after
  // this change, not by any test. Confirmed in isolation before applying
  // this fix here.
  const session = await withTransientRetry<Awaited<ReturnType<typeof lookupNaiaSession>>>(
    () => lookupNaiaSession(tokenHash),
    deps,
  );

  if (!session) return null;

  if (session.expiresAt < new Date()) {
    // Expired — delete silently and deny
    prisma.naiaSession.delete({ where: { tokenHash } }).catch(() => {});
    return null;
  }

  // Non-blocking touch of lastSeenAt
  prisma.naiaSession
    .update({ where: { tokenHash }, data: { lastSeenAt: new Date() } })
    .catch(() => {});

  return session.customer;
}

// ---------------------------------------------------------------------------
// Delete a session by the raw token in the request cookie (logout)
// ---------------------------------------------------------------------------

export async function deleteNaiaSession(request: Request): Promise<void> {
  const rawToken = extractRawToken(request);
  if (!rawToken) return;
  const tokenHash = hashToken(rawToken);
  await prisma.naiaSession.deleteMany({ where: { tokenHash } });
}

// ---------------------------------------------------------------------------
// 2026-11-17 (H4) — revoke EVERY nAia session belonging to one customer.
//
// Nov 12 audit finding H4: there was no admin-facing session revocation for
// a suspected-compromised customer account. Every existing teardown is
// scoped to the caller's OWN request cookie (deleteNaiaSession,
// destroySessionAndGetHint) or to expiry (purgeExpiredNaiaSessions), so an
// operator responding to a reported compromise had no way to end the
// attacker's live sessions — only to wait for them to expire.
//
// SCOPE — read this before relying on it as a containment control. This
// ends nAia's own sessions, and nothing more. It does NOT revoke the
// upstream identity-provider session (Clerk) or Shopify's, so a caller who
// still holds the customer's credentials can simply sign in again and mint
// a new NaiaSession. It is the standard "sign out of all devices" control:
// genuine containment of stolen session tokens, NOT an account lockout.
// Revoking the Clerk-side session is a separate, provider-mutating change
// and is deliberately not attempted here.
//
// Returns the number of rows deleted so the caller can record it. Unlike
// destroySessionAndGetHint this does NOT swallow errors: it is an operator
// action whose whole value is knowing whether it actually took effect, and
// a silent no-op reported as success is the worst possible outcome for an
// incident-response control.
// ---------------------------------------------------------------------------

export async function revokeAllSessionsForCustomer(
  customerId: string,
): Promise<{ revokedCount: number }> {
  const result = await prisma.naiaSession.deleteMany({ where: { customerId } });
  return { revokedCount: result.count };
}

// ---------------------------------------------------------------------------
// Logout's own entry point: destroy the session and hand back its stored
// Shopify id_token_hint in a single round trip — Prisma's delete() with a
// select returns the deleted row's fields, so there is no separate read
// step that could see the row before a later delete fails, or vice versa.
//
// Contract callers may actually rely on: returns the hint, or null —
// NEVER throws, no matter why. "No hint" and "couldn't even check" are
// deliberately collapsed into the same null: Sign Out is not allowed to
// treat a transient DB failure any differently from an older session that
// simply never stored a hint. Every case below resolves to null, not a
// thrown error:
//   - no cookie at all (no rawToken to look up)
//   - the row doesn't exist any more (Prisma P2025 — already deleted,
//     expired and reaped elsewhere, or a stale/invalid token)
//   - the database is temporarily unreachable (P1001, pool exhaustion,
//     or any other failure) — logged, never rethrown
// In the DB-failure case specifically, the row is NOT confirmed deleted —
// only the cookie clear in auth.logout's action actually logs the customer
// out of nAia from their own browser's perspective for that attempt. That
// is the documented, accepted tradeoff: Sign Out must never fail the
// customer just because the database had a bad moment.
// ---------------------------------------------------------------------------

export async function destroySessionAndGetHint(request: Request): Promise<string | null> {
  const rawToken = extractRawToken(request);
  if (!rawToken) return null;
  const tokenHash = hashToken(rawToken);

  try {
    const deleted = await prisma.naiaSession.delete({
      where: { tokenHash },
      select: { shopifyIdTokenHint: true },
    });
    return deleted.shopifyIdTokenHint ?? null;
  } catch (error) {
    // Expected, routine case (Prisma P2025 — no such row) and genuine
    // infrastructure failures (P1001 and friends) both land here. Only the
    // latter is worth a log line; a plain not-found is normal traffic
    // (double-submits, an already-expired session, a stale cookie).
    const code = (error as { code?: string } | null)?.code;
    if (code !== "P2025") {
      console.error("destroySessionAndGetHint: session delete failed, continuing local logout without a hint:", error);
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// SUPERSEDED (2026-11-04) — getCurrentNaiaCustomer/requireCurrentNaiaCustomer
// used to live here, resolving the customer from the __naia_tok cookie via
// resolveNaiaSession below. Clerk is now nAia's primary customer-auth
// provider; both names are re-exported from clerk-session.server.ts instead
// (same signature, same return shape — every existing caller in the app
// needed zero changes). Everything else in this file — resolveNaiaSession,
// createNaiaSession, promoteHandoffSession, the handoff-nonce and session
// cookie builders, destroySessionAndGetHint — is untouched and still the
// real implementation behind the legacy Shopify OAuth routes
// (auth.shopify.login/callback/handoff.tsx, auth.logout.tsx), which import
// these names directly and still work exactly as before. Nothing here was
// deleted; this is the superseded half of the module, not dead code to
// clean up casually — auth.shopify.* still runs, it's just no longer what
// requireCurrentNaiaCustomer sends an unauthenticated visitor to.
// ---------------------------------------------------------------------------

export { getCurrentNaiaCustomer, requireCurrentNaiaCustomer } from "./clerk-session.server";
