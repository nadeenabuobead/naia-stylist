-- nAia Admin Foundation (Phase 1)
-- Adds three tables required by the nAia Admin StyleMe QA + Closet Intelligence console.
-- NOT APPLIED — review and apply manually: psql $DATABASE_URL < this file

-- ClosetItemAnalysisSnapshot: captures the normalized AI extraction output BEFORE
-- customer-precedence merge, at analysis time. Provides authoritative AI provenance
-- for the admin Closet Intelligence review surface.
CREATE TABLE "ClosetItemAnalysisSnapshot" (
    "id" TEXT NOT NULL,
    "closetItemId" TEXT NOT NULL,
    "normalizedAnalysis" JSONB NOT NULL,
    "analysisModel" TEXT NOT NULL,
    "analysisSchemaVersion" TEXT NOT NULL,
    "analyzedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClosetItemAnalysisSnapshot_pkey" PRIMARY KEY ("id")
);

-- ClosetItemAdminReview: stores admin QA decisions and sparse JSON overrides for a
-- ClosetItem. One row per item (unique). JSON overrides use key-presence semantics:
-- key present = override active; key absent = fall through to item value.
CREATE TABLE "ClosetItemAdminReview" (
    "id" TEXT NOT NULL,
    "closetItemId" TEXT NOT NULL,
    "reviewStatus" TEXT NOT NULL DEFAULT 'unreviewed',
    "adminNotes" TEXT,
    "overrides" JSONB,
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClosetItemAdminReview_pkey" PRIMARY KEY ("id")
);

-- StylingSessionAdminReview: stores admin QA status (pass/questionable/fail) and
-- notes for a complete StyleMe session. One row per session (unique).
CREATE TABLE "StylingSessionAdminReview" (
    "id" TEXT NOT NULL,
    "stylingSessionId" TEXT NOT NULL,
    "qaStatus" TEXT NOT NULL DEFAULT 'unreviewed',
    "adminNotes" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StylingSessionAdminReview_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "ClosetItemAnalysisSnapshot_closetItemId_idx" ON "ClosetItemAnalysisSnapshot"("closetItemId");
CREATE UNIQUE INDEX "ClosetItemAdminReview_closetItemId_key" ON "ClosetItemAdminReview"("closetItemId");
CREATE UNIQUE INDEX "StylingSessionAdminReview_stylingSessionId_key" ON "StylingSessionAdminReview"("stylingSessionId");

-- Foreign keys (with cascade delete — removing a ClosetItem/StylingSession removes admin data too)
ALTER TABLE "ClosetItemAnalysisSnapshot" ADD CONSTRAINT "ClosetItemAnalysisSnapshot_closetItemId_fkey"
    FOREIGN KEY ("closetItemId") REFERENCES "ClosetItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ClosetItemAdminReview" ADD CONSTRAINT "ClosetItemAdminReview_closetItemId_fkey"
    FOREIGN KEY ("closetItemId") REFERENCES "ClosetItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StylingSessionAdminReview" ADD CONSTRAINT "StylingSessionAdminReview_stylingSessionId_fkey"
    FOREIGN KEY ("stylingSessionId") REFERENCES "StylingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
