// app/lib/ai/styleme-anchor.server.ts
// Resolves session anchor selections into typed engine inputs.
// resolveNadineAnchor: pure catalog lookup — no DB access.
// resolveClosetAnchor: DB-backed lookup with ownership check.
// resolveActionAnchor: validates source + anchor combination, returns typed result.
// scoreClosetItemForSession: pure signal-based scoring of a single Closet item.
// autoSelectClosetAnchor: DB-backed; ranks all items and returns the strongest anchor.

import { getAllCatalogProducts } from "./naia-catalog.js";
import type { NadineAnchorInput, ClosetAnchorInput, AnchorInput } from "./styleme-recommendation.types.js";
import prisma from "../../db.server.js";
import { buildPrivateDownloadUrl, getCloudinaryConfig } from "../../lib/cloudinary-admin.server.js";
import { matchesSessionOccasion } from "./styleme-occasion-tokens.js";

const VALID_HANDLES = new Set(getAllCatalogProducts().map((p) => p.handle));

/**
 * Returns a NadineAnchorInput for the given handle, or null if the handle
 * is not in the V8 catalog. Pure function — no DB access.
 */
export function resolveNadineAnchor(handle: string): NadineAnchorInput | null {
  if (!handle || !VALID_HANDLES.has(handle)) return null;
  return { type: "nadine", handle };
}

/**
 * Loads a ClosetItem by ID and verifies it belongs to customerId.
 * Returns a ClosetAnchorInput on success, null if not found or unauthorized.
 */
export async function resolveClosetAnchor(
  customerId: string,
  closetItemId: string,
): Promise<ClosetAnchorInput | null> {
  if (!closetItemId || !customerId) return null;

  const item = await prisma.closetItem.findFirst({
    where: { id: closetItemId, customerId },
  });

  if (!item) return null;

  // Resolve image URL: prefer signed private URL for private-upload items.
  let imageUrl = item.imageUrl;
  if (item.imagePublicId && item.imageFormat) {
    const cfg = getCloudinaryConfig();
    if (cfg) {
      imageUrl = buildPrivateDownloadUrl(cfg, item.imagePublicId, item.imageFormat, "private");
    }
  }

  return {
    type: "closet",
    id: item.id,
    name: item.name ?? null,
    category: item.category,
    subcategory: item.subcategory ?? null,
    colors: item.colors,
    primaryColor: item.primaryColor ?? null,
    pattern: item.pattern ?? null,
    material: item.material ?? null,
    styleTags: item.styleTags,
    occasions: item.occasions,
    imageUrl,
  };
}

// ── Typed result for action-level anchor resolution ──────────────────────────

// anchor is null when source is "naia-piece" and no explicit handle was supplied:
// the engine auto-selects the best NADINE product from session signals.
export type AnchorResolutionOk = { ok: true; anchor: AnchorInput | null };
export type AnchorResolutionErr = { ok: false; status: 400 | 403; message: string };
export type AnchorResolution = AnchorResolutionOk | AnchorResolutionErr;

/**
 * Validates that the source/anchor combination is legal and resolves the anchor.
 *
 * - naia-piece: nadineHandle is required and must be a valid V8 catalog handle.
 *   Missing or unknown handle → 400. Never allows anchor=null.
 * - my-closet / both: closetItemId is required (→ 400 if absent) and must be owned by
 *   customerId (→ 403 if the resolver returns null).
 *
 * resolveCloset defaults to the real DB-backed resolveClosetAnchor.
 * Tests inject a fake resolver to cover unknown/foreign cases without a live DB.
 */
export async function resolveActionAnchor(
  source: "naia-piece" | "my-closet" | "both",
  customerId: string,
  nadineHandle: string | null,
  closetItemId: string | null,
  resolveCloset: (
    customerId: string,
    closetItemId: string,
  ) => Promise<ClosetAnchorInput | null> = resolveClosetAnchor,
): Promise<AnchorResolution> {
  if (source === "naia-piece") {
    // No handle supplied: engine auto-selects the best NADINE piece from session signals.
    // An explicit handle (future "Style This Piece" entry points) is still resolved normally.
    if (!nadineHandle) {
      return { ok: true, anchor: null };
    }
    const anchor = resolveNadineAnchor(nadineHandle);
    if (!anchor) {
      return { ok: false, status: 400, message: "Selected product is not available." };
    }
    return { ok: true, anchor };
  }

  // my-closet or both — closet anchor is mandatory
  if (!closetItemId) {
    return { ok: false, status: 400, message: "A closet item must be selected for this source." };
  }

  const anchor = await resolveCloset(customerId, closetItemId);
  if (!anchor) {
    return { ok: false, status: 403, message: "Closet item not found or access denied." };
  }

  return { ok: true, anchor };
}

// ── Auto Closet anchor selection ─────────────────────────────────────────────
// Ranks the customer's Closet items against the current StyleMe session signals
// and returns the strongest anchor candidate.
//
// Scoring (additive, higher = better):
//  +10  if item.occasions includes the session occasion (strong contextual match)
//  +3   per mood token that appears in item.styleTags
//  +2   per desired-feeling token that appears in item.styleTags
//
// Category is NOT a scored signal — it is used only as a sort tiebreaker in
// autoSelectClosetAnchor so anchor-capable garments (TOPS/BOTTOMS/DRESSES/OUTERWEAR)
// beat accessories when signal scores are equal.
//
// Explicit session signals (occasion, mood, feeling) outrank all profile background —
// no Passport profile signals are used here.
// Ties broken by: anchor-capable category first, then recency (createdAt DESC).

export const ANCHOR_CAPABLE_CATEGORIES = new Set(["TOPS", "BOTTOMS", "DRESSES", "OUTERWEAR"]);

export type ClosetScoringProfile = {
  favoriteColors?: string[] | null;
  avoidColors?: string[] | null;
  stylePersonalities?: string[] | null;
  dressingPreferences?: readonly string[] | null;
};

/**
 * Scores a single Closet item against the current StyleMe session signals,
 * optional Passport profile, and optional garment relationship evidence.
 *
 * Scoring tiers:
 *   Session signals  — strongest (occasion match +10, mood/feeling +3/+2)
 *   Passport profile — colour/personality bonuses (+2/+1), avoid-colour penalty (-4)
 *   Relationships    — soft supporting evidence only; never overrides Passport truth
 *     favourite / wear-often → +2
 *     regret                 → -4
 *     rarely-wear            → -2
 *     everything else        → 0 (neutral — love-style-struggle, like, unsure, occasion-only)
 */
export function scoreClosetItemForSession(
  item: { occasions: string[]; styleTags: string[]; category: string; colors?: string[]; primaryColor?: string | null },
  signals: { occasion: string; moods: string[]; desiredFeelings: string[] },
  profile?: ClosetScoringProfile | null,
  relationships?: string[] | null,
): number {
  let score = 0;

  if (matchesSessionOccasion(item.occasions, signals.occasion)) score += 10;

  for (const mood of signals.moods) {
    if (item.styleTags.includes(mood)) score += 3;
  }

  for (const feeling of signals.desiredFeelings) {
    if (item.styleTags.includes(feeling)) score += 2;
  }

  // ── Passport profile signals ──────────────────────────────────────────────
  if (profile) {
    const itemColors = [
      ...(item.colors ?? []).map((c) => c.toLowerCase()),
      ...(item.primaryColor ? [item.primaryColor.toLowerCase()] : []),
    ];

    if (profile.favoriteColors?.length && itemColors.length) {
      const favLower = profile.favoriteColors.map((c) => c.toLowerCase());
      if (itemColors.some((c) => favLower.includes(c))) score += 2;
    }

    if (profile.avoidColors?.length && itemColors.length) {
      const avoidLower = profile.avoidColors.map((c) => c.toLowerCase());
      if (itemColors.some((c) => avoidLower.includes(c))) score -= 4;
    }

    if (profile.stylePersonalities?.length) {
      const personalityLower = profile.stylePersonalities.map((p) => p.toLowerCase());
      for (const tag of item.styleTags) {
        if (personalityLower.some((p) => tag.toLowerCase().includes(p))) {
          score += 1;
          break;
        }
      }
    }
  }

  // ── Garment relationship evidence (soft) ──────────────────────────────────
  if (relationships?.length) {
    if (relationships.includes("favourite") || relationships.includes("wear-often")) score += 2;
    if (relationships.includes("regret")) score -= 4;
    else if (relationships.includes("rarely-wear")) score -= 2;
    // love-style-struggle / like / unsure → neutral (0)
    // occasion-only: soft downrank for routine/casual sessions — not a hard block
    if (relationships.includes("occasion-only") &&
        (signals.occasion === "everyday" || signals.occasion === "travel")) {
      score -= 2;
    }
  }

  return score;
}

/**
 * Loads all Closet items for the customer (up to 50, newest-first) and returns
 * them as ClosetAnchorInput[], resolving signed image URLs where needed.
 * Used by computeStyleMeResult for the multi-item Closet scan.
 */
export async function loadAllClosetItemsForEngine(
  customerId: string,
): Promise<ClosetAnchorInput[]> {
  const items = await prisma.closetItem.findMany({
    where: { customerId },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { styleMeProfile: true },
  });

  type ClosetDbItem = (typeof items)[number];
  const cfg = getCloudinaryConfig();
  return items.map((item: ClosetDbItem) => {
    let imageUrl = item.imageUrl;
    if (cfg && item.imagePublicId && item.imageFormat) {
      imageUrl = buildPrivateDownloadUrl(cfg, item.imagePublicId, item.imageFormat, "private");
    }
    const p = item.styleMeProfile;
    const approvedProfile =
      p?.profileStatus === "approved"
        ? {
            exactSlot: p.exactSlot,
            outfitFunction: p.outfitFunction,
            dressRegister: p.dressRegister,
            fabricBehaviour: p.fabricBehaviour,
            silhouetteCharacter: p.silhouetteCharacter,
            visualWeight: p.visualWeight,
            construction: p.construction,
            stylingEffort: p.stylingEffort,
            layeringBehaviour: p.layeringBehaviour,
            waistComfort: p.waistComfort,
            statementLevel: p.statementLevel,
            occasionFit: (p.occasionFit as Record<string, string> | null) ?? null,
            intentionPotentials: (p.intentionPotentials as Record<string, string> | null) ?? null,
            naturalPairings: p.naturalPairings,
            intentionalMix: p.intentionalMix,
            avoidInStyleMe: p.avoidInStyleMe,
          }
        : null;
    return {
      type: "closet" as const,
      id: item.id,
      name: item.name ?? null,
      category: item.category,
      subcategory: item.subcategory ?? null,
      colors: item.colors,
      primaryColor: item.primaryColor ?? null,
      pattern: item.pattern ?? null,
      material: item.material ?? null,
      styleTags: item.styleTags,
      occasions: item.occasions,
      imageUrl,
      garmentRelationships: item.garmentRelationships,
      formality: item.formality ?? null,
      // Garment Intelligence fields
      fitProfile: item.fitProfile ?? null,
      waistShape: item.waistShape ?? null,
      sleeveLength: item.sleeveLength ?? null,
      necklineCoverage: item.necklineCoverage ?? null,
      hemLength: item.hemLength ?? null,
      topLength: item.topLength ?? null,
      shoulderCoverage: item.shoulderCoverage ?? null,
      midriffExposed: item.midriffExposed ?? null,
      silhouette: item.silhouette ?? null,
      stylePersonality: item.stylePersonality ?? null,
      // Approved StyleMe profile (null = no profile; legacy heuristics apply)
      approvedProfile,
    };
  });
}

/**
 * Loads all Closet items for the customer (up to 50, newest-first), scores each
 * against the session signals, and returns the highest-scoring item as a
 * ClosetAnchorInput plus its raw DB id.
 *
 * Returns null when the customer has no Closet items or no item that explicitly
 * serves the requested occasion (mood/relationship bonuses alone are not enough).
 * Never selects by array order or at random — every item is explicitly scored
 * and the winner is deterministic for a given set of signals.
 *
 * _fetchItems is a DI seam for testing — omit in production (defaults to Prisma).
 */
export type AutoSelectItem = {
  id: string;
  name: string | null;
  category: string;
  subcategory: string | null;
  colors: string[];
  primaryColor: string | null;
  pattern: string | null;
  material: string | null;
  styleTags: string[];
  occasions: string[];
  imageUrl: string | null;
  garmentRelationships: string[];
  formality: string | null;
};

// Inline formality rank — mirrors FORMALITY_RANK in result.server.ts.
// Kept here to avoid a circular dependency (anchor → result → anchor).
const _FORMALITY_RANK: Record<string, number> = {
  casual: 1, "smart-casual": 2, "business-casual": 3,
  "business-formal": 4, occasion: 5, evening: 6,
};

// Maximum formality rank appropriate for an occasion when a formalityConditional is given.
// Used to soft-penalise over-dressed anchors at auto-select time.
const _OCCASION_MAX_RANK: Record<string, number> = {
  everyday: 2, "work-office": 3, "casual-social": 2, "dinner-out": 4,
  "going-out": 4, "formal-event": 6, "active-busy-day": 2,
};

export async function autoSelectClosetAnchor(
  customerId: string,
  signals: { occasion: string; moods: string[]; desiredFeelings: string[]; formalityConditional?: string | null },
  _fetchItems?: (customerId: string) => Promise<AutoSelectItem[]>,
): Promise<{ anchor: ClosetAnchorInput; id: string } | null> {
  const items: AutoSelectItem[] = _fetchItems
    ? await _fetchItems(customerId)
    : await prisma.closetItem.findMany({
        where: { customerId },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true, name: true, category: true, subcategory: true,
          colors: true, primaryColor: true, pattern: true, material: true,
          styleTags: true, occasions: true, imageUrl: true,
          garmentRelationships: true, formality: true,
        },
      }) as AutoSelectItem[];

  if (items.length === 0) return null;

  // Formality tier sort: items whose formality is within the occasion ceiling (tier 0)
  // always sort before items known to be out of range (tier 1), regardless of signal scores.
  // Unknown formality (null) is treated as in-range (tier 0) — fail-open.
  // formalityConditional "formality-dressy" raises the ceiling by 2 ranks.
  const targetMaxRank = _OCCASION_MAX_RANK[signals.occasion] ?? 3;
  const formalityBoost = signals.formalityConditional === "formality-dressy" ? 2 : 0;
  const effectiveMaxRank = Math.min(6, targetMaxRank + formalityBoost);
  const isFormallyInRange = (item: AutoSelectItem): boolean => {
    if (!item.formality) return true; // unknown → in-range (fail-open)
    const rank = _FORMALITY_RANK[item.formality] ?? 0;
    return rank <= effectiveMaxRank;
  };

  type ScoredItem = { item: AutoSelectItem; score: number; isAnchorCapable: boolean; inRange: boolean };

  const mapped: ScoredItem[] = items.map((item) => ({
    item,
    score: scoreClosetItemForSession(
      { occasions: item.occasions, styleTags: item.styleTags, category: item.category },
      signals,
      undefined,
      item.garmentRelationships,
    ),
    isAnchorCapable: ANCHOR_CAPABLE_CATEGORIES.has(item.category),
    inRange: isFormallyInRange(item),
  }));

  const scored = mapped.sort((a, b) => {
    // Tier 0 (in-range formality) always beats Tier 1 (known out-of-range)
    if (a.inRange !== b.inRange) return a.inRange ? -1 : 1;
    if (b.score !== a.score) return b.score - a.score;
    // Tiebreaker: prefer garments that can anchor an outfit
    if (a.isAnchorCapable !== b.isAnchorCapable) return a.isAnchorCapable ? -1 : 1;
    // Final tiebreaker: recency — preserved by stable sort over createdAt DESC fetch order
    return 0;
  });

  // Walk candidates in score order and return the first that is occasion-compatible.
  // Incompatibility requires explicit evidence: the item has occasion tags for OTHER
  // occasions AND the customer tagged it as occasion-only.
  // Items with no occasion tags at all are treated as versatile (incomplete metadata,
  // not a block). A higher-scoring incompatible item must not prevent a lower-scoring
  // compatible item from being selected.
  const isOccasionCompatible = (item: AutoSelectItem): boolean =>
    matchesSessionOccasion(item.occasions, signals.occasion)  // normalized match
    || item.occasions.length === 0                            // no tags → versatile
    || !item.garmentRelationships.includes("occasion-only");  // other-occasion tags, no restriction

  const winnerEntry = scored.find(s => s.score > 0 && isOccasionCompatible(s.item));
  if (!winnerEntry) return null;

  const winner = winnerEntry.item;
  return {
    anchor: {
      type: "closet",
      id: winner.id,
      name: winner.name ?? null,
      category: winner.category,
      subcategory: winner.subcategory ?? null,
      colors: winner.colors,
      primaryColor: winner.primaryColor ?? null,
      pattern: winner.pattern ?? null,
      material: winner.material ?? null,
      styleTags: winner.styleTags,
      occasions: winner.occasions,
      imageUrl: winner.imageUrl ?? "",
    },
    id: winner.id,
  };
}

// ── TODAY body-need deterministic scoring ─────────────────────────────────────

type GarmentForBodyNeed = Pick<
  ClosetAnchorInput,
  | "fitProfile"
  | "waistShape"
  | "sleeveLength"
  | "necklineCoverage"
  | "hemLength"
  | "shoulderCoverage"
  | "midriffExposed"
  | "styleTags"
  | "silhouette"
  | "approvedProfile"
>;

/**
 * Scores a single Closet item against one canonical Rev3 body-need ID.
 * Returns { violation: boolean; fitScore: number | null }.
 * violation=true only when metadata EXPLICITLY demonstrates the avoided condition.
 * Unknown metadata NEVER creates a violation.
 * softer-easier-fabrics has no deterministic score (prompt-guided only).
 */
export function scoreBodyNeedForClosetItem(
  need: string,
  item: GarmentForBodyNeed,
): { violation: boolean; fitScore: number | null } {
  const fp = item.fitProfile ?? null;
  const ws = item.waistShape ?? null;

  const RELAXED_FITS = new Set(["relaxed", "loose", "oversized", "flowy"]);
  const SHAPED_FITS = new Set(["tailored", "structured", "body-skimming"]);
  const STRUCTURED_FITS = new Set(["structured", "tailored"]);
  const TIGHT_FITS = new Set(["fitted", "body-skimming"]);

  switch (need) {
    case "nothing-tight-waist": {
      // waistComfort from approved profile is the authoritative waistband signal.
      // fabric stretch (fabricBehaviour) must NOT imply waistband stretch.
      const wc = item.approvedProfile?.waistComfort ?? null;
      if (wc === "N/A") {
        // Not applicable (top, shoe, etc.) — piece has no waistband, neutral
        return { violation: false, fitScore: null };
      }
      if (wc === "elastic" || wc === "stretch" || wc === "drawstring") {
        return { violation: false, fitScore: 1 };
      }
      if (wc === "fixed") {
        // Structured waistband — not tight by default but not elasticated comfort
        return { violation: false, fitScore: 0.3 };
      }
      if (wc === "restrictive") {
        // Tight/constricting waistband — negative signal for this body need
        return { violation: false, fitScore: 0.1 };
      }
      if (wc === "unknown") {
        // No information — treat as unknown, neutral
        return { violation: false, fitScore: null };
      }
      // wc is null (profile present but waistComfort not set) — fall through to legacy signals
      // No approved waistComfort — fall through to legacy fitProfile/waistShape signals
      if (fp !== null && TIGHT_FITS.has(fp)) return { violation: true, fitScore: 0 };
      if (ws === "elasticated" || ws === "drawstring") return { violation: false, fitScore: 1 };
      if (fp !== null && RELAXED_FITS.has(fp)) return { violation: false, fitScore: 0.8 };
      return { violation: false, fitScore: fp === null && ws === null ? null : 0.5 };
    }

    case "less-body-conscious": {
      if (fp !== null && TIGHT_FITS.has(fp)) return { violation: true, fitScore: 0 };
      if (fp !== null && RELAXED_FITS.has(fp)) return { violation: false, fitScore: 1 };
      if (fp !== null && (fp === "tailored" || fp === "structured")) return { violation: false, fitScore: 0.5 };
      return { violation: false, fitScore: fp === null ? null : 0.5 };
    }

    case "loose-comfortable": {
      if (fp !== null && RELAXED_FITS.has(fp)) return { violation: false, fitScore: 1 };
      if (fp !== null && (fp === "tailored" || fp === "structured")) return { violation: false, fitScore: 0.3 };
      if (fp !== null && TIGHT_FITS.has(fp)) return { violation: false, fitScore: 0 };
      return { violation: false, fitScore: fp === null ? null : 0.3 };
    }

    case "more-coverage": {
      let violationSignals = 0;
      let positiveSignals = 0;
      const sl = item.sleeveLength ?? null;
      const nc = item.necklineCoverage ?? null;
      const hl = item.hemLength ?? null;
      const sc = item.shoulderCoverage ?? null;
      const me = item.midriffExposed ?? null;

      if (sl === "sleeveless") violationSignals++;
      else if (sl === "full" || sl === "three-quarter") positiveSignals++;
      if (nc === "low" || nc === "off-shoulder" || nc === "wrap-variable") violationSignals++;
      else if (nc === "high" || nc === "crew" || nc === "mock" || nc === "cowl-high") positiveSignals++;
      if (hl === "mini") violationSignals++;
      else if (hl === "maxi" || hl === "full") positiveSignals++;
      if (sc === false) violationSignals++;
      else if (sc === true) positiveSignals++;
      if (me === true) violationSignals++;
      else if (me === false) positiveSignals++;

      const totalSignals =
        (sl !== null && sl !== "n/a" ? 1 : 0) +
        (nc !== null && nc !== "n/a" ? 1 : 0) +
        (hl !== null && hl !== "n/a" ? 1 : 0) +
        (sc !== null ? 1 : 0) +
        (me !== null ? 1 : 0);

      if (totalSignals === 0) return { violation: false, fitScore: null };
      if (violationSignals > 0) return { violation: true, fitScore: Math.max(0, (positiveSignals - violationSignals) / totalSignals) };
      return { violation: false, fitScore: positiveSignals / totalSignals };
    }

    case "softer-easier-fabrics": {
      // fabricBehaviour from approved profile uses the locked taxonomy: soft|fluid|crisp|rigid|stretch|sculptural|N/A
      const fb = item.approvedProfile?.fabricBehaviour ?? [];
      if (fb.some((f) => ["soft", "fluid", "stretch"].includes(f))) return { violation: false, fitScore: 0.8 };
      if (fb.some((f) => ["rigid", "crisp", "sculptural"].includes(f))) return { violation: false, fitScore: 0.2 };
      return { violation: false, fitScore: fb.length > 0 ? 0.5 : null };
    }

    case "still-want-shape": {
      // construction from approved profile is authoritative for shape — fitProfile="fitted" must NOT substitute.
      // The existing SHAPED_FITS check already excludes "fitted" (correct); construction adds precision.
      const construction = item.approvedProfile?.construction ?? null;
      if (construction === "structured") return { violation: false, fitScore: 1 };
      if (construction === "semi-structured") return { violation: false, fitScore: 0.75 };
      if (construction === "soft") return { violation: false, fitScore: 0.2 };
      // Fallback to existing fitProfile-based scoring when no approved construction
      if (fp !== null && SHAPED_FITS.has(fp)) return { violation: false, fitScore: 1 };
      if (fp !== null && (fp === "loose" || fp === "oversized")) return { violation: false, fitScore: 0.2 };
      if (fp !== null && (fp === "relaxed" || fp === "flowy")) return { violation: false, fitScore: 0.4 };
      return { violation: false, fitScore: fp === null ? null : 0.5 };
    }

    case "waist-definition": {
      if (ws === "belted") return { violation: false, fitScore: 1 };
      if (fp === "body-skimming") return { violation: false, fitScore: 0.7 };
      if (ws === null && fp === null) return { violation: false, fitScore: null };
      return { violation: false, fitScore: 0.3 };
    }

    case "structured-shape": {
      if (fp !== null && STRUCTURED_FITS.has(fp)) return { violation: false, fitScore: 1 };
      if ((item.styleTags ?? []).includes("structured") || (item.styleTags ?? []).includes("tailored")) {
        return { violation: false, fitScore: 0.8 };
      }
      return { violation: false, fitScore: fp === null ? null : 0.2 };
    }

    default:
      return { violation: false, fitScore: null };
  }
}

/**
 * Computes raw energy potential for a Closet item (0–3 scale).
 * Evidence: A. expressive style tags (+1), B. non-solid pattern (+1),
 * C. flowy fitProfile or movement silhouette (+1).
 * No colour count, no gender logic.
 */
export function computeEnergyPotential(
  item: Pick<ClosetAnchorInput, "styleTags" | "pattern" | "fitProfile" | "silhouette">,
): number {
  const EXPRESSIVE_TAGS = new Set([
    "bold", "statement", "artsy", "creative", "eclectic", "playful", "trendy", "contemporary",
  ]);
  const MOVEMENT_SILHOUETTES = new Set(["flared", "balloon", "asymmetric"]);
  let e = 0;
  if ((item.styleTags ?? []).some((t) => EXPRESSIVE_TAGS.has(t))) e++;
  if (item.pattern !== null && item.pattern !== "solid") e++;
  if (
    item.fitProfile === "flowy" ||
    (item.silhouette !== null && item.silhouette !== undefined && MOVEMENT_SILHOUETTES.has(item.silhouette))
  ) e++;
  return e;
}
