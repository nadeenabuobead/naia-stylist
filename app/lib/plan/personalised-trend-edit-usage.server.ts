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
 * caller (trends.my-edits.$slug.tsx) only ever reaches this function when
 * getStoredTrendEditSnapshot found nothing usable for this period, which
 * happens for two different reasons —
 *   (a) genuinely no row yet this period → create() writes the snapshot,
 *       exactly once, for real.
 *   (b) a row ALREADY EXISTS for this period with snapshot: null — a
 *       historical row written before snapshot persistence existed. If the
 *       update branch wrote a snapshot here, a customer revisiting within
 *       the same calendar period as an old pre-snapshot generation would
 *       silently overwrite that historical row with content regenerated
 *       from TODAY's Passport/Closet/evidence — fabricated history wearing
 *       the original row's createdAt. The schema's own doc comment on
 *       PersonalisedTrendEditUsage.snapshot already states this must never
 *       happen ("never backfilled/reconstructed"); update: {} is what
 *       actually enforces it. A pre-snapshot row stays null forever.
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
 * The stored snapshot for this customer+report+CURRENT period, if one
 * exists. Used by the customer-facing route to decide "render what we
 * already showed them" vs. "this is the first view this period, generate
 * and persist" — see trends.my-edits.$slug.tsx. Returns null (not an
 * empty/placeholder edit) when there is genuinely nothing stored yet, so
 * the caller can tell "first view" apart from "stored but empty".
 */
export async function getStoredTrendEditSnapshot(
  customerId: string,
  reportSlug: string,
): Promise<TrendEditSnapshot | null> {
  const { periodKey } = getUsageWindow();
  const row = await prisma.personalisedTrendEditUsage.findUnique({
    where: { customerId_reportSlug_periodKey: { customerId, reportSlug, periodKey } },
    select: { snapshot: true },
  });
  return (row?.snapshot as unknown as TrendEditSnapshot | null) ?? null;
}
