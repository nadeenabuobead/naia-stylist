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
import { buildPrivateDownloadUrl, getCloudinaryConfig, validateImageUrlOwnership } from "../../lib/cloudinary-admin.server.js";
import { matchesSessionOccasion } from "./styleme-occasion-tokens.js";
import { passesDressingRequirements, evaluateAnchorEligibility, canSlotAnchorOutfit, getTargetFormalityRange, FORMALITY_CONDITIONAL_ADJUSTMENTS, profileOccasionRating } from "./styleme-profile-gate.js";
import { closetItemToSlot } from "./closet-slot.js";
import { getEffectiveClosetItem, type ClosetItemFields } from "../admin/closet-review.server.js";

// Garment Intelligence Phase 4A — narrowly scoped rollback switch for the
// first live canonical-field migration (colour only). OFF = exactly
// today's raw ClosetItem.primaryColor/colors reads. ON = the same
// admin-override-aware effective value WI already uses, via
// getEffectiveClosetItem() — not the full resolveGarment()/ResolvedGarment
// pipeline, which also runs garment-intelligence-v1 derivation that
// colour never needed. getEffectiveClosetItem is the one authoritative
// precedence implementation (admin override > raw); this reuses it
// directly rather than duplicating the merge or requiring every caller to
// carry all 28 ResolvedGarment fields for a two-field need.
const CANONICAL_STYLEME_COLOUR = process.env.CANONICAL_STYLEME_COLOUR === "true";

/**
 * Pure decision logic, exported so it can be tested directly without any
 * process.env manipulation or DB access. The flag itself is read once at
 * module load (above) and passed in explicitly here — this function never
 * reads process.env itself, so a test can exercise both branches against
 * the identical module instance.
 *
 * OFF: byte-identical to item.colors/item.primaryColor — zero behavior
 * change. ON: the same admin-override-aware merge WI already uses
 * (getEffectiveClosetItem), projected down to only the two colour fields.
 */
export function resolveEngineColour(
  item: ClosetItemFields,
  adminReview: { reviewStatus: string; overrides: unknown } | null | undefined,
  canonicalEnabled: boolean,
): { colors: string[]; primaryColor: string | null } {
  if (!canonicalEnabled) return { colors: item.colors, primaryColor: item.primaryColor };
  const effective = getEffectiveClosetItem(item, adminReview);
  return { colors: effective.colors, primaryColor: effective.primaryColor };
}

// Garment Intelligence Phase 4B — computes the canonical/effective formality
// value for every garment, UNCONDITIONALLY (no flag here). This coexists
// alongside the raw `formality` field on ClosetAnchorInput rather than
// replacing it — autoSelectClosetAnchor (anchor selection) is explicitly
// excluded from Phase 4B and must keep reading the unchanged raw `formality`
// field. The Phase-4B flag is applied at the single T2 read-site in
// styleme-result.server.ts (resolveT2Formality), which chooses between the
// two coexisting fields — never here. Reuses getEffectiveClosetItem, the
// same authoritative precedence logic ResolvedGarment.formality itself is a
// pure pass-through of — not a second, independent precedence implementation.
export function resolveEffectiveFormality(
  item: ClosetItemFields,
  adminReview: { reviewStatus: string; overrides: unknown } | null | undefined,
): string | null {
  return getEffectiveClosetItem(item, adminReview).formality ?? null;
}

// Garment Intelligence Phase 4C1 — computes canonical/effective hemLength and
// topLength for every garment, UNCONDITIONALLY (no flag here). Coexists
// alongside the raw hemLength/topLength fields on ClosetAnchorInput rather
// than replacing them — scoreBodyNeedForClosetItem("more-coverage") (T3a/T3b
// ranking) must keep reading raw hemLength; autoSelectClosetAnchor doesn't
// read either field at all. The Phase-4C1 flag is applied only inside
// passesDressingRequirements's hard gate (styleme-result.server.ts,
// resolveGateLength), which chooses between the two coexisting fields —
// never here. Reuses getEffectiveClosetItem, the same authoritative
// precedence logic ResolvedGarment.hemLength/topLength are themselves a pure
// pass-through of — not a second, independent precedence implementation.
export function resolveEffectiveLength(
  item: ClosetItemFields,
  adminReview: { reviewStatus: string; overrides: unknown } | null | undefined,
): { hemLength: string | null; topLength: string | null } {
  const effective = getEffectiveClosetItem(item, adminReview);
  return { hemLength: effective.hemLength ?? null, topLength: effective.topLength ?? null };
}

// Garment Intelligence Phase 4K1 — computes canonical/effective occasions for
// every garment, UNCONDITIONALLY (no flag here). Coexists alongside the raw
// `occasions` field on ClosetAnchorInput rather than replacing it —
// autoSelectClosetAnchor doesn't read this field at all, and keeps reading
// raw `occasions` exactly as before. The Phase 4K1 flag is applied only
// inside computeOccasionTier's legacy-fallback branches (styleme-result.server.ts),
// which choose between the two coexisting fields — never here. Reuses
// getEffectiveClosetItem, the same authoritative precedence logic every
// other effective field in this file is itself a pure pass-through of — not
// a second, independent precedence implementation.
export function resolveEffectiveOccasions(
  item: ClosetItemFields,
  adminReview: { reviewStatus: string; overrides: unknown } | null | undefined,
): string[] {
  return getEffectiveClosetItem(item, adminReview).occasions ?? [];
}

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
  let imageUrl = item.imageUrl && validateImageUrlOwnership(item.imageUrl, customerId) ? item.imageUrl : null;
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

// DEPRECATED as the anchoring rule. Kept only because it is exported.
//
// It was the wrong abstraction: a fixed category allowlist cannot express "structural
// garment vs finishing accessory". ACTIVEWEAR, LOUNGEWEAR and SETS are absent from it,
// yet closetItemToSlot resolves them to real top / bottom / outerwear / set slots. Using
// it as a hard gate removed every activewear garment from the anchor pool, which emptied
// Active / busy day sessions entirely — the one occasion whose valid wardrobe lives in
// those categories. Use isStructuralAnchorCandidate() instead.
export const ANCHOR_CAPABLE_CATEGORIES = new Set(["TOPS", "BOTTOMS", "DRESSES", "OUTERWEAR"]);

/**
 * Can this garment carry an outfit?
 *
 * Decided on the RESOLVED slot, through the same closetItemToSlot mapping the rest of
 * the engine uses — so any category that resolves to a structural slot qualifies, and
 * no second allowlist has to be maintained alongside it. Shoes, bags, accessories and
 * jewellery resolve to finishing slots and never qualify; SWIMWEAR and OTHER resolve to
 * "unknown" and are likewise excluded.
 */
function isStructuralAnchorCandidate(item: { category: string; subcategory?: string | null }): boolean {
  return canSlotAnchorOutfit(closetItemToSlot(item.category, item.subcategory ?? null));
}

export type ClosetScoringProfile = {
  favoriteColors?: string[] | null;
  avoidColors?: string[] | null;
  /** Legacy style field. Still the source of truth for pre-Rev 7 customers. */
  stylePersonalities?: string[] | null;
  /**
   * Rev 7 styleDirections projected onto V3 archetype tokens. When present it
   * supersedes stylePersonalities — a Rev 7 customer's stored stylePersonalities
   * is stale legacy data that the Rev 7 flow never rewrites.
   */
  styleDirectionArchetypes?: string[] | null;
  dressingPreferences?: readonly string[] | null;
};

/**
 * Does a closet item's styleTag correspond to a style archetype?
 *
 * The previous check was `tag.includes(archetypeId)` — a raw substring test. It
 * happened to work for single-word V2 IDs ("minimal" matches the tag "minimalist")
 * but could never match a hyphenated V3/Rev 7 ID: no closet styleTag is literally
 * spelled "classic-polished". Every modern customer therefore lost this signal.
 *
 * Archetype IDs are compound ("classic-polished", "bold-edgy"), so each component
 * word is matched against the tag's own words. Word-level matching, not substring:
 * the tag "boldly" must not match "bold".
 */
export function styleTagMatchesArchetype(tag: string, archetypeId: string): boolean {
  const normalisedTag = tag.toLowerCase().trim();
  const archetype = archetypeId.toLowerCase().trim();
  if (!normalisedTag || !archetype) return false;
  if (normalisedTag === archetype) return true;

  const tagWords = new Set(normalisedTag.split(/[^a-z0-9]+/).filter(Boolean));
  // Legacy behaviour retained: a single-word archetype still matches a tag that
  // extends it ("minimal" → "minimalist"), which existing customers rely on.
  return archetype.split("-").filter(Boolean).some(
    (word) => tagWords.has(word) || [...tagWords].some((t) => t.startsWith(word)),
  );
}

/**
 * Archetype tokens the legacy numeric style scorer should use for a profile.
 * Carries no weight of its own — it only decides which stored array is read.
 */
export function scoringArchetypesFor(
  profile: ClosetScoringProfile | null | undefined,
): string[] {
  const projected = profile?.styleDirectionArchetypes ?? [];
  if (projected.length > 0) return [...projected];
  return [...(profile?.stylePersonalities ?? [])];
}

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

    const scoringArchetypes = scoringArchetypesFor(profile);
    if (scoringArchetypes.length) {
      for (const tag of item.styleTags) {
        if (scoringArchetypes.some((p) => styleTagMatchesArchetype(tag, p))) {
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
    include: { styleMeProfile: true, adminReview: true },
  });

  type ClosetDbItem = (typeof items)[number];
  const cfg = getCloudinaryConfig();
  return items.map((item: ClosetDbItem) => {
    let imageUrl = item.imageUrl && validateImageUrlOwnership(item.imageUrl, customerId) ? item.imageUrl : null;
    if (cfg && item.imagePublicId && item.imageFormat) {
      imageUrl = buildPrivateDownloadUrl(cfg, item.imagePublicId, item.imageFormat, "private");
    }
    // Phase 4A: colour only. See resolveEngineColour's own doc for the OFF/ON contract.
    const engineColour = resolveEngineColour(item, item.adminReview, CANONICAL_STYLEME_COLOUR);
    // Phase 4B: formality only. Computed unconditionally — coexists with raw
    // `formality` below rather than replacing it. See resolveEffectiveFormality's
    // own doc; the flag is applied only at T2's read-site, not here.
    const effectiveFormality = resolveEffectiveFormality(item, item.adminReview);
    // Phase 4C1: hemLength/topLength only, for the hard legs-covered/no-cropped-tops
    // gate. Computed unconditionally — coexists with the raw fields below.
    const effectiveLength = resolveEffectiveLength(item, item.adminReview);
    // Phase 4K1: occasions only, for computeOccasionTier's legacy fallback.
    // Computed unconditionally — coexists with the raw field below.
    const effectiveOccasions = resolveEffectiveOccasions(item, item.adminReview);
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
      colors: engineColour.colors,
      primaryColor: engineColour.primaryColor ?? null,
      pattern: item.pattern ?? null,
      material: item.material ?? null,
      styleTags: item.styleTags,
      occasions: item.occasions,
      effectiveOccasions,
      imageUrl,
      garmentRelationships: item.garmentRelationships,
      formality: item.formality ?? null,
      effectiveFormality,
      // Garment Intelligence fields
      fitProfile: item.fitProfile ?? null,
      waistShape: item.waistShape ?? null,
      sleeveLength: item.sleeveLength ?? null,
      necklineCoverage: item.necklineCoverage ?? null,
      hemLength: item.hemLength ?? null,
      effectiveHemLength: effectiveLength.hemLength,
      topLength: item.topLength ?? null,
      effectiveTopLength: effectiveLength.topLength,
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
  waistShape: string | null;
  // Coverage geometry — required so the anchor is held to the same non-compensable
  // dressing requirements as every other garment. Before these were selected, the
  // anchor was the one piece in the outfit nothing checked.
  hemLength: string | null;
  topLength: string | null;
  // more-coverage reads all five coverage signals, not just hem. Selecting only
  // hem/top length left the anchor scoring blind to sleeves, neckline, shoulders
  // and midriff — the signals that actually decide whether a piece covers.
  sleeveLength: string | null;
  necklineCoverage: string | null;
  shoulderCoverage: boolean | null;
  midriffExposed: boolean | null;
  // Approved GarmentStyleMeProfile — for intention- and body-need-aware anchor ranking.
  // null when no approved profile exists.
  styleMeProfile: {
    profileStatus: string;
    intentionPotentials: Record<string, string> | null;
    occasionFit: Record<string, string> | null;
    construction?: string | null;
    silhouetteCharacter?: string[] | null;
    waistComfort?: string | null;
    fabricBehaviour?: string[] | null;
  } | null;
};

// Inline formality rank — mirrors FORMALITY_RANK in result.server.ts.
// Kept here to avoid a circular dependency (anchor → result → anchor).
const _FORMALITY_RANK: Record<string, number> = {
  casual: 1, "smart-casual": 2, "business-casual": 3,
  "business-formal": 4, occasion: 5, evening: 6,
};

// Maximum formality rank appropriate for an occasion.
// Keys must match canonical session occasion IDs (post REV3_OCCASION_MAP normalisation).
const _OCCASION_MAX_RANK: Record<string, number> = {
  everyday: 2,
  work: 3,
  dinner: 4,
  "date-night": 4,
  "girls-night": 4,
  "special-event": 5,
  travel: 2,
  family: 2,
  active: 2,   // athletic/active day — casual through smart-casual; formal/evening excluded
};

// Construction bonus values for structured-shape / still-want-shape at anchor level.
// Mirrors the fitScore scale in scoreBodyNeedForClosetItem × 2.0 so a tailored anchor
// beats a soft anchor by 1.6 points — decisive for ties but never overrides occasion (+10).
const _ANCHOR_CONSTRUCTION_BONUS: Record<string, number> = {
  "structured": 2.0, "tailored": 2.0,
  "sculptural": 1.5,
  "neutral": 1.0,
  "soft": 0.4,
  // "N/A" → omitted → 0 (not applicable, no structural credit)
};
const _CONSTRUCTION_BODY_NEEDS = new Set(["structured-shape", "still-want-shape"]);

/**
 * Widens the narrow `styleMeProfile` selection used by autoSelectClosetAnchor to the
 * shape scoreBodyNeedForClosetItem declares.
 *
 * The anchor query deliberately selects only the seven profile columns anchor ranking
 * needs, not all eighteen. scoreBodyNeedForClosetItem reads four of them — construction,
 * silhouetteCharacter, waistComfort, fabricBehaviour — and every read is optional-chained,
 * so a partial object is behaviourally correct; only the declared type disagreed. The
 * cast is confined here rather than repeated at each of the six call sites.
 */
type AnchorScoringProfile = NonNullable<ClosetAnchorInput["approvedProfile"]>;
function asScoringProfile(
  profile: AutoSelectItem["styleMeProfile"] | null | undefined,
): AnchorScoringProfile | undefined {
  return (profile ?? undefined) as unknown as AnchorScoringProfile | undefined;
}

export async function autoSelectClosetAnchor(
  customerId: string,
  signals: {
    occasion: string;
    moods: string[];
    desiredFeelings: string[];
    formalityConditional?: string | null;
    // TODAY intentions — used to rank equally-scored eligible anchors.
    // Only approved intentionPotentials are consulted; no legacy tag fallback.
    intentions?: string[];
    // Active fit/comfort body needs — used to rank anchor-capable garments by construction.
    // Ranked after occasion/register and before intention (per scoring tier order).
    bodyNeeds?: string[];
    // Persistent Passport dressing requirements. A garment that cannot satisfy a
    // non-compensable requirement is not eligible to anchor the session, no matter
    // how well it scores — the anchor appears in every candidate, so an ineligible
    // anchor makes every candidate ineligible.
    dressingPreferences?: readonly string[] | null;
    /**
     * New Look, Same Vibe only. Closet ids from the MOST RECENT rendered outfit. Used as a
     * fail-open preference so a reroll can explore a different structural centre. Only
     * structural candidates can ever match an id here — a previous bag or shoe id cannot
     * collide with an anchor candidate — so the raw previous-outfit id list is sufficient
     * and no slot resolution is needed at this layer.
     */
    previousOutfitClosetIds?: readonly string[] | null;
  },
  _fetchItems?: (customerId: string) => Promise<AutoSelectItem[]>,
): Promise<{ anchor: ClosetAnchorInput; id: string } | null> {
  const allItems: AutoSelectItem[] = _fetchItems
    ? await _fetchItems(customerId)
    : await prisma.closetItem.findMany({
        where: { customerId },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true, name: true, category: true, subcategory: true,
          colors: true, primaryColor: true, pattern: true, material: true,
          styleTags: true, occasions: true, imageUrl: true,
          garmentRelationships: true, formality: true, waistShape: true,
          hemLength: true, topLength: true,
          sleeveLength: true, necklineCoverage: true,
          shoulderCoverage: true, midriffExposed: true,
          styleMeProfile: {
            select: { profileStatus: true, intentionPotentials: true, occasionFit: true, construction: true, silhouetteCharacter: true, waistComfort: true, fabricBehaviour: true },
          },
        },
      }) as AutoSelectItem[];

  // ── Eligibility, applied BEFORE scoring ───────────────────────────────────
  //
  // Scoring cannot rescue a garment that is not eligible to anchor, so an ineligible
  // piece must never reach the ranking at all.
  //
  // 1. Anchor capability is a GATE, not a tiebreak.
  //
  //    isStructuralAnchorCandidate decides this on the RESOLVED slot. Capability was
  //    previously only the third tiebreak, AFTER score, so it could only ever decide an
  //    exact tie — and the first attempt at a gate used a fixed category allowlist,
  //    which removed every ACTIVEWEAR garment and emptied Active / busy day. On
  //    2026-10-01 a bag beat the whole wardrobe for an Everyday "feel sharper"
  //    session: 12.75 against 12.00 for every garment behind it. The 0.75 was the
  //    approved-intention bonus (Supporting 0.5 × 1.5), so the margin existed
  //    precisely because the customer asked for something, and capability never got
  //    a vote. A bag then held one of the five outfit slots and the look came back
  //    with no outer layer.
  //
  //    An outfit is not built around a handbag. This is a category rule, not a
  //    score, so it belongs here with the other hard requirements.
  //
  //    MANUAL anchoring is untouched. A customer who deliberately picks an accessory
  //    from her own Closet is making a choice, and source.tsx honours it; this gate
  //    governs only what nAia selects on her behalf.
  //
  // 2. Non-compensable dressing requirements. Unknown metadata fails open — only
  //    explicit evidence rejects.
  const items: AutoSelectItem[] = allItems.filter(
    (item) =>
      isStructuralAnchorCandidate(item) &&
      passesDressingRequirements(
        { hemLength: item.hemLength, topLength: item.topLength } as unknown as ClosetAnchorInput,
        signals.dressingPreferences,
      ),
  );

  if (items.length === 0) return null;

  // Formality tier sort: items whose formality is within the occasion ceiling (tier 0)
  // always sort before items known to be out of range (tier 1), regardless of signal scores.
  // Unknown formality (null) is treated as in-range (tier 0) — fail-open.
  // formalityConditional "formality-dressy" raises the ceiling by 2 ranks.
  const targetMaxRank = _OCCASION_MAX_RANK[signals.occasion] ?? 3;
  // "formality-occasion" (Dressy) raises the ceiling by 2 so evening/occasion-wear
  // anchors can be selected for dressy sessions — but never above the resolved
  // target band. The flat +2 did not know what the band was: Night out + Dressy
  // raised the ceiling to 6, so an evening gown was anchor-eligible and then made
  // every candidate overdressed against a 4-5 band, and because the anchor sits in
  // every candidate, no amount of ranking could recover.
  //
  // Capping rather than replacing keeps this ceiling never LOOSER than before, so
  // no occasion silently gains eligibility it did not have. Out-of-range items only
  // sort last here, they are not filtered, so the pool can never empty either.
  const formalityBoost = signals.formalityConditional === "formality-occasion" ? 2 : 0;
  const targetBandMax = getTargetFormalityRange(
    signals.occasion,
    signals.formalityConditional ?? null,
  ).max;
  const effectiveMaxRank = Math.min(6, targetMaxRank + formalityBoost, targetBandMax);
  const isFormallyInRange = (item: AutoSelectItem): boolean => {
    if (!item.formality) return true; // unknown → in-range (fail-open)
    const rank = _FORMALITY_RANK[item.formality] ?? 0;
    return rank <= effectiveMaxRank;
  };

  // ── Lower bound (C3) ───────────────────────────────────────────────────────
  //
  // The gate above is a CEILING only. Nothing preferred an anchor that reaches the
  // band's floor, so ST13 (Family + Smart casual, band 2-2) anchored on rank-1 casual
  // jeans: once a below-band garment is pinned into a weight-1.0 structural slot, every
  // candidate inherits it and no later ranking can lift the outfit into the band.
  //
  // This is a sort TIER, not a filter, and it sits directly below the ceiling tier so
  // the ceiling's precedence is untouched. When no candidate reaches the floor every
  // entry scores false, the tier ties, and selection falls through to score exactly as
  // before — so a wardrobe with nothing at the band still gets its best anchor rather
  // than none. Unknown formality counts as satisfying the floor, mirroring the
  // fail-open treatment the ceiling already gives it.
  const targetBandMin = getTargetFormalityRange(
    signals.occasion,
    signals.formalityConditional ?? null,
  ).min;
  const isAtOrAboveBandFloor = (item: AutoSelectItem): boolean => {
    if (!item.formality) return true; // unknown → fail-open
    const rank = _FORMALITY_RANK[item.formality] ?? 0;
    return rank >= targetBandMin;
  };

  type ScoredItem = {
    item: AutoSelectItem; score: number; isAnchorCapable: boolean;
    inRange: boolean; atOrAboveFloor: boolean;
  };

  const activeIntentions = signals.intentions ?? [];
  const activeBodyNeeds = signals.bodyNeeds ?? [];
  const needsConstructionBonus = activeBodyNeeds.some((n) => _CONSTRUCTION_BODY_NEEDS.has(n));
  const needsLooseBonus = activeBodyNeeds.includes("loose-comfortable");
  const needsLessBodyConscious = activeBodyNeeds.includes("less-body-conscious");
  const needsSofterFabrics = activeBodyNeeds.includes("softer-easier-fabrics");
  const needsWaistDef = activeBodyNeeds.includes("waist-definition");
  const needsNothingTightWaist = activeBodyNeeds.includes("nothing-tight-waist");
  const needsMoreCoverage = activeBodyNeeds.includes("more-coverage");


  const mapped: ScoredItem[] = items.map((item) => {
    const baseScore = scoreClosetItemForSession(
      { occasions: item.occasions, styleTags: item.styleTags, category: item.category },
      signals,
      undefined,
      item.garmentRelationships,
    );
    const approvedProfile = item.styleMeProfile?.profileStatus === "approved"
      ? item.styleMeProfile
      : null;

    // Register alignment score: in-target items get +2.5, out-of-target items receive
    // a distance-based penalty (-1.5 per rank outside, capped at -4.5).
    // Only fires when a formalityConditional is set and the item has known formality.
    // Items without known formality always get 0 (fail-open).
    const registerBonus = (() => {
      if (!signals.formalityConditional || !item.formality) return 0;
      const rank = _FORMALITY_RANK[item.formality] ?? null;
      if (rank === null) return 0;
      const range = FORMALITY_CONDITIONAL_ADJUSTMENTS[signals.formalityConditional];
      if (!range) return 0;
      if (rank >= range.min && rank <= range.max) return 2.5;
      const distance = rank < range.min ? range.min - rank : rank - range.max;
      return Math.max(-4.5, -1.5 * distance);
    })();

    // Body-need bonus/penalty: applied to anchor-capable categories only.
    // Precedence: occasion eligibility > register > body-need > intention.
    // A violation penalty (-2.0) ensures a fitted anchor loses to an occasion-valid
    // relaxed alternative WITHIN the eligible pool, without rescuing occasion-invalid items.
    const bodyNeedBonus = (() => {
      if (!isStructuralAnchorCandidate(item)) return 0;
      let bonus = 0;

      // Construction-based needs (structured-shape / still-want-shape)
      if (needsConstructionBonus && approvedProfile) {
        const construction = approvedProfile.construction;
        if (construction && construction !== "N/A") {
          bonus += _ANCHOR_CONSTRUCTION_BONUS[construction] ?? 0;
        }
      }

      // Loose-comfortable: silhouetteCharacter + waistComfort from approved profile
      if (needsLooseBonus) {
        const { violation, fitScore } = scoreBodyNeedForClosetItem("loose-comfortable", {
          fitProfile: null, waistShape: item.waistShape, styleTags: item.styleTags,
          approvedProfile: asScoringProfile(approvedProfile),
        });
        if (violation) {
          bonus -= 2.0; // fitted/restrictive anchor loses to occasion-valid relaxed alternative
        } else if (fitScore !== null && fitScore > 0) {
          bonus += fitScore * 2.0; // max +2.0 for loose + waist support
        }
      }

      // Nothing too body-hugging: uses same silhouette evidence as loose-comfortable
      if (needsLessBodyConscious) {
        const { violation, fitScore } = scoreBodyNeedForClosetItem("less-body-conscious", {
          fitProfile: null, waistShape: item.waistShape, styleTags: item.styleTags,
          approvedProfile: asScoringProfile(approvedProfile),
        });
        if (violation) {
          bonus -= 2.0; // fitted anchor loses to non-cling alternative within eligible pool
        } else if (fitScore !== null && fitScore > 0) {
          bonus += fitScore * 1.7; // max +1.7 for clearly relaxed silhouette
        }
      }

      // More coverage: the five coverage-geometry signals. Scored at the same
      // magnitude as less-body-conscious — both are exposure-avoidance needs.
      if (needsMoreCoverage) {
        const { violation, fitScore } = scoreBodyNeedForClosetItem("more-coverage", {
          fitProfile: null, waistShape: item.waistShape, styleTags: item.styleTags,
          sleeveLength: item.sleeveLength, necklineCoverage: item.necklineCoverage,
          hemLength: item.hemLength, shoulderCoverage: item.shoulderCoverage,
          midriffExposed: item.midriffExposed,
          approvedProfile: asScoringProfile(approvedProfile),
        });
        if (violation) {
          bonus -= 2.0; // exposing anchor loses to a covering alternative in the eligible pool
        } else if (fitScore !== null && fitScore > 0) {
          bonus += fitScore * 1.7; // max +1.7 for a fully covering piece
        }
      }

      // Softer / easier fabrics: fabricBehaviour from approved profile
      if (needsSofterFabrics && approvedProfile) {
        const { fitScore } = scoreBodyNeedForClosetItem("softer-easier-fabrics", {
          fitProfile: null, waistShape: item.waistShape, styleTags: item.styleTags,
          approvedProfile: asScoringProfile(approvedProfile),
        });
        if (fitScore !== null) bonus += (fitScore - 0.5) * 1.0; // soft→+0.5, rigid→-0.3, neutral→0
      }

      // Waist definition: explicit waist evidence only
      if (needsWaistDef) {
        const { fitScore } = scoreBodyNeedForClosetItem("waist-definition", {
          fitProfile: null, waistShape: item.waistShape, styleTags: item.styleTags,
          approvedProfile: asScoringProfile(approvedProfile),
        });
        if (fitScore !== null && fitScore > 0) bonus += fitScore * 1.5;
      }

      // Nothing tight around waist: waistComfort from approved profile
      if (needsNothingTightWaist) {
        const { fitScore } = scoreBodyNeedForClosetItem("nothing-tight-waist", {
          fitProfile: null, waistShape: item.waistShape, styleTags: item.styleTags,
          approvedProfile: asScoringProfile(approvedProfile),
        });
        if (fitScore !== null) {
          if (fitScore >= 0.8) bonus += 1.0;       // elastic/stretch/drawstring
          else if (fitScore < 0.2) bonus -= 1.0;   // restrictive waistband
        }
      }

      return bonus;
    })();

    // Intention bonus: approved intentionPotentials only — no legacy tag fallback.
    const intentionBonus = approvedProfile?.intentionPotentials && activeIntentions.length > 0
      ? activeIntentions.reduce((sum, id) => {
          const rating = (approvedProfile.intentionPotentials as Record<string, string>)[id];
          if (rating === "Strong") return sum + 1.0;
          if (rating === "Supporting") return sum + 0.5;
          return sum; // None = 0, unrated = 0 — no legacy fallback
        }, 0) * 1.5
      : 0;
    return {
      item,
      score: baseScore + registerBonus + bodyNeedBonus + intentionBonus,
      isAnchorCapable: isStructuralAnchorCandidate(item),
      inRange: isFormallyInRange(item),
      atOrAboveFloor: isAtOrAboveBandFloor(item),
    };
  });

  const scored = mapped.sort((a, b) => {
    // Tier 0 (in-range formality) always beats Tier 1 (known out-of-range)
    if (a.inRange !== b.inRange) return a.inRange ? -1 : 1;
    // C3: an anchor that reaches the band's floor beats one below it. Ties when no
    // candidate reaches the floor, which is what makes this fail-open.
    if (a.atOrAboveFloor !== b.atOrAboveFloor) return a.atOrAboveFloor ? -1 : 1;
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
  const isOccasionCompatible = (item: AutoSelectItem): boolean => {
    // Approved occasionFit "No" is a hard exclusion — intention cannot rescue it.
    const ap = item.styleMeProfile?.profileStatus === "approved" ? item.styleMeProfile : null;
    if (ap?.occasionFit) {
      const fit = profileOccasionRating(ap.occasionFit as Record<string, string>, signals.occasion);
      if (fit === "No") return false;
    }
    return matchesSessionOccasion(item.occasions, signals.occasion)  // normalized match
      || item.occasions.length === 0                                  // no tags → versatile
      || !item.garmentRelationships.includes("occasion-only");        // other-occasion tags, no restriction
  };

  const defaultWinnerEntry = scored.find(s => s.score > 0 && isOccasionCompatible(s.item));

  // ── Single-point band, nothing in it: dressing up beats dressing down ──────
  //
  // C3 added a floor tier BELOW the ceiling tier, which is correct whenever something in
  // the closet reaches the band. It cannot help when the band is one rank wide and the
  // closet straddles it: Family + Smart casual resolves to 2-2, ST13's closet holds rank 1
  // and rank 3 and nothing at rank 2, so the ceiling demoted the rank-3 pieces, the floor
  // demoted the rank-1 pieces, and the ceiling — read first — kept the rank-1 jeans.
  //
  // Both misses are one rank, but they are not equally recoverable. A rank-1 bottom pinned
  // into a weight-1.0 structural slot held the whole ST13 outfit at register 1.045 against
  // a 2-2 target; the rank-3 alternative lets construction land near 2.33. The outfit can
  // be dressed down around a slightly-too-smart anchor far more readily than it can be
  // lifted around a too-casual one.
  //
  // Deliberately narrow. Every condition must hold:
  //   - the customer answered the formality question
  //   - the band is a single rank
  //   - no viable anchor sits inside it (unknown formality counts as inside — fail-open)
  //   - viable anchors exist on BOTH sides
  //   - the nearest on each side are equally distant from the band
  // Any in-band anchor, any wider band, any absent formality answer, or an unequal gap and
  // this does not fire at all. Nothing is filtered: it only changes which viable candidate
  // is picked, and only in the case where the previous answer was the worse of two misses.
  const fallbackWinnerEntry = (() => {
    if (!signals.formalityConditional) return undefined;
    const band = getTargetFormalityRange(signals.occasion, signals.formalityConditional);
    if (band.min !== band.max) return undefined;

    const viable = scored.filter(s => s.score > 0 && isOccasionCompatible(s.item));
    const rankOf = (s: ScoredItem): number | null =>
      s.item.formality ? (_FORMALITY_RANK[s.item.formality] ?? null) : null;

    // An unknown rank is treated as acceptable, so its presence suppresses the fallback.
    if (viable.some(s => { const r = rankOf(s); return r === null || r === band.min; })) return undefined;

    const below = viable.filter(s => { const r = rankOf(s); return r !== null && r < band.min; });
    const above = viable.filter(s => { const r = rankOf(s); return r !== null && r > band.max; });
    if (below.length === 0 || above.length === 0) return undefined;

    const nearestBelow = Math.max(...below.map(s => rankOf(s) as number));
    const nearestAbove = Math.min(...above.map(s => rankOf(s) as number));
    if (band.min - nearestBelow !== nearestAbove - band.max) return undefined;

    // `scored` is already sorted, so this is the best-scoring candidate at that rank.
    return above.find(s => rankOf(s) === nearestAbove);
  })();

  // ── Reroll diversity preference ───────────────────────────────────────────
  //
  // New Look, Same Vibe must be able to move the structural centre of the outfit. The anchor
  // appears in every candidate, so while it is fixed the core can barely change and a reroll
  // can only vary finishing pieces.
  //
  // Placement, deliberately the weakest tier that can still do the job:
  //
  //   occasion eligibility  >  formality ceiling  >  formality floor
  //     >  single-point-band fallback  >  THIS  >  score / stable ordering
  //
  // It only ever chooses between anchors that are ALREADY equally correct: the candidate
  // must be viable on exactly the same terms as the default winner (positive score,
  // occasion-compatible) and tied with it on both the ceiling and floor tiers. It cannot
  // promote a lower-tier anchor, and it does not run at all when the single-point fallback
  // has already decided. Correctness is never traded for variety.
  //
  // Fail-open throughout: no previous outfit, the default winner already outside the
  // previous look, or no equally-correct alternative — all keep the existing behaviour, and
  // an anchor is never withheld to manufacture diversity.
  const diversityWinnerEntry = (() => {
    if (fallbackWinnerEntry) return undefined;
    if (!defaultWinnerEntry) return undefined;
    const previous = new Set(signals.previousOutfitClosetIds ?? []);
    if (previous.size === 0) return undefined;
    if (!previous.has(defaultWinnerEntry.item.id)) return undefined; // already a fresh centre
    return scored.find((s) =>
      s.score > 0 &&
      isOccasionCompatible(s.item) &&
      s.inRange === defaultWinnerEntry.inRange &&
      s.atOrAboveFloor === defaultWinnerEntry.atOrAboveFloor &&
      !previous.has(s.item.id),
    );
  })();

  const winnerEntry = fallbackWinnerEntry ?? diversityWinnerEntry ?? defaultWinnerEntry;
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
      // PRIMARY: approved silhouetteCharacter — same evidence source as loose-comfortable.
      const profile = item.approvedProfile;
      if (profile) {
        const sils = (profile.silhouetteCharacter ?? []) as string[];
        const LOOSE_SILS = new Set(["relaxed", "oversized", "voluminous", "wide-leg"]);
        // fitted is the clear contradiction: body-skimming/cling
        if (sils.includes("fitted")) return { violation: true, fitScore: 0 };
        if (sils.some((s) => LOOSE_SILS.has(s))) return { violation: false, fitScore: 1 };
        // Neutral silhouettes (straight, A-line, column, draped) — not cling, not loose
        if (sils.length > 0) return { violation: false, fitScore: 0.5 };
        // No silhouette data on approved profile — fall through to legacy
      }
      // LEGACY FALLBACK: fitProfile only
      if (fp !== null && TIGHT_FITS.has(fp)) return { violation: true, fitScore: 0 };
      if (fp !== null && RELAXED_FITS.has(fp)) return { violation: false, fitScore: 1 };
      if (fp !== null && (fp === "tailored" || fp === "structured")) return { violation: false, fitScore: 0.5 };
      return { violation: false, fitScore: fp === null ? null : 0.5 };
    }

    case "loose-comfortable": {
      const profile = item.approvedProfile;
      if (profile) {
        // PRIMARY: approvedProfile silhouetteCharacter (String[]) + waistComfort
        const silhouettes = (profile.silhouetteCharacter ?? []) as string[];
        const wc = (profile.waistComfort ?? null) as string | null;
        const LOOSE_SILS = new Set(["relaxed", "oversized", "voluminous", "wide-leg"]);
        const WAIST_SUPPORT = new Set(["elastic", "drawstring", "stretch"]);
        const hasLoose = silhouettes.some((s) => LOOSE_SILS.has(s));
        const hasFitted = silhouettes.includes("fitted");
        const hasRestrict = wc === "restrictive";
        const hasWaistSupport = wc !== null && WAIST_SUPPORT.has(wc);
        // Fitted silhouette: violation even with elastic waist — silhouette dominates
        if (hasFitted) return { violation: true, fitScore: hasWaistSupport ? 0.1 : 0 };
        // Restrictive waistband: violation — wide-leg silhouette softens penalty slightly
        if (hasRestrict) return { violation: true, fitScore: hasLoose ? 0.4 : 0 };
        // No violation below — score positive contribution
        if (hasLoose && hasWaistSupport) return { violation: false, fitScore: 1.0 };
        if (hasLoose) return { violation: false, fitScore: 0.85 };
        if (hasWaistSupport) return { violation: false, fitScore: 0.6 };
        return { violation: false, fitScore: null }; // neutral/unread silhouette, no waist info
      }
      // LEGACY FALLBACK: fitProfile only — when no approved profile exists
      const RELAXED_LEGACY = new Set(["relaxed", "loose", "oversized", "flowy"]);
      const FITTED_LEGACY = new Set(["fitted", "body-skimming"]);
      if (fp !== null && RELAXED_LEGACY.has(fp)) return { violation: false, fitScore: 1 };
      if (fp !== null && FITTED_LEGACY.has(fp)) return { violation: true, fitScore: 0 };
      if (fp !== null && (fp === "tailored" || fp === "structured")) return { violation: false, fitScore: 0.3 };
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
      // construction from approved profile is authoritative — locked taxonomy only.
      // fitProfile="fitted" must NOT substitute for construction.
      const construction = item.approvedProfile?.construction ?? null;
      if (construction !== null) {
        if (construction === "N/A") return { violation: false, fitScore: null };
        if (construction === "structured" || construction === "tailored") return { violation: false, fitScore: 1.0 };
        if (construction === "sculptural") return { violation: false, fitScore: 0.75 };
        if (construction === "neutral") return { violation: false, fitScore: 0.4 };
        if (construction === "soft") return { violation: false, fitScore: 0.2 };
        return { violation: false, fitScore: null }; // unknown taxonomy value — treat as unknown
      }
      // No approved construction — fall through to legacy fitProfile-based scoring.
      if (fp !== null && SHAPED_FITS.has(fp)) return { violation: false, fitScore: 1 };
      if (fp !== null && (fp === "loose" || fp === "oversized")) return { violation: false, fitScore: 0.2 };
      if (fp !== null && (fp === "relaxed" || fp === "flowy")) return { violation: false, fitScore: 0.4 };
      return { violation: false, fitScore: fp === null ? null : 0.5 };
    }

    case "waist-definition": {
      // Explicit waist-definition evidence only. DO NOT infer from:
      //   fitted / tailored / structured / body-skimming / high-waist alone.
      // Schema gap: GarmentStyleMeProfile has no dedicated waist-definition field.
      // Using legacy waistShape as the strongest available reviewed source.
      if (ws === "belted" || ws === "tied" || ws === "wrap") return { violation: false, fitScore: 1 };
      // Any other waistShape value = insufficient evidence
      return { violation: false, fitScore: null };
    }

    case "structured-shape": {
      // construction from approved profile is authoritative — locked taxonomy only.
      // Fitted silhouette and colour are not structural signals and must not substitute.
      const construction = item.approvedProfile?.construction ?? null;
      if (construction !== null) {
        if (construction === "N/A") return { violation: false, fitScore: null };
        if (construction === "structured" || construction === "tailored") return { violation: false, fitScore: 1.0 };
        if (construction === "sculptural") return { violation: false, fitScore: 0.75 };
        if (construction === "neutral") return { violation: false, fitScore: 0.4 };
        if (construction === "soft") return { violation: false, fitScore: 0.2 };
        return { violation: false, fitScore: null }; // unknown taxonomy value — treat as unknown
      }
      // No approved construction — fall through to legacy fitProfile/styleTags signals.
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
