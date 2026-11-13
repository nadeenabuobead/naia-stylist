-- CreateTable
CREATE TABLE "ManualReviewFlag" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "transactionId" TEXT,
    "disputeId" TEXT,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "resolvedNote" TEXT,

    CONSTRAINT "ManualReviewFlag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ManualReviewFlag_resolvedAt_idx" ON "ManualReviewFlag"("resolvedAt");

-- CreateIndex
CREATE INDEX "ManualReviewFlag_subscriptionId_idx" ON "ManualReviewFlag"("subscriptionId");

-- CreateIndex
CREATE INDEX "ManualReviewFlag_transactionId_idx" ON "ManualReviewFlag"("transactionId");
