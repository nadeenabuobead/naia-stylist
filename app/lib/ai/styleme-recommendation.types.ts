// app/lib/ai/styleme-recommendation.types.ts
// Types for the deterministic StyleMe recommendation and outfit-composition engine.
// Phase 3C — do NOT import this file from result.tsx until Phase 3D.

import type { EligibilityState } from "./naia-catalog.types.js";

// ─── Outfit slots ─────────────────────────────────────────────────────────────

export type OutfitSlot = "top" | "bottom" | "dress" | "set" | "outerwear" | "unknown";

// ─── Evidence effect ─────────────────────────────────────────────────────────

export type EvidenceEffect =
  | "EXCLUDE"
  | "STRONG_RANK"
  | "RANK"
  | "LIGHT_RANK"
  | "DEPRIORITISE"
  | "NO_EFFECT";

// ─── Coded notes ──────────────────────────────────────────────────────────────

export type EvidenceCode =
  | "self-exclusion"
  | "slot-conflict-top-top"
  | "slot-conflict-top-dress"
  | "slot-conflict-top-set"
  | "slot-conflict-bottom-bottom"
  | "slot-conflict-bottom-dress"
  | "slot-conflict-bottom-set"
  | "slot-conflict-dress-bottom"
  | "slot-conflict-set-primary"
  | "slot-conflict-outerwear-outerwear"
  | "firm-no-colour-exclusion"
  | "nadine-avoid-exclusion"
  | "nadine-pairing-best"
  | "nadine-pairing-conditional"
  | "nadine-pairing-avoid"
  | "anchor-insufficient-evidence"
  | "provisional-evidence-used"
  | "diversity-adjusted"
  | "formality-match"
  | "formality-adjacent"
  | "formality-mismatch"
  | "coverage-non-negotiable-match"
  | "coverage-non-negotiable-missing"
  | "below-minimum-threshold";

// ─── Session input ────────────────────────────────────────────────────────────

export interface StyleMeSessionInput {
  moods: string[];
  desiredFeelings: string[];
  bodyNeeds: string[];
  coverageConditional: string | null;
  occasion: string;
  formalityConditional: string | null;
  todayColours: { preferred: string[]; avoid: string[] };
  practicalIds: string[];
  source: "naia-piece" | "my-closet" | "both";
}

// ─── Profile signals ──────────────────────────────────────────────────────────

export interface StyleMeProfileSignals {
  // Core identity
  stylePersonalities?: string[];
  favoriteColors?: string[];
  avoidColors?: string[];
  firmNoColors?: string[];
  styleSupport?: string[];
  desiredImpression?: string[];
  // Passport Lite — aspirational & contextual
  desiredFeelings?: string[];
  becoming?: string[];
  finalNotes?: string;
  lifestyle?: string[];
  dressesFor?: string[];
  // Body & fit
  bodyFocusAreas?: string[];
  bodyAvoidAreas?: string[];
  fitPreferences?: string[];
}

// ─── Anchor inputs ────────────────────────────────────────────────────────────

export interface NadineAnchorInput {
  type: "nadine";
  handle: string;
}

export interface ClosetAnchorInput {
  type: "closet";
  id: string;
  name: string | null;
  category: string;
  colors: string[];
  primaryColor: string | null;
  pattern: string | null;
  material: string | null;
  styleTags: string[];
  occasions: string[];
  imageUrl: string;
}

export type AnchorInput = NadineAnchorInput | ClosetAnchorInput;

// ─── Engine input ─────────────────────────────────────────────────────────────

export interface StyleMeEngineInput {
  session: StyleMeSessionInput;
  profile?: StyleMeProfileSignals;
  anchor?: AnchorInput | null;
  recentlyShownHandles?: string[];
}

// ─── Normalized anchors ───────────────────────────────────────────────────────

export interface NormalizedNadineAnchor {
  type: "nadine";
  handle: string;
  title: string;
  slot: OutfitSlot;
  colors: string[];
  stylePersonalityMatch: string[];
  formalityScore: number;
  bestPairedWith: string | null;
  conditionalPairings: string | null;
  avoidPairingWith: string | null;
}

export interface NormalizedClosetAnchor {
  type: "closet";
  id: string;
  label: string;
  slot: OutfitSlot;
  colors: string[];
  normalizedColorIds: string[];
  styleTags: string[];
  occasions: string[];
  material: string | null;
  hasStrongEvidence: boolean;
  evidenceFields: string[];
  imageUrl: string | null;
}

export type NormalizedStyleAnchor = NormalizedNadineAnchor | NormalizedClosetAnchor;

// ─── Closet compatibility evidence ───────────────────────────────────────────

export interface ClosetCompatibilityItem {
  closetField: string;
  productField: string;
  matchedToken: string;
  effect: EvidenceEffect;
  points: number;
  isExact: boolean;
}

export interface ClosetCompatibilityResult {
  confidence: "high" | "medium" | "low" | "insufficient";
  items: ClosetCompatibilityItem[];
  totalPoints: number;
}

// ─── Per-signal evidence entry ────────────────────────────────────────────────

export interface EvidenceEntry {
  field: string;
  matchedToken: string;
  sessionSignal: string;
  effect: EvidenceEffect;
  points: number;
  isProvisional: boolean;
  provisionalNote?: string;
  isFallback: boolean;
  isSupplemental: boolean;
}

// ─── Anchor compatibility ─────────────────────────────────────────────────────

export interface AnchorCompatibility {
  status:
    | "compatible"
    | "compatible-with-conditions"
    | "incompatible"
    | "insufficient-evidence";
  isHardExclusion: boolean;
  exclusionReason?: EvidenceCode;
  pairingNote?: string;
  conditions?: string;
}

// ─── Semantic tie-break components ───────────────────────────────────────────

export interface SemanticTieBreak {
  anchorConfidence: number;             // 0–4 ordinal: stronger anchor compatibility wins
  matchedCategoryCount: number;         // 0–6 distinct signal categories with ≥1 positive hit
  positiveNonSupplementalCount: number; // more positive direct evidence wins
  totalNegativePenalty: number;         // 0 or negative; less negative (closer to 0) wins
  provisionalCount: number;             // fewer provisional evidence items wins
  sessionSpecificHash: number;          // djb2(fingerprint|handle); varies per session
}

// ─── Per-product evaluation ───────────────────────────────────────────────────

export interface ProductEvaluation {
  handle: string;
  title: string;
  eligibility: EligibilityState;
  slot: OutfitSlot;
  isHardExcluded: boolean;
  hardExclusionReasons: EvidenceCode[];
  totalScore: number;
  positiveEvidence: EvidenceEntry[];
  negativeEvidence: EvidenceEntry[];
  anchorCompatibility: AnchorCompatibility;
  provisionalEvidenceUsed: boolean;
  stylePersonalityMatchType: "direct" | "style-tags-fallback" | "none";
  practicalSupportType: "direct" | "supplemental-only" | "mixed" | "none";
  diversityAdjustment: number;
  deterministicRank: number;
  closetCompatibility: ClosetCompatibilityResult | null;
  semanticTieBreak: SemanticTieBreak;
}

// ─── Ranked product (output) ──────────────────────────────────────────────────

export interface RankedProduct {
  handle: string;
  title: string;
  slot: OutfitSlot;
  totalScore: number;
  positiveEvidence: EvidenceEntry[];
  negativeEvidence: EvidenceEntry[];
  anchorCompatibility: AnchorCompatibility;
  provisionalEvidenceUsed: boolean;
}

// ─── Outfit plan ──────────────────────────────────────────────────────────────

export interface OutfitPlan {
  anchorSlot: OutfitSlot | null;
  recommendedSlot: OutfitSlot | null;
  compatibilityStatus:
    | "compatible"
    | "compatible-with-conditions"
    | "closet-led"
    | "insufficient-anchor-evidence";
  notes: EvidenceCode[];
}

// ─── Engine result ────────────────────────────────────────────────────────────

export interface StyleMeRecommendationResult {
  outcome: "nadine-recommendation" | "closet-led" | "no-eligible-product";
  anchor: NormalizedStyleAnchor | null;
  primary: RankedProduct | null;
  alternatives: RankedProduct[];
  outfitPlan: OutfitPlan;
  evaluatedProducts: ProductEvaluation[];
  coverage: {
    totalCatalogProducts: number;
    eligibleCandidates: number;
    excludedCandidates: number;
  };
}
