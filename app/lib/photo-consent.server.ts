// app/lib/photo-consent.server.ts
//
// Priority 5 (2026-10-19) — photo consent for Closet and Buy-or-Skip (BOS).
//
// Repo-wide sweep found these two upload/AI-analysis flows have NO consent
// gate of any kind — contrast with "My nAia Model" (NaiaModel/
// VirtualTryOnJob), which does this correctly: a versioned consent
// timestamp captured before the photo is used, so re-wording later means
// re-asking rather than silently grandfathering old consent.
//
// This module is the standalone, independently-tested validate/record
// capability for that same pattern on ClosetItem and BuyOrSkipAnalysis
// (schema fields added in migration 20261019200000_photo_consent_fields).
//
// Deliberately NOT wired into api.closet-preview-analyze.ts or the BOS
// analysis action (app/routes/api.wishlist.jsx) in this pass: enforcing
// consent server-side without the matching client UI sending it would
// reject every real upload immediately. Adding that UI means editing
// app/routes/closet._index.tsx — a very large, actively-used component —
// which needs its own focused pass with live browser verification, not a
// drive-by addition bundled into a broader security sweep. Shipping the
// server check without the UI, or the UI without the check, is a broken
// half-feature either way; shipping neither (for now) keeps the product
// working while this capability sits ready to wire in.

/// Bump when the consent wording changes — a customer who consented under
/// an old version must be asked again. Shared across Closet and BOS since
/// both would use the same wording ("I consent to nAia analysing this
/// photo..."); split into separate constants if the wording ever diverges.
export const CURRENT_PHOTO_CONSENT_VERSION = "v1";

export interface PhotoConsentFields {
  photoConsentAt: Date | null;
  photoConsentVersion: string | null;
}

export function hasGivenCurrentPhotoConsent(fields: PhotoConsentFields): boolean {
  return fields.photoConsentAt !== null && fields.photoConsentVersion === CURRENT_PHOTO_CONSENT_VERSION;
}

/** Validates a client-supplied consent flag from a request body. Accepts
 *  only a literal boolean `true` — anything else (missing, "true" as a
 *  string, 1, undefined) is treated as consent NOT given. A photo-consent
 *  checkbox must be an explicit, unambiguous affirmative action. */
export function extractConsentGiven(body: unknown): boolean {
  if (typeof body !== "object" || body === null) return false;
  const value = (body as Record<string, unknown>).photoConsentGiven;
  return value === true;
}

export function buildConsentStamp(consentGiven: boolean): PhotoConsentFields {
  if (!consentGiven) return { photoConsentAt: null, photoConsentVersion: null };
  return { photoConsentAt: new Date(), photoConsentVersion: CURRENT_PHOTO_CONSENT_VERSION };
}
