// app/lib/passport/rev7-vocabulary.ts
// Passport Rev 7 — single source of truth for stable internal option IDs,
// selection caps, exclusive-value rules and legacy compatibility projections.
//
// Imported by:
//   - app/lib/onboarding/quiz-data.ts        (question definitions / labels)
//   - app/routes/api.save-style-profile.jsx  (server-side validation)
//   - app/lib/ai/styleme-result.server.ts    (profile signal builder + prompt block)
//   - app/routes/api.wishlist.jsx            (Buy or Skip prompt block)
//
// DESIGN RULES
//   1. Display copy is never a database identifier. IDs here are stable kebab-case.
//   2. Legacy IDs are never deleted — they stay valid for existing stored profiles.
//   3. Every cap and exclusive rule declared here is enforced server-side.
//   4. Nothing in this file assigns numeric scoring weight.

// ─────────────────────────────────────────────────────────────────────────────
// Profile version
// ─────────────────────────────────────────────────────────────────────────────

/** Stamped on profileVersion when a Rev 7 onboarding or refresh completes. */
export const REV7_PROFILE_VERSION = 7;

/** profileVersion values that mean "this profile answered the Rev 7 question set". */
export function isRev7Profile(profileVersion: number | null | undefined): boolean {
  return profileVersion === REV7_PROFILE_VERSION;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Personality — words the customer says feel most like them.
//    Field name styleExpression is retained deliberately: renaming it would be a
//    schema/API change. Only the user- and model-facing copy describes personality.
// ─────────────────────────────────────────────────────────────────────────────

export const STYLE_EXPRESSION_IDS = [
  // Offered vocabulary. playful, creative and not-sure carry over from the
  // previous set because the same word survives — their IDs are reused, not churned.
  "confident", "calm", "energetic", "easygoing", "thoughtful", "playful",
  "practical", "creative", "outgoing", "private", "spontaneous", "organised",
  "independent", "not-sure",
  // Withdrawn from the question, still valid for stored answers —
  // see RETIRED_STYLE_EXPRESSION_IDS.
  "quiet-confidence", "polished", "effortless", "bold", "sophisticated",
  "relaxed", "powerful", "individual", "understated", "unexpected",
] as const;

export const STYLE_EXPRESSION_VALID_IDS: ReadonlySet<string> = new Set(STYLE_EXPRESSION_IDS);
export const STYLE_EXPRESSION_MAX = 3;
export const STYLE_EXPRESSION_EXCLUSIVE_IDS: ReadonlySet<string> = new Set(["not-sure"]);

/**
 * Style-expression values withdrawn when Q3 became a personality question.
 * Kept in STYLE_EXPRESSION_IDS for the same reason as the retired dressing
 * habits: a stored answer must keep validating on re-save, and must keep
 * resolving to real copy. Nothing is migrated or deleted.
 */
export const RETIRED_STYLE_EXPRESSION_IDS: ReadonlySet<string> = new Set([
  "quiet-confidence", "polished", "effortless", "bold", "sophisticated",
  "relaxed", "powerful", "individual", "understated", "unexpected",
]);

/**
 * The 14 IDs the Personality question actually offers today.
 *
 * STYLE_EXPRESSION_VALID_IDS is deliberately wider: it still accepts the
 * withdrawn IDs so an un-migrated profile can re-save without failing
 * validation. This set is the narrower "what counts as a current answer to
 * Q3" test, and it is what every picker, cap and completeness check uses.
 *
 * The distinction matters because Q3 did not merely lose options — the
 * question changed meaning. A stored "polished" answered "how do you want
 * your clothes to come across", not "which words feel like you". Treating it
 * as a Personality answer would be wrong, not just stale.
 */
export const STYLE_EXPRESSION_CURRENT_IDS: ReadonlySet<string> = new Set(
  STYLE_EXPRESSION_IDS.filter(id => !RETIRED_STYLE_EXPRESSION_IDS.has(id)),
);

/** Current-vocabulary Personality answers, in stored order. */
export function currentStyleExpression(values: readonly string[] | null | undefined): string[] {
  return (values ?? []).filter(id => STYLE_EXPRESSION_CURRENT_IDS.has(id));
}

/**
 * Withdrawn Q3 answers, in stored order. Only meaningful when
 * currentStyleExpression() is empty — once a customer answers the new
 * question their current answers are the whole truth and these are dropped.
 */
export function legacyStyleExpression(values: readonly string[] | null | undefined): string[] {
  return (values ?? []).filter(id => RETIRED_STYLE_EXPRESSION_IDS.has(id));
}

/**
 * Splits a stored styleExpression into the two mutually exclusive views every
 * surface needs. `legacy` is non-empty ONLY when there is no current answer,
 * so no caller can accidentally blend the two vocabularies.
 */
export function splitStyleExpression(values: readonly string[] | null | undefined): {
  current: string[];
  legacy: string[];
} {
  const current = currentStyleExpression(values);
  return { current, legacy: current.length > 0 ? [] : legacyStyleExpression(values) };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Style Exploration — how far nAia should move beyond familiar choices (NEW)
// ─────────────────────────────────────────────────────────────────────────────

export const EXPLORATION_LEVEL_IDS = [
  "stay-familiar", "familiar-small-twists", "balanced",
  "push-beyond", "depends-on-occasion", "not-sure",
] as const;

export const EXPLORATION_LEVEL_VALID_IDS: ReadonlySet<string> = new Set(EXPLORATION_LEVEL_IDS);

// ─────────────────────────────────────────────────────────────────────────────
// 5. Style Direction — visual aesthetics the user is drawn to (NEW)
//    Canonical Rev 7 style field. Replaces stylePersonalities for new/updated
//    Passports. stylePersonalities is NEVER written by the Rev 7 flow.
// ─────────────────────────────────────────────────────────────────────────────

export const STYLE_DIRECTION_IDS = [
  "polished-refined", "clean-minimal", "relaxed-easy", "bold-statement",
  "creative-individual", "soft-romantic", "street-contemporary",
  "sporty-functional", "not-sure",
] as const;

export const STYLE_DIRECTION_VALID_IDS: ReadonlySet<string> = new Set(STYLE_DIRECTION_IDS);
export const STYLE_DIRECTION_MAX = 3;
export const STYLE_DIRECTION_EXCLUSIVE_IDS: ReadonlySet<string> = new Set(["not-sure"]);

// ─────────────────────────────────────────────────────────────────────────────
// 12. Dressing Habits — behavioural context (NEW)
// ─────────────────────────────────────────────────────────────────────────────

export const DRESSING_HABIT_IDS = [
  "repeat-same-outfits", "struggle-to-combine", "nothing-to-wear", "overthink",
  "know-what-i-want", "play-it-safe", "enjoy-experimenting", "mood-led",
  "comfort-first", "want-it-easier", "buy-but-cant-style",
  "save-inspo-cant-recreate", "none-of-these",
] as const;

export const DRESSING_HABIT_VALID_IDS: ReadonlySet<string> = new Set(DRESSING_HABIT_IDS);

/**
 * Dressing habits withdrawn from the question but NOT from the vocabulary.
 *
 * They stay in DRESSING_HABIT_IDS on purpose: a customer who selected one still
 * has it stored, and re-saving that section submits it back. Dropping it from the
 * valid set would make their next save fail validation. They are filtered out of
 * the pickers instead, and their labels are retained so a stored answer never
 * renders as a slug. No stored value is migrated or deleted.
 */
export const RETIRED_DRESSING_HABIT_IDS: ReadonlySet<string> = new Set([
  "want-it-easier",
  "buy-but-cant-style",
  // Withdrawn because Q4 Style Exploration already captures this signal.
  "play-it-safe",
  "enjoy-experimenting",
]);
export const DRESSING_HABIT_MAX = 2;
export const DRESSING_HABIT_EXCLUSIVE_IDS: ReadonlySet<string> = new Set(["none-of-these"]);

// ─────────────────────────────────────────────────────────────────────────────
// Legacy → Rev 7 style projection
//
// TEMPORARY COMPATIBILITY INFRASTRUCTURE, NOT THE DEFINITION OF THE NEW SYSTEM.
//
// The NADINE catalog's STYLE_PERSONALITY_MATCH column carries the five V3
// archetype tokens only.  Until the catalog gains first-class Rev 7 direction
// tokens, the numeric archetype scorer can consume a Rev 7 direction only when
// the relationship to an existing archetype is genuinely unambiguous.
//
// relaxed-easy / street-contemporary / sporty-functional have NO honest archetype
// analogue.  They are fully valid Rev 7 signals — they are simply invisible to
// the legacy numeric scorer, and are surfaced to the prompt layer instead.
// ─────────────────────────────────────────────────────────────────────────────

export const STYLE_DIRECTION_TO_LEGACY_ARCHETYPE: Readonly<Record<string, string>> = {
  "polished-refined":    "classic-polished",
  "clean-minimal":       "minimal-relaxed",
  "bold-statement":      "bold-edgy",
  "creative-individual": "creative-expressive",
  "soft-romantic":       "feminine-romantic",
};

/**
 * Rev 7 directions that intentionally have no legacy archetype projection.
 * Not invalid — unmapped. Tracked so the gap stays visible rather than silent.
 */
export const UNMAPPED_STYLE_DIRECTION_IDS: ReadonlySet<string> = new Set([
  "relaxed-easy",
  "street-contemporary",
  "sporty-functional",
]);

/** Legacy V3 archetype → Rev 7 direction. Display/summary use only. */
export const LEGACY_ARCHETYPE_TO_STYLE_DIRECTION: Readonly<Record<string, string>> = {
  "classic-polished":    "polished-refined",
  "minimal-relaxed":     "clean-minimal",
  "bold-edgy":           "bold-statement",
  "creative-expressive": "creative-individual",
  "feminine-romantic":   "soft-romantic",
};

export interface StyleDirectionProjection {
  /** V3 archetype tokens the legacy numeric scorer can consume. */
  archetypes: string[];
  /** Rev 7 direction IDs with no archetype analogue — prompt-layer only. */
  unmapped: string[];
}

/**
 * Projects Rev 7 styleDirections onto legacy V3 archetype tokens.
 * "not-sure" is a sentinel and never projects. Order is preserved; duplicates removed.
 */
export function projectStyleDirectionsToArchetypes(
  styleDirections: readonly string[] | null | undefined,
): StyleDirectionProjection {
  const archetypes: string[] = [];
  const unmapped: string[] = [];
  const seenArchetypes = new Set<string>();

  for (const id of styleDirections ?? []) {
    if (id === "not-sure") continue;
    const archetype = STYLE_DIRECTION_TO_LEGACY_ARCHETYPE[id];
    if (archetype) {
      if (!seenArchetypes.has(archetype)) {
        seenArchetypes.add(archetype);
        archetypes.push(archetype);
      }
    } else if (STYLE_DIRECTION_VALID_IDS.has(id)) {
      unmapped.push(id);
    }
  }

  return { archetypes, unmapped };
}

/**
 * Resolves the archetype tokens the legacy scorer should use for a profile.
 *
 *   Rev 7 profile with styleDirections → projection of those directions
 *   Any other profile                  → stored stylePersonalities, untouched
 *
 * A Rev 7 customer's stylePersonalities row is legacy data that the Rev 7 flow
 * never rewrites; it must not be mixed with the projection.
 */
export function resolveScoringArchetypes(profile: {
  styleDirections?: readonly string[] | null;
  stylePersonalities?: readonly string[] | null;
}): string[] {
  const directions = profile.styleDirections ?? [];
  if (directions.length > 0) {
    return projectStyleDirectionsToArchetypes(directions).archetypes;
  }
  return [...(profile.stylePersonalities ?? [])];
}

// ─────────────────────────────────────────────────────────────────────────────
// Dressing requirements — reserved-but-unsupported IDs
//
// These two IDs are accepted and stored so that no answer is ever lost, but they
// are NOT offered in the production Passport UI, because nAia cannot honour them.
//
// FOLLOW-UP TASK — "Dressing metadata: opacity + back coverage"
//   Enforcing them deterministically requires, in order:
//     1. NADINE workbook: two new authored columns (opacity, backCoverage) on every
//        product, then `promote-nadine-workbook.ts` + `extract-naia-catalog.ts`
//        (FIELD_MAP, CANONICAL_ORDER, parseDressingMetadata) + regenerate
//        app/lib/ai/generated/naia-catalog.generated.ts.
//     2. DressingMetadata (app/lib/ai/signal-contract.ts): two new required fields.
//     3. ClosetItem: two new columns + migration, mirroring the Group 2 token fields.
//     4. closet-garment-analysis.server.ts: vision prompt + parser must classify both.
//     5. Admin garment intelligence UI + review queue surfaces for both.
//     6. Re-analysis backfill of every existing ClosetItem.
//   Step 6 is the gate: until it completes, every stored item reads null, and the
//   required fail-closed behaviour would exclude a customer's entire closet.
//
// Only unhide these once steps 1–6 are done AND the exclusion engine in
// styleme-recommendation.ts / styleme-result.server.ts enforces them fail-closed.
// ─────────────────────────────────────────────────────────────────────────────

export const RESERVED_DRESSING_PREFERENCE_IDS: ReadonlySet<string> = new Set([
  "avoid-sheer",
  "avoid-open-back",
]);

/** Dressing requirement that opens the free-text cultural/religious note. */
export const DRESSING_REQUIREMENTS_NOTE_TRIGGER_ID = "other-cultural-religious";

/** Max length of dressingRequirementsNote after trim. */
export const DRESSING_REQUIREMENTS_NOTE_MAX = 500;

// ─────────────────────────────────────────────────────────────────────────────
// Colour vocabulary sentinels
// ─────────────────────────────────────────────────────────────────────────────

/** favoriteColors sentinel — clears every specific favourite colour. */
export const NO_COLOUR_PREFERENCE_ID = "no-colour-preference";
/** avoidColors sentinel — clears every specific avoided colour. */
export const NO_AVOID_COLOURS_ID = "none";

export const FAVOURITE_COLOURS_MAX = 5;

// ─────────────────────────────────────────────────────────────────────────────
// Generic exclusive-value resolution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Applies an exclusive-value rule to a submitted multi-select array.
 * If any exclusive ID is present, the result is that single exclusive ID
 * (the first one found, in submission order). Otherwise the array is unchanged.
 */
export function applyExclusiveRule(
  values: readonly string[],
  exclusiveIds: ReadonlySet<string>,
): string[] {
  const exclusive = values.find((v) => exclusiveIds.has(v));
  return exclusive !== undefined ? [exclusive] : [...values];
}
