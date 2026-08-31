-- Style Memory V1 — StyleMeOutcome table
-- Additive only. No destructive statements.
-- One outcome row per OutfitSuggestion (UNIQUE on suggestionId).
-- sessionId is denormalized from OutfitSuggestion.sessionId at write time (server-derived).

-- CreateTable
CREATE TABLE IF NOT EXISTS "StyleMeOutcome" (
    "id"               TEXT NOT NULL,
    "customerId"       TEXT NOT NULL,
    "suggestionId"     TEXT NOT NULL,
    "sessionId"        TEXT NOT NULL,
    "outcomeStatus"    TEXT NOT NULL,
    "changeTypes"      TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "otherChangeNote"  TEXT,
    "goalOutcome"      TEXT,
    "selectedDirection" TEXT,
    "submittedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StyleMeOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: unique constraint enforces one outcome per suggestion (UPSERT target)
CREATE UNIQUE INDEX IF NOT EXISTS "StyleMeOutcome_suggestionId_key"
    ON "StyleMeOutcome"("suggestionId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "StyleMeOutcome_customerId_idx"
    ON "StyleMeOutcome"("customerId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "StyleMeOutcome_sessionId_idx"
    ON "StyleMeOutcome"("sessionId");

-- AddForeignKey: Customer cascade
DO $$ BEGIN
    ALTER TABLE "StyleMeOutcome"
        ADD CONSTRAINT "StyleMeOutcome_customerId_fkey"
        FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey: OutfitSuggestion cascade
DO $$ BEGIN
    ALTER TABLE "StyleMeOutcome"
        ADD CONSTRAINT "StyleMeOutcome_suggestionId_fkey"
        FOREIGN KEY ("suggestionId") REFERENCES "OutfitSuggestion"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
