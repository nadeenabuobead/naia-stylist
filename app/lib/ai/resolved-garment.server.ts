// app/lib/ai/resolved-garment.server.ts
//
// Garment Intelligence — Phase 1: canonical per-garment resolution.
//
// Extracted verbatim from wardrobe-intelligence.server.ts's per-item loop
// (Phase 1 of the Garment Intelligence integration recon). This is a
// mechanical extraction, not a redesign: resolveGarment() computes exactly
// what that loop computed, in exactly the same order, with exactly the
// same precedence. Wardrobe Intelligence is the only caller today; it
// keeps building its own WardrobeGarment by spreading this function's
// output together with WI-specific fields that never moved (see below).
//
// Precedence, unchanged from WI's own original comment:
//   admin intelligence override  >  hand-curated StyleMe profile  >  nAia-derived
//
// Garment Intelligence layer boundary (recon section F): this module must
// never import or consume customer-intelligence-*, StyleMe demand/outcome,
// Buy-or-Skip, or wardrobe-gap findings. Its only "customer" input is
// StylingPassportInput — the same narrow, already-existing garment-
// derivation input deriveGarmentStylingIntelligence has always taken
// (favourite/avoid colours, silhouette preference, etc.) — never the
// broader WardrobePassport type, and never anything from a session/demand/
// outcome source. That boundary already existed before this extraction;
// this file just makes it a real module boundary instead of an inline one.
//
// What did NOT move here, and why (recon section 5 — WI-specific vs
// garment-intrinsic):
//   - imageUrl: depends on a caller-supplied, per-request imageUrlById map
//     (signed Cloudinary URLs). Two different callers can legitimately
//     pass different maps for the identical garment — this is a display
//     concern, not a fact about what the garment is.
//   - outfitAppearances / savedLookAppearances / outcomeKept / changed /
//     notWorn / observedWear: usage-history tallies from entirely separate
//     queries (OutfitItem, SavedLookItem, StyleMeOutcome) that run
//     alongside, not inside, the effective/classification/derive/curate/
//     override resolution chain this module extracts. They answer "how
//     has this customer used this garment", not "what is this garment" —
//     WI's own usage overlay, not garment truth.
// WardrobeGarment = ResolvedGarment + exactly those WI-specific fields.

import { getEffectiveClosetItem, type IntelligenceOverrides, type ClosetItemFields } from "~/lib/admin/closet-review.server";
import {
  deriveGarmentStylingIntelligence,
  ALL_INTENTIONS,
  type StylingPassportInput,
} from "~/lib/admin/garment-intelligence-v1.server";
import type { ClosetClassification } from "~/lib/admin/closet-intelligence.server";
import { closetItemToSlot } from "~/lib/ai/closet-slot";
import type { ResolvedIntentionStrength, ResolvedVisualWeight, ResolvedColourProfile } from "~/lib/ai/wardrobe-intelligence";

// db.server is plain JS, so the Prisma client is untyped at this boundary —
// same reasoning as wardrobe-intelligence.server.ts's own ClosetItemRow.
export type ResolvableClosetItem = ClosetItemFields & {
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

export type IntelligenceSource = "curated" | "derived" | "none";

/**
 * The canonical per-garment resolution — garment intelligence only. See the
 * module doc for exactly which WardrobeGarment fields are deliberately
 * excluded and why. Field order and precedence below are copied verbatim
 * from wardrobe-intelligence.server.ts's original inline loop.
 */
export interface ResolvedGarment {
  id: string;
  name: string | null;
  category: string;
  subcategory: string | null;
  slot: string;

  primaryColor: string | null;
  colors: string[];
  pattern: string | null;
  material: string | null;
  silhouette: string | null;
  fitProfile: string | null;
  formality: string | null;
  stylePersonality: string | null;
  occasions: string[];
  seasons: string[];
  garmentRelationships: string[];
  analysisStatus: string;

  visualWeight: ResolvedVisualWeight | null;
  colourProfile: ResolvedColourProfile | null;
  intentions: Record<string, ResolvedIntentionStrength> | null;
  intentionsSource: "curated" | "derived" | null;
  intelligenceSource: IntelligenceSource;

  sleeveLength: string | null;
  necklineCoverage: string | null;
  hemLength: string | null;
  topLength: string | null;
  midriffExposed: boolean | null;
  shoulderCoverage: boolean | null;
}

export function resolveGarment(item: ResolvableClosetItem, passportInput: StylingPassportInput | null): ResolvedGarment {
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
  let source: IntelligenceSource = visualWeight === null ? "none" : "derived";
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

    // Coverage facts, passed through exactly as stored. These drive WI's
    // needs layer's usable-vs-blocked split, so a null here must stay null:
    // it means "not read", never "complies".
    sleeveLength: effective.sleeveLength ?? null,
    necklineCoverage: effective.necklineCoverage ?? null,
    hemLength: effective.hemLength ?? null,
    topLength: effective.topLength ?? null,
    midriffExposed: effective.midriffExposed ?? null,
    shoulderCoverage: effective.shoulderCoverage ?? null,
  };
}
