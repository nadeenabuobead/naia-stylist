-- AlterTable
-- Adds outfitSuggestionId as a nullable column — every existing row gets
-- NULL. No FK constraint (intentional: an OutfitSuggestion can be deleted
-- independently of its try-on history; callers check existence at read
-- time rather than relying on referential integrity here). This migration
-- writes no value into any existing row; it only adds the column and its
-- index.
ALTER TABLE "VirtualTryOnJob" ADD COLUMN "outfitSuggestionId" TEXT;

-- CreateIndex
CREATE INDEX "VirtualTryOnJob_outfitSuggestionId_idx" ON "VirtualTryOnJob"("outfitSuggestionId");
