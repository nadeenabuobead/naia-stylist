-- Passport Rev 7 — additive only. No existing column is dropped, renamed or rewritten.
--
-- stylePersonalities is deliberately left in place and untouched: it remains the
-- style field of record for legacy (profileVersion null / 6) customers. The Rev 7
-- flow writes styleDirections instead and never back-writes stylePersonalities.
--
-- profileVersion gains the value 7 (null = legacy, 6 = Rev 6, 7 = Rev 7). No
-- existing row's profileVersion is modified by this migration.

ALTER TABLE "OnboardingProfile" ADD COLUMN IF NOT EXISTS "styleExpression"          TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "OnboardingProfile" ADD COLUMN IF NOT EXISTS "explorationLevel"         TEXT;
ALTER TABLE "OnboardingProfile" ADD COLUMN IF NOT EXISTS "styleDirections"          TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "OnboardingProfile" ADD COLUMN IF NOT EXISTS "dressingHabits"           TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "OnboardingProfile" ADD COLUMN IF NOT EXISTS "dressingRequirementsNote" TEXT;
