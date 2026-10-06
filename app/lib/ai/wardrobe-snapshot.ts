// app/lib/ai/wardrobe-snapshot.ts
//
// "What changed after adding a piece?"
//
// The intelligence is only worth feeding if each new garment visibly makes it
// sharper. That requires a real BEFORE — otherwise the answer is assembled from
// whatever is true now and dressed up as a change, which is exactly the kind of
// claim this codebase refuses to make elsewhere.
//
// So a snapshot is recorded whenever the wardrobe is read, and the change is a
// diff of two snapshots. Everything here is derived from the needs layer; this
// module recomputes nothing and decides nothing is missing.

import type { WardrobeNeeds, RegisterId } from "~/lib/ai/wardrobe-needs";
import type { WardrobeRecommendations } from "~/lib/ai/wardrobe-recommendations";

/** Bumped when the shape changes, so an old snapshot is ignored, not misread. */
export const SNAPSHOT_VERSION = 1 as const;

export interface SnapshotRegister {
  register: RegisterId;
  /** Supported pairs between interchangeability classes — the depth measure. */
  distinctLooks: number;
  usableCount: number;
}

export interface WardrobeSnapshotSummary {
  version: typeof SNAPSHOT_VERSION;
  closetCount: number;
  registers: SnapshotRegister[];
  /** Finding ids for gaps that were open at the time. */
  openGaps: string[];
  /** Recommendation ids that were being made at the time. */
  recommendations: string[];
}

export function summariseWardrobe(input: {
  needs: WardrobeNeeds;
  recommendations: WardrobeRecommendations;
  closetCount: number;
}): WardrobeSnapshotSummary {
  const { needs, recommendations, closetCount } = input;
  return {
    version: SNAPSHOT_VERSION,
    closetCount,
    registers: needs.registers.map((r) => ({
      register: r.register,
      distinctLooks: r.distinctLooks,
      usableCount: r.usableCount,
    })),
    openGaps: needs.couldUseMore.map((f) => f.id),
    recommendations: recommendations.recommendations.map((r) => r.id),
  };
}

// ── The change ────────────────────────────────────────────────────────────────

export interface AddedPiece {
  garmentId: string;
  name: string;
  /** Pieces already owned that this one genuinely combines with. */
  worksWithIds: string[];
}

export interface RegisterImprovement {
  register: RegisterId;
  from: number;
  to: number;
}

export interface WardrobeChange {
  /** When the previous reading was taken. */
  since: string;
  piecesAdded: number;
  piecesRemoved: number;
  added: AddedPiece[];
  /** Registers whose depth genuinely grew. */
  improved: RegisterImprovement[];
  /** Gaps that were open before and are not open now. */
  gapsClosed: string[];
  /** True when what nAia would tell her to look for has changed. */
  priorityChanged: boolean;
}

/**
 * What actually moved between two readings.
 *
 * Returns null when there is nothing honest to report: no previous snapshot, a
 * snapshot written by an older version, or a wardrobe that has not moved. An
 * empty change is not a story, and printing one would teach the customer to
 * ignore the block.
 */
export function diffSnapshots(input: {
  before: WardrobeSnapshotSummary | null;
  after: WardrobeSnapshotSummary;
  takenAt: string | null;
  added: AddedPiece[];
}): WardrobeChange | null {
  const { before, after, takenAt, added } = input;
  if (before === null || takenAt === null) return null;
  if (before.version !== SNAPSHOT_VERSION) return null;

  const beforeByRegister = new Map(before.registers.map((r) => [r.register, r]));
  const improved: RegisterImprovement[] = [];
  for (const r of after.registers) {
    const was = beforeByRegister.get(r.register);
    if (was && r.distinctLooks > was.distinctLooks) {
      improved.push({ register: r.register, from: was.distinctLooks, to: r.distinctLooks });
    }
  }

  const openNow = new Set(after.openGaps);
  const gapsClosed = before.openGaps.filter((id) => !openNow.has(id));

  const beforeRecs = [...before.recommendations].sort().join("|");
  const afterRecs = [...after.recommendations].sort().join("|");

  const delta = after.closetCount - before.closetCount;
  const change: WardrobeChange = {
    since: takenAt,
    piecesAdded: Math.max(0, delta),
    piecesRemoved: Math.max(0, -delta),
    added,
    improved,
    gapsClosed,
    priorityChanged: beforeRecs !== afterRecs,
  };

  const moved =
    change.piecesAdded > 0 ||
    change.piecesRemoved > 0 ||
    improved.length > 0 ||
    gapsClosed.length > 0 ||
    change.priorityChanged;

  return moved ? change : null;
}

// ── Copy ──────────────────────────────────────────────────────────────────────

const REGISTER_WORD: Readonly<Record<string, string>> = {
  everyday: "everyday",
  work: "work",
  occasion: "occasion",
};

/**
 * The change in her words. Each line states one thing that moved, and nothing
 * is said unless the diff actually contains it.
 */
export function changeLines(change: WardrobeChange): string[] {
  const lines: string[] = [];

  // Depth and gaps can move without the Closet moving: a Passport edit, an
  // admin correction to a garment's profile, or a change to how the engine
  // reads pieces will all do it. Reporting that alongside "what changed" would
  // let the customer read it as the effect of something she added, so when
  // nothing was added or removed the cause is named as what it is.
  const closetUnchanged = change.piecesAdded === 0 && change.piecesRemoved === 0;
  if (closetUnchanged) {
    lines.push("Your Closet hasn't changed, but nAia's reading of it has.");
  }

  let namedAPiece = false;
  for (const piece of change.added.slice(0, 2)) {
    if (piece.worksWithIds.length === 0) continue;
    namedAPiece = true;
    lines.push(
      `${piece.name} works with ${piece.worksWithIds.length} ${piece.worksWithIds.length === 1 ? "piece" : "pieces"} you already own.`,
    );
  }

  // A piece that combines with nothing yet still gets acknowledged. Saying
  // nothing would leave someone who has just added something looking at a block
  // that does not mention it — and a piece with no partners is itself worth
  // knowing, so it is never quietly skipped.
  if (!namedAPiece && change.piecesAdded > 0) {
    lines.push(`You've added ${change.piecesAdded} ${change.piecesAdded === 1 ? "piece" : "pieces"} since nAia last looked.`);
  }
  if (change.piecesRemoved > 0) {
    lines.push(`You've removed ${change.piecesRemoved} ${change.piecesRemoved === 1 ? "piece" : "pieces"} since nAia last looked.`);
  }

  for (const r of change.improved) {
    lines.push(
      // "supported combinations", never "outfits". Crossing the threshold
      // means more variety is available, not that the wardrobe is now complete
      // or that these are finished, wearable looks.
      `Your ${REGISTER_WORD[r.register] ?? r.register} dressing has more variety than it did — ${r.from} supported combinations, now ${r.to}.`,
    );
  }

  if (change.gapsClosed.length > 0) {
    lines.push(
      change.gapsClosed.length === 1
        ? "That closes a gap nAia had flagged."
        : `That closes ${change.gapsClosed.length} gaps nAia had flagged.`,
    );
  }

  if (change.priorityChanged && change.gapsClosed.length === 0) {
    lines.push("What nAia would suggest looking for has changed as a result.");
  }

  return lines;
}
