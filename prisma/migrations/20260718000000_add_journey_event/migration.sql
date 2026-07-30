-- Phase 4B3: Privacy-safe journey event log.
-- customerIdHash is SHA-256(customerId).slice(0,12) — no FK to Customer (by design).
-- payload contains only approved operational fields; no PII, no images, no notes.

-- CreateTable
CREATE TABLE "JourneyEvent" (
    "id"             TEXT NOT NULL,
    "type"           TEXT NOT NULL,
    "occurredAt"     TIMESTAMP(3) NOT NULL,
    "customerIdHash" TEXT NOT NULL,
    "sessionId"      TEXT NOT NULL,
    "payload"        JSONB NOT NULL,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JourneyEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JourneyEvent_type_idx" ON "JourneyEvent"("type");

-- CreateIndex
CREATE INDEX "JourneyEvent_customerIdHash_idx" ON "JourneyEvent"("customerIdHash");

-- CreateIndex
CREATE INDEX "JourneyEvent_occurredAt_idx" ON "JourneyEvent"("occurredAt");
