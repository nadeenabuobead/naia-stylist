-- EU statutory right-of-withdrawal REQUEST capture (Legal handoff W2,
-- 2026-11-17) — a durable, timestamped record that a withdrawal request
-- was made and acknowledged. Explicitly NOT a refund or cancellation
-- mechanism: nothing in this migration touches "Subscription" or its
-- cancellation fields. Manual refund processing (approved as acceptable)
-- happens outside this table entirely.
--
-- Written by hand against the schema's own validated structure (prisma
-- migrate dev was not run — no database was contacted to generate or apply
-- this file, same read-only migration policy as every other hand-written
-- migration in this history, e.g. 20261115000000_customer_export_job).
-- NOT applied to any database. Additive only: one new table, one new enum,
-- no existing table touched.

-- CreateEnum
CREATE TYPE "WithdrawalRequestStatus" AS ENUM ('SUBMITTED', 'ACKNOWLEDGED', 'CLOSED');

-- CreateTable
CREATE TABLE "WithdrawalRequest" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "customerEmailAtRequest" TEXT NOT NULL,
    "customerNameAtRequest" TEXT,
    "reference" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "WithdrawalRequestStatus" NOT NULL DEFAULT 'SUBMITTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WithdrawalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WithdrawalRequest_reference_key" ON "WithdrawalRequest"("reference");

-- CreateIndex
CREATE INDEX "WithdrawalRequest_customerId_idx" ON "WithdrawalRequest"("customerId");

-- CreateIndex
CREATE INDEX "WithdrawalRequest_submittedAt_idx" ON "WithdrawalRequest"("submittedAt");

-- AddForeignKey
ALTER TABLE "WithdrawalRequest" ADD CONSTRAINT "WithdrawalRequest_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Partial unique index (2026-11-17, duplicate-submission follow-up): at
-- most one non-CLOSED request per customer, enforced by the database
-- itself, not just the application's check-then-create logic — closes
-- the race a pure application-level check can't (two truly concurrent
-- submissions both passing the "is there an open one?" read before
-- either writes). Prisma's schema language has no syntax for a partial
-- index, so this exists only here, not mirrored in schema.prisma;
-- withdrawal-request.server.ts handles the resulting unique-violation by
-- re-reading and returning the now-existing open request, the same
-- pattern already used for the reference-collision retry above.
CREATE UNIQUE INDEX "WithdrawalRequest_one_open_per_customer_key" ON "WithdrawalRequest"("customerId") WHERE "status" != 'CLOSED';
