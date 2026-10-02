// app/lib/ai/customer-intelligence-styleme-demand-adapter.test.ts
// Causal tests for the Phase 2 StyleMe-demand adapter.
// Run with: node --test --import tsx/esm app/lib/ai/customer-intelligence-styleme-demand-adapter.test.ts

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  adaptStyleMeDemandFindings,
  STYLEME_DEMAND_SOURCE,
  STYLEME_DEMAND_REGISTER_DIMENSION,
  STYLEME_DEMAND_INTENTION_DIMENSION,
} from "./customer-intelligence-styleme-demand-adapter.ts";
import { deriveStyleMeDemand, type RawStyleMeDemandFact } from "./styleme-demand-evidence.ts";

function fact(partial: Partial<RawStyleMeDemandFact> & { sessionId: string; createdAt: Date }): RawStyleMeDemandFact {
  return {
    occasion: "work",
    register: "work",
    formalityConditional: null,
    intentions: [],
    desiredFeeling: null,
    closetAnchorId: "anchor-1",
    styleFrom: "CLOSET",
    ...partial,
  };
}

function sampleDerivation() {
  return deriveStyleMeDemand([
    fact({ sessionId: "a", createdAt: new Date("2026-07-20T10:00:00.000Z"), register: "work", intentions: ["feel-put-together"] }),
    fact({ sessionId: "b", createdAt: new Date("2026-08-15T10:00:00.000Z"), register: "work", intentions: ["feel-put-together"] }),
    fact({ sessionId: "c", createdAt: new Date("2026-10-01T10:00:00.000Z"), register: "everyday", occasion: "everyday", intentions: ["feel-like-myself"] }),
  ]);
}

describe("§CIA-DEM-1 one source, dimension distinguishes register from intention", () => {
  it("register and intention findings share the same source string — dimension is what tells them apart", () => {
    const d = sampleDerivation();
    const findings = adaptStyleMeDemandFindings(d);
    const work = findings.find((f) => f.value === "work")!;
    const intention = findings.find((f) => f.value === "feel-put-together")!;
    assert.equal(work.source, STYLEME_DEMAND_SOURCE);
    assert.equal(intention.source, STYLEME_DEMAND_SOURCE);
    assert.equal(work.dimension, STYLEME_DEMAND_REGISTER_DIMENSION);
    assert.equal(intention.dimension, STYLEME_DEMAND_INTENTION_DIMENSION);
    assert.notEqual(work.dimension, intention.dimension);
  });

  it("every finding is explicit-demand", () => {
    const d = sampleDerivation();
    for (const f of adaptStyleMeDemandFindings(d)) assert.equal(f.signalClass, "explicit-demand");
  });
});

describe("§CIA-DEM-2 counts and dates are exactly the frozen deduped values", () => {
  it("register eventCount/firstSeen/lastSeen match deriveStyleMeDemand's own registerDemand output, unchanged", () => {
    const d = sampleDerivation();
    const findings = adaptStyleMeDemandFindings(d);
    for (const r of d.registerDemand) {
      const f = findings.find((x) => x.dimension === STYLEME_DEMAND_REGISTER_DIMENSION && x.value === r.register)!;
      assert.equal((f.support as { value: number }).value, r.eventCount);
      assert.deepEqual(f.temporal, { kind: "range", firstSeen: r.firstSeen, lastSeen: r.lastSeen });
    }
  });

  it("intention eventCount/firstSeen/lastSeen match deriveStyleMeDemand's own intentionDemand output, unchanged", () => {
    const d = sampleDerivation();
    const findings = adaptStyleMeDemandFindings(d);
    for (const i of d.intentionDemand) {
      const f = findings.find((x) => x.dimension === STYLEME_DEMAND_INTENTION_DIMENSION && x.value === i.intention)!;
      assert.equal((f.support as { value: number }).value, i.eventCount);
      assert.deepEqual(f.temporal, { kind: "range", firstSeen: i.firstSeen, lastSeen: i.lastSeen });
    }
  });

  it("provenance event count matches the support count exactly — no invented or dropped references", () => {
    const d = sampleDerivation();
    const findings = adaptStyleMeDemandFindings(d);
    for (const f of findings) {
      assert.equal(f.provenanceRefs.length, (f.support as { value: number }).value);
      for (const ref of f.provenanceRefs) assert.equal(ref.kind, "styleme-demand");
    }
  });
});

describe("§CIA-DEM-3 demand remains strictly non-polar", () => {
  it("every demand finding uses the count support shape only, with neither qualifier nor tier ever set", () => {
    const d = sampleDerivation();
    const findings = adaptStyleMeDemandFindings(d);
    assert.ok(findings.length > 0);
    for (const f of findings) {
      assert.equal(f.support.kind, "count");
      assert.equal((f.support as { qualifier?: string }).qualifier, undefined, "demand has no direction — qualifier is outcome-specific");
      assert.equal((f.support as { tier?: string }).tier, undefined, "demand has no source-native tier");
    }
  });
});

describe("§CIA-DEM-4 safety flags follow the documented rule, not a blanket value", () => {
  it("register demand is customer-facing-safe (an equivalent live sentence already exists); intention demand is not (its migration was explicitly deferred)", () => {
    const d = sampleDerivation();
    const findings = adaptStyleMeDemandFindings(d);
    for (const f of findings.filter((x) => x.dimension === STYLEME_DEMAND_REGISTER_DIMENSION)) {
      assert.equal(f.customerFacingSafe, true);
    }
    for (const f of findings.filter((x) => x.dimension === STYLEME_DEMAND_INTENTION_DIMENSION)) {
      assert.equal(f.customerFacingSafe, false);
    }
  });

  it("both register and intention demand are cohort-eligible — bounded, non-identifying vocabularies either way", () => {
    const d = sampleDerivation();
    const findings = adaptStyleMeDemandFindings(d);
    for (const f of findings) assert.equal(f.cohortEligible, true);
  });
});

describe("§CIA-DEM-5 zero effect on the frozen module's own output", () => {
  it("calling the adapter does not mutate the StyleMeDemandDerivation it reads", () => {
    const d = sampleDerivation();
    const before = JSON.stringify(d);
    adaptStyleMeDemandFindings(d);
    assert.equal(JSON.stringify(d), before);
  });
});
