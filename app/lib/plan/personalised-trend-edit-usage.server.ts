// app/lib/plan/personalised-trend-edit-usage.server.ts
// Canonical write path for Personalised Trend Edit usage (1/month) — the
// customer entitlement/usage source of truth (PersonalisedTrendEditUsage in
// schema.prisma). Distinct from JourneyEvent's trend_edit_generated, which
// stays analytics-only and is never read for Plan & Usage or quota checks.

import prisma from "~/db.server";
import { getUsageWindow } from "./usage-window.server";

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
 */
export async function recordPersonalisedTrendEditUsage(
  customerId: string,
  reportSlug: string,
): Promise<void> {
  const { periodKey } = getUsageWindow();
  await prisma.personalisedTrendEditUsage.upsert({
    where: { customerId_reportSlug_periodKey: { customerId, reportSlug, periodKey } },
    create: { customerId, reportSlug, periodKey },
    update: {}, // already recorded for this customer+report+period — no second write
  });
}
