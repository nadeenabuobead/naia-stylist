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
// No transactional email provider is wired yet — _sendVerificationEmail
// defaults to a stub that throws, so a misconfigured deploy fails loudly
// instead of silently losing codes. See the integration report for why:
// standing up a new third-party email service is a separate, explicit
// approval, not something this phase does unprompted.

import { createHash, randomInt } from "crypto";
import prisma from "~/db.server";

export const LINK_REQUEST_TTL_MS = 15 * 60 * 1000; // 15 minutes
export const MAX_LINK_ATTEMPTS = 5;

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
  | { status: "incorrect-code" }
  | { status: "confirmed"; customerId: string };

export async function confirmIdentityLink(
  input: { clerkUserId: string; code: string },
  deps: IdentityLinkingDeps = {},
): Promise<ConfirmIdentityLinkResult> {
  const now = deps._now ?? (() => new Date());

  const request = await prisma.identityLinkRequest.findUnique({ where: { clerkUserId: input.clerkUserId } });
  if (!request || request.confirmedAt) return { status: "not-found" };

  if (request.expiresAt < now()) {
    await prisma.identityLinkRequest.delete({ where: { id: request.id } });
    return { status: "expired" };
  }

  if (request.attemptCount >= MAX_LINK_ATTEMPTS) {
    await prisma.identityLinkRequest.delete({ where: { id: request.id } });
    return { status: "too-many-attempts" };
  }

  if (hashCode(input.code) !== request.codeHash) {
    await prisma.identityLinkRequest.update({
      where: { id: request.id },
      data: { attemptCount: { increment: 1 } },
    });
    return { status: "incorrect-code" };
  }

  // Single transaction: the link and the request's removal happen together,
  // so a crash between the two can never leave a confirmed-but-still-open
  // request lying around for a second confirm attempt to act on again.
  const customerId = request.customerId;
  await prisma.$transaction([
    prisma.customer.update({ where: { id: customerId }, data: { clerkUserId: input.clerkUserId } }),
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
  | { status: "email-conflict" };

export async function resolveCustomerForClerkSignUp(
  input: { clerkUserId: string; email: string; firstName?: string | null; lastName?: string | null },
  deps: IdentityLinkingDeps = {},
): Promise<ResolveCustomerForClerkSignUpResult> {
  const already = await prisma.customer.findUnique({ where: { clerkUserId: input.clerkUserId } });
  if (already) return { status: "already-linked", customerId: already.id };

  const linkResult = await startIdentityLink(input, deps);
  if (linkResult.status === "pending") return { status: "link-pending" };
  if (linkResult.status === "email-already-linked") return { status: "email-conflict" };

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
