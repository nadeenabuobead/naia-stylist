-- Wardrobe Intelligence revision.
--
-- Four additions, all additive and all nullable or defaulted, so an existing
-- row keeps working untouched:
--   1. Closet completeness, so shopping advice knows how much of the wardrobe
--      nAia is actually looking at.
--   2. WardrobeSnapshot, so "what changed after adding a piece?" has a real
--      before to compare against rather than an assumed one.
--   3. Design-research consent and an account type, so future aggregated
--      NADINE insight can filter at the query layer and never include our own
--      test accounts.
--   4. Variant and size on NADINE feedback, so a fit complaint can be told
--      apart from a design complaint where the flow genuinely knows them.

-- 1 ── Closet completeness ---------------------------------------------------
ALTER TABLE "OnboardingProfile"
  ADD COLUMN IF NOT EXISTS "closetCompleteness"   TEXT,
  ADD COLUMN IF NOT EXISTS "closetCompletenessAt" TIMESTAMP(3);

-- 2 ── Account type ----------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AccountType') THEN
    CREATE TYPE "AccountType" AS ENUM ('CUSTOMER', 'TEST', 'DEMO', 'QA');
  END IF;
END$$;

ALTER TABLE "Customer"
  ADD COLUMN IF NOT EXISTS "accountType" "AccountType" NOT NULL DEFAULT 'CUSTOMER';

-- 3 ── Design-research consent. Default is NOT consented, deliberately. -------
ALTER TABLE "Customer"
  ADD COLUMN IF NOT EXISTS "designResearchConsent"        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "designResearchConsentAt"      TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "designResearchConsentVersion" TEXT;

-- 4 ── Product context on feedback -------------------------------------------
ALTER TABLE "RecommendationFeedback"
  ADD COLUMN IF NOT EXISTS "shopifyVariantId" TEXT,
  ADD COLUMN IF NOT EXISTS "sizeLabel"        TEXT;

-- 5 ── Wardrobe snapshots ----------------------------------------------------
CREATE TABLE IF NOT EXISTS "WardrobeSnapshot" (
  "id"          TEXT         NOT NULL,
  "customerId"  TEXT         NOT NULL,
  "takenAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closetCount" INTEGER      NOT NULL,
  "summary"     JSONB        NOT NULL,
  CONSTRAINT "WardrobeSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "WardrobeSnapshot_customerId_takenAt_idx"
  ON "WardrobeSnapshot" ("customerId", "takenAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'WardrobeSnapshot_customerId_fkey'
  ) THEN
    ALTER TABLE "WardrobeSnapshot"
      ADD CONSTRAINT "WardrobeSnapshot_customerId_fkey"
      FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;
