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
      return created;
    } catch (err) {
      lastError = err;
      // P2002 = unique constraint violation (the reference collided) —
      // anything else is a real failure, don't mask it with a retry.
      const isUniqueViolation = typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "P2002";
      if (!isUniqueViolation) throw err;
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
