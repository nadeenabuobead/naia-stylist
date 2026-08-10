-- V2-D: complete sizing, measurements, and body fit
-- Additive migration only — no existing data is modified or deleted

ALTER TABLE "OnboardingProfile" ADD COLUMN IF NOT EXISTS "sizingSystem"      TEXT;
ALTER TABLE "OnboardingProfile" ADD COLUMN IF NOT EXISTS "height"             TEXT;
ALTER TABLE "OnboardingProfile" ADD COLUMN IF NOT EXISTS "bodyShape"          TEXT;
ALTER TABLE "OnboardingProfile" ADD COLUMN IF NOT EXISTS "bustMeasurement"    TEXT;
ALTER TABLE "OnboardingProfile" ADD COLUMN IF NOT EXISTS "waistMeasurement"   TEXT;
ALTER TABLE "OnboardingProfile" ADD COLUMN IF NOT EXISTS "hipMeasurement"     TEXT;
ALTER TABLE "OnboardingProfile" ADD COLUMN IF NOT EXISTS "measurementUnit"    TEXT;
ALTER TABLE "OnboardingProfile" ADD COLUMN IF NOT EXISTS "preferredCoverage"  TEXT;
ALTER TABLE "OnboardingProfile" ADD COLUMN IF NOT EXISTS "fitConcerns"        TEXT[] NOT NULL DEFAULT '{}';
