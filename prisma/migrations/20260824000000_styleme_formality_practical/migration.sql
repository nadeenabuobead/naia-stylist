-- Add formalityConditional and practicalIds to StylingSession for StyleMe
-- Step 2A regenerate correctness — same bug class as the bodyNeeds fix
-- (20260822000001_styleme_body_needs): without these columns, "New Look,
-- Same Vibe" cannot recover the customer's formality/practical answers and
-- silently drops them on regenerate. Historical sessions default safely.

ALTER TABLE "StylingSession" ADD COLUMN "formalityConditional" TEXT;
ALTER TABLE "StylingSession" ADD COLUMN "practicalIds" TEXT[] NOT NULL DEFAULT '{}';
