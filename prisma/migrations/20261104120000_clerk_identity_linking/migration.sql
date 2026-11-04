-- Clerk customer-authentication migration — schema only.
--
-- Written by hand against the schema's own validated structure (prisma
-- migrate dev was not run — no database was contacted to generate or apply
-- this file, per the read-only migration policy for this phase). NOT applied
-- to any database. Additive and backward-compatible: no existing row's data
-- is touched, and every existing Customer row keeps its current
-- shopifyCustomerId/email exactly as-is.

-- 1. Customer.shopifyCustomerId becomes nullable — a Customer created
--    through Clerk never goes through Shopify OAuth and so never gets one.
--    Existing rows are unaffected; this only widens what's allowed going
--    forward.
ALTER TABLE "Customer" ALTER COLUMN "shopifyCustomerId" DROP NOT NULL;

-- 2. Customer.clerkUserId — nullable, unique. Null on every existing row
--    until that customer either signs up fresh through Clerk or completes
--    the verified identity-linking flow below.
ALTER TABLE "Customer" ADD COLUMN "clerkUserId" TEXT;
CREATE UNIQUE INDEX "Customer_clerkUserId_key" ON "Customer"("clerkUserId");

-- 2b. Cumulative brute-force guard for the identity-linking flow — lives on
--     the target Customer, not any one (deletable) request row, so it
--     survives across every distinct attacker-controlled clerkUserId that
--     has ever attempted this customer's code. Zero/null on every existing
--     row; both default to their "never locked" state.
ALTER TABLE "Customer" ADD COLUMN "identityLinkFailedAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Customer" ADD COLUMN "identityLinkLockedUntil" TIMESTAMP(3);

-- 3. CreateTable: IdentityLinkRequest
-- Pending, unconfirmed claim from a new Clerk identity against an existing
-- Customer row matched by email — see the model's own comment in
-- schema.prisma for the full flow. One open claim per Clerk user at a time.
CREATE TABLE "IdentityLinkRequest" (
    "id"           TEXT NOT NULL,
    "customerId"   TEXT NOT NULL,
    "clerkUserId"  TEXT NOT NULL,
    "email"        TEXT NOT NULL,
    "codeHash"     TEXT NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "expiresAt"    TIMESTAMP(3) NOT NULL,
    "confirmedAt"  TIMESTAMP(3),
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdentityLinkRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IdentityLinkRequest_clerkUserId_key" ON "IdentityLinkRequest"("clerkUserId");
CREATE INDEX "IdentityLinkRequest_customerId_idx" ON "IdentityLinkRequest"("customerId");

ALTER TABLE "IdentityLinkRequest" ADD CONSTRAINT "IdentityLinkRequest_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. CreateTable: PendingClerkCleanup
-- Durable, operator-visible record of a Clerk user deletion that failed
-- after this account's own nAia data was already erased — see settings.tsx's
-- delete-account action and admin.maintenance.tsx's retry surface. No FK to
-- Customer: that row is already gone by the time this one is created.
CREATE TABLE "PendingClerkCleanup" (
    "id"            TEXT NOT NULL,
    "clerkUserId"   TEXT NOT NULL,
    "customerId"    TEXT NOT NULL,
    "lastError"     TEXT NOT NULL,
    "attemptCount"  INTEGER NOT NULL DEFAULT 1,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt"    TIMESTAMP(3),

    CONSTRAINT "PendingClerkCleanup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PendingClerkCleanup_clerkUserId_key" ON "PendingClerkCleanup"("clerkUserId");
CREATE INDEX "PendingClerkCleanup_resolvedAt_idx" ON "PendingClerkCleanup"("resolvedAt");
