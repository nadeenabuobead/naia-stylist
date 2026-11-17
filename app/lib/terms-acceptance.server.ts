// app/lib/terms-acceptance.server.ts
//
// Terms of Service acceptance recording (Legal handoff W1, 2026-11-17).
// Deliberately isolated from checkout: this module only records that a
// specific customer accepted a specific Terms version, at a specific
// time. It does not gate checkout, does not read Subscription/billing
// state, and does not decide WHEN acceptance should be requested — that
// wiring belongs to whoever owns the checkout flow (Stripe + Clerk
// Claude), which this module is written to be imported by, not to
// replace or modify.
//
// CURRENT_TERMS_VERSION stays a placeholder until Legal publishes a real
// Terms of Service document and gives it a version identifier — recording
// acceptance of a version that doesn't exist yet would be worse than not
// recording anything, so nothing here invents one.

import prisma from "~/db.server";

// Deliberately not a real version string yet — see the header above.
// Whoever wires this into checkout should replace this constant once
// Legal's Terms document has an actual version to point to, not before.
export const CURRENT_TERMS_VERSION: string | null = null;

export interface RecordTermsAcceptanceDeps {
  _now?: () => Date;
}

export async function recordTermsAcceptance(
  customerId: string,
  version: string,
  deps: RecordTermsAcceptanceDeps = {},
): Promise<void> {
  const now = deps._now ?? (() => new Date());
  await prisma.customer.update({
    where: { id: customerId },
    data: { termsAcceptedAt: now(), termsAcceptedVersion: version },
  });
}

export interface TermsAcceptanceStatus {
  accepted: boolean;
  acceptedVersion: string | null;
  acceptedAt: Date | null;
  // true only when accepted AND the accepted version matches the current
  // one — lets a caller distinguish "never asked" from "accepted an
  // older version, needs to be asked again."
  isCurrent: boolean;
}

export async function getTermsAcceptanceStatus(customerId: string): Promise<TermsAcceptanceStatus> {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { termsAcceptedAt: true, termsAcceptedVersion: true },
  });
  const acceptedVersion = customer?.termsAcceptedVersion ?? null;
  const acceptedAt = customer?.termsAcceptedAt ?? null;
  return {
    accepted: acceptedAt !== null,
    acceptedVersion,
    acceptedAt,
    isCurrent: acceptedVersion !== null && CURRENT_TERMS_VERSION !== null && acceptedVersion === CURRENT_TERMS_VERSION,
  };
}
