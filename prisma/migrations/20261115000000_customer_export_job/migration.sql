-- Large-export completion mechanism (>300-image ZIP export).
--
-- Written by hand against the schema's own validated structure (prisma
-- migrate dev was not run — no database was contacted to generate or apply
-- this file, per the same read-only migration policy used for
-- 20261112000000_cloudinary_asset_lifecycle and
-- 20261105090000_customer_erasure_failures). NOT applied to any database.
-- Additive only: one new table, one new enum, no existing table touched.

-- CreateEnum
CREATE TYPE "ExportJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'EXPIRED');

-- CreateTable: CustomerExportJob
-- Tracks a customer's full-data export once it exceeds
-- MAX_SYNC_EXPORT_IMAGES and can no longer be streamed directly in a single
-- request. The ZIP itself is stored as a Cloudinary RAW private asset,
-- referenced here only by publicId. Cascade on Customer delete (unlike
-- Subscription/BillingTransaction's Restrict) — this is nAia's own
-- transient bookkeeping, never a financial record subject to independent
-- retention law.
CREATE TABLE "CustomerExportJob" (
    "id"           TEXT NOT NULL,
    "customerId"   TEXT NOT NULL,
    "status"       "ExportJobStatus" NOT NULL DEFAULT 'PENDING',
    "publicId"     TEXT,
    "imageCount"   INTEGER NOT NULL,
    "errorCode"    TEXT,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt"  TIMESTAMP(3),
    "expiresAt"    TIMESTAMP(3),
    "downloadedAt" TIMESTAMP(3),

    CONSTRAINT "CustomerExportJob_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CustomerExportJob_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "CustomerExportJob_publicId_key" ON "CustomerExportJob"("publicId");
CREATE INDEX "CustomerExportJob_customerId_idx" ON "CustomerExportJob"("customerId");
CREATE INDEX "CustomerExportJob_expiresAt_idx" ON "CustomerExportJob"("expiresAt");
