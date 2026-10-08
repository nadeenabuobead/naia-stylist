// app/lib/buyskip/wardrobe-utility-evidence.test.ts
// B4 — causal proof for computeWardrobeUtilityEvidence().
//
// Run: node --test --import tsx/esm app/lib/buyskip/wardrobe-utility-evidence.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import {
  computeWardrobeUtilityEvidence,
  type CandidateWardrobeFacts,
  type WardrobeUtilitySource,
} from "./wardrobe-utility-evidence.server.ts";
import type { WardrobeGarment } from "~/lib/ai/wardrobe-intelligence";
import type { DepthFinding, WardrobeNeeds } from "~/lib/ai/wardrobe-needs";

const MODULE_PATH = resolve(import.meta.dirname, "wardrobe-utility-evidence.server.ts");
const MODULE_SOURCE = readFileSync(MODULE_PATH, "utf-8");

// ── Fixture builders ─────────────────────────────────────────────────────────

function garment(overrides: Partial<WardrobeGarment> = {}): WardrobeGarment {
  return {
    id: "g1",
    name: "Black top",
    category: "TOPS",
    subcategory: null,
    imageUrl: null,
    slot: "top",
    primaryColor: "black",
    colors: ["black"],
    pattern: null,
    material: null,
    silhouette: "fitted",
    fitProfile: "tailored",
    formality: "business-casual",
    stylePersonality: null,
    occasions: [],
    seasons: [],
    analysisStatus: "ready",
    visualWeight: "medium",
    colourProfile: { hueFamily: null, wardrobeNeutral: true, lightDark: "dark", energyTier: null },
    garmentRelationships: [],
    intentions: null,
    intentionsSource: null,
    intelligenceSource: "derived",
    outfitAppearances: 0,
    savedLookAppearances: 0,
    observedWear: null,
    ...overrides,
  };
}

function depthFinding(overrides: Partial<DepthFinding> = {}): DepthFinding {
  return {
    id: "finding-1",
    kind: "enough",
    register: "work",
    title: "You already have enough work neutral tops",
    body: "You already have 5 work neutral tops that work well with the rest of your Closet.",
    garmentIds: ["g1"],
    evidence: [],
    strength: "strong",
    ...overrides,
  };
}

function needs(overrides: Partial<Pick<WardrobeNeeds, "enough" | "couldUseMore">> = {}): WardrobeNeeds["enough"] extends never ? never : WardrobeNeeds {
  return {
    state: "available",
    registers: [],
    enough: [],
    couldUseMore: [],
    noUrgentNeed: null,
    synthesis: { state: "available", lines: [] },
    styleMe: { state: "available", reachedFor: [], requests: [], struggles: [], strongIntentions: [], thinIntentions: [] },
    outcomes: { state: "available", totalOutcomes: 0, keptNote: null, changedNote: null },
    intentions: { state: "available", chosen: [], closetStrengths: [] },
    demand: { state: "available", syntheticExcludedCount: 0, retriesCollapsedCount: 0, registerDemand: [], intentionDemand: [] },
    headlines: [],
    ...overrides,
  } as WardrobeNeeds;
}

function source(opts: { garments?: WardrobeGarment[]; enough?: DepthFinding[]; couldUseMore?: DepthFinding[] } = {}): WardrobeUtilitySource {
  return {
    garments: opts.garments ?? [garment()],
    needs: needs({ enough: opts.enough ?? [], couldUseMore: opts.couldUseMore ?? [] }),
  };
}

function candidate(overrides: Partial<CandidateWardrobeFacts> = {}): CandidateWardrobeFacts {
  return {
    slot: "top",
    primaryColor: "black",
    silhouette: "fitted",
    fitProfile: "tailored",
    formality: "business-casual",
    material: null,
    pattern: null,
    ...overrides,
  };
}

// ── 1. No WI bundle → safe unavailable evidence ─────────────────────────────

describe("B4-1: wi === null produces safe unavailable evidence on every dimension", () => {
  it("redundancy, gap, utility all report unavailable", () => {
    const e = computeWardrobeUtilityEvidence({ wi: null, candidate: candidate() });
    assert.equal(e.redundancy.status, "unavailable");
    assert.equal(e.gap.status, "unavailable");
    assert.equal(e.utility.status, "unavailable");
    assert.equal(e.utility.complementCount, 0);
  });
});

// ── 2. Empty Closet → safe unavailable/neutral evidence ─────────────────────

describe("B4-2: empty Closet (wi present, nothing in it) never fabricates a signal", () => {
  it("redundancy no-match, gap no-clear-gap, utility zero", () => {
    const e = computeWardrobeUtilityEvidence({ wi: source({ garments: [], enough: [], couldUseMore: [] }), candidate: candidate() });
    assert.equal(e.redundancy.status, "no-match");
    assert.equal(e.gap.status, "no-clear-gap");
    assert.equal(e.utility.complementCount, 0);
  });
});

// ── 3. One loosely related item does not create a redundancy match ─────────

describe("B4-3: a register match alone (wrong slot) does not count as redundant", () => {
  it("enough finding for the right register but a bottom, candidate is a top → no-match", () => {
    const bottomItem = garment({ id: "g-bottom", slot: "bottom" });
    const e = computeWardrobeUtilityEvidence({
      wi: source({ garments: [bottomItem], enough: [depthFinding({ garmentIds: ["g-bottom"] })] }),
      candidate: candidate({ slot: "top" }),
    });
    assert.equal(e.redundancy.status, "no-match");
  });

  it("enough finding for the right register+slot but a different colour band → no-match", () => {
    const colourfulItem = garment({ id: "g-colour", slot: "top", colourProfile: { hueFamily: "red", wardrobeNeutral: false, lightDark: null, energyTier: null } });
    const e = computeWardrobeUtilityEvidence({
      wi: source({ garments: [colourfulItem], enough: [depthFinding({ garmentIds: ["g-colour"] })] }),
      candidate: candidate({ slot: "top", primaryColor: "black" }), // black resolves wardrobeNeutral: true
    });
    assert.equal(e.redundancy.status, "no-match");
  });
});

// ── 4. Genuinely comparable items produce already-enough ────────────────────

describe("B4-4: register + slot + colour-band all matching produces already-enough", () => {
  it("a real enough finding whose garments match register/slot/band is surfaced verbatim", () => {
    const g = garment({ id: "g-match", slot: "top", formality: "business-casual", colourProfile: { hueFamily: null, wardrobeNeutral: true, lightDark: "dark", energyTier: null } });
    const finding = depthFinding({ id: "enough-work-top-neutral", register: "work", garmentIds: ["g-match"] });
    const e = computeWardrobeUtilityEvidence({
      wi: source({ garments: [g], enough: [finding] }),
      candidate: candidate({ slot: "top", formality: "business-casual", primaryColor: "black" }),
    });
    assert.equal(e.redundancy.status, "already-enough");
    assert.equal(e.redundancy.findingId, "enough-work-top-neutral");
    assert.deepEqual(e.redundancy.garmentIds, ["g-match"]);
  });
});

// ── 5. Candidate category absent from Closet ≠ automatic gap ────────────────

describe("B4-5: candidate's register absent from the Closet does not fabricate a gap", () => {
  it("no couldUseMore entry for the candidate's register → no-clear-gap, not fills-gap", () => {
    const e = computeWardrobeUtilityEvidence({
      wi: source({ couldUseMore: [depthFinding({ kind: "could-use-more", register: "occasion" })] }),
      candidate: candidate({ formality: "business-casual" }), // resolves to "work", not "occasion"
    });
    assert.equal(e.gap.status, "no-clear-gap");
  });
});

// ── 6. A real WI gap signal is surfaced ─────────────────────────────────────

describe("B4-6: a genuine could-use-more/effective-depth finding is surfaced as fills-gap", () => {
  it("kind: could-use-more → fills-gap, preserves kind + provenance", () => {
    const finding = depthFinding({ id: "need-work", kind: "could-use-more", register: "work", garmentIds: [] });
    const e = computeWardrobeUtilityEvidence({ wi: source({ couldUseMore: [finding] }), candidate: candidate({ formality: "business-casual" }) });
    assert.equal(e.gap.status, "fills-gap");
    assert.equal(e.gap.kind, "could-use-more");
    assert.equal(e.gap.findingId, "need-work");
  });

  it("kind: effective-depth → fills-gap, preserves kind", () => {
    const finding = depthFinding({ id: "need-work-effective", kind: "effective-depth", register: "work" });
    const e = computeWardrobeUtilityEvidence({ wi: source({ couldUseMore: [finding] }), candidate: candidate({ formality: "business-casual" }) });
    assert.equal(e.gap.status, "fills-gap");
    assert.equal(e.gap.kind, "effective-depth");
  });

  it("kind: repetition is NOT collapsed into fills-gap — surfaced as background only", () => {
    const finding = depthFinding({ id: "need-work-repetition", kind: "repetition", register: "work" });
    const e = computeWardrobeUtilityEvidence({ wi: source({ couldUseMore: [finding] }), candidate: candidate({ formality: "business-casual" }) });
    assert.equal(e.gap.status, "no-clear-gap");
    assert.equal(e.gap.findingId, null);
    assert.ok(e.gap.backgroundFinding);
    assert.equal(e.gap.backgroundFinding?.kind, "repetition");
    assert.equal(e.gap.backgroundFinding?.id, "need-work-repetition");
  });
});

// ── 7/8. Ownership ≠ liking; relationship tags never bias B4 ────────────────

describe("B4-7: garmentRelationships never influence redundancy/gap/utility", () => {
  it("a favourite-tagged owned item produces the identical result to an untagged one", () => {
    const plain = garment({ id: "g1", garmentRelationships: [] });
    const favourite = garment({ id: "g1", garmentRelationships: ["favourite"] });
    const finding = depthFinding({ garmentIds: ["g1"] });
    const withPlain = computeWardrobeUtilityEvidence({ wi: source({ garments: [plain], enough: [finding] }), candidate: candidate() });
    const withFavourite = computeWardrobeUtilityEvidence({ wi: source({ garments: [favourite], enough: [finding] }), candidate: candidate() });
    assert.deepEqual(withPlain, withFavourite);
  });

  it("complementCount via supportedPair is unaffected by garmentRelationships", () => {
    const partner = garment({ id: "g2", slot: "bottom", formality: "business-casual", fitProfile: "relaxed", silhouette: "straight", colourProfile: { hueFamily: null, wardrobeNeutral: true, lightDark: "dark", energyTier: null } });
    const plainResult = computeWardrobeUtilityEvidence({ wi: source({ garments: [{ ...partner, garmentRelationships: [] }] }), candidate: candidate() });
    const regretResult = computeWardrobeUtilityEvidence({ wi: source({ garments: [{ ...partner, garmentRelationships: ["regret"] }] }), candidate: candidate() });
    assert.equal(plainResult.utility.complementCount, regretResult.utility.complementCount);
  });
});

// ── 9/10. Live re-derivation: deletion and update are reflected immediately ─

describe("B4-8/9: live re-derivation — deleted/updated Closet state changes the next result", () => {
  it("removing the matched item from wi.garments turns already-enough into no-match (deletion)", () => {
    const g = garment({ id: "g-match" });
    const finding = depthFinding({ garmentIds: ["g-match"] });
    const before = computeWardrobeUtilityEvidence({ wi: source({ garments: [g], enough: [finding] }), candidate: candidate() });
    const after = computeWardrobeUtilityEvidence({ wi: source({ garments: [], enough: [finding] }), candidate: candidate() });
    assert.equal(before.redundancy.status, "already-enough");
    assert.equal(after.redundancy.status, "no-match");
  });

  it("changing the owned item's colour band changes the match (update)", () => {
    const neutral = garment({ id: "g-match", colourProfile: { hueFamily: null, wardrobeNeutral: true, lightDark: "dark", energyTier: null } });
    const recoloured = garment({ id: "g-match", colourProfile: { hueFamily: "red", wardrobeNeutral: false, lightDark: null, energyTier: null } });
    const finding = depthFinding({ garmentIds: ["g-match"] });
    const before = computeWardrobeUtilityEvidence({ wi: source({ garments: [neutral], enough: [finding] }), candidate: candidate({ primaryColor: "black" }) });
    const after = computeWardrobeUtilityEvidence({ wi: source({ garments: [recoloured], enough: [finding] }), candidate: candidate({ primaryColor: "black" }) });
    assert.equal(before.redundancy.status, "already-enough");
    assert.equal(after.redundancy.status, "no-match");
  });
});

// ── 10 (cross-customer isolation, unit-level) + explicit template-leakage ──
// regression required by the B4 safeguard review: the candidate's own
// classification must depend ONLY on CandidateWardrobeFacts, never on which
// unrelated items happen to exist in a Closet. Two wi bundles below share the
// same matched finding/garment but differ completely in every OTHER garment
// present (different ids, names, colours, fits) — proving those unrelated
// items cannot leak into the result for the same candidate.

describe("B4-10: result depends only on CandidateWardrobeFacts + the matched finding, never on unrelated Closet contents (no template leakage)", () => {
  it("two wi bundles with different unrelated garments produce identical evidence for the same candidate + matched finding", () => {
    const matched = garment({ id: "g-match" });
    const finding = depthFinding({ garmentIds: ["g-match"] });

    const bundleA: WardrobeUtilitySource = source({
      garments: [matched, garment({ id: "unrelated-a1", name: "Red dress", slot: "dress", primaryColor: "red", silhouette: "a-line", fitProfile: "relaxed", formality: "occasion" })],
      enough: [finding],
    });
    const bundleB: WardrobeUtilitySource = source({
      garments: [matched, garment({ id: "unrelated-b1", name: "Blue jacket", slot: "outerwear", primaryColor: "blue", silhouette: "straight", fitProfile: "structured", formality: "business-formal" }), garment({ id: "unrelated-b2", name: "Green skirt", slot: "bottom", primaryColor: "green" })],
      enough: [finding],
    });

    const resultA = computeWardrobeUtilityEvidence({ wi: bundleA, candidate: candidate() });
    const resultB = computeWardrobeUtilityEvidence({ wi: bundleB, candidate: candidate() });
    assert.equal(resultA.redundancy.status, resultB.redundancy.status);
    assert.equal(resultA.redundancy.findingId, resultB.redundancy.findingId);
    assert.deepEqual(resultA.redundancy.garmentIds, resultB.redundancy.garmentIds);
  });

  it("identical CandidateWardrobeFacts always produce an identical synthetic classification regardless of Closet size", () => {
    const c = candidate();
    const small = computeWardrobeUtilityEvidence({ wi: source({ garments: [] }), candidate: c });
    const large = computeWardrobeUtilityEvidence({
      wi: source({ garments: Array.from({ length: 12 }, (_, i) => garment({ id: `extra-${i}`, name: `Extra ${i}`, primaryColor: i % 2 === 0 ? "red" : "blue" })) }),
      candidate: c,
    });
    // Neither Closet contains a finding referencing the candidate, so both must
    // read identically on the dimensions unaffected by Closet size.
    assert.equal(small.redundancy.status, large.redundancy.status);
    assert.equal(small.gap.status, large.gap.status);
  });
});

// ── 11. B3 outcomeHistory is a separate field, untouched by B4 ─────────────
// (Full outcomeHistory behaviour is covered by outcome-history-evidence.test.ts;
// this only proves B4's module has zero coupling to it.)

describe("B4-11: this module has no coupling to B3's outcome-history evidence", () => {
  it("does not import outcome-history-evidence.server", () => {
    assert.ok(!MODULE_SOURCE.includes("outcome-history-evidence"));
  });
});

// ── 12/13/14. Architectural boundaries — static self-check ─────────────────
// Modeled on outcome-history-evidence.test.ts's B3-14/15/16 and
// taste-evidence-consumer-boundary.test.ts: precise import-statement regex
// matching, not loose substring matching (a prior B3 draft false-positived on
// its own explanatory prose before being tightened to this pattern).

const IMPORT_STATEMENT = /(?:from\s+["']([^"']+)["']|require\(\s*["']([^"']+)["']\s*\))/g;

function importedModules(source: string): string[] {
  const modules: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = IMPORT_STATEMENT.exec(source)) !== null) {
    modules.push(match[1] ?? match[2]);
  }
  return modules;
}

describe("B4-12: never imports TasteEvidence/StyleTendency or any taste-engine module", () => {
  it("no import path references taste-extraction, taste-reconcile, taste-contract, or TasteEvidence/StyleTendency models", () => {
    const modules = importedModules(MODULE_SOURCE);
    for (const m of modules) {
      assert.ok(!/taste-(extraction|reconcile|contract|backfill)/.test(m), `unexpected taste-engine import: ${m}`);
    }
    assert.ok(!MODULE_SOURCE.includes("TasteEvidence"));
    assert.ok(!MODULE_SOURCE.includes("StyleTendency"));
  });
});

describe("B4-13: never writes to Passport", () => {
  it("imports no Prisma client and calls no onboardingProfile/passport update", () => {
    const modules = importedModules(MODULE_SOURCE);
    assert.ok(!modules.some((m) => m.includes("db.server")), "must not import the Prisma client");
    assert.ok(!MODULE_SOURCE.includes("onboardingProfile.update"));
    assert.ok(!MODULE_SOURCE.includes("prisma."));
  });
});

describe("B4-14: never writes wardrobe intelligence into ResolvedGarment", () => {
  it("imports no resolved-garment module", () => {
    // Precise import-statement matching only — the module's own header prose
    // explains the architecture boundary in these exact words, which a loose
    // substring check over the whole file would false-positive on.
    const modules = importedModules(MODULE_SOURCE);
    assert.ok(!modules.some((m) => m.includes("resolved-garment")), "must not import the ResolvedGarment module");
  });
});

// ── 19. Determinism ──────────────────────────────────────────────────────────

describe("B4-19: fully deterministic — identical inputs produce identical output", () => {
  it("two calls with structurally identical arguments produce deepEqual results", () => {
    const g = garment({ id: "g-match" });
    const finding = depthFinding({ garmentIds: ["g-match"] });
    const wi = source({ garments: [g], enough: [finding] });
    const r1 = computeWardrobeUtilityEvidence({ wi, candidate: candidate() });
    const r2 = computeWardrobeUtilityEvidence({ wi, candidate: candidate() });
    assert.deepEqual(r1, r2);
  });
});

// ── 20. No AI/model call ────────────────────────────────────────────────────

describe("B4-20: no AI/model call is introduced", () => {
  it("source contains no fetch/anthropic/openai reference", () => {
    assert.ok(!/fetch\(|anthropic|openai/i.test(MODULE_SOURCE));
  });
});

// ── Colour-band derivation uses the canonical GI function, not a reproduction ─

describe("B4: colour-band derivation reuses the canonical deriveColourProfile, never a recreated approximation", () => {
  it("imports deriveColourProfile/deriveVisualWeight from garment-intelligence-v1.server, defines no local banding map", () => {
    assert.ok(MODULE_SOURCE.includes('from "~/lib/admin/garment-intelligence-v1.server"'));
    assert.ok(!/NEUTRAL_COLORS|COLOUR_FAMILY_MAP/.test(MODULE_SOURCE), "must not redefine WI's private colour-banding tables locally");
  });

  it("a candidate with no resolvable colour reports redundancy unavailable, not a guessed band", () => {
    const finding = depthFinding({ garmentIds: ["g1"] });
    const e = computeWardrobeUtilityEvidence({ wi: source({ enough: [finding] }), candidate: candidate({ primaryColor: null }) });
    assert.equal(e.redundancy.status, "unavailable");
  });
});

// ── Utility: raw evidence only, no invented classification ──────────────────

describe("B4: utility evidence is raw count + provenance only — no additive/neutral/limited classification", () => {
  it("UtilityEvidence has no level/classification field beyond status/count/ids", () => {
    const e = computeWardrobeUtilityEvidence({ wi: source({ garments: [] }), candidate: candidate() });
    assert.deepEqual(Object.keys(e.utility).sort(), ["complementCount", "complementItemIds", "status"]);
  });

  it("supportedPair-based complement count is surfaced with real provenance ids", () => {
    const partner = garment({ id: "g-partner", slot: "bottom", formality: "business-casual", fitProfile: "relaxed", silhouette: "straight", colourProfile: { hueFamily: null, wardrobeNeutral: true, lightDark: "dark", energyTier: null } });
    const e = computeWardrobeUtilityEvidence({ wi: source({ garments: [partner] }), candidate: candidate() });
    assert.equal(e.utility.complementCount, 1);
    assert.deepEqual(e.utility.complementItemIds, ["g-partner"]);
  });
});
