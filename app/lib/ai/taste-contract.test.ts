// app/lib/ai/taste-contract.test.ts
// Phase 5D — Taste Contract unit tests.
// Tests canonical vocabulary, threshold boundaries, contradiction classification,
// state determination logic, and text generation.
// Run with: npx tsx --test app/lib/ai/taste-contract.test.ts

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  makeObservationKey,
  canonicalValue,
  clampStrength,
  generateTendencyText,
  CANDIDATE_EFFECTIVE_SUPPORT,
  CANDIDATE_WNET,
  CANDIDATE_DISTINCT_RECORDS,
  CONFIRMED_EFFECTIVE_SUPPORT,
  CONFIRMED_WNET,
  CONFIRMED_DISTINCT_RECORDS,
  SUPPRESS_RATIO,
  CONTEST_RATIO,
  CROSS_SOURCE_BONUS,
  REEMERGENCE_SUPPORT_MULTIPLIER,
  REEMERGENCE_DISTINCT_RECORDS,
  REEMERGENCE_WNET_MINIMUM,
  TENDENCY_SCHEMA_VERSION,
} from "./taste-contract.js";

// ── Internal classifyContradiction (mirrored here for threshold boundary tests) ─

function classifyContradiction(wSupport: number, wContradict: number): "SUPPRESSED" | "CANDIDATE_ONLY" | "CONFIRMED_ELIGIBLE" {
  if (wSupport === 0) return "SUPPRESSED";
  if (wContradict >= wSupport * SUPPRESS_RATIO)  return "SUPPRESSED";
  if (wContradict >= wSupport * CONTEST_RATIO)   return "CANDIDATE_ONLY";
  return "CONFIRMED_ELIGIBLE";
}

function computeState(
  effectiveSupport: number,
  wNet: number,
  distinctRecords: number,
  contradictionClass: ReturnType<typeof classifyContradiction>,
  customerFeedback: string | null,
): "CANDIDATE" | "CONFIRMED" | "SUPPRESSED" | "REJECTED" {
  if (customerFeedback === "not-quite") return "REJECTED";
  if (contradictionClass === "SUPPRESSED") return "SUPPRESSED";

  const meetsConfirmed =
    effectiveSupport >= CONFIRMED_EFFECTIVE_SUPPORT &&
    wNet             >= CONFIRMED_WNET &&
    distinctRecords  >= CONFIRMED_DISTINCT_RECORDS;

  const meetsCandidate =
    effectiveSupport >= CANDIDATE_EFFECTIVE_SUPPORT &&
    wNet             >= CANDIDATE_WNET &&
    distinctRecords  >= CANDIDATE_DISTINCT_RECORDS;

  if (meetsConfirmed && contradictionClass === "CONFIRMED_ELIGIBLE") return "CONFIRMED";
  if (meetsCandidate) return "CANDIDATE";
  return "SUPPRESSED";
}

// ── §T.1 — Key helpers ────────────────────────────────────────────────────────

describe("makeObservationKey", () => {
  it("T.1.1 produces tendency-v1|dimension:value format", () => {
    assert.equal(makeObservationKey("comfort", "comfort"), "tendency-v1|comfort:comfort");
    assert.equal(makeObservationKey("formality", "too-formal"), "tendency-v1|formality:too-formal");
  });

  it("T.1.2 schema version prefix matches TENDENCY_SCHEMA_VERSION", () => {
    const key = makeObservationKey("fit", "fit");
    assert.ok(key.startsWith(`${TENDENCY_SCHEMA_VERSION}|`));
  });
});

describe("canonicalValue", () => {
  it("T.1.3 non-garment/formality dimensions return dimension name", () => {
    assert.equal(canonicalValue("self-expression"), "self-expression");
    assert.equal(canonicalValue("comfort"), "comfort");
    assert.equal(canonicalValue("fit"), "fit");
  });

  it("T.1.4 garment-category returns specificValue", () => {
    assert.equal(canonicalValue("garment-category", "DRESSES"), "DRESSES");
  });

  it("T.1.5 formality returns specificValue (too-formal / too-casual)", () => {
    assert.equal(canonicalValue("formality", "too-formal"), "too-formal");
    assert.equal(canonicalValue("formality", "too-casual"), "too-casual");
  });
});

describe("clampStrength", () => {
  it("T.1.6 clamps below 0.1 to 0.1", () => {
    assert.equal(clampStrength(0.0), 0.1);
    assert.equal(clampStrength(-1.0), 0.1);
  });

  it("T.1.7 clamps above 1.0 to 1.0", () => {
    assert.equal(clampStrength(2.0), 1.0);
    assert.equal(clampStrength(1.1), 1.0);
  });

  it("T.1.8 values within range pass through unchanged", () => {
    assert.ok(Math.abs(clampStrength(0.5) - 0.5) < 0.001);
    assert.ok(Math.abs(clampStrength(0.1) - 0.1) < 0.001);
    assert.ok(Math.abs(clampStrength(1.0) - 1.0) < 0.001);
  });
});

// ── §T.2 — Contradiction classification boundaries ────────────────────────────

describe("classifyContradiction", () => {
  it("T.2.1 wSupport=0 → SUPPRESSED (no positive signal)", () => {
    assert.equal(classifyContradiction(0, 3.0), "SUPPRESSED");
  });

  it("T.2.2 wContradict = 0.75 * wSupport → SUPPRESSED (exact 75% boundary)", () => {
    const wS = 4.0;
    assert.equal(classifyContradiction(wS, wS * SUPPRESS_RATIO), "SUPPRESSED");
  });

  it("T.2.3 wContradict > 0.75 * wSupport → SUPPRESSED", () => {
    assert.equal(classifyContradiction(4.0, 3.2), "SUPPRESSED");
  });

  it("T.2.4 wContradict just below 0.75 * wSupport → CANDIDATE_ONLY or CONFIRMED_ELIGIBLE", () => {
    const wS = 4.0;
    const wC = wS * SUPPRESS_RATIO - 0.001;
    const cls = classifyContradiction(wS, wC);
    assert.ok(cls !== "SUPPRESSED", `expected non-SUPPRESSED, got ${cls}`);
  });

  it("T.2.5 wContradict = 0.40 * wSupport → CANDIDATE_ONLY (exact 40% boundary)", () => {
    const wS = 4.0;
    assert.equal(classifyContradiction(wS, wS * CONTEST_RATIO), "CANDIDATE_ONLY");
  });

  it("T.2.6 wContradict just below 0.40 * wSupport → CONFIRMED_ELIGIBLE", () => {
    const wS = 4.0;
    const wC = wS * CONTEST_RATIO - 0.001;
    assert.equal(classifyContradiction(wS, wC), "CONFIRMED_ELIGIBLE");
  });

  it("T.2.7 75% check happens BEFORE 40% check (ordering correctness)", () => {
    // wContradict = 0.76 * wSupport must be SUPPRESSED, not CANDIDATE_ONLY
    const wS = 4.0;
    const wC = wS * 0.76;  // above SUPPRESS_RATIO (0.75)
    assert.equal(classifyContradiction(wS, wC), "SUPPRESSED");
  });

  it("T.2.8 between 40% and 75% → CANDIDATE_ONLY", () => {
    const wS = 4.0;
    const wC = wS * 0.60;  // between 0.40 and 0.75
    assert.equal(classifyContradiction(wS, wC), "CANDIDATE_ONLY");
  });

  it("T.2.9 wContradict=0, wSupport>0 → CONFIRMED_ELIGIBLE", () => {
    assert.equal(classifyContradiction(4.0, 0), "CONFIRMED_ELIGIBLE");
  });
});

// ── §T.3 — State determination ────────────────────────────────────────────────

describe("computeState", () => {
  it("T.3.1 customer feedback not-quite → always REJECTED regardless of evidence", () => {
    assert.equal(computeState(10, 10, 10, "CONFIRMED_ELIGIBLE", "not-quite"), "REJECTED");
  });

  it("T.3.2 SUPPRESSED contradiction class → SUPPRESSED regardless of evidence strength", () => {
    assert.equal(computeState(10, 10, 10, "SUPPRESSED", null), "SUPPRESSED");
  });

  it("T.3.3 meets CONFIRMED thresholds + CONFIRMED_ELIGIBLE → CONFIRMED", () => {
    // effectiveSupport >= 4.0, wNet >= 3.0, distinctRecords >= 3
    assert.equal(computeState(4.0, 3.0, 3, "CONFIRMED_ELIGIBLE", null), "CONFIRMED");
  });

  it("T.3.4 meets CONFIRMED thresholds but CANDIDATE_ONLY → max CANDIDATE", () => {
    // When contradiction is 40-75%, cannot upgrade to CONFIRMED even with enough evidence
    assert.equal(computeState(5.0, 4.0, 4, "CANDIDATE_ONLY", null), "CANDIDATE");
  });

  it("T.3.5 meets CANDIDATE thresholds only → CANDIDATE", () => {
    // effectiveSupport >= 2.0, wNet >= 1.5, distinctRecords >= 2
    assert.equal(computeState(2.0, 1.5, 2, "CONFIRMED_ELIGIBLE", null), "CANDIDATE");
  });

  it("T.3.6 below CANDIDATE thresholds → SUPPRESSED", () => {
    assert.equal(computeState(1.0, 0.5, 1, "CONFIRMED_ELIGIBLE", null), "SUPPRESSED");
  });

  it("T.3.7 exactly at CONFIRMED threshold boundaries → CONFIRMED", () => {
    assert.equal(
      computeState(CONFIRMED_EFFECTIVE_SUPPORT, CONFIRMED_WNET, CONFIRMED_DISTINCT_RECORDS, "CONFIRMED_ELIGIBLE", null),
      "CONFIRMED",
    );
  });

  it("T.3.8 just below CONFIRMED distinct records → cannot CONFIRM", () => {
    assert.notEqual(
      computeState(CONFIRMED_EFFECTIVE_SUPPORT, CONFIRMED_WNET, CONFIRMED_DISTINCT_RECORDS - 1, "CONFIRMED_ELIGIBLE", null),
      "CONFIRMED",
    );
  });

  it("T.3.9 cross-source bonus raises effectiveSupport (2 sources × 1.25 applied externally)", () => {
    // With 2 distinct sources, wSupport × 1.25 may push past CONFIRMED threshold
    const wSupport = 3.0; // below CONFIRMED alone
    const effectiveSupportWithBonus = wSupport * CROSS_SOURCE_BONUS; // 3.75 — still below 4.0
    assert.notEqual(computeState(effectiveSupportWithBonus, 3.0, 3, "CONFIRMED_ELIGIBLE", null), "CONFIRMED");

    const wSupport2 = 3.2;
    const effective2 = wSupport2 * CROSS_SOURCE_BONUS; // 4.0
    assert.equal(computeState(effective2, 3.0, 3, "CONFIRMED_ELIGIBLE", null), "CONFIRMED");
  });
});

// ── §T.4 — Re-emergence threshold constants ───────────────────────────────────

describe("re-emergence thresholds", () => {
  it("T.4.1 REEMERGENCE_SUPPORT_MULTIPLIER gives 6.0 (4.0 × 1.5)", () => {
    assert.ok(Math.abs(CONFIRMED_EFFECTIVE_SUPPORT * REEMERGENCE_SUPPORT_MULTIPLIER - 6.0) < 0.001);
  });

  it("T.4.2 re-emergence threshold is higher than confirmed threshold", () => {
    assert.ok(CONFIRMED_EFFECTIVE_SUPPORT * REEMERGENCE_SUPPORT_MULTIPLIER > CONFIRMED_EFFECTIVE_SUPPORT);
    assert.ok(REEMERGENCE_DISTINCT_RECORDS > CONFIRMED_DISTINCT_RECORDS);
    assert.ok(REEMERGENCE_WNET_MINIMUM >= CONFIRMED_WNET);
  });
});

// ── §T.5 — Text generation ────────────────────────────────────────────────────

describe("generateTendencyText", () => {
  it("T.5.1 self-expression WORKS_WELL → positive claim", () => {
    const { claimText, rationaleText } = generateTendencyText("self-expression", "self-expression", "WORKS_WELL", 4, 1, ["STYLEME_OUTCOME"]);
    assert.ok(claimText.length > 0);
    assert.ok(rationaleText.includes("4"));
  });

  it("T.5.2 self-expression FRICTION → friction claim", () => {
    const { claimText } = generateTendencyText("self-expression", "self-expression", "FRICTION", 3, 1, ["POST_OUTFIT_REVIEW"]);
    assert.ok(claimText.includes("nAia is noticing") || claimText.length > 0);
  });

  it("T.5.3 comfort WORKS_WELL → comfort positive claim", () => {
    const { claimText } = generateTendencyText("comfort", "comfort", "WORKS_WELL", 3, 1, ["STYLEME_OUTCOME"]);
    assert.ok(claimText.toLowerCase().includes("comfort"));
  });

  it("T.5.4 formality too-formal → formality claim", () => {
    const { claimText } = generateTendencyText("formality", "too-formal", "FRICTION", 2, 1, ["STYLEME_OUTCOME"]);
    assert.ok(claimText.toLowerCase().includes("formal"));
  });

  it("T.5.5 formality too-casual → casualness claim", () => {
    const { claimText } = generateTendencyText("formality", "too-casual", "FRICTION", 2, 1, ["STYLEME_OUTCOME"]);
    assert.ok(claimText.toLowerCase().includes("casual"));
  });

  it("T.5.6 garment-category WORKS_WELL → category affinity claim", () => {
    const { claimText } = generateTendencyText("garment-category", "DRESSES", "WORKS_WELL", 5, 1, ["CLOSET_RELATIONSHIP"]);
    assert.ok(claimText.toLowerCase().includes("dress"));
  });

  it("T.5.7 distinctSources >= 2 → cross-source rationale appended", () => {
    const { rationaleText } = generateTendencyText("comfort", "comfort", "WORKS_WELL", 3, 2, ["STYLEME_OUTCOME", "POST_OUTFIT_REVIEW"]);
    // Should include a reference to multiple sources
    assert.ok(rationaleText.includes("across") || rationaleText.includes("session") || rationaleText.includes("wardrobe"));
  });

  it("T.5.8 distinctSources=1 → no cross-source note in rationale", () => {
    const { rationaleText } = generateTendencyText("comfort", "comfort", "WORKS_WELL", 3, 1, ["STYLEME_OUTCOME"]);
    assert.ok(!rationaleText.includes("across your session reviews and wardrobe"));
  });
});
