/**
 * Shared Customer Intelligence — Phase 5 adapter, Passport explicit-truth
 * stream.
 *
 * Projects a conservative subset of OnboardingProfile into ResolvedFinding[].
 * Deliberately NOT all ~22 onboarding fields — see the field table in the
 * resolver's own recon report for why these five and not the rest. Never
 * routes through TasteEvidence/StyleTendency; this is a direct projection
 * of what the customer stated, not a convergence claim.
 *
 * One finding per array ENTRY, not one finding per field — every other
 * adapter in this project emits one finding per discrete fact (one
 * register, one formula, one garment, one category event); a Passport
 * array field with several values is several discrete facts, not one
 * compound one. ResolvedFinding.value stays a single string.
 *
 * signalClass is always "explicit-truth" — she stated this directly, no
 * inference. support is always "direct" — there is nothing to count or
 * reconcile, just a stated fact. provenance reuses the existing
 * {kind:"passport", field} variant, naming the real OnboardingProfile
 * field. temporal is "stated", with updatedAt when the profile row has
 * one (it always does in practice, but the type stays honest either way).
 */

import type { ResolvedFinding } from "~/lib/ai/customer-intelligence-contract";

export const PASSPORT_SOURCE = "passport";

export interface PassportFields {
  favoriteColors: readonly string[] | null;
  avoidColors: readonly string[] | null;
  silhouette: readonly string[] | null;
  lifestyle: readonly string[] | null;
  dressingPreferences: readonly string[] | null;
  updatedAt: Date | null;
}

type PassportArrayField = Exclude<keyof PassportFields, "updatedAt">;

/**
 * The exact V1 subset and why each one qualifies: a small/closed-ish
 * vocabulary, already read directly by at least one live feature's own
 * prompt (Buy-or-Skip, Wardrobe Intelligence), and unambiguously a stated
 * preference rather than behavioural context (contrast with e.g.
 * dressingHabits, which api.wishlist.jsx's own prompt comment already
 * calls "behavioural context... not an aesthetic preference" — deliberately
 * excluded for that reason). Free-text fields (dressingRequirementsNote)
 * and fields needing interpretation before they're honest (styleExpression,
 * which only makes sense through the rev7-vocabulary legacy/current split)
 * are deferred, same as whatLike/unsureAbout elsewhere in this project.
 */
const FIELD_DIMENSION: Readonly<Record<PassportArrayField, string>> = {
  favoriteColors: "favorite-color",
  avoidColors: "avoid-color",
  silhouette: "silhouette",
  lifestyle: "lifestyle",
  dressingPreferences: "dressing-preference",
};

/**
 * customerFacingSafe: true — every one of these fields is something she
 * selected herself during onboarding and can see again on her own Passport
 * page; this is not new exposure.
 * cohortEligible: true — small, non-identifying vocabularies.
 */
export function adaptPassportFindings(profile: PassportFields | null): ResolvedFinding[] {
  if (!profile) return [];

  const temporal = profile.updatedAt
    ? { kind: "stated" as const, updatedAt: profile.updatedAt.toISOString() }
    : { kind: "stated" as const };

  const findings: ResolvedFinding[] = [];
  for (const field of Object.keys(FIELD_DIMENSION) as PassportArrayField[]) {
    const dimension = FIELD_DIMENSION[field];
    const values = profile[field] ?? [];
    for (const value of values) {
      findings.push({
        value,
        signalClass: "explicit-truth",
        source: PASSPORT_SOURCE,
        dimension,
        provenanceRefs: [{ kind: "passport", field }],
        support: { kind: "direct" },
        temporal,
        customerFacingSafe: true,
        cohortEligible: true,
      });
    }
  }
  return findings;
}
