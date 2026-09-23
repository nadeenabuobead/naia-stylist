-- Trend content feedback (Step 7)
--
-- Deliberate non-save interactions: NOT_FOR_ME and STYLED. Kept apart from
-- SavedItem because a save and a dismissal answer opposite questions.
--
-- The unique constraint is what makes repeated clicking harmless: one row per
-- customer, content and action, so ten clicks are one signal.
--
-- reportId is NOT a foreign key — feedback survives a report being unpublished.
-- Deterministic: plain CREATE, no existence guards.

CREATE TABLE "TrendContentFeedback" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "contentLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrendContentFeedback_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TrendContentFeedback_customerId_reportId_contentType_content_key"
  ON "TrendContentFeedback"("customerId", "reportId", "contentType", "contentId", "action");
CREATE INDEX "TrendContentFeedback_customerId_action_idx" ON "TrendContentFeedback"("customerId", "action");
CREATE INDEX "TrendContentFeedback_customerId_reportId_idx" ON "TrendContentFeedback"("customerId", "reportId");

ALTER TABLE "TrendContentFeedback" ADD CONSTRAINT "TrendContentFeedback_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
