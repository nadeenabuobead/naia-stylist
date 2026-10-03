/**
 * Shared Customer Intelligence — Phase 5, the first live resolver.
 *
 * Responsibility, deliberately narrow: collect -> adapt -> filter -> return.
 * This is NOT a scoring engine. It does not collapse conflicting signal
 * classes, does not infer broad preferences, does not persist anything,
 * does not generate customer-facing prose, and does not make decisions for
 * any feature. Every finding it returns is exactly what one of the five
 * Phase 1-5 adapters already produces — this file's only job is deciding
 * which adapters to run for a given customer and handing back the union.
 *
 * Precedence (explicit-truth > explicit-outcome > explicit-demand >
 * derived-inference, observed-state orthogonal) is NOT applied here.
 * Contradictory findings are returned side by side — see
 * groupFindingsByDimension() below for the one small grouping helper this
 * phase provides. It is a convenience grouping operation ONLY — same
 * dimension does not mean semantic conflict, and grouping is not
 * reconciliation. See that function's own doc for why.
 *
 * Performance: targeted by design. Each include key loads only what it
 * needs:
 *   - "passport": one scalar OnboardingProfile select.
 *   - "styleme-outcome": one findMany (loadRawOutcomeFactsForEvidence),
 *     which lives in the neutral styleme-intelligence-facts.server.ts
 *     (moved there in this phase — it had zero functional dependency on
 *     WI) so this resolver reaches it directly, never through
 *     wardrobe-intelligence.server.ts.
 *   - "styleme-demand": one findMany (loadStyleMeDemandFacts). This one
 *     DOES still live in, and get imported from, wardrobe-intelligence
 *     .server.ts — its own output genuinely depends on WI's RegisterId
 *     vocabulary (see that file's comment on it), so this is a
 *     documented, currently-necessary coupling, not an oversight. Either
 *     way, it is still one plain findMany, no per-garment resolution.
 *   - "wardrobe-state": requires a WardrobeIntelligenceBundle the CALLER
 *     already computed. This resolver deliberately does NOT call
 *     loadWardrobeIntelligence() itself in this phase — every existing
 *     caller that wants wardrobe-state findings (today: Buy-or-Skip) was
 *     already calling loadWardrobeIntelligence() for its own reasons
 *     (recommendation criteria), so requiring the bundle here means WI is
 *     computed at most once per request, never duplicated. A future
 *     caller with no bundle of its own would need either to compute one
 *     first or a new resolver mode — not built here, since nothing today
 *     needs it.
 *   - "buyskip-considered" / "buyskip-outcome": one findMany each, newly
 *     added (no prior loader existed in this shape).
 *
 * No existing feature behavior changes by calling this file — it has
 * exactly one live caller as of this phase (Buy-or-Skip's wardrobe-context
 * read path), and that migration is designed to be semantically identical
 * to what Phase 3 built by hand.
 */

import prisma from "~/db.server";
import type { ResolvedFinding, SignalClass } from "~/lib/ai/customer-intelligence-contract";
import { adaptPassportFindings, type PassportFields } from "~/lib/ai/customer-intelligence-passport-adapter";
import {
  adaptStyleMeOutcomeFormulaFindings,
  adaptStyleMeOutcomeGarmentFindings,
} from "~/lib/ai/customer-intelligence-styleme-outcome-adapter";
import { adaptStyleMeDemandFindings } from "~/lib/ai/customer-intelligence-styleme-demand-adapter";
import { adaptWardrobeFindings } from "~/lib/ai/customer-intelligence-wardrobe-adapter";
import { adaptConsideredFindings } from "~/lib/ai/customer-intelligence-buyskip-considered-adapter";
import { adaptBuySkipOutcomeFindings, type BuySkipOutcomeFact } from "~/lib/ai/customer-intelligence-buyskip-outcome-adapter";
import { deriveFormulaEvidence, derivePositiveGarmentEvidence } from "~/lib/ai/wardrobe-feedback-evidence";
import { deriveStyleMeDemand } from "~/lib/ai/styleme-demand-evidence";
import { deriveConsideredEvents, type ConsideredAnalysisFact } from "~/lib/ai/buyskip-considered-evidence";
import { loadRawOutcomeFactsForEvidence } from "~/lib/ai/styleme-intelligence-facts.server";
import { loadStyleMeDemandFacts, type WardrobeIntelligenceBundle } from "~/lib/ai/wardrobe-intelligence.server";

export const INCLUDE_KEYS = [
  "passport",
  "styleme-outcome",
  "styleme-demand",
  "wardrobe-state",
  "buyskip-considered",
  "buyskip-outcome",
] as const;
export type IncludeKey = (typeof INCLUDE_KEYS)[number];

export interface ResolveCustomerIntelligenceOptions {
  customerId: string;
  /**
   * Required, not defaulted. An implicit "load everything" default is
   * incompatible with "wardrobe-state" needing a caller-supplied bundle —
   * resolveCustomerIntelligence({customerId}) would either have to throw
   * on a call that never mentioned wardrobe-state at all, or silently skip
   * a source the caller never asked to exclude. Neither is acceptable, so
   * source selection is explicit: name exactly what you want. Pass
   * INCLUDE_KEYS directly if "everything" is genuinely intended (and a
   * wardrobeIntelligence bundle is available).
   */
  include: readonly IncludeKey[];
  /** Required when include contains "wardrobe-state" — see the module doc
   * for why this resolver never computes it itself. */
  wardrobeIntelligence?: WardrobeIntelligenceBundle;
}

function wants(include: readonly IncludeKey[], key: IncludeKey): boolean {
  return include.includes(key);
}

async function loadPassportFields(customerId: string): Promise<PassportFields | null> {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: {
      onboardingProfile: {
        select: {
          favoriteColors: true, avoidColors: true, silhouette: true,
          lifestyle: true, dressingPreferences: true, updatedAt: true,
        },
      },
    },
  });
  return customer?.onboardingProfile ?? null;
}

async function loadBuySkipConsideredFacts(customerId: string): Promise<ConsideredAnalysisFact[]> {
  const rows = await prisma.buyOrSkipAnalysis.findMany({
    where: { customerId },
    select: {
      id: true, customerId: true, imagePublicId: true, imageUrl: true,
      category: true, colors: true, forOccasion: true, whatLike: true,
      unsureAbout: true, itemSize: true, colorNote: true, createdAt: true,
    },
  });
  return rows;
}

async function loadBuySkipOutcomeFacts(customerId: string): Promise<BuySkipOutcomeFact[]> {
  const rows: Array<{
    id: string;
    decision: BuySkipOutcomeFact["decision"];
    postPurchaseOutcome: BuySkipOutcomeFact["postPurchaseOutcome"];
    updatedAt: Date;
    analysis: { customerId: string; category: string | null };
  }> = await prisma.buySkipOutcome.findMany({
    where: { analysis: { customerId } },
    select: {
      id: true, decision: true, postPurchaseOutcome: true, updatedAt: true,
      analysis: { select: { customerId: true, category: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    customerId: row.analysis.customerId,
    category: row.analysis.category,
    decision: row.decision,
    postPurchaseOutcome: row.postPurchaseOutcome,
    updatedAt: row.updatedAt,
  }));
}

/**
 * collect -> adapt -> filter (via the caller's chosen include set) -> return.
 * Never scores, never collapses, never persists, never writes prose.
 */
export async function resolveCustomerIntelligence(
  options: ResolveCustomerIntelligenceOptions,
): Promise<ResolvedFinding[]> {
  const include = options.include;
  const findings: ResolvedFinding[] = [];

  if (wants(include, "passport")) {
    const profile = await loadPassportFields(options.customerId);
    findings.push(...adaptPassportFindings(profile));
  }

  if (wants(include, "styleme-outcome")) {
    const rawFacts = await loadRawOutcomeFactsForEvidence(options.customerId);
    const formulaEvidenceDetail = deriveFormulaEvidence(rawFacts);
    const positiveGarmentEvidence = derivePositiveGarmentEvidence(formulaEvidenceDetail);
    findings.push(...adaptStyleMeOutcomeFormulaFindings(formulaEvidenceDetail));
    findings.push(...adaptStyleMeOutcomeGarmentFindings(positiveGarmentEvidence));
  }

  if (wants(include, "styleme-demand")) {
    const demandFacts = await loadStyleMeDemandFacts(options.customerId);
    const derivation = deriveStyleMeDemand(demandFacts);
    findings.push(...adaptStyleMeDemandFindings(derivation));
  }

  if (wants(include, "wardrobe-state")) {
    if (!options.wardrobeIntelligence) {
      throw new Error(
        'resolveCustomerIntelligence: include contains "wardrobe-state" but no wardrobeIntelligence bundle was supplied. ' +
        "This resolver does not compute it internally in this phase — pass the bundle you already loaded.",
      );
    }
    findings.push(...adaptWardrobeFindings(options.wardrobeIntelligence.needs.couldUseMore, options.wardrobeIntelligence.needs.registers));
  }

  if (wants(include, "buyskip-considered")) {
    const facts = await loadBuySkipConsideredFacts(options.customerId);
    const events = deriveConsideredEvents(facts);
    findings.push(...adaptConsideredFindings(events));
  }

  if (wants(include, "buyskip-outcome")) {
    const facts = await loadBuySkipOutcomeFacts(options.customerId);
    findings.push(...adaptBuySkipOutcomeFindings(facts));
  }

  return findings;
}

// ── Filtering ────────────────────────────────────────────────────────────────
//
// Deliberately simple — field equality/membership only, no query language.

export interface FindingFilter {
  signalClass?: SignalClass | readonly SignalClass[];
  source?: string | readonly string[];
  dimension?: string | readonly string[];
  customerFacingSafe?: boolean;
  cohortEligible?: boolean;
}

function matches<T>(value: T, expected: T | readonly T[] | undefined): boolean {
  if (expected === undefined) return true;
  return Array.isArray(expected) ? (expected as readonly T[]).includes(value) : expected === value;
}

export function filterFindings(findings: readonly ResolvedFinding[], filter: FindingFilter): ResolvedFinding[] {
  return findings.filter(
    (f) =>
      matches(f.signalClass, filter.signalClass) &&
      matches(f.source, filter.source) &&
      matches(f.dimension, filter.dimension) &&
      (filter.customerFacingSafe === undefined || f.customerFacingSafe === filter.customerFacingSafe) &&
      (filter.cohortEligible === undefined || f.cohortEligible === filter.cohortEligible),
  );
}

// ── Grouping ─────────────────────────────────────────────────────────────────
//
// The one small helper this phase provides for "what does everything say
// about X" — a convenience grouping operation, nothing more. It groups; it
// does not reconcile, score, or detect conflict. Two findings sharing a
// dimension are NOT automatically in semantic conflict — they may be the
// same claim from two sources (agreement), two different claims about the
// same subject (the genuinely interesting case precedence would need to
// resolve), or, now that ResolvedFinding can carry `subject`, two claims
// that merely LOOK related by dimension but are about different subjects
// entirely (e.g. two "purchase-decision" findings for two different
// garment categories land in the same group here purely because they
// share a dimension, despite having nothing to do with each other).
// A real future conflict-resolution step will likely need to key on
// dimension + subject + context together, not dimension alone — do not
// build that here; this helper exists only so a caller doesn't have to
// write its own grouping loop, not to imply grouping is reconciliation.
//
// Keyed by dimension, the established vocabulary for "what semantic
// question a finding answers" (see the contract's own dimension doc). No
// cross-source collision exists among today's six sources' dimension
// names, but this groups by dimension alone, not source+dimension, so a
// future source reusing a dimension name would intentionally merge into
// the same group.
export function groupFindingsByDimension(findings: readonly ResolvedFinding[]): Map<string, ResolvedFinding[]> {
  const groups = new Map<string, ResolvedFinding[]>();
  for (const finding of findings) {
    const arr = groups.get(finding.dimension) ?? [];
    arr.push(finding);
    groups.set(finding.dimension, arr);
  }
  return groups;
}
