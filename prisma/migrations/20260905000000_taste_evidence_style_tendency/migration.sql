-- Phase 5D: Taste Evidence Layer + Style Tendency V1
-- Creates TasteEvidence (raw extracted signals) and StyleTendency (reconciled observations).

CREATE TABLE "TasteEvidence" (
    "id"             TEXT NOT NULL,
    "customerId"     TEXT NOT NULL,
    "source"         TEXT NOT NULL,
    "sourceRecordId" TEXT NOT NULL,
    "dimension"      TEXT NOT NULL,
    "value"          TEXT NOT NULL,
    "polarity"       TEXT NOT NULL,
    "strength"       DOUBLE PRECISION NOT NULL,
    "context"        JSONB,
    "provenance"     JSONB NOT NULL,
    "occurredAt"     TIMESTAMP(3) NOT NULL,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TasteEvidence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StyleTendency" (
    "id"                              TEXT NOT NULL,
    "customerId"                      TEXT NOT NULL,
    "observationKey"                  TEXT NOT NULL,
    "dimension"                       TEXT NOT NULL,
    "value"                           TEXT NOT NULL,
    "generation"                      INTEGER NOT NULL DEFAULT 1,
    "dominantPolarity"                TEXT NOT NULL,
    "observationFamily"               TEXT NOT NULL,
    "state"                           TEXT NOT NULL,
    "wSupport"                        DOUBLE PRECISION NOT NULL DEFAULT 0,
    "wContradict"                     DOUBLE PRECISION NOT NULL DEFAULT 0,
    "wNet"                            DOUBLE PRECISION NOT NULL DEFAULT 0,
    "distinctRecords"                 INTEGER NOT NULL DEFAULT 0,
    "distinctSources"                 INTEGER NOT NULL DEFAULT 0,
    "effectiveSupport"                DOUBLE PRECISION NOT NULL DEFAULT 0,
    "wSupportSinceCorrection"         DOUBLE PRECISION NOT NULL DEFAULT 0,
    "distinctRecordsSinceCorrection"  INTEGER NOT NULL DEFAULT 0,
    "lastEvidenceAt"                  TIMESTAMP(3),
    "claimText"                       TEXT,
    "rationaleText"                   TEXT,
    "claimVersion"                    INTEGER NOT NULL DEFAULT 1,
    "customerFeedback"                TEXT,
    "customerFeedbackAt"              TIMESTAMP(3),
    "createdAt"                       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"                       TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StyleTendency_pkey" PRIMARY KEY ("id")
);

-- TasteEvidence unique + indexes
ALTER TABLE "TasteEvidence"
    ADD CONSTRAINT "TasteEvidence_customerId_source_sourceRecordId_dimension_value_polarity_key"
    UNIQUE ("customerId", "source", "sourceRecordId", "dimension", "value", "polarity");

CREATE INDEX "TasteEvidence_customerId_dimension_value_idx"
    ON "TasteEvidence"("customerId", "dimension", "value");

CREATE INDEX "TasteEvidence_customerId_source_idx"
    ON "TasteEvidence"("customerId", "source");

CREATE INDEX "TasteEvidence_customerId_source_sourceRecordId_idx"
    ON "TasteEvidence"("customerId", "source", "sourceRecordId");

-- StyleTendency unique + indexes
ALTER TABLE "StyleTendency"
    ADD CONSTRAINT "StyleTendency_customerId_observationKey_generation_key"
    UNIQUE ("customerId", "observationKey", "generation");

CREATE INDEX "StyleTendency_customerId_state_idx"
    ON "StyleTendency"("customerId", "state");

CREATE INDEX "StyleTendency_customerId_observationFamily_idx"
    ON "StyleTendency"("customerId", "observationFamily");

CREATE INDEX "StyleTendency_customerId_observationKey_idx"
    ON "StyleTendency"("customerId", "observationKey");

-- Foreign keys
ALTER TABLE "TasteEvidence"
    ADD CONSTRAINT "TasteEvidence_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StyleTendency"
    ADD CONSTRAINT "StyleTendency_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
