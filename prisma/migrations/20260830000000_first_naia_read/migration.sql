-- Migration: 20260830000000_first_naia_read
-- Additive only. No column removals, no type changes, no data loss.

-- Add garmentRelationships to ClosetItem (text array, default empty — safe for legacy rows)
ALTER TABLE "ClosetItem" ADD COLUMN "garmentRelationships" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Create NaiaObservationFeedback table
-- Provenance columns (observationType/evidenceFields/evidenceValues/claimText) are
-- SERVER-GENERATED from the customer's current OnboardingProfile — never from the browser.
CREATE TABLE "NaiaObservationFeedback" (
  "id"              TEXT NOT NULL,
  "customerId"      TEXT NOT NULL,
  "observationKey"  TEXT NOT NULL,
  "response"        TEXT NOT NULL,
  "observationType" TEXT NOT NULL DEFAULT '',
  "evidenceFields"  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "evidenceValues"  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "claimText"       TEXT NOT NULL DEFAULT '',
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,

  CONSTRAINT "NaiaObservationFeedback_pkey" PRIMARY KEY ("id")
);

-- Foreign key: NaiaObservationFeedback → Customer (cascade on customer delete)
ALTER TABLE "NaiaObservationFeedback"
  ADD CONSTRAINT "NaiaObservationFeedback_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Unique constraint: one response per (customerId, observationKey) — backs the Prisma upsert
CREATE UNIQUE INDEX "NaiaObservationFeedback_customerId_observationKey_key"
  ON "NaiaObservationFeedback"("customerId", "observationKey");

-- Index: fast lookup by customer
CREATE INDEX "NaiaObservationFeedback_customerId_idx"
  ON "NaiaObservationFeedback"("customerId");
