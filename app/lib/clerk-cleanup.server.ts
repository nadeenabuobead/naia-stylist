// app/lib/clerk-cleanup.server.ts
//
// Durable record + retry for a Clerk user deletion that failed after this
// account's own nAia data was already erased (settings.tsx's delete-account
// action). Before this, the only trace of that failure was a console.error
// line — real, but not durable (lost to log rotation) and not actionable
// (no one is paged, no list to check). This is the operator-visible surface:
// /admin/maintenance lists every unresolved row and can retry it directly.
//
// No FK to Customer anywhere here, deliberately — the Customer row is
// already gone by the time recordPendingClerkCleanup is ever called;
// customerId is a plain audit trail, not a live reference.

import prisma from "../db.server";
import { createClerkClient } from "@clerk/backend";

// Raw @clerk/backend client, not @clerk/react-router/server's clerkClient()
// wrapper — that one requires a real inbound request's args (route-scoped);
// this retry is operator-triggered from an admin action with no particular
// customer-facing request to scope it to. Same framework-agnostic client
// clerk-session.server.ts's defaultClerkClient() already uses for exactly
// this reason.
let _defaultClerkClient: ReturnType<typeof createClerkClient> | null = null;
function defaultClerkClient() {
  if (!_defaultClerkClient) {
    _defaultClerkClient = createClerkClient({
      secretKey: process.env.CLERK_SECRET_KEY,
      publishableKey: process.env.CLERK_PUBLISHABLE_KEY,
    });
  }
  return _defaultClerkClient;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/**
 * Called from settings.tsx's delete-account action when
 * clerkClient(args).users.deleteUser(...) fails. Upsert, not a bare create:
 * a repeat failure for the same clerkUserId (a retry that fails again, or —
 * defensively — the same failure recorded twice) updates the existing row's
 * attemptCount/lastError/lastAttemptAt rather than stacking a duplicate.
 */
export async function recordPendingClerkCleanup(
  clerkUserId: string,
  customerId: string,
  error: unknown,
): Promise<void> {
  const lastError = errorMessage(error);
  await prisma.pendingClerkCleanup.upsert({
    where: { clerkUserId },
    create: { clerkUserId, customerId, lastError },
    update: { lastError, attemptCount: { increment: 1 }, lastAttemptAt: new Date() },
  });
}

export interface PendingClerkCleanupEntry {
  id: string;
  clerkUserId: string;
  customerId: string;
  lastError: string;
  attemptCount: number;
  createdAt: Date;
  lastAttemptAt: Date;
}

/** Unresolved rows only — a resolved one has nothing left for an operator to act on. */
export async function listPendingClerkCleanups(limit: number = 50): Promise<PendingClerkCleanupEntry[]> {
  return prisma.pendingClerkCleanup.findMany({
    where: { resolvedAt: null },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
}

export type RetryPendingClerkCleanupResult =
  | { status: "not-found" }
  | { status: "already-resolved" }
  | { status: "resolved" }
  | { status: "failed-again"; error: string };

export interface RetryClerkCleanupDeps {
  _clerkClient?: Pick<ReturnType<typeof createClerkClient>, "users">;
}

/**
 * Operator-triggered only — see admin.maintenance.tsx. Deliberately not an
 * automatic background retry: an unattended retry loop against a third-party
 * API has its own failure modes (hammering a persistently-misconfigured
 * key, for one) that a human clicking a button in response to a visible,
 * logged failure does not.
 */
export async function retryPendingClerkCleanup(
  id: string,
  deps: RetryClerkCleanupDeps = {},
): Promise<RetryPendingClerkCleanupResult> {
  const row = await prisma.pendingClerkCleanup.findUnique({ where: { id } });
  if (!row) return { status: "not-found" };
  if (row.resolvedAt) return { status: "already-resolved" };

  const client = deps._clerkClient ?? defaultClerkClient();

  try {
    await client.users.deleteUser(row.clerkUserId);
    await prisma.pendingClerkCleanup.update({ where: { id }, data: { resolvedAt: new Date() } });
    return { status: "resolved" };
  } catch (err) {
    const lastError = errorMessage(err);
    await prisma.pendingClerkCleanup.update({
      where: { id },
      data: { lastError, attemptCount: { increment: 1 }, lastAttemptAt: new Date() },
    });
    return { status: "failed-again", error: lastError };
  }
}
