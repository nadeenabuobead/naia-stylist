-- CreateEnum (idempotent: type may already exist on staging from a prior db push)
DO $$ BEGIN
  CREATE TYPE "BuySkipDecision" AS ENUM ('BOUGHT_IT', 'DIDNT_BUY_IT', 'STILL_DECIDING');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "BuySkipPostOutcome" AS ENUM ('LOVE_IT', 'ITS_OKAY', 'RETURNED_IT');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "BuySkipOutcome" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "decision" "BuySkipDecision" NOT NULL,
    "postPurchaseOutcome" "BuySkipPostOutcome",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuySkipOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "BuySkipOutcome_analysisId_key" ON "BuySkipOutcome"("analysisId");

-- AddForeignKey (safe: errors if constraint already exists, so guard it)
DO $$ BEGIN
  ALTER TABLE "BuySkipOutcome" ADD CONSTRAINT "BuySkipOutcome_analysisId_fkey"
    FOREIGN KEY ("analysisId") REFERENCES "BuyOrSkipAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
