-- Found by the first genuine from-empty migrate deploy this history has ever
-- gone through (naia-billing-sandbox). These are small, pre-existing drifts
-- between individual historical migrations and the CURRENT schema.prisma —
-- unrelated to the missing-table/missing-type gaps fixed in
-- 20240530213852_baseline_tables_missing_from_history. None of these change
-- any column's actual data; all are additive/corrective ALTERs.

-- BuyOrSkipAnalysis.updatedAt is @updatedAt in schema.prisma (handled by
-- Prisma's query engine, not a DB default) — the DB-level default added in
-- 20260729000000_batch1_buy_or_skip_enhancements is a harmless but
-- unrequested extra.
ALTER TABLE "BuyOrSkipAnalysis" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- BuyOrSkipAnalysis.colors has no @default in schema.prisma — the
-- DEFAULT ARRAY[]::TEXT[] added in 20260802000001_batch3_bos_rich_fields
-- is likewise an unrequested extra.
ALTER TABLE "BuyOrSkipAnalysis" ALTER COLUMN "colors" DROP DEFAULT;

-- BuyOrSkipAnalysis/JourneyEvent.idempotencyKey are plain `@unique` in
-- schema.prisma. 20260730000001_batch2_idempotency_and_dedup deliberately
-- used PARTIAL unique indexes (documented there as intentional) — these are
-- functionally identical to a plain unique index for a nullable column
-- (Postgres already never treats two NULLs as colliding, partial or not),
-- so replacing them is a zero-behavior-change rename, done only so the
-- live schema matches what `prisma migrate diff` expects byte-for-byte.
DROP INDEX "BuyOrSkipAnalysis_idempotencyKey_key";
CREATE UNIQUE INDEX "BuyOrSkipAnalysis_idempotencyKey_key" ON "BuyOrSkipAnalysis"("idempotencyKey");

DROP INDEX "JourneyEvent_idempotencyKey_key";
CREATE UNIQUE INDEX "JourneyEvent_idempotencyKey_key" ON "JourneyEvent"("idempotencyKey");

-- Session.accessToken/accountOwner are nullable in schema.prisma
-- (`String?` / `Boolean? @default(false)`); the original
-- 20240530213853_create_session_table migration (already corrected once in
-- this branch for the DATETIME/TIMESTAMP(3) issue) made them NOT NULL —
-- a genuine, separate pre-existing mismatch.
ALTER TABLE "Session" ALTER COLUMN "accessToken" DROP NOT NULL;
ALTER TABLE "Session" ALTER COLUMN "accountOwner" DROP NOT NULL;

-- NaiaObservationFeedback's four provenance columns are required with no
-- @default in schema.prisma; 20260830000000_first_naia_read gave them
-- DB-level defaults ('' / ARRAY[]::TEXT[]) as a convenience that schema.prisma
-- never asked for.
ALTER TABLE "NaiaObservationFeedback" ALTER COLUMN "observationType" DROP DEFAULT;
ALTER TABLE "NaiaObservationFeedback" ALTER COLUMN "evidenceFields" DROP DEFAULT;
ALTER TABLE "NaiaObservationFeedback" ALTER COLUMN "evidenceValues" DROP DEFAULT;
ALTER TABLE "NaiaObservationFeedback" ALTER COLUMN "claimText" DROP DEFAULT;

-- TasteEvidence's 6-column unique constraint is functionally identical
-- between the migration and schema.prisma — only the generated name differs.
-- The ORIGINAL migration's 82-character constraint name ("..._dimension_
-- value_polarity_key") exceeds Postgres's 63-byte identifier limit, so
-- Postgres silently truncated it at creation time to
-- "..._dimension_value_" (confirmed directly via pg_constraint, not
-- guessed) — a DIFFERENT truncation point than Prisma's current naming
-- convention ("..._dimension_va_key"). Renamed to match exactly; same
-- columns, same uniqueness rule, no data impact.
ALTER TABLE "TasteEvidence" RENAME CONSTRAINT "TasteEvidence_customerId_source_sourceRecordId_dimension_value_" TO "TasteEvidence_customerId_source_sourceRecordId_dimension_va_key";
