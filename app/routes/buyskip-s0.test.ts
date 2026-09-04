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

// ── T16: Layered construction rule ────────────────────────────────────────────
describe("T16: prompt contains LAYERED CONSTRUCTION RULE for overlay garments", () => {
  it("prompt contains LAYERED CONSTRUCTION RULE label", () => {
    assert.ok(
      api.includes("LAYERED CONSTRUCTION RULE"),
      "prompt must contain a LAYERED CONSTRUCTION RULE",
    );
  });

  it("rule distinguishes underlying base construction from overlay", () => {
    assert.ok(
      api.includes("UNDERLYING/BASE") || api.includes("underlying/base") || api.includes("underlying construction"),
      "rule must address the underlying/base construction separately from overlay",
    );
  });

  it("rule prohibits waist-obscuring classification based on overlay alone", () => {
    assert.ok(
      api.includes("waist-defined") || api.includes("waist-obscuring"),
      "rule must address waist-defined vs waist-obscuring classification under overlay garments",
    );
  });

  it("rule requires qualified language when visual evidence is ambiguous", () => {
    assert.ok(
      api.includes("qualified language") && api.includes("ambiguous"),
      "rule must require qualified language when visual evidence is ambiguous",
    );
  });
});

// ── T17: Fashion language calibration ─────────────────────────────────────────
describe("T17: prompt contains FASHION LANGUAGE CALIBRATION rule", () => {
  it("prompt contains FASHION LANGUAGE CALIBRATION label", () => {
    assert.ok(
      api.includes("FASHION LANGUAGE CALIBRATION"),
      "prompt must contain a FASHION LANGUAGE CALIBRATION rule",
    );
  });

  it("rule restricts avant-garde to items with genuine visual evidence", () => {
    assert.ok(
      api.includes("avant-garde"),
      "FASHION LANGUAGE CALIBRATION must name avant-garde as a term to reserve",
    );
  });

  it("rule restricts theatrical to items with genuine visual evidence", () => {
    assert.ok(
      api.includes("theatrical"),
      "FASHION LANGUAGE CALIBRATION must name theatrical as a term to restrict",
    );
  });

  it("rule provides proportionate alternatives — statement, embellished, occasion-led", () => {
    assert.ok(
      api.includes("statement") && api.includes("embellished") && api.includes("occasion-led"),
      "rule must provide proportionate language alternatives (statement, embellished, occasion-led)",
    );
  });
});

// ── T18: Occasion-specific items can earn BUY ────────────────────────────────
describe("T18: prompt states occasion-specific items can earn BUY", () => {
  it("OCCASION CALIBRATION RULE is present", () => {
    assert.ok(
      api.includes("OCCASION CALIBRATION RULE"),
      "prompt must contain an OCCASION CALIBRATION RULE",
    );
  });

  it("rule states a purchase does not need to serve every lifestyle context", () => {
    assert.ok(
      api.includes("does NOT need to serve every lifestyle context"),
      "prompt must state a purchase does not need to serve every lifestyle context",
    );
  });

  it("rule evaluates meaningful real part of the customer's life", () => {
    assert.ok(
      api.includes("meaningful real part"),
      "rule must instruct evaluating whether item serves a meaningful real part of the customer's life",
    );
  });

  it("rule permits occasion-specific items to earn BUY with realistic use", () => {
    assert.ok(
      api.includes("occasion-specific item") || api.includes("occasion piece"),
      "rule must explicitly state an occasion-specific item can earn BUY",
    );
  });
});

// ── T19: stop-regret-purchases calibration ────────────────────────────────────
describe("T19: stop-regret-purchases goal does not auto-push statement/occasion pieces to SKIP", () => {
  it("prompt clarifies stop-regret-purchases increases scrutiny but not auto-SKIP for occasion pieces", () => {
    assert.ok(
      api.includes("'stop-regret-purchases' does NOT"),
      "prompt must clarify stop-regret-purchases does NOT automatically push statement or occasion pieces toward SKIP",
    );
  });

  it("prompt reframes the goal as realistic pattern of wear, not universal context coverage", () => {
    assert.ok(
      api.includes("realistic pattern of wear") || api.includes("realistic use"),
      "prompt must reframe stop-regret-purchases as evaluating realistic pattern of wear",
    );
  });
});

// ── T20: VERDICT SEVERITY RULE ────────────────────────────────────────────────
describe("T20: prompt contains VERDICT SEVERITY RULE distinguishing SKIP from SKIP FOR NOW", () => {
  it("VERDICT SEVERITY RULE is present", () => {
    assert.ok(
      api.includes("VERDICT SEVERITY RULE"),
      "prompt must contain a VERDICT SEVERITY RULE",
    );
  });

  it("rule defines what hard SKIP requires", () => {
    assert.ok(
      api.includes("Hard SKIP requires"),
      "VERDICT SEVERITY RULE must state what hard SKIP requires",
    );
  });

  it("rule directs uncertain wear frequency toward SKIP FOR NOW not SKIP", () => {
    assert.ok(
      api.includes("wear frequency is uncertain"),
      "VERDICT SEVERITY RULE must address uncertain wear frequency as SKIP FOR NOW territory",
    );
  });

  it("rule defaults uncertain cases with real merit to SKIP FOR NOW", () => {
    assert.ok(
      api.includes("Default to SKIP FOR NOW"),
      "rule must say to default to SKIP FOR NOW when item has real merit but uncertainty blocks recommendation",
    );
  });
});

// ── T15: Constitution H — anti-sales VOICE RULE ───────────────────────────────
describe("T15: Buy/Skip prompt contains anti-sales VOICE RULE (Constitution H)", () => {
  it("prompt contains a numbered VOICE RULE entry", () => {
    assert.ok(
      api.includes("VOICE RULE"),
      "api.wishlist prompt must contain a VOICE RULE entry in STRICT RULES",
    );
  });

  it("VOICE RULE identifies nAia as independent decision tool, not salesperson", () => {
    assert.ok(
      api.includes("independent decision tool") &&
      (api.includes("salesperson") || api.includes("sales")),
      "VOICE RULE must describe nAia as an independent decision tool, not a salesperson",
    );
  });

  it("VOICE RULE explicitly prohibits 'you deserve it'", () => {
    assert.ok(api.includes("you deserve it"), "VOICE RULE must name 'you deserve it'");
  });

  it("VOICE RULE explicitly prohibits 'treat yourself'", () => {
    assert.ok(api.includes("treat yourself"), "VOICE RULE must name 'treat yourself'");
  });

  it("VOICE RULE explicitly prohibits 'must-have'", () => {
    assert.ok(api.includes("must-have"), "VOICE RULE must name 'must-have'");
  });

  it("VOICE RULE explicitly prohibits 'game-changer'", () => {
    assert.ok(api.includes("game-changer"), "VOICE RULE must name 'game-changer'");
  });

  it("VOICE RULE explicitly prohibits 'last chance'", () => {
    assert.ok(api.includes("last chance"), "VOICE RULE must name 'last chance'");
  });

  it("VOICE RULE explicitly prohibits 'hurry'", () => {
    assert.ok(api.includes('"hurry"'), "VOICE RULE must name 'hurry'");
  });

  it("VOICE RULE explicitly prohibits 'selling fast'", () => {
    assert.ok(api.includes("selling fast"), "VOICE RULE must name 'selling fast'");
  });

  it("VOICE RULE prohibits artificial urgency and scarcity pressure", () => {
    assert.ok(
      api.includes("artificial urgency") && api.includes("scarcity pressure"),
      "VOICE RULE must prohibit artificial urgency and scarcity pressure",
    );
  });

  it("VOICE RULE requires calm, evidence-based reasoning", () => {
    assert.ok(
      api.includes("evidence-based"),
      "VOICE RULE must require evidence-based reasoning",
    );
  });
});
