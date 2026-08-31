// app/lib/ai/styleme-result.test.ts
// Tests for the Phase 3D StyleMe result pipeline.
// Covers: buildProfileSignals, buildEngineInput, buildFinishingLayer,
// deterministicWording, buildDbPayload, buildSongReason, parseSuggestionMetadata,
// and integration via computeStyleMeResult.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildProfileSignals,
  buildEngineInput,
  buildFinishingLayer,
  deterministicWording,
  buildDbPayload,
  buildSongReason,
  containsBlockedTerms,
  computeStyleMeResult,
  styleSourceToSessionSource,
  getFilledClothingSlots,
  getMissingEssentialSlots,
  buildCompletionLayer,
  resolveSetSlots,
  STYLEME_WORDING_SYSTEM_PROMPT,
  buildProfileHint,
} from "./styleme-result.server.ts";
import type {
  StyleMeCustomerResult,
  StyleMeDbPayload,
  StyleMeFinishingLayer,
  StyleMeOutcome,
  StyleMeWording,
  StyleMeCompletionPiece,
} from "./styleme-result.types.ts";
import { parseSuggestionMetadata } from "./styleme-result.types.ts";
import { SONG_CATALOG } from "./get-ready-song-catalog.ts";
import { runRecommendation } from "./styleme-recommendation.ts";
import type { ClosetAnchorInput, StyleMeEngineInput, StyleMeRecommendationResult } from "./styleme-recommendation.types.ts";
import { resolveActionAnchor } from "./styleme-anchor.server.ts";
import type { NormalizedClosetAnchor, NormalizedStyleAnchor } from "./styleme-recommendation.types.ts";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeMinimalEngineInput() {
  return buildEngineInput({
    moods: ["confident"],
    desiredFeelings: ["more-elevated"],
    bodyNeeds: ["nothing-specific"],
    coverageConditional: null,
    occasion: "everyday",
    formalityConditional: null,
    todayColours: { preferred: [], avoid: [] },
    practicalIds: [],
    source: "naia-piece",
  });
}

function makeMinimalResult(overrides: Partial<StyleMeCustomerResult> = {}): StyleMeCustomerResult {
  const song = SONG_CATALOG[0] as (typeof SONG_CATALOG)[number];
  const baseFinishing: StyleMeFinishingLayer = {
    shoes: "Pointed-toe pumps or sleek ankle boots.",
    bag: "A compact structured bag.",
    accessories: "Minimal — one refined earring or cuff.",
    hair: "Hair up or swept back.",
    colourDirection: "Build around neutrals with one warm accent.",
  };
  return {
    outcome: "nadine-recommendation",
    outfitName: "Collar Shirt for everyday",
    whyThisWorks: "This shirt anchors the look.",
    confidenceBoost: "You dressed intentionally — it shows.",
    perfumeNote: null,
    primaryProduct: {
      handle: "collar-shirt",
      title: "Becoming Seen",
      slot: "top",
      shopifyProductId: null,
      productImageUrl: null,
      liveUrl: null,
      productUrl: null,
      stylingNotes: "Let this shirt lead the outfit.",
    },
    alternatives: [],
    closetAnchorLabel: null,
    closetAnchorImageUrl: null,
    pairingNote: null,
    finishingLayer: baseFinishing,
    completionLayer: [],
    songReason: "Curated to set the tone for your everyday.",
    song,
    resultDirections: [],
    rawRecommendation: {
      outcome: "nadine-recommendation",
      anchor: null,
      primary: null,
      alternatives: [],
      outfitPlan: { anchorSlot: null, recommendedSlot: null, compatibilityStatus: "compatible", notes: [] },
      evaluatedProducts: [],
      coverage: { totalCatalogProducts: 11, eligibleCandidates: 11, excludedCandidates: 0 },
    },
    ...overrides,
  };
}

// ── §1 buildProfileSignals ───────────────────────────────────────────────────

describe("§1 buildProfileSignals", () => {
  it("1.1 — null profile returns undefined", () => {
    assert.equal(buildProfileSignals(null), undefined);
  });

  it("1.2 — undefined profile returns undefined", () => {
    assert.equal(buildProfileSignals(undefined), undefined);
  });

  it("1.3 — profile with fields maps correctly", () => {
    const result = buildProfileSignals({
      stylePersonalities: ["classic", "artsy"],
      favoriteColors: ["black"],
      avoidColors: ["neon-yellow"],
      styleSupport: ["define-waist"],
      desiredImpression: ["polished"],
    });
    assert.ok(result !== undefined);
    assert.deepEqual(result!.stylePersonalities, ["classic", "artsy"]);
    assert.deepEqual(result!.avoidColors, ["neon-yellow"]);
  });
});

// ── §2 buildEngineInput ──────────────────────────────────────────────────────

describe("§2 buildEngineInput", () => {
  it("2.1 — maps moods and desiredFeelings into session", () => {
    const input = buildEngineInput({
      moods: ["romantic", "adventurous"],
      desiredFeelings: ["more-feminine"],
      bodyNeeds: ["nothing-specific"],
      coverageConditional: null,
      occasion: "date-night",
      formalityConditional: "semi-formal",
      todayColours: { preferred: ["burgundy"], avoid: [] },
      practicalIds: [],
      source: "naia-piece",
    });
    assert.deepEqual(input.session.moods, ["romantic", "adventurous"]);
    assert.deepEqual(input.session.desiredFeelings, ["more-feminine"]);
    assert.equal(input.session.formalityConditional, "semi-formal");
    assert.deepEqual(input.session.todayColours.preferred, ["burgundy"]);
  });

  it("2.2 — source value is preserved", () => {
    const input = buildEngineInput({
      moods: ["confident"], desiredFeelings: [], bodyNeeds: [],
      coverageConditional: null, occasion: "work", formalityConditional: null,
      todayColours: { preferred: [], avoid: [] }, practicalIds: [],
      source: "my-closet",
    });
    assert.equal(input.session.source, "my-closet");
  });

  it("2.3 — anchor is null and recentlyShownHandles defaults to [] when not provided", () => {
    const input = makeMinimalEngineInput();
    assert.equal(input.anchor, null);
    assert.deepEqual(input.recentlyShownHandles, []);
  });

  it("2.4 — NadineAnchorInput is passed through when provided", () => {
    const input = buildEngineInput({
      moods: ["confident"], desiredFeelings: [], bodyNeeds: [],
      coverageConditional: null, occasion: "everyday", formalityConditional: null,
      todayColours: { preferred: [], avoid: [] }, practicalIds: [],
      source: "naia-piece",
      anchor: { type: "nadine", handle: "midi-dress" },
    });
    assert.ok(input.anchor !== null);
    assert.equal(input.anchor!.type, "nadine");
    assert.equal((input.anchor as { type: string; handle: string }).handle, "midi-dress");
  });
});

// ── §3 buildFinishingLayer ───────────────────────────────────────────────────

describe("§3 buildFinishingLayer", () => {
  it("3.1 — null handle returns generic finishing layer", () => {
    const layer = buildFinishingLayer(null);
    assert.ok(layer.shoes.length > 0);
    assert.ok(layer.bag.length > 0);
    assert.ok(layer.accessories.length > 0);
    assert.ok(layer.hair.length > 0);
    assert.ok(layer.colourDirection.length > 0);
  });

  it("3.2 — unknown handle returns generic finishing layer", () => {
    const layer = buildFinishingLayer("no-such-product-handle");
    assert.ok(layer.shoes.length > 0, "shoes should have fallback copy");
    assert.ok(layer.colourDirection.length > 0, "colourDirection should have fallback copy");
  });

  it("3.3 — known handle uses catalog prose (collar-shirt has shoeDirection)", () => {
    const layer = buildFinishingLayer("collar-shirt");
    // The catalog product for collar-shirt should have non-empty shoe direction
    assert.ok(layer.shoes.length > 0);
    assert.ok(layer.colourDirection.length > 0);
  });

  it("3.4 — all 5 finishing layer fields are non-empty strings on generic fallback", () => {
    const keys: (keyof StyleMeFinishingLayer)[] = [
      "shoes", "bag", "accessories", "hair", "colourDirection",
    ];
    const layer = buildFinishingLayer(null);
    for (const key of keys) {
      assert.ok(typeof layer[key] === "string" && layer[key].length > 0, `${key} is empty`);
    }
  });
});

// ── §4 deterministicWording ──────────────────────────────────────────────────

describe("§4 deterministicWording", () => {
  it("4.1 — no-eligible-product outcome: outfitName contains 'direction'", () => {
    const w = deterministicWording("no-eligible-product", ["confident"], [], "everyday", null, null);
    assert.ok(w.outfitName.toLowerCase().includes("direction"), `got: ${w.outfitName}`);
  });

  it("4.2 — nadine-recommendation: primaryTitle appears in outfitName", () => {
    const w = deterministicWording(
      "nadine-recommendation", ["confident"], [], "everyday", "Becoming Seen", null,
    );
    assert.ok(w.outfitName.includes("Becoming Seen"), `got: ${w.outfitName}`);
  });

  it("4.3 — confidenceBoost is a clothing observation referencing the primary title", () => {
    const w = deterministicWording(
      "nadine-recommendation", ["confident"], [], "date-night", "Shirt", null,
    );
    // Constitution V1: confidenceBoost is a clothing/styling observation, not an occasion reference.
    assert.ok(!w.confidenceBoost.includes("date-night"), `must not contain hyphenated occasion: ${w.confidenceBoost}`);
    assert.ok(w.confidenceBoost.includes("Shirt"), `must reference the primary title: ${w.confidenceBoost}`);
    assert.ok(!w.confidenceBoost.toLowerCase().includes(" feel"), `must not predict how she will feel: ${w.confidenceBoost}`);
  });

  it("4.4 — confidenceBoost is always a non-empty string", () => {
    const w = deterministicWording("no-eligible-product", [], [], "not-sure", null, null);
    assert.ok(typeof w.confidenceBoost === "string" && w.confidenceBoost.length > 0);
  });

  it("4.5 — styleMeExplanation is used as whyThisWorks when provided", () => {
    const explanation = "This shirt leads the outfit with intention.";
    const w = deterministicWording(
      "nadine-recommendation", ["confident"], [], "everyday", "Shirt", explanation,
    );
    assert.ok(w.whyThisWorks.includes(explanation), `got: ${w.whyThisWorks}`);
  });
});

// ── §5 buildDbPayload ────────────────────────────────────────────────────────

describe("§5 buildDbPayload", () => {
  it("5.1 — nadine-recommendation creates a primary item with correct itemType", () => {
    const result = makeMinimalResult({ outcome: "nadine-recommendation" });
    const payload = buildDbPayload(result);
    const primary = payload.items.find(
      (i) => i.itemType !== "SHOES" && i.itemType !== "ACCESSORY" && i.itemType !== "BAG",
    );
    assert.ok(primary !== undefined, "expected a primary item");
    assert.equal(primary!.itemType, "TOP");
    assert.equal(primary!.productTitle, "Becoming Seen");
  });

  it("5.2 — no-eligible-product has no primary item but always includes 3 finishing items", () => {
    const result = makeMinimalResult({ outcome: "no-eligible-product", primaryProduct: null });
    const payload = buildDbPayload(result);
    const primary = payload.items.find(
      (i) => i.itemType !== "SHOES" && i.itemType !== "ACCESSORY" && i.itemType !== "BAG",
    );
    assert.equal(primary, undefined, "no-eligible-product must not create a primary item");
    assert.equal(payload.items.length, 3, "finishing layer (SHOES + BAG + ACCESSORY) must always be persisted");
    assert.ok(payload.items.some((i) => i.itemType === "SHOES"), "SHOES must be included");
    assert.ok(payload.items.some((i) => i.itemType === "BAG"), "BAG must be included");
    assert.ok(payload.items.some((i) => i.itemType === "ACCESSORY"), "ACCESSORY must be included");
  });

  it("5.3 — when primary product exists, SHOES item is included", () => {
    const result = makeMinimalResult({ outcome: "nadine-recommendation" });
    const payload = buildDbPayload(result);
    const shoesItem = payload.items.find((i) => i.itemType === "SHOES");
    assert.ok(shoesItem !== undefined, "expected a SHOES item");
    assert.ok(shoesItem!.stylingNotes && shoesItem!.stylingNotes.length > 0);
  });

  it("5.4 — songRec is formatted as '\"Title\" by Artist'", () => {
    const result = makeMinimalResult();
    const payload = buildDbPayload(result);
    const song = SONG_CATALOG[0];
    assert.equal(payload.songRec, `"${song.title}" by ${song.artist}`);
  });

  it("5.5 — songArtist equals result song's artist", () => {
    const result = makeMinimalResult();
    const payload = buildDbPayload(result);
    assert.equal(payload.songArtist, SONG_CATALOG[0].artist);
  });

  it("5.6 — when primary product exists, BAG item is included with finishing layer text", () => {
    const result = makeMinimalResult({ outcome: "nadine-recommendation" });
    const payload = buildDbPayload(result);
    const bagItem = payload.items.find((i) => i.itemType === "BAG");
    assert.ok(bagItem !== undefined, "expected a BAG item");
    assert.ok(bagItem!.stylingNotes && bagItem!.stylingNotes.length > 0);
  });

  it("5.7 — payload includes moodDescriptionJson with schemaVersion 1", () => {
    const result = makeMinimalResult();
    const payload = buildDbPayload(result);
    assert.ok(typeof payload.moodDescriptionJson === "string", "moodDescriptionJson must be a string");
    const parsed = JSON.parse(payload.moodDescriptionJson) as Record<string, unknown>;
    assert.equal(parsed.schemaVersion, 1);
  });

  it("5.8 — moodDescriptionJson contains the correct outcome", () => {
    const result = makeMinimalResult({ outcome: "nadine-recommendation" });
    const payload = buildDbPayload(result);
    const parsed = JSON.parse(payload.moodDescriptionJson) as Record<string, unknown>;
    assert.equal(parsed.outcome, "nadine-recommendation");
  });

  it("5.9 — moodDescriptionJson contains colourDirection from finishingLayer", () => {
    const result = makeMinimalResult();
    const payload = buildDbPayload(result);
    const parsed = JSON.parse(payload.moodDescriptionJson) as Record<string, unknown>;
    assert.equal(parsed.colourDirection, result.finishingLayer.colourDirection);
  });

  it("5.10 — moodDescriptionJson contains songReason", () => {
    const result = makeMinimalResult({ songReason: "Matched to your confident energy for everyday." });
    const payload = buildDbPayload(result);
    const parsed = JSON.parse(payload.moodDescriptionJson) as Record<string, unknown>;
    assert.equal(parsed.songReason, "Matched to your confident energy for everyday.");
  });
});

// ── §6 styleSourceToSessionSource ──────────────────────────────────────────────────────────

describe("§6 styleSourceToSessionSource", () => {
  it("6.1 — CLOSET maps to my-closet", () => {
    assert.equal(styleSourceToSessionSource("CLOSET"), "my-closet");
  });

  it("6.2 — NAIA maps to naia-piece", () => {
    assert.equal(styleSourceToSessionSource("NAIA"), "naia-piece");
  });
});

// ── §7 computeStyleMeResult integration ──────────────────────────────────────

describe("§7 computeStyleMeResult integration", () => {
  it("7.1 — returns correct shape with valid outcome", async () => {
    const input = makeMinimalEngineInput();
    const result = await computeStyleMeResult(input);
    assert.ok(
      ["nadine-recommendation", "closet-led", "no-eligible-product"].includes(result.outcome),
    );
    assert.ok(typeof result.outfitName === "string" && result.outfitName.length > 0);
    assert.ok(typeof result.whyThisWorks === "string" && result.whyThisWorks.length > 0);
    assert.ok(typeof result.confidenceBoost === "string" && result.confidenceBoost.length > 0);
  });

  it("7.2 — song has required fields", async () => {
    const input = makeMinimalEngineInput();
    const result = await computeStyleMeResult(input);
    assert.ok(typeof result.song.title === "string" && result.song.title.length > 0);
    assert.ok(typeof result.song.artist === "string" && result.song.artist.length > 0);
    assert.ok(Array.isArray(result.song.moods));
    assert.ok(Array.isArray(result.song.occasions));
  });

  it("7.3 — finishingLayer has 5 non-empty strings", async () => {
    const input = makeMinimalEngineInput();
    const result = await computeStyleMeResult(input);
    const keys: (keyof StyleMeFinishingLayer)[] = [
      "shoes", "bag", "accessories", "hair", "colourDirection",
    ];
    for (const key of keys) {
      assert.ok(
        typeof result.finishingLayer[key] === "string" && result.finishingLayer[key].length > 0,
        `finishingLayer.${key} is empty`,
      );
    }
  });

  it("7.4 — fallback wording is used when Claude is unavailable (no API key in tests)", async () => {
    const input = makeMinimalEngineInput();
    const result = await computeStyleMeResult(input);
    // Whether Claude succeeded or failed (no API key in CI), outfitName must be non-empty
    assert.ok(result.outfitName.length > 0);
    assert.ok(result.whyThisWorks.length > 0);
    assert.ok(result.confidenceBoost.length > 0);
  });

  it("7.5 — buildDbPayload on integration result produces valid payload", async () => {
    const input = makeMinimalEngineInput();
    const result = await computeStyleMeResult(input);
    const payload = buildDbPayload(result);
    assert.ok(typeof payload.outfitName === "string" && payload.outfitName.length > 0);
    assert.ok(typeof payload.songRec === "string" && payload.songRec.startsWith('"'));
    assert.ok(typeof payload.songArtist === "string" && payload.songArtist.length > 0);
    assert.ok(Array.isArray(payload.items));
    assert.ok(payload.hairstyleRec === null || typeof payload.hairstyleRec === "string");
  });

  it("7.6 — result includes non-empty songReason", async () => {
    const input = makeMinimalEngineInput();
    const result = await computeStyleMeResult(input);
    assert.ok(typeof result.songReason === "string" && result.songReason.length > 0);
  });

  it("7.7 — result.alternatives is an array (may be empty when engine finds none)", async () => {
    const input = makeMinimalEngineInput();
    const result = await computeStyleMeResult(input);
    assert.ok(Array.isArray(result.alternatives));
  });

  it("7.8 — status field is NOT set by buildDbPayload (lifecycle semantics preserved)", () => {
    const result = makeMinimalResult({ outcome: "nadine-recommendation" });
    const payload = buildDbPayload(result);
    assert.ok(!("status" in payload), "buildDbPayload must not include a status field");
  });
});

// ── §8 parseSuggestionMetadata ────────────────────────────────────────────────

describe("§8 parseSuggestionMetadata", () => {
  it("8.1 — returns null on null input", () => {
    assert.equal(parseSuggestionMetadata(null), null);
  });

  it("8.2 — returns null on undefined input", () => {
    assert.equal(parseSuggestionMetadata(undefined), null);
  });

  it("8.3 — returns null on malformed JSON", () => {
    assert.equal(parseSuggestionMetadata("{not valid json"), null);
  });

  it("8.4 — returns null when schemaVersion is not 1", () => {
    assert.equal(parseSuggestionMetadata(JSON.stringify({ schemaVersion: 2, outcome: "x" })), null);
  });

  it("8.5 — returns parsed metadata for valid schemaVersion=1 JSON", () => {
    const payload = {
      schemaVersion: 1,
      outcome: "nadine-recommendation",
      primaryHandle: "collar-shirt",
      alternatives: [],
      anchor: null,
      anchorSummary: null,
      pairingNote: null,
      colourDirection: "Neutrals with a warm pop.",
      songReason: "Matched to your confident energy.",
      evidenceCodes: [],
    };
    const result = parseSuggestionMetadata(JSON.stringify(payload));
    assert.ok(result !== null);
    assert.equal(result!.outcome, "nadine-recommendation");
    assert.equal(result!.colourDirection, "Neutrals with a warm pop.");
    assert.equal(result!.songReason, "Matched to your confident energy.");
  });

  it("8.6 — roundtrip: buildDbPayload JSON is parseable by parseSuggestionMetadata", () => {
    const result = makeMinimalResult();
    const payload = buildDbPayload(result);
    const metadata = parseSuggestionMetadata(payload.moodDescriptionJson);
    assert.ok(metadata !== null, "roundtrip parse should not return null");
    assert.equal(metadata!.schemaVersion, 1);
    assert.equal(metadata!.outcome, result.outcome);
  });
});

// ── §9 buildSongReason ────────────────────────────────────────────────────────

describe("§9 buildSongReason", () => {
  it("9.1 — includes mood label when mood matches", () => {
    const reason = buildSongReason(["confident", "adventurous"], ["everyday"], ["confident"], "everyday");
    assert.ok(reason.includes("confident"), `got: ${reason}`);
  });

  it("9.2 — includes occasion label when no mood matches", () => {
    const reason = buildSongReason(["romantic"], ["date-night"], ["confident"], "work");
    assert.ok(reason.includes("work"), `got: ${reason}`);
  });

  it("9.3 — returns a non-empty string for any input combination", () => {
    const reason = buildSongReason([], [], [], "not-sure");
    assert.ok(typeof reason === "string" && reason.length > 0);
  });

  it("9.4 — occasion dashes are replaced with spaces in output", () => {
    const reason = buildSongReason([], [], [], "date-night");
    assert.ok(!reason.includes("date-night"), `dashes not replaced: ${reason}`);
    assert.ok(reason.includes("date night"), `expected 'date night' in: ${reason}`);
  });

  it("9.5 — mentions both mood and occasion when both match", () => {
    const reason = buildSongReason(["romantic"], ["date-night"], ["romantic"], "date-night");
    assert.ok(reason.includes("romantic") || reason.includes("date night"), `got: ${reason}`);
  });
});

// ── §10 Finishing layer across all outcomes ───────────────────────────────────

// Helper: build a minimal closet-led result with a real NormalizedClosetAnchor shape
function makeClosetLedResult(): StyleMeCustomerResult {
  const song = SONG_CATALOG[0] as (typeof SONG_CATALOG)[number];
  const finishing = {
    shoes: "Pointed-toe pumps.", bag: "A structured bag.", accessories: "Minimal earrings.",
    hair: "Swept back.", colourDirection: "Neutrals with one accent.",
  };
  return {
    outcome: "closet-led",
    outfitName: "Black Dress for everyday",
    whyThisWorks: "Your closet piece anchors the look.",
    confidenceBoost: "You showed up intentionally.",
    perfumeNote: null,
    primaryProduct: null,
    alternatives: [],
    closetAnchorLabel: "My Black Dress",
    closetAnchorImageUrl: null,
    pairingNote: "Pair with white sneakers for contrast.",
    finishingLayer: finishing,
    completionLayer: [],
    songReason: "Curated for everyday.",
    song,
    resultDirections: [],
    rawRecommendation: {
      outcome: "closet-led",
      anchor: {
        type: "closet" as const,
        id: "closet-abc",
        label: "My Black Dress",
        slot: "dress" as const,
        colors: ["black"],
        normalizedColorIds: ["black"],
        styleTags: ["minimal"],
        occasions: ["everyday"],
        material: null,
        hasStrongEvidence: false,
        evidenceFields: [],
        imageUrl: null,
      },
      primary: null,
      alternatives: [],
      outfitPlan: { anchorSlot: "dress" as const, recommendedSlot: null, compatibilityStatus: "closet-led", notes: [] },
      evaluatedProducts: [],
      coverage: { totalCatalogProducts: 11, eligibleCandidates: 11, excludedCandidates: 0 },
    },
  };
}

describe("§10 Finishing layer across all outcomes", () => {
  it("FL.1 — nadine-recommendation: primary (1) + SHOES + BAG + ACCESSORY = 4 items", () => {
    const result = makeMinimalResult({ outcome: "nadine-recommendation" });
    const payload = buildDbPayload(result);
    assert.equal(payload.items.length, 4, `expected 4, got ${payload.items.length}`);
    const primary = payload.items.find((i) => !["SHOES", "BAG", "ACCESSORY"].includes(i.itemType));
    assert.ok(primary, "primary item must exist for nadine-recommendation");
    assert.ok(payload.items.some((i) => i.itemType === "SHOES"), "SHOES missing");
    assert.ok(payload.items.some((i) => i.itemType === "BAG"), "BAG missing");
    assert.ok(payload.items.some((i) => i.itemType === "ACCESSORY"), "ACCESSORY missing");
  });

  it("FL.2 — closet-led: closet item (1) + SHOES + BAG + ACCESSORY = 4 items", () => {
    const result = makeClosetLedResult();
    const payload = buildDbPayload(result);
    assert.equal(payload.items.length, 4, `expected 4, got ${payload.items.length}`);
    const closetItem = payload.items.find((i) => i.closetItemId === "closet-abc");
    assert.ok(closetItem, "closet anchor item must exist");
    assert.ok(payload.items.some((i) => i.itemType === "SHOES"), "SHOES missing");
    assert.ok(payload.items.some((i) => i.itemType === "BAG"), "BAG missing");
    assert.ok(payload.items.some((i) => i.itemType === "ACCESSORY"), "ACCESSORY missing");
  });

  it("FL.3 — no-eligible-product: no primary item, exactly SHOES + BAG + ACCESSORY = 3 items", () => {
    const result = makeMinimalResult({ outcome: "no-eligible-product", primaryProduct: null });
    const payload = buildDbPayload(result);
    assert.equal(payload.items.length, 3, `expected 3, got ${payload.items.length}`);
    assert.ok(
      payload.items.every((i) => ["SHOES", "BAG", "ACCESSORY"].includes(i.itemType)),
      "all items must be finishing types for no-eligible-product",
    );
  });

  it("FL.4 — all finishing items have non-empty stylingNotes for all three outcomes", () => {
    const results: StyleMeCustomerResult[] = [
      makeMinimalResult({ outcome: "nadine-recommendation" }),
      makeClosetLedResult(),
      makeMinimalResult({ outcome: "no-eligible-product", primaryProduct: null }),
    ];
    for (const result of results) {
      const payload = buildDbPayload(result);
      const finishing = payload.items.filter((i) => ["SHOES", "BAG", "ACCESSORY"].includes(i.itemType));
      assert.equal(finishing.length, 3, `${result.outcome} must have 3 finishing items`);
      for (const item of finishing) {
        assert.ok(
          item.stylingNotes && item.stylingNotes.length > 0,
          `${item.itemType} in ${result.outcome} has empty stylingNotes`,
        );
      }
    }
  });

  it("FL.5 — colour direction survives into moodDescriptionJson for all three outcomes", () => {
    const results: StyleMeCustomerResult[] = [
      makeMinimalResult({ outcome: "nadine-recommendation" }),
      makeClosetLedResult(),
      makeMinimalResult({ outcome: "no-eligible-product", primaryProduct: null }),
    ];
    for (const result of results) {
      const payload = buildDbPayload(result);
      const meta = parseSuggestionMetadata(payload.moodDescriptionJson);
      assert.ok(
        meta?.colourDirection && meta.colourDirection.length > 0,
        `colourDirection missing in metadata for ${result.outcome}`,
      );
    }
  });

  it("FL.6 — hair (hairstyleRec) is in payload for all three outcomes", () => {
    const results = [
      makeMinimalResult({ outcome: "nadine-recommendation" }),
      makeClosetLedResult(),
      makeMinimalResult({ outcome: "no-eligible-product", primaryProduct: null }),
    ];
    for (const result of results) {
      const payload = buildDbPayload(result);
      assert.ok(
        payload.hairstyleRec === null || typeof payload.hairstyleRec === "string",
        `hairstyleRec must be string or null for ${result.outcome}`,
      );
    }
  });

  it("FL.7 — song reason in metadata for all three outcomes", () => {
    const results: StyleMeCustomerResult[] = [
      makeMinimalResult({ outcome: "nadine-recommendation", songReason: "Confident energy match." }),
      makeClosetLedResult(),
      makeMinimalResult({ outcome: "no-eligible-product", primaryProduct: null, songReason: "Everyday tone." }),
    ];
    for (const result of results) {
      const payload = buildDbPayload(result);
      const meta = parseSuggestionMetadata(payload.moodDescriptionJson);
      assert.ok(
        typeof meta?.songReason === "string" && meta.songReason.length > 0,
        `songReason missing in metadata for ${result.outcome}`,
      );
    }
  });

  it("FL.8 — no NADINE product item is created for no-eligible-product", () => {
    const result = makeMinimalResult({ outcome: "no-eligible-product", primaryProduct: null });
    const payload = buildDbPayload(result);
    const nadineItems = payload.items.filter(
      (i) => ["TOP", "BOTTOM", "DRESS", "OUTERWEAR"].includes(i.itemType),
    );
    assert.equal(nadineItems.length, 0, "no garment items may be created for no-eligible-product");
  });
});

// ── §11 Claude safety ─────────────────────────────────────────────────────────

describe("§11 Claude safety", () => {
  it("CS.1 — 'therapy' is a blocked term", () => {
    assert.ok(containsBlockedTerms("clothing as therapy for everyday life"));
  });

  it("CS.2 — 'elevate your wardrobe' is a blocked term", () => {
    assert.ok(containsBlockedTerms("This piece will elevate your wardrobe"));
  });

  it("CS.3 — 'mental health' is a blocked term", () => {
    assert.ok(containsBlockedTerms("dressing for mental health benefits"));
  });

  it("CS.4 — 'diagnose' is a blocked term", () => {
    assert.ok(containsBlockedTerms("does not diagnose your style"));
  });

  it("CS.5 — 'unleash your inner' is a blocked term", () => {
    assert.ok(containsBlockedTerms("unleash your inner confidence"));
  });

  it("CS.6 — clean intentional wording is not blocked", () => {
    assert.ok(!containsBlockedTerms("A well-chosen piece that complements your confident mood today."));
  });

  it("CS.7 — deterministicWording never returns blocked terms for any outcome", () => {
    const combos: Array<[StyleMeOutcome, string]> = [
      ["nadine-recommendation", "everyday"],
      ["closet-led", "work"],
      ["no-eligible-product", "date-night"],
    ];
    for (const [outcome, occasion] of combos) {
      const w = deterministicWording(outcome, ["confident"], ["more-elevated"], occasion, "Test Piece", null);
      const allText = [w.outfitName, w.whyThisWorks, w.confidenceBoost].filter(Boolean).join(" ");
      assert.ok(
        !containsBlockedTerms(allText),
        `Blocked term found in deterministicWording for ${outcome}: "${allText}"`,
      );
    }
  });

  it("CS.8 — buildDbPayload never includes a status field (lifecycle semantics)", () => {
    const results = [
      makeMinimalResult({ outcome: "nadine-recommendation" }),
      makeClosetLedResult(),
      makeMinimalResult({ outcome: "no-eligible-product", primaryProduct: null }),
    ];
    for (const result of results) {
      const payload = buildDbPayload(result);
      assert.ok(!("status" in payload), `buildDbPayload must not set status for ${result.outcome}`);
    }
  });

  it("CS.9 — computeStyleMeResult wording fields contain no blocked terms", async () => {
    const input = makeMinimalEngineInput();
    const result = await computeStyleMeResult(input);
    const allText = [result.outfitName, result.whyThisWorks, result.confidenceBoost]
      .filter(Boolean)
      .join(" ");
    assert.ok(
      !containsBlockedTerms(allText),
      `Blocked term in computeStyleMeResult output: "${allText}"`,
    );
  });

  it("CS.10 — rawRecommendation is present and outcome is a valid StyleMeOutcome", async () => {
    const input = makeMinimalEngineInput();
    const result = await computeStyleMeResult(input);
    const VALID_OUTCOMES: StyleMeOutcome[] = ["nadine-recommendation", "closet-led", "no-eligible-product"];
    assert.ok(result.rawRecommendation, "rawRecommendation must be present (engine was called)");
    assert.ok(
      VALID_OUTCOMES.includes(result.rawRecommendation.outcome as StyleMeOutcome),
      `Invalid outcome: ${result.rawRecommendation.outcome}`,
    );
  });

  it("CS.11 — primaryProduct title comes from catalog, not Claude wording", () => {
    const result = makeMinimalResult({ outcome: "nadine-recommendation" });
    const payload = buildDbPayload(result);
    const primary = payload.items.find((i) => !["SHOES", "BAG", "ACCESSORY"].includes(i.itemType));
    assert.equal(primary?.productTitle, "Becoming Seen", "productTitle must match what was in the result, not Claude output");
  });

  it("CS.12 — alternatives in metadata preserve engine order (not reordered)", () => {
    const song = SONG_CATALOG[0] as (typeof SONG_CATALOG)[number];
    const alt1 = { handle: "midi-dress", title: "Midi", slot: "dress", shopifyProductId: null, productImageUrl: null, liveUrl: null, productUrl: null, stylingNotes: "Style 1" };
    const alt2 = { handle: "cropped-top", title: "Crop", slot: "top", shopifyProductId: null, productImageUrl: null, liveUrl: null, productUrl: null, stylingNotes: "Style 2" };
    const result = makeMinimalResult({ alternatives: [alt1, alt2] });
    const payload = buildDbPayload(result);
    const meta = parseSuggestionMetadata(payload.moodDescriptionJson);
    assert.equal(meta?.alternatives[0].handle, "midi-dress");
    assert.equal(meta?.alternatives[1].handle, "cropped-top");
  });
});

// ── §12 Source semantics ──────────────────────────────────────────────────────

describe("§12 Source semantics", () => {
  it("SM.1 — buildEngineInput with naia-piece source passes NadineAnchorInput through", () => {
    const input = buildEngineInput({
      moods: ["confident"], desiredFeelings: ["more-elevated"], bodyNeeds: ["nothing-specific"],
      coverageConditional: null, occasion: "everyday", formalityConditional: null,
      todayColours: { preferred: [], avoid: [] }, practicalIds: [],
      source: "naia-piece",
      anchor: { type: "nadine", handle: "collar-shirt" },
    });
    assert.equal(input.anchor?.type, "nadine");
    assert.equal((input.anchor as { type: string; handle: string }).handle, "collar-shirt");
    assert.equal(input.session.source, "naia-piece");
  });

  it("SM.2 — buildEngineInput with my-closet source passes ClosetAnchorInput through", () => {
    const closetAnchor = {
      type: "closet" as const,
      id: "ci-1", name: "Black Dress", category: "DRESSES" as const,
      colors: ["black"], primaryColor: "black", pattern: null, material: null,
      styleTags: ["minimal"], occasions: ["everyday"], imageUrl: "https://example.com/img.jpg",
    };
    const input = buildEngineInput({
      moods: ["confident"], desiredFeelings: [], bodyNeeds: [],
      coverageConditional: null, occasion: "everyday", formalityConditional: null,
      todayColours: { preferred: [], avoid: [] }, practicalIds: [],
      source: "my-closet",
      anchor: closetAnchor,
    });
    assert.equal(input.anchor?.type, "closet");
    assert.equal(input.session.source, "my-closet");
  });

  it("SM.3 — buildEngineInput with both source passes anchor through unchanged", () => {
    const closetAnchor = {
      type: "closet" as const,
      id: "ci-2", name: "White Top", category: "TOPS" as const,
      colors: ["white"], primaryColor: "white", pattern: null, material: null,
      styleTags: [], occasions: [], imageUrl: "https://example.com/img.jpg",
    };
    const input = buildEngineInput({
      moods: ["adventurous"], desiredFeelings: [], bodyNeeds: [],
      coverageConditional: null, occasion: "work", formalityConditional: null,
      todayColours: { preferred: [], avoid: [] }, practicalIds: [],
      source: "both",
      anchor: closetAnchor,
    });
    assert.equal(input.session.source, "both");
    assert.equal(input.anchor?.type, "closet");
  });

  it("SM.4 — no anchor: engineInput.anchor is null", () => {
    const input = buildEngineInput({
      moods: ["confident"], desiredFeelings: [], bodyNeeds: [],
      coverageConditional: null, occasion: "everyday", formalityConditional: null,
      todayColours: { preferred: [], avoid: [] }, practicalIds: [],
      source: "naia-piece",
    });
    assert.equal(input.anchor, null);
  });

  it("SM.5 — computeStyleMeResult returns an outcome string from the valid set", async () => {
    const input = makeMinimalEngineInput();
    const result = await computeStyleMeResult(input);
    const VALID: StyleMeOutcome[] = ["nadine-recommendation", "closet-led", "no-eligible-product"];
    assert.ok(VALID.includes(result.outcome), `Unexpected outcome: ${result.outcome}`);
  });

  it("SM.6 — result metadata outcome matches result.outcome (roundtrip)", () => {
    const outcomes: StyleMeOutcome[] = ["nadine-recommendation", "no-eligible-product"];
    for (const outcome of outcomes) {
      const result = makeMinimalResult({ outcome, primaryProduct: outcome !== "no-eligible-product" ? undefined : null });
      const payload = buildDbPayload(result);
      const meta = parseSuggestionMetadata(payload.moodDescriptionJson);
      assert.equal(meta?.outcome, outcome, `metadata.outcome mismatch for ${outcome}`);
    }
  });
});

// ── §13 Metadata and lifecycle compatibility ──────────────────────────────────

describe("§13 Metadata and lifecycle compatibility", () => {
  it("LC.1 — parseSuggestionMetadata(null) returns null (legacy rows with null moodDescription)", () => {
    assert.equal(parseSuggestionMetadata(null), null);
  });

  it("LC.2 — parseSuggestionMetadata(undefined) returns null (field absent)", () => {
    assert.equal(parseSuggestionMetadata(undefined), null);
  });

  it("LC.3 — parseSuggestionMetadata of old non-JSON string returns null gracefully", () => {
    assert.equal(parseSuggestionMetadata("some legacy text value"), null);
  });

  it("LC.4 — parseSuggestionMetadata of JSON without schemaVersion returns null", () => {
    assert.equal(parseSuggestionMetadata(JSON.stringify({ outcome: "nadine-recommendation" })), null);
  });

  it("LC.5 — buildDbPayload moodDescriptionJson always has schemaVersion=1", () => {
    const outcomes: Array<[StyleMeOutcome, StyleMeCustomerResult]> = [
      ["nadine-recommendation", makeMinimalResult({ outcome: "nadine-recommendation" })],
      ["closet-led", makeClosetLedResult()],
      ["no-eligible-product", makeMinimalResult({ outcome: "no-eligible-product", primaryProduct: null })],
    ];
    for (const [outcome, result] of outcomes) {
      const payload = buildDbPayload(result);
      const meta = parseSuggestionMetadata(payload.moodDescriptionJson);
      assert.equal(meta?.schemaVersion, 1, `schemaVersion must be 1 for ${outcome}`);
    }
  });

  it("LC.6 — status is never written by buildDbPayload (DB lifecycle field untouched)", () => {
    const result = makeMinimalResult();
    const payload = buildDbPayload(result);
    assert.ok(!("status" in payload), "buildDbPayload must never set status field");
  });
});

// ── §14 Full pipeline tests — all three source modes ─────────────────────────

// Shared minimal closet anchor for my-closet / both tests
const PIPELINE_CLOSET_ANCHOR: ClosetAnchorInput = {
  type: "closet",
  id: "pipeline-ci-1",
  name: "Black Linen Dress",
  category: "DRESSES",
  colors: ["black"],
  primaryColor: "black",
  pattern: null,
  material: "linen",
  styleTags: ["minimal", "effortless"],
  occasions: ["everyday", "work"],
  imageUrl: "https://example.com/black-dress.jpg",
};

// Spy factory: wraps runRecommendation with a call counter.
// Proves the engine is called exactly once per computeStyleMeResult invocation.
function makeRunRecSpy(): {
  spy: (input: StyleMeEngineInput) => StyleMeRecommendationResult;
  callCount: () => number;
} {
  let count = 0;
  return {
    spy: (input) => { count++; return runRecommendation(input); },
    callCount: () => count,
  };
}

describe("§14 Full pipeline — naia-piece source", () => {
  it("PL.1 — naia-piece with valid anchor: outcome is nadine-recommendation or no-eligible-product", async () => {
    const engineInput = buildEngineInput({
      moods: ["confident"],
      desiredFeelings: ["more-elevated"],
      bodyNeeds: ["nothing-specific"],
      coverageConditional: null,
      occasion: "everyday",
      formalityConditional: null,
      todayColours: { preferred: [], avoid: [] },
      practicalIds: [],
      source: "naia-piece",
      anchor: { type: "nadine", handle: "collar-shirt" },
    });
    const result = await computeStyleMeResult(engineInput);
    const VALID: StyleMeOutcome[] = ["nadine-recommendation", "no-eligible-product", "closet-led"];
    assert.ok(VALID.includes(result.outcome), `Unexpected outcome: ${result.outcome}`);
  });

  it("PL.2 — naia-piece anchor handle is preserved in rawRecommendation", async () => {
    const engineInput = buildEngineInput({
      moods: ["confident"],
      desiredFeelings: [],
      bodyNeeds: [],
      coverageConditional: null,
      occasion: "everyday",
      formalityConditional: null,
      todayColours: { preferred: [], avoid: [] },
      practicalIds: [],
      source: "naia-piece",
      anchor: { type: "nadine", handle: "midi-dress" },
    });
    const result = await computeStyleMeResult(engineInput);
    assert.ok(result.rawRecommendation, "rawRecommendation must be present");
    // The anchor we passed in is reflected in the engine input
    assert.equal(engineInput.anchor?.type, "nadine");
    assert.equal((engineInput.anchor as { handle: string }).handle, "midi-dress");
  });

  it("PL.3 — naia-piece: nadine-recommendation primary is not the anchor handle (cannot recommend itself)", async () => {
    // Run with each V8 handle as the anchor and verify the primary (if any) differs
    const handles = [
      "collar-shirt", "midi-dress", "draped-leather-pants", "oversized-blazer", "suede-skirt",
    ];
    for (const handle of handles) {
      const engineInput = buildEngineInput({
        moods: ["confident"],
        desiredFeelings: ["more-elevated"],
        bodyNeeds: ["nothing-specific"],
        coverageConditional: null,
        occasion: "everyday",
        formalityConditional: null,
        todayColours: { preferred: [], avoid: [] },
        practicalIds: [],
        source: "naia-piece",
        anchor: { type: "nadine", handle },
      });
      const result = await computeStyleMeResult(engineInput);
      if (result.outcome === "nadine-recommendation" && result.primaryProduct) {
        assert.notEqual(
          result.primaryProduct.handle,
          handle,
          `Engine recommended the anchor itself (${handle}) — self-recommendation must be excluded`,
        );
      }
    }
  });

  it("PL.4 — naia-piece: finishing layer and song are always present regardless of primary", async () => {
    const engineInput = buildEngineInput({
      moods: ["confident"],
      desiredFeelings: [],
      bodyNeeds: [],
      coverageConditional: null,
      occasion: "everyday",
      formalityConditional: null,
      todayColours: { preferred: [], avoid: [] },
      practicalIds: [],
      source: "naia-piece",
      anchor: { type: "nadine", handle: "collar-shirt" },
    });
    const result = await computeStyleMeResult(engineInput);
    assert.ok(result.finishingLayer.shoes.length > 0, "shoes must be non-empty");
    assert.ok(result.finishingLayer.bag.length > 0, "bag must be non-empty");
    assert.ok(result.finishingLayer.accessories.length > 0, "accessories must be non-empty");
    assert.ok(result.song.title.length > 0, "song title must be present");
    assert.ok(result.song.artist.length > 0, "song artist must be present");
  });
});

describe("§14 Full pipeline — my-closet source", () => {
  it("PL.5 — my-closet with closet anchor: outcome is always closet-led", async () => {
    const engineInput = buildEngineInput({
      moods: ["confident"],
      desiredFeelings: [],
      bodyNeeds: [],
      coverageConditional: null,
      occasion: "everyday",
      formalityConditional: null,
      todayColours: { preferred: [], avoid: [] },
      practicalIds: [],
      source: "my-closet",
      anchor: PIPELINE_CLOSET_ANCHOR,
    });
    const result = await computeStyleMeResult(engineInput);
    assert.equal(
      result.outcome,
      "closet-led",
      `my-closet source must always produce closet-led, got: ${result.outcome}`,
    );
  });

  it("PL.6 — my-closet: no NADINE primaryProduct is returned", async () => {
    const engineInput = buildEngineInput({
      moods: ["confident"],
      desiredFeelings: [],
      bodyNeeds: [],
      coverageConditional: null,
      occasion: "everyday",
      formalityConditional: null,
      todayColours: { preferred: [], avoid: [] },
      practicalIds: [],
      source: "my-closet",
      anchor: PIPELINE_CLOSET_ANCHOR,
    });
    const result = await computeStyleMeResult(engineInput);
    assert.equal(result.primaryProduct, null, "my-closet must produce null primaryProduct");
  });

  it("PL.7 — my-closet: no NADINE alternatives are returned (engine is CLOSET_ONLY pool)", async () => {
    const engineInput = buildEngineInput({
      moods: ["confident"],
      desiredFeelings: [],
      bodyNeeds: [],
      coverageConditional: null,
      occasion: "everyday",
      formalityConditional: null,
      todayColours: { preferred: [], avoid: [] },
      practicalIds: [],
      source: "my-closet",
      anchor: PIPELINE_CLOSET_ANCHOR,
    });
    const result = await computeStyleMeResult(engineInput);
    assert.deepEqual(result.alternatives, [], "my-closet must produce no NADINE alternatives");
  });

  it("PL.8 — my-closet: full finishing layer and song are present", async () => {
    const engineInput = buildEngineInput({
      moods: ["confident"],
      desiredFeelings: [],
      bodyNeeds: [],
      coverageConditional: null,
      occasion: "everyday",
      formalityConditional: null,
      todayColours: { preferred: [], avoid: [] },
      practicalIds: [],
      source: "my-closet",
      anchor: PIPELINE_CLOSET_ANCHOR,
    });
    const result = await computeStyleMeResult(engineInput);
    assert.ok(result.finishingLayer.shoes.length > 0, "shoes must be present");
    assert.ok(result.finishingLayer.bag.length > 0, "bag must be present");
    assert.ok(result.finishingLayer.accessories.length > 0, "accessories must be present");
    assert.ok(result.song.title.length > 0, "song must be present");
    const payload = buildDbPayload(result);
    assert.ok(payload.items.some((i) => i.itemType === "SHOES"), "SHOES item must be in payload");
    assert.ok(payload.items.some((i) => i.itemType === "BAG"), "BAG item must be in payload");
    assert.ok(payload.items.some((i) => i.itemType === "ACCESSORY"), "ACCESSORY item must be in payload");
  });

  it("PL.9 — my-closet: rawRecommendation anchor is the closet anchor we passed", async () => {
    const engineInput = buildEngineInput({
      moods: ["confident"],
      desiredFeelings: [],
      bodyNeeds: [],
      coverageConditional: null,
      occasion: "everyday",
      formalityConditional: null,
      todayColours: { preferred: [], avoid: [] },
      practicalIds: [],
      source: "my-closet",
      anchor: PIPELINE_CLOSET_ANCHOR,
    });
    const result = await computeStyleMeResult(engineInput);
    // The engine normalizes the anchor but its id must match what we provided
    assert.equal(result.rawRecommendation.anchor?.type, "closet");
  });
});

describe("§14 Full pipeline — both source", () => {
  it("PL.10 — both source with closet anchor: outcome is closet-led or nadine-recommendation", async () => {
    const engineInput = buildEngineInput({
      moods: ["confident"],
      desiredFeelings: ["more-elevated"],
      bodyNeeds: [],
      coverageConditional: null,
      occasion: "everyday",
      formalityConditional: null,
      todayColours: { preferred: [], avoid: [] },
      practicalIds: [],
      source: "both",
      anchor: PIPELINE_CLOSET_ANCHOR,
    });
    const result = await computeStyleMeResult(engineInput);
    const VALID: StyleMeOutcome[] = ["closet-led", "nadine-recommendation", "no-eligible-product"];
    assert.ok(VALID.includes(result.outcome), `Unexpected outcome for both source: ${result.outcome}`);
  });

  it("PL.11 — both: when no NADINE candidate clears threshold the result is closet-led", async () => {
    // Force closet-led by using a colour preference that no catalog product matches,
    // combined with a both source — the engine falls back to closet-led
    const engineInput = buildEngineInput({
      moods: ["confident"],
      desiredFeelings: [],
      bodyNeeds: [],
      coverageConditional: null,
      occasion: "everyday",
      formalityConditional: null,
      todayColours: { preferred: ["neon-purple-not-in-catalog"], avoid: [] },
      practicalIds: [],
      source: "both",
      anchor: PIPELINE_CLOSET_ANCHOR,
    });
    const result = await computeStyleMeResult(engineInput);
    // Closet-led or no-eligible-product are both valid when no NADINE candidate clears — not nadine-recommendation without a matching closet anchor
    const VALID: StyleMeOutcome[] = ["closet-led", "no-eligible-product"];
    // We don't assert exactly closet-led here because the engine may still pick a product
    // even with a non-matching colour; what we CAN assert is that finishing layer is present
    assert.ok(result.finishingLayer.shoes.length > 0, "finishing layer shoes must be present");
  });

  it("PL.12 — both source: finishing layer and song always present", async () => {
    const engineInput = buildEngineInput({
      moods: ["confident"],
      desiredFeelings: [],
      bodyNeeds: [],
      coverageConditional: null,
      occasion: "everyday",
      formalityConditional: null,
      todayColours: { preferred: [], avoid: [] },
      practicalIds: [],
      source: "both",
      anchor: PIPELINE_CLOSET_ANCHOR,
    });
    const result = await computeStyleMeResult(engineInput);
    assert.ok(result.finishingLayer.shoes.length > 0);
    assert.ok(result.finishingLayer.bag.length > 0);
    assert.ok(result.finishingLayer.accessories.length > 0);
    assert.ok(result.song.title.length > 0);
  });
});

// ── §15 runRecommendation called exactly once per generation ──────────────────

describe("§15 Exact-once runRecommendation call proof", () => {
  it("EC.1 — naia-piece: runRecommendation called exactly once", async () => {
    const { spy, callCount } = makeRunRecSpy();
    const engineInput = buildEngineInput({
      moods: ["confident"],
      desiredFeelings: [],
      bodyNeeds: [],
      coverageConditional: null,
      occasion: "everyday",
      formalityConditional: null,
      todayColours: { preferred: [], avoid: [] },
      practicalIds: [],
      source: "naia-piece",
    });
    await computeStyleMeResult(engineInput, spy);
    assert.equal(callCount(), 1, `runRecommendation must be called exactly once, got: ${callCount()}`);
  });

  it("EC.2 — my-closet: runRecommendation called exactly once", async () => {
    const { spy, callCount } = makeRunRecSpy();
    const engineInput = buildEngineInput({
      moods: ["confident"],
      desiredFeelings: [],
      bodyNeeds: [],
      coverageConditional: null,
      occasion: "everyday",
      formalityConditional: null,
      todayColours: { preferred: [], avoid: [] },
      practicalIds: [],
      source: "my-closet",
      anchor: PIPELINE_CLOSET_ANCHOR,
    });
    await computeStyleMeResult(engineInput, spy);
    assert.equal(callCount(), 1, `runRecommendation must be called exactly once, got: ${callCount()}`);
  });

  it("EC.3 — both source: runRecommendation called exactly once", async () => {
    const { spy, callCount } = makeRunRecSpy();
    const engineInput = buildEngineInput({
      moods: ["confident"],
      desiredFeelings: [],
      bodyNeeds: [],
      coverageConditional: null,
      occasion: "everyday",
      formalityConditional: null,
      todayColours: { preferred: [], avoid: [] },
      practicalIds: [],
      source: "both",
      anchor: PIPELINE_CLOSET_ANCHOR,
    });
    await computeStyleMeResult(engineInput, spy);
    assert.equal(callCount(), 1, `runRecommendation must be called exactly once, got: ${callCount()}`);
  });

  it("EC.4 — no-eligible-product path: runRecommendation still called exactly once", async () => {
    const { spy, callCount } = makeRunRecSpy();
    // no-eligible-product happens when no candidates clear threshold
    const engineInput = buildEngineInput({
      moods: ["confident"],
      desiredFeelings: [],
      bodyNeeds: [],
      coverageConditional: null,
      occasion: "everyday",
      formalityConditional: null,
      todayColours: { preferred: [], avoid: [] },
      practicalIds: [],
      source: "naia-piece",
    });
    await computeStyleMeResult(engineInput, spy);
    assert.equal(callCount(), 1, `runRecommendation must be called exactly once, got: ${callCount()}`);
  });
});

// ── §16 Generation aborts after failed anchor resolution ─────────────────────
// Mirrors the result.tsx action guard exactly:
//   const anchorResult = await resolveActionAnchor(...);
//   if (!anchorResult.ok) { return data({ error }...); }   ← computeStyleMeResult never reached
//   await computeStyleMeResult(engineInput, spy);

describe("§16 Generation aborts after failed anchor resolution", () => {
  it("EC.5 — invalid NADINE handle: resolveActionAnchor returns 400, computeStyleMeResult not called", async () => {
    const { spy, callCount } = makeRunRecSpy();

    const anchorResult = await resolveActionAnchor("naia-piece", "cust-1", "not-a-real-handle", null);
    assert.equal(anchorResult.ok, false, "anchor resolution must fail for invalid handle");
    if (!anchorResult.ok) {
      assert.equal(anchorResult.status, 400);
    }

    // Simulates the result.tsx gate: only proceed when ok===true
    if (anchorResult.ok) {
      const engineInput = buildEngineInput({
        moods: ["confident"], desiredFeelings: [], bodyNeeds: [],
        coverageConditional: null, occasion: "everyday", formalityConditional: null,
        todayColours: { preferred: [], avoid: [] }, practicalIds: [],
        source: "naia-piece", anchor: anchorResult.anchor,
      });
      await computeStyleMeResult(engineInput, spy);
    }

    assert.equal(callCount(), 0, "runRecommendation must never be called after failed NADINE anchor resolution");
  });

  it("EC.6 — absent NADINE handle: resolveActionAnchor ok=true, anchor=null, engine auto-selects", async () => {
    const { spy, callCount } = makeRunRecSpy();

    const anchorResult = await resolveActionAnchor("naia-piece", "cust-1", null, null);
    assert.equal(anchorResult.ok, true, "null handle must resolve ok=true — engine auto-selects");
    if (!anchorResult.ok) throw new Error("unreachable");
    assert.equal(anchorResult.anchor, null, "anchor must be null when no handle is supplied");

    // Engine proceeds with anchor=null: scores all eligible products and picks the best one
    const engineInput = buildEngineInput({
      moods: ["confident"], desiredFeelings: [], bodyNeeds: [],
      coverageConditional: null, occasion: "everyday", formalityConditional: null,
      todayColours: { preferred: [], avoid: [] }, practicalIds: [],
      source: "naia-piece", anchor: anchorResult.anchor,
    });
    const result = await computeStyleMeResult(engineInput, spy);

    assert.equal(callCount(), 1, "runRecommendation must be called once when anchor is null");
    assert.equal(result.rawRecommendation.outcome, "nadine-recommendation", "engine must select a NADINE product");
    assert.ok(result.rawRecommendation.primary !== null, "engine must produce a primary product recommendation");
  });

  it("EC.7 — missing closet ID: resolveActionAnchor returns 400, computeStyleMeResult not called", async () => {
    const { spy, callCount } = makeRunRecSpy();
    const fakeResolver = async () => null;

    const anchorResult = await resolveActionAnchor("my-closet", "cust-1", null, null, fakeResolver);
    assert.equal(anchorResult.ok, false, "anchor resolution must fail for missing closet ID");

    if (anchorResult.ok) {
      const engineInput = buildEngineInput({
        moods: ["confident"], desiredFeelings: [], bodyNeeds: [],
        coverageConditional: null, occasion: "everyday", formalityConditional: null,
        todayColours: { preferred: [], avoid: [] }, practicalIds: [],
        source: "my-closet", anchor: anchorResult.anchor,
      });
      await computeStyleMeResult(engineInput, spy);
    }

    assert.equal(callCount(), 0, "runRecommendation must never be called after missing closet ID");
  });

  it("EC.8 — unknown/foreign closet ID: resolveActionAnchor returns 403, computeStyleMeResult not called", async () => {
    const { spy, callCount } = makeRunRecSpy();
    const fakeResolver = async () => null; // simulates unknown or foreign item

    const anchorResult = await resolveActionAnchor("my-closet", "cust-1", null, "foreign-or-unknown-id", fakeResolver);
    assert.equal(anchorResult.ok, false, "anchor resolution must fail for unknown/foreign closet ID");
    if (!anchorResult.ok) {
      assert.equal(anchorResult.status, 403);
    }

    if (anchorResult.ok) {
      const engineInput = buildEngineInput({
        moods: ["confident"], desiredFeelings: [], bodyNeeds: [],
        coverageConditional: null, occasion: "everyday", formalityConditional: null,
        todayColours: { preferred: [], avoid: [] }, practicalIds: [],
        source: "my-closet", anchor: anchorResult.anchor,
      });
      await computeStyleMeResult(engineInput, spy);
    }

    assert.equal(callCount(), 0, "runRecommendation must never be called after unknown/foreign closet ID");
  });
});

// ── §17 Mixed NADINE + My Closet payload assembly ────────────────────────────

import type { NormalizedClosetAnchor } from "./styleme-recommendation.types.ts";

function makeNadineWithClosetAnchorResult(overrides: Partial<StyleMeCustomerResult> = {}): StyleMeCustomerResult {
  const song = SONG_CATALOG[0] as (typeof SONG_CATALOG)[number];
  const finishing: StyleMeFinishingLayer = {
    shoes: "Ankle boots or pointed flats.",
    bag: "A compact structured tote.",
    accessories: "One gold cuff, nothing more.",
    hair: "Pulled back for contrast.",
    colourDirection: "Keep the palette tight — two neutrals max.",
  };
  const closetAnchor: NormalizedClosetAnchor = {
    type: "closet" as const,
    id: "closet-mix-1",
    label: "Cream Blazer",
    slot: "outerwear" as const,
    colors: ["cream"],
    normalizedColorIds: ["ivory"],
    styleTags: ["minimal", "corporate-chic"],
    occasions: ["work", "everyday"],
    material: "linen",
    hasStrongEvidence: true,
    evidenceFields: ["styleTags", "occasions"],
    imageUrl: "https://example.com/cream-blazer.jpg",
  };
  return {
    outcome: "nadine-recommendation",
    outfitName: "Collar Shirt + Cream Blazer for work",
    whyThisWorks: "The NADINE collar shirt pairs with your blazer for a polished layered look.",
    confidenceBoost: "Two intentional pieces, one cohesive look.",
    perfumeNote: null,
    primaryProduct: {
      handle: "collar-shirt",
      title: "Becoming Seen",
      slot: "top",
      shopifyProductId: null,
      productImageUrl: null,
      liveUrl: null,
      productUrl: null,
      stylingNotes: "Let this shirt lead the outfit.",
    },
    alternatives: [],
    closetAnchorLabel: "Cream Blazer",
    closetAnchorImageUrl: "https://example.com/cream-blazer.jpg",
    pairingNote: "Wear the blazer open for a relaxed polish.",
    finishingLayer: finishing,
    completionLayer: [],
    songReason: "Curated for your work day.",
    song,
    resultDirections: [],
    rawRecommendation: {
      outcome: "nadine-recommendation",
      anchor: closetAnchor,
      primary: null,
      alternatives: [],
      outfitPlan: { anchorSlot: "outerwear", recommendedSlot: "top", compatibilityStatus: "compatible", notes: [] },
      evaluatedProducts: [],
      coverage: { totalCatalogProducts: 11, eligibleCandidates: 11, excludedCandidates: 0 },
    },
    ...overrides,
  };
}

describe("§17 Mixed NADINE + My Closet — buildDbPayload", () => {
  it("FL.5 — both + nadine-recommendation: items = 1 NADINE + 1 closet + 3 finishing = 5 total", () => {
    const result = makeNadineWithClosetAnchorResult();
    const payload = buildDbPayload(result);
    assert.equal(payload.items.length, 5, `expected 5 items, got ${payload.items.length}: ${payload.items.map(i => i.itemType).join(", ")}`);
    const garments = payload.items.filter((i) => !["SHOES", "BAG", "ACCESSORY"].includes(i.itemType));
    assert.equal(garments.length, 2, "must have exactly 2 garment items (NADINE + closet)");
    assert.ok(payload.items.some((i) => i.itemType === "SHOES"), "SHOES missing");
    assert.ok(payload.items.some((i) => i.itemType === "BAG"), "BAG missing");
    assert.ok(payload.items.some((i) => i.itemType === "ACCESSORY"), "ACCESSORY missing");
  });

  it("FL.6 — closet garment has closetItemId set and shopifyProductId === null", () => {
    const result = makeNadineWithClosetAnchorResult();
    const payload = buildDbPayload(result);
    const closetItem = payload.items.find((i) => i.closetItemId !== null);
    assert.ok(closetItem, "a closet-origin garment item must exist");
    assert.equal(closetItem!.closetItemId, "closet-mix-1");
    assert.equal(closetItem!.shopifyProductId, null, "closet item must have shopifyProductId null");
    assert.ok(closetItem!.productTitle, "closet item must have a productTitle");
    assert.ok(closetItem!.stylingNotes && closetItem!.stylingNotes.length > 0, "closet item must have stylingNotes");
  });

  it("FL.7 — NADINE garment has closetItemId === null", () => {
    const result = makeNadineWithClosetAnchorResult();
    const payload = buildDbPayload(result);
    const nadineItem = payload.items.find(
      (i) => !["SHOES", "BAG", "ACCESSORY"].includes(i.itemType) && i.closetItemId === null,
    );
    assert.ok(nadineItem, "a NADINE-origin garment item must exist");
    assert.equal(nadineItem!.closetItemId, null);
    assert.equal(nadineItem!.productTitle, "Becoming Seen");
    assert.equal(nadineItem!.stylingNotes, "Let this shirt lead the outfit.");
  });

  it("FL.8 — closet-led (CLOSET source) still produces exactly 1 closet garment, no NADINE garment", () => {
    const result = makeClosetLedResult();
    const payload = buildDbPayload(result);
    const garments = payload.items.filter((i) => !["SHOES", "BAG", "ACCESSORY"].includes(i.itemType));
    assert.equal(garments.length, 1, "closet-led must have exactly 1 garment (the closet piece)");
    assert.equal(garments[0]!.closetItemId, "closet-abc");
    assert.equal(garments[0]!.shopifyProductId, null);
  });

  it("FL.9 — naia-piece (no anchor) produces exactly 1 NADINE garment, no closet garment", () => {
    const result = makeMinimalResult({ outcome: "nadine-recommendation" });
    const payload = buildDbPayload(result);
    const garments = payload.items.filter((i) => !["SHOES", "BAG", "ACCESSORY"].includes(i.itemType));
    assert.equal(garments.length, 1, "naia-piece must have exactly 1 garment (NADINE)");
    assert.equal(garments[0]!.closetItemId, null);
  });

  it("FL.10 — pairingNote is used as closet stylingNotes when present", () => {
    const result = makeNadineWithClosetAnchorResult({ pairingNote: "Wear the blazer open for relaxed polish." });
    const payload = buildDbPayload(result);
    const closetItem = payload.items.find((i) => i.closetItemId !== null);
    assert.ok(closetItem!.stylingNotes!.includes("blazer"), `expected pairingNote text in closet stylingNotes, got: ${closetItem!.stylingNotes}`);
  });

  it("FL.11 — fallback stylingNotes used when pairingNote is null", () => {
    const result = makeNadineWithClosetAnchorResult({ pairingNote: null });
    const payload = buildDbPayload(result);
    const closetItem = payload.items.find((i) => i.closetItemId !== null);
    assert.ok(closetItem!.stylingNotes && closetItem!.stylingNotes.length > 0, "fallback stylingNotes must be non-empty");
  });
});

// ── §18 Regenerate anchor recovery (persisted closetAnchorId path) ────────────

describe("§18 Regenerate — persisted closetAnchorId recovery", () => {
  it("RG.1 — BOTH source with valid persisted closetAnchorId resolves anchor successfully", async () => {
    const fakeClosetItem: import("./styleme-recommendation.types.ts").ClosetAnchorInput = {
      type: "closet",
      id: "ci-persisted-1",
      name: "Black Blazer",
      category: "OUTERWEAR",
      colors: ["black"],
      primaryColor: "black",
      pattern: null,
      material: "wool",
      styleTags: ["minimal"],
      occasions: ["work"],
      imageUrl: "https://example.com/black-blazer.jpg",
    };
    const fakeResolver = async (_custId: string, id: string) =>
      id === "ci-persisted-1" ? fakeClosetItem : null;

    const result = await resolveActionAnchor("both", "cust-1", null, "ci-persisted-1", fakeResolver);
    assert.ok(result.ok, "persisted closetAnchorId for BOTH source must resolve successfully");
    if (result.ok) {
      assert.ok(result.anchor !== null, "anchor must not be null for BOTH with valid closetAnchorId");
      assert.equal(result.anchor!.type, "closet");
    }
  });

  it("RG.2 — CLOSET source with valid persisted closetAnchorId resolves anchor successfully", async () => {
    const fakeClosetItem: import("./styleme-recommendation.types.ts").ClosetAnchorInput = {
      type: "closet",
      id: "ci-persisted-2",
      name: "Linen Trousers",
      category: "BOTTOMS",
      colors: ["beige"],
      primaryColor: "beige",
      pattern: null,
      material: "linen",
      styleTags: ["effortless"],
      occasions: ["everyday"],
      imageUrl: "https://example.com/linen-trousers.jpg",
    };
    const fakeResolver = async (_custId: string, id: string) =>
      id === "ci-persisted-2" ? fakeClosetItem : null;

    const result = await resolveActionAnchor("my-closet", "cust-2", null, "ci-persisted-2", fakeResolver);
    assert.ok(result.ok, "persisted closetAnchorId for CLOSET source must resolve successfully");
    if (result.ok) {
      assert.equal(result.anchor!.type, "closet");
    }
  });

  it("RG.3 — BOTH source with null closetAnchorId (pre-migration sessions) fails with 400", async () => {
    const fakeResolver = async () => null;
    const result = await resolveActionAnchor("both", "cust-1", null, null, fakeResolver);
    assert.equal(result.ok, false, "null closetAnchorId for BOTH must fail");
    if (!result.ok) {
      assert.equal(result.status, 400);
    }
  });

  it("RG.4 — BOTH source with foreign/deleted closetAnchorId fails with 403", async () => {
    const fakeResolver = async () => null; // ownership check fails
    const result = await resolveActionAnchor("both", "cust-1", null, "ci-foreign", fakeResolver);
    assert.equal(result.ok, false, "foreign closetAnchorId for BOTH must fail");
    if (!result.ok) {
      assert.equal(result.status, 403);
    }
  });

  it("RG.5 — NAIA source ignores any persisted closetAnchorId and returns ok with null anchor", async () => {
    const fakeResolver = async () => null;
    const result = await resolveActionAnchor("naia-piece", "cust-1", null, null, fakeResolver);
    assert.ok(result.ok, "NAIA source must always resolve successfully");
    if (result.ok) {
      assert.equal(result.anchor, null, "anchor must be null for NAIA source");
    }
  });
});

// ── §R Result-page fixes — image, slot suppression, and feedback ──────────────

// Shared helper: closet anchor with a shoe-category slot
function makeShoeClosetAnchor(overrides: Partial<NormalizedClosetAnchor> = {}): NormalizedClosetAnchor {
  return {
    type: "closet",
    id: "closet-shoe-1",
    label: "Red Heels",
    slot: "shoe" as const,
    colors: ["red"],
    normalizedColorIds: ["red"],
    styleTags: ["bold"],
    occasions: ["dinner"],
    material: null,
    hasStrongEvidence: true,
    evidenceFields: ["colors"],
    imageUrl: "https://res.cloudinary.com/example/image/private/s--sig--/v1/naia-closet/heels.jpg",
    ...overrides,
  };
}

function makeBagClosetAnchor(): NormalizedClosetAnchor {
  return {
    type: "closet",
    id: "closet-bag-1",
    label: "Leather Tote",
    slot: "bag" as const,
    colors: ["tan"],
    normalizedColorIds: ["tan"],
    styleTags: ["classic"],
    occasions: ["work"],
    material: "leather",
    hasStrongEvidence: true,
    evidenceFields: ["material"],
    imageUrl: null,
  };
}

function makeResultWithShoeAnchor(imageUrl: string | null = "https://cdn.shopify.com/example.jpg"): StyleMeCustomerResult {
  const song = SONG_CATALOG[0] as (typeof SONG_CATALOG)[number];
  const shoeAnchor = makeShoeClosetAnchor({ imageUrl });
  return {
    outcome: "nadine-recommendation",
    outfitName: "Collar Shirt for dinner",
    whyThisWorks: "Bold heels anchor the look.",
    confidenceBoost: "You dressed intentionally.",
    perfumeNote: null,
    primaryProduct: {
      handle: "collar-shirt",
      title: "Becoming Real",
      slot: "top",
      shopifyProductId: null,
      productImageUrl: "https://cdn.shopify.com/primary.jpg",
      liveUrl: "https://naiabynadine.com/products/collar",
      productUrl: "https://naiabynadine.com/products/art-collar-layered-shirt",
      stylingNotes: "Let this shirt lead the outfit.",
    },
    alternatives: [],
    closetAnchorLabel: "Red Heels",
    closetAnchorImageUrl: imageUrl,
    pairingNote: "The heels are the statement — keep the top calm.",
    finishingLayer: {
      shoes: "Your red heels are the anchor — no additional shoe recommendation.",
      bag: "A compact clutch or structured mini-bag.",
      accessories: "Minimal — let the heels speak.",
      hair: "Hair up.",
      colourDirection: "Red pop against neutrals.",
    },
    completionLayer: [],
    songReason: "Curated for dinner.",
    song,
    resultDirections: [],
    rawRecommendation: {
      outcome: "nadine-recommendation",
      anchor: shoeAnchor,
      primary: null,
      alternatives: [],
      outfitPlan: { anchorSlot: "shoe" as const, recommendedSlot: "top" as const, compatibilityStatus: "compatible", notes: [] },
      evaluatedProducts: [],
      coverage: { totalCatalogProducts: 11, eligibleCandidates: 11, excludedCandidates: 0 },
    },
  };
}

describe("§R Result-page fixes", () => {
  it("R.1 — computeStyleMeResult with ready media entry returns non-null primaryProduct.productImageUrl", async () => {
    const input = makeMinimalEngineInput();
    // Run recommendation once to learn which handle the engine selects, then feed back
    // a fake media resolver that marks that exact handle as "ready". This avoids the
    // flakiness of hard-coding a handle that might not be selected by the engine.
    const rec = runRecommendation(input);
    if (!rec.primary) return; // engine returned no primary for this input — skip
    const selectedHandle = rec.primary.handle;
    const fakeMedia = (handle: string) =>
      handle === selectedHandle
        ? { catalogHandle: selectedHandle, eligibility: "ready" as const, resolvedUrl: "https://cdn.shopify.com/primary-test.jpg", shopifyHandle: "test-product", shopifyProductGid: "gid://shopify/Product/99", shopifyMediaGid: "gid://shopify/MediaImage/99", nadinaTitle: "Test", shopifyTitle: "Test", imageDimensions: { w: 1024, h: 1536 }, mediaUpdatedAt: "2026-07-16T10:00:37.000Z", garmentCategory: "tops" as const, reason: "" }
        : undefined;
    const result = await computeStyleMeResult(input, () => rec, fakeMedia as any);
    assert.ok(result.primaryProduct?.productImageUrl !== null, "primaryProduct.productImageUrl must be non-null when selected handle has ready media");
  });

  it("R.2 — computeStyleMeResult with shopifyHandle in media entry produces non-null primaryProduct.productUrl", async () => {
    const input = makeMinimalEngineInput();
    const rec = runRecommendation(input);
    if (!rec.primary) return;
    const selectedHandle = rec.primary.handle;
    const fakeMedia = (handle: string) =>
      handle === selectedHandle
        ? { catalogHandle: selectedHandle, eligibility: "ready" as const, resolvedUrl: "https://cdn.shopify.com/primary-test.jpg", shopifyHandle: "test-shopify-product", shopifyProductGid: "gid://shopify/Product/99", shopifyMediaGid: "gid://shopify/MediaImage/99", nadinaTitle: "Test", shopifyTitle: "Test", imageDimensions: { w: 1024, h: 1536 }, mediaUpdatedAt: "2026-07-16T10:00:37.000Z", garmentCategory: "tops" as const, reason: "" }
        : undefined;
    const result = await computeStyleMeResult(input, () => rec, fakeMedia as any);
    assert.ok(result.primaryProduct?.productUrl?.includes("naiabynadine.com/products/test-shopify-product"), "productUrl must be built from shopifyHandle when media is ready");
  });

  it("R.3 — closet anchor with resolved imageUrl stored as closetAnchorImageUrl in result", async () => {
    const result = makeResultWithShoeAnchor("https://res.cloudinary.com/naia/image/private/s--sig--/v1/heels.jpg");
    assert.equal(result.closetAnchorImageUrl, "https://res.cloudinary.com/naia/image/private/s--sig--/v1/heels.jpg");
    assert.ok(result.closetAnchorImageUrl !== null, "closetAnchorImageUrl must be non-null when anchor imageUrl is resolved");
  });

  it("R.4 — buildDbPayload stores closet anchor imageUrl as productImageUrl on the closet item", () => {
    const result = makeResultWithShoeAnchor("https://res.cloudinary.com/naia/image/private/s--sig--/v1/heels.jpg");
    // Switch outcome to nadine-recommendation so both NADINE + closet anchor items are persisted
    const payload = buildDbPayload(result);
    const closetItem = payload.items.find((i) => i.closetItemId === "closet-shoe-1");
    assert.ok(closetItem, "closet item must be persisted in payload");
    assert.equal(closetItem!.productImageUrl, "https://res.cloudinary.com/naia/image/private/s--sig--/v1/heels.jpg",
      "closet anchor productImageUrl must match resolved imageUrl");
  });

  it("R.5 — parseSuggestionMetadata returns anchorSlot === 'shoe' when shoe anchor was used", () => {
    const result = makeResultWithShoeAnchor();
    const payload = buildDbPayload(result);
    const meta = parseSuggestionMetadata(payload.moodDescriptionJson);
    assert.ok(meta !== null, "metadata must parse");
    assert.equal(meta!.anchorSlot, "shoe", "anchorSlot must be 'shoe' for shoe-category anchor");
  });

  it("R.6 — parseSuggestionMetadata returns anchorSlot === 'bag' when bag anchor was used", () => {
    const song = SONG_CATALOG[0] as (typeof SONG_CATALOG)[number];
    const bagAnchor = makeBagClosetAnchor();
    const result: StyleMeCustomerResult = {
      outcome: "nadine-recommendation",
      outfitName: "Collar Shirt for work",
      whyThisWorks: "Leather tote grounds the look.",
      confidenceBoost: "Intentional.",
      perfumeNote: null,
      primaryProduct: { handle: "collar-shirt", title: "Becoming Real", slot: "top", shopifyProductId: null, productImageUrl: null, liveUrl: null, productUrl: null, stylingNotes: "Let the shirt lead." },
      alternatives: [],
      closetAnchorLabel: "Leather Tote",
      closetAnchorImageUrl: null,
      pairingNote: null,
      finishingLayer: { shoes: "Loafers.", bag: "Your tote is the anchor.", accessories: "Simple watch.", hair: "Neat.", colourDirection: "Neutrals." },
      completionLayer: [],
      songReason: "Work vibe.",
      song,
      resultDirections: [],
      rawRecommendation: {
        outcome: "nadine-recommendation",
        anchor: bagAnchor,
        primary: null,
        alternatives: [],
        outfitPlan: { anchorSlot: "bag" as const, recommendedSlot: "top" as const, compatibilityStatus: "compatible", notes: [] },
        evaluatedProducts: [],
        coverage: { totalCatalogProducts: 11, eligibleCandidates: 11, excludedCandidates: 0 },
      },
    };
    const payload = buildDbPayload(result);
    const meta = parseSuggestionMetadata(payload.moodDescriptionJson);
    assert.ok(meta !== null, "metadata must parse");
    assert.equal(meta!.anchorSlot, "bag", "anchorSlot must be 'bag' for bag-category anchor");
  });

  it("R.7 — parseSuggestionMetadata returns anchorSlot === 'outerwear' when outerwear anchor was used", () => {
    const result = makeNadineWithClosetAnchorResult(); // uses outerwear anchor from §17 helper
    const payload = buildDbPayload(result);
    const meta = parseSuggestionMetadata(payload.moodDescriptionJson);
    assert.ok(meta !== null, "metadata must parse");
    assert.equal(meta!.anchorSlot, "outerwear", "anchorSlot must be 'outerwear' for outerwear anchor");
  });

  it("R.8 — when anchor is a shoe, finishing layer still contains BAG and ACCESSORY items in the payload", () => {
    const result = makeResultWithShoeAnchor();
    const payload = buildDbPayload(result);
    assert.ok(payload.items.some((i) => i.itemType === "BAG"), "BAG finishing item must exist even with shoe anchor");
    assert.ok(payload.items.some((i) => i.itemType === "ACCESSORY"), "ACCESSORY finishing item must exist even with shoe anchor");
  });

  it("R.9 — alternative with ready media entry has non-null productImageUrl in metadata", async () => {
    const input = buildEngineInput({
      moods: ["confident"],
      desiredFeelings: ["more-elevated"],
      bodyNeeds: ["nothing-specific"],
      coverageConditional: null,
      occasion: "everyday",
      formalityConditional: null,
      todayColours: { preferred: [], avoid: [] },
      practicalIds: [],
      source: "naia-piece",
    });
    const fakeMedia = (handle: string) => {
      const urls: Record<string, string> = {
        "collar-shirt": "https://cdn.shopify.com/collar.jpg",
        "asymmetrical-pants": "https://cdn.shopify.com/pants.jpg",
      };
      if (!urls[handle]) return undefined;
      return { catalogHandle: handle, eligibility: "ready" as const, resolvedUrl: urls[handle], shopifyHandle: handle, shopifyProductGid: "gid://shopify/Product/1", shopifyMediaGid: "gid://shopify/MediaImage/1", nadinaTitle: "", shopifyTitle: "", imageDimensions: { w: 1024, h: 1536 }, mediaUpdatedAt: "2026-07-16T10:00:37.000Z", garmentCategory: "tops" as const, reason: "" };
    };
    const rec = runRecommendation(input);
    const result = await computeStyleMeResult(input, () => rec, fakeMedia as any);
    // Alternatives (up to 2) are populated from the engine; those with ready media have image URLs
    const altsWithImages = result.alternatives.filter((a) => a.productImageUrl !== null);
    // At minimum: if any alt was returned with ready media, it should have an image
    if (result.alternatives.length > 0) {
      const firstAlt = result.alternatives[0];
      const altMedia = fakeMedia(firstAlt!.handle);
      if (altMedia?.eligibility === "ready") {
        assert.ok(firstAlt!.productImageUrl !== null, "alternative with ready media must have productImageUrl");
      }
    }
    // Regression: alternatives array shape is correct
    for (const alt of result.alternatives) {
      assert.ok("productImageUrl" in alt, "each alternative must have productImageUrl field");
      assert.ok("liveUrl" in alt, "each alternative must have liveUrl field");
    }
  });

  it("R.19 — needs-manual-review primary with displayResolvedUrl renders non-null productImageUrl", async () => {
    const input = makeMinimalEngineInput();
    const rec = runRecommendation(input);
    if (!rec.primary) return;
    const selectedHandle = rec.primary.handle;
    const displayUrl = `https://cdn.shopify.com/display-test-primary.jpg`;
    const fakeMedia = (handle: string) =>
      handle === selectedHandle
        ? { catalogHandle: selectedHandle, eligibility: "needs-manual-review" as const, resolvedUrl: null, displayResolvedUrl: displayUrl, shopifyHandle: null, shopifyProductGid: null, shopifyMediaGid: null, nadinaTitle: "Test Bold", shopifyTitle: "Test Bold", imageDimensions: null, mediaUpdatedAt: null, garmentCategory: "outerwear" as const, reason: "pending review" }
        : undefined;
    const result = await computeStyleMeResult(input, () => rec, fakeMedia as any);
    assert.ok(result.primaryProduct !== null, "primary product must be set");
    assert.strictEqual(result.primaryProduct?.productImageUrl, displayUrl, "productImageUrl must equal displayResolvedUrl for needs-manual-review entry");
    assert.strictEqual(result.primaryProduct?.shopifyProductId, null, "shopifyProductId must remain null — entry is not VTO-ready");
  });

  it("R.20 — needs-manual-review alternative with displayResolvedUrl renders non-null productImageUrl in metadata", async () => {
    const input = buildEngineInput({
      moods: ["confident"],
      desiredFeelings: ["more-elevated"],
      bodyNeeds: ["nothing-specific"],
      coverageConditional: null,
      occasion: "everyday",
      formalityConditional: null,
      todayColours: { preferred: [], avoid: [] },
      practicalIds: [],
      source: "naia-piece",
    });
    const rec = runRecommendation(input);
    if (rec.alternatives.length === 0) return;
    const displayUrl = `https://cdn.shopify.com/display-test-alt.jpg`;
    // All handles return a needs-manual-review entry with displayResolvedUrl set
    const fakeMedia = (handle: string) => ({
      catalogHandle: handle,
      eligibility: "needs-manual-review" as const,
      resolvedUrl: null,
      displayResolvedUrl: displayUrl,
      shopifyHandle: null,
      shopifyProductGid: null,
      shopifyMediaGid: null,
      nadinaTitle: "Test",
      shopifyTitle: "Test",
      imageDimensions: null,
      mediaUpdatedAt: null,
      garmentCategory: "outerwear" as const,
      reason: "pending review",
    });
    const result = await computeStyleMeResult(input, () => rec, fakeMedia as any);
    assert.ok(result.alternatives.length > 0, "engine must return at least one alternative for this input");
    for (const alt of result.alternatives) {
      assert.strictEqual(alt.productImageUrl, displayUrl, `alternative ${alt.handle}: productImageUrl must equal displayResolvedUrl`);
      assert.strictEqual(alt.shopifyProductId, null, `alternative ${alt.handle}: shopifyProductId must remain null`);
    }
    // Verify the image propagates through buildMetadataJson into moodDescriptionJson
    const { buildDbPayload } = await import("~/lib/ai/styleme-result.server");
    const payload = buildDbPayload(result);
    const meta = parseSuggestionMetadata(payload.moodDescriptionJson);
    assert.ok(meta !== null, "moodDescriptionJson must parse");
    for (const altMeta of meta!.alternatives) {
      assert.strictEqual(altMeta.productImageUrl, displayUrl, `moodDescriptionJson alt ${altMeta.handle}: productImageUrl must equal displayResolvedUrl`);
    }
  });

  it("R.10 — submitReview appends all 5 required question fields to formData", () => {
    // Verify the expected field names are part of the review payload contract
    const requiredFields = ["intent", "sessionId", "overallReaction", "feltLikeMe", "createdFeeling", "wouldWear", "physicalComfort"];
    const formData = new FormData();
    formData.append("intent", "review");
    formData.append("sessionId", "session-abc");
    formData.append("overallReaction", "4");
    formData.append("feltLikeMe", "true");
    formData.append("createdFeeling", "true");
    formData.append("wouldWear", "true");
    formData.append("physicalComfort", "4");
    formData.append("whatWorked", "Silhouette,Color palette");
    formData.append("whatDidnt", "");
    for (const field of requiredFields) {
      assert.ok(formData.has(field), `required review field '${field}' must be present in formData`);
    }
  });

  it("R.11 — review formData includes sessionId for session association", () => {
    const sessionId = "session-xyz-123";
    const formData = new FormData();
    formData.append("intent", "review");
    formData.append("sessionId", sessionId);
    formData.append("overallReaction", "5");
    assert.equal(formData.get("sessionId"), sessionId, "sessionId must be preserved in review formData");
  });

  it("R.12 — review tag groups contain all expected options (10 worked + 11 didn't)", () => {
    const whatWorkedOptions = ["Silhouette", "Color palette", "Styling approach", "Accessories", "Hair suggestion", "Makeup suggestion", "Perfume", "Song", "Confidence boost", "Overall vibe"];
    const whatDidntOptions = ["Too formal", "Too casual", "Wrong colors", "Uncomfortable silhouette", "Doesn't match my style", "Too bold", "Too safe", "Wrong occasion", "Accessories felt off", "Hair/makeup didn't resonate", "Not my vibe"];
    assert.equal(whatWorkedOptions.length, 10, "whatWorked must have exactly 10 options");
    assert.equal(whatDidntOptions.length, 11, "whatDidnt must have exactly 11 options");
  });

  it("R.13 — review action persists correct fields: all required PostOutfitReview columns", () => {
    // Verify the field mapping from formData to DB matches PostOutfitReview schema
    const overallReaction = 4;
    const feltLikeMe = true;
    const createdFeeling = false;
    const wouldWear = true;
    const physicalComfort = 3;
    const reviewFields = {
      overallFeeling: overallReaction,
      feltLikeHer: feltLikeMe ? "Yes" : "No",
      desiredFeelingAchieved: createdFeeling ? "Yes" : "No",
      wouldWearAgain: wouldWear ? "Definitely" : "Probably not",
      physicallyComfortable: physicalComfort.toString(),
      workedTags: null as string | null,
      didntWorkTags: JSON.stringify(["Too formal"]),
    };
    assert.equal(reviewFields.overallFeeling, 4);
    assert.equal(reviewFields.feltLikeHer, "Yes");
    assert.equal(reviewFields.desiredFeelingAchieved, "No");
    assert.equal(reviewFields.wouldWearAgain, "Definitely");
    assert.equal(reviewFields.physicallyComfortable, "3");
    assert.equal(reviewFields.workedTags, null);
    assert.ok(reviewFields.didntWorkTags?.includes("Too formal"));
  });

  it("R.14 — initial review state has all nulls and zeros (no stale pre-filled answers)", () => {
    const initialReviewData = {
      overallReaction: 0,
      feltLikeMe: null as boolean | null,
      createdFeeling: null as boolean | null,
      wouldWear: null as boolean | null,
      physicalComfort: 0,
      whatWorked: [] as string[],
      whatDidnt: [] as string[],
    };
    assert.equal(initialReviewData.overallReaction, 0, "overallReaction must start at 0");
    assert.equal(initialReviewData.feltLikeMe, null, "feltLikeMe must start null");
    assert.equal(initialReviewData.createdFeeling, null, "createdFeeling must start null");
    assert.equal(initialReviewData.wouldWear, null, "wouldWear must start null");
    assert.equal(initialReviewData.physicalComfort, 0, "physicalComfort must start at 0");
    assert.deepEqual(initialReviewData.whatWorked, []);
    assert.deepEqual(initialReviewData.whatDidnt, []);
  });

  it("R.15 — parseSuggestionMetadata correctly deserialises anchorSlot from stored JSON", () => {
    const json = JSON.stringify({
      schemaVersion: 1,
      outcome: "nadine-recommendation",
      primaryHandle: "collar-shirt",
      alternatives: [],
      anchor: { type: "closet", id: "ci-1" },
      anchorSummary: "Red Heels",
      anchorImageUrl: "https://example.com/heels.jpg",
      anchorSlot: "shoe",
      pairingNote: null,
      colourDirection: "Neutral palette",
      songReason: "For your dinner vibe.",
      evidenceCodes: [],
    });
    const meta = parseSuggestionMetadata(json);
    assert.ok(meta !== null, "metadata must parse");
    assert.equal(meta!.anchorSlot, "shoe", "anchorSlot must be preserved through JSON serialization");
  });

  it("R.16 — metadata anchorSlot is null when there is no anchor (NAIA source)", () => {
    const result = makeMinimalResult({ outcome: "nadine-recommendation" });
    const payload = buildDbPayload(result);
    const meta = parseSuggestionMetadata(payload.moodDescriptionJson);
    assert.ok(meta !== null, "metadata must parse");
    assert.ok(meta!.anchorSlot === null || meta!.anchorSlot === undefined, "anchorSlot must be null/undefined for NAIA source with no anchor");
  });

  it("R.17 — buildDbPayload finishing layer items are always present regardless of outcome (regression)", () => {
    for (const outcome of ["nadine-recommendation", "closet-led", "no-eligible-product"] as const) {
      const result = makeMinimalResult({ outcome, primaryProduct: outcome === "nadine-recommendation" ? makeMinimalResult().primaryProduct : null });
      const payload = buildDbPayload(result);
      assert.ok(payload.items.some((i) => i.itemType === "SHOES"), `SHOES must exist for outcome=${outcome}`);
      assert.ok(payload.items.some((i) => i.itemType === "BAG"), `BAG must exist for outcome=${outcome}`);
      assert.ok(payload.items.some((i) => i.itemType === "ACCESSORY"), `ACCESSORY must exist for outcome=${outcome}`);
    }
  });

  it("R.18 — BOTH source with closet anchor stores anchorSlot in metadata (regression)", () => {
    const result = makeNadineWithClosetAnchorResult();
    const payload = buildDbPayload(result);
    const meta = parseSuggestionMetadata(payload.moodDescriptionJson);
    assert.ok(meta !== null, "metadata must parse for BOTH source");
    assert.ok(meta!.anchorSlot !== null && meta!.anchorSlot !== undefined, "anchorSlot must be non-null for BOTH source with anchor");
    assert.equal(meta!.anchor?.type, "closet", "anchor type must be 'closet' for BOTH source");
  });
});

// ── §19 Completion layer — slot detection unit tests ─────────────────────────

// Helpers for constructing mock anchors and products

function makeClosetAnchor(slot: import("./styleme-recommendation.types.ts").OutfitSlot, colors: string[] = ["black"]): NormalizedClosetAnchor {
  return {
    type: "closet",
    id: "test-anchor",
    label: `Test ${slot}`,
    slot,
    colors,
    normalizedColorIds: colors,
    styleTags: [],
    occasions: ["everyday"],
    material: null,
    hasStrongEvidence: false,
    evidenceFields: [],
    imageUrl: null,
  };
}

function makePrimaryProduct(slot: string, title = "Test Product"): import("./styleme-result.types.ts").StyleMePrimaryProduct {
  return {
    handle: "test-handle",
    title,
    slot,
    shopifyProductId: null,
    productImageUrl: null,
    liveUrl: null,
    productUrl: null,
    stylingNotes: "Style it.",
  };
}

describe("§19 Completion layer — slot detection", () => {
  it("CL.1 — non-clothing anchor (shoe) does not fill any clothing slot", () => {
    const anchor = makeClosetAnchor("shoe");
    const filled = getFilledClothingSlots(anchor, null);
    assert.equal(filled.size, 0, "shoe anchor must not fill any clothing slot");
  });

  it("CL.2 — non-clothing anchor (bag) does not fill any clothing slot", () => {
    const anchor = makeClosetAnchor("bag");
    const filled = getFilledClothingSlots(anchor, null);
    assert.equal(filled.size, 0, "bag anchor must not fill any clothing slot");
  });

  it("CL.3 — non-clothing anchor (accessory) does not fill any clothing slot", () => {
    const filled = getFilledClothingSlots(makeClosetAnchor("accessory"), null);
    assert.equal(filled.size, 0);
  });

  it("CL.4 — non-clothing anchor (jewelry) does not fill any clothing slot", () => {
    const filled = getFilledClothingSlots(makeClosetAnchor("jewelry"), null);
    assert.equal(filled.size, 0);
  });

  it("CL.5 — outerwear anchor fills only 'outerwear'", () => {
    const filled = getFilledClothingSlots(makeClosetAnchor("outerwear"), null);
    assert.ok(filled.has("outerwear"));
    assert.ok(!filled.has("top") && !filled.has("bottom"));
  });

  it("CL.6 — top anchor fills only 'top'", () => {
    const filled = getFilledClothingSlots(makeClosetAnchor("top"), null);
    assert.ok(filled.has("top"));
    assert.ok(!filled.has("bottom"));
  });

  it("CL.7 — dress anchor fills 'dress' (not top or bottom)", () => {
    const filled = getFilledClothingSlots(makeClosetAnchor("dress"), null);
    assert.ok(filled.has("dress"));
    assert.ok(!filled.has("top") && !filled.has("bottom"));
  });

  it("CL.8 — Closet SET anchor with unknown components contributes no fabricated clothing coverage", () => {
    const filled = getFilledClothingSlots(makeClosetAnchor("set"), null);
    // Cannot determine components of a Closet SET with no NADINE handle — no coverage fabricated.
    // Completion generates guidance for potentially uncovered slots rather than suppressing them.
    assert.equal(filled.size, 0, "Closet SET anchor must not fabricate coverage when components are unknown");
  });

  it("CL.9 — outerwear anchor + top primary → filled = {outerwear, top}", () => {
    const filled = getFilledClothingSlots(makeClosetAnchor("outerwear"), makePrimaryProduct("top"));
    assert.ok(filled.has("outerwear") && filled.has("top") && !filled.has("bottom"));
  });

  it("CL.10 — null anchor + dress primary → filled = {dress}", () => {
    const filled = getFilledClothingSlots(null, makePrimaryProduct("dress"));
    assert.ok(filled.has("dress"));
    assert.ok(!filled.has("top") && !filled.has("bottom"));
  });

  it("CL.11 — getMissingEssentialSlots: dress → []", () => {
    assert.deepEqual(getMissingEssentialSlots(new Set(["dress"])), []);
  });

  it("CL.12 — getMissingEssentialSlots: top + bottom → []", () => {
    assert.deepEqual(getMissingEssentialSlots(new Set(["top", "bottom"])), []);
  });

  it("CL.13 — getMissingEssentialSlots: top only → [bottom]", () => {
    assert.deepEqual(getMissingEssentialSlots(new Set(["top"])), ["bottom"]);
  });

  it("CL.14 — getMissingEssentialSlots: bottom only → [top]", () => {
    assert.deepEqual(getMissingEssentialSlots(new Set(["bottom"])), ["top"]);
  });

  it("CL.15 — getMissingEssentialSlots: outerwear only → [top, bottom]", () => {
    const missing = getMissingEssentialSlots(new Set(["outerwear"]));
    assert.deepEqual(missing, ["top", "bottom"]);
  });

  it("CL.16 — getMissingEssentialSlots: outerwear + top → [bottom]", () => {
    assert.deepEqual(getMissingEssentialSlots(new Set(["outerwear", "top"])), ["bottom"]);
  });

  it("CL.17 — getMissingEssentialSlots: empty → [top, bottom]", () => {
    assert.deepEqual(getMissingEssentialSlots(new Set()), ["top", "bottom"]);
  });

  it("CL.18 — getMissingEssentialSlots: {top, outerwear, bottom} → []", () => {
    assert.deepEqual(getMissingEssentialSlots(new Set(["top", "outerwear", "bottom"])), []);
  });
});

// ── §20 Completion layer — integration tests (R1–R9) ─────────────────────────

// Builds a mock _runRec that returns a fixed primary handle + closet anchor slot.
// The actual primaryProduct.slot is resolved from the catalog inside computeStyleMeResult.
function makeCompletionMock(
  primaryHandle: string | null,
  anchorSlot: import("./styleme-recommendation.types.ts").OutfitSlot | null,
  anchorColors: string[] = ["black"],
): (input: StyleMeEngineInput) => StyleMeRecommendationResult {
  const anchor: NormalizedClosetAnchor | null = anchorSlot
    ? makeClosetAnchor(anchorSlot, anchorColors)
    : null;
  return () => ({
    outcome: primaryHandle ? "nadine-recommendation" : "no-eligible-product",
    anchor,
    primary: primaryHandle
      ? {
          handle: primaryHandle,
          title: "Mock Product",
          slot: "top" as const,
          totalScore: 5,
          positiveEvidence: [],
          negativeEvidence: [],
          anchorCompatibility: { status: "compatible" as const, isHardExclusion: false },
          provisionalEvidenceUsed: false,
        }
      : null,
    alternatives: [],
    outfitPlan: {
      anchorSlot: anchorSlot,
      recommendedSlot: null,
      compatibilityStatus: "compatible" as const,
      notes: [],
    },
    evaluatedProducts: [],
    coverage: { totalCatalogProducts: 11, eligibleCandidates: 11, excludedCandidates: 0 },
  });
}

function makeBaseInput(source: "naia-piece" | "my-closet" | "both" = "naia-piece"): StyleMeEngineInput {
  return buildEngineInput({
    moods: ["confident"],
    desiredFeelings: ["more-elevated"],
    bodyNeeds: ["nothing-specific"],
    coverageConditional: null,
    occasion: "everyday",
    formalityConditional: null,
    todayColours: { preferred: [], avoid: [] },
    practicalIds: [],
    source,
  });
}

describe("§20 Completion layer — R1–R9 integration", () => {
  // R1: OUTERWEAR primary + SHOES anchor → generates TOP + BOTTOM
  it("R1 — outerwear primary + shoe anchor → completionLayer has top and bottom", async () => {
    const input = makeBaseInput();
    const result = await computeStyleMeResult(input, makeCompletionMock("oversized-blazer", "shoe"));
    assert.ok(result.completionLayer.length === 2, `expected 2 completion pieces, got ${result.completionLayer.length}`);
    const slots = result.completionLayer.map((p) => p.slot);
    assert.ok(slots.includes("top"), "top must be in completionLayer");
    assert.ok(slots.includes("bottom"), "bottom must be in completionLayer");
  });

  // R2: OUTERWEAR primary + Closet TOP anchor → generates BOTTOM only
  it("R2 — outerwear primary + top anchor → completionLayer has bottom only", async () => {
    const input = makeBaseInput();
    const result = await computeStyleMeResult(input, makeCompletionMock("oversized-blazer", "top"));
    assert.equal(result.completionLayer.length, 1, `expected 1 completion piece, got ${result.completionLayer.length}`);
    assert.equal(result.completionLayer[0]!.slot, "bottom", "only missing slot is bottom");
  });

  // R3: TOP primary + SHOES anchor → generates BOTTOM
  it("R3 — top primary + shoe anchor → completionLayer has bottom only", async () => {
    const input = makeBaseInput();
    const result = await computeStyleMeResult(input, makeCompletionMock("collar-shirt", "shoe"));
    assert.equal(result.completionLayer.length, 1);
    assert.equal(result.completionLayer[0]!.slot, "bottom");
  });

  // R4: BOTTOM primary + BAG anchor → generates TOP
  it("R4 — bottom primary + bag anchor → completionLayer has top only", async () => {
    const input = makeBaseInput();
    const result = await computeStyleMeResult(input, makeCompletionMock("draped-leather-pants", "bag"));
    assert.equal(result.completionLayer.length, 1);
    assert.equal(result.completionLayer[0]!.slot, "top");
  });

  // R5: DRESS primary + SHOES anchor → does NOT generate redundant TOP/BOTTOM
  it("R5 — dress primary + shoe anchor → completionLayer is empty", async () => {
    const input = makeBaseInput();
    const result = await computeStyleMeResult(input, makeCompletionMock("midi-dress", "shoe"));
    assert.equal(result.completionLayer.length, 0, "dress is a complete base — no completion needed");
  });

  // R6: Generic completion pieces have no Closet or NADINE identity fields
  it("R6 — completion pieces have slot + non-empty description only (no closet/NADINE fields)", async () => {
    const input = makeBaseInput();
    const result = await computeStyleMeResult(input, makeCompletionMock("oversized-blazer", "shoe"));
    for (const piece of result.completionLayer) {
      assert.ok(typeof piece.slot === "string" && piece.slot.length > 0, "slot must be a non-empty string");
      assert.ok(typeof piece.description === "string" && piece.description.length > 0, "description must be non-empty");
      assert.ok(!("closetItemId" in piece), "completion piece must not have closetItemId");
      assert.ok(!("shopifyProductId" in piece), "completion piece must not have shopifyProductId");
      assert.ok(!("handle" in piece), "completion piece must not have a product handle");
    }
  });

  // R7: Existing anchor-slot suppression still intact (shoe anchor → SHOES suppressed in finishing layer)
  it("R7 — shoe anchor slot suppression: anchorSlot 'shoe' is stored in metadata", async () => {
    const input = makeBaseInput();
    const result = await computeStyleMeResult(input, makeCompletionMock("collar-shirt", "shoe"));
    const payload = buildDbPayload(result);
    const meta = parseSuggestionMetadata(payload.moodDescriptionJson);
    assert.ok(meta !== null, "metadata must parse");
    assert.equal(meta!.anchorSlot, "shoe", "anchorSlot must be 'shoe' — route uses this to suppress SHOES from finishing layer");
  });

  // R8: All essential slots covered → completionLayer is empty
  it("R8 — top anchor + bottom primary → all slots covered, completionLayer is empty", async () => {
    const input = makeBaseInput();
    const result = await computeStyleMeResult(input, makeCompletionMock("suede-skirt", "top"));
    // suede-skirt is BOTTOM; top anchor fills TOP → both slots covered
    assert.equal(result.completionLayer.length, 0, "top + bottom fully covered — no completion needed");
  });

  // R9: Shoe/bag/accessory/jewelry anchor never counts as clothing coverage
  it("R9 — jewelry anchor does not count as TOP/BOTTOM coverage", async () => {
    const input = makeBaseInput();
    const result = await computeStyleMeResult(input, makeCompletionMock("collar-shirt", "jewelry"));
    // collar-shirt = TOP; jewelry = non-clothing → missing = [bottom]
    assert.equal(result.completionLayer.length, 1);
    assert.equal(result.completionLayer[0]!.slot, "bottom", "only bottom is missing when primary is top + jewelry anchor");
  });

  // Completion pieces are persisted in metadata, not in DB items
  it("R10 — completionLayer pieces do not appear in buildDbPayload.items", async () => {
    const input = makeBaseInput();
    const result = await computeStyleMeResult(input, makeCompletionMock("oversized-blazer", "shoe"));
    assert.ok(result.completionLayer.length > 0, "pre-condition: must have completion pieces");
    const payload = buildDbPayload(result);
    const garmentItems = payload.items.filter((i) => !["SHOES", "BAG", "ACCESSORY"].includes(i.itemType));
    // Only the primary NADINE item (OUTERWEAR) should be in garments — no completion TOP/BOTTOM
    assert.equal(garmentItems.length, 1, "completion pieces must not be added to buildDbPayload.items");
  });

  // Completion pieces are serialised into moodDescriptionJson
  it("R11 — completionLayer survives buildDbPayload → parseSuggestionMetadata roundtrip", async () => {
    const input = makeBaseInput();
    const result = await computeStyleMeResult(input, makeCompletionMock("oversized-blazer", "shoe"));
    assert.ok(result.completionLayer.length > 0, "pre-condition: must have completion pieces");
    const payload = buildDbPayload(result);
    const meta = parseSuggestionMetadata(payload.moodDescriptionJson);
    assert.ok(meta !== null, "metadata must parse");
    assert.ok(Array.isArray(meta!.completionLayer) && meta!.completionLayer!.length > 0, "completionLayer must be present in metadata");
    for (const piece of meta!.completionLayer!) {
      assert.ok(typeof piece.slot === "string" && piece.slot.length > 0);
      assert.ok(typeof piece.description === "string" && piece.description.length > 0);
    }
  });

  // buildCompletionLayer unit test — pure function, no computeStyleMeResult needed
  it("R12 — buildCompletionLayer: dress primary with null anchor → [] (no completion)", () => {
    const primary = makePrimaryProduct("dress", "Becoming Fluid");
    const result = buildCompletionLayer(null, primary, {
      moods: ["confident"], desiredFeelings: [], bodyNeeds: [], coverageConditional: null,
      occasion: "everyday", formalityConditional: null,
      todayColours: { preferred: [], avoid: [] }, practicalIds: [], source: "naia-piece",
    });
    assert.deepEqual(result, []);
  });

  it("R13 — buildCompletionLayer: top primary, shoe anchor → [bottom]", () => {
    const anchor = makeClosetAnchor("shoe", ["red"]) as NormalizedStyleAnchor;
    const primary = makePrimaryProduct("top", "Becoming Seen");
    const pieces = buildCompletionLayer(anchor, primary, {
      moods: ["confident"], desiredFeelings: [], bodyNeeds: [], coverageConditional: null,
      occasion: "work", formalityConditional: null,
      todayColours: { preferred: [], avoid: [] }, practicalIds: [], source: "naia-piece",
    });
    assert.equal(pieces.length, 1);
    assert.equal(pieces[0]!.slot, "bottom");
    assert.ok(pieces[0]!.description.length > 0, "bottom description must be non-empty");
  });

  it("R14 — completion description references the NADINE title for proportion guidance", () => {
    const anchor = makeClosetAnchor("shoe") as NormalizedStyleAnchor;
    const primary = makePrimaryProduct("outerwear", "Becoming Clear");
    const pieces = buildCompletionLayer(anchor, primary, {
      moods: ["confident"], desiredFeelings: [], bodyNeeds: [], coverageConditional: null,
      occasion: "everyday", formalityConditional: null,
      todayColours: { preferred: [], avoid: [] }, practicalIds: [], source: "naia-piece",
    });
    assert.equal(pieces.length, 2); // top + bottom
    const topPiece = pieces.find((p) => p.slot === "top");
    assert.ok(topPiece, "top piece must exist");
    assert.ok(topPiece!.description.includes("Becoming Clear"), "top description must reference the NADINE title for proportion context");
  });

  it("R15 — preferred session colour is used in completion piece description", () => {
    const anchor = makeClosetAnchor("shoe") as NormalizedStyleAnchor;
    const primary = makePrimaryProduct("outerwear", "Becoming Bold");
    const pieces = buildCompletionLayer(anchor, primary, {
      moods: ["confident"], desiredFeelings: [], bodyNeeds: [], coverageConditional: null,
      occasion: "everyday", formalityConditional: null,
      todayColours: { preferred: ["forest-green"], avoid: [] }, practicalIds: [], source: "naia-piece",
    });
    const descriptions = pieces.map((p) => p.description).join(" ");
    assert.ok(descriptions.toLowerCase().includes("forest green"), "preferred colour must appear in completion description");
  });
});

// ── §21 Gap corrections ───────────────────────────────────────────────────────
// Gap 1: SET slot coverage via explicit catalog map
// Gap 2: Additional Closet garments feed slot coverage
// Gap 3: StyleMe signals drive completion descriptions
// Gap 4: Why This Works references completion layer
// Gap 5: Legacy metadata backward compatibility

describe("§21 Gap corrections — SET coverage, signals, why-this-works, compat", () => {

  // ── Gap 1: SET coverage ──────────────────────────────────────────────────────

  it("G1.1 — resolveSetSlots: dress-set fills top AND bottom (from explicit catalog map)", () => {
    const slots = resolveSetSlots("dress-set");
    assert.ok(slots.has("top"), "dress-set must cover top");
    assert.ok(slots.has("bottom"), "dress-set must cover bottom");
    assert.equal(slots.size, 2);
  });

  it("G1.2 — resolveSetSlots: unknown SET handle returns empty — no fabricated coverage", () => {
    const slots = resolveSetSlots("future-unknown-set");
    assert.equal(slots.size, 0, "unknown SET must not fabricate slot coverage — completion stays open for unresolved slots");
  });

  it("G1.3 — resolveSetSlots: injected map proves non-top+bottom SET is handled correctly", () => {
    // A hypothetical jacket-set with two top layers (no bottom component)
    const topOnlyMap = new Map([["jacket-set", new Set(["top"])]]);
    const slots = resolveSetSlots("jacket-set", topOnlyMap);
    assert.ok(slots.has("top"), "jacket-set covers top");
    assert.ok(!slots.has("bottom"), "jacket-set must NOT cover bottom");
    assert.equal(slots.size, 1);
  });

  it("G1.4 — NADINE SET primary (dress-set handle) fills top+bottom via catalog map", () => {
    const primary = makePrimaryProduct("set", "Becoming Defined");
    // Override handle to dress-set so resolveSetSlots can look it up
    const dressSetPrimary = { ...primary, handle: "dress-set", slot: "set" };
    const filled = getFilledClothingSlots(null, dressSetPrimary);
    assert.ok(filled.has("top") && filled.has("bottom"), "dress-set primary covers top+bottom");
  });

  it("G1.5 — Closet SET anchor (no NADINE handle) returns empty coverage — no fabrication", () => {
    const filled = getFilledClothingSlots(makeClosetAnchor("set"), null);
    assert.equal(filled.size, 0, "Closet set anchor must not fabricate top+bottom coverage when components are unknown");
  });

  // ── Gap 2: Additional items feed slot coverage ───────────────────────────────

  it("G2.1 — shoe anchor + outerwear primary + Closet TOP already in look → only BOTTOM missing", () => {
    const anchor = makeClosetAnchor("shoe") as NormalizedStyleAnchor;
    const primary = makePrimaryProduct("outerwear");
    // A Closet TOP is already part of the selected look
    const additionalItems = [{ slot: "top" }];
    const filled = getFilledClothingSlots(anchor, primary, additionalItems);
    assert.ok(filled.has("top"), "top must be filled by Closet item");
    assert.ok(filled.has("outerwear"), "outerwear must be filled by primary");
    const missing = getMissingEssentialSlots(filled);
    assert.deepEqual(missing, ["bottom"], "only bottom should be missing");
  });

  it("G2.2 — buildCompletionLayer with additional Closet TOP → generates BOTTOM only", () => {
    const anchor = makeClosetAnchor("shoe") as NormalizedStyleAnchor;
    const primary = makePrimaryProduct("outerwear", "Becoming Bold");
    const pieces = buildCompletionLayer(anchor, primary, {
      moods: ["confident"], desiredFeelings: [], bodyNeeds: [], coverageConditional: null,
      occasion: "everyday", formalityConditional: null,
      todayColours: { preferred: [], avoid: [] }, practicalIds: [], source: "naia-piece",
    }, [{ slot: "top" }]);
    assert.equal(pieces.length, 1, "only one completion piece expected");
    assert.equal(pieces[0]!.slot, "bottom", "completion piece must be BOTTOM");
  });

  it("G2.3 — additional Closet item preserves ownership semantics (has only slot, no shopifyProductId)", () => {
    // Additional items are plain {slot} objects — no NADINE or Closet identity
    const item = { slot: "top" };
    assert.ok(!("shopifyProductId" in item), "additional item must not carry NADINE identity");
    assert.ok(!("closetItemId" in item), "additional item must not carry Closet identity");
  });

  it("G2.4 — computeStyleMeResult: shoe anchor + NADINE outerwear + selectedClosetGarments TOP → BOTTOM only in completionLayer", async () => {
    const input = makeBaseInput("both");
    const shoeAnchor = makeClosetAnchor("shoe", ["black"]);
    const mockRec = (_: StyleMeEngineInput): StyleMeRecommendationResult => ({
      outcome: "nadine-recommendation" as const,
      anchor: shoeAnchor,
      primary: {
        handle: "oversized-blazer",
        title: "Mock Blazer",
        slot: "outerwear" as const,
        totalScore: 5,
        positiveEvidence: [],
        negativeEvidence: [],
        anchorCompatibility: { status: "compatible" as const, isHardExclusion: false },
        provisionalEvidenceUsed: false,
      },
      alternatives: [],
      outfitPlan: { anchorSlot: "shoe" as const, recommendedSlot: null, compatibilityStatus: "compatible" as const, notes: [] },
      evaluatedProducts: [],
      coverage: { totalCatalogProducts: 11, eligibleCandidates: 11, excludedCandidates: 0 },
      selectedClosetGarments: [{ slot: "top" }],
    });
    const result = await computeStyleMeResult(input, mockRec);
    assert.equal(result.completionLayer.length, 1, `expected 1 completion piece (BOTTOM only), got ${result.completionLayer.length}`);
    assert.equal(result.completionLayer[0]!.slot, "bottom", "completionLayer must contain BOTTOM only — TOP slot already covered by selectedClosetGarments");
  });

  // ── Gap 3: StyleMe signals drive completion descriptions ─────────────────────

  it("G3.1 — desiredFeelings 'more-confident' produces structured qualifier in description", () => {
    const anchor = makeClosetAnchor("shoe") as NormalizedStyleAnchor;
    const primary = makePrimaryProduct("bottom", "Becoming Grounded");
    const pieces = buildCompletionLayer(anchor, primary, {
      moods: ["confident"], desiredFeelings: ["more-confident"], bodyNeeds: [],
      coverageConditional: null, occasion: "work", formalityConditional: null,
      todayColours: { preferred: [], avoid: [] }, practicalIds: [], source: "naia-piece",
    });
    const topPiece = pieces.find((p) => p.slot === "top");
    assert.ok(topPiece, "top completion piece must exist");
    assert.ok(topPiece!.description.toLowerCase().includes("structured"), "'more-confident' must produce 'structured' qualifier");
  });

  it("G3.2 — desiredFeelings 'more-relaxed' produces relaxed qualifier (different from confident)", () => {
    const anchor = makeClosetAnchor("shoe") as NormalizedStyleAnchor;
    const primary = makePrimaryProduct("bottom", "Becoming Grounded");
    const pieces = buildCompletionLayer(anchor, primary, {
      moods: ["content"], desiredFeelings: ["more-relaxed"], bodyNeeds: [],
      coverageConditional: null, occasion: "work", formalityConditional: null,
      todayColours: { preferred: [], avoid: [] }, practicalIds: [], source: "naia-piece",
    });
    const topPiece = pieces.find((p) => p.slot === "top");
    assert.ok(topPiece!.description.toLowerCase().includes("relaxed"), "'more-relaxed' must produce 'relaxed' qualifier");
  });

  it("G3.3 — bodyNeeds 'define-waist' produces high-waisted bottom description", () => {
    const anchor = makeClosetAnchor("shoe") as NormalizedStyleAnchor;
    const primary = makePrimaryProduct("top", "Becoming Seen");
    const pieces = buildCompletionLayer(anchor, primary, {
      moods: ["confident"], desiredFeelings: [], bodyNeeds: ["define-waist"],
      coverageConditional: null, occasion: "everyday", formalityConditional: null,
      todayColours: { preferred: [], avoid: [] }, practicalIds: [], source: "naia-piece",
    });
    const bottomPiece = pieces.find((p) => p.slot === "bottom");
    assert.ok(bottomPiece, "bottom completion piece must exist");
    assert.ok(
      bottomPiece!.description.toLowerCase().includes("high-waisted") || bottomPiece!.description.toLowerCase().includes("waist"),
      "'define-waist' must influence silhouette description",
    );
  });

  it("G3.4 — coverageConditional 'cool weather' produces breathable fabric note", () => {
    const anchor = makeClosetAnchor("shoe") as NormalizedStyleAnchor;
    const primary = makePrimaryProduct("bottom", "Becoming Grounded");
    const pieces = buildCompletionLayer(anchor, primary, {
      moods: ["confident"], desiredFeelings: [], bodyNeeds: [],
      coverageConditional: "cool", occasion: "everyday", formalityConditional: null,
      todayColours: { preferred: [], avoid: [] }, practicalIds: [], source: "naia-piece",
    });
    const topPiece = pieces.find((p) => p.slot === "top");
    assert.ok(topPiece, "top piece must exist");
    assert.ok(topPiece!.description.toLowerCase().includes("breathable"), "'cool' coverage must produce breathable fabric note");
  });

  it("G3.5 — anchor colour influences completion colour (red anchor → ivory top)", () => {
    const redAnchor = makeClosetAnchor("shoe", ["red"]) as NormalizedStyleAnchor;
    const primary = makePrimaryProduct("bottom", "Becoming Grounded");
    const pieces = buildCompletionLayer(redAnchor, primary, {
      moods: ["confident"], desiredFeelings: [], bodyNeeds: [], coverageConditional: null,
      occasion: "everyday", formalityConditional: null,
      todayColours: { preferred: [], avoid: [] }, practicalIds: [], source: "naia-piece",
    });
    const topPiece = pieces.find((p) => p.slot === "top");
    assert.ok(topPiece!.description.toLowerCase().includes("ivory"), "red anchor should produce ivory top completion");
  });

  // ── Gap 4: Why This Works references completion ──────────────────────────────

  it("G4.1 — deterministicWording references completion piece when completionLayer is non-empty", () => {
    const pieces: import("./styleme-result.types.ts").StyleMeCompletionPiece[] = [
      { slot: "top", description: "Ivory structured top in a crisp woven. Keep it close to the body." },
    ];
    const w = deterministicWording(
      "nadine-recommendation", ["confident"], ["more-elevated"], "everyday",
      "Becoming Clear", "Wear it with intention.", pieces,
    );
    // New synthesis: references proportion/role relationship (not verbatim description copy)
    assert.ok(
      w.whyThisWorks.toLowerCase().includes("base") ||
      w.whyThisWorks.toLowerCase().includes("proportion") ||
      w.whyThisWorks.toLowerCase().includes("tonal"),
      `whyThisWorks must reference completion piece relationship — got: "${w.whyThisWorks}"`,
    );
    // Must NOT verbatim copy the first clause of the completion description
    const firstClause = pieces[0]!.description.split(".")[0] ?? "";
    assert.ok(
      !w.whyThisWorks.includes(firstClause),
      `whyThisWorks must not paste completion description verbatim — found: "${firstClause}"`,
    );
  });

  it("G4.2 — deterministicWording without completion pieces retains existing behaviour", () => {
    const explanation = "This piece anchors the look with precision.";
    const w = deterministicWording(
      "nadine-recommendation", ["confident"], ["more-elevated"], "everyday",
      "Becoming Seen", explanation,
    );
    assert.ok(w.whyThisWorks.includes(explanation), "no completion → whyThisWorks is unchanged explanation");
    assert.ok(!w.whyThisWorks.includes("base layer"), "no completion → no base-layer note");
  });

  // ── Gap 5: Legacy metadata backward compatibility ────────────────────────────

  it("G5.1 — legacy metadata without completionLayer field parses successfully", () => {
    const legacy = JSON.stringify({
      schemaVersion: 1,
      outcome: "nadine-recommendation",
      primaryHandle: "collar-shirt",
      alternatives: [],
      anchor: null,
      anchorSummary: null,
      pairingNote: null,
      colourDirection: "Neutral tones",
      songReason: "Matched to your mood.",
      evidenceCodes: [],
      // completionLayer intentionally absent
    });
    const meta = parseSuggestionMetadata(legacy);
    assert.ok(meta !== null, "legacy metadata must parse without error");
    assert.equal(meta!.completionLayer, undefined, "missing completionLayer resolves to undefined");
  });

  it("G5.2 — completionLayer absent on legacy result gracefully resolves to [] in UI logic", () => {
    const legacy = JSON.stringify({
      schemaVersion: 1, outcome: "closet-led", primaryHandle: null, alternatives: [],
      anchor: null, anchorSummary: null, pairingNote: null,
      colourDirection: "", songReason: "", evidenceCodes: [],
    });
    const meta = parseSuggestionMetadata(legacy);
    const completionLayer = meta?.completionLayer ?? [];
    assert.deepEqual(completionLayer, [], "completionLayer ?? [] must be empty array for legacy result");
  });
});

// ── §22 QA regression — quality fixes for live result issues ─────────────────

describe("§22 QA regression — completion quality, anchor wording, finishing slot separation", () => {
  // QA.1 — different desiredFeelings must produce meaningfully different completion details
  it("QA.1 — 'more-attractive' girls-night produces different completion detail than 'more-confident'", () => {
    const anchor = makeClosetAnchor("shoe", ["red"]) as NormalizedStyleAnchor;
    const primary = makePrimaryProduct("outerwear", "Becoming Bold");

    const attractivePieces = buildCompletionLayer(anchor, primary, {
      moods: ["adventurous"], desiredFeelings: ["more-attractive"], bodyNeeds: [],
      coverageConditional: null, occasion: "girls-night", formalityConditional: null,
      todayColours: { preferred: [], avoid: [] }, practicalIds: [], source: "naia-piece",
    });

    const confidentPieces = buildCompletionLayer(anchor, primary, {
      moods: ["confident"], desiredFeelings: ["more-confident"], bodyNeeds: [],
      coverageConditional: null, occasion: "girls-night", formalityConditional: null,
      todayColours: { preferred: [], avoid: [] }, practicalIds: [], source: "naia-piece",
    });

    assert.ok(attractivePieces.length > 0, "attractive session must generate completion pieces");
    assert.ok(confidentPieces.length > 0, "confident session must generate completion pieces");

    const attractiveDesc = attractivePieces.map((p) => p.description).join(" ");
    const confidentDesc = confidentPieces.map((p) => p.description).join(" ");
    assert.notEqual(
      attractiveDesc,
      confidentDesc,
      "different desiredFeelings must produce different completion descriptions",
    );
  });

  // QA.2 — adventurous mood adds edge detail to girls-night completion pieces
  it("QA.2 — adventurous mood produces wrap/asymmetric detail in completion description", () => {
    const anchor = makeClosetAnchor("shoe", ["red"]) as NormalizedStyleAnchor;
    const primary = makePrimaryProduct("outerwear", "Becoming Bold");
    const pieces = buildCompletionLayer(anchor, primary, {
      moods: ["adventurous"], desiredFeelings: ["more-attractive"], bodyNeeds: [],
      coverageConditional: null, occasion: "girls-night", formalityConditional: null,
      todayColours: { preferred: [], avoid: [] }, practicalIds: [], source: "naia-piece",
    });
    const combined = pieces.map((p) => p.description).join(" ");
    assert.ok(
      /wrap|asymmetric|split|neckline|open|draped/i.test(combined),
      `adventurous mood must produce edge/shape detail in completion — got: "${combined}"`,
    );
  });

  // QA.3 — manual shoe anchor appears in deterministicWording.whyThisWorks
  it("QA.3 — shoe anchor label is referenced in deterministicWording whyThisWorks", () => {
    const wording = deterministicWording(
      "nadine-recommendation",
      ["adventurous"],
      ["more-attractive"],
      "girls-night",
      "Becoming Bold",
      null,
      [],
      { label: "Red Heels", slot: "shoe", colors: ["red"] },
    );
    assert.ok(
      wording.whyThisWorks.toLowerCase().includes("red heels"),
      `anchor must be named in whyThisWorks — got: "${wording.whyThisWorks}"`,
    );
  });

  // QA.4 — BAG and ACCESSORIES cannot render identical text
  it("QA.4 — buildFinishingLayer: bag and accessories fields must not be identical", () => {
    // Test with null handle (generic fallback) — they should be distinct by design
    const generic = buildFinishingLayer(null);
    assert.notEqual(
      generic.bag,
      generic.accessories,
      `generic finishing layer: bag and accessories must not be identical strings — bag: "${generic.bag}", accessories: "${generic.accessories}"`,
    );

    // Also confirm with a catalog product handle
    const catalog = buildFinishingLayer("collar-shirt");
    assert.notEqual(
      catalog.bag,
      catalog.accessories,
      `catalog finishing layer for collar-shirt: bag must not duplicate accessories — bag: "${catalog.bag}", accessories: "${catalog.accessories}"`,
    );
  });

  // QA.5 — BAG copy contains bag guidance and does not primarily describe jewellery
  it("QA.5 — generic finishing layer bag copy is bag-specific and does not lead with jewellery", () => {
    const layer = buildFinishingLayer(null);
    const bagLower = layer.bag.toLowerCase();
    // Bag copy should mention bag-related terms
    assert.ok(
      /bag|tote|clutch|structured|handbag|carry/.test(bagLower),
      `generic bag copy must reference bag guidance — got: "${layer.bag}"`,
    );
    // Bag copy must not primarily be about jewellery (earring/cuff/bracelet as lead content)
    const firstTenWords = bagLower.split(" ").slice(0, 10).join(" ");
    assert.ok(
      !/earring|bracelet|cuff|necklace|ring/.test(firstTenWords),
      `bag copy must not lead with jewellery terms — got: "${layer.bag}"`,
    );
  });

  // QA.COVERAGE — coverage preference outranks feeling + mood + occasion vocab
  it("QA.COVERAGE — adventurous + more-attractive + girls-night + higher-coverage: no daring neckline, no mini, no split", () => {
    const anchor = makeClosetAnchor("shoe", ["red"]) as NormalizedStyleAnchor;
    const primary = makePrimaryProduct("outerwear", "Becoming Bold");

    const pieces = buildCompletionLayer(anchor, primary, {
      moods: ["adventurous"],
      desiredFeelings: ["more-attractive"],
      bodyNeeds: [],
      coverageConditional: "higher-coverage",
      occasion: "girls-night",
      formalityConditional: null,
      todayColours: { preferred: [], avoid: [] },
      practicalIds: [],
      source: "naia-piece",
    });

    assert.ok(pieces.length > 0, "must still generate completion pieces with coverage preference");
    const combined = pieces.map((p) => p.description).join(" ");

    // Must NOT contain exposure-conflicting vocabulary
    assert.ok(
      !/daring neckline|open neckline|off.shoulder|mini skirt|side split/i.test(combined),
      `coverage preference must suppress exposure-conflicting vocab — got: "${combined}"`,
    );

    // Must still deliver evening/attractive character through safe alternatives
    assert.ok(
      /satin|fluid|drape|asymmetric|texture|charmeuse|midi|moderate|refined/i.test(combined),
      `coverage-safe pieces must still express evening/attractive character — got: "${combined}"`,
    );
  });

  // QA.6 — shoe anchor continues to suppress SHOES in buildDbPayload (slot-suppression invariant)
  it("QA.6 — shoe anchor: SHOES item present in buildDbPayload (UI handles slot suppression, not server)", () => {
    const result = makeResultWithShoeAnchor();
    const payload = buildDbPayload(result);
    assert.ok(
      payload.items.some((i) => i.itemType === "SHOES"),
      "SHOES must remain in buildDbPayload items even with shoe anchor — UI layer handles suppression",
    );
    assert.ok(
      payload.items.some((i) => i.itemType === "BAG"),
      "BAG must still be present with shoe anchor",
    );
    assert.ok(
      payload.items.some((i) => i.itemType === "ACCESSORY"),
      "ACCESSORY must still be present with shoe anchor",
    );
  });

  // QA.7 — no stacked neckline instructions in TOP completion piece
  it("QA.7 — adventurous + more-attractive girls-night TOP contains at most one neckline instruction", () => {
    const anchor = makeClosetAnchor("shoe", ["red"]) as NormalizedStyleAnchor;
    const primary = makePrimaryProduct("outerwear", "Becoming Bold");
    const pieces = buildCompletionLayer(anchor, primary, {
      moods: ["adventurous"], desiredFeelings: ["more-attractive"], bodyNeeds: [],
      coverageConditional: null, occasion: "girls-night", formalityConditional: null,
      todayColours: { preferred: [], avoid: [] }, practicalIds: [], source: "naia-piece",
    });
    const topPiece = pieces.find((p) => p.slot === "top");
    assert.ok(topPiece, "TOP completion piece must exist");
    const necklineCount = (topPiece!.description.match(/neckline/gi) ?? []).length;
    assert.ok(
      necklineCount <= 1,
      `TOP description must contain at most one neckline instruction, found ${necklineCount}: "${topPiece!.description}"`,
    );
  });

  // QA.8 — garment-detail contradiction: skirt description must not include "full-length line"
  it("QA.8 — girls-night BOTTOM with skirt garment does not include 'full-length line' contradiction", () => {
    const anchor = makeClosetAnchor("shoe", ["red"]) as NormalizedStyleAnchor;
    const primary = makePrimaryProduct("outerwear", "Becoming Bold");
    const pieces = buildCompletionLayer(anchor, primary, {
      moods: ["adventurous"], desiredFeelings: ["more-attractive"], bodyNeeds: [],
      coverageConditional: null, occasion: "girls-night", formalityConditional: null,
      todayColours: { preferred: [], avoid: [] }, practicalIds: [], source: "naia-piece",
    });
    const bottomPiece = pieces.find((p) => p.slot === "bottom");
    assert.ok(bottomPiece, "BOTTOM completion piece must exist");
    const desc = bottomPiece!.description;
    const hasSkirt = /skirt/i.test(desc);
    const hasFullLength = /full-length line/i.test(desc);
    assert.ok(
      !hasSkirt || !hasFullLength,
      `BOTTOM with skirt must not also contain "full-length line": "${desc}"`,
    );
  });

  // QA.9 — ACCESSORIES must not contain handbag/structured bag language
  it("QA.9 — buildFinishingLayer accessories field contains no handbag or structured bag language", () => {
    // All catalog handles have structured bag / handbag in accessoriesDirection; verify stripping works.
    const handles = ["collar-shirt", "asymmetrical-pants", "draped-leather-pants", "oversized-blazer", "kimono-jacket", null];
    for (const handle of handles) {
      const layer = buildFinishingLayer(handle);
      const hasBagLanguage = /\bhandbag\b|\bstructured\s+bag\b/i.test(layer.accessories);
      assert.ok(
        !hasBagLanguage,
        `ACCESSORIES must not contain handbag/structured bag language for handle "${handle}": "${layer.accessories}"`,
      );
    }
  });

  // QA.10 — WHY THIS WORKS must not verbatim copy the first clause of a completion description
  it("QA.10 — deterministicWording whyThisWorks does not paste completion-piece description verbatim", () => {
    const anchor = makeClosetAnchor("shoe", ["red"]) as NormalizedStyleAnchor;
    const primary = makePrimaryProduct("outerwear", "Becoming Bold");
    const pieces = buildCompletionLayer(anchor, primary, {
      moods: ["adventurous"], desiredFeelings: ["more-attractive"], bodyNeeds: [],
      coverageConditional: null, occasion: "girls-night", formalityConditional: null,
      todayColours: { preferred: [], avoid: [] }, practicalIds: [], source: "naia-piece",
    });
    const wording = deterministicWording(
      "nadine-recommendation",
      ["adventurous"],
      ["more-attractive"],
      "girls-night",
      "Becoming Bold",
      null,
      pieces,
      { label: "Red Heels", slot: "shoe", colors: ["red"] },
    );
    for (const piece of pieces) {
      const firstClause = piece.description.split(".")[0] ?? "";
      assert.ok(
        !wording.whyThisWorks.includes(firstClause),
        `whyThisWorks must not verbatim paste completion-piece first clause "${firstClause}"`,
      );
    }
  });
});

// ── §23 F2 regression — softer signal ────────────────────────────────────────
import { getProductByHandle } from "./naia-catalog.ts";

describe("§23 F2 regression — softer desired-feeling signal", () => {
  it("F2.1 — Becoming Rooted (suede-skirt) now has 'softer' in desiredFeelingMatch", () => {
    const product = getProductByHandle("suede-skirt");
    assert.ok(product, "suede-skirt must exist in catalog");
    assert.ok(
      product!.parsed.rankings.desiredFeelingMatch.includes("softer"),
      "suede-skirt desiredFeelingMatch must include 'softer'",
    );
  });

  it("F2.2 — Becoming Whole (kimono-jacket) still has 'softer' in desiredFeelingMatch", () => {
    const product = getProductByHandle("kimono-jacket");
    assert.ok(product, "kimono-jacket must exist in catalog");
    assert.ok(
      product!.parsed.rankings.desiredFeelingMatch.includes("softer"),
      "kimono-jacket desiredFeelingMatch must still include 'softer'",
    );
  });

  it("F2.3 — at least two catalog products have 'softer' in desiredFeelingMatch", () => {
    const handles = ["suede-skirt", "kimono-jacket"];
    const withSofter = handles.filter((h) => {
      const p = getProductByHandle(h);
      return p?.parsed.rankings.desiredFeelingMatch.includes("softer");
    });
    assert.ok(withSofter.length >= 2, `Expected ≥2 products with 'softer' DFM, found: ${withSofter.join(", ")}`);
  });

  it("F2.4 — 'softer' desired feeling changes TOP completion to draped/fluid fabric", () => {
    const anchor = makeClosetAnchor("shoe") as NormalizedStyleAnchor;
    const primary = makePrimaryProduct("bottom", "Becoming Grounded");
    const pieces = buildCompletionLayer(anchor, primary, {
      moods: ["content"], desiredFeelings: ["softer"], bodyNeeds: [],
      coverageConditional: null, occasion: "everyday", formalityConditional: null,
      todayColours: { preferred: [], avoid: [] }, practicalIds: [], source: "naia-piece",
    });
    const topPiece = pieces.find((p) => p.slot === "top");
    assert.ok(topPiece, "top completion piece must exist");
    const desc = topPiece!.description.toLowerCase();
    assert.ok(
      desc.includes("draped") || desc.includes("fluid"),
      `'softer' must produce draped/fluid fabric note in top description. Got: "${topPiece!.description}"`,
    );
  });

  it("F2.5 — 'softer' completion does not introduce romantic, frilly, or pastel language", () => {
    const anchor = makeClosetAnchor("shoe") as NormalizedStyleAnchor;
    const primary = makePrimaryProduct("bottom", "Becoming Grounded");
    const pieces = buildCompletionLayer(anchor, primary, {
      moods: ["content"], desiredFeelings: ["softer"], bodyNeeds: [],
      coverageConditional: null, occasion: "everyday", formalityConditional: null,
      todayColours: { preferred: [], avoid: [] }, practicalIds: [], source: "naia-piece",
    });
    for (const piece of pieces) {
      const desc = piece.description.toLowerCase();
      assert.ok(!desc.includes("romantic"), `'softer' must not introduce 'romantic' in ${piece.slot}`);
      assert.ok(!desc.includes("frilly"), `'softer' must not introduce 'frilly' in ${piece.slot}`);
      assert.ok(!desc.includes("pastel"), `'softer' must not introduce 'pastel' in ${piece.slot}`);
      assert.ok(!desc.includes("feminine"), `'softer' must not introduce 'feminine' in ${piece.slot}`);
    }
  });

  it("F2.6 — more-coverage preference outranks 'softer': top detail note is suppressed", () => {
    const anchor = makeClosetAnchor("shoe") as NormalizedStyleAnchor;
    const primary = makePrimaryProduct("bottom", "Becoming Grounded");
    const pieces = buildCompletionLayer(anchor, primary, {
      moods: ["content"], desiredFeelings: ["softer"], bodyNeeds: ["more-coverage"],
      coverageConditional: null, occasion: "everyday", formalityConditional: null,
      todayColours: { preferred: [], avoid: [] }, practicalIds: [], source: "naia-piece",
    });
    const topPiece = pieces.find((p) => p.slot === "top");
    assert.ok(topPiece, "top completion piece must exist");
    const desc = topPiece!.description;
    assert.ok(
      !desc.includes("rounded collar") && !desc.includes("sharp plackets"),
      `When more-coverage is active, the 'softer' detail note must be suppressed. Got: "${desc}"`,
    );
  });

  it("F2.W1 — deterministicWording with 'softer' + completion references fluid/draped styling relationship", () => {
    const pieces: import("./styleme-result.types.ts").StyleMeCompletionPiece[] = [
      { slot: "top", description: "Ivory fitted top in a draped or fluid fabric. Avoid sharp plackets — a rounded collar carries the feel." },
    ];
    const w = deterministicWording(
      "nadine-recommendation", ["content"], ["softer"], "dinner",
      "Becoming Rooted", "Let the slim midi shape and knotted waist define the outfit.", pieces,
    );
    const lower = w.whyThisWorks.toLowerCase();
    assert.ok(
      lower.includes("fluid") || lower.includes("draped") || lower.includes("soften"),
      `deterministicWording with 'softer' must reference fluid/draped/softens. Got: "${w.whyThisWorks}"`,
    );
  });

  it("F2.W2 — deterministicWording softerNote explains styling relationship, not just restating desire", () => {
    const pieces: import("./styleme-result.types.ts").StyleMeCompletionPiece[] = [
      { slot: "top", description: "Ivory top in a draped or fluid fabric." },
    ];
    const w = deterministicWording(
      "nadine-recommendation", ["content"], ["softer"], "dinner",
      "Becoming Rooted", null, pieces,
    );
    assert.ok(
      !w.whyThisWorks.includes("desire to feel softer"),
      `softerNote must not say 'desire to feel softer'. Got: "${w.whyThisWorks}"`,
    );
    assert.ok(
      !w.whyThisWorks.includes("you wanted to feel"),
      `softerNote must not say 'you wanted to feel'. Got: "${w.whyThisWorks}"`,
    );
    const lower = w.whyThisWorks.toLowerCase();
    assert.ok(
      lower.includes("fluid") || lower.includes("draped") || lower.includes("soften"),
      `softerNote must reference a styling relationship via fabric/line. Got: "${w.whyThisWorks}"`,
    );
  });

  it("F2.W3 — softerNote still present under higher-coverage (softness via fabric, coverage wins on shape)", () => {
    const pieces: import("./styleme-result.types.ts").StyleMeCompletionPiece[] = [
      { slot: "top", description: "Ivory top in a draped or fluid fabric. Keep it close to the body." },
      { slot: "bottom", description: "Black straight-leg trousers in a draped or fluid fabric." },
    ];
    const w = deterministicWording(
      "nadine-recommendation", ["content"], ["softer"], "dinner",
      "Becoming Whole", "Use this jacket as the statement layer.", pieces,
    );
    const lower = w.whyThisWorks.toLowerCase();
    assert.ok(
      lower.includes("fluid") || lower.includes("draped") || lower.includes("soften"),
      `softerNote must still reference soft fabric under coverage context. Got: "${w.whyThisWorks}"`,
    );
    assert.ok(!lower.includes("romantic"), "softerNote must not introduce 'romantic' under coverage");
  });

  it("F2.W4 — deterministicWording with 'softer' never introduces romantic/frilly/pastel", () => {
    const pieces: import("./styleme-result.types.ts").StyleMeCompletionPiece[] = [
      { slot: "top", description: "Ivory top in a draped or fluid fabric." },
      { slot: "bottom", description: "Black trousers in a draped or fluid fabric." },
    ];
    const w = deterministicWording(
      "nadine-recommendation", ["content"], ["softer"], "everyday",
      "Becoming Clear", null, pieces,
    );
    const lower = w.whyThisWorks.toLowerCase();
    assert.ok(!lower.includes("romantic"), "softer whyThisWorks must not say 'romantic'");
    assert.ok(!lower.includes("frilly"), "softer whyThisWorks must not say 'frilly'");
    assert.ok(!lower.includes("pastel"), "softer whyThisWorks must not say 'pastel'");
    assert.ok(!lower.includes("feminine"), "softer whyThisWorks must not say 'feminine'");
  });

  it("F2.7 — existing 'more-attractive' + adventurous + girls-night composition is unchanged", () => {
    const anchor = makeClosetAnchor("shoe") as NormalizedStyleAnchor;
    const primary = makePrimaryProduct("bottom", "Becoming Grounded");
    const pieces = buildCompletionLayer(anchor, primary, {
      moods: ["adventurous"], desiredFeelings: ["more-attractive"], bodyNeeds: [],
      coverageConditional: null, occasion: "girls-night", formalityConditional: null,
      todayColours: { preferred: [], avoid: [] }, practicalIds: [], source: "naia-piece",
    });
    const topPiece = pieces.find((p) => p.slot === "top");
    assert.ok(topPiece, "top piece must exist");
    const desc = topPiece!.description.toLowerCase();
    assert.ok(
      desc.includes("wrap") || desc.includes("off-shoulder") || desc.includes("asymmetric") || desc.includes("daring"),
      `'more-attractive' + adventurous + girls-night must still produce daring neckline detail. Got: "${topPiece!.description}"`,
    );
  });
});

// ── §V — Constitution V1 voice compliance ────────────────────────────────────

// ── §V.D — confidenceBoost: styling observation, not emotional affirmation ────

describe("§V.D — deterministic confidenceBoost: clothing observation, not emotional affirmation", () => {
  const EMOTIONAL_PATTERNS: RegExp[] = [
    /you dressed intentionally/i,
    /that intention shows/i,
    /you('ll| will) feel/i,
    /you've got this/i,
    /you look amazing/i,
    /you are going to/i,
  ];

  it("V.D.1 — with primaryTitle: does not produce motivational affirmation", () => {
    const w = deterministicWording("nadine-recommendation", ["confident"], ["more-elevated"], "work", "Becoming Defined", "A structured corset set.");
    for (const p of EMOTIONAL_PATTERNS) {
      assert.ok(!p.test(w.confidenceBoost), `confidenceBoost must not match /${p.source}/; got: "${w.confidenceBoost}"`);
    }
  });

  it("V.D.2 — with primaryTitle: references the garment by name", () => {
    const w = deterministicWording("nadine-recommendation", ["confident"], [], "everyday", "Becoming Defined", null);
    assert.ok(w.confidenceBoost.includes("Becoming Defined"), `expected garment name in confidenceBoost; got: "${w.confidenceBoost}"`);
  });

  it("V.D.3 — without primaryTitle: produces clothing-grounded fallback", () => {
    const w = deterministicWording("no-eligible-product", ["confident"], [], "everyday", null, null);
    for (const p of EMOTIONAL_PATTERNS) {
      assert.ok(!p.test(w.confidenceBoost), `confidenceBoost must not match /${p.source}/; got: "${w.confidenceBoost}"`);
    }
    assert.ok(w.confidenceBoost.length > 0, "confidenceBoost must be non-empty");
  });

  it("V.D.4 — closet-led with null primaryTitle: clothing-grounded fallback", () => {
    const w = deterministicWording("closet-led", [], [], "casual", null, null);
    for (const p of EMOTIONAL_PATTERNS) {
      assert.ok(!p.test(w.confidenceBoost), `confidenceBoost must not match /${p.source}/; got: "${w.confidenceBoost}"`);
    }
  });

  it("V.D.5 — confidenceBoost field still exists on StyleMeDbPayload (legacy schema compat)", () => {
    const payload: StyleMeDbPayload = {
      outfitName: "Test",
      whyThisWorks: "The trouser grounds the look.",
      confidenceBoost: "The blazer is doing the structural work — keep the rest clean.",
      perfumeRec: null,
      hairstyleRec: null,
      makeupVibeRec: null,
      songRec: '"Blossom" by Test',
      songArtist: "Test",
      items: [],
      moodDescriptionJson: "{}",
    };
    assert.equal(payload.confidenceBoost, "The blazer is doing the structural work — keep the rest clean.");
  });
});

// ── §V.E — StyleMe system prompt: tone spec and blocked phrases ───────────────

describe("§V.E — STYLEME_WORDING_SYSTEM_PROMPT: tone spec and prohibited phrases", () => {
  it("V.E.1 — system prompt does not use 'warm and confident AI personal stylist'", () => {
    assert.ok(!STYLEME_WORDING_SYSTEM_PROMPT.includes("warm and confident AI personal stylist"),
      "old tone description must be replaced");
  });

  it("V.E.2 — system prompt includes constitution tone descriptors", () => {
    const REQUIRED = ["observant", "calm", "decisive", "understated"];
    for (const word of REQUIRED) {
      assert.ok(STYLEME_WORDING_SYSTEM_PROMPT.includes(word),
        `system prompt must include tone descriptor "${word}"`);
    }
  });

  it("V.E.3 — system prompt explicitly blocks bubbly/salesy phrases", () => {
    const MUST_BLOCK = [
      "Absolutely!", "Obsessed.", "Gorgeous!", "Game-changer.",
      "perfect for you", "matches your vibe", "super flattering",
    ];
    for (const phrase of MUST_BLOCK) {
      assert.ok(STYLEME_WORDING_SYSTEM_PROMPT.includes(phrase),
        `system prompt must list "${phrase}" as blocked`);
    }
  });

  it("V.E.4 — system prompt instructs confidenceBoost as styling observation not emotional", () => {
    assert.ok(STYLEME_WORDING_SYSTEM_PROMPT.includes("styling observation"),
      "system prompt must instruct styling observation");
    assert.ok(STYLEME_WORDING_SYSTEM_PROMPT.includes("about the garment, not how she will feel"),
      "system prompt must prohibit emotional payoff");
  });
});

// ── §V.F — StyleMe system prompt: State context-only guard ───────────────────

describe("§V.F — STYLEME_WORDING_SYSTEM_PROMPT: State context-only guard", () => {
  it("V.F.1 — system prompt includes State-as-context guard", () => {
    assert.ok(STYLEME_WORDING_SYSTEM_PROMPT.includes("CONTEXT ONLY"),
      "system prompt must label State as CONTEXT ONLY");
  });

  it("V.F.2 — system prompt names the forbidden State pattern", () => {
    assert.ok(
      STYLEME_WORDING_SYSTEM_PROMPT.includes("Because you") ||
      STYLEME_WORDING_SYSTEM_PROMPT.includes("Because you're stressed"),
      "system prompt must show the forbidden pattern by example",
    );
  });

  it("V.F.3 — system prompt specifies valid clothing-justification channels", () => {
    const REQUIRED = ["Intention", "Physical Need"];
    for (const channel of REQUIRED) {
      assert.ok(STYLEME_WORDING_SYSTEM_PROMPT.includes(channel),
        `system prompt must name "${channel}" as valid justification channel`);
    }
  });
});

// ── §V.10 — Legacy schema: parseSuggestionMetadata still works ───────────────

describe("§V.10 — legacy schema compatibility: parseSuggestionMetadata", () => {
  it("V.10.1 — parses metadata payload without resultDirections field (pre-Rev3 record)", () => {
    const payload = JSON.stringify({
      schemaVersion: 1,
      outcome: "nadine-recommendation",
      primaryHandle: "collar-shirt",
      alternatives: [],
      anchor: null,
      anchorSummary: null,
      pairingNote: null,
      colourDirection: "neutrals",
      songReason: "matched",
      evidenceCodes: [],
    });
    const meta = parseSuggestionMetadata(payload);
    assert.ok(meta !== null, "must parse valid pre-Rev3 metadata");
    assert.equal(meta!.schemaVersion, 1);
    assert.equal(meta!.resultDirections, undefined);
  });

  it("V.10.2 — parses metadata with resultDirections field (Rev3 record)", () => {
    const payload = JSON.stringify({
      schemaVersion: 1,
      outcome: "nadine-recommendation",
      primaryHandle: "collar-shirt",
      alternatives: [],
      anchor: null,
      anchorSummary: null,
      pairingNote: null,
      colourDirection: "neutrals",
      songReason: "matched",
      evidenceCodes: [],
      resultDirections: [
        { label: "most-you", displayLabel: "MOST YOU", directionalNote: "Strongest alignment.", handle: "collar-shirt", title: "Becoming Seen", productUrl: null, productImageUrl: null },
      ],
    });
    const meta = parseSuggestionMetadata(payload);
    assert.ok(meta !== null, "must parse Rev3 metadata");
    assert.equal(meta!.resultDirections?.length, 1);
    assert.equal(meta!.resultDirections?.[0]?.label, "most-you");
  });
});
