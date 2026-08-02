-- Phase 4A6: add virtual try-on eligibility fields to ClosetItem
-- "ready-for-try-on" | "needs-clearer-photo" | "not-supported" | "pending-assessment" | NULL (pre-4A6 rows)
-- Apply locally: psql $DATABASE_URL -f prisma/migrations/20260717000000_add_closet_tryon_eligibility/migration.sql

ALTER TABLE "ClosetItem" ADD COLUMN IF NOT EXISTS "tryOnEligibility" TEXT;
ALTER TABLE "ClosetItem" ADD COLUMN IF NOT EXISTS "tryOnAssessedAt" TIMESTAMP(3);
ALTER TABLE "ClosetItem" ADD COLUMN IF NOT EXISTS "tryOnCustomerHint" TEXT;
ALTER TABLE "ClosetItem" ADD COLUMN IF NOT EXISTS "tryOnInternalNote" TEXT;
