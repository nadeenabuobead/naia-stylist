-- Trend Report content identity — Step 1a
--
-- Adds the report EDITION key. Content ids and per-trend facets live inside the
-- existing JSON columns (keyTrends / rising / fading / referencesBehindThisEdit)
-- and therefore need no column of their own; they are written by the backfill
-- script and thereafter maintained by editorial-reports.server.ts on every save.
--
-- Additive and safe to re-run: existing rows take the empty-string default and
-- are populated by scripts/backfill-trend-content-ids.mts.

ALTER TABLE "editorial_trend_reports"
  ADD COLUMN IF NOT EXISTS "editionKey" TEXT NOT NULL DEFAULT '';
