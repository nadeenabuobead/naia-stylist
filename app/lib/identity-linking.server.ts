// app/lib/identity-linking.server.ts
//
// Verified identity linking for the Clerk migration — explicit product
// requirement: a brand-new Clerk sign-up whose email matches an existing
// (pre-Clerk, Shopify-era) Customer row must NEVER be auto-attached to that
// row on email match alone. The match only proves two strings are equal; it
// proves nothing about who is sitting at the keyboard.
//
// Flow:
//   1. startIdentityLink — called right after a brand-new Clerk sign-up,
//      before any Customer row is created for them. If the email collides
//      with an existing, not-yet-linked Customer row, a one-time code is
//      generated and (via the injected sender) emailed to that row's
//      email — the address this app already trusts, not just whatever the
//      new signup typed, even though today they're the same string. No
//      Customer row is created for the new Clerk identity while a link
//      request is pending; getCurrentNaiaCustomer correctly reports them as
//      signed-out-of-nAia-data until this resolves one way or the other.
//   2. confirmIdentityLink — the code is correct and unexpired: the
//      existing Customer row's clerkUserId is set, the pending request is
//      deleted, and the person is now signed in as that row with every
//      existing Subscription/entitlement/ClosetItem/Passport answer intact.
//   3. abandonIdentityLink — the person says "that's not me": the pending
//      claim is dropped. Customer.email stays @unique in the schema, so
//      this does NOT let them create a second nAia account under the same
//      email — that is schema-enforced, not a gap this flow has to close
//      itself. They need a different email to sign up separately, or (if
//      it genuinely is their old account) to actually complete step 2.
//
// Brute-force note: MAX_LINK_ATTEMPTS alone is NOT the real guard — it
// resets to 0 every time a fresh IdentityLinkRequest is opened, and
// startIdentityLink opens one per new clerkUserId, which an attacker fully
// controls (every disposable Clerk sign-up is a new attacker-controlled
// clerkUserId with its own fresh 5 attempts against the same 6-digit code
// space). The real guard is Customer.identityLinkFailedAttempts/
// identityLinkLockedUntil — cumulative across every distinct clerkUserId
// that has ever attempted THIS customer's code, so spinning up more
// disposable attacker accounts does not multiply the attempt budget.
//
// No transactional email provider is wired yet — _sendVerificationEmail
// defaults to a stub that throws, so a misconfigured deploy fails loudly
// instead of silently losing codes. See the integration report for why:
// standing up a new third-party email service is a separate, explicit
// approval, not something this phase does unprompted.

import { createHash, randomInt } from "crypto";
import prisma from "~/db.server";

export const LINK_REQUEST_TTL_MS = 15 * 60 * 1000; // 15 minutes
export const MAX_LINK_ATTEMPTS = 5;
export const MAX_CUSTOMER_FAILED_ATTEMPTS = 10;
export const CUSTOMER_LOCKOUT_MS = 60 * 60 * 1000; // 1 hour

function generateVerificationCode(): string {
  // 6 digits, zero-padded — randomInt's upper bound is exclusive.
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

async function defaultSendVerificationEmail(_email: string, _code: string): Promise<void> {
  throw new Error(
    "identity-linking: no transactional email provider is configured. " +
    "_sendVerificationEmail must be injected (tests) or this app's real " +
    "sender wired in before this path can run in any live environment.",
  );
}

export interface IdentityLinkingDeps {
  _now?: () => Date;
  _generateCode?: () => string;
  _sendVerificationEmail?: (email: string, code: string) => Promise<void>;
}

export type StartIdentityLinkResult =
  | { status: "no-collision" }
  | { status: "email-already-linked" }
  | { status: "locked" }
  | { status: "pending"; identityLinkRequestId: string };

export async function startIdentityLink(
  input: { clerkUserId: string; email: string },
  deps: IdentityLinkingDeps = {},
): Promise<StartIdentityLinkResult> {
  const now = deps._now ?? (() => new Date());
  const generateCode = deps._generateCode ?? generateVerificationCode;
  const sendVerificationEmail = deps._sendVerificationEmail ?? defaultSendVerificationEmail;

  const existing = await prisma.customer.findUnique({ where: { email: input.email } });
  if (!existing) return { status: "no-collision" };
  if (existing.clerkUserId) {
    // Already linked to a DIFFERENT Clerk identity than the one signing up
    // right now — not this flow's job to resolve; the caller must reject
    // the sign-up attempt rather than open a link request against a row
    // that isn't actually unclaimed.
    return { status: "email-already-linked" };
  }

  // Cumulative, cross-attacker-account lockout — checked BEFORE issuing a
  // new code, not just on confirm. Deliberately does not distinguish this
  // from "pending" in the response the caller shows: revealing "this email
  // exists and is specifically locked" is itself a signal the flow
  // shouldn't leak any more than "a request was made."
  if (existing.identityLinkLockedUntil && existing.identityLinkLockedUntil > now()) {
    return { status: "locked" };
  }

  const code = generateCode();
  const request = await prisma.identityLinkRequest.upsert({
    where: { clerkUserId: input.clerkUserId },
    create: {
      clerkUserId: input.clerkUserId,
      customerId: existing.id,
      email: input.email,
      codeHash: hashCode(code),
      attemptCount: 0,
      expiresAt: new Date(now().getTime() + LINK_REQUEST_TTL_MS),
    },
    update: {
      customerId: existing.id,
      email: input.email,
      codeHash: hashCode(code),
      attemptCount: 0,
      expiresAt: new Date(now().getTime() + LINK_REQUEST_TTL_MS),
      confirmedAt: null,
    },
  });

  await sendVerificationEmail(input.email, code);
  return { status: "pending", identityLinkRequestId: request.id };
}

export type ConfirmIdentityLinkResult =
  | { status: "not-found" }
  | { status: "expired" }
  | { status: "too-many-attempts" }
  | { status: "locked" }
  | { status: "incorrect-code" }
  | { status: "confirmed"; customerId: string };

export async function confirmIdentityLink(
  input: { clerkUserId: string; code: string },
  deps: IdentityLinkingDeps = {},
): Promise<ConfirmIdentityLinkResult> {
  const now = deps._now ?? (() => new Date());

  const request = await prisma.identityLinkRequest.findUnique({
    where: { clerkUserId: input.clerkUserId },
    include: { customer: true },
  });
  if (!request || request.confirmedAt) return { status: "not-found" };

  if (request.expiresAt < now()) {
    await prisma.identityLinkRequest.delete({ where: { id: request.id } });
    return { status: "expired" };
  }

  // Cumulative, cross-attacker-account lock — see startIdentityLink's own
  // comment. Checked here too: a DIFFERENT clerkUserId's attempts against
  // the same target customer may have tripped the lock after this
  // particular request was already issued.
  if (request.customer.identityLinkLockedUntil && request.customer.identityLinkLockedUntil > now()) {
    return { status: "locked" };
  }

  if (request.attemptCount >= MAX_LINK_ATTEMPTS) {
    await prisma.identityLinkRequest.delete({ where: { id: request.id } });
    return { status: "too-many-attempts" };
  }

  if (hashCode(input.code) !== request.codeHash) {
    const newFailedTotal = request.customer.identityLinkFailedAttempts + 1;
    const locking = newFailedTotal >= MAX_CUSTOMER_FAILED_ATTEMPTS;
    await prisma.$transaction([
      prisma.identityLinkRequest.update({
        where: { id: request.id },
        data: { attemptCount: { increment: 1 } },
      }),
      prisma.customer.update({
        where: { id: request.customerId },
        data: {
          identityLinkFailedAttempts: locking ? 0 : newFailedTotal,
          identityLinkLockedUntil: locking ? new Date(now().getTime() + CUSTOMER_LOCKOUT_MS) : undefined,
        },
      }),
    ]);
    return locking ? { status: "locked" } : { status: "incorrect-code" };
  }

  // Single transaction: the link, the request's removal, and resetting the
  // failed-attempt counter happen together, so a crash between any of them
  // can never leave a confirmed-but-still-open request (or a stale counter)
  // lying around for a second confirm attempt to act on again.
  const customerId = request.customerId;
  await prisma.$transaction([
    prisma.customer.update({
      where: { id: customerId },
      data: { clerkUserId: input.clerkUserId, identityLinkFailedAttempts: 0, identityLinkLockedUntil: null },
    }),
    prisma.identityLinkRequest.delete({ where: { id: request.id } }),
  ]);

  return { status: "confirmed", customerId };
}

export async function abandonIdentityLink(input: { clerkUserId: string }): Promise<void> {
  await prisma.identityLinkRequest.deleteMany({ where: { clerkUserId: input.clerkUserId } });
}

// ── Sign-up-time orchestration ───────────────────────────────────────────────
//
// Called once, right after a brand-new Clerk sign-up, before this person has
// any nAia session. Idempotent against a retried call for the same
// clerkUserId (double form submit, a refreshed callback) — it always
// re-checks current state rather than assuming "first call wins".

export type ResolveCustomerForClerkSignUpResult =
  | { status: "created"; customerId: string }
  | { status: "already-linked"; customerId: string }
  | { status: "link-pending" }
  | { status: "email-conflict" }
  | { status: "locked" };

export async function resolveCustomerForClerkSignUp(
  input: { clerkUserId: string; email: string; firstName?: string | null; lastName?: string | null },
  deps: IdentityLinkingDeps = {},
): Promise<ResolveCustomerForClerkSignUpResult> {
  const already = await prisma.customer.findUnique({ where: { clerkUserId: input.clerkUserId } });
  if (already) return { status: "already-linked", customerId: already.id };

  const linkResult = await startIdentityLink(input, deps);
  if (linkResult.status === "pending") return { status: "link-pending" };
  if (linkResult.status === "email-already-linked") return { status: "email-conflict" };
  if (linkResult.status === "locked") return { status: "locked" };

  // "no-collision" — a genuinely new person. Created with ONLY clerkUserId
  // set; shopifyCustomerId stays null, exactly as the schema comment on
  // Customer.shopifyCustomerId describes for Clerk-native customers.
  const created = await prisma.customer.create({
    data: {
      clerkUserId: input.clerkUserId,
      email: input.email,
      firstName: input.firstName ?? null,
      lastName: input.lastName ?? null,
    },
  });
  return { status: "created", customerId: created.id };
}
