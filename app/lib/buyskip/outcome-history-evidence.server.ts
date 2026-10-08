// app/lib/buyskip/outcome-history-evidence.server.ts
// B3 — summarizes the customer's own past Buy/Skip purchase outcomes into a
// small, deterministic piece of decisionEvidence for the CURRENT candidate.
//
// Pure derivation module: no Prisma, no LLM, no side effects. Takes
// already-resolved ResolvedFinding[] from resolveCustomerIntelligence's
// "buyskip-outcome" include (which reads BuySkipOutcome directly — never
// TasteEvidence/StyleTendency; see taste-evidence-consumer-boundary.test.ts,
// which this file must never appear as an importer of any taste-engine
// module in). Same "pure function over already-fetched facts" shape as
// buyskip-considered-evidence.ts, wardrobe-feedback-evidence.ts, and
// styleme-demand-evidence.ts.
//
// nAia verdict != customer truth: this module reads nothing about what
// nAia concluded on any past analysis, model confidence, or match label —
// its only inputs are the customer's own explicit post-purchase reports
// (LOVE_IT / RETURNED_IT), already classified "explicit-outcome" upstream
// by customer-intelligence-buyskip-outcome-adapter.ts. The "considered"
// stream (explicit-demand — "I submitted this for evaluation") is a
// different dimension and is never read here; submitting something for
// assessment is not taste evidence.
//
// ITS_OKAY is deliberately excluded, matching the Taste writer's own
// established policy (taste-extraction.server.ts skips it for the same
// reason: neither positive nor negative evidence). This is a deliberate
// consistency choice with that precedent, not a new semantic decision.
//
// Matching is exact-category-string only — Buy/Skip's `category` field is
// free text with no canonical-garment-family resolution wired to it
// anywhere in this codebase (that is Garment Intelligence/ResolvedGarment
// territory, which this module does not touch). Exact-string matching is
// the narrowest defensible V1; broadening to a canonical family would be a
// new product decision, not implemented here.
//
// No aggregation beyond a plain count. A single matching event is reported
// as exactly that — "1 previous purchase you loved in this category" — never
// escalated into a sweeping claim ("you love this category"). That framing
// decision belongs to whatever customer-facing surface eventually reads
// this (not built in B3 — see the module's own report), not to this layer.

import type { ResolvedFinding } from "~/lib/ai/customer-intelligence-contract";
import {
  BUYSKIP_OUTCOME_SOURCE,
  BUYSKIP_POST_PURCHASE_OUTCOME_DIMENSION,
} from "~/lib/ai/customer-intelligence-buyskip-outcome-adapter";

export type OutcomeHistoryEvidence =
  | { available: false }
  | {
      available: true;
      category: string;
      lovedCount: number;
      returnedCount: number;
      /** The specific BuySkipOutcome row ids this summary was computed from —
       * not an opaque aggregate. Lets decisionEvidence trace exactly which
       * past customer reports contributed, never "nAia remembers you don't
       * like this" with no receipt. */
      provenanceIds: string[];
    };

const POSITIVE_VALUE = "LOVE_IT";
const NEGATIVE_VALUE = "RETURNED_IT";
// NEUTRAL_VALUE = "ITS_OKAY" — intentionally never matched below.

export function summarizeOutcomeHistory(
  category: string | null,
  findings: readonly ResolvedFinding[],
): OutcomeHistoryEvidence {
  if (!category) return { available: false };

  const matches = findings.filter(
    (f) =>
      f.source === BUYSKIP_OUTCOME_SOURCE &&
      f.dimension === BUYSKIP_POST_PURCHASE_OUTCOME_DIMENSION &&
      f.subject?.kind === "garment-category" &&
      f.subject.value === category &&
      (f.value === POSITIVE_VALUE || f.value === NEGATIVE_VALUE),
  );

  if (matches.length === 0) return { available: false };

  let lovedCount = 0;
  let returnedCount = 0;
  const provenanceIds: string[] = [];

  for (const finding of matches) {
    if (finding.value === POSITIVE_VALUE) lovedCount++;
    else if (finding.value === NEGATIVE_VALUE) returnedCount++;
    for (const ref of finding.provenanceRefs) {
      if (ref.kind === "buy-skip-outcome") provenanceIds.push(ref.id);
    }
  }

  return { available: true, category, lovedCount, returnedCount, provenanceIds };
}
