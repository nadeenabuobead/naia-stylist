// app/lib/data-retention.server.ts
//
// Priority 5 (2026-10-19) — data retention.
//
// Repo-wide sweep found two tables with no age-based cleanup:
//   - JourneyEvent: only ever purged via full customer erasure
//     (customer-privacy.server.ts) — a customer who never requests
//     deletion accumulates these rows forever.
//   - NaiaSession: expiresAt is checked and the row deleted lazily, but
//     only when that exact token is presented again
//     (naia-session.server.ts resolveNaiaSession). A session that's simply
//     abandoned (cookie cleared, device discarded) and never presented
//     again stays in the DB indefinitely.
//
// No cron is configured for this project (vercel.json has no `crons` key,
// and adding one is a shared Vercel configuration change this workstream
// is not authorised to make). These are exposed instead as admin-triggered
// maintenance actions — see app/routes/admin.maintenance.tsx — until a
// cron (or equivalent scheduled job) is approved and added.

import prisma from "../db.server";

/// How long a JourneyEvent row is kept before it's eligible for purge.
/// This is a product/retention-policy choice, not a technical one — 180
/// days is a starting default, not a confirmed policy decision.
export const JOURNEY_EVENT_RETENTION_DAYS = 180;

export async function purgeExpiredJourneyEvents(
  retentionDays: number = JOURNEY_EVENT_RETENTION_DAYS,
): Promise<{ count: number }> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  return prisma.journeyEvent.deleteMany({ where: { createdAt: { lt: cutoff } } });
}

/// Deletes every NaiaSession row that has already expired, regardless of
/// whether its token has been presented again. Purely a cleanup of dead
/// rows — resolveNaiaSession's own lazy-delete-on-use path is unaffected
/// and remains the primary mechanism; this just catches what that path
/// never sees (sessions that are never presented again).
export async function purgeExpiredNaiaSessions(): Promise<{ count: number }> {
  return prisma.naiaSession.deleteMany({ where: { expiresAt: { lt: new Date() } } });
}
