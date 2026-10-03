// app/lib/ai/customer-intelligence-buyskip-considered-adapter.test.ts
// Causal tests for the Phase 4 Buy-or-Skip considered adapter.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { adaptConsideredFindings, BUYSKIP_CONSIDERED_SOURCE, BUYSKIP_CONSIDERED_DIMENSION } from "./customer-intelligence-buyskip-considered-adapter.ts";
import type { ConsideredEvent } from "./buyskip-considered-evidence.ts";
import { PRECEDENCE_ORDER, type SignalClass } from "./customer-intelligence-contract.ts";

function event(partial: Partial<ConsideredEvent> & { id: string }): ConsideredEvent {
  return { customerId: "cust-1", category: "Dress", observedAt: new Date("2026-10-01T00:00:00Z"), ...partial };
}

describe("§CIA-BOS-CONSIDERED-1 signalClass, source, dimension, value", () => {
  it("is explicit-demand, from buy-skip-analysis, dimension considered-category, value is the category", () => {
    const [f] = adaptConsideredFindings([event({ id: "a1", category: "Bottom" })]);
    assert.equal(f.signalClass, "explicit-demand");
    assert.equal(f.source, BUYSKIP_CONSIDERED_SOURCE);
    assert.equal(f.dimension, BUYSKIP_CONSIDERED_DIMENSION);
    assert.equal(f.value, "Bottom");
  });

  it("never carries a qualifier — mere consideration has no polarity", () => {
    const [f] = adaptConsideredFindings([event({ id: "a1" })]);
    assert.equal(f.support.kind, "direct");
    assert.ok(!("qualifier" in f.support));
  });

  it("never carries subject — the category already IS value here", () => {
    const [f] = adaptConsideredFindings([event({ id: "a1" })]);
    assert.equal(f.subject, undefined);
  });
});

describe("§CIA-BOS-CONSIDERED-2 provenance is the real representative analysis id", () => {
  it("provenanceRefs cites buy-skip-analysis with the event's own id", () => {
    const [f] = adaptConsideredFindings([event({ id: "analysis-xyz" })]);
    assert.deepEqual(f.provenanceRefs, [{ kind: "buy-skip-analysis", id: "analysis-xyz" }]);
  });
});

describe("§CIA-BOS-CONSIDERED-3 temporal is the event's own observedAt, never invented", () => {
  it("uses the dedup-representative row's timestamp as an ISO snapshot", () => {
    const observedAt = new Date("2026-09-15T12:00:00Z");
    const [f] = adaptConsideredFindings([event({ id: "a1", observedAt })]);
    assert.deepEqual(f.temporal, { kind: "snapshot", observedAt: observedAt.toISOString() });
  });
});

describe("§CIA-BOS-CONSIDERED-4 one finding per considered event, no aggregation inside the adapter", () => {
  it("three events produce three findings, not a rolled-up count", () => {
    const findings = adaptConsideredFindings([
      event({ id: "a1", category: "Bottom" }),
      event({ id: "a2", category: "Bottom" }),
      event({ id: "a3", category: "Dress" }),
    ]);
    assert.equal(findings.length, 3);
  });
});

describe("§CIA-BOS-CONSIDERED-5 customerFacingSafe and cohortEligible", () => {
  it("both are true — she entered the category herself, and it's a small non-identifying vocabulary", () => {
    const [f] = adaptConsideredFindings([event({ id: "a1" })]);
    assert.equal(f.customerFacingSafe, true);
    assert.equal(f.cohortEligible, true);
  });
});

describe("§CIA-BOS-CONSIDERED-6 explicit-demand is never on PRECEDENCE_ORDER's outcome rung", () => {
  it("occupies its own precedence slot, consistent with StyleMe demand", () => {
    const [f] = adaptConsideredFindings([event({ id: "a1" })]);
    assert.ok((PRECEDENCE_ORDER as readonly SignalClass[]).includes(f.signalClass));
    assert.notEqual(f.signalClass, "explicit-outcome");
  });
});
