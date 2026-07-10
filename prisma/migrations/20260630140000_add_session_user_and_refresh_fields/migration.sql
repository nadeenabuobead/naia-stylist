-- AddColumns: Session user-info and refresh-token fields
-- Required by @shopify/shopify-app-session-storage-prisma@8.0.1's
-- sessionToRow()/storeSession() write path. Defensive (IF NOT EXISTS)
-- because the original Session migration's column list cannot be
-- confirmed to have applied cleanly against this Postgres database.
-- Apply manually: psql "$DATABASE_URL" -f this file
-- Do NOT run prisma migrate deploy or prisma db push

ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "firstName" TEXT;
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "lastName" TEXT;
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "email" TEXT;
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "accountOwner" BOOLEAN DEFAULT false;
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "locale" TEXT;
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "collaborator" BOOLEAN DEFAULT false;
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "emailVerified" BOOLEAN DEFAULT false;
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "refreshToken" TEXT;
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "refreshTokenExpires" TIMESTAMP(3);
