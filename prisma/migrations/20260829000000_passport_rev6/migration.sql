-- Passport Rev 6: additive fields only. No existing columns removed or renamed.
-- Safe for existing users: empty arrays / NULL are the safe defaults.

ALTER TABLE "OnboardingProfile" ADD COLUMN "currentGoal"           TEXT[]  NOT NULL DEFAULT '{}';
ALTER TABLE "OnboardingProfile" ADD COLUMN "successfulOutfitGives" TEXT[]  NOT NULL DEFAULT '{}';
ALTER TABLE "OnboardingProfile" ADD COLUMN "dressingPreferences"   TEXT[]  NOT NULL DEFAULT '{}';
ALTER TABLE "OnboardingProfile" ADD COLUMN "fitConcernsNote"       TEXT;
