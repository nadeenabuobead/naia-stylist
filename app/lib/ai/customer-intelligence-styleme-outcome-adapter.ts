/**
 * Shared Customer Intelligence — Phase 2 adapter, StyleMe outcome stream.
 *
 * Projects the frozen wardrobe-feedback-evidence.ts output into
 * ResolvedFinding[]. Read-only: consumes that module's already-derived
 * Maps, never re-reads the database and never reimplements its dedup or
 * formula-integrity logic. Zero live callers — nothing in WI, StyleMe, or
 * any other feature imports this file. See customer-intelligence-contract.ts
 * for the shared shape.
 *
 * Every finding uses the one real source, "styleme-outcome" — it names
 * WHERE the evidence came from. WHAT the value represents (a formula vs. a
 * garment) is `dimension`, not a suffix baked into source. Direction
 * (positive/negative/mixed) lives on support.qualifier, never on source or
 * signalClass — see the contract's own comment on this for why a "mixed"
 * finding must never be mistaken for affirmative just because
 * signalClass === "explicit-outcome".
 *
 * Provenance limitation, reported rather than worked around: FormulaEvidence
 * and GarmentPositiveEvidence (the frozen module's public output) do not
 * retain individual StyleMeOutcome row ids — only the derived formulaKey,
 * garmentIds, and calendar-date strings survive from the raw
 * RawOutcomeFact.outcomeId that fed them. Provenance here uses the
 * contract's styleme-outcome-formula / styleme-outcome-garment variants —
 * honest references to those real aggregates — never the raw
 * { kind: "styleme-outcome"; id } variant, which is reserved for a future
 * adapter that genuinely holds a row id. If submission-level provenance is
 * ever required, it would need the frozen module's public shape to
 * change — not something this adapter does silently.
 *
 * Preserves three distinct kinds of finding per formula, never merged:
 *   - positive support (wore-it dates) — support.qualifier: "positive",
 *     carrying the frozen module's own tier (supported/strongly-supported)
 *   - negative evidence (changed-something dates) — qualifier: "negative".
 *     Never reinterpreted as positive preference; the frozen module
 *     already keeps these as a separate, differently-named signal, and
 *     this adapter does too. No tier — the frozen module has no
 *     STRONGLY_SUPPORTED-style threshold for negative evidence.
 *   - mixed/ambiguous evidence (same-day conflicting dates) —
 *     qualifier: "mixed". Its own finding, never folded into positive or
 *     negative.
 * A formula with multiple kinds of evidence produces multiple findings,
 * not one conflated finding.
 *
 * Passive generation (a session/suggestion with no outcome) was never part
 * of FormulaEvidence/GarmentPositiveEvidence to begin with — the frozen
 * module only derives from StyleMeOutcome rows — so there is nothing for
 * this adapter to accidentally treat as evidence.
 */

import type { FormulaEvidence, GarmentPositiveEvidence } from "~/lib/ai/wardrobe-feedback-evidence";
import type { ResolvedFinding } from "~/lib/ai/customer-intelligence-contract";

export const STYLEME_OUTCOME_SOURCE = "styleme-outcome";
export const STYLEME_OUTCOME_FORMULA_DIMENSION = "outfit-formula";
export const STYLEME_OUTCOME_GARMENT_DIMENSION = "garment";

/**
 * Formula-level findings — up to three per formula (positive / negative /
 * mixed), each only when that date array is non-empty.
 *
 * customerFacingSafe: false for all of them. The underlying evidence already
 * influences the customer experience today (buildPairings' tie-break,
 * buildRediscover's priority adjustment), but no copy anywhere states a
 * sentence like "this combination is supported because you wore it N
 * times" — the customer never sees this as an explicit claim, only as an
 * invisible ranking influence. A raw/internal finding is not automatically
 * customer-facing just because its source is explicit.
 *
 * cohortEligible: false for all of them. A formulaKey identifies one exact
 * garment combination, which is too specific to safely coarsen into a
 * cohort statistic — a category-level rollup that could be aggregated
 * safely does not exist as a computed value anywhere yet.
 */
export function adaptStyleMeOutcomeFormulaFindings(
  formulaEvidence: ReadonlyMap<string, FormulaEvidence>,
): ResolvedFinding[] {
  const findings: ResolvedFinding[] = [];
  for (const evidence of formulaEvidence.values()) {
    if (evidence.positiveDates.length > 0) {
      findings.push(formulaFinding(evidence, evidence.positiveDates, "positive", evidence.state));
    }
    if (evidence.negativeDates.length > 0) {
      findings.push(formulaFinding(evidence, evidence.negativeDates, "negative"));
    }
    if (evidence.mixedDates.length > 0) {
      findings.push(formulaFinding(evidence, evidence.mixedDates, "mixed"));
    }
  }
  return findings;
}

function formulaFinding(
  evidence: FormulaEvidence,
  dates: readonly string[],
  qualifier: "positive" | "negative" | "mixed",
  tier?: string,
): ResolvedFinding {
  return {
    value: evidence.formulaKey,
    signalClass: "explicit-outcome",
    source: STYLEME_OUTCOME_SOURCE,
    dimension: STYLEME_OUTCOME_FORMULA_DIMENSION,
    provenanceRefs: [{ kind: "styleme-outcome-formula", formulaKey: evidence.formulaKey }],
    support: { kind: "count", value: dates.length, qualifier, ...(tier ? { tier } : {}) },
    temporal: { kind: "range", firstSeen: dates[0], lastSeen: dates[dates.length - 1] },
    customerFacingSafe: false,
    cohortEligible: false,
  };
}

/**
 * Garment-level findings — one per garment with at least one verified
 * positive date (GarmentPositiveEvidence never contains an empty-dates
 * entry; derivePositiveGarmentEvidence() already filters that out). Always
 * qualifier: "positive" — there is no negative/mixed garment-level
 * evidence in the frozen module.
 *
 * customerFacingSafe / cohortEligible: same rule and same reasoning as the
 * formula-level findings — no approved customer-facing copy exists for this
 * finding shape yet, and a single garment id is still too specific to
 * coarsen safely.
 */
export function adaptStyleMeOutcomeGarmentFindings(
  positiveGarmentEvidence: ReadonlyMap<string, GarmentPositiveEvidence>,
): ResolvedFinding[] {
  return [...positiveGarmentEvidence.values()].map((evidence) => ({
    value: evidence.closetItemId,
    signalClass: "explicit-outcome",
    source: STYLEME_OUTCOME_SOURCE,
    dimension: STYLEME_OUTCOME_GARMENT_DIMENSION,
    provenanceRefs: [{ kind: "styleme-outcome-garment", closetItemId: evidence.closetItemId }],
    support: { kind: "count", value: evidence.positiveDates.length, qualifier: "positive" },
    temporal: {
      kind: "range",
      firstSeen: evidence.positiveDates[0],
      lastSeen: evidence.positiveDates[evidence.positiveDates.length - 1],
    },
    customerFacingSafe: false,
    cohortEligible: false,
  }));
}
