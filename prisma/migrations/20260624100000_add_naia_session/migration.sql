-- AddTable: NaiaSession
-- Apply manually: psql "$DATABASE_URL" -f this file
-- Do NOT run prisma migrate deploy or prisma db push

CREATE TABLE "NaiaSession" (
    "id"          TEXT          NOT NULL,
    "tokenHash"   TEXT          NOT NULL,
    "customerId"  TEXT          NOT NULL,
    "createdAt"   TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt"  TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt"   TIMESTAMP(3)  NOT NULL,
    "userAgent"   TEXT,

    CONSTRAINT "NaiaSession_pkey"             PRIMARY KEY ("id"),
    CONSTRAINT "NaiaSession_tokenHash_key"    UNIQUE ("tokenHash"),
    CONSTRAINT "NaiaSession_customerId_fkey"
        FOREIGN KEY ("customerId")
        REFERENCES "Customer"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "NaiaSession_customerId_idx" ON "NaiaSession"("customerId");
CREATE INDEX "NaiaSession_expiresAt_idx"  ON "NaiaSession"("expiresAt");
