// app/lib/trend-closet-connections.server.ts
//
// The server half of Trend ↔ Closet matching: load the customer's resolved
// wardrobe once, then match EACH authored trend against it independently.
//
// Wardrobe Intelligence is the only source of garment truth. This module loads
// it, matches, and shapes the result for display and for the historical
// snapshot. It classifies nothing and infers nothing.
//
// ── WHY NOT getShopperEvidence() ─────────────────────────────────────────────
// That helper caps the closet at the 20 most recent items, which is correct for
// the narrative evidence it feeds and must not change. A count like "6 of your
// pieces connect" has to be true of the WHOLE wardrobe, so this loads the closet
// independently through loadWardrobeIntelligence() and leaves the existing
// evidence model exactly as it is.

import prisma from "../db.server";
import { loadWardrobeIntelligence } from "./ai/wardrobe-intelligence.server";
import type { WardrobePassport } from "./ai/wardrobe-intelligence";
import { matchTrendToCloset, type MatchedGarment } from "./trend-closet-match";
import { isContentId, IDENTITY_BEARING_FIELD_NAMES } from "./trend-content-identity";
import { validateFacets, isEmptyFacets } from "./trend-facets";
import {
  getCloudinaryConfig,
  validatePublicIdOwnership,
  buildPrivateDownloadUrl,
} from "./cloudinary-admin.server";
import type { TrendReportData } from "./trend-reports";

/** A matched piece as displayed and as stored. */
export interface ConnectedPiece {
  garmentId: string;
  name: string | null;
  category: string;
  reason: string;
  /** Re-signed at render time; never stored — signed URLs expire in minutes. */
  imageUrl: string | null;
  /** The asset pinned at generation, so replay shows the photo she saw. */
  imagePublicId: string | null;
  imageFormat: string | null;
}

export interface ClosetConnection {
  /** The stable content id this was matched against. Never a whole report. */
  contentId: string;
  /** Display label for the trend, snapshotted so history reads correctly. */
  label: string;
  matchCount: number;
  pieces: ConnectedPiece[];
}

/** Shown on first expand; the rest stay behind the count. */
const PIECES_KEPT = 6;

function toPassport(profile: Record<string, unknown> | null): WardrobePassport | null {
  if (!profile) return null;
  const arr = (k: string) => (Array.isArray(profile[k]) ? (profile[k] as string[]) : []);
  return {
    lifestyle: arr("lifestyle"),
    favoriteColors: arr("favoriteColors"),
    avoidColors: arr("avoidColors"),
    stylePersonalities: arr("stylePersonalities"),
    silhouette: arr("silhouette"),
    structure: (profile.structure as string | null) ?? null,
    fitPreferences: arr("fitPreferences"),
    styleStruggles: arr("styleStruggles"),
    styleSupport: arr("styleSupport"),
    becoming: arr("becoming"),
  };
}

/** Every authored, matchable content unit in a report — trends and signals. */
function matchableUnits(report: TrendReportData) {
  const units: Array<{ contentId: string; label: string; facets: ReturnType<typeof validateFacets>["facets"] }> = [];
  for (const field of IDENTITY_BEARING_FIELD_NAMES) {
    // Fading signals and brand references are deliberately excluded: owning
    // something a report calls fading is not a connection worth claiming, and a
    // brand is not a garment attribute.
    if (field === "fading" || field === "referencesBehindThisEdit") continue;
    const entries = (report as unknown as Record<string, unknown>)[field];
    if (!Array.isArray(entries)) continue;
    for (const raw of entries) {
      const entry = raw as Record<string, unknown>;
      if (!isContentId(entry.id)) continue;
      const { facets } = validateFacets(entry.facets);
      if (isEmptyFacets(facets)) continue;
      units.push({
        contentId: entry.id as string,
        label: String(entry.name ?? entry.signal ?? ""),
        facets,
      });
    }
  }
  return units;
}

/**
 * Match every authored trend in one report against the customer's full closet.
 *
 * Returns only connections that have at least one qualifying piece — a trend
 * with none simply shows nothing, because "0 pieces connect" is a claim too.
 */
export async function loadTrendClosetConnections(
  customerId: string,
  report: TrendReportData,
): Promise<ClosetConnection[]> {
  const units = matchableUnits(report);
  if (units.length === 0) return [];

  const rows: Array<{ id: string; imageUrl: string | null; imagePublicId: string | null; imageFormat: string | null }> =
    await prisma.closetItem.findMany({
      where: { customerId },
      select: { id: true, imageUrl: true, imagePublicId: true, imageFormat: true },
    });
  if (rows.length === 0) return [];

  const cfg = getCloudinaryConfig();
  const imageUrlById = new Map<string, string | null>();
  const assetById = new Map<string, { publicId: string | null; format: string | null }>();

  for (const row of rows) {
    let url: string | null = null;
    if (row.imagePublicId && row.imageFormat && cfg && validatePublicIdOwnership(row.imagePublicId, customerId).ok) {
      url = buildPrivateDownloadUrl(cfg, row.imagePublicId, row.imageFormat, "private");
    }
    imageUrlById.set(row.id, url ?? row.imageUrl ?? null);
    assetById.set(row.id, { publicId: row.imagePublicId ?? null, format: row.imageFormat ?? null });
  }

  const profile: Record<string, unknown> | null = await prisma.onboardingProfile.findUnique({
    where: { customerId },
  });

  const { garments } = await loadWardrobeIntelligence(customerId, {
    imageUrlById,
    passport: toPassport(profile),
    // Derived V2 intention intelligence stays gated; nothing here depends on it.
    flags: { derivedIntentionIntelligence: process.env.WARDROBE_V2_INTENTIONS === "true" },
  });

  const connections: ClosetConnection[] = [];
  for (const unit of units) {
    const result = matchTrendToCloset({ contentId: unit.contentId, facets: unit.facets, garments });
    if (!result.available || result.matchCount === 0) continue;

    connections.push({
      contentId: unit.contentId,
      label: unit.label,
      matchCount: result.matchCount,
      pieces: result.matches.slice(0, PIECES_KEPT).map((m: MatchedGarment) => {
        const asset = assetById.get(m.garmentId);
        return {
          garmentId: m.garmentId,
          name: m.name,
          category: m.category,
          reason: m.reason,
          imageUrl: m.imageUrl,
          imagePublicId: asset?.publicId ?? null,
          imageFormat: asset?.format ?? null,
        };
      }),
    });
  }

  return connections;
}
