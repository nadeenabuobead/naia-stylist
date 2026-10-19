// app/lib/photo-consent.test.ts
// Priority 5 (2026-10-19) — photo consent validate/record capability.
//
// Pure functions, no DB, no network. This module is intentionally not
// wired into any live route yet (see the file header comment in
// photo-consent.server.ts for why) — these tests cover the standalone
// capability so it's correct and ready whenever the matching UI ships.
//
// Run: node --import tsx/esm --test app/lib/photo-consent.test.ts

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  hasGivenCurrentPhotoConsent,
  extractConsentGiven,
  buildConsentStamp,
  CURRENT_PHOTO_CONSENT_VERSION,
} from "./photo-consent.server";

describe("hasGivenCurrentPhotoConsent", () => {
  it("false when never consented", () => {
    assert.equal(hasGivenCurrentPhotoConsent({ photoConsentAt: null, photoConsentVersion: null }), false);
  });

  it("true when consented under the current version", () => {
    assert.equal(
      hasGivenCurrentPhotoConsent({ photoConsentAt: new Date(), photoConsentVersion: CURRENT_PHOTO_CONSENT_VERSION }),
      true,
    );
  });

  it("false when consented under a stale version — must be asked again after a wording change", () => {
    assert.equal(hasGivenCurrentPhotoConsent({ photoConsentAt: new Date(), photoConsentVersion: "v0-legacy" }), false);
  });
});

describe("extractConsentGiven — only a literal boolean true counts", () => {
  it("true for { photoConsentGiven: true }", () => {
    assert.equal(extractConsentGiven({ photoConsentGiven: true }), true);
  });

  for (const bad of [
    { photoConsentGiven: "true" },
    { photoConsentGiven: 1 },
    { photoConsentGiven: false },
    {},
    null,
    undefined,
    "not an object",
  ]) {
    it(`false for ${JSON.stringify(bad)}`, () => {
      assert.equal(extractConsentGiven(bad), false);
    });
  }
});

describe("buildConsentStamp", () => {
  it("stamps the current version and a timestamp when consent was given", () => {
    const stamp = buildConsentStamp(true);
    assert.equal(stamp.photoConsentVersion, CURRENT_PHOTO_CONSENT_VERSION);
    assert.ok(stamp.photoConsentAt instanceof Date);
  });

  it("stamps nothing when consent was not given — never a false consent record", () => {
    const stamp = buildConsentStamp(false);
    assert.equal(stamp.photoConsentAt, null);
    assert.equal(stamp.photoConsentVersion, null);
  });
});
