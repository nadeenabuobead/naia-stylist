-- Manual full-refund withdrawal path (2026-11-17) — EU statutory
-- withdrawal, distinct from ordinary cancellation/dispute/goodwill-refund.
--
-- Written by hand against the schema's own validated structure (prisma
-- migrate dev was not run — no database was contacted to generate or
-- apply this file, same read-only migration policy as every other
-- hand-written migration in this history, e.g. 20261117010000_terms_
-- acceptance, 20261117000000_withdrawal_request). NOT applied to any
-- database. Additive only: two new nullable columns on Subscription, one
-- new table, two new enums — no existing table's data is touched.

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN "earlyServiceConsentedAt" TIMESTAMP(3);
ALTER TABLE "Subscription" ADD COLUMN "termsVersionAtCheckout" TEXT;

-- CreateEnum
CREATE TYPE "WithdrawalRefundOutcome" AS ENUM (
    'ELIGIBLE_PENDING',
    'BLOCKED_EARLY_SERVICE_CONSENT',
    'BLOCKED_NO_QUALIFYING_PAYMENT',
    'BLOCKED_ALREADY_REFUNDED',
    'BLOCKED_OPEN_DISPUTE',
    'REFUND_REQUESTED',
    'REFUND_SUCCEEDED',
    'PROVIDER_FAILED'
);

-- CreateTable
CREATE TABLE "WithdrawalRefundCase" (
    "id" TEXT NOT NULL,
    "withdrawalRequestId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "originalTransactionId" TEXT,
    "outcome" "WithdrawalRefundOutcome" NOT NULL DEFAULT 'ELIGIBLE_PENDING',
    "detail" JSONB,
    "providerRefundId" TEXT,
    "subscriptionCanceledAt" TIMESTAMP(3),
    "confirmationRecordedAt" TIMESTAMP(3),
    "performedByEmail" TEXT,
    "auditLogId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WithdrawalRefundCase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WithdrawalRefundCase_withdrawalRequestId_key" ON "WithdrawalRefundCase"("withdrawalRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "WithdrawalRefundCase_providerRefundId_key" ON "WithdrawalRefundCase"("providerRefundId");

-- CreateIndex
CREATE INDEX "WithdrawalRefundCase_subscriptionId_idx" ON "WithdrawalRefundCase"("subscriptionId");

-- CreateIndex
CREATE INDEX "WithdrawalRefundCase_originalTransactionId_idx" ON "WithdrawalRefundCase"("originalTransactionId");

-- AddForeignKey
ALTER TABLE "WithdrawalRefundCase" ADD CONSTRAINT "WithdrawalRefundCase_withdrawalRequestId_fkey" FOREIGN KEY ("withdrawalRequestId") REFERENCES "WithdrawalRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
