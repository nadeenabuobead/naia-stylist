/**
 * Shared Customer Intelligence — Phase 4 adapter, Buy-or-Skip outcome
 * stream.
 *
 * Reads BuySkipOutcome facts directly (not a frozen derivation module —
 * none exists for this table) and produces up to two findings per row,
 * because BOUGHT_IT and LOVE_IT are different customer facts:
 *
 *   - purchase-decision: what she decided to do (BOUGHT_IT / DIDNT_BUY_IT /
 *     STILL_DECIDING). Never carries a qualifier — bought/didn't-buy is an
 *     action, not a taste claim, and STILL_DECIDING is neither positive
 *     nor negative evidence about the category.
 *   - post-purchase-outcome: how owning it actually went (LOVE_IT /
 *     ITS_OKAY / RETURNED_IT). Only emitted when postPurchaseOutcome is
 *     set (which the DB layer already only allows alongside BOUGHT_IT).
 *     Carries a qualifier describing THIS specific post-purchase
 *     experience — not a universal preference for or against the whole
 *     garment category.
 *
 * Deliberately independent of extractBuySkipEvidence() (taste-
 * extraction.server.ts) rather than wrapping it: that function is pure but
 * scoped to TasteEvidence's narrower job (it hard-excludes ITS_OKAY and
 * never reads decision at all), so it cannot produce 5 of this adapter's
 * 7 states. The LOVE_IT->positive / RETURNED_IT->negative mapping is kept
 * consistent with it by design, not by calling it. This file does not
 * import taste-extraction.server.ts, taste-contract.ts, or write to
 * TasteEvidence — no existing behavior there changes.
 *
 * Both findings from one row share subject (the category) and provenance
 * (the one real BuySkipOutcome row) — they are two facts about the same
 * event, not two unrelated events.
 */

import type { ResolvedFinding, SignalClass } from "~/lib/ai/customer-intelligence-contract";

export const BUYSKIP_OUTCOME_SOURCE = "buy-skip-outcome";
export const BUYSKIP_PURCHASE_DECISION_DIMENSION = "purchase-decision";
export const BUYSKIP_POST_PURCHASE_OUTCOME_DIMENSION = "post-purchase-outcome";

export type BuySkipDecisionValue = "BOUGHT_IT" | "DIDNT_BUY_IT" | "STILL_DECIDING";
export type BuySkipPostOutcomeValue = "LOVE_IT" | "ITS_OKAY" | "RETURNED_IT";

export interface BuySkipOutcomeFact {
  id: string;
  customerId: string;
  category: string | null;
  decision: BuySkipDecisionValue;
  postPurchaseOutcome: BuySkipPostOutcomeValue | null;
  updatedAt: Date;
}

/**
 * STILL_DECIDING is explicit-demand, not explicit-outcome — it is an
 * unresolved state, not a settled real-world action. Promoting it to
 * explicit-outcome would put a pending decision on the same precedence
 * rung as a conclusive one.
 */
const DECISION_SIGNAL_CLASS: Readonly<Record<BuySkipDecisionValue, SignalClass>> = {
  BOUGHT_IT: "explicit-outcome",
  DIDNT_BUY_IT: "explicit-outcome",
  STILL_DECIDING: "explicit-demand",
};

const POST_PURCHASE_QUALIFIER: Readonly<Record<BuySkipPostOutcomeValue, "positive" | "negative" | "neutral">> = {
  LOVE_IT: "positive",
  ITS_OKAY: "neutral",
  RETURNED_IT: "negative",
};

export function adaptBuySkipOutcomeFindings(facts: readonly BuySkipOutcomeFact[]): ResolvedFinding[] {
  const findings: ResolvedFinding[] = [];

  for (const fact of facts) {
    const subject = fact.category ? { kind: "garment-category" as const, value: fact.category } : undefined;
    const temporal = { kind: "snapshot" as const, observedAt: fact.updatedAt.toISOString() };
    const provenanceRefs = [{ kind: "buy-skip-outcome" as const, id: fact.id }];

    findings.push({
      value: fact.decision,
      signalClass: DECISION_SIGNAL_CLASS[fact.decision],
      source: BUYSKIP_OUTCOME_SOURCE,
      dimension: BUYSKIP_PURCHASE_DECISION_DIMENSION,
      subject,
      provenanceRefs,
      support: { kind: "direct" },
      temporal,
      customerFacingSafe: true,
      cohortEligible: true,
    });

    if (fact.postPurchaseOutcome) {
      findings.push({
        value: fact.postPurchaseOutcome,
        signalClass: "explicit-outcome",
        source: BUYSKIP_OUTCOME_SOURCE,
        dimension: BUYSKIP_POST_PURCHASE_OUTCOME_DIMENSION,
        subject,
        provenanceRefs,
        support: { kind: "count", value: 1, qualifier: POST_PURCHASE_QUALIFIER[fact.postPurchaseOutcome] },
        temporal,
        customerFacingSafe: true,
        cohortEligible: true,
      });
    }
  }

  return findings;
}
