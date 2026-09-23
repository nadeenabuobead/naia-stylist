// app/lib/ai/wardrobe-intelligence.server.ts
//
// Data layer for WARDROBE INTELLIGENCE.
//
// Responsibilities:
//   1. Load the customer's Closet with the intelligence already attached to each piece.
//   2. Resolve per-garment intelligence with a single, explicit precedence:
//        admin intelligence override  >  hand-curated StyleMe profile  >  nAia-derived
//   3. Load the real usage facts that exist today (outfit + saved-look appearances).
//   4. Hand a pure snapshot to computeWardrobeIntelligence().
//
// It derives NOTHING itself. Every garment-level value comes from an existing system:
//   - classification/observables      → ClosetItem (closet-garment-analysis)
//   - admin corrections               → ClosetItemAdminReview
//   - curated taxonomy                → GarmentStyleMeProfile
//   - visualWeight/colour/intentions  → garment-intelligence-v1.server.ts (read-only)

import prisma from "~/db.server";
import { closetItemToSlot } from "~/lib/ai/closet-slot";
import { getEffectiveClosetItem, type IntelligenceOverrides, type ClosetItemFields } from "~/lib/admin/closet-review.server";
import {
  deriveGarmentStylingIntelligence,
  deriveVisualWeight,
  deriveColourProfile,
  ALL_INTENTIONS,
  type StylingPassportInput,
} from "~/lib/admin/garment-intelligence-v1.server";
import type { ClosetClassification } from "~/lib/admin/closet-intelligence.server";
import {
  computeWardrobeIntelligence,
  wardrobeCharacterLine,
  combinationKey,
  type WardrobeGarment,
  type WardrobePassport,
  type WardrobeIntelligence,
  type ResolvedIntentionStrength,
  type ResolvedVisualWeight,
  type ResolvedColourProfile,
  type WardrobeIntelligenceFlags,
} from "~/lib/ai/wardrobe-intelligence";
import { DEFAULT_FLAGS } from "~/lib/ai/wardrobe-intelligence";

// db.server is plain JS, so the Prisma client is untyped at this boundary.
// This row shape is the explicit contract for everything this module reads.
type ClosetItemRow = ClosetItemFields & {
  id: string;
  name: string | null;
  category: string;
  analysisStatus: string;
  garmentRelationships: string[];
  adminReview: { reviewStatus: string; overrides: unknown; intelligenceOverrides: unknown } | null;
  styleMeProfile: {
    profileStatus: string;
    visualWeight: string | null;
    intentionPotentials: unknown;
  } | null;
};

// Curated GarmentStyleMeProfile uses "heavy"; derived intelligence uses "substantial".
const CURATED_WEIGHT_MAP: Readonly<Record<string, ResolvedVisualWeight>> = {
  light: "light",
  medium: "medium",
  heavy: "substantial",
};

const CURATED_STRENGTH_MAP: Readonly<Record<string, ResolvedIntentionStrength>> = {
  Strong: "strong",
  Supporting: "supporting",
  None: "none",
};

/** Only an approved curated profile is trusted ahead of derived intelligence. */
const CURATED_APPROVED_STATUS = "approved";

export interface WardrobeIntelligenceBundle {
  intelligence: WardrobeIntelligence;
  /** Garment lookup for the UI — images, names, categories. */
  garments: WardrobeGarment[];
}

export async function loadWardrobeIntelligence(
  customerId: string,
  options: {
    /** Display URL per closet item id, already signed by the caller. */
    imageUrlById: ReadonlyMap<string, string | null>;
    passport: WardrobePassport | null;
    /** Defaults to DEFAULT_FLAGS (derived V2 intention intelligence OFF). */
    flags?: WardrobeIntelligenceFlags;
  },
): Promise<WardrobeIntelligenceBundle> {
  const items: ClosetItemRow[] = await prisma.closetItem.findMany({
    where: { customerId },
    orderBy: { createdAt: "desc" },
    include: { adminReview: true, styleMeProfile: true },
  });

  const [outfitCounts, savedCounts, seenCombinations] = await Promise.all([
    countOutfitAppearances(customerId),
    countSavedLookAppearances(customerId),
    loadSeenCombinations(customerId),
  ]);

  const passportInput = toStylingPassportInput(options.passport);

  const garments: WardrobeGarment[] = items.map((item) => {
    const effective = getEffectiveClosetItem(item, item.adminReview);
    const classification = toClassification(effective);

    const derived = deriveGarmentStylingIntelligence(classification, passportInput);
    const overrides = (item.adminReview?.intelligenceOverrides ?? null) as IntelligenceOverrides | null;
    const curated =
      item.styleMeProfile && item.styleMeProfile.profileStatus === CURATED_APPROVED_STATUS
        ? item.styleMeProfile
        : null;

    // ── Visual weight ────────────────────────────────────────────────────────
    let visualWeight: ResolvedVisualWeight | null = derived.visualWeight.value;
    let source: WardrobeGarment["intelligenceSource"] = visualWeight === null ? "none" : "derived";
    if (curated?.visualWeight && CURATED_WEIGHT_MAP[curated.visualWeight]) {
      visualWeight = CURATED_WEIGHT_MAP[curated.visualWeight];
      source = "curated";
    }
    if (overrides && Object.prototype.hasOwnProperty.call(overrides, "visualWeight")) {
      visualWeight = (overrides.visualWeight ?? null) as ResolvedVisualWeight | null;
      source = "curated";
    }

    // ── Colour profile ───────────────────────────────────────────────────────
    const colourProfile: ResolvedColourProfile = {
      hueFamily: derived.colourProfile.hueFamily,
      wardrobeNeutral: derived.colourProfile.wardrobeNeutral,
      lightDark: derived.colourProfile.lightDark,
      energyTier: derived.colourProfile.energyTier,
    };
    const cpOverride = overrides?.colourProfile;
    if (cpOverride) {
      if (Object.prototype.hasOwnProperty.call(cpOverride, "hueFamily")) colourProfile.hueFamily = cpOverride.hueFamily ?? null;
      if (Object.prototype.hasOwnProperty.call(cpOverride, "wardrobeNeutral")) colourProfile.wardrobeNeutral = cpOverride.wardrobeNeutral ?? false;
      if (Object.prototype.hasOwnProperty.call(cpOverride, "lightDark")) colourProfile.lightDark = cpOverride.lightDark ?? null;
      if (Object.prototype.hasOwnProperty.call(cpOverride, "energyTier")) colourProfile.energyTier = cpOverride.energyTier ?? null;
      source = "curated";
    }

    // ── Intentions ───────────────────────────────────────────────────────────
    //
    // Provenance matters here, not just the value. Phase 3C V2 DERIVED intention
    // potential is shadow output and stays gated in the engine; a human-reviewed
    // value (approved curated profile, or an admin correction) is trusted now.
    // intentionsSource is only "curated" when EVERY one of the 12 intentions came
    // from a human-reviewed source — a partial mix is treated as derived.
    const intentions: Record<string, ResolvedIntentionStrength> = {};
    const humanReviewed = new Set<string>();
    for (const potential of derived.intentionPotentials) {
      intentions[potential.intention] = potential.strength;
    }
    const curatedIntentions = curated?.intentionPotentials as Record<string, string> | null | undefined;
    if (curatedIntentions && typeof curatedIntentions === "object") {
      for (const intention of ALL_INTENTIONS) {
        const raw = curatedIntentions[intention];
        if (typeof raw === "string" && CURATED_STRENGTH_MAP[raw]) {
          intentions[intention] = CURATED_STRENGTH_MAP[raw];
          humanReviewed.add(intention);
          source = "curated";
        }
      }
    }
    if (overrides?.intentions) {
      for (const [intention, value] of Object.entries(overrides.intentions)) {
        if (value === null) continue;
        intentions[intention] = value as ResolvedIntentionStrength;
        humanReviewed.add(intention);
        source = "curated";
      }
    }
    const intentionsSource: "curated" | "derived" =
      ALL_INTENTIONS.every((intention) => humanReviewed.has(intention)) ? "curated" : "derived";

    // Intelligence is only claimed when the garment has actually been read.
    const hasIntelligence = item.analysisStatus === "ready" || source === "curated";

    return {
      id: item.id,
      name: item.name,
      category: item.category as string,
      subcategory: effective.subcategory ?? null,
      imageUrl: options.imageUrlById.get(item.id) ?? null,
      slot: closetItemToSlot(item.category as string, effective.subcategory ?? null),

      primaryColor: effective.primaryColor ?? null,
      colors: effective.colors ?? [],
      pattern: effective.pattern ?? null,
      material: effective.material ?? null,
      silhouette: effective.silhouette ?? null,
      fitProfile: effective.fitProfile ?? null,
      formality: effective.formality ?? null,
      stylePersonality: effective.stylePersonality ?? null,
      occasions: effective.occasions ?? [],
      seasons: effective.seasons ?? [],
      garmentRelationships: item.garmentRelationships ?? [],
      analysisStatus: item.analysisStatus,

      visualWeight: hasIntelligence ? visualWeight : null,
      colourProfile: hasIntelligence ? colourProfile : null,
      intentions: hasIntelligence ? intentions : null,
      intentionsSource: hasIntelligence ? intentionsSource : null,
      intelligenceSource: hasIntelligence ? source : "none",

      outfitAppearances: outfitCounts.get(item.id) ?? 0,
      savedLookAppearances: savedCounts.get(item.id) ?? 0,

      // Reserved for real wear tracking. ClosetItem.timesWorn / lastWorn exist in
      // the schema but nothing writes them, so passing them through would dress up
      // a default as a measurement. Null until a wear-recording path exists.
      observedWear: null,
    };
  });

  const intelligence = computeWardrobeIntelligence({
    items: garments,
    passport: options.passport,
    seenCombinations,
    flags: options.flags ?? DEFAULT_FLAGS,
  });

  return { intelligence, garments };
}

// ── Usage facts (real records only — NOT wear tracking) ───────────────────────

async function countOutfitAppearances(customerId: string): Promise<Map<string, number>> {
  const rows: Array<{ closetItemId: string | null; _count: { _all: number } }> =
    await prisma.outfitItem.groupBy({
      by: ["closetItemId"],
      where: {
        closetItemId: { not: null },
        suggestion: { session: { customerId } },
      },
      _count: { _all: true },
    });
  const out = new Map<string, number>();
  for (const row of rows) {
    if (row.closetItemId) out.set(row.closetItemId, row._count._all);
  }
  return out;
}

async function countSavedLookAppearances(customerId: string): Promise<Map<string, number>> {
  const rows: Array<{ closetItemId: string | null; _count: { _all: number } }> =
    await prisma.savedLookItem.groupBy({
      by: ["closetItemId"],
      where: { closetItemId: { not: null }, savedLook: { customerId } },
      _count: { _all: true },
    });
  const out = new Map<string, number>();
  for (const row of rows) {
    if (row.closetItemId) out.set(row.closetItemId, row._count._all);
  }
  return out;
}

/** Combination keys nAia has already produced — used only to mark a pairing untried. */
async function loadSeenCombinations(customerId: string): Promise<Set<string>> {
  const suggestions: Array<{ items: Array<{ closetItemId: string | null }> }> =
    await prisma.outfitSuggestion.findMany({
      where: { session: { customerId } },
      select: { items: { select: { closetItemId: true } } },
      take: 500,
      orderBy: { createdAt: "desc" },
    });

  const seen = new Set<string>();
  for (const suggestion of suggestions) {
    const ids = (suggestion.items as Array<{ closetItemId: string | null }>)
      .map((i) => i.closetItemId)
      .filter((id): id is string => Boolean(id));
    if (ids.length < 2) continue;
    // Record every 2- and 3-piece subset so a pairing counts as tried when it was
    // part of a larger generated look.
    for (let a = 0; a < ids.length; a++) {
      for (let b = a + 1; b < ids.length; b++) {
        seen.add(combinationKey([ids[a], ids[b]]));
        for (let c = b + 1; c < ids.length; c++) {
          seen.add(combinationKey([ids[a], ids[b], ids[c]]));
        }
      }
    }
  }
  return seen;
}

// ── Mapping helpers ───────────────────────────────────────────────────────────

type EffectiveItem = ClosetItemFields & { category: string; garmentRelationships: string[] };

function toClassification(item: EffectiveItem): ClosetClassification {
  return {
    category: item.category ?? null,
    subcategory: item.subcategory,
    silhouette: item.silhouette,
    fitProfile: item.fitProfile,
    hemLength: item.hemLength,
    topLength: item.topLength,
    waistShape: item.waistShape,
    sleeveLength: item.sleeveLength,
    necklineCoverage: item.necklineCoverage,
    shoulderCoverage: item.shoulderCoverage,
    midriffExposed: item.midriffExposed,
    material: item.material,
    pattern: item.pattern,
    primaryColor: item.primaryColor,
    colors: item.colors ?? [],
    occasions: item.occasions ?? [],
    seasons: item.seasons ?? [],
    formality: item.formality,
    stylePersonality: item.stylePersonality,
    styleTags: item.styleTags ?? [],
    garmentRelationships: item.garmentRelationships ?? [],
  };
}

function toStylingPassportInput(passport: WardrobePassport | null): StylingPassportInput | null {
  if (!passport) return null;
  return {
    stylePersonalities: passport.stylePersonalities,
    favoriteColors: passport.favoriteColors,
    avoidColors: passport.avoidColors,
    dressingPreferences: passport.fitPreferences,
    silhouette: passport.silhouette,
  };
}


// ── Closet page preview ───────────────────────────────────────────────────────

/**
 * One-sentence character line for the Closet page's Wardrobe Intelligence block.
 *
 * Deliberately computed from the SAME trait logic the full page uses, with the
 * same admin-override precedence, so the doorway and the destination cannot
 * disagree. No database access and no extra queries — the caller already has the
 * rows. Returns null when there is not enough to say.
 */
export function computeClosetCharacterLine(
  rows: Array<ClosetItemFields & {
    id: string;
    name: string | null;
    category: string;
    analysisStatus: string;
    garmentRelationships: string[];
    adminReview: { reviewStatus: string; overrides: unknown } | null;
  }>,
): string | null {
  const garments: WardrobeGarment[] = rows.map((item) => {
    const effective = getEffectiveClosetItem(item, item.adminReview);
    const classification = toClassification({ ...effective, category: item.category, garmentRelationships: item.garmentRelationships });
    const ready = item.analysisStatus === "ready";
    return {
      id: item.id,
      name: item.name,
      category: item.category,
      subcategory: effective.subcategory,
      imageUrl: null,
      slot: closetItemToSlot(item.category, effective.subcategory),
      primaryColor: effective.primaryColor,
      colors: effective.colors ?? [],
      pattern: effective.pattern,
      material: effective.material,
      silhouette: effective.silhouette,
      fitProfile: effective.fitProfile,
      formality: effective.formality,
      stylePersonality: effective.stylePersonality,
      occasions: effective.occasions ?? [],
      seasons: effective.seasons ?? [],
      analysisStatus: item.analysisStatus,
      visualWeight: ready ? deriveVisualWeight(classification).value : null,
      colourProfile: ready
        ? {
            hueFamily: deriveColourProfile(classification).hueFamily,
            wardrobeNeutral: deriveColourProfile(classification).wardrobeNeutral,
            lightDark: deriveColourProfile(classification).lightDark,
            energyTier: deriveColourProfile(classification).energyTier,
          }
        : null,
      garmentRelationships: item.garmentRelationships ?? [],
      intentions: null,
      intentionsSource: null,
      intelligenceSource: ready ? "derived" : "none",
      outfitAppearances: 0,
      savedLookAppearances: 0,
      observedWear: null,
    };
  });

  return wardrobeCharacterLine(garments);
}
