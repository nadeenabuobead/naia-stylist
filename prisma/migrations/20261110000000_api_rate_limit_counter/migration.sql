-- Phase 1 API rate limiting. NOT APPLIED to any database — prepared for
-- review in an isolated worktree only (see app/lib/api-rate-limit.server.ts).

-- CreateTable
CREATE TABLE "ApiRateLimitCounter" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "routeKey" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiRateLimitCounter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApiRateLimitCounter_customerId_routeKey_windowStart_key" ON "ApiRateLimitCounter"("customerId", "routeKey", "windowStart");

-- CreateIndex
CREATE INDEX "ApiRateLimitCounter_windowStart_idx" ON "ApiRateLimitCounter"("windowStart");
