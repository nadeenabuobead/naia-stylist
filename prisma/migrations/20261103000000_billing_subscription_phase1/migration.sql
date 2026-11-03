-- Billing — Phase 1 (schema only)
--
-- Additive data model for the paid-membership lifecycle approved 2026-11-03.
-- No existing table or column is modified. Customer.membershipStatus is
-- untouched and remains the single value every existing checkEntitlement/
-- reserve* call reads — nothing here changes that today. No row in any of
-- these new tables is written by any live code path yet; that is Phase 3
-- (provider integration).

-- 1. CreateEnum: SubscriptionStatus
CREATE TYPE "SubscriptionStatus" AS ENUM ('INCOMPLETE', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED');

-- 2. CreateEnum: BillingPlanType
CREATE TYPE "BillingPlanType" AS ENUM ('MONTHLY', 'ANNUAL');

-- 3. CreateEnum: BillingTransactionType
CREATE TYPE "BillingTransactionType" AS ENUM (
  'SUBSCRIPTION_INITIAL',
  'SUBSCRIPTION_RENEWAL',
  'SUBSCRIPTION_REFUND',
  'ADDON_STYLEME_BOOST',
  'ADDON_VTO_BOOST',
  'ADDON_CLOSET_EXPANSION'
);

-- 4. CreateEnum: BillingTransactionStatus
CREATE TYPE "BillingTransactionStatus" AS ENUM ('SUCCEEDED', 'FAILED', 'REFUNDED');

-- 5. CreateTable: Subscription
-- Current lifecycle state of one subscription object, mutated in place as
-- webhooks arrive — mirrors a provider's own long-lived subscription object.
CREATE TABLE "Subscription" (
    "id"                     TEXT NOT NULL,
    "customerId"             TEXT NOT NULL,
    "status"                 "SubscriptionStatus" NOT NULL,
    "planType"               "BillingPlanType" NOT NULL,
    "provider"               TEXT NOT NULL,
    "providerCustomerId"     TEXT,
    "providerSubscriptionId" TEXT,
    "currentPeriodStart"     TIMESTAMP(3),
    "currentPeriodEnd"       TIMESTAMP(3),
    "cancelAtPeriodEnd"      BOOLEAN NOT NULL DEFAULT false,
    "canceledAt"             TIMESTAMP(3),
    "endedAt"                TIMESTAMP(3),
    "providerSyncedAt"       TIMESTAMP(3),
    "createdAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"              TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_providerSubscriptionId_key" ON "Subscription"("providerSubscriptionId");

-- CreateIndex
CREATE INDEX "Subscription_customerId_idx" ON "Subscription"("customerId");

-- CreateIndex
CREATE INDEX "Subscription_providerSubscriptionId_idx" ON "Subscription"("providerSubscriptionId");

-- CreateIndex
CREATE INDEX "Subscription_providerCustomerId_idx" ON "Subscription"("providerCustomerId");

-- AddForeignKey
-- Restrict, not Cascade: a financial record must not be silently destroyed
-- by a customer-erasure flow. See prisma/schema.prisma's Subscription
-- comment for the full rationale.
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 6. CreateTable: BillingTransaction
-- Immutable ledger — one row per actual financial event. The source for
-- customer billing history and for reconciling payments against entitlements.
CREATE TABLE "BillingTransaction" (
    "id"                        TEXT NOT NULL,
    "customerId"                TEXT NOT NULL,
    "subscriptionId"            TEXT,
    "type"                      "BillingTransactionType" NOT NULL,
    "status"                    "BillingTransactionStatus" NOT NULL,
    "amount"                    INTEGER NOT NULL,
    "currency"                  TEXT NOT NULL DEFAULT 'AED',
    "provider"                  TEXT NOT NULL,
    "providerTransactionId"     TEXT,
    "addonQuantityGranted"      INTEGER,
    "addonAppliesToPeriodStart" TIMESTAMP(3),
    "addonAppliesToPeriodEnd"   TIMESTAMP(3),
    "occurredAt"                TIMESTAMP(3) NOT NULL,
    "createdAt"                 TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BillingTransaction_providerTransactionId_key" ON "BillingTransaction"("providerTransactionId");

-- CreateIndex
CREATE INDEX "BillingTransaction_customerId_idx" ON "BillingTransaction"("customerId");

-- CreateIndex
CREATE INDEX "BillingTransaction_subscriptionId_idx" ON "BillingTransaction"("subscriptionId");

-- AddForeignKey
-- Restrict — same rationale as Subscription above: this IS the financial
-- record retention and reconciliation require.
ALTER TABLE "BillingTransaction" ADD CONSTRAINT "BillingTransaction_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
-- SetNull — losing the Subscription parent must not block deleting this
-- ledger row; the transaction stands on its own via customerId and the
-- provider identifiers.
ALTER TABLE "BillingTransaction" ADD CONSTRAINT "BillingTransaction_subscriptionId_fkey"
    FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 7. CreateTable: ProcessedWebhookEvent
-- Idempotency ledger for provider webhook deliveries. No foreign key to
-- Customer — deliberately a loose reference only (see schema comment).
CREATE TABLE "ProcessedWebhookEvent" (
    "id"              TEXT NOT NULL,
    "provider"        TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "eventType"       TEXT NOT NULL,
    "eventCreatedAt"  TIMESTAMP(3) NOT NULL,
    "processedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "customerId"      TEXT,
    "payload"         JSONB,

    CONSTRAINT "ProcessedWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProcessedWebhookEvent_provider_providerEventId_key" ON "ProcessedWebhookEvent"("provider", "providerEventId");

-- CreateIndex
CREATE INDEX "ProcessedWebhookEvent_customerId_idx" ON "ProcessedWebhookEvent"("customerId");
