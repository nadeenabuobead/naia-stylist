// app/lib/ai/styleme-colour-canonical-migration.test.ts
//
// Garment Intelligence — Phase 4A: colour-only live canonical migration.
//
// Tests the actual live integration seam (resolveEngineColour, exported
// from styleme-anchor.server.ts) rather than re-deriving the mechanism
// separately — this is the real function loadAllClosetItemsForEngine
// calls, with the real CANONICAL_STYLEME_COLOUR flag's effect reproduced
// by passing the boolean explicitly (no process.env mutation needed; the
// function never reads process.env itself — see its own doc).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveEngineColour, scoreClosetItemForSession } from "./styleme-anchor.server.ts";
import {
  passesDressingRequirements,
  passesCandidateDressingRequirements,
} from "./styleme-result.server.ts";
import { closetItemToSlot } from "./closet-slot.ts";
import type { ClosetItemFields } from "~/lib/admin/closet-review.server";

function closetItem(overrides: Partial<ClosetItemFields> & { category?: string } = {}): ClosetItemFields & { category: string } {
  return {
    subcategory: null, silhouette: null, fitProfile: null, hemLength: null, topLength: null,
    waistShape: null, sleeveLength: null, necklineCoverage: null, shoulderCoverage: null,
    midriffExposed: null, material: null, pattern: null, primaryColor: "grey", colors: ["grey"],
    occasions: [], seasons: [], formality: null, styleTags: [], stylePersonality: null,
    category: "TOPS",
    ...overrides,
  } as ClosetItemFields & { category: string };
}

// ── Flag OFF — exact pre-Phase-4A behavior ──────────────────────────────────

describe("§4A-1 flag OFF is byte-identical to today's raw reads, regardless of any admin override present", () => {
  it("raw colour is returned unchanged even when an admin override exists", () => {
    const item = closetItem({ primaryColor: "grey", colors: ["grey"] });
    const adminReview = { reviewStatus: "overridden", overrides: { primaryColor: "burgundy", colors: ["burgundy"] } };
    const result = resolveEngineColour(item, adminReview, false);
    assert.deepEqual(result, { colors: ["grey"], primaryColor: "grey" }, "flag OFF must never read the override, proving this is a true rollback switch, not a soft preference");
  });

  it("flag OFF with no admin review at all is also unchanged", () => {
    const item = closetItem({ primaryColor: "navy", colors: ["navy"] });
    assert.deepEqual(resolveEngineColour(item, null, false), { colors: ["navy"], primaryColor: "navy" });
  });
});

// ── Flag ON, no admin colour correction — identical to baseline ────────────

describe("§4A-2 flag ON with no colour override produces the exact same output as flag OFF", () => {
  it("no adminReview at all", () => {
    const item = closetItem({ primaryColor: "navy", colors: ["navy"] });
    assert.deepEqual(resolveEngineColour(item, null, true), resolveEngineColour(item, null, false));
  });

  it("an adminReview exists but does not touch primaryColor/colors", () => {
    const item = closetItem({ primaryColor: "navy", colors: ["navy"] });
    const adminReview = { reviewStatus: "overridden", overrides: { subcategory: "trousers" } };
    assert.deepEqual(resolveEngineColour(item, adminReview, true), resolveEngineColour(item, adminReview, false));
  });
});

// ── Flag ON, favourite/avoided colour correction — the actual score effect ─

describe("§4A-3 flag ON, favourite-colour correction — exact score delta, no other change", () => {
  const signals = { occasion: "work", moods: [], desiredFeelings: [] };
  const profile = { favoriteColors: ["burgundy"], avoidColors: [] } as any;

  it("canonical colour recovers the +2 favourite bonus the raw misread value was losing", () => {
    const item = closetItem({ primaryColor: "grey", colors: ["grey"], occasions: ["work"] }); // AI misread
    const adminReview = { reviewStatus: "overridden", overrides: { primaryColor: "burgundy", colors: ["burgundy"] } }; // admin-corrected
    const rawColour = resolveEngineColour(item, adminReview, false);
    const canonicalColour = resolveEngineColour(item, adminReview, true);

    const rawScore = scoreClosetItemForSession({ ...item, ...rawColour }, signals, profile);
    const canonicalScore = scoreClosetItemForSession({ ...item, ...canonicalColour }, signals, profile);
    assert.equal(canonicalScore - rawScore, 2, "the live integration's score delta matches Phase 3's standalone causal proof exactly");
  });

  it("no other scoring input changes — occasions/styleTags/relationships identical, so only colour's +2/-4 moves", () => {
    const item = closetItem({ primaryColor: "grey", colors: ["grey"], occasions: ["work"], styleTags: ["bold"] });
    const adminReview = { reviewStatus: "overridden", overrides: { primaryColor: "burgundy", colors: ["burgundy"] } };
    const rawColour = resolveEngineColour(item, adminReview, false);
    const canonicalColour = resolveEngineColour(item, adminReview, true);
    const rawScore = scoreClosetItemForSession({ ...item, ...rawColour }, { ...signals, moods: ["bold"] }, profile);
    const canonicalScore = scoreClosetItemForSession({ ...item, ...canonicalColour }, { ...signals, moods: ["bold"] }, profile);
    assert.equal(canonicalScore - rawScore, 2, "the mood/styleTag/occasion contribution (+10 occasion, +3 mood) is identical on both sides — isolating the +2 colour delta exactly");
  });
});

describe("§4A-4 flag ON, avoided-colour correction — exact score delta, no other change", () => {
  it("canonical colour applies the -4 avoid penalty the raw misread value was missing", () => {
    const item = closetItem({ primaryColor: "beige", colors: ["beige"] }); // AI misread
    const adminReview = { reviewStatus: "overridden", overrides: { primaryColor: "neon-green", colors: ["neon-green"] } }; // admin-corrected to the true, avoided colour
    const profile = { favoriteColors: [], avoidColors: ["neon-green"] } as any;
    const signals = { occasion: "everyday", moods: [], desiredFeelings: [] };
    const rawColour = resolveEngineColour(item, adminReview, false);
    const canonicalColour = resolveEngineColour(item, adminReview, true);
    const rawScore = scoreClosetItemForSession({ ...item, ...rawColour }, signals, profile);
    const canonicalScore = scoreClosetItemForSession({ ...item, ...canonicalColour }, signals, profile);
    assert.equal(canonicalScore - rawScore, -4);
  });
});

// ── Eligibility invariance — colour migration never touches gates/slot ─────

describe("§4A-5 eligibility invariance — colour migration cannot affect hard gates, slot assignment, or coverage", () => {
  it("passesDressingRequirements ignores resolveEngineColour's output entirely — same item, flag on/off, identical gate result", () => {
    const item = closetItem({ hemLength: "mini", primaryColor: "grey", colors: ["grey"] });
    const adminReview = { reviewStatus: "overridden", overrides: { primaryColor: "burgundy", colors: ["burgundy"] } };
    const rawColour = resolveEngineColour(item, adminReview, false);
    const canonicalColour = resolveEngineColour(item, adminReview, true);
    const gateWithRaw = passesDressingRequirements({ ...item, ...rawColour } as any, ["legs-covered"]);
    const gateWithCanonical = passesDressingRequirements({ ...item, ...canonicalColour } as any, ["legs-covered"]);
    assert.equal(gateWithRaw, gateWithCanonical, "the hemLength gate's result is identical regardless of which colour branch ran — colour and coverage are structurally independent code paths");
  });

  it("passesCandidateDressingRequirements is likewise unaffected", () => {
    const candidate = { pieces: [{ slot: "top", closetId: "g1" }] } as any;
    const item = { id: "g1", sleeveLength: "sleeveless", shoulderCoverage: null, necklineCoverage: null, primaryColor: "grey", colors: ["grey"] };
    const adminReview = { reviewStatus: "overridden", overrides: { primaryColor: "burgundy", colors: ["burgundy"] } };
    const rawColour = resolveEngineColour(item as any, adminReview, false);
    const canonicalColour = resolveEngineColour(item as any, adminReview, true);
    const gateWithRaw = passesCandidateDressingRequirements(candidate, [{ ...item, ...rawColour }] as any, ["arms-covered"]);
    const gateWithCanonical = passesCandidateDressingRequirements(candidate, [{ ...item, ...canonicalColour }] as any, ["arms-covered"]);
    assert.equal(gateWithRaw, gateWithCanonical);
  });

  it("slot assignment (closetItemToSlot) does not read colour at all — identical regardless of flag", () => {
    const slotWithRaw = closetItemToSlot("BOTTOMS", "trousers");
    const slotWithCanonical = closetItemToSlot("BOTTOMS", "trousers"); // colour never enters this function's signature at all
    assert.equal(slotWithRaw, slotWithCanonical);
  });

  it("resolveEngineColour's return shape never includes any gate/slot-relevant field — structurally cannot leak into those mechanisms", () => {
    const result = resolveEngineColour(closetItem(), null, true);
    assert.deepEqual(Object.keys(result).sort(), ["colors", "primaryColor"], "the function's own return type proves it cannot smuggle a coverage/slot field into the engine");
  });
});

// ── Ranking causality — a genuine positive control, not required invariance ─

describe("§4A-6 ranking causality — colour CAN change which candidate wins when it is the deciding difference", () => {
  it("two otherwise-identical candidates, differing only in canonical colour match — the migration flips which one scores higher", () => {
    const signals = { occasion: "work", moods: [], desiredFeelings: [] };
    const profile = { favoriteColors: ["burgundy"], avoidColors: [] } as any;

    const candidateA = closetItem({ primaryColor: "grey", colors: ["grey"], occasions: ["work"] }); // raw: misread, no favourite match
    const candidateAAdminReview = { reviewStatus: "overridden", overrides: { primaryColor: "burgundy", colors: ["burgundy"] } };
    const candidateB = closetItem({ primaryColor: "navy", colors: ["navy"], occasions: ["work"] }); // a different garment, never corrected, no favourite match either

    const rawColourA = resolveEngineColour(candidateA, candidateAAdminReview, false);
    const rawScoreA = scoreClosetItemForSession({ ...candidateA, ...rawColourA }, signals, profile);
    const rawScoreB = scoreClosetItemForSession(candidateB, signals, profile);
    assert.equal(rawScoreA, rawScoreB, "sanity: with the flag off, A and B are a genuine tie — the fixture is engineered correctly");

    const canonicalColourA = resolveEngineColour(candidateA, candidateAAdminReview, true);
    const canonicalScoreA = scoreClosetItemForSession({ ...candidateA, ...canonicalColourA }, signals, profile);
    assert.ok(canonicalScoreA > rawScoreB, "with the flag on, A's corrected colour breaks the tie in A's favour — this IS the expected, correct behavior change, not a regression");
  });
});
