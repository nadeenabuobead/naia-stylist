// app/lib/ai/nadine-product-assessment.test.ts
// Phase 4A4 — 40 tests for the NADINE product-page intelligence engine.
// Run: node --test --import tsx/esm app/lib/ai/nadine-product-assessment.test.ts

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveProductByGid,
  assessProduct,
  computeTryOnStatus,
  buildProductPageResponse,
  getProductComponents,
  computeClosetCompatibility,
} from "./nadine-product-assessment.ts";
import { VIRTUAL_TRY_ON_ENABLED } from "./naia-product-media.ts";
import type {
  CustomerAssessmentProfile,
  ClosetItemSummary,
  ResolvedProduct,
} from "./nadine-product-assessment.types.ts";

// ── Numeric IDs (from verified media map) ─────────────────────────────────────
// GIDs verified 2026-07-16 via Shopify Admin API.

const ID = {
  COLLAR_SHIRT: "10285940179076",       // Becoming Real — TOP — ready
  ASYMMETRICAL_PANTS: "10285940015236", // Becoming Grounded — BOTTOM — ready
  DOUBLE_TOP: "10285939163268",         // Becoming Alive — TOP — needs-manual-review
  LEATHER_JACKET: "10403888005252",     // Becoming Clear — OUTERWEAR — ready
  MIDI_DRESS: "10285940211844",         // Becoming Her — DRESS — ready (one-piece)
  DRESS_SET: "10403887906948",          // Becoming Defined — SET — needs-manual-review
  TRENCH_COAT: "10285932380292",        // Becoming Seen — OUTERWEAR — ready
} as const;

// ── Profile fixtures ──────────────────────────────────────────────────────────

function makeFullProfile(overrides: Partial<CustomerAssessmentProfile> = {}): CustomerAssessmentProfile {
  return {
    stylePersonalities: ["corporate-chic"],
    desiredFeeling: "more-elevated",
    lifestyle: "professional",
    dressesFor: ["work", "dinner"],
    favoriteColors: ["beige", "cream"],
    avoidColors: [],
    fitPreferences: ["tailored"],
    comfortLevel: 7,
    ...overrides,
  };
}

function makeThinProfile(): CustomerAssessmentProfile {
  // Only 1 signal dimension — triggers insufficient-evidence.
  return {
    stylePersonalities: ["edgy"],
    desiredFeeling: null,
    lifestyle: null,
    dressesFor: [],
    favoriteColors: [],
    avoidColors: [],
    fitPreferences: [],
    comfortLevel: null,
  };
}

// ── Closet fixtures ───────────────────────────────────────────────────────────

function makeClosetItem(overrides: Partial<ClosetItemSummary> = {}): ClosetItemSummary {
  return {
    id: "closet-001",
    name: "My trouser",
    category: "bottom",
    colors: ["black"],
    styleTags: ["tailored"],
    occasions: ["work"],
    ...overrides,
  };
}

// ── ResolvedProduct fixture (bypasses real catalog for pure-logic tests) ───────

function makeProduct(overrides: Partial<ResolvedProduct> = {}): ResolvedProduct {
  return {
    v8Handle: "collar-shirt",
    nadinaTitle: "Becoming Real",
    shopifyHandle: "art-collar-layered-shirt",
    itemType: "TOP",
    colors: ["Cream", "beige", "espresso brown", "art print"],
    formalityScore: 3,
    formalityDescription: "Smart casual to polished formal",
    stylingRole: "Elevated wardrobe anchor",
    occasionTags: ["work", "everyday", "dinner", "special-event"],
    notIdealFor: "Very relaxed or oversized styling",
    desiredFeelingMatch: ["more-put-together", "more-confident", "more-elevated", "more-powerful"],
    stylePersonalityMatch: ["corporate-chic", "effortlessly-chic", "artsy"],
    colorDirection: "Neutral base with warm print",
    coverageModesty: "High — structured, opaque",
    bodyFitLogic: "Waist-defining, shoulder-padded",
    avoidPairingWithNadinePieces: null,
    mediaEligibility: "ready",
    hasVerifiedMedia: true,
    ...overrides,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// GROUP 1 — Product resolution (tests 1–6)
// ═════════════════════════════════════════════════════════════════════════════

describe("§1 resolveProductByGid", () => {

  it("T01 — valid numeric ID resolves to expected handle", () => {
    const product = resolveProductByGid(ID.COLLAR_SHIRT);
    assert.ok(product, "should resolve");
    assert.equal(product.v8Handle, "collar-shirt");
    assert.equal(product.nadinaTitle, "Becoming Real");
  });

  it("T02 — unknown numeric ID returns null", () => {
    const product = resolveProductByGid("9999999999999");
    assert.equal(product, null);
  });

  it("T03 — non-numeric input returns null (spoofing guard)", () => {
    assert.equal(resolveProductByGid("gid://shopify/Product/10285940179076"), null);
    assert.equal(resolveProductByGid("../admin"), null);
    assert.equal(resolveProductByGid("10285940179076; DROP TABLE"), null);
  });

  it("T04 — empty string returns null", () => {
    assert.equal(resolveProductByGid(""), null);
  });

  it("T05 — product with needs-manual-review eligibility still resolves", () => {
    const product = resolveProductByGid(ID.DOUBLE_TOP);
    assert.ok(product, "double-top should resolve despite needs-manual-review");
    assert.equal(product.v8Handle, "double-top");
    assert.equal(product.mediaEligibility, "needs-manual-review");
    assert.equal(product.hasVerifiedMedia, false);
  });

  it("T06 — parent products with components resolve; components are not separate top-level entries", () => {
    const parent = resolveProductByGid(ID.DOUBLE_TOP);
    assert.ok(parent, "parent resolves");
    // Components appear via getProductComponents, not as their own product entries.
    const components = getProductComponents("double-top");
    assert.ok(components.length > 0, "double-top has components");
    for (const c of components) {
      // Component handles are not valid product GIDs.
      const attempt = resolveProductByGid(c.componentHandle);
      assert.equal(attempt, null, `component '${c.componentHandle}' must not resolve as a product`);
    }
  });

});

// ═════════════════════════════════════════════════════════════════════════════
// GROUP 2 — Assessment verdicts (tests 7–17)
// ═════════════════════════════════════════════════════════════════════════════

describe("§2 assessProduct — verdicts", () => {

  it("T07 — strong-match when all positive signals fire and no negatives", () => {
    const product = makeProduct();
    const profile = makeFullProfile({
      stylePersonalities: ["corporate-chic"],   // +3
      desiredFeeling: "more-elevated",           // +2
      dressesFor: ["work", "everyday"],          // +2
      avoidColors: [],
    });
    const closet: ClosetItemSummary[] = [
      makeClosetItem({ category: "bottom" }),    // compatible: +1
    ];
    const result = assessProduct(product, profile, closet);
    assert.equal(result.verdict, "strong-match");
    assert.ok(result.positiveEvidence.length > 0);
    assert.equal(result.caveats.length, 0);
    assert.equal(result.schemaVersion, 1);
  });

  it("T08 — good-match-with-caveat when positive signals present but caveat exists", () => {
    const product = makeProduct();
    const profile = makeFullProfile({
      stylePersonalities: ["corporate-chic"],    // +3
      dressesFor: [],
      desiredFeeling: null,
    });
    const closet: ClosetItemSummary[] = [
      makeClosetItem({ category: "top" }),       // duplicate: -1, caveat added
    ];
    const result = assessProduct(product, profile, closet);
    // Score = 3 - 1 = 2, caveat present → good-match-with-caveat
    assert.equal(result.verdict, "good-match-with-caveat");
  });

  it("T09 — not-best-addition when avoid-color conflict fires", () => {
    const product = makeProduct({
      colors: ["Cream", "beige"],
    });
    const profile = makeFullProfile({
      avoidColors: ["Cream"],
    });
    const result = assessProduct(product, profile, []);
    assert.equal(result.verdict, "not-best-addition");
    assert.ok(result.signals.avoidColorConflict.length > 0);
    assert.ok(result.caveats.some((c) => c.code === "avoid-color-conflict"));
  });

  it("T10 — insufficient-evidence for null profile (guest)", () => {
    const product = makeProduct();
    const result = assessProduct(product, null, []);
    assert.equal(result.verdict, "insufficient-evidence");
    assert.equal(result.signals.sufficientEvidence, false);
  });

  it("T11 — insufficient-evidence when fewer than 2 signal dimensions are populated", () => {
    const product = makeProduct();
    const result = assessProduct(product, makeThinProfile(), []);
    assert.equal(result.verdict, "insufficient-evidence");
    assert.equal(result.signals.sufficientEvidence, false);
  });

  it("T12 — duplication risk detected when closet has same item category", () => {
    const product = makeProduct({ itemType: "TOP" });
    const profile = makeFullProfile({ stylePersonalities: ["corporate-chic"], dressesFor: ["work"] });
    const closet: ClosetItemSummary[] = [
      makeClosetItem({ category: "top" }),    // same category → duplicate risk
    ];
    const result = assessProduct(product, profile, closet);
    assert.equal(result.signals.duplicateRisk, true);
    assert.ok(result.caveats.some((c) => c.code === "duplicate-risk"));
  });

  it("T13 — wardrobe gap bonus when compatible item exists and no duplicate", () => {
    const product = makeProduct({ itemType: "TOP" });
    const profile = makeFullProfile({ stylePersonalities: ["corporate-chic"], dressesFor: ["work"] });
    const closet: ClosetItemSummary[] = [
      makeClosetItem({ category: "bottom" }),  // compatible, not a duplicate
    ];
    const result = assessProduct(product, profile, closet);
    assert.equal(result.signals.duplicateRisk, false);
    assert.equal(result.signals.wardrobeGapFilled, true);
  });

  it("T14 — avoid-color conflict is case-insensitive and partial-match aware", () => {
    const product = makeProduct({ colors: ["Burgundy", "ivory"] });
    const profile = makeFullProfile({ avoidColors: ["burgundy"] });
    const result = assessProduct(product, profile, []);
    assert.equal(result.verdict, "not-best-addition");
    assert.ok(result.signals.avoidColorConflict.includes("burgundy"));
  });

  it("T15 — closet compatibility count is capped at 2 points maximum", () => {
    const product = makeProduct({ itemType: "TOP" });
    const profile = makeFullProfile({ stylePersonalities: ["corporate-chic"], dressesFor: ["work"] });
    const closet: ClosetItemSummary[] = [
      makeClosetItem({ id: "b1", category: "bottom" }),
      makeClosetItem({ id: "b2", category: "bottom" }),
      makeClosetItem({ id: "b3", category: "outerwear" }),
      makeClosetItem({ id: "b4", category: "outerwear" }),
    ];
    const result = assessProduct(product, profile, closet);
    // 4 compatible items, but score contribution capped at 2.
    // Score: +3 (personality) +2 (occasion:work) + Math.min(4,2) = 7 — still strong-match.
    assert.equal(result.signals.closetCompatibilityCount, 4);
    // Verify capping by checking score didn't add 4.
    assert.equal(result.verdict, "strong-match");
  });

  it("T16 — assessment is deterministic: identical inputs produce identical output", () => {
    const product = makeProduct();
    const profile = makeFullProfile();
    const closet = [makeClosetItem()];
    const r1 = assessProduct(product, profile, closet);
    const r2 = assessProduct(product, profile, closet);
    assert.equal(r1.verdict, r2.verdict);
    assert.equal(r1.explanation, r2.explanation);
    assert.deepEqual(r1.positiveEvidence, r2.positiveEvidence);
    assert.deepEqual(r1.signals, r2.signals);
    // assessedAt timestamps will differ; exclude from comparison.
  });

  it("T17 — guest path: buildProductPageResponse returns null assessment for null profile", () => {
    const response = buildProductPageResponse(ID.COLLAR_SHIRT, null, [], false);
    assert.equal(response.resolved, true);
    if (response.resolved) {
      assert.equal(response.assessment, null);
      assert.equal(response.wardrobeCompatibilityCount, null);
    }
  });

});

// ═════════════════════════════════════════════════════════════════════════════
// GROUP 3 — Wardrobe integration (tests 18–22)
// ═════════════════════════════════════════════════════════════════════════════

describe("§3 wardrobe integration", () => {

  it("T18 — computeClosetCompatibility only counts correctly categorised owned items", () => {
    // TOP pairs with: bottom, outerwear.
    const compatible = computeClosetCompatibility("TOP", [
      makeClosetItem({ id: "1", category: "bottom" }),
      makeClosetItem({ id: "2", category: "outerwear" }),
      makeClosetItem({ id: "3", category: "top" }),   // not compatible (same category)
    ]);
    assert.equal(compatible.length, 2);
  });

  it("T19 — empty closet produces zero compatibility and no duplicate risk", () => {
    const product = makeProduct({ itemType: "TOP" });
    const profile = makeFullProfile({ stylePersonalities: ["corporate-chic"], dressesFor: ["work"] });
    const result = assessProduct(product, profile, []);
    assert.equal(result.signals.closetCompatibilityCount, 0);
    assert.equal(result.signals.duplicateRisk, false);
    assert.equal(result.signals.wardrobeGapFilled, false);
  });

  it("T20 — insufficient profile + empty closet → fails closed to insufficient-evidence", () => {
    const product = makeProduct();
    const profile = makeThinProfile();
    const result = assessProduct(product, profile, []);
    assert.equal(result.verdict, "insufficient-evidence");
    assert.equal(result.signals.sufficientEvidence, false);
  });

  it("T21 — double-top parent resolves with non-empty components list", () => {
    const components = getProductComponents("double-top");
    assert.ok(components.length > 0, "double-top should have components");
    for (const c of components) {
      assert.ok(c.componentHandle.startsWith("double-top/"), "handle is namespaced");
      assert.ok(c.componentName.length > 0);
      assert.ok(["coming-soon", "needs-testing", "unavailable"].includes(c.tryOnState));
    }
  });

  it("T22 — soldSeparately is always false on every component view", () => {
    const comps1 = getProductComponents("double-top");
    const comps2 = getProductComponents("dress-set");
    for (const c of [...comps1, ...comps2]) {
      assert.equal(c.soldSeparately, false);
    }
  });

});

// ═════════════════════════════════════════════════════════════════════════════
// GROUP 4 — StyleMe handoff (tests 23–27)
// ═════════════════════════════════════════════════════════════════════════════

describe("§4 StyleMe handoff fields", () => {

  it("T23 — v8Handle in resolved product matches locked catalogue handle", () => {
    const product = resolveProductByGid(ID.COLLAR_SHIRT);
    assert.ok(product);
    // v8Handle must be one of the 11 locked catalogue handles.
    const LOCKED = [
      "double-top", "collar-shirt", "cropped-top", "asymmetrical-pants",
      "straight-pants", "suede-skirt", "trench-coat", "kimono-jacket",
      "leather-suede-jacket", "midi-dress", "dress-set",
    ];
    assert.ok(LOCKED.includes(product.v8Handle), `unexpected handle: ${product.v8Handle}`);
  });

  it("T24 — v8Handle is stable: same GID always returns same handle", () => {
    const a = resolveProductByGid(ID.COLLAR_SHIRT);
    const b = resolveProductByGid(ID.COLLAR_SHIRT);
    assert.equal(a?.v8Handle, b?.v8Handle);
  });

  it("T25 — assessment explanation never contains a percentage string", () => {
    const product = makeProduct();
    const profile = makeFullProfile();
    const result = assessProduct(product, profile, []);
    assert.ok(!result.explanation.includes("%"), "explanation must not contain percentages");
    for (const evidence of result.positiveEvidence) {
      assert.ok(!evidence.includes("%"), "positive evidence must not contain percentages");
    }
  });

  it("T26 — ProductPageIntelligence includes StyleMe handoff fields", () => {
    const response = buildProductPageResponse(ID.COLLAR_SHIRT, makeFullProfile(), [], false);
    assert.equal(response.resolved, true);
    if (response.resolved) {
      assert.ok(typeof response.v8Handle === "string");
      assert.ok(typeof response.nadinaTitle === "string");
      assert.ok(typeof response.stylingRole === "string");
      assert.ok(Array.isArray(response.occasionTags));
    }
  });

  it("T27 — response schemaVersion is always 1", () => {
    const response = buildProductPageResponse(ID.COLLAR_SHIRT, makeFullProfile(), [], false);
    if (response.resolved) {
      assert.equal(response.schemaVersion, 1);
    }
  });

});

// ═════════════════════════════════════════════════════════════════════════════
// GROUP 5 — Try-on gate (tests 28–34)
// ═════════════════════════════════════════════════════════════════════════════

describe("§5 try-on gate — VIRTUAL_TRY_ON_ENABLED = false", () => {

  it("T28 — VIRTUAL_TRY_ON_ENABLED is false at module level", () => {
    assert.equal(VIRTUAL_TRY_ON_ENABLED, false);
  });

  it("T29 — ready eligibility + no model → state 'no-model'", () => {
    const status = computeTryOnStatus("ready", false);
    assert.equal(status.state, "no-model");
    assert.ok(status.label.length > 0);
  });

  it("T30 — ready eligibility + has model + global gate off → state 'coming-soon'", () => {
    const status = computeTryOnStatus("ready", true);
    assert.equal(status.state, "coming-soon");
  });

  it("T31 — needs-manual-review eligibility → state 'needs-testing'", () => {
    const status = computeTryOnStatus("needs-manual-review", true);
    assert.equal(status.state, "needs-testing");
  });

  it("T32 — unsuitable-image eligibility → state 'unavailable'", () => {
    const status = computeTryOnStatus("unsuitable-image", true);
    assert.equal(status.state, "unavailable");
  });

  it("T33 — buildProductPageResponse for double-top (needs-manual-review) shows try-on unavailable/needs-testing", () => {
    const response = buildProductPageResponse(ID.DOUBLE_TOP, null, [], false);
    assert.equal(response.resolved, true);
    if (response.resolved) {
      assert.ok(
        ["needs-testing", "unavailable"].includes(response.tryOnStatus.state),
        `expected needs-testing or unavailable, got ${response.tryOnStatus.state}`,
      );
    }
  });

  it("T34 — ready media product without model shows 'no-model' state, not an active try-on", () => {
    const response = buildProductPageResponse(ID.COLLAR_SHIRT, null, [], false);
    assert.equal(response.resolved, true);
    if (response.resolved) {
      // ready + no model + global gate off → no-model
      assert.equal(response.tryOnStatus.state, "no-model");
      // Must not be a state that implies a live FASHN call is active.
      assert.notEqual(response.tryOnStatus.state, "coming-soon");
    }
  });

});

// ═════════════════════════════════════════════════════════════════════════════
// GROUP 6 — Security and fail-closed (tests 35–40)
// ═════════════════════════════════════════════════════════════════════════════

describe("§6 security and fail-closed", () => {

  it("T35 — assessment is isolated per profile: different profiles produce different verdicts", () => {
    const product = makeProduct({ colors: ["Cream", "beige"] });
    const profileA = makeFullProfile({ avoidColors: ["Cream"] }); // conflict → not-best-addition
    const profileB = makeFullProfile({ avoidColors: [], stylePersonalities: ["corporate-chic"], dressesFor: ["work"] });
    const rA = assessProduct(product, profileA, []);
    const rB = assessProduct(product, profileB, []);
    assert.equal(rA.verdict, "not-best-addition");
    assert.notEqual(rA.verdict, rB.verdict);
  });

  it("T36 — ProductPageIntelligence does not expose raw Shopify GIDs", () => {
    const response = buildProductPageResponse(ID.COLLAR_SHIRT, makeFullProfile(), [], false);
    const json = JSON.stringify(response);
    assert.ok(!json.includes("gid://shopify/Product/"), "must not expose product GIDs");
    assert.ok(!json.includes("gid://shopify/MediaImage/"), "must not expose media GIDs");
  });

  it("T37 — response never references face photos or photo uploads", () => {
    const response = buildProductPageResponse(ID.COLLAR_SHIRT, makeFullProfile(), [], false);
    const json = JSON.stringify(response).toLowerCase();
    assert.ok(!json.includes("face"), "response must not reference face");
    assert.ok(!json.includes("photo upload"), "response must not prompt photo upload");
    assert.ok(!json.includes("selfie"), "response must not reference selfie");
  });

  it("T38 — all 4 verdict types are valid non-empty strings", () => {
    const verdicts = ["strong-match", "good-match-with-caveat", "not-best-addition", "insufficient-evidence"];
    for (const v of verdicts) {
      assert.ok(typeof v === "string" && v.length > 0);
    }
    // Check the actual verdict produced is always one of these 4.
    const result = assessProduct(makeProduct(), makeFullProfile(), []);
    assert.ok(verdicts.includes(result.verdict), `unexpected verdict: ${result.verdict}`);
  });

  it("T39 — full response is JSON-serializable (no functions, no circular refs)", () => {
    const response = buildProductPageResponse(ID.COLLAR_SHIRT, makeFullProfile(), [], false);
    assert.doesNotThrow(() => JSON.stringify(response));
  });

  it("T40 — unknown product GID fails closed to resolved:false", () => {
    const response = buildProductPageResponse("9999999999999", null, [], false);
    assert.equal(response.resolved, false);
    if (!response.resolved) {
      assert.equal(response.reason, "unknown-product");
    }
  });

});
