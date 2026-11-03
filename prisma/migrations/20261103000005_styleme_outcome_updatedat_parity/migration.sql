-- StyleMeOutcome.updatedAt is @updatedAt in schema.prisma (handled by
-- Prisma's query engine, not a DB default). The DB-level default added in
-- 20260901000000_styleme_outcome is a harmless but unrequested extra —
-- same class of drift already fixed for other tables in
-- 20261103000004_sandbox_replay_schema_parity, found one migration too late
-- to include there since that migration was already applied by the time
-- this one surfaced in the structural diff.
ALTER TABLE "StyleMeOutcome" ALTER COLUMN "updatedAt" DROP DEFAULT;
