/**
 * READ-ONLY staging DB audit.
 * Checks _prisma_migrations, then verifies every material effect of every
 * migration that may be absent from migration history.
 * No writes. No schema changes. Exits 1 after reporting so the deployment
 * alias stays on the current working build.
 */
import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();
const sep = (label) => console.log(`\n${"=".repeat(60)}\n=== ${label}\n${"=".repeat(60)}`);
const row = (k, v) => console.log(`  ${k.padEnd(45)} ${JSON.stringify(v)}`);

async function q(sql) {
  return p.$queryRawUnsafe(sql);
}

try {
  // ── 0. Migration history ─────────────────────────────────────────────────
  sep("0. _prisma_migrations");
  const migs = await q(`
    SELECT migration_name, started_at, finished_at, rolled_back_at,
           applied_steps_count, logs
    FROM _prisma_migrations
    ORDER BY started_at
  `);
  for (const m of migs) {
    const state = m.rolled_back_at ? "ROLLED_BACK"
                : m.finished_at    ? "APPLIED"
                : "FAILED/PENDING";
    console.log(`  [${state}] ${m.migration_name}  steps=${m.applied_steps_count}`);
    if (m.logs) console.log(`    LOGS: ${String(m.logs).slice(0, 200)}`);
  }

  // ── 1. All tables present ────────────────────────────────────────────────
  sep("1. ALL PUBLIC TABLES");
  const tables = await q(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema='public' AND table_type='BASE TABLE'
    ORDER BY table_name
  `);
  tables.forEach(t => console.log(`  ${t.table_name}`));

  // ── 2. All pg_indexes ────────────────────────────────────────────────────
  sep("2. ALL INDEXES (pg_indexes)");
  const idxs = await q(`
    SELECT tablename, indexname, indexdef
    FROM pg_indexes WHERE schemaname='public'
    ORDER BY tablename, indexname
  `);
  idxs.forEach(i => console.log(`  ${i.tablename}.${i.indexname}\n    ${i.indexdef}`));

  // ── 3. All table_constraints ─────────────────────────────────────────────
  sep("3. ALL TABLE CONSTRAINTS");
  const cons = await q(`
    SELECT table_name, constraint_name, constraint_type
    FROM information_schema.table_constraints
    WHERE table_schema='public'
    ORDER BY table_name, constraint_type, constraint_name
  `);
  cons.forEach(c => console.log(`  ${c.table_name}  [${c.constraint_type}]  ${c.constraint_name}`));

  // ── 4. All enum values ───────────────────────────────────────────────────
  sep("4. ALL ENUM TYPES & VALUES");
  const enums = await q(`
    SELECT t.typname, e.enumlabel
    FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid
    ORDER BY t.typname, e.enumsortorder
  `);
  const enumMap = {};
  enums.forEach(e => { enumMap[e.typname] = enumMap[e.typname] || []; enumMap[e.typname].push(e.enumlabel); });
  Object.entries(enumMap).forEach(([name, vals]) => console.log(`  ${name}: [${vals.join(", ")}]`));

  // ── 5. Column details for key tables ────────────────────────────────────
  const checkCols = async (tableName) => {
    const cols = await q(`
      SELECT column_name, data_type, udt_name, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema='public' AND table_name='${tableName}'
      ORDER BY ordinal_position
    `);
    sep(`5. COLUMNS: ${tableName}`);
    cols.forEach(c => {
      console.log(`  ${c.column_name.padEnd(35)} type=${c.data_type}(${c.udt_name})  nullable=${c.is_nullable}  default=${c.column_default}`);
    });
    return cols.map(c => c.column_name);
  };

  const sessionCols       = await checkCols("Session");
  const customerCols      = await checkCols("Customer");
  const onboardingCols    = await checkCols("OnboardingProfile");
  const naiaModelCols     = await checkCols("NaiaModel");
  const vtoJobCols        = await checkCols("VirtualTryOnJob");
  const closetItemCols    = await checkCols("ClosetItem");
  const selfieAnalCols    = await checkCols("SelfieAnalysis");
  const recFeedCols       = await checkCols("RecommendationFeedback");
  const postOutfitCols    = await checkCols("PostOutfitReview");
  const journeyEventCols  = await checkCols("JourneyEvent");
  const bosaCols          = await checkCols("BuyOrSkipAnalysis");

  // ── 6. lifestyle column type (v2e migration) ─────────────────────────────
  sep("6. OnboardingProfile.lifestyle type detail");
  const lifestyleType = await q(`
    SELECT column_name, data_type, udt_name
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='OnboardingProfile'
      AND column_name='lifestyle'
  `);
  console.log("  lifestyle column:", JSON.stringify(lifestyleType));
  // Also check for old 'lifestyle' TEXT vs new TEXT[]
  const lifestyleArr = await q(`
    SELECT data_type, udt_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='OnboardingProfile'
      AND column_name IN ('lifestyle','lifestyle_new')
  `);
  console.log("  lifestyle* cols:", JSON.stringify(lifestyleArr));

  // ── 7. Customer.email nullable? (20260624000000) ─────────────────────────
  sep("7. Customer.email nullability");
  const emailNullable = await q(`
    SELECT is_nullable FROM information_schema.columns
    WHERE table_schema='public' AND table_name='Customer' AND column_name='email'
  `);
  console.log("  Customer.email is_nullable:", JSON.stringify(emailNullable));

  // ── 8. Foreign keys detail ───────────────────────────────────────────────
  sep("8. FOREIGN KEYS");
  const fks = await q(`
    SELECT
      tc.table_name, tc.constraint_name,
      kcu.column_name,
      ccu.table_name AS foreign_table_name,
      ccu.column_name AS foreign_column_name,
      rc.delete_rule, rc.update_rule
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
    JOIN information_schema.referential_constraints rc
      ON tc.constraint_name = rc.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
    ORDER BY tc.table_name, tc.constraint_name
  `);
  fks.forEach(f => console.log(
    `  ${f.table_name}.${f.column_name} → ${f.foreign_table_name}.${f.foreign_column_name}  ON DELETE ${f.delete_rule} ON UPDATE ${f.update_rule}  (${f.constraint_name})`
  ));

  // ── 9. Batch2 partial index check ────────────────────────────────────────
  sep("9. BATCH2 PARTIAL INDEX CHECK");
  const bosIdx = await q(`
    SELECT indexname, indexdef FROM pg_indexes
    WHERE schemaname='public' AND tablename='BuyOrSkipAnalysis'
      AND indexname='BuyOrSkipAnalysis_idempotencyKey_key'
  `);
  console.log("  BuyOrSkipAnalysis partial index:", JSON.stringify(bosIdx));

  const jeIdx = await q(`
    SELECT indexname, indexdef FROM pg_indexes
    WHERE schemaname='public' AND tablename='JourneyEvent'
      AND indexname='JourneyEvent_idempotencyKey_key'
  `);
  console.log("  JourneyEvent partial index:", JSON.stringify(jeIdx));

  // ── 10. Duplicate idempotencyKey check ───────────────────────────────────
  sep("10. DUPLICATE idempotencyKey CHECK");
  // BuyOrSkipAnalysis
  const bosDups = await q(`
    SELECT COUNT(*) AS total_non_null,
           COUNT(*) FILTER (WHERE "idempotencyKey" IS NOT NULL) AS with_key,
           (SELECT COUNT(*) FROM (
             SELECT "idempotencyKey", COUNT(*) c
             FROM "BuyOrSkipAnalysis"
             WHERE "idempotencyKey" IS NOT NULL
             GROUP BY "idempotencyKey" HAVING COUNT(*) > 1
           ) dupes) AS duplicate_key_groups
    FROM "BuyOrSkipAnalysis"
  `);
  console.log("  BuyOrSkipAnalysis:", JSON.stringify(bosDups));

  // JourneyEvent
  const jeDups = await q(`
    SELECT COUNT(*) AS total_rows,
           COUNT(*) FILTER (WHERE "idempotencyKey" IS NOT NULL) AS with_key,
           (SELECT COUNT(*) FROM (
             SELECT "idempotencyKey", COUNT(*) c
             FROM "JourneyEvent"
             WHERE "idempotencyKey" IS NOT NULL
             GROUP BY "idempotencyKey" HAVING COUNT(*) > 1
           ) dupes) AS duplicate_key_groups
    FROM "JourneyEvent"
  `);
  console.log("  JourneyEvent:", JSON.stringify(jeDups));

  // ── 11. BuySkipVerdict enum has INCOMPLETE? ───────────────────────────────
  sep("11. BuySkipVerdict enum (batch1 check)");
  const bsvEnum = await q(`
    SELECT e.enumlabel
    FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'BuySkipVerdict'
    ORDER BY e.enumsortorder
  `);
  console.log("  BuySkipVerdict values:", JSON.stringify(bsvEnum.map(e => e.enumlabel)));

  // ── 12. s0_bos_image columns (no IF NOT EXISTS guard) ────────────────────
  sep("12. s0_bos columns (no IF NOT EXISTS guard in migration)");
  const bosImgCols = await q(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='BuyOrSkipAnalysis'
      AND column_name IN ('imagePublicId','imageFormat')
  `);
  console.log("  BuyOrSkipAnalysis image cols present:", JSON.stringify(bosImgCols.map(c => c.column_name)));

  // ── 13. v2f shoeSizingSystem (no IF NOT EXISTS guard) ────────────────────
  sep("13. v2f shoeSizingSystem (no IF NOT EXISTS guard)");
  const shoeCols = await q(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='OnboardingProfile'
      AND column_name='shoeSizingSystem'
  `);
  console.log("  OnboardingProfile.shoeSizingSystem present:", JSON.stringify(shoeCols.map(c => c.column_name)));

  // ── 14. image_security changes (20260811) ────────────────────────────────
  sep("14. image_security (20260811)");
  const imgSecCols = await q(`
    SELECT column_name, is_nullable FROM information_schema.columns
    WHERE table_schema='public'
      AND ((table_name='ClosetItem' AND column_name IN ('imageUrl','imagePublicId','imageFormat'))
        OR (table_name='NaiaModel' AND column_name IN ('bodyModerationStatus','bodyModerationAt')))
    ORDER BY table_name, column_name
  `);
  imgSecCols.forEach(c => console.log(`  column: ${c.column_name}  nullable=${c.is_nullable}`));

  // ── 15. RecommendationFeedback post-wear columns ─────────────────────────
  sep("15. PostOutfitReview extra cols (20260717200000)");
  const postReviewCols = await q(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='PostOutfitReview'
      AND column_name IN ('didWearIt','feelingAnswer','fitFeedback','coverageFeedback','colourFeedback')
  `);
  console.log("  Extra cols present:", JSON.stringify(postReviewCols.map(c => c.column_name)));

  sep("AUDIT COMPLETE");
  console.log("All queries ran successfully. Exiting 1 to preserve current alias.");

} catch (err) {
  console.error("\nAUDIT QUERY ERROR:", err.message);
  console.error(err.stack);
} finally {
  await p.$disconnect();
  process.exit(1);  // intentional — keeps alias on current working deployment
}
