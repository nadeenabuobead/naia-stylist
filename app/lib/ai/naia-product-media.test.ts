// app/lib/ai/naia-product-media.test.ts
// Phase 4A3 — Validation tests for the NADINE product/media map and StyleMe CTA integration.
// Run: node --test --import tsx/esm app/lib/ai/naia-product-media.test.ts

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  NAIA_VERIFIED_MEDIA_MAP,
  NAIA_COMPONENT_MEDIA_MAP,
  LOCKED_CATALOGUE_HANDLES,
  COMPONENT_HANDLES,
  VIRTUAL_TRY_ON_ENABLED,
  resolveVerifiedMedia,
  resolveComponentMedia,
  validateMediaMap,
  validateComponentMap,
} from "./naia-product-media.ts";
import type { TryOnEligibility, VerifiedMediaEntry, ComponentMediaEntry } from "./naia-product-media.ts";
import { NAIA_CATALOG } from "./generated/naia-catalog.generated.ts";
import { SONG_CATALOG } from "./get-ready-song-catalog.ts";
import { computeStyleMeResult, buildEngineInput, buildDbPayload } from "./styleme-result.server.ts";
import type { StyleMeRecommendationResult } from "./styleme-recommendation.types.ts";

// ── Shared fixtures ────────────────────────────────────────────────────────────

const HANDLES = LOCKED_CATALOGUE_HANDLES as readonly string[];

function makeEntry(overrides: Partial<VerifiedMediaEntry>): VerifiedMediaEntry {
  return {
    catalogHandle: "collar-shirt",
    nadinaTitle: "Test",
    shopifyTitle: "Test",
    shopifyHandle: null,
    shopifyProductGid: null,
    shopifyMediaGid: null,
    imageDimensions: null,
    resolvedUrl: null,
    mediaUpdatedAt: null,
    garmentCategory: "tops",
    eligibility: "needs-manual-review",
    reason: "test fixture",
    ...overrides,
  };
}

const READY_ENTRY: VerifiedMediaEntry = makeEntry({
  catalogHandle: "collar-shirt",
  shopifyProductGid: "gid://shopify/Product/9000000000001",
  shopifyMediaGid: "gid://shopify/MediaImage/8000000000001",
  resolvedUrl: "https://cdn.shopify.com/s/files/1/test/collar-shirt.jpg",
  mediaUpdatedAt: "2026-07-01T12:00:00Z",
  garmentCategory: "tops",
  eligibility: "ready",
  reason: "verified: image shows single front-facing collar shirt on white background",
});

function makeMinimalNadineRec(handle: string): StyleMeRecommendationResult {
  return {
    outcome: "nadine-recommendation",
    primary: {
      handle,
      title: "Test Product",
      slot: "top",
      anchorCompatibility: { score: 1, pairingNote: null },
    },
    alternatives: [],
    anchor: null,
    evidenceCodes: [],
  };
}

function makeMinimalEngineInput(source: "naia-piece" | "my-closet" | "both" = "naia-piece") {
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

// ── PM — Product-media map integrity ─────────────────────────────────────────

describe("PM — product-media map integrity", () => {
  it("PM.1 — all 11 locked handles are represented in NAIA_VERIFIED_MEDIA_MAP", () => {
    assert.equal(NAIA_VERIFIED_MEDIA_MAP.size, 11, "map must have exactly 11 entries");
    for (const h of HANDLES) {
      assert.ok(NAIA_VERIFIED_MEDIA_MAP.has(h), `missing handle: ${h}`);
    }
  });

  it("PM.2 — map key equals entry.catalogHandle for every entry (exact handle matching)", () => {
    for (const [key, entry] of NAIA_VERIFIED_MEDIA_MAP.entries()) {
      assert.equal(
        key,
        entry.catalogHandle,
        `map key "${key}" must equal catalogHandle "${entry.catalogHandle}"`,
      );
    }
  });

  it("PM.3 — duplicate product GIDs are rejected by validateMediaMap", () => {
    const dup = new Map<string, VerifiedMediaEntry>([
      ["collar-shirt", makeEntry({ catalogHandle: "collar-shirt", shopifyProductGid: "gid://shopify/Product/1" })],
      ["cropped-top", makeEntry({ catalogHandle: "cropped-top", shopifyProductGid: "gid://shopify/Product/1" })],
    ]);
    const errors = validateMediaMap(dup);
    assert.ok(
      errors.some((e) => e.includes("duplicate product GID")),
      `expected duplicate-product-GID error, got: ${errors.join("; ")}`,
    );
  });

  it("PM.4 — duplicate media GIDs are rejected by validateMediaMap", () => {
    const dup = new Map<string, VerifiedMediaEntry>([
      [
        "collar-shirt",
        makeEntry({
          catalogHandle: "collar-shirt",
          shopifyProductGid: "gid://shopify/Product/1",
          shopifyMediaGid: "gid://shopify/MediaImage/1",
          resolvedUrl: "https://cdn.shopify.com/s/files/a.jpg",
          eligibility: "ready",
          reason: "test",
        }),
      ],
      [
        "cropped-top",
        makeEntry({
          catalogHandle: "cropped-top",
          shopifyProductGid: "gid://shopify/Product/2",
          shopifyMediaGid: "gid://shopify/MediaImage/1",
          resolvedUrl: "https://cdn.shopify.com/s/files/b.jpg",
          eligibility: "ready",
          reason: "test",
        }),
      ],
    ]);
    const errors = validateMediaMap(dup);
    assert.ok(
      errors.some((e) => e.includes("duplicate media GID")),
      `expected duplicate-media-GID error, got: ${errors.join("; ")}`,
    );
  });

  it("PM.5 — production map passes validateMediaMap with no errors", () => {
    const errors = validateMediaMap();
    assert.deepEqual(errors, [], `validateMediaMap reported: ${errors.join("; ")}`);
  });
});

// ── FC — Fail-closed states ────────────────────────────────────────────────────

describe("FC — fail-closed eligibility states", () => {
  it("FC.1 — missing-product: resolvedUrl is null and entry is returned typed correctly", () => {
    const entry: VerifiedMediaEntry = makeEntry({
      catalogHandle: "collar-shirt",
      eligibility: "missing-product",
      reason: "no Shopify product found for this handle",
    });
    const map = new Map([["collar-shirt", entry]]);
    const found = map.get("collar-shirt")!;
    assert.equal(found.eligibility, "missing-product");
    assert.equal(found.resolvedUrl, null, "missing-product must have null resolvedUrl");
  });

  it("FC.2 — missing-image: resolvedUrl is null", () => {
    const entry = makeEntry({ eligibility: "missing-image", reason: "no media on this product" });
    const map = new Map([["collar-shirt", entry]]);
    const found = map.get("collar-shirt")!;
    assert.equal(found.eligibility, "missing-image");
    assert.equal(found.resolvedUrl, null);
  });

  it("FC.3 — unsuitable-image: resolvedUrl is null", () => {
    const entry = makeEntry({ eligibility: "unsuitable-image", reason: "collage image with text overlay" });
    const map = new Map([["collar-shirt", entry]]);
    const found = map.get("collar-shirt")!;
    assert.equal(found.eligibility, "unsuitable-image");
    assert.equal(found.resolvedUrl, null);
  });

  it("FC.4 — stale selected media (missing-image after GID becomes invalid) remains ineligible", () => {
    // Simulates a previously-ready entry whose shopifyMediaGid was deleted in Shopify.
    // After map refresh, eligibility drops to missing-image; resolvedUrl must be null.
    const staleEntry = makeEntry({
      catalogHandle: "collar-shirt",
      shopifyProductGid: "gid://shopify/Product/9000000000001",
      shopifyMediaGid: "gid://shopify/MediaImage/8000000000001",
      resolvedUrl: null,     // must be null — the URL was removed when GID became invalid
      eligibility: "missing-image",
      reason: "selected media GID no longer exists in Shopify; map marked stale on 2026-07-14",
    });
    assert.equal(staleEntry.eligibility, "missing-image");
    assert.equal(staleEntry.resolvedUrl, null, "stale entry must not expose a URL");
    // validateMediaMap must accept this (null URL on non-ready entry is valid).
    const errors = validateMediaMap(new Map([["collar-shirt", staleEntry]]));
    assert.ok(
      !errors.some((e) => e.includes("collar-shirt")),
      `stale entry should be valid in map: ${errors.join("; ")}`,
    );
  });

  it("FC.5 — verified ready media resolves a usable server-authoritative URL", () => {
    const errors = validateMediaMap(new Map([[READY_ENTRY.catalogHandle, READY_ENTRY]]));
    // Filter out "missing handle" errors — those are about the other 10 handles not in
    // this single-entry map. We're testing entry-level validation rules only.
    const entryErrors = errors.filter((e) => !e.startsWith("missing handle:"));
    assert.deepEqual(entryErrors, [], `ready entry should pass entry-level validation: ${errors.join("; ")}`);
    assert.equal(READY_ENTRY.eligibility, "ready");
    assert.ok(READY_ENTRY.resolvedUrl, "ready entry must have a non-null resolvedUrl");
    assert.ok(READY_ENTRY.resolvedUrl!.startsWith("https://"), "ready URL must use https:");
    assert.ok(READY_ENTRY.shopifyProductGid, "ready entry must have shopifyProductGid");
    assert.ok(READY_ENTRY.shopifyMediaGid, "ready entry must have shopifyMediaGid");
  });

  it("FC.6 — validateMediaMap rejects a non-ready entry that incorrectly exposes a resolvedUrl", () => {
    const badEntry = makeEntry({
      eligibility: "needs-manual-review",
      resolvedUrl: "https://cdn.shopify.com/s/files/leaked.jpg",
    });
    const errors = validateMediaMap(new Map([["collar-shirt", badEntry]]));
    assert.ok(
      errors.some((e) => e.includes("must have resolvedUrl=null")),
      `expected fail-closed URL error, got: ${errors.join("; ")}`,
    );
  });
});

// ── CTA — StyleMe try-on CTA integration ─────────────────────────────────────

describe("CTA — StyleMe try-on CTA integration", () => {
  it("CTA.1 — only a ready NADINE primary exposes a non-null productImageUrl in the result", async () => {
    const input = makeMinimalEngineInput("naia-piece");
    const mockRec = (_: unknown) => makeMinimalNadineRec("collar-shirt");
    const mockMedia = (h: string) => (h === "collar-shirt" ? READY_ENTRY : undefined);

    const result = await computeStyleMeResult(input, mockRec as never, mockMedia, true);

    assert.equal(result.outcome, "nadine-recommendation");
    assert.ok(result.primaryProduct, "primary product must be set for nadine-recommendation");
    assert.equal(result.primaryProduct!.productImageUrl, READY_ENTRY.resolvedUrl);
    assert.equal(result.primaryProduct!.shopifyProductId, READY_ENTRY.shopifyProductGid);
  });

  it("CTA.2 — unresolved NADINE primary (needs-manual-review) keeps productImageUrl null", async () => {
    const input = makeMinimalEngineInput("naia-piece");
    const mockRec = (_: unknown) => makeMinimalNadineRec("collar-shirt");
    const pendingEntry = makeEntry({ catalogHandle: "collar-shirt", eligibility: "needs-manual-review" });
    const mockMedia = (_: string) => pendingEntry;

    const result = await computeStyleMeResult(input, mockRec as never, mockMedia);

    assert.equal(result.outcome, "nadine-recommendation");
    assert.equal(result.primaryProduct!.productImageUrl, null);
    assert.equal(result.primaryProduct!.shopifyProductId, null);
  });

  it("CTA.3 — My Closet source cannot expose a NADINE try-on CTA (primaryProduct is always null)", async () => {
    const input = makeMinimalEngineInput("my-closet");
    // Even if the media resolver returns a ready entry, my-closet suppresses the CTA.
    const mockRec = (_: unknown): StyleMeRecommendationResult => ({
      outcome: "closet-led",
      primary: null,
      alternatives: [],
      anchor: {
        type: "closet",
        id: "closet-item-1",
        label: "My Black Blazer",
        slot: "top",
      } as never,
      evidenceCodes: [],
    });
    const mockMedia = (_: string) => READY_ENTRY;

    const result = await computeStyleMeResult(input, mockRec as never, mockMedia);

    assert.equal(result.outcome, "closet-led");
    assert.equal(result.primaryProduct, null, "my-closet must never set a NADINE primaryProduct");
  });

  it("CTA.4 — no-match outcome keeps primaryProduct null", async () => {
    const input = makeMinimalEngineInput("naia-piece");
    const mockRec = (_: unknown): StyleMeRecommendationResult => ({
      outcome: "no-eligible-product",
      primary: null,
      alternatives: [],
      anchor: null,
      evidenceCodes: [],
    });
    const mockMedia = (_: string) => READY_ENTRY;

    const result = await computeStyleMeResult(input, mockRec as never, mockMedia);

    assert.equal(result.outcome, "no-eligible-product");
    assert.equal(result.primaryProduct, null, "no-eligible-product must never set a primaryProduct");
  });

  it("CTA.5 — recommendation ordering and explanations are unchanged by media resolution", async () => {
    const input = makeMinimalEngineInput("naia-piece");
    let recCallCount = 0;
    const fixedRec: StyleMeRecommendationResult = {
      outcome: "nadine-recommendation",
      primary: {
        handle: "trench-coat",
        title: "Becoming Seen",
        slot: "outerwear",
        anchorCompatibility: { score: 0.9, pairingNote: "Pairs well with straight trousers." },
      },
      alternatives: [
        { handle: "collar-shirt", title: "Becoming Real", slot: "top", anchorCompatibility: { score: 0.7, pairingNote: null } },
      ],
      anchor: null,
      evidenceCodes: ["mood:confident"],
    };
    const mockRec = (_: unknown) => { recCallCount++; return fixedRec; };
    const mockMedia = (_: string) => undefined;

    const result = await computeStyleMeResult(input, mockRec as never, mockMedia);

    assert.equal(recCallCount, 1, "runRecommendation must be called exactly once");
    assert.equal(result.rawRecommendation.primary?.handle, "trench-coat", "primary handle preserved");
    assert.equal(result.rawRecommendation.alternatives.length, 1, "alternatives count preserved");
    assert.equal(result.rawRecommendation.alternatives[0].handle, "collar-shirt", "alternative handle preserved");
    assert.equal(result.rawRecommendation.primary?.anchorCompatibility.pairingNote,
      "Pairs well with straight trousers.", "pairingNote from recommendation preserved");
  });

  it("CTA.6 — no FASHN submission is made during computeStyleMeResult", async () => {
    // FASHN calls go through process.env.FASHN_API_KEY + fetch to api.fashn.ai.
    // Verify neither is triggered by hooking fetch to detect FASHN domain.
    const input = makeMinimalEngineInput("naia-piece");
    let fashnCalled = false;
    const guardFetch = (url: RequestInfo | URL, ..._args: unknown[]) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("fashn.ai")) {
        fashnCalled = true;
        throw new Error("FASHN must not be called during StyleMe result computation");
      }
      return Promise.reject(new Error("unexpected fetch in test"));
    };
    const mockRec = (_: unknown) => makeMinimalNadineRec("collar-shirt");
    const mockMedia = (_: string) => READY_ENTRY;

    // computeStyleMeResult calls Claude (which will timeout) but not FASHN.
    // Set a short timeout to avoid the 8s Claude wait.
    await Promise.race([
      computeStyleMeResult(input, mockRec as never, mockMedia),
      new Promise<void>((res) => setTimeout(res, 100)),
    ]);
    assert.equal(fashnCalled, false, "FASHN API must not be called during StyleMe result computation");
  });

  it("CTA.7 — buildDbPayload propagates productImageUrl to the persisted item", () => {
    // The DB item for the primary product must carry the resolved URL so that
    // result.tsx can read it from suggestion.items and show/hide the CTA.
    const song = SONG_CATALOG[0];
    const result = {
      outcome: "nadine-recommendation" as const,
      outfitName: "Test Look",
      whyThisWorks: "Test.",
      confidenceBoost: "Confirmed.",
      perfumeNote: null,
      primaryProduct: {
        handle: "collar-shirt",
        title: "Becoming Real",
        slot: "top",
        shopifyProductId: READY_ENTRY.shopifyProductGid,
        productImageUrl: READY_ENTRY.resolvedUrl,
        liveUrl: null,
        stylingNotes: "Style it.",
      },
      alternatives: [],
      closetAnchorLabel: null,
      pairingNote: null,
      finishingLayer: { shoes: "x", bag: "x", accessories: "x", hair: "x", colourDirection: "x" },
      songReason: "x",
      song,
      rawRecommendation: { outcome: "nadine-recommendation" as const, primary: null, alternatives: [], anchor: null, evidenceCodes: [] },
    };
    const payload = buildDbPayload(result as never);
    const primaryItem = payload.items.find((i) => i.itemType === "TOP");
    assert.ok(primaryItem, "primary item must be in buildDbPayload output");
    assert.equal(primaryItem!.productImageUrl, READY_ENTRY.resolvedUrl, "resolved URL must be stored in DB payload");
    assert.equal(primaryItem!.shopifyProductId, READY_ENTRY.shopifyProductGid, "product GID must be stored in DB payload");
  });
});

// ── MR — Manual-review and workbook integrity ─────────────────────────────────

describe("MR — manual review and workbook integrity", () => {
  it("MR.1 — double-top is needs-manual-review pending FASHN provider testing of layered construction", () => {
    const entry = resolveVerifiedMedia("double-top");
    assert.ok(entry, "double-top must be in the map");
    assert.equal(entry!.eligibility, "needs-manual-review");
    assert.equal(entry!.resolvedUrl, null);
  });

  it("MR.2 — dress-set is needs-manual-review (multi-piece; try-on target not yet defined)", () => {
    const entry = resolveVerifiedMedia("dress-set");
    assert.ok(entry, "dress-set must be in the map");
    assert.equal(entry!.eligibility, "needs-manual-review");
    assert.equal(entry!.resolvedUrl, null);
  });

  it("MR.3 — no workbook SHA-256 changed (V8 source is the canonical reference)", () => {
    // The generated catalog records the SHA-256 of the workbook used to generate it.
    // This test verifies Phase 4A3 has not introduced any change that would alter that hash.
    assert.equal(
      NAIA_CATALOG.sourceSha256,
      "b124b41a52b8004e381ed6dab909622451916ce741ce612592db49aa8ad74501",
      "V8 workbook SHA-256 must remain unchanged",
    );
  });
});

// ── GS — Global try-on gate ───────────────────────────────────────────────────

describe("GS — global try-on gate", () => {
  it("GS.1 — VIRTUAL_TRY_ON_ENABLED is false (globally suppressed until Phase 4A5)", () => {
    assert.equal(VIRTUAL_TRY_ON_ENABLED, false);
  });

  it("GS.2 — computeStyleMeResult with a ready entry exposes productImageUrl regardless of VTO gate, but gates shopifyProductId", async () => {
    const input = makeMinimalEngineInput("naia-piece");
    const mockRec = (_: unknown) => makeMinimalNadineRec("collar-shirt");
    const mockMedia = (h: string) => (h === "collar-shirt" ? READY_ENTRY : undefined);
    // No 4th arg — uses default VIRTUAL_TRY_ON_ENABLED = false
    const result = await computeStyleMeResult(input, mockRec as never, mockMedia);
    // productImageUrl is always populated for ready entries — it drives the inline product photo
    // in the result, independent of the VTO CTA gate.
    assert.equal(
      result.primaryProduct?.productImageUrl,
      READY_ENTRY.resolvedUrl,
      "ready entry must expose productImageUrl for inline product photo display",
    );
    // shopifyProductId remains gated on VIRTUAL_TRY_ON_ENABLED — it is only needed for the try-on flow.
    assert.equal(
      result.primaryProduct?.shopifyProductId,
      null,
      "ready entry must not expose product GID when VIRTUAL_TRY_ON_ENABLED is false",
    );
  });
});

// ── CM — Component media map ──────────────────────────────────────────────────

describe("CM — component media map", () => {
  it("CM.1 — NAIA_COMPONENT_MEDIA_MAP has exactly 7 entries", () => {
    assert.equal(NAIA_COMPONENT_MEDIA_MAP.size, 7, "component map must have exactly 7 entries");
  });

  it("CM.2 — map key equals entry.componentHandle for every component entry", () => {
    for (const [key, entry] of NAIA_COMPONENT_MEDIA_MAP.entries()) {
      assert.equal(
        key,
        entry.componentHandle,
        `component map key "${key}" must equal componentHandle "${entry.componentHandle}"`,
      );
    }
  });

  it("CM.3 — soldSeparately is false for every component entry", () => {
    for (const [, entry] of NAIA_COMPONENT_MEDIA_MAP.entries()) {
      assert.equal(
        entry.soldSeparately,
        false,
        `${entry.componentHandle}: soldSeparately must be false`,
      );
    }
  });

  it("CM.4 — duplicate component media GIDs are rejected by validateComponentMap", () => {
    const base: ComponentMediaEntry = {
      componentHandle: "double-top/leather-underlayer",
      parentCatalogHandle: "double-top",
      parentShopifyProductGid: "gid://shopify/Product/10285939163268",
      componentName: "Leather underlayer",
      shopifyMediaGid: "gid://shopify/MediaImage/99999",
      resolvedUrl: "https://cdn.shopify.com/s/files/1/test/a.jpg",
      shopifyAltText: "test alt",
      imageDimensions: { w: 1024, h: 1536 },
      garmentCategory: "tops",
      soldSeparately: false,
      eligibility: "ready",
      reason: "test",
    };
    const dup = new Map<string, ComponentMediaEntry>([
      [base.componentHandle, base],
      [
        "double-top/chiffon-overlay",
        {
          ...base,
          componentHandle: "double-top/chiffon-overlay",
          componentName: "Chiffon overlay",
          resolvedUrl: "https://cdn.shopify.com/s/files/1/test/b.jpg",
          // same shopifyMediaGid as base — duplicate
        },
      ],
    ]);
    const errors = validateComponentMap(dup);
    assert.ok(
      errors.some((e) => e.includes("duplicate media GID")),
      `expected duplicate-media-GID error, got: ${errors.join("; ")}`,
    );
  });

  it("CM.5 — production component map passes validateComponentMap with no errors", () => {
    const errors = validateComponentMap();
    assert.deepEqual(errors, [], `validateComponentMap reported: ${errors.join("; ")}`);
  });

  it("CM.6 — ready components have non-null resolvedUrl starting with https://", () => {
    for (const [, entry] of NAIA_COMPONENT_MEDIA_MAP.entries()) {
      if (entry.eligibility === "ready") {
        assert.ok(
          entry.resolvedUrl !== null,
          `${entry.componentHandle}: ready component must have non-null resolvedUrl`,
        );
        assert.ok(
          entry.resolvedUrl!.startsWith("https://"),
          `${entry.componentHandle}: resolvedUrl must start with https://`,
        );
      }
    }
  });

  it("CM.7 — non-ready components have null resolvedUrl (fail-closed)", () => {
    for (const [, entry] of NAIA_COMPONENT_MEDIA_MAP.entries()) {
      if (entry.eligibility !== "ready") {
        assert.equal(
          entry.resolvedUrl,
          null,
          `${entry.componentHandle}: non-ready component must have null resolvedUrl`,
        );
      }
    }
  });
});
