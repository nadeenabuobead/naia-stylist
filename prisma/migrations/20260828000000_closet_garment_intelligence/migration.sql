-- Group 3B: Garment Intelligence fields on ClosetItem
-- Adds analysis lifecycle tracking and structured garment intelligence columns.
-- Tier 2 (observable): silhouette, fitProfile, hemLength, topLength, sleeveLength,
--   necklineCoverage, shoulderCoverage, midriffExposed, waistShape.
-- Tier 3 (matching signals): formality, stylePersonality, fieldConfidence.
-- All existing rows default to analysisStatus = 'not_analyzed' (no data loss).
-- subcategory, material, pattern, primaryColor, colors, styleTags, seasons,
--   occasions already exist — not added here.

ALTER TABLE "ClosetItem" ADD COLUMN "analysisStatus" TEXT NOT NULL DEFAULT 'not_analyzed';
ALTER TABLE "ClosetItem" ADD COLUMN "analyzedAt" TIMESTAMP(3);
ALTER TABLE "ClosetItem" ADD COLUMN "analysisSchemaVersion" TEXT;
ALTER TABLE "ClosetItem" ADD COLUMN "silhouette" TEXT;
ALTER TABLE "ClosetItem" ADD COLUMN "fitProfile" TEXT;
ALTER TABLE "ClosetItem" ADD COLUMN "hemLength" TEXT;
ALTER TABLE "ClosetItem" ADD COLUMN "topLength" TEXT;
ALTER TABLE "ClosetItem" ADD COLUMN "sleeveLength" TEXT;
ALTER TABLE "ClosetItem" ADD COLUMN "necklineCoverage" TEXT;
ALTER TABLE "ClosetItem" ADD COLUMN "shoulderCoverage" BOOLEAN;
ALTER TABLE "ClosetItem" ADD COLUMN "midriffExposed" BOOLEAN;
ALTER TABLE "ClosetItem" ADD COLUMN "waistShape" TEXT;
ALTER TABLE "ClosetItem" ADD COLUMN "formality" TEXT;
ALTER TABLE "ClosetItem" ADD COLUMN "stylePersonality" TEXT;
ALTER TABLE "ClosetItem" ADD COLUMN "fieldConfidence" JSONB;
