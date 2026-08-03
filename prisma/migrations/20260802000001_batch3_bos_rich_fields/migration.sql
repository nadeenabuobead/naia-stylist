-- AlterTable: BuyOrSkipAnalysis — Batch 3 rich persistence fields
-- All new columns are nullable so existing rows remain valid.
ALTER TABLE "BuyOrSkipAnalysis"
  ADD COLUMN IF NOT EXISTS "confidence"   INTEGER,
  ADD COLUMN IF NOT EXISTS "category"     TEXT,
  ADD COLUMN IF NOT EXISTS "colors"       TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "forOccasion"  TEXT,
  ADD COLUMN IF NOT EXISTS "whatLike"     TEXT,
  ADD COLUMN IF NOT EXISTS "unsureAbout"  TEXT,
  ADD COLUMN IF NOT EXISTS "colorNote"    TEXT,
  ADD COLUMN IF NOT EXISTS "itemSize"     TEXT,
  ADD COLUMN IF NOT EXISTS "fullAnalysis" JSONB;
