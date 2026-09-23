// app/lib/personalised-trend-history.server.ts
//
// Persistence for Personalised Trend Edit history and entitlement unlocks.
// customerId always comes from the authenticated session.
//
// ── THE FAILURE BOUNDARY ─────────────────────────────────────────────────────
// Reading a trend edit must never fail because a background write failed, and
// nothing may claim to have been saved when it was not.
//
// FIRST RECEIPT IS ATOMIC. The first time a customer receives a report, the
// snapshot and the unlock are written in ONE interactive transaction. Either
// both land or neither does. The two bad states are ruled out by construction:
//
//   unlock without snapshot  → allowance consumed, nothing stored
//   snapshot without unlock  → history exists, usage disagrees
//
// Afterwards there is nothing to make atomic: the unlock already exists, so a
// later version is a single-row insert, and an identical refresh writes nothing
// at all. Replay writes nothing.
//
// If the transaction fails the route still renders the freshly generated edit —
// that is the safest thing for the customer — but reports persisted:false and
// consumes no unlock. The next successful load writes both.

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
import {
  getCloudinaryConfig,
  validatePublicIdOwnership,
  buildPrivateDownloadUrl,
} from "./cloudinary-admin.server";

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
 * Store the edit as history, and grant the unlock.
 *
 * Three paths, each doing the least work that is correct:
 *
 *   first receipt        snapshot + unlock in ONE transaction
 *   already unlocked,
 *     new output         snapshot only, single-row insert
 *   identical refresh    nothing at all
 */
export async function recordEditSnapshot(input: RecordEditInput): Promise<RecordEditResult> {
  const result: RecordEditResult = {
    snapshotCreated: false,
    unlockCreated: false,
    snapshotPersisted: false,
    unlockPersisted: false,
    snapshotId: null,
  };

  const snapshotHash = computeSnapshotHash({
    engineVersion: PERSONALISED_EDIT_ENGINE_VERSION,
    reportId: input.reportId,
    reportSlug: input.reportSlug,
    reportTitle: input.reportTitle,
    reportSeason: input.reportSeason,
    edit: input.edit,
  });

  const snapshotData = {
    customerId: input.customerId,
    reportId: input.reportId,
    reportSlug: input.reportSlug,
    reportTitle: input.reportTitle,
    reportSeason: input.reportSeason,
    engineVersion: PERSONALISED_EDIT_ENGINE_VERSION,
    snapshotHash,
    // Sanitised: expiring signed image URLs never enter storage.
    edit: sanitiseEditForSnapshot(input.edit) as unknown as object,
    evidenceSummary: summariseEditEvidence(input.edit) as unknown as object,
  };

  try {
    const [existingUnlock, existingSnapshot] = await Promise.all([
      prisma.personalisedTrendEditUnlock.findUnique({
        where: { customerId_reportId: { customerId: input.customerId, reportId: input.reportId } },
        select: { id: true },
      }),
      prisma.personalisedTrendEdit.findUnique({
        where: {
          customerId_reportId_snapshotHash: {
            customerId: input.customerId, reportId: input.reportId, snapshotHash,
          },
        },
        select: { id: true },
      }),
    ]);

    // ── Identical refresh ────────────────────────────────────────────────
    if (existingUnlock && existingSnapshot) {
      result.snapshotId = existingSnapshot.id;
      result.snapshotPersisted = true;
      result.unlockPersisted = true;
      return result;
    }

    // ── Already unlocked, output changed ─────────────────────────────────
    if (existingUnlock) {
      result.unlockPersisted = true;
      const created = await prisma.personalisedTrendEdit.create({ data: snapshotData, select: { id: true } });
      result.snapshotId = created.id;
      result.snapshotCreated = true;
      result.snapshotPersisted = true;
      return result;
    }

    // ── First receipt — both rows, or neither ────────────────────────────
    const created = await prisma.$transaction(async (tx: typeof prisma) => {
      await tx.personalisedTrendEditUnlock.create({
        data: {
          customerId: input.customerId,
          reportId: input.reportId,
          reportSlug: input.reportSlug,
          grantedPeriod: getUsageWindow().label,
        },
      });
      // An identical snapshot can already exist without an unlock only if an
      // earlier first receipt half-failed before this change; reuse it rather
      // than colliding.
      return existingSnapshot
        ? existingSnapshot
        : tx.personalisedTrendEdit.create({ data: snapshotData, select: { id: true } });
    });

    result.snapshotId = created.id;
    result.snapshotCreated = !existingSnapshot;
    result.snapshotPersisted = true;
    result.unlockCreated = true;
    result.unlockPersisted = true;
    return result;
  } catch (error) {
    // A concurrent first receipt of the same report: the other request wrote
    // both rows. Nothing was consumed here and nothing is half-written.
    if ((error as { code?: string })?.code === "P2002") {
      console.warn("[trend-history] concurrent write absorbed", input.reportId);
      return result;
    }
    // Anything else: the transaction rolled back, so no partial state exists.
    // Report honestly and let the route render the edit it already generated.
    console.error("[trend-history] persistence failed — nothing was written", error);
    return result;
  }
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

// ── Historical media ──────────────────────────────────────────────────────────

/**
 * Re-sign images for a stored snapshot's closet pieces.
 *
 * A snapshot never stores a signed URL — those expire in ten minutes. It stores
 * the closetItemId instead, so replay can mint a FRESH url for the SAME piece.
 * Not a word of the personalised edit is regenerated: this only fills in
 * `imageUrl` on items the snapshot already named.
 *
 * Scoped by customerId, and the Cloudinary public id is ownership-checked before
 * signing, so a snapshot can never surface another customer's photograph. A
 * piece she has since deleted simply keeps its label and loses its thumbnail.
 */
export async function resolveSnapshotImages(
  customerId: string,
  edit: ShopperEdit,
): Promise<ShopperEdit> {
  const items = edit.evidenceClosetItems ?? [];
  const ids = items.map((i) => i.closetItemId).filter(Boolean);
  if (ids.length === 0) return edit;

  const rows: Array<{ id: string; imageUrl: string | null; imagePublicId: string | null; imageFormat: string | null }> =
    await prisma.closetItem.findMany({
      where: { id: { in: ids }, customerId },
      select: { id: true, imageUrl: true, imagePublicId: true, imageFormat: true },
    });

  const cfg = getCloudinaryConfig();
  const urlById = new Map<string, string | null>();
  for (const row of rows) {
    let url: string | null = null;
    if (row.imagePublicId && row.imageFormat && cfg) {
      const ownership = validatePublicIdOwnership(row.imagePublicId, customerId);
      if (ownership.ok) {
        url = buildPrivateDownloadUrl(cfg, row.imagePublicId, row.imageFormat, "private");
      }
    }
    urlById.set(row.id, url ?? row.imageUrl ?? null);
  }

  return {
    ...edit,
    evidenceClosetItems: items.map((item) => ({
      ...item,
      // Deleted piece or unavailable asset → stays null, and the historical
      // edit renders from its stored label.
      imageUrl: urlById.get(item.closetItemId) ?? null,
    })),
  };
}
