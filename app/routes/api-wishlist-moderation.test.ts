// app/routes/api-wishlist-moderation.test.ts
// BOS (Buy or Skip) moderation contract tests.
//
// Static source-code assertions — no DB, no Cloudinary, no Claude calls.
// Covers the moderation security contracts added in the image-security phase:
//   T1  Layer 2 imported and called on the private asset URL
//   T2  MODERATION_UNAVAILABLE → deleteCloudinaryAsset called before 503 response
//   T3  SAFETY_REJECT → deleteCloudinaryAsset called before 422 response
//   T4  Layer 3 garment suitability imported and called
//   T5  RETRY_IMAGE → deleteCloudinaryAsset called before 422 response
//   T6  NEEDS_CLARIFICATION → proceeds (not deleted)
//   T7  privateImageUrl is built from publicId+serverFormat, never from a client value
//   T8  moderation called before downstream AI analysis (order verification)

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const api = readFileSync(join(__dirname, "api.wishlist.jsx"), "utf8");

// ── T1: Layer 2 imported and called ──────────────────────────────────────────

describe("T1: Layer 2 moderation imported and called on private URL", () => {
  it("imports moderateImageContent from image-moderation.server", () => {
    assert.ok(
      api.includes('from "../lib/image-moderation.server"'),
      "api.wishlist must import from image-moderation.server",
    );
    assert.ok(
      api.includes("moderateImageContent"),
      "api.wishlist must call moderateImageContent",
    );
  });

  it("calls moderation with the server-built private URL, not a client-supplied value", () => {
    assert.ok(
      api.includes("moderateImageContent(privateImageUrl)"),
      "moderation must be called with privateImageUrl (server-built), not a client URL",
    );
  });
});

// ── T2: MODERATION_UNAVAILABLE → delete + 503 ────────────────────────────────

describe("T2: MODERATION_UNAVAILABLE → delete asset + 503", () => {
  it("deletes the asset on MODERATION_UNAVAILABLE", () => {
    const idx = api.indexOf("MODERATION_UNAVAILABLE");
    assert.ok(idx !== -1, "route must handle MODERATION_UNAVAILABLE");
    const block = api.slice(idx, idx + 600);
    assert.ok(
      block.includes("deleteCloudinaryAsset"),
      "MODERATION_UNAVAILABLE block must call deleteCloudinaryAsset",
    );
  });

  it("returns 503 on MODERATION_UNAVAILABLE", () => {
    const idx = api.indexOf("MODERATION_UNAVAILABLE");
    const block = api.slice(idx, idx + 1500);
    assert.ok(
      block.includes("503") || block.includes("status: 503"),
      "MODERATION_UNAVAILABLE must return 503",
    );
  });
});

// ── T3: SAFETY_REJECT → delete + 422 ─────────────────────────────────────────

describe("T3: SAFETY_REJECT → delete asset + 422", () => {
  it("deletes the asset on SAFETY_REJECT", () => {
    const idx = api.indexOf("SAFETY_REJECT");
    assert.ok(idx !== -1, "route must handle SAFETY_REJECT");
    const block = api.slice(idx, idx + 600);
    assert.ok(
      block.includes("deleteCloudinaryAsset"),
      "SAFETY_REJECT block must call deleteCloudinaryAsset",
    );
  });

  it("returns 422 on SAFETY_REJECT", () => {
    const idx = api.indexOf("SAFETY_REJECT");
    const block = api.slice(idx, idx + 1500);
    assert.ok(
      block.includes("422") || block.includes("status: 422"),
      "SAFETY_REJECT must return 422",
    );
  });
});

// ── T4: Layer 3 garment suitability imported and called ──────────────────────

describe("T4: Layer 3 garment suitability imported and called", () => {
  it("imports screenGarmentSuitability from image-suitability.server", () => {
    assert.ok(
      api.includes('from "../lib/image-suitability.server"'),
      "api.wishlist must import from image-suitability.server",
    );
    assert.ok(
      api.includes("screenGarmentSuitability"),
      "api.wishlist must call screenGarmentSuitability",
    );
  });
});

// ── T5: RETRY_IMAGE → delete + 422 ───────────────────────────────────────────

describe("T5: garment RETRY_IMAGE → delete asset + 422", () => {
  it("deletes the asset on RETRY_IMAGE", () => {
    const idx = api.indexOf("RETRY_IMAGE");
    assert.ok(idx !== -1, "route must handle RETRY_IMAGE");
    const block = api.slice(idx, idx + 400);
    assert.ok(
      block.includes("deleteCloudinaryAsset"),
      "RETRY_IMAGE block must call deleteCloudinaryAsset",
    );
  });
});

// ── T6: NEEDS_CLARIFICATION proceeds without deletion ────────────────────────

describe("T6: NEEDS_CLARIFICATION proceeds (no deletion)", () => {
  it("has a NEEDS_CLARIFICATION comment that does NOT delete", () => {
    assert.ok(
      api.includes("NEEDS_CLARIFICATION"),
      "route must reference NEEDS_CLARIFICATION",
    );
    // Deletion must not appear immediately after NEEDS_CLARIFICATION
    const idx = api.indexOf("NEEDS_CLARIFICATION");
    const immediate = api.slice(idx, idx + 100);
    assert.ok(
      !immediate.includes("deleteCloudinaryAsset("),
      "NEEDS_CLARIFICATION branch must not delete the asset",
    );
  });
});

// ── T7: privateImageUrl built server-side ────────────────────────────────────

describe("T7: privateImageUrl is built server-side from known publicId/serverFormat", () => {
  it("builds privateImageUrl from buildPrivateDownloadUrl, not a client value", () => {
    assert.ok(
      api.includes("buildPrivateDownloadUrl"),
      "route must use buildPrivateDownloadUrl to construct the private URL",
    );
    assert.ok(
      api.includes("privateImageUrl"),
      "privateImageUrl variable must be present",
    );
  });
});

// ── T8: moderation before AI analysis ────────────────────────────────────────

describe("T8: moderation called before downstream AI analysis", () => {
  it("moderateImageContent appears before analyzeItem is called", () => {
    const moderationIdx = api.indexOf("moderateImageContent(");
    // Find the CALL to analyzeItem (e.g. "return analyzeItem("), not the definition
    const analysisIdx = api.indexOf("return analyzeItem(");
    assert.ok(moderationIdx !== -1, "moderateImageContent call must exist");
    if (analysisIdx !== -1) {
      assert.ok(
        moderationIdx < analysisIdx,
        "moderateImageContent must be called before the downstream analyzeItem call",
      );
    }
  });
});
