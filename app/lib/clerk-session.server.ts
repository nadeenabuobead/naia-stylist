// app/lib/clerk-session.server.ts
//
// The Clerk-backed replacement for naia-session.server's customer
// resolution. getCurrentNaiaCustomer/requireCurrentNaiaCustomer keep their
// exact names and return shape (a Customer row, with onboardingProfile
// included, or null) so every existing caller — dozens of routes across the
// app — needs no changes at all; naia-session.server.ts re-exports these two
// names from here now instead of implementing them itself.
//
// What changed: identity now comes from Clerk's own session (a signed JWT in
// Clerk's cookie, verified via @clerk/backend), not the custom __naia_tok
// cookie/NaiaSession table. The NaiaSession table and __naia_tok cookie
// mechanics in naia-session.server.ts are UNCHANGED and still live there —
// they are what the (not-yet-removed) legacy Shopify OAuth routes use
// directly — this module never touches them.
//
// A Clerk-authenticated request with NO linked Customer row is a real,
// expected state (brand new sign-up mid-onboarding, or an unresolved
// identity-link request) — see identity-linking.server.ts. It is NOT an
// error here: getCurrentNaiaCustomer returns null exactly as it would for
// "not signed in at all", and the route itself (sign-up's callback) is
// responsible for routing that case correctly. Conflating the two here
// would make every one of the 60+ existing requireCurrentNaiaCustomer call
// sites redirect a legitimately-authenticated-but-unlinked visitor straight
// into a 404/crash instead of the identity-link flow.

import { createClerkClient } from "@clerk/backend";
import { redirect } from "react-router";
import prisma from "~/db.server";

const TRANSIENT_PRISMA_ERROR_CODES = new Set([
  "P1001", // Can't reach database server
  "P1002", // The database server was reached but timed out
  "P1008", // Operations timed out
  "P1017", // Server has closed the connection
  // Correction (2026-11-13, live staging incident): connection-pool
  // exhaustion arrives as a PrismaClientKnownRequestError WITH this stable
  // code in this Prisma version (6.19.2) — not, as previously assumed
  // below, only as a codeless PrismaClientInitializationError. Both checks
  // are kept: this code-based one catches the real shape; the name+regex
  // fallback below is harmless to leave in case an older/different code
  // path still produces that shape.
  "P2024", // Timed out fetching a new connection from the connection pool
]);

// Same typed-error contract naia-session.server.ts established for exactly
// this reason: a transient DB failure while resolving the Clerk user's
// Customer row must never be collapsed into "not signed in" — that would
// bounce a genuinely-authenticated customer into sign-in again just because
// the database had a bad moment. See naia-session-db-resilience.test.ts for
// the original regression this guards against, and
// clerk-session-db-resilience.test.ts for this module's own version.
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
  const name = (error as { name?: string }).name;
  const message = (error as { message?: string }).message ?? "";
  if (name === "PrismaClientInitializationError" && /connection pool/i.test(message)) return true;
  return false;
}

let _clerkClient: ReturnType<typeof createClerkClient> | null = null;

function defaultClerkClient() {
  if (!_clerkClient) {
    _clerkClient = createClerkClient({
      secretKey: process.env.CLERK_SECRET_KEY,
      publishableKey: process.env.CLERK_PUBLISHABLE_KEY,
    });
  }
  return _clerkClient;
}

export interface ClerkAuthDeps {
  _clerkClient?: Pick<ReturnType<typeof createClerkClient>, "authenticateRequest">;
}

// Every CLI `vercel deploy` on this non-Git-connected project mints a
// brand-new, unique *.vercel.app hostname that the static
// CLERK_AUTHORIZED_PARTIES allowlist can never contain ahead of time. Vercel
// injects that exact hostname as VERCEL_URL — a platform-controlled value,
// not derived from the inbound request's own Host/Origin header — so it can
// be trusted as "this exact running deployment's own origin" without
// widening trust to any other *.vercel.app host. Scoped to Preview only;
// production's authorizedParties list is completely untouched.
function resolvePreviewAuthorizedParty(): string | null {
  if (process.env.VERCEL_ENV !== "preview") return null;
  if (!process.env.VERCEL_URL) return null;
  return `https://${process.env.VERCEL_URL}`;
}

// The one place that turns an inbound Request into "which Clerk user, if
// any, is this". Returns null for no/invalid session — never throws for
// that case, since an unauthenticated request is routine traffic, not a
// failure. authenticateRequest itself does not touch our database; only the
// Customer lookup below can raise DatabaseUnavailableError.
export async function resolveClerkUserId(request: Request, deps: ClerkAuthDeps = {}): Promise<string | null> {
  const client = deps._clerkClient ?? defaultClerkClient();
  const staticParties = (process.env.CLERK_AUTHORIZED_PARTIES ?? "").split(",").filter(Boolean);
  const previewParty = resolvePreviewAuthorizedParty();
  const authorizedParties =
    previewParty && !staticParties.includes(previewParty) ? [...staticParties, previewParty] : staticParties;
  const requestState = await client.authenticateRequest(request, { authorizedParties });
  const auth = requestState.toAuth();
  if (!auth?.isAuthenticated || !auth.userId) return null;
  return auth.userId;
}

// Live staging incident (2026-11-13): a customer's Closet save failed
// because this lookup hit the connection pool at exactly the wrong moment
// during a brief upstream outage. One bounded retry, on this read-only
// lookup alone, gives a just-recovering connection a second chance before
// the customer sees any failure at all — never retried: the Closet/upload/
// checkout/payment logic that runs AFTER this resolves, which is where any
// real side effect would live. A plain SELECT by unique key is naturally
// idempotent, so retrying it can never create a duplicate write, a second
// upload, or a second charge.
const TRANSIENT_RETRY_DELAY_MS = 200;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface GetCurrentNaiaCustomerDeps extends ClerkAuthDeps {
  _sleep?: (ms: number) => Promise<void>;
}

export async function getCurrentNaiaCustomer(request: Request, deps: GetCurrentNaiaCustomerDeps = {}) {
  const clerkUserId = await resolveClerkUserId(request, deps);
  if (!clerkUserId) return null;

  const sleep = deps._sleep ?? defaultSleep;

  // No linked Customer row is a real, non-error outcome — see this file's
  // own header comment. Returning null here (rather than throwing) is what
  // lets a brand-new sign-up or a pending identity-link request fall
  // through requireCurrentNaiaCustomer's normal "not signed in" branch,
  // which the sign-up callback route then routes onward correctly instead
  // of every other route in the app having to special-case it.
  const lookup = () =>
    prisma.customer.findUnique({
      where: { clerkUserId },
      include: { onboardingProfile: true },
    });

  try {
    return await lookup();
  } catch (firstError) {
    if (!isTransientDatabaseError(firstError)) throw firstError;

    await sleep(TRANSIENT_RETRY_DELAY_MS);

    try {
      return await lookup();
    } catch (secondError) {
      if (isTransientDatabaseError(secondError)) throw new DatabaseUnavailableError(secondError);
      throw secondError;
    }
  }
}

export async function requireCurrentNaiaCustomer(request: Request, deps: GetCurrentNaiaCustomerDeps = {}) {
  const customer = await getCurrentNaiaCustomer(request, deps);
  if (!customer) {
    const url = new URL(request.url);
    const returnTo = encodeURIComponent(url.pathname);
    throw redirect(`/sign-in?return_to=${returnTo}`);
  }
  return customer;
}
