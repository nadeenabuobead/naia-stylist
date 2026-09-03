// app/lib/ai/styleme-recommendation.ts
// Deterministic StyleMe recommendation and outfit-composition engine.
// Phase 3C — do NOT wire into result.tsx until Phase 3D.

import {
  PRODUCT_TEMPLATE_FIELDS,
  PSM_NORMALIZATION_MAP,
  PSM_SUPPLEMENTAL_PRODUCT_TOKENS,
  STYLE_PERSONALITY_STYLE_TAG_FALLBACK,
  PROFILE_SP_V2_TO_V3_MAP,
  STYLING_EFFORT_RULE,
  PROVISIONAL_EVIDENCE,
  PROFILE_DESIRED_FEELING_TRANSLATION,
  PROFILE_FIT_PREFERENCE_SMCM_MAP,
  PROFILE_SILHOUETTE_SMCM_MAP,
  PROFILE_COVERAGE_PREFERRED_VALUE,
  PROFILE_COVERAGE_MULTI_IDS,
  PROFILE_LIFESTYLE_OCCASION_MAP,
  PROFILE_DESIRED_IMPRESSION_DFM_MAP,
  PROFILE_BECOMING_DFM_MAP,
} from "./signal-contract.js";
import {
  getAllCatalogProducts,
  getProductByHandle,
  getRecommendationEligibleProducts,
} from "./naia-catalog.js";
import type { GeneratedCatalogProduct, ProductItemType } from "./naia-catalog.types.js";
import type {
  StyleMeEngineInput,
  StyleMeProfileSignals,
  StyleMeSessionInput,
  AnchorInput,
  NadineAnchorInput,
  ClosetAnchorInput,
  NormalizedNadineAnchor,
  NormalizedClosetAnchor,
  NormalizedStyleAnchor,
  OutfitSlot,
  EvidenceEffect,
  EvidenceCode,
  EvidenceEntry,
  AnchorCompatibility,
  ProductEvaluation,
  RankedProduct,
  OutfitPlan,
  StyleMeRecommendationResult,
  ClosetCompatibilityItem,
  ClosetCompatibilityResult,
  SemanticTieBreak,
} from "./styleme-recommendation.types.js";

// ─── Exported scoring weights ─────────────────────────────────────────────────

export const SCORING_WEIGHTS = {
  STRONG_RANK: 4,
  RANK: 2,
  LIGHT_RANK: 1,
  DEPRIORITISE: -3,
  DIVERSITY_PENALTY: -1,
  DUAL_MOOD_BONUS: 2,
  LIKE_MYSELF_SP_BONUS: 2,
  STYLING_EFFORT_LOW: 1,
  STYLING_EFFORT_HIGH: -2,
} as const;

// ─── Formality ranges ─────────────────────────────────────────────────────────

export const FORMALITY_RANGES: Readonly<
  Record<string, { target: number; min: number; max: number }>
> = {
  "formality-relaxed": { target: 2, min: 1, max: 3 },
  "formality-smart": { target: 3, min: 2, max: 4 },
  "formality-polished": { target: 4, min: 3, max: 5 },
  "formality-occasion": { target: 5, min: 4, max: 5 },
} as const;

// ─── Slot exclusion table ─────────────────────────────────────────────────────
// If anchor slot is KEY, the recommendation slots in VALUE[] are hard-excluded.
// Rules encoded:
//   - No same-type primary garment duplication
//   - Dress/set act as complete outfits — cannot receive top/bottom/dress/set
//   - Dress anchor cannot receive a bottom (spec explicit)
//   - Set anchor cannot receive another primary garment

export const SLOT_EXCLUSIONS: Readonly<Record<OutfitSlot, readonly OutfitSlot[]>> = {
  top: ["top", "dress", "set"],
  bottom: ["bottom", "dress", "set"],
  dress: ["bottom"],
  set: ["top", "bottom", "dress", "set"],
  outerwear: ["outerwear"],
  shoe: [],
  bag: [],
  accessory: [],
  jewelry: [],
  unknown: [],
} as const;

// ─── SET anchor: explicit component-coverage registry ────────────────────────
// Stores the ACTUAL garment component slots occupied by each NADINE SET product.
// Only add an entry when the product's catalog styleableComponents explicitly document
// which slots it occupies — not what conflicts to exclude.
//
// Hard exclusions are DERIVED from these components by deriveForbiddenFromSetComponents:
//   occupied TOP → forbid TOP candidates
//   occupied BOTTOM → forbid BOTTOM candidates
//   occupied TOP + BOTTOM → also forbid DRESS and SET (they replace a complete top+bottom base)
//
// A SET anchor with no entry (Closet SETs, future unmapped NADINE SETs) gets components=[]
// and therefore forbidden=[] — conservative, no garment slots excluded.
export const NADINE_SET_COVERED_SLOTS: Readonly<Record<string, readonly OutfitSlot[]>> = {
  // dress-set / Becoming Defined: styleableComponents — wrapped-top/corset (TOP) + skirt (BOTTOM).
  "dress-set": ["top", "bottom"],
} as const;

// Derives the hard-exclusion slot list from the actual component slots a SET occupies.
// Does not read from SLOT_EXCLUSIONS — exclusions are a consequence of component coverage.
export function deriveForbiddenFromSetComponents(
  occupiedSlots: readonly OutfitSlot[],
): readonly OutfitSlot[] {
  if (occupiedSlots.length === 0) return [];
  const forbidden = new Set<OutfitSlot>(occupiedSlots as OutfitSlot[]);
  // A complete top+bottom base conflicts with DRESS and SET candidates:
  // — a DRESS would replace both top and bottom, creating a redundant base layer
  // — another SET would duplicate the complete garment foundation
  if (forbidden.has("top") && forbidden.has("bottom")) {
    forbidden.add("dress");
    forbidden.add("set");
  }
  return [...forbidden];
}

// ─── §11.7 Aspiration concept vocabulary (feature-local, not exported) ───────
// Maps DFM tokens → canonical concept keys used for cross-field dedup in §11.7.
// Covers only the 6 concepts reachable from the approved aspiration maps.
const ASPIRATION_DFM_TO_CONCEPT: Readonly<Record<string, string>> = {
  "more-confident":    "confident",
  "more-effortless":   "effortless",
  "more-elevated":     "elevated",
  "more-feminine":     "feminine",
  "more-powerful":     "powerful",
  "more-put-together": "put-together",
} as const;

// Maps style personality IDs → canonical concept keys.
// V2 + V3 confirmed semantic equivalences only; do not broaden.
const ASPIRATION_SP_TO_CONCEPT: Readonly<Record<string, string>> = {
  "feminine":          "feminine",
  "effortlessly-chic": "effortless",
  // V3 equivalences (Group 1)
  "feminine-romantic": "feminine",
  "minimal-relaxed":   "effortless",
} as const;

// ─── Minimum thresholds ───────────────────────────────────────────────────────

export const THRESHOLDS = {
  MIN_TOTAL_SCORE: 2,
  MIN_POSITIVE_EVIDENCE_COUNT: 1,
  MAX_ALTERNATIVES: 2,
} as const;

// ─── Catalog color → session colour-id normalization ─────────────────────────
// Catalog stores human-readable color names; session stores canonical IDs from
// the today-colours vocabulary.

const COLOR_VOCAB_MAP: Readonly<Record<string, string>> = {
  "burgundy": "red-burgundy",
  "rust": "red-burgundy",
  "dark red": "red-burgundy",
  "red": "red-burgundy",
  "cream": "white-cream",
  "ivory": "white-cream",
  "white": "white-cream",
  "beige": "beige-brown",
  "tan": "beige-brown",
  "taupe": "beige-brown",
  "caramel": "beige-brown",
  "dark caramel": "beige-brown",
  "espresso brown": "beige-brown",
  "dark brown": "beige-brown",
  "brown": "beige-brown",
  "black": "black",
  "art print": "prints",
  "printed beige/espresso": "prints",
  "espresso/black art print": "prints",
  "grey": "grey",
  "gray": "grey",
  "navy": "navy",
  "green": "green",
  "pink": "pink",
  "yellow": "yellow",
  "orange": "orange",
} as const;

function catalogColorToVocabId(rawColor: string): string | null {
  return COLOR_VOCAB_MAP[rawColor.toLowerCase()] ?? null;
}

function catalogColorsToVocabIds(rawColors: string[]): Set<string> {
  const ids = new Set<string>();
  for (const c of rawColors) {
    const id = catalogColorToVocabId(c);
    if (id !== null) ids.add(id);
  }
  return ids;
}

// ─── Deterministic tie-break ──────────────────────────────────────────────────
// djb2-style hash. djb2str is private; deterministicRank is the public export
// kept for backward compatibility with existing tests.

function djb2str(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
  }
  return h >>> 0;
}

export function deterministicRank(handle: string): number {
  return djb2str(handle);
}

// Builds a canonical, sorted string representation of the full recommendation
// input. Used as the per-session prefix in the final tie-break hash so that two
// different valid answer combinations may resolve an otherwise exact tie
// differently, while the same complete input always yields the same result.
export function buildSessionFingerprint(
  session: StyleMeSessionInput,
  profile: StyleMeProfileSignals | undefined,
  anchor: NormalizedStyleAnchor | null,
  recentlyShownHandles: string[],
): string {
  const anchorToken = anchor === null
    ? "no-anchor"
    : anchor.type === "nadine"
    ? `nadine:${anchor.handle}`
    : `closet:${anchor.id}:${anchor.slot}`;
  return [
    [...session.moods].sort().join(","),
    [...session.desiredFeelings].sort().join(","),
    [...session.bodyNeeds].sort().join(","),
    session.coverageConditional ?? "",
    session.occasion,
    session.formalityConditional ?? "",
    [...session.todayColours.preferred].sort().join(","),
    [...session.todayColours.avoid].sort().join(","),
    [...session.practicalIds].sort().join(","),
    session.source,
    [...(profile?.stylePersonalities ?? [])].sort().join(","),
    [...(profile?.firmNoColors ?? [])].sort().join(","),
    [...(profile?.avoidColors ?? [])].sort().join(","),
    [...(profile?.desiredFeelings ?? [])].sort().join(","),
    [...(profile?.fitPreferences ?? [])].sort().join(","),
    [...(profile?.lifestyle ?? [])].sort().join(","),
    anchorToken,
    [...recentlyShownHandles].sort().join(","),
  ].join("|");
}

// ─── Slot mapping ─────────────────────────────────────────────────────────────

function itemTypeToSlot(itemType: ProductItemType): OutfitSlot {
  switch (itemType) {
    case "TOP": return "top";
    case "BOTTOM": return "bottom";
    case "DRESS": return "dress";
    case "SET": return "set";
    case "OUTERWEAR": return "outerwear";
    default: return "unknown";
  }
}

const CLOSET_CATEGORY_TO_SLOT: Record<string, OutfitSlot> = {
  TOPS: "top",
  BOTTOMS: "bottom",
  DRESSES: "dress",
  SETS: "set",
  OUTERWEAR: "outerwear",
  SHOES: "shoe",
  BAGS: "bag",
  ACCESSORIES: "accessory",
  JEWELRY: "jewelry",
};

function closetCategoryToSlot(category: string): OutfitSlot {
  return CLOSET_CATEGORY_TO_SLOT[category] ?? "unknown";
}

// ─── Closet general-pairing vocabulary ───────────────────────────────────────
// Maps a Closet anchor slot to the bounded garment-category tokens we look for
// in a NADINE product's bestPairedWithGeneral field.
// Only exact token vocabulary from spec: top, shirt, blouse, knit, trousers,
// pants, skirt, dress, jacket, coat (plus common plural/synonym forms).
// The avoid check uses the same tokens but requires the token to be the entire
// comma-separated segment (no modifiers) — this is conservative by design and
// produces no false positives with descriptive avoid prose.

export const CLOSET_SLOT_PAIRING_TOKENS: Readonly<Record<OutfitSlot, readonly string[]>> = {
  top:      ["top", "tops", "shirt", "shirts", "blouse", "blouses", "knit", "knits", "bodysuit", "bodysuits", "camisole", "camisoles", "tank", "tanks"],
  bottom:   ["trouser", "trousers", "pants", "skirt", "skirts", "denim", "shorts"],
  dress:    ["dress", "dresses"],
  outerwear:["coat", "coats", "jacket", "jackets", "trench", "layer", "layers"],
  set:      [],
  shoe:     [],
  bag:      [],
  accessory:[],
  jewelry:  [],
  unknown:  [],
} as const;

/**
 * Splits avoidPairingWithGeneral prose into normalised segments.
 * Each comma-separated phrase is lowercased and stripped of a leading "or ".
 * A bounded-vocabulary token must equal the ENTIRE segment to trigger a match —
 * qualified phrases like "bulky cargo trousers" do not match the plain token "trousers".
 */
export function parseGeneralAvoidSegments(prose: string): string[] {
  return prose
    .split(",")
    .map((s) => s.replace(/^\s*or\s+/i, "").trim().toLowerCase())
    .filter((s) => s.length > 0);
}

/**
 * Returns the first token from `tokens` that is an exact member of `avoidSegments`,
 * or null when none matches.  Used by scoreClosetCompatibility and exported for testing.
 */
export function findExactAvoidToken(
  avoidSegments: string[],
  tokens: readonly string[],
): string | null {
  for (const token of tokens) {
    if (avoidSegments.includes(token)) return token;
  }
  return null;
}

// True when `word` appears at a word boundary in `text` (case-insensitive).
function containsWholeWord(text: string, word: string): boolean {
  return new RegExp(`\\b${word}\\b`, "i").test(text);
}

// ─── Closet compatibility scoring ────────────────────────────────────────────

function scoreClosetCompatibility(
  product: GeneratedCatalogProduct,
  closetAnchor: NormalizedClosetAnchor,
): ClosetCompatibilityResult {
  if (!closetAnchor.hasStrongEvidence) {
    return { confidence: "insufficient", items: [], totalPoints: 0 };
  }

  const items: ClosetCompatibilityItem[] = [];
  const { rankings, pairings } = product.parsed;
  const anchorSlot = closetAnchor.slot;
  const tokens = CLOSET_SLOT_PAIRING_TOKENS[anchorSlot];

  // 1. General pairing — positive (bestPairedWithGeneral)
  //    Add ONE entry for the first token found; whole-word boundary match.
  let generalPositiveMatched = false;
  for (const token of tokens) {
    if (containsWholeWord(pairings.bestPairedWithGeneral, token)) {
      items.push({
        closetField: "category",
        productField: PRODUCT_TEMPLATE_FIELDS.BEST_PAIRED_WITH_GENERAL,
        matchedToken: token,
        effect: "LIGHT_RANK",
        points: SCORING_WEIGHTS.LIGHT_RANK,
        isExact: true,
      });
      generalPositiveMatched = true;
      break;
    }
  }

  // 2. General pairing — avoid (avoidPairingWithGeneral)
  //    Only match when the token is the ENTIRE comma-separated segment (plain,
  //    no modifiers). In the current V8 catalog all avoid segments carry
  //    qualifiers, so this produces zero matches by design. The mechanism is
  //    here for correctness and future catalogs.
  const avoidSegments = parseGeneralAvoidSegments(pairings.avoidPairingWithGeneral);
  const avoidToken = findExactAvoidToken(avoidSegments, tokens);
  if (avoidToken !== null) {
    items.push({
      closetField: "category",
      productField: PRODUCT_TEMPLATE_FIELDS.AVOID_PAIRING_WITH_GENERAL,
      matchedToken: avoidToken,
      effect: "DEPRIORITISE",
      points: SCORING_WEIGHTS.DEPRIORITISE,
      isExact: true,
    });
  }

  // 3. Style tag overlap — one entry for the first shared tag.
  for (const tag of closetAnchor.styleTags) {
    if (rankings.styleTags.includes(tag)) {
      items.push({
        closetField: "styleTags",
        productField: PRODUCT_TEMPLATE_FIELDS.STYLE_TAGS,
        matchedToken: tag,
        effect: "LIGHT_RANK",
        points: SCORING_WEIGHTS.LIGHT_RANK,
        isExact: true,
      });
      break;
    }
  }

  // 4. Occasion overlap — one entry for the first shared occasion.
  for (const occ of closetAnchor.occasions) {
    if (rankings.occasionTags.includes(occ)) {
      items.push({
        closetField: "occasions",
        productField: PRODUCT_TEMPLATE_FIELDS.OCCASION_TAGS,
        matchedToken: occ,
        effect: "LIGHT_RANK",
        points: SCORING_WEIGHTS.LIGHT_RANK,
        isExact: true,
      });
      break;
    }
  }

  // 5. Material — documentary only. No score per spec; closetAnchor.material is
  //    recorded in normalizedColorIds/evidenceFields for Phase 3D prose generation.
  //    Phase 3C does not score material to avoid guessing from unstructured strings.

  // 6. Colour — documentary only per spec.
  //    normalizedColorIds is recorded on the anchor for Phase 3D explanation.
  //    No score here; colour conflict or harmony is resolved in Phase 3D.

  const positiveCount = items.filter((i) => i.points > 0).length;
  const hasGeneralPairing = generalPositiveMatched;

  let confidence: ClosetCompatibilityResult["confidence"];
  if (hasGeneralPairing && positiveCount >= 2) {
    confidence = "high";
  } else if (positiveCount >= 1) {
    confidence = "medium";
  } else {
    confidence = "low";
  }

  const totalPoints = items.reduce((sum, i) => sum + i.points, 0);
  return { confidence, items, totalPoints };
}

// ─── Provisional evidence lookup ──────────────────────────────────────────────

const PROVISIONAL_BY_HANDLE_FIELD = new Map<string, Set<string>>();

for (const entry of PROVISIONAL_EVIDENCE) {
  const key = entry.productHandle;
  const existing = PROVISIONAL_BY_HANDLE_FIELD.get(key);
  if (existing) {
    existing.add(`${entry.field}:${entry.canonicalValue}`);
  } else {
    PROVISIONAL_BY_HANDLE_FIELD.set(key, new Set([`${entry.field}:${entry.canonicalValue}`]));
  }
}

function getProvisionalNote(
  handle: string,
  field: string,
  value: string,
): string | undefined {
  const key = `${field}:${value}`;
  if (!PROVISIONAL_BY_HANDLE_FIELD.get(handle)?.has(key)) return undefined;
  return PROVISIONAL_EVIDENCE.find(
    (e) => e.productHandle === handle && e.field === field && e.canonicalValue === value,
  )?.provisionalNote;
}

// ─── Pairing prose helpers ────────────────────────────────────────────────────
// Checks whether a product title is directly mentioned in NADINE pairing prose.
// Occurrences preceded by "from " (component references) are treated separately
// because "leather underlayer from Becoming Alive" is not the same as avoiding
// or recommending the complete Becoming Alive product.

function isDirectlyMentionedInProse(prose: string, title: string): boolean {
  let pos = prose.indexOf(title);
  while (pos !== -1) {
    const prefix = prose.slice(Math.max(0, pos - 5), pos);
    if (!prefix.endsWith("from ")) return true;
    pos = prose.indexOf(title, pos + 1);
  }
  return false;
}

function isComponentMentionedInProse(prose: string, title: string): boolean {
  return prose.includes(`from ${title}`);
}

// ─── Anchor resolution ────────────────────────────────────────────────────────

export function resolveNadineAnchor(
  input: NadineAnchorInput,
): NormalizedNadineAnchor | null {
  const product = getProductByHandle(input.handle);
  if (!product) return null;

  const { identity, rankings, scalars, pairings } = product.parsed;

  return {
    type: "nadine",
    handle: product.handle,
    title: identity.verifiedTitle,
    slot: itemTypeToSlot(identity.itemType),
    colors: identity.colors,
    stylePersonalityMatch: rankings.stylePersonalityMatch,
    formalityScore: scalars.formalityScore,
    bestPairedWith: pairings.bestPairedWithNadinePieces,
    conditionalPairings: pairings.conditionalNadinePairings,
    avoidPairingWith: pairings.avoidPairingWithNadinePieces,
  };
}

export function resolveClosetAnchor(
  input: ClosetAnchorInput,
): NormalizedClosetAnchor {
  const slot = closetCategoryToSlot(input.category);
  const evidenceFields: string[] = [];

  if (input.colors.length > 0) evidenceFields.push("colors");
  if (input.styleTags.length > 0) evidenceFields.push("styleTags");
  if (input.occasions.length > 0) evidenceFields.push("occasions");
  if (input.material) evidenceFields.push("material");

  return {
    type: "closet",
    id: input.id,
    label: input.name ?? input.category,
    slot,
    colors: input.colors,
    normalizedColorIds: [...catalogColorsToVocabIds(input.colors)],
    styleTags: input.styleTags,
    occasions: input.occasions,
    material: input.material,
    hasStrongEvidence: slot !== "unknown",
    evidenceFields,
    imageUrl: input.imageUrl ?? null,
  };
}

// ─── Hard exclusion check ─────────────────────────────────────────────────────

function checkHardExclusions(
  product: GeneratedCatalogProduct,
  productSlot: OutfitSlot,
  anchor: NormalizedStyleAnchor | null,
  firmNoColorIds: Set<string>,
  productColorIds: Set<string>,
  dressingPreferenceIds: Set<string>,
): { isExcluded: boolean; reasons: EvidenceCode[] } {
  const reasons: EvidenceCode[] = [];

  if (anchor !== null) {
    // Self-exclusion (NADINE anchor only)
    if (anchor.type === "nadine" && anchor.handle === product.handle) {
      reasons.push("self-exclusion");
    }

    // Slot conflict.
    // For non-SET slots: use SLOT_EXCLUSIONS directly (product type is unambiguous).
    // For SET slot: forbidden list is DERIVED from actual occupied component slots via
    // deriveForbiddenFromSetComponents — not inferred from anchor type or "set" slot alone.
    // Source of components: NADINE_SET_COVERED_SLOTS[handle] for NADINE anchors, [] for Closet.
    // Unknown/unmapped anchors get components=[] → forbidden=[] → conservative.
    const setComponents: readonly OutfitSlot[] =
      anchor.slot === "set"
        ? anchor.type === "nadine"
          ? (NADINE_SET_COVERED_SLOTS[anchor.handle] ?? [])
          : []
        : [];
    const forbidden: readonly OutfitSlot[] =
      anchor.slot !== "set"
        ? SLOT_EXCLUSIONS[anchor.slot]
        : deriveForbiddenFromSetComponents(setComponents);
    if (forbidden.includes(productSlot)) {
      const code = slotConflictCode(anchor.slot, productSlot);
      reasons.push(code);
    }

    // NADINE avoid-pairing
    if (anchor.type === "nadine" && anchor.avoidPairingWith !== null) {
      const candidateTitle = product.parsed.identity.verifiedTitle;
      if (isDirectlyMentionedInProse(anchor.avoidPairingWith, candidateTitle)) {
        reasons.push("nadine-avoid-exclusion");
      }
    }
  }

  // Profile firm-no colours
  for (const colorId of firmNoColorIds) {
    if (productColorIds.has(colorId)) {
      reasons.push("firm-no-colour-exclusion");
      break;
    }
  }

  // Dressing-preference hard exclusions (Group 2 — metadata-driven)
  // product.dressingMetadata is injected by naia-catalog.ts at module load.
  // Missing-metadata behaviour: fail-closed for all constraints except wears-hijab (permissive).
  if (dressingPreferenceIds.size > 0) {
    const dressing = product.dressingMetadata;
    const itemType = product.parsed.identity.itemType;
    let dressingFailed = false;

    // dresses-modestly → require modestySafe: true (fail closed when absent)
    if (!dressingFailed && dressingPreferenceIds.has("dresses-modestly")) {
      dressingFailed = !dressing || !dressing.modestySafe;
    }

    // usually-wears-abayas → require abayaCompatible: true (fail closed when absent)
    if (!dressingFailed && dressingPreferenceIds.has("usually-wears-abayas")) {
      dressingFailed = !dressing || !dressing.abayaCompatible;
    }

    // wears-hijab → exclude when hijabCompatible: false; permissive when absent from catalog
    if (!dressingFailed && dressingPreferenceIds.has("wears-hijab")) {
      dressingFailed = dressing !== undefined && !dressing.hijabCompatible;
    }

    // arms-covered → sleeveLength must be full or three-quarter
    // n/a (BOTTOM) = exempt; absent metadata = fail closed
    if (!dressingFailed && dressingPreferenceIds.has("arms-covered")) {
      if (!dressing) {
        dressingFailed = true;
      } else if (dressing.sleeveLength !== "n/a") {
        dressingFailed = dressing.sleeveLength !== "full" && dressing.sleeveLength !== "three-quarter";
      }
      // sleeveLength "n/a" (BOTTOM) → exempt
    }

    // chest-neckline-covered → necklineCoverage must be high/crew/mock/cowl-high
    // n/a (BOTTOM or outerwear without wrap-variable) = exempt; absent = fail closed
    if (!dressingFailed && dressingPreferenceIds.has("chest-neckline-covered")) {
      if (!dressing) {
        dressingFailed = true;
      } else if (dressing.necklineCoverage !== "n/a") {
        const safe = dressing.necklineCoverage === "high" || dressing.necklineCoverage === "crew"
          || dressing.necklineCoverage === "mock" || dressing.necklineCoverage === "cowl-high";
        dressingFailed = !safe;
      }
      // necklineCoverage "n/a" → exempt
    }

    // legs-covered → hemLength must be full/maxi/midi
    // n/a (TOP or OUTERWEAR) = exempt; absent = fail closed
    if (!dressingFailed && dressingPreferenceIds.has("legs-covered")) {
      if (!dressing) {
        dressingFailed = true;
      } else if (dressing.hemLength !== "n/a") {
        const safe = dressing.hemLength === "full" || dressing.hemLength === "maxi" || dressing.hemLength === "midi";
        dressingFailed = !safe;
      }
      // hemLength "n/a" (TOP/OUTERWEAR) → exempt
    }

    // longer-tops → topLength must be hip-length/longline/tunic (TOP and SET only)
    // n/a on a TOP/SET = fail closed (missing data); other item types = not applicable
    if (!dressingFailed && dressingPreferenceIds.has("longer-tops")
        && (itemType === "TOP" || itemType === "SET")) {
      if (!dressing || dressing.topLength === "n/a") {
        dressingFailed = true;
      } else {
        const safe = dressing.topLength === "hip-length" || dressing.topLength === "longline"
          || dressing.topLength === "tunic";
        dressingFailed = !safe;
      }
    }

    // no-cropped-tops → topLength must not be cropped (TOP and SET only)
    // n/a on a TOP/SET = fail closed; other item types = not applicable
    if (!dressingFailed && dressingPreferenceIds.has("no-cropped-tops")
        && (itemType === "TOP" || itemType === "SET")) {
      if (!dressing || dressing.topLength === "n/a") {
        dressingFailed = true;
      } else {
        dressingFailed = dressing.topLength === "cropped";
      }
    }

    // looser-fitting → fitProfile must be relaxed/loose/oversized/flowy (fail closed when absent)
    if (!dressingFailed && dressingPreferenceIds.has("looser-fitting")) {
      if (!dressing) {
        dressingFailed = true;
      } else {
        const safe = dressing.fitProfile === "relaxed" || dressing.fitProfile === "loose"
          || dressing.fitProfile === "oversized" || dressing.fitProfile === "flowy";
        dressingFailed = !safe;
      }
    }

    if (dressingFailed) {
      reasons.push("dressing-preference-exclusion");
    }
  }

  return { isExcluded: reasons.length > 0, reasons };
}

function slotConflictCode(anchorSlot: OutfitSlot, productSlot: OutfitSlot): EvidenceCode {
  if (anchorSlot === "top" && productSlot === "top") return "slot-conflict-top-top";
  if (anchorSlot === "top" && productSlot === "dress") return "slot-conflict-top-dress";
  if (anchorSlot === "top" && productSlot === "set") return "slot-conflict-top-set";
  if (anchorSlot === "bottom" && productSlot === "bottom") return "slot-conflict-bottom-bottom";
  if (anchorSlot === "bottom" && productSlot === "dress") return "slot-conflict-bottom-dress";
  if (anchorSlot === "bottom" && productSlot === "set") return "slot-conflict-bottom-set";
  if (anchorSlot === "dress" && productSlot === "bottom") return "slot-conflict-dress-bottom";
  if (anchorSlot === "set") return "slot-conflict-set-primary";
  if (anchorSlot === "outerwear" && productSlot === "outerwear") return "slot-conflict-outerwear-outerwear";
  return "slot-conflict-set-primary"; // fallback (shouldn't reach)
}

// ─── Anchor compatibility ─────────────────────────────────────────────────────

function computeAnchorCompatibility(
  product: GeneratedCatalogProduct,
  anchor: NormalizedStyleAnchor | null,
): AnchorCompatibility {
  if (anchor === null) {
    return { status: "compatible", isHardExclusion: false };
  }

  if (anchor.type === "closet") {
    if (!anchor.hasStrongEvidence) {
      return { status: "insufficient-evidence", isHardExclusion: false };
    }
    return { status: "compatible", isHardExclusion: false };
  }

  // NADINE anchor
  const candidateTitle = product.parsed.identity.verifiedTitle;
  const { bestPairedWith, conditionalPairings, avoidPairingWith } = anchor;

  // Check avoid (hard exclusion already checked, but we still need to set status)
  if (avoidPairingWith !== null && isDirectlyMentionedInProse(avoidPairingWith, candidateTitle)) {
    return {
      status: "incompatible",
      isHardExclusion: true,
      exclusionReason: "nadine-avoid-exclusion",
      pairingNote: extractMentionContext(avoidPairingWith, candidateTitle),
    };
  }

  let pairingNote: string | undefined;
  let conditions: string | undefined;
  let status: AnchorCompatibility["status"] = "compatible";

  if (bestPairedWith !== null && isDirectlyMentionedInProse(bestPairedWith, candidateTitle)) {
    pairingNote = extractMentionContext(bestPairedWith, candidateTitle);
    status = "compatible";
  } else if (bestPairedWith !== null && isComponentMentionedInProse(bestPairedWith, candidateTitle)) {
    pairingNote = extractComponentContext(bestPairedWith, candidateTitle);
    status = "compatible";
  }

  if (conditionalPairings !== null && conditionalPairings.includes(candidateTitle)) {
    conditions = extractMentionContext(conditionalPairings, candidateTitle);
    status = "compatible-with-conditions";
  }

  if (pairingNote === undefined && conditions === undefined) {
    return { status: "compatible", isHardExclusion: false };
  }

  return { status, isHardExclusion: false, pairingNote, conditions };
}

function extractMentionContext(prose: string, title: string): string {
  const idx = prose.indexOf(title);
  if (idx === -1) return "";
  const start = Math.max(0, idx - 30);
  const end = Math.min(prose.length, idx + title.length + 60);
  return prose.slice(start, end).trim();
}

function extractComponentContext(prose: string, title: string): string {
  const idx = prose.indexOf(`from ${title}`);
  if (idx === -1) return "";
  const end = Math.min(prose.length, idx + `from ${title}`.length + 40);
  return prose.slice(idx, end).trim();
}

// ─── Signal scoring ───────────────────────────────────────────────────────────

interface ScoreAccumulator {
  positive: EvidenceEntry[];
  negative: EvidenceEntry[];
  total: number;
}

function addEntry(
  acc: ScoreAccumulator,
  entry: EvidenceEntry,
): void {
  if (entry.points > 0) {
    acc.positive.push(entry);
  } else if (entry.points < 0) {
    acc.negative.push(entry);
  }
  acc.total += entry.points;
}

function makeEntry(
  field: string,
  matchedToken: string,
  sessionSignal: string,
  effect: EvidenceEffect,
  points: number,
  handle: string,
  opts: { isFallback?: boolean; isSupplemental?: boolean } = {},
): EvidenceEntry {
  const provisionalNote = getProvisionalNote(handle, field, matchedToken);
  return {
    field,
    matchedToken,
    sessionSignal,
    effect,
    points,
    isProvisional: provisionalNote !== undefined,
    provisionalNote,
    isFallback: opts.isFallback ?? false,
    isSupplemental: opts.isSupplemental ?? false,
  };
}

function scoreProduct(
  product: GeneratedCatalogProduct,
  session: StyleMeSessionInput,
  normalizedPracticalIds: string[],
  profile: StyleMeProfileSignals | undefined,
  anchor: NormalizedStyleAnchor | null,
  likeMyselfActive: boolean,
  recentlyShownHandles: string[],
): {
  acc: ScoreAccumulator;
  spMatchType: "direct" | "style-tags-fallback" | "none";
  psmType: "direct" | "supplemental-only" | "mixed" | "none";
  closetCompatibility: ClosetCompatibilityResult | null;
  hasEssMatch: boolean;
  hasDfmMatch: boolean;
  hasSmcmMatch: boolean;
  hasOccasionFormalityMatch: boolean;
  hasDirectSpMatch: boolean;
  hasDirectPsmMatch: boolean;
} {
  const { rankings, scalars, identity } = product.parsed;
  const handle = product.handle;
  const acc: ScoreAccumulator = { positive: [], negative: [], total: 0 };

  const productColorIds = catalogColorsToVocabIds(identity.colors);

  let hasEssMatch = false;
  let hasDfmMatch = false;
  let hasSmcmMatch = false;
  let hasOccasionFormalityMatch = false;

  // ── 1. ESS / Current Emotional State ─────────────────────────────────────
  const activeMoods = session.moods.filter((m) => m !== "neutral");
  let essMatchCount = 0;
  let stylingEffortActivated = false;

  for (const mood of activeMoods) {
    if (rankings.currentEmotionalStateSupport.includes(mood)) {
      addEntry(acc, makeEntry(
        PRODUCT_TEMPLATE_FIELDS.CURRENT_EMOTIONAL_STATE_SUPPORT,
        mood,
        mood,
        "STRONG_RANK",
        SCORING_WEIGHTS.STRONG_RANK,
        handle,
      ));
      essMatchCount++;
    }
    if (STYLING_EFFORT_RULE.activationMoods.includes(mood as typeof STYLING_EFFORT_RULE.activationMoods[number])) {
      stylingEffortActivated = true;
    }
  }

  hasEssMatch = essMatchCount > 0;

  // Dual-mood bonus
  if (essMatchCount >= 2 && activeMoods.length >= 2) {
    addEntry(acc, makeEntry(
      PRODUCT_TEMPLATE_FIELDS.CURRENT_EMOTIONAL_STATE_SUPPORT,
      "dual-mood-bonus",
      `${activeMoods[0]}+${activeMoods[1]}`,
      "RANK",
      SCORING_WEIGHTS.DUAL_MOOD_BONUS,
      handle,
    ));
  }

  // Styling Effort Rule
  if (stylingEffortActivated) {
    const el = scalars.stylingEffortLevel;
    if (el === "low") {
      addEntry(acc, makeEntry(
        PRODUCT_TEMPLATE_FIELDS.STYLING_EFFORT_LEVEL,
        el,
        "styling-effort-rule",
        "LIGHT_RANK",
        SCORING_WEIGHTS.STYLING_EFFORT_LOW,
        handle,
      ));
    } else if (el === "high") {
      addEntry(acc, makeEntry(
        PRODUCT_TEMPLATE_FIELDS.STYLING_EFFORT_LEVEL,
        el,
        "styling-effort-rule",
        "DEPRIORITISE",
        SCORING_WEIGHTS.STYLING_EFFORT_HIGH,
        handle,
      ));
    }
  }

  // ── 2. DFM / Desired Feeling ──────────────────────────────────────────────
  const dfmSignals = session.desiredFeelings.filter(
    (f) => f !== "like-myself", // handled via likeMyselfActive flag
  );

  for (const feeling of dfmSignals) {
    if (rankings.desiredFeelingMatch.includes(feeling)) {
      addEntry(acc, makeEntry(
        PRODUCT_TEMPLATE_FIELDS.DESIRED_FEELING_MATCH,
        feeling,
        feeling,
        "STRONG_RANK",
        SCORING_WEIGHTS.STRONG_RANK,
        handle,
      ));
      hasDfmMatch = true;
    }
  }

  // ── 3. SMCM / Body Needs ─────────────────────────────────────────────────
  const activeBodyNeeds = session.bodyNeeds.filter((n) => n !== "nothing-specific");

  for (const need of activeBodyNeeds) {
    if (rankings.styleMeComfortMatch.includes(need)) {
      addEntry(acc, makeEntry(
        PRODUCT_TEMPLATE_FIELDS.STYLE_ME_COMFORT_MATCH,
        need,
        need,
        "STRONG_RANK",
        SCORING_WEIGHTS.STRONG_RANK,
        handle,
      ));
      hasSmcmMatch = true;
    }
  }

  // ── 4. Coverage conditional ───────────────────────────────────────────────
  if (session.coverageConditional === "coverage-non-negotiable") {
    if (rankings.styleMeComfortMatch.includes("more-coverage")) {
      addEntry(acc, makeEntry(
        PRODUCT_TEMPLATE_FIELDS.STYLE_ME_COMFORT_MATCH,
        "more-coverage",
        "coverage-non-negotiable",
        "STRONG_RANK",
        SCORING_WEIGHTS.STRONG_RANK,
        handle,
      ));
      hasSmcmMatch = true;
    }
  } else if (session.coverageConditional === "coverage-flexible-with-layering") {
    if (rankings.styleMeComfortMatch.includes("more-coverage")) {
      addEntry(acc, makeEntry(
        PRODUCT_TEMPLATE_FIELDS.STYLE_ME_COMFORT_MATCH,
        "more-coverage",
        "coverage-flexible-with-layering",
        "RANK",
        SCORING_WEIGHTS.RANK,
        handle,
      ));
      hasSmcmMatch = true;
    }
  }

  // ── 5. Occasion ───────────────────────────────────────────────────────────
  if (rankings.occasionTags.includes(session.occasion)) {
    addEntry(acc, makeEntry(
      PRODUCT_TEMPLATE_FIELDS.OCCASION_TAGS,
      session.occasion,
      session.occasion,
      "STRONG_RANK",
      SCORING_WEIGHTS.STRONG_RANK,
      handle,
    ));
    hasOccasionFormalityMatch = true;
  }

  // ── 6. Formality ──────────────────────────────────────────────────────────
  if (session.formalityConditional !== null) {
    const range = FORMALITY_RANGES[session.formalityConditional];
    if (range !== undefined) {
      const fs = scalars.formalityScore;
      let points: number;
      let effect: EvidenceEffect;
      let code: EvidenceCode;

      if (fs >= range.min && fs <= range.max) {
        points = SCORING_WEIGHTS.STRONG_RANK;
        effect = "STRONG_RANK";
        code = "formality-match";
      } else {
        const gap = fs < range.min ? range.min - fs : fs - range.max;
        if (gap <= 1) {
          points = SCORING_WEIGHTS.RANK;
          effect = "RANK";
          code = "formality-adjacent";
        } else {
          points = SCORING_WEIGHTS.DEPRIORITISE;
          effect = "DEPRIORITISE";
          code = "formality-mismatch";
        }
      }

      if (points > 0) hasOccasionFormalityMatch = true;
      addEntry(acc, makeEntry(
        PRODUCT_TEMPLATE_FIELDS.FORMALITY_SCORE,
        String(fs),
        session.formalityConditional,
        effect,
        points,
        handle,
      ));
    }
  }

  // ── 7. Style Personalities (profile) ─────────────────────────────────────
  // V2 profile IDs are translated to V3 catalogue tokens before matching so
  // existing customers whose Passport stored a V2 ID continue to score against
  // the V3-only catalogue.  matchedToken stores the V3 token; sessionSignal
  // preserves the original profile value for evidence transparency.
  // scoredEffectiveSps guards against double-scoring when multiple V2 IDs
  // collapse to the same V3 archetype (e.g. "feminine"+"romantic" → one
  // "feminine-romantic" match, not two).
  let spMatchType: "direct" | "style-tags-fallback" | "none" = "none";
  const profileSPs = profile?.stylePersonalities ?? [];
  const scoredEffectiveSps = new Set<string>();

  for (const sp of profileSPs) {
    const effectiveSp = PROFILE_SP_V2_TO_V3_MAP[sp] ?? sp;
    if (scoredEffectiveSps.has(effectiveSp)) continue;
    if (rankings.stylePersonalityMatch.includes(effectiveSp)) {
      scoredEffectiveSps.add(effectiveSp);
      // Step 2A: demoted STRONG_RANK → RANK. Session answers must outrank
      // Passport background preferences — see the engine principle note above §11.5.
      addEntry(acc, makeEntry(
        PRODUCT_TEMPLATE_FIELDS.STYLE_PERSONALITY_MATCH,
        effectiveSp,   // V3 catalogue token that matched
        sp,            // original profile signal (V2 or V3)
        "RANK",
        SCORING_WEIGHTS.RANK,
        handle,
      ));
      spMatchType = "direct";

      // like-myself amplification
      if (likeMyselfActive) {
        addEntry(acc, makeEntry(
          PRODUCT_TEMPLATE_FIELDS.STYLE_PERSONALITY_MATCH,
          `${effectiveSp}:like-myself-bonus`,
          "like-myself",
          "RANK",
          SCORING_WEIGHTS.LIKE_MYSELF_SP_BONUS,
          handle,
        ));
      }
    } else if (
      STYLE_PERSONALITY_STYLE_TAG_FALLBACK.has(sp) &&
      rankings.styleTags.includes(sp)
    ) {
      scoredEffectiveSps.add(effectiveSp);
      addEntry(acc, makeEntry(
        PRODUCT_TEMPLATE_FIELDS.STYLE_TAGS,
        sp,
        sp,
        "LIGHT_RANK",
        SCORING_WEIGHTS.LIGHT_RANK,
        handle,
        { isFallback: true },
      ));
      if (spMatchType === "none") spMatchType = "style-tags-fallback";
    }
  }

  // ── 7.5. Profile Desired Feelings (background signal) ───────────────────
  // RANK weight — softer than session DFM STRONG_RANK.
  // "comfortable" routes to SMCM "relaxed" (not desiredFeelingMatch).
  // Only fires for feelings not already matched by the session's own desiredFeelings.
  {
    const sessionDfmTokens = new Set(dfmSignals);
    for (const feelingId of (profile?.desiredFeelings ?? [])) {
      const mappedToken = PROFILE_DESIRED_FEELING_TRANSLATION[feelingId];
      if (!mappedToken) continue;
      if (feelingId === "comfortable") {
        // Routes to SMCM, not DFM — skip if session already has "relaxed" in bodyNeeds
        if (!activeBodyNeeds.includes("relaxed") && rankings.styleMeComfortMatch.includes("relaxed")) {
          addEntry(acc, makeEntry(
            PRODUCT_TEMPLATE_FIELDS.STYLE_ME_COMFORT_MATCH,
            "relaxed",
            "profile-desired-feeling",
            "RANK",
            SCORING_WEIGHTS.RANK,
            handle,
          ));
        }
        continue;
      }
      if (sessionDfmTokens.has(mappedToken)) continue; // session already scored this token
      if (rankings.desiredFeelingMatch.includes(mappedToken)) {
        addEntry(acc, makeEntry(
          PRODUCT_TEMPLATE_FIELDS.DESIRED_FEELING_MATCH,
          mappedToken,
          "profile-desired-feeling",
          "RANK",
          SCORING_WEIGHTS.RANK,
          handle,
        ));
        hasDfmMatch = true;
      }
    }
  }

  // ── 8. PSM / Practical Support ────────────────────────────────────────────
  const noSpecialConstraint = session.practicalIds.includes("no-special-constraint");
  let psmDirectMatches = 0;
  let psmSupplementalOnly = true;

  if (!noSpecialConstraint) {
    for (const rawId of normalizedPracticalIds) {
      if (rawId === "no-special-constraint") continue;
      if (PSM_SUPPLEMENTAL_PRODUCT_TOKENS.has(rawId)) continue; // supplemental — not a session signal

      if (rankings.practicalSupportMatch.includes(rawId)) {
        addEntry(acc, makeEntry(
          PRODUCT_TEMPLATE_FIELDS.PRACTICAL_SUPPORT_MATCH,
          rawId,
          rawId,
          "STRONG_RANK",
          SCORING_WEIGHTS.STRONG_RANK,
          handle,
        ));
        psmDirectMatches++;
        psmSupplementalOnly = false;
      }
    }

    // Supplemental tokens in the product (explanation only — no scoring)
    const hasSupplemental = rankings.practicalSupportMatch.some((t) =>
      PSM_SUPPLEMENTAL_PRODUCT_TOKENS.has(t),
    );
    if (hasSupplemental && psmDirectMatches === 0) {
      psmSupplementalOnly = true;
    } else if (hasSupplemental && psmDirectMatches > 0) {
      psmSupplementalOnly = false;
    }
  }

  const psmType = noSpecialConstraint
    ? "none"
    : psmDirectMatches > 0
    ? psmSupplementalOnly
      ? "mixed" // actually direct + supplemental
      : "direct"
    : rankings.practicalSupportMatch.some((t) => PSM_SUPPLEMENTAL_PRODUCT_TOKENS.has(t))
    ? "supplemental-only"
    : "none";

  // ── 9. Today preferred colours ────────────────────────────────────────────
  const hasSessionPreferredColors = session.todayColours.preferred.length > 0;

  if (hasSessionPreferredColors) {
    const preferred = new Set(session.todayColours.preferred);
    let matched = false;
    for (const vocabId of productColorIds) {
      if (preferred.has(vocabId)) {
        matched = true;
        break;
      }
    }
    if (matched) {
      addEntry(acc, makeEntry(
        PRODUCT_TEMPLATE_FIELDS.COLORS,
        [...session.todayColours.preferred].join(","),
        "colour-preferred-today",
        "STRONG_RANK",
        SCORING_WEIGHTS.STRONG_RANK,
        handle,
      ));
    }
  } else if ((profile?.favoriteColors ?? []).length > 0) {
    // Profile favourite colours (soft signal when no session colour preference)
    const favIds = new Set(profile!.favoriteColors!);
    let matched = false;
    for (const vocabId of productColorIds) {
      if (favIds.has(vocabId)) {
        matched = true;
        break;
      }
    }
    if (matched) {
      addEntry(acc, makeEntry(
        PRODUCT_TEMPLATE_FIELDS.COLORS,
        [...profile!.favoriteColors!].join(","),
        "profile-colour-favourite",
        "RANK",
        SCORING_WEIGHTS.RANK,
        handle,
      ));
    }
  }

  // ── 10. Today avoided colours ─────────────────────────────────────────────
  if (session.todayColours.avoid.length > 0) {
    const avoided = new Set(session.todayColours.avoid);
    let matched = false;
    for (const vocabId of productColorIds) {
      if (avoided.has(vocabId)) {
        matched = true;
        break;
      }
    }
    if (matched) {
      addEntry(acc, makeEntry(
        PRODUCT_TEMPLATE_FIELDS.COLORS,
        [...session.todayColours.avoid].join(","),
        "colour-avoid-today",
        "DEPRIORITISE",
        SCORING_WEIGHTS.DEPRIORITISE,
        handle,
      ));
    }
  }

  // ── 11. Profile avoid colours ─────────────────────────────────────────────
  if ((profile?.avoidColors ?? []).length > 0) {
    const avoidIds = new Set(profile!.avoidColors!);
    let matched = false;
    for (const vocabId of productColorIds) {
      if (avoidIds.has(vocabId)) {
        matched = true;
        break;
      }
    }
    if (matched) {
      addEntry(acc, makeEntry(
        PRODUCT_TEMPLATE_FIELDS.COLORS,
        [...profile!.avoidColors!].join(","),
        "profile-colour-avoid",
        "DEPRIORITISE",
        SCORING_WEIGHTS.DEPRIORITISE,
        handle,
      ));
    }
  }

  // ── 11.5 / 11.5b / 11.5c. Profile background support for Body Needs ──────
  // RANK weight — softer than session body-need STRONG_RANK, and softer than
  // an explicit session answer always wins: every block below skips any SMCM
  // token already matched by the session's own bodyNeeds.
  //
  // seenSmcm is shared across all three sub-blocks (Fit Preferences, Silhouette,
  // Coverage) so that a customer with overlapping Passport signals (e.g. legacy
  // fitPreferences "oversized" AND silhouette "oversized") is never awarded RANK
  // twice for the same underlying token — Passport background influence stays
  // capped at one RANK contribution per token, never silently stacking back up
  // toward session-tier weight.
  const seenSmcm = new Set<string>();

  // ── 11.5. Profile Fit Preferences (legacy) ───────────────────────────────
  for (const prefId of (profile?.fitPreferences ?? [])) {
    const smcmToken = PROFILE_FIT_PREFERENCE_SMCM_MAP[prefId];
    if (!smcmToken) continue;
    if (activeBodyNeeds.includes(smcmToken)) continue; // session already scored this
    if (seenSmcm.has(smcmToken)) continue; // deduplicate (e.g. relaxed-fits + flowy both → relaxed)
    if (rankings.styleMeComfortMatch.includes(smcmToken)) {
      addEntry(acc, makeEntry(
        PRODUCT_TEMPLATE_FIELDS.STYLE_ME_COMFORT_MATCH,
        smcmToken,
        "profile-fit-preference",
        "RANK",
        SCORING_WEIGHTS.RANK,
        handle,
      ));
      seenSmcm.add(smcmToken);
    }
  }

  // ── 11.5b. Profile Silhouette ─────────────────────────────────────────────
  // Only the 4 semantically exact pairs in PROFILE_SILHOUETTE_SMCM_MAP are
  // mapped ("straight"/"fitted" are deliberately unmapped — no exact target).
  for (const silhouetteId of (profile?.silhouette ?? [])) {
    const smcmToken = PROFILE_SILHOUETTE_SMCM_MAP[silhouetteId];
    if (!smcmToken) continue;
    if (activeBodyNeeds.includes(smcmToken)) continue;
    if (seenSmcm.has(smcmToken)) continue;
    if (rankings.styleMeComfortMatch.includes(smcmToken)) {
      addEntry(acc, makeEntry(
        PRODUCT_TEMPLATE_FIELDS.STYLE_ME_COMFORT_MATCH,
        smcmToken,
        "profile-silhouette",
        "RANK",
        SCORING_WEIGHTS.RANK,
        handle,
      ));
      seenSmcm.add(smcmToken);
    }
  }

  // ── 11.5c. Profile Coverage ────────────────────────────────────────────────
  // mostly-covered (single-select) / sleeves-preferred / longer-hemlines
  // (multi-select) softly support "more-coverage" — only when the session's
  // own Body Needs did not already provide an explicit coverage answer.
  {
    const coverageRequested =
      profile?.preferredCoverage === PROFILE_COVERAGE_PREFERRED_VALUE ||
      (profile?.coveragePreferences ?? []).some((id) => PROFILE_COVERAGE_MULTI_IDS.has(id));
    const smcmToken = "more-coverage";
    if (
      coverageRequested &&
      !activeBodyNeeds.includes(smcmToken) &&
      !seenSmcm.has(smcmToken) &&
      rankings.styleMeComfortMatch.includes(smcmToken)
    ) {
      addEntry(acc, makeEntry(
        PRODUCT_TEMPLATE_FIELDS.STYLE_ME_COMFORT_MATCH,
        smcmToken,
        "profile-coverage",
        "RANK",
        SCORING_WEIGHTS.RANK,
        handle,
      ));
      seenSmcm.add(smcmToken);
    }
  }

  // ── 11.6. Profile lifestyle → Occasion (background signal) ───────────────
  // RANK weight — softer than session occasion STRONG_RANK.
  // Skips tokens already matched by the session occasion.
  if (profile?.lifestyle?.length) {
    const lifestyleIds = profile.lifestyle;
    const scoredTokens = new Set<string>();
    for (const id of lifestyleIds) {
      const tokens = PROFILE_LIFESTYLE_OCCASION_MAP[id] ?? [];
      for (const token of tokens) {
        if (token === session.occasion) continue; // session already scored this
        if (scoredTokens.has(token)) continue;    // deduplicate across multiple IDs
        if (rankings.occasionTags.includes(token)) {
          addEntry(acc, makeEntry(
            PRODUCT_TEMPLATE_FIELDS.OCCASION_TAGS,
            token,
            "profile-lifestyle",
            "RANK",
            SCORING_WEIGHTS.RANK,
            handle,
          ));
          scoredTokens.add(token);
        }
      }
    }
  }

  // ── 11.7. Profile Aspiration — desiredImpression[] + becoming[] ─────────────
  // Ranking enhancer only; never standalone eligibility evidence.
  // Requires at least one non-aspirational positive evidence item from §1–§11.6.
  // Each unique eligible aspirational concept: LIGHT_RANK (+1).
  // Combined cap across both fields: RANK (+2).
  // Concepts already awarded by a stronger signal role (§2 session DFM, §7 SP,
  // §7.5 profile DFM) are skipped via a feature-local canonical concept key.
  {
    const hasNonAspirationPositive = acc.positive.length > 0;

    if (hasNonAspirationPositive && (
      (profile?.desiredImpression?.length ?? 0) > 0 ||
      (profile?.becoming?.length ?? 0) > 0
    )) {
      // Build concept-level dedup set from actual matches in acc.positive (product-specific).
      const scoredConcepts = new Set<string>();
      for (const entry of acc.positive) {
        if (entry.field === PRODUCT_TEMPLATE_FIELDS.DESIRED_FEELING_MATCH) {
          const c = ASPIRATION_DFM_TO_CONCEPT[entry.matchedToken];
          if (c) scoredConcepts.add(c);
        } else if (
          entry.field === PRODUCT_TEMPLATE_FIELDS.STYLE_PERSONALITY_MATCH ||
          entry.field === PRODUCT_TEMPLATE_FIELDS.STYLE_TAGS
        ) {
          // matchedToken may be "feminine" or "feminine:like-myself-bonus" — strip suffix.
          const base = entry.matchedToken.split(":")[0];
          const c = ASPIRATION_SP_TO_CONCEPT[base];
          if (c) scoredConcepts.add(c);
        }
      }

      // Collect all eligible candidates from both aspiration fields into a flat list,
      // then sort by (concept, sourceField, optionId) — all lexicographic — before
      // collapsing to one entry per concept.  This ordering is implementation
      // determinism only; it does not encode any semantic priority between
      // desiredImpression and becoming.
      const aspirationSources: [string[], Readonly<Record<string, string>>, string][] = [
        [profile?.desiredImpression ?? [], PROFILE_DESIRED_IMPRESSION_DFM_MAP, "desiredImpression"],
        [profile?.becoming ?? [],          PROFILE_BECOMING_DFM_MAP,          "becoming"],
      ];
      const candidates: { concept: string; dfmToken: string; sourceField: string; optionId: string }[] = [];
      for (const [ids, translationMap, sourceField] of aspirationSources) {
        for (const optionId of ids) {
          const dfmToken = translationMap[optionId];
          if (!dfmToken) continue;                                          // unmapped ID — skip
          const concept = ASPIRATION_DFM_TO_CONCEPT[dfmToken];
          if (!concept || scoredConcepts.has(concept)) continue;           // already awarded
          if (!rankings.desiredFeelingMatch.includes(dfmToken)) continue;  // product lacks token
          candidates.push({ concept, dfmToken, sourceField, optionId });
        }
      }
      candidates.sort(
        (a, b) =>
          a.concept.localeCompare(b.concept) ||
          a.sourceField.localeCompare(b.sourceField) ||
          a.optionId.localeCompare(b.optionId),
      );
      const eligibleByConcept = new Map<string, { dfmToken: string; quizId: string }>();
      for (const { concept, dfmToken, optionId } of candidates) {
        if (!eligibleByConcept.has(concept)) {
          eligibleByConcept.set(concept, { dfmToken, quizId: optionId });
        }
      }

      // Score: stable alphabetical ordering of concept keys selects which two emit
      // evidence records when more than two candidates are eligible.
      // This ordering is for deterministic output only — it does not represent
      // product priority or field priority.
      const toScore = [...eligibleByConcept.keys()].sort().slice(0, 2);
      for (const concept of toScore) {
        const { dfmToken, quizId } = eligibleByConcept.get(concept)!;
        addEntry(acc, makeEntry(
          PRODUCT_TEMPLATE_FIELDS.DESIRED_FEELING_MATCH,
          dfmToken,
          quizId,
          "LIGHT_RANK",
          SCORING_WEIGHTS.LIGHT_RANK,
          handle,
        ));
      }
    }
  }

  // ── 12. NADINE pairing evidence (positive) ────────────────────────────────
  if (anchor !== null && anchor.type === "nadine") {
    const candidateTitle = product.parsed.identity.verifiedTitle;

    if (
      anchor.bestPairedWith !== null &&
      isDirectlyMentionedInProse(anchor.bestPairedWith, candidateTitle)
    ) {
      addEntry(acc, makeEntry(
        "nadinePairing.bestWith",
        candidateTitle,
        "nadine-pairing-best",
        "RANK",
        SCORING_WEIGHTS.RANK,
        handle,
      ));
    } else if (
      anchor.bestPairedWith !== null &&
      isComponentMentionedInProse(anchor.bestPairedWith, candidateTitle)
    ) {
      addEntry(acc, makeEntry(
        "nadinePairing.bestWith",
        `component-of:${candidateTitle}`,
        "nadine-pairing-best",
        "LIGHT_RANK",
        SCORING_WEIGHTS.LIGHT_RANK,
        handle,
      ));
    }

    if (
      anchor.conditionalPairings !== null &&
      anchor.conditionalPairings.includes(candidateTitle)
    ) {
      addEntry(acc, makeEntry(
        "nadinePairing.conditional",
        candidateTitle,
        "nadine-pairing-conditional",
        "LIGHT_RANK",
        SCORING_WEIGHTS.LIGHT_RANK,
        handle,
      ));
    }
  }

  // ── 13. Closet anchor compatibility scoring ───────────────────────────────
  // When a Closet anchor is present, score general pairing category, style-tag
  // overlap, and occasion overlap. Colour and material are documentary only
  // (Phase 3D). Avoid scoring uses exact-segment matching — never matches
  // modified phrases like "bulky trousers" or "tiered skirts".
  let closetCompatibility: ClosetCompatibilityResult | null = null;
  if (anchor !== null && anchor.type === "closet") {
    closetCompatibility = scoreClosetCompatibility(product, anchor);
    for (const item of closetCompatibility.items) {
      const sessionSignal = `closet-${item.closetField}`;
      addEntry(acc, {
        field: item.productField,
        matchedToken: item.matchedToken,
        sessionSignal,
        effect: item.effect,
        points: item.points,
        isProvisional: false,
        isFallback: false,
        isSupplemental: false,
      });
    }
  }

  // ── 14. Diversity adjustment ──────────────────────────────────────────────
  // Applied separately so it doesn't affect positiveEvidence/negativeEvidence
  // lists (diversity is a tie-break modifier, not a semantic signal).

  return {
    acc, spMatchType, psmType, closetCompatibility,
    hasEssMatch, hasDfmMatch, hasSmcmMatch, hasOccasionFormalityMatch,
    hasDirectSpMatch: spMatchType === "direct",
    hasDirectPsmMatch: psmDirectMatches > 0,
  };
}

// ─── Minimum threshold check ──────────────────────────────────────────────────

function meetsMinimumThreshold(evaluation: ProductEvaluation): boolean {
  return (
    evaluation.totalScore >= THRESHOLDS.MIN_TOTAL_SCORE &&
    evaluation.positiveEvidence.length >= THRESHOLDS.MIN_POSITIVE_EVIDENCE_COUNT
  );
}

// ─── Ranked product builder ───────────────────────────────────────────────────

function toRankedProduct(ev: ProductEvaluation): RankedProduct {
  return {
    handle: ev.handle,
    title: ev.title,
    slot: ev.slot,
    totalScore: ev.totalScore,
    positiveEvidence: ev.positiveEvidence,
    negativeEvidence: ev.negativeEvidence,
    anchorCompatibility: ev.anchorCompatibility,
    provisionalEvidenceUsed: ev.provisionalEvidenceUsed,
  };
}

// ─── Anchor confidence ordinal ────────────────────────────────────────────────

function computeAnchorConfidenceOrdinal(
  closetCompatibility: ClosetCompatibilityResult | null,
  anchorCompatibility: AnchorCompatibility,
): number {
  if (closetCompatibility !== null) {
    const CONF: Record<string, number> = { high: 4, medium: 3, low: 2, insufficient: 1 };
    return CONF[closetCompatibility.confidence] ?? 0;
  }
  const COMPAT: Record<string, number> = {
    compatible: 4,
    "compatible-with-conditions": 3,
    "insufficient-evidence": 1,
    incompatible: 0,
  };
  return COMPAT[anchorCompatibility.status] ?? 0;
}

// ─── Comparison function for ranking ─────────────────────────────────────────
// 7-tier hierarchy: (1) score DESC, (2) anchor confidence DESC,
// (3) matched category count DESC, (4) positive non-supplemental count DESC,
// (5) total negative penalty DESC (less negative wins), (6) provisional count ASC,
// (7) session-specific hash ASC.

function compareEvaluations(a: ProductEvaluation, b: ProductEvaluation): number {
  const scoreDiff = b.totalScore - a.totalScore;
  if (scoreDiff !== 0) return scoreDiff;
  const ta = a.semanticTieBreak;
  const tb = b.semanticTieBreak;
  const conf = tb.anchorConfidence - ta.anchorConfidence;
  if (conf !== 0) return conf;
  const cat = tb.matchedCategoryCount - ta.matchedCategoryCount;
  if (cat !== 0) return cat;
  const pos = tb.positiveNonSupplementalCount - ta.positiveNonSupplementalCount;
  if (pos !== 0) return pos;
  const neg = tb.totalNegativePenalty - ta.totalNegativePenalty;
  if (neg !== 0) return neg;
  const prov = ta.provisionalCount - tb.provisionalCount;
  if (prov !== 0) return prov;
  return ta.sessionSpecificHash - tb.sessionSpecificHash;
}

// ─── Outfit plan builder ──────────────────────────────────────────────────────

function buildOutfitPlan(
  anchor: NormalizedStyleAnchor | null,
  primary: ProductEvaluation | null,
  outcome: string,
): OutfitPlan {
  const anchorSlot = anchor?.slot ?? null;
  const recommendedSlot = primary?.slot ?? null;
  const notes: EvidenceCode[] = [];

  let status: OutfitPlan["compatibilityStatus"] = "compatible";

  if (outcome === "closet-led") {
    status = "closet-led";
  } else if (anchor === null) {
    status = "compatible";
  } else if (anchor.type === "closet" && !anchor.hasStrongEvidence) {
    status = "insufficient-anchor-evidence";
    notes.push("anchor-insufficient-evidence");
  } else if (primary?.anchorCompatibility.status === "compatible-with-conditions") {
    status = "compatible-with-conditions";
  } else {
    status = "compatible";
  }

  return { anchorSlot, recommendedSlot, compatibilityStatus: status, notes };
}

// ─── Main engine entry point ──────────────────────────────────────────────────

export function runRecommendation(
  input: StyleMeEngineInput,
): StyleMeRecommendationResult {
  const { session, profile, anchor: anchorInput, recentlyShownHandles = [] } = input;

  // Normalize PSM IDs
  const normalizedPracticalIds = session.practicalIds.map(
    (id) => PSM_NORMALIZATION_MAP[id] ?? id,
  );

  // like-myself activation (from desired feelings)
  const likeMyselfActive = session.desiredFeelings.includes("like-myself");

  // Resolve anchor
  let anchor: NormalizedStyleAnchor | null = null;
  if (anchorInput != null) {
    if (anchorInput.type === "nadine") {
      anchor = resolveNadineAnchor(anchorInput);
    } else {
      anchor = resolveClosetAnchor(anchorInput as ClosetAnchorInput);
    }
  }

  // nAia mode: skip the NADINE catalogue entirely. The orchestrator (computeStyleMeResult)
  // handles multi-Closet slot filling and direction building from the Closet.
  if (input.mode === "naia") {
    const hasClosetAnchor = anchor !== null && anchor.type === "closet";
    return {
      outcome: hasClosetAnchor ? "closet-led" : "no-eligible-product",
      anchor,
      primary: null,
      alternatives: [],
      outfitPlan: {
        anchorSlot: anchor?.type === "closet"
          ? (anchor as NormalizedClosetAnchor).slot
          : anchor?.type === "nadine"
          ? (anchor as NormalizedNadineAnchor).slot
          : null,
        recommendedSlot: null,
        compatibilityStatus: hasClosetAnchor ? "closet-led" : "compatible",
        notes: [],
      },
      evaluatedProducts: [],
      coverage: { totalCatalogProducts: 0, eligibleCandidates: 0, excludedCandidates: 0 },
      selectedClosetGarments: [],
    };
  }

  // NADINE mode with an explicit NADINE anchor: the customer arrived from a specific
  // NADINE product page and selected that exact product. Return it directly as primary
  // without evaluating the catalogue — no substitution, no alternatives.
  if (input.mode === "nadine" && anchor?.type === "nadine") {
    const na = anchor as NormalizedNadineAnchor;
    const product = getAllCatalogProducts().find((p) => p.handle === na.handle);
    if (product) {
      const slot = itemTypeToSlot(product.parsed.identity.itemType);
      return {
        outcome: "nadine-recommendation",
        anchor: null,
        primary: {
          handle: na.handle,
          title: product.parsed.identity.verifiedTitle,
          slot,
          totalScore: 100,
          positiveEvidence: [],
          negativeEvidence: [],
          anchorCompatibility: { status: "compatible", isHardExclusion: false },
          provisionalEvidenceUsed: false,
        },
        alternatives: [],
        outfitPlan: {
          anchorSlot: null,
          recommendedSlot: slot,
          compatibilityStatus: "compatible",
          notes: [],
        },
        evaluatedProducts: [],
        coverage: { totalCatalogProducts: 0, eligibleCandidates: 0, excludedCandidates: 0 },
        selectedClosetGarments: [],
      };
    }
  }

  // Firm-no colour set
  const firmNoColorIds: Set<string> = new Set(profile?.firmNoColors ?? []);

  // Dressing-preference constraint set (hard exclusion via product.dressingMetadata)
  const dressingPreferenceIds: Set<string> = new Set(profile?.dressingPreferences ?? []);

  // Session fingerprint — computed once; combined with each product handle for
  // the session-specific tie-break hash.
  const sessionFingerprint = buildSessionFingerprint(session, profile, anchor, recentlyShownHandles);

  // Eligible products
  const eligible = getRecommendationEligibleProducts();
  const allProducts = getAllCatalogProducts();

  const evaluations: ProductEvaluation[] = [];

  for (const product of eligible) {
    const slot = itemTypeToSlot(product.parsed.identity.itemType);
    const productColorIds = catalogColorsToVocabIds(product.parsed.identity.colors);

    // Hard exclusions
    const { isExcluded, reasons: exclusionReasons } = checkHardExclusions(
      product,
      slot,
      anchor,
      firmNoColorIds,
      productColorIds,
      dressingPreferenceIds,
    );

    if (isExcluded) {
      const anchorCompatibility = computeAnchorCompatibility(product, anchor);
      evaluations.push({
        handle: product.handle,
        title: product.parsed.identity.verifiedTitle,
        eligibility: product.eligibility,
        slot,
        isHardExcluded: true,
        hardExclusionReasons: exclusionReasons,
        totalScore: 0,
        positiveEvidence: [],
        negativeEvidence: [],
        anchorCompatibility,
        provisionalEvidenceUsed: false,
        stylePersonalityMatchType: "none",
        practicalSupportType: "none",
        diversityAdjustment: 0,
        deterministicRank: deterministicRank(product.handle),
        closetCompatibility: null,
        semanticTieBreak: {
          anchorConfidence: computeAnchorConfidenceOrdinal(null, anchorCompatibility),
          matchedCategoryCount: 0,
          positiveNonSupplementalCount: 0,
          totalNegativePenalty: 0,
          provisionalCount: 0,
          sessionSpecificHash: djb2str(`${sessionFingerprint}|${product.handle}`),
        },
      });
      continue;
    }

    // Score signals
    const {
      acc, spMatchType, psmType, closetCompatibility,
      hasEssMatch, hasDfmMatch, hasSmcmMatch, hasOccasionFormalityMatch,
      hasDirectSpMatch, hasDirectPsmMatch,
    } = scoreProduct(
      product,
      session,
      normalizedPracticalIds,
      profile,
      anchor,
      likeMyselfActive,
      recentlyShownHandles,
    );

    // Diversity adjustment
    const diversityAdj = recentlyShownHandles.includes(product.handle)
      ? SCORING_WEIGHTS.DIVERSITY_PENALTY
      : 0;

    const totalScore = acc.total + diversityAdj;

    const anchorCompatibility = computeAnchorCompatibility(product, anchor);

    const allEvidence = [...acc.positive, ...acc.negative];
    const provisionalEvidenceUsed = allEvidence.some((e) => e.isProvisional);

    const matchedCategoryCount = [
      hasEssMatch, hasDfmMatch, hasSmcmMatch, hasOccasionFormalityMatch,
      hasDirectSpMatch, hasDirectPsmMatch,
    ].filter(Boolean).length;

    const semanticTieBreak: SemanticTieBreak = {
      anchorConfidence: computeAnchorConfidenceOrdinal(closetCompatibility, anchorCompatibility),
      matchedCategoryCount,
      positiveNonSupplementalCount: acc.positive.filter((e) => !e.isSupplemental).length,
      totalNegativePenalty: acc.negative.reduce((sum, e) => sum + e.points, 0),
      provisionalCount: allEvidence.filter((e) => e.isProvisional).length,
      sessionSpecificHash: djb2str(`${sessionFingerprint}|${product.handle}`),
    };

    evaluations.push({
      handle: product.handle,
      title: product.parsed.identity.verifiedTitle,
      eligibility: product.eligibility,
      slot,
      isHardExcluded: false,
      hardExclusionReasons: [],
      totalScore,
      positiveEvidence: acc.positive,
      negativeEvidence: acc.negative,
      anchorCompatibility,
      provisionalEvidenceUsed,
      stylePersonalityMatchType: spMatchType,
      practicalSupportType: psmType,
      diversityAdjustment: diversityAdj,
      deterministicRank: deterministicRank(product.handle),
      closetCompatibility,
      semanticTieBreak,
    });
  }

  // Rank non-excluded candidates
  const candidates = evaluations
    .filter((e) => !e.isHardExcluded)
    .sort(compareEvaluations);

  const aboveThreshold = candidates.filter(meetsMinimumThreshold);

  // Determine outcome
  let outcome: StyleMeRecommendationResult["outcome"];
  let primary: ProductEvaluation | null = null;
  let alternatives: ProductEvaluation[] = [];

  if (aboveThreshold.length === 0) {
    // When a Closet anchor exists the Closet piece still anchors the look,
    // so we return closet-led rather than no-eligible-product.
    const hasClosetAnchor = anchor !== null && anchor.type === "closet";
    outcome = (session.source === "my-closet" || hasClosetAnchor)
      ? "closet-led"
      : "no-eligible-product";
  } else {
    outcome = "nadine-recommendation";
    [primary, ...alternatives] = aboveThreshold;
    alternatives = alternatives.slice(0, THRESHOLDS.MAX_ALTERNATIVES);
  }

  const outfitPlan = buildOutfitPlan(anchor, primary, outcome);

  return {
    outcome,
    anchor,
    primary: primary ? toRankedProduct(primary) : null,
    alternatives: alternatives.map(toRankedProduct),
    outfitPlan,
    evaluatedProducts: evaluations,
    coverage: {
      totalCatalogProducts: allProducts.length,
      eligibleCandidates: eligible.length,
      excludedCandidates: evaluations.filter((e) => e.isHardExcluded).length,
    },
  };
}
