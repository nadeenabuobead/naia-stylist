-- V2-E: migrate lifestyle from nullable String to String[] @default([])
-- Step 1: add a temporary column to hold the new array
ALTER TABLE "OnboardingProfile" ADD COLUMN "lifestyle_new" TEXT[] NOT NULL DEFAULT '{}';

-- Step 2: migrate existing data — split on ", " or "," with optional surrounding whitespace, drop NULLs
UPDATE "OnboardingProfile"
SET "lifestyle_new" = (
  SELECT ARRAY(
    SELECT TRIM(v)
    FROM unnest(string_to_array(lifestyle, ',')) AS v
    WHERE TRIM(v) != ''
  )
)
WHERE lifestyle IS NOT NULL AND lifestyle != '';

-- Step 3: drop old column, rename new column
ALTER TABLE "OnboardingProfile" DROP COLUMN "lifestyle";
ALTER TABLE "OnboardingProfile" RENAME COLUMN "lifestyle_new" TO "lifestyle";
