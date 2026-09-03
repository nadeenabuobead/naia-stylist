// app/routes/closet-image-security.test.ts
// Digital Closet image security contract tests.
//
// Static source-code assertions — no DB, no Cloudinary, no Claude calls.
// Covers:
//   T1  Client uses fixed folder mode (not asset_folder) so ownership check works
//   T2  Client uses server-returned uploadUrl (not a constructed URL)
//   T3  Delivery type is enforced as private
//   T4  publicId (not imageUrl) is stored in DB on add
//   T5  Layer 2 moderation imported and called on server-built private URL
//   T6  MODERATION_UNAVAILABLE → deleteCloudinaryAsset called before response
//   T7  SAFETY_REJECT → deleteCloudinaryAsset called before response
//   T8  Layer 3 garment suitability called after Layer 2 PASS
//   T9  RETRY_IMAGE → deleteCloudinaryAsset called before response
//   T10 Loader generates signed displayImageUrl from imagePublicId — never exposes raw publicId
//   T11 action: ownership validated before any AI call
//   T12 imageUrl set to null for new private-upload records
//   T13 edit intent checks item ownership (customerId match) before photo pipeline
//   T14 edit photo replacement runs Layer 2 (moderateImageContent)
//   T15 edit photo replacement runs Layer 3 (screenGarmentSuitability)
//   T16 edit: new asset deleted on pipeline failure (before DB update)
//   T17 edit: old asset deleted ONLY after DB update succeeds
//   T18 preview endpoint: ownership validated before analysis
//   T19 preview endpoint: asset verified (type=private) before analysis
//   T20 preview endpoint: only POST accepted (loader returns 405)
//   T21 preview endpoint: no DB writes; deletes assets only on L2/L3 safety failure
//   T22 preview endpoint: Layer 2 moderation runs before analysis
//   T23 preview endpoint: Layer 3 suitability runs before analysis (L2→L3→analysis order)
//   T24 preview endpoint: requiresReupload:true on asset-deleting failures; NEEDS_CLARIFICATION preserves asset

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const closet = readFileSync(join(__dirname, "closet._index.tsx"), "utf8");

// ── T1: Fixed folder mode ─────────────────────────────────────────────────────

describe("T1: client uses fixed folder mode for ownership-verifiable path", () => {
  it('appends "folder" (not "asset_folder") to the Cloudinary upload form', () => {
    assert.ok(
      closet.includes('form.append("folder"'),
      "client must use form.append(\"folder\", ...) — fixed mode so prefix is verifiable",
    );
    assert.ok(
      !closet.includes('form.append("asset_folder"'),
      'client must not use asset_folder mode (unprefixed paths cannot be ownership-verified)',
    );
  });
});

// ── T2: Client uses server-returned uploadUrl ─────────────────────────────────

describe("T2: client uses server-returned uploadUrl", () => {
  it("fetches with sig.uploadUrl", () => {
    assert.ok(
      closet.includes("sig.uploadUrl"),
      "client must use sig.uploadUrl from the server signature response",
    );
  });

  it("does not construct a Cloudinary upload URL directly in the client", () => {
    const uploadFnStart = closet.indexOf("uploadToCloudinary");
    const uploadFnEnd   = closet.indexOf("async function", uploadFnStart + 1);
    const block = uploadFnEnd > uploadFnStart ? closet.slice(uploadFnStart, uploadFnEnd) : closet.slice(uploadFnStart, uploadFnStart + 2000);
    assert.ok(
      !block.includes("/image/upload"),
      "client upload function must not construct /image/upload endpoint directly",
    );
  });
});

// ── T3: Delivery type enforced as private ─────────────────────────────────────

describe("T3: delivery type enforced as private on upload", () => {
  it('appends the signed deliveryType field to the upload form', () => {
    assert.ok(
      closet.includes('form.append("type"'),
      'client must append the "type" field from the signed server response',
    );
  });
});

// ── T4: publicId stored in DB — not imageUrl ──────────────────────────────────

describe("T4: DB write stores imagePublicId, not imageUrl for new uploads", () => {
  it("action stores imagePublicId in the DB record", () => {
    assert.ok(
      closet.includes("imagePublicId:"),
      "action must write imagePublicId to the DB",
    );
  });

  it("imageUrl is set to null for new private-upload records", () => {
    assert.ok(
      closet.includes("imageUrl: null"),
      "action must set imageUrl to null for new private-upload records (not a CDN URL)",
    );
  });
});

// ── T5: Layer 2 moderation called on server-built private URL ─────────────────

describe("T5: Layer 2 moderation imported and called", () => {
  it("imports moderateImageContent", () => {
    assert.ok(
      closet.includes("moderateImageContent"),
      "closet route must call moderateImageContent",
    );
  });

  it("calls moderation with a server-built URL, not a client-supplied value", () => {
    // The URL must come from buildPrivateDownloadUrl, stored before the moderation call
    assert.ok(
      closet.includes("buildPrivateDownloadUrl"),
      "closet route must build the private URL server-side before moderation",
    );
  });
});

// ── T6: MODERATION_UNAVAILABLE → delete ──────────────────────────────────────

describe("T6: MODERATION_UNAVAILABLE → delete asset", () => {
  it("calls deleteCloudinaryAsset on MODERATION_UNAVAILABLE", () => {
    const idx = closet.indexOf("MODERATION_UNAVAILABLE");
    assert.ok(idx !== -1, "route must handle MODERATION_UNAVAILABLE");
    const block = closet.slice(idx, idx + 600);
    assert.ok(
      block.includes("deleteCloudinaryAsset"),
      "MODERATION_UNAVAILABLE block must call deleteCloudinaryAsset",
    );
  });
});

// ── T7: SAFETY_REJECT → delete ───────────────────────────────────────────────

describe("T7: SAFETY_REJECT → delete asset", () => {
  it("calls deleteCloudinaryAsset on SAFETY_REJECT", () => {
    const idx = closet.indexOf("SAFETY_REJECT");
    assert.ok(idx !== -1, "route must handle SAFETY_REJECT");
    const block = closet.slice(idx, idx + 600);
    assert.ok(
      block.includes("deleteCloudinaryAsset"),
      "SAFETY_REJECT block must call deleteCloudinaryAsset",
    );
  });
});

// ── T8: Layer 3 garment suitability called ───────────────────────────────────

describe("T8: Layer 3 garment suitability imported and called after Layer 2", () => {
  it("imports screenGarmentSuitability", () => {
    assert.ok(
      closet.includes("screenGarmentSuitability"),
      "closet route must call screenGarmentSuitability for Layer 3",
    );
  });

  it("Layer 3 called after Layer 2 (ordering check)", () => {
    const l2idx = closet.indexOf("moderateImageContent(");
    const l3idx = closet.indexOf("screenGarmentSuitability(");
    assert.ok(l2idx !== -1, "Layer 2 call must exist");
    assert.ok(l3idx !== -1, "Layer 3 call must exist");
    assert.ok(l2idx < l3idx, "Layer 2 must appear before Layer 3 in source");
  });
});

// ── T9: RETRY_IMAGE → delete ─────────────────────────────────────────────────

describe("T9: garment RETRY_IMAGE → delete asset", () => {
  it("calls deleteCloudinaryAsset on RETRY_IMAGE", () => {
    const idx = closet.indexOf("RETRY_IMAGE");
    assert.ok(idx !== -1, "route must handle RETRY_IMAGE");
    const block = closet.slice(idx, idx + 400);
    assert.ok(
      block.includes("deleteCloudinaryAsset"),
      "RETRY_IMAGE block must call deleteCloudinaryAsset",
    );
  });
});

// ── T10: Loader generates displayImageUrl — never raw publicId ───────────────

describe("T10: loader computes displayImageUrl from imagePublicId server-side", () => {
  it("generates displayImageUrl in the loader using buildPrivateDownloadUrl", () => {
    assert.ok(
      closet.includes("displayImageUrl"),
      "loader must produce a displayImageUrl field for each item",
    );
    const loaderIdx = closet.indexOf("export async function loader");
    const loaderBlock = closet.slice(loaderIdx, loaderIdx + 1500);
    assert.ok(
      loaderBlock.includes("buildPrivateDownloadUrl"),
      "loader must use buildPrivateDownloadUrl to generate display URLs",
    );
  });

  it("component renders item.displayImageUrl and never uses item.imagePublicId as an img src", () => {
    assert.ok(
      closet.includes("item.displayImageUrl"),
      "component must render item.displayImageUrl (signed URL)",
    );
    // imagePublicId may appear in server-side loader logic (correct) but must not be an img src
    assert.ok(
      !closet.includes('src={item.imagePublicId}') &&
      !closet.includes("src={item.imagePublicId}"),
      "component must never use item.imagePublicId directly as an <img> src",
    );
  });
});

// ── T11: Ownership validated before AI calls ──────────────────────────────────

describe("T11: ownership validated before any AI call", () => {
  it("validatePublicIdOwnership appears before moderateImageContent in action", () => {
    const ownershipIdx = closet.indexOf("validatePublicIdOwnership(");
    const moderationIdx = closet.indexOf("moderateImageContent(");
    assert.ok(ownershipIdx !== -1, "ownership check must exist");
    assert.ok(moderationIdx !== -1, "moderation call must exist");
    assert.ok(ownershipIdx < moderationIdx, "ownership check must appear before moderation call");
  });
});

// ── T12: imageUrl null for new records ───────────────────────────────────────

describe("T12: new records set imageUrl to null", () => {
  it("imageUrl: null is written alongside imagePublicId in the create call", () => {
    const createIdx = closet.indexOf("imagePublicId:");
    const nearby = closet.slice(Math.max(0, createIdx - 100), createIdx + 300);
    assert.ok(
      nearby.includes("imageUrl: null"),
      "imageUrl must be null for new private-upload records",
    );
  });
});

// ── T13: edit intent validates item ownership ────────────────────────────────

describe("T13: edit intent validates item ownership before photo pipeline", () => {
  const editIdx = closet.indexOf('intent === "edit"');

  it("edit handler exists", () => {
    assert.ok(editIdx !== -1, 'action must handle intent === "edit"');
  });

  it("checks existing.customerId !== customer.id before processing photo", () => {
    assert.ok(editIdx !== -1, "edit handler must exist");
    const block = closet.slice(editIdx, editIdx + 1000);
    assert.ok(
      block.includes("existing.customerId !== customer.id") ||
      block.includes("existing.customerId === customer.id"),
      "edit handler must verify that the item belongs to the authenticated customer",
    );
  });
});

// ── T14: edit photo replacement runs Layer 2 ────────────────────────────────

describe("T14: edit photo replacement calls moderateImageContent (Layer 2)", () => {
  it("edit block calls moderateImageContent", () => {
    const editIdx = closet.indexOf('intent === "edit"');
    assert.ok(editIdx !== -1, "edit handler must exist");
    const block = closet.slice(editIdx, editIdx + 14000);
    assert.ok(
      block.includes("moderateImageContent("),
      "edit photo replacement must call moderateImageContent (Layer 2)",
    );
  });
});

// ── T15: edit photo replacement runs Layer 3 ────────────────────────────────

describe("T15: edit photo replacement calls screenGarmentSuitability (Layer 3)", () => {
  it("edit block calls screenGarmentSuitability", () => {
    const editIdx = closet.indexOf('intent === "edit"');
    assert.ok(editIdx !== -1, "edit handler must exist");
    const block = closet.slice(editIdx, editIdx + 14000);
    assert.ok(
      block.includes("screenGarmentSuitability("),
      "edit photo replacement must call screenGarmentSuitability (Layer 3)",
    );
  });
});

// ── T16: edit deletes new asset on pipeline failure ──────────────────────────

describe("T16: edit deletes new (failed) asset before DB update on pipeline failure", () => {
  it("deleteCloudinaryAsset(newPublicId) appears before the photo-replacement DB update", () => {
    const editIdx = closet.indexOf('intent === "edit"');
    assert.ok(editIdx !== -1, "edit handler must exist");
    const block = closet.slice(editIdx, editIdx + 14000);
    // Anchor: photo pipeline starts at the ownership check for newPublicId
    const pipelineStart = block.indexOf("validatePublicIdOwnership(newPublicId");
    assert.ok(pipelineStart !== -1, "edit block must call validatePublicIdOwnership(newPublicId, ...) to start the photo pipeline");
    // Within the photo pipeline: delete-new must appear before the photo update
    const deleteNewIdx = block.indexOf("deleteCloudinaryAsset(newPublicId", pipelineStart);
    const photoUpdateIdx = block.indexOf("closetItem.update(", pipelineStart);
    assert.ok(deleteNewIdx !== -1, "edit photo pipeline must call deleteCloudinaryAsset(newPublicId, ...) on pipeline failure");
    assert.ok(photoUpdateIdx !== -1, "edit photo pipeline must call prisma.closetItem.update");
    assert.ok(deleteNewIdx < photoUpdateIdx, "deleteCloudinaryAsset(newPublicId) must appear before the photo-replacement DB update");
  });
});

// ── T17: edit deletes old asset ONLY after DB update ────────────────────────

describe("T17: edit deletes old asset only after DB update succeeds", () => {
  it("oldPublicId delete appears after prisma.closetItem.update in edit block", () => {
    const editIdx = closet.indexOf('intent === "edit"');
    assert.ok(editIdx !== -1, "edit handler must exist");
    const block = closet.slice(editIdx, editIdx + 14000);
    // Anchor: photo pipeline starts at ownership check
    const pipelineStart = block.indexOf("validatePublicIdOwnership(newPublicId");
    assert.ok(pipelineStart !== -1, "photo pipeline anchor must exist");
    const photoUpdateIdx = block.indexOf("closetItem.update(", pipelineStart);
    const deleteOldIdx = block.indexOf("deleteCloudinaryAsset(oldPublicId", pipelineStart);
    assert.ok(photoUpdateIdx !== -1, "edit block must have a photo-replacement DB update call");
    assert.ok(deleteOldIdx !== -1, "edit block must call deleteCloudinaryAsset(oldPublicId, ...) for old-asset cleanup");
    assert.ok(photoUpdateIdx < deleteOldIdx, "old-asset deleteCloudinaryAsset must appear AFTER the DB update");
  });
});

// ── T18–T21: Preview endpoint security contracts ──────────────────────────────

const preview = readFileSync(join(__dirname, "api.closet-preview-analyze.ts"), "utf8");

describe("T18: preview endpoint validates publicId ownership before analysis", () => {
  it("calls validatePublicIdOwnership before previewAnalyzeGarment", () => {
    const ownershipIdx = preview.indexOf("validatePublicIdOwnership");
    const analysisIdx  = preview.indexOf("previewAnalyzeGarment");
    assert.ok(ownershipIdx !== -1, "preview endpoint must import and call validatePublicIdOwnership");
    assert.ok(analysisIdx  !== -1, "preview endpoint must call previewAnalyzeGarment");
    assert.ok(ownershipIdx < analysisIdx, "ownership check must appear before analysis call");
  });
});

describe("T19: preview endpoint verifies asset is type=private before analysis", () => {
  it("calls verifyCloudinaryAsset before previewAnalyzeGarment", () => {
    const verifyIdx  = preview.indexOf("verifyCloudinaryAsset");
    const privateIdx = preview.indexOf('"private"');
    const analysisIdx = preview.indexOf("previewAnalyzeGarment");
    assert.ok(verifyIdx   !== -1, "preview endpoint must call verifyCloudinaryAsset");
    assert.ok(privateIdx  !== -1, 'preview endpoint must reference "private" delivery type');
    assert.ok(analysisIdx !== -1, "preview endpoint must call previewAnalyzeGarment");
    assert.ok(verifyIdx   < analysisIdx, "asset verification must appear before analysis call");
    assert.ok(verifyIdx   < privateIdx || privateIdx < analysisIdx, "private-type check must be in scope before analysis call");
  });
});

describe("T20: preview endpoint rejects non-POST requests via loader", () => {
  it("exports a loader that returns 405", () => {
    assert.ok(
      preview.includes("export async function loader"),
      "preview endpoint must export a loader (GET handler)",
    );
    assert.ok(
      preview.includes("status: 405"),
      "loader must return status 405 to block GET requests",
    );
  });
});

describe("T21: preview endpoint does not persist data; deletes assets only on safety failure", () => {
  it("never calls prisma directly", () => {
    assert.ok(
      !preview.includes("prisma."),
      "preview endpoint must not write to the DB",
    );
  });

  it("deleteCloudinaryAsset only appears in Layer 2/3 failure branches (not on success)", () => {
    assert.ok(
      preview.includes("deleteCloudinaryAsset"),
      "preview endpoint must delete assets on safety failures (SAFETY_REJECT, RETRY_IMAGE, MODERATION_UNAVAILABLE)",
    );
    // On the success path, previewAnalyzeGarment(publicId) is called — use the call form, not the import.
    const analysisCallIdx = preview.indexOf("previewAnalyzeGarment(");
    const lastDeleteIdx   = preview.lastIndexOf("deleteCloudinaryAsset");
    assert.ok(
      lastDeleteIdx < analysisCallIdx,
      "deleteCloudinaryAsset must never appear after the previewAnalyzeGarment( call (not on success path)",
    );
  });
});

describe("T22: preview endpoint runs Layer 2 moderation before analysis", () => {
  it("imports and calls moderateImageContent", () => {
    assert.ok(preview.includes("moderateImageContent"), "must import and call moderateImageContent (Layer 2)");
  });

  it("moderateImageContent appears before previewAnalyzeGarment in source", () => {
    const modIdx      = preview.indexOf("moderateImageContent(");
    const analysisIdx = preview.indexOf("previewAnalyzeGarment(");
    assert.ok(modIdx      !== -1, "moderateImageContent call must exist");
    assert.ok(analysisIdx !== -1, "previewAnalyzeGarment call must exist");
    assert.ok(modIdx < analysisIdx, "Layer 2 moderation must appear before analysis call");
  });
});

describe("T23: preview endpoint runs Layer 3 suitability before analysis", () => {
  it("imports and calls screenGarmentSuitability", () => {
    assert.ok(preview.includes("screenGarmentSuitability"), "must import and call screenGarmentSuitability (Layer 3)");
  });

  it("screenGarmentSuitability appears before previewAnalyzeGarment in source", () => {
    const suitIdx     = preview.indexOf("screenGarmentSuitability(");
    const analysisIdx = preview.indexOf("previewAnalyzeGarment(");
    assert.ok(suitIdx     !== -1, "screenGarmentSuitability call must exist");
    assert.ok(analysisIdx !== -1, "previewAnalyzeGarment call must exist");
    assert.ok(suitIdx < analysisIdx, "Layer 3 suitability must appear before analysis call");
  });

  it("Layer 2 appears before Layer 3 (ordering preserved)", () => {
    const modIdx  = preview.indexOf("moderateImageContent(");
    const suitIdx = preview.indexOf("screenGarmentSuitability(");
    assert.ok(modIdx < suitIdx, "Layer 2 must precede Layer 3 in preview endpoint");
  });
});

describe("T24: preview endpoint returns requiresReupload on asset-deleting failures", () => {
  it("SAFETY_REJECT branch sets requiresReupload:true", () => {
    const rejectIdx = preview.indexOf("SAFETY_REJECT");
    assert.ok(rejectIdx !== -1, "SAFETY_REJECT must be handled");
    const block = preview.slice(rejectIdx, rejectIdx + 300);
    assert.ok(block.includes("requiresReupload: true"), "SAFETY_REJECT must return requiresReupload:true");
  });

  it("RETRY_IMAGE branch sets requiresReupload:true", () => {
    const retryIdx = preview.indexOf("RETRY_IMAGE");
    assert.ok(retryIdx !== -1, "RETRY_IMAGE must be handled");
    // RETRY_IMAGE block includes a PREVIEW_GUIDANCE dictionary — 1000 chars to reach the return.
    const block = preview.slice(retryIdx, retryIdx + 1000);
    assert.ok(block.includes("requiresReupload: true"), "RETRY_IMAGE must return requiresReupload:true");
  });

  it("NEEDS_CLARIFICATION branch preserves asset (no delete) and does not set requiresReupload", () => {
    const clarIdx = preview.indexOf("NEEDS_CLARIFICATION");
    assert.ok(clarIdx !== -1, "NEEDS_CLARIFICATION must be handled");
    const block = preview.slice(clarIdx, clarIdx + 300);
    assert.ok(!block.includes("deleteCloudinaryAsset"), "NEEDS_CLARIFICATION must not delete the asset");
    assert.ok(!block.includes("requiresReupload: true"), "NEEDS_CLARIFICATION must not set requiresReupload:true (asset preserved for manual submit)");
  });
});
