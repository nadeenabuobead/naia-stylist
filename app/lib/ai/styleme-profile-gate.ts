// app/lib/ai/styleme-profile-gate.ts
// Profile-aware gating and scoring for the StyleMe engine.
//
// Uses APPROVED GarmentStyleMeProfile as the authoritative truth layer.
// Pure functions — no DB access, no Prisma, no .server imports.
//
// Precedence hierarchy enforced here:
//   1. Passport dressing requirements / hard user requirements  (caller's responsibility)
//   2. Occasion (occasionFit from profile)  ← hard No exclusion
//   3. Dress Register (dressRegister from profile)  ← coherence, NOT overriding occasionFit truth
//   4. TODAY comfort requirements                               (caller's responsibility)
//   5. TODAY intention (intentionPotentials from profile)
//   6. APPROVED GarmentStyleMeProfile                          (all functions below)
//   7. Whole-outfit coherence / tie-breaks                     (hasStatementConflict, layering)
//
// KEY INVARIANT: approved occasionFit truth is NEVER contradicted by a generic
// register→occasion mapping. If occasionFit says Strong/Acceptable for an occasion,
// that overrides any blanket register exclusion rule.

import type { ClosetAnchorInput, OutfitCandidate, OutfitSlot } from "./styleme-recommendation.types.js";

// ── Dress register rank ────────────────────────────────────────────────────────

export const DRESS_REGISTER_RANK: Record<string, number> = {
  "athletic":        0,
  "casual":          1,
  "elevated-casual": 2,
  "smart-casual":    3,
  "polished":        4,
  "dressy":          5,
  "evening":         6,
};

// Allowed dress register range (inclusive) per session occasion.
export const OCCASION_REGISTER_RANGE: Record<string, { min: number; max: number }> = {
  "active":    { min: 0, max: 1 },
  "everyday":  { min: 1, max: 3 },
  "family":    { min: 1, max: 3 },
  "travel":    { min: 1, max: 3 },
  "work":      { min: 2, max: 4 },
  "dinner":    { min: 2, max: 5 },
  "date":      { min: 2, max: 4 },
  "event":     { min: 3, max: 6 },
  "night-out": { min: 2, max: 6 },
};

// Structural slots excluded from intention scoring (accessories, bags, jewelry).
// Exported for use in selectAdditionalClosetGarments post-assembly checks.
export const STRUCTURAL_EXCLUDES = new Set(["bag", "accessory", "jewelry"]);

// Valid OutfitSlot values — used to validate profile exactSlot before casting.
export const VALID_OUTFIT_SLOTS = new Set<string>([
  "top", "bottom", "dress", "set", "outerwear", "shoe", "bag", "accessory", "jewelry",
]);

// ── Profile slot resolution ────────────────────────────────────────────────────

// Returns the authoritative slot for this garment in a StyleMe outfit.
// When an APPROVED profile has a valid exactSlot, it overrides the category-derived slot.
// Callers must provide the fallback (category-derived) slot for when no profile exists.
export function resolveProfileSlot(
  item: ClosetAnchorInput,
  fallbackSlot: OutfitSlot,
): OutfitSlot {
  const exactSlot = item.approvedProfile?.exactSlot;
  if (exactSlot && VALID_OUTFIT_SLOTS.has(exactSlot)) return exactSlot as OutfitSlot;
  return fallbackSlot;
}

// ── Occasion gate ──────────────────────────────────────────────────────────────

// Returns false when an APPROVED profile explicitly marks this garment "No" for the occasion.
// "No" is a hard exclusion — overrides all positive session signals.
// When no approved profile exists, returns true (legacy logic takes over).
export function passesProfileOccasionGate(
  item: ClosetAnchorInput,
  sessionOccasion: string,
): boolean {
  const profile = item.approvedProfile;
  if (!profile?.occasionFit) return true;
  const rating = profile.occasionFit[sessionOccasion];
  return rating !== "No";
}

// ── Register gate ──────────────────────────────────────────────────────────────

// Returns false when APPROVED profile.dressRegister is incompatible with the session occasion.
//
// CRITICAL: approved occasionFit truth takes precedence.
//   If occasionFit says "Strong" or "Acceptable" for this occasion, the garment IS
//   authorised for that occasion regardless of its register — return true immediately.
//   This means an athletic-register garment with occasionFit.everyday = "Strong" is allowed
//   for Everyday even though the generic register rule would exclude it.
//
// Generic register blocks (only applied when occasionFit does NOT explicitly authorise):
//   - "athletic" register in non-active occasions (sports-only context)
//   - "evening" register in casual/everyday/family/travel/active occasions
//   - Any garment more than 2 ranks outside the occasion's allowed register range
//
// When no approved profile exists, returns true (legacy formality check applies).
export function passesProfileRegisterGate(
  item: ClosetAnchorInput,
  sessionOccasion: string,
): boolean {
  const profile = item.approvedProfile;
  if (!profile?.dressRegister) return true;
  const itemRank = DRESS_REGISTER_RANK[profile.dressRegister];
  if (itemRank === undefined) return true;
  const range = OCCASION_REGISTER_RANGE[sessionOccasion];
  if (!range) return true;

  // Approved occasionFit truth overrides all generic register→occasion blocks.
  // If the profile explicitly approves this garment for this occasion (Strong or Acceptable),
  // defer to that authoritative truth rather than applying a blanket register rule.
  // A "No" rating or absent rating falls through to the generic register check below.
  if (profile.occasionFit) {
    const rating = profile.occasionFit[sessionOccasion];
    if (rating === "Strong" || rating === "Acceptable") return true;
  }

  // Athletic-only garments: excluded from non-active when no explicit occasionFit approval.
  if (profile.dressRegister === "athletic" && sessionOccasion !== "active") return false;

  // Evening garments: excluded from casual/everyday occasions when no explicit occasionFit approval.
  if (
    profile.dressRegister === "evening" &&
    ["active", "everyday", "family", "travel"].includes(sessionOccasion)
  ) return false;

  // General range check: hard-block when more than 2 ranks outside the allowed range.
  return itemRank >= range.min - 2 && itemRank <= range.max + 2;
}

// Checks if a candidate garment's register is compatible with the anchor's register.
// Prevents outfit-level cross-register mismatches (e.g. athletic shoes + polished jacket).
// Returns false when both have approved profiles and are more than 2 ranks apart.
export function passesRegisterCoherenceWithAnchor(
  item: ClosetAnchorInput,
  anchorItem: ClosetAnchorInput | null,
): boolean {
  if (!anchorItem?.approvedProfile?.dressRegister) return true;
  if (!item.approvedProfile?.dressRegister) return true;
  const anchorRank = DRESS_REGISTER_RANK[anchorItem.approvedProfile.dressRegister];
  const itemRank = DRESS_REGISTER_RANK[item.approvedProfile.dressRegister];
  if (anchorRank === undefined || itemRank === undefined) return true;
  return Math.abs(anchorRank - itemRank) <= 2;
}

// ── Per-piece occasion tier (from approved profile) ────────────────────────────

// Returns 2 (Strong) / 1 (Acceptable) / 0 (No) from the approved profile occasion rating.
// Returns null when no approved profile or no rating for this occasion (caller uses legacy).
export function getProfileOccasionTier(
  item: ClosetAnchorInput,
  sessionOccasion: string,
): 0 | 1 | 2 | null {
  const profile = item.approvedProfile;
  if (!profile?.occasionFit) return null;
  const rating = profile.occasionFit[sessionOccasion];
  if (rating === "Strong") return 2;
  if (rating === "Acceptable") return 1;
  if (rating === "No") return 0;
  return null;
}

// ── Per-piece intention potential (from approved profile) ──────────────────────

// Returns the approved profile's intention score for one intention ID.
// Strong = 1.0, Supporting = 0.5, None = 0.0 (exact zero — blocks heuristic boost).
// Returns null when no approved profile for this item (caller uses legacy heuristic).
export function getProfileIntentionScore(
  item: ClosetAnchorInput,
  intentionId: string,
): number | null {
  const profile = item.approvedProfile;
  if (!profile?.intentionPotentials) return null;
  const rating = profile.intentionPotentials[intentionId];
  if (rating === "Strong") return 1.0;
  if (rating === "Supporting") return 0.5;
  if (rating === "None") return 0.0;
  return null;
}

// Per-item intention weight for a single garment (0–1).
// Used in Candidate A slot-filling to give intention-aligned items a scoring advantage.
// Priority: approved intentionPotentials → form/character fields → legacy heuristic.
export function computeItemIntentionWeight(
  item: ClosetAnchorInput,
  intentionId: string,
): number {
  const profileScore = getProfileIntentionScore(item, intentionId);
  if (profileScore !== null) return profileScore;
  if (item.approvedProfile) return formCharacterScore(item, intentionId);
  return legacyPieceIntentionScore(item, intentionId);
}

// ── Profile-aware outfit-level intention score ─────────────────────────────────

// Aggregates per-piece profile intention scores across the candidate's structural pieces.
//
// Returns:
//   number in [0, 1]: ONLY when ALL structural pieces in the candidate have an approved profile.
//   null: when ANY structural piece lacks an approved profile → caller uses full legacy heuristic.
//
// This "all-or-nothing" rule preserves legacy StyleMe behaviour for un-profiled or partially
// profiled candidates: the moment any structural piece has no approved profile, the full
// legacy outfit-level heuristic path is used for that intention.
//
// Critical guarantee: a None-rated garment scores exactly 0.0 — no heuristic can override it.
export function computeProfileIntentionFit(
  intentionId: string,
  candidate: OutfitCandidate,
  allItems: ClosetAnchorInput[],
): number | null {
  const structuralPieces = candidate.pieces.filter((p) => !STRUCTURAL_EXCLUDES.has(p.slot));
  if (structuralPieces.length === 0) return null;

  const itemMap = new Map(allItems.map((i) => [i.id, i]));
  let sum = 0;

  for (const piece of structuralPieces) {
    const item = itemMap.get(piece.closetId);
    if (!item) return null; // Unknown item → can't score → full legacy for whole candidate
    const profileScore = getProfileIntentionScore(item, intentionId);
    if (profileScore === null) {
      // This piece has no approved profile (or no rating for this intention).
      // Per spec: preserve existing legacy StyleMe behaviour for un-profiled profiles.
      // Return null so singleIntentionUnitScore falls through to the full legacy heuristic.
      return null;
    }
    sum += profileScore;
  }

  return sum / structuralPieces.length;
}

// ── Layering behaviour gate ────────────────────────────────────────────────────

// Returns false when a "base-under-layer" garment would appear without a covering layer.
// Only enforced when the profile explicitly marks the item as "base-under-layer".
// Items with null/undefined layeringBehaviour pass (fail-open: unknown metadata).
//
// A covering layer is an outerwear piece with full/three-quarter sleeves or known shoulder coverage.
export function passesLayeringRequirement(
  item: ClosetAnchorInput,
  candidate: OutfitCandidate,
  allItems: ClosetAnchorInput[],
): boolean {
  const profile = item.approvedProfile;
  if (!profile?.layeringBehaviour) return true;
  if (profile.layeringBehaviour !== "base-under-layer") return true;

  const itemMap = new Map(allItems.map((i) => [i.id, i]));
  const hasCoveringLayer = candidate.pieces.some((p) => {
    if (p.slot !== "outerwear") return false;
    const outerwear = itemMap.get(p.closetId);
    if (!outerwear) return false;
    return (
      outerwear.sleeveLength === "full" ||
      outerwear.sleeveLength === "three-quarter" ||
      outerwear.shoulderCoverage === true
    );
  });

  return hasCoveringLayer;
}

// ── Per-piece intention scoring ───────────────────────────────────────────────
// Tag sets duplicated here to keep this file standalone (no .server imports).
// Kept in sync with STRUCTURE_TAGS / FLOW_TAGS in styleme-result.server.ts.
// "fitted" is intentionally excluded — a fitted silhouette is not a structured garment.
const GATE_STRUCTURE_TAGS = new Set(["structured", "tailored", "sharp", "polished", "minimalist"]);
const GATE_FLOW_TAGS = new Set(["flowing", "relaxed", "soft", "loose", "flowy", "oversized"]);

// Per-piece legacy intention score for UN-PROFILED garments.
// Uses style tags, fitProfile, and garment attributes — the same signals the outfit-level
// legacy heuristics aggregate. Called only when the item has no approved profile.
// Returns a value in [0, 1]; never called for approved profiles.
function legacyPieceIntentionScore(item: ClosetAnchorInput, intentionId: string): number {
  const tags = new Set((item.styleTags ?? []).map((t) => t.toLowerCase()));
  const fp = item.fitProfile?.toLowerCase() ?? null;

  switch (intentionId) {
    case "give-structure":
    case "feel-sharper": {
      const hasTag = [...GATE_STRUCTURE_TAGS].some((t) => tags.has(t));
      const hasFit = fp !== null && GATE_STRUCTURE_TAGS.has(fp);
      return Math.min(1.0, (hasTag ? 0.5 : 0) + (hasFit ? 0.5 : 0));
    }
    case "feel-softer": {
      const hasTag = [...GATE_FLOW_TAGS].some((t) => tags.has(t));
      const hasFit = fp !== null && GATE_FLOW_TAGS.has(fp);
      const hasSilhouette = item.silhouette === "flowy" || item.silhouette === "movement";
      return hasTag || hasFit || hasSilhouette ? 0.7 : 0.2;
    }
    case "make-it-easy": {
      const hasFlow = [...GATE_FLOW_TAGS].some((t) => tags.has(t)) || (fp !== null && GATE_FLOW_TAGS.has(fp));
      return hasFlow ? 0.6 : 0.3;
    }
    case "feel-less-exposed": {
      const hasCoverage =
        (item.garmentRelationships ?? []).includes("more-coverage") ||
        item.sleeveLength != null ||
        item.necklineCoverage != null ||
        item.shoulderCoverage === true;
      return hasCoverage ? 0.6 : 0.2;
    }
    case "express-myself": {
      const hasExpressive =
        tags.has("bold") || tags.has("statement") || tags.has("expressive") ||
        (item.pattern !== null && item.pattern !== undefined && item.pattern !== "solid");
      return hasExpressive ? 0.7 : 0.3;
    }
    // Outfit-level or personality-dependent intentions: neutral per-piece estimate
    case "feel-like-myself":
    case "confidence":
    case "ground-me":
    case "feel-attractive":
    case "feel-put-together":
    case "give-energy":
    default:
      return 0.4;
  }
}

// Per-piece form/character field scoring for APPROVED garments that lack an intentionPotentials
// rating for the specific intention. Uses the approved profile's structural metadata fields.
//
// CRITICAL constraints (per spec):
//   - construction is authoritative for structure; fitProfile="fitted" must not substitute
//   - stylingEffort is authoritative for ease; fitProfile="relaxed" does not imply easy
//   - fabricBehaviour intentionally NOT used to score feel-softer OR feel-less-exposed (physical ≠ emotional)
//   - waistComfort locked taxonomy: elastic|drawstring|stretch|fixed|restrictive|unknown|N/A
//   - waistComfort is ONLY used in the body-need path (nothing-tight-waist in anchor.server.ts)
//   - waistComfort must NOT infer emotional intentions (ground-me / confidence / feel-put-together)
//   - visualWeight is a secondary tiebreaker: heavy/bold supports structure; light/delicate supports softness
function formCharacterScore(item: ClosetAnchorInput, intentionId: string): number {
  const p = item.approvedProfile;
  if (!p) return 0.4;

  switch (intentionId) {
    case "give-structure":
    case "feel-sharper": {
      // construction is authoritative — "fitted" fitProfile must never substitute
      if (p.construction === "structured") return 0.8;
      if (p.construction === "semi-structured") return 0.5;
      if (p.construction === "soft") return 0.1;
      // silhouetteCharacter as secondary signal when construction not specified
      const sc = p.silhouetteCharacter ?? [];
      if (sc.some((s) => ["structured", "sharp", "geometric", "precise"].includes(s))) return 0.6;
      if (sc.some((s) => ["relaxed", "flowy", "soft", "draped"].includes(s))) return 0.15;
      // visualWeight as tertiary tiebreaker when construction + silhouette both absent
      if (p.visualWeight === "heavy" || p.visualWeight === "bold") return 0.5;
      if (p.visualWeight === "light" || p.visualWeight === "delicate") return 0.2;
      return 0.4;
    }
    case "make-it-easy": {
      // stylingEffort is authoritative — "relaxed" fitProfile does not imply easy
      if (p.stylingEffort === "easy") return 0.8;
      if (p.stylingEffort === "moderate") return 0.4;
      if (p.stylingEffort === "involved") return 0.1;
      return 0.4;
    }
    case "feel-softer": {
      // fabricBehaviour intentionally excluded — physical soft ≠ feel-softer emotion
      // silhouetteCharacter for softness
      const sc = p.silhouetteCharacter ?? [];
      if (sc.some((s) => ["soft", "flowing", "relaxed", "flowy", "draped"].includes(s))) return 0.65;
      if (sc.some((s) => ["structured", "sharp", "geometric"].includes(s))) return 0.15;
      // visualWeight: light/delicate supports the feel-softer aspiration
      if (p.visualWeight === "light" || p.visualWeight === "delicate") return 0.5;
      if (p.visualWeight === "heavy" || p.visualWeight === "bold") return 0.2;
      return 0.35;
    }
    case "feel-less-exposed": {
      // fabricBehaviour intentionally NOT used — physical fabric behaviour ≠ emotional coverage feel.
      // intentionPotentials["feel-less-exposed"] is authoritative for approved profiles;
      // physical coverage is handled by sleeve/neckline/shoulder attributes and Passport hard gates.
      return 0.4;
    }
    case "ground-me":
    case "feel-put-together":
    case "confidence": {
      // waistComfort is physical fit/comfort truth — it must NOT infer emotional intentions.
      // intentionPotentials is authoritative for ground-me/feel-put-together/confidence.
      // waistComfort participates only in the fit/comfort/body-need path (nothing-tight-waist).
      return 0.4;
    }
    default:
      return 0.4;
  }
}

// ── Hybrid outfit-level intention fit ─────────────────────────────────────────
//
// APPROVED garment: GarmentStyleMeProfile intentionPotentials always wins (None = hard 0).
// APPROVED garment missing rating for this intention: form/character fields consulted.
// UN-PROFILED garment: per-piece legacy heuristic (same signal source as outfit-level legacy).
// ALL-UNPROFILED outfit: returns null → caller's full outfit-level legacy heuristic runs.
//
// This ensures:
//   - approved garments are NEVER reinterpreted by legacy heuristics
//   - un-profiled garments preserve their existing legacy treatment
//   - an approved None is a hard 0 even when paired with un-profiled pieces
//   - all-unprofiled outfits route through the full outfit-level legacy path unchanged
export function computeHybridIntentionFit(
  intentionId: string,
  candidate: OutfitCandidate,
  allItems: ClosetAnchorInput[],
): number | null {
  const structuralPieces = candidate.pieces.filter((p) => !STRUCTURAL_EXCLUDES.has(p.slot));
  if (structuralPieces.length === 0) return null;

  const itemMap = new Map(allItems.map((i) => [i.id, i]));

  // All-unprofiled: signal the caller to use the full outfit-level legacy heuristic.
  const hasAnyApprovedProfile = structuralPieces.some((p) => {
    const item = itemMap.get(p.closetId);
    return item?.approvedProfile != null;
  });
  if (!hasAnyApprovedProfile) return null;

  // Hybrid: at least one piece has an approved profile.
  let sum = 0;
  for (const piece of structuralPieces) {
    const item = itemMap.get(piece.closetId);
    if (!item) return null; // Unknown item → cannot score hybrid → fall back to legacy
    if (item.approvedProfile) {
      const profileScore = getProfileIntentionScore(item, intentionId);
      // profileScore !== null: Strong=1.0 / Supporting=0.5 / None=0.0 (hard zero, no override)
      // profileScore === null: intention not rated → use form/character fields
      sum += profileScore !== null ? profileScore : formCharacterScore(item, intentionId);
    } else {
      // No approved profile for this piece → per-piece legacy heuristic
      sum += legacyPieceIntentionScore(item, intentionId);
    }
  }
  return sum / structuralPieces.length;
}

// ── outfitFunction enforcement ────────────────────────────────────────────────
// The outfitFunction taxonomy is: base | supporting | statement | anchor | layering | finishing
// These are distinct from exactSlot and must be consulted independently.
//
// "finishing" function pieces (decorative/embellishing roles) must not satisfy structural
// clothing slots (top, bottom, dress, set) in the outfit architecture.
const STRUCTURAL_CLOTHING_SLOTS = new Set(["top", "bottom", "dress", "set"]);

// Returns false when a "finishing" function piece would fill a structural clothing slot.
// All other outfitFunction values pass (each has its own enforcement path below).
export function passesOutfitFunctionGate(item: ClosetAnchorInput, slotBeingFilled: string): boolean {
  const fn = item.approvedProfile?.outfitFunction;
  if (!fn) return true;
  if (fn === "finishing" && STRUCTURAL_CLOTHING_SLOTS.has(slotBeingFilled)) return false;
  return true;
}

// Priority multiplier for outfitFunction in slot-candidate ranking.
// anchor: boosted — primary outfit anchoring piece; should not be displaced by noise
// base: slight boost — structural foundation
// supporting: penalty — should not displace a valid anchor/base piece
// All other values: neutral
export function outfitFunctionPriority(item: ClosetAnchorInput): number {
  const fn = item.approvedProfile?.outfitFunction;
  if (!fn) return 1.0;
  switch (fn) {
    case "anchor":     return 1.15;
    case "base":       return 1.05;
    case "supporting": return 0.85;
    default:           return 1.0;
  }
}

// ── Statement conflict — extended ─────────────────────────────────────────────
// Replaces the original hasStatementConflict with extended coverage:
// counts structural pieces where EITHER statementLevel === "statement" OR
// outfitFunction === "statement" (since both fields independently denote a statement role).
export function hasStatementConflict(
  candidate: OutfitCandidate,
  allItems: ClosetAnchorInput[],
): boolean {
  const itemMap = new Map(allItems.map((i) => [i.id, i]));
  let count = 0;
  for (const piece of candidate.pieces) {
    if (STRUCTURAL_EXCLUDES.has(piece.slot)) continue;
    const item = itemMap.get(piece.closetId);
    const p = item?.approvedProfile;
    if (p?.statementLevel === "statement" || p?.outfitFunction === "statement") count++;
    if (count >= 2) return true;
  }
  return false;
}

// ── Pairing guidance — intentionally deferred ────────────────────────────────
// The GarmentStyleMeProfile fields naturalPairings, intentionalMix, and avoidInStyleMe
// are FREE-TEXT PROSE fields authored by admin reviewers. They cannot be enforced
// deterministically without NLP or a structured token layer that does not yet exist.
//
// Current state: these fields are STORED and READABLE on the approved profile but are
//   NOT enforced as runtime gates. They serve as documentation for reviewers only.
//
// Why NOT a keyword parser: free-text parsing produces false positives that would
//   silently misfire (wrong garments excluded) with no way to audit the failures.
//
// Proposed future architecture (schema change NOT made in Step 2):
//   Add `pairingTokens: String[]` and `avoidTokens: String[]` to GarmentStyleMeProfile.
//   These normalised token arrays would enable deterministic garment-pair matching
//   at runtime without NLP. Admin reviewers would populate them alongside the prose.
//   Once available, `avoidInStyleMe` can be enforced using set intersection.
//
// IMPORTANT: the existing hard gates (passesProfileOccasionGate, passesProfileRegisterGate)
// enforce the SAME INTENT as avoidInStyleMe in many cases — but they are NOT equivalent.
// avoidInStyleMe can express nuances (e.g., "avoid with formal trousers") that the gate
// functions cannot capture without the structured token layer above.
export const PAIRING_GUIDANCE_STATUS = "deferred" as const;
