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
import {
  computeWardrobeNeeds,
  styleMeSessionRegister,
  type WardrobeNeeds,
  type StyleMeSessionFact,
  type OutcomeFact,
} from "~/lib/ai/wardrobe-needs";
import {
  computeWardrobeRecommendations,
  type WardrobeRecommendations,
} from "~/lib/ai/wardrobe-recommendations";

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
  /** Synthesis layer: what the wardrobe DOES, on top of what it IS. */
  needs: WardrobeNeeds;
  /** What kind of piece would close the gaps `needs` already found. */
  recommendations: WardrobeRecommendations;
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

  const [outfitCounts, savedCounts, seenCombinations, styleMeSessions, outcomes] = await Promise.all([
    countOutfitAppearances(customerId),
    countSavedLookAppearances(customerId),
    loadSeenCombinations(customerId),
    loadStyleMeSessions(customerId),
    loadOutcomes(customerId),
  ]);

  // Per-garment outcome tallies. A garment inherits the outcome of every look it
  // appeared in — that is a fact about the LOOK, so only look-level and
  // register-level claims are drawn from it downstream.
  const outcomeTally = new Map<string, { kept: number; changed: number; notWorn: number }>();
  for (const outcome of outcomes) {
    for (const garmentId of outcome.garmentIds) {
      const row = outcomeTally.get(garmentId) ?? { kept: 0, changed: 0, notWorn: 0 };
      if (outcome.status === "wore-it") row.kept++;
      else if (outcome.status === "changed-something") row.changed++;
      else row.notWorn++;
      outcomeTally.set(garmentId, row);
    }
  }

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

      // Coverage facts, passed through exactly as stored. These drive the
      // needs layer's usable-vs-blocked split, so a null here must stay null:
      // it means "not read", never "complies".
      sleeveLength: effective.sleeveLength ?? null,
      necklineCoverage: effective.necklineCoverage ?? null,
      hemLength: effective.hemLength ?? null,
      topLength: effective.topLength ?? null,
      midriffExposed: effective.midriffExposed ?? null,
      shoulderCoverage: effective.shoulderCoverage ?? null,

      outfitAppearances: outfitCounts.get(item.id) ?? 0,
      savedLookAppearances: savedCounts.get(item.id) ?? 0,

      outcomeKept: outcomeTally.get(item.id)?.kept ?? 0,
      outcomeChanged: outcomeTally.get(item.id)?.changed ?? 0,
      outcomeNotWorn: outcomeTally.get(item.id)?.notWorn ?? 0,

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

  const needs = computeWardrobeNeeds({
    items: garments,
    passport: options.passport,
    styleMeSessions,
    outcomes,
  });

  const recommendations = computeWardrobeRecommendations({
    needs,
    items: garments,
    passport: options.passport,
  });

  return { intelligence, needs, recommendations, garments };
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

/**
 * StyleMe history as GENERATED FACT.
 *
 * This records what nAia proposed and what the customer asked for. It is not
 * evidence that anything was worn — that lives in loadOutcomes() below, and the
 * two are kept in separate shapes so no downstream caller can confuse them.
 *
 * Returns [] (not null) when the customer has simply never used StyleMe; the
 * needs layer distinguishes "queried, nothing there" from "never queried".
 */
async function loadStyleMeSessions(customerId: string): Promise<StyleMeSessionFact[]> {
  const sessions: Array<{
    id: string;
    occasion: string | null;
    formalityConditional: string | null;
    intentions: string[];
    suggestions: Array<{ items: Array<{ closetItemId: string | null }> }>;
  }> = await prisma.stylingSession.findMany({
    where: { customerId },
    select: {
      id: true,
      occasion: true,
      formalityConditional: true,
      intentions: true,
      suggestions: { select: { items: { select: { closetItemId: true } } } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return sessions.map((session) => ({
    id: session.id,
    register: styleMeSessionRegister(session.occasion, session.formalityConditional),
    intentions: session.intentions ?? [],
    garmentIds: session.suggestions
      .flatMap((suggestion) => suggestion.items.map((item) => item.closetItemId))
      .filter((id): id is string => Boolean(id)),
  }));
}

/**
 * Recorded StyleMeOutcome rows — the only wear behaviour nAia actually holds.
 *
 * The customer told us what happened after the look: wore it, changed something,
 * or didn't wear it. Nothing here is inferred from a generated suggestion.
 *
 * Prisma is untyped at this boundary (db.server is plain JS) and StyleMeOutcome
 * is reached the same way outcome-persistence.server.ts reaches it.
 */
async function loadOutcomes(customerId: string): Promise<OutcomeFact[]> {
  const db = prisma as unknown as {
    styleMeOutcome: {
      findMany: (args: unknown) => Promise<Array<{
        suggestionId: string;
        outcomeStatus: string;
        suggestion: {
          items: Array<{ closetItemId: string | null }>;
          session: { occasion: string | null; formalityConditional: string | null } | null;
        } | null;
      }>>;
    };
  };

  const rows = await db.styleMeOutcome.findMany({
    where: { customerId },
    select: {
      suggestionId: true,
      outcomeStatus: true,
      suggestion: {
        select: {
          items: { select: { closetItemId: true } },
          session: { select: { occasion: true, formalityConditional: true } },
        },
      },
    },
    orderBy: { submittedAt: "desc" },
    take: 200,
  });

  const VALID = new Set(["wore-it", "changed-something", "didnt-wear-it"]);

  return rows
    .filter((row) => VALID.has(row.outcomeStatus))
    .map((row) => ({
      suggestionId: row.suggestionId,
      status: row.outcomeStatus as OutcomeFact["status"],
      register: styleMeSessionRegister(
        row.suggestion?.session?.occasion ?? null,
        row.suggestion?.session?.formalityConditional ?? null,
      ),
      garmentIds: (row.suggestion?.items ?? [])
        .map((item) => item.closetItemId)
        .filter((id): id is string => Boolean(id)),
    }));
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
