// app/lib/billing/withdrawal-refund.server.ts
//
// Manual full-refund processing for the EU statutory right of withdrawal
// (Legal handoffs W1/W2), 2026-11-17. Deliberately distinct from:
//   - ordinary cancellation (Subscription.cancelAtPeriodEnd — never touched
//     here; a withdrawal is a request to undo the purchase, not a request
//     to let it lapse at period end);
//   - a credit-card dispute/chargeback (Dispute model, webhook-handler.
//     server.ts's own Decision-16 dispute branches — a dispute is the
//     provider's own adversarial process, not a customer-initiated
//     statutory request, and an OPEN dispute on the same payment blocks
//     this path rather than being handled by it, see
//     evaluateWithdrawalRefundEligibility below);
//   - account/identity deletion (Founder Decision 3c, the Clerk/Shopify
//     erasure gap — explicitly HELD, not implemented, not touched by any
//     function in this file. Nothing here calls any erasure/deletion path.
//
// Reuses the existing Decision-16 machinery rather than duplicating it:
// issuing the Stripe refund via processWithdrawalFullRefund lets the
// ALREADY-PROVEN refund.updated webhook handler (webhook-handler.server.ts)
// create the AccessRevocation row and sync Customer.membershipStatus
// exactly as it already does for any other full refund — this module does
// not create its own AccessRevocation and does not re-decide full-vs-
// partial. What this module adds: the eligibility gate specific to a
// STATUTORY WITHDRAWAL (no early-service-consent evidence, no existing
// refund/dispute on the same payment), explicitly stopping future billing
// (a refund alone does not do this), and the audit trail connecting a
// WithdrawalRequest to the refund it caused.
//
// Stripe test-mode only: createRefund/cancelSubscriptionImmediately both
// go through stripe-client.server.ts's stripeRequest, inheriting
// assertTestModeKey — this can never run against a live key.

import prisma from "~/db.server";
import { recordAdminAction } from "../admin-audit-log.server";
import {
  createRefund,
  cancelSubscriptionImmediately,
  StripeApiError,
  StripeNotConfiguredError,
  StripeLiveModeBlockedError,
} from "./stripe-client.server";

export interface SubscriptionForEligibility {
  id: string;
  customerId: string;
  providerSubscriptionId: string | null;
  earlyServiceConsentedAt: Date | null;
  currentPeriodEnd: Date | null;
}

export interface QualifyingTransaction {
  id: string;
  providerTransactionId: string | null;
  amount: number;
  fundedPeriodStart: Date | null;
  fundedPeriodEnd: Date | null;
}

export interface WithdrawalRefundCaseRecord {
  id: string;
  withdrawalRequestId: string;
  subscriptionId: string | null;
  originalTransactionId: string | null;
  outcome: WithdrawalRefundOutcome;
  providerRefundId: string | null;
  subscriptionCanceledAt: Date | null;
  confirmationRecordedAt: Date | null;
}

export type WithdrawalRefundOutcome =
  | "ELIGIBLE_PENDING"
  | "BLOCKED_EARLY_SERVICE_CONSENT"
  | "BLOCKED_NO_QUALIFYING_PAYMENT"
  | "BLOCKED_ALREADY_REFUNDED"
  | "BLOCKED_OPEN_DISPUTE"
  | "REFUND_REQUESTED"
  | "REFUND_SUCCEEDED"
  | "PROVIDER_FAILED";

export interface WithdrawalRefundDeps {
  findWithdrawalRequestById?: (id: string) => Promise<{
    id: string;
    customerId: string;
    subscriptionId: string | null;
  } | null>;
  findLatestSubscriptionForCustomer?: (customerId: string) => Promise<SubscriptionForEligibility | null>;
  findSubscriptionById?: (id: string) => Promise<SubscriptionForEligibility | null>;
  // The most recent SUCCEEDED SUBSCRIPTION_INITIAL/SUBSCRIPTION_RENEWAL
  // transaction whose fundedPeriodEnd matches the subscription's CURRENT
  // currentPeriodEnd — i.e. the payment that funds the period the customer
  // is in right now. Null fundedPeriodStart/End (see BillingTransaction's
  // own schema comment) is never guessed at here either — such a
  // transaction is simply never returned as qualifying.
  findQualifyingTransaction?: (subscriptionId: string, currentPeriodEnd: Date | null) => Promise<QualifyingTransaction | null>;
  // Any refund already recorded (succeeded OR pending/requested) against
  // this exact transaction — a second refund attempt on an
  // already-refunded (or in-flight) payment is exactly BLOCKED_ALREADY_
  // REFUNDED, never a silent duplicate.
  findExistingRefundForTransaction?: (transactionId: string) => Promise<{ id: string } | null>;
  // An unresolved (status PENDING) Dispute against this subscription —
  // matches the manual SOP's own check (see this file's module header).
  findOpenDisputeForSubscription?: (subscriptionId: string) => Promise<{ id: string } | null>;
  findCaseByWithdrawalRequestId?: (withdrawalRequestId: string) => Promise<WithdrawalRefundCaseRecord | null>;
  findCaseByProviderRefundId?: (providerRefundId: string) => Promise<WithdrawalRefundCaseRecord | null>;
  upsertCase?: (input: {
    withdrawalRequestId: string;
    subscriptionId: string | null;
    originalTransactionId: string | null;
    outcome: WithdrawalRefundOutcome;
    detail: Record<string, unknown>;
  }) => Promise<WithdrawalRefundCaseRecord>;
  updateCase?: (
    id: string,
    input: Partial<{
      outcome: WithdrawalRefundOutcome;
      providerRefundId: string | null;
      subscriptionCanceledAt: Date | null;
      confirmationRecordedAt: Date | null;
      performedByEmail: string | null;
      auditLogId: string | null;
      detail: Record<string, unknown>;
    }>,
  ) => Promise<void>;
  // Injected (rather than calling admin-audit-log.server.ts's own export
  // directly) so this module's tests never need a real Prisma connection
  // for the one write that module itself always performs — admin-audit-
  // log.server.ts has its own, separate test coverage for the write path
  // itself.
  recordAdminAction?: (performedBy: string, action: string, detail?: Record<string, unknown>) => Promise<{ id: string }>;
  _now?: () => Date;
}

async function defaultFindWithdrawalRequestById(id: string) {
  return prisma.withdrawalRequest.findUnique({
    where: { id },
    select: { id: true, customerId: true, subscriptionId: true },
  });
}

async function defaultFindLatestSubscriptionForCustomer(customerId: string): Promise<SubscriptionForEligibility | null> {
  return prisma.subscription.findFirst({
    where: { customerId },
    orderBy: { createdAt: "desc" },
    select: { id: true, customerId: true, providerSubscriptionId: true, earlyServiceConsentedAt: true, currentPeriodEnd: true },
  });
}

async function defaultFindSubscriptionById(id: string): Promise<SubscriptionForEligibility | null> {
  return prisma.subscription.findUnique({
    where: { id },
    select: { id: true, customerId: true, providerSubscriptionId: true, earlyServiceConsentedAt: true, currentPeriodEnd: true },
  });
}

async function defaultFindQualifyingTransaction(
  subscriptionId: string,
  currentPeriodEnd: Date | null,
): Promise<QualifyingTransaction | null> {
  if (currentPeriodEnd === null) return null; // never guess which payment funds an unknown period
  return prisma.billingTransaction.findFirst({
    where: {
      subscriptionId,
      type: { in: ["SUBSCRIPTION_INITIAL", "SUBSCRIPTION_RENEWAL"] },
      status: "SUCCEEDED",
      fundedPeriodEnd: currentPeriodEnd,
    },
    orderBy: { occurredAt: "desc" },
    select: { id: true, providerTransactionId: true, amount: true, fundedPeriodStart: true, fundedPeriodEnd: true },
  });
}

async function defaultFindExistingRefundForTransaction(transactionId: string) {
  return prisma.billingTransaction.findFirst({
    where: { refundsTransactionId: transactionId, status: { in: ["SUCCEEDED"] } },
    select: { id: true },
  });
}

async function defaultFindOpenDisputeForSubscription(subscriptionId: string) {
  return prisma.dispute.findFirst({
    where: { subscriptionId, status: "PENDING" },
    select: { id: true },
  });
}

async function defaultFindCaseByWithdrawalRequestId(withdrawalRequestId: string): Promise<WithdrawalRefundCaseRecord | null> {
  return prisma.withdrawalRefundCase.findUnique({ where: { withdrawalRequestId } });
}

async function defaultFindCaseByProviderRefundId(providerRefundId: string): Promise<WithdrawalRefundCaseRecord | null> {
  return prisma.withdrawalRefundCase.findUnique({ where: { providerRefundId } });
}

async function defaultUpsertCase(input: {
  withdrawalRequestId: string;
  subscriptionId: string | null;
  originalTransactionId: string | null;
  outcome: WithdrawalRefundOutcome;
  detail: Record<string, unknown>;
}): Promise<WithdrawalRefundCaseRecord> {
  return prisma.withdrawalRefundCase.upsert({
    where: { withdrawalRequestId: input.withdrawalRequestId },
    create: {
      withdrawalRequestId: input.withdrawalRequestId,
      subscriptionId: input.subscriptionId,
      originalTransactionId: input.originalTransactionId,
      outcome: input.outcome,
      detail: input.detail as any,
    },
    update: {
      subscriptionId: input.subscriptionId,
      originalTransactionId: input.originalTransactionId,
      outcome: input.outcome,
      detail: input.detail as any,
    },
  });
}

async function defaultUpdateCase(id: string, input: Record<string, unknown>) {
  await prisma.withdrawalRefundCase.update({ where: { id }, data: input as any });
}

// ── Eligibility evaluation — re-run every time, never trusted as stale ─────
//
// Order matters, cheapest/least-sensitive check first, same discipline as
// api.billing-checkout.tsx's own layered checks:
//   1. early-service-consent evidence (a pure DB read, no billing lookup
//      needed at all if this blocks)
//   2. a qualifying payment exists for the CURRENT period
//   3. that payment isn't already refunded/refund-in-flight
//   4. no open dispute on the subscription
export async function evaluateWithdrawalRefundEligibility(
  withdrawalRequestId: string,
  deps: WithdrawalRefundDeps = {},
): Promise<WithdrawalRefundCaseRecord> {
  const _findWithdrawalRequestById = deps.findWithdrawalRequestById ?? defaultFindWithdrawalRequestById;
  const _findLatestSubscriptionForCustomer = deps.findLatestSubscriptionForCustomer ?? defaultFindLatestSubscriptionForCustomer;
  const _findSubscriptionById = deps.findSubscriptionById ?? defaultFindSubscriptionById;
  const _findQualifyingTransaction = deps.findQualifyingTransaction ?? defaultFindQualifyingTransaction;
  const _findExistingRefundForTransaction = deps.findExistingRefundForTransaction ?? defaultFindExistingRefundForTransaction;
  const _findOpenDisputeForSubscription = deps.findOpenDisputeForSubscription ?? defaultFindOpenDisputeForSubscription;
  const _upsertCase = deps.upsertCase ?? defaultUpsertCase;

  const request = await _findWithdrawalRequestById(withdrawalRequestId);
  if (!request) {
    return _upsertCase({
      withdrawalRequestId,
      subscriptionId: null,
      originalTransactionId: null,
      outcome: "BLOCKED_NO_QUALIFYING_PAYMENT",
      detail: { reason: "withdrawal_request_not_found" },
    });
  }

  const sub = request.subscriptionId
    ? await _findSubscriptionById(request.subscriptionId)
    : await _findLatestSubscriptionForCustomer(request.customerId);

  if (!sub) {
    return _upsertCase({
      withdrawalRequestId,
      subscriptionId: null,
      originalTransactionId: null,
      outcome: "BLOCKED_NO_QUALIFYING_PAYMENT",
      detail: { reason: "no_subscription_on_file" },
    });
  }

  if (sub.earlyServiceConsentedAt !== null) {
    // Full-refund-without-deduction explicitly does not apply once there is
    // evidence of early-service consent — a separate, not-yet-built
    // pro-rata action would be needed; this function never computes one.
    return _upsertCase({
      withdrawalRequestId,
      subscriptionId: sub.id,
      originalTransactionId: null,
      outcome: "BLOCKED_EARLY_SERVICE_CONSENT",
      detail: { reason: "early_service_consent_on_record", earlyServiceConsentedAt: sub.earlyServiceConsentedAt.toISOString() },
    });
  }

  const txn = await _findQualifyingTransaction(sub.id, sub.currentPeriodEnd);
  if (!txn || !txn.providerTransactionId) {
    return _upsertCase({
      withdrawalRequestId,
      subscriptionId: sub.id,
      originalTransactionId: null,
      outcome: "BLOCKED_NO_QUALIFYING_PAYMENT",
      detail: { reason: "no_succeeded_payment_funding_current_period" },
    });
  }

  const existingRefund = await _findExistingRefundForTransaction(txn.id);
  if (existingRefund) {
    return _upsertCase({
      withdrawalRequestId,
      subscriptionId: sub.id,
      originalTransactionId: txn.id,
      outcome: "BLOCKED_ALREADY_REFUNDED",
      detail: { reason: "transaction_already_refunded", existingRefundTransactionId: existingRefund.id },
    });
  }

  const openDispute = await _findOpenDisputeForSubscription(sub.id);
  if (openDispute) {
    return _upsertCase({
      withdrawalRequestId,
      subscriptionId: sub.id,
      originalTransactionId: txn.id,
      outcome: "BLOCKED_OPEN_DISPUTE",
      detail: { reason: "open_dispute_on_subscription", disputeId: openDispute.id },
    });
  }

  return _upsertCase({
    withdrawalRequestId,
    subscriptionId: sub.id,
    originalTransactionId: txn.id,
    outcome: "ELIGIBLE_PENDING",
    detail: { reason: "eligible", qualifyingAmount: txn.amount, qualifyingTransactionId: txn.id },
  });
}

export type ProcessWithdrawalRefundResult =
  | { ok: true; case: WithdrawalRefundCaseRecord }
  | { ok: false; case: WithdrawalRefundCaseRecord; reason: string };

// ── Issue the refund — the one function in this module that moves money ───
//
// Re-evaluates eligibility immediately before acting (never trusts a
// cached ELIGIBLE_PENDING from a prior page load — the same "cheapest
// check first, re-verify before the expensive/irreversible step"
// discipline used throughout this codebase's billing paths). Only the
// Stripe refund call happens here; stopping future billing and generating
// the confirmation record both happen in onRefundSucceededForWithdrawal,
// triggered by the webhook's own confirmation that the refund actually
// succeeded — never optimistically before that.
export async function processWithdrawalFullRefund(
  withdrawalRequestId: string,
  performedByEmail: string,
  deps: WithdrawalRefundDeps = {},
): Promise<ProcessWithdrawalRefundResult> {
  const _findSubscriptionById = deps.findSubscriptionById ?? defaultFindSubscriptionById;
  const _findQualifyingTransaction = deps.findQualifyingTransaction ?? defaultFindQualifyingTransaction;
  const _updateCase = deps.updateCase ?? defaultUpdateCase;
  const _recordAdminAction = deps.recordAdminAction ?? recordAdminAction;

  const current = await evaluateWithdrawalRefundEligibility(withdrawalRequestId, deps);
  if (current.outcome !== "ELIGIBLE_PENDING") {
    return { ok: false, case: current, reason: current.outcome };
  }
  if (!current.subscriptionId || !current.originalTransactionId) {
    // Defensive — ELIGIBLE_PENDING is never set without both IDs above, but
    // never trust that invariant blindly at the one point real money moves.
    return { ok: false, case: current, reason: "BLOCKED_NO_QUALIFYING_PAYMENT" };
  }

  const sub = await _findSubscriptionById(current.subscriptionId);
  const txn = await _findQualifyingTransaction(current.subscriptionId, sub?.currentPeriodEnd ?? null);
  if (!sub || !txn || !txn.providerTransactionId) {
    return { ok: false, case: current, reason: "BLOCKED_NO_QUALIFYING_PAYMENT" };
  }

  const auditLog = await _recordAdminAction(performedByEmail, "withdrawal-full-refund-requested", {
    withdrawalRequestId,
    subscriptionId: current.subscriptionId,
    originalTransactionId: current.originalTransactionId,
  });

  try {
    // Idempotency key keyed on the WithdrawalRefundCase id, not a
    // timestamp — a retried admin click (double-submit, a page reload
    // after a slow response) collapses to the SAME Stripe refund object,
    // never a second one.
    const refund = await createRefund(
      { paymentIntentId: txn.providerTransactionId, reason: "requested_by_customer" },
      `withdrawal-refund:${current.id}`,
    );
    await _updateCase(current.id, {
      outcome: "REFUND_REQUESTED",
      providerRefundId: refund.id,
      performedByEmail,
      auditLogId: auditLog.id,
    });
    return { ok: true, case: { ...current, outcome: "REFUND_REQUESTED", providerRefundId: refund.id } };
  } catch (err) {
    const reason =
      err instanceof StripeNotConfiguredError || err instanceof StripeLiveModeBlockedError
        ? "stripe_not_configured"
        : err instanceof StripeApiError
          ? `stripe_api_error_${err.status}`
          : "unknown_provider_error";
    await _updateCase(current.id, {
      outcome: "PROVIDER_FAILED",
      performedByEmail,
      auditLogId: auditLog.id,
      detail: { ...(current as any).detail, providerFailureReason: reason },
    });
    return { ok: false, case: { ...current, outcome: "PROVIDER_FAILED" }, reason };
  }
}

// ── Webhook closure hooks — called for EVERY succeeded/failed refund this ──
// app processes, withdrawal-triggered or not. Each does its own lookup by
// providerRefundId and no-ops if nothing matches — see webhook-handler.
// server.ts's own comment on why this is deliberately NOT given the
// isFullRefund/fundsCurrentPeriod decision that file already makes.
export async function onRefundSucceededForWithdrawal(refundId: string, deps: WithdrawalRefundDeps = {}): Promise<void> {
  const _findCaseByProviderRefundId = deps.findCaseByProviderRefundId ?? defaultFindCaseByProviderRefundId;
  const _findSubscriptionById = deps.findSubscriptionById ?? defaultFindSubscriptionById;
  const _updateCase = deps.updateCase ?? defaultUpdateCase;
  const _now = deps._now ?? (() => new Date());

  const withdrawalCase = await _findCaseByProviderRefundId(refundId);
  if (!withdrawalCase) return; // not a withdrawal-triggered refund — nothing to do
  if (withdrawalCase.outcome === "REFUND_SUCCEEDED") return; // idempotent — a redelivered webhook

  await _updateCase(withdrawalCase.id, { outcome: "REFUND_SUCCEEDED" });

  // Stop future billing — a refund alone never does this (confirmed:
  // syncMembershipStatusAfterRevocationChange only ever writes
  // Customer.membershipStatus, never Subscription.status/cancelAtPeriodEnd/
  // canceledAt). Only reached after Stripe has confirmed the refund itself
  // succeeded — never before, so a failed refund never leaves a canceled
  // subscription with nothing actually refunded.
  if (withdrawalCase.subscriptionId) {
    const sub = await _findSubscriptionById(withdrawalCase.subscriptionId);
    if (sub?.providerSubscriptionId) {
      try {
        await cancelSubscriptionImmediately(sub.providerSubscriptionId);
        await _updateCase(withdrawalCase.id, { subscriptionCanceledAt: _now() });
      } catch {
        // Best-effort: the refund itself already succeeded and is recorded
        // regardless. A failed cancellation call here is a real, separate
        // problem (future billing not actually stopped) but must never be
        // allowed to look like the refund failed — it did not. Surfaced via
        // subscriptionCanceledAt staying null, visible to whoever reviews
        // this case, not swallowed silently.
      }
    }
  }

  // Confirmation record — composed and stored, NOT sent. No customer-facing
  // billing-email send path exists anywhere in this codebase (see resend-
  // email.server.ts's own scope: identity-link codes only) — building and
  // wiring a real send is separate, later work requiring its own founder/
  // legal sign-off on wording. This at minimum makes the actual content
  // available for a human to copy into an email today, or for that later
  // feature to pick up with no further plumbing — "produce," not "trigger."
  //
  // DRAFT wording, not legally reviewed — same explicit status as every
  // other customer-facing legal/consumer-rights copy in this codebase
  // (my-naia.withdrawal-request.tsx's own [pending Legal sign-off]
  // placeholder). Never sent automatically by anything in this file.
  await _updateCase(withdrawalCase.id, {
    confirmationRecordedAt: _now(),
    detail: {
      confirmationDraft: {
        status: "DRAFT — not legally reviewed, not sent automatically",
        subject: "Your nAia membership refund has been processed",
        body:
          "Your statutory withdrawal request has been processed. We have issued a full refund " +
          "of your membership payment, with no deduction for any service used. Your membership " +
          "has been canceled and no further payments will be charged. If you do not see the " +
          "refund within 5-10 business days, please contact us.",
      },
    },
  });
}

export async function onRefundFailedForWithdrawal(refundId: string, deps: WithdrawalRefundDeps = {}): Promise<void> {
  const _findCaseByProviderRefundId = deps.findCaseByProviderRefundId ?? defaultFindCaseByProviderRefundId;
  const _updateCase = deps.updateCase ?? defaultUpdateCase;

  const withdrawalCase = await _findCaseByProviderRefundId(refundId);
  if (!withdrawalCase) return;
  if (withdrawalCase.outcome === "REFUND_SUCCEEDED") return; // a later success must never be downgraded by a stale/duplicate failure event
  await _updateCase(withdrawalCase.id, { outcome: "PROVIDER_FAILED" });
}
