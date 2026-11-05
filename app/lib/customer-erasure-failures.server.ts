// app/lib/customer-erasure-failures.server.ts
//
// Durable record + retry for a GDPR erasure (eraseCustomerData) that hit a
// genuinely unexpected failure partway through — not a stuck Cloudinary
// asset (already reported via EraseResult.cloudinaryFailures) and not a
// customer with billing history (handled automatically by the anonymize
// path in customer-privacy.server.ts, not a failure). Before this, that
// kind of failure inside a shop/redact batch would just be a console.error
// line and a skipped customer. This is the operator-visible surface:
// /admin/maintenance lists every unresolved row and can retry it directly —
// same pattern as clerk-cleanup.server.ts's PendingClerkCleanup.
//
// No FK to Customer anywhere here, deliberately — by the time this runs the
// customer's row may already be partially erased; customerId is a plain
// audit trail, not a live reference.

import prisma from "../db.server";
import { eraseCustomerData } from "./customer-privacy.server";

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/**
 * Called from eraseCustomerData itself when something genuinely unexpected
 * happens, and from the shop/redact batch loop as a second, independent
 * safety net. Upsert, not a bare create: a repeat failure for the same
 * customerId updates the existing row's attemptCount/lastError/lastAttemptAt
 * rather than stacking a duplicate.
 */
export async function recordPendingCustomerErasureFailure(
  customerId: string,
  context: string,
  error: unknown,
): Promise<string> {
  const lastError = errorMessage(error);
  const row = await prisma.pendingCustomerErasureFailure.upsert({
    where: { customerId },
    create: { customerId, context, lastError },
    update: { context, lastError, attemptCount: { increment: 1 }, lastAttemptAt: new Date() },
  });
  return row.id;
}

export interface PendingCustomerErasureFailureEntry {
  id: string;
  customerId: string;
  context: string;
  lastError: string;
  attemptCount: number;
  createdAt: Date;
  lastAttemptAt: Date;
}

/** Unresolved rows only — a resolved one has nothing left for an operator to act on. */
export async function listPendingCustomerErasureFailures(limit: number = 50): Promise<PendingCustomerErasureFailureEntry[]> {
  return prisma.pendingCustomerErasureFailure.findMany({
    where: { resolvedAt: null },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
}

export type RetryPendingCustomerErasureFailureResult =
  | { status: "not-found" }
  | { status: "already-resolved" }
  | { status: "resolved" }
  | { status: "failed-again"; error: string };

export interface RetryCustomerErasureFailureDeps {
  // Not a static import of eraseCustomerData — that module imports THIS one
  // to record failures, so a static import here would be circular. Injected
  // for tests; defaults to a dynamic import at call time in production.
  _eraseCustomerData?: typeof eraseCustomerData;
}

/**
 * Operator-triggered only — see admin.maintenance.tsx. Deliberately not an
 * automatic background retry, same rationale as retryPendingClerkCleanup: a
 * human clicking a button in response to a visible, logged failure is safer
 * than an unattended loop against a persistently-failing path.
 */
export async function retryPendingCustomerErasureFailure(
  id: string,
  deps: RetryCustomerErasureFailureDeps = {},
): Promise<RetryPendingCustomerErasureFailureResult> {
  const row = await prisma.pendingCustomerErasureFailure.findUnique({ where: { id } });
  if (!row) return { status: "not-found" };
  if (row.resolvedAt) return { status: "already-resolved" };

  const erase = deps._eraseCustomerData ?? (await import("./customer-privacy.server")).eraseCustomerData;

  try {
    const result = await erase(row.customerId);
    if (result.pendingFailureId) {
      // Failed again, already re-recorded by eraseCustomerData itself — just
      // reflect that back rather than double-recording here.
      return { status: "failed-again", error: "Retry failed again — see the updated error below." };
    }
    await prisma.pendingCustomerErasureFailure.update({ where: { id }, data: { resolvedAt: new Date() } });
    return { status: "resolved" };
  } catch (err) {
    const lastError = errorMessage(err);
    await prisma.pendingCustomerErasureFailure.update({
      where: { id },
      data: { lastError, attemptCount: { increment: 1 }, lastAttemptAt: new Date() },
    });
    return { status: "failed-again", error: lastError };
  }
}
