// app/lib/ai/taste-extraction.test.ts
// Phase 5D — Taste Evidence extraction unit tests.
// Pure function tests: no DB, no mocking required.
// Run with: npx tsx --test app/lib/ai/taste-extraction.test.ts

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  extractStyleMeEvidence,
  extractPostWearEvidence,
  extractClosetEvidence,
  extractBuySkipEvidence,
} from "./taste-extraction.server.js";
import { SOURCE_BASE_STRENGTH, SUPPRESS_RATIO, CONTEST_RATIO } from "./taste-contract.js";
import { adaptBuySkipOutcomeFindings } from "./customer-intelligence-buyskip-outcome-adapter.ts";

const T = new Date("2026-09-05T10:00:00Z");
const CID = "cust_test";

// ── §E.1 — STYLEME_OUTCOME extraction ─────────────────────────────────────────

describe("extractStyleMeEvidence", () => {
  it("E.1.1 wore-it + goal=yes + felt-like-me → positive self-expression at full strength", () => {
    const rows = extractStyleMeEvidence({
      id: "out1", customerId: CID,
      outcomeStatus: "wore-it", goalOutcome: "yes",
      changeTypes: [], whatWorked: ["felt-like-me"], whatFeltOff: [], didntWearReasons: [],
      submittedAt: T,
    });
    assert.equal(rows.length, 1);
    const r = rows[0];
    assert.equal(r.dimension, "self-expression");
    assert.equal(r.polarity, "positive");
    // base=0.8 * qualityMod(positive)=1.0
    assert.ok(Math.abs(r.strength - 0.8) < 0.001, `expected 0.8, got ${r.strength}`);
  });

  it("E.1.2 felt-confident tag is NOT extracted (correction #2)", () => {
    const rows = extractStyleMeEvidence({
      id: "out2", customerId: CID,
      outcomeStatus: "wore-it", goalOutcome: "yes",
      changeTypes: [], whatWorked: ["felt-confident"], whatFeltOff: [], didntWearReasons: [],
      submittedAt: T,
    });
    assert.equal(rows.length, 0);
  });

  it("E.1.3 didnt-wear-it + style-mood-changed → no rows (correction #2)", () => {
    const rows = extractStyleMeEvidence({
      id: "out3", customerId: CID,
      outcomeStatus: "didnt-wear-it", goalOutcome: null,
      changeTypes: [], whatWorked: [], whatFeltOff: [], didntWearReasons: ["style-mood-changed"],
      submittedAt: T,
    });
    assert.equal(rows.length, 0);
  });

  it("E.1.4 didnt-wear-it + comfort-concern → negative comfort at 0.5 modifier", () => {
    const rows = extractStyleMeEvidence({
      id: "out4", customerId: CID,
      outcomeStatus: "didnt-wear-it", goalOutcome: null,
      changeTypes: [], whatWorked: [], whatFeltOff: [], didntWearReasons: ["comfort-concern"],
      submittedAt: T,
    });
    assert.equal(rows.length, 1);
    const r = rows[0];
    assert.equal(r.dimension, "comfort");
    assert.equal(r.polarity, "negative");
    // base=0.8 * negMod(didnt-wear-it)=0.5 → 0.4
    assert.ok(Math.abs(r.strength - 0.4) < 0.001, `expected 0.4, got ${r.strength}`);
  });

  it("E.1.5 wore-it + goal=yes + didnt-feel-like-me → negative self-expression with reduced modifier", () => {
    const rows = extractStyleMeEvidence({
      id: "out5", customerId: CID,
      outcomeStatus: "wore-it", goalOutcome: "yes",
      changeTypes: [], whatWorked: [], whatFeltOff: ["didnt-feel-like-me"], didntWearReasons: [],
      submittedAt: T,
    });
    assert.equal(rows.length, 1);
    const r = rows[0];
    assert.equal(r.dimension, "self-expression");
    assert.equal(r.polarity, "negative");
    // base=0.8 * negMod(wore-it, goal=yes)=0.6 → 0.48
    assert.ok(Math.abs(r.strength - 0.48) < 0.001, `expected 0.48, got ${r.strength}`);
  });

  it("E.1.6 too-formal in whatFeltOff → negative formality too-formal", () => {
    const rows = extractStyleMeEvidence({
      id: "out6", customerId: CID,
      outcomeStatus: "wore-it", goalOutcome: "somewhat",
      changeTypes: [], whatWorked: [], whatFeltOff: ["too-formal"], didntWearReasons: [],
      submittedAt: T,
    });
    const r = rows.find(x => x.dimension === "formality");
    assert.ok(r);
    assert.equal(r.value, "too-formal");
    assert.equal(r.polarity, "negative");
  });

  it("E.1.7 changeTypes:less-formal → formality too-formal negative", () => {
    const rows = extractStyleMeEvidence({
      id: "out7", customerId: CID,
      outcomeStatus: "changed-something", goalOutcome: null,
      changeTypes: ["less-formal"], whatWorked: [], whatFeltOff: [], didntWearReasons: [],
      submittedAt: T,
    });
    const r = rows.find(x => x.dimension === "formality");
    assert.ok(r);
    assert.equal(r.value, "too-formal");
    assert.equal(r.polarity, "negative");
  });

  it("E.1.8 deduplication: same (dimension,value,polarity) from two rules → stronger wins", () => {
    // comfortable in whatWorked AND changeTypes:more-comfortable would conflict,
    // but both produce comfort/comfort and different polarities, so both survive.
    // For same polarity dedup: wore-it goal=yes → posMod=1.0 → strength=0.8
    // changeTypes negative → negMod=1.0 (changed-something) → 0.8
    // These are different polarities so no dedup. Test a real dedup scenario:
    // fit-issue in whatFeltOff + different-fit in changeTypes → same (fit,fit,negative)
    const rows = extractStyleMeEvidence({
      id: "out8", customerId: CID,
      outcomeStatus: "changed-something", goalOutcome: null,
      changeTypes: ["different-fit"], whatWorked: [], whatFeltOff: ["fit-issue"], didntWearReasons: [],
      submittedAt: T,
    });
    const fitRows = rows.filter(x => x.dimension === "fit" && x.polarity === "negative");
    // Both map to (fit, fit, negative) → dedup → keep strongest (both same strength; only 1 row)
    assert.equal(fitRows.length, 1);
  });

  it("E.1.9 wore-it + goal=yes + positive has 0 strength for didnt-wear modifier (not applicable here)", () => {
    // wore-it gives posMod=1.0 → comfortable has strength > 0
    const rows = extractStyleMeEvidence({
      id: "out9", customerId: CID,
      outcomeStatus: "wore-it", goalOutcome: "yes",
      changeTypes: [], whatWorked: ["comfortable"], whatFeltOff: [], didntWearReasons: [],
      submittedAt: T,
    });
    const r = rows.find(x => x.dimension === "comfort" && x.polarity === "positive");
    assert.ok(r);
    assert.ok(r.strength > 0);
  });

  it("E.1.10 didnt-wear-it + positive tags → posMod=0, rows with s=0 not emitted", () => {
    // qualityMod positive for didnt-wear-it = 0.0 → s=0 → row skipped (s>0 guard)
    const rows = extractStyleMeEvidence({
      id: "out10", customerId: CID,
      outcomeStatus: "didnt-wear-it", goalOutcome: null,
      changeTypes: [], whatWorked: ["felt-like-me", "comfortable"], whatFeltOff: [], didntWearReasons: [],
      submittedAt: T,
    });
    // Both positive rows have s=0 → not pushed
    assert.equal(rows.filter(r => r.polarity === "positive").length, 0);
  });
});

// ── §E.2 — POST_OUTFIT_REVIEW extraction ──────────────────────────────────────

describe("extractPostWearEvidence", () => {
  it("E.2.1 feltLikeHer=yes → positive self-expression with quality modifier", () => {
    const rows = extractPostWearEvidence({
      id: "rev1", customerId: CID,
      feltLikeHer: "yes", feelingAnswer: "great",
      physicallyComfortable: null, fitFeedback: null, didWearIt: null,
      createdAt: T,
    });
    const r = rows.find(x => x.dimension === "self-expression" && x.polarity === "positive");
    assert.ok(r);
    // base=0.7 * mod(great=1.0, wouldWearAgain not set=1.0) → 0.7
    assert.ok(Math.abs(r.strength - 0.7) < 0.001);
  });

  it("E.2.2 feltLikeHer=no → negative self-expression at base strength", () => {
    const rows = extractPostWearEvidence({
      id: "rev2", customerId: CID,
      feltLikeHer: "no",
      physicallyComfortable: null, fitFeedback: null, didWearIt: null,
      createdAt: T,
    });
    const r = rows.find(x => x.dimension === "self-expression" && x.polarity === "negative");
    assert.ok(r);
    assert.ok(Math.abs(r.strength - 0.7) < 0.001);
  });

  it("E.2.3 feltLikeHer=somewhat → weak positive self-expression", () => {
    const rows = extractPostWearEvidence({
      id: "rev3", customerId: CID,
      feltLikeHer: "somewhat",
      physicallyComfortable: null, fitFeedback: null, didWearIt: null,
      createdAt: T,
    });
    const r = rows.find(x => x.dimension === "self-expression" && x.polarity === "positive");
    assert.ok(r);
    // base * 0.4 = 0.28
    assert.ok(Math.abs(r.strength - 0.28) < 0.001);
  });

  it("E.2.4 physicallyComfortable=yes (legacy vocab) → positive comfort", () => {
    const rows = extractPostWearEvidence({
      id: "rev4", customerId: CID,
      physicallyComfortable: "Comfortable",
      feltLikeHer: null, fitFeedback: null, didWearIt: null,
      createdAt: T,
    });
    const r = rows.find(x => x.dimension === "comfort" && x.polarity === "positive");
    assert.ok(r);
  });

  it("E.2.5 physicallyComfortable=yes (Phase 4B1) → positive comfort", () => {
    const rows = extractPostWearEvidence({
      id: "rev5", customerId: CID,
      physicallyComfortable: "yes",
      feltLikeHer: null, fitFeedback: null, didWearIt: null,
      createdAt: T,
    });
    const r = rows.find(x => x.dimension === "comfort" && x.polarity === "positive");
    assert.ok(r);
  });

  it("E.2.6 physicallyComfortable=mostly → weak-positive comfort at 0.5 base strength", () => {
    const rows = extractPostWearEvidence({
      id: "rev6", customerId: CID,
      physicallyComfortable: "mostly",
      feltLikeHer: null, fitFeedback: null, didWearIt: null,
      createdAt: T,
    });
    const r = rows.find(x => x.dimension === "comfort" && x.polarity === "positive");
    assert.ok(r);
    assert.ok(Math.abs(r.strength - 0.35) < 0.001); // 0.7 * 0.5
  });

  it("E.2.7 fitFeedback=no with didWearIt=yes → negative fit", () => {
    const rows = extractPostWearEvidence({
      id: "rev7", customerId: CID,
      fitFeedback: "no", didWearIt: "yes",
      feltLikeHer: null, physicallyComfortable: null,
      createdAt: T,
    });
    const r = rows.find(x => x.dimension === "fit" && x.polarity === "negative");
    assert.ok(r);
  });

  it("E.2.8 fitFeedback=no without didWearIt=yes → NO fit evidence", () => {
    const rows = extractPostWearEvidence({
      id: "rev8", customerId: CID,
      fitFeedback: "no", didWearIt: "not-yet",
      feltLikeHer: null, physicallyComfortable: null,
      createdAt: T,
    });
    assert.equal(rows.filter(x => x.dimension === "fit").length, 0);
  });

  it("E.2.9 source/sourceRecordId are set correctly", () => {
    const rows = extractPostWearEvidence({
      id: "rev9", customerId: CID,
      feltLikeHer: "yes",
      physicallyComfortable: null, fitFeedback: null, didWearIt: null,
      createdAt: T,
    });
    assert.ok(rows.every(r => r.source === "POST_OUTFIT_REVIEW"));
    assert.ok(rows.every(r => r.sourceRecordId === "rev9"));
  });
});

// ── §E.3 — CLOSET_RELATIONSHIP extraction ─────────────────────────────────────

describe("extractClosetEvidence", () => {
  it("E.3.1 favourite → positive garment-category at full strength", () => {
    const rows = extractClosetEvidence({
      id: "item1", customerId: CID, category: "DRESSES",
      garmentRelationships: ["favourite"], updatedAt: T,
    });
    assert.equal(rows.length, 1);
    const r = rows[0];
    assert.equal(r.dimension, "garment-category");
    assert.equal(r.value, "DRESSES");
    assert.equal(r.polarity, "positive");
    // base=0.5 * 1.0 = 0.5
    assert.ok(Math.abs(r.strength - 0.5) < 0.001);
  });

  it("E.3.2 regret → negative garment-category at full strength", () => {
    const rows = extractClosetEvidence({
      id: "item2", customerId: CID, category: "JEANS",
      garmentRelationships: ["regret"], updatedAt: T,
    });
    const r = rows[0];
    assert.equal(r.polarity, "negative");
    assert.ok(Math.abs(r.strength - 0.5) < 0.001);
  });

  it("E.3.3 favourite beats wear-often when both present", () => {
    const rows = extractClosetEvidence({
      id: "item3", customerId: CID, category: "TOPS",
      garmentRelationships: ["wear-often", "favourite"], updatedAt: T,
    });
    // Both positive — favourite (1.0) > wear-often (0.8) → one row at 0.5 * 1.0
    const posRows = rows.filter(r => r.polarity === "positive");
    assert.equal(posRows.length, 1);
    assert.ok(Math.abs(posRows[0].strength - 0.5) < 0.001);
  });

  it("E.3.4 like/unsure/occasion-only → no rows", () => {
    const rows = extractClosetEvidence({
      id: "item4", customerId: CID, category: "TOPS",
      garmentRelationships: ["like", "unsure", "occasion-only"], updatedAt: T,
    });
    assert.equal(rows.length, 0);
  });

  it("E.3.5 both favourite (positive) and regret (negative) → two rows", () => {
    const rows = extractClosetEvidence({
      id: "item5", customerId: CID, category: "DRESSES",
      garmentRelationships: ["favourite", "regret"], updatedAt: T,
    });
    assert.equal(rows.length, 2);
  });
});

// ── §E.4 — BUYSKIP_OUTCOME extraction ─────────────────────────────────────────

describe("extractBuySkipEvidence", () => {
  it("E.4.1 LOVE_IT → positive garment-category", () => {
    const rows = extractBuySkipEvidence({
      id: "bos1", customerId: CID,
      postPurchaseOutcome: "LOVE_IT", category: "DRESSES", createdAt: T,
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].polarity, "positive");
    assert.ok(Math.abs(rows[0].strength - 0.6) < 0.001);
  });

  it("E.4.2 RETURNED_IT → negative garment-category", () => {
    const rows = extractBuySkipEvidence({
      id: "bos2", customerId: CID,
      postPurchaseOutcome: "RETURNED_IT", category: "TOPS", createdAt: T,
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].polarity, "negative");
  });

  it("E.4.3 ITS_OKAY → no rows", () => {
    const rows = extractBuySkipEvidence({
      id: "bos3", customerId: CID,
      postPurchaseOutcome: "ITS_OKAY", category: "TOPS", createdAt: T,
    });
    assert.equal(rows.length, 0);
  });

  it("E.4.4 null category → no rows", () => {
    const rows = extractBuySkipEvidence({
      id: "bos4", customerId: CID,
      postPurchaseOutcome: "LOVE_IT", category: null, createdAt: T,
    });
    assert.equal(rows.length, 0);
  });

  it("E.4.5 null outcome → no rows", () => {
    const rows = extractBuySkipEvidence({
      id: "bos5", customerId: CID,
      postPurchaseOutcome: null, category: "TOPS", createdAt: T,
    });
    assert.equal(rows.length, 0);
  });

  it("E.4.6 Phase 4 Shared Intelligence adapters have zero effect on this function's output — same facts, called alongside the new adapters, produce byte-identical TasteEvidence rows", () => {
    const facts = [
      { id: "bos1", customerId: CID, postPurchaseOutcome: "LOVE_IT" as const, category: "DRESSES", createdAt: T },
      { id: "bos2", customerId: CID, postPurchaseOutcome: "RETURNED_IT" as const, category: "TOPS", createdAt: T },
      { id: "bos3", customerId: CID, postPurchaseOutcome: "ITS_OKAY" as const, category: "TOPS", createdAt: T },
    ];
    const before = facts.map((f) => extractBuySkipEvidence(f));

    const sharedFindings = adaptBuySkipOutcomeFindings(
      facts.map((f) => ({ id: f.id, customerId: f.customerId, category: f.category, decision: "BOUGHT_IT" as const, postPurchaseOutcome: f.postPurchaseOutcome, updatedAt: f.createdAt })),
    );
    assert.ok(sharedFindings.length > 0, "sanity: the Phase 4 adapter actually produced something from these facts, including ITS_OKAY which TasteEvidence excludes");

    const after = facts.map((f) => extractBuySkipEvidence(f));
    assert.deepEqual(after, before, "extractBuySkipEvidence's output must be unchanged whether or not the Phase 4 adapter was also called on the same facts");
  });

  // E.4.7 — TEMP QA DIAGNOSTIC fix: What nAia Is Noticing, category fragmentation.
  // BuyOrSkipAnalysis.category comes from the Buy or Skip Step 2 dropdown
  // (buyskip._index.tsx CATEGORIES: Top/Bottom/Dress/Outerwear/Shoes/Bag/
  // Accessory/Jewelry) — singular, title-case — while ClosetItem.category is
  // the plural, all-caps ClosetCategory enum. Before this fix, a "Bottom"
  // Buy-or-Skip outcome and a "BOTTOMS" Closet relationship produced two
  // separate garment-category|value groups instead of one, each too thin to
  // reach CANDIDATE on its own.
  const BUYSKIP_TO_CLOSET = {
    Top: "TOPS", Bottom: "BOTTOMS", Dress: "DRESSES", Outerwear: "OUTERWEAR",
    Shoes: "SHOES", Bag: "BAGS", Accessory: "ACCESSORIES", Jewelry: "JEWELRY",
  };
  for (const [buySkipLabel, closetValue] of Object.entries(BUYSKIP_TO_CLOSET)) {
    it(`E.4.7 "${buySkipLabel}" (Buy or Skip Step 2 vocabulary) canonicalizes onto ClosetCategory's "${closetValue}"`, () => {
      const rows = extractBuySkipEvidence({
        id: "bos-cat", customerId: CID,
        postPurchaseOutcome: "LOVE_IT", category: buySkipLabel, createdAt: T,
      });
      assert.equal(rows.length, 1);
      assert.equal(rows[0].value, closetValue);
    });
  }

  it("E.4.8 an already-canonical ClosetCategory value passes through unchanged", () => {
    const rows = extractBuySkipEvidence({
      id: "bos-cat2", customerId: CID,
      postPurchaseOutcome: "RETURNED_IT", category: "ACTIVEWEAR", createdAt: T,
    });
    assert.equal(rows[0].value, "ACTIVEWEAR");
  });

  it("E.4.9 an unrecognized future category string falls back to uppercased as-is, never crashes", () => {
    const rows = extractBuySkipEvidence({
      id: "bos-cat3", customerId: CID,
      postPurchaseOutcome: "LOVE_IT", category: "Swimwear", createdAt: T,
    });
    assert.equal(rows[0].value, "SWIMWEAR");
  });

  it("E.4.10 provenance.rawValues preserves the original (pre-canonicalization) category string", () => {
    const rows = extractBuySkipEvidence({
      id: "bos-cat4", customerId: CID,
      postPurchaseOutcome: "LOVE_IT", category: "Bottom", createdAt: T,
    });
    assert.equal(rows[0].value, "BOTTOMS");
    assert.deepEqual(rows[0].provenance.rawValues, ["LOVE_IT", "Bottom"]);
  });

  it("E.4.11 a Closet-relationship BOTTOMS claim and a Buy-or-Skip \"Bottom\" claim now share one observation key — the fragmentation this fix closes", () => {
    const closetRows = extractClosetEvidence({
      id: "closet1", customerId: CID, category: "BOTTOMS",
      garmentRelationships: ["favourite"], updatedAt: T,
    });
    const buySkipRows = extractBuySkipEvidence({
      id: "bos-cat5", customerId: CID,
      postPurchaseOutcome: "LOVE_IT", category: "Bottom", createdAt: T,
    });
    assert.equal(closetRows[0].dimension, "garment-category");
    assert.equal(buySkipRows[0].dimension, "garment-category");
    assert.equal(
      closetRows[0].value,
      buySkipRows[0].value,
      "same real-world category must produce the same (dimension, value) observation key regardless of which source reported it",
    );
  });
});

// ── §E.5 — Strength clamping ──────────────────────────────────────────────────

describe("strength clamping", () => {
  it("E.5.1 strength is always clamped to [0.1, 1.0]", () => {
    // The extraction functions call clampStrength internally.
    // Test that we never produce strength < 0.1 for a non-zero signal.
    // wore-it + goal=somewhat → posMod=0.7 → s = 0.8 * 0.7 = 0.56 (within range)
    const rows = extractStyleMeEvidence({
      id: "clamp1", customerId: CID,
      outcomeStatus: "wore-it", goalOutcome: "somewhat",
      changeTypes: [], whatWorked: ["comfortable"], whatFeltOff: [], didntWearReasons: [],
      submittedAt: T,
    });
    assert.ok(rows.every(r => r.strength >= 0.1 && r.strength <= 1.0));
  });
});
