-- Priority 5 (2026-10-19) — photo consent fields. All additive and
-- nullable; no existing row is affected. None of these are enforced yet —
-- see app/lib/photo-consent.server.ts for the standalone, tested
-- check/record capability and why it is not yet wired into the live
-- Closet/Buy-or-Skip/Selfie upload routes.

ALTER TABLE "ClosetItem" ADD COLUMN "photoConsentAt" TIMESTAMP(3);
ALTER TABLE "ClosetItem" ADD COLUMN "photoConsentVersion" TEXT;

ALTER TABLE "BuyOrSkipAnalysis" ADD COLUMN "photoConsentAt" TIMESTAMP(3);
ALTER TABLE "BuyOrSkipAnalysis" ADD COLUMN "photoConsentVersion" TEXT;

ALTER TABLE "SelfieAnalysis" ADD COLUMN "consentVersion" TEXT;
