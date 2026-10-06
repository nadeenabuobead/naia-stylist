// app/lib/ai/wardrobe-snapshot.server.ts
//
// Persistence for "what changed?". Reads the previous snapshot, works out what
// moved, and records the current one.
//
// Recording happens on every read of the Wardrobe Intelligence page, which is
// what makes the analysis keep up with the Closet: a piece added today is part
// of the comparison the next time she looks. A snapshot is only written when
// the reading has actually moved, so revisiting the page twice in a row does
// not bury the last real change under identical rows.

import prisma from "~/db.server";
import { scorePair, type WardrobeGarment } from "~/lib/ai/wardrobe-intelligence";
import type { WardrobeNeeds } from "~/lib/ai/wardrobe-needs";
import type { WardrobeRecommendations } from "~/lib/ai/wardrobe-recommendations";
import {
  summariseWardrobe,
  diffSnapshots,
  SNAPSHOT_VERSION,
  type WardrobeChange,
  type WardrobeSnapshotSummary,
  type AddedPiece,
} from "~/lib/ai/wardrobe-snapshot";

// The Prisma model is newer than the checked-in generated client in some
// environments; the narrow shape below is all this module uses.
type SnapshotRow = { id: string; takenAt: Date; closetCount: number; summary: unknown };
const db = prisma as unknown as {
  wardrobeSnapshot: {
    findFirst(args: unknown): Promise<SnapshotRow | null>;
    create(args: unknown): Promise<SnapshotRow>;
  };
};

function isSummary(value: unknown): value is WardrobeSnapshotSummary {
  return (
    typeof value === "object" && value !== null &&
    (value as { version?: unknown }).version === SNAPSHOT_VERSION
  );
}

/**
 * Pieces added since the last reading, with what each one genuinely combines
 * with. The partner list uses the same compatibility rule as the rest of the
 * page, so a new activewear piece does not arrive claiming the whole wardrobe.
 */
function piecesAddedSince(
  garments: WardrobeGarment[],
  addedIds: ReadonlySet<string>,
): AddedPiece[] {
  const out: AddedPiece[] = [];
  for (const g of garments) {
    if (!addedIds.has(g.id)) continue;
    const worksWithIds = garments
      .filter((other) => other.id !== g.id && !addedIds.has(other.id) && scorePair(g, other).compatible)
      .map((other) => other.id);
    out.push({ garmentId: g.id, name: g.name ?? g.subcategory ?? "This piece", worksWithIds });
  }
  return out;
}

export async function readAndRecordChange(input: {
  customerId: string;
  needs: WardrobeNeeds;
  recommendations: WardrobeRecommendations;
  garments: WardrobeGarment[];
  closetCount: number;
  /** Creation timestamps, so "added since" is a fact rather than an inference. */
  createdAtById: Map<string, Date>;
}): Promise<WardrobeChange | null> {
  const { customerId, needs, recommendations, garments, closetCount, createdAtById } = input;

  const after = summariseWardrobe({ needs, recommendations, closetCount });

  let previous: SnapshotRow | null = null;
  try {
    previous = await db.wardrobeSnapshot.findFirst({
      where: { customerId },
      orderBy: { takenAt: "desc" },
    });
  } catch {
    // The table may not exist yet where the migration has not been applied.
    // A missing history is not an error — it just means there is no before.
    return null;
  }

  const before = previous && isSummary(previous.summary) ? previous.summary : null;
  const takenAt = previous ? previous.takenAt.toISOString() : null;

  const addedIds = new Set<string>();
  if (previous) {
    for (const [id, createdAt] of createdAtById) {
      if (createdAt > previous.takenAt) addedIds.add(id);
    }
  }

  const change = diffSnapshots({
    before,
    after,
    takenAt,
    added: piecesAddedSince(garments, addedIds),
  });

  // Write only when the reading moved, or when there is no history at all.
  const shouldRecord = previous === null || change !== null;
  if (shouldRecord) {
    try {
      await db.wardrobeSnapshot.create({
        data: { customerId, closetCount, summary: after as unknown as object },
      });
    } catch {
      // Recording is best-effort. Failing to write a snapshot must never stop
      // the page rendering — the customer loses a future comparison, not today's
      // analysis.
    }
  }

  return change;
}
