// ONE-TIME migration endpoint — applies schema migrations missing from staging DB.
// Protected by STAGING_SEED_SECRET. Remove this file after successful migration.
import { type ActionFunctionArgs } from "react-router";
import prisma from "../db.server.js";

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  const secret = request.headers.get("x-staging-secret");
  if (!process.env.STAGING_SEED_SECRET || secret !== process.env.STAGING_SEED_SECRET) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results: Record<string, string> = {};

  // 20260717000000: add tryOnEligibility fields to ClosetItem
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE "ClosetItem" ADD COLUMN IF NOT EXISTS "tryOnEligibility" TEXT`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "ClosetItem" ADD COLUMN IF NOT EXISTS "tryOnAssessedAt" TIMESTAMP(3)`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "ClosetItem" ADD COLUMN IF NOT EXISTS "tryOnCustomerHint" TEXT`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "ClosetItem" ADD COLUMN IF NOT EXISTS "tryOnInternalNote" TEXT`);
    results.m20260717000000 = "ok";
  } catch (e: unknown) {
    results.m20260717000000 = `error: ${(e as Error).message}`;
  }

  // 20260717200000: create RecommendationFeedback + extend PostOutfitReview
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "RecommendationFeedback" (
        "id"               TEXT         NOT NULL,
        "customerId"       TEXT         NOT NULL,
        "sessionId"        TEXT,
        "suggestionId"     TEXT,
        "closetItemId"     TEXT,
        "target"           TEXT         NOT NULL,
        "shopifyProductId" TEXT,
        "rating"           TEXT         NOT NULL,
        "reasonCodes"      TEXT[]       NOT NULL DEFAULT ARRAY[]::TEXT[],
        "vtoAspects"       TEXT[]       NOT NULL DEFAULT ARRAY[]::TEXT[],
        "note"             TEXT,
        "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "RecommendationFeedback_pkey" PRIMARY KEY ("id")
      )
    `);
    for (const sql of [
      `CREATE INDEX IF NOT EXISTS "RecommendationFeedback_customerId_idx" ON "RecommendationFeedback"("customerId")`,
      `CREATE INDEX IF NOT EXISTS "RecommendationFeedback_sessionId_idx"  ON "RecommendationFeedback"("sessionId")`,
      `CREATE INDEX IF NOT EXISTS "RecommendationFeedback_suggestionId_idx" ON "RecommendationFeedback"("suggestionId")`,
    ]) {
      await prisma.$executeRawUnsafe(sql);
    }
    for (const sql of [
      `ALTER TABLE "RecommendationFeedback" ADD CONSTRAINT "RecommendationFeedback_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
      `ALTER TABLE "RecommendationFeedback" ADD CONSTRAINT "RecommendationFeedback_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "StylingSession"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
      `ALTER TABLE "RecommendationFeedback" ADD CONSTRAINT "RecommendationFeedback_suggestionId_fkey" FOREIGN KEY ("suggestionId") REFERENCES "OutfitSuggestion"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
      `ALTER TABLE "RecommendationFeedback" ADD CONSTRAINT "RecommendationFeedback_closetItemId_fkey" FOREIGN KEY ("closetItemId") REFERENCES "ClosetItem"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
    ]) {
      try { await prisma.$executeRawUnsafe(sql); } catch { /* ignore duplicate constraint */ }
    }
    for (const col of ["didWearIt", "feelingAnswer", "fitFeedback", "coverageFeedback", "colourFeedback"]) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "PostOutfitReview" ADD COLUMN IF NOT EXISTS "${col}" TEXT`);
    }
    results.m20260717200000 = "ok";
  } catch (e: unknown) {
    results.m20260717200000 = `error: ${(e as Error).message}`;
  }

  // 20260718000000: create JourneyEvent
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "JourneyEvent" (
        "id"             TEXT         NOT NULL,
        "type"           TEXT         NOT NULL,
        "occurredAt"     TIMESTAMP(3) NOT NULL,
        "customerIdHash" TEXT         NOT NULL,
        "sessionId"      TEXT         NOT NULL,
        "payload"        JSONB        NOT NULL,
        "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "JourneyEvent_pkey" PRIMARY KEY ("id")
      )
    `);
    for (const sql of [
      `CREATE INDEX IF NOT EXISTS "JourneyEvent_type_idx" ON "JourneyEvent"("type")`,
      `CREATE INDEX IF NOT EXISTS "JourneyEvent_customerIdHash_idx" ON "JourneyEvent"("customerIdHash")`,
      `CREATE INDEX IF NOT EXISTS "JourneyEvent_occurredAt_idx" ON "JourneyEvent"("occurredAt")`,
    ]) {
      await prisma.$executeRawUnsafe(sql);
    }
    results.m20260718000000 = "ok";
  } catch (e: unknown) {
    results.m20260718000000 = `error: ${(e as Error).message}`;
  }

  return Response.json({ results });
}
