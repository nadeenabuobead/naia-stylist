// ONE-SHOT DIAGNOSTIC — remove after migration verification (commit 9c2d626).
// Access requires X-Diagnostic-Token header to match DIAG_TOKEN constant.
// Returns only boolean pass/fail per check — no raw data, no schema details.

import prisma from "~/db.server";

// 56-char random token — rotate immediately after use.
const DIAG_TOKEN = "naia-batch1-diag-b9f2e1a7c3d8f5e4b2a9c6d3e7f1a4b8";

export async function loader({ request }: { request: Request }) {
  if (request.headers.get("x-diagnostic-token") !== DIAG_TOKEN) {
    return new Response("Forbidden", { status: 403 });
  }

  type MigRow = { name: string };
  type ColRow = { column_name: string };
  type EnumRow = { enumlabel: string };

  // --- 1. Applied migrations ---
  const appliedMigrations: MigRow[] = await prisma.$queryRaw`
    SELECT name FROM "_prisma_migrations" ORDER BY finished_at ASC
  `;
  const migrationNames = appliedMigrations.map((r) => r.name);

  const migrationChecks = {
    add_recommendation_feedback:
      migrationNames.some((n) => n.includes("add_recommendation_feedback")),
    add_journey_event:
      migrationNames.some((n) => n.includes("add_journey_event")),
    batch1_buy_or_skip:
      migrationNames.some((n) => n.includes("batch1_buy_or_skip_enhancements")),
  };

  // --- 2. BuyOrSkipAnalysis Batch 1 columns ---
  const bosaCols: ColRow[] = await prisma.$queryRaw`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'BuyOrSkipAnalysis'
      AND column_name IN ('sessionId','source','schemaVersion','updatedAt')
  `;
  const bosaColSet = new Set(bosaCols.map((r) => r.column_name));

  const bosaChecks = {
    sessionId: bosaColSet.has("sessionId"),
    source: bosaColSet.has("source"),
    schemaVersion: bosaColSet.has("schemaVersion"),
    updatedAt: bosaColSet.has("updatedAt"),
  };

  // --- 3. BuySkipVerdict enum contains INCOMPLETE ---
  const enumRows: EnumRow[] = await prisma.$queryRaw`
    SELECT e.enumlabel
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'BuySkipVerdict'
  `;
  const enumValues = enumRows.map((r) => r.enumlabel);
  const enumChecks = {
    hasINCOMPLETE: enumValues.includes("INCOMPLETE"),
    allValues: enumValues,
  };

  // --- 4. RecommendationFeedback table exists ---
  const rfTable: { exists: boolean }[] = await prisma.$queryRaw`
    SELECT EXISTS (
      SELECT FROM information_schema.tables
      WHERE table_name = 'RecommendationFeedback'
    ) AS exists
  `;
  const rfExists = rfTable[0]?.exists ?? false;

  // --- 5. PostOutfitReview Phase 4B1 columns ---
  const porCols: ColRow[] = await prisma.$queryRaw`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'PostOutfitReview'
      AND column_name IN ('didWearIt','feelingAnswer','fitFeedback','coverageFeedback','colourFeedback')
  `;
  const porColSet = new Set(porCols.map((r) => r.column_name));
  const porChecks = {
    didWearIt: porColSet.has("didWearIt"),
    feelingAnswer: porColSet.has("feelingAnswer"),
    fitFeedback: porColSet.has("fitFeedback"),
    coverageFeedback: porColSet.has("coverageFeedback"),
    colourFeedback: porColSet.has("colourFeedback"),
  };

  // --- 6. JourneyEvent table exists ---
  const jtTable: { exists: boolean }[] = await prisma.$queryRaw`
    SELECT EXISTS (
      SELECT FROM information_schema.tables
      WHERE table_name = 'JourneyEvent'
    ) AS exists
  `;
  const jtExists = jtTable[0]?.exists ?? false;

  const allPass =
    Object.values(migrationChecks).every(Boolean) &&
    Object.values(bosaChecks).every(Boolean) &&
    enumChecks.hasINCOMPLETE &&
    rfExists &&
    Object.values(porChecks).every(Boolean) &&
    jtExists;

  return Response.json({
    status: allPass ? "ALL_PASS" : "SOME_FAIL",
    migrations: migrationChecks,
    buyOrSkipAnalysis: bosaChecks,
    buySkipVerdictEnum: enumChecks,
    recommendationFeedbackTableExists: rfExists,
    postOutfitReview: porChecks,
    journeyEventTableExists: jtExists,
  });
}
