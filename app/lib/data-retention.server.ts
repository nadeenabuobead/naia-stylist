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
import { deleteSelfiePhoto } from "./ai/selfie-persistence.server";

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

/// Approved policy (2026-10-19): a selfie photo with no explicit keep/delete
/// decision is auto-deleted after this many days. Every one of the
/// existing explicit decisions (keep-both, keep-analysis, delete-both)
/// already clears SelfieAnalysis.photoPublicId as part of executing that
/// decision — so "photoPublicId still set" IS the "never decided" signal;
/// no separate decision-tracking field is needed. A customer who chose
/// keep-both has their photo transferred to NaiaModel instead (its own,
/// already-consented, separately-deletable record) — this purge only
/// ever touches undecided SelfieAnalysis rows, never NaiaModel.
export const SELFIE_PHOTO_RETENTION_DAYS = 30;

export interface PurgeUnconfirmedSelfiesResult {
  /// Photos successfully deleted.
  count: number;
  /// Rows that matched the age cutoff, including any Cloudinary deletion
  /// failures below — surfaced so a stuck asset isn't silently invisible.
  attempted: number;
}

/// Deletes the stored photo (never the analysis text) for every
/// SelfieAnalysis row whose photo has sat undecided past the retention
/// window. Mirrors exactly what "Keep Analysis Only" already does for a
/// customer who chooses it themselves — this is that same, existing
/// outcome applied automatically once the window lapses, not a new or
/// more destructive behavior.
export async function purgeUnconfirmedSelfiePhotos(
  retentionDays: number = SELFIE_PHOTO_RETENTION_DAYS,
  _deleteSelfiePhoto: typeof deleteSelfiePhoto = deleteSelfiePhoto,
): Promise<PurgeUnconfirmedSelfiesResult> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const stale = await prisma.selfieAnalysis.findMany({
    where: { photoPublicId: { not: null }, photoDeletedAt: null, updatedAt: { lt: cutoff } },
    select: { customerId: true },
  });

  let count = 0;
  for (const { customerId } of stale) {
    const result = await _deleteSelfiePhoto(customerId);
    if (result.ok) count++;
  }
  return { count, attempted: stale.length };
}
