-- SavedLook trend provenance (Step 6)
--
-- Four nullable columns so a look saved from a trend-started StyleMe session
-- remembers where the inspiration came from. A look saved from an ordinary
-- session leaves them null and is unchanged in every respect.
--
-- Deterministic: plain ADD COLUMN, no existence guards.

ALTER TABLE "SavedLook" ADD COLUMN "inspiredByReportId" TEXT;
ALTER TABLE "SavedLook" ADD COLUMN "inspiredByReportTitle" TEXT;
ALTER TABLE "SavedLook" ADD COLUMN "inspiredByContentId" TEXT;
ALTER TABLE "SavedLook" ADD COLUMN "inspiredByTrendLabel" TEXT;
