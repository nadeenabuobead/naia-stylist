// app/lib/saved-items.server.ts
//
// The persistence layer for My Saved. Every function takes customerId from the
// authenticated session — never from a route param, query string or body.
//
// Step 2 provides the foundation only. No UI calls saveItem() yet; the save
// affordances land in Step 3.

// ~/db.server is the canonical client — it caps each serverless instance at one
// connection. It is untyped (global singleton), so query results are annotated
// explicitly here rather than inferred, matching wardrobe-intelligence.server.ts.
import prisma from "../db.server";
import {
  buildSaveItemRow,
  savedItemToCard,
  savedLookToCard,
  mergeSavedCards,
  type SaveItemRequest,
  type SavedCard,
} from "./saved-items";
import { buildRefKey, isContentId, type TrendContentType } from "./trend-content-identity";
import {
  getCloudinaryConfig,
  validatePublicIdOwnership,
  buildPrivateDownloadUrl,
} from "./cloudinary-admin.server";

export interface SaveResult {
  /** false when the item was already saved — the request was a no-op. */
  created: boolean;
  refKey: string;
}

/**
 * Save an object. IDEMPOTENT: a repeat save of the same canonical object is a
 * no-op that reports created:false.
 *
 * The update branch is deliberately empty. Re-encountering the same object from
 * a different report must NOT overwrite the provenance of the save that created
 * the row — "From: Autumn Edit" is a record of where the customer actually found
 * it, and silently rewriting it to a later report would make the card lie.
 */
export async function saveItem(
  customerId: string,
  request: SaveItemRequest,
): Promise<SaveResult> {
  const row = buildSaveItemRow(request);

  const existing = await prisma.savedItem.findUnique({
    where: { customerId_refKey: { customerId, refKey: row.refKey } },
    select: { id: true },
  });
  if (existing) return { created: false, refKey: row.refKey };

  try {
    await prisma.savedItem.create({ data: { customerId, ...row } });
    return { created: true, refKey: row.refKey };
  } catch (error) {
    // Unique violation — two concurrent saves of the same object. The other one
    // won, which is the correct outcome; report it as already-saved.
    if ((error as { code?: string })?.code === "P2002") {
      return { created: false, refKey: row.refKey };
    }
    throw error;
  }
}

/**
 * Remove a save. Idempotent — unsaving something not saved is a no-op.
 * Scoped by customerId, so a refKey from another customer matches nothing.
 */
export async function unsaveItem(customerId: string, refKey: string): Promise<{ removed: boolean }> {
  const result = await prisma.savedItem.deleteMany({ where: { customerId, refKey } });
  return { removed: result.count > 0 };
}

/** Which of these refKeys the customer has saved — for rendering ♡ state in Step 3. */
export async function savedRefKeys(
  customerId: string,
  refKeys: string[],
): Promise<Set<string>> {
  if (refKeys.length === 0) return new Set();
  const rows: Array<{ refKey: string }> = await prisma.savedItem.findMany({
    where: { customerId, refKey: { in: refKeys } },
    select: { refKey: true },
  });
  return new Set(rows.map((r) => r.refKey));
}

// ── My Saved ──────────────────────────────────────────────────────────────────

/**
 * Both stores, normalised into one card list, newest first.
 *
 * SavedLook keeps its own storage and its own image-resolution rules; this reads
 * it, it does not restate it. The look-image logic below is the behaviour the
 * previous /my-naia/saved page had, preserved verbatim: stored productImageUrl
 * first, then a signed private URL for closet items, then the original
 * suggestion's images as a last resort.
 */
export async function loadMySaved(customerId: string): Promise<SavedCard[]> {
  type SavedItemRow = {
    id: string; refKey: string; contentType: string; contentId: string;
    label: string; sublabel: string | null; imageUrl: string | null;
    sourceKind: string; sourceReportTitle: string | null; sourceSeason: string | null;
    sourceContentLabel: string | null; sourcePath: string | null; createdAt: Date;
  };
  type LookItemRow = {
    closetItemId: string | null;
    shopifyProductId: string | null;
    productImageUrl: string | null;
    closetItem: { imageUrl: string | null; imagePublicId: string | null; imageFormat: string | null } | null;
  };
  type LookRow = {
    id: string; name: string | null; occasion: string | null;
    fromSuggestionId: string | null; timesWorn: number; createdAt: Date;
    items: LookItemRow[];
  };

  const [items, looks]: [SavedItemRow[], LookRow[]] = await Promise.all([
    prisma.savedItem.findMany({
      where: { customerId },
      orderBy: { createdAt: "desc" },
    }),
    prisma.savedLook.findMany({
      where: { customerId },
      orderBy: { createdAt: "desc" },
      include: {
        items: {
          orderBy: { id: "asc" },
          include: {
            closetItem: { select: { imageUrl: true, imagePublicId: true, imageFormat: true } },
          },
        },
      },
    }),
  ]);

  const cloudinaryConfig = getCloudinaryConfig();

  // Recover images for SavedLookItems saved before productImageUrl was copied.
  const suggestionIds = looks.map((l: LookRow) => l.fromSuggestionId).filter(Boolean) as string[];
  type SuggItem = { closetItemId: string | null; shopifyProductId: string | null; productImageUrl: string | null };
  const suggestionMap = new Map<string, { sessionId: string; items: SuggItem[] }>();

  if (suggestionIds.length > 0) {
    const suggestions = await prisma.outfitSuggestion.findMany({
      where: { id: { in: suggestionIds } },
      select: {
        id: true,
        sessionId: true,
        items: { select: { closetItemId: true, shopifyProductId: true, productImageUrl: true } },
      },
    });
    for (const s of suggestions) suggestionMap.set(s.id, { sessionId: s.sessionId, items: s.items });
  }

  const lookCards = looks.map((look: LookRow) => {
    const suggData = look.fromSuggestionId ? suggestionMap.get(look.fromSuggestionId) : undefined;

    const images = look.items
      .map((item: LookItemRow) => {
        if (item.productImageUrl) return item.productImageUrl;

        if (item.closetItemId && item.closetItem) {
          const ci = item.closetItem;
          if (ci.imagePublicId && ci.imageFormat && cloudinaryConfig) {
            const ownership = validatePublicIdOwnership(ci.imagePublicId, customerId);
            if (ownership.ok) {
              return buildPrivateDownloadUrl(cloudinaryConfig, ci.imagePublicId, ci.imageFormat, "private");
            }
          }
          if (ci.imageUrl) return ci.imageUrl;
        }

        if (suggData) {
          const match = item.shopifyProductId
            ? suggData.items.find((i) => i.shopifyProductId === item.shopifyProductId)
            : item.closetItemId
              ? suggData.items.find((i) => i.closetItemId === item.closetItemId)
              : undefined;
          if (match?.productImageUrl) return match.productImageUrl;
        }

        return null;
      })
      .filter((url: string | null): url is string => Boolean(url));

    return savedLookToCard({
      id: look.id,
      name: look.name,
      occasion: look.occasion,
      images,
      originalSessionId: suggData?.sessionId ?? null,
      timesWorn: look.timesWorn,
      createdAt: look.createdAt.toISOString(),
    });
  });

  const itemCards = items.map((item: SavedItemRow) =>
    savedItemToCard({
      id: item.id,
      refKey: item.refKey,
      contentType: item.contentType,
      contentId: item.contentId,
      label: item.label,
      sublabel: item.sublabel,
      imageUrl: item.imageUrl,
      sourceKind: item.sourceKind,
      sourceReportTitle: item.sourceReportTitle,
      sourceSeason: item.sourceSeason,
      sourceContentLabel: item.sourceContentLabel,
      sourcePath: item.sourcePath,
      createdAt: item.createdAt.toISOString(),
    }),
  );

  return mergeSavedCards([...lookCards, ...itemCards]);
}

/** Ownership-checked delete for a saved look. */
export async function deleteSavedLook(customerId: string, lookId: string): Promise<void> {
  await prisma.savedLook.deleteMany({ where: { id: lookId, customerId } });
}

// ── Save state for a report page ─────────────────────────────────────────────

export interface ReportSaveState {
  /** "TREND:tc_abc" → refKey. Built server-side so the client never derives identity. */
  refKeys: Record<string, string>;
  /** refKeys this customer has actually saved. Empty when signed out. */
  saved: string[];
  /** True when a ♡ can do anything — drives the sign-in affordance. */
  canSave: boolean;
}

/**
 * Every saveable object on a report, with its refKey, plus which of them this
 * customer has saved. State comes from the database on every load, so a refresh
 * shows the real persisted truth rather than remembered client state.
 *
 * customerId is null for an anonymous visitor: the controls still render (the
 * editorial page is public) but nothing is marked saved.
 */
export async function loadReportSaveState(
  customerId: string | null,
  report: {
    id?: string;
    keyTrends?: unknown;
    rising?: unknown;
    fading?: unknown;
    referencesBehindThisEdit?: unknown;
  },
  options: { productHandles?: string[]; takeawaySections?: string[] } = {},
): Promise<ReportSaveState> {
  const refKeys: Record<string, string> = {};
  const reportId = report.id ?? null;

  const addEntries = (field: unknown, contentType: TrendContentType) => {
    if (!Array.isArray(field) || !reportId) return;
    for (const raw of field) {
      const id = (raw as Record<string, unknown>)?.id;
      if (!isContentId(id)) continue;
      refKeys[`${contentType}:${id}`] = buildRefKey({ contentType, contentId: id as string, reportId });
    }
  };

  addEntries(report.keyTrends, "TREND");
  addEntries(report.rising, "SIGNAL");
  addEntries(report.fading, "SIGNAL");
  addEntries(report.referencesBehindThisEdit, "REFERENCE");

  // Global — identity does not include the report it was found in.
  for (const handle of options.productHandles ?? []) {
    refKeys[`PRODUCT:${handle}`] = buildRefKey({ contentType: "PRODUCT", contentId: handle });
  }

  if (reportId) {
    for (const section of options.takeawaySections ?? []) {
      refKeys[`TAKEAWAY:${section}`] = buildRefKey({
        contentType: "TAKEAWAY", contentId: section, reportId,
      });
    }
  }

  if (!customerId) return { refKeys, saved: [], canSave: false };

  const saved = await savedRefKeys(customerId, Object.values(refKeys));
  return { refKeys, saved: [...saved], canSave: true };
}
