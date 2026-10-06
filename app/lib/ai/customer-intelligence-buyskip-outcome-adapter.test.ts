// app/lib/ai/customer-intelligence-buyskip-outcome-adapter.test.ts
// Causal tests for the Phase 4 Buy-or-Skip outcome adapter — every decision
// and post-purchase state, plus the required safety proofs.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  adaptBuySkipOutcomeFindings,
  BUYSKIP_OUTCOME_SOURCE,
  BUYSKIP_PURCHASE_DECISION_DIMENSION,
  BUYSKIP_POST_PURCHASE_OUTCOME_DIMENSION,
  type BuySkipOutcomeFact,
} from "./customer-intelligence-buyskip-outcome-adapter.ts";

function outcomeFact(partial: Partial<BuySkipOutcomeFact> & { id: string; decision: BuySkipOutcomeFact["decision"] }): BuySkipOutcomeFact {
  return {
    customerId: "cust-1", category: "Dress", postPurchaseOutcome: null,
    updatedAt: new Date("2026-10-01T00:00:00Z"),
    ...partial,
  };
}

function decisionFinding(fact: BuySkipOutcomeFact) {
  return adaptBuySkipOutcomeFindings([fact]).find((f) => f.dimension === BUYSKIP_PURCHASE_DECISION_DIMENSION);
}
function outcomeFinding(fact: BuySkipOutcomeFact) {
  return adaptBuySkipOutcomeFindings([fact]).find((f) => f.dimension === BUYSKIP_POST_PURCHASE_OUTCOME_DIMENSION);
}

describe("§CIA-BOS-OUTCOME-1 BOUGHT_IT", () => {
  it("explicit-outcome, purchase-decision, value BOUGHT_IT, category in subject, no qualifier", () => {
    const f = decisionFinding(outcomeFact({ id: "o1", decision: "BOUGHT_IT", category: "Dress" }));
    assert.equal(f?.signalClass, "explicit-outcome");
    assert.equal(f?.source, BUYSKIP_OUTCOME_SOURCE);
    assert.equal(f?.value, "BOUGHT_IT");
    assert.deepEqual(f?.subject, { kind: "garment-category", value: "Dress" });
    assert.equal(f?.support.kind, "direct");
    assert.ok(!("qualifier" in (f?.support ?? {})), "purchase-decision findings never carry a qualifier");
  });
});

describe("§CIA-BOS-OUTCOME-2 DIDNT_BUY_IT", () => {
  it("explicit-outcome, purchase-decision, value DIDNT_BUY_IT, no qualifier — passing is an action, not a dislike claim", () => {
    const f = decisionFinding(outcomeFact({ id: "o2", decision: "DIDNT_BUY_IT", category: "Top" }));
    assert.equal(f?.signalClass, "explicit-outcome");
    assert.equal(f?.value, "DIDNT_BUY_IT");
    assert.ok(!("qualifier" in (f?.support ?? {})));
  });
});

describe("§CIA-BOS-OUTCOME-3 STILL_DECIDING is preserved, not discarded, and is explicit-demand not explicit-outcome", () => {
  it("produces a real finding — an unresolved state is still a genuine customer state", () => {
    const f = decisionFinding(outcomeFact({ id: "o3", decision: "STILL_DECIDING", category: "Shoes" }));
    assert.ok(f, "STILL_DECIDING must produce a finding, not be silently dropped");
    assert.equal(f?.value, "STILL_DECIDING");
    assert.equal(f?.signalClass, "explicit-demand", "unresolved — not promoted to the settled-action tier");
    assert.ok(!("qualifier" in (f?.support ?? {})), "not positive, not negative — no qualifier at all");
  });

  it("never produces a post-purchase-outcome finding — nothing has been purchased yet", () => {
    const findings = adaptBuySkipOutcomeFindings([outcomeFact({ id: "o3", decision: "STILL_DECIDING" })]);
    assert.equal(findings.length, 1, "exactly one finding — the decision — and nothing else");
  });
});

describe("§CIA-BOS-OUTCOME-4 LOVE_IT", () => {
  it("explicit-outcome, post-purchase-outcome, positive qualifier, category in subject not dimension/value", () => {
    const f = outcomeFinding(outcomeFact({ id: "o4", decision: "BOUGHT_IT", category: "Dress", postPurchaseOutcome: "LOVE_IT" }));
    assert.equal(f?.signalClass, "explicit-outcome");
    assert.equal(f?.dimension, BUYSKIP_POST_PURCHASE_OUTCOME_DIMENSION);
    assert.equal(f?.value, "LOVE_IT");
    assert.deepEqual(f?.subject, { kind: "garment-category", value: "Dress" });
    assert.equal((f?.support as { qualifier?: string })?.qualifier, "positive");
  });
});

describe("§CIA-BOS-OUTCOME-5 ITS_OKAY is preserved as neutral, not discarded", () => {
  it("produces a real finding with qualifier neutral — this is TasteEvidence's exclusion, not Shared Intelligence's", () => {
    const f = outcomeFinding(outcomeFact({ id: "o5", decision: "BOUGHT_IT", category: "Bag", postPurchaseOutcome: "ITS_OKAY" }));
    assert.ok(f, "ITS_OKAY must produce a finding");
    assert.equal(f?.value, "ITS_OKAY");
    assert.equal((f?.support as { qualifier?: string })?.qualifier, "neutral");
  });
});

describe("§CIA-BOS-OUTCOME-6 RETURNED_IT", () => {
  it("explicit-outcome, post-purchase-outcome, negative qualifier", () => {
    const f = outcomeFinding(outcomeFact({ id: "o6", decision: "BOUGHT_IT", category: "Outerwear", postPurchaseOutcome: "RETURNED_IT" }));
    assert.equal(f?.value, "RETURNED_IT");
    assert.equal((f?.support as { qualifier?: string })?.qualifier, "negative");
  });
});

describe("§CIA-BOS-OUTCOME-7 one outcome row legitimately emits two findings", () => {
  it("BOUGHT_IT + LOVE_IT from the same row — two separate facts, same provenance and subject", () => {
    const findings = adaptBuySkipOutcomeFindings([
      outcomeFact({ id: "o7", decision: "BOUGHT_IT", category: "Dress", postPurchaseOutcome: "LOVE_IT" }),
    ]);
    assert.equal(findings.length, 2);
    const [decision, outcome] = findings;
    assert.equal(decision.dimension, BUYSKIP_PURCHASE_DECISION_DIMENSION);
    assert.equal(decision.value, "BOUGHT_IT");
    assert.equal(outcome.dimension, BUYSKIP_POST_PURCHASE_OUTCOME_DIMENSION);
    assert.equal(outcome.value, "LOVE_IT");
    assert.deepEqual(decision.provenanceRefs, outcome.provenanceRefs, "both facts come from the same BuySkipOutcome row");
    assert.deepEqual(decision.subject, outcome.subject, "both facts are about the same category");
  });
});

describe("§CIA-BOS-OUTCOME-8 category absence degrades honestly — subject omitted, not invented", () => {
  it("a null category produces a decision finding with no subject at all", () => {
    const f = decisionFinding(outcomeFact({ id: "o8", decision: "BOUGHT_IT", category: null }));
    assert.equal(f?.subject, undefined);
  });
});

describe("§CIA-BOS-OUTCOME-9 provenance is the real BuySkipOutcome row id, never the analysis id", () => {
  it("both findings from one row cite the same outcome id", () => {
    const findings = adaptBuySkipOutcomeFindings([
      outcomeFact({ id: "outcome-real-id", decision: "BOUGHT_IT", postPurchaseOutcome: "LOVE_IT" }),
    ]);
    for (const f of findings) {
      assert.deepEqual(f.provenanceRefs, [{ kind: "buy-skip-outcome", id: "outcome-real-id" }]);
    }
  });
});

describe("§CIA-BOS-OUTCOME-10 nAia's own AI output is structurally impossible to feed in — not merely unused", () => {
  it("BuySkipOutcomeFact has no verdict/confidence/AI-calibration field to read", () => {
    const fact = outcomeFact({ id: "o10", decision: "BOUGHT_IT" });
    assert.equal("verdict" in fact, false);
    assert.equal("confidence" in fact, false);
    assert.equal("fullAnalysis" in fact, false);
  });

  it("whatLike/unsureAbout are not part of this adapter's input shape either — still deferred", () => {
    const fact = outcomeFact({ id: "o10b", decision: "BOUGHT_IT" });
    assert.equal("whatLike" in fact, false);
    assert.equal("unsureAbout" in fact, false);
  });
});

describe("§CIA-BOS-OUTCOME-11 temporal reflects the outcome row's own updatedAt, never invented", () => {
  it("snapshot observedAt matches the fact's updatedAt as ISO", () => {
    const updatedAt = new Date("2026-08-20T09:00:00Z");
    const f = decisionFinding(outcomeFact({ id: "o11", decision: "BOUGHT_IT", updatedAt }));
    assert.deepEqual(f?.temporal, { kind: "snapshot", observedAt: updatedAt.toISOString() });
  });
});
