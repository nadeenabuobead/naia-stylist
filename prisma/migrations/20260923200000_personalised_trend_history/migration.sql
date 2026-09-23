-- Personalised Trend Edit history + entitlement unlocks (Step 4)
--
-- Deterministic: plain CREATE statements, no existence guards, so a drifted
-- database fails loudly rather than passing silently on a name match.
--
-- reportId is NOT a foreign key in either table. A customer's personal history
-- must survive a report being unpublished or deleted — the snapshot replays
-- from its own stored copy. Customer deletion DOES cascade: this is her data.

-- CreateTable
CREATE TABLE "PersonalisedTrendEdit" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "reportSlug" TEXT NOT NULL,
    "reportTitle" TEXT NOT NULL,
    "reportSeason" TEXT NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "snapshotHash" TEXT NOT NULL,
    "edit" JSONB NOT NULL,
    "evidenceSummary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonalisedTrendEdit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonalisedTrendEditUnlock" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "reportSlug" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grantedPeriod" TEXT NOT NULL,

    CONSTRAINT "PersonalisedTrendEditUnlock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PersonalisedTrendEdit_customerId_reportId_snapshotHash_key" ON "PersonalisedTrendEdit"("customerId", "reportId", "snapshotHash");

-- CreateIndex
CREATE INDEX "PersonalisedTrendEdit_customerId_reportId_createdAt_idx" ON "PersonalisedTrendEdit"("customerId", "reportId", "createdAt");

-- CreateIndex
CREATE INDEX "PersonalisedTrendEdit_customerId_createdAt_idx" ON "PersonalisedTrendEdit"("customerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PersonalisedTrendEditUnlock_customerId_reportId_key" ON "PersonalisedTrendEditUnlock"("customerId", "reportId");

-- CreateIndex
CREATE INDEX "PersonalisedTrendEditUnlock_customerId_grantedPeriod_idx" ON "PersonalisedTrendEditUnlock"("customerId", "grantedPeriod");

-- AddForeignKey
ALTER TABLE "PersonalisedTrendEdit" ADD CONSTRAINT "PersonalisedTrendEdit_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalisedTrendEditUnlock" ADD CONSTRAINT "PersonalisedTrendEditUnlock_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
