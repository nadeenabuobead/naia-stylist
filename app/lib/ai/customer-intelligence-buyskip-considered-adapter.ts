/**
 * Shared Customer Intelligence — Phase 4 adapter, Buy-or-Skip considered
 * stream.
 *
 * Projects deriveConsideredEvents()'s output (buyskip-considered-
 * evidence.ts) into ResolvedFinding[]. Read-only: consumes the already-
 * deduped considered-event list, never re-derives or recomputes it, and
 * never reads BuyOrSkipAnalysis directly.
 *
 * signalClass is "explicit-demand" — "I submitted this for evaluation"
 * means only that: not that she liked it, wanted to buy it, or bought it.
 * Deliberately does not touch colors/forOccasion/whatLike/unsureAbout —
 * those remain free text / deferred, same as Phase 3's forOccasion
 * exclusion for Wardrobe Intelligence.
 */

import type { ConsideredEvent } from "~/lib/ai/buyskip-considered-evidence";
import type { ResolvedFinding } from "~/lib/ai/customer-intelligence-contract";

export const BUYSKIP_CONSIDERED_SOURCE = "buy-skip-analysis";
export const BUYSKIP_CONSIDERED_DIMENSION = "considered-category";

/**
 * customerFacingSafe: true — category is something she typed herself, and
 * it's echoed back to her on the Buy-or-Skip result page already.
 * cohortEligible: true — a small, non-identifying category vocabulary.
 */
export function adaptConsideredFindings(events: readonly ConsideredEvent[]): ResolvedFinding[] {
  return events.map((event) => ({
    value: event.category,
    signalClass: "explicit-demand",
    source: BUYSKIP_CONSIDERED_SOURCE,
    dimension: BUYSKIP_CONSIDERED_DIMENSION,
    provenanceRefs: [{ kind: "buy-skip-analysis", id: event.id }],
    support: { kind: "direct" },
    temporal: { kind: "snapshot", observedAt: event.observedAt.toISOString() },
    customerFacingSafe: true,
    cohortEligible: true,
  }));
}
