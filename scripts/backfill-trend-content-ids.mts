// scripts/backfill-trend-content-ids.mts
//
// Assigns stable content ids to every saveable object in every Trend Report.
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
//
// ── WHY A REJECTED FACET IS FATAL ────────────────────────────────────────────
// This script is named for identity, but applyContentIdentity() also validates
// and REWRITES facets, and --apply writes the whole rewritten entry back. A
// value that fails validation is stripped from the stored row; if every value
// on an entry fails, the entire `facets` key is deleted from it. That is silent
// data loss in a row we were only supposed to be adding ids to.
//
// The facet backfill cannot undo it either: its manifest is built from the
// static source, so anything authored directly into the database is not in it
// and would never be restored.
//
// So a rejection is a hard refusal, not a warning. The dry run still lists
// every rejected value so it can be reconciled before anything is written.

import { trendReports } from "../app/lib/trend-reports.ts";
import {
  applyContentIdentity,
  mintLegacyContentId,
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
  // Deterministic minter: this one-time pass over a fixed set must be re-runnable.
  const applied = applyContentIdentity(report, null, mintLegacyContentId);

  console.log("");
  console.log(`${BOLD}${report.slug}${RESET}  ${DIM}${report.title} · ${report.season}${RESET}`);

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
    mintLegacyContentId,
  );
  const stable =
    second.assigned.length === 0 &&
    IDENTITY_BEARING_FIELD_NAMES.every((f) =>
      second[f].every((e, i) => e.id === applied[f][i].id),
    );
  console.log(`  re-run         ${stable ? "idempotent ✓" : "⚠ NOT IDEMPOTENT"}`);

  return { applied, total, duplicates, malformed, stable, rejected: applied.rejectedFacets };
}

/**
 * The decision, separated from the I/O so it can be asserted directly.
 *
 * Returns a refusal reason when the reports are in any state that makes writing
 * unsafe: colliding or malformed ids, non-idempotent output, or — see the note
 * at the top of this file — any rejected facet value.
 */
export function planBackfill(rows: ReportRow[]) {
  const results = rows.map(summarise);
  const objects    = results.reduce((n, r) => n + r.total, 0);
  const assigned   = results.reduce((n, r) => n + r.applied.assigned.length, 0);
  const collisions = results.reduce((n, r) => n + r.duplicates.length + r.malformed.length, 0);
  const rejected   = results.flatMap((r) => r.rejected);
  const allStable  = results.every((r) => r.stable);

  let refusal: string | null = null;
  if (collisions > 0)      refusal = "colliding or malformed content ids";
  else if (!allStable)     refusal = "non-idempotent output";
  else if (rejected.length > 0) {
    refusal =
      `${rejected.length} rejected facet value${rejected.length === 1 ? "" : "s"} — ` +
      `applying would strip ${rejected.length === 1 ? "it" : "them"} from the stored report`;
  }

  return { results, objects, assigned, collisions, rejected, allStable, refusal };
}

/**
 * Writes only when planBackfill raises no refusal. `write` is injected so a
 * test can prove that a refusal reaches the writer zero times.
 */
export async function runBackfill(
  rows: ReportRow[],
  opts: { apply: boolean; write: (id: string, data: Record<string, unknown>) => Promise<unknown> },
) {
  const plan = planBackfill(rows);

  console.log("");
  rule();
  console.log(
    `${BOLD}${rows.length} reports · ${plan.objects} content objects · ${plan.assigned} newly identified · ` +
      `${plan.collisions} collisions · ${plan.rejected.length} rejected facet values · ` +
      `${plan.allStable ? "idempotent ✓" : "NOT IDEMPOTENT ⚠"}${RESET}`,
  );
  rule();

  if (plan.rejected.length > 0) {
    console.error(`\n${BOLD}Rejected facet values${RESET} — these would be stripped by an apply:`);
    for (const r of plan.rejected) {
      console.error(`  ⚠ ${r.field}[${r.index}] ${r.kind} = ${JSON.stringify(r.value)}`);
    }
  }

  if (!opts.apply) {
    console.log(
      `\n${DIM}Dry run — nothing written.` +
        `${useDb ? " Re-run with --db --apply to write these ids." : " Add --db to preview live rows."}${RESET}`,
    );
    return { written: 0, refusal: plan.refusal, plan };
  }

  // Refuse BEFORE any write. Nothing below this point runs on a refusal.
  if (plan.refusal) {
    console.error(`\nRefusing to apply: ${plan.refusal}. Nothing written.`);
    process.exitCode = 1;
    return { written: 0, refusal: plan.refusal, plan };
  }

  let written = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row.id) continue;
    const { applied } = plan.results[i];
    await opts.write(row.id, {
      keyTrends: applied.keyTrends as object[],
      rising: applied.rising as object[],
      fading: applied.fading as object[],
      referencesBehindThisEdit: applied.referencesBehindThisEdit as object[],
    });
    written += 1;
  }
  console.log(`\nWrote ${written} report${written === 1 ? "" : "s"}.`);
  return { written, refusal: null, plan };
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
    const { default: prisma } = await import("../app/db.server.js");
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

  // The writer is only constructed when we are actually going to write.
  await runBackfill(rows, {
    apply,
    write: async (id, data) => {
      const { default: prisma } = await import("../app/db.server.js");
      return prisma.editorialTrendReport.update({ where: { id }, data: data as never });
    },
  });
}

const invokedDirectly = process.argv[1]?.includes("backfill-trend-content-ids");
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
