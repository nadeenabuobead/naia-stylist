/**
 * Shared Customer Intelligence — Phase 3 adapter, Wardrobe Intelligence
 * structural stream.
 *
 * Projects WI's existing DepthFinding/RegisterReading output into
 * ResolvedFinding[]. Read-only: consumes exactly what computeWardrobeNeeds()
 * already computed — never recomputes register depth, never touches
 * Closet/Passport structural logic. Zero live callers.
 *
 * signalClass is always "observed-state" — this is orthogonal structural
 * truth ("what the Closet currently contains"), never a preference claim,
 * and per the contract's own precedence rule must never be placed on
 * PRECEDENCE_ORDER by any future resolver.
 *
 * dimension reuses FindingKind verbatim ("could-use-more" | "enough" |
 * "effective-depth" | "repetition") rather than inventing new vocabulary —
 * the same "reuse what already exists" principle the two StyleMe adapters
 * followed with TasteEvidence's own `dimension` field.
 *
 * Only DepthFinding + RegisterReading are adapted. WI's recommendation
 * prose (WardrobeRecommendation.title/body/attributes, NotAPriority) is
 * deliberately NOT adapted here — those are recommendations derived from
 * this structural state, not the state itself.
 *
 * Temporal is always {kind:"none"} — WI computes register depth fresh from
 * current Closet contents on every call; there is no stored "as of"
 * timestamp anywhere in RegisterReading/DepthFinding to report honestly,
 * so none is invented.
 */

import type { DepthFinding, RegisterReading } from "~/lib/ai/wardrobe-needs";
import type { ResolvedFinding, ProvenanceRef } from "~/lib/ai/customer-intelligence-contract";

export const WARDROBE_INTELLIGENCE_SOURCE = "wardrobe-intelligence";

/**
 * customerFacingSafe: true. The underlying fact (this register's
 * distinctLooks/depthLabel) is already shown to the customer today via a
 * different, already-approved channel — the per-register "How your
 * wardrobe supports your life" reading and the "What deserves your
 * attention" section both render the same RegisterReading/DepthFinding
 * data this adapter reads, just as prose. This projects an already-shown
 * structural fact; it does not introduce a new one.
 *
 * cohortEligible: true. A register is one of three fixed, non-identifying
 * category values — as safe to coarsen as StyleMe demand's register
 * finding (Phase 2), for the same reason.
 */
export function adaptWardrobeFindings(
  findings: readonly DepthFinding[],
  registers: readonly RegisterReading[],
): ResolvedFinding[] {
  const byRegister = new Map(registers.map((r) => [r.register, r]));
  return findings.map((finding) => {
    const reading = byRegister.get(finding.register);
    const provenanceRefs: ProvenanceRef[] =
      finding.garmentIds.length > 0 ? [{ kind: "closet-state", itemIds: [...finding.garmentIds] }] : [];
    return {
      value: finding.register,
      signalClass: "observed-state",
      source: WARDROBE_INTELLIGENCE_SOURCE,
      dimension: finding.kind,
      provenanceRefs,
      support: { kind: "structural", value: reading?.distinctLooks, label: reading?.depthLabel },
      temporal: { kind: "none" },
      customerFacingSafe: true,
      cohortEligible: true,
    };
  });
}
