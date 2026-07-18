-- AddColumns: Passport Lite v1 fields to OnboardingProfile
-- Added to schema in c71ea52 (Passport Lite Release A) without a migration.
-- Applying manually to staging; safe to re-run via IF NOT EXISTS guards.

ALTER TABLE "OnboardingProfile"
  ADD COLUMN IF NOT EXISTS "desiredImpression" TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "desiredFeelings"   TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "becoming"          TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "styleSupport"      TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "finalNotes"        TEXT;
