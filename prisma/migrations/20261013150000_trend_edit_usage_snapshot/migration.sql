-- AlterTable: PersonalisedTrendEditUsage — persist the exact generated edit.
--
-- Additive, nullable column. Historic PersonalisedTrendEditUsage rows never
-- contained the generated customer-facing content — only a usage/quota
-- counter (reportSlug, periodKey, createdAt). This column lets every future
-- generation capture it, without reconstructing or fabricating anything for
-- existing rows: they simply read snapshot = NULL, same as before this
-- migration, and the admin Trend Edits detail view must say so plainly
-- rather than inventing content.

ALTER TABLE "PersonalisedTrendEditUsage" ADD COLUMN "snapshot" JSONB;
