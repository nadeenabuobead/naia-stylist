// scripts/backfill-trend-content-ids.mts
//
// Assigns stable content ids and an edition key to every Trend Report.
//
//   npx tsx scripts/backfill-trend-content-ids.mts              dry run, static reports
//   npx tsx scripts/backfill-trend-content-ids.mts --db         dry run, live DB rows
//   npx tsx scripts/backfill-trend-content-ids.mts --db --apply WRITE to the DB
//
// DRY RUN IS THE DEFAULT and --apply is the only thing that writes. This backfill
// is effectively one-way: once customers save against the ids it assigns, those
// ids are permanent, so the intended workflow is to read a dry run first, on
// staging, before anything touches production.
//
// The run is idempotent. Ids are derived deterministically and existing ids are
// always preserved, so running it twice assigns nothing the second time —
// verified explicitly by the --verify pass below.

import { trendReports } from "../app/lib/trend-reports.ts";
import {
  applyContentIdentity,
  IDENTITY_BEARING_FIELD_NAMES,
  isContentId,
  type IdentityBearingReport,
} from "../app/lib/trend-content-identity.ts";
import { countFacetValues } from "../app/lib/trend-facets.ts";

const args = new Set(process.argv.slice(2));
const useDb = args.has("--db");
const apply = args.has("--apply");

const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

interface ReportRow extends IdentityBearingReport {
  id?: string;
  title: string;
  season: string;
  status?: string;
}

function rule(char = "─") {
  console.log(char.repeat(78));
}

function summarise(report: ReportRow) {
  const applied = applyContentIdentity(report, null);

  console.log("");
  console.log(`${BOLD}${report.slug}${RESET}  ${DIM}${report.title} · ${report.season}${RESET}`);
  console.log(`  editionKey   ${applied.editionKey}`);

  let total = 0;
  let facetValues = 0;

  for (const field of IDENTITY_BEARING_FIELD_NAMES) {
    const entries = applied[field];
    if (entries.length === 0) continue;
    console.log(`  ${field}`);
    entries.forEach((entry, i) => {
      const label = String(
        entry.name ?? entry.signal ?? entry.trend ?? entry.brand ?? entry.label ?? "(untitled)",
      );
      const wasNew = applied.assigned.some((a) => a.field === field && a.index === i);
      const facets = countFacetValues(entry.facets as never);
      facetValues += facets;
      total += 1;
      console.log(
        `    ${entry.id}  ${wasNew ? "NEW " : "kept"}  ${label.slice(0, 46).padEnd(46)}` +
          `${facets > 0 ? ` ${facets} facet${facets === 1 ? "" : "s"}` : ` ${DIM}no facets${RESET}`}`,
      );
    });
  }

  // Collision check — ids must be unique within a report.
  const ids = IDENTITY_BEARING_FIELD_NAMES.flatMap((f) => applied[f].map((e) => e.id as string));
  const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
  const malformed = ids.filter((id) => !isContentId(id));

  console.log(
    `  ${BOLD}${total}${RESET} content objects · ${applied.assigned.length} newly identified · ` +
      `${facetValues} facet values`,
  );
  if (duplicates.length > 0) console.log(`  ⚠ COLLISION: ${duplicates.join(", ")}`);
  if (malformed.length > 0) console.log(`  ⚠ MALFORMED: ${malformed.join(", ")}`);
  if (applied.rejectedFacets.length > 0) {
    for (const r of applied.rejectedFacets) {
      console.log(`  ⚠ rejected facet ${r.field}[${r.index}] ${r.kind}=${JSON.stringify(r.value)}`);
    }
  }

  // Idempotency — re-apply over the result and assert nothing new is assigned.
  const second = applyContentIdentity(
    { ...report, ...applied } as IdentityBearingReport,
    null,
  );
  const stable =
    second.assigned.length === 0 &&
    second.editionKey === applied.editionKey &&
    IDENTITY_BEARING_FIELD_NAMES.every((f) =>
      second[f].every((e, i) => e.id === applied[f][i].id),
    );
  console.log(`  re-run         ${stable ? "idempotent ✓" : "⚠ NOT IDEMPOTENT"}`);

  return { applied, total, duplicates, malformed, stable };
}

async function main() {
  rule("═");
  console.log(
    `${BOLD}Trend content identity backfill${RESET} — ` +
      `${useDb ? "live DB" : "static reports"} · ${apply ? "APPLY (writes)" : "DRY RUN (no writes)"}`,
  );
  rule("═");

  let rows: ReportRow[];

  if (useDb) {
    const { default: prisma } = await import("../app/db.server.ts");
    rows = (await prisma.editorialTrendReport.findMany({
      orderBy: [{ order: "asc" }, { createdAt: "desc" }],
    })) as unknown as ReportRow[];
    if (rows.length === 0) {
      console.log("\nNo rows in editorial_trend_reports — nothing to back-fill.");
      return;
    }
  } else {
    rows = trendReports as unknown as ReportRow[];
  }

  const results = rows.map(summarise);

  console.log("");
  rule();
  const objects = results.reduce((n, r) => n + r.total, 0);
  const assigned = results.reduce((n, r) => n + r.applied.assigned.length, 0);
  const collisions = results.reduce((n, r) => n + r.duplicates.length + r.malformed.length, 0);
  const allStable = results.every((r) => r.stable);
  console.log(
    `${BOLD}${rows.length} reports · ${objects} content objects · ${assigned} newly identified · ` +
      `${collisions} collisions · ${allStable ? "idempotent ✓" : "NOT IDEMPOTENT ⚠"}${RESET}`,
  );
  rule();

  if (!apply) {
    console.log(
      `\n${DIM}Dry run — nothing written.` +
        `${useDb ? " Re-run with --db --apply to write these ids." : " Add --db to preview live rows."}${RESET}`,
    );
    return;
  }

  if (collisions > 0 || !allStable) {
    console.error("\nRefusing to apply: collisions or non-idempotent output. Nothing written.");
    process.exitCode = 1;
    return;
  }

  const { default: prisma } = await import("../app/db.server.ts");
  let written = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row.id) continue;
    const { applied } = results[i];
    await prisma.editorialTrendReport.update({
      where: { id: row.id },
      data: {
        keyTrends: applied.keyTrends as object[],
        rising: applied.rising as object[],
        fading: applied.fading as object[],
        referencesBehindThisEdit: applied.referencesBehindThisEdit as object[],
        editionKey: applied.editionKey,
      },
    });
    written += 1;
  }
  console.log(`\nWrote ${written} report${written === 1 ? "" : "s"}.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
