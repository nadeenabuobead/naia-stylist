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
// Resolve a session from an inbound request.
// Returns the Customer (with onboardingProfile) or null.
// ---------------------------------------------------------------------------

export async function resolveNaiaSession(request: Request) {
  const rawToken = extractRawToken(request);
  if (!rawToken) return null;

  const tokenHash = hashToken(rawToken);

  const session = await prisma.naiaSession.findUnique({
    where:   { tokenHash },
    include: { customer: { include: { onboardingProfile: true } } },
  });

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
// Logout's own entry point: read back the session's stored Shopify
// id_token_hint BEFORE destroying the row, then destroy it via the same
// deleteNaiaSession this app already uses. The read must happen first —
// once deleted, the hint is gone. Returns null (never throws) whenever
// there's nothing to hand back: no cookie at all, no matching row, or an
// older session that predates this field — callers must treat null as
// "local logout still happened, there is just no provider session to end."
// ---------------------------------------------------------------------------

export async function destroySessionAndGetHint(request: Request): Promise<string | null> {
  const rawToken = extractRawToken(request);
  if (!rawToken) return null;
  const tokenHash = hashToken(rawToken);

  const session = await prisma.naiaSession.findUnique({
    where: { tokenHash },
    select: { shopifyIdTokenHint: true },
  });

  await deleteNaiaSession(request);

  return session?.shopifyIdTokenHint ?? null;
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
