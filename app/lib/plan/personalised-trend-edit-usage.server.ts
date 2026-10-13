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
 * snapshot, when provided, is written only on the row's first creation this
 * period — a repeat view within the same period is already a no-op update
 * (no second usage count, so no second "what did they receive" moment
 * either). This mirrors the existing usage-counting philosophy exactly:
 * the first generation each period is the one that counts.
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
    // The caller (trends.my-edits.$slug.tsx) only ever reaches this function
    // when getStoredTrendEditSnapshot found no stored snapshot for this
    // period — either no row yet, or a legacy row from before snapshot
    // persistence existed. In the legacy case this is a one-time backfill of
    // that one row, not a second generation for an already-snapshotted
    // period: this function is never called again once a snapshot exists.
    update: { snapshot: snapshot ?? undefined },
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
