// app/lib/age-confirmation.server.ts
//
// Priority 5 (2026-10-19) — age declaration.
//
// Nothing in this app previously asked a customer to confirm they meet the
// minimum age to use the service. This module is the standalone,
// independently-tested check/record capability — deliberately NOT wired
// into onboarding (app/routes/onboarding/step.$step.tsx) or any shared
// request path (e.g. requireCurrentNaiaCustomer) in this pass.
//
// Why not wire it in here: onboarding's step flow is a carefully-tuned,
// numbered question sequence (Passport) under active, separate work: a
// new step shifts every subsequent step number and risks a real
// regression in a system this change has no visibility into. Wiring a
// gate into requireCurrentNaiaCustomer instead would affect every
// customer-facing route in the app at once — too broad a blast radius for
// a single pass with no staging verification. WHERE to place this check
// (a new onboarding step vs. a one-time modal vs. a dedicated route) is a
// product/UX decision, not a technical one — flagged for that decision
// rather than guessed at here.

import prisma from "../db.server";

/// Bump when the age-confirmation wording or the minimum-age policy
/// itself changes — a customer confirmed under an old version must be
/// asked again, same pattern as designResearchConsentVersion.
export const CURRENT_AGE_CONFIRMATION_VERSION = "v1";

export function hasConfirmedCurrentAge(customer: {
  ageConfirmedAt: Date | null;
  ageConfirmationVersion: string | null;
}): boolean {
  return customer.ageConfirmedAt !== null && customer.ageConfirmationVersion === CURRENT_AGE_CONFIRMATION_VERSION;
}

export async function recordAgeConfirmation(customerId: string): Promise<void> {
  await prisma.customer.update({
    where: { id: customerId },
    data: {
      ageConfirmedAt: new Date(),
      ageConfirmationVersion: CURRENT_AGE_CONFIRMATION_VERSION,
    },
  });
}
