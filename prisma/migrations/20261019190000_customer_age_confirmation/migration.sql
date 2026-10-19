-- AlterTable: Customer — age-declaration fields. Additive, nullable, both
-- default to unset (NULL) for every existing row, matching the same
-- optional-opt-in shape already used for designResearchConsent*.

ALTER TABLE "Customer" ADD COLUMN "ageConfirmedAt" TIMESTAMP(3);
ALTER TABLE "Customer" ADD COLUMN "ageConfirmationVersion" TEXT;
