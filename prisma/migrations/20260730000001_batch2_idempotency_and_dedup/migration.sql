-- Batch 2: DB-backed idempotency for BuyOrSkipAnalysis and JourneyEvent.
-- Adds nullable idempotencyKey columns with partial unique indexes so that
-- NULL values (pre-Batch-2 records) are not subject to the constraint.
-- Safe to apply on top of existing tables; all new columns are nullable.

-- BuyOrSkipAnalysis — prevents duplicate analysis writes across serverless instances
ALTER TABLE "BuyOrSkipAnalysis"
  ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "BuyOrSkipAnalysis_idempotencyKey_key"
  ON "BuyOrSkipAnalysis"("idempotencyKey")
  WHERE "idempotencyKey" IS NOT NULL;

-- JourneyEvent — prevents duplicate event writes under SSR revalidation / retries
ALTER TABLE "JourneyEvent"
  ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "JourneyEvent_idempotencyKey_key"
  ON "JourneyEvent"("idempotencyKey")
  WHERE "idempotencyKey" IS NOT NULL;
