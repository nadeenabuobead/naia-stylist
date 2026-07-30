-- Batch 1: BuyOrSkipAnalysis enhancements
-- Adds INCOMPLETE verdict value and event-lineage fields.
-- Safe to apply on top of the original BuyOrSkipAnalysis table.

-- Extend enum with INCOMPLETE verdict (represents an analysis that did not complete)
ALTER TYPE "BuySkipVerdict" ADD VALUE IF NOT EXISTS 'INCOMPLETE';

-- Add event-lineage fields (all nullable or have server-side defaults)
ALTER TABLE "BuyOrSkipAnalysis"
  ADD COLUMN IF NOT EXISTS "sessionId"     TEXT,
  ADD COLUMN IF NOT EXISTS "source"        TEXT NOT NULL DEFAULT 'buy-or-skip',
  ADD COLUMN IF NOT EXISTS "schemaVersion" TEXT NOT NULL DEFAULT '1.0',
  ADD COLUMN IF NOT EXISTS "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
