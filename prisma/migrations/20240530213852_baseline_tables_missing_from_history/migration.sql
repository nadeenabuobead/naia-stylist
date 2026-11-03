-- Baseline: tables declared in schema.prisma that were never captured by any
-- migration in this history (originally established via `prisma db push`
-- directly, before this history existed or was kept complete). Column shapes
-- recovered from Prisma's authoritative generated SQL for the current schema,
-- minus every column a LATER migration in this same history already adds --
-- those migrations still run afterward and add them at the correct point.
-- Three columns use their ORIGINAL (pre-later-ALTER) shape, confirmed by the
-- migrations that later change them: Customer.email and ClosetItem.imageUrl
-- start NOT NULL (a later migration each drops that constraint);
-- OnboardingProfile.lifestyle starts as a plain TEXT scalar (a later migration
-- adds lifestyle_new TEXT[], drops this column, and renames the new one in).
-- StyleMeOutcome and BuySkipOutcome are deliberately NOT included here even
-- though they too are never CREATE TABLE'd in the real history: each already
-- has its own existing, defensive (IF NOT EXISTS) migration that creates it.

-- CreateEnum (same db-push-vs-migration-history gap, for types instead of
-- tables — wrapped defensively, matching this project's own existing
-- convention for exactly this situation, e.g. 20260903100000_add_buy_skip_outcome)
DO $$ BEGIN
  CREATE TYPE "StyleSource" AS ENUM ('CLOSET', 'NAIA', 'BOTH');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "ClosetCategory" AS ENUM ('TOPS', 'BOTTOMS', 'DRESSES', 'OUTERWEAR', 'SHOES', 'BAGS', 'ACCESSORIES', 'JEWELRY', 'ACTIVEWEAR', 'SWIMWEAR', 'LOUNGEWEAR', 'OTHER');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "BuySkipVerdict" AS ENUM ('BUY', 'SKIP', 'MAYBE', 'INCOMPLETE');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "OutfitItemType" AS ENUM ('TOP', 'BOTTOM', 'DRESS', 'OUTERWEAR', 'SHOES', 'BAG', 'ACCESSORY', 'JEWELRY');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "TrendReportType" AS ENUM ('SEASONAL_FORECAST', 'COLOR_REPORT', 'STYLE_REPORT', 'COLLECTION_REVIEW', 'FASHION_WEEK', 'TREND_ALERT');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "shopifyCustomerId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StylingSession" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currentMood" TEXT,
    "desiredFeeling" TEXT,
    "occasion" TEXT,
    "specificNeeds" TEXT,
    "bodyPreference" TEXT,
    "styleDNA" TEXT,
    "styleFrom" "StyleSource" NOT NULL DEFAULT 'BOTH',
    "weather" TEXT,
    "timeOfDay" TEXT,
    "selectedSuggestionId" TEXT,

    CONSTRAINT "StylingSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutfitSuggestion" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT DEFAULT 'PENDING',
    "perfumeRec" TEXT,
    "perfumeNotes" TEXT,
    "hairstyleRec" TEXT,
    "hairstyleNotes" TEXT,
    "makeupVibeRec" TEXT,
    "makeupNotes" TEXT,
    "songRec" TEXT,
    "songArtist" TEXT,
    "moodDescription" TEXT,
    "outfitName" TEXT,
    "heroImageUrl" TEXT,
    "whyThisWorks" TEXT,
    "confidenceBoost" TEXT,
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "savedAsLook" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "OutfitSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClosetItem" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "name" TEXT,
    "imageUrl" TEXT NOT NULL,
    "thumbnailUrl" TEXT,
    "category" "ClosetCategory" NOT NULL,
    "subcategory" TEXT,
    "colors" TEXT[],
    "primaryColor" TEXT,
    "pattern" TEXT,
    "material" TEXT,
    "styleTags" TEXT[],
    "seasons" TEXT[],
    "occasions" TEXT[],
    "brand" TEXT,
    "purchaseDate" TIMESTAMP(3),
    "purchasePrice" DOUBLE PRECISION,
    "timesWorn" INTEGER NOT NULL DEFAULT 0,
    "lastWorn" TIMESTAMP(3),
    "favorite" BOOLEAN NOT NULL DEFAULT false,
    "aiDescription" TEXT,
    "aiStyleNotes" TEXT,

    CONSTRAINT "ClosetItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnboardingProfile" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "stylePersonalities" TEXT[],
    "styleIcons" TEXT[],
    "favoriteColors" TEXT[],
    "avoidColors" TEXT[],
    "lifestyle" TEXT,
    "dressesFor" TEXT[],
    "typicalDay" TEXT,
    "currentMood" TEXT,
    "desiredFeeling" TEXT,
    "confidenceBlockers" TEXT[],
    "styleStruggles" TEXT[],
    "comfortLevel" INTEGER,
    "budgetRange" TEXT,
    "shoppingHabits" TEXT,
    "helpWantedMost" TEXT,
    "bodyFocusAreas" TEXT[],
    "bodyAvoidAreas" TEXT[],
    "fitPreferences" TEXT[],
    "topSize" TEXT,
    "bottomSize" TEXT,
    "dressSize" TEXT,
    "shoeSize" TEXT,

    CONSTRAINT "OnboardingProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuyOrSkipAnalysis" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "imageUrl" TEXT,
    "productUrl" TEXT,
    "productName" TEXT,
    "productPrice" DOUBLE PRECISION,
    "verdict" "BuySkipVerdict" NOT NULL,
    "reasoning" TEXT NOT NULL,
    "worksWithWardrobe" BOOLEAN,
    "wardrobeMatches" TEXT[],
    "hasSimilar" BOOLEAN,
    "similarItems" TEXT[],
    "fitsHerStyle" BOOLEAN,
    "styleNotes" TEXT,
    "alternatives" TEXT,
    "stylingIdeas" TEXT,
    "userDecision" TEXT,

    CONSTRAINT "BuyOrSkipAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostOutfitReview" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "overallFeeling" INTEGER,
    "feltLikeHer" TEXT,
    "desiredFeelingAchieved" TEXT,
    "wouldWearAgain" TEXT,
    "physicallyComfortable" TEXT,
    "workedTags" TEXT,
    "didntWorkTags" TEXT,
    "additionalNotes" TEXT,
    "objections" TEXT,
    "itemFeedback" JSONB,
    "confidenceBefore" INTEGER,
    "confidenceAfter" INTEGER,
    "woreItPhotoUrl" TEXT,

    CONSTRAINT "PostOutfitReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutfitItem" (
    "id" TEXT NOT NULL,
    "suggestionId" TEXT NOT NULL,
    "itemType" "OutfitItemType" NOT NULL,
    "closetItemId" TEXT,
    "shopifyProductId" TEXT,
    "productTitle" TEXT,
    "productImageUrl" TEXT,
    "productPrice" DOUBLE PRECISION,
    "productUrl" TEXT,
    "stylingNotes" TEXT,

    CONSTRAINT "OutfitItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WardrobeInsight" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalItems" INTEGER NOT NULL,
    "itemsByCategory" JSONB NOT NULL,
    "colorDistribution" JSONB NOT NULL,
    "dominantColors" TEXT[],
    "missingColors" TEXT[],
    "colorPaletteType" TEXT,
    "styleDistribution" JSONB NOT NULL,
    "dominantStyles" TEXT[],
    "missingEssentials" TEXT[],
    "overrepresented" TEXT[],
    "underrepresented" TEXT[],
    "mostWorn" TEXT[],
    "neverWorn" TEXT[],
    "underutilized" TEXT[],
    "nextPurchases" JSONB NOT NULL,
    "outfitPotential" INTEGER,
    "versatilityScore" INTEGER,
    "aiSummary" TEXT,
    "seasonalReadiness" JSONB,

    CONSTRAINT "WardrobeInsight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedLook" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "name" TEXT,
    "occasion" TEXT,
    "notes" TEXT,
    "fromSuggestionId" TEXT,
    "perfumeRec" TEXT,
    "hairstyleRec" TEXT,
    "makeupVibeRec" TEXT,
    "songRec" TEXT,
    "timesWorn" INTEGER NOT NULL DEFAULT 0,
    "lastWorn" TIMESTAMP(3),

    CONSTRAINT "SavedLook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedLookItem" (
    "id" TEXT NOT NULL,
    "savedLookId" TEXT NOT NULL,
    "itemType" "OutfitItemType" NOT NULL,
    "closetItemId" TEXT,
    "shopifyProductId" TEXT,
    "productImageUrl" TEXT,

    CONSTRAINT "SavedLookItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConfidenceScore" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "score" INTEGER NOT NULL,
    "context" TEXT,
    "sessionId" TEXT,

    CONSTRAINT "ConfidenceScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrendReport" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "coverImage" TEXT,
    "summary" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "reportType" "TrendReportType" NOT NULL,
    "season" TEXT,
    "tags" TEXT[],
    "trendingColors" JSONB,
    "trendingStyles" JSONB,
    "keyPieces" JSONB,

    CONSTRAINT "TrendReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrendReportView" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "relevanceScore" INTEGER,
    "matchingStyles" TEXT[],

    CONSTRAINT "TrendReportView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StylingEvent" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productTitle" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StylingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Customer_shopifyCustomerId_key" ON "Customer"("shopifyCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_email_key" ON "Customer"("email");

-- CreateIndex
CREATE UNIQUE INDEX "OnboardingProfile_customerId_key" ON "OnboardingProfile"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "PostOutfitReview_sessionId_key" ON "PostOutfitReview"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "TrendReport_slug_key" ON "TrendReport"("slug");

-- CreateIndex
CREATE INDEX "StylingEvent_sessionId_idx" ON "StylingEvent"("sessionId");

-- CreateIndex
CREATE INDEX "StylingEvent_productId_idx" ON "StylingEvent"("productId");

-- CreateIndex
CREATE INDEX "StylingEvent_eventType_idx" ON "StylingEvent"("eventType");

-- AddForeignKey
ALTER TABLE "OnboardingProfile" ADD CONSTRAINT "OnboardingProfile_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClosetItem" ADD CONSTRAINT "ClosetItem_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StylingSession" ADD CONSTRAINT "StylingSession_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutfitSuggestion" ADD CONSTRAINT "OutfitSuggestion_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "StylingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyOrSkipAnalysis" ADD CONSTRAINT "BuyOrSkipAnalysis_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostOutfitReview" ADD CONSTRAINT "PostOutfitReview_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "StylingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostOutfitReview" ADD CONSTRAINT "PostOutfitReview_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutfitItem" ADD CONSTRAINT "OutfitItem_suggestionId_fkey" FOREIGN KEY ("suggestionId") REFERENCES "OutfitSuggestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutfitItem" ADD CONSTRAINT "OutfitItem_closetItemId_fkey" FOREIGN KEY ("closetItemId") REFERENCES "ClosetItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WardrobeInsight" ADD CONSTRAINT "WardrobeInsight_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedLook" ADD CONSTRAINT "SavedLook_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedLookItem" ADD CONSTRAINT "SavedLookItem_savedLookId_fkey" FOREIGN KEY ("savedLookId") REFERENCES "SavedLook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedLookItem" ADD CONSTRAINT "SavedLookItem_closetItemId_fkey" FOREIGN KEY ("closetItemId") REFERENCES "ClosetItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConfidenceScore" ADD CONSTRAINT "ConfidenceScore_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrendReportView" ADD CONSTRAINT "TrendReportView_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "TrendReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrendReportView" ADD CONSTRAINT "TrendReportView_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StylingEvent" ADD CONSTRAINT "StylingEvent_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StylingEvent" ADD CONSTRAINT "StylingEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "StylingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

