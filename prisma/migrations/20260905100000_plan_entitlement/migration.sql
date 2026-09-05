-- Plan entitlement — CustomerPlan enum + Customer.plan + StylingSession.parentSessionId
--
-- CustomerPlan: FREE (default) | PAID
-- All existing customers become FREE — no behavioural change until enforcement is enabled.
-- StylingSession.parentSessionId: nullable self-reference.
--   null  = root StyleMe (counts toward quota).
--   value = Adjust Vibe continuation (excluded from quota).
-- Historical sessions pre-dating this field have null; they cannot be reliably
-- distinguished from roots. Only new Adjust Vibe sessions populate this field.

-- 1. CustomerPlan enum
CREATE TYPE "CustomerPlan" AS ENUM ('FREE', 'PAID');

-- 2. Customer.plan — defaults to FREE, safe for all existing rows
ALTER TABLE "Customer"
  ADD COLUMN "plan" "CustomerPlan" NOT NULL DEFAULT 'FREE';

-- 3. StylingSession.parentSessionId — nullable FK to self
ALTER TABLE "StylingSession"
  ADD COLUMN "parentSessionId" TEXT;

ALTER TABLE "StylingSession"
  ADD CONSTRAINT "StylingSession_parentSessionId_fkey"
  FOREIGN KEY ("parentSessionId")
  REFERENCES "StylingSession"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

CREATE INDEX "StylingSession_parentSessionId_idx" ON "StylingSession"("parentSessionId");
