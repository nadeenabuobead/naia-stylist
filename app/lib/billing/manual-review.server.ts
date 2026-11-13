// app/lib/billing/manual-review.server.ts
//
// Correctness review (2026-11-13) — durable, queryable manual-review
// obligation for the refund/dispute cases the automatic logic in
// webhook-handler.server.ts correctly refuses to guess at: a funded period
// that can't be established for a specific payment (either a true
// pre-feature historical row, or a newly-arriving out-of-order event whose
// backfill verification failed — see derivePeriodFromInvoiceLine's and
// webhook-handler.server.ts's reconcileNullFundedPeriods comments).
//
// This is the authoritative record of the obligation. captureFailure
// (error-tracking.server.ts) may still fire alongside it for immediate
// operational visibility, but that module's own header is explicit that
// "no error leaves this process" — a console.error line is not durable,
// not queryable, and not admin-visible. An open (resolvedAt: null) row
// here IS the obligation; nothing else tracks it.

import prisma from "~/db.server";

export interface ManualReviewDeps {
  findOpenManualReviewFlag?: (
    category: string,
    refs: { transactionId?: string | null; disputeId?: string | null },
  ) => Promise<{ id: string } | null>;
  createManualReviewFlag?: (input: {
    category: string;
    subscriptionId?: string | null;
    transactionId?: string | null;
    disputeId?: string | null;
    detail?: Record<string, unknown>;
  }) => Promise<void>;
}

async function defaultFindOpenManualReviewFlag(
  category: string,
  refs: { transactionId?: string | null; disputeId?: string | null },
) {
  return prisma.manualReviewFlag.findFirst({
    where: {
      category,
      resolvedAt: null,
      ...(refs.transactionId ? { transactionId: refs.transactionId } : {}),
      ...(refs.disputeId ? { disputeId: refs.disputeId } : {}),
    },
    select: { id: true },
  });
}

async function defaultCreateManualReviewFlag(input: {
  category: string;
  subscriptionId?: string | null;
  transactionId?: string | null;
  disputeId?: string | null;
  detail?: Record<string, unknown>;
}) {
  await prisma.manualReviewFlag.create({
    data: {
      category: input.category,
      subscriptionId: input.subscriptionId ?? null,
      transactionId: input.transactionId ?? null,
      disputeId: input.disputeId ?? null,
      detail: input.detail ?? undefined,
    },
  });
}

// Idempotent by design: never creates a second OPEN flag for the same
// (category, transactionId/disputeId) — repeated webhook deliveries, or
// genuinely repeated out-of-order sync attempts that each fail the same
// backfill verification, must not spam duplicate review rows for the same
// underlying payment/dispute.
export async function recordManualReviewObligation(
  input: {
    category: string;
    subscriptionId?: string | null;
    transactionId?: string | null;
    disputeId?: string | null;
    detail?: Record<string, unknown>;
  },
  deps: ManualReviewDeps = {},
): Promise<void> {
  const _findOpen = deps.findOpenManualReviewFlag ?? defaultFindOpenManualReviewFlag;
  const _create = deps.createManualReviewFlag ?? defaultCreateManualReviewFlag;

  const existing = await _findOpen(input.category, { transactionId: input.transactionId, disputeId: input.disputeId });
  if (existing) return;
  await _create(input);
}

// System-initiated resolution — used when a LATER event establishes what
// an earlier one couldn't (see webhook-handler.server.ts's
// reconcileNullFundedPeriods: a successful backfill auto-clears any open
// flag for that same transaction, rather than leaving a stale obligation
// for something the system has since fixed itself).
export async function resolveManualReviewFlagsFor(
  category: string,
  refs: { transactionId?: string | null; disputeId?: string | null },
  resolvedBy: string,
): Promise<number> {
  const result = await prisma.manualReviewFlag.updateMany({
    where: {
      category,
      resolvedAt: null,
      ...(refs.transactionId ? { transactionId: refs.transactionId } : {}),
      ...(refs.disputeId ? { disputeId: refs.disputeId } : {}),
    },
    data: { resolvedAt: new Date(), resolvedBy, resolvedNote: "auto-resolved: condition no longer applies" },
  });
  return result.count;
}

export interface OpenManualReviewEntry {
  id: string;
  category: string;
  subscriptionId: string | null;
  transactionId: string | null;
  disputeId: string | null;
  detail: unknown;
  createdAt: Date;
}

export async function listOpenManualReviewFlags(limit: number = 50): Promise<OpenManualReviewEntry[]> {
  return prisma.manualReviewFlag.findMany({
    where: { resolvedAt: null },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
}

export async function resolveManualReviewFlag(
  id: string,
  resolvedBy: string,
  note?: string,
): Promise<{ status: "resolved" | "not-found" | "already-resolved" }> {
  const existing = await prisma.manualReviewFlag.findUnique({ where: { id }, select: { resolvedAt: true } });
  if (!existing) return { status: "not-found" };
  if (existing.resolvedAt) return { status: "already-resolved" };
  await prisma.manualReviewFlag.update({
    where: { id },
    data: { resolvedAt: new Date(), resolvedBy, resolvedNote: note ?? null },
  });
  return { status: "resolved" };
}
