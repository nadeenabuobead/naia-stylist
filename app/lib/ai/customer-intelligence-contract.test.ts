// app/lib/ai/customer-intelligence-contract.test.ts
// Minimal compile/type-shape coverage for the Phase 1 shared contract.
// No resolver behavior exists yet — these tests only confirm the vocabulary
// itself (SIGNAL_CLASSES, PRECEDENCE_ORDER) and that each discriminated
// union variant typechecks as a real ResolvedFinding.
// Run with: node --test --import tsx/esm app/lib/ai/customer-intelligence-contract.test.ts

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SIGNAL_CLASSES,
  PRECEDENCE_ORDER,
  type SignalClass,
  type ProvenanceRef,
  type FindingSupport,
  type FindingTemporal,
  type ResolvedFinding,
} from "./customer-intelligence-contract.ts";

describe("§CIC-1 signal class vocabulary", () => {
  it("names exactly the five classes the architecture recon locked", () => {
    assert.deepEqual(SIGNAL_CLASSES, [
      "explicit-truth", "explicit-outcome", "explicit-demand", "observed-state", "derived-inference",
    ]);
  });
});

describe("§CIC-2 precedence order excludes observed-state", () => {
  it("ranks exactly the four competing classes, in the locked order", () => {
    assert.deepEqual(PRECEDENCE_ORDER, [
      "explicit-truth", "explicit-outcome", "explicit-demand", "derived-inference",
    ]);
  });

  it("never includes observed-state — it is orthogonal, not a fifth rank", () => {
    assert.ok(!(PRECEDENCE_ORDER as readonly string[]).includes("observed-state"));
  });

  it("every PRECEDENCE_ORDER entry is a real SignalClass", () => {
    for (const entry of PRECEDENCE_ORDER) {
      assert.ok((SIGNAL_CLASSES as readonly string[]).includes(entry));
    }
  });
});

describe("§CIC-3 ProvenanceRef — one real value per variant typechecks", () => {
  it("passport, with and without a field", () => {
    const a: ProvenanceRef = { kind: "passport" };
    const b: ProvenanceRef = { kind: "passport", field: "favoriteColors" };
    assert.equal(a.kind, "passport");
    assert.equal(b.field, "favoriteColors");
  });
  it("styleme-outcome", () => {
    const ref: ProvenanceRef = { kind: "styleme-outcome", id: "outcome-1" };
    assert.equal(ref.id, "outcome-1");
  });
  it("styleme-demand", () => {
    const ref: ProvenanceRef = { kind: "styleme-demand", id: "session-1" };
    assert.equal(ref.id, "session-1");
  });
  it("closet-state carries multiple item ids, not one", () => {
    const ref: ProvenanceRef = { kind: "closet-state", itemIds: ["g1", "g2", "g3"] };
    assert.equal(ref.itemIds.length, 3);
  });
  it("taste-tendency", () => {
    const ref: ProvenanceRef = { kind: "taste-tendency", id: "tendency-1" };
    assert.equal(ref.id, "tendency-1");
  });
  it("buy-skip", () => {
    const ref: ProvenanceRef = { kind: "buy-skip", id: "outcome-1" };
    assert.equal(ref.id, "outcome-1");
  });
});

describe("§CIC-4 FindingSupport — not mutually comparable, one shape per kind", () => {
  it("direct carries no value at all", () => {
    const s: FindingSupport = { kind: "direct" };
    assert.deepEqual(s, { kind: "direct" });
  });
  it("count", () => {
    const s: FindingSupport = { kind: "count", value: 8 };
    assert.equal(s.value, 8);
  });
  it("structural, with optional value/label", () => {
    const s: FindingSupport = { kind: "structural", value: 2, label: "Limited usable work depth" };
    assert.equal(s.label, "Limited usable work depth");
  });
  it("reconciled", () => {
    const s: FindingSupport = { kind: "reconciled", score: 4.2, state: "CONFIRMED" };
    assert.equal(s.state, "CONFIRMED");
  });
});

describe("§CIC-5 FindingTemporal — optional in substance via an explicit none", () => {
  it("range", () => {
    const t: FindingTemporal = { kind: "range", firstSeen: "2026-07-20", lastSeen: "2026-10-02" };
    assert.equal(t.firstSeen, "2026-07-20");
  });
  it("snapshot", () => {
    const t: FindingTemporal = { kind: "snapshot", observedAt: "2026-10-02" };
    assert.equal(t.observedAt, "2026-10-02");
  });
  it("stated, updatedAt optional", () => {
    const a: FindingTemporal = { kind: "stated" };
    const b: FindingTemporal = { kind: "stated", updatedAt: "2026-09-01" };
    assert.equal(a.kind, "stated");
    assert.equal(b.updatedAt, "2026-09-01");
  });
  it("none — never an invented date", () => {
    const t: FindingTemporal = { kind: "none" };
    assert.deepEqual(t, { kind: "none" });
  });
});

describe("§CIC-6 ResolvedFinding — a real finding per signal class typechecks", () => {
  it("explicit-truth (Passport)", () => {
    const f: ResolvedFinding = {
      value: "black", signalClass: "explicit-truth", source: "passport",
      provenanceRefs: [{ kind: "passport", field: "favoriteColors" }],
      support: { kind: "direct" }, temporal: { kind: "stated" },
      customerFacingSafe: true, cohortEligible: true,
    };
    assert.equal(f.signalClass, "explicit-truth");
  });

  it("observed-state (Closet) — never assigned a precedence rank", () => {
    const f: ResolvedFinding = {
      value: "work", signalClass: "observed-state", source: "closet-state",
      provenanceRefs: [{ kind: "closet-state", itemIds: ["g1", "g2"] }],
      support: { kind: "structural", value: 2, label: "Limited usable work depth" },
      temporal: { kind: "snapshot", observedAt: "2026-10-02" },
      customerFacingSafe: true, cohortEligible: true,
    };
    assert.equal((PRECEDENCE_ORDER as readonly SignalClass[]).includes(f.signalClass), false);
  });

  it("explicit-demand (StyleMe demand)", () => {
    const f: ResolvedFinding = {
      value: "work", signalClass: "explicit-demand", source: "styleme-demand",
      provenanceRefs: [{ kind: "styleme-demand", id: "session-1" }],
      support: { kind: "count", value: 8 },
      temporal: { kind: "range", firstSeen: "2026-07-20", lastSeen: "2026-10-01" },
      customerFacingSafe: true, cohortEligible: true,
    };
    assert.equal(f.source, "styleme-demand");
  });

  it("derived-inference (StyleTendency), not customer-facing-safe by default", () => {
    const f: ResolvedFinding = {
      value: "comfort", signalClass: "derived-inference", source: "taste-tendency",
      provenanceRefs: [{ kind: "taste-tendency", id: "tendency-1" }],
      support: { kind: "reconciled", score: 4.2, state: "CONFIRMED" },
      temporal: { kind: "snapshot", observedAt: "2026-10-02" },
      customerFacingSafe: false, cohortEligible: false,
    };
    assert.equal(f.customerFacingSafe, false);
  });
});
