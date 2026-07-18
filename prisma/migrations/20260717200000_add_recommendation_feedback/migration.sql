-- Phase 4B1: Add RecommendationFeedback table + extend PostOutfitReview
-- NOT APPLIED — run manually: psql $DATABASE_URL -f this file
-- Do not apply until Phase 4B1 is reviewed and approved.

-- CreateTable
CREATE TABLE "RecommendationFeedback" (
    "id"               TEXT        NOT NULL,
    "customerId"       TEXT        NOT NULL,
    "sessionId"        TEXT,
    "suggestionId"     TEXT,
    "closetItemId"     TEXT,
    "target"           TEXT        NOT NULL,
    "shopifyProductId" TEXT,
    "rating"           TEXT        NOT NULL,
    "reasonCodes"      TEXT[]      NOT NULL DEFAULT ARRAY[]::TEXT[],
    "vtoAspects"       TEXT[]      NOT NULL DEFAULT ARRAY[]::TEXT[],
    "note"             TEXT,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecommendationFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecommendationFeedback_customerId_idx" ON "RecommendationFeedback"("customerId");
CREATE INDEX "RecommendationFeedback_sessionId_idx"  ON "RecommendationFeedback"("sessionId");
CREATE INDEX "RecommendationFeedback_suggestionId_idx" ON "RecommendationFeedback"("suggestionId");

-- AddForeignKey: Customer
ALTER TABLE "RecommendationFeedback"
    ADD CONSTRAINT "RecommendationFeedback_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: StylingSession (nullable)
ALTER TABLE "RecommendationFeedback"
    ADD CONSTRAINT "RecommendationFeedback_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "StylingSession"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: OutfitSuggestion (nullable)
ALTER TABLE "RecommendationFeedback"
    ADD CONSTRAINT "RecommendationFeedback_suggestionId_fkey"
    FOREIGN KEY ("suggestionId") REFERENCES "OutfitSuggestion"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: ClosetItem (nullable)
ALTER TABLE "RecommendationFeedback"
    ADD CONSTRAINT "RecommendationFeedback_closetItemId_fkey"
    FOREIGN KEY ("closetItemId") REFERENCES "ClosetItem"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: PostOutfitReview — Phase 4B1 post-wear fields (all nullable)
ALTER TABLE "PostOutfitReview"
    ADD COLUMN IF NOT EXISTS "didWearIt"        TEXT,
    ADD COLUMN IF NOT EXISTS "feelingAnswer"    TEXT,
    ADD COLUMN IF NOT EXISTS "fitFeedback"      TEXT,
    ADD COLUMN IF NOT EXISTS "coverageFeedback" TEXT,
    ADD COLUMN IF NOT EXISTS "colourFeedback"   TEXT;
