// app/lib/buyskip/decision-evidence.server.ts
// Stable decision-evidence contract (Phase 8 of the Buy/Skip product foundation).
//
// This is the shape a future deterministic Buy/Skip decision engine will
// consume once ResolvedPassport, ResolvedGarment/GI, Wardrobe Intelligence,
// and Taste/Evidence are all wired in. Today only productFacts,
// duplicateEvidence, and constraintEvidence are backed by real computation;
// wardrobeNeed and tasteEvidence are explicit "unavailable" placeholders and
// passportAlignment is "deferred_to_resolved_passport" whenever a requirement
// exists that this layer cannot safely evaluate (free-text dressing note).
//
// The model must not manufacture this evidence — it is computed here, in
// code, from the vision model's own stated observations plus data already on
// file. The model's job stays scoped to turning evidence into customer-facing
// language; see applyHardConstraintVeto for the one place evidence is allowed
// to override the model's own verdict outright.

import type { ProductFacts } from "./product-facts.server";
import type { DuplicateEvidence } from "./duplicate-evidence.server";
import type { ConstraintEvidence, ColourPreferenceEvidence } from "./constraint-evidence.server";
import type { WardrobeNeedEvidence } from "./wardrobe-need.server";
import type { OutcomeHistoryEvidence } from "./outcome-history-evidence.server";
import type { WardrobeUtilityEvidence } from "./wardrobe-utility-evidence.server";

export type BuySkipDecisionState = "BUY" | "LEAN_BUY" | "LEAN_SKIP" | "SKIP" | "INSUFFICIENT_EVIDENCE";

export interface DecisionEvidence {
  productFacts: ProductFacts;
  duplicateEvidence: DuplicateEvidence;
  constraintEvidence: ConstraintEvidence;
  /** B2b1 — advisory only. Never read by applyHardConstraintVeto. */
  colourPreferenceEvidence: ColourPreferenceEvidence;
  wardrobeNeed: WardrobeNeedEvidence;
  /** B3 — the customer's own past explicit purchase outcomes for this exact
   * candidate's category. Evidence only: never read by applyHardConstraintVeto
   * or applyVerdictOverride, never injected into the AI prompt. Older
   * persisted records (pre-B3) simply lack this field — always optional-chain
   * when reading it back. */
  outcomeHistory: OutcomeHistoryEvidence;
  /** B4 — redundancy/gap/utility evidence read from Wardrobe Intelligence's
   * own already-computed findings for the customer's current Closet.
   * wardrobeNeed above is derived from this same evidence for backward
   * compatibility; this field carries the fuller provenance. Evidence only:
   * never read by applyHardConstraintVeto or applyVerdictOverride, never
   * injected into the AI prompt. Older persisted records (pre-B4) simply
   * lack this field — always optional-chain when reading it back. */
  wardrobeUtility: WardrobeUtilityEvidence;
  passportAlignment: "available" | "deferred_to_resolved_passport";
  tasteEvidence: "unavailable";
  provenance: {
    computedAt: string;
    schemaVersion: string;
  };
}

export const DECISION_EVIDENCE_SCHEMA_VERSION = "buyskip-decision-evidence-v2";

export function assembleDecisionEvidence(input: {
  productFacts: ProductFacts;
  duplicateEvidence: DuplicateEvidence;
  constraintEvidence: ConstraintEvidence;
  colourPreferenceEvidence: ColourPreferenceEvidence;
  wardrobeNeed: WardrobeNeedEvidence;
  outcomeHistory: OutcomeHistoryEvidence;
  wardrobeUtility: WardrobeUtilityEvidence;
  computedAt: string;
}): DecisionEvidence {
  return {
    productFacts: input.productFacts,
    duplicateEvidence: input.duplicateEvidence,
    constraintEvidence: input.constraintEvidence,
    colourPreferenceEvidence: input.colourPreferenceEvidence,
    wardrobeNeed: input.wardrobeNeed,
    outcomeHistory: input.outcomeHistory,
    wardrobeUtility: input.wardrobeUtility,
    passportAlignment: input.constraintEvidence.deferredToResolvedPassport ? "deferred_to_resolved_passport" : "available",
    tasteEvidence: "unavailable",
    provenance: {
      computedAt: input.computedAt,
      schemaVersion: DECISION_EVIDENCE_SCHEMA_VERSION,
    },
  };
}

export interface VetoResult {
  verdict: "SKIP";
  vetoed: true;
  vetoReason: string;
}

export interface NoVetoResult {
  verdict: null;
  vetoed: false;
  vetoReason: null;
}

/**
 * The one place code is allowed to override the model's own verdict outright.
 * A hard dressing-requirement violation is a literal contradiction between a
 * customer's explicit requirement and the garment's own observed
 * construction — not a judgement call the model should be trusted to make
 * consistently. Soft/unknown evidence never triggers this; only a confirmed
 * "violated" check does.
 *
 * B2b1 — colourPreferenceEvidence is NOT a ConstraintCheck and is never
 * passed into this function; an avoid-colour match can never, by itself,
 * reach this veto. See constraint-evidence.server.ts for why.
 */
export function applyHardConstraintVeto(constraintEvidence: ConstraintEvidence): VetoResult | NoVetoResult {
  if (!constraintEvidence.hasHardViolation) {
    return { verdict: null, vetoed: false, vetoReason: null };
  }
  const violated = constraintEvidence.checks.filter(c => c.state === "violated").map(c => c.label);
  return {
    verdict: "SKIP",
    vetoed: true,
    vetoReason: `This conflicts with a dressing requirement on your Passport: ${violated.join(", ")}.`,
  };
}
