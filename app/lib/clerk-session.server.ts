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
import { DatabaseUnavailableError, withTransientRetry } from "./prisma-transient-retry.server";
import { CUSTOMER_PENDING_MIGRATION_OMIT } from "./prisma-customer-safe-select.server";

// Re-exported for every existing caller/test that imports
// DatabaseUnavailableError from this file directly — same class reference
// as naia-session.server.ts's own re-export, consolidated in
// prisma-transient-retry.server.ts. See that file's header for why this is
// a plain retry-wrapper function rather than a global Prisma Client
// extension.
export { DatabaseUnavailableError };

export class ClerkKeyMisconfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClerkKeyMisconfiguredError";
  }
}

// Mirrors stripe-client.server.ts's assertTestModeKey, but asymmetrically:
// Stripe's standing constraint is "test mode everywhere, always" — Clerk's
// is not, since Production genuinely needs a live key pair. What's
// actually checked here is the Nov 12 Stripe/Clerk audit's own open
// question, made concrete: CLERK_PUBLISHABLE_KEY is confirmed shared
// across Preview and Production today (same literal value, by design, not
// yet a separate-instance decision) — nothing today verifies the two keys
// even agree with each other, or that a live pair never reaches a
// deployment where it shouldn't. Checked here:
//   1. Each key has a recognizable Clerk prefix at all (pk_test_/pk_live_,
//      sk_test_/sk_live_) — catches a flat typo/placeholder/wrong-provider
//      value with a clear error, instead of a confusing failure deep
//      inside the Clerk SDK the first time a real request comes in.
//   2. The secret and publishable key agree on test-vs-live — a mismatched
//      pair (e.g. sk_live_ paired with pk_test_) is never a valid
//      configuration and typically indicates a copy-paste mistake across
//      environments.
//   3. A genuinely LIVE key pair is never used on a Preview deployment —
//      Preview is QA/in-progress traffic and must never be able to reach
//      real customer data in Clerk's own live instance. Production is
//      deliberately NOT restricted the other way (a test key pair in
//      Production would simply not authenticate real customers at all,
//      which is a functional break, not a security one, and is left to
//      surface naturally rather than guessed at here).
// Runs once, lazily, at the point of actual use (this function, same as
// Stripe's own request-time check) — never at module load, so it reads
// whatever the CURRENT process env actually is and never breaks a build or
// test run where these vars happen to be unset entirely.
export function assertClerkKeysConsistent(secretKey: string, publishableKey: string | undefined): void {
  if (!publishableKey) return; // missing entirely is createClerkClient's own contract, not this guard's concern

  const secretMode = secretKey.startsWith("sk_live_") ? "live" : secretKey.startsWith("sk_test_") ? "test" : null;
  const publishableMode = publishableKey.startsWith("pk_live_") ? "live" : publishableKey.startsWith("pk_test_") ? "test" : null;

  if (!secretMode) {
    throw new ClerkKeyMisconfiguredError("CLERK_SECRET_KEY does not look like a real Clerk secret key (expected an sk_test_ or sk_live_ prefix).");
  }
  if (!publishableMode) {
    throw new ClerkKeyMisconfiguredError("CLERK_PUBLISHABLE_KEY does not look like a real Clerk publishable key (expected a pk_test_ or pk_live_ prefix).");
  }
  if (secretMode !== publishableMode) {
    throw new ClerkKeyMisconfiguredError(
      `CLERK_SECRET_KEY (${secretMode}) and CLERK_PUBLISHABLE_KEY (${publishableMode}) are from different Clerk modes — this pairing is never valid.`,
    );
  }
  if (process.env.VERCEL_ENV === "preview" && secretMode === "live") {
    throw new ClerkKeyMisconfiguredError("A live Clerk key pair must never be used on a Preview deployment — Preview traffic must never be able to reach real customer data.");
  }
}

let _clerkClient: ReturnType<typeof createClerkClient> | null = null;

function defaultClerkClient() {
  if (!_clerkClient) {
    const secretKey = process.env.CLERK_SECRET_KEY;
    const publishableKey = process.env.CLERK_PUBLISHABLE_KEY;
    if (secretKey) assertClerkKeysConsistent(secretKey, publishableKey);
    _clerkClient = createClerkClient({ secretKey, publishableKey });
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
// upload, or a second charge. Retry mechanics live in
// prisma-transient-retry.server.ts, shared with naia-session.server.ts.

export interface GetCurrentNaiaCustomerDeps extends ClerkAuthDeps {
  _sleep?: (ms: number) => Promise<void>;
}

function lookupCustomerByClerkUserId(clerkUserId: string) {
  return prisma.customer.findUnique({
    where: { clerkUserId },
    include: { onboardingProfile: true },
    omit: CUSTOMER_PENDING_MIGRATION_OMIT,
  });
}

export async function getCurrentNaiaCustomer(request: Request, deps: GetCurrentNaiaCustomerDeps = {}) {
  const clerkUserId = await resolveClerkUserId(request, deps);
  if (!clerkUserId) return null;

  // No linked Customer row is a real, non-error outcome — see this file's
  // own header comment. Returning null here (rather than throwing) is what
  // lets a brand-new sign-up or a pending identity-link request fall
  // through requireCurrentNaiaCustomer's normal "not signed in" branch,
  // which the sign-up callback route then routes onward correctly instead
  // of every other route in the app having to special-case it.
  //
  // Explicit type argument, not inferred — see naia-session.server.ts's
  // resolveNaiaSession for why: TypeScript's inference fails to resolve
  // withTransientRetry's generic through this Prisma payload type when
  // left implicit, silently collapsing the whole call site's type to `{}`
  // with no runtime symptom — a typecheck-only failure, caught by diffing
  // the typecheck baseline, confirmed in isolation before applying this fix.
  return withTransientRetry<Awaited<ReturnType<typeof lookupCustomerByClerkUserId>>>(
    () => lookupCustomerByClerkUserId(clerkUserId),
    deps,
  );
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

// ---------------------------------------------------------------------------
// 2026-11-21 (H4, closing the real gap) — revoke a Clerk user's live
// sessions through Clerk's own Backend API.
//
// naia-session.server.ts's revokeAllSessionsForCustomer only ever deletes
// NaiaSession rows, which this module's getCurrentNaiaCustomer never reads
// (see this file's own header). Since Clerk became the PRIMARY customer-auth
// provider, that left a real incident-response hole: an admin "revoking" a
// Clerk-authenticated customer's sessions had zero effect on their actual,
// current ability to use the app. This function is the fix — it is the one
// place that actually ends a customer's live Clerk session(s), via Clerk's
// own revokeSession call, the same mechanism Clerk's own dashboard uses.
//
// Fail-closed by design: any session Clerk doesn't confirm back as
// status "revoked" — including a thrown API/network error on either the
// list or the revoke call — throws ClerkSessionRevocationError rather than
// returning a partial count. An incident-response control that reports
// "done" while a session may still be live is worse than one that visibly
// fails and makes the operator retry. See customer-session-revocation.server
// for the orchestrator that calls this alongside the legacy NaiaSession
// teardown, and admin.maintenance.tsx for the one caller.
//
// Paginated defensively (a real customer will have a handful of sessions at
// most) so a customer with more than one page of sessions can never have
// only the first page revoked while the rest stay live.
// ---------------------------------------------------------------------------

export class ClerkSessionRevocationError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "ClerkSessionRevocationError";
  }
}

export interface ClerkSessionRevocationDeps {
  // Narrowed to exactly the two SessionAPI methods actually used, rather
  // than Pick<ClerkClient, "sessions"> (which demands the full SessionAPI
  // shape on `.sessions` and so can't be satisfied by a minimal test
  // double) — same narrowing rationale as this file's own ClerkAuthDeps.
  _clerkClient?: {
    sessions: Pick<ReturnType<typeof createClerkClient>["sessions"], "getSessionList" | "revokeSession">;
  };
}

const CLERK_SESSION_LIST_PAGE_SIZE = 100;
const CLERK_SESSION_LIST_MAX_PAGES = 10; // 1,000 sessions — far beyond any real customer; a defensive cap, not an expected limit.

// A session in any of these statuses is already unusable for sign-in — no
// need to call revoke on it, and Clerk's API may reject revoking a session
// that isn't currently active/pending anyway.
const CLERK_LIVE_SESSION_STATUSES = new Set(["active", "pending"]);

export async function revokeClerkSessionsForCustomer(
  clerkUserId: string,
  deps: ClerkSessionRevocationDeps = {},
): Promise<{ revokedCount: number; alreadyInactiveCount: number }> {
  const client = deps._clerkClient ?? defaultClerkClient();

  const allSessions: { id: string; status: string }[] = [];
  for (let page = 0; page < CLERK_SESSION_LIST_MAX_PAGES; page++) {
    let listResult;
    try {
      listResult = await client.sessions.getSessionList({
        userId: clerkUserId,
        limit: CLERK_SESSION_LIST_PAGE_SIZE,
        offset: page * CLERK_SESSION_LIST_PAGE_SIZE,
      });
    } catch (error) {
      throw new ClerkSessionRevocationError(
        `Failed to list Clerk sessions for user ${clerkUserId}`,
        error,
      );
    }
    allSessions.push(...listResult.data);
    if (allSessions.length >= listResult.totalCount || listResult.data.length < CLERK_SESSION_LIST_PAGE_SIZE) {
      break;
    }
  }

  const liveSessions = allSessions.filter((s) => CLERK_LIVE_SESSION_STATUSES.has(s.status));
  const alreadyInactiveCount = allSessions.length - liveSessions.length;

  let revokedCount = 0;
  for (const session of liveSessions) {
    let revoked;
    try {
      revoked = await client.sessions.revokeSession(session.id);
    } catch (error) {
      throw new ClerkSessionRevocationError(
        `Failed to revoke Clerk session ${session.id} for user ${clerkUserId}`,
        error,
      );
    }
    if (revoked.status !== "revoked") {
      // The API call didn't throw, but didn't confirm revocation either —
      // treated the same as a thrown error, per this function's fail-closed
      // contract. This is exactly the case the founder's instruction named:
      // "do not report success when sessions remain active."
      throw new ClerkSessionRevocationError(
        `Clerk session ${session.id} for user ${clerkUserId} did not report status "revoked" after the revoke call (got "${revoked.status}")`,
      );
    }
    revokedCount++;
  }

  return { revokedCount, alreadyInactiveCount };
}
