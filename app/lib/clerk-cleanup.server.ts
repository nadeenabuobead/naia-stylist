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
 * Single-row retry — see admin.maintenance.tsx for the manual, per-click
 * caller, and sweepPendingClerkCleanups below for the bounded-batch one.
 * Neither this app nor this function decides on its own to retry something
 * on a schedule — an unattended retry loop against a third-party API has
 * its own failure modes (hammering a persistently-misconfigured key, for
 * one) that a human clicking a button, or an operator's own external
 * scheduler explicitly opting in, does not.
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

// 2026-11-17 (launch-readiness audit): before this, the ONLY way a pending
// row ever got retried was a human manually opening /admin/maintenance and
// clicking it — there was no automated path at all, so a Clerk deletion
// that failed during an unattended customers/redact or shop/redact webhook
// could sit unresolved indefinitely with nothing surfacing it (this app
// has no centralized alerting either — see error-tracking.server.ts's own
// header). This gives operators an actual automated option without this
// app deciding on its own to run one: see api.clerk-cleanup-sweep.ts,
// which requires an external caller (a scheduled GitHub Actions workflow,
// matching this codebase's established pattern — see
// api.export-zip-sweep.ts / api.staging-full-look-vto-sweep.ts) to opt in
// and trigger it, exactly the same bounded-batch, secret-gated shape as
// those two already-reviewed sweeps.
export const CLERK_CLEANUP_SWEEP_BATCH_SIZE = 25;

export interface SweepPendingClerkCleanupsResult {
  checked: number;
  resolved: number;
  failed: number;
  /** true when more unresolved rows exist beyond this batch. */
  more: boolean;
}

export async function sweepPendingClerkCleanups(
  deps: RetryClerkCleanupDeps = {},
): Promise<SweepPendingClerkCleanupsResult> {
  // +1 purely to detect "more remain" without a second count query — same
  // technique already established in customer-export-zip-large.server.ts's
  // sweepExpiredExportJobs.
  const rows = await prisma.pendingClerkCleanup.findMany({
    where: { resolvedAt: null },
    orderBy: { createdAt: "asc" },
    take: CLERK_CLEANUP_SWEEP_BATCH_SIZE + 1,
  });
  const more = rows.length > CLERK_CLEANUP_SWEEP_BATCH_SIZE;
  const batch = more ? rows.slice(0, CLERK_CLEANUP_SWEEP_BATCH_SIZE) : rows;

  let resolved = 0;
  let failed = 0;
  for (const row of batch) {
    const result = await retryPendingClerkCleanup(row.id, deps);
    if (result.status === "resolved") resolved++;
    else if (result.status === "failed-again") failed++;
    // "not-found" / "already-resolved" can't happen here (we just read
    // these exact unresolved rows), but aren't counted as failed either
    // way if some other process resolved one between the read and here.
  }

  return { checked: batch.length, resolved, failed, more };
}
