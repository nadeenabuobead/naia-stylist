-- About You fields: contextual profile info (not used to infer style or recommendations)
ALTER TABLE "OnboardingProfile" ADD COLUMN IF NOT EXISTS "ageRange" TEXT;
ALTER TABLE "OnboardingProfile" ADD COLUMN IF NOT EXISTS "gender" TEXT;
ALTER TABLE "OnboardingProfile" ADD COLUMN IF NOT EXISTS "genderSelfDescription" TEXT;
