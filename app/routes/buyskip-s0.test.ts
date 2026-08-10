// app/routes/buyskip-s0.test.ts
// S0 — Buy or Skip P0 hardening: source-code contract tests.
//
// All assertions are static file-read checks — no DB, no Cloudinary, no Claude calls.
// Tests verify the security contracts introduced in this phase:
//   1. Upload uses server-returned private uploadUrl (never browser-constructed)
//   2. Analysis accepts publicId, not a free-form imageUrl
//   3. Ownership and delivery-type verification gates the Claude call
//   4. New analyses store imagePublicId + imageFormat, not a public CDN URL
//   5. Result page generates signed URLs from imagePublicId; legacy imageUrl still works

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");

function readRoute(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf-8");
}

const bos    = readRoute("app/routes/buyskip._index.tsx");
const api    = readRoute("app/routes/api.wishlist.jsx");
const result = readRoute("app/routes/buyskip.$id.tsx");
const schema = readRoute("prisma/schema.prisma");

// ── T1: Upload URL ──────────────────────────────────────────────────────────
describe("T1: BOS upload uses server-returned private uploadUrl", () => {
  it("uses uploadUrl destructured from sigData response", () => {
    // The code must destructure uploadUrl from sigData, then use it in fetch — not construct the URL.
    assert.ok(
      bos.includes("uploadUrl, maxFileSizeBytes } = sigData") ||
      bos.includes("uploadUrl } = sigData") ||
      bos.includes(", uploadUrl,"),
      "handleUpload must destructure uploadUrl from the server sigData response",
    );
    assert.ok(
      bos.includes("fetch(uploadUrl,"),
      "handleUpload must call fetch(uploadUrl, ...) using the server-provided URL",
    );
  });

  it("does not construct /image/upload in handleUpload", () => {
    // Ensure the old hardcoded public-delivery endpoint is gone from the upload handler.
    // We check the block between handleUpload's definition and the next top-level function.
    const uploadStart = bos.indexOf("const handleUpload");
    const uploadEnd   = bos.indexOf("React.useEffect(", uploadStart + 1);
    const uploadBlock = uploadEnd > uploadStart ? bos.slice(uploadStart, uploadEnd) : bos.slice(uploadStart);
    assert.ok(
      !uploadBlock.includes("/image/upload"),
      "handleUpload must not construct the Cloudinary /image/upload endpoint",
    );
  });

  it("upload preset and signature fields sent with the request", () => {
    assert.ok(bos.includes('fd.append("upload_preset"'), "must append upload_preset");
    assert.ok(bos.includes('fd.append("signature"'),      "must append signature");
  });
});

// ── T2: publicId sent to analyze API, not imageUrl ──────────────────────────
describe("T2: browser sends publicId to analysis API", () => {
  it("handleAnalyze sends publicId not imageUrl in the body", () => {
    assert.ok(
      bos.includes("publicId: imagePublicId"),
      "handleAnalyze body must contain publicId: imagePublicId",
    );
    // imageUrl must not appear in the JSON.stringify call for the analyze request
    const analyzeStart = bos.indexOf("fetch(\"/api/wishlist?action=analyze\"");
    const analyzeBlock = bos.slice(analyzeStart, analyzeStart + 400);
    assert.ok(
      !analyzeBlock.includes("imageUrl,"),
      "analyze request body must not send imageUrl",
    );
  });

  it("canAnalyze gates on imagePublicId not imageUrl", () => {
    assert.ok(
      bos.includes("imagePublicId && category"),
      "canAnalyze must use imagePublicId, not imageUrl",
    );
  });
});

// ── T3: arbitrary external URL cannot be analysed ────────────────────────────
describe("T3: analyzeItem refuses free-form imageUrl from browser", () => {
  it("does not destructure imageUrl from request body", () => {
    const bodyDestructure = (() => {
      const idx = api.indexOf("const { publicId");
      return idx >= 0 ? api.slice(idx, idx + 300) : "";
    })();
    assert.ok(bodyDestructure.length > 0, "must destructure publicId from body");
    assert.ok(
      !bodyDestructure.includes("imageUrl"),
      "body destructuring must not include imageUrl",
    );
  });

  it("publicId is the accepted asset reference", () => {
    assert.ok(
      api.includes("const { publicId"),
      "analyzeItem must accept publicId from body",
    );
  });
});

// ── T4: another customer's public ID is rejected ─────────────────────────────
describe("T4: ownership check rejects another customer's publicId", () => {
  it("validatePublicIdOwnership called with naiaCustomer.id from session", () => {
    assert.ok(
      api.includes("validatePublicIdOwnership(publicId, naiaCustomer.id)"),
      "must call validatePublicIdOwnership with session-derived customer ID",
    );
  });

  it("ownership check returns early before verification if it fails", () => {
    const ownershipCallIdx = api.indexOf("validatePublicIdOwnership(publicId");
    const verifyCallIdx    = api.indexOf("verifyCloudinaryAsset(publicId");
    assert.ok(ownershipCallIdx < verifyCallIdx,
      "ownership check must precede asset verification");
    // Early return on failure
    assert.ok(
      api.includes("asset_not_owned"),
      "ownership failure must return asset_not_owned error",
    );
  });
});

// ── T5: wrong folder/prefix rejected ──────────────────────────────────────────
describe("T5: wrong folder prefix rejected via ownership check", () => {
  it("customerId comes from naiaCustomer.id not from body", () => {
    const bodyDestructure = (() => {
      const idx = api.indexOf("const { publicId");
      return idx >= 0 ? api.slice(idx, idx + 300) : "";
    })();
    assert.ok(
      !bodyDestructure.includes("customerId"),
      "customerId must not be read from the request body",
    );
  });

  it("ownership validated against naiaCustomer.id from the authenticated session", () => {
    // naiaCustomer.id is used — not a browser-supplied value
    const ownershipIdx = api.indexOf("validatePublicIdOwnership(publicId, naiaCustomer.id)");
    assert.ok(ownershipIdx >= 0, "ownership must use naiaCustomer.id");
  });
});

// ── T6: public-delivery asset rejected ────────────────────────────────────────
describe("T6: public-delivery Cloudinary asset is rejected", () => {
  it("verifyCloudinaryAsset called with 'private' delivery type", () => {
    assert.ok(
      api.includes('verifyCloudinaryAsset(publicId, "private")'),
      "must verify asset against private delivery type",
    );
  });

  it("delivery type mismatch triggers early return", () => {
    assert.ok(
      api.includes("invalid_delivery_type"),
      "must return invalid_delivery_type when asset.type !== 'private'",
    );
    assert.ok(
      api.includes('verify.asset.type !== "private"'),
      "must check asset.type is private",
    );
  });
});

// ── T7: missing asset rejected ────────────────────────────────────────────────
describe("T7: missing Cloudinary asset is rejected before Claude", () => {
  it("verifyCloudinaryAsset error causes early return", () => {
    assert.ok(
      api.includes("verify.ok") || api.includes("!verify.ok"),
      "must check verify.ok",
    );
    assert.ok(
      api.includes("asset_not_found"),
      "NOT_FOUND errorCode must return asset_not_found error",
    );
  });
});

// ── T8: Claude not called before verification succeeds ────────────────────────
describe("T8: Claude call is gated behind all verification steps", () => {
  it("all verification errors appear before the Anthropic fetch call", () => {
    const claudeIdx = api.indexOf("https://api.anthropic.com/v1/messages");
    assert.ok(claudeIdx > 0, "Claude API call must exist");

    const checks = [
      "asset_not_owned",
      "asset_not_found",
      "invalid_delivery_type",
      "invalid_format",
      "invalid_file",
    ];
    for (const check of checks) {
      const checkIdx = api.indexOf(check);
      assert.ok(checkIdx > 0, `error code "${check}" must be present`);
      assert.ok(checkIdx < claudeIdx,
        `"${check}" must appear before the Claude API call`);
    }
  });

  it("privateImageUrl (not publicId or free-form URL) is passed to Claude", () => {
    const claudeIdx    = api.indexOf("https://api.anthropic.com/v1/messages");
    const contentBlock = api.slice(claudeIdx, claudeIdx + 800);
    assert.ok(
      contentBlock.includes("privateImageUrl"),
      "Claude image source must use privateImageUrl",
    );
    assert.ok(
      !contentBlock.includes('"url": imageUrl') && !contentBlock.includes("url: imageUrl"),
      "Claude must not receive a free-form imageUrl",
    );
  });
});

// ── T9: authenticated customer owns the analysis ──────────────────────────────
describe("T9: analysis ownership resolves from authenticated session", () => {
  it("getCurrentNaiaCustomer called before body is parsed", () => {
    const authIdx = api.indexOf("getCurrentNaiaCustomer(request)");
    const bodyIdx = api.indexOf("request.json()");
    assert.ok(authIdx >= 0, "getCurrentNaiaCustomer must be present");
    assert.ok(bodyIdx >= 0,  "request.json() must be present");
    assert.ok(authIdx < bodyIdx,
      "auth check must precede body parsing in analyzeItem");
  });

  it("customerId in DB write comes from naiaCustomer.id, not body", () => {
    const createIdx   = api.indexOf("prisma.buyOrSkipAnalysis.create");
    const createBlock = api.slice(createIdx, createIdx + 300);
    assert.ok(
      createBlock.includes("customerId: naiaCustomer.id"),
      "DB write must use naiaCustomer.id as customerId",
    );
  });
});

// ── T10: no browser-supplied customerId can override ownership ────────────────
describe("T10: customerId cannot be injected from browser", () => {
  it("customerId not destructured from body in analyzeItem", () => {
    const bodyBlock = (() => {
      const idx = api.indexOf("const { publicId");
      return idx >= 0 ? api.slice(idx, idx + 400) : "";
    })();
    assert.ok(
      !bodyBlock.includes("customerId"),
      "customerId must not appear in the body destructuring block",
    );
  });
});

// ── T11: new analysis stores imagePublicId, not a public URL ─────────────────
describe("T11: new BOS analysis stores private asset reference", () => {
  it("imagePublicId stored in DB create", () => {
    const createIdx = api.indexOf("prisma.buyOrSkipAnalysis.create");
    const createBlock = api.slice(createIdx, createIdx + 1200);
    assert.ok(
      createBlock.includes("imagePublicId: publicId"),
      "DB create must store imagePublicId: publicId",
    );
  });

  it("imageFormat stored in DB create", () => {
    const createIdx = api.indexOf("prisma.buyOrSkipAnalysis.create");
    const createBlock = api.slice(createIdx, createIdx + 1200);
    assert.ok(
      createBlock.includes("imageFormat: serverFormat"),
      "DB create must store imageFormat: serverFormat",
    );
  });

  it("imageUrl is null for new records", () => {
    const createIdx = api.indexOf("prisma.buyOrSkipAnalysis.create");
    const createBlock = api.slice(createIdx, createIdx + 1200);
    assert.ok(
      createBlock.includes("imageUrl: null"),
      "imageUrl must be null for new records (no public CDN URL stored)",
    );
  });
});

// ── T12: result page generates signed URL from imagePublicId ─────────────────
describe("T12: result page generates server-side signed URL", () => {
  it("loader selects imagePublicId and imageFormat from DB", () => {
    assert.ok(result.includes("imagePublicId: true"), "loader must select imagePublicId");
    assert.ok(result.includes("imageFormat: true"),   "loader must select imageFormat");
  });

  it("buildPrivateDownloadUrl called in loader with imagePublicId", () => {
    assert.ok(
      result.includes("buildPrivateDownloadUrl(cfg, analysis.imagePublicId"),
      "loader must call buildPrivateDownloadUrl with the stored imagePublicId",
    );
  });

  it("result component uses itemImageUrl not analysis.imageUrl", () => {
    assert.ok(
      result.includes("analysis.itemImageUrl"),
      "component must display itemImageUrl from the loader",
    );
    // The component must not fall back to reading imageUrl directly from the analysis object
    const componentStart = result.indexOf("export default function BuyOrSkipResult");
    const componentBody  = result.slice(componentStart);
    assert.ok(
      !componentBody.includes("analysis.imageUrl"),
      "component must not reference analysis.imageUrl directly",
    );
  });

  it("validatePublicIdOwnership called in loader before signing", () => {
    assert.ok(
      result.includes("validatePublicIdOwnership(analysis.imagePublicId"),
      "loader must verify ownership before generating signed URL",
    );
  });
});

// ── T13: legacy records remain readable ──────────────────────────────────────
describe("T13: existing legacy BOS records continue to display", () => {
  it("loader falls back to imageUrl when imagePublicId is null", () => {
    assert.ok(
      result.includes("} else if (analysis.imageUrl)"),
      "loader must fall back to legacy imageUrl when imagePublicId is absent",
    );
  });

  it("imageUrl still selected from DB for backward compatibility", () => {
    const selectBlock = (() => {
      const idx = result.indexOf("prisma.buyOrSkipAnalysis.findUnique");
      return idx >= 0 ? result.slice(idx, idx + 600) : "";
    })();
    assert.ok(
      selectBlock.includes("imageUrl: true"),
      "loader select must still include imageUrl for legacy records",
    );
  });
});

// ── T14: schema has new columns ───────────────────────────────────────────────
describe("T14: schema declares imagePublicId and imageFormat", () => {
  it("BuyOrSkipAnalysis has imagePublicId column", () => {
    assert.ok(
      schema.includes("imagePublicId String?"),
      "schema must declare imagePublicId String?",
    );
  });

  it("BuyOrSkipAnalysis has imageFormat column", () => {
    assert.ok(
      schema.includes("imageFormat   String?"),
      "schema must declare imageFormat String?",
    );
  });
});
