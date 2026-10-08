// app/lib/buyskip/outcome-history-evidence.test.ts
// B3 — causal proof for summarizeOutcomeHistory().
//
// Run: node --test --import tsx/esm app/lib/buyskip/outcome-history-evidence.test.ts

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { summarizeOutcomeHistory, type OutcomeHistoryEvidence } from "./outcome-history-evidence.server.ts";
import type { ResolvedFinding } from "~/lib/ai/customer-intelligence-contract";

// ── Fixture builder — matches customer-intelligence-buyskip-outcome-adapter's
// real output shape exactly, not a simplified stand-in. ──────────────────────

function postPurchaseFinding(overrides: Partial<ResolvedFinding> = {}): ResolvedFinding {
  return {
    value: "LOVE_IT",
    signalClass: "explicit-outcome",
    source: "buy-skip-outcome",
    dimension: "post-purchase-outcome",
    subject: { kind: "garment-category", value: "Top" },
    provenanceRefs: [{ kind: "buy-skip-outcome", id: "outcome-1" }],
    support: { kind: "count", value: 1, qualifier: "positive" },
    temporal: { kind: "snapshot", observedAt: "2026-09-01T00:00:00.000Z" },
    customerFacingSafe: true,
    cohortEligible: true,
    ...overrides,
  };
}

function purchaseDecisionFinding(overrides: Partial<ResolvedFinding> = {}): ResolvedFinding {
  return {
    value: "BOUGHT_IT",
    signalClass: "explicit-outcome",
    source: "buy-skip-outcome",
    dimension: "purchase-decision", // NOT post-purchase-outcome
    subject: { kind: "garment-category", value: "Top" },
    provenanceRefs: [{ kind: "buy-skip-outcome", id: "outcome-1" }],
    support: { kind: "direct" },
    temporal: { kind: "snapshot", observedAt: "2026-09-01T00:00:00.000Z" },
    customerFacingSafe: true,
    cohortEligible: true,
    ...overrides,
  };
}

function consideredFinding(overrides: Partial<ResolvedFinding> = {}): ResolvedFinding {
  return {
    value: "Top",
    signalClass: "explicit-demand",
    source: "buy-skip-analysis",
    dimension: "considered-category",
    provenanceRefs: [{ kind: "buy-skip-analysis", id: "analysis-1" }],
    support: { kind: "direct" },
    temporal: { kind: "snapshot", observedAt: "2026-09-01T00:00:00.000Z" },
    customerFacingSafe: true,
    cohortEligible: true,
    ...overrides,
  };
}

function expectAvailable(result: OutcomeHistoryEvidence): asserts result is Extract<OutcomeHistoryEvidence, { available: true }> {
  assert.equal(result.available, true, "expected an available outcome history result");
}

describe("B3 — summarizeOutcomeHistory", () => {

  it("B3-01 — real explicit LOVE_IT outcome is recognized and counted", () => {
    const result = summarizeOutcomeHistory("Top", [postPurchaseFinding({ value: "LOVE_IT" })]);
    expectAvailable(result);
    assert.equal(result.category, "Top");
    assert.equal(result.lovedCount, 1);
    assert.equal(result.returnedCount, 0);
    assert.deepEqual(result.provenanceIds, ["outcome-1"]);
  });

  it("B3-02 — real explicit RETURNED_IT outcome is recognized and counted", () => {
    const result = summarizeOutcomeHistory("Top", [
      postPurchaseFinding({ value: "RETURNED_IT", provenanceRefs: [{ kind: "buy-skip-outcome", id: "outcome-2" }] }),
    ]);
    expectAvailable(result);
    assert.equal(result.lovedCount, 0);
    assert.equal(result.returnedCount, 1);
  });

  it("B3-03 — ambiguous outcome (ITS_OKAY) is excluded, matching the existing Taste writer's established policy", () => {
    const result = summarizeOutcomeHistory("Top", [postPurchaseFinding({ value: "ITS_OKAY" })]);
    assert.equal(result.available, false, "ITS_OKAY alone must produce no signal, same as the Taste layer's own exclusion");
  });

  it("B3-04 — no history at all produces no explicit-outcome signal (not a fabricated zero-count object)", () => {
    const result = summarizeOutcomeHistory("Top", []);
    assert.deepEqual(result, { available: false });
  });

  it("B3-05 — category with zero matching findings produces no signal, even when other categories have history", () => {
    const result = summarizeOutcomeHistory("Dress", [postPurchaseFinding({ subject: { kind: "garment-category", value: "Top" } })]);
    assert.equal(result.available, false);
  });

  it("B3-06 — null category (candidate has no declared category) always produces no signal", () => {
    const result = summarizeOutcomeHistory(null, [postPurchaseFinding()]);
    assert.deepEqual(result, { available: false });
  });

  it("B3-07 — 'considered' events (explicit-demand, dimension=considered-category) never contribute, even when passed in alongside real outcomes", () => {
    const result = summarizeOutcomeHistory("Top", [
      postPurchaseFinding({ value: "LOVE_IT" }),
      consideredFinding(), // must be structurally ignored — wrong dimension entirely
    ]);
    expectAvailable(result);
    assert.equal(result.lovedCount, 1, "the considered finding must not be miscounted as an outcome");
  });

  it("B3-08 — 'purchase-decision' findings (BOUGHT_IT/DIDNT_BUY_IT/STILL_DECIDING) never contribute — only post-purchase-outcome does", () => {
    const result = summarizeOutcomeHistory("Top", [purchaseDecisionFinding({ value: "BOUGHT_IT" })]);
    assert.equal(result.available, false, "a purchase decision alone, with no post-purchase-outcome, is not taste evidence");
  });

  it("B3-09 — nAia's own model verdict never becomes a learning signal — the function has no verdict-shaped input at all", () => {
    // Structural proof: summarizeOutcomeHistory's signature is
    // (category, findings) — there is no parameter for a BuySkipVerdict
    // (BUY/SKIP/MAYBE/INCOMPLETE) anywhere. Even a finding that looks like
    // it might carry a verdict-shaped value is ignored unless its dimension
    // is exactly "post-purchase-outcome" from the "buy-skip-outcome" source.
    const result = summarizeOutcomeHistory("Top", [
      postPurchaseFinding({ source: "nadine-assessment", value: "BUY", dimension: "post-purchase-outcome" }),
    ]);
    assert.equal(result.available, false, "a finding not from the buy-skip-outcome source must never count, however it's shaped");
  });

  it("B3-10 — multiple real outcomes in the same category aggregate as a plain count, not a sweeping generalization", () => {
    const result = summarizeOutcomeHistory("Top", [
      postPurchaseFinding({ value: "LOVE_IT", provenanceRefs: [{ kind: "buy-skip-outcome", id: "o1" }] }),
      postPurchaseFinding({ value: "LOVE_IT", provenanceRefs: [{ kind: "buy-skip-outcome", id: "o2" }] }),
      postPurchaseFinding({ value: "RETURNED_IT", provenanceRefs: [{ kind: "buy-skip-outcome", id: "o3" }] }),
    ]);
    expectAvailable(result);
    assert.equal(result.lovedCount, 2);
    assert.equal(result.returnedCount, 1);
    assert.deepEqual(result.provenanceIds.sort(), ["o1", "o2", "o3"]);
  });

  it("B3-11 — correction/update reflected as current state only, never double-counted (simulates a resolver re-query after an outcome was changed)", () => {
    // The resolver always re-queries live BuySkipOutcome rows (one row per
    // analysisId, enforced by a DB unique constraint) — there is no cached
    // aggregate anywhere for this function to accidentally double-count.
    // This fixture simulates "the customer changed LOVE_IT to RETURNED_IT":
    // the finding list passed in reflects only the CURRENT state, as a real
    // resolver call would after the upsert.
    const beforeCorrection = summarizeOutcomeHistory("Top", [postPurchaseFinding({ value: "LOVE_IT" })]);
    expectAvailable(beforeCorrection);
    assert.equal(beforeCorrection.lovedCount, 1);
    assert.equal(beforeCorrection.returnedCount, 0);

    const afterCorrection = summarizeOutcomeHistory("Top", [postPurchaseFinding({ value: "RETURNED_IT" })]);
    expectAvailable(afterCorrection);
    assert.equal(afterCorrection.lovedCount, 0, "the old LOVE_IT must not still be counted after correction");
    assert.equal(afterCorrection.returnedCount, 1);
  });

  it("B3-12 — exact-category-string matching only — does not generalize across categories (no canonical-family inference)", () => {
    const result = summarizeOutcomeHistory("Blazer", [
      postPurchaseFinding({ value: "RETURNED_IT", subject: { kind: "garment-category", value: "Outerwear" } }),
    ]);
    assert.equal(result.available, false, "a different category string must never match, even if a human would consider them related");
  });

  it("B3-13 — provenance always traces to the specific contributing BuySkipOutcome ids, never an opaque aggregate", () => {
    const result = summarizeOutcomeHistory("Top", [
      postPurchaseFinding({ value: "LOVE_IT", provenanceRefs: [{ kind: "buy-skip-outcome", id: "outcome-abc" }] }),
    ]);
    expectAvailable(result);
    assert.deepEqual(result.provenanceIds, ["outcome-abc"]);
  });

  it("B3-14 — this module imports no taste-engine module and queries no TasteEvidence/StyleTendency table (static self-check)", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const selfPath = fileURLToPath(new URL("./outcome-history-evidence.server.ts", import.meta.url));
    const content = readFileSync(selfPath, "utf8");
    // Only real import/require statements — the module's own explanatory
    // comments legitimately mention these names in prose (explaining what it
    // deliberately does NOT do), so a bare substring/mention check would
    // false-positive on its own documentation. Same precise pattern as the
    // real taste-evidence-consumer-boundary.test.ts.
    const TASTE_IMPORT_RE = /from\s+["'][^"']*(?:taste-contract|taste-extraction\.server|taste-reconcile\.server|taste-feedback-engine|taste-passport-boundary\.server)(?:\.(?:js|ts|jsx|tsx))?["']|require\(["'][^"']*(?:taste-contract|taste-extraction\.server|taste-reconcile\.server|taste-feedback-engine|taste-passport-boundary\.server)(?:\.(?:js|ts|jsx|tsx))?["']\)/;
    assert.ok(!TASTE_IMPORT_RE.test(content), "must not import any taste-engine module");
    assert.ok(!/prisma\.tasteEvidence\.|prisma\.styleTendency\./.test(content),
      "must not query TasteEvidence/StyleTendency directly");
  });

  it("B3-15 — this module imports no Garment Intelligence / ResolvedGarment module (static self-check)", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const selfPath = fileURLToPath(new URL("./outcome-history-evidence.server.ts", import.meta.url));
    const content = readFileSync(selfPath, "utf8");
    assert.ok(!/resolved-garment|garment-intelligence/.test(content),
      "B3 customer-learning evidence must never be written into ResolvedGarment/GI");
  });

  it("B3-16 — this module imports no Passport/OnboardingProfile write path (static self-check)", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const selfPath = fileURLToPath(new URL("./outcome-history-evidence.server.ts", import.meta.url));
    const content = readFileSync(selfPath, "utf8");
    assert.ok(!/onboardingProfile\.update|prisma\.onboardingProfile/.test(content),
      "B3 history must never mutate Passport");
  });

  it("B3-17 — pure function: identical input produces identical output on repeated calls (determinism)", () => {
    const findings = [postPurchaseFinding({ value: "LOVE_IT" }), postPurchaseFinding({ value: "RETURNED_IT", provenanceRefs: [{ kind: "buy-skip-outcome", id: "o2" }] })];
    const r1 = summarizeOutcomeHistory("Top", findings);
    const r2 = summarizeOutcomeHistory("Top", findings);
    assert.deepEqual(r1, r2);
  });

  it("B3-18 — cross-customer isolation is the caller's responsibility (resolver-level), and this function performs no customerId filtering of its own — it trusts its input is already scoped", () => {
    // This is a defense-in-depth/documentation test: summarizeOutcomeHistory
    // has no customerId parameter at all. Real cross-customer isolation is
    // proven at the resolver layer (customer-intelligence-resolver.test.ts,
    // which queries a real DB with customerId-scoped findMany calls). This
    // test documents that this pure layer has no surface where a customerId
    // mix-up could even occur — it only ever sees whatever findings array
    // its caller already resolved for one specific customer.
    const singleCustomerFindings = [postPurchaseFinding({ value: "LOVE_IT" })];
    const result = summarizeOutcomeHistory("Top", singleCustomerFindings);
    expectAvailable(result);
    assert.equal(result.lovedCount, 1);
  });

});
