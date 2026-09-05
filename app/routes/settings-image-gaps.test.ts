/**
 * settings-image-gaps.test.ts
 *
 * Tests for the three image-deletion privacy gaps closed in Phase 3:
 *   1. VTO result images  — deleteCustomerVtoResults() + settings action wiring
 *   2. BOS uploaded images — deleteCustomerBosImages() + settings action wiring
 *   3. Closet Cloudinary consistency — deleteClosetItemWithImage() shared helper
 *
 * All tests are source-code assertions (read .ts/.tsx/.jsx files as strings).
 * No Prisma connection, no DOM, no network.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(process.cwd(), "app");

function read(rel: string) {
  return readFileSync(resolve(ROOT, rel), "utf-8");
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const settingsSrc   = read("routes/settings.tsx");
const bosPrivacySrc = read("lib/buy-or-skip-privacy.server.ts");
const vtoDeletionSrc = read("lib/ai/fashn-tryon-service.server.ts");
const closetHelperSrc = read("lib/closet-item-deletion.server.ts");
const apiClosetSrc  = read("routes/api.closet.jsx");
const closetIndexSrc = read("routes/closet._index.tsx");

// ─── Group A: VTO deletion helper ────────────────────────────────────────────

describe("VTO result deletion helper", () => {
  it("exports deleteCustomerVtoResults", () => {
    assert.ok(
      vtoDeletionSrc.includes("export async function deleteCustomerVtoResults("),
      "deleteCustomerVtoResults must be exported from fashn-tryon-service.server.ts",
    );
  });

  it("exports customerHasVtoResults", () => {
    assert.ok(
      vtoDeletionSrc.includes("export async function customerHasVtoResults("),
      "customerHasVtoResults must be exported",
    );
  });

  it("queries only COMPLETED jobs", () => {
    const fnIdx = vtoDeletionSrc.indexOf("async function deleteCustomerVtoResults(");
    const fnBody = vtoDeletionSrc.slice(fnIdx, fnIdx + 600);
    assert.ok(
      fnBody.includes('status: "COMPLETED"'),
      "must filter by COMPLETED status — only completed jobs have result assets",
    );
  });

  it("customerId comes from the function parameter, not client input", () => {
    const fnIdx = vtoDeletionSrc.indexOf("async function deleteCustomerVtoResults(");
    const signature = vtoDeletionSrc.slice(fnIdx, fnIdx + 100);
    assert.ok(
      signature.includes("customerId: string"),
      "customerId must be a typed function parameter",
    );
  });

  it("calls deriveTryOnResultPublicId to get publicId (not from DB field)", () => {
    const fnIdx = vtoDeletionSrc.indexOf("async function deleteCustomerVtoResults(");
    const fnBody = vtoDeletionSrc.slice(fnIdx, fnIdx + 600);
    assert.ok(
      fnBody.includes("deriveTryOnResultPublicId("),
      "must derive publicId via deriveTryOnResultPublicId, not read a DB column",
    );
  });

  it("calls _deleteAsset with the derived publicId", () => {
    const fnIdx = vtoDeletionSrc.indexOf("async function deleteCustomerVtoResults(");
    const fnBody = vtoDeletionSrc.slice(fnIdx, fnIdx + 1200);
    assert.ok(
      fnBody.includes("_deleteAsset(publicId"),
      "must pass derived publicId to _deleteAsset",
    );
  });

  it("accepts injectable _deleteAsset parameter for testability", () => {
    const fnIdx = vtoDeletionSrc.indexOf("async function deleteCustomerVtoResults(");
    const signature = vtoDeletionSrc.slice(fnIdx, fnIdx + 200);
    assert.ok(
      signature.includes("_deleteAsset"),
      "_deleteAsset must be an injectable parameter",
    );
  });

  it("returns DeleteVtoResultsResult shape", () => {
    assert.ok(
      vtoDeletionSrc.includes("DeleteVtoResultsResult"),
      "must export and use DeleteVtoResultsResult interface",
    );
    assert.ok(
      vtoDeletionSrc.includes("deletedCount"),
      "result must include deletedCount",
    );
    assert.ok(
      vtoDeletionSrc.includes("failedAssets"),
      "result must include failedAssets",
    );
  });
});

// ─── Group B: BOS deletion helper ────────────────────────────────────────────

describe("BOS image deletion helper", () => {
  it("exports deleteCustomerBosImages", () => {
    assert.ok(
      bosPrivacySrc.includes("export async function deleteCustomerBosImages("),
      "deleteCustomerBosImages must be exported",
    );
  });

  it("exports customerHasBosImages", () => {
    assert.ok(
      bosPrivacySrc.includes("export async function customerHasBosImages("),
      "customerHasBosImages must be exported",
    );
  });

  it("customerId is a typed function parameter, not read from a DB column", () => {
    const fnIdx = bosPrivacySrc.indexOf("async function deleteCustomerBosImages(");
    const signature = bosPrivacySrc.slice(fnIdx, fnIdx + 100);
    assert.ok(
      signature.includes("customerId: string"),
      "customerId must be a typed function parameter",
    );
  });

  it("deletes imagePublicId from Cloudinary", () => {
    const fnIdx = bosPrivacySrc.indexOf("async function deleteCustomerBosImages(");
    const fnBody = bosPrivacySrc.slice(fnIdx, fnIdx + 1000);
    assert.ok(
      fnBody.includes("_deleteAsset(analysis.imagePublicId"),
      "must call _deleteAsset with imagePublicId",
    );
  });

  it("clears imagePublicId, imageFormat, imageUrl in DB", () => {
    const fnIdx = bosPrivacySrc.indexOf("async function deleteCustomerBosImages(");
    const fnBody = bosPrivacySrc.slice(fnIdx, fnIdx + 1500);
    assert.ok(fnBody.includes("imagePublicId: null"), "must clear imagePublicId");
    assert.ok(fnBody.includes("imageFormat:   null") || fnBody.includes("imageFormat: null"), "must clear imageFormat");
    assert.ok(fnBody.includes("imageUrl:      null") || fnBody.includes("imageUrl: null"), "must clear imageUrl");
  });

  it("does NOT clear verdict, reasoning, fullAnalysis, or outcome fields", () => {
    const fnIdx = bosPrivacySrc.indexOf("async function deleteCustomerBosImages(");
    const fnBody = bosPrivacySrc.slice(fnIdx, fnIdx + 1500);
    assert.ok(!fnBody.includes("verdict: null"), "must NOT clear verdict");
    assert.ok(!fnBody.includes("reasoning: null"), "must NOT clear reasoning");
    assert.ok(!fnBody.includes("fullAnalysis: null"), "must NOT clear fullAnalysis");
    assert.ok(!fnBody.includes("outcome: null"), "must NOT clear outcome");
  });

  it("handles legacy imageUrl-only records (no imagePublicId)", () => {
    const fnIdx = bosPrivacySrc.indexOf("async function deleteCustomerBosImages(");
    const fnBody = bosPrivacySrc.slice(fnIdx, fnIdx + 2000);
    assert.ok(
      fnBody.includes("imagePublicId: null, imageUrl: { not: null }"),
      "must handle legacy records that only have imageUrl",
    );
  });

  it("returns DeleteBosImagesResult with deletedCount, clearedCount, failedAssets", () => {
    assert.ok(bosPrivacySrc.includes("DeleteBosImagesResult"), "must export interface");
    assert.ok(bosPrivacySrc.includes("deletedCount"), "must include deletedCount");
    assert.ok(bosPrivacySrc.includes("clearedCount"), "must include clearedCount");
    assert.ok(bosPrivacySrc.includes("failedAssets"), "must include failedAssets");
  });

  it("accepts injectable _deleteAsset parameter", () => {
    const fnIdx = bosPrivacySrc.indexOf("async function deleteCustomerBosImages(");
    const signature = bosPrivacySrc.slice(fnIdx, fnIdx + 200);
    assert.ok(signature.includes("_deleteAsset"), "_deleteAsset must be injectable");
  });
});

// ─── Group C: Closet deletion consistency ────────────────────────────────────

describe("Closet item deletion — shared helper", () => {
  it("closet-item-deletion.server.ts exports deleteClosetItemWithImage", () => {
    assert.ok(
      closetHelperSrc.includes("export async function deleteClosetItemWithImage("),
      "deleteClosetItemWithImage must be exported",
    );
  });

  it("helper verifies ownership via customerId filter on findFirst", () => {
    const fnIdx = closetHelperSrc.indexOf("async function deleteClosetItemWithImage(");
    const fnBody = closetHelperSrc.slice(fnIdx, fnIdx + 600);
    assert.ok(
      fnBody.includes("customerId") && fnBody.includes("findFirst"),
      "must use findFirst with customerId to verify ownership",
    );
  });

  it("helper deletes Cloudinary asset before DB record", () => {
    const fnIdx = closetHelperSrc.indexOf("async function deleteClosetItemWithImage(");
    const fnBody = closetHelperSrc.slice(fnIdx, fnIdx + 1000);
    const cloudIdx = fnBody.indexOf("_deleteAsset(");
    const dbIdx    = fnBody.indexOf("prisma.closetItem.delete(");
    assert.ok(cloudIdx > -1, "must call _deleteAsset");
    assert.ok(dbIdx > -1, "must call prisma.closetItem.delete");
    assert.ok(cloudIdx < dbIdx, "Cloudinary deletion must happen before DB deletion");
  });

  it("helper accepts injectable _deleteAsset parameter", () => {
    const fnIdx = closetHelperSrc.indexOf("async function deleteClosetItemWithImage(");
    const signature = closetHelperSrc.slice(fnIdx, fnIdx + 200);
    assert.ok(signature.includes("_deleteAsset"), "_deleteAsset must be injectable");
  });

  it("helper returns NOT_FOUND when item does not belong to customer", () => {
    const fnIdx = closetHelperSrc.indexOf("async function deleteClosetItemWithImage(");
    const fnBody = closetHelperSrc.slice(fnIdx, fnIdx + 600);
    assert.ok(
      fnBody.includes("NOT_FOUND"),
      "must return NOT_FOUND error code when findFirst returns null",
    );
  });

  it("api.closet.jsx delete path uses deleteClosetItemWithImage", () => {
    assert.ok(
      apiClosetSrc.includes("deleteClosetItemWithImage"),
      "api.closet.jsx must use the shared helper for deletes",
    );
    assert.ok(
      !apiClosetSrc.includes("prisma.closetItem.deleteMany"),
      "api.closet.jsx must NOT use deleteMany (bypasses Cloudinary deletion)",
    );
  });

  it("api.closet.jsx imports deleteClosetItemWithImage from closet-item-deletion.server", () => {
    assert.ok(
      apiClosetSrc.includes("closet-item-deletion.server"),
      "api.closet.jsx must import from closet-item-deletion.server",
    );
  });

  it("closet._index.tsx delete intent uses deleteClosetItemWithImage", () => {
    assert.ok(
      closetIndexSrc.includes("deleteClosetItemWithImage"),
      "closet._index.tsx must use the shared helper for delete intent",
    );
  });

  it("closet._index.tsx imports from closet-item-deletion.server", () => {
    assert.ok(
      closetIndexSrc.includes("closet-item-deletion.server"),
      "closet._index.tsx must import from closet-item-deletion.server",
    );
  });
});

// ─── Group D: settings.tsx wiring ────────────────────────────────────────────

describe("settings.tsx — VTO and BOS wiring", () => {
  it("imports deleteCustomerVtoResults", () => {
    assert.ok(
      settingsSrc.includes("deleteCustomerVtoResults"),
      "settings.tsx must import deleteCustomerVtoResults",
    );
  });

  it("imports customerHasVtoResults", () => {
    assert.ok(
      settingsSrc.includes("customerHasVtoResults"),
      "settings.tsx must import customerHasVtoResults",
    );
  });

  it("imports deleteCustomerBosImages", () => {
    assert.ok(
      settingsSrc.includes("deleteCustomerBosImages"),
      "settings.tsx must import deleteCustomerBosImages",
    );
  });

  it("imports customerHasBosImages", () => {
    assert.ok(
      settingsSrc.includes("customerHasBosImages"),
      "settings.tsx must import customerHasBosImages",
    );
  });

  it("loader awaits customerHasVtoResults and customerHasBosImages", () => {
    const loaderIdx = settingsSrc.indexOf("export async function loader(");
    const loaderEnd = settingsSrc.indexOf("\nexport async function action(", loaderIdx);
    const loaderSrc = settingsSrc.slice(loaderIdx, loaderEnd);
    assert.ok(loaderSrc.includes("customerHasVtoResults("), "loader must call customerHasVtoResults");
    assert.ok(loaderSrc.includes("customerHasBosImages("), "loader must call customerHasBosImages");
  });

  it("loader returns hasVtoResults and hasBosImages in data payload", () => {
    // Use the first return data({ which is the loader's
    const returnIdx = settingsSrc.indexOf("return data({");
    const loaderActionIdx = settingsSrc.indexOf("export async function action(");
    assert.ok(returnIdx > -1, "loader must have return data({");
    assert.ok(returnIdx < loaderActionIdx, "loader return data({ must precede action export");
    const returnBlock = settingsSrc.slice(returnIdx, returnIdx + 400);
    assert.ok(returnBlock.includes("hasVtoResults"), "loader return must include hasVtoResults");
    assert.ok(returnBlock.includes("hasBosImages"), "loader return must include hasBosImages");
  });

  it("action VALID_INTENTS includes delete-vto-results and delete-bos-images", () => {
    assert.ok(
      settingsSrc.includes('"delete-vto-results"'),
      "VALID_INTENTS must include delete-vto-results",
    );
    assert.ok(
      settingsSrc.includes('"delete-bos-images"'),
      "VALID_INTENTS must include delete-bos-images",
    );
  });

  it("action calls deleteCustomerVtoResults with server-derived customerId only", () => {
    const actionIdx = settingsSrc.indexOf("export async function action(");
    const actionBody = settingsSrc.slice(actionIdx, actionIdx + 3000);
    assert.ok(
      actionBody.includes("deleteCustomerVtoResults(customer.id"),
      "action must call deleteCustomerVtoResults with customer.id (from auth, not formData)",
    );
    // Must NOT use formData-sourced customerId
    assert.ok(
      !actionBody.includes("deleteCustomerVtoResults(customerId"),
      "must not pass a client-supplied customerId to VTO deletion",
    );
  });

  it("action calls deleteCustomerBosImages with server-derived customerId only", () => {
    const actionIdx = settingsSrc.indexOf("export async function action(");
    const actionBody = settingsSrc.slice(actionIdx, actionIdx + 3000);
    assert.ok(
      actionBody.includes("deleteCustomerBosImages(customer.id"),
      "action must call deleteCustomerBosImages with customer.id (from auth, not formData)",
    );
    assert.ok(
      !actionBody.includes("deleteCustomerBosImages(customerId"),
      "must not pass a client-supplied customerId to BOS deletion",
    );
  });

  it("CONFIRM specs include delete-vto-results with expected title", () => {
    assert.ok(
      settingsSrc.includes('"delete-vto-results":'),
      "CONFIRM must include delete-vto-results spec",
    );
    assert.ok(
      settingsSrc.includes("Virtual Try-On"),
      "VTO confirm spec must reference Virtual Try-On",
    );
  });

  it("CONFIRM specs include delete-bos-images with expected title", () => {
    assert.ok(
      settingsSrc.includes('"delete-bos-images":'),
      "CONFIRM must include delete-bos-images spec",
    );
    assert.ok(
      settingsSrc.includes("Buy or Skip"),
      "BOS confirm spec must reference Buy or Skip",
    );
  });

  it("component renders VTO section conditionally on hasVtoResults", () => {
    assert.ok(
      settingsSrc.includes("{hasVtoResults && ("),
      "VTO section must be conditional on hasVtoResults",
    );
  });

  it("component renders BOS section conditionally on hasBosImages", () => {
    assert.ok(
      settingsSrc.includes("{hasBosImages && ("),
      "BOS section must be conditional on hasBosImages",
    );
  });

  it("component passes delete-vto-results intent to ControlRow", () => {
    assert.ok(
      settingsSrc.includes('intent="delete-vto-results"'),
      "ControlRow for VTO must have intent delete-vto-results",
    );
  });

  it("component passes delete-bos-images intent to ControlRow", () => {
    assert.ok(
      settingsSrc.includes('intent="delete-bos-images"'),
      "ControlRow for BOS must have intent delete-bos-images",
    );
  });
});

// ─── Group E: loader does not expose raw Cloudinary publicIds ────────────────

describe("settings.tsx — no raw publicIds in loader return", () => {
  // Precomputed booleans are derived before return data({...}).
  // The return block itself must contain only boolean variable names, not publicId checks.

  it("hasVtoResults and hasBosImages are returned as booleans, not raw fields", () => {
    const returnIdx = settingsSrc.lastIndexOf("return data({");
    const loaderActionIdx = settingsSrc.indexOf("export async function action(");
    const returnBlock = settingsSrc.slice(returnIdx, loaderActionIdx);
    // The return block must not directly expose VTO job IDs or Cloudinary paths
    assert.ok(
      !returnBlock.includes("virtualTryOnJob"),
      "loader must not return raw VTO job objects to the client",
    );
    assert.ok(
      !returnBlock.includes("imagePublicId"),
      "loader must not expose imagePublicId in return block",
    );
  });
});
