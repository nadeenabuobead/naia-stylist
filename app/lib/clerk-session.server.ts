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
