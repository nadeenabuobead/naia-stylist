// app/lib/trend-feedback.server.ts
//
// Persistence for deliberate, non-save Trend Report actions. customerId
// always comes from the authenticated session.
//
// ── ONE CURRENT STATE PER THING ─────────────────────────────────────────────
// TrendContentFeedback is unique on (customer, reportSlug, contentType,
// contentKey, action). Clicking "Not for me" ten times is one row. That
// constraint is what stops repetition inflating anything, enforced by the
// database rather than by remembering to check.
//
// ── SCOPE ────────────────────────────────────────────────────────────────────
// The frozen fix/trend-product-completion branch fed every SAVE/STYLED/
// NOT_FOR_ME action into Taste & Evidence (trend-taste-evidence.ts) via a
// per-facet garment-category mapping. That mapping is 100% facet-shaped —
// there is no honest, non-facet signal left once FACET is dropped (see
// Founder Decision on the frozen facet redesign) — so trend-taste-evidence.ts
// is deliberately NOT ported, and this module does not write TasteEvidence
// rows at all. Writing a row with an invented dimension would violate the
// exact "nothing is forced" rule that module's own comments documented.
// Wiring an honest Trend→Taste mapping is left to a future change once V2
// defines one; this feedback row itself is unaffected either way, since the
// row persisted here is a perfectly good evidence source once that mapping
// exists.
//
// STYLED is a reserved action value. It is not written by any route in this
// change — on the frozen branch it was written only from the pre-existing
// api.styleme-handoff.tsx route (the "style this in StyleMe" handoff), which
// is out of scope here: it is not one of the files this change ports, and
// changing its behaviour is not part of Saved Items / Trend Feedback.

import prisma from "../db.server";

export const TREND_FEEDBACK_ACTIONS = ["NOT_FOR_ME", "STYLED"] as const;
export type TrendFeedbackAction = (typeof TREND_FEEDBACK_ACTIONS)[number];

export function isTrendFeedbackAction(value: unknown): value is TrendFeedbackAction {
  return typeof value === "string" && (TREND_FEEDBACK_ACTIONS as readonly string[]).includes(value);
}

export interface FeedbackTarget {
  reportSlug: string;
  contentType: string;
  contentKey: string;
  contentLabel?: string | null;
}

export interface FeedbackResult {
  /** The state after the call — what the control should render. */
  active: boolean;
  recordId: string | null;
}

/**
 * Record (or reverse) a deliberate non-save action.
 *
 * `active` is the intended state, not a toggle instruction: calling it twice
 * with the same value is a no-op, so a double-submit or an impatient second
 * click cannot produce a second row.
 */
export async function setTrendFeedback(
  customerId: string,
  target: FeedbackTarget,
  action: TrendFeedbackAction,
  active: boolean,
): Promise<FeedbackResult> {
  const where = {
    customerId_reportSlug_contentType_contentKey_action: {
      customerId,
      reportSlug: target.reportSlug,
      contentType: target.contentType,
      contentKey: target.contentKey,
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
    return { active: false, recordId: null };
  }

  // ── Already in that state ────────────────────────────────────────────────
  if (existing) return { active: true, recordId: existing.id };

  // ── New signal ───────────────────────────────────────────────────────────
  try {
    const created: { id: string } = await prisma.trendContentFeedback.create({
      data: {
        customerId,
        reportSlug: target.reportSlug,
        contentType: target.contentType,
        contentKey: target.contentKey,
        contentLabel: target.contentLabel ?? null,
        action,
      },
      select: { id: true },
    });
    return { active: true, recordId: created.id };
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
}

/** Current feedback state for a report, so controls render the real truth. */
export async function loadTrendFeedback(
  customerId: string,
  reportSlug: string,
): Promise<{ notForMe: string[]; styled: string[] }> {
  const rows: Array<{ contentKey: string; action: string }> =
    await prisma.trendContentFeedback.findMany({
      where: { customerId, reportSlug },
      select: { contentKey: true, action: true },
    });

  return {
    notForMe: rows.filter((r) => r.action === "NOT_FOR_ME").map((r) => r.contentKey),
    styled: rows.filter((r) => r.action === "STYLED").map((r) => r.contentKey),
  };
}
