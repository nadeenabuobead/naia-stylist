import { createHash, randomBytes } from "crypto";
import { redirect } from "react-router";
import prisma from "~/db.server";
import { validateOriginHost } from "~/lib/shopify-customer-oauth.server";

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
): Promise<string> {
  const rawToken = generateRawToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + MAX_AGE_MS);

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

const TRANSIENT_PRISMA_ERROR_CODES = new Set([
  "P1001", // Can't reach database server
  "P1002", // The database server was reached but timed out
  "P1008", // Operations timed out
  "P1017", // Server has closed the connection
]);

export class DatabaseUnavailableError extends Error {
  constructor(cause: unknown) {
    super("Database temporarily unavailable");
    this.name = "DatabaseUnavailableError";
    this.cause = cause;
  }
}

function isTransientDatabaseError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: string }).code;
  if (code && TRANSIENT_PRISMA_ERROR_CODES.has(code)) return true;
  // Connection-pool exhaustion surfaces as a PrismaClientInitializationError
  // with no stable .code at all — recognized by name + the exact phrase
  // Prisma emits ("Timed out fetching a new connection from the connection
  // pool"), not by code, since there isn't one.
  const name = (error as { name?: string }).name;
  const message = (error as { message?: string }).message ?? "";
  if (name === "PrismaClientInitializationError" && /connection pool/i.test(message)) return true;
  return false;
}

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

export async function resolveNaiaSession(request: Request) {
  const rawToken = extractRawToken(request);
  if (!rawToken) return null;

  const tokenHash = hashToken(rawToken);

  let session;
  try {
    session = await prisma.naiaSession.findUnique({
      where:   { tokenHash },
      include: { customer: { include: { onboardingProfile: true } } },
    });
  } catch (error) {
    if (isTransientDatabaseError(error)) throw new DatabaseUnavailableError(error);
    throw error;
  }

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
// Exported auth helpers for use in loaders / actions
// ---------------------------------------------------------------------------

export async function getCurrentNaiaCustomer(request: Request) {
  return resolveNaiaSession(request);
}

export async function requireCurrentNaiaCustomer(request: Request) {
  const customer = await getCurrentNaiaCustomer(request);
  if (!customer) {
    const url      = new URL(request.url);
    const returnTo = encodeURIComponent(url.pathname);
    // When STOREFRONT_HOST is set, send the browser directly to the storefront
    // login URL (absolute). This ensures the PKCE cookie is set on the storefront
    // domain where Shopify will deliver the callback, with no staging-domain detour.
    // _sf=1 tells auth.shopify.login to skip its own storefront-redirect check.
    const sfHost = process.env.STOREFRONT_HOST ?? "";
    if (sfHost) {
      // Preview deployments only: ephemeral preview URLs can't be registered
      // as a Shopify redirect_uri, so the whole login/callback dance is
      // forced onto sfHost regardless of which host this request actually
      // came in on. Without remembering that origin, the post-auth redirect
      // silently lands the browser on sfHost instead of the preview that
      // started the flow. url.hostname is exactly what the browser's
      // address bar shows — validateOriginHost is what keeps this from
      // being an open redirect (only this app's own preview pattern, the
      // storefront host itself, or the canonical app host are accepted;
      // anything else is dropped, and production never sets this at all
      // since it has no reason to differ from sfHost in the first place).
      const originHost =
        process.env.VERCEL_ENV !== "production" ? validateOriginHost(url.hostname) : null;
      const originParam = originHost && originHost !== sfHost ? `&origin_host=${encodeURIComponent(originHost)}` : "";
      throw redirect(`https://${sfHost}/auth/shopify/login?_sf=1&return_to=${returnTo}${originParam}`);
    }
    throw redirect(`/auth/shopify/login?return_to=${returnTo}`);
  }
  return customer;
}
