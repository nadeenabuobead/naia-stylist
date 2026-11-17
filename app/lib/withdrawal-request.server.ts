// app/lib/withdrawal-request.server.ts
//
// EU statutory right-of-withdrawal REQUEST capture (Legal handoff W2,
// 2026-11-17). This module does exactly one thing: records that a customer
// submitted a withdrawal request, with identification, a timestamp, and a
// durable reference — and nothing else.
//
// Explicitly NOT a refund or cancellation mechanism. It never reads or
// writes Subscription.cancelAtPeriodEnd/canceledAt/endedAt, and never
// calls Stripe. Manual refund processing — approved as acceptable by the
// legal handoff — happens entirely outside this module, by whoever
// reviews submitted requests using the reference this module issues.

import { randomBytes } from "crypto";
import prisma from "~/db.server";

export interface SubmitWithdrawalRequestInput {
  customerId: string;
  // Captured at submission time, not re-derived from the Customer row
  // later — see the schema comment on why this is a snapshot.
  customerEmailAtRequest: string;
  customerNameAtRequest?: string | null;
}

export interface WithdrawalRequestDeps {
  _now?: () => Date;
  _generateReferenceSuffix?: () => string;
}

function generateReferenceSuffix(): string {
  // 6 chars, base32-ish (Crockford alphabet minus ambiguous chars) —
  // short enough to read back over the phone, long enough that a
  // collision against the unique constraint below is not worth guarding
  // against with anything more than the retry loop in submitWithdrawalRequest.
  const alphabet = "ABCDEFGHJKMNPQRSTVWXYZ0123456789";
  const bytes = randomBytes(6);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

function buildReference(now: Date, suffix: string): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `WD-${y}${m}${d}-${suffix}`;
}

export interface SubmittedWithdrawalRequest {
  id: string;
  reference: string;
  submittedAt: Date;
  // true only when this call actually created a new row. A duplicate
  // submission (see the open-request guard below) returns the EXISTING
  // request instead, with this set to false — the customer still sees a
  // confirmation and their real reference, they just don't get a second,
  // confusing one for the same unresolved request.
  isNewSubmission: boolean;
}

// Returns an existing not-yet-CLOSED request for this customer, if one
// exists. Deliberately a separate, narrow query — not folded into
// submitWithdrawalRequest's own logic — so it can be unit-tested and
// reasoned about on its own.
async function findOpenRequest(customerId: string) {
  return prisma.withdrawalRequest.findFirst({
    where: { customerId, status: { not: "CLOSED" } },
    orderBy: { submittedAt: "desc" },
    select: { id: true, reference: true, submittedAt: true },
  });
}

// Looks up the customer's most recent Subscription row, if any, purely to
// link the request for context — never filtered to "entitled"/ACTIVE only
// (that's billing's own concern, not this module's), and never written to.
async function findMostRecentSubscriptionId(customerId: string): Promise<string | null> {
  const subscription = await prisma.subscription.findFirst({
    where: { customerId },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return subscription?.id ?? null;
}

export async function submitWithdrawalRequest(
  input: SubmitWithdrawalRequestInput,
  deps: WithdrawalRequestDeps = {},
): Promise<SubmittedWithdrawalRequest> {
  const now = deps._now ?? (() => new Date());
  const generateSuffix = deps._generateReferenceSuffix ?? generateReferenceSuffix;

  // Duplicate-submission guard (2026-11-17, Revision 16/17 follow-up): a
  // customer with an already-open (SUBMITTED or ACKNOWLEDGED) request gets
  // that SAME request back, not a second row for the same unresolved
  // intent. A genuinely new request is still possible once the prior one
  // is marked CLOSED — this only collapses accidental double-submits
  // (double-click, retried form post) of an unresolved one.
  const existingOpen = await findOpenRequest(input.customerId);
  if (existingOpen) {
    return { ...existingOpen, isNewSubmission: false };
  }

  const subscriptionId = await findMostRecentSubscriptionId(input.customerId);

  // Retry on the vanishingly unlikely reference collision — the unique
  // constraint on WithdrawalRequest.reference is the actual guarantee;
  // this loop just makes collision a non-event instead of a 500.
  const MAX_ATTEMPTS = 5;
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const timestamp = now();
    const reference = buildReference(timestamp, generateSuffix());
    try {
      const created = await prisma.withdrawalRequest.create({
        data: {
          customerId: input.customerId,
          subscriptionId,
          customerEmailAtRequest: input.customerEmailAtRequest,
          customerNameAtRequest: input.customerNameAtRequest ?? null,
          reference,
          submittedAt: timestamp,
        },
        select: { id: true, reference: true, submittedAt: true },
      });
      return { ...created, isNewSubmission: true };
    } catch (err) {
      lastError = err;
      const isUniqueViolation = typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "P2002";
      if (!isUniqueViolation) throw err;

      // Two distinct unique constraints can produce a P2002 here, and they
      // need different responses:
      //  - the "reference" collision (vanishingly unlikely, truly
      //    random) -> loop again with a fresh reference, handled below.
      //  - the DB-level one-open-request-per-customer partial index
      //    (see the migration) tripping because a genuinely concurrent
      //    submission won the race between our own findOpenRequest()
      //    read and this create -> there IS now an open request, so
      //    return that, not a retry.
      // Prisma's P2002 reports the violated column(s)/index in
      // err.meta.target; treat anything that doesn't clearly name
      // "reference" as the customer-scoped race, the safer default.
      const target = (err as { meta?: { target?: unknown } }).meta?.target;
      const targetMentionsReference = Array.isArray(target) && target.some((t) => String(t).toLowerCase().includes("reference"));
      if (!targetMentionsReference) {
        const nowOpen = await findOpenRequest(input.customerId);
        if (nowOpen) return { ...nowOpen, isNewSubmission: false };
        // Could not find it (replica lag, or a status changed between the
        // conflict and this read) — fall through to a genuine retry
        // rather than silently losing the submission.
      }
    }
  }
  throw lastError;
}

export async function getWithdrawalRequestsForCustomer(customerId: string) {
  return prisma.withdrawalRequest.findMany({
    where: { customerId },
    orderBy: { submittedAt: "desc" },
  });
}
