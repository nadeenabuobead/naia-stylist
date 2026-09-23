// scripts/backfill-trend-facets.mts
//
// Puts the authored per-trend facets onto the CANONICAL EditorialTrendReport
// rows.
//
//   npx tsx scripts/backfill-trend-facets.mts              dry run
//   npx tsx scripts/backfill-trend-facets.mts --apply      WRITE
//
// ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
// The facets were authored into app/lib/trend-reports.ts, which is only the
// PRE-SEED FALLBACK. Once an EditorialTrendReport row exists for a slug, that
// row is authoritative and the static array is never read. So authoring alone
// does not reach a seeded environment, and a customer-facing closet claim must
// never be driven by fallback data while a canonical row exists.
//
// ── IDENTITY ─────────────────────────────────────────────────────────────────
// Facets are applied BY STABLE CONTENT ID, never by display label. The manifest
// below names the exact ids. Those ids are the deterministic legacy ids the
// Step 1 backfill assigns, so this script runs AFTER
// scripts/backfill-trend-content-ids.mts and simply looks them up.
//
// It refuses to write unless every expected id is found exactly once. A missing
// or duplicated id means the rows are not in the state this manifest was
// written against, and guessing would attach a trend's facets to the wrong
// content.

import prisma from "../app/db.server.js";
import {
  applyContentIdentity,
  mintLegacyContentId,
  deriveLegacyContentId,
  IDENTITY_BEARING_FIELD_NAMES,
} from "../app/lib/trend-content-identity.ts";
import { validateFacets, isEmptyFacets } from "../app/lib/trend-facets.ts";
import { trendReports } from "../app/lib/trend-reports.ts";

const apply = process.argv.includes("--apply");
const DIM = "\x1b[2m", BOLD = "\x1b[1m", RESET = "\x1b[0m";

/**
 * The authored manifest, built from the static source so the two can never
 * drift: whatever is authored in trend-reports.ts is what this applies, and the
 * content id is derived by the same rule the Step 1 backfill uses.
 */
function buildManifest() {
  const entries: Array<{
    slug: string; field: string; index: number;
    contentId: string; label: string; facets: Record<string, string[]>;
  }> = [];

  for (const report of trendReports) {
    for (const field of IDENTITY_BEARING_FIELD_NAMES) {
      const list = (report as unknown as Record<string, unknown>)[field];
      if (!Array.isArray(list)) continue;
      list.forEach((raw, index) => {
        const entry = raw as Record<string, unknown>;
        const { facets, rejected } = validateFacets(entry.facets);
        if (rejected.length > 0) {
          throw new Error(`Invalid authored facet in ${report.slug}/${field}[${index}]: ${JSON.stringify(rejected)}`);
        }
        if (isEmptyFacets(facets)) return;
        entries.push({
          slug: report.slug, field, index,
          // Same seed rule as mintLegacyContentId — see trend-content-identity.
          contentId: deriveLegacyContentId(
            `${report.slug}|${field}|${index}|${String(entry.name ?? entry.signal ?? "").toLowerCase().replace(/\s+/g, " ").trim()}`,
          ),
          label: String(entry.name ?? entry.signal ?? ""),
          facets: facets as Record<string, string[]>,
        });
      });
    }
  }
  return entries;
}

async function main() {
  const manifest = buildManifest();

  console.log("═".repeat(78));
  console.log(`${BOLD}Trend facet backfill${RESET} — ${apply ? "APPLY (writes)" : "DRY RUN (no writes)"}`);
  console.log("═".repeat(78));
  console.log(`\n${manifest.length} authored facet sets to apply:\n`);
  for (const m of manifest) {
    console.log(`  ${m.contentId}  ${m.slug}`);
    console.log(`    ${DIM}${m.field}[${m.index}]${RESET} ${m.label}`);
    console.log(`    ${JSON.stringify(m.facets)}`);
  }

  let rows: Array<Record<string, unknown>>;
  try {
    rows = await prisma.editorialTrendReport.findMany({
      orderBy: [{ order: "asc" }, { createdAt: "desc" }],
    });
  } catch (error) {
    // No database reachable. The manifest above is still fully verified — what
    // cannot be checked is whether the canonical rows carry these content ids.
    console.error(`\n${BOLD}Could not reach the database.${RESET}`);
    console.error(`  ${(error as Error).message.split("\n")[0]}`);
    console.error("\nThe manifest above is verified. Row resolution needs a reachable database;");
    console.error("nothing was written, and nothing can be until this script can read the rows.");
    process.exitCode = 1;
    return;
  }

  if (rows.length === 0) {
    console.log(`\n${BOLD}No EditorialTrendReport rows exist.${RESET}`);
    console.log("The static array is still authoritative, so the authored facets are already live.");
    console.log("Re-run this after the reports are seeded.");
    return;
  }

  console.log(`\n${"─".repeat(78)}\n${rows.length} canonical rows found.\n`);

  const problems: string[] = [];
  const updates: Array<{ id: string; slug: string; data: Record<string, unknown>; applied: number }> = [];

  for (const row of rows) {
    // Ensure identity exactly as the Step 1 backfill would, so ids line up.
    const identified = applyContentIdentity(row as never, null, mintLegacyContentId);
    const wanted = manifest.filter((m) => m.slug === row.slug);
    if (wanted.length === 0) continue;

    const nextFields: Record<string, unknown> = {};
    let appliedHere = 0;

    for (const field of IDENTITY_BEARING_FIELD_NAMES) {
      const entries = (identified as unknown as Record<string, Array<Record<string, unknown>>>)[field];
      if (!Array.isArray(entries)) continue;

      nextFields[field] = entries.map((entry) => {
        const target = wanted.find((m) => m.contentId === entry.id);
        if (!target) return entry;
        appliedHere += 1;
        return { ...entry, facets: target.facets };
      });
    }

    for (const m of wanted) {
      const hits = IDENTITY_BEARING_FIELD_NAMES.flatMap((f) =>
        ((identified as unknown as Record<string, Array<Record<string, unknown>>>)[f] ?? []),
      ).filter((e) => e.id === m.contentId);

      if (hits.length === 0) problems.push(`${m.slug}: content id ${m.contentId} (${m.label}) NOT FOUND`);
      if (hits.length > 1)  problems.push(`${m.slug}: content id ${m.contentId} (${m.label}) is AMBIGUOUS (${hits.length} matches)`);
    }

    updates.push({ id: row.id, slug: row.slug, data: nextFields, applied: appliedHere });
  }

  for (const u of updates) {
    console.log(`  ${u.slug.padEnd(34)} ${u.applied} of ${manifest.filter((m) => m.slug === u.slug).length} facet sets resolved`);
  }

  if (problems.length > 0) {
    console.error(`\n${BOLD}REFUSING TO WRITE${RESET} — expected content ids are missing or ambiguous:`);
    for (const p of problems) console.error(`  ⚠ ${p}`);
    console.error("\nRun scripts/backfill-trend-content-ids.mts --db --apply first, or reconcile the rows.");
    process.exitCode = 1;
    return;
  }

  const total = updates.reduce((n, u) => n + u.applied, 0);
  console.log(`\n${BOLD}${total} of ${manifest.length} facet sets resolve cleanly · 0 problems${RESET}`);

  if (!apply) {
    console.log(`\n${DIM}Dry run — nothing written. Re-run with --apply to write.${RESET}`);
    return;
  }

  for (const u of updates) {
    await prisma.editorialTrendReport.update({ where: { id: u.id }, data: u.data });
  }
  console.log(`\nWrote ${updates.length} reports.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
