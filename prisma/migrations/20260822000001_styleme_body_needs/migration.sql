-- Add bodyNeeds to StylingSession for StyleMe regenerate correctness.
-- bodyNeeds stores the normalized body-need IDs from the comfort step so that
-- "New Look, Same Vibe" can re-supply them to the recommendation engine.
-- Historical sessions default to an empty array.

ALTER TABLE "StylingSession" ADD COLUMN "bodyNeeds" TEXT[] NOT NULL DEFAULT '{}';
