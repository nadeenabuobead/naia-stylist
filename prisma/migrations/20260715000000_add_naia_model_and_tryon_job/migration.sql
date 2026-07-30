-- AddModels: NaiaModel and VirtualTryOnJob with provider/status enums.
-- Apply manually: psql "$DATABASE_URL" -f this file
-- Do NOT run prisma migrate deploy or prisma db push

-- ── Enums ────────────────────────────────────────────────────────────────────

CREATE TYPE "TryOnProvider" AS ENUM ('FASHN');

CREATE TYPE "TryOnJobStatus" AS ENUM (
    'CREATED',
    'SUBMITTED',
    'PROCESSING',
    'COMPLETED',
    'FAILED',
    'CANCELED',
    'TIMED_OUT'
);

-- ── NaiaModel ─────────────────────────────────────────────────────────────────
-- One active record per customer. Stores Cloudinary public IDs only.
-- Face and full-body assets are independent (each can be absent).
-- Customer cascade-deletion removes the model record automatically;
-- Cloudinary asset cleanup must be performed before deleting the Customer row.

CREATE TABLE "NaiaModel" (
    "id"                     TEXT          NOT NULL,
    "customerId"             TEXT          NOT NULL,
    "facePublicId"           TEXT,
    "faceVersion"            TEXT,
    -- Cloudinary file format (e.g. 'jpg', 'png') — required for private_download URL generation.
    "faceFormat"             TEXT,
    "bodyPublicId"           TEXT,
    "bodyVersion"            TEXT,
    -- Cloudinary file format for body photo.
    "bodyFormat"             TEXT,
    -- Delivery type used at upload time — needed for deletion signature and URL generation.
    -- Always 'private' for new uploads.
    "deliveryType"           TEXT          NOT NULL DEFAULT 'private',
    "photoAnalysisConsentAt" TIMESTAMP(3),
    "saveModelConsentAt"     TIMESTAMP(3),
    "consentPolicyVersion"   TEXT,
    "createdAt"              TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"              TIMESTAMP(3)  NOT NULL,

    CONSTRAINT "NaiaModel_pkey"           PRIMARY KEY ("id"),
    CONSTRAINT "NaiaModel_customerId_key" UNIQUE ("customerId"),
    CONSTRAINT "NaiaModel_customerId_fkey"
        FOREIGN KEY ("customerId")
        REFERENCES "Customer"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "NaiaModel_customerId_idx" ON "NaiaModel"("customerId");

-- ── VirtualTryOnJob ───────────────────────────────────────────────────────────
-- Per-generation virtual try-on job.
-- idempotencyKey UNIQUE prevents duplicate chargeable submissions.
-- naiaModelId → SET NULL on NaiaModel deletion so job history is preserved.
-- customerId → CASCADE so jobs are deleted when a customer is deleted.

CREATE TABLE "VirtualTryOnJob" (
    "id"                       TEXT              NOT NULL,
    "customerId"               TEXT              NOT NULL,
    "naiaModelId"              TEXT,
    "productHandle"            TEXT              NOT NULL,
    "provider"                 "TryOnProvider"   NOT NULL DEFAULT 'FASHN',
    "predictionId"             TEXT,
    "status"                   "TryOnJobStatus"  NOT NULL DEFAULT 'CREATED',
    "virtualTryOnConsentAt"    TIMESTAMP(3)      NOT NULL,
    "consentPolicyVersion"     TEXT              NOT NULL,
    "saveTryOnResultConsentAt" TIMESTAMP(3),
    "idempotencyKey"           TEXT              NOT NULL,
    "requestFingerprint"       TEXT,
    "errorCode"                TEXT,
    "createdAt"                TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"                TIMESTAMP(3)      NOT NULL,
    "completedAt"              TIMESTAMP(3),
    "lastActivityAt"           TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VirtualTryOnJob_pkey"               PRIMARY KEY ("id"),
    CONSTRAINT "VirtualTryOnJob_idempotencyKey_key" UNIQUE ("idempotencyKey"),
    CONSTRAINT "VirtualTryOnJob_customerId_fkey"
        FOREIGN KEY ("customerId")
        REFERENCES "Customer"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "VirtualTryOnJob_naiaModelId_fkey"
        FOREIGN KEY ("naiaModelId")
        REFERENCES "NaiaModel"("id")
        ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "VirtualTryOnJob_customerId_idx"        ON "VirtualTryOnJob"("customerId");
CREATE INDEX "VirtualTryOnJob_customerId_status_idx" ON "VirtualTryOnJob"("customerId", "status");
