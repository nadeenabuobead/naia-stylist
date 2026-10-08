// app/lib/ai/taste-passport-boundary.server.ts
//
// Taste & Evidence V1 completion — Passport contradiction-awareness boundary.
//
// Authority rule (locked, non-negotiable):
//   Style Passport  = explicit customer truth.
//   Taste & Evidence = observed/inferred learning.
// This module NEVER reads a Passport field in order to write it, and NEVER
// writes to Customer at all. It only COMPARES an already-loaded, read-only
// PassportSnapshot against a StyleTendency's claim and returns a result
// describing whether a deterministic conflict exists. A conflict is
// surfaced as a possible evolution for the customer to confirm or correct —
// it never mutates Passport, never becomes "explicit truth", and never
// gains precedence over Passport. See taste-passport-boundary.test.ts for
// the enforced guarantees (PP.4, PP.6, PP.7, PP.12) and
// taste-evidence-consumer-boundary.test.ts for the enforced guarantee that
// this module itself is only ever consumed by the two customer-facing
// surfaces (My nAia overview teaser + What nAia Is Noticing), never by a
// recommendation engine.
//
// Mapping table — why it is deliberately EMPTY in V1:
//
// A mapping is added for a dimension only when that dimension's TASTE VALUE
// (not just its name) carries enough specific content to be compared,
// one-for-one, against an explicit Passport field's own value, without
// guessing direction or intent. Audited against the current vocabulary in
// app/lib/ai/taste-contract.ts and app/lib/passport/rev7-vocabulary.ts:
//
//   self-expression — Taste always records the literal value
//     "self-expression"; polarity states only whether a look felt authentic,
//     never WHICH trait was or wasn't realized. Passport's styleExpression
//     stores specific trait ids ("relaxed", "powerful", "individual", ...).
//     There is no way to know which selected trait a given outcome refers
//     to — any link would be a guess, not a reversal. UNSUPPORTED.
//
//   comfort — Taste always records the literal value "comfort"; polarity
//     only. The one Passport field in this territory, dressingHabits
//     ("comfort-first"), is explicitly commented in prisma/schema.prisma as
//     "behavioural context; never scored" — a product decision to keep it
//     out of any inference/scoring path, which a contradiction check would
//     violate. UNSUPPORTED.
//
//   formality — Taste values are directional ("too-formal" / "too-casual")
//     but are generated ONLY as negative polarity (see
//     taste-extraction.server.ts). No Passport field states an explicit
//     formality preference: ClosetItem.formality is a garment-level
//     AI-derived token (not a Passport answer); StylingSession
//     .formalityConditional is per-session context, not persisted Passport
//     truth. Rev 7's styleDirections ("polished-refined" / "relaxed-easy")
//     is an aesthetic-direction selection, not a literal formality
//     statement — treating it as one would be an interpretive leap, not the
//     same claim. UNSUPPORTED.
//
//   fit — Taste always records the literal value "fit", and — confirmed in
//     taste-extraction.server.ts's extractPostWearEvidence comment ("yes" /
//     "mostly" → no positive fit signal in V1) — is generated ONLY as
//     negative polarity, with no information about which direction of fit
//     failed. Passport's silhouette field stores specific preferred tokens
//     (fitted / relaxed / oversized / flowing / defined-waist); fitConcerns
//     stores specific body-fit struggle areas. Neither can be matched
//     against a signal that only ever says "something about fit didn't
//     work" without guessing which direction. UNSUPPORTED.
//
//   garment-category — the one dimension whose Taste value is genuinely
//     specific (a real ClosetCategory token, e.g. "DRESSES"). But no
//     Passport field expresses a per-category love/avoid preference today
//     (coveragePreferences/shoppingPriorities are legacy and already hidden
//     from Rev6+ customers elsewhere in this codebase — not a sound
//     foundation for new logic). UNSUPPORTED today; the most likely
//     candidate for a real mapping if a future Passport field is added.
//
// Nothing above is fuzzy-filled "to cover every dimension" — every entry
// below is additive, keyed by TasteDimension, and the resolution engine
// below is fully general: a future phase can populate a real mapping
// without changing detectPassportContradiction or its callers.

import prisma from "~/db.server";
import { currentStyleExpression } from "~/lib/passport/rev7-vocabulary";
import type { TasteDimension } from "~/lib/ai/taste-contract";

// ── Passport snapshot ───────────────────────────────────────────────────────

/**
 * Read-only projection of the Passport fields a mapping could ever compare
 * against. Extend this ONLY alongside a new entry in PASSPORT_TASTE_MAPPINGS
 * — do not add fields speculatively.
 */
export interface PassportSnapshot {
  styleExpression: string[];
  dressingHabits: string[];
  silhouette: string[];
  fitConcerns: string[];
}

const EMPTY_SNAPSHOT: PassportSnapshot = {
  styleExpression: [],
  dressingHabits: [],
  silhouette: [],
  fitConcerns: [],
};

/**
 * Loads a read-only Passport snapshot for one customer. Never writes.
 * Reuses the existing Rev 7 normalization helper (currentStyleExpression)
 * rather than re-deriving Passport vocabulary rules.
 */
export async function loadPassportSnapshot(customerId: string): Promise<PassportSnapshot> {
  // These four fields live on OnboardingProfile (the Passport record),
  // related to Customer 1:1 via customerId — never directly on Customer.
  const profile = await prisma.onboardingProfile.findUnique({
    where: { customerId },
    select: {
      styleExpression: true,
      dressingHabits: true,
      silhouette: true,
      fitConcerns: true,
    },
  });
  if (!profile) return EMPTY_SNAPSHOT;
  return {
    styleExpression: currentStyleExpression(profile.styleExpression),
    dressingHabits: profile.dressingHabits ?? [],
    silhouette: profile.silhouette ?? [],
    fitConcerns: profile.fitConcerns ?? [],
  };
}

// ── Mapping contract ─────────────────────────────────────────────────────────

export type TastePolarity = "positive" | "negative";

/** Outcome of comparing one Passport field's value against one tendency's claim. */
export interface MappingEvaluation {
  /** The specific Passport value this evaluation is about (for display/testing). */
  passportValue: string;
  /** True only when the Passport value deterministically disagrees with the tendency. */
  conflicts: boolean;
}

export interface PassportTasteMapping {
  /** Which PassportSnapshot field this mapping reads. */
  passportField: keyof PassportSnapshot;
  /** One-sentence record of why this Passport field and this Taste claim represent the same claim. */
  rationale: string;
  /**
   * Returns null when the Passport field has nothing relevant stored (fails
   * safe — never guesses a default). Otherwise returns the specific
   * Passport value being compared and whether it conflicts.
   */
  evaluate(
    passport: PassportSnapshot,
    tasteValue: string,
    dominantPolarity: TastePolarity,
  ): MappingEvaluation | null;
  /** Converts a raw Passport value into a short customer-facing phrase, e.g. "relaxed fits". */
  describePassportValue(value: string): string;
}

/**
 * Deliberately empty in V1 — see the module doc comment above for the
 * per-dimension audit of why none of the five current Taste dimensions
 * clear the deterministic-mapping bar. Populate an entry here only when a
 * dimension's Taste VALUE carries enough specific content to compare
 * one-for-one against an explicit Passport value.
 */
export const PASSPORT_TASTE_MAPPINGS: Partial<Record<TasteDimension, PassportTasteMapping>> = {};

// ── Resolution ───────────────────────────────────────────────────────────────

export type PassportContradictionStatus =
  | "no-explicit-equivalent" // this dimension has no supported mapping at all
  | "no-passport-data"       // a mapping exists, but the customer's Passport field is empty
  | "agrees"                 // a mapping exists and the Passport value does not conflict
  | "conflict";              // a mapping exists and found a deterministic conflict

export interface PassportContradictionResult {
  status: PassportContradictionStatus;
  dimension: string;
  passportField?: keyof PassportSnapshot;
  passportValue?: string;
}

/**
 * Pure comparison — never mutates `passport`, never touches the database.
 * `mappings` defaults to the production table but is injectable so tests can
 * exercise the resolution engine against a synthetic mapping without
 * depending on a real dimension gaining one.
 */
export function detectPassportContradiction(
  dimension: string,
  tasteValue: string,
  dominantPolarity: TastePolarity,
  passport: PassportSnapshot,
  mappings: Partial<Record<string, PassportTasteMapping>> = PASSPORT_TASTE_MAPPINGS,
): PassportContradictionResult {
  const mapping = mappings[dimension];
  if (!mapping) {
    return { status: "no-explicit-equivalent", dimension };
  }

  const evaluation = mapping.evaluate(passport, tasteValue, dominantPolarity);
  if (evaluation === null) {
    return { status: "no-passport-data", dimension, passportField: mapping.passportField };
  }

  return {
    status: evaluation.conflicts ? "conflict" : "agrees",
    dimension,
    passportField: mapping.passportField,
    passportValue: evaluation.passportValue,
  };
}

// ── Customer-facing text ─────────────────────────────────────────────────────

interface TextResult { claimText: string; rationaleText: string }

/**
 * Wraps the tendency's ALREADY-GENERATED claimText/rationaleText (the same
 * strings taste-contract.ts's generateTendencyText produced at write time
 * and taste-reconcile.server.ts persisted on the row) with conflict-aware
 * framing, only when detectPassportContradiction returned "conflict". This
 * never regenerates the base text — it reuses exactly what the existing
 * copy system already produced, and never invents a new feedback workflow:
 * Accurate/Not quite remain the only actions, and the caller must still
 * write feedback only to StyleTendency (see
 * api.taste-observation-feedback.tsx) — this function only changes copy.
 */
export function generateObservationText(
  baseClaimText: string,
  baseRationaleText: string,
  contradiction: PassportContradictionResult,
  mapping?: PassportTasteMapping,
): TextResult {
  if (contradiction.status !== "conflict" || !mapping || contradiction.passportValue === undefined) {
    return { claimText: baseClaimText, rationaleText: baseRationaleText };
  }

  const passportPhrase = mapping.describePassportValue(contradiction.passportValue);
  const baseClaimLower = baseClaimText.charAt(0).toLowerCase() + baseClaimText.slice(1);

  return {
    claimText: `You've told nAia ${passportPhrase}, but ${baseClaimLower} Is that becoming more your style?`,
    rationaleText: `${baseRationaleText} This may be evolving from what you shared in your Style Passport.`,
  };
}
