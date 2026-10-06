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
  type FindingSubject,
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
  it("styleme-outcome — reserved for a real StyleMeOutcome row id, not currently populated by any adapter", () => {
    const ref: ProvenanceRef = { kind: "styleme-outcome", id: "outcome-1" };
    assert.equal(ref.id, "outcome-1");
  });
  it("styleme-outcome-formula — an honest formula-level aggregate reference", () => {
    const ref: ProvenanceRef = { kind: "styleme-outcome-formula", formulaKey: "g1|g3" };
    assert.equal(ref.formulaKey, "g1|g3");
  });
  it("styleme-outcome-garment — an honest garment-level aggregate reference", () => {
    const ref: ProvenanceRef = { kind: "styleme-outcome-garment", closetItemId: "top-1" };
    assert.equal(ref.closetItemId, "top-1");
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
  it("buy-skip-analysis — the BuyOrSkipAnalysis row, never a BuySkipOutcome id", () => {
    const ref: ProvenanceRef = { kind: "buy-skip-analysis", id: "analysis-1" };
    assert.equal(ref.id, "analysis-1");
  });
  it("buy-skip-outcome — the BuySkipOutcome row, never a BuyOrSkipAnalysis id", () => {
    const ref: ProvenanceRef = { kind: "buy-skip-outcome", id: "outcome-1" };
    assert.equal(ref.id, "outcome-1");
  });
  it("there is no generic buy-skip variant — the two tables have two different id spaces", () => {
    // Enforced at the type level: ProvenanceRef's union no longer has a
    // "buy-skip" member at all, so writing one is a compile error, not a
    // runtime check. This test exists to document that intent plainly.
    const refs: ProvenanceRef[] = [
      { kind: "buy-skip-analysis", id: "analysis-1" },
      { kind: "buy-skip-outcome", id: "outcome-1" },
    ];
    assert.deepEqual(refs.map((r) => r.kind), ["buy-skip-analysis", "buy-skip-outcome"]);
  });
});

describe("§CIC-4 FindingSupport — not mutually comparable, one shape per kind", () => {
  it("direct carries no value at all", () => {
    const s: FindingSupport = { kind: "direct" };
    assert.deepEqual(s, { kind: "direct" });
  });
  it("count, bare — no tier, no qualifier required", () => {
    const s: FindingSupport = { kind: "count", value: 8 };
    assert.equal(s.value, 8);
  });
  it("count with a source-native tier", () => {
    const s: FindingSupport = { kind: "count", value: 3, tier: "strongly-supported" };
    assert.equal(s.tier, "strongly-supported");
  });
  it("count with an outcome-specific qualifier — positive, negative, mixed, and neutral are each distinct", () => {
    const positive: FindingSupport = { kind: "count", value: 3, qualifier: "positive" };
    const negative: FindingSupport = { kind: "count", value: 1, qualifier: "negative" };
    const mixed: FindingSupport = { kind: "count", value: 1, qualifier: "mixed" };
    const neutral: FindingSupport = { kind: "count", value: 1, qualifier: "neutral" };
    const all = [positive.qualifier, negative.qualifier, mixed.qualifier, neutral.qualifier];
    assert.equal(new Set(all).size, 4, "all four qualifiers must be pairwise distinct");
  });

  it("neutral is not the same as omitting qualifier — a purchase-decision finding has no qualifier at all, not a neutral one", () => {
    const noQualifier: FindingSupport = { kind: "count", value: 1 };
    const neutral: FindingSupport = { kind: "count", value: 1, qualifier: "neutral" };
    assert.equal(noQualifier.qualifier, undefined);
    assert.equal(neutral.qualifier, "neutral");
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
      value: "black", signalClass: "explicit-truth", source: "passport", dimension: "favorite-color",
      provenanceRefs: [{ kind: "passport", field: "favoriteColors" }],
      support: { kind: "direct" }, temporal: { kind: "stated" },
      customerFacingSafe: true, cohortEligible: true,
    };
    assert.equal(f.signalClass, "explicit-truth");
  });

  it("observed-state (Closet) — never assigned a precedence rank", () => {
    const f: ResolvedFinding = {
      value: "work", signalClass: "observed-state", source: "closet-state", dimension: "register",
      provenanceRefs: [{ kind: "closet-state", itemIds: ["g1", "g2"] }],
      support: { kind: "structural", value: 2, label: "Limited usable work depth" },
      temporal: { kind: "snapshot", observedAt: "2026-10-02" },
      customerFacingSafe: true, cohortEligible: true,
    };
    assert.equal((PRECEDENCE_ORDER as readonly SignalClass[]).includes(f.signalClass), false);
  });

  it("explicit-demand (StyleMe demand)", () => {
    const f: ResolvedFinding = {
      value: "work", signalClass: "explicit-demand", source: "styleme-demand", dimension: "register",
      provenanceRefs: [{ kind: "styleme-demand", id: "session-1" }],
      support: { kind: "count", value: 8 },
      temporal: { kind: "range", firstSeen: "2026-07-20", lastSeen: "2026-10-01" },
      customerFacingSafe: true, cohortEligible: true,
    };
    assert.equal(f.source, "styleme-demand");
  });

  it("derived-inference (StyleTendency), not customer-facing-safe by default", () => {
    const f: ResolvedFinding = {
      value: "comfort", signalClass: "derived-inference", source: "taste-tendency", dimension: "comfort",
      provenanceRefs: [{ kind: "taste-tendency", id: "tendency-1" }],
      support: { kind: "reconciled", score: 4.2, state: "CONFIRMED" },
      temporal: { kind: "snapshot", observedAt: "2026-10-02" },
      customerFacingSafe: false, cohortEligible: false,
    };
    assert.equal(f.customerFacingSafe, false);
  });
});

describe("§CIC-7 source identifies WHERE evidence came from; dimension identifies WHAT it represents", () => {
  it("one source (styleme-demand) legitimately produces findings across two different dimensions", () => {
    const register: ResolvedFinding = {
      value: "work", signalClass: "explicit-demand", source: "styleme-demand", dimension: "register",
      provenanceRefs: [], support: { kind: "count", value: 8 }, temporal: { kind: "none" },
      customerFacingSafe: true, cohortEligible: true,
    };
    const intention: ResolvedFinding = {
      value: "feel-like-myself", signalClass: "explicit-demand", source: "styleme-demand", dimension: "intention",
      provenanceRefs: [], support: { kind: "count", value: 27 }, temporal: { kind: "none" },
      customerFacingSafe: false, cohortEligible: true,
    };
    assert.equal(register.source, intention.source);
    assert.notEqual(register.dimension, intention.dimension);
  });

  it("source alone is never enough to distinguish an outfit-formula finding from a garment finding — dimension is required for that", () => {
    const formula: ResolvedFinding = {
      value: "g1|g3", signalClass: "explicit-outcome", source: "styleme-outcome", dimension: "outfit-formula",
      provenanceRefs: [{ kind: "styleme-outcome-formula", formulaKey: "g1|g3" }],
      support: { kind: "count", value: 3, tier: "strongly-supported", qualifier: "positive" },
      temporal: { kind: "range", firstSeen: "2026-09-01", lastSeen: "2026-09-19" },
      customerFacingSafe: false, cohortEligible: false,
    };
    const garment: ResolvedFinding = {
      value: "g1", signalClass: "explicit-outcome", source: "styleme-outcome", dimension: "garment",
      provenanceRefs: [{ kind: "styleme-outcome-garment", closetItemId: "g1" }],
      support: { kind: "count", value: 3, qualifier: "positive" },
      temporal: { kind: "range", firstSeen: "2026-09-01", lastSeen: "2026-09-19" },
      customerFacingSafe: false, cohortEligible: false,
    };
    assert.equal(formula.source, garment.source);
    assert.notEqual(formula.dimension, garment.dimension);
  });
});

describe("§CIC-9 subject carries what a decision/outcome state is about, without compounding it into value", () => {
  it("FindingSubject, garment-category", () => {
    const s: FindingSubject = { kind: "garment-category", value: "Dress" };
    assert.equal(s.value, "Dress");
  });

  it("purchase-decision: value is the decision state, subject is the category — never a compound string", () => {
    const f: ResolvedFinding = {
      value: "BOUGHT_IT", signalClass: "explicit-outcome", source: "buy-skip-outcome", dimension: "purchase-decision",
      subject: { kind: "garment-category", value: "Dress" },
      provenanceRefs: [{ kind: "buy-skip-outcome", id: "outcome-1" }],
      support: { kind: "direct" }, temporal: { kind: "snapshot", observedAt: "2026-10-02" },
      customerFacingSafe: true, cohortEligible: true,
    };
    assert.equal(f.value, "BOUGHT_IT");
    assert.equal(f.subject?.value, "Dress");
    assert.ok(!f.value.includes("|"), "value must never be a compound string encoding subject + state");
  });

  it("subject is absent for findings where the category already IS value (considered-category)", () => {
    const f: ResolvedFinding = {
      value: "Dress", signalClass: "explicit-demand", source: "buy-skip-analysis", dimension: "considered-category",
      provenanceRefs: [{ kind: "buy-skip-analysis", id: "analysis-1" }],
      support: { kind: "direct" }, temporal: { kind: "snapshot", observedAt: "2026-10-02" },
      customerFacingSafe: true, cohortEligible: true,
    };
    assert.equal(f.subject, undefined);
  });

  it("post-purchase-outcome: three distinct qualifiers over the same subject", () => {
    const loveIt: ResolvedFinding = {
      value: "LOVE_IT", signalClass: "explicit-outcome", source: "buy-skip-outcome", dimension: "post-purchase-outcome",
      subject: { kind: "garment-category", value: "Dress" },
      provenanceRefs: [{ kind: "buy-skip-outcome", id: "outcome-1" }],
      support: { kind: "count", value: 1, qualifier: "positive" }, temporal: { kind: "snapshot", observedAt: "2026-10-02" },
      customerFacingSafe: true, cohortEligible: true,
    };
    const itsOkay: ResolvedFinding = { ...loveIt, value: "ITS_OKAY", support: { kind: "count", value: 1, qualifier: "neutral" } };
    const returnedIt: ResolvedFinding = { ...loveIt, value: "RETURNED_IT", support: { kind: "count", value: 1, qualifier: "negative" } };
    assert.equal(loveIt.subject?.value, itsOkay.subject?.value);
    assert.equal(itsOkay.subject?.value, returnedIt.subject?.value);
    assert.notEqual((loveIt.support as { qualifier?: string }).qualifier, (itsOkay.support as { qualifier?: string }).qualifier);
    assert.notEqual((itsOkay.support as { qualifier?: string }).qualifier, (returnedIt.support as { qualifier?: string }).qualifier);
  });
});

describe("§CIC-8 a mixed outcome finding can never be mistaken for an affirmative claim", () => {
  it("signalClass alone (explicit-outcome) does not distinguish positive from mixed — support.qualifier does, and is a distinct value for each", () => {
    const positive: ResolvedFinding = {
      value: "g1|g3", signalClass: "explicit-outcome", source: "styleme-outcome", dimension: "outfit-formula",
      provenanceRefs: [{ kind: "styleme-outcome-formula", formulaKey: "g1|g3" }],
      support: { kind: "count", value: 3, qualifier: "positive" }, temporal: { kind: "none" },
      customerFacingSafe: false, cohortEligible: false,
    };
    const mixed: ResolvedFinding = {
      ...positive,
      support: { kind: "count", value: 1, qualifier: "mixed" },
    };
    assert.equal(positive.signalClass, mixed.signalClass, "both are explicit-outcome — signalClass cannot be used to tell them apart");
    assert.notEqual(
      (positive.support as { qualifier?: string }).qualifier,
      (mixed.support as { qualifier?: string }).qualifier,
      "a resolver MUST read support.qualifier, not signalClass, to know whether this is affirmative",
    );
    assert.notEqual((mixed.support as { qualifier?: string }).qualifier, "positive");
  });
});
