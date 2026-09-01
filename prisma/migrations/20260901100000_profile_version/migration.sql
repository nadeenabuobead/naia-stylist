-- Profile version marker: null = legacy / Rev 6 not yet confirmed; 6 = Rev 6 complete.
-- Additive and non-destructive. All existing rows remain NULL — they must complete the
-- one-time legacy refresh flow before profileVersion is set to 6.

ALTER TABLE "OnboardingProfile" ADD COLUMN "profileVersion" INTEGER DEFAULT NULL;
