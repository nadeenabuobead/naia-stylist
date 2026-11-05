-- GDPR erasure-scoping and partial-failure correction — schema only.
--
-- Written by hand against the schema's own validated structure (prisma
-- migrate dev was not run — no database was contacted to generate or apply
-- this file, per the read-only migration policy for this phase). NOT applied
-- to any database. Additive only: no existing row's data is touched.

-- CreateTable: PendingCustomerErasureFailure
-- Durable, operator-visible record of a GDPR erasure (eraseCustomerData)
-- that hit a genuinely unexpected failure partway through — see
-- customer-erasure-failures.server.ts and admin.maintenance.tsx's retry
-- surface. No FK to Customer: by the time this runs, the customer's row may
-- already be partially erased.
CREATE TABLE "PendingCustomerErasureFailure" (
    "id"            TEXT NOT NULL,
    "customerId"    TEXT NOT NULL,
    "context"       TEXT NOT NULL,
    "lastError"     TEXT NOT NULL,
    "attemptCount"  INTEGER NOT NULL DEFAULT 1,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt"    TIMESTAMP(3),

    CONSTRAINT "PendingCustomerErasureFailure_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PendingCustomerErasureFailure_customerId_key" ON "PendingCustomerErasureFailure"("customerId");
CREATE INDEX "PendingCustomerErasureFailure_resolvedAt_idx" ON "PendingCustomerErasureFailure"("resolvedAt");
