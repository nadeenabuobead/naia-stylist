// app/lib/personalised-trend-history.server.ts
//
// Persistence for Personalised Trend Edit history and entitlement unlocks.
// customerId always comes from the authenticated session.
//
// ── THE FAILURE BOUNDARY ─────────────────────────────────────────────────────
// Reading a trend edit must never fail because a background write failed. But
// nothing may claim to have been saved when it was not. So:
//
//   * the unlock and the snapshot are two independent single-row upserts. There
//     is no multi-row write, so neither can be left half-written, and no
//     transaction is needed to keep them consistent.
//   * either one failing is caught, logged and reported honestly in the return
//     value. The page still renders.
//   * the two are NOT wrapped together. An unlock without a snapshot is fine —
//     she did receive the edit, and the snapshot lands on the next load. A
//     snapshot without an unlock is fine too — the unlock is idempotent and
//     lands next time. Neither state is corrupt, and binding them in one
//     transaction would trade a benign gap for a harder failure mode.

import prisma from "../db.server";
import { getUsageWindow } from "./plan/usage-window.server";
import {
  computeSnapshotHash,
  sanitiseEditForSnapshot,
  summariseEditEvidence,
  buildHistoryCards,
  PERSONALISED_EDIT_ENGINE_VERSION,
  type HistoryCard,
  type SnapshotRecord,
} from "./personalised-trend-history";
import type { ShopperEdit } from "./trend-evidence.server";

export interface RecordEditInput {
  customerId: string;
  reportId: string;
  reportSlug: string;
  reportTitle: string;
  reportSeason: string;
  /** The exact edit the route is about to render. */
  edit: ShopperEdit;
}

export interface RecordEditResult {
  /** false when the snapshot already existed — the refresh case. */
  snapshotCreated: boolean;
  /** false when this report was already unlocked. Only true grants cost allowance. */
  unlockCreated: boolean;
  /** Honest reporting: the page rendered, but this write did not land. */
  snapshotPersisted: boolean;
  unlockPersisted: boolean;
  snapshotId: string | null;
}

/**
 * Grant the unlock for this report if it is not already granted.
 *
 * One row per (customerId, reportId), permanently. Reopening next month,
 * refreshing, an engine bump, a republish and a history open all resolve to the
 * same row and grant nothing.
 */
async function ensureUnlock(
  customerId: string,
  reportId: string,
  reportSlug: string,
): Promise<{ created: boolean }> {
  const existing = await prisma.personalisedTrendEditUnlock.findUnique({
    where: { customerId_reportId: { customerId, reportId } },
    select: { id: true },
  });
  if (existing) return { created: false };

  try {
    await prisma.personalisedTrendEditUnlock.create({
      data: { customerId, reportId, reportSlug, grantedPeriod: getUsageWindow().label },
    });
    return { created: true };
  } catch (error) {
    // Concurrent first-open of the same report. The other request won; this one
    // consumed nothing, which is the correct outcome.
    if ((error as { code?: string })?.code === "P2002") return { created: false };
    throw error;
  }
}

/**
 * Store the edit as history, and grant the unlock.
 *
 * Idempotent on the snapshot hash: an identical render stores nothing. A
 * genuinely different render appends a NEW immutable row — existing snapshots
 * are never updated in place.
 */
export async function recordEditSnapshot(input: RecordEditInput): Promise<RecordEditResult> {
  const result: RecordEditResult = {
    snapshotCreated: false,
    unlockCreated: false,
    snapshotPersisted: false,
    unlockPersisted: false,
    snapshotId: null,
  };

  // Entitlement first: receiving the edit is what the allowance is for, and it
  // is the cheaper, smaller write.
  try {
    const unlock = await ensureUnlock(input.customerId, input.reportId, input.reportSlug);
    result.unlockCreated = unlock.created;
    result.unlockPersisted = true;
  } catch (error) {
    console.error("[trend-history] unlock write failed", error);
  }

  try {
    const snapshotHash = computeSnapshotHash({
      reportId: input.reportId,
      engineVersion: PERSONALISED_EDIT_ENGINE_VERSION,
      edit: input.edit,
    });

    const existing = await prisma.personalisedTrendEdit.findUnique({
      where: {
        customerId_reportId_snapshotHash: {
          customerId: input.customerId,
          reportId: input.reportId,
          snapshotHash,
        },
      },
      select: { id: true },
    });

    if (existing) {
      result.snapshotId = existing.id;
      result.snapshotPersisted = true;
      return result;
    }

    const created = await prisma.personalisedTrendEdit.create({
      data: {
        customerId: input.customerId,
        reportId: input.reportId,
        reportSlug: input.reportSlug,
        reportTitle: input.reportTitle,
        reportSeason: input.reportSeason,
        engineVersion: PERSONALISED_EDIT_ENGINE_VERSION,
        snapshotHash,
        // Sanitised: expiring signed image URLs are never stored.
        edit: sanitiseEditForSnapshot(input.edit) as unknown as object,
        evidenceSummary: summariseEditEvidence(input.edit) as unknown as object,
      },
      select: { id: true },
    });

    result.snapshotId = created.id;
    result.snapshotCreated = true;
    result.snapshotPersisted = true;
  } catch (error) {
    if ((error as { code?: string })?.code === "P2002") {
      // Concurrent identical render — the other request stored it.
      result.snapshotPersisted = true;
      return result;
    }
    console.error("[trend-history] snapshot write failed", error);
  }

  return result;
}

// ── Reading history ───────────────────────────────────────────────────────────

/** One card per canonical report, newest received first. Never a version log. */
export async function loadHistoryCards(customerId: string): Promise<HistoryCard[]> {
  const rows: Array<{
    id: string; reportId: string; reportSlug: string; reportTitle: string;
    reportSeason: string; engineVersion: string; snapshotHash: string; createdAt: Date;
  }> = await prisma.personalisedTrendEdit.findMany({
    where: { customerId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, reportId: true, reportSlug: true, reportTitle: true,
      reportSeason: true, engineVersion: true, snapshotHash: true, createdAt: true,
    },
  });

  const snapshots: SnapshotRecord[] = rows.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
  }));

  return buildHistoryCards(snapshots);
}

export interface StoredSnapshot {
  id: string;
  reportId: string;
  reportSlug: string;
  reportTitle: string;
  reportSeason: string;
  engineVersion: string;
  edit: ShopperEdit;
  createdAt: string;
}

/**
 * Load one stored snapshot for replay.
 *
 * Scoped by customerId in the WHERE clause, so another customer's snapshot id
 * resolves to null rather than to their edit. Returns the stored copy verbatim —
 * the caller must not rebuild it.
 */
export async function loadSnapshot(
  customerId: string,
  snapshotId: string,
): Promise<StoredSnapshot | null> {
  const row: {
    id: string; reportId: string; reportSlug: string; reportTitle: string;
    reportSeason: string; engineVersion: string; edit: unknown; createdAt: Date;
  } | null = await prisma.personalisedTrendEdit.findFirst({
    where: { id: snapshotId, customerId },
    select: {
      id: true, reportId: true, reportSlug: true, reportTitle: true,
      reportSeason: true, engineVersion: true, edit: true, createdAt: true,
    },
  });
  if (!row) return null;

  return {
    id: row.id,
    reportId: row.reportId,
    reportSlug: row.reportSlug,
    reportTitle: row.reportTitle,
    reportSeason: row.reportSeason,
    engineVersion: row.engineVersion,
    edit: row.edit as ShopperEdit,
    createdAt: row.createdAt.toISOString(),
  };
}

// ── Entitlement ───────────────────────────────────────────────────────────────

/**
 * Unlocks granted in the CURRENT entitlement window.
 *
 * Counts unlocks, never snapshots, page views, regenerations or history opens.
 * Uses getUsageWindow() rather than a second calendar-month calculation.
 */
export async function countUnlocksThisWindow(customerId: string): Promise<number> {
  const window = getUsageWindow();
  return prisma.personalisedTrendEditUnlock.count({
    where: { customerId, grantedAt: { gte: window.start, lt: window.end } },
  });
}
