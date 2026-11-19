-- Saved Items + Trend Feedback (2026-11-19)
--
-- Purely additive: two new tables, no change to any existing column.
-- Generated locally with `prisma migrate diff --from-schema-datamodel
-- --to-schema-datamodel --script` against this worktree's own schema.prisma
-- (before/after this change) — no live or shadow database was touched to
-- produce this file. Not applied anywhere; `prisma migrate deploy` was never
-- run. See scripts/build-preview.sh's NAIA_ALLOW_PREVIEW_MIGRATIONS gate for
-- how this repo normally controls when a pending migration like this one is
-- actually applied to a real database.

-- CreateTable
CREATE TABLE "SavedItem" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "itemKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "contentKey" TEXT NOT NULL,
    "reportSlug" TEXT,
    "label" TEXT NOT NULL,
    "sublabel" TEXT,
    "imageUrl" TEXT,
    "sourceKind" TEXT NOT NULL,
    "sourceReportTitle" TEXT,
    "sourceSeason" TEXT,
    "sourceContentKey" TEXT,
    "sourceContentLabel" TEXT,
    "sourcePath" TEXT,

    CONSTRAINT "SavedItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrendContentFeedback" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reportSlug" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "contentKey" TEXT NOT NULL,
    "contentLabel" TEXT,
    "action" TEXT NOT NULL,

    CONSTRAINT "TrendContentFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SavedItem_customerId_idx" ON "SavedItem"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "SavedItem_customerId_itemKey_key" ON "SavedItem"("customerId", "itemKey");

-- CreateIndex
CREATE INDEX "TrendContentFeedback_customerId_reportSlug_idx" ON "TrendContentFeedback"("customerId", "reportSlug");

-- CreateIndex
CREATE UNIQUE INDEX "TrendContentFeedback_customerId_reportSlug_contentType_cont_key" ON "TrendContentFeedback"("customerId", "reportSlug", "contentType", "contentKey", "action");

-- AddForeignKey
ALTER TABLE "SavedItem" ADD CONSTRAINT "SavedItem_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrendContentFeedback" ADD CONSTRAINT "TrendContentFeedback_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

