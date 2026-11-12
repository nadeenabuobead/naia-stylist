// app/lib/ai/customer-intelligence-wardrobe-adapter.test.ts
// Causal tests for the Phase 3 Wardrobe Intelligence structural adapter.
// Run with: node --test --import tsx/esm app/lib/ai/customer-intelligence-wardrobe-adapter.test.ts

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { adaptWardrobeFindings, WARDROBE_INTELLIGENCE_SOURCE } from "./customer-intelligence-wardrobe-adapter.ts";
import type { DepthFinding, RegisterReading } from "./wardrobe-needs.ts";
import { PRECEDENCE_ORDER, type SignalClass } from "./customer-intelligence-contract.ts";

function depthFinding(partial: Partial<DepthFinding> & { register: DepthFinding["register"] }): DepthFinding {
  return {
    id: `need-${partial.register}`,
    kind: "could-use-more",
    title: "x", body: "x", garmentIds: [], evidence: [], strength: "moderate",
    ...partial,
  };
}

describe("§CIA-WI-1 signalClass, source, and dimension", () => {
  it("every finding is observed-state, from source wardrobe-intelligence, with dimension carrying the real FindingKind", () => {
    const findings = [
      depthFinding({ register: "work", kind: "could-use-more" }),
      depthFinding({ register: "everyday", kind: "repetition" }),
    ];
    const registers: RegisterReading[] = [
      { register: "work", label: "work", depthLabel: "Limited usable work depth", depthNote: "x", rawCount: 11, usableCount: 11, blockedCount: 0, conditionallyUsableCount: 0, confirmedBlockedCount: 0, blockedPieces: [], unknownCount: 0, distinctLooks: 2, combinations: 4, needed: true, needSource: "lifestyle", needPhrase: "work" },
      { register: "everyday", label: "everyday", depthLabel: "Strong everyday depth", depthNote: "x", rawCount: 20, usableCount: 18, blockedCount: 0, conditionallyUsableCount: 0, confirmedBlockedCount: 0, blockedPieces: [], unknownCount: 0, distinctLooks: 9, combinations: 18, needed: true, needSource: "lifestyle", needPhrase: "everyday" },
    ];
    const resolved = adaptWardrobeFindings(findings, registers);
    assert.equal(resolved[0].signalClass, "observed-state");
    assert.equal(resolved[0].source, WARDROBE_INTELLIGENCE_SOURCE);
    assert.equal(resolved[0].dimension, "could-use-more");
    assert.equal(resolved[1].dimension, "repetition");
  });

  it("observed-state is never on PRECEDENCE_ORDER — this adapter's output can never be ranked against a preference/demand finding", () => {
    const resolved = adaptWardrobeFindings(
      [depthFinding({ register: "work" })],
      [{ register: "work", label: "work", depthLabel: "x", depthNote: "x", rawCount: 1, usableCount: 1, blockedCount: 0, conditionallyUsableCount: 0, confirmedBlockedCount: 0, blockedPieces: [], unknownCount: 0, distinctLooks: 1, combinations: 1, needed: true, needSource: "lifestyle", needPhrase: "work" }],
    );
    assert.equal((PRECEDENCE_ORDER as readonly SignalClass[]).includes(resolved[0].signalClass), false);
  });
});

describe("§CIA-WI-2 support reuses the real RegisterReading verbatim — never recomputed", () => {
  it("support.value/label come from the matching register's distinctLooks/depthLabel", () => {
    const findings = [depthFinding({ register: "work" })];
    const registers: RegisterReading[] = [{ register: "work", label: "work", depthLabel: "Limited usable work depth", depthNote: "x", rawCount: 11, usableCount: 11, blockedCount: 0, conditionallyUsableCount: 0, confirmedBlockedCount: 0, blockedPieces: [], unknownCount: 0, distinctLooks: 2, combinations: 4, needed: true, needSource: "lifestyle", needPhrase: "work" }];
    const [finding] = adaptWardrobeFindings(findings, registers);
    assert.deepEqual(finding.support, { kind: "structural", value: 2, label: "Limited usable work depth" });
  });

  it("no matching register reading leaves value/label undefined rather than inventing one", () => {
    const [finding] = adaptWardrobeFindings([depthFinding({ register: "occasion" })], []);
    assert.deepEqual(finding.support, { kind: "structural", value: undefined, label: undefined });
  });
});

describe("§CIA-WI-3 provenance is honest — real garment ids, or none at all", () => {
  it("garmentIds become a closet-state provenance ref", () => {
    const [finding] = adaptWardrobeFindings(
      [depthFinding({ register: "work", garmentIds: ["g1", "g2"] })],
      [],
    );
    assert.deepEqual(finding.provenanceRefs, [{ kind: "closet-state", itemIds: ["g1", "g2"] }]);
  });

  it("an empty garmentIds array produces zero provenance refs — never a fabricated one", () => {
    const [finding] = adaptWardrobeFindings([depthFinding({ register: "work", garmentIds: [] })], []);
    assert.deepEqual(finding.provenanceRefs, []);
  });
});

describe("§CIA-WI-4 temporal is always none — no invented observation time", () => {
  it("every finding uses {kind:\"none\"}, never a fabricated snapshot date", () => {
    const resolved = adaptWardrobeFindings([depthFinding({ register: "work" }), depthFinding({ register: "everyday", kind: "enough" })], []);
    for (const f of resolved) assert.deepEqual(f.temporal, { kind: "none" });
  });
});

describe("§CIA-WI-5 recommendation prose is never adapted", () => {
  it("the finding carries no title/body/attributes — only register, kind, and structural numbers", () => {
    const [finding] = adaptWardrobeFindings(
      [depthFinding({ register: "work", title: "Your work gap is not quantity", body: "long prose here" })],
      [],
    );
    assert.equal(("title" in finding), false);
    assert.equal(("body" in finding), false);
    assert.equal(finding.value, "work");
  });
});

describe("§CIA-WI-6 zero effect on the inputs it reads", () => {
  it("calling the adapter does not mutate the DepthFinding[]/RegisterReading[] arrays", () => {
    const findings = [depthFinding({ register: "work", garmentIds: ["g1"] })];
    const registers = [{ register: "work" as const, label: "work", depthLabel: "x", depthNote: "x", rawCount: 1, usableCount: 1, blockedCount: 0, conditionallyUsableCount: 0, confirmedBlockedCount: 0, blockedPieces: [], unknownCount: 0, distinctLooks: 1, combinations: 1, needed: true, needSource: "lifestyle" as const, needPhrase: "work" }];
    const before = JSON.stringify({ findings, registers });
    adaptWardrobeFindings(findings, registers);
    assert.equal(JSON.stringify({ findings, registers }), before);
  });
});
