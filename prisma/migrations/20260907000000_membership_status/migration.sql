-- Migration: 20260907000000_membership_status
-- Replaces CustomerPlan { FREE, PAID } with MembershipStatus { NONE, MEMBER }.
-- Data migration: FREE → NONE (via default), PAID → MEMBER (explicit UPDATE).
-- Existing items/sessions/analyses are unaffected.

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('NONE', 'MEMBER');

-- Add membershipStatus column, default NONE
ALTER TABLE "Customer" ADD COLUMN "membershipStatus" "MembershipStatus" NOT NULL DEFAULT 'NONE';

-- Migrate PAID customers to MEMBER (FREE customers already have default NONE)
UPDATE "Customer" SET "membershipStatus" = 'MEMBER' WHERE plan = 'PAID';

-- Drop old plan column
ALTER TABLE "Customer" DROP COLUMN "plan";

-- DropEnum
DROP TYPE "CustomerPlan";
