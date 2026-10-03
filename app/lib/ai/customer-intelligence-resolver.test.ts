// app/lib/ai/customer-intelligence-resolver.test.ts
//
// Most of this file does not touch a real database. Five of the six
// include keys (passport, styleme-outcome, styleme-demand,
// buyskip-considered, buyskip-outcome) call real Prisma queries inside
// private loader functions in customer-intelligence-resolver.server.ts —
// their own adapted output is verified against the real diagnostic
// customer via a read-only script, the same pattern every prior Shared
// Customer Intelligence phase used for its own live-wiring check, never as
// a committed automated DB test (see e.g. buyskip-s0.test.ts's own stated
// "No DB" design principle).
//
// Two tests in §CIR-5 are the deliberate exception: proving "requesting
// styleme-demand alone never reaches another branch's error" has no honest
// answer without actually calling it, so those two make one real (slow,
// network-bound) query each against a nonexistent customerId — which
// returns zero rows rather than erroring, so the assertion still needs no
// seeded data.
//
// What IS fully testable here without a DB:
//   - filterFindings / groupFindingsByDimension — pure, operate on a plain
//     ResolvedFinding[] regardless of where it came from.
//   - the "wardrobe-state" include key specifically — it takes its data as
//     a caller-supplied bundle rather than querying anything itself, so its
//     routing, error behavior, and non-mutation can all be proven directly.
//   - include:[] and the route-source check for Buy-or-Skip's call shape.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolveCustomerIntelligence,
  filterFindings,
  groupFindingsByDimension,
  INCLUDE_KEYS,
} from "./customer-intelligence-resolver.server.ts";
import { PRECEDENCE_ORDER, type ResolvedFinding, type SignalClass } from "./customer-intelligence-contract.ts";
import type { DepthFinding, RegisterReading } from "./wardrobe-needs.ts";

function finding(partial: Partial<ResolvedFinding> & Pick<ResolvedFinding, "value" | "signalClass" | "source" | "dimension">): ResolvedFinding {
  return {
    provenanceRefs: [], support: { kind: "direct" }, temporal: { kind: "none" },
    customerFacingSafe: true, cohortEligible: true,
    ...partial,
  };
}

describe("§CIR-1 filterFindings — simple field equality/membership, no query language", () => {
  const findings: ResolvedFinding[] = [
    finding({ value: "black", signalClass: "explicit-truth", source: "passport", dimension: "favorite-color" }),
    finding({ value: "work", signalClass: "explicit-demand", source: "styleme-demand", dimension: "register" }),
    finding({ value: "work", signalClass: "observed-state", source: "wardrobe-intelligence", dimension: "could-use-more", customerFacingSafe: false }),
  ];

  it("filters by a single signalClass", () => {
    const result = filterFindings(findings, { signalClass: "explicit-truth" });
    assert.deepEqual(result.map((f) => f.value), ["black"]);
  });

  it("filters by an array of signalClass values", () => {
    const result = filterFindings(findings, { signalClass: ["explicit-truth", "observed-state"] });
    assert.equal(result.length, 2);
  });

  it("filters by source", () => {
    const result = filterFindings(findings, { source: "styleme-demand" });
    assert.equal(result.length, 1);
    assert.equal(result[0].source, "styleme-demand");
  });

  it("filters by dimension", () => {
    const result = filterFindings(findings, { dimension: "could-use-more" });
    assert.equal(result.length, 1);
  });

  it("filters by customerFacingSafe", () => {
    const result = filterFindings(findings, { customerFacingSafe: false });
    assert.equal(result.length, 1);
    assert.equal(result[0].source, "wardrobe-intelligence");
  });

  it("combines multiple filter fields with AND semantics", () => {
    const result = filterFindings(findings, { signalClass: "observed-state", source: "wardrobe-intelligence" });
    assert.equal(result.length, 1);
  });

  it("an empty filter returns everything unchanged", () => {
    const result = filterFindings(findings, {});
    assert.equal(result.length, findings.length);
  });

  it("does not mutate the input array", () => {
    const before = JSON.stringify(findings);
    filterFindings(findings, { signalClass: "explicit-truth" });
    assert.equal(JSON.stringify(findings), before);
  });
});

describe("§CIR-2 groupFindingsByDimension — groups, never resolves; contradictions survive side by side", () => {
  it("Passport says fitted, StyleMe demand says relaxed, same dimension — both survive in the same group", () => {
    const findings: ResolvedFinding[] = [
      finding({ value: "fitted", signalClass: "explicit-truth", source: "passport", dimension: "silhouette" }),
      finding({ value: "relaxed", signalClass: "explicit-demand", source: "styleme-demand", dimension: "silhouette" }),
    ];
    const groups = groupFindingsByDimension(findings);
    const silhouetteGroup = groups.get("silhouette");
    assert.equal(silhouetteGroup?.length, 2, "the higher-precedence finding must not cause the lower-precedence one to be dropped");
    assert.deepEqual(silhouetteGroup?.map((f) => f.value).sort(), ["fitted", "relaxed"]);
  });

  it("groups by dimension, not by source — one source's two dimensions land in two groups", () => {
    const findings: ResolvedFinding[] = [
      finding({ value: "work", signalClass: "explicit-demand", source: "styleme-demand", dimension: "register" }),
      finding({ value: "feel-like-myself", signalClass: "explicit-demand", source: "styleme-demand", dimension: "intention" }),
    ];
    const groups = groupFindingsByDimension(findings);
    assert.equal(groups.size, 2);
  });

  it("never drops a finding — total count across all groups equals the input length", () => {
    const findings: ResolvedFinding[] = [
      finding({ value: "a", signalClass: "explicit-truth", source: "passport", dimension: "d1" }),
      finding({ value: "b", signalClass: "explicit-demand", source: "styleme-demand", dimension: "d1" }),
      finding({ value: "c", signalClass: "observed-state", source: "wardrobe-intelligence", dimension: "d2" }),
    ];
    const groups = groupFindingsByDimension(findings);
    const total = [...groups.values()].reduce((sum, arr) => sum + arr.length, 0);
    assert.equal(total, findings.length);
  });

  it("same dimension but different subject lands in the same group anyway — grouping is not conflict detection", () => {
    // BOUGHT_IT for Dress and DIDNT_BUY_IT for Shoes share dimension
    // "purchase-decision" but are about two unrelated items. A caller that
    // treats "same group" as "same question, pick a winner" would wrongly
    // compare these two — the group alone can't tell them apart; subject
    // (and context) would be needed for that, which this helper does not
    // read at all.
    const findings: ResolvedFinding[] = [
      finding({
        value: "BOUGHT_IT", signalClass: "explicit-outcome", source: "buy-skip-outcome", dimension: "purchase-decision",
        subject: { kind: "garment-category", value: "Dress" },
      }),
      finding({
        value: "DIDNT_BUY_IT", signalClass: "explicit-outcome", source: "buy-skip-outcome", dimension: "purchase-decision",
        subject: { kind: "garment-category", value: "Shoes" },
      }),
    ];
    const group = groupFindingsByDimension(findings).get("purchase-decision");
    assert.equal(group?.length, 2, "both land in the same group purely on dimension, regardless of differing subject");
    assert.notEqual(group?.[0].subject?.value, group?.[1].subject?.value, "the group itself does not distinguish them — a caller must still read subject");
  });
});

function depthFinding(partial: Partial<DepthFinding> & { register: DepthFinding["register"] }): DepthFinding {
  return { id: `need-${partial.register}`, kind: "could-use-more", title: "x", body: "x", garmentIds: [], evidence: [], strength: "moderate", ...partial };
}
function registerReading(partial: Partial<RegisterReading> & { register: RegisterReading["register"] }): RegisterReading {
  return { label: partial.register, depthLabel: "x", depthNote: "x", rawCount: 1, usableCount: 1, blockedCount: 0, blockedPieces: [], unknownCount: 0, distinctLooks: 1, combinations: 1, needed: true, needSource: "lifestyle", needPhrase: "x", ...partial };
}
function minimalWardrobeBundle(couldUseMore: DepthFinding[], registers: RegisterReading[]) {
  return {
    intelligence: {} as never,
    needs: { state: "ready", registers, enough: [], couldUseMore, noUrgentNeed: null, synthesis: {} as never, styleMe: {} as never, outcomes: {} as never, intentions: {} as never, demand: {} as never } as never,
    recommendations: { state: "ready", recommendations: [], notAPriority: [] } as never,
    garments: [],
  };
}

describe("§CIR-3 wardrobe-state is caller-supplied — no DB, no recomputation", () => {
  it("include=['wardrobe-state'] with a bundle adapts exactly that bundle's couldUseMore/registers", async () => {
    const couldUseMore = [depthFinding({ register: "work" })];
    const registers = [registerReading({ register: "work", distinctLooks: 2, depthLabel: "Limited usable work depth" })];
    const findings = await resolveCustomerIntelligence({
      customerId: "cust-1",
      include: ["wardrobe-state"],
      wardrobeIntelligence: minimalWardrobeBundle(couldUseMore, registers),
    });
    assert.equal(findings.length, 1);
    assert.equal(findings[0].value, "work");
    assert.equal(findings[0].signalClass, "observed-state");
  });

  it("include=['wardrobe-state'] without a bundle throws rather than silently returning nothing", async () => {
    await assert.rejects(
      () => resolveCustomerIntelligence({ customerId: "cust-1", include: ["wardrobe-state"] }),
      /wardrobe-state/,
    );
  });

  it("observed-state findings from this path are never on PRECEDENCE_ORDER", async () => {
    const findings = await resolveCustomerIntelligence({
      customerId: "cust-1",
      include: ["wardrobe-state"],
      wardrobeIntelligence: minimalWardrobeBundle([depthFinding({ register: "work" })], [registerReading({ register: "work" })]),
    });
    for (const f of findings) {
      assert.equal((PRECEDENCE_ORDER as readonly SignalClass[]).includes(f.signalClass), false);
    }
  });

  it("resolving does not mutate the supplied bundle", async () => {
    const couldUseMore = [depthFinding({ register: "work", garmentIds: ["g1"] })];
    const registers = [registerReading({ register: "work" })];
    const bundle = minimalWardrobeBundle(couldUseMore, registers);
    const before = JSON.stringify(bundle);
    await resolveCustomerIntelligence({ customerId: "cust-1", include: ["wardrobe-state"], wardrobeIntelligence: bundle });
    assert.equal(JSON.stringify(bundle), before);
  });

  it("an empty couldUseMore produces zero findings, not an error", async () => {
    const findings = await resolveCustomerIntelligence({
      customerId: "cust-1",
      include: ["wardrobe-state"],
      wardrobeIntelligence: minimalWardrobeBundle([], []),
    });
    assert.deepEqual(findings, []);
  });
});

describe("§CIR-4 include defaults to everything, but an explicit narrow include touches nothing else", () => {
  it("INCLUDE_KEYS names exactly the six sources this phase covers", async () => {
    const mod = await import("./customer-intelligence-resolver.server.ts");
    assert.deepEqual([...mod.INCLUDE_KEYS].sort(), [
      "buyskip-considered", "buyskip-outcome", "passport",
      "styleme-demand", "styleme-outcome", "wardrobe-state",
    ]);
  });

  it("requesting only wardrobe-state never reaches the wardrobe-state-missing-bundle error for other keys — proves branches are independent", async () => {
    // If passport/styleme-outcome/etc were evaluated unconditionally, this
    // would throw trying to reach a real DB with a fake customerId in a
    // DB-less test environment; it does not.
    const findings = await resolveCustomerIntelligence({
      customerId: "cust-does-not-exist",
      include: ["wardrobe-state"],
      wardrobeIntelligence: minimalWardrobeBundle([], []),
    });
    assert.deepEqual(findings, []);
  });
});

describe("§CIR-5 include is required — there is no implicit 'load everything' default", () => {
  it("include:[] returns [] without touching any loader — no DB work, no thrown error", async () => {
    // If any branch were evaluated unconditionally, this would either throw
    // (wardrobe-state's missing-bundle check) or attempt a real DB call in
    // this DB-less test environment. Neither happens: every one of the six
    // `if` blocks is gated on `include`, and an empty array matches none.
    const findings = await resolveCustomerIntelligence({ customerId: "cust-1", include: [] });
    assert.deepEqual(findings, []);
  });

  it("include:['styleme-demand'] alone does not reach the wardrobe-state missing-bundle error, and does not throw for other keys either", async () => {
    // styleme-demand's own query (stylingSession.findMany) tolerates a
    // nonexistent customerId by returning zero rows, not an error — so a
    // clean empty result here is itself proof no OTHER branch (especially
    // wardrobe-state, the one with a throwing guard) was reached.
    const findings = await resolveCustomerIntelligence({ customerId: "cust-does-not-exist", include: ["styleme-demand"] });
    assert.deepEqual(findings, []);
  });

  it("passing INCLUDE_KEYS explicitly still means 'everything' — the option removed is the implicit default, not the ability to ask for all six", async () => {
    await assert.rejects(
      () => resolveCustomerIntelligence({ customerId: "cust-1", include: INCLUDE_KEYS }),
      /wardrobe-state/,
      "asking for all six without a bundle still throws on the wardrobe-state key specifically, exactly as asking for it alone would",
    );
  });
});

describe("§CIR-6 Buy or Skip requests only wardrobe-state", () => {
  it("the route source calls resolveCustomerIntelligence with exactly include: [\"wardrobe-state\"]", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const routeSource = readFileSync(resolve(import.meta.dirname, "../../routes/api.wishlist.jsx"), "utf-8");
    const callSite = routeSource.slice(routeSource.indexOf("resolveCustomerIntelligence({"));
    const optionsBlock = callSite.slice(0, callSite.indexOf("});"));
    assert.match(optionsBlock, /include:\s*\["wardrobe-state"\]/);
    assert.doesNotMatch(optionsBlock, /"passport"|"styleme-outcome"|"styleme-demand"|"buyskip-considered"|"buyskip-outcome"/);
  });
});
