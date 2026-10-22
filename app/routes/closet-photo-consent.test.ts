// app/routes/closet-photo-consent.test.ts
// Priority 5 (2026-10-19) — Closet photo consent, UI + server-side enforcement.
//
// Source-string assertions, same convention as closet-image-security.test.ts
// (this file's existing sibling test for closet._index.tsx) and
// api.closet-preview-analyze.ts has no live-call-free way to unit test its
// ~10-step pipeline without a large, risk-of-wrong-mock dependency graph —
// static assertions prove placement and intent correctly and cheaply.
//
// Run: node --import tsx/esm --test app/routes/closet-photo-consent.test.ts

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const closetIndex = readFileSync(join(__dirname, "closet._index.tsx"), "utf8");
const previewAnalyze = readFileSync(join(__dirname, "api.closet-preview-analyze.ts"), "utf8");

describe("closet._index.tsx action — server-side consent enforcement on final save", () => {
  it("imports extractConsentGiven and buildConsentStamp from photo-consent.server", () => {
    assert.ok(closetIndex.includes('from "~/lib/photo-consent.server"'));
    assert.ok(closetIndex.includes("extractConsentGiven"));
    assert.ok(closetIndex.includes("buildConsentStamp"));
  });

  it("the consent check runs AFTER the publicId-required AND ownership checks, and BEFORE capacity", () => {
    // Reordered 2026-10-20: consent rejection deletes the asset, so ownership
    // must be confirmed first — otherwise a forged/guessed publicId plus
    // withheld consent would delete another customer's photo without any
    // ownership check ever running. See closet-add-intent.behavioral.test.ts
    // for the behavioral regression test proving this.
    const publicIdIdx = closetIndex.indexOf('if (!publicId) return data({ error: "Image upload reference required."');
    const ownershipIdx = closetIndex.indexOf("validatePublicIdOwnership(publicId");
    const consentIdx = closetIndex.indexOf("extractConsentGiven({ photoConsentGiven:");
    // Anchored on the call itself, not "checkEntitlement(customer.id" on one
    // line — the replace-aware capacity check (2026-10-23) spans multiple
    // lines for its new 4th argument.
    const capacityIdx = closetIndex.indexOf("checkEntitlement(");
    assert.ok(publicIdIdx > -1 && ownershipIdx > -1 && consentIdx > -1 && capacityIdx > -1);
    assert.ok(publicIdIdx < ownershipIdx, "ownership check comes after the publicId check");
    assert.ok(ownershipIdx < consentIdx, "ownership check now comes before the consent check");
    assert.ok(consentIdx < capacityIdx, "consent check comes before the capacity check");
  });

  it("on rejection, deletes the already-uploaded Cloudinary asset and returns 400 — same pattern as every other pre-DB-write check", () => {
    const consentBlock = closetIndex.slice(
      closetIndex.indexOf("extractConsentGiven({ photoConsentGiven:"),
      closetIndex.indexOf("extractConsentGiven({ photoConsentGiven:") + 400,
    );
    assert.ok(consentBlock.includes('if (!consentGiven)'));
    assert.ok(consentBlock.includes('deleteCloudinaryAsset(publicId, "private")'));
    assert.ok(consentBlock.includes("status: 400"));
  });

  it("the created ClosetItem is stamped with the consent result via buildConsentStamp", () => {
    const createIdx = closetIndex.indexOf("prisma.closetItem.create(");
    const createEndIdx = closetIndex.indexOf("\n    });", createIdx);
    const createBlock = closetIndex.slice(createIdx, createEndIdx);
    assert.ok(createBlock.includes("...buildConsentStamp(consentGiven)"));
  });
});

describe("closet._index.tsx UI — upload is gated behind the consent checkbox", () => {
  it("declares photoConsentGiven state, reset on form close", () => {
    assert.ok(closetIndex.includes("const [photoConsentGiven, setPhotoConsentGiven] = useState(false)"));
    const resetIdx = closetIndex.indexOf("function resetAddForm()");
    const resetBlock = closetIndex.slice(resetIdx, resetIdx + 600);
    assert.ok(resetBlock.includes("setPhotoConsentGiven(false)"));
  });

  it("uploadToCloudinary refuses to proceed without consent", () => {
    const fnIdx = closetIndex.indexOf("async function uploadToCloudinary(file: File)");
    const fnBlock = closetIndex.slice(fnIdx, fnIdx + 300);
    assert.ok(fnBlock.includes("if (!photoConsentGiven)"));
  });

  it("the file input is disabled until consent is given", () => {
    const inputIdx = closetIndex.indexOf('onChange={e => e.target.files?.[0] && uploadToCloudinary(e.target.files[0])}');
    const inputBlock = closetIndex.slice(inputIdx, inputIdx + 200);
    assert.ok(inputBlock.includes("!photoConsentGiven"));
  });

  it("the preview-analysis fetch sends photoConsentGiven in the request body", () => {
    assert.ok(closetIndex.includes("JSON.stringify({ publicId, photoConsentGiven })"));
  });

  it("the final save submits photoConsentGiven alongside the other fields", () => {
    const handleAddIdx = closetIndex.indexOf("function handleAdd()");
    const handleAddBlock = closetIndex.slice(handleAddIdx, handleAddIdx + 700);
    assert.ok(handleAddBlock.includes("photoConsentGiven: String(photoConsentGiven)"));
  });

  it("the consent checkbox copy makes clear what it's agreeing to", () => {
    assert.ok(closetIndex.includes('id="closet-photo-consent"'));
    assert.ok(closetIndex.includes("I consent to nAia analysing this photo"));
  });
});

describe("api.closet-preview-analyze.ts — consent required before any AI analysis", () => {
  it("imports extractConsentGiven from photo-consent.server", () => {
    assert.ok(previewAnalyze.includes('from "~/lib/photo-consent.server"'));
    assert.ok(previewAnalyze.includes("extractConsentGiven"));
  });

  it("ownership is verified BEFORE the consent check, which runs BEFORE moderateImageContent/previewAnalyzeGarment", () => {
    // Reordered 2026-10-20: consent rejection deletes the asset, so ownership
    // must be confirmed first — otherwise a forged/guessed publicId plus
    // withheld consent would delete another customer's photo without any
    // ownership check ever running. See
    // api.closet-preview-analyze.behavioral.test.ts for the behavioral
    // regression test proving this.
    const ownershipIdx = previewAnalyze.indexOf("validatePublicIdOwnership(publicId");
    const consentIdx = previewAnalyze.indexOf("extractConsentGiven(body)");
    const moderationIdx = previewAnalyze.indexOf("moderateImageContent(downloadUrl)");
    const analysisIdx = previewAnalyze.indexOf("previewAnalyzeGarment(downloadUrl)");
    assert.ok(consentIdx > -1 && ownershipIdx > -1 && moderationIdx > -1 && analysisIdx > -1);
    assert.ok(ownershipIdx < consentIdx, "ownership check now comes before the consent check");
    assert.ok(consentIdx < moderationIdx);
    assert.ok(consentIdx < analysisIdx);
  });

  it("on rejection, deletes the already-uploaded asset rather than leaving it orphaned", () => {
    const consentBlock = previewAnalyze.slice(previewAnalyze.indexOf("extractConsentGiven(body)"), previewAnalyze.indexOf("extractConsentGiven(body)") + 300);
    assert.ok(consentBlock.includes('deleteCloudinaryAsset(publicId, "private")'));
    assert.ok(consentBlock.includes("status: 400"));
  });
});
