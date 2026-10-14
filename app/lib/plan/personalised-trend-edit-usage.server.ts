// app/lib/plan/personalised-trend-edit-usage.server.ts
// Canonical write path for Personalised Trend Edit usage (1/month) — the
// customer entitlement/usage source of truth (PersonalisedTrendEditUsage in
// schema.prisma). Distinct from JourneyEvent's trend_edit_generated, which
// stays analytics-only and is never read for Plan & Usage or quota checks.

import prisma from "~/db.server";
import { getUsageWindow } from "./usage-window.server";
import type { ShopperEdit } from "~/lib/trend-evidence.server";
import type { NadineProductRecommendation } from "~/lib/trend-product-recommendation.server";

/**
 * Exact customer-facing generated content for one Personalised Trend Edit —
 * captured at generation time so it survives later Passport/Closet changes
 * (the live page always regenerates from CURRENT state; this is the only
 * durable record of what the customer actually saw on a given date).
 * Every field here is already plain, serializable data — no re-derivation
 * needed to store or to display it later.
 */
export interface TrendEditSnapshot {
  schemaVersion: "trend-edit-snapshot-v1";
  reportSlug: string;
  reportTitle: string;
  reportSeason?: string; // optional — absent on rows written before this field existed
  generatedAt: string; // ISO timestamp
  edit: ShopperEdit;
  nadineRecommendation: NadineProductRecommendation | null;
}

/**
 * Idempotent create-if-absent write for one genuinely completed Personalised
 * Trend Edit. customerId must come from the authenticated session only —
 * never a route param, query string, or request body.
 *
 * Race-safety: the composite unique constraint on
 * (customerId, reportSlug, periodKey) is the final authority. This upsert is
 * safe under concurrent/duplicate calls for the same customer+report+period —
 * it is not a check-then-create, and callers must not rely on a thrown P2002
 * as the normal refresh path (there is none; a repeat call is a plain no-op
 * update of the same row).
 *
 * snapshot is written ONLY on the row's first creation this period — the
 * update branch never touches it. This is deliberate, not an oversight: the
 * caller (trends.my-edits.$slug.tsx) only calls this function for a genuine
 * NEW generation, i.e. when getTrendEditUsageState returned "none". It must
 * never be called for a "legacy_no_snapshot" row — but update: {} is kept as
 * a second, structural line of defence: even if some future caller did call
 * this on an existing row, the update branch still could not write a
 * snapshot onto it. A row, once it exists, can only ever get its snapshot
 * from the create branch — i.e. exactly once, at genuine first-generation
 * time. The schema's own doc comment on PersonalisedTrendEditUsage.snapshot
 * already states this must never happen ("never backfilled/reconstructed").
 */
export async function recordPersonalisedTrendEditUsage(
  customerId: string,
  reportSlug: string,
  snapshot?: TrendEditSnapshot,
): Promise<void> {
  const { periodKey } = getUsageWindow();
  await prisma.personalisedTrendEditUsage.upsert({
    where: { customerId_reportSlug_periodKey: { customerId, reportSlug, periodKey } },
    create: { customerId, reportSlug, periodKey, snapshot: snapshot ?? undefined },
    update: {},
  });
}

/**
 * The three — and only three — states a (customerId, reportSlug, CURRENT
 * period) usage row can be in. Deliberately NOT collapsed into a nullable
 * snapshot: "no row at all" and "row exists but predates snapshot
 * persistence" must never be treated the same, because they call for
 * opposite loader behavior —
 *   - "none"               → genuinely nothing generated yet this period:
 *                            generate, persist a real snapshot, render it.
 *   - "legacy_no_snapshot" → a generation DID happen this period, but
 *                            before snapshot persistence existed, so its
 *                            exact content was never captured. Must NEVER
 *                            regenerate (that would silently replace an old
 *                            generation with a fresh one wearing the old
 *                            row's createdAt — fabricated history) and must
 *                            NEVER call the writer again (recordPersonalisedTrendEditUsage's
 *                            update: {} already refuses to backfill it, but
 *                            the loader should not even try). The honest
 *                            outcome is a historical-unavailable state.
 *   - "snapshotted"        → render the exact stored snapshot, never
 *                            regenerate.
 */
export type TrendEditUsageState =
  | { status: "none" }
  | { status: "legacy_no_snapshot" }
  | { status: "snapshotted"; snapshot: TrendEditSnapshot };

export async function getTrendEditUsageState(
  customerId: string,
  reportSlug: string,
): Promise<TrendEditUsageState> {
  const { periodKey } = getUsageWindow();
  const row = await prisma.personalisedTrendEditUsage.findUnique({
    where: { customerId_reportSlug_periodKey: { customerId, reportSlug, periodKey } },
    select: { snapshot: true },
  });
  if (!row) return { status: "none" };
  const snapshot = row.snapshot as unknown as TrendEditSnapshot | null;
  if (!snapshot) return { status: "legacy_no_snapshot" };
  return { status: "snapshotted", snapshot };
}

// "2026-08" -> "August 2026". Same parsing as admin/customer-360.server.ts's
// formatPeriodKeyLabel — duplicated rather than imported so this
// customer-facing module never depends on the admin layer. Purely a display
// formatter, never used for any count/boundary logic.
function formatPeriodKeyLabel(periodKey: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(periodKey);
  if (!match) return periodKey;
  const [, yearStr, monthStr] = match;
  const asDate = new Date(Date.UTC(Number(yearStr), Number(monthStr) - 1, 1));
  return asDate.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

export interface ArchivedTrendEditSnapshot {
  periodKey: string;
  periodLabel: string;
  snapshot: TrendEditSnapshot;
}

/**
 * The customer's own archive: the most recent PAST generation that actually
 * captured a snapshot for this report, regardless of period — the
 * customer-facing equivalent of Admin's per-usageId history access
 * (getAdminCustomerTrendEditUsage lists every row; this is its one-result,
 * customer-safe counterpart).
 *
 * Only ever called when the CURRENT period's own state is "none" (no row
 * yet this period) — "My Trend Edits must work as a real archive": a
 * customer who generated August's edit must still be able to reopen it in
 * October, without that reopen regenerating anything, writing a new row, or
 * counting against this period's one-generation allowance. If the current
 * period already has its own row (snapshotted or legacy_no_snapshot),
 * getTrendEditUsageState's result is authoritative and this is never
 * consulted — this never overrides or competes with that state.
 */
export async function getMostRecentArchivedSnapshot(
  customerId: string,
  reportSlug: string,
): Promise<ArchivedTrendEditSnapshot | null> {
  const rows = await prisma.personalisedTrendEditUsage.findMany({
    where: { customerId, reportSlug },
    orderBy: { createdAt: "desc" },
    select: { periodKey: true, snapshot: true },
  });
  for (const row of rows) {
    const snapshot = row.snapshot as unknown as TrendEditSnapshot | null;
    if (snapshot) {
      return { periodKey: row.periodKey, periodLabel: formatPeriodKeyLabel(row.periodKey), snapshot };
    }
  }
  return null;
}
