-- Phase A: Buy/Skip V1 Outcome persistence foundation
-- Adds BuySkipOutcome (customer-reported decision) as a child of BuyOrSkipAnalysis.
-- Ownership is enforced through the parent: server loads analysis WHERE customerId = session customer.

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

-- CreateIndex: one outcome per analysis
CREATE UNIQUE INDEX "BuySkipOutcome_analysisId_key" ON "BuySkipOutcome"("analysisId");

-- AddForeignKey: ownership cascades through BuyOrSkipAnalysis
ALTER TABLE "BuySkipOutcome" ADD CONSTRAINT "BuySkipOutcome_analysisId_fkey"
    FOREIGN KEY ("analysisId") REFERENCES "BuyOrSkipAnalysis"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
