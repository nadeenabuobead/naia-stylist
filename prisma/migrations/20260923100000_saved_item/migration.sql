-- SavedItem — the general saved-object store (Step 2)
--
-- Deterministic: plain CREATE / ADD statements, no existence guards. If any of
-- these objects already exists the migration fails loudly, which is the point —
-- a drifted database must not pass silently because a name happens to match.
--
-- reportId is intentionally NOT a foreign key: a save must survive its report
-- being unpublished or deleted and keep rendering from its own snapshot.

-- CreateTable
CREATE TABLE "SavedItem" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "refKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "reportId" TEXT,
    "label" TEXT NOT NULL,
    "sublabel" TEXT,
    "imageUrl" TEXT,
    "sourceKind" TEXT NOT NULL,
    "sourceReportTitle" TEXT,
    "sourceSeason" TEXT,
    "sourceContentId" TEXT,
    "sourceContentLabel" TEXT,
    "sourcePath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SavedItem_customerId_refKey_key" ON "SavedItem"("customerId", "refKey");

-- CreateIndex
CREATE INDEX "SavedItem_customerId_createdAt_idx" ON "SavedItem"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "SavedItem_customerId_contentType_idx" ON "SavedItem"("customerId", "contentType");

-- CreateIndex
CREATE INDEX "SavedItem_customerId_reportId_idx" ON "SavedItem"("customerId", "reportId");

-- AddForeignKey
ALTER TABLE "SavedItem" ADD CONSTRAINT "SavedItem_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
