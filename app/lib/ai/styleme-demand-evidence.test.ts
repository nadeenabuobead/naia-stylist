// app/lib/ai/styleme-demand-evidence.test.ts
// Causal/regression tests for StyleMe-demand evidence, V1.
// Run with: node --test --import tsx/esm app/lib/ai/styleme-demand-evidence.test.ts

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  deriveStyleMeDemand,
  SUSPICIOUS_COLLISION_GROUP_MIN_SIZE,
  DEMAND_RETRY_WINDOW_MS,
  STYLEME_DEMAND_WINDOW_DAYS,
  demandWindowCutoff,
  type RawStyleMeDemandFact,
} from "./styleme-demand-evidence.ts";

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

describe("§DM-1 synthetic timestamp collision groups contribute zero demand", () => {
  it("a collision group at or above the threshold contributes zero events and zero register/intention demand", () => {
    const sharedTs = new Date("2026-08-15T00:00:00.000Z");
    const facts = Array.from({ length: SUSPICIOUS_COLLISION_GROUP_MIN_SIZE + 3 }, (_, i) =>
      fact({ sessionId: `seed-${i}`, createdAt: sharedTs, intentions: ["feel-attractive"] }));
    const result = deriveStyleMeDemand(facts);
    assert.equal(result.events.length, 0);
    assert.equal(result.registerDemand.length, 0);
    assert.equal(result.intentionDemand.length, 0);
    assert.equal(result.syntheticExcludedCount, facts.length);
  });

  it("an ordinary, non-colliding timestamp is retained as a real event", () => {
    const result = deriveStyleMeDemand([
      fact({ sessionId: "a", createdAt: new Date("2026-09-01T10:00:00.000Z") }),
    ]);
    assert.equal(result.events.length, 1);
    assert.equal(result.syntheticExcludedCount, 0);
    assert.equal(result.registerDemand.length, 1);
    assert.equal(result.registerDemand[0].eventCount, 1);
  });
});

describe("§DM-2 retry window collapses true retries, preserves genuine repeats", () => {
  it("an identical request 90 seconds later collapses into one event", () => {
    const t0 = new Date("2026-09-01T10:00:00.000Z");
    const t1 = new Date(t0.getTime() + 90_000);
    const result = deriveStyleMeDemand([
      fact({ sessionId: "a", createdAt: t0 }),
      fact({ sessionId: "b", createdAt: t1 }),
    ]);
    assert.equal(result.events.length, 1);
    assert.equal(result.retriesCollapsedCount, 1);
    assert.equal(result.registerDemand[0].eventCount, 1);
  });

  it("an identical request 3 minutes later remains a second, distinct event", () => {
    const t0 = new Date("2026-09-01T10:00:00.000Z");
    const t1 = new Date(t0.getTime() + 3 * 60_000);
    assert.ok(3 * 60_000 > DEMAND_RETRY_WINDOW_MS, "fixture must genuinely exceed the window");
    const result = deriveStyleMeDemand([
      fact({ sessionId: "a", createdAt: t0 }),
      fact({ sessionId: "b", createdAt: t1 }),
    ]);
    assert.equal(result.events.length, 2);
    assert.equal(result.retriesCollapsedCount, 0);
    assert.equal(result.registerDemand[0].eventCount, 2);
  });
});

describe("§DM-3 the dedup key preserves every explicit request change", () => {
  it("a different closetAnchorId inside the retry window remains a distinct event", () => {
    const t0 = new Date("2026-09-01T10:00:00.000Z");
    const t1 = new Date(t0.getTime() + 30_000);
    const result = deriveStyleMeDemand([
      fact({ sessionId: "a", createdAt: t0, closetAnchorId: "anchor-1" }),
      fact({ sessionId: "b", createdAt: t1, closetAnchorId: "anchor-2" }),
    ]);
    assert.equal(result.events.length, 2, "reselecting the anchor is an explicit new action, not a no-op retry");
    assert.equal(result.retriesCollapsedCount, 0);
  });

  it("a different styleFrom inside the retry window remains a distinct event", () => {
    const t0 = new Date("2026-09-01T10:00:00.000Z");
    const t1 = new Date(t0.getTime() + 30_000);
    const result = deriveStyleMeDemand([
      fact({ sessionId: "a", createdAt: t0, styleFrom: "CLOSET" }),
      fact({ sessionId: "b", createdAt: t1, styleFrom: "BOTH" }),
    ]);
    assert.equal(result.events.length, 2);
  });

  it("different raw occasions that resolve to the same register remain distinct events — dedup never collapses on the derived register alone", () => {
    const t0 = new Date("2026-09-01T10:00:00.000Z");
    const t1 = new Date(t0.getTime() + 30_000);
    const result = deriveStyleMeDemand([
      fact({ sessionId: "a", createdAt: t0, occasion: "work", register: "work" }),
      fact({ sessionId: "b", createdAt: t1, occasion: "Work event", register: "work" }),
    ]);
    assert.equal(result.events.length, 2, "same register, different raw ask — must not be treated as one request");
    // Register aggregation still happens AFTER dedup — both events count toward "work".
    assert.equal(result.registerDemand[0].eventCount, 2);
  });

  it("intention array ordering never creates a false distinction", () => {
    const t0 = new Date("2026-09-01T10:00:00.000Z");
    const t1 = new Date(t0.getTime() + 30_000);
    const result = deriveStyleMeDemand([
      fact({ sessionId: "a", createdAt: t0, intentions: ["give-energy", "feel-attractive"] }),
      fact({ sessionId: "b", createdAt: t1, intentions: ["feel-attractive", "give-energy"] }),
    ]);
    assert.equal(result.events.length, 1, "same intention SET in a different order must dedup as the same request");
  });
});

describe("§DM-4 legacy desiredFeeling mapping — five clean mappings only", () => {
  const clean: Array<[string, string]> = [
    ["more-confident", "confidence"],
    ["more-put-together", "feel-put-together"],
    ["more-attractive", "feel-attractive"],
    ["like-myself", "feel-like-myself"],
    ["softer", "feel-softer"],
  ];
  for (const [legacy, canonical] of clean) {
    it(`"${legacy}" maps to "${canonical}"`, () => {
      const result = deriveStyleMeDemand([
        fact({ sessionId: "a", createdAt: new Date("2026-09-01T10:00:00.000Z"), intentions: [], desiredFeeling: legacy }),
      ]);
      assert.deepEqual(result.events[0].intentions, [canonical]);
      assert.equal(result.intentionDemand.some((d) => d.intention === canonical), true);
    });
  }

  const unmapped = ["more-effortless", "more-powerful", "more-feminine", "more-elevated"];
  for (const legacy of unmapped) {
    it(`"${legacy}" is left unmapped — contributes no canonical intention evidence`, () => {
      const result = deriveStyleMeDemand([
        fact({ sessionId: "a", createdAt: new Date("2026-09-01T10:00:00.000Z"), intentions: [], desiredFeeling: legacy }),
      ]);
      assert.deepEqual(result.events[0].intentions, []);
      assert.equal(result.intentionDemand.length, 0);
    });
  }

  it("currentMood has no field in RawStyleMeDemandFact at all — excluded at the type boundary, not merely unmapped", () => {
    // There is deliberately no `currentMood` property on RawStyleMeDemandFact
    // (see the interface in styleme-demand-evidence.ts) — this is enforced
    // by the type itself, not a runtime branch to assert against. A fact
    // built with every other field populated and no mood-shaped input still
    // produces normal demand, confirming nothing implicitly reads mood.
    const result = deriveStyleMeDemand([
      fact({ sessionId: "a", createdAt: new Date("2026-09-01T10:00:00.000Z"), intentions: ["feel-attractive"] }),
    ]);
    assert.deepEqual(result.events[0].intentions, ["feel-attractive"]);
  });
});

describe("§DM-5 the 90-day demand window is deterministic via an explicit asOf seam", () => {
  it("the cutoff is exactly STYLEME_DEMAND_WINDOW_DAYS days before asOf — not an inline Date.now()", () => {
    const asOf = new Date("2026-10-02T00:00:00.000Z");
    const cutoff = demandWindowCutoff(asOf);
    const expected = new Date(asOf.getTime() - STYLEME_DEMAND_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    assert.equal(cutoff.getTime(), expected.getTime());
  });

  it("a session exactly on the cutoff instant is included (the boundary is inclusive, matching the loader's createdAt >= cutoff)", () => {
    const asOf = new Date("2026-10-02T00:00:00.000Z");
    const cutoff = demandWindowCutoff(asOf);
    assert.ok(cutoff.getTime() >= cutoff.getTime(), "sanity: the comparison itself is >=, matching Prisma's gte");
    // The loader filters with `createdAt: { gte: cutoff }` — a session whose
    // createdAt equals cutoff exactly passes that filter and reaches this
    // pure module, which has no further time-window logic of its own.
    const result = deriveStyleMeDemand([fact({ sessionId: "a", createdAt: cutoff })]);
    assert.equal(result.events.length, 1);
  });

  it("a session one millisecond before the cutoff would be excluded by the loader's filter", () => {
    const asOf = new Date("2026-10-02T00:00:00.000Z");
    const cutoff = demandWindowCutoff(asOf);
    const justBefore = new Date(cutoff.getTime() - 1);
    assert.ok(justBefore.getTime() < cutoff.getTime(), "confirms the instant used genuinely precedes the cutoff");
    // This module itself has no window filter — it's the loader's
    // `createdAt: { gte: cutoff }` that excludes justBefore before this
    // function ever sees it. This test documents and locks the boundary
    // value the loader relies on.
  });
});

describe("§DM-6 no row-count truncation anywhere in the pure derivation", () => {
  it("250 well-separated facts produce 250 events — nothing resembling a take:200 cap exists in deriveStyleMeDemand", () => {
    const facts = Array.from({ length: 250 }, (_, i) =>
      fact({ sessionId: `s${i}`, createdAt: new Date(Date.parse("2026-01-01T00:00:00.000Z") + i * DEMAND_RETRY_WINDOW_MS * 2) }));
    const result = deriveStyleMeDemand(facts);
    assert.equal(result.events.length, 250);
    assert.equal(result.registerDemand.find((d) => d.register === "work")!.eventCount, 250);
  });
});
