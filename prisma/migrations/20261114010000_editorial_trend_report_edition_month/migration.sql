-- AlterTable
-- Adds editionMonth ("YYYY-MM") as a nullable column — every existing row
-- gets NULL, which the application layer (getEffectiveEditionPeriod in
-- editorial-reports.server.ts) already falls back to publishedAt's own
-- month for, so no existing row's displayed grouping breaks. This migration
-- does not write any value into any existing row; it only adds the column.
ALTER TABLE "editorial_trend_reports" ADD COLUMN "editionMonth" TEXT;
