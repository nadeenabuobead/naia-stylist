// app/lib/trend-feedback.server.ts
//
// Persistence for deliberate Trend Report actions, and the bridge into Taste &
// Evidence. customerId always comes from the authenticated session.
//
// ── ONE CURRENT STATE PER THING ─────────────────────────────────────────────
// TrendContentFeedback is unique on (customer, report, contentType, contentId,
// action). Clicking "Not for me" ten times is one row and one signal. Clicking
// "Style this" ten times is one row and one signal. That constraint is what
// stops repetition inflating support, and it is enforced by the database rather
// than by remembering to check.
//
// Reversal deletes the row and re-runs writeSourceEvidence with an empty set,
// which removes the evidence and reconciles the tendency back down.

import prisma from "../db.server";
import { writeSourceEvidence } from "./ai/taste-reconcile.server";
import { extractTrendEvidence, type TrendAction } from "./trend-taste-evidence";
import type { TrendFacets } from "./trend-facets";

export interface FeedbackTarget {
  reportId: string;
  contentType: string;
  contentId: string;
  contentLabel?: string | null;
  /** Authored facets, for evidence extraction. */
  facets?: TrendFacets | null;
}

export interface FeedbackResult {
  /** The state after the call — what the control should render. */
  active: boolean;
  recordId: string | null;
}

/**
 * Record a deliberate non-save action.
 *
 * `active` is the intended state, not a toggle instruction: calling it twice
 * with the same value is a no-op, so a double-submit or an impatient second
 * click cannot produce a second signal.
 */
export async function setTrendFeedback(
  customerId: string,
  target: FeedbackTarget,
  action: TrendAction,
  active: boolean,
): Promise<FeedbackResult> {
  const where = {
    customerId_reportId_contentType_contentId_action: {
      customerId,
      reportId: target.reportId,
      contentType: target.contentType,
      contentId: target.contentId,
      action,
    },
  };

  const existing: { id: string } | null = await prisma.trendContentFeedback.findUnique({
    where, select: { id: true },
  });

  // ── Reversing ────────────────────────────────────────────────────────────
  if (!active) {
    if (!existing) return { active: false, recordId: null };
    await prisma.trendContentFeedback.delete({ where: { id: existing.id } });
    // Empty row set removes this record's evidence and reconciles.
    await writeSourceEvidence(customerId, "TREND_ENGAGEMENT" as never, existing.id, []);
    return { active: false, recordId: null };
  }

  // ── Already in that state ────────────────────────────────────────────────
  if (existing) {
    // Deliberately does NOT rewrite evidence. The signal already exists; a
    // repeat click is the same signal, not a fresh one.
    return { active: true, recordId: existing.id };
  }

  // ── New signal ───────────────────────────────────────────────────────────
  let created: { id: string; createdAt: Date };
  try {
    created = await prisma.trendContentFeedback.create({
      data: {
        customerId,
        reportId: target.reportId,
        contentType: target.contentType,
        contentId: target.contentId,
        contentLabel: target.contentLabel ?? null,
        action,
      },
      select: { id: true, createdAt: true },
    });
  } catch (error) {
    // Concurrent double-submit: the other request created it. Same outcome.
    if ((error as { code?: string })?.code === "P2002") {
      const row: { id: string } | null = await prisma.trendContentFeedback.findUnique({
        where, select: { id: true },
      });
      return { active: true, recordId: row?.id ?? null };
    }
    throw error;
  }

  await emitTrendEvidence(customerId, created.id, action, target.facets, created.createdAt);
  return { active: true, recordId: created.id };
}

/**
 * Write the evidence for one deliberate action.
 *
 * Shared by feedback and by saving, so both obey the same rules: only a facet
 * with an honest V1 dimension produces anything, and the durable row id is the
 * source record so repetition cannot inflate support.
 */
export async function emitTrendEvidence(
  customerId: string,
  sourceRecordId: string,
  action: TrendAction,
  facets: TrendFacets | null | undefined,
  occurredAt: Date,
): Promise<void> {
  const rows = extractTrendEvidence({ customerId, sourceRecordId, action, facets, occurredAt });
  // Called even when empty: writeSourceEvidence is delete-and-reinsert, so an
  // empty set is how evidence is withdrawn.
  await writeSourceEvidence(customerId, "TREND_ENGAGEMENT" as never, sourceRecordId, rows);
}

/** Withdraw the evidence attached to a record that no longer exists. */
export async function withdrawTrendEvidence(
  customerId: string,
  sourceRecordId: string,
): Promise<void> {
  await writeSourceEvidence(customerId, "TREND_ENGAGEMENT" as never, sourceRecordId, []);
}

/** Current feedback state for a report, so controls render the real truth. */
export async function loadTrendFeedback(
  customerId: string,
  reportId: string,
): Promise<{ notForMe: string[]; styled: string[] }> {
  const rows: Array<{ contentId: string; action: string }> =
    await prisma.trendContentFeedback.findMany({
      where: { customerId, reportId },
      select: { contentId: true, action: true },
    });

  return {
    notForMe: rows.filter((r) => r.action === "NOT_FOR_ME").map((r) => r.contentId),
    styled: rows.filter((r) => r.action === "STYLED").map((r) => r.contentId),
  };
}
