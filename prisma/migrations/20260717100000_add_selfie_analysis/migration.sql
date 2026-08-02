-- Phase 4A8: Add SelfieAnalysis table
-- NOT APPLIED — run manually: psql $DATABASE_URL -f this file
-- Do not apply until Phase 4A8 is reviewed and approved.

-- CreateTable
CREATE TABLE "SelfieAnalysis" (
    "id"              TEXT        NOT NULL,
    "customerId"      TEXT        NOT NULL,
    "consentAt"       TIMESTAMP(3) NOT NULL,
    "photoPublicId"   TEXT,
    "photoFormat"     TEXT,
    "photoDeletedAt"  TIMESTAMP(3),
    "analysisStatus"    TEXT        NOT NULL,
    "analysisResult"    JSONB,
    "analysedAt"        TIMESTAMP(3),
    "analysisDeletedAt" TIMESTAMP(3),
    "analysisVersion"   INTEGER     NOT NULL DEFAULT 1,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SelfieAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (unique: one record per customer)
CREATE UNIQUE INDEX "SelfieAnalysis_customerId_key" ON "SelfieAnalysis"("customerId");

-- CreateIndex (lookup by customerId)
CREATE INDEX "SelfieAnalysis_customerId_idx" ON "SelfieAnalysis"("customerId");

-- AddForeignKey
ALTER TABLE "SelfieAnalysis"
    ADD CONSTRAINT "SelfieAnalysis_customerId_fkey"
    FOREIGN KEY ("customerId")
    REFERENCES "Customer"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;
