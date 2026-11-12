-- Concurrent-checkout protection — schema only.
--
-- Written by hand against the schema's own validated structure (prisma
-- migrate dev was not run — no database was contacted to generate or apply
-- this file, per the read-only migration policy for this phase). NOT applied
-- to any database. Additive only: no existing table or row is touched.
--
-- Closes a genuine concurrency gap: the pre-existing "does a non-terminal
-- Subscription row already exist" check in api.billing-checkout.tsx only
-- ever sees something once an EARLIER checkout attempt's webhook has
-- landed, which can be minutes away. Two requests racing BEFORE any
-- Subscription row exists (two tabs, a double-click outside the 5-minute
-- idempotency-key bucket, two different plan types) could each mint a
-- separate, independently-billed Stripe subscription. The customerId
-- UNIQUE constraint below is the actual atomicity guarantee — see
-- schema.prisma's own header comment on this model for the full lifecycle.

-- CreateTable: CheckoutReservation
CREATE TABLE "CheckoutReservation" (
    "id"                        TEXT NOT NULL,
    "customerId"                TEXT NOT NULL,
    "planType"                  "BillingPlanType" NOT NULL,
    "providerCheckoutSessionId" TEXT,
    "createdAt"                 TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt"                 TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckoutReservation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CheckoutReservation_customerId_key" ON "CheckoutReservation"("customerId");
