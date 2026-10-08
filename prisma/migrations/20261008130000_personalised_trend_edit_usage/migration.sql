-- CreateTable: PersonalisedTrendEditUsage
-- Canonical customer-entitlement/usage truth for Personalised Trend Edit
-- (1/month). Distinct from JourneyEvent, which stays analytics-only and is
-- never read for Plan & Usage or quota enforcement.
--
-- reportSlug is a historical string identity, not a FK to EditorialTrendReport:
-- an editorial report may later be edited or archived, but a customer's
-- already-consumed usage for a given period must remain valid regardless.
--
-- periodKey ("YYYY-MM", UTC) exists only for the idempotency constraint below —
-- monthly counting itself queries createdAt against the same usage-window
-- authority (getUsageWindow()) every sibling metered feature already uses.
CREATE TABLE "PersonalisedTrendEditUsage" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "reportSlug" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonalisedTrendEditUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Idempotency authority: at most one usage row per customer, per report, per
-- period. The application's create-if-absent write relies on this constraint
-- as the final race-safety guarantee, not merely a check-then-create.
CREATE UNIQUE INDEX "PersonalisedTrendEditUsage_customerId_reportSlug_periodKey_key"
    ON "PersonalisedTrendEditUsage"("customerId", "reportSlug", "periodKey");

-- CreateIndex
CREATE INDEX "PersonalisedTrendEditUsage_customerId_createdAt_idx"
    ON "PersonalisedTrendEditUsage"("customerId", "createdAt");

-- AddForeignKey
ALTER TABLE "PersonalisedTrendEditUsage" ADD CONSTRAINT "PersonalisedTrendEditUsage_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
