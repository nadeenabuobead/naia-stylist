-- V2-B1: Passport V2 schema extension — shape, colour & shopping context fields.
-- All columns use IF NOT EXISTS guards — safe to re-run on staging.
-- typicalDay already exists; intentionally omitted here.
ALTER TABLE "OnboardingProfile"
  ADD COLUMN IF NOT EXISTS "silhouette"          TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "structure"           TEXT,
  ADD COLUMN IF NOT EXISTS "coveragePreferences" TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "neutralVsColour"     TEXT,
  ADD COLUMN IF NOT EXISTS "colourIntensity"     TEXT,
  ADD COLUMN IF NOT EXISTS "printAppetite"       TEXT,
  ADD COLUMN IF NOT EXISTS "shoppingPriorities"  TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "trendAppetite"       TEXT;
