// app/lib/ai/customer-intelligence-styleme-outcome-adapter.test.ts
// Causal tests for the Phase 2 StyleMe-outcome adapter.
// Run with: node --test --import tsx/esm app/lib/ai/customer-intelligence-styleme-outcome-adapter.test.ts

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  adaptStyleMeOutcomeFormulaFindings,
  adaptStyleMeOutcomeGarmentFindings,
  STYLEME_OUTCOME_SOURCE,
  STYLEME_OUTCOME_FORMULA_DIMENSION,
  STYLEME_OUTCOME_GARMENT_DIMENSION,
} from "./customer-intelligence-styleme-outcome-adapter.ts";
import {
  deriveFormulaEvidence,
  derivePositiveGarmentEvidence,
  type RawOutcomeFact,
} from "./wardrobe-feedback-evidence.ts";
import type { ResolvedFinding } from "./customer-intelligence-contract.ts";

function outcome(partial: Partial<RawOutcomeFact> & { outcomeId: string }): RawOutcomeFact {
  return {
    suggestionId: `sug-${partial.outcomeId}`,
    outcomeStatus: "wore-it",
    changeTypes: [],
    submittedAt: new Date("2026-09-19T12:00:00.000Z"),
    items: [
      { closetItemId: "top-1", itemType: "TOP", shopifyProductId: null },
      { closetItemId: "bottom-1", itemType: "BOTTOM", shopifyProductId: null },
    ],
    ...partial,
  };
}

function qualifierOf(f: ResolvedFinding): string | undefined {
  return f.support.kind === "count" ? f.support.qualifier : undefined;
}
function tierOf(f: ResolvedFinding): string | undefined {
  return f.support.kind === "count" ? f.support.tier : undefined;
}
function countOf(f: ResolvedFinding): number | undefined {
  return f.support.kind === "count" ? f.support.value : undefined;
}

describe("§CIA-OUT-1 one source, dimension distinguishes formula from garment", () => {
  it("every formula finding uses the same source as every garment finding — dimension is what differs", () => {
    const facts = deriveFormulaEvidence([
      outcome({ outcomeId: "a", submittedAt: new Date("2026-09-01T10:00:00.000Z") }),
      outcome({ outcomeId: "b", submittedAt: new Date("2026-09-10T10:00:00.000Z") }),
      outcome({ outcomeId: "c", submittedAt: new Date("2026-09-20T10:00:00.000Z") }),
    ]);
    const positiveGarments = derivePositiveGarmentEvidence(facts);
    const formulaFindings = adaptStyleMeOutcomeFormulaFindings(facts);
    const garmentFindings = adaptStyleMeOutcomeGarmentFindings(positiveGarments);

    for (const f of formulaFindings) {
      assert.equal(f.signalClass, "explicit-outcome");
      assert.equal(f.source, STYLEME_OUTCOME_SOURCE);
      assert.equal(f.dimension, STYLEME_OUTCOME_FORMULA_DIMENSION);
    }
    for (const f of garmentFindings) {
      assert.equal(f.source, STYLEME_OUTCOME_SOURCE);
      assert.equal(f.dimension, STYLEME_OUTCOME_GARMENT_DIMENSION);
    }
    assert.ok(formulaFindings.length > 0 && garmentFindings.length > 0);
  });
});

describe("§CIA-OUT-2 only verified formulas are ever projected", () => {
  it("an unverifiable formula (deletion-ambiguous slot) produces zero findings, end to end", () => {
    const facts = deriveFormulaEvidence([
      outcome({
        outcomeId: "a",
        items: [
          { closetItemId: null, itemType: "TOP", shopifyProductId: null }, // deletion-ambiguous
          { closetItemId: "bottom-1", itemType: "BOTTOM", shopifyProductId: null },
        ],
      }),
    ]);
    assert.equal(facts.size, 0, "sanity: the frozen module itself excludes this formula");
    assert.equal(adaptStyleMeOutcomeFormulaFindings(facts).length, 0);
  });
});

describe("§CIA-OUT-3 the formula support tier survives projection", () => {
  it("3 positive dates — the frozen module's strongly-supported tier — is preserved on the finding, not reduced to a bare count", () => {
    const facts = deriveFormulaEvidence([
      outcome({ outcomeId: "a", submittedAt: new Date("2026-09-01T10:00:00.000Z") }),
      outcome({ outcomeId: "b", submittedAt: new Date("2026-09-10T10:00:00.000Z") }),
      outcome({ outcomeId: "c", submittedAt: new Date("2026-09-20T10:00:00.000Z") }),
    ]);
    const [, evidence] = [...facts.entries()][0];
    assert.equal(evidence.state, "strongly-supported", "sanity: the frozen module's own tier for this fixture");
    const finding = adaptStyleMeOutcomeFormulaFindings(facts)[0];
    assert.equal(tierOf(finding), "strongly-supported");
    assert.equal(qualifierOf(finding), "positive");
  });

  it("1 positive date — the frozen module's supported (not strongly-supported) tier — is preserved exactly, not upgraded", () => {
    const facts = deriveFormulaEvidence([
      outcome({ outcomeId: "a", submittedAt: new Date("2026-09-01T10:00:00.000Z") }),
    ]);
    const [, evidence] = [...facts.entries()][0];
    assert.equal(evidence.state, "supported");
    const finding = adaptStyleMeOutcomeFormulaFindings(facts)[0];
    assert.equal(tierOf(finding), "supported");
  });

  it("negative and mixed findings carry no tier — the frozen module has no such threshold for them", () => {
    const facts = deriveFormulaEvidence([
      outcome({ outcomeId: "a", outcomeStatus: "changed-something", submittedAt: new Date("2026-09-01T10:00:00.000Z") }),
    ]);
    const finding = adaptStyleMeOutcomeFormulaFindings(facts)[0];
    assert.equal(qualifierOf(finding), "negative");
    assert.equal(tierOf(finding), undefined);
  });
});

describe("§CIA-OUT-4 mixed/ambiguous evidence can never be mistaken for an affirmative claim", () => {
  it("a same-day wore-it + changed-something conflict produces only a mixed-qualified finding, no positive one", () => {
    const sameDay = new Date("2026-09-19T12:00:00.000Z");
    const sameDayLater = new Date("2026-09-19T18:00:00.000Z");
    const facts = deriveFormulaEvidence([
      outcome({ outcomeId: "a", outcomeStatus: "wore-it", submittedAt: sameDay }),
      outcome({ outcomeId: "b", outcomeStatus: "changed-something", submittedAt: sameDayLater }),
    ]);
    const findings = adaptStyleMeOutcomeFormulaFindings(facts);
    assert.equal(findings.length, 1, "exactly one finding — the mixed one");
    assert.equal(findings[0].signalClass, "explicit-outcome", "signalClass alone does NOT distinguish this from a positive finding");
    assert.equal(qualifierOf(findings[0]), "mixed", "support.qualifier is what a resolver must check instead");
    assert.notEqual(qualifierOf(findings[0]), "positive");
  });

  it("changed-something is never reinterpreted as positive preference", () => {
    const facts = deriveFormulaEvidence([
      outcome({ outcomeId: "a", outcomeStatus: "changed-something", submittedAt: new Date("2026-09-01T10:00:00.000Z") }),
      outcome({ outcomeId: "b", outcomeStatus: "changed-something", submittedAt: new Date("2026-09-05T10:00:00.000Z") }),
    ]);
    const findings = adaptStyleMeOutcomeFormulaFindings(facts);
    assert.equal(findings.length, 1);
    assert.equal(qualifierOf(findings[0]), "negative");
    assert.equal(countOf(findings[0]), 2);
  });

  it("a formula with both positive and negative dates produces two separate, never-merged findings, each with its own qualifier", () => {
    const facts = deriveFormulaEvidence([
      outcome({ outcomeId: "a", outcomeStatus: "wore-it", submittedAt: new Date("2026-09-01T10:00:00.000Z") }),
      outcome({ outcomeId: "b", outcomeStatus: "changed-something", submittedAt: new Date("2026-09-05T10:00:00.000Z") }),
    ]);
    const findings = adaptStyleMeOutcomeFormulaFindings(facts);
    assert.equal(findings.length, 2);
    const qualifiers = findings.map(qualifierOf).sort();
    assert.deepEqual(qualifiers, ["negative", "positive"]);
  });
});

describe("§CIA-OUT-5 provenance is accurate and honest, never a fake row id", () => {
  it("formula findings reference the real formulaKey via styleme-outcome-formula, never a manufactured styleme-outcome row id", () => {
    const facts = deriveFormulaEvidence([
      outcome({ outcomeId: "a", submittedAt: new Date("2026-09-01T10:00:00.000Z") }),
      outcome({ outcomeId: "b", submittedAt: new Date("2026-09-10T10:00:00.000Z") }),
      outcome({ outcomeId: "c", submittedAt: new Date("2026-09-20T10:00:00.000Z") }),
    ]);
    const [formulaKey, evidence] = [...facts.entries()][0];
    const finding = adaptStyleMeOutcomeFormulaFindings(facts)[0];
    assert.equal(finding.value, formulaKey);
    assert.deepEqual(finding.provenanceRefs, [{ kind: "styleme-outcome-formula", formulaKey }]);
    assert.equal(countOf(finding), evidence.positiveDates.length);
    assert.deepEqual(finding.temporal, {
      kind: "range", firstSeen: evidence.positiveDates[0], lastSeen: evidence.positiveDates.at(-1),
    });
  });

  it("garment findings reference the real closetItemId via styleme-outcome-garment, at garment grain — distinct from formula grain", () => {
    const facts = deriveFormulaEvidence([
      outcome({ outcomeId: "a", submittedAt: new Date("2026-09-01T10:00:00.000Z") }),
      outcome({ outcomeId: "b", submittedAt: new Date("2026-09-10T10:00:00.000Z") }),
      outcome({ outcomeId: "c", submittedAt: new Date("2026-09-20T10:00:00.000Z") }),
    ]);
    const positiveGarments = derivePositiveGarmentEvidence(facts);
    const findings = adaptStyleMeOutcomeGarmentFindings(positiveGarments);
    assert.equal(findings.length, 2, "top-1 and bottom-1 both get credit");
    for (const f of findings) {
      assert.deepEqual(f.provenanceRefs, [{ kind: "styleme-outcome-garment", closetItemId: f.value }]);
      assert.ok(["top-1", "bottom-1"].includes(f.value));
    }
  });
});

describe("§CIA-OUT-6 conservative safety flags, not a blanket true", () => {
  it("no formula or garment finding is customer-facing-safe or cohort-eligible yet", () => {
    const facts = deriveFormulaEvidence([
      outcome({ outcomeId: "a", submittedAt: new Date("2026-09-01T10:00:00.000Z") }),
      outcome({ outcomeId: "b", submittedAt: new Date("2026-09-10T10:00:00.000Z") }),
      outcome({ outcomeId: "c", submittedAt: new Date("2026-09-20T10:00:00.000Z") }),
    ]);
    const positiveGarments = derivePositiveGarmentEvidence(facts);
    const all = [...adaptStyleMeOutcomeFormulaFindings(facts), ...adaptStyleMeOutcomeGarmentFindings(positiveGarments)];
    assert.ok(all.length > 0);
    for (const f of all) {
      assert.equal(f.customerFacingSafe, false);
      assert.equal(f.cohortEligible, false);
    }
  });
});

describe("§CIA-OUT-7 zero effect on the frozen module's own output", () => {
  it("calling the adapter does not mutate the FormulaEvidence/GarmentPositiveEvidence maps it reads", () => {
    const facts = deriveFormulaEvidence([
      outcome({ outcomeId: "a", submittedAt: new Date("2026-09-01T10:00:00.000Z") }),
      outcome({ outcomeId: "b", submittedAt: new Date("2026-09-10T10:00:00.000Z") }),
    ]);
    const positiveGarments = derivePositiveGarmentEvidence(facts);
    const factsBefore = JSON.stringify([...facts.entries()]);
    const garmentsBefore = JSON.stringify([...positiveGarments.entries()]);

    adaptStyleMeOutcomeFormulaFindings(facts);
    adaptStyleMeOutcomeGarmentFindings(positiveGarments);

    assert.equal(JSON.stringify([...facts.entries()]), factsBefore);
    assert.equal(JSON.stringify([...positiveGarments.entries()]), garmentsBefore);
  });
});
