-- Terms of Service acceptance tracking (Legal handoff W1, 2026-11-17).
-- Same shape, same deliberate "fields only, not wired in yet" split as
-- the existing ageConfirmedAt/designResearchConsentAt columns on this
-- same table.
--
-- Written by hand against the schema's own validated structure (prisma
-- migrate dev was not run — no database was contacted to generate or
-- apply this file, same read-only migration policy as every other
-- hand-written migration in this history, e.g.
-- 20261117000000_withdrawal_request). NOT applied to any database.
-- Additive only: two new nullable columns on an existing table, no data
-- touched, no other table affected.

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN "termsAcceptedAt" TIMESTAMP(3);
ALTER TABLE "Customer" ADD COLUMN "termsAcceptedVersion" TEXT;
