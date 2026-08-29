import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeObservables,
  normalizeMatchingSignals,
  extractGarmentIntelligence,
  runClosetGarmentAnalysis,
} from "./closet-garment-analysis.server";
import {
  deriveEvidenceLevel,
  GARMENT_INTELLIGENCE_SCHEMA_VERSION,
} from "./garment-intelligence.types";
import type { GarmentIntelligence } from "./garment-intelligence.types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const closetRoute = readFileSync(join(__dirname, "../../routes/closet._index.tsx"), "utf8");

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePrismaUpdate() {
  const calls: [string, Record<string, unknown>][] = [];
  const fn = async (id: string, data: Record<string, unknown>) => {
    calls.push([id, data]);
  };
  (fn as any).calls = calls;
  return { fn, calls };
}

function makeImageAnalyzer(returnValue: string) {
  return async (_params: unknown) => returnValue;
}

function makeRejectingAnalyzer(msg: string) {
  return async (_params: unknown): Promise<string> => {
    throw new Error(msg);
  };
}

function makeGetSignedUrl(url = "https://cdn.example.com/item.jpg") {
  return () => url;
}

function makeThrowingGetSignedUrl(msg: string) {
  return () => { throw new Error(msg); };
}

function validExtractionJson(obsOverride?: Record<string, unknown>) {
  const observables = obsOverride ?? {
    subcategory: "midi-dress",
    silhouette: "a-line",
    fitProfile: "body-skimming",
    hemLength: "midi",
    topLength: "n/a",
    waistShape: "high-rise",
    sleeveLength: "sleeveless",
    necklineCoverage: "v-neck",
    shoulderCoverage: false,
    midriffExposed: false,
    material: "silk",
    pattern: "floral",
    primaryColor: "sage green",
    secondaryColors: ["ivory"],
  };
  return JSON.stringify({
    observables,
    matchingSignals: {
      occasions: ["casual", "weekend"],
      seasons: ["spring", "summer"],
      formality: "smart-casual",
      styleTags: ["feminine", "flowy"],
      stylePersonality: "feminine-romantic",
    },
    fieldConfidence: {
      silhouette: "high",
      fitProfile: "medium",
      hemLength: "high",
    },
  });
}

// ── GI-01: structured valid extraction ───────────────────────────────────────

describe("GI-01 structured valid extraction", () => {
  it("normalizeObservables accepts all valid fields", () => {
    const raw = {
      subcategory: "Midi Dress",
      silhouette: "a-line",
      fitProfile: "body-skimming",
      hemLength: "midi",
      topLength: "n/a",
      waistShape: "high-rise",
      sleeveLength: "sleeveless",
      necklineCoverage: "v-neck",
      shoulderCoverage: false,
      midriffExposed: false,
      material: "silk",
      pattern: "floral",
      primaryColor: "Sage Green",
      secondaryColors: ["ivory", "cream", "beige"],
    };
    const obs = normalizeObservables(raw);
    assert.equal(obs.subcategory, "midi dress");
    assert.equal(obs.silhouette, "a-line");
    assert.equal(obs.fitProfile, "body-skimming");
    assert.equal(obs.hemLength, "midi");
    assert.equal(obs.topLength, "n/a");
    assert.equal(obs.waistShape, "high-rise");
    assert.equal(obs.sleeveLength, "sleeveless");
    assert.equal(obs.necklineCoverage, "v-neck");
    assert.equal(obs.shoulderCoverage, false);
    assert.equal(obs.midriffExposed, false);
    assert.equal(obs.material, "silk");
    assert.equal(obs.pattern, "floral");
    assert.equal(obs.primaryColor, "sage green");
    assert.equal(obs.secondaryColors.length, 2, "secondaryColors capped at 2");
  });

  it("normalizeMatchingSignals accepts all valid fields", () => {
    const raw = {
      occasions: ["casual", "weekend"],
      seasons: ["spring", "summer"],
      formality: "smart-casual",
      styleTags: ["feminine", "flowy", "romantic"],
      stylePersonality: "feminine-romantic",
    };
    const sig = normalizeMatchingSignals(raw);
    assert.deepEqual(sig.occasions, ["casual", "weekend"]);
    assert.deepEqual(sig.seasons, ["spring", "summer"]);
    assert.equal(sig.formality, "smart-casual");
    assert.deepEqual(sig.styleTags, ["feminine", "flowy", "romantic"]);
    assert.equal(sig.stylePersonality, "feminine-romantic");
  });
});

// ── GI-02: uncertain fields → null ───────────────────────────────────────────

describe("GI-02 uncertain/absent fields become null", () => {
  it("null inputs produce null outputs without error", () => {
    const obs = normalizeObservables({
      silhouette: null, fitProfile: null, hemLength: null,
      sleeveLength: null, necklineCoverage: null, primaryColor: null, secondaryColors: [],
    });
    assert.equal(obs.silhouette, null);
    assert.equal(obs.fitProfile, null);
    assert.equal(obs.hemLength, null);
    assert.equal(obs.sleeveLength, null);
    assert.equal(obs.necklineCoverage, null);
    assert.equal(obs.primaryColor, null);
  });

  it("missing keys default to null", () => {
    const obs = normalizeObservables({});
    assert.equal(obs.silhouette, null);
    assert.equal(obs.fitProfile, null);
    assert.equal(obs.material, null);
    assert.equal(obs.pattern, null);
    assert.equal(obs.primaryColor, null);
    assert.deepEqual(obs.secondaryColors, []);
  });

  it("empty string primaryColor becomes null", () => {
    const obs = normalizeObservables({ primaryColor: "" });
    assert.equal(obs.primaryColor, null);
  });
});

// ── GI-03: invalid vocabulary rejection ──────────────────────────────────────

describe("GI-03 invalid vocabulary rejection", () => {
  it("invalid silhouette becomes null", () => {
    assert.equal(normalizeObservables({ silhouette: "trapeze" }).silhouette, null);
  });

  it("invalid fitProfile becomes null", () => {
    assert.equal(normalizeObservables({ fitProfile: "athletic" }).fitProfile, null);
  });

  it("invalid hemLength becomes null", () => {
    assert.equal(normalizeObservables({ hemLength: "above-knee" }).hemLength, null);
  });

  it("invalid sleeveLength becomes null", () => {
    assert.equal(normalizeObservables({ sleeveLength: "cap" }).sleeveLength, null);
  });

  it("invalid necklineCoverage becomes null", () => {
    assert.equal(normalizeObservables({ necklineCoverage: "square" }).necklineCoverage, null);
  });

  it("invalid styleTags are filtered; valid ones kept", () => {
    const sig = normalizeMatchingSignals({
      styleTags: ["feminine", "boho", "flowy", "peasant"], occasions: [], seasons: [],
    });
    assert.deepEqual(sig.styleTags, ["feminine", "flowy"]);
  });

  it("styleTags capped at 3", () => {
    const sig = normalizeMatchingSignals({
      styleTags: ["feminine", "flowy", "romantic", "chic", "elegant"], occasions: [], seasons: [],
    });
    assert.equal(sig.styleTags.length, 3);
  });

  it("invalid stylePersonality becomes null", () => {
    const sig = normalizeMatchingSignals({ stylePersonality: "boho-chic", occasions: [], seasons: [] });
    assert.equal(sig.stylePersonality, null);
  });

  it("invalid formality becomes null", () => {
    const sig = normalizeMatchingSignals({ formality: "semi-formal", occasions: [], seasons: [] });
    assert.equal(sig.formality, null);
  });

  it("invalid occasion tokens are filtered", () => {
    const sig = normalizeMatchingSignals({ occasions: ["casual", "party", "work"], seasons: [] });
    assert.deepEqual(sig.occasions, ["casual", "work"]);
  });

  it("invalid season tokens are filtered", () => {
    const sig = normalizeMatchingSignals({ occasions: [], seasons: ["spring", "monsoon", "winter"] });
    assert.deepEqual(sig.seasons, ["spring", "winter"]);
  });

  it("non-boolean shoulderCoverage becomes null", () => {
    assert.equal(normalizeObservables({ shoulderCoverage: "yes" }).shoulderCoverage, null);
  });

  it("non-boolean midriffExposed becomes null", () => {
    assert.equal(normalizeObservables({ midriffExposed: 1 }).midriffExposed, null);
  });
});

// ── GI-04: analysis failure preserves user-supplied fields ───────────────────

describe("GI-04 analysis failure preserves user-supplied fields", () => {
  it("on Claude error, only lifecycle fields are written", async () => {
    const { fn, calls } = makePrismaUpdate();

    await runClosetGarmentAnalysis(
      { closetItemId: "item-1", imagePublicId: "img/abc", category: "TOPS" },
      { imageAnalyzer: makeRejectingAnalyzer("Claude timeout"), prismaUpdate: fn, getSignedUrl: makeGetSignedUrl() },
    );

    assert.equal(calls.length, 1);
    const [, written] = calls[0];
    assert.equal(written.analysisStatus, "failed");
    assert.equal(written.category, undefined, "category must not be written");
    assert.equal(written.name, undefined, "name must not be written");
    assert.equal(written.primaryColor, undefined, "primaryColor must not be written on failure");
    assert.equal(written.colors, undefined, "colors must not be written on failure");
  });

  it("on JSON parse error, status becomes 'failed'", async () => {
    const { fn, calls } = makePrismaUpdate();

    await runClosetGarmentAnalysis(
      { closetItemId: "item-2", imagePublicId: "img/def", category: "DRESSES" },
      { imageAnalyzer: makeImageAnalyzer("not json at all"), prismaUpdate: fn, getSignedUrl: makeGetSignedUrl() },
    );

    assert.equal(calls.length, 1);
    assert.equal(calls[0][1].analysisStatus, "failed");
  });

  it("on signedUrl error, persistFailure is called", async () => {
    const { fn, calls } = makePrismaUpdate();

    await runClosetGarmentAnalysis(
      { closetItemId: "item-3", imagePublicId: "img/ghi", category: "TOPS" },
      { imageAnalyzer: makeImageAnalyzer(validExtractionJson()), prismaUpdate: fn, getSignedUrl: makeThrowingGetSignedUrl("Cloudinary config missing") },
    );

    assert.equal(calls.length, 1);
    assert.equal(calls[0][1].analysisStatus, "failed");
  });
});

// ── GI-05: user-supplied values never overwritten ─────────────────────────────

describe("GI-05 user-supplied values never overwritten", () => {
  it("persistExtraction never writes 'category' or 'name'", async () => {
    const { fn, calls } = makePrismaUpdate();

    await runClosetGarmentAnalysis(
      { closetItemId: "item-4", imagePublicId: "img/jkl", category: "DRESSES" },
      { imageAnalyzer: makeImageAnalyzer(validExtractionJson()), prismaUpdate: fn, getSignedUrl: makeGetSignedUrl() },
    );

    const [, written] = calls[0];
    assert.equal(written.category, undefined);
    assert.equal(written.name, undefined);
  });

  it("does not write primaryColor when AI returns null", async () => {
    const json = validExtractionJson({
      subcategory: null, silhouette: "a-line", fitProfile: null, hemLength: "midi",
      topLength: "n/a", waistShape: null, sleeveLength: "sleeveless", necklineCoverage: "v-neck",
      shoulderCoverage: null, midriffExposed: null, material: null, pattern: null,
      primaryColor: null, secondaryColors: [],
    });
    const { fn, calls } = makePrismaUpdate();

    await runClosetGarmentAnalysis(
      { closetItemId: "item-5", imagePublicId: "img/mno", category: "DRESSES" },
      { imageAnalyzer: makeImageAnalyzer(json), prismaUpdate: fn, getSignedUrl: makeGetSignedUrl() },
    );

    const [, written] = calls[0];
    assert.equal(written.primaryColor, undefined, "primaryColor not written when AI returns null");
    assert.equal(written.colors, undefined, "colors not written when no AI color");
  });

  it("does not overwrite user-supplied primaryColor even when AI returns a different value", async () => {
    const { fn, calls } = makePrismaUpdate();

    await runClosetGarmentAnalysis(
      { closetItemId: "item-5b", imagePublicId: "img/pq", category: "DRESSES", userPrimaryColor: "navy" },
      { imageAnalyzer: makeImageAnalyzer(validExtractionJson()), prismaUpdate: fn, getSignedUrl: makeGetSignedUrl() },
    );

    const [, written] = calls[0];
    assert.equal(written.primaryColor, undefined, "AI must not overwrite user-supplied primaryColor");
    assert.equal(written.colors, undefined, "colors array must not be written when user has primaryColor");
  });

  it("writes AI primaryColor when user has not supplied one", async () => {
    const { fn, calls } = makePrismaUpdate();

    await runClosetGarmentAnalysis(
      { closetItemId: "item-5c", imagePublicId: "img/rs", category: "DRESSES", userPrimaryColor: null },
      { imageAnalyzer: makeImageAnalyzer(validExtractionJson()), prismaUpdate: fn, getSignedUrl: makeGetSignedUrl() },
    );

    const [, written] = calls[0];
    assert.equal(written.primaryColor, "sage green", "AI primaryColor written when user has none");
  });

  // ── Pattern precedence ─────────────────────────────────────────────────────

  it("does not overwrite user-supplied pattern even when AI returns a different value", async () => {
    const { fn, calls } = makePrismaUpdate();

    await runClosetGarmentAnalysis(
      { closetItemId: "item-5d", imagePublicId: "img/tu", category: "DRESSES", userPattern: "stripes" },
      { imageAnalyzer: makeImageAnalyzer(validExtractionJson()), prismaUpdate: fn, getSignedUrl: makeGetSignedUrl() },
    );

    const [, written] = calls[0];
    // AI would have written "floral" — must be suppressed
    assert.equal(written.pattern, undefined, "AI must not overwrite user-supplied pattern");
  });

  it("writes AI pattern when user has not supplied one", async () => {
    const { fn, calls } = makePrismaUpdate();

    await runClosetGarmentAnalysis(
      { closetItemId: "item-5e", imagePublicId: "img/vw", category: "DRESSES", userPattern: null },
      { imageAnalyzer: makeImageAnalyzer(validExtractionJson()), prismaUpdate: fn, getSignedUrl: makeGetSignedUrl() },
    );

    const [, written] = calls[0];
    assert.equal(written.pattern, "floral", "AI pattern written when user has none");
  });

  it("preserves user pattern on analysis failure", async () => {
    const { fn, calls } = makePrismaUpdate();

    await runClosetGarmentAnalysis(
      { closetItemId: "item-5f", imagePublicId: "img/xy", category: "TOPS", userPattern: "check" },
      { imageAnalyzer: makeRejectingAnalyzer("timeout"), prismaUpdate: fn, getSignedUrl: makeGetSignedUrl() },
    );

    const [, written] = calls[0];
    assert.equal(written.analysisStatus, "failed");
    assert.equal(written.pattern, undefined, "pattern must not appear in failure write");
  });

  // ── Occasions precedence ───────────────────────────────────────────────────

  it("does not overwrite user-supplied occasions even when AI returns different values", async () => {
    const { fn, calls } = makePrismaUpdate();

    await runClosetGarmentAnalysis(
      { closetItemId: "item-5g", imagePublicId: "img/a1", category: "DRESSES", userOccasions: ["work", "evening"] },
      { imageAnalyzer: makeImageAnalyzer(validExtractionJson()), prismaUpdate: fn, getSignedUrl: makeGetSignedUrl() },
    );

    const [, written] = calls[0];
    assert.equal(written.occasions, undefined, "AI must not overwrite user-supplied occasions");
  });

  it("writes AI occasions when user has supplied none", async () => {
    const { fn, calls } = makePrismaUpdate();

    await runClosetGarmentAnalysis(
      { closetItemId: "item-5h", imagePublicId: "img/b2", category: "DRESSES", userOccasions: [] },
      { imageAnalyzer: makeImageAnalyzer(validExtractionJson()), prismaUpdate: fn, getSignedUrl: makeGetSignedUrl() },
    );

    const [, written] = calls[0];
    assert.deepEqual(written.occasions, ["casual", "weekend"], "AI occasions written when user has none");
  });

  // ── Seasons precedence ─────────────────────────────────────────────────────

  it("does not overwrite user-supplied seasons even when AI returns different values", async () => {
    const { fn, calls } = makePrismaUpdate();

    await runClosetGarmentAnalysis(
      { closetItemId: "item-5i", imagePublicId: "img/c3", category: "DRESSES", userSeasons: ["fall", "winter"] },
      { imageAnalyzer: makeImageAnalyzer(validExtractionJson()), prismaUpdate: fn, getSignedUrl: makeGetSignedUrl() },
    );

    const [, written] = calls[0];
    assert.equal(written.seasons, undefined, "AI must not overwrite user-supplied seasons");
  });

  it("writes AI seasons when user has supplied none", async () => {
    const { fn, calls } = makePrismaUpdate();

    await runClosetGarmentAnalysis(
      { closetItemId: "item-5j", imagePublicId: "img/d4", category: "DRESSES", userSeasons: [] },
      { imageAnalyzer: makeImageAnalyzer(validExtractionJson()), prismaUpdate: fn, getSignedUrl: makeGetSignedUrl() },
    );

    const [, written] = calls[0];
    assert.deepEqual(written.seasons, ["spring", "summer"], "AI seasons written when user has none");
  });
});

// ── GI-06: status transitions ─────────────────────────────────────────────────

describe("GI-06 analysis status transitions", () => {
  it("successful extraction writes analysisStatus: 'ready' with timestamps", async () => {
    const { fn, calls } = makePrismaUpdate();

    await runClosetGarmentAnalysis(
      { closetItemId: "item-6", imagePublicId: "img/pqr", category: "DRESSES" },
      { imageAnalyzer: makeImageAnalyzer(validExtractionJson()), prismaUpdate: fn, getSignedUrl: makeGetSignedUrl() },
    );

    const [, written] = calls[0];
    assert.equal(written.analysisStatus, "ready");
    assert.ok(written.analyzedAt instanceof Date);
    assert.equal(written.analysisSchemaVersion, GARMENT_INTELLIGENCE_SCHEMA_VERSION);
  });

  it("failed extraction writes analysisStatus: 'failed' with timestamps", async () => {
    const { fn, calls } = makePrismaUpdate();

    await runClosetGarmentAnalysis(
      { closetItemId: "item-7", imagePublicId: "img/stu", category: "TOPS" },
      { imageAnalyzer: makeRejectingAnalyzer("network"), prismaUpdate: fn, getSignedUrl: makeGetSignedUrl() },
    );

    const [, written] = calls[0];
    assert.equal(written.analysisStatus, "failed");
    assert.ok(written.analyzedAt instanceof Date);
    assert.equal(written.analysisSchemaVersion, GARMENT_INTELLIGENCE_SCHEMA_VERSION);
  });
});

// ── GI-07: silhouette vocabulary ─────────────────────────────────────────────

describe("GI-07 silhouette vocabulary validation", () => {
  const valid = ["a-line", "straight", "column", "fitted", "flared", "wrap", "shift", "oversized", "balloon", "asymmetric"];
  for (const sil of valid) {
    it(`accepts '${sil}'`, () => {
      assert.equal(normalizeObservables({ silhouette: sil }).silhouette, sil);
    });
  }

  it("rejects tokens not in silhouette vocab", () => {
    assert.equal(normalizeObservables({ silhouette: "empire" }).silhouette, null);
  });
});

// ── GI-08: fitProfile uses Group 2 vocabulary ────────────────────────────────

describe("GI-08 fitProfile Group 2 vocabulary", () => {
  const valid = ["fitted", "body-skimming", "tailored", "structured", "relaxed", "loose", "oversized", "flowy", "n/a"];
  for (const fp of valid) {
    it(`accepts '${fp}'`, () => {
      assert.equal(normalizeObservables({ fitProfile: fp }).fitProfile, fp);
    });
  }
});

// ── GI-09: style tag vocabulary rejection ────────────────────────────────────

describe("GI-09 style tag vocabulary rejection", () => {
  it("drops tokens not in GARMENT_STYLE_TAG_VOCAB", () => {
    const sig = normalizeMatchingSignals({
      styleTags: ["boho", "feminine", "grunge", "flowy"], occasions: [], seasons: [],
    });
    assert.deepEqual(sig.styleTags, ["feminine", "flowy"]);
  });

  it("returns empty array when all tags are invalid", () => {
    const sig = normalizeMatchingSignals({
      styleTags: ["boho", "grunge", "athleisure"], occasions: [], seasons: [],
    });
    assert.deepEqual(sig.styleTags, []);
  });
});

// ── GI-10: stylePersonality V3 archetypes only ───────────────────────────────

describe("GI-10 stylePersonality V3 archetypes only", () => {
  const valid = ["classic-polished", "feminine-romantic", "minimal-relaxed", "bold-edgy", "creative-expressive"];
  for (const sp of valid) {
    it(`accepts V3 archetype '${sp}'`, () => {
      const sig = normalizeMatchingSignals({ stylePersonality: sp, occasions: [], seasons: [] });
      assert.equal(sig.stylePersonality, sp);
    });
  }

  it("rejects V2 archetype tokens", () => {
    for (const v2 of ["classic", "romantic", "natural", "dramatic", "creative"]) {
      const sig = normalizeMatchingSignals({ stylePersonality: v2, occasions: [], seasons: [] });
      assert.equal(sig.stylePersonality, null, `V2 token '${v2}' must be rejected`);
    }
  });
});

// ── GI-11: not_analyzed → user_only evidence ─────────────────────────────────

describe("GI-11 not_analyzed status → user_only evidence level", () => {
  it("item with not_analyzed status has user_only evidence", () => {
    const gi: GarmentIntelligence = {
      source: "closet", sourceId: "item-na", schemaVersion: "1.0",
      userInputs: { category: "TOPS" },
      analysisStatus: "not_analyzed",
    };
    assert.equal(deriveEvidenceLevel(gi), "user_only");
  });
});

// ── GI-12: failed → user_only evidence ───────────────────────────────────────

describe("GI-12 failed analysis → user_only evidence level", () => {
  it("item with failed status has user_only evidence regardless of observables", () => {
    const gi: GarmentIntelligence = {
      source: "closet", sourceId: "item-failed", schemaVersion: "1.0",
      userInputs: { category: "TOPS" },
      analysisStatus: "failed",
      observables: {
        subcategory: null, silhouette: "a-line", fitProfile: "fitted", hemLength: "midi",
        topLength: "n/a", waistShape: null, sleeveLength: "sleeveless", necklineCoverage: "v-neck",
        shoulderCoverage: false, midriffExposed: false,
        material: null, pattern: null, primaryColor: "navy", secondaryColors: [],
      },
    };
    assert.equal(deriveEvidenceLevel(gi), "user_only");
  });
});

// ── GI-13: ready + geometry + styling → ai_full ──────────────────────────────

describe("GI-13 ready + geometry + styling signals → ai_full", () => {
  it("ready status with geometry and styleTags is ai_full", () => {
    const gi: GarmentIntelligence = {
      source: "closet", sourceId: "item-full", schemaVersion: "1.0",
      userInputs: { category: "DRESSES" },
      analysisStatus: "ready",
      observables: {
        subcategory: "midi dress", silhouette: "a-line", fitProfile: "body-skimming",
        hemLength: "midi", topLength: "n/a", waistShape: "high-rise",
        sleeveLength: "sleeveless", necklineCoverage: "v-neck",
        shoulderCoverage: false, midriffExposed: false,
        material: "silk", pattern: "floral", primaryColor: "sage", secondaryColors: [],
      },
      matchingSignals: {
        occasions: ["casual"], seasons: ["spring"],
        formality: "smart-casual", styleTags: ["feminine", "flowy"],
        stylePersonality: "feminine-romantic",
      },
    };
    assert.equal(deriveEvidenceLevel(gi), "ai_full");
  });
});

// ── GI-14: ready + geometry only → ai_partial ────────────────────────────────

describe("GI-14 ready + geometry only → ai_partial", () => {
  it("ready + geometry but no styling signals → ai_partial", () => {
    const gi: GarmentIntelligence = {
      source: "closet", sourceId: "item-partial", schemaVersion: "1.0",
      userInputs: { category: "TOPS" },
      analysisStatus: "ready",
      observables: {
        subcategory: null, silhouette: "straight", fitProfile: "relaxed",
        hemLength: "n/a", topLength: "hip-length", waistShape: null,
        sleeveLength: "full", necklineCoverage: "crew",
        shoulderCoverage: true, midriffExposed: false,
        material: null, pattern: null, primaryColor: null, secondaryColors: [],
      },
      matchingSignals: { occasions: [], seasons: [], formality: null, styleTags: [], stylePersonality: null },
    };
    assert.equal(deriveEvidenceLevel(gi), "ai_partial");
  });

  it("n/a-only geometry fields + styling signals → user_only (n/a does not count as geometry evidence)", () => {
    const gi: GarmentIntelligence = {
      source: "closet", sourceId: "item-na-only", schemaVersion: "1.0",
      userInputs: { category: "TOPS" },
      analysisStatus: "ready",
      observables: {
        subcategory: null, silhouette: null, fitProfile: "n/a",
        hemLength: "n/a", topLength: "n/a", waistShape: null,
        sleeveLength: "n/a", necklineCoverage: "n/a",
        shoulderCoverage: null, midriffExposed: null,
        material: null, pattern: null, primaryColor: null, secondaryColors: [],
      },
      matchingSignals: {
        occasions: ["casual"], seasons: [], formality: null,
        styleTags: ["feminine"], stylePersonality: "feminine-romantic",
      },
    };
    // no geometry evidence, no colour/material → user_only
    assert.equal(deriveEvidenceLevel(gi), "user_only");
  });
});

// ── GI-15: extractGarmentIntelligence strips markdown fences ─────────────────

describe("GI-15 extractGarmentIntelligence strips markdown fences", () => {
  it("handles ```json ... ``` wrapping from Claude", async () => {
    const wrapped = "```json\n" + validExtractionJson() + "\n```";
    const result = await extractGarmentIntelligence(
      "https://cdn.example.com/img.jpg",
      "DRESSES",
      makeImageAnalyzer(wrapped),
    );
    assert.equal(result.observables.silhouette, "a-line");
  });

  it("handles ``` ... ``` without language tag", async () => {
    const wrapped = "```\n" + validExtractionJson() + "\n```";
    const result = await extractGarmentIntelligence(
      "https://cdn.example.com/img.jpg",
      "DRESSES",
      makeImageAnalyzer(wrapped),
    );
    assert.equal(result.observables.fitProfile, "body-skimming");
  });

  it("returns normalized result for valid Claude response", async () => {
    const result = await extractGarmentIntelligence(
      "https://cdn.example.com/img.jpg",
      "DRESSES",
      makeImageAnalyzer(validExtractionJson()),
    );
    assert.equal(result.observables.silhouette, "a-line");
    assert.equal(result.observables.hemLength, "midi");
    assert.equal(result.observables.primaryColor, "sage green");
    assert.equal(result.matchingSignals.stylePersonality, "feminine-romantic");
    assert.equal(result.fieldConfidence.silhouette, "high");
  });

  it("throws on unparseable Claude response", async () => {
    await assert.rejects(
      () => extractGarmentIntelligence(
        "https://cdn.example.com/img.jpg",
        "TOPS",
        makeImageAnalyzer("I cannot analyze this image."),
      ),
    );
  });
});

// ── GI-EDIT: edit-flow trigger logic and reanalysis behavior ─────────────────
// Tests 1–6: source-code assertions that the route wires analysis correctly.
// Tests 7–9: unit tests proving analysis-level behavior for the edit case.

describe("GI-EDIT-1 image replacement triggers reanalysis", () => {
  it("photo-replacement branch calls analyzeClosetGarment with newPublicId", () => {
    // The photo-replacement path must set analysisStatus: "pending" then call analyzeClosetGarment.
    assert.ok(
      closetRoute.includes('analysisStatus: "pending"') &&
      closetRoute.includes("await analyzeClosetGarment("),
      "photo-replacement branch must set pending and await analyzeClosetGarment",
    );
  });
});

describe("GI-EDIT-2 analysis receives the new imagePublicId", () => {
  it("photo-replacement branch passes newPublicId to analyzeClosetGarment", () => {
    // The call to analyzeClosetGarment in the photo-replacement path must pass newPublicId.
    const photoReplacementSection = closetRoute.slice(
      closetRoute.indexOf("// Rerun garment intelligence on the new image"),
    );
    assert.ok(
      photoReplacementSection.includes("imagePublicId: newPublicId"),
      "analyzeClosetGarment must receive newPublicId in photo-replacement branch",
    );
  });
});

describe("GI-EDIT-3 category change triggers reanalysis", () => {
  it("meta-only branch triggers reanalysis when category changed", () => {
    assert.ok(
      closetRoute.includes("categoryChanged && existing.imagePublicId"),
      "meta-only branch must reanalyze when category changes and image exists",
    );
  });
});

describe("GI-EDIT-4 analysis receives the new category", () => {
  it("category-change branch passes updated category to analyzeClosetGarment", () => {
    const categorySection = closetRoute.slice(
      closetRoute.indexOf("Category change invalidates AI intelligence"),
    );
    assert.ok(
      categorySection.includes("category,") && categorySection.includes("analyzeClosetGarment"),
      "category-change branch must pass updated category to analyzeClosetGarment",
    );
  });
});

describe("GI-EDIT-5 name-only change does not trigger reanalysis", () => {
  it("meta-only path without category change skips analyzeClosetGarment", () => {
    // The else branch of the category-changed guard must not call analyzeClosetGarment.
    const elseSection = closetRoute.slice(
      closetRoute.indexOf("} else {\n      await prisma.closetItem.update("),
      closetRoute.indexOf("} else {\n      await prisma.closetItem.update(") + 300,
    );
    assert.ok(
      !elseSection.includes("analyzeClosetGarment"),
      "name-only/color-only change must not call analyzeClosetGarment",
    );
  });
});

describe("GI-EDIT-6 primaryColor-only change does not trigger reanalysis", () => {
  it("category-unchanged path skips analyzeClosetGarment regardless of primaryColor", () => {
    // Same else-branch check — primaryColor alone is not a reanalysis trigger.
    const elseSection = closetRoute.slice(
      closetRoute.indexOf("} else {\n      await prisma.closetItem.update("),
      closetRoute.indexOf("} else {\n      await prisma.closetItem.update(") + 300,
    );
    assert.ok(
      !elseSection.includes("analyzeClosetGarment"),
      "primaryColor-only change must not call analyzeClosetGarment",
    );
  });
});

describe("GI-EDIT-7 reanalysis for edit preserves existing user-entered values", () => {
  it("edit reanalysis passes existing pattern, occasions, seasons as user-supplied", async () => {
    // Simulate: item already has user-selected occasions=["work"] and pattern="stripes".
    // The new analysis must not overwrite them.
    const capturedParams: Array<{ occasions?: string[]; pattern?: string | null }> = [];

    const imageAnalyzer = async (_params: unknown) => validExtractionJson();
    const prismaUpdate = async (_id: string, data: Record<string, unknown>) => {
      capturedParams.push({ occasions: data.occasions as string[], pattern: data.pattern as string });
    };
    const getSignedUrl = makeGetSignedUrl();

    await runClosetGarmentAnalysis(
      {
        closetItemId: "edit-item-1",
        imagePublicId: "img/new-photo",
        category: "TOPS",
        userOccasions: ["work"],      // existing user value
        userPattern: "stripes",       // existing user value
      },
      { imageAnalyzer, prismaUpdate, getSignedUrl },
    );

    // AI from validExtractionJson would write ["casual","weekend"] and "floral" —
    // both must be suppressed because user-entered values are present.
    assert.equal(capturedParams.length, 1);
    assert.equal(capturedParams[0].occasions, undefined, "user occasions must not be overwritten");
    assert.equal(capturedParams[0].pattern, undefined, "user pattern must not be overwritten");
  });
});

describe("GI-EDIT-8 reanalysis failure leaves item saved with status failed", () => {
  it("analysis error during edit reanalysis writes failed status without touching user fields", async () => {
    const { fn, calls } = makePrismaUpdate();

    await runClosetGarmentAnalysis(
      {
        closetItemId: "edit-item-2",
        imagePublicId: "img/new-photo",
        category: "DRESSES",
        userPrimaryColor: "red",
        userPattern: "floral",
        userOccasions: ["evening"],
        userSeasons: ["summer"],
      },
      { imageAnalyzer: makeRejectingAnalyzer("timeout"), prismaUpdate: fn, getSignedUrl: makeGetSignedUrl() },
    );

    assert.equal(calls.length, 1, "exactly one DB write on failure");
    const [id, written] = calls[0];
    assert.equal(id, "edit-item-2");
    assert.equal(written.analysisStatus, "failed");
    // user fields must be absent from the failure write payload
    assert.equal(written.category,      undefined);
    assert.equal(written.primaryColor,  undefined);
    assert.equal(written.pattern,       undefined);
    assert.equal(written.occasions,     undefined);
    assert.equal(written.seasons,       undefined);
  });
});

describe("GI-EDIT-9 stale ready intelligence not retained after image replacement", () => {
  it("photo replacement sets pending before analysis, not ready", () => {
    // Verify the route sets analysisStatus: "pending" in the DB update BEFORE
    // calling analyzeClosetGarment — not "ready" — so stale signals are not
    // exposed as current intelligence during the analysis window.
    const updateSection = closetRoute.slice(
      closetRoute.indexOf("// Image replaced — stale intelligence"),
    );
    assert.ok(
      updateSection.includes('analysisStatus: "pending"'),
      "DB update before reanalysis must set status to pending, not ready",
    );
    assert.ok(
      !updateSection.slice(0, updateSection.indexOf("analyzeClosetGarment")).includes('"ready"'),
      "status must not be set to ready before analysis completes",
    );
  });
});
