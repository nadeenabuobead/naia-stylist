-- CreateTable: AdminLoginAttempt — durable (cross-invocation) brute-force
-- protection for the internal admin portal login. The previous protection
-- was a fixed 350ms in-process delay, which carries no weight across
-- serverless cold starts/instances. ipHash is a SHA-256 digest of the
-- client IP, never the raw address.

CREATE TABLE "AdminLoginAttempt" (
    "id" TEXT NOT NULL,
    "ipHash" TEXT NOT NULL,
    "succeeded" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminLoginAttempt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AdminLoginAttempt_ipHash_createdAt_idx" ON "AdminLoginAttempt"("ipHash", "createdAt");
