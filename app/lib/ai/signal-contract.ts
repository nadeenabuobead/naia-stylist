// app/lib/ai/signal-contract.ts
// Canonical Style Profile + StyleMe signal contract.
// Side-effect-free: no imports, no DB queries, no Claude calls.
// Source of truth for answer IDs, product-field mappings, and precedence rules.

// ─────────────────────────────────────────────────────────────────────────────
// Product Template Fields — 54 fields (46 original + 8 dressing metadata added V8 Rev 3).
// Column A field labels, parsed case-insensitively from vertical product blocks.
// ─────────────────────────────────────────────────────────────────────────────

export const PRODUCT_TEMPLATE_FIELDS = {
  // Product facts
  VERIFIED_TITLE: "verifiedTitle",
  HANDLE: "handle",
  LIVE_URL: "liveUrl",
  FEATURED_IMAGE_URL: "featuredImageUrl",
  ITEM_TYPE: "itemType",
  STYLEABLE_COMPONENTS: "styleableComponents",
  COLORS: "colors",
  SILHOUETTE: "silhouette",
  FIT: "fit",
  FABRIC: "fabric",
  ACTIVE_PUBLISHED: "activePublished",
  ART_STORY_DESCRIPTION: "artStoryDescription",
  // Style Me Intelligence
  STYLING_ROLE: "stylingRole",
  DESIRED_FEELING_MATCH: "desiredFeelingMatch",
  STYLE_PERSONALITY_MATCH: "stylePersonalityMatch",
  STYLE_TAGS: "styleTags",
  OCCASION_TAGS: "occasionTags",
  PRODUCT_STYLE_DESCRIPTORS: "productStyleDescriptors",
  FORMALITY_SCORE: "formalityScore",
  FORMALITY_DESCRIPTION: "formalityDescription",
  SEASON: "season",
  BODY_FIT_LOGIC: "bodyFitLogic",
  BODY_PROPORTION_EFFECTS: "bodyProportionEffects",
  STYLE_ME_COMFORT_MATCH: "styleMeComfortMatch",
  COVERAGE_MODESTY: "coverageModesty",
  PROPORTION_RULE: "proportionRule",
  NOT_IDEAL_FOR: "notIdealFor",
  CURRENT_EMOTIONAL_STATE_SUPPORT: "currentEmotionalStateSupport",
  EMOTIONAL_SUPPORT_LOGIC: "emotionalSupportLogic",
  PRACTICAL_SUPPORT_MATCH: "practicalSupportMatch",
  PRACTICAL_SUPPORT_LOGIC: "practicalSupportLogic",
  STYLING_EFFORT_LEVEL: "stylingEffortLevel",
  // Pairing Logic
  BEST_PAIRED_WITH_NADINE: "bestPairedWithNadinePieces",
  CONDITIONAL_NADINE_PAIRINGS: "conditionalNadinePairings",
  AVOID_PAIRING_WITH_NADINE: "avoidPairingWithNadinePieces",
  BEST_PAIRED_WITH_GENERAL: "bestPairedWithGeneral",
  AVOID_PAIRING_WITH_GENERAL: "avoidPairingWithGeneral",
  PAIRING_REASON: "pairingReason",
  ACCESSORIES_DIRECTION: "accessoriesDirection",
  SHOE_DIRECTION: "shoeDirection",
  COLOR_DIRECTION: "colorDirection",
  SKIN_TONE_COLOUR_HARMONY: "skinToneColourHarmony",
  COMPLEXION_STYLING_NOTE: "complexionStylingNote",
  HAIR_STYLING_DIRECTION: "hairStylingDirection",
  HAIR_STYLING_NOTE: "hairStylingNote",
  STYLEME_EXPLANATION: "styleMeExplanation",
  // Dressing metadata — added V8 Rev 3 (Group 2 / Rev 5 spec)
  MODESTY_SAFE: "modestySafe",
  ABAYA_COMPATIBLE: "abayaCompatible",
  HIJAB_COMPATIBLE: "hijabCompatible",
  SLEEVE_LENGTH: "sleeveLength",
  NECKLINE_COVERAGE: "necklineCoverage",
  HEM_LENGTH: "hemLength",
  TOP_LENGTH: "topLength",
  FIT_PROFILE: "fitProfile",
} as const;

export type ProductTemplateField =
  typeof PRODUCT_TEMPLATE_FIELDS[keyof typeof PRODUCT_TEMPLATE_FIELDS];

export const ALL_PRODUCT_TEMPLATE_FIELD_VALUES = new Set<ProductTemplateField>(
  Object.values(PRODUCT_TEMPLATE_FIELDS)
);

// ─────────────────────────────────────────────────────────────────────────────
// Recommendation behaviours
// ─────────────────────────────────────────────────────────────────────────────

export const RECOMMENDATION_BEHAVIOURS = {
  // Product is excluded when a required attribute is absent (eligibility gate only).
  HARD_FILTER: "HARD_FILTER",
  // Strong positive ranking signal; significantly boosts matching candidates.
  STRONG_RANK: "STRONG_RANK",
  // Mild positive ranking signal; softly boosts matching candidates.
  SOFT_RANK: "SOFT_RANK",
  // Mild negative ranking signal; ordinary preference avoidance (not hard exclusion).
  DEPRIORITISE: "DEPRIORITISE",
  // Outfit/pairing composition signal; no direct single-piece product score.
  PAIRING: "PAIRING",
  // Used in explanation or narrative only; no ranking effect.
  EXPLANATION_ONLY: "EXPLANATION_ONLY",
  // Amplifies compatible active Profile signals; no direct product field score.
  PROFILE_AMPLIFY: "PROFILE_AMPLIFY",
  // Affects interpretation and explanation only; no product-field match.
  CONTEXTUAL: "CONTEXTUAL",
  // No effect on recommendations or ranking.
  NO_RECOMMENDATION_EFFECT: "NO_RECOMMENDATION_EFFECT",
} as const;

export type Behaviour =
  typeof RECOMMENDATION_BEHAVIOURS[keyof typeof RECOMMENDATION_BEHAVIOURS];

// ─────────────────────────────────────────────────────────────────────────────
// Candidate pool — source pre-filter (pool constraint, not a product-field score)
// ─────────────────────────────────────────────────────────────────────────────

export const CANDIDATE_POOLS = {
  NAIA_ONLY: "NAIA_ONLY",
  CLOSET_ONLY: "CLOSET_ONLY",
  BOTH: "BOTH",
} as const;

export type CandidatePool = typeof CANDIDATE_POOLS[keyof typeof CANDIDATE_POOLS];

// ─────────────────────────────────────────────────────────────────────────────
// Product eligibility tri-state
// verified-active  → eligible for recommendation
// verified-inactive → excluded from candidate pool
// unverified        → eligible (with verification flag); all 11 V7 products
// ─────────────────────────────────────────────────────────────────────────────

export const ELIGIBILITY_STATES = {
  VERIFIED_ACTIVE: "verified-active",
  VERIFIED_INACTIVE: "verified-inactive",
  UNVERIFIED: "unverified",
} as const;

export type EligibilityState =
  typeof ELIGIBILITY_STATES[keyof typeof ELIGIBILITY_STATES];

// Shopify admin verification required for all 11 before recommendation-engine launch.
export const PRODUCT_ELIGIBILITY: Record<string, EligibilityState> = {
  "double-top": "unverified",
  "collar-shirt": "unverified",
  "asymmetrical-pants": "unverified",
  "draped-leather-pants": "unverified",
  "suede-skirt": "unverified",
  "trench-coat": "unverified",
  "kimono-jacket": "unverified",
  "leather-suede-jacket": "unverified",
  "oversized-blazer": "unverified",
  "midi-dress": "unverified",
  "dress-set": "unverified",
};

// ─────────────────────────────────────────────────────────────────────────────
// Core types
// ─────────────────────────────────────────────────────────────────────────────

export interface AnswerMapping {
  id: string;
  questionId: string;
  activatedFields: ProductTemplateField[];
  behaviours: Behaviour[];
  /** "active" for signal-generating answers; "none" for analytics-only */
  rankingWeight: "active" | "none";
  /** Set for source answers — drives candidate pool pre-filter */
  candidatePool?: CandidatePool;
  /** true for coverage-non-negotiable only */
  coverageNonNegotiable?: boolean;
  /** true for firm-no colour exclusion; ordinary avoidance uses DEPRIORITISE */
  firmNo?: boolean;
}

export interface ProductFieldEvidence {
  productHandle: string;
  field: ProductTemplateField;
  canonicalValue: string;
  evidenceStatus: "confirmed" | "provisional";
  provisionalNote?: string;
}

export interface SessionQuestion {
  id: string;
  storageKey: string;
  maxSelections: number | null;
  minSelections?: number;
  isConditional?: boolean;
  showForOccasions?: string[];
  skipForOccasions?: string[];
}

export interface ProfileQuestion {
  id: string;
  rankingWeight: "active" | "none";
  /** false when question does not yet exist in live quiz-data.ts */
  exists: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Session questions — locked 9-step order
// ─────────────────────────────────────────────────────────────────────────────

export const SESSION_QUESTION_IDS = {
  MOOD: "sq-mood",
  DESIRED_FEELING: "sq-desired-feeling",
  BODY_NEEDS: "sq-body-needs",
  COVERAGE_CONDITIONAL: "sq-coverage-conditional",
  OCCASION: "sq-occasion",
  FORMALITY_CONDITIONAL: "sq-formality-conditional",
  TODAY_COLOURS: "sq-today-colours",
  PRACTICAL_PLANNING: "sq-practical-planning",
  SOURCE: "sq-source",
  // Anchor keys — populated by the Source step after source type is chosen.
  // Conditional: NADINE_ANCHOR_HANDLE only when source === "naia-piece".
  //              CLOSET_ANCHOR_ID only when source === "my-closet" or "both".
  NADINE_ANCHOR_HANDLE: "sq-nadine-anchor-handle",
  CLOSET_ANCHOR_ID: "sq-closet-anchor-id",
  // Rev 3 — Psychology-First StyleMe (Group 5)
  STATE: "sq-state",
  INTENTIONS: "sq-intentions",
} as const;

export const SQ = SESSION_QUESTION_IDS;

export const SESSION_QUESTIONS: SessionQuestion[] = [
  {
    id: SQ.MOOD,
    storageKey: "styleMeMood",
    minSelections: 1,
    maxSelections: 2,
  },
  {
    id: SQ.DESIRED_FEELING,
    storageKey: "styleMeFeelings",
    maxSelections: 2,
  },
  {
    id: SQ.BODY_NEEDS,
    storageKey: "styleMeBodyNeeds",
    maxSelections: 2,
  },
  {
    id: SQ.COVERAGE_CONDITIONAL,
    storageKey: "styleMeCoverageConditional",
    maxSelections: 1,
    isConditional: true,
  },
  {
    id: SQ.OCCASION,
    storageKey: "styleMeOccasion",
    maxSelections: 1,
  },
  {
    id: SQ.FORMALITY_CONDITIONAL,
    storageKey: "styleMeFormalityConditional",
    maxSelections: 1,
    isConditional: true,
    showForOccasions: [
      "work",
      "dinner",
      "date-night",
      "girls-night",
      "family",
      "special-event",
      "not-sure",
    ],
    skipForOccasions: ["everyday", "travel"],
  },
  {
    id: SQ.TODAY_COLOURS,
    storageKey: "styleMeTodayColours",
    maxSelections: null,
  },
  {
    id: SQ.PRACTICAL_PLANNING,
    storageKey: "styleMePractical",
    maxSelections: 2,
  },
  {
    id: SQ.SOURCE,
    storageKey: "styleMeSource",
    maxSelections: 1,
  },
  {
    id: SQ.NADINE_ANCHOR_HANDLE,
    storageKey: "styleMeNadineAnchorHandle",
    maxSelections: 1,
    isConditional: true,
  },
  {
    id: SQ.CLOSET_ANCHOR_ID,
    storageKey: "styleMeClosetAnchorId",
    maxSelections: 1,
    isConditional: true,
  },
  // Rev 3 — Psychology-First screens
  {
    id: SQ.STATE,
    storageKey: "styleMeState",
    maxSelections: 1,
  },
  {
    id: SQ.INTENTIONS,
    storageKey: "styleMeIntentions",
    maxSelections: 2,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Profile questions
// ─────────────────────────────────────────────────────────────────────────────

export const PROFILE_QUESTION_IDS = {
  STYLE_PERSONALITIES: "style-personalities",
  DESIRED_IMPRESSION: "desired-impression",
  LIFESTYLE: "lifestyle",
  DESIRED_FEELINGS: "desired-feelings",
  BECOMING: "becoming",
  FIT_PREFERENCES: "fit-preferences",
  WARDROBE_DISCONNECTION: "wardrobe-disconnection",
  FAVORITE_COLORS: "favorite-colors",
  AVOID_COLORS: "avoid-colors",
  STYLE_SUPPORT: "style-support",
  FINAL_NOTES: "final-notes",
  // Not yet present in live quiz-data.ts; declared for future wiring.
  // No stored Profile data exists until this question is added to onboarding.
  PRACTICAL_NEEDS: "practical-needs",
} as const;

export const PQ = PROFILE_QUESTION_IDS;

export const PROFILE_QUESTIONS: ProfileQuestion[] = [
  { id: PQ.STYLE_PERSONALITIES, rankingWeight: "active", exists: true },
  { id: PQ.DESIRED_IMPRESSION, rankingWeight: "active", exists: true },
  { id: PQ.LIFESTYLE, rankingWeight: "active", exists: true },
  { id: PQ.DESIRED_FEELINGS, rankingWeight: "active", exists: true },
  { id: PQ.BECOMING, rankingWeight: "none", exists: true },
  { id: PQ.FIT_PREFERENCES, rankingWeight: "active", exists: true },
  { id: PQ.WARDROBE_DISCONNECTION, rankingWeight: "none", exists: true },
  { id: PQ.FAVORITE_COLORS, rankingWeight: "active", exists: true },
  { id: PQ.AVOID_COLORS, rankingWeight: "active", exists: true },
  { id: PQ.STYLE_SUPPORT, rankingWeight: "none", exists: true },
  { id: PQ.FINAL_NOTES, rankingWeight: "active", exists: true },
  { id: PQ.PRACTICAL_NEEDS, rankingWeight: "active", exists: false },
];

// ─────────────────────────────────────────────────────────────────────────────
// BPE alias map
// bodyProportionEffects does NOT contain literal canonical Body Need IDs.
// Maps BPE alias → canonical Body Need ID(s) for deduplication/lookup.
// ─────────────────────────────────────────────────────────────────────────────

export const BPE_ALIAS_MAP: Record<string, readonly string[]> = {
  "waist-definition": ["defines-waist", "emphasises-waist"],
  "defines-waist": ["defines-waist"],
  "emphasises-waist": ["emphasises-waist"],
  "elongates": ["elongates-legs", "elongates-torso", "elongates-body", "creates-vertical-line"],
  "elongates-legs": ["elongates-legs"],
  "elongates-torso": ["elongates-torso"],
  "elongates-body": ["elongates-body"],
  "creates-vertical-line": ["creates-vertical-line"],
  "balances": ["balances-shoulders-and-hips"],
  "balances-shoulders-and-hips": ["balances-shoulders-and-hips"],
  "balances-proportions": ["balances-shoulders-and-hips"],
};

// ─────────────────────────────────────────────────────────────────────────────
// Body Need normalisation map
// Legacy or shorthand answer IDs → canonical Body Need session IDs.
// Routes apply this before writing session storage.
// "bloated" is a legacy alias for the waist-ease need.
// "nothing-clingy" normalises to "relaxed".
// ─────────────────────────────────────────────────────────────────────────────

export const BODY_NEED_NORMALIZATION_MAP: Record<string, string> = {
  bloated: "soft-and-forgiving-around-waist",
  "nothing-clingy": "relaxed",
  // Rev 3 Physical Need IDs → canonical engine signals (Group 5)
  "nothing-tight-waist": "soft-and-forgiving-around-waist",
  "less-body-conscious": "relaxed",
  "loose-comfortable": "relaxed",
};

// ─────────────────────────────────────────────────────────────────────────────
// Style Personality V2→V3 translation
// Maps stored V2 Passport profile IDs to the V3 catalogue archetype tokens
// introduced in Group 3 (Rev 4 workbook).  Applied before SPM direct-match so
// existing customer profiles containing V2 IDs continue to score correctly.
// Many-to-one: multiple V2 IDs may map to the same V3 archetype.
// V3 IDs are not in this map; they pass through as-is.
// ─────────────────────────────────────────────────────────────────────────────

export const PROFILE_SP_V2_TO_V3_MAP: Readonly<Record<string, string>> = {
  "old-money":         "classic-polished",
  "corporate-chic":    "classic-polished",
  "feminine":          "feminine-romantic",
  "romantic":          "feminine-romantic",
  "minimal":           "minimal-relaxed",
  "casual-cool":       "minimal-relaxed",
  "effortlessly-chic": "minimal-relaxed",
  "edgy":              "bold-edgy",
  "trendy":            "bold-edgy",
  "artsy":             "creative-expressive",
};

// ─────────────────────────────────────────────────────────────────────────────
// Style Personality style-tag fallback
// Profile IDs in this set have no guaranteed direct STYLE_PERSONALITY_MATCH on
// every product.  When none exists, recommendation logic may consult STYLE_TAGS.
// ─────────────────────────────────────────────────────────────────────────────

export const STYLE_PERSONALITY_STYLE_TAG_FALLBACK = new Set<string>([
  // V2 IDs (backward compat)
  "old-money",
  "minimal",
  "casual-cool",
  // V3 IDs (Group 1) — absorb V2 fallback equivalents
  "classic-polished",  // absorbs old-money
  "minimal-relaxed",   // absorbs minimal, casual-cool
]);

// ─────────────────────────────────────────────────────────────────────────────
// Practical Support normalization
// UI session ID → canonical ANSWER_REGISTRY ID written to styleMePractical.
// ─────────────────────────────────────────────────────────────────────────────

export const PSM_NORMALIZATION_MAP: Record<string, string> = {
  "lots-of-movement": "movement-friendly",
};

// ─────────────────────────────────────────────────────────────────────────────
// Practical Support supplemental product-only tokens
// These appear in PRACTICAL_SUPPORT_MATCH workbook fields but have no direct
// session-answer match.  They may support explanation, tie-breaking, or effort
// interpretation in Phase 3C.  Do not award direct session-match scoring unless
// an explicit mapping is approved.
// ─────────────────────────────────────────────────────────────────────────────

export const PSM_SUPPLEMENTAL_PRODUCT_TOKENS = new Set<string>([
  "adaptable",
  "easy-layering",
  "higher-effort-statement",
]);

// ─────────────────────────────────────────────────────────────────────────────
// Profile legacy translation table
// Maps stored Profile answer IDs → canonical values used in product fields.
// comfortable → relaxed (Body Need); elegant → more-elevated (DFM canonical).
// ─────────────────────────────────────────────────────────────────────────────

export const PROFILE_DESIRED_FEELING_TRANSLATION: Record<string, string> = {
  confident: "more-confident",
  comfortable: "relaxed",   // routes to styleMeComfortMatch, not desiredFeelingMatch
  "put-together": "more-put-together",
  elegant: "more-elevated",
  feminine: "more-feminine",
  powerful: "more-powerful",
  effortless: "more-effortless",
  attractive: "more-attractive",
};

// Maps fitPreference quiz answer IDs → styleMeComfortMatch catalog tokens.
// RANK weight only — softer than session body-need STRONG_RANK.
export const PROFILE_FIT_PREFERENCE_SMCM_MAP: Readonly<Record<string, string>> = {
  "defined-waist": "waist-definition",
  "relaxed-fits":  "relaxed",
  "structured":    "structured",
  "oversized":     "relaxed",
  "flowy":         "relaxed",
  "coverage":      "more-coverage",
  "fitted":        "structured",
  "simple":        "comfortable-elevated",
};

// Maps Passport Silhouette quiz IDs → styleMeComfortMatch catalog tokens.
// RANK weight only — softer than session body-need STRONG_RANK.
// Only the 4 semantically exact pairs are mapped. "straight" and "fitted" are
// V2 IDs kept for backward compat. V3 IDs added in Group 1.
// Intentionally unmapped: "straight" (V2 legacy), "not-sure" (V3 zero-scoring — by design).
// New SMCM tokens introduced in V3: "fitted" and "straight-clean".
export const PROFILE_SILHOUETTE_SMCM_MAP: Readonly<Record<string, string>> = {
  // V2 vocabulary (backward compat)
  "defined-waist":      "waist-definition",
  "oversized":          "relaxed",
  "flowing":            "relaxed",
  "relaxed":            "relaxed",
  // V3 vocabulary (Group 1)
  "fitted":             "fitted",          // new SMCM token; must NOT proxy to "structured"
  "waist-defined":      "waist-definition",
  "straight-simple":    "straight-clean",  // new SMCM token; zero catalog products — catalog reality
  "loose-flowing":      "relaxed",
  "structured-tailored": "structured",
  // Gender-inclusive additions (Group A)
  "boxy":               "relaxed",         // volume-forward; closest SMCM equivalent
  "tapered":            "straight-clean",  // narrowed at hem; structured-clean silhouette
};

// Passport Coverage quiz IDs that softly support the "more-coverage" Body Need.
// RANK weight only; only applied when the session's own Body Needs did not
// already provide an explicit coverage answer (see scoreProduct §11.5c).
export const PROFILE_COVERAGE_PREFERRED_VALUE = "mostly-covered"; // preferredCoverage single-select
export const PROFILE_COVERAGE_MULTI_IDS: ReadonlySet<string> = new Set([
  "sleeves-preferred",
  "longer-hemlines",
]);

// Maps lifestyle quiz answer IDs → occasionTags catalog tokens.
// V2 IDs: office, busy-mom, creative, casual-days, events, on-the-go, travel, hybrid.
// V3 IDs (Group 1): work-office, everyday-casual, dinners-going-out,
// events-special-occasions, family-parenting, active-busy-days.
// One quiz answer may map to multiple occasion tokens.
export const PROFILE_LIFESTYLE_OCCASION_MAP: Readonly<Record<string, readonly string[]>> = {
  // V2 vocabulary (backward compat)
  "office":                   ["work"],
  "busy-mom":                 ["everyday"],
  "creative":                 ["everyday"],
  "casual-days":              ["everyday"],
  "events":                   ["dinner", "date-night", "girls-night"],
  "on-the-go":                ["everyday", "travel"],
  "travel":                   ["travel"],
  "hybrid":                   ["work", "everyday"],
  // V3 vocabulary (Group 1)
  "work-office":              ["work"],
  "everyday-casual":          ["everyday"],
  "dinners-going-out":        ["dinner", "date-night", "girls-night"],
  "events-special-occasions": ["special-event"],
  "family-parenting":         ["everyday", "family"],
  "active-busy-days":         ["everyday", "travel"],
};

// Maps profile desiredImpression quiz IDs → desiredFeelingMatch canonical tokens.
// IDs without a clean DFM analog in the current catalog are intentionally omitted
// ("creative", "interesting" — no product carries a matching DFM token).
// Tech debt: ANSWER_REGISTRY desiredImpression entries use stale IDs and wrong target
// field; those entries have no active runtime consumer and are left unchanged in V2-A3.
export const PROFILE_DESIRED_IMPRESSION_DFM_MAP: Readonly<Record<string, string>> = {
  "refined":        "more-elevated",
  "powerful":       "more-powerful",
  "soft-confident": "more-confident",
  "effortless":     "more-effortless",
  "feminine":       "more-feminine",
  "put-together":   "more-put-together",
};

// Maps profile becoming quiz IDs → desiredFeelingMatch canonical tokens.
// IDs without a clean DFM analog in the current catalog are intentionally omitted
// ("more-creative", "more-visible", "new-chapter").
// Tech debt: ANSWER_REGISTRY becoming entries use V0 IDs and are analytics-only;
// those entries have no active runtime consumer and are left unchanged in V2-A3.
export const PROFILE_BECOMING_DFM_MAP: Readonly<Record<string, string>> = {
  "more-confident":  "more-confident",
  "more-polished":   "more-put-together",
  "more-feminine":   "more-feminine",
  "more-powerful":   "more-powerful",
  "more-effortless": "more-effortless",
  "more-refined":    "more-elevated",
};

// ─────────────────────────────────────────────────────────────────────────────
// Styling Effort Rule
// Activated only when one of the activation moods is selected.
// Never a hard exclusion; cannot override a strong multidimensional match.
// Numeric modifier values deferred to recommendation engine.
// ─────────────────────────────────────────────────────────────────────────────

export const STYLING_EFFORT_RULE = {
  activationMoods: ["tired", "low-energy", "feeling-low", "overwhelmed"] as const,
  targetField: PRODUCT_TEMPLATE_FIELDS.STYLING_EFFORT_LEVEL,
  direction: {
    low: "mild-positive",
    medium: "neutral",
    high: "mild-negative",
  },
  isHardExclusion: false,
  canOverrideStrongMatch: false,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Dual-Mood Bonus
// When both selected moods match a product's ESS, one capped additive bonus
// applies in addition to the two individual STRONG_RANK contributions.
// Capping and numeric weight deferred to recommendation engine.
// ─────────────────────────────────────────────────────────────────────────────

export const DUAL_MOOD_BONUS = {
  targetField: PRODUCT_TEMPLATE_FIELDS.CURRENT_EMOTIONAL_STATE_SUPPORT,
  requiresBothMoodsMatch: true,
  isCapped: true,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Answer registry
// IDs may appear under multiple questions (e.g. "nothing-specific",
// "movement-friendly"). Use getMappingsByIdAndQuestion when question context
// is known; getMappingById returns the first registered entry.
// ─────────────────────────────────────────────────────────────────────────────

export const ANSWER_REGISTRY: readonly AnswerMapping[] = [
  // ── Session: Mood ────────────────────────────────────────────────────────
  // Locked vocabulary (12): confident, tired, low-energy, feeling-low,
  // overwhelmed, adventurous, romantic, powerful, need-reset, feel-good,
  // self-conscious (CONTEXTUAL), neutral (NO_RECOMMENDATION_EFFECT).
  // adventurous replaced playful — openness to a less predictable, more
  // expressive styling choice today; not synonymous with loud/colourful/
  // edgy/trend-driven, and does not override Passport/Occasion/Body Needs.
  // energised and bloated are NOT canonical mood IDs.

  {
    id: "confident",
    questionId: SQ.MOOD,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.CURRENT_EMOTIONAL_STATE_SUPPORT],
    behaviours: [RECOMMENDATION_BEHAVIOURS.STRONG_RANK],
    rankingWeight: "active",
  },
  {
    id: "adventurous",
    questionId: SQ.MOOD,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.CURRENT_EMOTIONAL_STATE_SUPPORT],
    behaviours: [RECOMMENDATION_BEHAVIOURS.STRONG_RANK],
    rankingWeight: "active",
  },
  {
    id: "romantic",
    questionId: SQ.MOOD,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.CURRENT_EMOTIONAL_STATE_SUPPORT],
    behaviours: [RECOMMENDATION_BEHAVIOURS.STRONG_RANK],
    rankingWeight: "active",
  },
  {
    id: "powerful",
    questionId: SQ.MOOD,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.CURRENT_EMOTIONAL_STATE_SUPPORT],
    behaviours: [RECOMMENDATION_BEHAVIOURS.STRONG_RANK],
    rankingWeight: "active",
  },
  {
    id: "need-reset",
    questionId: SQ.MOOD,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.CURRENT_EMOTIONAL_STATE_SUPPORT],
    behaviours: [RECOMMENDATION_BEHAVIOURS.STRONG_RANK],
    rankingWeight: "active",
  },
  {
    id: "feel-good",
    questionId: SQ.MOOD,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.CURRENT_EMOTIONAL_STATE_SUPPORT],
    behaviours: [RECOMMENDATION_BEHAVIOURS.STRONG_RANK],
    rankingWeight: "active",
  },
  // Styling Effort Rule activation moods — STRONG_RANK against ESS
  // plus mild SEL modifier (declared in STYLING_EFFORT_RULE).
  {
    id: "tired",
    questionId: SQ.MOOD,
    activatedFields: [
      PRODUCT_TEMPLATE_FIELDS.CURRENT_EMOTIONAL_STATE_SUPPORT,
      PRODUCT_TEMPLATE_FIELDS.STYLING_EFFORT_LEVEL,
    ],
    behaviours: [RECOMMENDATION_BEHAVIOURS.STRONG_RANK],
    rankingWeight: "active",
  },
  {
    id: "low-energy",
    questionId: SQ.MOOD,
    activatedFields: [
      PRODUCT_TEMPLATE_FIELDS.CURRENT_EMOTIONAL_STATE_SUPPORT,
      PRODUCT_TEMPLATE_FIELDS.STYLING_EFFORT_LEVEL,
    ],
    behaviours: [RECOMMENDATION_BEHAVIOURS.STRONG_RANK],
    rankingWeight: "active",
  },
  {
    id: "feeling-low",
    questionId: SQ.MOOD,
    activatedFields: [
      PRODUCT_TEMPLATE_FIELDS.CURRENT_EMOTIONAL_STATE_SUPPORT,
      PRODUCT_TEMPLATE_FIELDS.STYLING_EFFORT_LEVEL,
    ],
    behaviours: [RECOMMENDATION_BEHAVIOURS.STRONG_RANK],
    rankingWeight: "active",
  },
  {
    id: "overwhelmed",
    questionId: SQ.MOOD,
    activatedFields: [
      PRODUCT_TEMPLATE_FIELDS.CURRENT_EMOTIONAL_STATE_SUPPORT,
      PRODUCT_TEMPLATE_FIELDS.STYLING_EFFORT_LEVEL,
    ],
    behaviours: [RECOMMENDATION_BEHAVIOURS.STRONG_RANK],
    rankingWeight: "active",
  },
  // self-conscious: CONTEXTUAL only; no product-field match; no Body Need inference.
  {
    id: "self-conscious",
    questionId: SQ.MOOD,
    activatedFields: [],
    behaviours: [RECOMMENDATION_BEHAVIOURS.CONTEXTUAL],
    rankingWeight: "none",
  },
  // neutral: mutually exclusive with content mood answers.
  {
    id: "neutral",
    questionId: SQ.MOOD,
    activatedFields: [],
    behaviours: [RECOMMENDATION_BEHAVIOURS.NO_RECOMMENDATION_EFFECT],
    rankingWeight: "none",
  },

  // ── Session: Desired Feeling ─────────────────────────────────────────────

  {
    id: "more-confident",
    questionId: SQ.DESIRED_FEELING,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.DESIRED_FEELING_MATCH],
    behaviours: [RECOMMENDATION_BEHAVIOURS.STRONG_RANK],
    rankingWeight: "active",
  },
  {
    id: "more-put-together",
    questionId: SQ.DESIRED_FEELING,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.DESIRED_FEELING_MATCH],
    behaviours: [RECOMMENDATION_BEHAVIOURS.STRONG_RANK],
    rankingWeight: "active",
  },
  {
    id: "more-elevated",
    questionId: SQ.DESIRED_FEELING,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.DESIRED_FEELING_MATCH],
    behaviours: [RECOMMENDATION_BEHAVIOURS.STRONG_RANK],
    rankingWeight: "active",
  },
  {
    id: "more-feminine",
    questionId: SQ.DESIRED_FEELING,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.DESIRED_FEELING_MATCH],
    behaviours: [RECOMMENDATION_BEHAVIOURS.STRONG_RANK],
    rankingWeight: "active",
  },
  {
    id: "more-powerful",
    questionId: SQ.DESIRED_FEELING,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.DESIRED_FEELING_MATCH],
    behaviours: [RECOMMENDATION_BEHAVIOURS.STRONG_RANK],
    rankingWeight: "active",
  },
  {
    id: "more-effortless",
    questionId: SQ.DESIRED_FEELING,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.DESIRED_FEELING_MATCH],
    behaviours: [RECOMMENDATION_BEHAVIOURS.STRONG_RANK],
    rankingWeight: "active",
  },
  {
    id: "more-attractive",
    questionId: SQ.DESIRED_FEELING,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.DESIRED_FEELING_MATCH],
    behaviours: [RECOMMENDATION_BEHAVIOURS.STRONG_RANK],
    rankingWeight: "active",
  },
  // softer: Step 2A — genuine DFM signal (STRONG_RANK), same mechanism as every
  // other Feeling option. No catalog product carries "softer" in
  // desiredFeelingMatch yet — catalog retagging is a separate controlled step —
  // so this currently scores zero matches in practice, but the mapping itself
  // is real, not explanation-only.
  {
    id: "softer",
    questionId: SQ.DESIRED_FEELING,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.DESIRED_FEELING_MATCH],
    behaviours: [RECOMMENDATION_BEHAVIOURS.STRONG_RANK],
    rankingWeight: "active",
  },
  // like-myself: session Desired Feeling; PROFILE_AMPLIFY — no direct product score.
  // Amplifies compatible active Profile signals (Style Personalities, Desired Feelings,
  // Fit Preferences, Favourite Colours, Lifestyle, Desired Impression).
  {
    id: "like-myself",
    questionId: SQ.DESIRED_FEELING,
    activatedFields: [],
    behaviours: [RECOMMENDATION_BEHAVIOURS.PROFILE_AMPLIFY],
    rankingWeight: "none",
  },

  // ── Session: Body Needs ──────────────────────────────────────────────────
  // Deduplication rule: one positive STRONG_RANK contribution per canonical
  // Body Need per product, regardless of how many evidence fields support it.
  // styleMeComfortMatch: exact-string lookup.
  // bodyProportionEffects: translate via BPE_ALIAS_MAP (not exact-string).
  // Prose fields (bodyFitLogic, proportionRule, notIdealFor, coverageModesty):
  // supporting evidence via interpretation hooks only — not exact-string lookup.

  // Locked Body Need vocabulary (9):
  // waist-definition, soft-and-forgiving-around-waist, relaxed, more-coverage,
  // structured, elongates, balances, comfortable-elevated, nothing-specific.
  // defines-waist / emphasises-waist are BPE aliases only; flowy is not a canonical Body Need;
  // movement-friendly belongs to Practical Planning (PSM), not Body Needs.
  // bloated normalises to soft-and-forgiving-around-waist — see BODY_NEED_NORMALIZATION_MAP.
  {
    id: "waist-definition",
    questionId: SQ.BODY_NEEDS,
    activatedFields: [
      PRODUCT_TEMPLATE_FIELDS.STYLE_ME_COMFORT_MATCH,
      PRODUCT_TEMPLATE_FIELDS.BODY_PROPORTION_EFFECTS,
    ],
    behaviours: [RECOMMENDATION_BEHAVIOURS.STRONG_RANK],
    rankingWeight: "active",
  },
  {
    id: "soft-and-forgiving-around-waist",
    questionId: SQ.BODY_NEEDS,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.STYLE_ME_COMFORT_MATCH],
    behaviours: [RECOMMENDATION_BEHAVIOURS.STRONG_RANK],
    rankingWeight: "active",
  },
  {
    id: "relaxed",
    questionId: SQ.BODY_NEEDS,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.STYLE_ME_COMFORT_MATCH],
    behaviours: [RECOMMENDATION_BEHAVIOURS.STRONG_RANK],
    rankingWeight: "active",
  },
  {
    id: "more-coverage",
    questionId: SQ.BODY_NEEDS,
    activatedFields: [
      PRODUCT_TEMPLATE_FIELDS.STYLE_ME_COMFORT_MATCH,
      PRODUCT_TEMPLATE_FIELDS.COVERAGE_MODESTY,
    ],
    behaviours: [RECOMMENDATION_BEHAVIOURS.STRONG_RANK],
    rankingWeight: "active",
  },
  {
    id: "structured",
    questionId: SQ.BODY_NEEDS,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.STYLE_ME_COMFORT_MATCH],
    behaviours: [RECOMMENDATION_BEHAVIOURS.STRONG_RANK],
    rankingWeight: "active",
  },
  {
    id: "elongates",
    questionId: SQ.BODY_NEEDS,
    activatedFields: [
      PRODUCT_TEMPLATE_FIELDS.STYLE_ME_COMFORT_MATCH,
      PRODUCT_TEMPLATE_FIELDS.BODY_PROPORTION_EFFECTS,
    ],
    behaviours: [RECOMMENDATION_BEHAVIOURS.STRONG_RANK],
    rankingWeight: "active",
  },
  {
    id: "balances",
    questionId: SQ.BODY_NEEDS,
    activatedFields: [
      PRODUCT_TEMPLATE_FIELDS.STYLE_ME_COMFORT_MATCH,
      PRODUCT_TEMPLATE_FIELDS.BODY_PROPORTION_EFFECTS,
    ],
    behaviours: [RECOMMENDATION_BEHAVIOURS.STRONG_RANK],
    rankingWeight: "active",
  },
  {
    id: "comfortable-elevated",
    questionId: SQ.BODY_NEEDS,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.STYLE_ME_COMFORT_MATCH],
    behaviours: [RECOMMENDATION_BEHAVIOURS.STRONG_RANK],
    rankingWeight: "active",
  },
  // nothing-specific: no Body Need score; compatible Profile fit evidence still
  // operates at profile weight.
  {
    id: "nothing-specific",
    questionId: SQ.BODY_NEEDS,
    activatedFields: [],
    behaviours: [RECOMMENDATION_BEHAVIOURS.NO_RECOMMENDATION_EFFECT],
    rankingWeight: "none",
  },

  // ── Session: Coverage Conditional ────────────────────────────────────────

  {
    id: "coverage-non-negotiable",
    questionId: SQ.COVERAGE_CONDITIONAL,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.COVERAGE_MODESTY],
    behaviours: [RECOMMENDATION_BEHAVIOURS.STRONG_RANK],
    rankingWeight: "active",
    coverageNonNegotiable: true,
  },
  {
    id: "coverage-flexible-with-layering",
    questionId: SQ.COVERAGE_CONDITIONAL,
    activatedFields: [
      PRODUCT_TEMPLATE_FIELDS.COVERAGE_MODESTY,
      PRODUCT_TEMPLATE_FIELDS.STYLE_ME_COMFORT_MATCH,
    ],
    behaviours: [RECOMMENDATION_BEHAVIOURS.STRONG_RANK],
    rankingWeight: "active",
    coverageNonNegotiable: false,
  },

  // ── Session: Occasion ────────────────────────────────────────────────────
  // STRONG_RANK only. Small catalogue must not return empty pool from an
  // absent occasion tag.

  {
    id: "work",
    questionId: SQ.OCCASION,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.OCCASION_TAGS],
    behaviours: [RECOMMENDATION_BEHAVIOURS.STRONG_RANK],
    rankingWeight: "active",
  },
  {
    id: "everyday",
    questionId: SQ.OCCASION,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.OCCASION_TAGS],
    behaviours: [RECOMMENDATION_BEHAVIOURS.STRONG_RANK],
    rankingWeight: "active",
  },
  {
    id: "dinner",
    questionId: SQ.OCCASION,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.OCCASION_TAGS],
    behaviours: [RECOMMENDATION_BEHAVIOURS.STRONG_RANK],
    rankingWeight: "active",
  },
  {
    id: "date-night",
    questionId: SQ.OCCASION,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.OCCASION_TAGS],
    behaviours: [RECOMMENDATION_BEHAVIOURS.STRONG_RANK],
    rankingWeight: "active",
  },
  {
    id: "girls-night",
    questionId: SQ.OCCASION,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.OCCASION_TAGS],
    behaviours: [RECOMMENDATION_BEHAVIOURS.STRONG_RANK],
    rankingWeight: "active",
  },
  {
    id: "family",
    questionId: SQ.OCCASION,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.OCCASION_TAGS],
    behaviours: [RECOMMENDATION_BEHAVIOURS.STRONG_RANK],
    rankingWeight: "active",
  },
  {
    id: "special-event",
    questionId: SQ.OCCASION,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.OCCASION_TAGS],
    behaviours: [RECOMMENDATION_BEHAVIOURS.STRONG_RANK],
    rankingWeight: "active",
  },
  {
    id: "travel",
    questionId: SQ.OCCASION,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.OCCASION_TAGS],
    behaviours: [RECOMMENDATION_BEHAVIOURS.STRONG_RANK],
    rankingWeight: "active",
  },
  {
    id: "not-sure",
    questionId: SQ.OCCASION,
    activatedFields: [],
    behaviours: [RECOMMENDATION_BEHAVIOURS.NO_RECOMMENDATION_EFFECT],
    rankingWeight: "none",
  },

  // ── Session: Formality Conditional ───────────────────────────────────────
  // STRONG_RANK through formality score threshold — NOT unconditional HARD_FILTER.
  // Show for: work, dinner, date-night, girls-night, family, special-event, not-sure.
  // Skip for: everyday, travel.

  {
    id: "formality-relaxed",
    questionId: SQ.FORMALITY_CONDITIONAL,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.FORMALITY_SCORE],
    behaviours: [RECOMMENDATION_BEHAVIOURS.STRONG_RANK],
    rankingWeight: "active",
  },
  {
    id: "formality-smart",
    questionId: SQ.FORMALITY_CONDITIONAL,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.FORMALITY_SCORE],
    behaviours: [RECOMMENDATION_BEHAVIOURS.STRONG_RANK],
    rankingWeight: "active",
  },
  {
    id: "formality-polished",
    questionId: SQ.FORMALITY_CONDITIONAL,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.FORMALITY_SCORE],
    behaviours: [RECOMMENDATION_BEHAVIOURS.STRONG_RANK],
    rankingWeight: "active",
  },
  {
    id: "formality-occasion",
    questionId: SQ.FORMALITY_CONDITIONAL,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.FORMALITY_SCORE],
    behaviours: [RECOMMENDATION_BEHAVIOURS.STRONG_RANK],
    rankingWeight: "active",
  },

  // ── Session: Today Colours ────────────────────────────────────────────────
  // Profile firm-no cannot be overridden by Today Colours.
  // Profile favourite colours remain soft when no session colour preference.

  {
    id: "colour-preferred-today",
    questionId: SQ.TODAY_COLOURS,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.COLORS],
    behaviours: [RECOMMENDATION_BEHAVIOURS.STRONG_RANK],
    rankingWeight: "active",
  },
  {
    id: "colour-avoid-today",
    questionId: SQ.TODAY_COLOURS,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.COLORS],
    behaviours: [RECOMMENDATION_BEHAVIOURS.DEPRIORITISE],
    rankingWeight: "active",
  },
  {
    id: "no-special-constraint",
    questionId: SQ.TODAY_COLOURS,
    activatedFields: [],
    behaviours: [RECOMMENDATION_BEHAVIOURS.NO_RECOMMENDATION_EFFECT],
    rankingWeight: "none",
  },

  // ── Session: Practical Planning ──────────────────────────────────────────
  // movement-friendly as a practical need targets PSM (activity/logistics).
  // Disambiguated from Body Needs movement-friendly by questionId.

  {
    id: "quick-to-style",
    questionId: SQ.PRACTICAL_PLANNING,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.PRACTICAL_SUPPORT_MATCH],
    behaviours: [RECOMMENDATION_BEHAVIOURS.STRONG_RANK],
    rankingWeight: "active",
  },
  {
    id: "movement-friendly",
    questionId: SQ.PRACTICAL_PLANNING,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.PRACTICAL_SUPPORT_MATCH],
    behaviours: [RECOMMENDATION_BEHAVIOURS.STRONG_RANK],
    rankingWeight: "active",
  },
  {
    id: "long-day",
    questionId: SQ.PRACTICAL_PLANNING,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.PRACTICAL_SUPPORT_MATCH],
    behaviours: [RECOMMENDATION_BEHAVIOURS.STRONG_RANK],
    rankingWeight: "active",
  },
  {
    id: "day-to-night",
    questionId: SQ.PRACTICAL_PLANNING,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.PRACTICAL_SUPPORT_MATCH],
    behaviours: [RECOMMENDATION_BEHAVIOURS.STRONG_RANK],
    rankingWeight: "active",
  },
  {
    id: "practical-footwear",
    questionId: SQ.PRACTICAL_PLANNING,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.PRACTICAL_SUPPORT_MATCH],
    behaviours: [RECOMMENDATION_BEHAVIOURS.STRONG_RANK],
    rankingWeight: "active",
  },
  {
    id: "hot-outdoors",
    questionId: SQ.PRACTICAL_PLANNING,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.PRACTICAL_SUPPORT_MATCH],
    behaviours: [RECOMMENDATION_BEHAVIOURS.STRONG_RANK],
    rankingWeight: "active",
  },
  {
    id: "cool-air-conditioning",
    questionId: SQ.PRACTICAL_PLANNING,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.PRACTICAL_SUPPORT_MATCH],
    behaviours: [RECOMMENDATION_BEHAVIOURS.STRONG_RANK],
    rankingWeight: "active",
  },
  {
    id: "nothing-specific",
    questionId: SQ.PRACTICAL_PLANNING,
    activatedFields: [],
    behaviours: [RECOMMENDATION_BEHAVIOURS.NO_RECOMMENDATION_EFFECT],
    rankingWeight: "none",
  },

  // ── Session: Source ───────────────────────────────────────────────────────
  // Pool constraint only — not a product-field score or HARD_FILTER.

  {
    id: "naia-piece",
    questionId: SQ.SOURCE,
    activatedFields: [],
    behaviours: [],
    rankingWeight: "none",
    candidatePool: CANDIDATE_POOLS.NAIA_ONLY,
  },
  {
    id: "my-closet",
    questionId: SQ.SOURCE,
    activatedFields: [],
    behaviours: [],
    rankingWeight: "none",
    candidatePool: CANDIDATE_POOLS.CLOSET_ONLY,
  },
  {
    id: "both",
    questionId: SQ.SOURCE,
    activatedFields: [],
    behaviours: [],
    rankingWeight: "none",
    candidatePool: CANDIDATE_POOLS.BOTH,
  },

  // ── Session: Rev 3 State — "How are you arriving today?" ─────────────────────
  // Zero scoring. TEMPORARY SESSION CONTEXT + EXPLANATION/WORDING CONTEXT ONLY.
  // NEVER map State into any product field, emotion tag, or body signal.
  {
    id: "feel-good",
    questionId: SQ.STATE,
    activatedFields: [],
    behaviours: [RECOMMENDATION_BEHAVIOURS.CONTEXTUAL],
    rankingWeight: "none",
  },
  {
    id: "stressed-overloaded",
    questionId: SQ.STATE,
    activatedFields: [],
    behaviours: [RECOMMENDATION_BEHAVIOURS.CONTEXTUAL],
    rankingWeight: "none",
  },
  {
    id: "low-energy",
    questionId: SQ.STATE,
    activatedFields: [],
    behaviours: [RECOMMENDATION_BEHAVIOURS.CONTEXTUAL],
    rankingWeight: "none",
  },
  {
    id: "not-feeling-like-myself",
    questionId: SQ.STATE,
    activatedFields: [],
    behaviours: [RECOMMENDATION_BEHAVIOURS.CONTEXTUAL],
    rankingWeight: "none",
  },
  {
    id: "physically-uncomfortable",
    questionId: SQ.STATE,
    activatedFields: [],
    behaviours: [RECOMMENDATION_BEHAVIOURS.CONTEXTUAL],
    rankingWeight: "none",
  },
  {
    id: "self-conscious",
    questionId: SQ.STATE,
    activatedFields: [],
    behaviours: [RECOMMENDATION_BEHAVIOURS.CONTEXTUAL],
    rankingWeight: "none",
  },
  {
    id: "going-through-change",
    questionId: SQ.STATE,
    activatedFields: [],
    behaviours: [RECOMMENDATION_BEHAVIOURS.CONTEXTUAL],
    rankingWeight: "none",
  },
  {
    id: "want-reset",
    questionId: SQ.STATE,
    activatedFields: [],
    behaviours: [RECOMMENDATION_BEHAVIOURS.CONTEXTUAL],
    rankingWeight: "none",
  },
  {
    id: "nothing-in-particular",
    questionId: SQ.STATE,
    activatedFields: [],
    behaviours: [RECOMMENDATION_BEHAVIOURS.NO_RECOMMENDATION_EFFECT],
    rankingWeight: "none",
  },
  {
    id: "other",
    questionId: SQ.STATE,
    activatedFields: [],
    behaviours: [RECOMMENDATION_BEHAVIOURS.NO_RECOMMENDATION_EFFECT],
    rankingWeight: "none",
  },

  // ── Session: Rev 3 Intentions — "What do you want your clothes to do?" ───────
  // Scored via translation in result.tsx to canonical engine signals.
  // feel-like-myself / express-myself → PROFILE_AMPLIFY.
  // ground-me / give-energy → NO_RECOMMENDATION_EFFECT (wording context only).
  {
    id: "feel-like-myself",
    questionId: SQ.INTENTIONS,
    activatedFields: [],
    behaviours: [RECOMMENDATION_BEHAVIOURS.PROFILE_AMPLIFY],
    rankingWeight: "none",
  },
  {
    id: "confidence",
    questionId: SQ.INTENTIONS,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.DESIRED_FEELING_MATCH],
    behaviours: [RECOMMENDATION_BEHAVIOURS.STRONG_RANK],
    rankingWeight: "active",
  },
  {
    id: "ground-me",
    questionId: SQ.INTENTIONS,
    activatedFields: [],
    behaviours: [RECOMMENDATION_BEHAVIOURS.NO_RECOMMENDATION_EFFECT],
    rankingWeight: "none",
  },
  {
    id: "give-structure",
    questionId: SQ.INTENTIONS,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.STYLE_ME_COMFORT_MATCH],
    behaviours: [RECOMMENDATION_BEHAVIOURS.STRONG_RANK],
    rankingWeight: "active",
  },
  {
    id: "make-it-easy",
    questionId: SQ.INTENTIONS,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.PRACTICAL_SUPPORT_MATCH],
    behaviours: [RECOMMENDATION_BEHAVIOURS.STRONG_RANK],
    rankingWeight: "active",
  },
  {
    id: "feel-put-together",
    questionId: SQ.INTENTIONS,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.DESIRED_FEELING_MATCH],
    behaviours: [RECOMMENDATION_BEHAVIOURS.STRONG_RANK],
    rankingWeight: "active",
  },
  {
    id: "feel-attractive",
    questionId: SQ.INTENTIONS,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.DESIRED_FEELING_MATCH],
    behaviours: [RECOMMENDATION_BEHAVIOURS.STRONG_RANK],
    rankingWeight: "active",
  },
  {
    id: "give-energy",
    questionId: SQ.INTENTIONS,
    activatedFields: [],
    behaviours: [RECOMMENDATION_BEHAVIOURS.NO_RECOMMENDATION_EFFECT],
    rankingWeight: "none",
  },
  {
    id: "feel-softer",
    questionId: SQ.INTENTIONS,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.DESIRED_FEELING_MATCH],
    behaviours: [RECOMMENDATION_BEHAVIOURS.STRONG_RANK],
    rankingWeight: "active",
  },
  {
    id: "feel-sharper",
    questionId: SQ.INTENTIONS,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.DESIRED_FEELING_MATCH],
    behaviours: [RECOMMENDATION_BEHAVIOURS.STRONG_RANK],
    rankingWeight: "active",
  },
  {
    id: "feel-less-exposed",
    questionId: SQ.INTENTIONS,
    activatedFields: [
      PRODUCT_TEMPLATE_FIELDS.STYLE_ME_COMFORT_MATCH,
      PRODUCT_TEMPLATE_FIELDS.COVERAGE_MODESTY,
    ],
    behaviours: [RECOMMENDATION_BEHAVIOURS.STRONG_RANK],
    rankingWeight: "active",
  },
  {
    id: "express-myself",
    questionId: SQ.INTENTIONS,
    activatedFields: [],
    behaviours: [RECOMMENDATION_BEHAVIOURS.PROFILE_AMPLIFY],
    rankingWeight: "none",
  },

  // ── Session: Body Needs — Rev 3 context-only Physical Needs ──────────────────
  // softer-easier-fabrics / still-want-shape / structured-shape pass through
  // BODY_NEED_NORMALIZATION_MAP unchanged (no canonical mapping); they remain as
  // wording context for the AI.
  {
    id: "softer-easier-fabrics",
    questionId: SQ.BODY_NEEDS,
    activatedFields: [],
    behaviours: [RECOMMENDATION_BEHAVIOURS.CONTEXTUAL],
    rankingWeight: "none",
  },
  {
    id: "still-want-shape",
    questionId: SQ.BODY_NEEDS,
    activatedFields: [],
    behaviours: [RECOMMENDATION_BEHAVIOURS.CONTEXTUAL],
    rankingWeight: "none",
  },
  {
    id: "structured-shape",
    questionId: SQ.BODY_NEEDS,
    activatedFields: [],
    behaviours: [RECOMMENDATION_BEHAVIOURS.CONTEXTUAL],
    rankingWeight: "none",
  },

  // ── Profile: Style Personalities ──────────────────────���──────────────────
  // Approved onboarding vocabulary (10 IDs). Locked.
  // old-money, minimal, casual-cool may use STYLE_TAGS as fallback evidence
  // when no direct STYLE_PERSONALITY_MATCH token exists for a product.

  {
    id: "old-money",
    questionId: PQ.STYLE_PERSONALITIES,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.STYLE_PERSONALITY_MATCH],
    // Step 2A: demoted STRONG_RANK → SOFT_RANK (same declarative tier as every
    // other Passport background signal in this file — Fit Preferences, Desired
    // Feelings, Lifestyle, Desired Impression). The engine's numeric weight for
    // this tier is SCORING_WEIGHTS.RANK; see styleme-recommendation.ts §7.
    // Passport background preferences must not outweigh today's explicit
    // session-specific StyleMe answers.
    behaviours: [RECOMMENDATION_BEHAVIOURS.SOFT_RANK],
    rankingWeight: "active",
  },
  {
    id: "artsy",
    questionId: PQ.STYLE_PERSONALITIES,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.STYLE_PERSONALITY_MATCH],
    // Step 2A: demoted STRONG_RANK → SOFT_RANK (same declarative tier as every
    // other Passport background signal in this file — Fit Preferences, Desired
    // Feelings, Lifestyle, Desired Impression). The engine's numeric weight for
    // this tier is SCORING_WEIGHTS.RANK; see styleme-recommendation.ts §7.
    // Passport background preferences must not outweigh today's explicit
    // session-specific StyleMe answers.
    behaviours: [RECOMMENDATION_BEHAVIOURS.SOFT_RANK],
    rankingWeight: "active",
  },
  {
    id: "edgy",
    questionId: PQ.STYLE_PERSONALITIES,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.STYLE_PERSONALITY_MATCH],
    // Step 2A: demoted STRONG_RANK → SOFT_RANK (same declarative tier as every
    // other Passport background signal in this file — Fit Preferences, Desired
    // Feelings, Lifestyle, Desired Impression). The engine's numeric weight for
    // this tier is SCORING_WEIGHTS.RANK; see styleme-recommendation.ts §7.
    // Passport background preferences must not outweigh today's explicit
    // session-specific StyleMe answers.
    behaviours: [RECOMMENDATION_BEHAVIOURS.SOFT_RANK],
    rankingWeight: "active",
  },
  {
    id: "feminine",
    questionId: PQ.STYLE_PERSONALITIES,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.STYLE_PERSONALITY_MATCH],
    // Step 2A: demoted STRONG_RANK → SOFT_RANK (same declarative tier as every
    // other Passport background signal in this file — Fit Preferences, Desired
    // Feelings, Lifestyle, Desired Impression). The engine's numeric weight for
    // this tier is SCORING_WEIGHTS.RANK; see styleme-recommendation.ts §7.
    // Passport background preferences must not outweigh today's explicit
    // session-specific StyleMe answers.
    behaviours: [RECOMMENDATION_BEHAVIOURS.SOFT_RANK],
    rankingWeight: "active",
  },
  {
    id: "corporate-chic",
    questionId: PQ.STYLE_PERSONALITIES,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.STYLE_PERSONALITY_MATCH],
    // Step 2A: demoted STRONG_RANK → SOFT_RANK (same declarative tier as every
    // other Passport background signal in this file — Fit Preferences, Desired
    // Feelings, Lifestyle, Desired Impression). The engine's numeric weight for
    // this tier is SCORING_WEIGHTS.RANK; see styleme-recommendation.ts §7.
    // Passport background preferences must not outweigh today's explicit
    // session-specific StyleMe answers.
    behaviours: [RECOMMENDATION_BEHAVIOURS.SOFT_RANK],
    rankingWeight: "active",
  },
  {
    id: "effortlessly-chic",
    questionId: PQ.STYLE_PERSONALITIES,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.STYLE_PERSONALITY_MATCH],
    // Step 2A: demoted STRONG_RANK → SOFT_RANK (same declarative tier as every
    // other Passport background signal in this file — Fit Preferences, Desired
    // Feelings, Lifestyle, Desired Impression). The engine's numeric weight for
    // this tier is SCORING_WEIGHTS.RANK; see styleme-recommendation.ts §7.
    // Passport background preferences must not outweigh today's explicit
    // session-specific StyleMe answers.
    behaviours: [RECOMMENDATION_BEHAVIOURS.SOFT_RANK],
    rankingWeight: "active",
  },
  {
    id: "minimal",
    questionId: PQ.STYLE_PERSONALITIES,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.STYLE_PERSONALITY_MATCH],
    // Step 2A: demoted STRONG_RANK → SOFT_RANK (same declarative tier as every
    // other Passport background signal in this file — Fit Preferences, Desired
    // Feelings, Lifestyle, Desired Impression). The engine's numeric weight for
    // this tier is SCORING_WEIGHTS.RANK; see styleme-recommendation.ts §7.
    // Passport background preferences must not outweigh today's explicit
    // session-specific StyleMe answers.
    behaviours: [RECOMMENDATION_BEHAVIOURS.SOFT_RANK],
    rankingWeight: "active",
  },
  {
    id: "trendy",
    questionId: PQ.STYLE_PERSONALITIES,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.STYLE_PERSONALITY_MATCH],
    // Step 2A: demoted STRONG_RANK → SOFT_RANK (same declarative tier as every
    // other Passport background signal in this file — Fit Preferences, Desired
    // Feelings, Lifestyle, Desired Impression). The engine's numeric weight for
    // this tier is SCORING_WEIGHTS.RANK; see styleme-recommendation.ts §7.
    // Passport background preferences must not outweigh today's explicit
    // session-specific StyleMe answers.
    behaviours: [RECOMMENDATION_BEHAVIOURS.SOFT_RANK],
    rankingWeight: "active",
  },
  {
    id: "romantic",
    questionId: PQ.STYLE_PERSONALITIES,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.STYLE_PERSONALITY_MATCH],
    // Step 2A: demoted STRONG_RANK → SOFT_RANK (same declarative tier as every
    // other Passport background signal in this file — Fit Preferences, Desired
    // Feelings, Lifestyle, Desired Impression). The engine's numeric weight for
    // this tier is SCORING_WEIGHTS.RANK; see styleme-recommendation.ts §7.
    // Passport background preferences must not outweigh today's explicit
    // session-specific StyleMe answers.
    behaviours: [RECOMMENDATION_BEHAVIOURS.SOFT_RANK],
    rankingWeight: "active",
  },
  {
    id: "casual-cool",
    questionId: PQ.STYLE_PERSONALITIES,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.STYLE_PERSONALITY_MATCH],
    // Step 2A: demoted STRONG_RANK → SOFT_RANK (same declarative tier as every
    // other Passport background signal in this file — Fit Preferences, Desired
    // Feelings, Lifestyle, Desired Impression). The engine's numeric weight for
    // this tier is SCORING_WEIGHTS.RANK; see styleme-recommendation.ts §7.
    // Passport background preferences must not outweigh today's explicit
    // session-specific StyleMe answers.
    behaviours: [RECOMMENDATION_BEHAVIOURS.SOFT_RANK],
    rankingWeight: "active",
  },

  // ── Profile: Style Personalities (V3 archetypes — Group 1) ───────────────
  {
    id: "classic-polished",
    questionId: PQ.STYLE_PERSONALITIES,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.STYLE_PERSONALITY_MATCH],
    behaviours: [RECOMMENDATION_BEHAVIOURS.SOFT_RANK],
    rankingWeight: "active",
  },
  {
    id: "feminine-romantic",
    questionId: PQ.STYLE_PERSONALITIES,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.STYLE_PERSONALITY_MATCH],
    behaviours: [RECOMMENDATION_BEHAVIOURS.SOFT_RANK],
    rankingWeight: "active",
  },
  {
    id: "minimal-relaxed",
    questionId: PQ.STYLE_PERSONALITIES,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.STYLE_PERSONALITY_MATCH],
    behaviours: [RECOMMENDATION_BEHAVIOURS.SOFT_RANK],
    rankingWeight: "active",
  },
  {
    id: "bold-edgy",
    questionId: PQ.STYLE_PERSONALITIES,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.STYLE_PERSONALITY_MATCH],
    behaviours: [RECOMMENDATION_BEHAVIOURS.SOFT_RANK],
    rankingWeight: "active",
  },
  {
    id: "creative-expressive",
    questionId: PQ.STYLE_PERSONALITIES,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.STYLE_PERSONALITY_MATCH],
    behaviours: [RECOMMENDATION_BEHAVIOURS.SOFT_RANK],
    rankingWeight: "active",
  },

  // ── Profile: Desired Feelings ─────────────────────────────────────────────
  // Stored IDs in quiz-data.ts. Use PROFILE_DESIRED_FEELING_TRANSLATION to map
  // to canonical DFM values before product-field lookup.
  // comfortable routes to Body Need "relaxed" via SMCM, not DFM.
  // elegant routes to desiredFeelingMatch "more-elevated".

  {
    id: "confident",
    questionId: PQ.DESIRED_FEELINGS,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.DESIRED_FEELING_MATCH],
    behaviours: [RECOMMENDATION_BEHAVIOURS.SOFT_RANK],
    rankingWeight: "active",
  },
  {
    id: "comfortable",
    questionId: PQ.DESIRED_FEELINGS,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.STYLE_ME_COMFORT_MATCH],
    behaviours: [RECOMMENDATION_BEHAVIOURS.SOFT_RANK],
    rankingWeight: "active",
  },
  {
    id: "put-together",
    questionId: PQ.DESIRED_FEELINGS,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.DESIRED_FEELING_MATCH],
    behaviours: [RECOMMENDATION_BEHAVIOURS.SOFT_RANK],
    rankingWeight: "active",
  },
  {
    id: "elegant",
    questionId: PQ.DESIRED_FEELINGS,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.DESIRED_FEELING_MATCH],
    behaviours: [RECOMMENDATION_BEHAVIOURS.SOFT_RANK],
    rankingWeight: "active",
  },
  {
    id: "feminine",
    questionId: PQ.DESIRED_FEELINGS,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.DESIRED_FEELING_MATCH],
    behaviours: [RECOMMENDATION_BEHAVIOURS.SOFT_RANK],
    rankingWeight: "active",
  },
  {
    id: "powerful",
    questionId: PQ.DESIRED_FEELINGS,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.DESIRED_FEELING_MATCH],
    behaviours: [RECOMMENDATION_BEHAVIOURS.SOFT_RANK],
    rankingWeight: "active",
  },
  {
    id: "effortless",
    questionId: PQ.DESIRED_FEELINGS,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.DESIRED_FEELING_MATCH],
    behaviours: [RECOMMENDATION_BEHAVIOURS.SOFT_RANK],
    rankingWeight: "active",
  },
  {
    id: "attractive",
    questionId: PQ.DESIRED_FEELINGS,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.DESIRED_FEELING_MATCH],
    behaviours: [RECOMMENDATION_BEHAVIOURS.SOFT_RANK],
    rankingWeight: "active",
  },

  // ── Profile: Fit Preferences ──────────────────────────────────────────────
  // Verified stored answer IDs from quiz-data.ts:
  // defined-waist, relaxed-fits, structured, oversized, flowy, coverage, fitted, simple
  // MUST map through styleMeComfortMatch and bodyProportionEffects (NOT silhouette/fit).

  {
    id: "defined-waist",
    questionId: PQ.FIT_PREFERENCES,
    activatedFields: [
      PRODUCT_TEMPLATE_FIELDS.STYLE_ME_COMFORT_MATCH,
      PRODUCT_TEMPLATE_FIELDS.BODY_PROPORTION_EFFECTS,
    ],
    behaviours: [RECOMMENDATION_BEHAVIOURS.SOFT_RANK],
    rankingWeight: "active",
  },
  {
    id: "relaxed-fits",
    questionId: PQ.FIT_PREFERENCES,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.STYLE_ME_COMFORT_MATCH],
    behaviours: [RECOMMENDATION_BEHAVIOURS.SOFT_RANK],
    rankingWeight: "active",
  },
  {
    id: "structured",
    questionId: PQ.FIT_PREFERENCES,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.STYLE_ME_COMFORT_MATCH],
    behaviours: [RECOMMENDATION_BEHAVIOURS.SOFT_RANK],
    rankingWeight: "active",
  },
  {
    id: "oversized",
    questionId: PQ.FIT_PREFERENCES,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.STYLE_ME_COMFORT_MATCH],
    behaviours: [RECOMMENDATION_BEHAVIOURS.SOFT_RANK],
    rankingWeight: "active",
  },
  {
    id: "flowy",
    questionId: PQ.FIT_PREFERENCES,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.STYLE_ME_COMFORT_MATCH],
    behaviours: [RECOMMENDATION_BEHAVIOURS.SOFT_RANK],
    rankingWeight: "active",
  },
  {
    id: "coverage",
    questionId: PQ.FIT_PREFERENCES,
    activatedFields: [
      PRODUCT_TEMPLATE_FIELDS.STYLE_ME_COMFORT_MATCH,
      PRODUCT_TEMPLATE_FIELDS.COVERAGE_MODESTY,
    ],
    behaviours: [RECOMMENDATION_BEHAVIOURS.SOFT_RANK],
    rankingWeight: "active",
  },
  {
    id: "fitted",
    questionId: PQ.FIT_PREFERENCES,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.STYLE_ME_COMFORT_MATCH],
    behaviours: [RECOMMENDATION_BEHAVIOURS.SOFT_RANK],
    rankingWeight: "active",
  },
  {
    id: "simple",
    questionId: PQ.FIT_PREFERENCES,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.STYLE_ME_COMFORT_MATCH],
    behaviours: [RECOMMENDATION_BEHAVIOURS.SOFT_RANK],
    rankingWeight: "active",
  },

  // ── Profile: Favourite Colours ────────────────────────────────────────────
  // Soft signal when no session colour preference is active.

  {
    id: "profile-colour-favourite",
    questionId: PQ.FAVORITE_COLORS,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.COLORS],
    behaviours: [RECOMMENDATION_BEHAVIOURS.SOFT_RANK],
    rankingWeight: "active",
  },

  // ── Profile: Avoid Colours ────────────────────────────────────────────────
  // Ordinary avoid → DEPRIORITISE (not EXCLUDE or HARD_FILTER).
  // Firm-no → HARD_FILTER; firm-no cannot be overridden by Today Colours.

  {
    id: "profile-colour-avoid",
    questionId: PQ.AVOID_COLORS,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.COLORS],
    behaviours: [RECOMMENDATION_BEHAVIOURS.DEPRIORITISE],
    rankingWeight: "active",
    firmNo: false,
  },
  {
    id: "profile-colour-firm-no",
    questionId: PQ.AVOID_COLORS,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.COLORS],
    behaviours: [RECOMMENDATION_BEHAVIOURS.HARD_FILTER],
    rankingWeight: "active",
    firmNo: true,
  },

  // ── Profile: Style Support — like-myself ─────────────────────────────────
  // PROFILE_AMPLIFY: no direct product score; amplifies compatible active
  // Profile signals (Style Personalities, Desired Feelings, Fit Preferences,
  // Favourite Colours, Lifestyle, Desired Impression).
  // Must NOT amplify: analytics-only questions (rankingWeight "none"), explicit
  // session signals, firm exclusions, ordinary avoid-colour penalties, or hard
  // constraints.

  {
    id: "like-myself",
    questionId: PQ.STYLE_SUPPORT,
    activatedFields: [],
    behaviours: [RECOMMENDATION_BEHAVIOURS.PROFILE_AMPLIFY],
    rankingWeight: "none",
  },

  // ── Profile: Desired Impression ───────────────────────────────────────────

  {
    id: "sophisticated",
    questionId: PQ.DESIRED_IMPRESSION,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.STYLE_TAGS],
    behaviours: [RECOMMENDATION_BEHAVIOURS.SOFT_RANK],
    rankingWeight: "active",
  },
  {
    id: "approachable",
    questionId: PQ.DESIRED_IMPRESSION,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.STYLE_TAGS],
    behaviours: [RECOMMENDATION_BEHAVIOURS.SOFT_RANK],
    rankingWeight: "active",
  },
  {
    id: "creative",
    questionId: PQ.DESIRED_IMPRESSION,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.STYLE_TAGS],
    behaviours: [RECOMMENDATION_BEHAVIOURS.SOFT_RANK],
    rankingWeight: "active",
  },
  {
    id: "expressive",
    questionId: PQ.DESIRED_IMPRESSION,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.STYLE_TAGS],
    behaviours: [RECOMMENDATION_BEHAVIOURS.SOFT_RANK],
    rankingWeight: "active",
  },
  {
    id: "polished",
    questionId: PQ.DESIRED_IMPRESSION,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.STYLE_TAGS],
    behaviours: [RECOMMENDATION_BEHAVIOURS.SOFT_RANK],
    rankingWeight: "active",
  },
  {
    id: "grounded",
    questionId: PQ.DESIRED_IMPRESSION,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.STYLE_TAGS],
    behaviours: [RECOMMENDATION_BEHAVIOURS.SOFT_RANK],
    rankingWeight: "active",
  },

  // ── Profile: Lifestyle ────────────────────────────────────────────────────

  {
    id: "professional",
    questionId: PQ.LIFESTYLE,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.OCCASION_TAGS],
    behaviours: [RECOMMENDATION_BEHAVIOURS.SOFT_RANK],
    rankingWeight: "active",
  },
  {
    id: "social",
    questionId: PQ.LIFESTYLE,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.OCCASION_TAGS],
    behaviours: [RECOMMENDATION_BEHAVIOURS.SOFT_RANK],
    rankingWeight: "active",
  },
  {
    id: "active",
    questionId: PQ.LIFESTYLE,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.OCCASION_TAGS],
    behaviours: [RECOMMENDATION_BEHAVIOURS.SOFT_RANK],
    rankingWeight: "active",
  },
  {
    id: "home-focused",
    questionId: PQ.LIFESTYLE,
    activatedFields: [PRODUCT_TEMPLATE_FIELDS.OCCASION_TAGS],
    behaviours: [RECOMMENDATION_BEHAVIOURS.SOFT_RANK],
    rankingWeight: "active",
  },

  // ── Profile: Becoming (analytics only — rankingWeight "none") ────────────

  {
    id: "becoming-alive",
    questionId: PQ.BECOMING,
    activatedFields: [],
    behaviours: [RECOMMENDATION_BEHAVIOURS.NO_RECOMMENDATION_EFFECT],
    rankingWeight: "none",
  },
  {
    id: "becoming-real",
    questionId: PQ.BECOMING,
    activatedFields: [],
    behaviours: [RECOMMENDATION_BEHAVIOURS.NO_RECOMMENDATION_EFFECT],
    rankingWeight: "none",
  },
  {
    id: "becoming-fragmented",
    questionId: PQ.BECOMING,
    activatedFields: [],
    behaviours: [RECOMMENDATION_BEHAVIOURS.NO_RECOMMENDATION_EFFECT],
    rankingWeight: "none",
  },
  {
    id: "becoming-grounded",
    questionId: PQ.BECOMING,
    activatedFields: [],
    behaviours: [RECOMMENDATION_BEHAVIOURS.NO_RECOMMENDATION_EFFECT],
    rankingWeight: "none",
  },
  {
    id: "becoming-unfiltered",
    questionId: PQ.BECOMING,
    activatedFields: [],
    behaviours: [RECOMMENDATION_BEHAVIOURS.NO_RECOMMENDATION_EFFECT],
    rankingWeight: "none",
  },
  {
    id: "becoming-rooted",
    questionId: PQ.BECOMING,
    activatedFields: [],
    behaviours: [RECOMMENDATION_BEHAVIOURS.NO_RECOMMENDATION_EFFECT],
    rankingWeight: "none",
  },
  {
    id: "becoming-seen",
    questionId: PQ.BECOMING,
    activatedFields: [],
    behaviours: [RECOMMENDATION_BEHAVIOURS.NO_RECOMMENDATION_EFFECT],
    rankingWeight: "none",
  },
  {
    id: "becoming-whole",
    questionId: PQ.BECOMING,
    activatedFields: [],
    behaviours: [RECOMMENDATION_BEHAVIOURS.NO_RECOMMENDATION_EFFECT],
    rankingWeight: "none",
  },
  {
    id: "becoming-clear",
    questionId: PQ.BECOMING,
    activatedFields: [],
    behaviours: [RECOMMENDATION_BEHAVIOURS.NO_RECOMMENDATION_EFFECT],
    rankingWeight: "none",
  },
  {
    id: "becoming-her",
    questionId: PQ.BECOMING,
    activatedFields: [],
    behaviours: [RECOMMENDATION_BEHAVIOURS.NO_RECOMMENDATION_EFFECT],
    rankingWeight: "none",
  },
  {
    id: "becoming-defined",
    questionId: PQ.BECOMING,
    activatedFields: [],
    behaviours: [RECOMMENDATION_BEHAVIOURS.NO_RECOMMENDATION_EFFECT],
    rankingWeight: "none",
  },

  // ── Profile: Wardrobe Disconnection (analytics only) ─────────────────────

  {
    id: "wardrobe-disconnection-not-me",
    questionId: PQ.WARDROBE_DISCONNECTION,
    activatedFields: [],
    behaviours: [RECOMMENDATION_BEHAVIOURS.NO_RECOMMENDATION_EFFECT],
    rankingWeight: "none",
  },
  {
    id: "wardrobe-disconnection-outdated",
    questionId: PQ.WARDROBE_DISCONNECTION,
    activatedFields: [],
    behaviours: [RECOMMENDATION_BEHAVIOURS.NO_RECOMMENDATION_EFFECT],
    rankingWeight: "none",
  },
  {
    id: "wardrobe-disconnection-nothing-to-wear",
    questionId: PQ.WARDROBE_DISCONNECTION,
    activatedFields: [],
    behaviours: [RECOMMENDATION_BEHAVIOURS.NO_RECOMMENDATION_EFFECT],
    rankingWeight: "none",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Neutral answer IDs — mutually exclusive with content answers.
// ─────────────────────────────────────────────────────────────────────────────

const NEUTRAL_IDS = new Set<string>([
  "neutral",
  "nothing-specific",
  "no-special-constraint",
  "not-sure",
]);

// ─────────────────────────────────────────────────────────────────────────────
// Provisional Evidence Register — must be resolved before recommendation launch.
// Product handles verified from V7 workbook (Gate 0 Final).
// ─────────────────────────────────────────────────────────────────────────────

export const PROVISIONAL_EVIDENCE: readonly ProductFieldEvidence[] = [
  {
    productHandle: "asymmetrical-pants",
    field: PRODUCT_TEMPLATE_FIELDS.STYLING_EFFORT_LEVEL,
    canonicalValue: "medium",
    evidenceStatus: "provisional",
    provisionalNote: "Acknowledged by product owner; no specific sample blocker",
  },
  {
    productHandle: "suede-skirt",
    field: PRODUCT_TEMPLATE_FIELDS.PRACTICAL_SUPPORT_MATCH,
    canonicalValue: "movement-friendly",
    evidenceStatus: "provisional",
    provisionalNote: "Stretch microsuede and back-slit sample pending",
  },
  {
    productHandle: "suede-skirt",
    field: PRODUCT_TEMPLATE_FIELDS.PRACTICAL_SUPPORT_MATCH,
    canonicalValue: "long-day",
    evidenceStatus: "provisional",
    provisionalNote: "Same sample as movement-friendly",
  },
  {
    productHandle: "trench-coat",
    field: PRODUCT_TEMPLATE_FIELDS.PRACTICAL_SUPPORT_MATCH,
    canonicalValue: "movement-friendly",
    evidenceStatus: "provisional",
    provisionalNote: "Trench/suiting fabric and extended wear pending",
  },
  {
    productHandle: "trench-coat",
    field: PRODUCT_TEMPLATE_FIELDS.PRACTICAL_SUPPORT_MATCH,
    canonicalValue: "long-day",
    evidenceStatus: "provisional",
    provisionalNote: "Same sample as movement-friendly",
  },
  {
    productHandle: "kimono-jacket",
    field: PRODUCT_TEMPLATE_FIELDS.PRACTICAL_SUPPORT_MATCH,
    canonicalValue: "movement-friendly",
    evidenceStatus: "provisional",
    provisionalNote: "Printed air-layer suede sample pending",
  },
  {
    productHandle: "kimono-jacket",
    field: PRODUCT_TEMPLATE_FIELDS.PRACTICAL_SUPPORT_MATCH,
    canonicalValue: "long-day",
    evidenceStatus: "provisional",
    provisionalNote: "Same sample as movement-friendly",
  },
  {
    productHandle: "leather-suede-jacket",
    field: PRODUCT_TEMPLATE_FIELDS.PRACTICAL_SUPPORT_MATCH,
    canonicalValue: "quick-to-style",
    evidenceStatus: "provisional",
    provisionalNote: "Shoulder/body/sitting comfort and back-tie pre-set pending",
  },
  {
    productHandle: "midi-dress",
    field: PRODUCT_TEMPLATE_FIELDS.CURRENT_EMOTIONAL_STATE_SUPPORT,
    canonicalValue: "tired",
    evidenceStatus: "provisional",
    provisionalNote: "Sample comfort confirmation pending",
  },
  {
    productHandle: "midi-dress",
    field: PRODUCT_TEMPLATE_FIELDS.CURRENT_EMOTIONAL_STATE_SUPPORT,
    canonicalValue: "low-energy",
    evidenceStatus: "provisional",
    provisionalNote: "Same sample as tired",
  },
  {
    productHandle: "dress-set",
    field: PRODUCT_TEMPLATE_FIELDS.STYLING_EFFORT_LEVEL,
    canonicalValue: "high",
    evidenceStatus: "provisional",
    provisionalNote: "Three-component set; fastening/adjustment methods TBC from sample",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Dressing-preference hard-exclusion metadata (Group 2)
// ─────────────────────────────────────────────────────────────────────────────

// The 9 approved dressingPreferences constraint IDs.
export const APPROVED_DRESSING_PREFERENCE_IDS: ReadonlySet<string> = new Set([
  "dresses-modestly",
  "usually-wears-abayas",
  "kanduras-thobes",
  "wears-hijab",
  "arms-covered",
  "avoid-sleeveless",
  "chest-neckline-covered",
  "prefer-higher-necklines",
  "legs-covered",
  "prefer-full-length-trousers",
  "avoid-shorts",
  "longer-tops",
  "no-cropped-tops",
  "looser-fitting",
  "no-dressing-requirements",
]);

// ── Dressing metadata types ───────────────────────────────────────────────────

// Sleeve length as worn. "n/a" = not applicable (BOTTOM item type).
export type SleeveLength = "full" | "three-quarter" | "short" | "sleeveless" | "n/a";

// Neckline coverage. "n/a" = not applicable (BOTTOM) or exempt (OUTERWEAR that is not
// wrap-variable). "wrap-variable" = wrap front that does not guarantee coverage without a base.
export type NecklineCoverage =
  | "high" | "crew" | "mock" | "cowl-high"
  | "v-neck" | "low" | "off-shoulder" | "wrap-variable"
  | "n/a";

// Hem length of the garment. "full" = full-length trouser/maxi. "n/a" = not applicable
// for TOP or OUTERWEAR (leg coverage is determined by the bottom worn beneath).
export type HemLength = "full" | "maxi" | "midi" | "knee" | "mini" | "n/a";

// Length of a top or set's top component. "n/a" = not applicable (BOTTOM, DRESS, OUTERWEAR).
export type TopLength = "cropped" | "hip-length" | "longline" | "tunic" | "n/a";

// Overall fit profile. Values satisfying `looser-fitting`: relaxed / loose / oversized / flowy.
export type FitProfile =
  | "fitted" | "body-skimming" | "tailored" | "structured"
  | "relaxed" | "loose" | "oversized" | "flowy"
  | "n/a";

// Per-product dressing-preference metadata. Baked into GeneratedCatalogProduct
// by scripts/extract-naia-catalog.ts. Absent = fail-closed for most constraints;
// permissive only for `wears-hijab`.
export interface DressingMetadata {
  // dresses-modestly → require true (fail closed when false or absent)
  modestySafe: boolean;
  // usually-wears-abayas → require true (fail closed when false or absent)
  abayaCompatible: boolean;
  // wears-hijab → exclude when false; permissive when product absent from catalog
  hijabCompatible: boolean;
  sleeveLength: SleeveLength;
  necklineCoverage: NecklineCoverage;
  hemLength: HemLength;
  topLength: TopLength;
  fitProfile: FitProfile;
}


// ─────────────────────────────────────────────────────────────────────────────
// Internal indexes (built once at module load)
// ─────────────────────────────────────────────────────────────────────────────

const REGISTRY_BY_ID = new Map<string, AnswerMapping[]>();
const REGISTRY_BY_QUESTION = new Map<string, AnswerMapping[]>();

for (const mapping of ANSWER_REGISTRY) {
  const byId = REGISTRY_BY_ID.get(mapping.id);
  if (byId) {
    byId.push(mapping);
  } else {
    REGISTRY_BY_ID.set(mapping.id, [mapping]);
  }

  const byQ = REGISTRY_BY_QUESTION.get(mapping.questionId);
  if (byQ) {
    byQ.push(mapping);
  } else {
    REGISTRY_BY_QUESTION.set(mapping.questionId, [mapping]);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// API functions
// ─────────────────────────────────────────────────────────────────────────────

/** First registered mapping for an ID. Use getMappingsByIdAndQuestion when question context is known. */
export function getMappingById(id: string): AnswerMapping | undefined {
  return REGISTRY_BY_ID.get(id)?.[0];
}

/** Disambiguates answers that share an ID across questions (e.g. "movement-friendly"). */
export function getMappingsByIdAndQuestion(
  id: string,
  questionId: string
): AnswerMapping | undefined {
  return REGISTRY_BY_ID.get(id)?.find((m) => m.questionId === questionId);
}

/** All registered mappings for a question. */
export function getAnswersByQuestion(questionId: string): readonly AnswerMapping[] {
  return REGISTRY_BY_QUESTION.get(questionId) ?? [];
}

/**
 * Maps stored Profile answer IDs to canonical values used in product fields.
 * Passes through IDs not in the translation table unchanged.
 */
export function resolveAlias(profileAnswerId: string): string {
  return PROFILE_DESIRED_FEELING_TRANSLATION[profileAnswerId] ?? profileAnswerId;
}

/** True for answers that suppress other selections (neutral, nothing-specific, no-special-constraint). */
export function isNeutralAnswer(id: string): boolean {
  return NEUTRAL_IDS.has(id);
}

/**
 * Aggregates activated fields across all questions for an ID.
 * Call getActivatedFieldsByQuestion when question context is known.
 */
export function getActivatedFields(id: string): ProductTemplateField[] {
  const entries = REGISTRY_BY_ID.get(id);
  if (!entries) return [];
  const fields = new Set<ProductTemplateField>();
  for (const m of entries) {
    for (const f of m.activatedFields) fields.add(f);
  }
  return [...fields];
}

/** Activated fields for a specific question/answer combination. */
export function getActivatedFieldsByQuestion(
  id: string,
  questionId: string
): ProductTemplateField[] {
  return getMappingsByIdAndQuestion(id, questionId)?.activatedFields ?? [];
}

/**
 * Aggregates behaviours across all questions for an ID.
 * Call getMappingsByIdAndQuestion when question context is known.
 */
export function getBehaviours(id: string): Behaviour[] {
  const entries = REGISTRY_BY_ID.get(id);
  if (!entries) return [];
  const behaviours = new Set<Behaviour>();
  for (const m of entries) {
    for (const b of m.behaviours) behaviours.add(b);
  }
  return [...behaviours];
}

/** True if the ID appears in any registered mapping. */
export function isKnownAnswer(id: string): boolean {
  return REGISTRY_BY_ID.has(id);
}

/** Returns the candidate pool constraint for a source answer, or null. */
export function getCandidatePool(id: string): CandidatePool | null {
  const entries = REGISTRY_BY_ID.get(id);
  if (!entries) return null;
  for (const m of entries) {
    if (m.candidatePool) return m.candidatePool;
  }
  return null;
}

/**
 * A product is eligible when its eligibility state is NOT "verified-inactive".
 * Unverified products are eligible (with a verification flag for the engine).
 */
export function isEligible(handle: string): boolean {
  return PRODUCT_ELIGIBILITY[handle] !== ELIGIBILITY_STATES.VERIFIED_INACTIVE;
}

/** Returns the override category for a session answer, or null. */
export function getSessionOverrideCategory(id: string): string | null {
  const entries = REGISTRY_BY_ID.get(id);
  if (!entries) return null;
  for (const m of entries) {
    if (m.questionId === SQ.TODAY_COLOURS) return "today-colours";
    if (m.questionId === SQ.SOURCE) return "source";
    if (m.questionId === SQ.COVERAGE_CONDITIONAL) return "coverage-conditional";
    if (m.questionId === SQ.FORMALITY_CONDITIONAL) return "formality-conditional";
  }
  return null;
}

/** True if the answer is a declared firm-no colour exclusion. */
export function isFirmNo(id: string): boolean {
  return REGISTRY_BY_ID.get(id)?.some((m) => m.firmNo === true) ?? false;
}

/** True if the coverage conditional answer activates non-negotiable exclusion evaluation. */
export function isCoverageNonNegotiable(id: string): boolean {
  return (
    REGISTRY_BY_ID.get(id)?.some((m) => m.coverageNonNegotiable === true) ?? false
  );
}

/** The mood answer IDs that activate the Styling Effort Rule. */
export function getStylingEffortActivationMoods(): readonly string[] {
  return STYLING_EFFORT_RULE.activationMoods;
}

// ─────────────────────────────────────────────────────────────────────────────
// Lifestyle field accessor
// ─────────────────────────────────────────────────────────────────────────────

/** Normalise lifestyle to a string array.
 *  Accepts the native String[] (V2-E) or a legacy comma-joined string (migration compat).
 *  Preserves stored order; never truncates existing values.  Returns [] for null/empty. */
export function readLifestyle(lifestyle: string[] | string | null | undefined): string[] {
  if (!lifestyle) return [];
  if (Array.isArray(lifestyle)) return lifestyle.filter(Boolean);
  return lifestyle.split(",").map((s) => s.trim()).filter(Boolean);
}
