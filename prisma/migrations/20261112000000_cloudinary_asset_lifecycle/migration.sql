-- Cloudinary asset lifecycle: abandoned-upload sweep + durable deletion retry.
--
-- Written by hand against the schema's own validated structure (prisma
-- migrate dev was not run — no database was contacted to generate or apply
-- this file, per the same read-only migration policy used for
-- 20261105090000_customer_erasure_failures). NOT applied to any database.
-- Additive only: two new tables, no existing table touched.

-- CreateTable: PendingCloudinaryDeletion
-- Durable, retryable record of a Cloudinary asset whose deletion either
-- failed, or is being coordinated as the reservation half of the
-- abandoned-upload sweep's concurrency protection — see
-- cloudinary-deletion-claim.server.ts and admin.maintenance.tsx's retry
-- surface. No FK to Customer: the owning Customer row may be anonymized or
-- deleted before this resolves; deleting a Cloudinary asset only ever needs
-- its publicId.
CREATE TABLE "PendingCloudinaryDeletion" (
    "id"            TEXT NOT NULL,
    "customerId"    TEXT NOT NULL,
    "publicId"      TEXT NOT NULL,
    "resourceType"  TEXT NOT NULL DEFAULT 'image',
    "deliveryType"  TEXT NOT NULL,
    "context"       TEXT NOT NULL,
    "attemptCount"  INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "lastError"     TEXT,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt"    TIMESTAMP(3),

    CONSTRAINT "PendingCloudinaryDeletion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PendingCloudinaryDeletion_publicId_key" ON "PendingCloudinaryDeletion"("publicId");
CREATE INDEX "PendingCloudinaryDeletion_customerId_idx" ON "PendingCloudinaryDeletion"("customerId");
CREATE INDEX "PendingCloudinaryDeletion_resolvedAt_idx" ON "PendingCloudinaryDeletion"("resolvedAt");

-- CreateTable: CloudinarySweepRun
-- Audit + overlap-guard record for one run of the bounded, resumable,
-- multi-customer abandoned-upload sweep (cron or admin-triggered) — see
-- cloudinary-orphan-sweep.server.ts's runBoundedSweep.
CREATE TABLE "CloudinarySweepRun" (
    "id"                      TEXT NOT NULL,
    "status"                  TEXT NOT NULL,
    "mode"                    TEXT NOT NULL,
    "dryRun"                  BOOLEAN NOT NULL DEFAULT true,
    "startedAt"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt"              TIMESTAMP(3),
    "cursorCustomerId"        TEXT,
    "customersChecked"        INTEGER NOT NULL DEFAULT 0,
    "assetsChecked"           INTEGER NOT NULL DEFAULT 0,
    "assetsDeleted"           INTEGER NOT NULL DEFAULT 0,
    "assetsSkippedRecent"     INTEGER NOT NULL DEFAULT 0,
    "assetsSkippedReferenced" INTEGER NOT NULL DEFAULT 0,
    "failures"                INTEGER NOT NULL DEFAULT 0,
    "stoppedReason"           TEXT,

    CONSTRAINT "CloudinarySweepRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CloudinarySweepRun_status_startedAt_idx" ON "CloudinarySweepRun"("status", "startedAt");
