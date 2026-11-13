-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('PENDING', 'WON', 'LOST', 'PREVENTED');

-- CreateEnum
CREATE TYPE "AccessRevocationReason" AS ENUM ('REFUND', 'DISPUTE_LOST');

-- AlterTable
ALTER TABLE "BillingTransaction" ADD COLUMN     "fundedPeriodEnd" TIMESTAMP(3),
ADD COLUMN     "fundedPeriodStart" TIMESTAMP(3),
ADD COLUMN     "refundsTransactionId" TEXT;

-- CreateTable
CREATE TABLE "Dispute" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "providerDisputeId" TEXT NOT NULL,
    "status" "DisputeStatus" NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'AED',
    "lastEventAt" TIMESTAMP(3) NOT NULL,
    "lastEventFinalityRank" INTEGER NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "overrideAuditLogId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dispute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessRevocation" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "reason" "AccessRevocationReason" NOT NULL,
    "sourceTransactionId" TEXT,
    "sourceDisputeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedReason" TEXT,
    "overrideAuditLogId" TEXT,

    CONSTRAINT "AccessRevocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Dispute_providerDisputeId_key" ON "Dispute"("providerDisputeId");

-- CreateIndex
CREATE INDEX "Dispute_customerId_idx" ON "Dispute"("customerId");

-- CreateIndex
CREATE INDEX "Dispute_subscriptionId_idx" ON "Dispute"("subscriptionId");

-- CreateIndex
CREATE INDEX "AccessRevocation_subscriptionId_resolvedAt_idx" ON "AccessRevocation"("subscriptionId", "resolvedAt");

-- CreateIndex
CREATE INDEX "BillingTransaction_refundsTransactionId_idx" ON "BillingTransaction"("refundsTransactionId");

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessRevocation" ADD CONSTRAINT "AccessRevocation_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

