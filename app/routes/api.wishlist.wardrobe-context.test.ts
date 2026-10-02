// app/routes/api.wishlist.wardrobe-context.test.ts
// Phase 3 — Shared Customer Intelligence, first consumer: causal tests for
// the Buy-or-Skip wardrobe-context gate in api.wishlist.jsx.
//
// These exercise the real exported pure helpers (no DB, no Cloudinary, no
// Claude call) — the deterministic matching rule, the prompt block, and the
// Passport projection — rather than re-deriving the rule via string checks
// against the route source.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  WARDROBE_CONTEXT_ELIGIBLE_CATEGORIES,
  toWardrobePassport,
  resolveWardrobeContext,
  buildWardrobeContextBlock,
} from "./api.wishlist.jsx";
import type { DepthFinding, RegisterId, RegisterReading } from "~/lib/ai/wardrobe-needs";
import type { WardrobeRecommendation } from "~/lib/ai/wardrobe-recommendations";

function depthFinding(partial: Partial<DepthFinding> & { register: RegisterId }): DepthFinding {
  return {
    id: `need-${partial.register}`,
    kind: "could-use-more",
    title: "x", body: "x", garmentIds: [], evidence: [], strength: "moderate",
    ...partial,
  };
}

function registerReading(partial: Partial<RegisterReading> & { register: RegisterId }): RegisterReading {
  return {
    label: partial.register, depthLabel: "Limited usable depth", depthNote: "x",
    rawCount: 10, usableCount: 10, blockedCount: 0, blockedPieces: [], unknownCount: 0,
    distinctLooks: 2, combinations: 4, needed: true, needSource: "lifestyle", needPhrase: "x",
    ...partial,
  };
}

// Minimal WardrobeRecommendation fixture — only register/slot are read by
// resolveWardrobeContext; everything else is present only so the shape
// resembles the real type.
function recommendation({ register, slot }: { register: RegisterId; slot: string | null }): WardrobeRecommendation {
  return {
    id: `rec-${register}-${slot}`,
    register,
    specificity: "slot",
    title: "x", attributes: [], body: "x", unlocksIds: [],
    criteria: { register, slot, colourFamilies: [], structure: null, resolvingSilhouettes: [], coverage: [] },
    evidence: [], strength: "moderate",
  } as WardrobeRecommendation;
}

describe("§BOS-WC-1 same register + matching slot → context", () => {
  it("a thin register with exactly one recommended slot, matching the submitted category, produces a ResolvedFinding", () => {
    const finding = resolveWardrobeContext(
      "Bottom",
      [depthFinding({ register: "work" })],
      [registerReading({ register: "work" })],
      [recommendation({ register: "work", slot: "bottom" })],
    );
    assert.ok(finding, "expected a wardrobe context finding");
    assert.equal(finding.value, "work");
    assert.equal(finding.signalClass, "observed-state");
  });

  it("the prompt block names the register and carries the guard wording", () => {
    const finding = resolveWardrobeContext(
      "Dress",
      [depthFinding({ register: "occasion" })],
      [registerReading({ register: "occasion" })],
      [recommendation({ register: "occasion", slot: "dress" })],
    );
    const block = buildWardrobeContextBlock(finding);
    assert.match(block, /WARDROBE CONTEXT/);
    assert.match(block, /occasion and evening/);
    assert.match(block, /Do NOT let this alone justify a BUY/);
    assert.match(block, /do NOT let it soften a SKIP/);
  });
});

describe("§BOS-WC-2 same register + wrong slot → no context", () => {
  it("a thin register with exactly one recommended slot, NOT matching the submitted category, produces no context", () => {
    const finding = resolveWardrobeContext(
      "Top",
      [depthFinding({ register: "work" })],
      [registerReading({ register: "work" })],
      [recommendation({ register: "work", slot: "bottom" })],
    );
    assert.equal(finding, null);
  });

  it("the diagnostic-customer shape: work/bottom recommended → Top, Dress, Outerwear all get nothing, only Bottom matches", () => {
    const couldUseMore = [depthFinding({ register: "work" })];
    const registers = [registerReading({ register: "work" })];
    const recommendations = [recommendation({ register: "work", slot: "bottom" })];
    assert.ok(resolveWardrobeContext("Bottom", couldUseMore, registers, recommendations));
    assert.equal(resolveWardrobeContext("Top", couldUseMore, registers, recommendations), null);
    assert.equal(resolveWardrobeContext("Dress", couldUseMore, registers, recommendations), null);
    assert.equal(resolveWardrobeContext("Outerwear", couldUseMore, registers, recommendations), null);
  });
});

describe("§BOS-WC-3 thin register exists but no matching structured criteria → no context", () => {
  it("no recommendations at all for the thin register produces no context", () => {
    const finding = resolveWardrobeContext(
      "Bottom",
      [depthFinding({ register: "work" })],
      [registerReading({ register: "work" })],
      [],
    );
    assert.equal(finding, null);
  });

  it("recommendations exist, but none reference this register, produces no context", () => {
    const finding = resolveWardrobeContext(
      "Bottom",
      [depthFinding({ register: "work" })],
      [registerReading({ register: "work" })],
      [recommendation({ register: "everyday", slot: "bottom" })],
    );
    assert.equal(finding, null);
  });

  it("recommendations for this register exist but every one has a null slot produces no context", () => {
    const finding = resolveWardrobeContext(
      "Bottom",
      [depthFinding({ register: "work" })],
      [registerReading({ register: "work" })],
      [recommendation({ register: "work", slot: null })],
    );
    assert.equal(finding, null);
  });
});

describe("§BOS-WC-4 ambiguous criteria → no context", () => {
  it("WI's own recommendations name two different slots for the same register — neither is treated as THE gap", () => {
    const couldUseMore = [depthFinding({ register: "work" })];
    const registers = [registerReading({ register: "work" })];
    const recommendations = [
      recommendation({ register: "work", slot: "top" }),
      recommendation({ register: "work", slot: "bottom" }),
    ];
    // Even though "Bottom" is one of the two named slots, the register itself
    // is ambiguous — WI has not settled on a single slot — so neither matches.
    assert.equal(resolveWardrobeContext("Bottom", couldUseMore, registers, recommendations), null);
    assert.equal(resolveWardrobeContext("Top", couldUseMore, registers, recommendations), null);
  });

  it("two different thin registers both cleanly point at the same submitted slot — cross-register ambiguity", () => {
    const couldUseMore = [depthFinding({ register: "work" }), depthFinding({ register: "occasion" })];
    const registers = [registerReading({ register: "work" }), registerReading({ register: "occasion" })];
    const recommendations = [
      recommendation({ register: "work", slot: "bottom" }),
      recommendation({ register: "occasion", slot: "bottom" }),
    ];
    assert.equal(resolveWardrobeContext("Bottom", couldUseMore, registers, recommendations), null);
  });
});

describe("§BOS-WC-5 unsupported categories → no context", () => {
  for (const category of ["Shoes", "Bag", "Accessory", "Jewelry"]) {
    it(`category "${category}" is excluded even with a clean matching recommendation`, () => {
      assert.equal(WARDROBE_CONTEXT_ELIGIBLE_CATEGORIES.has(category), false);
      const finding = resolveWardrobeContext(
        category,
        [depthFinding({ register: "work" })],
        [registerReading({ register: "work" })],
        [recommendation({ register: "work", slot: "bottom" })],
      );
      assert.equal(finding, null);
    });
  }
});

describe("§BOS-WC-6 no-context equals pre-Phase-3 behavior", () => {
  it("buildWardrobeContextBlock(null) is the empty string — no stray formatting introduced", () => {
    assert.equal(buildWardrobeContextBlock(null), "");
  });

  it("zero could-use-more findings produces no context end-to-end", () => {
    const finding = resolveWardrobeContext("Bottom", [], [registerReading({ register: "work" })], []);
    assert.equal(buildWardrobeContextBlock(finding), "");
  });
});

describe("§BOS-WC-7 the guard is a prompt instruction, not a proven model constraint", () => {
  // These tests prove the WORDING is present and that the deterministic code
  // never sets or infers a verdict itself. They do not and cannot prove what
  // an LLM will do with that instruction — Buy or Skip has no post-AI
  // hard-constraint validator for ANY of its existing rules (dressing
  // requirements, avoided colours, etc. are all enforced the same
  // prompt-based way), so this fix does not introduce a weaker guarantee
  // than what already exists, and does not claim a stronger one.
  it("every non-empty block instructs the model that the gap is non-decisive, regardless of which register matched", () => {
    const registers: RegisterId[] = ["everyday", "work", "occasion"];
    for (const register of registers) {
      const finding = resolveWardrobeContext(
        "Outerwear",
        [depthFinding({ register })],
        [registerReading({ register })],
        [recommendation({ register, slot: "outerwear" })],
      );
      const block = buildWardrobeContextBlock(finding);
      assert.match(block, /Treat this as context only/);
      assert.match(block, /hard dressing requirements, fit\/comfort problems, or quality\/value concerns/);
    }
  });

  it("resolveWardrobeContext returns a finding object or null — it never returns or implies a verdict", () => {
    const finding = resolveWardrobeContext(
      "Bottom",
      [depthFinding({ register: "work" })],
      [registerReading({ register: "work" })],
      [recommendation({ register: "work", slot: "bottom" })],
    );
    assert.ok(finding, "expected a wardrobe context finding");
    assert.equal(("verdict" in finding), false);
  });
});

describe("§BOS-WC-8 Passport projection degrades honestly, never throws", () => {
  it("a missing profile produces null", () => {
    assert.equal(toWardrobePassport(null), null);
    assert.equal(toWardrobePassport(undefined), null);
  });

  it("a partial profile fills array fields with [] and scalar fields with null, not undefined", () => {
    const passport = toWardrobePassport({ lifestyle: ["work-office"] }) as any;
    assert.deepEqual(passport.lifestyle, ["work-office"]);
    assert.deepEqual(passport.favoriteColors, []);
    assert.equal(passport.structure, null);
    assert.equal(passport.preferredCoverage, null);
    assert.equal(("structure" in passport), true);
  });
});
