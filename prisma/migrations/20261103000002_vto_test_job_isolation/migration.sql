-- VTO test-job isolation (Phase 2 billing requirement)
--
-- Adds VirtualTryOnJob.isTest, defaulting to false for every existing row —
-- no behaviour change for any currently-stored job. No code path sets this
-- to true yet; it exists so that staging/QA try-on testing (e.g. against a
-- future FASHN sandbox/test mode) can be built with an explicit, structural
-- guarantee that a test job never consumes or appears to consume a real
-- customer's paid monthly VTO allowance — entitlement.server.ts's VTO
-- quota-counting queries filter isTest: false.

ALTER TABLE "VirtualTryOnJob" ADD COLUMN "isTest" BOOLEAN NOT NULL DEFAULT false;
