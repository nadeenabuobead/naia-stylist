import { createHash, randomBytes } from "crypto";
import { redirect } from "react-router";
import prisma from "~/db.server";

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
  request:    Request
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
    throw redirect(`/auth/shopify/login?return_to=${returnTo}`);
  }
  return customer;
}
