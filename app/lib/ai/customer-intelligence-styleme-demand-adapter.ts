/**
 * Shared Customer Intelligence — Phase 2 adapter, StyleMe demand stream.
 *
 * Projects the frozen styleme-demand-evidence.ts output into
 * ResolvedFinding[]. Read-only: consumes StyleMeDemandDerivation exactly as
 * deriveStyleMeDemand() returns it — never re-reads the database, never
 * recomputes the 90-day window, the 2-minute retry collapse, or the
 * synthetic-collision exclusion. Zero live callers.
 *
 * Demand is explicit-demand, never preference: a request is not evidence
 * that she liked, wore, or would buy anything. No polarity is introduced
 * anywhere in this file — FindingSupport's "count" kind is used bare, with
 * neither `qualifier` nor `tier` ever set. Both are outcome-specific
 * concepts (direction, source-native supported-ness) that simply don't
 * apply to a request.
 *
 * Every finding uses the one real source, "styleme-demand" — it names
 * WHERE the evidence came from. WHAT the value represents (a register vs.
 * an intention) is `dimension`, not a suffix baked into source — a
 * resolver reads (source, value) by checking dimension, never by parsing
 * the source string.
 *
 * Body/comfort-sensitive data is not reachable from here at all —
 * RawStyleMeDemandFact (the frozen module's own input shape) has no
 * bodyNeeds field; demand V1 was never wired to that data.
 */

import type { StyleMeDemandDerivation } from "~/lib/ai/styleme-demand-evidence";
import type { ResolvedFinding, ProvenanceRef } from "~/lib/ai/customer-intelligence-contract";

export const STYLEME_DEMAND_SOURCE = "styleme-demand";
export const STYLEME_DEMAND_REGISTER_DIMENSION = "register";
export const STYLEME_DEMAND_INTENTION_DIMENSION = "intention";

/**
 * Register-demand findings.
 *
 * customerFacingSafe: true. This is not a new claim — WI's live
 * "Recently, you most often ask for…" summary line and the dress-level
 * reveal sentence already state exactly this fact (register + deduped
 * 90-day count), reading from the same frozen demand layer. This adapter
 * projects an already-approved claim into the shared shape; it does not
 * introduce one.
 *
 * cohortEligible: true. A register is one of three fixed, non-identifying
 * category values — safe to coarsen into a cohort statistic.
 */
function registerFindings(derivation: StyleMeDemandDerivation): ResolvedFinding[] {
  return derivation.registerDemand.map((r) => ({
    value: r.register,
    signalClass: "explicit-demand",
    source: STYLEME_DEMAND_SOURCE,
    dimension: STYLEME_DEMAND_REGISTER_DIMENSION,
    provenanceRefs: provenanceForEvents(derivation, (e) => e.register === r.register),
    support: { kind: "count", value: r.eventCount },
    temporal: { kind: "range", firstSeen: r.firstSeen, lastSeen: r.lastSeen },
    customerFacingSafe: true,
    cohortEligible: true,
  }));
}

/**
 * Intention-demand findings.
 *
 * customerFacingSafe: false. A cousin sentence exists today
 * (IntentionReading.chosen's "what you most often ask to feel"), but it
 * reads the old, raw, undeduped session list, not this clean 90-day layer —
 * and migrating that specific wording was explicitly deferred as its own
 * product decision (the "by far" ratio changes non-neutrally between the
 * two sources). Marking this customer-facing-safe here would quietly
 * pre-approve that deferred decision. It stays false until that decision is
 * made on its own.
 *
 * cohortEligible: true. Intentions are drawn from a fixed, bounded
 * vocabulary (INTENTION_LABELS) — as non-identifying as a register for
 * aggregation purposes, independent of whether it's shown to the
 * individual customer yet.
 */
function intentionFindings(derivation: StyleMeDemandDerivation): ResolvedFinding[] {
  return derivation.intentionDemand.map((i) => ({
    value: i.intention,
    signalClass: "explicit-demand",
    source: STYLEME_DEMAND_SOURCE,
    dimension: STYLEME_DEMAND_INTENTION_DIMENSION,
    provenanceRefs: provenanceForEvents(derivation, (e) => e.intentions.includes(i.intention)),
    support: { kind: "count", value: i.eventCount },
    temporal: { kind: "range", firstSeen: i.firstSeen, lastSeen: i.lastSeen },
    customerFacingSafe: false,
    cohortEligible: true,
  }));
}

/** Re-derives provenance from the SAME deduped events the frozen module
 * already aggregated register/intention counts from — not a re-dedup, just
 * reading the one array that was always part of its output. */
function provenanceForEvents(
  derivation: StyleMeDemandDerivation,
  matches: (event: StyleMeDemandDerivation["events"][number]) => boolean,
): ProvenanceRef[] {
  return derivation.events.filter(matches).map((e) => ({ kind: "styleme-demand", id: e.sessionId }));
}

export function adaptStyleMeDemandFindings(derivation: StyleMeDemandDerivation): ResolvedFinding[] {
  return [...registerFindings(derivation), ...intentionFindings(derivation)];
}
