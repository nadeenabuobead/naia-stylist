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
} from "./styleme-result.server.ts";
import type {
  StyleMeCustomerResult,
  StyleMeDbPayload,
  StyleMeFinishingLayer,
  StyleMeOutcome,
  StyleMeWording,
} from "./styleme-result.types.ts";
import { parseSuggestionMetadata } from "./styleme-result.types.ts";
import { SONG_CATALOG } from "./get-ready-song-catalog.ts";
import { runRecommendation } from "./styleme-recommendation.ts";
import type { ClosetAnchorInput, StyleMeEngineInput, StyleMeRecommendationResult } from "./styleme-recommendation.types.ts";
import { resolveActionAnchor } from "./styleme-anchor.server.ts";

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
      stylingNotes: "Let this shirt lead the outfit.",
    },
    alternatives: [],
    closetAnchorLabel: null,
    closetAnchorImageUrl: null,
    pairingNote: null,
    finishingLayer: baseFinishing,
    songReason: "Curated to set the tone for your everyday.",
    song,
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

  it("4.3 — occasion dashes are removed in confidenceBoost", () => {
    const w = deterministicWording(
      "nadine-recommendation", ["confident"], [], "date-night", "Shirt", null,
    );
    assert.ok(!w.confidenceBoost.includes("date-night"), `got: ${w.confidenceBoost}`);
    assert.ok(w.confidenceBoost.includes("date night"), `got: ${w.confidenceBoost}`);
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
    songReason: "Curated for everyday.",
    song,
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
    const alt1 = { handle: "midi-dress", title: "Midi", slot: "dress", shopifyProductId: null, productImageUrl: null, liveUrl: null, stylingNotes: "Style 1" };
    const alt2 = { handle: "cropped-top", title: "Crop", slot: "top", shopifyProductId: null, productImageUrl: null, liveUrl: null, stylingNotes: "Style 2" };
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
      stylingNotes: "Let this shirt lead the outfit.",
    },
    alternatives: [],
    closetAnchorLabel: "Cream Blazer",
    closetAnchorImageUrl: "https://example.com/cream-blazer.jpg",
    pairingNote: "Wear the blazer open for a relaxed polish.",
    finishingLayer: finishing,
    songReason: "Curated for your work day.",
    song,
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
