// app/lib/customer-session-revocation.server.ts
//
// 2026-11-21 (H4, closing the real gap) — the single orchestrator
// admin.maintenance.tsx's revoke-customer-sessions intent calls. It replaces
// a direct call to naia-session.server's revokeAllSessionsForCustomer, which
// only ever deleted legacy NaiaSession rows — a table the current PRIMARY
// customer-auth path (clerk-session.server.ts) never reads. That left a real
// incident-response hole: revoking a Clerk-authenticated customer's sessions
// had zero effect on their actual, current access. This function ends BOTH:
// the legacy NaiaSession rows (naia-session.server.ts, for the not-yet-
// removed Shopify OAuth routes) and every live Clerk session for the same
// customer (clerk-session.server.ts, Clerk's own Backend API).
//
// Fail-closed: if the customer has a linked Clerk identity and Clerk
// revocation does not fully succeed — any API/network error, or any session
// not confirmed back as status "revoked" — this throws
// (ClerkSessionRevocationError, re-thrown as-is) instead of returning a
// partial result. The legacy NaiaSession deletion still runs first and is
// not rolled back if Clerk revocation then fails (that effect is real and
// worth keeping on its own), but the caller must never be told the overall
// job succeeded while a Clerk session might still be live. Mirrors the
// existing convention for this same intent: a thrown error here is not
// swallowed into an { ok: false } result, it propagates to the route's own
// error handling, exactly like a NaiaSession DB failure always has.

import prisma from "~/db.server";
import { revokeAllSessionsForCustomer } from "./naia-session.server";
import { revokeClerkSessionsForCustomer } from "./clerk-session.server";

export interface RevokeAllCustomerSessionsResult {
  legacyRevokedCount: number;
  clerkRevokedCount: number;
  clerkLinked: boolean;
}

export async function revokeAllCustomerSessions(customerId: string): Promise<RevokeAllCustomerSessionsResult> {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { clerkUserId: true },
  });

  const { revokedCount: legacyRevokedCount } = await revokeAllSessionsForCustomer(customerId);

  if (!customer?.clerkUserId) {
    // No linked Clerk identity (unknown customerId, or a legacy-only
    // account never migrated) — nothing to revoke on Clerk's side, and that
    // is a real, honest "0 Clerk sessions", not a failure to surface.
    return { legacyRevokedCount, clerkRevokedCount: 0, clerkLinked: false };
  }

  const { revokedCount: clerkRevokedCount } = await revokeClerkSessionsForCustomer(customer.clerkUserId);
  return { legacyRevokedCount, clerkRevokedCount, clerkLinked: true };
}
