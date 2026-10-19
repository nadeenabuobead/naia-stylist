// app/routes/buyskip-photo-consent.test.ts
// Priority 5 (2026-10-19) — Buy or Skip photo consent, UI + server-side enforcement.
//
// Source-string assertions, same convention and same reasoning as
// closet-photo-consent.test.ts — api.wishlist.jsx's analyzeItem has a long,
// heavy-dependency pipeline; static assertions prove placement and intent
// correctly and cheaply without a risky partial mock of that pipeline.
//
// Run: node --import tsx/esm --test app/routes/buyskip-photo-consent.test.ts

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const wishlist = readFileSync(join(__dirname, "api.wishlist.jsx"), "utf8");
const bosIndex = readFileSync(join(__dirname, "buyskip._index.tsx"), "utf8");

describe("api.wishlist.jsx analyzeItem — server-side consent enforcement", () => {
  it("imports extractConsentGiven and buildConsentStamp from photo-consent.server", () => {
    assert.ok(wishlist.includes('from "../lib/photo-consent.server"'));
    assert.ok(wishlist.includes("extractConsentGiven"));
    assert.ok(wishlist.includes("buildConsentStamp"));
  });

  it("the consent check runs AFTER the publicId-required check and BEFORE Cloudinary config/ownership", () => {
    const publicIdIdx = wishlist.indexOf('if (!publicId || typeof publicId !== "string"');
    const consentIdx = wishlist.indexOf("extractConsentGiven(body)");
    const cfgIdx = wishlist.indexOf("getCloudinaryConfig()");
    assert.ok(publicIdIdx > -1 && consentIdx > -1 && cfgIdx > -1);
    assert.ok(publicIdIdx < consentIdx);
    assert.ok(consentIdx < cfgIdx);
  });

  it("rejection returns a distinct consent_required error code, never a silent pass-through", () => {
    const consentBlock = wishlist.slice(wishlist.indexOf("extractConsentGiven(body)"), wishlist.indexOf("extractConsentGiven(body)") + 300);
    assert.ok(consentBlock.includes("consent_required"));
    assert.ok(consentBlock.includes("status: 400"));
  });

  it("the created BuyOrSkipAnalysis is stamped with the consent result via buildConsentStamp", () => {
    const createIdx = wishlist.indexOf("prisma.buyOrSkipAnalysis.create(");
    const createEndIdx = wishlist.indexOf("\n          },", createIdx);
    const createBlock = wishlist.slice(createIdx, createEndIdx);
    assert.ok(createBlock.includes("...buildConsentStamp(consentGiven)"));
  });
});

describe("buyskip._index.tsx UI — upload and analysis are gated behind the consent checkbox", () => {
  it("declares photoConsentGiven state", () => {
    assert.ok(bosIndex.includes("const [photoConsentGiven, setPhotoConsentGiven] = React.useState(false)"));
  });

  it("the upload control itself is disabled (onFile undefined) without consent", () => {
    assert.ok(bosIndex.includes("onFile={photoConsentGiven ? handleUpload : undefined}"));
  });

  it("canAnalyze requires photoConsentGiven", () => {
    const idx = bosIndex.indexOf("const canAnalyze =");
    const line = bosIndex.slice(idx, bosIndex.indexOf("\n", idx));
    assert.ok(line.includes("photoConsentGiven"));
  });

  it("the analyze request sends photoConsentGiven in its body", () => {
    assert.ok(bosIndex.includes("photoConsentGiven }),"));
  });

  it("the consent checkbox copy makes clear what it's agreeing to", () => {
    assert.ok(bosIndex.includes('id="bos-photo-consent"'));
    assert.ok(bosIndex.includes("I consent to nAia analysing this photo"));
  });
});
