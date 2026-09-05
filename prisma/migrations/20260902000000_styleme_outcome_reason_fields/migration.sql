-- StyleMe Outcome QA redesign — additive reason fields
-- Adds whatWorked, whatFeltOff, didntWearReasons, reasonOtherNote to StyleMeOutcome.
-- All new columns are nullable / default empty; existing rows are unaffected.

ALTER TABLE "StyleMeOutcome"
  ADD COLUMN IF NOT EXISTS "whatWorked"       TEXT[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "whatFeltOff"      TEXT[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "didntWearReasons" TEXT[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "reasonOtherNote"  TEXT;
