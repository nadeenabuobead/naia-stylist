-- CreateEnum
CREATE TYPE "BuySkipDecision" AS ENUM ('BOUGHT_IT', 'DIDNT_BUY_IT', 'STILL_DECIDING');

-- CreateEnum
CREATE TYPE "BuySkipPostOutcome" AS ENUM ('LOVE_IT', 'ITS_OKAY', 'RETURNED_IT');

-- CreateTable
CREATE TABLE "BuySkipOutcome" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "decision" "BuySkipDecision" NOT NULL,
    "postPurchaseOutcome" "BuySkipPostOutcome",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuySkipOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BuySkipOutcome_analysisId_key" ON "BuySkipOutcome"("analysisId");

-- AddForeignKey
ALTER TABLE "BuySkipOutcome" ADD CONSTRAINT "BuySkipOutcome_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "BuyOrSkipAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;
