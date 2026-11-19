// app/lib/saved-items.server.ts
//
// The persistence layer for Saved Items. Every function takes customerId from
// the authenticated session — never from a route param, query string or body.
// Every Prisma call below is scoped by customerId, so an itemKey belonging to
// another customer matches nothing.

import prisma from "../db.server";
import {
  buildSaveItemRow,
  buildItemKey,
  slugify,
  type SaveItemRequest,
} from "./saved-items";

export interface SaveResult {
  /** false when the item was already saved — the request was a no-op. */
  created: boolean;
  itemKey: string;
  /** The durable row id. */
  itemId: string | null;
}

/**
 * Save an object. IDEMPOTENT: a repeat save of the same canonical object is a
 * no-op that reports created:false.
 *
 * Re-encountering the same object from a different report must NOT overwrite
 * the provenance of the save that created the row — "From: Autumn Edit" is a
 * record of where the customer actually found it.
 */
export async function saveItem(
  customerId: string,
  request: SaveItemRequest,
): Promise<SaveResult> {
  const row = buildSaveItemRow(request);

  const existing = await prisma.savedItem.findUnique({
    where: { customerId_itemKey: { customerId, itemKey: row.itemKey } },
    select: { id: true },
  });
  if (existing) return { created: false, itemKey: row.itemKey, itemId: existing.id };

  try {
    const created: { id: string } = await prisma.savedItem.create({
      data: { customerId, ...row }, select: { id: true },
    });
    return { created: true, itemKey: row.itemKey, itemId: created.id };
  } catch (error) {
    // Unique violation — two concurrent saves of the same object. The other
    // one won, which is the correct outcome; report it as already-saved.
    if ((error as { code?: string })?.code === "P2002") {
      return { created: false, itemKey: row.itemKey, itemId: null };
    }
    throw error;
  }
}

/**
 * Remove a save. Idempotent — unsaving something not saved is a no-op.
 * Scoped by customerId, so an itemKey from another customer matches nothing.
 */
export async function unsaveItem(customerId: string, itemKey: string): Promise<string | null> {
  const row: { id: string } | null = await prisma.savedItem.findUnique({
    where: { customerId_itemKey: { customerId, itemKey } },
    select: { id: true },
  });
  if (!row) return null;
  // Scoped by customerId as well as id — defence in depth, and it keeps the
  // invariant "every SavedItem query names customerId" literally true.
  await prisma.savedItem.deleteMany({ where: { id: row.id, customerId } });
  return row.id;
}

/** Which of these itemKeys the customer has saved — for rendering the ♡ state. */
export async function savedItemKeys(
  customerId: string,
  itemKeys: string[],
): Promise<Set<string>> {
  if (itemKeys.length === 0) return new Set();
  const rows: Array<{ itemKey: string }> = await prisma.savedItem.findMany({
    where: { customerId, itemKey: { in: itemKeys } },
    select: { itemKey: true },
  });
  return new Set(rows.map((r) => r.itemKey));
}

// ── Save state for a report page ─────────────────────────────────────────────

export interface ReportSaveState {
  /** "TREND:<slugified-name>" → itemKey. Built server-side so the client never derives identity on its own. */
  itemKeys: Record<string, string>;
  /** itemKeys this customer has actually saved. Empty when signed out. */
  saved: string[];
  /** True when a ♡ can do anything — drives the sign-in affordance. */
  canSave: boolean;
}

type ReportForSaveState = {
  slug: string;
  keyTrends?: Array<{ name: string }> | null;
  rising?: Array<{ signal: string }> | null;
  fading?: Array<{ signal: string }> | null;
  referencesBehindThisEdit?: Array<{ brand: string; collection?: string }> | null;
};

/**
 * Every saveable object on a report, with its itemKey, plus which of them
 * this customer has saved. State comes from the database on every load, so a
 * refresh shows the real persisted truth rather than remembered client state.
 *
 * customerId is null for an anonymous visitor: the controls still render (the
 * editorial page is public) but nothing is marked saved.
 */
export async function loadReportSaveState(
  customerId: string | null,
  report: ReportForSaveState,
  options: { productHandles?: string[]; takeawaySections?: string[] } = {},
): Promise<ReportSaveState> {
  const itemKeys: Record<string, string> = {};
  const reportSlug = report.slug;

  for (const t of report.keyTrends ?? []) {
    if (!t.name) continue;
    const contentKey = slugify(t.name);
    if (!contentKey) continue;
    itemKeys[`TREND:${contentKey}`] = buildItemKey({ contentType: "TREND", contentKey, reportSlug });
  }
  for (const s of [...(report.rising ?? []), ...(report.fading ?? [])]) {
    if (!s.signal) continue;
    const contentKey = slugify(s.signal);
    if (!contentKey) continue;
    itemKeys[`SIGNAL:${contentKey}`] = buildItemKey({ contentType: "SIGNAL", contentKey, reportSlug });
  }
  for (const r of report.referencesBehindThisEdit ?? []) {
    const label = r.collection ? `${r.brand} — ${r.collection}` : r.brand;
    if (!label) continue;
    const contentKey = slugify(label);
    if (!contentKey) continue;
    itemKeys[`REFERENCE:${contentKey}`] = buildItemKey({ contentType: "REFERENCE", contentKey, reportSlug });
  }

  // Global — identity does not include the report it was found in.
  for (const handle of options.productHandles ?? []) {
    itemKeys[`PRODUCT:${handle}`] = buildItemKey({ contentType: "PRODUCT", contentKey: handle });
  }

  for (const section of options.takeawaySections ?? []) {
    itemKeys[`TAKEAWAY:${section}`] = buildItemKey({
      contentType: "TAKEAWAY", contentKey: section, reportSlug,
    });
  }

  if (!customerId) return { itemKeys, saved: [], canSave: false };

  const saved = await savedItemKeys(customerId, Object.values(itemKeys));
  return { itemKeys, saved: [...saved], canSave: true };
}
