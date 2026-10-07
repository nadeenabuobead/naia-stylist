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
import { NEW_INTENTION_IDS } from "../admin/styleme-garment-profile.vocab.js";

// ── Expansion intentions: approved truth only, never derived ──────────────────
//
// feel-elevated / stand-out / feel-fun / feel-powerful were added to the taxonomy
// after the closet was reviewed, so most garments have no rating for them yet.
//
// They deliberately have NO heuristic fallback. Every tempting shortcut is wrong:
// tailored is not powerful, black is not stand-out, polished is not elevated,
// casual is not fun. Deriving them would also erase the distinction between "a
// human decided None" and "nobody has looked at this yet", which is the whole
// point of tracking the expansion separately.
//
// So an unreviewed expansion intention contributes the neutral, evidence-free
// score used elsewhere for outfit-level intentions — never a positive signal, and
// never as much as an approved Supporting (0.5) or Strong (1.0). Only a human
// rating in intentionPotentials can move these.
const NEUTRAL_NO_EVIDENCE = 0.4;
const EXPANSION_INTENTION_IDS: ReadonlySet<string> = new Set<string>(NEW_INTENTION_IDS);

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
//
// KEYED ON THE CANONICAL SESSION OCCASION — the value this map is actually looked up
// with. Three keys used to be spelled in the StyleMe UI vocabulary ("date", "event",
// "night-out") while passesProfileRegisterGate looked them up as "date-night",
// "special-event" and "girls-night". Those three lookups missed, and `if (!range)
// return true` sits ABOVE the athletic and evening blocks — so the gate returned true
// before any of them ran, and activewear was admitted to a Date night, a Special event
// and a Girls night with nothing approving it.
//
// The ranges themselves were never what those occasions lost: with the +/-2 tolerance
// below they widen to 0-6, 1-8 and 0-8, which blocks nothing on a 0-6 rank scale. The
// athletic block is the gate that was being skipped.
//
// This was previously deferred on the grounds that the keys could not be repaired
// alone: the gate interleaves this session-side map with the GARMENT-side
// profile.occasionFit, which is keyed on the UI spelling, and the occasionFit lookup
// is the escape hatch that lets an approved "Strong" override a blanket register
// block. Repairing one side without the other would have started blocking garments a
// human explicitly approved, with no way for the approval to speak.
//
// That is no longer the situation. The C1 vocabulary bridge made every occasionFit
// read go through profileOccasionRating, which maps the canonical session occasion to
// the garment spelling. The escape hatch now speaks for all nine occasions, so the
// session side can be corrected on its own — which is all this map is.
//
// Still owned by the Garment Intelligence foundation: ONE canonical occasion ID set
// with occasionFit keyed on it, after which this map, CANONICAL_OCCASION_TO_PROFILE_KEY
// and SESSION_OCCASION_TO_CLOSET_TOKENS all delete in favour of the shared resolver.
// Correcting these keys does not substitute for that; it stops a gate failing open in
// the meantime.
export const OCCASION_REGISTER_RANGE: Record<string, { min: number; max: number }> = {
  // DO NOT "correct" this to { min: 0, max: 3 }. The declared band is deliberately {0,1}:
  // passesProfileRegisterGate applies a shared +/-2 tolerance at its final range check, so
  // the EFFECTIVE window for Active / busy day is already ranks 0-3 —
  //   0 athletic · 1 casual · 2 elevated-casual · 3 smart-casual   pass
  //   4 polished · 5 dressy · 6 evening                            fail
  // which is exactly the intended four-band behaviour. Widening the declared band to {0,3}
  // would make the effective window 0-5 and quietly admit polished and dressy to a day of
  // errands. Measured and pinned by AOS-D in active-occasion-semantics.test.ts.
  "active":    { min: 0, max: 1 },
  "everyday":  { min: 1, max: 3 },
  "family":    { min: 1, max: 3 },
  "travel":    { min: 1, max: 3 },
  "work":      { min: 2, max: 4 },
  "dinner":    { min: 2, max: 5 },
  "date-night":    { min: 2, max: 4 },
  "special-event": { min: 3, max: 6 },
  "girls-night":   { min: 2, max: 6 },
};

// Non-structural slots excluded from register/statement checks (bags, accessories, jewelry).
// NOTE: STRUCTURAL_EXCLUDES is NOT used in computeProfileIntentionFit or
// computeHybridIntentionFit — all pieces (including bag/accessory) contribute to
// candidate-level intention scoring via their approved intentionPotentials.
export const STRUCTURAL_EXCLUDES = new Set(["bag", "accessory", "jewelry"]);

// Slots a garment must resolve to in order to carry an outfit — the structural half of
// the wardrobe, as opposed to the finishing half (bag / shoe / accessory / jewelry).
//
// This is the product rule "structural garment vs finishing accessory", expressed where
// it belongs: on the resolved SLOT, not on the raw category. A category allowlist cannot
// state it — ACTIVEWEAR, LOUNGEWEAR and SETS all resolve to real structural slots via
// closetItemToSlot, and an allowlist that omits them silently removes whole wardrobes
// from anchoring. That is exactly what broke Active / busy day sessions.
export const STRUCTURAL_ANCHOR_SLOTS = new Set<string>([
  "top", "bottom", "dress", "set", "outerwear",
]);

/** True when a resolved slot can carry an outfit. Shoes and accessories cannot. */
export function canSlotAnchorOutfit(slot: string): boolean {
  return STRUCTURAL_ANCHOR_SLOTS.has(slot);
}

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
// ── Canonical occasion → approved-profile occasionFit key (C1) ────────────────
//
// StyleMe sessions carry canonical occasion IDs; GarmentStyleMeProfile.occasionFit is
// stored under the admin's OCCASION_IDS vocabulary. Six of the nine spellings coincide,
// three do not, and every read indexed occasionFit by the session value directly — so for
// those three the key simply missed and ALL approved occasion truth was silently discarded:
// a reviewer's "No" for a night out carried exactly as much weight as no rating at all.
//
// Observed before this bridge: ST15, ST16 and O4 all fell through to the legacy occasions[]
// array for tiering, and O4's uniform occasionTier 0 came from that fallback rather than
// from anything a reviewer had said.
//
// Five call sites read this value — passesProfileOccasionGate, passesProfileRegisterGate,
// passesRegisterCoherenceWithAnchor, getProfileOccasionTier, and isOccasionCompatible in
// the anchor. All five go through this resolver, so a "No" cannot be honoured by one gate
// and ignored by another.
//
// A vocabulary bridge and nothing more. No garment metadata is reinterpreted, no canonical
// session value is renamed, and an occasion with no mapping resolves to itself — so the six
// already-matching spellings and any unknown occasion behave exactly as before. A missing
// key still yields undefined, preserving each caller's own fail-open path.
export const CANONICAL_OCCASION_TO_PROFILE_KEY: Readonly<Record<string, string>> = {
  "date-night": "date",
  "special-event": "event",
  "girls-night": "night-out",
};

/** The approved occasionFit rating for a canonical session occasion, or undefined. */
export function profileOccasionRating(
  occasionFit: Record<string, string> | null | undefined,
  sessionOccasion: string,
): string | undefined {
  if (!occasionFit) return undefined;
  const key = CANONICAL_OCCASION_TO_PROFILE_KEY[sessionOccasion] ?? sessionOccasion;
  return occasionFit[key];
}

export function passesProfileOccasionGate(
  item: ClosetAnchorInput,
  sessionOccasion: string,
): boolean {
  const profile = item.approvedProfile;
  if (!profile?.occasionFit) return true;
  const rating = profileOccasionRating(profile.occasionFit, sessionOccasion);
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
    const rating = profileOccasionRating(profile.occasionFit, sessionOccasion);
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
//
// Shared-occasion override: when BOTH anchor and candidate have explicit occasionFit approval
// (Strong or Acceptable) for the active session occasion, the generic register-gap heuristic
// must not overrule that human-authored paired truth. A "No" rating or absent rating on either
// side does not qualify — the override requires positive approval from both pieces.
export function passesRegisterCoherenceWithAnchor(
  item: ClosetAnchorInput,
  anchorItem: ClosetAnchorInput | null,
  sessionOccasion?: string,
): boolean {
  if (!anchorItem?.approvedProfile?.dressRegister) return true;
  if (!item.approvedProfile?.dressRegister) return true;

  // Shared-occasion approval: both pieces approved for this occasion → bypass register gap.
  if (sessionOccasion) {
    const anchorRating = profileOccasionRating(anchorItem.approvedProfile.occasionFit, sessionOccasion);
    const itemRating = profileOccasionRating(item.approvedProfile.occasionFit, sessionOccasion);
    const anchorApproved = anchorRating === "Strong" || anchorRating === "Acceptable";
    const itemApproved = itemRating === "Strong" || itemRating === "Acceptable";
    if (anchorApproved && itemApproved) return true;
  }

  const anchorRank = DRESS_REGISTER_RANK[anchorItem.approvedProfile.dressRegister];
  const itemRank = DRESS_REGISTER_RANK[item.approvedProfile.dressRegister];
  if (anchorRank === undefined || itemRank === undefined) return true;
  return Math.abs(anchorRank - itemRank) <= 2;
}

// ── Per-piece occasion tier (from approved profile) ────────────────────────────

// Returns 2 (Strong) / 1 (Acceptable) / 0 (No) from the approved profile occasion rating.
// Returns null when no approved profile or no rating for this occasion (caller uses legacy).
/**
 * Slot-selection rank for an authored occasionFit grade. HIGHER WINS.
 *
 *   Strong                         2
 *   Acceptable                     1
 *   missing / unrated / no profile 1   — same as Acceptable, deliberately
 *   No                             0   — never reaches a sort; the gate removed it
 *
 * Why this exists: the grade was computed correctly and then discarded at the one moment
 * it would change the outfit. getProfileOccasionTier feeds candidate ranking, but slot
 * selection picks ONE piece per slot before candidates are assembled, and its score reads
 * no occasionFit at all. So an Acceptable piece could win a slot outright and a Strong
 * piece never entered any candidate — Nadeen's Acceptable leggings (17.588) beat two
 * Strong jeans (15.75), and Omar's Acceptable joggers won under a polo and a shirt jacket.
 *
 * Used as the PRIMARY sort key with the existing score as secondary, rather than as an
 * added bonus: a tuned number would leave the relationship dependent on the spread of
 * unrelated signals. That spread was 1.838 and nothing holds it there.
 *
 * MISSING IS NOT A DEMOTION. An unreviewed garment ranks with Acceptable, never below it.
 * The engine fails open on absent profile data throughout, and ranking unreviewed pieces
 * last would turn an incomplete catalogue into a styling verdict. It does not rank WITH
 * Strong either: fail-open means "treated as Acceptable".
 *
 * Generic across occasions by design. occasionFit carries the same semantics everywhere
 * and getProfileOccasionTier already grades them uniformly; honouring the grade for a busy
 * day but ignoring it for work would be a second inconsistency on top of the one this
 * fixes. Pinned by OGO-E.
 */
export function occasionGradeRank(
  item: ClosetAnchorInput,
  sessionOccasion: string,
): number {
  const tier = getProfileOccasionTier(item, sessionOccasion);
  if (tier === null) return 1;   // no profile, or no rating for this occasion → fail open
  return tier;                   // Strong 2 · Acceptable 1 · No 0
}

export function getProfileOccasionTier(
  item: ClosetAnchorInput,
  sessionOccasion: string,
): 0 | 1 | 2 | null {
  const profile = item.approvedProfile;
  if (!profile?.occasionFit) return null;
  const rating = profileOccasionRating(profile.occasionFit, sessionOccasion);
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
  // All pieces contribute to intention fit — bag/accessory/jewelry are included because
  // a structured bag or defining belt directly affects whether an outfit feels sharp/easy/etc.
  // STRUCTURAL_EXCLUDES is intentionally NOT applied here.
  const pieces = candidate.pieces;
  if (pieces.length === 0) return null;

  const itemMap = new Map(allItems.map((i) => [i.id, i]));
  let sum = 0;

  for (const piece of pieces) {
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

  return sum / pieces.length;
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
// Kept in sync with STRUCTURE_TAGS in styleme-result.server.ts, which is itself
// aligned to GARMENT_STYLE_TAG_VOCAB — the tokens the Closet AI emits. "sharp" and
// "minimalist" were never in that vocabulary and matched nothing.
const GATE_STRUCTURE_TAGS = new Set([
  "structured", "tailored", "polished", "classic",
  "elevated", "refined", "sophisticated", "minimal", "clean", "understated",
]);
const GATE_STRUCTURE_FIT_PROFILES = new Set(["structured", "tailored"]);
// "soft" intentionally excluded — closet AI uses it for physical fabric softness,
// not the feel-softer emotional intention. Physical soft ≠ feel-softer emotion.
const GATE_FLOW_TAGS = new Set(["flowing", "relaxed", "loose", "flowy", "oversized"]);

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
      const hasFit = fp !== null && GATE_STRUCTURE_FIT_PROFILES.has(fp);
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
      // Expansion intentions have no legacy tag heuristic either — an un-profiled
      // garment carries no evidence for elevated / stand-out / fun / powerful.
      if (EXPANSION_INTENTION_IDS.has(intentionId)) return NEUTRAL_NO_EVIDENCE;
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
      // Expansion intentions are approved-truth-only: no construction, colour,
      // register or silhouette field may stand in for a human rating.
      if (EXPANSION_INTENTION_IDS.has(intentionId)) return NEUTRAL_NO_EVIDENCE;
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
  // All pieces contribute to intention fit — STRUCTURAL_EXCLUDES is intentionally NOT applied
  // here so that bags, accessories, and jewelry with approved intentionPotentials are counted.
  const pieces = candidate.pieces;
  if (pieces.length === 0) return null;

  const itemMap = new Map(allItems.map((i) => [i.id, i]));

  // All-unprofiled: signal the caller to use the full outfit-level legacy heuristic.
  const hasAnyApprovedProfile = pieces.some((p) => {
    const item = itemMap.get(p.closetId);
    return item?.approvedProfile != null;
  });
  if (!hasAnyApprovedProfile) return null;

  // Hybrid: at least one piece has an approved profile.
  let sum = 0;
  for (const piece of pieces) {
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
  return sum / pieces.length;
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

// ── Register alignment scoring ────────────────────────────────────────────────
//
// Replaces the flat +0.5 register bonus in both anchor selection and slot filling.
//
// When formalityConditional is absent (hasFormalityConditional=false):
//   In-target → +1.0 small positive; out-of-target → 0 (no penalty for unspecified formality)
//
// When formalityConditional is present (hasFormalityConditional=true):
//   In-target              → +2.5  (strong preference)
//   1 rank outside target  → -1.5  (clear penalty)
//   2 ranks outside        → -3.0
//   3+ ranks outside       → -4.5  (capped — always preserves sole-candidate fallback)
//
// itemRank === null (no approved profile / unknown register) → 0 always (fail-open).
export function computeRegisterAlignmentScore(
  itemRank: number | null,
  targetRange: { min: number; max: number },
  hasFormalityConditional: boolean,
): number {
  if (itemRank === null) return 0;
  const inTarget = itemRank >= targetRange.min && itemRank <= targetRange.max;
  if (!hasFormalityConditional) return inTarget ? 1.0 : 0;
  if (inTarget) return 2.5;
  const distance = itemRank < targetRange.min
    ? targetRange.min - itemRank
    : itemRank - targetRange.max;
  return Math.max(-4.5, -1.5 * distance);
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

// ── Dressing-requirement gate for Closet items (item-level, non-compensable only) ─────
//
// MOVED here from styleme-result.server.ts so the anchor selector can reach it without
// the anchor → result → anchor import cycle that previously forced FORMALITY_RANK to be
// duplicated. styleme-result.server.ts re-exports it, so every existing caller and test
// keeps its import path.
//
// Only applies checks that cannot be satisfied through layering on top of this item.
// Compensable requirements (arms-covered, chest-neckline-covered, dresses-modestly) are
// evaluated at the complete-outfit level in passesCandidateDressingRequirements, never
// rejected at item-selection time.
//
// Non-compensable: legs-covered on bottom/dress items.
//   A midi or mini bottom CANNOT become legs-covered regardless of what is added on top.
//   "n/a" hemLength → item is a top or outerwear → exempt (does not cover legs at all).
//   null hemLength → unknown metadata → fail-open (keep the item in the pool).
// Garment Intelligence Phase 4C1 — narrowly scoped rollback switch for the hard
// length gate below. OFF = exactly the raw ClosetItem.hemLength/topLength reads.
// ON = the canonical/effective values computed alongside them by
// loadAllClosetItemsForEngine (resolveEffectiveLength) — not a second precedence
// implementation. Lives here, with the gate it controls, because StyleMe moved
// passesDressingRequirements into this module so the anchor selector could reach
// it without an import cycle; styleme-result.server.ts re-exports both so the
// Garment Intelligence tests keep their original import path.
const CANONICAL_STYLEME_LENGTH = process.env.CANONICAL_STYLEME_LENGTH === "true";

export function resolveGateLength(
  item: { hemLength?: string | null; effectiveHemLength?: string | null; topLength?: string | null; effectiveTopLength?: string | null } | undefined,
  canonicalEnabled: boolean,
): { hemLength: string | null; topLength: string | null } {
  if (!item) return { hemLength: null, topLength: null };
  if (!canonicalEnabled) return { hemLength: item.hemLength ?? null, topLength: item.topLength ?? null };
  return {
    hemLength: item.effectiveHemLength !== undefined ? item.effectiveHemLength : (item.hemLength ?? null),
    topLength: item.effectiveTopLength !== undefined ? item.effectiveTopLength : (item.topLength ?? null),
  };
}

// ── Coverage-conflict recoverability ──────────────────────────────────────
//
// A manual anchor that fails a coverage requirement fails it in one of two ways, and the
// difference is what the customer gets told.
//
//   unrecoverable            No outfit slot can make this garment satisfy the requirement.
//                            legs-covered on a leg garment: nothing lengthens a hem, and
//                            there is no under-bottom slot. "No layer can change that" is
//                            a true statement here, and only here.
//
//   recoverable-unsupported  Another slot COULD resolve it — a non-cropped top worn over a
//                            cropped piece — but StyleMe cannot build a layered anchor yet:
//                            OutfitSlot has no underlayer and candidates hold one piece per
//                            slot, so the covering top cannot be guaranteed. The anchor is
//                            still refused, because allowing it would WAIVE the Passport
//                            requirement rather than satisfy it. What changes is only the
//                            explanation: a limitation of the engine must not be reported
//                            as a law of physics.
//
// Manual QA found the cost of conflating them: a bra was refused with "no layer can change
// that", which is false — a bra under an opaque shirt satisfies no-cropped-tops. The
// preference is about midriff exposure in the LOOK (quiz label "I avoid cropped tops";
// Buy/Skip evaluates the same preference via midriffExposed), not about the garment's
// presence in the outfit.
//
// The other three dressing preferences (arms-covered, chest-neckline-covered,
// dresses-modestly) never reach here — they are compensated at outfit level by
// passesCandidateDressingRequirements and already allow the anchor.
//
// Follow-up, deliberately NOT in this release: an `underlayer` slot would turn
// recoverable-unsupported into genuinely allowed, with the covering top required rather
// than hoped for. That is an engine change, not a gate change.
export type AnchorCoverageRecoverability = "unrecoverable" | "recoverable-unsupported";

export interface AnchorCoverageConflict {
  requirement: "legs-covered" | "no-cropped-tops";
  recoverability: AnchorCoverageRecoverability;
}

export function classifyAnchorCoverageConflict(
  item: ClosetAnchorInput,
  dressingPreferences: readonly string[] | null | undefined,
): AnchorCoverageConflict | null {
  if (!dressingPreferences || dressingPreferences.length === 0) return null;
  const prefs = new Set(dressingPreferences);
  const gateLength = resolveGateLength(item, CANONICAL_STYLEME_LENGTH);

  if (prefs.has("legs-covered")) {
    const hl = gateLength.hemLength;
    if (hl !== null && hl !== undefined && hl !== "n/a" && hl !== "full" && hl !== "maxi") {
      return { requirement: "legs-covered", recoverability: "unrecoverable" };
    }
  }
  if (prefs.has("no-cropped-tops")) {
    const tl = gateLength.topLength;
    if (tl !== null && tl !== undefined && tl !== "n/a" && tl === "cropped") {
      return { requirement: "no-cropped-tops", recoverability: "recoverable-unsupported" };
    }
  }
  return null;
}

export function passesDressingRequirements(
  item: ClosetAnchorInput,
  dressingPreferences: readonly string[] | null | undefined,
): boolean {
  // Delegates to the classifier so the pool filter and the anchor gate can never drift
  // apart: one implementation of the two item-level checks, two different readings of it.
  // Verdicts are identical to the pre-classifier behaviour by construction.
  return classifyAnchorCoverageConflict(item, dressingPreferences) === null;
}

// ── Anchor eligibility ────────────────────────────────────────────────────────
//
// ONE deterministic gate, applied wherever an anchor is chosen — auto-selection,
// the manual Closet picker, and candidate construction. Before this existed the
// anchor was exempt from every hard requirement: `buildNaiaOutfitCandidates`
// filtered the rest of the Closet with `item.id === anchor.id || passesDressingRequirements(...)`,
// and `autoSelectClosetAnchor` was never handed the Passport at all. A customer who
// requires legs covered could therefore be anchored to a mini skirt, and every
// candidate built on that anchor would pass, because the candidate-level gate only
// covers arms, shoulders and neckline.
//
// What this gate enforces, and what it deliberately does not:
//
//   T1 occasion   — an APPROVED occasionFit of "No" is a hard exclusion. A human
//                   reviewer said this garment does not work for this occasion;
//                   being chosen as the anchor does not overrule that.
//   T2 formality  — NOT enforced. Formality is a ranking tier in this engine, never
//                   a hard requirement: a Dressy request against a casual Closet must
//                   still return the best available answer rather than nothing. The
//                   existing in-range/out-of-range sort in autoSelectClosetAnchor and
//                   the T2 comparator remain the only formality authorities.
//   T3 dressing   — non-compensable requirements only (legs-covered, no-cropped-tops).
//                   Compensable ones stay at outfit level, where a layer can satisfy them.
//
// Unknown metadata never rejects. A garment is refused only on explicit evidence.
export type AnchorRejectionCode =
  | "dressing-requirement"          // proven structurally unrecoverable
  | "layered-anchor-unsupported"    // another slot could resolve it; the engine cannot build that yet
  | "occasion-not-suitable";

export interface AnchorEligibility {
  eligible: boolean;
  code?: AnchorRejectionCode;
  /** Customer-facing sentence. States what happened; never blames, never invents a reason. */
  message?: string;
}

const ANCHOR_ELIGIBLE: AnchorEligibility = { eligible: true };

export function evaluateAnchorEligibility(
  item: ClosetAnchorInput,
  sessionOccasion: string,
  dressingPreferences: readonly string[] | null | undefined,
): AnchorEligibility {
  const coverage = classifyAnchorCoverageConflict(item, dressingPreferences);
  if (coverage !== null) {
    if (coverage.recoverability === "recoverable-unsupported") {
      return {
        eligible: false,
        code: "layered-anchor-unsupported",
        message:
          "This piece would need another top layered over it to meet your Style Passport. " +
          "StyleMe can't build that kind of layered anchor yet. Choose another piece for now.",
      };
    }
    return {
      eligible: false,
      code: "dressing-requirement",
      message:
        "This piece doesn't meet the coverage you've set in your Style Passport, " +
        "and no layer can change that. Choose another piece, or update your Passport.",
    };
  }

  if (!passesProfileOccasionGate(item, sessionOccasion)) {
    return {
      eligible: false,
      code: "occasion-not-suitable",
      message:
        "This piece has been reviewed as not suitable for this occasion. " +
        "Choose another piece, or change the occasion.",
    };
  }

  return ANCHOR_ELIGIBLE;
}

// ── Diagnostic explainer (NAIA_STYLEME_DIAGNOSTICS only) ─────────────────────
//
// Reports WHY passesDressingRequirements reached its answer. Pure, read-only, and
// called from nothing but the diagnostic log blocks — it must never gate anything.
// Mirrors the real predicate rather than reimplementing it: the overall verdict is
// taken from passesDressingRequirements itself, so the two cannot drift.
export interface DressingGateExplanation {
  passes: boolean;
  requirements: string[];
  legsCoveredPresent: boolean;
  /** e.g. "legs-covered: PASS — hemLength=full", "legs-covered: FAIL — hemLength=midi" */
  legsCovered: string | null;
  noCroppedTops: string | null;
  hemLength: string | null;
  topLength: string | null;
}

export function explainDressingRequirements(
  item: ClosetAnchorInput,
  dressingPreferences: readonly string[] | null | undefined,
): DressingGateExplanation {
  const prefs = [...(dressingPreferences ?? [])];
  const hl = item.hemLength ?? null;
  const tl = item.topLength ?? null;

  let legsCovered: string | null = null;
  if (prefs.includes("legs-covered")) {
    if (hl === null || hl === undefined) legsCovered = "legs-covered: PASS-UNKNOWN — hemLength=null (fail-open)";
    else if (hl === "n/a") legsCovered = "legs-covered: NOT-APPLICABLE — hemLength=n/a (does not cover the leg zone)";
    else if (hl === "full" || hl === "maxi") legsCovered = `legs-covered: PASS — hemLength=${hl}`;
    else legsCovered = `legs-covered: FAIL — hemLength=${hl}`;
  }

  let noCroppedTops: string | null = null;
  if (prefs.includes("no-cropped-tops")) {
    if (tl === null || tl === undefined) noCroppedTops = "no-cropped-tops: PASS-UNKNOWN — topLength=null (fail-open)";
    else if (tl === "n/a") noCroppedTops = "no-cropped-tops: NOT-APPLICABLE — topLength=n/a";
    else if (tl === "cropped") noCroppedTops = "no-cropped-tops: FAIL — topLength=cropped";
    else noCroppedTops = `no-cropped-tops: PASS — topLength=${tl}`;
  }

  return {
    // Taken from the real predicate so the explanation can never disagree with the gate.
    passes: passesDressingRequirements(item, dressingPreferences),
    requirements: prefs,
    legsCoveredPresent: prefs.includes("legs-covered"),
    legsCovered,
    noCroppedTops,
    hemLength: hl,
    topLength: tl,
  };
}

// ── Occasion × formality target register ──────────────────────────────────────
//
// Lives here rather than in styleme-result.server.ts because the anchor needs the
// same answer, and styleme-result.server.ts imports FROM styleme-anchor.server.ts.
// One resolver, one pair of tables, three call sites.
//
// Keys MUST be canonical session occasion IDs — the values StylingSession.occasion
// actually holds, after REV3_OCCASION_MAP has normalised the UI answer.
//
// girls-night tops out at `occasion` (5), not `evening` (6). A night out and a
// special event are different rooms: {2,6} spanned the entire scale, which made
// "Night out + Dressy" and "Special event + Dressy" resolve to the identical band
// and return the identical outfit.
export const OCCASION_FORMALITY_TARGET: Record<string, { min: number; max: number }> = {
  "everyday":      { min: 1, max: 2 },
  "work":          { min: 2, max: 4 },
  "dinner":        { min: 2, max: 5 },
  "date-night":    { min: 2, max: 3 },
  "special-event": { min: 3, max: 6 },
  "girls-night":   { min: 2, max: 5 },
  "family":        { min: 1, max: 2 },
  "travel":        { min: 1, max: 2 },
  "active":        { min: 1, max: 2 },
};

// The register she explicitly asked for.
export const FORMALITY_CONDITIONAL_ADJUSTMENTS: Record<string, { min: number; max: number }> = {
  "formality-relaxed": { min: 1, max: 2 },
  "formality-smart":   { min: 2, max: 3 },
  "formality-polished":{ min: 3, max: 4 },
  "formality-occasion":{ min: 4, max: 6 },
};

// ── Canonical register permission ────────────────────────────────────────────
//
// FORMALITY_CONDITIONAL_ADJUSTMENTS above is the ONE definition of what each dressiness
// answer permits, and it governs BOTH owned-closet garments and auto-selected NADINE
// products. Exported under this name so the permission question has an obvious home and
// so the NADINE side cannot quietly grow a second interpretation — which is exactly what
// had happened: the catalogue scorer carried relaxed {1,3} / smart {2,4} / polished {3,5}
// / occasion {4,5} while this table read {1,2} / {2,3} / {3,4} / {4,6}, so one customer
// answer meant two different things in the same session and a rank-4 trouser was offered
// for a Relaxed brief.
//
// ELIGIBILITY IS NOT SCORING. This decides what she is allowed to be shown. How the
// allowed items are then ranked is a separate question with its own, deliberately wider
// windows — see CATALOGUE_FORMALITY_SCORING_RANGES in styleme-recommendation.ts. Those two
// numbers do not need to agree, and the scoring table must never be consulted to decide
// whether something is permitted.
export const CANONICAL_REGISTER_BANDS = FORMALITY_CONDITIONAL_ADJUSTMENTS;

/**
 * The register band an EXPLICIT customer dressiness answer permits, or null.
 *
 * Null when she did not answer. Deliberately NOT falling back to an occasion's implicit
 * dressiness: an inferred assumption must not become a hidden exclusion. Occasion is
 * already a hard gate in its own right, and the implicit value still shapes soft ranking —
 * it simply does not remove anything.
 */
export function resolveCanonicalRegisterBand(
  formalityConditional: string | null | undefined,
): { min: number; max: number } | null {
  if (typeof formalityConditional !== "string" || formalityConditional === "") return null;
  return CANONICAL_REGISTER_BANDS[formalityConditional] ?? null;
}

/**
 * Resolves the target formality band for an occasion and an explicit formality answer.
 *
 * Intersecting two absolute bands is only meaningful when they overlap. For four
 * reachable combinations it produced min > max — a band no formality rank can
 * satisfy, so every candidate scored "outside target", T2 tied at -1 for the whole
 * pool, and formality was silently switched off. date-night + Dressy resolved to
 * 4-3; family + Dressy to 4-2.
 *
 * Where they do overlap the intersection is kept, unchanged. Where they do not, the
 * explicit answer owns the direction and the occasion supplies the other edge.
 */
export function getTargetFormalityRange(
  occasion: string,
  formalityConditional: string | null,
): { min: number; max: number } {
  const base = OCCASION_FORMALITY_TARGET[occasion] ?? { min: 1, max: 4 };
  if (!formalityConditional) return base;
  const adj = FORMALITY_CONDITIONAL_ADJUSTMENTS[formalityConditional];
  if (!adj) return base;

  const min = Math.max(base.min, adj.min);
  const max = Math.min(base.max, adj.max);
  if (min <= max) return { min, max };

  if (adj.min > base.max) {
    // She asked to dress above what the occasion expects. The occasion's own
    // ceiling falls OUTSIDE the band: if it stayed inside, "Dressy at a family
    // gathering" would count smart-casual as within-target and the occasion would
    // neutralise the request rather than calibrate it.
    return { min: base.max + 1, max: adj.min };
  }
  // She asked to dress below what the occasion expects. Here the occasion's floor
  // stays INSIDE the band — deliberately asymmetric with the case above. A special
  // event has a real external floor in a way a family gathering has no real
  // ceiling, so dressing down is calibrated more firmly than dressing up.
  return { min: adj.max, max: base.min };
}

// ── Finishing-piece suitability ───────────────────────────────────────────────
//
// "Best available owned item" is not the same as "good enough to recommend." A bag
// or shoe that is the highest-scoring option in the closet can still be wrong for the
// occasion, and offering it is worse than offering nothing: ST15 paired an evening gown
// with a business tote and block-heel ankle boots, and ST16 paired an evening skirt with
// the same tote, in both cases because they were the only options and scoring had no
// opinion about whether they belonged.
//
// The test uses FORMALITY_RANK — the scale getTargetFormalityRange already speaks and
// evaluateCompleteOutfit already scores the outfit register with. No second formality
// system is introduced, and the approved dressRegister path is left exactly as it is.
//
// A finishing piece is UNSUITABLE only when BOTH hold:
//
//   1. it sits below the occasion's target register floor, and
//   2. it sits more than one rank below the outfit's own base register.
//
// Requiring both is what makes the rule safe. Condition 1 alone strips a wardrobe that
// simply owns no formalwear — measured against the real QA runs it removed Omar's penny
// loafers AND his watch from a Night out, leaving him with no shoes at all, because his
// closet tops out one rank below the band. Condition 2 scales the judgement to the
// outfit actually being built: a rank-3 shoe beside rank-4 trousers is proportionate, the
// same shoe beside a rank-6 gown is not.
//
// Unknown formality is always suitable (fail-open) — an absent signal must never remove
// a garment. An unknown base register is likewise fail-open.
export const FINISHING_SUITABILITY_MAX_GAP_BELOW_BASE = 1;

// Slots judged on condition 1 alone, because the piece is OPTIONAL: if nothing clears the
// register floor the slot is simply left out, so there is no risk of leaving the outfit
// short of something it needs. A shoe is not in this set — an outfit with no shoes is
// broken, so a shoe is only removed when the mismatch is severe relative to the look
// (both conditions), which is what keeps a wardrobe owning no formalwear from being left
// barefoot.
//
// `accessory` joined after ST13 recommended a Black Ribbed Knit Beanie (rank 1) against an
// explicit Smart casual 2-2 target. The register penalty had fired — the beanie scored
// -1.5 — but a penalty only lowers a score, it never excludes, and the beanie was the only
// accessory left with a positive total. Omitting it also moves that outfit from
// underdressed 1.935 to within-target 2.000.
//
// `jewelry` is deliberately NOT here. The same argument would apply, but there is no
// observed case for it yet and widening without evidence is how a narrow rule turns into
// a blunt one.
//
// This asymmetry is the whole reason ST16's tote survived the first version: its outfit's
// base register was 2, so a rank-3 bag was not "below the base" at all, and the lenient
// test cleared it even though the band floor was 4.
export const FINISHING_STRICT_SLOTS = new Set<string>(["bag", "accessory"]);

export function finishingPieceIsSuitable(
  pieceFormalityRank: number | null,
  baseRegisterRank: number | null,
  targetBand: { min: number; max: number },
  slot?: string,
): boolean {
  if (pieceFormalityRank === null) return true;          // unknown → keep
  const belowBandFloor = pieceFormalityRank < targetBand.min;
  if (!belowBandFloor) return true;
  // Optional slots stop here: below the floor is enough to leave it out.
  if (slot !== undefined && FINISHING_STRICT_SLOTS.has(slot)) return false;
  if (baseRegisterRank === null) return true;            // nothing to compare against → keep
  const gapBelowBase = baseRegisterRank - pieceFormalityRank;
  return gapBelowBase <= FINISHING_SUITABILITY_MAX_GAP_BELOW_BASE;
}
