// app/lib/ai/design-signal.ts
//
// THE DESIGN SIGNAL CONTRACT.
//
// One customer's wardrobe evidence, shaped so a future NADINE designer view can
// aggregate it without re-deriving anything. This is the seam between the two
// products, and the direction of the dependency is the whole point:
//
//     Wardrobe Intelligence  →  design signal  →  (later) designer aggregation
//
// Never the other way. Nothing in this module — or anything it imports — may
// read the NADINE catalogue, because a need that exists because there is a
// product to sell is not a need. wardrobe-boundary.test.ts enforces that.
//
// This module is a PROJECTION. It recomputes no finding, invents no number and
// decides nothing is missing; every claim it carries came from the needs layer
// and says where it came from.

import type { WardrobeNeeds, RegisterId } from "~/lib/ai/wardrobe-needs";
import type { WardrobeRecommendations } from "~/lib/ai/wardrobe-recommendations";

/**
 * How far a piece of evidence has travelled from guess to fact.
 *
 * The distinction the designer brief turns on: nAia noticing something is not
 * the customer asking for it, and nAia repeating itself is not demand. A signal
 * cannot be promoted past the stage its evidence actually reached.
 */
export type EvidenceStage =
  /** nAia derived this from the wardrobe. The customer has not said it. */
  | "inferred"
  /** The customer stated it — a Passport answer, or an explicit request. */
  | "confirmed"
  /** The customer liked a concept, at a stated price. */
  | "concept-liked"
  /** The customer bought it. */
  | "purchased"
  /** The customer reported back after wearing it. */
  | "post-purchase";

export const EVIDENCE_STAGES: readonly EvidenceStage[] = [
  "inferred", "confirmed", "concept-liked", "purchased", "post-purchase",
];

/** Where a claim came from. Every claim carries one; none may be omitted. */
export type SignalSource = "passport" | "closet" | "styleme" | "feedback";

export type Confidence = "strong" | "moderate" | "unknown";

export interface SignalClaim {
  /** Plain statement of the evidence. Never a recommendation. */
  statement: string;
  source: SignalSource;
  stage: EvidenceStage;
  confidence: Confidence;
}

export interface DesignSignal {
  /** Stable per customer and need, so re-reads do not inflate any count. */
  id: string;
  customerId: string;
  register: RegisterId;

  /** The unresolved need, in the needs layer's own words. */
  need: string;
  /** What the wardrobe cannot currently do. */
  missingCapability: string;

  /** Stated Passport requirements that constrain any answer to this need. */
  passportRequirements: string[];
  /** Named colours the Closet barely represents. Context, never a need itself. */
  underrepresentedColours: string[];
  /** Coverage and fit requirements that any candidate must respect. */
  fitCoverageRequirements: string[];

  /** Supported combinations at this register, and whether they repeat. */
  depth: { distinctLooks: number; usableCount: number; repeats: boolean };

  claims: SignalClaim[];
  /** The furthest stage any claim reached. Never higher than the evidence. */
  stage: EvidenceStage;
  confidence: Confidence;

  /**
   * How complete the Closet is known to be. A signal from a wardrobe that is
   * still being uploaded is weaker evidence, and says so rather than being
   * silently counted the same.
   */
  closetCompleteness: "mostly" | "still-adding" | "unknown";
}

// ── Building ──────────────────────────────────────────────────────────────────

function highestStage(claims: SignalClaim[]): EvidenceStage {
  let best: EvidenceStage = "inferred";
  for (const c of claims) {
    if (EVIDENCE_STAGES.indexOf(c.stage) > EVIDENCE_STAGES.indexOf(best)) best = c.stage;
  }
  return best;
}

function weakestConfidence(claims: SignalClaim[]): Confidence {
  if (claims.some((c) => c.confidence === "unknown")) return "unknown";
  if (claims.some((c) => c.confidence === "moderate")) return "moderate";
  return claims.length > 0 ? "strong" : "unknown";
}

export interface DesignSignalInput {
  customerId: string;
  needs: WardrobeNeeds;
  recommendations: WardrobeRecommendations;
  closetCompleteness: "mostly" | "still-adding" | "unknown";
  /** Passport requirements that constrain candidates, already in plain words. */
  passportRequirements?: string[];
  fitCoverageRequirements?: string[];
  underrepresentedColours?: string[];
}

/**
 * One signal per unresolved need — never one per garment, and never one per
 * recommendation nAia made.
 *
 * That is deliberate. Counting recommendations would let nAia's own repetition
 * look like customer demand, and counting garments would give whoever uploaded
 * the most clothes the loudest voice. A customer with an enormous Closet and a
 * customer with a small one each contribute at most one signal per need.
 */
export function buildDesignSignals(input: DesignSignalInput): DesignSignal[] {
  const {
    customerId, needs, recommendations, closetCompleteness,
    passportRequirements = [], fitCoverageRequirements = [], underrepresentedColours = [],
  } = input;

  if (needs.state !== "available") return [];

  const byRegister = new Map(needs.registers.map((r) => [r.register, r]));
  const recByRegister = new Map(recommendations.recommendations.map((r) => [r.register, r]));

  return needs.couldUseMore.map((finding) => {
    const reading = byRegister.get(finding.register);
    const rec = recByRegister.get(finding.register);

    const claims: SignalClaim[] = [
      {
        statement: finding.title,
        source: "closet",
        // nAia worked this out. She has not asked for it.
        stage: "inferred",
        confidence: finding.strength === "strong" ? "strong" : "moderate",
      },
    ];

    // Her own words about the life being dressed for. This IS stated.
    if (reading?.needed) {
      claims.push({
        statement: `She told nAia that ${reading.label} dressing matters to her.`,
        source: "passport",
        stage: "confirmed",
        confidence: "strong",
      });
    }

    // What she has actually asked nAia for, counted from sessions.
    const requested = needs.styleMe.requests.find((r) => r.register === finding.register);
    if (requested && requested.sessions > 0) {
      claims.push({
        statement: `She has asked nAia for this kind of dressing ${requested.sessions} times.`,
        source: "styleme",
        stage: "confirmed",
        confidence: "strong",
      });
    }

    // Anything she reported back after wearing.
    if (needs.outcomes.state === "available" && needs.outcomes.totalOutcomes > 0) {
      const note = [needs.outcomes.keptNote, needs.outcomes.changedNote].filter(Boolean).join(" ");
      if (note !== "") {
        claims.push({
          statement: note,
          source: "feedback",
          stage: "post-purchase",
          confidence: "moderate",
        });
      }
    }

    return {
      id: `${customerId}:${finding.register}:${finding.id}`,
      customerId,
      register: finding.register,
      need: finding.title,
      missingCapability: rec?.title ?? finding.body,
      passportRequirements,
      underrepresentedColours,
      fitCoverageRequirements,
      depth: {
        distinctLooks: reading?.distinctLooks ?? 0,
        usableCount: reading?.usableCount ?? 0,
        repeats: finding.kind === "could-use-more",
      },
      claims,
      stage: highestStage(claims),
      confidence: weakestConfidence(claims),
      closetCompleteness,
    };
  });
}

// ── Aggregation safety ────────────────────────────────────────────────────────

/**
 * What a later dashboard is allowed to count.
 *
 * Deliberately not an aggregation — that is not being built yet. It is the
 * shape the aggregation must produce, so the rules live with the contract
 * rather than being reinvented alongside the UI.
 */
export interface AggregationBucket {
  key: string;
  /** DISTINCT customers, never signal count. */
  customers: number;
  /** The population this was drawn from. A count with no denominator is noise. */
  denominator: number;
  /** Furthest stage reached by ANY contributing customer, reported honestly. */
  stage: EvidenceStage;
  /** Customers whose Closet is not known to be substantially complete. */
  incompleteClosets: number;
}

/** Below this, a group is reported as suppressed rather than shown. */
export const MIN_GROUP_SIZE = 5;

/**
 * Groups signals by need, counting people rather than rows.
 *
 * Two rules that are easy to get wrong and expensive to get wrong: a customer
 * with fifty signals still counts once, and co-occurrence is only true WITHIN
 * one customer — "some like grey" plus "some like wide-leg" is not evidence for
 * grey wide-leg trousers.
 */
export function bucketByNeed(signals: DesignSignal[], denominator: number): AggregationBucket[] {
  const groups = new Map<string, DesignSignal[]>();
  for (const s of signals) {
    const key = `${s.register}:${s.need}`;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }

  return [...groups.entries()].map(([key, group]) => {
    const customers = new Set(group.map((s) => s.customerId));
    return {
      key,
      customers: customers.size,
      denominator,
      stage: highestStage(group.flatMap((s) => s.claims)),
      incompleteClosets: new Set(
        group.filter((s) => s.closetCompleteness !== "mostly").map((s) => s.customerId),
      ).size,
    };
  });
}

/**
 * Do these two requirements genuinely occur together?
 *
 * Only if the SAME people hold both. Counted across two populations this is the
 * classic way to invent a product nobody asked for.
 */
export function coOccurrence(
  signals: DesignSignal[],
  predicateA: (s: DesignSignal) => boolean,
  predicateB: (s: DesignSignal) => boolean,
): number {
  const byCustomer = new Map<string, DesignSignal[]>();
  for (const s of signals) byCustomer.set(s.customerId, [...(byCustomer.get(s.customerId) ?? []), s]);

  let both = 0;
  for (const group of byCustomer.values()) {
    if (group.some(predicateA) && group.some(predicateB)) both += 1;
  }
  return both;
}
